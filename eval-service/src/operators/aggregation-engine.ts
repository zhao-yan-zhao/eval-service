/**
 * 跨行分组聚合引擎 (Streaming Single-Pass Hash Aggregator)
 * 满足 Stage 11 算子流水线核心契约：
 * 1. 复合主键哈希分组 (Composite groupKeys hashing)
 * 2. 全表标量聚合 (groupKeys 为空时 N -> 1 纯标量归约)
 * 3. 统计方法全量支持：
 *    - AVERAGE: 数值平均值
 *    - SUM: 数值累加和
 *    - MAX: 最大值
 *    - MIN: 最小值
 *    - COUNT_ALL: 样本总行数（包含空值）
 *    - COUNT_DISTINCT: 唯一非空基数
 *    - COUNT_NON_EMPTY: 非空行数
 *    - STDEV: 样本标准差 (Welford 单趟算法)
 *    - STDEVP: 总体标准差 (Welford 单趟算法)
 *    - FIRST: 首次观测值
 *    - LAST: 末次观测值
 * 4. 健壮的空值保护、类型安全推导与异常防御
 * 5. evaluateAggregationDataset(dataset, config): TableDataset
 */

import type {
  AggregationMethod,
  AggregationMetricItem,
  AggregationOperatorConfig,
  DatasetColumn,
  FieldDataType,
  TableDataset,
} from '../core/types.ts';

// ──────────────────── 单指标单趟累加器 ────────────────────

interface MetricAccumulator {
  countAll: number;
  countNonEmpty: number;
  distinctSet: Set<unknown>;
  sum: number;
  validNumCount: number;
  min: number | null;
  max: number | null;
  // Welford 算法状态（单趟计算均值与平方和差 M2）
  mean: number;
  M2: number;
  firstValue: unknown;
  hasFirst: boolean;
  lastValue: unknown;
}

function createMetricAccumulator(): MetricAccumulator {
  return {
    countAll: 0,
    countNonEmpty: 0,
    distinctSet: new Set(),
    sum: 0,
    validNumCount: 0,
    min: null,
    max: null,
    mean: 0,
    M2: 0,
    firstValue: null,
    hasFirst: false,
    lastValue: null,
  };
}

function coerceToNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function updateMetricAccumulator(acc: MetricAccumulator, val: unknown): void {
  acc.countAll += 1;

  if (val !== null && val !== undefined && val !== '') {
    acc.countNonEmpty += 1;
  }

  if (val !== null && val !== undefined) {
    acc.distinctSet.add(val);
    if (!acc.hasFirst) {
      acc.firstValue = val;
      acc.hasFirst = true;
    }
    acc.lastValue = val;
  }

  const num = coerceToNumber(val);
  if (num !== null) {
    acc.validNumCount += 1;
    acc.sum += num;
    if (acc.min === null || num < acc.min) acc.min = num;
    if (acc.max === null || num > acc.max) acc.max = num;

    // Welford 均值与二阶累加
    const delta = num - acc.mean;
    acc.mean += delta / acc.validNumCount;
    const delta2 = num - acc.mean;
    acc.M2 += delta * delta2;
  }
}

