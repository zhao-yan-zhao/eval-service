import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  DagEdge,
  DagGraphDefinition,
  TableDataset,
} from '../src/core/types.ts';
import {
  DagNodeCache,
  canonicalJsonStringify,
  computeNodeCacheKey,
  detectCycles,
  executeDagGraph,
  resolveNodeRuntimeParams,
  topologicalSort,
  type DagExecutionNode,
} from '../src/engine/dag-executor.ts';

function makeNode(
  id: string,
  overrides: Partial<DagExecutionNode> = {},
): DagExecutionNode {
  return {
    id,
    kind: 'operator_step',
    label: `Node ${id}`,
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

function makeEdge(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  overrides: Partial<DagEdge> = {},
): DagEdge {
  return {
    id,
    sourceNodeId,
    targetNodeId,
    ...overrides,
  };
}

test('1.1 - 线性与多层菱形 DAG 拓扑排序确定性', () => {
  // 空图
  assert.deepEqual(topologicalSort([], []), []);
  assert.deepEqual(detectCycles([], []), {
    hasCycle: false,
    cycleNodeIds: [],
    missingEdgeRefs: [],
  });

  // 线性链：n1 -> n2 -> n3（即便节点输入乱序）
  const linearNodes = [makeNode('n3'), makeNode('n1'), makeNode('n2')];
  const linearEdges = [
    makeEdge('e2', 'n2', 'n3'),
    makeEdge('e1', 'n1', 'n2'),
  ];
  assert.deepEqual(topologicalSort(linearNodes, linearEdges), ['n1', 'n2', 'n3']);

  // 多层菱形 DAG：
  //       root
  //      /    \
  //   left    right
  //    |  \  /  |
  //   m1   mid   m2
  //     \   |   /
  //       sink
  const diamondNodes = [
    makeNode('sink'),
    makeNode('right'),
    makeNode('mid'),
    makeNode('m2'),
    makeNode('left'),
    makeNode('m1'),
    makeNode('root'),
  ];
  const diamondEdges = [
    makeEdge('e1', 'root', 'left'),
    makeEdge('e2', 'root', 'right'),
    makeEdge('e3', 'left', 'm1'),
    makeEdge('e4', 'left', 'mid'),
    makeEdge('e5', 'right', 'mid'),
    makeEdge('e6', 'right', 'm2'),
    makeEdge('e7', 'm1', 'sink'),
    makeEdge('e8', 'mid', 'sink'),
    makeEdge('e9', 'm2', 'sink'),
  ];

  const order = topologicalSort(diamondNodes, diamondEdges);
  assert.equal(order.length, diamondNodes.length);
  assert.equal(order[0], 'root');
  assert.equal(order[order.length - 1], 'sink');

  // 验证每条边均满足 source 在 target 之前
  const pos = new Map(order.map((id, idx) => [id, idx]));
  for (const edge of diamondEdges) {
    assert.ok(
      pos.get(edge.sourceNodeId)! < pos.get(edge.targetNodeId)!,
      `Expected ${edge.sourceNodeId} before ${edge.targetNodeId}`,
    );
  }

  // 与输入数组顺序无关的确定性
  const reversedOrder = topologicalSort([...diamondNodes].reverse(), [...diamondEdges].reverse());
  assert.deepEqual(order, reversedOrder);
});

test('2.1 - 环路检测（自环、双节点环、三节点环）与悬空边检测', () => {
  // 自环
  const selfLoopNodes = [makeNode('a'), makeNode('b')];
  const selfLoopEdges = [makeEdge('e1', 'a', 'a'), makeEdge('e2', 'a', 'b')];
  const selfRes = detectCycles(selfLoopNodes, selfLoopEdges);
  assert.equal(selfRes.hasCycle, true);
  assert.deepEqual(selfRes.cycleNodeIds, ['a']);
  assert.deepEqual(selfRes.missingEdgeRefs, []);
  assert.throws(() => topologicalSort(selfLoopNodes, selfLoopEdges), /directed cycle.*a/);

  // 双节点环 + 非环上游/下游节点（验证仅准确识别真正参与环的节点）
  const twoCycleNodes = [makeNode('start'), makeNode('x'), makeNode('y'), makeNode('tail')];
  const twoCycleEdges = [
    makeEdge('e1', 'start', 'x'),
    makeEdge('e2', 'x', 'y'),
    makeEdge('e3', 'y', 'x'),
    makeEdge('e4', 'y', 'tail'),
  ];
  const twoRes = detectCycles(twoCycleNodes, twoCycleEdges);
  assert.equal(twoRes.hasCycle, true);
  assert.deepEqual(twoRes.cycleNodeIds, ['x', 'y']);
  assert.throws(() => topologicalSort(twoCycleNodes, twoCycleEdges), /x, y/);

  // 三节点环
  const threeCycleNodes = [makeNode('c1'), makeNode('c2'), makeNode('c3')];
  const threeCycleEdges = [
    makeEdge('e1', 'c1', 'c2'),
    makeEdge('e2', 'c2', 'c3'),
    makeEdge('e3', 'c3', 'c1'),
  ];
  const threeRes = detectCycles(threeCycleNodes, threeCycleEdges);
  assert.equal(threeRes.hasCycle, true);
  assert.deepEqual(threeRes.cycleNodeIds, ['c1', 'c2', 'c3']);
  assert.throws(() => topologicalSort(threeCycleNodes, threeCycleEdges), /c1, c2, c3/);

  // 悬空边检测（不应误判为环，且 topologicalSort 必须报错）
  const danglingNodes = [makeNode('n1'), makeNode('n2')];
  const danglingEdges = [
    makeEdge('e_ok', 'n1', 'n2'),
    makeEdge('e_bad_src', 'ghost_src', 'n1'),
    makeEdge('e_bad_tgt', 'n2', 'ghost_tgt'),
  ];
  const danglingRes = detectCycles(danglingNodes, danglingEdges);
  assert.equal(danglingRes.hasCycle, false);
  assert.deepEqual(danglingRes.cycleNodeIds, []);
  assert.equal(danglingRes.missingEdgeRefs.length, 2);
  assert.ok(danglingRes.missingEdgeRefs.some((r) => r.includes('ghost_src')));
  assert.ok(danglingRes.missingEdgeRefs.some((r) => r.includes('ghost_tgt')));
  assert.throws(() => topologicalSort(danglingNodes, danglingEdges), /dangling edge/);

  // 重复节点 ID 报错
  assert.throws(
    () => topologicalSort([makeNode('dup'), makeNode('dup')], []),
    /duplicate node ID.*dup/,
  );

  // 非连通分量中一个存在环、另一个无环
  const mixedNodes = [makeNode('iso1'), makeNode('iso2'), makeNode('cycA'), makeNode('cycB')];
  const mixedEdges = [
    makeEdge('e_ok', 'iso1', 'iso2'),
    makeEdge('e_ab', 'cycA', 'cycB'),
    makeEdge('e_ba', 'cycB', 'cycA'),
  ];
  const mixedRes = detectCycles(mixedNodes, mixedEdges);
  assert.equal(mixedRes.hasCycle, true);
  assert.deepEqual(mixedRes.cycleNodeIds, ['cycA', 'cycB']);
});

test('3.1 - SHA-256 规范序列化与节点内容寻址缓存键确定性', () => {
  assert.equal(
    canonicalJsonStringify({ b: 2, a: { z: true, m: [3, 1, undefined] }, skip: undefined }),
    canonicalJsonStringify({ a: { m: [3, 1, null], z: true }, b: 2 }),
  );

  const keyA = computeNodeCacheKey({
    runId: 'run-001',
    graphKind: 'metric',
    nodeId: 'm_hit_rate',
    nodeKind: 'from_operator',
    nodeDefPayload: { formula: 'hits / shots', unit: '%' },
    resolvedParams: { bdaThreshold: 0.5, targetSide: 'Blue' },
    upstreamCacheKeys: { op_b: 'hash_b', op_a: 'hash_a' },
  });

  const keyB = computeNodeCacheKey({
    runId: 'run-001',
    graphKind: 'metric',
    nodeId: 'm_hit_rate',
    nodeKind: 'from_operator',
    nodeDefPayload: { unit: '%', formula: 'hits / shots' },
    resolvedParams: { targetSide: 'Blue', bdaThreshold: 0.5 },
    upstreamCacheKeys: { op_a: 'hash_a', op_b: 'hash_b' },
  });

  assert.equal(keyA.length, 64);
  assert.equal(keyA, keyB);

  const keyDiffRun = computeNodeCacheKey({
    runId: 'run-002',
    graphKind: 'metric',
    nodeId: 'm_hit_rate',
    nodeKind: 'from_operator',
    nodeDefPayload: { unit: '%', formula: 'hits / shots' },
    resolvedParams: { targetSide: 'Blue', bdaThreshold: 0.5 },
    upstreamCacheKeys: { op_a: 'hash_a', op_b: 'hash_b' },
  });
  assert.notEqual(keyA, keyDiffRun);
});

test('3.2 - DagNodeCache 增量命中与上下游精确失效传播', async () => {
  const cache = new DagNodeCache();
  const executionCounts = new Map<string, number>();

  const buildGraph = (opts?: {
    n1Threshold?: number;
    n3Threshold?: number;
    edge23Weight?: number;
    n1PositionX?: number;
  }): DagGraphDefinition => ({
    graphId: 'g-cache-test',
    name: '三级内容寻址缓存验证图',
    graphKind: 'system',
    nodes: [
      makeNode('n1', {
        kind: 'operator_table',
        position: { x: opts?.n1PositionX ?? 10, y: 20 },
        params: { threshold: opts?.n1Threshold ?? 0.5 },
      }),
      makeNode('n2', {
        kind: 'metric_agg',
        position: { x: 200, y: 20 },
        params: { reduce: 'mean' },
      }),
      makeNode('n3', {
        kind: 'effect_score',
        position: { x: 400, y: 20 },
        params: { targetScore: opts?.n3Threshold ?? 80 },
      }),
    ],
    edges: [
      makeEdge('e12', 'n1', 'n2'),
      makeEdge('e23', 'n2', 'n3', { weight: opts?.edge23Weight ?? 0.6 }),
    ],
  });

  const sampleDataset: TableDataset = {
    columns: [{ name: 'unitId', type: 'string' }, { name: 'dmg', type: 'number' }],
    rows: [{ unitId: 'u1', dmg: 0.75 }],
    totalRows: 1,
  };

  const executor = async (ctx: Parameters<Parameters<typeof executeDagGraph>[1]['executor']>[0]) => {
    executionCounts.set(ctx.node.id, (executionCounts.get(ctx.node.id) ?? 0) + 1);
    if (ctx.node.id === 'n1') {
      return {
        status: 'valid' as const,
        dataset: sampleDataset,
        evidenceRefs: [
          {
            source: 'csv' as const,
            ref: 'UnitDamaged.csv:12',
            scenarioClock: '00:05:00',
            description: '实证毁伤记录',
          },
        ],
      };
    }
    if (ctx.node.id === 'n2') {
      const rows = ctx.upstreamResults['n1']?.dataset?.rows ?? [];
      return {
        status: 'valid' as const,
        value: rows.length,
        evidenceRefs: [],
      };
    }
    const baseVal = Number(ctx.upstreamResults['n2']?.value ?? 0);
    const weight = ctx.upstreamEdges[0]?.weight ?? 1;
    const targetScore = Number(ctx.resolvedParams.targetScore ?? 80);
    return {
      status: 'valid' as const,
      value: baseVal * weight * targetScore,
      evidenceRefs: [],
    };
  };

  // Run 1: 冷缓存，3 个节点全未命中
  const res1 = await executeDagGraph(buildGraph(), {
    runId: 'run-alpha',
    cache,
    executor,
  });
  assert.equal(res1.cacheHits, 0);
  assert.equal(res1.cacheMisses, 3);
  assert.equal(cache.size(), 3);
  assert.deepEqual(cache.stats(), { hits: 0, misses: 3 });
  assert.equal(executionCounts.get('n1'), 1);
  assert.equal(executionCounts.get('n2'), 1);
  assert.equal(executionCounts.get('n3'), 1);
  assert.equal(res1.nodeResults['n3']?.value, 48);

  // Run 2: 仅拖动 n1 的 UI 坐标（非计算字段），应 100% 命中缓存且完整恢复 dataset 与 evidenceRefs
  const res2 = await executeDagGraph(buildGraph({ n1PositionX: 999 }), {
    runId: 'run-alpha',
    cache,
    executor,
  });
  assert.equal(res2.cacheHits, 3);
  assert.equal(res2.cacheMisses, 0);
  assert.equal(res2.nodeResults['n1']?.cacheHit, true);
  assert.deepEqual(res2.nodeResults['n1']?.dataset, sampleDataset);
  assert.equal(res2.nodeResults['n1']?.evidenceRefs.length, 1);
  assert.equal(res2.nodeResults['n3']?.value, 48);
  assert.equal(executionCounts.get('n1'), 1);

  // Run 3: 仅修改下游边 e23 的权重与 n3 参数 -> n1, n2 命中缓存，仅 n3 重算
  const res3 = await executeDagGraph(buildGraph({ edge23Weight: 1.0, n3Threshold: 90 }), {
    runId: 'run-alpha',
    cache,
    executor,
  });
  assert.equal(res3.cacheHits, 2);
  assert.equal(res3.cacheMisses, 1);
  assert.equal(res3.nodeResults['n1']?.cacheHit, true);
  assert.equal(res3.nodeResults['n2']?.cacheHit, true);
  assert.equal(res3.nodeResults['n3']?.cacheHit, false);
  assert.equal(res3.nodeResults['n3']?.value, 90);
  assert.equal(executionCounts.get('n1'), 1);
  assert.equal(executionCounts.get('n2'), 1);
  assert.equal(executionCounts.get('n3'), 2);

  // Run 4: 修改上游 n1 参数 -> n1 失效连带使下游 n2 与 n3 全部失效重算
  const res4 = await executeDagGraph(buildGraph({ n1Threshold: 0.75, edge23Weight: 1.0, n3Threshold: 90 }), {
    runId: 'run-alpha',
    cache,
    executor,
  });
  assert.equal(res4.cacheHits, 0);
  assert.equal(res4.cacheMisses, 3);
  assert.equal(executionCounts.get('n1'), 2);
  assert.equal(executionCounts.get('n2'), 2);
  assert.equal(executionCounts.get('n3'), 3);

  // clear() 清空缓存并重置统计
  assert.equal(cache.has(res4.nodeResults['n1']!.cacheKey), true);
  cache.clear();
  assert.equal(cache.size(), 0);
  assert.deepEqual(cache.stats(), { hits: 0, misses: 0 });
});

test('4.1 - 参数端口优先级解析（port default < global < node < external override）及沿边透传', async () => {
  const portNode = makeNode('n1', {
    parameterPorts: [
      { key: 'pDefaultOnly', label: '仅端口默认', dataType: 'number', defaultValue: 10 },
      { key: 'pGlobalWins', label: '全局覆盖', dataType: 'number', defaultValue: 10 },
      { key: 'pNodeWins', label: '节点覆盖', dataType: 'number', defaultValue: 10 },
      { key: 'pExtWins', label: '外部覆盖', dataType: 'number', defaultValue: 10 },
    ],
    params: {
      pNodeWins: 30,
      pExtWins: 30,
      ignoredUndefined: undefined,
    },
  });

  const resolvedDirect = resolveNodeRuntimeParams(portNode, {
    globalParams: {
      pGlobalWins: 20,
      pNodeWins: 20,
      pExtWins: 20,
    },
    paramOverridesByNodeId: {
      n1: { pExtWins: 40 },
    },
  });

  assert.deepEqual(resolvedDirect, {
    pDefaultOnly: 10,
    pGlobalWins: 20,
    pNodeWins: 30,
    pExtWins: 40,
  });

  // 沿边透传：n1 -> n2 -> n3
  const graph: DagGraphDefinition = {
    graphId: 'g-param-prop',
    name: '参数透传图',
    graphKind: 'operator',
    globalParams: {
      targetSide: 'Blue',
      bdaThreshold: 0.4,
    },
    nodes: [
      makeNode('n1', {
        parameterPorts: [{ key: 'bdaThreshold', label: '毁伤门限', dataType: 'number', defaultValue: 0.3 }],
        params: { sharedWindowSec: 1800, localOnly: 'keep_at_n1' },
      }),
      makeNode('n2', {
        parameterPorts: [
          { key: 'bdaThreshold', label: '毁伤门限', dataType: 'number', defaultValue: 0.3 },
          { key: 'sharedWindowSec', label: '在位窗口', dataType: 'number', defaultValue: 600 },
        ],
      }),
      makeNode('n3', {
        parameterPorts: [
          { key: 'bdaThreshold', label: '毁伤门限', dataType: 'number', defaultValue: 0.3 },
          { key: 'sharedWindowSec', label: '在位窗口', dataType: 'number', defaultValue: 600 },
        ],
        params: { bdaThreshold: 0.65 },
      }),
    ],
    edges: [makeEdge('e1', 'n1', 'n2'), makeEdge('e2', 'n2', 'n3')],
  };

  // 测试：指定键名 sharedWindowSec 沿边继承 + n1 外部覆盖 bdaThreshold=0.85 沿边穿透覆盖 n3 自身 params
  const execRes = await executeDagGraph(graph, {
    runId: 'run-prop',
    globalParamOverrides: { targetSide: 'Red' },
    propagateParams: ['sharedWindowSec', 'bdaThreshold'],
    paramOverrides: {
      n1: { bdaThreshold: 0.85 },
      n3: { finalOnlyOverride: true },
    },
    executor: async (ctx) => ({
      status: 'valid',
      value: 1,
      evidenceRefs: [],
      propagatedParams: ctx.node.id === 'n2' ? { dynamicFromN2: 'from-exec' } : undefined,
    }),
  });

  assert.equal(execRes.nodeResults['n1']?.resolvedParams.targetSide, 'Red');
  assert.equal(execRes.nodeResults['n1']?.resolvedParams.bdaThreshold, 0.85);
  assert.equal(execRes.nodeResults['n2']?.resolvedParams.bdaThreshold, 0.85);
  assert.equal(execRes.nodeResults['n2']?.resolvedParams.sharedWindowSec, 1800);
  assert.equal(execRes.nodeResults['n2']?.resolvedParams.localOnly, undefined);
  assert.equal(execRes.nodeResults['n3']?.resolvedParams.bdaThreshold, 0.85);
  assert.equal(execRes.nodeResults['n3']?.resolvedParams.sharedWindowSec, 1800);
  assert.equal(execRes.nodeResults['n3']?.resolvedParams.dynamicFromN2, 'from-exec');
  assert.equal(execRes.nodeResults['n3']?.resolvedParams.finalOnlyOverride, true);

  // 测试 propagateParams: true 与 upstreamOverrides 沿边传播，且 node.params 仍高于 globalParamOverrides
  const propTrueRes = await executeDagGraph(graph, {
    runId: 'run-prop-true',
    globalParamOverrides: { bdaThreshold: 0.99 },
    propagateParams: true,
    upstreamOverrides: { n1: { inheritedRule: 'strict-wra' } },
    paramOverrides: { n1: { sideOverride: 'Blue' } },
    executor: async () => ({ status: 'valid', value: 1, evidenceRefs: [] }),
  });

  // n3 自身 params.bdaThreshold = 0.65 高于 globalParamOverrides = 0.99
  assert.equal(propTrueRes.nodeResults['n3']?.resolvedParams.bdaThreshold, 0.65);
  assert.equal(propTrueRes.nodeResults['n2']?.resolvedParams.bdaThreshold, 0.99);
  assert.equal(propTrueRes.nodeResults['n3']?.resolvedParams.inheritedRule, 'strict-wra');
  assert.equal(propTrueRes.nodeResults['n3']?.resolvedParams.sideOverride, 'Blue');
});

test('5.1 - Fail-Closed 缺失传播阻断下游执行并保留 missingDataReason（支持 allowPartialUpstream 例外）', async () => {
  const executed: string[] = [];
  const cache = new DagNodeCache();

  // 菱形图：n1 (valid), n2 (unavailable) -> n3 -> n4
  const graph: DagGraphDefinition<DagExecutionNode> = {
    graphId: 'g-fail-closed',
    name: 'Fail-Closed 传播测试',
    graphKind: 'metric',
    nodes: [
      makeNode('n1'),
      makeNode('n2'),
      makeNode('n3'),
      makeNode('n4'),
    ],
    edges: [
      makeEdge('e13', 'n1', 'n3'),
      makeEdge('e23', 'n2', 'n3'),
      makeEdge('e34', 'n3', 'n4'),
    ],
  };

  const res = await executeDagGraph(graph, {
    runId: 'run-fc-1',
    cache,
    executor: async (ctx) => {
      executed.push(ctx.node.id);
      if (ctx.node.id === 'n2') {
        return {
          status: 'unavailable',
          missingDataReason: '缺失底表 WeaponEndgame.csv',
          evidenceRefs: [],
        };
      }
      return {
        status: 'valid',
        value: 1,
        evidenceRefs: [],
      };
    },
  });

  // 只有 n1 与 n2 执行了 executor；n3 与 n4 被 Fail-Closed 直接阻断
  assert.deepEqual(executed, ['n1', 'n2']);
  assert.equal(res.nodeResults['n1']?.status, 'valid');
  assert.equal(res.nodeResults['n2']?.status, 'unavailable');
  assert.equal(res.nodeResults['n3']?.status, 'unavailable');
  assert.equal(res.nodeResults['n4']?.status, 'unavailable');
  assert.ok(res.nodeResults['n3']?.missingDataReason?.includes('n2'));
  assert.ok(res.nodeResults['n3']?.missingDataReason?.includes('WeaponEndgame.csv'));
  assert.ok(res.nodeResults['n4']?.missingDataReason?.includes('n3'));
  assert.ok(res.nodeResults['n4']?.missingDataReason?.includes('WeaponEndgame.csv'));

  // 再次运行相同配置应命中缓存且同样不调用 executor
  const resCached = await executeDagGraph(graph, {
    runId: 'run-fc-1',
    cache,
    executor: async (ctx) => {
      executed.push(ctx.node.id);
      return { status: 'valid', value: 99, evidenceRefs: [] };
    },
  });
  assert.deepEqual(executed, ['n1', 'n2']);
  assert.equal(resCached.cacheHits, 4);
  assert.equal(resCached.nodeResults['n3']?.status, 'unavailable');
  assert.ok(resCached.nodeResults['n3']?.missingDataReason?.includes('WeaponEndgame.csv'));

  // 若 n3 显式开启 allowPartialUpstream: true，则可继续执行并降级合成，同时 n4 正常执行
  const partialExecuted: string[] = [];
  const partialGraph: DagGraphDefinition<DagExecutionNode> = {
    ...graph,
    nodes: [
      makeNode('n1'),
      makeNode('n2'),
      makeNode('n3', { allowPartialUpstream: true }),
      makeNode('n4'),
    ],
  };

  const partialRes = await executeDagGraph(partialGraph, {
    runId: 'run-fc-2',
    executor: async (ctx) => {
      partialExecuted.push(ctx.node.id);
      if (ctx.node.id === 'n2') {
        return {
          status: 'unavailable',
          missingDataReason: '缺失底表 UnitPositions.csv',
          evidenceRefs: [],
        };
      }
      if (ctx.node.id === 'n3') {
        const n1Status = ctx.upstreamResults['n1']?.status;
        const n2Status = ctx.upstreamResults['n2']?.status;
        return {
          status: n1Status === 'valid' && n2Status === 'unavailable' ? 'degraded' : 'valid',
          value: 0.5,
          evidenceRefs: [],
        };
      }
      return {
        status: 'valid',
        value: ctx.upstreamResults['n3']?.value ?? 0,
        evidenceRefs: [],
      };
    },
  });

  assert.deepEqual(partialExecuted, ['n1', 'n2', 'n3', 'n4']);
  assert.equal(partialRes.nodeResults['n3']?.status, 'degraded');
  assert.equal(partialRes.nodeResults['n4']?.status, 'valid');
  assert.equal(partialRes.nodeResults['n4']?.value, 0.5);

  // degraded 上游不应阻断下游节点执行
  const degradedExecuted: string[] = [];
  const degradedGraph: DagGraphDefinition = {
    graphId: 'g-degraded',
    name: 'Degraded 透传图',
    graphKind: 'operator',
    nodes: [makeNode('u1'), makeNode('u2')],
    edges: [makeEdge('e1', 'u1', 'u2')],
  };
  const degradedRes = await executeDagGraph(degradedGraph, {
    runId: 'run-deg',
    executor: async (ctx) => {
      degradedExecuted.push(ctx.node.id);
      if (ctx.node.id === 'u1') {
        return { status: 'degraded', value: 0.7, evidenceRefs: [] };
      }
      assert.equal(ctx.upstreamResults['u1']?.status, 'degraded');
      return { status: 'valid', value: Number(ctx.upstreamResults['u1']?.value ?? 0) * 10, evidenceRefs: [] };
    },
  });
  assert.deepEqual(degradedExecuted, ['u1', 'u2']);
  assert.equal(degradedRes.nodeResults['u2']?.value, 7);
});
