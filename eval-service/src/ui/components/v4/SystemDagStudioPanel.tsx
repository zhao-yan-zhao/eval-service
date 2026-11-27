import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  GitBranch,
  Layers,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Table2,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AggregationStrategy,
  AlarmThreshold,
  DagEdge,
  DagNodeBase,
  EffectDefinition,
  EvaluatedEffectNode,
  EvaluationDagOutput,
  EvaluationSystemDag,
  IndicatorReduceMethod,
  MetricDomainTag,
  MetricGraphDefinition,
  NodeMissingPolicy,
  ScoringRule,
} from '../../../core/types.ts';
import {
  computeIncomingWeightSummary,
  DagCanvasBoard,
  type DagCanvasEdge,
  type DagCanvasNode,
  type DagNodeStatus,
} from '../dag-canvas/index.ts';
import { UnifiedAssetSelector, type UnifiedAssetOption } from './UnifiedAssetSelector.tsx';

export interface SystemDagStudioPanelProps {
  activeSourceId?: string;
  selectedRunId?: string;
  onDrillDownToMetric?: (metricId: string) => void;
}

type SystemDagNode = DagNodeBase & {
  refId?: string;
  inlineEffect?: EffectDefinition;
  builtin?: boolean;
};

type ExtendedSystemDag = EvaluationSystemDag & {
  builtin?: boolean;
  metricGraphId?: string;
};

interface EvaluationDagRunOutputLike extends EvaluationDagOutput {
  resolvedParamOverrides?: Record<string, Record<string, unknown>>;
}

interface SystemSideComparisonState {
  systemId: string;
  sides: string[];
  overall?: EvaluationDagRunOutputLike;
  bySide: Record<string, EvaluationDagRunOutputLike>;
  runId?: string;
  metricGraphId?: string;
}

interface SystemValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  hasCycle?: boolean;
  cycleNodeIds?: string[];
}

interface SystemRecentEvalRecord {
  evalOutput?: EvaluationDagRunOutputLike;
  sideComparison?: SystemSideComparisonState;
}

type SystemViewMode = 'list' | 'overview' | 'canvas';
type DrawerTab = 'basic' | 'scoring' | 'evidence';

interface OverviewHierarchyRow {
  rowKey: string;
  node: SystemDagNode;
  effect?: EffectDefinition;
  depth: number;
  section: 'terminal' | 'standalone';
  incomingWeight?: number;
  parentNodeId?: string;
  hasChildren: boolean;
  roleTag: '终态效果' | '能力维度' | '下挂效果' | '指标代理' | '硬门控' | '软门控';
}

const DOMAIN_LABELS: Record<MetricDomainTag, string> = {
  firepower: '火力打击',
  isr: '侦察预警',
  survivability: '生存防护',
  c2: '指挥控制',
  synergy: '体系协同',
  cost: '战损效费',
};

const DYNAMIC_SIDE_PALETTES = [
  {
    text: 'text-cyan-200',
    badge: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200',
  },
  {
    text: 'text-emerald-200',
    badge: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  },
  {
    text: 'text-amber-200',
    badge: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  },
  {
    text: 'text-violet-200',
    badge: 'border-violet-500/40 bg-violet-500/15 text-violet-200',
  },
  {
    text: 'text-rose-200',
    badge: 'border-rose-500/40 bg-rose-500/15 text-rose-200',
  },
  {
    text: 'text-sky-200',
    badge: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
  },
] as const;

const STRATEGY_OPTIONS: Array<{ value: AggregationStrategy; label: string }> = [
  { value: 'weighted_sum', label: '加权求和 (weighted_sum)' },
  { value: 'weighted_product', label: '加权求积 (weighted_product)' },
  { value: 'geometric_mean', label: '几何平均 (geometric_mean)' },
  { value: 'maximin', label: '极小值短板 (maximin)' },
  { value: 'max', label: '极大值 (max)' },
  { value: 'mean', label: '算术均值 (mean)' },
  { value: 'formula', label: '自定义公式 (formula)' },
];

const MISSING_POLICY_OPTIONS: Array<{ value: NodeMissingPolicy; label: string }> = [
  { value: 'skip_renormalize', label: '跳过并重新归一 (skip_renormalize)' },
  { value: 'fail', label: '严格级联失效 (fail)' },
  { value: 'worst', label: '按 0 分计 (worst)' },
  { value: 'neutral', label: '按 50 分计 (neutral)' },
];

const SCORING_TYPE_OPTIONS: Array<{ value: ScoringRule['type']; label: string }> = [
  { value: 'larger_is_better', label: '极大值最优 (larger_is_better)' },
  { value: 'smaller_is_better', label: '极小值最优 (smaller_is_better)' },
  { value: 'linear', label: '区间线性映射 (linear)' },
  { value: 'target_range', label: '目标区间最优 (target_range)' },
  { value: 'step', label: '阶梯分档 (step)' },
  { value: 'boolean', label: '布尔达标 (boolean)' },
];

const REDUCE_OPTIONS: IndicatorReduceMethod[] = [
  'mean',
  'sum',
  'max',
  'min',
  'median',
  'first',
  'last',
];

function createDefaultScoringRule(type: ScoringRule['type'] = 'larger_is_better'): ScoringRule {
  switch (type) {
    case 'smaller_is_better':
      return { type: 'smaller_is_better', optimal: 0, worst: 100 };
    case 'linear':
      return { type: 'linear', bounds: [0, 1] };
    case 'target_range':
      return { type: 'target_range', optimalRange: [0.6, 0.9], toleranceRange: [0.3, 1.0] };
    case 'step':
      return {
        type: 'step',
        steps: [
          { val: 0, score: 0 },
          { val: 0.5, score: 60 },
          { val: 0.8, score: 90 },
          { val: 1, score: 100 },
        ],
      };
    case 'boolean':
      return { type: 'boolean', trueScore: 100, falseScore: 0 };
    case 'larger_is_better':
    default:
      return { type: 'larger_is_better', worst: 0, optimal: 1 };
  }
}