function finalizeMetric(method: AggregationMethod, acc: MetricAccumulator): unknown {
  switch (method) {
    case 'COUNT_ALL':
      return acc.countAll;

    case 'COUNT_NON_EMPTY':
      return acc.countNonEmpty;

    case 'COUNT_DISTINCT':
      return acc.distinctSet.size;

    case 'SUM':
      return acc.validNumCount > 0 ? Math.round(acc.sum * 1000000) / 1000000 : 0;

    case 'AVERAGE':
      if (acc.validNumCount === 0) return null;
      return Math.round((acc.sum / acc.validNumCount) * 1000000) / 1000000;

    case 'MAX':
      return acc.max !== null ? Math.round(acc.max * 1000000) / 1000000 : null;

    case 'MIN':
      return acc.min !== null ? Math.round(acc.min * 1000000) / 1000000 : null;

    case 'STDEV': {
      // 样本标准差：sqrt(M2 / (n - 1))
      if (acc.validNumCount < 2) return null;
      const sampleVar = acc.M2 / (acc.validNumCount - 1);
      return Math.round(Math.sqrt(Math.max(0, sampleVar)) * 1000000) / 1000000;
    }

    case 'STDEVP': {
      // 总体标准差：sqrt(M2 / n)
      if (acc.validNumCount < 1) return null;
      const popVar = acc.M2 / acc.validNumCount;
      return Math.round(Math.sqrt(Math.max(0, popVar)) * 1000000) / 1000000;
    }

    case 'FIRST':
      return acc.firstValue ?? null;

    case 'LAST':
      return acc.lastValue ?? null;

    default:
      return null;
  }
}

// ──────────────────── 分组桶模型 ────────────────────

interface GroupBucket {
  keyValues: Record<string, unknown>;
  metricAccs: Map<string, MetricAccumulator>;
}

// ──────────────────── 聚合配置合法性校验 ────────────────────

export function validateAggregationConfig(
  config: AggregationOperatorConfig,
  availableColumns?: string[],
): string[] {
  const errs: string[] = [];
  if (!config) {
    errs.push('聚合配置不能为空');
    return errs;
  }

  if (!Array.isArray(config.metrics) || config.metrics.length === 0) {
    errs.push('聚合算子至少需要配置 1 项度量统计 (metrics)');
  }

  const seenTargets = new Set<string>();
  const groupKeySet = new Set(config.groupKeys ?? []);

  for (let i = 0; i < (config.metrics ?? []).length; i += 1) {
    const m = config.metrics[i];
    const prefix = `度量 #${i + 1}`;
    if (!m.targetField || !m.targetField.trim()) {
      errs.push(`${prefix} 输出字段名 (targetField) 不能为空`);
    } else {
      if (seenTargets.has(m.targetField)) {
        errs.push(`${prefix} 输出字段名 "${m.targetField}" 重复定义`);
      }
      if (groupKeySet.has(m.targetField)) {
        errs.push(`${prefix} 输出字段名 "${m.targetField}" 不能与分组主键同名`);
      }
      seenTargets.add(m.targetField);
    }

    if (m.method !== 'COUNT_ALL' && (!m.sourceColumn || !m.sourceColumn.trim())) {
      errs.push(`${prefix} 统计方法 "${m.method}" 必须指定数据源列 (sourceColumn)`);
    }
  }

  if (availableColumns && availableColumns.length > 0) {
    const colSet = new Set(availableColumns);
    for (const gk of config.groupKeys ?? []) {
      if (!colSet.has(gk)) {
        errs.push(`分组主键 "${gk}" 在上游数据集中不存在`);
      }
    }
    for (const m of config.metrics ?? []) {
      if (m.method !== 'COUNT_ALL' && m.sourceColumn && !colSet.has(m.sourceColumn)) {
        errs.push(`度量字段 "${m.targetField}" 引用的数据源列 "${m.sourceColumn}" 在上游数据集中不存在`);
      }
    }
  }

  return errs;
}

// ──────────────────── 单趟哈希聚合执行 ────────────────────

