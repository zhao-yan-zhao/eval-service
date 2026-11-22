import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildSituationModel } from '../src/core/situation-model.ts';
import type { SituationUnit } from '../src/core/types.ts';
import { createEmptySituationModel } from '../src/adapters/frame-adapter.ts';
import { evaluateAllOperators, evaluateOperator, listOperatorMetas } from '../src/operators/registry.ts';
import { runPythonMetricsAdapter } from '../src/operators/effectiveness/metrics-py-adapter.ts';
import {
  computeAhpWeights,
  computeEntropyWeights,
  computeTopsisRank,
} from '../src/operators/mcda-adapter.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const REAL_CSV_DIR = path.join(
  REPO_ROOT,
  'LabConsole',
  'outputs',
  'm6-verify-runs',
  '39c47807bece4e0690feb0598f7a92d1',
  'GJ11-PL15试射-90nm正对-80nm-1',
  'EventExport_CSV',
);
const BS_SAMPLE_JSONL = path.join(
  REPO_ROOT,
  'demo-ui',
  'proxy',
  'testdata',
  'bs-frames-sample.jsonl',
);

test('算子注册表包含 41 个唯一内置算子并按五类完整覆盖', () => {
  const metas = listOperatorMetas().filter((m) => !m.isCustom);
  assert.equal(metas.length, 41);
  const ids = new Set(metas.map((m) => m.id));
  assert.equal(ids.size, 41);

  const byCat = metas.reduce<Record<string, number>>((acc, m) => {
    acc[m.category] = (acc[m.category] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(byCat, {
    time: 4,
    effectiveness: 21,
    situation: 4,
    compliance: 7,
    cost: 5,
  });
});

test('真实 F1 BVR CSV (GJ11-PL15) + metrics.py 白名单暂存适配与算子评测', async () => {
  const pyRes = await runPythonMetricsAdapter(REAL_CSV_DIR);
  assert.equal(pyRes.available, true, pyRes.reason);
  assert.ok(pyRes.stagedFiles.length >= 7);
  assert.ok(pyRes.skippedFiles.some((f) => f.includes('Expenditures')));
  assert.ok(pyRes.skippedFiles.some((f) => f.includes('WeaponEndgame')));
  assert.ok(pyRes.metrics);

  const situation = await buildSituationModel({
    runId: 'gj11-stage2-test',
    csvDir: REAL_CSV_DIR,
  });

  const ctx = {
    runId: 'gj11-stage2-test',
    situation,
    csvStats: pyRes.metrics,
    customParams: { targetSide: '红方', enemySide: '蓝方' },
  };

  // 空间遵从率在缺少走廊时严格 fail-closed
  const corridorRes = evaluateOperator('roe.corridor_spatial_compliance', ctx);
  assert.equal(corridorRes.status, 'unavailable');
});

test('BS 帧样本全量算子评测与 Batch B 安全隔离', async () => {
  const situation = await buildSituationModel({
    runId: 'bs-stage2-test',
    jsonlFile: BS_SAMPLE_JSONL,
  });
  const all = evaluateAllOperators({
    runId: 'bs-stage2-test',
    situation,
  });
  const builtinResults = Object.fromEntries(
    Object.entries(all).filter(([id]) => !id.startsWith('custom.')),
  );
  assert.equal(Object.keys(builtinResults).length, 41);
  // 空间遵从率在缺失走廊时绝不造假，保持 unavailable
  assert.equal(all['roe.corridor_spatial_compliance'].status, 'unavailable');
});

test('Turf.js 空间几何与合围同步算子校验', () => {
  const sim = createEmptySituationModel('geo-test', 'synthetic');
  sim.sides = ['红方', '蓝方'];
  sim.startGameClock = '00:00:00';
  sim.endGameClock = '00:02:00';
  sim.totalGameSeconds = 120;

  const u1: SituationUnit = {
    unitId: 'r1',
    unitName: '红无人机-1',
    side: '红方',
    unitClass: 'UCAV',
    firstSeenSeconds: 0,
    firstSeenClock: '00:00:00',
    lastSeenSeconds: 120,
    lastSeenClock: '00:02:00',
    isDestroyed: false,
    damageState: 'ok',
    ammoInitial: 4,
    ammoRemaining: 4,
    emconStates: [],
    trackPoints: [
      { scenarioSeconds: 0, clockText: '00:00:00', lon: 120.1, lat: 25.0 },
      { scenarioSeconds: 60, clockText: '00:01:00', lon: 120.5, lat: 25.0 },
      { scenarioSeconds: 120, clockText: '00:02:00', lon: 120.9, lat: 25.0 },
    ],
  };
  const u2: SituationUnit = {
    ...u1,
    unitId: 'r2',
    unitName: '红无人机-2',
    trackPoints: [
      { scenarioSeconds: 0, clockText: '00:00:00', lon: 120.1, lat: 25.1 },
      { scenarioSeconds: 60, clockText: '00:01:00', lon: 120.5, lat: 25.1 },
      { scenarioSeconds: 120, clockText: '00:02:00', lon: 120.85, lat: 25.1 },
    ],
  };
  sim.units.set('r1', u1);
  sim.units.set('r2', u2);
  sim.corridors.push({
    id: 'corridor-1',
    name: '主攻击走廊',
    side: '红方',
    points: [
      { lon: 120.0, lat: 24.8 },
      { lon: 120.7, lat: 24.8 },
      { lon: 120.7, lat: 25.3 },
      { lon: 120.0, lat: 25.3 },
    ],
  });

  // 4 个在走廊内 (t=0, 60)，2 个飞出边界 120.7 (t=120) -> 合规率 = 4/6 = 0.6667
  const corRes = evaluateOperator('roe.corridor_spatial_compliance', {
    runId: 'geo-test',
    situation: sim,
  });
  assert.equal(corRes.status, 'valid');
  assert.ok(Math.abs(Number(corRes.value) - 4 / 6) < 1e-3);
});

test('Python NumPy/SciPy MCDA 引擎：AHP CR 一致性校验、熵权法与 TOPSIS 排序', async () => {
  // 一致正互反阵：权重应接近 [4/7, 2/7, 1/7] 且 CR 约 0
  const ahpOk = await computeAhpWeights(
    [
      [1, 2, 4],
      [0.5, 1, 2],
      [0.25, 0.5, 1],
    ],
    ['毁伤效能', '时效反应', '经济费效'],
  );
  assert.equal(ahpOk.consistent, true);
  assert.ok(ahpOk.cr < 0.01);
  assert.ok(Math.abs(ahpOk.weights[0] - 4 / 7) < 0.01);

  // 严重矛盾矩阵：A>>B(9), B>>C(9), C>>A(9) -> CR 必然 >= 0.10
  const ahpBad = await computeAhpWeights([
    [1, 9, 1 / 9],
    [1 / 9, 1, 9],
    [9, 1 / 9, 1],
  ]);
  assert.equal(ahpBad.consistent, false);
  assert.ok(ahpBad.cr >= 0.1);

  // 熵权 + TOPSIS
  const matrix = [
    [0.85, 120, 450], // 方案 A：高命中、快反应、较低花费 -> 最优
    [0.65, 220, 600], // 方案 B：中等
    [0.35, 420, 900], // 方案 C：最差
  ];
  const dirs: Array<'larger_is_better' | 'smaller_is_better'> = [
    'larger_is_better',
    'smaller_is_better',
    'smaller_is_better',
  ];
  const ew = await computeEntropyWeights(matrix, dirs, ['命中率', '首次发射', '耗弹成本']);
  assert.ok(Math.abs(ew.weights.reduce((a, b) => a + b, 0) - 1) < 1e-4);

  const topsis = await computeTopsisRank({
    matrix,
    weights: ew.weights,
    directions: dirs,
    alternatives: ['方案A-分布式协同', '方案B-标准双机编队', '方案C-单机长程强突'],
  });
  assert.equal(topsis.ranking[0].name, '方案A-分布式协同');
  assert.equal(topsis.ranking[0].rank, 1);
  assert.equal(topsis.ranking[2].name, '方案C-单机长程强突');
});
