import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  FilePlus2,
  FolderOpen,
  GitBranch,
  Layers,
  Play,
  Plus,
  RefreshCw,
  Save,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
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
type WorkspaceViewMode = 'canvas' | 'list';

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

const DOMAIN_OPTIONS: Array<{ value: MetricDomainTag; label: string }> = [
  { value: 'firepower', label: '火力打击 (firepower)' },
  { value: 'isr', label: '侦察预警 (isr)' },
  { value: 'survivability', label: '生存防护 (survivability)' },
  { value: 'c2', label: '指挥控制 (c2)' },
  { value: 'synergy', label: '体系协同 (synergy)' },
  { value: 'cost', label: '战损效费 (cost)' },
];

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
  from_operator: '算子引用 (from_operator)',
  from_metric_agg: '二次聚合 (from_metric_agg)',
  from_metric_formula: '复合公式 (from_metric_formula)',
};

function sanitizeVarAlias(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, '_');
  if (!cleaned) return 'm_var';
  return /^[a-zA-Z_]/.test(cleaned) ? cleaned : `m_${cleaned}`;
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

  const [workspaceView, setWorkspaceView] = useState<WorkspaceViewMode>('canvas');
  const [listSearch, setListSearch] = useState('');
  const [listLevelFilter, setListLevelFilter] = useState<'ALL' | MetricMilitaryLevel>('ALL');
  const [listDomainFilter, setListDomainFilter] = useState<'ALL' | MetricDomainTag>('ALL');

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
  const [compareCollapsed, setCompareCollapsed] = useState(false);
  const [lastExecStats, setLastExecStats] = useState<{
    totalLatencyMs?: number;
    cacheHits?: number;
    cacheMisses?: number;
    runId?: string;
  } | null>(null);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);

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
            const defaultGraph =
              list.find((g) => g.graphId === 'mg_v4_metrics_guide_full') ?? list[0];
            setActiveGraph(structuredClone(defaultGraph));
            setSelectedNodeId(defaultGraph.nodes[0]?.id ?? null);
            setIsLocalDraftMode(false);
          } else {
            const draft = createDraftMetricGraph(1);
            setActiveGraph(draft);
            setSelectedNodeId(draft.nodes[0]?.id ?? null);
            setIsLocalDraftMode(true);
          }
        } else {
          const draft = createDraftMetricGraph(1);
          setGraphs([]);
          setActiveGraph(draft);
          setSelectedNodeId(draft.nodes[0]?.id ?? null);
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
        setSelectedNodeId(draft.nodes[0]?.id ?? null);
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

  const selectedNode = useMemo(
    () => activeGraph.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [activeGraph.nodes, selectedNodeId],
  );

  const selectedEdge = useMemo(
    () => activeGraph.edges.find((e) => e.id === selectedEdgeId) ?? null,
    [activeGraph.edges, selectedEdgeId],
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

  // 新增三类指标节点
  const handleAddMetricNode = useCallback(
    (mode: MetricNodeConfig['mode']) => {
      const idx = activeGraph.nodes.length + 1;
      const uid = `${Date.now().toString(36).slice(-4)}_${idx}`;
      const nodeId = `mn_${mode === 'from_operator' ? 'op' : mode === 'from_metric_agg' ? 'agg' : 'fml'}_${uid}`;
      const defaultOp = operators[0];

      const baseCfg: MetricNodeConfig =
        mode === 'from_operator'
          ? {
              metricId: defaultOp ? `${defaultOp.id}.${uid}` : `metric.op_${uid}`,
              name: defaultOp ? `${defaultOp.name} 指标` : `算子引用指标 ${idx}`,
              militaryLevel: defaultOp?.militaryLevel ?? 'MOP',
              domainTag: defaultOp?.domainTag ?? 'firepower',
              mode: 'from_operator',
              sourceRef: defaultOp?.id ?? '',
              unit: defaultOp?.unit ?? '',
            }
          : mode === 'from_metric_agg'
            ? {
                metricId: `metric.agg_${uid}`,
                name: `二次聚合指标 ${idx}`,
                militaryLevel: 'MOE',
                domainTag: 'synergy',
                mode: 'from_metric_agg',
                sourceRef: selectedNode?.metricConfig?.metricId ?? '',
                reduce: 'mean',
              }
            : {
                metricId: `metric.formula_${uid}`,
                name: `多指标复合公式 ${idx}`,
                militaryLevel: 'MOFE',
                domainTag: 'synergy',
                mode: 'from_metric_formula',
                formulaExpression: 'm1',
              };

      const colOffset = (activeGraph.nodes.length % 3) * 330;
      const rowOffset = Math.floor(activeGraph.nodes.length / 3) * 185;
      const newNode: MetricDagNode = {
        id: nodeId,
        kind: mode,
        label: baseCfg.name,
        position: { x: 90 + colOffset, y: 80 + rowOffset },
        metricConfig: baseCfg,
      };

      const nextEdges = [...activeGraph.edges];
      if (selectedNode && mode !== 'from_operator') {
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
    },
    [activeGraph.nodes.length, activeGraph.edges, operators, selectedNode],
  );

  const handleNewDraftGraph = useCallback(() => {
    const draft = createDraftMetricGraph(graphs.length + 1);
    setActiveGraph(draft);
    setSelectedNodeId(draft.nodes[0]?.id ?? null);
    setSelectedEdgeId(null);
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
        setActiveGraph(structuredClone(remaining[0]));
        setSelectedNodeId(remaining[0].nodes[0]?.id ?? null);
      } else {
        const draft = createDraftMetricGraph(1);
        setActiveGraph(draft);
        setSelectedNodeId(draft.nodes[0]?.id ?? null);
        setIsLocalDraftMode(true);
      }
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
          text: `执行完成：${nodeValues.length - unavailCount}/${nodeValues.length} 节点就绪，${unavailCount} 个节点处于 Fail-Closed 缺数态`,
        });
      } else {
        setBanner({
          kind: 'info',
          text: `指标 DAG 执行成功（${nodeValues.length} 节点，耗时 ${(execution.totalLatencyMs ?? 0).toFixed(1)}ms，缓存命中 ${execution.cacheHits ?? 0}）`,
        });
      }
    } catch (err) {
      setBanner({
        kind: 'error',
        text: `执行指标 DAG 失败：${err instanceof Error ? err.message : String(err)}`,
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
          `${json.error || `全阵营对比试算失败 (HTTP ${res.status})`}${hint}`,
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
      setCompareCollapsed(false);

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
          text: '全阵营对比完成，但当前推演数据中未动态发现分方列（sides 为空）',
        });
      } else {
        setBanner({
          kind: 'info',
          text: `全阵营对比试算完成：动态发现 ${sides.length} 个阵营（${sides.join(' / ')}）`,
        });
      }
    } catch (err) {
      setBanner({
        kind: 'error',
        text: `全阵营对比失败：${err instanceof Error ? err.message : String(err)}`,
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

  // 转换为通用画布节点/边契约
  const canvasNodes = useMemo<DagCanvasNode[]>(() => {
    return activeGraph.nodes.map((node) => {
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
        position: node.position,
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
  }, [activeGraph.nodes, execResults, executing]);

  const canvasEdges = useMemo<DagCanvasEdge[]>(() => {
    return activeGraph.edges.map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      targetAlias: e.targetAlias,
      label: e.targetAlias ? `${e.targetAlias}` : undefined,
      graphKind: 'metric',
    }));
  }, [activeGraph.edges]);

  const handleCanvasNodesChange = useCallback((nextNodes: DagCanvasNode[]) => {
    setActiveGraph((prev) => {
      const prevMap = new Map(prev.nodes.map((n) => [n.id, n]));
      const updated: MetricDagNode[] = nextNodes.map((cn) => {
        const existing = prevMap.get(cn.id);
        return {
          ...(existing ?? {}),
          id: cn.id,
          kind: existing?.kind ?? cn.kind,
          label: existing?.label ?? cn.label,
          position: cn.position,
          collapsed: cn.collapsed,
          parameterPorts: existing?.parameterPorts ?? cn.parameterPorts,
          params: existing?.params ?? cn.params,
          metricConfig: existing?.metricConfig,
        };
      });
      return { ...prev, nodes: updated };
    });
  }, []);

  const handleCanvasEdgesChange = useCallback((nextEdges: DagCanvasEdge[]) => {
    setActiveGraph((prev) => ({
      ...prev,
      edges: stripMetricWeights(
        nextEdges.map((e) => ({
          id: e.id,
          sourceNodeId: e.sourceNodeId,
          targetNodeId: e.targetNodeId,
          ...(e.targetAlias ? { targetAlias: e.targetAlias } : {}),
        })),
      ),
    }));
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
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
    },
    [selectedNodeId],
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

  // 为底部透视表确定目标数据集（优先选中节点，其次最近有数据集的节点）
  const activePreviewInfo = useMemo(() => {
    if (selectedNode && execResults[selectedNode.id]?.dataset) {
      return {
        node: selectedNode,
        exec: execResults[selectedNode.id],
      };
    }
    for (const n of activeGraph.nodes) {
      const res = execResults[n.id];
      if (res?.dataset) {
        return { node: n, exec: res };
      }
    }
    return {
      node: selectedNode,
      exec: selectedNode ? execResults[selectedNode.id] : undefined,
    };
  }, [selectedNode, activeGraph.nodes, execResults]);

  const opPreviewColumns = useMemo(
    () => extractPreviewColumns(opPreview?.dataset ?? null, selectedNodeOpMeta?.outputColumns),
    [opPreview?.dataset, selectedNodeOpMeta?.outputColumns],
  );

  // 当前节点的可用候选列（用于 groupBy / targetField 提示）
  const availableColumnSuggestions = useMemo(() => {
    const names = new Set<string>();
    for (const c of opPreviewColumns) names.add(c.name);
    const execCols = activePreviewInfo.exec?.dataset?.columns ?? [];
    for (const c of execCols) names.add(c.name);
    if (selectedNodeOpMeta?.outputColumns) {
      for (const c of selectedNodeOpMeta.outputColumns) names.add(c.name);
    }
    // 也从直接上游节点结果读取列
    for (const edge of incomingEdgesForSelected) {
      const upCols = execResults[edge.sourceNodeId]?.dataset?.columns ?? [];
      for (const c of upCols) names.add(c.name);
    }
    return Array.from(names);
  }, [opPreviewColumns, activePreviewInfo.exec, selectedNodeOpMeta, incomingEdgesForSelected, execResults]);

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

  const levelCounts = useMemo(() => {
    const counts: Record<MetricMilitaryLevel, number> = { MOP: 0, MOE: 0, MOFE: 0 };
    for (const n of activeGraph.nodes) {
      const lvl = n.metricConfig?.militaryLevel ?? 'MOP';
      counts[lvl] = (counts[lvl] ?? 0) + 1;
    }
    return counts;
  }, [activeGraph.nodes]);

  const selectedExec = selectedNode ? execResults[selectedNode.id] : undefined;

  return (
    <div className="flex h-full min-h-[760px] flex-col gap-3 rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-slate-100">
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#30363d] bg-[#161b22] px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300">
            <Layers className="h-3.5 w-3.5" />
            <span>二库 · 客观指标 DAG 工坊</span>
          </div>

          {/* 画布编排 / 指标清单 双视图切换 */}
          <div className="flex rounded-md border border-[#30363d] bg-[#0d1117] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setWorkspaceView('canvas')}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1 transition cursor-pointer ${
                workspaceView === 'canvas'
                  ? 'border border-emerald-500/40 bg-emerald-500/20 font-semibold text-emerald-200'
                  : 'border border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <GitBranch className="h-3.5 w-3.5" />
              <span>画布编排</span>
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceView('list')}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1 transition cursor-pointer ${
                workspaceView === 'list'
                  ? 'border border-cyan-500/40 bg-cyan-500/20 font-semibold text-cyan-200'
                  : 'border border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Table2 className="h-3.5 w-3.5" />
              <span>指标清单</span>
              <span className="rounded bg-[#161b22] px-1 font-mono text-[10px] text-slate-300">
                {activeGraph.nodes.length}
              </span>
            </button>
          </div>

          <select
            value={graphs.some((g) => g.graphId === activeGraph.graphId) ? activeGraph.graphId : '__draft__'}
            onChange={(e) => {
              const target = graphs.find((g) => g.graphId === e.target.value);
              if (target) {
                setActiveGraph(structuredClone(target));
                setSelectedNodeId(target.nodes[0]?.id ?? null);
                setSelectedEdgeId(null);
                setExecResults({});
                setSideComparison(null);
                setDiscoveredSides([]);
                setTargetSide('ALL');
                setIsLocalDraftMode(false);
              }
            }}
            className="max-w-[230px] rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
          >
            {!graphs.some((g) => g.graphId === activeGraph.graphId) && (
              <option value="__draft__">{activeGraph.name} (未保存草案)</option>
            )}
            {graphs.map((g) => (
              <option key={g.graphId} value={g.graphId}>
                {g.name} ({g.graphId}){g.builtin ? ' [内置]' : ''}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleNewDraftGraph}
            className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1 text-xs text-slate-200 hover:border-slate-500 transition cursor-pointer"
          >
            <FilePlus2 className="h-3.5 w-3.5 text-emerald-400" />
            <span>新建</span>
          </button>

          <button
            type="button"
            onClick={handleSaveGraph}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50 transition cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{saving ? '保存中...' : '保存指标 DAG'}</span>
          </button>

          {graphs.some((g) => g.graphId === activeGraph.graphId && !g.builtin) && (
            <button
              type="button"
              onClick={handleDeleteGraph}
              disabled={saving}
              title="删除当前指标图"
              className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-slate-400 hover:border-rose-500/50 hover:text-rose-300 disabled:opacity-50 transition cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => void loadInitialData()}
            disabled={loadingInit}
            title="刷新算子库与指标图"
            className="rounded-md border border-[#30363d] bg-[#0d1117] p-1.5 text-slate-400 hover:text-slate-100 transition cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingInit ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* 右侧节点添加 & 执行控制 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleAddMetricNode('from_operator')}
            className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1 text-xs text-cyan-200 hover:border-cyan-500/60 transition cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 text-cyan-400" />
            <span>算子引用</span>
          </button>

          <button
            type="button"
            onClick={() => handleAddMetricNode('from_metric_agg')}
            className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1 text-xs text-emerald-200 hover:border-emerald-500/60 transition cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 text-emerald-400" />
            <span>二次聚合</span>
          </button>

          <button
            type="button"
            onClick={() => handleAddMetricNode('from_metric_formula')}
            className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1 text-xs text-teal-200 hover:border-teal-500/60 transition cursor-pointer"
          >
            <Calculator className="h-3.5 w-3.5 text-teal-400" />
            <span>复合公式</span>
          </button>

          <div className="flex items-center gap-1.5 text-xs text-slate-300">
            <span className="text-[11px] text-slate-400">阵营切片:</span>
            <select
              value={targetSide}
              onChange={(e) => setTargetSide(e.target.value)}
              title="分方列表由全阵营对比接口从真实推演数据中动态发现"
              className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-emerald-300 focus:border-emerald-500 focus:outline-none"
            >
              <option value="ALL">
                {discoveredSides.length > 0
                  ? `全部阵营 (${discoveredSides.length} 方)`
                  : '全部阵营'}
              </option>
              {discoveredSides.map((side) => (
                <option key={side} value={side}>
                  {side}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => void handleCompareSides()}
            disabled={comparingSides || executing || activeGraph.nodes.length === 0}
            title="调用 /compare-sides 从真实数据动态发现分方并同屏对比"
            className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50 transition cursor-pointer"
          >
            <Scale className="h-3.5 w-3.5 text-cyan-300" />
            <span>{comparingSides ? '对比中...' : '全阵营对比'}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleExecuteMetricDag()}
            disabled={executing || comparingSides || activeGraph.nodes.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/60 bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-emerald-950/50 hover:bg-emerald-500 disabled:opacity-50 transition cursor-pointer"
          >
            <Play className="h-3.5 w-3.5" />
            <span>{executing ? '计算中...' : '▶ 执行指标 DAG'}</span>
          </button>
        </div>
      </div>

      {/* 强隔离安全提示条 & 执行结果提示 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-[#161b22]/80 px-3.5 py-1.5 text-[11px]">
        <div className="flex items-center gap-2 text-emerald-300">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium">
            强隔离规则：二库指标画布严禁配置主观权重或效用分（仅计算客观 MOP / MOE / MOFE 物理量纲与 TableDataset）
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-slate-400">
          {selectedRunId && <span>runId: {selectedRunId}</span>}
          {activeSourceId && <span>source: {activeSourceId}</span>}
          {isLocalDraftMode && (
            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-300">
              本地草案
            </span>
          )}
          {lastExecStats && (
            <span className="rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
              耗时 {(lastExecStats.totalLatencyMs ?? 0).toFixed(1)}ms · 缓存 {lastExecStats.cacheHits ?? 0}/
              {(lastExecStats.cacheHits ?? 0) + (lastExecStats.cacheMisses ?? 0)}
            </span>
          )}
        </div>
      </div>

      {banner && (
        <div
          className={`flex items-center justify-between gap-2 rounded-lg border px-3.5 py-2 text-xs ${
            banner.kind === 'error'
              ? 'border-rose-500/60 bg-rose-950/60 text-rose-200'
              : banner.kind === 'warn'
                ? 'border-amber-500/50 bg-amber-950/50 text-amber-200'
                : 'border-emerald-500/45 bg-emerald-950/50 text-emerald-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {banner.kind === 'error' ? (
              <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400" />
            ) : banner.kind === 'warn' ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
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

      {/* 主工作区：左侧/中间 DAG 画布 + 右侧属性检查器 */}
      <div className="grid min-h-[470px] flex-1 grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="lg:col-span-8 flex min-h-[470px] flex-col">
          <DagCanvasBoard
            graphKind="metric"
            title={activeGraph.name}
            nodes={canvasNodes}
            edges={canvasEdges}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            showOutline={false}
            outlineSide="left"
            emptyStateText="点击上方 [+ 算子引用] / [+ 二次聚合] / [+ 复合公式] 添加指标节点"
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

        {/* 右侧指标节点配置抽屉 */}
        <aside className="lg:col-span-4 flex max-h-[600px] flex-col overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22]">
          <div className="flex items-center justify-between border-b border-[#30363d] bg-[#0d1117]/80 px-3.5 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <span className="truncate text-xs font-semibold text-slate-100">
                {selectedNode
                  ? `节点属性 · ${selectedNode.metricConfig?.name || selectedNode.label}`
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
                  className="inline-flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-medium text-cyan-200 hover:bg-cyan-500/25 transition cursor-pointer"
                >
                  <ArrowDownRight className="h-3 w-3" />
                  <span>下钻算子</span>
                </button>
              )}
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 text-xs">
            {/* 强制隔离红线提醒 */}
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200">
              二库指标画布严禁配置主观权重或效用分。此处仅定义客观物理指标、过滤切片与量纲衍生。
            </div>

            {selectedNode ? (
              <>
                {/* 基础标识与军标分层 */}
                <div className="grid grid-cols-2 gap-2">
                  <label className="col-span-2 space-y-1">
                    <span className="text-[11px] text-slate-400">指标 ID (metricId)</span>
                    <input
                      type="text"
                      value={selectedNode.metricConfig?.metricId ?? ''}
                      onChange={(e) => updateSelectedMetricConfig({ metricId: e.target.value })}
                      placeholder="例如 firepower.strike_completion"
                      className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </label>

                  <label className="col-span-2 space-y-1">
                    <span className="text-[11px] text-slate-400">指标名称 (name)</span>
                    <input
                      type="text"
                      value={selectedNode.metricConfig?.name ?? selectedNode.label}
                      onChange={(e) => updateSelectedMetricConfig({ name: e.target.value })}
                      className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">军事层次 (militaryLevel)</span>
                    <div className="grid grid-cols-3 gap-1">
                      {MILITARY_LEVELS.map((lvl) => {
                        const active = (selectedNode.metricConfig?.militaryLevel ?? 'MOP') === lvl;
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
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">能力域 (domainTag)</span>
                    <select
                      value={selectedNode.metricConfig?.domainTag ?? 'firepower'}
                      onChange={(e) =>
                        updateSelectedMetricConfig({ domainTag: e.target.value as MetricDomainTag })
                      }
                      className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                    >
                      {DOMAIN_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">派生模式 (mode)</span>
                    <select
                      value={selectedNode.metricConfig?.mode ?? 'from_operator'}
                      onChange={(e) =>
                        updateSelectedMetricConfig({
                          mode: e.target.value as MetricNodeConfig['mode'],
                        })
                      }
                      className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                    >
                      {(Object.keys(MODE_LABELS) as Array<MetricNodeConfig['mode']>).map((m) => (
                        <option key={m} value={m}>
                          {MODE_LABELS[m]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">物理量纲 (unit)</span>
                    <input
                      type="text"
                      value={selectedNode.metricConfig?.unit ?? ''}
                      onChange={(e) => updateSelectedMetricConfig({ unit: e.target.value })}
                      placeholder="例如 0-1 / % / s / km"
                      className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </label>
                </div>

                {/* 上游数据来源 sourceRef */}
                {selectedNode.metricConfig?.mode === 'from_operator' && (
                  <div className="space-y-1.5 rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-cyan-300">
                        引用一库算子 (sourceRef)
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">
                        共 {operators.length} 个算子
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
                      {operators.map((op) => (
                        <option key={op.id} value={op.id}>
                          {op.name} ({op.id})
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={selectedNode.metricConfig?.sourceRef ?? ''}
                      onChange={(e) => updateSelectedMetricConfig({ sourceRef: e.target.value })}
                      placeholder="或直接输入算子 ID"
                      className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[11px] text-slate-300 focus:border-cyan-500 focus:outline-none"
                    />
                    {selectedNodeOpMeta?.description && (
                      <p className="text-[10px] text-slate-400 leading-relaxed">
                        {selectedNodeOpMeta.description}
                      </p>
                    )}
                  </div>
                )}

                {selectedNode.metricConfig?.mode === 'from_metric_agg' && (
                  <div className="space-y-1.5 rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5">
                    <span className="text-[11px] font-semibold text-emerald-300">
                      上游指标来源 (sourceRef)
                    </span>
                    <select
                      value={selectedNode.metricConfig?.sourceRef ?? ''}
                      onChange={(e) => updateSelectedMetricConfig({ sourceRef: e.target.value })}
                      className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="">-- 选择上游指标节点 --</option>
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
                )}

                {selectedNode.metricConfig?.mode === 'from_metric_formula' && (
                  <div className="space-y-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-teal-300">
                        多指标复合公式 (LibFormula AST)
                      </span>
                      <span className="text-[10px] text-slate-500">点击变量插入</span>
                    </div>

                    {incomingEdgesForSelected.length === 0 ? (
                      <div className="text-[11px] text-amber-300">
                        请从上游指标节点拖拽连线到此节点，以绑定公式变量。
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {incomingEdgesForSelected.map((edge) => {
                          const srcNode = activeGraph.nodes.find((n) => n.id === edge.sourceNodeId);
                          const varName =
                            edge.targetAlias ||
                            sanitizeVarAlias(srcNode?.metricConfig?.metricId || edge.sourceNodeId);
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
                                      ed.id === edge.id ? { ...ed, targetAlias: nextAlias } : ed,
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
                            filterEditMode === 'kv' ? 'bg-[#30363d] text-white' : 'text-slate-400'
                          }`}
                        >
                          键值对
                        </button>
                        <button
                          type="button"
                          onClick={() => setFilterEditMode('json')}
                          className={`rounded px-1.5 py-0.5 cursor-pointer ${
                            filterEditMode === 'json' ? 'bg-[#30363d] text-white' : 'text-slate-400'
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
                              <span className="w-28 truncate rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[11px] text-slate-300">
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
                                    filterCriteria: Object.keys(nextFc).length ? nextFc : undefined,
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
                            className="w-28 rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[11px] text-slate-200 focus:border-emerald-500 focus:outline-none"
                          />
                          <input
                            type="text"
                            value={newFilterVal}
                            onChange={(e) => setNewFilterVal(e.target.value)}
                            placeholder="值如 蓝方"
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
                            + 添加
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
                              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                                setFilterJsonError('必须为 JSON 对象');
                              } else {
                                setFilterJsonError(null);
                                updateSelectedMetricConfig({
                                  filterCriteria: Object.keys(parsed).length ? parsed : undefined,
                                });
                              }
                            } catch (err) {
                              setFilterJsonError(err instanceof Error ? err.message : 'JSON 格式错误');
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
                        <span className="text-[11px] text-slate-400">目标度量列 (targetField)</span>
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
                        {availableColumnSuggestions.slice(0, 14).map((colName) => (
                          <button
                            key={colName}
                            type="button"
                            onClick={() => updateSelectedMetricConfig({ targetField: colName })}
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
                      <span className="text-[11px] font-semibold text-slate-300">执行状态诊断</span>
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                          selectedExec.status === 'valid'
                            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                            : selectedExec.status === 'degraded'
                              ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                              : 'border-rose-500/45 bg-rose-500/15 text-rose-300'
                        }`}
                      >
                        {selectedExec.status.toUpperCase()}
                      </span>
                    </div>

                    {selectedExec.status === 'unavailable' ? (
                      <div className="flex items-start gap-1.5 rounded border border-rose-500/40 bg-rose-950/40 p-2 text-[11px] text-rose-200">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                        <span>
                          {selectedExec.missingDataReason || 'Fail-Closed：上游数据源或字段缺失'}
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

                    {selectedExec.cacheKey && (
                      <div className="truncate font-mono text-[9px] text-slate-500" title={selectedExec.cacheKey}>
                        cacheKey: {selectedExec.cacheKey} {selectedExec.cacheHit ? '(HIT)' : ''}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : selectedEdge ? (
              <div className="space-y-3 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                <div className="font-mono text-[11px] text-slate-400">
                  {selectedEdge.sourceNodeId} ➔ {selectedEdge.targetNodeId}
                </div>
                <label className="block space-y-1">
                  <span className="text-[11px] text-slate-300">公式变量别名 (targetAlias)</span>
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
                    onChange={(e) => setActiveGraph((prev) => ({ ...prev, name: e.target.value }))}
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
                  在画布中点击任意节点即可编辑指标配置并实时透视 TableDataset
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* 底部实时多维明细 / 交叉透视预览区 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between px-1 text-[11px] text-slate-400">
          <div className="flex items-center gap-2">
            <Database className="h-3.5 w-3.5 text-cyan-400" />
            <span>
              选中节点 TableDataset 实时透视：
              <strong className="ml-1 text-slate-200">
                {activePreviewInfo.node
                  ? `${activePreviewInfo.node.metricConfig?.name || activePreviewInfo.node.label} (${activePreviewInfo.node.metricConfig?.metricId || activePreviewInfo.node.id})`
                  : '未选中节点'}
              </strong>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setPreviewCollapsed((prev) => !prev)}
            className="rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 cursor-pointer"
          >
            {previewCollapsed ? '展开透视表' : '收起透视表'}
          </button>
        </div>

        {!previewCollapsed && (
          <V4TablePivotPreview
            dataset={activePreviewInfo.exec?.dataset ?? null}
            title={
              activePreviewInfo.node
                ? `${activePreviewInfo.node.metricConfig?.name || activePreviewInfo.node.label} · 实证数据表`
                : '指标节点 TableDataset 预览'
            }
            emptyText={
              activePreviewInfo.exec?.status === 'unavailable'
                ? `Fail-Closed 缺数：${activePreviewInfo.exec.missingDataReason || '所需算子底表缺失'}`
                : '暂无执行产出表，请点击顶部 [▶ 执行指标 DAG] 获取真实二维明细与交叉透视结果'
            }
          />
        )}
      </div>
    </div>
  );
}