function createDraftSystemDag(index = 1): ExtendedSystemDag {
  const suffix = Date.now().toString(36).slice(-4);
  return {
    systemId: `sys_draft_${suffix}_${index}`,
    name: index === 1 ? '联合作战双轨门控评估体系（本地草案）' : `新建评估体系 DAG ${index}`,
    version: '4.0.0',
    description: '支持效果独立复用、无限层级效果叠加、参数向下游透传与双轨安全红线门控',
    terminalEffectNodeId: 'eff_joint_overall',
    globalParams: {},
    nodes: [
      {
        id: 'mp_strike',
        kind: 'metric_proxy',
        label: '指标 · 对地突击完成率',
        refId: 'strike.composite_mission_metrics',
        position: { x: 60, y: 70 },
      },
      {
        id: 'mp_patrol',
        kind: 'metric_proxy',
        label: '指标 · 空中巡逻达标率',
        refId: 'patrol.composite_mission_metrics',
        position: { x: 60, y: 245 },
      },
      {
        id: 'mp_fratricide',
        kind: 'metric_proxy',
        label: '指标 · 友军误伤次数',
        refId: 'roe.fratricide_count',
        position: { x: 60, y: 420 },
      },
      {
        id: 'eff_strike',
        kind: 'effect',
        label: '对地突击效果',
        refId: 'eff_strike_mission',
        position: { x: 400, y: 70 },
      },
      {
        id: 'eff_patrol',
        kind: 'effect',
        label: '空中巡逻掩护效果',
        refId: 'eff_patrol_coverage',
        position: { x: 400, y: 245 },
      },
      {
        id: 'gate_fratricide',
        kind: 'gate',
        label: '误伤红线硬门控',
        refId: 'gate_fratricide_zero',
        position: { x: 400, y: 420 },
      },
      {
        id: 'eff_air_comp',
        kind: 'effect',
        label: '制空突击复合效果',
        refId: 'eff_air_superiority',
        position: { x: 740, y: 155 },
      },
      {
        id: 'eff_joint_overall',
        kind: 'effect',
        label: '联合作战综合效能 (终态)',
        position: { x: 1080, y: 255 },
        inlineEffect: {
          effectId: 'eff_joint_overall_inline',
          name: '联合作战综合效能',
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
      { id: 'se_mp_strike', sourceNodeId: 'mp_strike', targetNodeId: 'eff_strike', weight: 1.0 },
      { id: 'se_mp_patrol', sourceNodeId: 'mp_patrol', targetNodeId: 'eff_patrol', weight: 1.0 },
      {
        id: 'se_mp_fratricide',
        sourceNodeId: 'mp_fratricide',
        targetNodeId: 'gate_fratricide',
        weight: 1.0,
      },
      { id: 'se_strike_comp', sourceNodeId: 'eff_strike', targetNodeId: 'eff_air_comp', weight: 0.6 },
      { id: 'se_patrol_comp', sourceNodeId: 'eff_patrol', targetNodeId: 'eff_air_comp', weight: 0.4 },
      {
        id: 'se_comp_joint',
        sourceNodeId: 'eff_air_comp',
        targetNodeId: 'eff_joint_overall',
        weight: 0.8,
      },
      {
        id: 'se_gate_joint',
        sourceNodeId: 'gate_fratricide',
        targetNodeId: 'eff_joint_overall',
        weight: 0.2,
      },
    ],
  };
}

function normalizeTargetIncomingWeights(edges: DagEdge[], targetNodeId: string): DagEdge[] {
  const incoming = edges.filter((e) => e.targetNodeId === targetNodeId);
  if (incoming.length === 0) return edges;

  const rawWeights = incoming.map((e) =>
    typeof e.weight === 'number' && Number.isFinite(e.weight) && e.weight > 0 ? e.weight : 0,
  );
  const sum = rawWeights.reduce((acc, w) => acc + w, 0);
  const n = incoming.length;

  const computedWeights: number[] = [];
  if (sum > 0) {
    for (let i = 0; i < n; i += 1) {
      computedWeights.push(Math.round((rawWeights[i] / sum) * 10000) / 10000);
    }
  } else {
    const eq = Math.round((1 / n) * 10000) / 10000;
    for (let i = 0; i < n; i += 1) computedWeights.push(eq);
  }

  let adjustIdx = n - 1;
  for (let i = n - 1; i >= 0; i -= 1) {
    if (computedWeights[i] > 0) {
      adjustIdx = i;
      break;
    }
  }
  const others = computedWeights.reduce((acc, w, idx) => (idx === adjustIdx ? acc : acc + w), 0);
  computedWeights[adjustIdx] = Math.max(0.0001, Math.round((1 - others) * 10000) / 10000);

  const weightById = new Map<string, number>();
  incoming.forEach((e, idx) => weightById.set(e.id, computedWeights[idx]));

  return edges.map((e) => (weightById.has(e.id) ? { ...e, weight: weightById.get(e.id) } : e));
}

function normalizeAllIncomingWeightsLocally(dag: ExtendedSystemDag): ExtendedSystemDag {
  let nextEdges = [...dag.edges];
  const nodeMap = new Map(dag.nodes.map((n) => [n.id, n]));
  const targetIds = new Set(nextEdges.map((e) => e.targetNodeId));
  for (const tid of targetIds) {
    const node = nodeMap.get(tid);
    if (!node || node.kind === 'metric_proxy' || node.kind === 'metric') continue;
    const incoming = nextEdges.filter((e) => e.targetNodeId === tid);
    const singleSrc = incoming.length === 1 ? nodeMap.get(incoming[0].sourceNodeId) : undefined;
    if (
      incoming.length === 1 &&
      incoming[0].weight === undefined &&
      singleSrc &&
      (singleSrc.kind === 'metric_proxy' || singleSrc.kind === 'metric')
    ) {
      continue;
    }
    nextEdges = normalizeTargetIncomingWeights(nextEdges, tid);
  }
  return { ...dag, edges: nextEdges };
}

function extractEvaluationFromSlice(slice: unknown): EvaluationDagRunOutputLike | undefined {
  if (!slice || typeof slice !== 'object') return undefined;
  const rec = slice as Record<string, unknown>;
  if (rec.evaluation && typeof rec.evaluation === 'object') {
    return rec.evaluation as EvaluationDagRunOutputLike;
  }
  if ('nodeResults' in rec || 'overallScore' in rec || 'gateVerdict' in rec) {
    return rec as unknown as EvaluationDagRunOutputLike;
  }
  return undefined;
}

function getVerdictBadgeStyle(verdict?: string): string {
  if (verdict === 'DISQUALIFIED') {
    return 'border-rose-500/60 bg-rose-500/20 text-rose-200';
  }
  if (verdict === 'WARNING') {
    return 'border-amber-500/55 bg-amber-500/20 text-amber-200';
  }
  if (verdict === 'PASS') {
    return 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300';
  }
  return 'border-slate-700 bg-slate-800/80 text-slate-400';
}

function resolveNodeGateVerdict(
  node: SystemDagNode,
  effect: EffectDefinition | undefined,
  evalRes: EvaluatedEffectNode | undefined,
  isTerminal: boolean,
  overallOutput: EvaluationDagRunOutputLike | null | undefined,
): { label: 'PASS' | 'WARNING' | 'DISQUALIFIED' | '缺数' | '--'; cls: string } {
  if (isTerminal && overallOutput) {
    const v = overallOutput.gateVerdict;
    return { label: v, cls: getVerdictBadgeStyle(v) };
  }
  if (!evalRes) {
    return { label: '--', cls: 'border-slate-700/70 bg-slate-800/60 text-slate-500' };
  }
  const isGate = node.kind === 'gate' || effect?.role === 'gate' || evalRes.role === 'gate';
  const gateMode = evalRes.gateMode ?? effect?.gateMode ?? 'soft';
  if (isGate) {
    if (evalRes.gateStatus === 'violated') {
      return gateMode === 'hard'
        ? { label: 'DISQUALIFIED', cls: getVerdictBadgeStyle('DISQUALIFIED') }
        : { label: 'WARNING', cls: getVerdictBadgeStyle('WARNING') };
    }
    if (evalRes.gateStatus === 'pass') {
      return { label: 'PASS', cls: getVerdictBadgeStyle('PASS') };
    }
    if (evalRes.gateStatus === 'unavailable' || evalRes.status === 'unavailable') {
      return { label: '缺数', cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300' };
    }
  }
  if (evalRes.status === 'unavailable') {
    return { label: '缺数', cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300' };
  }
  if (evalRes.status === 'degraded') {
    return { label: 'WARNING', cls: getVerdictBadgeStyle('WARNING') };
  }
  return { label: 'PASS', cls: getVerdictBadgeStyle('PASS') };
}

function resolveRoleTag(
  node: SystemDagNode,
  effect: EffectDefinition | undefined,
  depth: number,
  isTerminal: boolean,
): OverviewHierarchyRow['roleTag'] {
  if (isTerminal) return '终态效果';
  if (node.kind === 'metric_proxy' || node.kind === 'metric') return '指标代理';
  if (node.kind === 'gate' || effect?.role === 'gate') {
    return effect?.gateMode === 'hard' ? '硬门控' : '软门控';
  }
  if (depth === 1) return '能力维度';
  return '下挂效果';
}

function getRoleTagStyle(tag: OverviewHierarchyRow['roleTag']): string {
  switch (tag) {
    case '终态效果':
      return 'border-indigo-400/50 bg-indigo-500/20 text-indigo-200';
    case '能力维度':
      return 'border-violet-400/45 bg-violet-500/15 text-violet-200';
    case '硬门控':
      return 'border-rose-500/50 bg-rose-500/15 text-rose-200';
    case '软门控':
      return 'border-amber-500/50 bg-amber-500/15 text-amber-200';
    case '指标代理':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
    default:
      return 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200';
  }
}

function computeSystemScaleStats(
  sys: ExtendedSystemDag,
  effectMap: Map<string, EffectDefinition>,
): { dimensionCount: number; metricProxyCount: number; gateCount: number } {
  const nodeMap = new Map(sys.nodes.map((n) => [n.id, n as SystemDagNode]));
  let metricProxyCount = 0;
  let gateCount = 0;

  for (const rawNode of sys.nodes) {
    const node = rawNode as SystemDagNode;
    const isProxy = node.kind === 'metric_proxy' || node.kind === 'metric';
    if (isProxy) {
      metricProxyCount += 1;
      continue;
    }
    const eff = node.inlineEffect ?? (node.refId ? effectMap.get(node.refId) : undefined);
    if (node.kind === 'gate' || eff?.role === 'gate') {
      gateCount += 1;
    }
  }

  let dimensionCount = 0;
  const termId = sys.terminalEffectNodeId;
  if (termId && nodeMap.has(termId)) {
    const seenDimIds = new Set<string>();
    for (const edge of sys.edges) {
      if (edge.targetNodeId !== termId) continue;
      const src = nodeMap.get(edge.sourceNodeId);
      if (!src) continue;
      const isProxy = src.kind === 'metric_proxy' || src.kind === 'metric';
      const eff = isProxy
        ? undefined
        : src.inlineEffect ?? (src.refId ? effectMap.get(src.refId) : undefined);
      const isGate = src.kind === 'gate' || eff?.role === 'gate';
      if (!isProxy && !isGate) {
        seenDimIds.add(src.id);
      }
    }
    dimensionCount = seenDimIds.size;
  }

  return { dimensionCount, metricProxyCount, gateCount };
}

export function SystemDagStudioPanel({
  activeSourceId,
  selectedRunId,
  onDrillDownToMetric,
}: SystemDagStudioPanelProps) {
  const [effects, setEffects] = useState<EffectDefinition[]>([]);
  const [metricGraphs, setMetricGraphs] = useState<MetricGraphDefinition[]>([]);
  const [systems, setSystems] = useState<ExtendedSystemDag[]>([]);
  const [activeSystem, setActiveSystem] = useState<ExtendedSystemDag>(() =>
    createDraftSystemDag(1),
  );
  const [selectedMetricGraphId, setSelectedMetricGraphId] = useState<string>('');
  const [targetSide, setTargetSide] = useState<string>('ALL');
  const [discoveredSides, setDiscoveredSides] = useState<string[]>([]);

  const [viewMode, setViewMode] = useState<SystemViewMode>('list');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const prevViewModeRef = useRef<SystemViewMode>(viewMode);
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const savedListScrollTopRef = useRef<number>(0);
  const overviewScrollRef = useRef<HTMLDivElement | null>(null);
  const savedOverviewScrollTopRef = useRef<number>(0);

  useLayoutEffect(() => {
    if (viewMode === 'list' && listScrollRef.current) {
      listScrollRef.current.scrollTop = savedListScrollTopRef.current;
    } else if (viewMode === 'overview' && overviewScrollRef.current) {
      overviewScrollRef.current.scrollTop = savedOverviewScrollTopRef.current;
    }
  }, [viewMode]);
  const [systemSearch, setSystemSearch] = useState('');
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('basic');
  const [collapsedRowKeys, setCollapsedRowKeys] = useState<Set<string>>(() => new Set());
  const didInitRef = useRef(false);

  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const [systemConfigOpen, setSystemConfigOpen] = useState(false);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const [effectSearch, setEffectSearch] = useState('');
  const [effectDomainFilter, setEffectDomainFilter] = useState<string>('all');
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);

  const [loadingInit, setLoadingInit] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [coldStartBannerDismissed, setColdStartBannerDismissed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingSystemId, setDeletingSystemId] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [comparingSides, setComparingSides] = useState(false);

  const [evalOutput, setEvalOutput] = useState<EvaluationDagRunOutputLike | null>(null);
  const [sideComparison, setSideComparison] = useState<SystemSideComparisonState | null>(null);
  const [recentEvalBySystem, setRecentEvalBySystem] = useState<
    Record<string, SystemRecentEvalRecord>
  >({});
  const [validationReport, setValidationReport] = useState<SystemValidationReport | null>(null);
  const [banner, setBanner] = useState<{ kind: 'info' | 'warn' | 'error'; text: string } | null>(
    null,
  );

  // 另存为独立复用效果的本地表单状态
  const [saveEffectOpen, setSaveEffectOpen] = useState(false);
  const [saveEffectIdDraft, setSaveEffectIdDraft] = useState('');
  const [saveEffectNameDraft, setSaveEffectNameDraft] = useState('');
  const [savingEffect, setSavingEffect] = useState(false);

  // JSON 字段受控草稿（paramOverrides / sliceFilter）
  const [paramOverridesText, setParamOverridesText] = useState('{}');
  const [paramOverridesErr, setParamOverridesErr] = useState<string | null>(null);
  const [sliceFilterText, setSliceFilterText] = useState('{}');
  const [sliceFilterErr, setSliceFilterErr] = useState<string | null>(null);

  const resolveDefaultMetricGraphId = useCallback(
    (mList: MetricGraphDefinition[], sys?: ExtendedSystemDag) => {
      if (sys?.metricGraphId && mList.some((m) => m.graphId === sys.metricGraphId)) {
        return sys.metricGraphId;
      }
      if (sys?.metricGraphId) return sys.metricGraphId;
      return (
        mList.find((m) => m.graphId === 'mg_v4_metrics_guide_full')?.graphId ??
        mList[0]?.graphId ??
        'mg_v4_metrics_guide_full'
      );
    },
    [],
  );

  const loadAllAssets = useCallback(async () => {
    setLoadingInit(true);
    try {
      const [effRes, mgRes, sysRes] = await Promise.allSettled([
        fetch('/api/v4/effects'),
        fetch('/api/v4/metric-graphs'),
        fetch('/api/v4/system-dags'),
      ]);

      if (effRes.status === 'fulfilled' && effRes.value.ok) {
        const ej = (await effRes.value.json()) as { effects?: EffectDefinition[] };
        setEffects(Array.isArray(ej.effects) ? ej.effects : []);
      }

      let mList: MetricGraphDefinition[] = [];
      if (mgRes.status === 'fulfilled' && mgRes.value.ok) {
        const mj = (await mgRes.value.json()) as { graphs?: MetricGraphDefinition[] };
        mList = Array.isArray(mj.graphs) ? mj.graphs : [];
        setMetricGraphs(mList);
      }

      if (sysRes.status === 'fulfilled' && sysRes.value.ok) {
        const sj = (await sysRes.value.json()) as {
          systems?: ExtendedSystemDag[];
          dags?: ExtendedSystemDag[];
        };
        const sList = Array.isArray(sj.systems)
          ? sj.systems
          : Array.isArray(sj.dags)
            ? sj.dags
            : [];
        setSystems(sList);
        if (!didInitRef.current) {
          didInitRef.current = true;
          if (sList.length > 0) {
            const targetSys =
              sList.find((s) => s.systemId === 'sys_v4_metrics_guide_full') ?? sList[0];
            setActiveSystem(structuredClone(targetSys));
            setSelectedNodeId(targetSys.terminalEffectNodeId || targetSys.nodes[0]?.id || null);
            setSelectedMetricGraphId(resolveDefaultMetricGraphId(mList, targetSys));
          } else {
            const draft = createDraftSystemDag(1);
            setActiveSystem(draft);
            setSelectedNodeId(draft.terminalEffectNodeId);
            setSelectedMetricGraphId(resolveDefaultMetricGraphId(mList, draft));
          }
        }
      } else {
        setSystems([]);
        if (!didInitRef.current) {
          didInitRef.current = true;
          const draft = createDraftSystemDag(1);
          setActiveSystem(draft);
          setSelectedNodeId(draft.terminalEffectNodeId);
          setSelectedMetricGraphId(resolveDefaultMetricGraphId(mList, draft));
        }
        setBanner({
          kind: 'warn',
          text: '后端体系 DAG 接口暂未返回持久化模型，已加载可编辑草案',
        });
      }
    } finally {
      setLoadingInit(false);
      setHasLoadedOnce(true);
    }
  }, [resolveDefaultMetricGraphId]);

  useEffect(() => {
    void loadAllAssets();
  }, [loadAllAssets]);

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

  const effectMap = useMemo(
    () => new Map(effects.map((e) => [e.effectId, e])),
    [effects],
  );

  const metricGraphMap = useMemo(
    () => new Map(metricGraphs.map((mg) => [mg.graphId, mg])),
    [metricGraphs],
  );

  const filteredSystems = useMemo(() => {
    const q = systemSearch.trim().toLowerCase();
    if (!q) return systems;
    return systems.filter((s) => {
      const boundMgId = resolveDefaultMetricGraphId(metricGraphs, s);
      const boundMgName = metricGraphMap.get(boundMgId)?.name ?? '';
      return (
        s.name.toLowerCase().includes(q) ||
        s.systemId.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        boundMgId.toLowerCase().includes(q) ||
        boundMgName.toLowerCase().includes(q)
      );
    });
  }, [systems, systemSearch, metricGraphs, metricGraphMap, resolveDefaultMetricGraphId]);

  const resetEvaluationState = useCallback(() => {
    setEvalOutput(null);
    setSideComparison(null);
    setDiscoveredSides([]);
    setTargetSide('ALL');
    setValidationReport(null);
  }, []);

  const handleEnterSystemDetail = useCallback(
    (targetSys: ExtendedSystemDag, nextMode: 'overview' | 'canvas' = 'overview') => {
      const cloned = structuredClone(targetSys);
      setActiveSystem(cloned);
      setSelectedNodeId(cloned.terminalEffectNodeId || cloned.nodes[0]?.id || null);
      setSelectedEdgeId(null);
      setSelectedMetricGraphId(resolveDefaultMetricGraphId(metricGraphs, cloned));
      setCollapsedRowKeys(new Set());
      setValidationReport(null);
      setBanner(null);

      const cached = recentEvalBySystem[cloned.systemId];
      if (cached) {
        setSideComparison(cached.sideComparison ?? null);
        setDiscoveredSides(cached.sideComparison?.sides ?? []);
        setTargetSide('ALL');
        setEvalOutput(cached.evalOutput ?? cached.sideComparison?.overall ?? null);
      } else {
        resetEvaluationState();
      }

      setViewMode(nextMode);
    },
    [metricGraphs, recentEvalBySystem, resolveDefaultMetricGraphId, resetEvaluationState],
  );

  const handleCreateNewSystem = useCallback(() => {
    const draft = createDraftSystemDag(systems.length + 1);
    setActiveSystem(draft);
    setSelectedNodeId(draft.terminalEffectNodeId);
    setSelectedEdgeId(null);
    setCollapsedRowKeys(new Set());
    resetEvaluationState();
    setSelectedMetricGraphId(resolveDefaultMetricGraphId(metricGraphs, draft));
    setBanner({
      kind: 'info',
      text: '已创建新的评估体系 DAG 草案，编辑后可点击「保存体系」持久化',
    });
    setViewMode('canvas');
  }, [systems.length, metricGraphs, resolveDefaultMetricGraphId, resetEvaluationState]);

  const handleChangeTargetSide = useCallback(
    (nextSide: string) => {
      setTargetSide(nextSide);
      if (sideComparison) {
        const nextEval =
          nextSide !== 'ALL' && sideComparison.bySide[nextSide]
            ? sideComparison.bySide[nextSide]
            : sideComparison.overall;
        if (nextEval) {
          setEvalOutput(nextEval);
        }
      }
    },
    [sideComparison],
  );

  // 收集二库指标与预设效果中的可用 metricId 选项
  const availableMetricOptions = useMemo(() => {
    const map = new Map<string, { metricId: string; label: string; level?: string }>();
    for (const g of metricGraphs) {
      for (const n of g.nodes) {
        const mid = n.metricConfig?.metricId;
        if (mid) {
          map.set(mid, {
            metricId: mid,
            label: `${n.metricConfig?.name || n.label} (${g.name})`,
            level: n.metricConfig?.militaryLevel,
          });
        }
      }
    }
    for (const ef of effects) {
      const mid = ef.metricBinding?.metricId;
      if (mid && !map.has(mid)) {
        map.set(mid, {
          metricId: mid,
          label: `${ef.name} 预设指标`,
        });
      }
    }
    return Array.from(map.values());
  }, [metricGraphs, effects]);

  const selectedNode = useMemo(
    () =>
      (activeSystem.nodes.find((n) => n.id === selectedNodeId) as SystemDagNode | undefined) ?? null,
    [activeSystem.nodes, selectedNodeId],
  );

  const selectedNodeEffect = useMemo<EffectDefinition | null>(() => {
    if (!selectedNode || selectedNode.kind === 'metric_proxy' || selectedNode.kind === 'metric') {
      return null;
    }
    if (selectedNode.inlineEffect) return selectedNode.inlineEffect;
    if (selectedNode.refId) return effectMap.get(selectedNode.refId) ?? null;
    return null;
  }, [selectedNode, effectMap]);

  // 同步 JSON 编辑器文本（当切换选中节点时）
  useEffect(() => {
    setSaveEffectOpen(false);
    if (!selectedNode) {
      setParamOverridesText('{}');
      setSliceFilterText('{}');
      setParamOverridesErr(null);
      setSliceFilterErr(null);
      return;
    }

    if (selectedNode.kind === 'metric_proxy' || selectedNode.kind === 'metric') {
      const po = (selectedNode.params?.paramOverrides as Record<string, unknown>) ?? {};
      const sf = (selectedNode.params?.sliceFilter as Record<string, unknown>) ?? {};
      setParamOverridesText(JSON.stringify(po, null, 2));
      setSliceFilterText(JSON.stringify(sf, null, 2));
    } else {
      const po = selectedNodeEffect?.metricBinding?.paramOverrides ?? {};
      const sf = selectedNodeEffect?.metricBinding?.sliceFilter ?? {};
      setParamOverridesText(JSON.stringify(po, null, 2));
      setSliceFilterText(JSON.stringify(sf, null, 2));
    }
    setParamOverridesErr(null);
    setSliceFilterErr(null);
  }, [
    selectedNode?.id,
    selectedNodeEffect?.effectId,
    selectedNode?.kind,
    selectedNodeEffect?.metricBinding?.paramOverrides,
    selectedNodeEffect?.metricBinding?.sliceFilter,
    selectedNode?.params?.paramOverrides,
    selectedNode?.params?.sliceFilter,
  ]);

  // 更新选中效果节点的 inlineEffect（若原本是库引用，自动物化为私有 inlineEffect 以不破坏原始模板）
  const updateSelectedEffect = useCallback(
    (updater: (current: EffectDefinition) => EffectDefinition) => {
      if (!selectedNodeId) return;
      setActiveSystem((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => {
          if (n.id !== selectedNodeId) return n;
          const base: EffectDefinition = n.inlineEffect
            ? structuredClone(n.inlineEffect)
            : n.refId && effectMap.get(n.refId)
              ? structuredClone(effectMap.get(n.refId)!)
              : {
                  effectId: `eff_inline_${n.id}`,
                  name: n.label,
                  role: n.kind === 'gate' ? 'gate' : 'effect',
                  ...(n.kind === 'gate' ? { gateMode: 'soft' as const } : {}),
                  aggregation: {
                    strategy: 'weighted_sum',
                    missingPolicy: 'skip_renormalize',
                  },
                };
          const nextEff = updater(base);
          return {
            ...n,
            kind: nextEff.role === 'gate' ? 'gate' : 'effect',
            label: nextEff.name || n.label,
            inlineEffect: nextEff,
          };
        }),
      }));
    },
    [selectedNodeId, effectMap],
  );

  // 独立效果库过滤
  const filteredEffects = useMemo(() => {
    const q = effectSearch.trim().toLowerCase();
    return effects.filter((e) => {
      if (effectDomainFilter !== 'all') {
        if (effectDomainFilter === 'gate') {
          if (e.role !== 'gate') return false;
        } else if (effectDomainFilter === 'custom') {
          if (e.isBuiltin) return false;
        } else if (e.domainTag !== effectDomainFilter) {
          return false;
        }
      }
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.effectId.toLowerCase().includes(q) ||
        (e.description ?? '').toLowerCase().includes(q)
      );
    });
  }, [effects, effectSearch, effectDomainFilter]);

  // 从效果库点击添加到画布
  const handleAddEffectFromLibrary = useCallback(
    (eff: EffectDefinition) => {
      const idx = activeSystem.nodes.length + 1;
      const nodeId = `sn_${eff.effectId.replace(/[^a-zA-Z0-9_]/g, '_')}_${Date.now().toString(36).slice(-3)}`;
      const pos = {
        x: 340 + (idx % 3) * 290,
        y: 80 + Math.floor(idx / 3) * 170,
      };
      const newNode: SystemDagNode = {
        id: nodeId,
        kind: eff.role === 'gate' ? 'gate' : 'effect',
        label: eff.name,
        refId: eff.effectId,
        position: pos,
      };
      setActiveSystem((prev) => ({
        ...prev,
        nodes: [...prev.nodes, newNode],
        terminalEffectNodeId: prev.terminalEffectNodeId || nodeId,
      }));
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
      setDrawerTab('basic');
    },
    [activeSystem.nodes.length],
  );

  // 原地新建能力维度 / 效果合成 / 门控节点 (inlineEffect)
  const handleAddInlineEffectNode = useCallback(
    (
      role: 'effect' | 'gate',
      options?: { gateMode?: 'hard' | 'soft'; namePrefix?: string; defaultX?: number },
    ) => {
      const idx = activeSystem.nodes.length + 1;
      const uid = Date.now().toString(36).slice(-4);
      const gateMode = options?.gateMode ?? 'hard';
      const nodeId = role === 'gate' ? `sn_gate_${uid}` : `sn_eff_${uid}`;
      const defaultMetric = availableMetricOptions[0]?.metricId;
      const defaultName =
        options?.namePrefix !== undefined
          ? `${options.namePrefix} ${idx}`
          : role === 'gate'
            ? gateMode === 'hard'
              ? `红线硬门控 ${idx}`
              : `预警软门控 ${idx}`
            : `效果合成 ${idx}`;

      const inlineDef: EffectDefinition = {
        effectId: `eff_inline_${uid}`,
        name: defaultName,
        domainTag: 'synergy',
        role,
        ...(role === 'gate' ? { gateMode } : {}),
        ...(defaultMetric && role === 'gate'
          ? {
              metricBinding: {
                metricId: defaultMetric,
                reduce: 'mean',
                scoringRule: createDefaultScoringRule('larger_is_better'),
              },
            }
          : {}),
        aggregation: {
          strategy: role === 'gate' ? 'maximin' : 'weighted_sum',
          missingPolicy: role === 'gate' && gateMode === 'hard' ? 'fail' : 'skip_renormalize',
        },
      };

      const newNode: SystemDagNode = {
        id: nodeId,
        kind: role,
        label: inlineDef.name,
        position: {
          x: options?.defaultX ?? 420 + (idx % 3) * 240,
          y: 90 + Math.floor(idx / 3) * 165,
        },
        inlineEffect: inlineDef,
      };

      setActiveSystem((prev) => ({
        ...prev,
        nodes: [...prev.nodes, newNode],
        terminalEffectNodeId: prev.terminalEffectNodeId || nodeId,
      }));
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
      setDrawerTab('basic');
    },
    [activeSystem.nodes.length, availableMetricOptions],
  );

  // 添加指标代理节点 metric_proxy
  const handleAddMetricProxyNode = useCallback(() => {
    const idx = activeSystem.nodes.length + 1;
    const uid = Date.now().toString(36).slice(-4);
    const defaultMetric = availableMetricOptions[0];
    const nodeId = `mp_${uid}`;
    const newNode: SystemDagNode = {
      id: nodeId,
      kind: 'metric_proxy',
      label: defaultMetric ? `指标 · ${defaultMetric.metricId}` : `指标代理 ${idx}`,
      refId: defaultMetric?.metricId ?? '',
      position: {
        x: 70,
        y: 80 + (idx % 4) * 165,
      },
    };
    setActiveSystem((prev) => ({
      ...prev,
      nodes: [...prev.nodes, newNode],
    }));
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setDrawerTab('basic');
  }, [activeSystem.nodes.length, availableMetricOptions]);

  // 另存为独立复用效果 (POST /api/v4/effects)
  const handleSaveAsReusableEffect = useCallback(async () => {
    if (!selectedNodeEffect) return;
    const targetId = saveEffectIdDraft.trim();
    const targetName = saveEffectNameDraft.trim();
    if (!targetId || !/^[a-zA-Z0-9_.-]+$/.test(targetId)) {
      setBanner({
        kind: 'error',
        text: 'effectId 不能为空且仅允许字母、数字、下划线、点或连字符',
      });
      return;
    }
    if (!targetName) {
      setBanner({ kind: 'error', text: '效果名称不能为空' });
      return;
    }

    const payload: EffectDefinition = {
      ...structuredClone(selectedNodeEffect),
      effectId: targetId,
      name: targetName,
      isBuiltin: false,
    };

    setSavingEffect(true);
    setBanner(null);
    try {
      const res = await fetch('/api/v4/effects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        errors?: string[];
        effect?: EffectDefinition;
      };
      if (!res.ok || json.ok === false) {
        const msg =
          json.error ||
          (Array.isArray(json.errors) ? json.errors.join('；') : '') ||
          `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const savedEff = json.effect ?? payload;
      setEffects((prev) => {
        const idx = prev.findIndex((e) => e.effectId === savedEff.effectId);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = savedEff;
          return next;
        }
        return [...prev, savedEff];
      });

      if (selectedNodeId) {
        setActiveSystem((prev) => ({
          ...prev,
          nodes: prev.nodes.map((n) =>
            n.id === selectedNodeId
              ? {
                  ...n,
                  label: savedEff.name,
                  kind: savedEff.role === 'gate' ? 'gate' : 'effect',
                  refId: savedEff.effectId,
                  inlineEffect: undefined,
                }
              : n,
          ),
        }));
      }

      setSaveEffectOpen(false);
      setBanner({
        kind: 'info',
        text: `已将效果「${savedEff.name}」(${savedEff.effectId}) 沉淀至独立效果库并绑定节点`,
      });
    } catch (err) {
      setBanner({
        kind: 'error',
        text: `保存效果失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSavingEffect(false);
    }
  }, [selectedNodeEffect, saveEffectIdDraft, saveEffectNameDraft, selectedNodeId]);

  const handleDeleteCustomEffect = useCallback(async (effectId: string) => {
    try {
      const res = await fetch(`/api/v4/effects/${encodeURIComponent(effectId)}`, {
        method: 'DELETE',
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setEffects((prev) => prev.filter((e) => e.effectId !== effectId));
      setBanner({ kind: 'info', text: `已从效果库删除自定义效果 ${effectId}` });
    } catch (err) {
      setBanner({
        kind: 'error',
        text: `删除效果失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, []);

  // 校验 & 权重自动归一
  const handleValidateAndNormalize = useCallback(async () => {
    const normalizedDag = normalizeAllIncomingWeightsLocally(activeSystem);
    setActiveSystem(normalizedDag);
    setValidating(true);
    setBanner(null);

    try {
      const res = await fetch('/api/v4/system-dags/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: normalizedDag,
          normalizeWeights: true,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        valid?: boolean;
        errors?: string[];
        warnings?: string[];
        hasCycle?: boolean;
        cycleNodeIds?: string[];
        system?: ExtendedSystemDag;
        normalizedSystem?: ExtendedSystemDag;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      const returnedSys = json.normalizedSystem ?? json.system;
      if (returnedSys && Array.isArray(returnedSys.edges)) {
        setActiveSystem(returnedSys);
      }

      const report: SystemValidationReport = {
        valid: Boolean(json.valid),
        errors: Array.isArray(json.errors) ? json.errors : [],
        warnings: Array.isArray(json.warnings) ? json.warnings : [],
        hasCycle: json.hasCycle,
        cycleNodeIds: json.cycleNodeIds,
      };
      setValidationReport(report);

      if (report.valid) {
        setBanner({
          kind: report.warnings.length > 0 ? 'warn' : 'info',
          text:
            report.warnings.length > 0
              ? `局部权重已归一，拓扑校验通过（含 ${report.warnings.length} 条提示）`
              : '局部权重已全部自动归一 (Σw = 1.0000)，Kahn 拓扑无环校验通过',
        });
      } else {
        setBanner({
          kind: 'error',
          text: `体系校验未通过：${report.errors[0] || '存在配置错误'}`,
        });
      }
    } catch (err) {
      setBanner({
        kind: 'warn',
        text: `已完成本地局部入边权重归一；后端校验请求异常：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setValidating(false);
    }
  }, [activeSystem]);

  // 保存体系 DAG
  const handleSaveSystemDag = useCallback(async () => {
    setSaving(true);
    setBanner(null);
    try {
      const payloadSystem: ExtendedSystemDag = {
        ...activeSystem,
        ...(selectedMetricGraphId ? { metricGraphId: selectedMetricGraphId } : {}),
      };
      const res = await fetch('/api/v4/system-dags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadSystem),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        errors?: string[];
        system?: ExtendedSystemDag;
        dag?: ExtendedSystemDag;
      };
      if (!res.ok || json.ok === false) {
        const msg =
          json.error ||
          (Array.isArray(json.errors) ? json.errors.join('；') : '') ||
          `HTTP ${res.status}`;
        throw new Error(msg);
      }

      const savedSys = json.system ?? json.dag ?? payloadSystem;
      setActiveSystem(savedSys);
      setSystems((prev) => {
        const idx = prev.findIndex((s) => s.systemId === savedSys.systemId);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = savedSys;
          return next;
        }
        return [...prev, savedSys];
      });
      setBanner({
        kind: 'info',
        text: `已保存评估体系 DAG「${savedSys.name}」(${savedSys.systemId})`,
      });
    } catch (err) {
      setBanner({
        kind: 'error',
        text: `保存体系 DAG 失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSaving(false);
    }
  }, [activeSystem, selectedMetricGraphId]);

  const handleDeleteSystemDag = useCallback(
    async (targetSystemId?: string) => {
      const sid = targetSystemId ?? activeSystem.systemId;
      if (!sid) return;
      setSaving(true);
      setDeletingSystemId(sid);
      setBanner(null);
      try {
        const res = await fetch(`/api/v4/system-dags/${encodeURIComponent(sid)}`, {
          method: 'DELETE',
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok || json.ok === false) {
          throw new Error(json.error || `HTTP ${res.status}`);
        }
        const remaining = systems.filter((s) => s.systemId !== sid);
        setSystems(remaining);
        setRecentEvalBySystem((prev) => {
          if (!(sid in prev)) return prev;
          const next = { ...prev };
          delete next[sid];
          return next;
        });

        if (activeSystem.systemId === sid) {
          if (remaining.length > 0) {
            const nextSys = structuredClone(remaining[0]);
            setActiveSystem(nextSys);
            setSelectedNodeId(nextSys.terminalEffectNodeId || nextSys.nodes[0]?.id || null);
            setSelectedMetricGraphId(resolveDefaultMetricGraphId(metricGraphs, nextSys));
          } else {
            const draft = createDraftSystemDag(1);
            setActiveSystem(draft);
            setSelectedNodeId(draft.terminalEffectNodeId);
            setSelectedMetricGraphId(resolveDefaultMetricGraphId(metricGraphs, draft));
          }
          resetEvaluationState();
          if (viewMode !== 'list') {
            setViewMode('list');
          }
        }

        setBanner({ kind: 'info', text: `已删除体系 DAG: ${sid}` });
      } catch (err) {
        setBanner({
          kind: 'error',
          text: `删除失败：${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        setSaving(false);
        setDeletingSystemId(null);
      }
    },
    [
      activeSystem.systemId,
      systems,
      metricGraphs,
      resolveDefaultMetricGraphId,
      resetEvaluationState,
      viewMode,
    ],
  );

  // 全链路评估
  const handleEvaluateSystemDag = useCallback(async () => {
    setEvaluating(true);
    setBanner(null);
    try {
      const effectiveMgId =
        selectedMetricGraphId || activeSystem.metricGraphId || 'mg_v4_metrics_guide_full';
      const res = await fetch('/api/v4/system-dags/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: activeSystem,
          metricGraphId: effectiveMgId,
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
            : `全链路评估失败 (HTTP ${res.status})`,
        );
      }

      const evaluation = (json.evaluation ?? json.result ?? json) as EvaluationDagRunOutputLike;
      setEvalOutput(evaluation);
      if (activeSystem.systemId) {
        setRecentEvalBySystem((prev) => ({
          ...prev,
          [activeSystem.systemId]: {
            ...prev[activeSystem.systemId],
            evalOutput: evaluation,
          },
        }));
      }

      const sidePrefix = targetSide && targetSide !== 'ALL' ? `[${targetSide}] ` : '';
      if (evaluation.gateVerdict === 'DISQUALIFIED') {
        setBanner({
          kind: 'error',
          text: `${sidePrefix}硬红线门控触发 DISQUALIFIED！生效总分已封顶至 ${
            evaluation.overallScore !== null ? evaluation.overallScore.toFixed(1) : '--'
          }（原始分 ${
            evaluation.rawOverallScore !== null ? evaluation.rawOverallScore.toFixed(1) : '--'
          }）`,
        });
      } else if (evaluation.gateVerdict === 'WARNING') {
        setBanner({
          kind: 'warn',
          text: `${sidePrefix}评估完成（触发门控告警）：综合效能 ${
            evaluation.overallScore !== null ? evaluation.overallScore.toFixed(1) : '--'
          } 分`,
        });
      } else {
        setBanner({
          kind: 'info',
          text: `${sidePrefix}评估完成：综合效能 ${
            evaluation.overallScore !== null ? evaluation.overallScore.toFixed(1) : '缺数 (N/A)'
          } 分，门控状态正常`,
        });
      }
    } catch (err) {
      setBanner({
        kind: 'error',
        text: `全链路评估失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setEvaluating(false);
    }
  }, [activeSystem, selectedMetricGraphId, selectedRunId, activeSourceId, targetSide]);

  // 动态全阵营对比评估（分方完全由后端从真实推演数据动态发现）
  const handleCompareSides = useCallback(async () => {
    setComparingSides(true);
    setBanner(null);
    try {
      const effectiveMgId =
        selectedMetricGraphId || activeSystem.metricGraphId || 'mg_v4_metrics_guide_full';
      const systemId = activeSystem.systemId || 'sys_draft';
      const res = await fetch(
        `/api/v4/system-dags/${encodeURIComponent(systemId)}/compare-sides`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runId: selectedRunId,
            dataSourceId: activeSourceId,
            metricGraphId: effectiveMgId,
            system: activeSystem,
          }),
        },
      );

      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        systemId?: string;
        runId?: string;
        metricGraphId?: string;
        sides?: unknown;
        overall?: unknown;
        bySide?: Record<string, unknown>;
      };

      if (!res.ok || json.ok === false) {
        throw new Error(json.error || `全阵营对比评估失败 (HTTP ${res.status})`);
      }

      const sides = Array.isArray(json.sides)
        ? json.sides.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        : [];
      const overall = extractEvaluationFromSlice(json.overall);
      const bySide: Record<string, EvaluationDagRunOutputLike> = {};
      if (json.bySide && typeof json.bySide === 'object') {
        for (const [sideName, rawSlice] of Object.entries(json.bySide)) {
          const parsed = extractEvaluationFromSlice(rawSlice);
          if (parsed) bySide[sideName] = parsed;
        }
      }

      const nextComparison: SystemSideComparisonState = {
        systemId: json.systemId ?? systemId,
        sides,
        overall,
        bySide,
        runId: json.runId ?? selectedRunId,
        metricGraphId: json.metricGraphId ?? effectiveMgId,
      };
      setSideComparison(nextComparison);
      setDiscoveredSides(sides);
      if (activeSystem.systemId) {
        setRecentEvalBySystem((prev) => ({
          ...prev,
          [activeSystem.systemId]: {
            sideComparison: nextComparison,
            evalOutput: overall ?? prev[activeSystem.systemId]?.evalOutput,
          },
        }));
      }

      const nextTarget = targetSide !== 'ALL' && !sides.includes(targetSide) ? 'ALL' : targetSide;
      if (nextTarget !== targetSide) setTargetSide(nextTarget);

      const activeEval =
        nextTarget !== 'ALL' && bySide[nextTarget] ? bySide[nextTarget] : overall;
      if (activeEval) {
        setEvalOutput(activeEval);
      }

      if (sides.length === 0) {
        setBanner({
          kind: 'warn',
          text: '阵营对比完成：当前推演样本中未发现参演阵营',
        });
      } else {
        setBanner({
          kind: 'info',
          text: `阵营对比完成：共 ${sides.length} 个参演阵营（${sides.join(' / ')}）`,
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
  }, [activeSystem, selectedMetricGraphId, selectedRunId, activeSourceId, targetSide]);

  // 构建「体系总览」层次行：终态效果 -> 能力维度 -> 下挂指标/门控（以及独立双轨门控分支）
  const overviewRows = useMemo<OverviewHierarchyRow[]>(() => {
    const nodeMap = new Map<string, SystemDagNode>();
    for (const n of activeSystem.nodes) {
      nodeMap.set(n.id, n as SystemDagNode);
    }
    const incomingMap = new Map<string, DagEdge[]>();
    const outgoingMap = new Map<string, DagEdge[]>();
    for (const e of activeSystem.edges) {
      const inList = incomingMap.get(e.targetNodeId) ?? [];
      inList.push(e);
      incomingMap.set(e.targetNodeId, inList);
      const outList = outgoingMap.get(e.sourceNodeId) ?? [];
      outList.push(e);
      outgoingMap.set(e.sourceNodeId, outList);
    }

    const visitedInTree = new Set<string>();
    const rows: OverviewHierarchyRow[] = [];

    const sortIncoming = (edges: DagEdge[]) =>
      [...edges].sort((a, b) => {
        const wa = typeof a.weight === 'number' ? a.weight : -1;
        const wb = typeof b.weight === 'number' ? b.weight : -1;
        if (wb !== wa) return wb - wa;
        return a.sourceNodeId.localeCompare(b.sourceNodeId);
      });

    const walkUpstream = (
      nodeId: string,
      depth: number,
      section: 'terminal' | 'standalone',
      pathKey: string,
      ancestors: Set<string>,
      incomingWeight?: number,
      parentNodeId?: string,
    ) => {
      const node = nodeMap.get(nodeId);
      if (!node) return;
      visitedInTree.add(nodeId);

      const isProxy = node.kind === 'metric_proxy' || node.kind === 'metric';
      const eff = isProxy
        ? undefined
        : node.inlineEffect ?? (node.refId ? effectMap.get(node.refId) : undefined);

      const inEdges = sortIncoming(incomingMap.get(nodeId) ?? []).filter(
        (e) => nodeMap.has(e.sourceNodeId) && !ancestors.has(e.sourceNodeId),
      );
      const hasChildren = inEdges.length > 0;
      const isTerminal = section === 'terminal' && node.id === activeSystem.terminalEffectNodeId;
      const rowKey = `${section}:${pathKey}`;

      rows.push({
        rowKey,
        node,
        effect: eff,
        depth,
        section,
        incomingWeight,
        parentNodeId,
        hasChildren,
        roleTag: resolveRoleTag(node, eff, depth, isTerminal),
      });

      if (!hasChildren || collapsedRowKeys.has(rowKey)) {
        return;
      }

      const nextAncestors = new Set(ancestors);
      nextAncestors.add(nodeId);
      for (const edge of inEdges) {
        walkUpstream(
          edge.sourceNodeId,
          depth + 1,
          section,
          `${pathKey}>${edge.sourceNodeId}`,
          nextAncestors,
          edge.weight,
          nodeId,
        );
      }
    };

    const termId = activeSystem.terminalEffectNodeId;
    if (termId && nodeMap.has(termId)) {
      walkUpstream(termId, 0, 'terminal', termId, new Set<string>());
    }

    // 收集未挂接到终态树下的节点（例如双轨独立红线门控 gt_attrition_hard / gt_interception_soft 及其输入）
    const remainingNodes = (activeSystem.nodes as SystemDagNode[]).filter(
      (n) => !visitedInTree.has(n.id),
    );
    if (remainingNodes.length > 0) {
      const remainingSet = new Set(remainingNodes.map((n) => n.id));
      const standaloneRoots = remainingNodes
        .filter((n) => {
          const outs = (outgoingMap.get(n.id) ?? []).filter((e) => remainingSet.has(e.targetNodeId));
          return outs.length === 0;
        })
        .sort((a, b) => {
          const aGate = a.kind === 'gate' ? 0 : 1;
          const bGate = b.kind === 'gate' ? 0 : 1;
          return aGate - bGate;
        });

      for (const root of standaloneRoots) {
        if (visitedInTree.has(root.id)) continue;
        walkUpstream(root.id, 0, 'standalone', root.id, new Set<string>());
      }

      for (const leftover of remainingNodes) {
        if (!visitedInTree.has(leftover.id)) {
          walkUpstream(leftover.id, 0, 'standalone', leftover.id, new Set<string>());
        }
      }
    }

    return rows;
  }, [activeSystem.nodes, activeSystem.edges, activeSystem.terminalEffectNodeId, effectMap, collapsedRowKeys]);

  const toggleOverviewRow = useCallback((rowKey: string) => {
    setCollapsedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  }, []);

  // 转换为通用画布节点/边契约
  const canvasNodes = useMemo<DagCanvasNode[]>(() => {
    return activeSystem.nodes.map((node) => {
      const sysNode = node as SystemDagNode;
      const isProxy = sysNode.kind === 'metric_proxy' || sysNode.kind === 'metric';
      const eff = isProxy
        ? undefined
        : sysNode.inlineEffect ?? (sysNode.refId ? effectMap.get(sysNode.refId) : undefined);
      const evalRes: EvaluatedEffectNode | undefined = evalOutput?.nodeResults?.[sysNode.id];

      let status: DagNodeStatus = 'idle';
      if (evaluating || comparingSides) {
        status = 'running';
      } else if (evalRes) {
        if (evalRes.role === 'gate' && evalRes.gateStatus === 'violated') {
          status = 'violated';
        } else {
          status = evalRes.status;
        }
      }

      const role: 'effect' | 'gate' | 'metric_proxy' = isProxy
        ? 'metric_proxy'
        : eff?.role === 'gate' || sysNode.kind === 'gate'
          ? 'gate'
          : 'effect';

      const boundMetricId = isProxy
        ? sysNode.refId || (typeof sysNode.params?.metricId === 'string' ? sysNode.params.metricId : '')
        : eff?.metricBinding?.metricId;

      let subtitle = '';
      if (isProxy) {
        const rawTxt =
          evalRes?.rawValue !== undefined && evalRes?.rawValue !== null
            ? `读数: ${String(evalRes.rawValue)}`
            : undefined;
        subtitle = rawTxt
          ? `${boundMetricId || sysNode.id} · ${rawTxt}`
          : boundMetricId
            ? `指标: ${boundMetricId}`
            : '客观指标输入代理';
      } else if (sysNode.id === activeSystem.terminalEffectNodeId) {
        subtitle = '体系终态综合效能节点';
      } else if (boundMetricId) {
        subtitle = `绑定指标: ${boundMetricId}`;
      } else {
        subtitle = eff?.description || (sysNode.inlineEffect ? '画布私有效果' : '效果库节点');
      }

      return {
        id: sysNode.id,
        kind: role,
        label: sysNode.label || eff?.name || sysNode.id,
        position: sysNode.position,
        collapsed: sysNode.collapsed,
        parameterPorts: sysNode.parameterPorts,
        params: sysNode.params,
        graphKind: 'system',
        status,
        canDrillDown: Boolean(boundMetricId),
        drillDownLabel: boundMetricId ? '下钻指标' : undefined,
        summary: {
          effectId: eff?.effectId ?? sysNode.refId,
          metricId: boundMetricId || undefined,
          role,
          gateMode: evalRes?.gateMode ?? eff?.gateMode,
          gateStatus: evalRes?.gateStatus,
          score: evalRes?.score ?? null,
          rawValue: evalRes?.rawValue,
          strategy: evalRes?.strategyUsed ?? eff?.aggregation?.strategy,
          isTerminal: sysNode.id === activeSystem.terminalEffectNodeId,
          availableWeightRatio: evalRes?.availableWeightRatio,
          subtitle,
          badgeText:
            sysNode.id === activeSystem.terminalEffectNodeId
              ? '终态效果'
              : sysNode.inlineEffect
                ? '私有效果'
                : undefined,
          missingDataReason: evalRes?.missingDataReason,
        },
      };
    });
  }, [
    activeSystem.nodes,
    activeSystem.terminalEffectNodeId,
    effectMap,
    evalOutput,
    evaluating,
    comparingSides,
  ]);

  const canvasEdges = useMemo<DagCanvasEdge[]>(() => {
    return activeSystem.edges.map((e) => {
      const targetEval = evalOutput?.nodeResults?.[e.targetNodeId];
      const srcEval = evalOutput?.nodeResults?.[e.sourceNodeId];
      const status: DagNodeStatus | undefined =
        srcEval?.role === 'gate' && srcEval.gateStatus === 'violated'
          ? 'violated'
          : srcEval?.status;
      return {
        ...e,
        graphKind: 'system',
        status,
        effectiveWeight: targetEval?.effectiveWeights?.[e.id],
      };
    });
  }, [activeSystem.edges, evalOutput]);

  const handleCanvasNodesChange = useCallback((nextNodes: DagCanvasNode[]) => {
    setActiveSystem((prev) => {
      const prevMap = new Map(prev.nodes.map((n) => [n.id, n as SystemDagNode]));
      const updated = nextNodes.map((cn) => {
        const existing = prevMap.get(cn.id);
        return {
          ...(existing ?? {}),
          id: cn.id,
          kind: existing?.kind ?? cn.kind,
          label: existing?.label ?? cn.label,
          position: cn.position,
          collapsed: cn.collapsed,
          refId: existing?.refId,
          inlineEffect: existing?.inlineEffect,
          parameterPorts: existing?.parameterPorts ?? cn.parameterPorts,
          params: existing?.params ?? cn.params,
        };
      });
      return { ...prev, nodes: updated };
    });
  }, []);

  const handleCanvasEdgesChange = useCallback((nextEdges: DagCanvasEdge[]) => {
    setActiveSystem((prev) => ({
      ...prev,
      edges: nextEdges.map((e) => ({
        id: e.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        ...(e.weight !== undefined ? { weight: e.weight } : {}),
        ...(e.targetAlias ? { targetAlias: e.targetAlias } : {}),
      })),
    }));
  }, []);

  const handleUpdateEdgeWeight = useCallback((edgeId: string, weight: number) => {
    setActiveSystem((prev) => ({
      ...prev,
      edges: prev.edges.map((e) => (e.id === edgeId ? { ...e, weight } : e)),
    }));
  }, []);

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setActiveSystem((prev) => {
        const nextNodes = prev.nodes.filter((n) => n.id !== nodeId);
        const nextEdges = prev.edges.filter(
          (e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId,
        );
        const nextTerminal =
          prev.terminalEffectNodeId === nodeId ? (nextNodes[0]?.id ?? '') : prev.terminalEffectNodeId;
        return {
          ...prev,
          nodes: nextNodes,
          edges: nextEdges,
          terminalEffectNodeId: nextTerminal,
        };
      });
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
    },
    [selectedNodeId],
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      setActiveSystem((prev) => ({
        ...prev,
        edges: prev.edges.filter((e) => e.id !== edgeId),
      }));
      if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
    },
    [selectedEdgeId],
  );

  const handleDrillDown = useCallback(
    (nodeId: string) => {
      const node = activeSystem.nodes.find((n) => n.id === nodeId) as SystemDagNode | undefined;
      if (!node) return;
      let metricId: string | undefined;
      if (node.kind === 'metric_proxy' || node.kind === 'metric') {
        metricId =
          node.refId || (typeof node.params?.metricId === 'string' ? node.params.metricId : undefined);
      } else {
        const eff = node.inlineEffect ?? (node.refId ? effectMap.get(node.refId) : undefined);
        metricId = eff?.metricBinding?.metricId;
      }

      if (metricId && onDrillDownToMetric) {
        onDrillDownToMetric(metricId);
      } else {
        setSelectedNodeId(nodeId);
      }
    },
    [activeSystem.nodes, effectMap, onDrillDownToMetric],
  );

  // 当前选中节点的入边列表 & 局部权重和校验
  const selectedIncomingEdges = useMemo(() => {
    if (!selectedNodeId) return [];
    return activeSystem.edges.filter((e) => e.targetNodeId === selectedNodeId);
  }, [activeSystem.edges, selectedNodeId]);

  const selectedWeightSummary = useMemo(() => {
    if (!selectedNodeId) return null;
    return computeIncomingWeightSummary(
      selectedNodeId,
      activeSystem.edges.map((e) => ({ ...e, graphKind: 'system' })),
    );
  }, [selectedNodeId, activeSystem.edges]);

  const selectedEval = selectedNode ? evalOutput?.nodeResults?.[selectedNode.id] : undefined;
  const selectedIsProxy =
    selectedNode?.kind === 'metric_proxy' || selectedNode?.kind === 'metric';

  // 当前选中节点直接关联的 metricId（供检验器下钻按钮使用）
  const selectedBoundMetricId = useMemo(() => {
    if (!selectedNode) return undefined;
    if (selectedIsProxy) {
      return (
        selectedNode.refId ||
        (typeof selectedNode.params?.metricId === 'string' ? selectedNode.params.metricId : undefined)
      );
    }
    return selectedNodeEffect?.metricBinding?.metricId;
  }, [selectedNode, selectedIsProxy, selectedNodeEffect]);

  const activeSystemIsPersistedCustom = useMemo(
    () => systems.some((s) => s.systemId === activeSystem.systemId && !s.builtin),
    [systems, activeSystem.systemId],
  );

  const activeSystemIsBuiltin = useMemo(
    () => systems.some((s) => s.systemId === activeSystem.systemId && Boolean(s.builtin)),
    [systems, activeSystem.systemId],
  );

  const activeSystemIsSaved = useMemo(
    () => systems.some((s) => s.systemId === activeSystem.systemId),
    [systems, activeSystem.systemId],
  );

  const systemSelectorOptions = useMemo<UnifiedAssetOption[]>(() => {
    return systems.map((sys) => ({
      id: sys.systemId,
      label: sys.name || sys.systemId,
      subLabel: `${sys.systemId} · v${sys.version}`,
      group: sys.builtin ? '内置预设体系' : '自定义体系',
      badge: sys.builtin ? '内置' : '自定义',
      badgeTone: sys.builtin ? 'indigo' : 'emerald',
    }));
  }, [systems]);

  useEffect(() => {
    if (prevViewModeRef.current === viewMode) return;
    prevViewModeRef.current = viewMode;
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    let parent = rootRef.current?.parentElement ?? null;
    while (parent) {
      if (parent.scrollTop > 0) {
        parent.scrollTop = 0;
      }
      parent = parent.parentElement;
    }
  }, [viewMode]);

  return (
    <div
      ref={rootRef}
      className="flex flex-col gap-3 rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-slate-100"
    >
      {/* 顶部控制栏：列表态精简栏 vs 详情态返回/编辑栏 */}
      {viewMode === 'list' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#30363d] bg-[#161b22] px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1 text-xs font-semibold text-indigo-300">
              <Scale className="h-3.5 w-3.5" />
              <span>评估体系</span>
            </div>
            <span className="rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-0.5 font-mono text-[11px] text-slate-300 tabular-nums">
              {systemSearch.trim()
                ? `${filteredSystems.length} / ${systems.length} 套体系`
                : `共 ${systems.length} 套体系`}
            </span>

            <UnifiedAssetSelector
              value={activeSystem.systemId}
              options={systemSelectorOptions}
              placeholder="定位体系..."
              searchPlaceholder="搜索体系..."
              accent="indigo"
              onChange={(sysId) => {
                const target = systems.find((s) => s.systemId === sysId);
                if (target) handleEnterSystemDetail(target, 'overview');
              }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-64 sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={systemSearch}
                onChange={(e) => setSystemSearch(e.target.value)}
                placeholder="搜索体系名称、systemId 或指标库..."
                className="w-full rounded-md border border-[#30363d] bg-[#0d1117] py-1.5 pl-8 pr-7 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
              />
              {systemSearch && (
                <button
                  type="button"
                  onClick={() => setSystemSearch('')}
                  title="清空搜索"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleCreateNewSystem}
              className="inline-flex items-center gap-1.5 rounded-md border border-indigo-400/60 bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-indigo-950/60 hover:bg-indigo-500 transition cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新建体系</span>
            </button>

            <button
              type="button"
              onClick={() => void loadAllAssets()}
              disabled={loadingInit}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 text-xs text-slate-200 hover:border-slate-500 hover:text-white disabled:opacity-50 transition cursor-pointer"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-slate-400 ${loadingInit ? 'animate-spin' : ''}`}
              />
              <span>刷新</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#30363d] bg-[#161b22] px-3.5 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setMoreMenuOpen(false);
                setViewMode('list');
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-indigo-400/60 hover:text-indigo-200 transition cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-indigo-400" />
              <span>返回体系列表</span>
            </button>

            <div className="h-4 w-px bg-[#30363d]" />

            <div className="flex items-center gap-2 min-w-0">
              <UnifiedAssetSelector
                value={activeSystem.systemId}
                options={systemSelectorOptions}
                placeholder={activeSystem.name || '选择评估体系...'}
                searchPlaceholder="搜索体系名称、systemId..."
                accent="indigo"
                onChange={(sysId) => {
                  const target = systems.find((s) => s.systemId === sysId);
                  if (target) {
                    handleEnterSystemDetail(
                      target,
                      viewMode === 'canvas' ? 'canvas' : 'overview',
                    );
                  }
                }}
              />
              <span
                className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                  !activeSystemIsSaved
                    ? 'border-amber-500/45 bg-amber-500/15 text-amber-200'
                    : activeSystemIsBuiltin
                      ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200'
                      : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                }`}
              >
                {!activeSystemIsSaved ? '草案' : activeSystemIsBuiltin ? '内置' : '自定义'}
              </span>
            </div>

            <div className="flex items-center rounded-lg border border-[#30363d] bg-[#0d1117] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('overview')}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 transition cursor-pointer ${
                  viewMode === 'overview'
                    ? 'border border-indigo-500/50 bg-indigo-500/20 font-semibold text-indigo-200'
                    : 'border border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Table2 className="h-3.5 w-3.5" />
                <span>体系总览</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('canvas')}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 transition cursor-pointer ${
                  viewMode === 'canvas'
                    ? 'border border-indigo-500/50 bg-indigo-500/20 font-semibold text-indigo-200'
                    : 'border border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <GitBranch className="h-3.5 w-3.5" />
                <span>画布编排</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {discoveredSides.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-slate-300">
                <span className="text-[11px] text-slate-400">阵营切片:</span>
                <select
                  value={targetSide}
                  onChange={(e) => handleChangeTargetSide(e.target.value)}
                  title="按参演阵营筛选评估结果"
                  className="rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-indigo-200 focus:border-indigo-500 focus:outline-none cursor-pointer"
                >
                  <option value="ALL">全部阵营 ({discoveredSides.length} 方)</option>
                  {discoveredSides.map((side) => (
                    <option key={side} value={side}>
                      {side}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <button
              type="button"
              onClick={() => void handleCompareSides()}
              disabled={comparingSides || evaluating || activeSystem.nodes.length === 0}
              title="对比各阵营评估结果"
              className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/50 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50 transition cursor-pointer"
            >
              <Scale className="h-3.5 w-3.5 text-cyan-300" />
              <span>{comparingSides ? '对比中...' : '阵营对比'}</span>
            </button>

            <button
              type="button"
              onClick={() => void handleEvaluateSystemDag()}
              disabled={evaluating || comparingSides || activeSystem.nodes.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md border border-indigo-400/60 bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-indigo-950/60 hover:bg-indigo-500 disabled:opacity-50 transition cursor-pointer"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{evaluating ? '评估中...' : '运行评估'}</span>
            </button>

            <button
              type="button"
              onClick={() => void handleSaveSystemDag()}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1.5 text-xs font-medium text-indigo-200 hover:bg-indigo-500/25 disabled:opacity-50 transition cursor-pointer"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{saving ? '保存中...' : '保存'}</span>
            </button>

            {/* 更多 ▾ 紧凑下拉菜单 */}
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
                <div className="absolute right-0 top-full z-50 mt-1.5 w-60 rounded-xl border border-[#30363d] bg-[#0d1117] p-1.5 shadow-2xl">
                  <button
                    type="button"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      const draft = createDraftSystemDag(systems.length + 1);
                      setActiveSystem(draft);
                      setSelectedNodeId(draft.terminalEffectNodeId);
                      setSelectedEdgeId(null);
                      resetEvaluationState();
                      setSelectedMetricGraphId(resolveDefaultMetricGraphId(metricGraphs, draft));
                      setBanner({ kind: 'info', text: '已创建新的评估体系 DAG 草案' });
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-[#161b22] transition cursor-pointer"
                  >
                    <FilePlus2 className="h-3.5 w-3.5 text-indigo-400" />
                    <span>新建草案</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      void handleValidateAndNormalize();
                    }}
                    disabled={validating}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-cyan-200 hover:bg-[#161b22] disabled:opacity-50 transition cursor-pointer"
                  >
                    <Scale className="h-3.5 w-3.5 text-cyan-400" />
                    <span>{validating ? '校验中...' : '校验 & 权重自动归一'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      setSystemConfigOpen(true);
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-emerald-200 hover:bg-[#161b22] transition cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <Sliders className="h-3.5 w-3.5 text-emerald-400" />
                      <span>上游指标图与体系配置</span>
                    </span>
                    <span className="max-w-[78px] truncate font-mono text-[10px] text-slate-400">
                      {selectedMetricGraphId || '默认'}
                    </span>
                  </button>

                  {activeSystemIsPersistedCustom && (
                    <button
                      type="button"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        void handleDeleteSystemDag();
                      }}
                      disabled={saving}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-rose-300 hover:bg-rose-950/30 disabled:opacity-50 transition cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                      <span>删除当前体系</span>
                    </button>
                  )}

                  <div className="my-1 border-t border-[#30363d]" />

                  <button
                    type="button"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      void loadAllAssets();
                    }}
                    disabled={loadingInit}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-300 hover:bg-[#161b22] disabled:opacity-50 transition cursor-pointer"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 text-slate-400 ${loadingInit ? 'animate-spin' : ''}`}
                    />
                    <span>刷新资产</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 横幅提示与校验报告 */}
      {banner && (
        <div
          className={`flex items-center justify-between gap-2 rounded-lg border px-3.5 py-1.5 text-xs ${
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

      {viewMode !== 'list' &&
        validationReport &&
        (!validationReport.valid || validationReport.warnings.length > 0) && (
          <div className="rounded-lg border border-[#30363d] bg-[#161b22] px-3.5 py-2 text-[11px] space-y-1">
            {validationReport.errors.map((err, i) => (
              <div key={`verr-${i}`} className="flex items-center gap-1.5 text-rose-300">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{err}</span>
              </div>
            ))}
            {validationReport.warnings.map((w, i) => (
              <div key={`vwarn-${i}`} className="flex items-center gap-1.5 text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

      {viewMode === 'list' ? (
        /* ── 视图 0：评估体系列表（第一层默认入口，响应式限高内滚动） ── */
        <div className="flex flex-col gap-3">
          {hasLoadedOnce &&
            systems.length > 0 &&
            Object.keys(recentEvalBySystem).length === 0 &&
            !sideComparison &&
            !coldStartBannerDismissed && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-indigo-500/35 bg-gradient-to-r from-indigo-950/40 via-[#161b22] to-violet-950/30 px-3.5 py-2 text-xs text-indigo-200">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 shrink-0 text-indigo-400 animate-pulse" />
                  <span>
                    三库评估体系库已就绪（共 {systems.length} 套评估体系）。点击列表中任意体系进入设计器，或点击行内操作进入多维效能树与门控裁决。
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setColdStartBannerDismissed(true)}
                  className="text-slate-400 hover:text-slate-200 cursor-pointer text-xs"
                  title="隐藏提示"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

          <div className="flex flex-col overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22]">
            <div
              ref={listScrollRef}
              onScroll={(e) => {
                savedListScrollTopRef.current = e.currentTarget.scrollTop;
              }}
              className="max-h-[calc(100dvh-200px)] min-h-[380px] overflow-auto"
            >
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-[#30363d] bg-[#0d1117] text-[11px] text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">体系名称与标识</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">类型</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">构成规模</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">关联指标图</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">评估结论</th>
                    <th className="px-4 py-2.5 font-medium whitespace-nowrap text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]/70">
                  {!hasLoadedOnce && loadingInit ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={`sys-skeleton-${i}`} className="animate-pulse">
                        <td className="px-4 py-3.5">
                          <div className="h-3.5 w-44 rounded bg-slate-700/60 mb-1.5" />
                          <div className="h-2.5 w-28 rounded bg-slate-800/80" />
                        </td>
                        <td className="px-3 py-3.5">
                          <div className="h-4 w-12 rounded bg-slate-800" />
                        </td>
                        <td className="px-3 py-3.5">
                          <div className="inline-flex gap-1.5">
                            <div className="h-4 w-12 rounded bg-slate-800" />
                            <div className="h-4 w-12 rounded bg-slate-800" />
                            <div className="h-4 w-12 rounded bg-slate-800" />
                          </div>
                        </td>
                        <td className="px-3 py-3.5">
                          <div className="h-3.5 w-32 rounded bg-slate-800" />
                        </td>
                        <td className="px-3 py-3.5">
                          <div className="h-4 w-16 rounded bg-slate-800" />
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="inline-block h-6 w-20 rounded bg-slate-800" />
                        </td>
                      </tr>
                    ))
                  ) : filteredSystems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-14 text-center text-xs text-slate-500">
                      <div className="flex flex-col items-center gap-2.5">
                        <span>
                          {systemSearch.trim()
                            ? `未找到匹配「${systemSearch.trim()}」的评估体系`
                            : '暂无已持久化的评估体系'}
                        </span>
                        <div className="flex items-center gap-2">
                          {systemSearch.trim() && (
                            <button
                              type="button"
                              onClick={() => setSystemSearch('')}
                              className="rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-1 text-xs text-slate-300 hover:text-white cursor-pointer"
                            >
                              清空搜索
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={handleCreateNewSystem}
                            className="inline-flex items-center gap-1 rounded-md border border-indigo-400/50 bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500 cursor-pointer"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            <span>新建体系</span>
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredSystems.map((sys) => {
                    const stats = computeSystemScaleStats(sys, effectMap);
                    const boundMgId = resolveDefaultMetricGraphId(metricGraphs, sys);
                    const boundMg = metricGraphMap.get(boundMgId);
                    const recent = recentEvalBySystem[sys.systemId];
                    const hasSideComp = Boolean(
                      recent?.sideComparison && recent.sideComparison.sides.length > 0,
                    );
                    const singleEval = recent?.evalOutput;

                    const isLastVisited = activeSystem.systemId === sys.systemId;

                    return (
                      <tr
                        key={sys.systemId}
                        onClick={() => handleEnterSystemDetail(sys, 'overview')}
                        title="点击进入该评估体系详情页"
                        className={`group cursor-pointer transition ${
                          isLastVisited ? 'bg-indigo-500/10 hover:bg-indigo-500/15' : 'hover:bg-[#1b2230]'
                        }`}
                      >
                        {/* 1. 体系名称 & systemId */}
                        <td className="px-4 py-3 align-middle">
                          <div className="min-w-0 max-w-md space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-semibold text-slate-100 group-hover:text-indigo-200 transition">
                                {sys.name}
                              </span>
                              <span className="shrink-0 rounded border border-[#30363d] bg-[#0d1117] px-1.5 py-0 font-mono text-[10px] text-slate-400">
                                v{sys.version}
                              </span>
                            </div>
                            <div className="font-mono text-[11px] text-slate-400">
                              {sys.systemId}
                            </div>
                            {sys.description && (
                              <div className="truncate text-[11px] text-slate-500">
                                {sys.description}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* 2. 内置/自定义标签 */}
                        <td className="px-3 py-3 align-middle whitespace-nowrap">
                          <span
                            className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium ${
                              sys.builtin
                                ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200'
                                : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                            }`}
                          >
                            {sys.builtin ? '内置' : '自定义'}
                          </span>
                        </td>

                        {/* 3. 包含规模：能力维度数 / 指标代理数 / 门控数 */}
                        <td className="px-3 py-3 align-middle whitespace-nowrap">
                          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                            <span className="rounded border border-violet-500/35 bg-violet-500/10 px-1.5 py-0.5 text-violet-200 tabular-nums">
                              维度 {stats.dimensionCount}
                            </span>
                            <span className="rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-200 tabular-nums">
                              指标 {stats.metricProxyCount}
                            </span>
                            <span className="rounded border border-rose-500/35 bg-rose-500/10 px-1.5 py-0.5 text-rose-200 tabular-nums">
                              门控 {stats.gateCount}
                            </span>
                          </div>
                        </td>

                        {/* 4. 绑定上游指标库 */}
                        <td className="px-3 py-3 align-middle">
                          <div className="min-w-0 max-w-[220px]">
                            <div className="truncate text-xs text-emerald-200/90">
                              {boundMg?.name ?? boundMgId}
                              {!sys.metricGraphId && (
                                <span className="ml-1 text-[10px] text-slate-500">(默认)</span>
                              )}
                            </div>
                            <div className="truncate font-mono text-[10px] text-slate-500">
                              {boundMgId}
                            </div>
                          </div>
                        </td>

                        {/* 5. 最近评估结论 */}
                        <td className="px-3 py-3 align-middle">
                          {hasSideComp && recent?.sideComparison ? (
                            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                              {recent.sideComparison.sides.map((side, sIdx) => {
                                const pal =
                                  DYNAMIC_SIDE_PALETTES[sIdx % DYNAMIC_SIDE_PALETTES.length];
                                const sOut = recent.sideComparison?.bySide[side];
                                return (
                                  <span
                                    key={`list-side-${sys.systemId}-${side}`}
                                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 tabular-nums ${pal.badge}`}
                                  >
                                    <span>{side}</span>
                                    <span className="font-bold">
                                      {sOut && sOut.overallScore !== null
                                        ? `${sOut.overallScore.toFixed(1)}分`
                                        : '--'}
                                    </span>
                                    {sOut?.gateVerdict === 'DISQUALIFIED' && (
                                      <span className="rounded bg-rose-500/30 px-1 text-[9px] font-bold text-rose-200">
                                        否决
                                      </span>
                                    )}
                                  </span>
                                );
                              })}
                            </div>
                          ) : singleEval ? (
                            <div className="flex items-center gap-1.5 font-mono text-[11px]">
                              <span
                                className={`font-bold tabular-nums ${
                                  singleEval.overallScore === null
                                    ? 'text-slate-400'
                                    : singleEval.gateVerdict === 'DISQUALIFIED'
                                      ? 'text-rose-300'
                                      : singleEval.overallScore >= 80
                                        ? 'text-emerald-300'
                                        : singleEval.overallScore >= 60
                                          ? 'text-indigo-200'
                                          : 'text-amber-300'
                                }`}
                              >
                                {singleEval.overallScore !== null
                                  ? `${singleEval.overallScore.toFixed(1)} 分`
                                  : 'N/A'}
                              </span>
                              <span
                                className={`rounded border px-1.5 py-0 text-[10px] font-bold ${getVerdictBadgeStyle(
                                  singleEval.gateVerdict,
                                )}`}
                              >
                                {singleEval.gateVerdict}
                              </span>
                            </div>
                          ) : (
                            <span className="inline-flex items-center rounded border border-slate-700/80 bg-slate-800/60 px-2 py-0.5 text-[11px] text-slate-400">
                              待评估
                            </span>
                          )}
                        </td>

                        {/* 6. 操作按钮 */}
                        <td className="px-4 py-3 align-middle whitespace-nowrap text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEnterSystemDetail(sys, 'overview');
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-indigo-500/45 bg-indigo-500/15 px-2.5 py-1 text-xs font-medium text-indigo-200 hover:bg-indigo-500/30 transition cursor-pointer"
                            >
                              <span>查看详情</span>
                              <ArrowRight className="h-3 w-3" />
                            </button>

                            {!sys.builtin && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDeleteSystemDag(sys.systemId);
                                }}
                                disabled={deletingSystemId === sys.systemId || saving}
                                title="删除该自定义评估体系"
                                className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/25 disabled:opacity-50 transition cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span>删除</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      ) : viewMode === 'overview' ? (
        /* ── 视图 1：体系总览表（体系详情页） ── */
        <div className="flex flex-1 flex-col gap-3 overflow-hidden">
          {/* 顶部紧凑总体裁决结论卡 */}
          <div className="rounded-xl border border-[#30363d] bg-[#161b22] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex flex-col">
                  <span className="text-[11px] text-slate-400">
                    生效综合分
                    {targetSide !== 'ALL' ? ` (${targetSide})` : ''}
                  </span>
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={`font-mono text-2xl font-bold tabular-nums ${
                        !evalOutput || evalOutput.overallScore === null
                          ? 'text-slate-400'
                          : evalOutput.gateVerdict === 'DISQUALIFIED'
                            ? 'text-rose-400'
                            : evalOutput.overallScore >= 80
                              ? 'text-emerald-300'
                              : evalOutput.overallScore >= 60
                                ? 'text-indigo-200'
                                : 'text-amber-300'
                      }`}
                    >
                      {evalOutput && evalOutput.overallScore !== null
                        ? evalOutput.overallScore.toFixed(1)
                        : '--'}
                    </span>
                    <span className="font-mono text-xs text-slate-500">/ 100</span>
                  </div>
                </div>

                <div className="h-8 w-px bg-[#30363d]" />

                <div className="flex flex-col">
                  <span className="text-[11px] text-slate-400">原始战术分</span>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-lg font-semibold text-slate-200 tabular-nums">
                      {evalOutput && evalOutput.rawOverallScore !== null
                        ? evalOutput.rawOverallScore.toFixed(1)
                        : '--'}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">
                      权重覆盖{' '}
                      {evalOutput ? `${(evalOutput.availableWeightRatio * 100).toFixed(0)}%` : '--'}
                    </span>
                  </div>
                </div>

                <div className="h-8 w-px bg-[#30363d]" />

                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-slate-400">门控裁决</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] font-bold ${getVerdictBadgeStyle(
                        evalOutput?.gateVerdict,
                      )}`}
                    >
                      {evalOutput?.gateVerdict === 'DISQUALIFIED' ? (
                        <ShieldAlert className="h-3.5 w-3.5" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5" />
                      )}
                      <span>{evalOutput?.gateVerdict ?? 'PENDING'}</span>
                    </span>

                    {evalOutput?.gateAudit?.map((ga) => (
                      <span
                        key={ga.atomId}
                        title={`${ga.name} (${ga.gateMode}): ${ga.displayValue}`}
                        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                          ga.gateStatus === 'violated'
                            ? ga.gateMode === 'hard'
                              ? 'border-rose-500/60 bg-rose-500/20 text-rose-200'
                              : 'border-amber-500/55 bg-amber-500/15 text-amber-200'
                            : ga.gateStatus === 'unavailable'
                              ? 'border-slate-600 bg-slate-800 text-slate-300'
                              : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                        }`}
                      >
                        {ga.name}: {ga.gateStatus === 'violated' ? (ga.gateMode === 'hard' ? 'DISQUALIFIED' : 'WARNING') : ga.gateStatus.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <span className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-0.5 font-mono">
                  节点 {activeSystem.nodes.length} · 边 {activeSystem.edges.length}
                </span>
                <span className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-0.5 font-mono text-emerald-300/90">
                  指标图: {selectedMetricGraphId || activeSystem.metricGraphId || '默认'}
                </span>
              </div>
            </div>

            {/* 若已执行全阵营对比，顶部展示动态阵营总评对比条 */}
            {sideComparison && sideComparison.sides.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-[#30363d]/80 pt-2.5 text-xs">
                <span className="text-[11px] font-medium text-cyan-300">阵营评估对比:</span>
                {sideComparison.sides.map((side, idx) => {
                  const pal = DYNAMIC_SIDE_PALETTES[idx % DYNAMIC_SIDE_PALETTES.length];
                  const sideEval = sideComparison.bySide[side];
                  const isActiveSide = targetSide === side;
                  return (
                    <button
                      key={`summary-side-${side}`}
                      type="button"
                      onClick={() => handleChangeTargetSide(isActiveSide ? 'ALL' : side)}
                      title="点击切换当前切片阵营视图"
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] transition cursor-pointer ${
                        isActiveSide
                          ? 'border-indigo-400 bg-indigo-500/20 text-white shadow-sm'
                          : pal.badge
                      }`}
                    >
                      <span className="font-semibold">{side}</span>
                      <span className="font-bold tabular-nums">
                        {sideEval && sideEval.overallScore !== null
                          ? `${sideEval.overallScore.toFixed(1)}分`
                          : '--'}
                      </span>
                      {sideEval && (
                        <span
                          className={`rounded px-1 py-0 text-[9px] font-bold ${
                            sideEval.gateVerdict === 'DISQUALIFIED'
                              ? 'bg-rose-500/30 text-rose-200'
                              : sideEval.gateVerdict === 'WARNING'
                                ? 'bg-amber-500/30 text-amber-200'
                                : 'bg-emerald-500/20 text-emerald-200'
                          }`}
                        >
                          {sideEval.gateVerdict}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 层次化体系总览表：终态效果 ➔ 能力维度 ➔ 下挂指标/门控（响应式限高内滚动） */}
          <div
            ref={overviewScrollRef}
            onScroll={(e) => {
              savedOverviewScrollTopRef.current = e.currentTarget.scrollTop;
            }}
            className="max-h-[calc(100dvh-240px)] min-h-[380px] overflow-auto rounded-xl border border-[#30363d] bg-[#161b22]"
          >
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-[#30363d] bg-[#0d1117] text-[11px] text-slate-400">
                <tr>
                  <th className="px-3.5 py-2.5 font-medium">节点名称与标识</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">节点类型</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">入边权重</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">聚合策略</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap">门控判定</th>
                  <th className="px-3 py-2.5 font-medium whitespace-nowrap text-right">得分</th>
                  {sideComparison?.sides.map((side, idx) => {
                    const pal = DYNAMIC_SIDE_PALETTES[idx % DYNAMIC_SIDE_PALETTES.length];
                    return (
                      <th
                        key={`th-side-${side}`}
                        className={`px-3 py-2.5 font-medium whitespace-nowrap text-right ${pal.text}`}
                      >
                        {side}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]/60">
                {overviewRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6 + (sideComparison?.sides.length ?? 0)}
                      className="px-4 py-10 text-center text-xs text-slate-500"
                    >
                      当前体系暂无节点，请切换至「画布编排」添加节点
                    </td>
                  </tr>
                ) : (
                  overviewRows.map((row, idx) => {
                    const prevRow = idx > 0 ? overviewRows[idx - 1] : null;
                    const showStandaloneDivider =
                      row.section === 'standalone' && (!prevRow || prevRow.section !== 'standalone');
                    const isProxy =
                      row.node.kind === 'metric_proxy' || row.node.kind === 'metric';
                    const isTerminal =
                      row.section === 'terminal' &&
                      row.node.id === activeSystem.terminalEffectNodeId;
                    const isCollapsed = collapsedRowKeys.has(row.rowKey);
                    const evalRes = evalOutput?.nodeResults?.[row.node.id];
                    const verdict = resolveNodeGateVerdict(
                      row.node,
                      row.effect,
                      evalRes,
                      isTerminal,
                      evalOutput,
                    );
                    const strategyText = isProxy
                      ? `归约: ${String(row.node.params?.reduce ?? 'mean')}`
                      : row.effect?.aggregation?.strategy ?? evalRes?.strategyUsed ?? 'weighted_sum';
                    const weightPct =
                      typeof row.incomingWeight === 'number'
                        ? Math.max(0, Math.min(100, row.incomingWeight * 100))
                        : null;
                    const isSelected = selectedNodeId === row.node.id;

                    return (
                      <React.Fragment key={row.rowKey}>
                        {showStandaloneDivider && (
                          <tr className="bg-[#0d1117]/80">
                            <td
                              colSpan={6 + (sideComparison?.sides.length ?? 0)}
                              className="px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300/90"
                            >
                              独立双轨门控与未挂接终态分支
                            </td>
                          </tr>
                        )}
                        <tr
                          onClick={() => {
                            setSelectedNodeId(row.node.id);
                            setSelectedEdgeId(null);
                            setDrawerTab('basic');
                            setViewMode('canvas');
                          }}
                          title="点击切换至画布编排并高亮选中该节点"
                          className={`cursor-pointer transition hover:bg-[#1b2230] ${
                            isSelected ? 'bg-indigo-950/35' : ''
                          } ${isTerminal ? 'bg-indigo-950/20' : ''}`}
                        >
                          {/* 1. 节点名称 & ID */}
                          <td className="px-3.5 py-2.5 align-middle">
                            <div
                              className="flex items-center gap-1.5"
                              style={{ paddingLeft: `${row.depth * 20}px` }}
                            >
                              {row.hasChildren ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleOverviewRow(row.rowKey);
                                  }}
                                  title={isCollapsed ? '展开子节点' : '折叠子节点'}
                                  className="rounded p-0.5 text-slate-400 hover:bg-[#0d1117] hover:text-white cursor-pointer"
                                >
                                  {isCollapsed ? (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              ) : (
                                <span className="inline-block w-4 text-center text-slate-600">
                                  {row.depth > 0 ? '└' : '•'}
                                </span>
                              )}

                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  {isTerminal && (
                                    <Target className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                                  )}
                                  <span
                                    className={`truncate font-medium ${
                                      isTerminal
                                        ? 'text-indigo-200 font-semibold'
                                        : row.depth === 1
                                          ? 'text-slate-100'
                                          : 'text-slate-200'
                                    }`}
                                  >
                                    {row.node.label || row.effect?.name || row.node.id}
                                  </span>
                                </div>
                                <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-slate-500">
                                  <span>{row.node.id}</span>
                                  {row.node.refId && (
                                    <span className="truncate text-slate-400/80">
                                      ➔ {row.node.refId}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* 2. 节点类型 */}
                          <td className="px-3 py-2.5 align-middle whitespace-nowrap">
                            <span
                              className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${getRoleTagStyle(
                                row.roleTag,
                              )}`}
                            >
                              {row.roleTag}
                            </span>
                          </td>

                          {/* 3. 传入权重进度条 (%) */}
                          <td className="px-3 py-2.5 align-middle whitespace-nowrap">
                            {weightPct !== null ? (
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#0d1117]">
                                  <div
                                    className="h-full rounded-full bg-indigo-400"
                                    style={{ width: `${weightPct}%` }}
                                  />
                                </div>
                                <span className="font-mono text-[11px] text-indigo-200 tabular-nums">
                                  {weightPct.toFixed(1)}%
                                </span>
                              </div>
                            ) : (
                              <span className="font-mono text-[11px] text-slate-500">
                                {isTerminal ? '终态根' : row.section === 'standalone' ? '双轨独立' : '--'}
                              </span>
                            )}
                          </td>

                          {/* 4. 聚合策略 */}
                          <td className="px-3 py-2.5 align-middle whitespace-nowrap font-mono text-[11px] text-slate-300">
                            {strategyText}
                          </td>

                          {/* 5. Gate 状态 / 裁决 */}
                          <td className="px-3 py-2.5 align-middle whitespace-nowrap">
                            <span
                              title={evalRes?.missingDataReason}
                              className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${verdict.cls}`}
                            >
                              {verdict.label}
                            </span>
                          </td>

                          {/* 6. 单次得分 */}
                          <td className="px-3 py-2.5 align-middle whitespace-nowrap text-right font-mono tabular-nums">
                            {evalRes ? (
                              evalRes.score !== null && evalRes.score !== undefined ? (
                                <span
                                  className={`font-semibold ${
                                    evalRes.status === 'unavailable'
                                      ? 'text-rose-300'
                                      : evalRes.score >= 80
                                        ? 'text-emerald-300'
                                        : evalRes.score >= 60
                                          ? 'text-indigo-200'
                                          : 'text-amber-300'
                                  }`}
                                >
                                  {evalRes.score.toFixed(1)}
                                </span>
                              ) : evalRes.rawValue !== undefined && evalRes.rawValue !== null ? (
                                <span className="text-cyan-200">{String(evalRes.rawValue)}</span>
                              ) : (
                                <span className="text-slate-500">--</span>
                              )
                            ) : (
                              <span className="text-slate-500">--</span>
                            )}
                          </td>

                          {/* 7. 动态全阵营对比列 */}
                          {sideComparison?.sides.map((side, sIdx) => {
                            const pal = DYNAMIC_SIDE_PALETTES[sIdx % DYNAMIC_SIDE_PALETTES.length];
                            const sOutput = sideComparison.bySide[side];
                            const sNodeEval = sOutput?.nodeResults?.[row.node.id];
                            const sVerdict = resolveNodeGateVerdict(
                              row.node,
                              row.effect,
                              sNodeEval,
                              isTerminal,
                              sOutput,
                            );
                            return (
                              <td
                                key={`cell-${row.rowKey}-${side}`}
                                title={sNodeEval?.missingDataReason}
                                className="px-3 py-2.5 align-middle whitespace-nowrap text-right font-mono tabular-nums"
                              >
                                <div className="inline-flex items-center justify-end gap-1">
                                  {sNodeEval && sNodeEval.score !== null && sNodeEval.score !== undefined ? (
                                    <span className={`font-semibold ${pal.text}`}>
                                      {sNodeEval.score.toFixed(1)}
                                    </span>
                                  ) : sNodeEval?.rawValue !== undefined && sNodeEval?.rawValue !== null ? (
                                    <span className="text-slate-300">
                                      {String(sNodeEval.rawValue)}
                                    </span>
                                  ) : (
                                    <span className="text-slate-500">--</span>
                                  )}
                                  {(sVerdict.label === 'DISQUALIFIED' ||
                                    sVerdict.label === 'WARNING') && (
                                    <span
                                      className={`rounded border px-1 py-0 text-[9px] font-bold ${sVerdict.cls}`}
                                    >
                                      {sVerdict.label === 'DISQUALIFIED' ? '否决' : '告警'}
                                    </span>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ── 视图 2：画布编排模式 ── */
        <div className="flex flex-1 flex-col gap-2.5 overflow-hidden">
          {/* 精简后的画布顶部结论条（移除重复显示的 activeSystem.name 胶囊） */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#30363d] bg-[#161b22]/90 px-3.5 py-1.5 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] text-slate-400">生效综合分:</span>
                <span
                  className={`font-mono text-base font-bold tabular-nums ${
                    !evalOutput || evalOutput.overallScore === null
                      ? 'text-slate-400'
                      : evalOutput.gateVerdict === 'DISQUALIFIED'
                        ? 'text-rose-400'
                        : evalOutput.overallScore >= 80
                          ? 'text-emerald-300'
                          : evalOutput.overallScore >= 60
                            ? 'text-indigo-200'
                            : 'text-amber-300'
                  }`}
                >
                  {evalOutput && evalOutput.overallScore !== null
                    ? evalOutput.overallScore.toFixed(1)
                    : '--'}
                </span>
                <span className="font-mono text-[10px] text-slate-500">/ 100</span>
              </div>

              <div className="h-4 w-px bg-[#30363d]" />

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-400">原始分:</span>
                <span className="font-mono font-semibold text-slate-200 tabular-nums">
                  {evalOutput && evalOutput.rawOverallScore !== null
                    ? evalOutput.rawOverallScore.toFixed(1)
                    : '--'}
                </span>
              </div>

              <span
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${getVerdictBadgeStyle(
                  evalOutput?.gateVerdict,
                )}`}
              >
                {evalOutput?.gateVerdict === 'DISQUALIFIED' ? (
                  <ShieldAlert className="h-3 w-3" />
                ) : (
                  <ShieldCheck className="h-3 w-3" />
                )}
                <span>GATE: {evalOutput?.gateVerdict ?? 'PENDING'}</span>
              </span>

              <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                覆盖: {evalOutput ? `${(evalOutput.availableWeightRatio * 100).toFixed(0)}%` : '--'}
              </span>
            </div>

            {evalOutput?.gateAudit && evalOutput.gateAudit.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {evalOutput.gateAudit.map((ga) => (
                  <span
                    key={ga.atomId}
                    title={`${ga.name} (${ga.gateMode}): ${ga.displayValue}`}
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                      ga.gateStatus === 'violated'
                        ? ga.gateMode === 'hard'
                          ? 'border-rose-500/60 bg-rose-500/20 text-rose-200'
                          : 'border-amber-500/55 bg-amber-500/15 text-amber-200'
                        : ga.gateStatus === 'unavailable'
                          ? 'border-slate-600 bg-slate-800 text-slate-300'
                          : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                    }`}
                  >
                    {ga.name}: {ga.gateStatus.toUpperCase()}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 主体三段布局：左侧可折叠节点栏 + 中央 DAG 画布 + 右侧 3-Tab 抽屉 */}
          <div className="flex min-h-[580px] flex-1 flex-col gap-3 overflow-hidden lg:flex-row">
            {/* 左侧可折叠窄组件栏 */}
            <aside
              className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22] transition-all duration-200 ${
                paletteCollapsed ? 'w-full lg:w-12 p-1.5 items-center gap-2' : 'w-full lg:w-56'
              }`}
            >
              <div
                className={`flex items-center ${
                  paletteCollapsed
                    ? 'justify-center w-full'
                    : 'justify-between border-b border-[#30363d] bg-[#0d1117]/80 px-2.5 py-2'
                }`}
              >
                {!paletteCollapsed && (
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                    <span className="truncate text-xs font-semibold text-slate-100">
                      体系组件栏
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setPaletteCollapsed((prev) => !prev)}
                  title={paletteCollapsed ? '展开节点栏' : '收起节点栏以扩大画布视野'}
                  className="rounded-lg border border-[#30363d] bg-[#0d1117] p-1 text-slate-400 hover:border-slate-500 hover:text-white transition cursor-pointer"
                >
                  {paletteCollapsed ? (
                    <PanelLeftOpen className="h-3.5 w-3.5" />
                  ) : (
                    <PanelLeftClose className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              {/* 四类快速添加节点：能力维度 / 指标代理 / 门控节点 / 效果合成 */}
              <div
                className={
                  paletteCollapsed
                    ? 'flex flex-row lg:flex-col items-center gap-1.5 w-full justify-center'
                    : 'grid grid-cols-2 lg:grid-cols-1 gap-1.5 border-b border-[#30363d] bg-[#0d1117]/40 p-2'
                }
              >
                {(
                  [
                    {
                      key: 'dimension',
                      title: '能力维度',
                      desc: '多子效果加权聚合维度',
                      icon: Target,
                      cls: 'border-violet-500/35 bg-violet-500/10 text-violet-200 hover:border-violet-400/70',
                      iconCls: 'text-violet-400',
                      onClick: () =>
                        handleAddInlineEffectNode('effect', {
                          namePrefix: '能力维度',
                          defaultX: 720,
                        }),
                    },
                    {
                      key: 'metric_proxy',
                      title: '指标代理',
                      desc: '引入指标计算节点',
                      icon: Layers,
                      cls: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400/70',
                      iconCls: 'text-emerald-400',
                      onClick: handleAddMetricProxyNode,
                    },
                    {
                      key: 'gate',
                      title: '门控节点',
                      desc: '安全红线与状态告警',
                      icon: ShieldAlert,
                      cls: 'border-rose-500/35 bg-rose-500/10 text-rose-200 hover:border-rose-400/70',
                      iconCls: 'text-rose-400',
                      onClick: () =>
                        handleAddInlineEffectNode('gate', {
                          gateMode: 'hard',
                          defaultX: 380,
                        }),
                    },
                    {
                      key: 'effect',
                      title: '效果合成',
                      desc: '独立或复合效果合成节点',
                      icon: Sparkles,
                      cls: 'border-indigo-500/35 bg-indigo-500/10 text-indigo-200 hover:border-indigo-400/70',
                      iconCls: 'text-indigo-400',
                      onClick: () =>
                        handleAddInlineEffectNode('effect', {
                          namePrefix: '效果合成',
                          defaultX: 400,
                        }),
                    },
                  ] as const
                ).map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={item.onClick}
                      title={`${item.title}：${item.desc}（点击添加至画布）`}
                      className={
                        paletteCollapsed
                          ? `flex items-center justify-center rounded-lg border p-2 transition cursor-pointer ${item.cls}`
                          : `flex items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition cursor-pointer ${item.cls}`
                      }
                    >
                      <Icon
                        className={`h-3.5 w-3.5 shrink-0 ${
                          paletteCollapsed ? '' : 'mt-0.5'
                        } ${item.iconCls}`}
                      />
                      {!paletteCollapsed && (
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-100">
                            <Plus className="h-3 w-3 opacity-80" />
                            <span>{item.title}</span>
                          </div>
                          <div className="truncate text-[10px] text-slate-400">{item.desc}</div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* 展开态下保留可搜索独立效果库 */}
              {!paletteCollapsed && (
                <>
                  <div className="space-y-1.5 border-b border-[#30363d] p-2">
                    <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400">
                      <span>独立效果库 ({effects.length})</span>
                    </div>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
                      <input
                        type="text"
                        value={effectSearch}
                        onChange={(e) => setEffectSearch(e.target.value)}
                        placeholder="检索复用效果..."
                        className="w-full rounded border border-[#30363d] bg-[#0d1117] py-1 pl-6 pr-2 text-[11px] text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                    <select
                      value={effectDomainFilter}
                      onChange={(e) => setEffectDomainFilter(e.target.value)}
                      className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-[11px] text-slate-300 focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="all">全部效果与门控</option>
                      <option value="gate">仅安全红线门控 (GATE)</option>
                      <option value="custom">仅自定义复用效果</option>
                      {(Object.keys(DOMAIN_LABELS) as MetricDomainTag[]).map((d) => (
                        <option key={d} value={d}>
                          域 · {DOMAIN_LABELS[d]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                    {filteredEffects.length === 0 ? (
                      <div className="py-6 text-center text-[11px] text-slate-500">
                        暂无匹配的效果组件
                      </div>
                    ) : (
                      filteredEffects.map((eff) => (
                        <div
                          key={eff.effectId}
                          onClick={() => handleAddEffectFromLibrary(eff)}
                          title="点击将该复用效果投入体系画布"
                          className="group rounded-lg border border-[#30363d] bg-[#0d1117] p-2 text-left transition hover:border-indigo-400/60 hover:bg-[#1b2230] cursor-pointer"
                        >
                          <div className="flex items-start justify-between gap-1">
                            <span className="text-[11px] font-semibold text-slate-100 group-hover:text-indigo-200">
                              {eff.name}
                            </span>
                            <div className="flex shrink-0 items-center gap-1">
                              <span
                                className={`rounded border px-1 py-0 font-mono text-[9px] ${
                                  eff.role === 'gate'
                                    ? eff.gateMode === 'hard'
                                      ? 'border-rose-500/45 bg-rose-500/15 text-rose-300'
                                      : 'border-amber-500/45 bg-amber-500/15 text-amber-300'
                                    : eff.isBuiltin
                                      ? 'border-indigo-500/35 bg-indigo-500/10 text-indigo-300'
                                      : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                }`}
                              >
                                {eff.role === 'gate'
                                  ? `GATE·${eff.gateMode === 'hard' ? 'H' : 'S'}`
                                  : eff.isBuiltin
                                    ? '内置'
                                    : '自定义'}
                              </span>
                              {!eff.isBuiltin && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleDeleteCustomEffect(eff.effectId);
                                  }}
                                  title="从效果库删除"
                                  className="rounded p-0.5 text-slate-500 hover:text-rose-400 cursor-pointer"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-1 font-mono text-[9px] text-slate-500">
                            <span className="truncate">{eff.effectId}</span>
                            {eff.domainTag && (
                              <span>{DOMAIN_LABELS[eff.domainTag] ?? eff.domainTag}</span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </aside>

            {/* 中央：V4 通用体系画布 */}
            <div className="flex min-h-[540px] min-w-0 flex-1 flex-col">
              <DagCanvasBoard
                graphKind="system"
                title={`v${activeSystem.version} · ${activeSystem.nodes.length} 节点`}
                nodes={canvasNodes}
                edges={canvasEdges}
                selectedNodeId={selectedNodeId}
                selectedEdgeId={selectedEdgeId}
                showOutline={false}
                outlineSide="right"
                emptyStateText="从左侧组件栏添加能力维度 / 指标代理 / 门控 / 效果节点"
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
                onUpdateEdgeWeight={handleUpdateEdgeWeight}
                onDeleteNode={handleDeleteNode}
                onDeleteEdge={handleDeleteEdge}
                onDrillDown={handleDrillDown}
              />
            </div>

            {/* 右侧抽屉：3-Tab 分栏（基础与权重 | 评分与门控 | 评估证据） */}
            <aside className="flex max-h-[680px] w-full shrink-0 flex-col overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22] lg:w-[400px] xl:w-[430px]">
              <div className="flex items-center justify-between gap-2 border-b border-[#30363d] bg-[#0d1117]/85 px-3.5 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Sliders className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                  <span className="truncate text-xs font-semibold text-slate-100">
                    {selectedNode
                      ? `${selectedNode.label || selectedNode.id}`
                      : selectedEdgeId
                        ? '连线权重属性'
                        : '体系属性检查器'}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {selectedNode && !selectedIsProxy && (
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                        selectedNode.inlineEffect
                          ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                          : 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200'
                      }`}
                    >
                      {selectedNode.inlineEffect ? '私有' : '库引用'}
                    </span>
                  )}

                  {selectedBoundMetricId && onDrillDownToMetric && (
                    <button
                      type="button"
                      onClick={() => onDrillDownToMetric(selectedBoundMetricId)}
                      title={`查看指标：${selectedBoundMetricId}`}
                      className="inline-flex items-center gap-1 rounded border border-emerald-500/45 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-200 hover:bg-emerald-500/25 transition cursor-pointer"
                    >
                      <ArrowDownRight className="h-3 w-3" />
                      <span>下钻指标</span>
                    </button>
                  )}
                </div>
              </div>

              {/* 3-Tab 切换栏 */}
              {selectedNode && (
                <div className="flex border-b border-[#30363d] bg-[#0d1117]/50 px-3 pt-2 gap-1">
                  {(
                    [
                      { id: 'basic' as const, label: '基础与权重' },
                      { id: 'scoring' as const, label: '评分与门控' },
                      { id: 'evidence' as const, label: '评估证据' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setDrawerTab(tab.id)}
                      className={`border-b-2 px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                        drawerTab === tab.id
                          ? 'border-indigo-400 text-indigo-200'
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-3.5 text-xs space-y-3">
                {!selectedNode && selectedEdgeId ? (
                  (() => {
                    const selEdge = activeSystem.edges.find((e) => e.id === selectedEdgeId);
                    if (!selEdge) return null;
                    const srcN = activeSystem.nodes.find((n) => n.id === selEdge.sourceNodeId);
                    const tgtN = activeSystem.nodes.find((n) => n.id === selEdge.targetNodeId);
                    return (
                      <div className="space-y-3 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                        <div className="font-mono text-[11px] text-indigo-300">
                          {srcN?.label || selEdge.sourceNodeId} ➔ {tgtN?.label || selEdge.targetNodeId}
                        </div>
                        <label className="block space-y-1">
                          <span className="text-[11px] text-slate-400">局部权重 (weight)</span>
                          <input
                            type="number"
                            step="0.05"
                            min="0"
                            max="10"
                            value={selEdge.weight ?? ''}
                            placeholder="1.0"
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === '') {
                                setActiveSystem((prev) => ({
                                  ...prev,
                                  edges: prev.edges.map((ed) =>
                                    ed.id === selEdge.id ? { ...ed, weight: undefined } : ed,
                                  ),
                                }));
                                return;
                              }
                              const v = Number.parseFloat(raw);
                              if (Number.isFinite(v) && v >= 0) {
                                handleUpdateEdgeWeight(selEdge.id, Math.round(v * 10000) / 10000);
                              }
                            }}
                            className="w-full rounded border border-[#30363d] bg-[#161b22] px-2.5 py-1.5 font-mono text-xs text-indigo-200"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => handleDeleteEdge(selEdge.id)}
                          className="inline-flex w-full items-center justify-center gap-1 rounded border border-rose-500/45 bg-rose-500/15 px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-500/25 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>删除连线</span>
                        </button>
                      </div>
                    );
                  })()
                ) : !selectedNode ? (
                  <div className="space-y-3 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                    <div className="text-[11px] font-semibold text-indigo-300">
                      体系全局属性（未选中节点）
                    </div>
                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-400">体系 ID (systemId)</span>
                      <input
                        type="text"
                        value={activeSystem.systemId}
                        onChange={(e) =>
                          setActiveSystem((prev) => ({ ...prev, systemId: e.target.value }))
                        }
                        className="w-full rounded border border-[#30363d] bg-[#161b22] px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-400">体系名称 (name)</span>
                      <input
                        type="text"
                        value={activeSystem.name}
                        onChange={(e) =>
                          setActiveSystem((prev) => ({ ...prev, name: e.target.value }))
                        }
                        className="w-full rounded border border-[#30363d] bg-[#161b22] px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-400">终态效果节点</span>
                      <select
                        value={activeSystem.terminalEffectNodeId}
                        onChange={(e) =>
                          setActiveSystem((prev) => ({
                            ...prev,
                            terminalEffectNodeId: e.target.value,
                          }))
                        }
                        className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs text-indigo-200 focus:border-indigo-500 focus:outline-none"
                      >
                        {activeSystem.nodes.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.label} ({n.id})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : drawerTab === 'basic' ? (
                  /* ── Tab 1: 基础与权重 ── */
                  selectedIsProxy ? (
                    <div className="space-y-3">
                      <div className="space-y-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                        <div className="font-semibold text-emerald-300">指标代理绑定</div>
                        <div className="font-mono text-[10px] text-slate-500">
                          节点 ID: {selectedNode.id}
                        </div>
                        <label className="block space-y-1">
                          <span className="text-[11px] text-slate-400">节点标题 (label)</span>
                          <input
                            type="text"
                            value={selectedNode.label}
                            onChange={(e) =>
                              setActiveSystem((prev) => ({
                                ...prev,
                                nodes: prev.nodes.map((n) =>
                                  n.id === selectedNode.id ? { ...n, label: e.target.value } : n,
                                ),
                              }))
                            }
                            className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-[11px] text-slate-400">
                            关联指标标识 (refId)
                          </span>
                          <select
                            value={selectedNode.refId ?? ''}
                            onChange={(e) =>
                              setActiveSystem((prev) => ({
                                ...prev,
                                nodes: prev.nodes.map((n) =>
                                  n.id === selectedNode.id ? { ...n, refId: e.target.value } : n,
                                ),
                              }))
                            }
                            className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                          >
                            <option value="">-- 选择指标 --</option>
                            {availableMetricOptions.map((m) => (
                              <option key={m.metricId} value={m.metricId}>
                                {m.metricId} · {m.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <input
                          type="text"
                          value={selectedNode.refId ?? ''}
                          onChange={(e) =>
                            setActiveSystem((prev) => ({
                              ...prev,
                              nodes: prev.nodes.map((n) =>
                                n.id === selectedNode.id ? { ...n, refId: e.target.value } : n,
                              ),
                            }))
                          }
                          placeholder="或手动输入 metricId"
                          className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 font-mono text-[11px] text-slate-200 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* 节点基础角色与终态设定 */}
                      <div className="space-y-2.5 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] text-slate-500">
                            ID: {selectedNode.id}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setActiveSystem((prev) => ({
                                ...prev,
                                terminalEffectNodeId: selectedNode.id,
                              }))
                            }
                            className={`rounded border px-2 py-0.5 text-[10px] cursor-pointer ${
                              activeSystem.terminalEffectNodeId === selectedNode.id
                                ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200 font-semibold'
                                : 'border-[#30363d] bg-[#161b22] text-slate-400 hover:text-white'
                            }`}
                          >
                            {activeSystem.terminalEffectNodeId === selectedNode.id
                              ? '★ 当前终态节点'
                              : '设为终态输出'}
                          </button>
                        </div>

                        <label className="block space-y-1">
                          <span className="text-[11px] text-slate-400">效果名称 (name)</span>
                          <input
                            type="text"
                            value={selectedNodeEffect?.name ?? selectedNode.label}
                            onChange={(e) =>
                              updateSelectedEffect((cur) => ({ ...cur, name: e.target.value }))
                            }
                            className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                          />
                        </label>

                        <div className="grid grid-cols-2 gap-2">
                          <label className="space-y-1">
                            <span className="text-[11px] text-slate-400">节点角色 (role)</span>
                            <select
                              value={selectedNodeEffect?.role ?? 'effect'}
                              onChange={(e) => {
                                const nextRole = e.target.value as 'effect' | 'gate';
                                updateSelectedEffect((cur) => ({
                                  ...cur,
                                  role: nextRole,
                                  gateMode:
                                    nextRole === 'gate' ? (cur.gateMode ?? 'soft') : undefined,
                                }));
                              }}
                              className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                            >
                              <option value="effect">effect · 效果合成</option>
                              <option value="gate">gate · 红线门控</option>
                            </select>
                          </label>

                          {selectedNodeEffect?.role === 'gate' ? (
                            <label className="space-y-1">
                              <span className="text-[11px] text-slate-400">门控模式</span>
                              <select
                                value={selectedNodeEffect.gateMode ?? 'soft'}
                                onChange={(e) =>
                                  updateSelectedEffect((cur) => ({
                                    ...cur,
                                    gateMode: e.target.value as 'hard' | 'soft',
                                  }))
                                }
                                className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs text-rose-200 focus:border-rose-500 focus:outline-none"
                              >
                                <option value="hard">hard · 红线否决 (上限39分)</option>
                                <option value="soft">soft · 告警提醒 (不封顶)</option>
                              </select>
                            </label>
                          ) : (
                            <label className="space-y-1">
                              <span className="text-[11px] text-slate-400">能力域</span>
                              <select
                                value={selectedNodeEffect?.domainTag ?? 'synergy'}
                                onChange={(e) =>
                                  updateSelectedEffect((cur) => ({
                                    ...cur,
                                    domainTag: e.target.value as MetricDomainTag,
                                  }))
                                }
                                className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                              >
                                {(Object.keys(DOMAIN_LABELS) as MetricDomainTag[]).map((d) => (
                                  <option key={d} value={d}>
                                    {DOMAIN_LABELS[d]} ({d})
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        </div>
                      </div>

                      {/* 入边局部权重编辑 */}
                      <div className="space-y-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-300">
                            <GitBranch className="h-3.5 w-3.5" />
                            <span>入边局部权重 ({selectedIncomingEdges.length})</span>
                          </span>
                          {selectedWeightSummary && selectedIncomingEdges.length > 0 && (
                            <div className="flex items-center gap-1">
                              <span
                                className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
                                  selectedWeightSummary.isBalanced
                                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                    : 'border-amber-500/55 bg-amber-500/15 text-amber-300'
                                }`}
                              >
                                Σw={selectedWeightSummary.sum.toFixed(4)}
                              </span>
                              {!selectedWeightSummary.isBalanced && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActiveSystem((prev) => ({
                                      ...prev,
                                      edges: normalizeTargetIncomingWeights(
                                        prev.edges,
                                        selectedNode.id,
                                      ),
                                    }))
                                  }
                                  className="rounded border border-indigo-500/45 bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-200 hover:bg-indigo-500/30 cursor-pointer"
                                >
                                  归一
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {selectedIncomingEdges.length === 0 ? (
                          <div className="text-[11px] text-slate-500">
                            当前为叶级输入节点，无入边；可在「评分与门控」中绑定上游指标。
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {selectedIncomingEdges.map((edge) => {
                              const srcNode = activeSystem.nodes.find(
                                (n) => n.id === edge.sourceNodeId,
                              );
                              const effWeight = selectedEval?.effectiveWeights?.[edge.id];
                              return (
                                <div
                                  key={edge.id}
                                  className="flex items-center justify-between gap-2 rounded border border-[#30363d]/80 bg-[#161b22] px-2.5 py-1.5"
                                >
                                  <span className="truncate text-[11px] text-slate-200">
                                    {srcNode?.label || edge.sourceNodeId}
                                  </span>
                                  <div className="flex items-center gap-1.5">
                                    {typeof effWeight === 'number' && (
                                      <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                                        实效:{effWeight.toFixed(2)}
                                      </span>
                                    )}
                                    <input
                                      type="number"
                                      step="0.05"
                                      min="0"
                                      max="10"
                                      value={edge.weight ?? 0}
                                      onChange={(e) => {
                                        const v = Number.parseFloat(e.target.value);
                                        if (Number.isFinite(v) && v >= 0) {
                                          handleUpdateEdgeWeight(
                                            edge.id,
                                            Math.round(v * 10000) / 10000,
                                          );
                                        }
                                      }}
                                      className="w-18 rounded border border-[#30363d] bg-[#0d1117] px-1.5 py-0.5 text-right font-mono text-[11px] text-indigo-200 tabular-nums"
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* 模板还原 / 另存为独立复用效果 */}
                      <div className="flex flex-wrap items-center gap-2">
                        {selectedNode.inlineEffect && selectedNode.refId && (
                          <button
                            type="button"
                            onClick={() =>
                              setActiveSystem((prev) => ({
                                ...prev,
                                nodes: prev.nodes.map((n) =>
                                  n.id === selectedNode.id
                                    ? { ...n, inlineEffect: undefined }
                                    : n,
                                ),
                              }))
                            }
                            className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1 text-[11px] text-slate-300 hover:text-white transition cursor-pointer"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>还原为库模板</span>
                          </button>
                        )}

                        {selectedNodeEffect && (
                          <button
                            type="button"
                            onClick={() => {
                              setSaveEffectIdDraft(
                                selectedNodeEffect.isBuiltin
                                  ? `${selectedNodeEffect.effectId}_custom`
                                  : selectedNodeEffect.effectId ||
                                      `eff_custom_${Date.now().toString(36)}`,
                              );
                              setSaveEffectNameDraft(
                                selectedNodeEffect.name || selectedNode.label,
                              );
                              setSaveEffectOpen((prev) => !prev);
                            }}
                            className="inline-flex items-center gap-1 rounded border border-indigo-400/50 bg-indigo-500/15 px-2.5 py-1 text-[11px] font-medium text-indigo-200 hover:bg-indigo-500/25 transition cursor-pointer"
                          >
                            <BookmarkPlus className="h-3.5 w-3.5" />
                            <span>另存为独立复用效果</span>
                          </button>
                        )}
                      </div>

                      {saveEffectOpen && selectedNodeEffect && (
                        <div className="space-y-2 rounded-lg border border-indigo-500/40 bg-indigo-950/30 p-2.5">
                          <div className="text-[11px] font-semibold text-indigo-200">
                            沉淀至独立效果库 (POST /api/v4/effects)
                          </div>
                          <input
                            type="text"
                            value={saveEffectIdDraft}
                            onChange={(e) => setSaveEffectIdDraft(e.target.value)}
                            placeholder="唯一 effectId (如 eff_my_strike)"
                            className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 font-mono text-xs text-slate-100 focus:border-indigo-400 focus:outline-none"
                          />
                          <input
                            type="text"
                            value={saveEffectNameDraft}
                            onChange={(e) => setSaveEffectNameDraft(e.target.value)}
                            placeholder="效果显示名称"
                            className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-slate-100 focus:border-indigo-400 focus:outline-none"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handleSaveAsReusableEffect()}
                              disabled={savingEffect}
                              className="rounded border border-indigo-400 bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
                            >
                              {savingEffect ? '提交中...' : '确认保存'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setSaveEffectOpen(false)}
                              className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                ) : drawerTab === 'scoring' ? (
                  /* ── Tab 2: 评分与门控 ── */
                  selectedIsProxy ? (
                    <div className="space-y-2.5 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                      <div className="font-semibold text-cyan-300">切片与向上游透传参数</div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-1">
                          <span className="text-[11px] text-slate-400">targetField</span>
                          <input
                            type="text"
                            value={String(selectedNode.params?.targetField ?? '')}
                            onChange={(e) =>
                              setActiveSystem((prev) => ({
                                ...prev,
                                nodes: prev.nodes.map((n) =>
                                  n.id === selectedNode.id
                                    ? {
                                        ...n,
                                        params: {
                                          ...(n.params ?? {}),
                                          targetField: e.target.value || undefined,
                                        },
                                      }
                                    : n,
                                ),
                              }))
                            }
                            className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[11px] text-slate-100"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-[11px] text-slate-400">reduce</span>
                          <select
                            value={String(selectedNode.params?.reduce ?? 'mean')}
                            onChange={(e) =>
                              setActiveSystem((prev) => ({
                                ...prev,
                                nodes: prev.nodes.map((n) =>
                                  n.id === selectedNode.id
                                    ? {
                                        ...n,
                                        params: { ...(n.params ?? {}), reduce: e.target.value },
                                      }
                                    : n,
                                ),
                              }))
                            }
                            className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-[11px] text-slate-100"
                          >
                            {REDUCE_OPTIONS.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <label className="block space-y-1">
                        <span className="text-[11px] text-slate-400">paramOverrides (JSON)</span>
                        <textarea
                          rows={3}
                          value={paramOverridesText}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setParamOverridesText(raw);
                            try {
                              const parsed = raw.trim() ? JSON.parse(raw) : {};
                              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                                setParamOverridesErr('必须为 JSON 对象');
                              } else {
                                setParamOverridesErr(null);
                                setActiveSystem((prev) => ({
                                  ...prev,
                                  nodes: prev.nodes.map((n) =>
                                    n.id === selectedNode.id
                                      ? {
                                          ...n,
                                          params: { ...(n.params ?? {}), paramOverrides: parsed },
                                        }
                                      : n,
                                  ),
                                }));
                              }
                            } catch (err) {
                              setParamOverridesErr(
                                err instanceof Error ? err.message : 'JSON 格式错误',
                              );
                            }
                          }}
                          className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[11px] text-amber-200"
                        />
                        {paramOverridesErr && (
                          <span className="text-[10px] text-rose-400">{paramOverridesErr}</span>
                        )}
                      </label>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* 合成与缺数重归一策略 */}
                      <div className="space-y-2.5 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                        <div className="font-semibold text-indigo-300">合成与缺数重归一策略</div>

                        <label className="block space-y-1">
                          <span className="text-[11px] text-slate-400">
                            聚合策略 (aggregation.strategy)
                          </span>
                          <select
                            value={selectedNodeEffect?.aggregation.strategy ?? 'weighted_sum'}
                            onChange={(e) =>
                              updateSelectedEffect((cur) => ({
                                ...cur,
                                aggregation: {
                                  ...cur.aggregation,
                                  strategy: e.target.value as AggregationStrategy,
                                },
                              }))
                            }
                            className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                          >
                            {STRATEGY_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="block space-y-1">
                          <span className="text-[11px] text-slate-400">
                            缺数策略 (aggregation.missingPolicy)
                          </span>
                          <select
                            value={
                              selectedNodeEffect?.aggregation.missingPolicy ?? 'skip_renormalize'
                            }
                            onChange={(e) =>
                              updateSelectedEffect((cur) => ({
                                ...cur,
                                aggregation: {
                                  ...cur.aggregation,
                                  missingPolicy: e.target.value as NodeMissingPolicy,
                                },
                              }))
                            }
                            className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                          >
                            {MISSING_POLICY_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        {selectedNodeEffect?.aggregation.strategy === 'formula' && (
                          <label className="block space-y-1">
                            <span className="text-[11px] text-slate-400">
                              自定义合成公式 (customFormula)
                            </span>
                            <textarea
                              rows={2}
                              value={selectedNodeEffect.aggregation.customFormula ?? ''}
                              onChange={(e) =>
                                updateSelectedEffect((cur) => ({
                                  ...cur,
                                  aggregation: {
                                    ...cur.aggregation,
                                    customFormula: e.target.value,
                                  },
                                }))
                              }
                              placeholder="使用上游节点 ID 或 targetAlias 进行计算"
                              className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[11px] text-indigo-200 focus:border-indigo-500 focus:outline-none"
                            />
                          </label>
                        )}
                      </div>

                      {/* 指标绑定与效用评分规则 / 门控阈值 */}
                      <div className="space-y-2.5 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-emerald-300">
                            指标绑定与效用规则 (metricBinding)
                          </span>
                          <label className="inline-flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(selectedNodeEffect?.metricBinding)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  const defaultId =
                                    availableMetricOptions[0]?.metricId ??
                                    'strike.composite_mission_metrics';
                                  updateSelectedEffect((cur) => ({
                                    ...cur,
                                    metricBinding: {
                                      metricId: defaultId,
                                      reduce: 'mean',
                                      scoringRule: createDefaultScoringRule('larger_is_better'),
                                    },
                                  }));
                                } else {
                                  updateSelectedEffect((cur) => ({
                                    ...cur,
                                    metricBinding: undefined,
                                  }));
                                }
                              }}
                            />
                            <span>启用直连绑定</span>
                          </label>
                        </div>

                        {!selectedNodeEffect?.metricBinding ? (
                          <div className="rounded border border-dashed border-[#30363d] p-3 text-center text-[11px] text-slate-500">
                            当前由上游节点叠加聚合。启用开关可绑定指标、效用评分规则与安全门控。
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            <div className="grid grid-cols-2 gap-1.5">
                              <label className="col-span-2 space-y-0.5">
                                <span className="text-[10px] text-slate-400">
                                  指标标识 (metricId)
                                </span>
                                <div className="flex gap-1">
                                  <select
                                    value={
                                      availableMetricOptions.some(
                                        (m) =>
                                          m.metricId ===
                                          selectedNodeEffect.metricBinding?.metricId,
                                      )
                                        ? selectedNodeEffect.metricBinding.metricId
                                        : '__custom__'
                                    }
                                    onChange={(e) => {
                                      if (e.target.value === '__custom__') return;
                                      updateSelectedEffect((cur) => ({
                                        ...cur,
                                        metricBinding: {
                                          ...cur.metricBinding!,
                                          metricId: e.target.value,
                                        },
                                      }));
                                    }}
                                    className="w-1/2 rounded border border-[#30363d] bg-[#161b22] px-1.5 py-1 text-[11px] text-slate-100"
                                  >
                                    <option value="__custom__">-- 自定义 --</option>
                                    {availableMetricOptions.map((m) => (
                                      <option key={m.metricId} value={m.metricId}>
                                        {m.metricId}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    type="text"
                                    value={selectedNodeEffect.metricBinding.metricId}
                                    onChange={(e) =>
                                      updateSelectedEffect((cur) => ({
                                        ...cur,
                                        metricBinding: {
                                          ...cur.metricBinding!,
                                          metricId: e.target.value,
                                        },
                                      }))
                                    }
                                    className="w-1/2 rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[11px] text-emerald-200"
                                  />
                                </div>
                              </label>

                              <label className="space-y-0.5">
                                <span className="text-[10px] text-slate-400">
                                  目标列 (targetField)
                                </span>
                                <input
                                  type="text"
                                  value={selectedNodeEffect.metricBinding.targetField ?? ''}
                                  onChange={(e) =>
                                    updateSelectedEffect((cur) => ({
                                      ...cur,
                                      metricBinding: {
                                        ...cur.metricBinding!,
                                        targetField: e.target.value || undefined,
                                      },
                                    }))
                                  }
                                  placeholder="自动推断或指定列名"
                                  className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[11px] text-slate-100"
                                />
                              </label>

                              <label className="space-y-0.5">
                                <span className="text-[10px] text-slate-400">归约 (reduce)</span>
                                <select
                                  value={selectedNodeEffect.metricBinding.reduce ?? 'mean'}
                                  onChange={(e) =>
                                    updateSelectedEffect((cur) => ({
                                      ...cur,
                                      metricBinding: {
                                        ...cur.metricBinding!,
                                        reduce: e.target.value as IndicatorReduceMethod,
                                      },
                                    }))
                                  }
                                  className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-[11px] text-slate-100"
                                >
                                  {REDUCE_OPTIONS.map((r) => (
                                    <option key={r} value={r}>
                                      {r}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>

                            {/* 效用映射规则 ScoringRule */}
                            <div className="space-y-1.5 rounded border border-[#30363d] bg-[#161b22] p-2">
                              <label className="block space-y-0.5">
                                <span className="text-[10px] text-slate-400">
                                  效用映射函数 (scoringRule.type)
                                </span>
                                <select
                                  value={selectedNodeEffect.metricBinding.scoringRule.type}
                                  onChange={(e) => {
                                    const nextType = e.target.value as ScoringRule['type'];
                                    updateSelectedEffect((cur) => ({
                                      ...cur,
                                      metricBinding: {
                                        ...cur.metricBinding!,
                                        scoringRule: createDefaultScoringRule(nextType),
                                      },
                                    }));
                                  }}
                                  className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-[11px] text-slate-100"
                                >
                                  {SCORING_TYPE_OPTIONS.map((st) => (
                                    <option key={st.value} value={st.value}>
                                      {st.label}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              {(selectedNodeEffect.metricBinding.scoringRule.type ===
                                'larger_is_better' ||
                                selectedNodeEffect.metricBinding.scoringRule.type ===
                                  'smaller_is_better') && (
                                <div className="grid grid-cols-2 gap-2">
                                  <label className="space-y-0.5">
                                    <span className="text-[10px] text-slate-400">
                                      最优阈值 (optimal)
                                    </span>
                                    <input
                                      type="number"
                                      step="any"
                                      value={
                                        selectedNodeEffect.metricBinding.scoringRule.optimal ?? 1
                                      }
                                      onChange={(e) => {
                                        const val = Number.parseFloat(e.target.value);
                                        if (!Number.isFinite(val)) return;
                                        updateSelectedEffect((cur) => ({
                                          ...cur,
                                          metricBinding: {
                                            ...cur.metricBinding!,
                                            scoringRule: {
                                              ...cur.metricBinding!.scoringRule,
                                              optimal: val,
                                            },
                                          },
                                        }));
                                      }}
                                      className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 font-mono text-[11px] text-emerald-300"
                                    />
                                  </label>
                                  <label className="space-y-0.5">
                                    <span className="text-[10px] text-slate-400">
                                      最差阈值 (worst)
                                    </span>
                                    <input
                                      type="number"
                                      step="any"
                                      value={
                                        selectedNodeEffect.metricBinding.scoringRule.worst ?? 0
                                      }
                                      onChange={(e) => {
                                        const val = Number.parseFloat(e.target.value);
                                        if (!Number.isFinite(val)) return;
                                        updateSelectedEffect((cur) => ({
                                          ...cur,
                                          metricBinding: {
                                            ...cur.metricBinding!,
                                            scoringRule: {
                                              ...cur.metricBinding!.scoringRule,
                                              worst: val,
                                            },
                                          },
                                        }));
                                      }}
                                      className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 font-mono text-[11px] text-rose-300"
                                    />
                                  </label>
                                </div>
                              )}

                              {selectedNodeEffect.metricBinding.scoringRule.type === 'linear' && (
                                <div className="grid grid-cols-2 gap-2">
                                  <label className="space-y-0.5">
                                    <span className="text-[10px] text-slate-400">
                                      下界 bounds[0]
                                    </span>
                                    <input
                                      type="number"
                                      step="any"
                                      value={
                                        selectedNodeEffect.metricBinding.scoringRule.bounds?.[0] ??
                                        0
                                      }
                                      onChange={(e) => {
                                        const val = Number.parseFloat(e.target.value);
                                        if (!Number.isFinite(val)) return;
                                        updateSelectedEffect((cur) => ({
                                          ...cur,
                                          metricBinding: {
                                            ...cur.metricBinding!,
                                            scoringRule: {
                                              ...cur.metricBinding!.scoringRule,
                                              bounds: [
                                                val,
                                                cur.metricBinding!.scoringRule.bounds?.[1] ?? 1,
                                              ],
                                            },
                                          },
                                        }));
                                      }}
                                      className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 font-mono text-[11px]"
                                    />
                                  </label>
                                  <label className="space-y-0.5">
                                    <span className="text-[10px] text-slate-400">
                                      上界 bounds[1]
                                    </span>
                                    <input
                                      type="number"
                                      step="any"
                                      value={
                                        selectedNodeEffect.metricBinding.scoringRule.bounds?.[1] ??
                                        1
                                      }
                                      onChange={(e) => {
                                        const val = Number.parseFloat(e.target.value);
                                        if (!Number.isFinite(val)) return;
                                        updateSelectedEffect((cur) => ({
                                          ...cur,
                                          metricBinding: {
                                            ...cur.metricBinding!,
                                            scoringRule: {
                                              ...cur.metricBinding!.scoringRule,
                                              bounds: [
                                                cur.metricBinding!.scoringRule.bounds?.[0] ?? 0,
                                                val,
                                              ],
                                            },
                                          },
                                        }));
                                      }}
                                      className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 font-mono text-[11px]"
                                    />
                                  </label>
                                </div>
                              )}

                              {selectedNodeEffect.metricBinding.scoringRule.type === 'boolean' && (
                                <div className="grid grid-cols-2 gap-2">
                                  <label className="space-y-0.5">
                                    <span className="text-[10px] text-slate-400">trueScore</span>
                                    <input
                                      type="number"
                                      value={
                                        selectedNodeEffect.metricBinding.scoringRule.trueScore ??
                                        100
                                      }
                                      onChange={(e) => {
                                        const val = Number.parseFloat(e.target.value);
                                        if (!Number.isFinite(val)) return;
                                        updateSelectedEffect((cur) => ({
                                          ...cur,
                                          metricBinding: {
                                            ...cur.metricBinding!,
                                            scoringRule: {
                                              ...cur.metricBinding!.scoringRule,
                                              trueScore: val,
                                            },
                                          },
                                        }));
                                      }}
                                      className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 font-mono text-[11px] text-emerald-300"
                                    />
                                  </label>
                                  <label className="space-y-0.5">
                                    <span className="text-[10px] text-slate-400">falseScore</span>
                                    <input
                                      type="number"
                                      value={
                                        selectedNodeEffect.metricBinding.scoringRule.falseScore ?? 0
                                      }
                                      onChange={(e) => {
                                        const val = Number.parseFloat(e.target.value);
                                        if (!Number.isFinite(val)) return;
                                        updateSelectedEffect((cur) => ({
                                          ...cur,
                                          metricBinding: {
                                            ...cur.metricBinding!,
                                            scoringRule: {
                                              ...cur.metricBinding!.scoringRule,
                                              falseScore: val,
                                            },
                                          },
                                        }));
                                      }}
                                      className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 font-mono text-[11px] text-rose-300"
                                    />
                                  </label>
                                </div>
                              )}

                              {selectedNodeEffect.metricBinding.scoringRule.type ===
                                'target_range' && (
                                <div className="grid grid-cols-2 gap-2">
                                  <label className="space-y-0.5">
                                    <span className="text-[10px] text-slate-400">
                                      最优下限 opt[0]
                                    </span>
                                    <input
                                      type="number"
                                      step="any"
                                      value={
                                        selectedNodeEffect.metricBinding.scoringRule
                                          .optimalRange?.[0] ?? 0.6
                                      }
                                      onChange={(e) => {
                                        const val = Number.parseFloat(e.target.value);
                                        if (!Number.isFinite(val)) return;
                                        updateSelectedEffect((cur) => ({
                                          ...cur,
                                          metricBinding: {
                                            ...cur.metricBinding!,
                                            scoringRule: {
                                              ...cur.metricBinding!.scoringRule,
                                              optimalRange: [
                                                val,
                                                cur.metricBinding!.scoringRule.optimalRange?.[1] ??
                                                  0.9,
                                              ],
                                            },
                                          },
                                        }));
                                      }}
                                      className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 font-mono text-[11px]"
                                    />
                                  </label>
                                  <label className="space-y-0.5">
                                    <span className="text-[10px] text-slate-400">
                                      最优上限 opt[1]
                                    </span>
                                    <input
                                      type="number"
                                      step="any"
                                      value={
                                        selectedNodeEffect.metricBinding.scoringRule
                                          .optimalRange?.[1] ?? 0.9
                                      }
                                      onChange={(e) => {
                                        const val = Number.parseFloat(e.target.value);
                                        if (!Number.isFinite(val)) return;
                                        updateSelectedEffect((cur) => ({
                                          ...cur,
                                          metricBinding: {
                                            ...cur.metricBinding!,
                                            scoringRule: {
                                              ...cur.metricBinding!.scoringRule,
                                              optimalRange: [
                                                cur.metricBinding!.scoringRule.optimalRange?.[0] ??
                                                  0.6,
                                                val,
                                              ],
                                            },
                                          },
                                        }));
                                      }}
                                      className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 font-mono text-[11px]"
                                    />
                                  </label>
                                </div>
                              )}

                              {selectedNodeEffect.metricBinding.scoringRule.type === 'step' && (
                                <div className="space-y-1">
                                  {(selectedNodeEffect.metricBinding.scoringRule.steps ?? []).map(
                                    (st, idx) => (
                                      <div
                                        key={idx}
                                        className="flex items-center gap-1.5 font-mono text-[11px]"
                                      >
                                        <input
                                          type="number"
                                          step="any"
                                          value={st.val}
                                          onChange={(e) => {
                                            const v = Number.parseFloat(e.target.value);
                                            if (!Number.isFinite(v)) return;
                                            updateSelectedEffect((cur) => {
                                              const steps = [
                                                ...(cur.metricBinding!.scoringRule.steps ?? []),
                                              ];
                                              steps[idx] = { ...steps[idx], val: v };
                                              return {
                                                ...cur,
                                                metricBinding: {
                                                  ...cur.metricBinding!,
                                                  scoringRule: {
                                                    ...cur.metricBinding!.scoringRule,
                                                    steps,
                                                  },
                                                },
                                              };
                                            });
                                          }}
                                          className="w-20 rounded border border-[#30363d] bg-[#0d1117] px-1.5 py-0.5"
                                        />
                                        <span className="text-slate-500">➔</span>
                                        <input
                                          type="number"
                                          min="0"
                                          max="100"
                                          value={st.score}
                                          onChange={(e) => {
                                            const sc = Number.parseFloat(e.target.value);
                                            if (!Number.isFinite(sc)) return;
                                            updateSelectedEffect((cur) => {
                                              const steps = [
                                                ...(cur.metricBinding!.scoringRule.steps ?? []),
                                              ];
                                              steps[idx] = { ...steps[idx], score: sc };
                                              return {
                                                ...cur,
                                                metricBinding: {
                                                  ...cur.metricBinding!,
                                                  scoringRule: {
                                                    ...cur.metricBinding!.scoringRule,
                                                    steps,
                                                  },
                                                },
                                              };
                                            });
                                          }}
                                          className="w-20 rounded border border-[#30363d] bg-[#0d1117] px-1.5 py-0.5 text-emerald-300"
                                        />
                                        <span className="text-[10px] text-slate-500">分</span>
                                      </div>
                                    ),
                                  )}
                                </div>
                              )}
                            </div>

                            {/* 门控告警阈值 */}
                            {selectedNodeEffect.role === 'gate' && (
                              <div className="flex flex-wrap items-center gap-1.5 rounded border border-rose-500/30 bg-rose-950/20 px-2.5 py-1.5 text-[10px]">
                                <span className="font-semibold text-rose-300">Gate 红线条件:</span>
                                <select
                                  value={
                                    selectedNodeEffect.metricBinding.alarmThreshold?.operator ?? '>'
                                  }
                                  onChange={(e) =>
                                    updateSelectedEffect((cur) => ({
                                      ...cur,
                                      metricBinding: {
                                        ...cur.metricBinding!,
                                        alarmThreshold: {
                                          operator: e.target.value as AlarmThreshold['operator'],
                                          value: cur.metricBinding!.alarmThreshold?.value ?? 0,
                                          severity:
                                            cur.metricBinding!.alarmThreshold?.severity ?? 'major',
                                          messageTemplate:
                                            cur.metricBinding!.alarmThreshold?.messageTemplate,
                                        },
                                      },
                                    }))
                                  }
                                  className="rounded border border-[#30363d] bg-[#0d1117] px-1.5 py-0.5 font-mono text-rose-200"
                                >
                                  {(['>', '<', '==', '>=', '<='] as const).map((op) => (
                                    <option key={op} value={op}>
                                      {op}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="number"
                                  step="any"
                                  value={selectedNodeEffect.metricBinding.alarmThreshold?.value ?? 0}
                                  onChange={(e) => {
                                    const v = Number.parseFloat(e.target.value);
                                    if (!Number.isFinite(v)) return;
                                    updateSelectedEffect((cur) => ({
                                      ...cur,
                                      metricBinding: {
                                        ...cur.metricBinding!,
                                        alarmThreshold: {
                                          operator:
                                            cur.metricBinding!.alarmThreshold?.operator ?? '>',
                                          value: v,
                                          severity:
                                            cur.metricBinding!.alarmThreshold?.severity ?? 'major',
                                          messageTemplate:
                                            cur.metricBinding!.alarmThreshold?.messageTemplate,
                                        },
                                      },
                                    }));
                                  }}
                                  className="w-20 rounded border border-[#30363d] bg-[#0d1117] px-1.5 py-0.5 font-mono text-rose-200"
                                />
                                <span className="text-slate-400">触发违例</span>
                              </div>
                            )}

                            {/* paramOverrides & sliceFilter */}
                            <div className="space-y-2">
                              <label className="block space-y-0.5">
                                <span className="text-[10px] text-amber-300">
                                  paramOverrides (透传上游阈值 JSON)
                                </span>
                                <textarea
                                  rows={2}
                                  value={paramOverridesText}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    setParamOverridesText(raw);
                                    try {
                                      const parsed = raw.trim() ? JSON.parse(raw) : {};
                                      if (
                                        !parsed ||
                                        typeof parsed !== 'object' ||
                                        Array.isArray(parsed)
                                      ) {
                                        setParamOverridesErr('必须为 JSON 对象');
                                      } else {
                                        setParamOverridesErr(null);
                                        updateSelectedEffect((cur) => ({
                                          ...cur,
                                          metricBinding: {
                                            ...cur.metricBinding!,
                                            paramOverrides:
                                              Object.keys(parsed).length > 0 ? parsed : undefined,
                                          },
                                        }));
                                      }
                                    } catch (err) {
                                      setParamOverridesErr(
                                        err instanceof Error ? err.message : 'JSON 格式错误',
                                      );
                                    }
                                  }}
                                  placeholder='{"damageThreshold": 0.5}'
                                  className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[10px] text-amber-200"
                                />
                                {paramOverridesErr && (
                                  <span className="text-[9px] text-rose-400">
                                    {paramOverridesErr}
                                  </span>
                                )}
                              </label>

                              <label className="block space-y-0.5">
                                <span className="text-[10px] text-slate-400">
                                  sliceFilter (切片 JSON)
                                </span>
                                <textarea
                                  rows={2}
                                  value={sliceFilterText}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    setSliceFilterText(raw);
                                    try {
                                      const parsed = raw.trim() ? JSON.parse(raw) : {};
                                      if (
                                        !parsed ||
                                        typeof parsed !== 'object' ||
                                        Array.isArray(parsed)
                                      ) {
                                        setSliceFilterErr('必须为 JSON 对象');
                                      } else {
                                        setSliceFilterErr(null);
                                        updateSelectedEffect((cur) => ({
                                          ...cur,
                                          metricBinding: {
                                            ...cur.metricBinding!,
                                            sliceFilter:
                                              Object.keys(parsed).length > 0 ? parsed : undefined,
                                          },
                                        }));
                                      }
                                    } catch (err) {
                                      setSliceFilterErr(
                                        err instanceof Error ? err.message : 'JSON 格式错误',
                                      );
                                    }
                                  }}
                                  placeholder='{"MissionName": "..."}'
                                  className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[10px] text-slate-200"
                                />
                                {sliceFilterErr && (
                                  <span className="text-[9px] text-rose-400">{sliceFilterErr}</span>
                                )}
                              </label>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                ) : (
                  /* ── Tab 3: 评估证据 ── */
                  <div className="space-y-3">
                    {selectedEval ? (
                      <>
                        <div className="space-y-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-3 font-mono text-[11px]">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">评估状态:</span>
                            <span
                              className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${getVerdictBadgeStyle(
                                selectedEval.gateStatus === 'violated'
                                  ? selectedEval.gateMode === 'hard'
                                    ? 'DISQUALIFIED'
                                    : 'WARNING'
                                  : selectedEval.status === 'unavailable'
                                    ? undefined
                                    : 'PASS',
                              )}`}
                            >
                              {selectedEval.gateStatus
                                ? `${selectedEval.status.toUpperCase()} · GATE ${selectedEval.gateStatus.toUpperCase()}`
                                : selectedEval.status.toUpperCase()}
                            </span>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">效用评分:</span>
                            <span className="text-sm font-bold text-indigo-200">
                              {selectedEval.score !== null && selectedEval.score !== undefined
                                ? `${selectedEval.score.toFixed(2)} / 100`
                                : '--'}
                            </span>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">可用权重覆盖:</span>
                            <span className="text-slate-200">
                              {(selectedEval.availableWeightRatio * 100).toFixed(1)}%
                            </span>
                          </div>

                          {selectedEval.rawValue !== undefined &&
                            selectedEval.rawValue !== null && (
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400">原始物理读数:</span>
                                <span className="text-emerald-300">
                                  {String(selectedEval.rawValue)}
                                </span>
                              </div>
                            )}

                          {selectedEval.strategyUsed && (
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">合成策略:</span>
                              <span className="text-cyan-200">{selectedEval.strategyUsed}</span>
                            </div>
                          )}

                          {selectedEval.missingDataReason && (
                            <div className="rounded border border-amber-500/40 bg-amber-950/30 p-2 text-[10px] text-amber-200 leading-relaxed">
                              {selectedEval.missingDataReason}
                            </div>
                          )}
                        </div>

                        {/* 全阵营对比节点分值明细 */}
                        {sideComparison && sideComparison.sides.length > 0 && (
                          <div className="space-y-1.5 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                            <div className="text-[11px] font-semibold text-cyan-300">
                              阵营对比得分 ({sideComparison.sides.length} 方)
                            </div>
                            <div className="space-y-1">
                              {sideComparison.sides.map((side, idx) => {
                                const pal =
                                  DYNAMIC_SIDE_PALETTES[idx % DYNAMIC_SIDE_PALETTES.length];
                                const sNode = sideComparison.bySide[side]?.nodeResults?.[selectedNode.id];
                                return (
                                  <div
                                    key={`ev-side-${side}`}
                                    className="flex items-center justify-between rounded border border-[#30363d]/80 bg-[#161b22] px-2.5 py-1 font-mono text-[11px]"
                                  >
                                    <span className={pal.text}>{side}</span>
                                    <span className="font-semibold text-slate-100">
                                      {sNode && sNode.score !== null && sNode.score !== undefined
                                        ? `${sNode.score.toFixed(1)} 分`
                                        : sNode?.rawValue !== undefined && sNode?.rawValue !== null
                                          ? String(sNode.rawValue)
                                          : '--'}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* 证据溯源链 (evidenceRefs) */}
                        <div className="space-y-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-emerald-300">
                              证据溯源链 ({selectedEval.evidenceRefs?.length ?? 0})
                            </span>
                            {selectedBoundMetricId && onDrillDownToMetric && (
                              <button
                                type="button"
                                onClick={() => onDrillDownToMetric(selectedBoundMetricId)}
                                className="inline-flex items-center gap-1 text-[10px] text-emerald-300 hover:underline cursor-pointer"
                              >
                                <span>查看指标 ({selectedBoundMetricId})</span>
                                <ArrowDownRight className="h-3 w-3" />
                              </button>
                            )}
                          </div>

                          {!selectedEval.evidenceRefs || selectedEval.evidenceRefs.length === 0 ? (
                            <div className="text-[11px] text-slate-500">
                              该节点暂无直接底层证据记录（可能为中间合成节点或处于缺数态）。
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              {selectedEval.evidenceRefs.map((ev, idx) => (
                                <div
                                  key={`ev-ref-${idx}`}
                                  className="rounded border border-[#30363d]/80 bg-[#161b22] p-2 text-[11px]"
                                >
                                  <div className="flex items-center justify-between gap-1 font-mono text-[10px] text-slate-400">
                                    <span>
                                      {ev.source} · {String(ev.ref)}
                                    </span>
                                    {ev.scenarioClock && <span>{ev.scenarioClock}</span>}
                                  </div>
                                  <div className="mt-1 text-slate-200">{ev.description}</div>
                                  {ev.snippet && (
                                    <pre className="mt-1 overflow-x-auto rounded bg-[#0d1117] p-1.5 font-mono text-[10px] text-slate-400">
                                      {JSON.stringify(ev.snippet, null, 2)}
                                    </pre>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="rounded-lg border border-dashed border-[#30363d] p-6 text-center text-[11px] text-slate-500">
                        尚未运行评估。点击顶部「运行评估」或「阵营对比」后查看计算结果与证据记录。
                      </div>
                    )}
                  </div>
                )}
              </div>
            </aside>
          </div>
        </div>
      )}

      {/* 二级配置弹窗：上游指标图选择与体系全局属性 */}
      {systemConfigOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSystemConfigOpen(false);
          }}
        >
          <div className="w-full max-w-lg rounded-xl border border-[#30363d] bg-[#161b22] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#30363d] px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Sliders className="h-4 w-4 text-indigo-400" />
                <span>上游指标图与体系配置</span>
              </div>
              <button
                type="button"
                onClick={() => setSystemConfigOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-[#0d1117] hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 p-4 text-xs">
              {metricGraphs.length > 0 && (
                <label className="block space-y-1">
                  <span className="text-[11px] text-slate-400">
                    关联指标图 (metricGraphId)
                  </span>
                  <select
                    value={selectedMetricGraphId}
                    onChange={(e) => {
                      const mgId = e.target.value;
                      setSelectedMetricGraphId(mgId);
                      setActiveSystem((prev) => ({
                        ...prev,
                        metricGraphId: mgId || undefined,
                      }));
                    }}
                    className="w-full rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 text-xs text-emerald-300 focus:border-indigo-500 focus:outline-none"
                  >
                    {metricGraphs.map((mg) => (
                      <option key={mg.graphId} value={mg.graphId}>
                        {mg.name} ({mg.graphId})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">体系 ID (systemId)</span>
                  <input
                    type="text"
                    value={activeSystem.systemId}
                    onChange={(e) =>
                      setActiveSystem((prev) => ({ ...prev, systemId: e.target.value }))
                    }
                    className="w-full rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">版本 (version)</span>
                  <input
                    type="text"
                    value={activeSystem.version}
                    onChange={(e) =>
                      setActiveSystem((prev) => ({ ...prev, version: e.target.value }))
                    }
                    className="w-full rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-[11px] text-slate-400">体系名称 (name)</span>
                <input
                  type="text"
                  value={activeSystem.name}
                  onChange={(e) =>
                    setActiveSystem((prev) => ({ ...prev, name: e.target.value }))
                  }
                  className="w-full rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] text-slate-400">
                  终态综合效能节点 (terminalEffectNodeId)
                </span>
                <select
                  value={activeSystem.terminalEffectNodeId}
                  onChange={(e) =>
                    setActiveSystem((prev) => ({
                      ...prev,
                      terminalEffectNodeId: e.target.value,
                    }))
                  }
                  className="w-full rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 text-xs text-indigo-200 focus:border-indigo-500 focus:outline-none"
                >
                  {activeSystem.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label} ({n.id})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] text-slate-400">体系说明 (description)</span>
                <textarea
                  rows={2}
                  value={activeSystem.description ?? ''}
                  onChange={(e) =>
                    setActiveSystem((prev) => ({ ...prev, description: e.target.value }))
                  }
                  className="w-full rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#30363d] px-4 py-3">
              <button
                type="button"
                onClick={() => setSystemConfigOpen(false)}
                className="rounded-md border border-indigo-500/50 bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 cursor-pointer"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
