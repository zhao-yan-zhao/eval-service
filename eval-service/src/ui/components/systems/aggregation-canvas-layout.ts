import type {
  AggregationStrategy,
  GateAuditItem,
  GateVerdict,
  IndicatorDefinition,
  IndicatorSystem,
  MetricAtomResult,
  NodeMissingPolicy,
  SystemDimensionNode,
  SystemEvaluationOutput,
  SystemIndicatorLeaf,
} from '../../../core/types.ts';
import { isDimensionNode } from './tree-walker.ts';

export const AGG_CANVAS_CONSTANTS = {
  LEAF_WIDTH: 268,
  DIM_WIDTH: 308,
  ROOT_WIDTH: 328,
  COL_STRIDE: 440, // 相邻列起点 X 间距
  ROW_GAP: 24, // 同列垂直间隙
  CANVAS_PAD_X: 48,
  CANVAS_PAD_Y: 48,
  DIM_HEIGHT: 172,
  ROOT_HEIGHT: 204,
} as const;

export function computeLeafCardHeight(indDef?: IndicatorDefinition): number {
  if (
    indDef?.bindingMode === 'composite' &&
    Array.isArray(indDef.sources) &&
    indDef.sources.length > 0
  ) {
    const visibleSources = Math.min(indDef.sources.length, 4);
    return 112 + visibleSources * 24;
  }
  return 112;
}

export type EdgeVisualKind = 'normal' | 'renormalized' | 'missing' | 'formula_var';

export interface AggCanvasNode {
  key: string;
  nodeId: string;
  kind: 'leaf' | 'dimension' | 'root';
  depth: number;
  bottomUpLevel: number;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  nodeCode?: string;
  weight: number;
  effectiveWeight?: number;
  score: number | null;
  // 叶子指标字段
  indicatorRef?: string;
  indicatorDef?: IndicatorDefinition;
  leafRawResult?: MetricAtomResult;
  // 维度/根聚合字段
  strategy: AggregationStrategy;
  missingPolicy: NodeMissingPolicy;
  customFormula?: string;
  formulaApplied?: string;
  availableWeightRatio?: number;
  equationText: string;
  // 根节点门控字段
  rawOverallScore?: number | null;
  gateVerdict?: GateVerdict;
  gateViolations?: GateAuditItem[];
}

export interface AggCanvasEdge {
  id: string;
  sourceKey: string;
  targetKey: string;
  sourceNodeId: string;
  targetNodeId: string;
  weight: number;
  effectiveWeight?: number;
  childNodeCode?: string;
  visualKind: EdgeVisualKind;
  badgeText: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  midX: number;
  midY: number;
  pathData: string;
}

export interface AggCanvasLayoutResult {
  nodes: AggCanvasNode[];
  edges: AggCanvasEdge[];
  canvasWidth: number;
  canvasHeight: number;
  maxDepth: number;
}

export function computeSystemConfigSignature(sys: IndicatorSystem): string {
  function walk(n: any): string {
    if (!n) return '';
    const parts = [
      n.id || '',
      n.nodeCode || '',
      n.weight ?? '',
      n.indicatorRef || '',
      n.aggregation?.mode || '',
      n.aggregation?.strategy || '',
      n.aggregation?.missingPolicy || '',
      n.aggregation?.customFormula || '',
    ];
    if (Array.isArray(n.children)) {
      parts.push(...n.children.map(walk));
    }
    return parts.join('|');
  }
  return `${sys.systemId}::${walk(sys.rootTree ?? sys.root)}`;
}

interface InternalTreeNode {
  key: string;
  nodeId: string;
  name: string;
  kind: 'root' | 'dimension' | 'leaf';
  depth: number;
  weight: number;
  nodeCode?: string;
  indicatorRef?: string;
  strategy: AggregationStrategy;
  missingPolicy: NodeMissingPolicy;
  customFormula?: string;
  children: InternalTreeNode[];
  bottomUpLevel: number;
  parentKey?: string;
  // evaluated properties
  score: number | null;
  effectiveWeight?: number;
  formulaApplied?: string;
  leafRawResult?: MetricAtomResult;
}

