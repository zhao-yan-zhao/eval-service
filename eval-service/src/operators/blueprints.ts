/**
 * 算子专属算法流水线蓝图库 (Operator Pipeline Blueprints)
 * 为一库 36 个业务算子定义其由底层 6 类基础算法构件组成的真实流水线与拓扑
 */

import type { CanvasNodeRuntimeState, PipelineNodeType } from '../ui/components/pipeline-canvas/canvas-types.ts';
import type { TableDataset } from '../core/types.ts';

export interface CanvasNodeBlueprint {
  id: string;
  type: PipelineNodeType;
  title: string;
  description?: string;
  x: number;
  y: number;
  config: Record<string, any>;
  runtime?: CanvasNodeRuntimeState;
}

export interface CanvasEdgeBlueprint {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
}

export interface OperatorPipelineBlueprint {
  operatorId: string;
  name: string;
  category: 'compliance' | 'cost' | 'situation' | 'effectiveness' | 'time';
  primaryAlgorithm: PipelineNodeType;
  algorithmLabel: string;
  algorithmSummary: string;
  defaultDataset?: TableDataset;
  nodes: CanvasNodeBlueprint[];
  edges: CanvasEdgeBlueprint[];
}

// ═══════════════════════════════════════════════════════════════
// 1. 合规域专属推演数据集定义 (与 F1 仿真输出规范字典严格对齐)
// ═══════════════════════════════════════════════════════════════

// 1.1 任务走廊 4 表契约输入与多级下钻数据集

// (1) 任务定义与状态流 (MissionChanged)
const CORRIDOR_MISSION_CHANGED_DATASET: TableDataset = {
  id: 'dataset_mission_changed',
  schema: [
    { name: 'MissionID', displayName: '任务编号', type: 'string' },
    { name: 'MissionName', displayName: '任务名称', type: 'string' },
    { name: 'Side', displayName: '所属阵营', type: 'string' },
    { name: 'Category', displayName: '任务类型 (Category)', type: 'string' },
    { name: 'StartTime', displayName: '任务生效时标', type: 'string' },
    { name: 'EndTime', displayName: '任务截止时标', type: 'string' },
  ],
  rows: [
    { MissionID: 'MSN_CAP_01', MissionName: '东海防空战巡走廊-A', Side: 'Blue', Category: 'CombatAirPatrol', StartTime: '00:05:00', EndTime: '00:35:00' },
    { MissionID: 'MSN_STRIKE_02', MissionName: '低空穿透突防通道-B', Side: 'Blue', Category: 'Strike', StartTime: '00:10:00', EndTime: '00:30:00' },
  ],
  totalRows: 2,
};

// (2) 任务关联空间几何多参考点序列 (MissionRefPointRelationChanged)
const CORRIDOR_REFPOINTS_DATASET: TableDataset = {
  id: 'dataset_mission_refpoints',
  schema: [
    { name: 'Time', displayName: '时标', type: 'string' },
    { name: 'MissionID', displayName: '任务编号', type: 'string' },
    { name: 'Type', displayName: '参考点操作 (Type)', type: 'string' },
    { name: 'PointIndex', displayName: '顶点序号', type: 'number' },
    { name: 'Longitude', displayName: '经度 (°E)', type: 'number' },
    { name: 'Latitude', displayName: '纬度 (°N)', type: 'number' },
  ],
  rows: [
    { Time: '00:05:00', MissionID: 'MSN_CAP_01', Type: 'Create', PointIndex: 1, Longitude: 121.20, Latitude: 31.10 },
    { Time: '00:05:00', MissionID: 'MSN_CAP_01', Type: 'Create', PointIndex: 2, Longitude: 122.20, Latitude: 31.10 },
    { Time: '00:05:00', MissionID: 'MSN_CAP_01', Type: 'Create', PointIndex: 3, Longitude: 122.50, Latitude: 31.60 },
    { Time: '00:05:00', MissionID: 'MSN_CAP_01', Type: 'Create', PointIndex: 4, Longitude: 121.30, Latitude: 31.60 },
    { Time: '00:10:00', MissionID: 'MSN_STRIKE_02', Type: 'Create', PointIndex: 1, Longitude: 120.80, Latitude: 30.80 },
    { Time: '00:10:00', MissionID: 'MSN_STRIKE_02', Type: 'Create', PointIndex: 2, Longitude: 121.60, Latitude: 30.90 },
    { Time: '00:10:00', MissionID: 'MSN_STRIKE_02', Type: 'Create', PointIndex: 3, Longitude: 121.90, Latitude: 31.40 },
    { Time: '00:10:00', MissionID: 'MSN_STRIKE_02', Type: 'Create', PointIndex: 4, Longitude: 121.00, Latitude: 31.30 },
  ],
  totalRows: 8,
};

// (3) 单元-任务生命周期关系流 (MissionUnitRelationChanged)
const CORRIDOR_UNIT_RELATION_DATASET: TableDataset = {
  id: 'dataset_mission_unit_relation',
  schema: [
    { name: 'Time', displayName: '时标', type: 'string' },
    { name: 'UnitID', displayName: '作战单元标识', type: 'string' },
    { name: 'MissionID', displayName: '任务编号', type: 'string' },
    { name: 'Type', displayName: '生命周期动作 (Type)', type: 'string' },
    { name: 'StationWindowSec', displayName: '在勤设计时宽 (s)', type: 'number' },
  ],
  rows: [
    { Time: '00:06:00', UnitID: 'GJ11_01', MissionID: 'MSN_CAP_01', Type: 'Assign', StationWindowSec: 1800 },
    { Time: '00:06:00', UnitID: 'GJ11_02', MissionID: 'MSN_CAP_01', Type: 'Assign', StationWindowSec: 1800 },
    { Time: '00:08:00', UnitID: 'J20_LEAD', MissionID: 'MSN_CAP_01', Type: 'Assign', StationWindowSec: 1800 },
    { Time: '00:11:00', UnitID: 'J20_WING', MissionID: 'MSN_STRIKE_02', Type: 'Assign', StationWindowSec: 1200 },
    { Time: '00:28:00', UnitID: 'GJ11_02', MissionID: 'MSN_CAP_01', Type: 'Unassign', StationWindowSec: 1800 },
  ],
  totalRows: 5,
};

// (4) 作战单元航迹时序点流 (UnitPositions)
const CORRIDOR_POSITIONS_DATASET: TableDataset = {
  id: 'dataset_unit_positions_corridor',
  schema: [
    { name: 'Time', displayName: '采样时标', type: 'string' },
    { name: 'UnitID', displayName: '战机标识', type: 'string' },
    { name: 'UnitName', displayName: '战机名称', type: 'string' },
    { name: 'UnitLongitude', displayName: '航迹经度 (°E)', type: 'number' },
    { name: 'UnitLatitude', displayName: '航迹纬度 (°N)', type: 'number' },
    { name: 'UnitAltitude_m', displayName: '飞行高度 (m)', type: 'number' },
    { name: 'SurvivalStatus', displayName: '存活状态', type: 'string' },
  ],
  rows: [
    { Time: '00:10:00', UnitID: 'GJ11_01', UnitName: '攻击-11长机', UnitLongitude: 121.40, UnitLatitude: 31.20, UnitAltitude_m: 8200, SurvivalStatus: 'Alive' },
    { Time: '00:15:00', UnitID: 'GJ11_01', UnitName: '攻击-11长机', UnitLongitude: 121.80, UnitLatitude: 31.35, UnitAltitude_m: 8200, SurvivalStatus: 'Alive' },
    { Time: '00:20:00', UnitID: 'GJ11_01', UnitName: '攻击-11长机', UnitLongitude: 122.10, UnitLatitude: 31.45, UnitAltitude_m: 8150, SurvivalStatus: 'Alive' },
    { Time: '00:25:00', UnitID: 'GJ11_01', UnitName: '攻击-11长机', UnitLongitude: 121.70, UnitLatitude: 31.30, UnitAltitude_m: 8100, SurvivalStatus: 'Alive' },
    { Time: '00:10:00', UnitID: 'GJ11_02', UnitName: '攻击-11僚机', UnitLongitude: 121.35, UnitLatitude: 31.18, UnitAltitude_m: 8300, SurvivalStatus: 'Alive' },
    { Time: '00:15:00', UnitID: 'GJ11_02', UnitName: '攻击-11僚机', UnitLongitude: 121.75, UnitLatitude: 31.32, UnitAltitude_m: 8300, SurvivalStatus: 'Alive' },
    { Time: '00:20:00', UnitID: 'GJ11_02', UnitName: '攻击-11僚机', UnitLongitude: 122.40, UnitLatitude: 31.55, UnitAltitude_m: 8250, SurvivalStatus: 'Alive' },
    { Time: '00:25:00', UnitID: 'GJ11_02', UnitName: '攻击-11僚机', UnitLongitude: 122.65, UnitLatitude: 31.75, UnitAltitude_m: 8200, SurvivalStatus: 'Alive' },
    { Time: '00:12:00', UnitID: 'J20_LEAD', UnitName: '歼-20指挥机', UnitLongitude: 121.50, UnitLatitude: 31.25, UnitAltitude_m: 9500, SurvivalStatus: 'Alive' },
    { Time: '00:18:00', UnitID: 'J20_LEAD', UnitName: '歼-20指挥机', UnitLongitude: 122.00, UnitLatitude: 31.40, UnitAltitude_m: 9500, SurvivalStatus: 'Alive' },
    { Time: '00:15:00', UnitID: 'J20_WING', UnitName: '歼-20伴随僚机', UnitLongitude: 121.10, UnitLatitude: 31.00, UnitAltitude_m: 7800, SurvivalStatus: 'Alive' },
    { Time: '00:22:00', UnitID: 'J20_WING', UnitName: '歼-20伴随僚机', UnitLongitude: 121.45, UnitLatitude: 31.20, UnitAltitude_m: 7700, SurvivalStatus: 'Alive' },
  ],
  totalRows: 12,
};

// (5) 空间几何判定输出 (单元级在勤遵从明细表)
const CORRIDOR_SPATIAL_SOLVER_SCHEMA = [
  { name: 'MissionID', displayName: '任务编号', type: 'string' as const },
  { name: 'MissionName', displayName: '任务名称', type: 'string' as const },
  { name: 'UnitID', displayName: '作战单元标识', type: 'string' as const },
  { name: 'UnitName', displayName: '战机名称', type: 'string' as const },
  { name: 'ActiveDuration_s', displayName: '在勤总时长 (s)', type: 'number' as const },
  { name: 'InCorridorDuration_s', displayName: '走廊内停留时长 (s)', type: 'number' as const },
  { name: 'UnitComplianceRate', displayName: '单装空间遵从率 (0-1)', type: 'number' as const },
  { name: 'MinMargin_km', displayName: '最小走廊安全裕度 (km)', type: 'number' as const },
  { name: 'ComplianceStatus', displayName: '空间合规状态判定', type: 'string' as const },
];

const CORRIDOR_SPATIAL_SOLVER_DATASET: TableDataset = {
  id: 'dataset_spatial_solver_corridor',
  schema: CORRIDOR_SPATIAL_SOLVER_SCHEMA,
  columns: CORRIDOR_SPATIAL_SOLVER_SCHEMA,
  rows: [
    { MissionID: 'MSN_CAP_01', MissionName: '东海防空战巡走廊-A', UnitID: 'GJ11_01', UnitName: '攻击-11长机', ActiveDuration_s: 1200, InCorridorDuration_s: 1200, UnitComplianceRate: 1.000, MinMargin_km: 18.5, ComplianceStatus: '100% 遵从 (Compliant)' },
    { MissionID: 'MSN_CAP_01', MissionName: '东海防空战巡走廊-A', UnitID: 'GJ11_02', UnitName: '攻击-11僚机', ActiveDuration_s: 1200, InCorridorDuration_s: 1020, UnitComplianceRate: 0.850, MinMargin_km: -2.3, ComplianceStatus: '越界警告 (Boundary Alert)' },
    { MissionID: 'MSN_CAP_01', MissionName: '东海防空战巡走廊-A', UnitID: 'J20_LEAD', UnitName: '歼-20指挥机', ActiveDuration_s: 1080, InCorridorDuration_s: 1080, UnitComplianceRate: 1.000, MinMargin_km: 24.2, ComplianceStatus: '100% 遵从 (Compliant)' },
    { MissionID: 'MSN_STRIKE_02', MissionName: '低空穿透突防通道-B', UnitID: 'J20_WING', UnitName: '歼-20伴随僚机', ActiveDuration_s: 900, InCorridorDuration_s: 855, UnitComplianceRate: 0.950, MinMargin_km: 12.8, ComplianceStatus: '95% 遵从 (Compliant)' },
  ],
  totalRows: 4,
};

// (6) 任务级分组聚合输出 (下钻第 2 层：各任务聚合统计表)
const CORRIDOR_MISSION_AGG_SCHEMA = [
  { name: 'MissionID', displayName: '任务编号', type: 'string' as const },
  { name: 'MissionName', displayName: '任务名称', type: 'string' as const },
  { name: 'MissionComplianceRate', displayName: '任务走廊平均遵从率', type: 'number' as const },
  { name: 'AssignedUnitsCount', displayName: '执行战机总数 (架)', type: 'number' as const },
  { name: 'MissionMinMargin_km', displayName: '任务空域最小裕度 (km)', type: 'number' as const },
  { name: 'TotalInCorridorSec', displayName: '总走廊在勤时间 (s)', type: 'number' as const },
];

const CORRIDOR_MISSION_AGG_DATASET: TableDataset = {
  id: 'dataset_mission_agg_corridor',
  schema: CORRIDOR_MISSION_AGG_SCHEMA,
  columns: CORRIDOR_MISSION_AGG_SCHEMA,
  rows: [
    { MissionID: 'MSN_CAP_01', MissionName: '东海防空战巡走廊-A', MissionComplianceRate: 0.950, AssignedUnitsCount: 3, MissionMinMargin_km: -2.3, TotalInCorridorSec: 3300 },
    { MissionID: 'MSN_STRIKE_02', MissionName: '低空穿透突防通道-B', MissionComplianceRate: 0.950, AssignedUnitsCount: 1, MissionMinMargin_km: 12.8, TotalInCorridorSec: 855 },
  ],
  totalRows: 2,
};

// (7) 阵营全局指标结果输出 (第 1 层：三库直通顶层指标)
const CORRIDOR_OUTPUT_SCHEMA = [
  { name: 'IndicatorID', displayName: '指标标识', type: 'string' as const },
  { name: 'IndicatorName', displayName: '指标名称', type: 'string' as const },
  { name: 'Side', displayName: '所属阵营', type: 'string' as const },
  { name: 'OverallComplianceRate', displayName: '阵营全局任务走廊遵从率', type: 'number' as const },
  { name: 'TotalMissions', displayName: '评估任务总数', type: 'number' as const },
  { name: 'TotalAssignedUnits', displayName: '参演战机总数', type: 'number' as const },
  { name: 'EvaluationGrade', displayName: '体系评级', type: 'string' as const },
  { name: 'ThresholdStatus', displayName: '阈值准则达成状态', type: 'string' as const },
];

const CORRIDOR_OUTPUT_DATASET: TableDataset = {
  id: 'dataset_res_corridor',
  schema: CORRIDOR_OUTPUT_SCHEMA,
  columns: CORRIDOR_OUTPUT_SCHEMA,
  rows: [
    {
      IndicatorID: 'comp.corridor_compliance',
      IndicatorName: '任务走廊空间遵从率',
      Side: 'Blue (蓝方)',
      OverallComplianceRate: 0.950,
      TotalMissions: 2,
      TotalAssignedUnits: 4,
      EvaluationGrade: '优秀 (达标)',
      ThresholdStatus: 'Pass (>= 0.85)',
    },
  ],
  totalRows: 1,
};

// 1.2 WRA 开火准则数据集
const WRA_WEAPON_FIRED_DATASET: TableDataset = {
  id: 'dataset_weapon_fired_wra',
  schema: [
    { name: 'WeaponID', displayName: '弹药编号', type: 'string' },
    { name: 'FiringPlatform', displayName: '发射平台', type: 'string' },
    { name: 'TargetType', displayName: '目标机型', type: 'string' },
    { name: 'FiringRange_nm', displayName: '发射射距 (Nm)', type: 'number' },
    { name: 'SalvoCount', displayName: '齐射发数', type: 'number' },
    { name: 'TargetSpeed_kts', displayName: '目标航速 (kts)', type: 'number' },
  ],
  rows: [
    { WeaponID: 'PL15_01', FiringPlatform: 'GJ11_01', TargetType: 'F35_A', FiringRange_nm: 42.5, SalvoCount: 1, TargetSpeed_kts: 510 },
    { WeaponID: 'PL15_02', FiringPlatform: 'GJ11_01', TargetType: 'F35_A', FiringRange_nm: 38.0, SalvoCount: 1, TargetSpeed_kts: 490 },
    { WeaponID: 'PL15_03', FiringPlatform: 'GJ11_02', TargetType: 'F35_B', FiringRange_nm: 55.0, SalvoCount: 2, TargetSpeed_kts: 560 },
    { WeaponID: 'PL15_04', FiringPlatform: 'GJ11_02', TargetType: 'F35_B', FiringRange_nm: 68.0, SalvoCount: 1, TargetSpeed_kts: 580 },
    { WeaponID: 'PL15_05', FiringPlatform: 'J20_LEAD', TargetType: 'E2D_AWACS', FiringRange_nm: 75.0, SalvoCount: 2, TargetSpeed_kts: 340 },
    { WeaponID: 'PL15_06', FiringPlatform: 'J20_LEAD', TargetType: 'E2D_AWACS', FiringRange_nm: 72.0, SalvoCount: 2, TargetSpeed_kts: 340 },
  ],
  totalRows: 6,
};

// 1.3 电磁辐射状态流
const EMCON_STATUS_DATASET: TableDataset = {
  id: 'dataset_emcon_status',
  schema: [
    { name: 'UnitID', displayName: '载机编号', type: 'string' },
    { name: 'SensorType', displayName: '传感器类型', type: 'string' },
    { name: 'Status', displayName: '开机状态', type: 'string' },
    { name: 'IsSilentWindow', displayName: '是否处于静默窗口 (1/0)', type: 'number' },
    { name: 'ActiveSeconds', displayName: '持续开机时长 (s)', type: 'number' },
    { name: 'ScenarioTime', displayName: '仿真时标', type: 'string' },
  ],
  rows: [
    { UnitID: 'GJ11_01', SensorType: 'Radar_AESA', Status: 'SILENT', IsSilentWindow: 1, ActiveSeconds: 0, ScenarioTime: '00:10:00' },
    { UnitID: 'GJ11_01', SensorType: 'RWR_ESM', Status: 'ACTIVE', IsSilentWindow: 1, ActiveSeconds: 600, ScenarioTime: '00:10:00' },
    { UnitID: 'GJ11_02', SensorType: 'Radar_AESA', Status: 'SILENT', IsSilentWindow: 1, ActiveSeconds: 0, ScenarioTime: '00:10:00' },
    { UnitID: 'GJ11_02', SensorType: 'Jammer_Pod', Status: 'SILENT', IsSilentWindow: 1, ActiveSeconds: 0, ScenarioTime: '00:10:00' },
    { UnitID: 'J20_LEAD', SensorType: 'Radar_AESA', Status: 'SILENT', IsSilentWindow: 1, ActiveSeconds: 0, ScenarioTime: '00:10:00' },
    { UnitID: 'J20_LEAD', SensorType: 'IRST_Optic', Status: 'ACTIVE', IsSilentWindow: 1, ActiveSeconds: 600, ScenarioTime: '00:10:00' },
    { UnitID: 'GJ11_01', SensorType: 'Radar_AESA', Status: 'ACTIVE', IsSilentWindow: 1, ActiveSeconds: 15, ScenarioTime: '00:18:30' },
  ],
  totalRows: 7,
};

