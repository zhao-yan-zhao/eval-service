import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildSituationModel } from '../src/core/situation-model.ts';
import { IndicatorStore } from '../src/indicators/store.ts';
import { SystemStore } from '../src/systems/store.ts';
import { evaluateIndicatorSystem } from '../src/systems/evaluator.ts';
import { normalizeSystemWeights, validateIndicatorSystem } from '../src/systems/validator.ts';

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

test('二库指标库与三库四套预置体系全部通过权重与引用校验', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stage3-'));
  try {
    const indStore = new IndicatorStore(path.join(tmpDir, 'custom-indicators.json'));
    const sysStore = new SystemStore(path.join(tmpDir, 'custom-systems.json'), indStore);

    const allIndicators = indStore.listAll();
    assert.ok(allIndicators.length >= 21);

    const allSystems = sysStore.listAll();
    assert.equal(allSystems.length, 4);

    for (const sys of allSystems) {
      const res = validateIndicatorSystem(sys, indStore);
      assert.equal(res.valid, true, `预置体系 ${sys.systemId} 校验失败: ${res.errors.join('; ')}`);
    }

    // 自定义指标写入与拦截未注册算子
    assert.throws(() =>
      indStore.upsertCustom({
        indicatorId: 'bad_ind',
        name: '非法指标',
        atomRef: 'non.existent.operator',
        scoring: { type: 'boolean' },
      }),
    );

    const savedInd = indStore.upsertCustom({
      indicatorId: 'ind_custom_fast_fire',
      name: '极速开火响应（自定义）',
      atomRef: 'time.first_weapon_fire',
      scoring: { type: 'smaller_is_better', optimal: 30, worst: 300 },
    });
    assert.equal(savedInd.builtin, false);
    assert.equal(indStore.get('ind_custom_fast_fire')?.name, '极速开火响应（自定义）');

    // 自动权重归一化助手测试
    const bvr = structuredClone(sysStore.get('sys_bvr_air_combat_v1')!);
    bvr.root.children[0].weight = 99;
    assert.equal(validateIndicatorSystem(bvr, indStore).valid, false);
    const normalized = normalizeSystemWeights(bvr);
    assert.equal(validateIndicatorSystem(normalized, indStore).valid, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('使用 BVR 评估体系评测真实 GJ11-PL15 CSV 并生成 EvalSummaryV2', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stage3-eval-'));
  try {
    const indStore = new IndicatorStore(path.join(tmpDir, 'custom-indicators.json'));
    const sysStore = new SystemStore(path.join(tmpDir, 'custom-systems.json'), indStore);
    const bvr = sysStore.get('sys_bvr_air_combat_v1')!;

    const situation = await buildSituationModel({
      runId: 'gj11-bvr-eval',
      csvDir: REAL_CSV_DIR,
    });
    const out = evaluateIndicatorSystem(
      bvr,
      {
        runId: 'gj11-bvr-eval',
        situation,
        customParams: { targetSide: '红方', enemySide: '蓝方' },
      },
      { indicatorStore: indStore },
    );

    assert.ok(out.overallScore !== null && out.overallScore > 0 && out.overallScore <= 100);
    assert.ok(out.availableWeightRatio > 0.7);
    assert.equal(out.evalSummaryV2.kpis.length, 4);
    assert.equal(out.evalSummaryV2.radar.dimensions.length, 4);
    assert.equal(out.evalSummaryV2.bars.length, 4);
    assert.ok(out.evalSummaryV2.evidenceTimeline.length > 0);
    assert.ok(out.evalSummaryV2.conclusion.includes('红方'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('使用近岸集群体系评测 BS 帧样本：缺省字段不盲目填充，权重合法重归一', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stage3-bs-'));
  try {
    const indStore = new IndicatorStore(path.join(tmpDir, 'custom-indicators.json'));
    const sysStore = new SystemStore(path.join(tmpDir, 'custom-systems.json'), indStore);
    const swarm = sysStore.get('sys_littoral_swarm_v1')!;

    const situation = await buildSituationModel({
      runId: 'bs-swarm-eval',
      jsonlFile: BS_SAMPLE_JSONL,
    });
    const out = evaluateIndicatorSystem(
      swarm,
      { runId: 'bs-swarm-eval', situation },
      { indicatorStore: indStore },
    );

    assert.ok(out.availableWeightRatio > 0 && out.availableWeightRatio < 1);
    const penAtom = out.atomResults['eff.target_penetration_rate'];
    assert.equal(penAtom.status, 'unavailable');
    assert.equal(out.evalSummaryV2.radar.dimensions.length, 5);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