export function computeAggregationCanvasLayout(
  system: IndicatorSystem,
  indicatorsMap?: Map<string, IndicatorDefinition> | IndicatorDefinition[],
  evalOutput?: SystemEvaluationOutput | null,
): AggCanvasLayoutResult {
  if (!system || (!system.root && !system.rootTree)) {
    return {
      nodes: [],
      edges: [],
      canvasWidth: 800,
      canvasHeight: 600,
      maxDepth: 0,
    };
  }

  const indMap: Map<string, IndicatorDefinition> =
    indicatorsMap instanceof Map
      ? indicatorsMap
      : new Map((indicatorsMap || []).map((i) => [i.indicatorId, i]));

  // Build evaluated score & node lookup map from evalOutput
  const evalNodeMap = new Map<
    string,
    {
      score: number | null;
      effectiveWeight?: number;
      strategyUsed?: AggregationStrategy;
      missingPolicyUsed?: NodeMissingPolicy;
      formulaApplied?: string;
    }
  >();

  if (evalOutput) {
    if (evalOutput.rootTree) {
      const walkEval = (item: any) => {
        if (!item) return;
        const id = item.id || item.indicatorRef || item.nodeCode || item.name;
        evalNodeMap.set(id, {
          score: typeof item.score === 'number' ? item.score : null,
          effectiveWeight: item.effectiveWeight,
          strategyUsed: item.strategyUsed,
          missingPolicyUsed: item.missingPolicyUsed,
          formulaApplied: item.formulaApplied,
        });
        if (Array.isArray(item.children)) {
          for (const c of item.children) walkEval(c);
        }
      };
      walkEval(evalOutput.rootTree);
    }
    if (Array.isArray(evalOutput.dimensions)) {
      for (const d of evalOutput.dimensions) {
        if (!evalNodeMap.has(d.id)) {
          evalNodeMap.set(d.id, {
            score: d.score,
          });
        }
      }
    }
  }

  const sourceRoot = (system.rootTree ?? system.root) as any;
  const rootId = sourceRoot.id || system.systemId || 'root';

  // 1. Build Internal tree and assign bottomUpLevel
  function buildInternalTree(
    rawNode: any,
    depth: number,
    keyPath: string[],
    parentKey?: string,
  ): InternalTreeNode {
    const isRoot = depth === 0;
    const isDim = isRoot || isDimensionNode(rawNode);
    const nodeId = rawNode.id || (isRoot ? rootId : rawNode.indicatorRef || keyPath.join('.'));
    const currentKey = keyPath.join('->');
    const name = rawNode.name || (isRoot ? system.name : rawNode.indicatorRef || '未命名');
    const weight = typeof rawNode.weight === 'number' ? rawNode.weight : 1.0;
    const nodeCode = rawNode.nodeCode;
    const indicatorRef = rawNode.indicatorRef;

    const strat: AggregationStrategy =
      rawNode.aggregation?.strategy ||
      rawNode.strategy ||
      'weighted_sum';
    const missing: NodeMissingPolicy =
      rawNode.aggregation?.missingPolicy ||
      rawNode.missingPolicy ||
      'skip_renormalize';
    const customFormula = rawNode.aggregation?.customFormula || rawNode.customFormula;

    const evalInfo = evalNodeMap.get(nodeId) || (indicatorRef ? evalNodeMap.get(indicatorRef) : undefined);
    const score =
      evalInfo?.score !== undefined
        ? evalInfo.score
        : isRoot && evalOutput && typeof evalOutput.overallScore === 'number'
          ? evalOutput.overallScore
          : null;

    const leafRaw =
      indicatorRef && evalOutput?.atomResults
        ? evalOutput.atomResults[indicatorRef]
        : undefined;

    const children: InternalTreeNode[] = [];
    if (isDim && Array.isArray(rawNode.children)) {
      rawNode.children.forEach((c: any, idx: number) => {
        const childId = c.id || c.indicatorRef || `c_${idx}`;
        children.push(
          buildInternalTree(c, depth + 1, [...keyPath, childId], currentKey),
        );
      });
    }

    let bottomUpLevel = 0;
    if (isDim && children.length > 0) {
      bottomUpLevel = 1 + Math.max(...children.map((c) => c.bottomUpLevel));
    }

    return {
      key: currentKey,
      nodeId,
      name,
      kind: isRoot ? 'root' : isDim ? 'dimension' : 'leaf',
      depth,
      weight,
      nodeCode,
      indicatorRef,
      strategy: evalInfo?.strategyUsed || strat,
      missingPolicy: evalInfo?.missingPolicyUsed || missing,
      customFormula,
      children,
      bottomUpLevel,
      parentKey,
      score,
      effectiveWeight: evalInfo?.effectiveWeight,
      formulaApplied: evalInfo?.formulaApplied,
      leafRawResult: leafRaw,
    };
  }

  const rootInternal = buildInternalTree(sourceRoot, 0, [rootId]);
  const maxBottomUpLevel = rootInternal.bottomUpLevel;
  // Fix root to max column
  rootInternal.bottomUpLevel = maxBottomUpLevel;

  // 2. Collect leaves in pre-order DFS so related leaves group together
  const allLeaves: InternalTreeNode[] = [];
  function collectLeaves(node: InternalTreeNode) {
    if (node.kind === 'leaf' || node.children.length === 0) {
      allLeaves.push(node);
    } else {
      for (const c of node.children) {
        collectLeaves(c);
      }
    }
  }
  collectLeaves(rootInternal);

  // 3. Compute coordinates
  // Map internal key to computed layout node
  const layoutMap = new Map<string, AggCanvasNode>();

  // Column 0: All leaves aligned to leftmost column
  let currY = AGG_CANVAS_CONSTANTS.CANVAS_PAD_Y;
  for (const leaf of allLeaves) {
    const indDef = leaf.indicatorRef ? indMap.get(leaf.indicatorRef) : undefined;
    const h = computeLeafCardHeight(indDef);
    const node: AggCanvasNode = {
      key: leaf.key,
      nodeId: leaf.nodeId,
      kind: 'leaf',
      depth: leaf.depth,
      bottomUpLevel: 0,
      x: AGG_CANVAS_CONSTANTS.CANVAS_PAD_X,
      y: currY,
      width: AGG_CANVAS_CONSTANTS.LEAF_WIDTH,
      height: h,
      name: leaf.name,
      nodeCode: leaf.nodeCode,
      weight: leaf.weight,
      effectiveWeight: leaf.effectiveWeight,
      score: leaf.score,
      indicatorRef: leaf.indicatorRef,
      indicatorDef: indDef,
      leafRawResult: leaf.leafRawResult,
      strategy: 'weighted_sum',
      missingPolicy: 'skip_renormalize',
      equationText: '',
    };
    layoutMap.set(leaf.key, node);
    currY += h + AGG_CANVAS_CONSTANTS.ROW_GAP;
  }

  // Intermediate dimensions: level = 1 up to maxBottomUpLevel - 1
  for (let level = 1; level < maxBottomUpLevel; level++) {
    // Collect all dimension nodes at this bottom-up level
    const dimsAtLevel: InternalTreeNode[] = [];
    function collectDims(node: InternalTreeNode) {
      if (node.bottomUpLevel === level && node.kind === 'dimension') {
        dimsAtLevel.push(node);
      }
      for (const c of node.children) collectDims(c);
    }
    collectDims(rootInternal);

    // Compute ideal Y based on children center
    const withIdealY = dimsAtLevel.map((dim) => {
      const childLayouts = dim.children
        .map((c) => layoutMap.get(c.key))
        .filter(Boolean) as AggCanvasNode[];
      let idealY = AGG_CANVAS_CONSTANTS.CANVAS_PAD_Y;
      if (childLayouts.length > 0) {
        const minY = Math.min(...childLayouts.map((c) => c.y));
        const maxY = Math.max(...childLayouts.map((c) => c.y + c.height));
        idealY = (minY + maxY) / 2 - AGG_CANVAS_CONSTANTS.DIM_HEIGHT / 2;
      }
      return { dim, idealY };
    });

    // Sort by idealY to preserve vertical ordering
    withIdealY.sort((a, b) => a.idealY - b.idealY);

    let lastDimY = AGG_CANVAS_CONSTANTS.CANVAS_PAD_Y;
    for (const item of withIdealY) {
      const dim = item.dim;
      const targetY = Math.max(lastDimY, item.idealY);
      const childLayouts = dim.children
        .map((c) => layoutMap.get(c.key))
        .filter(Boolean) as AggCanvasNode[];
      const eqText = formatNodeAggregationEquation(dim, childLayouts, evalOutput);

      const node: AggCanvasNode = {
        key: dim.key,
        nodeId: dim.nodeId,
        kind: 'dimension',
        depth: dim.depth,
        bottomUpLevel: level,
        x: AGG_CANVAS_CONSTANTS.CANVAS_PAD_X + level * AGG_CANVAS_CONSTANTS.COL_STRIDE,
        y: targetY,
        width: AGG_CANVAS_CONSTANTS.DIM_WIDTH,
        height: AGG_CANVAS_CONSTANTS.DIM_HEIGHT,
        name: dim.name,
        nodeCode: dim.nodeCode,
        weight: dim.weight,
        effectiveWeight: dim.effectiveWeight,
        score: dim.score,
        strategy: dim.strategy,
        missingPolicy: dim.missingPolicy,
        customFormula: dim.customFormula,
        formulaApplied: dim.formulaApplied,
        equationText: eqText,
      };
      layoutMap.set(dim.key, node);
      lastDimY = targetY + AGG_CANVAS_CONSTANTS.DIM_HEIGHT + AGG_CANVAS_CONSTANTS.ROW_GAP;
    }
  }

  // Root node: placed at rightmost column (maxBottomUpLevel)
  const rootChildLayouts = rootInternal.children
    .map((c) => layoutMap.get(c.key))
    .filter(Boolean) as AggCanvasNode[];
  let rootIdealY = AGG_CANVAS_CONSTANTS.CANVAS_PAD_Y;
  if (rootChildLayouts.length > 0) {
    const minY = Math.min(...rootChildLayouts.map((c) => c.y));
    const maxY = Math.max(...rootChildLayouts.map((c) => c.y + c.height));
    rootIdealY = (minY + maxY) / 2 - AGG_CANVAS_CONSTANTS.ROOT_HEIGHT / 2;
  }
  const rootY = Math.max(AGG_CANVAS_CONSTANTS.CANVAS_PAD_Y, rootIdealY);
  const rootEqText = formatNodeAggregationEquation(
    rootInternal,
    rootChildLayouts,
    evalOutput,
  );

  const rootLayoutNode: AggCanvasNode = {
    key: rootInternal.key,
    nodeId: rootInternal.nodeId,
    kind: 'root',
    depth: 0,
    bottomUpLevel: maxBottomUpLevel,
    x:
      AGG_CANVAS_CONSTANTS.CANVAS_PAD_X +
      maxBottomUpLevel * AGG_CANVAS_CONSTANTS.COL_STRIDE,
    y: rootY,
    width: AGG_CANVAS_CONSTANTS.ROOT_WIDTH,
    height: AGG_CANVAS_CONSTANTS.ROOT_HEIGHT,
    name: rootInternal.name,
    nodeCode: rootInternal.nodeCode,
    weight: rootInternal.weight,
    effectiveWeight: 1.0,
    score: rootInternal.score,
    strategy: rootInternal.strategy,
    missingPolicy: rootInternal.missingPolicy,
    customFormula: rootInternal.customFormula,
    formulaApplied: rootInternal.formulaApplied,
    availableWeightRatio: evalOutput?.availableWeightRatio,
    equationText: rootEqText,
    rawOverallScore: evalOutput?.rawOverallScore,
    gateVerdict: evalOutput?.gateVerdict,
    gateViolations: evalOutput?.gateAudit?.filter(
      (g) => g.gateStatus === 'breached' || g.gateStatus === 'warning',
    ),
  };
  layoutMap.set(rootInternal.key, rootLayoutNode);

  // 4. Generate Edges with classification and anchor coordinates
  const edges: AggCanvasEdge[] = [];

  function buildEdges(parent: InternalTreeNode) {
    const parentLayout = layoutMap.get(parent.key);
    if (!parentLayout) return;

    const siblings = parent.children;
    const siblingWeightSum = siblings.reduce(
      (sum, s) => sum + (typeof s.weight === 'number' ? s.weight : 0),
      0,
    );

    for (const child of siblings) {
      const childLayout = layoutMap.get(child.key);
      if (!childLayout) continue;

      const edgeId = `agg-edge-${child.key}->${parent.key}`;
      const { visualKind, badgeText } = classifyEdgeVisual(
        child,
        parent,
        siblingWeightSum,
        evalOutput,
      );

      const startX = childLayout.x + childLayout.width;
      const startY = childLayout.y + childLayout.height / 2;
      const endX = parentLayout.x;
      const rawEndY = parentLayout.y + parentLayout.height / 2;
      // Sub-pixel guard to avoid 0-height SVG bounding box gradient invisibility
      const safeEndY =
        Math.abs(rawEndY - startY) < 0.1 ? startY + 0.05 : rawEndY;

      const midX = (startX + endX) / 2;
      const midY = (startY + safeEndY) / 2;

      const dx = endX - startX;
      const c1x = startX + dx * 0.45;
      const c2x = endX - dx * 0.45;
      const pathData = `M ${startX} ${startY} C ${c1x} ${startY}, ${c2x} ${safeEndY}, ${endX} ${safeEndY}`;

      edges.push({
        id: edgeId,
        sourceKey: child.key,
        targetKey: parent.key,
        sourceNodeId: child.nodeId,
        targetNodeId: parent.nodeId,
        weight: child.weight,
        effectiveWeight: child.effectiveWeight,
        childNodeCode: child.nodeCode,
        visualKind,
        badgeText,
        startX,
        startY,
        endX,
        endY: safeEndY,
        midX,
        midY,
        pathData,
      });

      if (child.children.length > 0) {
        buildEdges(child);
      }
    }
  }

  buildEdges(rootInternal);

  const allLayoutNodes = Array.from(layoutMap.values());
  const maxNodeX = Math.max(...allLayoutNodes.map((n) => n.x + n.width), 800);
  const maxNodeY = Math.max(...allLayoutNodes.map((n) => n.y + n.height), 600);

  return {
    nodes: allLayoutNodes,
    edges,
    canvasWidth: maxNodeX + AGG_CANVAS_CONSTANTS.CANVAS_PAD_X,
    canvasHeight: maxNodeY + AGG_CANVAS_CONSTANTS.CANVAS_PAD_Y,
    maxDepth: maxBottomUpLevel,
  };
}

