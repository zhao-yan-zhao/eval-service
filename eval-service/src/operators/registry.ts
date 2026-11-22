import fs from 'node:fs';
import path from 'node:path';
import type {
  CustomOperatorDefinition,
  DatasetColumn,
  EvidenceRef,
  FieldDataType,
  MetricAtomContext,
  MetricAtomMeta,
  MetricAtomResult,
  OperatorSweepPoint,
  PipelineCategory,
  TableDataset,
} from '../core/types.ts';
import { locateCsvDirectory, readCsvTable, resolveCanonicalCsvEventName } from '../adapters/csv-adapter.ts';
import { unavailableResult } from './helpers.ts';
import type { OperatorSpec } from './helpers.ts';
import {
  CustomOperatorStore,
  customDefToMeta,
  defaultCustomOperatorStore,
} from './custom-store.ts';
import {
  OperatorOverrideStore,
  defaultOperatorOverrideStore,
} from './override-store.ts';
import { evaluateAggregationDataset } from './aggregation-engine.ts';
import { evaluateFormulaDataset, evaluateFormulaExpression, validateFormulaSyntax } from './formula-engine.ts';
import { evaluateSourceBindingOperator } from './source-extractor.ts';
import type { EvalSqliteStore } from '../adapters/sqlite-store.ts';
import {
  LEGACY_OPERATOR_ID_MAP,
  OPERATORS_V2,
  getLegacyOperatorMigrationHint,
} from './v2/index.ts';

export { LEGACY_OPERATOR_ID_MAP, getLegacyOperatorMigrationHint };
export type { OperatorSpec };

export const ALL_OPERATORS: OperatorSpec[] = [...OPERATORS_V2];

const OPERATOR_MAP = new Map<string, OperatorSpec>(ALL_OPERATORS.map((op) => [op.meta.id, op]));
export const BUILTIN_OPERATOR_IDS = new Set<string>(OPERATOR_MAP.keys());

export const PIPELINE_CATEGORY_METADATA = [
  {
    id: 'data_input',
    name: '数据输入',
    description: '从 CSV 事件表、仿真态势帧 (BS JSONL) 或外部数据库直连提取原始样本',
    color: 'blue',
    badge: '数据输入',
    modes: ['source_binding'],
  },
  {
    id: 'inline_calc',
    name: '行内计算',
    description: '行级公式衍生计算 (LibFormula)，支持四则运算、函数嵌套与多字段逻辑处理',
    color: 'cyan',
    badge: '行内计算',
    modes: ['formula', 'formula_pipeline'],
  },
  {
    id: 'group_agg',
    name: '跨行聚合',
    description: '跨行分组汇总 (N -> 1 或 GroupBy)，支持平均值、极值、累加求和及标准差统计',
    color: 'amber',
    badge: '跨行聚合',
    modes: ['aggregation'],
  },
  {
    id: 'result_output',
    name: '结果输出',
    description: '将流水线计算结果收口为标量指标，输出至二库（指标库）及评估体系',
    color: 'green',
    badge: '结果输出',
    modes: ['result_output'],
  },
  {
    id: 'spatial',
    name: '空间几何',
    description: 'Turf.js 空间几何分析引擎，支持点面包含、安全走廊穿透与几何测距',
    color: 'violet',
    badge: '空间态势',
    modes: ['spatial'],
  },
  {
    id: 'python_script',
    name: 'Python脚本',
    description: 'Python 3.12 外部科学计算与高级算法扩展模型桥接',
    color: 'fuchsia',
    badge: '脚本扩展',
    modes: ['python_script'],
  },
] as const;

