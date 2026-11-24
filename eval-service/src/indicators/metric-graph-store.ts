import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  DagEdge,
  DagNodeBase,
  DatasetColumn,
  EvidenceRef,
  FieldDataType,
  IndicatorReduceMethod,
  MetricDomainTag,
  MetricGraphDefinition,
  MetricMilitaryLevel,
  MetricNodeConfig,
  TableDataset,
} from '../core/types.ts';
import {
  DagNodeCache,
  canonicalJsonStringify,
  detectCycles,
  executeDagGraph,
  topologicalSort,
  type DagGraphExecutionResult,
  type DagNodeExecutionOutput,
} from '../engine/dag-executor.ts';
import {
  extractVariableReferences,
  evaluateFormulaExpression,
  parseFormulaAST,
  validateFormula,
} from '../operators/formula-engine.ts';
import { reduceNumericArray } from './store.ts';
import type { SystemDagEvaluationInputs, SystemDagMetricInput } from '../systems/dag-evaluator.ts';

const DEFAULT_METRIC_GRAPHS_PATH = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'data',
  'v4-metric-graphs.json',
);

const VALID_MILITARY_LEVELS = new Set<MetricMilitaryLevel>(['MOP', 'MOE', 'MOFE']);
const VALID_DOMAIN_TAGS = new Set<MetricDomainTag>([
  'firepower',
  'isr',
  'survivability',
  'c2',
  'synergy',
  'cost',
]);
const VALID_MODES = new Set<MetricNodeConfig['mode']>([
  'from_operator',
  'from_metric_agg',
  'from_metric_formula',
]);
const VALID_REDUCE_METHODS = new Set<IndicatorReduceMethod>([
  'mean',
  'sum',
  'max',
  'min',
  'median',
  'last',
  'first',
]);

const FORBIDDEN_METRIC_SUBJECTIVE_KEYS = [
  'weight',
  'weights',
  'scoring',
  'scoringRule',
  'scoreRange',
  'inlineEffect',
  'effectId',
  'gateMode',
  'gateStatus',
  'ahpMatrix',
  'ahpCr',
  'aggregation',
] as const;

export type MetricGraphNode = DagNodeBase & { metricConfig?: MetricNodeConfig };

export type StoredMetricGraphDefinition = MetricGraphDefinition & {
  builtin?: boolean;
};

export interface MetricGraphValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  topologicalOrder: string[];
  hasCycle: boolean;
  cycleNodeIds: string[];
  missingEdgeRefs: string[];
}

export interface MetricOperatorInput {
  status: 'valid' | 'degraded' | 'unavailable';
  dataset?: TableDataset;
  value?: number | boolean | null;
  missingDataReason?: string;
  evidenceRefs?: EvidenceRef[];
  cacheKey?: string;
}

export interface EvaluateMetricGraphOptions {
  runId?: string;
  cache?: DagNodeCache;
  paramOverrides?: Record<string, Record<string, unknown>>;
  globalParamOverrides?: Record<string, unknown>;
}

export interface MetricGraphExecutionResult extends DagGraphExecutionResult {
  metricInputsForSystem: SystemDagEvaluationInputs;
  metricNodeIdByMetricId: Record<string, string>;
}

// ──────────────────── 内置示例二库指标 DAG ────────────────────

