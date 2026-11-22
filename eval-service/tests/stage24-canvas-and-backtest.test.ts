import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {
  IndicatorDefinition,
  IndicatorSystem,
  SystemEvaluationOutput,
} from '../src/core/types.ts';
import { createEvalApp } from '../src/server.ts';
import {
  AGG_CANVAS_CONSTANTS,
  computeAggregationCanvasLayout,
  computeSystemConfigSignature,
} from '../src/ui/components/systems/aggregation-canvas-layout.ts';

test('Stage 24.1 - 后端复合指标回测：支持 bindingMode: "composite" 且 atomRef: ""，透传 details.vars 中间变量与实测计算值', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stage24-api-'));
  const app = await createEvalApp({
    dbPath: path.join(tmpDir, 'eval.db'),
    customOperatorsPath: path.join(tmpDir, 'custom-op.json'),
    operatorOverridesPath: path.join(tmpDir, 'operator-overrides.json'),
    customIndicatorsPath: path.join(tmpDir, 'custom-ind.json'),
    customSystemsPath: path.join(tmpDir, 'custom-sys.json'),
    autoSeed: false,
  });

  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 导入内置 GJ11 样本
    await fetch(`${baseUrl}/api/runs/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'builtin_gj11', runId: 'gj11_pl15_bvr_real' }),
    });

    const compositeIndicator: IndicatorDefinition = {
      indicatorId: 'ind_composite_bvr_test',
      name: '超视距多源复合效能测试',
      bindingMode: 'composite',
      atomRef: '',
      sources: [
        {
          alias: 'corridor_comp',
          atomRef: 'roe.corridor_spatial_compliance',
          reduce: 'mean',
          missingPolicy: 'fallback',
          fallbackValue: 0.5,
        },
        {
          alias: 'strike_dmg',
          atomRef: 'strike.damage_simulation',
          reduce: 'mean',
          missingPolicy: 'fallback',
          fallbackValue: 0.8,
        },
      ],
      composeFormula: 'IF(corridor_comp > 0, corridor_comp * 80 + strike_dmg * 20, strike_dmg * 100)',
      scoring: {
        type: 'larger_is_better',
        worst: 0,
        optimal: 100,
      },
      alarmThreshold: {
        operator: '<',
        value: 30,
        severity: 'major',
      },
    };

    const btRes = await fetch(`${baseUrl}/api/indicators/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indicator: compositeIndicator,
        runIds: ['gj11_pl15_bvr_real'],
      }),
    }).then((r) => r.json());

    assert.equal(btRes.ok, true, `回测请求应当成功: ${JSON.stringify(btRes)}`);
    assert.equal(btRes.results.length, 1);
    const firstResult = btRes.results[0];
    assert.equal(firstResult.runId, 'gj11_pl15_bvr_real');

    // 验证 details.vars 透传
    assert.ok(firstResult.details, '回测结果必须透传 details 字段');
    assert.equal(firstResult.details.bindingMode, 'composite');
    assert.equal(firstResult.details.composeFormula, compositeIndicator.composeFormula);
    assert.ok(firstResult.details.vars, 'details 必须包含 vars 字典');
    assert.ok('corridor_comp' in firstResult.details.vars, 'vars 必须包含 corridor_comp');
    assert.ok('strike_dmg' in firstResult.details.vars, 'vars 必须包含 strike_dmg');

    // 缺失源若校验不过返回 400
    const badBtRes = await fetch(`${baseUrl}/api/indicators/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indicator: {
          ...compositeIndicator,
          sources: [{ alias: 'non_exist', atomRef: 'invalid.operator.id' }],
        },
      }),
    });
    assert.equal(badBtRes.status, 400, '不存在的算子输入源必须返回 400');
  } finally {
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    app.sqliteStore.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Windows lock
    }
  }
});

test('Stage 24.2 - 草稿即时试算与历史数据库防污染验证 (POST /api/evaluate previewOnly)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stage24-eval-'));
  const app = await createEvalApp({
    dbPath: path.join(tmpDir, 'eval.db'),
    customOperatorsPath: path.join(tmpDir, 'custom-op.json'),
    operatorOverridesPath: path.join(tmpDir, 'operator-overrides.json'),
    customIndicatorsPath: path.join(tmpDir, 'custom-ind.json'),
    customSystemsPath: path.join(tmpDir, 'custom-sys.json'),
    autoSeed: true,
  });

  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await fetch(`${baseUrl}/api/runs/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'builtin_gj11', runId: 'gj11_pl15_bvr_real' }),
    });

    // 构造测试草稿体系，策略改为 maximin
    const draftSystem: IndicatorSystem = {
      systemId: 'sys_draft_preview_test',
      name: '即时试算草稿体系',
      description: '未保存的测试草稿',
      root: {
        id: 'root',
        name: '根决策',
        weight: 1.0,
        aggregation: {
          mode: 'visual',
          strategy: 'maximin',
          missingPolicy: 'fail',
        },
        children: [
          {
            id: 'dim_sub',
            name: '子维度',
            weight: 1.0,
            aggregation: {
              mode: 'visual',
              strategy: 'mean',
            },
            children: [
              {
                id: 'leaf_1',
                name: '航路遵从率',
                indicatorRef: 'ind_roe_corridor_compliance',
                weight: 1.0,
              },
            ],
          },
        ],
      },
    };

    // 查询初始历史评估记录数
    const initialHistory = await fetch(`${baseUrl}/api/evaluations`).then((r) => r.json());
    const initialCount = initialHistory.evaluations.length;

    // 执行 previewOnly: true 试算
    const evalRes = await fetch(`${baseUrl}/api/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'gj11_pl15_bvr_real',
        system: draftSystem,
        previewOnly: true,
        runPythonMetrics: false,
      }),
    }).then((r) => r.json());

    assert.equal(evalRes.ok, true, `草稿试算应当成功: ${JSON.stringify(evalRes)}`);
    assert.ok(evalRes.output);
    assert.equal(evalRes.output.rootTree.strategyUsed, 'maximin', '试算结果必须体现草稿的 maximin 策略');

    // 验证历史库防污染：未调用 sqliteStore.saveEvaluation 增加记录
    const historyRes = await fetch(`${baseUrl}/api/evaluations`).then((r) => r.json());
    assert.equal(
      historyRes.evaluations.length,
      initialCount,
      'previewOnly 为 true 时严禁向 eval.db 写入历史记录',
    );
  } finally {
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    app.sqliteStore.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Windows lock
    }
  }
});

test('Stage 24.3 - 画布自底向上布局引擎纯函数测试（全部叶子统一齐平最左列 + 根节点最右列 + 零重叠）', () => {
  // 构造非对称层级树（部分分支 2 层，部分分支 3 层）
  const asymmetricSystem: IndicatorSystem = {
    systemId: 'sys_asymmetric_test',
    name: '非对称多层体系',
    root: {
      id: 'root',
      name: '根目标',
      weight: 1.0,
      aggregation: {
        mode: 'visual',
        strategy: 'weighted_sum',
      },
      children: [
        {
          id: 'dim_shallow',
          name: '浅层维度 (L2)',
          weight: 0.4,
          aggregation: { mode: 'visual', strategy: 'weighted_sum' },
          children: [
            { id: 'leaf_a', name: '叶子指标 A', indicatorRef: 'ind_a', weight: 0.5 },
            { id: 'leaf_b', name: '叶子指标 B', indicatorRef: 'ind_b', weight: 0.5 },
          ],
        },
        {
          id: 'dim_deep',
          name: '深层维度 (L3)',
          weight: 0.6,
          aggregation: { mode: 'visual', strategy: 'weighted_sum' },
          children: [
            {
              id: 'dim_sub_1',
              name: '次级子维度 1',
              weight: 0.5,
              aggregation: { mode: 'visual', strategy: 'mean' },
              children: [
                { id: 'leaf_c', name: '叶子指标 C', indicatorRef: 'ind_c', weight: 0.5 },
                { id: 'leaf_d', name: '叶子指标 D', indicatorRef: 'ind_d', weight: 0.5 },
              ],
            },
            {
              id: 'dim_sub_2',
              name: '次级子维度 2',
              weight: 0.5,
              aggregation: { mode: 'visual', strategy: 'maximin' },
              children: [
                { id: 'leaf_e', name: '叶子指标 E', indicatorRef: 'ind_e', weight: 1.0 },
              ],
            },
          ],
        },
      ],
    },
  };

  const layout = computeAggregationCanvasLayout(asymmetricSystem);

  assert.ok(layout.nodes.length > 0);
  assert.ok(layout.edges.length > 0);
  assert.ok(layout.maxDepth >= 2, `maxDepth 应当 >= 2，实际为 ${layout.maxDepth}`);

  // 1. 验证全部叶子统一齐平最左列 (x === CANVAS_PAD_X, bottomUpLevel === 0)
  const leaves = layout.nodes.filter((n) => n.kind === 'leaf');
  assert.equal(leaves.length, 5, '应该包含 5 个叶子指标');
  for (const leaf of leaves) {
    assert.equal(
      leaf.bottomUpLevel,
      0,
      `叶子节点 ${leaf.name} 的 bottomUpLevel 必须为 0`,
    );
    assert.equal(
      leaf.x,
      AGG_CANVAS_CONSTANTS.CANVAS_PAD_X,
      `叶子节点 ${leaf.name} 必须齐平最左列 X=${AGG_CANVAS_CONSTANTS.CANVAS_PAD_X}`,
    );
  }

  // 2. 根节点位于最右列 (bottomUpLevel === maxDepth)
  const rootNode = layout.nodes.find((n) => n.kind === 'root');
  assert.ok(rootNode, '必须包含根节点');
  assert.equal(rootNode.bottomUpLevel, layout.maxDepth);
  assert.equal(
    rootNode.x,
    AGG_CANVAS_CONSTANTS.CANVAS_PAD_X + layout.maxDepth * AGG_CANVAS_CONSTANTS.COL_STRIDE,
  );

  // 3. 几何零重叠严格断言（同一列上的所有卡片垂直方向必须保持 >= ROW_GAP）
  const colMap = new Map<number, typeof layout.nodes>();
  for (const node of layout.nodes) {
    const list = colMap.get(node.bottomUpLevel) || [];
    list.push(node);
    colMap.set(node.bottomUpLevel, list);
  }

  for (const [level, nodesInCol] of colMap.entries()) {
    nodesInCol.sort((a, b) => a.y - b.y);
    for (let i = 0; i < nodesInCol.length - 1; i++) {
      const cur = nodesInCol[i];
      const next = nodesInCol[i + 1];
      const diff = next.y - (cur.y + cur.height);
      assert.ok(
        diff >= AGG_CANVAS_CONSTANTS.ROW_GAP - 1e-4,
        `第 ${level} 列节点 [${cur.name}] 与 [${next.name}] 发生重叠或间隙不足！diff=${diff}`,
      );
    }
  }

  // 4. 签名状态守卫函数测试
  const sig1 = computeSystemConfigSignature(asymmetricSystem);
  const cloned = structuredClone(asymmetricSystem);
  const sig2 = computeSystemConfigSignature(cloned);
  assert.equal(sig1, sig2, '未修改时签名必须完全一致');

  (cloned.root.children[0] as any).weight = 0.5;
  const sig3 = computeSystemConfigSignature(cloned);
  assert.notEqual(sig1, sig3, '修改权重后签名必须改变以触发 Stale 守卫');
});

test('Stage 24.4 - 画布连线实效重归一与缺失态分类 (classifyEdgeVisual)', () => {
  const system: IndicatorSystem = {
    systemId: 'sys_edge_visual_test',
    name: '连线视觉分类测试',
    root: {
      id: 'root',
      name: '根目标',
      weight: 1.0,
      aggregation: {
        mode: 'visual',
        strategy: 'weighted_sum',
        missingPolicy: 'skip_renormalize',
      },
      children: [
        { id: 'c1', name: '有效子项1', indicatorRef: 'ind_1', weight: 0.5 },
        { id: 'c2', name: '缺失子项2', indicatorRef: 'ind_2', weight: 0.5 },
      ],
    },
  };

  // 模拟评估结果：c1 正常得 80 分，c2 缺数 score 为 null，c1 重归一化有效权重由 0.5 -> 1.0
  const mockEvalOutput: SystemEvaluationOutput = {
    evalId: 'eval_mock_1',
    runId: 'run_1',
    systemId: 'sys_edge_visual_test',
    systemName: '连线视觉分类测试',
    systemVersion: '1.0',
    createdAt: new Date().toISOString(),
    overallScore: 80,
    overallConfidence: 'high',
    availableWeightRatio: 0.5,
    dimensions: [],
    rootTree: {
      id: 'root',
      name: '根目标',
      score: 80,
      weight: 1.0,
      children: [
        {
          id: 'c1',
          name: '有效子项1',
          score: 80,
          weight: 0.5,
          effectiveWeight: 1.0,
          kind: 'indicator',
          indicatorRef: 'ind_1',
        },
        {
          id: 'c2',
          name: '缺失子项2',
          score: null,
          weight: 0.5,
          effectiveWeight: 0,
          kind: 'indicator',
          indicatorRef: 'ind_2',
        },
      ],
    },
  };

  const layout = computeAggregationCanvasLayout(system, undefined, mockEvalOutput);

  const edgeC1 = layout.edges.find((e) => e.sourceNodeId === 'c1');
  const edgeC2 = layout.edges.find((e) => e.sourceNodeId === 'c2');

  assert.ok(edgeC1, '应包含 c1 连线');
  assert.ok(edgeC2, '应包含 c2 连线');

  // c1 重归一化为 1.0，visualKind 必须为 renormalized，badgeText 包含 实效
  assert.equal(edgeC1.visualKind, 'renormalized');
  assert.ok(edgeC1.badgeText.includes('实效'));

  // c2 缺失，visualKind 必须为 missing，badgeText 包含 缺失
  assert.equal(edgeC2.visualKind, 'missing');
  assert.ok(edgeC2.badgeText.includes('缺失'));

  // 验证 safeEndY 亚像素防退化
  assert.ok(Number.isFinite(edgeC1.endY));
  assert.ok(Math.abs(edgeC1.endY - edgeC1.startY) > 0.01 || edgeC1.endY !== edgeC1.startY);
});