export function inferPipelineCategory(op: {
  id: string;
  category?: string;
  outputType?: string;
  requiredDataSources?: string[];
  mode?: string;
  pipelineCategory?: string;
  customDef?: { mode?: string; pipelineCategory?: string };
}): PipelineCategory {
  if (op.pipelineCategory) return op.pipelineCategory as PipelineCategory;
  if (op.customDef?.pipelineCategory) return op.customDef.pipelineCategory as PipelineCategory;

  const mode = op.customDef?.mode ?? op.mode;
  if (mode === 'aggregation') return 'group_agg';
  if (mode === 'formula_pipeline') return 'inline_calc';
  if (mode === 'source_binding') return 'data_input';
  if (mode === 'spatial') return 'spatial';
  if (mode === 'python_script') return 'python_script';

  if (
    op.id.includes('corridor') ||
    op.id.includes('spatial') ||
    op.id.includes('containment') ||
    op.id.includes('centroid') ||
    op.id.includes('scatter') ||
    op.id.includes('hull')
  ) {
    return 'spatial';
  }

  if (op.id.includes('saturation') || op.id.includes('mcda') || op.id.includes('python')) {
    return 'python_script';
  }

  if (op.outputType === 'score') return 'result_output';
  if (
    op.outputType === 'count' ||
    op.outputType === 'ratio' ||
    op.id.includes('ratio') ||
    op.id.includes('total') ||
    op.id.includes('avg') ||
    op.id.includes('count')
  ) {
    return 'group_agg';
  }
  if (op.outputType === 'duration_seconds' || op.outputType === 'rate') {
    return 'inline_calc';
  }
  if (op.requiredDataSources?.includes('csv') || op.requiredDataSources?.includes('situation')) {
    return 'data_input';
  }
  return 'inline_calc';
}

function mergeBuiltinMeta(
  base: MetricAtomMeta,
  overrideStore: OperatorOverrideStore,
): MetricAtomMeta {
  const ov = overrideStore.get(base.id);
  const pipelineCategory = (base as any).pipelineCategory ?? inferPipelineCategory(base);
  const builtinDefaults = {
    name: base.name,
    description: base.description,
    unit: base.unit,
    defaultOptimalDirection: base.defaultOptimalDirection,
    f1FieldContract: base.f1FieldContract,
  };
  if (!ov) {
    return {
      ...base,
      mode: base.mode ?? 'formula',
      pipelineCategory,
      isOverridden: false,
      builtinDefaults,
    };
  }
  const mergedContract = ov.f1FieldContract
    ? {
        csvTables: ov.f1FieldContract.csvTables,
        csvColumns: ov.f1FieldContract.csvColumns,
        bsFramePaths: ov.f1FieldContract.bsFramePaths,
        discrepancyNotes: ov.f1FieldContract.discrepancyNotes,
      }
    : base.f1FieldContract;
  return {
    ...base,
    mode: (ov as any).mode ?? base.mode ?? 'formula',
    pipelineCategory: (ov as any).pipelineCategory ?? pipelineCategory,
    name: ov.name ?? base.name,
    description: ov.description ?? base.description,
    unit: ov.unit !== undefined ? (ov.unit || undefined) : base.unit,
    defaultOptimalDirection: ov.defaultOptimalDirection ?? base.defaultOptimalDirection,
    defaultParams: ov.defaultParams,
    f1FieldContract: mergedContract,
    isOverridden: true,
    builtinDefaults,
  };
}

export function listOperatorMetas(
  customStore: CustomOperatorStore = defaultCustomOperatorStore,
  overrideStore: OperatorOverrideStore = defaultOperatorOverrideStore,
  sqliteStore?: EvalSqliteStore,
): MetricAtomMeta[] {
  const targetSqlite = sqliteStore ?? customStore.getSqliteStore?.();
  let builtins: MetricAtomMeta[];
  if (targetSqlite) {
    const dbRows = targetSqlite.listOperatorDefinitions({ builtinOnly: true });
    builtins = dbRows.map((meta) => mergeBuiltinMeta(meta, overrideStore));
  } else {
    builtins = ALL_OPERATORS.map((op) => mergeBuiltinMeta(op.meta, overrideStore));
  }
  const customs = customStore.listAll().map(customDefToMeta);
  return [...builtins, ...customs];
}

