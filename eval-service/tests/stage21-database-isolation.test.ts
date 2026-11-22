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
import { CustomOperatorStore } from '../src/operators/custom-store.ts';
import { OperatorOverrideStore } from '../src/operators/override-store.ts';
import { IndicatorStore } from '../src/indicators/store.ts';
import { SystemStore } from '../src/systems/store.ts';
import { createEvalApp } from '../src/server.ts';
import {
  CustomOperatorDefinition,
  IndicatorDefinition,
  IndicatorSystem,
} from '../src/core/types.ts';
import { BUILTIN_OPERATOR_IDS } from '../src/operators/registry.ts';

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

test('Stage 21.2 - 内存仓储动态重绑定 (rebindSqliteStore)：场景算子与指标隔离无污染', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-rebind-test-'));
  try {
    const dbAPath = path.join(tmpDir, 'scenario-a.db');
    const dbBPath = path.join(tmpDir, 'scenario-b.db');

    const storeA = new EvalSqliteStore(dbAPath);
    const storeB = new EvalSqliteStore(dbBPath);

    const customStore = new CustomOperatorStore('', storeA);
    const overrideStore = new OperatorOverrideStore('', storeA);
    const indStore = new IndicatorStore('', () => true, storeA);
    const sysStore = new SystemStore('', indStore, storeA);

    // 1. 在场景 A 中创建自定义算子与指标
    const opA: CustomOperatorDefinition = {
      id: 'custom.scenario_a_weapon_eff',
      name: '场景A-专属拦截效能',
      category: 'effectiveness',
      mode: 'formula',
      expression: 'v1 * 2',
      variables: [{ alias: 'v1', atomRef: 'roe.corridor_spatial_compliance' }],
      outputType: 'score',
      defaultOptimalDirection: 'larger_is_better',
      unit: '%',
    };
    customStore.upsert(opA, BUILTIN_OPERATOR_IDS, BUILTIN_OPERATOR_IDS);
    assert.ok(customStore.has('custom.scenario_a_weapon_eff'));

    const indA: IndicatorDefinition = {
      indicatorId: 'ind_scenario_a_custom',
      name: '场景A指标',
      category: 'effectiveness',
      atomRef: 'custom.scenario_a_weapon_eff',
      scoring: { type: 'larger_is_better', optimal: 100, worst: 0 },
    };
    indStore.upsertCustom(indA);
    assert.ok(indStore.get('ind_scenario_a_custom'));

    // 2. 动态切换绑定至场景 B
    customStore.rebindSqliteStore(storeB);
    overrideStore.rebindSqliteStore(storeB);
    indStore.rebindSqliteStore(storeB);
    sysStore.rebindSqliteStore(storeB);

    // 验证场景 B 中没有场景 A 的算子与自定义指标（严格数据隔离）
    assert.equal(customStore.has('custom.scenario_a_weapon_eff'), false);
    assert.equal(indStore.get('ind_scenario_a_custom'), undefined);

    // 3. 在场景 B 中创建专属算子
    const opB: CustomOperatorDefinition = {
      id: 'custom.scenario_b_radar_sweep',
      name: '场景B-雷达快捕',
      category: 'situation',
      mode: 'formula',
      expression: 'v1 + 10',
      variables: [{ alias: 'v1', atomRef: 'roe.corridor_spatial_compliance' }],
      outputType: 'score',
      defaultOptimalDirection: 'larger_is_better',
      unit: 'km',
    };
    customStore.upsert(opB, BUILTIN_OPERATOR_IDS, BUILTIN_OPERATOR_IDS);
    assert.ok(customStore.has('custom.scenario_b_radar_sweep'));

    // 4. 再次切回场景 A
    customStore.rebindSqliteStore(storeA);
    indStore.rebindSqliteStore(storeA);

    // 验证场景 A 数据完整恢复，且不受场景 B 污染
    assert.ok(customStore.has('custom.scenario_a_weapon_eff'));
    assert.equal(customStore.has('custom.scenario_b_radar_sweep'), false);
    assert.ok(indStore.get('ind_scenario_a_custom'));

    storeA.close();
    storeB.close();
  } finally {
    safeCleanDir(tmpDir);
  }
});

