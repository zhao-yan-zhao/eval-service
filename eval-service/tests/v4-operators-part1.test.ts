import assert from 'node:assert/strict';
import test, { after, describe } from 'node:test';
import { createPythonWorkerPool, type PythonTableInput } from '../src/engine/python-worker.ts';
import { V4_OPERATORS_PART1 } from '../src/operators/v4/scripts-part1.ts';
import type { V4OperatorScriptSpec } from '../src/operators/v4/types.ts';

const EXPECTED_27_IDS = [
  'strike.damage_simulation',
  'strike.single_mission_metrics',
  'strike.composite_mission_metrics',
  'patrol.unit_completion_status',
  'patrol.single_mission_metrics',
  'patrol.composite_mission_metrics',
  'support.unit_completion_status',
  'support.single_mission_metrics',
  'support.composite_mission_metrics',
  'detection.unit_detection',
  'detection.model_detection',
  'fire_control.unit_identification',
  'fire_control.model_identification',
  'fire_control.unit_kill_chain_closure',
  'fire_control.model_kill_chain_closure_time',
  'weapon.platform_launch_status',
  'weapon.platform_launch_metrics',
  'weapon.munition_engagement_status',
  'weapon.munition_effectiveness_by_model',
  'weapon.munition_effectiveness_by_target',
  'weapon.penetration_metrics',
  'weapon.engagement_range',
  'cost.side_attrition_metrics',
  'cost.side_exchange_ratio',
  'cost.aircraft_losses_by_model',
  'cost.mission_attrition_metrics',
  'cost.platform_damage_probability',
] as const;

function byId(id: string): V4OperatorScriptSpec {
  const found = V4_OPERATORS_PART1.find((s) => s.id === id);
  assert.ok(found, `Missing V4 operator spec: ${id}`);
  return found;
}