const BUILTIN_METRIC_GRAPHS: StoredMetricGraphDefinition[] = [
  {
    graphId: 'mg_v4_metrics_guide_full',
    name: '全域作战效能指标图集',
    description:
      '面向任务效果、指挥控制、机动生存与对抗交换的客观指标计算图集。包含单任务事实提取、分方多维聚合与复合公式衍生指标。',
    graphKind: 'metric',
    builtin: true,
    nodes: [
      // ══════════════════ L0: 基础事实算子直接提取 (from_operator, layer=fact) ══════════════════
      // ── 第 1 章：任务效果 (L0 单任务事实表) ──
      {
        id: 'mn_strike_single',
        kind: 'metric',
        label: '单突击任务客观完成明细 (L0)',
        position: { x: 60, y: 60 },
        metricConfig: {
          metricId: 'strike.single_mission_metrics',
          name: '单突击任务完成度',
          militaryLevel: 'MOP',
          domainTag: 'firepower',
          mode: 'from_operator',
          sourceRef: 'strike.single_mission_metrics',
          targetField: '完成比',
          reduce: 'mean',
          unit: 'ratio',
        },
      },
      {
        id: 'mn_patrol_single',
        kind: 'metric',
        label: '单巡逻任务客观完成明细 (L0)',
        position: { x: 60, y: 160 },
        metricConfig: {
          metricId: 'patrol.single_mission_metrics',
          name: '单巡逻任务完成度',
          militaryLevel: 'MOP',
          domainTag: 'survivability',
          mode: 'from_operator',
          sourceRef: 'patrol.single_mission_metrics',
          targetField: '完成比',
          reduce: 'mean',
          unit: 'ratio',
        },
      },
      {
        id: 'mn_support_single',
        kind: 'metric',
        label: '单支援任务客观完成明细 (L0)',
        position: { x: 60, y: 260 },
        metricConfig: {
          metricId: 'support.single_mission_metrics',
          name: '单支援任务完成度',
          militaryLevel: 'MOP',
          domainTag: 'synergy',
          mode: 'from_operator',
          sourceRef: 'support.single_mission_metrics',
          targetField: '完成比',
          reduce: 'mean',
          unit: 'ratio',
        },
      },

      // ── 第 2 章：装备效能 (L0 单元/交战事实表) ──
      {
        id: 'mn_detection_unit',
        kind: 'metric',
        label: '单元探测首次发现距离明细 (L0)',
        position: { x: 60, y: 360 },
        metricConfig: {
          metricId: 'detection.unit_detection',
          name: '单元首次发现距离',
          militaryLevel: 'MOP',
          domainTag: 'isr',
          mode: 'from_operator',
          sourceRef: 'detection.unit_detection',
          targetField: '首次发现距离',
          reduce: 'mean',
          unit: 'nm',
        },
      },
      {
        id: 'mn_killchain_unit',
        kind: 'metric',
        label: '单元杀伤链闭环耗时明细 (L0)',
        position: { x: 60, y: 460 },
        metricConfig: {
          metricId: 'fire_control.unit_kill_chain_closure',
          name: '单元杀伤链闭环总时长',
          militaryLevel: 'MOP',
          domainTag: 'synergy',
          mode: 'from_operator',
          sourceRef: 'fire_control.unit_kill_chain_closure',
          targetField: '杀伤闭环总时长',
          reduce: 'mean',
          unit: 's',
        },
      },
      {
        id: 'mn_weapon_engagement',
        kind: 'metric',
        label: '单发弹药打击终局明细 (L0)',
        position: { x: 60, y: 560 },
        metricConfig: {
          metricId: 'weapon.munition_engagement_status',
          name: '单发弹药打击命中状态',
          militaryLevel: 'MOP',
          domainTag: 'firepower',
          mode: 'from_operator',
          sourceRef: 'weapon.munition_engagement_status',
          targetField: '命中',
          reduce: 'mean',
          unit: 'ratio',
        },
      },
      {
        id: 'mn_weapon_penetration_rate',
        kind: 'metric',
        label: '突防武器对地舰穿透率 (L0)',
        position: { x: 60, y: 660 },
        metricConfig: {
          metricId: 'weapon.penetration_metrics',
          name: '突防武器对地舰穿透率',
          militaryLevel: 'MOP',
          domainTag: 'firepower',
          mode: 'from_operator',
          sourceRef: 'weapon.penetration_metrics',
          targetField: '穿透率',
          reduce: 'mean',
          unit: 'ratio',
        },
      },

      // ── 第 3 章：成本效益 (L0 分方消耗战损事实表) ──
      {
        id: 'mn_cost_survival_rate',
        kind: 'metric',
        label: '平台生存率 (L0)',
        position: { x: 60, y: 760 },
        metricConfig: {
          metricId: 'cost.side_attrition_metrics',
          name: '平台生存率',
          militaryLevel: 'MOE',
          domainTag: 'survivability',
          mode: 'from_operator',
          sourceRef: 'cost.side_attrition_metrics',
          targetField: '平台生存率',
          reduce: 'mean',
          unit: 'ratio',
        },
      },
      {
        id: 'mn_cost_attrition_rate',
        kind: 'metric',
        label: '平台战损率 (L0 红线输入)',
        position: { x: 60, y: 860 },
        metricConfig: {
          metricId: 'cost.side_attrition_rate',
          name: '平台战损率',
          militaryLevel: 'MOE',
          domainTag: 'survivability',
          mode: 'from_operator',
          sourceRef: 'cost.side_attrition_metrics',
          targetField: '战损率',
          reduce: 'mean',
          unit: 'ratio',
        },
      },
      {
        id: 'mn_cost_platform_losses',
        kind: 'metric',
        label: '分方平台损失数 (L0)',
        position: { x: 60, y: 960 },
        metricConfig: {
          metricId: 'cost.platform_losses',
          name: '分方平台损失数',
          militaryLevel: 'MOP',
          domainTag: 'cost',
          mode: 'from_operator',
          sourceRef: 'cost.side_attrition_metrics',
          targetField: '平台损失',
          reduce: 'sum',
          unit: 'count',
        },
      },

      // ── 第 4 章：侦察预警 (L0 侦察事实表) ──
      {
        id: 'mn_isr_recon_range',
        kind: 'metric',
        label: '主战侦察平台侦察范围 (L0)',
        position: { x: 60, y: 1060 },
        metricConfig: {
          metricId: 'isr.reconnaissance_range',
          name: '主战侦察平台侦察范围',
          militaryLevel: 'MOP',
          domainTag: 'isr',
          mode: 'from_operator',
          sourceRef: 'isr.reconnaissance_range',
          targetField: '探测范围_海里',
          reduce: 'mean',
          unit: 'nm',
        },
      },
      {
        id: 'mn_isr_ident_latency',
        kind: 'metric',
        label: '目标识别平均用时 (L0)',
        position: { x: 60, y: 1160 },
        metricConfig: {
          metricId: 'isr.identification_latency',
          name: '目标识别平均用时',
          militaryLevel: 'MOP',
          domainTag: 'isr',
          mode: 'from_operator',
          sourceRef: 'isr.identification_latency',
          targetField: '识别时间_秒',
          reduce: 'mean',
          unit: 's',
        },
      },
      {
        id: 'mn_isr_radar_area',
        kind: 'metric',
        label: '雷达覆盖峰值面积 (L0)',
        position: { x: 60, y: 1260 },
        metricConfig: {
          metricId: 'isr.radar_coverage_area',
          name: '雷达覆盖峰值面积',
          militaryLevel: 'MOE',
          domainTag: 'isr',
          mode: 'from_operator',
          sourceRef: 'isr.radar_coverage_area',
          targetField: '面积_平方公里',
          reduce: 'max',
          unit: 'km2',
        },
      },
      {
        id: 'mn_isr_detection_rate',
        kind: 'metric',
        label: '目标发现率 (L0 Fail-Closed 审计)',
        position: { x: 60, y: 1360 },
        metricConfig: {
          metricId: 'isr.detection_rate',
          name: '目标发现率',
          militaryLevel: 'MOE',
          domainTag: 'isr',
          mode: 'from_operator',
          sourceRef: 'isr.detection_rate',
          targetField: '发现率',
          reduce: 'mean',
          unit: 'ratio',
        },
      },

      // ── 第 5 章：指挥控制体系效能 (L0) ──
      {
        id: 'mn_c2_situational_completeness',
        kind: 'metric',
        label: '态势完整度 (L0 Fail-Closed 审计)',
        position: { x: 60, y: 1460 },
        metricConfig: {
          metricId: 'c2.situational_completeness',
          name: '态势完整度',
          militaryLevel: 'MOE',
          domainTag: 'c2',
          mode: 'from_operator',
          sourceRef: 'c2.situational_completeness',
          targetField: '态势完整度',
          reduce: 'mean',
          unit: 'ratio',
        },
      },

      // ── 第 6 章：电子干扰电子进攻体系效能 (L0) ──
      {
        id: 'mn_ew_jamming_duration',
        kind: 'metric',
        label: '持续有效干扰时间 (L0)',
        position: { x: 60, y: 1560 },
        metricConfig: {
          metricId: 'ew.jamming_duration',
          name: '持续有效干扰时间',
          militaryLevel: 'MOP',
          domainTag: 'survivability',
          mode: 'from_operator',
          sourceRef: 'ew.jamming_duration',
          targetField: '累计受扰秒数',
          reduce: 'sum',
          unit: 's',
        },
      },
      {
        id: 'mn_ew_hf_comm_jamming_detail',
        kind: 'metric',
        label: '短波通信网台干扰时间占比 (L0 Fail-Closed 审计)',
        position: { x: 60, y: 1660 },
        metricConfig: {
          metricId: 'ew.hf_comm_jamming_detail',
          name: '短波通信网台干扰时间占比',
          militaryLevel: 'MOP',
          domainTag: 'survivability',
          mode: 'from_operator',
          sourceRef: 'ew.hf_comm_jamming_detail',
          targetField: '干扰时间占比',
          reduce: 'mean',
          unit: 'ratio',
        },
      },

      // ── 第 7 章：防空反导体系效能 (L0) ──
      {
        id: 'mn_ad_composite_interception',
        kind: 'metric',
        label: '综合拦截概率 (L0)',
        position: { x: 60, y: 1760 },
        metricConfig: {
          metricId: 'air_defense.composite_interception_probability',
          name: '综合拦截概率',
          militaryLevel: 'MOFE',
          domainTag: 'firepower',
          mode: 'from_operator',
          sourceRef: 'air_defense.composite_interception_probability',
          targetField: '综合拦截率',
          reduce: 'mean',
          unit: 'ratio',
        },
      },
      {
        id: 'mn_ad_detection_zone',
        kind: 'metric',
        label: '防空阵地最大探测距离 (L0)',
        position: { x: 60, y: 1860 },
        metricConfig: {
          metricId: 'air_defense.detection_zone',
          name: '防空阵地最大探测距离',
          militaryLevel: 'MOP',
          domainTag: 'firepower',
          mode: 'from_operator',
          sourceRef: 'air_defense.detection_zone',
          targetField: '最大探测距离_海里',
          reduce: 'max',
          unit: 'nm',
        },
      },
      {
        id: 'mn_ad_unit_intercept_zone',
        kind: 'metric',
        label: '防空单元拦截发射距离 (L0)',
        position: { x: 60, y: 1960 },
        metricConfig: {
          metricId: 'air_defense.unit_intercept_zone',
          name: '防空单元拦截发射距离',
          militaryLevel: 'MOP',
          domainTag: 'firepower',
          mode: 'from_operator',
          sourceRef: 'air_defense.unit_intercept_zone',
          targetField: '发射距离_海里',
          reduce: 'max',
          unit: 'nm',
        },
      },

      // ══════════════════ L1: 二库多维分组聚合指标 (from_metric_agg) ══════════════════
      {
        id: 'mn_strike_composite',
        kind: 'metric',
        label: '突击任务平均完成率 (L1 按分方聚合)',
        position: { x: 420, y: 60 },
        metricConfig: {
          metricId: 'strike.composite_mission_metrics',
          name: '突击任务平均完成率',
          militaryLevel: 'MOE',
          domainTag: 'firepower',
          mode: 'from_metric_agg',
          sourceRef: 'mn_strike_single',
          groupBy: ['分方'],
          targetField: '完成比',
          reduce: 'mean',
          unit: 'ratio',
        },
      },
      {
        id: 'mn_patrol_composite',
        kind: 'metric',
        label: '巡逻掩护平均完成率 (L1 按分方聚合)',
        position: { x: 420, y: 160 },
        metricConfig: {
          metricId: 'patrol.composite_mission_metrics',
          name: '巡逻掩护平均完成率',
          militaryLevel: 'MOE',
          domainTag: 'survivability',
          mode: 'from_metric_agg',
          sourceRef: 'mn_patrol_single',
          groupBy: ['分方'],
          targetField: '完成比',
          reduce: 'mean',
          unit: 'ratio',
        },
      },
      {
        id: 'mn_support_composite',
        kind: 'metric',
        label: '支援保障平均完成率 (L1 按分方聚合)',
        position: { x: 420, y: 260 },
        metricConfig: {
          metricId: 'support.composite_mission_metrics',
          name: '支援保障平均完成率',
          militaryLevel: 'MOE',
          domainTag: 'synergy',
          mode: 'from_metric_agg',
          sourceRef: 'mn_support_single',
          groupBy: ['分方'],
          targetField: '完成比',
          reduce: 'mean',
          unit: 'ratio',
        },
      },
      {
        id: 'mn_detection_model',
        kind: 'metric',
        label: '雷达装备型号首次发现距离 (L1 按型号聚合)',
        position: { x: 420, y: 360 },
        metricConfig: {
          metricId: 'detection.model_detection',
          name: '雷达装备型号首次发现距离',
          militaryLevel: 'MOE',
          domainTag: 'isr',
          mode: 'from_metric_agg',
          sourceRef: 'mn_detection_unit',
          groupBy: ['探测平台型号'],
          targetField: '首次发现距离',
          reduce: 'mean',
          unit: 'nm',
        },
      },
      {
        id: 'mn_killchain_closure_time',
        kind: 'metric',
        label: '杀伤链闭环平均耗时 (L1 按目标型号聚合)',
        position: { x: 420, y: 460 },
        metricConfig: {
          metricId: 'fire_control.kill_chain_closure_time',
          name: '杀伤链闭环平均耗时',
          militaryLevel: 'MOE',
          domainTag: 'synergy',
          mode: 'from_metric_agg',
          sourceRef: 'mn_killchain_unit',
          groupBy: ['目标型号'],
          targetField: '杀伤闭环总时长',
          reduce: 'mean',
          unit: 's',
        },
      },
      {
        id: 'mn_weapon_hit_rate',
        kind: 'metric',
        label: '主战武器平均命中率 (L1 按武器型号聚合)',
        position: { x: 420, y: 560 },
        metricConfig: {
          metricId: 'weapon.munition_hit_rate',
          name: '主战武器平均命中率',
          militaryLevel: 'MOE',
          domainTag: 'firepower',
          mode: 'from_metric_agg',
          sourceRef: 'mn_weapon_engagement',
          groupBy: ['武器型号'],
          targetField: '命中',
          reduce: 'mean',
          unit: 'ratio',
        },
      },
      {
        id: 'mn_ew_jamming_total',
        kind: 'metric',
        label: '分方累计有效干扰总时长 (L1 按分方聚合)',
        position: { x: 420, y: 1560 },
        metricConfig: {
          metricId: 'ew.jamming_total_seconds',
          name: '分方累计有效干扰总时长',
          militaryLevel: 'MOE',
          domainTag: 'survivability',
          mode: 'from_metric_agg',
          sourceRef: 'mn_ew_jamming_duration',
          groupBy: ['分方'],
          targetField: '累计受扰秒数',
          reduce: 'sum',
          unit: 's',
        },
      },
      {
        id: 'mn_ad_max_intercept_range',
        kind: 'metric',
        label: '防空武器型号最大拦截距离 (L1 按发射型号聚合)',
        position: { x: 420, y: 1960 },
        metricConfig: {
          metricId: 'air_defense.max_intercept_range',
          name: '防空武器型号最大拦截距离',
          militaryLevel: 'MOE',
          domainTag: 'firepower',
          mode: 'from_metric_agg',
          sourceRef: 'mn_ad_unit_intercept_zone',
          groupBy: ['发射平台型号'],
          targetField: '发射距离_海里',
          reduce: 'max',
          unit: 'nm',
        },
      },

      // ══════════════════ L2: 第 8 章自定义衍生指标 (from_metric_formula) ══════════════════
      {
        id: 'mn_formula_air_ground_ratio',
        kind: 'metric',
        label: '攻防任务综合完成指数 (L2 衍生公式)',
        position: { x: 780, y: 110 },
        metricConfig: {
          metricId: 'custom.air_combat_task_index',
          name: '攻防任务综合完成指数',
          militaryLevel: 'MOFE',
          domainTag: 'synergy',
          mode: 'from_metric_formula',
          formulaExpression: '0.6 * strike_rate + 0.4 * patrol_rate',
          unit: 'ratio',
        },
      },
      {
        id: 'mn_cost_effective_exchange_ratio',
        kind: 'metric',
        label: '分方有效生存战损交换比 (L2 零战损保护公式)',
        position: { x: 420, y: 810 },
        metricConfig: {
          metricId: 'cost.effective_exchange_ratio',
          name: '分方有效生存战损交换比',
          militaryLevel: 'MOFE',
          domainTag: 'cost',
          mode: 'from_metric_formula',
          formulaExpression: 'IF(attrition_rate <= 0, 10, survival_rate / attrition_rate)',
          unit: 'ratio',
        },
      },
      {
        id: 'mn_formula_cost_effectiveness',
        kind: 'metric',
        label: '效能价格比与生存协同指数 (L2 衍生公式)',
        position: { x: 780, y: 810 },
        metricConfig: {
          metricId: 'custom.cost_effectiveness_ratio',
          name: '效能价格比与生存协同指数',
          militaryLevel: 'MOFE',
          domainTag: 'cost',
          mode: 'from_metric_formula',
          formulaExpression: 'exchange_ratio * (survival_rate + 0.05)',
          unit: 'index',
        },
      },
    ],
    edges: [
      // L0 -> L1 聚合边
      {
        id: 'edge_agg_strike',
        sourceNodeId: 'mn_strike_single',
        targetNodeId: 'mn_strike_composite',
      },
      {
        id: 'edge_agg_patrol',
        sourceNodeId: 'mn_patrol_single',
        targetNodeId: 'mn_patrol_composite',
      },
      {
        id: 'edge_agg_support',
        sourceNodeId: 'mn_support_single',
        targetNodeId: 'mn_support_composite',
      },
      {
        id: 'edge_agg_detection',
        sourceNodeId: 'mn_detection_unit',
        targetNodeId: 'mn_detection_model',
      },
      {
        id: 'edge_agg_killchain',
        sourceNodeId: 'mn_killchain_unit',
        targetNodeId: 'mn_killchain_closure_time',
      },
      {
        id: 'edge_agg_weapon',
        sourceNodeId: 'mn_weapon_engagement',
        targetNodeId: 'mn_weapon_hit_rate',
      },
      {
        id: 'edge_agg_ew',
        sourceNodeId: 'mn_ew_jamming_duration',
        targetNodeId: 'mn_ew_jamming_total',
      },
      {
        id: 'edge_agg_ad_intercept',
        sourceNodeId: 'mn_ad_unit_intercept_zone',
        targetNodeId: 'mn_ad_max_intercept_range',
      },

      // L0/L1 -> L2 公式边
      {
        id: 'edge_formula_strike',
        sourceNodeId: 'mn_strike_composite',
        targetNodeId: 'mn_formula_air_ground_ratio',
        targetAlias: 'strike_rate',
      },
      {
        id: 'edge_formula_patrol',
        sourceNodeId: 'mn_patrol_composite',
        targetNodeId: 'mn_formula_air_ground_ratio',
        targetAlias: 'patrol_rate',
      },
      {
        id: 'edge_formula_eff_ex_surv',
        sourceNodeId: 'mn_cost_survival_rate',
        targetNodeId: 'mn_cost_effective_exchange_ratio',
        targetAlias: 'survival_rate',
      },
      {
        id: 'edge_formula_eff_ex_attr',
        sourceNodeId: 'mn_cost_attrition_rate',
        targetNodeId: 'mn_cost_effective_exchange_ratio',
        targetAlias: 'attrition_rate',
      },
      {
        id: 'edge_formula_exchange',
        sourceNodeId: 'mn_cost_effective_exchange_ratio',
        targetNodeId: 'mn_formula_cost_effectiveness',
        targetAlias: 'exchange_ratio',
      },
      {
        id: 'edge_formula_survival',
        sourceNodeId: 'mn_cost_survival_rate',
        targetNodeId: 'mn_formula_cost_effectiveness',
        targetAlias: 'survival_rate',
      },
    ],
  },
  {
    graphId: 'mg_v4_joint_demo',
    name: '联合空中突击对抗指标图',
    description:
      '覆盖突击任务完成率、巡逻在勤率、雷达首发探测距离与战损交换比的客观计算链路。',
    graphKind: 'metric',
    builtin: true,
    nodes: [
      {
        id: 'mn_strike_single',
        kind: 'metric',
        label: '单突击任务客观完成明细',
        position: { x: 60, y: 60 },
        metricConfig: {
          metricId: 'strike.single_mission_metrics',
          name: '单突击任务完成度',
          militaryLevel: 'MOP',
          domainTag: 'firepower',
          mode: 'from_operator',
          sourceRef: 'strike.single_mission_metrics',
          unit: 'ratio',
        },
      },
      {
        id: 'mn_strike_composite',
        kind: 'metric',
        label: '突击任务平均完成率',
        position: { x: 380, y: 60 },
        metricConfig: {
          metricId: 'strike.composite_mission_metrics',
          name: '突击任务平均完成率',
          militaryLevel: 'MOE',
          domainTag: 'firepower',
          mode: 'from_metric_agg',
          sourceRef: 'mn_strike_single',
          groupBy: ['Side'],
          targetField: 'MissionCompletionRatio',
          reduce: 'mean',
          unit: 'ratio',
        },
      },
      {
        id: 'mn_patrol_composite',
        kind: 'metric',
        label: '巡逻掩护综合达成率',
        position: { x: 380, y: 180 },
        metricConfig: {
          metricId: 'patrol.composite_mission_metrics',
          name: '巡逻掩护综合达成率',
          militaryLevel: 'MOE',
          domainTag: 'survivability',
          mode: 'from_operator',
          sourceRef: 'patrol.composite_mission_metrics',
          targetField: 'MissionCompletionRatio',
          reduce: 'mean',
          unit: 'ratio',
        },
      },
      {
        id: 'mn_joint_balance',
        kind: 'metric',
        label: '攻防任务均衡度 (复合公式)',
        position: { x: 700, y: 120 },
        metricConfig: {
          metricId: 'joint.strike_patrol_balance',
          name: '攻防任务客观均衡度',
          militaryLevel: 'MOFE',
          domainTag: 'synergy',
          mode: 'from_metric_formula',
          formulaExpression: '(strike_rate + patrol_rate) / 2',
          unit: 'ratio',
        },
      },
      {
        id: 'mn_isr_detection',
        kind: 'metric',
        label: '侦察目标发现率',
        position: { x: 380, y: 300 },
        metricConfig: {
          metricId: 'isr.detection_rate',
          name: '侦察目标发现率',
          militaryLevel: 'MOE',
          domainTag: 'isr',
          mode: 'from_operator',
          sourceRef: 'isr.detection_rate',
          targetField: 'DetectionRate',
          reduce: 'mean',
          unit: 'ratio',
        },
      },
      {
        id: 'mn_c2_completeness',
        kind: 'metric',
        label: '战场态势完整度',
        position: { x: 380, y: 420 },
        metricConfig: {
          metricId: 'c2.situational_completeness',
          name: '战场态势完整度',
          militaryLevel: 'MOE',
          domainTag: 'c2',
          mode: 'from_operator',
          sourceRef: 'c2.situational_completeness',
          targetField: 'SituationalCompleteness',
          reduce: 'mean',
          unit: 'ratio',
        },
      },
      {
        id: 'mn_kill_chain',
        kind: 'metric',
        label: '杀伤链闭合平均时长',
        position: { x: 380, y: 540 },
        metricConfig: {
          metricId: 'fire_control.unit_kill_chain_closure',
          name: '杀伤链闭合平均时长',
          militaryLevel: 'MOP',
          domainTag: 'synergy',
          mode: 'from_operator',
          sourceRef: 'fire_control.unit_kill_chain_closure',
          targetField: 'KillChainDuration_s',
          reduce: 'mean',
          unit: 's',
        },
      },
      {
        id: 'mn_cost_exchange',
        kind: 'metric',
        label: '敌我战损价值交换比',
        position: { x: 380, y: 660 },
        metricConfig: {
          metricId: 'cost.side_exchange_ratio',
          name: '敌我战损价值交换比',
          militaryLevel: 'MOFE',
          domainTag: 'cost',
          mode: 'from_operator',
          sourceRef: 'cost.side_exchange_ratio',
          targetField: 'ExchangeRatio',
          reduce: 'mean',
          unit: 'ratio',
        },
      },
      {
        id: 'mn_roe_fratricide',
        kind: 'metric',
        label: '友军误伤事件计数',
        position: { x: 380, y: 780 },
        metricConfig: {
          metricId: 'roe.fratricide_count',
          name: '友军误伤事件计数',
          militaryLevel: 'MOP',
          domainTag: 'survivability',
          mode: 'from_operator',
          sourceRef: 'roe.fratricide_count',
          targetField: 'FratricideCount',
          reduce: 'sum',
          unit: 'count',
        },
      },
      {
        id: 'mn_roe_corridor',
        kind: 'metric',
        label: '航路走廊空间遵从率',
        position: { x: 380, y: 900 },
        metricConfig: {
          metricId: 'roe.corridor_spatial_compliance',
          name: '航路走廊空间遵从率',
          militaryLevel: 'MOE',
          domainTag: 'c2',
          mode: 'from_operator',
          sourceRef: 'roe.corridor_spatial_compliance',
          targetField: 'ComplianceRate',
          reduce: 'mean',
          unit: 'ratio',
        },
      },
    ],
    edges: [
      {
        id: 'me_strike_agg',
        sourceNodeId: 'mn_strike_single',
        targetNodeId: 'mn_strike_composite',
      },
      {
        id: 'me_joint_strike',
        sourceNodeId: 'mn_strike_composite',
        targetNodeId: 'mn_joint_balance',
        targetAlias: 'strike_rate',
      },
      {
        id: 'me_joint_patrol',
        sourceNodeId: 'mn_patrol_composite',
        targetNodeId: 'mn_joint_balance',
        targetAlias: 'patrol_rate',
      },
    ],
  },
];

