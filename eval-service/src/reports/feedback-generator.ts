import type {
  EvaluatedDimensionNode,
  EvaluatedLeafNode,
  SituationModel,
  SystemEvaluationOutput,
  TacticalFeedbackPayload,
} from '../core/types.ts';
import { resolveSides } from '../operators/helpers.ts';

function flattenLeavesWithDimension(
  nodes: Array<EvaluatedDimensionNode | EvaluatedLeafNode>,
  dimName = '综合',
): Array<{ dimName: string; leaf: EvaluatedLeafNode }> {
  const res: Array<{ dimName: string; leaf: EvaluatedLeafNode }> = [];
  for (const n of nodes) {
    if (n.kind === 'indicator') {
      res.push({ dimName, leaf: n });
    } else {
      res.push(...flattenLeavesWithDimension(n.children, n.name));
    }
  }
  return res;
}

/**
 * 38 项内置算子专属军事运筹改进指令与结构化参数补丁字典
 */
export const ATOM_DIRECTIVES_REGISTRY: Record<
  string,
  {
    directives: string[];
    patches: Record<string, unknown>;
  }
> = {
  // ─── 时效类 (Time Operators) ───
  'time.first_detection': {
    directives: [
      '前置部署预警雷达与前向被动侦察哨, 缩短雷达开机搜索周期',
      '优化预警机巡逻航线并提高与前沿单元的数据链刷新率',
    ],
    patches: {
      sensor: { active_scan_interval_sec: 5, early_warning_orbit_distance_km: 80 },
    },
  },
  'time.first_weapon_fire': {
    directives: [
      '放宽首发接战准许条件，前置授权目标确认即转交战',
      '缩减射击诸元解算延迟与协同火控分配时间',
    ],
    patches: {
      wra: { auto_engage_classified_hostiles: true, fire_authorization_mode: 'weapons_free' },
    },
  },
  'time.detect_to_fire_latency': {
    directives: [
      '启用跨平台火控数据链直传，压缩由目标探测至火控诸元下发的决策延时',
      '针对高威胁目标实施快速交战序列，规避人工多级确认卡点',
    ],
    patches: {
      wra: { auto_engage_classified_hostiles: true, ooda_approval_timeout_sec: 15 },
    },
  },
  'time.first_target_hit': {
    directives: [
      '前推发射阵位或选用更高速度拦截弹药，加速首轮火力杀伤兑现',
      '在目标进入不可逃逸区峰值速度段果断施射，缩短弹目交汇飞行时间',
    ],
    patches: {
      salvo: { preferred_mach: 4.5, terminal_guidance_lead_factor: 1.2 },
    },
  },
  'time.combat_duration': {
    directives: [
      '实施多批次高度紧凑的协同突击，防止战场僵持与长期暴露',
      '制定明确的主战毁伤截断指标，达成毁伤阈值后立即转入脱离或下一任务',
    ],
    patches: {
      doctrine: { combat_timeout_abort_sec: 600, disengage_after_primary_kill: true },
    },
  },
  'time.blind_zone_duration': {
    directives: [
      '增强多传感器冗余覆盖与异构协同补盲，避免单一平台机动丢失航迹',
      '调高目标航迹关联记忆外推容限，降低雷达盲区重捕失锁率',
    ],
    patches: {
      sensor: { track_memory_timeout_sec: 25, multi_sensor_fusion_tolerance_km: 3.5 },
    },
  },
  'time.bvr_flight_avg': {
    directives: [
      '收紧超视距发射迎头几何角，避免在极限离轴或尾追包线发射导致长时飞行',
      '提升制导中继更新频率，引导武器沿高抛低阻最优弹道飞行',
    ],
    patches: {
      wra: { max_bvr_loft_angle_deg: 25, bvr_launch_range_factor: 0.85 },
    },
  },
  'time.kill_chain_total_latency': {
    directives: [
      '构建传感器到射手（Sensor-to-Shooter）敏捷链路，压缩全杀伤链端到端耗时',
      '实施自动化目标威胁排序与动态火力指派，消除多节点中继冗余',
    ],
    patches: {
      c2: { sensor_to_shooter_bypass_relay: true, max_kill_chain_latency_sec: 90 },
    },
  },
  'time.strike_wave_interval': {
    directives: [
      '紧凑多波次出动与投弹编组间隔，实现波次饱和火力连续施压',
      '优化挂弹与航路编队同步，避免打击波次衔接脱节给敌喘息修复窗口',
    ],
    patches: {
      sortie: { wave_interval_target_sec: 45, max_acceptable_gap_sec: 120 },
    },
  },

  // ─── 效能类 (Effectiveness Operators) ───
  'eff.mission_success_rate': {
    directives: [
      '针对核心任务判据调整战役规划，重点保障主攻方向兵力兵器配比',
      '实施动态任务补网预案，在关键节点受损时启动备用打击通道',
    ],
    patches: {
      mission: { objective_fail_fallback_plan: 'secondary_corridor', success_criteria_strictness: 0.85 },
    },
  },
  'eff.hit_rate': {
    directives: [
      '调整射击策略为双发齐射或多方位协同突击，降低目标机动脱靶率',
      '严格核查发射瞬间的不可逃逸区 (NEZ) 范围，避免极限射程无效耗弹',
    ],
    patches: {
      salvo: { rounds_per_target: 2, fire_within_nez_ratio: 0.75 },
    },
  },
  'eff.kill_efficiency': {
    directives: [
      '优先分配重型反辐射或高精度贯顶弹药打击敌方核心高价值节点',
      '实施二次毁伤评估（BDA）与补火策略，确保受创目标彻底丧失作战能力',
    ],
    patches: {
      wra: { enable_automated_bda_restrike: true, min_damage_threshold_for_restrike: 0.5 },
    },
  },
  'eff.attrition_balance': {
    directives: [
      '强化己方防御纵深与态势感知掩护，限制敌方反击窗口以拉开战损交换比',
      '增加无人僚机前突诱饵掩护比例，降低有人高价值主机战损',
    ],
    patches: {
      doctrine: { decoy_screen_ratio: 0.5, abort_if_loss_exceeds_ratio: 0.25 },
    },
  },
  'eff.engagement_cycles_count': {
    directives: [
      '集聚主战突击波次在初战发起决定性打击，减少交战周期拖沓',
      '压缩反复拉锯试探，在确立战术优势后迅速实施火力清剿',
    ],
    patches: {
      doctrine: { max_engagement_cycles: 2, converge_force_on_decisive_wave: true },
    },
  },
  'eff.target_penetration_rate': {
    directives: [
      '配合电子干扰压制与超低空地形突防，突破敌方末端反导火力防御圈',
      '规划多向对角同时突入弹道，稀释防空拦截系统通道饱和度',
    ],
    patches: {
      penetration: { ingress_altitude_m: 80, coordinated_saturation_ingress: true },
    },
  },
  'eff.weapon_loss_ratio': {
    directives: [
      '强化弹药抗干扰与中段制导抗欺骗能力，减少途中失锁坠毁',
      '规划避开敌已知密集野战防空圈的低空绕行弹道',
    ],
    patches: {
      weapon: { midcourse_guidance_robustness: 'high', avoid_known_sam_bubbles: true },
    },
  },
  'eff.damage_severity_index': {
    directives: [
      '优选高威力侵彻战斗部或多弹集中攻击主结构部位，确保击毁烈度',
      '提高弹着点精度，避开坚固装甲外围直接命中中枢指挥或雷达阵面',
    ],
    patches: {
      weapon: { warhead_target_selection: 'critical_vital', fuse_delay_ms: 15 },
    },
  },
  'eff.salvo_efficiency': {
    directives: [
      '优化齐射分配逻辑，基于命中预测概率自适应分配弹药枚数',
      '杜绝过度饱和超额分配，将单战果平均消耗控制在最优耗弹经济线内',
    ],
    patches: {
      salvo: { dynamic_salvo_allocation: true, max_salvo_per_target: 3 },
    },
  },
  'eff.air_ops_sortie_completion': {
    directives: [
      '完善战伤返航与应急着陆恢复航线规划，确保出动平台闭环回收',
      '合理配置空中加油与航程油量预算，消除油尽迫降隐患',
    ],
    patches: {
      air_ops: { enforce_safe_recovery_window: true, min_landing_fuel_reserve_kg: 800 },
    },
  },
  'eff.sensor_detection_rate': {
    directives: [
      '交替开启主动相控阵雷达扇区并协同被动 ESM 侦收，提升全域发现概率',
      '布设前沿无人侦察节点，填补敌低空雷达反射死角',
    ],
    patches: {
      sensor: { active_passive_coordination: true, sector_search_coverage_deg: 120 },
    },
  },
  'eff.target_identification_rate': {
    directives: [
      '融合雷达特征、光电吊舱红外信号与 ESM 辐射源库，加速敌我精确识别',
      '降低目标敌我识别属性模糊度门限，减少未知目标未分发时间',
    ],
    patches: {
      iff: { multi_source_fusion_required: 2, identity_confidence_threshold: 0.8 },
    },
  },

  // ─── 态势类 (Situation Operators) ───
  'sit.standoff_advantage': {
    directives: [
      '提升防区外开火距离，保持机队在敌方核心防空威胁圈外实施超视距齐射',
      '控制前哨侦察平台前突深度，加强协同中继制导距离',
    ],
    patches: {
      wra: { maintain_standoff_factor: 1.25 },
      doctrine: { disengage_when_inside_sam_envelope: true },
    },
  },
  'sit.formation_dispersion': {
    directives: [
      '约束多机编队防线横纵向散度，保持互为依托的最佳协同通信与掩护间距',
      '在转弯与变向航段引入编队队形自动保持与间距平滑控制算法',
    ],
    patches: {
      formation: { maintain_shape: 'wedge', max_dispersion_std_nm: 10.0 },
    },
  },
  'sit.geometry_arrival_delta': {
    directives: [
      '基于航程差异为各分队动态注入时间航路点（TOT），实现目标线秒级同步到达',
      '通过调速与蛇形机动消除不同方位的到达时间差，形成最大饱和冲击',
    ],
    patches: {
      navigation: { time_over_target_sync_sec: 10, enable_speed_control_sync: true },
    },
  },
  'sit.area_coverage_ratio': {
    directives: [
      '采用栅格或花环式巡逻扫描轨迹，提升重点防御空域与海域的覆盖度',
      '增加巡逻编队重叠监控扇面，确保重点敏感航线无盲点',
    ],
    patches: {
      patrol: { orbit_pattern: 'racetrack', min_area_overlap_ratio: 0.3 },
    },
  },
  'sit.kinematic_speed_avg': {
    directives: [
      '校准平台巡航速度至经济巡航与战术反应的最优包线区间（450~550 kts）',
      '避免长时间开启超音速加力或失速边缘低速飞行，保持态势机动势能',
    ],
    patches: {
      navigation: { target_cruise_speed_kts: 500, max_afterburner_burst_sec: 30 },
    },
  },
  'sit.altitude_envelope_advantage': {
    directives: [
      '爬升抢占高空对流层顶高位优势，将势能转化为武器初始发射动能',
      '拉开与敌中空巡逻机的垂直高度差，获取空空拦截弹道俯射优势',
    ],
    patches: {
      flight: { preferred_altitude_m: 11000, enforce_vertical_standoff: true },
    },
  },
  'sit.centroid_separation_nm': {
    directives: [
      '将红蓝兵力质心控制在预设超视距接战走廊距离（50~80 nm），防止进入缠斗',
      '当敌方前突靠近至最小质心阈值时，自动执行破战脱离机动重整阵形',
    ],
    patches: {
      doctrine: { desired_centroid_separation_nm: 65, break_turn_trigger_nm: 35 },
    },
  },
  'sit.hull_containment_area': {
    directives: [
      '调控作战单元编队几何凸包空域范围，防止过大造成通信割裂或过小遭遇范围杀伤',
      '根据威胁态势动态缩放编队面积，在安全区展开、在威胁区聚拢',
    ],
    patches: {
      formation: { target_hull_area_km2: 2500, dynamic_area_scaling: true },
    },
  },

  // ─── 合规类 (Compliance Operators) ───
  'comp.corridor_compliance': {
    directives: [
      '控制航路点转向偏离容差（<=2 nm），防止规避机动期间超出指定空域走廊',
      '对进入走廊边界的单元启用航迹自动牵引回调',
    ],
    patches: {
      navigation: { enforce_corridor_boundary: true, deviation_tolerance_nm: 2.0 },
    },
  },
  'comp.wra_compliance': {
    directives: [
      '严格遵守交战规则（WRA）限定的目标类型、射程范围及单目标发射限额',
      '禁止越权越界施射，阻断非合规目标的火控诸元解算下发',
    ],
    patches: {
      wra: { enforce_strict_wra: true, reject_out_of_envelope_fire: true },
    },
  },
  'comp.emcon_silence_discipline': {
    directives: [
      '在指定无线电静默航段关闭机载雷达等主动辐射源，依托被动侦测与静默数据链',
      '规范雷达开机窗口与频闪跳频纪律，防范被敌方长程 ESM 定位暴露',
    ],
    patches: {
      emcon: { enforce_emission_silence: true, radar_silent_until_trigger: 'target_confirmed' },
    },
  },
  'comp.friendly_fire_safety': {
    directives: [
      '严守零误伤安全红线，发射前强制执行双通道 IFF 询问应答与安全射界排查',
      '禁止朝向友邻编队穿越方向发射未设限自毁拦截弹药',
    ],
    patches: {
      safety: {
        enforce_iff_confirmation: true,
        min_friendly_miss_distance_nm: 5.0,
        auto_abort_fire_on_friendly_cone: true,
      },
    },
  },
  'comp.engagement_range_discipline': {
    directives: [
      '坚决杜绝超极限射程无效耗弹，严格在武器标定动力学有效射程包线内接战',
      '针对大机动脱靶目标设立距离截断，未进有效射程前强制保持跟踪不施射',
    ],
    patches: {
      wra: {
        max_engagement_range_km: 110,
        min_engagement_range_km: 15,
        enforce_envelope_discipline: true,
      },
    },
  },

  // ─── 成本类 (Cost Operators) ───
  'cost.munitions_cost_total': {
    directives: [
      '按目标价值分级匹配弹药（高价值目标分配远程弹药，轻型/低威胁目标分配低成本弹药）',
      '避免在次要或残损目标上超量倾泻昂贵精确制导武器',
    ],
    patches: {
      wra: { forbid_high_tier_munition_on_low_value_targets: true, budget_cap_units: 8 },
    },
  },
  'cost.economic_exchange_ratio': {
    directives: [
      '优化投入产出战损比，优选高毁伤收益武器打击核心指挥节点与高价值雷达载机',
      '限制高价有人机在防空火力圈内的暴露，提升整体战果交换经济性',
    ],
    patches: {
      cost: { min_exchange_ratio_threshold: 2.5, prioritize_high_value_target_strikes: true },
    },
  },
  'cost.fuel_remaining_ratio': {
    directives: [
      '设立不可侵犯的返航油量红线（BINGO Fuel），达到阈值时强制执行脱离航线',
      '合理规划巡航马赫数与巡逻留空高度，降低无战果燃油过度损耗',
    ],
    patches: {
      fuel: {
        bingo_fuel_reserve_ratio: 0.35,
        enforce_fuel_bingo_abort: true,
        economical_cruise_altitude_m: 9000,
      },
    },
  },
  'cost.unit_munitions_intensity': {
    directives: [
      '限制单平台单波次携弹最大投射强度，避免单机弹药打光丧失自卫回击能力',
      '推行机群间火力均衡分担，提升全编队武器留存韧性',
    ],
    patches: {
      salvo: { max_intensity_per_platform: 4, enforce_platform_fire_quota: true },
    },
  },
};

