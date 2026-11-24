import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  Calculator,
  CheckCircle2,
  ChevronDown,
  Database,
  FilePlus2,
  FolderOpen,
  GitBranch,
  Layers,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RefreshCw,
  Save,
  Scale,
  Search,
  ShieldAlert,
  Sparkles,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import type {
  DagEdge,
  DagNodeBase,
  EvidenceRef,
  IndicatorReduceMethod,
  MetricDomainTag,
  MetricGraphDefinition,
  MetricMilitaryLevel,
  MetricNodeConfig,
  ParameterPortSpec,
  TableDataset,
} from '../../../core/types.ts';
import {
  DagCanvasBoard,
  type DagCanvasEdge,
  type DagCanvasNode,
  type DagNodeStatus,
} from '../dag-canvas/index.ts';
import { V4TablePivotPreview } from './V4TablePivotPreview.tsx';
import { UnifiedAssetSelector, type UnifiedAssetOption } from './UnifiedAssetSelector.tsx';

export interface MetricDagStudioPanelProps {
  activeSourceId?: string;
  selectedRunId?: string;
  onDrillDownToOperator?: (operatorId: string) => void;
}

interface V4OperatorOption {
  id: string;
  name: string;
  category?: string;
  militaryLevel?: MetricMilitaryLevel;
  domainTag?: MetricDomainTag;
  description?: string;
  unit?: string;
  requiredTables?: string[];
  outputColumns?: Array<{ name: string; type?: string; description?: string }>;
  parameterPorts?: ParameterPortSpec[];
}

interface MetricNodeExecState {
  nodeId: string;
  status: 'valid' | 'degraded' | 'unavailable';
  value?: number | boolean | null;
  dataset?: TableDataset;
  evidenceRefs?: EvidenceRef[];
  missingDataReason?: string;
  cacheKey?: string;
  cacheHit?: boolean;
  latencyMs?: number;
  resolvedParams?: Record<string, unknown>;
}

type MetricDagNode = DagNodeBase & { metricConfig?: MetricNodeConfig };
type StoredMetricGraph = MetricGraphDefinition & { builtin?: boolean };
type WorkspaceViewMode = 'list' | 'canvas';
type CanvasScope = 'lineage' | 'domain' | 'full';

interface SideComparisonExecSlice {
  nodeResults?: Record<string, MetricNodeExecState>;
  totalLatencyMs?: number;
  cacheHits?: number;
  cacheMisses?: number;
  runId?: string;
  execution?: {
    nodeResults?: Record<string, MetricNodeExecState>;
    totalLatencyMs?: number;
    cacheHits?: number;
    cacheMisses?: number;
    runId?: string;
  };
}

interface SideComparisonState {
  graphId: string;
  sides: string[];
  overall?: SideComparisonExecSlice;
  bySide: Record<string, SideComparisonExecSlice>;
  runId?: string;
}

interface OperatorPreviewState {
  operatorId: string;
  runId?: string;
  dataSourceId?: string;
  loading: boolean;
  error?: string;
  status?: 'valid' | 'degraded' | 'unavailable';
  dataset?: TableDataset;
  missingDataReason?: string;
  latencyMs?: number;
}

const MILITARY_LEVELS: MetricMilitaryLevel[] = ['MOP', 'MOE', 'MOFE'];
const MILITARY_LEVEL_ORDER: Record<MetricMilitaryLevel, number> = {
  MOP: 0,
  MOE: 1,
  MOFE: 2,
};

const MILITARY_LEVEL_BADGES: Record<MetricMilitaryLevel, string> = {
  MOP: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200',
  MOE: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  MOFE: 'border-teal-500/40 bg-teal-500/15 text-teal-200',
};

const DYNAMIC_SIDE_PALETTES = [
  {
    bar: 'bg-cyan-400',
    text: 'text-cyan-200',
    badge: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200',
  },
  {
    bar: 'bg-emerald-400',
    text: 'text-emerald-200',
    badge: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  },
  {
    bar: 'bg-amber-400',
    text: 'text-amber-200',
    badge: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  },
  {
    bar: 'bg-violet-400',
    text: 'text-violet-200',
    badge: 'border-violet-500/40 bg-violet-500/15 text-violet-200',
  },
  {
    bar: 'bg-rose-400',
    text: 'text-rose-200',
    badge: 'border-rose-500/40 bg-rose-500/15 text-rose-200',
  },
  {
    bar: 'bg-sky-400',
    text: 'text-sky-200',
    badge: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
  },
] as const;

const DOMAIN_OPTIONS: Array<{
  value: MetricDomainTag;
  label: string;
  cnLabel: string;
  cnShort: string;
}> = [
  { value: 'firepower', label: '火力打击', cnLabel: '火力打击', cnShort: '火力' },
  { value: 'isr', label: '侦察预警', cnLabel: '侦察预警', cnShort: '侦察' },
  { value: 'survivability', label: '生存防护', cnLabel: '生存防护', cnShort: '生存' },
  { value: 'c2', label: '指挥控制', cnLabel: '指挥控制', cnShort: '指通' },
  { value: 'synergy', label: '体系协同', cnLabel: '体系协同', cnShort: '协同' },
  { value: 'cost', label: '战损效费', cnLabel: '战损效费', cnShort: '效费' },
];

const DOMAIN_CN_MAP: Record<MetricDomainTag, string> = {
  firepower: '火力打击',
  isr: '侦察预警',
  survivability: '生存防护',
  c2: '指挥控制',
  synergy: '体系协同',
  cost: '战损效费',
};

const DERIVED_TIER_META: Record<
  MetricNodeConfig['mode'],
  { label: string; cnShort: string; badgeCls: string }
> = {
  from_operator: {
    label: '算子提取',
    cnShort: '算子提取',
    badgeCls: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
  },
  from_metric_agg: {
    label: '二次聚合',
    cnShort: '二次聚合',
    badgeCls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  },
  from_metric_formula: {
    label: '复合公式',
    cnShort: '复合公式',
    badgeCls: 'border-teal-500/40 bg-teal-500/10 text-teal-300',
  },
};

const REDUCE_OPTIONS: Array<{ value: '' | IndicatorReduceMethod; label: string }> = [
  { value: '', label: '(保留明细表 / 不做标量归约)' },
  { value: 'mean', label: 'mean · 平均值' },
  { value: 'sum', label: 'sum · 求和' },
  { value: 'max', label: 'max · 最大值' },
  { value: 'min', label: 'min · 最小值' },
  { value: 'median', label: 'median · 中位数' },
  { value: 'first', label: 'first · 首行值' },
  { value: 'last', label: 'last · 末行值' },
];

const MODE_LABELS: Record<MetricNodeConfig['mode'], string> = {
  from_operator: '算子引用',
  from_metric_agg: '多维聚合',
  from_metric_formula: '复合公式衍生',
};

function sanitizeVarAlias(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, '_');
  if (!cleaned) return 'm_var';
  return /^[a-zA-Z_]/.test(cleaned) ? cleaned : `m_${cleaned}`;
}

function pickDefaultMetricGraph(list: StoredMetricGraph[]): StoredMetricGraph | undefined {
  if (list.length === 0) return undefined;
  return (
    list.find((g) => g.graphId === 'mg_v4_metrics_guide_full') ??
    list.find(
      (g) =>
        !g.graphId.toLowerCase().includes('demo') &&
        !(g.name ?? '').toLowerCase().includes('demo'),
    ) ??
    list[0]
  );
}

/**
 * 为链路聚焦子图生成无重叠的层级排版坐标（仅用于局部视图投影，不覆盖完整图集坐标）
 */
function computeFocusedSubgraphPositions(
  nodes: MetricDagNode[],
  edges: DagEdge[],
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return result;

  const nodeIds = new Set(nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const depth = new Map<string, number>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    outgoing.set(n.id, []);
    depth.set(n.id, 0);
  }

  for (const e of edges) {
    if (!nodeIds.has(e.sourceNodeId) || !nodeIds.has(e.targetNodeId)) continue;
    if (e.sourceNodeId === e.targetNodeId) continue;
    outgoing.get(e.sourceNodeId)?.push(e.targetNodeId);
    inDegree.set(e.targetNodeId, (inDegree.get(e.targetNodeId) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const n of nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0) {
      queue.push(n.id);
    }
  }

  const visited = new Set<string>();
  while (queue.length > 0) {
    const curr = queue.shift()!;
    visited.add(curr);
    const currDepth = depth.get(curr) ?? 0;
    for (const next of outgoing.get(curr) ?? []) {
      const candidate = currDepth + 1;
      if (candidate > (depth.get(next) ?? 0)) {
        depth.set(next, candidate);
      }
      const nextDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, nextDeg);
      if (nextDeg <= 0 && !visited.has(next)) {
        queue.push(next);
      }
    }
  }

  const columns = new Map<number, MetricDagNode[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    const list = columns.get(d) ?? [];
    list.push(n);
    columns.set(d, list);
  }

  const COL_X_GAP = 330;
  const ROW_Y_GAP = 175;
  for (const [colIdx, colNodes] of columns.entries()) {
    colNodes.sort((a, b) => {
      const dy = (a.position?.y ?? 0) - (b.position?.y ?? 0);
      if (dy !== 0) return dy;
      const dx = (a.position?.x ?? 0) - (b.position?.x ?? 0);
      return dx !== 0 ? dx : a.id.localeCompare(b.id);
    });
    colNodes.forEach((n, rowIdx) => {
      result.set(n.id, {
        x: 60 + colIdx * COL_X_GAP,
        y: 60 + rowIdx * ROW_Y_GAP,
      });
    });
  }

  return result;
}

/**
 * 纯函数：沿 graph.edges 与 from_metric_agg / from_metric_formula 配置依赖
 * 双向 BFS 收集与 focusNodeId 相连的完整上下游血缘子图（孤立节点仅返回其自身 1 颗）
 */
export function collectLineageSubgraph(
  graph: MetricGraphDefinition,
  focusNodeId: string | null | undefined,
): { nodes: MetricDagNode[]; edges: DagEdge[]; nodeIdSet: Set<string> } {
  const nodeById = new Map<string, MetricDagNode>(graph.nodes.map((n) => [n.id, n]));
  if (!focusNodeId || !nodeById.has(focusNodeId)) {
    return { nodes: [], edges: [], nodeIdSet: new Set() };
  }

  const adj = new Map<string, Set<string>>();
  for (const n of graph.nodes) {
    adj.set(n.id, new Set());
  }

  const linkUndirected = (a: string, b: string) => {
    if (a === b || !nodeById.has(a) || !nodeById.has(b)) return;
    adj.get(a)?.add(b);
    adj.get(b)?.add(a);
  };

  // 1. 显式 DAG 连线（双向）
  for (const edge of graph.edges) {
    linkUndirected(edge.sourceNodeId, edge.targetNodeId);
  }

  // 建立 metricId / 变量别名索引，解析未显式连线的配置级上游依赖
  const metricIdToNodeIds = new Map<string, string[]>();
  const aliasToNodeIds = new Map<string, string[]>();
  for (const n of graph.nodes) {
    const mid = n.metricConfig?.metricId?.trim();
    if (mid) {
      const list = metricIdToNodeIds.get(mid) ?? [];
      list.push(n.id);
      metricIdToNodeIds.set(mid, list);

      const alias = sanitizeVarAlias(mid);
      const aList = aliasToNodeIds.get(alias) ?? [];
      aList.push(n.id);
      aliasToNodeIds.set(alias, aList);
    }
  }

  // 2. from_metric_agg / from_metric_formula 隐式配置依赖（双向）
  for (const node of graph.nodes) {
    const cfg = node.metricConfig;
    if (!cfg) continue;

    if (cfg.mode === 'from_metric_agg' && cfg.sourceRef) {
      const ref = cfg.sourceRef.trim();
      if (nodeById.has(ref)) {
        linkUndirected(ref, node.id);
      }
      for (const matchedId of metricIdToNodeIds.get(ref) ?? []) {
        linkUndirected(matchedId, node.id);
      }
    }

    if (cfg.mode === 'from_metric_formula') {
      if (cfg.sourceRef) {
        const ref = cfg.sourceRef.trim();
        if (nodeById.has(ref)) linkUndirected(ref, node.id);
        for (const matchedId of metricIdToNodeIds.get(ref) ?? []) {
          linkUndirected(matchedId, node.id);
        }
      }
      if (cfg.formulaExpression) {
        const tokens = cfg.formulaExpression.match(/[a-zA-Z_][a-zA-Z0-9_.]*/g) ?? [];
        for (const tok of tokens) {
          if (nodeById.has(tok)) {
            linkUndirected(tok, node.id);
          }
          for (const matchedId of metricIdToNodeIds.get(tok) ?? []) {
            linkUndirected(matchedId, node.id);
          }
          const aliasMatches = aliasToNodeIds.get(tok) ?? [];
          if (aliasMatches.length === 1) {
            linkUndirected(aliasMatches[0], node.id);
          }
        }
      }
    }
  }

  // 3. 双向 BFS 遍历连通分量
  const visited = new Set<string>([focusNodeId]);
  const queue: string[] = [focusNodeId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const neighbors = adj.get(cur);
    if (!neighbors) continue;
    for (const nb of neighbors) {
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push(nb);
      }
    }
  }

  const subNodes = graph.nodes.filter((n) => visited.has(n.id));
  const subEdges = graph.edges.filter(
    (e) => visited.has(e.sourceNodeId) && visited.has(e.targetNodeId),
  );
  return { nodes: subNodes, edges: subEdges, nodeIdSet: visited };
}