// ──────────────────── 强隔离校验与拓扑检查 ────────────────────

function checkForbiddenSubjectiveProps(
  obj: unknown,
  pathPrefix: string,
  errors: string[],
): void {
  if (!obj || typeof obj !== 'object') return;
  const record = obj as Record<string, unknown>;
  for (const key of FORBIDDEN_METRIC_SUBJECTIVE_KEYS) {
    if (record[key] !== undefined) {
      errors.push(
        `二库指标画布强隔离违规：${pathPrefix} 不允许包含主观权重/评分/效果属性 "${key}"`,
      );
    }
  }
}

export function validateMetricGraph(graph: MetricGraphDefinition): MetricGraphValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!graph || typeof graph !== 'object') {
    return {
      valid: false,
      errors: ['指标 DAG 对象不能为空'],
      warnings: [],
      topologicalOrder: [],
      hasCycle: false,
      cycleNodeIds: [],
      missingEdgeRefs: [],
    };
  }

  if (!graph.graphId || typeof graph.graphId !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(graph.graphId)) {
    errors.push('graphId 仅允许字母、数字、下划线、点或连字符');
  }

  if (!graph.name || typeof graph.name !== 'string' || graph.name.trim().length === 0) {
    errors.push('指标图名称 name 不能为空');
  }

  if (graph.graphKind !== 'metric') {
    errors.push(`二库指标图 graphKind 必须为 "metric"，当前=${String(graph.graphKind)}`);
  }

  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];

  if (nodes.length === 0) {
    errors.push('指标 DAG 至少需要包含一个节点');
    return {
      valid: false,
      errors,
      warnings,
      topologicalOrder: [],
      hasCycle: false,
      cycleNodeIds: [],
      missingEdgeRefs: [],
    };
  }

  // 检查全局参数是否存在主观权重/评分键
  checkForbiddenSubjectiveProps(graph.globalParams, 'globalParams', errors);

  // 检查节点唯一性及强隔离
  const nodeIds = new Set<string>();
  const seenMetricIds = new Set<string>();
  const incomingByTarget = new Map<string, DagEdge[]>();

  for (const node of nodes) {
    if (!node || typeof node !== 'object') {
      errors.push('存在无效的空节点对象');
      continue;
    }
    if (!node.id || typeof node.id !== 'string' || node.id.trim().length === 0) {
      errors.push('存在缺少 id 的指标节点');
      continue;
    }
    if (nodeIds.has(node.id)) {
      errors.push(`存在重复的指标节点 ID: ${node.id}`);
    } else {
      nodeIds.add(node.id);
      incomingByTarget.set(node.id, []);
    }

    if (node.kind === 'effect' || node.kind === 'gate') {
      errors.push(`二库指标画布强隔离违规：节点 "${node.id}" 不允许使用三库节点类型 "${node.kind}"`);
    }

    checkForbiddenSubjectiveProps(node, `节点 "${node.id}"`, errors);
    checkForbiddenSubjectiveProps(node.params, `节点 "${node.id}".params`, errors);

    if (node.metricConfig) {
      const mc = node.metricConfig;
      checkForbiddenSubjectiveProps(mc, `节点 "${node.id}".metricConfig`, errors);

      if (!mc.metricId || typeof mc.metricId !== 'string' || mc.metricId.trim().length === 0) {
        errors.push(`节点 "${node.id}" metricConfig.metricId 不能为空`);
      } else if (seenMetricIds.has(mc.metricId)) {
        warnings.push(`存在重复的 metricId "${mc.metricId}" (节点 "${node.id}")`);
      } else {
        seenMetricIds.add(mc.metricId);
      }

      if (!mc.name || typeof mc.name !== 'string' || mc.name.trim().length === 0) {
        errors.push(`节点 "${node.id}" metricConfig.name 不能为空`);
      }

      if (mc.militaryLevel && !VALID_MILITARY_LEVELS.has(mc.militaryLevel)) {
        errors.push(`节点 "${node.id}" 不支持的军事层次 militaryLevel: ${String(mc.militaryLevel)}`);
      }

      if (mc.domainTag && !VALID_DOMAIN_TAGS.has(mc.domainTag)) {
        errors.push(`节点 "${node.id}" 不支持的能力域 domainTag: ${String(mc.domainTag)}`);
      }

      if (!VALID_MODES.has(mc.mode)) {
        errors.push(`节点 "${node.id}" 不支持的指标模式 mode: ${String(mc.mode)}`);
      }

      if (mc.reduce !== undefined && !VALID_REDUCE_METHODS.has(mc.reduce)) {
        errors.push(`节点 "${node.id}" 不支持的归约方法 reduce: ${String(mc.reduce)}`);
      }

      if (mc.mode === 'from_operator' && (!mc.sourceRef || !mc.sourceRef.trim())) {
        errors.push(`节点 "${node.id}" 为 from_operator 模式时必须指定 sourceRef (算子 ID)`);
      }

      if (mc.mode === 'from_metric_formula') {
        if (!mc.formulaExpression || !mc.formulaExpression.trim()) {
          errors.push(`节点 "${node.id}" 为 from_metric_formula 模式时必须指定 formulaExpression`);
        } else {
          const check = validateFormula(mc.formulaExpression);
          if (!check.valid) {
            errors.push(`节点 "${node.id}" 公式语法错误: ${check.errors.join('; ')}`);
          }
        }
      }
    }
  }

  // 检查边唯一性、强隔离与悬空边
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (!edge || typeof edge !== 'object') {
      errors.push('存在无效的空连线对象');
      continue;
    }
    if (edge.id) {
      if (edgeIds.has(edge.id)) {
        errors.push(`存在重复的连线 ID: ${edge.id}`);
      } else {
        edgeIds.add(edge.id);
      }
    }
    if (edge.weight !== undefined) {
      errors.push(
        `二库指标画布强隔离违规：连线 "${edge.id || `${edge.sourceNodeId}->${edge.targetNodeId}`}" 不允许配置主观权重 weight (当前=${String(edge.weight)})`,
      );
    }
    checkForbiddenSubjectiveProps(edge, `连线 "${edge.id || edge.sourceNodeId}"`, errors);

    if (incomingByTarget.has(edge.targetNodeId)) {
      incomingByTarget.get(edge.targetNodeId)!.push(edge);
    }
  }

  // 节点级入边校验
  for (const node of nodes) {
    if (!node?.id || !node.metricConfig) continue;
    const incoming = incomingByTarget.get(node.id) ?? [];
    if (node.metricConfig.mode === 'from_operator' && incoming.length > 0) {
      warnings.push(
        `节点 "${node.id}" 为 from_operator 模式，通常不依赖其他指标节点入边（当前有 ${incoming.length} 条入边）`,
      );
    }
  }

  // 判环与拓扑排序
  const cycleRes = detectCycles(nodes, edges);
  for (const missingRef of cycleRes.missingEdgeRefs) {
    errors.push(`悬空连线引用: ${missingRef}`);
  }
  if (cycleRes.hasCycle) {
    errors.push(`检测到指标 DAG 存在有向环路，涉及节点: ${cycleRes.cycleNodeIds.join(', ')}`);
  }

  let topologicalOrder: string[] = [];
  if (!cycleRes.hasCycle && cycleRes.missingEdgeRefs.length === 0 && errors.length === 0) {
    topologicalOrder = topologicalSort(nodes, edges);
  } else if (!cycleRes.hasCycle && cycleRes.missingEdgeRefs.length === 0) {
    try {
      topologicalOrder = topologicalSort(nodes, edges);
    } catch {
      topologicalOrder = [];
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    topologicalOrder,
    hasCycle: cycleRes.hasCycle,
    cycleNodeIds: cycleRes.cycleNodeIds,
    missingEdgeRefs: cycleRes.missingEdgeRefs,
  };
}

