import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {
  IndicatorDefinition,
  IndicatorSystem,
  MetricAtomContext,
  MetricAtomResult,
} from '../src/core/types.ts';
import { IndicatorStore, resolveIndicatorOutputFromAtoms } from '../src/indicators/store.ts';
import { calculateNodeAggregation } from '../src/systems/aggregation-strategies.ts';
import { evaluateIndicatorSystem } from '../src/systems/evaluator.ts';
import { generateEquivalentFormula } from '../src/systems/formula-codegen.ts';
import { validateIndicatorSystem } from '../src/systems/validator.ts';

test('Stage 23.1 - 二库多算子复合指标：LibFormula AST 正常求值与多行 reduce', () => {
  const store = new IndicatorStore();

  const compositeIndicator: IndicatorDefinition = {
    indicatorId: 'ind_composite_strike_eff',
    name: '打击任务综合效费比',
    bindingMode: 'composite',
    atomRef: '',
    sources: [
      {
        alias: 'completion',
        atomRef: 'strike.single_mission_metrics',
        targetField: '完成比',
        reduce: 'mean',
      },
      {
        alias: 'cost',
        atomRef: 'cost.mission_attrition_metrics',
        targetField: '分摊成本',
        reduce: 'sum',
      },
    ],
    composeFormula: 'IF(cost > 0, (completion * 1000) / cost, completion)',
    scoring: {
      type: 'larger_is_better',
      worst: 0.1,
      optimal: 2.0,
    },
  };

  const validationErrors = store.validateIndicatorInput(compositeIndicator);
  assert.equal(validationErrors.length, 0, `指标校验应该通过: ${validationErrors.join('; ')}`);

  // 模拟算子输出（多行数据集）
  const mockAtomResults: Record<string, MetricAtomResult> = {
    'strike.single_mission_metrics': {
      atomId: 'strike.single_mission_metrics',
      value: 1.0,
      displayValue: '有效',
      status: 'valid',
      confidence: 'high',
      evidenceRefs: [],
      details: {
        outputDataset: {
          rows: [
            { 任务ID: 'm1', 完成比: 0.8 },
            { 任务ID: 'm2', 完成比: 0.9 },
            { 任务ID: 'm3', 完成比: 1.0 },
          ],
        },
      },
    },
    'cost.mission_attrition_metrics': {
      atomId: 'cost.mission_attrition_metrics',
      value: 1500,
      displayValue: '1500',
      status: 'valid',
      confidence: 'high',
      evidenceRefs: [],
      details: {
        outputDataset: {
          rows: [
            { 任务ID: 'm1', 分摊成本: 500 },
            { 任务ID: 'm2', 分摊成本: 500 },
          ],
        },
      },
    },
  };

  // completion 的 mean = (0.8 + 0.9 + 1.0) / 3 = 0.9
  // cost 的 sum = 500 + 500 = 1000
  // formula = IF(1000 > 0, (0.9 * 1000) / 1000, 0.9) = 0.9
  const { rawResult, score } = resolveIndicatorOutputFromAtoms(compositeIndicator, mockAtomResults);

  assert.equal(rawResult.status, 'valid');
  assert.equal(rawResult.value, 0.9);
  assert.ok(score !== null && score > 0, `评分应大于0: ${score}`);
  assert.ok(rawResult.evidenceRefs.length >= 2, '证据链应合并多算子来源');
});

test('Stage 23.2 - 二库多算子复合指标：Fail-Closed 缺失传播与 fallback 兜底', () => {
  const store = new IndicatorStore();

  // 1. 严格 Fail 策略
  const strictIndicator: IndicatorDefinition = {
    indicatorId: 'ind_strict_composite',
    name: '严格实证复合指标',
    bindingMode: 'composite',
    atomRef: '',
    sources: [
      { alias: 'a', atomRef: 'strike.damage_simulation', missingPolicy: 'fail' },
      { alias: 'b', atomRef: 'cost.side_attrition_metrics', missingPolicy: 'fail' },
    ],
    composeFormula: 'a + b',
    scoring: { type: 'larger_is_better', worst: 0, optimal: 10 },
  };

  const partialAtoms: Record<string, MetricAtomResult> = {
    'strike.damage_simulation': {
      atomId: 'strike.damage_simulation',
      value: 5,
      displayValue: '5',
      status: 'valid',
      confidence: 'high',
      evidenceRefs: [],
    },
    // cost 缺失
  };

  const strictRes = resolveIndicatorOutputFromAtoms(strictIndicator, partialAtoms);
  assert.equal(strictRes.rawResult.status, 'unavailable');
  assert.equal(strictRes.score, null);
  assert.ok(strictRes.rawResult.missingDataReason?.includes('cost.side_attrition_metrics'));

  // 2. Fallback 策略
  const fallbackIndicator: IndicatorDefinition = {
    ...strictIndicator,
    sources: [
      { alias: 'a', atomRef: 'strike.damage_simulation', missingPolicy: 'fail' },
      {
        alias: 'b',
        atomRef: 'cost.side_attrition_metrics',
        missingPolicy: 'fallback',
        fallbackValue: 3,
      },
    ],
  };

  const fallbackRes = resolveIndicatorOutputFromAtoms(fallbackIndicator, partialAtoms);
  assert.equal(fallbackRes.rawResult.status, 'valid');
  assert.equal(fallbackRes.rawResult.value, 8); // 5 + 3
  assert.ok(fallbackRes.score !== null);
});

