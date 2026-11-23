import fs from 'node:fs';
import path from 'node:path';
import type { EvaluationSystemDag } from '../core/types.ts';
import { defaultEffectStore, type EffectStore } from '../effects/store.ts';
import {
  normalizeIncomingWeights,
  validateSystemDag,
  type SystemDagValidationResult,
} from './dag-evaluator.ts';

const DEFAULT_SYSTEM_DAGS_PATH = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'data',
  'v4-system-dags.json',
);

export type StoredEvaluationSystemDag = EvaluationSystemDag & {
  builtin?: boolean;
  metricGraphId?: string;
  createdAt?: string;
  updatedAt?: string;
};

// ──────────────────── 内置多层级体系 DAG 示范预设 ────────────────────

const BUILTIN_SYSTEM_DAGS: StoredEvaluationSystemDag[] = [
  {
    systemId: 'sys_v4_metrics_guide_full',
    name: '推演评估指标指南全体系评估 DAG (8大类效果叠加与双轨门控)',
    version: '4.0.0',
    description:
      '完整覆盖 metrics_calculation_guide.html 第 1~8 章：客观指标代理 -> 叶子效果(含物理达标参数透传) -> 四大领域复合效果 -> 终态综合效能，严格满足局部入边权重和 Σ=1.0000 并挂载战损崩溃一票否决硬红线与防空漏洞预警软门控',
    builtin: true,
    metricGraphId: 'mg_v4_metrics_guide_full',
    terminalEffectNodeId: 'ef_mg_terminal_overall',
    globalParams: {
      targetSide: '红方',
      enemySide: '蓝方',
    },
    nodes: [
      // ── L0: 二库客观指标代理节点 (metric_proxy) ──
      {
        id: 'px_strike',
        kind: 'metric_proxy',
        label: '突击任务平均完成率',
        refId: 'strike.composite_mission_metrics',
        position: { x: 60, y: 60 },
      },
      {
        id: 'px_patrol',
        kind: 'metric_proxy',
        label: '巡逻掩护平均完成率',
        refId: 'patrol.composite_mission_metrics',
        position: { x: 60, y: 160 },
      },
      {
        id: 'px_support',
        kind: 'metric_proxy',
        label: '支援保障平均完成率',
        refId: 'support.composite_mission_metrics',
        position: { x: 60, y: 260 },
      },
      {
        id: 'px_detection',
        kind: 'metric_proxy',
        label: '雷达装备型号首次发现距离',
        refId: 'detection.model_detection',
        position: { x: 60, y: 360 },
      },
      {
        id: 'px_killchain',
        kind: 'metric_proxy',
        label: '杀伤链闭环平均耗时',
        refId: 'fire_control.kill_chain_closure_time',
        position: { x: 60, y: 460 },
      },
      {
        id: 'px_weapon',
        kind: 'metric_proxy',
        label: '主战武器平均命中率',
        refId: 'weapon.munition_hit_rate',
        position: { x: 60, y: 560 },
      },
      {
        id: 'px_cost_exchange',
        kind: 'metric_proxy',
        label: '分方有效生存战损交换比',
        refId: 'cost.effective_exchange_ratio',
        position: { x: 60, y: 660 },
      },
      {
        id: 'px_cost_survival',
        kind: 'metric_proxy',
        label: '平台生存率',
        refId: 'cost.side_attrition_metrics',
        position: { x: 60, y: 760 },
      },
      {
        id: 'px_cost_attrition',
        kind: 'metric_proxy',
        label: '平台战损率 (红线输入)',
        refId: 'cost.side_attrition_rate',
        position: { x: 60, y: 860 },
      },
      {
        id: 'px_recon',
        kind: 'metric_proxy',
        label: '主战侦察平台侦察范围',
        refId: 'isr.reconnaissance_range',
        position: { x: 60, y: 960 },
      },
      {
        id: 'px_c2',
        kind: 'metric_proxy',
        label: '战场态势完整度',
        refId: 'c2.situational_completeness',
        position: { x: 60, y: 1060 },
      },
      {
        id: 'px_ew',
        kind: 'metric_proxy',
        label: '持续有效干扰时间',
        refId: 'ew.jamming_duration',
        position: { x: 60, y: 1160 },
      },
      {
        id: 'px_ad',
        kind: 'metric_proxy',
        label: '综合拦截概率',
        refId: 'air_defense.composite_interception_probability',
        position: { x: 60, y: 1260 },
      },

      // ── L1: 叶子效果节点（引用 EffectStore 独立效果库，透传达标阈值） ──
      {
        id: 'ef_strike',
        kind: 'effect',
        label: '对地/海突击达成效果',
        refId: 'eff_strike_mission',
        position: { x: 380, y: 60 },
      },
      {
        id: 'ef_patrol',
        kind: 'effect',
        label: '空中巡逻掩护效果',
        refId: 'eff_patrol_coverage',
        position: { x: 380, y: 160 },
      },
      {
        id: 'ef_support',
        kind: 'effect',
        label: '空中支援保障效果',
        refId: 'eff_support_mission',
        position: { x: 380, y: 260 },
      },
      {
        id: 'ef_detection',
        kind: 'effect',
        label: '装备雷达探测效能',
        refId: 'eff_equipment_detection',
        position: { x: 380, y: 360 },
      },
      {
        id: 'ef_killchain',
        kind: 'effect',
        label: '杀伤链闭环协同敏捷度',
        refId: 'eff_kill_chain_synergy',
        position: { x: 380, y: 460 },
      },
      {
        id: 'ef_weapon',
        kind: 'effect',
        label: '主战武器打击命中效果',
        refId: 'eff_weapon_striking',
        position: { x: 380, y: 560 },
      },
      {
        id: 'ef_cost_exchange',
        kind: 'effect',
        label: '作战效费交换效果',
        refId: 'eff_cost_exchange',
        position: { x: 380, y: 660 },
      },
      {
        id: 'ef_cost_survival',
        kind: 'effect',
        label: '兵力生存损耗抑制效果',
        refId: 'eff_survivability_cost',
        position: { x: 380, y: 760 },
      },
      {
        id: 'ef_recon',
        kind: 'effect',
        label: '侦察平台有效探测距离效果',
        refId: 'eff_isr_recon_range',
        position: { x: 380, y: 960 },
      },
      {
        id: 'ef_c2',
        kind: 'effect',
        label: '指挥控制态势完整效果',
        refId: 'eff_c2_decision_tempo',
        position: { x: 380, y: 1060 },
      },
      {
        id: 'ef_ew',
        kind: 'effect',
        label: '电子压制累计受扰秒数效果',
        refId: 'eff_ew_jamming_duration',
        position: { x: 380, y: 1160 },
      },
      {
        id: 'ef_ad',
        kind: 'effect',
        label: '防空反导拦截保护效果',
        refId: 'eff_air_defense_interception',
        position: { x: 380, y: 1260 },
      },

      // ── 红线门控节点 (Hard / Soft GATE) ──
      {
        id: 'gt_attrition_hard',
        kind: 'gate',
        label: '战损崩溃硬红线门控',
        refId: 'gate_excessive_attrition',
        position: { x: 380, y: 860 },
      },
      {
        id: 'gt_interception_soft',
        kind: 'gate',
        label: '防空漏洞预警软门控',
        refId: 'gate_interception_warning',
        position: { x: 380, y: 1360 },
      },

      // ── L2: 4 大领域复合效果节点 (局部入边权重 Σ=1.0000) ──
      {
        id: 'ef_firepower_composite',
        kind: 'effect',
        label: '火力打击与拦截对抗综合效果',
        position: { x: 720, y: 200 },
        inlineEffect: {
          effectId: 'eff_firepower_composite_inline',
          name: '火力打击与拦截对抗综合效果',
          description: '加权融合突击任务达成效果(0.35)、武器打击命中效果(0.35)与防空拦截效果(0.30)',
          domainTag: 'firepower',
          role: 'effect',
          aggregation: {
            strategy: 'weighted_sum',
            missingPolicy: 'skip_renormalize',
          },
        },
      },
      {
        id: 'ef_recon_c2_composite',
        kind: 'effect',
        label: '侦察预警与指控协同效果',
        position: { x: 720, y: 500 },
        inlineEffect: {
          effectId: 'eff_recon_c2_composite_inline',
          name: '侦察预警与指控协同效果',
          description: '加权融合侦察探测距离效果(0.35)、装备雷达探测效能(0.35)与指挥控制态势完整效果(0.30)',
          domainTag: 'isr',
          role: 'effect',
          aggregation: {
            strategy: 'weighted_sum',
            missingPolicy: 'skip_renormalize',
          },
        },
      },
      {
        id: 'ef_survivability_composite',
        kind: 'effect',
        label: '机动生存与电磁攻防效果',
        position: { x: 720, y: 800 },
        inlineEffect: {
          effectId: 'eff_survivability_composite_inline',
          name: '机动生存与电磁攻防效果',
          description: '加权融合巡逻掩护效果(0.35)、电子干扰效果(0.35)与兵力损耗抑制效果(0.30)',
          domainTag: 'survivability',
          role: 'effect',
          aggregation: {
            strategy: 'weighted_sum',
            missingPolicy: 'skip_renormalize',
          },
        },
      },
      {
        id: 'ef_cost_synergy_composite',
        kind: 'effect',
        label: '体系协同与作战效费效果',
        position: { x: 720, y: 1100 },
        inlineEffect: {
          effectId: 'eff_cost_synergy_composite_inline',
          name: '体系协同与作战效费效果',
          description: '加权融合支援保障效果(0.30)、杀伤链协同敏捷度(0.35)与效费交换比效果(0.35)',
          domainTag: 'synergy',
          role: 'effect',
          aggregation: {
            strategy: 'weighted_sum',
            missingPolicy: 'skip_renormalize',
          },
        },
      },

      // ── L3: 终态综合效能节点（terminalEffectNodeId, 局部入边权重 Σ=1.0000） ──
      {
        id: 'ef_mg_terminal_overall',
        kind: 'effect',
        label: '联合作战体系综合效能',
        position: { x: 1060, y: 650 },
        inlineEffect: {
          effectId: 'eff_mg_terminal_overall_inline',
          name: '联合作战体系综合效能',
          description: '融合火力对抗(0.30)、侦察指控(0.25)、机动生存(0.25)与协同效费(0.20)四大维度的最终效能总评分',
          domainTag: 'synergy',
          role: 'effect',
          aggregation: {
            strategy: 'weighted_sum',
            missingPolicy: 'skip_renormalize',
          },
        },
      },
    ],
    edges: [
      // L0 metric_proxy -> L1 leaf effect & gates
      { id: 'se_mg_px_strike', sourceNodeId: 'px_strike', targetNodeId: 'ef_strike' },
      { id: 'se_mg_px_patrol', sourceNodeId: 'px_patrol', targetNodeId: 'ef_patrol' },
      { id: 'se_mg_px_support', sourceNodeId: 'px_support', targetNodeId: 'ef_support' },
      { id: 'se_mg_px_detection', sourceNodeId: 'px_detection', targetNodeId: 'ef_detection' },
      { id: 'se_mg_px_killchain', sourceNodeId: 'px_killchain', targetNodeId: 'ef_killchain' },
      { id: 'se_mg_px_weapon', sourceNodeId: 'px_weapon', targetNodeId: 'ef_weapon' },
      { id: 'se_mg_px_cost_exchange', sourceNodeId: 'px_cost_exchange', targetNodeId: 'ef_cost_exchange' },
      { id: 'se_mg_px_cost_survival', sourceNodeId: 'px_cost_survival', targetNodeId: 'ef_cost_survival' },
      { id: 'se_mg_px_cost_attrition', sourceNodeId: 'px_cost_attrition', targetNodeId: 'gt_attrition_hard' },
      { id: 'se_mg_px_recon', sourceNodeId: 'px_recon', targetNodeId: 'ef_recon' },
      { id: 'se_mg_px_c2', sourceNodeId: 'px_c2', targetNodeId: 'ef_c2' },
      { id: 'se_mg_px_ew', sourceNodeId: 'px_ew', targetNodeId: 'ef_ew' },
      { id: 'se_mg_px_ad', sourceNodeId: 'px_ad', targetNodeId: 'ef_ad' },
      { id: 'se_mg_px_ad_gate', sourceNodeId: 'px_ad', targetNodeId: 'gt_interception_soft' },

      // L1 leaf effects -> L2 domain composite effects (局部入边权重之和 = 1.0000)
      // 火力领域 (0.35 + 0.35 + 0.30 = 1.0000)
      { id: 'se_fp_strike', sourceNodeId: 'ef_strike', targetNodeId: 'ef_firepower_composite', weight: 0.35 },
      { id: 'se_fp_weapon', sourceNodeId: 'ef_weapon', targetNodeId: 'ef_firepower_composite', weight: 0.35 },
      { id: 'se_fp_ad', sourceNodeId: 'ef_ad', targetNodeId: 'ef_firepower_composite', weight: 0.30 },

      // 侦察指控领域 (0.35 + 0.35 + 0.30 = 1.0000)
      { id: 'se_rc_recon', sourceNodeId: 'ef_recon', targetNodeId: 'ef_recon_c2_composite', weight: 0.35 },
      { id: 'se_rc_detection', sourceNodeId: 'ef_detection', targetNodeId: 'ef_recon_c2_composite', weight: 0.35 },
      { id: 'se_rc_c2', sourceNodeId: 'ef_c2', targetNodeId: 'ef_recon_c2_composite', weight: 0.30 },

      // 机动生存领域 (0.35 + 0.35 + 0.30 = 1.0000)
      { id: 'se_sv_patrol', sourceNodeId: 'ef_patrol', targetNodeId: 'ef_survivability_composite', weight: 0.35 },
      { id: 'se_sv_ew', sourceNodeId: 'ef_ew', targetNodeId: 'ef_survivability_composite', weight: 0.35 },
      { id: 'se_sv_survival', sourceNodeId: 'ef_cost_survival', targetNodeId: 'ef_survivability_composite', weight: 0.30 },

      // 协同效费领域 (0.30 + 0.35 + 0.35 = 1.0000)
      { id: 'se_cs_support', sourceNodeId: 'ef_support', targetNodeId: 'ef_cost_synergy_composite', weight: 0.30 },
      { id: 'se_cs_killchain', sourceNodeId: 'ef_killchain', targetNodeId: 'ef_cost_synergy_composite', weight: 0.35 },
      { id: 'se_cs_exchange', sourceNodeId: 'ef_cost_exchange', targetNodeId: 'ef_cost_synergy_composite', weight: 0.35 },

      // L2 domain composite effects -> L3 terminal effect (0.30 + 0.25 + 0.25 + 0.20 = 1.0000)
      { id: 'se_term_fp', sourceNodeId: 'ef_firepower_composite', targetNodeId: 'ef_mg_terminal_overall', weight: 0.30 },
      { id: 'se_term_rc', sourceNodeId: 'ef_recon_c2_composite', targetNodeId: 'ef_mg_terminal_overall', weight: 0.25 },
      { id: 'se_term_sv', sourceNodeId: 'ef_survivability_composite', targetNodeId: 'ef_mg_terminal_overall', weight: 0.25 },
      { id: 'se_term_cs', sourceNodeId: 'ef_cost_synergy_composite', targetNodeId: 'ef_mg_terminal_overall', weight: 0.20 },
    ],
  },
  {
    systemId: 'sys_v4_joint_demo',
    name: '联合空中战役多层级评估体系 DAG (V4 示范)',
    version: '4.0.0',
    description:
      '展示 metric_proxy -> 叶子效果(含行级阈值参数透传) -> 复合制空/协同效果(多策略叠加) -> 终态综合效能 + 双轨 Hard/Soft GATE 红线门控的完整 V4 DAG 结构',
    builtin: true,
    metricGraphId: 'mg_v4_joint_demo',
    terminalEffectNodeId: 'ef_joint_overall',
    globalParams: {
      targetSide: '红方',
      enemySide: '蓝方',
    },
    nodes: [
      // ── L0: 二库客观指标代理节点 (metric_proxy) ──
      {
        id: 'px_strike',
        kind: 'metric_proxy',
        label: '突击任务平均完成率',
        refId: 'strike.composite_mission_metrics',
        position: { x: 60, y: 60 },
      },
      {
        id: 'px_patrol',
        kind: 'metric_proxy',
        label: '巡逻掩护综合达成率',
        refId: 'patrol.composite_mission_metrics',
        position: { x: 60, y: 180 },
      },
      {
        id: 'px_isr',
        kind: 'metric_proxy',
        label: '侦察目标发现率',
        refId: 'isr.detection_rate',
        position: { x: 60, y: 300 },
      },
      {
        id: 'px_c2',
        kind: 'metric_proxy',
        label: '战场态势完整度',
        refId: 'c2.situational_completeness',
        position: { x: 60, y: 420 },
      },
      {
        id: 'px_killchain',
        kind: 'metric_proxy',
        label: '杀伤链闭合平均时长',
        refId: 'fire_control.unit_kill_chain_closure',
        position: { x: 60, y: 540 },
      },
      {
        id: 'px_cost',
        kind: 'metric_proxy',
        label: '敌我战损价值交换比',
        refId: 'cost.side_exchange_ratio',
        position: { x: 60, y: 660 },
      },
      {
        id: 'px_fratricide',
        kind: 'metric_proxy',
        label: '友军误伤事件计数',
        refId: 'roe.fratricide_count',
        position: { x: 60, y: 780 },
      },
      {
        id: 'px_corridor',
        kind: 'metric_proxy',
        label: '航路走廊空间遵从率',
        refId: 'roe.corridor_spatial_compliance',
        position: { x: 60, y: 900 },
      },

      // ── L1: 叶子效果节点（引用 EffectStore 独立效果库，透传物理达标阈值） ──
      {
        id: 'ef_strike',
        kind: 'effect',
        label: '对地/海突击达成效果',
        refId: 'eff_strike_mission',
        position: { x: 380, y: 60 },
      },
      {
        id: 'ef_patrol',
        kind: 'effect',
        label: '空中巡逻掩护效果',
        refId: 'eff_patrol_coverage',
        position: { x: 380, y: 180 },
      },
      {
        id: 'ef_isr',
        kind: 'effect',
        label: '侦察预警态势感知效果',
        refId: 'eff_isr_awareness',
        position: { x: 380, y: 300 },
      },
      {
        id: 'ef_c2',
        kind: 'effect',
        label: '指挥控制态势完整效果',
        refId: 'eff_c2_decision_tempo',
        position: { x: 380, y: 420 },
      },
      {
        id: 'ef_killchain',
        kind: 'effect',
        label: '体系杀伤链闭合敏捷效果',
        refId: 'eff_kill_chain_synergy',
        position: { x: 380, y: 540 },
      },
      {
        id: 'ef_cost',
        kind: 'effect',
        label: '作战效费交换效果',
        refId: 'eff_cost_exchange',
        position: { x: 380, y: 660 },
      },

      // ── 双轨安全红线 GATE 节点（独立红线审计，不稀释效能权重） ──
      {
        id: 'gt_fratricide',
        kind: 'gate',
        label: '误伤零容忍硬门控',
        refId: 'gate_fratricide_zero',
        position: { x: 380, y: 780 },
      },
      {
        id: 'gt_corridor',
        kind: 'gate',
        label: '航路走廊遵从软告警门控',
        refId: 'gate_roe_corridor',
        position: { x: 380, y: 900 },
      },

      // ── L2: 叠加复合效果节点（效果叠效果，局部入边权重 Σ=1.0） ──
      {
        id: 'ef_air_superiority',
        kind: 'effect',
        label: '复合制空突击效果',
        refId: 'eff_air_superiority',
        position: { x: 700, y: 180 },
      },
      {
        id: 'ef_c2_synergy',
        kind: 'effect',
        label: '指通协同短板敏感效果',
        position: { x: 700, y: 480 },
        inlineEffect: {
          effectId: 'eff_c2_synergy_inline',
          name: '指通协同短板敏感效果',
          description: '采用几何平均聚合指挥控制态势完整度与杀伤链闭合敏捷性，突出短板敏感性',
          domainTag: 'c2',
          role: 'effect',
          aggregation: {
            strategy: 'geometric_mean',
            missingPolicy: 'skip_renormalize',
          },
        },
      },

      // ── L3: 终态综合效能节点（terminalEffectNodeId） ──
      {
        id: 'ef_joint_overall',
        kind: 'effect',
        label: '联合作战体系综合效能',
        position: { x: 1020, y: 380 },
        inlineEffect: {
          effectId: 'eff_joint_overall_inline',
          name: '联合作战体系综合效能',
          description: '综合制空突击效果、指通协同效果与效费交换效果的体系级终态综合效能评分',
          domainTag: 'synergy',
          role: 'effect',
          aggregation: {
            strategy: 'weighted_sum',
            missingPolicy: 'skip_renormalize',
          },
        },
      },
    ],
    edges: [
      // L0 metric_proxy -> L1 leaf effect / gate (单数据线，无需权重)
      { id: 'se_px_strike', sourceNodeId: 'px_strike', targetNodeId: 'ef_strike' },
      { id: 'se_px_patrol', sourceNodeId: 'px_patrol', targetNodeId: 'ef_patrol' },
      { id: 'se_px_isr', sourceNodeId: 'px_isr', targetNodeId: 'ef_isr' },
      { id: 'se_px_c2', sourceNodeId: 'px_c2', targetNodeId: 'ef_c2' },
      { id: 'se_px_killchain', sourceNodeId: 'px_killchain', targetNodeId: 'ef_killchain' },
      { id: 'se_px_cost', sourceNodeId: 'px_cost', targetNodeId: 'ef_cost' },
      { id: 'se_px_frat', sourceNodeId: 'px_fratricide', targetNodeId: 'gt_fratricide' },
      { id: 'se_px_corr', sourceNodeId: 'px_corridor', targetNodeId: 'gt_corridor' },

      // L1 leaf effect -> L2 composite effect (局部入边权重之和 = 1.00)
      {
        id: 'se_air_strike',
        sourceNodeId: 'ef_strike',
        targetNodeId: 'ef_air_superiority',
        weight: 0.45,
      },
      {
        id: 'se_air_patrol',
        sourceNodeId: 'ef_patrol',
        targetNodeId: 'ef_air_superiority',
        weight: 0.35,
      },
      {
        id: 'se_air_isr',
        sourceNodeId: 'ef_isr',
        targetNodeId: 'ef_air_superiority',
        weight: 0.2,
      },
      {
        id: 'se_syn_c2',
        sourceNodeId: 'ef_c2',
        targetNodeId: 'ef_c2_synergy',
        weight: 0.4,
      },
      {
        id: 'se_syn_kill',
        sourceNodeId: 'ef_killchain',
        targetNodeId: 'ef_c2_synergy',
        weight: 0.6,
      },

      // L2 composite + L1 cost -> L3 terminal effect (局部入边权重之和 = 1.00)
      {
        id: 'se_term_air',
        sourceNodeId: 'ef_air_superiority',
        targetNodeId: 'ef_joint_overall',
        weight: 0.5,
      },
      {
        id: 'se_term_syn',
        sourceNodeId: 'ef_c2_synergy',
        targetNodeId: 'ef_joint_overall',
        weight: 0.3,
      },
      {
        id: 'se_term_cost',
        sourceNodeId: 'ef_cost',
        targetNodeId: 'ef_joint_overall',
        weight: 0.2,
      },
    ],
  },
];

