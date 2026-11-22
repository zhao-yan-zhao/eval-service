import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  OPERATORS_V3,
  OPERATOR_V3_MAP,
  listV3OperatorMetas,
  exportV3Catalog,
  buildV3OperatorDatabase,
} from '../src/operators/v3/index.ts';
import type { SituationModel, MetricAtomContext } from '../src/core/types.ts';

function createEmptySituation(): SituationModel {
  return {
    runId: 'test_run_v3_empty',
    scenarioPath: '/tmp/test.csv',
    startGameClock: '00:00:00',
    endGameClock: '01:00:00',
    totalGameSeconds: 3600,
    sides: ['Red', 'Blue'],
    units: new Map(),
    contacts: new Map(),
    weaponFiredEvents: [],
    weaponEndgameEvents: [],
    damageAndHitEvents: [],
    expenditures: [],
    losses: [],
    events: [],
    corridors: [],
    patrolAreas: [],
    threatZones: [],
  };
}

test('Stage 22: Operators v3 全量 42 个算子结构完整性与元数据审计', () => {
  assert.equal(OPERATORS_V3.length, 42, 'OPERATORS_V3 必须包含严格 42 个原子算子');
  assert.equal(OPERATOR_V3_MAP.size, 42, '算子 ID 必须全量唯一无冲突');

  const catalog = exportV3Catalog();
  assert.equal(catalog.totalCount, 42, '导出的 v3 Catalog 总数必须为 42');
  assert.equal(catalog.version, '3.0.0');

  const validRoles = new Set(['MOE', 'MOP', 'MOS', 'SURV', 'GATE']);
  const validDomains = new Set(['moe', 'kill_chain', 'weapon', 'survivability', 'suitability', 'roe', 'cost']);

  for (const op of OPERATORS_V3) {
    const meta = op.meta;
    assert.ok(meta.id && meta.id.length > 3, `算子必须具有有效 id: ${meta.id}`);
    assert.ok(meta.name && meta.name.length > 1, `算子必须具有中文名称: ${meta.id}`);
    assert.ok(meta.evalRole && validRoles.has(meta.evalRole), `算子 ${meta.id} 的 evalRole 必须合法: ${meta.evalRole}`);
    assert.ok(meta.domain && validDomains.has(meta.domain), `算子 ${meta.id} 的 domain 必须合法: ${meta.domain}`);
    assert.ok(meta.f1FieldContract, `算子 ${meta.id} 必须定义底层 f1FieldContract 字段契约`);
    assert.ok(Array.isArray(meta.f1FieldContract.csvTables), `算子 ${meta.id} 必须指定依赖的 CSV 表`);
    assert.equal(typeof op.evaluate, 'function', `算子 ${meta.id} 必须具备 evaluate 执行函数`);
  }
});

test('Stage 22: Operators v3 全量 42 个算子在空数据上执行时严格遵循 Fail-Closed 防伪造', () => {
  const emptyCtx: MetricAtomContext = {
    runId: 'test_run_v3_empty',
    situation: createEmptySituation(),
    customParams: { targetSide: 'Red', enemySide: 'Blue' },
  };

  for (const op of OPERATORS_V3) {
    const res = op.evaluate(emptyCtx);
    assert.ok(res, `算子 ${op.meta.id} 在空数据上执行必须返回结果`);
    assert.equal(res.atomId, op.meta.id, `返回结果 atomId 必须匹配`);

    // 对于红线友军误伤或 EMCON 等基线合规算子，空数据可返回 valid 且 0 次误伤 / 100% 合规
    // 其他需要事件的算子必须返回 unavailable，严禁伪造默认虚假数值
    if (res.status === 'unavailable') {
      assert.ok(res.missingDataReason, `算子 ${op.meta.id} unavailable 时必须提供明确 missingDataReason`);
      assert.equal(res.value, null, `unavailable 状态下 value 必须为 null`);
    } else {
      assert.equal(res.status, 'valid');
      assert.ok(
        ['roe.fratricide_count', 'roe.pid_before_fire_rate', 'roe.emcon_emission_discipline', 'kc.track_continuity_loss_max', 'kc.engagement_cycle_count', 'surv.ew_jammed_time_ratio', 'surv.c2_comm_availability', 'mos.docking_ops_recovery_rate', 'cost.munitions_expended_count'].includes(op.meta.id),
        `非红线/空事件基线算子在空数据上不应随意出 valid: ${op.meta.id}`,
      );
    }
  }
});

