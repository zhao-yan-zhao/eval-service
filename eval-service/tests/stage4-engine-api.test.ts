import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEvalApp, BUILTIN_SAMPLES } from '../src/server.ts';

test('Stage 4 (V4)：eval.db 冷热存取、字段字典、V4 NL草案、Q-109实时防骚扰与完整REST链路', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stage4-v4-'));
  const app = await createEvalApp({
    dbPath: path.join(tmpDir, 'eval.db'),
    autoSeed: true,
  });

  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1) 健康检查 & 预置双真实推演入库
    const health = (await (await fetch(`${baseUrl}/api/health`)).json()) as {
      ok: boolean;
      db: { counts: { runs: number; v4Operators?: number; v4SystemDags?: number } };
    };
    assert.equal(health.ok, true);
    assert.ok(health.db.counts.runs >= 2);
    assert.ok((health.db.counts.v4Operators ?? 0) >= 42);
    assert.ok((health.db.counts.v4SystemDags ?? 0) >= 2);

    // 2) 字段契约字典直出
    const catalog = (await (await fetch(`${baseUrl}/api/fields-catalog`)).json()) as {
      ok: boolean;
      catalog: { catalog_id: string; catalog_version: string; doc_discrepancies: string[] };
    };
    assert.equal(catalog.ok, true);
    assert.equal(catalog.catalog.catalog_id, 'f1-simulation-output-fields');
    assert.ok(catalog.catalog.doc_discrepancies.length >= 9);

    // 3) V4 NL-to-Metrics 意图草案生成 + HITL 保存入库
    const nlRes = (await (
      await fetch(`${baseUrl}/api/v4/system-dags/draft-nl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: '我要评估海上反潜巡逻封锁效能，重点看防空拦截、侦察发现和战损控制',
        }),
      })
    ).json()) as {
      ok: boolean;
      systemDag?: { systemId: string; nodes: unknown[]; edges: unknown[] };
      system?: { systemId: string; nodes: unknown[]; edges: unknown[] };
      validation?: { valid: boolean };
    };
    assert.equal(nlRes.ok, true);
    const draftedDag = nlRes.systemDag ?? nlRes.system;
    assert.ok(draftedDag && draftedDag.systemId);
    if (nlRes.validation) {
      assert.equal(nlRes.validation.valid, true);
    }

    const saveSys = (await (
      await fetch(`${baseUrl}/api/v4/system-dags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftedDag),
      })
    ).json()) as { ok: boolean; systemDag?: { systemId: string } };
    assert.equal(saveSys.ok, true);

    // 4) 实时 Q-109 增量推演与 5 分钟防骚扰冷却 + HITL 人工决策闭环 (V4 SystemDag)
    const bsLines = fs
      .readFileSync(BUILTIN_SAMPLES.bsSampleJsonl, 'utf-8')
      .split(/\r?\n/)
      .filter((l) => l.trim());
    const rtCreate = (await (
      await fetch(`${baseUrl}/api/realtime/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: 'rt_stage4_test',
          jsonlText: bsLines.join('\n'),
          systemId: 'sys_v4_metrics_guide_full',
        }),
      })
    ).json()) as { ok: boolean; snapshot: { totalFrames: number } };
    assert.equal(rtCreate.ok, true);
    assert.equal(rtCreate.snapshot.totalFrames, bsLines.length);

    for (let i = 0; i < bsLines.length; i += 1) {
      await fetch(`${baseUrl}/api/realtime/sessions/rt_stage4_test/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'step' }),
      });
    }

    // 推入高损毁帧触发重大告警
    const synthFrame = JSON.stringify({
      Scenario: {
        Time: '2026-06-01T04:05:00Z',
        Sides: [{ ID: 's1', Name: '红方' }, { ID: 's2', Name: '蓝方' }],
        ActiveUnits: [
          { ObjectID: 'u-red-dd1', Name: '南昌舰', Side: '红方', UnitClass: 'DDG', Longitude: 121.5, Latitude: 24.2, Altitude: 0, Heading: 50, Speed: 18, DamageState: 'destroyed' },
          { ObjectID: 'u-red-j15', Name: '歼15-01', Side: '红方', UnitClass: 'Aircraft', Longitude: 121.9, Latitude: 24.7, Altitude: 8000, Heading: 140, Speed: 0.9, DamageState: 'ok' },
          { ObjectID: 'u-blue-dd1', Name: '伯克舰', Side: '蓝方', UnitClass: 'DDG', Longitude: 122.4, Latitude: 24.0, Altitude: 0, Heading: 270, Speed: 16, DamageState: 'destroyed' },
        ],
      },
    });
    const push1 = (await (
      await fetch(`${baseUrl}/api/realtime/sessions/rt_stage4_test/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push_frame', frameLine: synthFrame }),
      })
    ).json()) as {
      ok: boolean;
      snapshot: {
        suppressedCount: number;
        cards: Array<{ cardId: string; hitlAction: string; severity: string }>;
      };
    };
    assert.ok(push1.snapshot.cards.length >= 1);

    // 30s 后再次推入同源损毁帧 -> 5 分钟冷却窗口抑止防刷屏
    const synthFrame2 = JSON.stringify({
      Scenario: {
        Time: '2026-06-01T04:05:30Z',
        Sides: [{ ID: 's1', Name: '红方' }, { ID: 's2', Name: '蓝方' }],
        ActiveUnits: [
          { ObjectID: 'u-red-dd1', Name: '南昌舰', Side: '红方', UnitClass: 'DDG', Longitude: 121.5, Latitude: 24.2, Altitude: 0, Heading: 50, Speed: 18, DamageState: 'destroyed' },
          { ObjectID: 'u-red-j15', Name: '歼15-01', Side: '红方', UnitClass: 'Aircraft', Longitude: 121.9, Latitude: 24.7, Altitude: 8000, Heading: 140, Speed: 0.9, DamageState: 'destroyed' },
          { ObjectID: 'u-blue-dd1', Name: '伯克舰', Side: '蓝方', UnitClass: 'DDG', Longitude: 122.4, Latitude: 24.0, Altitude: 0, Heading: 270, Speed: 16, DamageState: 'destroyed' },
        ],
      },
    });
    const push2 = (await (
      await fetch(`${baseUrl}/api/realtime/sessions/rt_stage4_test/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push_frame', frameLine: synthFrame2 }),
      })
    ).json()) as {
      ok: boolean;
      snapshot: {
        suppressedCount: number;
        cards: Array<{ cardId: string; hitlAction: string }>;
      };
    };
    assert.ok(push2.snapshot.suppressedCount >= 1, '5 分钟冷却期内同源卡片应被抑止防刷屏');

    // HITL 决策 ("pause_inspect")
    const targetCardId = push2.snapshot.cards[0].cardId;
    const hitlRes = (await (
      await fetch(`${baseUrl}/api/realtime/sessions/rt_stage4_test/cards/${targetCardId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause_inspect', note: '核查毁伤原因与防空射程' }),
      })
    ).json()) as {
      ok: boolean;
      card: { hitlAction: string };
      snapshot: { status: string };
    };
    assert.equal(hitlRes.ok, true);
    assert.equal(hitlRes.card.hitlAction, 'pause_inspect');
    assert.equal(hitlRes.snapshot.status, 'paused');

    // 5) 查询数据库事件与航迹表
    const evList = (await (
      await fetch(`${baseUrl}/api/runs/gj11_pl15_bvr_real/events?limit=20`)
    ).json()) as { ok: boolean; total: number; events: unknown[] };
    assert.equal(evList.ok, true);
    assert.ok(evList.total > 5);

    const trackList = (await (
      await fetch(`${baseUrl}/api/runs/gj11_pl15_bvr_real/tracks`)
    ).json()) as { ok: boolean; tracks: Array<{ points: unknown[] }> };
    assert.equal(trackList.ok, true);
    assert.ok(trackList.tracks.some((t) => t.points.length > 0));
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
