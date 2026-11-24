import {
  DEFAULT_DAG_NODE_HEIGHT,
  DEFAULT_DAG_NODE_WIDTH,
  type DagCanvasEdge,
  type DagCanvasNode,
} from './types.ts';

export const DAG_GAP_X = 120;
export const DAG_GAP_Y = 36;
export const DAG_ORIGIN_X = 60;
export const DAG_ORIGIN_Y = 60;

/**
 * 检测可见 DAG 节点之间是否存在包围盒重叠（或间距小于 minGap）。
 */
export function hasOverlappingDagNodes(
  nodes: DagCanvasNode[],
  minGap = 12,
): boolean {
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    const ax = a.position?.x ?? 0;
    const ay = a.position?.y ?? 0;
    const aw = a.width ?? DEFAULT_DAG_NODE_WIDTH;
    const ah = a.height ?? DEFAULT_DAG_NODE_HEIGHT;
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j];
      const bx = b.position?.x ?? 0;
      const by = b.position?.y ?? 0;
      const bw = b.width ?? DEFAULT_DAG_NODE_WIDTH;
      const bh = b.height ?? DEFAULT_DAG_NODE_HEIGHT;
      const overlapX = ax < bx + bw + minGap && ax + aw + minGap > bx;
      const overlapY = ay < by + bh + minGap && ay + ah + minGap > by;
      if (overlapX && overlapY) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 基于 Kahn 拓扑分层 + 下游重心排序的 DAG 自动布局算法。
 * 返回新节点数组，不原地修改原对象。
 */