function buildSyntheticTables(): Record<string, PythonTableInput> {
  return {
    SideCreated: [
      { SideName: '红方', SideID: 'S_RED' },
      { SideName: '蓝方', SideID: 'S_BLUE' },
    ],
    UnitCreated: [
      // Strike units & targets
      { UnitID: 'R_STRK_1', UnitName: 'J-16 #1', UnitType: '飞机', UnitClass: 'J-16', UnitSide: '红方', Crew: 2, Cost: 4.5e8 },
      { UnitID: 'R_STRK_2', UnitName: 'J-16 #2', UnitType: '飞机', UnitClass: 'J-16', UnitSide: '红方', Crew: 2, Cost: 4.5e8 },
      { UnitID: 'B_TGT_1', UnitName: '雷达站-1', UnitType: '设施', UnitClass: 'SAM-Radar', UnitSide: '蓝方', Crew: 10, Cost: 2.0e8 },
      { UnitID: 'B_TGT_2', UnitName: '驱逐舰-1', UnitType: '舰船', UnitClass: 'DDG-51', UnitSide: '蓝方', Crew: 300, Cost: 1.4e10 },
      { UnitID: 'B_TGT_3', UnitName: '油库-1', UnitType: 'Facility', UnitClass: 'Depot', UnitSide: '蓝方', Crew: 5, Cost: 5.0e7 },
      // Patrol & Support units
      { UnitID: 'R_PAT_1', UnitName: 'J-20 #1', UnitType: 'Aircraft', UnitClass: 'J-20', UnitSide: '红方', Crew: 1, Cost: 6.0e8 },
      { UnitID: 'R_SUP_1', UnitName: 'KJ-500 #1', UnitType: '飞机', UnitClass: 'KJ-500', UnitSide: '红方', Crew: 6, Cost: 5.0e8 },
      { UnitID: 'B_FTR_1', UnitName: 'F-16 #1', UnitType: 'Aircraft', UnitClass: 'F-16C', UnitSide: '蓝方', Crew: 1, Cost: 3.5e8 },
      // Weapon & Group instances that MUST be excluded from platform attrition/losses
      { UnitID: 'W_MISSILE_1', UnitName: 'YJ-18 #1', UnitType: '武器', UnitClass: 'YJ-18', UnitSide: '红方', Crew: 0, Cost: 8.0e6 },
      { UnitID: 'G_GRP_1', UnitName: '打击编组', UnitType: '编组', UnitClass: 'Group', UnitSide: '红方', Crew: 0, Cost: 0 },
    ],
    MissionChanged: [
      { MissionID: 'M_STRK_1', MissionName: '对海突击-1', Side: '红方', MissionClass: 'Strike', SubClass: 'Maritime_Strike' },
      { MissionID: 'M_STRK_INT', MissionName: '防空截击(应排除)', Side: '蓝方', MissionClass: 'Strike', SubClass: 'Air_Intercept' },
      { MissionID: 'M_PAT_1', MissionName: '海峡北巡逻', Side: '红方', MissionClass: 'Patrol', SubClass: 'AAW' },
      { MissionID: 'M_SUP_1', MissionName: '预警支援航线', Side: '红方', MissionClass: 'Support', SubClass: 'ContinousLoop' },
      { MissionID: 'M_SUP_SINGLE', MissionName: '单点支援', Side: '蓝方', MissionClass: 'Support', SubClass: 'ContinousLoop' },
    ],
    MissionRefPointRelationChanged: [
      // Concave-safe ordered polygon for M_PAT_1: [120,24] -> [122,24] -> [122,26] -> [120,26]
      { MissionID: 'M_PAT_1', Type: 'Patrol', Longitude: 120.0, Latitude: 24.0 },
      { MissionID: 'M_PAT_1', Type: 'Patrol', Longitude: 122.0, Latitude: 24.0 },
      { MissionID: 'M_PAT_1', Type: 'Patrol', Longitude: 122.0, Latitude: 26.0 },
      { MissionID: 'M_PAT_1', Type: 'Patrol', Longitude: 120.0, Latitude: 26.0 },
      // NavigationCourse polyline for M_SUP_1
      { MissionID: 'M_SUP_1', Type: 'NavigationCourse', Longitude: 119.0, Latitude: 25.0 },
      { MissionID: 'M_SUP_1', Type: 'NavigationCourse', Longitude: 120.0, Latitude: 25.0 },
      // Single-point NavigationCourse for M_SUP_SINGLE
      { MissionID: 'M_SUP_SINGLE', Type: 'NavigationCourse', Longitude: 124.0, Latitude: 23.0 },
    ],
    MissionUnitRelationChanged: [
      // M_STRK_1: 2 assigned, 3 strike targets (T1 60% dmg, T2 20% dmg + Losses=1.0, T3 0% dmg)
      { MissionID: 'M_STRK_1', UnitID: 'R_STRK_1', Type: 'Assigned' },
      { MissionID: 'M_STRK_1', UnitID: 'R_STRK_2', Type: 'Assigned' },
      { MissionID: 'M_STRK_1', UnitID: 'B_TGT_1', Type: 'StrikeActiveUnit' },
      { MissionID: 'M_STRK_1', UnitID: 'B_TGT_2', Type: 'StrikeActiveUnit' },
      { MissionID: 'M_STRK_1', UnitID: 'B_TGT_3', Type: 'StrikeActiveUnit' },
      // M_PAT_1
      { MissionID: 'M_PAT_1', UnitID: 'R_PAT_1', Type: 'Assigned' },
      // M_SUP_1 & M_SUP_SINGLE
      { MissionID: 'M_SUP_1', UnitID: 'R_SUP_1', Type: 'Assigned' },
      { MissionID: 'M_SUP_SINGLE', UnitID: 'B_FTR_1', Type: 'Assigned' },
    ],
    UnitPositions: [
      // R_STRK_1: 3 non-empty 5s windows (00:00:00, 00:00:05, 00:00:10) => (3-1)*5 = 10.0s
      { Time: '2026-06-01T00:00:00Z', UnitID: 'R_STRK_1', UnitLongitude: 119.5, UnitLatitude: 24.5 },
      { Time: '2026-06-01T00:00:05Z', UnitID: 'R_STRK_1', UnitLongitude: 119.6, UnitLatitude: 24.5 },
      { Time: '2026-06-01T00:00:10Z', UnitID: 'R_STRK_1', UnitLongitude: 119.7, UnitLatitude: 24.5 },
      // R_PAT_1: 3 points inside polygon at 00:01:00, 00:01:05, 00:01:10 (and 1 outside) => 3*5 = 15.0s
      { Time: '2026-06-01T00:00:50Z', UnitID: 'R_PAT_1', UnitLongitude: 118.0, UnitLatitude: 24.5 },
      { Time: '2026-06-01T00:01:00Z', UnitID: 'R_PAT_1', UnitLongitude: 121.0, UnitLatitude: 25.0 },
      { Time: '2026-06-01T00:01:05Z', UnitID: 'R_PAT_1', UnitLongitude: 121.2, UnitLatitude: 25.1 },
      { Time: '2026-06-01T00:01:10Z', UnitID: 'R_PAT_1', UnitLongitude: 121.4, UnitLatitude: 25.2 },
      // R_SUP_1: 2 points within 0.5 deg of (119,25)-(120,25) => 2*5 = 10.0s
      { Time: '2026-06-01T00:02:00Z', UnitID: 'R_SUP_1', UnitLongitude: 119.5, UnitLatitude: 25.2 },
      { Time: '2026-06-01T00:02:05Z', UnitID: 'R_SUP_1', UnitLongitude: 119.8, UnitLatitude: 25.3 },
      // B_FTR_1: 1 point near (124,23) => 1*5 = 5.0s
      { Time: '2026-06-01T00:03:00Z', UnitID: 'B_FTR_1', UnitLongitude: 124.1, UnitLatitude: 23.1 },
    ],
    UnitDamaged: [
      { UnitID: 'B_TGT_1', DamagePercent: 60.0 }, // 0.60 -> heavy (>0.5)
      { UnitID: 'B_TGT_2', DamagePercent: 20.0 }, // 0.20, overridden to 1.0 in strike & destroyed in cost
      { UnitID: 'R_PAT_1', DamagePercent: 30.0 }, // 0.30 -> medium (>0.25)
    ],
    Losses: [
      { SubjectID: 'B_TGT_2' },
      { SubjectID: 'B_FTR_1' },
    ],
    UnitDestroyed: [
      { UnitID: 'B_TGT_2', UnitName: '驱逐舰-1', Time: '2026-06-01T00:05:00Z', Reason: '导弹击沉', Cause: 'Impact' },
      { UnitID: 'B_FTR_1', UnitName: 'F-16 #1', Time: '2026-06-01T00:06:00Z', Reason: '空战击落', Cause: 'Weapon Interaction' },
      // Weapon instances in UnitDestroyed (for flight time + self-destruction)
      { UnitID: 'W_1', UnitName: 'YJ-18 #1', Time: '2026-06-01T00:05:00Z', Reason: '命中目标', Cause: 'Impact' },
      { UnitID: 'W_2', UnitName: 'YJ-18 #2', Time: '2026-06-01T00:05:10Z', Reason: '被拦截', Cause: 'Weapon Interaction' },
      { UnitID: 'W_3', UnitName: 'YJ-18 #3', Time: '2026-06-01T00:05:20Z', Reason: '燃料耗尽', Cause: '-' },
      { UnitID: 'W_MISSILE_1', UnitName: 'YJ-18 #1', Time: '2026-06-01T00:05:30Z', Reason: '自毁', Cause: '-' },
    ],
    EngagementCycle: [
      { ContactID: 'C_1', ContactActualUnitID: 'B_TGT_2', ContactActualUnitName: '驱逐舰-1', ContactActualUnitClass: 'DDG-51' },
      { ContactID: 'C_2', ContactActualUnitID: 'B_FTR_1', ContactActualUnitName: 'F-16 #1', ContactActualUnitClass: 'F-16C' },
      // C_UNMAPPED intentionally omitted from EngagementCycle
    ],
    DetectionIdentificationChanged: [
      {
        Time: '2026-06-01T00:01:00Z',
        ContactID: 'C_1',
        ContactName: 'SKUNK #1',
        IdentificationStatus: 'KnownDomain',
        SensorName: 'Sea-Radar',
        SensorPlatformName: 'KJ-500 #1',
        SensorPlatformID: 'R_SUP_1',
        ContactRangeHoriz_nm: 120.0,
      },
      {
        Time: '2026-06-01T00:01:00Z',
        ContactID: 'C_1',
        ContactName: 'SKUNK #1',
        IdentificationStatus: 'KnownType',
        SensorName: 'Sea-Radar',
        SensorPlatformName: 'KJ-500 #1',
        SensorPlatformID: 'R_SUP_1',
        ContactRangeHoriz_nm: 110.0,
      },
      {
        Time: '2026-06-01T00:02:00Z',
        ContactID: 'C_1',
        ContactName: 'SKUNK #1',
        IdentificationStatus: 'KnownClass',
        SensorName: 'Sea-Radar',
        SensorPlatformName: 'KJ-500 #1',
        SensorPlatformID: 'R_SUP_1',
        ContactRangeHoriz_nm: 90.0,
      },
      // C_2: only PreciseID (no earlier detection -> backfill from identification!)
      {
        Time: '2026-06-01T00:02:30Z',
        ContactID: 'C_2',
        ContactName: 'BOGEY #2',
        IdentificationStatus: 'PreciseID',
        SensorName: 'AESA-Radar',
        SensorPlatformName: 'J-20 #1',
        SensorPlatformID: 'R_PAT_1',
        ContactRangeHoriz_nm: 80.0,
      },
      // Unknown should be ignored
      {
        Time: '2026-06-01T00:00:30Z',
        ContactID: 'C_1',
        ContactName: 'SKUNK #1',
        IdentificationStatus: 'Unknown',
        SensorName: 'Sea-Radar',
        SensorPlatformName: 'KJ-500 #1',
        SensorPlatformID: 'R_SUP_1',
        ContactRangeHoriz_nm: 150.0,
      },
      // Unmapped contact should be dropped by inner join
      {
        Time: '2026-06-01T00:01:10Z',
        ContactID: 'C_UNMAPPED',
        ContactName: 'GHOST',
        IdentificationStatus: 'KnownClass',
        SensorName: 'AESA-Radar',
        SensorPlatformName: 'J-20 #1',
        SensorPlatformID: 'R_PAT_1',
        ContactRangeHoriz_nm: 200.0,
      },
    ],
    WeaponFired: [
      {
        Time: '2026-06-01T00:03:00Z',
        WeaponID: 'W_1',
        WeaponName: 'YJ-18 #1',
        WeaponClass: 'YJ-18',
        FiringUnitID: 'R_STRK_1',
        FiringUnitName: 'J-16 #1',
        FiringUnitClass: 'J-16',
        FiringUnitSide: '红方',
        TargetContactActualUnitID: 'B_TGT_2',
        TargetContactActualUnitName: '驱逐舰-1',
        TargetContactRangeHoriz_nm: 85.5,
      },
      {
        Time: '2026-06-01T00:03:10Z',
        WeaponID: 'W_2',
        WeaponName: 'YJ-18 #2',
        WeaponClass: 'YJ-18',
        FiringUnitID: 'R_STRK_1',
        FiringUnitName: 'J-16 #1',
        FiringUnitClass: 'J-16',
        FiringUnitSide: '红方',
        TargetContactActualUnitID: 'B_TGT_2',
        TargetContactActualUnitName: '驱逐舰-1',
        TargetContactRangeHoriz_nm: 80.5,
      },
      {
        Time: '2026-06-01T00:03:20Z',
        WeaponID: 'W_3',
        WeaponName: 'YJ-18 #3',
        WeaponClass: 'YJ-18',
        FiringUnitID: 'R_STRK_2',
        FiringUnitName: 'J-16 #2',
        FiringUnitClass: 'J-16',
        FiringUnitSide: '红方',
        TargetContactActualUnitID: 'B_TGT_1',
        TargetContactActualUnitName: '雷达站-1',
        TargetContactRangeHoriz_nm: 60.0,
      },
      {
        Time: '2026-06-01T00:03:30Z',
        WeaponID: 'W_4',
        WeaponName: 'PL-15 #4',
        WeaponClass: 'PL-15',
        FiringUnitID: 'R_PAT_1',
        FiringUnitName: 'J-20 #1',
        FiringUnitClass: 'J-20',
        FiringUnitSide: '红方',
        TargetContactActualUnitID: 'B_FTR_1',
        TargetContactActualUnitName: 'F-16 #1',
        TargetContactRangeHoriz_nm: 55.0,
      },
      {
        Time: '2026-06-01T00:04:00Z',
        WeaponID: 'W_5',
        WeaponName: 'AIM-120D #5',
        WeaponClass: 'AIM-120D',
        FiringUnitID: 'B_FTR_1',
        FiringUnitName: 'F-16 #1',
        FiringUnitClass: 'F-16C',
        FiringUnitSide: '蓝方',
        TargetContactActualUnitID: 'R_PAT_1',
        TargetContactActualUnitName: 'J-20 #1',
        TargetContactRangeHoriz_nm: 40.0,
      },
    ],
    WeaponEndgame: [
      // Dual-row for W_1: POINTDEF:FAILURE ("No point defence systems employed") + KILL
      {
        WeaponID: 'W_1',
        WeaponName: 'YJ-18 #1',
        TargetID: 'B_TGT_2',
        Result: 'POINTDEF:FAILURE',
        EndgameMessage: 'No point defence systems employed by 驱逐舰-1 against weapon YJ-18 #1',
      },
      {
        WeaponID: 'W_1',
        WeaponName: 'YJ-18 #1',
        TargetID: 'B_TGT_2',
        Result: 'KILL',
        EndgameMessage: '命中并摧毁',
      },
      // W_2 defeated by point defence on B_TGT_2 (real F1 POINTDEF:SUCCESS pattern)
      {
        WeaponID: 'W_2',
        WeaponName: 'YJ-18 #2',
        TargetID: 'B_TGT_2',
        Result: 'POINTDEF:SUCCESS',
        EndgameMessage: '近防系统成功拦截',
      },
      // W_4 killed B_FTR_1
      {
        WeaponID: 'W_4',
        WeaponName: 'PL-15 #4',
        TargetID: 'B_FTR_1',
        Result: 'KILL',
        EndgameMessage: '命中击落',
      },
      // W_5 malfunction
      {
        WeaponID: 'W_5',
        WeaponName: 'AIM-120D #5',
        TargetID: 'R_PAT_1',
        Result: 'MISS',
        EndgameMessage: '武器发生故障导致失锁',
      },
    ],
    Expenditures: [
      { Side: '红方', WeaponName: 'YJ-18', Num: 3 },
      { Side: '红方', WeaponName: 'PL-15', Num: 1 },
      { Side: '蓝方', WeaponName: 'AIM-120D', Num: 1 },
    ],
    FuelConsumed: [
      { UnitID: 'R_STRK_1', UnitSide: '红方', FuelType: 2001, FuelQuantity: 1200.5 },
      { UnitID: 'R_STRK_1', UnitSide: '红方', FuelType: 4001, FuelQuantity: 999.0 }, // non-aviation fuel filtered out
      { UnitID: 'B_FTR_1', UnitSide: '蓝方', FuelType: 2001, FuelQuantity: 600.25 },
    ],
  };
}

