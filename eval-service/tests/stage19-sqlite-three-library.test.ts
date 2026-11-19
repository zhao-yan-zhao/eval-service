import assert from 'node:assert/strict';
import test from 'node:test';
import { EvalSqliteStore } from '../src/adapters/sqlite-store.ts';
import { CustomOperatorStore } from '../src/operators/custom-store.ts';
import { OperatorOverrideStore } from '../src/operators/override-store.ts';
import { IndicatorStore } from '../src/indicators/store.ts';
import { SystemStore } from '../src/systems/store.ts';
import { createEvalApp } from '../src/server.ts';
import type {
  CustomOperatorDefinition,
  IndicatorDefinition,
  IndicatorSystem,
} from '../src/core/types.ts';

test('Stage 19.1 - EvalSqliteStore 初始化与三库表结构自动建表与自动种子迁移', () => {
  const sqlite = new EvalSqliteStore(':memory:');
  const stats = sqlite.getStats();

  assert.equal(stats.dbPath, ':memory:');
  assert.ok(stats.counts);
  assert.equal(typeof stats.counts.runs, 'number');
  assert.equal(typeof stats.counts.customOperators, 'number');
  assert.equal(typeof stats.counts.operatorOverrides, 'number');
  assert.equal(typeof stats.counts.operatorPipelines, 'number');
  assert.equal(typeof stats.counts.indicators, 'number');
  assert.equal(typeof stats.counts.systems, 'number');

  // 内置指标和预设体系应该已由 catalog.json 与 presets/ 自动完成种子装载
  assert.ok(stats.counts.indicators >= 38, `指标数量应至少包含38个内置项，实测: ${stats.counts.indicators}`);
  assert.ok(stats.counts.systems >= 4, `体系数量应至少包含4个预置项，实测: ${stats.counts.systems}`);

  sqlite.close();
});

test('Stage 19.2 - 一库：自定义算子、内置覆盖与专属流水线 SQLite 原生 CRUD 闭环', () => {
  const sqlite = new EvalSqliteStore(':memory:');

  // 1. 自定义算子测试
  const customOp: CustomOperatorDefinition = {
    id: 'custom.sqlite_test_op',
    name: 'SQLite 测试算子',
    category: 'effectiveness',
    mode: 'formula_pipeline',
    pipelineCategory: 'inline_calc',
    description: '验证 SQLite 存储算子',
    expression: 'v1 * 2',
    variables: [{ alias: 'v1', atomRef: 'time.first_detection' }],
    outputType: 'score',
    defaultOptimalDirection: 'larger_is_better',
    unit: '分',
  };
  sqlite.saveCustomOperator(customOp);
  const fetchedOp = sqlite.getCustomOperator('custom.sqlite_test_op');
  assert.ok(fetchedOp);
  assert.equal(fetchedOp.id, 'custom.sqlite_test_op');
  assert.equal(fetchedOp.name, 'SQLite 测试算子');
  assert.equal(fetchedOp.unit, '分');

  const customList = sqlite.listCustomOperators();
  assert.ok(customList.some((o) => o.id === 'custom.sqlite_test_op'));

  // 2. 算子覆盖配置测试
  sqlite.saveOperatorOverride('time.first_detection', {
    id: 'time.first_detection',
    name: '首探时标覆写名称',
    defaultParams: { thresholdLow: 100, thresholdHigh: 500 },
  });
  const fetchedOverride = sqlite.getOperatorOverride('time.first_detection');
  assert.ok(fetchedOverride);
  assert.equal(fetchedOverride.name, '首探时标覆写名称');
  assert.equal((fetchedOverride.defaultParams as any)?.thresholdLow, 100);

  // 3. 画布流水线持久化测试
  sqlite.saveOperatorPipeline({
    operatorId: 'custom.sqlite_test_op',
    pipelineTitle: '测试流水线',
    nodes: [{ id: 'n1', type: 'data_input', title: '输入节点' }],
    edges: [],
  });
  const fetchedPipeline = sqlite.getOperatorPipeline('custom.sqlite_test_op');
  assert.ok(fetchedPipeline);
  assert.equal(fetchedPipeline.pipelineTitle, '测试流水线');
  assert.equal(fetchedPipeline.nodes.length, 1);

  // 4. 删除测试
  const deletedOp = sqlite.deleteCustomOperator('custom.sqlite_test_op');
  assert.equal(deletedOp, true);
  assert.equal(sqlite.getCustomOperator('custom.sqlite_test_op'), null);

  const deletedOverride = sqlite.deleteOperatorOverride('time.first_detection');
  assert.equal(deletedOverride, true);
  assert.equal(sqlite.getOperatorOverride('time.first_detection'), null);

  const deletedPipe = sqlite.deleteOperatorPipeline('custom.sqlite_test_op');
  assert.equal(deletedPipe, true);
  assert.equal(sqlite.getOperatorPipeline('custom.sqlite_test_op'), null);

  sqlite.close();
});

