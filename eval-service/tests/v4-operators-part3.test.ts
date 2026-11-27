import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  ALL_V4_OPERATOR_SCRIPTS,
  V4OperatorRunner,
  V4_OPERATOR_SPEC_MAP,
} from '../src/operators/v4/index.ts';
import { V4_OPERATORS_PART3 } from '../src/operators/v4/scripts-part3.ts';
import {
  MetricGraphStore,
  defaultMetricGraphStore,
  evaluateMetricGraph,
  type MetricOperatorInput,
} from '../src/indicators/metric-graph-store.ts';
import { EvalSqliteStore } from '../src/adapters/sqlite-store.ts';
import { RealtimeMonitor, situationModelToInputDfDict } from '../src/realtime/monitor.ts';
import { defaultSystemDagStore } from '../src/systems/system-dag-store.ts';
import { evaluateSystemDag } from '../src/systems/dag-evaluator.ts';
import { defaultEffectStore } from '../src/effects/store.ts';
import type { TableDataset } from '../src/core/types.ts';

const GJ11_CSV_DIR =
  'D:/project/F1-AI-demo-lua-structure-tools/LabConsole/outputs/m6-verify-runs/39c47807bece4e0690feb0598f7a92d1/GJ11-PL15试射-90nm正对-80nm-1/EventExport_CSV';

