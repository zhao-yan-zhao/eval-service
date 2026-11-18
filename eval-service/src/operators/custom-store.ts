import fs from 'node:fs';
import path from 'node:path';
import type {
  CustomOperatorDefinition,
  MetricAtomMeta,
  OperatorFieldContract,
  SourceBindingAgg,
} from '../core/types.ts';
import { validateAggregationConfig } from './aggregation-engine.ts';
import { validateFormula, validateFormulaSyntax } from './formula-engine.ts';
import { sanitizeDefaultParams, sanitizeFieldContract } from './override-store.ts';

const VALID_AGGS = new Set<SourceBindingAgg>([
  'count_rows',
  'count_non_empty',
  'count_distinct',
  'sum',
  'avg',
  'min',
  'max',
  'first_num',
  'last_num',
]);

function deriveContractForCustom(def: CustomOperatorDefinition): OperatorFieldContract {
  const customContract = sanitizeFieldContract(def.f1FieldContract);
  if (def.mode === 'source_binding' && def.sourceBinding) {
    const sb = def.sourceBinding;
    const autoCsvTables = sb.sourceType === 'csv' && sb.csvTable?.trim() ? [sb.csvTable.trim()] : undefined;
    const autoCsvCols =
      sb.sourceType === 'csv' && sb.csvColumn?.trim() ? [sb.csvColumn.trim()] : undefined;
    const autoBsPaths =
      sb.sourceType === 'bs_jsonl' && sb.bsPath?.trim() ? [sb.bsPath.trim()] : undefined;
    const baseNote =
      sb.sourceType === 'csv'
        ? `数据源直连提取：CSV ${sb.csvTable}${sb.csvColumn ? `.${sb.csvColumn}` : ''} (${sb.aggregation})`
        : `数据源直连提取：BS ${sb.bsPath} (${sb.aggregation})`;
    return {
      csvTables: customContract?.csvTables ?? autoCsvTables,
      csvColumns: customContract?.csvColumns ?? autoCsvCols,
      bsFramePaths: customContract?.bsFramePaths ?? autoBsPaths,
      discrepancyNotes: customContract?.discrepancyNotes ?? [baseNote],
    };
  }
  if (def.mode === 'aggregation' && def.aggregationConfig) {
    const agg = def.aggregationConfig;
    const aggCols = agg.metrics.map((m) => m.sourceColumn).filter(Boolean);
    const baseNote = `跨行分组聚合：主键 [${agg.groupKeys.join(', ') || '全局'}]，度量 [${agg.metrics.map((m) => `${m.targetField}=${m.method}(${m.sourceColumn || '*'}` + ')').join(', ')}]`;
    return {
      csvTables: customContract?.csvTables,
      csvColumns: customContract?.csvColumns ?? (aggCols.length > 0 ? aggCols : undefined),
      bsFramePaths: customContract?.bsFramePaths,
      discrepancyNotes: customContract?.discrepancyNotes ?? [baseNote],
    };
  }
  if (def.mode === 'formula_pipeline' && def.formulaConfig) {
    const form = def.formulaConfig;
    const derivedCols = form.derivedColumns.map((c) => `${c.columnName} = ${c.expression}`);
    const baseNote = `行内公式衍生流水线：衍生列 [${derivedCols.join('; ')}]`;
    return {
      csvTables: customContract?.csvTables,
      csvColumns: customContract?.csvColumns,
      bsFramePaths: customContract?.bsFramePaths,
      discrepancyNotes: customContract?.discrepancyNotes ?? [baseNote],
    };
  }
  return {
    ...(customContract?.csvTables ? { csvTables: customContract.csvTables } : {}),
    ...(customContract?.csvColumns ? { csvColumns: customContract.csvColumns } : {}),
    ...(customContract?.bsFramePaths ? { bsFramePaths: customContract.bsFramePaths } : {}),
    discrepancyNotes: customContract?.discrepancyNotes ?? [
      `衍生组合算子表达式: ${def.expression}（变量绑定: ${(def.variables || []).map((v) => `${v.alias}=${v.atomRef}`).join(', ')}）`,
    ],
  };
}

const DEFAULT_CUSTOM_OPERATORS_PATH = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'data',
  'custom-operators.json',
);

