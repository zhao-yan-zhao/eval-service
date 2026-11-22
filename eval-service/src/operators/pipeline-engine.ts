/**
 * 算子流水线引擎 (Pipeline Engine) 与即时试算预览 (Dry-Run Preview)
 * 满足 Stage 10 & 11 算子流水线核心契约：
 * 1. 统一调度 行内公式 (formula_pipeline) 与 跨行分组聚合 (aggregation)
 * 2. 预览试算 executeFormulaOrAggPreview:
 *    - 接收采样数据集与节点配置
 *    - 执行零副作用沙箱试算
 *    - 返回预览 Schema、高亮差异列 (diffCols)、行切片、试算延时 (latencyMs)
 * 3. 完整的容错兜底与异常捕获
 */

import type {
  AggregationOperatorConfig,
  DerivedColumnConfig,
  FormulaOperatorConfig,
  PipelinePreviewResult,
  TableDataset,
} from '../core/types.ts';
import {
  evaluateAggregationDataset,
  validateAggregationConfig,
} from './aggregation-engine.ts';
import {
  evaluateFormulaDataset,
  sortDerivedColumns,
} from './formula-engine.ts';

export type PipelineNodeConfig =
  | {
      type: 'formula' | 'formula_pipeline';
      formulaConfig: FormulaOperatorConfig;
    }
  | {
      type: 'aggregation';
      aggregationConfig: AggregationOperatorConfig;
    }
  | (FormulaOperatorConfig & { type?: 'formula' | 'formula_pipeline' })
  | (AggregationOperatorConfig & { type?: 'aggregation' });

/**
 * 判断节点类型是聚合还是公式
 */
export function isAggregationNode(nodeConfig: any): boolean {
  if (!nodeConfig) return false;
  if (nodeConfig.type === 'aggregation') return true;
  if (nodeConfig.aggregationConfig) return true;
  if (Array.isArray(nodeConfig.metrics)) return true;
  return false;
}

/**
 * 提取规范的 FormulaOperatorConfig
 */
export function extractFormulaConfig(nodeConfig: any): FormulaOperatorConfig {
  const rawCols =
    nodeConfig?.formulaConfig?.derivedColumns ??
    nodeConfig?.derivedColumns ??
    [];
  const derivedColumns: DerivedColumnConfig[] = (Array.isArray(rawCols) ? rawCols : []).map(
    (c: any) => {
      const colName = c.columnName || c.name || '';
      return {
        ...c,
        columnName: colName,
        name: colName,
      };
    },
  );
  return {
    derivedColumns,
    upstreamColumns:
      nodeConfig?.formulaConfig?.upstreamColumns ?? nodeConfig?.upstreamColumns,
  };
}

/**
 * 提取规范的 AggregationOperatorConfig (全面兼容 groupKeys/groupBy 与 metrics/aggregations 别名)
 */
export function extractAggregationConfig(nodeConfig: any): AggregationOperatorConfig {
  const raw = nodeConfig?.aggregationConfig ?? nodeConfig ?? {};
  const groupKeys: string[] = raw.groupKeys ?? raw.groupBy ?? [];
  const rawMetrics: any[] = Array.isArray(raw.metrics)
    ? raw.metrics
    : Array.isArray(raw.aggregations)
    ? raw.aggregations
    : [];

  const metrics: AggregationMetricItem[] = rawMetrics.map((m: any) => ({
    id: m.id,
    targetField: m.targetField ?? m.outputField ?? '',
    sourceColumn: m.sourceColumn ?? m.sourceField ?? '',
    method: m.method ?? 'AVERAGE',
    dataType: m.dataType,
    description: m.description,
  }));

  return { groupKeys, metrics };
}

/**
 * 单节点执行器
 */
export function executePipelineNode(
  dataset: TableDataset,
  nodeConfig: PipelineNodeConfig,
): TableDataset {
  if (isAggregationNode(nodeConfig)) {
    const aggConfig = extractAggregationConfig(nodeConfig);
    return evaluateAggregationDataset(dataset, aggConfig);
  }
  const formulaConfig = extractFormulaConfig(nodeConfig);
  return evaluateFormulaDataset(dataset, formulaConfig);
}

