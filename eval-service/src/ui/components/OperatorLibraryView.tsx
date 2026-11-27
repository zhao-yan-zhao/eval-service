import { useId, useLayoutEffect, useMemo, useRef, useState, useEffect } from 'react';
import {
  ArrowUpDown,
  BarChart3,
  Calculator,
  ChevronDown,
  Code2,
  Compass,
  Cpu,
  Database,
  Eye,
  Layers,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import {
  evalApi,
  type F1OutputCatalog,
  type StoredRunSummary,
  type TableDataset,
  type V4OperatorItem,
} from '../api.ts';
import { PipelineCanvasStudio } from './pipeline-canvas/index.ts';
import { OperatorInlineEditor } from './OperatorInlineEditor.tsx';
import { CreateOperatorModal } from './CreateOperatorModal.tsx';
import { V4TablePivotPreview } from './v4/index.ts';
import { UnifiedAssetSelector, type UnifiedAssetOption } from './v4/UnifiedAssetSelector.tsx';

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

export function getOperatorPipelineCategory(op: V4OperatorItem): {
  id: 'data_input' | 'inline_calc' | 'group_agg' | 'result_output' | 'spatial' | 'python_script';
  label: string;
  badgeBg: string;
} {
  switch (op.engineKind) {
    case 'spatial':
      return { id: 'spatial', label: '空间几何', badgeBg: 'bg-violet-500/15 text-violet-400 border-violet-500/30' };
    case 'python_script':
      return { id: 'python_script', label: 'Python 脚本', badgeBg: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30' };
    case 'data_input':
      return { id: 'data_input', label: '数据抽取', badgeBg: 'bg-blue-500/15 text-blue-400 border-blue-500/30' };
    case 'inline_calc':
      return { id: 'inline_calc', label: '行内公式', badgeBg: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' };
    case 'group_agg':
      return { id: 'group_agg', label: '跨行聚合', badgeBg: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
    default:
      return { id: 'python_script', label: 'Python 脚本', badgeBg: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30' };
  }
}

export interface OperatorLibraryViewProps {
  loading?: boolean;
  operators: V4OperatorItem[];
  runs: StoredRunSummary[];
  selectedRunId: string;
  activeSourceId?: string;
  onSelectRun?: (runId: string) => void;
  catalog?: F1OutputCatalog | null;
  focusedOperatorTarget?: { id: string; nonce: number } | null;
  onRefresh?: () => Promise<void>;
  onOpenSettings?: (tab?: string) => void;
}

type SortField = 'id' | 'category' | 'layer' | 'militaryLevel';
type SortDir = 'asc' | 'desc';

export function OperatorLibraryView({
  loading = false,
  operators,
  runs,
  selectedRunId,
  activeSourceId,
  onSelectRun,
  catalog = null,
  focusedOperatorTarget = null,
  onRefresh = async () => {},
  onOpenSettings,
}: OperatorLibraryViewProps) {
  const [viewMode, setViewMode] = useState<'list' | 'canvas'>('list');
  const [selectedCanvasOp, setSelectedCanvasOp] = useState<V4OperatorItem | null>(null);

  const [v4RunLoading, setV4RunLoading] = useState(false);
  const [v4RunResult, setV4RunResult] = useState<{
    operatorId: string;
    status: string;
    dataset?: TableDataset;
    missingDataReason?: string;
    latencyMs?: number;
  } | null>(null);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [detailOp, setDetailOp] = useState<V4OperatorItem | null>(null);
  const [editingOp, setEditingOp] = useState<V4OperatorItem | null>(null);
  const [coldStartBannerDismissed, setColdStartBannerDismissed] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const editorDialogRef = useRef<HTMLDialogElement | null>(null);
  const detailDialogRef = useRef<HTMLDialogElement | null>(null);
  const editorHeadingId = useId();
  const detailHeadingId = useId();

  useEffect(() => {
    if (!moreMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [moreMenuOpen]);

  const operatorSelectorOptions = useMemo<UnifiedAssetOption[]>(
    () =>
      operators.map((op) => ({
        id: op.id,
        label: op.name,
        subLabel: op.id,
        group: getDomainBadge(op.category).label,
        badge: op.militaryLevel,
        badgeTone: 'cyan',
      })),
    [operators],
  );

  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const savedListScrollTopRef = useRef<number>(0);

  useLayoutEffect(() => {
    if (viewMode === 'list' && listScrollRef.current) {
      listScrollRef.current.scrollTop = savedListScrollTopRef.current;
    }
  }, [viewMode]);

  const [domainFilter, setDomainFilter] = useState<DomainFilterKey>('all');
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

  const algoCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: operators.length,
      python_script: 0,
      spatial: 0,
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

  const filteredOperators = useMemo(() => {
    let list = operators.filter((op) => {
      if (domainFilter !== 'all' && op.category !== domainFilter) {
        return false;
      }
      if (algoFilter !== 'all') {
        const cat = getOperatorPipelineCategory(op);
        if (cat.id !== algoFilter) {
          return false;
        }
      }
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
      } else if (sortField === 'layer') {
        cmp = (a.layer ?? '').localeCompare(b.layer ?? '');
      } else if (sortField === 'militaryLevel') {
        cmp = (a.militaryLevel ?? '').localeCompare(b.militaryLevel ?? '');
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

  const handleDeleteOperator = async (op: V4OperatorItem) => {
    if (op.isBuiltin) {
      alert('内置标准 V4 算子受保护，无法删除；可通过[配置]修改默认参数或恢复默认。');
      return;
    }
    const confirmed = window.confirm(
      `确定要彻底删除自定义 V4 算子 [${op.name} (${op.id})] 吗？\n删除后该算子的算法流水线将被移除，请确保未被二库指标图引用。`,
    );
    if (!confirmed) return;

    try {
      const res = await evalApi.deleteV4Operator(op.id);
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

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-slate-100">
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
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#30363d] bg-[#161b22] px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-300">
                <Cpu className="h-3.5 w-3.5" />
                <span>V4 算子资产</span>
              </div>

              <span className="rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1 font-mono text-[11px] text-slate-300 tabular-nums">
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
                  const target = operators.find((o) => o.id === opId);
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
                    {f.id === 'all' ? `全部分域 (${domainCounts.all ?? 0})` : `${f.label} (${domainCounts[f.id] ?? 0})`}
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
                <option value="python_script">Python 脚本 ({algoCounts.python_script ?? 0})</option>
                <option value="spatial">空间几何 ({algoCounts.spatial ?? 0})</option>
                <option value="inline_calc">行内公式 ({algoCounts.inline_calc ?? 0})</option>
                <option value="group_agg">跨行聚合 ({algoCounts.group_agg ?? 0})</option>
                <option value="data_input">数据抽取 ({algoCounts.data_input ?? 0})</option>
              </select>

              <div className="relative w-48 xl:w-56">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="搜索算子 / ID / 说明..."
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
                        if (onOpenSettings) onOpenSettings('components');
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-cyan-200 hover:bg-[#161b22] transition cursor-pointer"
                    >
                      <Layers className="h-3.5 w-3.5 text-cyan-400" />
                      <span>扩展管理</span>
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        setMoreMenuOpen(false);
                        setRefreshing(true);
                        try {
                          await onRefresh();
                        } finally {
                          setRefreshing(false);
                        }
                      }}
                      disabled={refreshing || loading}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-300 hover:bg-[#161b22] disabled:opacity-50 transition cursor-pointer"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 text-slate-400 ${refreshing || loading ? 'animate-spin' : ''}`}
                      />
                      <span>刷新算子库</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {operators.length > 0 && !selectedRunId && !coldStartBannerDismissed && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-cyan-500/35 bg-gradient-to-r from-cyan-950/40 via-[#161b22] to-blue-950/30 px-3.5 py-2 text-xs text-cyan-200">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-cyan-400" />
                <span>
                  一库 V4 算子库已就绪（共 {operators.length} 个算子）。点击任意算子进入画布编排，或在右上角选择推演场次进行实时二维表试算。
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
                <thead className="sticky top-0 z-10 border-b border-[#30363d] bg-[#161b22] text-[11px] font-medium text-slate-400">
                  <tr>
                    <th className="px-3.5 py-2.5 w-12 text-center whitespace-nowrap font-medium">序号</th>
                    <th className="px-3.5 py-2.5 whitespace-nowrap font-medium">算子名称与标识</th>
                    <th className="px-3.5 py-2.5 whitespace-nowrap font-medium">层级 / 领域</th>
                    <th className="px-3.5 py-2.5 whitespace-nowrap font-medium">实现方式</th>
                    <th className="px-3.5 py-2.5 font-medium">算法说明</th>
                    <th className="px-3.5 py-2.5 whitespace-nowrap font-medium">
                      <button
                        type="button"
                        onClick={() => toggleSort('layer')}
                        className="inline-flex items-center gap-1 font-medium text-slate-300 hover:text-white whitespace-nowrap cursor-pointer"
                      >
                        <span>就绪门控</span>
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="px-3.5 py-2.5 text-right whitespace-nowrap font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]/70 font-sans">
                  {loading && operators.length === 0 ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={`op-skeleton-${i}`} className="animate-pulse">
                        <td className="px-3.5 py-3 text-center">
                          <div className="mx-auto h-3 w-5 rounded bg-slate-800" />
                        </td>
                        <td className="px-3.5 py-3">
                          <div className="h-3.5 w-40 rounded bg-slate-700/60 mb-1.5" />
                          <div className="h-2.5 w-28 rounded bg-slate-800/80" />
                        </td>
                        <td className="px-3.5 py-3"><div className="h-4 w-20 rounded bg-slate-800" /></td>
                        <td className="px-3.5 py-3"><div className="h-4 w-16 rounded bg-slate-800" /></td>
                        <td className="px-3.5 py-3"><div className="h-3.5 w-56 rounded bg-slate-800/70" /></td>
                        <td className="px-3.5 py-3"><div className="h-4 w-20 rounded bg-slate-800" /></td>
                        <td className="px-3.5 py-3 text-right"><div className="inline-block h-6 w-20 rounded bg-slate-800" /></td>
                      </tr>
                    ))
                  ) : filteredOperators.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-500">
                        <div className="flex flex-col items-center gap-2">
                          <span>未检索到符合条件的算子</span>
                          {operators.length === 0 && (
                            <button
                              type="button"
                              onClick={() => void onRefresh()}
                              className="mt-1 rounded-md border border-cyan-500/40 bg-cyan-500/15 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/25 cursor-pointer"
                            >
                              刷新算子库
                            </button>
                          )}
                        </div>
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
                          onClick={() => {
                            setSelectedCanvasOp(op);
                            setViewMode('canvas');
                          }}
                          title="点击进入该算子的画布编排"
                          className={`group cursor-pointer transition ${
                            isLastVisited ? 'bg-cyan-500/10 hover:bg-cyan-500/15' : 'hover:bg-[#1b2230]'
                          }`}
                        >
                          <td className="px-3.5 py-2.5 text-center font-mono text-slate-500 text-[11px] align-middle">
                            {idx + 1}
                          </td>
                          <td className="px-3.5 py-2.5 align-middle">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-xs text-slate-100 group-hover:text-cyan-200 transition">
                                {op.name}
                              </span>
                              <span
                                className={`rounded px-1.5 py-0 text-[9px] font-semibold border ${
                                  op.layer === 'fact'
                                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                    : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                                }`}
                              >
                                {op.layer === 'fact' ? 'V4 事实' : 'V4 汇总'}
                              </span>
                            </div>
                            <div className="font-mono text-[11px] text-slate-400 mt-0.5">{op.id}</div>
                          </td>
                          <td className="px-3.5 py-2.5 align-middle whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <span className="rounded border border-cyan-500/35 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-200">
                                {op.militaryLevel}
                              </span>
                              <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium ${domainInfo.badgeBg}`}>
                                {domainInfo.label}
                              </span>
                            </div>
                          </td>
                          <td className="px-3.5 py-2.5 align-middle whitespace-nowrap">
                            <span className={`inline-block rounded border px-2 py-0.5 text-[10px] font-medium ${pCat.badgeBg}`}>
                              {pCat.label}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-400 text-xs max-w-sm align-middle">
                            <div className="line-clamp-2 leading-relaxed">{op.description}</div>
                          </td>
                          <td className="px-3.5 py-2.5 whitespace-nowrap align-middle">
                            <span
                              className="inline-block rounded border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400"
                              title={`必需底表: ${(op.requiredTables ?? []).join(', ') || '通用'}`}
                            >
                              V4 实证就绪
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 text-right whitespace-nowrap align-middle">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedCanvasOp(op);
                                  setViewMode('canvas');
                                }}
                                className="inline-flex items-center gap-1 rounded-md border border-cyan-500/45 bg-cyan-500/15 px-2.5 py-1 text-xs font-medium text-cyan-200 hover:bg-cyan-500/30 transition cursor-pointer"
                                title="在可视化画布中编辑此算子流水线"
                              >
                                <Workflow className="h-3.5 w-3.5" />
                                <span>画布编排</span>
                              </button>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingOp(op);
                                }}
                                aria-label="配置"
                                className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white transition cursor-pointer"
                                title="配置参数与计算规则"
                              >
                                <Settings2 className="h-3.5 w-3.5 text-slate-400" />
                              </button>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDetailOp(op);
                                }}
                                aria-label="详情"
                                className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white transition cursor-pointer"
                                title="查看底层数据来源与字段映射"
                              >
                                <Eye className="h-3.5 w-3.5 text-slate-400" />
                              </button>

                              {!op.isBuiltin && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteOperator(op);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/25 transition cursor-pointer"
                                  title="删除此自定义算子"
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
                        <span className="rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                          {detailOp.layer === 'fact' ? 'V4 客观事实算子' : 'V4 汇总算子'} · 第 {detailOp.chapter} 章
                        </span>
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
                      {detailOp.requiredTables && detailOp.requiredTables.length > 0 && (
                        <div>
                          <span className="text-slate-400">必需底表：</span>
                          <span className="font-mono text-emerald-300">
                            {detailOp.requiredTables.join(', ')}
                          </span>
                        </div>
                      )}
                      {detailOp.optionalTables && detailOp.optionalTables.length > 0 && (
                        <div>
                          <span className="text-slate-400">可选底表：</span>
                          <span className="font-mono text-slate-300">
                            {detailOp.optionalTables.join(', ')}
                          </span>
                        </div>
                      )}
                      {detailOp.outputColumnNames && detailOp.outputColumnNames.length > 0 && (
                        <div>
                          <span className="text-slate-400">输出二维表列：</span>
                          <span className="font-mono text-slate-200">
                            {detailOp.outputColumnNames.join(', ')}
                          </span>
                        </div>
                      )}
                    </div>

                    {detailOp.pythonCode && (
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
                                const json = await evalApi.runV4Operator({
                                  operatorId: detailOp.id,
                                  runId: selectedRunId || '55th_taihai_csv',
                                  dataSourceId: activeSourceId || undefined,
                                });
                                const r = json.result;
                                setV4RunResult({
                                  operatorId: detailOp.id,
                                  status: r?.status ?? 'valid',
                                  dataset: r?.dataset,
                                  missingDataReason: r?.missingDataReason,
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
                          <code>{detailOp.pythonCode}</code>
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
