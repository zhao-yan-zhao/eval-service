import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  BookmarkPlus,
  CheckCircle2,
  FilePlus2,
  GitBranch,
  Layers,
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
  Target,
  Trash2,
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

interface SystemValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  hasCycle?: boolean;
  cycleNodeIds?: string[];
}

const DOMAIN_LABELS: Record<MetricDomainTag, string> = {
  firepower: '火力打击',
  isr: '侦察预警',
  survivability: '生存防护',
  c2: '指挥控制',
  synergy: '体系协同',
  cost: '战损效费',
};

const STRATEGY_OPTIONS: Array<{ value: AggregationStrategy; label: string }> = [
  { value: 'weighted_sum', label: 'weighted_sum · 加权和' },
  { value: 'weighted_product', label: 'weighted_product · 加权积' },
  { value: 'geometric_mean', label: 'geometric_mean · 几何平均 (短板敏感)' },
  { value: 'maximin', label: 'maximin · 木桶极小值' },
  { value: 'max', label: 'max · 极优值' },
  { value: 'mean', label: 'mean · 算术均值' },
  { value: 'formula', label: 'formula · 自定义公式' },
];

const MISSING_POLICY_OPTIONS: Array<{ value: NodeMissingPolicy; label: string }> = [
  { value: 'skip_renormalize', label: 'skip_renormalize · 跳过并重归一' },
  { value: 'fail', label: 'fail · 严格 Fail-Closed 级联失效' },
  { value: 'worst', label: 'worst · 缺数按 0 分计' },
  { value: 'neutral', label: 'neutral · 缺数按 50 分中性计' },
];

