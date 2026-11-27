import crypto from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import distance from '@turf/distance';
import { point as turfPoint, polygon as turfPolygon } from '@turf/helpers';
import { locateCsvDirectory, readCsvTable } from '../adapters/csv-adapter.ts';
import type {
  EvalSqliteStore,
  StoredV4EvalRecord,
  StoredV4EvalSideSummary,
  V4StoredOperator,
} from '../adapters/sqlite-store.ts';
import type {
  AggregationMetricItem,
  AggregationOperatorConfig,
  DagGraphDefinition,
  DagNodeBase,
  DatasetColumn,
  DerivedColumnConfig,
  EffectDefinition,
  EvaluationDagOutput,
  EvaluationSystemDag,
  EvidenceRef,
  FieldDataType,
  MetricDomainTag,
  MetricGraphDefinition,
  OperatorNodeExecutionResult,
  ScoringRule,
  TableDataset,
  V4MetricSnapshotItem,
  V4MetricTableSlice,
} from '../core/types.ts';
import type { EffectStore } from '../effects/store.ts';
import {
  evaluateMetricGraph,
  type MetricGraphExecutionResult,
  type MetricGraphStore,
  type MetricOperatorInput,
} from '../indicators/metric-graph-store.ts';
import { sampleScoringCurve } from '../core/scoring-functions.ts';
import {
  evaluateAggregationDataset,
  validateAggregationConfig,
} from '../operators/aggregation-engine.ts';
import { evaluateFormulaDataset } from '../operators/formula-engine.ts';
import {
  computeCombinedWeights,
  computeCriticWeights,
  computeEntropyWeights,
} from '../operators/mcda-adapter.ts';
import {
  defaultV4OperatorStore,
  type V4OperatorStore,
} from '../operators/v4/store.ts';
import { runV4Operator } from '../operators/v4/v4-operator-runner.ts';
import {
  collectDagParamOverrides,
  evaluateSystemDag,
  normalizeIncomingWeights,
  validateSystemDag,
  type EvaluationDagRunOutput,
  type SystemDagEvaluationInputs,
} from '../systems/dag-evaluator.ts';
import type {
  StoredEvaluationSystemDag,
  SystemDagStore,
} from '../systems/system-dag-store.ts';
import {
  canonicalJsonStringify,
  detectCycles,
  executeDagGraph,
  type DagNodeCache,
  type DagNodeExecutionOutput,
} from './dag-executor.ts';
import { executePythonScript, type PythonTableInput } from './python-worker.ts';

export type OperatorDagNode = DagNodeBase & {
  refId?: string;
};

export interface V4RouteDeps {
  effectStore: EffectStore;
  metricGraphStore: MetricGraphStore;
  systemDagStore: SystemDagStore;
  v4OperatorStore?: V4OperatorStore;
  cache?: DagNodeCache;
  listOperators: (options?: { layer?: 'fact' | 'all' }) => unknown[];
  listComponents?: () => unknown[];
  runOperator: (
    operatorId: string,
    body: Record<string, unknown>,
  ) => Promise<OperatorNodeExecutionResult>;
  resolveCsvDir?: (runId?: string, dataSourceId?: string) => string | undefined;
  getEvalStore?: () => EvalSqliteStore;
}

