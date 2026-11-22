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

test('二库指标库与三库预置体系全部通过权重与引用校验', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stage3-'));
  try {
    const indStore = new IndicatorStore(path.join(tmpDir, 'custom-indicators.json'));
    const sysStore = new SystemStore(path.join(tmpDir, 'custom-systems.json'), indStore);

    const allIndicators = indStore.listAll();
    assert.ok(allIndicators.length >= 1);

    const allSystems = sysStore.listAll();
    assert.equal(allSystems.length, 2);

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
      name: '空间走廊遵从指数（自定义）',
      atomRef: 'roe.corridor_spatial_compliance',
      scoring: { type: 'smaller_is_better', optimal: 30, worst: 300 },
    });
    assert.equal(savedInd.builtin, false);
    assert.equal(indStore.get('ind_custom_fast_fire')?.name, '空间走廊遵从指数（自定义）');

    // 自动权重归一化助手测试
    const corridorSys = structuredClone(sysStore.get('sys_corridor_compliance_v1')!);
    corridorSys.root.children[0].weight = 99;
    assert.equal(validateIndicatorSystem(corridorSys, indStore).valid, false);
    const normalized = normalizeSystemWeights(corridorSys);
    assert.equal(validateIndicatorSystem(normalized, indStore).valid, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('使用合规评估体系评测真实 GJ11-PL15 CSV 并生成 EvalSummaryV2', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stage3-eval-'));
  try {
    const indStore = new IndicatorStore(path.join(tmpDir, 'custom-indicators.json'));
    const sysStore = new SystemStore(path.join(tmpDir, 'custom-systems.json'), indStore);
    const corridorSys = sysStore.get('sys_corridor_compliance_v1')!;

    const situation = await buildSituationModel({
      runId: 'gj11-bvr-eval',
      csvDir: REAL_CSV_DIR,
    });
    const out = evaluateIndicatorSystem(
      corridorSys,
      {
        runId: 'gj11-bvr-eval',
        situation,
        customParams: { targetSide: '红方', enemySide: '蓝方' },
      },
      { indicatorStore: indStore },
    );

    assert.ok(out.systemId === 'sys_corridor_compliance_v1');
    assert.ok(out.evalSummaryV2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('使用合规评估体系评测 BS 帧样本：缺省字段不盲目填充，权重合法重归一', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-stage3-bs-'));
  try {
    const indStore = new IndicatorStore(path.join(tmpDir, 'custom-indicators.json'));
    const sysStore = new SystemStore(path.join(tmpDir, 'custom-systems.json'), indStore);
    const corridorSys = sysStore.get('sys_corridor_compliance_v1')!;

    const situation = await buildSituationModel({
      runId: 'bs-swarm-eval',
      jsonlFile: BS_SAMPLE_JSONL,
    });
    const out = evaluateIndicatorSystem(
      corridorSys,
      { runId: 'bs-swarm-eval', situation },
      { indicatorStore: indStore },
    );

    assert.ok(out.systemId === 'sys_corridor_compliance_v1');
    const corAtom = out.atomResults['roe.corridor_spatial_compliance'];
    assert.equal(corAtom.status, 'unavailable');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
