import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  CURRENT_SCHEMA_VERSION,
  EvalSqliteStore,
  type V4StoredMetricGraph,
  type V4StoredOperator,
  type V4StoredSystemDag,
} from '../src/adapters/sqlite-store.ts';
import type { EffectDefinition } from '../src/core/types.ts';
import { EffectStore } from '../src/effects/store.ts';
import { handleV4ApiRequest, type V4RouteDeps } from '../src/engine/v4-routes.ts';
import { MetricGraphStore } from '../src/indicators/metric-graph-store.ts';
import {
  ComponentRegistryStore,
  type ComponentManifest,
} from '../src/operators/component-store.ts';
import { V4OperatorStore } from '../src/operators/v4/store.ts';
import { SystemDagStore } from '../src/systems/system-dag-store.ts';

function sampleOperator(id: string, isBuiltin = false): V4StoredOperator {
  return {
    id,
    name: `算子 ${id}`,
    chapter: 1,
    category: 'effectiveness',
    militaryLevel: 'MOP',
    domainTag: 'firepower',
    description: 'V4 SQLite 单元测试算子',
    layer: 'fact',
    engineKind: 'python_script',
    requiredTables: ['WeaponFired'],
    optionalTables: ['WeaponEndgame'],
    parameterPorts: [],
    outputColumns: ['Side', 'Rate'],
    pythonCode: 'def compute(input_df_dict, params): return []',
    isBuiltin,
  };
}

function sampleEffect(effectId: string, role: 'effect' | 'gate' = 'effect', isBuiltin = false): EffectDefinition {
  return {
    effectId,
    name: `效果 ${effectId}`,
    description: 'V4 SQLite 单元测试效果',
    role,
    ...(role === 'gate' ? { gateMode: 'hard' as const } : {}),
    domainTag: 'firepower',
    isBuiltin,
    metricBinding: {
      metricId: 'weapon.munition_hit_rate',
      reduce: 'mean',
      scoringRule: {
        type: 'larger_is_better',
        worst: 0.1,
        optimal: 0.9,
      },
    },
    aggregation: {
      strategy: 'weighted_sum',
      missingPolicy: 'skip_renormalize',
    },
  };
}

function sampleMetricGraph(graphId: string, builtin = false): V4StoredMetricGraph {
  return {
    graphId,
    name: `指标图 ${graphId}`,
    version: '4.0.0',
    graphKind: 'metric',
    builtin,
    nodes: [
      {
        id: 'mn_1',
        kind: 'metric',
        label: '命中率',
        position: { x: 0, y: 0 },
        metricConfig: {
          metricId: 'weapon.munition_hit_rate',
          name: '命中率',
          militaryLevel: 'MOP',
          domainTag: 'firepower',
          mode: 'from_operator',
          sourceRef: 'weapon.munition_engagement_status',
          targetField: '命中',
          reduce: 'mean',
        },
      },
    ],
    edges: [],
  };
}

function sampleSystemDag(systemId: string, builtin = false): V4StoredSystemDag {
  return {
    systemId,
    name: `体系 DAG ${systemId}`,
    version: '4.0.0',
    metricGraphId: 'mg_builtin_1',
    terminalEffectNodeId: 'ef_1',
    builtin,
    nodes: [
      { id: 'px_1', kind: 'metric_proxy', label: '命中率', refId: 'weapon.munition_hit_rate', position: { x: 0, y: 0 } },
      { id: 'ef_1', kind: 'effect', label: '打击效果', refId: 'eff_builtin_1', position: { x: 300, y: 0 } },
    ],
    edges: [{ id: 'e_1', sourceNodeId: 'px_1', targetNodeId: 'ef_1' }],
  };
}

function sampleComponent(id: string, isBuiltin = false): ComponentManifest {
  return {
    id,
    name: `组件 ${id}`,
    version: '1.0.0',
    category: isBuiltin ? 'data_input' : 'custom',
    engine: 'V4 Test Engine',
    engineType: isBuiltin ? 'builtin' : 'python',
    description: 'V4 SQLite 单元测试组件',
    isBuiltin,
    isCustom: !isBuiltin,
    configSchema: {
      type: 'object',
      properties: {
        threshold: { type: 'number', default: 0.5 },
      },
    },
  };
}

