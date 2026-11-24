import type { CanvasEdge, CanvasNode } from './canvas-types.ts';

export const PIPELINE_NODE_WIDTH = 280;
export const PIPELINE_NODE_HEIGHT = 124;
export const PIPELINE_GAP_X = 110;
export const PIPELINE_GAP_Y = 32;
export const PIPELINE_ORIGIN_X = 60;
export const PIPELINE_ORIGIN_Y = 60;

/**
 * 检测画布中是否存在任意一对节点的包围盒发生重叠（或间距小于 minGap）。
 */
export function hasOverlappingNodes(nodes: CanvasNode[], minGap = 12): boolean {
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    const aw = a.width || PIPELINE_NODE_WIDTH;
    const ah = a.height || PIPELINE_NODE_HEIGHT;
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j];
      const bw = b.width || PIPELINE_NODE_WIDTH;
      const bh = b.height || PIPELINE_NODE_HEIGHT;
      const overlapX = a.x < b.x + bw + minGap && a.x + aw + minGap > b.x;
      const overlapY = a.y < b.y + bh + minGap && a.y + ah + minGap > b.y;
      if (overlapX && overlapY) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 基于拓扑分层与同层重心排序的算子流水线自动布局算法。
 * 返回全新节点数组，不修改原对象。
 */
