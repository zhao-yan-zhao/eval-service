import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  EvalSqliteStore,
  cloneDatabaseFile,
  listAvailableDatabases,
} from '../src/adapters/sqlite-store.ts';
import { EffectStore } from '../src/effects/store.ts';
import { MetricGraphStore } from '../src/indicators/metric-graph-store.ts';
import { V4OperatorStore } from '../src/operators/v4/store.ts';
import { SystemDagStore } from '../src/systems/system-dag-store.ts';
import { createEvalApp } from '../src/server.ts';

function safeCleanDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // 兼容 Windows 临时目录延迟释放
  }
}

test('Stage 21.1 - 数据库底层隔离：listAvailableDatabases 与 cloneDatabaseFile 物理文件流转', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-db-test-'));
  try {
    const db1Path = path.join(tmpDir, 'test1.db');
    const db2Path = path.join(tmpDir, 'test2.db');

    const store1 = new EvalSqliteStore(db1Path);
    store1.close();

    const dbsBefore = listAvailableDatabases(tmpDir, db1Path);
    assert.equal(dbsBefore.length, 1);
    assert.equal(dbsBefore[0].filename, 'test1.db');
    assert.equal(dbsBefore[0].isActive, true);

    cloneDatabaseFile(db1Path, db2Path);
    const dbsAfter = listAvailableDatabases(tmpDir, db2Path);
    assert.equal(dbsAfter.length, 2);
    const active = dbsAfter.find((d) => d.isActive);
    assert.ok(active);
    assert.equal(active.filename, 'test2.db');
  } finally {
    safeCleanDir(tmpDir);
  }
});

test('Stage 21.2 (V4) - V4 三库仓储动态重绑定 (rebindSqliteStore)：场景算子/效果/指标图隔离无污染', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-rebind-v4-test-'));
  try {
    const storeA = new EvalSqliteStore(path.join(tmpDir, 'scenario-a.db'));
    const storeB = new EvalSqliteStore(path.join(tmpDir, 'scenario-b.db'));

    const opStore = new V4OperatorStore(storeA);
    const effStore = new EffectStore(storeA);
    const mgStore = new MetricGraphStore('', { sqliteStore: storeA });
    const sdStore = new SystemDagStore(storeA, effStore);

    // 1. 在场景 A 创建自定义 V4 算子与效果
    opStore.upsert(
      {
        id: 'custom.scenario_a_v4_op',
        name: '场景A-V4算子',
        chapter: 8,
        category: 'effectiveness',
        militaryLevel: 'MOP',
        domainTag: 'firepower',
        description: '场景A隔离测试',
        requiredTables: ['WeaponFired'],
        parameterPorts: [],
        outputColumns: ['分方', 'val'],
        pythonCode: 'import pandas as pd\noutput_df = pd.DataFrame([{"分方": "红方", "val": 1}])',
      },
      false,
    );
    effStore.upsertCustom({
      effectId: 'eff_scenario_a_custom',
      name: '场景A效果',
      role: 'effect',
      domainTag: 'firepower',
      metricBinding: {
        metricId: 'isr.detection_rate',
        reduce: 'mean',
        scoringRule: { type: 'larger_is_better', optimal: 1, worst: 0 },
      },
      aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
    });
    assert.ok(opStore.get('custom.scenario_a_v4_op'));
    assert.ok(effStore.get('eff_scenario_a_custom'));

    // 2. 动态切换至场景 B
    opStore.rebindSqliteStore(storeB);
    effStore.rebindSqliteStore(storeB);
    mgStore.rebindSqliteStore(storeB);
    sdStore.rebindSqliteStore(storeB);

    assert.equal(opStore.get('custom.scenario_a_v4_op'), null);
    assert.equal(effStore.get('eff_scenario_a_custom'), undefined);

    // 3. 在场景 B 创建专属 V4 算子
    opStore.upsert(
      {
        id: 'custom.scenario_b_v4_op',
        name: '场景B-V4算子',
        chapter: 8,
        category: 'situation',
        militaryLevel: 'MOP',
        domainTag: 'isr',
        description: '场景B隔离测试',
        requiredTables: ['UnitCreated'],
        parameterPorts: [],
        outputColumns: ['分方', 'val'],
        pythonCode: 'import pandas as pd\noutput_df = pd.DataFrame([{"分方": "红方", "val": 2}])',
      },
      false,
    );
    assert.ok(opStore.get('custom.scenario_b_v4_op'));

    // 4. 切回场景 A，数据完整恢复且无污染
    opStore.rebindSqliteStore(storeA);
    effStore.rebindSqliteStore(storeA);
    assert.ok(opStore.get('custom.scenario_a_v4_op'));
    assert.equal(opStore.get('custom.scenario_b_v4_op'), null);
    assert.ok(effStore.get('eff_scenario_a_custom'));

    storeA.close();
    storeB.close();
  } finally {
    safeCleanDir(tmpDir);
  }
});