test('V4 SQLite Store: 5 张 V4 新表 CRUD、内置隔离与 getStats 计数校验', () => {
  const store = new EvalSqliteStore(':memory:', { autoSeed: false });
  try {
    assert.equal(store.getSchemaVersion(), CURRENT_SCHEMA_VERSION);
    assert.equal(store.getLastBackupPath(), null);

    // 1. v4_operators CRUD
    store.upsertV4Operator(sampleOperator('v4.op.builtin', true), true);
    store.upsertV4Operator(sampleOperator('v4.op.custom', false), false);
    assert.equal(store.countV4Operators(), 2);
    assert.equal(store.countV4Operators({ builtinOnly: true }), 1);
    assert.equal(store.countV4Operators({ customOnly: true }), 1);
    assert.equal(store.getV4Operator('v4.op.custom')?.name, '算子 v4.op.custom');
    assert.equal(store.listV4Operators({ domainTag: 'firepower', layer: 'fact' }).length, 2);
    assert.equal(store.deleteV4Operator('v4.op.builtin'), false, '默认禁止删除内置算子');
    assert.equal(store.deleteV4Operator('v4.op.custom'), true);
    assert.equal(store.getV4Operator('v4.op.custom'), null);
    assert.equal(store.deleteV4Operator('v4.op.builtin', { allowBuiltin: true }), true);
    assert.equal(store.countV4Operators(), 0);

    // 2. v4_effects CRUD
    store.upsertV4Effect(sampleEffect('eff_builtin', 'effect', true), true);
    store.upsertV4Effect(sampleEffect('gate_custom', 'gate', false), false);
    assert.equal(store.countV4Effects(), 2);
    assert.equal(store.listV4Effects({ role: 'gate' }).length, 1);
    assert.equal(store.getV4Effect('gate_custom')?.gateMode, 'hard');
    assert.equal(store.deleteV4Effect('eff_builtin'), false);
    assert.equal(store.deleteV4Effect('gate_custom'), true);
    assert.equal(store.countV4Effects(), 1);

    // 3. v4_metric_graphs CRUD
    store.upsertV4MetricGraph(sampleMetricGraph('mg_builtin', true), true);
    store.upsertV4MetricGraph(sampleMetricGraph('mg_custom', false), false);
    assert.equal(store.countV4MetricGraphs(), 2);
    assert.equal(store.listV4MetricGraphs({ customOnly: true }).length, 1);
    assert.equal(store.getV4MetricGraph('mg_custom')?.graphKind, 'metric');
    assert.equal(store.deleteV4MetricGraph('mg_builtin'), false);
    assert.equal(store.deleteV4MetricGraph('mg_custom'), true);
    assert.equal(store.countV4MetricGraphs(), 1);

    // 4. v4_system_dags CRUD
    store.upsertV4SystemDag(sampleSystemDag('sys_builtin', true), true);
    store.upsertV4SystemDag(sampleSystemDag('sys_custom', false), false);
    assert.equal(store.countV4SystemDags(), 2);
    assert.equal(store.getV4SystemDag('sys_custom')?.metricGraphId, 'mg_builtin_1');
    assert.equal(store.deleteV4SystemDag('sys_builtin'), false);
    assert.equal(store.deleteV4SystemDag('sys_custom'), true);
    assert.equal(store.countV4SystemDags(), 1);

    // 5. v4_components CRUD
    store.upsertV4Component(sampleComponent('comp_builtin', true), true);
    store.upsertV4Component(sampleComponent('comp_custom', false), false);
    assert.equal(store.countV4Components(), 2);
    assert.equal(store.getV4Component('comp_custom')?.isCustom, true);
    assert.equal(store.deleteV4Component('comp_builtin'), false);
    assert.equal(store.deleteV4Component('comp_custom'), true);
    assert.equal(store.countV4Components(), 1);

    // 6. getStats 包含全部 V4 计数与原有兼容字段
    const stats = store.getStats();
    assert.equal(stats.counts.v4Operators, 0);
    assert.equal(stats.counts.v4Effects, 1);
    assert.equal(stats.counts.v4MetricGraphs, 1);
    assert.equal(stats.counts.v4SystemDags, 1);
    assert.equal(stats.counts.v4Components, 1);
    assert.equal(stats.counts.v4Evaluations, 0);
    assert.equal(typeof stats.counts.runs, 'number');
    assert.equal(typeof stats.counts.indicators, 'number');
    assert.equal(typeof stats.counts.systems, 'number');
  } finally {
    store.close();
  }
});

