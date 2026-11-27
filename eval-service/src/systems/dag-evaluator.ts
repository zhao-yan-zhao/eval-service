import crypto from 'node:crypto';
import { applyScoringRule } from '../core/scoring-functions.ts';
import type {
  AggregationStrategy,
  DagEdge,
  DagNodeBase,
  EffectDefinition,
  EvaluatedEffectNode,
  EvaluationDagOutput,
  EvaluationSystemDag,
  EvidenceRef,
  GateAuditItem,
  GateStatus,
  GateVerdict,
  IndicatorReduceMethod,
  NodeMissingPolicy,
  ScoringRule,
  TableDataset,
} from '../core/types.ts';
import { defaultEffectStore, type EffectStore } from '../effects/store.ts';
import { isAlarmThresholdTriggered, reduceNumericArray } from '../core/metric-helpers.ts';
import { validateFormula } from '../operators/formula-engine.ts';
import { calculateNodeAggregation, type ChildNodeScoreInput } from './aggregation-strategies.ts';

export type SystemDagNode = DagNodeBase & {
  refId?: string;
  inlineEffect?: EffectDefinition;
};

export interface SystemDagMetricInput {
  status: 'valid' | 'degraded' | 'unavailable';
  value?: number | boolean | null;
  dataset?: TableDataset;
  evidenceRefs?: EvidenceRef[];
  missingDataReason?: string;
}

export type SystemDagEvaluationInputs = Record<string, SystemDagMetricInput>;

export interface EvaluateSystemDagOptions {
  effectStore?: EffectStore;
  evalId?: string;
  runId?: string;
  paramOverrideCollector?: (metricId: string, overrides: Record<string, unknown>) => void;
  strictWeightValidation?: boolean;
}

export interface EvaluationDagRunOutput extends EvaluationDagOutput {
  resolvedParamOverrides: Record<string, Record<string, unknown>>;
}

export interface SystemDagValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  topologicalOrder: string[];
  hasCycle: boolean;
  cycleNodeIds: string[];
}

interface TopologyAnalysis {
  nodeMap: Map<string, SystemDagNode>;
  duplicateNodeIds: string[];
  duplicateEdgeIds: string[];
  missingEdgeRefs: string[];
  incomingByTarget: Map<string, DagEdge[]>;
  outgoingBySource: Map<string, DagEdge[]>;
  topologicalOrder: string[];
  hasCycle: boolean;
  cycleNodeIds: string[];
}

export function isMetricProxyNode(node: Pick<SystemDagNode, 'kind'>): boolean {
  return node.kind === 'metric_proxy' || node.kind === 'metric';
}

export function resolveEffectDefinitionForNode(
  node: SystemDagNode,
  effectStore: EffectStore = defaultEffectStore,
): EffectDefinition | undefined {
  if (isMetricProxyNode(node)) return undefined;
  if (node.inlineEffect) return node.inlineEffect;
  if (node.refId) return effectStore.get(node.refId);
  return undefined;
}

function resolveMetricIdForProxyNode(node: SystemDagNode): string {
  if (node.refId && node.refId.trim()) return node.refId;
  const paramMetricId = node.params?.metricId;
  if (typeof paramMetricId === 'string' && paramMetricId.trim()) return paramMetricId;
  return node.id;
}

