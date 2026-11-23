import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TableDataset } from '../src/core/types.ts';
import { defaultEffectStore } from '../src/effects/store.ts';
import {
  ALL_V4_OPERATOR_SCRIPTS,
  V4_BUILTIN_COMPONENTS,
  V4_FACT_OPERATORS,
  getV4OperatorSpec,
  listV4OperatorSummaries,
} from '../src/operators/v4/index.ts';
import {
  defaultMetricGraphStore,
  evaluateMetricGraph,
  validateMetricGraph,
  type MetricOperatorInput,
} from '../src/indicators/metric-graph-store.ts';
import { defaultSystemDagStore } from '../src/systems/system-dag-store.ts';
import {
  evaluateSystemDag,
  validateSystemDag,
  type SystemDagEvaluationInputs,
} from '../src/systems/dag-evaluator.ts';

describe('Wave 3 Milestone Acceptance: Full 8-Chapter Plan A Three-Library Integration Test', () => {
  // ──────────────────── 测试 1: Plan A 三库架构与结构零漂移校验 ────────────────────
  it('1. mg_v4_metrics_guide_full strictly follows Plan A (L0 fact-only + exact outputColumns -> L1 agg -> L2 formula)', () => {
    const allGraphs = defaultMetricGraphStore.listAll();
    assert.strictEqual(
      allGraphs[0]?.graphId,
      'mg_v4_metrics_guide_full',
      'mg_v4_metrics_guide_full 必须位于内置指标图第一位（默认选中）',
    );

    const mgDef = defaultMetricGraphStore.get('mg_v4_metrics_guide_full');
    assert.ok(mgDef, 'mg_v4_metrics_guide_full 必须存在于 defaultMetricGraphStore');

    const validation = validateMetricGraph(mgDef);
    assert.strictEqual(validation.valid, true, `指标图校验必须通过: ${validation.errors.join('; ')}`);
    assert.strictEqual(validation.errors.length, 0);

    // 验证一库分流与 5 个原生组件注册
    assert.strictEqual(ALL_V4_OPERATOR_SCRIPTS.length, 40);
    assert.strictEqual(V4_FACT_OPERATORS.length, 28, '一库应精确导出 28 个 layer=fact 事实算子');
    assert.strictEqual(V4_BUILTIN_COMPONENTS.length, 5, '一库应导出 5 个原生画布组件');
    const factSummaries = listV4OperatorSummaries({ layer: 'fact' });
    assert.strictEqual(factSummaries.length, 28);
    assert.ok(factSummaries.every((s) => s.layer === 'fact' && s.engineKind === 'python_script'));

    // 结构零漂移守卫：每个 from_operator 节点必须引用 layer === 'fact' 算子，且 targetField 精确存在于 outputColumns
    const l0Nodes = mgDef.nodes.filter((n) => n.metricConfig?.mode === 'from_operator');
    const l1Nodes = mgDef.nodes.filter((n) => n.metricConfig?.mode === 'from_metric_agg');
    const l2Nodes = mgDef.nodes.filter((n) => n.metricConfig?.mode === 'from_metric_formula');

    assert.strictEqual(l0Nodes.length, 20, 'L0 必须包含 20 个基础事实节点');
    assert.strictEqual(l1Nodes.length, 8, 'L1 必须包含 8 个多维分组聚合节点');
    assert.strictEqual(l2Nodes.length, 3, 'L2 必须包含 3 个自定义衍生公式节点');
    assert.strictEqual(mgDef.nodes.length, 31, 'mg_v4_metrics_guide_full 必须包含 31 个客观指标节点');
    assert.strictEqual(mgDef.edges.length, 14, 'mg_v4_metrics_guide_full 必须包含 14 条计算依赖边');

    for (const node of l0Nodes) {
      const mc = node.metricConfig!;
      const opSpec = getV4OperatorSpec(mc.sourceRef ?? '');
      assert.ok(opSpec, `L0 节点 ${node.id} 引用的算子 ${mc.sourceRef} 必须存在`);
      assert.strictEqual(
        opSpec.layer,
        'fact',
        `Plan A 违例：L0 节点 ${node.id} 引用的算子 ${opSpec.id} 必须为 layer='fact' (当前=${opSpec.layer})`,
      );
      assert.ok(mc.targetField, `L0 节点 ${node.id} 必须指定 targetField`);
      assert.ok(
        opSpec.outputColumns.includes(mc.targetField),
        `字段漂移：L0 节点 ${node.id} 的 targetField="${mc.targetField}" 不在算子 ${opSpec.id} 的 outputColumns=${JSON.stringify(opSpec.outputColumns)} 中`,
      );
    }

    // 验证无任何主观打分函数或权重
    for (const node of mgDef.nodes) {
      assert.strictEqual(
        (node as any).scoreFormula,
        undefined,
        `二库指标节点 ${node.id} 严禁包含主观打分函数`,
      );
      assert.strictEqual(
        (node as any).weight,
        undefined,
        `二库指标节点 ${node.id} 严禁包含主观权重`,
      );
    }

    // 验证 LibFormula AST 衍生公式节点
    const airCombatNode = mgDef.nodes.find((n) => n.id === 'mn_formula_air_ground_ratio');
    assert.ok(airCombatNode);
    assert.strictEqual(
      airCombatNode.metricConfig?.formulaExpression,
      '0.6 * strike_rate + 0.4 * patrol_rate',
    );

    const effectiveExchNode = mgDef.nodes.find((n) => n.id === 'mn_cost_effective_exchange_ratio');
    assert.ok(effectiveExchNode);
    assert.strictEqual(
      effectiveExchNode.metricConfig?.formulaExpression,
      'IF(attrition_rate <= 0, 10, survival_rate / attrition_rate)',
    );

    const costEffectivenessNode = mgDef.nodes.find((n) => n.id === 'mn_formula_cost_effectiveness');
    assert.ok(costEffectivenessNode);
    assert.strictEqual(
      costEffectivenessNode.metricConfig?.formulaExpression,
      'exchange_ratio * (survival_rate + 0.05)',
    );
  });

  // ──────────────────── 测试 2: 三库评估体系图与效果预设对齐校验 ────────────────────
  it('2. sys_v4_metrics_guide_full loads first, validates cleanly, and every metric_proxy exists in mg_v4_metrics_guide_full', () => {
    const allSystems = defaultSystemDagStore.listAll();
    assert.strictEqual(
      allSystems[0]?.systemId,
      'sys_v4_metrics_guide_full',
      'sys_v4_metrics_guide_full 必须位于内置体系图第一位（默认选中）',
    );

    const mgDef = defaultMetricGraphStore.get('mg_v4_metrics_guide_full')!;
    const mgMetricIds = new Set(mgDef.nodes.map((n) => n.metricConfig?.metricId).filter(Boolean));

    const sysDef = defaultSystemDagStore.get('sys_v4_metrics_guide_full');
    assert.ok(sysDef, 'sys_v4_metrics_guide_full 必须存在于 defaultSystemDagStore');
    assert.strictEqual(sysDef.metricGraphId, 'mg_v4_metrics_guide_full');

    const validation = validateSystemDag(sysDef, defaultEffectStore);
    assert.strictEqual(validation.valid, true, `体系图校验必须通过: ${validation.errors.join('; ')}`);
    assert.strictEqual(validation.errors.length, 0);
    assert.strictEqual(sysDef.nodes.length, 32, '必须包含 32 个节点 (13 代理 + 12 叶子效果 + 2 门控 + 4 复合效果 + 1 终态)');
    assert.strictEqual(sysDef.edges.length, 30, '必须包含 30 条有向边');

    // 验证所有 metric_proxy 的 refId 全部在 mg_v4_metrics_guide_full 中存在
    for (const node of sysDef.nodes) {
      if (node.kind === 'metric_proxy') {
        assert.ok(
          node.refId && mgMetricIds.has(node.refId),
          `体系代理节点 ${node.id} 的 refId="${node.refId}" 必须存在于 mg_v4_metrics_guide_full`,
        );
      }
    }

    // 验证局部入边权重和严格等于 1.0000
    const inEdgesByTarget = new Map<string, number>();
    for (const edge of sysDef.edges) {
      if (typeof edge.weight === 'number') {
        const cur = inEdgesByTarget.get(edge.targetNodeId) ?? 0;
        inEdgesByTarget.set(edge.targetNodeId, cur + edge.weight);
      }
    }

    for (const [targetId, sumWeight] of inEdgesByTarget.entries()) {
      assert.ok(
        Math.abs(sumWeight - 1.0) < 1e-4,
        `节点 ${targetId} 局部入边权重之和必须等于 1.0000 (实际: ${sumWeight})`,
      );
    }

    // 验证单位对齐的效果预设
    const effRecon = defaultEffectStore.get('eff_isr_recon_range');
    assert.strictEqual(effRecon?.metricBinding?.metricId, 'isr.reconnaissance_range');
    const effEw = defaultEffectStore.get('eff_ew_jamming_duration');
    assert.strictEqual(effEw?.metricBinding?.metricId, 'ew.jamming_duration');
    const effKc = defaultEffectStore.get('eff_kill_chain_synergy');
    assert.strictEqual(effKc?.metricBinding?.metricId, 'fire_control.kill_chain_closure_time');
    const effWpn = defaultEffectStore.get('eff_weapon_striking');
    assert.strictEqual(effWpn?.metricBinding?.metricId, 'weapon.munition_hit_rate');
    const effCost = defaultEffectStore.get('eff_cost_exchange');
    assert.strictEqual(effCost?.metricBinding?.metricId, 'cost.effective_exchange_ratio');

    // 验证双轨门控节点
    const hardGate = sysDef.nodes.find((n) => n.id === 'gt_attrition_hard');
    assert.ok(hardGate);
    assert.strictEqual(hardGate.refId, 'gate_excessive_attrition');
    assert.strictEqual(defaultEffectStore.get('gate_excessive_attrition')?.gateMode, 'hard');

    const softGate = sysDef.nodes.find((n) => n.id === 'gt_interception_soft');
    assert.ok(softGate);
    assert.strictEqual(softGate.refId, 'gate_interception_warning');
    assert.strictEqual(defaultEffectStore.get('gate_interception_warning')?.gateMode, 'soft');
  });

  // ──────────────────── 测试 3: 全链路端到端评估与 Fail-Closed 缺失容错 ────────────────────
  it('3. executes end-to-end Plan A pipeline (Fact Operators -> L0/L1/L2 Metric DAG -> System DAG) with boolean aggregation & Fail-Closed tolerance', async () => {
    const mgDef = defaultMetricGraphStore.get('mg_v4_metrics_guide_full')!;
    const sysDef = defaultSystemDagStore.get('sys_v4_metrics_guide_full')!;

    const mockOperatorInputs: Record<string, MetricOperatorInput> = {};

    function makeDs(id: string, cols: string[], rows: Array<Record<string, unknown>>): TableDataset {
      return {
        id,
        columns: cols.map((c) => {
          const sample = rows[0]?.[c];
          return {
            name: c,
            type: typeof sample === 'number' ? 'number' : typeof sample === 'boolean' ? 'boolean' : 'string',
          };
        }),
        rows,
        totalRows: rows.length,
      };
    }

    // 第 1 章：L0 单任务事实表
    mockOperatorInputs['strike.single_mission_metrics'] = {
      status: 'valid',
      dataset: makeDs('ds_strike_single', ['任务ID', '任务名', '分方', '完成比'], [
        { 任务ID: 'M1', 任务名: '对海突击-1', 分方: '红方', 完成比: 1.0 },
        { 任务ID: 'M2', 任务名: '对海突击-2', 分方: '红方', 完成比: 0.9 },
      ]),
    };
    mockOperatorInputs['patrol.single_mission_metrics'] = {
      status: 'valid',
      dataset: makeDs('ds_patrol_single', ['任务ID', '任务名', '分方', '完成比'], [
        { 任务ID: 'P1', 任务名: '北巡逻', 分方: '红方', 完成比: 0.9 },
      ]),
    };
    mockOperatorInputs['support.single_mission_metrics'] = {
      status: 'valid',
      dataset: makeDs('ds_support_single', ['任务ID', '任务名', '分方', '完成比'], [
        { 任务ID: 'S1', 任务名: '预警支援', 分方: '红方', 完成比: 0.88 },
      ]),
    };

    // 第 2 章：L0 单元事实表（包含 boolean 命中列）
    mockOperatorInputs['detection.unit_detection'] = {
      status: 'valid',
      dataset: makeDs('ds_det_unit', ['探测平台', '探测目标', '首次发现距离', '探测传感器', '探测平台型号', '分方'], [
        { 探测平台: 'KJ-500 #1', 探测目标: 'F-35 #1', 首次发现距离: 180.0, 探测传感器: 'Radar-A', 探测平台型号: 'KJ-500', 分方: '红方' },
        { 探测平台: 'KJ-500 #2', 探测目标: 'F-35 #2', 首次发现距离: 160.0, 探测传感器: 'Radar-A', 探测平台型号: 'KJ-500', 分方: '红方' },
      ]),
    };
    mockOperatorInputs['fire_control.unit_kill_chain_closure'] = {
      status: 'valid',
      dataset: makeDs('ds_kc_unit', ['目标ID', '目标名', '目标型号', '分方', '杀伤闭环总时长', '是否闭环'], [
        { 目标ID: 'T1', 目标名: 'F-35 #1', 目标型号: 'F-35', 分方: '红方', 杀伤闭环总时长: 45.0, 是否闭环: true },
        { 目标ID: 'T2', 目标名: 'F-35 #2', 目标型号: 'F-35', 分方: '红方', 杀伤闭环总时长: 40.0, 是否闭环: true },
      ]),
    };
    mockOperatorInputs['weapon.munition_engagement_status'] = {
      status: 'valid',
      dataset: makeDs('ds_wpn_eng', ['武器ID', '武器型号', '命中', '发射分方'], [
        { 武器ID: 'W1', 武器型号: 'PL-15', 命中: true, 发射分方: '红方' },
        { 武器ID: 'W2', 武器型号: 'PL-15', 命中: true, 发射分方: '红方' },
        { 武器ID: 'W3', 武器型号: 'PL-15', 命中: false, 发射分方: '红方' },
        { 武器ID: 'W4', 武器型号: 'PL-15', 命中: true, 发射分方: '红方' },
      ]),
    };
    mockOperatorInputs['weapon.penetration_metrics'] = {
      status: 'valid',
      dataset: makeDs('ds_pen', ['发射分方', '武器型号', '穿透率'], [
        { 发射分方: '红方', 武器型号: 'YJ-18', 穿透率: 0.8 },
      ]),
    };

    // 第 3 章：成本效益（零战损情景：战损率 = 0.0 -> 测试 L2 零战损公式保护）
    mockOperatorInputs['cost.side_attrition_metrics'] = {
      status: 'valid',
      dataset: makeDs('ds_attr', ['分方', '平台生存率', '战损率', '平台损失'], [
        { 分方: '红方', 平台生存率: 1.0, 战损率: 0.0, 平台损失: 0 },
      ]),
    };

    // 第 4/6 章可用事实算子
    mockOperatorInputs['isr.reconnaissance_range'] = {
      status: 'valid',
      dataset: makeDs('ds_isr_range', ['型号', '探测范围_海里', '分方'], [
        { 型号: 'KJ-500', 探测范围_海里: 200.0, 分方: '红方' },
      ]),
    };
    mockOperatorInputs['ew.jamming_duration'] = {
      status: 'valid',
      dataset: makeDs('ds_ew_dur', ['单元ID', '单元名', '分方', '累计受扰秒数'], [
        { 单元ID: 'U1', 单元名: 'Radar-1', 分方: '红方', 累计受扰秒数: 1200.0 },
        { 单元ID: 'U2', 单元名: 'Radar-2', 分方: '红方', 累计受扰秒数: 600.0 },
      ]),
    };

    // 第 7 章：防空反导
    mockOperatorInputs['air_defense.composite_interception_probability'] = {
      status: 'valid',
      dataset: makeDs('ds_ad_p', ['分方', '综合拦截率'], [
        { 分方: '红方', 综合拦截率: 0.92 },
      ]),
    };
    mockOperatorInputs['air_defense.detection_zone'] = {
      status: 'valid',
      dataset: makeDs('ds_ad_det', ['型号', '分方', '最大探测距离_海里'], [
        { 型号: 'HQ-9', 分方: '红方', 最大探测距离_海里: 220.0 },
      ]),
    };
    mockOperatorInputs['air_defense.unit_intercept_zone'] = {
      status: 'valid',
      dataset: makeDs('ds_ad_int', ['发射平台ID', '发射平台名', '分方', '发射平台型号', '发射距离_海里'], [
        { 发射平台ID: 'SAM_1', 发射平台名: 'HQ-9 #1', 分方: '红方', 发射平台型号: 'HQ-9', 发射距离_海里: 110.0 },
      ]),
    };

    // 缺失底表算子严格返回 unavailable（Fail-Closed 门控）
    const missingOps = [
      'isr.identification_latency',
      'isr.radar_coverage_area',
      'isr.detection_rate',
      'c2.situational_completeness',
      'ew.hf_comm_jamming_detail',
    ];
    for (const opId of missingOps) {
      mockOperatorInputs[opId] = {
        status: 'unavailable',
        missingDataReason: '缺少推演事件底表，遵循 Fail-Closed 实证门控',
      };
    }

    // ── 阶段 1: 二库客观指标图执行 ──
    const mgRes = await evaluateMetricGraph(mgDef, mockOperatorInputs, {
      runId: 'test-wave3-plan-a-e2e',
    });
    assert.strictEqual(mgRes.topologicalOrder.length, 31);

    // 验证 L1 分组聚合
    const strikeMetric = mgRes.nodeResults['mn_strike_composite'];
    assert.strictEqual(strikeMetric.status, 'valid');
    assert.strictEqual(strikeMetric.value, 0.95);

    const detMetric = mgRes.nodeResults['mn_detection_model'];
    assert.strictEqual(detMetric.status, 'valid');
    assert.strictEqual(detMetric.value, 170);

    const kcMetric = mgRes.nodeResults['mn_killchain_closure_time'];
    assert.strictEqual(kcMetric.status, 'valid');
    assert.strictEqual(kcMetric.value, 42.5);

    // 验证 boolean 列 mean 聚合为实数命中率 (3/4 = 0.75)
    const hitRateMetric = mgRes.nodeResults['mn_weapon_hit_rate'];
    assert.strictEqual(hitRateMetric.status, 'valid');
    assert.strictEqual(hitRateMetric.value, 0.75);

    // 验证 L2 零战损保护公式: IF(0 <= 0, 10, 1 / 0) = 10
    const effExchMetric = mgRes.nodeResults['mn_cost_effective_exchange_ratio'];
    assert.strictEqual(effExchMetric.status, 'valid');
    assert.strictEqual(effExchMetric.value, 10);

    // 验证 L2 衍生公式指标: 0.6 * 0.95 + 0.4 * 0.90 = 0.93
    const formulaAirCombat = mgRes.nodeResults['mn_formula_air_ground_ratio'];
    assert.strictEqual(formulaAirCombat.status, 'valid');
    assert.strictEqual(Math.round((formulaAirCombat.value as number) * 100) / 100, 0.93);

    // 验证缺失指标遵循 Fail-Closed
    const c2Metric = mgRes.nodeResults['mn_c2_situational_completeness'];
    assert.strictEqual(c2Metric.status, 'unavailable');
    assert.ok(c2Metric.missingDataReason?.includes('缺少推演事件底表'));

    // ── 阶段 2: 三库体系 DAG 执行 ──
    const sysRes = await evaluateSystemDag(
      sysDef,
      mgRes.metricInputsForSystem,
      { evalId: 'eval-wave3-plan-a' },
    );

    assert.ok(sysRes.overallScore !== null && sysRes.overallScore > 0, `体系得分必须大于 0: ${sysRes.overallScore}`);
    assert.strictEqual(sysRes.gateVerdict, 'PASS', '红方战损与拦截门控应正常通过');
    assert.strictEqual(sysRes.nodeResults['ef_cost_exchange']?.score, 100, '零战损应获得满分效费交换分');
    assert.ok(
      (sysRes.nodeResults['ef_weapon']?.score ?? 0) > 80,
      `命中率 0.75 应在 [0.1, 0.85] 区间获高分 (实际=${sysRes.nodeResults['ef_weapon']?.score})`,
    );

    // 验证 Hard GATE & Soft GATE
    const hardAudit = sysRes.gateAudit.find((g) => g.atomId === 'gate_excessive_attrition');
    assert.ok(hardAudit);
    assert.strictEqual(hardAudit.gateStatus, 'pass');
    assert.strictEqual(hardAudit.gateMode, 'hard');

    const softAudit = sysRes.gateAudit.find((g) => g.atomId === 'gate_interception_warning');
    assert.ok(softAudit);
    assert.strictEqual(softAudit.gateStatus, 'pass');
    assert.strictEqual(softAudit.gateMode, 'soft');
  });

  // ──────────────────── 测试 4: Hard GATE 违规一票否决与封顶约束 ────────────────────
  it('4. Hard GATE violation triggers DISQUALIFIED verdict and caps overall score at 39.0', async () => {
    const sysDef = defaultSystemDagStore.get('sys_v4_metrics_guide_full')!;

    const violatedInputs: SystemDagEvaluationInputs = {
      'cost.side_attrition_rate': { status: 'valid', value: 0.45 },
      'cost.side_attrition_metrics': { status: 'valid', value: 0.55 },
      'air_defense.composite_interception_probability': { status: 'valid', value: 0.90 },
    };

    const sysRes = await evaluateSystemDag(
      sysDef,
      violatedInputs,
      { evalId: 'eval-wave3-violated' },
    );

    assert.strictEqual(sysRes.gateVerdict, 'DISQUALIFIED', '战损率超过 35% 必须裁定为 DISQUALIFIED');
    assert.strictEqual(sysRes.overallScore, 39.0, '硬门控违规时整体效能总分必须一票否决封顶为 39.0');
    assert.ok(
      sysRes.rawOverallScore !== null && sysRes.rawOverallScore > 39.0,
      `原始总分应高于 39.0 (实际: ${sysRes.rawOverallScore})`,
    );

    const hardAudit = sysRes.gateAudit.find((g) => g.atomId === 'gate_excessive_attrition');
    assert.ok(hardAudit);
    assert.strictEqual(hardAudit.gateStatus, 'violated');
    assert.strictEqual(hardAudit.gateMode, 'hard');
  });

  // ──────────────────── 测试 5: Soft GATE 预警与无破坏性审计 ────────────────────
  it('5. Soft GATE violation records WARNING audit without hard score capping', async () => {
    const sysDef = defaultSystemDagStore.get('sys_v4_metrics_guide_full')!;

    const softWarningInputs: SystemDagEvaluationInputs = {
      'cost.side_attrition_rate': { status: 'valid', value: 0.05 },
      'cost.side_attrition_metrics': { status: 'valid', value: 0.95 },
      'air_defense.composite_interception_probability': { status: 'valid', value: 0.30 },
    };

    const sysRes = await evaluateSystemDag(
      sysDef,
      softWarningInputs,
      { evalId: 'eval-wave3-soft' },
    );

    assert.strictEqual(sysRes.gateVerdict, 'WARNING', '无硬门控违规但软门控报警时应裁定为 WARNING');
    const softAudit = sysRes.gateAudit.find((g) => g.atomId === 'gate_interception_warning');
    assert.ok(softAudit);
    assert.strictEqual(softAudit.gateStatus, 'violated');
    assert.strictEqual(softAudit.gateMode, 'soft');

    assert.notStrictEqual(sysRes.overallScore, 39.0);
    assert.strictEqual(sysRes.overallScore, sysRes.rawOverallScore);
  });
});
