import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { IndicatorStore } from '../src/indicators/store.ts';
import { BUILTIN_OPERATOR_IDS } from '../src/operators/registry.ts';
import { createEvalApp } from '../src/server.ts';

test('Stage 15.1：二库内置指标保留任务航路走廊空间遵从率且校验规则完备', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stage15-'));
  try {
    const store = new IndicatorStore(path.join(tmpDir, 'custom-indicators.json'));
    const all = store.listAll();
    const coveredAtoms = new Set(all.map((i) => i.atomRef));

    assert.ok(all.length >= 1, `二库内置指标数应 >= 1，实际=${all.length}`);
    assert.equal(coveredAtoms.has('roe.corridor_spatial_compliance'), true, '必须保留任务航路走廊空间遵从率');

    // step 规则空档位或越界分值应校验拦截
    assert.throws(
      () =>
        store.upsertCustom({
          indicatorId: 'bad_step_empty',
          name: '空阶梯',
          atomRef: 'roe.corridor_spatial_compliance',
          scoring: { type: 'step', steps: [] },
        }),
      /steps/,
    );
    assert.throws(
      () =>
        store.upsertCustom({
          indicatorId: 'bad_step_score',
          name: '超界阶梯',
          atomRef: 'roe.corridor_spatial_compliance',
          scoring: { type: 'step', steps: [{ val: 60, score: 120 }] },
        }),
      /0~100/,
    );

    // target_range 容忍区间不包络最优区间应校验拦截
    assert.throws(
      () =>
        store.upsertCustom({
          indicatorId: 'bad_range',
          name: '交叉区间',
          atomRef: 'roe.corridor_spatial_compliance',
          scoring: {
            type: 'target_range',
            optimalRange: [300, 600],
            toleranceRange: [350, 700],
          },
        }),
      /包络最优区间/,
    );

    // upsertBatchCustom 原子校验：任何一项非法则整批不落盘
    assert.throws(() =>
      store.upsertBatchCustom([
        {
          indicatorId: 'good_step_1',
          name: '有效阶梯',
          atomRef: 'roe.corridor_spatial_compliance',
          scoring: {
            type: 'step',
            steps: [
              { val: 0, score: 100 },
              { val: 120, score: 70 },
              { val: 300, score: 0 },
            ],
          },
        },
        {
          indicatorId: 'bad_linear_eq',
          name: '无效线性',
          atomRef: 'roe.corridor_spatial_compliance',
          scoring: { type: 'linear', bounds: [1, 1] },
        },
      ]),
    );
    assert.equal(store.get('good_step_1'), undefined, '原子批次校验失败时不得部分写入');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Stage 15.2：REST API 指标真机实测回测 (/api/indicators/backtest) 与批量导入 (/api/indicators/import)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stage15-api-'));
  const app = await createEvalApp({
    dbPath: path.join(tmpDir, 'eval.db'),
    customOperatorsPath: path.join(tmpDir, 'custom-op.json'),
    operatorOverridesPath: path.join(tmpDir, 'operator-overrides.json'),
    customIndicatorsPath: path.join(tmpDir, 'custom-ind.json'),
    customSystemsPath: path.join(tmpDir, 'custom-sys.json'),
    autoSeed: false,
  });

  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 导入内置 GJ11 与 BS 样例（无需触发全套 Python metrics.py 冷启动）
    await fetch(`${baseUrl}/api/runs/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'builtin_gj11', runId: 'gj11_pl15_bvr_real' }),
    });
    await fetch(`${baseUrl}/api/runs/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'builtin_bs', runId: 'bs_sample_swarm_demo' }),
    });

    // 1. 回测自定义 step 指标在所有已导入样本上的实测分布
    const btRes = await fetch(`${baseUrl}/api/indicators/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indicator: {
          indicatorId: 'ind_bt_hit_step',
          name: '空间走廊四档考核',
          atomRef: 'roe.corridor_spatial_compliance',
          scoring: {
            type: 'step',
            steps: [
              { val: 0, score: 20 },
              { val: 0.3, score: 60 },
              { val: 0.6, score: 85 },
              { val: 0.85, score: 100 },
            ],
          },
          alarmThreshold: { operator: '<', value: 0.99, severity: 'minor' },
        },
      }),
    }).then((r) => r.json());

    assert.equal(btRes.ok, true);
    assert.ok(btRes.summary.totalRuns >= 2);

    // 2. 不存在的 targetField 严格 fail-closed 为 unavailable
    const failClosedRes = await fetch(`${baseUrl}/api/indicators/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indicator: {
          indicatorId: 'ind_bt_missing_col',
          name: '缺失列校验',
          atomRef: 'roe.corridor_spatial_compliance',
          targetField: 'NonExistentFieldXYZ',
          scoring: { type: 'larger_is_better', worst: 0, optimal: 1 },
        },
      }),
    }).then((r) => r.json());

    assert.equal(failClosedRes.ok, true);
    assert.equal(failClosedRes.summary.validCount, 0);
    assert.ok(failClosedRes.results.every((r: any) => r.status === 'unavailable' && r.score === null));

    // 3. 批量导入 JSON 指标并验证持久化可见
    const impRes = await fetch(`${baseUrl}/api/indicators/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indicators: [
          {
            indicatorId: 'ind_s15_bool_inverted',
            name: '反向布尔红线指标',
            atomRef: 'roe.corridor_spatial_compliance',
            scoring: { type: 'boolean', trueScore: 0, falseScore: 100 },
            tags: ['合规', '红线'],
          },
        ],
      }),
    }).then((r) => r.json());

    assert.equal(impRes.ok, true);
    assert.equal(impRes.count, 1);

    const listRes = await fetch(`${baseUrl}/api/indicators`).then((r) => r.json());
    const found = listRes.indicators.find((i: any) => i.indicatorId === 'ind_s15_bool_inverted');
    assert.ok(found);
    assert.equal(found.scoring.trueScore, 0);
    assert.equal(found.scoring.falseScore, 100);
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
