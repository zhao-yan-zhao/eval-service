import type { ScoringRule } from './types.ts';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 确定性归一化评分纯函数
 * - 遇到 null / undefined / NaN / Infinity 严格返回 null（fail-closed，绝不伪造 0 分或满分）
 * - 支持 linear / smaller_is_better / larger_is_better / step / boolean
 */
export function applyScoringRule(
  rawValue: number | boolean | null | undefined,
  rule: ScoringRule,
): number | null {
  if (rawValue === null || rawValue === undefined) return null;

  if (rule.type === 'boolean' || typeof rawValue === 'boolean') {
    const b = typeof rawValue === 'boolean' ? rawValue : rawValue !== 0;
    return round2(b ? (rule.trueScore ?? 100) : (rule.falseScore ?? 0));
  }

  const val = Number(rawValue);
  if (!Number.isFinite(val)) return null;

  const [minScore, maxScore] = rule.scoreRange ?? [0, 100];

  switch (rule.type) {
    case 'smaller_is_better': {
      const optimal = rule.optimal ?? rule.bounds?.[0] ?? 0;
      const worst = rule.worst ?? rule.bounds?.[1] ?? 100;
      if (worst === optimal) return val <= optimal ? maxScore : minScore;
      if (val <= optimal) return round2(maxScore);
      if (val >= worst) return round2(minScore);
      const t = (worst - val) / (worst - optimal);
      return round2(minScore + clamp(t, 0, 1) * (maxScore - minScore));
    }

    case 'larger_is_better': {
      const worst = rule.worst ?? rule.bounds?.[0] ?? 0;
      const optimal = rule.optimal ?? rule.bounds?.[1] ?? 100;
      if (optimal === worst) return val >= optimal ? maxScore : minScore;
      if (val >= optimal) return round2(maxScore);
      if (val <= worst) return round2(minScore);
      const t = (val - worst) / (optimal - worst);
      return round2(minScore + clamp(t, 0, 1) * (maxScore - minScore));
    }

    case 'linear': {
      const [bMin, bMax] = rule.bounds ?? [rule.worst ?? 0, rule.optimal ?? 1];
      if (bMax === bMin) return round2(maxScore);
      const t = clamp((val - bMin) / (bMax - bMin), 0, 1);
      return round2(minScore + t * (maxScore - minScore));
    }

    case 'step': {
      const steps = [...(rule.steps ?? [])].sort((a, b) => a.val - b.val);
      if (steps.length === 0) return null;
      let chosen = steps[0].score;
      for (const s of steps) {
        if (val >= s.val) {
          chosen = s.score;
        } else {
          break;
        }
      }
      return round2(clamp(chosen, 0, 100));
    }

    case 'target_range': {
      const [optLo, optHi] = rule.optimalRange ?? [rule.bounds?.[0] ?? 0, rule.bounds?.[1] ?? 100];
      const [tolLo, tolHi] = rule.toleranceRange ?? [
        optLo - Math.abs(optHi - optLo),
        optHi + Math.abs(optHi - optLo),
      ];

      // 处于最优区间内部：满分
      if (val >= optLo && val <= optHi) {
        return round2(maxScore);
      }
      // 低于最优区间下限：向容忍下限衰减
      if (val < optLo) {
        if (tolLo >= optLo || val <= tolLo) return round2(minScore);
        const t = (val - tolLo) / (optLo - tolLo);
        return round2(minScore + clamp(t, 0, 1) * (maxScore - minScore));
      }
      // 高于最优区间上限：向容忍上限衰减
      if (val > optHi) {
        if (tolHi <= optHi || val >= tolHi) return round2(minScore);
        const t = (tolHi - val) / (tolHi - optHi);
        return round2(minScore + clamp(t, 0, 1) * (maxScore - minScore));
      }
      return round2(minScore);
    }

    default:
      return null;
  }
}

/** 预览某条评分规则在多个采样点上的映射曲线（用于前端指标工坊预览图） */
export function sampleScoringCurve(
  rule: ScoringRule,
  points = 25,
): Array<{ x: number; score: number }> {
  if (rule.type === 'boolean') {
    return [
      { x: 0, score: rule.falseScore ?? 0 },
      { x: 1, score: rule.trueScore ?? 100 },
    ];
  }
  if (rule.type === 'step' && rule.steps?.length) {
    const sorted = [...rule.steps].sort((a, b) => a.val - b.val);
    return sorted.map((s) => ({ x: s.val, score: s.score }));
  }

  let lo = 0;
  let hi = 100;
  if (rule.type === 'smaller_is_better') {
    const opt = rule.optimal ?? rule.bounds?.[0] ?? 0;
    const wst = rule.worst ?? rule.bounds?.[1] ?? 100;
    lo = Math.min(opt, wst) * 0.8;
    hi = Math.max(opt, wst) * 1.15 || 100;
  } else if (rule.type === 'larger_is_better') {
    const wst = rule.worst ?? rule.bounds?.[0] ?? 0;
    const opt = rule.optimal ?? rule.bounds?.[1] ?? 100;
    lo = Math.min(wst, opt) * 0.8;
    hi = Math.max(wst, opt) * 1.15 || 100;
  } else if (rule.type === 'target_range') {
    const [optLo, optHi] = rule.optimalRange ?? [rule.bounds?.[0] ?? 0, rule.bounds?.[1] ?? 100];
    const [tolLo, tolHi] = rule.toleranceRange ?? [
      optLo - Math.abs(optHi - optLo),
      optHi + Math.abs(optHi - optLo),
    ];
    lo = Math.min(optLo, tolLo);
    hi = Math.max(optHi, tolHi);
    const span = hi - lo || 10;
    lo = round2(lo - span * 0.1);
    hi = round2(hi + span * 0.1);
  } else if (rule.bounds) {
    lo = Math.min(rule.bounds[0], rule.bounds[1]);
    hi = Math.max(rule.bounds[0], rule.bounds[1]);
  }
  if (lo === hi) hi = lo + 10;

  const out: Array<{ x: number; score: number }> = [];
  for (let i = 0; i < points; i += 1) {
    const x = round2(lo + ((hi - lo) * i) / (points - 1));
    const score = applyScoringRule(x, rule) ?? 0;
    out.push({ x, score });
  }
  return out;
}
