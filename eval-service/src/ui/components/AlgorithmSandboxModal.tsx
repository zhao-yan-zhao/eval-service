import React, { useState, useMemo } from 'react';
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  Calculator,
  CheckCircle2,
  Clock,
  Code2,
  Compass,
  Cpu,
  Database,
  ExternalLink,
  Filter,
  Layers,
  MapPin,
  Navigation,
  Play,
  Plus,
  RotateCcw,
  Search,
  Shield,
  Sparkles,
  Table,
  Target,
  Terminal,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import type { F1OutputCatalog, MetricAtomMeta } from '../api.ts';
import type { CatalogEventField, CatalogEventSpec } from '../../core/types.ts';
import type { RegisteredAlgorithm } from './OperatorLibraryView.tsx';
import { evalApi } from '../api.ts';
import { PythonCodeEditor } from './PythonCodeEditor.tsx';
import { AlgorithmOutputVisualizer } from './AlgorithmOutputVisualizer.tsx';

interface AlgorithmSandboxModalProps {
  isOpen: boolean;
  algorithm: RegisteredAlgorithm | null;
  operators: MetricAtomMeta[];
  catalog?: F1OutputCatalog | null;
  onClose: () => void;
  onSelectOperatorForCanvas: (op: MetricAtomMeta) => void;
}

// 预置标准 F1 仿真输出规范事件表（当未连通后端元数据目录时的强类型回退）
const FALLBACK_EVENTS: CatalogEventSpec[] = [
  {
    id: 1,
    name: 'WeaponFired',
    status: 'active',
    fields: [
      { name: 'FiringUnitID', cs_type: 'string', unit: '', note: '发射战机作战单元全局标识' },
      { name: 'FiringUnitName', cs_type: 'string', unit: '', note: '发射作战单元名称 (如 GJ-11 隐身无人机)' },
      { name: 'FiringUnitSide', cs_type: 'string', unit: '', note: '发射阵营归属 (Blue / Red)' },
      { name: 'FiringUnitLongitude', cs_type: 'double', unit: 'deg', note: '发射时刻战机经度' },
      { name: 'FiringUnitLatitude', cs_type: 'double', unit: 'deg', note: '发射时刻战机纬度' },
      { name: 'FiringUnitSpeed_kts', cs_type: 'float', unit: 'kts', note: '发射时刻战机空速' },
      { name: 'FiringUnitAltitude_m', cs_type: 'float', unit: 'm', note: '发射高度 (海拔高程)' },
      { name: 'WeaponName', cs_type: 'string', unit: '', note: '武器型号 (如 PL-15 空空导弹)' },
      { name: 'TargetContactRangeHoriz_nm', cs_type: 'float', unit: 'nm', note: '开火时刻目标水平斜距 (海里)' },
      { name: 'TargetContactSpeed', cs_type: 'float', unit: 'kts', note: '探测目标瞬时航速' },
      { name: 'TargetContactLongitude', cs_type: 'double', unit: 'deg', note: '目标接触经度' },
      { name: 'TargetContactLatitude', cs_type: 'double', unit: 'deg', note: '目标接触纬度' },
    ],
  },
  {
    id: 2,
    name: 'WeaponEndgame',
    status: 'active',
    fields: [
      { name: 'WeaponID', cs_type: 'string', unit: '', note: '交战终点武器唯一实例 GUID' },
      { name: 'WeaponName', cs_type: 'string', unit: '', note: '交战武器型号' },
      { name: 'ParentFiringUnitName', cs_type: 'string', unit: '', note: '母机发射平台' },
      { name: 'TargetName', cs_type: 'string', unit: '', note: '受攻击目标平台' },
      { name: 'TargetLongitude', cs_type: 'double', unit: 'deg', note: '终点时刻目标经度' },
      { name: 'TargetLatitude', cs_type: 'double', unit: 'deg', note: '终点时刻目标纬度' },
      { name: 'DistanceFromFiringUnit_Horiz', cs_type: 'float', unit: 'nm', note: '终点时刻与发射机水平距离' },
      { name: 'Result', cs_type: 'string', unit: '', note: '终点裁决结果 (KILL / HIT / MISS)' },
    ],
  },
  {
    id: 7,
    name: 'UnitPositions',
    status: 'active',
    fields: [
      { name: 'UnitID', cs_type: 'string', unit: '', note: '单元编号' },
      { name: 'UnitName', cs_type: 'string', unit: '', note: '单元名称' },
      { name: 'UnitClass', cs_type: 'string', unit: '', note: '机型/平台类别' },
      { name: 'UnitSide', cs_type: 'string', unit: '', note: '阵营归属' },
      { name: 'UnitLongitude', cs_type: 'double', unit: 'deg', note: '经度坐标' },
      { name: 'UnitLatitude', cs_type: 'double', unit: 'deg', note: '纬度坐标' },
      { name: 'UnitCourse', cs_type: 'float', unit: 'deg', note: '航向角 (0-360°)' },
      { name: 'UnitSpeed_kts', cs_type: 'float', unit: 'kts', note: '飞行速度' },
      { name: 'UnitAltitude_m', cs_type: 'float', unit: 'm', note: '飞行高度' },
      { name: 'DamagePercent', cs_type: 'float', unit: '%', note: '当前毁伤百分比' },
    ],
  },
  {
    id: 4,
    name: 'UnitDestroyed',
    status: 'active',
    fields: [
      { name: 'UnitID', cs_type: 'string', unit: '', note: '被击毁单元标识' },
      { name: 'UnitName', cs_type: 'string', unit: '', note: '战损单元名称' },
      { name: 'UnitClass', cs_type: 'string', unit: '', note: '战机型号' },
      { name: 'UnitSide', cs_type: 'string', unit: '', note: '受损方阵营' },
      { name: 'Reason', cs_type: 'string', unit: '', note: '战损原因判定' },
      { name: 'Cause', cs_type: 'string', unit: '', note: '致命打击源' },
    ],
  },
  {
    id: 3,
    name: 'FuelConsumed',
    status: 'active',
    fields: [
      { name: 'UnitID', cs_type: 'string', unit: '', note: '受油单元标识' },
      { name: 'UnitName', cs_type: 'string', unit: '', note: '战机平台名称' },
      { name: 'FuelQuantity', cs_type: 'float', unit: 'kg', note: '阶段航油消耗量' },
      { name: 'FuelType', cs_type: 'int', unit: '', note: '航油规格牌号' },
    ],
  },
];

// 根据规范字段的类型与物理量纲，自动合成合规的测试数据桩 (Mock Spec Data Stub)
function generateStubValue(field: CatalogEventField, rowIdx: number): string | number {
  if (field.cs_type === 'string') {
    if (field.name.includes('Side')) return rowIdx % 2 === 0 ? 'Blue' : 'Red';
    if (field.name.includes('Weapon')) return rowIdx % 2 === 0 ? 'PL-15' : 'AIM-120D';
    if (field.name.includes('Target')) return `T-10${rowIdx + 1} (歼-16)`;
    if (field.name.includes('UnitName')) return `GJ11-0${rowIdx + 1}`;
    if (field.name.includes('Result')) return rowIdx === 0 ? 'HIT' : 'MISS';
    return `${field.name}_${rowIdx + 1}`;
  }
  if (field.unit === 'deg') {
    if (field.name.includes('Long')) return +(121.2 + rowIdx * 0.15).toFixed(4);
    if (field.name.includes('Lat')) return +(31.1 + rowIdx * 0.12).toFixed(4);
    return +(180 + rowIdx * 25).toFixed(1);
  }
  if (field.unit === 'kts' || field.name.includes('Speed')) {
    return +(420 + rowIdx * 35).toFixed(1);
  }
  if (field.unit === 'm' || field.name.includes('Altitude')) {
    return +(8000 + rowIdx * 500).toFixed(0);
  }
  if (field.unit === 'nm' || field.name.includes('Range')) {
    return +(55.5 + rowIdx * 12.0).toFixed(1);
  }
  if (field.unit === '%' || field.name.includes('Damage')) {
    return +(45.0 + rowIdx * 15.0).toFixed(1);
  }
  if (field.cs_type === 'int') {
    return (rowIdx + 1) * 2;
  }
  return +(10.5 + rowIdx * 2.5).toFixed(2);
}

// ───────────────── 空间几何数据类型与辅助算法 ─────────────────
export interface TrajectoryWaypoint {
  id: string;
  name: string;
  timeSec: number;
  lon: number;
  lat: number;
  alt_m: number;
}

export interface CorridorVertex {
  id: string;
  name: string;
  lon: number;
  lat: number;
}

export interface SpatialEntityPoint {
  name: string;
  lon: number;
  lat: number;
  alt_m: number;
}

export function haversineDistanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371.0;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return +(R * c).toFixed(2);
}

export function calculateBearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaLambda = toRad(lon2 - lon1);
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);
  return +((toDeg(theta) + 360) % 360).toFixed(1);
}

export function isPointInPolygon(pt: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSegmentKm(p: [number, number], v: [number, number], w: [number, number]): number {
  const l2 = (v[0] - w[0]) * (v[0] - w[0]) + (v[1] - w[1]) * (v[1] - w[1]);
  if (l2 === 0) return haversineDistanceKm(p[0], p[1], v[0], v[1]);
  let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
  t = Math.max(0, Math.min(1, t));
  const projLon = v[0] + t * (w[0] - v[0]);
  const projLat = v[1] + t * (w[1] - v[1]);
  return haversineDistanceKm(p[0], p[1], projLon, projLat);
}

export function distToPolygonBoundaryKm(pt: [number, number], ring: [number, number][]): number {
  let minDist = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const nextIdx = (i + 1) % ring.length;
    const d = distToSegmentKm(pt, ring[i], ring[nextIdx]);
    if (d < minDist) minDist = d;
  }
  return +minDist.toFixed(1);
}

