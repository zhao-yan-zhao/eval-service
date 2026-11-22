import type {
  AggregationStrategy,
  NodeMissingPolicy,
} from '../core/types.ts';
import { evaluateFormulaExpression } from '../operators/formula-engine.ts';

export interface ChildNodeScoreInput {
  id: string;
  nodeCode?: string;
  weight: number;
  score: number | null;
}

export interface AggregationExecutionResult {
  score: number | null;
  strategyUsed: AggregationStrategy;
  missingPolicyUsed: NodeMissingPolicy;
  availableWeightRatio: number;
  effectiveWeights: number[];
  formulaApplied?: string;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 非叶节点多策略聚合计算核心纯函数
 */
export function calculateNodeAggregation(
  strategy: AggregationStrategy = 'weighted_sum',
  missingPolicy: NodeMissingPolicy = 'skip_renormalize',
  children: ChildNodeScoreInput[],
  customFormula?: string,
): AggregationExecutionResult {
  const totalWeight = children.reduce((acc, c) => acc + (c.weight > 0 ? c.weight : 0), 0) || 1;

  if (children.length === 0) {
    return {
      score: null,
      strategyUsed: strategy,
      missingPolicyUsed: missingPolicy,
      availableWeightRatio: 0,
      effectiveWeights: [],
    };
  }

  // 1. 根据缺失策略（missingPolicy）预处理各子节点分值
  const hasNullChild = children.some((c) => c.score === null);

  if (missingPolicy === 'fail' && hasNullChild) {
    return {
      score: null,
      strategyUsed: strategy,
      missingPolicyUsed: missingPolicy,
      availableWeightRatio: 0,
      effectiveWeights: children.map(() => 0),
    };
  }

  // 预处理分值与有效性
  interface NormalizedChild {
    id: string;
    nodeCode?: string;
    weight: number;
    score: number;
    isOriginalValid: boolean;
  }

  const processedChildren: NormalizedChild[] = [];
  for (const c of children) {
    if (c.score !== null) {
      processedChildren.push({
        id: c.id,
        nodeCode: c.nodeCode,
        weight: c.weight,
        score: c.score,
        isOriginalValid: true,
      });
    } else if (missingPolicy === 'worst') {
      processedChildren.push({
        id: c.id,
        nodeCode: c.nodeCode,
        weight: c.weight,
        score: 0,
        isOriginalValid: false,
      });
    } else if (missingPolicy === 'neutral') {
      processedChildren.push({
        id: c.id,
        nodeCode: c.nodeCode,
        weight: c.weight,
        score: 50,
        isOriginalValid: false,
      });
    }
  }

  // 若为 skip_renormalize 且全部子项缺失，返回 null
  if (processedChildren.length === 0) {
    return {
      score: null,
      strategyUsed: strategy,
      missingPolicyUsed: missingPolicy,
      availableWeightRatio: 0,
      effectiveWeights: children.map(() => 0),
    };
  }

  const availableWeight = processedChildren.reduce((acc, c) => acc + (c.weight > 0 ? c.weight : 0), 0);
  const availableWeightRatio = Math.round((availableWeight / totalWeight) * 10000) / 10000;

  // 计算每项有效权重（用于加权求和及贡献展示）
  const effectiveWeights: number[] = children.map((c) => {
    const p = processedChildren.find((item) => item.id === c.id);
    if (!p || availableWeight <= 0) return 0;
    return Math.round((p.weight / availableWeight) * 10000) / 10000;
  });

  // 2. 根据策略执行求值
  let score: number | null = null;
  let formulaApplied: string | undefined = undefined;

  switch (strategy) {
    case 'weighted_sum': {
      if (availableWeight > 0) {
        let weightedSum = 0;
        for (const c of processedChildren) {
          weightedSum += c.score * c.weight;
        }
        score = round2(weightedSum / availableWeight);
      }
      break;
    }

    case 'weighted_product':
    case 'geometric_mean': {
      if (availableWeight > 0) {
        // 加权几何平均：100 * Π((s_i / 100) ^ w_norm)
        // 任何项 <= 0 直接为 0（严格短板敏感）
        let product = 1.0;
        for (const c of processedChildren) {
          if (c.score <= 0) {
            product = 0;
            break;
          }
          const normWeight = c.weight / availableWeight;
          const ratio = clamp(c.score / 100, 0, 1);
          product *= Math.pow(ratio, normWeight);
        }
        score = round2(clamp(product * 100, 0, 100));
      }
      break;
    }

    case 'maximin': {
      // 木桶最弱项：min(s_i)
      const minScore = Math.min(...processedChildren.map((c) => c.score));
      score = Number.isFinite(minScore) ? round2(minScore) : null;
      break;
    }

    case 'max': {
      // 最优择优：max(s_i)
      const maxScore = Math.max(...processedChildren.map((c) => c.score));
      score = Number.isFinite(maxScore) ? round2(maxScore) : null;
      break;
    }

    case 'mean': {
      // 算术平均
      const sum = processedChildren.reduce((acc, c) => acc + c.score, 0);
      score = round2(sum / processedChildren.length);
      break;
    }

    case 'formula': {
      if (!customFormula || !customFormula.trim()) {
        score = null;
        break;
      }
      // 组装变量字典：以 nodeCode 为主，id 为备
      const vars: Record<string, number> = {};
      for (const c of processedChildren) {
        if (c.nodeCode) vars[c.nodeCode] = c.score;
        vars[c.id] = c.score;
      }
      formulaApplied = customFormula;
      const res = evaluateFormulaExpression(customFormula, vars);
      if (res.ok) {
        score = round2(clamp(res.value, 0, 100));
      } else {
        score = null;
      }
      break;
    }

    default: {
      // 兜底 weighted_sum
      if (availableWeight > 0) {
        let weightedSum = 0;
        for (const c of processedChildren) {
          weightedSum += c.score * c.weight;
        }
        score = round2(weightedSum / availableWeight);
      }
      break;
    }
  }

  return {
    score,
    strategyUsed: strategy,
    missingPolicyUsed: missingPolicy,
    availableWeightRatio,
    effectiveWeights,
    formulaApplied,
  };
}
