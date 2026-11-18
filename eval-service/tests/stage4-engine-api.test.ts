import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEvalApp, BUILTIN_SAMPLES } from '../src/server.ts';

test('Stage 4：eval.db 冷热存取、报告/战术反哺、NL草案、Q-109实时防骚扰与完整REST+SSE链路', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stage4-'));
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
    // 1) 健康检查 & 预置双真实推演入库
    const health = (await (await fetch(`${baseUrl}/api/health`)).json()) as {
      ok: boolean;
      db: { counts: { runs: number; evaluations: number } };
    };
    assert.equal(health.ok, true);
    assert.ok(health.db.counts.runs >= 2);
    assert.ok(health.db.counts.evaluations >= 2);

    // 2) 字段契约字典直出
    const catalog = (await (await fetch(`${baseUrl}/api/fields-catalog`)).json()) as {
      ok: boolean;
      catalog: { catalog_id: string; catalog_version: string; doc_discrepancies: string[] };
    };
    assert.equal(catalog.ok, true);
    assert.equal(catalog.catalog.catalog_id, 'f1-simulation-output-fields');
    assert.ok(catalog.catalog.doc_discrepancies.length >= 9);

    // 3) 触发 BVR 实测评估并核验报告 + 战术反哺载荷
    const evalRes = (await (
      await fetch(`${baseUrl}/api/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: 'gj11_pl15_bvr_real',
          systemId: 'sys_bvr_air_combat_v1',
          customParams: { targetSide: '红方', enemySide: '蓝方' },
        }),
      })
    ).json()) as {
      ok: boolean;
      evalId: string;
      output: { overallScore: number; dimensions: Array<{ name: string }> };
      reportMd: string;
      feedback: { $schema: string; tacticalGrade: string };
      pythonMetrics: { available: boolean };
    };
    assert.equal(evalRes.ok, true);
    assert.ok(evalRes.output.overallScore > 0);
    assert.equal(evalRes.pythonMetrics.available, true);
    assert.ok(evalRes.reportMd.includes('客观观测事实'));
    assert.ok(evalRes.reportMd.includes('缺失数据与降级诚实性审计'));
    assert.equal(evalRes.feedback.$schema, 'https://f1-ai.schema/tactical-feedback/v1.json');

    // 4) NL-to-Metrics 意图草案生成 + HITL 保存入库
    const nlRes = (await (
      await fetch(`${baseUrl}/api/systems/draft-nl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: '我要评估海上反潜巡逻封锁效能，重点看静默纪律、盲区时间和成本控制',
        }),
      })
    ).json()) as {
      ok: boolean;
      system: { systemId: string; root: { children: unknown[] } };
      validation: { valid: boolean };
      matchedDomains: string[];
    };
    assert.equal(nlRes.ok, true);
    assert.equal(nlRes.validation.valid, true);
    assert.ok(nlRes.matchedDomains.length >= 1);

    const saveSys = (await (
      await fetch(`${baseUrl}/api/systems`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nlRes.system),
      })
    ).json()) as { ok: boolean; system: { systemId: string } };
    assert.equal(saveSys.ok, true);

    // 5) 实时 Q-109 增量推演与 5 分钟防骚扰冷却 + HITL 人工决策闭环
    const bsLines = fs
      .readFileSync(BUILTIN_SAMPLES.bsSampleJsonl, 'utf-8')
      .split(/\r?\n/)
      .filter((l) => l.trim());
    // 构造第 2 帧将有损毁单位与持续推进帧以触发 Q-109 研判卡并测试防重复告警
    const rtCreate = (await (
      await fetch(`${baseUrl}/api/realtime/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: 'rt_stage4_test',
          jsonlText: bsLines.join('\n'),
          systemId: 'sys_littoral_swarm_v1',
        }),
      })
    ).json()) as { ok: boolean; snapshot: { totalFrames: number } };
    assert.equal(rtCreate.ok, true);
    assert.equal(rtCreate.snapshot.totalFrames, bsLines.length);

    // 步进完所有样本帧
    for (let i = 0; i < bsLines.length; i += 1) {
      await fetch(`${baseUrl}/api/realtime/sessions/rt_stage4_test/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'step' }),
      });
    }

    // 再推入一帧人工高损毁帧触发重大告警
    const synthFrame = JSON.stringify({
      Scenario: { Time: '2026-06-01T04:01:00Z' },
      Sides: [{ ID: 's1', Name: '红方' }, { ID: 's2', Name: '蓝方' }],
      ActiveUnits: [
        { ID: 'u-red-1', Name: '红无人艇 #1', Side: '红方', Type: 'Ship', IsDestroyed: true, CH: 121.5, CS: 24.5 },
        { ID: 'u-red-2', Name: '红无人艇 #2', Side: '红方', Type: 'Ship', IsDestroyed: true, CH: 121.6, CS: 24.6 },
      ],
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

    // 连续推入相同冷却窗口 (30s 后 < 300s) 帧：应触发 5 分钟防骚扰抑止计数
    const synthFrame2 = JSON.stringify({
      Scenario: { Time: '2026-06-01T04:01:30Z' },
      Sides: [{ ID: 's1', Name: '红方' }, { ID: 's2', Name: '蓝方' }],
      ActiveUnits: [
        { ID: 'u-red-1', Name: '红无人艇 #1', Side: '红方', Type: 'Ship', IsDestroyed: true, CH: 121.5, CS: 24.5 },
        { ID: 'u-red-2', Name: '红无人艇 #2', Side: '红方', Type: 'Ship', IsDestroyed: true, CH: 121.6, CS: 24.6 },
        { ID: 'u-red-3', Name: '红无人艇 #3', Side: '红方', Type: 'Ship', IsDestroyed: true, CH: 121.7, CS: 24.7 },
      ],
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

    // 对首张卡片下发 HITL 研判决策 ("pause_inspect")
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

    // 6) 查询数据库事件与航迹表
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