function createDraftMetricGraph(index = 1): MetricGraphDefinition {
  const suffix = Date.now().toString(36).slice(-4);
  return {
    graphId: `mg_draft_${suffix}_${index}`,
    name: index === 1 ? '联合作战客观指标流（本地草案）' : `新建客观指标流 ${index}`,
    description: '二库强隔离客观指标 DAG：仅输出物理量纲、客观比率与 TableDataset，严禁主观权重与效用打分',
    graphKind: 'metric',
    nodes: [
      {
        id: 'mn_strike_mission',
        kind: 'from_operator',
        label: '对地突击任务指标表',
        position: { x: 80, y: 100 },
        metricConfig: {
          metricId: 'strike.composite_mission_metrics',
          name: '对地突击任务指标表',
          militaryLevel: 'MOE',
          domainTag: 'firepower',
          mode: 'from_operator',
          sourceRef: 'strike.composite_mission_metrics',
          targetField: 'MissionCompletionRate',
          reduce: 'mean',
          unit: '0-1',
        },
      },
      {
        id: 'mn_patrol_mission',
        kind: 'from_operator',
        label: '空中巡逻任务指标表',
        position: { x: 80, y: 290 },
        metricConfig: {
          metricId: 'patrol.composite_mission_metrics',
          name: '空中巡逻任务指标表',
          militaryLevel: 'MOE',
          domainTag: 'survivability',
          mode: 'from_operator',
          sourceRef: 'patrol.composite_mission_metrics',
          targetField: 'MissionCompletionRate',
          reduce: 'mean',
          unit: '0-1',
        },
      },
      {
        id: 'mn_strike_side_agg',
        kind: 'from_metric_agg',
        label: '突击按分方二次汇总',
        position: { x: 430, y: 100 },
        metricConfig: {
          metricId: 'firepower.side_strike_completion',
          name: '突击按分方二次汇总',
          militaryLevel: 'MOE',
          domainTag: 'firepower',
          mode: 'from_metric_agg',
          sourceRef: 'strike.composite_mission_metrics',
          groupBy: ['Side'],
          targetField: 'MissionCompletionRate',
          reduce: 'mean',
          unit: '0-1',
        },
      },
      {
        id: 'mn_joint_completion_avg',
        kind: 'from_metric_formula',
        label: '突击与巡逻协同完成均值',
        position: { x: 780, y: 195 },
        metricConfig: {
          metricId: 'synergy.joint_mission_completion',
          name: '突击与巡逻协同完成均值',
          militaryLevel: 'MOFE',
          domainTag: 'synergy',
          mode: 'from_metric_formula',
          formulaExpression: '(strike_rate + patrol_rate) / 2',
          unit: '0-1',
        },
      },
    ],
    edges: [
      {
        id: 'me_strike_to_agg',
        sourceNodeId: 'mn_strike_mission',
        targetNodeId: 'mn_strike_side_agg',
      },
      {
        id: 'me_agg_to_joint',
        sourceNodeId: 'mn_strike_side_agg',
        targetNodeId: 'mn_joint_completion_avg',
        targetAlias: 'strike_rate',
      },
      {
        id: 'me_patrol_to_joint',
        sourceNodeId: 'mn_patrol_mission',
        targetNodeId: 'mn_joint_completion_avg',
        targetAlias: 'patrol_rate',
      },
    ],
  };
}

function normalizeOperatorList(rawList: unknown[]): V4OperatorOption[] {
  const out: V4OperatorOption[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id : '';
    if (!id) continue;
    out.push({
      id,
      name: typeof obj.name === 'string' ? obj.name : id,
      category: typeof obj.category === 'string' ? obj.category : undefined,
      militaryLevel:
        obj.militaryLevel === 'MOP' || obj.militaryLevel === 'MOE' || obj.militaryLevel === 'MOFE'
          ? obj.militaryLevel
          : obj.evalRole === 'MOP' || obj.evalRole === 'MOE'
            ? obj.evalRole
            : undefined,
      domainTag:
        typeof obj.domainTag === 'string' ? (obj.domainTag as MetricDomainTag) : undefined,
      description: typeof obj.description === 'string' ? obj.description : undefined,
      unit: typeof obj.unit === 'string' ? obj.unit : undefined,
      requiredTables: Array.isArray(obj.requiredTables)
        ? (obj.requiredTables as string[])
        : undefined,
      outputColumns: Array.isArray(obj.outputColumns)
        ? (obj.outputColumns as Array<{ name: string; type?: string; description?: string }>)
        : undefined,
      parameterPorts: Array.isArray(obj.parameterPorts)
        ? (obj.parameterPorts as ParameterPortSpec[])
        : undefined,
    });
  }
  return out;
}

function parseScalarValueInput(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) return Number(trimmed);
  return raw;
}

function stripMetricWeights(edges: DagEdge[]): DagEdge[] {
  return edges.map(({ weight: _discarded, ...rest }) => rest);
}

function extractNodeResultsFromSlice(
  slice?: SideComparisonExecSlice,
): Record<string, MetricNodeExecState> {
  if (!slice) return {};
  return slice.nodeResults ?? slice.execution?.nodeResults ?? {};
}

function formatMetricExecValue(exec?: MetricNodeExecState): string {
  if (!exec) return '—';
  if (exec.status === 'unavailable') return '缺数';
  if (typeof exec.value === 'number' && Number.isFinite(exec.value)) {
    return Number.isInteger(exec.value)
      ? exec.value.toLocaleString()
      : Number(exec.value.toFixed(4)).toString();
  }
  if (typeof exec.value === 'boolean') return exec.value ? 'TRUE' : 'FALSE';
  if (exec.dataset) return `${exec.dataset.rows?.length ?? 0} 行表`;
  return '—';
}

function getNumericMetricExecValue(exec?: MetricNodeExecState): number | null {
  if (!exec || exec.status === 'unavailable') return null;
  if (typeof exec.value === 'number' && Number.isFinite(exec.value)) return exec.value;
  return null;
}

function getExecStatusMeta(status?: 'valid' | 'degraded' | 'unavailable'): {
  label: string;
  cls: string;
} {
  if (status === 'valid') {
    return {
      label: 'valid',
      cls: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
    };
  }
  if (status === 'degraded') {
    return {
      label: 'degraded',
      cls: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
    };
  }
  if (status === 'unavailable') {
    return {
      label: 'unavailable',
      cls: 'border-rose-500/45 bg-rose-500/15 text-rose-300',
    };
  }
  return {
    label: 'idle',
    cls: 'border-slate-600/60 bg-slate-800/70 text-slate-400',
  };
}

function extractPreviewColumns(
  dataset?: TableDataset | null,
  fallbackCols?: Array<{ name: string; type?: string; description?: string }>,
): Array<{ name: string; type?: string; description?: string; fromSchemaOnly?: boolean }> {
  const seen = new Map<
    string,
    { name: string; type?: string; description?: string; fromSchemaOnly?: boolean }
  >();

  const rawCols = Array.isArray(dataset?.columns)
    ? dataset.columns
    : Array.isArray(dataset?.schema)
      ? dataset.schema
      : [];
  for (const col of rawCols) {
    if (!col?.name) continue;
    seen.set(col.name, {
      name: col.name,
      type: col.type,
      description: col.description || col.displayName,
    });
  }

  const rows = Array.isArray(dataset?.rows) ? dataset.rows : [];
  for (let i = 0; i < Math.min(rows.length, 10); i += 1) {
    const row = rows[i];
    if (!row || typeof row !== 'object') continue;
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.set(key, { name: key });
      }
    }
  }

  if (seen.size === 0 && Array.isArray(fallbackCols)) {
    for (const col of fallbackCols) {
      if (!col?.name || seen.has(col.name)) continue;
      seen.set(col.name, {
        name: col.name,
        type: col.type,
        description: col.description,
        fromSchemaOnly: true,
      });
    }
  }

  return Array.from(seen.values());
}

