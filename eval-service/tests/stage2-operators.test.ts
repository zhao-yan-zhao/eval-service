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

test('算子注册表包含 38 个唯一内置算子并按五类完整覆盖', () => {
  const metas = listOperatorMetas().filter((m) => !m.isCustom);
  assert.equal(metas.length, 38);
  const ids = new Set(metas.map((m) => m.id));
  assert.equal(ids.size, 38);

  const byCat = metas.reduce<Record<string, number>>((acc, m) => {
    acc[m.category] = (acc[m.category] ?? 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(byCat, {
    time: 9,
    effectiveness: 12,
    situation: 8,
    compliance: 5,
    cost: 4,
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

  // 无 criteria 时任务达成率必须 fail-closed
  const noCriteria = evaluateOperator('eff.mission_success_rate', ctx);
  assert.equal(noCriteria.status, 'unavailable');

  // 注入显式判据时输出命中率与 Wilson 95% CI
  situation.criteriaResults = { iter_1: true, iter_2: true, iter_3: false, iter_4: true };
  const withCriteria = evaluateOperator('eff.mission_success_rate', ctx);
  assert.equal(withCriteria.status, 'valid');
  assert.equal(withCriteria.value, 0.75);
  assert.ok((withCriteria.details?.wilson95 as { lower: number; upper: number }).lower > 0.25);

  // 红方 3 枚 PL-15 终局仅 1 次 KILL (2 MISS)，POINTDEF:FAILURE 行不重复计数
  const hitRate = evaluateOperator('eff.hit_rate', ctx);
  assert.equal(hitRate.status, 'valid');
  assert.ok(Math.abs(Number(hitRate.value) - 1 / 3) < 1e-3);

  // 蓝方部署过 Generic Chaff 干扰，红方末端突防应给出 1.0 (3/3)
  const penRed = evaluateOperator('eff.target_penetration_rate', ctx);
  assert.equal(penRed.status, 'valid');
  assert.equal(penRed.value, 1);

  // 若切换至蓝方攻击视角（GJ-11 未部署点防），必须 fail-closed
  const penBlue = evaluateOperator('eff.target_penetration_rate', {
    ...ctx,
    customParams: { targetSide: '蓝方', enemySide: '红方' },
  });
  assert.equal(penBlue.status, 'unavailable');

  // 无单价时 cost.munitions_cost_total 降级为消耗枚数，cost.economic_exchange_ratio fail-closed
  const ammoNoPrice = evaluateOperator('cost.munitions_cost_total', ctx);
  assert.equal(ammoNoPrice.status, 'degraded');
  assert.equal(ammoNoPrice.value, 3);

  const econNoPrice = evaluateOperator('cost.economic_exchange_ratio', ctx);
  assert.equal(econNoPrice.status, 'unavailable');

  // 注入单价表后两个成本算子均转 valid
  const ctxWithPrices = {
    ...ctx,
    customParams: {
      ...ctx.customParams,
      unitPrices: {
        'CH-AA-10 Abaddon [PL-15]': 150,
        '东-HaveRaider #1': 3000,
        'Have Raider UCAV': 3000,
        '4773': 3000,
      },
    },
  };
  const ammoWithPrice = evaluateOperator('cost.munitions_cost_total', ctxWithPrices);
  assert.equal(ammoWithPrice.status, 'valid');
  assert.equal(ammoWithPrice.value, 450);

  const econWithPrice = evaluateOperator('cost.economic_exchange_ratio', ctxWithPrices);
  assert.equal(econWithPrice.status, 'valid');
  assert.ok(Math.abs(Number(econWithPrice.value) - 3000 / 450) < 0.05);
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
  assert.equal(Object.keys(builtinResults).length, 38);
  // Batch B 默认缺失数据时绝不造假，均保持 unavailable
  assert.equal(all['eff.target_penetration_rate'].status, 'unavailable');
  assert.equal(all['comp.wra_compliance'].status, 'unavailable');
  assert.equal(all['eff.air_ops_sortie_completion'].status, 'unavailable');
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
  const corRes = evaluateOperator('comp.corridor_compliance', {
    runId: 'geo-test',
    situation: sim,
  });
  assert.equal(corRes.status, 'valid');
  assert.ok(Math.abs(Number(corRes.value) - 4 / 6) < 1e-3);

  // 抵达经线 120.85：r2 在 120s 到达，r1 约在 ~112s 穿过 -> 极差 < 15s
  const arrRes = evaluateOperator('sit.geometry_arrival_delta', {
    runId: 'geo-test',
    situation: sim,
    customParams: { arrivalLineLon: 120.85 },
  });
  assert.equal(arrRes.status, 'valid');
  assert.ok(Number(arrRes.value) >= 0 && Number(arrRes.value) <= 15);
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

test('eff.target_identification_rate 目标识别率：真值绑定、分方匹配、去重与武器清洗闭环', () => {
  const sim = createEmptySituationModel('id-rate-test', 'synthetic');
  sim.sides = ['红方', '蓝方'];
  sim.coverage.hasContacts = true;

  // 1. 创建蓝方目标实体 (包含 3 个核心装备 + 2 个武器/诱饵消耗品)
  const createUnit = (id: string, name: string, side: string, type: string, uClass: string): SituationUnit => ({
    unitId: id,
    unitName: name,
    side,
    unitType: type,
    unitClass: uClass,
    firstSeenSeconds: 0,
    firstSeenClock: '00:00:00',
    lastSeenSeconds: 120,
    lastSeenClock: '00:02:00',
    isDestroyed: false,
    damageState: 'ok',
    ammoInitial: 0,
    ammoRemaining: 0,
    emconStates: [],
    trackPoints: [],
  });

  sim.units.set('b_air_1', createUnit('b_air_1', 'F-16_#1', '蓝方', 'Aircraft', 'F-16C'));
  sim.units.set('b_air_2', createUnit('b_air_2', 'F-35_#1', '蓝方', 'Aircraft', 'F-35A'));
  sim.units.set('b_ship_1', createUnit('b_ship_1', 'DDG_#1', '蓝方', 'Ship', 'Arleigh Burke'));
  sim.units.set('b_msl_1', createUnit('b_msl_1', 'AIM-120_#1', '蓝方', 'Weapon', 'AIM-120D')); // 武器弹药：应剔除
  sim.units.set('b_decoy_1', createUnit('b_decoy_1', 'Decoy_#1', '蓝方', 'Decoy', 'MALD'));   // 诱饵：应剔除

  // 2. 创建探测接触 (红方建立)
  // c1: 探测到 b_air_1，达到 KnownClass
  sim.contacts.set('cnt_01', {
    contactId: 'cnt_01',
    targetUnitId: 'b_air_1',
    targetUnitName: '目标-01',
    detectedBySide: '红方',
    firstSeenSeconds: 10,
    firstSeenClock: '00:00:10',
    lastSeenSeconds: 30,
    lastSeenClock: '00:00:30',
    isLost: false,
    cumulativeDetectedSeconds: 20,
    lostIntervals: [],
    identificationHistory: [
      { scenarioSeconds: 10, clockText: '00:00:10', status: 'Unknown', ref: 'csv#1' },
      { scenarioSeconds: 20, clockText: '00:00:20', status: 'KnownClass', ref: 'csv#2' },
    ],
  });

  // c2: 另一传感器再次探测到 b_air_1 (多接触指向同一目标)，达到 PreciseID -> 验证去重
  sim.contacts.set('cnt_02', {
    contactId: 'cnt_02',
    targetUnitId: 'b_air_1',
    targetUnitName: '目标-02',
    detectedBySide: '红方',
    firstSeenSeconds: 25,
    firstSeenClock: '00:00:25',
    lastSeenSeconds: 50,
    lastSeenClock: '00:00:50',
    isLost: false,
    cumulativeDetectedSeconds: 25,
    lostIntervals: [],
    identificationHistory: [
      { scenarioSeconds: 40, clockText: '00:00:40', status: 'PreciseID', ref: 'csv#3' },
    ],
  });

  // c3: 探测到 b_air_2，达到 KnownType
  sim.contacts.set('cnt_03', {
    contactId: 'cnt_03',
    targetUnitId: 'b_air_2',
    targetUnitName: '目标-03',
    detectedBySide: '红方',
    firstSeenSeconds: 30,
    firstSeenClock: '00:00:30',
    lastSeenSeconds: 60,
    lastSeenClock: '00:01:00',
    isLost: false,
    cumulativeDetectedSeconds: 30,
    lostIntervals: [],
    identificationHistory: [
      { scenarioSeconds: 35, clockText: '00:00:35', status: 'KnownType', ref: 'csv#4' },
    ],
  });

  // c4: 探测到 b_ship_1，但仅达到 KnownDomain (仅探测，未达到识别)
  sim.contacts.set('cnt_04', {
    contactId: 'cnt_04',
    targetUnitId: 'b_ship_1',
    targetUnitName: '目标-04',
    detectedBySide: '红方',
    firstSeenSeconds: 15,
    firstSeenClock: '00:00:15',
    lastSeenSeconds: 80,
    lastSeenClock: '00:01:20',
    isLost: false,
    cumulativeDetectedSeconds: 65,
    lostIntervals: [],
    identificationHistory: [
      { scenarioSeconds: 20, clockText: '00:00:20', status: 'KnownDomain', ref: 'csv#5' },
    ],
  });

  // c5: 蓝方自身对 b_ship_1 的自探测 (PreciseID) -> 探测方非红方，必须隔离不计入
  sim.contacts.set('cnt_05', {
    contactId: 'cnt_05',
    targetUnitId: 'b_ship_1',
    targetUnitName: '友军-01',
    detectedBySide: '蓝方',
    firstSeenSeconds: 10,
    firstSeenClock: '00:00:10',
    lastSeenSeconds: 80,
    lastSeenClock: '00:01:20',
    isLost: false,
    cumulativeDetectedSeconds: 70,
    lostIntervals: [],
    identificationHistory: [
      { scenarioSeconds: 10, clockText: '00:00:10', status: 'PreciseID', ref: 'csv#6' },
    ],
  });

  // 评测 1：默认门限 KnownType (识别 b_air_1, b_air_2 -> 2个；总装备 3个 -> 2/3 = 66.7%)
  const resDefault = evaluateOperator('eff.target_identification_rate', {
    runId: 'test-id-1',
    situation: sim,
    customParams: { targetSide: '红方', enemySide: '蓝方' },
  });
  assert.equal(resDefault.status, 'valid');
  assert.equal(resDefault.value, 0.6667);
  assert.equal(resDefault.displayValue, '66.7% (识别 2 / 装备 3)');
  assert.equal((resDefault.details as Record<string, unknown>).identifiedUnitCount, 2);
  assert.equal((resDefault.details as Record<string, unknown>).totalTargetEquipmentCount, 3);

  // 评测 2：更严门限 KnownClass (仅 b_air_1 达到 -> 1/3 = 33.3%)
  const resStrict = evaluateOperator('eff.target_identification_rate', {
    runId: 'test-id-2',
    situation: sim,
    customParams: { targetSide: '红方', enemySide: '蓝方', identificationThreshold: 'KnownClass' },
  });
  assert.equal(resStrict.status, 'valid');
  assert.equal(resStrict.value, 0.3333);
  assert.equal(resStrict.displayValue, '33.3% (识别 1 / 装备 3)');

  // 评测 3：缺省日志时 fail-closed 返回 unavailable
  const emptySim = createEmptySituationModel('empty-test', 'synthetic');
  emptySim.sides = ['红方', '蓝方'];
  const resUnavailable = evaluateOperator('eff.target_identification_rate', {
    runId: 'test-id-3',
    situation: emptySim,
  });
  assert.equal(resUnavailable.status, 'unavailable');
});
