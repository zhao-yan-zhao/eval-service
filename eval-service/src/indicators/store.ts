import fs from 'node:fs';
import path from 'node:path';
import { applyScoringRule } from '../core/scoring-functions.ts';
import type { AlarmThreshold, IndicatorDefinition, MetricAtomResult } from '../core/types.ts';
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
  private builtins: IndicatorDefinition[] = [];
  private custom: Map<string, IndicatorDefinition> = new Map();

  constructor(
    customFilePath = DEFAULT_CUSTOM_PATH,
    operatorExists: (atomId: string) => boolean = hasOperator,
  ) {
    this.customFilePath = customFilePath;
    this.operatorExists = operatorExists;
    this.load();
  }

  private load(): void {
    const raw = fs.readFileSync(BUILTIN_CATALOG_PATH, 'utf-8');
    const items = JSON.parse(raw) as IndicatorDefinition[];
    this.builtins = items.map((item) => ({ ...item, builtin: true }));

    if (fs.existsSync(this.customFilePath)) {
      const customRaw = fs.readFileSync(this.customFilePath, 'utf-8');
      const customItems = JSON.parse(customRaw) as IndicatorDefinition[];
      this.custom.clear();
      for (const item of customItems) {
        this.custom.set(item.indicatorId, { ...item, builtin: false });
      }
    }
  }

  private persistCustom(): void {
    fs.mkdirSync(path.dirname(this.customFilePath), { recursive: true });
    const list = [...this.custom.values()];
    fs.writeFileSync(this.customFilePath, JSON.stringify(list, null, 2), 'utf-8');
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
    const { baseAtomId } = extractAtomRefParts(def.atomRef, def.targetField);

    if (!this.operatorExists(def.atomRef) && (!baseAtomId || !this.operatorExists(baseAtomId))) {
      errors.push(`atomRef 引用了未注册的算子: ${def.atomRef}`);
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
      this.persistCustom();
    }
    return deleted;
  }
}

export const defaultIndicatorStore = new IndicatorStore();

/**
 * 二库协同解析器：将指标定义映射到算子输出（支持普通标量算子与流水线衍生/聚合输出 targetField 提取）
 */
export function resolveIndicatorOutputFromAtoms(
  indicator: IndicatorDefinition,
  atomResults: Record<string, MetricAtomResult>,
): {
  rawResult: MetricAtomResult;
  score: number | null;
} {
  const { baseAtomId, targetField } = extractAtomRefParts(indicator.atomRef, indicator.targetField);

  const baseResult = atomResults[baseAtomId] ?? atomResults[indicator.atomRef];

  if (!baseResult) {
    const unavailable: MetricAtomResult = {
      atomId: indicator.atomRef,
      value: null,
      displayValue: '未找到算子计算结果',
      status: 'unavailable',
      confidence: 'low',
      evidenceRefs: [],
      missingDataReason: `未找到算子 ${baseAtomId} 计算结果`,
    };
    return { rawResult: unavailable, score: null };
  }

  // 1. 如果指定了 targetField，从算子输出流水线数据集或 fieldValues 中精确提取该字段
  if (targetField) {
    const details = baseResult.details as Record<string, unknown> | undefined;
    const fieldValues = (details?.fieldValues ?? {}) as Record<string, unknown>;
    const outputDataset = details?.outputDataset as { rows?: Array<Record<string, unknown>> } | undefined;
    const rows = (outputDataset?.rows ?? []) as Array<Record<string, unknown>>;

    let targetRow: Record<string, unknown> | undefined;
    if (indicator.filterCriteria && Object.keys(indicator.filterCriteria).length > 0) {
      targetRow = rows.find((r) => {
        return Object.entries(indicator.filterCriteria!).every(([k, v]) => {
          if (r[k] === undefined) return false;
          return String(r[k]).toLowerCase() === String(v).toLowerCase();
        });
      });
      // 严格 Fail-Closed：显式声明了行筛选条件但未命中时，绝不盲取默认行
      if (!targetRow && rows.length > 0) {
        const criteriaUnavailable: MetricAtomResult = {
          atomId: `${baseAtomId}#${targetField}`,
          value: null,
          displayValue: `未匹配到指定行`,
          status: 'unavailable',
          confidence: 'low',
          evidenceRefs: baseResult.evidenceRefs,
          missingDataReason: `算子 ${baseAtomId} 输出数据集未找到匹配条件 ${JSON.stringify(indicator.filterCriteria)} 的数据行`,
        };
        return { rawResult: criteriaUnavailable, score: null };
      }
    } else {
      targetRow = rows[0] ?? {};
    }

    let extractedVal: unknown = undefined;
    if (targetField in fieldValues) {
      extractedVal = fieldValues[targetField];
    } else if (targetRow && targetField in targetRow) {
      extractedVal = targetRow[targetField];
    } else if (
      (details?.targetField === targetField ||
        (targetField === 'value' && Object.keys(fieldValues).length === 0 && rows.length === 0)) &&
      baseResult.value !== null &&
      baseResult.value !== undefined
    ) {
      extractedVal = baseResult.value;
    }

    if (extractedVal === undefined || extractedVal === null) {
      const fieldUnavailable: MetricAtomResult = {
        atomId: `${baseAtomId}#${targetField}`,
        value: null,
        displayValue: `字段 [${targetField}] 无数据`,
        status: 'unavailable',
        confidence: 'low',
        evidenceRefs: baseResult.evidenceRefs,
        missingDataReason: `算子 ${baseAtomId} 输出中不存在目标聚合/衍生字段 [${targetField}]`,
      };
      return { rawResult: fieldUnavailable, score: null };
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

    const boundEvidence = {
      source: 'sqlite' as const,
      ref: `indicator:${indicator.indicatorId}->${baseAtomId}#${targetField}`,
      scenarioClock: '-',
      description: `二库指标绑定算子输出字段: [${targetField}] = ${extractedVal}`,
    };

    const boundResult: MetricAtomResult = {
      atomId: `${baseAtomId}#${targetField}`,
      value: numericVal,
      displayValue: String(extractedVal),
      status: numericVal !== null ? baseResult.status : 'unavailable',
      confidence: baseResult.confidence,
      evidenceRefs: [...baseResult.evidenceRefs, boundEvidence],
      details: {
        ...baseResult.details,
        boundIndicatorId: indicator.indicatorId,
        boundTargetField: targetField,
        boundRawValue: extractedVal,
      },
    };

    const score = applyScoringRule(numericVal, indicator.scoring);
    return { rawResult: boundResult, score };
  }

  // 2. 未指定 targetField 时，直接使用算子本身的标量值
  const score = applyScoringRule(baseResult.value, indicator.scoring);
  return { rawResult: baseResult, score };
}
