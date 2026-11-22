import fs from 'node:fs';
import path from 'node:path';
import type { EvalSqliteStore } from '../adapters/sqlite-store.ts';
import { applyScoringRule } from '../core/scoring-functions.ts';
import type {
  AlarmThreshold,
  EvidenceRef,
  IndicatorDefinition,
  IndicatorReduceMethod,
  IndicatorSourceBinding,
  MetricAtomResult,
} from '../core/types.ts';
import { evaluateFormulaExpression, validateFormula } from '../operators/formula-engine.ts';
import { hasOperator } from '../operators/registry.ts';

const BUILTIN_CATALOG_PATH = path.resolve(import.meta.dirname, 'catalog.json');
const DEFAULT_CUSTOM_PATH = path.resolve(import.meta.dirname, '..', '..', 'data', 'custom-indicators.json');

const BUILTIN_ATOM_PREFIXES = [
  'custom.',
  'time.',
  'effectiveness.',
  'eff.',
  'situation.',
  'sit.',
  'compliance.',
  'comp.',
  'cost.',
];

export function extractAtomRefParts(
  atomRef: string,
  explicitTargetField?: string,
): { baseAtomId: string; targetField?: string } {
  if (!atomRef) return { baseAtomId: '', targetField: explicitTargetField };
  if (atomRef.includes('#')) {
    const [base, field] = atomRef.split('#');
    return { baseAtomId: base, targetField: explicitTargetField ?? field };
  }
  if (atomRef.includes(':') && !BUILTIN_ATOM_PREFIXES.some((p) => atomRef.startsWith(p))) {
    const [base, field] = atomRef.split(':');
    return { baseAtomId: base, targetField: explicitTargetField ?? field };
  }
  return { baseAtomId: atomRef, targetField: explicitTargetField };
}

export function isAlarmThresholdTriggered(
  rawVal: number | boolean | null | undefined,
  th?: AlarmThreshold,
): boolean {
  if (!th || rawVal === null || rawVal === undefined) return false;
  const val = typeof rawVal === 'boolean' ? (rawVal ? 1 : 0) : Number(rawVal);
  if (!Number.isFinite(val)) return false;
  switch (th.operator) {
    case '>':
      return val > th.value;
    case '<':
      return val < th.value;
    case '==':
      return Math.abs(val - th.value) < 1e-6;
    case '>=':
      return val >= th.value;
    case '<=':
      return val <= th.value;
    default:
      return false;
  }
}

export class IndicatorStore {
  private readonly customFilePath: string;
  private readonly operatorExists: (atomId: string) => boolean;
  private sqliteStore?: EvalSqliteStore;
  private builtins: IndicatorDefinition[] = [];
  private custom: Map<string, IndicatorDefinition> = new Map();

  constructor(
    customFilePath = DEFAULT_CUSTOM_PATH,
    operatorExists: (atomId: string) => boolean = hasOperator,
    sqliteStore?: EvalSqliteStore,
  ) {
    this.customFilePath = customFilePath;
    this.operatorExists = operatorExists;
    this.sqliteStore = sqliteStore;
    this.load();
  }

  rebindSqliteStore(newStore: EvalSqliteStore): void {
    this.sqliteStore = newStore;
    this.builtins = this.sqliteStore.listIndicators({ builtinOnly: true });
    this.custom.clear();
    const dbCustom = this.sqliteStore.listIndicators({ customOnly: true });
    for (const item of dbCustom) {
      this.custom.set(item.indicatorId, { ...item, builtin: false });
    }
  }

  private load(): void {
    // 1. 加载内置标准指标
    if (this.sqliteStore) {
      const dbBuiltins = this.sqliteStore.listIndicators({ builtinOnly: true });
      if (dbBuiltins.length > 0) {
        this.builtins = dbBuiltins;
      }
    }
    if (this.builtins.length === 0 && fs.existsSync(BUILTIN_CATALOG_PATH)) {
      try {
        const raw = fs.readFileSync(BUILTIN_CATALOG_PATH, 'utf-8');
        const items = JSON.parse(raw) as IndicatorDefinition[];
        this.builtins = items.map((item) => ({ ...item, builtin: true }));
        if (this.sqliteStore) {
          for (const b of this.builtins) {
            this.sqliteStore.saveIndicator(b, true);
          }
        }
      } catch {
        this.builtins = [];
      }
    }

    // 2. 加载用户自定义指标
    if (this.sqliteStore) {
      const dbCustom = this.sqliteStore.listIndicators({ customOnly: true });
      if (dbCustom.length > 0) {
        this.custom.clear();
        for (const item of dbCustom) {
          this.custom.set(item.indicatorId, { ...item, builtin: false });
        }
        return;
      }
    }

    if (fs.existsSync(this.customFilePath)) {
      try {
        const customRaw = fs.readFileSync(this.customFilePath, 'utf-8');
        const customItems = JSON.parse(customRaw) as IndicatorDefinition[];
        this.custom.clear();
        for (const item of customItems) {
          this.custom.set(item.indicatorId, { ...item, builtin: false });
          if (this.sqliteStore) {
            this.sqliteStore.saveIndicator(item, false);
          }
        }
      } catch {
        this.custom.clear();
      }
    }
  }

