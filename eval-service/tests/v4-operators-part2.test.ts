import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import { DagNodeCache } from '../src/engine/dag-executor.ts';
import {
  PythonWorkerPool,
  createPythonWorkerPool,
  disposeDefaultPythonWorkerPool,
} from '../src/engine/python-worker.ts';
import {
  V4_OPERATORS_PART2,
  type V4OperatorScriptSpecLike,
} from '../src/operators/v4/scripts-part2.ts';
import {
  V4OperatorRunner,
  runV4Operator,
  runV4OperatorDag,
} from '../src/operators/v4/v4-operator-runner.ts';

function writeDoubleBomCsv(filePath: string, headers: string[], rows: Array<Array<string | number | boolean>>): void {
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      r
        .map((cell) => {
          const s = String(cell);
          return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    ),
  ];
  // 真实 F1 EventExport_CSV 带有双 UTF-8 BOM (\xEF\xBB\xBF\xEF\xBB\xBF)
  const bom = Buffer.from([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf]);
  const body = Buffer.from(lines.join('\n') + '\n', 'utf8');
  fs.writeFileSync(filePath, Buffer.concat([bom, body]));
}

describe('V4 Operators Part 2 (Ch 4-7) & Fast csvDir Loader', () => {
  const pools: PythonWorkerPool[] = [];
  const tempDirs: string[] = [];

  function makePool(): PythonWorkerPool {
    const pool = createPythonWorkerPool({ timeoutMs: 20_000 });
    pools.push(pool);
    return pool;
  }

  function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  after(async () => {
    for (const p of pools) {
      await p.dispose();
    }
    await disposeDefaultPythonWorkerPool();
    for (const d of tempDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  test('1) exports exact 13 Ch 4-7 operator IDs and executes all 13 on synthetic multi-table datasets', async () => {
    const expectedIds = [
      'isr.reconnaissance_range',
      'isr.detection_rate',
      'isr.identification_latency',
      'isr.early_warning_time',
      'isr.radar_coverage_area',
      'c2.situational_completeness',
      'ew.jamming_duration',
      'ew.hf_comm_jamming_detail',
      'ew.hf_comm_jamming_side_summary',
      'air_defense.detection_zone',
      'air_defense.unit_intercept_zone',
      'air_defense.model_intercept_zone',
      'air_defense.composite_interception_probability',
    ];
    assert.equal(V4_OPERATORS_PART2.length, 13);
    assert.deepEqual(
      V4_OPERATORS_PART2.map((op) => op.id),
      expectedIds,
    );

    const pool = makePool();
    const runner = new V4OperatorRunner(V4_OPERATORS_PART2, {
      pythonPool: pool,
      cache: new DagNodeCache(),
    });

    const unitsTable = [
      {
        UnitID: 'B_AWACS_1',
        UnitDBID: 1001,
        UnitName: 'KJ-500 #1',
        UnitType: 'Aircraft',
        UnitClass: 'KJ-500',
        UnitSide: 'Blue',
      },
      {
        UnitID: 'B_SHIP_1',
        UnitDBID: 1002,
        UnitName: 'Type-055 #1',
        UnitType: 'Ship',
        UnitClass: 'Type-055',
        UnitSide: 'Blue',
      },
      {
        UnitID: 'B_SAM_1',
        UnitDBID: 2001,
        UnitName: 'HQ-9 Battery #1',
        UnitType: 'Facility',
        UnitClass: 'HQ-9',
        UnitSide: 'Blue',
      },
      {
        UnitID: 'B_SAM_2',
        UnitDBID: 2001,
        UnitName: 'HQ-9 Battery #2',
        UnitType: 'Facility',
        UnitClass: 'HQ-9',
        UnitSide: 'Blue',
      },
      {
        UnitID: 'B_VEH_1',
        UnitDBID: 2002,
        UnitName: 'Radar Vehicle #1',
        UnitType: 'Vehicle',
        UnitClass: 'YLC-8B',
        UnitSide: 'Blue',
      },
      {
        UnitID: 'B_GRP_1',
        UnitDBID: 2099,
        UnitName: 'Blue Air Wing',
        UnitType: 'Group',
        UnitClass: 'Group',
        UnitSide: 'Blue',
      },
      {
        UnitID: 'R_FTR_1',
        UnitDBID: 3001,
        UnitName: 'J-16 #1',
        UnitType: 'Aircraft',
        UnitClass: 'J-16',
        UnitSide: 'Red',
      },
      {
        UnitID: 'R_FTR_2',
        UnitDBID: 3001,
        UnitName: 'J-16 #2',
        UnitType: 'Aircraft',
        UnitClass: 'J-16',
        UnitSide: 'Red',
      },
      {
        UnitID: 'R_SHIP_1',
        UnitDBID: 3002,
        UnitName: 'Frigate #1',
        UnitType: 'Ship',
        UnitClass: 'FFG-X',
        UnitSide: 'Red',
      },
      {
        UnitID: 'R_MSL_1',
        UnitDBID: 9001,
        UnitName: 'YJ-18 #1',
        UnitType: 'Weapon',
        UnitClass: 'YJ-18',
        UnitSide: 'Red',
      },
      {
        UnitID: 'R_MSL_2',
        UnitDBID: 9001,
        UnitName: 'YJ-18 #2',
        UnitType: 'Weapon',
        UnitClass: 'YJ-18',
        UnitSide: 'Red',
      },
    ];

    const inputDfDict = {
      SideCreated: [
        { SideID: 'S_BLUE', SideName: 'Blue' },
        { SideID: 'S_RED', SideName: 'Red' },
      ],
      UnitCreated: unitsTable,
      ContactCreated: [
        { ContactID: 'C_R1', ActualUnitID: 'R_FTR_1', ActualUnitName: 'J-16 #1', Side: 'Blue' },
        { ContactID: 'C_R2', ActualUnitID: 'R_SHIP_1', ActualUnitName: 'Frigate #1', Side: 'Blue' },
        { ContactID: 'C_M1', ActualUnitID: 'R_MSL_1', ActualUnitName: 'YJ-18 #1', Side: 'Blue' },
        { ContactID: 'C_B1', ActualUnitID: 'B_AWACS_1', ActualUnitName: 'KJ-500 #1', Side: 'Red' },
      ],
      DetectionIdentificationChanged: [
        {
          Time: '2026-06-01T10:00:00Z',
          ContactID: 'C_R1',
          IdentificationStatus: 'KnownDomain',
          SensorPlatformID: 'B_AWACS_1',
          ContactRangeHoriz_nm: 120.5,
        },
        {
          Time: '2026-06-01T10:00:25Z',
          ContactID: 'C_R1',
          IdentificationStatus: 'KnownClass',
          SensorPlatformID: 'B_AWACS_1',
          ContactRangeHoriz_nm: 95.0,
        },
        {
          Time: '2026-06-01T10:01:00Z',
          ContactID: 'C_R2',
          IdentificationStatus: 'PreciseID',
          SensorPlatformID: 'B_SHIP_1',
          ContactRangeHoriz_nm: 42.25,
        },
        {
          Time: '2026-06-01T10:02:00Z',
          ContactID: 'C_M1',
          IdentificationStatus: 'KnownType',
          SensorPlatformID: 'B_SAM_1',
          ContactRangeHoriz_nm: 60.0,
        },
        {
          Time: '2026-06-01T10:02:10Z',
          ContactID: 'C_M1',
          IdentificationStatus: 'KnownClass',
          SensorPlatformID: 'B_SAM_1',
          ContactRangeHoriz_nm: 55.0,
        },
        {
          Time: '2026-06-01T10:00:10Z',
          ContactID: 'C_B1',
          IdentificationStatus: 'KnownClass',
          SensorPlatformID: 'R_FTR_1',
          ContactRangeHoriz_nm: 75.4,
        },
      ],
      EngagementCycle: [
        {
          Time: '2026-06-01T10:02:15Z',
          UnitID: 'B_SAM_1',
          UnitSide: 'Blue',
          CycleAction: 'Assign Weapon Salvo',
          ContactID: 'C_M1',
          ContactActualUnitID: 'R_MSL_1',
          ContactActualUnitSide: 'Red',
        },
        {
          // 同一目标第二次齐射，应按 ContactActualUnitID 去重只计 1 次
          Time: '2026-06-01T10:02:20Z',
          UnitID: 'B_SAM_1',
          UnitSide: 'Blue',
          CycleAction: 'Assign Weapon Salvo',
          ContactID: 'C_M1',
          ContactActualUnitID: 'R_MSL_1',
          ContactActualUnitSide: 'Red',
        },
        {
          Time: '2026-06-01T10:02:30Z',
          UnitID: 'B_SAM_2',
          UnitSide: 'Blue',
          CycleAction: 'Assign Weapon Salvo',
          ContactID: 'C_R1',
          ContactActualUnitID: 'R_FTR_1',
          ContactActualUnitSide: 'Red',
        },
      ],
      WeaponEndgame: [
        {
          Time: '2026-06-01T10:03:00Z',
          WeaponID: 'R_MSL_1',
          WeaponName: 'YJ-18 #1',
          WeaponSide: 'Red',
          ParentFiringUnitID: 'R_SHIP_1',
          ParentFiringUnitName: 'Frigate #1',
          TargetID: 'B_SHIP_1',
          DistanceFromFiringUnit_Horiz: 45.0,
          Result: 'MISS',
        },
        {
          Time: '2026-06-01T10:03:05Z',
          WeaponID: 'B_SAM_W1',
          WeaponName: 'HHQ-9 #1',
          WeaponSide: 'Blue',
          ParentFiringUnitID: 'B_SAM_1',
          ParentFiringUnitName: 'HQ-9 Battery #1',
          TargetID: 'R_MSL_1',
          DistanceFromFiringUnit_Horiz: 32.5,
          Result: 'KILL',
        },
        {
          Time: '2026-06-01T10:03:20Z',
          WeaponID: 'B_SAM_W2',
          WeaponName: 'HHQ-9 #2',
          WeaponSide: 'Blue',
          ParentFiringUnitID: 'B_SAM_2',
          ParentFiringUnitName: 'HQ-9 Battery #2',
          TargetID: 'R_FTR_1',
          DistanceFromFiringUnit_Horiz: 58.75,
          Result: 'KILL',
        },
      ],
      UnitPositions: [
        {
          Time: '2026-06-01T10:00:00Z',
          UnitID: 'B_AWACS_1',
          UnitLongitude: 121.0,
          UnitLatitude: 30.0,
          UnitCourse: 90,
          UnitAltitude_m: 8000,
        },
        {
          Time: '2026-06-01T10:02:00Z',
          UnitID: 'B_AWACS_1',
          UnitLongitude: 121.2,
          UnitLatitude: 30.0,
          UnitCourse: 90,
          UnitAltitude_m: 8000,
        },
        {
          Time: '2026-06-01T10:00:00Z',
          UnitID: 'B_SAM_1',
          UnitLongitude: 121.1,
          UnitLatitude: 30.1,
          UnitCourse: 0,
          UnitAltitude_m: 50,
        },
      ],
      SensorCreated: [
        {
          UnitID: 'B_AWACS_1',
          SensorID: 'SEN_AWACS',
          SensorDBID: 501,
          SensorStatus: 'Operational',
          SensorIsActive: true,
        },
        {
          UnitID: 'B_SAM_1',
          SensorID: 'SEN_SAM',
          SensorDBID: 502,
          SensorStatus: 'Operational',
          SensorIsActive: true,
        },
        {
          UnitID: 'B_VEH_1',
          SensorID: 'SEN_VEH',
          SensorDBID: 503,
          SensorStatus: 'Operational',
          SensorIsActive: true,
        },
        {
          UnitID: 'R_FTR_1',
          SensorID: 'SEN_OPT',
          SensorDBID: 504,
          SensorStatus: 'Operational',
          SensorIsActive: true,
        },
      ],
      SensorClassUsed: [
        {
          SensorDBID: 501,
          SensorType: 'Radar',
          SensorMaxRange: 180,
          SensorHas360Coverage: true,
        },
        {
          SensorDBID: 502,
          SensorType: 'Radar',
          SensorMaxRange: 80,
          SensorHas360Coverage: false,
        },
        {
          SensorDBID: 503,
          SensorType: 'Radar',
          SensorMaxRange: 120,
          SensorHas360Coverage: true,
        },
        {
          SensorDBID: 504,
          SensorType: 'Optical',
          SensorMaxRange: 25,
          SensorHas360Coverage: false,
        },
      ],
      ComponentStatusChanged: [
        {
          Time: '2026-06-01T10:01:00Z',
          ComponentID: 'SEN_AWACS',
          ComponentStatus: 'Operational',
        },
      ],
      FirstSensorToUnitRecordCreated: [
        { SensorID: 'SEN_SAM', TargetID: 'R_MSL_1', Distance: 48.2 },
        { SensorID: 'SEN_VEH', TargetID: 'R_FTR_1', Distance: 92.6 },
        { SensorID: 'SEN_AWACS', TargetID: 'R_FTR_1', Distance: 150.0 },
      ],
      UnitJammed: [
        // R_FTR_1: 首条为 unjammed -> 补起点 10:00:00，受扰 30s
        { Time: '2026-06-01T10:00:30Z', UnitID: 'R_FTR_1', Status: 'unjammed' },
        // R_FTR_2: 10:01:00 jammed -> 10:02:00 unjammed (60s) + 10:02:30 jammed -> 终点 10:04:00 (90s) = 150s
        { Time: '2026-06-01T10:01:00Z', UnitID: 'R_FTR_2', Status: 'jammed' },
        { Time: '2026-06-01T10:02:00Z', UnitID: 'R_FTR_2', Status: 'unjammed' },
        { Time: '2026-06-01T10:02:30Z', UnitID: 'R_FTR_2', Status: 'jammed' },
        // Group 应被排除
        { Time: '2026-06-01T10:01:00Z', UnitID: 'B_GRP_1', Status: 'jammed' },
      ],
      CommCreated: [
        { CommID: 'COMM_B1', CommName: 'Blue HF Link', CommDBID: 701, UnitID: 'B_SHIP_1', UnitName: 'Type-055 #1' },
        { CommID: 'COMM_R1', CommName: 'Red HF Net 1', CommDBID: 701, UnitID: 'R_FTR_1', UnitName: 'J-16 #1' },
        { CommID: 'COMM_R2', CommName: 'Red HF Net 2', CommDBID: 701, UnitID: 'R_FTR_2', UnitName: 'J-16 #2' },
        { CommID: 'COMM_R3', CommName: 'Red UHF Radio', CommDBID: 702, UnitID: 'R_SHIP_1', UnitName: 'Frigate #1' },
      ],
      CommClassUsed: [
        { CommDBID: 701, HF_Radio: true },
        { CommDBID: 702, HF_Radio: false },
      ],
      CommIsJammedChanged: [
        // COMM_R1 从 10:01:00 到 10:03:00 被干扰 = 120s；COMM_R2 无干扰记录；COMM_R3 非 HF
        { CommID: 'COMM_R1', Time: '2026-06-01T10:01:00Z', IsJammed: true },
        { CommID: 'COMM_R1', Time: '2026-06-01T10:03:00Z', IsJammed: false },
        { CommID: 'COMM_R3', Time: '2026-06-01T10:01:00Z', IsJammed: true },
      ],
      UnitDestroyed: [
        { Time: '2026-06-01T10:03:20Z', UnitID: 'R_FTR_1' },
      ],
      Tick: [
        { Time: '2026-06-01T10:00:00Z' },
        { Time: '2026-06-01T10:04:00Z' },
      ],
    };

    // 4.1 侦察范围
    const r41 = await runner.runOperator('isr.reconnaissance_range', { runId: 'r1', inputDfDict });
    assert.equal(r41.status, 'valid', r41.missingDataReason);
    assert.ok(r41.dataset);
    const map41 = new Map(r41.dataset.rows.map((r) => [r['型号'], r['探测范围_海里']]));
    assert.equal(map41.get('KJ-500'), 120.5);
    assert.equal(map41.get('Type-055'), 42.25);
    assert.equal(map41.get('J-16'), 75.4);

    // 4.2 发现率 (Aircraft + Ship: Red has 3 (R_FTR_1, R_FTR_2, R_SHIP_1), Blue detected 2 (R_FTR_1, R_SHIP_1) => 2/3)
    const r42 = await runner.runOperator('isr.detection_rate', { runId: 'r1', inputDfDict });
    assert.equal(r42.status, 'valid', r42.missingDataReason);
    const blue42 = r42.dataset?.rows.find((r) => r['分方'] === 'Blue');
    const red42 = r42.dataset?.rows.find((r) => r['分方'] === 'Red');
    assert.equal(blue42?.['发现目标数'], 2);
    assert.equal(blue42?.['潜在目标数'], 3);
    assert.equal(blue42?.['发现率'], 0.6667);
    // Blue Aircraft+Ship: B_AWACS_1, B_SHIP_1 (total 2); Red detected B_AWACS_1 => 1/2
    assert.equal(red42?.['发现目标数'], 1);
    assert.equal(red42?.['潜在目标数'], 2);
    assert.equal(red42?.['发现率'], 0.5);

    // 4.3 识别用时 (C_R1: 25s, C_M1: 10s; C_R2 & C_B1 delta=0 filtered out)
    const r43 = await runner.runOperator('isr.identification_latency', { runId: 'r1', inputDfDict });
    assert.equal(r43.status, 'valid', r43.missingDataReason);
    assert.equal(r43.dataset?.rows.length, 2);
    const map43 = new Map(r43.dataset?.rows.map((r) => [r['单元'], r['识别时间_秒']]));
    assert.equal(map43.get('J-16 #1'), 25);
    assert.equal(map43.get('YJ-18 #1'), 10);

    // 4.4 预警时间 (R_MSL_1 detected 10:02:00, endgame MISS at 10:03:00 => 60s)
    const r44 = await runner.runOperator('isr.early_warning_time', { runId: 'r1', inputDfDict });
    assert.equal(r44.status, 'valid', r44.missingDataReason);
    assert.equal(r44.dataset?.rows.length, 1);
    assert.equal(r44.dataset?.rows[0]['被发现单元'], 'YJ-18 #1');
    assert.equal(r44.dataset?.rows[0]['预警时间_秒'], 60);

    // 4.5 侦察效率（探测区域面积）
    const r45 = await runner.runOperator('isr.radar_coverage_area', { runId: 'r1', inputDfDict });
    assert.equal(r45.status, 'valid', r45.missingDataReason);
    assert.ok((r45.dataset?.rows.length ?? 0) >= 3);
    for (const row of r45.dataset!.rows) {
      assert.equal(row['分方'], 'Blue');
      assert.ok(Number(row['面积_平方米']) > 0);
      assert.ok(Number(row['面积_平方公里']) > 0);
    }

    // 5.1 态势完整度 (排除 Group: Blue has AWACS, SHIP, SAM_1, SAM_2, VEH_1 = 5; Red has FTR_1, FTR_2, SHIP_1, MSL_1, MSL_2 = 5; total = 10)
    // Blue knows own 5 + detected Red (FTR_1, SHIP_1, MSL_1 = 3) => 8/10 = 0.8
    const r51 = await runner.runOperator('c2.situational_completeness', { runId: 'r1', inputDfDict });
    assert.equal(r51.status, 'valid', r51.missingDataReason);
    const blue51 = r51.dataset?.rows.find((r) => r['分方'] === 'Blue');
    assert.equal(blue51?.['呈现单元数'], 8);
    assert.equal(blue51?.['所有单元数'], 10);
    assert.equal(blue51?.['态势呈现率'], 0.8);

    // 6.1 持续干扰时间 (R_FTR_1: 30s; R_FTR_2: 150s; B_GRP_1 Group excluded)
    const r61 = await runner.runOperator('ew.jamming_duration', { runId: 'r1', inputDfDict });
    assert.equal(r61.status, 'valid', r61.missingDataReason);
    assert.equal(r61.dataset?.rows.length, 2);
    const map61 = new Map(r61.dataset?.rows.map((r) => [r['单元ID'], r['累计受扰秒数']]));
    assert.equal(map61.get('R_FTR_1'), 30);
    assert.equal(map61.get('R_FTR_2'), 150);

    // 6.2.1 短波通信网台干扰明细 (COMM_R1: 120s / (R_FTR_1 destroyed at 10:03:20 - 10:00:00 = 200s) = 0.6)
    const r621 = await runner.runOperator('ew.hf_comm_jamming_detail', { runId: 'r1', inputDfDict });
    assert.equal(r621.status, 'valid', r621.missingDataReason);
    assert.equal(r621.dataset?.rows.length, 1);
    assert.equal(r621.dataset?.rows[0]['通信网台名'], 'Red HF Net 1');
    assert.equal(r621.dataset?.rows[0]['平台单元名'], 'J-16 #1');
    assert.equal(r621.dataset?.rows[0]['被干扰秒数'], 120);
    assert.equal(r621.dataset?.rows[0]['运行秒数'], 200);
    assert.equal(r621.dataset?.rows[0]['干扰占比'], 0.6);
    assert.equal(r621.dataset?.rows[0]['分方'], 'Red');

    // 6.2.2 短波通信分方汇总 (Red: 1/2 = 0.5, Blue: 0/1 = 0.0)
    const r622 = await runner.runOperator('ew.hf_comm_jamming_side_summary', { runId: 'r1', inputDfDict });
    assert.equal(r622.status, 'valid', r622.missingDataReason);
    const red622 = r622.dataset?.rows.find((r) => r['分方'] === 'Red');
    const blue622 = r622.dataset?.rows.find((r) => r['分方'] === 'Blue');
    assert.equal(red622?.['被干扰网台数'], 1);
    assert.equal(red622?.['通信网台数'], 2);
    assert.equal(red622?.['干扰率'], 0.5);
    assert.equal(blue622?.['被干扰网台数'], 0);
    assert.equal(blue622?.['通信网台数'], 1);

    // 7.1 防空探测区域 (Facility: HQ-9 48.2; Vehicle: YLC-8B 92.6; Aircraft SEN_AWACS excluded)
    const r71 = await runner.runOperator('air_defense.detection_zone', { runId: 'r1', inputDfDict });
    assert.equal(r71.status, 'valid', r71.missingDataReason);
    assert.equal(r71.dataset?.rows.length, 2);
    const map71 = new Map(r71.dataset?.rows.map((r) => [r['型号'], r['最大探测距离_海里']]));
    assert.equal(map71.get('HQ-9'), 48.2);
    assert.equal(map71.get('YLC-8B'), 92.6);

    // 7.2.1 拦截区域（单元级）
    const r721 = await runner.runOperator('air_defense.unit_intercept_zone', { runId: 'r1', inputDfDict });
    assert.equal(r721.status, 'valid', r721.missingDataReason);
    assert.equal(r721.dataset?.rows.length, 2);
    const map721 = new Map(r721.dataset?.rows.map((r) => [r['发射平台ID'], r['发射距离_海里']]));
    assert.equal(map721.get('B_SAM_1'), 32.5);
    assert.equal(map721.get('B_SAM_2'), 58.75);

    // 7.2.2 拦截区域（型号级）: HQ-9 (DBID 2001) max(32.5, 58.75) = 58.75
    const r722 = await runner.runOperator('air_defense.model_intercept_zone', { runId: 'r1', inputDfDict });
    assert.equal(r722.status, 'valid', r722.missingDataReason);
    assert.equal(r722.dataset?.rows.length, 1);
    assert.equal(r722.dataset?.rows[0]['发射平台型号'], 'HQ-9');
    assert.equal(r722.dataset?.rows[0]['发射距离_海里'], 58.75);

    // 7.3 综合拦截概率: Blue tried 2 unique targets (R_MSL_1 deduped, R_FTR_1), killed 2 => 1.0; Red tried 0 => null
    const r73 = await runner.runOperator('air_defense.composite_interception_probability', {
      runId: 'r1',
      inputDfDict,
    });
    assert.equal(r73.status, 'valid', r73.missingDataReason);
    const blue73 = r73.dataset?.rows.find((r) => r['分方'] === 'Blue');
    const red73 = r73.dataset?.rows.find((r) => r['分方'] === 'Red');
    assert.equal(blue73?.['尝试拦截目标数'], 2);
    assert.equal(blue73?.['成功拦截数'], 2);
    assert.equal(blue73?.['综合拦截率'], 1);
    assert.equal(red73?.['尝试拦截目标数'], 0);
    assert.equal(red73?.['综合拦截率'], null);
  });

  test('2) fast csvDir loader handles double UTF-8 BOM, timestamp-prefixed CSVs, usecols projection, and cache reuse', async () => {
    const csvDir = makeTempDir('f1-v4-part2-csv-');
    writeDoubleBomCsv(
      path.join(csvDir, '2026-11-17_10.22.9_MissionChanged.csv'),
      ['TimelineID', 'Time', 'MissionID', 'MissionName', 'MissionClass', 'UnusedCol'],
      [['TL1', '2026-11-17 10:22:09', 'M1', 'AirPatrol', 'Patrol', 'IGNORE_ME']],
    );
    writeDoubleBomCsv(
      path.join(csvDir, '2026-11-17_10.22.9_DetectionIdentificationChanged.csv'),
      ['TimelineID', 'Time', 'ContactID', 'SensorPlatformID', 'ContactRangeHoriz_nm', 'ExtraBlob'],
      [['TL1', '2026-11-17 10:23:00', 'C1', 'U_AWACS', 145.6, 'BLOB_DATA']],
    );
    writeDoubleBomCsv(
      path.join(csvDir, '2026-11-17_10.22.9_UnitCreated.csv'),
      ['TimelineID', 'Time', 'UnitID', 'UnitClass', 'UnitSide', 'UnitType', 'ExtraInfo'],
      [['TL1', '2026-11-17 10:22:09', 'U_AWACS', 'E-3G', 'Blue', 'Aircraft', 'EXTRA']],
    );
    writeDoubleBomCsv(
      path.join(csvDir, '2026-11-17_10.22.9_UnitPositions.csv'),
      [
        'TimelineID',
        'Time',
        'UnitID',
        'UnitLongitude',
        'UnitLatitude',
        'UnitCourse',
        'UnitAltitude_m',
        'HeavyUnusedCol',
      ],
      [
        ['TL1', '2026-11-17 10:22:09', 'U_AWACS', 120.0, 31.0, 45, 9000, 'HEAVY_PAYLOAD'],
        ['TL1', '2026-11-17 10:24:09', 'U_AWACS', 120.2, 31.1, 45, 9000, 'HEAVY_PAYLOAD'],
      ],
    );
    writeDoubleBomCsv(
      path.join(csvDir, '2026-11-17_10.22.9_SensorCreated.csv'),
      ['TimelineID', 'UnitID', 'SensorID', 'SensorDBID', 'SensorStatus', 'SensorIsActive'],
      [['TL1', 'U_AWACS', 'S1', 801, 'Operational', 'True']],
    );
    writeDoubleBomCsv(
      path.join(csvDir, '2026-11-17_10.22.9_SensorClassUsed.csv'),
      ['TimelineID', 'SensorDBID', 'SensorType', 'SensorMaxRange', 'SensorHas360Coverage'],
      [['TL1', 801, 'Radar', 200, 'True']],
    );
    writeDoubleBomCsv(
      path.join(csvDir, '2026-11-17_10.22.9_Tick.csv'),
      ['TimelineID', 'Time'],
      [['TL1', '2026-11-17 10:22:09'], ['TL1', '2026-11-17 10:25:00']],
    );

    const pool = makePool();

    // Direct pool.execute test for usecols + double-BOM strip on MissionChanged
    const directRes = await pool.execute({
      csvDir,
      requiredTables: ['MissionChanged'],
      tableColumns: {
        MissionChanged: ['TimelineID', 'MissionID', 'MissionClass'],
      },
      code: `
mc = T("MissionChanged")
output_df = pd.DataFrame({
    "cols": [",".join(list(mc.columns))],
    "timeline": [str(mc.iloc[0]["TimelineID"])],
    "mission": [str(mc.iloc[0]["MissionID"])],
    "has_unused": ["UnusedCol" in mc.columns],
})
`,
    });
    assert.equal(directRes.success, true, directRes.error);
    assert.equal(directRes.dataset?.rows[0].cols, 'TimelineID,MissionID,MissionClass');
    assert.equal(directRes.dataset?.rows[0].timeline, 'TL1');
    assert.equal(directRes.dataset?.rows[0].mission, 'M1');
    assert.equal(directRes.dataset?.rows[0].has_unused, false);

    // Runner execution against csvDir (including 4.1 and 4.5 with UnitPositions projection)
    const cache = new DagNodeCache();
    const runner = new V4OperatorRunner(V4_OPERATORS_PART2, { pythonPool: pool, cache });

    const res41 = await runner.runOperator('isr.reconnaissance_range', { runId: 'csv-run-1', csvDir });
    assert.equal(res41.status, 'valid', res41.missingDataReason);
    assert.equal(res41.dataset?.rows[0]['型号'], 'E-3G');
    assert.equal(res41.dataset?.rows[0]['探测范围_海里'], 145.6);
    assert.ok(res41.evidenceRefs.some((e) => String(e.ref).includes('2026-11-17_10.22.9_UnitCreated.csv')));

    const res45 = await runner.runOperator('isr.radar_coverage_area', { runId: 'csv-run-1', csvDir });
    assert.equal(res45.status, 'valid', res45.missingDataReason);
    assert.ok((res45.dataset?.rows.length ?? 0) >= 3);
    assert.ok(Number(res45.dataset?.rows[0]['面积_平方公里']) > 0);

    // Repeat call hits DagNodeCache
    const res41Cached = await runner.runOperator('isr.reconnaissance_range', { runId: 'csv-run-1', csvDir });
    assert.equal(res41Cached.status, 'valid');
    assert.equal(res41Cached.cacheKey, res41.cacheKey);
    assert.equal(cache.stats().hits, 1);
  });

  test('3) Fail-Closed missing required table returns unavailable in both PythonWorkerPool and V4OperatorRunner', async () => {
    const csvDir = makeTempDir('f1-v4-part2-missing-');
    writeDoubleBomCsv(
      path.join(csvDir, '2026-11-17_10.22.9_UnitCreated.csv'),
      ['UnitID', 'UnitType', 'UnitSide'],
      [['U1', 'Aircraft', 'Blue']],
    );
    // Deliberately omit ContactCreated.csv!

    const pool = makePool();

    // Direct Python worker Fail-Closed check
    const pyFail = await pool.execute({
      csvDir,
      requiredTables: ['UnitCreated', 'ContactCreated'],
      code: `output_df = pd.DataFrame({"x": [1]})`,
    });
    assert.equal(pyFail.success, false);
    assert.deepEqual(pyFail.missingTables, ['ContactCreated']);
    assert.match(pyFail.error ?? '', /缺少必需推演事件底表/);

    // V4OperatorRunner Fail-Closed check
    const runner = new V4OperatorRunner(V4_OPERATORS_PART2, { pythonPool: pool });
    const runnerFail = await runner.runOperator('isr.detection_rate', {
      runId: 'missing-run',
      csvDir,
    });
    assert.equal(runnerFail.status, 'unavailable');
    assert.match(runnerFail.missingDataReason ?? '', /ContactCreated/);
  });

  test('4) runV4OperatorDag resolves upstreamOperatorId, passes prev_output_df, supports paramOverrides & Fail-Closed propagation', async () => {
    const pool = makePool();
    const cache = new DagNodeCache();

    const downstreamSummarySpec: V4OperatorScriptSpecLike = {
      id: 'custom.isr_side_avg',
      name: '侦察平均发现率汇总',
      chapter: 4,
      category: 'effectiveness',
      militaryLevel: 'MOFE',
      domainTag: 'isr',
      description: '消费 isr.detection_rate 上游 prev_output_df 计算全场平均发现率',
      requiredTables: [],
      upstreamOperatorId: 'isr.detection_rate',
      parameterPorts: [],
      outputColumns: ['平均发现率'],
      pythonCode: `import pandas as pd
prev = prev_output_df.copy()
avg_rate = float(pd.to_numeric(prev["发现率"], errors="coerce").mean()) if not prev.empty else 0.0
output_df = pd.DataFrame({"平均发现率": [round(avg_rate, 4)]})
`,
    };

    const allSpecs = [...V4_OPERATORS_PART2, downstreamSummarySpec];
    const inputDfDict = {
      UnitCreated: [
        { UnitID: 'B1', UnitType: 'Aircraft', UnitSide: 'Blue' },
        { UnitID: 'R1', UnitType: 'Aircraft', UnitSide: 'Red' },
        { UnitID: 'R2', UnitType: 'Ship', UnitSide: 'Red' },
      ],
      ContactCreated: [{ ContactID: 'C1', ActualUnitID: 'R1' }],
    };

    // Run 1: default consideredUnitTypes = ["Aircraft", "Ship"] => Blue: 1/2=0.5, Red: 0/1=0 => avg = 0.25
    const dag1 = await runV4OperatorDag(['custom.isr_side_avg'], allSpecs, {
      runId: 'dag-test-1',
      inputDfDict,
      cache,
      pythonPool: pool,
    });
    assert.deepEqual(dag1.topologicalOrder, ['isr.detection_rate', 'custom.isr_side_avg']);
    assert.equal(dag1.results['isr.detection_rate']?.status, 'valid');
    assert.equal(dag1.results['custom.isr_side_avg']?.status, 'valid');
    assert.equal(dag1.results['custom.isr_side_avg']?.dataset?.rows[0]['平均发现率'], 0.25);
    assert.equal(dag1.cacheMisses, 2);

    // Run 2: repeat hits cache for both nodes
    const dag2 = await runV4OperatorDag(['custom.isr_side_avg'], allSpecs, {
      runId: 'dag-test-1',
      inputDfDict,
      cache,
      pythonPool: pool,
    });
    assert.equal(dag2.cacheHits, 2);

    // Run 3: override consideredUnitTypes on upstream to ["Aircraft"] => Blue: 1/1=1.0, Red: 0/1=0 => avg = 0.5
    const singleRes = await runV4Operator(downstreamSummarySpec, allSpecs, {
      runId: 'dag-test-1',
      inputDfDict,
      cache,
      pythonPool: pool,
      paramOverrides: {
        'isr.detection_rate': { consideredUnitTypes: ['Aircraft'] },
      },
    });
    assert.equal(singleRes.status, 'valid');
    assert.equal(singleRes.dataset?.rows[0]['平均发现率'], 0.5);

    // Run 4: Fail-Closed upstream missing ContactCreated blocks downstream node cleanly
    const dagMissing = await runV4OperatorDag(['custom.isr_side_avg'], allSpecs, {
      runId: 'dag-test-missing',
      inputDfDict: { UnitCreated: inputDfDict.UnitCreated },
      pythonPool: pool,
    });
    assert.equal(dagMissing.results['isr.detection_rate']?.status, 'unavailable');
    assert.equal(dagMissing.results['custom.isr_side_avg']?.status, 'unavailable');
    assert.match(
      dagMissing.results['custom.isr_side_avg']?.missingDataReason ?? '',
      /Upstream node\(s\) unavailable: isr\.detection_rate/,
    );
  });
});