test('Stage 22: 新增 6 个 v3 扩展算子逻辑精准性实测', () => {
  const sit = createEmptySituation();

  // 1. 测试 isr.estimation_error_variance
  sit.units.set('target_u1', {
    unitId: 'target_u1',
    name: 'J-16 #1',
    side: 'Blue',
    unitClass: 'J-16',
    unitType: 'Aircraft',
    damageState: 'operational',
    damagePercent: 0,
    isDestroyed: false,
    ammoCount: 4,
    fuelPercent: 80,
    track: [
      { scenarioSeconds: 100, lon: 120.0, lat: 24.0, alt: 8000 },
      { scenarioSeconds: 110, lon: 120.1, lat: 24.1, alt: 8000 },
      { scenarioSeconds: 120, lon: 120.2, lat: 24.2, alt: 8000 },
    ],
  });

  sit.contacts.set('contact_c1', {
    contactId: 'contact_c1',
    actualUnitId: 'target_u1',
    side: 'Red',
    firstDetectionTime: { scenarioSeconds: 100, clockText: '00:01:40' },
    track: [
      // 存在微小扰动 (0.001 度约 111 米)
      { scenarioSeconds: 100, lon: 120.001, lat: 24.001, alt: 8000 },
      { scenarioSeconds: 110, lon: 120.102, lat: 24.101, alt: 8000 },
      { scenarioSeconds: 120, lon: 120.201, lat: 24.202, alt: 8000 },
    ],
  });

  const isrOp = OPERATOR_V3_MAP.get('isr.estimation_error_variance')!;
  const isrRes = isrOp.evaluate({ runId: 'v3_test', situation: sit });
  assert.equal(isrRes.status, 'valid');
  assert.ok(typeof isrRes.value === 'number' && isrRes.value > 0, '估测误差标准差应大于 0');

  // 2. 测试 wpn.terminal_miss_distance
  sit.weaponEndgameEvents.push({
    weaponId: 'missile_01',
    weaponName: 'PL-15',
    weaponSide: 'Red',
    targetId: 'target_u1',
    result: 'MISS',
    scenarioSeconds: 150,
    clockText: '00:02:30',
    distanceFromFiringUnitHoriz: 22.5,
    endgameMessage: 'Miss distance: 18.4 m. Point defence spoofed.',
  });

  const missOp = OPERATOR_V3_MAP.get('wpn.terminal_miss_distance')!;
  const missRes = missOp.evaluate({ runId: 'v3_test', situation: sit });
  assert.equal(missRes.status, 'valid');
  assert.equal(missRes.value, 18.4, '应准确正则解析脱靶量 18.4m');

  // 3. 测试 wpn.impact_cep
  sit.weaponImpactEvents = [
    { unitId: 'target_u1', scenarioSeconds: 150, clockText: '00:02:30', lon: 120.0, lat: 24.0, sourceRef: 'csv' },
    { unitId: 'target_u1', scenarioSeconds: 152, clockText: '00:02:32', lon: 120.0002, lat: 24.0001, sourceRef: 'csv' },
    { unitId: 'target_u1', scenarioSeconds: 155, clockText: '00:02:35', lon: 120.0001, lat: 24.0002, sourceRef: 'csv' },
  ];
  const cepOp = OPERATOR_V3_MAP.get('wpn.impact_cep')!;
  const cepRes = cepOp.evaluate({ runId: 'v3_test', situation: sit });
  assert.equal(cepRes.status, 'valid');
  assert.ok(typeof cepRes.value === 'number' && cepRes.value > 0, 'CEP 散布应正常计算');

  // 4. 测试 c2.group_cohesion_rate
  sit.units.set('friendly_wingman', {
    unitId: 'friendly_wingman',
    name: 'J-20 #2',
    side: 'Red',
    unitClass: 'J-20',
    unitType: 'Aircraft',
    damageState: 'operational',
    damagePercent: 0,
    isDestroyed: false,
    ammoCount: 4,
    fuelPercent: 90,
    track: [
      { scenarioSeconds: 100, lon: 119.98, lat: 24.0, alt: 9000 },
      { scenarioSeconds: 110, lon: 120.08, lat: 24.1, alt: 9000 },
    ],
  });
  sit.units.set('friendly_leader', {
    unitId: 'friendly_leader',
    name: 'J-20 #1',
    side: 'Red',
    unitClass: 'J-20',
    unitType: 'Aircraft',
    damageState: 'operational',
    damagePercent: 0,
    isDestroyed: false,
    ammoCount: 4,
    fuelPercent: 90,
    track: [
      { scenarioSeconds: 100, lon: 120.0, lat: 24.0, alt: 9000 },
      { scenarioSeconds: 110, lon: 120.1, lat: 24.1, alt: 9000 },
    ],
  });
  const cohesionOp = OPERATOR_V3_MAP.get('c2.group_cohesion_rate')!;
  const cohRes = cohesionOp.evaluate({ runId: 'v3_test', situation: sit, customParams: { targetSide: 'Red' } });
  assert.equal(cohRes.status, 'valid');
  assert.ok(typeof cohRes.value === 'number' && cohRes.value >= 0 && cohRes.value <= 1.0);

  // 5. 测试 mos.air_turnaround_time_avg
  sit.airOpsEvents = [
    { unitId: 'friendly_leader', unitName: 'J-20 #1', side: 'Red', action: 'Landing', scenarioSeconds: 1000, clockText: '00:16:40', sourceRef: 'csv' },
    { unitId: 'friendly_leader', unitName: 'J-20 #1', side: 'Red', action: 'TakeOff', scenarioSeconds: 2200, clockText: '00:36:40', sourceRef: 'csv' },
  ];
  const turnaroundOp = OPERATOR_V3_MAP.get('mos.air_turnaround_time_avg')!;
  const turnRes = turnaroundOp.evaluate({ runId: 'v3_test', situation: sit });
  assert.equal(turnRes.status, 'valid');
  assert.equal(turnRes.value, 20.0, '1200秒应换算为 20.0 分钟挂弹周转');
});