// ──────────────────── SystemDagStore ────────────────────

export class SystemDagStore {
  private readonly filePath: string;
  private readonly effectStore: EffectStore;
  private builtins: StoredEvaluationSystemDag[] = [];
  private custom: Map<string, StoredEvaluationSystemDag> = new Map();

  constructor(
    filePath = DEFAULT_SYSTEM_DAGS_PATH,
    effectStore: EffectStore = defaultEffectStore,
    options?: { includeBuiltins?: boolean },
  ) {
    this.filePath = filePath;
    this.effectStore = effectStore;
    if (options?.includeBuiltins !== false) {
      this.builtins = BUILTIN_SYSTEM_DAGS.map((d) => structuredClone(d));
    }
    this.load();
  }

  private load(): void {
    this.custom.clear();
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as StoredEvaluationSystemDag[];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && item.systemId) {
            this.custom.set(item.systemId, { ...item, builtin: false });
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

  listAll(): StoredEvaluationSystemDag[] {
    const byId = new Map<string, StoredEvaluationSystemDag>();
    for (const b of this.builtins) byId.set(b.systemId, structuredClone(b));
    for (const c of this.custom.values()) byId.set(c.systemId, structuredClone(c));
    return [...byId.values()];
  }

  get(systemId: string): StoredEvaluationSystemDag | undefined {
    const found =
      this.custom.get(systemId) ?? this.builtins.find((b) => b.systemId === systemId);
    return found ? structuredClone(found) : undefined;
  }

  validate(dag: EvaluationSystemDag): SystemDagValidationResult {
    return validateSystemDag(dag, this.effectStore);
  }

  upsert(
    dag: EvaluationSystemDag,
    options?: { normalizeWeights?: boolean },
  ): StoredEvaluationSystemDag {
    const candidate = options?.normalizeWeights
      ? normalizeIncomingWeights(dag, this.effectStore)
      : dag;

    const validation = this.validate(candidate);
    if (!validation.valid) {
      throw new Error(`评估体系 DAG 校验失败: ${validation.errors.join('; ')}`);
    }

    const now = new Date().toISOString();
    const existing = this.custom.get(candidate.systemId);
    const prevIncoming = candidate as StoredEvaluationSystemDag;
    const clean: StoredEvaluationSystemDag = {
      ...structuredClone(candidate),
      builtin: false,
      createdAt: existing?.createdAt ?? prevIncoming.createdAt ?? now,
      updatedAt: now,
    };

    this.custom.set(clean.systemId, clean);
    this.persist();
    return structuredClone(clean);
  }

  delete(systemId: string): boolean {
    const isBuiltinOnly =
      this.builtins.some((b) => b.systemId === systemId) && !this.custom.has(systemId);
    if (isBuiltinOnly) {
      throw new Error(`不允许删除内置预置评估体系 DAG: ${systemId}`);
    }
    const deleted = this.custom.delete(systemId);
    if (deleted) {
      this.persist();
    }
    return deleted;
  }
}

export const defaultSystemDagStore = new SystemDagStore();
