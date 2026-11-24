# 二库与三库 DAG 画布自动布局与卡片精简交接指南

> **目标读者**：下一个执行会话的 AI 编程助手  
> **施工目录**：仅限 `eval-service/` 目录内（严禁修改 `CMO-netcore-src/`、`LabConsole/`、`demo-ui/`）

---

## 一、 背景与目标

一库（算子库）使用的 `eval-service/src/ui/components/pipeline-canvas/` 已完成**拓扑自动布局、载入防重叠、工具栏「自动布局」按钮、卡片标题防截断与冗余清理**（可参考同仓已完成代码：`pipeline-canvas/pipeline-layout.ts`、`PipelineCanvasStudio.tsx`、`CanvasNodeCard.tsx`）。

**二库（指标库 `MetricDagStudioPanel.tsx`）** 和 **三库（评估体系 `SystemDagStudioPanel.tsx`）** 共用同一套画布组件库：
- `eval-service/src/ui/components/dag-canvas/`

因此，只需要改造 `dag-canvas/` 这一套公共组件，即可**一次性让二库和三库画布同时具备**：
1. 载入时自动检测重叠并按拓扑层级展开（保留用户无重叠的手工布局）；
2. 工具栏一键「自动布局」重排并居中全貌；
3. 节点卡片删除按钮悬浮显示，释放标题横向空间。

---

## 二、 严禁踩坑红线（执行前必读）

1. **坐标字段路径不同（最容易写错）**：
   - `DagCanvasNode`（继承自 `DagNodeBase`）的坐标字段是 **`node.position.x` 与 `node.position.y`**。
   - **绝对不是**一库 `CanvasNode` 里的 `node.x` / `node.y`！更新坐标时必须写成 `{ ...n, position: { x: coords.x, y: coords.y } }`。
2. **严禁修改节点默认尺寸**：
   - `dag-canvas/types.ts` 已定义 `DEFAULT_DAG_NODE_WIDTH = 280`、`DEFAULT_DAG_NODE_HEIGHT = 148`。
   - `DagEdgeLayer.tsx` 依赖这两个常量计算连线左右端口中心点，**切勿修改卡片外框宽高**。
3. **防止自动布局触发无限渲染循环**：
   - `DagCanvasBoard` 内的防重叠 `useEffect` 必须用 `useRef<Set<string>>` 记录已经检查/修复过的 `visibleNodeSignature`（如按节点 ID 排序拼接），且仅在 `!readOnly && !draggingNodeId` 时触发；用户手工拖拽后若无重叠，绝不覆盖用户坐标。
4. **测试与构建必须全绿**：
   - 严禁修改既有测试断言去硬凑通过。

---

## 三、 分步施工清单

### Step 1：新建 `eval-service/src/ui/components/dag-canvas/dag-layout.ts` 并在 `index.ts` 导出

直接创建 `eval-service/src/ui/components/dag-canvas/dag-layout.ts`，完整代码如下：

```ts
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

  // 5. 分配最终坐标（整列垂直居中）
  const nextCoords = new Map<string, { x: number; y: number }>();
  sortedColKeys.forEach((col, colIdx) => {
    const colNodes = orderedColumns.get(col) ?? [];
    const colHeight = colHeights.get(col) ?? 0;
    const x = DAG_ORIGIN_X + colIdx * (DEFAULT_DAG_NODE_WIDTH + DAG_GAP_X);
    let y = DAG_ORIGIN_Y + Math.round((maxColHeight - colHeight) / 2);
    for (const n of colNodes) {
      const h = n.height ?? DEFAULT_DAG_NODE_HEIGHT;
      nextCoords.set(n.id, { x, y });
      y += h + DAG_GAP_Y;
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
```

然后在 `eval-service/src/ui/components/dag-canvas/index.ts` 末尾追加导出：

```ts
export {
  autoLayoutDagNodes,
  ensureNonOverlappingDagLayout,
  hasOverlappingDagNodes,
} from './dag-layout.ts';
```

