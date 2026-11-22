import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEvalApp } from '../src/server.ts';
import { extractRunTableDataset } from '../src/operators/pipeline-utils.ts';
import type { TableDataset } from '../src/core/types.ts';

test('Stage 26：算子试运算挂载真实场景数据 (extractRunTableDataset & /api/runs/:runId/table-data)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stage26-'));
  const app = await createEvalApp({
    dbPath: path.join(tmpDir, 'eval.db'),
    customIndicatorsPath: path.join(tmpDir, 'custom-ind.json'),
    customSystemsPath: path.join(tmpDir, 'custom-sys.json'),
    autoSeed: true,
  });

  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1) 验证 extractRunTableDataset 纯函数能力
    const sit = app.sqliteStore.getRunSituation('gj11_pl15_bvr_real');
    assert.ok(sit, '应能获取 gj11_pl15_bvr_real 场景');

    // 1.1) 提取存在的底表 WeaponFired.csv
    const weaponFiredRes = extractRunTableDataset(sit, 'WeaponFired.csv');
    assert.equal(weaponFiredRes.found, true);
    assert.ok(weaponFiredRes.dataset);
    assert.equal(weaponFiredRes.dataset.isRealData, true);
    assert.equal(weaponFiredRes.dataset.sourceRunId, 'gj11_pl15_bvr_real');
    assert.ok(weaponFiredRes.dataset.rows.length > 0);
    assert.ok(weaponFiredRes.dataset.columns.length > 0);

    // 1.2) 提取不存在的底表，严格 Fail-Closed，绝不编造
    const missingRes = extractRunTableDataset(sit, 'NonExistentTable.csv');
    assert.equal(missingRes.found, false);
    assert.ok(missingRes.reason?.includes('未发现事件底表'));

    // 1.3) 阵营过滤测试
    const redRes = extractRunTableDataset(sit, 'WeaponFired.csv', {
      filterField: 'Side',
      filterEquals: 'Red',
    });
    assert.equal(redRes.found, true);
    assert.ok(redRes.dataset);

    // 2) 验证 REST API: GET /api/runs/:runId/table-data
    // 2.1) 真实场景真实底表提取
    const apiRes = await fetch(`${baseUrl}/api/runs/gj11_pl15_bvr_real/table-data?tableName=WeaponFired.csv`);
    assert.equal(apiRes.status, 200);
    const apiJson = (await apiRes.json()) as {
      ok: boolean;
      found: boolean;
      dataset?: TableDataset & { isRealData?: boolean };
      scenarioName?: string;
    };
    assert.equal(apiJson.ok, true);
    assert.equal(apiJson.found, true);
    assert.ok(apiJson.dataset);
    assert.equal(apiJson.dataset.isRealData, true);
    assert.ok(apiJson.dataset.rows.length > 0);

    // 2.2) 缺表场景验证 Fail-Closed
    const missingApiRes = await fetch(`${baseUrl}/api/runs/gj11_pl15_bvr_real/table-data?tableName=NoSuchTable.csv`);
    assert.equal(missingApiRes.status, 200);
    const missingJson = await missingApiRes.json();
    assert.equal(missingJson.ok, true);
    assert.equal(missingJson.found, false);
    assert.ok(missingJson.reason?.includes('未发现事件底表'));

    // 2.3) 不存在的 runId 返回 404
    const notFoundRunRes = await fetch(`${baseUrl}/api/runs/no_such_run_12345/table-data?tableName=WeaponFired.csv`);
    assert.equal(notFoundRunRes.status, 404);
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