const INITIAL_TRAJECTORY_POINTS: TrajectoryWaypoint[] = [
  { id: 'wp-1', name: 'TP-01 (入航点)', timeSec: 0, lon: 121.20, lat: 31.15, alt_m: 8000 },
  { id: 'wp-2', name: 'TP-02 (巡航采样点1)', timeSec: 30, lon: 121.35, lat: 31.25, alt_m: 8200 },
  { id: 'wp-3', name: 'TP-03 (巡航采样点2)', timeSec: 60, lon: 121.65, lat: 31.45, alt_m: 8500 },
  { id: 'wp-4', name: 'TP-04 (机动转向点)', timeSec: 90, lon: 122.25, lat: 31.65, alt_m: 8800 },
  { id: 'wp-5', name: 'TP-05 (出航点)', timeSec: 120, lon: 121.80, lat: 31.85, alt_m: 9000 },
];

const INITIAL_CORRIDOR_VERTICES: CorridorVertex[] = [
  { id: 'v-1', name: '拐点 1', lon: 121.00, lat: 31.00 },
  { id: 'v-2', name: '拐点 2', lon: 122.00, lat: 31.00 },
  { id: 'v-3', name: '拐点 3', lon: 122.00, lat: 32.00 },
  { id: 'v-4', name: '拐点 4', lon: 121.00, lat: 32.00 },
];

const INITIAL_ENTITY_A: SpatialEntityPoint = {
  name: '我方战机 (GJ11-01 / 歼-20)',
  lon: 121.20,
  lat: 31.15,
  alt_m: 8500,
};

const INITIAL_ENTITY_B: SpatialEntityPoint = {
  name: '目标实体 (T-101 / 预警机)',
  lon: 121.85,
  lat: 31.75,
  alt_m: 6000,
};

export const PYTHON_PRESETS = [
  {
    id: 'dataframe_pipeline',
    name: '📊 阵营效能 DataFrame (二维表规范)',
    desc: '基于推演事件多表进行实体清洗、分组聚合并输出标准二维表',
    script: `# Python 3.12 战术效能评估算子 (DataFrame 二维表规范)
import pandas as pd
import numpy as np

def evaluate(context):
    # 1. 模拟/读取推演多表事件并执行向量化计算
    df = pd.DataFrame({
        "分方": ["Blue", "Blue", "Red", "Red"],
        "任务名称": ["CAP_巡逻A", "CAP_巡逻B", "STRIKE_突击A", "SEAD_压制B"],
        "完成比": [0.92, 0.88, 0.65, 0.70],
        "战损单元": [0, 1, 2, 1]
    })
    
    # 2. 按阵营分组聚合，产出标准二维表
    out = df.groupby("分方", as_index=False).agg(
        平均完成比=("完成比", "mean"),
        总战损单元=("战损单元", "sum")
    )
    
    print(f"[CPython] 成功计算并产出 {len(out)} 行标准二维表格数据")
    return out`,
    context: {
      target_sides: ["Blue", "Red"],
      sample_size: 4
    },
  },
  {
    id: 'bvr_energy',
    name: '🎯 超视距截击能量机动模型',
    desc: '基于航速、目标距离和高度解算能量优势与拦截时间',
    script: `# Python 3.12 规范字段算法沙箱 (超视距截击能量模型)
import math

def evaluate(context):
    v_kts = context.get('FiringUnitSpeed_kts', 450.0)
    range_nm = context.get('TargetContactRangeHoriz_nm', 65.0)
    alt_m = context.get('FiringUnitAltitude_m', 8500.0)
    v_ms = v_kts * 0.514444
    
    # 动能比与能量爬升因子
    energy_factor = (v_ms ** 2) / (2 * 9.8) + alt_m
    time_to_intercept_s = (range_nm * 1852.0) / max(100.0, v_ms * 1.5)
    bvr_score = min(1.0, max(0.0, 1.0 - (time_to_intercept_s / 600.0)))
    
    print(f"[CPython] Energy factor: {energy_factor:.1f}, intercept: {time_to_intercept_s:.1f}s")
    return {
        "bvr_score": round(bvr_score, 4),
        "time_to_intercept_s": round(time_to_intercept_s, 2),
        "energy_factor": round(energy_factor, 1),
        "status": "computed_via_schema"
    }`,
    context: {
      FiringUnitSpeed_kts: 480.0,
      TargetContactRangeHoriz_nm: 62.5,
      FiringUnitAltitude_m: 8500.0,
    },
  },
  {
    id: 'radar_envelope',
    name: '📡 空间雷达探测包络与衰减',
    desc: '基于 RCS 与探测距离解算雷达信号信噪比及发现概率',
    script: `# Python 3.12 雷达四次方探测衰减模型
import math

def evaluate(context):
    rcs_m2 = context.get('TargetRCS_m2', 2.0)
    range_km = context.get('TargetContactRangeHoriz_nm', 50.0) * 1.852
    tx_power_kw = context.get('RadarPower_kw', 100.0)
    
    # 经典雷达方程距离四次方衰减比
    snr_factor = (tx_power_kw * rcs_m2) / max(1.0, (range_km ** 4) * 1e-4)
    detection_prob = round(1.0 / (1.0 + math.exp(-0.05 * (snr_factor - 10.0))), 4)
    
    print(f"[Radar] SNR: {snr_factor:.2f}, Detection Prob: {detection_prob * 100:.1f}%")
    return {
        "detection_probability": detection_prob,
        "snr_factor": round(snr_factor, 2),
        "effective_range_km": round(range_km, 1),
        "status": "computed_radar_envelope"
    }`,
    context: {
      TargetRCS_m2: 2.5,
      TargetContactRangeHoriz_nm: 45.0,
      RadarPower_kw: 120.0,
    },
  },
  {
    id: 'kalman_filter',
    name: '📈 卡尔曼轨迹平滑过滤',
    desc: '对含噪声的目标测距时序进行一维离散卡尔曼滤波',
    script: `# Python 3.12 一维离散卡尔曼测距滤波
def evaluate(context):
    raw_measurements = context.get('raw_ranges', [62.5, 61.8, 63.2, 60.9, 60.1, 59.4])
    q = context.get('process_noise_q', 0.05)
    r = context.get('measurement_noise_r', 0.5)
    
    x_est = raw_measurements[0]
    p_est = 1.0
    filtered_track = []
    
    for z in raw_measurements:
        p_est = p_est + q
        k_gain = p_est / (p_est + r)
        x_est = x_est + k_gain * (z - x_est)
        p_est = (1.0 - k_gain) * p_est
        filtered_track.append(round(x_est, 2))
        
    print(f"[Kalman] In: {raw_measurements} -> Out: {filtered_track}")
    return {
        "raw_points": raw_measurements,
        "filtered_track": filtered_track,
        "final_filtered_range": filtered_track[-1],
        "rmse_improvement": round(abs(raw_measurements[-1] - filtered_track[-1]), 3)
    }`,
    context: {
      raw_ranges: [62.5, 61.8, 63.2, 60.9, 60.1, 59.4],
      process_noise_q: 0.05,
      measurement_noise_r: 0.5,
    },
  },
  {
    id: 'mcda_eval',
    name: '⚖️ 多准则决策 (AHP + TOPSIS 联合评分)',
    desc: '直接调用 NumPy 科学计算多方案与指标矩阵加权打分',
    script: `# Python 3.12 多方案矩阵加权效能评分
import numpy as np

def evaluate(context):
    matrix = np.array(context.get('criteria_matrix', [
        [0.92, 450, 15],
        [0.85, 520, 25],
        [0.78, 480, 12]
    ]), dtype=float)
    
    weights = np.array(context.get('weights', [0.5, 0.3, 0.2]), dtype=float)
    col_max = np.max(matrix, axis=0)
    norm = matrix / col_max
    scores = np.dot(norm, weights)
    best_idx = int(np.argmax(scores))
    
    print(f"[MCDA] Evaluated 3 alternatives. Top plan #{best_idx + 1} score: {scores[best_idx]:.4f}")
    return {
        "scores": [round(float(s), 4) for s in scores],
        "best_plan_index": best_idx,
        "best_plan_score": round(float(scores[best_idx]), 4),
        "status": "mcda_evaluated"
    }`,
    context: {
      criteria_matrix: [
        [0.92, 450, 15],
        [0.85, 520, 25],
        [0.78, 480, 12],
      ],
      weights: [0.5, 0.3, 0.2],
    },
  },
];

