import type {
  IndicatorDefinition,
  IndicatorSystem,
  SystemDimensionNode,
  SystemIndicatorLeaf,
} from '../../../core/types.ts';

export interface FlatTreeNode {
  id: string;
  name: string;
  kind: 'root' | 'dimension' | 'leaf';
  depth: number;
  localWeight: number;
  globalWeight: number;
  childrenCount: number;
  weightSumValid: boolean;
  weightSum: number;
  indicatorRef?: string;
  atomRef?: string;
  score?: number | null;
  originalNode: IndicatorSystem['root'] | SystemDimensionNode | SystemIndicatorLeaf;
  path: string[];
}

export function isDimensionNode(
  node: SystemDimensionNode | SystemIndicatorLeaf,
): node is SystemDimensionNode {
  return typeof node === 'object' && node !== null && 'children' in node && Array.isArray((node as SystemDimensionNode).children);
}

export function isIndicatorLeaf(
  node: SystemDimensionNode | SystemIndicatorLeaf,
): node is SystemIndicatorLeaf {
  return !isDimensionNode(node);
}

/**
 * 展平 IndicatorSystem 层次结构树，生成预序遍历的扁平化节点列表，
 * 附带深度、局部权重、级联全局权重、权重和校验以及评估得分信息。
 */
export function flattenSystemTree(
  system: IndicatorSystem,
  indicatorMap?: Map<string, IndicatorDefinition>,
  evalScores?: Record<string, number>,
): FlatTreeNode[] {
  const result: FlatTreeNode[] = [];
  if (!system || !system.root) {
    return result;
  }

  const rootId = (system.root as { id?: string }).id || system.systemId || 'root';
  const rootChildren = system.root.children || [];
  const rootWeightSum =
    rootChildren.length > 0
      ? Math.round(
          rootChildren.reduce((acc, c) => acc + (typeof c.weight === 'number' ? c.weight : 0), 0) *
            10000,
        ) / 10000
      : 0;
  const rootWeightSumValid =
    rootChildren.length > 0 && Math.abs(rootWeightSum - 1.0) <= 1e-4;

  const rootScore =
    evalScores?.[rootId] ??
    evalScores?.[system.systemId] ??
    evalScores?.['root'] ??
    null;

  const rootNode: FlatTreeNode = {
    id: rootId,
    name: system.root.name || system.name || '评估体系根节点',
    kind: 'root',
    depth: 0,
    localWeight: typeof system.root.weight === 'number' ? system.root.weight : 1.0,
    globalWeight: 1.0,
    childrenCount: rootChildren.length,
    weightSumValid: rootWeightSumValid,
    weightSum: rootWeightSum,
    score: rootScore,
    originalNode: system.root,
    path: [rootId],
  };

  result.push(rootNode);

  function walk(
    child: SystemDimensionNode | SystemIndicatorLeaf,
    parent: FlatTreeNode,
  ): void {
    if (isDimensionNode(child)) {
      const dimChildren = child.children || [];
      const dimWeightSum =
        dimChildren.length > 0
          ? Math.round(
              dimChildren.reduce(
                (acc, c) => acc + (typeof c.weight === 'number' ? c.weight : 0),
                0,
              ) * 10000,
            ) / 10000
          : 0;
      const dimWeightSumValid =
        dimChildren.length > 0 && Math.abs(dimWeightSum - 1.0) <= 1e-4;

      const dimLocalWeight = typeof child.weight === 'number' ? child.weight : 0;
      const dimGlobalWeight =
        Math.round(parent.globalWeight * dimLocalWeight * 1e6) / 1e6;

      const dimScore =
        evalScores?.[child.id] ??
        evalScores?.[child.name] ??
        null;

      const dimFlatNode: FlatTreeNode = {
        id: child.id,
        name: child.name,
        kind: 'dimension',
        depth: parent.depth + 1,
        localWeight: dimLocalWeight,
        globalWeight: dimGlobalWeight,
        childrenCount: dimChildren.length,
        weightSumValid: dimWeightSumValid,
        weightSum: dimWeightSum,
        score: dimScore,
        originalNode: child,
        path: [...parent.path, child.id],
      };

      result.push(dimFlatNode);

      for (const grandChild of dimChildren) {
        walk(grandChild, dimFlatNode);
      }
    } else {
      const leafId = child.id || child.indicatorRef;
      const indDef = indicatorMap?.get(child.indicatorRef);
      const leafName = child.customLabel || indDef?.name || child.indicatorRef;
      const leafLocalWeight = typeof child.weight === 'number' ? child.weight : 0;
      const leafGlobalWeight =
        Math.round(parent.globalWeight * leafLocalWeight * 1e6) / 1e6;

      const leafScore =
        evalScores?.[leafId] ??
        evalScores?.[child.indicatorRef] ??
        (indDef?.atomRef ? evalScores?.[indDef.atomRef] : undefined) ??
        null;

      const leafFlatNode: FlatTreeNode = {
        id: leafId,
        name: leafName,
        kind: 'leaf',
        depth: parent.depth + 1,
        localWeight: leafLocalWeight,
        globalWeight: leafGlobalWeight,
        childrenCount: 0,
        weightSumValid: true,
        weightSum: leafLocalWeight,
        indicatorRef: child.indicatorRef,
        atomRef: indDef?.atomRef,
        score: leafScore,
        originalNode: child,
        path: [...parent.path, leafId],
      };

      result.push(leafFlatNode);
    }
  }

  for (const child of rootChildren) {
    walk(child, rootNode);
  }

  return result;
}