---

### Step 2：改造 `eval-service/src/ui/components/dag-canvas/DagCanvasBoard.tsx`

1. **导入依赖**：
   - 从 `lucide-react` 增加导入 `LayoutGrid`。
   - 从 `./dag-layout.ts` 导入 `{ autoLayoutDagNodes, hasOverlappingDagNodes }`。

2. **新增载入防重叠自动修正（需先阅读 `DagCanvasBoard.tsx` 第 200~370 行确认 `visibleNodes`、`draggingNodeId`、`handleFitView` 变量名）**：
   - 用 `const autoLayoutCheckedSignaturesRef = useRef<Set<string>>(new Set());` 记录已检查过的视图签名。
   - 计算当前可见节点签名：
     ```ts
     const visibleNodeSignature = useMemo(
       () => `${graphKind}::${visibleNodes.map((n) => n.id).sort().join('|')}`,
       [graphKind, visibleNodes],
     );
     ```
   - 新增 `useEffect`：当 `!readOnly && !draggingNodeId && visibleNodes.length > 1` 且 `!autoLayoutCheckedSignaturesRef.current.has(visibleNodeSignature)` 时：
     - 标记 `autoLayoutCheckedSignaturesRef.current.add(visibleNodeSignature)`；
     - 若 `hasOverlappingDagNodes(visibleNodes)` 为 `true`，调用：
       ```ts
       const nextNodes = autoLayoutDagNodes(nodes, edges);
       commitNodes(nextNodes);
       window.requestAnimationFrame(() => handleFitView());
       ```

3. **新增工具栏「自动布局」按钮**：
   - 新增回调：
     ```ts
     const handleAutoLayout = useCallback(() => {
       if (readOnly || nodes.length === 0) return;
       const nextNodes = autoLayoutDagNodes(nodes, edges);
       commitNodes(nextNodes);
       window.requestAnimationFrame(() => handleFitView());
     }, [commitNodes, edges, handleFitView, nodes, readOnly]);
     ```
   - 在工具栏「全貌」按钮（约第 836~844 行）右侧紧邻位置新增按钮（仅在 `!readOnly && nodes.length > 0` 时渲染）：
     ```tsx
     {!readOnly && nodes.length > 0 && (
       <button
         type="button"
         onClick={handleAutoLayout}
         title="按拓扑层级自动重排节点并消除重叠"
         className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1 text-[11px] text-cyan-200 transition hover:border-cyan-500/60 hover:bg-cyan-500/10 cursor-pointer"
       >
         <LayoutGrid className="h-3 w-3" />
         <span>自动布局</span>
       </button>
     )}
     ```

---

### Step 3：精简 `eval-service/src/ui/components/dag-canvas/DagNodeItem.tsx`

阅读 `DagNodeItem.tsx` 第 434~480 行：
1. 标题容器 `<div className="flex min-w-0 items-center gap-1.5">` 改为 `flex min-w-0 flex-1 items-center gap-1.5`，标题 `<span>` 确保有 `flex-1 truncate` 与 `title={node.label}`。
2. 第 465~478 行的删除按钮 `<button ...>` 原来常驻占宽，将其 `className` 改为悬浮/聚焦才显示：
   ```tsx
   className="hidden group-hover:inline-flex group-focus-within:inline-flex rounded p-1 text-slate-500 transition hover:bg-rose-500/20 hover:text-rose-400 cursor-pointer"
   ```
   （注意：`DagNodeItem` 外层卡片容器必须保留 `group` 类名，先确认第 360~415 行外层容器是否有 `group`，没有则补上 `group`）。
3. **不要修改**外层容器的 `width` / `height` 尺寸。

---

