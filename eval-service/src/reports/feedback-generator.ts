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
  // ─── 合规与走廊 ───
  'roe.corridor_spatial_compliance': {
    directives: [
      '控制航路点转向偏离容差（<=2 nm），防止规避机动期间超出指定空域走廊',
      '对进入走廊边界的单元启用航迹自动牵引回调',
    ],
    patches: {
      navigation: { enforce_corridor_boundary: true, deviation_tolerance_nm: 2.0 },
    },
  },
  'roe.fratricide_count': {
    directives: [
      '强化敌我识别（IFF）与开火前明确识别（PID）门控，杜绝友军误伤事件',
      '在混战空域限制自主寻的武器扇区与齐射解脱边界',
    ],
    patches: {
      roe: { require_pid_before_fire: true, zero_tolerance_fratricide: true },
    },
  },

  // ─── 打击域 (Strike) ───
  'strike.damage_simulation': {
    directives: [
      '优化对目标毁伤打击编队弹药选型与战斗部配置，提高目标杀伤概率',
      '加强末端攻击突防弹道设计并提升再攻击判定门槛',
    ],
    patches: {
      strike: { damage_threshold: 0.75, salvo_interval_s: 15 },
    },
  },
  'strike.single_mission_metrics': {
    directives: [
      '优化单任务打击机群航路规划与武器释放时间协同',
      '控制任务执行窗口与对地攻击脱离航线安全裕度',
    ],
    patches: {
      strike: { mission_timeout_s: 3600, egress_speed_kt: 480 },
    },
  },
  'strike.composite_mission_metrics': {
    directives: [
      '加强多波次复合打击任务时间与空域协同解耦',
      '合理分配突击编队与伴随电子战压制机群力量',
    ],
    patches: {
      strike: { wave_spacing_s: 300, joint_coordination: true },
    },
  },

  // ─── 巡逻域 (Patrol) ───
  'patrol.unit_completion_status': {
    directives: [
      '优化巡逻战机滞空阵位与巡逻线交替接替航线',
      '控制巡逻单元燃油状态与在勤率，防止巡逻盲区出现',
    ],
    patches: {
      patrol: { loiter_speed_kt: 320, orbit_altitude_m: 7500 },
    },
  },
  'patrol.single_mission_metrics': {
    directives: [
      '调整单巡逻任务阵位留空时间与传感器扫描扇区',
      '提升巡逻空域雷达覆盖重叠度与目标捕获频次',
    ],
    patches: {
      patrol: { min_coverage_ratio: 0.85, patrol_speed_kt: 350 },
    },
  },
  'patrol.composite_mission_metrics': {
    directives: [
      '优化复合防空巡逻多机编队交错轮换机制',
      '提升全任务周期战备值班巡逻战机连续在勤水平',
    ],
    patches: {
      patrol: { rotation_overlap_min: 15, total_readiness_target: 0.9 },
    },
  },

  // ─── 支援域 (Support) ───
  'support.unit_completion_status': {
    directives: [
      '动态协同加油机/预警机等支援平台与主战战机安全间距',
      '优化支援阵位巡航航线并规避敌远距防空打击扇区',
    ],
    patches: {
      support: { standoff_range_km: 120, safe_margin_nm: 25 },
    },
  },
  'support.single_mission_metrics': {
    directives: [
      '精细化单次支援任务油量供给与数据中继刷新率保障',
      '压缩加油/电子支援对接建立时间与空域等待消耗',
    ],
    patches: {
      support: { contact_time_limit_s: 600, flow_rate_kg_min: 1200 },
    },
  },
  'support.composite_mission_metrics': {
    directives: [
      '协调战役级多支援波次与主攻机群起落架次调度',
      '构建弹性支援保障走廊，强化多节点分布式支援能力',
    ],
    patches: {
      support: { corridor_capacity: 4, dynamic_reallocation: true },
    },
  },

  // ─── 探测域 (Detection) ───
  'detection.unit_detection': {
    directives: [
      '优化单机雷达工作模式与搜索扇面，缩短目标探测发现延迟',
      '前置无源侦察哨以弥补有源雷达盲区与地形遮挡',
    ],
    patches: {
      sensor: { active_scan_interval_sec: 4, detection_confidence_min: 0.8 },
    },
  },
  'detection.model_detection': {
    directives: [
      '针对特定型号目标多频段雷达特征库进行参数优化',
      '提高对低可探测与隐身机型雷达截面积（RCS）捕获灵敏度',
    ],
    patches: {
      sensor: { rcs_threshold_db: -20, tracking_filter_gain: 1.2 },
    },
  },

  // ─── 火控与杀伤链 (Fire Control) ───
  'fire_control.unit_identification': {
    directives: [
      '放宽目标精准属性识别条件并前置数据链融合确认',
      '缩短雷达稳定跟踪到火控解算建立时间',
    ],
    patches: {
      fire_control: { identification_timeout_s: 8, fuse_passive_sensor: true },
    },
  },
  'fire_control.model_identification': {
    directives: [
      '优化型号级敌我识别库与电磁辐射指纹匹配算法',
      '提升快速交战场景下对敌关键型号战机的辨别率',
    ],
    patches: {
      fire_control: { match_confidence_threshold: 0.85, update_rate_hz: 10 },
    },
  },
  'fire_control.unit_kill_chain_closure': {
    directives: [
      '压缩侦察-跟踪-瞄准-施射完整杀伤链闭环耗时',
      '前置射击诸元装订与武器投放许可下发流程',
    ],
    patches: {
      fire_control: { kill_chain_max_latency_s: 15, auto_assign_weapon: true },
    },
  },
  'fire_control.model_kill_chain_closure_time': {
    directives: [
      '针对特定防空/空战机型优化闭环交战响应时间',
      '强化多源传感器接力制导以避免目标航迹脱锁丢失',
    ],
    patches: {
      fire_control: { relay_guidance_enabled: true, max_track_loss_sec: 3 },
    },
  },

  // ─── 武器交战与效能 (Weapon) ───
  'weapon.platform_launch_status': {
    directives: [
      '控制载机施射初始姿态与能量优势，确保导弹初始飞行包线优良',
      '避免在极限大离轴角与非稳定机动状态下强制发射',
    ],
    patches: {
      weapon: { max_launch_g: 5.0, launch_speed_mach_min: 1.1 },
    },
  },
  'weapon.platform_launch_metrics': {
    directives: [
      '优化平台施射批次分配与单机载弹消耗率平衡',
      '强化齐射间隔与发射诸元协同装订',
    ],
    patches: {
      weapon: { salvo_interval_s: 2.5, min_reserve_missiles: 2 },
    },
  },
  'weapon.munition_engagement_status': {
    directives: [
      '依据不可逃逸区包线发射，避免在动力射程边界进行无效施射',
      '提升导弹导引头截获开机时机与抗干扰波束自适应调节能力',
    ],
    patches: {
      weapon: { nez_margin_ratio: 1.25, seeker_active_distance_km: 20 },
    },
  },
  'weapon.munition_effectiveness_by_model': {
    directives: [
      '针对各型号弹药杀伤概率优化导弹中段弹道与末端俯冲角',
      '依据目标机动特征匹配最佳引信引爆延时参数',
    ],
    patches: {
      weapon: { fuze_proximity_radius_m: 12, terminal_dive_angle_deg: 35 },
    },
  },
  'weapon.munition_effectiveness_by_target': {
    directives: [
      '区分机动战机与大型轰炸机/预警机分配差异化齐射弹数',
      '对高价值机动目标实施双发互补弹道齐射截击',
    ],
    patches: {
      weapon: { high_value_salvo_size: 2, salvo_spacing_sec: 3 },
    },
  },
  'weapon.penetration_metrics': {
    directives: [
      '增强末端突防蛇形机动与箔条/红外诱饵投放时序配合',
      '利用低空地形遮蔽或编队掩护穿透敌末端近防杀伤网',
    ],
    patches: {
      weapon: { terminal_maneuver_g: 9.0, countermeasure_deploy_alt_m: 1500 },
    },
  },
  'weapon.engagement_range': {
    directives: [
      '保持交战距离在优势攻角范围内，防止过早进入敌反击区',
      '利用高空高速优势拉大发射距离与防区外安全发射裕度',
    ],
    patches: {
      weapon: { launch_altitude_m: 11000, standoff_buffer_km: 15 },
    },
  },

  // ─── 成本与战损 (Cost & Attrition) ───
  'cost.side_attrition_metrics': {
    directives: [
      '控制高价值主战装备前出战损风险，由无人隐身编队先行破防',
      '设定严格的战损止损撤退门限并优化搜救回退通道',
    ],
    patches: {
      tactics: { max_attrition_rate: 0.1, auto_disengage_on_heavy_loss: true },
    },
  },
  'cost.side_exchange_ratio': {
    directives: [
      '提升战损交换比，避免以劣势机群与敌防空要地实施非对称消耗',
      '强化远距超视距第一击摧毁敌关键空战指挥节点',
    ],
    patches: {
      tactics: { target_exchange_ratio_min: 2.5, prioritize_c2_nodes: true },
    },
  },
  'cost.aircraft_losses_by_model': {
    directives: [
      '针对特定高损失型号飞机优化电子自卫吊舱与告警防御机动',
      '降低易受损机型的低空近距暴露时间',
    ],
    patches: {
      tactics: { defensive_break_g: 6.5, chaff_flare_dispense_program: 3 },
    },
  },
  'cost.mission_attrition_metrics': {
    directives: [
      '按任务类型实施弹性兵力投送，严防突击任务过载战损',
      '优化任务执行航线与规避已知地空导弹杀伤阵地',
    ],
    patches: {
      tactics: { sam_avoidance_distance_km: 40, escort_ratio: 0.35 },
    },
  },
  'cost.platform_damage_probability': {
    directives: [
      '提升平台装甲与关键子系统冗余容错能力',
      '遭受轻微损伤后迅速进入安全脱离航线防止扩大为全损',
    ],
    patches: {
      tactics: { abort_on_system_failure: true, damage_tolerance_percent: 25 },
    },
  },

  // ─── 情报与预警 (ISR) ───
  'isr.reconnaissance_range': {
    directives: [
      '扩展预警机与侦察机巡逻纵深以扩大前沿态势侦察半径',
      '综合利用多源侦察手段弥补单一雷达盲区',
    ],
    patches: {
      isr: { orbit_altitude_m: 9000, max_recon_range_km: 350 },
    },
  },
  'isr.detection_rate': {
    directives: [
      '提高空域传感器扫描密度与虚警过滤精度，提升目标探测率',
      '强化分布式传感器协同交叉定位能力',
    ],
    patches: {
      isr: { scan_rate_rpm: 12, cross_fix_min_sensors: 2 },
    },
  },
  'isr.identification_latency': {
    directives: [
      '压缩情报处理与属性判别延迟，加快态势刷新频次',
      '建立快速属性识别通道以支持即时空战指挥决策',
    ],
    patches: {
      isr: { id_processing_latency_limit_s: 5, fast_fusion: true },
    },
  },
  'isr.early_warning_time': {
    directives: [
      '延长敌机群来袭早期预警时间，为防空与空中截击争取战备窗口',
      '前置部署被动侦察与海上哨戒阵位以拉大预警前沿',
    ],
    patches: {
      isr: { warning_time_threshold_s: 180, forward_picket_km: 60 },
    },
  },
  'isr.radar_coverage_area': {
    directives: [
      '优化雷达阵地部署与空基预警机航线，消除关键作战方向覆盖盲区',
      '实现空地立体化连续重叠雷达覆盖网络',
    ],
    patches: {
      isr: { coverage_overlap_factor: 1.4, terrain_masking_compensation: true },
    },
  },

  // ─── 指挥与态势 (C2) ───
  'c2.situational_completeness': {
    directives: [
      '确保指挥控制通信数据链高可靠刷新，维护全局态势感知完整度',
      '提升战术协同网络抗干扰重路由与失步恢复能力',
    ],
    patches: {
      c2: { link_heartbeat_interval_s: 1.0, packet_loss_threshold: 0.05 },
    },
  },

  // ─── 电子对抗 (EW) ───
  'ew.jamming_duration': {
    directives: [
      '精准匹配突击编队突防窗口施放有效电子压制干扰时长',
      '控制干扰机阵位留空与功率辐射，防止过早暴露自身阵位',
    ],
    patches: {
      ew: { effective_jamming_window_s: 180, max_emission_duration_s: 600 },
    },
  },
  'ew.hf_comm_jamming_detail': {
    directives: [
      '精准对准敌关键通信节点实施针对性射频噪声与数字欺骗干扰',
      '动态扫描敌跳频频点并快速跟踪施放伴随干扰',
    ],
    patches: {
      ew: { hopping_track_speed_ms: 50, jamming_bandwidth_mhz: 20 },
    },
  },
  'ew.hf_comm_jamming_side_summary': {
    directives: [
      '评估全战役通信压制效果，确保敌空空指挥链整体瘫痪率达标',
      '协同电子战吊舱资源按重点防空扇区实施梯次集中压制',
    ],
    patches: {
      ew: { target_disruption_rate: 0.8, coordinated_pod_count: 2 },
    },
  },

  // ─── 防空与截击 (Air Defense) ───
  'air_defense.detection_zone': {
    directives: [
      '优化地空防空雷达阵位配置以扩大对低空隐身突防航线的探测拦截包线',
      '前置低空补盲雷达与光电被动搜索哨',
    ],
    patches: {
      air_defense: { low_alt_coverage_km: 45, radar_spacing_km: 30 },
    },
  },
  'air_defense.unit_intercept_zone': {
    directives: [
      '合理规划单防空营地空导弹火力拦截区与射击扇面',
      '避免防空火力死区与过近雷达近界盲区',
    ],
    patches: {
      air_defense: { min_engagement_alt_m: 15, max_engagement_range_km: 120 },
    },
  },
  'air_defense.model_intercept_zone': {
    directives: [
      '依据敌来袭战机/导弹型号匹配射击通道与引导雷达波束',
      '提高对高速高机动反舰导弹截击交战包线覆盖能力',
    ],
    patches: {
      air_defense: { tracking_channel_count: 6, max_target_speed_mach: 3.5 },
    },
  },
  'air_defense.composite_interception_probability': {
    directives: [
      '采用多层防空导弹接力射击与多弹齐射拦截提升综合作战毁伤概率',
      '实现远中近程防空体系立体化杀伤网无缝咬合',
    ],
    patches: {
      air_defense: { layered_intercept_ratio: 0.9, salvo_per_track: 2 },
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