test('V4 SQLite Store: seedV4Libraries 严格尊重 is_blank=1 空白库隔离', () => {
  const store = new EvalSqliteStore(':memory:', { autoSeed: false });
  try {
    store.setMeta('is_blank', '1');
    const skippedRes = store.seedV4Libraries({
      operators: [sampleOperator('v4.op.1', true)],
      effects: [sampleEffect('eff_1', 'effect', true)],
      metricGraphs: [sampleMetricGraph('mg_1', true)],
      systemDags: [sampleSystemDag('sys_1', true)],
      components: [sampleComponent('comp_1', true)],
    });
    assert.equal(skippedRes.skipped, true);
    assert.equal(store.countV4Operators(), 0);
    assert.equal(store.countV4Effects(), 0);
    assert.equal(store.countV4MetricGraphs(), 0);
    assert.equal(store.countV4SystemDags(), 0);
    assert.equal(store.countV4Components(), 0);

    // 取消空白标记后可正常种子装载
    store.setMeta('is_blank', '0');
    const seededRes = store.seedV4Libraries({
      operators: [sampleOperator('v4.op.1', true)],
      effects: [sampleEffect('eff_1', 'effect', true)],
      metricGraphs: [sampleMetricGraph('mg_1', true)],
      systemDags: [sampleSystemDag('sys_1', true)],
      components: [sampleComponent('comp_1', true)],
    });
    assert.equal(seededRes.skipped, false);
    assert.deepEqual(seededRes.inserted, {
      operators: 1,
      effects: 1,
      metricGraphs: 1,
      systemDags: 1,
      components: 1,
    });
    assert.equal(store.countV4Operators(), 1);
    assert.equal(store.countV4Effects(), 1);
    assert.equal(store.countV4MetricGraphs(), 1);
    assert.equal(store.countV4SystemDags(), 1);
    assert.equal(store.countV4Components(), 1);
  } finally {
    store.close();
  }
});

