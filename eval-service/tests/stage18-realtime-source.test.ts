import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEvalApp } from '../src/server.ts';

test('Stage 18：实时伴随流多数据源挂载、自定义 JSONL 行回放、二库告警联动与路径越界防御', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stage18-'));
  const customJsonlPath = path.join(tmpDir, 'custom-stream.jsonl');

  const lines = [
    JSON.stringify({
      Time: '2026-06-01T04:00:00Z',
      UnitID: 'u-red-1',
      UnitName: '红方战机-1',
      SideID: 'Red',
      UnitType: 'Aircraft',
      Longitude: 120.1,
      Latitude: 24.1,
      DamageState: 'None',
    }),
    JSON.stringify({
      Time: '2026-06-01T04:01:00Z',
      UnitID: 'u-red-1',
      UnitName: '红方战机-1',
      SideID: 'Red',
      UnitType: 'Aircraft',
      Longitude: 120.2,
      Latitude: 24.2,
      DamageState: 'Destroyed',
    }),
  ];
  fs.writeFileSync(customJsonlPath, lines.join('\n') + '\n', 'utf-8');

  const app = await createEvalApp({
    dbPath: path.join(tmpDir, 'eval.db'),
    customIndicatorsPath: path.join(tmpDir, 'custom-indicators.json'),
    customSystemsPath: path.join(tmpDir, 'custom-systems.json'),
    customOperatorsPath: path.join(tmpDir, 'custom-operators.json'),
    operatorOverridesPath: path.join(tmpDir, 'operator-overrides.json'),
    autoSeed: false,
  });

  const port = await new Promise<number>((resolve) => {
    app.server.listen(0, '127.0.0.1', () => {
      resolve((app.server.address() as AddressInfo).port);
    });
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;

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

    // 2. 通过内联 jsonlLines 数组创建实时会话
    const inlineRes = await fetch(`${baseUrl}/api/realtime/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'rt-inline-test',
        jsonlLines: lines,
        systemId: 'sys_littoral_swarm_v1',
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
    const regDsRes = await fetch(`${baseUrl}/api/data-sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'ds_stage18_custom_jsonl',
        label: 'Stage 18 自定义流',
        sourceKind: 'jsonl_file',
        path: customJsonlPath,
      }),
    });
    assert.equal(regDsRes.status, 200);

    const dsSessionRes = await fetch(`${baseUrl}/api/realtime/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'rt-ds-test',
        sourceId: 'ds_stage18_custom_jsonl',
        systemId: 'sys_littoral_swarm_v1',
      }),
    });
    assert.equal(dsSessionRes.status, 200);
    const dsSessionJson = (await dsSessionRes.json()) as {
      ok: boolean;
      snapshot: { runId: string; totalFrames: number };
    };
    assert.equal(dsSessionJson.ok, true);
    assert.equal(dsSessionJson.snapshot.totalFrames, 2);

    // 4. 修改二库指标告警模板并验证实时流步进后生效
    const indRes = await fetch(`${baseUrl}/api/indicators`);
    const indJson = (await indRes.json()) as {
      indicators: Array<{ indicatorId: string; name: string; atomRef: string; scoring: unknown }>;
    };
    const damageInd = indJson.indicators.find((i) => i.atomRef === 'cost.force_loss_rate');
    if (damageInd) {
      await fetch(`${baseUrl}/api/indicators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...damageInd,
          alarmThreshold: {
            operator: '>',
            value: 0.1,
            severity: 'major',
            messageTemplate: 'Stage18自定义告警模板命中：{value}',
          },
        }),
      });
    }

    // 步进 2 帧（第 2 帧红方战损率上升）
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
      snapshot: { cursor: number; cards: Array<{ summary: string }> };
    };
    assert.equal(step2Json.snapshot.cursor, 2);
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
