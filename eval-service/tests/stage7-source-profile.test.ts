import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { RunSourceProfile } from '../src/core/types.ts';
import { createEvalApp } from '../src/server.ts';

test('Stage 7：离线 CSV 44 表对账、前 50 行预览、BS JSONL 7 族路径统计与路径安全守卫', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stage7-'));
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
    // 1) GJ11-PL15 CSV 离线产物对照 44 标准事件
    const gjRes = await fetch(`${baseUrl}/api/runs/gj11_pl15_bvr_real/source-profile`);
    assert.equal(gjRes.status, 200);
    const gjJson = (await gjRes.json()) as { ok: boolean; profile: RunSourceProfile };
    assert.equal(gjJson.ok, true);

    const gj = gjJson.profile;
    assert.equal(gj.runMeta.sourceAvailable, true);
    assert.equal(gj.runMeta.totalCatalogEvents, 44);
    assert.equal(gj.csvProfile.dirExists, true);
    assert.equal(gj.csvProfile.discoveredFileCount, 11);
    assert.equal(gj.csvProfile.bomFilesCount, 11);
    assert.equal(gj.csvProfile.maxBomCount, 2);
    assert.equal(gj.csvProfile.tables.length, 44);

    const summary = gj.csvProfile.statusSummary;
    assert.equal(summary.activeWithRows, 11);
    assert.equal(summary.emptyHeaderOnly, 0);
    assert.equal(summary.missingInRun, 26);
    assert.equal(summary.unusedEnum, 5);
    assert.equal(summary.placeholder, 2);
    assert.equal(
      summary.activeWithRows +
        summary.emptyHeaderOnly +
        summary.missingInRun +
        summary.unusedEnum +
        summary.placeholder,
      44,
    );

    const weaponFired = gj.csvProfile.tables.find((t) => t.name === 'WeaponFired');
    assert.ok(weaponFired, '应包含 WeaponFired');
    assert.equal(weaponFired.rowCount, 5);
    assert.equal(weaponFired.actualHeaders.length, 33);
    assert.equal(weaponFired.missingColumns.length, 0);
    assert.equal(weaponFired.extraColumns.length, 0);
    assert.ok(weaponFired.drivenOperators.some((op) => op.id === 'time.first_weapon_fire'));
    assert.ok(weaponFired.drivenOperators.some((op) => op.id === 'eff.hit_rate'));

    const unitPos = gj.csvProfile.tables.find((t) => t.name === 'UnitPositions');
    assert.ok(unitPos, '应包含 UnitPositions');
    assert.equal(unitPos.rowCount, 124);

    // 2) CSV 行级预览 (previewTable + previewLimit)
    const previewRes = await fetch(
      `${baseUrl}/api/runs/gj11_pl15_bvr_real/source-profile?previewTable=WeaponFired&previewLimit=3`,
    );
    assert.equal(previewRes.status, 200);
    const previewJson = (await previewRes.json()) as { ok: boolean; profile: RunSourceProfile };
    const pv = previewJson.profile.csvProfile.preview;
    assert.ok(pv, '应返回 preview 对象');
    assert.equal(pv.tableName, 'WeaponFired');
    assert.equal(pv.totalRows, 5);
    assert.equal(pv.rows.length, 3);
    assert.equal(pv.rows[0].data.FiringUnitSide, '红方');
    assert.ok(pv.rows[0].data.WeaponName.includes('PL-15'));

    // 3) BS JSONL 6 帧样本路径命中率与 Batch B 缺失检测
    const bsRes = await fetch(`${baseUrl}/api/runs/bs_sample_swarm_demo/source-profile`);
    assert.equal(bsRes.status, 200);
    const bsJson = (await bsRes.json()) as { ok: boolean; profile: RunSourceProfile };
    const bs = bsJson.profile.bsProfile;
    assert.equal(bsJson.profile.runMeta.sourceAvailable, true);
    assert.equal(bs.fileExists, true);
    assert.equal(bs.parsedFrames, 6);
    assert.equal(bs.parseErrors, 0);
    assert.equal(bs.familyCatalog.length, 7);
    assert.equal(bs.topics.length, 11);

    const byId = new Map(bs.pathMetrics.map((m) => [m.id, m]));
    assert.equal(byId.get('root.time')?.hitFrames, 6);
    assert.equal(byId.get('side.contacts')?.hitFrames, 3);
    assert.equal(byId.get('events.scenario_events')?.hitFrames, 2);
    assert.equal(byId.get('unit.active_units')?.hitFrames, 6);
    assert.equal(byId.get('unit.kinematics')?.hitFrames, 6);
    assert.equal(byId.get('unit.sensors_active')?.hitFrames, 0);
    assert.equal(byId.get('side.missions')?.hitFrames, 0);
    assert.ok(
      byId.get('unit.sensors_active')?.drivenOperators.some((o) => o.id === 'comp.emcon_silence_discipline'),
    );

    // 4) 纯文本上传样本 (<uploaded.jsonl>) 不复制原文件也能安全降级返回
    const minimalFrame = JSON.stringify({
      scenarioTime: '00:00:05',
      frame: {
        Scenario: {
          Time: '00:00:05',
          Sides: [{ Name: '红方', Contacts: [] }],
          ActiveUnits: [],
        },
      },
    });
    const impRes = await fetch(`${baseUrl}/api/runs/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'jsonl_text',
        scenarioName: 'mem-upload-check',
        text: minimalFrame,
      }),
    });
    assert.equal(impRes.status, 200);
    const impJson = (await impRes.json()) as { runId: string };

    const upProfileRes = await fetch(
      `${baseUrl}/api/runs/${encodeURIComponent(impJson.runId)}/source-profile`,
    );
    assert.equal(upProfileRes.status, 200);
    const upProfileJson = (await upProfileRes.json()) as { profile: RunSourceProfile };
    assert.equal(upProfileJson.profile.runMeta.sourceAvailable, false);
    assert.ok(upProfileJson.profile.runMeta.sourceMissingReason?.includes('<uploaded.jsonl>'));

    // 5) 路径穿越拦截与不存在 Run 404
    const badRes = await fetch(
      `${baseUrl}/api/runs/gj11_pl15_bvr_real/source-profile?previewTable=../../package.json`,
    );
    assert.equal(badRes.status, 400);

    const notFoundRes = await fetch(`${baseUrl}/api/runs/nonexistent_run_id/source-profile`);
    assert.equal(notFoundRes.status, 404);
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