export function MetricDagStudioPanel({
  activeSourceId,
  selectedRunId,
  onDrillDownToOperator,
}: MetricDagStudioPanelProps) {
  const [operators, setOperators] = useState<V4OperatorOption[]>([]);
  const [graphs, setGraphs] = useState<StoredMetricGraph[]>([]);
  const [activeGraph, setActiveGraph] = useState<StoredMetricGraph>(() =>
    createDraftMetricGraph(1),
  );
  const [isLocalDraftMode, setIsLocalDraftMode] = useState(false);
  const [targetSide, setTargetSide] = useState<string>('ALL');
  const [discoveredSides, setDiscoveredSides] = useState<string[]>([]);

  const [viewMode, setViewMode] = useState<WorkspaceViewMode>('list');
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const savedListScrollTopRef = useRef<number>(0);

  useLayoutEffect(() => {
    if (viewMode === 'list' && listScrollRef.current) {
      listScrollRef.current.scrollTop = savedListScrollTopRef.current;
    }
  }, [viewMode]);
  const [canvasScope, setCanvasScope] = useState<CanvasScope>('lineage');
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [pinnedCanvasNodeIds, setPinnedCanvasNodeIds] = useState<string[]>([]);
  const [leftPaletteCollapsed, setLeftPaletteCollapsed] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'config' | 'preview'>('config');
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  const [listSearch, setListSearch] = useState('');
  const [listLevelFilter, setListLevelFilter] = useState<'ALL' | MetricMilitaryLevel>('ALL');
  const [listDomainFilter, setListDomainFilter] = useState<'ALL' | MetricDomainTag>('ALL');

  const [newMetricModalOpen, setNewMetricModalOpen] = useState(false);
  const [newMetricMode, setNewMetricMode] = useState<MetricNodeConfig['mode']>('from_operator');
  const [newMetricName, setNewMetricName] = useState('');
  const [newMetricIdInput, setNewMetricIdInput] = useState('');
  const [newMetricLevel, setNewMetricLevel] = useState<MetricMilitaryLevel>('MOP');
  const [newMetricDomain, setNewMetricDomain] = useState<MetricDomainTag>('firepower');
  const [newMetricUnit, setNewMetricUnit] = useState('');

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const [loadingInit, setLoadingInit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [comparingSides, setComparingSides] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'info' | 'warn' | 'error'; text: string } | null>(
    null,
  );

  const [execResults, setExecResults] = useState<Record<string, MetricNodeExecState>>({});
  const [sideComparison, setSideComparison] = useState<SideComparisonState | null>(null);
  const [lastExecStats, setLastExecStats] = useState<{
    totalLatencyMs?: number;
    cacheHits?: number;
    cacheMisses?: number;
    runId?: string;
  } | null>(null);

  // 一库算子直接预览二维表与点击选列状态
  const [opPreview, setOpPreview] = useState<OperatorPreviewState | null>(null);
  const opPreviewCacheRef = useRef<Map<string, OperatorPreviewState>>(new Map());
  const opPreviewSeqRef = useRef(0);

  // filterCriteria JSON / KV 双编辑状态
  const [filterEditMode, setFilterEditMode] = useState<'kv' | 'json'>('kv');
  const [filterJsonText, setFilterJsonText] = useState('{}');
  const [filterJsonError, setFilterJsonError] = useState<string | null>(null);
  const [newFilterKey, setNewFilterKey] = useState('');
  const [newFilterVal, setNewFilterVal] = useState('');

  const loadInitialData = useCallback(async () => {
    setLoadingInit(true);
    try {
      // 1. 加载一库 V4 算子列表（优先 layer=fact，兼容回退 /api/operators）
      let loadedOps: V4OperatorOption[] = [];
      try {
        const res = await fetch('/api/v4/operators?layer=fact');
        if (res.ok) {
          const json = (await res.json()) as { operators?: unknown[] };
          loadedOps = normalizeOperatorList(json.operators ?? []);
        } else if (res.status === 404) {
          const fbRes = await fetch('/api/v4/operators');
          if (fbRes.ok) {
            const fbJson = (await fbRes.json()) as { operators?: unknown[] };
            loadedOps = normalizeOperatorList(fbJson.operators ?? []);
          } else {
            const oldRes = await fetch('/api/operators');
            if (oldRes.ok) {
              const oldJson = (await oldRes.json()) as { operators?: unknown[] };
              loadedOps = normalizeOperatorList(oldJson.operators ?? []);
            }
          }
        }
      } catch {
        // 保持空列表并允许手填 sourceRef
      }
      setOperators(loadedOps);

      // 2. 加载二库已保存指标 DAG
      try {
        const gRes = await fetch('/api/v4/metric-graphs');
        if (gRes.ok) {
          const gJson = (await gRes.json()) as { graphs?: MetricGraphDefinition[] };
          const list = Array.isArray(gJson.graphs) ? gJson.graphs : [];
          setGraphs(list);
          if (list.length > 0) {
            const defaultGraph = pickDefaultMetricGraph(list) ?? list[0];
            setActiveGraph(structuredClone(defaultGraph));
            const firstNodeId = defaultGraph.nodes[0]?.id ?? null;
            setSelectedNodeId(firstNodeId);
            setFocusNodeId(firstNodeId);
            setIsLocalDraftMode(false);
          } else {
            const draft = createDraftMetricGraph(1);
            setActiveGraph(draft);
            const firstNodeId = draft.nodes[0]?.id ?? null;
            setSelectedNodeId(firstNodeId);
            setFocusNodeId(firstNodeId);
            setIsLocalDraftMode(true);
          }
        } else {
          const draft = createDraftMetricGraph(1);
          setGraphs([]);
          setActiveGraph(draft);
          const firstNodeId = draft.nodes[0]?.id ?? null;
          setSelectedNodeId(firstNodeId);
          setFocusNodeId(firstNodeId);
          setIsLocalDraftMode(true);
          setBanner({
            kind: 'warn',
            text: `GET /api/v4/metric-graphs 返回 HTTP ${gRes.status}，已载入本地可编辑指标 DAG 草案`,
          });
        }
      } catch {
        const draft = createDraftMetricGraph(1);
        setGraphs([]);
        setActiveGraph(draft);
        const firstNodeId = draft.nodes[0]?.id ?? null;
        setSelectedNodeId(firstNodeId);
        setFocusNodeId(firstNodeId);
        setIsLocalDraftMode(true);
        setBanner({
          kind: 'warn',
          text: '后端指标 DAG 接口暂不可达，已载入本地可编辑指标流草案',
        });
      }
    } finally {
      setLoadingInit(false);
    }
  }, []);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const handleOutside = (ev: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(ev.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [moreMenuOpen]);

  const selectedNode = useMemo(
    () => activeGraph.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [activeGraph.nodes, selectedNodeId],
  );

  const selectedEdge = useMemo(
    () => activeGraph.edges.find((e) => e.id === selectedEdgeId) ?? null,
    [activeGraph.edges, selectedEdgeId],
  );

  const nodeByMetricIdMap = useMemo(() => {
    const map = new Map<string, MetricDagNode>();
    for (const n of activeGraph.nodes) {
      map.set(n.id, n);
      const mid = n.metricConfig?.metricId?.trim();
      if (mid) map.set(mid, n);
    }
    return map;
  }, [activeGraph.nodes]);

  const handleChangeTargetSide = useCallback(
    (nextSide: string) => {
      setTargetSide(nextSide);
      if (sideComparison) {
        const activeSlice =
          nextSide !== 'ALL' && sideComparison.bySide[nextSide]
            ? sideComparison.bySide[nextSide]
            : sideComparison.overall;
        const nextNodeResults = extractNodeResultsFromSlice(activeSlice);
        if (Object.keys(nextNodeResults).length > 0) {
          setExecResults(nextNodeResults);
          setLastExecStats({
            totalLatencyMs:
              activeSlice?.totalLatencyMs ?? activeSlice?.execution?.totalLatencyMs,
            cacheHits: activeSlice?.cacheHits ?? activeSlice?.execution?.cacheHits,
            cacheMisses: activeSlice?.cacheMisses ?? activeSlice?.execution?.cacheMisses,
            runId: activeSlice?.runId ?? activeSlice?.execution?.runId ?? selectedRunId,
          });
        }
      }
    },
    [sideComparison, selectedRunId],
  );

  // 同步选中节点的 filterCriteria JSON 文本
  useEffect(() => {
    const fc = selectedNode?.metricConfig?.filterCriteria ?? {};
    setFilterJsonText(JSON.stringify(fc, null, 2));
    setFilterJsonError(null);
    setNewFilterKey('');
    setNewFilterVal('');
  }, [selectedNode?.id, selectedNode?.metricConfig?.filterCriteria]);

  const operatorMap = useMemo(
    () => new Map(operators.map((op) => [op.id, op])),
    [operators],
  );

  const selectedNodeOpMeta = useMemo(() => {
    if (selectedNode?.metricConfig?.mode !== 'from_operator') return undefined;
    const ref = selectedNode.metricConfig.sourceRef;
    return ref ? operatorMap.get(ref) : undefined;
  }, [selectedNode, operatorMap]);

  // 选定节点的上游输入边与可用变量别名
  const incomingEdgesForSelected = useMemo(() => {
    if (!selectedNodeId) return [];
    return activeGraph.edges.filter((e) => e.targetNodeId === selectedNodeId);
  }, [activeGraph.edges, selectedNodeId]);

  // 更新选中节点的 metricConfig
  const updateSelectedMetricConfig = useCallback(
    (patch: Partial<MetricNodeConfig>) => {
      if (!selectedNodeId) return;
      setActiveGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => {
          if (n.id !== selectedNodeId) return n;
          const curCfg: MetricNodeConfig = n.metricConfig ?? {
            metricId: n.id,
            name: n.label,
            militaryLevel: 'MOP',
            domainTag: 'firepower',
            mode: 'from_operator',
          };
          const nextCfg: MetricNodeConfig = { ...curCfg, ...patch };
          return {
            ...n,
            kind: patch.mode ?? n.kind,
            label: patch.name !== undefined ? patch.name : n.label,
            metricConfig: nextCfg,
          };
        }),
      }));
    },
    [selectedNodeId],
  );

  const enterCanvasForNode = useCallback((nodeId: string, scope: CanvasScope = 'lineage') => {
    setSelectedNodeId(nodeId);
    setFocusNodeId(nodeId);
    setSelectedEdgeId(null);
    setPinnedCanvasNodeIds([]);
    setCanvasScope(scope);
    setMoreMenuOpen(false);
    setDrawerTab('config');
    setViewMode('canvas');
  }, []);

  const handleSelectGraph = useCallback((target: StoredMetricGraph) => {
    setActiveGraph(structuredClone(target));
    const firstId = target.nodes[0]?.id ?? null;
    setSelectedNodeId(firstId);
    setFocusNodeId(firstId);
    setSelectedEdgeId(null);
    setPinnedCanvasNodeIds([]);
    setExecResults({});
    setSideComparison(null);
    setDiscoveredSides([]);
    setTargetSide('ALL');
    setLastExecStats(null);
    setIsLocalDraftMode(false);
  }, []);

  // 新增三类指标节点（支持画布工具栏快速添加与清单页「+ 新建指标」弹窗创建）
  const handleAddMetricNode = useCallback(
    (
      mode: MetricNodeConfig['mode'],
      options?: {
        metricId?: string;
        name?: string;
        militaryLevel?: MetricMilitaryLevel;
        domainTag?: MetricDomainTag;
        unit?: string;
        enterCanvas?: boolean;
      },
    ) => {
      const idx = activeGraph.nodes.length + 1;
      const uid = `${Date.now().toString(36).slice(-4)}_${idx}`;
      const nodeId = `mn_${mode === 'from_operator' ? 'op' : mode === 'from_metric_agg' ? 'agg' : 'fml'}_${uid}`;
      const defaultOp = operators[0];

      const baseCfg: MetricNodeConfig =
        mode === 'from_operator'
          ? {
              metricId:
                options?.metricId?.trim() ||
                (defaultOp ? `${defaultOp.id}.${uid}` : `metric.op_${uid}`),
              name:
                options?.name?.trim() ||
                (defaultOp ? `${defaultOp.name} 指标` : `算子引用指标 ${idx}`),
              militaryLevel: options?.militaryLevel ?? defaultOp?.militaryLevel ?? 'MOP',
              domainTag: options?.domainTag ?? defaultOp?.domainTag ?? 'firepower',
              mode: 'from_operator',
              sourceRef: defaultOp?.id ?? '',
              unit: options?.unit !== undefined ? options.unit : (defaultOp?.unit ?? ''),
            }
          : mode === 'from_metric_agg'
            ? {
                metricId: options?.metricId?.trim() || `metric.agg_${uid}`,
                name: options?.name?.trim() || `二次聚合指标 ${idx}`,
                militaryLevel: options?.militaryLevel ?? 'MOE',
                domainTag: options?.domainTag ?? selectedNode?.metricConfig?.domainTag ?? 'synergy',
                mode: 'from_metric_agg',
                sourceRef: selectedNode?.metricConfig?.metricId ?? '',
                reduce: 'mean',
                ...(options?.unit ? { unit: options.unit } : {}),
              }
            : {
                metricId: options?.metricId?.trim() || `metric.formula_${uid}`,
                name: options?.name?.trim() || `多指标复合公式 ${idx}`,
                militaryLevel: options?.militaryLevel ?? 'MOFE',
                domainTag: options?.domainTag ?? selectedNode?.metricConfig?.domainTag ?? 'synergy',
                mode: 'from_metric_formula',
                formulaExpression: 'm1',
                ...(options?.unit ? { unit: options.unit } : {}),
              };

      // 就近排布在当前锚点节点旁，避免落到超大图远处视野外
      const anchor = selectedNode ?? activeGraph.nodes.find((n) => n.id === focusNodeId) ?? null;
      const position = anchor
        ? mode === 'from_operator'
          ? { x: Math.max(60, anchor.position.x - 320), y: anchor.position.y + 130 }
          : { x: anchor.position.x + 350, y: anchor.position.y }
        : {
            x: 90 + (activeGraph.nodes.length % 3) * 330,
            y: 80 + Math.floor(activeGraph.nodes.length / 3) * 185,
          };

      const newNode: MetricDagNode = {
        id: nodeId,
        kind: mode,
        label: baseCfg.name,
        position,
        metricConfig: baseCfg,
      };

      const nextEdges = [...activeGraph.edges];
      if (!options?.enterCanvas && selectedNode && mode !== 'from_operator') {
        nextEdges.push({
          id: `me_${selectedNode.id}_${nodeId}_${Date.now().toString(36)}`,
          sourceNodeId: selectedNode.id,
          targetNodeId: nodeId,
          ...(mode === 'from_metric_formula'
            ? { targetAlias: sanitizeVarAlias(selectedNode.metricConfig?.metricId || selectedNode.id) }
            : {}),
        });
      }

      setActiveGraph((prev) => ({
        ...prev,
        nodes: [...prev.nodes, newNode],
        edges: stripMetricWeights(nextEdges),
      }));
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);

      if (options?.enterCanvas) {
        setFocusNodeId(nodeId);
        setPinnedCanvasNodeIds([]);
        setCanvasScope('lineage');
        setViewMode('canvas');
      } else {
        setPinnedCanvasNodeIds((prev) => (prev.includes(nodeId) ? prev : [...prev, nodeId]));
      }
    },
    [activeGraph.nodes, activeGraph.edges, operators, selectedNode, focusNodeId],
  );

  const handleNewDraftGraph = useCallback(() => {
    const draft = createDraftMetricGraph(graphs.length + 1);
    setActiveGraph(draft);
    const firstId = draft.nodes[0]?.id ?? null;
    setSelectedNodeId(firstId);
    setFocusNodeId(firstId);
    setSelectedEdgeId(null);
    setPinnedCanvasNodeIds([]);
    setExecResults({});
    setSideComparison(null);
    setDiscoveredSides([]);
    setTargetSide('ALL');
    setLastExecStats(null);
    setIsLocalDraftMode(true);
    setBanner({ kind: 'info', text: '已创建新的客观指标 DAG 草案，可编辑并保存' });
  }, [graphs.length]);

  const handleSaveGraph = useCallback(async () => {
    // 强制在提交前剥离任何 edge.weight，坚守二库强隔离
    const sanitized: MetricGraphDefinition = {
      ...activeGraph,
      graphKind: 'metric',
      edges: stripMetricWeights(activeGraph.edges),
    };

    setSaving(true);
    setBanner(null);
    try {
      const res = await fetch('/api/v4/metric-graphs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sanitized),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        errors?: string[];
        graph?: MetricGraphDefinition;
      };
      if (!res.ok || json.ok === false) {
        const msg =
          json.error ||
          (Array.isArray(json.errors) ? json.errors.join('；') : '') ||
          `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const savedGraph = json.graph ?? sanitized;
      setActiveGraph(savedGraph);
      setIsLocalDraftMode(false);
      setGraphs((prev) => {
        const idx = prev.findIndex((g) => g.graphId === savedGraph.graphId);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = savedGraph;
          return next;
        }
        return [...prev, savedGraph];
      });
      setBanner({ kind: 'info', text: `已保存指标 DAG「${savedGraph.name}」(${savedGraph.graphId})` });
    } catch (err) {
      setBanner({
        kind: 'error',
        text: `保存指标 DAG 失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSaving(false);
    }
  }, [activeGraph]);

  const handleDeleteGraph = useCallback(async () => {
    const gid = activeGraph.graphId;
    if (!gid) return;
    setSaving(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/v4/metric-graphs/${encodeURIComponent(gid)}`, {
        method: 'DELETE',
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const remaining = graphs.filter((g) => g.graphId !== gid);
      setGraphs(remaining);
      if (remaining.length > 0) {
        const nextGraph = pickDefaultMetricGraph(remaining) ?? remaining[0];
        setActiveGraph(structuredClone(nextGraph));
        const firstId = nextGraph.nodes[0]?.id ?? null;
        setSelectedNodeId(firstId);
        setFocusNodeId(firstId);
      } else {
        const draft = createDraftMetricGraph(1);
        setActiveGraph(draft);
        const firstId = draft.nodes[0]?.id ?? null;
        setSelectedNodeId(firstId);
        setFocusNodeId(firstId);
        setIsLocalDraftMode(true);
      }
      setPinnedCanvasNodeIds([]);
      setExecResults({});
      setSideComparison(null);
      setDiscoveredSides([]);
      setTargetSide('ALL');
      setBanner({ kind: 'info', text: `已删除指标 DAG: ${gid}` });
    } catch (err) {
      setBanner({
        kind: 'error',
        text: `删除失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSaving(false);
    }
  }, [activeGraph.graphId, graphs]);

  const handleExecuteMetricDag = useCallback(async () => {
    setExecuting(true);
    setBanner(null);
    const sanitizedGraph: MetricGraphDefinition = {
      ...activeGraph,
      graphKind: 'metric',
      edges: stripMetricWeights(activeGraph.edges),
    };

    try {
      const res = await fetch('/api/v4/metric-graphs/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: sanitizedGraph,
          runId: selectedRunId,
          dataSourceId: activeSourceId,
          ...(targetSide && targetSide !== 'ALL' ? { targetSide } : {}),
        }),
      });

      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || json.ok === false) {
        throw new Error(
          typeof json.error === 'string'
            ? json.error
            : `执行指标 DAG 失败 (HTTP ${res.status})`,
        );
      }

      const execution = (json.execution ?? json.result ?? json) as {
        nodeResults?: Record<string, MetricNodeExecState>;
        totalLatencyMs?: number;
        cacheHits?: number;
        cacheMisses?: number;
        runId?: string;
      };

      const rawNodeResults = execution.nodeResults ?? {};
      setExecResults(rawNodeResults);
      setLastExecStats({
        totalLatencyMs: execution.totalLatencyMs,
        cacheHits: execution.cacheHits,
        cacheMisses: execution.cacheMisses,
        runId: execution.runId ?? selectedRunId,
      });

      const nodeValues = Object.values(rawNodeResults);
      const unavailCount = nodeValues.filter((r) => r.status === 'unavailable').length;
      if (unavailCount > 0) {
        setBanner({
          kind: 'warn',
          text: `计算完成：${nodeValues.length - unavailCount}/${nodeValues.length} 项正常，${unavailCount} 项缺数`,
        });
      } else {
        setBanner({
          kind: 'info',
          text: `计算完成（${nodeValues.length} 个指标正常，耗时 ${(execution.totalLatencyMs ?? 0).toFixed(1)}ms）`,
        });
      }
    } catch (err) {
      setBanner({
        kind: 'error',
        text: `指标计算失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setExecuting(false);
    }
  }, [activeGraph, selectedRunId, activeSourceId, targetSide]);

  // 多阵营同屏对比试算（分方完全由后端动态发现）
  const handleCompareSides = useCallback(async () => {
    setComparingSides(true);
    setBanner(null);
    const sanitizedGraph: MetricGraphDefinition = {
      ...activeGraph,
      graphKind: 'metric',
      edges: stripMetricWeights(activeGraph.edges),
    };

    try {
      const res = await fetch(
        `/api/v4/metric-graphs/${encodeURIComponent(activeGraph.graphId)}/compare-sides`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            graph: sanitizedGraph,
            runId: selectedRunId,
            dataSourceId: activeSourceId,
          }),
        },
      );

      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        graphId?: string;
        sides?: unknown;
        overall?: SideComparisonExecSlice;
        bySide?: Record<string, SideComparisonExecSlice>;
      };
      if (!res.ok || json.ok === false) {
        const hint =
          res.status === 404 ? '（若为未保存草案，请先点击「保存指标 DAG」）' : '';
        throw new Error(
          `${json.error || `阵营对比计算失败 (HTTP ${res.status})`}${hint}`,
        );
      }

      const sides = Array.isArray(json.sides)
        ? json.sides.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        : [];
      const bySide = json.bySide ?? {};
      const overall = json.overall;

      setSideComparison({
        graphId: json.graphId ?? activeGraph.graphId,
        sides,
        overall,
        bySide,
        runId: selectedRunId,
      });
      setDiscoveredSides(sides);

      if (targetSide !== 'ALL' && !sides.includes(targetSide)) {
        setTargetSide('ALL');
      }

      const activeSlice =
        targetSide !== 'ALL' && bySide[targetSide] ? bySide[targetSide] : overall;
      const nextNodeResults = extractNodeResultsFromSlice(activeSlice);
      if (Object.keys(nextNodeResults).length > 0) {
        setExecResults(nextNodeResults);
        setLastExecStats({
          totalLatencyMs: activeSlice?.totalLatencyMs ?? activeSlice?.execution?.totalLatencyMs,
          cacheHits: activeSlice?.cacheHits ?? activeSlice?.execution?.cacheHits,
          cacheMisses: activeSlice?.cacheMisses ?? activeSlice?.execution?.cacheMisses,
          runId: activeSlice?.runId ?? activeSlice?.execution?.runId ?? selectedRunId,
        });
      }

      if (sides.length === 0) {
        setBanner({
          kind: 'warn',
          text: '阵营对比完成：当前推演数据中未包含阵营区分列',
        });
      } else {
        setBanner({
          kind: 'info',
          text: `阵营对比完成：共解析 ${sides.length} 个参演阵营（${sides.join(' / ')}）`,
        });
      }
    } catch (err) {
      setBanner({
        kind: 'error',
        text: `阵营对比失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setComparingSides(false);
    }
  }, [activeGraph, selectedRunId, activeSourceId, targetSide]);

  // 选中 from_operator 节点时：调用 POST /api/v4/operators/run 预览真实二维表并支持点击选列
  const runOperatorPreview = useCallback(
    async (operatorId: string, force = false) => {
      const trimmedId = operatorId.trim();
      if (!trimmedId) {
        setOpPreview(null);
        return;
      }
      const cacheKey = `${trimmedId}::${selectedRunId ?? ''}::${activeSourceId ?? ''}`;
      if (!force) {
        const cached = opPreviewCacheRef.current.get(cacheKey);
        if (cached) {
          setOpPreview(cached);
          return;
        }
      }

      const reqSeq = ++opPreviewSeqRef.current;
      setOpPreview({
        operatorId: trimmedId,
        runId: selectedRunId,
        dataSourceId: activeSourceId,
        loading: true,
      });

      try {
        const res = await fetch('/api/v4/operators/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operatorId: trimmedId,
            runId: selectedRunId,
            dataSourceId: activeSourceId,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          result?: {
            status?: 'valid' | 'degraded' | 'unavailable';
            dataset?: TableDataset;
            missingDataReason?: string;
            latencyMs?: number;
          };
        };
        if (reqSeq !== opPreviewSeqRef.current) return;
        if (!res.ok || json.ok === false || !json.result) {
          throw new Error(json.error || `算子试算失败 (HTTP ${res.status})`);
        }
        const nextState: OperatorPreviewState = {
          operatorId: trimmedId,
          runId: selectedRunId,
          dataSourceId: activeSourceId,
          loading: false,
          status: json.result.status,
          dataset: json.result.dataset,
          missingDataReason: json.result.missingDataReason,
          latencyMs: json.result.latencyMs,
        };
        opPreviewCacheRef.current.set(cacheKey, nextState);
        setOpPreview(nextState);
      } catch (err) {
        if (reqSeq !== opPreviewSeqRef.current) return;
        setOpPreview({
          operatorId: trimmedId,
          runId: selectedRunId,
          dataSourceId: activeSourceId,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [selectedRunId, activeSourceId],
  );

  const activeOpSourceRef =
    selectedNode?.metricConfig?.mode === 'from_operator'
      ? selectedNode.metricConfig.sourceRef?.trim() || ''
      : '';

  useEffect(() => {
    if (!activeOpSourceRef) {
      setOpPreview(null);
      return;
    }
    const isKnownOperator = operatorMap.has(activeOpSourceRef);
    const delayMs = isKnownOperator ? 0 : 350;
    const timer = setTimeout(() => {
      void runOperatorPreview(activeOpSourceRef, false);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [activeOpSourceRef, operatorMap, runOperatorPreview]);

  // 计算当前画布聚焦锚点与三个作用域子图 (当前链路 / 同能力域 / 完整图集)
  const effectiveFocusNodeId = useMemo(() => {
    if (focusNodeId && activeGraph.nodes.some((n) => n.id === focusNodeId)) {
      return focusNodeId;
    }
    if (selectedNodeId && activeGraph.nodes.some((n) => n.id === selectedNodeId)) {
      return selectedNodeId;
    }
    return activeGraph.nodes[0]?.id ?? null;
  }, [focusNodeId, selectedNodeId, activeGraph.nodes]);

  const effectiveFocusNode = useMemo(
    () => activeGraph.nodes.find((n) => n.id === effectiveFocusNodeId) ?? null,
    [activeGraph.nodes, effectiveFocusNodeId],
  );

  const activeFocusDomain = useMemo<MetricDomainTag>(() => {
    return (
      effectiveFocusNode?.metricConfig?.domainTag ??
      (listDomainFilter !== 'ALL' ? listDomainFilter : 'firepower')
    );
  }, [effectiveFocusNode, listDomainFilter]);

  const lineageSubgraph = useMemo(
    () => collectLineageSubgraph(activeGraph, effectiveFocusNodeId),
    [activeGraph, effectiveFocusNodeId],
  );

  const domainSubgraph = useMemo(() => {
    const domainNodes = activeGraph.nodes.filter(
      (n) => (n.metricConfig?.domainTag ?? 'firepower') === activeFocusDomain,
    );
    const nodeIds = new Set(domainNodes.map((n) => n.id));
    const domainEdges = activeGraph.edges.filter(
      (e) => nodeIds.has(e.sourceNodeId) && nodeIds.has(e.targetNodeId),
    );
    return { nodes: domainNodes, edges: domainEdges, nodeIdSet: nodeIds };
  }, [activeGraph.nodes, activeGraph.edges, activeFocusDomain]);

  const displayedSubgraph = useMemo(() => {
    if (canvasScope === 'full') {
      return {
        nodes: activeGraph.nodes,
        edges: activeGraph.edges,
        nodeIdSet: new Set(activeGraph.nodes.map((n) => n.id)),
      };
    }

    const base = canvasScope === 'lineage' ? lineageSubgraph : domainSubgraph;
    if (pinnedCanvasNodeIds.length === 0) {
      return base;
    }

    const pinnedSet = new Set(pinnedCanvasNodeIds);
    const mergedIdSet = new Set(base.nodeIdSet);
    for (const n of activeGraph.nodes) {
      if (pinnedSet.has(n.id)) mergedIdSet.add(n.id);
    }
    const mergedNodes = activeGraph.nodes.filter((n) => mergedIdSet.has(n.id));
    const mergedEdges = activeGraph.edges.filter(
      (e) => mergedIdSet.has(e.sourceNodeId) && mergedIdSet.has(e.targetNodeId),
    );
    return { nodes: mergedNodes, edges: mergedEdges, nodeIdSet: mergedIdSet };
  }, [
    canvasScope,
    activeGraph.nodes,
    activeGraph.edges,
    lineageSubgraph,
    domainSubgraph,
    pinnedCanvasNodeIds,
  ]);

  const [lineageDragPositions, setLineageDragPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});

  useEffect(() => {
    setLineageDragPositions({});
  }, [canvasScope, effectiveFocusNodeId, activeGraph.graphId]);

  const focusedLayoutMap = useMemo(() => {
    if (canvasScope !== 'lineage') return null;
    return computeFocusedSubgraphPositions(displayedSubgraph.nodes, displayedSubgraph.edges);
  }, [canvasScope, displayedSubgraph.nodes, displayedSubgraph.edges]);

  const displayedNodeIdsRef = useRef<Set<string>>(new Set());
  const displayedEdgeIdsRef = useRef<Set<string>>(new Set());
  displayedNodeIdsRef.current = displayedSubgraph.nodeIdSet;
  displayedEdgeIdsRef.current = new Set(displayedSubgraph.edges.map((e) => e.id));

  // 转换为通用画布节点/边契约（仅渲染当前作用域子图）
  const canvasNodes = useMemo<DagCanvasNode[]>(() => {
    return displayedSubgraph.nodes.map((node) => {
      const cfg = node.metricConfig;
      const exec = execResults[node.id];
      const ds = exec?.dataset;
      const hasDataset = Boolean(ds && (ds.rows?.length || ds.columns?.length));
      const rowCount = ds?.rows?.length ?? 0;
      const colCount = ds?.columns?.length ?? 0;

      const status: DagNodeStatus = executing
        ? 'running'
        : exec
          ? exec.status
          : 'idle';

      let displayValue: string | undefined;
      if (exec && exec.status !== 'unavailable') {
        if (exec.value !== undefined && exec.value !== null) {
          displayValue =
            typeof exec.value === 'number'
              ? Number.isInteger(exec.value)
                ? String(exec.value)
                : Number(exec.value.toFixed(4)).toString()
              : exec.value
                ? 'TRUE'
                : 'FALSE';
        } else if (hasDataset) {
          displayValue = `${rowCount} 行 × ${colCount} 列`;
        }
      }

      const modeShort =
        cfg?.mode === 'from_operator'
          ? '算子引用'
          : cfg?.mode === 'from_metric_agg'
            ? '二次聚合'
            : '复合公式';

      const subtitle = hasDataset
        ? `${modeShort} · ${rowCount}×${colCount} 表`
        : cfg?.mode === 'from_metric_formula'
          ? `公式: ${cfg.formulaExpression || '--'}`
          : cfg?.sourceRef
            ? `${modeShort}: ${cfg.sourceRef}`
            : modeShort;

      const canDrillDown = cfg?.mode === 'from_operator' && Boolean(cfg?.sourceRef);

      return {
        id: node.id,
        kind: cfg?.mode ?? node.kind,
        label: cfg?.name || node.label,
        position:
          lineageDragPositions[node.id] ??
          focusedLayoutMap?.get(node.id) ??
          node.position,
        collapsed: node.collapsed,
        parameterPorts: node.parameterPorts,
        params: node.params,
        graphKind: 'metric',
        status,
        canDrillDown,
        drillDownLabel: canDrillDown ? '下钻算子' : undefined,
        summary: {
          metricId: cfg?.metricId,
          militaryLevel: cfg?.militaryLevel ?? 'MOP',
          domainTag: cfg?.domainTag,
          value: exec?.value,
          displayValue,
          unit: cfg?.unit,
          dataset: ds,
          rowCount: ds ? rowCount : undefined,
          columnCount: ds ? colCount : undefined,
          subtitle,
          badgeText: cfg?.militaryLevel,
          latencyMs: exec?.latencyMs,
          cacheHit: exec?.cacheHit,
          missingDataReason: exec?.missingDataReason,
        },
      };
    });
  }, [displayedSubgraph.nodes, execResults, executing, focusedLayoutMap, lineageDragPositions]);

  const canvasEdges = useMemo<DagCanvasEdge[]>(() => {
    return displayedSubgraph.edges.map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      targetAlias: e.targetAlias,
      label: e.targetAlias ? `${e.targetAlias}` : undefined,
      graphKind: 'metric',
    }));
  }, [displayedSubgraph.edges]);

  // 局部画布拖拽/连线回写时，严格基于完整 activeGraph 合并保存，严禁丢弃未展示节点与连线
  const handleCanvasNodesChange = useCallback(
    (nextNodes: DagCanvasNode[]) => {
      const nextMap = new Map(nextNodes.map((cn) => [cn.id, cn]));
      const visibleIds = displayedNodeIdsRef.current;

      if (canvasScope === 'lineage') {
        const nextDrag: Record<string, { x: number; y: number }> = {};
        for (const cn of nextNodes) {
          nextDrag[cn.id] = cn.position;
        }
        setLineageDragPositions(nextDrag);
      }

      setActiveGraph((prev) => {
        const prevIds = new Set(prev.nodes.map((n) => n.id));
        const mergedNodes: MetricDagNode[] = [];

        for (const existing of prev.nodes) {
          if (!visibleIds.has(existing.id)) {
            mergedNodes.push(existing);
            continue;
          }
          const cn = nextMap.get(existing.id);
          if (!cn) {
            mergedNodes.push(existing);
            continue;
          }
          mergedNodes.push({
            ...existing,
            // 链路聚焦模式下仅更新局部投影坐标，不覆盖完整图集的原始坐标
            position: canvasScope === 'lineage' ? existing.position : cn.position,
            collapsed: cn.collapsed,
          });
        }

        for (const cn of nextNodes) {
          if (!prevIds.has(cn.id)) {
            mergedNodes.push({
              id: cn.id,
              kind: cn.kind,
              label: cn.label,
              position: cn.position,
              collapsed: cn.collapsed,
              parameterPorts: cn.parameterPorts,
              params: cn.params,
            });
          }
        }

        return { ...prev, nodes: mergedNodes };
      });
    },
    [canvasScope],
  );

  const handleCanvasEdgesChange = useCallback((nextEdges: DagCanvasEdge[]) => {
    const visibleEdgeIds = displayedEdgeIdsRef.current;
    const mappedNext = stripMetricWeights(
      nextEdges.map((e) => ({
        id: e.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        ...(e.targetAlias ? { targetAlias: e.targetAlias } : {}),
      })),
    );

    setActiveGraph((prev) => {
      const preservedHiddenEdges = prev.edges.filter((e) => !visibleEdgeIds.has(e.id));
      const preservedIds = new Set(preservedHiddenEdges.map((e) => e.id));
      const dedupedNext = mappedNext.filter((e) => !preservedIds.has(e.id));
      return {
        ...prev,
        edges: stripMetricWeights([...preservedHiddenEdges, ...dedupedNext]),
      };
    });
  }, []);

  const handleConnect = useCallback(
    (sourceNodeId: string, targetNodeId: string, newEdge: DagCanvasEdge) => {
      setActiveGraph((prev) => {
        const srcNode = prev.nodes.find((n) => n.id === sourceNodeId);
        const tgtNode = prev.nodes.find((n) => n.id === targetNodeId);
        const autoAlias =
          tgtNode?.metricConfig?.mode === 'from_metric_formula' && !newEdge.targetAlias
            ? sanitizeVarAlias(srcNode?.metricConfig?.metricId || sourceNodeId)
            : newEdge.targetAlias;

        const nextEdges = prev.edges.map((e) =>
          e.id === newEdge.id && autoAlias ? { ...e, targetAlias: autoAlias } : e,
        );

        const nextNodes = prev.nodes.map((n) => {
          if (
            n.id === targetNodeId &&
            n.metricConfig?.mode === 'from_metric_agg' &&
            !n.metricConfig.sourceRef
          ) {
            return {
              ...n,
              metricConfig: {
                ...n.metricConfig,
                sourceRef: srcNode?.metricConfig?.metricId || sourceNodeId,
              },
            };
          }
          return n;
        });

        return { ...prev, nodes: nextNodes, edges: stripMetricWeights(nextEdges) };
      });
    },
    [],
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setActiveGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.filter((n) => n.id !== nodeId),
        edges: prev.edges.filter((e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId),
      }));
      setPinnedCanvasNodeIds((prev) => prev.filter((id) => id !== nodeId));
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      if (focusNodeId === nodeId) setFocusNodeId(null);
    },
    [selectedNodeId, focusNodeId],
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      setActiveGraph((prev) => ({
        ...prev,
        edges: prev.edges.filter((e) => e.id !== edgeId),
      }));
      if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
    },
    [selectedEdgeId],
  );

  const handleDrillDown = useCallback(
    (nodeId: string) => {
      const node = activeGraph.nodes.find((n) => n.id === nodeId);
      if (
        node?.metricConfig?.mode === 'from_operator' &&
        node.metricConfig.sourceRef &&
        onDrillDownToOperator
      ) {
        onDrillDownToOperator(node.metricConfig.sourceRef);
      } else {
        setSelectedNodeId(nodeId);
      }
    },
    [activeGraph.nodes, onDrillDownToOperator],
  );

  // 为非算子引用节点确定预览数据集（自身执行产出或直接上游指标节点数据集）
  const activePreviewInfo = useMemo(() => {
    if (selectedNode && execResults[selectedNode.id]?.dataset) {
      return {
        node: selectedNode,
        exec: execResults[selectedNode.id],
        isUpstream: false,
      };
    }
    const cfg = selectedNode?.metricConfig;
    if (cfg?.mode === 'from_metric_agg' && cfg.sourceRef) {
      const upNode = nodeByMetricIdMap.get(cfg.sourceRef);
      if (upNode && execResults[upNode.id]?.dataset) {
        return {
          node: upNode,
          exec: execResults[upNode.id],
          isUpstream: true,
        };
      }
    }
    for (const edge of incomingEdgesForSelected) {
      const upNode = activeGraph.nodes.find((n) => n.id === edge.sourceNodeId);
      const upExec = execResults[edge.sourceNodeId];
      if (upNode && upExec?.dataset) {
        return {
          node: upNode,
          exec: upExec,
          isUpstream: true,
        };
      }
    }
    return {
      node: selectedNode,
      exec: selectedNode ? execResults[selectedNode.id] : undefined,
      isUpstream: false,
    };
  }, [selectedNode, activeGraph.nodes, execResults, nodeByMetricIdMap, incomingEdgesForSelected]);

  const opPreviewColumns = useMemo(
    () => extractPreviewColumns(opPreview?.dataset ?? null, selectedNodeOpMeta?.outputColumns),
    [opPreview?.dataset, selectedNodeOpMeta?.outputColumns],
  );

  const nonOpPreviewColumns = useMemo(
    () => extractPreviewColumns(activePreviewInfo.exec?.dataset ?? null),
    [activePreviewInfo.exec?.dataset],
  );

  // 当前节点的可用候选列（用于 groupBy / targetField 提示）
  const availableColumnSuggestions = useMemo(() => {
    const names = new Set<string>();
    for (const c of opPreviewColumns) names.add(c.name);
    for (const c of nonOpPreviewColumns) names.add(c.name);
    if (selectedNodeOpMeta?.outputColumns) {
      for (const c of selectedNodeOpMeta.outputColumns) names.add(c.name);
    }
    for (const edge of incomingEdgesForSelected) {
      const upCols = execResults[edge.sourceNodeId]?.dataset?.columns ?? [];
      for (const c of upCols) names.add(c.name);
    }
    return Array.from(names);
  }, [
    opPreviewColumns,
    nonOpPreviewColumns,
    selectedNodeOpMeta,
    incomingEdgesForSelected,
    execResults,
  ]);

  // 全图血缘索引（上游来源与下游引用节点）
  const lineageByNodeId = useMemo(() => {
    const nodeById = new Map(activeGraph.nodes.map((n) => [n.id, n]));
    const incoming = new Map<
      string,
      Array<{ edge: DagEdge; sourceNode?: MetricDagNode }>
    >();
    const outgoing = new Map<
      string,
      Array<{ edge: DagEdge; targetNode?: MetricDagNode }>
    >();

    for (const edge of activeGraph.edges) {
      const inArr = incoming.get(edge.targetNodeId) ?? [];
      inArr.push({ edge, sourceNode: nodeById.get(edge.sourceNodeId) });
      incoming.set(edge.targetNodeId, inArr);

      const outArr = outgoing.get(edge.sourceNodeId) ?? [];
      outArr.push({ edge, targetNode: nodeById.get(edge.targetNodeId) });
      outgoing.set(edge.sourceNodeId, outArr);
    }

    return { incoming, outgoing };
  }, [activeGraph.nodes, activeGraph.edges]);

  // 指标清单：按 militaryLevel (MOP -> MOE -> MOFE) & domainTag 排序过滤
  const filteredSortedNodes = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return [...activeGraph.nodes]
      .filter((n) => {
        const cfg = n.metricConfig;
        const level = cfg?.militaryLevel ?? 'MOP';
        const domain = cfg?.domainTag ?? 'firepower';
        if (listLevelFilter !== 'ALL' && level !== listLevelFilter) return false;
        if (listDomainFilter !== 'ALL' && domain !== listDomainFilter) return false;
        if (!q) return true;
        const haystack = [
          n.id,
          n.label,
          cfg?.metricId ?? '',
          cfg?.name ?? '',
          cfg?.sourceRef ?? '',
          cfg?.targetField ?? '',
          cfg?.formulaExpression ?? '',
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => {
        const la = MILITARY_LEVEL_ORDER[a.metricConfig?.militaryLevel ?? 'MOP'] ?? 9;
        const lb = MILITARY_LEVEL_ORDER[b.metricConfig?.militaryLevel ?? 'MOP'] ?? 9;
        if (la !== lb) return la - lb;
        const da = a.metricConfig?.domainTag ?? '';
        const db = b.metricConfig?.domainTag ?? '';
        if (da !== db) return da.localeCompare(db);
        const ma = a.metricConfig?.metricId ?? a.id;
        const mb = b.metricConfig?.metricId ?? b.id;
        return ma.localeCompare(mb);
      });
  }, [activeGraph.nodes, listSearch, listLevelFilter, listDomainFilter]);

  const domainCounts = useMemo(() => {
    const counts: Record<MetricDomainTag, number> = {
      firepower: 0,
      isr: 0,
      survivability: 0,
      c2: 0,
      synergy: 0,
      cost: 0,
    };
    for (const n of activeGraph.nodes) {
      const dom = n.metricConfig?.domainTag;
      if (dom && dom in counts) {
        counts[dom] += 1;
      }
    }
    return counts;
  }, [activeGraph.nodes]);

  const levelCounts = useMemo(() => {
    const counts: Record<MetricMilitaryLevel, number> = { MOP: 0, MOE: 0, MOFE: 0 };
    for (const n of activeGraph.nodes) {
      const lvl = n.metricConfig?.militaryLevel ?? 'MOP';
      counts[lvl] = (counts[lvl] ?? 0) + 1;
    }
    return counts;
  }, [activeGraph.nodes]);

  const selectedExec = selectedNode ? execResults[selectedNode.id] : undefined;

  const metricSelectorOptions = useMemo<UnifiedAssetOption[]>(() => {
    return activeGraph.nodes.map((n) => {
      const cfg = n.metricConfig;
      const lvl = cfg?.militaryLevel ?? 'MOP';
      const dom = cfg?.domainTag ? (DOMAIN_CN_MAP[cfg.domainTag] ?? cfg.domainTag) : '未分类';
      return {
        id: n.id,
        label: cfg?.name || n.label || n.id,
        subLabel: cfg?.metricId || n.id,
        group: dom,
        badge: lvl,
        badgeTone: lvl === 'MOFE' ? 'indigo' : lvl === 'MOE' ? 'cyan' : 'emerald',
      };
    });
  }, [activeGraph.nodes]);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-slate-100">
      {viewMode === 'list' ? (
        <div className="flex flex-col gap-3 rounded-xl border border-[#30363d] bg-[#161b22] p-3.5">
          {/* 统一单行紧凑顶栏：库徽章 + 计数 + 下拉直达画布 | 能力域下拉 + 层次下拉 + 搜索 + 主操作 */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#30363d] pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                <Layers className="h-3.5 w-3.5" />
                <span>指标清单</span>
              </div>
              <span
                title={`当前图集：${activeGraph.name} (${activeGraph.graphId})`}
                className="rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-0.5 font-mono text-[11px] text-slate-300 tabular-nums"
              >
                {filteredSortedNodes.length === activeGraph.nodes.length
                  ? `共 ${activeGraph.nodes.length} 项`
                  : `${filteredSortedNodes.length} / ${activeGraph.nodes.length} 项`}
              </span>

              <UnifiedAssetSelector
                value={effectiveFocusNodeId ?? ''}
                options={metricSelectorOptions}
                placeholder="定位指标..."
                searchPlaceholder="搜索名称、ID 或领域..."
                accent="emerald"
                onChange={(nodeId) => enterCanvasForNode(nodeId, 'lineage')}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="能力域筛选"
                value={listDomainFilter}
                onChange={(e) =>
                  setListDomainFilter(e.target.value as 'ALL' | MetricDomainTag)
                }
                className="h-8 rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none cursor-pointer"
              >
                <option value="ALL">全部分域 ({activeGraph.nodes.length})</option>
                {DOMAIN_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.cnShort} ({domainCounts[opt.value] ?? 0})
                  </option>
                ))}
              </select>

              <select
                aria-label="层次筛选"
                value={listLevelFilter}
                onChange={(e) =>
                  setListLevelFilter(e.target.value as 'ALL' | MetricMilitaryLevel)
                }
                className="h-8 rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none cursor-pointer"
              >
                <option value="ALL">全部层次 ({activeGraph.nodes.length})</option>
                {MILITARY_LEVELS.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl} ({levelCounts[lvl] ?? 0})
                  </option>
                ))}
              </select>

              <div className="relative w-48 sm:w-56">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  placeholder="搜索指标 / ID / 算子..."
                  className="h-8 w-full rounded-md border border-[#30363d] bg-[#0d1117] pl-8 pr-7 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
                {listSearch && (
                  <button
                    type="button"
                    onClick={() => setListSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => void handleCompareSides()}
                disabled={comparingSides || executing || activeGraph.nodes.length === 0}
                title="按红蓝分方对比计算结果"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-cyan-500/50 bg-cyan-500/15 px-2.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50 transition cursor-pointer"
              >
                <Scale className="h-3.5 w-3.5 text-cyan-300" />
                <span>{comparingSides ? '对比中...' : '阵营对比'}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleExecuteMetricDag()}
                disabled={executing || comparingSides || activeGraph.nodes.length === 0}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-400/60 bg-emerald-600 px-3 text-xs font-semibold text-white shadow-lg shadow-emerald-950/50 hover:bg-emerald-500 disabled:opacity-50 transition cursor-pointer"
              >
                <Play className="h-3.5 w-3.5" />
                <span>{executing ? '计算中...' : '试算'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setNewMetricMode('from_operator');
                  setNewMetricName('');
                  setNewMetricIdInput('');
                  setNewMetricLevel('MOP');
                  setNewMetricDomain(listDomainFilter === 'ALL' ? 'firepower' : listDomainFilter);
                  setNewMetricUnit('');
                  setNewMetricModalOpen(true);
                }}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-teal-500/50 bg-teal-500/15 px-2.5 text-xs font-semibold text-teal-200 hover:bg-teal-500/25 transition cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5 text-teal-300" />
                <span>新建指标</span>
              </button>

              {/* 更多 ▾ 收纳菜单 */}
              <div className="relative" ref={moreMenuRef}>
                <button
                  type="button"
                  onClick={() => setMoreMenuOpen((prev) => !prev)}
                  className={`inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs transition cursor-pointer ${
                    moreMenuOpen
                      ? 'border-slate-500 bg-slate-700 text-white'
                      : 'border-[#30363d] bg-[#0d1117] text-slate-300 hover:border-slate-500 hover:text-white'
                  }`}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  <span>更多</span>
                  <ChevronDown className="h-3 w-3 opacity-75" />
                </button>

                {moreMenuOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1.5 w-48 rounded-xl border border-[#30363d] bg-[#0d1117] p-1.5 shadow-2xl">
                    <button
                      type="button"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        void handleSaveGraph();
                      }}
                      disabled={saving}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-emerald-200 hover:bg-[#161b22] disabled:opacity-50 transition cursor-pointer"
                    >
                      <Save className="h-3.5 w-3.5 text-emerald-400" />
                      <span>{saving ? '保存中...' : '保存图集'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        void loadInitialData();
                      }}
                      disabled={loadingInit}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-300 hover:bg-[#161b22] disabled:opacity-50 transition cursor-pointer"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 text-slate-400 ${loadingInit ? 'animate-spin' : ''}`}
                      />
                      <span>刷新</span>
                    </button>

                    <div className="mt-1 border-t border-[#30363d] px-2.5 pt-1.5 pb-0.5 text-[10px] text-slate-500">
                      <div className="truncate" title={activeGraph.name}>
                        图集: {activeGraph.name}
                        {isLocalDraftMode ? ' (草案)' : ''}
                      </div>
                      {lastExecStats && (
                        <div className="mt-0.5 font-mono">
                          耗时 {(lastExecStats.totalLatencyMs ?? 0).toFixed(1)}ms
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {banner && (
            <div
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                banner.kind === 'error'
                  ? 'border-rose-500/60 bg-rose-950/60 text-rose-200'
                  : banner.kind === 'warn'
                    ? 'border-amber-500/50 bg-amber-950/50 text-amber-200'
                    : 'border-emerald-500/45 bg-emerald-950/50 text-emerald-200'
              }`}
            >
              <div className="flex items-center gap-2">
                {banner.kind === 'error' ? (
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                ) : banner.kind === 'warn' ? (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                )}
                <span>{banner.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setBanner(null)}
                className="text-[11px] opacity-70 hover:opacity-100 cursor-pointer"
              >
                关闭
              </button>
            </div>
          )}

          {/* 5 核心列指标清单表（响应式限高内滚动） */}
          <div
            ref={listScrollRef}
            onScroll={(e) => {
              savedListScrollTopRef.current = e.currentTarget.scrollTop;
            }}
            className="max-h-[calc(100dvh-200px)] min-h-[380px] overflow-auto rounded-lg border border-[#30363d] bg-[#0d1117]"
          >
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-[#30363d] bg-[#161b22] text-[11px] text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">指标名称</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">层级 / 领域</th>
                  <th className="px-3 py-2 font-medium">数据来源</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap text-right">试算结果</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]/60">
                {filteredSortedNodes.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-xs text-slate-500">
                      当前过滤条件下无匹配指标节点
                    </td>
                  </tr>
                ) : (
                  filteredSortedNodes.map((node) => {
                    const cfg = node.metricConfig;
                    const level = cfg?.militaryLevel ?? 'MOP';
                    const domainTag = cfg?.domainTag ?? 'firepower';
                    const domainCn = DOMAIN_CN_MAP[domainTag] ?? '综合';
                    const mode = cfg?.mode ?? 'from_operator';
                    const opMeta =
                      mode === 'from_operator' && cfg?.sourceRef
                        ? operatorMap.get(cfg.sourceRef)
                        : undefined;
                    const inLinks = lineageByNodeId.incoming.get(node.id) ?? [];
                    const upstreamNode =
                      mode === 'from_metric_agg' && cfg?.sourceRef
                        ? nodeByMetricIdMap.get(cfg.sourceRef)
                        : undefined;
                    const latestExec =
                      execResults[node.id] ??
                      (sideComparison
                        ? extractNodeResultsFromSlice(sideComparison.overall)[node.id]
                        : undefined);
                    const latestNum = getNumericMetricExecValue(latestExec);
                    const isSelected = node.id === selectedNodeId;
                    const hasSideCols = Boolean(sideComparison && sideComparison.sides.length > 0);

                    return (
                      <tr
                        key={node.id}
                        onClick={() => enterCanvasForNode(node.id, 'lineage')}
                        title="点击进入该指标的链路聚焦画布"
                        className={`cursor-pointer transition hover:bg-[#161b22]/90 ${
                          isSelected ? 'bg-emerald-950/30' : ''
                        }`}
                      >
                        {/* 列 1：指标名称（中文主标题 + 下方浅灰 metricId） */}
                        <td className="px-3 py-2.5 align-middle">
                          <div className="font-medium text-slate-100">
                            {cfg?.name || node.label}
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                            {cfg?.metricId || node.id}
                          </div>
                        </td>

                        {/* 列 2：层级 / 领域（合并 1 列紧凑中文徽标） */}
                        <td className="px-3 py-2.5 align-middle whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <span
                              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${MILITARY_LEVEL_BADGES[level]}`}
                            >
                              {level}
                            </span>
                            <span className="rounded border border-[#30363d] bg-[#161b22] px-1.5 py-0.5 text-[11px] text-slate-300">
                              {domainCn}
                            </span>
                          </div>
                        </td>

                        {/* 列 3：数据来源（算子中文名可下钻 / 上游指标中文名） */}
                        <td className="px-3 py-2.5 align-middle">
                          {mode === 'from_operator' && (
                            <>
                              {cfg?.sourceRef && onDrillDownToOperator ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDrillDownToOperator(cfg.sourceRef!);
                                  }}
                                  title={`跳转至一库算子：${cfg.sourceRef}${cfg.targetField ? `（字段：${cfg.targetField}）` : ''}`}
                                  className="inline-flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/25 transition cursor-pointer"
                                >
                                  <span>{opMeta?.name || cfg.sourceRef}</span>
                                  <ArrowDownRight className="h-3 w-3 shrink-0" />
                                </button>
                              ) : (
                                <span className="text-[11px] text-cyan-200">
                                  {opMeta?.name || cfg?.sourceRef || '未绑定算子'}
                                </span>
                              )}
                            </>
                          )}

                          {mode === 'from_metric_agg' && (
                            <span
                              title={cfg?.sourceRef}
                              className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200"
                            >
                              <span>
                                上游: {upstreamNode?.metricConfig?.name || upstreamNode?.label || cfg?.sourceRef || '未指定'}
                              </span>
                            </span>
                          )}

                          {mode === 'from_metric_formula' && (
                            <span
                              title={cfg?.formulaExpression || undefined}
                              className="inline-flex items-center gap-1 rounded border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 text-[11px] text-teal-200"
                            >
                              <span>
                                {inLinks.length > 0
                                  ? inLinks
                                      .map(
                                        ({ edge, sourceNode }) =>
                                          sourceNode?.metricConfig?.name ||
                                          sourceNode?.label ||
                                          edge.sourceNodeId,
                                      )
                                      .join(' + ')
                                  : '多指标复合计算'}
                              </span>
                            </span>
                          )}
                        </td>

                        {/* 列 4：试算结果（单次物理值+单位，或并排展示各动态阵营 分方: 数值） */}
                        <td className="px-3 py-2.5 align-middle text-right whitespace-nowrap">
                          {hasSideCols && sideComparison ? (
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              {sideComparison.sides.map((side, idx) => {
                                const pal =
                                  DYNAMIC_SIDE_PALETTES[idx % DYNAMIC_SIDE_PALETTES.length];
                                const sideExec = extractNodeResultsFromSlice(
                                  sideComparison.bySide[side],
                                )[node.id];
                                const sideNum = getNumericMetricExecValue(sideExec);
                                return (
                                  <span
                                    key={`list-side-${node.id}-${side}`}
                                    title={sideExec?.missingDataReason}
                                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px] tabular-nums ${
                                      sideExec?.status === 'unavailable'
                                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                                        : pal.badge
                                    }`}
                                  >
                                    <span className="opacity-85">{side}:</span>
                                    <span className="font-semibold">
                                      {formatMetricExecValue(sideExec)}
                                      {sideNum !== null && cfg?.unit ? ` ${cfg.unit}` : ''}
                                    </span>
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {latestExec?.status === 'unavailable' ? (
                                <span
                                  title={latestExec.missingDataReason}
                                  className="rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 font-mono text-[11px] text-rose-300"
                                >
                                  缺数
                                </span>
                              ) : (
                                <span
                                  title={latestExec?.missingDataReason}
                                  className="font-mono font-semibold text-slate-100 tabular-nums"
                                >
                                  {formatMetricExecValue(latestExec)}
                                  {latestNum !== null && cfg?.unit ? (
                                    <span className="ml-1 text-[11px] font-normal text-slate-400">
                                      {cfg.unit}
                                    </span>
                                  ) : !latestExec && cfg?.unit ? (
                                    <span className="ml-1 text-[10px] font-normal text-slate-500">
                                      ({cfg.unit})
                                    </span>
                                  ) : null}
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* 列 5：操作 */}
                        <td className="px-3 py-2.5 align-middle text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              enterCanvasForNode(node.id, 'lineage');
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/45 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/25 transition cursor-pointer"
                          >
                            <GitBranch className="h-3 w-3" />
                            <span>画布编排</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-2.5 min-h-[640px]">
          {/* 画布顶栏：← 返回指标列表 + 作用域切换胶囊 | 阵营切片(仅>0) + 阵营对比 + 试算 + 保存 + 更多 ▾ */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#30363d] bg-[#161b22] px-3.5 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setMoreMenuOpen(false);
                  setViewMode('list');
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-800/80 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500 hover:bg-slate-700 hover:text-white transition shadow-sm shrink-0 cursor-pointer"
                title="返回指标列表"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>返回指标列表</span>
              </button>

              <div className="h-4 w-px bg-[#30363d]" />

              <UnifiedAssetSelector
                value={effectiveFocusNodeId ?? ''}
                options={metricSelectorOptions}
                placeholder="定位指标..."
                searchPlaceholder="搜索名称、ID 或领域..."
                accent="emerald"
                onChange={(nodeId) => enterCanvasForNode(nodeId, canvasScope === 'full' ? 'lineage' : canvasScope)}
              />

              <div className="flex flex-wrap items-center rounded-lg border border-[#30363d] bg-[#0d1117] p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setCanvasScope('lineage')}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 transition cursor-pointer ${
                    canvasScope === 'lineage'
                      ? 'border border-emerald-500/50 bg-emerald-500/20 font-semibold text-emerald-200'
                      : 'border border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <GitBranch className="h-3 w-3" />
                  <span>血缘链路 ({lineageSubgraph.nodes.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCanvasScope('domain')}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 transition cursor-pointer ${
                    canvasScope === 'domain'
                      ? 'border border-cyan-500/50 bg-cyan-500/20 font-semibold text-cyan-200'
                      : 'border border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>同领域 ({domainSubgraph.nodes.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCanvasScope('full')}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 transition cursor-pointer ${
                    canvasScope === 'full'
                      ? 'border border-teal-500/50 bg-teal-500/20 font-semibold text-teal-200'
                      : 'border border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>完整图集 ({activeGraph.nodes.length})</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {discoveredSides.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-slate-300">
                  <span className="text-[11px] text-slate-400">阵营切片:</span>
                  <select
                    value={targetSide}
                    onChange={(e) => handleChangeTargetSide(e.target.value)}
                    title="分方列表由阵营对比从推演数据中解析"
                    className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-emerald-300 focus:border-emerald-500 focus:outline-none cursor-pointer"
                  >
                    <option value="ALL">全部阵营 ({discoveredSides.length} 方)</option>
                    {discoveredSides.map((side) => (
                      <option key={side} value={side}>
                        {side}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button
                type="button"
                onClick={() => void handleCompareSides()}
                disabled={comparingSides || executing || activeGraph.nodes.length === 0}
                title="按红蓝分方对比计算结果"
                className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50 transition cursor-pointer"
              >
                <Scale className="h-3.5 w-3.5 text-cyan-300" />
                <span>{comparingSides ? '对比中...' : '阵营对比'}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleExecuteMetricDag()}
                disabled={executing || comparingSides || activeGraph.nodes.length === 0}
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/60 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-emerald-950/50 hover:bg-emerald-500 disabled:opacity-50 transition cursor-pointer"
              >
                <Play className="h-3.5 w-3.5" />
                <span>{executing ? '计算中...' : '试算'}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleSaveGraph()}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50 transition cursor-pointer"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{saving ? '保存中...' : '保存'}</span>
              </button>

              <div className="relative" ref={moreMenuRef}>
                <button
                  type="button"
                  onClick={() => setMoreMenuOpen((prev) => !prev)}
                  className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs transition cursor-pointer ${
                    moreMenuOpen
                      ? 'border-slate-500 bg-slate-700 text-white'
                      : 'border-[#30363d] bg-[#0d1117] text-slate-300 hover:border-slate-500 hover:text-white'
                  }`}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  <span>更多</span>
                  <ChevronDown className="h-3 w-3 opacity-75" />
                </button>

                {moreMenuOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1.5 w-48 rounded-xl border border-[#30363d] bg-[#0d1117] p-1.5 shadow-2xl">
                    <button
                      type="button"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        void loadInitialData();
                      }}
                      disabled={loadingInit}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-300 hover:bg-[#161b22] disabled:opacity-50 transition cursor-pointer"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 text-slate-400 ${loadingInit ? 'animate-spin' : ''}`}
                      />
                      <span>刷新</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {banner && (
            <div
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                banner.kind === 'error'
                  ? 'border-rose-500/60 bg-rose-950/60 text-rose-200'
                  : banner.kind === 'warn'
                    ? 'border-amber-500/50 bg-amber-950/50 text-amber-200'
                    : 'border-emerald-500/45 bg-emerald-950/50 text-emerald-200'
              }`}
            >
              <div className="flex items-center gap-2">
                {banner.kind === 'error' ? (
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                ) : banner.kind === 'warn' ? (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                )}
                <span>{banner.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setBanner(null)}
                className="text-[11px] opacity-70 hover:opacity-100 cursor-pointer"
              >
                关闭
              </button>
            </div>
          )}

          {/* 主体三段布局：左侧可折叠窄组件栏 + 中央 DAG 画布 + 右侧双 Tab 节点抽屉 */}
          <div className="flex min-h-[580px] flex-1 flex-col gap-3 lg:flex-row">
            {/* 左侧可折叠窄组件栏（对齐一库画布左侧栏体验） */}
            <aside
              className={`flex shrink-0 flex-col rounded-xl border border-[#30363d] bg-[#161b22] transition-all duration-200 ${
                leftPaletteCollapsed ? 'w-full lg:w-12 p-1.5 items-center gap-2' : 'w-full lg:w-44 p-2.5 gap-2.5'
              }`}
            >
              <div
                className={`flex items-center ${
                  leftPaletteCollapsed ? 'justify-center w-full' : 'justify-between'
                }`}
              >
                {!leftPaletteCollapsed && (
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    指标组件
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setLeftPaletteCollapsed((prev) => !prev)}
                  title={leftPaletteCollapsed ? '展开组件栏' : '收起组件栏以扩大画布视野'}
                  className="rounded-lg border border-[#30363d] bg-[#0d1117] p-1 text-slate-400 hover:border-slate-500 hover:text-white transition cursor-pointer"
                >
                  {leftPaletteCollapsed ? (
                    <PanelLeftOpen className="h-3.5 w-3.5" />
                  ) : (
                    <PanelLeftClose className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              <div
                className={
                  leftPaletteCollapsed
                    ? 'flex flex-row lg:flex-col items-center gap-1.5 w-full justify-center'
                    : 'grid grid-cols-3 lg:grid-cols-1 gap-2'
                }
              >
                {(
                  [
                    {
                      mode: 'from_operator' as const,
                      title: '算子引用',
                      desc: '引用一库实证算子',
                      icon: Database,
                      cls: 'border-cyan-500/35 bg-cyan-500/10 text-cyan-200 hover:border-cyan-400/70',
                      iconCls: 'text-cyan-400',
                    },
                    {
                      mode: 'from_metric_agg' as const,
                      title: '二次聚合',
                      desc: '分组与标量归约',
                      icon: Layers,
                      cls: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400/70',
                      iconCls: 'text-emerald-400',
                    },
                    {
                      mode: 'from_metric_formula' as const,
                      title: '复合公式',
                      desc: '多指标代数衍生',
                      icon: Calculator,
                      cls: 'border-teal-500/35 bg-teal-500/10 text-teal-200 hover:border-teal-400/70',
                      iconCls: 'text-teal-400',
                    },
                  ] as const
                ).map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.mode}
                      type="button"
                      onClick={() => handleAddMetricNode(item.mode)}
                      title={`${item.title}：${item.desc}（点击添加至画布）`}
                      className={
                        leftPaletteCollapsed
                          ? `flex items-center justify-center rounded-lg border p-2 transition cursor-pointer ${item.cls}`
                          : `flex items-start gap-2 rounded-lg border p-2 text-left transition cursor-pointer ${item.cls}`
                      }
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          leftPaletteCollapsed ? '' : 'mt-0.5'
                        } ${item.iconCls}`}
                      />
                      {!leftPaletteCollapsed && (
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 text-xs font-semibold text-slate-100">
                            <Plus className="h-3 w-3 opacity-80" />
                            <span>{item.title}</span>
                          </div>
                          <div className="mt-0.5 truncate text-[10px] text-slate-400">
                            {item.desc}
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* 中央 DAG 画布 */}
            <div className="flex min-h-[540px] min-w-0 flex-1 flex-col">
              <DagCanvasBoard
                key={`${activeGraph.graphId}::${canvasScope}::${
                  canvasScope === 'lineage' ? (effectiveFocusNodeId ?? '') : ''
                }`}
                graphKind="metric"
                title={
                  canvasScope === 'lineage'
                    ? `链路聚焦 (${canvasNodes.length}/${activeGraph.nodes.length}) · ${effectiveFocusNode?.metricConfig?.name || activeGraph.name}`
                    : canvasScope === 'domain'
                      ? `${DOMAIN_CN_MAP[activeFocusDomain] ?? activeFocusDomain} (${canvasNodes.length}/${activeGraph.nodes.length}) · ${activeGraph.name}`
                      : `${activeGraph.name} · 完整图集 (${activeGraph.nodes.length})`
                }
                nodes={canvasNodes}
                edges={canvasEdges}
                selectedNodeId={selectedNodeId}
                selectedEdgeId={selectedEdgeId}
                showOutline={false}
                outlineSide="left"
                emptyStateText="当前作用域暂无指标节点，可切换作用域或点击左侧组件栏添加节点"
                onSelectNode={(nid) => {
                  setSelectedNodeId(nid);
                  if (nid) setSelectedEdgeId(null);
                }}
                onSelectEdge={(eid) => {
                  setSelectedEdgeId(eid);
                  if (eid) setSelectedNodeId(null);
                }}
                onNodesChange={handleCanvasNodesChange}
                onEdgesChange={handleCanvasEdgesChange}
                onConnect={handleConnect}
                onDeleteNode={handleDeleteNode}
                onDeleteEdge={handleDeleteEdge}
                onDrillDown={handleDrillDown}
              />
            </div>

            {/* 右侧指标节点配置抽屉（双 Tab：基础配置 | 算子取数预览） */}
            <aside className="flex max-h-[680px] w-full shrink-0 flex-col overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22] lg:w-[410px] xl:w-[440px]">
              <div className="flex items-center justify-between border-b border-[#30363d] bg-[#0d1117]/80 px-3.5 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <span className="truncate text-xs font-semibold text-slate-100">
                    {selectedNode
                      ? selectedNode.metricConfig?.name || selectedNode.label
                      : selectedEdge
                        ? '连线端口别名绑定'
                        : '指标图属性'}
                  </span>
                </div>

                {selectedNode?.metricConfig?.mode === 'from_operator' &&
                  selectedNode.metricConfig.sourceRef &&
                  onDrillDownToOperator && (
                    <button
                      type="button"
                      onClick={() => onDrillDownToOperator(selectedNode.metricConfig!.sourceRef!)}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-medium text-cyan-200 hover:bg-cyan-500/25 transition cursor-pointer"
                    >
                      <ArrowDownRight className="h-3 w-3" />
                      <span>下钻算子</span>
                    </button>
                  )}
              </div>

              {/* 双 Tab 切换栏 */}
              {selectedNode && (
                <div className="flex border-b border-[#30363d] bg-[#0d1117]/50 px-3 pt-2 gap-1">
                  <button
                    type="button"
                    onClick={() => setDrawerTab('config')}
                    className={`border-b-2 px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                      drawerTab === 'config'
                        ? 'border-emerald-400 text-emerald-200'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    基础配置
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerTab('preview')}
                    className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                      drawerTab === 'preview'
                        ? 'border-cyan-400 text-cyan-200'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Table2 className="h-3.5 w-3.5" />
                    <span>
                      {selectedNode.metricConfig?.mode === 'from_operator'
                        ? '算子取数预览'
                        : '上游指标预览'}
                    </span>
                  </button>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-3.5 space-y-3 text-xs">
                {selectedNode ? (
                  drawerTab === 'config' ? (
                    <>
                      {/* 基础标识与军标分层 */}
                      <div className="grid grid-cols-2 gap-2">
                        <label className="col-span-2 space-y-1">
                          <span className="text-[11px] text-slate-400">指标名称</span>
                          <input
                            type="text"
                            value={selectedNode.metricConfig?.name ?? selectedNode.label}
                            onChange={(e) => updateSelectedMetricConfig({ name: e.target.value })}
                            className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                          />
                        </label>

                        <label className="col-span-2 space-y-1">
                          <span className="text-[11px] text-slate-400">指标 ID (metricId)</span>
                          <input
                            type="text"
                            value={selectedNode.metricConfig?.metricId ?? ''}
                            onChange={(e) =>
                              updateSelectedMetricConfig({ metricId: e.target.value })
                            }
                            placeholder="例如 firepower.strike_completion"
                            className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                          />
                        </label>

                        <div className="space-y-1">
                          <span className="text-[11px] text-slate-400">军事层次</span>
                          <div className="grid grid-cols-3 gap-1">
                            {MILITARY_LEVELS.map((lvl) => {
                              const active =
                                (selectedNode.metricConfig?.militaryLevel ?? 'MOP') === lvl;
                              return (
                                <button
                                  key={lvl}
                                  type="button"
                                  onClick={() => updateSelectedMetricConfig({ militaryLevel: lvl })}
                                  className={`rounded border py-1 font-mono text-[11px] font-semibold transition cursor-pointer ${
                                    active
                                      ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                                      : 'border-[#30363d] bg-[#0d1117] text-slate-400 hover:text-slate-200'
                                  }`}
                                >
                                  {lvl}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <label className="space-y-1">
                          <span className="text-[11px] text-slate-400">能力域</span>
                          <select
                            value={selectedNode.metricConfig?.domainTag ?? 'firepower'}
                            onChange={(e) =>
                              updateSelectedMetricConfig({
                                domainTag: e.target.value as MetricDomainTag,
                              })
                            }
                            className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                          >
                            {DOMAIN_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.cnLabel}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="space-y-1">
                          <span className="text-[11px] text-slate-400">派生模式</span>
                          <select
                            value={selectedNode.metricConfig?.mode ?? 'from_operator'}
                            onChange={(e) =>
                              updateSelectedMetricConfig({
                                mode: e.target.value as MetricNodeConfig['mode'],
                              })
                            }
                            className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                          >
                            {(Object.keys(MODE_LABELS) as Array<MetricNodeConfig['mode']>).map(
                              (m) => (
                                <option key={m} value={m}>
                                  {MODE_LABELS[m]}
                                </option>
                              ),
                            )}
                          </select>
                        </label>

                        <label className="space-y-1">
                          <span className="text-[11px] text-slate-400">物理单位</span>
                          <input
                            type="text"
                            value={selectedNode.metricConfig?.unit ?? ''}
                            onChange={(e) => updateSelectedMetricConfig({ unit: e.target.value })}
                            placeholder="例如 0-1 / % / s / km"
                            className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                          />
                        </label>
                      </div>

                      {/* 上游数据来源 sourceRef（仅保留清晰下拉选择，去掉重复输入框） */}
                      {selectedNode.metricConfig?.mode === 'from_operator' && (
                        <div className="space-y-1.5 rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-cyan-300">
                              绑定底层算子
                            </span>
                            <span className="font-mono text-[10px] text-slate-500">
                              共 {operators.length} 个
                            </span>
                          </div>
                          <select
                            value={selectedNode.metricConfig?.sourceRef ?? ''}
                            onChange={(e) => {
                              const op = operatorMap.get(e.target.value);
                              updateSelectedMetricConfig({
                                sourceRef: e.target.value,
                                ...(op?.unit && !selectedNode.metricConfig?.unit
                                  ? { unit: op.unit }
                                  : {}),
                              });
                            }}
                            className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                          >
                            <option value="">-- 请选择一库实证算子 --</option>
                            {selectedNode.metricConfig?.sourceRef &&
                              !operatorMap.has(selectedNode.metricConfig.sourceRef) && (
                                <option value={selectedNode.metricConfig.sourceRef}>
                                  {selectedNode.metricConfig.sourceRef} (未匹配算子库)
                                </option>
                              )}
                            {operators.map((op) => (
                              <option key={op.id} value={op.id}>
                                {op.name} ({op.id})
                              </option>
                            ))}
                          </select>
                          {selectedNodeOpMeta?.description && (
                            <p className="text-[10px] text-slate-400 leading-relaxed">
                              {selectedNodeOpMeta.description}
                            </p>
                          )}
                        </div>
                      )}

                      {selectedNode.metricConfig?.mode === 'from_metric_agg' && (() => {
                        const rawSourceRef = selectedNode.metricConfig?.sourceRef?.trim() ?? '';
                        const matchedUpstream = rawSourceRef
                          ? activeGraph.nodes.find(
                              (n) =>
                                n.id !== selectedNode.id &&
                                (n.id === rawSourceRef || n.metricConfig?.metricId === rawSourceRef),
                            )
                          : undefined;
                        const selectSourceValue = matchedUpstream
                          ? matchedUpstream.metricConfig?.metricId || matchedUpstream.id
                          : rawSourceRef;
                        const hasCustomUnmatchedRef = Boolean(rawSourceRef && !matchedUpstream);

                        return (
                          <div className="space-y-1.5 rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5">
                            <span className="text-[11px] font-semibold text-emerald-300">
                              上游指标来源
                            </span>
                            <select
                              value={selectSourceValue}
                              onChange={(e) =>
                                updateSelectedMetricConfig({ sourceRef: e.target.value })
                              }
                              className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                            >
                              <option value="">-- 选择上游指标节点 --</option>
                              {hasCustomUnmatchedRef && (
                                <option value={rawSourceRef}>
                                  {rawSourceRef} (自定义引用)
                                </option>
                              )}
                              {activeGraph.nodes
                                .filter((n) => n.id !== selectedNode.id)
                                .map((n) => {
                                  const refVal = n.metricConfig?.metricId || n.id;
                                  return (
                                    <option key={n.id} value={refVal}>
                                      {n.metricConfig?.name || n.label} ({refVal})
                                    </option>
                                  );
                                })}
                            </select>
                          </div>
                        );
                      })()}

                      {selectedNode.metricConfig?.mode === 'from_metric_formula' && (
                        <div className="space-y-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-teal-300">
                              复合公式衍生计算
                            </span>
                            <span className="text-[10px] text-slate-500">点击变量插入</span>
                          </div>

                          {incomingEdgesForSelected.length === 0 ? (
                            <div className="text-[11px] text-amber-300">
                              未连接上游指标，请拖拽连线绑定变量
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {incomingEdgesForSelected.map((edge) => {
                                const srcNode = activeGraph.nodes.find(
                                  (n) => n.id === edge.sourceNodeId,
                                );
                                const varName =
                                  edge.targetAlias ||
                                  sanitizeVarAlias(
                                    srcNode?.metricConfig?.metricId || edge.sourceNodeId,
                                  );
                                return (
                                  <div
                                    key={edge.id}
                                    className="flex items-center justify-between gap-1.5 rounded border border-[#30363d] bg-[#161b22] px-2 py-1"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const cur = selectedNode.metricConfig?.formulaExpression ?? '';
                                        updateSelectedMetricConfig({
                                          formulaExpression: cur ? `${cur} + ${varName}` : varName,
                                        });
                                      }}
                                      title="点击插入到公式"
                                      className="truncate font-mono text-[11px] text-teal-300 hover:underline cursor-pointer"
                                    >
                                      {varName}
                                    </button>
                                    <input
                                      type="text"
                                      value={edge.targetAlias ?? ''}
                                      onChange={(e) => {
                                        const nextAlias = e.target.value;
                                        setActiveGraph((prev) => ({
                                          ...prev,
                                          edges: prev.edges.map((ed) =>
                                            ed.id === edge.id
                                              ? { ...ed, targetAlias: nextAlias }
                                              : ed,
                                          ),
                                        }));
                                      }}
                                      placeholder="别名 targetAlias"
                                      className="w-28 rounded border border-[#30363d] bg-[#0d1117] px-1.5 py-0.5 font-mono text-[10px] text-slate-200 focus:border-teal-500 focus:outline-none"
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          <textarea
                            rows={3}
                            value={selectedNode.metricConfig?.formulaExpression ?? ''}
                            onChange={(e) =>
                              updateSelectedMetricConfig({ formulaExpression: e.target.value })
                            }
                            placeholder="例如: (strike_rate + patrol_rate) / 2"
                            className="w-full rounded border border-[#30363d] bg-[#161b22] px-2.5 py-1.5 font-mono text-xs text-teal-200 focus:border-teal-500 focus:outline-none"
                          />
                        </div>
                      )}

                      {/* 切片过滤条件 filterCriteria */}
                      {selectedNode.metricConfig?.mode !== 'from_metric_formula' && (
                        <div className="space-y-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-slate-300">
                              切片过滤 (filterCriteria)
                            </span>
                            <div className="flex rounded border border-[#30363d] bg-[#161b22] p-0.5 text-[10px]">
                              <button
                                type="button"
                                onClick={() => setFilterEditMode('kv')}
                                className={`rounded px-1.5 py-0.5 cursor-pointer ${
                                  filterEditMode === 'kv'
                                    ? 'bg-[#30363d] text-white'
                                    : 'text-slate-400'
                                }`}
                              >
                                键值对
                              </button>
                              <button
                                type="button"
                                onClick={() => setFilterEditMode('json')}
                                className={`rounded px-1.5 py-0.5 cursor-pointer ${
                                  filterEditMode === 'json'
                                    ? 'bg-[#30363d] text-white'
                                    : 'text-slate-400'
                                }`}
                              >
                                JSON
                              </button>
                            </div>
                          </div>

                          {filterEditMode === 'kv' ? (
                            <div className="space-y-1.5">
                              {Object.entries(selectedNode.metricConfig?.filterCriteria ?? {}).map(
                                ([k, v]) => (
                                  <div key={k} className="flex items-center gap-1.5">
                                    <span className="w-24 truncate rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[11px] text-slate-300">
                                      {k}
                                    </span>
                                    <input
                                      type="text"
                                      value={typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                      onChange={(e) => {
                                        const nextFc = {
                                          ...(selectedNode.metricConfig?.filterCriteria ?? {}),
                                          [k]: parseScalarValueInput(e.target.value),
                                        };
                                        updateSelectedMetricConfig({ filterCriteria: nextFc });
                                      }}
                                      className="flex-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[11px] text-slate-100 focus:border-emerald-500 focus:outline-none"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const nextFc = {
                                          ...(selectedNode.metricConfig?.filterCriteria ?? {}),
                                        };
                                        delete nextFc[k];
                                        updateSelectedMetricConfig({
                                          filterCriteria: Object.keys(nextFc).length
                                            ? nextFc
                                            : undefined,
                                        });
                                      }}
                                      className="rounded p-1 text-slate-500 hover:text-rose-400 cursor-pointer"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                ),
                              )}
                              <div className="flex items-center gap-1.5 pt-1">
                                <input
                                  type="text"
                                  value={newFilterKey}
                                  onChange={(e) => setNewFilterKey(e.target.value)}
                                  placeholder="列名如 Side"
                                  className="w-24 rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[11px] text-slate-200 focus:border-emerald-500 focus:outline-none"
                                />
                                <input
                                  type="text"
                                  value={newFilterVal}
                                  onChange={(e) => setNewFilterVal(e.target.value)}
                                  placeholder="过滤值"
                                  className="flex-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[11px] text-slate-200 focus:border-emerald-500 focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const k = newFilterKey.trim();
                                    if (!k) return;
                                    updateSelectedMetricConfig({
                                      filterCriteria: {
                                        ...(selectedNode.metricConfig?.filterCriteria ?? {}),
                                        [k]: parseScalarValueInput(newFilterVal),
                                      },
                                    });
                                    setNewFilterKey('');
                                    setNewFilterVal('');
                                  }}
                                  className="rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-200 hover:bg-emerald-500/25 cursor-pointer"
                                >
                                  添加
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <textarea
                                rows={3}
                                value={filterJsonText}
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  setFilterJsonText(raw);
                                  try {
                                    const parsed = raw.trim() ? JSON.parse(raw) : {};
                                    if (
                                      !parsed ||
                                      typeof parsed !== 'object' ||
                                      Array.isArray(parsed)
                                    ) {
                                      setFilterJsonError('必须为 JSON 对象');
                                    } else {
                                      setFilterJsonError(null);
                                      updateSelectedMetricConfig({
                                        filterCriteria: Object.keys(parsed).length
                                          ? parsed
                                          : undefined,
                                      });
                                    }
                                  } catch (err) {
                                    setFilterJsonError(
                                      err instanceof Error ? err.message : 'JSON 格式错误',
                                    );
                                  }
                                }}
                                className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 font-mono text-[11px] text-slate-200 focus:border-emerald-500 focus:outline-none"
                              />
                              {filterJsonError && (
                                <div className="text-[10px] text-rose-400">{filterJsonError}</div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 分组、投影字段与归约配置 */}
                      {selectedNode.metricConfig?.mode !== 'from_metric_formula' && (
                        <div className="space-y-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5">
                          <div className="grid grid-cols-2 gap-2">
                            <label className="col-span-2 space-y-1">
                              <span className="text-[11px] text-slate-400">
                                分组维度 (groupBy，逗号分隔)
                              </span>
                              <input
                                type="text"
                                value={(selectedNode.metricConfig?.groupBy ?? []).join(', ')}
                                onChange={(e) => {
                                  const arr = e.target.value
                                    .split(',')
                                    .map((s) => s.trim())
                                    .filter(Boolean);
                                  updateSelectedMetricConfig({
                                    groupBy: arr.length > 0 ? arr : undefined,
                                  });
                                }}
                                placeholder="例如 Side, MissionName"
                                className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[11px] text-slate-100 focus:border-emerald-500 focus:outline-none"
                              />
                            </label>

                            <label className="space-y-1">
                              <span className="text-[11px] text-slate-400">
                                目标度量列 (targetField)
                              </span>
                              <input
                                type="text"
                                value={selectedNode.metricConfig?.targetField ?? ''}
                                onChange={(e) =>
                                  updateSelectedMetricConfig({
                                    targetField: e.target.value || undefined,
                                  })
                                }
                                placeholder="例如 HitRate"
                                className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[11px] text-slate-100 focus:border-emerald-500 focus:outline-none"
                              />
                            </label>

                            <label className="space-y-1">
                              <span className="text-[11px] text-slate-400">归约方式 (reduce)</span>
                              <select
                                value={selectedNode.metricConfig?.reduce ?? ''}
                                onChange={(e) =>
                                  updateSelectedMetricConfig({
                                    reduce: (e.target.value || undefined) as
                                      | IndicatorReduceMethod
                                      | undefined,
                                  })
                                }
                                className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-[11px] text-slate-100 focus:border-emerald-500 focus:outline-none"
                              >
                                {REDUCE_OPTIONS.map((opt) => (
                                  <option key={opt.value || '__none'} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          {availableColumnSuggestions.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1 pt-1">
                              <span className="text-[10px] text-slate-500">候选列:</span>
                              {availableColumnSuggestions.slice(0, 12).map((colName) => (
                                <button
                                  key={colName}
                                  type="button"
                                  onClick={() =>
                                    updateSelectedMetricConfig({ targetField: colName })
                                  }
                                  title="设为 targetField"
                                  className="rounded border border-[#30363d] bg-[#161b22] px-1.5 py-0.5 font-mono text-[10px] text-cyan-300 hover:border-cyan-500/60 cursor-pointer"
                                >
                                  {colName}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 当前节点运行诊断 */}
                      {selectedExec && (
                        <div className="space-y-1.5 rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-slate-300">
                              执行状态诊断
                            </span>
                            <span
                              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${getExecStatusMeta(selectedExec.status).cls}`}
                            >
                              {selectedExec.status.toUpperCase()}
                            </span>
                          </div>

                          {selectedExec.status === 'unavailable' ? (
                            <div className="flex items-start gap-1.5 rounded border border-rose-500/40 bg-rose-950/40 p-2 text-[11px] text-rose-200">
                              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                              <span>
                                {selectedExec.missingDataReason ||
                                  '数据缺失：上游数据源或字段未就绪'}
                              </span>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
                              <div className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1">
                                <div className="text-[9px] text-slate-500">标量读数</div>
                                <div className="font-semibold text-emerald-300">
                                  {selectedExec.value !== undefined && selectedExec.value !== null
                                    ? String(selectedExec.value)
                                    : 'TableDataset'}
                                  {selectedNode.metricConfig?.unit
                                    ? ` ${selectedNode.metricConfig.unit}`
                                    : ''}
                                </div>
                              </div>
                              <div className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1">
                                <div className="text-[9px] text-slate-500">证据链 / 耗时</div>
                                <div className="text-slate-200">
                                  {selectedExec.evidenceRefs?.length ?? 0} 条 ·{' '}
                                  {(selectedExec.latencyMs ?? 0).toFixed(1)}ms
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : selectedNode.metricConfig?.mode === 'from_operator' ? (
                    /* Tab 2（算子引用节点）：完整纵向空间渲染输出列胶囊 + V4TablePivotPreview */
                    <div className="flex flex-col space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#30363d] bg-[#0d1117] px-2.5 py-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <Table2 className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                          <span className="truncate text-[11px] font-semibold text-cyan-200">
                            {selectedNodeOpMeta?.name ||
                              selectedNode.metricConfig.sourceRef ||
                              '未绑定算子'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {opPreview?.status && (
                            <span
                              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${getExecStatusMeta(opPreview.status).cls}`}
                            >
                              {opPreview.status}
                              {typeof opPreview.latencyMs === 'number'
                                ? ` · ${opPreview.latencyMs.toFixed(0)}ms`
                                : ''}
                            </span>
                          )}
                          {selectedNode.metricConfig.sourceRef?.trim() && (
                            <button
                              type="button"
                              onClick={() =>
                                void runOperatorPreview(
                                  selectedNode.metricConfig!.sourceRef!,
                                  true,
                                )
                              }
                              disabled={opPreview?.loading}
                              className="inline-flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/15 px-2 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50 cursor-pointer"
                            >
                              <RefreshCw
                                className={`h-3 w-3 ${opPreview?.loading ? 'animate-spin' : ''}`}
                              />
                              <span>{opPreview?.loading ? '试算中...' : '刷新预览'}</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {opPreview?.error && (
                        <div className="rounded border border-rose-500/40 bg-rose-950/40 px-2.5 py-2 text-[11px] text-rose-200">
                          {opPreview.error}
                        </div>
                      )}

                      {opPreview?.status === 'unavailable' && opPreview.missingDataReason && (
                        <div className="flex items-start gap-1.5 rounded border border-rose-500/40 bg-rose-950/40 px-2.5 py-2 text-[11px] text-rose-200">
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                          <span>{opPreview.missingDataReason}</span>
                        </div>
                      )}

                      {/* 输出列可点击胶囊：点击一键填入 targetField */}
                      <div className="space-y-1.5 rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5">
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span>点击输出列胶囊设为提取字段 (targetField)：</span>
                          {selectedNode.metricConfig.targetField && (
                            <span className="font-mono text-emerald-300">
                              已选: {selectedNode.metricConfig.targetField}
                            </span>
                          )}
                        </div>
                        {opPreviewColumns.length === 0 ? (
                          <div className="text-[10px] text-slate-500">
                            {opPreview?.loading
                              ? '正在计算输出列...'
                              : '暂无输出列定义，请先在「基础配置」选择算子'}
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {opPreviewColumns.map((col) => {
                              const isActiveField =
                                selectedNode.metricConfig?.targetField === col.name;
                              return (
                                <button
                                  key={`op-pill-${col.name}`}
                                  type="button"
                                  onClick={() =>
                                    updateSelectedMetricConfig({ targetField: col.name })
                                  }
                                  title={
                                    col.description
                                      ? `${col.description}（设为目标字段）`
                                      : `将 ${col.name} 设为目标字段`
                                  }
                                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] transition cursor-pointer ${
                                    isActiveField
                                      ? 'border-emerald-400 bg-emerald-500/25 font-semibold text-emerald-100 shadow-sm shadow-emerald-950/60'
                                      : 'border-[#30363d] bg-[#161b22] text-cyan-200 hover:border-cyan-400/70 hover:bg-cyan-500/10'
                                  }`}
                                >
                                  <span>{col.name}</span>
                                  {col.type && (
                                    <span className="text-[9px] opacity-70">{col.type}</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <V4TablePivotPreview
                        dataset={opPreview?.dataset ?? null}
                        maxRows={50}
                        title={`${selectedNodeOpMeta?.name || selectedNode.metricConfig.sourceRef || '算子'} · 实时数据集`}
                        emptyText={
                          !selectedNode.metricConfig.sourceRef?.trim()
                            ? '请先在「基础配置」中选择关联算子'
                            : opPreview?.loading
                              ? '正在试算二维数据集...'
                              : opPreview?.status === 'unavailable'
                                ? `数据缺失：${opPreview.missingDataReason || '底表缺失'}`
                                : '点击「刷新预览」获取该算子的二维数据集'
                        }
                      />
                    </div>
                  ) : (
                    /* Tab 2（非算子引用节点）：展示当前产出或上游指标数据集预览 */
                    <div className="flex flex-col space-y-3">
                      {selectedNode.metricConfig?.mode === 'from_metric_agg' &&
                        nonOpPreviewColumns.length > 0 && (
                          <div className="space-y-1.5 rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5">
                            <div className="flex items-center justify-between text-[10px] text-slate-400">
                              <span>点击列设为聚合目标列 (targetField)：</span>
                              {selectedNode.metricConfig.targetField && (
                                <span className="font-mono text-emerald-300">
                                  已选: {selectedNode.metricConfig.targetField}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {nonOpPreviewColumns.map((col) => {
                                const isActiveField =
                                  selectedNode.metricConfig?.targetField === col.name;
                                return (
                                  <button
                                    key={`nonop-pill-${col.name}`}
                                    type="button"
                                    onClick={() =>
                                      updateSelectedMetricConfig({ targetField: col.name })
                                    }
                                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] transition cursor-pointer ${
                                      isActiveField
                                        ? 'border-emerald-400 bg-emerald-500/25 font-semibold text-emerald-100'
                                        : 'border-[#30363d] bg-[#161b22] text-emerald-200 hover:border-emerald-400/70'
                                    }`}
                                  >
                                    <span>{col.name}</span>
                                    {col.type && (
                                      <span className="text-[9px] opacity-70">{col.type}</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                      <V4TablePivotPreview
                        dataset={activePreviewInfo.exec?.dataset ?? null}
                        maxRows={50}
                        title={
                          activePreviewInfo.node
                            ? `${activePreviewInfo.isUpstream ? '上游指标 · ' : ''}${activePreviewInfo.node.metricConfig?.name || activePreviewInfo.node.label}`
                            : '上游指标数据预览'
                        }
                        emptyText={
                          activePreviewInfo.exec?.status === 'unavailable'
                            ? `数据缺失：${activePreviewInfo.exec.missingDataReason || '上游数据源缺失'}`
                            : '请先点击「试算」获取该节点的计算数据表'
                        }
                      />
                    </div>
                  )
                ) : selectedEdge ? (
                  <div className="space-y-3 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                    <div className="font-mono text-[11px] text-slate-400">
                      {selectedEdge.sourceNodeId} ➔ {selectedEdge.targetNodeId}
                    </div>
                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-300">
                        公式变量别名 (targetAlias)
                      </span>
                      <input
                        type="text"
                        value={selectedEdge.targetAlias ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setActiveGraph((prev) => ({
                            ...prev,
                            edges: prev.edges.map((ed) =>
                              ed.id === selectedEdge.id
                                ? { ...ed, targetAlias: val || undefined }
                                : ed,
                            ),
                          }));
                        }}
                        placeholder="例如 strike_rate"
                        className="w-full rounded border border-[#30363d] bg-[#161b22] px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => handleDeleteEdge(selectedEdge.id)}
                      className="inline-flex items-center gap-1 rounded border border-rose-500/45 bg-rose-500/15 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/25 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>删除连线</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-400">指标图 ID (graphId)</span>
                      <input
                        type="text"
                        value={activeGraph.graphId}
                        onChange={(e) =>
                          setActiveGraph((prev) => ({ ...prev, graphId: e.target.value }))
                        }
                        className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-400">指标图名称 (name)</span>
                      <input
                        type="text"
                        value={activeGraph.name}
                        onChange={(e) =>
                          setActiveGraph((prev) => ({ ...prev, name: e.target.value }))
                        }
                        className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-400">说明 (description)</span>
                      <textarea
                        rows={3}
                        value={activeGraph.description ?? ''}
                        onChange={(e) =>
                          setActiveGraph((prev) => ({ ...prev, description: e.target.value }))
                        }
                        className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                      />
                    </label>
                    <div className="rounded-lg border border-dashed border-[#30363d] p-4 text-center text-[11px] text-slate-500">
                      <FolderOpen className="mx-auto mb-1.5 h-5 w-5 text-slate-600" />
                      在画布中点击任意节点即可编辑指标配置或预览实证数据表
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </div>
      )}

      {/* 轻量二级弹窗：+ 新建指标 */}
      {newMetricModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setNewMetricModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-[#30363d] bg-[#161b22] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#30363d] bg-[#0d1117] px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Plus className="h-4 w-4 text-teal-400" />
                <span>新建客观指标节点</span>
              </div>
              <button
                type="button"
                onClick={() => setNewMetricModalOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-[#161b22] hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 p-4 text-xs">
              <div className="space-y-1.5">
                <span className="text-[11px] text-slate-400">派生层级 (mode)</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['from_operator', 'from_metric_agg', 'from_metric_formula'] as const).map(
                    (m) => {
                      const active = newMetricMode === m;
                      const meta = DERIVED_TIER_META[m];
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            setNewMetricMode(m);
                            setNewMetricLevel(
                              m === 'from_operator'
                                ? 'MOP'
                                : m === 'from_metric_agg'
                                  ? 'MOE'
                                  : 'MOFE',
                            );
                          }}
                          className={`rounded-lg border px-2 py-2 text-left transition cursor-pointer ${
                            active
                              ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100 font-semibold'
                              : 'border-[#30363d] bg-[#0d1117] text-slate-300 hover:border-slate-500'
                          }`}
                        >
                          <div className="font-mono text-[11px]">{meta.label}</div>
                          <div className="mt-0.5 font-mono text-[9px] text-slate-400">{m}</div>
                        </button>
                      );
                    },
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <label className="col-span-2 space-y-1">
                  <span className="text-[11px] text-slate-400">指标名称 (留空则自动生成)</span>
                  <input
                    type="text"
                    value={newMetricName}
                    onChange={(e) => setNewMetricName(e.target.value)}
                    placeholder="例如：突击任务毁伤完成度"
                    className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                  />
                </label>

                <label className="col-span-2 space-y-1">
                  <span className="text-[11px] text-slate-400">metricId (留空则自动生成)</span>
                  <input
                    type="text"
                    value={newMetricIdInput}
                    onChange={(e) => setNewMetricIdInput(e.target.value)}
                    placeholder="例如：firepower.strike_damage_rate"
                    className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">军事层次</span>
                  <select
                    value={newMetricLevel}
                    onChange={(e) => setNewMetricLevel(e.target.value as MetricMilitaryLevel)}
                    className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                  >
                    {MILITARY_LEVELS.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {lvl}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">能力域</span>
                  <select
                    value={newMetricDomain}
                    onChange={(e) => setNewMetricDomain(e.target.value as MetricDomainTag)}
                    className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                  >
                    {DOMAIN_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="col-span-2 space-y-1">
                  <span className="text-[11px] text-slate-400">物理单位 (unit)</span>
                  <input
                    type="text"
                    value={newMetricUnit}
                    onChange={(e) => setNewMetricUnit(e.target.value)}
                    placeholder="例如：ratio / nm / s / count"
                    className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                  />
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-[#30363d] pt-3">
                <button
                  type="button"
                  onClick={() => setNewMetricModalOpen(false)}
                  className="rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleAddMetricNode(newMetricMode, {
                      name: newMetricName,
                      metricId: newMetricIdInput,
                      militaryLevel: newMetricLevel,
                      domainTag: newMetricDomain,
                      unit: newMetricUnit,
                      enterCanvas: true,
                    });
                    setNewMetricModalOpen(false);
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-400/60 bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 cursor-pointer"
                >
                  <GitBranch className="h-3.5 w-3.5" />
                  <span>创建并进入链路画布</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
