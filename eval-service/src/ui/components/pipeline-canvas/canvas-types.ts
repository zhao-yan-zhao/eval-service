/**
 * 画布流水线工坊 (Pipeline Canvas Studio) 核心类型定义
 */

import type {
  AggregationMethod,
  AggregationMetricItem,
  AggregationOperatorConfig,
  DerivedColumnConfig,
  FieldDataType,
  FormulaOperatorConfig,
  OptimalDirection,
  TableDataset,
} from '../../../core/types.ts';

export type PipelineNodeType =
  | 'data_input'     // 数据输入节点 (CSV / 态势帧)
  | 'inline_calc'    // 行内公式计算节点 (LibFormula)
  | 'group_agg'      // 跨行分组聚合节点 (GroupBy / Scalar Agg)
  | 'result_output'  // 结果输出节点 (二库指标定义 + 三库体系挂载)
  | 'spatial'        // 空间几何算法节点 (Turf.js 任务走廊/合围多边形)
  | 'python_script'; // Python 算法执行器 (Python 3.12 桥接脚本)

export interface CanvasNodeConfig {
  // 节点一：数据输入
  sourceType?: 'csv' | 'bs_jsonl';
  csvTable?: string;
  selectedColumns?: string[];
  filterField?: string;
  filterEquals?: string;

  // 节点二：行内公式计算
  formulaConfig?: FormulaOperatorConfig;
  derivedColumns?: DerivedColumnConfig[];

  // 节点三：跨行聚合汇总
  aggregationConfig?: AggregationOperatorConfig;
  groupKeys?: string[];
  groupBy?: string[];
  aggregations?: AggregationMetricItem[];
  metrics?: AggregationMetricItem[];
  metricConfig?: Record<string, unknown>;

  // 节点四：结果输出 (二库指标与三库体系)
  targetField?: string;
  outputScoreField?: string;
  indicatorId?: string;
  indicatorName?: string;
  indicatorUnit?: string;
  optimalDirection?: OptimalDirection;
  thresholdHigh?: number;
  thresholdLow?: number;
  targetSystemId?: string;
  targetDimensionId?: string;

  // 节点五：空间几何算法
  spatialRule?: string;
  geomSourceMode?: string;
  geomTable?: string;
  geomLonField?: string;
  geomLatField?: string;
  geomGroupField?: string;
  geomOrderField?: string;
  corridorBounds?: number[][];
  minSafeMarginKm?: number;
  rangeMinKm?: number;
  rangeMaxKm?: number;
  threatCenterLon?: number;
  threatCenterLat?: number;
  threatRadiusKm?: number;
  stationAlignmentMode?: string;
  outputContainmentCol?: string;
  outputMarginCol?: string;
  lonField?: string;
  latField?: string;
  altField?: string;
  missionIdField?: string;
  unitIdField?: string;

  // 节点六：Python 脚本执行器
  pythonScriptCode?: string;
  pythonCode?: string;
  pythonTimeoutMs?: number;
  timeoutMs?: number;
  outputColumns?: Array<string | { name: string; type?: string }>;
}

export interface CanvasNodeRuntimeState {
  status: 'idle' | 'running' | 'success' | 'warning' | 'error';
  rowCount?: number;
  columnCount?: number;
  latencyMs?: number;
  outputDataset?: TableDataset;
  errorMessage?: string;
  diffCols?: string[];
}

export interface CanvasNode {
  id: string;
  type: PipelineNodeType;
  title: string;
  label?: string;
  description?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  config: CanvasNodeConfig;
  runtime?: CanvasNodeRuntimeState;
}

export interface CanvasEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
}

export interface CanvasViewportState {
  panX: number;
  panY: number;
  zoom: number; // 0.5 to 2.0
}

export interface PipelineTemplate {
  id: string;
  name: string;
  description: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}
