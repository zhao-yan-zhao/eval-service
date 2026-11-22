import type {
  IndicatorSystem,
  NodeAggregationConfig,
  SystemDimensionNode,
  SystemIndicatorLeaf,
} from '../core/types.ts';
import { defaultIndicatorStore, type IndicatorStore } from '../indicators/store.ts';
import { validateFormula } from '../operators/formula-engine.ts';
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
  const seenNodeCodes = new Set<string>();
  let depthWarned = false;

  if (system.root.nodeCode) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(system.root.nodeCode)) {
      errors.push(
        `root 节点标识代码 nodeCode "${system.root.nodeCode}" 不合法（仅允许字母、数字、下划线且首字符不能为数字）`,
      );
    } else {
      seenNodeCodes.add(system.root.nodeCode);
    }
  }
  if (
    system.root.aggregation?.mode === 'formula' &&
    (!system.root.aggregation.customFormula || !system.root.aggregation.customFormula.trim())
  ) {
    errors.push('root 为公式聚合模式，但未提供 customFormula');
  }

  const checkLevel = (
    children: Array<SystemDimensionNode | SystemIndicatorLeaf>,
    levelLabel: string,
    seenIds: Set<string>,
    parentAggregation?: NodeAggregationConfig,
    depth = 1,
  ) => {
    if (depth > 6 && !depthWarned) {
      depthWarned = true;
      warnings.push('体系层级深度已超过 6 层，建议保持在 3~5 层以确保评估可解释性');
    }
    if (children.length === 0) {
      errors.push(`${levelLabel} 下不能为空`);
      return;
    }

    let weightSum = 0;
    const directChildCodes: string[] = [];

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

      if (child.nodeCode) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(child.nodeCode)) {
          errors.push(
            `${levelLabel} 节点标识代码 nodeCode "${child.nodeCode}" 不合法（仅允许字母、数字、下划线且首字符不能为数字）`,
          );
        } else if (seenNodeCodes.has(child.nodeCode)) {
          errors.push(`存在重复的节点标识代码 nodeCode: ${child.nodeCode}`);
        } else {
          seenNodeCodes.add(child.nodeCode);
        }
        directChildCodes.push(child.nodeCode);
      }

      if (isDimensionNode(child)) {
        if (!child.id || !child.name) {
          errors.push(`${levelLabel} 维度节点必须具备 id 与 name`);
        } else if (seenIds.has(child.id)) {
          errors.push(`存在重复维度 id: ${child.id}`);
        } else {
          seenIds.add(child.id);
        }

        if (child.aggregation?.mode === 'formula') {
          if (!child.aggregation.customFormula || !child.aggregation.customFormula.trim()) {
            errors.push(`${levelLabel} -> ${child.name} 为公式聚合模式，但未提供 customFormula`);
          }
        }

        checkLevel(
          child.children,
          `${levelLabel} -> ${child.name || child.id}`,
          new Set(seenIds),
          child.aggregation,
          depth + 1,
        );
      } else {
        const ind = indicatorStore.get(child.indicatorRef);
        if (!ind) {
          errors.push(`${levelLabel} 引用了未定义指标: ${child.indicatorRef}`);
        } else if (ind.bindingMode === 'composite') {
          for (const s of ind.sources ?? []) {
            if (!checkOpExists(s.atomRef)) {
              errors.push(
                `复合指标 ${child.indicatorRef} 输入源引用了未注册算子: ${s.atomRef}`,
              );
            }
          }
        } else if (!checkOpExists(ind.atomRef)) {
          errors.push(`指标 ${child.indicatorRef} 引用了未注册算子 ${ind.atomRef}`);
        }
      }
    }

    // 针对父节点 formula 模式的语法与变量校验
    if (parentAggregation?.mode === 'formula') {
      const missingCodeChildren = children.filter((c) => !c.nodeCode || !c.nodeCode.trim());
      if (missingCodeChildren.length > 0) {
        errors.push(`${levelLabel} 使用公式聚合模式时，所有直接子节点必须配置 nodeCode`);
      }
      if (parentAggregation.customFormula && parentAggregation.customFormula.trim()) {
        const syntaxCheck = validateFormula(parentAggregation.customFormula, directChildCodes);
        if (!syntaxCheck.valid) {
          errors.push(`${levelLabel} 聚合公式语法错误: ${syntaxCheck.errors.join('; ')}`);
        }
      }
    }

    // 只有在加权类聚合策略时，才严格校验同级权重和 = 1.0
    const strat = parentAggregation?.strategy || 'weighted_sum';
    const isWeightedStrategy =
      parentAggregation?.mode !== 'formula' &&
      (strat === 'weighted_sum' || strat === 'weighted_product' || strat === 'geometric_mean');

    if (isWeightedStrategy && Math.abs(weightSum - 1.0) > 1e-4) {
      errors.push(`${levelLabel} 同级子权重之和必须为 1.0 (当前为 ${weightSum.toFixed(4)})`);
    }
  };

  checkLevel(system.root.children, 'root', new Set<string>(), system.root.aggregation);

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