test('Stage 23.3 - 三库聚合策略纯函数：7 种策略与缺失策略行为验证', () => {
  const children = [
    { id: 'c1', nodeCode: 's1', weight: 0.6, score: 80 },
    { id: 'c2', nodeCode: 's2', weight: 0.4, score: 60 },
  ];

  // 1. weighted_sum: 0.6 * 80 + 0.4 * 60 = 48 + 24 = 72
  const sumRes = calculateNodeAggregation('weighted_sum', 'skip_renormalize', children);
  assert.equal(sumRes.score, 72);

  // 2. maximin: min(80, 60) = 60
  const minRes = calculateNodeAggregation('maximin', 'skip_renormalize', children);
  assert.equal(minRes.score, 60);

  // 3. max: max(80, 60) = 80
  const maxRes = calculateNodeAggregation('max', 'skip_renormalize', children);
  assert.equal(maxRes.score, 80);

  // 4. mean: (80 + 60) / 2 = 70
  const meanRes = calculateNodeAggregation('mean', 'skip_renormalize', children);
  assert.equal(meanRes.score, 70);

  // 5. geometric_mean: 100 * (0.8^0.6 * 0.6^0.4) ≈ 71.31
  const geoRes = calculateNodeAggregation('geometric_mean', 'skip_renormalize', children);
  assert.ok(geoRes.score !== null && Math.abs(geoRes.score - 71.31) < 0.2);

  // 6. formula: IF(s2 < 70, s1 * 0.7, s1) = 80 * 0.7 = 56
  const formulaRes = calculateNodeAggregation(
    'formula',
    'skip_renormalize',
    children,
    'IF(s2 < 70, s1 * 0.7, s1)',
  );
  assert.equal(formulaRes.score, 56);

  // 7. 缺失策略：fail vs neutral
  const withMissing = [
    { id: 'c1', nodeCode: 's1', weight: 0.5, score: 80 },
    { id: 'c2', nodeCode: 's2', weight: 0.5, score: null },
  ];

  const failMissing = calculateNodeAggregation('weighted_sum', 'fail', withMissing);
  assert.equal(failMissing.score, null);

  const neutralMissing = calculateNodeAggregation('weighted_sum', 'neutral', withMissing);
  // c2 视作 50 分: 0.5 * 80 + 0.5 * 50 = 65
  assert.equal(neutralMissing.score, 65);
});

test('Stage 23.4 - formula-codegen: 确定性代码生成', () => {
  const children = [
    { nodeCode: 'strike_score', weight: 0.4 },
    { nodeCode: 'killchain_score', weight: 0.6 },
  ];

  const sumCode = generateEquivalentFormula('weighted_sum', children);
  assert.equal(sumCode, 'ROUND(0.4 * strike_score + 0.6 * killchain_score, 2)');

  const minCode = generateEquivalentFormula('maximin', children);
  assert.equal(minCode, 'MIN(strike_score, killchain_score)');

  const meanCode = generateEquivalentFormula('mean', children);
  assert.equal(meanCode, 'ROUND(AVG(strike_score, killchain_score), 2)');
});