// ──────────────────── 持久化存储 MetricGraphStore ────────────────────

export class MetricGraphStore {
  private readonly filePath: string;
  private builtins: StoredMetricGraphDefinition[] = [];
  private custom: Map<string, StoredMetricGraphDefinition> = new Map();

  constructor(
    filePath = DEFAULT_METRIC_GRAPHS_PATH,
    options?: { includeBuiltins?: boolean },
  ) {
    this.filePath = filePath;
    if (options?.includeBuiltins !== false) {
      this.builtins = BUILTIN_METRIC_GRAPHS.map((g) => structuredClone(g));
    }
    this.load();
  }

  private load(): void {
    this.custom.clear();
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as StoredMetricGraphDefinition[];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.graphId) {
            this.custom.set(item.graphId, { ...item, builtin: false });
          }
        }
      }
    } catch {
      this.custom.clear();
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const list = [...this.custom.values()];
      fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch {
      // 兼容只读文件系统或测试沙箱路径
    }
  }

  validate(graph: MetricGraphDefinition): MetricGraphValidationResult {
    return validateMetricGraph(graph);
  }

  listAll(): StoredMetricGraphDefinition[] {
    const byId = new Map<string, StoredMetricGraphDefinition>();
    for (const b of this.builtins) byId.set(b.graphId, structuredClone(b));
    for (const c of this.custom.values()) byId.set(c.graphId, structuredClone(c));
    return [...byId.values()];
  }

  get(graphId: string): StoredMetricGraphDefinition | undefined {
    const found =
      this.custom.get(graphId) ?? this.builtins.find((b) => b.graphId === graphId);
    return found ? structuredClone(found) : undefined;
  }

  upsert(graph: MetricGraphDefinition): StoredMetricGraphDefinition {
    const validation = this.validate(graph);
    if (!validation.valid) {
      throw new Error(`指标 DAG 校验失败: ${validation.errors.join('; ')}`);
    }
    const now = new Date().toISOString();
    const existing = this.custom.get(graph.graphId);
    const clean: StoredMetricGraphDefinition = {
      ...structuredClone(graph),
      graphKind: 'metric',
      builtin: false,
      createdAt: existing?.createdAt ?? graph.createdAt ?? now,
      updatedAt: now,
    };
    this.custom.set(clean.graphId, clean);
    this.persist();
    return structuredClone(clean);
  }

  delete(graphId: string): boolean {
    const isBuiltinOnly =
      this.builtins.some((b) => b.graphId === graphId) && !this.custom.has(graphId);
    if (isBuiltinOnly) {
      throw new Error(`不允许删除内置预置指标 DAG: ${graphId}`);
    }
    const deleted = this.custom.delete(graphId);
    if (deleted) {
      this.persist();
    }
    return deleted;
  }
}