  private persistCustom(): void {
    if (this.sqliteStore) {
      for (const item of this.custom.values()) {
        this.sqliteStore.saveIndicator(item, false);
      }
    }
    if (this.customFilePath && (!this.sqliteStore || this.customFilePath !== DEFAULT_CUSTOM_PATH)) {
      try {
        fs.mkdirSync(path.dirname(this.customFilePath), { recursive: true });
        const list = [...this.custom.values()];
        fs.writeFileSync(this.customFilePath, JSON.stringify(list, null, 2), 'utf-8');
      } catch {
        // 兼容只读或临时沙箱环境
      }
    }
  }

  listAll(): IndicatorDefinition[] {
    const byId = new Map<string, IndicatorDefinition>();
    for (const b of this.builtins) byId.set(b.indicatorId, b);
    for (const c of this.custom.values()) byId.set(c.indicatorId, c);
    return [...byId.values()];
  }

  isOperatorRegistered(atomId: string): boolean {
    return this.operatorExists(atomId);
  }

  get(indicatorId: string): IndicatorDefinition | undefined {
    return this.custom.get(indicatorId) ?? this.builtins.find((b) => b.indicatorId === indicatorId);
  }

  validateIndicatorInput(def: IndicatorDefinition): string[] {
    const errors: string[] = [];
    if (!def.indicatorId || !/^[a-zA-Z0-9_.-]+$/.test(def.indicatorId)) {
      errors.push('indicatorId 仅允许字母、数字、下划线、点或连字符');
    }
    if (!def.name || def.name.trim().length === 0) {
      errors.push('指标名称 name 不能为空');
    }

    if (def.bindingMode === 'composite') {
      if (!Array.isArray(def.sources) || def.sources.length === 0) {
        errors.push('多算子复合模式下 sources 列表不能为空');
      } else {
        const seenAliases = new Set<string>();
        for (let i = 0; i < def.sources.length; i += 1) {
          const s = def.sources[i];
          if (!s.alias || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(s.alias)) {
            errors.push(
              `第 ${i + 1} 个输入源别名 "${s.alias}" 不合法（仅允许字母、数字、下划线且首字符不能为数字）`,
            );
          } else if (seenAliases.has(s.alias)) {
            errors.push(`存在重复的输入源别名 "${s.alias}"`);
          } else {
            seenAliases.add(s.alias);
          }
          const { baseAtomId: srcBase } = extractAtomRefParts(s.atomRef, s.targetField);
          if (!this.operatorExists(s.atomRef) && (!srcBase || !this.operatorExists(srcBase))) {
            errors.push(`输入源 "${s.alias}" 引用了未注册的算子: ${s.atomRef}`);
          }
        }
        if (!def.composeFormula || !def.composeFormula.trim()) {
          errors.push('多算子复合模式必须指定 composeFormula 合成公式');
        } else {
          const syntaxCheck = validateFormula(def.composeFormula, Array.from(seenAliases));
          if (!syntaxCheck.valid) {
            errors.push(`合成公式语法错误: ${syntaxCheck.errors.join('; ')}`);
          }
        }
      }
    } else {
      const { baseAtomId } = extractAtomRefParts(def.atomRef, def.targetField);
      if (!this.operatorExists(def.atomRef) && (!baseAtomId || !this.operatorExists(baseAtomId))) {
        errors.push(`atomRef 引用了未注册的算子: ${def.atomRef}`);
      }
    }

    if (!def.scoring || !def.scoring.type) {
      errors.push('必须提供 scoring 评分函数配置');
      return errors;
    }
    if (
      (def.scoring.type === 'smaller_is_better' || def.scoring.type === 'larger_is_better') &&
      (typeof def.scoring.optimal !== 'number' ||
        !Number.isFinite(def.scoring.optimal) ||
        typeof def.scoring.worst !== 'number' ||
        !Number.isFinite(def.scoring.worst))
    ) {
      errors.push(`${def.scoring.type} 评分规则必须同时指定有效数值型 optimal 与 worst`);
    }
    if (def.scoring.type === 'linear') {
      if (!Array.isArray(def.scoring.bounds) || def.scoring.bounds.length !== 2) {
        errors.push('linear 评分规则必须指定 bounds: [min, max]');
      } else if (
        !Number.isFinite(def.scoring.bounds[0]) ||
        !Number.isFinite(def.scoring.bounds[1]) ||
        def.scoring.bounds[0] === def.scoring.bounds[1]
      ) {
        errors.push('linear 评分规则 bounds 两端必须为不相等的有效数值');
      }
    }
    if (def.scoring.type === 'target_range') {
      if (!Array.isArray(def.scoring.optimalRange) || def.scoring.optimalRange.length !== 2) {
        errors.push('target_range 评分规则必须指定 optimalRange: [min, max]');
      } else {
        const [optLo, optHi] = def.scoring.optimalRange;
        if (!Number.isFinite(optLo) || !Number.isFinite(optHi) || optLo > optHi) {
          errors.push('target_range 最优区间须满足 optimalRange[0] <= optimalRange[1]');
        }
        if (def.scoring.toleranceRange) {
          const [tolLo, tolHi] = def.scoring.toleranceRange;
          if (
            !Array.isArray(def.scoring.toleranceRange) ||
            def.scoring.toleranceRange.length !== 2 ||
            !Number.isFinite(tolLo) ||
            !Number.isFinite(tolHi) ||
            tolLo > optLo ||
            optHi > tolHi
          ) {
            errors.push('target_range 容忍区间须包络最优区间 (tolLo <= optLo 且 optHi <= tolHi)');
          }
        }
      }
    }
    if (def.scoring.type === 'step') {
      if (!Array.isArray(def.scoring.steps) || def.scoring.steps.length === 0) {
        errors.push('step 阶梯评分规则至少需要 1 档阈值映射 (steps)');
      } else {
        for (const s of def.scoring.steps) {
          if (
            typeof s?.val !== 'number' ||
            !Number.isFinite(s.val) ||
            typeof s?.score !== 'number' ||
            !Number.isFinite(s.score) ||
            s.score < 0 ||
            s.score > 100
          ) {
            errors.push('step 规则每档均须包含有效阈值 val 与 0~100 范围内的分值 score');
            break;
          }
        }
      }
    }
    if (def.scoring.type === 'boolean') {
      if (
        def.scoring.trueScore !== undefined &&
        (typeof def.scoring.trueScore !== 'number' || !Number.isFinite(def.scoring.trueScore))
      ) {
        errors.push('boolean 规则 trueScore 必须为有效数值');
      }
      if (
        def.scoring.falseScore !== undefined &&
        (typeof def.scoring.falseScore !== 'number' || !Number.isFinite(def.scoring.falseScore))
      ) {
        errors.push('boolean 规则 falseScore 必须为有效数值');
      }
    }
    return errors;
  }