test('Stage 23.5 - 三库评估体系：4 层深度多策略聚合树端到端实测', () => {
  const tempCustomFile = path.join(os.tmpdir(), `f1-custom-test-ind-${Date.now()}.json`);
  const customStore = new IndicatorStore(tempCustomFile);
  try {

  // 注册 4 个基础指标
  const ind1: IndicatorDefinition = {
    indicatorId: 'ind_test_strike',
    name: '打击分',
    atomRef: 'strike.single_mission_metrics',
    scoring: { type: 'larger_is_better', worst: 0, optimal: 100 },
  };
  const ind2: IndicatorDefinition = {
    indicatorId: 'ind_test_kc',
    name: '杀伤链分',
    atomRef: 'fire_control.unit_kill_chain_closure',
    scoring: { type: 'larger_is_better', worst: 0, optimal: 100 },
  };
  const ind3: IndicatorDefinition = {
    indicatorId: 'ind_test_cost',
    name: '战损分',
    atomRef: 'cost.side_exchange_ratio',
    scoring: { type: 'larger_is_better', worst: 0, optimal: 100 },
  };
  const ind4: IndicatorDefinition = {
    indicatorId: 'ind_test_ad',
    name: '防空分',
    atomRef: 'air_defense.composite_interception_probability',
    scoring: { type: 'larger_is_better', worst: 0, optimal: 100 },
  };

  customStore.upsertCustom(ind1);
  customStore.upsertCustom(ind2);
  customStore.upsertCustom(ind3);
  customStore.upsertCustom(ind4);

  // 构建 4 层评估体系
  // L0 (Root): weighted_sum
  //   L1-1 (进攻能力): geometric_mean
  //     L2-1 (火力打击): maximin (木桶)
  //       L3-1: ind_test_strike (80分)
  //       L3-2: ind_test_kc (60分) ➔ L2-1 = min(80, 60) = 60
  //   L1-2 (防御能力): weighted_sum
  //     L2-2: ind_test_cost (90分, 0.4)
  //     L2-3: ind_test_ad (70分, 0.6) ➔ L1-2 = 0.4*90 + 0.6*70 = 78
  const testSystem: IndicatorSystem = {
    systemId: 'sys_test_multilevel_4l',
    name: '4层多策略测试体系',
    version: '1.0.0',
    targetTags: ['test'],
    kpis: [],
    root: {
      name: '综合联合作战评估',
      weight: 1.0,
      aggregation: { mode: 'visual', strategy: 'weighted_sum' },
      children: [
        {
          id: 'dim_attack',
          nodeCode: 'attack',
          name: '进攻作战能力',
          weight: 0.5,
          aggregation: { mode: 'visual', strategy: 'geometric_mean' },
          children: [
            {
              id: 'dim_firepower',
              nodeCode: 'firepower',
              name: '火力打击能力',
              weight: 1.0,
              aggregation: { mode: 'visual', strategy: 'maximin' },
              children: [
                {
                  id: 'leaf_strike',
                  nodeCode: 'strike',
                  indicatorRef: 'ind_test_strike',
                  weight: 0.5,
                },
                {
                  id: 'leaf_kc',
                  nodeCode: 'kc',
                  indicatorRef: 'ind_test_kc',
                  weight: 0.5,
                },
              ],
            },
          ],
        },
        {
          id: 'dim_defense',
          nodeCode: 'defense',
          name: '防御作战能力',
          weight: 0.5,
          aggregation: { mode: 'visual', strategy: 'weighted_sum' },
          children: [
            {
              id: 'leaf_cost',
              nodeCode: 'cost',
              indicatorRef: 'ind_test_cost',
              weight: 0.4,
            },
            {
              id: 'leaf_ad',
              nodeCode: 'ad',
              indicatorRef: 'ind_test_ad',
              weight: 0.6,
            },
          ],
        },
      ],
    },
  };

  const validation = validateIndicatorSystem(testSystem, customStore);
  assert.equal(validation.valid, true, `体系验证应该通过: ${validation.errors.join('; ')}`);

  // 模拟评估上下文
  const mockCtx: MetricAtomContext = {
    runId: 'run-test-4l',
    situation: {
      runId: 'run-test-4l',
      scenarioPath: 'mock.scen',
      startGameClock: '00:00:00',
      endGameClock: '01:00:00',
      totalGameSeconds: 3600,
      sides: ['Blue', 'Red'],
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
      coverage: {
        sourceKind: 'event_csv',
        hasPositionTracks: true,
        hasContacts: true,
        hasWeaponFired: true,
        hasWeaponEndgame: true,
        hasPointDefense: true,
        hasDamagedOrDestroyed: true,
        hasSensorStates: true,
        hasWraRules: true,
        hasPolygonsOrCorridors: true,
        hasExpenditures: true,
        hasLosses: true,
        warnings: [],
      },
    },
  };

  const mockAtoms: Record<string, MetricAtomResult> = {
    'strike.single_mission_metrics': {
      atomId: 'strike.single_mission_metrics',
      value: 80,
      displayValue: '80',
      status: 'valid',
      confidence: 'high',
      evidenceRefs: [],
    },
    'fire_control.unit_kill_chain_closure': {
      atomId: 'fire_control.unit_kill_chain_closure',
      value: 60,
      displayValue: '60',
      status: 'valid',
      confidence: 'high',
      evidenceRefs: [],
    },
    'cost.side_exchange_ratio': {
      atomId: 'cost.side_exchange_ratio',
      value: 90,
      displayValue: '90',
      status: 'valid',
      confidence: 'high',
      evidenceRefs: [],
    },
    'air_defense.composite_interception_probability': {
      atomId: 'air_defense.composite_interception_probability',
      value: 70,
      displayValue: '70',
      status: 'valid',
      confidence: 'high',
      evidenceRefs: [],
    },
  };

  const evalOutput = evaluateIndicatorSystem(testSystem, mockCtx, {
    indicatorStore: customStore,
    precomputedAtoms: mockAtoms,
  });

  // 验证 L2-1 火力打击 (maximin)
  const attackDim = evalOutput.rootTree.children[0] as any;
  assert.equal(attackDim.kind, 'dimension');
  const firepowerDim = attackDim.children[0];
  assert.equal(firepowerDim.score, 60, '火力打击能力(maximin)应取60');
  assert.equal(firepowerDim.strategyUsed, 'maximin');
  assert.equal(firepowerDim.depth, 2);

  // 验证 L1-2 防御能力 (weighted_sum): 0.4*90 + 0.6*70 = 78
  const defenseDim = evalOutput.rootTree.children[1] as any;
  assert.equal(defenseDim.score, 78, '防御作战能力应为 78 分');

  // 验证总分 (Root): 0.5 * 60 + 0.5 * 78 = 69
  assert.equal(evalOutput.overallScore, 69, '4层体系综合总分应为 69 分');
  assert.equal(evalOutput.rootTree.strategyUsed, 'weighted_sum');
  assert.equal(evalOutput.rootTree.missingPolicyUsed, 'skip_renormalize');
  } finally {
    fs.rmSync(tempCustomFile, { force: true });
  }
});

