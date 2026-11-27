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

test('dag-layout: sys_v4_metrics_guide_full aligns 1:1 input proxy edges horizontally without vertical skew', async () => {
  const { defaultSystemDagStore } = await import('../src/systems/system-dag-store.ts');
  const sys = defaultSystemDagStore.get('sys_v4_metrics_guide_full');
  assert.ok(sys);

  const canvasNodes: DagCanvasNode[] = sys.nodes.map((n) => ({
    id: n.id,
    kind: n.kind as DagCanvasNode['kind'],
    label: n.label,
    position: n.position,
    width: 260,
    height: 100,
    status: 'idle',
  }));

  const canvasEdges: DagCanvasEdge[] = sys.edges.map((e) => ({
    id: e.id,
    sourceNodeId: e.sourceNodeId,
    targetNodeId: e.targetNodeId,
    weight: e.weight,
  }));

  const layouted = autoLayoutDagNodes(canvasNodes, canvasEdges);
  assert.equal(hasOverlappingDagNodes(layouted), false);

  const nodeMap = new Map(layouted.map((n) => [n.id, n]));

  // 1:1 绑定的输入代理节点与对应效果节点在垂直 Y 轴上严格水平对齐（diffY === 0）
  const expectedParallelPairs = [
    ['px_strike', 'ef_strike'],
    ['px_patrol', 'ef_patrol'],
    ['px_support', 'ef_support'],
    ['px_detection', 'ef_detection'],
    ['px_killchain', 'ef_killchain'],
    ['px_weapon', 'ef_weapon'],
    ['px_cost_exchange', 'ef_cost_exchange'],
    ['px_cost_survival', 'ef_cost_survival'],
    ['px_cost_attrition', 'gt_attrition_hard'],
    ['px_recon', 'ef_recon'],
    ['px_c2', 'ef_c2'],
    ['px_ew', 'ef_ew'],
    ['px_ad', 'ef_ad'],
  ];

  for (const [srcId, tgtId] of expectedParallelPairs) {
    const srcNode = nodeMap.get(srcId);
    const tgtNode = nodeMap.get(tgtId);
    assert.ok(srcNode, `Missing ${srcId}`);
    assert.ok(tgtNode, `Missing ${tgtId}`);
    assert.equal(
      srcNode.position.y,
      tgtNode.position.y,
      `Expected ${srcId} (y=${srcNode.position.y}) and ${tgtId} (y=${tgtNode.position.y}) to be horizontally aligned`,
    );
  }
});