test('Stage 22: 42 项算子在全量作战模拟情境上的闭环求值验证', () => {
  const sit = createEmptySituation();
  // 注入红蓝对抗基本态势
  sit.units.set('b_f35_1', {
    unitId: 'b_f35_1',
    name: 'F-35A #1',
    side: 'Blue',
    unitClass: 'F-35A',
    unitType: 'Aircraft',
    damageState: 'operational',
    damagePercent: 0,
    isDestroyed: false,
    ammoCount: 2,
    fuelPercent: 75,
    track: [
      { scenarioSeconds: 60, lon: 120.0, lat: 24.0, alt: 9500 },
      { scenarioSeconds: 120, lon: 120.2, lat: 24.1, alt: 9500 },
    ],
  });

  sit.units.set('r_su35_1', {
    unitId: 'r_su35_1',
    name: 'Su-35 #1',
    side: 'Red',
    unitClass: 'Su-35',
    unitType: 'Aircraft',
    damageState: 'destroyed',
    damagePercent: 100,
    isDestroyed: true,
    ammoCount: 0,
    fuelPercent: 0,
    track: [
      { scenarioSeconds: 60, lon: 120.8, lat: 24.0, alt: 7500 },
      { scenarioSeconds: 120, lon: 120.6, lat: 24.0, alt: 7500 },
    ],
  });

  sit.weaponFiredEvents.push({
    weaponId: 'aim120_1',
    weaponName: 'AIM-120D',
    firerId: 'b_f35_1',
    firerSide: 'Blue',
    firerName: 'F-35A #1',
    targetContactId: 'c_su35_1',
    targetContactActualUnitId: 'r_su35_1',
    targetContactRangeHorizNm: 42.0,
    scenarioSeconds: 90,
    clockText: '00:01:30',
  });

  sit.weaponEndgameEvents.push({
    weaponId: 'aim120_1',
    weaponName: 'AIM-120D',
    weaponSide: 'Blue',
    targetId: 'r_su35_1',
    targetSide: 'Red',
    result: 'KILL',
    scenarioSeconds: 135,
    clockText: '00:02:15',
    distanceFromFiringUnitHoriz: 38.0,
    endgameMessage: 'Direct hit. Target destroyed.',
  });

  const ctx: MetricAtomContext = {
    runId: 'v3_combat_test',
    situation: sit,
    customParams: { targetSide: 'Blue', enemySide: 'Red' },
  };

  // 1. 验证命中率 Ph (1/1 = 100%)
  const ph = OPERATOR_V3_MAP.get('wpn.probability_of_hit')!.evaluate(ctx);
  assert.equal(ph.status, 'valid');
  assert.equal(ph.value, 1.0);

  // 2. 验证单发杀伤率 Pssk (1/1 = 100%)
  const pssk = OPERATOR_V3_MAP.get('wpn.single_shot_pk')!.evaluate(ctx);
  assert.equal(pssk.status, 'valid');
  assert.equal(pssk.value, 1.0);

  // 3. 验证战损比 LER (敌损 1 : 己损 0)
  const ler = OPERATOR_V3_MAP.get('surv.loss_exchange_ratio')!.evaluate(ctx);
  assert.equal(ler.status, 'valid');
  assert.equal(ler.details?.zeroLossVictory, true);

  // 4. 验证防区外距离裕度 (42nm / 15nm MAR = 2.8x)
  const standoff = OPERATOR_V3_MAP.get('surv.standoff_launch_margin')!.evaluate(ctx);
  assert.equal(standoff.status, 'valid');
  assert.equal(standoff.value, 2.8);

  // 5. 验证友军误伤安全红线 (0次，合格)
  const fratricide = OPERATOR_V3_MAP.get('roe.fratricide_count')!.evaluate(ctx);
  assert.equal(fratricide.status, 'valid');
  assert.equal(fratricide.value, 0);
  assert.equal(fratricide.gateStatus, 'passed');

  // 6. 验证高度势能优势 (9500m - 7500m = +2000m)
  const altAdv = OPERATOR_V3_MAP.get('surv.kinematic_altitude_advantage')!.evaluate(ctx);
  assert.equal(altAdv.status, 'valid');
  assert.equal(altAdv.value, 2000.0);
});