  upsertCustom(def: IndicatorDefinition): IndicatorDefinition {
    const errs = this.validateIndicatorInput(def);
    if (errs.length > 0) {
      throw new Error(`指标定义校验失败: ${errs.join('; ')}`);
    }
    const clean: IndicatorDefinition = { ...def, builtin: false };
    this.custom.set(clean.indicatorId, clean);
    if (this.sqliteStore) {
      this.sqliteStore.saveIndicator(clean, false);
    }
    this.persistCustom();
    return clean;
  }

  upsertBatchCustom(defs: IndicatorDefinition[]): IndicatorDefinition[] {
    if (!Array.isArray(defs) || defs.length === 0) {
      throw new Error('批量导入指标列表不能为空');
    }
    const allErrors: string[] = [];
    for (let i = 0; i < defs.length; i += 1) {
      const errs = this.validateIndicatorInput(defs[i]);
      if (errs.length > 0) {
        allErrors.push(`第 ${i + 1} 项 (${defs[i]?.indicatorId || '未命名'}): ${errs.join(', ')}`);
      }
    }
    if (allErrors.length > 0) {
      throw new Error(`批量校验未通过: ${allErrors.join('；')}`);
    }
    const saved: IndicatorDefinition[] = [];
    for (const def of defs) {
      const clean: IndicatorDefinition = { ...def, builtin: false };
      this.custom.set(clean.indicatorId, clean);
      if (this.sqliteStore) {
        this.sqliteStore.saveIndicator(clean, false);
      }
      saved.push(clean);
    }
    this.persistCustom();
    return saved;
  }

