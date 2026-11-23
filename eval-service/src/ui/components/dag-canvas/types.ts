/**
 * F1 V4 通用三层 DAG 画布核心视图契约与强隔离元数据
 * 严格对齐 src/core/types.ts 中的 DagGraphKind / DagNodeBase / DagEdge 契约
 */

import type {
  AggregationStrategy,
  DagEdge,
  DagGraphKind,
  DagNodeBase,
  GateMode,
  GateStatus,
  MetricDomainTag,
  MetricMilitaryLevel,
  TableDataset,
} from '../../../core/types.ts';

export type DagNodeStatus =
  | 'idle'
  | 'running'
  | 'valid'
  | 'degraded'
  | 'unavailable'
  | 'violated';

export const DEFAULT_DAG_NODE_WIDTH = 280;
export const DEFAULT_DAG_NODE_HEIGHT = 148;

export interface DagGraphIsolationMeta {
  graphKind: DagGraphKind;
  title: string;
  shortBadge: string;
  payloadLabel: string;
  isolationRule: string;
  accent: 'cyan' | 'emerald' | 'indigo';
  badgeClass: string;
  toolbarBorderClass: string;
  cardBorderClass: string;
  selectedRingClass: string;
  portActiveClass: string;
  accentTextClass: string;
  edgeBaseHex: string;
  edgeGradStartHex: string;
  edgeGradEndHex: string;
  edgeFlowHex: string;
  edgeArrowHex: string;
}

export const DAG_GRAPH_ISOLATION_META: Record<DagGraphKind, DagGraphIsolationMeta> = {
  operator: {
    graphKind: 'operator',
    title: '一库 · 算子数据变换流',
    shortBadge: '算子 DAG · TableDataset',
    payloadLabel: 'TableDataset (rows × cols)',
    isolationRule: '数据变换流强隔离：节点间仅传递 TableDataset 明细/聚合表，禁止硬编码考核线与权重打分',
    accent: 'cyan',
    badgeClass: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300',
    toolbarBorderClass: 'border-cyan-500/25',
    cardBorderClass: 'border-cyan-500/35 hover:border-cyan-400/70',
    selectedRingClass: 'ring-2 ring-cyan-400 border-cyan-400 shadow-cyan-950/60',
    portActiveClass: 'border-cyan-400 bg-cyan-500',
    accentTextClass: 'text-cyan-400',
    edgeBaseHex: '#0284c7',
    edgeGradStartHex: '#06b6d4',
    edgeGradEndHex: '#3b82f6',
    edgeFlowHex: '#67e8f9',
    edgeArrowHex: '#38bdf8',
  },
  metric: {
    graphKind: 'metric',
    title: '二库 · 客观指标计算流',
    shortBadge: '指标 DAG · MOP/MOE/MOFE',
    payloadLabel: 'MOP / MOE / MOFE 客观度量',
    isolationRule: '客观指标流强隔离：仅输出带量纲物理量或客观比率，禁止主观权重与百分制映射',
    accent: 'emerald',
    badgeClass: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
    toolbarBorderClass: 'border-emerald-500/25',
    cardBorderClass: 'border-emerald-500/35 hover:border-emerald-400/70',
    selectedRingClass: 'ring-2 ring-emerald-400 border-emerald-400 shadow-emerald-950/60',
    portActiveClass: 'border-emerald-400 bg-emerald-500',
    accentTextClass: 'text-emerald-400',
    edgeBaseHex: '#059669',
    edgeGradStartHex: '#10b981',
    edgeGradEndHex: '#14b8a6',
    edgeFlowHex: '#6ee7b7',
    edgeArrowHex: '#34d399',
  },
  system: {
    graphKind: 'system',
    title: '三库 · 效果合成与门控流',
    shortBadge: '体系 DAG · Effect / GATE',
    payloadLabel: 'EffectScore [0,100] & GATE',
    isolationRule: '效果合成流强隔离：入边携带局部权重 (Σw = 1.00)，支持效果无限叠加与红线门控',
    accent: 'indigo',
    badgeClass: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300',
    toolbarBorderClass: 'border-indigo-500/25',
    cardBorderClass: 'border-indigo-500/35 hover:border-violet-400/70',
    selectedRingClass: 'ring-2 ring-indigo-400 border-indigo-400 shadow-indigo-950/60',
    portActiveClass: 'border-indigo-400 bg-indigo-500',
    accentTextClass: 'text-indigo-400',
    edgeBaseHex: '#6366f1',
    edgeGradStartHex: '#818cf8',
    edgeGradEndHex: '#a855f7',
    edgeFlowHex: '#c4b5fd',
    edgeArrowHex: '#a78bfa',
  },
};

