import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEvalApp } from '../src/server.ts';

test('Stage 16 (V4)：V4 体系客观/组合赋权、VIKOR 折中解与 V4 评估历史删除全链路校验', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stage16-v4-'));
  const app = await createEvalApp({
    dbPath: path.join(tmpDir, 'eval.db'),
    autoSeed: false,
  });

  const port = await new Promise<number>((resolve) => {
    app.server.listen(0, '127.0.0.1', () => {
      resolve((app.server.address() as AddressInfo).port);
    });
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;

    // 1. 校验 /api/v4/system-dags/objective-weights fail-closed（少于 2 行方案报错 400）
    const failWeightsRes = await fetch(`${baseUrl}/api/v4/system-dags/objective-weights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matrix: [[80, 70]],
        method: 'entropy',
      }),
    });
    assert.equal(failWeightsRes.status, 400, '少于 2 局方案应 fail-closed 返回 400');

    // 2. 校验 entropy / critic / combined 客观赋权
    for (const method of ['entropy', 'critic', 'combined'] as const) {
      const wRes = await fetch(`${baseUrl}/api/v4/system-dags/objective-weights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matrix: [
            [88, 72, 91],
            [65, 85, 70],
            [79, 80, 82],
          ],
          directions: ['larger_is_better', 'larger_is_better', 'larger_is_better'],
          method,
          alpha: 0.6,
        }),
      });
      assert.equal(wRes.status, 200, `${method} 赋权请求应成功`);
      const wJson = (await wRes.json()) as { ok: boolean; weights: number[] };
      assert.equal(wJson.ok, true);
      assert.equal(wJson.weights.length, 3);
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

    // 4. 校验 V4 评估结果落库与 DELETE /api/v4/evaluations/:evalId
    const nowIso = new Date().toISOString();
    app.sqliteStore.saveV4Evaluation({
      evalId: 'v4_eval_stage16_del',
      runId: 'stage16-run-a',
      systemId: 'sys_v4_metrics_guide_full',
      systemName: '全域基线',
      systemVersion: '4.0.0',
      sides: ['红方'],
      overallScore: 81.5,
      gateVerdict: 'PASS',
      availableWeightRatio: 1.0,
      sideSummaries: [],
      overall: {
        evalId: 'v4_eval_stage16_del',
        runId: 'stage16-run-a',
        systemId: 'sys_v4_metrics_guide_full',
        systemName: '全域基线',
        systemVersion: '4.0.0',
        createdAt: nowIso,
        terminalEffectNodeId: 'ef_mg_terminal_overall',
        overallScore: 81.5,
        rawOverallScore: 81.5,
        gateVerdict: 'PASS',
        gateAudit: [],
        availableWeightRatio: 1.0,
        topologicalOrder: [],
        nodeResults: {},
      },
      bySide: {},
      metricSnapshots: [],
      createdAt: nowIso,
    });

    const getBeforeDel = await fetch(`${baseUrl}/api/v4/evaluations/v4_eval_stage16_del`);
    assert.equal(getBeforeDel.status, 200);

    const delRes = await fetch(`${baseUrl}/api/v4/evaluations/v4_eval_stage16_del`, {
      method: 'DELETE',
    });
    assert.equal(delRes.status, 200);

    const getAfterDel = await fetch(`${baseUrl}/api/v4/evaluations/v4_eval_stage16_del`);
    assert.equal(getAfterDel.status, 404);
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
