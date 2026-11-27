import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvaluationSystemDag, MetricGraphDefinition, TableDataset } from '../src/core/types.ts';
import { defaultEffectStore } from '../src/effects/store.ts';
import { evaluateMetricGraph, type MetricOperatorInput } from '../src/indicators/metric-graph-store.ts';
import { calculateNodeAggregation } from '../src/systems/aggregation-strategies.ts';
import { evaluateSystemDag, validateSystemDag } from '../src/systems/dag-evaluator.ts';
import { generateEquivalentFormula } from '../src/systems/formula-codegen.ts';

test('Stage 23.1 (V4) - 二库多算子复合公式指标：LibFormula AST 求值与多行 reduce', async () => {
  const mg: MetricGraphDefinition = {
    graphId: 'mg_s23_composite',
    name: '打击效费复合指标图',
    graphKind: 'metric',
    nodes: [
      {
        id: 'n_strike',
        kind: 'metric',
        label: '完成比',
        position: { x: 0, y: 0 },
        metricConfig: {
          metricId: 'm_completion',
          name: '完成比',
          militaryLevel: 'MOP',
          domainTag: 'firepower',
          mode: 'from_operator',
          sourceRef: 'strike.single_mission_metrics',
          targetField: '完成比',
          reduce: 'mean',
        },
      },
      {
        id: 'n_cost',
        kind: 'metric',
        label: '分摊成本',
        position: { x: 0, y: 120 },
        metricConfig: {
          metricId: 'm_cost',
          name: '分摊成本',
          militaryLevel: 'MOP',
          domainTag: 'cost',
          mode: 'from_operator',
          sourceRef: 'cost.mission_attrition_metrics',
          targetField: '分摊成本',
          reduce: 'sum',
        },
      },
      {
        id: 'n_ratio',
        kind: 'metric',
        label: '打击任务综合效费比',
        position: { x: 300, y: 60 },
        metricConfig: {
          metricId: 'm_strike_cost_ratio',
          name: '打击任务综合效费比',
          militaryLevel: 'MOE',
          domainTag: 'cost',
          mode: 'from_metric_formula',
          formulaExpression: 'IF(cost > 0, (completion * 1000) / cost, completion)',
        },
      },
    ],
    edges: [
      { id: 'e1', sourceNodeId: 'n_strike', targetNodeId: 'n_ratio', targetAlias: 'completion' },
      { id: 'e2', sourceNodeId: 'n_cost', targetNodeId: 'n_ratio', targetAlias: 'cost' },
    ],
  };

  const mkDs = (cols: string[], rows: Record<string, unknown>[]): TableDataset => ({
    columns: cols.map((name) => ({ name, type: typeof rows[0]?.[name] === 'number' ? 'number' : 'string' })),
    rows,
    totalRows: rows.length,
  });

  const opInputs: Record<string, MetricOperatorInput> = {
    'strike.single_mission_metrics': {
      status: 'valid',
      dataset: mkDs(['任务ID', '完成比'], [
        { 任务ID: 'm1', 完成比: 0.8 },
        { 任务ID: 'm2', 完成比: 0.9 },
        { 任务ID: 'm3', 完成比: 1.0 },
      ]),
    },
    'cost.mission_attrition_metrics': {
      status: 'valid',
      dataset: mkDs(['任务ID', '分摊成本'], [
        { 任务ID: 'm1', 分摊成本: 500 },
        { 任务ID: 'm2', 分摊成本: 500 },
      ]),
    },
  };

  // completion mean = 0.9, cost sum = 1000 -> (0.9 * 1000) / 1000 = 0.9
  const res = await evaluateMetricGraph(mg, opInputs);
  const ratioInput = res.metricInputsForSystem['m_strike_cost_ratio'];
  assert.ok(ratioInput);
  assert.equal(ratioInput.status, 'valid');
  assert.equal(ratioInput.value, 0.9);
});