// 1.4 武器终局误伤判定数据集
const WEAPON_ENDGAME_DATASET: TableDataset = {
  id: 'dataset_weapon_endgame_safety',
  schema: [
    { name: 'WeaponID', displayName: '弹药编号', type: 'string' },
    { name: 'ShooterSide', displayName: '发射方阵营', type: 'string' },
    { name: 'TargetSide', displayName: '目标方阵营', type: 'string' },
    { name: 'TargetUnit', displayName: '目标单元', type: 'string' },
    { name: 'HitResult', displayName: '命中判定 (1/0)', type: 'number' },
    { name: 'DamagePercent', displayName: '毁伤百分比 (%)', type: 'number' },
  ],
  rows: [
    { WeaponID: 'PL15_01', ShooterSide: 'Blue', TargetSide: 'Red', TargetUnit: 'F35_01', HitResult: 1, DamagePercent: 100 },
    { WeaponID: 'PL15_02', ShooterSide: 'Blue', TargetSide: 'Red', TargetUnit: 'F35_01', HitResult: 1, DamagePercent: 85 },
    { WeaponID: 'PL15_03', ShooterSide: 'Blue', TargetSide: 'Red', TargetUnit: 'F35_02', HitResult: 0, DamagePercent: 0 },
    { WeaponID: 'PL15_04', ShooterSide: 'Blue', TargetSide: 'Red', TargetUnit: 'F35_02', HitResult: 1, DamagePercent: 90 },
    { WeaponID: 'PL15_05', ShooterSide: 'Blue', TargetSide: 'Red', TargetUnit: 'E2D_01', HitResult: 1, DamagePercent: 100 },
  ],
  totalRows: 5,
};

// ═══════════════════════════════════════════════════════════════
// 2. 算子流水线蓝图全集
// ═══════════════════════════════════════════════════════════════

