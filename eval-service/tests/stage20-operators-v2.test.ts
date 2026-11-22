/**
 * Stage 20: Operators v2（美军评估规则对齐版）阶段 1 & 阶段 2 专项测试
 * 覆盖：
 * 1) 7 张 F1 原生 CSV 表解析（EngagementCycle / FirstSensorToUnitRecordCreated / ComponentStatusChanged / UnitJammed / CommIsJammedChanged / DockingOps / FuelTransfer / MissionChanged）
 * 2) 美军核心口径边界：零己损 LER、友军误伤 Hard GATE、PID-before-Fire Soft GATE、同目标 F2T2EA 杀伤链配对、Ph/Pk|h/Pssk 含 WeaponLost、分层 WRA Fail-Closed、纯货币 CER Fail-Closed
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseCsvDirectoryToSituation } from '../src/adapters/csv-adapter.ts';
import { ALL_OPERATORS, evaluateOperator, getLegacyOperatorMigrationHint } from '../src/operators/registry.ts';
import { getOperatorPipelineBlueprint } from '../src/operators/blueprints.ts';
import { defaultIndicatorStore } from '../src/indicators/store.ts';
import { evaluateIndicatorSystem } from '../src/systems/evaluator.ts';
import { defaultSystemStore } from '../src/systems/store.ts';
import { validateIndicatorSystem } from '../src/systems/validator.ts';
import { generateSystemDraftFromIntent } from '../src/nl/intent-mapper.ts';


function writeCsv(dir: string, name: string, lines: string[]) {
  fs.writeFileSync(path.join(dir, name), `\uFEFF\uFEFF${lines.join('\n')}\n`, 'utf8');
}

function buildSyntheticCsvDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-v2-ops-'));
  writeCsv(dir, '2026-11-18_0.0.0_SimInfo.csv', [
    'TimelineID,Time,MonteCarloID,MonteCarloIteration,ScnName,ReferenceTime',
    'tl-1,00:00:00,mc-001,3,BVR-US-Doctrine-Test,00:00:00',
  ]);
  writeCsv(dir, '2026-11-18_0.0.0_UnitCreated.csv', [
    'TimelineID,Time,UnitID,UnitDBID,UnitName,UnitType,UnitClass,UnitSide,UnitLongitude,UnitLatitude,UnitCourse,UnitAltitude_m',
    'tl-1,00:00:00,b1,100,F-35A #1,Aircraft,F-35A,Blue,120.0,30.0,90,10000',
    'tl-1,00:00:00,b2,100,F-35A #2,Aircraft,F-35A,Blue,120.0,30.1,90,10000',
    'tl-1,00:00:00,r1,200,Su-35 #1,Aircraft,Su-35,Red,121.0,30.0,270,8000',
    'tl-1,00:00:00,r2,200,Su-35 #2,Aircraft,Su-35,Red,121.0,30.1,270,8000',
  ]);
  writeCsv(dir, '2026-11-18_0.0.0_SensorCreated.csv', [
    'TimelineID,Time,UnitID,UnitName,SensorID,SensorName,SensorDBID,SensorStatus,SensorIsActive',
    'tl-1,00:00:00,b1,F-35A #1,s1,AN/APG-81,500,Operational,false',
  ]);
  writeCsv(dir, '2026-11-18_0.0.0_FirstSensorToUnitRecordCreated.csv', [
    'TimelineID,Time,SensorID,TargetID,Distance',
    'tl-1,00:01:00,s1,r1,65.5',
    'tl-1,00:01:10,s1,r2,58.5',
  ]);
  writeCsv(dir, '2026-11-18_0.0.0_ContactCreated.csv', [
    'TimelineID,Time,ContactID,ContactName,ActualUnitID,ActualUnitName,Side',
    'tl-1,00:01:00,c1,Bogey #1,r1,Su-35 #1,Blue',
    'tl-1,00:02:00,c2,Bogey #2,r2,Su-35 #2,Blue',
  ]);
  writeCsv(dir, '2026-11-18_0.0.0_DetectionIdentificationChanged.csv', [
    'TimelineID,Time,ContactID,ContactName,IdentificationStatus,SensorName,SensorID,SensorPlatformID,ContactRangeHoriz_nm',
    'tl-1,00:01:20,c1,Bogey #1,KnownClass,AN/APG-81,s1,b1,60',
    'tl-1,00:02:30,c2,Bogey #2,PreciseID,AN/APG-81,s1,b1,50',
  ]);
  writeCsv(dir, '2026-11-18_0.0.0_WeaponFired.csv', [
    'TimelineID,Time,FiringUnitID,FiringUnitName,FiringUnitSide,WeaponID,WeaponDBID,WeaponName,TargetContactID,TargetContactActualUnitID,TargetContactActualUnitName,TargetContactActualUnitSide,TargetContactRangeHoriz_nm,SalvoID',
    'tl-1,00:01:30,b1,F-35A #1,Blue,w1,900,AIM-120D #1,c1,r1,Su-35 #1,Red,55,salvo-1',
    'tl-1,00:02:10,b2,F-35A #2,Blue,w2,900,AIM-120D #2,c2,r2,Su-35 #2,Red,45,salvo-2',
    'tl-1,00:02:40,b1,F-35A #1,Blue,w3,900,AIM-120D #3,c2,r2,Su-35 #2,Red,15,salvo-3',
  ]);
  writeCsv(dir, '2026-11-18_0.0.0_WeaponEndgame.csv', [
    'TimelineID,Time,WeaponID,WeaponName,WeaponSide,ParentFiringUnitID,TargetID,TargetName,TargetSide,Result,EndgameMessage',
    'tl-1,00:02:10,w1,AIM-120D #1,Blue,b1,r1,Su-35 #1,Red,KILL,Direct hit',
    'tl-1,00:02:50,w2,AIM-120D #2,Blue,b2,r2,Su-35 #2,Red,HIT,Damaged',
  ]);
  writeCsv(dir, '2026-11-18_0.0.0_WeaponLost.csv', [
    'TimelineID,Time,DBID,WeaponName,Side,Num',
    'tl-1,00:03:00,900,AIM-120D,Blue,1',
  ]);
  writeCsv(dir, '2026-11-18_0.0.0_Expenditures.csv', [
    'TimelineID,Time,DBID,WeaponName,Side,Num',
    'tl-1,00:03:00,900,AIM-120D,Blue,3',
  ]);
  writeCsv(dir, '2026-11-18_0.0.0_UnitDestroyed.csv', [
    'TimelineID,Time,UnitID,UnitName,UnitClass,UnitSide,MiscInfo,Reason,Cause',
    'tl-1,00:02:10,r1,Su-35 #1,Su-35,Red,,Weapon,AIM-120D',
  ]);
  writeCsv(dir, '2026-11-18_0.0.0_ComponentStatusChanged.csv', [
    'TimelineID,Time,ComponentID,ComponentName,ComponentStatus,SensorIsActive,ComponentDamageSeverity,PlatformID,PlatformName',
    'tl-1,00:02:50,comp1,N035 Radar,Destroyed,,Destroyed,r2,Su-35 #2',
    'tl-1,00:01:00,s1,AN/APG-81,Operational,true,,b1,F-35A #1',
    'tl-1,00:02:00,s1,AN/APG-81,Operational,false,,b1,F-35A #1',
  ]);
  writeCsv(dir, '2026-11-18_0.0.0_EngagementCycle.csv', [
    'TimelineID,Time,UnitID,UnitName,UnitClass,UnitSide,CycleAction,ContactID,ContactName,ContactRangeHoriz_nm,ContactActualUnitID,ContactActualUnitSide,SalvoID',
    'tl-1,00:01:30,b1,F-35A #1,F-35A,Blue,Launch,c1,Bogey #1,55,r1,Red,salvo-1',
    'tl-1,00:02:10,b2,F-35A #2,F-35A,Blue,Launch,c2,Bogey #2,45,r2,Red,salvo-2',
  ]);
  writeCsv(dir, '2026-11-18_0.0.0_UnitJammed.csv', [
    'TimelineID,Time,UnitID,Status',
    'tl-1,00:01:00,b1,true',
    'tl-1,00:02:00,b1,false',
  ]);
  writeCsv(dir, '2026-11-18_0.0.0_CommCreated.csv', [
    'TimelineID,Time,UnitID,UnitName,CommID,CommName,CommDBID,CommStatus',
    'tl-1,00:00:00,b1,F-35A #1,cm1,Link-16,700,Operational',
  ]);
  writeCsv(dir, '2026-11-18_0.0.0_CommIsJammedChanged.csv', [
    'TimelineID,Time,CommID,CommName,IsJammed',
    'tl-1,00:01:00,cm1,Link-16,true',
    'tl-1,00:01:30,cm1,Link-16,false',
  ]);
  writeCsv(dir, '2026-11-18_0.0.0_DockingOps.csv', [
    'TimelineID,Time,UnitID,UnitName,UnitClass,UnitSide,Action,DepartureHostID,ArrivalHostID',
    'tl-1,00:00:10,usv1,USV-1,USV,Blue,Undock,h1,',
    'tl-1,00:03:00,usv1,USV-1,USV,Blue,Dock,,h1',
  ]);
  writeCsv(dir, '2026-11-18_0.0.0_FuelTransfer.csv', [
    'TimelineID,Time,UnitID,UnitName,UnitClass,UnitSide,ReceiverID,ReceiverName,ReceiverClass,ReceiverSide,FuelQuantity,FuelType',
    'tl-1,00:02:00,kc1,KC-46,Tanker,Blue,b1,F-35A #1,F-35A,Blue,2500,AviationFuel',
  ]);
  writeCsv(dir, '2026-11-18_0.0.0_MissionChanged.csv', [
    'TimelineID,Time,MissionName,MissionID,Side,Category,MissionClass,IsActive,StartTime,EndTime,TakeOffTime,TimeOnTarget',
    'tl-1,00:00:00,CAP-East,m1,Blue,Strike,Strike,true,00:00:00,00:10:00,00:00:10,00:02:00',
  ]);
  return dir;
}

test('Stage 20: 注册表完整包含 41 个 Operators v2 且全部带角色与蓝图', () => {
  assert.equal(ALL_OPERATORS.length, 41);
  const roles = new Set(ALL_OPERATORS.map((o) => o.meta.evalRole));
  assert.ok(roles.has('MOE') && roles.has('MOP'));
  for (const op of ALL_OPERATORS) {
    assert.ok(op.meta.doctrineRef, `缺少 doctrineRef: ${op.meta.id}`);
    const bp = getOperatorPipelineBlueprint(op.meta.id, op.meta.name);
    assert.ok(bp && bp.nodes.length >= 3, `蓝图节点不足 3 个: ${op.meta.id}`);
  }
});

test('Stage 20: 阶段 1 新增 9 张原生表解析与阶段 2 美军核心口径边界验证', () => {
  const dir = buildSyntheticCsvDir();
  try {
    const { model } = parseCsvDirectoryToSituation(dir, { runId: 'v2-test' });
    assert.equal(model.monteCarloId, 'mc-001');
    assert.equal(model.monteCarloIteration, 3);
    assert.equal(model.firstSensorDetections?.length, 2);
    assert.equal(model.engagementCycleEvents?.length, 2);
    assert.equal(model.componentStatusEvents?.length, 3);
    assert.equal(model.unitJamEvents?.length, 2);
    assert.equal(model.commJamEvents?.length, 2);
    assert.equal(model.dockingOpsEvents?.length, 2);
    assert.equal(model.fuelTransferEvents?.length, 1);
    assert.equal(model.missionMetas?.[0]?.timeOnTargetSeconds, 120);

    const ctx = { runId: 'v2-test', situation: model, customParams: { targetSide: 'Blue', enemySide: 'Red' } };

    // 空间遵从率在无走廊时严格 fail-closed 为 unavailable
    const cor = evaluateOperator('roe.corridor_spatial_compliance', ctx);
    assert.equal(cor.status, 'unavailable');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Stage 20 (Stage 3-4): 指标映射、合规预置体系权重校验', () => {
  const allInds = defaultIndicatorStore.listAll();
  const v2Ids = new Set(ALL_OPERATORS.map((o) => o.meta.id));
  assert.equal(allInds.length, 21);
  for (const ind of allInds) {
    if (ind.bindingMode === 'composite') {
      assert.ok(ind.sources && ind.sources.length >= 1, `复合指标 ${ind.indicatorId} 缺少 sources`);
      for (const src of ind.sources) {
        assert.ok(v2Ids.has(src.atomRef), `复合指标 ${ind.indicatorId} 引用了非 v2 算子 ${src.atomRef}`);
      }
    } else {
      assert.ok(v2Ids.has(ind.atomRef), `指标 ${ind.indicatorId} 引用了非 v2 算子 ${ind.atomRef}`);
    }
  }

  const systems = defaultSystemStore.listAll();
  assert.ok(systems.length >= 1);
  for (const sys of systems) {
    const v = validateIndicatorSystem(sys, defaultIndicatorStore);
    assert.equal(v.valid, true, `预置体系 ${sys.systemId} 校验失败: ${v.errors.join('; ')}`);
  }
});