test('Stage 23.6 - validator: 公式模式子节点 nodeCode 必填校验与 root 空公式拦截', () => {
  const tempCustomFile = path.join(os.tmpdir(), `f1-val-test-${Date.now()}.json`);
  const store = new IndicatorStore(tempCustomFile);
  try {
    const sysMissingChildCode: IndicatorSystem = {
      systemId: 'sys_val_formula_test',
      name: '公式校验测试体系',
      version: '1.0.0',
      targetTags: ['test'],
      kpis: [],
      root: {
        id: 'root',
        name: '根',
        weight: 1.0,
        aggregation: { mode: 'formula', strategy: 'formula', customFormula: 'a + 1' },
        children: [
          {
            id: 'leaf_no_code',
            indicatorRef: 'ind_roe_corridor_compliance',
            weight: 1.0,
          },
        ],
      },
    };
    const res1 = validateIndicatorSystem(sysMissingChildCode, store);
    assert.equal(res1.valid, false);
    assert.ok(
      res1.errors.some((e) => e.includes('所有直接子节点必须配置 nodeCode')),
      `应拦截缺失子节点 nodeCode，实际错误: ${res1.errors.join('; ')}`,
    );

    const sysEmptyRootFormula: IndicatorSystem = {
      systemId: 'sys_val_empty_root',
      name: '空公式测试体系',
      version: '1.0.0',
      targetTags: ['test'],
      kpis: [],
      root: {
        id: 'root',
        name: '根',
        weight: 1.0,
        aggregation: { mode: 'formula', strategy: 'formula', customFormula: '' },
        children: [
          {
            id: 'leaf_with_code',
            nodeCode: 'a',
            indicatorRef: 'ind_roe_corridor_compliance',
            weight: 1.0,
          },
        ],
      },
    };
    const res2 = validateIndicatorSystem(sysEmptyRootFormula, store);
    assert.equal(res2.valid, false);
    assert.ok(
      res2.errors.some((e) => e.includes('未提供 customFormula')),
      `应拦截 root 空公式，实际错误: ${res2.errors.join('; ')}`,
    );
  } finally {
    fs.rmSync(tempCustomFile, { force: true });
  }
});