export function classifyEdgeVisual(
  child: InternalTreeNode,
  parent: InternalTreeNode,
  siblingWeightSum: number,
  evalOutput?: SystemEvaluationOutput | null,
): { visualKind: EdgeVisualKind; badgeText: string } {
  // If evaluated and child score is null / unavailable
  if (evalOutput && child.score === null) {
    const policy = parent.missingPolicy;
    let badgeText = '缺失 · 已剔除';
    if (policy === 'fail') badgeText = '缺失 · 熔断(fail)';
    else if (policy === 'worst') badgeText = '缺失 · 0分惩罚';
    else if (policy === 'neutral') badgeText = '缺失 · 50分中性';
    return { visualKind: 'missing', badgeText };
  }

  // If parent is formula
  if (parent.strategy === 'formula') {
    return {
      visualKind: 'formula_var',
      badgeText: child.nodeCode ? `var: ${child.nodeCode}` : `id: ${child.nodeId}`,
    };
  }

  // If parent is weighted sum/product/geometric_mean
  const isWeighted =
    parent.strategy === 'weighted_sum' ||
    parent.strategy === 'weighted_product' ||
    parent.strategy === 'geometric_mean';

  if (isWeighted) {
    const expectedNorm =
      siblingWeightSum > 0 ? child.weight / siblingWeightSum : child.weight;
    if (
      evalOutput &&
      typeof child.effectiveWeight === 'number' &&
      Math.abs(child.effectiveWeight - expectedNorm) > 0.005
    ) {
      return {
        visualKind: 'renormalized',
        badgeText: `w:${expectedNorm.toFixed(2)} ➔ 实效:${child.effectiveWeight.toFixed(2)}↑`,
      };
    }
    return {
      visualKind: 'normal',
      badgeText: `w: ${child.weight.toFixed(2)}`,
    };
  }

  // Non-weighted strategies
  if (parent.strategy === 'maximin') {
    return { visualKind: 'normal', badgeText: `短板考量 (w:${child.weight.toFixed(2)})` };
  }
  if (parent.strategy === 'max') {
    return { visualKind: 'normal', badgeText: `最优择优 (w:${child.weight.toFixed(2)})` };
  }
  if (parent.strategy === 'mean') {
    return { visualKind: 'normal', badgeText: '等权平均 (1/N)' };
  }

  return { visualKind: 'normal', badgeText: `w: ${child.weight.toFixed(2)}` };
}

