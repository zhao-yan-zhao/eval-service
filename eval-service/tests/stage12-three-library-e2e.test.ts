import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type {
  CustomOperatorDefinition,
  IndicatorDefinition,
  IndicatorSystem,
  MetricAtomContext,
  TableDataset,
} from '../src/core/types.ts';
import { IndicatorStore, resolveIndicatorOutputFromAtoms } from '../src/indicators/store.ts';
import { buildSituationModel } from '../src/core/situation-model.ts';
import { CustomOperatorStore } from '../src/operators/custom-store.ts';
import { OperatorOverrideStore } from '../src/operators/override-store.ts';
import { evaluateOperator, listOperatorMetas } from '../src/operators/registry.ts';
import { evaluateIndicatorSystem } from '../src/systems/evaluator.ts';
import { SystemStore } from '../src/systems/store.ts';
import { createEvalApp } from '../src/server.ts';

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

test('Stage 12.1 - 一库算子流水线：行内公式衍生 (formula_pipeline) 与跨行聚合 (aggregation) 内核贯通', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-s12-op-'));
  const customStore = new CustomOperatorStore(path.join(tmpDir, 'custom-operators.json'));
  const overrideStore = new OperatorOverrideStore(path.join(tmpDir, 'overrides.json'));

  // 1. 创建基于 CSV WeaponFired 直连提取的行内公式计算算子 (formula_pipeline)
  const formulaOpDef: CustomOperatorDefinition = {
    id: 'custom.s12_weapon_efficiency_calc',
    name: '武器发射效能行内计算',
    category: 'effectiveness',
    mode: 'formula_pipeline',
    pipelineCategory: 'inline_calc',
    description: '行内计算发射距离与命中得分综合能效',
    expression: '',
    variables: [],
    sourceBinding: {
      sourceType: 'csv',
      csvTable: 'WeaponFired',
    },
    formulaConfig: {
      derivedColumns: [
        {
          columnName: 'target_range_horiz',
          dataType: 'number',
          expression: 'IFNULL([TargetContactRangeHoriz_nm], 30)',
        },
        {
          columnName: 'is_red_side',
          dataType: 'boolean',
          expression: '[FiringUnitSide] = "红方"',
        },
        {
          columnName: 'efficiency_score',
          dataType: 'number',
          expression: 'ROUND(CLAMP(target_range_horiz * 1.5, 10, 100), 2)',
        },
      ],
    },
    targetField: 'efficiency_score',
    outputType: 'score',
    unit: '分',
    defaultOptimalDirection: 'larger_is_better',
  };

  customStore.upsert(formulaOpDef);

  const gj11 = await buildSituationModel({ runId: 's12_test_run', csvDir: REAL_CSV_DIR });
  const mockCtx: MetricAtomContext = {
    runId: 's12_test_run',
    situation: gj11,
    csvDir: REAL_CSV_DIR,
    customParams: { targetSide: '红方', enemySide: '蓝方' },
  };

  const formulaResult = evaluateOperator(
    formulaOpDef.id,
    mockCtx,
    customStore,
    new Set(),
    overrideStore,
  );

  assert.equal(formulaResult.status, 'valid');
  assert.equal(formulaResult.confidence, 'high');
  assert.ok(typeof formulaResult.value === 'number' && formulaResult.value > 0);
  assert.ok(formulaResult.evidenceRefs.length > 0);
  const formulaDetails = formulaResult.details as any;
  assert.equal(formulaDetails.mode, 'formula_pipeline');
  assert.ok(formulaDetails.outputDataset?.rows.length > 0);
  assert.ok('efficiency_score' in formulaDetails.fieldValues);

  // 2. 创建基于上游公式输出的跨行分组汇总算子 (aggregation)
  const aggOpDef: CustomOperatorDefinition = {
    id: 'custom.s12_weapon_efficiency_summary',
    name: '红蓝阵营武器效能汇总',
    category: 'effectiveness',
    mode: 'aggregation',
    pipelineCategory: 'group_agg',
    description: '按阵营分组汇总平均射距效能与发射弹数',
    expression: '',
    variables: [],
    sourceBinding: {
      sourceType: 'csv',
      csvTable: 'WeaponFired',
    },
    // 将上游衍生公式嵌入组合流水线
    formulaConfig: formulaOpDef.formulaConfig,
    aggregationConfig: {
      groupKeys: ['FiringUnitSide'],
      metrics: [
        {
          targetField: 'salvo_total',
          sourceColumn: '',
          method: 'COUNT_ALL',
        },
        {
          targetField: 'avg_efficiency_score',
          sourceColumn: 'efficiency_score',
          method: 'AVERAGE',
        },
        {
          targetField: 'max_efficiency_score',
          sourceColumn: 'efficiency_score',
          method: 'MAX',
        },
      ],
    },
    targetField: 'avg_efficiency_score',
    outputType: 'score',
    unit: '分',
    defaultOptimalDirection: 'larger_is_better',
  };

  customStore.upsert(aggOpDef);

  const aggResult = evaluateOperator(
    aggOpDef.id,
    mockCtx,
    customStore,
    new Set(),
    overrideStore,
  );

  assert.equal(aggResult.status, 'valid');
  assert.ok(typeof aggResult.value === 'number' && aggResult.value > 0);
  const aggDetails = aggResult.details as any;
  assert.equal(aggDetails.mode, 'aggregation');
  assert.equal(aggDetails.pipelineCategory, 'group_agg');
  assert.ok(aggDetails.outputDataset.rows.length >= 1);
  assert.ok(aggResult.evidenceRefs.some((e) => e.ref.includes('aggregation:')));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Stage 12.2 - 二库指标协同：指标直接绑定算子流水线 targetField 聚合输出并完成归一化评分', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-s12-ind-'));
  const customStore = new CustomOperatorStore(path.join(tmpDir, 'custom-operators.json'));
  const overrideStore = new OperatorOverrideStore(path.join(tmpDir, 'overrides.json'));

  // 创建一个生成标量统计的聚合算子
  const aggOpDef: CustomOperatorDefinition = {
    id: 'custom.s12_missile_accuracy_agg',
    name: '导弹制导打击效能聚合',
    category: 'effectiveness',
    mode: 'aggregation',
    pipelineCategory: 'group_agg',
    description: '全表聚合平均打击精度与弹药消耗',
    expression: '',
    variables: [],
    sourceBinding: {
      sourceType: 'csv',
      csvTable: 'WeaponFired',
    },
    aggregationConfig: {
      groupKeys: [],
      metrics: [
        { targetField: 'weapon_count', sourceColumn: '', method: 'COUNT_ALL' },
        { targetField: 'avg_range_nm', sourceColumn: 'TargetContactRangeHoriz_nm', method: 'AVERAGE' },
      ],
    },
    targetField: 'avg_range_nm',
    outputType: 'score',
    unit: 'nm',
    defaultOptimalDirection: 'larger_is_better',
  };

  customStore.upsert(aggOpDef);

  // 初始化二库 IndicatorStore
  const indicatorStore = new IndicatorStore(
    path.join(tmpDir, 'custom-indicators.json'),
    (atomId) => customStore.has(atomId) || ['eff.hit_rate', 'time.first_weapon_fire'].includes(atomId),
  );

  // 在二库中定义绑定该聚合算子 targetField 的指标
  const indDef: IndicatorDefinition = {
    indicatorId: 'ind.s12_avg_missile_range',
    name: '中距空战超视距发射射距均值指标',
    atomRef: 'custom.s12_missile_accuracy_agg',
    targetField: 'avg_range_nm',
    scoring: {
      type: 'larger_is_better',
      optimal: 80,
      worst: 20,
    },
    category: 'effectiveness',
    unit: 'nm',
    weight: 1.0,
    builtin: false,
  };

  indicatorStore.upsertCustom(indDef);

  const gj11 = await buildSituationModel({ runId: 's12_test_run', csvDir: REAL_CSV_DIR });
  const mockCtx: MetricAtomContext = {
    runId: 's12_test_run',
    situation: gj11,
    csvDir: REAL_CSV_DIR,
    customParams: { targetSide: '红方', enemySide: '蓝方' },
  };

  // 1. 运行算子
  const opResult = evaluateOperator(
    aggOpDef.id,
    mockCtx,
    customStore,
    new Set(),
    overrideStore,
  );
  assert.equal(opResult.status, 'valid');

  // 2. 验证指标协同解析与证据链挂载
  const atomResults = { [aggOpDef.id]: opResult };
  const resolved = resolveIndicatorOutputFromAtoms(indDef, atomResults);

  assert.equal(resolved.rawResult.status, 'valid');
  assert.equal(resolved.rawResult.value, opResult.value);
  assert.ok(typeof resolved.score === 'number' && resolved.score >= 0 && resolved.score <= 100);
  assert.ok(
    resolved.rawResult.evidenceRefs.some((e) =>
      e.ref.includes('indicator:ind.s12_avg_missile_range->custom.s12_missile_accuracy_agg#avg_range_nm'),
    ),
    '证据链应完整记录二库指标到一库算子聚合字段的绑定关系',
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Stage 12.3 - 三库完整闭环：算子流水线 ➔ 指标库映射 ➔ 评估体系 AHP/MCDA 层次赋权决策出数', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-s12-sys-'));
  const customStore = new CustomOperatorStore(path.join(tmpDir, 'custom-operators.json'));
  const overrideStore = new OperatorOverrideStore(path.join(tmpDir, 'overrides.json'));

  // 1. 一库：注册一个流水线聚合算子
  const customOp: CustomOperatorDefinition = {
    id: 'custom.s12_strike_pipeline_agg',
    name: '空战打击综合聚合算子',
    category: 'effectiveness',
    mode: 'aggregation',
    pipelineCategory: 'group_agg',
    description: '空战综合打击评分',
    expression: '',
    variables: [],
    sourceBinding: {
      sourceType: 'csv',
      csvTable: 'WeaponFired',
    },
    aggregationConfig: {
      groupKeys: [],
      metrics: [
        { targetField: 'total_shots', sourceColumn: '', method: 'COUNT_ALL' },
        { targetField: 'mean_firing_dist', sourceColumn: 'TargetContactRangeHoriz_nm', method: 'AVERAGE' },
      ],
    },
    targetField: 'mean_firing_dist',
    outputType: 'score',
    unit: 'nm',
    defaultOptimalDirection: 'larger_is_better',
  };
  customStore.upsert(customOp);

  // 2. 二库：注册绑定该算子的指标
  const indicatorStore = new IndicatorStore(
    path.join(tmpDir, 'custom-indicators.json'),
    (atomId) => true,
  );

  const customInd: IndicatorDefinition = {
    indicatorId: 'ind.s12_mean_firing_dist',
    name: '平均射距达标率指标',
    atomRef: customOp.id,
    targetField: 'mean_firing_dist',
    scoring: {
      type: 'larger_is_better',
      optimal: 70,
      worst: 20,
    },
    category: 'effectiveness',
    unit: 'nm',
    weight: 0.7,
    builtin: false,
  };
  indicatorStore.upsertCustom(customInd);

  // 3. 三库：定义层次化评估体系 (AHP/MCDA)
  const testSystem: IndicatorSystem = {
    systemId: 'sys.s12_air_combat_eval',
    name: 'Stage 12 三库协同空战效能评估体系',
    version: '1.0.0',
    description: '验证一库流水线 -> 二库指标 -> 三库层次评估端到端打通',
    targetTags: ['air_combat'],
    kpis: [],
    root: {
      name: '空战综合评估总分',
      weight: 1.0,
      method: 'weighted_sum',
      children: [
        {
          id: 'dim_strike',
          name: '远程打击维度',
          weight: 0.6,
          children: [
            {
              indicatorRef: 'ind.s12_mean_firing_dist',
              weight: 0.7,
            },
            {
              indicatorRef: 'ind_weapon_hit_rate',
              weight: 0.3,
            },
          ],
        },
        {
          id: 'dim_kinematics',
          name: '态势时效维度',
          weight: 0.4,
          children: [
            {
              indicatorRef: 'ind_first_fire_tempo',
              weight: 1.0,
            },
          ],
        },
      ],
    },
  };

  const gj11 = await buildSituationModel({ runId: 's12_test_run', csvDir: REAL_CSV_DIR });
  const mockCtx: MetricAtomContext = {
    runId: 's12_test_run',
    situation: gj11,
    csvDir: REAL_CSV_DIR,
    customParams: { targetSide: '红方', enemySide: '蓝方' },
  };

  // 4. 执行体系评估 evaluateIndicatorSystem
  const evalResult = evaluateIndicatorSystem(testSystem, mockCtx, {
    indicatorStore,
    customOperatorStore: customStore,
    operatorOverrideStore: overrideStore,
  });

  // 验证评估体系总输出结构
  assert.equal(evalResult.systemId, testSystem.systemId);
  assert.ok(evalResult.overallScore !== null && evalResult.overallScore > 0 && evalResult.overallScore <= 100);

  // 验证根节点及子维度权重与得分汇聚
  const root = evalResult.rootTree;
  assert.equal(root.name, '空战综合评估总分');
  assert.equal(root.children.length, 2);

  const dimStrike = root.children.find((c: any) => c.name === '远程打击维度');
  assert.ok(dimStrike);
  assert.ok(dimStrike.score !== null && dimStrike.score > 0);
  assert.equal(dimStrike.children.length, 2);

  const customLeaf = dimStrike.children.find((l: any) => l.indicatorRef === 'ind.s12_mean_firing_dist');
  assert.ok(customLeaf);
  assert.ok(customLeaf.score !== null && customLeaf.score > 0);
  assert.equal(customLeaf.atomRef, customOp.id);
  assert.ok(customLeaf.weightedContribution > 0);
  assert.ok(customLeaf.rawResult.evidenceRefs.length > 0);

  const dimKinematics = root.children.find((c: any) => c.name === '态势时效维度');
  assert.ok(dimKinematics);
  assert.ok(dimKinematics.score !== null && dimKinematics.score > 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Stage 12.4 - REST APIs: /api/operators/categories, preview, validate-formula 全量端到端接口校验', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-s12-http-'));
  const customStore = new CustomOperatorStore(path.join(tmpDir, 'custom-ops.json'));
  const overrideStore = new OperatorOverrideStore(path.join(tmpDir, 'overrides.json'));
  const indicatorStore = new IndicatorStore(path.join(tmpDir, 'indicators.json'));
  const systemStore = new SystemStore(path.join(tmpDir, 'systems.json'));

  const app = await createEvalApp({
    customOperatorStore: customStore,
    operatorOverrideStore: overrideStore,
    indicatorStore,
    systemStore,
  });

  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', () => resolve()));
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /api/operators/categories 接口
    const catRes = await fetch(`${baseUrl}/api/operators/categories`).then(
      (r) =>
        r.json() as Promise<{
          ok: boolean;
          categories: Array<{ id: string; name: string; count: number; badge: string }>;
          totalOperators: number;
        }>,
    );
    assert.equal(catRes.ok, true);
    assert.equal(catRes.categories.length, 6);
    const catIds = catRes.categories.map((c) => c.id);
    assert.ok(catIds.includes('data_input'));
    assert.ok(catIds.includes('inline_calc'));
    assert.ok(catIds.includes('group_agg'));
    assert.ok(catIds.includes('result_output'));
    assert.ok(catIds.includes('spatial'));
    assert.ok(catIds.includes('python_script'));
    assert.ok(catRes.totalOperators >= 36);

    // 2. POST /api/operators/validate-formula 接口
    const valGoodRes = await fetch(`${baseUrl}/api/operators/validate-formula`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expression: 'IF([speed] > 1000, [dist] / 2, [dist] * 1.5)',
        availableColumns: ['speed', 'dist', 'side'],
      }),
    }).then(
      (r) =>
        r.json() as Promise<{
          ok: boolean;
          valid: boolean;
          referencedVariables: string[];
          errors: string[];
        }>,
    );
    assert.equal(valGoodRes.ok, true);
    assert.equal(valGoodRes.valid, true);
    assert.deepEqual(valGoodRes.referencedVariables.sort(), ['dist', 'speed']);
    assert.equal(valGoodRes.errors.length, 0);

    // 校验非法公式及未知字段
    const valBadRes = await fetch(`${baseUrl}/api/operators/validate-formula`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expression: '[unknown_col] + 10',
        availableColumns: ['speed', 'dist'],
      }),
    }).then(
      (r) =>
        r.json() as Promise<{
          ok: boolean;
          valid: boolean;
          errors: string[];
        }>,
    );
    assert.equal(valBadRes.valid, false);
    assert.ok(valBadRes.errors.some((e) => e.includes('unknown_col')));

    // 3. POST /api/operators/preview 接口：行内公式试算
    const formulaPreviewRes = await fetch(`${baseUrl}/api/operators/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sampleDataset: {
          columns: [
            { name: 'fighter', type: 'string' },
            { name: 'speed_kmh', type: 'number' },
          ],
          rows: [
            { fighter: 'J20-A', speed_kmh: 2200 },
            { fighter: 'J20-B', speed_kmh: 1800 },
          ],
        },
        type: 'formula_pipeline',
        formulaConfig: {
          derivedColumns: [
            {
              columnName: 'speed_mach',
              dataType: 'number',
              expression: 'ROUND(speed_kmh / 1225, 2)',
            },
          ],
        },
      }),
    }).then(
      (r) =>
        r.json() as Promise<{
          ok: boolean;
          totalRows: number;
          diffCols: string[];
          previewRows: Array<Record<string, unknown>>;
          latencyMs: number;
        }>,
    );
    assert.equal(formulaPreviewRes.ok, true);
    assert.equal(formulaPreviewRes.totalRows, 2);
    assert.deepEqual(formulaPreviewRes.diffCols, ['speed_mach']);
    assert.equal(formulaPreviewRes.previewRows[0].speed_mach, 1.8);
    assert.ok(formulaPreviewRes.latencyMs >= 0);

    // 4. POST /api/operators/preview 接口：跨行聚合试算
    const aggPreviewRes = await fetch(`${baseUrl}/api/operators/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sampleDataset: {
          columns: [
            { name: 'side', type: 'string' },
            { name: 'damage', type: 'number' },
          ],
          rows: [
            { side: '红方', damage: 45 },
            { side: '红方', damage: 55 },
            { side: '蓝方', damage: 30 },
          ],
        },
        type: 'aggregation',
        aggregationConfig: {
          groupKeys: ['side'],
          metrics: [
            { targetField: 'count', sourceColumn: '', method: 'COUNT_ALL' },
            { targetField: 'avg_dmg', sourceColumn: 'damage', method: 'AVERAGE' },
          ],
        },
      }),
    }).then(
      (r) =>
        r.json() as Promise<{
          ok: boolean;
          totalRows: number;
          diffCols: string[];
          previewRows: Array<Record<string, unknown>>;
        }>,
    );
    assert.equal(aggPreviewRes.ok, true);
    assert.equal(aggPreviewRes.totalRows, 2);
    assert.deepEqual(aggPreviewRes.diffCols, ['count', 'avg_dmg']);
    const redRow = aggPreviewRes.previewRows.find((r) => r.side === '红方');
    assert.ok(redRow);
    assert.equal(redRow.count, 2);
    assert.equal(redRow.avg_dmg, 50);
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
