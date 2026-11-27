import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseCsvDirectoryToSituation } from '../src/adapters/csv-adapter.ts';
import { ALL_V4_OPERATOR_SCRIPTS, V4OperatorRunner } from '../src/operators/v4/index.ts';

test('Stage 17 (V4)：跨天长推演 C# TimeSpan 精确秒数解析与 V4 算子零降级兼容', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stage17-'));
  try {
    // 构造含跨天 TimeSpan (1.00:03:04.1000000 = 86584.1s, 2.14:59:59.5000000 = 226799.5s) 的规范 CSV 目录
    fs.writeFileSync(
      path.join(tmpDir, 'SimInfo.csv'),
      [
        'TimelineID,Time,SimName,SideID,SideName',
        'tl-1,00:00:00.0000000,台海多日推演,r1,Red',
        'tl-1,00:00:00.0000000,台海多日推演,b1,Blue',
      ].join('\n') + '\n',
      'utf-8',
    );

    fs.writeFileSync(
      path.join(tmpDir, 'UnitCreated.csv'),
      [
        'TimelineID,Time,UnitID,UnitName,UnitSide,UnitClass,UnitType',
        'tl-1,00:00:00.0000000,u-r1,红方编队-1,Red,Aircraft,Fighter',
        'tl-1,1.00:03:04.1000000,u-b1,蓝方舰艇-1,Blue,Ship,Destroyer',
      ].join('\n') + '\n',
      'utf-8',
    );

    fs.writeFileSync(
      path.join(tmpDir, 'UnitPositions.csv'),
      [
        'TimelineID,Time,UnitID,UnitName,UnitSide,UnitLongitude,UnitLatitude,UnitAltitude_m,UnitCourse,UnitSpeed_kts',
        'tl-1,00:00:10.0000000,u-r1,红方编队-1,Red,120.1,24.1,8000,90,420',
        'tl-1,1.00:03:04.1000000,u-r1,红方编队-1,Red,120.5,24.3,8000,90,420',
        'tl-1,2.14:59:59.5000000,u-b1,蓝方舰艇-1,Blue,121.0,24.5,0,270,22',
      ].join('\n') + '\n',
      'utf-8',
    );

    fs.writeFileSync(
      path.join(tmpDir, 'WeaponFired.csv'),
      [
        'TimelineID,Time,WeaponID,WeaponName,WeaponClass,FiringUnitID,FiringUnitName,FiringUnitSide,TargetContactID,TargetContactActualUnitID,TargetContactActualUnitSide',
        'tl-1,1.00:03:04.1000000,w-1,YJ-18,Missile,u-r1,红方编队-1,Red,c-1,u-b1,Blue',
      ].join('\n') + '\n',
      'utf-8',
    );

    fs.writeFileSync(
      path.join(tmpDir, 'UnitDestroyed.csv'),
      [
        'TimelineID,Time,UnitID,UnitName,UnitSide,UnitClass,UnitType',
        'tl-1,2.14:59:59.5000000,u-b1,蓝方舰艇-1,Blue,Ship,Destroyer',
      ].join('\n') + '\n',
      'utf-8',
    );

    // 1. 验证 TS csv-adapter 在跨天 TimeSpan 下的精确秒数计算
    const { model: sit } = parseCsvDirectoryToSituation(tmpDir, { runId: 'stage17-long-run' });
    assert.ok(
      Math.abs(sit.totalGameSeconds - 226799.5) < 0.05,
      `总推演时长应为 226799.5s，实际=${sit.totalGameSeconds}`,
    );

    // 2. 验证 V4 算子在跨天 TimeSpan CSV 上零降级正常执行
    const runner = new V4OperatorRunner(ALL_V4_OPERATOR_SCRIPTS);
    try {
      const v4Res = await runner.runOperator('cost.side_attrition_metrics', {
        runId: 'stage17-long-run',
        csvDir: tmpDir,
      });
      assert.equal(v4Res.status, 'valid', `跨天 TimeSpan 下 V4 算子应正常产出，reason=${v4Res.missingDataReason ?? 'none'}`);
      assert.ok(v4Res.dataset && v4Res.dataset.rows.length >= 2);
    } finally {
      await runner.dispose();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