const UNSAFE_PYTHON_PATTERNS = [
  /\bimport\s+os\b/,
  /\bfrom\s+os\s+import\b/,
  /\bimport\s+subprocess\b/,
  /\bfrom\s+subprocess\s+import\b/,
  /\bimport\s+sys\b/,
  /\b__import__\s*\(/,
  /\beval\s*\(/,
  /\bexec\s*\(/,
  /\bopen\s*\(/,
];

function toV4OperatorSummaryItem(spec: V4StoredOperator) {
  const outCols = Array.isArray(spec.outputColumns) ? spec.outputColumns : [];
  return {
    id: spec.id,
    name: spec.name,
    chapter: spec.chapter ?? 0,
    category: spec.category,
    militaryLevel: spec.militaryLevel,
    domainTag: spec.domainTag,
    description: spec.description ?? '',
    layer: spec.layer ?? 'fact',
    engineKind: spec.engineKind ?? 'python_script',
    isBuiltin: Boolean(spec.isBuiltin),
    requiredTables: Array.isArray(spec.requiredTables) ? spec.requiredTables : [],
    optionalTables: Array.isArray(spec.optionalTables) ? spec.optionalTables : [],
    ...(spec.upstreamOperatorId ? { upstreamOperatorId: spec.upstreamOperatorId } : {}),
    ...(spec.tableColumns ? { tableColumns: spec.tableColumns } : {}),
    parameterPorts: Array.isArray(spec.parameterPorts) ? spec.parameterPorts : [],
    outputColumns: outCols.map((col) =>
      typeof col === 'string' ? { name: col, type: 'string' } : col,
    ),
    outputColumnNames: outCols.map((col) =>
      typeof col === 'string' ? col : String((col as { name?: string }).name ?? ''),
    ),
    pythonCode: spec.pythonCode ?? '',
    ...(spec.updatedAt ? { updatedAt: spec.updatedAt } : {}),
  };
}

function validateV4OperatorSpecInput(raw: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  spec?: V4StoredOperator;
} {
  const errors: string[] = [];
  const id = asNonEmptyString(raw.id);
  const name = asNonEmptyString(raw.name);
  if (!id) {
    errors.push('缺少必填字段 id');
  } else if (!/^[a-zA-Z0-9_.-]+$/.test(id)) {
    errors.push('id 仅允许字母、数字、下划线、点或连字符');
  }
  if (!name) {
    errors.push('缺少必填字段 name');
  }
  const category = (asNonEmptyString(raw.category) ?? 'effectiveness') as V4StoredOperator['category'];
  const militaryLevel = (asNonEmptyString(raw.militaryLevel) ?? 'MOP') as V4StoredOperator['militaryLevel'];
  const domainTag = (asNonEmptyString(raw.domainTag) ?? 'firepower') as V4StoredOperator['domainTag'];
  const engineKind = (asNonEmptyString(raw.engineKind) ?? 'python_script') as NonNullable<
    V4StoredOperator['engineKind']
  >;
  const layer = (asNonEmptyString(raw.layer) ?? 'fact') as NonNullable<V4StoredOperator['layer']>;
  const pythonCode = typeof raw.pythonCode === 'string' ? raw.pythonCode : '';
  if (engineKind === 'python_script' && !pythonCode.trim()) {
    errors.push('python_script 类型算子必须提供 pythonCode');
  }
  for (const pat of UNSAFE_PYTHON_PATTERNS) {
    if (pat.test(pythonCode)) {
      errors.push(`pythonCode 包含受限危险调用: ${pat.source}`);
      break;
    }
  }
  const requiredTables = Array.isArray(raw.requiredTables)
    ? raw.requiredTables.map((t) => String(t).trim()).filter(Boolean)
    : [];
  const optionalTables = Array.isArray(raw.optionalTables)
    ? raw.optionalTables.map((t) => String(t).trim()).filter(Boolean)
    : [];
  const outputColumns = Array.isArray(raw.outputColumns)
    ? raw.outputColumns
        .map((c) => (typeof c === 'string' ? c : String((c as { name?: string })?.name ?? '')))
        .filter(Boolean)
    : [];

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    spec: {
      id: id!,
      name: name!,
      chapter: typeof raw.chapter === 'number' && Number.isFinite(raw.chapter) ? raw.chapter : 99,
      category,
      militaryLevel,
      domainTag,
      description: typeof raw.description === 'string' ? raw.description : '',
      layer,
      engineKind,
      requiredTables,
      optionalTables,
      ...(asNonEmptyString(raw.upstreamOperatorId)
        ? { upstreamOperatorId: asNonEmptyString(raw.upstreamOperatorId) }
        : {}),
      ...(asPlainRecord(raw.tableColumns)
        ? { tableColumns: raw.tableColumns as Record<string, string[]> }
        : {}),
      parameterPorts: Array.isArray(raw.parameterPorts)
        ? (raw.parameterPorts as V4StoredOperator['parameterPorts'])
        : [],
      outputColumns,
      pythonCode,
      isBuiltin: false,
    },
  };
}

const V4_NL_DOMAIN_KEYWORDS: Array<{
  domain: MetricDomainTag;
  label: string;
  keywords: string[];
}> = [
  {
    domain: 'firepower',
    label: '火力打击与防空拦截',
    keywords: ['突击', '打击', '火力', '命中', '防空', '反导', '拦截', '突防', '武器', 'bvr', 'strike', 'weapon'],
  },
  {
    domain: 'isr',
    label: '侦察预警与雷达探测',
    keywords: ['侦察', '预警', '探测', '雷达', '发现', 'isr', 'radar', 'sensor'],
  },
  {
    domain: 'c2',
    label: '指挥控制与态势协同',
    keywords: ['指挥', '指控', '态势', '决策', 'c2', '走廊', '空域'],
  },
  {
    domain: 'synergy',
    label: '杀伤链协同与支援保障',
    keywords: ['协同', '杀伤链', '闭环', 'ooda', '时效', '快速', '支援', '集群', '蜂群', 'swarm'],
  },
  {
    domain: 'survivability',
    label: '机动生存与电磁对抗',
    keywords: ['生存', '巡逻', '掩护', '电子战', '干扰', '压制', '战损', '防护', 'ew', 'patrol'],
  },
  {
    domain: 'cost',
    label: '作战效费与经济交换比',
    keywords: ['成本', '效费', '经济', '交换比', '损耗', '省弹', 'cost', 'exchange'],
  },
];

function draftV4SystemDagFromPrompt(
  prompt: string,
  effectStore: EffectStore,
  opts?: { systemId?: string; name?: string; metricGraphId?: string },
): {
  system: EvaluationSystemDag & { metricGraphId?: string };
  matchedDomains: string[];
  rationale: string[];
} {
  const lower = prompt.toLowerCase();
  const domainScores = new Map<MetricDomainTag, number>();
  const matchedLabels: string[] = [];

  for (const rule of V4_NL_DOMAIN_KEYWORDS) {
    let hits = 0;
    for (const kw of rule.keywords) {
      if (lower.includes(kw.toLowerCase())) hits += 1;
    }
    if (hits > 0) {
      domainScores.set(rule.domain, hits);
      matchedLabels.push(rule.label);
    }
  }

  const wantsGate = /红线|误伤|走廊|合规|安全|门控|roe|fratricide|corridor|gate/i.test(prompt);
  const allEffects = effectStore.listAll().filter((e) => Boolean(e.metricBinding?.metricId));
  const leafEffects = allEffects.filter((e) => e.role === 'effect');
  const gateEffects = allEffects.filter((e) => e.role === 'gate');

  let selectedEffects =
    domainScores.size > 0
      ? leafEffects.filter((e) => e.domainTag && domainScores.has(e.domainTag))
      : leafEffects.slice(0, 6);
  if (selectedEffects.length === 0) {
    selectedEffects = leafEffects.slice(0, 6);
  }
  selectedEffects = selectedEffects.slice(0, 8);

  const selectedGates = wantsGate
    ? gateEffects.slice(0, 2)
    : gateEffects.filter((g) => g.effectId === 'gate_fratricide_zero' || g.effectId === 'gate_excessive_attrition').slice(0, 1);

  const systemId =
    opts?.systemId?.trim() ||
    `sys_v4_nl_${crypto.randomUUID().slice(0, 8)}`;
  const name =
    opts?.name?.trim() ||
    (matchedLabels.length > 0
      ? `${matchedLabels.slice(0, 2).join('与')}评估体系草案`
      : '智能生成 V4 综合评估体系草案');

  const nodes: EvaluationSystemDag['nodes'] = [];
  const edges: EvaluationSystemDag['edges'] = [];
  const metricProxyIds = new Map<string, string>();
  let rowIdx = 0;

  const ensureProxy = (metricId: string, label: string): string => {
    const existing = metricProxyIds.get(metricId);
    if (existing) return existing;
    const pxId = `px_nl_${rowIdx + 1}`;
    metricProxyIds.set(metricId, pxId);
    nodes.push({
      id: pxId,
      kind: 'metric_proxy',
      label,
      refId: metricId,
      position: { x: 60, y: 60 + rowIdx * 130 },
    });
    return pxId;
  };

  const terminalNodeId = 'ef_nl_terminal_overall';
  const rawWeights: Array<{ edgeId: string; sourceNodeId: string; rawW: number }> = [];

  for (const eff of selectedEffects) {
    const metricId = eff.metricBinding!.metricId;
    const pxId = ensureProxy(metricId, eff.name);
    const efNodeId = `ef_nl_${rowIdx + 1}`;
    nodes.push({
      id: efNodeId,
      kind: 'effect',
      label: eff.name,
      refId: eff.effectId,
      position: { x: 420, y: 60 + rowIdx * 130 },
    });
    edges.push({
      id: `se_nl_px_${rowIdx + 1}`,
      sourceNodeId: pxId,
      targetNodeId: efNodeId,
    });
    const boost = eff.domainTag ? (domainScores.get(eff.domainTag) ?? 1) : 1;
    rawWeights.push({
      edgeId: `se_nl_term_${rowIdx + 1}`,
      sourceNodeId: efNodeId,
      rawW: 1 + boost * 0.5,
    });
    rowIdx += 1;
  }

  for (const gate of selectedGates) {
    const metricId = gate.metricBinding!.metricId;
    const pxId = ensureProxy(metricId, gate.name);
    const gtNodeId = `gt_nl_${rowIdx + 1}`;
    nodes.push({
      id: gtNodeId,
      kind: 'gate',
      label: gate.name,
      refId: gate.effectId,
      position: { x: 420, y: 60 + rowIdx * 130 },
    });
    edges.push({
      id: `se_nl_gt_${rowIdx + 1}`,
      sourceNodeId: pxId,
      targetNodeId: gtNodeId,
    });
    rowIdx += 1;
  }

  nodes.push({
    id: terminalNodeId,
    kind: 'effect',
    label: name,
    position: { x: 820, y: Math.max(120, Math.round((rowIdx * 130) / 2)) },
    inlineEffect: {
      effectId: `${systemId}_terminal_inline`,
      name,
      description: `基于自然语言任务需求自动生成的 V4 综合评估终态节点：${prompt.slice(0, 120)}`,
      domainTag: 'synergy',
      role: 'effect',
      aggregation: {
        strategy: 'weighted_sum',
        missingPolicy: 'skip_renormalize',
      },
    },
  });

  const weightSum = rawWeights.reduce((acc, item) => acc + item.rawW, 0) || 1;
  for (const item of rawWeights) {
    edges.push({
      id: item.edgeId,
      sourceNodeId: item.sourceNodeId,
      targetNodeId: terminalNodeId,
      weight: item.rawW / weightSum,
    });
  }

  const rawDag: EvaluationSystemDag & { metricGraphId?: string } = {
    systemId,
    name,
    version: '4.0.0',
    description: `自然语言草案需求：${prompt}`,
    metricGraphId: opts?.metricGraphId ?? 'mg_v4_metrics_guide_full',
    terminalEffectNodeId: terminalNodeId,
    globalParams: {
      targetSide: '红方',
      enemySide: '蓝方',
    },
    nodes,
    edges,
  };

  const normalized = normalizeIncomingWeights(rawDag, effectStore) as EvaluationSystemDag & {
    metricGraphId?: string;
  };
  const rationale = [
    matchedLabels.length > 0
      ? `识别到核心作战域：${matchedLabels.join('、')}`
      : '未命中特定领域关键词，已采用全域基线平衡模板',
    `自动挂载 ${selectedEffects.length} 项 V4 效果节点与 ${selectedGates.length} 项安全红线门控节点`,
    '终态节点入边权重已自动归一化至 Σ=1.0000',
  ];

  return {
    system: normalized,
    matchedDomains: matchedLabels,
    rationale,
  };
}

const CANONICAL_SIDE_COLUMNS = [
  '分方',
  '发射分方',
  'Side',
  'UnitSide',
  'WeaponSide',
  'FiringUnitSide',
  'TargetSide',
  '所属分方',
  '阵营',
  '传感器平台分方',
  '执行分方',
] as const;

const SPATIAL_KEEP_COLUMNS = [
  'MissionID',
  'MissionName',
  'UnitID',
  'UnitName',
  'Side',
  '分方',
  '发射分方',
  'UnitSide',
  'Time',
] as const;

function asNonEmptyString(val: unknown): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asPlainRecord(val: unknown): Record<string, unknown> | undefined {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return undefined;
  return val as Record<string, unknown>;
}

function asNestedParamOverrides(
  val: unknown,
): Record<string, Record<string, unknown>> | undefined {
  const rec = asPlainRecord(val);
  if (!rec) return undefined;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries(rec)) {
    const inner = asPlainRecord(v);
    if (inner) out[k] = inner;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function mergeParamMaps(
  ...maps: Array<Record<string, Record<string, unknown>> | undefined>
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [key, entries] of Object.entries(map)) {
      if (!out[key]) out[key] = {};
      for (const [pk, pv] of Object.entries(entries)) {
        if (pv !== undefined) {
          out[key][pk] = pv;
        }
      }
    }
  }
  return out;
}

function sendError(
  sendJson: (res: ServerResponse, status: number, payload: unknown) => void,
  res: ServerResponse,
  status: number,
  error: string,
  extra?: Record<string, unknown>,
): void {
  sendJson(res, status, { ok: false, error, ...(extra ?? {}) });
}

function toFiniteNumber(val: unknown): number | null {
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function inferFieldDataType(values: unknown[]): FieldDataType {
  const nonEmpty = values.filter(
    (v) => v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === ''),
  );
  if (nonEmpty.length === 0) return 'string';

  if (
    nonEmpty.every(
      (v) =>
        typeof v === 'boolean' ||
        (typeof v === 'string' && /^(true|false)$/i.test(v.trim())),
    )
  ) {
    return 'boolean';
  }

  if (
    nonEmpty.every((v) => {
      if (typeof v === 'number') return Number.isFinite(v);
      if (typeof v !== 'string') return false;
      const t = v.trim();
      if (!t || /^0\d+$/.test(t)) return false;
      return Number.isFinite(Number(t));
    })
  ) {
    return 'number';
  }

  if (
    nonEmpty.every(
      (v) =>
        typeof v === 'string' &&
        /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/.test(v.trim()),
    )
  ) {
    return 'datetime';
  }

  return 'string';
}

function coerceCsvValue(raw: string, colType: FieldDataType): unknown {
  const trimmed = raw.trim();
  if (colType === 'number') {
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : raw;
  }
  if (colType === 'boolean') {
    if (!trimmed) return null;
    const low = trimmed.toLowerCase();
    if (low === 'true') return true;
    if (low === 'false') return false;
    return raw;
  }
  return raw;
}

function normalizeTableDatasetInput(
  input: unknown,
  idHint?: string,
): TableDataset | undefined {
  if (!input) return undefined;

  if (Array.isArray(input)) {
    const rows = input.filter(
      (r): r is Record<string, unknown> => Boolean(r && typeof r === 'object' && !Array.isArray(r)),
    );
    const colNameSet = new Set<string>();
    for (const r of rows.slice(0, 100)) {
      for (const k of Object.keys(r)) colNameSet.add(k);
    }
    const columns: DatasetColumn[] = [...colNameSet].map((name) => ({
      name,
      type: inferFieldDataType(rows.slice(0, 50).map((r) => r[name])),
    }));
    return {
      ...(idHint ? { id: idHint } : {}),
      columns,
      schema: columns,
      rows,
      totalRows: rows.length,
    };
  }

  const rec = asPlainRecord(input);
  if (!rec || !Array.isArray(rec.rows)) return undefined;

  const rows = rec.rows.filter(
    (r): r is Record<string, unknown> => Boolean(r && typeof r === 'object' && !Array.isArray(r)),
  );
  const rawCols = Array.isArray(rec.columns)
    ? rec.columns
    : Array.isArray(rec.schema)
    ? rec.schema
    : [];

  let columns: DatasetColumn[];
  if (rawCols.length > 0) {
    columns = rawCols
      .map((c): DatasetColumn | null => {
        if (typeof c === 'string') {
          return {
            name: c,
            type: inferFieldDataType(rows.slice(0, 50).map((r) => r[c])),
          };
        }
        const cr = asPlainRecord(c);
        if (!cr || typeof cr.name !== 'string') return null;
        const typeVal = cr.type;
        const colType: FieldDataType =
          typeVal === 'number' ||
          typeVal === 'boolean' ||
          typeVal === 'datetime' ||
          typeVal === 'string'
            ? typeVal
            : inferFieldDataType(rows.slice(0, 50).map((r) => r[cr.name as string]));
        return {
          name: cr.name,
          type: colType,
          ...(typeof cr.displayName === 'string' ? { displayName: cr.displayName } : {}),
          ...(typeof cr.description === 'string' ? { description: cr.description } : {}),
          ...(typeof cr.isDerived === 'boolean' ? { isDerived: cr.isDerived } : {}),
        };
      })
      .filter((c): c is DatasetColumn => c !== null);
  } else {
    const colNameSet = new Set<string>();
    for (const r of rows.slice(0, 100)) {
      for (const k of Object.keys(r)) colNameSet.add(k);
    }
    columns = [...colNameSet].map((name) => ({
      name,
      type: inferFieldDataType(rows.slice(0, 50).map((r) => r[name])),
    }));
  }

  return {
    ...(typeof rec.id === 'string' ? { id: rec.id } : idHint ? { id: idHint } : {}),
    columns,
    schema: columns,
    rows,
    totalRows: rows.length,
    ...(Array.isArray(rec.dimensionKeys) ? { dimensionKeys: rec.dimensionKeys as string[] } : {}),
    ...(Array.isArray(rec.measureKeys) ? { measureKeys: rec.measureKeys as string[] } : {}),
  };
}

function mergeTableDatasets(datasets: TableDataset[]): TableDataset | undefined {
  if (datasets.length === 0) return undefined;
  if (datasets.length === 1) return datasets[0];

  const colMap = new Map<string, DatasetColumn>();
  const rows: Array<Record<string, unknown>> = [];
  for (const ds of datasets) {
    for (const c of ds.columns ?? []) {
      if (!colMap.has(c.name)) colMap.set(c.name, c);
    }
    for (const r of ds.rows ?? []) {
      rows.push({ ...r });
    }
  }
  const cols = [...colMap.values()];
  return {
    columns: cols,
    schema: cols,
    rows,
    totalRows: rows.length,
    ...(datasets[0].dimensionKeys ? { dimensionKeys: datasets[0].dimensionKeys } : {}),
    ...(datasets[0].measureKeys ? { measureKeys: datasets[0].measureKeys } : {}),
  };
}

function mergeEvidenceRefLists(groups: EvidenceRef[][]): EvidenceRef[] {
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const group of groups) {
    for (const ref of group) {
      const key = `${ref.source}|${String(ref.ref)}|${ref.scenarioClock}|${ref.description}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(ref);
      }
    }
  }
  return out;
}

function isAggregateAllSide(side: string): boolean {
  const upper = side.toUpperCase();
  return upper === 'ALL' || side === '全部' || side === '全部阵营';
}

function extractDatasetColumnNames(dataset: TableDataset): Set<string> {
  const colNames = new Set<string>();
  for (const c of dataset.columns ?? []) {
    if (typeof c === 'string') colNames.add(c);
    else if (c && typeof c.name === 'string') colNames.add(c.name);
  }
  const rawSchema = dataset.schema as Array<DatasetColumn | string> | undefined;
  for (const c of rawSchema ?? []) {
    if (typeof c === 'string') colNames.add(c);
    else if (c && typeof c.name === 'string') colNames.add(c.name);
  }
  if (colNames.size === 0 && dataset.rows.length > 0) {
    for (const k of Object.keys(dataset.rows[0] ?? {})) {
      colNames.add(k);
    }
  }
  return colNames;
}

/**
 * 从一库算子成功产出的 dataset.rows 中动态发现所有实际出现的作战分方（去重、非空、非 ALL/全部，保持出现顺序）。
 */
export function discoverSidesFromOperatorResults<T extends MetricOperatorInput>(
  operatorResults: Record<string, T>,
): string[] {
  const seen = new Set<string>();
  const sides: string[] = [];

  const recordSide = (raw: string): void => {
    const trimmed = raw.trim();
    if (!trimmed || isAggregateAllSide(trimmed) || seen.has(trimmed)) return;
    seen.add(trimmed);
    sides.push(trimmed);
  };

  for (const entry of Object.values(operatorResults)) {
    if (
      !entry ||
      entry.status === 'unavailable' ||
      !entry.dataset ||
      !Array.isArray(entry.dataset.rows)
    ) {
      continue;
    }

    const colNames = extractDatasetColumnNames(entry.dataset);
    const matchedSideCols = CANONICAL_SIDE_COLUMNS.filter((col) => colNames.has(col));
    const hasRatioCol = colNames.has('分方比');
    if (matchedSideCols.length === 0 && !hasRatioCol) {
      continue;
    }

    for (const row of entry.dataset.rows) {
      if (!row || typeof row !== 'object') continue;
      for (const col of matchedSideCols) {
        const val = row[col];
        if (val !== null && val !== undefined) {
          recordSide(String(val));
        }
      }
      if (hasRatioCol) {
        const ratioVal = row['分方比'];
        if (ratioVal !== null && ratioVal !== undefined) {
          const text = String(ratioVal).trim();
          const sepIdx = text.search(/[:/]/);
          if (sepIdx > 0) {
            recordSide(text.slice(0, sepIdx));
          }
        }
      }
    }
  }

  return sides;
}

/**
 * 按指定作战阵营对一库算子结果进行统一切片：
 * - 若未指定 targetSide 或为 'ALL' / '全部' / '全部阵营'，原样返回；
 * - 否则按规范分方列精确过滤，或对包含 '分方比' 的对偶比较表按 `${targetSide}/` 或 `${targetSide}:` 前缀过滤；
 * - 不含分方列的全阵营通用表（如装备性能参数表）透传不裁剪。
 */
export function sliceOperatorResultsBySide<T extends MetricOperatorInput>(
  operatorResults: Record<string, T>,
  targetSide?: string,
): Record<string, T> {
  const side = typeof targetSide === 'string' ? targetSide.trim() : '';
  if (!side || isAggregateAllSide(side)) {
    return operatorResults;
  }

  const sliced: Record<string, T> = {};
  for (const [key, entry] of Object.entries(operatorResults)) {
    if (!entry || !entry.dataset || !Array.isArray(entry.dataset.rows)) {
      sliced[key] = entry;
      continue;
    }

    const colNames = extractDatasetColumnNames(entry.dataset);

    const sideCol = CANONICAL_SIDE_COLUMNS.find((candidate) => colNames.has(candidate));
    if (sideCol) {
      const filteredRows = entry.dataset.rows.filter(
        (row) => String(row?.[sideCol] ?? '').trim() === side,
      );
      sliced[key] = {
        ...entry,
        dataset: {
          ...entry.dataset,
          rows: filteredRows,
          totalRows: filteredRows.length,
        },
      };
      continue;
    }

    if (colNames.has('分方比')) {
      const filteredRows = entry.dataset.rows.filter((row) => {
        const text = String(row?.['分方比'] ?? '').trim();
        const sepIdx = text.search(/[:/]/);
        return sepIdx > 0 && text.slice(0, sepIdx).trim() === side;
      });
      sliced[key] = {
        ...entry,
        dataset: {
          ...entry.dataset,
          rows: filteredRows,
          totalRows: filteredRows.length,
        },
      };
      continue;
    }

    sliced[key] = entry;
  }

  return sliced;
}

function applyOptionalRowFilter(
  dataset: TableDataset,
  filterField?: string,
  filterEquals?: string,
): TableDataset {
  if (!filterField || filterEquals === undefined) return dataset;
  const filteredRows = dataset.rows.filter(
    (row) => String(row?.[filterField] ?? '').trim() === String(filterEquals).trim(),
  );
  return {
    ...dataset,
    rows: filteredRows,
    totalRows: filteredRows.length,
  };
}

function loadTableForDataInput(
  tableName: string,
  options: {
    csvDir?: string;
    inputDfDict?: Record<string, PythonTableInput>;
    filterField?: string;
    filterEquals?: string;
    maxRows?: number;
  },
):
  | { ok: true; dataset: TableDataset; evidenceRef: EvidenceRef }
  | { ok: false; reason: string } {
  const normalizedTarget = tableName.replace(/\.csv$/i, '').trim();
  const targetLower = normalizedTarget.toLowerCase();

  if (options.inputDfDict) {
    let matchedInput: unknown;
    let matchedKey = tableName;
    if (tableName in options.inputDfDict) {
      matchedInput = options.inputDfDict[tableName];
    } else if (normalizedTarget in options.inputDfDict) {
      matchedInput = options.inputDfDict[normalizedTarget];
      matchedKey = normalizedTarget;
    } else {
      for (const [k, v] of Object.entries(options.inputDfDict)) {
        if (k.replace(/\.csv$/i, '').trim().toLowerCase() === targetLower) {
          matchedInput = v;
          matchedKey = k;
          break;
        }
      }
    }

    if (matchedInput !== undefined) {
      const ds = normalizeTableDatasetInput(matchedInput, `ds_${normalizedTarget}`);
      if (!ds) {
        return {
          ok: false,
          reason: `inputDfDict 中的表 "${matchedKey}" 格式无效，无法转为 TableDataset`,
        };
      }
      const filtered = applyOptionalRowFilter(ds, options.filterField, options.filterEquals);
      return {
        ok: true,
        dataset: filtered,
        evidenceRef: {
          source: 'csv',
          ref: matchedKey,
          scenarioClock: '00:00:00',
          description: `从内存数据集加载 ${matchedKey} (${filtered.rows.length} 行)`,
        },
      };
    }
  }

  if (!options.csvDir) {
    return {
      ok: false,
      reason: `未配置数据源 csvDir 或 inputDfDict，缺少推演事件底表: ${normalizedTarget}.csv`,
    };
  }

  const locatedDir = locateCsvDirectory(options.csvDir);
  if (!fs.existsSync(locatedDir) || !fs.statSync(locatedDir).isDirectory()) {
    return {
      ok: false,
      reason: `CSV 数据目录不存在: ${locatedDir}`,
    };
  }

  const matchedFiles = fs
    .readdirSync(locatedDir)
    .filter((file) => {
      if (!file.toLowerCase().endsWith('.csv')) return false;
      const fileLower = file.toLowerCase();
      return fileLower === `${targetLower}.csv` || fileLower.endsWith(`_${targetLower}.csv`);
    })
    .sort();

  if (matchedFiles.length === 0) {
    return {
      ok: false,
      reason: `缺少推演事件底表: ${normalizedTarget}.csv (目录: ${locatedDir})`,
    };
  }

  let headers: string[] = [];
  const rawRows: Array<Record<string, string>> = [];
  for (const file of matchedFiles) {
    const fullPath = path.join(locatedDir, file);
    const parsed = readCsvTable(
      fullPath,
      options.maxRows !== undefined ? { maxRows: options.maxRows } : undefined,
    );
    if (headers.length === 0 && parsed.headers.length > 0) {
      headers = parsed.headers;
    }
    for (const r of parsed.rows) {
      rawRows.push(r.data);
      if (options.maxRows !== undefined && rawRows.length >= options.maxRows) {
        break;
      }
    }
    if (options.maxRows !== undefined && rawRows.length >= options.maxRows) {
      break;
    }
  }

  if (headers.length === 0 && rawRows.length > 0) {
    headers = Object.keys(rawRows[0]);
  }

  const sampleRows = rawRows.slice(0, 50);
  const columns: DatasetColumn[] = headers.map((name) => ({
    name,
    type: inferFieldDataType(sampleRows.map((r) => r[name])),
  }));
  const colTypeMap = new Map<string, FieldDataType>(columns.map((c) => [c.name, c.type]));

  const coercedRows: Array<Record<string, unknown>> = rawRows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const h of headers) {
      const colType = colTypeMap.get(h) ?? 'string';
      out[h] = coerceCsvValue(row[h] ?? '', colType);
    }
    return out;
  });

  const dataset = applyOptionalRowFilter(
    {
      id: `ds_${normalizedTarget}`,
      columns,
      schema: columns,
      rows: coercedRows,
      totalRows: coercedRows.length,
    },
    options.filterField,
    options.filterEquals,
  );

  return {
    ok: true,
    dataset,
    evidenceRef: {
      source: 'csv',
      ref: matchedFiles.join(','),
      scenarioClock: '00:00:00',
      description: `从 CSV 目录加载 ${matchedFiles.join(', ')} (${dataset.rows.length} 行)`,
    },
  };
}

function parseGeoCoordinatePair(raw: unknown): [number, number] | null {
  if (Array.isArray(raw) && raw.length >= 2) {
    const lon = toFiniteNumber(raw[0]);
    const lat = toFiniteNumber(raw[1]);
    return lon !== null && lat !== null ? [lon, lat] : null;
  }
  const rec = asPlainRecord(raw);
  if (rec) {
    const lon = toFiniteNumber(rec.lon ?? rec.longitude ?? rec.lng ?? rec.x);
    const lat = toFiniteNumber(rec.lat ?? rec.latitude ?? rec.y);
    return lon !== null && lat !== null ? [lon, lat] : null;
  }
  return null;
}

function parsePolygonRing(raw: unknown): Array<[number, number]> | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const ring: Array<[number, number]> = [];
  for (const item of raw) {
    const pt = parseGeoCoordinatePair(item);
    if (!pt) return null;
    ring.push(pt);
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

function minDistanceKmToPolygonBoundary(
  pt: [number, number],
  ring: Array<[number, number]>,
): number {
  const [px, py] = pt;
  const cosLat = Math.max(0.1, Math.cos((py * Math.PI) / 180));
  let minDistKm = Infinity;

  for (let i = 0; i < ring.length - 1; i += 1) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[i + 1];
    const dx = (bx - ax) * cosLat;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 1e-12) {
      t = Math.max(
        0,
        Math.min(1, (((px - ax) * cosLat) * dx + (py - ay) * dy) / lenSq),
      );
    }
    const projLon = ax + t * (bx - ax);
    const projLat = ay + t * (by - ay);
    const segDist = distance(turfPoint([px, py]), turfPoint([projLon, projLat]), {
      units: 'kilometers',
    });
    if (segDist < minDistKm) {
      minDistKm = segDist;
    }
  }

  return Number.isFinite(minDistKm) ? minDistKm : 0;
}

function findColumnName(
  dataset: TableDataset,
  candidates: readonly string[],
): string | undefined {
  const colSet = new Set((dataset.columns ?? []).map((c) => c.name));
  for (const c of candidates) {
    if (colSet.has(c)) return c;
  }
  if (dataset.rows.length > 0) {
    const first = dataset.rows[0];
    for (const c of candidates) {
      if (c in first) return c;
    }
  }
  return undefined;
}

async function executeSpatialNode(
  node: OperatorDagNode,
  resolvedParams: Record<string, unknown>,
  upstreamDataset: TableDataset | undefined,
  upstreamEvidence: EvidenceRef[],
  ctx: {
    runId: string;
    dataSourceId?: string;
    csvDir?: string;
    inputDfDict?: Record<string, PythonTableInput>;
  },
  deps: V4RouteDeps,
): Promise<DagNodeExecutionOutput> {
  const configuredOpId =
    asNonEmptyString(resolvedParams.operatorId) ??
    (asNonEmptyString(node.refId) && !String(node.refId).startsWith('algo_')
      ? asNonEmptyString(node.refId)
      : undefined);

  if (configuredOpId) {
    try {
      const opRes = await deps.runOperator(configuredOpId, {
        operatorId: configuredOpId,
        runId: ctx.runId,
        ...(ctx.dataSourceId ? { dataSourceId: ctx.dataSourceId } : {}),
        ...(ctx.csvDir ? { csvDir: ctx.csvDir } : {}),
        ...(ctx.inputDfDict !== undefined ? { inputDfDict: ctx.inputDfDict } : {}),
        ...(upstreamDataset !== undefined ? { prevOutputDf: upstreamDataset } : {}),
        params: resolvedParams,
      });
      return {
        status: opRes.status,
        ...(opRes.dataset !== undefined ? { dataset: opRes.dataset } : {}),
        evidenceRefs: opRes.evidenceRefs ?? [],
        ...(opRes.missingDataReason !== undefined
          ? { missingDataReason: opRes.missingDataReason }
          : {}),
      };
    } catch (err) {
      return {
        status: 'unavailable',
        evidenceRefs: upstreamEvidence,
        missingDataReason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (!upstreamDataset) {
    return {
      status: 'unavailable',
      evidenceRefs: upstreamEvidence,
      missingDataReason: 'spatial 节点缺少上游输入数据集',
    };
  }

  const lonField =
    asNonEmptyString(resolvedParams.lonField) ??
    findColumnName(upstreamDataset, [
      'UnitLongitude',
      'lon',
      'Longitude',
      'lng',
      '经度',
      'FiringUnitLongitude',
      'TargetContactLongitude',
    ]);
  const latField =
    asNonEmptyString(resolvedParams.latField) ??
    findColumnName(upstreamDataset, [
      'UnitLatitude',
      'lat',
      'Latitude',
      '纬度',
      'FiringUnitLatitude',
      'TargetContactLatitude',
    ]);

  const polygonRing = parsePolygonRing(
    resolvedParams.polygon ?? resolvedParams.corridor ?? resolvedParams.points,
  );
  const targetPoint = parseGeoCoordinatePair(
    resolvedParams.targetPoint ?? resolvedParams.threatCenter ?? resolvedParams.center,
  );
  const minSafeMarginKm = toFiniteNumber(resolvedParams.minSafeMarginKm) ?? 0;

  if (lonField && latField && polygonRing) {
    const poly = turfPolygon([polygonRing]);
    const presentKeepCols = SPATIAL_KEEP_COLUMNS.filter((col) =>
      findColumnName(upstreamDataset, [col]) !== undefined,
    );
    const outCols: DatasetColumn[] = [
      ...presentKeepCols.map((name) => ({
        name,
        type: 'string' as FieldDataType,
      })),
      { name: lonField, type: 'number' },
      { name: latField, type: 'number' },
      { name: 'InPolygon', type: 'boolean', isDerived: true },
      { name: 'MinMargin_km', type: 'number', isDerived: true },
      { name: 'ComplianceStatus', type: 'string', isDerived: true },
    ];

    const outRows: Array<Record<string, unknown>> = [];
    for (const row of upstreamDataset.rows) {
      const lon = toFiniteNumber(row[lonField]);
      const lat = toFiniteNumber(row[latField]);
      if (lon === null || lat === null) continue;
      const inside = booleanPointInPolygon(turfPoint([lon, lat]), poly);
      const boundaryDist = minDistanceKmToPolygonBoundary([lon, lat], polygonRing);
      const marginKm = Math.round((inside ? boundaryDist : -boundaryDist) * 1000) / 1000;
      const statusText = !inside
        ? '越界警告 (Out of Bounds)'
        : marginKm >= minSafeMarginKm
        ? '安全合规 (Compliant)'
        : '边沿预警 (Marginal)';

      const outRow: Record<string, unknown> = {};
      for (const k of presentKeepCols) {
        outRow[k] = row[k];
      }
      outRow[lonField] = lon;
      outRow[latField] = lat;
      outRow.InPolygon = inside;
      outRow.MinMargin_km = marginKm;
      outRow.ComplianceStatus = statusText;
      outRows.push(outRow);
    }

    return {
      status: 'valid',
      dataset: {
        id: `ds_spatial_${node.id}`,
        columns: outCols,
        schema: outCols,
        rows: outRows,
        totalRows: outRows.length,
      },
      evidenceRefs: upstreamEvidence,
    };
  }

  if (lonField && latField && targetPoint) {
    const radiusKm =
      toFiniteNumber(resolvedParams.radiusKm) ??
      (toFiniteNumber(resolvedParams.radiusNm) !== null
        ? toFiniteNumber(resolvedParams.radiusNm)! * 1.852
        : null);
    const presentKeepCols = SPATIAL_KEEP_COLUMNS.filter((col) =>
      findColumnName(upstreamDataset, [col]) !== undefined,
    );
    const outCols: DatasetColumn[] = [
      ...presentKeepCols.map((name) => ({
        name,
        type: 'string' as FieldDataType,
      })),
      { name: lonField, type: 'number' },
      { name: latField, type: 'number' },
      { name: 'Distance_km', type: 'number', isDerived: true },
      { name: 'Distance_nm', type: 'number', isDerived: true },
      ...(radiusKm !== null
        ? [{ name: 'WithinRange', type: 'boolean' as FieldDataType, isDerived: true }]
        : []),
    ];

    const outRows: Array<Record<string, unknown>> = [];
    for (const row of upstreamDataset.rows) {
      const lon = toFiniteNumber(row[lonField]);
      const lat = toFiniteNumber(row[latField]);
      if (lon === null || lat === null) continue;
      const distKm =
        Math.round(
          distance(turfPoint([lon, lat]), turfPoint(targetPoint), { units: 'kilometers' }) *
            1000,
        ) / 1000;
      const distNm = Math.round((distKm / 1.852) * 1000) / 1000;

      const outRow: Record<string, unknown> = {};
      for (const k of presentKeepCols) {
        outRow[k] = row[k];
      }
      outRow[lonField] = lon;
      outRow[latField] = lat;
      outRow.Distance_km = distKm;
      outRow.Distance_nm = distNm;
      if (radiusKm !== null) {
        outRow.WithinRange = distKm <= radiusKm;
      }
      outRows.push(outRow);
    }

    return {
      status: 'valid',
      dataset: {
        id: `ds_spatial_${node.id}`,
        columns: outCols,
        schema: outCols,
        rows: outRows,
        totalRows: outRows.length,
      },
      evidenceRefs: upstreamEvidence,
    };
  }

  // 若上游已包含空间合规判定列（例如经典空间样本），按纯净输出契约重算 ComplianceStatus
  if (
    upstreamDataset.rows.some(
      (r) => r.MinMargin_km !== undefined || r.UnitComplianceRate !== undefined,
    )
  ) {
    const outCols: DatasetColumn[] = [
      { name: 'MissionID', type: 'string' },
      { name: 'MissionName', type: 'string' },
      { name: 'UnitID', type: 'string' },
      { name: 'UnitName', type: 'string' },
      { name: 'ActiveDuration_s', type: 'number' },
      { name: 'InCorridorDuration_s', type: 'number' },
      { name: 'UnitComplianceRate', type: 'number' },
      { name: 'MinMargin_km', type: 'number' },
      { name: 'ComplianceStatus', type: 'string' },
    ];
    const outRows = upstreamDataset.rows.map((r) => {
      const margin = toFiniteNumber(r.MinMargin_km) ?? 0;
      const rate = toFiniteNumber(r.UnitComplianceRate) ?? (margin >= 0 ? 1 : 0);
      return {
        MissionID: r.MissionID ?? '',
        MissionName: r.MissionName ?? '',
        UnitID: r.UnitID ?? '',
        UnitName: r.UnitName ?? '',
        ActiveDuration_s: toFiniteNumber(r.ActiveDuration_s) ?? 0,
        InCorridorDuration_s: toFiniteNumber(r.InCorridorDuration_s) ?? 0,
        UnitComplianceRate: rate,
        MinMargin_km: margin,
        ComplianceStatus:
          margin >= minSafeMarginKm
            ? '100% 遵从 (Compliant)'
            : margin >= 0
            ? '边沿在勤 (Marginal)'
            : '越界警告 (Boundary Alert)',
      };
    });
    return {
      status: 'valid',
      dataset: {
        id: `ds_spatial_${node.id}`,
        columns: outCols,
        schema: outCols,
        rows: outRows,
        totalRows: outRows.length,
      },
      evidenceRefs: upstreamEvidence,
    };
  }

  return {
    status: 'unavailable',
    evidenceRefs: upstreamEvidence,
    missingDataReason:
      'spatial 节点缺少经纬度坐标列或空间规则参数 (polygon / targetPoint / operatorId)',
  };
}

/**
 * 解析并向指标 DAG 节点（含反向向其上游 from_operator 节点透传）分配参数覆盖
 */
function resolveMetricGraphNodeOverrides(
  graph: MetricGraphDefinition,
  topologicalOrder: string[],
  paramOverrides?: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  if (!paramOverrides || Object.keys(paramOverrides).length === 0) return {};

  const directByNode: Record<string, Record<string, unknown>> = {};
  for (const node of graph.nodes) {
    const mc = node.metricConfig;
    const merged: Record<string, unknown> = {};
    if (mc?.sourceRef && paramOverrides[mc.sourceRef]) {
      Object.assign(merged, paramOverrides[mc.sourceRef]);
    }
    if (mc?.metricId && paramOverrides[mc.metricId]) {
      Object.assign(merged, paramOverrides[mc.metricId]);
    }
    if (paramOverrides[node.id]) {
      Object.assign(merged, paramOverrides[node.id]);
    }
    if (Object.keys(merged).length > 0) {
      directByNode[node.id] = merged;
    }
  }

  // 反向拓扑传播：当下游聚合/公式指标接收到行级阈值覆盖时，透传至上游依赖节点
  const outgoingBySource = new Map<string, string[]>();
  for (const node of graph.nodes) {
    outgoingBySource.set(node.id, []);
  }
  for (const edge of graph.edges ?? []) {
    outgoingBySource.get(edge.sourceNodeId)?.push(edge.targetNodeId);
  }

  const effectiveByNode: Record<string, Record<string, unknown>> = {};
  const reverseOrder = [...topologicalOrder].reverse();
  for (const nodeId of reverseOrder) {
    const downstreamIds = outgoingBySource.get(nodeId) ?? [];
    const inheritedFromDownstream: Record<string, unknown> = {};
    const conflictedKeys = new Set<string>();

    for (const dstId of downstreamIds) {
      const dstOverrides = effectiveByNode[dstId];
      if (!dstOverrides) continue;
      for (const [k, v] of Object.entries(dstOverrides)) {
        if (v === undefined || conflictedKeys.has(k)) continue;
        if (!(k in inheritedFromDownstream)) {
          inheritedFromDownstream[k] = v;
        } else if (
          canonicalJsonStringify(inheritedFromDownstream[k]) !== canonicalJsonStringify(v)
        ) {
          delete inheritedFromDownstream[k];
          conflictedKeys.add(k);
        }
      }
    }

    const merged = {
      ...inheritedFromDownstream,
      ...(directByNode[nodeId] ?? {}),
    };
    if (Object.keys(merged).length > 0) {
      effectiveByNode[nodeId] = merged;
    }
  }

  return effectiveByNode;
}

async function resolveOperatorsForMetricGraph(
  graph: MetricGraphDefinition,
  options: {
    runId: string;
    dataSourceId?: string;
    csvDir?: string;
    inputDfDict?: unknown;
    globalParams?: Record<string, unknown>;
    paramOverrides?: Record<string, Record<string, unknown>>;
    providedOperatorResults?: Record<string, MetricOperatorInput>;
  },
  deps: V4RouteDeps,
): Promise<{
  resolvedOperatorResults: Record<string, MetricOperatorInput>;
  nodeOverrides: Record<string, Record<string, unknown>>;
}> {
  const validation = deps.metricGraphStore.validate(graph);
  if (!validation.valid) {
    throw new Error(`指标 DAG 校验未通过: ${validation.errors.join('; ')}`);
  }

  const effectiveCsvDir =
    options.csvDir ?? deps.resolveCsvDir?.(options.runId, options.dataSourceId);
  const resolvedOperatorResults: Record<string, MetricOperatorInput> = {
    ...(options.providedOperatorResults ?? {}),
  };

  const nodeOverrides = resolveMetricGraphNodeOverrides(
    graph,
    validation.topologicalOrder,
    options.paramOverrides,
  );

  // 为所有 from_operator 节点按需自动调用 deps.runOperator（带相同参数去重）
  const callMemo = new Map<string, OperatorNodeExecutionResult>();

  for (const node of graph.nodes) {
    const mode = node.metricConfig?.mode ?? 'from_operator';
    if (mode !== 'from_operator') continue;

    const sourceOpId =
      asNonEmptyString(node.metricConfig?.sourceRef) ??
      asNonEmptyString(node.params?.sourceRef) ??
      node.id;

    // 若调用方已显式提供该算子结果，直接复用
    const hasProvided =
      Boolean(options.providedOperatorResults?.[`__node__:${node.id}`]) ||
      Boolean(options.providedOperatorResults?.[sourceOpId]);
    if (hasProvided) {
      continue;
    }

    const mergedOpParams: Record<string, unknown> = {
      ...(options.globalParams ?? {}),
      ...(graph.globalParams ?? {}),
      ...(node.params ?? {}),
      ...(nodeOverrides[node.id] ?? {}),
    };

    const callKey = `${sourceOpId}::${canonicalJsonStringify(mergedOpParams)}`;
    let opRes = callMemo.get(callKey);
    if (!opRes) {
      const opBody: Record<string, unknown> = {
        operatorId: sourceOpId,
        runId: options.runId,
        ...(options.dataSourceId ? { dataSourceId: options.dataSourceId } : {}),
        ...(effectiveCsvDir ? { csvDir: effectiveCsvDir } : {}),
        ...(options.inputDfDict !== undefined ? { inputDfDict: options.inputDfDict } : {}),
        params: mergedOpParams,
      };
      try {
        opRes = await deps.runOperator(sourceOpId, opBody);
      } catch (err) {
        opRes = {
          nodeId: sourceOpId,
          status: 'unavailable',
          evidenceRefs: [],
          missingDataReason: err instanceof Error ? err.message : String(err),
          cacheKey: '',
          latencyMs: 0,
        };
      }
      callMemo.set(callKey, opRes);
    }

    if (!(sourceOpId in resolvedOperatorResults)) {
      resolvedOperatorResults[sourceOpId] = opRes;
    }
    resolvedOperatorResults[`__node__:${node.id}`] = opRes;
  }

  return { resolvedOperatorResults, nodeOverrides };
}

async function executeMetricGraphWithOperators(
  graph: MetricGraphDefinition,
  options: {
    runId: string;
    dataSourceId?: string;
    csvDir?: string;
    inputDfDict?: unknown;
    targetSide?: string;
    globalParams?: Record<string, unknown>;
    paramOverrides?: Record<string, Record<string, unknown>>;
    providedOperatorResults?: Record<string, MetricOperatorInput>;
  },
  deps: V4RouteDeps,
): Promise<{
  metricResult: MetricGraphExecutionResult;
  operatorResults: Record<string, MetricOperatorInput>;
}> {
  const { resolvedOperatorResults, nodeOverrides } = await resolveOperatorsForMetricGraph(
    graph,
    options,
    deps,
  );

  // 与离线评估完全一致的共享阵营切片管道
  const effectiveOperatorResults = sliceOperatorResultsBySide(
    resolvedOperatorResults,
    options.targetSide,
  );

  const metricResult = await evaluateMetricGraph(graph, effectiveOperatorResults, {
    runId: options.runId,
    cache: deps.cache,
    paramOverrides: nodeOverrides,
    globalParamOverrides: options.globalParams,
  });

  // 过滤内部节点键，保持返回给前端的 operatorResults 干净可读
  const publicOperatorResults: Record<string, MetricOperatorInput> = {};
  for (const [k, v] of Object.entries(effectiveOperatorResults)) {
    if (!k.startsWith('__node__:')) {
      publicOperatorResults[k] = v;
    }
  }

  return {
    metricResult,
    operatorResults: publicOperatorResults,
  };
}

interface PreparedSystemDagContext {
  dag: StoredEvaluationSystemDag;
  runId: string;
  dataSourceId?: string;
  csvDir?: string;
  evalId?: string;
  targetSide?: string;
  globalParams: Record<string, unknown>;
  mergedParamOverrides: Record<string, Record<string, unknown>>;
  providedOpResults?: Record<string, MetricOperatorInput>;
  explicitMetricInputs?: SystemDagEvaluationInputs;
  metricGraph?: MetricGraphDefinition;
  strictWeightValidation: boolean;
}

/**
 * 统一解析三库体系评估与多阵营对比的请求上下文（体系定义、权重归一/校验、参数透传与上游二库指标图）。
 */
function prepareSystemDagContext(
  body: Record<string, unknown>,
  deps: V4RouteDeps,
  options?: {
    urlSystemId?: string;
    requireMetricGraph?: boolean;
  },
):
  | { ok: true; context: PreparedSystemDagContext }
  | { ok: false; status: number; error: string; extra?: Record<string, unknown> } {
  let dag: StoredEvaluationSystemDag | undefined;

  if (asPlainRecord(body.system)) {
    dag = body.system as unknown as StoredEvaluationSystemDag;
  } else if (asPlainRecord(body.dag)) {
    dag = body.dag as unknown as StoredEvaluationSystemDag;
  } else {
    const sysId = asNonEmptyString(options?.urlSystemId) ?? asNonEmptyString(body.systemId);
    if (!sysId) {
      return { ok: false, status: 400, error: '必须提供 system 或 systemId' };
    }
    dag = deps.systemDagStore.get(sysId);
    if (!dag) {
      return { ok: false, status: 404, error: `未找到评估体系 DAG: ${sysId}` };
    }
  }

  if (body.normalizeWeights === true) {
    dag = normalizeIncomingWeights(dag, deps.effectStore);
  }

  const strictWeightValidation = body.strictWeightValidation === true;
  if (strictWeightValidation) {
    const check = validateSystemDag(dag, deps.effectStore);
    if (!check.valid) {
      return {
        ok: false,
        status: 400,
        error: `评估体系 DAG 校验未通过: ${check.errors.join('; ')}`,
        extra: { validation: check },
      };
    }
  }

  const runId = asNonEmptyString(body.runId) ?? 'v4_run_default';
  const dataSourceId = asNonEmptyString(body.dataSourceId);
  const csvDir = asNonEmptyString(body.csvDir);
  const evalId = asNonEmptyString(body.evalId);
  const bodyParams = asPlainRecord(body.params);
  const targetSide =
    asNonEmptyString(body.targetSide) ??
    asNonEmptyString(bodyParams?.targetSide) ??
    asNonEmptyString(dag.globalParams?.targetSide);

  // 从三库效果节点收集行级物理阈值覆盖并向上游透传
  const dagParamOverrides = collectDagParamOverrides(dag, deps.effectStore);
  const explicitParamOverrides = asNestedParamOverrides(body.paramOverrides);
  const mergedParamOverrides = mergeParamMaps(dagParamOverrides, explicitParamOverrides);

  const globalParams: Record<string, unknown> = {
    ...(dag.globalParams ?? {}),
    ...(bodyParams ?? {}),
  };

  const providedOpResults = asPlainRecord(body.operatorResults) as
    | Record<string, MetricOperatorInput>
    | undefined;
  const explicitMetricInputs = asPlainRecord(body.metricInputs) as
    | SystemDagEvaluationInputs
    | undefined;

  let metricGraph: MetricGraphDefinition | undefined;
  if (asPlainRecord(body.metricGraph)) {
    metricGraph = body.metricGraph as unknown as MetricGraphDefinition;
  } else if (asNonEmptyString(body.metricGraphId)) {
    const mgId = asNonEmptyString(body.metricGraphId)!;
    metricGraph = deps.metricGraphStore.get(mgId);
    if (!metricGraph) {
      return { ok: false, status: 404, error: `未找到指标 DAG: ${mgId}` };
    }
  } else if (
    (options?.requireMetricGraph || !explicitMetricInputs) &&
    asNonEmptyString(dag.metricGraphId)
  ) {
    const mgId = asNonEmptyString(dag.metricGraphId)!;
    metricGraph = deps.metricGraphStore.get(mgId);
    if (options?.requireMetricGraph && !metricGraph) {
      return { ok: false, status: 404, error: `未找到指标 DAG: ${mgId}` };
    }
  }

  if (options?.requireMetricGraph && !metricGraph) {
    return {
      ok: false,
      status: 400,
      error: '评估体系未关联有效的上游指标 DAG (metricGraphId)',
    };
  }

  if (metricGraph) {
    const mgValidation = deps.metricGraphStore.validate(metricGraph);
    if (!mgValidation.valid) {
      return {
        ok: false,
        status: 400,
        error: `上游指标 DAG 校验未通过: ${mgValidation.errors.join('; ')}`,
        extra: { validation: mgValidation },
      };
    }
  }

  return {
    ok: true,
    context: {
      dag,
      runId,
      dataSourceId,
      csvDir,
      evalId,
      targetSide,
      globalParams,
      mergedParamOverrides,
      providedOpResults,
      explicitMetricInputs,
      metricGraph,
      strictWeightValidation,
    },
  };
}

/**
 * 合并上游二库指标输入与显式覆写输入，执行三库评估体系 DAG。
 */
function evaluateSystemDagWithInputs(
  dag: StoredEvaluationSystemDag,
  baseMetricInputs: SystemDagEvaluationInputs,
  explicitMetricInputs: SystemDagEvaluationInputs | undefined,
  deps: V4RouteDeps,
  options: {
    evalId?: string;
    runId: string;
    strictWeightValidation: boolean;
  },
): EvaluationDagRunOutput {
  const effectiveMetricInputs: SystemDagEvaluationInputs = explicitMetricInputs
    ? { ...baseMetricInputs, ...explicitMetricInputs }
    : { ...baseMetricInputs };

  return evaluateSystemDag(dag, effectiveMetricInputs, {
    effectStore: deps.effectStore,
    evalId: options.evalId,
    runId: options.runId,
    strictWeightValidation: options.strictWeightValidation,
  });
}

// ──────────────────── V4 REST API 路由总分发器 ────────────────────

export async function handleV4ApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  readJsonBody: (req: IncomingMessage) => Promise<Record<string, unknown>>,
  sendJson: (res: ServerResponse, status: number, payload: unknown) => void,
  deps: V4RouteDeps,
): Promise<boolean> {
  if (!pathname.startsWith('/api/v4')) {
    return false;
  }

  const method = (req.method || 'GET').toUpperCase();

  try {
    // ── 1. 一库算子 & 混合内核算子 DAG ──
    const opStore = deps.v4OperatorStore ?? defaultV4OperatorStore;

    if (method === 'GET' && pathname === '/api/v4/operators') {
      const reqUrl = new URL(req.url || pathname, 'http://127.0.0.1');
      const rawLayer = reqUrl.searchParams.get('layer');
      const domainParam = reqUrl.searchParams.get('domain')?.trim() || undefined;
      const searchParam = reqUrl.searchParams.get('search')?.trim().toLowerCase() || undefined;
      const layerOpt: { layer?: 'fact' | 'all' } | undefined =
        rawLayer === 'all' || rawLayer === 'fact' ? { layer: rawLayer } : undefined;

      let operators: unknown[];
      if (deps.v4OperatorStore) {
        const storedList = deps.v4OperatorStore.list({
          ...(rawLayer === 'fact' ? { layer: 'fact' } : {}),
          ...(domainParam ? { domainTag: domainParam } : {}),
        });
        const filtered = searchParam
          ? storedList.filter(
              (op) =>
                op.id.toLowerCase().includes(searchParam) ||
                op.name.toLowerCase().includes(searchParam) ||
                (op.description ?? '').toLowerCase().includes(searchParam),
            )
          : storedList;
        operators = filtered.map((op) => toV4OperatorSummaryItem(op));
      } else {
        let fallbackList = deps.listOperators(layerOpt);
        if (domainParam || searchParam) {
          fallbackList = fallbackList.filter((item) => {
            const rec = item as Record<string, unknown>;
            if (domainParam && rec.domainTag !== domainParam) return false;
            if (searchParam) {
              const hay = `${String(rec.id ?? '')} ${String(rec.name ?? '')} ${String(rec.description ?? '')}`.toLowerCase();
              if (!hay.includes(searchParam)) return false;
            }
            return true;
          });
        }
        operators = fallbackList;
      }

      sendJson(res, 200, {
        ok: true,
        operators,
        components: deps.listComponents?.() ?? [],
      });
      return true;
    }

    if (method === 'POST' && pathname === '/api/v4/operators/run') {
      const body = await readJsonBody(req);
      const operatorId = asNonEmptyString(body.operatorId);
      if (!operatorId) {
        sendError(sendJson, res, 400, '缺少必填参数 operatorId');
        return true;
      }
      const runId = asNonEmptyString(body.runId) ?? 'default_v4_run';
      const dataSourceId = asNonEmptyString(body.dataSourceId);
      const csvDir =
        asNonEmptyString(body.csvDir) ?? deps.resolveCsvDir?.(runId, dataSourceId);

      // 若注入了 V4OperatorStore 且命中自定义或已覆写算子，直接按库中最新定义执行
      const storedSpec = deps.v4OperatorStore?.get(operatorId);
      let result: OperatorNodeExecutionResult;
      if (storedSpec && deps.v4OperatorStore) {
        const rawParams = asPlainRecord(body.params);
        const inputDfDict = asPlainRecord(body.inputDfDict) as
          | Record<string, PythonTableInput>
          | undefined;
        result = await runV4Operator(storedSpec, deps.v4OperatorStore.list(), {
          runId,
          ...(csvDir ? { csvDir } : {}),
          ...(inputDfDict ? { inputDfDict } : {}),
          ...(rawParams ? { paramOverrides: rawParams } : {}),
          cache: deps.cache,
        });
      } else {
        result = await deps.runOperator(operatorId, {
          ...body,
          operatorId,
          ...(csvDir ? { csvDir } : {}),
        });
      }
      sendJson(res, 200, { ok: true, result });
      return true;
    }

    if (method === 'POST' && pathname === '/api/v4/operators/reset-all-overrides') {
      const resetCount = opStore.seedBuiltins();
      sendJson(res, 200, { ok: true, resetCount });
      return true;
    }

    if (method === 'POST' && pathname === '/api/v4/operators') {
      const body = await readJsonBody(req);
      const rawSpec = asPlainRecord(body.operator) ?? body;
      const check = validateV4OperatorSpecInput(rawSpec);
      if (!check.valid || !check.spec) {
        sendError(sendJson, res, 400, `V4 算子定义校验失败: ${check.errors.join('; ')}`, {
          errors: check.errors,
        });
        return true;
      }
      const saved = opStore.upsert(check.spec, false);
      sendJson(res, 200, { ok: true, operator: toV4OperatorSummaryItem(saved) });
      return true;
    }

    const opOverrideMatch = pathname.match(/^\/api\/v4\/operators\/([^/]+)\/override$/);
    if (method === 'DELETE' && opOverrideMatch) {
      const operatorId = decodeURIComponent(opOverrideMatch[1]);
      try {
        const restored = opStore.resetOverride(operatorId);
        sendJson(res, 200, {
          ok: true,
          operatorId,
          operator: toV4OperatorSummaryItem(restored),
        });
      } catch (err) {
        sendError(sendJson, res, 404, err instanceof Error ? err.message : String(err));
      }
      return true;
    }

    const opIdMatch = pathname.match(/^\/api\/v4\/operators\/([^/]+)$/);
    if (opIdMatch) {
      const operatorId = decodeURIComponent(opIdMatch[1]);
      if (method === 'GET') {
        const found = opStore.get(operatorId);
        if (!found) {
          sendError(sendJson, res, 404, `未找到 V4 算子: ${operatorId}`);
          return true;
        }
        sendJson(res, 200, { ok: true, operator: toV4OperatorSummaryItem(found) });
        return true;
      }
      if (method === 'PUT') {
        const body = await readJsonBody(req);
        const patch = (asPlainRecord(body.operator) ?? body) as Partial<V4StoredOperator>;
        if (typeof patch.pythonCode === 'string') {
          for (const pat of UNSAFE_PYTHON_PATTERNS) {
            if (pat.test(patch.pythonCode)) {
              sendError(sendJson, res, 400, `pythonCode 包含受限危险调用: ${pat.source}`);
              return true;
            }
          }
        }
        try {
          const updated = opStore.update(operatorId, patch);
          sendJson(res, 200, { ok: true, operator: toV4OperatorSummaryItem(updated) });
        } catch (err) {
          sendError(sendJson, res, 404, err instanceof Error ? err.message : String(err));
        }
        return true;
      }
      if (method === 'DELETE') {
        try {
          const deleted = opStore.delete(operatorId);
          if (!deleted) {
            sendError(sendJson, res, 404, `未找到自定义 V4 算子: ${operatorId}`);
            return true;
          }
          sendJson(res, 200, { ok: true, operatorId, deleted: true });
        } catch (err) {
          sendError(sendJson, res, 403, err instanceof Error ? err.message : String(err));
        }
        return true;
      }
    }

    if (method === 'POST' && pathname === '/api/v4/operator-graphs/execute') {
      const body = await readJsonBody(req);
      const rawGraph = asPlainRecord(body.graph);
      if (!rawGraph || !Array.isArray(rawGraph.nodes)) {
        sendError(sendJson, res, 400, '缺少必填参数 graph（需包含 nodes 数组）');
        return true;
      }

      const rawEdges = Array.isArray(rawGraph.edges) ? rawGraph.edges : [];
      const graphId = asNonEmptyString(rawGraph.graphId) ?? 'op_dag_inline';
      const graphKind = asNonEmptyString(rawGraph.graphKind) ?? 'operator';
      if (graphKind !== 'operator') {
        sendError(sendJson, res, 400, `operator-graphs/execute 仅支持 graphKind === 'operator'`);
        return true;
      }

      const cycleCheck = detectCycles(
        rawGraph.nodes as OperatorDagNode[],
        rawEdges as DagGraphDefinition['edges'],
      );
      if (cycleCheck.hasCycle || cycleCheck.missingEdgeRefs.length > 0) {
        sendError(sendJson, res, 400, '算子 DAG 拓扑校验失败', {
          cycleCheck,
        });
        return true;
      }

      const runId = asNonEmptyString(body.runId) ?? 'v4_op_run_default';
      const dataSourceId = asNonEmptyString(body.dataSourceId);
      const csvDir =
        asNonEmptyString(body.csvDir) ?? deps.resolveCsvDir?.(runId, dataSourceId);
      const inputDfDict = asPlainRecord(body.inputDfDict) as
        | Record<string, PythonTableInput>
        | undefined;
      const globalParamOverrides = asPlainRecord(body.params);
      const paramOverrides = asNestedParamOverrides(body.paramOverrides);

      // 注入数据源上下文指纹，避免相同 runId 切换 csvDir 或 inputDfDict 时误命中旧缓存
      const sourceContextDigest = crypto
        .createHash('sha256')
        .update(
          canonicalJsonStringify({
            csvDir: csvDir ?? null,
            inputDfDict: inputDfDict ?? null,
          }),
          'utf8',
        )
        .digest('hex')
        .slice(0, 16);

      const runtimeGraph: DagGraphDefinition<OperatorDagNode> = {
        graphId,
        name: asNonEmptyString(rawGraph.name) ?? graphId,
        graphKind: 'operator',
        nodes: (rawGraph.nodes as OperatorDagNode[]).map((node) => ({
          ...node,
          _sourceContextDigest: sourceContextDigest,
        })) as OperatorDagNode[],
        edges: rawEdges as DagGraphDefinition['edges'],
        ...(asPlainRecord(rawGraph.globalParams)
          ? { globalParams: asPlainRecord(rawGraph.globalParams) }
          : {}),
      };

      const execResult = await executeDagGraph<OperatorDagNode>(runtimeGraph, {
        runId,
        cache: deps.cache,
        paramOverrides,
        globalParamOverrides,
        executor: async (nodeCtx): Promise<DagNodeExecutionOutput> => {
          const { node, resolvedParams, upstreamResults, upstreamEdges } = nodeCtx;

          const upstreamDatasets: TableDataset[] = [];
          const upstreamEvidenceGroups: EvidenceRef[][] = [];
          for (const edge of upstreamEdges) {
            const srcRes = upstreamResults[edge.sourceNodeId];
            if (!srcRes) continue;
            if (srcRes.dataset) {
              upstreamDatasets.push(srcRes.dataset);
            }
            if (srcRes.evidenceRefs?.length) {
              upstreamEvidenceGroups.push(srcRes.evidenceRefs);
            }
          }
          const upstreamDataset = mergeTableDatasets(upstreamDatasets);
          const upstreamEvidence = mergeEvidenceRefLists(upstreamEvidenceGroups);

          switch (node.kind) {
            case 'data_input': {
              const csvTable =
                asNonEmptyString(resolvedParams.csvTable) ??
                asNonEmptyString(resolvedParams.tableName) ??
                asNonEmptyString(node.refId);
              if (!csvTable) {
                return {
                  status: 'unavailable',
                  evidenceRefs: [],
                  missingDataReason: `data_input 节点 "${node.id}" 未配置 csvTable 表名`,
                };
              }
              const loaded = loadTableForDataInput(csvTable, {
                csvDir,
                inputDfDict,
                filterField: asNonEmptyString(resolvedParams.filterField),
                filterEquals:
                  resolvedParams.filterEquals !== undefined
                    ? String(resolvedParams.filterEquals)
                    : undefined,
                maxRows: toFiniteNumber(resolvedParams.maxRows) ?? undefined,
              });
              if (!loaded.ok) {
                return {
                  status: 'unavailable',
                  evidenceRefs: [],
                  missingDataReason: loaded.reason,
                };
              }
              return {
                status: 'valid',
                dataset: loaded.dataset,
                evidenceRefs: [loaded.evidenceRef],
              };
            }

            case 'inline_calc': {
              if (!upstreamDataset) {
                return {
                  status: 'unavailable',
                  evidenceRefs: upstreamEvidence,
                  missingDataReason: `inline_calc 节点 "${node.id}" 缺少上游输入数据集`,
                };
              }
              const formulaNested = asPlainRecord(resolvedParams.formulaConfig);
              const rawDerived = Array.isArray(resolvedParams.derivedColumns)
                ? resolvedParams.derivedColumns
                : Array.isArray(formulaNested?.derivedColumns)
                ? formulaNested.derivedColumns
                : [];
              const derivedColumns: DerivedColumnConfig[] = rawDerived.map((item) => {
                const rec = asPlainRecord(item) ?? {};
                const colName = String(rec.columnName ?? rec.name ?? '');
                return {
                  ...(typeof rec.id === 'string' ? { id: rec.id } : {}),
                  columnName: colName,
                  name: colName,
                  dataType:
                    rec.dataType === 'number' ||
                    rec.dataType === 'string' ||
                    rec.dataType === 'boolean' ||
                    rec.dataType === 'datetime'
                      ? rec.dataType
                      : undefined,
                  expression: String(rec.expression ?? ''),
                  ...(typeof rec.overwriteColumn === 'string'
                    ? { overwriteColumn: rec.overwriteColumn }
                    : {}),
                  ...(typeof rec.description === 'string'
                    ? { description: rec.description }
                    : {}),
                };
              });

              try {
                const outDataset = evaluateFormulaDataset(upstreamDataset, {
                  derivedColumns,
                  upstreamColumns: upstreamDataset.columns,
                });
                return {
                  status: 'valid',
                  dataset: outDataset,
                  evidenceRefs: upstreamEvidence,
                };
              } catch (err) {
                return {
                  status: 'unavailable',
                  evidenceRefs: upstreamEvidence,
                  missingDataReason:
                    err instanceof Error ? err.message : String(err),
                };
              }
            }

            case 'group_agg': {
              if (!upstreamDataset) {
                return {
                  status: 'unavailable',
                  evidenceRefs: upstreamEvidence,
                  missingDataReason: `group_agg 节点 "${node.id}" 缺少上游输入数据集`,
                };
              }
              const aggNested = asPlainRecord(resolvedParams.aggregationConfig);
              const rawGroupKeys = Array.isArray(resolvedParams.groupKeys)
                ? resolvedParams.groupKeys
                : Array.isArray(resolvedParams.groupBy)
                ? resolvedParams.groupBy
                : Array.isArray(aggNested?.groupKeys)
                ? aggNested.groupKeys
                : [];
              const groupKeys = rawGroupKeys.map((k) => String(k));

              const rawMetrics = Array.isArray(resolvedParams.metrics)
                ? resolvedParams.metrics
                : Array.isArray(resolvedParams.aggregations)
                ? resolvedParams.aggregations
                : Array.isArray(aggNested?.metrics)
                ? aggNested.metrics
                : [];

              const metrics: AggregationMetricItem[] = rawMetrics.map((item) => {
                const rec = asPlainRecord(item) ?? {};
                return {
                  ...(typeof rec.id === 'string' ? { id: rec.id } : {}),
                  targetField: String(rec.targetField ?? rec.outputField ?? ''),
                  sourceColumn: String(rec.sourceColumn ?? rec.sourceField ?? ''),
                  method: (typeof rec.method === 'string'
                    ? rec.method
                    : 'AVERAGE') as AggregationMetricItem['method'],
                  ...(rec.dataType ? { dataType: rec.dataType as FieldDataType } : {}),
                  ...(typeof rec.description === 'string'
                    ? { description: rec.description }
                    : {}),
                };
              });

              const aggConfig: AggregationOperatorConfig = { groupKeys, metrics };
              const availableCols = (upstreamDataset.columns ?? []).map((c) => c.name);
              const valErrs = validateAggregationConfig(aggConfig, availableCols);
              if (valErrs.length > 0) {
                return {
                  status: 'unavailable',
                  evidenceRefs: upstreamEvidence,
                  missingDataReason: `分组聚合参数校验失败: ${valErrs.join('; ')}`,
                };
              }

              try {
                const outDataset = evaluateAggregationDataset(upstreamDataset, aggConfig);
                return {
                  status: 'valid',
                  dataset: outDataset,
                  evidenceRefs: upstreamEvidence,
                };
              } catch (err) {
                return {
                  status: 'unavailable',
                  evidenceRefs: upstreamEvidence,
                  missingDataReason:
                    err instanceof Error ? err.message : String(err),
                };
              }
            }

            case 'spatial': {
              return executeSpatialNode(
                node,
                resolvedParams,
                upstreamDataset,
                upstreamEvidence,
                { runId, dataSourceId, csvDir, inputDfDict },
                deps,
              );
            }

            case 'fact_operator': {
              const operatorId =
                asNonEmptyString(resolvedParams.operatorId) ??
                asNonEmptyString(node.refId) ??
                node.id;
              try {
                const opRes = await deps.runOperator(operatorId, {
                  operatorId,
                  runId,
                  ...(dataSourceId ? { dataSourceId } : {}),
                  ...(csvDir ? { csvDir } : {}),
                  ...(inputDfDict !== undefined ? { inputDfDict } : {}),
                  ...(upstreamDataset !== undefined ? { prevOutputDf: upstreamDataset } : {}),
                  params: resolvedParams,
                });
                return {
                  status: opRes.status,
                  ...(opRes.dataset !== undefined ? { dataset: opRes.dataset } : {}),
                  evidenceRefs: opRes.evidenceRefs ?? [],
                  ...(opRes.missingDataReason !== undefined
                    ? { missingDataReason: opRes.missingDataReason }
                    : {}),
                };
              } catch (err) {
                return {
                  status: 'unavailable',
                  evidenceRefs: upstreamEvidence,
                  missingDataReason:
                    err instanceof Error ? err.message : String(err),
                };
              }
            }

            case 'python_script': {
              const pythonCode =
                asNonEmptyString(resolvedParams.pythonCode) ??
                asNonEmptyString(resolvedParams.code);
              if (!pythonCode) {
                return {
                  status: 'unavailable',
                  evidenceRefs: upstreamEvidence,
                  missingDataReason: `python_script 节点 "${node.id}" 未提供 pythonCode`,
                };
              }
              try {
                const pyRes = await executePythonScript({
                  code: pythonCode,
                  ...(csvDir ? { csvDir } : {}),
                  ...(inputDfDict !== undefined ? { inputDfDict } : {}),
                  ...(upstreamDataset !== undefined ? { prevOutputDf: upstreamDataset } : {}),
                  params: resolvedParams,
                  ...(typeof resolvedParams.timeoutMs === 'number'
                    ? { timeoutMs: resolvedParams.timeoutMs }
                    : {}),
                });
                if (!pyRes.success) {
                  return {
                    status: 'unavailable',
                    evidenceRefs: upstreamEvidence,
                    missingDataReason: pyRes.error ?? 'Python 脚本执行失败',
                  };
                }
                return {
                  status: 'valid',
                  ...(pyRes.dataset !== undefined ? { dataset: pyRes.dataset } : {}),
                  evidenceRefs: mergeEvidenceRefLists([
                    upstreamEvidence,
                    [
                      {
                        source: 'csv',
                        ref: `python:${node.id}`,
                        scenarioClock: '00:00:00',
                        description: `自定义 Python 节点执行完成 (${pyRes.dataset?.rows.length ?? 0} 行)`,
                      },
                    ],
                  ]),
                };
              } catch (err) {
                return {
                  status: 'unavailable',
                  evidenceRefs: upstreamEvidence,
                  missingDataReason:
                    err instanceof Error ? err.message : String(err),
                };
              }
            }

            default:
              return {
                status: 'unavailable',
                evidenceRefs: upstreamEvidence,
                missingDataReason: `不支持的算子 DAG 节点类型: ${node.kind}`,
              };
          }
        },
      });

      sendJson(res, 200, {
        ok: true,
        graphId: execResult.graphId,
        runId: execResult.runId,
        topologicalOrder: execResult.topologicalOrder,
        nodeResults: execResult.nodeResults,
        cacheHits: execResult.cacheHits,
        cacheMisses: execResult.cacheMisses,
        totalLatencyMs: execResult.totalLatencyMs,
      });
      return true;
    }

    // ── 2. 独立效果组件库 (EffectStore) ──
    if (method === 'GET' && pathname === '/api/v4/effects') {
      sendJson(res, 200, { ok: true, effects: deps.effectStore.listAll() });
      return true;
    }

    if (method === 'POST' && pathname === '/api/v4/effects/preview-curve') {
      const body = await readJsonBody(req);
      const scoringRule = (asPlainRecord(body.scoringRule) ??
        asPlainRecord(body.scoring)) as unknown as ScoringRule | undefined;
      if (!scoringRule || !scoringRule.type) {
        sendError(sendJson, res, 400, '缺少必填参数 scoringRule（或 scoring）');
        return true;
      }
      const rawSamples = Number(body.samples);
      const samples =
        Number.isFinite(rawSamples) && rawSamples >= 2
          ? Math.min(200, Math.floor(rawSamples))
          : 40;
      const points = sampleScoringCurve(scoringRule, samples);
      sendJson(res, 200, { ok: true, points });
      return true;
    }

    const effectIdMatch = pathname.match(/^\/api\/v4\/effects\/([^/]+)$/);
    if (effectIdMatch) {
      const effectId = decodeURIComponent(effectIdMatch[1]);
      if (method === 'GET') {
        const effect = deps.effectStore.get(effectId);
        if (!effect) {
          sendError(sendJson, res, 404, `未找到效果定义: ${effectId}`);
          return true;
        }
        sendJson(res, 200, { ok: true, effect });
        return true;
      }
      if (method === 'DELETE') {
        try {
          const deleted = deps.effectStore.deleteCustom(effectId);
          if (!deleted) {
            sendError(sendJson, res, 404, `未找到自定义效果定义: ${effectId}`);
            return true;
          }
          sendJson(res, 200, { ok: true, effectId, deleted: true });
        } catch (err) {
          sendError(
            sendJson,
            res,
            403,
            err instanceof Error ? err.message : String(err),
          );
        }
        return true;
      }
    }

    if (method === 'POST' && pathname === '/api/v4/effects') {
      const body = await readJsonBody(req);
      const def = (asPlainRecord(body.effect) ?? body) as unknown as EffectDefinition;
      const validation = deps.effectStore.validateEffect(def);
      if (!validation.valid) {
        sendError(sendJson, res, 400, `效果定义校验失败: ${validation.errors.join('; ')}`, {
          errors: validation.errors,
        });
        return true;
      }
      const saved = deps.effectStore.upsertCustom(def);
      sendJson(res, 200, { ok: true, effect: saved });
      return true;
    }

    // ── 3. 二库指标 DAG (MetricGraphStore & 执行) ──
    if (method === 'GET' && pathname === '/api/v4/metric-graphs') {
      sendJson(res, 200, { ok: true, graphs: deps.metricGraphStore.listAll() });
      return true;
    }

    if (method === 'POST' && pathname === '/api/v4/metric-graphs/execute') {
      const body = await readJsonBody(req);
      let graph: MetricGraphDefinition | undefined;
      if (asPlainRecord(body.graph)) {
        graph = body.graph as unknown as MetricGraphDefinition;
      } else if (asNonEmptyString(body.graphId)) {
        const graphId = asNonEmptyString(body.graphId)!;
        graph = deps.metricGraphStore.get(graphId);
        if (!graph) {
          sendError(sendJson, res, 404, `未找到指标 DAG: ${graphId}`);
          return true;
        }
      } else {
        sendError(sendJson, res, 400, '必须提供 graph 或 graphId');
        return true;
      }

      const validation = deps.metricGraphStore.validate(graph);
      if (!validation.valid) {
        sendError(sendJson, res, 400, `指标 DAG 校验未通过: ${validation.errors.join('; ')}`, {
          validation,
        });
        return true;
      }

      const runId = asNonEmptyString(body.runId) ?? 'v4_run_default';
      const dataSourceId = asNonEmptyString(body.dataSourceId);
      const csvDir = asNonEmptyString(body.csvDir);
      const providedOpResults = asPlainRecord(body.operatorResults) as
        | Record<string, MetricOperatorInput>
        | undefined;
      const paramOverrides = asNestedParamOverrides(body.paramOverrides);
      const globalParams = asPlainRecord(body.params);
      const targetSide =
        asNonEmptyString(body.targetSide) ??
        asNonEmptyString(globalParams?.targetSide);

      const { metricResult, operatorResults } = await executeMetricGraphWithOperators(
        graph,
        {
          runId,
          dataSourceId,
          csvDir,
          inputDfDict: body.inputDfDict,
          targetSide,
          globalParams,
          paramOverrides,
          providedOperatorResults: providedOpResults,
        },
        deps,
      );

      sendJson(res, 200, {
        ok: true,
        graphId: graph.graphId,
        runId,
        ...(targetSide ? { targetSide } : {}),
        execution: metricResult,
        nodeResults: metricResult.nodeResults,
        topologicalOrder: metricResult.topologicalOrder,
        metricInputsForSystem: metricResult.metricInputsForSystem,
        metricNodeIdByMetricId: metricResult.metricNodeIdByMetricId,
        operatorResults,
        cacheHits: metricResult.cacheHits,
        cacheMisses: metricResult.cacheMisses,
        totalLatencyMs: metricResult.totalLatencyMs,
      });
      return true;
    }

    const compareSidesMatch = pathname.match(/^\/api\/v4\/metric-graphs\/([^/]+)\/compare-sides$/);
    if (method === 'POST' && compareSidesMatch) {
      const graphId = decodeURIComponent(compareSidesMatch[1]);
      const body = await readJsonBody(req);
      let graph: MetricGraphDefinition | undefined;
      if (asPlainRecord(body.graph)) {
        graph = body.graph as unknown as MetricGraphDefinition;
      } else {
        graph = deps.metricGraphStore.get(graphId);
        if (!graph) {
          sendError(sendJson, res, 404, `未找到指标 DAG: ${graphId}`);
          return true;
        }
      }

      const validation = deps.metricGraphStore.validate(graph);
      if (!validation.valid) {
        sendError(sendJson, res, 400, `指标 DAG 校验未通过: ${validation.errors.join('; ')}`, {
          validation,
        });
        return true;
      }

      const runId = asNonEmptyString(body.runId) ?? 'v4_run_default';
      const dataSourceId = asNonEmptyString(body.dataSourceId);
      const csvDir = asNonEmptyString(body.csvDir);
      const providedOpResults = asPlainRecord(body.operatorResults) as
        | Record<string, MetricOperatorInput>
        | undefined;
      const paramOverrides = asNestedParamOverrides(body.paramOverrides);
      const globalParams = asPlainRecord(body.params);

      const { resolvedOperatorResults, nodeOverrides } = await resolveOperatorsForMetricGraph(
        graph,
        {
          runId,
          dataSourceId,
          csvDir,
          inputDfDict: body.inputDfDict,
          globalParams,
          paramOverrides,
          providedOperatorResults: providedOpResults,
        },
        deps,
      );

      const sides = discoverSidesFromOperatorResults(resolvedOperatorResults);
      const overall = await evaluateMetricGraph(graph, resolvedOperatorResults, {
        runId,
        cache: deps.cache,
        paramOverrides: nodeOverrides,
        globalParamOverrides: globalParams,
      });

      const bySide: Record<string, MetricGraphExecutionResult> = {};
      for (const side of sides) {
        const slicedOpResults = sliceOperatorResultsBySide(resolvedOperatorResults, side);
        bySide[side] = await evaluateMetricGraph(graph, slicedOpResults, {
          runId,
          cache: deps.cache,
          paramOverrides: nodeOverrides,
          globalParamOverrides: globalParams,
        });
      }

      sendJson(res, 200, {
        ok: true,
        graphId: asNonEmptyString(graph.graphId) ?? graphId,
        runId,
        sides,
        overall,
        bySide,
      });
      return true;
    }

    const metricGraphIdMatch = pathname.match(/^\/api\/v4\/metric-graphs\/([^/]+)$/);
    if (metricGraphIdMatch) {
      const graphId = decodeURIComponent(metricGraphIdMatch[1]);
      if (method === 'GET') {
        const graph = deps.metricGraphStore.get(graphId);
        if (!graph) {
          sendError(sendJson, res, 404, `未找到指标 DAG: ${graphId}`);
          return true;
        }
        sendJson(res, 200, { ok: true, graph });
        return true;
      }
      if (method === 'DELETE') {
        try {
          const deleted = deps.metricGraphStore.delete(graphId);
          if (!deleted) {
            sendError(sendJson, res, 404, `未找到指标 DAG: ${graphId}`);
            return true;
          }
          sendJson(res, 200, { ok: true, graphId, deleted: true });
        } catch (err) {
          sendError(
            sendJson,
            res,
            403,
            err instanceof Error ? err.message : String(err),
          );
        }
        return true;
      }
    }

    if (method === 'POST' && pathname === '/api/v4/metric-graphs') {
      const body = await readJsonBody(req);
      const graph = (asPlainRecord(body.graph) ?? body) as unknown as MetricGraphDefinition;
      const validation = deps.metricGraphStore.validate(graph);
      if (!validation.valid) {
        sendError(sendJson, res, 400, `指标 DAG 校验未通过: ${validation.errors.join('; ')}`, {
          validation,
        });
        return true;
      }
      const saved = deps.metricGraphStore.upsert(graph);
      sendJson(res, 200, { ok: true, graph: saved, validation });
      return true;
    }

    // ── 4. 三库评估体系 DAG (SystemDagStore & 全链路评估) ──
    if (method === 'GET' && pathname === '/api/v4/system-dags') {
      sendJson(res, 200, { ok: true, systems: deps.systemDagStore.listAll() });
      return true;
    }

    if (method === 'POST' && pathname === '/api/v4/system-dags/validate') {
      const body = await readJsonBody(req);
      let dag: EvaluationSystemDag | undefined;
      if (asPlainRecord(body.system)) {
        dag = body.system as unknown as EvaluationSystemDag;
      } else if (asPlainRecord(body.dag)) {
        dag = body.dag as unknown as EvaluationSystemDag;
      } else if (asNonEmptyString(body.systemId) && !Array.isArray(body.nodes)) {
        const sysId = asNonEmptyString(body.systemId)!;
        dag = deps.systemDagStore.get(sysId);
        if (!dag) {
          sendError(sendJson, res, 404, `未找到评估体系 DAG: ${sysId}`);
          return true;
        }
      } else if (Array.isArray(body.nodes) || asNonEmptyString(body.systemId)) {
        dag = body as unknown as EvaluationSystemDag;
      } else {
        sendError(sendJson, res, 400, '必须提供 system、dag 或 systemId');
        return true;
      }

      const normalizedSystem =
        body.normalizeWeights === true
          ? normalizeIncomingWeights(dag, deps.effectStore)
          : undefined;
      const targetDag = normalizedSystem ?? dag;
      const validation = validateSystemDag(targetDag, deps.effectStore);

      sendJson(res, 200, {
        ok: true,
        ...validation,
        ...(normalizedSystem ? { normalizedSystem } : {}),
      });
      return true;
    }

    if (method === 'POST' && pathname === '/api/v4/system-dags/evaluate') {
      const body = await readJsonBody(req);
      const prepared = prepareSystemDagContext(body, deps);
      if (!prepared.ok) {
        sendError(sendJson, res, prepared.status, prepared.error, prepared.extra);
        return true;
      }

      const ctx = prepared.context;
      let metricGraphResult: MetricGraphExecutionResult | null = null;
      let operatorResults: Record<string, MetricOperatorInput> | null = null;
      let baseMetricInputs: SystemDagEvaluationInputs = {};

      if (ctx.metricGraph) {
        const upstreamExec = await executeMetricGraphWithOperators(
          ctx.metricGraph,
          {
            runId: ctx.runId,
            dataSourceId: ctx.dataSourceId,
            csvDir: ctx.csvDir,
            inputDfDict: body.inputDfDict,
            targetSide: ctx.targetSide,
            globalParams: ctx.globalParams,
            paramOverrides: ctx.mergedParamOverrides,
            providedOperatorResults: ctx.providedOpResults,
          },
          deps,
        );
        metricGraphResult = upstreamExec.metricResult;
        operatorResults = upstreamExec.operatorResults;
        baseMetricInputs = metricGraphResult.metricInputsForSystem;
      }

      let evalOutput: EvaluationDagRunOutput;
      try {
        evalOutput = evaluateSystemDagWithInputs(
          ctx.dag,
          baseMetricInputs,
          ctx.explicitMetricInputs,
          deps,
          {
            evalId: ctx.evalId,
            runId: ctx.runId,
            strictWeightValidation: ctx.strictWeightValidation,
          },
        );
      } catch (err) {
        sendError(
          sendJson,
          res,
          400,
          err instanceof Error ? err.message : String(err),
        );
        return true;
      }

      sendJson(res, 200, {
        ok: true,
        ...(ctx.targetSide ? { targetSide: ctx.targetSide } : {}),
        evaluation: evalOutput,
        ...evalOutput,
        metricGraphResult,
        operatorResults,
      });
      return true;
    }

const MAX_V4_METRIC_SNAPSHOT_ROWS = 200;

function buildV4MetricSnapshots(
  dag: EvaluationSystemDag,
  overallMetricResult: MetricGraphExecutionResult,
  sideMetricResults: Record<string, MetricGraphExecutionResult>,
  overallEval: EvaluationDagOutput,
  bySideEval: Record<string, EvaluationDagOutput>,
  sides: string[],
  effectStore: EffectStore,
  maxRows = MAX_V4_METRIC_SNAPSHOT_ROWS,
): V4MetricSnapshotItem[] {
  const nodeMap = new Map(dag.nodes.map((n) => [n.id, n]));
  const snapshots: V4MetricSnapshotItem[] = [];

  for (const node of dag.nodes) {
    if (node.kind !== 'metric_proxy' && node.kind !== 'metric') continue;
    const paramMetricId =
      typeof node.params?.metricId === 'string' ? node.params.metricId.trim() : '';
    const metricId = (node.refId?.trim() || paramMetricId || node.id).trim();
    if (!metricId) continue;

    const outgoingEdge = dag.edges.find((e) => e.sourceNodeId === node.id);
    const parentNode = outgoingEdge ? nodeMap.get(outgoingEdge.targetNodeId) : undefined;
    const parentEffectDef =
      parentNode?.inlineEffect ??
      (parentNode?.refId ? effectStore.get(parentNode.refId) : undefined);

    const parentEffectId = parentNode?.id;
    const parentEffectLabel =
      parentNode?.label ||
      parentEffectDef?.name ||
      (parentEffectId ? overallEval.nodeResults?.[parentEffectId]?.label : undefined);
    const targetField =
      parentEffectDef?.metricBinding?.targetField ??
      (typeof node.params?.targetField === 'string' ? node.params.targetField : undefined);
    const reduce =
      parentEffectDef?.metricBinding?.reduce ??
      (typeof node.params?.reduce === 'string' ? node.params.reduce : undefined);

    const toSlice = (
      metricResult: MetricGraphExecutionResult | undefined,
      evalOutput: EvaluationDagOutput | undefined,
    ): V4MetricTableSlice => {
      const metricInput =
        metricResult?.metricInputsForSystem?.[metricId] ??
        metricResult?.metricInputsForSystem?.[node.id];
      const rawRows = Array.isArray(metricInput?.dataset?.rows)
        ? metricInput!.dataset!.rows
        : [];
      const schemaCols =
        metricInput?.dataset?.columns ?? metricInput?.dataset?.schema ?? [];
      let columns: Array<{ name: string; displayName?: string; type?: string }> =
        schemaCols.map((c) => ({
          name: c.name,
          ...(c.displayName ? { displayName: c.displayName } : {}),
          ...(c.type ? { type: c.type } : {}),
        }));
      if (columns.length === 0 && rawRows.length > 0) {
        columns = Object.keys(rawRows[0]).map((name) => ({ name }));
      }

      const rawScalar = metricInput?.value;
      let value: number | boolean | null | undefined =
        typeof rawScalar === 'number' || typeof rawScalar === 'boolean'
          ? rawScalar
          : undefined;
      if (value === undefined && parentEffectId) {
        const parentRaw = evalOutput?.nodeResults?.[parentEffectId]?.rawValue;
        if (typeof parentRaw === 'number' || typeof parentRaw === 'boolean') {
          value = parentRaw;
        }
      }
      if (value === undefined) {
        const nodeRaw = evalOutput?.nodeResults?.[node.id]?.rawValue;
        if (typeof nodeRaw === 'number' || typeof nodeRaw === 'boolean') {
          value = nodeRaw;
        }
      }

      return {
        status: metricInput?.status ?? 'unavailable',
        ...(value !== undefined ? { value } : {}),
        columns,
        rows: rawRows.slice(0, maxRows),
        totalRows: rawRows.length,
        truncated: rawRows.length > maxRows,
        ...(metricInput?.missingDataReason
          ? { missingDataReason: metricInput.missingDataReason }
          : {}),
      };
    };

    const bySide: Record<string, V4MetricTableSlice> = {};
    for (const side of sides) {
      bySide[side] = toSlice(sideMetricResults[side], bySideEval[side]);
    }

    snapshots.push({
      metricId,
      proxyNodeId: node.id,
      label: node.label || metricId,
      ...(parentEffectId ? { parentEffectId } : {}),
      ...(parentEffectLabel ? { parentEffectLabel } : {}),
      ...(targetField ? { targetField } : {}),
      ...(reduce ? { reduce } : {}),
      overall: toSlice(overallMetricResult, overallEval),
      bySide,
    });
  }

  return snapshots;
}

    const systemCompareSidesMatch = pathname.match(
      /^\/api\/v4\/system-dags\/([^/]+)\/compare-sides$/,
    );
    if (method === 'POST' && systemCompareSidesMatch) {
      const systemId = decodeURIComponent(systemCompareSidesMatch[1]);
      const body = await readJsonBody(req);
      const prepared = prepareSystemDagContext(body, deps, {
        urlSystemId: systemId,
        requireMetricGraph: true,
      });
      if (!prepared.ok) {
        sendError(sendJson, res, prepared.status, prepared.error, prepared.extra);
        return true;
      }

      const ctx = prepared.context;
      const rawMetricGraph = ctx.metricGraph!;
      // 多阵营对比必须跑全量数据，剔除可能残留于 system.globalParams / paramOverrides / metricGraph.globalParams 的单阵营 targetSide
      const { targetSide: _ignoredSide, ...compareGlobalParams } = ctx.globalParams;
      const compareParamOverrides: Record<string, Record<string, unknown>> = {};
      for (const [k, v] of Object.entries(ctx.mergedParamOverrides)) {
        const { targetSide: _ignoredNodeSide, ...rest } = v;
        if (Object.keys(rest).length > 0) {
          compareParamOverrides[k] = rest;
        }
      }
      const metricGraph =
        rawMetricGraph.globalParams && 'targetSide' in rawMetricGraph.globalParams
          ? {
              ...rawMetricGraph,
              globalParams: (({ targetSide: _ignoredMgSide, ...rest }) => rest)(
                rawMetricGraph.globalParams,
              ),
            }
          : rawMetricGraph;

      const { resolvedOperatorResults, nodeOverrides } = await resolveOperatorsForMetricGraph(
        metricGraph,
        {
          runId: ctx.runId,
          dataSourceId: ctx.dataSourceId,
          csvDir: ctx.csvDir,
          inputDfDict: body.inputDfDict,
          globalParams: compareGlobalParams,
          paramOverrides: compareParamOverrides,
          providedOperatorResults: ctx.providedOpResults,
        },
        deps,
      );

      const sides = discoverSidesFromOperatorResults(resolvedOperatorResults);

      const overallMetricResult = await evaluateMetricGraph(
        metricGraph,
        resolvedOperatorResults,
        {
          runId: ctx.runId,
          cache: deps.cache,
          paramOverrides: nodeOverrides,
          globalParamOverrides: compareGlobalParams,
        },
      );

      let overall: EvaluationDagRunOutput;
      const bySide: Record<string, EvaluationDagRunOutput> = {};
      const sideMetricResults: Record<string, MetricGraphExecutionResult> = {};
      try {
        overall = evaluateSystemDagWithInputs(
          ctx.dag,
          overallMetricResult.metricInputsForSystem,
          ctx.explicitMetricInputs,
          deps,
          {
            evalId: ctx.evalId,
            runId: ctx.runId,
            strictWeightValidation: ctx.strictWeightValidation,
          },
        );

        for (const side of sides) {
          const slicedOpResults = sliceOperatorResultsBySide(resolvedOperatorResults, side);
          const sideMetricResult = await evaluateMetricGraph(
            metricGraph,
            slicedOpResults,
            {
              runId: ctx.runId,
              cache: deps.cache,
              paramOverrides: nodeOverrides,
              globalParamOverrides: compareGlobalParams,
            },
          );
          sideMetricResults[side] = sideMetricResult;
          bySide[side] = evaluateSystemDagWithInputs(
            ctx.dag,
            sideMetricResult.metricInputsForSystem,
            ctx.explicitMetricInputs,
            deps,
            {
              evalId: ctx.evalId ? `${ctx.evalId}_${side}` : undefined,
              runId: ctx.runId,
              strictWeightValidation: ctx.strictWeightValidation,
            },
          );
        }
      } catch (err) {
        sendError(
          sendJson,
          res,
          400,
          err instanceof Error ? err.message : String(err),
        );
        return true;
      }

      const resolvedSystemId = asNonEmptyString(ctx.dag.systemId) ?? systemId;
      const resolvedMetricGraphId =
        asNonEmptyString(metricGraph.graphId) ??
        asNonEmptyString(body.metricGraphId) ??
        asNonEmptyString(ctx.dag.metricGraphId);
      const evalId =
        overall.evalId ||
        `v4eval_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const createdAt = overall.createdAt || new Date().toISOString();
      const systemName = ctx.dag.name || resolvedSystemId;
      const systemVersion = ctx.dag.version || '1.0.0';
      const sideSummaries: StoredV4EvalSideSummary[] = sides.map((side) => ({
        side,
        overallScore: bySide[side]?.overallScore ?? null,
        rawOverallScore: bySide[side]?.rawOverallScore ?? null,
        gateVerdict: bySide[side]?.gateVerdict ?? 'PASS',
        availableWeightRatio: bySide[side]?.availableWeightRatio ?? 0,
      }));
      const metricSnapshots = buildV4MetricSnapshots(
        ctx.dag,
        overallMetricResult,
        sideMetricResults,
        overall,
        bySide,
        sides,
        deps.effectStore,
      );

      if (body.persist !== false && deps.getEvalStore) {
        const evalRecord: StoredV4EvalRecord = {
          evalId,
          runId: ctx.runId,
          dataSourceId: ctx.dataSourceId,
          systemId: resolvedSystemId,
          systemName,
          systemVersion,
          metricGraphId: resolvedMetricGraphId,
          sides,
          overallScore: overall.overallScore ?? null,
          gateVerdict: overall.gateVerdict ?? 'PASS',
          availableWeightRatio: overall.availableWeightRatio ?? 0,
          sideSummaries,
          overall,
          bySide,
          metricSnapshots,
          createdAt,
        };
        deps.getEvalStore().saveV4Evaluation(evalRecord);
      }

      sendJson(res, 200, {
        ok: true,
        evalId,
        createdAt,
        systemId: resolvedSystemId,
        systemName,
        systemVersion,
        runId: ctx.runId,
        metricGraphId: resolvedMetricGraphId,
        sides,
        sideSummaries,
        overall,
        bySide,
        metricSnapshots,
      });
      return true;
    }

    if (method === 'POST' && pathname === '/api/v4/system-dags/draft-nl') {
      const body = await readJsonBody(req);
      const prompt = asNonEmptyString(body.prompt);
      if (!prompt) {
        sendError(sendJson, res, 400, '任务需求描述 prompt 不能为空');
        return true;
      }
      const drafted = draftV4SystemDagFromPrompt(prompt, deps.effectStore, {
        systemId: asNonEmptyString(body.systemId),
        name: asNonEmptyString(body.name),
        metricGraphId: asNonEmptyString(body.metricGraphId),
      });
      const validation = deps.systemDagStore.validate(drafted.system);
      sendJson(res, 200, {
        ok: true,
        system: drafted.system,
        validation,
        matchedDomains: drafted.matchedDomains,
        rationale: drafted.rationale,
      });
      return true;
    }

    if (method === 'POST' && pathname === '/api/v4/system-dags/objective-weights') {
      const body = await readJsonBody(req);
      const weightMethod = (asNonEmptyString(body.method) ?? 'entropy') as
        | 'entropy'
        | 'critic'
        | 'combined';
      const objectiveMethod = (asNonEmptyString(body.objectiveMethod) ?? 'entropy') as
        | 'entropy'
        | 'critic';
      const systemId = asNonEmptyString(body.systemId);
      const rawSys = asPlainRecord(body.system) as unknown as EvaluationSystemDag | undefined;
      const dag = rawSys ?? (systemId ? deps.systemDagStore.get(systemId) : undefined);

      let targetNodeId = asNonEmptyString(body.targetNodeId) ?? dag?.terminalEffectNodeId ?? '';
      let sourceNodeIds: string[] = [];
      let targetNames: string[] = [];
      let subjectiveFromDag: number[] = [];
      let matrix: number[][] = [];
      let validRuns: string[] = [];

      if (Array.isArray(body.matrix) && body.matrix.length >= 2) {
        matrix = body.matrix as number[][];
        const colCount = Array.isArray(matrix[0]) ? matrix[0].length : 0;
        if (colCount < 2) {
          sendError(sendJson, res, 400, '决策矩阵列数（指标/效果数）必须大于等于 2');
          return true;
        }
        sourceNodeIds = Array.isArray(body.sourceNodeIds)
          ? (body.sourceNodeIds as string[])
          : Array.from({ length: colCount }, (_, i) => `node_${i + 1}`);
        targetNames = Array.isArray(body.criterionNames)
          ? (body.criterionNames as string[])
          : sourceNodeIds;
        subjectiveFromDag = Array.from({ length: colCount }, () => 1 / colCount);
        validRuns = Array.from({ length: matrix.length }, (_, i) => `sample_${i + 1}`);
      } else {
        if (!dag) {
          sendError(sendJson, res, 400, '必须提供有效的 systemId / system 或直接提供 matrix 决策矩阵');
          return true;
        }
        if (!targetNodeId) targetNodeId = dag.terminalEffectNodeId;
        const incomingEdges = dag.edges.filter((e) => e.targetNodeId === targetNodeId);
        if (incomingEdges.length < 2) {
          sendError(sendJson, res, 400, `节点 ${targetNodeId} 的入边数量少于 2，无法执行客观赋权`);
          return true;
        }
        const nodeLabelMap = new Map(dag.nodes.map((n) => [n.id, n.label || n.id]));
        sourceNodeIds = incomingEdges.map((e) => e.sourceNodeId);
        targetNames = sourceNodeIds.map((id) => nodeLabelMap.get(id) ?? id);
        subjectiveFromDag = incomingEdges.map((e) =>
          typeof e.weight === 'number' && Number.isFinite(e.weight) && e.weight > 0
            ? e.weight
            : 1 / incomingEdges.length,
        );

        const evalStore = deps.getEvalStore?.();
        if (!evalStore) {
          sendError(sendJson, res, 503, 'V4 评估历史存储未初始化，无法读取历史评估矩阵');
          return true;
        }
        const evalIdFilter = Array.isArray(body.evalIds)
          ? new Set((body.evalIds as unknown[]).map(String))
          : null;
        const runIdFilter = Array.isArray(body.runIds)
          ? new Set((body.runIds as unknown[]).map(String))
          : null;
        const summaries = evalStore
          .listV4Evaluations(undefined, 200)
          .filter((s) => (!dag.systemId || s.systemId === dag.systemId))
          .filter((s) => (!evalIdFilter || evalIdFilter.has(s.evalId)))
          .filter((s) => (!runIdFilter || runIdFilter.has(s.runId)));

        for (const s of summaries) {
          const rec = evalStore.getV4Evaluation(s.evalId);
          if (!rec?.overall?.nodeResults) continue;
          const row: number[] = [];
          let okRow = true;
          for (const srcId of sourceNodeIds) {
            const nr = rec.overall.nodeResults[srcId];
            if (typeof nr?.score !== 'number' || !Number.isFinite(nr.score)) {
              okRow = false;
              break;
            }
            row.push(nr.score);
          }
          if (okRow) {
            matrix.push(row);
            validRuns.push(rec.runId);
          }
        }

        if (matrix.length < 2) {
          sendError(
            sendJson,
            res,
            400,
            '所选评估历史中有效可对比的 V4 方案少于 2 条，无法执行客观赋权（或请直接传入 matrix）',
          );
          return true;
        }
      }

      const directions = targetNames.map(() => 'larger_is_better' as const);
      let weights: number[] = [];
      let objectiveWeights: number[] = [];
      let diagnostics: Record<string, unknown> = {};

      if (weightMethod === 'entropy') {
        const ew = await computeEntropyWeights(matrix, directions, targetNames);
        weights = ew.weights;
        objectiveWeights = ew.weights;
        diagnostics = { entropies: ew.entropies, namedWeights: ew.namedWeights, note: ew.note };
      } else if (weightMethod === 'critic') {
        const cw = await computeCriticWeights(matrix, directions, targetNames);
        weights = cw.weights;
        objectiveWeights = cw.weights;
        diagnostics = {
          stdDevs: cw.stdDevs,
          conflictScores: cw.conflictScores,
          namedWeights: cw.namedWeights,
          note: cw.note,
        };
      } else if (weightMethod === 'combined') {
        let objNote: string | undefined;
        if (objectiveMethod === 'critic') {
          const cw = await computeCriticWeights(matrix, directions, targetNames);
          objectiveWeights = cw.weights;
          objNote = cw.note;
        } else {
          const ew = await computeEntropyWeights(matrix, directions, targetNames);
          objectiveWeights = ew.weights;
          objNote = ew.note;
        }
        const rawSub =
          Array.isArray(body.subjectiveWeights) &&
          body.subjectiveWeights.length === sourceNodeIds.length
            ? (body.subjectiveWeights as number[])
            : subjectiveFromDag;
        const sumSub = rawSub.reduce((a, b) => a + b, 0) || 1;
        const subWeights = rawSub.map((w) => w / sumSub);
        const alpha =
          typeof body.alpha === 'number' && Number.isFinite(body.alpha)
            ? Math.max(0, Math.min(1, body.alpha))
            : 0.5;
        const comb = await computeCombinedWeights({
          subjectiveWeights: subWeights,
          objectiveWeights,
          alpha,
          criterionNames: targetNames,
        });
        weights = comb.weights;
        diagnostics = {
          alphaUsed: comb.alphaUsed,
          subjectiveUsed: comb.subjectiveUsed,
          objectiveUsed: comb.objectiveUsed,
          objectiveMethod,
          namedWeights: comb.namedWeights,
          note: objNote,
        };
      } else {
        sendError(sendJson, res, 400, `不支持的赋权方法: ${String(weightMethod)}`);
        return true;
      }

      const sumW = weights.reduce((a, b) => a + b, 0) || 1;
      const normalizedWeights = weights.map((w) => Math.round((w / sumW) * 10000) / 10000);
      sendJson(res, 200, {
        ok: true,
        method: weightMethod,
        targetNodeId,
        sourceNodeIds,
        targetNames,
        runs: validRuns,
        matrix,
        weights: normalizedWeights,
        normalizedWeights,
        objectiveWeights,
        diagnostics,
      });
      return true;
    }

    const systemIdMatch = pathname.match(/^\/api\/v4\/system-dags\/([^/]+)$/);
    if (systemIdMatch) {
      const systemId = decodeURIComponent(systemIdMatch[1]);
      if (method === 'GET') {
        const system = deps.systemDagStore.get(systemId);
        if (!system) {
          sendError(sendJson, res, 404, `未找到评估体系 DAG: ${systemId}`);
          return true;
        }
        sendJson(res, 200, { ok: true, system });
        return true;
      }
      if (method === 'DELETE') {
        try {
          const deleted = deps.systemDagStore.delete(systemId);
          if (!deleted) {
            sendError(sendJson, res, 404, `未找到评估体系 DAG: ${systemId}`);
            return true;
          }
          sendJson(res, 200, { ok: true, systemId, deleted: true });
        } catch (err) {
          sendError(
            sendJson,
            res,
            403,
            err instanceof Error ? err.message : String(err),
          );
        }
        return true;
      }
    }

    if (method === 'POST' && pathname === '/api/v4/system-dags') {
      const body = await readJsonBody(req);
      const rawDag = (asPlainRecord(body.system) ??
        asPlainRecord(body.dag) ??
        body) as unknown as EvaluationSystemDag;

      const candidateDag =
        body.normalizeWeights === true
          ? normalizeIncomingWeights(rawDag, deps.effectStore)
          : rawDag;

      const validation = deps.systemDagStore.validate(candidateDag);
      if (!validation.valid) {
        sendError(sendJson, res, 400, `评估体系 DAG 校验未通过: ${validation.errors.join('; ')}`, {
          validation,
        });
        return true;
      }

      const saved = deps.systemDagStore.upsert(candidateDag);
      sendJson(res, 200, { ok: true, system: saved, validation });
      return true;
    }

    if (method === 'GET' && pathname === '/api/v4/evaluations') {
      const store = deps.getEvalStore?.();
      const urlObj = new URL(req.url || pathname, 'http://localhost');
      const runIdParam = urlObj.searchParams.get('runId') || undefined;
      const limitParam = Number(urlObj.searchParams.get('limit') || 50);
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;
      const evaluations = store ? store.listV4Evaluations(runIdParam, limit) : [];
      sendJson(res, 200, { ok: true, evaluations });
      return true;
    }

    const v4EvalMatch = pathname.match(/^\/api\/v4\/evaluations\/([^/]+)$/);
    if (v4EvalMatch) {
      const evalId = decodeURIComponent(v4EvalMatch[1]);
      const store = deps.getEvalStore?.();
      if (!store) {
        sendError(sendJson, res, 503, 'V4 评估历史存储未初始化');
        return true;
      }
      if (method === 'GET') {
        const evaluation = store.getV4Evaluation(evalId);
        if (!evaluation) {
          sendError(sendJson, res, 404, `未找到 V4 评估记录: ${evalId}`);
          return true;
        }
        sendJson(res, 200, { ok: true, evaluation });
        return true;
      }
      if (method === 'DELETE') {
        const deleted = store.deleteV4Evaluation(evalId);
        if (!deleted) {
          sendError(sendJson, res, 404, `未找到 V4 评估记录: ${evalId}`);
          return true;
        }
        sendJson(res, 200, { ok: true, evalId, deleted: true });
        return true;
      }
    }

    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isJsonSyntax = err instanceof SyntaxError;
    sendError(sendJson, res, isJsonSyntax ? 400 : 500, msg);
    return true;
  }
}