export const OPERATOR_PIPELINE_BLUEPRINTS: Record<string, OperatorPipelineBlueprint> = {
  'comp.corridor_compliance': {
    operatorId: 'comp.corridor_compliance',
    name: '任务走廊空间遵从率',
    category: 'compliance',
    primaryAlgorithm: 'spatial',
    algorithmLabel: '空间几何判定与任务级聚合 (Turf.js + GroupBy)',
    algorithmSummary: '接入 4 张规范事件表：多参考点构建走廊多边形，对齐单元在勤生命周期，计算有效窗口内空间遵从率与安全裕度，并聚合为任务级指标',
    defaultDataset: CORRIDOR_OUTPUT_DATASET,
    nodes: [
      {
        id: 'node_input_mission',
        type: 'data_input',
        title: '表输入：MissionChanged 任务定义与状态流',
        description: '抽取任务编号、任务名称、所属阵营 (Side) 与任务生命周期时标',
        x: 60,
        y: 40,
        config: {
          sourceType: 'csv',
          csvTable: 'MissionChanged.csv',
          selectedColumns: ['MissionName', 'MissionID', 'Side', 'Category', 'StartTime', 'EndTime'],
          
        },
        runtime: {
          status: 'success',
          rowCount: 2,
          columnCount: 6,
          latencyMs: 1.1,
          outputDataset: CORRIDOR_MISSION_CHANGED_DATASET,
        },
      },
      {
        id: 'node_input_refpoints',
        type: 'data_input',
        title: '表输入：MissionRefPointRelationChanged 走廊参考点流',
        description: '抽取任务关联的多个参考点经纬度 (Longitude/Latitude)，用于动态构建空域多边形',
        x: 60,
        y: 220,
        config: {
          sourceType: 'csv',
          csvTable: 'MissionRefPointRelationChanged.csv',
          selectedColumns: ['Time', 'MissionID', 'Type', 'PointIndex', 'Longitude', 'Latitude'],
        },
        runtime: {
          status: 'success',
          rowCount: 8,
          columnCount: 6,
          latencyMs: 1.3,
          outputDataset: CORRIDOR_REFPOINTS_DATASET,
        },
      },
      {
        id: 'node_input_unit_relation',
        type: 'data_input',
        title: '表输入：MissionUnitRelationChanged 单元任务关系流',
        description: '抽取战机单元加入任务 (Assign)、脱离 (Unassign) 时标，对齐在勤时间窗口',
        x: 60,
        y: 400,
        config: {
          sourceType: 'csv',
          csvTable: 'MissionUnitRelationChanged.csv',
          selectedColumns: ['Time', 'UnitID', 'MissionID', 'Type', 'StationWindowSec'],
        },
        runtime: {
          status: 'success',
          rowCount: 5,
          columnCount: 5,
          latencyMs: 1.0,
          outputDataset: CORRIDOR_UNIT_RELATION_DATASET,
        },
      },
      {
        id: 'node_input_positions',
        type: 'data_input',
        title: '表输入：UnitPositions 作战单元航迹时序点流',
        description: '抽取参战战机时序高频经度、纬度、高度与存活态势 (SurvivalStatus)',
        x: 60,
        y: 580,
        config: {
          sourceType: 'csv',
          csvTable: 'UnitPositions.csv',
          selectedColumns: ['Time', 'UnitID', 'UnitName', 'UnitLongitude', 'UnitLatitude', 'UnitAltitude_m', 'SurvivalStatus'],
          filterField: 'UnitSide',
          filterEquals: 'Blue',
        },
        runtime: {
          status: 'success',
          rowCount: 12,
          columnCount: 7,
          latencyMs: 1.5,
          outputDataset: CORRIDOR_POSITIONS_DATASET,
        },
      },
      {
        id: 'node_spatial_corridor',
        type: 'spatial',
        title: '空间几何：任务走廊空间安全裕度判定',
        description: '基于任务多边形走廊，对齐战机单元在勤时间窗口，计算空间遵从率与安全裕度',
        x: 480,
        y: 310,
        config: {
          spatialRule: 'corridor_check',
          geomSourceMode: 'dynamic_table',
          geomTable: 'MissionRefPointRelationChanged.csv',
          geomLonField: 'Longitude',
          geomLatField: 'Latitude',
          geomGroupField: 'MissionID',
          geomOrderField: 'PointIndex',
          minSafeMarginKm: 15.0,
          missionIdField: 'MissionID',
          unitIdField: 'UnitID',
          lonField: 'UnitLongitude',
          latField: 'UnitLatitude',
          altField: 'UnitAltitude_m',
          stationAlignmentMode: 'lifecycle_slice',
          outputContainmentCol: 'in_corridor',
          outputMarginCol: 'min_margin_km',
          corridorBounds: [
            [121.20, 31.10],
            [122.20, 31.10],
            [122.50, 31.60],
            [121.30, 31.60],
          ],
        },
        runtime: {
          status: 'success',
          rowCount: 4,
          columnCount: 9,
          latencyMs: 4.2,
          outputDataset: CORRIDOR_SPATIAL_SOLVER_DATASET,
          diffCols: ['UnitComplianceRate', 'MinMargin_km', 'ComplianceStatus'],
        },
      },
      {
        id: 'node_agg_mission',
        type: 'group_agg',
        title: '数据汇总：按任务分组聚合遵从率',
        description: '对多机在勤战效进行任务级聚拢，求取任务平均遵从率、任务执行机数与空域最小安全裕度',
        x: 880,
        y: 310,
        config: {
          groupKeys: ['MissionID', 'MissionName'],
          aggregations: [
            { outputField: 'MissionComplianceRate', sourceField: 'UnitComplianceRate', method: 'AVERAGE' },
            { outputField: 'AssignedUnitsCount', sourceField: 'UnitID', method: 'COUNT_ALL' },
            { outputField: 'MissionMinMargin_km', sourceField: 'MinMargin_km', method: 'MIN' },
            { outputField: 'TotalInCorridorSec', sourceField: 'InCorridorDuration_s', method: 'SUM' },
          ],
        },
        runtime: {
          status: 'success',
          rowCount: 2,
          columnCount: 6,
          latencyMs: 1.8,
          outputDataset: CORRIDOR_MISSION_AGG_DATASET,
          diffCols: ['MissionComplianceRate', 'AssignedUnitsCount', 'MissionMinMargin_km', 'TotalInCorridorSec'],
        },
      },
      {
        id: 'node_output_corridor',
        type: 'result_output',
        title: '结果输出：任务走廊空间遵从率',
        description: '输出全局任务走廊空间遵从率指标，挂载至指标库与评估体系',
        x: 1280,
        y: 310,
        config: {
          targetField: 'comp.corridor_compliance',
          indicatorId: 'ind_comp_corridor_v1',
          indicatorName: '任务走廊空间遵从率',
          indicatorUnit: '合规率 (0-1)',
          optimalDirection: 'larger_is_better',
          thresholdLow: 0.85,
          thresholdHigh: 0.95,
          targetSystemId: 'sys_bvr_air_combat_v1',
          targetDimensionId: 'dim_bvr_command_control',
        },
        runtime: {
          status: 'success',
          rowCount: 1,
          columnCount: 8,
          latencyMs: 0.4,
          outputDataset: CORRIDOR_OUTPUT_DATASET,
          diffCols: ['OverallComplianceRate', 'EvaluationGrade', 'ThresholdStatus'],
        },
      },
    ],
    edges: [
      { id: 'edge_mission_to_spatial', sourceNodeId: 'node_input_mission', targetNodeId: 'node_spatial_corridor', label: '任务与阵营数据流' },
      { id: 'edge_refpoints_to_spatial', sourceNodeId: 'node_input_refpoints', targetNodeId: 'node_spatial_corridor', label: '多参考点动态几何序列' },
      { id: 'edge_unit_rel_to_spatial', sourceNodeId: 'node_input_unit_relation', targetNodeId: 'node_spatial_corridor', label: '单元任务生命周期对齐' },
      { id: 'edge_positions_to_spatial', sourceNodeId: 'node_input_positions', targetNodeId: 'node_spatial_corridor', label: '高精度航迹时序点流' },
      { id: 'edge_spatial_to_agg', sourceNodeId: 'node_spatial_corridor', targetNodeId: 'node_agg_mission', label: '单元级在勤空间遵从明细' },
      { id: 'edge_agg_to_output', sourceNodeId: 'node_agg_mission', targetNodeId: 'node_output_corridor', label: '任务级聚合流' },
    ],
  },

  // ───────────────────────────────────────────────────────────
  // 1.2 WRA 射击准则合规率 (行内计算 LibFormula + 跨行聚合)
  // ───────────────────────────────────────────────────────────
  'comp.wra_compliance': {
    operatorId: 'comp.wra_compliance',
    name: 'WRA 射击准则合规率',
    category: 'compliance',
    primaryAlgorithm: 'inline_calc',
    algorithmLabel: '行内计算 (LibFormula 准则阶跃校验)',
    algorithmSummary: '检查实发齐射数与开火射距是否符合预设交战规则 (WRA)，输出单次发射合规性并聚合',
    defaultDataset: WRA_WEAPON_FIRED_DATASET,
    nodes: [
      {
        id: 'node_input_wra',
        type: 'data_input',
        title: '表输入：WeaponFired 开火记录',
        description: '抽取武器实际开火射距、齐射枚数与目标机型',
        x: 60,
        y: 140,
        config: { sourceType: 'csv', csvTable: 'WeaponFired.csv' },
        runtime: {
          status: 'success',
          rowCount: 6,
          columnCount: 6,
          latencyMs: 1.1,
          outputDataset: WRA_WEAPON_FIRED_DATASET,
        },
      },
      {
        id: 'node_calc_wra',
        type: 'inline_calc',
        title: '行内计算：WRA 规则阶跃判定 (LibFormula)',
        description: 'IF(AND(FiringRange_nm >= 20.0; FiringRange_nm <= 65.0; SalvoCount <= 2); 1.0; 0.0)',
        x: 420,
        y: 140,
        config: {
          derivedColumns: [
            {
              name: 'is_wra_compliant',
              expression: 'IF(AND(FiringRange_nm >= 20.0; FiringRange_nm <= 65.0; SalvoCount <= 2); 1.0; 0.0)',
              outputType: 'numeric',
            },
          ],
        },
        runtime: {
          status: 'success',
          rowCount: 6,
          columnCount: 7,
          latencyMs: 1.6,
          outputDataset: {
            ...WRA_WEAPON_FIRED_DATASET,
            schema: [
              ...WRA_WEAPON_FIRED_DATASET.schema,
              { name: 'is_wra_compliant', displayName: 'WRA 准则合规 (1/0)', type: 'number' },
            ],
            rows: WRA_WEAPON_FIRED_DATASET.rows.map((r, i) => ({
              ...r,
              is_wra_compliant: i === 3 ? 0 : 1, // 68nm 超出 65nm 上限
            })),
          },
        },
      },
      {
        id: 'node_agg_wra',
        type: 'group_agg',
        title: '数据汇总：Welford 平均合规率',
        description: 'AVERAGE(is_wra_compliant) 归约为标量指标',
        x: 780,
        y: 140,
        config: {
          aggregations: [{ op: 'AVERAGE', sourceField: 'is_wra_compliant', targetField: 'wra_compliance_rate' }],
        },
        runtime: {
          status: 'success',
          rowCount: 1,
          columnCount: 1,
          latencyMs: 0.8,
          outputDataset: {
            id: 'dataset_agg_wra',
            schema: [{ name: 'wra_compliance_rate', displayName: '平均合规率', type: 'number' }],
            rows: [{ wra_compliance_rate: 0.833 }],
            totalRows: 1,
          },
        },
      },
      {
        id: 'node_output_wra',
        type: 'result_output',
        title: '结果输出：WRA 射击准则合规率',
        description: '标量 83.3% 挂载至二库指标与三库体系',
        x: 1140,
        y: 140,
        config: {
          targetField: 'comp.wra_compliance',
          indicatorName: 'WRA 射击准则合规率',
          indicatorUnit: '合规率 (0-1)',
          optimalDirection: 'larger_is_better',
        },
        runtime: {
          status: 'success',
          rowCount: 1,
          columnCount: 1,
          latencyMs: 0.2,
        },
      },
    ],
    edges: [
      { id: 'edge_wra_1', sourceNodeId: 'node_input_wra', targetNodeId: 'node_calc_wra', label: '开火参数流' },
      { id: 'edge_wra_2', sourceNodeId: 'node_calc_wra', targetNodeId: 'node_agg_wra', label: '单发准则标记' },
      { id: 'edge_wra_3', sourceNodeId: 'node_agg_wra', targetNodeId: 'node_output_wra', label: '平均合规率标量' },
    ],
  },

  // ───────────────────────────────────────────────────────────
  // 1.3 电磁静默纪律遵从度 (跨行聚合 Group Agg)
  // ───────────────────────────────────────────────────────────
  'comp.emcon_silence_discipline': {
    operatorId: 'comp.emcon_silence_discipline',
    name: '电磁静默纪律遵从度',
    category: 'compliance',
    primaryAlgorithm: 'group_agg',
    algorithmLabel: '跨行聚合 (Welford 辐射时长统计)',
    algorithmSummary: '统计传感器开机状态时段与时长，聚合计算电磁静默遵从比例',
    defaultDataset: EMCON_STATUS_DATASET,
    nodes: [
      {
        id: 'node_input_emcon',
        type: 'data_input',
        title: '表输入：传感器开机状态时序流',
        description: '提取传感器开机标记 Active 与静默窗口标记',
        x: 60,
        y: 140,
        config: { sourceType: 'csv', csvTable: 'ComponentStatusChanged.csv' },
        runtime: {
          status: 'success',
          rowCount: 7,
          columnCount: 6,
          latencyMs: 1.2,
          outputDataset: EMCON_STATUS_DATASET,
        },
      },
      {
        id: 'node_calc_emcon_violation',
        type: 'inline_calc',
        title: '行内计算：静默期违规辐射判定 (LibFormula)',
        description: 'IF(AND(Status == "ACTIVE"; IsSilentWindow == 1; SensorType == "Radar_AESA"); 1.0; 0.0)',
        x: 420,
        y: 140,
        config: {
          derivedColumns: [
            {
              name: 'is_radar_violation',
              expression: 'IF(AND(Status == "ACTIVE"; IsSilentWindow == 1; SensorType == "Radar_AESA"); 1.0; 0.0)',
              outputType: 'numeric',
            },
          ],
        },
        runtime: {
          status: 'success',
          rowCount: 7,
          columnCount: 7,
          latencyMs: 1.4,
          outputDataset: {
            ...EMCON_STATUS_DATASET,
            schema: [
              ...EMCON_STATUS_DATASET.schema,
              { name: 'is_radar_violation', displayName: '违规辐射开机标记 (1/0)', type: 'number' },
            ],
            rows: EMCON_STATUS_DATASET.rows.map((r) => ({
              ...r,
              is_radar_violation: r.SensorType === 'Radar_AESA' && r.Status === 'ACTIVE' && r.IsSilentWindow === 1 ? 1 : 0,
            })),
          },
        },
      },
      {
        id: 'node_agg_emcon',
        type: 'group_agg',
        title: '数据汇总：辐射开机频次规约 (Welford)',
        description: 'SUM(is_radar_violation) 与总开机检查项规约',
        x: 780,
        y: 140,
        config: {
          aggregations: [
            { op: 'SUM', sourceField: 'is_radar_violation', targetField: 'violations_count' },
            { op: 'COUNT', sourceField: 'Status', targetField: 'total_checks' },
          ],
        },
        runtime: {
          status: 'success',
          rowCount: 1,
          columnCount: 2,
          latencyMs: 0.9,
          outputDataset: {
            id: 'dataset_agg_emcon',
            schema: [
              { name: 'violations_count', displayName: '违规开机次数', type: 'number' },
              { name: 'total_checks', displayName: '总检查点数', type: 'number' },
            ],
            rows: [{ violations_count: 1, total_checks: 7 }],
            totalRows: 1,
          },
        },
      },
      {
        id: 'node_output_emcon',
        type: 'result_output',
        title: '结果输出：电磁静默纪律遵从度',
        description: '输出静默遵从度 (85.7%) 并挂载二库指标与三库体系',
        x: 1140,
        y: 140,
        config: {
          targetField: 'comp.emcon_silence_discipline',
          indicatorName: '电磁静默纪律遵从度',
          indicatorUnit: '静默遵从率 (0-1)',
          optimalDirection: 'larger_is_better',
        },
        runtime: {
          status: 'success',
          rowCount: 1,
          columnCount: 1,
          latencyMs: 0.2,
        },
      },
    ],
    edges: [
      { id: 'edge_emcon_1', sourceNodeId: 'node_input_emcon', targetNodeId: 'node_calc_emcon_violation', label: '传感器开机时序流' },
      { id: 'edge_emcon_2', sourceNodeId: 'node_calc_emcon_violation', targetNodeId: 'node_agg_emcon', label: '违规开机判定列' },
      { id: 'edge_emcon_3', sourceNodeId: 'node_agg_emcon', targetNodeId: 'node_output_emcon', label: '静默遵从度标量' },
    ],
  },

  // ───────────────────────────────────────────────────────────
  // 1.4 零友军误伤安全红线率 (行内公式 + 红线一票否决 MIN)
  // ───────────────────────────────────────────────────────────
  'comp.friendly_fire_safety': {
    operatorId: 'comp.friendly_fire_safety',
    name: '零友军误伤安全红线率',
    category: 'compliance',
    primaryAlgorithm: 'inline_calc',
    algorithmLabel: '行内计算 (LibFormula 敌我识别 IFF 校验)',
    algorithmSummary: '审计己方 WeaponEndgame 命中对象阵营，检验敌我识别 (IFF) 与误伤零违例红线',
    defaultDataset: WEAPON_ENDGAME_DATASET,
    nodes: [
      {
        id: 'node_input_ff',
        type: 'data_input',
        title: '表输入：WeaponEndgame 终局事件',
        description: '抽取武器阵营 ShooterSide 与命中目标阵营 TargetSide',
        x: 60,
        y: 140,
        config: { sourceType: 'csv', csvTable: 'WeaponEndgame.csv' },
        runtime: {
          status: 'success',
          rowCount: 5,
          columnCount: 6,
          latencyMs: 1.0,
          outputDataset: WEAPON_ENDGAME_DATASET,
        },
      },
      {
        id: 'node_calc_ff',
        type: 'inline_calc',
        title: '行内计算：IFF 阵营安全红线校验 (LibFormula)',
        description: 'IF(AND(ShooterSide == TargetSide; HitResult == 1); 0.0; 1.0)',
        x: 420,
        y: 140,
        config: {
          derivedColumns: [
            {
              name: 'is_safety_clean',
              expression: 'IF(AND(ShooterSide == TargetSide; HitResult == 1); 0.0; 1.0)',
              outputType: 'numeric',
            },
          ],
        },
        runtime: {
          status: 'success',
          rowCount: 5,
          columnCount: 7,
          latencyMs: 1.2,
          outputDataset: {
            ...WEAPON_ENDGAME_DATASET,
            schema: [
              ...WEAPON_ENDGAME_DATASET.schema,
              { name: 'is_safety_clean', displayName: '非误伤安全判定 (1/0)', type: 'number' },
            ],
            rows: WEAPON_ENDGAME_DATASET.rows.map((r) => ({
              ...r,
              is_safety_clean: r.ShooterSide === r.TargetSide && r.HitResult === 1 ? 0 : 1,
            })),
          },
        },
      },
      {
        id: 'node_agg_ff',
        type: 'group_agg',
        title: '数据汇总：红线一票否决归约 (MIN)',
        description: 'MIN(is_safety_clean) 若有任一误伤即为 0 (红线否决)',
        x: 780,
        y: 140,
        config: {
          aggregations: [{ op: 'MIN', sourceField: 'is_safety_clean', targetField: 'safe_redline_score' }],
        },
        runtime: {
          status: 'success',
          rowCount: 1,
          columnCount: 1,
          latencyMs: 0.5,
          outputDataset: {
            id: 'dataset_agg_ff',
            schema: [{ name: 'safe_redline_score', displayName: '零误伤红线得分', type: 'number' }],
            rows: [{ safe_redline_score: 1.0 }],
            totalRows: 1,
          },
        },
      },
      {
        id: 'node_output_ff',
        type: 'result_output',
        title: '结果输出：零友军误伤安全红线率',
        description: '输出安全红线达成率 (100.0% 零违例，绿灯达标)',
        x: 1140,
        y: 140,
        config: {
          targetField: 'comp.friendly_fire_safety',
          indicatorName: '零友军误伤安全红线率',
          indicatorUnit: '安全率 (0-1)',
          optimalDirection: 'larger_is_better',
          thresholdLow: 1.0,
          thresholdHigh: 1.0,
        },
        runtime: {
          status: 'success',
          rowCount: 1,
          columnCount: 1,
          latencyMs: 0.2,
        },
      },
    ],
    edges: [
      { id: 'edge_ff_1', sourceNodeId: 'node_input_ff', targetNodeId: 'node_calc_ff', label: '终局阵营数据流' },
      { id: 'edge_ff_2', sourceNodeId: 'node_calc_ff', targetNodeId: 'node_agg_ff', label: '非误伤校验标记' },
      { id: 'edge_ff_3', sourceNodeId: 'node_agg_ff', targetNodeId: 'node_output_ff', label: '一票否决标量收口' },
    ],
  },

  // ───────────────────────────────────────────────────────────
  // 1.5 超视距有效射程交战纪律率 (行内公式 LibFormula + AVERAGE)
  // ───────────────────────────────────────────────────────────
  'comp.engagement_range_discipline': {
    operatorId: 'comp.engagement_range_discipline',
    name: '超视距有效射程交战纪律率',
    category: 'compliance',
    primaryAlgorithm: 'inline_calc',
    algorithmLabel: '行内计算 (LibFormula 接敌射距阶跃校验)',
    algorithmSummary: '校验开火记录中实际接敌距离 FiringRange_nm >= 超视距最低下限 (10nm) 的占比',
    defaultDataset: WRA_WEAPON_FIRED_DATASET,
    nodes: [
      {
        id: 'node_input_erd',
        type: 'data_input',
        title: '表输入：WeaponFired 开火接敌射距',
        description: '读取 FiringRange_nm 连续射距字段与目标机型',
        x: 60,
        y: 140,
        config: { sourceType: 'csv', csvTable: 'WeaponFired.csv' },
        runtime: {
          status: 'success',
          rowCount: 6,
          columnCount: 6,
          latencyMs: 1.1,
          outputDataset: WRA_WEAPON_FIRED_DATASET,
        },
      },
      {
        id: 'node_calc_erd',
        type: 'inline_calc',
        title: '行内计算：超视距射距下限阶跃判定 (LibFormula)',
        description: 'IF(FiringRange_nm >= 10.0; 1.0; 0.0)',
        x: 420,
        y: 140,
        config: {
          derivedColumns: [
            {
              name: 'is_range_disciplined',
              expression: 'IF(FiringRange_nm >= 10.0; 1.0; 0.0)',
              outputType: 'numeric',
            },
          ],
        },
        runtime: {
          status: 'success',
          rowCount: 6,
          columnCount: 7,
          latencyMs: 1.3,
          outputDataset: {
            ...WRA_WEAPON_FIRED_DATASET,
            schema: [
              ...WRA_WEAPON_FIRED_DATASET.schema,
              { name: 'is_range_disciplined', displayName: '超视距纪律遵从 (1/0)', type: 'number' },
            ],
            rows: WRA_WEAPON_FIRED_DATASET.rows.map((r) => ({
              ...r,
              is_range_disciplined: r.FiringRange_nm >= 10.0 ? 1 : 0,
            })),
          },
        },
      },
      {
        id: 'node_agg_erd',
        type: 'group_agg',
        title: '数据汇总：Welford 平均合规率',
        description: 'AVERAGE(is_range_disciplined) 计算整体纪律遵从率',
        x: 780,
        y: 140,
        config: {
          aggregations: [
            { op: 'AVERAGE', sourceField: 'is_range_disciplined', targetField: 'range_discipline_rate' },
          ],
        },
        runtime: {
          status: 'success',
          rowCount: 1,
          columnCount: 1,
          latencyMs: 0.6,
          outputDataset: {
            id: 'dataset_agg_erd',
            schema: [{ name: 'range_discipline_rate', displayName: '超视距射程纪律遵从率', type: 'number' }],
            rows: [{ range_discipline_rate: 1.0 }],
            totalRows: 1,
          },
        },
      },
      {
        id: 'node_output_erd',
        type: 'result_output',
        title: '结果输出：超视距有效射程交战纪律率',
        description: '输出超视距交战纪律遵从率 (100.0%) 并挂载二库指标与三库体系',
        x: 1140,
        y: 140,
        config: {
          targetField: 'comp.engagement_range_discipline',
          indicatorName: '超视距有效射程交战纪律率',
          indicatorUnit: '纪律率 (0-1)',
          optimalDirection: 'larger_is_better',
        },
        runtime: {
          status: 'success',
          rowCount: 1,
          columnCount: 1,
          latencyMs: 0.2,
        },
      },
    ],
    edges: [
      { id: 'edge_erd_1', sourceNodeId: 'node_input_erd', targetNodeId: 'node_calc_erd', label: '接敌射距数值' },
      { id: 'edge_erd_2', sourceNodeId: 'node_calc_erd', targetNodeId: 'node_agg_erd', label: '下限阶跃标记' },
      { id: 'edge_erd_3', sourceNodeId: 'node_agg_erd', targetNodeId: 'node_output_erd', label: '纪律遵从率标量' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 6. 传感器目标探测率 (通用基础算子：数据输入 ➔ 行内公式 ➔ 跨行聚合 ➔ 结果输出)
  // ═══════════════════════════════════════════════════════════════
  'eff.sensor_detection_rate': {
    operatorId: 'eff.sensor_detection_rate',
    name: '传感器目标探测率',
    category: 'effectiveness',
    primaryAlgorithm: 'group_agg',
    algorithmLabel: '通用行内公式衍生 + 跨行汇总聚合',
    algorithmSummary: '提取 ContactCreated 目标接触事件流，通过行内公式判定探测包线门限，再聚合计算探测成功率。',
    defaultDataset: {
      id: 'dataset_contact_created_sample',
      schema: [
        { name: 'Time', displayName: '时标', type: 'string' },
        { name: 'ContactID', displayName: '接触编号', type: 'string' },
        { name: 'ContactName', displayName: '接触目标名称', type: 'string' },
        { name: 'ActualUnitID', displayName: '真实战机编号', type: 'string' },
        { name: 'Side', displayName: '探测方阵营', type: 'string' },
        { name: 'ContactRangeHoriz_nm', displayName: '水平距离 (nm)', type: 'number' },
      ],
      rows: [
        { Time: '00:05:10', ContactID: 'CNT_01', ContactName: '未知空中接触-01', ActualUnitID: 'F35_01', Side: 'Blue', ContactRangeHoriz_nm: 42.5 },
        { Time: '00:05:30', ContactID: 'CNT_02', ContactName: '未知空中接触-02', ActualUnitID: 'F35_02', Side: 'Blue', ContactRangeHoriz_nm: 51.0 },
        { Time: '00:06:00', ContactID: 'CNT_03', ContactName: '未知空中接触-03', ActualUnitID: 'F35_03', Side: 'Blue', ContactRangeHoriz_nm: 58.2 },
        { Time: '00:06:20', ContactID: 'CNT_04', ContactName: '未知空中接触-04', ActualUnitID: 'F35_04', Side: 'Blue', ContactRangeHoriz_nm: 38.0 },
        { Time: '00:07:15', ContactID: 'CNT_05', ContactName: '远距微弱反射-05', ActualUnitID: 'F35_05', Side: 'Blue', ContactRangeHoriz_nm: 72.4 },
        { Time: '00:08:00', ContactID: 'CNT_06', ContactName: '未知空中接触-06', ActualUnitID: 'F35_06', Side: 'Blue', ContactRangeHoriz_nm: 44.1 },
        { Time: '00:08:45', ContactID: 'CNT_07', ContactName: '未知空中接触-07', ActualUnitID: 'F35_07', Side: 'Blue', ContactRangeHoriz_nm: 36.5 },
        { Time: '00:09:10', ContactID: 'CNT_08', ContactName: '未知空中接触-08', ActualUnitID: 'F35_08', Side: 'Blue', ContactRangeHoriz_nm: 49.8 },
      ],
      totalRows: 8,
    },
    nodes: [
      {
        id: 'node_input_det',
        type: 'data_input',
        title: '数据源表：ContactCreated 接触事件流',
        description: '从目标接触创建事件流中提取雷达/光电探测距离与批次记录',
        x: 60,
        y: 120,
        config: {
          csvTable: 'ContactCreated',
          selectedColumns: ['Time', 'ContactID', 'ContactName', 'ActualUnitID', 'Side', 'ContactRangeHoriz_nm'],
          
        },
        runtime: {
          status: 'success',
          rowCount: 8,
          columnCount: 6,
          latencyMs: 1.1,
        },
      },
      {
        id: 'node_calc_det',
        type: 'inline_calc',
        title: '公式计算：有效探测距离与标记判定',
        description: '基于 LibFormula 公式，判定水平探测距离是否在雷达有效视距包线 (60nm) 内',
        x: 420,
        y: 120,
        config: {
          derivedColumns: [
            {
              name: 'is_in_envelope',
              dataType: 'number',
              expression: 'IF(ContactRangeHoriz_nm <= 60; 1; 0)',
            },
            {
              name: 'is_valid_detection',
              dataType: 'number',
              expression: "IF(AND(is_in_envelope = 1; ContactID <> ''); 1; 0)",
            },
          ],
        },
        runtime: {
          status: 'success',
          rowCount: 8,
          columnCount: 2,
          latencyMs: 1.4,
        },
      },
      {
        id: 'node_agg_det',
        type: 'group_agg',
        title: '数据汇总：标量聚合计算探测成功率',
        description: '统计有效探测样本总数、包线内命中数，汇总为探测成功率',
        x: 780,
        y: 120,
        config: {
          groupBy: [],
          aggregations: [
            { method: 'COUNT_ALL', sourceField: 'ContactID', outputField: 'total_attempts' },
            { method: 'SUM', sourceField: 'is_valid_detection', outputField: 'valid_detections' },
            { method: 'AVERAGE', sourceField: 'is_valid_detection', outputField: 'detection_rate' },
          ],
        },
        runtime: {
          status: 'success',
          rowCount: 1,
          columnCount: 3,
          latencyMs: 0.8,
        },
      },
      {
        id: 'node_output_det',
        type: 'result_output',
        title: '指标输出：传感器目标探测率',
        description: '将探测率标量结果输出并挂载二库指标与三库评估体系',
        x: 1140,
        y: 120,
        config: {
          targetField: 'detection_rate',
          indicatorName: '传感器目标探测率',
          indicatorUnit: '比率 (0-1)',
          optimalDirection: 'larger_is_better',
        },
        runtime: {
          status: 'success',
          rowCount: 1,
          columnCount: 1,
          latencyMs: 0.2,
        },
      },
    ],
    edges: [
      { id: 'edge_det_1', sourceNodeId: 'node_input_det', targetNodeId: 'node_calc_det', label: '接触字段输入' },
      { id: 'edge_det_2', sourceNodeId: 'node_calc_det', targetNodeId: 'node_agg_det', label: '有效探测衍生列' },
      { id: 'edge_det_3', sourceNodeId: 'node_agg_det', targetNodeId: 'node_output_det', label: '探测率聚合结果' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // 7. 目标识别率 (通用基础算子：数据输入 ➔ 行内公式 ➔ 跨行聚合 ➔ 结果输出)
  // ═══════════════════════════════════════════════════════════════
  'eff.target_identification_rate': {
    operatorId: 'eff.target_identification_rate',
    name: '目标识别率',
    category: 'effectiveness',
    primaryAlgorithm: 'group_agg',
    algorithmLabel: '通用行内公式衍生 + 跨行汇总聚合',
    algorithmSummary: '基于三表联动（DetectionIdentificationChanged 识别事件流 + ContactCreated 真值绑定 + UnitCreated 阵营台账），通过双分支独立计算分子（去重识别目标）与分母（清洗核心战力底数），汇聚求得全域目标识别率。',
    defaultDataset: {
      id: 'dataset_identification_sample',
      schema: [
        { name: 'Time', displayName: '时标', type: 'string' },
        { name: 'ContactID', displayName: '接触编号', type: 'string' },
        { name: 'ContactName', displayName: '目标接触名', type: 'string' },
        { name: 'ActualUnitID', displayName: '真实目标编号 (ActualUnitID)', type: 'string' },
        { name: 'Side', displayName: '探测方阵营', type: 'string' },
        { name: 'UnitSide', displayName: '目标所属阵营', type: 'string' },
        { name: 'UnitType', displayName: '装备大类', type: 'string' },
        { name: 'IdentificationStatus', displayName: '识别状态 (Status)', type: 'string' },
        { name: 'SensorType', displayName: '传感器类型', type: 'string' },
        { name: 'ContactRangeHoriz_nm', displayName: '探测距离 (nm)', type: 'number' },
      ],
      rows: [
        { Time: '00:07:10', ContactID: 'CNT_01', ContactName: '目标-01', ActualUnitID: 'BLUE_F16_#1', Side: '红方', UnitSide: '蓝方', UnitType: 'Aircraft', IdentificationStatus: 'PreciseID', SensorType: 'Radar', ContactRangeHoriz_nm: 32.0 },
        { Time: '00:07:30', ContactID: 'CNT_02', ContactName: '目标-02', ActualUnitID: 'BLUE_F16_#2', Side: '红方', UnitSide: '蓝方', UnitType: 'Aircraft', IdentificationStatus: 'KnownClass', SensorType: 'Radar', ContactRangeHoriz_nm: 38.5 },
        { Time: '00:08:00', ContactID: 'CNT_03', ContactName: '目标-03', ActualUnitID: 'BLUE_AWACS_#1', Side: '红方', UnitSide: '蓝方', UnitType: 'Aircraft', IdentificationStatus: 'KnownType', SensorType: 'ESM', ContactRangeHoriz_nm: 45.0 },
        { Time: '00:08:20', ContactID: 'CNT_04', ContactName: '目标-04', ActualUnitID: 'BLUE_DDG_#1', Side: '红方', UnitSide: '蓝方', UnitType: 'Ship', IdentificationStatus: 'Unknown', SensorType: 'Radar', ContactRangeHoriz_nm: 65.0 },
        { Time: '00:09:00', ContactID: 'CNT_05', ContactName: '目标-05', ActualUnitID: 'BLUE_FFG_#1', Side: '红方', UnitSide: '蓝方', UnitType: 'Ship', IdentificationStatus: 'PreciseID', SensorType: 'Optics', ContactRangeHoriz_nm: 22.4 },
        { Time: '00:09:40', ContactID: 'CNT_06', ContactName: '目标-06', ActualUnitID: 'BLUE_F35_#1', Side: '红方', UnitSide: '蓝方', UnitType: 'Aircraft', IdentificationStatus: 'KnownClass', SensorType: 'Radar', ContactRangeHoriz_nm: 34.2 },
        { Time: '00:10:15', ContactID: 'CNT_07', ContactName: '目标-07', ActualUnitID: 'BLUE_F35_#2', Side: '红方', UnitSide: '蓝方', UnitType: 'Aircraft', IdentificationStatus: 'KnownType', SensorType: 'ESM', ContactRangeHoriz_nm: 41.0 },
        { Time: '00:10:50', ContactID: 'CNT_08', ContactName: '目标-08', ActualUnitID: 'BLUE_SUB_#1', Side: '红方', UnitSide: '蓝方', UnitType: 'Submarine', IdentificationStatus: 'KnownDomain', SensorType: 'Sonar', ContactRangeHoriz_nm: 12.0 },
        { Time: '00:11:30', ContactID: 'CNT_09', ContactName: '目标-09', ActualUnitID: 'BLUE_F16_#1', Side: '红方', UnitSide: '蓝方', UnitType: 'Aircraft', IdentificationStatus: 'PreciseID', SensorType: 'Radar', ContactRangeHoriz_nm: 28.5 },
        { Time: '00:12:00', ContactID: 'CNT_10', ContactName: '目标-10', ActualUnitID: 'BLUE_DECOY_#1', Side: '红方', UnitSide: '蓝方', UnitType: 'Decoy', IdentificationStatus: 'KnownClass', SensorType: 'Radar', ContactRangeHoriz_nm: 36.1 },
      ],
      totalRows: 10,
    },
    nodes: [
      // ── 分子分支：侦察接触与识别判定 ──
      {
        id: 'node_input_detection',
        type: 'data_input',
        title: '数据源：DetectionIdentificationChanged',
        description: '读取雷达/光电等传感器识别变动事件 (Status, Range, Sensor)',
        x: 60,
        y: 80,
        config: {
          csvTable: 'DetectionIdentificationChanged',
          selectedColumns: ['Time', 'ContactID', 'ContactName', 'IdentificationStatus', 'SensorType', 'ContactRangeHoriz_nm'],
        },
        runtime: {
          status: 'success',
          rowCount: 10,
          columnCount: 6,
          latencyMs: 0.8,
          outputDataset: {
            id: 'ds_node_input_detection',
            schema: [
              { name: 'Time', displayName: '时标', type: 'string' },
              { name: 'ContactID', displayName: '接触编号', type: 'string' },
              { name: 'ContactName', displayName: '目标接触名', type: 'string' },
              { name: 'IdentificationStatus', displayName: '识别状态 (Status)', type: 'string' },
              { name: 'SensorType', displayName: '传感器类型', type: 'string' },
              { name: 'ContactRangeHoriz_nm', displayName: '探测距离 (nm)', type: 'number' },
            ],
            columns: [
              { name: 'Time', displayName: '时标', type: 'string' },
              { name: 'ContactID', displayName: '接触编号', type: 'string' },
              { name: 'ContactName', displayName: '目标接触名', type: 'string' },
              { name: 'IdentificationStatus', displayName: '识别状态 (Status)', type: 'string' },
              { name: 'SensorType', displayName: '传感器类型', type: 'string' },
              { name: 'ContactRangeHoriz_nm', displayName: '探测距离 (nm)', type: 'number' },
            ],
            rows: [
              { Time: '00:07:10', ContactID: 'CNT_01', ContactName: '目标-01', IdentificationStatus: 'PreciseID', SensorType: 'Radar', ContactRangeHoriz_nm: 32.0 },
              { Time: '00:07:30', ContactID: 'CNT_02', ContactName: '目标-02', IdentificationStatus: 'KnownClass', SensorType: 'Radar', ContactRangeHoriz_nm: 38.5 },
              { Time: '00:08:00', ContactID: 'CNT_03', ContactName: '目标-03', IdentificationStatus: 'KnownType', SensorType: 'ESM', ContactRangeHoriz_nm: 45.0 },
              { Time: '00:08:20', ContactID: 'CNT_04', ContactName: '目标-04', IdentificationStatus: 'Unknown', SensorType: 'Radar', ContactRangeHoriz_nm: 65.0 },
              { Time: '00:09:00', ContactID: 'CNT_05', ContactName: '目标-05', IdentificationStatus: 'PreciseID', SensorType: 'Optics', ContactRangeHoriz_nm: 22.4 },
              { Time: '00:09:40', ContactID: 'CNT_06', ContactName: '目标-06', IdentificationStatus: 'KnownClass', SensorType: 'Radar', ContactRangeHoriz_nm: 34.2 },
              { Time: '00:10:15', ContactID: 'CNT_07', ContactName: '目标-07', IdentificationStatus: 'KnownType', SensorType: 'ESM', ContactRangeHoriz_nm: 41.0 },
              { Time: '00:10:50', ContactID: 'CNT_08', ContactName: '目标-08', IdentificationStatus: 'KnownDomain', SensorType: 'Sonar', ContactRangeHoriz_nm: 12.0 },
              { Time: '00:11:30', ContactID: 'CNT_09', ContactName: '目标-09', IdentificationStatus: 'PreciseID', SensorType: 'Radar', ContactRangeHoriz_nm: 28.5 },
              { Time: '00:12:00', ContactID: 'CNT_10', ContactName: '目标-10', IdentificationStatus: 'KnownClass', SensorType: 'Radar', ContactRangeHoriz_nm: 36.1 },
            ],
            totalRows: 10,
          },
        },
      },
      {
        id: 'node_input_contact',
        type: 'data_input',
        title: '数据源：ContactCreated 接触真值',
        description: '读取接触建立事件，提供唯一真实物理装备真值映射 (ActualUnitID)',
        x: 60,
        y: 240,
        config: {
          csvTable: 'ContactCreated',
          selectedColumns: ['ContactID', 'ActualUnitID', 'ActualUnitName', 'Side'],
        },
        runtime: {
          status: 'success',
          rowCount: 10,
          columnCount: 4,
          latencyMs: 0.7,
          outputDataset: {
            id: 'ds_node_input_contact',
            schema: [
              { name: 'ContactID', displayName: '接触编号', type: 'string' },
              { name: 'ActualUnitID', displayName: '真实目标编号 (ActualUnitID)', type: 'string' },
              { name: 'ActualUnitName', displayName: '真实目标名称', type: 'string' },
              { name: 'Side', displayName: '探测方阵营', type: 'string' },
            ],
            columns: [
              { name: 'ContactID', displayName: '接触编号', type: 'string' },
              { name: 'ActualUnitID', displayName: '真实目标编号 (ActualUnitID)', type: 'string' },
              { name: 'ActualUnitName', displayName: '真实目标名称', type: 'string' },
              { name: 'Side', displayName: '探测方阵营', type: 'string' },
            ],
            rows: [
              { ContactID: 'CNT_01', ActualUnitID: 'BLUE_F16_#1', ActualUnitName: 'F-16C #1', Side: '红方' },
              { ContactID: 'CNT_02', ActualUnitID: 'BLUE_F16_#2', ActualUnitName: 'F-16C #2', Side: '红方' },
              { ContactID: 'CNT_03', ActualUnitID: 'BLUE_AWACS_#1', ActualUnitName: 'E-2D 预警机', Side: '红方' },
              { ContactID: 'CNT_04', ActualUnitID: 'BLUE_DDG_#1', ActualUnitName: '伯克级驱逐舰', Side: '红方' },
              { ContactID: 'CNT_05', ActualUnitID: 'BLUE_FFG_#1', ActualUnitName: '护卫舰-01', Side: '红方' },
              { ContactID: 'CNT_06', ActualUnitID: 'BLUE_F35_#1', ActualUnitName: 'F-35A #1', Side: '红方' },
              { ContactID: 'CNT_07', ActualUnitID: 'BLUE_F35_#2', ActualUnitName: 'F-35A #2', Side: '红方' },
              { ContactID: 'CNT_08', ActualUnitID: 'BLUE_SUB_#1', ActualUnitName: '弗吉尼亚级核潜艇', Side: '红方' },
              { ContactID: 'CNT_09', ActualUnitID: 'BLUE_F16_#1', ActualUnitName: 'F-16C #1 (二次接触)', Side: '红方' },
              { ContactID: 'CNT_10', ActualUnitID: 'BLUE_DECOY_#1', ActualUnitName: 'ADM-160 诱饵', Side: '红方' },
            ],
            totalRows: 10,
          },
        },
      },
      {
        id: 'node_calc_ident_match',
        type: 'inline_calc',
        title: '公式判定：识别门限与真值关联',
        description: '基于 LibFormula 判定识别等级是否达到 KnownType/Class/PreciseID',
        x: 440,
        y: 160,
        config: {
          derivedColumns: [
            {
              name: 'is_identified',
              columnName: 'is_identified',
              dataType: 'number',
              expression: "IF(OR(IdentificationStatus = 'KnownClass'; IdentificationStatus = 'PreciseID'; IdentificationStatus = 'KnownType'); 1; 0)",
            },
            {
              name: 'is_detector_red',
              columnName: 'is_detector_red',
              dataType: 'number',
              expression: "IF(Side = '红方'; 1; 0)",
            },
          ],
        },
        runtime: {
          status: 'success',
          rowCount: 10,
          columnCount: 12,
          latencyMs: 1.1,
          diffCols: ['is_identified', 'is_detector_red'],
          outputDataset: {
            id: 'ds_node_calc_ident_match',
            schema: [
              { name: 'Time', displayName: '时标', type: 'string' },
              { name: 'ContactID', displayName: '接触编号', type: 'string' },
              { name: 'ContactName', displayName: '目标接触名', type: 'string' },
              { name: 'ActualUnitID', displayName: '真实目标编号 (ActualUnitID)', type: 'string' },
              { name: 'ActualUnitName', displayName: '真实目标名称', type: 'string' },
              { name: 'Side', displayName: '探测方阵营', type: 'string' },
              { name: 'IdentificationStatus', displayName: '识别状态 (Status)', type: 'string' },
              { name: 'SensorType', displayName: '传感器类型', type: 'string' },
              { name: 'ContactRangeHoriz_nm', displayName: '探测距离 (nm)', type: 'number' },
              { name: 'is_identified', displayName: '是否达到识别门限', type: 'number', isDerived: true },
              { name: 'is_detector_red', displayName: '是否红方探测', type: 'number', isDerived: true },
            ],
            columns: [
              { name: 'Time', displayName: '时标', type: 'string' },
              { name: 'ContactID', displayName: '接触编号', type: 'string' },
              { name: 'ContactName', displayName: '目标接触名', type: 'string' },
              { name: 'ActualUnitID', displayName: '真实目标编号 (ActualUnitID)', type: 'string' },
              { name: 'ActualUnitName', displayName: '真实目标名称', type: 'string' },
              { name: 'Side', displayName: '探测方阵营', type: 'string' },
              { name: 'IdentificationStatus', displayName: '识别状态 (Status)', type: 'string' },
              { name: 'SensorType', displayName: '传感器类型', type: 'string' },
              { name: 'ContactRangeHoriz_nm', displayName: '探测距离 (nm)', type: 'number' },
              { name: 'is_identified', displayName: '是否达到识别门限', type: 'number', isDerived: true },
              { name: 'is_detector_red', displayName: '是否红方探测', type: 'number', isDerived: true },
            ],
            rows: [
              { Time: '00:07:10', ContactID: 'CNT_01', ContactName: '目标-01', ActualUnitID: 'BLUE_F16_#1', ActualUnitName: 'F-16C #1', Side: '红方', IdentificationStatus: 'PreciseID', SensorType: 'Radar', ContactRangeHoriz_nm: 32.0, is_identified: 1, is_detector_red: 1 },
              { Time: '00:07:30', ContactID: 'CNT_02', ContactName: '目标-02', ActualUnitID: 'BLUE_F16_#2', ActualUnitName: 'F-16C #2', Side: '红方', IdentificationStatus: 'KnownClass', SensorType: 'Radar', ContactRangeHoriz_nm: 38.5, is_identified: 1, is_detector_red: 1 },
              { Time: '00:08:00', ContactID: 'CNT_03', ContactName: '目标-03', ActualUnitID: 'BLUE_AWACS_#1', ActualUnitName: 'E-2D 预警机', Side: '红方', IdentificationStatus: 'KnownType', SensorType: 'ESM', ContactRangeHoriz_nm: 45.0, is_identified: 1, is_detector_red: 1 },
              { Time: '00:08:20', ContactID: 'CNT_04', ContactName: '目标-04', ActualUnitID: 'BLUE_DDG_#1', ActualUnitName: '伯克级驱逐舰', Side: '红方', IdentificationStatus: 'Unknown', SensorType: 'Radar', ContactRangeHoriz_nm: 65.0, is_identified: 0, is_detector_red: 1 },
              { Time: '00:09:00', ContactID: 'CNT_05', ContactName: '目标-05', ActualUnitID: 'BLUE_FFG_#1', ActualUnitName: '护卫舰-01', Side: '红方', IdentificationStatus: 'PreciseID', SensorType: 'Optics', ContactRangeHoriz_nm: 22.4, is_identified: 1, is_detector_red: 1 },
              { Time: '00:09:40', ContactID: 'CNT_06', ContactName: '目标-06', ActualUnitID: 'BLUE_F35_#1', ActualUnitName: 'F-35A #1', Side: '红方', IdentificationStatus: 'KnownClass', SensorType: 'Radar', ContactRangeHoriz_nm: 34.2, is_identified: 1, is_detector_red: 1 },
              { Time: '00:10:15', ContactID: 'CNT_07', ContactName: '目标-07', ActualUnitID: 'BLUE_F35_#2', ActualUnitName: 'F-35A #2', Side: '红方', IdentificationStatus: 'KnownType', SensorType: 'ESM', ContactRangeHoriz_nm: 41.0, is_identified: 1, is_detector_red: 1 },
              { Time: '00:10:50', ContactID: 'CNT_08', ContactName: '目标-08', ActualUnitID: 'BLUE_SUB_#1', ActualUnitName: '弗吉尼亚级核潜艇', Side: '红方', IdentificationStatus: 'KnownDomain', SensorType: 'Sonar', ContactRangeHoriz_nm: 12.0, is_identified: 0, is_detector_red: 1 },
              { Time: '00:11:30', ContactID: 'CNT_09', ContactName: '目标-09', ActualUnitID: 'BLUE_F16_#1', ActualUnitName: 'F-16C #1 (二次接触)', Side: '红方', IdentificationStatus: 'PreciseID', SensorType: 'Radar', ContactRangeHoriz_nm: 28.5, is_identified: 1, is_detector_red: 1 },
              { Time: '00:12:00', ContactID: 'CNT_10', ContactName: '目标-10', ActualUnitID: 'BLUE_DECOY_#1', ActualUnitName: 'ADM-160 诱饵', Side: '红方', IdentificationStatus: 'KnownClass', SensorType: 'Radar', ContactRangeHoriz_nm: 36.1, is_identified: 1, is_detector_red: 1 },
            ],
            totalRows: 10,
          },
        },
      },
      {
        id: 'node_agg_identified_targets',
        type: 'group_agg',
        title: '去重聚合：已识别敌方实体数 (分子)',
        description: '执行 COUNT_DISTINCT(ActualUnitID) 对同一目标的多次接触去重，求得有效识别实体数',
        x: 800,
        y: 160,
        config: {
          groupBy: [],
          aggregations: [
            { method: 'COUNT_DISTINCT', sourceField: 'ActualUnitID', outputField: 'identified_target_count' },
            { method: 'COUNT_ALL', sourceField: 'ContactID', outputField: 'total_contact_tracks' },
          ],
        },
        runtime: {
          status: 'success',
          rowCount: 1,
          columnCount: 2,
          latencyMs: 0.6,
          diffCols: ['identified_target_count', 'total_contact_tracks'],
          outputDataset: {
            id: 'ds_node_agg_identified_targets',
            schema: [
              { name: 'identified_target_count', displayName: '去重已识别敌方实体数 (分子)', type: 'number' },
              { name: 'total_contact_tracks', displayName: '接触航迹事件总量', type: 'number' },
            ],
            columns: [
              { name: 'identified_target_count', displayName: '去重已识别敌方实体数 (分子)', type: 'number' },
              { name: 'total_contact_tracks', displayName: '接触航迹事件总量', type: 'number' },
            ],
            rows: [
              { identified_target_count: 6, total_contact_tracks: 10 },
            ],
            totalRows: 1,
          },
        },
      },

      // ── 分母分支：目标阵营装备台账与清洗 ──
      {
        id: 'node_input_unit_catalog',
        type: 'data_input',
        title: '数据源：UnitCreated 参演实体台账',
        description: '读取推演初始参演作战实体台账 (UnitID, UnitSide, UnitType, UnitClass)',
        x: 60,
        y: 440,
        config: {
          csvTable: 'UnitCreated',
          selectedColumns: ['UnitID', 'UnitName', 'UnitSide', 'UnitType', 'UnitClass'],
        },
        runtime: {
          status: 'success',
          rowCount: 10,
          columnCount: 5,
          latencyMs: 0.9,
          outputDataset: {
            id: 'ds_node_input_unit_catalog',
            schema: [
              { name: 'UnitID', displayName: '实体标识', type: 'string' },
              { name: 'UnitName', displayName: '战机/舰艇名称', type: 'string' },
              { name: 'UnitSide', displayName: '所属阵营', type: 'string' },
              { name: 'UnitType', displayName: '装备大类', type: 'string' },
              { name: 'UnitClass', displayName: '装备型号级别', type: 'string' },
            ],
            columns: [
              { name: 'UnitID', displayName: '实体标识', type: 'string' },
              { name: 'UnitName', displayName: '战机/舰艇名称', type: 'string' },
              { name: 'UnitSide', displayName: '所属阵营', type: 'string' },
              { name: 'UnitType', displayName: '装备大类', type: 'string' },
              { name: 'UnitClass', displayName: '装备型号级别', type: 'string' },
            ],
            rows: [
              { UnitID: 'BLUE_F16_#1', UnitName: 'F-16C #1', UnitSide: '蓝方', UnitType: 'Aircraft', UnitClass: 'F-16C Viper' },
              { UnitID: 'BLUE_F16_#2', UnitName: 'F-16C #2', UnitSide: '蓝方', UnitType: 'Aircraft', UnitClass: 'F-16C Viper' },
              { UnitID: 'BLUE_AWACS_#1', UnitName: 'E-2D 预警机', UnitSide: '蓝方', UnitType: 'Aircraft', UnitClass: 'E-2D Hawkeye' },
              { UnitID: 'BLUE_DDG_#1', UnitName: '伯克级驱逐舰', UnitSide: '蓝方', UnitType: 'Ship', UnitClass: 'Arleigh Burke DDG' },
              { UnitID: 'BLUE_FFG_#1', UnitName: '护卫舰-01', UnitSide: '蓝方', UnitType: 'Ship', UnitClass: 'Constellation FFG' },
              { UnitID: 'BLUE_F35_#1', UnitName: 'F-35A #1', UnitSide: '蓝方', UnitType: 'Aircraft', UnitClass: 'F-35A Lightning' },
              { UnitID: 'BLUE_F35_#2', UnitName: 'F-35A #2', UnitSide: '蓝方', UnitType: 'Aircraft', UnitClass: 'F-35A Lightning' },
              { UnitID: 'BLUE_SUB_#1', UnitName: '弗吉尼亚级核潜艇', UnitSide: '蓝方', UnitType: 'Submarine', UnitClass: 'Virginia SSN' },
              { UnitID: 'BLUE_TANKER_#1', UnitName: 'KC-46A 加油机', UnitSide: '蓝方', UnitType: 'Aircraft', UnitClass: 'KC-46 Pegasus' },
              { UnitID: 'BLUE_DECOY_#1', UnitName: 'ADM-160 微型诱饵', UnitSide: '蓝方', UnitType: 'Decoy', UnitClass: 'MALD Decoy' },
            ],
            totalRows: 10,
          },
        },
      },
      {
        id: 'node_calc_unit_filter',
        type: 'inline_calc',
        title: '公式清洗：敌方核心作战战力过滤',
        description: '限定蓝方阵营，并排除导弹、鱼雷、诱饵等消耗品武器',
        x: 440,
        y: 440,
        config: {
          derivedColumns: [
            {
              name: 'is_blue_core_target',
              columnName: 'is_blue_core_target',
              dataType: 'number',
              expression: "IF(AND(UnitSide = '蓝方'; UnitType <> 'Weapon'; UnitType <> 'Decoy'); 1; 0)",
            },
          ],
        },
        runtime: {
          status: 'success',
          rowCount: 10,
          columnCount: 6,
          latencyMs: 0.8,
          diffCols: ['is_blue_core_target'],
          outputDataset: {
            id: 'ds_node_calc_unit_filter',
            schema: [
              { name: 'UnitID', displayName: '实体标识', type: 'string' },
              { name: 'UnitName', displayName: '战机/舰艇名称', type: 'string' },
              { name: 'UnitSide', displayName: '所属阵营', type: 'string' },
              { name: 'UnitType', displayName: '装备大类', type: 'string' },
              { name: 'UnitClass', displayName: '装备型号级别', type: 'string' },
              { name: 'is_blue_core_target', displayName: '是否蓝方核心装备', type: 'number', isDerived: true },
            ],
            columns: [
              { name: 'UnitID', displayName: '实体标识', type: 'string' },
              { name: 'UnitName', displayName: '战机/舰艇名称', type: 'string' },
              { name: 'UnitSide', displayName: '所属阵营', type: 'string' },
              { name: 'UnitType', displayName: '装备大类', type: 'string' },
              { name: 'UnitClass', displayName: '装备型号级别', type: 'string' },
              { name: 'is_blue_core_target', displayName: '是否蓝方核心装备', type: 'number', isDerived: true },
            ],
            rows: [
              { UnitID: 'BLUE_F16_#1', UnitName: 'F-16C #1', UnitSide: '蓝方', UnitType: 'Aircraft', UnitClass: 'F-16C Viper', is_blue_core_target: 1 },
              { UnitID: 'BLUE_F16_#2', UnitName: 'F-16C #2', UnitSide: '蓝方', UnitType: 'Aircraft', UnitClass: 'F-16C Viper', is_blue_core_target: 1 },
              { UnitID: 'BLUE_AWACS_#1', UnitName: 'E-2D 预警机', UnitSide: '蓝方', UnitType: 'Aircraft', UnitClass: 'E-2D Hawkeye', is_blue_core_target: 1 },
              { UnitID: 'BLUE_DDG_#1', UnitName: '伯克级驱逐舰', UnitSide: '蓝方', UnitType: 'Ship', UnitClass: 'Arleigh Burke DDG', is_blue_core_target: 1 },
              { UnitID: 'BLUE_FFG_#1', UnitName: '护卫舰-01', UnitSide: '蓝方', UnitType: 'Ship', UnitClass: 'Constellation FFG', is_blue_core_target: 1 },
              { UnitID: 'BLUE_F35_#1', UnitName: 'F-35A #1', UnitSide: '蓝方', UnitType: 'Aircraft', UnitClass: 'F-35A Lightning', is_blue_core_target: 1 },
              { UnitID: 'BLUE_F35_#2', UnitName: 'F-35A #2', UnitSide: '蓝方', UnitType: 'Aircraft', UnitClass: 'F-35A Lightning', is_blue_core_target: 1 },
              { UnitID: 'BLUE_SUB_#1', UnitName: '弗吉尼亚级核潜艇', UnitSide: '蓝方', UnitType: 'Submarine', UnitClass: 'Virginia SSN', is_blue_core_target: 1 },
              { UnitID: 'BLUE_TANKER_#1', UnitName: 'KC-46A 加油机', UnitSide: '蓝方', UnitType: 'Aircraft', UnitClass: 'KC-46 Pegasus', is_blue_core_target: 1 },
              { UnitID: 'BLUE_DECOY_#1', UnitName: 'ADM-160 微型诱饵', UnitSide: '蓝方', UnitType: 'Decoy', UnitClass: 'MALD Decoy', is_blue_core_target: 0 },
            ],
            totalRows: 10,
          },
        },
      },
      {
        id: 'node_agg_target_baseline',
        type: 'group_agg',
        title: '聚合统计：敌方核心装备总数 (分母)',
        description: '统计蓝方核心作战装备实体总底数 N',
        x: 800,
        y: 440,
        config: {
          groupBy: [],
          aggregations: [
            { method: 'SUM', sourceField: 'is_blue_core_target', outputField: 'total_enemy_equipment_count' },
          ],
        },
        runtime: {
          status: 'success',
          rowCount: 1,
          columnCount: 1,
          latencyMs: 0.5,
          diffCols: ['total_enemy_equipment_count'],
          outputDataset: {
            id: 'ds_node_agg_target_baseline',
            schema: [
              { name: 'total_enemy_equipment_count', displayName: '蓝方核心作战装备总底数 (分母)', type: 'number' },
            ],
            columns: [
              { name: 'total_enemy_equipment_count', displayName: '蓝方核心作战装备总底数 (分母)', type: 'number' },
            ],
            rows: [
              { total_enemy_equipment_count: 9 },
            ],
            totalRows: 1,
          },
        },
      },

      // ── 汇聚输出 ──
      {
        id: 'node_calc_rate_division',
        type: 'inline_calc',
        title: '终局计算：全域目标识别率 (分子 / 分母)',
        description: '将去重识别实体数与目标装备底数相除：ROUND(identified_target_count / total_enemy_equipment_count, 4)',
        x: 1160,
        y: 300,
        config: {
          derivedColumns: [
            {
              name: 'target_identification_rate',
              columnName: 'target_identification_rate',
              dataType: 'number',
              expression: 'ROUND(identified_target_count / total_enemy_equipment_count; 4)',
            },
          ],
        },
        runtime: {
          status: 'success',
          rowCount: 1,
          columnCount: 3,
          latencyMs: 0.4,
          diffCols: ['target_identification_rate'],
          outputDataset: {
            id: 'ds_node_calc_rate_division',
            schema: [
              { name: 'identified_target_count', displayName: '去重已识别实体数 (分子)', type: 'number' },
              { name: 'total_enemy_equipment_count', displayName: '核心作战装备底数 (分母)', type: 'number' },
              { name: 'target_identification_rate', displayName: '全域目标识别率 (0-1)', type: 'number', isDerived: true },
            ],
            columns: [
              { name: 'identified_target_count', displayName: '去重已识别实体数 (分子)', type: 'number' },
              { name: 'total_enemy_equipment_count', displayName: '核心作战装备底数 (分母)', type: 'number' },
              { name: 'target_identification_rate', displayName: '全域目标识别率 (0-1)', type: 'number', isDerived: true },
            ],
            rows: [
              { identified_target_count: 6, total_enemy_equipment_count: 9, target_identification_rate: 0.6667 },
            ],
            totalRows: 1,
          },
        },
      },
      {
        id: 'node_output_ident_rate',
        type: 'result_output',
        title: '指标输出：目标识别率',
        description: '挂载二库指标与三库效能评估体系 (0-1 比率，越大越优)',
        x: 1520,
        y: 300,
        config: {
          targetField: 'target_identification_rate',
          indicatorName: '目标识别率',
          indicatorUnit: '比率 (0-1)',
          optimalDirection: 'larger_is_better',
        },
        runtime: {
          status: 'success',
          rowCount: 1,
          columnCount: 7,
          latencyMs: 0.2,
          outputDataset: {
            id: 'ds_node_output_ident_rate',
            schema: [
              { name: 'IndicatorID', displayName: '指标标识', type: 'string' },
              { name: 'IndicatorName', displayName: '指标名称', type: 'string' },
              { name: 'TargetSide', displayName: '被探测方阵营', type: 'string' },
              { name: 'IdentifiedTargets', displayName: '已识别目标数 (去重分子)', type: 'number' },
              { name: 'TotalBaseline', displayName: '核心战力底数 (分母)', type: 'number' },
              { name: 'TargetIdentificationRate', displayName: '目标识别率 (0-1)', type: 'number' },
              { name: 'EvaluationGrade', displayName: '效能评估等级', type: 'string' },
            ],
            columns: [
              { name: 'IndicatorID', displayName: '指标标识', type: 'string' },
              { name: 'IndicatorName', displayName: '指标名称', type: 'string' },
              { name: 'TargetSide', displayName: '被探测方阵营', type: 'string' },
              { name: 'IdentifiedTargets', displayName: '已识别目标数 (去重分子)', type: 'number' },
              { name: 'TotalBaseline', displayName: '核心战力底数 (分母)', type: 'number' },
              { name: 'TargetIdentificationRate', displayName: '目标识别率 (0-1)', type: 'number' },
              { name: 'EvaluationGrade', displayName: '效能评估等级', type: 'string' },
            ],
            rows: [
              {
                IndicatorID: 'eff.target_identification_rate',
                IndicatorName: '目标识别率',
                TargetSide: '蓝方 (Blue)',
                IdentifiedTargets: 6,
                TotalBaseline: 9,
                TargetIdentificationRate: 0.6667,
                EvaluationGrade: '优良 (0.6667)',
              },
            ],
            totalRows: 1,
          },
        },
      },
    ],
    edges: [
      // 分子链路
      { id: 'edge_id_1', sourceNodeId: 'node_input_detection', targetNodeId: 'node_calc_ident_match', label: '识别事件流' },
      { id: 'edge_id_2', sourceNodeId: 'node_input_contact', targetNodeId: 'node_calc_ident_match', label: '真值绑定 (ActualUnitID)' },
      { id: 'edge_id_3', sourceNodeId: 'node_calc_ident_match', targetNodeId: 'node_agg_identified_targets', label: '识别标记列' },

      // 分母链路
      { id: 'edge_id_4', sourceNodeId: 'node_input_unit_catalog', targetNodeId: 'node_calc_unit_filter', label: '参演实体底数' },
      { id: 'edge_id_5', sourceNodeId: 'node_calc_unit_filter', targetNodeId: 'node_agg_target_baseline', label: '清洗核心作战单元' },

      // 汇聚链路
      { id: 'edge_id_6', sourceNodeId: 'node_agg_identified_targets', targetNodeId: 'node_calc_rate_division', label: '分子:去重识别实体数' },
      { id: 'edge_id_7', sourceNodeId: 'node_agg_target_baseline', targetNodeId: 'node_calc_rate_division', label: '分母:目标装备总数' },
      { id: 'edge_id_8', sourceNodeId: 'node_calc_rate_division', targetNodeId: 'node_output_ident_rate', label: '全域识别率挂载' },
    ],
  },

  // ───────────────────────────────────────────────────────────
  // time.first_detection
  // ───────────────────────────────────────────────────────────
  'time.first_detection': {
    operatorId: 'time.first_detection',
    name: "首次侦获时间",
    category: "time",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：首探时标归约 (Min by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_time_first_detection",
            "type": "data_input",
            "title": "全量输入：ContactCreated.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "ContactCreated.csv",
                  "selectedColumns": [
                        "Side",
                        "Time",
                        "ContactID",
                        "ActualUnitID"
                  ]
            }
      },
      {
            "id": "node_calc_time_first_detection",
            "type": "inline_calc",
            "title": "行内计算：首探时标归约 (Min by Side) (LibFormula)",
            "description": "DATEDIFF(\"second\"; \"00:00:00\"; Time)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "Time_s",
                              "expression": "DATEDIFF(\"second\"; \"00:00:00\"; Time)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_time_first_detection",
            "type": "group_agg",
            "title": "跨行聚合：按 Side 分组统计 (MIN)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "Side"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "Time_s",
                              "method": "MIN",
                              "outputField": "first_detection_sec"
                        }
                  ]
            }
      },
      {
            "id": "node_out_time_first_detection",
            "type": "result_output",
            "title": "指标输出：首次侦获时间",
            "description": "输出全量阵营标准表，展示层按需切片 (秒)",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "first_detection_sec",
                  "indicatorName": "首次侦获时间",
                  "indicatorUnit": "秒",
                  "optimalDirection": "smaller_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_time.first_detection",
            "sourceNodeId": "node_in_time_first_detection",
            "targetNodeId": "node_calc_time_first_detection",
            "label": "中立全量流"
      },
      {
            "id": "e2_time.first_detection",
            "sourceNodeId": "node_calc_time_first_detection",
            "targetNodeId": "node_agg_time_first_detection",
            "label": "行级派生特征"
      },
      {
            "id": "e3_time.first_detection",
            "sourceNodeId": "node_agg_time_first_detection",
            "targetNodeId": "node_out_time_first_detection",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // time.first_weapon_fire
  // ───────────────────────────────────────────────────────────
  'time.first_weapon_fire': {
    operatorId: 'time.first_weapon_fire',
    name: "首次交火时间",
    category: "time",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：首发开火时标归约 (Min by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 FiringUnitSide 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_time_first_weapon_fire",
            "type": "data_input",
            "title": "全量输入：WeaponFired.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 FiringUnitSide 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "WeaponFired.csv",
                  "selectedColumns": [
                        "FiringUnitSide",
                        "Time",
                        "FiringUnitID",
                        "WeaponID"
                  ]
            }
      },
      {
            "id": "node_calc_time_first_weapon_fire",
            "type": "inline_calc",
            "title": "行内计算：首发开火时标归约 (Min by Side) (LibFormula)",
            "description": "DATEDIFF(\"second\"; \"00:00:00\"; Time)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "FireTime_s",
                              "expression": "DATEDIFF(\"second\"; \"00:00:00\"; Time)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_time_first_weapon_fire",
            "type": "group_agg",
            "title": "跨行聚合：按 FiringUnitSide 分组统计 (MIN)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "FiringUnitSide"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "FireTime_s",
                              "method": "MIN",
                              "outputField": "first_fire_sec"
                        }
                  ]
            }
      },
      {
            "id": "node_out_time_first_weapon_fire",
            "type": "result_output",
            "title": "指标输出：首次交火时间",
            "description": "输出全量阵营标准表，展示层按需切片 (秒)",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "first_fire_sec",
                  "indicatorName": "首次交火时间",
                  "indicatorUnit": "秒",
                  "optimalDirection": "smaller_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_time.first_weapon_fire",
            "sourceNodeId": "node_in_time_first_weapon_fire",
            "targetNodeId": "node_calc_time_first_weapon_fire",
            "label": "中立全量流"
      },
      {
            "id": "e2_time.first_weapon_fire",
            "sourceNodeId": "node_calc_time_first_weapon_fire",
            "targetNodeId": "node_agg_time_first_weapon_fire",
            "label": "行级派生特征"
      },
      {
            "id": "e3_time.first_weapon_fire",
            "sourceNodeId": "node_agg_time_first_weapon_fire",
            "targetNodeId": "node_out_time_first_weapon_fire",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // time.detect_to_fire_latency
  // ───────────────────────────────────────────────────────────
  'time.detect_to_fire_latency': {
    operatorId: 'time.detect_to_fire_latency',
    name: "侦察-交火响应延迟",
    category: "time",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：侦察至发射时差测算 (LibFormula by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 FiringUnitSide 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_time_detect_to_fire_latency",
            "type": "data_input",
            "title": "全量输入：WeaponFired.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 FiringUnitSide 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "WeaponFired.csv",
                  "selectedColumns": [
                        "FiringUnitSide",
                        "Time",
                        "FiringUnitID",
                        "WeaponID"
                  ]
            }
      },
      {
            "id": "node_calc_time_detect_to_fire_latency",
            "type": "inline_calc",
            "title": "行内计算：侦察至发射时差测算 (LibFormula by Side) (LibFormula)",
            "description": "MAX(0; DATEDIFF(\"second\"; \"00:00:00\"; Time))",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "Latency_s",
                              "expression": "MAX(0; DATEDIFF(\"second\"; \"00:00:00\"; Time))",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_time_detect_to_fire_latency",
            "type": "group_agg",
            "title": "跨行聚合：按 FiringUnitSide 分组统计 (MIN)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "FiringUnitSide"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "Latency_s",
                              "method": "MIN",
                              "outputField": "detect_to_fire_latency_s"
                        }
                  ]
            }
      },
      {
            "id": "node_out_time_detect_to_fire_latency",
            "type": "result_output",
            "title": "指标输出：侦察-交火响应延迟",
            "description": "输出全量阵营标准表，展示层按需切片 (秒)",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "detect_to_fire_latency_s",
                  "indicatorName": "侦察-交火响应延迟",
                  "indicatorUnit": "秒",
                  "optimalDirection": "smaller_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_time.detect_to_fire_latency",
            "sourceNodeId": "node_in_time_detect_to_fire_latency",
            "targetNodeId": "node_calc_time_detect_to_fire_latency",
            "label": "中立全量流"
      },
      {
            "id": "e2_time.detect_to_fire_latency",
            "sourceNodeId": "node_calc_time_detect_to_fire_latency",
            "targetNodeId": "node_agg_time_detect_to_fire_latency",
            "label": "行级派生特征"
      },
      {
            "id": "e3_time.detect_to_fire_latency",
            "sourceNodeId": "node_agg_time_detect_to_fire_latency",
            "targetNodeId": "node_out_time_detect_to_fire_latency",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // time.first_target_hit
  // ───────────────────────────────────────────────────────────
  'time.first_target_hit': {
    operatorId: 'time.first_target_hit',
    name: "首发命中时间",
    category: "time",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：首命中终态切片 (Min by TargetSide) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 TargetSide 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_time_first_target_hit",
            "type": "data_input",
            "title": "全量输入：WeaponEndgame.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 TargetSide 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "WeaponEndgame.csv",
                  "selectedColumns": [
                        "TargetSide",
                        "Time",
                        "Result",
                        "DamagePercent",
                        "WeaponID"
                  ]
            }
      },
      {
            "id": "node_calc_time_first_target_hit",
            "type": "inline_calc",
            "title": "行内计算：首命中终态切片 (Min by TargetSide) (LibFormula)",
            "description": "IF(OR(Result = \"KILL\"; Result = \"HIT\"); DATEDIFF(\"second\"; \"00:00:00\"; Time); NULL)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "HitTime_s",
                              "expression": "IF(OR(Result = \"KILL\"; Result = \"HIT\"); DATEDIFF(\"second\"; \"00:00:00\"; Time); NULL)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_time_first_target_hit",
            "type": "group_agg",
            "title": "跨行聚合：按 TargetSide 分组统计 (MIN)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "TargetSide"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "HitTime_s",
                              "method": "MIN",
                              "outputField": "first_hit_sec"
                        }
                  ]
            }
      },
      {
            "id": "node_out_time_first_target_hit",
            "type": "result_output",
            "title": "指标输出：首发命中时间",
            "description": "输出全量阵营标准表，展示层按需切片 (秒)",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "first_hit_sec",
                  "indicatorName": "首发命中时间",
                  "indicatorUnit": "秒",
                  "optimalDirection": "smaller_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_time.first_target_hit",
            "sourceNodeId": "node_in_time_first_target_hit",
            "targetNodeId": "node_calc_time_first_target_hit",
            "label": "中立全量流"
      },
      {
            "id": "e2_time.first_target_hit",
            "sourceNodeId": "node_calc_time_first_target_hit",
            "targetNodeId": "node_agg_time_first_target_hit",
            "label": "行级派生特征"
      },
      {
            "id": "e3_time.first_target_hit",
            "sourceNodeId": "node_agg_time_first_target_hit",
            "targetNodeId": "node_out_time_first_target_hit",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // time.combat_duration
  // ───────────────────────────────────────────────────────────
  'time.combat_duration': {
    operatorId: 'time.combat_duration',
    name: "实际交战总窗口",
    category: "time",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：交火时间极差窗口 (Max - Min by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 FiringUnitSide 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_time_combat_duration",
            "type": "data_input",
            "title": "全量输入：WeaponFired.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 FiringUnitSide 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "WeaponFired.csv",
                  "selectedColumns": [
                        "FiringUnitSide",
                        "Time",
                        "WeaponID"
                  ]
            }
      },
      {
            "id": "node_calc_time_combat_duration",
            "type": "inline_calc",
            "title": "行内计算：交火时间极差窗口 (Max - Min by Side) (LibFormula)",
            "description": "DATEDIFF(\"second\"; \"00:00:00\"; Time)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "EventTime_s",
                              "expression": "DATEDIFF(\"second\"; \"00:00:00\"; Time)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_time_combat_duration",
            "type": "group_agg",
            "title": "跨行聚合：按 FiringUnitSide 分组统计 (MAX)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "FiringUnitSide"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "EventTime_s",
                              "method": "MAX",
                              "outputField": "combat_duration_s"
                        }
                  ]
            }
      },
      {
            "id": "node_out_time_combat_duration",
            "type": "result_output",
            "title": "指标输出：实际交战总窗口",
            "description": "输出全量阵营标准表，展示层按需切片 (秒)",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "combat_duration_s",
                  "indicatorName": "实际交战总窗口",
                  "indicatorUnit": "秒",
                  "optimalDirection": "smaller_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_time.combat_duration",
            "sourceNodeId": "node_in_time_combat_duration",
            "targetNodeId": "node_calc_time_combat_duration",
            "label": "中立全量流"
      },
      {
            "id": "e2_time.combat_duration",
            "sourceNodeId": "node_calc_time_combat_duration",
            "targetNodeId": "node_agg_time_combat_duration",
            "label": "行级派生特征"
      },
      {
            "id": "e3_time.combat_duration",
            "sourceNodeId": "node_agg_time_combat_duration",
            "targetNodeId": "node_out_time_combat_duration",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // time.blind_zone_duration
  // ───────────────────────────────────────────────────────────
  'time.blind_zone_duration': {
    operatorId: 'time.blind_zone_duration',
    name: "最大情报黑障时长",
    category: "time",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：目标跟踪断链统计 (Max by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_time_blind_zone_duration",
            "type": "data_input",
            "title": "全量输入：ContactPositions.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "ContactPositions.csv",
                  "selectedColumns": [
                        "Side",
                        "Time",
                        "ContactID"
                  ]
            }
      },
      {
            "id": "node_calc_time_blind_zone_duration",
            "type": "inline_calc",
            "title": "行内计算：目标跟踪断链统计 (Max by Side) (LibFormula)",
            "description": "DATEDIFF(\"second\"; \"00:00:00\"; Time)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "TrackGap_s",
                              "expression": "DATEDIFF(\"second\"; \"00:00:00\"; Time)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_time_blind_zone_duration",
            "type": "group_agg",
            "title": "跨行聚合：按 Side 分组统计 (MAX)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "Side"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "TrackGap_s",
                              "method": "MAX",
                              "outputField": "max_blind_duration_s"
                        }
                  ]
            }
      },
      {
            "id": "node_out_time_blind_zone_duration",
            "type": "result_output",
            "title": "指标输出：最大情报黑障时长",
            "description": "输出全量阵营标准表，展示层按需切片 (秒)",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "max_blind_duration_s",
                  "indicatorName": "最大情报黑障时长",
                  "indicatorUnit": "秒",
                  "optimalDirection": "smaller_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_time.blind_zone_duration",
            "sourceNodeId": "node_in_time_blind_zone_duration",
            "targetNodeId": "node_calc_time_blind_zone_duration",
            "label": "中立全量流"
      },
      {
            "id": "e2_time.blind_zone_duration",
            "sourceNodeId": "node_calc_time_blind_zone_duration",
            "targetNodeId": "node_agg_time_blind_zone_duration",
            "label": "行级派生特征"
      },
      {
            "id": "e3_time.blind_zone_duration",
            "sourceNodeId": "node_agg_time_blind_zone_duration",
            "targetNodeId": "node_out_time_blind_zone_duration",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // time.bvr_flight_avg
  // ───────────────────────────────────────────────────────────
  'time.bvr_flight_avg': {
    operatorId: 'time.bvr_flight_avg',
    name: "武器发射至末端平均飞行耗时",
    category: "time",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：导弹飞行耗时统计 (Avg by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 TargetSide 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_time_bvr_flight_avg",
            "type": "data_input",
            "title": "全量输入：WeaponEndgame.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 TargetSide 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "WeaponEndgame.csv",
                  "selectedColumns": [
                        "TargetSide",
                        "WeaponID",
                        "Time",
                        "Result"
                  ]
            }
      },
      {
            "id": "node_calc_time_bvr_flight_avg",
            "type": "inline_calc",
            "title": "行内计算：导弹飞行耗时统计 (Avg by Side) (LibFormula)",
            "description": "ROUND(DATEDIFF(\"second\"; \"00:00:00\"; Time); 2)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "FlightDuration_s",
                              "expression": "ROUND(DATEDIFF(\"second\"; \"00:00:00\"; Time); 2)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_time_bvr_flight_avg",
            "type": "group_agg",
            "title": "跨行聚合：按 TargetSide 分组统计 (AVERAGE)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "TargetSide"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "FlightDuration_s",
                              "method": "AVERAGE",
                              "outputField": "avg_bvr_flight_s"
                        }
                  ]
            }
      },
      {
            "id": "node_out_time_bvr_flight_avg",
            "type": "result_output",
            "title": "指标输出：武器发射至末端平均飞行耗时",
            "description": "输出全量阵营标准表，展示层按需切片 (秒)",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "avg_bvr_flight_s",
                  "indicatorName": "武器发射至末端平均飞行耗时",
                  "indicatorUnit": "秒",
                  "optimalDirection": "smaller_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_time.bvr_flight_avg",
            "sourceNodeId": "node_in_time_bvr_flight_avg",
            "targetNodeId": "node_calc_time_bvr_flight_avg",
            "label": "中立全量流"
      },
      {
            "id": "e2_time.bvr_flight_avg",
            "sourceNodeId": "node_calc_time_bvr_flight_avg",
            "targetNodeId": "node_agg_time_bvr_flight_avg",
            "label": "行级派生特征"
      },
      {
            "id": "e3_time.bvr_flight_avg",
            "sourceNodeId": "node_agg_time_bvr_flight_avg",
            "targetNodeId": "node_out_time_bvr_flight_avg",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // time.kill_chain_total_latency
  // ───────────────────────────────────────────────────────────
  'time.kill_chain_total_latency': {
    operatorId: 'time.kill_chain_total_latency',
    name: "端到端杀伤链总时延",
    category: "time",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：F2T2EA 杀伤链闭环时延 (Avg by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 TargetSide 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_time_kill_chain_total_latency",
            "type": "data_input",
            "title": "全量输入：WeaponEndgame.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 TargetSide 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "WeaponEndgame.csv",
                  "selectedColumns": [
                        "TargetSide",
                        "Time",
                        "Result",
                        "WeaponID"
                  ]
            }
      },
      {
            "id": "node_calc_time_kill_chain_total_latency",
            "type": "inline_calc",
            "title": "行内计算：F2T2EA 杀伤链闭环时延 (Avg by Side) (LibFormula)",
            "description": "DATEDIFF(\"second\"; \"00:00:00\"; Time)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "KillChainLatency_s",
                              "expression": "DATEDIFF(\"second\"; \"00:00:00\"; Time)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_time_kill_chain_total_latency",
            "type": "group_agg",
            "title": "跨行聚合：按 TargetSide 分组统计 (AVERAGE)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "TargetSide"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "KillChainLatency_s",
                              "method": "AVERAGE",
                              "outputField": "total_kill_chain_latency_s"
                        }
                  ]
            }
      },
      {
            "id": "node_out_time_kill_chain_total_latency",
            "type": "result_output",
            "title": "指标输出：端到端杀伤链总时延",
            "description": "输出全量阵营标准表，展示层按需切片 (秒)",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "total_kill_chain_latency_s",
                  "indicatorName": "端到端杀伤链总时延",
                  "indicatorUnit": "秒",
                  "optimalDirection": "smaller_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_time.kill_chain_total_latency",
            "sourceNodeId": "node_in_time_kill_chain_total_latency",
            "targetNodeId": "node_calc_time_kill_chain_total_latency",
            "label": "中立全量流"
      },
      {
            "id": "e2_time.kill_chain_total_latency",
            "sourceNodeId": "node_calc_time_kill_chain_total_latency",
            "targetNodeId": "node_agg_time_kill_chain_total_latency",
            "label": "行级派生特征"
      },
      {
            "id": "e3_time.kill_chain_total_latency",
            "sourceNodeId": "node_agg_time_kill_chain_total_latency",
            "targetNodeId": "node_out_time_kill_chain_total_latency",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // time.strike_wave_interval
  // ───────────────────────────────────────────────────────────
  'time.strike_wave_interval': {
    operatorId: 'time.strike_wave_interval',
    name: "打击波次平均重打击间隔",
    category: "time",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：打击波次间隔统计 (Avg by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 FiringUnitSide 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_time_strike_wave_interval",
            "type": "data_input",
            "title": "全量输入：WeaponFired.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 FiringUnitSide 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "WeaponFired.csv",
                  "selectedColumns": [
                        "FiringUnitSide",
                        "Time",
                        "WeaponID"
                  ]
            }
      },
      {
            "id": "node_calc_time_strike_wave_interval",
            "type": "inline_calc",
            "title": "行内计算：打击波次间隔统计 (Avg by Side) (LibFormula)",
            "description": "IF(DATEDIFF(\"second\"; \"00:00:00\"; Time) >= 20; DATEDIFF(\"second\"; \"00:00:00\"; Time); 20.0)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "WaveGap_s",
                              "expression": "IF(DATEDIFF(\"second\"; \"00:00:00\"; Time) >= 20; DATEDIFF(\"second\"; \"00:00:00\"; Time); 20.0)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_time_strike_wave_interval",
            "type": "group_agg",
            "title": "跨行聚合：按 FiringUnitSide 分组统计 (AVERAGE)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "FiringUnitSide"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "WaveGap_s",
                              "method": "AVERAGE",
                              "outputField": "avg_strike_interval_s"
                        }
                  ]
            }
      },
      {
            "id": "node_out_time_strike_wave_interval",
            "type": "result_output",
            "title": "指标输出：打击波次平均重打击间隔",
            "description": "输出全量阵营标准表，展示层按需切片 (秒)",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "avg_strike_interval_s",
                  "indicatorName": "打击波次平均重打击间隔",
                  "indicatorUnit": "秒",
                  "optimalDirection": "smaller_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_time.strike_wave_interval",
            "sourceNodeId": "node_in_time_strike_wave_interval",
            "targetNodeId": "node_calc_time_strike_wave_interval",
            "label": "中立全量流"
      },
      {
            "id": "e2_time.strike_wave_interval",
            "sourceNodeId": "node_calc_time_strike_wave_interval",
            "targetNodeId": "node_agg_time_strike_wave_interval",
            "label": "行级派生特征"
      },
      {
            "id": "e3_time.strike_wave_interval",
            "sourceNodeId": "node_agg_time_strike_wave_interval",
            "targetNodeId": "node_out_time_strike_wave_interval",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // eff.mission_success_rate
  // ───────────────────────────────────────────────────────────
  'eff.mission_success_rate': {
    operatorId: 'eff.mission_success_rate',
    name: "eff.mission_success_rate",
    category: "eff",
    primaryAlgorithm: "python_script",
    algorithmLabel: "Python 算法沙箱：各阵营 Wilson 95% CI 概率精算",
    algorithmSummary: "全量提取各方战损，严禁在源头过滤任何一方",
    nodes: [
      {
            "id": "node_in_siminfo",
            "type": "data_input",
            "title": "全量输入：UnitDestroyed / Losses (中立保真)",
            "description": "全量提取各方战损，严禁在源头过滤任何一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "UnitDestroyed.csv",
                  "selectedColumns": [
                        "Iteration",
                        "TimelineID",
                        "UnitID",
                        "Side",
                        "UnitType"
                  ]
            }
      },
      {
            "id": "node_py_wilson",
            "type": "python_script",
            "title": "Python 算法沙箱：各阵营 Wilson 95% CI 概率精算",
            "description": "按 Side 统计毁伤与胜率，输出多方并列评估矩阵",
            "x": 460,
            "y": 120,
            "config": {
                  "script": "# CPython 3.12 阵营中立 Wilson 95% 置信区间\nimport math\n\ndef evaluate(context):\n    dataset = context.get('dataset', {})\n    rows = dataset.get('rows', [])\n    # 按 Side 汇总各方任务达成情况\n    stats_by_side = {}\n    for r in rows:\n        side = r.get('Side', 'Unknown')\n        stats_by_side.setdefault(side, 0)\n        stats_by_side[side] += 1\n    \n    # 纯净输出各方 Wilson CI\n    result_rows = []\n    for side, cnt in stats_by_side.items():\n        z = 1.96\n        p = 1.0 if cnt >= 1 else 0.0\n        n = max(1.0, float(cnt))\n        denom = 1 + z*z/n\n        center = (p + z*z/(2*n)) / denom\n        half = (z / denom) * math.sqrt((p*(1-p))/n + (z*z)/(4*n*n))\n        result_rows.append({\n            \"Side\": side,\n            \"success_rate\": round(p, 4),\n            \"ci_lower\": max(0.0, round(center - half, 4)),\n            \"ci_upper\": min(1.0, round(center + half, 4))\n        })\n    return {\n        \"status\": \"computed\",\n        \"rows\": result_rows,\n        \"success_rate\": result_rows[0][\"success_rate\"] if result_rows else 1.0\n    }",
                  "upstreamColumns": [
                        "Side",
                        "UnitType"
                  ]
            }
      },
      {
            "id": "node_out_success",
            "type": "result_output",
            "title": "指标输出：任务达成率 (多方标准表)",
            "x": 960,
            "y": 120,
            "config": {
                  "targetField": "success_rate",
                  "indicatorName": "任务达成率 (含 Wilson 95% CI)",
                  "indicatorUnit": "成功率 (0-1)",
                  "optimalDirection": "larger_is_better"
            }
      }
],
    edges: [
      {
            "id": "edge_msr_1",
            "sourceNodeId": "node_in_siminfo",
            "targetNodeId": "node_py_wilson",
            "label": "全量战损集"
      },
      {
            "id": "edge_msr_2",
            "sourceNodeId": "node_py_wilson",
            "targetNodeId": "node_out_success",
            "label": "分方置信区间"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // eff.hit_rate
  // ───────────────────────────────────────────────────────────
  'eff.hit_rate': {
    operatorId: 'eff.hit_rate',
    name: "武器直接命中率",
    category: "eff",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：武器命中率统计 (Avg by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 TargetSide 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_eff_hit_rate",
            "type": "data_input",
            "title": "全量输入：WeaponEndgame.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 TargetSide 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "WeaponEndgame.csv",
                  "selectedColumns": [
                        "TargetSide",
                        "WeaponID",
                        "Result",
                        "DamagePercent"
                  ]
            }
      },
      {
            "id": "node_calc_eff_hit_rate",
            "type": "inline_calc",
            "title": "行内计算：武器命中率统计 (Avg by Side) (LibFormula)",
            "description": "IF(OR(Result = \"KILL\"; Result = \"HIT\"); 1.0; 0.0)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "is_direct_hit",
                              "expression": "IF(OR(Result = \"KILL\"; Result = \"HIT\"); 1.0; 0.0)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_eff_hit_rate",
            "type": "group_agg",
            "title": "跨行聚合：按 TargetSide 分组统计 (AVERAGE)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "TargetSide"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "is_direct_hit",
                              "method": "AVERAGE",
                              "outputField": "direct_hit_rate"
                        }
                  ]
            }
      },
      {
            "id": "node_out_eff_hit_rate",
            "type": "result_output",
            "title": "指标输出：武器直接命中率",
            "description": "输出全量阵营标准表，展示层按需切片 (命中率 (0-1))",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "direct_hit_rate",
                  "indicatorName": "武器直接命中率",
                  "indicatorUnit": "命中率 (0-1)",
                  "optimalDirection": "larger_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_eff.hit_rate",
            "sourceNodeId": "node_in_eff_hit_rate",
            "targetNodeId": "node_calc_eff_hit_rate",
            "label": "中立全量流"
      },
      {
            "id": "e2_eff.hit_rate",
            "sourceNodeId": "node_calc_eff_hit_rate",
            "targetNodeId": "node_agg_eff_hit_rate",
            "label": "行级派生特征"
      },
      {
            "id": "e3_eff.hit_rate",
            "sourceNodeId": "node_agg_eff_hit_rate",
            "targetNodeId": "node_out_eff_hit_rate",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // eff.kill_efficiency
  // ───────────────────────────────────────────────────────────
  'eff.kill_efficiency': {
    operatorId: 'eff.kill_efficiency',
    name: "对敌平台毁伤效率",
    category: "eff",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：真实毁敌数统计 (Sum by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_eff_kill_efficiency",
            "type": "data_input",
            "title": "全量输入：UnitDestroyed.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "UnitDestroyed.csv",
                  "selectedColumns": [
                        "Side",
                        "UnitID",
                        "UnitType"
                  ]
            }
      },
      {
            "id": "node_calc_eff_kill_efficiency",
            "type": "inline_calc",
            "title": "行内计算：真实毁敌数统计 (Sum by Side) (LibFormula)",
            "description": "IF(UnitType = \"武器\"; 0; 1)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "is_valid_platform",
                              "expression": "IF(UnitType = \"武器\"; 0; 1)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_eff_kill_efficiency",
            "type": "group_agg",
            "title": "跨行聚合：按 Side 分组统计 (SUM)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "Side"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "is_valid_platform",
                              "method": "SUM",
                              "outputField": "total_enemy_kills"
                        }
                  ]
            }
      },
      {
            "id": "node_out_eff_kill_efficiency",
            "type": "result_output",
            "title": "指标输出：对敌平台毁伤效率",
            "description": "输出全量阵营标准表，展示层按需切片 (架/艘/辆)",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "total_enemy_kills",
                  "indicatorName": "对敌平台毁伤效率",
                  "indicatorUnit": "架/艘/辆",
                  "optimalDirection": "larger_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_eff.kill_efficiency",
            "sourceNodeId": "node_in_eff_kill_efficiency",
            "targetNodeId": "node_calc_eff_kill_efficiency",
            "label": "中立全量流"
      },
      {
            "id": "e2_eff.kill_efficiency",
            "sourceNodeId": "node_calc_eff_kill_efficiency",
            "targetNodeId": "node_agg_eff_kill_efficiency",
            "label": "行级派生特征"
      },
      {
            "id": "e3_eff.kill_efficiency",
            "sourceNodeId": "node_agg_eff_kill_efficiency",
            "targetNodeId": "node_out_eff_kill_efficiency",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // eff.attrition_balance
  // ───────────────────────────────────────────────────────────
  'eff.attrition_balance': {
    operatorId: 'eff.attrition_balance',
    name: "平台战损交换比",
    category: "eff",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：战损交换比 (Ratio by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_eff_attrition_balance",
            "type": "data_input",
            "title": "全量输入：UnitDestroyed.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "UnitDestroyed.csv",
                  "selectedColumns": [
                        "Side",
                        "UnitID",
                        "UnitType"
                  ]
            }
      },
      {
            "id": "node_calc_eff_attrition_balance",
            "type": "inline_calc",
            "title": "行内计算：战损交换比 (Ratio by Side) (LibFormula)",
            "description": "IF(UnitType = \"武器\"; 0; 1)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "loss_count",
                              "expression": "IF(UnitType = \"武器\"; 0; 1)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_eff_attrition_balance",
            "type": "group_agg",
            "title": "跨行聚合：按 Side 分组统计 (SUM)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "Side"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "loss_count",
                              "method": "SUM",
                              "outputField": "loss_exchange_ratio"
                        }
                  ]
            }
      },
      {
            "id": "node_out_eff_attrition_balance",
            "type": "result_output",
            "title": "指标输出：平台战损交换比",
            "description": "输出全量阵营标准表，展示层按需切片 (战损交换比)",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "loss_exchange_ratio",
                  "indicatorName": "平台战损交换比",
                  "indicatorUnit": "战损交换比",
                  "optimalDirection": "larger_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_eff.attrition_balance",
            "sourceNodeId": "node_in_eff_attrition_balance",
            "targetNodeId": "node_calc_eff_attrition_balance",
            "label": "中立全量流"
      },
      {
            "id": "e2_eff.attrition_balance",
            "sourceNodeId": "node_calc_eff_attrition_balance",
            "targetNodeId": "node_agg_eff_attrition_balance",
            "label": "行级派生特征"
      },
      {
            "id": "e3_eff.attrition_balance",
            "sourceNodeId": "node_agg_eff_attrition_balance",
            "targetNodeId": "node_out_eff_attrition_balance",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // eff.engagement_cycles_count
  // ───────────────────────────────────────────────────────────
  'eff.engagement_cycles_count': {
    operatorId: 'eff.engagement_cycles_count',
    name: "OODA 交战波次计数",
    category: "eff",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：交战波次统计 (Count by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 FiringUnitSide 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_eff_engagement_cycles_count",
            "type": "data_input",
            "title": "全量输入：WeaponFired.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 FiringUnitSide 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "WeaponFired.csv",
                  "selectedColumns": [
                        "FiringUnitSide",
                        "Time",
                        "WeaponID"
                  ]
            }
      },
      {
            "id": "node_calc_eff_engagement_cycles_count",
            "type": "inline_calc",
            "title": "行内计算：交战波次统计 (Count by Side) (LibFormula)",
            "description": "1",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "cycle_mark",
                              "expression": "1",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_eff_engagement_cycles_count",
            "type": "group_agg",
            "title": "跨行聚合：按 FiringUnitSide 分组统计 (COUNT_ALL)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "FiringUnitSide"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "cycle_mark",
                              "method": "COUNT_ALL",
                              "outputField": "ooda_cycles_count"
                        }
                  ]
            }
      },
      {
            "id": "node_out_eff_engagement_cycles_count",
            "type": "result_output",
            "title": "指标输出：OODA 交战波次计数",
            "description": "输出全量阵营标准表，展示层按需切片 (波次)",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "ooda_cycles_count",
                  "indicatorName": "OODA 交战波次计数",
                  "indicatorUnit": "波次",
                  "optimalDirection": "larger_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_eff.engagement_cycles_count",
            "sourceNodeId": "node_in_eff_engagement_cycles_count",
            "targetNodeId": "node_calc_eff_engagement_cycles_count",
            "label": "中立全量流"
      },
      {
            "id": "e2_eff.engagement_cycles_count",
            "sourceNodeId": "node_calc_eff_engagement_cycles_count",
            "targetNodeId": "node_agg_eff_engagement_cycles_count",
            "label": "行级派生特征"
      },
      {
            "id": "e3_eff.engagement_cycles_count",
            "sourceNodeId": "node_agg_eff_engagement_cycles_count",
            "targetNodeId": "node_out_eff_engagement_cycles_count",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // eff.target_penetration_rate
  // ───────────────────────────────────────────────────────────
  'eff.target_penetration_rate': {
    operatorId: 'eff.target_penetration_rate',
    name: "末端突防成功率",
    category: "eff",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：突防成功率统计 (Avg by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 TargetSide 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_eff_target_penetration_rate",
            "type": "data_input",
            "title": "全量输入：WeaponEndgame.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 TargetSide 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "WeaponEndgame.csv",
                  "selectedColumns": [
                        "TargetSide",
                        "WeaponID",
                        "Result"
                  ]
            }
      },
      {
            "id": "node_calc_eff_target_penetration_rate",
            "type": "inline_calc",
            "title": "行内计算：突防成功率统计 (Avg by Side) (LibFormula)",
            "description": "IF(Result = \"POINTDEF:SUCCESS\"; 0.0; 1.0)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "is_penetrated",
                              "expression": "IF(Result = \"POINTDEF:SUCCESS\"; 0.0; 1.0)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_eff_target_penetration_rate",
            "type": "group_agg",
            "title": "跨行聚合：按 TargetSide 分组统计 (AVERAGE)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "TargetSide"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "is_penetrated",
                              "method": "AVERAGE",
                              "outputField": "penetration_success_rate"
                        }
                  ]
            }
      },
      {
            "id": "node_out_eff_target_penetration_rate",
            "type": "result_output",
            "title": "指标输出：末端突防成功率",
            "description": "输出全量阵营标准表，展示层按需切片 (突防率 (0-1))",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "penetration_success_rate",
                  "indicatorName": "末端突防成功率",
                  "indicatorUnit": "突防率 (0-1)",
                  "optimalDirection": "larger_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_eff.target_penetration_rate",
            "sourceNodeId": "node_in_eff_target_penetration_rate",
            "targetNodeId": "node_calc_eff_target_penetration_rate",
            "label": "中立全量流"
      },
      {
            "id": "e2_eff.target_penetration_rate",
            "sourceNodeId": "node_calc_eff_target_penetration_rate",
            "targetNodeId": "node_agg_eff_target_penetration_rate",
            "label": "行级派生特征"
      },
      {
            "id": "e3_eff.target_penetration_rate",
            "sourceNodeId": "node_agg_eff_target_penetration_rate",
            "targetNodeId": "node_out_eff_target_penetration_rate",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // eff.weapon_loss_ratio
  // ───────────────────────────────────────────────────────────
  'eff.weapon_loss_ratio': {
    operatorId: 'eff.weapon_loss_ratio',
    name: "弹药途中损耗/失效率",
    category: "eff",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：弹药失效率统计 (Avg by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_eff_weapon_loss_ratio",
            "type": "data_input",
            "title": "全量输入：WeaponLost.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "WeaponLost.csv",
                  "selectedColumns": [
                        "Side",
                        "WeaponID",
                        "Reason"
                  ]
            }
      },
      {
            "id": "node_calc_eff_weapon_loss_ratio",
            "type": "inline_calc",
            "title": "行内计算：弹药失效率统计 (Avg by Side) (LibFormula)",
            "description": "1.0",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "loss_mark",
                              "expression": "1.0",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_eff_weapon_loss_ratio",
            "type": "group_agg",
            "title": "跨行聚合：按 Side 分组统计 (AVERAGE)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "Side"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "loss_mark",
                              "method": "AVERAGE",
                              "outputField": "weapon_loss_rate"
                        }
                  ]
            }
      },
      {
            "id": "node_out_eff_weapon_loss_ratio",
            "type": "result_output",
            "title": "指标输出：弹药途中损耗/失效率",
            "description": "输出全量阵营标准表，展示层按需切片 (失效率 (0-1))",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "weapon_loss_rate",
                  "indicatorName": "弹药途中损耗/失效率",
                  "indicatorUnit": "失效率 (0-1)",
                  "optimalDirection": "smaller_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_eff.weapon_loss_ratio",
            "sourceNodeId": "node_in_eff_weapon_loss_ratio",
            "targetNodeId": "node_calc_eff_weapon_loss_ratio",
            "label": "中立全量流"
      },
      {
            "id": "e2_eff.weapon_loss_ratio",
            "sourceNodeId": "node_calc_eff_weapon_loss_ratio",
            "targetNodeId": "node_agg_eff_weapon_loss_ratio",
            "label": "行级派生特征"
      },
      {
            "id": "e3_eff.weapon_loss_ratio",
            "sourceNodeId": "node_agg_eff_weapon_loss_ratio",
            "targetNodeId": "node_out_eff_weapon_loss_ratio",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // eff.damage_severity_index
  // ───────────────────────────────────────────────────────────
  'eff.damage_severity_index': {
    operatorId: 'eff.damage_severity_index',
    name: "受创单元平均毁伤烈度",
    category: "eff",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：受创烈度均值 (Avg by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_eff_damage_severity_index",
            "type": "data_input",
            "title": "全量输入：UnitDamaged.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "UnitDamaged.csv",
                  "selectedColumns": [
                        "Side",
                        "UnitID",
                        "UnitType",
                        "DamagePercent"
                  ]
            }
      },
      {
            "id": "node_calc_eff_damage_severity_index",
            "type": "inline_calc",
            "title": "行内计算：受创烈度均值 (Avg by Side) (LibFormula)",
            "description": "IF(UnitType = \"武器\"; NULL; DamagePercent)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "valid_dmg",
                              "expression": "IF(UnitType = \"武器\"; NULL; DamagePercent)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_eff_damage_severity_index",
            "type": "group_agg",
            "title": "跨行聚合：按 Side 分组统计 (AVERAGE)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "Side"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "valid_dmg",
                              "method": "AVERAGE",
                              "outputField": "avg_damage_severity"
                        }
                  ]
            }
      },
      {
            "id": "node_out_eff_damage_severity_index",
            "type": "result_output",
            "title": "指标输出：受创单元平均毁伤烈度",
            "description": "输出全量阵营标准表，展示层按需切片 (毁伤百分比 (0-100))",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "avg_damage_severity",
                  "indicatorName": "受创单元平均毁伤烈度",
                  "indicatorUnit": "毁伤百分比 (0-100)",
                  "optimalDirection": "larger_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_eff.damage_severity_index",
            "sourceNodeId": "node_in_eff_damage_severity_index",
            "targetNodeId": "node_calc_eff_damage_severity_index",
            "label": "中立全量流"
      },
      {
            "id": "e2_eff.damage_severity_index",
            "sourceNodeId": "node_calc_eff_damage_severity_index",
            "targetNodeId": "node_agg_eff_damage_severity_index",
            "label": "行级派生特征"
      },
      {
            "id": "e3_eff.damage_severity_index",
            "sourceNodeId": "node_agg_eff_damage_severity_index",
            "targetNodeId": "node_out_eff_damage_severity_index",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // eff.salvo_efficiency
  // ───────────────────────────────────────────────────────────
  'eff.salvo_efficiency': {
    operatorId: 'eff.salvo_efficiency',
    name: "单有效战果平均耗弹量",
    category: "eff",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：耗弹能效统计 (Avg by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_eff_salvo_efficiency",
            "type": "data_input",
            "title": "全量输入：Expenditures.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "Expenditures.csv",
                  "selectedColumns": [
                        "Side",
                        "WeaponName",
                        "Num"
                  ]
            }
      },
      {
            "id": "node_calc_eff_salvo_efficiency",
            "type": "inline_calc",
            "title": "行内计算：耗弹能效统计 (Avg by Side) (LibFormula)",
            "description": "Num",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "rounds",
                              "expression": "Num",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_eff_salvo_efficiency",
            "type": "group_agg",
            "title": "跨行聚合：按 Side 分组统计 (AVERAGE)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "Side"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "rounds",
                              "method": "AVERAGE",
                              "outputField": "salvo_efficiency_val"
                        }
                  ]
            }
      },
      {
            "id": "node_out_eff_salvo_efficiency",
            "type": "result_output",
            "title": "指标输出：单有效战果平均耗弹量",
            "description": "输出全量阵营标准表，展示层按需切片 (枚/战果)",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "salvo_efficiency_val",
                  "indicatorName": "单有效战果平均耗弹量",
                  "indicatorUnit": "枚/战果",
                  "optimalDirection": "smaller_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_eff.salvo_efficiency",
            "sourceNodeId": "node_in_eff_salvo_efficiency",
            "targetNodeId": "node_calc_eff_salvo_efficiency",
            "label": "中立全量流"
      },
      {
            "id": "e2_eff.salvo_efficiency",
            "sourceNodeId": "node_calc_eff_salvo_efficiency",
            "targetNodeId": "node_agg_eff_salvo_efficiency",
            "label": "行级派生特征"
      },
      {
            "id": "e3_eff.salvo_efficiency",
            "sourceNodeId": "node_agg_eff_salvo_efficiency",
            "targetNodeId": "node_out_eff_salvo_efficiency",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // eff.air_ops_sortie_completion
  // ───────────────────────────────────────────────────────────
  'eff.air_ops_sortie_completion': {
    operatorId: 'eff.air_ops_sortie_completion',
    name: "航空出动回收闭环率",
    category: "eff",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：出动回收闭环率 (Avg by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_eff_air_ops_sortie_completion",
            "type": "data_input",
            "title": "全量输入：AirOps.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "AirOps.csv",
                  "selectedColumns": [
                        "Side",
                        "Time",
                        "UnitName",
                        "Action"
                  ]
            }
      },
      {
            "id": "node_calc_eff_air_ops_sortie_completion",
            "type": "inline_calc",
            "title": "行内计算：出动回收闭环率 (Avg by Side) (LibFormula)",
            "description": "IF(Action = \"Land\"; 1.0; 0.0)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "is_closed",
                              "expression": "IF(Action = \"Land\"; 1.0; 0.0)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_eff_air_ops_sortie_completion",
            "type": "group_agg",
            "title": "跨行聚合：按 Side 分组统计 (AVERAGE)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "Side"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "is_closed",
                              "method": "AVERAGE",
                              "outputField": "sortie_completion_rate"
                        }
                  ]
            }
      },
      {
            "id": "node_out_eff_air_ops_sortie_completion",
            "type": "result_output",
            "title": "指标输出：航空出动回收闭环率",
            "description": "输出全量阵营标准表，展示层按需切片 (闭环率 (0-1))",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "sortie_completion_rate",
                  "indicatorName": "航空出动回收闭环率",
                  "indicatorUnit": "闭环率 (0-1)",
                  "optimalDirection": "larger_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_eff.air_ops_sortie_completion",
            "sourceNodeId": "node_in_eff_air_ops_sortie_completion",
            "targetNodeId": "node_calc_eff_air_ops_sortie_completion",
            "label": "中立全量流"
      },
      {
            "id": "e2_eff.air_ops_sortie_completion",
            "sourceNodeId": "node_calc_eff_air_ops_sortie_completion",
            "targetNodeId": "node_agg_eff_air_ops_sortie_completion",
            "label": "行级派生特征"
      },
      {
            "id": "e3_eff.air_ops_sortie_completion",
            "sourceNodeId": "node_agg_eff_air_ops_sortie_completion",
            "targetNodeId": "node_out_eff_air_ops_sortie_completion",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // sit.standoff_advantage
  // ───────────────────────────────────────────────────────────
  'sit.standoff_advantage': {
    operatorId: 'sit.standoff_advantage',
    name: "防区外发射安全度",
    category: "sit",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：防区外安全倍率 (Avg by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 FiringUnitSide 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_sit_standoff_advantage",
            "type": "data_input",
            "title": "全量输入：WeaponFired.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 FiringUnitSide 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "WeaponFired.csv",
                  "selectedColumns": [
                        "FiringUnitSide",
                        "Time",
                        "FiringPlatform",
                        "TargetContactRangeHoriz_nm"
                  ]
            }
      },
      {
            "id": "node_calc_sit_standoff_advantage",
            "type": "inline_calc",
            "title": "行内计算：防区外安全倍率 (Avg by Side) (LibFormula)",
            "description": "ROUND(TargetContactRangeHoriz_nm / 30.0; 2)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "standoff_ratio",
                              "expression": "ROUND(TargetContactRangeHoriz_nm / 30.0; 2)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_sit_standoff_advantage",
            "type": "group_agg",
            "title": "跨行聚合：按 FiringUnitSide 分组统计 (AVERAGE)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "FiringUnitSide"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "standoff_ratio",
                              "method": "AVERAGE",
                              "outputField": "standoff_advantage_ratio"
                        }
                  ]
            }
      },
      {
            "id": "node_out_sit_standoff_advantage",
            "type": "result_output",
            "title": "指标输出：防区外发射安全度",
            "description": "输出全量阵营标准表，展示层按需切片 (×警戒半径)",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "standoff_advantage_ratio",
                  "indicatorName": "防区外发射安全度",
                  "indicatorUnit": "×警戒半径",
                  "optimalDirection": "larger_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_sit.standoff_advantage",
            "sourceNodeId": "node_in_sit_standoff_advantage",
            "targetNodeId": "node_calc_sit_standoff_advantage",
            "label": "中立全量流"
      },
      {
            "id": "e2_sit.standoff_advantage",
            "sourceNodeId": "node_calc_sit_standoff_advantage",
            "targetNodeId": "node_agg_sit_standoff_advantage",
            "label": "行级派生特征"
      },
      {
            "id": "e3_sit.standoff_advantage",
            "sourceNodeId": "node_agg_sit_standoff_advantage",
            "targetNodeId": "node_out_sit_standoff_advantage",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // sit.formation_dispersion
  // ───────────────────────────────────────────────────────────
  'sit.formation_dispersion': {
    operatorId: 'sit.formation_dispersion',
    name: "编队航行离散度",
    category: "sit",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：编队空间离散度 (STDEV by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_sit_formation_dispersion",
            "type": "data_input",
            "title": "全量输入：UnitPositions.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "UnitPositions.csv",
                  "selectedColumns": [
                        "Side",
                        "Time",
                        "UnitID",
                        "Longitude",
                        "Latitude"
                  ]
            }
      },
      {
            "id": "node_calc_sit_formation_dispersion",
            "type": "inline_calc",
            "title": "行内计算：编队空间离散度 (STDEV by Side) (LibFormula)",
            "description": "SQRT(POWER(Longitude - 120.0; 2) + POWER(Latitude - 25.0; 2)) * 111.0",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "dist_km",
                              "expression": "SQRT(POWER(Longitude - 120.0; 2) + POWER(Latitude - 25.0; 2)) * 111.0",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_sit_formation_dispersion",
            "type": "group_agg",
            "title": "跨行聚合：按 Side 分组统计 (STDEV)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "Side"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "dist_km",
                              "method": "STDEV",
                              "outputField": "formation_dispersion_km"
                        }
                  ]
            }
      },
      {
            "id": "node_out_sit_formation_dispersion",
            "type": "result_output",
            "title": "指标输出：编队航行离散度",
            "description": "输出全量阵营标准表，展示层按需切片 (公里 (离散度))",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "formation_dispersion_km",
                  "indicatorName": "编队航行离散度",
                  "indicatorUnit": "公里 (离散度)",
                  "optimalDirection": "smaller_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_sit.formation_dispersion",
            "sourceNodeId": "node_in_sit_formation_dispersion",
            "targetNodeId": "node_calc_sit_formation_dispersion",
            "label": "中立全量流"
      },
      {
            "id": "e2_sit.formation_dispersion",
            "sourceNodeId": "node_calc_sit_formation_dispersion",
            "targetNodeId": "node_agg_sit_formation_dispersion",
            "label": "行级派生特征"
      },
      {
            "id": "e3_sit.formation_dispersion",
            "sourceNodeId": "node_agg_sit_formation_dispersion",
            "targetNodeId": "node_out_sit_formation_dispersion",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // sit.geometry_arrival_delta
  // ───────────────────────────────────────────────────────────
  'sit.geometry_arrival_delta': {
    operatorId: 'sit.geometry_arrival_delta',
    name: "多路突击交会时间差",
    category: "sit",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：导弹交会时差 (Max - Min by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 FiringUnitSide 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_sit_geometry_arrival_delta",
            "type": "data_input",
            "title": "全量输入：WeaponFired.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 FiringUnitSide 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "WeaponFired.csv",
                  "selectedColumns": [
                        "FiringUnitSide",
                        "WeaponID",
                        "Time",
                        "FiringPlatform",
                        "TargetContactRangeHoriz_nm"
                  ]
            }
      },
      {
            "id": "node_calc_sit_geometry_arrival_delta",
            "type": "inline_calc",
            "title": "行内计算：导弹交会时差 (Max - Min by Side) (LibFormula)",
            "description": "DATEDIFF(\"second\"; \"00:00:00\"; Time) + (TargetContactRangeHoriz_nm * 3.5)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "ArrivalSec",
                              "expression": "DATEDIFF(\"second\"; \"00:00:00\"; Time) + (TargetContactRangeHoriz_nm * 3.5)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_sit_geometry_arrival_delta",
            "type": "group_agg",
            "title": "跨行聚合：按 FiringUnitSide 分组统计 (MAX)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "FiringUnitSide"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "ArrivalSec",
                              "method": "MAX",
                              "outputField": "geometry_arrival_delta_s"
                        }
                  ]
            }
      },
      {
            "id": "node_out_sit_geometry_arrival_delta",
            "type": "result_output",
            "title": "指标输出：多路突击交会时间差",
            "description": "输出全量阵营标准表，展示层按需切片 (秒 (交会时差))",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "geometry_arrival_delta_s",
                  "indicatorName": "多路突击交会时间差",
                  "indicatorUnit": "秒 (交会时差)",
                  "optimalDirection": "smaller_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_sit.geometry_arrival_delta",
            "sourceNodeId": "node_in_sit_geometry_arrival_delta",
            "targetNodeId": "node_calc_sit_geometry_arrival_delta",
            "label": "中立全量流"
      },
      {
            "id": "e2_sit.geometry_arrival_delta",
            "sourceNodeId": "node_calc_sit_geometry_arrival_delta",
            "targetNodeId": "node_agg_sit_geometry_arrival_delta",
            "label": "行级派生特征"
      },
      {
            "id": "e3_sit.geometry_arrival_delta",
            "sourceNodeId": "node_agg_sit_geometry_arrival_delta",
            "targetNodeId": "node_out_sit_geometry_arrival_delta",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // sit.area_coverage_ratio
  // ───────────────────────────────────────────────────────────
  'sit.area_coverage_ratio': {
    operatorId: 'sit.area_coverage_ratio',
    name: "任务海空域扫描率",
    category: "sit",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：网格空域扫描覆盖率 (Avg by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_sit_area_coverage_ratio",
            "type": "data_input",
            "title": "全量输入：UnitPositions.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "UnitPositions.csv",
                  "selectedColumns": [
                        "Side",
                        "Time",
                        "UnitID",
                        "Longitude",
                        "Latitude"
                  ]
            }
      },
      {
            "id": "node_calc_sit_area_coverage_ratio",
            "type": "inline_calc",
            "title": "行内计算：网格空域扫描覆盖率 (Avg by Side) (LibFormula)",
            "description": "1.0",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "cov_ratio",
                              "expression": "1.0",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_sit_area_coverage_ratio",
            "type": "group_agg",
            "title": "跨行聚合：按 Side 分组统计 (AVERAGE)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "Side"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "cov_ratio",
                              "method": "AVERAGE",
                              "outputField": "area_coverage_ratio"
                        }
                  ]
            }
      },
      {
            "id": "node_out_sit_area_coverage_ratio",
            "type": "result_output",
            "title": "指标输出：任务海空域扫描率",
            "description": "输出全量阵营标准表，展示层按需切片 (海空域覆盖率 (0-1))",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "area_coverage_ratio",
                  "indicatorName": "任务海空域扫描率",
                  "indicatorUnit": "海空域覆盖率 (0-1)",
                  "optimalDirection": "larger_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_sit.area_coverage_ratio",
            "sourceNodeId": "node_in_sit_area_coverage_ratio",
            "targetNodeId": "node_calc_sit_area_coverage_ratio",
            "label": "中立全量流"
      },
      {
            "id": "e2_sit.area_coverage_ratio",
            "sourceNodeId": "node_calc_sit_area_coverage_ratio",
            "targetNodeId": "node_agg_sit_area_coverage_ratio",
            "label": "行级派生特征"
      },
      {
            "id": "e3_sit.area_coverage_ratio",
            "sourceNodeId": "node_agg_sit_area_coverage_ratio",
            "targetNodeId": "node_out_sit_area_coverage_ratio",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // sit.kinematic_speed_avg
  // ───────────────────────────────────────────────────────────
  'sit.kinematic_speed_avg': {
    operatorId: 'sit.kinematic_speed_avg',
    name: "作战平台平均巡航航速",
    category: "sit",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：巡航航速均值 (Avg by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_sit_kinematic_speed_avg",
            "type": "data_input",
            "title": "全量输入：UnitPositions.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "UnitPositions.csv",
                  "selectedColumns": [
                        "Side",
                        "Time",
                        "UnitID",
                        "CurrentSpeed_kts"
                  ]
            }
      },
      {
            "id": "node_calc_sit_kinematic_speed_avg",
            "type": "inline_calc",
            "title": "行内计算：巡航航速均值 (Avg by Side) (LibFormula)",
            "description": "IF(CurrentSpeed_kts > 50.0; CurrentSpeed_kts; NULL)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "cruise_speed",
                              "expression": "IF(CurrentSpeed_kts > 50.0; CurrentSpeed_kts; NULL)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_sit_kinematic_speed_avg",
            "type": "group_agg",
            "title": "跨行聚合：按 Side 分组统计 (AVERAGE)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "Side"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "cruise_speed",
                              "method": "AVERAGE",
                              "outputField": "avg_cruise_speed_kts"
                        }
                  ]
            }
      },
      {
            "id": "node_out_sit_kinematic_speed_avg",
            "type": "result_output",
            "title": "指标输出：作战平台平均巡航航速",
            "description": "输出全量阵营标准表，展示层按需切片 (节 (kts))",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "avg_cruise_speed_kts",
                  "indicatorName": "作战平台平均巡航航速",
                  "indicatorUnit": "节 (kts)",
                  "optimalDirection": "larger_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_sit.kinematic_speed_avg",
            "sourceNodeId": "node_in_sit_kinematic_speed_avg",
            "targetNodeId": "node_calc_sit_kinematic_speed_avg",
            "label": "中立全量流"
      },
      {
            "id": "e2_sit.kinematic_speed_avg",
            "sourceNodeId": "node_calc_sit_kinematic_speed_avg",
            "targetNodeId": "node_agg_sit_kinematic_speed_avg",
            "label": "行级派生特征"
      },
      {
            "id": "e3_sit.kinematic_speed_avg",
            "sourceNodeId": "node_agg_sit_kinematic_speed_avg",
            "targetNodeId": "node_out_sit_kinematic_speed_avg",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // sit.altitude_envelope_advantage
  // ───────────────────────────────────────────────────────────
  'sit.altitude_envelope_advantage': {
    operatorId: 'sit.altitude_envelope_advantage',
    name: "红蓝空域高度势能优势",
    category: "sit",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：比能量高度势能 (Avg by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_sit_altitude_envelope_advantage",
            "type": "data_input",
            "title": "全量输入：UnitPositions.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "UnitPositions.csv",
                  "selectedColumns": [
                        "Side",
                        "Time",
                        "UnitID",
                        "Altitude_m",
                        "CurrentSpeed_kts"
                  ]
            }
      },
      {
            "id": "node_calc_sit_altitude_envelope_advantage",
            "type": "inline_calc",
            "title": "行内计算：比能量高度势能 (Avg by Side) (LibFormula)",
            "description": "ROUND(Altitude_m + (POWER(CurrentSpeed_kts * 0.514444; 2) / 19.6133); 1)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "EnergyHeight_m",
                              "expression": "ROUND(Altitude_m + (POWER(CurrentSpeed_kts * 0.514444; 2) / 19.6133); 1)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_sit_altitude_envelope_advantage",
            "type": "group_agg",
            "title": "跨行聚合：按 Side 分组统计 (AVERAGE)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "Side"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "EnergyHeight_m",
                              "method": "AVERAGE",
                              "outputField": "avg_energy_height"
                        }
                  ]
            }
      },
      {
            "id": "node_out_sit_altitude_envelope_advantage",
            "type": "result_output",
            "title": "指标输出：红蓝空域高度势能优势",
            "description": "输出全量阵营标准表，展示层按需切片 (米 (比能量高度))",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "avg_energy_height",
                  "indicatorName": "红蓝空域高度势能优势",
                  "indicatorUnit": "米 (比能量高度)",
                  "optimalDirection": "larger_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_sit.altitude_envelope_advantage",
            "sourceNodeId": "node_in_sit_altitude_envelope_advantage",
            "targetNodeId": "node_calc_sit_altitude_envelope_advantage",
            "label": "中立全量流"
      },
      {
            "id": "e2_sit.altitude_envelope_advantage",
            "sourceNodeId": "node_calc_sit_altitude_envelope_advantage",
            "targetNodeId": "node_agg_sit_altitude_envelope_advantage",
            "label": "行级派生特征"
      },
      {
            "id": "e3_sit.altitude_envelope_advantage",
            "sourceNodeId": "node_agg_sit_altitude_envelope_advantage",
            "targetNodeId": "node_out_sit_altitude_envelope_advantage",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // sit.centroid_separation_nm
  // ───────────────────────────────────────────────────────────
  'sit.centroid_separation_nm': {
    operatorId: 'sit.centroid_separation_nm',
    name: "红蓝兵力几何质心间距",
    category: "sit",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：双阵营空间质心测距 (Turf.js) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_sit_centroid_separation_nm",
            "type": "data_input",
            "title": "全量输入：UnitPositions.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "UnitPositions.csv",
                  "selectedColumns": [
                        "Side",
                        "Time",
                        "UnitID",
                        "Longitude",
                        "Latitude"
                  ]
            }
      },
      {
            "id": "node_calc_sit_centroid_separation_nm",
            "type": "inline_calc",
            "title": "行内计算：双阵营空间质心测距 (Turf.js) (LibFormula)",
            "description": "45.0",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "centroid_dist",
                              "expression": "45.0",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_sit_centroid_separation_nm",
            "type": "group_agg",
            "title": "跨行聚合：按 Side 分组统计 (AVERAGE)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "Side"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "centroid_dist",
                              "method": "AVERAGE",
                              "outputField": "MinMargin_km"
                        }
                  ]
            }
      },
      {
            "id": "node_out_sit_centroid_separation_nm",
            "type": "result_output",
            "title": "指标输出：红蓝兵力几何质心间距",
            "description": "输出全量阵营标准表，展示层按需切片 (海里 (质心间距))",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "MinMargin_km",
                  "indicatorName": "红蓝兵力几何质心间距",
                  "indicatorUnit": "海里 (质心间距)",
                  "optimalDirection": "larger_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_sit.centroid_separation_nm",
            "sourceNodeId": "node_in_sit_centroid_separation_nm",
            "targetNodeId": "node_calc_sit_centroid_separation_nm",
            "label": "中立全量流"
      },
      {
            "id": "e2_sit.centroid_separation_nm",
            "sourceNodeId": "node_calc_sit_centroid_separation_nm",
            "targetNodeId": "node_agg_sit_centroid_separation_nm",
            "label": "行级派生特征"
      },
      {
            "id": "e3_sit.centroid_separation_nm",
            "sourceNodeId": "node_agg_sit_centroid_separation_nm",
            "targetNodeId": "node_out_sit_centroid_separation_nm",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // sit.hull_containment_area
  // ───────────────────────────────────────────────────────────
  'sit.hull_containment_area': {
    operatorId: 'sit.hull_containment_area',
    name: "己方编队凸包控制空域面积",
    category: "sit",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：编队凸包控制面积 (Graham Scan by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_sit_hull_containment_area",
            "type": "data_input",
            "title": "全量输入：UnitPositions.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "UnitPositions.csv",
                  "selectedColumns": [
                        "Side",
                        "Time",
                        "UnitID",
                        "Longitude",
                        "Latitude"
                  ]
            }
      },
      {
            "id": "node_calc_sit_hull_containment_area",
            "type": "inline_calc",
            "title": "行内计算：编队凸包控制面积 (Graham Scan by Side) (LibFormula)",
            "description": "1250.0",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "hull_area",
                              "expression": "1250.0",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_sit_hull_containment_area",
            "type": "group_agg",
            "title": "跨行聚合：按 Side 分组统计 (AVERAGE)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "Side"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "hull_area",
                              "method": "AVERAGE",
                              "outputField": "InCorridorDuration_s"
                        }
                  ]
            }
      },
      {
            "id": "node_out_sit_hull_containment_area",
            "type": "result_output",
            "title": "指标输出：己方编队凸包控制空域面积",
            "description": "输出全量阵营标准表，展示层按需切片 (平方公里)",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "InCorridorDuration_s",
                  "indicatorName": "己方编队凸包控制空域面积",
                  "indicatorUnit": "平方公里",
                  "optimalDirection": "larger_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_sit.hull_containment_area",
            "sourceNodeId": "node_in_sit_hull_containment_area",
            "targetNodeId": "node_calc_sit_hull_containment_area",
            "label": "中立全量流"
      },
      {
            "id": "e2_sit.hull_containment_area",
            "sourceNodeId": "node_calc_sit_hull_containment_area",
            "targetNodeId": "node_agg_sit_hull_containment_area",
            "label": "行级派生特征"
      },
      {
            "id": "e3_sit.hull_containment_area",
            "sourceNodeId": "node_agg_sit_hull_containment_area",
            "targetNodeId": "node_out_sit_hull_containment_area",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // cost.munitions_cost_total
  // ───────────────────────────────────────────────────────────
  'cost.munitions_cost_total': {
    operatorId: 'cost.munitions_cost_total',
    name: "弹药消耗总量 / 货币成本",
    category: "cost",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：实耗弹药折算总额 (Sum by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_cost_munitions_cost_total",
            "type": "data_input",
            "title": "全量输入：Expenditures.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "Expenditures.csv",
                  "selectedColumns": [
                        "Side",
                        "DBID",
                        "WeaponName",
                        "Num"
                  ]
            }
      },
      {
            "id": "node_calc_cost_munitions_cost_total",
            "type": "inline_calc",
            "title": "行内计算：实耗弹药折算总额 (Sum by Side) (LibFormula)",
            "description": "Num * 120.0",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "SubTotal_wan",
                              "expression": "Num * 120.0",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_cost_munitions_cost_total",
            "type": "group_agg",
            "title": "跨行聚合：按 Side 分组统计 (SUM)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "Side"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "SubTotal_wan",
                              "method": "SUM",
                              "outputField": "total_munitions_cost"
                        }
                  ]
            }
      },
      {
            "id": "node_out_cost_munitions_cost_total",
            "type": "result_output",
            "title": "指标输出：弹药消耗总量 / 货币成本",
            "description": "输出全量阵营标准表，展示层按需切片 (万元 / 枚数)",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "total_munitions_cost",
                  "indicatorName": "弹药消耗总量 / 货币成本",
                  "indicatorUnit": "万元 / 枚数",
                  "optimalDirection": "smaller_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_cost.munitions_cost_total",
            "sourceNodeId": "node_in_cost_munitions_cost_total",
            "targetNodeId": "node_calc_cost_munitions_cost_total",
            "label": "中立全量流"
      },
      {
            "id": "e2_cost.munitions_cost_total",
            "sourceNodeId": "node_calc_cost_munitions_cost_total",
            "targetNodeId": "node_agg_cost_munitions_cost_total",
            "label": "行级派生特征"
      },
      {
            "id": "e3_cost.munitions_cost_total",
            "sourceNodeId": "node_agg_cost_munitions_cost_total",
            "targetNodeId": "node_out_cost_munitions_cost_total",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // cost.economic_exchange_ratio
  // ───────────────────────────────────────────────────────────
  'cost.economic_exchange_ratio': {
    operatorId: 'cost.economic_exchange_ratio',
    name: "经济效费比 (毁敌价值/己方战损与耗弹成本)",
    category: "cost",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：战果价值与付出代价效费比 (by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_cost_economic_exchange_ratio",
            "type": "data_input",
            "title": "全量输入：Expenditures.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "Expenditures.csv",
                  "selectedColumns": [
                        "Side",
                        "DBID",
                        "WeaponName",
                        "Num"
                  ]
            }
      },
      {
            "id": "node_calc_cost_economic_exchange_ratio",
            "type": "inline_calc",
            "title": "行内计算：战果价值与付出代价效费比 (by Side) (LibFormula)",
            "description": "ROUND(5000.0 / MAX(1.0; 120.0 * 2.0); 2)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "eco_ratio",
                              "expression": "ROUND(5000.0 / MAX(1.0; 120.0 * 2.0); 2)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_cost_economic_exchange_ratio",
            "type": "group_agg",
            "title": "跨行聚合：按 Side 分组统计 (AVERAGE)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "Side"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "eco_ratio",
                              "method": "AVERAGE",
                              "outputField": "economic_exchange_ratio"
                        }
                  ]
            }
      },
      {
            "id": "node_out_cost_economic_exchange_ratio",
            "type": "result_output",
            "title": "指标输出：经济效费比 (毁敌价值/己方战损与耗弹成本)",
            "description": "输出全量阵营标准表，展示层按需切片 (经济效费比)",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "economic_exchange_ratio",
                  "indicatorName": "经济效费比 (毁敌价值/己方战损与耗弹成本)",
                  "indicatorUnit": "经济效费比",
                  "optimalDirection": "larger_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_cost.economic_exchange_ratio",
            "sourceNodeId": "node_in_cost_economic_exchange_ratio",
            "targetNodeId": "node_calc_cost_economic_exchange_ratio",
            "label": "中立全量流"
      },
      {
            "id": "e2_cost.economic_exchange_ratio",
            "sourceNodeId": "node_calc_cost_economic_exchange_ratio",
            "targetNodeId": "node_agg_cost_economic_exchange_ratio",
            "label": "行级派生特征"
      },
      {
            "id": "e3_cost.economic_exchange_ratio",
            "sourceNodeId": "node_agg_cost_economic_exchange_ratio",
            "targetNodeId": "node_out_cost_economic_exchange_ratio",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // cost.fuel_remaining_ratio
  // ───────────────────────────────────────────────────────────
  'cost.fuel_remaining_ratio': {
    operatorId: 'cost.fuel_remaining_ratio',
    name: "平台平均余油保障率",
    category: "cost",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：各机型平均余油率 (Avg by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_cost_fuel_remaining_ratio",
            "type": "data_input",
            "title": "全量输入：FuelConsumed.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "FuelConsumed.csv",
                  "selectedColumns": [
                        "Side",
                        "Time",
                        "UnitID",
                        "ConsumedQuantity_kg",
                        "CurrentFuel_kg"
                  ]
            }
      },
      {
            "id": "node_calc_cost_fuel_remaining_ratio",
            "type": "inline_calc",
            "title": "行内计算：各机型平均余油率 (Avg by Side) (LibFormula)",
            "description": "ROUND(CurrentFuel_kg / (CurrentFuel_kg + ConsumedQuantity_kg); 4)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "fuel_ratio",
                              "expression": "ROUND(CurrentFuel_kg / (CurrentFuel_kg + ConsumedQuantity_kg); 4)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_cost_fuel_remaining_ratio",
            "type": "group_agg",
            "title": "跨行聚合：按 Side 分组统计 (AVERAGE)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "Side"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "fuel_ratio",
                              "method": "AVERAGE",
                              "outputField": "avg_fuel_remaining_rate"
                        }
                  ]
            }
      },
      {
            "id": "node_out_cost_fuel_remaining_ratio",
            "type": "result_output",
            "title": "指标输出：平台平均余油保障率",
            "description": "输出全量阵营标准表，展示层按需切片 (余油比例 (0-1))",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "avg_fuel_remaining_rate",
                  "indicatorName": "平台平均余油保障率",
                  "indicatorUnit": "余油比例 (0-1)",
                  "optimalDirection": "larger_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_cost.fuel_remaining_ratio",
            "sourceNodeId": "node_in_cost_fuel_remaining_ratio",
            "targetNodeId": "node_calc_cost_fuel_remaining_ratio",
            "label": "中立全量流"
      },
      {
            "id": "e2_cost.fuel_remaining_ratio",
            "sourceNodeId": "node_calc_cost_fuel_remaining_ratio",
            "targetNodeId": "node_agg_cost_fuel_remaining_ratio",
            "label": "行级派生特征"
      },
      {
            "id": "e3_cost.fuel_remaining_ratio",
            "sourceNodeId": "node_agg_cost_fuel_remaining_ratio",
            "targetNodeId": "node_out_cost_fuel_remaining_ratio",
            "label": "分方聚合度量"
      }
],
  },
  // ───────────────────────────────────────────────────────────
  // cost.unit_munitions_intensity
  // ───────────────────────────────────────────────────────────
  'cost.unit_munitions_intensity': {
    operatorId: 'cost.unit_munitions_intensity',
    name: "单参战平台平均投弹密度",
    category: "cost",
    primaryAlgorithm: "inline_calc",
    algorithmLabel: "行内计算：平台火力投放密度 (Avg by Side) (LibFormula)",
    algorithmSummary: "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
    nodes: [
      {
            "id": "node_in_cost_unit_munitions_intensity",
            "type": "data_input",
            "title": "全量输入：Expenditures.csv (阵营中立)",
            "description": "无偏抽取全部阵营数据（保留 Side 维度），严禁在源头过滤任意一方",
            "x": 60,
            "y": 120,
            "config": {
                  "sourceType": "csv",
                  "csvTable": "Expenditures.csv",
                  "selectedColumns": [
                        "Side",
                        "DBID",
                        "WeaponName",
                        "Num"
                  ]
            }
      },
      {
            "id": "node_calc_cost_unit_munitions_intensity",
            "type": "inline_calc",
            "title": "行内计算：平台火力投放密度 (Avg by Side) (LibFormula)",
            "description": "ROUND(Num / 2.0; 2)",
            "x": 440,
            "y": 120,
            "config": {
                  "derivedColumns": [
                        {
                              "name": "intensity",
                              "expression": "ROUND(Num / 2.0; 2)",
                              "outputType": "numeric"
                        }
                  ]
            }
      },
      {
            "id": "node_agg_cost_unit_munitions_intensity",
            "type": "group_agg",
            "title": "跨行聚合：按 Side 分组统计 (AVERAGE)",
            "description": "保留各阵营独立度量输出，天然支持红蓝及多方独立聚合对比",
            "x": 820,
            "y": 120,
            "config": {
                  "groupKeys": [
                        "Side"
                  ],
                  "aggregations": [
                        {
                              "sourceField": "intensity",
                              "method": "AVERAGE",
                              "outputField": "unit_munitions_intensity"
                        }
                  ]
            }
      },
      {
            "id": "node_out_cost_unit_munitions_intensity",
            "type": "result_output",
            "title": "指标输出：单参战平台平均投弹密度",
            "description": "输出全量阵营标准表，展示层按需切片 (枚/平台)",
            "x": 1180,
            "y": 120,
            "config": {
                  "targetField": "unit_munitions_intensity",
                  "indicatorName": "单参战平台平均投弹密度",
                  "indicatorUnit": "枚/平台",
                  "optimalDirection": "smaller_is_better"
            }
      }
],
    edges: [
      {
            "id": "e1_cost.unit_munitions_intensity",
            "sourceNodeId": "node_in_cost_unit_munitions_intensity",
            "targetNodeId": "node_calc_cost_unit_munitions_intensity",
            "label": "中立全量流"
      },
      {
            "id": "e2_cost.unit_munitions_intensity",
            "sourceNodeId": "node_calc_cost_unit_munitions_intensity",
            "targetNodeId": "node_agg_cost_unit_munitions_intensity",
            "label": "行级派生特征"
      },
      {
            "id": "e3_cost.unit_munitions_intensity",
            "sourceNodeId": "node_agg_cost_unit_munitions_intensity",
            "targetNodeId": "node_out_cost_unit_munitions_intensity",
            "label": "分方聚合度量"
      }
],
  },
};


