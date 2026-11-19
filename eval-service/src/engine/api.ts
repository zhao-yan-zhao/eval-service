/**
 * 算子中台 API 适配器与协同接口
 * 承载 Stage 10/11/12 核心能力：
 * 1. POST /api/operators/preview
 * 2. POST /api/operators/validate-formula
 * 3. GET /api/operators/categories
 */

import type {
  AggregationOperatorConfig,
  DerivedColumnConfig,
  FormulaOperatorConfig,
  PipelineCategory,
  PipelinePreviewResult,
  TableDataset,
} from '../core/types.ts';
import { CustomOperatorStore, defaultCustomOperatorStore } from '../operators/custom-store.ts';
import { validateFormula } from '../operators/formula-engine.ts';
import { OperatorOverrideStore, defaultOperatorOverrideStore } from '../operators/override-store.ts';
import {
  executeFormulaOrAggPreview,
  extractAggregationConfig,
  extractFormulaConfig,
  isAggregationNode,
} from '../operators/pipeline-engine.ts';
import {
  listOperatorMetas,
  PIPELINE_CATEGORY_METADATA,
} from '../operators/registry.ts';

export interface OperatorPreviewRequestBody {
  sampleDataset?: TableDataset;
  dataset?: TableDataset;
  nodeConfig?: any;
  formulaConfig?: FormulaOperatorConfig;
  aggregationConfig?: AggregationOperatorConfig;
  type?: 'formula' | 'formula_pipeline' | 'aggregation';
  maxPreviewRows?: number;
}

export interface ValidateFormulaRequestBody {
  expression?: string;
  formula?: string;
  availableColumns?: string[];
  columns?: string[];
}

/**
 * 处理算子流水线预览试算 (Dry-Run Preview)
 */
export function handleOperatorPreview(
  body: OperatorPreviewRequestBody,
): PipelinePreviewResult & { ok: boolean } {
  const rawSample = body.sampleDataset ?? body.dataset ?? { columns: [], rows: [] };
  const sampleCols = rawSample.columns ?? (rawSample as any).schema ?? [];
  const sample = {
    ...rawSample,
    columns: sampleCols,
    schema: sampleCols,
  };
  const rawNodeConfig =
    body.nodeConfig ??
    (body.type === 'aggregation' || body.aggregationConfig
      ? { type: 'aggregation', aggregationConfig: body.aggregationConfig }
      : { type: 'formula_pipeline', formulaConfig: body.formulaConfig });

  const result = executeFormulaOrAggPreview(sample, rawNodeConfig, {
    maxPreviewRows: body.maxPreviewRows ?? 100,
  });

  return {
    ok: result.success,
    ...result,
  };
}

/**
 * 校验 LibFormula 语法与提取引用变量
 */
export function handleValidateFormula(body: ValidateFormulaRequestBody): {
  ok: boolean;
  valid: boolean;
  errors: string[];
  referencedVariables: string[];
} {
  const expr = body.expression ?? body.formula ?? '';
  const cols = body.availableColumns ?? body.columns;
  const res = validateFormula(expr, cols);
  return {
    ok: true,
    valid: res.valid,
    errors: res.errors,
    referencedVariables: res.referencedVariables,
  };
}

/**
 * 获取算子分类统计元数据（四类流水线 + 五大业务域）
 */
export function getOperatorCategories(
  customStore: CustomOperatorStore = defaultCustomOperatorStore,
  overrideStore: OperatorOverrideStore = defaultOperatorOverrideStore,
) {
  const allOps = listOperatorMetas(customStore, overrideStore);

  const byPipelineCategory: Record<PipelineCategory, number> = {
    data_input: 0,
    inline_calc: 0,
    group_agg: 0,
    spatial: 0,
    python_script: 0,
    result_output: 0,
  };

  const byDomainCategory: Record<string, number> = {
    time: 0,
    effectiveness: 0,
    situation: 0,
    compliance: 0,
    cost: 0,
  };

  const operatorIdsByPipelineCategory: Record<PipelineCategory, string[]> = {
    data_input: [],
    inline_calc: [],
    group_agg: [],
    spatial: [],
    python_script: [],
    result_output: [],
  };

  for (const op of allOps) {
    const pCat = (op.pipelineCategory as PipelineCategory) || 'inline_calc';
    if (pCat in byPipelineCategory) {
      byPipelineCategory[pCat] += 1;
      operatorIdsByPipelineCategory[pCat].push(op.id);
    }
    if (op.category in byDomainCategory) {
      byDomainCategory[op.category] = (byDomainCategory[op.category] ?? 0) + 1;
    }
  }

  const categories = PIPELINE_CATEGORY_METADATA.map((cat) => ({
    ...cat,
    count: byPipelineCategory[cat.id as PipelineCategory] ?? 0,
    operatorIds: operatorIdsByPipelineCategory[cat.id as PipelineCategory] ?? [],
  }));

  const domainCategories = [
    { id: 'time', name: '时效域 (Time)', count: byDomainCategory.time ?? 0 },
    { id: 'effectiveness', name: '效能域 (Effectiveness)', count: byDomainCategory.effectiveness ?? 0 },
    { id: 'situation', name: '态势域 (Situation)', count: byDomainCategory.situation ?? 0 },
    { id: 'compliance', name: '合规域 (Compliance)', count: byDomainCategory.compliance ?? 0 },
    { id: 'cost', name: '成本域 (Cost)', count: byDomainCategory.cost ?? 0 },
  ];

  return {
    ok: true,
    totalOperators: allOps.length,
    categories,
    domainCategories,
    counts: {
      byPipelineCategory,
      byDomainCategory,
    },
  };
}
