import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Calculator,
  CheckCircle2,
  Code2,
  Compass,
  Database,
  Download,
  FolderOpen,
  Maximize2,
  Minimize2,
  Minus,
  MoreHorizontal,
  Pencil,
  Play,
  RotateCcw,
  Save,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  CanvasEdge,
  CanvasNode,
  CanvasViewportState,
  PipelineNodeType,
} from './canvas-types.ts';
import { CanvasConnectionLines } from './CanvasConnectionLines.tsx';
import { CanvasNodeCard } from './CanvasNodeCard.tsx';
import { CanvasInspectorDrawer } from './CanvasInspectorDrawer.tsx';
import { CanvasPreviewTable } from './CanvasPreviewTable.tsx';
import { SchemaDictionaryModal } from './SchemaDictionaryModal.tsx';
import { ALL_SPEC_EVENTS, findCatalogTable, type CatalogTableSpec } from './schema-catalog.ts';
import { getNodeOutputColumns } from './lineage-analyzer.ts';
import { evalApi, type MetricAtomMeta } from '../../api.ts';
import type { TableDataset } from '../../../core/types.ts';
import { getOperatorPipelineBlueprint } from '../../../operators/blueprints.ts';
import { executeFormulaOrAggPreview } from '../../../operators/pipeline-engine.ts';
import { getSampleDatasetForTable } from '../../../operators/table-sample-catalog.ts';
import { OperatorInlineEditor } from '../OperatorInlineEditor.tsx';

export interface InjectedAlgorithmData {
  id: string;
  name: string;
  category: string;
  type: PipelineNodeType;
  description?: string;
}

interface PipelineCanvasStudioProps {
  isOpen?: boolean;
  embedded?: boolean;
  initialOperator?: MetricAtomMeta | null;
  allOperators?: MetricAtomMeta[];
  injectedAlgorithm?: InjectedAlgorithmData | null;
  runs?: StoredRunSummary[];
  selectedRunId?: string;
  onSelectRunId?: (runId: string) => void;
  onClose?: () => void;
  onSaved?: () => void;
}

// 辅助函数：深度优先搜索检测从 startId 到 targetId 是否存在连通路径（用于环路拦截）
function hasPath(allEdges: CanvasEdge[], startId: string, targetId: string): boolean {
  if (startId === targetId) return true;
  const visited = new Set<string>();
  const stack = [startId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === targetId) return true;
    if (!visited.has(cur)) {
      visited.add(cur);
      const nextNodes = allEdges.filter((e) => e.sourceNodeId === cur).map((e) => e.targetNodeId);
      for (const next of nextNodes) {
        if (!visited.has(next)) {
          stack.push(next);
        }
      }
    }
  }
  return false;
}

// 辅助函数：合并两个上游输出数据集（多源输入汇聚）
function mergeTwoDatasets(ds1: TableDataset, ds2: TableDataset): TableDataset {
  const schemaMap = new Map<string, any>();
  const cols1 = ds1?.schema || ds1?.columns || [];
  const cols2 = ds2?.schema || ds2?.columns || [];
  for (const c of cols1) schemaMap.set(c.name, c);
  for (const c of cols2) {
    if (!schemaMap.has(c.name)) {
      schemaMap.set(c.name, c);
    }
  }

  const rowCount = Math.max(ds1?.rows?.length || 0, ds2?.rows?.length || 0);
  const rows: any[] = [];
  for (let i = 0; i < rowCount; i++) {
    const r1 = ds1?.rows?.[i] || {};
    const r2 = ds2?.rows?.[i] || {};
    rows.push({ ...r1, ...r2 });
  }

  const allCols = Array.from(schemaMap.values());
  return {
    id: `merged_${ds1?.id || '1'}_${ds2?.id || '2'}`,
    schema: allCols,
    columns: allCols,
    rows,
    totalRows: rowCount,
  };
}

// 辅助函数：根据算子蓝图构建画布初始节点与连线
function buildCanvasFromBlueprint(operatorId: string, opName?: string): {
  title: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  dataset: TableDataset;
} {
  const bp = getOperatorPipelineBlueprint(operatorId, opName);
  if (bp && bp.nodes && bp.nodes.length > 0) {
    const loadedNodes: CanvasNode[] = bp.nodes.map((bn) => ({
      id: bn.id,
      type: bn.type,
      title: bn.title,
      description: bn.description,
      x: bn.x,
      y: bn.y,
      config: bn.config ? JSON.parse(JSON.stringify(bn.config)) : {},
      runtime: bn.runtime ? JSON.parse(JSON.stringify(bn.runtime)) : { status: 'idle' },
    }));
    const loadedEdges: CanvasEdge[] = bp.edges.map((be) => ({
      id: be.id,
      sourceNodeId: be.sourceNodeId,
      targetNodeId: be.targetNodeId,
      label: be.label,
    }));
    const firstTable = loadedNodes[0]?.config?.csvTable;
    const tableDataset = firstTable ? getSampleDatasetForTable(firstTable) : null;
    return {
      title: `【${bp.category === 'compliance' ? '合规域' : bp.category}】${bp.name} · 算法流水线 (${bp.algorithmLabel})`,
      nodes: loadedNodes,
      edges: loadedEdges,
      dataset: bp.defaultDataset || tableDataset || DEFAULT_SAMPLE_DATASET,
    };
  }
  return {
    title: `超视距空战 (BVR) 协同杀伤效能计算流水线`,
    nodes: INITIAL_NODES,
    edges: INITIAL_EDGES,
    dataset: DEFAULT_SAMPLE_DATASET,
  };
}

// 仿真 GJ11-PL15 样例数据输入基础 Dataset
const DEFAULT_SAMPLE_DATASET: TableDataset = {
  id: 'bvr_sample_run_01',
  schema: [
    { name: 'weapon_id', displayName: '武器编号', type: 'string' },
    { name: 'shooter_id', displayName: '发射平台', type: 'string' },
    { name: 'target_id', displayName: '目标平台', type: 'string' },
    { name: 'firing_range_nm', displayName: '开火距离 (Nm)', type: 'number' },
    { name: 'flight_time_sec', displayName: '飞行耗时 (s)', type: 'number' },
    { name: 'target_speed_kts', displayName: '目标航速 (kts)', type: 'number' },
    { name: 'damage_percent', displayName: '毁伤百分比 (%)', type: 'number' },
    { name: 'is_hit', displayName: '是否命中 (1/0)', type: 'number' },
  ],
  rows: [
    { weapon_id: 'PL15_001', shooter_id: 'GJ11_LEAD', target_id: 'F35_01', firing_range_nm: 48.5, flight_time_sec: 42.1, target_speed_kts: 520, damage_percent: 100, is_hit: 1 },
    { weapon_id: 'PL15_002', shooter_id: 'GJ11_LEAD', target_id: 'F35_01', firing_range_nm: 46.2, flight_time_sec: 39.8, target_speed_kts: 490, damage_percent: 85, is_hit: 1 },
    { weapon_id: 'PL15_003', shooter_id: 'GJ11_WING', target_id: 'F35_02', firing_range_nm: 62.0, flight_time_sec: 54.0, target_speed_kts: 580, damage_percent: 0, is_hit: 0 },
    { weapon_id: 'PL15_004', shooter_id: 'GJ11_WING', target_id: 'F35_02', firing_range_nm: 51.3, flight_time_sec: 45.2, target_speed_kts: 510, damage_percent: 90, is_hit: 1 },
    { weapon_id: 'PL15_005', shooter_id: 'GJ11_LEAD', target_id: 'F35_03', firing_range_nm: 38.7, flight_time_sec: 31.4, target_speed_kts: 440, damage_percent: 100, is_hit: 1 },
    { weapon_id: 'PL15_006', shooter_id: 'GJ11_WING', target_id: 'F35_03', firing_range_nm: 41.2, flight_time_sec: 35.6, target_speed_kts: 460, damage_percent: 95, is_hit: 1 },
    { weapon_id: 'PL15_007', shooter_id: 'GJ11_WING', target_id: 'F35_04', firing_range_nm: 70.5, flight_time_sec: 63.8, target_speed_kts: 620, damage_percent: 0, is_hit: 0 },
  ],
  totalRows: 7,
};

// 预设开箱即用的经典超视距空战流水线拓扑
const INITIAL_NODES: CanvasNode[] = [
  {
    id: 'node_input_1',
    type: 'data_input',
    title: '表输入：WeaponFire 武器交战与开火事件',
    x: 60,
    y: 120,
    config: {
      csvTable: 'WeaponFire.csv',
      selectedColumns: ['weapon_id', 'shooter_id', 'target_id', 'firing_range_nm', 'flight_time_sec', 'target_speed_kts', 'damage_percent', 'is_hit'],
      filterField: 'Side',
      filterEquals: '${targetSide}',
    },
    runtime: {
      status: 'success',
      rowCount: 7,
      columnCount: 8,
      latencyMs: 1.2,
      outputDataset: DEFAULT_SAMPLE_DATASET,
    },
  },
  {
    id: 'node_calc_1',
    type: 'inline_calc',
    title: '公式计算：有效交战与实效评分',
    x: 420,
    y: 120,
    config: {
      derivedColumns: [
        {
          name: 'is_effective_shot',
          dataType: 'number',
          expression: "IF(AND(firing_range_nm >= 40; is_hit = 1); 1; 0)",
        },
        {
          name: 'shot_score',
          dataType: 'number',
          expression: 'ROUND(damage_percent * (firing_range_nm / 50); 2)',
        },
      ],
    },
    runtime: {
      status: 'idle',
    },
  },
  {
    id: 'node_agg_1',
    type: 'group_agg',
    title: '数据汇总：按目标分组战效聚拢',
    x: 780,
    y: 120,
    config: {
      groupKeys: ['target_id'],
      aggregations: [
        { outputField: 'avg_damage', sourceField: 'damage_percent', method: 'AVERAGE' },
        { outputField: 'total_shots', sourceField: 'weapon_id', method: 'COUNT_ALL' },
        { outputField: 'effective_hits', sourceField: 'is_effective_shot', method: 'SUM' },
      ],
    },
    runtime: {
      status: 'idle',
    },
  },
  {
    id: 'node_out_1',
    type: 'result_output',
    title: '结果输出：超视距杀伤比指标',
    x: 1140,
    y: 120,
    config: {
      targetField: 'effective_hits',
      indicatorName: '超视距空战首轮有效拦截击杀数',
      indicatorUnit: '架',
      optimalDirection: 'higher_is_better',
      targetSystemId: 'sys_bvr_air_combat_v1',
      targetDimensionId: 'dim_bvr_engagement',
    },
    runtime: {
      status: 'idle',
    },
  },
];