test('V4 SQLite Store: 旧版 V2 库升级至 schema_version 4.0.0 时自动备份并完整保留推演/流水线数据', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-v4-sqlite-upgrade-'));
  const legacyDbPath = path.join(tmpDir, 'legacy-eval.db');

  try {
    // 1. 构造一个不含 schema_version 的模拟 V2 数据库（含旧版 eval_results 与 simulation_runs / operator_pipelines）
    const rawDb = new DatabaseSync(legacyDbPath);
    rawDb.exec(`
      CREATE TABLE store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO store_meta (key, value) VALUES ('is_initialized', '1'), ('is_seeded', '1'), ('is_blank', '0');

      CREATE TABLE simulation_runs (
        run_id TEXT PRIMARY KEY,
        scenario_name TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        scenario_path TEXT NOT NULL,
        timeline_id TEXT,
        start_clock TEXT NOT NULL,
        end_clock TEXT NOT NULL,
        total_game_seconds REAL NOT NULL,
        sides_json TEXT NOT NULL,
        coverage_json TEXT NOT NULL,
        unit_count INTEGER NOT NULL,
        event_count INTEGER NOT NULL,
        situation_snapshot_json TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );
      INSERT INTO simulation_runs VALUES (
        'run_legacy_1', 'Legacy Scenario', 'event_csv', '/tmp/csv', NULL,
        '00:00:00', '00:10:00', 600, '["Red","Blue"]', '{}', 4, 12,
        '{"model":{"runId":"run_legacy_1","units":[],"contacts":[],"events":[]}}',
        '2026-01-01T00:00:00Z'
      );

      CREATE TABLE operator_pipelines (
        operator_id TEXT PRIMARY KEY,
        pipeline_title TEXT NOT NULL,
        nodes_json TEXT NOT NULL,
        edges_json TEXT NOT NULL,
        dataset_json TEXT,
        updated_at TEXT NOT NULL
      );
      INSERT INTO operator_pipelines VALUES (
        'strike.damage_simulation', '毁伤仿真流水线', '[]', '[]', NULL, '2026-01-01T00:00:00Z'
      );

      CREATE TABLE eval_results (
        eval_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        system_id TEXT NOT NULL,
        system_name TEXT NOT NULL,
        system_version TEXT NOT NULL,
        overall_score REAL,
        overall_confidence TEXT NOT NULL,
        available_weight_ratio REAL NOT NULL,
        dimensions_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        report_md TEXT NOT NULL,
        feedback_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO eval_results VALUES (
        'eval_v2_1', 'run_legacy_1', 'sys_v2', 'Legacy Sys', '1.0.0',
        88.5, 'high', 1.0, '[]', '{}', '# report', '{}', '2026-01-01T00:00:00Z'
      );
    `);
    rawDb.close();

    // 2. 用 EvalSqliteStore 打开：应触发自动备份并升级 schema_version 至 4.0.0
    const upgraded = new EvalSqliteStore(legacyDbPath, { autoSeed: false });
    const backupPath = upgraded.getLastBackupPath();
    assert.ok(backupPath, '升级含旧数据的 V2 库时必须生成 .v2-backup-*.bak 备份文件');
    assert.match(path.basename(backupPath), /^legacy-eval\.db\.v2-backup-.*\.bak$/);
    assert.equal(fs.existsSync(backupPath), true);
    assert.equal(upgraded.getSchemaVersion(), CURRENT_SCHEMA_VERSION);

    // 3. 验证既有 simulation_runs 与 operator_pipelines 原地保留
    assert.equal(upgraded.listRuns().length, 1);
    assert.equal(upgraded.listRuns()[0].runId, 'run_legacy_1');
    assert.equal(upgraded.getOperatorPipeline('strike.damage_simulation')?.pipelineTitle, '毁伤仿真流水线');

    // 4. 验证新 V4 表可用
    upgraded.upsertV4Operator(sampleOperator('v4.op.after_upgrade', true), true);
    assert.equal(upgraded.countV4Operators(), 1);
    upgraded.close();

    // 5. 再次打开已升级到 4.0.0 的库：不应重复生成新的备份文件
    const reopened = new EvalSqliteStore(legacyDbPath, { autoSeed: false });
    assert.equal(reopened.getLastBackupPath(), null, '已是 4.0.0 的库再次打开不应重复备份');
    assert.equal(reopened.getSchemaVersion(), CURRENT_SCHEMA_VERSION);
    assert.equal(reopened.countV4Operators(), 1);
    reopened.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Phase 2b Stores: EffectStore / SystemDagStore / ComponentRegistryStore / V4OperatorStore 绑定 SQLite、rebindSqliteStore 与空白库隔离', () => {
  const dbMain = new EvalSqliteStore(':memory:', { autoSeed: false });
  const dbBlank = new EvalSqliteStore(':memory:', { autoSeed: false });
  dbBlank.setMeta('is_blank', '1');

  try {
    // 1. EffectStore bound to SQLite
    const effStore = new EffectStore(dbMain);
    assert.ok(effStore.listAll().length >= 10, '非空白库应自动种子装载内置效果预设');
    effStore.upsertCustom(sampleEffect('eff_sqlite_custom_1', 'effect', false));
    assert.ok(dbMain.getV4Effect('eff_sqlite_custom_1'), '自定义效果应写入 v4_effects 表');

    effStore.rebindSqliteStore(dbBlank);
    assert.equal(effStore.listAll().length, 0, '切换至 is_blank=1 空白库时 EffectStore 必须返回空数组');
    effStore.rebindSqliteStore(dbMain);
    assert.ok(effStore.get('eff_sqlite_custom_1'), '切回主库应恢复自定义效果');

    // 2. SystemDagStore bound to SQLite
    const dagStore = new SystemDagStore(dbMain, effStore);
    assert.ok(dagStore.listAll().length >= 2, '非空白库应自动种子装载内置体系 DAG');
    const customDag = sampleSystemDag('sys_sqlite_custom_1', false);
    customDag.nodes[1].refId = 'eff_strike_mission';
    dagStore.upsert(customDag);
    assert.ok(dbMain.getV4SystemDag('sys_sqlite_custom_1'), '自定义体系 DAG 应写入 v4_system_dags 表');

    dagStore.rebindSqliteStore(dbBlank);
    assert.equal(dagStore.listAll().length, 0, '切换至空白库时 SystemDagStore 必须返回空数组');
    dagStore.rebindSqliteStore(dbMain);
    assert.ok(dagStore.get('sys_sqlite_custom_1'));

    // 3. ComponentRegistryStore bound to SQLite
    const compStore = new ComponentRegistryStore(dbMain);
    assert.ok(compStore.list().length >= 6, '非空白库应自动种子装载内置组件');
    compStore.import(sampleComponent('comp_sqlite_custom_1', false));
    assert.ok(dbMain.getV4Component('comp_sqlite_custom_1'), '自定义组件应写入 v4_components 表');

    compStore.rebindSqliteStore(dbBlank);
    assert.equal(compStore.list().length, 0, '切换至空白库时 ComponentRegistryStore 必须返回空数组');
    compStore.rebindSqliteStore(dbMain);
    assert.ok(compStore.get('comp_sqlite_custom_1'));

    // 4. V4OperatorStore bound to SQLite + update / resetOverride / blank DB
    const opStore = new V4OperatorStore(dbMain);
    const allOps = opStore.list();
    assert.ok(allOps.length >= 40, `V4OperatorStore 应种子装载内置 V4 算子，实际=${allOps.length}`);
    const firstBuiltin = allOps[0];
    const origName = firstBuiltin.name;

    const updated = opStore.update(firstBuiltin.id, { name: `${origName} (已修改)` });
    assert.equal(updated.name, `${origName} (已修改)`);
    assert.equal(dbMain.getV4Operator(firstBuiltin.id)?.name, `${origName} (已修改)`);

    const reset = opStore.resetOverride(firstBuiltin.id);
    assert.equal(reset.name, origName, 'resetOverride 应恢复内置模板原始定义');

    opStore.upsert(sampleOperator('custom.v4.sqlite_op', false), false);
    assert.ok(opStore.get('custom.v4.sqlite_op'));
    assert.equal(opStore.delete('custom.v4.sqlite_op'), true);
    assert.throws(() => opStore.delete(firstBuiltin.id), /不允许删除内置 V4 算子/);

    opStore.rebindSqliteStore(dbBlank);
    assert.equal(opStore.list().length, 0, '切换至空白库时 V4OperatorStore 必须返回空数组');
    assert.equal(opStore.seedBuiltins(), 0, '空白库调用 seedBuiltins 应被跳过');
  } finally {
    dbMain.close();
    dbBlank.close();
  }
});