test('Stage 23.2 (V4) - 二库复合指标：Fail-Closed 缺失传播', async () => {
  const mg: MetricGraphDefinition = {
    graphId: 'mg_s23_failclosed',
    name: 'Fail-Closed 复合测试',
    graphKind: 'metric',
    nodes: [
      {
        id: 'n_a',
        kind: 'metric',
        label: 'A',
        position: { x: 0, y: 0 },
        metricConfig: {
          metricId: 'm_a',
          name: 'A',
          militaryLevel: 'MOP',
          domainTag: 'firepower',
          mode: 'from_operator',
          sourceRef: 'strike.damage_simulation',
        },
      },
      {
        id: 'n_b',
        kind: 'metric',
        label: 'B',
        position: { x: 0, y: 120 },
        metricConfig: {
          metricId: 'm_b',
          name: 'B',
          militaryLevel: 'MOP',
          domainTag: 'cost',
          mode: 'from_operator',
          sourceRef: 'cost.side_attrition_metrics',
        },
      },
      {
        id: 'n_sum',
        kind: 'metric',
        label: 'Sum',
        position: { x: 300, y: 60 },
        metricConfig: {
          metricId: 'm_sum',
          name: 'Sum',
          militaryLevel: 'MOE',
          domainTag: 'synergy',
          mode: 'from_metric_formula',
          formulaExpression: 'a + b',
        },
      },
    ],
    edges: [
      { id: 'ea', sourceNodeId: 'n_a', targetNodeId: 'n_sum', targetAlias: 'a' },
      { id: 'eb', sourceNodeId: 'n_b', targetNodeId: 'n_sum', targetAlias: 'b' },
    ],
  };

  const res = await evaluateMetricGraph(mg, {
    'strike.damage_simulation': { status: 'valid', value: 5 },
    'cost.side_attrition_metrics': { status: 'unavailable', missingDataReason: '缺少底表' },
  });
  assert.equal(res.metricInputsForSystem['m_sum']?.status, 'unavailable');
});

test('Stage 23.3 - 三库聚合策略纯函数：7 种策略与缺失策略行为验证', () => {
  const children = [
    { id: 'c1', nodeCode: 's1', weight: 0.6, score: 80 },
    { id: 'c2', nodeCode: 's2', weight: 0.4, score: 60 },
  ];

  assert.equal(calculateNodeAggregation('weighted_sum', 'skip_renormalize', children).score, 72);
  assert.equal(calculateNodeAggregation('maximin', 'skip_renormalize', children).score, 60);
  assert.equal(calculateNodeAggregation('max', 'skip_renormalize', children).score, 80);
  assert.equal(calculateNodeAggregation('mean', 'skip_renormalize', children).score, 70);

  const geoRes = calculateNodeAggregation('geometric_mean', 'skip_renormalize', children);
  assert.ok(geoRes.score !== null && Math.abs(geoRes.score - 71.31) < 0.2);

  const formulaRes = calculateNodeAggregation(
    'formula',
    'skip_renormalize',
    children,
    'IF(s2 < 70, s1 * 0.7, s1)',
  );
  assert.equal(formulaRes.score, 56);

  const withMissing = [
    { id: 'c1', nodeCode: 's1', weight: 0.5, score: 80 },
    { id: 'c2', nodeCode: 's2', weight: 0.5, score: null },
  ];
  assert.equal(calculateNodeAggregation('weighted_sum', 'fail', withMissing).score, null);
  assert.equal(calculateNodeAggregation('weighted_sum', 'neutral', withMissing).score, 65);
});

test('Stage 23.4 - formula-codegen: 确定性代码生成', () => {
  const children = [
    { nodeCode: 'strike_score', weight: 0.4 },
    { nodeCode: 'killchain_score', weight: 0.6 },
  ];

  assert.equal(
    generateEquivalentFormula('weighted_sum', children),
    'ROUND(0.4 * strike_score + 0.6 * killchain_score, 2)',
  );
  assert.equal(generateEquivalentFormula('maximin', children), 'MIN(strike_score, killchain_score)');
  assert.equal(
    generateEquivalentFormula('mean', children),
    'ROUND(AVG(strike_score, killchain_score), 2)',
  );
});