const SCORING_TYPE_OPTIONS: Array<{ value: ScoringRule['type']; label: string }> = [
  { value: 'larger_is_better', label: 'larger_is_better · 越大越好' },
  { value: 'smaller_is_better', label: 'smaller_is_better · 越小越好' },
  { value: 'linear', label: 'linear · 区间线性映射' },
  { value: 'target_range', label: 'target_range · 目标区间最优' },
  { value: 'step', label: 'step · 阶梯分档' },
  { value: 'boolean', label: 'boolean · 布尔达标' },
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
    globalParams: {
      targetSide: '蓝方',
      enemySide: '红方',
    },
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
  const [targetSide, setTargetSide] = useState<string>('红方');

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const [effectSearch, setEffectSearch] = useState('');
  const [effectDomainFilter, setEffectDomainFilter] = useState<string>('all');
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);

  const [loadingInit, setLoadingInit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [evaluating, setEvaluating] = useState(false);

  const [evalOutput, setEvalOutput] = useState<EvaluationDagRunOutputLike | null>(null);
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

      let defaultMgId = '';
      if (mgRes.status === 'fulfilled' && mgRes.value.ok) {
        const mj = (await mgRes.value.json()) as { graphs?: MetricGraphDefinition[] };
        const mList = Array.isArray(mj.graphs) ? mj.graphs : [];
        setMetricGraphs(mList);
        if (mList.length > 0) {
          defaultMgId =
            mList.find((m) => m.graphId === 'mg_v4_metrics_guide_full')?.graphId ??
            mList[0].graphId;
        }
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
        if (sList.length > 0) {
          const targetSys =
            sList.find((s) => s.systemId === 'sys_v4_metrics_guide_full') ?? sList[0];
          setActiveSystem(structuredClone(targetSys));
          setSelectedNodeId(targetSys.terminalEffectNodeId || targetSys.nodes[0]?.id || null);
          const linkedMg = targetSys.metricGraphId || defaultMgId;
          if (linkedMg) setSelectedMetricGraphId((prev) => prev || linkedMg);
        } else {
          const draft = createDraftSystemDag(1);
          setActiveSystem(draft);
          setSelectedNodeId(draft.terminalEffectNodeId);
          if (defaultMgId) setSelectedMetricGraphId((prev) => prev || defaultMgId);
        }
      } else {
        const draft = createDraftSystemDag(1);
        setSystems([]);
        setActiveSystem(draft);
        setSelectedNodeId(draft.terminalEffectNodeId);
        if (defaultMgId) setSelectedMetricGraphId((prev) => prev || defaultMgId);
        setBanner({
          kind: 'warn',
          text: '后端体系 DAG 接口暂未返回持久化模型，已加载可编辑草案',
        });
      }
    } finally {
      setLoadingInit(false);
    }
  }, []);

  useEffect(() => {
    void loadAllAssets();
  }, [loadAllAssets]);

  const effectMap = useMemo(
    () => new Map(effects.map((e) => [e.effectId, e])),
    [effects],
  );

  // 按照领域标签 (firepower, isr, survivability, synergy) 汇总领域综合效能得分
  const domainCompositeScores = useMemo(() => {
    if (!evalOutput?.nodeResults) return [];
    const domains: Array<{ tag: MetricDomainTag; label: string; score: number | null }> = [
      { tag: 'firepower', label: '火力打击', score: null },
      { tag: 'isr', label: '侦察预警', score: null },
      { tag: 'survivability', label: '生存防护', score: null },
      { tag: 'synergy', label: '体系协同', score: null },
    ];
    for (const d of domains) {
      const scores: number[] = [];
      for (const n of activeSystem.nodes) {
        const eff = n.inlineEffect ?? (n.refId ? effectMap.get(n.refId) : undefined);
        const tag = eff?.domainTag;
        if (tag === d.tag) {
          const res = evalOutput.nodeResults[n.id];
          if (res && res.score !== null && res.score !== undefined && res.status !== 'unavailable') {
            scores.push(res.score);
          }
        }
      }
      if (scores.length > 0) {
        d.score = scores.reduce((a, b) => a + b, 0) / scores.length;
      }
    }
    return domains;
  }, [evalOutput, activeSystem.nodes, effectMap]);

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
    () => (activeSystem.nodes.find((n) => n.id === selectedNodeId) as SystemDagNode | undefined) ?? null,
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

  // 从效果库拖入/点击添加到画布
  const handleAddEffectFromLibrary = useCallback(
    (eff: EffectDefinition) => {
      const idx = activeSystem.nodes.length + 1;
      const nodeId = `sn_${eff.effectId.replace(/[^a-zA-Z0-9_]/g, '_')}_${Date.now().toString(36).slice(-3)}`;
      const pos = {
        x: 340 + ((idx % 3) * 290),
        y: 80 + (Math.floor(idx / 3) * 170),
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
    },
    [activeSystem.nodes.length],
  );

  // 原地新建效果节点 / 门控节点 (inlineEffect)
  const handleAddInlineEffectNode = useCallback(
    (role: 'effect' | 'gate', gateMode: 'hard' | 'soft' = 'soft') => {
      const idx = activeSystem.nodes.length + 1;
      const uid = Date.now().toString(36).slice(-4);
      const nodeId = role === 'gate' ? `sn_gate_${uid}` : `sn_eff_${uid}`;
      const defaultMetric = availableMetricOptions[0]?.metricId;
      const inlineDef: EffectDefinition = {
        effectId: `eff_inline_${uid}`,
        name:
          role === 'gate'
            ? gateMode === 'hard'
              ? `原地硬门控 ${idx}`
              : `原地软门控 ${idx}`
            : `原地效果节点 ${idx}`,
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
          x: 420 + ((idx % 3) * 240),
          y: 90 + (Math.floor(idx / 3) * 165),
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
        y: 80 + ((idx % 4) * 165),
      },
    };
    setActiveSystem((prev) => ({
      ...prev,
      nodes: [...prev.nodes, newNode],
    }));
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
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

      // 将当前节点同步绑定为引用该复用效果
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
      const res = await fetch('/api/v4/system-dags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activeSystem),
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

      const savedSys = json.system ?? json.dag ?? activeSystem;
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
  }, [activeSystem]);

  const handleDeleteSystemDag = useCallback(async () => {
    const sid = activeSystem.systemId;
    if (!sid) return;
    setSaving(true);
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
      if (remaining.length > 0) {
        setActiveSystem(structuredClone(remaining[0]));
        setSelectedNodeId(remaining[0].terminalEffectNodeId || remaining[0].nodes[0]?.id || null);
      } else {
        const draft = createDraftSystemDag(1);
        setActiveSystem(draft);
        setSelectedNodeId(draft.terminalEffectNodeId);
      }
      setEvalOutput(null);
      setBanner({ kind: 'info', text: `已删除体系 DAG: ${sid}` });
    } catch (err) {
      setBanner({
        kind: 'error',
        text: `删除失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSaving(false);
    }
  }, [activeSystem.systemId, systems]);

  // 全链路评估
  const handleEvaluateSystemDag = useCallback(async () => {
    setEvaluating(true);
    setBanner(null);
    try {
      const res = await fetch('/api/v4/system-dags/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: activeSystem,
          ...(selectedMetricGraphId ? { metricGraphId: selectedMetricGraphId } : {}),
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

      if (evaluation.gateVerdict === 'DISQUALIFIED') {
        setBanner({
          kind: 'error',
          text: `硬红线门控触发 DISQUALIFIED！生效总分已封顶至 ${
            evaluation.overallScore !== null ? evaluation.overallScore.toFixed(1) : '--'
          }（原始分 ${
            evaluation.rawOverallScore !== null ? evaluation.rawOverallScore.toFixed(1) : '--'
          }）`,
        });
      } else if (evaluation.gateVerdict === 'WARNING') {
        setBanner({
          kind: 'warn',
          text: `全链路评估完成（触发软红线 WARNING 告警）：综合效能 ${
            evaluation.overallScore !== null ? evaluation.overallScore.toFixed(1) : '--'
          } 分`,
        });
      } else {
        setBanner({
          kind: 'info',
          text: `全链路评估完成：综合效能 ${
            evaluation.overallScore !== null ? evaluation.overallScore.toFixed(1) : '缺数 (N/A)'
          } 分，安全门控 PASS`,
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
  }, [activeSystem, selectedMetricGraphId, selectedRunId, activeSourceId]);

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
      if (evaluating) {
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
  }, [activeSystem.nodes, activeSystem.terminalEffectNodeId, effectMap, evalOutput, evaluating]);

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

  return (
    <div className="flex h-full min-h-[820px] flex-col gap-3 rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-slate-100">
      {/* 顶部控制栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#30363d] bg-[#161b22] px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1 text-xs font-semibold text-indigo-300">
            <Scale className="h-3.5 w-3.5" />
            <span>三库 · 效果合成与体系 DAG 工坊</span>
          </div>

          <select
            value={
              systems.some((s) => s.systemId === activeSystem.systemId)
                ? activeSystem.systemId
                : '__draft__'
            }
            onChange={(e) => {
              const target = systems.find((s) => s.systemId === e.target.value);
              if (target) {
                setActiveSystem(structuredClone(target));
                setSelectedNodeId(target.terminalEffectNodeId || target.nodes[0]?.id || null);
                setSelectedEdgeId(null);
                setEvalOutput(null);
                setValidationReport(null);
                if (target.metricGraphId) {
                  setSelectedMetricGraphId(target.metricGraphId);
                }
              }
            }}
            className="max-w-[240px] rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
          >
            {!systems.some((s) => s.systemId === activeSystem.systemId) && (
              <option value="__draft__">{activeSystem.name} (未保存草案)</option>
            )}
            {systems.map((s) => (
              <option key={s.systemId} value={s.systemId}>
                {s.name} ({s.systemId}){s.builtin ? ' [内置]' : ''}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              const draft = createDraftSystemDag(systems.length + 1);
              setActiveSystem(draft);
              setSelectedNodeId(draft.terminalEffectNodeId);
              setSelectedEdgeId(null);
              setEvalOutput(null);
              setValidationReport(null);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1 text-xs text-slate-200 hover:border-slate-500 transition cursor-pointer"
          >
            <FilePlus2 className="h-3.5 w-3.5 text-indigo-400" />
            <span>新建</span>
          </button>

          <button
            type="button"
            onClick={() => void handleSaveSystemDag()}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1 text-xs font-medium text-indigo-200 hover:bg-indigo-500/25 disabled:opacity-50 transition cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{saving ? '保存中...' : '保存体系'}</span>
          </button>

          {systems.some((s) => s.systemId === activeSystem.systemId && !s.builtin) && (
            <button
              type="button"
              onClick={() => void handleDeleteSystemDag()}
              disabled={saving}
              title="删除自定义体系 DAG"
              className="rounded-md border border-[#30363d] bg-[#0d1117] p-1.5 text-slate-400 hover:border-rose-500/50 hover:text-rose-300 transition cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => void loadAllAssets()}
            disabled={loadingInit}
            title="刷新效果库、指标图与体系库"
            className="rounded-md border border-[#30363d] bg-[#0d1117] p-1.5 text-slate-400 hover:text-slate-100 transition cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingInit ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {metricGraphs.length > 0 && (
            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span>上游指标图:</span>
              <select
                value={selectedMetricGraphId}
                onChange={(e) => {
                  const mgId = e.target.value;
                  setSelectedMetricGraphId(mgId);
                  setActiveSystem((prev) => ({ ...prev, metricGraphId: mgId || undefined }));
                }}
                className="max-w-[170px] rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-emerald-300 focus:border-indigo-500 focus:outline-none"
              >
                {metricGraphs.map((mg) => (
                  <option key={mg.graphId} value={mg.graphId}>
                    {mg.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span>评估阵营:</span>
            <select
              value={targetSide}
              onChange={(e) => setTargetSide(e.target.value)}
              className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-indigo-300 focus:border-indigo-500 focus:outline-none"
            >
              <option value="红方">红方 (Red)</option>
              <option value="绿方">绿方 (Green)</option>
              <option value="蓝方">蓝方 (Blue)</option>
              <option value="ALL">全部阵营 (ALL)</option>
            </select>
          </label>

          <button
            type="button"
            onClick={() => void handleValidateAndNormalize()}
            disabled={validating}
            className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/45 bg-cyan-500/15 px-2.5 py-1 text-xs font-medium text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50 transition cursor-pointer"
          >
            <Scale className="h-3.5 w-3.5" />
            <span>{validating ? '校验中...' : '校验 & 权重自动归一'}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleEvaluateSystemDag()}
            disabled={evaluating || activeSystem.nodes.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-indigo-400/60 bg-indigo-600 px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-indigo-950/60 hover:bg-indigo-500 disabled:opacity-50 transition cursor-pointer"
          >
            <Play className="h-3.5 w-3.5" />
            <span>{evaluating ? '评估中...' : '▶ 全链路评估'}</span>
          </button>
        </div>
      </div>

      {/* 终态总分 & 双轨门控裁决横幅 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#30363d] bg-[#161b22]/90 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1 text-xs font-semibold text-indigo-300">
            <span>{activeSystem.name}</span>
            <span className="font-mono text-[10px] text-indigo-400">({activeSystem.systemId})</span>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-[11px] uppercase tracking-wider text-slate-400">
              生效综合效能 (overallScore):
            </span>
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

          <div className="h-6 w-px bg-[#30363d]" />

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400">原始战术分 (rawOverallScore):</span>
            <span className="font-mono font-semibold text-slate-200 tabular-nums">
              {evalOutput && evalOutput.rawOverallScore !== null
                ? evalOutput.rawOverallScore.toFixed(1)
                : '--'}
            </span>

            <span
              className={`ml-1 inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] font-bold ${
                !evalOutput
                  ? 'border-slate-700 bg-slate-800/80 text-slate-400'
                  : evalOutput.gateVerdict === 'DISQUALIFIED'
                    ? 'border-rose-500/60 bg-rose-500/20 text-rose-200'
                    : evalOutput.gateVerdict === 'WARNING'
                      ? 'border-amber-500/55 bg-amber-500/20 text-amber-200'
                      : 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300'
              }`}
            >
              {evalOutput?.gateVerdict === 'DISQUALIFIED' ? (
                <ShieldAlert className="h-3.5 w-3.5" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" />
              )}
              <span>GATE: {evalOutput?.gateVerdict ?? 'PENDING'}</span>
            </span>

            <span className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-0.5 font-mono text-[11px] text-slate-300 tabular-nums">
              可用权重覆盖 (availableWeightRatio):{' '}
              {evalOutput ? `${(evalOutput.availableWeightRatio * 100).toFixed(1)}%` : '--'}
            </span>

            {domainCompositeScores.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 ml-1 border-l border-[#30363d] pl-2">
                <span className="text-slate-400 text-[11px]">领域效能:</span>
                {domainCompositeScores.map((d) => (
                  <span
                    key={d.tag}
                    className="inline-flex items-center gap-1 rounded bg-[#0d1117] px-2 py-0.5 text-[11px] font-mono border border-[#30363d]"
                  >
                    <span className="text-slate-400">{d.label}:</span>
                    <strong
                      className={
                        d.score === null
                          ? 'text-slate-500'
                          : d.score >= 80
                            ? 'text-emerald-300'
                            : d.score >= 60
                              ? 'text-indigo-300'
                              : 'text-amber-300'
                      }
                    >
                      {d.score !== null ? `${d.score.toFixed(1)}分` : '--'}
                    </strong>
                  </span>
                ))}
              </div>
            )}

            {evalOutput?.resolvedParamOverrides &&
              Object.keys(evalOutput.resolvedParamOverrides).length > 0 && (
                <span
                  title={JSON.stringify(evalOutput.resolvedParamOverrides, null, 2)}
                  className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-200"
                >
                  透传阈值覆盖: {Object.keys(evalOutput.resolvedParamOverrides).length} 项
                </span>
              )}
          </div>
        </div>

        {/* 右侧：门控审计摘要 & 终态节点选择器 */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
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

          <label className="flex items-center gap-1.5 text-slate-400">
            <Target className="h-3.5 w-3.5 text-indigo-400" />
            <span>终态节点:</span>
            <select
              value={activeSystem.terminalEffectNodeId}
              onChange={(e) =>
                setActiveSystem((prev) => ({ ...prev, terminalEffectNodeId: e.target.value }))
              }
              className="max-w-[170px] rounded border border-[#30363d] bg-[#0d1117] px-2 py-0.5 text-[11px] text-indigo-200 focus:border-indigo-400 focus:outline-none"
            >
              {activeSystem.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label} ({n.id})
                </option>
              ))}
            </select>
          </label>
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

      {validationReport && (!validationReport.valid || validationReport.warnings.length > 0) && (
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

      {/* 主体区：左侧独立效果库面板 + 中央交互 DAG 画布（含右侧同步权重矩阵大纲） */}
      <div className="flex min-h-[500px] flex-1 gap-3 overflow-hidden">
        {/* 左侧：独立效果库面板 (Effect Library Palette) */}
        <aside
          className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22] transition-all ${
            paletteCollapsed ? 'w-11' : 'w-68'
          }`}
        >
          <div className="flex items-center justify-between border-b border-[#30363d] bg-[#0d1117]/80 px-2.5 py-2">
            {!paletteCollapsed && (
              <div className="flex items-center gap-1.5 min-w-0">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                <span className="truncate text-xs font-semibold text-slate-100">
                  独立效果库 ({effects.length})
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setPaletteCollapsed((prev) => !prev)}
              title={paletteCollapsed ? '展开效果库面板' : '收起效果库面板'}
              className="rounded border border-[#30363d] bg-[#161b22] px-1.5 py-0.5 text-[10px] text-slate-300 hover:text-white cursor-pointer"
            >
              {paletteCollapsed ? '»' : '«'}
            </button>
          </div>

          {!paletteCollapsed && (
            <>
              {/* 原地新建效果 / 门控 / 指标代理快捷栏 */}
              <div className="space-y-1.5 border-b border-[#30363d] bg-[#0d1117]/50 p-2.5">
                <button
                  type="button"
                  onClick={() => handleAddInlineEffectNode('effect')}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-indigo-500/45 bg-indigo-500/15 px-2.5 py-1.5 text-xs font-medium text-indigo-200 hover:bg-indigo-500/25 transition cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>原地新建效果节点 (inlineEffect)</span>
                </button>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleAddInlineEffectNode('gate', 'hard')}
                    className="inline-flex items-center justify-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-500/20 transition cursor-pointer"
                  >
                    <ShieldAlert className="h-3 w-3" />
                    <span>+ 硬门控</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddInlineEffectNode('gate', 'soft')}
                    className="inline-flex items-center justify-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-500/20 transition cursor-pointer"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    <span>+ 软门控</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleAddMetricProxyNode}
                  className="flex w-full items-center justify-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/20 transition cursor-pointer"
                >
                  <Layers className="h-3 w-3" />
                  <span>+ 指标代理节点 (metric_proxy)</span>
                </button>
              </div>

              {/* 搜索与能力域筛选 */}
              <div className="space-y-1.5 border-b border-[#30363d] p-2.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={effectSearch}
                    onChange={(e) => setEffectSearch(e.target.value)}
                    placeholder="检索复用效果..."
                    className="w-full rounded border border-[#30363d] bg-[#0d1117] py-1 pl-7 pr-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
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

              {/* 效果库卡片列表（点击添加到画布） */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {filteredEffects.length === 0 ? (
                  <div className="py-8 text-center text-[11px] text-slate-500">
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
                      <div className="flex items-start justify-between gap-1.5">
                        <span className="text-xs font-semibold text-slate-100 group-hover:text-indigo-200">
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
                        {eff.domainTag && <span>{DOMAIN_LABELS[eff.domainTag] ?? eff.domainTag}</span>}
                      </div>
                      {eff.metricBinding?.metricId && (
                        <div className="mt-1 truncate font-mono text-[10px] text-emerald-300/80">
                          指标: {eff.metricBinding.metricId}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </aside>

        {/* 中央：V4 通用体系画布（自带 DagOutlineSidebar 同步局部权重矩阵 Σw = 1.00） */}
        <div className="flex-1 min-w-0 flex flex-col min-h-[500px]">
          <DagCanvasBoard
            graphKind="system"
            title={`${activeSystem.name} (v${activeSystem.version})`}
            nodes={canvasNodes}
            edges={canvasEdges}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            showOutline={true}
            outlineSide="right"
            emptyStateText="从左侧效果库点击投入效果节点，或创建原地效果 / 指标代理节点"
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
      </div>

      {/* 底部：选中节点属性与人工考核/效用规则/权重编辑器 */}
      <section className="rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#30363d] bg-[#0d1117]/85 px-3.5 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Sliders className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
            <span className="truncate text-xs font-semibold text-slate-100">
              {selectedNode
                ? `节点检查器 · ${selectedNode.label} (${selectedNode.id})`
                : '体系全局属性与检查器'}
            </span>
            {selectedNode && !selectedIsProxy && (
              <span
                className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                  selectedNode.inlineEffect
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                    : 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200'
                }`}
              >
                {selectedNode.inlineEffect
                  ? '画布私有 (inlineEffect)'
                  : `库引用 (${selectedNode.refId})`}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedBoundMetricId && onDrillDownToMetric && (
              <button
                type="button"
                onClick={() => onDrillDownToMetric(selectedBoundMetricId)}
                className="inline-flex items-center gap-1 rounded border border-emerald-500/45 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/25 transition cursor-pointer"
              >
                <ArrowDownRight className="h-3.5 w-3.5" />
                <span>下钻指标 ({selectedBoundMetricId})</span>
              </button>
            )}

            {selectedNode && !selectedIsProxy && selectedNode.inlineEffect && selectedNode.refId && (
              <button
                type="button"
                onClick={() =>
                  setActiveSystem((prev) => ({
                    ...prev,
                    nodes: prev.nodes.map((n) =>
                      n.id === selectedNode.id ? { ...n, inlineEffect: undefined } : n,
                    ),
                  }))
                }
                className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-[11px] text-slate-300 hover:text-white transition cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                <span>还原为库模板</span>
              </button>
            )}

            {selectedNode && !selectedIsProxy && selectedNodeEffect && (
              <button
                type="button"
                onClick={() => {
                  setSaveEffectIdDraft(
                    selectedNodeEffect.isBuiltin
                      ? `${selectedNodeEffect.effectId}_custom`
                      : selectedNodeEffect.effectId || `eff_custom_${Date.now().toString(36)}`,
                  );
                  setSaveEffectNameDraft(selectedNodeEffect.name || selectedNode.label);
                  setSaveEffectOpen((prev) => !prev);
                }}
                className="inline-flex items-center gap-1 rounded border border-indigo-400/50 bg-indigo-500/20 px-2.5 py-1 text-[11px] font-medium text-indigo-200 hover:bg-indigo-500/30 transition cursor-pointer"
              >
                <BookmarkPlus className="h-3.5 w-3.5" />
                <span>另存为独立复用效果</span>
              </button>
            )}
          </div>
        </div>

        {/* 另存为独立复用效果确认条 */}
        {saveEffectOpen && selectedNodeEffect && (
          <div className="flex flex-wrap items-center gap-2 border-b border-indigo-500/35 bg-indigo-950/35 px-3.5 py-2 text-xs">
            <span className="font-semibold text-indigo-200">沉淀至独立效果库 (POST /api/v4/effects):</span>
            <input
              type="text"
              value={saveEffectIdDraft}
              onChange={(e) => setSaveEffectIdDraft(e.target.value)}
              placeholder="唯一 effectId (如 eff_my_strike)"
              className="w-52 rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 font-mono text-xs text-slate-100 focus:border-indigo-400 focus:outline-none"
            />
            <input
              type="text"
              value={saveEffectNameDraft}
              onChange={(e) => setSaveEffectNameDraft(e.target.value)}
              placeholder="效果显示名称"
              className="w-52 rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-slate-100 focus:border-indigo-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleSaveAsReusableEffect()}
              disabled={savingEffect}
              className="rounded border border-indigo-400 bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
            >
              {savingEffect ? '提交中...' : '确认保存到效果库'}
            </button>
            <button
              type="button"
              onClick={() => setSaveEffectOpen(false)}
              className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              取消
            </button>
          </div>
        )}

        <div className="p-3.5 text-xs">
          {!selectedNode && selectedEdgeId ? (
            (() => {
              const selEdge = activeSystem.edges.find((e) => e.id === selectedEdgeId);
              if (!selEdge) return null;
              const srcN = activeSystem.nodes.find((n) => n.id === selEdge.sourceNodeId);
              const tgtN = activeSystem.nodes.find((n) => n.id === selEdge.targetNodeId);
              return (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                  <span className="font-mono text-indigo-300">
                    连线: {srcN?.label || selEdge.sourceNodeId} ➔ {tgtN?.label || selEdge.targetNodeId}
                  </span>
                  <label className="flex items-center gap-1.5">
                    <span className="text-slate-400">局部权重 (weight):</span>
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
                      className="w-24 rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-xs text-indigo-200"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => handleDeleteEdge(selEdge.id)}
                    className="inline-flex items-center gap-1 rounded border border-rose-500/45 bg-rose-500/15 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/25 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>删除连线</span>
                  </button>
                </div>
              );
            })()
          ) : !selectedNode ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">体系 ID (systemId)</span>
                <input
                  type="text"
                  value={activeSystem.systemId}
                  onChange={(e) =>
                    setActiveSystem((prev) => ({ ...prev, systemId: e.target.value }))
                  }
                  className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-slate-400">体系名称 (name)</span>
                <input
                  type="text"
                  value={activeSystem.name}
                  onChange={(e) => setActiveSystem((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
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
                  className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 font-mono text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                />
              </label>
            </div>
          ) : selectedIsProxy ? (
            /* ── 指标代理节点 (metric_proxy) 编辑面板 ── */
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div className="space-y-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                <div className="font-semibold text-emerald-300">指标代理绑定</div>
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
                    className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] text-slate-400">关联二库 metricId (refId)</span>
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
                    className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="">-- 选择二库指标 --</option>
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
                  className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[11px] text-slate-200 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="space-y-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
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
                    rows={2}
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
                        setParamOverridesErr(err instanceof Error ? err.message : 'JSON 格式错误');
                      }
                    }}
                    className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[11px] text-amber-200"
                  />
                  {paramOverridesErr && (
                    <span className="text-[10px] text-rose-400">{paramOverridesErr}</span>
                  )}
                </label>
              </div>

              <div className="space-y-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                <div className="font-semibold text-slate-300">评估读数与状态</div>
                {selectedEval ? (
                  <div className="space-y-1.5 font-mono text-[11px]">
                    <div>状态: {selectedEval.status}</div>
                    <div>原始客观值: {String(selectedEval.rawValue ?? '--')}</div>
                    {selectedEval.missingDataReason && (
                      <div className="text-rose-300">{selectedEval.missingDataReason}</div>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500">
                    点击右上角 [▶ 全链路评估] 获取该指标代理的实时读数。
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ── 效果 / 门控节点三栏深度编辑器 ── */
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {/* 第 1 栏：角色、门控模式、入边局部权重编辑 */}
              <div className="space-y-2.5 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-indigo-300">1. 效果角色与入边权重</span>
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

                <div className="grid grid-cols-2 gap-2">
                  <label className="col-span-2 space-y-1">
                    <span className="text-[11px] text-slate-400">效果名称 (name)</span>
                    <input
                      type="text"
                      value={selectedNodeEffect?.name ?? selectedNode.label}
                      onChange={(e) =>
                        updateSelectedEffect((cur) => ({ ...cur, name: e.target.value }))
                      }
                      className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">节点角色 (role)</span>
                    <select
                      value={selectedNodeEffect?.role ?? 'effect'}
                      onChange={(e) => {
                        const nextRole = e.target.value as 'effect' | 'gate';
                        updateSelectedEffect((cur) => ({
                          ...cur,
                          role: nextRole,
                          gateMode: nextRole === 'gate' ? (cur.gateMode ?? 'soft') : undefined,
                        }));
                      }}
                      className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="effect">effect · 效果合成节点</option>
                      <option value="gate">gate · 安全红线门控</option>
                    </select>
                  </label>

                  {selectedNodeEffect?.role === 'gate' ? (
                    <label className="space-y-1">
                      <span className="text-[11px] text-slate-400">门控模式 (gateMode)</span>
                      <select
                        value={selectedNodeEffect.gateMode ?? 'soft'}
                        onChange={(e) =>
                          updateSelectedEffect((cur) => ({
                            ...cur,
                            gateMode: e.target.value as 'hard' | 'soft',
                          }))
                        }
                        className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-rose-200 focus:border-rose-500 focus:outline-none"
                      >
                        <option value="hard">hard · 一票否决封顶 ≤39</option>
                        <option value="soft">soft · 告警不封顶</option>
                      </select>
                    </label>
                  ) : (
                    <label className="space-y-1">
                      <span className="text-[11px] text-slate-400">能力域 (domainTag)</span>
                      <select
                        value={selectedNodeEffect?.domainTag ?? 'synergy'}
                        onChange={(e) =>
                          updateSelectedEffect((cur) => ({
                            ...cur,
                            domainTag: e.target.value as MetricDomainTag,
                          }))
                        }
                        className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
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

                {/* 直接入边权重编辑 & 局部归一化状态 */}
                <div className="space-y-1.5 rounded border border-[#30363d] bg-[#161b22] p-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-300">
                      <GitBranch className="h-3 w-3" />
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
                                edges: normalizeTargetIncomingWeights(prev.edges, selectedNode.id),
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
                    <div className="text-[10px] text-slate-500">
                      当前为叶级输入节点，无入边；可通过右侧 metricBinding 直接绑定指标。
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {selectedIncomingEdges.map((edge) => {
                        const srcNode = activeSystem.nodes.find((n) => n.id === edge.sourceNodeId);
                        const effWeight = selectedEval?.effectiveWeights?.[edge.id];
                        return (
                          <div
                            key={edge.id}
                            className="flex items-center justify-between gap-2 rounded border border-[#30363d]/80 bg-[#0d1117] px-2 py-1"
                          >
                            <span className="truncate text-[11px] text-slate-300">
                              {srcNode?.label || edge.sourceNodeId}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {typeof effWeight === 'number' && (
                                <span className="font-mono text-[9px] text-slate-500 tabular-nums">
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
                                className="w-16 rounded border border-[#30363d] bg-[#161b22] px-1.5 py-0.5 text-right font-mono text-[11px] text-indigo-200 tabular-nums"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* 第 2 栏：多效果合成策略 & 缺数门控策略 */}
              <div className="space-y-2.5 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                <div className="font-semibold text-indigo-300">2. 合成与缺数重归一策略</div>

                <label className="block space-y-1">
                  <span className="text-[11px] text-slate-400">聚合策略 (aggregation.strategy)</span>
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
                    value={selectedNodeEffect?.aggregation.missingPolicy ?? 'skip_renormalize'}
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
                          aggregation: { ...cur.aggregation, customFormula: e.target.value },
                        }))
                      }
                      placeholder="使用上游节点 ID 或 targetAlias 进行计算"
                      className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[11px] text-indigo-200 focus:border-indigo-500 focus:outline-none"
                    />
                  </label>
                )}

                {selectedEval && (
                  <div className="space-y-1 rounded border border-[#30363d] bg-[#161b22] p-2 font-mono text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">评估分值:</span>
                      <span className="font-bold text-indigo-200">
                        {selectedEval.score !== null ? `${selectedEval.score.toFixed(1)} / 100` : '--'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">可用权重覆盖:</span>
                      <span>{(selectedEval.availableWeightRatio * 100).toFixed(1)}%</span>
                    </div>
                    {selectedEval.rawValue !== undefined && selectedEval.rawValue !== null && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">原始物理值:</span>
                        <span className="text-emerald-300">{String(selectedEval.rawValue)}</span>
                      </div>
                    )}
                    {selectedEval.missingDataReason && (
                      <div className="text-[10px] text-amber-300 leading-relaxed">
                        {selectedEval.missingDataReason}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 第 3 栏：metricBinding（指标切片 + paramOverrides 透传 + ScoringRule 人工判定标准） */}
              <div className="space-y-2.5 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-emerald-300">
                    3. 指标绑定与效用规则 (metricBinding)
                  </span>
                  <label className="inline-flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedNodeEffect?.metricBinding)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          const defaultId =
                            availableMetricOptions[0]?.metricId ?? 'strike.composite_mission_metrics';
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
                  <div className="rounded border border-dashed border-[#30363d] p-4 text-center text-[11px] text-slate-500">
                    当前效果节点采用“纯上游子效果叠加模式”（无直连 metricBinding）。勾选右上角即可绑定二库指标、透传参数与效用映射函数。
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="col-span-2 space-y-0.5">
                        <span className="text-[10px] text-slate-400">二库指标 ID (metricId)</span>
                        <div className="flex gap-1">
                          <select
                            value={
                              availableMetricOptions.some(
                                (m) => m.metricId === selectedNodeEffect.metricBinding?.metricId,
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
                        <span className="text-[10px] text-slate-400">目标列 (targetField)</span>
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

                      {(selectedNodeEffect.metricBinding.scoringRule.type === 'larger_is_better' ||
                        selectedNodeEffect.metricBinding.scoringRule.type ===
                          'smaller_is_better') && (
                        <div className="grid grid-cols-2 gap-2">
                          <label className="space-y-0.5">
                            <span className="text-[10px] text-slate-400">最优阈值 (optimal)</span>
                            <input
                              type="number"
                              step="any"
                              value={selectedNodeEffect.metricBinding.scoringRule.optimal ?? 1}
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
                            <span className="text-[10px] text-slate-400">最差阈值 (worst)</span>
                            <input
                              type="number"
                              step="any"
                              value={selectedNodeEffect.metricBinding.scoringRule.worst ?? 0}
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
                            <span className="text-[10px] text-slate-400">下界 bounds[0]</span>
                            <input
                              type="number"
                              step="any"
                              value={selectedNodeEffect.metricBinding.scoringRule.bounds?.[0] ?? 0}
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
                            <span className="text-[10px] text-slate-400">上界 bounds[1]</span>
                            <input
                              type="number"
                              step="any"
                              value={selectedNodeEffect.metricBinding.scoringRule.bounds?.[1] ?? 1}
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
                              value={selectedNodeEffect.metricBinding.scoringRule.trueScore ?? 100}
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
                              value={selectedNodeEffect.metricBinding.scoringRule.falseScore ?? 0}
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

                      {selectedNodeEffect.metricBinding.scoringRule.type === 'target_range' && (
                        <div className="grid grid-cols-2 gap-2">
                          <label className="space-y-0.5">
                            <span className="text-[10px] text-slate-400">最优下限 opt[0]</span>
                            <input
                              type="number"
                              step="any"
                              value={
                                selectedNodeEffect.metricBinding.scoringRule.optimalRange?.[0] ?? 0.6
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
                                        cur.metricBinding!.scoringRule.optimalRange?.[1] ?? 0.9,
                                      ],
                                    },
                                  },
                                }));
                              }}
                              className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 font-mono text-[11px]"
                            />
                          </label>
                          <label className="space-y-0.5">
                            <span className="text-[10px] text-slate-400">最优上限 opt[1]</span>
                            <input
                              type="number"
                              step="any"
                              value={
                                selectedNodeEffect.metricBinding.scoringRule.optimalRange?.[1] ?? 0.9
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
                                        cur.metricBinding!.scoringRule.optimalRange?.[0] ?? 0.6,
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
                              <div key={idx} className="flex items-center gap-1.5 font-mono text-[11px]">
                                <input
                                  type="number"
                                  step="any"
                                  value={st.val}
                                  onChange={(e) => {
                                    const v = Number.parseFloat(e.target.value);
                                    if (!Number.isFinite(v)) return;
                                    updateSelectedEffect((cur) => {
                                      const steps = [...(cur.metricBinding!.scoringRule.steps ?? [])];
                                      steps[idx] = { ...steps[idx], val: v };
                                      return {
                                        ...cur,
                                        metricBinding: {
                                          ...cur.metricBinding!,
                                          scoringRule: { ...cur.metricBinding!.scoringRule, steps },
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
                                      const steps = [...(cur.metricBinding!.scoringRule.steps ?? [])];
                                      steps[idx] = { ...steps[idx], score: sc };
                                      return {
                                        ...cur,
                                        metricBinding: {
                                          ...cur.metricBinding!,
                                          scoringRule: { ...cur.metricBinding!.scoringRule, steps },
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

                    {/* 透传行级物理阈值 paramOverrides & 维度切片 sliceFilter */}
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-0.5">
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
                              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
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
                          <span className="text-[9px] text-rose-400">{paramOverridesErr}</span>
                        )}
                      </label>

                      <label className="space-y-0.5">
                        <span className="text-[10px] text-slate-400">sliceFilter (切片 JSON)</span>
                        <textarea
                          rows={2}
                          value={sliceFilterText}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setSliceFilterText(raw);
                            try {
                              const parsed = raw.trim() ? JSON.parse(raw) : {};
                              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
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
                          placeholder='{"Side": "蓝方"}'
                          className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[10px] text-slate-200"
                        />
                        {sliceFilterErr && (
                          <span className="text-[9px] text-rose-400">{sliceFilterErr}</span>
                        )}
                      </label>
                    </div>

                    {/* 可选门控告警阈值 */}
                    {selectedNodeEffect.role === 'gate' && (
                      <div className="flex flex-wrap items-center gap-1.5 rounded border border-rose-500/30 bg-rose-950/20 px-2 py-1.5 text-[10px]">
                        <span className="text-rose-300 font-semibold">Gate 告警条件:</span>
                        <select
                          value={selectedNodeEffect.metricBinding.alarmThreshold?.operator ?? '>'}
                          onChange={(e) =>
                            updateSelectedEffect((cur) => ({
                              ...cur,
                              metricBinding: {
                                ...cur.metricBinding!,
                                alarmThreshold: {
                                  operator: e.target.value as AlarmThreshold['operator'],
                                  value: cur.metricBinding!.alarmThreshold?.value ?? 0,
                                  severity: cur.metricBinding!.alarmThreshold?.severity ?? 'major',
                                  messageTemplate: cur.metricBinding!.alarmThreshold?.messageTemplate,
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
                                  operator: cur.metricBinding!.alarmThreshold?.operator ?? '>',
                                  value: v,
                                  severity: cur.metricBinding!.alarmThreshold?.severity ?? 'major',
                                  messageTemplate: cur.metricBinding!.alarmThreshold?.messageTemplate,
                                },
                              },
                            }));
                          }}
                          className="w-20 rounded border border-[#30363d] bg-[#0d1117] px-1.5 py-0.5 font-mono text-rose-200"
                        />
                        <span className="text-slate-400">触发红线违例</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
