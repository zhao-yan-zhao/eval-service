import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { applyScoringRule, sampleScoringCurve } from '../src/core/scoring-functions.ts';
import { buildSituationModel } from '../src/core/situation-model.ts';
import { parseF1Time } from '../src/core/time-utils.ts';
import { parseCsvDirectoryToSituation, resolveCanonicalCsvEventName } from '../src/adapters/csv-adapter.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

test('parseF1Time 兼容 ISO、.NET Ticks、C# TimeSpan 与美式 DateTime', () => {
  const iso = parseF1Time('2026-06-01T04:02:31Z');
  assert.equal(iso?.kind, 'epoch_ms');
  assert.equal(iso?.clockText, '04:02:31');

  // 2026-06-01T04:00:00Z 的 .NET Ticks 校验
  const targetMs = Date.UTC(2026, 5, 1, 4, 0, 0);
  const ticksStr = (621355968000000000n + BigInt(targetMs) * 10000n).toString();
  const parsedTicks = parseF1Time(ticksStr);
  assert.equal(parsedTicks?.kind, 'epoch_ms');
  assert.equal(parsedTicks?.clockText, '04:00:00');
  assert.equal(parsedTicks?.epochMs, targetMs);

  const ts = parseF1Time('00:02:04.8000000');
  assert.equal(ts?.kind, 'relative_seconds');
  assert.ok(Math.abs((ts?.relativeSeconds ?? 0) - 124.8) < 1e-6);
  assert.equal(ts?.clockText, '00:02:04');

  const tsDays = parseF1Time('1.02:00:00');
  assert.equal(tsDays?.relativeSeconds, 86400 + 7200);

  const usDt = parseF1Time('10/10/2026 00:34:05.250');
  assert.equal(usDt?.kind, 'epoch_ms');
  assert.equal(usDt?.clockText, '00:34:05');
});

test('scoring-functions 纯函数支持 6 种规则并对空值保持 fail-closed', () => {
  assert.equal(applyScoringRule(null, { type: 'smaller_is_better', optimal: 60, worst: 600 }), null);
  assert.equal(applyScoringRule(60, { type: 'smaller_is_better', optimal: 60, worst: 600 }), 100);
  assert.equal(applyScoringRule(600, { type: 'smaller_is_better', optimal: 60, worst: 600 }), 0);
  assert.equal(applyScoringRule(330, { type: 'smaller_is_better', optimal: 60, worst: 600 }), 50);

  assert.equal(applyScoringRule(0.9, { type: 'larger_is_better', worst: 0.2, optimal: 0.8 }), 100);
  assert.equal(applyScoringRule(0.5, { type: 'linear', bounds: [0, 1], scoreRange: [20, 100] }), 60);
  assert.equal(applyScoringRule(true, { type: 'boolean', trueScore: 95, falseScore: 10 }), 95);
  assert.equal(
    applyScoringRule(0.55, {
      type: 'step',
      steps: [
        { val: 0, score: 20 },
        { val: 0.5, score: 75 },
        { val: 0.8, score: 100 },
      ],
    }),
    75,
  );

  // 区间最优 / 梯形评分函数 (target_range)
  const rangeRule = {
    type: 'target_range' as const,
    optimalRange: [8000, 10000] as [number, number],
    toleranceRange: [6000, 12000] as [number, number],
  };
  assert.equal(applyScoringRule(9000, rangeRule), 100);
  assert.equal(applyScoringRule(8000, rangeRule), 100);
  assert.equal(applyScoringRule(10000, rangeRule), 100);
  assert.equal(applyScoringRule(7000, rangeRule), 50);
  assert.equal(applyScoringRule(11000, rangeRule), 50);
  assert.equal(applyScoringRule(5000, rangeRule), 0);
  assert.equal(applyScoringRule(13000, rangeRule), 0);

  assert.equal(sampleScoringCurve({ type: 'linear', bounds: [0, 10] }, 5).length, 5);
  assert.equal(sampleScoringCurve(rangeRule, 10).length, 10);
});

