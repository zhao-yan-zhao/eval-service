import type { MetricAtomMeta } from '../api.ts';

export type OperatorParamKey =
  | 'targetSide'
  | 'enemySide'
  | 'safeRadiusNm'
  | 'minRangeNm'
  | 'expectedSpacingNm'
  | 'arrivalLineLon'
  | 'waveGapSeconds'
  | 'minSafeMarginKm'
  | 'thresholdLow'
  | 'thresholdHigh';

export interface OperatorParamFieldDef {
  key: OperatorParamKey;
  label: string;
  type: 'string' | 'number';
  unit?: string;
  step?: string;
  defaultVal?: string | number;
  placeholder: string;
  description: string;
}

export const PARAM_DEFINITIONS: Record<OperatorParamKey, OperatorParamFieldDef> = {
  targetSide: {
    key: 'targetSide',
    label: '我方阵营',
    type: 'string',
    placeholder: '默认自动识别（如 红方）',
    description: '评估计算所聚焦的己方部队阵营，用于统计己方发射、侦获与战损。',
  },
  enemySide: {
    key: 'enemySide',
    label: '敌方阵营',
    type: 'string',
    placeholder: '默认自动识别（如 蓝方）',
    description: '被评估对抗的敌对目标阵营，用于统计敌方被击落、侵入与被侦获情况。',
  },
  safeRadiusNm: {
    key: 'safeRadiusNm',
    label: '安全防区半径',
    type: 'number',
    unit: '海里 (nm)',
    step: '1',
    defaultVal: 30,
    placeholder: '默认 30 或场景威胁区半径',
    description: '防区外射击与态势隔离基准半径，实际开火距离与该半径比值即为安全倍数。',
  },
  minRangeNm: {
    key: 'minRangeNm',
    label: '最低交战下限',
    type: 'number',
    unit: '海里 (nm)',
    step: '1',
    defaultVal: 10,
    placeholder: '默认 10',
    description: '交战规则(WRA/纪律)允许的最低射程门限，小于此距离开火判定为不合规。',
  },
  expectedSpacingNm: {
    key: 'expectedSpacingNm',
    label: '期望编队间距',
    type: 'number',
    unit: '海里 (nm)',
    step: '0.5',
    defaultVal: 5,
    placeholder: '默认 5',
    description: '多机协同防区穿透时期望保持的几何阵型间距标准差基准。',
  },
  arrivalLineLon: {
    key: 'arrivalLineLon',
    label: '到达判定经线',
    type: 'number',
    unit: '度 (°E/°W)',
    step: '0.1',
    placeholder: '例如 121.5（未指定时无法测算时间差）',
    description: '考核多机协同突破目标防线（指定经线）时的空间一致性时间差。',
  },
  waveGapSeconds: {
    key: 'waveGapSeconds',
    label: '波次划分间隔',
    type: 'number',
    unit: '秒 (s)',
    step: '5',
    defaultVal: 60,
    placeholder: '默认 60',
    description: '两次武器开火事件间隔超过此阈值时，自动划分为独立的攻击轮次/波次。',
  },
  minSafeMarginKm: {
    key: 'minSafeMarginKm',
    label: '走廊最小安全裕度',
    type: 'number',
    unit: '千米 (km)',
    step: '1',
    defaultVal: 15,
    placeholder: '默认 15.0',
    description: '战机在勤航迹距离任务走廊多边形边界的最小允许安全裕度门限。',
  },
  thresholdLow: {
    key: 'thresholdLow',
    label: '达标门限下限',
    type: 'number',
    unit: '比例 (0-1)',
    step: '0.05',
    defaultVal: 0.85,
    placeholder: '默认 0.85 (85%)',
    description: '判定任务走廊空间遵从合格的达标比例阈值基线。',
  },
  thresholdHigh: {
    key: 'thresholdHigh',
    label: '优秀门限上限',
    type: 'number',
    unit: '比例 (0-1)',
    step: '0.05',
    defaultVal: 0.95,
    placeholder: '默认 0.95 (95%)',
    description: '判定任务走廊空间遵从优秀的达标比例阈值基线。',
  },
};

/**
 * 确定指定算子实际支持或消费的特定物理/业务数值参数键名
 */
export function getOperatorSpecificParamKeys(op: MetricAtomMeta): OperatorParamKey[] {
  const keys = new Set<OperatorParamKey>();

  // 1. 根据算子 ID 映射核心物理阈值
  switch (op.id) {
    case 'roe.corridor_spatial_compliance':
    case 'comp.corridor_compliance':
      keys.add('minSafeMarginKm');
      keys.add('thresholdLow');
      keys.add('thresholdHigh');
      break;
    case 'surv.standoff_launch_margin':
    case 'sit.standoff_advantage':
      keys.add('safeRadiusNm');
      break;
    case 'sit.formation_dispersion':
      keys.add('expectedSpacingNm');
      break;
    case 'surv.tot_arrival_delta':
    case 'sit.geometry_arrival_delta':
      keys.add('arrivalLineLon');
      break;
    case 'roe.wra_engagement_compliance':
    case 'comp.engagement_range_discipline':
      keys.add('minRangeNm');
      keys.add('safeRadiusNm');
      break;
    case 'time.strike_wave_interval':
    case 'kc.engagement_cycle_count':
    case 'eff.engagement_cycles_count':
      keys.add('waveGapSeconds');
      break;
  }

  // 2. 自定义算子：若引用了其他算子，继承其物理参数
  if (op.isCustom && op.customDef?.variables) {
    for (const v of op.customDef.variables) {
      const subKeys = getOperatorSpecificParamKeys({ id: v.atomRef } as MetricAtomMeta);
      for (const k of subKeys) keys.add(k);
    }
  }

  // 3. 若算子元数据中已有已配置的 defaultParams，也纳入展示保证不丢失已保存值
  if (op.defaultParams) {
    for (const [k, v] of Object.entries(op.defaultParams)) {
      if (v !== undefined && v !== null && v !== '' && k in PARAM_DEFINITIONS) {
        keys.add(k as OperatorParamKey);
      }
    }
  }

  return Array.from(keys);
}

/**
 * 获取算子所有应在界面渲染的参数定义（包含我方/敌方阵营以及专属物理阈值）
 */
export function getOperatorDisplayParamDefs(op: MetricAtomMeta): OperatorParamFieldDef[] {
  // 阵营参数适用于绝大部分具备推演视角的算子
  const defs: OperatorParamFieldDef[] = [
    PARAM_DEFINITIONS.targetSide,
    PARAM_DEFINITIONS.enemySide,
  ];

  const specificKeys = getOperatorSpecificParamKeys(op);
  for (const k of specificKeys) {
    if (k !== 'targetSide' && k !== 'enemySide') {
      defs.push(PARAM_DEFINITIONS[k]);
    }
  }

  return defs;
}

/**
 * 获取算子支持的扫参参数（排除阵营等离散字符串，仅保留当前算子实际消费的有限连续数值）
 */
export function getOperatorSweepableParamDefs(op: MetricAtomMeta): OperatorParamFieldDef[] {
  const specificKeys = getOperatorSpecificParamKeys(op);
  return specificKeys
    .filter((k) => k !== 'targetSide' && k !== 'enemySide')
    .map((k) => PARAM_DEFINITIONS[k]);
}