export function customDefToMeta(def: CustomOperatorDefinition): MetricAtomMeta {
  const requiredDataSources: MetricAtomMeta['requiredDataSources'] =
    def.mode === 'source_binding' && def.sourceBinding?.sourceType === 'csv'
      ? ['csv']
      : def.mode === 'source_binding'
        ? ['situation']
        : def.mode === 'aggregation' || def.mode === 'formula_pipeline'
          ? ['csv', 'situation']
          : ['situation', 'csv'];

  const pipelineCategory = def.pipelineCategory ?? (
    def.mode === 'aggregation' ? 'group_agg' :
    def.mode === 'formula_pipeline' ? 'inline_calc' :
    def.mode === 'source_binding' ? 'data_input' : 'inline_calc'
  );

  return {
    id: def.id,
    name: def.name,
    category: def.category,
    description: def.description,
    readiness: 'batch_a_ready',
    requiredDataSources,
    outputType: def.outputType,
    unit: def.unit,
    defaultOptimalDirection: def.defaultOptimalDirection,
    isCustom: true,
    mode: def.mode ?? 'formula',
    pipelineCategory,
    defaultParams: def.defaultParams,
    customDef: def,
    f1FieldContract: deriveContractForCustom(def),
  };
}

export class CustomOperatorStore {
  private readonly filePath: string;
  private items: Map<string, CustomOperatorDefinition> = new Map();