describe('V4 Operators Part 1 (Chapters 1~3, 27 Operators)', () => {
  const pool = createPythonWorkerPool({ timeoutMs: 15_000 });

  after(async () => {
    await pool.dispose();
  });

  test('1) exports exact 27 V4 operator specs with valid metadata and ParameterPortSpec ports', () => {
    assert.equal(V4_OPERATORS_PART1.length, 27);
    const ids = V4_OPERATORS_PART1.map((s) => s.id);
    assert.deepEqual(ids, [...EXPECTED_27_IDS]);
    assert.equal(new Set(ids).size, 27);

    for (const spec of V4_OPERATORS_PART1) {
      assert.ok(spec.name.length > 0);
      assert.ok([1, 2, 3].includes(spec.chapter));
      assert.ok(Array.isArray(spec.requiredTables) && spec.requiredTables.length > 0);
      assert.ok(Array.isArray(spec.outputColumns) && spec.outputColumns.length > 0);
      assert.ok(spec.pythonCode.includes('output_df'), `${spec.id} must assign output_df`);
      assert.ok(Array.isArray(spec.parameterPorts));
    }
  });

  test('2) executes all 27 operators on rich synthetic multi-table dataset with exact schemas', async () => {
    const tables = buildSyntheticTables();
    const outputsById = new Map<string, NonNullable<Awaited<ReturnType<typeof pool.execute>>['dataset']>>();

    for (const spec of V4_OPERATORS_PART1) {
      const res = await pool.execute({
        code: spec.pythonCode,
        inputDfDict: tables,
        prevOutputDf: spec.upstreamOperatorId ? (outputsById.get(spec.upstreamOperatorId) ?? null) : null,
        params: Object.fromEntries(spec.parameterPorts.map((p) => [p.key, p.defaultValue])),
      });

      assert.equal(res.success, true, `${spec.id} failed: ${res.error}`);
      assert.notEqual(res.securityBlocked, true, `${spec.id} hit AST security block`);
      assert.ok(res.dataset, `${spec.id} missing dataset`);
      assert.deepEqual(
        res.dataset.columns.map((c) => c.name),
        spec.outputColumns,
        `${spec.id} output columns mismatch`,
      );
      assert.ok(res.dataset.rows.length > 0, `${spec.id} expected non-empty rows`);
      outputsById.set(spec.id, res.dataset);
    }

    // Spot-check key numerical & domain semantics
    // 1.1.1 strike.damage_simulation: B_TGT_1=0.6 (True), B_TGT_2=1.0 (from Losses! True), B_TGT_3=0.0 (False)
    const dmgRows = outputsById.get('strike.damage_simulation')!.rows;
    const dmgByTarget = Object.fromEntries(dmgRows.map((r) => [String(r['目标ID']), r]));
    assert.equal(dmgByTarget['B_TGT_1']['目标损伤程度'], 0.6);
    assert.equal(dmgByTarget['B_TGT_1']['完成打击目标'], true);
    assert.equal(dmgByTarget['B_TGT_2']['目标损伤程度'], 1.0);
    assert.equal(dmgByTarget['B_TGT_2']['完成打击目标'], true);
    assert.equal(dmgByTarget['B_TGT_3']['目标损伤程度'], 0.0);
    assert.equal(dmgByTarget['B_TGT_3']['完成打击目标'], false);

    // 1.1.2 strike.single_mission_metrics: Air_Intercept excluded, M_STRK_1 duration=(3-1)*5=10s
    const strikeSingle = outputsById.get('strike.single_mission_metrics')!.rows;
    assert.equal(strikeSingle.length, 1);
    assert.equal(strikeSingle[0]['任务ID'], 'M_STRK_1');
    assert.equal(strikeSingle[0]['投入单元'], 2);
    assert.equal(strikeSingle[0]['目标数'], 3);
    assert.equal(strikeSingle[0]['摧毁目标数'], 1);
    assert.equal(strikeSingle[0]['命中目标数'], 2);
    assert.equal(strikeSingle[0]['持续时间'], 10);
    assert.equal(strikeSingle[0]['完成比'], 0);

    // 1.2.1 & 1.2.2 Patrol: N*5 = 3*5 = 15s (does NOT subtract 1)
    const patrolUnit = outputsById.get('patrol.unit_completion_status')!.rows;
    assert.equal(patrolUnit[0]['保持阵位秒数'], 15);
    assert.equal(patrolUnit[0]['损失'], false);

    // 1.3.1 & 1.3.2 Support: multi-point (10s) and single-point (5s)
    const supportSingle = outputsById.get('support.single_mission_metrics')!.rows;
    const supById = Object.fromEntries(supportSingle.map((r) => [String(r['任务ID']), r]));
    assert.equal(supById['M_SUP_1']['保持阵位秒数'], 10);
    assert.equal(supById['M_SUP_SINGLE']['保持阵位秒数'], 5);

    // 2.1.1 detection.unit_detection: (Time=00:01:00, KJ-500, 驱逐舰-1, Sea-Radar) averages 120 & 110 -> 115.0; unmapped C_UNMAPPED & Unknown dropped
    const unitDet = outputsById.get('detection.unit_detection')!.rows;
    assert.equal(unitDet.length, 3);
    const detAt01 = unitDet.find((r) => r['探测平台'] === 'KJ-500 #1' && r['首次发现距离'] === 115);
    assert.ok(detAt01, 'Expected mean distance 115.0 for duplicate timestamp detection group');

    // 2.2.3 kill chain closure: B_TGT_2 closed (300 - 60 = 240s), B_FTR_1 backfilled from PreciseID (360 - 150 = 210s)
    const kcRows = outputsById.get('fire_control.unit_kill_chain_closure')!.rows;
    const kcById = Object.fromEntries(kcRows.map((r) => [String(r['目标ID']), r]));
    assert.equal(kcById['B_TGT_2']['是否闭环'], true);
    assert.equal(kcById['B_TGT_2']['杀伤闭环总时长'], 240);
    assert.equal(kcById['B_TGT_2']['致命武器'], 'YJ-18 #1');
    assert.equal(kcById['B_FTR_1']['是否闭环'], true);
    assert.equal(kcById['B_FTR_1']['杀伤闭环总时长'], 210);
    assert.equal(kcById['B_TGT_1']['是否闭环'], false);

    // 2.3.3 munition_engagement_status: W_1=命中(KILL, deduped), W_2=被拦截(POINTDEF:SUCCESS), W_3=自毁(Cause='-'), W_4=命中(KILL), W_5=故障
    const munRows = outputsById.get('weapon.munition_engagement_status')!.rows;
    const munById = Object.fromEntries(munRows.map((r) => [String(r['武器ID']), r]));
    assert.equal(munById['W_1']['命中'], true);
    assert.equal(munById['W_1']['飞行时间'], 120);
    assert.equal(munById['W_2']['被拦截'], true);
    assert.equal(munById['W_3']['自毁'], true);
    assert.equal(munById['W_4']['命中'], true);
    assert.equal(munById['W_5']['故障'], true);
    assert.equal(munById['W_5']['未命中'], false);

    // 2.3.6 weapon.penetration_metrics: YJ-18 targeted 设施(1, self-destr) + 舰船(2: 1 hit, 1 intercepted) => 3 fired, 1 penetrated (W_1), 1 hit
    const penRows = outputsById.get('weapon.penetration_metrics')!.rows;
    assert.equal(penRows.length, 1);
    assert.equal(penRows[0]['武器型号'], 'YJ-18');
    assert.equal(penRows[0]['发射数'], 3);
    assert.equal(penRows[0]['穿透数'], 1);
    assert.equal(penRows[0]['命中数'], 1);

    // 3.1 cost.side_attrition_metrics: Red has 4 platforms (W_MISSILE_1 & G_GRP_1 excluded!), 0 lost; Blue has 4 platforms, 2 lost (B_TGT_2, B_FTR_1)
    const sideAttr = outputsById.get('cost.side_attrition_metrics')!.rows;
    const sideAttrMap = Object.fromEntries(sideAttr.map((r) => [String(r['分方']), r]));
    assert.equal(sideAttrMap['红方']['平台数'], 4);
    assert.equal(sideAttrMap['红方']['平台损失'], 0);
    assert.equal(sideAttrMap['红方']['航空燃油消耗'], 1200.5);
    assert.equal(sideAttrMap['蓝方']['平台数'], 4);
    assert.equal(sideAttrMap['蓝方']['平台损失'], 2);
    assert.equal(sideAttrMap['蓝方']['飞机损失'], 1);
    assert.equal(sideAttrMap['蓝方']['舰艇损失'], 1);
    assert.equal(sideAttrMap['蓝方']['战损率'], 0.5);

    // 3.2 cost.side_exchange_ratio: 红方/蓝方
    const exch = outputsById.get('cost.side_exchange_ratio')!.rows;
    assert.equal(exch.length, 1);
    assert.equal(exch[0]['分方比'], '红方/蓝方');
    assert.equal(exch[0]['战损比'], 1); // 4 / 4 platform count ratio
    assert.equal(exch[0]['交换比'], 0); // 0.0 / 0.5 attrition rate ratio
    assert.equal(exch[0]['存活比'], 2); // 1.0 / 0.5 survival rate ratio

    // 3.3 cost.aircraft_losses_by_model: ONLY F-16C lost=1 (W_MISSILE_1 excluded!)
    const airLoss = outputsById.get('cost.aircraft_losses_by_model')!.rows;
    assert.equal(airLoss.length, 1);
    assert.equal(airLoss[0]['分方'], '蓝方');
    assert.equal(airLoss[0]['飞机型号'], 'F-16C');
    assert.equal(airLoss[0]['损失数量'], 1);
  });

  test('3) parameter port overrides dynamically change outputs (damageThreshold, minOnStationSec, mediumThreshold)', async () => {
    const tables = buildSyntheticTables();

    // A) strike.damage_simulation: damageThreshold 0.5 vs 0.9
    const strikeSpec = byId('strike.damage_simulation');
    const res05 = await pool.execute({
      code: strikeSpec.pythonCode,
      inputDfDict: tables,
      params: { damageThreshold: 0.5 },
    });
    const res09 = await pool.execute({
      code: strikeSpec.pythonCode,
      inputDfDict: tables,
      params: { damageThreshold: 0.9 },
    });
    assert.equal(res05.success, true, res05.error);
    assert.equal(res09.success, true, res09.error);

    const map05 = Object.fromEntries(res05.dataset!.rows.map((r) => [String(r['目标ID']), r]));
    const map09 = Object.fromEntries(res09.dataset!.rows.map((r) => [String(r['目标ID']), r]));
    // B_TGT_1 has 0.6 damage: >= 0.5 is true, >= 0.9 is false!
    assert.equal(map05['B_TGT_1']['损伤比不小于'], 0.5);
    assert.equal(map05['B_TGT_1']['完成打击目标'], true);
    assert.equal(map09['B_TGT_1']['损伤比不小于'], 0.9);
    assert.equal(map09['B_TGT_1']['完成打击目标'], false);
    // B_TGT_2 was in Losses -> forced to 1.0 -> passes even 0.9
    assert.equal(map09['B_TGT_2']['完成打击目标'], true);

    // B) patrol.single_mission_metrics: minOnStationSec 10 vs 1800
    const patrolSpec = byId('patrol.single_mission_metrics');
    const patrolPass = await pool.execute({
      code: patrolSpec.pythonCode,
      inputDfDict: tables,
      params: { minOnStationSec: 10.0, maxLosses: 1 },
    });
    const patrolFail = await pool.execute({
      code: patrolSpec.pythonCode,
      inputDfDict: tables,
      params: { minOnStationSec: 1800.0, maxLosses: 1 },
    });
    assert.equal(patrolPass.dataset!.rows[0]['完成比'], 1);
    assert.equal(patrolFail.dataset!.rows[0]['完成比'], 0);

    // C) cost.platform_damage_probability: mediumThreshold 0.25 vs 0.40 changes R_PAT_1 (30%) from 中伤 to 轻伤
    const dmgProbSpec = byId('cost.platform_damage_probability');
    const probDefault = await pool.execute({
      code: dmgProbSpec.pythonCode,
      inputDfDict: tables,
      params: { lightThreshold: 0.0, mediumThreshold: 0.25, heavyThreshold: 0.5 },
    });
    const probRaised = await pool.execute({
      code: dmgProbSpec.pythonCode,
      inputDfDict: tables,
      params: { lightThreshold: 0.0, mediumThreshold: 0.4, heavyThreshold: 0.5 },
    });
    const redDefaultLevels = probDefault.dataset!.rows.filter((r) => r['分方'] === '红方').map((r) => r['毁伤等级']);
    const redRaisedLevels = probRaised.dataset!.rows.filter((r) => r['分方'] === '红方').map((r) => r['毁伤等级']);
    assert.ok(redDefaultLevels.includes('中伤'));
    assert.ok(!redRaisedLevels.includes('中伤'));
    assert.ok(redRaisedLevels.includes('轻伤'));
  });

  test('4) standalone fallback & missing optional tables (without prevOutputDf / FuelConsumed / SideCreated)', async () => {
    const tables = buildSyntheticTables();
    // Strip optional tables for cost & composite tests
    const minimalTables: Record<string, PythonTableInput> = {
      ...tables,
    };
    delete minimalTables.FuelConsumed;
    delete minimalTables.SideCreated;

    for (const id of [
      'strike.composite_mission_metrics',
      'patrol.composite_mission_metrics',
      'support.composite_mission_metrics',
      'fire_control.model_kill_chain_closure_time',
      'cost.side_attrition_metrics',
      'cost.side_exchange_ratio',
    ]) {
      const spec = byId(id);
      const res = await pool.execute({
        code: spec.pythonCode,
        inputDfDict: minimalTables,
        prevOutputDf: null,
        params: Object.fromEntries(spec.parameterPorts.map((p) => [p.key, p.defaultValue])),
      });
      assert.equal(res.success, true, `Standalone fallback failed for ${id}: ${res.error}`);
      assert.ok(res.dataset && res.dataset.rows.length > 0, `Standalone ${id} should produce rows`);
    }

    // WeaponName " #序号" fallback when WeaponClass is omitted
    const launchSpec = byId('weapon.platform_launch_status');
    const launchRes = await pool.execute({
      code: launchSpec.pythonCode,
      inputDfDict: {
        WeaponFired: [
          { FiringUnitSide: '红方', FiringUnitName: 'J-16 #1', WeaponName: 'PL-15 #107' },
          { FiringUnitSide: '红方', FiringUnitName: 'J-16 #1', WeaponName: 'PL-15 #108' },
        ],
      },
    });
    assert.equal(launchRes.success, true, launchRes.error);
    assert.equal(launchRes.dataset!.rows.length, 1);
    assert.equal(launchRes.dataset!.rows[0]['武器型号'], 'PL-15');
    assert.equal(launchRes.dataset!.rows[0]['发射数量'], 2);
  });

  test('5) all 27 operators handle completely empty tables cleanly without errors', async () => {
    for (const spec of V4_OPERATORS_PART1) {
      const res = await pool.execute({
        code: spec.pythonCode,
        inputDfDict: {},
        prevOutputDf: null,
        params: Object.fromEntries(spec.parameterPorts.map((p) => [p.key, p.defaultValue])),
      });
      assert.equal(res.success, true, `Empty-table run failed for ${spec.id}: ${res.error}`);
      assert.ok(res.dataset, `Missing dataset on empty run for ${spec.id}`);
      assert.deepEqual(
        res.dataset.columns.map((c) => c.name),
        spec.outputColumns,
        `Empty-table columns mismatch for ${spec.id}`,
      );
      assert.equal(res.dataset.rows.length, 0, `Empty-table run should return 0 rows for ${spec.id}`);
    }
  });

  test('6) handles F1 HH:MM:SS.fffffff clocks, partial kill chains, and zero-denominator exchange ratio', async () => {
    // A) Real F1 relative clock format + partial kill chain (only Detection + Destroyed -> closed!)
    const kcSpec = byId('fire_control.unit_kill_chain_closure');
    const kcRes = await pool.execute({
      code: kcSpec.pythonCode,
      inputDfDict: {
        UnitCreated: [
          { UnitID: 'U_PARTIAL', UnitName: 'Target-A', UnitClass: 'Ship-A', UnitSide: '蓝方' },
        ],
        EngagementCycle: [{ ContactID: 'CNT_1', ContactActualUnitID: 'U_PARTIAL' }],
        DetectionIdentificationChanged: [
          {
            Time: '00:01:29.1000000',
            ContactID: 'CNT_1',
            IdentificationStatus: 'KnownDomain',
            SensorPlatformName: 'Sensor-1',
          },
        ],
        UnitDestroyed: [{ UnitID: 'U_PARTIAL', Time: '00:02:29.1000000' }],
      },
    });
    assert.equal(kcRes.success, true, kcRes.error);
    assert.equal(kcRes.dataset!.rows.length, 1);
    assert.equal(kcRes.dataset!.rows[0]['是否闭环'], true);
    assert.equal(kcRes.dataset!.rows[0]['杀伤闭环总时长'], 60);

    // B) Zero-denominator division in cost.side_exchange_ratio -> null (no NaN JSON error)
    const exSpec = byId('cost.side_exchange_ratio');
    const exRes = await pool.execute({
      code: exSpec.pythonCode,
      inputDfDict: {
        UnitCreated: [
          { UnitID: 'R1', UnitType: '飞机', UnitSide: '红方' },
          { UnitID: 'B1', UnitType: '飞机', UnitSide: '蓝方' },
        ],
      },
    });
    assert.equal(exRes.success, true, exRes.error);
    assert.equal(exRes.dataset!.rows.length, 1);
    assert.equal(exRes.dataset!.rows[0]['平台损失比'], null);
    assert.equal(exRes.dataset!.rows[0]['交换比'], null);
    assert.equal(exRes.dataset!.rows[0]['存活比'], 1);

    // C) Synthetic interceptor-row POINTDEF:SUCCESS (TargetID is a fired weapon)
    const munSpec = byId('weapon.munition_engagement_status');
    const munRes = await pool.execute({
      code: munSpec.pythonCode,
      inputDfDict: {
        WeaponFired: [
          { Time: '00:00:10.0000000', WeaponID: 'ASM_1', WeaponName: 'YJ-18 #1', WeaponClass: 'YJ-18' },
          { Time: '00:00:20.0000000', WeaponID: 'PD_1', WeaponName: 'RAM #1', WeaponClass: 'RAM' },
        ],
        WeaponEndgame: [
          { WeaponID: 'PD_1', TargetID: 'ASM_1', Result: 'POINTDEF:SUCCESS', EndgameMessage: 'Intercepted' },
          { WeaponID: 'ASM_1', TargetID: 'SHIP_1', Result: 'POINTDEF:FAILURE', EndgameMessage: 'No point defence systems employed' },
        ],
      },
    });
    assert.equal(munRes.success, true, munRes.error);
    const munById = Object.fromEntries(munRes.dataset!.rows.map((r) => [String(r['武器ID']), r]));
    assert.equal(munById['ASM_1']['被拦截'], true);
    assert.equal(munById['PD_1']['被拦截'], false);
  });
});