export function formatNodeAggregationEquation(
  node: InternalTreeNode,
  children: AggCanvasNode[],
  evalOutput?: SystemEvaluationOutput | null,
): string {
  if (node.strategy === 'formula') {
    if (node.formulaApplied) {
      return node.formulaApplied;
    }
    return `公式: ${node.customFormula || '未配置'}`;
  }

  if (node.strategy === 'maximin') {
    if (evalOutput && typeof node.score === 'number') {
      const items = children
        .map(
          (c) =>
            `${c.nodeCode || c.name.slice(0, 4)}:${c.score !== null ? c.score.toFixed(1) : 'null'}`,
        )
        .join(', ');
      return `MIN(${items}) = ${node.score.toFixed(1)}`;
    }
    return `MIN(${children.length} 项子指标) — 取最低短板`;
  }

  if (node.strategy === 'max') {
    if (evalOutput && typeof node.score === 'number') {
      const items = children
        .map(
          (c) =>
            `${c.nodeCode || c.name.slice(0, 4)}:${c.score !== null ? c.score.toFixed(1) : 'null'}`,
        )
        .join(', ');
      return `MAX(${items}) = ${node.score.toFixed(1)}`;
    }
    return `MAX(${children.length} 项子指标) — 取最高择优`;
  }

  if (node.strategy === 'mean') {
    if (evalOutput && typeof node.score === 'number') {
      const items = children
        .map((c) => (c.score !== null ? c.score.toFixed(1) : 'null'))
        .join(', ');
      return `AVG(${items}) = ${node.score.toFixed(1)}`;
    }
    return `AVG(${children.length} 项子指标) — 等权平均`;
  }

  if (node.strategy === 'weighted_product' || node.strategy === 'geometric_mean') {
    if (evalOutput && typeof node.score === 'number') {
      return `100 × Π((s_i/100)^w_i) = ${node.score.toFixed(1)}`;
    }
    return `加权几何积 Π (s_i)^w_i`;
  }

  // Default: weighted_sum
  if (evalOutput && typeof node.score === 'number') {
    const validTerms = children
      .filter((c) => c.score !== null)
      .map(
        (c) =>
          `${(c.effectiveWeight ?? c.weight).toFixed(2)}×${c.score!.toFixed(1)}`,
      );
    if (validTerms.length === 0) {
      return `有效项为0 ➔ ${node.score.toFixed(1)}`;
    }
    if (validTerms.length <= 3) {
      return `${validTerms.join(' + ')} = ${node.score.toFixed(1)}`;
    }
    return `${validTerms.slice(0, 3).join(' + ')} + ... = ${node.score.toFixed(1)}`;
  }

  return `Σ w_i · s_i (${children.length} 项子指标)`;
}
