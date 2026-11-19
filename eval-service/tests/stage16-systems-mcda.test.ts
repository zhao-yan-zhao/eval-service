import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEvalApp } from '../src/server.ts';

function buildDummyJsonlLines(opts: {
  firstDetectOffsetSec: number;
  damageCount: number;
  speedVal: number;
}): string {
  const baseMs = Date.parse('2026-01-01T00:00:00Z');
  const t0 = new Date(baseMs).toISOString();
  const t1 = new Date(baseMs + opts.firstDetectOffsetSec * 1000).toISOString();
  const lines = [
    JSON.stringify({
      Time: t0,
      SideID: 'Red',
      UnitID: 'u-red-1',
      UnitName: '红方无人机-1',
      UnitType: 'Aircraft',
      Longitude: 120.1,
      Latitude: 24.1,
      Altitude_m: 8000,
      Speed_kts: opts.speedVal,
      DamageState: 'None',
    }),
    JSON.stringify({
      Time: t1,
      SideID: 'Red',
      UnitID: 'u-red-1',
      UnitName: '红方无人机-1',
      UnitType: 'Aircraft',
      Longitude: 120.2,
      Latitude: 24.2,
      Altitude_m: 8000,
      Speed_kts: opts.speedVal,
      DamageState: opts.damageCount > 0 ? 'Destroyed' : 'None',
      TargetDetected: 'u-blue-1',
    }),
    JSON.stringify({
      Time: t1,
      SideID: 'Blue',
      UnitID: 'u-blue-1',
      UnitName: '蓝方目标-1',
      UnitType: 'Ship',
      Longitude: 120.5,
      Latitude: 24.5,
      Altitude_m: 0,
      Speed_kts: 20,
      DamageState: 'None',
    }),
  ];
  return lines.join('\n') + '\n';
}

test('Stage 16：三库客观/组合赋权、VIKOR 折中解与评估历史删除全链路校验', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stage16-'));
  const jsonlA = path.join(tmpDir, 'runA.jsonl');
  const jsonlB = path.join(tmpDir, 'runB.jsonl');
  fs.writeFileSync(jsonlA, buildDummyJsonlLines({ firstDetectOffsetSec: 20, damageCount: 0, speedVal: 420 }), 'utf-8');
  fs.writeFileSync(jsonlB, buildDummyJsonlLines({ firstDetectOffsetSec: 120, damageCount: 1, speedVal: 310 }), 'utf-8');

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

    // 1. 先仅导入 1 个 Run，校验 objective-weights 严格 fail-closed（少于 2 个方案报错 400）
    const importA = await fetch(`${baseUrl}/api/runs/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'builtin_gj11',
        runId: 'stage16-run-a',
      }),
    });
    assert.equal(importA.status, 200);

    const sysRes = await fetch(`${baseUrl}/api/systems`);
    const sysJson = (await sysRes.json()) as {
      systems: Array<{ systemId: string; root: { children: Array<{ id: string }> } }>;
    };
    const targetSystem = sysJson.systems[0];
    assert.ok(targetSystem, '应存在内置评估体系');

    const failWeightsRes = await fetch(`${baseUrl}/api/systems/objective-weights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemId: targetSystem.systemId,
        runIds: ['stage16-run-a'],
        method: 'entropy',
      }),
    });
    assert.equal(failWeightsRes.status, 400, '少于 2 局方案应 fail-closed 返回 400');

    // 2. 导入第 2 个 Run，校验 entropy / critic / combined 赋权与局部 dimensionIds 定权
    const importB = await fetch(`${baseUrl}/api/runs/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'builtin_bs',
        runId: 'stage16-run-b',
      }),
    });
    assert.equal(importB.status, 200);

    for (const method of ['entropy', 'critic', 'combined'] as const) {
      const wRes = await fetch(`${baseUrl}/api/systems/objective-weights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemId: targetSystem.systemId,
          runIds: ['stage16-run-a', 'stage16-run-b'],
          method,
          alpha: 0.6,
        }),
      });
      assert.equal(wRes.status, 200, `${method} 赋权请求应成功`);
      const wJson = (await wRes.json()) as {
        ok: boolean;
        weights: number[];
        runs: string[];
        matrix: number[][];
      };
      assert.equal(wJson.ok, true);
      assert.equal(wJson.runs.length, 2);
      assert.equal(wJson.matrix.length, 2);
      const sum = wJson.weights.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - 1) < 1e-2, `${method} 权重之和应约等于 1，实际=${sum}`);
    }

    // 3. 校验 /api/mcda/vikor
    const vikorRes = await fetch(`${baseUrl}/api/mcda/vikor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matrix: [
          [88, 75, 92],
          [70, 85, 65],
          [80, 80, 80],
        ],
        weights: [0.4, 0.3, 0.3],
        directions: ['larger_is_better', 'larger_is_better', 'larger_is_better'],
        alternatives: ['方案A', '方案B', '方案C'],
        v: 0.5,
      }),
    });
    assert.equal(vikorRes.status, 200);
    const vikorJson = (await vikorRes.json()) as {
      ranking: Array<{ rank: number; name: string; S: number; R: number; Q: number }>;
      compromiseBest: string;
      vParameter: number;
    };
    assert.equal(vikorJson.ranking.length, 3);
    assert.ok(vikorJson.compromiseBest && vikorJson.compromiseBest.length > 0);
    assert.equal(vikorJson.vParameter, 0.5);

    // 4. 校验评估记录创建与 DELETE /api/evaluations/:evalId
    const evalRes = await fetch(`${baseUrl}/api/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'stage16-run-a',
        systemId: targetSystem.systemId,
        runPythonMetrics: false,
      }),
    });
    assert.equal(evalRes.status, 200);
    const evalJson = (await evalRes.json()) as { evalId: string };
    assert.ok(evalJson.evalId);

    const delRes = await fetch(`${baseUrl}/api/evaluations/${encodeURIComponent(evalJson.evalId)}`, {
      method: 'DELETE',
    });
    assert.equal(delRes.status, 200);

    const getAfterDel = await fetch(`${baseUrl}/api/evaluations/${encodeURIComponent(evalJson.evalId)}`);
    assert.equal(getAfterDel.status, 404);
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