test('Stage 19.3 - 二库 & 三库：指标定义与评估体系树内置隔离与自定义 CRUD', () => {
  const sqlite = new EvalSqliteStore(':memory:');

  // 1. 二库自定义指标保存与过滤测试
  const customInd: IndicatorDefinition = {
    indicatorId: 'ind_custom_sqlite_test',
    name: 'SQLite 自定义指标',
    atomRef: 'time.first_detection',
    scoring: { type: 'larger_is_better', optimal: 100, worst: 0 },
    builtin: false,
    tags: ['时效', '测试'],
  };
  sqlite.saveIndicator(customInd, false);

  const fetchedInd = sqlite.getIndicator('ind_custom_sqlite_test');
  assert.ok(fetchedInd);
  assert.equal(fetchedInd.name, 'SQLite 自定义指标');

  const customOnly = sqlite.listIndicators({ customOnly: true });
  assert.ok(customOnly.some((i) => i.indicatorId === 'ind_custom_sqlite_test'));
  assert.ok(!customOnly.some((i) => i.builtin === true));

  const builtinOnly = sqlite.listIndicators({ builtinOnly: true });
  assert.ok(builtinOnly.length >= 38);
  assert.ok(builtinOnly.every((i) => i.builtin === true));

  // 尝试删除内置指标应被拦截 (返回 false)
  const delBuiltinInd = sqlite.deleteIndicator('ind_first_detect_fast');
  assert.equal(delBuiltinInd, false);
  assert.ok(sqlite.getIndicator('ind_first_detect_fast') !== null);

  // 删除自定义指标
  const delCustomInd = sqlite.deleteIndicator('ind_custom_sqlite_test');
  assert.equal(delCustomInd, true);
  assert.equal(sqlite.getIndicator('ind_custom_sqlite_test'), null);

  // 2. 三库体系树保存与过滤测试
  const customSys: IndicatorSystem = {
    systemId: 'sys_custom_sqlite_test',
    name: 'SQLite 评估体系',
    version: '1.0.0',
    targetTags: ['sqlite_test'],
    kpis: [],
    root: {
      name: '顶层评估',
      weight: 1.0,
      method: 'weighted_sum',
      children: [
        {
          id: 'leaf_1',
          indicatorRef: 'ind_first_detect_fast',
          weight: 1.0,
        },
      ],
    },
    builtin: false,
  };
  sqlite.saveSystem(customSys, false);

  const fetchedSys = sqlite.getSystem('sys_custom_sqlite_test');
  assert.ok(fetchedSys);
  assert.equal(fetchedSys.name, 'SQLite 评估体系');
  assert.equal(fetchedSys.version, '1.0.0');

  const sysCustomOnly = sqlite.listSystems({ customOnly: true });
  assert.ok(sysCustomOnly.some((s) => s.systemId === 'sys_custom_sqlite_test'));

  // 尝试删除内置预设体系应被拦截
  const delPreset = sqlite.deleteSystem('sys_bvr_air_combat_v1');
  assert.equal(delPreset, false);
  assert.ok(sqlite.getSystem('sys_bvr_air_combat_v1') !== null);

  // 删除自定义体系
  const delCustomSys = sqlite.deleteSystem('sys_custom_sqlite_test');
  assert.equal(delCustomSys, true);
  assert.equal(sqlite.getSystem('sys_custom_sqlite_test'), null);

  sqlite.close();
});

test('Stage 19.4 - Store 适配器与 createEvalApp 全链路 REST API 入库自闭环', async () => {
  const sqlite = new EvalSqliteStore(':memory:');

  const app = await createEvalApp({
    sqliteStore: sqlite,
  });

  const server = app.server;
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. 验证 /api/health 包含 SQLite 三库统计计数
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.ok, true);
    assert.ok(healthJson.db.counts.indicators >= 38);
    assert.ok(healthJson.db.counts.systems >= 4);

    // 2. 通过 REST API 新建自定义算子
    const opRes = await fetch(`${baseUrl}/api/operators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'custom.api_sqlite_op',
        name: 'API创建的SQLite算子',
        category: 'effectiveness',
        mode: 'formula',
        expression: 'v1 * 1.5',
        variables: [{ alias: 'v1', atomRef: 'time.first_detection' }],
        outputType: 'score',
        defaultOptimalDirection: 'larger_is_better',
      }),
    });
    assert.equal(opRes.status, 200);

    // 验证立即写入 SQLite 表中
    assert.ok(sqlite.getCustomOperator('custom.api_sqlite_op') !== null);

    // 3. 通过 REST API 保存专属画布流水线
    const pipeRes = await fetch(`${baseUrl}/api/operator-pipelines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorId: 'custom.api_sqlite_op',
        pipelineTitle: 'API保存的画布',
        nodes: [{ id: 'n1', type: 'data_input', title: '数据节点' }],
        edges: [],
      }),
    });
    assert.equal(pipeRes.status, 200);

    // 验证立即写入 SQLite operator_pipelines 表中
    const pipeInDb = sqlite.getOperatorPipeline('custom.api_sqlite_op');
    assert.ok(pipeInDb !== null);
    assert.equal(pipeInDb.pipelineTitle, 'API保存的画布');

    // 4. 通过 REST API 新建自定义指标
    const indRes = await fetch(`${baseUrl}/api/indicators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indicatorId: 'ind_api_sqlite_ind',
        name: 'API创建的SQLite指标',
        atomRef: 'custom.api_sqlite_op',
        scoring: { type: 'larger_is_better', optimal: 100, worst: 0 },
      }),
    });
    assert.equal(indRes.status, 200);

    // 验证立即写入 SQLite indicator_definitions 表中
    assert.ok(sqlite.getIndicator('ind_api_sqlite_ind') !== null);

    // 5. 通过 REST API 新建自定义体系
    const sysRes = await fetch(`${baseUrl}/api/systems`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemId: 'sys_api_sqlite_sys',
        name: 'API创建的SQLite体系',
        version: '1.0.0',
        root: {
          id: 'root',
          name: '顶层评估',
          weight: 1.0,
          children: [
            {
              id: 'leaf_ind',
              indicatorRef: 'ind_api_sqlite_ind',
              weight: 1.0,
            },
          ],
        },
      }),
    });
    assert.equal(sysRes.status, 200);

    // 验证立即写入 SQLite indicator_systems 表中
    assert.ok(sqlite.getSystem('sys_api_sqlite_sys') !== null);
  } finally {
    await app.close();
  }
});