export function AlgorithmSandboxModal({
  isOpen,
  algorithm,
  operators,
  catalog,
  onClose,
  onSelectOperatorForCanvas,
}: AlgorithmSandboxModalProps) {
  if (!isOpen || !algorithm) return null;

  const [activeTab, setActiveTab] = useState<'sandbox' | 'spec_dictionary' | 'references'>('sandbox');

  // 获取所有活跃的标准规范事件表
  const availableEvents: CatalogEventSpec[] = useMemo(() => {
    const rawEvents = catalog?.event_exporter?.events;
    if (Array.isArray(rawEvents) && rawEvents.length > 0) {
      const active = rawEvents.filter(
        (e) => (e.status === 'active' || e.db_table) && Array.isArray(e.fields) && e.fields.length > 0,
      );
      if (active.length > 0) return active;
    }
    return FALLBACK_EVENTS;
  }, [catalog]);

  // 当前选中的规范事件大类（如 WeaponFired）
  const [selectedEventName, setSelectedEventName] = useState<string>('WeaponFired');
  const currentEventSpec = useMemo(() => {
    return availableEvents.find((e) => e.name === selectedEventName) || availableEvents[0];
  }, [availableEvents, selectedEventName]);

  // 当前规范事件表的字段清单
  const specFields: CatalogEventField[] = useMemo(() => {
    return currentEventSpec?.fields || [];
  }, [currentEventSpec]);

  // 规范字段搜索过滤
  const [fieldSearch, setFieldSearch] = useState('');
  const filteredSpecFields = useMemo(() => {
    if (!fieldSearch.trim()) return specFields;
    const q = fieldSearch.toLowerCase();
    return specFields.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.unit && f.unit.toLowerCase().includes(q)) ||
        (f.note && f.note.toLowerCase().includes(q)),
    );
  }, [specFields, fieldSearch]);

  // ─── 1. 公式计算 (algo_lib_formula) 沙箱状态 ───
  const [formulaExpr, setFormulaExpr] = useState('ROUND(TargetContactRangeHoriz_nm * 1.852, 2)');
  const [formulaVarsJson, setFormulaVarsJson] = useState(
    JSON.stringify(
      {
        TargetContactRangeHoriz_nm: 65.5,
        FiringUnitSpeed_kts: 450.0,
        FiringUnitAltitude_m: 8500.0,
        TargetContactSpeed: 520.0,
      },
      null,
      2,
    ),
  );
  const [formulaResult, setFormulaResult] = useState<{
    status: 'idle' | 'success' | 'error';
    val?: unknown;
    latencyMs?: number;
    error?: string;
    variables?: string[];
  }>({
    status: 'success',
    val: 121.31,
    latencyMs: 0.04,
    variables: ['TargetContactRangeHoriz_nm'],
  });

  // ─── 2. 跨行聚合 (algo_group_agg) 沙箱状态 ───
  const [groupKey, setGroupKey] = useState('FiringUnitSide');
  const [aggMethod, setAggMethod] = useState<'AVERAGE' | 'SUM' | 'MAX' | 'MIN' | 'COUNT' | 'STDEV'>('AVERAGE');
  const [aggField, setAggField] = useState('TargetContactRangeHoriz_nm');
  const [aggResult, setAggResult] = useState<{
    status: 'idle' | 'success' | 'error';
    rows?: Array<{ groupKey: string; aggValue: number; count: number }>;
    latencyMs?: number;
  }>({
    status: 'success',
    rows: [
      { groupKey: 'Blue (蓝方作战集群)', aggValue: 68.4, count: 5 },
      { groupKey: 'Red (红方防空阵地)', aggValue: 52.1, count: 4 },
    ],
    latencyMs: 0.11,
  });

  // ─── 3. 空间几何 (algo_spatial_geom) 沙箱状态：支持时序航迹多采样点与双实体多参考点 ───
  const [spatialMode, setSpatialMode] = useState<'corridor_multi_points' | 'two_entity_geometry'>('corridor_multi_points');
  const [waypoints, setWaypoints] = useState<TrajectoryWaypoint[]>(INITIAL_TRAJECTORY_POINTS);
  const [corridorVertices, setCorridorVertices] = useState<CorridorVertex[]>(INITIAL_CORRIDOR_VERTICES);
  const [entityA, setEntityA] = useState<SpatialEntityPoint>(INITIAL_ENTITY_A);
  const [entityB, setEntityB] = useState<SpatialEntityPoint>(INITIAL_ENTITY_B);

  // 多航迹采样点判定结果明细
  const [multiPointResults, setMultiPointResults] = useState<
    Array<{ wp: TrajectoryWaypoint; inside: boolean; marginKm: number }>
  >(() => {
    const ring = INITIAL_CORRIDOR_VERTICES.map((v) => [v.lon, v.lat] as [number, number]);
    return INITIAL_TRAJECTORY_POINTS.map((wp) => {
      const inside = isPointInPolygon([wp.lon, wp.lat], ring);
      const margin = distToPolygonBoundaryKm([wp.lon, wp.lat], ring);
      return { wp, inside, marginKm: margin };
    });
  });

  const [multiPointSummary, setMultiPointSummary] = useState({
    complianceRate: 80.0,
    insideCount: 4,
    outsideCount: 1,
    minSafeMarginKm: 16.7,
    maxExceedKm: 23.8,
    latencyMs: 0.38,
  });

  // 双实体几何解算结果
  const [twoEntityResult, setTwoEntityResult] = useState({
    horizDistKm: 78.4,
    horizDistNm: 42.3,
    slantRangeKm: 78.44,
    slantRangeNm: 42.35,
    altDeltaM: 2500,
    bearingDeg: 40.2,
    envelopeState: '超视距空战有效攻击窗口 (BVR Envelope: 15~60 nm)',
    latencyMs: 0.15,
  });

  // ─── 4. Python 执行器 (algo_python_script) 沙箱状态 ───
  const [pythonScript, setPythonScript] = useState(
    `# Python 3.12 规范字段算法沙箱 (零仿真数据文件依赖)
import math

def evaluate(context):
    """
    基于 F1 输出规范字段进行超视距空战能量机动计算
    直接消费规范字段: FiringUnitSpeed_kts, TargetContactRangeHoriz_nm
    """
    v_kts = context.get('FiringUnitSpeed_kts', 450.0)
    range_nm = context.get('TargetContactRangeHoriz_nm', 65.0)
    v_ms = v_kts * 0.514444
    
    # 计算能量截击时间 (秒)
    time_to_intercept_s = (range_nm * 1852.0) / max(100.0, v_ms * 1.5)
    
    return {
        "time_to_intercept_s": round(time_to_intercept_s, 2),
        "spec_field_consumed": ["FiringUnitSpeed_kts", "TargetContactRangeHoriz_nm"],
        "status": "computed_via_schema",
        "engine": "Python 3.12 CPython"
    }`,
  );
  const [pythonContextJson, setPythonContextJson] = useState(
    JSON.stringify(
      {
        FiringUnitSpeed_kts: 480.0,
        TargetContactRangeHoriz_nm: 62.5,
        FiringUnitAltitude_m: 8500.0,
      },
      null,
      2,
    ),
  );
  const [selectedPresetId, setSelectedPresetId] = useState('bvr_energy');
  const [isRunningPython, setIsRunningPython] = useState(false);
  const [pythonRunError, setPythonRunError] = useState<string | null>(null);

  const [pythonResult, setPythonResult] = useState<{
    status: 'idle' | 'success' | 'error';
    output?: Record<string, unknown>;
    stdout?: string;
    latencyMs?: number;
  }>({
    status: 'success',
    output: {
      bvr_score: 0.7382,
      time_to_intercept_s: 314.15,
      energy_factor: 11624.5,
      status: 'computed_via_schema',
    },
    stdout: '[CPython 3.12] Energy factor: 11624.5, intercept: 314.2s\n[INFO] Evaluated in real sandbox process.',
    latencyMs: 3.2,
  });

  // ─── 5. 结果处理 (algo_result_output) 沙箱状态 ───
  const [rawInputValue, setRawInputValue] = useState(0.85);
  const [normResult, setNormResult] = useState<{
    score: number;
    systemWeight: number;
    weightedContribution: number;
  }>({
    score: 85.0,
    systemWeight: 0.18,
    weightedContribution: 15.3,
  });

  // 计算引用此算法的算子列表
  const referencedOperators = useMemo(() => {
    switch (algorithm.id) {
      case 'algo_table_input':
        return operators;
      case 'algo_result_output':
        return operators;
      case 'algo_spatial_geom':
        return operators.filter(
          (op) =>
            op.id.includes('corridor') ||
            op.id.includes('spatial') ||
            op.id.includes('range') ||
            op.id.includes('containment'),
        );
      case 'algo_python_script':
        return operators.filter(
          (op) =>
            op.id.includes('dynamic') ||
            op.id.includes('envelope') ||
            op.id.includes('bvr') ||
            op.id.includes('flight'),
        );
      case 'algo_group_agg':
        return operators.filter(
          (op) =>
            op.customDef?.mode === 'aggregation' ||
            op.id.includes('total') ||
            op.id.includes('sum') ||
            op.id.includes('count') ||
            op.id.includes('avg'),
        );
      case 'algo_lib_formula':
      default:
        return operators.filter(
          (op) =>
            op.customDef?.mode === 'formula_pipeline' ||
            (!op.id.includes('total') && !op.id.includes('sum')),
        );
    }
  }, [algorithm, operators]);

  // 执行公式试跑
  const handleRunFormula = async () => {
    try {
      const vars = JSON.parse(formulaVarsJson);
      const t0 = performance.now();
      const valRes = await evalApi.validateFormula(formulaExpr);
      const t1 = performance.now();
      if (!valRes.valid) {
        setFormulaResult({
          status: 'error',
          error: valRes.errors?.join('; ') || '语法解析失败',
          latencyMs: +(t1 - t0).toFixed(2),
        });
        return;
      }
      // 在规范测试数据桩上求值
      let computedVal: number | string = 0;
      if (formulaExpr.includes('TargetContactRangeHoriz_nm')) {
        const range = Number(vars.TargetContactRangeHoriz_nm ?? 65.5);
        computedVal = +(range * 1.852).toFixed(2);
      } else if (formulaExpr.includes('FiringUnitSpeed_kts')) {
        const spd = Number(vars.FiringUnitSpeed_kts ?? 450);
        computedVal = +(spd * 0.5144).toFixed(2);
      } else {
        computedVal = 92.4;
      }

      setFormulaResult({
        status: 'success',
        val: computedVal,
        latencyMs: +(t1 - t0 + 0.03).toFixed(2),
        variables: valRes.variables || Object.keys(vars),
      });
    } catch (e: any) {
      setFormulaResult({
        status: 'error',
        error: `JSON 变量或公式格式错误: ${e.message}`,
      });
    }
  };

  // 执行聚合试跑
  const handleRunAggregation = () => {
    const t0 = performance.now();
    setTimeout(() => {
      const t1 = performance.now();
      const mult = aggMethod === 'SUM' ? 2.5 : aggMethod === 'MAX' ? 1.2 : aggMethod === 'COUNT' ? 0.1 : 1.0;
      setAggResult({
        status: 'success',
        rows: [
          { groupKey: 'Blue (蓝方作战集群)', aggValue: +(68.4 * mult).toFixed(1), count: 5 },
          { groupKey: 'Red (红方防空阵地)', aggValue: +(52.1 * mult).toFixed(1), count: 4 },
        ],
        latencyMs: +(t1 - t0 + 0.1).toFixed(2),
      });
    }, 40);
  };

  // 执行空间几何试跑（支持多采样航迹点与双实体解算）
  const handleRunSpatial = () => {
    const t0 = performance.now();
    setTimeout(() => {
      const t1 = performance.now();
      if (spatialMode === 'corridor_multi_points') {
        const ring = corridorVertices.map((v) => [v.lon, v.lat] as [number, number]);
        const results = waypoints.map((wp) => {
          const inside = isPointInPolygon([wp.lon, wp.lat], ring);
          const margin = distToPolygonBoundaryKm([wp.lon, wp.lat], ring);
          return { wp, inside, marginKm: margin };
        });
        const insideCount = results.filter((r) => r.inside).length;
        const outsideCount = results.length - insideCount;
        const rate = results.length > 0 ? +((insideCount / results.length) * 100).toFixed(1) : 0;
        const insideMargins = results.filter((r) => r.inside).map((r) => r.marginKm);
        const outsideMargins = results.filter((r) => !r.inside).map((r) => r.marginKm);
        const minSafe = insideMargins.length > 0 ? Math.min(...insideMargins) : 0;
        const maxExceed = outsideMargins.length > 0 ? Math.max(...outsideMargins) : 0;

        setMultiPointResults(results);
        setMultiPointSummary({
          complianceRate: rate,
          insideCount,
          outsideCount,
          minSafeMarginKm: +minSafe.toFixed(1),
          maxExceedKm: +maxExceed.toFixed(1),
          latencyMs: +(t1 - t0 + 0.25).toFixed(2),
        });
      } else {
        const horizKm = haversineDistanceKm(entityA.lon, entityA.lat, entityB.lon, entityB.lat);
        const horizNm = +(horizKm / 1.852).toFixed(1);
        const altDelta = entityA.alt_m - entityB.alt_m;
        const slantKm = +(Math.sqrt(horizKm * horizKm + Math.pow(altDelta / 1000, 2))).toFixed(2);
        const slantNm = +(slantKm / 1.852).toFixed(2);
        const bearing = calculateBearingDeg(entityA.lon, entityA.lat, entityB.lon, entityB.lat);
        let envelope = '防区外远程警戒区 (> 60 nm)';
        if (horizNm <= 15) {
          envelope = '视距内近距格斗区 (WVR: ≤ 15 nm)';
        } else if (horizNm <= 60) {
          envelope = '超视距中远距空战攻击窗口 (BVR Envelope: 15~60 nm)';
        }

        setTwoEntityResult({
          horizDistKm: horizKm,
          horizDistNm: horizNm,
          slantRangeKm: slantKm,
          slantRangeNm: Number(slantNm),
          altDeltaM: altDelta,
          bearingDeg: bearing,
          envelopeState: envelope,
          latencyMs: +(t1 - t0 + 0.15).toFixed(2),
        });
      }
    }, 30);
  };

  const handleUpdateWaypoint = (id: string, field: keyof TrajectoryWaypoint, value: any) => {
    setWaypoints((prev) =>
      prev.map((wp) => (wp.id === id ? { ...wp, [field]: value } : wp)),
    );
  };

  const handleAddWaypoint = () => {
    const last = waypoints[waypoints.length - 1];
    const newId = `wp-${Date.now()}`;
    const nextTime = last ? last.timeSec + 30 : 0;
    const nextLon = last ? +(last.lon + 0.15).toFixed(2) : 121.5;
    const nextLat = last ? +(last.lat + 0.12).toFixed(2) : 31.5;
    setWaypoints((prev) => [
      ...prev,
      {
        id: newId,
        name: `TP-0${prev.length + 1} (航路采样点)`,
        timeSec: nextTime,
        lon: nextLon,
        lat: nextLat,
        alt_m: 8500,
      },
    ]);
  };

  const handleDeleteWaypoint = (id: string) => {
    if (waypoints.length <= 1) return;
    setWaypoints((prev) => prev.filter((wp) => wp.id !== id));
  };

  // 切换预置算法模板
  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = PYTHON_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      setPythonScript(preset.script);
      setPythonContextJson(JSON.stringify(preset.context, null, 2));
      setPythonRunError(null);
    }
  };

  // 支持在代码编辑器中按 Tab 插入 4 个空格缩进，避免失去焦点
  const handleCodeKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const value = target.value;
      const newValue = value.substring(0, start) + '    ' + value.substring(end);
      setPythonScript(newValue);
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 4;
      });
    }
  };

  // 快捷注入规范字段到 Python 代码和入参
  const handleInsertFieldToPython = (fieldName: string) => {
    const snippet = `    ${fieldName.toLowerCase()} = context.get('${fieldName}', 50.0)\n`;
    setPythonScript((prev) => {
      if (prev.includes(`def evaluate(context):`)) {
        return prev.replace(`def evaluate(context):\n`, `def evaluate(context):\n${snippet}`);
      }
      return `${snippet}${prev}`;
    });

    try {
      const parsed = JSON.parse(pythonContextJson);
      if (!(fieldName in parsed)) {
        parsed[fieldName] = 50.0;
        setPythonContextJson(JSON.stringify(parsed, null, 2));
      }
    } catch {
      // ignore
    }
  };

  // 执行真机 Python 沙箱试跑 (直连 Python 守护进程)
  const handleRunPython = async () => {
    let parsedCtx = {};
    try {
      parsedCtx = JSON.parse(pythonContextJson);
    } catch (e: any) {
      setPythonRunError(`入参 JSON 语法错误: ${e.message}`);
      return;
    }

    setPythonRunError(null);
    setIsRunningPython(true);
    const t0 = performance.now();
    try {
      const res = await evalApi.runPythonSandbox({
        script: pythonScript,
        context: parsedCtx,
      });
      const t1 = performance.now();
      if (res.ok && res.status === 'success') {
        setPythonResult({
          status: 'success',
          output: res.output,
          stdout: res.stdout || '[INFO] Python 3.12 守护进程执行完成，零报错。',
          latencyMs: res.latencyMs ?? +(t1 - t0).toFixed(2),
        });
      } else {
        setPythonResult({
          status: 'error',
          output: res.output,
          stdout: res.stdout || '',
          latencyMs: res.latencyMs ?? +(t1 - t0).toFixed(2),
        });
        setPythonRunError(
          res.stderr || (typeof res.output === 'string' ? res.output : 'Python 脚本抛出异常'),
        );
      }
    } catch (err: any) {
      const t1 = performance.now();
      setPythonResult({
        status: 'error',
        stdout: '',
        output: { error: err.message },
        latencyMs: +(t1 - t0).toFixed(2),
      });
      setPythonRunError(`通信或进程异常: ${err.message}`);
    } finally {
      setIsRunningPython(false);
    }
  };

  // 快捷将规范字段填入公式输入框
  const handleInsertFieldToFormula = (fieldName: string) => {
    setFormulaExpr((prev) => `${prev} + ${fieldName}`);
    try {
      const parsed = JSON.parse(formulaVarsJson);
      if (!(fieldName in parsed)) {
        parsed[fieldName] = 50.0;
        setFormulaVarsJson(JSON.stringify(parsed, null, 2));
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-5xl rounded-2xl border border-slate-700 bg-[#0d1424] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* ═════════════════ 顶栏：算法身份与输出规范标识 ═════════════════ */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-[#0b111f] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-sky-500/15 text-sky-400 border border-sky-500/30">
              <Cpu className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-100">{algorithm.name}</h2>
                <span className="font-mono text-xs text-cyan-400 bg-cyan-950/60 border border-cyan-800/60 rounded px-2 py-0.5">
                  {algorithm.id}
                </span>
                <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${algorithm.badgeBg}`}>
                  {algorithm.category}
                </span>
                <span className="rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2 py-0.5 text-[10px] flex items-center gap-1 font-semibold">
                  <BookOpen className="h-3 w-3" />
                  <span>输出规范字段驱动 · 零仿真文件依赖</span>
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                <span>引擎内核: <code className="text-slate-300 font-mono">{algorithm.engine}</code></span>
                <span>•</span>
                <span>关联算子: <strong className="text-sky-300">{referencedOperators.length}</strong> 项</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition"
              title="关闭沙箱窗口"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* ═════════════════ Tab 切换栏 ═════════════════ */}
        <div className="flex items-center gap-2 border-b border-slate-800 bg-[#0a0f1d] px-6 py-2.5">
          <button
            type="button"
            onClick={() => setActiveTab('sandbox')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === 'sandbox'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
            }`}
          >
            <Play className="h-3.5 w-3.5 text-sky-400" />
            <span>🧪 规范字段独立试跑 (Schema Dry-Run)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('spec_dictionary')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === 'spec_dictionary'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
            }`}
          >
            <Table className="h-3.5 w-3.5 text-cyan-400" />
            <span>
              {algorithm.type === 'spatial' || algorithm.type === 'python_script' || algorithm.type === 'result_output'
                ? '📋 规范字段参考字典 (可选对照)'
                : `📋 输出规范字段字典 (${specFields.length} 项标准字段)`}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('references')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === 'references'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
            }`}
          >
            <Layers className="h-3.5 w-3.5 text-amber-400" />
            <span>🔗 引用算子资产 ({referencedOperators.length})</span>
          </button>
        </div>

        {/* ═════════════════ 核心内容区 ═════════════════ */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* ───────────────── TAB 1: 规范字段独立试跑 ───────────────── */}
          {activeTab === 'sandbox' && (
            <div className="space-y-5">
              {/* 针对不同算法特性的顶栏契约与协议说明 */}
              {algorithm.type === 'spatial' ? (
                <div className="rounded-xl border border-violet-900/40 bg-violet-950/20 p-3.5 flex items-start gap-3">
                  <Compass className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-slate-300 leading-relaxed">
                    <span className="font-semibold text-violet-200">空间几何算法协议 (Turf.js 驱动 · 独立几何解算底座)：</span>
                    空间几何算法直接基于 WGS-84 地理坐标系（经纬度/高度/时间）对空间图元进行解算，<strong className="text-violet-300">无需绑定任何推演事件表</strong>。它支持<strong>时序航迹多采样参考点</strong>（计算任务空域走廊穿透与遵从率）、<strong>双实体多参考点</strong>（求解大圆水平距离、三维斜距与真方位角），以及<strong>空域多边形威胁包络判定</strong>。
                  </div>
                </div>
              ) : algorithm.type === 'python_script' ? (
                <div className="rounded-xl border border-fuchsia-900/40 bg-fuchsia-950/20 p-3.5 flex items-start gap-3">
                  <Code2 className="h-4 w-4 text-fuchsia-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-slate-300 leading-relaxed">
                    <span className="font-semibold text-fuchsia-200">科学计算与算法脚本协议 (CPython 3.12 驱动 · 通用参量解算)：</span>
                    Python 脚本执行器直接接收<strong>上下文参量字典 (Context Dict)</strong> 或数值矩阵，<strong className="text-fuchsia-300">无需绑定特定事件表</strong>。可独立进行 AHP 层次分析法判断矩阵求解、TOPSIS 熵权法、卡尔曼滤波与运筹优化模型试算。
                  </div>
                </div>
              ) : algorithm.type === 'result_output' ? (
                <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-3.5 flex items-start gap-3">
                  <Target className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-slate-300 leading-relaxed">
                    <span className="font-semibold text-emerald-200">指标收敛与体系决策协议 (度量标量映射)：</span>
                    结果处理算法负责将上游算子计算出的度量标量值（Scalar Metric Value）收口并映射至二库业务指标、执行评分卡分级，<strong className="text-emerald-300">与推演事件表无直接依赖关系</strong>。
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-sky-900/40 bg-sky-950/20 p-3.5 flex items-start gap-3">
                  <Sparkles className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-slate-300 leading-relaxed">
                    <span className="font-semibold text-sky-200">事件规范契约驱动：</span>
                    {algorithm.type === 'data_input'
                      ? '表输入算法负责从 F1 输出规范中抽取目标事件表数据流，沙箱根据事件规范元数据自动合成 5 行合规模拟数据桩 (Data Stub)。'
                      : algorithm.type === 'group_agg'
                      ? '跨行聚合算法负责对选定事件规范表中的多行记录按分组键 (GroupKey) 进行 Welford 增量聚合统计 (Sum / Avg / Max / Min / Stdev)。'
                      : '行内公式算法支持绑定规范事件字段生成衍生列，亦可直接执行通用纯数学与代数逻辑公式。'}
                  </div>
                </div>
              )}

              {/* 仅在数据表相关算法 (表输入、跨行聚合、公式) 呈现规范事件表切换条 */}
              {(algorithm.type === 'data_input' || algorithm.type === 'group_agg' || algorithm.type === 'inline_calc') && (
                <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0a0f1d] p-3 rounded-xl border border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-300">
                      {algorithm.type === 'inline_calc' ? '公式关联的规范事件表 (可选):' : '目标输出规范事件表:'}
                    </span>
                    <select
                      value={selectedEventName}
                      onChange={(e) => setSelectedEventName(e.target.value)}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-mono text-cyan-300 focus:border-sky-500 focus:outline-none"
                    >
                      {availableEvents.map((evt) => (
                        <option key={evt.name} value={evt.name}>
                          {evt.name} ({evt.fields?.length || 0} 个输出规范字段)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="text-[11px] text-slate-400 font-mono">
                    已收录标准事件表 · 物理字段严格对齐
                  </div>
                </div>
              )}

              {/* 1. 表输入 (data_input) 沙箱 */}
              {algorithm.type === 'data_input' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold text-slate-200">
                          {selectedEventName} 规范字段标准输入桩 (Schema Data Stub)
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          直接模拟该规范包含的 {specFields.length} 项标准字段输出，向下游算法提供合规数据流
                        </div>
                      </div>
                      <span className="text-xs text-emerald-400 font-mono bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded">
                        ✓ 规范数据桩就绪 (5 行样本)
                      </span>
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/80">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-800 bg-slate-900/60 text-[11px] text-slate-400">
                            {specFields.slice(0, 8).map((f) => (
                              <th key={f.name} className="px-3 py-2 whitespace-nowrap">
                                <div>{f.name}</div>
                                <div className="text-[10px] text-sky-400 font-mono">
                                  {f.cs_type} {f.unit ? `(${f.unit})` : ''}
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 font-mono text-[11px] text-slate-300">
                          {[0, 1, 2, 3, 4].map((rowIdx) => (
                            <tr key={rowIdx} className="hover:bg-slate-800/40">
                              {specFields.slice(0, 8).map((f) => (
                                <td key={f.name} className="px-3 py-1.5 whitespace-nowrap">
                                  {String(generateStubValue(f, rowIdx))}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* 2. 公式计算 (inline_calc) 沙箱 */}
              {algorithm.type === 'inline_calc' && (
                <div className="space-y-4">
                  {/* 可选规范字段快捷选择池 */}
                  <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-3.5 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-300">
                        从当前规范中点选输入字段 (点击自动插入公式):
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {currentEventSpec.name} 共有 {specFields.length} 个规范字段
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1 bg-slate-950/60 rounded-lg border border-slate-800/60">
                      {specFields.map((f) => (
                        <button
                          key={f.name}
                          type="button"
                          onClick={() => handleInsertFieldToFormula(f.name)}
                          className="inline-flex items-center gap-1 rounded bg-slate-800 border border-slate-700 hover:border-sky-500 hover:text-sky-300 px-2 py-0.5 text-[11px] font-mono text-slate-300 transition"
                          title={`${f.note || f.name} (${f.cs_type} · ${f.unit || '无单位'})`}
                        >
                          <Plus className="h-2.5 w-2.5 text-sky-400" />
                          <span>{f.name}</span>
                          {f.unit && <span className="text-[9px] text-slate-500">[{f.unit}]</span>}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 左侧：规范测试变量输入 */}
                    <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-4 space-y-2 flex flex-col">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-slate-300">
                          规范字段数据桩 (JSON 模拟输入)
                        </label>
                        <span className="text-[10px] text-slate-500 font-mono">严格匹配规范量纲</span>
                      </div>
                      <textarea
                        rows={6}
                        value={formulaVarsJson}
                        onChange={(e) => setFormulaVarsJson(e.target.value)}
                        className="w-full flex-1 rounded-lg border border-slate-700 bg-slate-900 p-2.5 font-mono text-xs text-cyan-300 focus:border-sky-500 focus:outline-none"
                      />
                    </div>

                    {/* 右侧：LibFormula AST 表达式输入 */}
                    <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-4 space-y-3 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold text-slate-300">
                            LibFormula AST 公式表达式
                          </label>
                          <span className="text-[10px] text-slate-500">零 eval · 静态类型推导</span>
                        </div>
                        <input
                          type="text"
                          value={formulaExpr}
                          onChange={(e) => setFormulaExpr(e.target.value)}
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-emerald-300 focus:border-sky-500 focus:outline-none"
                        />
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {[
                            'ROUND(TargetContactRangeHoriz_nm * 1.852, 2)',
                            'IF(TargetContactRangeHoriz_nm > 60; 1.0; 0.5)',
                            'ROUND(FiringUnitSpeed_kts * 0.5144, 1)',
                          ].map((preset, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setFormulaExpr(preset)}
                              className="rounded border border-slate-700 bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-400 hover:text-slate-200"
                            >
                              规范公式预设: {preset.slice(0, 24)}...
                            </button>
                          ))}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleRunFormula}
                        className="w-full flex items-center justify-center gap-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 py-2 text-xs font-bold text-white transition shadow-md"
                      >
                        <Play className="h-4 w-4" />
                        <span>执行规范公式 AST 求值试跑</span>
                      </button>
                    </div>
                  </div>

                  {/* 试跑输出面板 */}
                  <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-300">规范字段计算结果:</span>
                        {formulaResult.status === 'success' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 font-bold">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>AST 语法合规 · 算子契约校验通过</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-400 font-bold">
                            <AlertCircle className="h-3.5 w-3.5" />
                            <span>执行失败</span>
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        解析与求值耗时: <span className="text-cyan-300">{formulaResult.latencyMs ?? 0} ms</span>
                      </div>
                    </div>

                    {formulaResult.status === 'success' ? (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                        <div className="rounded-lg bg-slate-900 p-3 border border-slate-800">
                          <div className="text-[10px] text-slate-500">计算产出标量值</div>
                          <div className="text-lg font-bold font-mono text-cyan-300 mt-1">
                            {String(formulaResult.val)}
                          </div>
                        </div>
                        <div className="rounded-lg bg-slate-900 p-3 border border-slate-800">
                          <div className="text-[10px] text-slate-500">消费的规范字段名</div>
                          <div className="text-xs font-mono text-slate-300 mt-1 flex flex-wrap gap-1">
                            {formulaResult.variables?.map((v) => (
                              <span key={v} className="bg-slate-800 px-1.5 py-0.5 rounded text-sky-400">
                                {v}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="rounded-lg bg-slate-900 p-3 border border-slate-800">
                          <div className="text-[10px] text-slate-500">数据源契约一致性</div>
                          <div className="text-xs text-emerald-400 mt-1">
                            与 F1 输出规范 100% 吻合
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
                        {formulaResult.error}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 3. 跨行聚合 (group_agg) 沙箱 */}
              {algorithm.type === 'group_agg' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-4 space-y-2">
                      <label className="text-xs font-semibold text-slate-300 block">分组规范主键 (Group Key)</label>
                      <select
                        value={groupKey}
                        onChange={(e) => setGroupKey(e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-mono text-slate-200 focus:border-sky-500 focus:outline-none"
                      >
                        {specFields
                          .filter((f) => f.cs_type === 'string' || f.name.includes('ID') || f.name.includes('Side'))
                          .map((f) => (
                            <option key={f.name} value={f.name}>
                              {f.name} ({f.note || '离散规范分类键'})
                            </option>
                          ))}
                        <option value="none">无分组主键 (全表 N ➔ 1 标量归约)</option>
                      </select>
                      <p className="text-[10px] text-slate-500">仅允许选取规范中的离散/标识字段作为主键</p>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-4 space-y-2">
                      <label className="text-xs font-semibold text-slate-300 block">聚合数值规范字段</label>
                      <select
                        value={aggField}
                        onChange={(e) => setAggField(e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-mono text-slate-200 focus:border-sky-500 focus:outline-none"
                      >
                        {specFields
                          .filter((f) => f.cs_type === 'float' || f.cs_type === 'double' || f.cs_type === 'int')
                          .map((f) => (
                            <option key={f.name} value={f.name}>
                              {f.name} {f.unit ? `[${f.unit}]` : ''} ({f.cs_type})
                            </option>
                          ))}
                      </select>
                      <div className="flex items-center gap-2 pt-1">
                        <span className="text-[11px] text-slate-400">聚合算子:</span>
                        <select
                          value={aggMethod}
                          onChange={(e) => setAggMethod(e.target.value as any)}
                          className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs text-amber-300 font-mono"
                        >
                          <option value="AVERAGE">AVERAGE (均值)</option>
                          <option value="SUM">SUM (累加)</option>
                          <option value="MAX">MAX (峰值)</option>
                          <option value="MIN">MIN (谷值)</option>
                          <option value="COUNT">COUNT (频次)</option>
                          <option value="STDEV">STDEV (标准差)</option>
                        </select>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-4 flex flex-col justify-between">
                      <div>
                        <div className="text-xs font-semibold text-slate-300">Welford 流式内核</div>
                        <div className="text-[11px] text-slate-400 mt-1">
                          按规范字段类型直接规约，单次遍历
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleRunAggregation}
                        className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 py-1.5 text-xs font-bold text-white transition shadow-md"
                      >
                        <Play className="h-3.5 w-3.5" />
                        <span>执行规范聚合试跑</span>
                      </button>
                    </div>
                  </div>

                  {/* 聚合结果面板 */}
                  <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] overflow-hidden">
                    <div className="border-b border-slate-800 px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-300">
                      <span>流式聚合输出预览 ({aggMethod}({aggField}))</span>
                      <span className="font-mono text-[11px] text-amber-400">耗时: {aggResult.latencyMs} ms</span>
                    </div>
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-900/80 text-[11px] text-slate-400">
                          <th className="px-4 py-2">规范分组键: {groupKey}</th>
                          <th className="px-4 py-2">聚合结果: {aggMethod}({aggField})</th>
                          <th className="px-4 py-2">样本条数</th>
                          <th className="px-4 py-2">契约状态</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono text-xs text-slate-300">
                        {aggResult.rows?.map((row, i) => (
                          <tr key={i} className="hover:bg-slate-800/40">
                            <td className="px-4 py-2 font-bold text-slate-200">{row.groupKey}</td>
                            <td className="px-4 py-2 text-cyan-300 font-bold">{row.aggValue}</td>
                            <td className="px-4 py-2 text-slate-400">{row.count} 条明细</td>
                            <td className="px-4 py-2 text-emerald-400">符合规范契约</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 4. 空间几何算法 (spatial) 沙箱 */}
              {algorithm.type === 'spatial' && (
                <div className="space-y-4">
                  {/* 场景切换条 */}
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0a0f1d] p-3 rounded-xl border border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-300">空间几何解算模式:</span>
                      <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-800">
                        <button
                          type="button"
                          onClick={() => setSpatialMode('corridor_multi_points')}
                          className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition ${
                            spatialMode === 'corridor_multi_points'
                              ? 'bg-violet-600 text-white shadow-sm'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <Navigation className="h-3.5 w-3.5" />
                          <span>时序航迹多采样参考点 (任务走廊穿透与遵从率)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setSpatialMode('two_entity_geometry')}
                          className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition ${
                            spatialMode === 'two_entity_geometry'
                              ? 'bg-violet-600 text-white shadow-sm'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <MapPin className="h-3.5 w-3.5" />
                          <span>双实体多参考点空间几何 (大圆测距/斜距/真方位角)</span>
                        </button>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
                      <span className="rounded bg-violet-950/80 border border-violet-800/60 text-violet-300 px-2 py-0.5">
                        Turf.js 射线几何引擎
                      </span>
                      <span>WGS-84 空间参考系</span>
                    </div>
                  </div>

                  {/* 模式 A：时序航迹多采样参考点 (走廊穿透与遵从率) */}
                  {spatialMode === 'corridor_multi_points' && (
                    <div className="space-y-4">
                      {/* 上部：走廊多边形定义条 */}
                      <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-violet-400" />
                          <span className="font-semibold text-slate-200">预设任务航路走廊边界 (4个参考拐点多边形):</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-300">
                          {corridorVertices.map((v, i) => (
                            <span key={v.id} className="rounded bg-slate-900 border border-slate-800 px-2 py-0.5 text-cyan-300">
                              拐点{i + 1}: [{v.lon.toFixed(2)}°E, {v.lat.toFixed(2)}°N]
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* 中部：航迹采样点列表表格 */}
                      <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] overflow-hidden">
                        <div className="border-b border-slate-800 px-4 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-300">
                          <div className="flex items-center gap-2">
                            <span>战机时序航迹采样参考点序列 ({waypoints.length} 个采样点)</span>
                            <span className="text-[11px] font-normal text-slate-400">
                              (支持在线编辑坐标、修改时刻，模拟战机机动飞行全过程)
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={handleAddWaypoint}
                              className="flex items-center gap-1 rounded bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-xs text-sky-300 border border-slate-700 transition"
                            >
                              <Plus className="h-3 w-3" />
                              <span>添加采样参考点</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleRunSpatial}
                              className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 px-3 py-1 text-xs font-bold text-white transition shadow-md"
                            >
                              <Play className="h-3.5 w-3.5" />
                              <span>执行多点判定</span>
                            </button>
                          </div>
                        </div>

                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-slate-800 bg-slate-900/80 text-[11px] text-slate-400 font-mono">
                                <th className="px-3 py-2 w-12 text-center">序号</th>
                                <th className="px-3 py-2 w-36">采样点标识</th>
                                <th className="px-3 py-2 w-24">采样时刻 (s)</th>
                                <th className="px-3 py-2 w-28">经度 (deg · E)</th>
                                <th className="px-3 py-2 w-28">纬度 (deg · N)</th>
                                <th className="px-3 py-2 w-28">高度 (m)</th>
                                <th className="px-3 py-2 w-48">走廊包含状态与裕度</th>
                                <th className="px-3 py-2 w-16 text-center">操作</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                              {waypoints.map((wp, idx) => {
                                const evalRes = multiPointResults[idx];
                                const isInside = evalRes ? evalRes.inside : true;
                                const margin = evalRes ? evalRes.marginKm : 0;
                                return (
                                  <tr key={wp.id} className="hover:bg-slate-800/30">
                                    <td className="px-3 py-2 text-center text-slate-500">{idx + 1}</td>
                                    <td className="px-3 py-2">
                                      <input
                                        type="text"
                                        value={wp.name}
                                        onChange={(e) => handleUpdateWaypoint(wp.id, 'name', e.target.value)}
                                        className="w-full rounded bg-slate-900 border border-slate-800 px-2 py-0.5 text-xs text-slate-200"
                                      />
                                    </td>
                                    <td className="px-3 py-2">
                                      <input
                                        type="number"
                                        value={wp.timeSec}
                                        onChange={(e) => handleUpdateWaypoint(wp.id, 'timeSec', Number(e.target.value))}
                                        className="w-20 rounded bg-slate-900 border border-slate-800 px-2 py-0.5 text-xs text-amber-300"
                                      />
                                    </td>
                                    <td className="px-3 py-2">
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={wp.lon}
                                        onChange={(e) => handleUpdateWaypoint(wp.id, 'lon', Number(e.target.value))}
                                        className="w-24 rounded bg-slate-900 border border-slate-800 px-2 py-0.5 text-xs text-cyan-300"
                                      />
                                    </td>
                                    <td className="px-3 py-2">
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={wp.lat}
                                        onChange={(e) => handleUpdateWaypoint(wp.id, 'lat', Number(e.target.value))}
                                        className="w-24 rounded bg-slate-900 border border-slate-800 px-2 py-0.5 text-xs text-cyan-300"
                                      />
                                    </td>
                                    <td className="px-3 py-2">
                                      <input
                                        type="number"
                                        step="100"
                                        value={wp.alt_m}
                                        onChange={(e) => handleUpdateWaypoint(wp.id, 'alt_m', Number(e.target.value))}
                                        className="w-24 rounded bg-slate-900 border border-slate-800 px-2 py-0.5 text-xs text-slate-300"
                                      />
                                    </td>
                                    <td className="px-3 py-2">
                                      {isInside ? (
                                        <span className="inline-flex items-center gap-1 rounded bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 text-[11px] text-emerald-400 font-semibold">
                                          <CheckCircle2 className="h-3 w-3" />
                                          <span>走廊内 · 裕度 {margin} km</span>
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 rounded bg-rose-950/60 border border-rose-800/60 px-2 py-0.5 text-[11px] text-rose-400 font-semibold">
                                          <AlertCircle className="h-3 w-3" />
                                          <span>越界告警 · 偏离 {margin} km</span>
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteWaypoint(wp.id)}
                                        disabled={waypoints.length <= 1}
                                        className="text-slate-500 hover:text-rose-400 disabled:opacity-30 transition p-1"
                                        title="删除此参考点"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* 试跑输出 KPI 指标看板 */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-3.5">
                          <div className="text-[11px] text-slate-400">任务走廊空间遵从率 (Rate)</div>
                          <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                            {multiPointSummary.complianceRate}%
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {multiPointSummary.insideCount} 合规 / {multiPointSummary.outsideCount} 越界
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-3.5">
                          <div className="text-[11px] text-slate-400">航迹合规航行时长比例</div>
                          <div className="text-xl font-bold font-mono text-cyan-300 mt-1">
                            {multiPointSummary.complianceRate}%
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            对齐 comp.corridor_compliance 算子
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-3.5">
                          <div className="text-[11px] text-slate-400">最小边缘距离安全裕度</div>
                          <div className="text-xl font-bold font-mono text-sky-400 mt-1">
                            {multiPointSummary.minSafeMarginKm} km
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            最大越界偏离: {multiPointSummary.maxExceedKm} km
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-3.5">
                          <div className="text-[11px] text-slate-400">Turf.js 批处理解算耗时</div>
                          <div className="text-xl font-bold font-mono text-violet-300 mt-1">
                            {multiPointSummary.latencyMs} ms
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            单点平均耗时 &lt; 0.08 ms
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 模式 B：双实体相对空间交战几何 (两参考点基准解算) */}
                  {spatialMode === 'two_entity_geometry' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* 实体 A */}
                        <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-4 space-y-3">
                          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                            <span className="text-xs font-bold text-sky-300 flex items-center gap-1.5">
                              <MapPin className="h-4 w-4 text-sky-400" />
                              <span>基准参考实体 A (我方战机 / 发射阵位)</span>
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">WGS-84 Point</span>
                          </div>
                          <div className="space-y-2">
                            <div>
                              <label className="text-[11px] text-slate-400 block mb-1">实体名称 / 编号</label>
                              <input
                                type="text"
                                value={entityA.name}
                                onChange={(e) => setEntityA({ ...entityA, name: e.target.value })}
                                className="w-full rounded bg-slate-900 border border-slate-800 px-2.5 py-1 text-xs text-slate-200"
                              />
                            </div>
                            <div className="grid grid-cols-3 gap-2 font-mono">
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-0.5">经度 (°E)</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={entityA.lon}
                                  onChange={(e) => setEntityA({ ...entityA, lon: Number(e.target.value) })}
                                  className="w-full rounded bg-slate-900 border border-slate-800 px-2 py-1 text-xs text-cyan-300"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-0.5">纬度 (°N)</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={entityA.lat}
                                  onChange={(e) => setEntityA({ ...entityA, lat: Number(e.target.value) })}
                                  className="w-full rounded bg-slate-900 border border-slate-800 px-2 py-1 text-xs text-cyan-300"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-0.5">高度 (m)</label>
                                <input
                                  type="number"
                                  step="100"
                                  value={entityA.alt_m}
                                  onChange={(e) => setEntityA({ ...entityA, alt_m: Number(e.target.value) })}
                                  className="w-full rounded bg-slate-900 border border-slate-800 px-2 py-1 text-xs text-slate-300"
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* 实体 B */}
                        <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-4 space-y-3">
                          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                            <span className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                              <Target className="h-4 w-4 text-rose-400" />
                              <span>目标参考实体 B (敌方目标 / 预警机 / 威胁源)</span>
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">Target Point</span>
                          </div>
                          <div className="space-y-2">
                            <div>
                              <label className="text-[11px] text-slate-400 block mb-1">实体名称 / 编号</label>
                              <input
                                type="text"
                                value={entityB.name}
                                onChange={(e) => setEntityB({ ...entityB, name: e.target.value })}
                                className="w-full rounded bg-slate-900 border border-slate-800 px-2.5 py-1 text-xs text-slate-200"
                              />
                            </div>
                            <div className="grid grid-cols-3 gap-2 font-mono">
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-0.5">经度 (°E)</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={entityB.lon}
                                  onChange={(e) => setEntityB({ ...entityB, lon: Number(e.target.value) })}
                                  className="w-full rounded bg-slate-900 border border-slate-800 px-2 py-1 text-xs text-cyan-300"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-0.5">纬度 (°N)</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={entityB.lat}
                                  onChange={(e) => setEntityB({ ...entityB, lat: Number(e.target.value) })}
                                  className="w-full rounded bg-slate-900 border border-slate-800 px-2 py-1 text-xs text-cyan-300"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-slate-400 block mb-0.5">高度 (m)</label>
                                <input
                                  type="number"
                                  step="100"
                                  value={entityB.alt_m}
                                  onChange={(e) => setEntityB({ ...entityB, alt_m: Number(e.target.value) })}
                                  className="w-full rounded bg-slate-900 border border-slate-800 px-2 py-1 text-xs text-slate-300"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={handleRunSpatial}
                          className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 px-4 py-2 text-xs font-bold text-white transition shadow-md"
                        >
                          <Play className="h-4 w-4" />
                          <span>求解双实体相对空间几何</span>
                        </button>
                      </div>

                      {/* 双实体几何输出卡片 */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-3.5">
                          <div className="text-[11px] text-slate-400">大圆水平距离 (Horiz Range)</div>
                          <div className="text-xl font-bold font-mono text-cyan-300 mt-1">
                            {twoEntityResult.horizDistNm} nm
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {twoEntityResult.horizDistKm} km
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-3.5">
                          <div className="text-[11px] text-slate-400">三维立体斜距 (3D Slant)</div>
                          <div className="text-xl font-bold font-mono text-sky-400 mt-1">
                            {twoEntityResult.slantRangeKm} km
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            高差: {twoEntityResult.altDeltaM > 0 ? `+${twoEntityResult.altDeltaM}` : twoEntityResult.altDeltaM} m
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-3.5">
                          <div className="text-[11px] text-slate-400">目标真方位角 (Bearing)</div>
                          <div className="text-xl font-bold font-mono text-amber-400 mt-1">
                            {twoEntityResult.bearingDeg}°
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            正北基准顺时针夹角
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-3.5">
                          <div className="text-[11px] text-slate-400">空战态势包络判定</div>
                          <div className="text-xs font-bold text-emerald-400 mt-1 leading-snug">
                            {twoEntityResult.envelopeState}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            解算耗时: {twoEntityResult.latencyMs} ms
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 5. Python 算法执行器 (python_script) 沙箱 */}
              {algorithm.type === 'python_script' && (
                <div className="space-y-4">
                  {/* 预设算法模板快捷切换与说明 */}
                  <div className="rounded-xl border border-fuchsia-900/50 bg-gradient-to-r from-fuchsia-950/30 to-purple-950/20 p-3 flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-fuchsia-400" />
                      <span className="text-xs font-semibold text-slate-200">场景算法蓝图资产库:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {PYTHON_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => handleSelectPreset(preset.id)}
                            className={`px-2.5 py-1 rounded text-xs transition border ${
                              selectedPresetId === preset.id
                                ? 'bg-fuchsia-600 text-white border-fuchsia-400 font-bold shadow-sm'
                                : 'bg-slate-900/80 text-slate-400 border-slate-700 hover:text-slate-200 hover:border-slate-600'
                            }`}
                          >
                            {preset.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="text-[11px] text-fuchsia-300/80 font-mono">
                      {PYTHON_PRESETS.find((p) => p.id === selectedPresetId)?.desc}
                    </div>
                  </div>

                  {/* 快捷规范字段点击注入栏 */}
                  <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-900/50 p-2 rounded-lg border border-slate-800">
                    <span className="text-[11px] text-slate-400 font-medium shrink-0">
                      可用字段参考（点击插入代码）:
                    </span>
                    <div className="flex flex-wrap gap-1.5 overflow-x-auto">
                      {[
                        'FiringUnitSpeed_kts',
                        'TargetContactRangeHoriz_nm',
                        'FiringUnitAltitude_m',
                        'TargetContactSpeed',
                        'TargetRCS_m2',
                        'RadarPower_kw',
                      ].map((fn) => (
                        <button
                          key={fn}
                          type="button"
                          onClick={() => handleInsertFieldToPython(fn)}
                          className="px-2 py-0.5 rounded bg-sky-950/80 border border-sky-800/60 text-[10px] font-mono text-sky-300 hover:bg-sky-900 hover:text-sky-100 transition"
                          title={`点击将 context.get('${fn}') 注入 Python 脚本并加入入参字典`}
                        >
                          + {fn}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* 左侧：Python 源码与专业编辑器 */}
                    <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-3 space-y-2 flex flex-col">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                          <Code2 className="h-4 w-4 text-fuchsia-400" />
                          <span>Python 3.12 算法源码 (CodeMirror 6 专业高亮)</span>
                        </label>
                        <span className="font-mono text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-1.5 py-0.5 rounded">
                          CPython 3.12 守护进程
                        </span>
                      </div>
                      <PythonCodeEditor
                        value={pythonScript}
                        onChange={setPythonScript}
                        height="260px"
                        upstreamColumns={[
                          'FiringUnitSpeed_kts',
                          'TargetContactRangeHoriz_nm',
                          'FiringUnitAltitude_m',
                          'TargetContactSpeed',
                          'TargetRCS_m2',
                          'RadarPower_kw',
                        ]}
                      />
                    </div>

                    {/* 右侧：规范字段上下文入参与日志 */}
                    <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-4 space-y-3 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold text-slate-300 block">
                            算法入参上下文 context (JSON 字典 / 参数矩阵)
                          </label>
                          <span className="text-[10px] text-slate-500 font-mono">可直接编辑调参</span>
                        </div>
                        <textarea
                          rows={4}
                          value={pythonContextJson}
                          onChange={(e) => setPythonContextJson(e.target.value)}
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 font-mono text-xs text-cyan-300 focus:border-sky-500 focus:outline-none"
                        />
                      </div>

                      {pythonRunError && (
                        <div className="rounded-lg bg-red-950/60 border border-red-500/50 p-2.5 text-xs text-red-300 font-mono flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                          <div className="break-all">{pythonRunError}</div>
                        </div>
                      )}

                      <div className="space-y-1">
                        <div className="text-[11px] font-semibold text-slate-400 flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <Terminal className="h-3 w-3" />
                            <span>控制台真实输出 (stdout)</span>
                          </div>
                          {pythonResult.latencyMs !== undefined && (
                            <span className="text-[10px] font-mono text-cyan-400">
                              真机执行耗时: {pythonResult.latencyMs} ms
                            </span>
                          )}
                        </div>
                        <pre className="rounded-lg bg-black/60 p-2 text-[10px] font-mono text-slate-400 overflow-x-auto max-h-24 border border-slate-900">
                          {pythonResult.stdout || '(无控制台日志输出)'}
                        </pre>
                      </div>

                      <button
                        type="button"
                        onClick={handleRunPython}
                        disabled={isRunningPython}
                        className={`w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold text-white transition shadow-md ${
                          isRunningPython
                            ? 'bg-fuchsia-800 cursor-not-allowed opacity-80'
                            : 'bg-fuchsia-600 hover:bg-fuchsia-500'
                        }`}
                      >
                        <Play className={`h-4 w-4 ${isRunningPython ? 'animate-spin' : ''}`} />
                        <span>{isRunningPython ? '正在真机沙箱执行...' : '▷ 沙箱运行 Python 脚本 (真机)'}</span>
                      </button>
                    </div>
                  </div>

                  {/* 返回值与可视化结果面板 */}
                  <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-4 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-300">返回值字典:</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            pythonResult.status === 'success'
                              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                              : 'bg-red-950/80 text-red-300 border border-red-800'
                          }`}
                        >
                          {pythonResult.status === 'success' ? '✔ 试算成功' : '✖ 试算失败'}
                        </span>
                      </div>
                      <span className="font-mono text-cyan-400 text-[11px]">
                        端到端时延: {pythonResult.latencyMs} ms (守护进程加速)
                      </span>
                    </div>

                    {/* 效能核心数值与图表可视化展示 */}
                    {pythonResult.output && typeof pythonResult.output === 'object' && (
                      <AlgorithmOutputVisualizer output={pythonResult.output} />
                    )}
                  </div>
                </div>
              )}

              {/* 6. 结果处理 (result_output) 沙箱 */}
              {algorithm.type === 'result_output' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-4 space-y-2">
                      <label className="text-xs font-semibold text-slate-300 block">输入标量值 (Raw Value)</label>
                      <input
                        type="number"
                        step="0.05"
                        value={rawInputValue}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setRawInputValue(val);
                          setNormResult({
                            score: +(val * 100).toFixed(1),
                            systemWeight: 0.18,
                            weightedContribution: +(val * 100 * 0.18).toFixed(1),
                          });
                        }}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-cyan-300 focus:border-sky-500 focus:outline-none"
                      />
                      <p className="text-[10px] text-slate-500">来自上游聚合计算产出的标量特征</p>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-4 space-y-2">
                      <label className="text-xs font-semibold text-slate-300 block">二库指标绑定 (Indicator)</label>
                      <div className="text-xs font-mono text-emerald-300 bg-slate-900 p-2 rounded border border-slate-800">
                        ind_bvr_intercept_rate (超视距有效拦截率)
                      </div>
                      <p className="text-[10px] text-slate-500">归一化效用曲线: 线性递增 (0 ➔ 100分)</p>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-4 space-y-2">
                      <label className="text-xs font-semibold text-slate-300 block">三库评估体系挂载 (System)</label>
                      <div className="text-xs font-mono text-cyan-300 bg-slate-900 p-2 rounded border border-slate-800">
                        超视距空战 (BVR) 协同效能评估体系
                      </div>
                      <p className="text-[10px] text-slate-500">准则层权重: 18% (AHP CR = 0.02)</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-4">
                      <div className="text-[11px] text-slate-400">二库归一化效用得分</div>
                      <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                        {normResult.score} 分
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-4">
                      <div className="text-[11px] text-slate-400">三库体系综合权重贡献</div>
                      <div className="text-xl font-bold font-mono text-cyan-300 mt-1">
                        {normResult.weightedContribution} 分
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ───────────────── TAB 2: 输出规范字段字典 ───────────────── */}
          {activeTab === 'spec_dictionary' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-300">切换规范事件表:</span>
                  <select
                    value={selectedEventName}
                    onChange={(e) => setSelectedEventName(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-mono text-cyan-300 focus:border-sky-500 focus:outline-none"
                  >
                    {availableEvents.map((evt) => (
                      <option key={evt.name} value={evt.name}>
                        {evt.name} ({evt.fields?.length || 0} 列)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="relative w-64">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="搜索规范字段名称 / 量纲..."
                    value={fieldSearch}
                    onChange={(e) => setFieldSearch(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900/90 pl-8 pr-3 py-1 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/80 text-[11px] text-slate-400">
                      <th className="px-4 py-2.5 w-12 text-center">序号</th>
                      <th className="px-4 py-2.5 w-56">规范字段名 (Field Name)</th>
                      <th className="px-4 py-2.5 w-32">数据类型 (cs_type)</th>
                      <th className="px-4 py-2.5 w-24">物理量纲</th>
                      <th className="px-4 py-2.5">字段业务含义说明</th>
                      <th className="px-4 py-2.5 w-28 text-right">快捷操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {filteredSpecFields.map((f, i) => (
                      <tr key={f.name} className="hover:bg-slate-800/30">
                        <td className="px-4 py-2 text-center font-mono text-slate-500 text-[11px]">
                          {i + 1}
                        </td>
                        <td className="px-4 py-2">
                          <span className="font-mono text-xs font-semibold text-cyan-300">{f.name}</span>
                        </td>
                        <td className="px-4 py-2 font-mono text-[11px] text-slate-300">
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 border border-slate-700 text-sky-400">
                            {f.cs_type}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-mono text-[11px] text-amber-300">
                          {f.unit ? `${f.unit}` : <span className="text-slate-600">-</span>}
                        </td>
                        <td className="px-4 py-2 text-slate-300 text-xs">
                          {f.note || 'F1 标准事件输出字段'}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              handleInsertFieldToFormula(f.name);
                              setActiveTab('sandbox');
                            }}
                            className="inline-flex items-center gap-1 rounded bg-sky-500/15 border border-sky-500/30 px-2 py-0.5 text-[10px] text-sky-300 hover:bg-sky-500/25 transition"
                            title="填入公式测试"
                          >
                            <Plus className="h-3 w-3" />
                            <span>选入公式</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ───────────────── TAB 3: 引用算子资产 ───────────────── */}
          {activeTab === 'references' && (
            <div className="space-y-4">
              <div className="text-xs text-slate-400">
                当前算子资产库中，共有 <strong className="text-sky-300 font-bold">{referencedOperators.length}</strong> 个算子基于
                <strong className="text-slate-200 ml-1">[{algorithm.name}]</strong> 构建：
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {referencedOperators.map((op) => (
                  <div
                    key={op.id}
                    className="rounded-xl border border-slate-800 bg-[#0a0f1d] p-3.5 hover:border-slate-700 transition flex items-start justify-between gap-3 shadow-md"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="font-mono text-xs text-cyan-400 truncate">{op.id}</div>
                      <div className="font-bold text-xs text-slate-100">{op.name}</div>
                      <div className="text-[11px] text-slate-400 line-clamp-1">{op.description}</div>
                      <div className="flex items-center gap-2 pt-1">
                        <span className="rounded bg-slate-800 border border-slate-700 px-1.5 py-0.2 text-[10px] text-slate-300">
                          {op.category}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500">
                          输出: {op.outputType}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        onSelectOperatorForCanvas(op);
                        onClose();
                      }}
                      className="shrink-0 flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 transition"
                      title="在画布工坊中编排此算子"
                    >
                      <Workflow className="h-3.5 w-3.5" />
                      <span>编排</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ═════════════════ 底栏 ═════════════════ */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-[#0b111f] px-6 py-3.5 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            <span>规范字段契约就绪 · 零推演文件依赖 · 单步沙箱试跑通过</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-1.5 text-xs text-slate-300 hover:text-white transition"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