/**
 * 多节点串联流水线执行器
 */
export function executePipeline(
  initialDataset: TableDataset,
  nodes: PipelineNodeConfig[],
): TableDataset {
  let currentDataset = initialDataset;
  for (const node of nodes) {
    currentDataset = executePipelineNode(currentDataset, node);
  }
  return currentDataset;
}

/**
 * 预览试算 Dry-Run 核心入口
 * @param sampleDataset 采样数据集
 * @param nodeConfig 算子配置（公式或聚合）
 * @param options maxPreviewRows（默认最多返回前 100 行用于前端展示）
 */
export function executeFormulaOrAggPreview(
  sampleDataset: TableDataset,
  nodeConfig: any,
  options?: { maxPreviewRows?: number },
): PipelinePreviewResult {
  const t0 = performance.now();
  const maxRows = options?.maxPreviewRows ?? 100;

  if (!sampleDataset || !Array.isArray(sampleDataset.rows)) {
    return {
      previewSchema: [],
      previewRows: [],
      totalRows: 0,
      diffCols: [],
      latencyMs: 0,
      success: false,
      errors: ['采样数据集 sampleDataset 为空或格式非法'],
    };
  }

  try {
    const isAgg = isAggregationNode(nodeConfig);
    let diffCols: string[] = [];
    let resultDataset: TableDataset;

    // 确保 sampleDataset 兼容 columns 与 schema 结构 (同时兼容 string[] 与 DatasetColumn[])
    const rawCols = sampleDataset.columns ?? (sampleDataset as any).schema ?? [];
    const normalizedCols: DatasetColumn[] = rawCols.map((c: any) =>
      typeof c === 'string'
        ? { name: c, type: 'string' }
        : { name: c?.name || '', type: c?.type || 'string' },
    );
    const colNames = normalizedCols.map((c) => c.name);
    const normalizedSample: TableDataset = {
      ...sampleDataset,
      columns: normalizedCols,
      schema: normalizedCols,
    };

    if (isAgg) {
      const aggConfig = extractAggregationConfig(nodeConfig);
      const valErrs = validateAggregationConfig(aggConfig, colNames);
      if (valErrs.length > 0) {
        return {
          previewSchema: normalizedCols,
          previewRows: [],
          totalRows: 0,
          diffCols: [],
          latencyMs: Math.round((performance.now() - t0) * 100) / 100,
          success: false,
          errors: valErrs,
        };
      }
      diffCols = aggConfig.metrics.map((m) => m.targetField);
      resultDataset = evaluateAggregationDataset(normalizedSample, aggConfig);
    } else {
      const formulaConfig = extractFormulaConfig(nodeConfig);
      // 先进行 Kahn 拓扑排序校验环依赖
      if (formulaConfig.derivedColumns && formulaConfig.derivedColumns.length > 0) {
        sortDerivedColumns(formulaConfig.derivedColumns);
      }
      diffCols = (formulaConfig.derivedColumns ?? [])
        .map((c: any) => c.columnName || c.name || '')
        .filter(Boolean);
      resultDataset = evaluateFormulaDataset(normalizedSample, formulaConfig);
    }

    const previewRows = resultDataset.rows.slice(0, maxRows);
    const latencyMs = Math.round((performance.now() - t0) * 100) / 100;

    return {
      previewSchema: resultDataset.columns,
      previewRows,
      totalRows: resultDataset.rows.length,
      dataset: resultDataset,
      diffCols,
      latencyMs,
      success: true,
    };
  } catch (err) {
    const latencyMs = Math.round((performance.now() - t0) * 100) / 100;
    const msg = err instanceof Error ? err.message : String(err);
    return {
      previewSchema: sampleDataset.columns ?? [],
      previewRows: [],
      totalRows: 0,
      diffCols: [],
      latencyMs,
      success: false,
      errors: [msg],
    };
  }
}