export interface DagCanvasNodeSummary {
  // ── 一库算子流摘要 ──
  rowCount?: number;
  columnCount?: number;
  tableName?: string;
  dataset?: TableDataset;

  // ── 二库指标流摘要 ──
  metricId?: string;
  militaryLevel?: MetricMilitaryLevel;
  domainTag?: MetricDomainTag;
  value?: number | boolean | null;
  displayValue?: string;
  unit?: string;

  // ── 三库效果合成流摘要 ──
  effectId?: string;
  score?: number | null;
  rawScore?: number | null;
  rawValue?: number | boolean | null;
  role?: 'effect' | 'gate' | 'metric_proxy';
  gateMode?: GateMode;
  gateStatus?: GateStatus;
  strategy?: AggregationStrategy;
  isTerminal?: boolean;
  availableWeightRatio?: number;

  // ── 通用执行摘要 ──
  subtitle?: string;
  badgeText?: string;
  latencyMs?: number;
  cacheHit?: boolean;
  missingDataReason?: string;
  errorMessage?: string;
}

export interface DagCanvasNode extends DagNodeBase {
  graphKind?: DagGraphKind;
  groupId?: string;
  parentGroupNodeId?: string;
  depth?: number;
  width?: number;
  height?: number;
  status: DagNodeStatus;
  summary?: DagCanvasNodeSummary;
  canDrillDown?: boolean;
  drillDownLabel?: string;
  meta?: Record<string, unknown>;
}

export interface DagCanvasEdge extends DagEdge {
  graphKind?: DagGraphKind;
  label?: string;
  status?: DagNodeStatus;
  effectiveWeight?: number;
  isVirtualCollapsed?: boolean;
}

export interface DagViewportState {
  panX: number;
  panY: number;
  zoom: number;
}

export interface ConnectValidationResult {
  allowed: boolean;
  reason?: string;
}

export interface IncomingWeightSummary {
  nodeId: string;
  incomingCount: number;
  sum: number;
  isBalanced: boolean;
}

export interface DagCanvasCallbacks {
  onDrillDown?: (nodeId: string) => void;
  onUpdateEdgeWeight?: (edgeId: string, weight: number) => void;
  onToggleCollapse?: (nodeId: string, collapsed: boolean) => void;
}

/**
 * 端口连线合法性校验（含 graphKind 强隔离、自环防御、重复边拦截与 BFS 环路检测）
 */
export function canConnectNodes(
  source: DagCanvasNode,
  target: DagCanvasNode,
  graphKind: DagGraphKind,
  existingEdges: DagCanvasEdge[],
): ConnectValidationResult {
  if (source.id === target.id) {
    return { allowed: false, reason: '禁止创建节点自环连接' };
  }

  if (source.graphKind && source.graphKind !== graphKind) {
    return {
      allowed: false,
      reason: `画布强隔离拦截：源节点属于 [${source.graphKind}] 层，不能连入 [${graphKind}] 画布`,
    };
  }

  if (target.graphKind && target.graphKind !== graphKind) {
    return {
      allowed: false,
      reason: `画布强隔离拦截：目标节点属于 [${target.graphKind}] 层，不能接收 [${graphKind}] 连线`,
    };
  }

  if (source.graphKind && target.graphKind && source.graphKind !== target.graphKind) {
    return {
      allowed: false,
      reason: `跨层隔离拦截：禁止 [${source.graphKind}] 与 [${target.graphKind}] 直接连线`,
    };
  }

  if (source.meta?.disallowOutgoing === true) {
    return { allowed: false, reason: '该终端节点已配置为禁止继续向下游输出连线' };
  }

  if (target.meta?.disallowIncoming === true) {
    return { allowed: false, reason: '该源节点已配置为仅输出，不可接收上游连线' };
  }

  if (graphKind === 'operator') {
    if (source.kind === 'result_output') {
      return { allowed: false, reason: '算子流隔离：结果输出节点为流水线终点，不能作为上游继续输出' };
    }
    if (target.kind === 'data_input') {
      return { allowed: false, reason: '算子流隔离：数据输入节点仅可作为源头，不可接入上游连线' };
    }
  }

  if (graphKind === 'system') {
    if (target.kind === 'metric_proxy' || target.summary?.role === 'metric_proxy') {
      return { allowed: false, reason: '体系流隔离：客观指标代理节点仅作为输入源，不能接收效果节点入边' };
    }
  }

  const duplicate = existingEdges.some(
    (e) => !e.isVirtualCollapsed && e.sourceNodeId === source.id && e.targetNodeId === target.id,
  );
  if (duplicate) {
    return { allowed: false, reason: '这两个节点之间已存在相同流向的连线' };
  }

  // BFS 可达性检测：若从 target 出发沿现有边能到达 source，则添加 source -> target 必将形成有向环
  const adj = new Map<string, string[]>();
  for (const edge of existingEdges) {
    if (edge.isVirtualCollapsed) continue;
    const list = adj.get(edge.sourceNodeId);
    if (list) {
      list.push(edge.targetNodeId);
    } else {
      adj.set(edge.sourceNodeId, [edge.targetNodeId]);
    }
  }

  const visited = new Set<string>([target.id]);
  const queue: string[] = [target.id];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === source.id) {
      return {
        allowed: false,
        reason: '无法创建环路依赖：DAG 评估图必须保持单向无环 (Kahn Acyclic)',
      };
    }
    const nextList = adj.get(current);
    if (!nextList) continue;
    for (const nextId of nextList) {
      if (!visited.has(nextId)) {
        visited.add(nextId);
        queue.push(nextId);
      }
    }
  }

  return { allowed: true };
}

