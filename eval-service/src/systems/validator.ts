import type {
  IndicatorSystem,
  SystemDimensionNode,
  SystemIndicatorLeaf,
} from '../core/types.ts';
import { defaultIndicatorStore, type IndicatorStore } from '../indicators/store.ts';
import { hasOperator } from '../operators/registry.ts';

export function isDimensionNode(
  node: SystemDimensionNode | SystemIndicatorLeaf,
): node is SystemDimensionNode {
  return 'children' in node && Array.isArray(node.children);
}

export interface SystemValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateIndicatorSystem(
  system: IndicatorSystem,
  indicatorStore: IndicatorStore = defaultIndicatorStore,
): SystemValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!system.systemId || !/^[a-zA-Z0-9_.-]+$/.test(system.systemId)) {
    errors.push('systemId 仅允许字母、数字、下划线、点或连字符');
  }
  if (!system.name || !system.name.trim()) {
    errors.push('体系名称 name 不能为空');
  }
  if (!system.root || !Array.isArray(system.root.children) || system.root.children.length === 0) {
    errors.push('体系根节点 root.children 至少需要包含一个维度或指标');
    return { valid: false, errors, warnings };
  }

  const checkOpExists = (atomId: string) => {
    if (indicatorStore && typeof (indicatorStore as any).isOperatorRegistered === 'function') {
      return (indicatorStore as any).isOperatorRegistered(atomId);
    }
    return hasOperator(atomId);
  };

  for (const kpi of system.kpis ?? []) {
    if (!checkOpExists(kpi.atomRef)) {
      errors.push(`KPI "${kpi.label}" 引用了不存在的算子: ${kpi.atomRef}`);
    }
  }

  const visitedObjects = new Set<object>();

  const checkLevel = (
    children: Array<SystemDimensionNode | SystemIndicatorLeaf>,
    levelLabel: string,
    seenIds: Set<string>,
  ) => {
    if (children.length === 0) {
      errors.push(`${levelLabel} 下不能为空`);
      return;
    }

    let weightSum = 0;
    for (const child of children) {
      if (visitedObjects.has(child)) {
        errors.push(`检测到体系树存在循环引用: ${levelLabel}`);
        continue;
      }
      visitedObjects.add(child);

      if (typeof child.weight !== 'number' || !Number.isFinite(child.weight) || child.weight <= 0) {
        errors.push(`${levelLabel} 节点权重必须为大于 0 的有限数值`);
      } else {
        weightSum += child.weight;
      }

      if (isDimensionNode(child)) {
        if (!child.id || !child.name) {
          errors.push(`${levelLabel} 维度节点必须具备 id 与 name`);
        } else if (seenIds.has(child.id)) {
          errors.push(`存在重复维度 id: ${child.id}`);
        } else {
          seenIds.add(child.id);
        }
        checkLevel(child.children, `${levelLabel} -> ${child.name || child.id}`, new Set(seenIds));
      } else {
        const ind = indicatorStore.get(child.indicatorRef);
        if (!ind) {
          errors.push(`${levelLabel} 引用了未定义指标: ${child.indicatorRef}`);
        } else if (!checkOpExists(ind.atomRef)) {
          errors.push(`指标 ${child.indicatorRef} 引用了未注册算子 ${ind.atomRef}`);
        }
      }
    }

    if (Math.abs(weightSum - 1.0) > 1e-4) {
      errors.push(`${levelLabel} 同级子权重之和必须为 1.0 (当前为 ${weightSum.toFixed(4)})`);
    }
  };

  checkLevel(system.root.children, 'root', new Set<string>());

  if ((system.kpis ?? []).length === 0) {
    warnings.push('建议至少绑定 1 项 kpis，否则驾驶舱顶栏仅显示默认汇总卡片');
  }

  return { valid: errors.length === 0, errors, warnings };
}

function normalizeLevel(children: Array<SystemDimensionNode | SystemIndicatorLeaf>) {
  const sum = children.reduce((acc, c) => acc + (c.weight > 0 ? c.weight : 0), 0);
  const n = children.length;
  for (let i = 0; i < n; i += 1) {
    const c = children[i];
    if (sum > 0) {
      c.weight = Math.round(((c.weight > 0 ? c.weight : 0) / sum) * 10000) / 10000;
    } else {
      c.weight = Math.round((1 / n) * 10000) / 10000;
    }
    if (isDimensionNode(c)) {
      normalizeLevel(c.children);
    }
  }
  // 把四舍五入尾差补偿给最后一项保证严格 ∑ = 1.0
  if (n > 0) {
    const pre = children.slice(0, n - 1).reduce((a, c) => a + c.weight, 0);
    children[n - 1].weight = Math.max(0.0001, Math.round((1 - pre) * 10000) / 10000);
  }
}

export function normalizeSystemWeights(system: IndicatorSystem): IndicatorSystem {
  const cloned = structuredClone(system);
  if (cloned.root?.children?.length) {
    normalizeLevel(cloned.root.children);
  }
  return cloned;
}