test('Stage 21.3 (V4) - 端到端 REST API：数据库热切换、新建、克隆与导出闭环 (/api/v4/* 验证)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-e2e-db-v4-'));
  const initialDbPath = path.join(tmpDir, 'initial.db');

  const app = await createEvalApp({
    dbPath: initialDbPath,
    autoSeed: false,
  });

  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', () => resolve()));
  const port = (app.server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /api/db/current
    const currJson = (await fetch(`${baseUrl}/api/db/current`).then((r) => r.json())) as {
      ok: boolean;
      current: string;
    };
    assert.equal(currJson.ok, true);
    assert.equal(currJson.current, 'initial.db');

    // 2. POST /api/db/create - scenario-alpha
    const alphaDbPath = path.join(tmpDir, 'scenario-alpha.db');
    const createAlphaRes = await fetch(`${baseUrl}/api/db/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dbName: alphaDbPath, switchNow: true }),
    });
    assert.equal(createAlphaRes.status, 200);
    const createAlphaJson = (await createAlphaRes.json()) as {
      ok: boolean;
      switched: boolean;
      activeDb: string;
    };
    assert.equal(createAlphaJson.ok, true);
    assert.equal(createAlphaJson.switched, true);
    assert.equal(createAlphaJson.activeDb, 'scenario-alpha.db');

    // 3. 在 scenario-alpha 中创建自定义 V4 算子
    const opRes = await fetch(`${baseUrl}/api/v4/operators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'custom.alpha_v4_fire_rate',
        name: 'Alpha想定V4发射率',
        chapter: 8,
        category: 'effectiveness',
        militaryLevel: 'MOP',
        domainTag: 'firepower',
        description: 'Alpha库自定义V4算子',
        requiredTables: ['WeaponFired'],
        parameterPorts: [],
        outputColumns: ['分方', 'rate'],
        pythonCode: 'import pandas as pd\noutput_df = pd.DataFrame([{"分方": "红方", "rate": 1.0}])',
      }),
    });
    assert.equal(opRes.status, 200);

    const listAlpha = (await fetch(`${baseUrl}/api/v4/operators?layer=all`).then((r) =>
      r.json(),
    )) as { operators: Array<{ id: string }> };
    assert.ok(listAlpha.operators.some((o) => o.id === 'custom.alpha_v4_fire_rate'));

    // 4. POST /api/db/create - scenario-beta (隔离验证)
    const betaDbPath = path.join(tmpDir, 'scenario-beta.db');
    const createBetaRes = await fetch(`${baseUrl}/api/db/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dbName: betaDbPath, switchNow: true }),
    });
    assert.equal(createBetaRes.status, 200);

    const listBeta = (await fetch(`${baseUrl}/api/v4/operators?layer=all`).then((r) =>
      r.json(),
    )) as { operators: Array<{ id: string }> };
    assert.equal(listBeta.operators.some((o) => o.id === 'custom.alpha_v4_fire_rate'), false);

    // 5. POST /api/db/switch - 切回 scenario-alpha
    const switchBackRes = await fetch(`${baseUrl}/api/db/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dbPath: alphaDbPath }),
    });
    assert.equal(switchBackRes.status, 200);
    const listAlphaAgain = (await fetch(`${baseUrl}/api/v4/operators?layer=all`).then((r) =>
      r.json(),
    )) as { operators: Array<{ id: string }> };
    assert.ok(listAlphaAgain.operators.some((o) => o.id === 'custom.alpha_v4_fire_rate'));

    // 6. POST /api/db/clone - 克隆并验证继承
    const backupDbPath = path.join(tmpDir, 'scenario-alpha-backup.db');
    const cloneRes = await fetch(`${baseUrl}/api/db/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetDbName: backupDbPath, switchNow: true }),
    });
    assert.equal(cloneRes.status, 200);
    const listClone = (await fetch(`${baseUrl}/api/v4/operators?layer=all`).then((r) =>
      r.json(),
    )) as { operators: Array<{ id: string }> };
    assert.ok(listClone.operators.some((o) => o.id === 'custom.alpha_v4_fire_rate'));

    // 7. GET /api/db/export - 导出二进制流
    const exportRes = await fetch(`${baseUrl}/api/db/export`);
    assert.equal(exportRes.status, 200);
    assert.equal(exportRes.headers.get('content-type'), 'application/vnd.sqlite3');
    const arrayBuffer = await exportRes.arrayBuffer();
    const headerStr = Buffer.from(arrayBuffer.slice(0, 16)).toString('utf-8');
    assert.ok(headerStr.startsWith('SQLite format 3'));
  } finally {
    await app.close();
    safeCleanDir(tmpDir);
  }
});