test('Stage 23.5 (V4) - 三库评估体系 DAG：多层多策略 (maximin + weighted_sum) 端到端实测与校验', () => {
  const dag: EvaluationSystemDag = {
    systemId: 'sys_s23_multilevel_v4',
    name: 'V4 多层多策略测试体系',
    version: '4.0.0',
    terminalEffectNodeId: 'ef_root',
    nodes: [
      { id: 'px_1', kind: 'metric_proxy', refId: 'm_1', label: 'M1', position: { x: 0, y: 0 } },
      { id: 'px_2', kind: 'metric_proxy', refId: 'm_2', label: 'M2', position: { x: 0, y: 100 } },
      { id: 'px_3', kind: 'metric_proxy', refId: 'm_3', label: 'M3', position: { x: 0, y: 200 } },
      { id: 'px_4', kind: 'metric_proxy', refId: 'm_4', label: 'M4', position: { x: 0, y: 300 } },
      {
        id: 'ef_1',
        kind: 'effect',
        label: '打击分',
        position: { x: 200, y: 0 },
        inlineEffect: {
          effectId: 'ef_1',
          name: '打击分',
          role: 'effect',
          domainTag: 'firepower',
          metricBinding: { metricId: 'm_1', scoringRule: { type: 'larger_is_better', worst: 0, optimal: 100 } },
          aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
        },
      },
      {
        id: 'ef_2',
        kind: 'effect',
        label: '杀伤链分',
        position: { x: 200, y: 100 },
        inlineEffect: {
          effectId: 'ef_2',
          name: '杀伤链分',
          role: 'effect',
          domainTag: 'synergy',
          metricBinding: { metricId: 'm_2', scoringRule: { type: 'larger_is_better', worst: 0, optimal: 100 } },
          aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
        },
      },
      {
        id: 'ef_3',
        kind: 'effect',
        label: '战损分',
        position: { x: 200, y: 200 },
        inlineEffect: {
          effectId: 'ef_3',
          name: '战损分',
          role: 'effect',
          domainTag: 'cost',
          metricBinding: { metricId: 'm_3', scoringRule: { type: 'larger_is_better', worst: 0, optimal: 100 } },
          aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
        },
      },
      {
        id: 'ef_4',
        kind: 'effect',
        label: '防空分',
        position: { x: 200, y: 300 },
        inlineEffect: {
          effectId: 'ef_4',
          name: '防空分',
          role: 'effect',
          domainTag: 'firepower',
          metricBinding: { metricId: 'm_4', scoringRule: { type: 'larger_is_better', worst: 0, optimal: 100 } },
          aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
        },
      },
      {
        id: 'ef_attack',
        kind: 'effect',
        label: '进攻能力(木桶)',
        position: { x: 450, y: 50 },
        inlineEffect: {
          effectId: 'ef_attack',
          name: '进攻能力',
          role: 'effect',
          domainTag: 'firepower',
          aggregation: { strategy: 'maximin', missingPolicy: 'skip_renormalize' },
        },
      },
      {
        id: 'ef_defense',
        kind: 'effect',
        label: '防御能力',
        position: { x: 450, y: 250 },
        inlineEffect: {
          effectId: 'ef_defense',
          name: '防御能力',
          role: 'effect',
          domainTag: 'survivability',
          aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
        },
      },
      {
        id: 'ef_root',
        kind: 'effect',
        label: '综合总评',
        position: { x: 700, y: 150 },
        inlineEffect: {
          effectId: 'ef_root',
          name: '综合总评',
          role: 'effect',
          domainTag: 'synergy',
          aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
        },
      },
    ],
    edges: [
      { id: 'e_p1', sourceNodeId: 'px_1', targetNodeId: 'ef_1' },
      { id: 'e_p2', sourceNodeId: 'px_2', targetNodeId: 'ef_2' },
      { id: 'e_p3', sourceNodeId: 'px_3', targetNodeId: 'ef_3' },
      { id: 'e_p4', sourceNodeId: 'px_4', targetNodeId: 'ef_4' },
      { id: 'e_a1', sourceNodeId: 'ef_1', targetNodeId: 'ef_attack', weight: 0.5 },
      { id: 'e_a2', sourceNodeId: 'ef_2', targetNodeId: 'ef_attack', weight: 0.5 },
      { id: 'e_d1', sourceNodeId: 'ef_3', targetNodeId: 'ef_defense', weight: 0.4 },
      { id: 'e_d2', sourceNodeId: 'ef_4', targetNodeId: 'ef_defense', weight: 0.6 },
      { id: 'e_r1', sourceNodeId: 'ef_attack', targetNodeId: 'ef_root', weight: 0.5 },
      { id: 'e_r2', sourceNodeId: 'ef_defense', targetNodeId: 'ef_root', weight: 0.5 },
    ],
  };

  const val = validateSystemDag(dag, defaultEffectStore);
  assert.equal(val.valid, true, `V4 DAG 校验应通过: ${val.errors.join('; ')}`);

  // attack = min(80, 60) = 60; defense = 0.4*90 + 0.6*70 = 78; root = 0.5*60 + 0.5*78 = 69
  const res = evaluateSystemDag(
    dag,
    {
      m_1: { status: 'valid', value: 80 },
      m_2: { status: 'valid', value: 60 },
      m_3: { status: 'valid', value: 90 },
      m_4: { status: 'valid', value: 70 },
    },
    { effectStore: defaultEffectStore },
  );
  assert.equal(res.nodeResults['ef_attack']?.score, 60);
  assert.equal(res.nodeResults['ef_defense']?.score, 78);
  assert.equal(res.overallScore, 69);
});