export const defaultMetricGraphStore = new MetricGraphStore();

// ──────────────────── 数据集过滤 / 分组聚合 / 归约工具 ────────────────────

function valuesMatch(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (actual === null || actual === undefined || expected === null || expected === undefined) {
    return false;
  }
  if (typeof actual === 'number' && typeof expected === 'number') {
    return Math.abs(actual - expected) < 1e-9;
  }
  if (typeof actual === 'boolean' && typeof expected === 'boolean') {
    return actual === expected;
  }
  return String(actual).trim().toLowerCase() === String(expected).trim().toLowerCase();
}

function getDatasetColumns(dataset: TableDataset): DatasetColumn[] {
  if (Array.isArray(dataset.columns) && dataset.columns.length > 0) {
    return dataset.columns;
  }
  if (Array.isArray(dataset.schema) && dataset.schema.length > 0) {
    return dataset.schema as DatasetColumn[];
  }
  const rows = dataset.rows ?? [];
  if (rows.length === 0) return [];
  return Object.entries(rows[0]).map(([name, val]) => ({
    name,
    type:
      typeof val === 'number'
        ? 'number'
        : typeof val === 'boolean'
          ? 'boolean'
          : 'string',
  }));
}

function toFiniteNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  const trimmed = String(val).trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function filterDatasetRows(
  dataset: TableDataset,
  filterCriteria?: Record<string, unknown>,
): { ok: true; dataset: TableDataset } | { ok: false; reason: string } {
  const cols = getDatasetColumns(dataset);
  const rows = Array.isArray(dataset.rows) ? dataset.rows : [];
  if (!filterCriteria || Object.keys(filterCriteria).length === 0) {
    return {
      ok: true,
      dataset: {
        ...dataset,
        columns: cols,
        rows,
        totalRows: rows.length,
      },
    };
  }

  const activeEntries = Object.entries(filterCriteria).filter(([, v]) => v !== undefined);
  if (activeEntries.length === 0) {
    return {
      ok: true,
      dataset: {
        ...dataset,
        columns: cols,
        rows,
        totalRows: rows.length,
      },
    };
  }

  const filteredRows = rows.filter((row) =>
    activeEntries.every(([k, expected]) => {
      const actual = row[k];
      if (actual === undefined || actual === null) return false;
      if (Array.isArray(expected)) {
        return expected.some((candidate) => valuesMatch(actual, candidate));
      }
      return valuesMatch(actual, expected);
    }),
  );

  if (filteredRows.length === 0) {
    return {
      ok: false,
      reason: `按过滤条件 ${JSON.stringify(filterCriteria)} 切片未命中任何记录`,
    };
  }

  return {
    ok: true,
    dataset: {
      ...dataset,
      columns: cols,
      rows: filteredRows,
      totalRows: filteredRows.length,
    },
  };
}