test('frame-adapter 能基于 demo-ui bs-frames-sample.jsonl 构造真实 SituationModel', async () => {
  const sampleJsonl = path.join(REPO_ROOT, 'demo-ui', 'proxy', 'testdata', 'bs-frames-sample.jsonl');
  const model = await buildSituationModel({
    runId: 'test-bs-sample',
    jsonlFile: sampleJsonl,
  });

  assert.equal(model.units.size, 3);
  assert.ok(model.sides.includes('红方'));
  assert.ok(model.sides.includes('蓝方'));
  assert.ok(model.coverage.hasContacts);
  assert.ok(model.coverage.hasWeaponFired);
  assert.ok(model.coverage.hasDamagedOrDestroyed);
  assert.equal(model.coverage.hasSensorStates, false);
  assert.ok(model.weaponFiredEvents.length >= 1);
  assert.ok(model.damageAndHitEvents.some((e) => e.damageState === 'destroyed'));
  assert.equal(model.totalGameSeconds, 240);
});

test('frame-adapter 兼容真机 Q-077 单键包装、字符串数值、SideID 映射与 .NET Ticks', async () => {
  const t0 = 621355968000000000n + BigInt(Date.UTC(2026, 9, 23, 8, 0, 0)) * 10000n;
  const t1 = t0 + 120n * 10000000n;
  const lines = [
    JSON.stringify({
      Scenario: {
        Time: t0.toString(),
        Sides: [{ Side: { ID: 'SIDE-R', Name: '红方' } }, { Side: { ID: 'SIDE-B', Name: '蓝方' } }],
        ActiveUnits: [
          {
            Ship: {
              ID: 'U-1',
              Name: '无锡舰',
              SideID: 'SIDE-R',
              LonLR: '121.4',
              LatLR: '24.5',
              CH: '90',
              CS: '18',
              Mounts: [{ Mount: { Name: 'H/AJK', MW: [{ WRec: { WeapID: 'W1', CurrentLoad: '8' } }] } }],
              Sensors: [{ Sensor: { ID: 'S1', Name: '346A雷达', Active: 'True' } }],
            },
          },
        ],
      },
    }),
    JSON.stringify({
      Scenario: {
        Time: t1.toString(),
        Sides: [
          { Side: { ID: 'SIDE-R', Name: '红方', Contacts: [{ Contact: { ID: 'C-1', ActualUnitID: 'U-B1', Name: '伯克级' } }] } },
          { Side: { ID: 'SIDE-B', Name: '蓝方', Contacts: [] } },
        ],
        ActiveUnits: [
          {
            Ship: {
              ID: 'U-1',
              Name: '无锡舰',
              SideID: 'SIDE-R',
              LonLR: '121.5',
              LatLR: '24.5',
              CH: '95',
              CS: '22',
              Mounts: [{ Mount: { Name: 'H/AJK', MW: [{ WRec: { WeapID: 'W1', CurrentLoad: '6' } }] } }],
              Sensors: [{ Sensor: { ID: 'S1', Name: '346A雷达', Active: 'False' } }],
            },
          },
        ],
      },
    }),
  ].join('\n');

  const model = await buildSituationModel({ runId: 'q077-sim', jsonlText: lines });
  assert.equal(model.totalGameSeconds, 120);
  const ship = model.units.get('u-1');
  assert.ok(ship);
  assert.equal(ship.side, '红方');
  assert.equal(ship.ammoRemaining, 6);
  assert.equal(ship.emconStates.length, 2);
  assert.equal(model.coverage.hasSensorStates, true);
  assert.ok(model.contacts.has('c-1'));
});

test('csv-adapter 正确剥除双 BOM、兼容 UnitDamaged/Damage 别名并解析仓内真实 m6 BVR 目录', () => {
  assert.equal(resolveCanonicalCsvEventName('2026-10-10_0.34.5_UnitDamaged.csv'), 'UnitDamaged');
  assert.equal(resolveCanonicalCsvEventName('Damage.csv'), 'UnitDamaged');

  const realCsvDir = path.join(
    REPO_ROOT,
    'LabConsole',
    'outputs',
    'm6-verify-runs',
    '39c47807bece4e0690feb0598f7a92d1',
    'GJ11-PL15试射-90nm正对-80nm-1',
  );
  const { model, tableCounts } = parseCsvDirectoryToSituation(realCsvDir);
  assert.equal(model.coverage.bomCountDetected, 2);
  assert.ok(tableCounts.WeaponFired > 0);
  assert.ok(tableCounts.WeaponEndgame > 0);
  assert.ok(tableCounts.UnitCreated > 0);
  assert.ok(model.weaponFiredEvents.every((w) => !/#\d+$/.test(w.weaponTypeNormalized)));
  assert.ok(model.damageAndHitEvents.some((d) => d.damageState === 'destroyed'));
});