export function getOperatorMeta(
  atomId: string,
  customStore: CustomOperatorStore = defaultCustomOperatorStore,
  overrideStore: OperatorOverrideStore = defaultOperatorOverrideStore,
  sqliteStore?: EvalSqliteStore,
): MetricAtomMeta | undefined {
  const custom = customStore.get(atomId);
  if (custom) return customDefToMeta(custom);

  const targetSqlite = sqliteStore ?? customStore.getSqliteStore?.();
  if (targetSqlite) {
    const dbOp = targetSqlite.getOperatorDefinition(atomId);
    if (dbOp) {
      return mergeBuiltinMeta(dbOp, overrideStore);
    }
  } else {
    const builtin = OPERATOR_MAP.get(atomId);
    if (builtin) return mergeBuiltinMeta(builtin.meta, overrideStore);
  }
  return undefined;
}

function cleanDefinedParams(raw?: Record<string, unknown>): Record<string, unknown> {
  if (!raw) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== undefined && v !== null && v !== '') {
      out[k] = v;
    }
  }
  return out;
}

function mergeOperatorContext(
  ctx: MetricAtomContext,
  defaults?: Record<string, unknown>,
): MetricAtomContext {
  const cleanDefaults = cleanDefinedParams(defaults);
  const cleanCaller = cleanDefinedParams(ctx.customParams);
  if (Object.keys(cleanDefaults).length === 0) {
    return ctx;
  }
  return {
    ...ctx,
    customParams: {
      ...cleanDefaults,
      ...cleanCaller,
    },
  };
}

export function getOperatorSpec(atomId: string): OperatorSpec | undefined {
  return OPERATOR_MAP.get(atomId);
}

export function hasOperator(
  atomId: string,
  customStore: CustomOperatorStore = defaultCustomOperatorStore,
): boolean {
  const targetSqlite = customStore.getSqliteStore?.();
  if (
    OPERATOR_MAP.has(atomId) ||
    Boolean(customStore.get(atomId)) ||
    Boolean(targetSqlite?.getOperatorDefinition(atomId))
  ) {
    return true;
  }
  const V2_PREFIXES = ['custom.', 'moe.', 'kc.', 'wpn.', 'surv.', 'mos.', 'roe.', 'cost.', 'time.', 'effectiveness.', 'situation.', 'compliance.'];
  const baseAtomId = atomId.includes('#')
    ? atomId.split('#')[0]
    : atomId.includes(':') && !V2_PREFIXES.some((p) => atomId.startsWith(p))
      ? atomId.split(':')[0]
      : atomId;
  return (
    OPERATOR_MAP.has(baseAtomId) ||
    Boolean(customStore.get(baseAtomId)) ||
    Boolean(targetSqlite?.getOperatorDefinition(baseAtomId))
  );
}