  constructor(filePath = DEFAULT_CUSTOM_OPERATORS_PATH) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as CustomOperatorDefinition[];
      if (Array.isArray(parsed)) {
        this.items.clear();
        for (const item of parsed) {
          if (item && typeof item.id === 'string') {
            this.items.set(item.id, item);
          }
        }
      }
    } catch {
      this.items.clear();
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify([...this.items.values()], null, 2), 'utf-8');
  }

  listAll(): CustomOperatorDefinition[] {
    return [...this.items.values()];
  }

  get(id: string): CustomOperatorDefinition | undefined {
    return this.items.get(id);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  validateDefinition(
    def: CustomOperatorDefinition,
    builtinIds: Set<string> = new Set(),
    allKnownIds: Set<string> = new Set(),
  ): string[] {
    const errs: string[] = [];
    if (!def.id || !/^[a-zA-Z][a-zA-Z0-9_.-]{1,63}$/.test(def.id)) {
      errs.push('算子 ID 须以字母开头，仅含字母/数字/点/下划线/短横线 (2-64位)');
    }
    if (builtinIds && builtinIds.has(def.id)) {
      errs.push(`算子 ID "${def.id}" 与内置标准算子冲突，请使用 custom.* 等独立前缀`);
    }
    if (!def.name || !def.name.trim()) {
      errs.push('算子名称 name 不能为空');
    }
    if (def.mode === 'source_binding') {
      const sb = def.sourceBinding;
      if (!sb) {
        errs.push('数据源直连模式必须提供 sourceBinding 配置');
      } else {
        if (sb.sourceType !== 'csv' && sb.sourceType !== 'bs_jsonl') {
          errs.push(`不支持的 sourceType: ${String(sb.sourceType)}`);
        }
        if (!VALID_AGGS.has(sb.aggregation)) {
          errs.push(`不支持的聚合方式: ${String(sb.aggregation)}`);
        }
        if (sb.sourceType === 'csv') {
          if (!sb.csvTable || !sb.csvTable.trim()) {
            errs.push('CSV 直连提取必须指定 CSV 来源表 (csvTable)');
          }
          if (sb.aggregation !== 'count_rows' && (!sb.csvColumn || !sb.csvColumn.trim())) {
            errs.push(`聚合方式 ${sb.aggregation} 必须指定核心字段列 (csvColumn)`);
          }
        } else if (sb.sourceType === 'bs_jsonl') {
          if (!sb.bsPath || !sb.bsPath.trim()) {
            errs.push('BS JSONL 直连提取必须指定路径表达式 (bsPath)');
          }
        }
      }
    } else if (def.mode === 'aggregation') {
      if (!def.aggregationConfig || !Array.isArray(def.aggregationConfig.metrics) || def.aggregationConfig.metrics.length === 0) {
        errs.push('跨行聚合模式必须提供 aggregationConfig 并至少包含 1 个聚合度量 (metrics)');
      } else {
        const valErrs = validateAggregationConfig(def.aggregationConfig);
        errs.push(...valErrs);
      }
    } else if (def.mode === 'formula_pipeline') {
      if (!def.formulaConfig || !Array.isArray(def.formulaConfig.derivedColumns) || def.formulaConfig.derivedColumns.length === 0) {
        errs.push('行内公式计算必须提供 formulaConfig 并至少包含 1 个衍生列 (derivedColumns)');
      } else {
        for (const col of def.formulaConfig.derivedColumns) {
          if (!col.columnName || !col.columnName.trim()) {
            errs.push('衍生列名称 columnName 不能为空');
          }
          if (!col.expression || !col.expression.trim()) {
            errs.push(`衍生列 ${col.columnName || ''} 的表达式不能为空`);
          } else {
            const vRes = validateFormula(col.expression);
            if (!vRes.valid) {
              errs.push(`衍生列 ${col.columnName} 表达式语法错误: ${vRes.errors.join('; ')}`);
            }
          }
        }
      }
    } else if (!Array.isArray(def.variables) || def.variables.length === 0) {
      errs.push('至少需要绑定 1 个底层算子变量 (variables)');
    } else {
      const seenAliases = new Set<string>();
      for (const v of def.variables) {
        if (!v.alias || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v.alias)) {
          errs.push(`变量别名 "${v.alias}" 非法（仅允许字母/数字/下划线）`);
        } else if (seenAliases.has(v.alias)) {
          errs.push(`重复的变量别名 "${v.alias}"`);
        } else {
          seenAliases.add(v.alias);
        }
        if (v.atomRef === def.id) {
          errs.push(`算子 "${def.id}" 存在直接自环引用`);
        } else if (!allKnownIds.has(v.atomRef) && !this.items.has(v.atomRef)) {
          errs.push(`引用的基础算子 "${v.atomRef}" 不存在`);
        }
      }
      // 环检测：确保新依赖边不会在 custom 图里形成环
      const visiting = new Set<string>([def.id]);
      const hasCycle = (nodeId: string): boolean => {
        const target = nodeId === def.id ? def : this.items.get(nodeId);
        if (!target) return false;
        for (const dep of target.variables) {
          if (visiting.has(dep.atomRef)) return true;
          visiting.add(dep.atomRef);
          if (hasCycle(dep.atomRef)) return true;
          visiting.delete(dep.atomRef);
        }
        return false;
      };
      if (hasCycle(def.id)) {
        errs.push(`算子 "${def.id}" 与已有衍生算子形成循环依赖，已拦截`);
      }

      errs.push(...validateFormulaSyntax(def.expression ?? '', [...seenAliases]));
    }
    if (def.defaultParams) {
      const { errors: paramErrs } = sanitizeDefaultParams(def.defaultParams);
      errs.push(...paramErrs);
    }
    return errs;
  }

  upsert(
    def: CustomOperatorDefinition,
    builtinIds: Set<string> = new Set(),
    allKnownIds: Set<string> = new Set(),
  ): CustomOperatorDefinition {
    const errs = this.validateDefinition(def, builtinIds, allKnownIds);
    if (errs.length > 0) {
      throw new Error(`自定义算子校验失败: ${errs.join('；')}`);
    }
    const existing = this.items.get(def.id);
    const { params } = sanitizeDefaultParams(def.defaultParams);
    const cleanContract = sanitizeFieldContract(def.f1FieldContract);
    const nowIso = new Date().toISOString();
    const mode = def.mode ?? 'formula';
    const pipelineCat = def.pipelineCategory ?? (
      mode === 'aggregation' ? 'group_agg' :
      mode === 'formula_pipeline' ? 'inline_calc' :
      mode === 'source_binding' ? 'data_input' : 'inline_calc'
    );
    const clean: CustomOperatorDefinition = {
      ...def,
      mode,
      pipelineCategory: pipelineCat,
      name: def.name.trim(),
      description:
        def.description?.trim() ||
        (mode === 'aggregation' && def.aggregationConfig
          ? `跨行分组汇总 (${def.aggregationConfig.groupKeys.join(', ') || '全局'})`
          : mode === 'formula_pipeline' && def.formulaConfig
            ? `行内公式衍生计算 (${def.formulaConfig.derivedColumns.length} 列)`
            : mode === 'source_binding' && def.sourceBinding
              ? `数据源直连提取 (${def.sourceBinding.sourceType})`
              : `组合表达式：${def.expression}`),
      expression: def.expression ?? '',
      variables: def.variables ?? [],
      formulaConfig: def.formulaConfig,
      aggregationConfig: def.aggregationConfig,
      ...(mode === 'source_binding' && def.sourceBinding ? { sourceBinding: { ...def.sourceBinding } } : {}),
      ...(cleanContract ? { f1FieldContract: cleanContract } : {}),
      unit: def.unit?.trim() || undefined,
      defaultParams: params,
      createdAt: existing?.createdAt ?? def.createdAt ?? nowIso,
      updatedAt: nowIso,
    };
    this.items.set(clean.id, clean);
    this.persist();
    return clean;
  }

  delete(id: string): boolean {
    const removed = this.items.delete(id);
    if (removed) this.persist();
    return removed;
  }
}

export const defaultCustomOperatorStore = new CustomOperatorStore();
