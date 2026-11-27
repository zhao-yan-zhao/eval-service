import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEvalApp } from '../src/server.ts';

test('Stage 18 (V4)：实时伴随流多数据源挂载、自定义 JSONL 回放、V4 效果/门控告警联动与路径越界防御', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stage18-v4-'));
  const customJsonlPath = path.join(tmpDir, 'custom-stream.jsonl');

  const lines = [
    JSON.stringify({
      scenarioTime: '2026-06-01T04:00:00Z',
      frame: {
        Scenario: {
          Time: '2026-06-01T04:00:00Z',
          Sides: [{ Name: '红方', Contacts: [] }],
          ActiveUnits: [
            { ID: 'u-red-1', Name: '红方战机-1', Side: '红方', Type: 'Aircraft', Longitude: 120.1, Latitude: 24.1, DamageState: 'None' },
            { ID: 'u-red-2', Name: '红方战机-2', Side: '红方', Type: 'Aircraft', Longitude: 120.2, Latitude: 24.2, DamageState: 'None' },
          ],
        },
      },
    }),
    JSON.stringify({
      scenarioTime: '2026-06-01T04:01:00Z',
      frame: {
        Scenario: {
          Time: '2026-06-01T04:01:00Z',
          Sides: [{ Name: '红方', Contacts: [] }],
          ActiveUnits: [
            { ID: 'u-red-1', Name: '红方战机-1', Side: '红方', Type: 'Aircraft', Longitude: 120.1, Latitude: 24.1, DamageState: 'Destroyed' },
            { ID: 'u-red-2', Name: '红方战机-2', Side: '红方', Type: 'Aircraft', Longitude: 120.2, Latitude: 24.2, DamageState: 'None' },
          ],
        },
      },
    }),
  ];
  fs.writeFileSync(customJsonlPath, lines.join('\n') + '\n', 'utf-8');

  const app = await createEvalApp({
    dbPath: path.join(tmpDir, 'eval.db'),
    autoSeed: false,
  });

  const port = await new Promise<number>((resolve) => {
    app.server.listen(0, '127.0.0.1', () => {
      resolve((app.server.address() as AddressInfo).port);
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  let registeredDsId = '';

  try {
    // 1. 路径越界防御：拒绝任意未注册 jsonlFile 直传
    const badPathRes = await fetch(`${baseUrl}/api/realtime/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'rt-bad-path',
        jsonlFile: '/etc/passwd',
      }),
    });
    assert.equal(badPathRes.status, 400, '应拦截直接传递任意文件路径 jsonlFile');

    // 2. 通过内联 jsonlLines 数组创建实时会话（使用 V4 体系）
    const inlineRes = await fetch(`${baseUrl}/api/realtime/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'rt-inline-test',
        jsonlLines: lines,
        systemId: 'sys_v4_metrics_guide_full',
      }),
    });
    assert.equal(inlineRes.status, 200);
    const inlineJson = (await inlineRes.json()) as {
      ok: boolean;
      snapshot: { runId: string; totalFrames: number };
    };
    assert.equal(inlineJson.ok, true);
    assert.equal(inlineJson.snapshot.totalFrames, 2);

    // 3. 在 DataSourceStore 注册 JSONL 数据源并通过 sourceId 挂载实时会话
    registeredDsId = `ds_stage18_tmp_${Date.now()}`;
    const regDsRes = await fetch(`${baseUrl}/api/data-sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: registeredDsId,
        name: 'Stage 18 自定义流',
        kind: 'jsonl_file',
        path: customJsonlPath,
      }),
    });
    assert.equal(regDsRes.status, 200);

    const dsSessionRes = await fetch(`${baseUrl}/api/realtime/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'rt-ds-test',
        sourceId: registeredDsId,
        systemId: 'sys_v4_metrics_guide_full',
      }),
    });
    assert.equal(dsSessionRes.status, 200);
    const dsSessionJson = (await dsSessionRes.json()) as {
      ok: boolean;
      snapshot: { runId: string; totalFrames: number };
    };
    assert.equal(dsSessionJson.ok, true);
    assert.equal(dsSessionJson.snapshot.totalFrames, 2);

    // 4. 校验 V4 效果库已包含 gate_excessive_attrition 告警门控
    const effRes = await fetch(`${baseUrl}/api/v4/effects`);
    assert.equal(effRes.status, 200);
    const effJson = (await effRes.json()) as {
      effects: Array<{ effectId: string }>;
    };
    assert.ok(effJson.effects.some((e) => e.effectId === 'gate_excessive_attrition'));

    // 步进 2 帧（第 2 帧红方战损率 50% > 35% 触发 V4 gate_excessive_attrition）
    await fetch(`${baseUrl}/api/realtime/sessions/rt-ds-test/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'step' }),
    });
    const step2Res = await fetch(`${baseUrl}/api/realtime/sessions/rt-ds-test/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'step' }),
    });
    assert.equal(step2Res.status, 200);
    const step2Json = (await step2Res.json()) as {
      snapshot: {
        cursor: number;
        cards: Array<{ triggerIndicatorId: string; triggerAtomId: string }>;
      };
    };
    assert.equal(step2Json.snapshot.cursor, 2);
    assert.ok(
      step2Json.snapshot.cards.some(
        (c) => c.triggerIndicatorId === 'gate_excessive_attrition' && c.triggerAtomId === 'cost.side_attrition_rate',
      ),
      '步进第 2 帧后应触发 V4 gate_excessive_attrition 告警卡',
    );
  } finally {
    if (registeredDsId) {
      await fetch(`${baseUrl}/api/data-sources/${encodeURIComponent(registeredDsId)}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