function resolveInputDatasetForPipeline(
  def: CustomOperatorDefinition,
  ctx: MetricAtomContext,
  customStore: CustomOperatorStore,
  visited: Set<string>,
  overrideStore: OperatorOverrideStore,
): { dataset: TableDataset; evidenceRefs: EvidenceRef[] } | { error: string } {
  const evidenceRefs: EvidenceRef[] = [];

  // 1. 优先使用调用方显式传入的采样数据集
  if (ctx.customParams?.sampleDataset) {
    const ds = ctx.customParams.sampleDataset as TableDataset;
    evidenceRefs.push({
      source: 'csv',
      ref: `sampleDataset:${def.id}`,
      scenarioClock: '-',
      description: `使用调用方提供的采样数据集 (共 ${ds.rows.length} 行)`,
    });
    return { dataset: ds, evidenceRefs };
  }
  if (ctx.customParams?.[`${def.id}_dataset`]) {
    const ds = ctx.customParams[`${def.id}_dataset`] as TableDataset;
    return { dataset: ds, evidenceRefs };
  }

  // 2. 如果存在上游算子依赖 variables，尝试从上游算子结果获取输出数据集
  if (Array.isArray(def.variables) && def.variables.length > 0) {
    const firstVar = def.variables[0];
    const upstreamRes = evaluateOperator(firstVar.atomRef, ctx, customStore, visited, overrideStore);
    if (upstreamRes.status !== 'unavailable' && upstreamRes.details?.outputDataset) {
      const upDs = upstreamRes.details.outputDataset as TableDataset;
      for (const ev of upstreamRes.evidenceRefs || []) {
        if (evidenceRefs.length < 5) evidenceRefs.push(ev);
      }
      return { dataset: upDs, evidenceRefs };
    }
    // 若上游产出标量数值，组装单行变量数据集
    const row: Record<string, unknown> = {};
    const cols: DatasetColumn[] = [];
    for (const v of def.variables) {
      const sub = evaluateOperator(v.atomRef, ctx, customStore, visited, overrideStore);
      row[v.alias] = sub.value;
      cols.push({
        name: v.alias,
        type: typeof sub.value === 'number' ? 'number' : typeof sub.value === 'boolean' ? 'boolean' : 'string',
        isDerived: false,
      });
      for (const ev of sub.evidenceRefs || []) {
        if (evidenceRefs.length < 5) evidenceRefs.push(ev);
      }
    }
    return {
      dataset: {
        columns: cols,
        rows: [row],
        totalRows: 1,
      },
      evidenceRefs,
    };
  }

  // 3. 尝试从绑定的 CSV 数据源提取原始表格数据集
  const csvTableTarget = def.sourceBinding?.csvTable ?? def.f1FieldContract?.csvTables?.[0];
  const candidateCsvDir = ctx.csvDir ?? (ctx.situation?.scenarioPath ? locateCsvDirectory(ctx.situation.scenarioPath) : undefined);
  if (csvTableTarget && candidateCsvDir && fs.existsSync(candidateCsvDir)) {
    try {
      const csvDir = candidateCsvDir;
      const targetClean = csvTableTarget.trim().toLowerCase();
      const csvFiles = fs.readdirSync(csvDir).filter((f) => {
        const canon = resolveCanonicalCsvEventName(f).toLowerCase();
        const stem = f.replace(/\.csv$/i, '').toLowerCase();
        return canon === targetClean || stem === targetClean || f.toLowerCase() === targetClean;
      });
      if (csvFiles.length > 0) {
        const tablePath = path.join(csvDir, csvFiles[0]);
        const parsed = readCsvTable(tablePath, ctx.situation?.timelineId ?? ctx.runId);
        const columns: DatasetColumn[] = parsed.headers.map((h) => ({
          name: h,
          type: 'string',
        }));
        const rows = parsed.rows.map((r) => r.data);
        evidenceRefs.push({
          source: 'csv',
          ref: `CSV:${csvFiles[0]}`,
          scenarioClock: String(rows[0]?.Time ?? '-'),
          description: `从 CSV 表格 ${csvTableTarget} 加载数据集，共 ${rows.length} 行`,
        });
        return {
          dataset: { columns, rows, totalRows: rows.length },
          evidenceRefs,
        };
      }
    } catch {
      // 容错回退
    }
  }

  // 4. 尝试从 Situation 模型构造实体状态数据集
  if (ctx.situation?.units && ctx.situation.units.size > 0) {
    const unitRows = [...ctx.situation.units.values()].map((u) => ({
      unitId: u.unitId,
      unitName: u.unitName,
      side: u.side,
      unitType: u.unitType,
      unitClass: u.unitClass,
      damageState: u.damageState,
      ammoRemaining: u.ammoRemaining,
      trackPointCount: u.trackPoints?.length ?? 0,
    }));
    const columns: DatasetColumn[] = [
      { name: 'unitId', type: 'string' },
      { name: 'unitName', type: 'string' },
      { name: 'side', type: 'string' },
      { name: 'unitType', type: 'string' },
      { name: 'unitClass', type: 'string' },
      { name: 'damageState', type: 'string' },
      { name: 'ammoRemaining', type: 'number' },
      { name: 'trackPointCount', type: 'number' },
    ];
    evidenceRefs.push({
      source: 'frame',
      ref: `situation:units`,
      scenarioClock: ctx.situation.startGameClock ?? '-',
      description: `从推演态势提取单位数据集，共 ${unitRows.length} 个单位`,
    });
    return {
      dataset: { columns, rows: unitRows, totalRows: unitRows.length },
      evidenceRefs,
    };
  }

  // 5. 兜底空数据集
  return {
    dataset: { columns: [], rows: [], totalRows: 0 },
    evidenceRefs,
  };
}

