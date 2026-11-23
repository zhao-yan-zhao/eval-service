import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Compass,
  Cpu,
  Database,
  FileCode,
  Layers,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Table2,
  Trash2,
} from 'lucide-react';
import type {
  DagEdge,
  DagGraphDefinition,
  DagNodeBase,
  EvidenceRef,
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

export interface OperatorDagStudioPanelProps {
  selectedRunId?: string;
  activeSourceId?: string;
  focusedOperatorId?: string | null;
}

interface FactOperatorSummary {
  id: string;
  name: string;
  chapter?: number;
  category?: string;
  militaryLevel?: string;
  domainTag?: string;
  description?: string;
  requiredTables?: string[];
  optionalTables?: string[];
  parameterPorts?: ParameterPortSpec[];
  outputColumns?: Array<{ name: string; type?: string; description?: string }>;
  outputColumnNames?: string[];
  layer?: string;
}

interface OperatorNodeExecState {
  nodeId: string;
  status: 'valid' | 'degraded' | 'unavailable';
  dataset?: TableDataset;
  evidenceRefs?: EvidenceRef[];
  missingDataReason?: string;
  cacheKey?: string;
  cacheHit?: boolean;
  latencyMs?: number;
}

type OperatorDagNode = DagNodeBase & {
  refId?: string;
  parameterPorts?: ParameterPortSpec[];
  params?: Record<string, unknown>;
};

interface BuiltinComponentMeta {
  kind: 'data_input' | 'inline_calc' | 'group_agg' | 'spatial' | 'python_script';
  name: string;
  engine: 'TS' | 'Python';
  engineLabel: string;
  badge: string;
  description: string;
  icon: typeof Database;
  defaultParams: Record<string, unknown>;
}

const BUILTIN_COMPONENTS: BuiltinComponentMeta[] = [
  {
    kind: 'data_input',
    name: '数据输入 (data_input)',
    engine: 'TS',
    engineLabel: 'TS · CSV 抽取器',
    badge: 'TS Loader',
    description: '加载仿真原始 CSV 底表并进行行级过滤与初始字段提取',
    icon: Database,
    defaultParams: {
      csvTable: 'UnitPositions.csv',
      filterField: '',
      filterEquals: '',
      maxRows: 500,
    },
  },
  {
    kind: 'inline_calc',
    name: '行内公式 (inline_calc)',
    engine: 'TS',
    engineLabel: 'TS · LibFormula AST',
    badge: 'TS Formula',
    description: '纯 AST 递归下降语法树公式引擎（Zero eval，杜绝安全注入）',
    icon: Calculator,
    defaultParams: {
      derivedColumns: [
        {
          id: 'col_1',
          columnName: 'NormalizedScore',
          expression: 'MissionCompletionRate * 100',
          dataType: 'number',
          description: '完成率百分制折算',
        },
      ],
    },
  },
  {
    kind: 'group_agg',
    name: '跨行分组聚合 (group_agg)',
    engine: 'TS',
    engineLabel: 'TS · GroupBy 纯净输出',
    badge: 'TS GroupBy',
    description: '多维度分组汇总与统计聚合，严格杜绝原始 20+ 列向下穿透污染',
    icon: Layers,
    defaultParams: {
      groupKeys: ['Side'],
      metrics: [
        {
          id: 'm_avg_score',
          targetField: 'AvgScore',
          sourceColumn: 'NormalizedScore',
          method: 'AVERAGE',
          dataType: 'number',
        },
        {
          id: 'm_count',
          targetField: 'TotalCount',
          sourceColumn: 'MissionID',
          method: 'COUNT',
          dataType: 'number',
        },
      ],
    },
  },
  {
    kind: 'spatial',
    name: '空间几何 (spatial)',
    engine: 'TS',
    engineLabel: 'TS · Turf.js 几何引擎',
    badge: 'TS Spatial',
    description: '航线走廊在勤合规判定、凸包围栏与防区外安全裕度测算',
    icon: Compass,
    defaultParams: {
      analysisType: 'corridor_compliance',
      safeRadiusNm: 15,
      minSafeMarginKm: 10,
    },
  },
  {
    kind: 'python_script',
    name: '自定义 Python (python_script)',
    engine: 'Python',
    engineLabel: 'Python 3.12 · 科学计算内核',
    badge: 'Python 内核',
    description: '隔离子进程执行高级物理模型、NumPy 拟合与运筹优化算法',
    icon: Code2,
    defaultParams: {
      pythonCode: `# input_df 为上游 TableDataset 转换的 pandas.DataFrame
# output_df 为本次节点标准产出 DataFrame
import pandas as pd
import numpy as np

if 'input_df' in locals() and not input_df.empty:
    output_df = input_df.copy()
    output_df['CalcTimestamp'] = pd.Timestamp.now().isoformat()
else:
    output_df = pd.DataFrame([{'Status': 'Ready', 'Kernel': 'Python 3.12'}])
`,
      timeoutMs: 8000,
    },
  },
];

const CHAPTER_TITLES: Record<number, string> = {
  1: '第 1 章 · 任务突击与协同实证 (Ch.1)',
  2: '第 2 章 · 目标感知与探测跟踪 (Ch.2)',
  3: '第 3 章 · 指挥控制与协同组网 (Ch.3)',
  4: '第 4 章 · 武器运用与超视距空战 (Ch.4)',
  5: '第 5 章 · 战损评估与战场生存 (Ch.5)',
  6: '第 6 章 · 空间包络与走廊规避 (Ch.6)',
  7: '第 7 章 · 耗弹效费与资源保障 (Ch.7)',
};

function createStarterTemplateGraph(): DagGraphDefinition<OperatorDagNode> {
  return {
    graphId: 'op_graph_mixed_kernel_starter',
    name: 'TS + Python 混合内核算子流水线 (Starter Template)',
    description: '演示 Python 客观事实算子 ➔ TS AST 行内公式衍生 ➔ TS 分组纯净聚合 全链路算子流',
    graphKind: 'operator',
    nodes: [
      {
        id: 'on_strike_fact',
        kind: 'fact_operator',
        label: '对地突击基础事实算子 (Python)',
        refId: 'strike.single_mission_metrics',
        position: { x: 70, y: 130 },
        params: {
          operatorId: 'strike.single_mission_metrics',
          bdaDamageThresholdPct: 0.5,
        },
        parameterPorts: [
          {
            key: 'bdaDamageThresholdPct',
            label: '毁伤判定阈值',
            dataType: 'number',
            defaultValue: 0.5,
            description: '战损百分比超过此值判定为目标完全瘫痪',
          },
        ],
      },
      {
        id: 'on_calc_score',
        kind: 'inline_calc',
        label: '突击成效衍生标定 (TS LibFormula)',
        position: { x: 450, y: 130 },
        params: {
          derivedColumns: [
            {
              id: 'col_eff_score',
              columnName: 'NormalizedEffectScore',
              expression: 'MissionCompletionRate * 100',
              dataType: 'number',
              description: '任务完成率百分比折算 (0-100)',
            },
          ],
        },
      },
      {
        id: 'on_agg_by_side',
        kind: 'group_agg',
        label: '分阵营突击效能汇聚 (TS GroupBy)',
        position: { x: 830, y: 130 },
        params: {
          groupKeys: ['Side'],
          metrics: [
            {
              id: 'm_avg_score',
              targetField: 'AvgEffectScore',
              sourceColumn: 'NormalizedEffectScore',
              method: 'AVERAGE',
              dataType: 'number',
            },
            {
              id: 'm_mission_cnt',
              targetField: 'TotalMissions',
              sourceColumn: 'MissionID',
              method: 'COUNT',
              dataType: 'number',
            },
          ],
        },
      },
    ],
    edges: [
      {
        id: 'oe_fact_to_calc',
        sourceNodeId: 'on_strike_fact',
        targetNodeId: 'on_calc_score',
      },
      {
        id: 'oe_calc_to_agg',
        sourceNodeId: 'on_calc_score',
        targetNodeId: 'on_agg_by_side',
      },
    ],
  };
}

export function OperatorDagStudioPanel({
  selectedRunId,
  activeSourceId,
  focusedOperatorId,
}: OperatorDagStudioPanelProps) {
  const [factOperators, setFactOperators] = useState<FactOperatorSummary[]>([]);
  const [loadingOps, setLoadingOps] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'info' | 'warn' | 'error'; text: string } | null>(
    null,
  );

  const [activeGraph, setActiveGraph] = useState<DagGraphDefinition<OperatorDagNode>>(() =>
    createStarterTemplateGraph(),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('on_strike_fact');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // 执行缓存与节点执行状态
  const [nodeExecResults, setNodeExecResults] = useState<Record<string, OperatorNodeExecState>>({});
  const [lastStats, setLastStats] = useState<{
    totalLatencyMs?: number;
    cacheHits?: number;
    cacheMisses?: number;
    runId?: string;
  } | null>(null);

  // 事实算子库搜索与折叠
  const [factSearch, setFactSearch] = useState('');
  const [collapsedChapters, setCollapsedChapters] = useState<Record<number, boolean>>({});
  const [toolboxTab, setToolboxTab] = useState<'components' | 'fact_ops'>('components');
  const [inspectorTab, setInspectorTab] = useState<'params' | 'preview'>('params');

  // 1. 加载一库客观基础事实算子 (GET /api/v4/operators?layer=fact)
  const loadFactOperators = useCallback(async () => {
    setLoadingOps(true);
    try {
      let rawList: FactOperatorSummary[] = [];
      try {
        const res = await fetch('/api/v4/operators?layer=fact');
        if (res.ok) {
          const json = (await res.json()) as { operators?: FactOperatorSummary[] };
          if (Array.isArray(json.operators)) {
            rawList = json.operators;
          }
        } else if (res.status === 404) {
          const fbRes = await fetch('/api/operators');
          if (fbRes.ok) {
            const fbJson = (await fbRes.json()) as { operators?: FactOperatorSummary[] };
            if (Array.isArray(fbJson.operators)) {
              rawList = fbJson.operators;
            }
          }
        }
      } catch {
        // 后端离线时保持降级
      }
      setFactOperators(rawList);
    } finally {
      setLoadingOps(false);
    }
  }, []);

  useEffect(() => {
    void loadFactOperators();
  }, [loadFactOperators]);

  // 响应外部 focusedOperatorId 下钻定位
  useEffect(() => {
    if (!focusedOperatorId) return;
    const existingNode = activeGraph.nodes.find(
      (n) => n.id === focusedOperatorId || n.refId === focusedOperatorId,
    );
    if (existingNode) {
      setSelectedNodeId(existingNode.id);
      return;
    }
    // 若画布中不存在，切换至事实算子标签页并高亮搜索
    setToolboxTab('fact_ops');
    setFactSearch(focusedOperatorId);
  }, [focusedOperatorId, activeGraph.nodes]);

  const selectedNode = useMemo(
    () => activeGraph.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [activeGraph.nodes, selectedNodeId],
  );

  const selectedNodeFactMeta = useMemo(() => {
    if (!selectedNode) return undefined;
    const targetId = selectedNode.refId || (selectedNode.params?.operatorId as string);
    return factOperators.find((op) => op.id === targetId || op.id === selectedNode.id);
  }, [selectedNode, factOperators]);

  // 过滤事实算子
  const filteredFactOps = useMemo(() => {
    const q = factSearch.trim().toLowerCase();
    if (!q) return factOperators;
    return factOperators.filter(
      (op) =>
        op.id.toLowerCase().includes(q) ||
        op.name.toLowerCase().includes(q) ||
        (op.description ?? '').toLowerCase().includes(q) ||
        String(op.chapter ?? '').includes(q),
    );
  }, [factOperators, factSearch]);

  // 按 Chapter 1~7 分组
  const chapterGroups = useMemo(() => {
    const groups: Record<number, FactOperatorSummary[]> = {
      1: [],
      2: [],
      3: [],
      4: [],
      5: [],
      6: [],
      7: [],
    };
    for (const op of filteredFactOps) {
      const ch = op.chapter && op.chapter >= 1 && op.chapter <= 7 ? op.chapter : 1;
      groups[ch].push(op);
    }
    return groups;
  }, [filteredFactOps]);

  // 将内置计算组件添加至画布
  const handleAddComponentToCanvas = useCallback(
    (comp: BuiltinComponentMeta) => {
      const count = activeGraph.nodes.length + 1;
      const uid = Date.now().toString(36).slice(-4);
      const nodeId = `node_${comp.kind}_${uid}`;
      const newNode: OperatorDagNode = {
        id: nodeId,
        kind: comp.kind,
        label: `${comp.name.split(' ')[0]} ${count}`,
        position: {
          x: 100 + ((count % 4) * 260),
          y: 100 + (Math.floor(count / 4) * 160),
        },
        params: structuredClone(comp.defaultParams),
      };

      setActiveGraph((prev) => ({
        ...prev,
        nodes: [...prev.nodes, newNode],
      }));
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
    },
    [activeGraph.nodes.length],
  );

  // 将事实算子添加至画布
  const handleAddFactOperatorToCanvas = useCallback(
    (op: FactOperatorSummary) => {
      const count = activeGraph.nodes.length + 1;
      const uid = Date.now().toString(36).slice(-4);
      const nodeId = `fact_${op.id.replace(/[^a-zA-Z0-9_]/g, '_')}_${uid}`;

      const defaultPortsParams: Record<string, unknown> = {
        operatorId: op.id,
      };
      if (Array.isArray(op.parameterPorts)) {
        for (const p of op.parameterPorts) {
          if (p.defaultValue !== undefined) {
            defaultPortsParams[p.key] = p.defaultValue;
          }
        }
      }

      const newNode: OperatorDagNode = {
        id: nodeId,
        kind: 'fact_operator',
        label: op.name,
        refId: op.id,
        parameterPorts: op.parameterPorts,
        position: {
          x: 80 + ((count % 4) * 260),
          y: 90 + (Math.floor(count / 4) * 160),
        },
        params: defaultPortsParams,
      };

      setActiveGraph((prev) => ({
        ...prev,
        nodes: [...prev.nodes, newNode],
      }));
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
    },
    [activeGraph.nodes.length],
  );

  // 画布节点及连线变更回调
  const handleCanvasNodesChange = useCallback((nextCanvasNodes: DagCanvasNode[]) => {
    setActiveGraph((prev) => {
      const nodeMap = new Map(prev.nodes.map((n) => [n.id, n]));
      const updated: OperatorDagNode[] = nextCanvasNodes.map((cn) => {
        const existing = nodeMap.get(cn.id);
        return {
          id: cn.id,
          kind: existing?.kind ?? cn.kind,
          label: existing?.label ?? cn.label,
          position: cn.position,
          collapsed: cn.collapsed,
          refId: existing?.refId,
          parameterPorts: existing?.parameterPorts ?? cn.parameterPorts,
          params: existing?.params ?? cn.params,
        };
      });
      return { ...prev, nodes: updated };
    });
  }, []);

  const handleCanvasEdgesChange = useCallback((nextEdges: DagCanvasEdge[]) => {
    setActiveGraph((prev) => ({
      ...prev,
      edges: nextEdges.map((e) => ({
        id: e.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        ...(e.targetAlias ? { targetAlias: e.targetAlias } : {}),
      })),
    }));
  }, []);

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

  // 运行算子 DAG (POST /api/v4/operator-graphs/execute)
  const handleExecuteOperatorDag = useCallback(async () => {
    setExecuting(true);
    setBanner(null);

    try {
      const res = await fetch('/api/v4/operator-graphs/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: activeGraph,
          runId: selectedRunId,
          dataSourceId: activeSourceId,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || json.ok === false) {
        throw new Error(
          typeof json.error === 'string'
            ? json.error
            : `算子 DAG 执行失败 (HTTP ${res.status})`,
        );
      }

      const execution = json as {
        nodeResults?: Record<string, OperatorNodeExecState>;
        totalLatencyMs?: number;
        cacheHits?: number;
        cacheMisses?: number;
        runId?: string;
      };

      const rawResults = execution.nodeResults ?? {};
      setNodeExecResults(rawResults);
      setLastStats({
        totalLatencyMs: execution.totalLatencyMs,
        cacheHits: execution.cacheHits,
        cacheMisses: execution.cacheMisses,
        runId: execution.runId ?? selectedRunId,
      });

      const values = Object.values(rawResults);
      const unavailCount = values.filter((r) => r.status === 'unavailable').length;
      if (unavailCount > 0) {
        setBanner({
          kind: 'warn',
          text: `算子 DAG 执行完成：${values.length - unavailCount}/${values.length} 节点成功，${unavailCount} 节点缺数 (Fail-Closed)`,
        });
      } else {
        setBanner({
          kind: 'info',
          text: `算子 DAG 运行完成：全量 ${values.length} 节点执行成功，总耗时 ${execution.totalLatencyMs ?? 0}ms`,
        });
      }
    } catch (err) {
      // 容错与兜底：若全图接口报错且当前仅选中单事实算子，尝试单算子 /api/v4/operators/run 试算
      if (
        selectedNode &&
        selectedNode.kind === 'fact_operator' &&
        (selectedNode.refId || selectedNode.params?.operatorId)
      ) {
        const opId = (selectedNode.refId || selectedNode.params?.operatorId) as string;
        try {
          const fbRes = await fetch('/api/v4/operators/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              operatorId: opId,
              runId: selectedRunId,
              dataSourceId: activeSourceId,
              params: selectedNode.params,
            }),
          });
          if (fbRes.ok) {
            const fbJson = (await fbRes.json()) as { result?: OperatorNodeExecState };
            if (fbJson.result) {
              setNodeExecResults((prev) => ({
                ...prev,
                [selectedNode.id]: {
                  ...fbJson.result!,
                  nodeId: selectedNode.id,
                },
              }));
              setBanner({
                kind: 'warn',
                text: `DAG 拓扑执行失败，已自动降级试算单节点「${selectedNode.label}」: ${fbJson.result.status}`,
              });
              return;
            }
          }
        } catch {
          // 忽略单节点重试异常
        }
      }

      setBanner({
        kind: 'error',
        text: `执行算子 DAG 失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setExecuting(false);
    }
  }, [activeGraph, selectedRunId, activeSourceId, selectedNode]);

  // 更新当前选中节点参数
  const updateSelectedNodeParams = useCallback(
    (paramKey: string, value: unknown) => {
      if (!selectedNodeId) return;
      setActiveGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => {
          if (n.id !== selectedNodeId) return n;
          return {
            ...n,
            params: {
              ...(n.params ?? {}),
              [paramKey]: value,
            },
          };
        }),
      }));
    },
    [selectedNodeId],
  );

  // 将 DagGraphDefinition 转换为 DagCanvasNode[]
  const canvasNodes: DagCanvasNode[] = useMemo(() => {
    return activeGraph.nodes.map((n) => {
      const exec = nodeExecResults[n.id];
      const status: DagNodeStatus = exec?.status ?? 'idle';
      const rowCount = exec?.dataset?.rows?.length;
      const colCount = exec?.dataset?.columns?.length;

      let badgeText = n.kind;
      let subtitle = '';
      if (n.kind === 'fact_operator') {
        badgeText = 'Python 事实算子';
        subtitle = n.refId ?? '';
      } else if (n.kind === 'inline_calc') {
        badgeText = 'TS 行内公式';
        subtitle = 'LibFormula AST';
      } else if (n.kind === 'group_agg') {
        badgeText = 'TS 分组聚合';
        subtitle = '纯净 GroupBy';
      } else if (n.kind === 'spatial') {
        badgeText = 'TS 空间几何';
        subtitle = 'Turf.js 走廊在勤';
      } else if (n.kind === 'python_script') {
        badgeText = 'Python 内核';
        subtitle = 'NumPy / SciPy 桥接';
      } else if (n.kind === 'data_input') {
        badgeText = 'TS 表输入';
        subtitle = (n.params?.csvTable as string) ?? 'CSV Loader';
      }

      return {
        id: n.id,
        kind: n.kind,
        label: n.label,
        position: n.position,
        collapsed: n.collapsed,
        parameterPorts: n.parameterPorts,
        params: n.params,
        status,
        graphKind: 'operator',
        summary: {
          badgeText,
          subtitle,
          rowCount,
          columnCount: colCount,
          dataset: exec?.dataset,
          latencyMs: exec?.latencyMs,
          cacheHit: exec?.cacheHit,
          missingDataReason: exec?.missingDataReason,
        },
      };
    });
  }, [activeGraph.nodes, nodeExecResults]);

  const canvasEdges: DagCanvasEdge[] = useMemo(() => {
    return activeGraph.edges.map((e) => {
      const srcExec = nodeExecResults[e.sourceNodeId];
      const status: DagNodeStatus = srcExec?.status ?? 'idle';
      return {
        id: e.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        graphKind: 'operator',
        targetAlias: e.targetAlias,
        status,
      };
    });
  }, [activeGraph.edges, nodeExecResults]);

  // 当前选中节点的执行数据集
  const selectedExecDataset = useMemo(() => {
    if (!selectedNodeId) return undefined;
    return nodeExecResults[selectedNodeId]?.dataset;
  }, [nodeExecResults, selectedNodeId]);

  return (
    <div className="flex h-full min-h-[820px] flex-col gap-3 rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-slate-100">
      {/* 顶部主工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-[#30363d] bg-[#161b22] px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-300">
            <Cpu className="h-3.5 w-3.5" />
            <span>一库 · 算子 DAG 画布（TS + Python 混合内核）</span>
          </div>

          <span className="font-mono text-xs text-slate-400">
            {activeGraph.name} ({activeGraph.nodes.length} 节点 / {activeGraph.edges.length} 连线)
          </span>

          <button
            type="button"
            onClick={() => {
              setActiveGraph(createStarterTemplateGraph());
              setSelectedNodeId('on_strike_fact');
              setSelectedEdgeId(null);
              setNodeExecResults({});
              setLastStats(null);
              setBanner({ kind: 'info', text: '已重置为混合内核经典算子流模版 (Strike ➔ LibFormula ➔ GroupBy)' });
            }}
            title="加载默认混合内核模板图"
            className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-slate-300 hover:border-cyan-500/50 hover:text-cyan-200 transition"
          >
            <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
            <span>模版示例</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveGraph((prev) => ({ ...prev, nodes: [], edges: [] }));
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
              setNodeExecResults({});
            }}
            title="清空画布"
            className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-slate-400 hover:text-rose-300 hover:border-rose-500/40 transition"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>清空</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {lastStats && (
            <div className="hidden lg:flex items-center gap-2 font-mono text-[11px] text-slate-400 border border-[#30363d] rounded-md px-2.5 py-1 bg-[#0d1117]">
              <span>耗时: <strong className="text-cyan-300">{lastStats.totalLatencyMs ?? 0}ms</strong></span>
              <span className="text-slate-600">|</span>
              <span>命中: <strong className="text-emerald-300">{lastStats.cacheHits ?? 0}</strong></span>
              <span className="text-slate-600">|</span>
              <span>穿透: <strong className="text-amber-300">{lastStats.cacheMisses ?? 0}</strong></span>
            </div>
          )}

          <button
            type="button"
            disabled={executing || activeGraph.nodes.length === 0}
            onClick={() => void handleExecuteOperatorDag()}
            className="inline-flex items-center gap-1.5 rounded-md border border-cyan-400/60 bg-cyan-600 px-3.5 py-1 text-xs font-semibold text-white shadow-lg shadow-cyan-950/60 hover:bg-cyan-500 disabled:opacity-50 transition cursor-pointer"
          >
            <Play className={`h-3.5 w-3.5 ${executing ? 'animate-spin' : ''}`} />
            <span>{executing ? '算子流执行中...' : '▶ 运行算子 DAG'}</span>
          </button>
        </div>
      </div>

      {/* 提示横幅 */}
      {banner && (
        <div
          className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs border ${
            banner.kind === 'error'
              ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
              : banner.kind === 'warn'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {banner.kind === 'error' ? (
              <AlertCircle className="h-4 w-4 shrink-0" />
            ) : banner.kind === 'warn' ? (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            )}
            <span>{banner.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-slate-400 hover:text-slate-200 ml-2"
          >
            ×
          </button>
        </div>
      )}

      {/* 主体三栏/双栏区域：左侧组件库/事实算子库 + 中间 DAG 画布 + 右侧参数属性与数据表透视 */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12 flex-1 min-h-0">
        {/* 左栏：算子组件箱 (Toolbox) */}
        <div className="xl:col-span-3 flex flex-col rounded-xl border border-[#30363d] bg-[#161b22] p-2.5 min-h-[500px]">
          {/* 选项卡切换：内置计算组件 vs 客观事实算子 */}
          <div className="flex items-center gap-1 rounded-lg border border-[#30363d] bg-[#0d1117] p-1 mb-2.5">
            <button
              type="button"
              onClick={() => setToolboxTab('components')}
              className={`flex-1 rounded py-1 text-xs font-medium transition ${
                toolboxTab === 'components'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              1. 内置计算组件 ({BUILTIN_COMPONENTS.length})
            </button>
            <button
              type="button"
              onClick={() => setToolboxTab('fact_ops')}
              className={`flex-1 rounded py-1 text-xs font-medium transition ${
                toolboxTab === 'fact_ops'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              2. 基础事实算子 ({factOperators.length})
            </button>
          </div>

          {toolboxTab === 'components' ? (
            /* ① 内置计算组件清单 */
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              <div className="text-[11px] text-slate-400 mb-1 px-1">
                点击组件可直接加入画布（支持 TS LibFormula / GroupBy 与 Python 混合编排）
              </div>
              {BUILTIN_COMPONENTS.map((comp) => {
                const Icon = comp.icon;
                return (
                  <div
                    key={comp.kind}
                    onClick={() => handleAddComponentToCanvas(comp)}
                    className="group flex flex-col gap-1 rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5 hover:border-cyan-500/60 hover:bg-[#161b22] transition cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-medium text-xs text-slate-200 group-hover:text-cyan-300">
                        <Icon className="h-3.5 w-3.5 text-cyan-400" />
                        <span>{comp.name}</span>
                      </div>
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] border ${
                          comp.engine === 'Python'
                            ? 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300'
                            : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                        }`}
                      >
                        {comp.badge}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-400">
                      {comp.description}
                    </p>
                    <div className="flex items-center justify-between pt-1 text-[10px] text-slate-500">
                      <span>内核: {comp.engineLabel}</span>
                      <span className="text-cyan-400 group-hover:underline">+ 添加至画布</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ② 客观事实算子 (按 Chapter 1~7 分组) */
            <div className="flex-1 flex flex-col min-h-0">
              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  value={factSearch}
                  onChange={(e) => setFactSearch(e.target.value)}
                  placeholder="搜索事实算子 (ID / 名称 / 章节)..."
                  className="w-full rounded-md border border-[#30363d] bg-[#0d1117] py-1.5 pl-8 pr-2.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {[1, 2, 3, 4, 5, 6, 7].map((ch) => {
                  const ops = chapterGroups[ch] ?? [];
                  if (ops.length === 0 && factSearch.trim()) return null;
                  const isCollapsed = Boolean(collapsedChapters[ch]);
                  return (
                    <div
                      key={ch}
                      className="rounded-lg border border-[#30363d] bg-[#0d1117] overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedChapters((prev) => ({ ...prev, [ch]: !prev[ch] }))
                        }
                        className="flex w-full items-center justify-between bg-[#161b22] px-2.5 py-1.5 text-left text-xs font-semibold text-slate-300 hover:text-cyan-300 transition"
                      >
                        <div className="flex items-center gap-1.5">
                          {isCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
                          )}
                          <span>{CHAPTER_TITLES[ch]}</span>
                        </div>
                        <span className="rounded bg-[#0d1117] px-1.5 py-0.2 font-mono text-[10px] text-slate-400">
                          {ops.length} 项
                        </span>
                      </button>

                      {!isCollapsed && (
                        <div className="p-1.5 space-y-1.5">
                          {ops.length === 0 ? (
                            <div className="py-2 text-center text-[11px] text-slate-500">
                              暂无匹配算子
                            </div>
                          ) : (
                            ops.map((op) => (
                              <div
                                key={op.id}
                                onClick={() => handleAddFactOperatorToCanvas(op)}
                                className="group rounded border border-[#21262d] bg-[#161b22]/60 p-2 hover:border-cyan-500/60 hover:bg-[#161b22] transition cursor-pointer"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold text-xs text-slate-200 group-hover:text-cyan-300 truncate">
                                    {op.name}
                                  </span>
                                  <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1 py-0.2 font-mono text-[9px] text-cyan-300">
                                    FACT
                                  </span>
                                </div>
                                <div className="font-mono text-[10px] text-slate-400 truncate mt-0.5">
                                  {op.id}
                                </div>
                                {op.description && (
                                  <p className="line-clamp-2 text-[10px] text-slate-400 mt-1">
                                    {op.description}
                                  </p>
                                )}
                                <div className="mt-1 flex items-center justify-between text-[9px] text-slate-500">
                                  <span>
                                    依赖: {op.requiredTables?.join(', ') || '标准态势'}
                                  </span>
                                  <span className="text-cyan-400 group-hover:underline">
                                    + 加载
                                  </span>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 中栏：DAG 算子流画布 (使用 DagCanvasBoard) */}
        <div className="xl:col-span-5 flex flex-col rounded-xl border border-[#30363d] bg-[#161b22] overflow-hidden min-h-[500px]">
          <DagCanvasBoard
            graphKind="operator"
            title="一库 · 算子数据变换流画布"
            nodes={canvasNodes}
            edges={canvasEdges}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            showOutline={false}
            autoFitOnMount={true}
            onSelectNode={(id) => {
              setSelectedNodeId(id);
              setSelectedEdgeId(null);
            }}
            onSelectEdge={(id) => {
              setSelectedEdgeId(id);
              setSelectedNodeId(null);
            }}
            onNodesChange={handleCanvasNodesChange}
            onEdgesChange={handleCanvasEdgesChange}
            onDeleteNode={handleDeleteNode}
            onDeleteEdge={handleDeleteEdge}
            className="flex-1"
          />
        </div>

        {/* 右栏：节点检验器 (Inspector) 与 live 数据表透视预览 (V4TablePivotPreview) */}
        <div className="xl:col-span-4 flex flex-col rounded-xl border border-[#30363d] bg-[#161b22] p-2.5 min-h-[500px]">
          {/* 属性检查器选项卡 */}
          <div className="flex items-center justify-between border-b border-[#30363d] pb-2 mb-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setInspectorTab('params')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  inspectorTab === 'params'
                    ? 'bg-cyan-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                参数配置 (Params)
              </button>
              <button
                type="button"
                onClick={() => setInspectorTab('preview')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  inspectorTab === 'preview'
                    ? 'bg-cyan-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                数据表透视 (Preview)
              </button>
            </div>

            {selectedNode && (
              <span className="font-mono text-[10px] text-cyan-300 truncate max-w-[140px]">
                {selectedNode.label}
              </span>
            )}
          </div>

          {!selectedNode ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs p-4 text-center">
              <Cpu className="h-8 w-8 mb-2 stroke-1 text-slate-600" />
              <span>请在画布中选中算子节点以检查参数或预览透视数据</span>
            </div>
          ) : inspectorTab === 'params' ? (
            /* 节点参数配置面板 */
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs">
              <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">节点元信息</span>
                  <span className="font-mono text-[10px] text-slate-400">{selectedNode.id}</span>
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">节点显示标签</label>
                  <input
                    type="text"
                    value={selectedNode.label}
                    onChange={(e) => {
                      const newLabel = e.target.value;
                      setActiveGraph((prev) => ({
                        ...prev,
                        nodes: prev.nodes.map((n) =>
                          n.id === selectedNode.id ? { ...n, label: newLabel } : n,
                        ),
                      }));
                    }}
                    className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                  <span>节点类型: <strong className="text-cyan-300 font-mono">{selectedNode.kind}</strong></span>
                  {selectedNode.refId && (
                    <span>引用: <strong className="text-slate-300 font-mono">{selectedNode.refId}</strong></span>
                  )}
                </div>
              </div>

              {/* 针对不同 node.kind 的专属参数编辑器 */}
              {selectedNode.kind === 'data_input' && (
                <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5 space-y-2.5">
                  <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Database className="h-3.5 w-3.5 text-cyan-400" />
                    <span>表输入参数配置 (data_input)</span>
                  </span>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">CSV 底表文件名</label>
                    <input
                      type="text"
                      value={(selectedNode.params?.csvTable as string) ?? 'UnitPositions.csv'}
                      onChange={(e) => updateSelectedNodeParams('csvTable', e.target.value)}
                      placeholder="如 UnitPositions.csv 或 WeaponEndgame.csv"
                      className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-200 font-mono focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">行过滤字段</label>
                      <input
                        type="text"
                        value={(selectedNode.params?.filterField as string) ?? ''}
                        onChange={(e) => updateSelectedNodeParams('filterField', e.target.value)}
                        placeholder="如 Side"
                        className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">过滤匹配值</label>
                      <input
                        type="text"
                        value={(selectedNode.params?.filterEquals as string) ?? ''}
                        onChange={(e) => updateSelectedNodeParams('filterEquals', e.target.value)}
                        placeholder="如 红方"
                        className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">最大加载行数</label>
                    <input
                      type="number"
                      value={Number(selectedNode.params?.maxRows ?? 500)}
                      onChange={(e) => updateSelectedNodeParams('maxRows', Number(e.target.value))}
                      className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {selectedNode.kind === 'inline_calc' && (
                <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <Calculator className="h-3.5 w-3.5 text-cyan-400" />
                      <span>行内衍生公式列表 (LibFormula AST)</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const existingCols = (selectedNode.params?.derivedColumns as Array<Record<string, unknown>>) ?? [];
                        const uid = Date.now().toString(36).slice(-3);
                        const nextCols = [
                          ...existingCols,
                          {
                            id: `col_${uid}`,
                            columnName: `DerivedCol_${existingCols.length + 1}`,
                            expression: '1.0',
                            dataType: 'number',
                          },
                        ];
                        updateSelectedNodeParams('derivedColumns', nextCols);
                      }}
                      className="text-[11px] text-cyan-400 hover:underline"
                    >
                      + 新增衍生列
                    </button>
                  </div>

                  {(((selectedNode.params?.derivedColumns as Array<Record<string, unknown>>) ?? []).length === 0) ? (
                    <div className="py-2 text-slate-500 text-center">暂未配置公式衍生列</div>
                  ) : (
                    ((selectedNode.params?.derivedColumns as Array<Record<string, unknown>>) ?? []).map((col, idx) => (
                      <div key={idx} className="rounded border border-[#21262d] bg-[#161b22] p-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-slate-300">列 #{idx + 1}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const existingCols = [...(((selectedNode.params?.derivedColumns as Array<Record<string, unknown>>) ?? []))];
                              existingCols.splice(idx, 1);
                              updateSelectedNodeParams('derivedColumns', existingCols);
                            }}
                            className="text-slate-500 hover:text-rose-400"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={String(col.columnName ?? '')}
                            onChange={(e) => {
                              const existingCols = [...(((selectedNode.params?.derivedColumns as Array<Record<string, unknown>>) ?? []))];
                              existingCols[idx] = { ...existingCols[idx], columnName: e.target.value };
                              updateSelectedNodeParams('derivedColumns', existingCols);
                            }}
                            placeholder="衍生目标列名"
                            className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-0.8 text-xs text-cyan-200 focus:outline-none"
                          />
                          <select
                            value={String(col.dataType ?? 'number')}
                            onChange={(e) => {
                              const existingCols = [...(((selectedNode.params?.derivedColumns as Array<Record<string, unknown>>) ?? []))];
                              existingCols[idx] = { ...existingCols[idx], dataType: e.target.value };
                              updateSelectedNodeParams('derivedColumns', existingCols);
                            }}
                            className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-0.8 text-xs text-slate-300 focus:outline-none"
                          >
                            <option value="number">number (数值)</option>
                            <option value="string">string (字符串)</option>
                            <option value="boolean">boolean (布尔)</option>
                          </select>
                        </div>
                        <input
                          type="text"
                          value={String(col.expression ?? '')}
                          onChange={(e) => {
                            const existingCols = [...(((selectedNode.params?.derivedColumns as Array<Record<string, unknown>>) ?? []))];
                            existingCols[idx] = { ...existingCols[idx], expression: e.target.value };
                            updateSelectedNodeParams('derivedColumns', existingCols);
                          }}
                          placeholder="表达式，如 MissionCompletionRate * 100"
                          className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-0.8 font-mono text-xs text-emerald-300 focus:outline-none"
                        />
                      </div>
                    ))
                  )}
                </div>
              )}

              {selectedNode.kind === 'group_agg' && (
                <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5 space-y-2.5">
                  <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-cyan-400" />
                    <span>分组与聚合配置 (group_agg)</span>
                  </span>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">
                      分组字段 (groupKeys，以逗号分隔)
                    </label>
                    <input
                      type="text"
                      value={
                        Array.isArray(selectedNode.params?.groupKeys)
                          ? (selectedNode.params.groupKeys as string[]).join(', ')
                          : String(selectedNode.params?.groupKeys ?? 'Side')
                      }
                      onChange={(e) => {
                        const splitted = e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean);
                        updateSelectedNodeParams('groupKeys', splitted);
                      }}
                      placeholder="如 Side, UnitClass"
                      className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-200 font-mono focus:border-cyan-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] text-slate-400">度量聚合列表 (metrics)</label>
                      <button
                        type="button"
                        onClick={() => {
                          const existingMetrics = (selectedNode.params?.metrics as Array<Record<string, unknown>>) ?? [];
                          const uid = Date.now().toString(36).slice(-3);
                          const nextMetrics = [
                            ...existingMetrics,
                            {
                              id: `m_${uid}`,
                              targetField: `AggMetric_${existingMetrics.length + 1}`,
                              sourceColumn: 'NormalizedEffectScore',
                              method: 'AVERAGE',
                              dataType: 'number',
                            },
                          ];
                          updateSelectedNodeParams('metrics', nextMetrics);
                        }}
                        className="text-[11px] text-cyan-400 hover:underline"
                      >
                        + 新增聚合度量
                      </button>
                    </div>

                    {(((selectedNode.params?.metrics as Array<Record<string, unknown>>) ?? []).length === 0) ? (
                      <div className="py-2 text-slate-500 text-center">暂未配置度量聚合</div>
                    ) : (
                      ((selectedNode.params?.metrics as Array<Record<string, unknown>>) ?? []).map((m, idx) => (
                        <div key={idx} className="rounded border border-[#21262d] bg-[#161b22] p-2 space-y-1.5 mb-1.5">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-slate-300">聚合 #{idx + 1}</span>
                            <button
                              type="button"
                              onClick={() => {
                                const existingMetrics = [...(((selectedNode.params?.metrics as Array<Record<string, unknown>>) ?? []))];
                                existingMetrics.splice(idx, 1);
                                updateSelectedNodeParams('metrics', existingMetrics);
                              }}
                              className="text-slate-500 hover:text-rose-400"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="text"
                              value={String(m.targetField ?? '')}
                              onChange={(e) => {
                                const existingMetrics = [...(((selectedNode.params?.metrics as Array<Record<string, unknown>>) ?? []))];
                                existingMetrics[idx] = { ...existingMetrics[idx], targetField: e.target.value };
                                updateSelectedNodeParams('metrics', existingMetrics);
                              }}
                              placeholder="产出度量名"
                              className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-0.8 text-xs text-cyan-200 focus:outline-none"
                            />
                            <select
                              value={String(m.method ?? 'AVERAGE')}
                              onChange={(e) => {
                                const existingMetrics = [...(((selectedNode.params?.metrics as Array<Record<string, unknown>>) ?? []))];
                                existingMetrics[idx] = { ...existingMetrics[idx], method: e.target.value };
                                updateSelectedNodeParams('metrics', existingMetrics);
                              }}
                              className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-0.8 text-xs text-slate-300 focus:outline-none"
                            >
                              <option value="AVERAGE">AVERAGE (均值)</option>
                              <option value="SUM">SUM (求和)</option>
                              <option value="COUNT">COUNT (计数)</option>
                              <option value="MAX">MAX (极大)</option>
                              <option value="MIN">MIN (极小)</option>
                            </select>
                          </div>
                          <input
                            type="text"
                            value={String(m.sourceColumn ?? '')}
                            onChange={(e) => {
                              const existingMetrics = [...(((selectedNode.params?.metrics as Array<Record<string, unknown>>) ?? []))];
                              existingMetrics[idx] = { ...existingMetrics[idx], sourceColumn: e.target.value };
                              updateSelectedNodeParams('metrics', existingMetrics);
                            }}
                            placeholder="上游来源字段名"
                            className="w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-0.8 font-mono text-xs text-slate-300 focus:outline-none"
                          />
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {selectedNode.kind === 'fact_operator' && (
                <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <Cpu className="h-3.5 w-3.5 text-cyan-400" />
                      <span>客观事实算子参数 (fact_operator)</span>
                    </span>
                    <span className="font-mono text-[10px] text-cyan-300">
                      {String(selectedNode.params?.operatorId || selectedNode.refId)}
                    </span>
                  </div>

                  {selectedNodeFactMeta?.description && (
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {selectedNodeFactMeta.description}
                    </p>
                  )}

                  {/* 动态渲染声明的 parameterPorts */}
                  {selectedNodeFactMeta?.parameterPorts && selectedNodeFactMeta.parameterPorts.length > 0 ? (
                    <div className="space-y-2 pt-1 border-t border-[#21262d]">
                      <div className="text-[11px] font-medium text-slate-300">外部透传参数端口</div>
                      {selectedNodeFactMeta.parameterPorts.map((port) => (
                        <div key={port.key}>
                          <label className="text-[11px] text-slate-400 block mb-1">
                            {port.label} ({port.key})
                          </label>
                          <input
                            type={port.dataType === 'number' ? 'number' : 'text'}
                            value={
                              selectedNode.params?.[port.key] !== undefined
                                ? String(selectedNode.params[port.key])
                                : String(port.defaultValue ?? '')
                            }
                            onChange={(e) => {
                              const val =
                                port.dataType === 'number' ? Number(e.target.value) : e.target.value;
                              updateSelectedNodeParams(port.key, val);
                            }}
                            className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                          />
                          {port.description && (
                            <span className="text-[10px] text-slate-500">{port.description}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500">该事实算子无额外参数声明，按默认逻辑执行</div>
                  )}
                </div>
              )}

              {selectedNode.kind === 'python_script' && (
                <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5 space-y-2.5">
                  <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Code2 className="h-3.5 w-3.5 text-fuchsia-400" />
                    <span>自定义 Python 代码 (python_script)</span>
                  </span>
                  <textarea
                    rows={8}
                    value={(selectedNode.params?.pythonCode as string) ?? ''}
                    onChange={(e) => updateSelectedNodeParams('pythonCode', e.target.value)}
                    placeholder="# 输入 Python 代码，处理 input_df 并产出 output_df"
                    className="w-full rounded border border-[#30363d] bg-[#161b22] p-2 font-mono text-xs text-emerald-300 focus:border-cyan-500 focus:outline-none leading-relaxed"
                  />
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">超时毫秒 (timeoutMs)</label>
                    <input
                      type="number"
                      value={Number(selectedNode.params?.timeoutMs ?? 8000)}
                      onChange={(e) => updateSelectedNodeParams('timeoutMs', Number(e.target.value))}
                      className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {selectedNode.kind === 'spatial' && (
                <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5 space-y-2.5">
                  <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Compass className="h-3.5 w-3.5 text-violet-400" />
                    <span>空间几何参数 (Turf.js)</span>
                  </span>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">空间分析类型</label>
                    <select
                      value={(selectedNode.params?.analysisType as string) ?? 'corridor_compliance'}
                      onChange={(e) => updateSelectedNodeParams('analysisType', e.target.value)}
                      className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                    >
                      <option value="corridor_compliance">航线走廊在勤合规判定 (corridor_compliance)</option>
                      <option value="area_containment">巡逻包络与区域围栏 (area_containment)</option>
                      <option value="threat_distance">威胁区距离测算 (threat_distance)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">安全防区裕度 (km)</label>
                    <input
                      type="number"
                      value={Number(selectedNode.params?.minSafeMarginKm ?? 10)}
                      onChange={(e) => updateSelectedNodeParams('minSafeMarginKm', Number(e.target.value))}
                      className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* 数据表透视面板 (V4TablePivotPreview) */
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <V4TablePivotPreview
                dataset={selectedExecDataset}
                title={`${selectedNode.label} · 输出数据集`}
                emptyText={
                  nodeExecResults[selectedNode.id]?.missingDataReason ||
                  '该节点尚未试算或无产出数据，请点击顶部「▶ 运行算子 DAG」'
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