/**
 * 计算节点的入边局部权重和校验状态 (Σw = 1.0000 ± 1e-4)
 */
export function computeIncomingWeightSummary(
  nodeId: string,
  edges: DagCanvasEdge[],
): IncomingWeightSummary {
  const incoming = edges.filter((e) => !e.isVirtualCollapsed && e.targetNodeId === nodeId);
  const sum = incoming.reduce((acc, edge) => {
    const val = typeof edge.weight === 'number' && Number.isFinite(edge.weight) ? edge.weight : 0;
    return acc + val;
  }, 0);
  const isBalanced = incoming.length === 0 || Math.abs(sum - 1.0) <= 1e-4;
  return {
    nodeId,
    incomingCount: incoming.length,
    sum,
    isBalanced,
  };
}

/**
 * 基于 Kahn 拓扑排序计算节点层级深度（最长前置路径深度），并安全处理任何异常断环
 */
export function computeDagTopologicalInfo(
  nodes: DagCanvasNode[],
  edges: DagCanvasEdge[],
): { order: string[]; depthMap: Map<string, number> } {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const depthMap = new Map<string, number>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
    depthMap.set(n.id, typeof n.depth === 'number' ? n.depth : 0);
  }

  const realEdges = edges.filter(
    (e) => !e.isVirtualCollapsed && nodeIds.has(e.sourceNodeId) && nodeIds.has(e.targetNodeId),
  );

  for (const e of realEdges) {
    adj.get(e.sourceNodeId)!.push(e.targetNodeId);
    inDegree.set(e.targetNodeId, (inDegree.get(e.targetNodeId) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const n of nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0) {
      queue.push(n.id);
      depthMap.set(n.id, 0);
    }
  }

  const order: string[] = [];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const cur = queue.shift()!;
    order.push(cur);
    visited.add(cur);
    const curDepth = depthMap.get(cur) ?? 0;

    for (const nextId of adj.get(cur) ?? []) {
      const prevNextDepth = depthMap.get(nextId) ?? 0;
      if (curDepth + 1 > prevNextDepth) {
        depthMap.set(nextId, curDepth + 1);
      }
      const rem = (inDegree.get(nextId) ?? 0) - 1;
      inDegree.set(nextId, rem);
      if (rem === 0) {
        queue.push(nextId);
      }
    }
  }

  // 兜底处理未入队节点（防止孤立环阻塞大纲渲染）
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      order.push(n.id);
    }
  }

  return { order, depthMap };
}

export interface VisibleSubgraphResult {
  visibleNodes: DagCanvasNode[];
  visibleEdges: DagCanvasEdge[];
  hiddenNodeIds: Set<string>;
  collapsedCountByNodeId: Map<string, number>;
  collapsedAnchorByHiddenId: Map<string, string>;
}

/**
 * 子图折叠过滤：
 * 当节点 collapsed=true 时，隐去其专属子节点（parentGroupNodeId、同 groupId 成员、以及被该节点完全支配的下游后继），
 * 保留安全跨分支可见节点，并为折叠节点输出折叠计数与虚拟摘要桥接边。
 */
