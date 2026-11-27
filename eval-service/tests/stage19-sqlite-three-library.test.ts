import assert from 'node:assert/strict';
import test from 'node:test';
import { EvalSqliteStore } from '../src/adapters/sqlite-store.ts';
import { createEvalApp } from '../src/server.ts';

test('Stage 19.1 (V4) - EvalSqliteStore 初始化与 V4 三库表结构自动建表与种子装载', () => {
  const sqlite = new EvalSqliteStore(':memory:');
  const stats = sqlite.getStats();

  assert.equal(stats.dbPath, ':memory:');
  assert.equal(sqlite.getSchemaVersion(), '4.0.0');
  assert.ok(stats.counts.v4Operators >= 42, `V4 算子应至少包含 42 项，实测: ${stats.counts.v4Operators}`);
  assert.ok(stats.counts.v4Effects >= 10, `V4 效果库应至少包含预置项，实测: ${stats.counts.v4Effects}`);
  assert.ok(stats.counts.v4MetricGraphs >= 2, `V4 指标图应至少包含 2 个预置图，实测: ${stats.counts.v4MetricGraphs}`);
  assert.ok(stats.counts.v4SystemDags >= 2, `V4 体系 DAG 应至少包含 2 个预置体系，实测: ${stats.counts.v4SystemDags}`);
  assert.ok(stats.counts.operatorPipelines >= 42);

  sqlite.close();
});

test('Stage 19.2 (V4) - V4 一库/二库/三库 SQLite 原生 CRUD 与内置保护闭环', () => {
  const sqlite = new EvalSqliteStore(':memory:');

  // 1. V4 自定义算子 CRUD
  sqlite.upsertV4Operator(
    {
      id: 'custom.sqlite_v4_op',
      name: 'SQLite V4 测试算子',
      chapter: 8,
      category: 'effectiveness',
      militaryLevel: 'MOP',
      domainTag: 'firepower',
      description: '验证 V4 SQLite 算子 CRUD',
      requiredTables: ['WeaponFired'],
      parameterPorts: [],
      outputColumns: ['分方', 'val'],
      pythonCode: 'import pandas as pd\noutput_df = pd.DataFrame([{"分方": "红方", "val": 1}])',
    },
    false,
  );
  const fetchedOp = sqlite.getV4Operator('custom.sqlite_v4_op');
  assert.ok(fetchedOp);
  assert.equal(fetchedOp.name, 'SQLite V4 测试算子');
  assert.equal(sqlite.deleteV4Operator('roe.corridor_spatial_compliance'), false, '内置算子默认不可删除');
  assert.equal(sqlite.deleteV4Operator('custom.sqlite_v4_op'), true);
  assert.equal(sqlite.getV4Operator('custom.sqlite_v4_op'), null);

  // 2. V4 效果库 CRUD & 内置保护
  sqlite.upsertV4Effect(
    {
      effectId: 'eff_custom_sqlite_v4',
      name: 'SQLite V4 自定义效果',
      role: 'effect',
      domainTag: 'firepower',
      metricBinding: {
        metricId: 'isr.detection_rate',
        reduce: 'mean',
        scoringRule: { type: 'larger_is_better', optimal: 0.95, worst: 0.2 },
      },
      aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
    },
    false,
  );
  assert.ok(sqlite.getV4Effect('eff_custom_sqlite_v4'));
  assert.equal(sqlite.deleteV4Effect('eff_strike_mission'), false, '内置效果不可删除');
  assert.equal(sqlite.deleteV4Effect('eff_custom_sqlite_v4'), true);

  // 3. 画布流水线 CRUD
  sqlite.saveOperatorPipeline({
    operatorId: 'custom.sqlite_v4_op',
    pipelineTitle: 'V4 测试流水线',
    nodes: [{ id: 'n1', type: 'data_input', title: '输入节点' }],
    edges: [],
  });
  const fetchedPipe = sqlite.getOperatorPipeline('custom.sqlite_v4_op');
  assert.ok(fetchedPipe);
  assert.equal(fetchedPipe.pipelineTitle, 'V4 测试流水线');
  assert.equal(sqlite.deleteOperatorPipeline('custom.sqlite_v4_op'), true);

  sqlite.close();
});

test('Stage 19.3 (V4) - createEvalApp 全链路 V4 REST API 入库自闭环', async () => {
  const sqlite = new EvalSqliteStore(':memory:');
  const app = await createEvalApp({ sqliteStore: sqlite, autoSeed: false });

  await new Promise<void>((resolve) => app.server.listen(0, resolve));
  const port = (app.server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. /api/health 返回 V4 三库计数
    const healthJson = (await fetch(`${baseUrl}/api/health`).then((r) => r.json())) as {
      ok: boolean;
      db: { counts: { v4Operators: number; v4Effects: number; v4MetricGraphs: number; v4SystemDags: number } };
    };
    assert.equal(healthJson.ok, true);
    assert.ok(healthJson.db.counts.v4Operators >= 42);
    assert.ok(healthJson.db.counts.v4Effects >= 10);
    assert.ok(healthJson.db.counts.v4MetricGraphs >= 2);
    assert.ok(healthJson.db.counts.v4SystemDags >= 2);

    // 2. POST /api/v4/operators
    const opRes = await fetch(`${baseUrl}/api/v4/operators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'custom.api_v4_sqlite_op',
        name: 'API 创建的 V4 SQLite 算子',
        chapter: 8,
        category: 'effectiveness',
        militaryLevel: 'MOP',
        domainTag: 'firepower',
        description: 'V4 REST 入库闭环测试',
        requiredTables: ['WeaponFired'],
        parameterPorts: [],
        outputColumns: ['分方', 'score'],
        pythonCode: 'import pandas as pd\noutput_df = pd.DataFrame([{"分方": "红方", "score": 0.9}])',
      }),
    });
    assert.equal(opRes.status, 200);
    assert.ok(sqlite.getV4Operator('custom.api_v4_sqlite_op') !== null);

    // 3. POST /api/operator-pipelines
    const pipeRes = await fetch(`${baseUrl}/api/operator-pipelines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorId: 'custom.api_v4_sqlite_op',
        pipelineTitle: 'V4 API 保存画布',
        nodes: [{ id: 'n1', type: 'data_input', title: '数据节点', config: { csvTable: 'WeaponFired' } }],
        edges: [],
      }),
    });
    assert.equal(pipeRes.status, 200);
    assert.equal(sqlite.getOperatorPipeline('custom.api_v4_sqlite_op')?.pipelineTitle, 'V4 API 保存画布');

    // 4. POST /api/v4/effects
    const effRes = await fetch(`${baseUrl}/api/v4/effects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        effectId: 'eff_api_v4_sqlite',
        name: 'API 创建的 V4 效果',
        role: 'effect',
        domainTag: 'firepower',
        metricBinding: {
          metricId: 'isr.detection_rate',
          reduce: 'mean',
          scoringRule: { type: 'larger_is_better', optimal: 1, worst: 0 },
        },
        aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
      }),
    });
    assert.equal(effRes.status, 200);
    assert.ok(sqlite.getV4Effect('eff_api_v4_sqlite') !== null);
  } finally {
    await app.close();
  }
});