export function autoLayoutPipelineNodes(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): CanvasNode[] {
  if (nodes.length === 0) return [];

  const nodeIndexMap = new Map<string, number>();
  const nodeMap = new Map<string, CanvasNode>();
  nodes.forEach((n, idx) => {
    nodeIndexMap.set(n.id, idx);
    nodeMap.set(n.id, n);
  });

  const validEdges = edges.filter(
    (e) => nodeMap.has(e.sourceNodeId) && nodeMap.has(e.targetNodeId) && e.sourceNodeId !== e.targetNodeId,
  );

  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();
  const inEdges = new Map<string, string[]>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    outEdges.set(n.id, []);
    inEdges.set(n.id, []);
  }

  for (const e of validEdges) {
    outEdges.get(e.sourceNodeId)!.push(e.targetNodeId);
    inEdges.get(e.targetNodeId)!.push(e.sourceNodeId);
    inDegree.set(e.targetNodeId, (inDegree.get(e.targetNodeId) ?? 0) + 1);
  }

  // 1. Kahn 拓扑排序 + 最长路径列号 (rank)
  const rankMap = new Map<string, number>();
  const queue: string[] = [];
  const visited = new Set<string>();

  for (const n of nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0) {
      rankMap.set(n.id, 0);
      queue.push(n.id);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const u = queue[head++];
    visited.add(u);
    const uRank = rankMap.get(u) ?? 0;
    for (const v of outEdges.get(u) ?? []) {
      const nextRank = uRank + 1;
      rankMap.set(v, Math.max(rankMap.get(v) ?? 0, nextRank));
      const deg = (inDegree.get(v) ?? 1) - 1;
      inDegree.set(v, deg);
      if (deg === 0) {
        queue.push(v);
      }
    }
  }

  let maxRank = 0;
  for (const r of rankMap.values()) {
    if (r > maxRank) maxRank = r;
  }

  // 2. 兜底处理环路或未访问节点
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      if (n.type === 'data_input') {
        rankMap.set(n.id, 0);
      } else if (n.type === 'result_output') {
        rankMap.set(n.id, maxRank + 1);
      } else {
        rankMap.set(n.id, Math.max(1, maxRank));
      }
    }
  }

  // 重新统计 maxRank，并确保多列场景下无出边的 result_output 位于最末列，无入边的 data_input 位于第 0 列
  maxRank = 0;
  for (const r of rankMap.values()) {
    if (r > maxRank) maxRank = r;
  }

  if (maxRank > 0) {
    for (const n of nodes) {
      const hasIn = (inEdges.get(n.id)?.length ?? 0) > 0;
      const hasOut = (outEdges.get(n.id)?.length ?? 0) > 0;
      if (n.type === 'data_input' && !hasIn) {
        rankMap.set(n.id, 0);
      } else if (n.type === 'result_output' && !hasOut) {
        rankMap.set(n.id, maxRank);
      }
    }
  }

  // 3. 按列分组
  const columns = new Map<number, CanvasNode[]>();
  for (const n of nodes) {
    const col = rankMap.get(n.id) ?? 0;
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col)!.push(n);
  }

  const sortedColKeys = Array.from(columns.keys()).sort((a, b) => a - b);

  // 4. 计算每列总高度，并记录重心坐标用于下游列排序
  const positionedY = new Map<string, number>();
  const colHeights = new Map<number, number>();
  const orderedColumns = new Map<number, CanvasNode[]>();

  for (const col of sortedColKeys) {
    const colNodes = [...(columns.get(col) ?? [])];
    if (col === 0) {
      colNodes.sort((a, b) => {
        if (a.y !== b.y) return a.y - b.y;
        return (nodeIndexMap.get(a.id) ?? 0) - (nodeIndexMap.get(b.id) ?? 0);
      });
    } else {
      colNodes.sort((a, b) => {
        const getBarycenter = (nodeId: string): number | null => {
          const parents = (inEdges.get(nodeId) ?? []).filter((pid) => positionedY.has(pid));
          if (parents.length === 0) return null;
          const sum = parents.reduce((acc, pid) => acc + (positionedY.get(pid) ?? 0), 0);
          return sum / parents.length;
        };
        const ba = getBarycenter(a.id);
        const bb = getBarycenter(b.id);
        if (ba !== null && bb !== null && ba !== bb) return ba - bb;
        if (a.y !== b.y) return a.y - b.y;
        return (nodeIndexMap.get(a.id) ?? 0) - (nodeIndexMap.get(b.id) ?? 0);
      });
    }

    orderedColumns.set(col, colNodes);
    const totalHeight =
      colNodes.reduce((acc, n) => acc + (n.height || PIPELINE_NODE_HEIGHT), 0) +
      Math.max(0, colNodes.length - 1) * PIPELINE_GAP_Y;
    colHeights.set(col, totalHeight);

    // 临时记录相对 Y，供后续列计算重心
    let cursorY = 0;
    for (const n of colNodes) {
      const h = n.height || PIPELINE_NODE_HEIGHT;
      positionedY.set(n.id, cursorY + h / 2);
      cursorY += h + PIPELINE_GAP_Y;
    }
  }

  let maxColHeight = 0;
  for (const h of colHeights.values()) {
    if (h > maxColHeight) maxColHeight = h;
  }

  // 5. 分配最终坐标（整列垂直居中对齐）
  const nextCoords = new Map<string, { x: number; y: number }>();
  sortedColKeys.forEach((col, colIdx) => {
    const colNodes = orderedColumns.get(col) ?? [];
    const colHeight = colHeights.get(col) ?? 0;
    const x = PIPELINE_ORIGIN_X + colIdx * (PIPELINE_NODE_WIDTH + PIPELINE_GAP_X);
    let y = PIPELINE_ORIGIN_Y + Math.round((maxColHeight - colHeight) / 2);
    for (const n of colNodes) {
      const h = n.height || PIPELINE_NODE_HEIGHT;
      nextCoords.set(n.id, { x, y });
      y += h + PIPELINE_GAP_Y;
    }
  });

  return nodes.map((n) => {
    const coords = nextCoords.get(n.id);
    if (!coords) return n;
    return {
      ...n,
      x: coords.x,
      y: coords.y,
    };
  });
}

/**
 * 若画布存在重叠节点则自动执行重排，否则保留原有坐标。
 */
export function ensureNonOverlappingLayout(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): CanvasNode[] {
  if (hasOverlappingNodes(nodes)) {
    return autoLayoutPipelineNodes(nodes, edges);
  }
  return nodes;
}
