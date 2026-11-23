import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type {
  EffectDefinition,
  EvaluationSystemDag,
  TableDataset,
} from '../src/core/types.ts';
import { EffectStore } from '../src/effects/store.ts';
import {
  evaluateSystemDag,
  normalizeIncomingWeights,
  validateSystemDag,
  type SystemDagEvaluationInputs,
} from '../src/systems/dag-evaluator.ts';

function makeEffect(
  id: string,
  opts: Partial<EffectDefinition> = {},
): EffectDefinition {
  return {
    effectId: id,
    name: opts.name ?? id,
    role: opts.role ?? 'effect',
    gateMode: opts.gateMode,
    domainTag: opts.domainTag ?? 'firepower',
    metricBinding: opts.metricBinding,
    aggregation: opts.aggregation ?? {
      strategy: 'weighted_sum',
      missingPolicy: 'skip_renormalize',
    },
    ...opts,
  };
}

test('1. EffectStore loads builtin presets covering all domains/gates, protects builtins, and manages custom effects', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-effect-store-'));
  const customFile = path.join(tmpDir, 'custom-effects.json');

  try {
    const store = new EffectStore(customFile);
    const all = store.listAll();
    assert.ok(all.length >= 9, `内置效果数应 >= 9，实际=${all.length}`);

    // 验证覆盖所有 6 大军事域与硬/软两种门控
    const domains = new Set(all.map((e) => e.domainTag).filter(Boolean));
    for (const d of ['firepower', 'isr', 'survivability', 'c2', 'synergy', 'cost']) {
      assert.equal(domains.has(d as any), true, `内置效果库应覆盖域 ${d}`);
    }

    const hardGate = store.get('gate_fratricide_zero');
    const softGate = store.get('gate_roe_corridor');
    assert.equal(hardGate?.role, 'gate');
    assert.equal(hardGate?.gateMode, 'hard');
    assert.equal(softGate?.role, 'gate');
    assert.equal(softGate?.gateMode, 'soft');
    assert.equal(store.get('eff_strike_mission')?.isBuiltin, true);

    // 内置效果受保护，禁止删除
    assert.throws(() => store.deleteCustom('eff_strike_mission'), /不允许删除内置预置效果节点/);
    assert.throws(() => store.deleteCustom('gate_fratricide_zero'), /不允许删除内置预置效果节点/);

    // 校验非法效果定义拦截
    const badScoring = store.validateEffect(
      makeEffect('bad_eff_1', {
        metricBinding: {
          metricId: 'm1',
          scoringRule: { type: 'linear', bounds: [10, 10] },
        },
      }),
    );
    assert.equal(badScoring.valid, false);

    const badCr = store.validateEffect(
      makeEffect('bad_eff_cr', {
        aggregation: {
          strategy: 'weighted_sum',
          missingPolicy: 'skip_renormalize',
          ahpCr: 0.15,
        },
      }),
    );
    assert.equal(badCr.valid, false);
    assert.ok(badCr.errors.some((e) => e.includes('0.10')));

    // 自定义效果保存、持久化重载与删除
    const customDef = makeEffect('eff_custom_bvr_salvo', {
      name: '超视距齐射压制效果',
      domainTag: 'firepower',
      metricBinding: {
        metricId: 'weapon.bvr_salvo_hit_rate',
        paramOverrides: { maxSalvoSize: 2, minRangeNm: 25 },
        scoringRule: { type: 'larger_is_better', worst: 0.2, optimal: 0.9 },
      },
    });
    const saved = store.upsertCustom(customDef);
    assert.equal(saved.isBuiltin, false);
    assert.equal(store.get('eff_custom_bvr_salvo')?.name, '超视距齐射压制效果');

    const reloadedStore = new EffectStore(customFile);
    assert.equal(reloadedStore.get('eff_custom_bvr_salvo')?.name, '超视距齐射压制效果');
    assert.equal(reloadedStore.get('eff_custom_bvr_salvo')?.isBuiltin, false);

    assert.equal(reloadedStore.deleteCustom('eff_custom_bvr_salvo'), true);
    assert.equal(reloadedStore.get('eff_custom_bvr_salvo'), undefined);
    assert.equal(reloadedStore.deleteCustom('eff_non_existent'), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('2. Unlimited-depth 5-layer DAG + diamond metric & sub-effect reuse evaluates accurately', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-dag-depth-'));
  const store = new EffectStore(path.join(tmpDir, 'custom.json'));

  try {
    // 5 层深度 DAG：
    // Layer 0 (metric_proxy): m_strike, m_patrol, m_isr(菱形共享给两个不同评分规则的效果), m_kc, m_cost
    // Layer 1 (tactical effects): eff_strike, eff_patrol, eff_isr_wide, eff_isr_strict, eff_kc, eff_cost
    // Layer 2 (operational): eff_air_sup (复合制空), eff_info_kc (复合信息杀伤链)
    // Layer 3 (theater): eff_joint_combat (战区协同)
    // Layer 4 (terminal): eff_campaign_overall (终态战役效能)
    const dag: EvaluationSystemDag = {
      systemId: 'sys_5layer_diamond_v1',
      name: '五层联合作战与菱形复用评估体系',
      version: '4.0.0',
      terminalEffectNodeId: 'eff_campaign_overall',
      nodes: [
        { id: 'm_strike', kind: 'metric_proxy', label: '突击完成比', refId: 'strike.composite_mission_metrics', position: { x: 0, y: 0 } },
        { id: 'm_patrol', kind: 'metric_proxy', label: '巡逻覆盖比', refId: 'patrol.composite_mission_metrics', position: { x: 0, y: 80 } },
        { id: 'm_isr', kind: 'metric_proxy', label: '目标发现率', refId: 'isr.detection_rate', position: { x: 0, y: 160 } },
        { id: 'm_kc', kind: 'metric_proxy', label: '杀伤链闭环时延', refId: 'fire_control.unit_kill_chain_closure', position: { x: 0, y: 240 } },
        { id: 'm_cost', kind: 'metric_proxy', label: '战损交换比', refId: 'cost.side_exchange_ratio', position: { x: 0, y: 320 } },

        // Layer 1
        { id: 'eff_strike', kind: 'effect', label: '突击任务效果', refId: 'eff_strike_mission', position: { x: 200, y: 0 } },
        { id: 'eff_patrol', kind: 'effect', label: '空中巡逻效果', refId: 'eff_patrol_coverage', position: { x: 200, y: 80 } },
        {
          id: 'eff_isr_wide',
          kind: 'effect',
          label: '广域态势感知(宽松)',
          position: { x: 200, y: 140 },
          inlineEffect: makeEffect('eff_isr_wide_def', {
            domainTag: 'isr',
            metricBinding: {
              metricId: 'isr.detection_rate',
              scoringRule: { type: 'larger_is_better', worst: 0.2, optimal: 0.8 },
            },
          }),
        },
        {
          id: 'eff_isr_strict',
          kind: 'effect',
          label: '精准瞄准感知(严格)',
          position: { x: 200, y: 200 },
          inlineEffect: makeEffect('eff_isr_strict_def', {
            domainTag: 'isr',
            metricBinding: {
              metricId: 'isr.detection_rate',
              scoringRule: { type: 'larger_is_better', worst: 0.7, optimal: 0.98 },
            },
          }),
        },
        { id: 'eff_kc', kind: 'effect', label: '杀伤链闭环效果', refId: 'eff_kill_chain_synergy', position: { x: 200, y: 260 } },
        { id: 'eff_cost', kind: 'effect', label: '效费交换效果', refId: 'eff_cost_exchange', position: { x: 200, y: 320 } },

        // Layer 2 (其中 eff_patrol 也作为菱形共享子效果同时支撑 eff_air_sup 与 eff_info_kc!)
        { id: 'eff_air_sup', kind: 'effect', label: '制空突击复合效果', refId: 'eff_air_superiority', position: { x: 420, y: 60 } },
        {
          id: 'eff_info_kc',
          kind: 'effect',
          label: '信息杀伤链协同效果',
          position: { x: 420, y: 220 },
          inlineEffect: makeEffect('eff_info_kc_def', {
            domainTag: 'synergy',
            aggregation: { strategy: 'geometric_mean', missingPolicy: 'skip_renormalize' },
          }),
        },

        // Layer 3
        {
          id: 'eff_joint_combat',
          kind: 'effect',
          label: '战区联合作战效果',
          position: { x: 640, y: 140 },
          inlineEffect: makeEffect('eff_joint_combat_def', {
            domainTag: 'synergy',
            aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
          }),
        },

        // Layer 4
        {
          id: 'eff_campaign_overall',
          kind: 'effect',
          label: '战役综合效能终态',
          position: { x: 860, y: 200 },
          inlineEffect: makeEffect('eff_campaign_def', {
            domainTag: 'synergy',
            aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
          }),
        },
      ],
      edges: [
        // Layer 0 -> Layer 1
        { id: 'e_ms', sourceNodeId: 'm_strike', targetNodeId: 'eff_strike', weight: 1 },
        { id: 'e_mp', sourceNodeId: 'm_patrol', targetNodeId: 'eff_patrol', weight: 1 },
        // m_isr 菱形分支
        { id: 'e_mi_1', sourceNodeId: 'm_isr', targetNodeId: 'eff_isr_wide', weight: 1 },
        { id: 'e_mi_2', sourceNodeId: 'm_isr', targetNodeId: 'eff_isr_strict', weight: 1 },
        { id: 'e_mk', sourceNodeId: 'm_kc', targetNodeId: 'eff_kc', weight: 1 },
        { id: 'e_mc', sourceNodeId: 'm_cost', targetNodeId: 'eff_cost', weight: 1 },

        // Layer 1 -> Layer 2 (eff_patrol 同时接入 eff_air_sup 和 eff_info_kc)
        { id: 'e_l2_1', sourceNodeId: 'eff_strike', targetNodeId: 'eff_air_sup', weight: 0.5 },
        { id: 'e_l2_2', sourceNodeId: 'eff_patrol', targetNodeId: 'eff_air_sup', weight: 0.3 },
        { id: 'e_l2_3', sourceNodeId: 'eff_isr_wide', targetNodeId: 'eff_air_sup', weight: 0.2 },

        { id: 'e_l2_4', sourceNodeId: 'eff_isr_strict', targetNodeId: 'eff_info_kc', weight: 0.4 },
        { id: 'e_l2_5', sourceNodeId: 'eff_kc', targetNodeId: 'eff_info_kc', weight: 0.4 },
        { id: 'e_l2_6', sourceNodeId: 'eff_patrol', targetNodeId: 'eff_info_kc', weight: 0.2 },

        // Layer 2 -> Layer 3
        { id: 'e_l3_1', sourceNodeId: 'eff_air_sup', targetNodeId: 'eff_joint_combat', weight: 0.6 },
        { id: 'e_l3_2', sourceNodeId: 'eff_info_kc', targetNodeId: 'eff_joint_combat', weight: 0.4 },

        // Layer 3 & Layer 1 -> Layer 4 (跨层连线)
        { id: 'e_l4_1', sourceNodeId: 'eff_joint_combat', targetNodeId: 'eff_campaign_overall', weight: 0.8 },
        { id: 'e_l4_2', sourceNodeId: 'eff_cost', targetNodeId: 'eff_campaign_overall', weight: 0.2 },
      ],
    };

    const validation = validateSystemDag(dag, store);
    assert.equal(validation.valid, true, `校验失败: ${validation.errors.join('; ')}`);
    assert.equal(validation.hasCycle, false);

    // 精确输入值：
    // m_strike = 0.95 -> 100
    // m_patrol = 0.95 -> 100
    // m_isr = 0.80 -> eff_isr_wide = 100, eff_isr_strict = ((0.8-0.7)/(0.98-0.7))*100 = 35.71
    // m_kc = 30 -> 100
    // m_cost = 3.0 -> 100
    const inputs: SystemDagEvaluationInputs = {
      'strike.composite_mission_metrics': { status: 'valid', value: 0.95 },
      'patrol.composite_mission_metrics': { status: 'valid', value: 0.95 },
      'isr.detection_rate': { status: 'valid', value: 0.80 },
      'fire_control.unit_kill_chain_closure': { status: 'valid', value: 30 },
      'cost.side_exchange_ratio': { status: 'valid', value: 3.0 },
    };

    const out = evaluateSystemDag(dag, inputs, { effectStore: store, runId: 'run-5layer' });
    assert.equal(out.gateVerdict, 'PASS');
    assert.equal(out.nodeResults.eff_campaign_overall.depth, 4);
    assert.equal(out.nodeResults.eff_joint_combat.depth, 3);
    assert.equal(out.nodeResults.eff_air_sup.depth, 2);

    // 菱形同一指标产生不同效用分
    assert.equal(out.nodeResults.eff_isr_wide.score, 100);
    assert.equal(out.nodeResults.eff_isr_strict.score, 35.71);

    // eff_air_sup = 0.5*100 + 0.3*100 + 0.2*100 = 100
    assert.equal(out.nodeResults.eff_air_sup.score, 100);
    // eff_info_kc = 100 * (0.3571^0.4 * 1^0.4 * 1^0.2) ≈ 66.22
    const expectedGeo = Math.round(100 * Math.pow(0.3571, 0.4) * 100) / 100;
    assert.equal(out.nodeResults.eff_info_kc.score, expectedGeo);

    const expectedJoint = Math.round((0.6 * 100 + 0.4 * expectedGeo) * 100) / 100;
    assert.equal(out.nodeResults.eff_joint_combat.score, expectedJoint);

    const expectedOverall = Math.round((0.8 * expectedJoint + 0.2 * 100) * 100) / 100;
    assert.equal(out.rawOverallScore, expectedOverall);
    assert.equal(out.overallScore, expectedOverall);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('3. Local incoming-edge weight validation, normalizeIncomingWeights, formula strategy, and Kahn cycle rejection', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-dag-val-'));
  const store = new EffectStore(path.join(tmpDir, 'custom.json'));

  try {
    // 3a. 局部入边权重不等于 1.0 报错
    const unbalancedDag: EvaluationSystemDag = {
      systemId: 'sys_unbalanced',
      name: '权重未归一体系',
      version: '1.0.0',
      terminalEffectNodeId: 'eff_top',
      nodes: [
        { id: 'eff_a', kind: 'effect', label: '子效果A', refId: 'eff_strike_mission', position: { x: 0, y: 0 } },
        { id: 'eff_b', kind: 'effect', label: '子效果B', refId: 'eff_patrol_coverage', position: { x: 0, y: 100 } },
        { id: 'eff_top', kind: 'effect', label: '顶层效果', refId: 'eff_air_superiority', position: { x: 200, y: 50 } },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'eff_a', targetNodeId: 'eff_top', weight: 0.6 },
        { id: 'e2', sourceNodeId: 'eff_b', targetNodeId: 'eff_top', weight: 0.6 },
      ],
    };

    const resUnbalanced = validateSystemDag(unbalancedDag, store);
    assert.equal(resUnbalanced.valid, false);
    assert.ok(resUnbalanced.errors.some((e) => e.includes('eff_top') && e.includes('1.2000')));

    // 使用 normalizeIncomingWeights 修复后应通过校验
    const normalizedDag = normalizeIncomingWeights(unbalancedDag, store);
    const resNormalized = validateSystemDag(normalizedDag, store);
    assert.equal(resNormalized.valid, true, resNormalized.errors.join('; '));
    assert.equal(normalizedDag.edges[0].weight, 0.5);
    assert.equal(normalizedDag.edges[1].weight, 0.5);

    // 3b. 纯 formula 聚合策略不强制入边权重之和为 1.0
    const formulaDag: EvaluationSystemDag = {
      systemId: 'sys_formula_dag',
      name: '公式合成体系',
      version: '1.0.0',
      terminalEffectNodeId: 'eff_formula_top',
      nodes: [
        { id: 'eff_a', kind: 'effect', label: '突击', refId: 'eff_strike_mission', position: { x: 0, y: 0 } },
        { id: 'eff_b', kind: 'effect', label: '巡逻', refId: 'eff_patrol_coverage', position: { x: 0, y: 100 } },
        {
          id: 'eff_formula_top',
          kind: 'effect',
          label: '条件合成',
          position: { x: 200, y: 50 },
          inlineEffect: makeEffect('eff_formula_top_def', {
            aggregation: {
              strategy: 'formula',
              missingPolicy: 'skip_renormalize',
              customFormula: 'IF(b < 50, a * 0.6, 0.7 * a + 0.3 * b)',
            },
          }),
        },
      ],
      edges: [
        { id: 'ef1', sourceNodeId: 'eff_a', targetNodeId: 'eff_formula_top', targetAlias: 'a' },
        { id: 'ef2', sourceNodeId: 'eff_b', targetNodeId: 'eff_formula_top', targetAlias: 'b' },
      ],
    };
    const resFormula = validateSystemDag(formulaDag, store);
    assert.equal(resFormula.valid, true, resFormula.errors.join('; '));
    const formulaOut = evaluateSystemDag(
      formulaDag,
      {
        'strike.composite_mission_metrics': { status: 'valid', value: 0.95 }, // score=100
        'patrol.composite_mission_metrics': { status: 'valid', value: 0.4 }, // score=0
      },
      { effectStore: store },
    );
    assert.equal(formulaOut.overallScore, 60);

    // 3c. Kahn 判环：3 节点环 + 自环 + 悬空边 + 缺失终态节点
    const cyclicDag: EvaluationSystemDag = {
      systemId: 'sys_cyclic',
      name: '含环体系',
      version: '1.0.0',
      terminalEffectNodeId: 'n3',
      nodes: [
        { id: 'n1', kind: 'effect', label: 'N1', refId: 'eff_air_superiority', position: { x: 0, y: 0 } },
        { id: 'n2', kind: 'effect', label: 'N2', refId: 'eff_air_superiority', position: { x: 100, y: 0 } },
        { id: 'n3', kind: 'effect', label: 'N3', refId: 'eff_air_superiority', position: { x: 200, y: 0 } },
      ],
      edges: [
        { id: 'c1', sourceNodeId: 'n1', targetNodeId: 'n2', weight: 1 },
        { id: 'c2', sourceNodeId: 'n2', targetNodeId: 'n3', weight: 1 },
        { id: 'c3', sourceNodeId: 'n3', targetNodeId: 'n1', weight: 1 },
      ],
    };

    const resCycle = validateSystemDag(cyclicDag, store);
    assert.equal(resCycle.valid, false);
    assert.equal(resCycle.hasCycle, true);
    assert.equal(resCycle.cycleNodeIds.length, 3);
    assert.throws(() => evaluateSystemDag(cyclicDag, {}, { effectStore: store }), /环路/);

    // 自环与不存在的 terminalEffectNodeId
    const badTerminalDag: EvaluationSystemDag = {
      systemId: 'sys_bad_term',
      name: '错误终态',
      version: '1.0.0',
      terminalEffectNodeId: 'missing_node',
      nodes: [
        { id: 'n1', kind: 'effect', label: 'N1', refId: 'eff_air_superiority', position: { x: 0, y: 0 } },
      ],
      edges: [{ id: 'self', sourceNodeId: 'n1', targetNodeId: 'n1', weight: 1 }],
    };
    const resBadTerm = validateSystemDag(badTerminalDag, store);
    assert.equal(resBadTerm.valid, false);
    assert.equal(resBadTerm.hasCycle, true);
    assert.ok(resBadTerm.errors.some((e) => e.includes('missing_node')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('4. TableDataset slicing (sliceFilter, targetField, reduce), paramOverrides collection, and skip_renormalize on unavailable node', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-dag-slice-'));
  const store = new EffectStore(path.join(tmpDir, 'custom.json'));

  try {
    const missionDataset: TableDataset = {
      id: 'ds_mission_perf',
      columns: [
        { name: 'MissionID', type: 'string' },
        { name: 'Side', type: 'string' },
        { name: 'CompletionRate', type: 'number' },
        { name: 'Losses', type: 'number' },
      ],
      dimensionKeys: ['MissionID', 'Side'],
      measureKeys: ['CompletionRate', 'Losses'],
      rows: [
        { MissionID: 'M1', Side: '红方', CompletionRate: 0.8, Losses: 0 },
        { MissionID: 'M2', Side: '红方', CompletionRate: 1.0, Losses: 1 },
        { MissionID: 'M3', Side: '蓝方', CompletionRate: 0.4, Losses: 3 },
        { MissionID: 'M4', Side: '蓝方', CompletionRate: 0.6, Losses: 2 },
      ],
    };

    const dag: EvaluationSystemDag = {
      systemId: 'sys_slice_renorm',
      name: '切片透传与缺数重归一测试体系',
      version: '1.0.0',
      terminalEffectNodeId: 'eff_top',
      globalParams: { targetSide: '红方' },
      nodes: [
        { id: 'm_table', kind: 'metric_proxy', label: '任务多维指标表', refId: 'metric.mission_table', position: { x: 0, y: 0 } },
        { id: 'm_missing', kind: 'metric_proxy', label: '缺失的雷达指标', refId: 'metric.missing_radar', position: { x: 0, y: 200 } },
        {
          id: 'eff_red_completion',
          kind: 'effect',
          label: '红方任务完成度',
          position: { x: 220, y: 0 },
          inlineEffect: makeEffect('eff_red_comp_def', {
            domainTag: 'firepower',
            metricBinding: {
              metricId: 'metric.mission_table',
              sliceFilter: { Side: '红方' },
              targetField: 'CompletionRate',
              reduce: 'mean',
              paramOverrides: { damageThreshold: 0.5 },
              scoringRule: { type: 'linear', bounds: [0, 1] },
            },
          }),
        },
        {
          id: 'eff_blue_suppression',
          kind: 'effect',
          label: '蓝方任务压制(取均值越低越好)',
          position: { x: 220, y: 100 },
          inlineEffect: makeEffect('eff_blue_sup_def', {
            domainTag: 'firepower',
            metricBinding: {
              metricId: 'metric.mission_table',
              sliceFilter: { Side: '蓝方' },
              targetField: 'CompletionRate',
              reduce: 'mean',
              paramOverrides: { minOnStationSec: 1800 },
              scoringRule: { type: 'smaller_is_better', optimal: 0, worst: 1 },
            },
          }),
        },
        {
          id: 'eff_missing_radar',
          kind: 'effect',
          label: '雷达覆盖效果(缺数)',
          position: { x: 220, y: 200 },
          inlineEffect: makeEffect('eff_missing_def', {
            domainTag: 'isr',
            metricBinding: {
              metricId: 'metric.missing_radar',
              scoringRule: { type: 'linear', bounds: [0, 1] },
            },
          }),
        },
        {
          id: 'eff_top',
          kind: 'effect',
          label: '体系合成输出',
          position: { x: 460, y: 100 },
          inlineEffect: makeEffect('eff_top_def', {
            aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
          }),
        },
      ],
      edges: [
        { id: 'e_r', sourceNodeId: 'm_table', targetNodeId: 'eff_red_completion', weight: 1 },
        { id: 'e_b', sourceNodeId: 'm_table', targetNodeId: 'eff_blue_suppression', weight: 1 },
        { id: 'e_m', sourceNodeId: 'm_missing', targetNodeId: 'eff_missing_radar', weight: 1 },
        { id: 'e_t1', sourceNodeId: 'eff_red_completion', targetNodeId: 'eff_top', weight: 0.5 },
        { id: 'e_t2', sourceNodeId: 'eff_blue_suppression', targetNodeId: 'eff_top', weight: 0.3 },
        { id: 'e_t3', sourceNodeId: 'eff_missing_radar', targetNodeId: 'eff_top', weight: 0.2 },
      ],
    };

    const collectedOverrides: Array<{ metricId: string; overrides: Record<string, unknown> }> = [];
    const inputs: SystemDagEvaluationInputs = {
      'metric.mission_table': {
        status: 'valid',
        dataset: missionDataset,
        evidenceRefs: [
          { source: 'csv', ref: 'MissionSummary.csv', scenarioClock: '00:45:00', description: '任务汇总表' },
        ],
      },
      'metric.missing_radar': {
        status: 'unavailable',
        missingDataReason: '当前推演未导出 RadarCoverage.csv',
      },
    };

    const out = evaluateSystemDag(dag, inputs, {
      effectStore: store,
      runId: 'run-slice-test',
      paramOverrideCollector: (metricId, overrides) => {
        collectedOverrides.push({ metricId, overrides });
      },
    });

    // 校验参数透传收集（metric.mission_table 被两个效果节点各自透传，且 metric.missing_radar 收到 globalParams）
    const missionOverrides = collectedOverrides.filter(
      (c) => c.metricId === 'metric.mission_table',
    );
    assert.equal(missionOverrides.length, 2);
    assert.equal(collectedOverrides.length, 3);
    assert.equal(out.resolvedParamOverrides['metric.mission_table'].damageThreshold, 0.5);
    assert.equal(out.resolvedParamOverrides['metric.mission_table'].minOnStationSec, 1800);
    assert.equal(out.resolvedParamOverrides['metric.mission_table'].targetSide, '红方');
    assert.equal(out.resolvedParamOverrides['metric.missing_radar'].targetSide, '红方');

    // 红方 CompletionRate mean = (0.8 + 1.0)/2 = 0.9 -> score = 90
    assert.equal(out.nodeResults.eff_red_completion.rawValue, 0.9);
    assert.equal(out.nodeResults.eff_red_completion.score, 90);

    // 蓝方 CompletionRate mean = (0.4 + 0.6)/2 = 0.5 -> smaller_is_better(0,1) => 50
    assert.equal(out.nodeResults.eff_blue_suppression.rawValue, 0.5);
    assert.equal(out.nodeResults.eff_blue_suppression.score, 50);

    // 缺失分支严格 Fail-Closed
    assert.equal(out.nodeResults.eff_missing_radar.status, 'unavailable');
    assert.equal(out.nodeResults.eff_missing_radar.score, null);
    assert.ok(out.nodeResults.eff_missing_radar.missingDataReason?.includes('RadarCoverage.csv'));

    // skip_renormalize 重归一: 有效权重 = 0.5 + 0.3 = 0.8 -> (90*0.5 + 50*0.3) / 0.8 = 60 / 0.8 = 75
    assert.equal(out.availableWeightRatio, 0.8);
    assert.equal(out.nodeResults.eff_top.status, 'degraded');
    assert.equal(out.nodeResults.eff_top.effectiveWeights.e_t1, 0.625);
    assert.equal(out.nodeResults.eff_top.effectiveWeights.e_t2, 0.375);
    assert.equal(out.nodeResults.eff_top.effectiveWeights.e_t3, 0);
    assert.equal(out.overallScore, 75);

    // 若策略为 fail，任一子节点缺失则整体 Fail-Closed 返回 null
    const failDag = structuredClone(dag);
    const topNode = failDag.nodes.find((n) => n.id === 'eff_top')!;
    topNode.inlineEffect!.aggregation.missingPolicy = 'fail';
    const failOut = evaluateSystemDag(failDag, inputs, { effectStore: store });
    assert.equal(failOut.overallScore, null);
    assert.equal(failOut.nodeResults.eff_top.status, 'unavailable');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('5. Hard GATE violation caps overallScore <= 39 while preserving rawOverallScore; Soft GATE triggers WARNING without capping', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-dag-gate-'));
  const store = new EffectStore(path.join(tmpDir, 'custom.json'));

  try {
    const dag: EvaluationSystemDag = {
      systemId: 'sys_dual_gate_v1',
      name: '双轨安全红线门控测试体系',
      version: '1.0.0',
      terminalEffectNodeId: 'eff_mission_overall',
      nodes: [
        { id: 'm_strike', kind: 'metric_proxy', label: '突击完成比', refId: 'strike.composite_mission_metrics', position: { x: 0, y: 0 } },
        { id: 'm_cost', kind: 'metric_proxy', label: '交换比', refId: 'cost.side_exchange_ratio', position: { x: 0, y: 80 } },
        { id: 'm_frat', kind: 'metric_proxy', label: '友军误伤次数', refId: 'roe.fratricide_count', position: { x: 0, y: 160 } },
        { id: 'm_corridor', kind: 'metric_proxy', label: '走廊遵从率', refId: 'roe.corridor_spatial_compliance', position: { x: 0, y: 240 } },

        { id: 'eff_strike', kind: 'effect', label: '突击效果', refId: 'eff_strike_mission', position: { x: 200, y: 0 } },
        { id: 'eff_cost', kind: 'effect', label: '效费效果', refId: 'eff_cost_exchange', position: { x: 200, y: 80 } },
        { id: 'gate_hard', kind: 'gate', label: '误伤红线硬门控', refId: 'gate_fratricide_zero', position: { x: 200, y: 160 } },
        { id: 'gate_soft', kind: 'gate', label: '航路走廊软门控', refId: 'gate_roe_corridor', position: { x: 200, y: 240 } },

        {
          id: 'eff_mission_overall',
          kind: 'effect',
          label: '作战综合效能',
          refId: 'eff_air_superiority',
          position: { x: 420, y: 40 },
        },
      ],
      edges: [
        { id: 'eg1', sourceNodeId: 'm_strike', targetNodeId: 'eff_strike', weight: 1 },
        { id: 'eg2', sourceNodeId: 'm_cost', targetNodeId: 'eff_cost', weight: 1 },
        { id: 'eg3', sourceNodeId: 'm_frat', targetNodeId: 'gate_hard', weight: 1 },
        { id: 'eg4', sourceNodeId: 'm_corridor', targetNodeId: 'gate_soft', weight: 1 },
        { id: 'eg5', sourceNodeId: 'eff_strike', targetNodeId: 'eff_mission_overall', weight: 0.7 },
        { id: 'eg6', sourceNodeId: 'eff_cost', targetNodeId: 'eff_mission_overall', weight: 0.3 },
      ],
    };

    assert.equal(validateSystemDag(dag, store).valid, true);

    // 5a. 双门控全通：PASS，不封顶
    const passOut = evaluateSystemDag(
      dag,
      {
        'strike.composite_mission_metrics': { status: 'valid', value: 0.95 }, // 100
        'cost.side_exchange_ratio': { status: 'valid', value: 3.0 }, // 100
        'roe.fratricide_count': { status: 'valid', value: 0 },
        'roe.corridor_spatial_compliance': { status: 'valid', value: 0.96 },
      },
      { effectStore: store },
    );
    assert.equal(passOut.gateVerdict, 'PASS');
    assert.equal(passOut.rawOverallScore, 100);
    assert.equal(passOut.overallScore, 100);
    assert.equal(passOut.gateAudit.length, 2);
    assert.equal(passOut.gateAudit.every((g) => g.gateStatus === 'pass'), true);

    // 5b. 仅触发软告警 (< 0.85)：WARNING，不封顶
    const warnOut = evaluateSystemDag(
      dag,
      {
        'strike.composite_mission_metrics': { status: 'valid', value: 0.95 }, // 100
        'cost.side_exchange_ratio': { status: 'valid', value: 3.0 }, // 100
        'roe.fratricide_count': { status: 'valid', value: 0 },
        'roe.corridor_spatial_compliance': { status: 'valid', value: 0.72 },
      },
      { effectStore: store },
    );
    assert.equal(warnOut.gateVerdict, 'WARNING');
    assert.equal(warnOut.rawOverallScore, 100);
    assert.equal(warnOut.overallScore, 100, 'Soft Gate 告警不应封顶总分');
    const softAudit = warnOut.gateAudit.find((g) => g.atomId === 'gate_roe_corridor');
    assert.equal(softAudit?.gateStatus, 'violated');
    assert.equal(softAudit?.gateMode, 'soft');

    // 5c. 触发硬红线 (fratricide = 1 > 0)：DISQUALIFIED，总分封顶 <= 39，保留 rawOverallScore
    const disqOut = evaluateSystemDag(
      dag,
      {
        'strike.composite_mission_metrics': { status: 'valid', value: 0.95 }, // 100
        'cost.side_exchange_ratio': { status: 'valid', value: 3.0 }, // 100
        'roe.fratricide_count': { status: 'valid', value: 1 },
        'roe.corridor_spatial_compliance': { status: 'valid', value: 0.96 },
      },
      { effectStore: store },
    );
    assert.equal(disqOut.gateVerdict, 'DISQUALIFIED');
    assert.equal(disqOut.rawOverallScore, 100);
    assert.equal(disqOut.overallScore, 39, 'Hard Gate 违例必须将生效总分封顶 <= 39');
    const hardAudit = disqOut.gateAudit.find((g) => g.atomId === 'gate_fratricide_zero');
    assert.equal(hardAudit?.gateStatus, 'violated');
    assert.equal(hardAudit?.gateMode, 'hard');

    // 5d. 若原始分本就低于 39（例如 20），硬红线不抬高分数，取 min(raw, 39) = 20
    const lowDisqOut = evaluateSystemDag(
      dag,
      {
        'strike.composite_mission_metrics': { status: 'valid', value: 0.3 }, // 0
        'cost.side_exchange_ratio': { status: 'valid', value: 2.0 }, // ((2-0.5)/(3-0.5))*100 = 60 => 0.3*60 = 18
        'roe.fratricide_count': { status: 'valid', value: 2 },
        'roe.corridor_spatial_compliance': { status: 'valid', value: 0.96 },
      },
      { effectStore: store },
    );
    assert.equal(lowDisqOut.gateVerdict, 'DISQUALIFIED');
    assert.equal(lowDisqOut.rawOverallScore, 18);
    assert.equal(lowDisqOut.overallScore, 18);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('6. Multi-metric direct-to-effect aggregation and unmatched sliceFilter Fail-Closed behavior', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-dag-multi-metric-'));
  const store = new EffectStore(path.join(tmpDir, 'custom.json'));

  try {
    const dag: EvaluationSystemDag = {
      systemId: 'sys_multi_metric_direct',
      name: '多指标直连复合效果测试',
      version: '1.0.0',
      terminalEffectNodeId: 'eff_combined',
      nodes: [
        {
          id: 'm1',
          kind: 'metric_proxy',
          label: '指标1',
          refId: 'm.alpha',
          position: { x: 0, y: 0 },
          params: {
            scoringRule: { type: 'linear', bounds: [0, 1] },
          },
        },
        {
          id: 'm2',
          kind: 'metric_proxy',
          label: '指标2',
          refId: 'm.beta',
          position: { x: 0, y: 100 },
          params: {
            scoringRule: { type: 'smaller_is_better', optimal: 0, worst: 100 },
          },
        },
        {
          id: 'eff_combined',
          kind: 'effect',
          label: '双指标直连复合效果',
          position: { x: 240, y: 50 },
          inlineEffect: makeEffect('eff_combined_def', {
            aggregation: { strategy: 'weighted_sum', missingPolicy: 'fail' },
          }),
        },
      ],
      edges: [
        { id: 'em1', sourceNodeId: 'm1', targetNodeId: 'eff_combined', weight: 0.6 },
        { id: 'em2', sourceNodeId: 'm2', targetNodeId: 'eff_combined', weight: 0.4 },
      ],
    };

    assert.equal(validateSystemDag(dag, store).valid, true);
    const out = evaluateSystemDag(
      dag,
      {
        'm.alpha': { status: 'valid', value: 0.8 }, // 80
        'm.beta': { status: 'valid', value: 25 }, // 75
      },
      { effectStore: store },
    );
    // 0.6*80 + 0.4*75 = 48 + 30 = 78
    assert.equal(out.overallScore, 78);

    // 未命中任何切片行时严格 Fail-Closed 返回 unavailable
    const sliceMissDag: EvaluationSystemDag = {
      systemId: 'sys_slice_miss',
      name: '切片未命中测试',
      version: '1.0.0',
      terminalEffectNodeId: 'eff_slice',
      nodes: [
        {
          id: 'eff_slice',
          kind: 'effect',
          label: '空切片效果',
          position: { x: 100, y: 0 },
          inlineEffect: makeEffect('eff_slice_def', {
            metricBinding: {
              metricId: 'm.ds',
              sliceFilter: { Side: '绿方' },
              targetField: 'Rate',
              reduce: 'mean',
              scoringRule: { type: 'linear', bounds: [0, 1] },
            },
          }),
        },
      ],
      edges: [],
    };
    const missOut = evaluateSystemDag(
      sliceMissDag,
      {
        'm.ds': {
          status: 'valid',
          dataset: {
            columns: [
              { name: 'Side', type: 'string' },
              { name: 'Rate', type: 'number' },
            ],
            rows: [{ Side: '红方', Rate: 0.9 }],
          },
        },
      },
      { effectStore: store },
    );
    assert.equal(missOut.nodeResults.eff_slice.status, 'unavailable');
    assert.equal(missOut.overallScore, null);
    assert.ok(missOut.nodeResults.eff_slice.missingDataReason?.includes('未命中'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