export function autoLayoutDagNodes(
  nodes: DagCanvasNode[],
  edges: DagCanvasEdge[],
): DagCanvasNode[] {
  if (nodes.length === 0) return [];

  const nodeIndexMap = new Map<string, number>();
  const nodeMap = new Map<string, DagCanvasNode>();
  nodes.forEach((n, idx) => {
    nodeIndexMap.set(n.id, idx);
    nodeMap.set(n.id, n);
  });

  const validEdges = edges.filter(
    (e) =>
      nodeMap.has(e.sourceNodeId) &&
      nodeMap.has(e.targetNodeId) &&
      e.sourceNodeId !== e.targetNodeId,
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

  // 1. Kahn 拓扑分层（最长路径列号）
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

  // 2. 环路/孤立节点兜底
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      const hasOut = (outEdges.get(n.id)?.length ?? 0) > 0;
      const hasIn = (inEdges.get(n.id)?.length ?? 0) > 0;
      if (!hasIn && hasOut) {
        rankMap.set(n.id, 0);
      } else if (hasIn && !hasOut) {
        rankMap.set(n.id, maxRank + 1);
      } else {
        rankMap.set(n.id, Math.max(1, maxRank));
      }
    }
  }

  // 3. 按列分组
  const columns = new Map<number, DagCanvasNode[]>();
  for (const n of nodes) {
    const col = rankMap.get(n.id) ?? 0;
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col)!.push(n);
  }

  const sortedColKeys = Array.from(columns.keys()).sort((a, b) => a - b);

  // 4. 列内排序（首列保留原 y 序，下游列按父节点重心 y 排序）
  const positionedCenterY = new Map<string, number>();
  const colHeights = new Map<number, number>();
  const orderedColumns = new Map<number, DagCanvasNode[]>();

  for (const col of sortedColKeys) {
    const colNodes = [...(columns.get(col) ?? [])];
    if (col === 0) {
      colNodes.sort((a, b) => {
        const ay = a.position?.y ?? 0;
        const by = b.position?.y ?? 0;
        if (ay !== by) return ay - by;
        return (nodeIndexMap.get(a.id) ?? 0) - (nodeIndexMap.get(b.id) ?? 0);
      });
    } else {
      colNodes.sort((a, b) => {
        const getBarycenter = (nodeId: string): number | null => {
          const parents = (inEdges.get(nodeId) ?? []).filter((pid) =>
            positionedCenterY.has(pid),
          );
          if (parents.length === 0) return null;
          const sum = parents.reduce(
            (acc, pid) => acc + (positionedCenterY.get(pid) ?? 0),
            0,
          );
          return sum / parents.length;
        };
        const ba = getBarycenter(a.id);
        const bb = getBarycenter(b.id);
        if (ba !== null && bb !== null && ba !== bb) return ba - bb;
        const ay = a.position?.y ?? 0;
        const by = b.position?.y ?? 0;
        if (ay !== by) return ay - by;
        return (nodeIndexMap.get(a.id) ?? 0) - (nodeIndexMap.get(b.id) ?? 0);
      });
    }

    orderedColumns.set(col, colNodes);
    const totalHeight =
      colNodes.reduce((acc, n) => acc + (n.height ?? DEFAULT_DAG_NODE_HEIGHT), 0) +
      Math.max(0, colNodes.length - 1) * DAG_GAP_Y;
    colHeights.set(col, totalHeight);

    let cursorY = 0;
    for (const n of colNodes) {
      const h = n.height ?? DEFAULT_DAG_NODE_HEIGHT;
      positionedCenterY.set(n.id, cursorY + h / 2);
      cursorY += h + DAG_GAP_Y;
    }
  }

  let maxColHeight = 0;
  for (const h of colHeights.values()) {
    if (h > maxColHeight) maxColHeight = h;
  }

  // 5. 分配最终坐标
  // 首列（输入列）与主效果列顶端对齐（消除 1:1 输入连线的垂直倾角），下游复合层按父节点重心垂直对齐与平滑分布
  const nextCoords = new Map<string, { x: number; y: number }>();
  const positionedCenterYFinal = new Map<string, number>();

  sortedColKeys.forEach((col, colIdx) => {
    const colNodes = orderedColumns.get(col) ?? [];
    if (colNodes.length === 0) return;
    const x = DAG_ORIGIN_X + colIdx * (DEFAULT_DAG_NODE_WIDTH + DAG_GAP_X);
    const colHeight = colHeights.get(col) ?? 0;

    // 首列（输入列）或全高密集列直接自 DAG_ORIGIN_Y 顶端对齐，确保输入与首层效果节点严格水平等高无倾角
    const isTopAligned =
      col === 0
        ? colNodes.length > 1 || colHeight >= maxColHeight * 0.7
        : colHeight >= maxColHeight * 0.85;

    if (isTopAligned) {
      let y = DAG_ORIGIN_Y;
      for (const n of colNodes) {
        const h = n.height ?? DEFAULT_DAG_NODE_HEIGHT;
        nextCoords.set(n.id, { x, y });
        positionedCenterYFinal.set(n.id, y + h / 2);
        y += h + DAG_GAP_Y;
      }
    } else {
      // 下游层级：根据父节点重心进行平滑垂直定位，避免全列向中心过度挤压，消除陡峭折线
      const idealYs: number[] = [];
      for (let i = 0; i < colNodes.length; i += 1) {
        const n = colNodes[i];
        const h = n.height ?? DEFAULT_DAG_NODE_HEIGHT;
        const parents = (inEdges.get(n.id) ?? []).filter((pid) =>
          positionedCenterYFinal.has(pid),
        );
        if (parents.length > 0) {
          const avgParentCenterY =
            parents.reduce((sum, pid) => sum + positionedCenterYFinal.get(pid)!, 0) /
            parents.length;
          idealYs.push(Math.round(avgParentCenterY - h / 2));
        } else {
          idealYs.push(DAG_ORIGIN_Y + i * (h + DAG_GAP_Y));
        }
      }

      // 正向推进保证无重叠
      const finalYs: number[] = new Array(colNodes.length);
      let prevBottom = DAG_ORIGIN_Y;
      for (let i = 0; i < colNodes.length; i += 1) {
        const h = colNodes[i].height ?? DEFAULT_DAG_NODE_HEIGHT;
        const target = Math.max(idealYs[i], prevBottom);
        finalYs[i] = target;
        prevBottom = target + h + DAG_GAP_Y;
      }

      // 反向平移保护（若超出底部则向上平移，但不得低于 DAG_ORIGIN_Y）
      const maxBottom = DAG_ORIGIN_Y + maxColHeight;
      const lastH = colNodes[colNodes.length - 1].height ?? DEFAULT_DAG_NODE_HEIGHT;
      const overflow = finalYs[finalYs.length - 1] + lastH - maxBottom;
      if (overflow > 0) {
        let shift = overflow;
        shift = Math.min(shift, finalYs[0] - DAG_ORIGIN_Y);
        if (shift > 0) {
          for (let i = 0; i < finalYs.length; i += 1) {
            finalYs[i] -= shift;
          }
        }
      }

      for (let i = 0; i < colNodes.length; i += 1) {
        const n = colNodes[i];
        const h = n.height ?? DEFAULT_DAG_NODE_HEIGHT;
        const y = finalYs[i];
        nextCoords.set(n.id, { x, y });
        positionedCenterYFinal.set(n.id, y + h / 2);
      }
    }
  });

  return nodes.map((n) => {
    const coords = nextCoords.get(n.id);
    if (!coords) return n;
    return {
      ...n,
      position: {
        x: coords.x,
        y: coords.y,
      },
    };
  });
}

/**
 * 若存在重叠节点则自动重排，否则保留原有坐标。
 */
export function ensureNonOverlappingDagLayout(
  nodes: DagCanvasNode[],
  edges: DagCanvasEdge[],
): DagCanvasNode[] {
  if (hasOverlappingDagNodes(nodes)) {
    return autoLayoutDagNodes(nodes, edges);
  }
  return nodes;
}