### Step 4：新建单元测试 `eval-service/tests/dag-layout.test.ts`

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DagCanvasEdge, DagCanvasNode } from '../src/ui/components/dag-canvas/types.ts';
import {
  DEFAULT_DAG_NODE_HEIGHT,
} from '../src/ui/components/dag-canvas/types.ts';
import {
  DAG_GAP_Y,
  autoLayoutDagNodes,
  ensureNonOverlappingDagLayout,
  hasOverlappingDagNodes,
} from '../src/ui/components/dag-canvas/dag-layout.ts';

function makeDagNode(id: string, x: number, y: number): DagCanvasNode {
  return {
    id,
    kind: 'metric',
    label: id,
    position: { x, y },
    status: 'idle',
  };
}

test('dag-layout: detects overlapping nodes and auto-layouts without overlaps', () => {
  const nodes: DagCanvasNode[] = [
    makeDagNode('m1', 60, 60),
    makeDagNode('m2', 60, 120),
    makeDagNode('m3', 60, 180),
    makeDagNode('agg1', 420, 120),
  ];
  const edges: DagCanvasEdge[] = [
    { id: 'e1', sourceNodeId: 'm1', targetNodeId: 'agg1' },
    { id: 'e2', sourceNodeId: 'm2', targetNodeId: 'agg1' },
    { id: 'e3', sourceNodeId: 'm3', targetNodeId: 'agg1' },
  ];

  assert.equal(hasOverlappingDagNodes(nodes), true);
  const layouted = autoLayoutDagNodes(nodes, edges);
  assert.equal(hasOverlappingDagNodes(layouted), false);

  const minStepY = DEFAULT_DAG_NODE_HEIGHT + DAG_GAP_Y;
  assert.ok(layouted[1].position.y - layouted[0].position.y >= minStepY);
  assert.ok(layouted[2].position.y - layouted[1].position.y >= minStepY);
  assert.ok(layouted[3].position.x > layouted[0].position.x);
  assert.equal(layouted[3].position.y, layouted[1].position.y);
});

test('dag-layout: ensureNonOverlappingDagLayout preserves non-overlapping custom positions', () => {
  const nodes: DagCanvasNode[] = [
    makeDagNode('a', 100, 100),
    makeDagNode('b', 500, 160),
  ];
  const edges: DagCanvasEdge[] = [
    { id: 'e1', sourceNodeId: 'a', targetNodeId: 'b' },
  ];

  assert.equal(hasOverlappingDagNodes(nodes), false);
  assert.equal(ensureNonOverlappingDagLayout(nodes, edges), nodes);
});

test('dag-layout: handles cycles and dangling edges safely without overlaps', () => {
  const nodes: DagCanvasNode[] = [
    makeDagNode('a', 60, 60),
    makeDagNode('b', 60, 60),
    makeDagNode('c', 60, 60),
  ];
  const edges: DagCanvasEdge[] = [
    { id: 'e1', sourceNodeId: 'a', targetNodeId: 'b' },
    { id: 'e2', sourceNodeId: 'b', targetNodeId: 'a' },
    { id: 'e3', sourceNodeId: 'missing', targetNodeId: 'c' },
  ];

  const layouted = autoLayoutDagNodes(nodes, edges);
  assert.equal(layouted.length, 3);
  assert.equal(hasOverlappingDagNodes(layouted), false);
});
```

---

## 四、 验收命令清单（必须全部通过）

按顺序执行以下命令，全部 0 失败后即可交付：

```powershell
# 1. 运行新增的 dag-layout 单元测试
npx --prefix eval-service tsx --test eval-service/tests/dag-layout.test.ts

# 2. 执行前端生产构建（验证 TypeScript 与 Vite 打包无报错）
npm --prefix eval-service run build:ui

# 3. 运行二库/三库 V4 集成测试
npx --prefix eval-service tsx --test eval-service/tests/v4-metric-and-routes.test.ts eval-service/tests/v4-wave3-integration.test.ts

# 4. 运行端到端浏览器验证
npx --prefix eval-service tsx --test eval-service/tests/stage5-ui-e2e.test.ts
```