export interface WeightValidationReport {
  valid: boolean;
  invalidBranches: Array<{ path: string[]; sum: number }>;
}

/**
 * 校验评估体系维度节点的权重分配规则（每层同级子节点权重之和必须为 1.0）。
 * 可传入 SystemDimensionNode, IndicatorSystem['root'] 或整个 IndicatorSystem。
 */
export function validateSystemWeights(
  node: SystemDimensionNode | IndicatorSystem['root'] | IndicatorSystem,
  parentPath: string[] = [],
): WeightValidationReport {
  const invalidBranches: Array<{ path: string[]; sum: number }> = [];

  let targetNode: SystemDimensionNode | IndicatorSystem['root'];
  let currentPath: string[];

  if ('systemId' in node && 'root' in node) {
    targetNode = node.root;
    currentPath = [node.name || node.systemId || 'root'];
  } else {
    targetNode = node as SystemDimensionNode | IndicatorSystem['root'];
    const nodeIdentifier =
      (node as SystemDimensionNode).id ||
      targetNode.name ||
      'root';
    currentPath = parentPath.length > 0 ? [...parentPath, nodeIdentifier] : [nodeIdentifier];
  }

  const children = targetNode.children || [];
  const rawSum = children.reduce(
    (acc, c) => acc + (typeof c.weight === 'number' ? c.weight : 0),
    0,
  );
  const roundedSum = Math.round(rawSum * 10000) / 10000;

  if (children.length === 0 || Math.abs(roundedSum - 1.0) > 1e-4) {
    invalidBranches.push({
      path: currentPath,
      sum: roundedSum,
    });
  }

  for (const child of children) {
    if (isDimensionNode(child)) {
      const sub = validateSystemWeights(child, currentPath);
      if (!sub.valid) {
        invalidBranches.push(...sub.invalidBranches);
      }
    }
  }

  return {
    valid: invalidBranches.length === 0,
    invalidBranches,
  };
}

/**
 * 将同级子节点（维度或指标叶子）权重重归一化，使其总和严格等于 1.0（保留 4 位小数并平摊尾差）。
 */
export function normalizeBranchWeights(
  children: Array<SystemDimensionNode | SystemIndicatorLeaf>,
): Array<SystemDimensionNode | SystemIndicatorLeaf> {
  const n = children.length;
  if (n === 0) {
    return [];
  }

  const cloned = children.map((c) => ({ ...c }));
  if (n === 1) {
    cloned[0].weight = 1.0;
    return cloned;
  }

  const sum = cloned.reduce((acc, c) => acc + (c.weight > 0 ? c.weight : 0), 0);

  for (let i = 0; i < n; i++) {
    if (sum > 0) {
      cloned[i].weight =
        Math.round(((cloned[i].weight > 0 ? cloned[i].weight : 0) / sum) * 10000) / 10000;
    } else {
      cloned[i].weight = Math.round((1 / n) * 10000) / 10000;
    }
  }

  // 把四舍五入尾差补偿给最后一项保证严格 ∑ = 1.0
  const leadingSum = cloned.slice(0, n - 1).reduce((acc, c) => acc + c.weight, 0);
  cloned[n - 1].weight = Math.max(0.0001, Math.round((1.0 - leadingSum) * 10000) / 10000);

  return cloned;
}