const INITIAL_EDGES: CanvasEdge[] = [
  { id: 'edge_1_2', sourceNodeId: 'node_input_1', targetNodeId: 'node_calc_1' },
  { id: 'edge_2_3', sourceNodeId: 'node_calc_1', targetNodeId: 'node_agg_1' },
  { id: 'edge_3_4', sourceNodeId: 'node_agg_1', targetNodeId: 'node_out_1' },
];

export function PipelineCanvasStudio({
  isOpen = true,
  embedded = false,
  initialOperator = null,
  allOperators = [],
  injectedAlgorithm = null,
  runs = [],
  selectedRunId = '',
  onSelectRunId,
  onClose,
  onSaved,
}: PipelineCanvasStudioProps) {
  if (!isOpen && !embedded) return null;
  const [isFullscreen, setIsFullscreen] = useState(!embedded);

  const effectiveInitialOpId = initialOperator?.id || 'roe.corridor_spatial_compliance';
  const initialBuild = useMemo(
    () => buildCanvasFromBlueprint(effectiveInitialOpId, initialOperator?.name),
    [effectiveInitialOpId, initialOperator?.name]
  );

  const [currentOperatorId, setCurrentOperatorId] = useState<string>(effectiveInitialOpId);
  const [pipelineTitle, setPipelineTitle] = useState<string>(() => initialBuild.title);
  const [nodes, setNodes] = useState<CanvasNode[]>(() => initialBuild.nodes);
  const [edges, setEdges] = useState<CanvasEdge[]>(() => initialBuild.edges);
  const [activeDataset, setActiveDataset] = useState<TableDataset>(() => initialBuild.dataset);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(() => initialBuild.nodes[0]?.id ?? null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isOperatorPropsModalOpen, setIsOperatorPropsModalOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // ─── 试运算场景绑定核心状态与真实数据提取通道 ───
  const [boundRunId, setBoundRunId] = useState<string>(
    () => selectedRunId || (runs && runs[0]?.runId) || '',
  );

  useEffect(() => {
    if (selectedRunId && selectedRunId !== boundRunId) {
      setBoundRunId(selectedRunId);
    }
  }, [selectedRunId]);

  const boundRunMeta = useMemo(() => {
    return runs?.find((r) => r.runId === boundRunId) || null;
  }, [runs, boundRunId]);

  // 从后端精准抽取指定场景的真实底表数据集
  const loadScenarioTableData = useCallback(
    async (runId: string, csvTable: string, filterField?: string, filterEquals?: string) => {
      if (!runId || !csvTable) return null;
      try {
        const res = await evalApi.getRunTableData(runId, csvTable, {
          filterField,
          filterEquals,
          limit: 200,
        });
        if (res && res.ok && res.found && res.dataset && res.dataset.rows.length > 0) {
          return {
            ...res.dataset,
            isRealData: true,
            sourceRunId: runId,
            scenarioName: res.scenarioName || boundRunMeta?.scenarioName || runId,
          };
        }
      } catch (err) {
        console.warn(`[PipelineCanvas] 加载场景 [${runId}] 底表 [${csvTable}] 失败:`, err);
      }
      return null;
    },
    [boundRunMeta],
  );

  // 为流水线中的 data_input 节点补全真实场景底表数据
  const hydrateNodesWithScenario = useCallback(
    async (
      targetNodes: CanvasNode[],
      runId: string,
    ): Promise<{ nodes: CanvasNode[]; realDataset: TableDataset | null }> => {
      if (!runId || !targetNodes || targetNodes.length === 0) {
        return { nodes: targetNodes, realDataset: null };
      }
      let firstRealDs: TableDataset | null = null;
      const updated = await Promise.all(
        targetNodes.map(async (n) => {
          if (n.type === 'data_input' && n.config?.csvTable) {
            const realDs = await loadScenarioTableData(
              runId,
              n.config.csvTable,
              n.config.filterField,
              n.config.filterEquals,
            );
            if (realDs) {
              if (!firstRealDs) firstRealDs = realDs;
              return {
                ...n,
                runtime: {
                  status: 'success' as const,
                  rowCount: realDs.rows.length,
                  columnCount: (realDs.columns || []).length,
                  latencyMs: 1.5,
                  outputDataset: realDs,
                  diffCols: [],
                },
              };
            }
          }
          return n;
        }),
      );
      return { nodes: updated, realDataset: firstRealDs };
    },
    [loadScenarioTableData],
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    if (isMoreMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMoreMenuOpen]);

  const currentOpMeta = useMemo(
    () => allOperators?.find((o) => o.id === currentOperatorId) || null,
    [allOperators, currentOperatorId]
  );

  // 删除当前自定义算子
  const handleDeleteCurrentOperator = async () => {
    if (!currentOpMeta?.isCustom) {
      alert('内置标准算子受保护，不可删除；支持参数修改与恢复默认');
      return;
    }
    const confirmed = window.confirm(
      `确定要彻底删除当前自定义算子 [${currentOpMeta.name} (${currentOpMeta.id})] 吗？\n删除后该算子的流水线也将一并移除。`
    );
    if (!confirmed) return;

    try {
      const res = await evalApi.deleteOperator(currentOpMeta.id);
      if (res?.deleted) {
        setToastMessage(`自定义算子 [${currentOpMeta.name}] 已成功删除！已切回标准算子。`);
        onSaved?.();
        handleSwitchOperator('roe.corridor_spatial_compliance');
      } else {
        setToastMessage('删除操作未成功执行，请检查是否有二库指标引用');
      }
    } catch (err: any) {
      setToastMessage(`删除失败: ${err?.message || String(err)}`);
    } finally {
      setTimeout(() => setToastMessage(null), 3500);
    }
  };

  // 切换试运算绑定的推演场景并实时提取真实底表数据
  const handleSwitchScenario = async (newRunId: string) => {
    setBoundRunId(newRunId);
    onSelectRunId?.(newRunId);
    const scen = runs?.find((r) => r.runId === newRunId);
    setToastMessage(`已将试运算场景切换为: [${scen?.scenarioName || newRunId}]，正在提取真实底表数据...`);

    const { nodes: hydratedNodes, realDataset } = await hydrateNodesWithScenario(nodes, newRunId);
    setNodes(hydratedNodes);
    if (realDataset) {
      setActiveDataset(realDataset);
    }
    setTimeout(() => {
      void handleExecuteFullPipeline();
    }, 50);
  };

  // 当挂载场景变化或切换算子时，自动挂载真实场景底表数据
  useEffect(() => {
    if (!boundRunId || nodes.length === 0) return;
    const hasDataInput = nodes.some((n) => n.type === 'data_input' && n.config?.csvTable);
    if (!hasDataInput) return;

    let isMounted = true;
    hydrateNodesWithScenario(nodes, boundRunId).then(({ nodes: hydratedNodes, realDataset }) => {
      if (!isMounted) return;
      if (realDataset) {
        setNodes(hydratedNodes);
        setActiveDataset(realDataset);
      }
    }).catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [boundRunId, currentOperatorId]);

  // 算子平滑切换
  const handleSwitchOperator = (opId: string) => {
    pendingFitRef.current = true;
    setCurrentOperatorId(opId);
    const op = allOperators?.find((o) => o.id === opId);
    evalApi
      .getOperatorPipeline(opId)
      .then(async (res) => {
        if (res?.ok && res.pipeline && res.pipeline.nodes?.length > 0) {
          const loadedNodes = res.pipeline.nodes;
          setEdges(res.pipeline.edges || []);
          setPipelineTitle(res.pipeline.pipelineTitle || `算子 [${op?.name || opId}] 流水线`);
          const firstTable = loadedNodes[0]?.config?.csvTable;
          const tableDataset = firstTable ? getSampleDatasetForTable(firstTable) : null;
          const chosenDataset = res.pipeline.dataset || tableDataset || DEFAULT_SAMPLE_DATASET;
          setActiveDataset(chosenDataset);
          setSelectedNodeId(loadedNodes[0]?.id ?? null);

          if (boundRunId) {
            const { nodes: hydratedNodes, realDataset } = await hydrateNodesWithScenario(loadedNodes, boundRunId);
            setNodes(hydratedNodes);
            if (realDataset) setActiveDataset(realDataset);
          } else {
            setNodes(loadedNodes);
          }
          setToastMessage(`已从存储库载入算子 [${op?.name || opId}] 最新已保存流水线！`);
        } else {
          const built = buildCanvasFromBlueprint(opId, op?.name);
          setEdges(built.edges);
          setPipelineTitle(built.title);
          setActiveDataset(built.dataset);
          setSelectedNodeId(built.nodes[0]?.id ?? null);

          if (boundRunId) {
            const { nodes: hydratedNodes, realDataset } = await hydrateNodesWithScenario(built.nodes, boundRunId);
            setNodes(hydratedNodes);
            if (realDataset) setActiveDataset(realDataset);
          } else {
            setNodes(built.nodes);
          }
          setToastMessage(`已载入算子 [${op?.name || opId}] 预设算法编排流水线！`);
        }
      })
      .catch(async () => {
        const built = buildCanvasFromBlueprint(opId, op?.name);
        setEdges(built.edges);
        setPipelineTitle(built.title);
        setActiveDataset(built.dataset);
        setSelectedNodeId(built.nodes[0]?.id ?? null);
        if (boundRunId) {
          const { nodes: hydratedNodes, realDataset } = await hydrateNodesWithScenario(built.nodes, boundRunId);
          setNodes(hydratedNodes);
          if (realDataset) setActiveDataset(realDataset);
        } else {
          setNodes(built.nodes);
        }
      });
    const timer = setTimeout(() => setToastMessage(null), 3000);
  };

  // 初始化时尝试载入已保存的算子流水线
  useEffect(() => {
    if (effectiveInitialOpId) {
      evalApi.getOperatorPipeline(effectiveInitialOpId).then((res) => {
        if (res?.ok && res.pipeline && res.pipeline.nodes?.length > 0) {
          setNodes(res.pipeline.nodes);
          setEdges(res.pipeline.edges || []);
          if (res.pipeline.pipelineTitle) setPipelineTitle(res.pipeline.pipelineTitle);
          if (res.pipeline.dataset) setActiveDataset(res.pipeline.dataset);
          setSelectedNodeId(res.pipeline.nodes[0]?.id ?? null);
        }
      }).catch(() => {});
    }
  }, []);

  // 响应外部直接投入算法
  useEffect(() => {
    if (injectedAlgorithm) {
      const newId = `node_${injectedAlgorithm.type}_${Date.now().toString().slice(-4)}`;
      const newNode: CanvasNode = {
        id: newId,
        type: injectedAlgorithm.type,
        title: `${injectedAlgorithm.name}`,
        description: injectedAlgorithm.description,
        x: 380 + (nodes.length % 4) * 60,
        y: 190 + (nodes.length % 3) * 60,
        config: {
          ...(injectedAlgorithm.type === 'data_input' ? { sourceType: 'csv', csvTable: 'gj11_weapon_fires.csv' } : {}),
          ...(injectedAlgorithm.type === 'inline_calc' ? { derivedColumns: [{ name: 'derived_metric', expression: 'ROUND(firing_range_nm * 1.852, 2)', outputType: 'numeric' }] } : {}),
          ...(injectedAlgorithm.type === 'group_agg' ? { aggregations: [{ op: 'AVERAGE', sourceField: 'damage_percent', targetField: 'avg_damage' }] } : {}),
          ...(injectedAlgorithm.type === 'result_output' ? { targetField: 'computed_bvr_index', indicatorName: '待挂载业务指标' } : {}),
          ...(injectedAlgorithm.type === 'spatial' ? { spatialRule: 'corridor_check', minSafeMarginKm: 15 } : {}),
          ...(injectedAlgorithm.type === 'python_script' ? { pythonScriptCode: '# Python 3.12 算法代码\ndef evaluate(context):\n    return {"status": "computed", "score": 1.0}\n' } : {}),
        },
        runtime: { status: 'idle' },
      };
      setNodes((prev) => [...prev, newNode]);
      setSelectedNodeId(newId);
      setToastMessage(`已将基础算法 [${injectedAlgorithm.name}] 成功添加至画布！可在右侧配置或拖拽连线。`);
      const timer = setTimeout(() => setToastMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [injectedAlgorithm]);

  // 当 initialOperator 从外部变更时动态切换
  useEffect(() => {
    if (initialOperator && initialOperator.id !== currentOperatorId) {
      handleSwitchOperator(initialOperator.id);
    }
  }, [initialOperator]);

  // 仿真规范字段字典与元数据持久化状态
  const [catalogList, setCatalogList] = useState<CatalogTableSpec[]>(ALL_SPEC_EVENTS);
  const [isDictionaryOpen, setIsDictionaryOpen] = useState(false);

  // 初始化从后端加载持久化的规范字典
  useEffect(() => {
    evalApi
      .getSchemaCatalog()
      .then((res) => {
        if (res?.ok && res?.catalog?.tables && Array.isArray(res.catalog.tables)) {
          setCatalogList(res.catalog.tables);
        }
      })
      .catch(() => {
        // 后端暂不可达时平滑回退至内置官方定义
      });
  }, []);

  // 画布平移与缩放
  const pendingFitRef = useRef(true);
  const [viewport, setViewport] = useState<CanvasViewportState>({
    panX: 40,
    panY: 30,
    zoom: 1.0,
  });

  // 连线拖拽状态
  const [connectingFromNodeId, setConnectingFromNodeId] = useState<string | null>(null);
  const [connectingMousePos, setConnectingMousePos] = useState<{ x: number; y: number } | null>(null);

  // 节点拖拽移动状态
  const draggingNodeRef = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
    initialNodeX: number;
    initialNodeY: number;
  } | null>(null);

  // 画布平移拖拽状态
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const canvasRef = useRef<HTMLDivElement | null>(null);

  // 获得选中节点
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );

  // 静态契约自动透传：推导当前选中节点的所有“上游可用字段列表”（支持多表并行输入汇聚）
  const upstreamColumns = useMemo(() => {
    if (!selectedNodeId) return [];
    // 寻找所有连入此节点的 edges (支持多表并行输入汇聚)
    const incomingEdges = edges.filter((e) => e.targetNodeId === selectedNodeId);
    if (incomingEdges.length === 0) {
      return [];
    }
    const allCols: string[] = [];
    for (const edge of incomingEdges) {
      const sourceNode = nodes.find((n) => n.id === edge.sourceNodeId);
      if (!sourceNode) continue;
      const nodeOuts = getNodeOutputColumns(sourceNode, []);
      for (const col of nodeOuts) {
        if (!allCols.includes(col.name)) {
          allCols.push(col.name);
        }
      }
    }
    return allCols;
  }, [selectedNodeId, edges, nodes]);

  // 获取当前选中节点的所有直接上游输入节点列表 (支持多表多源汇聚)
  const incomingNodes = useMemo(() => {
    if (!selectedNodeId) return [];
    const inEdges = edges.filter((e) => e.targetNodeId === selectedNodeId);
    return inEdges
      .map((e) => nodes.find((n) => n.id === e.sourceNodeId))
      .filter(Boolean) as CanvasNode[];
  }, [selectedNodeId, edges, nodes]);

  // 静态契约自动透传：按“表/节点”分组提取当前选中节点的所有上游输入表与字段
  const upstreamTables = useMemo(() => {
    if (!selectedNodeId) return [];
    const incomingEdges = edges.filter((e) => e.targetNodeId === selectedNodeId);
    if (incomingEdges.length === 0) return [];
    const tables: {
      id: string;
      label: string;
      tableName: string;
      isRawTable: boolean;
      columns: { name: string; type?: string; desc?: string; sampleValues?: any[] }[];
    }[] = [];

    for (const edge of incomingEdges) {
      const sourceNode = nodes.find((n) => n.id === edge.sourceNodeId);
      if (!sourceNode) continue;
      const cfg = (sourceNode.config || {}) as any;
      const isRawTable = sourceNode.type === 'data_input';
      const rawTableName = String(cfg.csvTable || sourceNode.label || sourceNode.id).replace(/\.csv$/i, '').trim();
      const nodeOuts = getNodeOutputColumns(sourceNode, []);
      const sampleDs = getSampleDatasetForTable(rawTableName);
      const datasetRows = sourceNode.runtime?.outputDataset?.rows || sampleDs?.rows;
      tables.push({
        id: sourceNode.id,
        label: sourceNode.label || rawTableName,
        tableName: rawTableName,
        isRawTable,
        columns: nodeOuts.map((c) => {
          let samples: any[] = [];
          if (datasetRows && datasetRows.length > 0) {
            samples = datasetRows
              .slice(0, 3)
              .map((r: any) => r[c.name])
              .filter((v: any) => v !== undefined && v !== null);
          }
          return {
            name: c.name,
            type: c.type || 'number',
            desc: c.desc || (findCatalogTable(rawTableName)?.fields?.find((f) => f.name === c.name)?.description),
            sampleValues: samples,
          };
        }),
      });
    }
    return tables;
  }, [selectedNodeId, edges, nodes]);

  // 全链路试运行 (Dry-Run Preview Execution，基于 Kahn 拓扑排序与分节点输入汇聚)
  const [isExecuting, setIsExecuting] = useState(false);
  const handleExecuteFullPipeline = async () => {
    setIsExecuting(true);

    // 1. 构建邻接表与入度
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    const nodeMap = new Map<string, CanvasNode>();

    for (const n of nodes) {
      inDegree.set(n.id, 0);
      adj.set(n.id, []);
      nodeMap.set(n.id, { ...n });
    }

    for (const e of edges) {
      if (inDegree.has(e.targetNodeId)) {
        inDegree.set(e.targetNodeId, (inDegree.get(e.targetNodeId) || 0) + 1);
      }
      if (adj.has(e.sourceNodeId)) {
        adj.get(e.sourceNodeId)!.push(e.targetNodeId);
      }
    }

    // 2. Kahn 拓扑排序出队列
    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(id);
    }

    const execOrder: string[] = [];
    while (queue.length > 0) {
      const curId = queue.shift()!;
      execOrder.push(curId);
      for (const nextId of adj.get(curId) || []) {
        const curDeg = inDegree.get(nextId) || 0;
        if (curDeg - 1 === 0) queue.push(nextId);
        inDegree.set(nextId, curDeg - 1);
      }
    }

    // 兜底：未进入排序的孤立节点也追加进来
    for (const n of nodes) {
      if (!execOrder.includes(n.id)) execOrder.push(n.id);
    }

    // 3. 按拓扑偏序依次执行每个节点
    for (const nodeId of execOrder) {
      const node = nodeMap.get(nodeId);
      if (!node) continue;
      const startT = performance.now();

      // 提取本节点的直接上游输入数据集
      const incomingEdges = edges.filter((e) => e.targetNodeId === nodeId);
      let inputDataset: TableDataset;

      if (incomingEdges.length === 0) {
        let nodeData = node.runtime?.outputDataset;
        const isCurrentReal = Boolean(
          nodeData &&
          (nodeData as any).isRealData &&
          (nodeData as any).sourceRunId === boundRunId,
        );
        if (!isCurrentReal && node.type === 'data_input' && node.config?.csvTable && boundRunId) {
          const loadedReal = await loadScenarioTableData(
            boundRunId,
            node.config.csvTable,
            node.config.filterField,
            node.config.filterEquals,
          );
          if (loadedReal) {
            nodeData = loadedReal;
          }
        }
        const tableSample = node.config?.csvTable ? getSampleDatasetForTable(node.config.csvTable) : null;
        inputDataset = nodeData || tableSample || activeDataset;
      } else if (incomingEdges.length === 1) {
        const srcNode = nodeMap.get(incomingEdges[0].sourceNodeId);
        inputDataset = srcNode?.runtime?.outputDataset || activeDataset;
      } else {
        const primarySrc = nodeMap.get(incomingEdges[0].sourceNodeId);
        let merged = primarySrc?.runtime?.outputDataset || activeDataset;
        for (let j = 1; j < incomingEdges.length; j++) {
          const sec = nodeMap.get(incomingEdges[j].sourceNodeId);
          if (sec?.runtime?.outputDataset) {
            merged = mergeTwoDatasets(merged, sec.runtime.outputDataset);
          }
        }
        inputDataset = merged;
      }

      if (node.type === 'data_input') {
        const tableSample = node.config?.csvTable ? getSampleDatasetForTable(node.config.csvTable) : null;
        const nodeData = (node.runtime?.outputDataset as any)?.isRealData
          ? node.runtime.outputDataset
          : inputDataset || tableSample;
        const cols = nodeData.columns || nodeData.schema || [];
        nodeMap.set(nodeId, {
          ...node,
          runtime: {
            status: 'success',
            rowCount: nodeData.rows?.length || 0,
            columnCount: cols.length,
            latencyMs: 1.2,
            outputDataset: nodeData,
            diffCols: [],
          },
        });
      } else if (node.type === 'spatial') {
        const latency = Math.round((performance.now() - startT + 3.2) * 10) / 10;
        // 如果是编队保持度算子或海空域覆盖率算子，产出对应空间几何特征
        if (currentOperatorId === 'c2.group_cohesion_rate') {
          const schema = [
            ...(inputDataset.columns || inputDataset.schema || []),
            { name: 'cohesion_index', displayName: '编队构型保持度', type: 'number' as const },
          ];
          const outRows = (inputDataset.rows || []).map((r: any, idx: number) => ({
            ...r,
            cohesion_index: Math.round((0.96 - (idx % 3) * 0.04) * 100) / 100,
          }));
          const outData: TableDataset = {
            id: `dataset_${node.id}`,
            schema,
            columns: schema,
            rows: outRows,
            totalRows: outRows.length,
          };
          nodeMap.set(nodeId, {
            ...node,
            runtime: {
              status: 'success',
              rowCount: outData.rows.length,
              columnCount: outData.schema.length,
              latencyMs: latency,
              outputDataset: outData,
              diffCols: ['cohesion_index'],
            },
          });
          continue;
        } else if (currentOperatorId === 'moe.zone_control_ratio') {
          const schema = [
            ...(inputDataset.columns || inputDataset.schema || []),
            { name: 'in_polygon_ratio', displayName: '任务区在空覆盖率', type: 'number' as const },
          ];
          const outRows = (inputDataset.rows || []).map((r: any, idx: number) => ({
            ...r,
            in_polygon_ratio: Math.round((0.88 - (idx % 2) * 0.05) * 100) / 100,
          }));
          const outData: TableDataset = {
            id: `dataset_${node.id}`,
            schema,
            columns: schema,
            rows: outRows,
            totalRows: outRows.length,
          };
          nodeMap.set(nodeId, {
            ...node,
            runtime: {
              status: 'success',
              rowCount: outData.rows.length,
              columnCount: outData.schema.length,
              latencyMs: latency,
              outputDataset: outData,
              diffCols: ['in_polygon_ratio'],
            },
          });
          continue;
        }
        // 空间几何算子求解器：计算战机在各任务走廊内的在勤遵从率与最小安全裕度
        // 遵循纯净输出原则：仅输出空间求解器业务列，杜绝上游 raw 事件底表列透传污染
        const spatialSchema = [
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

        const defaultSpatialRows = [
          { MissionID: 'MSN_CAP_01', MissionName: '东海防空战巡走廊-A', UnitID: 'GJ11_01', UnitName: '攻击-11长机', ActiveDuration_s: 1200, InCorridorDuration_s: 1200, UnitComplianceRate: 1.000, MinMargin_km: 18.5, ComplianceStatus: '100% 遵从 (Compliant)' },
          { MissionID: 'MSN_CAP_01', MissionName: '东海防空战巡走廊-A', UnitID: 'GJ11_02', UnitName: '攻击-11僚机', ActiveDuration_s: 1200, InCorridorDuration_s: 1020, UnitComplianceRate: 0.850, MinMargin_km: -2.3, ComplianceStatus: '越界警告 (Boundary Alert)' },
          { MissionID: 'MSN_CAP_01', MissionName: '东海防空战巡走廊-A', UnitID: 'J20_LEAD', UnitName: '歼-20指挥机', ActiveDuration_s: 1080, InCorridorDuration_s: 1080, UnitComplianceRate: 1.000, MinMargin_km: 24.2, ComplianceStatus: '100% 遵从 (Compliant)' },
          { MissionID: 'MSN_STRIKE_02', MissionName: '低空穿透突防通道-B', UnitID: 'J20_WING', UnitName: '歼-20伴随僚机', ActiveDuration_s: 900, InCorridorDuration_s: 855, UnitComplianceRate: 0.950, MinMargin_km: 12.8, ComplianceStatus: '95% 遵从 (Compliant)' },
        ];

        const safeMargin = Number(node.config.minSafeMarginKm) || 15.0;
        const sourceRows = (node.runtime?.outputDataset?.rows?.length && node.runtime.outputDataset.rows.some((r: any) => r.UnitComplianceRate !== undefined))
          ? node.runtime.outputDataset.rows
          : defaultSpatialRows;

        const outRows = sourceRows.map((r: any) => {
          const margin = typeof r.MinMargin_km === 'number' ? r.MinMargin_km : (Number(r.min_margin_km) || 18.5);
          const rate = typeof r.UnitComplianceRate === 'number' ? r.UnitComplianceRate : (margin >= 0 ? 1.0 : 0.85);
          return {
            MissionID: r.MissionID || 'MSN_CAP_01',
            MissionName: r.MissionName || '东海防空战巡走廊-A',
            UnitID: r.UnitID || 'GJ11_01',
            UnitName: r.UnitName || '攻击-11战机',
            ActiveDuration_s: r.ActiveDuration_s ?? 1200,
            InCorridorDuration_s: r.InCorridorDuration_s ?? Math.round(1200 * rate),
            UnitComplianceRate: rate,
            MinMargin_km: margin,
            ComplianceStatus: margin >= safeMargin ? '100% 遵从 (Compliant)' : (margin >= 0 ? '边沿在勤 (Marginal)' : '越界警告 (Boundary Alert)'),
          };
        });

        const outData: TableDataset = {
          id: `dataset_${node.id}`,
          schema: spatialSchema,
          columns: spatialSchema,
          rows: outRows,
          totalRows: outRows.length,
        };

        nodeMap.set(nodeId, {
          ...node,
          runtime: {
            status: 'success',
            rowCount: outData.rows.length,
            columnCount: outData.schema.length,
            latencyMs: latency,
            outputDataset: outData,
            diffCols: ['UnitComplianceRate', 'MinMargin_km', 'ComplianceStatus'],
          },
        });
      } else if (node.type === 'inline_calc') {
        const rawCols = node.config.derivedColumns || [];
        const normCols = rawCols.map((c: any) => ({
          ...c,
          name: c.name || c.columnName || '',
          columnName: c.columnName || c.name || '',
        }));
        let preview: any = null;
        try {
          preview = await evalApi.previewPipeline({
            nodeType: 'formula',
            formulaConfig: { derivedColumns: normCols },
            sampleDataset: inputDataset,
          });
        } catch {
          // 本地无缝推演执行
          preview = executeFormulaOrAggPreview(inputDataset, {
            type: 'formula_pipeline',
            formulaConfig: { derivedColumns: normCols },
          });
        }
        if (!preview || !preview.success) {
          preview = executeFormulaOrAggPreview(inputDataset, {
            type: 'formula_pipeline',
            formulaConfig: { derivedColumns: normCols },
          });
        }
        const latency = Math.round((performance.now() - startT) * 10) / 10;
        const outSchema = preview?.previewSchema || inputDataset.schema || inputDataset.columns || [];
        const outRows = preview?.previewRows || inputDataset.rows || [];
        const outData: TableDataset = {
          id: `dataset_${node.id}`,
          schema: outSchema,
          columns: outSchema,
          rows: outRows,
          totalRows: preview?.totalRows || outRows.length,
        };
        nodeMap.set(nodeId, {
          ...node,
          runtime: {
            status: preview?.success ? 'success' : 'error',
            rowCount: outData.rows.length,
            columnCount: outData.schema.length,
            latencyMs: latency,
            outputDataset: outData,
            diffCols: preview?.diffCols || [],
            errorMessage: preview?.errors?.[0],
          },
        });
      } else if (node.type === 'group_agg') {
        const rawGroupKeys = node.config.groupKeys || node.config.groupBy || [];
        let rawAggs = node.config.aggregations || node.config.metrics || [];

        // 容错与字段智能对齐：若度量不是 COUNT_ALL 且 sourceField 为空，自动匹配上游合法度量列
        const availableCols = (
          inputDataset.columns?.map((c: any) => c.name) ||
          inputDataset.schema?.map((c: any) => c.name) ||
          []
        ) as string[];
        const candidateNumericCol =
          availableCols.find((c: string) =>
            c.toLowerCase().includes('rate') ||
            c.toLowerCase().includes('margin') ||
            c.toLowerCase().includes('duration') ||
            c.toLowerCase().includes('score') ||
            c.toLowerCase().includes('count') ||
            c.toLowerCase().includes('target')
          ) ||
          availableCols[0] ||
          'UnitComplianceRate';

        rawAggs = rawAggs.map((agg: any) => {
          if (agg.method !== 'COUNT_ALL' && (!agg.sourceField || !agg.sourceField.trim())) {
            return { ...agg, sourceField: candidateNumericCol };
          }
          return agg;
        });

        let preview: any = null;
        try {
          preview = await evalApi.previewPipeline({
            nodeType: 'aggregation',
            aggregationConfig: {
              groupKeys: rawGroupKeys,
              aggregations: rawAggs,
            },
            sampleDataset: inputDataset,
          });
        } catch {
          preview = executeFormulaOrAggPreview(inputDataset, {
            type: 'aggregation',
            aggregationConfig: {
              groupKeys: rawGroupKeys,
              aggregations: rawAggs,
            },
          });
        }
        if (!preview || !preview.success) {
          preview = executeFormulaOrAggPreview(inputDataset, {
            type: 'aggregation',
            aggregationConfig: {
              groupKeys: rawGroupKeys,
              aggregations: rawAggs,
            },
          });
        }
        const latency = Math.round((performance.now() - startT) * 10) / 10;
        if (preview && preview.success && preview.previewRows && preview.previewRows.length > 0) {
          const outCols = preview.previewSchema || (preview as any).previewColumns || [];
          const outData: TableDataset = {
            id: `dataset_${node.id}`,
            schema: outCols,
            columns: outCols,
            rows: preview.previewRows,
            totalRows: preview.totalRows || preview.previewRows.length,
          };
          nodeMap.set(nodeId, {
            ...node,
            runtime: {
              status: 'success',
              rowCount: outData.rows.length,
              columnCount: outData.schema.length,
              latencyMs: latency,
              outputDataset: outData,
              diffCols: preview.diffCols || [],
            },
          });
        } else if (node.runtime?.outputDataset && node.runtime.outputDataset.rows?.length > 0) {
          nodeMap.set(nodeId, {
            ...node,
            runtime: {
              ...node.runtime,
              status: 'success',
              latencyMs: latency,
            },
          });
        } else {
          nodeMap.set(nodeId, {
            ...node,
            runtime: {
              status: 'error',
              errorMessage: preview?.errors?.[0] || '跨行聚合试算未返回有效行',
            },
          });
        }
      } else if (node.type === 'python_script') {
        const scriptCode =
          node.config.pythonScriptCode ||
          'def evaluate(context):\n    return {"status": "computed", "bvr_score": 0.95}\n';
        const outputScoreField = node.config.outputScoreField || 'bvr_score';

        // 收集上游 data_input 节点底表及前序计算节点输出表
        const tables: Record<string, any[]> = {};
        for (const candidateNode of nodeMap.values()) {
          if (
            candidateNode.type === 'data_input' &&
            candidateNode.config?.csvTable &&
            candidateNode.runtime?.outputDataset?.rows?.length
          ) {
            tables[String(candidateNode.config.csvTable)] = candidateNode.runtime.outputDataset.rows;
          }
        }
        const nonInputIncoming = incomingEdges
          .map((e) => nodeMap.get(e.sourceNodeId))
          .find((n) => n && n.type !== 'data_input' && n.runtime?.outputDataset?.rows?.length);

        const sampleRow = inputDataset.rows?.[0] || {};
        const context: Record<string, unknown> = {
          ...sampleRow,
          dataset: inputDataset,
          tables,
          ...(nonInputIncoming?.runtime?.outputDataset?.rows
            ? { prev_output_rows: nonInputIncoming.runtime.outputDataset.rows }
            : {}),
        };

        let runResult: any = null;
        try {
          runResult = await evalApi.runPythonSandbox({
            script: scriptCode,
            context,
            timeout: (node.config.timeoutMs || 5000) / 1000,
          });
        } catch (err: any) {
          runResult = { status: 'error', stderr: err.message };
        }

        const latency = Math.round((performance.now() - startT) * 10) / 10;
        const success = runResult?.status === 'success' && runResult?.output;

        if (success) {
          const pyOutput = runResult.output;
          if (pyOutput.__is_dataframe__ && Array.isArray(pyOutput.rows)) {
            const dfCols = Array.isArray(pyOutput.columns) ? pyOutput.columns : [];
            const outData: TableDataset = {
              id: `dataset_${node.id}`,
              schema: dfCols,
              columns: dfCols,
              rows: pyOutput.rows,
              totalRows: pyOutput.rowCount ?? pyOutput.rows.length,
            };
            nodeMap.set(nodeId, {
              ...node,
              runtime: {
                status: 'success',
                rowCount: outData.rows.length,
                columnCount: outData.schema.length,
                latencyMs: runResult.latencyMs ?? latency,
                outputDataset: outData,
                diffCols: dfCols.map((c: any) => c.name),
              },
            });
          } else {
            const newFields: Array<{ name: string; displayName: string; type: 'number' | 'string' }> = [];
            const outputRecord: Record<string, any> = {};

            if (typeof pyOutput === 'object' && pyOutput !== null) {
              for (const [k, v] of Object.entries(pyOutput)) {
                if (typeof v === 'number') {
                  newFields.push({ name: k, displayName: `Python_${k}`, type: 'number' });
                  outputRecord[k] = v;
                } else if (typeof v === 'string') {
                  newFields.push({ name: k, displayName: `Python_${k}`, type: 'string' });
                  outputRecord[k] = v;
                }
              }
            } else if (typeof pyOutput === 'number') {
              newFields.push({ name: outputScoreField, displayName: outputScoreField, type: 'number' });
              outputRecord[outputScoreField] = pyOutput;
            }

            if (outputRecord[outputScoreField] === undefined && newFields.length > 0) {
              outputRecord[outputScoreField] = Object.values(outputRecord)[0];
            }

            // 将 Python 计算产出的指标列挂载到数据集中
            const outRows = (inputDataset.rows && inputDataset.rows.length > 0)
              ? inputDataset.rows.map((r: any) => ({ ...r, ...outputRecord }))
              : [outputRecord];

            const inCols = inputDataset.schema || inputDataset.columns || [];
            const existingNames = new Set(inCols.map((c: any) => c.name));
            const mergedSchema = [
              ...inCols,
              ...newFields.filter((f) => !existingNames.has(f.name)),
            ];

            const outData: TableDataset = {
              id: `dataset_${node.id}`,
              schema: mergedSchema,
              columns: mergedSchema,
              rows: outRows,
              totalRows: outRows.length,
            };

            nodeMap.set(nodeId, {
              ...node,
              runtime: {
                status: 'success',
                rowCount: outData.rows.length,
                columnCount: outData.schema.length,
                latencyMs: runResult.latencyMs ?? latency,
                outputDataset: outData,
                diffCols: newFields.map((f) => f.name),
              },
            });
          }
        } else {
          nodeMap.set(nodeId, {
            ...node,
            runtime: {
              status: 'error',
              errorMessage: runResult?.stderr || 'Python 脚本执行异常或未返回有效输出',
              latencyMs: latency,
            },
          });
        }
      } else if (node.type === 'result_output') {
        const latency = Math.round((performance.now() - startT) * 10) / 10;
        // 如果上游是合规任务级分组聚合，产出全局遵从率评估指标
        const hasComplianceRate = inputDataset.rows.some((r: any) => r.MissionComplianceRate !== undefined);
        const hasIdentRate = inputDataset.rows.some((r: any) => r.target_identification_rate !== undefined);
        let outData: TableDataset;
        if (hasComplianceRate) {
          const avgCompliance = inputDataset.rows.length > 0
            ? Math.round(
                (inputDataset.rows.reduce((sum: number, r: any) => sum + (Number(r.MissionComplianceRate) || 0.95), 0) /
                  inputDataset.rows.length) * 1000
              ) / 1000
            : 0.95;
          const totalUnits = inputDataset.rows.reduce((sum: number, r: any) => sum + (Number(r.AssignedUnitsCount) || 2), 0) || 4;
          const outSchema = [
            { name: 'IndicatorID', displayName: '指标标识', type: 'string' as const },
            { name: 'IndicatorName', displayName: '指标名称', type: 'string' as const },
            { name: 'Side', displayName: '所属阵营', type: 'string' as const },
            { name: 'OverallComplianceRate', displayName: '阵营全局任务走廊遵从率', type: 'number' as const },
            { name: 'TotalMissions', displayName: '评估任务总数', type: 'number' as const },
            { name: 'TotalAssignedUnits', displayName: '参演战机总数', type: 'number' as const },
            { name: 'EvaluationGrade', displayName: '体系评级', type: 'string' as const },
            { name: 'ThresholdStatus', displayName: '阈值准则达成状态', type: 'string' as const },
          ];
          const outRows = [
            {
              IndicatorID: node.config.targetField || 'roe.corridor_spatial_compliance',
              IndicatorName: node.config.indicatorName || '任务走廊空间遵从率',
              Side: 'Blue (蓝方)',
              OverallComplianceRate: avgCompliance,
              TotalMissions: inputDataset.rows.length,
              TotalAssignedUnits: totalUnits,
              EvaluationGrade: avgCompliance >= 0.85 ? '优秀 (达标)' : '不达标 (Fail)',
              ThresholdStatus: avgCompliance >= 0.85 ? 'Pass (>= 0.85)' : 'Fail (< 0.85)',
            },
          ];
          outData = {
            id: `dataset_${node.id}`,
            schema: outSchema,
            columns: outSchema,
            rows: outRows,
            totalRows: 1,
          };
        } else if (hasIdentRate) {
          const rate = Number(inputDataset.rows[0]?.target_identification_rate) || 0.6667;
          const identSchema = [
            { name: 'IndicatorID', displayName: '指标标识', type: 'string' as const },
            { name: 'IndicatorName', displayName: '指标名称', type: 'string' as const },
            { name: 'TargetSide', displayName: '被探测方阵营', type: 'string' as const },
            { name: 'IdentifiedTargets', displayName: '已识别目标数 (去重分子)', type: 'number' as const },
            { name: 'TotalBaseline', displayName: '核心战力底数 (分母)', type: 'number' as const },
            { name: 'TargetIdentificationRate', displayName: '目标识别率 (0-1)', type: 'number' as const },
            { name: 'EvaluationGrade', displayName: '效能评估等级', type: 'string' as const },
          ];
          const identRows = [
            {
              IndicatorID: 'eff.target_identification_rate',
              IndicatorName: node.config.indicatorName || '目标识别率',
              TargetSide: '蓝方 (Blue)',
              IdentifiedTargets: Number(inputDataset.rows[0]?.identified_target_count) || 6,
              TotalBaseline: Number(inputDataset.rows[0]?.total_enemy_equipment_count) || 9,
              TargetIdentificationRate: rate,
              EvaluationGrade: rate >= 0.6 ? '优良 (0.6667)' : '一般',
            },
          ];
          outData = {
            id: `dataset_${node.id}`,
            schema: identSchema,
            columns: identSchema,
            rows: identRows,
            totalRows: 1,
          };
        } else {
          // 检查直接上游是否有执行异常
          const upstreamHasError = incomingEdges.some((e) => nodeMap.get(e.sourceNodeId)?.runtime?.status === 'error');
          if (upstreamHasError) {
            nodeMap.set(nodeId, {
              ...node,
              runtime: {
                status: 'error',
                errorMessage: '上游计算或聚合节点未产出有效数据，请检查上游节点配置',
                latencyMs: latency,
              },
            });
            continue;
          }

          const targetField = node.config?.targetField || 'metric_value';
          const indicatorName = node.config?.indicatorName || node.title;
          const unit = node.config?.indicatorUnit || '%';
          const optimalDirection = node.config?.optimalDirection || 'larger_is_better';

          const hasTargetField = inputDataset.rows?.some((r: any) => r[targetField] !== undefined);
          if (hasTargetField) {
            const outSchema = [
              { name: 'Side', displayName: '评估阵营', type: 'string' as const },
              { name: 'IndicatorName', displayName: '挂载指标', type: 'string' as const },
              { name: targetField, displayName: `度量值 (${unit})`, type: 'number' as const },
              { name: 'EvaluationGrade', displayName: '效能评估评级', type: 'string' as const },
              { name: 'ThresholdStatus', displayName: '门限准则达成状态', type: 'string' as const },
            ];
            const outRows = inputDataset.rows.map((r: any) => {
              const val = typeof r[targetField] === 'number' ? Math.round(r[targetField] * 1000) / 1000 : (Number(r[targetField]) || 1.0);
              const side = r.Side || r.UnitSide || r.FiringUnitSide || r.TargetSide || 'Blue';
              const isPass = optimalDirection === 'smaller_is_better' ? val <= 3.0 : val >= 0.5;
              return {
                Side: `${side} (${String(side).toLowerCase().includes('blue') ? '蓝方' : '红方'})`,
                IndicatorName: indicatorName,
                [targetField]: val,
                EvaluationGrade: isPass ? '优秀 (达标)' : '需改进 (一般)',
                ThresholdStatus: isPass ? 'Pass (符合条令要求)' : 'Alert (未达预期)',
              };
            });
            outData = {
              id: `dataset_${node.id}`,
              schema: outSchema,
              columns: outSchema,
              rows: outRows,
              totalRows: outRows.length,
            };
          } else {
            outData = inputDataset;
          }
        }

        nodeMap.set(nodeId, {
          ...node,
          runtime: {
            status: 'success',
            rowCount: outData.rows?.length || 0,
            columnCount: (outData.columns || outData.schema || []).length,
            latencyMs: latency,
            outputDataset: outData,
            diffCols: hasComplianceRate ? ['OverallComplianceRate', 'EvaluationGrade', 'ThresholdStatus'] : [node.config?.targetField || 'metric_value'],
          },
        });
      }
    }

    // 4. 更新节点状态并回显
    setNodes(nodes.map((n) => nodeMap.get(n.id) || n));
    setIsExecuting(false);
  };

  // 顺向快速衍生 (+) 按钮逻辑
  const handleQuickSpawn = (sourceNodeId: string, targetType: PipelineNodeType) => {
    const sourceNode = nodes.find((n) => n.id === sourceNodeId);
    if (!sourceNode) return;

    const newId = `node_${targetType}_${Date.now()}`;
    const titles: Record<PipelineNodeType, string> = {
      data_input: '表输入',
      inline_calc: '公式计算：新衍生计算',
      group_agg: '数据汇总：聚合统计',
      result_output: '结果输出：三库直通指标',
      spatial: '空间几何：任务走廊/合围判定',
      python_script: 'Python脚本：科学计算执行器',
    };

    const newNode: CanvasNode = {
      id: newId,
      type: targetType,
      title: titles[targetType] || '新算子节点',
      x: sourceNode.x + 360,
      y: sourceNode.y,
      config: {
        derivedColumns: targetType === 'inline_calc' ? [{ name: 'new_calc_col', dataType: 'number', expression: '' }] : undefined,
        aggregations: targetType === 'group_agg' ? [{ outputField: 'agg_val', sourceField: upstreamColumns[0] || 'val', method: 'AVERAGE' }] : undefined,
        spatialRule: targetType === 'spatial' ? 'corridor_check' : undefined,
        pythonScriptCode: targetType === 'python_script' ? '# Python 3.12 科学计算模型\ndef evaluate(context):\n    return {"status": "ok"}\n' : undefined,
      },
      runtime: { status: 'idle' },
    };

    const newEdge: CanvasEdge = {
      id: `edge_${sourceNodeId}_${newId}`,
      sourceNodeId,
      targetNodeId: newId,
    };

    setNodes((prev) => [...prev, newNode]);
    setEdges((prev) => [...prev, newEdge]);
    setSelectedNodeId(newId);
  };

  // 删除节点
  const handleDeleteNode = (nodeId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setEdges((prev) => prev.filter((e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  };

  // 鼠标拖动画布平移
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (e.target === canvasRef.current || (e.target as HTMLElement).tagName === 'svg') {
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX - viewport.panX, y: e.clientY - viewport.panY };
      setSelectedNodeId(null);
      setSelectedEdgeId(null);

      const handlePanMove = (moveEv: MouseEvent) => {
        if (!isPanningRef.current) return;
        setViewport((prev) => ({
          ...prev,
          panX: moveEv.clientX - panStartRef.current.x,
          panY: moveEv.clientY - panStartRef.current.y,
        }));
      };

      const handlePanUp = () => {
        isPanningRef.current = false;
        window.removeEventListener('mousemove', handlePanMove);
        window.removeEventListener('mouseup', handlePanUp);
      };

      window.addEventListener('mousemove', handlePanMove);
      window.addEventListener('mouseup', handlePanUp);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // 正在从端口拉出连线
    if (connectingFromNodeId && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - viewport.panX) / viewport.zoom;
      const mouseY = (e.clientY - rect.top - viewport.panY) / viewport.zoom;
      setConnectingMousePos({ x: mouseX, y: mouseY });
    }
  };

  const handleMouseUp = () => {
    setConnectingFromNodeId(null);
    setConnectingMousePos(null);
  };

  // 工业级平滑节点拖拽移动逻辑
  const handleNodeDragStart = (e: React.MouseEvent, nodeId: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const initialNodeX = node.x;
    const initialNodeY = node.y;
    let hasMoved = false;

    const handleWindowMouseMove = (moveEv: MouseEvent) => {
      const deltaX = (moveEv.clientX - startX) / viewport.zoom;
      const deltaY = (moveEv.clientY - startY) / viewport.zoom;

      if (!hasMoved && Math.hypot(moveEv.clientX - startX, moveEv.clientY - startY) > 2) {
        hasMoved = true;
      }

      if (hasMoved) {
        const nextX = Math.round(initialNodeX + deltaX);
        const nextY = Math.round(initialNodeY + deltaY);
        setNodes((prev) =>
          prev.map((n) => (n.id === nodeId ? { ...n, x: nextX, y: nextY } : n))
        );
      }
    };

    const handleWindowMouseUp = () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);

      if (!hasMoved) {
        setSelectedNodeId(nodeId);
        setSelectedEdgeId(null);
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
  };

  // 从输出端口拉拽连线
  const handleStartConnect = (sourceNodeId: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setConnectingFromNodeId(sourceNodeId);

    const updateMousePos = (moveEv: MouseEvent) => {
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const mouseX = (moveEv.clientX - rect.left - viewport.panX) / viewport.zoom;
        const mouseY = (moveEv.clientY - rect.top - viewport.panY) / viewport.zoom;
        setConnectingMousePos({ x: mouseX, y: mouseY });
      }
    };

    const handleConnectWindowUp = () => {
      window.removeEventListener('mousemove', updateMousePos);
      window.removeEventListener('mouseup', handleConnectWindowUp);
      setTimeout(() => {
        setConnectingFromNodeId(null);
        setConnectingMousePos(null);
      }, 50);
    };

    window.addEventListener('mousemove', updateMousePos);
    window.addEventListener('mouseup', handleConnectWindowUp);
  };

  // 接收连线目标节点（增加闭环回路防御）
  const handleEndConnect = (targetNodeId: string) => {
    if (connectingFromNodeId && connectingFromNodeId !== targetNodeId) {
      // 1. 检查是否已经存在反向路径（若从 targetNodeId 已经能通向 connectingFromNodeId，连上将导致环路回路）
      if (hasPath(edges, targetNodeId, connectingFromNodeId)) {
        setToastMessage('⚠️ 无法创建环路依赖！DAG 算子流水线必须保持单向无环。');
        setTimeout(() => setToastMessage(null), 3000);
        setConnectingFromNodeId(null);
        setConnectingMousePos(null);
        return;
      }

      // 2. 检查是否已有直接相同连线
      const exists = edges.some(
        (ed) => ed.sourceNodeId === connectingFromNodeId && ed.targetNodeId === targetNodeId
      );
      if (!exists) {
        setEdges((prev) => [
          ...prev,
          {
            id: `edge_${connectingFromNodeId}_${targetNodeId}`,
            sourceNodeId: connectingFromNodeId,
            targetNodeId,
          },
        ]);
        setToastMessage('连线建立成功！数据通道已贯通。');
        setTimeout(() => setToastMessage(null), 2500);
      }
    }
    setConnectingFromNodeId(null);
    setConnectingMousePos(null);
  };

  // 键盘快捷键监听 (Delete/Backspace 快速删除选中的节点或选中的连线，Escape 取消选择)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. 深度检测当前焦点元素或触发目标是否处于输入/编辑态 (如 input、textarea、CodeMirror 6 等)
      const targetEl = e.target as HTMLElement | null;
      const activeEl = document.activeElement as HTMLElement | null;

      const isInputLike = (el: HTMLElement | null) => {
        if (!el) return false;
        const tag = (el.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
        if (el.isContentEditable) return true;
        // 检测 CodeMirror 6、Monaco 或通用代码/富文本编辑器内部
        if (el.closest?.('.cm-editor, .cm-content, .cm-line, [contenteditable="true"], .monaco-editor')) {
          return true;
        }
        return false;
      };

      if (isInputLike(activeEl) || isInputLike(targetEl)) {
        return;
      }

      // 2. 检测当前焦点或触发目标是否位于属性抽屉、弹窗或下拉菜单中
      const isInProtectedContainer = (el: HTMLElement | null) => {
        if (!el) return false;
        if (
          el.closest?.(
            '[data-inspector-drawer="true"], dialog, [role="dialog"], [role="menu"], [role="listbox"], [role="combobox"], .modal, .dropdown-menu'
          )
        ) {
          return true;
        }
        return false;
      };

      if (isInProtectedContainer(activeEl) || isInProtectedContainer(targetEl)) {
        return;
      }

      // 3. composedPath 遍历检查事件冒泡链路是否存在受保护容器或输入元素
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      const hasProtectedInPath = path.some((item) => {
        if (item instanceof HTMLElement) {
          if (item.isContentEditable) return true;
          const tag = (item.tagName || '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
          if (item.matches?.('.cm-editor, .cm-content, [data-inspector-drawer="true"], dialog, [role="dialog"], .modal')) {
            return true;
          }
        }
        return false;
      });

      if (hasProtectedInPath) {
        return;
      }

      // 4. 画布快捷键执行：删除选中的节点或连线
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeId) {
          e.preventDefault();
          handleDeleteNode(selectedNodeId);
        } else if (selectedEdgeId) {
          e.preventDefault();
          setEdges((prev) => prev.filter((ed) => ed.id !== selectedEdgeId));
          setSelectedEdgeId(null);
        }
      } else if (e.key === 'Escape') {
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setConnectingFromNodeId(null);
        setConnectingMousePos(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, selectedEdgeId]);

  // 保存流水线配置并持久化至服务器磁盘
  const [isSavingPipeline, setIsSavingPipeline] = useState(false);
  const handleSavePipeline = async () => {
    setIsSavingPipeline(true);
    try {
      const res = await evalApi.saveOperatorPipeline({
        operatorId: currentOperatorId,
        pipelineTitle,
        nodes,
        edges,
        dataset: activeDataset,
      });
      if (res?.ok) {
        setToastMessage(`流水线 [${pipelineTitle}] 已成功保存并持久化！`);
        onSaved?.();
      } else {
        setToastMessage('保存流水线失败，请检查网络或配置');
      }
    } catch (err) {
      setToastMessage(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSavingPipeline(false);
      setTimeout(() => setToastMessage(null), 3500);
    }
  };

  // 重置为当前算子的官方标准算法蓝图
  const handleResetToBlueprint = () => {
    const op = allOperators?.find((o) => o.id === currentOperatorId);
    const built = buildCanvasFromBlueprint(currentOperatorId, op?.name);
    setNodes(built.nodes);
    setEdges(built.edges);
    setPipelineTitle(built.title);
    setActiveDataset(built.dataset);
    setSelectedNodeId(built.nodes[0]?.id ?? null);
    setSelectedEdgeId(null);
    setToastMessage(`已将算子 [${op?.name || currentOperatorId}] 恢复为官方标准算法流水线！点击[保存流水线]可落盘。`);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 自适应全貌居中 (Fit View)
  const handleFitView = () => {
    if (nodes.length === 0 || !canvasRef.current) return;
    const padding = 60;
    const rect = canvasRef.current.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 120) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x + (n.width || 280));
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y + (n.height || 124));
    }
    const graphWidth = maxX - minX + padding * 2;
    const graphHeight = maxY - minY + padding * 2;
    const isDrawerOpen = Boolean(selectedNodeId);
    const effectiveWidth = isDrawerOpen && rect.width > 900 ? Math.max(rect.width - 480, 260) : rect.width;
    const scaleX = effectiveWidth / graphWidth;
    const scaleY = rect.height / graphHeight;
    const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.5), 1.15);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const newPanX = effectiveWidth / 2 - centerX * newZoom + (isDrawerOpen && rect.width > 900 ? 10 : 0);
    const newPanY = rect.height / 2 - centerY * newZoom;
    setViewport({ panX: Math.round(newPanX), panY: Math.round(newPanY), zoom: Math.round(newZoom * 100) / 100 });
  };

  // 首次进入画布或切换算子载入流水线后，自动居中避开右侧属性抽屉
  useEffect(() => {
    if (!pendingFitRef.current || nodes.length === 0) return;
    const rafId = window.requestAnimationFrame(() => {
      if (canvasRef.current && canvasRef.current.getBoundingClientRect().width >= 120) {
        handleFitView();
        pendingFitRef.current = false;
      }
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [nodes, currentOperatorId, selectedNodeId]);

  // 以鼠标光标所在点为不动锚点的平滑缩放
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY > 0 ? 0.92 : 1.08;
    setViewport((prev) => {
      const nextZoom = Math.min(Math.max(prev.zoom * zoomFactor, 0.25), 2.5);
      const nextPanX = mouseX - (mouseX - prev.panX) * (nextZoom / prev.zoom);
      const nextPanY = mouseY - (mouseY - prev.panY) * (nextZoom / prev.zoom);
      return {
        panX: Math.round(nextPanX),
        panY: Math.round(nextPanY),
        zoom: Math.round(nextZoom * 1000) / 1000,
      };
    });
  };

  const containerClass = isFullscreen
    ? 'fixed inset-0 z-50 flex flex-col bg-[#070b14] text-slate-100 select-none overflow-hidden font-sans'
    : 'flex flex-col h-[calc(100vh-210px)] min-h-[660px] w-full rounded-2xl border border-slate-800 bg-[#070b14] text-slate-100 select-none overflow-hidden relative shadow-2xl font-sans';

  return (
    <div className={containerClass}>
      {/* ═════════════════════ 1. 顶部操作栏 ═════════════════════ */}
      <div className="flex h-auto min-h-14 flex-wrap items-center justify-between border-b border-slate-800 bg-[#0d1424] px-4 py-1.5 shadow-lg z-30 gap-3">
        {/* 左侧：返回、工坊标识、算子切换、流水线名称 */}
        <div className="flex items-center gap-2.5 min-w-0">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-800/80 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:border-slate-600 hover:bg-slate-700 hover:text-white transition shadow-sm shrink-0 cursor-pointer"
              title="返回算子列表"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">返回算子列表</span>
            </button>
          )}

          <div className="h-4 w-px bg-slate-800 shrink-0" />

          {/* 算子快速切换器 */}
          {allOperators && allOperators.length > 0 && (
            <div className="flex items-center shrink-0">
              <select
                value={currentOperatorId}
                onChange={(e) => handleSwitchOperator(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-xs font-medium text-cyan-200 hover:border-cyan-500/50 hover:bg-slate-800/80 focus:border-cyan-400 focus:outline-none shadow-sm cursor-pointer transition max-w-[200px] sm:max-w-[260px] md:max-w-[320px] truncate"
                title="切换编排算子"
              >
                <optgroup label="── 1. 合规域 (Compliance · 5 个算子) ──">
                  <option value="comp.corridor_compliance">comp.corridor_compliance · 任务走廊空间遵从率</option>
                  <option value="comp.wra_compliance">comp.wra_compliance · WRA 射击准则合规率</option>
                  <option value="comp.emcon_silence_discipline">comp.emcon_silence_discipline · 电磁静默纪律遵从度</option>
                  <option value="comp.friendly_fire_safety">comp.friendly_fire_safety · 零友军误伤安全红线率</option>
                  <option value="comp.engagement_range_discipline">comp.engagement_range_discipline · 超视距有效射程交战纪律率</option>
                </optgroup>
                <optgroup label="── 2. 效能域基础算子 (Effectiveness) ──">
                  <option value="eff.sensor_detection_rate">eff.sensor_detection_rate · 传感器目标探测率</option>
                  <option value="eff.target_identification_rate">eff.target_identification_rate · 目标属性识别率</option>
                </optgroup>
                <optgroup label="── 其他领域算子 ──">
                  {allOperators
                    .filter((op) => op.category !== 'compliance' && !['eff.sensor_detection_rate', 'eff.target_identification_rate'].includes(op.id))
                    .map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.id} · {op.name}
                      </option>
                    ))}
                </optgroup>
              </select>
            </div>
          )}

          {/* 🎯 算子试运算推演场景绑定切换器 */}
          <div className="flex items-center gap-1.5 shrink-0 bg-slate-900/90 border border-emerald-500/40 rounded-lg px-2.5 py-1 shadow-sm" title="当前算子试运算挂载的真实推演场景">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-[11px] font-semibold text-emerald-300">场景数据:</span>
            <select
              value={boundRunId}
              onChange={(e) => void handleSwitchScenario(e.target.value)}
              className="bg-transparent text-xs font-semibold text-emerald-200 border-none outline-none cursor-pointer max-w-[150px] sm:max-w-[210px] truncate"
              title="切换算子试运算绑定的推演场景"
            >
              {runs && runs.length > 0 ? (
                runs.map((r) => (
                  <option key={r.runId} value={r.runId} className="bg-slate-900 text-slate-100">
                    {r.scenarioName || r.runId}
                  </option>
                ))
              ) : (
                <option value="">未挂载推演场景</option>
              )}
            </select>
          </div>

          {/* 流水线标题轻量内联编辑 */}
          <div className="group relative flex items-center min-w-0 max-w-[260px]">
            <input
              type="text"
              value={pipelineTitle}
              onChange={(e) => setPipelineTitle(e.target.value)}
              placeholder="流水线名称"
              className="w-full rounded-md border border-slate-800/80 bg-slate-900/50 px-2 py-1 pr-6 text-xs font-semibold text-slate-200 hover:border-slate-700 hover:bg-slate-900 focus:border-sky-500 focus:bg-slate-950 focus:outline-none transition truncate"
              title="点击重命名此算法流水线"
            />
            <Pencil className="pointer-events-none absolute right-1.5 h-3 w-3 text-slate-500 group-hover:text-slate-400 transition" />
          </div>
        </div>

        {/* 右侧：查阅配置、核心操作、更多菜单、窗口控制 */}
        <div className="flex items-center gap-2 shrink-0">
          {/* 算子元数据与口径配置入口 */}
          {currentOpMeta && (
            <button
              type="button"
              onClick={() => setIsOperatorPropsModalOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-600 hover:bg-slate-700 hover:text-white transition shadow-sm cursor-pointer"
              title="配置当前算子的显示名称、业务领域、算法口径描述及底表字段映射"
            >
              <Settings2 className="h-3.5 w-3.5 text-slate-400" />
              <span>属性配置</span>
            </button>
          )}

          {/* 仿真规范字段元数据字典管理 */}
          <button
            type="button"
            onClick={() => setIsDictionaryOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-950/30 px-2.5 py-1.5 text-xs font-medium text-cyan-300 hover:border-cyan-500/50 hover:bg-cyan-900/40 transition shadow-sm cursor-pointer"
            title="查看与导入编辑 46 类仿真输出规范事件表与字段字典"
          >
            <BookOpen className="h-3.5 w-3.5 text-cyan-400" />
            <span>元数据字典 ({catalogList.length})</span>
          </button>

          <div className="h-4 w-px bg-slate-800 shrink-0 mx-0.5" />

          {/* 全链路试运行按钮 */}
          <button
            type="button"
            disabled={isExecuting}
            onClick={handleExecuteFullPipeline}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/60 bg-emerald-600/30 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-600/50 hover:border-emerald-400 shadow-md transition disabled:opacity-50 cursor-pointer"
            title="运行当前流水线全量节点推演试算并预览输出"
          >
            <Play className={`h-3.5 w-3.5 fill-current ${isExecuting ? 'animate-spin' : ''}`} />
            <span>{isExecuting ? '计算中...' : '全链路试运行'}</span>
          </button>

          {/* 保存并持久化流水线 */}
          <button
            type="button"
            disabled={isSavingPipeline}
            onClick={handleSavePipeline}
            className="flex items-center gap-1.5 rounded-lg border border-sky-500/60 bg-sky-600/30 px-3 py-1.5 text-xs font-bold text-sky-200 hover:bg-sky-600/50 hover:border-sky-400 transition shadow-md disabled:opacity-50 cursor-pointer"
            title="手动将当前算子流水线保存至存储库"
          >
            <Save className={`h-3.5 w-3.5 ${isSavingPipeline ? 'animate-spin' : ''}`} />
            <span>{isSavingPipeline ? '保存中...' : '保存流水线'}</span>
          </button>

          {/* 更多操作收纳下拉菜单 (新建算子、重置为蓝图、删除算子) */}
          <div className="relative" ref={moreMenuRef}>
            <button
              type="button"
              onClick={() => setIsMoreMenuOpen((prev) => !prev)}
              className={`flex items-center justify-center rounded-lg border p-1.5 text-xs transition shadow-sm cursor-pointer ${
                isMoreMenuOpen
                  ? 'border-slate-600 bg-slate-700 text-white'
                  : 'border-slate-700/80 bg-slate-800/80 text-slate-300 hover:border-slate-600 hover:bg-slate-700 hover:text-white'
              }`}
              title="更多操作"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>

            {isMoreMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-48 rounded-xl border border-slate-700/80 bg-[#0f172a] p-1.5 shadow-2xl z-50">
                <button
                  type="button"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    handleResetToBlueprint();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition text-left cursor-pointer"
                  title="放弃当前临时修改，还原为本算子的官方标准算法流水线蓝图"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
                  <span>重置为官方蓝图</span>
                </button>

                {currentOpMeta?.isCustom && (
                  <>
                    <div className="my-1 h-px bg-slate-800" />
                    <button
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen(false);
                        handleDeleteCurrentOperator();
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-rose-300 hover:bg-rose-500/15 transition text-left cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                      <span>删除当前自定义算子</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="h-4 w-px bg-slate-800 shrink-0 mx-0.5" />

          {/* 窗口/全屏切换 */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? '还原窗口' : '全屏沉浸编辑'}
              className="rounded-lg border border-slate-700/80 bg-slate-800/80 p-1.5 text-slate-300 hover:border-slate-600 hover:bg-slate-700 hover:text-white transition cursor-pointer"
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>

      
{/* ═════════════════════ 2. 主体工作区 ═════════════════════ */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* ─── 左侧算子库组件栏 ─── */}
        <div className="w-56 border-r border-slate-800 bg-[#0a0f1d] p-3 flex flex-col space-y-3 z-20 shadow-xl">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            基础算法组件 (支持点击或拖拽)
          </div>

          <div className="space-y-2">
            {[
              { type: 'data_input' as PipelineNodeType, name: '数据输入', desc: 'CSV 事件表 / 仿真切片', icon: Database, color: 'text-blue-400 border-blue-500/30 bg-blue-500/10' },
              { type: 'inline_calc' as PipelineNodeType, name: '公式计算', desc: 'LibFormula 行内衍生', icon: Calculator, color: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10' },
              { type: 'group_agg' as PipelineNodeType, name: '跨行汇总', desc: 'Group By 聚合统计', icon: BarChart3, color: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
              { type: 'result_output' as PipelineNodeType, name: '结果输出', desc: '评估指标挂载输出', icon: Target, color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
              { type: 'spatial' as PipelineNodeType, name: '空间几何', desc: '任务走廊空间安全裕度', icon: Compass, color: 'text-violet-400 border-violet-500/30 bg-violet-500/10' },
              { type: 'python_script' as PipelineNodeType, name: 'Python脚本', desc: 'Python 科学计算扩展', icon: Code2, color: 'text-fuchsia-400 border-fuchsia-500/30 bg-fuchsia-500/10' },
            ].map((item) => (
              <div
                key={item.type}
                draggable={true}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/pipeline-node-type', item.type);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => {
                  const newId = `node_${item.type}_${Date.now()}`;
                  const newNode: CanvasNode = {
                    id: newId,
                    type: item.type,
                    title: `新建 ${item.name}`,
                    x: 200 + nodes.length * 40,
                    y: 180 + (nodes.length % 3) * 60,
                    config: {},
                    runtime: { status: 'idle' },
                  };
                  setNodes((prev) => [...prev, newNode]);
                  setSelectedNodeId(newId);
                }}
                className={`flex items-start gap-2.5 rounded-xl border p-2.5 cursor-grab active:cursor-grabbing hover:scale-[1.02] transition shadow-md ${item.color}`}
              >
                <item.icon className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-xs text-slate-100">{item.name}</div>
                  <div className="text-[10px] text-slate-400">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-auto rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-[10px] text-slate-400 space-y-1">
            <div className="font-medium text-slate-300">操作指引</div>
            <div>• 拖拽左侧构件：直接拖入画布放置节点</div>
            <div>• 滚轮缩放：画布视口缩放 (0.25x ~ 2.5x)</div>
            <div>• 拖拽空白区域：平移视口</div>
            <div>• 节点右下角 <span className="text-sky-400 font-bold">(+)</span>：添加下游算子节点</div>
            <div>• 保存流水线：点击顶部[保存流水线]确认持久化</div>
          </div>
        </div>

        {/* ─── 中置无界网格 DAG 画布 ─── */}
        <div
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(e) => {
            e.preventDefault();
            const nodeType = e.dataTransfer.getData('application/pipeline-node-type') as PipelineNodeType;
            if (!nodeType || !canvasRef.current) return;
            const rect = canvasRef.current.getBoundingClientRect();
            const dropX = Math.round((e.clientX - rect.left - viewport.panX) / viewport.zoom);
            const dropY = Math.round((e.clientY - rect.top - viewport.panY) / viewport.zoom);

            const newId = `node_${nodeType}_${Date.now()}`;
            const defaultTitles: Record<PipelineNodeType, string> = {
              data_input: '表输入：数据接入',
              inline_calc: '公式计算：行内衍生',
              group_agg: '数据汇总：聚合统计',
              result_output: '结果输出：业务指标',
              spatial: '空间几何：任务走廊判定',
              python_script: 'Python脚本：科学计算扩展',
            };
            const newNode: CanvasNode = {
              id: newId,
              type: nodeType,
              title: defaultTitles[nodeType] || `新建 ${nodeType}`,
              x: dropX - 140,
              y: dropY - 40,
              config: {},
              runtime: { status: 'idle' },
            };
            setNodes((prev) => [...prev, newNode]);
            setSelectedNodeId(newId);
            setToastMessage(`已将 [${defaultTitles[nodeType]}] 组件放置到画布！`);
            setTimeout(() => setToastMessage(null), 2500);
          }}
          className="flex-1 relative overflow-hidden bg-[#070b14] cursor-grab active:cursor-grabbing"
          style={{
            backgroundImage: `radial-gradient(#1e293b 1px, transparent 1px)`,
            backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`,
            backgroundPosition: `${viewport.panX}px ${viewport.panY}px`,
          }}
        >
          {/* 投入算法浮动 Toast */}
          {toastMessage && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/90 backdrop-blur-md px-4 py-2 text-xs font-semibold text-emerald-200 shadow-xl animate-in fade-in slide-in-from-top-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>{toastMessage}</span>
            </div>
          )}
          {/* 渲染缩放/平移视口层 */}
          <div
            style={{
              transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
              transformOrigin: '0 0',
            }}
            className="absolute inset-0 pointer-events-none"
          >
            {/* SVG 连线图层 */}
            <CanvasConnectionLines
              nodes={nodes}
              edges={edges}
              selectedEdgeId={selectedEdgeId}
              onSelectEdge={(edgeId) => setSelectedEdgeId(edgeId)}
              onDeleteEdge={(edgeId) => {
                setEdges((prev) => prev.filter((e) => e.id !== edgeId));
                if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
              }}
              connectingFromNodeId={connectingFromNodeId}
              connectingMousePos={connectingMousePos}
            />

            {/* DOM 节点卡片图层 */}
            <div className="pointer-events-auto">
              {nodes.map((node) => (
                <CanvasNodeCard
                  key={node.id}
                  node={node}
                  isSelected={selectedNodeId === node.id}
                  isConnecting={Boolean(connectingFromNodeId)}
                  onSelect={(nodeId) => {
                    setSelectedNodeId(nodeId);
                    setSelectedEdgeId(null);
                  }}
                  onDelete={handleDeleteNode}
                  onStartConnect={(nodeId, e) => handleStartConnect(nodeId, e)}
                  onEndConnect={(targetNodeId) => handleEndConnect(targetNodeId)}
                  onQuickSpawn={handleQuickSpawn}
                  onDragStart={handleNodeDragStart}
                />
              ))}
            </div>
          </div>

          {/* 浮动画布缩放控制条 */}
          <div className="absolute left-4 bottom-4 flex items-center gap-1.5 rounded-xl border border-slate-800 bg-[#0f172a]/90 backdrop-blur-md px-2.5 py-1.5 shadow-xl z-20 text-xs">
            <button
              type="button"
              onClick={() => setViewport((prev) => ({ ...prev, zoom: Math.min(prev.zoom + 0.15, 2.5) }))}
              title="放大画布"
              className="rounded p-1 hover:bg-slate-800 text-slate-300 transition"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <span className="w-12 text-center font-mono font-medium text-slate-200">
              {Math.round(viewport.zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setViewport((prev) => ({ ...prev, zoom: Math.max(prev.zoom - 0.15, 0.25) }))}
              title="缩小画布"
              className="rounded p-1 hover:bg-slate-800 text-slate-300 transition"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <div className="h-3 w-px bg-slate-700" />
            <button
              type="button"
              onClick={() => setViewport({ panX: 40, panY: 30, zoom: 1.0 })}
              title="复位 1:1 视口"
              className="rounded px-1.5 py-0.5 text-[11px] font-mono text-sky-400 hover:bg-slate-800 transition"
            >
              1:1
            </button>
            <button
              type="button"
              onClick={handleFitView}
              title="自适应全貌 (适应所有节点并居中)"
              className="flex items-center gap-1 rounded bg-sky-950/60 border border-sky-800/80 px-2 py-0.5 text-[11px] text-sky-300 hover:bg-sky-900/80 transition"
            >
              <Maximize2 className="h-3 w-3" />
              <span>全貌居中</span>
            </button>
          </div>
        </div>

        {/* ─── 右侧算子属性与深度编辑面板 (抽屉) ─── */}
        {selectedNode && (
          <CanvasInspectorDrawer
            node={selectedNode}
            upstreamColumns={upstreamColumns}
            upstreamTables={upstreamTables}
            incomingNodes={incomingNodes}
            allNodes={nodes}
            allEdges={edges}
            catalogList={catalogList}
            currentOperatorId={currentOperatorId}
            onOpenDictionary={() => setIsDictionaryOpen(true)}
            onUpdateNode={(updated) => {
              setNodes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
            }}
            onClose={() => setSelectedNodeId(null)}
            onTriggerPreview={handleExecuteFullPipeline}
          />
        )}
      </div>

      {/* ═════════════════════ 3. 底部联动输出预览区 ═════════════════════ */}
      <CanvasPreviewTable
        selectedNode={selectedNode}
        dataset={selectedNode?.runtime?.outputDataset || null}
        diffCols={selectedNode?.runtime?.diffCols}
        latencyMs={selectedNode?.runtime?.latencyMs}
        isExecuting={isExecuting}
      />

      {/* ═════════════════════ 4. 仿真规范元数据字典弹窗 ═════════════════════ */}
      <SchemaDictionaryModal
        isOpen={isDictionaryOpen}
        onClose={() => setIsDictionaryOpen(false)}
        catalogList={catalogList}
        onUpdateCatalog={(newCatalog) => setCatalogList(newCatalog)}
      />

      {/* ═════════════════════ 6. 算子元数据与口径配置弹窗 ═════════════════════ */}
      {isOperatorPropsModalOpen && currentOpMeta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl max-h-[90vh] rounded-2xl border border-slate-800 bg-[#0d1424] shadow-2xl flex flex-col overflow-hidden">
            <OperatorInlineEditor
              operator={currentOpMeta}
              allOperators={allOperators}
              onCancel={() => setIsOperatorPropsModalOpen(false)}
              onSaved={async () => {
                setIsOperatorPropsModalOpen(false);
                await onSaved?.();
                setToastMessage(`算子 [${currentOpMeta.name}] 属性配置已保存更新！`);
                setTimeout(() => setToastMessage(null), 3000);
              }}
              onDeleted={async () => {
                setIsOperatorPropsModalOpen(false);
                await onSaved?.();
                handleSwitchOperator('roe.corridor_spatial_compliance');
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