function analyzeSystemDagTopology(dag: EvaluationSystemDag): TopologyAnalysis {
  const nodeMap = new Map<string, SystemDagNode>();
  const duplicateNodeIds: string[] = [];
  for (const node of dag.nodes ?? []) {
    if (!node?.id) continue;
    if (nodeMap.has(node.id)) {
      duplicateNodeIds.push(node.id);
    } else {
      nodeMap.set(node.id, node);
    }
  }

  const incomingByTarget = new Map<string, DagEdge[]>();
  const outgoingBySource = new Map<string, DagEdge[]>();
  const inDegree = new Map<string, number>();
  for (const id of nodeMap.keys()) {
    incomingByTarget.set(id, []);
    outgoingBySource.set(id, []);
    inDegree.set(id, 0);
  }

  const seenEdgeIds = new Set<string>();
  const duplicateEdgeIds: string[] = [];
  const missingEdgeRefs: string[] = [];
  const selfLoopNodeIds = new Set<string>();

  for (const edge of dag.edges ?? []) {
    if (edge.id) {
      if (seenEdgeIds.has(edge.id)) {
        duplicateEdgeIds.push(edge.id);
      } else {
        seenEdgeIds.add(edge.id);
      }
    }
    const hasSrc = nodeMap.has(edge.sourceNodeId);
    const hasDst = nodeMap.has(edge.targetNodeId);
    if (!hasSrc || !hasDst) {
      missingEdgeRefs.push(
        `边 ${edge.id || '(未命名)'} 引用了不存在的节点 (${edge.sourceNodeId} -> ${edge.targetNodeId})`,
      );
      continue;
    }

    if (edge.sourceNodeId === edge.targetNodeId) {
      selfLoopNodeIds.add(edge.sourceNodeId);
    }

    incomingByTarget.get(edge.targetNodeId)!.push(edge);
    outgoingBySource.get(edge.sourceNodeId)!.push(edge);
    inDegree.set(edge.targetNodeId, (inDegree.get(edge.targetNodeId) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  const topologicalOrder: string[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const cur = queue.shift()!;
    topologicalOrder.push(cur);
    visited.add(cur);

    for (const edge of outgoingBySource.get(cur) ?? []) {
      const nextDeg = (inDegree.get(edge.targetNodeId) ?? 0) - 1;
      inDegree.set(edge.targetNodeId, nextDeg);
      if (nextDeg === 0) {
        queue.push(edge.targetNodeId);
      }
    }
  }

  const cycleNodeSet = new Set<string>(selfLoopNodeIds);
  if (topologicalOrder.length < nodeMap.size) {
    for (const id of nodeMap.keys()) {
      if (!visited.has(id)) {
        cycleNodeSet.add(id);
      }
    }
  }

  const cycleNodeIds = [...cycleNodeSet];
  const hasCycle = cycleNodeIds.length > 0 || topologicalOrder.length < nodeMap.size;

  return {
    nodeMap,
    duplicateNodeIds,
    duplicateEdgeIds,
    missingEdgeRefs,
    incomingByTarget,
    outgoingBySource,
    topologicalOrder,
    hasCycle,
    cycleNodeIds,
  };
}

/**
 * 校验评估体系 DAG 的拓扑合法性（Kahn 判环）、终态节点可达性、效果定义完整性与局部入边权重归一化（Σ=1.0±1e-4）
 */
export function validateSystemDag(
  dag: EvaluationSystemDag,
  effectStore: EffectStore = defaultEffectStore,
): SystemDagValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!dag || typeof dag !== 'object') {
    return {
      valid: false,
      errors: ['评估体系 DAG 对象不能为空'],
      warnings: [],
      topologicalOrder: [],
      hasCycle: false,
      cycleNodeIds: [],
    };
  }

  if (!dag.systemId || !/^[a-zA-Z0-9_.-]+$/.test(dag.systemId)) {
    errors.push('systemId 仅允许字母、数字、下划线、点或连字符');
  }
  if (!dag.name || !dag.name.trim()) {
    errors.push('体系名称 name 不能为空');
  }
  if (!Array.isArray(dag.nodes) || dag.nodes.length === 0) {
    errors.push('体系 DAG 至少需要包含一个节点');
    return {
      valid: false,
      errors,
      warnings,
      topologicalOrder: [],
      hasCycle: false,
      cycleNodeIds: [],
    };
  }

  const topo = analyzeSystemDagTopology(dag);

  for (const dupId of topo.duplicateNodeIds) {
    errors.push(`存在重复的节点 ID: ${dupId}`);
  }
  for (const dupEdgeId of topo.duplicateEdgeIds) {
    errors.push(`存在重复的边 ID: ${dupEdgeId}`);
  }
  for (const missingRef of topo.missingEdgeRefs) {
    errors.push(missingRef);
  }

  if (!dag.terminalEffectNodeId || !topo.nodeMap.has(dag.terminalEffectNodeId)) {
    errors.push(
      `终态输出节点 terminalEffectNodeId "${dag.terminalEffectNodeId ?? ''}" 不存在于 dag.nodes 中`,
    );
  } else {
    const termNode = topo.nodeMap.get(dag.terminalEffectNodeId)!;
    if (isMetricProxyNode(termNode)) {
      warnings.push(`终态输出节点 "${termNode.id}" 为 metric_proxy，建议指向 effect 节点`);
    }
  }

  if (topo.hasCycle) {
    errors.push(`检测到体系 DAG 存在有向环路，涉及节点: ${topo.cycleNodeIds.join(', ')}`);
  }

  for (const node of dag.nodes) {
    if (!node.id) {
      errors.push('存在缺少 id 的节点');
      continue;
    }

    const incoming = topo.incomingByTarget.get(node.id) ?? [];

    if (isMetricProxyNode(node)) {
      if (incoming.length > 0) {
        warnings.push(`指标代理节点 "${node.id}" 不应包含入边（当前有 ${incoming.length} 条入边）`);
      }
      continue;
    }

    const effectDef = resolveEffectDefinitionForNode(node, effectStore);
    if (!effectDef) {
      errors.push(
        `节点 "${node.id}" (${node.label}) 无法解析效果定义（缺少 inlineEffect 或有效的 refId: ${node.refId ?? '无'}）`,
      );
      continue;
    }

    const effValidation = effectStore.validateEffect(effectDef);
    if (!effValidation.valid) {
      for (const e of effValidation.errors) {
        errors.push(`节点 "${node.id}" 效果定义校验失败: ${e}`);
      }
    }

    if (incoming.length === 0) {
      if (!effectDef.metricBinding) {
        warnings.push(`节点 "${node.id}" 既无上游入边也未绑定 metricBinding，评估时将返回 unavailable`);
      }
      continue;
    }

    const strategy = effectDef.aggregation.strategy;
    const isPureFormulaNoWeights =
      strategy === 'formula' && incoming.every((e) => e.weight === undefined);

    const singleSrcNode =
      incoming.length === 1 ? topo.nodeMap.get(incoming[0].sourceNodeId) : undefined;
    const isSingleProxyDataWire =
      incoming.length === 1 &&
      incoming[0].weight === undefined &&
      Boolean(effectDef.metricBinding) &&
      Boolean(singleSrcNode && isMetricProxyNode(singleSrcNode));

    if (!isPureFormulaNoWeights && !isSingleProxyDataWire) {
      let weightSum = 0;
      let hasInvalidWeight = false;

      for (const edge of incoming) {
        if (typeof edge.weight !== 'number' || !Number.isFinite(edge.weight) || edge.weight <= 0) {
          errors.push(
            `节点 "${node.label || node.id}" (${node.id}) 的入边 "${edge.id || edge.sourceNodeId}" 权重必须为大于 0 的有限数值 (当前=${String(edge.weight)})`,
          );
          hasInvalidWeight = true;
        } else {
          weightSum += edge.weight;
        }
      }

      if (!hasInvalidWeight && Math.abs(weightSum - 1.0) > 1e-4) {
        errors.push(
          `节点 "${node.label || node.id}" (${node.id}) 的入边局部权重之和必须为 1.0 ± 1e-4 (当前为 ${weightSum.toFixed(4)})`,
        );
      }
    }

    if (strategy === 'formula' && effectDef.aggregation.customFormula) {
      const allowedVars = new Set<string>();
      for (const e of incoming) {
        allowedVars.add(e.sourceNodeId);
        if (e.targetAlias) allowedVars.add(e.targetAlias);
        if (e.id) allowedVars.add(e.id);
      }
      const formulaCheck = validateFormula(
        effectDef.aggregation.customFormula,
        [...allowedVars],
      );
      if (!formulaCheck.valid) {
        errors.push(
          `节点 "${node.id}" 自定义聚合公式校验失败: ${formulaCheck.errors.join('; ')}`,
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    topologicalOrder: topo.topologicalOrder,
    hasCycle: topo.hasCycle,
    cycleNodeIds: topo.cycleNodeIds,
  };
}

/**
 * 局部入边权重自动归一化助手：确保每个具有加权入边的效果节点其入边之和严格等于 1.0000
 */
export function normalizeIncomingWeights(
  dag: EvaluationSystemDag,
  effectStore: EffectStore = defaultEffectStore,
): EvaluationSystemDag {
  const cloned = structuredClone(dag);
  const nodeMap = new Map<string, SystemDagNode>();
  for (const n of cloned.nodes ?? []) {
    nodeMap.set(n.id, n);
  }

  const edgesByTarget = new Map<string, DagEdge[]>();
  for (const e of cloned.edges ?? []) {
    if (!edgesByTarget.has(e.targetNodeId)) {
      edgesByTarget.set(e.targetNodeId, []);
    }
    edgesByTarget.get(e.targetNodeId)!.push(e);
  }

  for (const [targetId, incoming] of edgesByTarget.entries()) {
    if (incoming.length === 0) continue;
    const targetNode = nodeMap.get(targetId);
    if (!targetNode || isMetricProxyNode(targetNode)) continue;

    const effectDef = resolveEffectDefinitionForNode(targetNode, effectStore);
    if (
      effectDef?.aggregation?.strategy === 'formula' &&
      incoming.every((e) => e.weight === undefined)
    ) {
      continue;
    }

    const rawWeights = incoming.map((e) =>
      typeof e.weight === 'number' && Number.isFinite(e.weight) && e.weight > 0 ? e.weight : 0,
    );
    const sum = rawWeights.reduce((a, b) => a + b, 0);
    const n = incoming.length;

    if (sum > 0) {
      for (let i = 0; i < n; i += 1) {
        incoming[i].weight = Math.round((rawWeights[i] / sum) * 10000) / 10000;
      }
    } else {
      const equal = Math.round((1 / n) * 10000) / 10000;
      for (let i = 0; i < n; i += 1) {
        incoming[i].weight = equal;
      }
    }

    // 补偿尾差至最后一条有效正权重边，确保严格 Σ = 1.0000
    let adjustIdx = n - 1;
    for (let i = n - 1; i >= 0; i -= 1) {
      if ((incoming[i].weight ?? 0) > 0) {
        adjustIdx = i;
        break;
      }
    }
    const othersSum = incoming.reduce(
      (acc, e, idx) => (idx === adjustIdx ? acc : acc + (e.weight ?? 0)),
      0,
    );
    incoming[adjustIdx].weight = Math.max(
      0.0001,
      Math.round((1 - othersSum) * 10000) / 10000,
    );
  }

  return cloned;
}

// ──────────────────── 数据切片与归约提取 ────────────────────

function valuesMatch(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (actual === null || actual === undefined || expected === null || expected === undefined) {
    return false;
  }
  if (typeof actual === 'number' && typeof expected === 'number') {
    return Math.abs(actual - expected) < 1e-9;
  }
  if (typeof actual === 'boolean' && typeof expected === 'boolean') {
    return actual === expected;
  }
  return String(actual).trim().toLowerCase() === String(expected).trim().toLowerCase();
}

function inferDefaultMeasureField(
  dataset: TableDataset,
  candidateRows: Array<Record<string, unknown>>,
): string | undefined {
  if (dataset.measureKeys && dataset.measureKeys.length > 0) {
    return dataset.measureKeys[0];
  }
  const dimSet = new Set(dataset.dimensionKeys ?? []);
  if (Array.isArray(dataset.columns) && dataset.columns.length > 0) {
    const col = dataset.columns.find(
      (c) => (c.type === 'number' || c.type === 'boolean') && !dimSet.has(c.name),
    );
    if (col) return col.name;
    const anyNum = dataset.columns.find((c) => c.type === 'number' || c.type === 'boolean');
    if (anyNum) return anyNum.name;
  }
  if (candidateRows.length > 0) {
    for (const [key, val] of Object.entries(candidateRows[0])) {
      if (dimSet.has(key)) continue;
      if (typeof val === 'number' || typeof val === 'boolean') {
        return key;
      }
    }
  }
  return undefined;
}

export interface ExtractedMetricValue {
  rawValue: number | boolean | null;
  status: 'valid' | 'degraded' | 'unavailable';
  evidenceRefs: EvidenceRef[];
  missingDataReason?: string;
}

export function extractMetricInputValue(
  metricId: string,
  input: SystemDagMetricInput | undefined,
  opts?: {
    sliceFilter?: Record<string, unknown>;
    targetField?: string;
    reduce?: IndicatorReduceMethod;
  },
): ExtractedMetricValue {
  if (!input || input.status === 'unavailable') {
    return {
      rawValue: null,
      status: 'unavailable',
      evidenceRefs: input?.evidenceRefs ? [...input.evidenceRefs] : [],
      missingDataReason: input?.missingDataReason || `缺少指标 [${metricId}] 实证输入数据`,
    };
  }

  const evidenceRefs = input.evidenceRefs ? [...input.evidenceRefs] : [];
  const sliceFilter = opts?.sliceFilter;
  const hasFilter = Boolean(sliceFilter && Object.keys(sliceFilter).length > 0);
  const targetField = opts?.targetField;
  const reduceMethod: IndicatorReduceMethod = opts?.reduce ?? 'first';

  const shouldUseDataset =
    Boolean(input.dataset) &&
    (hasFilter || Boolean(targetField) || input.value === undefined || input.value === null);

  if (shouldUseDataset && input.dataset) {
    const dataset = input.dataset;
    const rows = dataset.rows ?? [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        rawValue: null,
        status: 'unavailable',
        evidenceRefs,
        missingDataReason: `指标 [${metricId}] 数据集为空 (0 行)`,
      };
    }

    let candidateRows = rows;
    if (hasFilter && sliceFilter) {
      candidateRows = rows.filter((row) =>
        Object.entries(sliceFilter).every(([k, expected]) => {
          if (expected === undefined) return true;
          const actual = row[k];
          if (actual === undefined || actual === null) return false;
          if (Array.isArray(expected)) {
            return expected.some((candidate) => valuesMatch(actual, candidate));
          }
          return valuesMatch(actual, expected);
        }),
      );
      if (candidateRows.length === 0) {
        return {
          rawValue: null,
          status: 'unavailable',
          evidenceRefs,
          missingDataReason: `指标 [${metricId}] 按条件 ${JSON.stringify(sliceFilter)} 切片未命中任何记录`,
        };
      }
    }

    const effectiveField = targetField ?? inferDefaultMeasureField(dataset, candidateRows);
    if (!effectiveField) {
      return {
        rawValue: null,
        status: 'unavailable',
        evidenceRefs,
        missingDataReason: `指标 [${metricId}] 未指定 targetField 且无法推断度量列`,
      };
    }

    const colVals = candidateRows
      .map((r) => r[effectiveField])
      .filter((v) => v !== undefined && v !== null);

    if (colVals.length === 0) {
      return {
        rawValue: null,
        status: 'unavailable',
        evidenceRefs,
        missingDataReason: `指标 [${metricId}] 目标字段 [${effectiveField}] 无有效数据`,
      };
    }

    let rawValue: number | boolean | null = null;
    if ((colVals.length === 1 || reduceMethod === 'first') && typeof colVals[0] === 'boolean') {
      rawValue = colVals[0];
    } else if (reduceMethod === 'last' && typeof colVals[colVals.length - 1] === 'boolean') {
      rawValue = colVals[colVals.length - 1] as boolean;
    } else {
      const nums = colVals
        .map((v) => {
          if (typeof v === 'number' && Number.isFinite(v)) return v;
          if (typeof v === 'boolean') return v ? 1 : 0;
          const n = Number(String(v).trim());
          return Number.isFinite(n) ? n : null;
        })
        .filter((n): n is number => n !== null);
      rawValue = reduceNumericArray(nums, reduceMethod);
    }

    if (rawValue === null) {
      return {
        rawValue: null,
        status: 'unavailable',
        evidenceRefs,
        missingDataReason: `指标 [${metricId}] 字段 [${effectiveField}] 无法归约为有效数值`,
      };
    }

    return {
      rawValue,
      status: input.status,
      evidenceRefs,
    };
  }

  // 标量模式
  if (input.value === undefined || input.value === null) {
    return {
      rawValue: null,
      status: 'unavailable',
      evidenceRefs,
      missingDataReason: input.missingDataReason || `指标 [${metricId}] 标量值为空`,
    };
  }

  if (typeof input.value === 'number' && !Number.isFinite(input.value)) {
    return {
      rawValue: null,
      status: 'unavailable',
      evidenceRefs,
      missingDataReason: `指标 [${metricId}] 标量值为非有限数 (NaN/Infinity)`,
    };
  }

  return {
    rawValue: input.value,
    status: input.status,
    evidenceRefs,
  };
}

function mergeEvidenceRefs(groups: EvidenceRef[][]): EvidenceRef[] {
  const seen = new Set<string>();
  const merged: EvidenceRef[] = [];
  for (const list of groups) {
    for (const ref of list) {
      const key = `${ref.source}|${String(ref.ref)}|${ref.scenarioClock}|${ref.description}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(ref);
      }
    }
  }
  return merged;
}

function formatGateDisplayValue(node: EvaluatedEffectNode): string {
  if (node.status === 'unavailable') {
    return node.missingDataReason || '不可用 (数据缺失)';
  }
  if (node.rawValue !== undefined && node.rawValue !== null) {
    return String(node.rawValue);
  }
  if (node.score !== null) {
    return `${node.score.toFixed(1)} 分`;
  }
  return '已评估';
}

function collectParamOverridesForBinding(
  metricId: string,
  sources: Array<Record<string, unknown> | undefined>,
  resolvedByMetric: Record<string, Record<string, unknown>>,
  collector?: (metricId: string, overrides: Record<string, unknown>) => void,
): void {
  const merged: Record<string, unknown> = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      if (v !== undefined) {
        merged[k] = v;
      }
    }
  }
  if (Object.keys(merged).length === 0) return;

  resolvedByMetric[metricId] = {
    ...(resolvedByMetric[metricId] ?? {}),
    ...merged,
  };
  if (collector) {
    collector(metricId, merged);
  }
}

/**
 * 收集整个评估体系 DAG 向各二库指标节点透传的合并后参数覆盖（globalParams < proxy.params < effect.metricBinding.paramOverrides < node.params）
 */
export function collectDagParamOverrides(
  dag: EvaluationSystemDag,
  effectStore: EffectStore = defaultEffectStore,
): Record<string, Record<string, unknown>> {
  const topo = analyzeSystemDagTopology(dag);
  const out: Record<string, Record<string, unknown>> = {};

  for (const node of dag.nodes ?? []) {
    if (isMetricProxyNode(node)) continue;
    const effectDef = resolveEffectDefinitionForNode(node, effectStore);
    if (!effectDef?.metricBinding) continue;

    const incoming = topo.incomingByTarget.get(node.id) ?? [];
    const proxyNode =
      incoming.length === 1
        ? (() => {
            const candidate = topo.nodeMap.get(incoming[0].sourceNodeId);
            return candidate && isMetricProxyNode(candidate) ? candidate : undefined;
          })()
        : undefined;

    const metricId = proxyNode
      ? resolveMetricIdForProxyNode(proxyNode)
      : effectDef.metricBinding.metricId;

    collectParamOverridesForBinding(
      metricId,
      [
        dag.globalParams,
        proxyNode?.params,
        effectDef.metricBinding.paramOverrides,
        node.params,
      ],
      out,
    );
  }

  return out;
}

// ──────────────────── 核心 DAG 拓扑评估引擎 ────────────────────

/**
 * 在三库评估体系 DAG 上执行不限深度拓扑求值、数据切片评分、局部权重合成与双轨 GATE 红线审计
 */
export function evaluateSystemDag(
  dag: EvaluationSystemDag,
  inputs: SystemDagEvaluationInputs,
  options?: EvaluateSystemDagOptions,
): EvaluationDagRunOutput {
  const effectStore = options?.effectStore ?? defaultEffectStore;
  const evalId = options?.evalId ?? `eval-${crypto.randomUUID().slice(0, 8)}`;
  const runId = options?.runId ?? 'run-unknown';

  const topo = analyzeSystemDagTopology(dag);

  if (topo.hasCycle) {
    throw new Error(
      `评估体系 DAG "${dag.systemId}" 存在有向环路，拒绝求值 (涉及节点: ${topo.cycleNodeIds.join(', ')})`,
    );
  }
  if (topo.missingEdgeRefs.length > 0) {
    throw new Error(`评估体系 DAG "${dag.systemId}" 存在悬空连线: ${topo.missingEdgeRefs[0]}`);
  }
  if (!dag.terminalEffectNodeId || !topo.nodeMap.has(dag.terminalEffectNodeId)) {
    throw new Error(
      `评估体系 DAG "${dag.systemId}" 缺少有效终态节点 terminalEffectNodeId="${dag.terminalEffectNodeId ?? ''}"`,
    );
  }

  if (options?.strictWeightValidation) {
    const validation = validateSystemDag(dag, effectStore);
    if (!validation.valid) {
      throw new Error(`评估体系 DAG 校验未通过: ${validation.errors.join('; ')}`);
    }
  }

  const nodeResults: Record<string, EvaluatedEffectNode> = {};
  const proxyContextByNodeId = new Map<
    string,
    { metricId: string; node: SystemDagNode; input: SystemDagMetricInput | undefined }
  >();
  const resolvedParamOverrides: Record<string, Record<string, unknown>> = {};

  for (const nodeId of topo.topologicalOrder) {
    const node = topo.nodeMap.get(nodeId)!;
    const incomingEdges = topo.incomingByTarget.get(nodeId) ?? [];
    const incomingEdgeIds = incomingEdges.map((e) => e.id);

    const depth =
      incomingEdges.length === 0
        ? 0
        : Math.max(...incomingEdges.map((e) => nodeResults[e.sourceNodeId]?.depth ?? 0)) + 1;

    // ── 分支 1：二库指标代理节点 (metric_proxy) ──
    if (isMetricProxyNode(node)) {
      const metricId = resolveMetricIdForProxyNode(node);
      const metricInput = inputs[metricId];
      proxyContextByNodeId.set(nodeId, { metricId, node, input: metricInput });

      const proxySliceFilter = node.params?.sliceFilter as Record<string, unknown> | undefined;
      const proxyTargetField =
        typeof node.params?.targetField === 'string' ? node.params.targetField : undefined;
      const proxyReduce = node.params?.reduce as IndicatorReduceMethod | undefined;

      let status: 'valid' | 'degraded' | 'unavailable';
      let rawValue: number | boolean | null = null;
      let missingDataReason: string | undefined;
      let evidenceRefs: EvidenceRef[] = [];

      if (!metricInput || metricInput.status === 'unavailable') {
        status = 'unavailable';
        missingDataReason =
          metricInput?.missingDataReason || `缺少指标 [${metricId}] 实证输入数据`;
        evidenceRefs = metricInput?.evidenceRefs ? [...metricInput.evidenceRefs] : [];
      } else if (
        metricInput.dataset &&
        !proxySliceFilter &&
        !proxyTargetField &&
        (metricInput.value === undefined || metricInput.value === null)
      ) {
        // 原始 TableDataset 透传给下游切片，校验非空
        const rows = metricInput.dataset.rows ?? [];
        if (rows.length === 0) {
          status = 'unavailable';
          missingDataReason = `指标 [${metricId}] 数据集为空 (0 行)`;
        } else {
          status = metricInput.status;
        }
        evidenceRefs = metricInput.evidenceRefs ? [...metricInput.evidenceRefs] : [];
      } else {
        const extracted = extractMetricInputValue(metricId, metricInput, {
          sliceFilter: proxySliceFilter,
          targetField: proxyTargetField,
          reduce: proxyReduce,
        });
        status = extracted.status;
        rawValue = extracted.rawValue;
        missingDataReason = extracted.missingDataReason;
        evidenceRefs = extracted.evidenceRefs;
      }

      nodeResults[nodeId] = {
        nodeId,
        label: node.label,
        role: 'metric_proxy',
        rawValue,
        score: null,
        status,
        availableWeightRatio: status === 'unavailable' ? 0 : 1,
        effectiveWeights: {},
        missingDataReason,
        evidenceRefs,
        incomingEdgeIds,
        depth,
      };
      continue;
    }

    // ── 分支 2：效果 / 门控节点 (effect / gate) ──
    const effectDef = resolveEffectDefinitionForNode(node, effectStore);
    if (!effectDef) {
      nodeResults[nodeId] = {
        nodeId,
        label: node.label,
        role: node.kind === 'gate' ? 'gate' : 'effect',
        score: null,
        status: 'unavailable',
        availableWeightRatio: 0,
        effectiveWeights: Object.fromEntries(incomingEdgeIds.map((eid) => [eid, 0])),
        missingDataReason: `节点 "${node.id}" 缺少有效效果定义 (refId=${node.refId ?? '无'})`,
        evidenceRefs: [],
        incomingEdgeIds,
        depth,
      };
      continue;
    }

    const role: 'effect' | 'gate' =
      effectDef.role === 'gate' || node.kind === 'gate' ? 'gate' : 'effect';
    const gateMode = role === 'gate' ? (effectDef.gateMode ?? 'soft') : undefined;

    const singleIncomingProxy =
      incomingEdges.length === 1 &&
      proxyContextByNodeId.has(incomingEdges[0].sourceNodeId)
        ? proxyContextByNodeId.get(incomingEdges[0].sourceNodeId)
        : undefined;

    const isDirectMetricBindingMode =
      Boolean(effectDef.metricBinding) &&
      (incomingEdges.length === 0 || Boolean(singleIncomingProxy));

    if (isDirectMetricBindingMode && effectDef.metricBinding) {
      const binding = effectDef.metricBinding;
      const metricId = singleIncomingProxy ? singleIncomingProxy.metricId : binding.metricId;
      const metricInput = singleIncomingProxy ? singleIncomingProxy.input : inputs[metricId];

      // 向下游透传参数覆盖 (globalParams < proxy.params < binding.paramOverrides < node.params)
      collectParamOverridesForBinding(
        metricId,
        [
          dag.globalParams,
          singleIncomingProxy?.node.params,
          binding.paramOverrides,
          node.params,
        ],
        resolvedParamOverrides,
        options?.paramOverrideCollector,
      );

      const effectiveSliceFilter =
        binding.sliceFilter ??
        (singleIncomingProxy?.node.params?.sliceFilter as Record<string, unknown> | undefined);
      const effectiveTargetField =
        binding.targetField ??
        (typeof singleIncomingProxy?.node.params?.targetField === 'string'
          ? singleIncomingProxy.node.params.targetField
          : undefined);
      const effectiveReduce =
        binding.reduce ??
        (singleIncomingProxy?.node.params?.reduce as IndicatorReduceMethod | undefined);

      const extracted = extractMetricInputValue(metricId, metricInput, {
        sliceFilter: effectiveSliceFilter,
        targetField: effectiveTargetField,
        reduce: effectiveReduce,
      });

      const score =
        extracted.status === 'unavailable'
          ? null
          : applyScoringRule(extracted.rawValue, binding.scoringRule);

      const effectiveWeights: Record<string, number> = {};
      if (incomingEdges.length === 1) {
        effectiveWeights[incomingEdges[0].id] = score !== null ? 1 : 0;
      }

      if (extracted.status === 'unavailable' || score === null) {
        nodeResults[nodeId] = {
          nodeId,
          effectId: effectDef.effectId,
          label: node.label || effectDef.name,
          role,
          gateMode,
          gateStatus: role === 'gate' ? 'unavailable' : undefined,
          rawValue: extracted.rawValue,
          score: null,
          status: 'unavailable',
          availableWeightRatio: 0,
          effectiveWeights,
          missingDataReason:
            extracted.missingDataReason ||
            `指标 [${metricId}] 经评分规则 (${binding.scoringRule.type}) 计算无法得出有效分值`,
          evidenceRefs: extracted.evidenceRefs,
          incomingEdgeIds,
          depth,
        };
      } else {
        let gateStatus: GateStatus | undefined;
        if (role === 'gate') {
          let violated = false;
          if (binding.alarmThreshold) {
            violated = isAlarmThresholdTriggered(extracted.rawValue, binding.alarmThreshold);
          } else if (typeof extracted.rawValue === 'boolean') {
            violated = !extracted.rawValue;
          } else {
            violated = score <= 0;
          }
          gateStatus = violated ? 'violated' : 'pass';
        }

        nodeResults[nodeId] = {
          nodeId,
          effectId: effectDef.effectId,
          label: node.label || effectDef.name,
          role,
          gateMode,
          gateStatus,
          rawValue: extracted.rawValue,
          score,
          status: extracted.status,
          availableWeightRatio: 1,
          effectiveWeights,
          missingDataReason:
            extracted.status === 'degraded' ? metricInput?.missingDataReason : undefined,
          evidenceRefs: extracted.evidenceRefs,
          incomingEdgeIds,
          depth,
        };
      }
      continue;
    }

    // ── 子情况 2B：无入边且无 metricBinding（配置不完备 Fail-Closed） ──
    if (incomingEdges.length === 0) {
      nodeResults[nodeId] = {
        nodeId,
        effectId: effectDef.effectId,
        label: node.label || effectDef.name,
        role,
        gateMode,
        gateStatus: role === 'gate' ? 'unavailable' : undefined,
        score: null,
        status: 'unavailable',
        availableWeightRatio: 0,
        effectiveWeights: {},
        missingDataReason: `效果节点 "${node.id}" 既无上游入边也未绑定 metricBinding`,
        evidenceRefs: [],
        incomingEdgeIds,
        depth,
      };
      continue;
    }

    // ── 子情况 2C：复合合成效果 (1+ 入边：子效果或经由评分的多指标) ──
    const childInputs: ChildNodeScoreInput[] = [];
    const evidenceGroups: EvidenceRef[][] = [];
    const childMissingReasons: string[] = [];
    let hasDegradedChild = false;
    let hasViolatedGateChild = false;
    const hasDuplicateSource =
      new Set(incomingEdges.map((e) => e.sourceNodeId)).size !== incomingEdges.length;

    for (const edge of incomingEdges) {
      const srcRes = nodeResults[edge.sourceNodeId];
      const srcNode = topo.nodeMap.get(edge.sourceNodeId)!;
      const childInputId = hasDuplicateSource ? edge.id : edge.sourceNodeId;
      const weight =
        typeof edge.weight === 'number' && Number.isFinite(edge.weight) && edge.weight > 0
          ? edge.weight
          : 1;

      if (!srcRes) {
        childMissingReasons.push(`上游节点 ${edge.sourceNodeId} 未求值`);
        childInputs.push({
          id: childInputId,
          nodeCode: edge.targetAlias || edge.sourceNodeId,
          weight,
          score: null,
        });
        continue;
      }

      evidenceGroups.push(srcRes.evidenceRefs);
      if (srcRes.status === 'degraded') hasDegradedChild = true;
      if (srcRes.role === 'gate' && srcRes.gateStatus === 'violated') {
        hasViolatedGateChild = true;
      }

      let childScore: number | null = srcRes.score;

      if (srcRes.role === 'metric_proxy') {
        const proxyCtx = proxyContextByNodeId.get(edge.sourceNodeId);
        const proxyScoringRule = srcNode.params?.scoringRule as ScoringRule | undefined;
        const localScoringRule = proxyScoringRule ?? effectDef.metricBinding?.scoringRule;

        if (proxyCtx && effectDef.metricBinding?.paramOverrides) {
          collectParamOverridesForBinding(
            proxyCtx.metricId,
            [
              dag.globalParams,
              proxyCtx.node.params,
              effectDef.metricBinding.paramOverrides,
              node.params,
            ],
            resolvedParamOverrides,
            options?.paramOverrideCollector,
          );
        }

        if (srcRes.status === 'unavailable') {
          childScore = null;
          if (srcRes.missingDataReason) {
            childMissingReasons.push(`${edge.sourceNodeId}: ${srcRes.missingDataReason}`);
          }
        } else if (localScoringRule) {
          const proxySliceFilter =
            (srcNode.params?.sliceFilter as Record<string, unknown> | undefined) ??
            effectDef.metricBinding?.sliceFilter;
          const proxyTargetField =
            (typeof srcNode.params?.targetField === 'string'
              ? srcNode.params.targetField
              : undefined) ?? effectDef.metricBinding?.targetField;
          const proxyReduce =
            (srcNode.params?.reduce as IndicatorReduceMethod | undefined) ??
            effectDef.metricBinding?.reduce;

          const extracted = proxyCtx
            ? extractMetricInputValue(proxyCtx.metricId, proxyCtx.input, {
                sliceFilter: proxySliceFilter,
                targetField: proxyTargetField,
                reduce: proxyReduce,
              })
            : {
                rawValue: srcRes.rawValue ?? null,
                status: srcRes.status,
                evidenceRefs: srcRes.evidenceRefs,
              };

          if (extracted.status === 'unavailable') {
            childScore = null;
            if (extracted.missingDataReason) {
              childMissingReasons.push(`${edge.sourceNodeId}: ${extracted.missingDataReason}`);
            }
          } else {
            childScore = applyScoringRule(extracted.rawValue, localScoringRule);
            if (childScore === null) {
              childMissingReasons.push(`${edge.sourceNodeId}: 评分规则输出为空`);
            }
          }
        } else if (effectDef.aggregation.strategy === 'formula') {
          if (typeof srcRes.rawValue === 'number' && Number.isFinite(srcRes.rawValue)) {
            childScore = srcRes.rawValue;
          } else if (typeof srcRes.rawValue === 'boolean') {
            childScore = srcRes.rawValue ? 1 : 0;
          } else {
            childScore = null;
            childMissingReasons.push(`${edge.sourceNodeId}: 无有效数值供公式引用`);
          }
        } else {
          childScore = null;
          childMissingReasons.push(
            `${edge.sourceNodeId}: metric_proxy 接入加权合成效果前需配置 scoringRule`,
          );
        }
      } else if (childScore === null && srcRes.missingDataReason) {
        childMissingReasons.push(`${edge.sourceNodeId}: ${srcRes.missingDataReason}`);
      }

      childInputs.push({
        id: childInputId,
        nodeCode: edge.targetAlias || edge.sourceNodeId,
        weight,
        score: childScore,
      });
    }

    const aggRes = calculateNodeAggregation(
      effectDef.aggregation.strategy,
      effectDef.aggregation.missingPolicy,
      childInputs,
      effectDef.aggregation.customFormula,
    );

    const effectiveWeights: Record<string, number> = {};
    for (let i = 0; i < incomingEdges.length; i += 1) {
      effectiveWeights[incomingEdges[i].id] = aggRes.effectiveWeights[i] ?? 0;
    }

    let status: 'valid' | 'degraded' | 'unavailable';
    let missingDataReason: string | undefined;

    if (aggRes.score === null) {
      status = 'unavailable';
      missingDataReason =
        childMissingReasons.length > 0
          ? `子节点不可用 (${childMissingReasons.join('；')})`
          : `合成策略 ${aggRes.strategyUsed} 无法算出有效分值`;
    } else if (aggRes.availableWeightRatio < 1 || hasDegradedChild) {
      status = 'degraded';
      if (aggRes.availableWeightRatio < 1) {
        missingDataReason = `部分上游节点缺失，已按 ${aggRes.missingPolicyUsed} 策略重归一 (可用权重 ${(aggRes.availableWeightRatio * 100).toFixed(1)}%${
          childMissingReasons.length > 0 ? `；缺失原因: ${childMissingReasons.join('；')}` : ''
        })`;
      }
    } else {
      status = 'valid';
    }

    let gateStatus: GateStatus | undefined;
    if (role === 'gate') {
      if (aggRes.score === null) {
        gateStatus = 'unavailable';
      } else if (effectDef.metricBinding?.alarmThreshold) {
        gateStatus = isAlarmThresholdTriggered(
          aggRes.score,
          effectDef.metricBinding.alarmThreshold,
        )
          ? 'violated'
          : 'pass';
      } else {
        gateStatus = hasViolatedGateChild || aggRes.score <= 0 ? 'violated' : 'pass';
      }
    }

    nodeResults[nodeId] = {
      nodeId,
      effectId: effectDef.effectId,
      label: node.label || effectDef.name,
      role,
      gateMode,
      gateStatus,
      score: aggRes.score,
      status,
      availableWeightRatio: aggRes.availableWeightRatio,
      effectiveWeights,
      strategyUsed: aggRes.strategyUsed,
      missingPolicyUsed: aggRes.missingPolicyUsed,
      missingDataReason,
      evidenceRefs: mergeEvidenceRefs(evidenceGroups),
      incomingEdgeIds,
      depth,
    };
  }

  // ── 双轨安全红线门控审计（遍历全图全部 role === 'gate' 节点） ──
  const gateAudit: GateAuditItem[] = [];
  let hasHardViolation = false;
  let hasSoftViolation = false;

  for (const nodeId of topo.topologicalOrder) {
    const res = nodeResults[nodeId];
    if (!res || res.role !== 'gate') continue;

    const gateMode = res.gateMode ?? 'soft';
    const gateStatus: GateStatus =
      res.gateStatus ?? (res.status === 'unavailable' ? 'unavailable' : 'pass');

    gateAudit.push({
      atomId: res.effectId ?? res.nodeId,
      name: res.label,
      gateMode,
      gateStatus,
      displayValue: formatGateDisplayValue(res),
      evidenceRefs: res.evidenceRefs,
    });

    if (gateStatus === 'violated') {
      if (gateMode === 'hard') hasHardViolation = true;
      else hasSoftViolation = true;
    }
  }

  const gateVerdict: GateVerdict = hasHardViolation
    ? 'DISQUALIFIED'
    : hasSoftViolation
      ? 'WARNING'
      : 'PASS';

  const terminalResult = nodeResults[dag.terminalEffectNodeId];
  const rawOverallScore = terminalResult?.score ?? null;
  const overallScore =
    rawOverallScore === null
      ? null
      : hasHardViolation
        ? Math.min(rawOverallScore, 39)
        : rawOverallScore;

  return {
    evalId,
    runId,
    systemId: dag.systemId,
    systemName: dag.name,
    systemVersion: dag.version,
    createdAt: new Date().toISOString(),
    terminalEffectNodeId: dag.terminalEffectNodeId,
    overallScore,
    rawOverallScore,
    gateVerdict,
    gateAudit,
    availableWeightRatio: terminalResult?.availableWeightRatio ?? 0,
    nodeResults,
    topologicalOrder: topo.topologicalOrder,
    resolvedParamOverrides,
  };
}