function reduceColumnValues(
  rows: Array<Record<string, unknown>>,
  fieldName: string,
  method: IndicatorReduceMethod = 'first',
): number | boolean | null {
  const colVals = rows.map((r) => r[fieldName]).filter((v) => v !== undefined && v !== null);
  if (colVals.length === 0) return null;

  if (method === 'first' && typeof colVals[0] === 'boolean') {
    return colVals[0];
  }
  if (method === 'last' && typeof colVals[colVals.length - 1] === 'boolean') {
    return colVals[colVals.length - 1] as boolean;
  }

  const nums = colVals
    .map(toFiniteNumber)
    .filter((n): n is number => n !== null);
  return reduceNumericArray(nums, method);
}

function inferNumericMeasureColumns(dataset: TableDataset, excludeKeys: Set<string>): string[] {
  const cols = getDatasetColumns(dataset);
  const measures: string[] = [];

  if (dataset.measureKeys && dataset.measureKeys.length > 0) {
    for (const m of dataset.measureKeys) {
      if (!excludeKeys.has(m)) measures.push(m);
    }
    if (measures.length > 0) return measures;
  }

  for (const c of cols) {
    if (!excludeKeys.has(c.name) && (c.type === 'number' || c.type === 'boolean')) {
      measures.push(c.name);
    }
  }
  if (measures.length > 0) return measures;

  const firstRow = dataset.rows[0];
  if (firstRow) {
    for (const [k, v] of Object.entries(firstRow)) {
      if (!excludeKeys.has(k) && (typeof v === 'number' || typeof v === 'boolean')) {
        measures.push(k);
      }
    }
  }
  return measures;
}

function groupAggregateDataset(
  dataset: TableDataset,
  groupBy: string[],
  targetField?: string,
  reduce: IndicatorReduceMethod = 'mean',
): { ok: true; dataset: TableDataset; scalarValue?: number | boolean | null } | { ok: false; reason: string } {
  const cols = getDatasetColumns(dataset);
  const rows = dataset.rows ?? [];
  if (rows.length === 0) {
    return {
      ok: false,
      reason: '上游数据集为空 (0 行)，无法执行分组聚合',
    };
  }
  const colMap = new Map<string, DatasetColumn>(cols.map((c) => [c.name, c]));

  // 检查分组主键列存在性
  for (const key of groupBy) {
    const existsInSchema = colMap.has(key);
    const existsInRows = rows.some((r) => key in r);
    if (!existsInSchema && !existsInRows) {
      return {
        ok: false,
        reason: `分组列 "${key}" 在上游数据集中不存在`,
      };
    }
  }

  const groupKeySet = new Set(groupBy);
  let measureCols: string[] = [];
  if (targetField) {
    const existsInSchema = colMap.has(targetField);
    const existsInRows = rows.some((r) => targetField in r);
    if (!existsInSchema && !existsInRows) {
      return {
        ok: false,
        reason: `目标度量列 "${targetField}" 在上游数据集中不存在`,
      };
    }
    measureCols = [targetField];
  } else {
    measureCols = inferNumericMeasureColumns(dataset, groupKeySet);
  }

  const buckets = new Map<
    string,
    { keyValues: Record<string, unknown>; rows: Array<Record<string, unknown>> }
  >();

  for (const row of rows) {
    const bucketKey = JSON.stringify(groupBy.map((k) => row[k] ?? null));
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      const keyValues: Record<string, unknown> = {};
      for (const k of groupBy) {
        keyValues[k] = row[k] ?? null;
      }
      bucket = { keyValues, rows: [] };
      buckets.set(bucketKey, bucket);
    }
    bucket.rows.push(row);
  }

  const rawOutRows: Array<Record<string, unknown>> = [];
  const effectiveMeasures = measureCols.length > 0 ? measureCols : ['row_count'];

  for (const bucket of buckets.values()) {
    const outRow: Record<string, unknown> = { ...bucket.keyValues };
    if (measureCols.length === 0) {
      outRow.row_count = bucket.rows.length;
    } else {
      for (const mCol of measureCols) {
        outRow[mCol] = reduceColumnValues(bucket.rows, mCol, reduce);
      }
    }
    rawOutRows.push(outRow);
  }

  const outRows = targetField
    ? rawOutRows.filter((r) => r[targetField] !== null && r[targetField] !== undefined)
    : rawOutRows;

  if (outRows.length === 0) {
    return {
      ok: false,
      reason: `分组聚合后目标字段 "${targetField ?? effectiveMeasures[0]}" 无有效数值`,
    };
  }

  const outColumns: DatasetColumn[] = [
    ...groupBy.map((k): DatasetColumn => {
      const src = colMap.get(k);
      return {
        name: k,
        type: (src?.type ?? 'string') as FieldDataType,
        description: src?.description ?? `分组主键: ${k}`,
      };
    }),
    ...effectiveMeasures.map((m): DatasetColumn => ({
      name: m,
      type: 'number',
      isDerived: true,
      description: `${reduce}(${m})`,
    })),
  ];

  const outDataset: TableDataset = {
    id: dataset.id,
    columns: outColumns,
    schema: outColumns,
    rows: outRows,
    totalRows: outRows.length,
    dimensionKeys: [...groupBy],
    measureKeys: effectiveMeasures,
  };

  let scalarValue: number | boolean | null | undefined;
  if (effectiveMeasures.length === 1) {
    if (outRows.length === 1) {
      const v = outRows[0][effectiveMeasures[0]];
      if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
        scalarValue = v;
      }
    } else {
      const reducedAll = reduceColumnValues(outRows, effectiveMeasures[0], reduce);
      if (reducedAll !== null) {
        scalarValue = reducedAll;
      }
    }
  }

  return { ok: true, dataset: outDataset, scalarValue };
}

function mergeUpstreamDatasets(
  datasets: TableDataset[],
): TableDataset | undefined {
  if (datasets.length === 0) return undefined;
  if (datasets.length === 1) {
    const cols = getDatasetColumns(datasets[0]);
    return {
      ...datasets[0],
      columns: cols,
      rows: datasets[0].rows.map((r) => ({ ...r })),
      totalRows: datasets[0].rows.length,
    };
  }
  const colMap = new Map<string, DatasetColumn>();
  const rows: Array<Record<string, unknown>> = [];
  for (const ds of datasets) {
    for (const c of getDatasetColumns(ds)) {
      if (!colMap.has(c.name)) colMap.set(c.name, c);
    }
    for (const r of ds.rows ?? []) {
      rows.push({ ...r });
    }
  }
  const cols = [...colMap.values()];
  return {
    columns: cols,
    schema: cols,
    rows,
    totalRows: rows.length,
    dimensionKeys: datasets[0].dimensionKeys,
    measureKeys: datasets[0].measureKeys,
  };
}

