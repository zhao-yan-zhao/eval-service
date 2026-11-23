import fs from 'node:fs';
import path from 'node:path';
import type {
  AggregationStrategy,
  AlarmThreshold,
  EffectDefinition,
  IndicatorReduceMethod,
  MetricDomainTag,
  NodeMissingPolicy,
  ScoringRule,
} from '../core/types.ts';
import { validateFormula } from '../operators/formula-engine.ts';

const BUILTIN_PRESETS_PATH = path.resolve(import.meta.dirname, 'presets.json');
const DEFAULT_CUSTOM_EFFECTS_PATH = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'data',
  'custom-effects.json',
);

const VALID_DOMAINS = new Set<MetricDomainTag>([
  'firepower',
  'isr',
  'survivability',
  'c2',
  'synergy',
  'cost',
]);

const VALID_STRATEGIES = new Set<AggregationStrategy>([
  'weighted_sum',
  'weighted_product',
  'geometric_mean',
  'maximin',
  'max',
  'mean',
  'formula',
]);

const VALID_MISSING_POLICIES = new Set<NodeMissingPolicy>([
  'skip_renormalize',
  'fail',
  'worst',
  'neutral',
]);

const VALID_REDUCE_METHODS = new Set<IndicatorReduceMethod>([
  'mean',
  'sum',
  'max',
  'min',
  'median',
  'last',
  'first',
]);

const VALID_ALARM_OPS = new Set<AlarmThreshold['operator']>(['>', '<', '==', '>=', '<=']);