describe('V4 Operators Part 3 (Ch 8 ROE Compliance & Fratricide Gate)', () => {
  const runner = new V4OperatorRunner(ALL_V4_OPERATOR_SCRIPTS);

  after(async () => {
    await runner.dispose();
  });

  it('1) exports exact 2 Ch-8 ROE operators, registers them in V4 registry (42 total) & pipelines (42 total)', () => {
    assert.strictEqual(V4_OPERATORS_PART3.length, 2);
    assert.strictEqual(ALL_V4_OPERATOR_SCRIPTS.length, 42);
    assert.ok(V4_OPERATOR_SPEC_MAP.has('roe.corridor_spatial_compliance'));
    assert.ok(V4_OPERATOR_SPEC_MAP.has('roe.fratricide_count'));

    const corrSpec = V4_OPERATOR_SPEC_MAP.get('roe.corridor_spatial_compliance')!;
    assert.strictEqual(corrSpec.engineKind, 'spatial');
    assert.deepStrictEqual(corrSpec.requiredTables, [
      'MissionChanged',
      'MissionRefPointRelationChanged',
      'MissionUnitRelationChanged',
      'UnitPositions',
    ]);

    const fratSpec = V4_OPERATOR_SPEC_MAP.get('roe.fratricide_count')!;
    assert.strictEqual(fratSpec.engineKind, 'python_script');
    assert.deepStrictEqual(fratSpec.requiredTables, ['WeaponEndgame', 'UnitCreated']);

    const pipelinesPath = path.resolve(import.meta.dirname, '..', 'data', 'operator-pipelines.json');
    const pipelines = JSON.parse(fs.readFileSync(pipelinesPath, 'utf-8')) as Record<string, unknown>;
    assert.strictEqual(Object.keys(pipelines).length, 42);
    assert.ok(pipelines['roe.corridor_spatial_compliance']);
    assert.ok(pipelines['roe.fratricide_count']);
  });

  it('2) roe.corridor_spatial_compliance evaluates in_polygon(), excludes UnitType=="武器", and enforces Fail-Closed', async () => {
    const syntheticInput = {
      MissionChanged: [
        { MissionID: 'M1', MissionName: '东海防空走廊', Side: '红方', MissionClass: 'Patrol' },
      ],
      MissionRefPointRelationChanged: [
        { Time: '00:00:00', MissionID: 'M1', Type: 'Create', PointIndex: 1, Longitude: 120.0, Latitude: 30.0 },
        { Time: '00:00:00', MissionID: 'M1', Type: 'Create', PointIndex: 2, Longitude: 122.0, Latitude: 30.0 },
        { Time: '00:00:00', MissionID: 'M1', Type: 'Create', PointIndex: 3, Longitude: 122.0, Latitude: 32.0 },
        { Time: '00:00:00', MissionID: 'M1', Type: 'Create', PointIndex: 4, Longitude: 120.0, Latitude: 32.0 },
      ],
      MissionUnitRelationChanged: [
        { Time: '00:00:00', MissionID: 'M1', UnitID: 'U_FIGHTER_1', Type: 'Assigned' },
        { Time: '00:00:00', MissionID: 'M1', UnitID: 'U_FIGHTER_2', Type: 'Assigned' },
        { Time: '00:00:00', MissionID: 'M1', UnitID: 'WPN_MISSILE_1', Type: 'Assigned' },
      ],
      UnitCreated: [
        { UnitID: 'U_FIGHTER_1', UnitName: 'J-20长机', UnitType: 'Aircraft', UnitSide: '红方' },
        { UnitID: 'U_FIGHTER_2', UnitName: 'J-20僚机', UnitType: 'Aircraft', UnitSide: '红方' },
        { UnitID: 'WPN_MISSILE_1', UnitName: 'PL-15', UnitType: '武器', UnitSide: '红方' },
      ],
      UnitPositions: [
        // U_FIGHTER_1: 2/2 inside corridor -> 1.0
        { Time: '00:01:00', UnitID: 'U_FIGHTER_1', UnitName: 'J-20长机', UnitType: 'Aircraft', UnitSide: '红方', UnitLongitude: 121.0, UnitLatitude: 31.0 },
        { Time: '00:02:00', UnitID: 'U_FIGHTER_1', UnitName: 'J-20长机', UnitType: 'Aircraft', UnitSide: '红方', UnitLongitude: 121.2, UnitLatitude: 31.1 },
        // U_FIGHTER_2: 1/2 inside corridor -> 0.5
        { Time: '00:01:00', UnitID: 'U_FIGHTER_2', UnitName: 'J-20僚机', UnitType: 'Aircraft', UnitSide: '红方', UnitLongitude: 121.0, UnitLatitude: 31.0 },
        { Time: '00:02:00', UnitID: 'U_FIGHTER_2', UnitName: 'J-20僚机', UnitType: 'Aircraft', UnitSide: '红方', UnitLongitude: 123.5, UnitLatitude: 33.5 },
        // WPN_MISSILE_1: UnitType == "武器" outside corridor -> MUST be excluded!
        { Time: '00:01:00', UnitID: 'WPN_MISSILE_1', UnitName: 'PL-15', UnitType: '武器', UnitSide: '红方', UnitLongitude: 125.0, UnitLatitude: 35.0 },
        { Time: '00:02:00', UnitID: 'WPN_MISSILE_1', UnitName: 'PL-15', UnitType: '武器', UnitSide: '红方', UnitLongitude: 126.0, UnitLatitude: 36.0 },
      ],
    };

    const res = await runner.runOperator('roe.corridor_spatial_compliance', {
      runId: 'test_corridor_synth',
      inputDfDict: syntheticInput,
    });
    assert.strictEqual(res.status, 'valid');
    assert.ok(res.dataset);
    assert.strictEqual(res.dataset.rows.length, 2, 'Weapon unit WPN_MISSILE_1 must be excluded');

    const row1 = res.dataset.rows.find((r) => r['单元ID'] === 'U_FIGHTER_1');
    const row2 = res.dataset.rows.find((r) => r['单元ID'] === 'U_FIGHTER_2');
    assert.ok(row1 && row2);
    assert.strictEqual(row1['分方'], '红方');
    assert.strictEqual(row1['遵从率'], 1);
    assert.strictEqual(row1['合规状态'], '合规');
    assert.ok(Number(row1['最小安全裕度_km']) > 0);

    assert.strictEqual(row2['遵从率'], 0.5);
    assert.strictEqual(row2['合规状态'], '越界告警');
    assert.ok(Number(row2['最小安全裕度_km']) < 0);

    // Fail-Closed when required table is missing
    const failRes = await runner.runOperator('roe.corridor_spatial_compliance', {
      runId: 'test_corridor_missing',
      inputDfDict: { UnitPositions: syntheticInput.UnitPositions },
    });
    assert.strictEqual(failRes.status, 'unavailable');
    assert.ok(failRes.missingDataReason);
  });

  it('3) roe.fratricide_count deduplicates WeaponEndgame, ignores point-def noise & weapon targets, and detects friendly fire', async () => {
    const syntheticInput = {
      SideCreated: [{ SideName: '红方' }, { SideName: '蓝方' }],
      UnitCreated: [
        { UnitID: 'R_1', UnitName: '红方战机1', UnitType: 'Aircraft', UnitSide: '红方' },
        { UnitID: 'R_2', UnitName: '红方预警机', UnitType: 'Aircraft', UnitSide: '红方' },
        { UnitID: 'R_MSL', UnitName: '红方拦截弹', UnitType: '武器', UnitSide: '红方' },
        { UnitID: 'B_1', UnitName: '蓝方战机1', UnitType: 'Aircraft', UnitSide: '蓝方' },
      ],
      WeaponEndgame: [
        // Duplicate WeaponID W1 hitting friendly R_2 (HIT + POINTDEF:FAILURE) -> MUST count as 1, not 2!
        { WeaponID: 'W1', WeaponSide: '红方', ParentFiringUnitID: 'R_1', TargetID: 'R_2', TargetSide: 'Red', Result: 'HIT', EndgameMessage: 'Direct hit' },
        { WeaponID: 'W1', WeaponSide: '红方', ParentFiringUnitID: 'R_1', TargetID: 'R_2', TargetSide: 'Red', Result: 'POINTDEF:FAILURE', EndgameMessage: 'No point defence systems employed' },
        // W2 hitting friendly weapon R_MSL -> MUST NOT count as fratricide (weapon target)
        { WeaponID: 'W2', WeaponSide: '红方', ParentFiringUnitID: 'R_1', TargetID: 'R_MSL', TargetSide: '红方', Result: 'KILL', EndgameMessage: 'Intercepted missile' },
        // W3 hitting enemy B_1 -> normal enemy kill, NOT fratricide
        { WeaponID: 'W3', WeaponSide: '红方', ParentFiringUnitID: 'R_1', TargetID: 'B_1', TargetSide: '蓝方', Result: 'KILL', EndgameMessage: 'Target destroyed' },
        // W4 Blue misses R_1 -> NOT fratricide
        { WeaponID: 'W4', WeaponSide: '蓝方', ParentFiringUnitID: 'B_1', TargetID: 'R_1', TargetSide: '红方', Result: 'MISS', EndgameMessage: 'Missed' },
      ],
    };

    const res = await runner.runOperator('roe.fratricide_count', {
      runId: 'test_fratricide_synth',
      inputDfDict: syntheticInput,
    });
    assert.strictEqual(res.status, 'valid');
    assert.ok(res.dataset);

    const redRow = res.dataset.rows.find((r) => r['分方'] === '红方');
    const blueRow = res.dataset.rows.find((r) => r['分方'] === '蓝方');
    assert.ok(redRow && blueRow);
    assert.strictEqual(redRow['FratricideCount'], 1);
    assert.strictEqual(redRow['误伤事件数'], 1);
    assert.strictEqual(redRow['红线状态'], '违规');

    assert.strictEqual(blueRow['FratricideCount'], 0);
    assert.strictEqual(blueRow['误伤事件数'], 0);
    assert.strictEqual(blueRow['红线状态'], '合格');

    // Fail-Closed when required table is missing
    const failRes = await runner.runOperator('roe.fratricide_count', {
      runId: 'test_fratricide_missing',
      inputDfDict: { UnitCreated: syntheticInput.UnitCreated },
    });
    assert.strictEqual(failRes.status, 'unavailable');
    assert.ok(failRes.missingDataReason);
  });

  it('4) runs both new V4 operators against real gj11_bvr_real scenario (if present on disk)', async () => {
    if (!fs.existsSync(GJ11_CSV_DIR)) return;

    // gj11_bvr_real has no MissionChanged / MissionRefPointRelationChanged -> Fail-Closed unavailable
    const corrReal = await runner.runOperator('roe.corridor_spatial_compliance', {
      runId: 'real_gj11_corridor',
      csvDir: GJ11_CSV_DIR,
    });
    assert.strictEqual(corrReal.status, 'unavailable');

    // gj11_bvr_real has WeaponEndgame + UnitCreated -> valid with 0 fratricides
    const fratReal = await runner.runOperator('roe.fratricide_count', {
      runId: 'real_gj11_fratricide',
      csvDir: GJ11_CSV_DIR,
    });
    assert.strictEqual(fratReal.status, 'valid');
    assert.ok(fratReal.dataset && fratReal.dataset.rows.length > 0);
    for (const row of fratReal.dataset.rows) {
      assert.strictEqual(row['FratricideCount'], 0);
    }
  });

  it('5) mg_v4_joint_demo & sys_v4_joint_demo have 0 schema mismatches and evaluate end-to-end with Hard/Soft GATEs', async () => {
    const mg = defaultMetricGraphStore.get('mg_v4_joint_demo');
    const sd = defaultSystemDagStore.get('sys_v4_joint_demo');
    assert.ok(mg && sd);

    // Schema alignment check: every from_operator & from_metric_agg node must match real V4 outputColumns
    for (const node of mg.nodes) {
      const mc = node.metricConfig;
      if (!mc) continue;
      if (mc.mode === 'from_operator') {
        const spec = V4_OPERATOR_SPEC_MAP.get(mc.sourceRef || '');
        assert.ok(spec, `Missing V4 operator ${mc.sourceRef} for node ${node.id}`);
        if (mc.targetField) {
          assert.ok(
            spec.outputColumns.includes(mc.targetField),
            `Node ${node.id} targetField "${mc.targetField}" not in [${spec.outputColumns.join(', ')}]`,
          );
        }
      } else if (mc.mode === 'from_metric_agg') {
        const srcNode = mg.nodes.find((n) => n.id === mc.sourceRef);
        assert.ok(srcNode?.metricConfig?.sourceRef);
        const spec = V4_OPERATOR_SPEC_MAP.get(srcNode.metricConfig.sourceRef);
        assert.ok(spec);
        if (mc.targetField) {
          assert.ok(spec.outputColumns.includes(mc.targetField));
        }
        for (const g of mc.groupBy || []) {
          assert.ok(spec.outputColumns.includes(g), `groupBy "${g}" not in [${spec.outputColumns.join(', ')}]`);
        }
      }
    }

    const mkDs = (cols: string[], rows: Record<string, unknown>[]): TableDataset => ({
      columns: cols.map((name) => ({
        name,
        type: typeof rows[0]?.[name] === 'number' ? 'number' : 'string',
      })),
      rows,
      totalRows: rows.length,
    });

    const makeOpInputs = (fratCount: number, corridorRate: number): Record<string, MetricOperatorInput> => ({
      'strike.single_mission_metrics': {
        status: 'valid',
        dataset: mkDs(['任务ID', '任务名', '分方', '完成比'], [
          { 任务ID: 'S1', 任务名: '突击1', 分方: '红方', 完成比: 0.9 },
        ]),
      },
      'patrol.composite_mission_metrics': {
        status: 'valid',
        dataset: mkDs(['分方', '平均完成比'], [{ 分方: '红方', 平均完成比: 0.88 }]),
      },
      'isr.detection_rate': {
        status: 'valid',
        dataset: mkDs(['分方', '发现率'], [{ 分方: '红方', 发现率: 0.85 }]),
      },
      'c2.situational_completeness': {
        status: 'valid',
        dataset: mkDs(['分方', '态势完整度'], [{ 分方: '红方', 态势完整度: 0.9 }]),
      },
      'fire_control.unit_kill_chain_closure': {
        status: 'valid',
        dataset: mkDs(['目标ID', '分方', '杀伤闭环总时长'], [
          { 目标ID: 'T1', 分方: '红方', 杀伤闭环总时长: 60 },
        ]),
      },
      'cost.side_exchange_ratio': {
        status: 'valid',
        dataset: mkDs(['分方比', '交换比'], [{ 分方比: '红方/蓝方', 交换比: 2.5 }]),
      },
      'roe.fratricide_count': {
        status: 'valid',
        dataset: mkDs(['分方', 'FratricideCount', '误伤事件数', '总终态命中数', '红线状态'], [
          { 分方: '红方', FratricideCount: fratCount, 误伤事件数: fratCount, 总终态命中数: 5, 红线状态: fratCount > 0 ? '违规' : '合格' },
        ]),
      },
      'roe.corridor_spatial_compliance': {
        status: 'valid',
        dataset: mkDs(['分方', '任务ID', '任务名', '单元ID', '单元名', '总航迹点数', '走廊内点数', '遵从率', '最小安全裕度_km', '合规状态'], [
          { 分方: '红方', 任务ID: 'M1', 任务名: '走廊1', 单元ID: 'U1', 单元名: '长机', 总航迹点数: 10, 走廊内点数: Math.round(10 * corridorRate), 遵从率: corridorRate, 最小安全裕度_km: corridorRate >= 0.85 ? 12 : -5, 合规状态: corridorRate >= 0.85 ? '合规' : '越界告警' },
        ]),
      },
    });

    // Case A: Clean pass (0 fratricide, 0.95 corridor compliance)
    const mgPass = await evaluateMetricGraph(mg, makeOpInputs(0, 0.95));
    const sysPass = evaluateSystemDag(sd, mgPass.metricInputsForSystem, { effectStore: defaultEffectStore });
    assert.strictEqual(sysPass.gateVerdict, 'PASS');
    assert.ok(sysPass.overallScore !== null && sysPass.overallScore > 60);

    // Case B: Hard gate DISQUALIFIED when FratricideCount = 1
    const mgFail = await evaluateMetricGraph(mg, makeOpInputs(1, 0.95));
    const sysFail = evaluateSystemDag(sd, mgFail.metricInputsForSystem, { effectStore: defaultEffectStore });
    assert.strictEqual(sysFail.gateVerdict, 'DISQUALIFIED');
    assert.ok(sysFail.overallScore !== null && sysFail.overallScore <= 39);

    // Case C: Soft gate WARNING when corridor compliance = 0.5 < 0.85
    const mgWarn = await evaluateMetricGraph(mg, makeOpInputs(0, 0.5));
    const sysWarn = evaluateSystemDag(sd, mgWarn.metricInputsForSystem, { effectStore: defaultEffectStore });
    assert.strictEqual(sysWarn.gateVerdict, 'WARNING');
    assert.ok(sysWarn.overallScore !== null && sysWarn.overallScore > 60);
  });

  it('6) MetricGraphStore binds to EvalSqliteStore, respects is_blank isolation, and persists CRUD', () => {
    const nonBlankDb = new EvalSqliteStore(':memory:', { autoSeed: false });
    const mgStore = new MetricGraphStore('', { sqliteStore: nonBlankDb });
    assert.ok(mgStore.listAll().length >= 2, 'Non-blank SQLite DB should seed BUILTIN_METRIC_GRAPHS');
    assert.ok(mgStore.get('mg_v4_metrics_guide_full'));
    assert.throws(() => mgStore.delete('mg_v4_metrics_guide_full'), /不允许删除内置预置/);

    mgStore.upsert({
      graphId: 'mg_sqlite_custom_1',
      name: 'SQLite 自定义指标图',
      graphKind: 'metric',
      nodes: [
        {
          id: 'n1',
          kind: 'metric',
          label: '发现率',
          position: { x: 0, y: 0 },
          metricConfig: {
            metricId: 'isr.detection_rate',
            name: '发现率',
            militaryLevel: 'MOE',
            domainTag: 'isr',
            mode: 'from_operator',
            sourceRef: 'isr.detection_rate',
            targetField: '发现率',
            reduce: 'mean',
          },
        },
      ],
      edges: [],
    });
    assert.ok(mgStore.get('mg_sqlite_custom_1'));
    assert.strictEqual(mgStore.delete('mg_sqlite_custom_1'), true);
    assert.strictEqual(mgStore.get('mg_sqlite_custom_1'), undefined);

    // Blank DB isolation: rebindSqliteStore to blank DB returns [] without seeding builtins
    const blankDb = new EvalSqliteStore(':memory:', { autoSeed: false });
    blankDb.setMeta('is_blank', '1');
    mgStore.rebindSqliteStore(blankDb);
    assert.strictEqual(mgStore.listAll().length, 0, 'Blank SQLite DB must return []');
    nonBlankDb.close();
    blankDb.close();
  });

  it('7) RealtimeMonitor V4 streams frames asynchronously and triggers V4 effect/gate alarms', async () => {
    const db = new EvalSqliteStore(':memory:', { autoSeed: false });
    const monitor = new RealtimeMonitor({ sqliteStore: db });
    const frame1 = JSON.stringify({
      scenarioTime: '2026-06-01T04:00:00Z',
      frame: {
        Scenario: {
          Time: '2026-06-01T04:00:00Z',
          Sides: [{ Name: '红方', Contacts: [] }],
          ActiveUnits: [
            { ID: 'u-red-1', Name: '红方战机-1', Side: '红方', Type: 'Aircraft', Longitude: 120.1, Latitude: 24.1, DamageState: 'None' },
            { ID: 'u-red-2', Name: '红方战机-2', Side: '红方', Type: 'Aircraft', Longitude: 120.2, Latitude: 24.2, DamageState: 'None' },
          ],
        },
      },
    });
    const frame2 = JSON.stringify({
      scenarioTime: '2026-06-01T04:01:00Z',
      frame: {
        Scenario: {
          Time: '2026-06-01T04:01:00Z',
          Sides: [{ Name: '红方', Contacts: [] }],
          ActiveUnits: [
            { ID: 'u-red-1', Name: '红方战机-1', Side: '红方', Type: 'Aircraft', Longitude: 120.1, Latitude: 24.1, DamageState: 'Destroyed' },
            { ID: 'u-red-2', Name: '红方战机-2', Side: '红方', Type: 'Aircraft', Longitude: 120.2, Latitude: 24.2, DamageState: 'None' },
          ],
        },
      },
    });

    const session = monitor.createSessionFromLines({
      runId: 'rt_v4_test',
      scenarioPath: 'memory://rt_v4_test.jsonl',
      lines: [frame1, frame2],
    });
    assert.strictEqual(session.systemId, 'sys_v4_metrics_guide_full');

    const r1 = await monitor.stepFrame('rt_v4_test');
    assert.strictEqual(r1.done, false);

    const r2 = await monitor.stepFrame('rt_v4_test');
    assert.strictEqual(r2.done, true);
    const gateCard = r2.newCards.find((c) => c.triggerIndicatorId === 'gate_excessive_attrition');
    assert.ok(gateCard, 'Must trigger V4 gate_excessive_attrition alarm from EffectStore/SystemDagStore (attrition=50% > 35%)');
    assert.strictEqual(gateCard.triggerAtomId, 'cost.side_attrition_rate');

    const dict = situationModelToInputDfDict(session.frameState.model);
    assert.ok(Array.isArray(dict.UnitCreated) && dict.UnitCreated.length >= 2);
    db.close();
  });
});