function mergeEvidenceRefs(groups: EvidenceRef[][]): EvidenceRef[] {
  const seen = new Set<string>();
  const merged: EvidenceRef[] = [];
  for (const list of groups) {
    for (const ref of list) {
      const key = `${ref.source}|${String(ref.ref)}|${ref.scenarioClock}|${ref.description}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(ref);
      }
    }
  }
  return merged;
}

function resolveEffectiveMetricConfig(node: MetricGraphNode): MetricNodeConfig {
  if (node.metricConfig) return node.metricConfig;
  return {
    metricId: node.id,
    name: node.label || node.id,
    militaryLevel: 'MOP',
    domainTag: 'firepower',
    mode: 'from_operator',
    sourceRef: typeof node.params?.sourceRef === 'string' ? node.params.sourceRef : node.id,
  };
}

function applyDatasetPipeline(
  baseDataset: TableDataset | undefined,
  baseValue: number | boolean | null | undefined,
  baseStatus: 'valid' | 'degraded',
  mc: MetricNodeConfig,
  evidenceRefs: EvidenceRef[],
): DagNodeExecutionOutput {
  if (baseDataset) {
    const filtered = filterDatasetRows(baseDataset, mc.filterCriteria);
    if (!filtered.ok) {
      return {
        status: 'unavailable',
        value: null,
        evidenceRefs,
        missingDataReason: `指标 [${mc.metricId}] ${filtered.reason}`,
      };
    }

    const workingDataset = filtered.dataset;
    const hasGroupBy = Array.isArray(mc.groupBy) && mc.groupBy.length > 0;

    if (hasGroupBy) {
      const grouped = groupAggregateDataset(
        workingDataset,
        mc.groupBy!,
        mc.targetField,
        mc.reduce ?? 'mean',
      );
      if (!grouped.ok) {
        return {
          status: 'unavailable',
          value: null,
          evidenceRefs,
          missingDataReason: `指标 [${mc.metricId}] ${grouped.reason}`,
        };
      }
      return {
        status: baseStatus,
        dataset: grouped.dataset,
        ...(grouped.scalarValue !== undefined ? { value: grouped.scalarValue } : {}),
        evidenceRefs,
      };
    }

    if (mc.targetField) {
      if (workingDataset.rows.length === 0) {
        return {
          status: 'unavailable',
          value: null,
          evidenceRefs,
          missingDataReason: `指标 [${mc.metricId}] 数据集为空 (0 行)，无法提取字段 [${mc.targetField}]`,
        };
      }
      const reduced = reduceColumnValues(
        workingDataset.rows,
        mc.targetField,
        mc.reduce ?? 'first',
      );
      if (reduced === null) {
        return {
          status: 'unavailable',
          value: null,
          evidenceRefs,
          missingDataReason: `指标 [${mc.metricId}] 目标字段 [${mc.targetField}] 无有效数值`,
        };
      }
      return {
        status: baseStatus,
        dataset: workingDataset,
        value: reduced,
        evidenceRefs,
      };
    }

    // 未指定 groupBy 与 targetField：保留完整数据集，同时若存在单行单度量或透传标量则同步输出 value
    let inferredValue: number | boolean | null | undefined;
    if (
      baseValue !== undefined &&
      baseValue !== null &&
      (!mc.filterCriteria || Object.keys(mc.filterCriteria).length === 0)
    ) {
      inferredValue = baseValue;
    } else if (workingDataset.rows.length === 1) {
      const measures = inferNumericMeasureColumns(
        workingDataset,
        new Set(workingDataset.dimensionKeys ?? []),
      );
      if (measures.length === 1) {
        const raw = workingDataset.rows[0][measures[0]];
        if (typeof raw === 'number' && Number.isFinite(raw)) inferredValue = raw;
        else if (typeof raw === 'boolean') inferredValue = raw;
      }
    }

    return {
      status: baseStatus,
      dataset: workingDataset,
      ...(inferredValue !== undefined ? { value: inferredValue } : {}),
      evidenceRefs,
    };
  }

  // 纯标量输入（无 TableDataset）
  if (mc.filterCriteria && Object.keys(mc.filterCriteria).length > 0) {
    return {
      status: 'unavailable',
      value: null,
      evidenceRefs,
      missingDataReason: `指标 [${mc.metricId}] 配置了行级 filterCriteria 但上游未提供 TableDataset`,
    };
  }
  if (mc.groupBy && mc.groupBy.length > 0) {
    return {
      status: 'unavailable',
      value: null,
      evidenceRefs,
      missingDataReason: `指标 [${mc.metricId}] 配置了 groupBy 分组聚合但上游未提供 TableDataset`,
    };
  }
  if (baseValue === undefined || baseValue === null) {
    return {
      status: 'unavailable',
      value: null,
      evidenceRefs,
      missingDataReason: `指标 [${mc.metricId}] 上游输出既无 TableDataset 也无标量 value`,
    };
  }

  return {
    status: baseStatus,
    value: baseValue,
    evidenceRefs,
  };
}

function computeOperatorInputDigest(opRes: MetricOperatorInput | undefined): string {
  if (!opRes) return 'MISSING_OP_RESULT';
  if (opRes.cacheKey && !opRes.dataset && opRes.value === undefined) {
    return `ck:${opRes.cacheKey}:${opRes.status}`;
  }
  const canonical = canonicalJsonStringify({
    status: opRes.status,
    value: opRes.value ?? null,
    dataset: opRes.dataset ?? null,
    missingDataReason: opRes.missingDataReason ?? null,
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
}

// ──────────────────── 二库指标 DAG 执行引擎 ────────────────────

export async function evaluateMetricGraph(
  graph: MetricGraphDefinition,
  operatorResults: Record<string, MetricOperatorInput>,
  options?: EvaluateMetricGraphOptions,
): Promise<MetricGraphExecutionResult> {
  if (!graph || graph.graphKind !== 'metric') {
    throw new Error(`evaluateMetricGraph 仅允许执行 graphKind === "metric" 的指标图`);
  }

  const validation = validateMetricGraph(graph);
  if (!validation.valid) {
    throw new Error(`指标 DAG "${graph.graphId}" 校验未通过: ${validation.errors.join('; ')}`);
  }

  const runId = options?.runId ?? 'run-unknown';
  const nodeById = new Map<string, MetricGraphNode>();
  for (const n of graph.nodes) {
    nodeById.set(n.id, n);
  }

  // 解析按 nodeId / metricId / sourceRef 传入的参数覆盖
  const nodeParamOverrides: Record<string, Record<string, unknown>> = {};
  if (options?.paramOverrides) {
    for (const node of graph.nodes) {
      const mc = node.metricConfig;
      const merged: Record<string, unknown> = {};
      if (mc?.sourceRef && options.paramOverrides[mc.sourceRef]) {
        Object.assign(merged, options.paramOverrides[mc.sourceRef]);
      }
      if (mc?.metricId && options.paramOverrides[mc.metricId]) {
        Object.assign(merged, options.paramOverrides[mc.metricId]);
      }
      if (options.paramOverrides[node.id]) {
        Object.assign(merged, options.paramOverrides[node.id]);
      }
      if (Object.keys(merged).length > 0) {
        nodeParamOverrides[node.id] = merged;
      }
    }
  }

  // 为 from_operator 节点注入上游算子内容指纹（不修改入参对象），确保 operatorResults 变动时缓存精确失效
  const runtimeGraph: MetricGraphDefinition = {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const mc = resolveEffectiveMetricConfig(node);
      if (mc.mode !== 'from_operator') return { ...node };
      const sourceOpId = mc.sourceRef || node.id;
      const opRes =
        operatorResults[`__node__:${node.id}`] ??
        operatorResults[sourceOpId];
      const digest = computeOperatorInputDigest(opRes);
      return {
        ...node,
        _upstreamOperatorDigest: digest,
      } as MetricGraphNode;
    }),
  };

  const execResult = await executeDagGraph<MetricGraphNode>(runtimeGraph, {
    runId,
    cache: options?.cache,
    paramOverrides: nodeParamOverrides,
    globalParamOverrides: options?.globalParamOverrides,
    executor: async (ctx): Promise<DagNodeExecutionOutput> => {
      const mc = resolveEffectiveMetricConfig(ctx.node);

      // ── 模式 1: from_operator ──
      if (mc.mode === 'from_operator') {
        const sourceOpId = mc.sourceRef || ctx.node.id;
        const opRes =
          operatorResults[`__node__:${ctx.node.id}`] ??
          operatorResults[sourceOpId];
        if (!opRes || opRes.status === 'unavailable') {
          return {
            status: 'unavailable',
            value: null,
            evidenceRefs: opRes?.evidenceRefs ?? [],
            missingDataReason:
              opRes?.missingDataReason ||
              `缺少上游算子 [${sourceOpId}] 实证计算结果`,
          };
        }

        const baseStatus: 'valid' | 'degraded' =
          opRes.status === 'degraded' ? 'degraded' : 'valid';
        return applyDatasetPipeline(
          opRes.dataset,
          opRes.value,
          baseStatus,
          mc,
          opRes.evidenceRefs ?? [],
        );
      }

      // ── 模式 2: from_metric_agg ──
      if (mc.mode === 'from_metric_agg') {
        let selectedSources: Array<typeof ctx.upstreamResults[string]> = [];

        if (mc.sourceRef) {
          const directById = ctx.upstreamResults[mc.sourceRef];
          if (directById) {
            selectedSources = [directById];
          } else {
            for (const edge of ctx.upstreamEdges) {
              const upNode = nodeById.get(edge.sourceNodeId);
              if (
                edge.targetAlias === mc.sourceRef ||
                upNode?.metricConfig?.metricId === mc.sourceRef
              ) {
                const res = ctx.upstreamResults[edge.sourceNodeId];
                if (res) selectedSources.push(res);
              }
            }
          }
        } else {
          selectedSources = ctx.upstreamEdges
            .map((e) => ctx.upstreamResults[e.sourceNodeId])
            .filter((r): r is NonNullable<typeof r> => Boolean(r));
        }

        if (selectedSources.length === 0) {
          return {
            status: 'unavailable',
            value: null,
            evidenceRefs: [],
            missingDataReason: `二次聚合指标 [${mc.metricId}] 未连接可用的上游指标节点 (${mc.sourceRef ?? '无入边'})`,
          };
        }

        const hasDegraded = selectedSources.some((s) => s.status === 'degraded');
        const evidenceRefs = mergeEvidenceRefs(selectedSources.map((s) => s.evidenceRefs ?? []));
        const datasets = selectedSources
          .map((s) => s.dataset)
          .filter((ds): ds is TableDataset => Boolean(ds));

        const mergedDataset = mergeUpstreamDatasets(datasets);
        const fallbackValue =
          selectedSources.length === 1 ? selectedSources[0].value : undefined;

        return applyDatasetPipeline(
          mergedDataset,
          fallbackValue,
          hasDegraded ? 'degraded' : 'valid',
          mc,
          evidenceRefs,
        );
      }

      // ── 模式 3: from_metric_formula ──
      if (!mc.formulaExpression || !mc.formulaExpression.trim()) {
        return {
          status: 'unavailable',
          value: null,
          evidenceRefs: [],
          missingDataReason: `复合指标 [${mc.metricId}] 未配置 formulaExpression`,
        };
      }

      let referencedVars: Set<string>;
      try {
        referencedVars = extractVariableReferences(parseFormulaAST(mc.formulaExpression));
      } catch (err) {
        return {
          status: 'unavailable',
          value: null,
          evidenceRefs: [],
          missingDataReason: err instanceof Error ? err.message : String(err),
        };
      }

      const vars: Record<string, number> = {};
      const unavailableReasons = new Map<string, string>();
      const evidenceGroups: EvidenceRef[][] = [];
      let hasDegradedUpstream = false;

      // 允许从节点解析后的参数注入数值常数
      for (const [paramKey, paramVal] of Object.entries(ctx.resolvedParams)) {
        const num = toFiniteNumber(paramVal);
        if (num !== null) {
          vars[paramKey] = num;
        }
      }

      for (const edge of ctx.upstreamEdges) {
        const srcId = edge.sourceNodeId;
        const srcNode = nodeById.get(srcId);
        const srcRes = ctx.upstreamResults[srcId];
        const srcMetricId = srcNode?.metricConfig?.metricId;

        const aliasKeys = [srcId];
        if (srcMetricId) aliasKeys.push(srcMetricId);
        if (edge.targetAlias) aliasKeys.push(edge.targetAlias);

        if (!srcRes || srcRes.status === 'unavailable') {
          const reason =
            srcRes?.missingDataReason || `上游指标节点 "${srcId}" 数据不可用`;
          for (const k of aliasKeys) {
            unavailableReasons.set(k.toUpperCase(), reason);
          }
          continue;
        }

        if (srcRes.status === 'degraded') hasDegradedUpstream = true;
        if (srcRes.evidenceRefs?.length) evidenceGroups.push(srcRes.evidenceRefs);

        let scalarNum: number | null = null;
        if (typeof srcRes.value === 'number' && Number.isFinite(srcRes.value)) {
          scalarNum = srcRes.value;
        } else if (typeof srcRes.value === 'boolean') {
          scalarNum = srcRes.value ? 1 : 0;
        } else if (srcRes.dataset && srcRes.dataset.rows.length > 0) {
          const candidateField =
            srcNode?.metricConfig?.targetField ??
            mc.targetField ??
            inferNumericMeasureColumns(
              srcRes.dataset,
              new Set(srcRes.dataset.dimensionKeys ?? []),
            )[0];
          if (candidateField) {
            const reduced = reduceColumnValues(
              srcRes.dataset.rows,
              candidateField,
              mc.reduce ?? srcNode?.metricConfig?.reduce ?? 'first',
            );
            scalarNum = toFiniteNumber(reduced);
          }
        }

        if (scalarNum === null) {
          const reason = `上游指标 "${edge.targetAlias || srcMetricId || srcId}" 无法提取有效标量数值`;
          for (const k of aliasKeys) {
            unavailableReasons.set(k.toUpperCase(), reason);
          }
          continue;
        }

        for (const k of aliasKeys) {
          vars[k] = scalarNum;
        }
      }

      const mergedEvidence = mergeEvidenceRefs(evidenceGroups);

      // Fail-Closed：检查公式引用的所有变量是否有任意上游不可用
      for (const refVar of referencedVars) {
        const unavailReason = unavailableReasons.get(refVar.toUpperCase());
        if (unavailReason) {
          return {
            status: 'unavailable',
            value: null,
            evidenceRefs: mergedEvidence,
            missingDataReason: `复合指标 [${mc.metricId}] 依赖变量 "${refVar}" 不可用: ${unavailReason}`,
          };
        }
      }

      const evalRes = evaluateFormulaExpression(mc.formulaExpression, vars);
      if (!evalRes.ok) {
        return {
          status: 'unavailable',
          value: null,
          evidenceRefs: mergedEvidence,
          missingDataReason: `复合指标 [${mc.metricId}] 公式 "${mc.formulaExpression}" 计算失败: ${evalRes.reason}`,
        };
      }

      const summaryDataset: TableDataset = {
        id: mc.metricId,
        columns: [
          { name: 'metricId', type: 'string', description: '指标标识' },
          {
            name: mc.metricId,
            type: 'number',
            isDerived: true,
            description: mc.name,
          },
        ],
        rows: [{ metricId: mc.metricId, [mc.metricId]: evalRes.value }],
        totalRows: 1,
        dimensionKeys: ['metricId'],
        measureKeys: [mc.metricId],
      };

      return {
        status: hasDegradedUpstream ? 'degraded' : 'valid',
        value: evalRes.value,
        dataset: summaryDataset,
        evidenceRefs: mergedEvidence,
      };
    },
  });

  // 组装供三库 evaluateSystemDag 直接消费的 SystemDagEvaluationInputs 映射（同时索引 nodeId 与 metricId）
  const metricInputsForSystem: SystemDagEvaluationInputs = {};
  const metricNodeIdByMetricId: Record<string, string> = {};

  for (const nodeId of execResult.topologicalOrder) {
    const node = nodeById.get(nodeId);
    const res = execResult.nodeResults[nodeId];
    if (!res) continue;

    const entry: SystemDagMetricInput = {
      status: res.status,
      ...(res.value !== undefined ? { value: res.value } : {}),
      ...(res.dataset !== undefined ? { dataset: res.dataset } : {}),
      evidenceRefs: res.evidenceRefs,
      ...(res.missingDataReason !== undefined
        ? { missingDataReason: res.missingDataReason }
        : {}),
    };

    metricInputsForSystem[nodeId] = entry;
    const metricId = node?.metricConfig?.metricId;
    if (metricId) {
      metricInputsForSystem[metricId] = entry;
      metricNodeIdByMetricId[metricId] = nodeId;
    }
  }

  return {
    ...execResult,
    metricInputsForSystem,
    metricNodeIdByMetricId,
  };
}