function validateScoringRule(rule: ScoringRule | undefined, errors: string[]): void {
  if (!rule || !rule.type) {
    errors.push('metricBinding.scoringRule 必须配置 type');
    return;
  }

  switch (rule.type) {
    case 'smaller_is_better':
    case 'larger_is_better': {
      const hasOptWst =
        typeof rule.optimal === 'number' &&
        Number.isFinite(rule.optimal) &&
        typeof rule.worst === 'number' &&
        Number.isFinite(rule.worst);
      const hasBounds =
        Array.isArray(rule.bounds) &&
        rule.bounds.length === 2 &&
        typeof rule.bounds[0] === 'number' &&
        Number.isFinite(rule.bounds[0]) &&
        typeof rule.bounds[1] === 'number' &&
        Number.isFinite(rule.bounds[1]);
      if (!hasOptWst && !hasBounds) {
        errors.push(`${rule.type} 评分规则必须指定有效数值型 optimal/worst 或 bounds`);
      }
      break;
    }
    case 'linear': {
      if (!Array.isArray(rule.bounds) || rule.bounds.length !== 2) {
        errors.push('linear 评分规则必须指定 bounds: [min, max]');
      } else if (
        !Number.isFinite(rule.bounds[0]) ||
        !Number.isFinite(rule.bounds[1]) ||
        rule.bounds[0] === rule.bounds[1]
      ) {
        errors.push('linear 评分规则 bounds 两端必须为不相等的有效数值');
      }
      break;
    }
    case 'target_range': {
      if (!Array.isArray(rule.optimalRange) || rule.optimalRange.length !== 2) {
        errors.push('target_range 评分规则必须指定 optimalRange: [min, max]');
      } else {
        const [optLo, optHi] = rule.optimalRange;
        if (!Number.isFinite(optLo) || !Number.isFinite(optHi) || optLo > optHi) {
          errors.push('target_range 最优区间须满足 optimalRange[0] <= optimalRange[1]');
        }
        if (rule.toleranceRange) {
          const [tolLo, tolHi] = rule.toleranceRange;
          if (
            !Array.isArray(rule.toleranceRange) ||
            rule.toleranceRange.length !== 2 ||
            !Number.isFinite(tolLo) ||
            !Number.isFinite(tolHi) ||
            tolLo > optLo ||
            optHi > tolHi
          ) {
            errors.push('target_range 容忍区间须包络最优区间 (tolLo <= optLo 且 optHi <= tolHi)');
          }
        }
      }
      break;
    }
    case 'step': {
      if (!Array.isArray(rule.steps) || rule.steps.length === 0) {
        errors.push('step 阶梯评分规则至少需要 1 档阈值映射 (steps)');
      } else {
        for (const s of rule.steps) {
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
      break;
    }
    case 'boolean': {
      if (
        rule.trueScore !== undefined &&
        (typeof rule.trueScore !== 'number' || !Number.isFinite(rule.trueScore))
      ) {
        errors.push('boolean 规则 trueScore 必须为有效数值');
      }
      if (
        rule.falseScore !== undefined &&
        (typeof rule.falseScore !== 'number' || !Number.isFinite(rule.falseScore))
      ) {
        errors.push('boolean 规则 falseScore 必须为有效数值');
      }
      break;
    }
    default:
      errors.push(`未知的评分规则类型: ${String((rule as { type?: unknown }).type)}`);
      break;
  }
}

export interface EffectValidationResult {
  valid: boolean;
  errors: string[];
}

export class EffectStore {
  private readonly customFilePath: string;
  private builtins: EffectDefinition[] = [];
  private custom: Map<string, EffectDefinition> = new Map();

  constructor(customFilePath = DEFAULT_CUSTOM_EFFECTS_PATH) {
    this.customFilePath = customFilePath;
    this.load();
  }

  private load(): void {
    this.builtins = [];
    if (fs.existsSync(BUILTIN_PRESETS_PATH)) {
      try {
        const raw = fs.readFileSync(BUILTIN_PRESETS_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as EffectDefinition[];
        if (Array.isArray(parsed)) {
          this.builtins = parsed.map((item) => ({ ...item, isBuiltin: true }));
        }
      } catch {
        this.builtins = [];
      }
    }

    this.custom.clear();
    if (this.customFilePath && fs.existsSync(this.customFilePath)) {
      try {
        const customRaw = fs.readFileSync(this.customFilePath, 'utf-8');
        const customItems = JSON.parse(customRaw) as EffectDefinition[];
        if (Array.isArray(customItems)) {
          for (const item of customItems) {
            if (item && item.effectId) {
              this.custom.set(item.effectId, { ...item, isBuiltin: false });
            }
          }
        }
      } catch {
        this.custom.clear();
      }
    }
  }

  private persistCustom(): void {
    if (!this.customFilePath) return;
    try {
      fs.mkdirSync(path.dirname(this.customFilePath), { recursive: true });
      const list = [...this.custom.values()];
      fs.writeFileSync(this.customFilePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch {
      // 兼容只读文件系统或测试沙箱路径
    }
  }

  listAll(): EffectDefinition[] {
    const byId = new Map<string, EffectDefinition>();
    for (const b of this.builtins) byId.set(b.effectId, structuredClone(b));
    for (const c of this.custom.values()) byId.set(c.effectId, structuredClone(c));
    return [...byId.values()];
  }

  get(effectId: string): EffectDefinition | undefined {
    const found =
      this.custom.get(effectId) ?? this.builtins.find((b) => b.effectId === effectId);
    return found ? structuredClone(found) : undefined;
  }

  validateEffect(def: EffectDefinition): EffectValidationResult {
    const errors: string[] = [];

    if (!def || typeof def !== 'object') {
      return { valid: false, errors: ['效果定义必须为非空对象'] };
    }

    if (!def.effectId || typeof def.effectId !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(def.effectId)) {
      errors.push('effectId 仅允许字母、数字、下划线、点或连字符');
    }

    if (!def.name || typeof def.name !== 'string' || def.name.trim().length === 0) {
      errors.push('效果名称 name 不能为空');
    }

    if (def.role !== 'effect' && def.role !== 'gate') {
      errors.push(`effect role 必须为 "effect" 或 "gate"，实际=${String(def.role)}`);
    }

    if (def.gateMode !== undefined && def.gateMode !== 'hard' && def.gateMode !== 'soft') {
      errors.push(`gateMode 必须为 "hard" 或 "soft"，实际=${String(def.gateMode)}`);
    }

    if (def.domainTag !== undefined && !VALID_DOMAINS.has(def.domainTag)) {
      errors.push(`不支持的 domainTag: ${String(def.domainTag)}`);
    }

    if (def.metricBinding !== undefined) {
      const mb = def.metricBinding;
      if (!mb || typeof mb !== 'object') {
        errors.push('metricBinding 必须为对象');
      } else {
        if (!mb.metricId || typeof mb.metricId !== 'string' || mb.metricId.trim().length === 0) {
          errors.push('metricBinding.metricId 不能为空');
        }
        if (mb.reduce !== undefined && !VALID_REDUCE_METHODS.has(mb.reduce)) {
          errors.push(`metricBinding.reduce 不支持归约方法: ${String(mb.reduce)}`);
        }
        validateScoringRule(mb.scoringRule, errors);
        if (mb.alarmThreshold !== undefined) {
          const th = mb.alarmThreshold;
          if (!th || !VALID_ALARM_OPS.has(th.operator)) {
            errors.push(`alarmThreshold.operator 非法: ${String(th?.operator)}`);
          }
          if (typeof th?.value !== 'number' || !Number.isFinite(th.value)) {
            errors.push('alarmThreshold.value 必须为有限数值');
          }
          if (th?.severity !== 'major' && th?.severity !== 'minor') {
            errors.push('alarmThreshold.severity 必须为 "major" 或 "minor"');
          }
        }
      }
    }

    if (!def.aggregation || typeof def.aggregation !== 'object') {
      errors.push('必须提供 aggregation 合成策略配置');
    } else {
      if (!VALID_STRATEGIES.has(def.aggregation.strategy)) {
        errors.push(`不支持的聚合策略 aggregation.strategy: ${String(def.aggregation.strategy)}`);
      }
      if (!VALID_MISSING_POLICIES.has(def.aggregation.missingPolicy)) {
        errors.push(
          `不支持的缺失策略 aggregation.missingPolicy: ${String(def.aggregation.missingPolicy)}`,
        );
      }
      if (def.aggregation.strategy === 'formula') {
        if (!def.aggregation.customFormula || !def.aggregation.customFormula.trim()) {
          errors.push('aggregation.strategy 为 formula 时必须提供 customFormula');
        } else {
          const check = validateFormula(def.aggregation.customFormula);
          if (!check.valid) {
            errors.push(`aggregation.customFormula 语法错误: ${check.errors.join('; ')}`);
          }
        }
      }
      if (def.aggregation.ahpCr !== undefined) {
        if (typeof def.aggregation.ahpCr !== 'number' || !Number.isFinite(def.aggregation.ahpCr)) {
          errors.push('aggregation.ahpCr 必须为有限数值');
        } else if (def.aggregation.ahpCr >= 0.1) {
          errors.push(
            `AHP 一致性比率 CR=${def.aggregation.ahpCr.toFixed(4)} >= 0.10，未通过一致性检验`,
          );
        }
      }
      if (def.aggregation.ahpMatrix !== undefined) {
        const m = def.aggregation.ahpMatrix;
        if (!Array.isArray(m) || m.length === 0 || m.some((row) => !Array.isArray(row) || row.length !== m.length)) {
          errors.push('aggregation.ahpMatrix 必须为非空 n×n 方阵');
        } else {
          let matrixValid = true;
          for (let i = 0; i < m.length && matrixValid; i += 1) {
            for (let j = 0; j < m.length; j += 1) {
              const v = m[i][j];
              if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
                errors.push('aggregation.ahpMatrix 所有元素必须为正有限数值');
                matrixValid = false;
                break;
              }
            }
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  upsertCustom(def: EffectDefinition): EffectDefinition {
    const check = this.validateEffect(def);
    if (!check.valid) {
      throw new Error(`效果定义校验失败: ${check.errors.join('; ')}`);
    }
    const clean: EffectDefinition = { ...structuredClone(def), isBuiltin: false };
    this.custom.set(clean.effectId, clean);
    this.persistCustom();
    return structuredClone(clean);
  }

  deleteCustom(effectId: string): boolean {
    const isBuiltinOnly =
      this.builtins.some((b) => b.effectId === effectId) && !this.custom.has(effectId);
    if (isBuiltinOnly) {
      throw new Error(`不允许删除内置预置效果节点: ${effectId}`);
    }
    const deleted = this.custom.delete(effectId);
    if (deleted) {
      this.persistCustom();
    }
    return deleted;
  }
}

export const defaultEffectStore = new EffectStore();
