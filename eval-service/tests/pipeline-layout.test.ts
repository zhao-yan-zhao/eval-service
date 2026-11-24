import test from 'node:test';
import assert from 'node:assert/strict';
import type { CanvasEdge, CanvasNode } from '../src/ui/components/pipeline-canvas/canvas-types.ts';
import {
  PIPELINE_GAP_Y,
  PIPELINE_NODE_HEIGHT,
  autoLayoutPipelineNodes,
  ensureNonOverlappingLayout,
  hasOverlappingNodes,
} from '../src/ui/components/pipeline-canvas/pipeline-layout.ts';

function makeNode(
  id: string,
  type: CanvasNode['type'],
  x: number,
  y: number,
): CanvasNode {
  return {
    id,
    type,
    title: id,
    x,
    y,
    config: {},
    runtime: { status: 'idle' },
  };
}

test('pipeline-layout: detects overlapping 5-to-1-to-1 graph and auto-layouts without overlaps', () => {
  const nodes: CanvasNode[] = [
    makeNode('in_1', 'data_input', 60, 60),
    makeNode('in_2', 'data_input', 60, 140),
    makeNode('in_3', 'data_input', 60, 220),
    makeNode('in_4', 'data_input', 60, 300),
    makeNode('in_5', 'data_input', 60, 380),
    makeNode('py_1', 'python_script', 420, 220),
    makeNode('out_1', 'result_output', 780, 220),
  ];
  const edges: CanvasEdge[] = [
    { id: 'e1', sourceNodeId: 'in_1', targetNodeId: 'py_1' },
    { id: 'e2', sourceNodeId: 'in_2', targetNodeId: 'py_1' },
    { id: 'e3', sourceNodeId: 'in_3', targetNodeId: 'py_1' },
    { id: 'e4', sourceNodeId: 'in_4', targetNodeId: 'py_1' },
    { id: 'e5', sourceNodeId: 'in_5', targetNodeId: 'py_1' },
    { id: 'e6', sourceNodeId: 'py_1', targetNodeId: 'out_1' },
  ];

  assert.equal(hasOverlappingNodes(nodes), true);

  const layouted = autoLayoutPipelineNodes(nodes, edges);
  assert.equal(hasOverlappingNodes(layouted), false);

  const col0 = layouted.slice(0, 5);
  const pyNode = layouted[5];
  const outNode = layouted[6];

  const minStepY = PIPELINE_NODE_HEIGHT + PIPELINE_GAP_Y;
  for (let i = 1; i < col0.length; i += 1) {
    assert.equal(col0[i].x, col0[0].x);
    assert.ok(
      col0[i].y - col0[i - 1].y >= minStepY,
      `Expected vertical spacing >= ${minStepY}, got ${col0[i].y - col0[i - 1].y}`,
    );
  }

  assert.ok(pyNode.x > col0[0].x);
  assert.ok(outNode.x > pyNode.x);

  const expectedCenterY = col0[2].y;
  assert.equal(pyNode.y, expectedCenterY);
  assert.equal(outNode.y, expectedCenterY);
});

test('pipeline-layout: ensureNonOverlappingLayout preserves custom non-overlapping coordinates', () => {
  const nodes: CanvasNode[] = [
    makeNode('in_1', 'data_input', 100, 100),
    makeNode('calc_1', 'inline_calc', 500, 150),
    makeNode('out_1', 'result_output', 900, 200),
  ];
  const edges: CanvasEdge[] = [
    { id: 'e1', sourceNodeId: 'in_1', targetNodeId: 'calc_1' },
    { id: 'e2', sourceNodeId: 'calc_1', targetNodeId: 'out_1' },
  ];

  assert.equal(hasOverlappingNodes(nodes), false);
  const result = ensureNonOverlappingLayout(nodes, edges);
  assert.equal(result, nodes);
});

test('pipeline-layout: handles cyclic and disconnected edges safely without overlaps', () => {
  const nodes: CanvasNode[] = [
    makeNode('a', 'data_input', 60, 60),
    makeNode('b', 'inline_calc', 60, 60),
    makeNode('c', 'group_agg', 60, 60),
    makeNode('d', 'result_output', 60, 60),
  ];
  const edges: CanvasEdge[] = [
    { id: 'e1', sourceNodeId: 'b', targetNodeId: 'c' },
    { id: 'e2', sourceNodeId: 'c', targetNodeId: 'b' },
    { id: 'e3', sourceNodeId: 'missing_src', targetNodeId: 'd' },
  ];

  assert.equal(hasOverlappingNodes(nodes), true);
  const layouted = autoLayoutPipelineNodes(nodes, edges);
  assert.equal(layouted.length, 4);
  assert.equal(hasOverlappingNodes(layouted), false);
});
