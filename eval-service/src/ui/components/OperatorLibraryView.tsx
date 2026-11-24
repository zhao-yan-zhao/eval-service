import React, { useId, useLayoutEffect, useMemo, useRef, useState, useEffect } from 'react';
import {
  ArrowUpDown,
  BarChart3,
  Calculator,
  Code2,
  Compass,
  CopyPlus,
  Cpu,
  Database,
  Eye,
  ExternalLink,
  Layers,
  Lock,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import type {
  CustomOperatorDefinition,
  F1OutputCatalog,
  IndicatorDefinition,
  IndicatorSystem,
  MetricAtomMeta,
  StoredRunSummary,
} from '../api.ts';
import { PipelineCanvasStudio } from './pipeline-canvas/index.ts';
import { OperatorInlineEditor } from './OperatorInlineEditor.tsx';
import { CreateOperatorModal } from './CreateOperatorModal.tsx';
import { evalApi } from '../api.ts';
import {
  UnifiedAssetSelector,
  V4TablePivotPreview,
  type UnifiedAssetOption,
} from './v4/index.ts';
import type { TableDataset } from '../../core/types.ts';

interface V4OperatorDetailInfo {
  id: string;
  name: string;
  chapter: number;
  layer?: 'fact' | 'legacy_aggregate';
  requiredTables?: string[];
  optionalTables?: string[];
  outputColumnNames?: string[];
  parameterPorts?: Array<{ key: string; label: string; defaultValue: unknown; description?: string }>;
  pythonCode?: string;
}

/**
 * 业务领域分类定义（一库算子库的核心业务分类）
 */
export const DOMAIN_CATEGORIES = [
  { id: 'all' as const, label: '全部算子' },
  { id: 'time' as const, label: '时效域' },
  { id: 'effectiveness' as const, label: '效能域' },
  { id: 'situation' as const, label: '态势域' },
  { id: 'compliance' as const, label: '合规域' },
  { id: 'cost' as const, label: '成本域' },
];

export type DomainFilterKey = 'all' | 'time' | 'effectiveness' | 'situation' | 'compliance' | 'cost';
export type AlgorithmFilterKey = 'all' | 'inline_calc' | 'group_agg' | 'data_input' | 'result_output' | 'spatial' | 'python_script';

export function getDomainBadge(category: string): { label: string; badgeBg: string } {
  switch (category) {
    case 'time':
      return { label: '时效域', badgeBg: 'bg-blue-500/15 text-blue-400 border-blue-500/30' };
    case 'effectiveness':
      return { label: '效能域', badgeBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
    case 'situation':
      return { label: '态势域', badgeBg: 'bg-violet-500/15 text-violet-400 border-violet-500/30' };
    case 'compliance':
      return { label: '合规域', badgeBg: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
    case 'cost':
      return { label: '成本域', badgeBg: 'bg-rose-500/15 text-rose-400 border-rose-500/30' };
    default:
      return { label: category || '通用域', badgeBg: 'bg-slate-500/15 text-slate-300 border-slate-500/30' };
  }
}

/**
 * 基础算法库条目接口
 */
export interface RegisteredAlgorithm {
  id: string;
  seq: number;
  name: string;
  category: string;
  engine: string;
  badgeBg: string;
  description: string;
  iconName: 'Database' | 'Calculator' | 'BarChart3' | 'Target' | 'Compass' | 'Code2';
  type: 'data_input' | 'inline_calc' | 'group_agg' | 'result_output' | 'spatial' | 'python_script';
  isCustom?: boolean;
}

export const INITIAL_ALGORITHMS: RegisteredAlgorithm[] = [
  {
    id: 'algo_table_input',
    seq: 1,
    name: '表输入',
    category: '数据输入',
    engine: 'CSV / 态势帧流式抽取器',
    badgeBg: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    description: '查询一个数据库表 / 提取仿真事件数据 (CSV / 态势帧 JSONL)，支持字段映射、行级过滤与时钟对齐，为下游算法提供初始规范数据集。',
    iconName: 'Database',
    type: 'data_input',
  },
  {
    id: 'algo_lib_formula',
    seq: 2,
    name: '公式',
    category: '行内计算',
    engine: '行内公式衍生引擎',
    badgeBg: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    description: '使用计算公式支持行内四则运算、函数嵌套 (数学/逻辑/文本/时间函数) 及多字段逻辑处理，生成衍生计算列。',
    iconName: 'Calculator',
    type: 'inline_calc',
  },
  {
    id: 'algo_group_agg',
    seq: 3,
    name: '数据汇总',
    category: '跨行聚合',
    engine: '流式多主键聚合器',
    badgeBg: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    description: '按指定字段分组聚合统计，支持求和(SUM)、均值(AVERAGE)、极值(MAX/MIN)、计数(COUNT)、方差(STDEV)等聚合计算，输出结构化二维汇总表。',
    iconName: 'BarChart3',
    type: 'group_agg',
  },
  {
    id: 'algo_result_output',
    seq: 4,
    name: '二维表输出',
    category: '二维表输出',
    engine: '结构化二维事实表输出契约',
    badgeBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    description: '流水线末端节点。输出结构化二维事实表，供指标计算图引用与聚合。',
    iconName: 'Target',
    type: 'result_output',
  },
  {
    id: 'algo_spatial_geom',
    seq: 5,
    name: '空间几何算法',
    category: '空间态势',
    engine: '空间几何分析引擎',
    badgeBg: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
    description: '基于经纬度与高程进行空间任务走廊安全裕度、合围多边形穿透、凸包几何以及威胁距离计算，支持三维态势几何判断。',
    iconName: 'Compass',
    type: 'spatial',
  },
  {
    id: 'algo_python_script',
    seq: 6,
    name: 'Python 算法执行器',
    category: '脚本扩展',
    engine: 'Python 3.12 / NumPy / SciPy 桥接',
    badgeBg: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30',
    description: '调用外部 Python 脚本或科学计算模型，支持执行高级气动模型、雷达探测包络拟合与复杂的运筹优化求解。',
    iconName: 'Code2',
    type: 'python_script',
  },
];

export function getAlgoIcon(name: string) {
  switch (name) {
    case 'Database': return Database;
    case 'Calculator': return Calculator;
    case 'BarChart3': return BarChart3;
    case 'Target': return Target;
    case 'Compass': return Compass;
    case 'Code2': return Code2;
    default: return Cpu;
  }
}

/**
 * 统计引用某基础算法的具体算子清单
 */
export function getAlgoReferencedOps(algo: RegisteredAlgorithm, operators: MetricAtomMeta[]): MetricAtomMeta[] {
  switch (algo.id) {
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
}

/**
 * 基础算法/流水线实现类型（表输入、行内公式、跨行聚合、结果输出、空间几何、Python脚本）
 */
export function getOperatorPipelineCategory(op: MetricAtomMeta): {
  id: 'data_input' | 'inline_calc' | 'group_agg' | 'result_output' | 'spatial' | 'python_script';
  label: string;
  badgeBg: string;
} {
  const pCat = (op as any).pipelineCategory || op.customDef?.pipelineCategory;
  if (pCat === 'spatial') return { id: 'spatial', label: '空间几何', badgeBg: 'bg-violet-500/15 text-violet-400 border-violet-500/30' };
  if (pCat === 'python_script') return { id: 'python_script', label: 'Python 脚本', badgeBg: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30' };
  if (pCat === 'data_input') return { id: 'data_input', label: '数据抽取', badgeBg: 'bg-blue-500/15 text-blue-400 border-blue-500/30' };
  if (pCat === 'inline_calc') return { id: 'inline_calc', label: '行内公式', badgeBg: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' };
  if (pCat === 'group_agg') return { id: 'group_agg', label: '跨行聚合', badgeBg: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
  if (pCat === 'result_output') return { id: 'result_output', label: '二维表输出', badgeBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };

  if (
    op.id.includes('corridor') ||
    op.id.includes('centroid') ||
    op.id.includes('scatter') ||
    op.id.includes('hull') ||
    op.id.includes('area_coverage')
  ) {
    return { id: 'spatial', label: '空间几何', badgeBg: 'bg-violet-500/15 text-violet-400 border-violet-500/30' };
  }

  if (op.id.includes('saturation') || op.id.includes('mcda') || op.id.includes('python')) {
    return { id: 'python_script', label: 'Python 脚本', badgeBg: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30' };
  }

  if (
    op.mode === 'aggregation' ||
    op.customDef?.mode === 'aggregation' ||
    op.customDef?.aggregationConfig ||
    op.id.includes('total') ||
    op.id.includes('count') ||
    op.id.includes('avg') ||
    op.id.includes('interval') ||
    op.id.includes('hit_rate') ||
    op.id.includes('emcon') ||
    op.id.includes('detection')
  ) {
    return { id: 'group_agg', label: '跨行聚合', badgeBg: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
  }

  if (op.id.includes('mission_success') || op.outputType === 'score') {
    return { id: 'result_output', label: '二维表输出', badgeBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
  }

  return { id: 'inline_calc', label: '公式 (行内计算)', badgeBg: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' };
}

interface OperatorLibraryViewProps {
  operators: MetricAtomMeta[];
  indicators?: IndicatorDefinition[];
  systems?: IndicatorSystem[];
  runs: StoredRunSummary[];
  selectedRunId: string;
  activeSourceId?: string;
  onSelectRun?: (runId: string) => void;
  catalog?: F1OutputCatalog | null;
  focusedOperatorTarget?: { id: string; nonce: number } | null;
  onRefresh?: () => Promise<void>;
  onOpenSettings?: (tab?: string) => void;
}

type SortField = 'id' | 'category' | 'readiness' | 'outputType';
type SortDir = 'asc' | 'desc';

export function OperatorLibraryView({
  operators,
  indicators = [],
  systems = [],
  runs,
  selectedRunId,
  activeSourceId,
  onSelectRun,
  catalog = null,
  focusedOperatorTarget = null,
  onRefresh = async () => {},
  onOpenSettings,
}: OperatorLibraryViewProps) {
  // 视图模式：默认直接呈现算子列表；点击操作进入内部结构画布 (PipelineCanvasStudio)
  const [viewMode, setViewMode] = useState<'list' | 'canvas'>('list');
  const [selectedCanvasOp, setSelectedCanvasOp] = useState<MetricAtomMeta | null>(null);

  // V4 实证算子内部源码与实时二维表试算缓存
  const [v4SpecMap, setV4SpecMap] = useState<Record<string, V4OperatorDetailInfo>>({});
  const [v4RunLoading, setV4RunLoading] = useState(false);
  const [v4RunResult, setV4RunResult] = useState<{
    operatorId: string;
    status: string;
    dataset?: TableDataset;
    missingDataReason?: string;
    latencyMs?: number;
  } | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/v4/operators?layer=all')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!active || !json?.operators || !Array.isArray(json.operators)) return;
        const map: Record<string, V4OperatorDetailInfo> = {};
        for (const item of json.operators) {
          if (item?.id) map[item.id] = item;
        }
        setV4SpecMap(map);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // 新增自定义算子弹窗状态
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // 原生 <dialog> 详情与行内配置状态
  const [detailOp, setDetailOp] = useState<MetricAtomMeta | null>(null);
  const [editingOp, setEditingOp] = useState<MetricAtomMeta | null>(null);
  const editorDialogRef = useRef<HTMLDialogElement | null>(null);
  const detailDialogRef = useRef<HTMLDialogElement | null>(null);
  const editorHeadingId = useId();
  const detailHeadingId = useId();

  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const savedListScrollTopRef = useRef<number>(0);

  useLayoutEffect(() => {
    if (viewMode === 'list' && listScrollRef.current) {
      listScrollRef.current.scrollTop = savedListScrollTopRef.current;
    }
  }, [viewMode]);

  // 算子业务领域分类筛选（时效域、效能域、态势域、合规域、成本域）
  const [domainFilter, setDomainFilter] = useState<DomainFilterKey>('all');
  // 辅助过滤：底层算法实现方式（全部 / 行内公式 / 跨行聚合 / 数据输入 / 结果输出）
  const [algoFilter, setAlgoFilter] = useState<AlgorithmFilterKey>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('category');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  useEffect(() => {
    if (!focusedOperatorTarget?.id) return;
    setViewMode('list');
    setDomainFilter('all');
    setAlgoFilter('all');
    setSearchQuery(focusedOperatorTarget.id);
    const matched = operators.find((o) => o.id === focusedOperatorTarget.id);
    if (matched) {
      setDetailOp(matched);
      setTimeout(() => {
        if (detailDialogRef.current && !detailDialogRef.current.open) {
          detailDialogRef.current.showModal();
        }
      }, 60);
    }
  }, [focusedOperatorTarget, operators]);

  // 领域分类统计（一库业务分类）
  const domainCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: operators.length,
      time: 0,
      effectiveness: 0,
      situation: 0,
      compliance: 0,
      cost: 0,
    };
    for (const op of operators) {
      if (counts[op.category] !== undefined) {
        counts[op.category]++;
      }
    }
    return counts;
  }, [operators]);

  // 算法实现方式统计
  const algoCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: operators.length,
      inline_calc: 0,
      group_agg: 0,
      data_input: 0,
      result_output: 0,
    };
    for (const op of operators) {
      const cat = getOperatorPipelineCategory(op);
      counts[cat.id] = (counts[cat.id] || 0) + 1;
    }
    return counts;
  }, [operators]);

  // 排序与筛选算子
  const filteredOperators = useMemo(() => {
    let list = operators.filter((op) => {
      // 1. 业务领域分类筛选（时效域、效能域、态势域、合规域、成本域）
      if (domainFilter !== 'all' && op.category !== domainFilter) {
        return false;
      }
      // 2. 算法实现辅助筛选
      if (algoFilter !== 'all') {
        const cat = getOperatorPipelineCategory(op);
        if (cat.id !== algoFilter) {
          return false;
        }
      }
      // 3. 文本搜索
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchId = op.id.toLowerCase().includes(q);
        const matchName = op.name.toLowerCase().includes(q);
        const matchDesc = (op.description || '').toLowerCase().includes(q);
        return matchId || matchName || matchDesc;
      }
      return true;
    });

    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'id') {
        cmp = a.id.localeCompare(b.id);
      } else if (sortField === 'category') {
        cmp = a.category.localeCompare(b.category);
      } else if (sortField === 'readiness') {
        const rA = a.readiness || '';
        const rB = b.readiness || '';
        cmp = rA.localeCompare(rB);
      } else if (sortField === 'outputType') {
        cmp = a.outputType.localeCompare(b.outputType);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [operators, domainFilter, algoFilter, searchQuery, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // 删除自定义算子
  const handleDeleteOperator = async (op: MetricAtomMeta) => {
    if (!op.isCustom) {
      alert('内置标准算子受保护，无法删除；可通过[配置]修改默认参数或恢复默认。');
      return;
    }
    const confirmed = window.confirm(
      `确定要彻底删除自定义算子 [${op.name} (${op.id})] 吗？\n删除后该算子的算法流水线将被移除，请确保未被二库指标引用。`
    );
    if (!confirmed) return;

    try {
      const res = await evalApi.deleteOperator(op.id);
      if (res?.deleted) {
        alert(`已成功删除算子 [${op.name}]！`);
        await onRefresh();
      } else {
        alert('删除操作未成功执行，请检查网络或状态');
      }
    } catch (err: any) {
      alert(`删除算子失败: ${err?.message || String(err)}`);
    }
  };

  // 控制原生 dialog 弹窗开启
  useEffect(() => {
    const dialog = editorDialogRef.current;
    if (!dialog) return;
    if (editingOp) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [editingOp]);

  useEffect(() => {
    const dialog = detailDialogRef.current;
    if (!dialog) return;
    if (detailOp) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [detailOp]);

  const operatorSelectorOptions = useMemo<UnifiedAssetOption[]>(() => {
    const domainLabelMap: Record<string, string> = {
      time: '时效域',
      effectiveness: '效能域',
      situation: '态势域',
      compliance: '合规域',
      cost: '成本域',
    };
    return operators.map((op) => ({
      id: op.id,
      label: op.name || op.id,
      subLabel: op.id,
      group: domainLabelMap[op.category] ?? '通用算子',
      badge: op.layer === 'fact' ? '基础事实' : '复合算子',
      badgeTone: op.layer === 'fact' ? 'cyan' : 'slate',
    }));
  }, [operators]);

  return (
    <div className="flex flex-col gap-3 text-slate-100">
      {viewMode === 'canvas' ? (
        <div className="w-full">
          <PipelineCanvasStudio
            key={selectedCanvasOp?.id ?? 'canvas_all'}
            isOpen={true}
            initialOperator={selectedCanvasOp}
            allOperators={operators}
            runs={runs}
            selectedRunId={selectedRunId}
            onSelectRunId={onSelectRun}
            onClose={() => setViewMode('list')}
            onSaved={async () => {
              await onRefresh();
            }}
          />
        </div>
      ) : (
        <>
          {/* ═════════════════ 1. 统一单行紧凑顶栏（下拉直切 + 筛选 + 操作） ═════════════════ */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#30363d] bg-[#161b22] px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-300">
                <Cpu className="h-3.5 w-3.5" />
                <span>算子资产</span>
              </div>

              <span className="rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-0.5 font-mono text-[11px] text-slate-300 tabular-nums">
                {filteredOperators.length === operators.length
                  ? `全部算子 · ${operators.length}`
                  : `${filteredOperators.length} / ${operators.length} 项`}
              </span>

              <UnifiedAssetSelector
                value={selectedCanvasOp?.id ?? ''}
                options={operatorSelectorOptions}
                placeholder="定位算子..."
                searchPlaceholder="搜索名称、ID 或领域..."
                accent="cyan"
                onChange={(opId) => {
                  const target = operators.find((o) => o.id === opId) ?? null;
                  if (target) {
                    setSelectedCanvasOp(target);
                    setViewMode('canvas');
                  }
                }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={domainFilter}
                onChange={(e) => setDomainFilter(e.target.value as DomainFilterKey)}
                aria-label="按业务领域筛选算子"
                className="h-8 rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none cursor-pointer"
              >
                {DOMAIN_CATEGORIES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.id === 'all' ? `全部算子 · ${domainCounts.all ?? 0}` : `${f.label} (${domainCounts[f.id] ?? 0})`}
                  </option>
                ))}
              </select>

              <select
                value={algoFilter}
                onChange={(e) => setAlgoFilter(e.target.value as AlgorithmFilterKey)}
                aria-label="按算法实现方式筛选算子"
                className="h-8 rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none cursor-pointer"
              >
                <option value="all">全部实现方式</option>
                <option value="formula">行内公式 ({algoCounts.formula ?? 0})</option>
                <option value="agg">跨行聚合 ({algoCounts.agg ?? 0})</option>
                <option value="input">数据输入 ({algoCounts.input ?? 0})</option>
                <option value="output">结果输出 ({algoCounts.output ?? 0})</option>
              </select>

              <div className="relative w-44 xl:w-52">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="搜索算子..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 w-full rounded-md border border-[#30363d] bg-[#0d1117] pl-8 pr-7 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setIsCreateModalOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-cyan-400/60 bg-cyan-600 px-3 text-xs font-semibold text-white shadow-lg shadow-cyan-950/60 hover:bg-cyan-500 transition cursor-pointer"
                title="新建评估算子"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>新建算子</span>
              </button>

              <button
                type="button"
                onClick={() => (onOpenSettings ? onOpenSettings('components') : undefined)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 text-xs text-slate-200 hover:border-slate-500 hover:text-white transition cursor-pointer"
                title="扩展管理与组件规范导入"
              >
                <Layers className="h-3.5 w-3.5 text-cyan-400" />
                <span className="hidden xl:inline">扩展管理</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedCanvasOp(null);
                  setViewMode('canvas');
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-cyan-500/45 bg-cyan-500/15 px-2.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/25 transition cursor-pointer"
              >
                <Workflow className="h-3.5 w-3.5" />
                <span>画布编排</span>
              </button>
            </div>
          </div>

          {/* ═════════════════ 2. 响应式限高内滚动算子列表 ═════════════════ */}
          <section
            id="op-panel-catalog"
            role="tabpanel"
            aria-labelledby="tab-operators"
            className="overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22]"
          >
            <div
              ref={listScrollRef}
              onScroll={(e) => {
                savedListScrollTopRef.current = e.currentTarget.scrollTop;
              }}
              className="max-h-[calc(100dvh-200px)] min-h-[380px] overflow-auto"
            >
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 z-10 bg-[#161b22]">
                  <tr className="border-b border-[#30363d] text-slate-400 font-semibold text-[11px]">
                    <th className="px-2.5 py-2.5 w-11 text-center whitespace-nowrap">序号</th>
                    <th className="px-2.5 py-2.5 whitespace-nowrap">标识与名称</th>
                    <th className="px-2.5 py-2.5 whitespace-nowrap">领域</th>
                    <th className="px-2.5 py-2.5 whitespace-nowrap">实现方式</th>
                    <th className="px-2.5 py-2.5 whitespace-nowrap">类型</th>
                    <th className="px-2.5 py-2.5">算法说明</th>
                    <th className="px-2.5 py-2.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleSort('readiness')}
                        className="inline-flex items-center gap-1 font-semibold text-slate-300 hover:text-white whitespace-nowrap"
                      >
                        <span>就绪门控</span>
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="px-2.5 py-2.5 text-right whitespace-nowrap">操作</th>
                  </tr>
                </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {filteredOperators.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    未检索到符合条件的算子
                  </td>
                </tr>
              ) : (
                filteredOperators.map((op, idx) => {
                  const domainInfo = getDomainBadge(op.category);
                  const pCat = getOperatorPipelineCategory(op);
                  const isLastVisited = selectedCanvasOp?.id === op.id;
                  return (
                    <tr
                      key={op.id}
                      className={`transition ${isLastVisited ? 'bg-cyan-500/10 hover:bg-cyan-500/15' : 'hover:bg-slate-800/30'}`}
                    >
                      <td className="px-4 py-3 text-center font-mono text-slate-500 text-[11px]">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px] text-cyan-400/90 font-medium">{op.id}</span>
                          {v4SpecMap[op.id] && (
                            <span
                              className={`rounded px-1.5 py-0.2 text-[9px] font-semibold border ${
                                v4SpecMap[op.id].layer === 'fact'
                                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                  : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                              }`}
                            >
                              {v4SpecMap[op.id].layer === 'fact' ? 'V4 事实' : 'V4 汇总'}
                            </span>
                          )}
                        </div>
                        <div className="font-bold text-xs text-slate-100 mt-0.5">{op.name}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block whitespace-nowrap rounded-md border px-2 py-0.5 text-[10px] font-semibold ${domainInfo.badgeBg}`}>
                          {domainInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-medium ${pCat.badgeBg}`}>
                          {pCat.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-300 text-[11px]">
                        {op.outputType}
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs leading-relaxed max-w-md">
                        <div>{op.description}</div>
                        {op.customDef?.formulaConfig?.derivedColumns?.[0] && (
                          <div className="mt-1 font-mono text-[10px] text-cyan-300/80 bg-slate-900/80 rounded px-1.5 py-0.5 inline-block">
                            公式: {op.customDef.formulaConfig.derivedColumns[0].expression}
                          </div>
                        )}
                        {(op.customDef?.aggregationConfig?.metrics?.[0] || (op.customDef?.aggregationConfig as any)?.aggregations?.[0]) && (
                          <div className="mt-1 font-mono text-[10px] text-amber-300/80 bg-slate-900/80 rounded px-1.5 py-0.5 inline-block">
                            聚合: {op.customDef?.aggregationConfig?.metrics?.[0]?.method ?? (op.customDef?.aggregationConfig as any)?.aggregations?.[0]?.op}({op.customDef?.aggregationConfig?.metrics?.[0]?.sourceColumn ?? (op.customDef?.aggregationConfig as any)?.aggregations?.[0]?.sourceField})
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {op.readiness === "batch_b_pending" ? (
                          <span
                            className="inline-block rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300"
                            title="batch_b_pending: 待后续批次仿真数据补齐"
                          >
                            Batch B 待补全
                          </span>
                        ) : (
                          <span
                            className="inline-block rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400"
                            title="batch_a_ready: 基础批次实证就绪"
                          >
                            Batch A 就绪
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5 pr-4">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCanvasOp(op);
                            setViewMode('canvas');
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/50 bg-cyan-500/20 px-2.5 py-1 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/30 shadow-sm transition"
                          title="在可视化画布中编辑此算子流水线"
                        >
                          <Workflow className="h-3.5 w-3.5" />
                          <span>画布编排</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setEditingOp(op)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2 py-1 text-xs text-slate-200 hover:text-white hover:bg-slate-700 transition"
                          title="配置参数与计算规则"
                        >
                          <Settings2 className="h-3.5 w-3.5 text-slate-400" />
                          <span>配置</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setDetailOp(op)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2 py-1 text-xs text-slate-300 hover:text-slate-100 hover:bg-slate-700 transition"
                          title="查看底层数据来源与字段映射"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>详情</span>
                        </button>

                        {op.isCustom ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteOperator(op)}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/30 hover:text-rose-100 transition shadow-sm"
                            title="删除此自定义算子"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                            <span>删除</span>
                          </button>
                        ) : (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-1 text-[11px] text-slate-600 select-none"
                            title="内置标准算子受保护，不可删除；支持参数修改与恢复默认"
                          >
                            <Lock className="h-3 w-3" />
                            <span>内置</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 原生 HTML <dialog> 算子底层数据映射与内部算法详情弹窗 */}
        <dialog
          ref={detailDialogRef}
          aria-labelledby={detailHeadingId}
          onClose={(e) => {
            e.currentTarget.returnValue = '';
            setDetailOp(null);
            setV4RunResult(null);
          }}
          className="w-full max-w-4xl rounded-2xl border border-slate-800 bg-[#0d1424] p-0 text-slate-100 backdrop:bg-black/60 shadow-2xl"
        >
          {detailOp && (
            <div className="flex max-h-[88vh] flex-col">
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 id={detailHeadingId} className="text-sm font-bold text-slate-100">
                      {detailOp.name}
                    </h3>
                    {v4SpecMap[detailOp.id] && (
                      <span className="rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                        {v4SpecMap[detailOp.id].layer === 'fact' ? 'V4 客观事实算子' : 'V4 汇总算子'} · 第 {v4SpecMap[detailOp.id].chapter} 章
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-xs text-slate-400">{detailOp.id}</div>
                </div>
                <button
                  type="button"
                  autoFocus
                  onClick={() => detailDialogRef.current?.close()}
                  aria-label="关闭算子详情弹窗"
                  className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700"
                >
                  关闭
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3.5 text-xs">
                <p className="text-xs leading-relaxed text-slate-300">{detailOp.description}</p>

                <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-xs">
                  <div className="flex items-center gap-1.5 font-medium text-slate-200">
                    <Database className="h-3.5 w-3.5 text-cyan-400" />
                    <span>底层数据来源与字段映射 (sim-output-fields)</span>
                  </div>
                  {(v4SpecMap[detailOp.id]?.requiredTables || detailOp.f1FieldContract?.csvTables) && (
                    <div>
                      <span className="text-slate-400">必需底表：</span>
                      <span className="font-mono text-emerald-300">
                        {(v4SpecMap[detailOp.id]?.requiredTables ?? detailOp.f1FieldContract?.csvTables ?? []).join(', ')}
                      </span>
                    </div>
                  )}
                  {v4SpecMap[detailOp.id]?.optionalTables && v4SpecMap[detailOp.id].optionalTables!.length > 0 && (
                    <div>
                      <span className="text-slate-400">可选底表：</span>
                      <span className="font-mono text-slate-300">
                        {v4SpecMap[detailOp.id].optionalTables!.join(', ')}
                      </span>
                    </div>
                  )}
                  {(v4SpecMap[detailOp.id]?.outputColumnNames || detailOp.f1FieldContract?.csvColumns) && (
                    <div>
                      <span className="text-slate-400">输出二维表列：</span>
                      <span className="font-mono text-slate-200">
                        {(v4SpecMap[detailOp.id]?.outputColumnNames ?? detailOp.f1FieldContract?.csvColumns ?? []).join(', ')}
                      </span>
                    </div>
                  )}
                </div>

                {v4SpecMap[detailOp.id]?.pythonCode && (
                  <div className="space-y-2 rounded-xl border border-slate-800 bg-[#070b14] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-medium text-fuchsia-300">
                        <Code2 className="h-3.5 w-3.5" />
                        <span>内部算法实现 (Python 沙箱科学计算源码)</span>
                      </div>
                      <button
                        type="button"
                        disabled={v4RunLoading}
                        onClick={async () => {
                          setV4RunLoading(true);
                          setV4RunResult(null);
                          try {
                            const resp = await fetch('/api/v4/operators/run', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                operatorId: detailOp.id,
                                runId: selectedRunId || '55th_taihai_csv',
                                dataSourceId: activeSourceId || undefined,
                              }),
                            });
                            const json = await resp.json();
                            const r = json?.result ?? json;
                            setV4RunResult({
                              operatorId: detailOp.id,
                              status: r?.status ?? (json?.ok ? 'valid' : 'unavailable'),
                              dataset: r?.dataset,
                              missingDataReason: r?.missingDataReason ?? json?.error,
                              latencyMs: r?.latencyMs,
                            });
                          } catch (err) {
                            setV4RunResult({
                              operatorId: detailOp.id,
                              status: 'unavailable',
                              missingDataReason: err instanceof Error ? err.message : String(err),
                            });
                          } finally {
                            setV4RunLoading(false);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/50 bg-emerald-600/25 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-600/40 disabled:opacity-50"
                      >
                        <Play className="h-3 w-3" />
                        <span>{v4RunLoading ? '真机计算中...' : 'V4 真机试算 (二维表)'}</span>
                      </button>
                    </div>
                    <pre className="max-h-60 overflow-auto rounded-lg border border-slate-800/80 bg-[#0b101b] p-3 font-mono text-[11px] leading-relaxed text-slate-200">
                      <code>{v4SpecMap[detailOp.id].pythonCode}</code>
                    </pre>
                  </div>
                )}

                {v4RunResult && v4RunResult.operatorId === detailOp.id && (
                  <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-slate-200">
                        实测输出状态：
                        <span className={v4RunResult.status === 'valid' ? 'text-emerald-400' : 'text-amber-400'}>
                          {v4RunResult.status}
                        </span>
                        {typeof v4RunResult.latencyMs === 'number' ? ` · ${v4RunResult.latencyMs.toFixed(1)} ms` : ''}
                      </span>
                    </div>
                    {v4RunResult.missingDataReason && (
                      <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
                        {v4RunResult.missingDataReason}
                      </div>
                    )}
                    {v4RunResult.dataset && (
                      <V4TablePivotPreview dataset={v4RunResult.dataset} maxRows={50} />
                    )}
                  </div>
                )}

                <div className="pt-2 flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      const target = detailOp;
                      detailDialogRef.current?.close();
                      setSelectedCanvasOp(target);
                      setViewMode('canvas');
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-cyan-500/50 bg-cyan-600/30 px-4 py-2.5 text-xs font-bold text-cyan-200 hover:bg-cyan-600/50 transition shadow-md"
                  >
                    <Workflow className="h-4 w-4" />
                    <span>在一体化画布中查看/编排内部结构</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </dialog>

        {/* 原生 HTML <dialog> 独立算子配置弹窗 */}
        <dialog
          ref={editorDialogRef}
          aria-labelledby={editorHeadingId}
          onClose={(e) => {
            e.currentTarget.returnValue = '';
            setEditingOp(null);
          }}
          className="w-full max-w-4xl rounded-2xl border border-slate-800 bg-[#0d1424] p-0 text-slate-100 backdrop:bg-black/60 shadow-2xl"
        >
          {editingOp && (
            <OperatorInlineEditor
              operator={editingOp}
              allOperators={operators}
              catalog={catalog}
              headingId={editorHeadingId}
              onCancel={() => editorDialogRef.current?.close()}
              onOpenPipeline={(targetOp) => {
                editorDialogRef.current?.close();
                setSelectedCanvasOp(targetOp);
                setViewMode('canvas');
              }}
              onSaved={async () => {
                editorDialogRef.current?.close();
                await onRefresh();
              }}
              onDeleted={async () => {
                editorDialogRef.current?.close();
                await onRefresh();
              }}
            />
          )}
        </dialog>
      </section>

      {/* ═════════════════ 3. 新建自定义算子全功能弹窗 ═════════════════ */}
      <CreateOperatorModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        existingOperators={operators}
        onCreated={async (newOp, openCanvas) => {
          await onRefresh();
          if (openCanvas) {
            setSelectedCanvasOp(newOp);
            setViewMode('canvas');
          }
        }}
      />
        </>
      )}
    </div>
  );
}