export function buildDirectivesForAtom(atomRef: string): {
  directives: string[];
  patches: Record<string, unknown>;
} {
  const matched = ATOM_DIRECTIVES_REGISTRY[atomRef];
  if (matched) {
    return matched;
  }
  return {
    directives: [`针对指标【${atomRef}】实测差距调整任务规划与交战规则参数`],
    patches: { custom: { atomRef, inspect_needed: true } },
  };
}

export function generateTacticalFeedback(
  evalOut: SystemEvaluationOutput,
  situation: SituationModel,
): TacticalFeedbackPayload {
  const { targetSide } = resolveSides(situation);
  const leaves = flattenLeavesWithDimension(evalOut.rootTree.children);

  let grade: TacticalFeedbackPayload['tacticalGrade'] = 'INCOMPLETE';
  if (evalOut.overallScore !== null) {
    if (evalOut.overallScore >= 85) grade = 'A';
    else if (evalOut.overallScore >= 75) grade = 'B+';
    else if (evalOut.overallScore >= 60) grade = 'B';
    else if (evalOut.overallScore >= 45) grade = 'C';
    else grade = 'D';
  }

  const weakItems = leaves
    .filter((x) => x.leaf.score !== null && x.leaf.score < 80)
    .sort((a, b) => (a.leaf.score ?? 100) - (b.leaf.score ?? 100))
    .slice(0, 5);

  const mergedPatches: Record<string, unknown> = {};
  const weaknessDiagnostics = weakItems.map((item, idx) => {
    const { directives, patches } = buildDirectivesForAtom(item.leaf.atomRef);
    Object.assign(mergedPatches, patches);
    const numVal =
      typeof item.leaf.rawResult.value === 'number' ? item.leaf.rawResult.value : null;
    return {
      code: `WEAK_${String(idx + 1).padStart(2, '0')}_${item.leaf.atomRef.replace(/\./g, '_').toUpperCase()}`,
      dimension: item.dimName,
      metricAtom: item.leaf.atomRef,
      observedValue: numVal,
      benchmarkValue: 80,
      score: item.leaf.score,
      diagnosis: `${item.leaf.name} 实测得分为 ${item.leaf.score?.toFixed(1) ?? 'N/A'}（实测值：${item.leaf.rawResult.displayValue}），低于基准 80 分，为该维度主要薄弱指标。`,
      evidenceRefs: item.leaf.rawResult.evidenceRefs.slice(0, 4),
      suggestedDirectives: directives,
    };
  });

  return {
    $schema: 'https://f1-ai.schema/tactical-feedback/v1.json',
    runId: evalOut.runId,
    evaluatedSide: targetSide ?? '红方',
    overallScore: evalOut.overallScore,
    tacticalGrade: grade,
    weaknessDiagnostics,
    recommendedDoctrinePatches: mergedPatches,
  };
}