test('V4 Routes: V4OperatorStore CRUD/覆写重置、空白库隔离与 preview-curve / draft-nl / objective-weights 能力对等', async () => {
  const dbMain = new EvalSqliteStore(':memory:', { autoSeed: false });
  const dbBlank = new EvalSqliteStore(':memory:', { autoSeed: false });
  dbBlank.setMeta('is_blank', '1');

  const effectStore = new EffectStore(dbMain);
  const metricGraphStore = new MetricGraphStore(path.join(os.tmpdir(), `v4-mg-unused-${Date.now()}.json`));
  const systemDagStore = new SystemDagStore(dbMain, effectStore);
  const v4OperatorStore = new V4OperatorStore(dbMain);

  const deps: V4RouteDeps = {
    effectStore,
    metricGraphStore,
    systemDagStore,
    v4OperatorStore,
    listOperators: () => v4OperatorStore.list(),
    getEvalStore: () => dbMain,
    runOperator: async () => {
      throw new Error('should not fall back to mock runOperator when v4OperatorStore is bound');
    },
  };

  const readJson = async (req: http.IncomingMessage): Promise<Record<string, unknown>> => {
    const chunks: Buffer[] = [];
    for await (const ch of req) chunks.push(Buffer.isBuffer(ch) ? ch : Buffer.from(ch));
    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  };
  const sendJson = (res: http.ServerResponse, status: number, payload: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const handled = await handleV4ApiRequest(
      req,
      res,
      decodeURIComponent(url.pathname),
      readJson,
      sendJson,
      deps,
    );
    if (!handled) sendJson(res, 404, { ok: false, error: 'Not Found' });
  });

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /api/v4/operators with filters
    const listRes = await fetch(`${baseUrl}/api/v4/operators?domain=firepower&search=strike`);
    assert.equal(listRes.status, 200);
    const listJson = (await listRes.json()) as { ok: boolean; operators: Array<{ id: string }> };
    assert.equal(listJson.ok, true);
    assert.ok(listJson.operators.length >= 1);
    assert.ok(listJson.operators.every((o) => o.id.includes('strike')));

    // 2. POST /api/v4/operators rejects unsafe code
    const badRes = await fetch(`${baseUrl}/api/v4/operators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...sampleOperator('custom.unsafe_op', false),
        pythonCode: 'import os\ndef compute(d, p): return []',
      }),
    });
    assert.equal(badRes.status, 400);

    // 3. POST / GET / PUT / DELETE custom operator
    const createRes = await fetch(`${baseUrl}/api/v4/operators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sampleOperator('custom.route_test_op', false)),
    });
    assert.equal(createRes.status, 200);

    const getRes = await fetch(`${baseUrl}/api/v4/operators/custom.route_test_op`);
    assert.equal(getRes.status, 200);

    const putRes = await fetch(`${baseUrl}/api/v4/operators/custom.route_test_op`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '更新后的路由算子' }),
    });
    assert.equal(putRes.status, 200);
    const putJson = (await putRes.json()) as { operator: { name: string } };
    assert.equal(putJson.operator.name, '更新后的路由算子');

    const delRes = await fetch(`${baseUrl}/api/v4/operators/custom.route_test_op`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);

    // 4. Builtin override & reset
    const builtinId = v4OperatorStore.list({ builtinOnly: true })[0].id;
    const origName = v4OperatorStore.get(builtinId)!.name;
    await fetch(`${baseUrl}/api/v4/operators/${encodeURIComponent(builtinId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${origName}-覆写` }),
    });
    const delBuiltinRes = await fetch(`${baseUrl}/api/v4/operators/${encodeURIComponent(builtinId)}`, {
      method: 'DELETE',
    });
    assert.equal(delBuiltinRes.status, 403);

    const resetRes = await fetch(`${baseUrl}/api/v4/operators/${encodeURIComponent(builtinId)}/override`, {
      method: 'DELETE',
    });
    assert.equal(resetRes.status, 200);
    const resetJson = (await resetRes.json()) as { operator: { name: string } };
    assert.equal(resetJson.operator.name, origName);

    // 5. POST /api/v4/effects/preview-curve
    const curveRes = await fetch(`${baseUrl}/api/v4/effects/preview-curve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scoringRule: { type: 'larger_is_better', worst: 0.2, optimal: 0.9 },
        samples: 10,
      }),
    });
    assert.equal(curveRes.status, 200);
    const curveJson = (await curveRes.json()) as { ok: boolean; points: Array<{ x: number; score: number }> };
    assert.equal(curveJson.ok, true);
    assert.ok(curveJson.points.length >= 10);

    // 6. POST /api/v4/system-dags/draft-nl
    const draftRes = await fetch(`${baseUrl}/api/v4/system-dags/draft-nl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '面向超视距空战突击、防空拦截与友军误伤红线的综合评估体系',
      }),
    });
    assert.equal(draftRes.status, 200);
    const draftJson = (await draftRes.json()) as {
      ok: boolean;
      system: { systemId: string; nodes: unknown[]; edges: unknown[] };
      validation: { valid: boolean; errors: string[] };
    };
    assert.equal(draftJson.ok, true);
    assert.equal(draftJson.validation.valid, true, `draft-nl 草案校验应通过: ${draftJson.validation.errors.join('; ')}`);

    // 7. POST /api/v4/system-dags/objective-weights (direct matrix)
    const owRes = await fetch(`${baseUrl}/api/v4/system-dags/objective-weights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'entropy',
        matrix: [
          [85, 70, 92],
          [60, 88, 75],
          [92, 65, 80],
        ],
        criterionNames: ['火力打击', '侦察预警', '机动生存'],
      }),
    });
    assert.equal(owRes.status, 200);
    const owJson = (await owRes.json()) as { ok: boolean; weights: number[] };
    assert.equal(owJson.ok, true);
    assert.equal(owJson.weights.length, 3);
    const sumW = owJson.weights.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sumW - 1) < 0.01, `权重和应约等于 1，实际=${sumW}`);

    // 8. Blank DB isolation via GET /api/v4/operators
    v4OperatorStore.rebindSqliteStore(dbBlank);
    const blankRes = await fetch(`${baseUrl}/api/v4/operators`);
    const blankJson = (await blankRes.json()) as { operators: unknown[] };
    assert.equal(blankJson.operators.length, 0);
  } finally {
    server.close();
    dbMain.close();
    dbBlank.close();
  }
});