export function evaluateAggregationDataset(
  dataset: TableDataset,
  config: AggregationOperatorConfig,
): TableDataset {
  const validationErrs = validateAggregationConfig(config);
  if (validationErrs.length > 0) {
    throw new Error(`聚合算子参数校验失败: ${validationErrs.join('; ')}`);
  }

  const groupKeys = config.groupKeys ?? [];
  const metrics = config.metrics ?? [];

  // 哈希桶集合：key -> GroupBucket
  const bucketMap = new Map<string, GroupBucket>();

  const getBucketKey = (row: Record<string, unknown>): string => {
    if (groupKeys.length === 0) return '__GLOBAL_AGGREGATION__';
    return JSON.stringify(groupKeys.map((k) => row[k] ?? null));
  };

  const getOrCreateBucket = (row: Record<string, unknown>): GroupBucket => {
    const key = getBucketKey(row);
    let bucket = bucketMap.get(key);
    if (!bucket) {
      const keyValues: Record<string, unknown> = {};
      for (const k of groupKeys) {
        keyValues[k] = row[k] ?? null;
      }
      const metricAccs = new Map<string, MetricAccumulator>();
      for (const m of metrics) {
        const tf = m.targetField ?? m.outputField ?? '';
        metricAccs.set(tf, createMetricAccumulator());
      }
      bucket = { keyValues, metricAccs };
      bucketMap.set(key, bucket);
    }
    return bucket;
  };

  // 1. 单趟流式聚合
  for (const row of dataset.rows) {
    const bucket = getOrCreateBucket(row);
    for (const m of metrics) {
      const tf = m.targetField ?? m.outputField ?? '';
      const sc = m.sourceColumn ?? m.sourceField ?? '';
      const acc = bucket.metricAccs.get(tf)!;
      const rawVal = m.method === 'COUNT_ALL' ? 1 : row[sc];
      updateMetricAccumulator(acc, rawVal);
    }
  }

  // 若数据集为空且属于全表聚合 (groupKeys 为空)，必须生成 1 行空值/默认度量（严格对齐 SQL 规范）
  if (dataset.rows.length === 0 && groupKeys.length === 0) {
    const emptyRow: Record<string, unknown> = {};
    const metricAccs = new Map<string, MetricAccumulator>();
    for (const m of metrics) {
      const tf = m.targetField ?? m.outputField ?? '';
      metricAccs.set(tf, createMetricAccumulator());
    }
    bucketMap.set('__GLOBAL_AGGREGATION__', { keyValues: emptyRow, metricAccs });
  }

  // 2. 组装输出数据集行
  const outputRows: Array<Record<string, unknown>> = [];
  for (const bucket of bucketMap.values()) {
    const outRow: Record<string, unknown> = { ...bucket.keyValues };
    for (const m of metrics) {
      const tf = m.targetField ?? m.outputField ?? '';
      const acc = bucket.metricAccs.get(tf)!;
      outRow[tf] = finalizeMetric(m.method, acc);
    }
    outputRows.push(outRow);
  }

  // 3. 构建输出数据集 Schema
  const datasetCols = dataset.columns ?? (dataset as any).schema ?? [];
  const upstreamColMap = new Map<string, DatasetColumn>();
  for (const c of datasetCols) {
    upstreamColMap.set(c.name, c);
  }

  const outputColumns: DatasetColumn[] = [];

  // 先排分组主键列
  for (const gk of groupKeys) {
    const upCol = upstreamColMap.get(gk);
    outputColumns.push({
      name: gk,
      type: upCol?.type ?? 'string',
      description: upCol?.description ?? `分组主键: ${gk}`,
      isDerived: false,
    });
  }

  // 再排聚合度量输出列
  for (const m of metrics) {
    const tf = m.targetField ?? m.outputField ?? '';
    const sc = m.sourceColumn ?? m.sourceField ?? '';
    let inferredType: FieldDataType = 'number';
    if (m.dataType) {
      inferredType = m.dataType;
    } else if (m.method === 'FIRST' || m.method === 'LAST') {
      const sourceCol = upstreamColMap.get(sc);
      inferredType = sourceCol?.type ?? 'string';
    }

    outputColumns.push({
      name: tf,
      type: inferredType,
      isDerived: true,
      description: m.description ?? `${m.method}(${sc || '*'}) 聚合度量`,
    });
  }

  return {
    columns: outputColumns,
    schema: outputColumns,
    rows: outputRows,
    totalRows: outputRows.length,
  };
}