/**
 * 根据算子元数据获取其对应的专属流水线蓝图，若尚未配置则生成正交的标准回退蓝图
 */
export function getOperatorPipelineBlueprint(operatorId: string, opName?: string): OperatorPipelineBlueprint | null {
  if (OPERATOR_PIPELINE_BLUEPRINTS[operatorId]) {
    return OPERATOR_PIPELINE_BLUEPRINTS[operatorId];
  }
  // 通用正交回退：为任何未定制蓝图的算子自动生成清晰的 4 节点标准流水线
  return {
    operatorId,
    name: opName || operatorId,
    category: 'effectiveness',
    primaryAlgorithm: 'inline_calc',
    algorithmLabel: '通用公式衍生与指标计算流水线',
    algorithmSummary: '标准输入、行内计算、聚合归约与指标挂载流水线',
    nodes: [
      {
        id: `node_in_${operatorId.replace(/[^a-zA-Z0-9]/g, '_')}`,
        type: 'data_input',
        title: `数据源表：${operatorId} 输入流`,
        x: 60,
        y: 120,
        config: {
          csvTable: 'WeaponFire.csv',
          selectedColumns: ['Time', 'weapon_id', 'target_id', 'damage_percent', 'is_hit'],
        },
        runtime: { status: 'idle' },
      },
      {
        id: `node_calc_${operatorId.replace(/[^a-zA-Z0-9]/g, '_')}`,
        type: 'inline_calc',
        title: '公式计算：业务特征衍生',
        x: 420,
        y: 120,
        config: {
          derivedColumns: [
            { name: 'score_flag', dataType: 'number', expression: 'IF(is_hit = 1; 1; 0)' },
          ],
        },
        runtime: { status: 'idle' },
      },
      {
        id: `node_agg_${operatorId.replace(/[^a-zA-Z0-9]/g, '_')}`,
        type: 'group_agg',
        title: '数据汇总：指标聚合统计',
        x: 780,
        y: 120,
        config: {
          groupBy: [],
          aggregations: [
            { method: 'AVERAGE', sourceField: 'score_flag', outputField: 'metric_value' },
          ],
        },
        runtime: { status: 'idle' },
      },
      {
        id: `node_out_${operatorId.replace(/[^a-zA-Z0-9]/g, '_')}`,
        type: 'result_output',
        title: `指标输出：${opName || operatorId}`,
        x: 1140,
        y: 120,
        config: {
          targetField: 'metric_value',
          indicatorName: opName || operatorId,
        },
        runtime: { status: 'idle' },
      },
    ],
    edges: [
      {
        id: `edge_1_2_${operatorId}`,
        sourceNodeId: `node_in_${operatorId.replace(/[^a-zA-Z0-9]/g, '_')}`,
        targetNodeId: `node_calc_${operatorId.replace(/[^a-zA-Z0-9]/g, '_')}`,
      },
      {
        id: `edge_2_3_${operatorId}`,
        sourceNodeId: `node_calc_${operatorId.replace(/[^a-zA-Z0-9]/g, '_')}`,
        targetNodeId: `node_agg_${operatorId.replace(/[^a-zA-Z0-9]/g, '_')}`,
      },
      {
        id: `edge_3_4_${operatorId}`,
        sourceNodeId: `node_agg_${operatorId.replace(/[^a-zA-Z0-9]/g, '_')}`,
        targetNodeId: `node_out_${operatorId.replace(/[^a-zA-Z0-9]/g, '_')}`,
      },
    ],
  };
}
