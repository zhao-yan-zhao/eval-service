import type { AggregationStrategy } from '../core/types.ts';

export interface ChildCodeItem {
  id?: string;
  nodeCode?: string;
  weight: number;
}

/**
 * 确定性地将可视化聚合策略与子节点权重编译为等效的 LibFormula 表达式
 */
export function generateEquivalentFormula(
  strategy: AggregationStrategy,
  children: ChildCodeItem[],
): string {
  if (!children || children.length === 0) return '';

  const cleanItems = children.map((c, idx) => ({
    name: c.nodeCode || c.id || `node_${idx + 1}`,
    weight: c.weight > 0 ? c.weight : 0,
  }));

  const totalWeight = cleanItems.reduce((acc, c) => acc + c.weight, 0) || 1;
  const normalized = cleanItems.map((c) => ({
    name: c.name,
    weight: Math.round((c.weight / totalWeight) * 10000) / 10000,
  }));

  switch (strategy) {
    case 'weighted_sum': {
      const terms = normalized.map((c) => `${c.weight} * ${c.name}`);
      return `ROUND(${terms.join(' + ')}, 2)`;
    }

    case 'weighted_product':
    case 'geometric_mean': {
      const terms = normalized.map((c) => `POWER(${c.name} / 100, ${c.weight})`);
      return `ROUND(100 * ${terms.join(' * ')}, 2)`;
    }

    case 'maximin': {
      return `MIN(${normalized.map((c) => c.name).join(', ')})`;
    }

    case 'max': {
      return `MAX(${normalized.map((c) => c.name).join(', ')})`;
    }

    case 'mean': {
      return `ROUND(AVG(${normalized.map((c) => c.name).join(', ')}), 2)`;
    }

    case 'formula':
    default:
      return '';
  }
}