export function computeVisibleDagSubgraph(
  nodes: DagCanvasNode[],
  edges: DagCanvasEdge[],
): VisibleSubgraphResult {
  const { order } = computeDagTopologicalInfo(nodes, edges);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const realEdges = edges.filter(
    (e) => !e.isVirtualCollapsed && nodeMap.has(e.sourceNodeId) && nodeMap.has(e.targetNodeId),
  );

  const outgoingMap = new Map<string, string[]>();
  const incomingMap = new Map<string, string[]>();
  for (const n of nodes) {
    outgoingMap.set(n.id, []);
    incomingMap.set(n.id, []);
  }
  for (const e of realEdges) {
    outgoingMap.get(e.sourceNodeId)!.push(e.targetNodeId);
    incomingMap.get(e.targetNodeId)!.push(e.sourceNodeId);
  }

  const hiddenNodeIds = new Set<string>();
  const collapsedCountByNodeId = new Map<string, number>();
  const collapsedAnchorByHiddenId = new Map<string, string>();

  for (const anchorId of order) {
    if (hiddenNodeIds.has(anchorId)) continue;
    const anchor = nodeMap.get(anchorId);
    if (!anchor?.collapsed) continue;

    const localHidden = new Set<string>();
    const bfsQueue: string[] = [anchorId];

    // 1. 显式分组或子归属节点
    for (const candidate of nodes) {
      if (candidate.id === anchorId || hiddenNodeIds.has(candidate.id)) continue;
      if (candidate.parentGroupNodeId === anchorId) {
        localHidden.add(candidate.id);
        bfsQueue.push(candidate.id);
      } else if (anchor.groupId && candidate.groupId === anchor.groupId) {
        localHidden.add(candidate.id);
        bfsQueue.push(candidate.id);
      }
    }

    // 2. 拓扑下游独占支配传播（仅当下游节点所有入边均来自折叠子图时才隐藏，不误伤外部交叉分支）
    let idx = 0;
    while (idx < bfsQueue.length) {
      const cur = bfsQueue[idx++];
      for (const nextId of outgoingMap.get(cur) ?? []) {
        if (nextId === anchorId || hiddenNodeIds.has(nextId) || localHidden.has(nextId)) {
          continue;
        }
        const preds = incomingMap.get(nextId) ?? [];
        const allPredsFolded =
          preds.length > 0 &&
          preds.every(
            (p) => p === anchorId || localHidden.has(p) || hiddenNodeIds.has(p),
          );
        if (allPredsFolded) {
          localHidden.add(nextId);
          bfsQueue.push(nextId);
        }
      }
    }

    if (localHidden.size > 0) {
      collapsedCountByNodeId.set(anchorId, localHidden.size);
      for (const hid of localHidden) {
        hiddenNodeIds.add(hid);
        collapsedAnchorByHiddenId.set(hid, anchorId);
      }
    }
  }

  const visibleNodes = nodes.filter((n) => !hiddenNodeIds.has(n.id));
  const visibleEdges = realEdges.filter(
    (e) => !hiddenNodeIds.has(e.sourceNodeId) && !hiddenNodeIds.has(e.targetNodeId),
  );

  // 为折叠子图内部通向外部可见节点的跨界边建立只读虚拟桥接连线
  const virtualPairs = new Set<string>();
  for (const e of realEdges) {
    if (hiddenNodeIds.has(e.sourceNodeId) && !hiddenNodeIds.has(e.targetNodeId)) {
      const anchorId = collapsedAnchorByHiddenId.get(e.sourceNodeId);
      if (anchorId && anchorId !== e.targetNodeId) {
        const pairKey = `${anchorId}->${e.targetNodeId}`;
        const hasRealEdge = visibleEdges.some(
          (ve) => ve.sourceNodeId === anchorId && ve.targetNodeId === e.targetNodeId,
        );
        if (!hasRealEdge && !virtualPairs.has(pairKey)) {
          virtualPairs.add(pairKey);
          visibleEdges.push({
            id: `__collapsed_bridge_${anchorId}_${e.targetNodeId}`,
            sourceNodeId: anchorId,
            targetNodeId: e.targetNodeId,
            graphKind: e.graphKind,
            status: e.status,
            isVirtualCollapsed: true,
          });
        }
      }
    }
  }

  return {
    visibleNodes,
    visibleEdges,
    hiddenNodeIds,
    collapsedCountByNodeId,
    collapsedAnchorByHiddenId,
  };
}