test('Stage 22: Operators v3 SQLite 专属数据库构建与多维视图检索闭环', () => {
  const tmpDbPath = path.join(os.tmpdir(), `test-operators-v3-${Date.now()}.db`);
  try {
    const buildRes = buildV3OperatorDatabase(tmpDbPath);
    assert.equal(buildRes.operatorCount, 42);
    assert.equal(buildRes.pipelineCount, 42);
    assert.ok(fs.existsSync(tmpDbPath));

    const db = new DatabaseSync(tmpDbPath, { readOnly: true });

    // 1. 验证元数据
    const metaCount = (db.prepare("SELECT value FROM store_meta WHERE key = 'operator_count'").get() as any)?.value;
    assert.equal(metaCount, '42');

    // 2. 验证算子表
    const opRows = db.prepare('SELECT id, name, category, output_type FROM operator_definitions').all() as any[];
    assert.equal(opRows.length, 42);

    // 3. 验证视图检索
    const catalogRows = db.prepare("SELECT id, name, domain, eval_role FROM v_operator_catalog WHERE domain = 'weapon'").all() as any[];
    assert.equal(catalogRows.length, 8); // 8 个火力武器算子

    const gateRows = db.prepare("SELECT id, name FROM v_operator_catalog WHERE eval_role = 'GATE'").all() as any[];
    assert.equal(gateRows.length, 2); // 2 个安全红线 GATE

    // 4. 验证流水线表
    const pipeRows = db.prepare('SELECT operator_id, pipeline_title FROM operator_pipelines').all() as any[];
    assert.equal(pipeRows.length, 42);

    db.close();
  } finally {
    if (fs.existsSync(tmpDbPath)) {
      try {
        fs.unlinkSync(tmpDbPath);
      } catch {
        // cleanup ignore
      }
    }
  }
});