function evalCustomDefinition(
  def: CustomOperatorDefinition,
  ctx: MetricAtomContext,
  customStore: CustomOperatorStore,
  visited: Set<string>,
  overrideStore: OperatorOverrideStore,
): MetricAtomResult {
  if (visited.has(def.id)) {
    return unavailableResult(def.id, `算子 "${def.id}" 存在循环依赖，已拦截`);
  }

  const mergedCtx = mergeOperatorContext(
    ctx,
    def.defaultParams as Record<string, unknown> | undefined,
  );

  if (def.mode === 'source_binding' && def.sourceBinding) {
    return evaluateSourceBindingOperator(def, mergedCtx);
  }

  if (def.mode === 'formula_pipeline') {
    const nextVisited = new Set(visited);
    nextVisited.add(def.id);
    const resolved = resolveInputDatasetForPipeline(def, mergedCtx, customStore, nextVisited, overrideStore);
    if ('error' in resolved) {
      return unavailableResult(def.id, resolved.error);
    }
    const { dataset: inDs, evidenceRefs } = resolved;
    if (!def.formulaConfig) {
      return unavailableResult(def.id, '缺少 formulaConfig 配置');
    }
    try {
      const outDs = evaluateFormulaDataset(inDs, def.formulaConfig);
      let scalarVal: number | boolean | null = null;
      let display = '-';
      const lastDerived = def.formulaConfig.derivedColumns[def.formulaConfig.derivedColumns.length - 1];
      const targetCol = def.targetField ?? lastDerived?.columnName;
      if (targetCol && outDs.rows.length > 0) {
        const raw = outDs.rows[0][targetCol];
        if (typeof raw === 'number' && Number.isFinite(raw)) {
          scalarVal = raw;
        } else if (typeof raw === 'boolean') {
          scalarVal = raw;
        } else if (raw !== null && raw !== undefined) {
          const n = Number(raw);
          scalarVal = Number.isFinite(n) ? n : null;
        }
      }
      display = scalarVal !== null ? `${scalarVal}${def.unit ? ' ' + def.unit : ''}` : '已完成行级衍生';
      evidenceRefs.push({
        source: 'csv',
        ref: `formula_pipeline:${def.id}`,
        scenarioClock: '-',
        description: `行内公式衍生计算完成，总行数: ${outDs.rows.length}，衍生列数: ${def.formulaConfig.derivedColumns.length}`,
      });
      return {
        atomId: def.id,
        value: scalarVal,
        displayValue: display,
        status: scalarVal !== null ? 'valid' : (outDs.rows.length === 0 ? 'unavailable' : 'valid'),
        confidence: 'high',
        evidenceRefs,
        details: {
          isCustom: true,
          isPipeline: true,
          mode: 'formula_pipeline',
          pipelineCategory: 'inline_calc',
          targetField: targetCol,
          outputDataset: outDs,
          fieldValues: outDs.rows[0] ?? {},
          totalRows: outDs.rows.length,
          sampleRows: outDs.rows.slice(0, 10),
        },
      };
    } catch (err) {
      return unavailableResult(def.id, `公式流水线执行失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (def.mode === 'aggregation') {
    const nextVisited = new Set(visited);
    nextVisited.add(def.id);
    const resolved = resolveInputDatasetForPipeline(def, mergedCtx, customStore, nextVisited, overrideStore);
    if ('error' in resolved) {
      return unavailableResult(def.id, resolved.error);
    }
    const { dataset: inDs, evidenceRefs } = resolved;
    if (!def.aggregationConfig) {
      return unavailableResult(def.id, '缺少 aggregationConfig 配置');
    }
    try {
      let currentDs = inDs;
      if (def.formulaConfig && Array.isArray(def.formulaConfig.derivedColumns) && def.formulaConfig.derivedColumns.length > 0) {
        currentDs = evaluateFormulaDataset(currentDs, def.formulaConfig);
      }
      const outDs = evaluateAggregationDataset(currentDs, def.aggregationConfig);
      let scalarVal: number | boolean | null = null;
      const targetMetric = def.targetField ?? def.aggregationConfig.metrics[0]?.targetField;
      if (targetMetric && outDs.rows.length > 0) {
        const raw = outDs.rows[0][targetMetric];
        if (typeof raw === 'number' && Number.isFinite(raw)) {
          scalarVal = raw;
        } else if (typeof raw === 'boolean') {
          scalarVal = raw;
        } else if (raw !== null && raw !== undefined) {
          const n = Number(raw);
          scalarVal = Number.isFinite(n) ? n : null;
        }
      }
      const display = scalarVal !== null ? `${scalarVal}${def.unit ? ' ' + def.unit : ''}` : '无有效聚合统计结果';
      evidenceRefs.push({
        source: 'csv',
        ref: `aggregation:${def.id}`,
        scenarioClock: '-',
        description: `跨行聚合计算完成: ${def.aggregationConfig.metrics.map((m) => `${m.targetField}=${m.method}(${m.sourceColumn || '*'}` + ')').join(', ')}，输入行数: ${inDs.rows.length} -> 聚合行数: ${outDs.rows.length}`,
      });
      return {
        atomId: def.id,
        value: scalarVal,
        displayValue: display,
        status: scalarVal !== null ? 'valid' : 'unavailable',
        confidence: 'high',
        evidenceRefs,
        details: {
          isCustom: true,
          isPipeline: true,
          mode: 'aggregation',
          pipelineCategory: 'group_agg',
          targetField: targetMetric,
          outputDataset: outDs,
          fieldValues: outDs.rows[0] ?? {},
          totalRows: outDs.rows.length,
          sampleRows: outDs.rows.slice(0, 10),
        },
      };
    } catch (err) {
      return unavailableResult(def.id, `聚合流水线执行失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const syntaxErrs = validateFormulaSyntax(
    def.expression,
    def.variables.map((v) => v.alias),
  );
  if (syntaxErrs.length > 0) {
    return unavailableResult(def.id, `表达式语法错误: ${syntaxErrs.join('; ')}`);
  }

  const nextVisited = new Set(visited);
  nextVisited.add(def.id);

  const vars: Record<string, number> = {};
  const evidenceRefs: EvidenceRef[] = [];
  let worstStatus: 'valid' | 'degraded' = 'valid';
  let worstConf: 'high' | 'medium' | 'low' = 'high';

  for (const v of def.variables) {
    const sub = evaluateOperator(v.atomRef, mergedCtx, customStore, nextVisited, overrideStore);
    if (sub.status === 'unavailable' || sub.value === null || sub.value === undefined) {
      return unavailableResult(
        def.id,
        `衍生依赖 [${v.alias}=${v.atomRef}] 不可用：${sub.missingDataReason ?? '缺少底层证据'}`,
      );
    }
    const numVal = typeof sub.value === 'boolean' ? (sub.value ? 1 : 0) : Number(sub.value);
    if (!Number.isFinite(numVal)) {
      return unavailableResult(def.id, `衍生依赖 [${v.alias}=${v.atomRef}] 返回非有限数值`);
    }
    vars[v.alias] = numVal;
    if (sub.status === 'degraded') worstStatus = 'degraded';
    if (sub.confidence === 'low') worstConf = 'low';
    else if (sub.confidence === 'medium' && worstConf === 'high') worstConf = 'medium';

    for (const ev of sub.evidenceRefs) {
      if (evidenceRefs.length < 6) evidenceRefs.push(ev);
    }
  }

  const evaluated = evaluateFormulaExpression(def.expression, vars);
  if (!evaluated.ok) {
    return unavailableResult(def.id, evaluated.reason);
  }

  return {
    atomId: def.id,
    value: evaluated.value,
    displayValue: `${evaluated.value}${def.unit ? ` ${def.unit}` : ''}`,
    status: worstStatus,
    confidence: worstConf,
    evidenceRefs,
    details: {
      isCustom: true,
      expression: def.expression,
      variableValues: vars,
    },
  };
}

export function previewCustomFormula(
  def: CustomOperatorDefinition,
  ctx: MetricAtomContext,
  customStore: CustomOperatorStore = defaultCustomOperatorStore,
  overrideStore: OperatorOverrideStore = defaultOperatorOverrideStore,
): { valid: boolean; errors: string[]; result: MetricAtomResult } {
  const allKnownIds = new Set<string>([
    ...BUILTIN_OPERATOR_IDS,
    ...customStore.listAll().map((c) => c.id),
  ]);
  // 预览允许复用新 ID（不与内置冲突即可）
  const errs = customStore.validateDefinition(def, BUILTIN_OPERATOR_IDS, allKnownIds);
  if (errs.length > 0) {
    return {
      valid: false,
      errors: errs,
      result: unavailableResult(def.id || 'custom.preview', errs.join('；')),
    };
  }
  const result = evalCustomDefinition(def, ctx, customStore, new Set(), overrideStore);
  return { valid: true, errors: [], result };
}

export function evaluateOperator(
  atomId: string,
  ctx: MetricAtomContext,
  customStore: CustomOperatorStore = defaultCustomOperatorStore,
  visited: Set<string> = new Set(),
  overrideStore: OperatorOverrideStore = defaultOperatorOverrideStore,
): MetricAtomResult {
  const spec = OPERATOR_MAP.get(atomId);
  if (spec) {
    const ov = overrideStore.get(atomId);
    const mergedCtx = mergeOperatorContext(
      ctx,
      ov?.defaultParams as Record<string, unknown> | undefined,
    );
    return spec.evaluate(mergedCtx);
  }
  const customDef = customStore.get(atomId);
  if (customDef) {
    return evalCustomDefinition(customDef, ctx, customStore, visited, overrideStore);
  }
  const legacy = getLegacyOperatorMigrationHint(atomId);
  if (legacy) {
    const replText = legacy.replacements.length > 0 ? `请迁移至: ${legacy.replacements.join(', ')}` : '已移出标准内置库（可按需创建自定义算子）';
    return unavailableResult(
      atomId,
      `旧版算子 ${atomId} 已在 Operators v2 中${legacy.action === 'split' ? '拆分重构' : legacy.action === 'replaced' ? '升级替换' : '废弃'}（${legacy.reason}），${replText}`,
    );
  }
  return unavailableResult(atomId, `未注册算子: ${atomId}`);
}

export function evaluateAllOperators(
  ctx: MetricAtomContext,
  customStore: CustomOperatorStore = defaultCustomOperatorStore,
  overrideStore: OperatorOverrideStore = defaultOperatorOverrideStore,
): Record<string, MetricAtomResult> {
  const results: Record<string, MetricAtomResult> = {};
  for (const op of ALL_OPERATORS) {
    const ov = overrideStore.get(op.meta.id);
    const mergedCtx = mergeOperatorContext(
      ctx,
      ov?.defaultParams as Record<string, unknown> | undefined,
    );
    results[op.meta.id] = op.evaluate(mergedCtx);
  }
  for (const c of customStore.listAll()) {
    results[c.id] = evalCustomDefinition(c, ctx, customStore, new Set(), overrideStore);
  }
  return results;
}

export function sweepOperatorParameter(
  atomId: string,
  baseCtx: MetricAtomContext,
  paramKey: 'safeRadiusNm' | 'arrivalLineLon' | 'expectedSpacingNm' | 'minRangeNm' | 'waveGapSeconds',
  minVal: number,
  maxVal: number,
  steps = 9,
  customStore: CustomOperatorStore = defaultCustomOperatorStore,
  overrideStore: OperatorOverrideStore = defaultOperatorOverrideStore,
): OperatorSweepPoint[] {
  const n = Math.max(2, Math.min(25, Math.round(steps)));
  const points: OperatorSweepPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const pv =
      n === 1 ? minVal : Math.round((minVal + ((maxVal - minVal) * i) / (n - 1)) * 1000) / 1000;
    const res = evaluateOperator(
      atomId,
      {
        ...baseCtx,
        customParams: {
          ...(baseCtx.customParams ?? {}),
          [paramKey]: pv,
        },
      },
      customStore,
      new Set(),
      overrideStore,
    );
    const numVal =
      typeof res.value === 'number'
        ? res.value
        : typeof res.value === 'boolean'
          ? res.value
            ? 1
            : 0
          : null;
    points.push({
      paramValue: pv,
      value: numVal,
      status: res.status,
      displayValue: res.displayValue,
    });
  }
  return points;
}