  deleteCustom(indicatorId: string): boolean {
    const isBuiltinOnly =
      this.builtins.some((b) => b.indicatorId === indicatorId) && !this.custom.has(indicatorId);
    if (isBuiltinOnly) {
      throw new Error(`不允许删除内置标准指标: ${indicatorId}`);
    }
    const deleted = this.custom.delete(indicatorId);
    if (deleted) {
      if (this.sqliteStore) {
        this.sqliteStore.deleteIndicator(indicatorId);
      }
      this.persistCustom();
    }
    return deleted;
  }
}

export const defaultIndicatorStore = new IndicatorStore();

/**
 * 数组按归约策略聚合为标量数值
 */
export function reduceNumericArray(
  values: number[],
  method: IndicatorReduceMethod = 'first',
): number | null {
  if (values.length === 0) return null;
  switch (method) {
    case 'first':
      return values[0];
    case 'last':
      return values[values.length - 1];
    case 'sum':
      return Math.round(values.reduce((a, b) => a + b, 0) * 10000) / 10000;
    case 'mean':
      return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10000) / 10000;
    case 'max':
      return Math.max(...values);
    case 'min':
      return Math.min(...values);
    case 'median': {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const med = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      return Math.round(med * 10000) / 10000;
    }
    default:
      return values[0];
  }
}

/**
 * 从单个算子输出提取指定字段并支持行过滤与归约
 */
export function extractSingleSourceValue(
  atomRef: string,
  targetField: string | undefined,
  reduceMethod: IndicatorReduceMethod = 'first',
  filterCriteria: Record<string, string | number | boolean> | undefined,
  atomResults: Record<string, MetricAtomResult>,
): {
  numericVal: number | null;
  extractedVal: unknown;
  status: 'valid' | 'degraded' | 'unavailable';
  evidenceRefs: EvidenceRef[];
  missingReason?: string;
  baseResult?: MetricAtomResult;
} {
  const { baseAtomId, targetField: parsedField } = extractAtomRefParts(atomRef, targetField);
  const effectiveField = parsedField;
  const baseResult = atomResults[baseAtomId] ?? atomResults[atomRef];

  if (!baseResult || baseResult.status === 'unavailable') {
    return {
      numericVal: null,
      extractedVal: null,
      status: 'unavailable',
      evidenceRefs: baseResult?.evidenceRefs ?? [],
      missingReason: baseResult?.missingDataReason || `未找到算子 ${baseAtomId} 计算结果`,
      baseResult,
    };
  }

  if (effectiveField) {
    const details = baseResult.details as Record<string, unknown> | undefined;
    const fieldValues = (details?.fieldValues ?? {}) as Record<string, unknown>;
    const outputDataset = details?.outputDataset as { rows?: Array<Record<string, unknown>> } | undefined;
    const rows = (outputDataset?.rows ?? []) as Array<Record<string, unknown>>;

    let candidateRows = rows;
    if (filterCriteria && Object.keys(filterCriteria).length > 0) {
      candidateRows = rows.filter((r) => {
        return Object.entries(filterCriteria).every(([k, v]) => {
          if (r[k] === undefined) return false;
          return String(r[k]).toLowerCase() === String(v).toLowerCase();
        });
      });
      if (candidateRows.length === 0 && rows.length > 0) {
        return {
          numericVal: null,
          extractedVal: null,
          status: 'unavailable',
          evidenceRefs: baseResult.evidenceRefs,
          missingReason: `算子 ${baseAtomId} 输出数据集未找到匹配条件 ${JSON.stringify(filterCriteria)} 的数据行`,
          baseResult,
        };
      }
    }

    let extractedVal: unknown = undefined;
    if (effectiveField in fieldValues) {
      extractedVal = fieldValues[effectiveField];
    } else if (candidateRows.length > 0) {
      const columnVals = candidateRows
        .map((r) => r[effectiveField])
        .filter((v) => v !== undefined && v !== null);

      if (columnVals.length > 0) {
        if (columnVals.length === 1 || reduceMethod === 'first') {
          extractedVal = columnVals[0];
        } else if (reduceMethod === 'last') {
          extractedVal = columnVals[columnVals.length - 1];
        } else {
          const nums = columnVals
            .map((v) => {
              if (typeof v === 'number' && Number.isFinite(v)) return v;
              if (typeof v === 'boolean') return v ? 1 : 0;
              const n = Number(String(v).trim());
              return Number.isFinite(n) ? n : null;
            })
            .filter((n): n is number => n !== null);
          extractedVal = reduceNumericArray(nums, reduceMethod);
        }
      }
    } else if (
      (details?.targetField === effectiveField ||
        (effectiveField === 'value' && Object.keys(fieldValues).length === 0 && rows.length === 0)) &&
      baseResult.value !== null &&
      baseResult.value !== undefined
    ) {
      extractedVal = baseResult.value;
    }

    if (extractedVal === undefined || extractedVal === null) {
      return {
        numericVal: null,
        extractedVal: null,
        status: 'unavailable',
        evidenceRefs: baseResult.evidenceRefs,
        missingReason: `算子 ${baseAtomId} 输出中不存在目标聚合/衍生字段 [${effectiveField}]`,
        baseResult,
      };
    }

    let numericVal: number | null = null;
    if (typeof extractedVal === 'number' && Number.isFinite(extractedVal)) {
      numericVal = extractedVal;
    } else if (typeof extractedVal === 'boolean') {
      numericVal = extractedVal ? 1 : 0;
    } else {
      const n = Number(String(extractedVal).trim());
      numericVal = Number.isFinite(n) ? n : null;
    }

    return {
      numericVal,
      extractedVal,
      status: numericVal !== null ? baseResult.status : 'unavailable',
      evidenceRefs: baseResult.evidenceRefs,
      baseResult,
    };
  }

  // 无 targetField：直接使用算子标量
  const num =
    typeof baseResult.value === 'number'
      ? baseResult.value
      : typeof baseResult.value === 'boolean'
        ? (baseResult.value ? 1 : 0)
        : null;

  return {
    numericVal: num,
    extractedVal: baseResult.value,
    status: baseResult.status,
    evidenceRefs: baseResult.evidenceRefs,
    baseResult,
  };
}