test('Stage 21.3 - 端到端 REST API：数据库热切换、新建、克隆与导出闭环', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-e2e-db-'));
  const initialDbPath = path.join(tmpDir, 'initial.db');

  const app = await createEvalApp({
    dbPath: initialDbPath,
    customOperatorsPath: path.join(tmpDir, 'custom-operators.json'),
    operatorOverridesPath: path.join(tmpDir, 'operator-overrides.json'),
    operatorPipelinesPath: path.join(tmpDir, 'operator-pipelines.json'),
    customIndicatorsPath: path.join(tmpDir, 'custom-indicators.json'),
    customSystemsPath: path.join(tmpDir, 'custom-systems.json'),
    autoSeed: false,
  });

  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', () => resolve()));
  const port = (app.server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /api/db/current
    const currRes = await fetch(`${baseUrl}/api/db/current`);
    assert.equal(currRes.status, 200);
    const currJson = (await currRes.json()) as any;
    assert.equal(currJson.ok, true);
    assert.equal(currJson.current, 'initial.db');
    assert.equal(currJson.builtinOperatorsCount, 41);

    // 2. POST /api/db/create - 创建新场景库 scenario-alpha 并立即热切换
    const alphaDbPath = path.join(tmpDir, 'scenario-alpha.db');
    const createAlphaRes = await fetch(`${baseUrl}/api/db/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dbName: alphaDbPath, switchNow: true }),
    });
    assert.equal(createAlphaRes.status, 200);
    const createAlphaJson = (await createAlphaRes.json()) as any;
    assert.equal(createAlphaJson.ok, true);
    assert.equal(createAlphaJson.switched, true);
    assert.equal(createAlphaJson.activeDb, 'scenario-alpha.db');

    // 3. 在 scenario-alpha 中创建自定义算子
    const opRes = await fetch(`${baseUrl}/api/operators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'custom.alpha_fire_rate',
        name: 'Alpha想定发射率',
        category: 'effectiveness',
        mode: 'formula',
        expression: 'v1 * 3',
        variables: [{ alias: 'v1', atomRef: 'roe.corridor_spatial_compliance' }],
        outputType: 'score',
        defaultOptimalDirection: 'larger_is_better',
      }),
    });
    assert.equal(opRes.status, 200);

    // 验证自定义算子在 alpha 库中存在
    const listAlphaOpsRes = await fetch(`${baseUrl}/api/operators`);
    const listAlphaOps = (await listAlphaOpsRes.json()) as any;
    assert.ok(listAlphaOps.operators.some((o: any) => o.id === 'custom.alpha_fire_rate'));

    // 4. POST /api/db/create - 创建新场景库 scenario-beta 并立即热切换
    const betaDbPath = path.join(tmpDir, 'scenario-beta.db');
    const createBetaRes = await fetch(`${baseUrl}/api/db/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dbName: betaDbPath, switchNow: true }),
    });
    assert.equal(createBetaRes.status, 200);

    // 验证 scenario-beta 中没有 alpha 的算子（数据隔离成功）
    const listBetaOpsRes = await fetch(`${baseUrl}/api/operators`);
    const listBetaOps = (await listBetaOpsRes.json()) as any;
    assert.equal(listBetaOps.operators.some((o: any) => o.id === 'custom.alpha_fire_rate'), false);

    // 5. POST /api/db/switch - 切回 scenario-alpha
    const switchBackRes = await fetch(`${baseUrl}/api/db/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dbPath: alphaDbPath }),
    });
    assert.equal(switchBackRes.status, 200);
    const switchBackJson = (await switchBackRes.json()) as any;
    assert.equal(switchBackJson.activeDb, 'scenario-alpha.db');

    // 验证 alpha 专属算子恢复呈现
    const listAlphaAgain = (await (await fetch(`${baseUrl}/api/operators`)).json()) as any;
    assert.ok(listAlphaAgain.operators.some((o: any) => o.id === 'custom.alpha_fire_rate'));

    // 6. POST /api/db/clone - 将当前 alpha 克隆为 scenario-alpha-backup
    const backupDbPath = path.join(tmpDir, 'scenario-alpha-backup.db');
    const cloneRes = await fetch(`${baseUrl}/api/db/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetDbName: backupDbPath, switchNow: true }),
    });
    assert.equal(cloneRes.status, 200);
    const cloneJson = (await cloneRes.json()) as any;
    assert.equal(cloneJson.switched, true);
    assert.equal(cloneJson.activeDb, 'scenario-alpha-backup.db');

    // 验证克隆库继承了全部算子数据
    const listCloneOps = (await (await fetch(`${baseUrl}/api/operators`)).json()) as any;
    assert.ok(listCloneOps.operators.some((o: any) => o.id === 'custom.alpha_fire_rate'));

    // 7. GET /api/db/export - 导出当前数据库二进制流
    const exportRes = await fetch(`${baseUrl}/api/db/export`);
    assert.equal(exportRes.status, 200);
    assert.equal(exportRes.headers.get('content-type'), 'application/vnd.sqlite3');
    const arrayBuffer = await exportRes.arrayBuffer();
    const headerStr = Buffer.from(arrayBuffer.slice(0, 16)).toString('utf-8');
    assert.ok(headerStr.startsWith('SQLite format 3'), '导出的文件必须为标准 SQLite 二进制格式');
  } finally {
    await app.close();
    safeCleanDir(tmpDir);
  }
});