/**
 * 二库协同解析器：将指标定义映射到算子输出（支持单算子直绑与多算子复合 LibFormula AST 衍生）
 */
export function resolveIndicatorOutputFromAtoms(
  indicator: IndicatorDefinition,
  atomResults: Record<string, MetricAtomResult>,
): {
  rawResult: MetricAtomResult;
  score: number | null;
} {
  // ── 模式 B：多算子复合 (composite) ──
  if (indicator.bindingMode === 'composite') {
    const sources = indicator.sources ?? [];
    if (sources.length === 0 || !indicator.composeFormula) {
      const unconfigured: MetricAtomResult = {
        atomId: indicator.indicatorId,
        value: null,
        displayValue: '复合指标未配置数据源或公式',
        status: 'unavailable',
        confidence: 'low',
        evidenceRefs: [],
        missingDataReason: '多算子复合指标缺少 sources 或 composeFormula',
      };
      return { rawResult: unconfigured, score: null };
    }

    const vars: Record<string, number> = {};
    const mergedEvidence: EvidenceRef[] = [];
    const varDetails: Record<string, unknown> = {};

    for (const src of sources) {
      const res = extractSingleSourceValue(
        src.atomRef,
        src.targetField,
        src.reduce,
        src.filterCriteria,
        atomResults,
      );

      if (res.numericVal === null || res.status === 'unavailable') {
        if (
          src.missingPolicy === 'fallback' &&
          typeof src.fallbackValue === 'number' &&
          Number.isFinite(src.fallbackValue)
        ) {
          vars[src.alias] = src.fallbackValue;
          varDetails[src.alias] = { value: src.fallbackValue, fallback: true };
          mergedEvidence.push({
            source: 'sqlite',
            ref: `indicator:${indicator.indicatorId}->${src.alias}:fallback`,
            scenarioClock: '-',
            description: `输入源 ${src.alias} (${src.atomRef}) 缺失，已应用兜底常数 ${src.fallbackValue}`,
          });
        } else {
          const missingResult: MetricAtomResult = {
            atomId: indicator.indicatorId,
            value: null,
            displayValue: `依赖算子缺失 (${src.alias})`,
            status: 'unavailable',
            confidence: 'low',
            evidenceRefs: [...mergedEvidence, ...res.evidenceRefs],
            missingDataReason: `复合指标输入源 "${src.alias}" (${src.atomRef}) 缺失或不可用: ${
              res.missingReason || '无数据'
            }`,
          };
          return { rawResult: missingResult, score: null };
        }
      } else {
        vars[src.alias] = res.numericVal;
        varDetails[src.alias] = { value: res.numericVal, raw: res.extractedVal };
        mergedEvidence.push(...res.evidenceRefs);
        mergedEvidence.push({
          source: 'sqlite',
          ref: `indicator:${indicator.indicatorId}->${src.alias}`,
          scenarioClock: '-',
          description: `复合指标输入源 [${src.alias}] 取自 ${src.atomRef}${
            src.targetField ? '#' + src.targetField : ''
          } = ${res.numericVal}`,
        });
      }
    }

    const evalRes = evaluateFormulaExpression(indicator.composeFormula, vars);
    if (!evalRes.ok) {
      const evalFailResult: MetricAtomResult = {
        atomId: indicator.indicatorId,
        value: null,
        displayValue: '公式求值失败',
        status: 'unavailable',
        confidence: 'low',
        evidenceRefs: mergedEvidence,
        missingDataReason: `复合指标公式 "${indicator.composeFormula}" 求值异常: ${evalRes.reason}`,
      };
      return { rawResult: evalFailResult, score: null };
    }

    const compositeVal = evalRes.value;
    mergedEvidence.push({
      source: 'sqlite',
      ref: `indicator:${indicator.indicatorId}->formula`,
      scenarioClock: '-',
      description: `复合指标公式 [${indicator.composeFormula}] 求值结果 = ${compositeVal}`,
    });

    const compositeResult: MetricAtomResult = {
      atomId: indicator.indicatorId,
      value: compositeVal,
      displayValue: String(compositeVal),
      status: 'valid',
      confidence: 'high',
      evidenceRefs: mergedEvidence,
      details: {
        boundIndicatorId: indicator.indicatorId,
        bindingMode: 'composite',
        composeFormula: indicator.composeFormula,
        vars: varDetails,
        computedValue: compositeVal,
      },
    };

    const score = applyScoringRule(compositeVal, indicator.scoring);
    return { rawResult: compositeResult, score };
  }

  // ── 模式 A：单算子直绑 (single) ──
  const res = extractSingleSourceValue(
    indicator.atomRef,
    indicator.targetField,
    indicator.reduce,
    indicator.filterCriteria,
    atomResults,
  );

  const { baseAtomId, targetField } = extractAtomRefParts(indicator.atomRef, indicator.targetField);

  if (res.numericVal === null || res.status === 'unavailable') {
    const unavailable: MetricAtomResult = {
      atomId: targetField ? `${baseAtomId}#${targetField}` : indicator.atomRef,
      value: null,
      displayValue:
        res.extractedVal !== null && res.extractedVal !== undefined
          ? String(res.extractedVal)
          : '无数据',
      status: 'unavailable',
      confidence: 'low',
      evidenceRefs: res.evidenceRefs,
      missingDataReason: res.missingReason || `算子 ${baseAtomId} 输出不可用`,
    };
    return { rawResult: unavailable, score: null };
  }

  const boundEvidence = {
    source: 'sqlite' as const,
    ref: `indicator:${indicator.indicatorId}->${baseAtomId}${targetField ? '#' + targetField : ''}`,
    scenarioClock: '-',
    description: `二库指标绑定算子输出: [${targetField || 'value'}] = ${res.numericVal}`,
  };

  const boundResult: MetricAtomResult = {
    atomId: targetField ? `${baseAtomId}#${targetField}` : indicator.atomRef,
    value: res.numericVal,
    displayValue: String(res.extractedVal),
    status: res.status,
    confidence: res.baseResult?.confidence ?? 'high',
    evidenceRefs: [...res.evidenceRefs, boundEvidence],
    details: {
      ...res.baseResult?.details,
      boundIndicatorId: indicator.indicatorId,
      boundTargetField: targetField,
      boundRawValue: res.extractedVal,
    },
  };

  const score = applyScoringRule(res.numericVal, indicator.scoring);
  return { rawResult: boundResult, score };
}
