import React, { useId, useMemo, useRef, useState, useEffect } from 'react';
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
import { FormulaOperatorModal } from './FormulaOperatorModal.tsx';
import { AggregationOperatorModal } from './AggregationOperatorModal.tsx';
import { PipelineCanvasStudio } from './pipeline-canvas/index.ts';
import { AlgorithmSandboxModal } from './AlgorithmSandboxModal.tsx';
import { OperatorInlineEditor } from './OperatorInlineEditor.tsx';
import { CreateOperatorModal } from './CreateOperatorModal.tsx';
import { evalApi } from '../api.ts';

/**
 * 业务领域分类定义（一库算子库的核心业务分类）
 */
export const DOMAIN_CATEGORIES = [
  { id: 'all' as const, label: '全部算子' },
  { id: 'time' as const, label: '时效域 (Time)' },
  { id: 'effectiveness' as const, label: '效能域 (Effectiveness)' },
  { id: 'situation' as const, label: '态势域 (Situation)' },
  { id: 'compliance' as const, label: '合规域 (Compliance)' },
  { id: 'cost' as const, label: '成本域 (Cost)' },
];

export type DomainFilterKey = 'all' | 'time' | 'effectiveness' | 'situation' | 'compliance' | 'cost';
export type AlgorithmFilterKey = 'all' | 'inline_calc' | 'group_agg' | 'data_input' | 'result_output' | 'spatial' | 'python_script';

export function getDomainBadge(category: string): { label: string; badgeBg: string } {
  switch (category) {
    case 'time':
      return { label: '时效域 (Time)', badgeBg: 'bg-blue-500/15 text-blue-400 border-blue-500/30' };
    case 'effectiveness':
      return { label: '效能域 (Effectiveness)', badgeBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
    case 'situation':
      return { label: '态势域 (Situation)', badgeBg: 'bg-violet-500/15 text-violet-400 border-violet-500/30' };
    case 'compliance':
      return { label: '合规域 (Compliance)', badgeBg: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
    case 'cost':
      return { label: '成本域 (Cost)', badgeBg: 'bg-rose-500/15 text-rose-400 border-rose-500/30' };
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
    engine: 'LibFormula AST 表达式解析器 (零 eval)',
    badgeBg: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    description: '使用 LibFormula 计算公式。支持行内四则运算、函数嵌套 (数学/逻辑/文本/时间函数) 及多字段逻辑处理，生成衍生计算列。',
    iconName: 'Calculator',
    type: 'inline_calc',
  },
  {
    id: 'algo_group_agg',
    seq: 3,
    name: '数据汇总',
    category: '跨行聚合',
    engine: 'Welford 流式多主键聚合器',
    badgeBg: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    description: '按指定字段分组聚合统计，支持求和(SUM)、均值(AVERAGE)、极值(MAX/MIN)、计数(COUNT)、方差(STDEV)等聚合计算，将多行明细样本聚合为标量指标。',
    iconName: 'BarChart3',
    type: 'group_agg',
  },
  {
    id: 'algo_result_output',
    seq: 4,
    name: '结果处理',
    category: '结果输出',
    engine: '二库指标绑定与体系挂载适配器',
    badgeBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    description: '结果处理与指标收口。将计算出的标量指标一键发布至二库（指标配置），并挂载到三库（评估体系树），打通从特征计算到体系决策的闭环。',
    iconName: 'Target',
    type: 'result_output',
  },
  {
    id: 'algo_spatial_geom',
    seq: 5,
    name: '空间几何算法',
    category: '空间态势',
    engine: 'Turf.js 空间几何分析引擎',
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
  if (pCat === 'spatial') return { id: 'spatial', label: '空间几何 (Turf.js)', badgeBg: 'bg-violet-500/15 text-violet-400 border-violet-500/30' };
  if (pCat === 'python_script') return { id: 'python_script', label: 'Python (科学计算)', badgeBg: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30' };
  if (pCat === 'data_input') return { id: 'data_input', label: '表输入 (数据抽取)', badgeBg: 'bg-blue-500/15 text-blue-400 border-blue-500/30' };
  if (pCat === 'inline_calc') return { id: 'inline_calc', label: '公式 (行内计算)', badgeBg: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' };
  if (pCat === 'group_agg') return { id: 'group_agg', label: '数据汇总 (跨行聚合)', badgeBg: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
  if (pCat === 'result_output') return { id: 'result_output', label: '结果处理 (结果输出)', badgeBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };

  if (
    op.id.includes('corridor') ||
    op.id.includes('centroid') ||
    op.id.includes('scatter') ||
    op.id.includes('hull') ||
    op.id.includes('area_coverage')
  ) {
    return { id: 'spatial', label: '空间几何 (Turf.js)', badgeBg: 'bg-violet-500/15 text-violet-400 border-violet-500/30' };
  }

  if (op.id.includes('saturation') || op.id.includes('mcda') || op.id.includes('python')) {
    return { id: 'python_script', label: 'Python (科学计算)', badgeBg: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30' };
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
    return { id: 'group_agg', label: '数据汇总 (跨行聚合)', badgeBg: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
  }

  if (op.id.includes('mission_success') || op.outputType === 'score') {
    return { id: 'result_output', label: '结果处理 (结果输出)', badgeBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
  }

  return { id: 'inline_calc', label: '公式 (行内计算)', badgeBg: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' };
}

interface OperatorLibraryViewProps {
  operators: MetricAtomMeta[];
  indicators?: IndicatorDefinition[];
  systems?: IndicatorSystem[];
  runs: StoredRunSummary[];
  selectedRunId: string;
  catalog?: F1OutputCatalog | null;
  focusedOperatorTarget?: { id: string; nonce: number } | null;
  onRefresh?: () => Promise<void>;
}

type SortField = 'id' | 'category' | 'readiness' | 'outputType';
type SortDir = 'asc' | 'desc';

export function OperatorLibraryView({
  operators,
  indicators = [],
  systems = [],
  runs,
  selectedRunId,
  catalog = null,
  focusedOperatorTarget = null,
  onRefresh = async () => {},
}: OperatorLibraryViewProps) {
  // 视图模式：默认直接呈现算子列表；点击操作进入全屏沉浸式画布
  const [viewMode, setViewMode] = useState<'list' | 'canvas'>('list');
  const [selectedCanvasOp, setSelectedCanvasOp] = useState<MetricAtomMeta | null>(null);

  // 基础算法库弹窗状态（点击右上角管理查看/扩展算法）
  const [algoModalOpen, setAlgoModalOpen] = useState(false);

  // 独立算法沙箱状态（所有基础算法的统一 Dry-Run 试跑工作台）
  const [sandboxModalOpen, setSandboxModalOpen] = useState(false);
  const [sandboxAlgo, setSandboxAlgo] = useState<RegisteredAlgorithm | null>(null);

  // 基础算法库数据（内置 6 项核心 + 动态可扩展）
  const [algorithms, setAlgorithms] = useState<RegisteredAlgorithm[]>(() => {
    try {
      const saved = localStorage.getItem('f1_custom_algorithms_registry');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return [...INITIAL_ALGORITHMS, ...parsed];
        }
      }
    } catch {
      // ignore
    }
    return INITIAL_ALGORITHMS;
  });

  // 新增算法子弹窗状态
  const [newAlgoModalOpen, setNewAlgoModalOpen] = useState(false);
  const [newAlgoForm, setNewAlgoForm] = useState({
    name: '',
    category: '行内计算',
    engine: 'LibFormula AST 表达式解析器',
    description: '',
    type: 'inline_calc' as RegisteredAlgorithm['type'],
  });

  // 单项公式/聚合配置弹窗状态
  const [formulaModalOpen, setFormulaModalOpen] = useState(false);
  const [formulaModalOp, setFormulaModalOp] = useState<MetricAtomMeta | null>(null);
  const [aggModalOpen, setAggModalOpen] = useState(false);
  const [aggModalOp, setAggModalOp] = useState<MetricAtomMeta | null>(null);

  // 新增自定义算子弹窗状态
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // 原生 <dialog> 详情与行内配置状态
  const [detailOp, setDetailOp] = useState<MetricAtomMeta | null>(null);
  const [editingOp, setEditingOp] = useState<MetricAtomMeta | null>(null);
  const editorDialogRef = useRef<HTMLDialogElement | null>(null);
  const detailDialogRef = useRef<HTMLDialogElement | null>(null);
  const editorHeadingId = useId();
  const detailHeadingId = useId();

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

  // 保存新增算法
  const handleCreateNewAlgorithm = () => {
    if (!newAlgoForm.name.trim()) {
      alert('请输入算法名称');
      return;
    }
    const newId = `algo_custom_${Date.now()}`;
    const newAlgo: RegisteredAlgorithm = {
      id: newId,
      seq: algorithms.length + 1,
      name: newAlgoForm.name.trim(),
      category: newAlgoForm.category,
      engine: newAlgoForm.engine.trim() || '自定义脚本执行引擎',
      badgeBg: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
      description: newAlgoForm.description.trim() || '用户自定义扩展算法。',
      iconName: newAlgoForm.type === 'python_script' ? 'Code2' : newAlgoForm.type === 'spatial' ? 'Compass' : 'Calculator',
      type: newAlgoForm.type,
      isCustom: true,
    };
    const updated = [...algorithms, newAlgo];
    setAlgorithms(updated);
    try {
      const customOnly = updated.filter((a) => a.isCustom);
      localStorage.setItem('f1_custom_algorithms_registry', JSON.stringify(customOnly));
    } catch {
      // ignore
    }
    setNewAlgoModalOpen(false);
    setNewAlgoForm({
      name: '',
      category: '行内计算',
      engine: 'LibFormula AST 表达式解析器',
      description: '',
      type: 'inline_calc',
    });
    alert(`已成功注册新算法 [${newAlgo.name}]！已加入算法底座，可在画布流水线左侧构件栏中选用编排。`);
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

  // 如果处于画布工坊模式，全屏展示画布视图
  if (viewMode === 'canvas') {
    return (
      <div className="w-full">
        <PipelineCanvasStudio
          key={selectedCanvasOp?.id ?? 'canvas_all'}
          isOpen={true}
          initialOperator={selectedCanvasOp}
          allOperators={operators}
          onClose={() => setViewMode('list')}
          onSaved={async () => {
            await onRefresh();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ═════════════════ 1. 顶栏：极简干练，直面算子业务 ═════════════════ */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-[#0d1424] px-5 py-4 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-sky-500/15 text-sky-400 border border-sky-500/30">
              <Cpu className="h-5 w-5" />
            </div>
            <h1 className="text-base font-bold text-slate-100 tracking-wide">
              算子列表 (一库 · 评估体系计算底座)
            </h1>
            <span className="rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-0.5 text-xs text-slate-400 font-medium">
              共 {operators.length} 项
            </span>
          </div>
          <p className="text-xs text-slate-400">
            涵盖时效域、效能域、态势域、合规域、成本域五大业务领域算子资产，为二库（指标配置）与三库（评估体系）提供特征计算底座。
          </p>
        </div>

        {/* 右侧操作：新建算子 + 算法库管理 + 打开可视化画布 */}
        <div className="flex items-center gap-2.5">
          {/* 新建自定义算子 */}
          <button
            type="button"
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-emerald-500/50 bg-gradient-to-r from-emerald-600/30 to-teal-600/30 px-3.5 py-2 text-xs font-bold text-emerald-200 hover:from-emerald-600/50 hover:to-teal-600/50 hover:text-white transition shadow-md shadow-emerald-950/30 hover:scale-[1.02]"
            title="新建自定义评估算子，并支持直接进入画布进行算法流水线编排"
          >
            <Plus className="h-4 w-4 text-emerald-300" />
            <span>新建算子</span>
          </button>

          {/* 基础算法库管理入口：轻量按钮，点击滑出标准算法大表 */}
          <button
            type="button"
            onClick={() => setAlgoModalOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition shadow-sm"
            title="查看与扩展基础算法库 (Image 1 规范)"
          >
            <Settings className="h-4 w-4 text-sky-400" />
            <span>基础算法库 ({algorithms.length})</span>
          </button>

          {/* 打开可视化画布工坊 */}
          <button
            type="button"
            onClick={() => {
              setSelectedCanvasOp(null);
              setViewMode('canvas');
            }}
            className="flex items-center gap-2 rounded-xl border border-cyan-400/50 bg-gradient-to-r from-cyan-500/25 to-sky-500/25 px-4 py-2 text-xs font-bold text-cyan-200 hover:from-cyan-500/35 hover:to-sky-500/35 shadow-lg shadow-cyan-950/40 hover:scale-[1.02] transition"
          >
            <Workflow className="h-4 w-4 text-cyan-300" />
            <span>打开可视化画布工坊</span>
          </button>
        </div>
      </div>

      {/* ═════════════════ 2. 首屏核心内容：立即呈现算子大表 ═════════════════ */}
      <section
        id="op-panel-catalog"
        role="tabpanel"
        aria-labelledby="tab-operators"
        className="rounded-xl border border-slate-800 bg-[#0b111f] shadow-xl overflow-hidden space-y-3.5"
      >
        {/* 筛选与搜索工具条：主筛选为 5 大领域分类！去除重复的下拉框 */}
        <div className="border-b border-slate-800/80 bg-[#0d1424] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* 业务领域筛选 Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {DOMAIN_CATEGORIES.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setDomainFilter(f.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  domainFilter === f.id
                    ? 'bg-sky-500/25 text-sky-200 border border-sky-400/50'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent'
                }`}
              >
                {f.label} · {domainCounts[f.id] ?? 0}
              </button>
            ))}
          </div>

          {/* 搜索输入框（单行保持极简干净） */}
          <div className="relative w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="搜索算子名称 / 标识 / 算法说明..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900/90 pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none transition"
            />
          </div>
        </div>

        {/* 算子列表表格 */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800/80 bg-slate-900/60 text-slate-400 font-semibold text-[11px]">
                <th className="px-4 py-3 w-14 text-center">序号</th>
                <th className="px-4 py-3 w-64">算子 ID / 名称</th>
                <th className="px-4 py-3 w-36">业务领域</th>
                <th className="px-4 py-3 w-36">算法实现方式</th>
                <th className="px-4 py-3 w-24">输出类型</th>
                <th className="px-4 py-3">算法描述与计算公式</th>
                <th className="px-4 py-3 w-28">
                  <button
                    type="button"
                    onClick={() => toggleSort('readiness')}
                    className="inline-flex items-center gap-1 font-semibold text-slate-300 hover:text-white"
                  >
                    <span>就绪门控</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-4 py-3 w-44 text-right pr-4">操作</th>
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
                  return (
                    <tr key={op.id} className="hover:bg-slate-800/30 transition">
                      <td className="px-4 py-3 text-center font-mono text-slate-500 text-[11px]">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-[11px] text-cyan-400/90 font-medium">{op.id}</div>
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
                        {op.customDef?.aggregationConfig?.aggregations?.[0] && (
                          <div className="mt-1 font-mono text-[10px] text-amber-300/80 bg-slate-900/80 rounded px-1.5 py-0.5 inline-block">
                            聚合: {op.customDef.aggregationConfig.aggregations[0].op}({op.customDef.aggregationConfig.aggregations[0].sourceField})
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

        {/* 原生 HTML <dialog> 算子底层数据映射与调用详情弹窗 */}
        <dialog
          ref={detailDialogRef}
          aria-labelledby={detailHeadingId}
          onClose={(e) => {
            e.currentTarget.returnValue = '';
            setDetailOp(null);
          }}
          className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-[#0d1424] p-0 text-slate-100 backdrop:bg-black/60 shadow-2xl"
        >
          {detailOp && (
            <div className="flex max-h-[85vh] flex-col">
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
                <div>
                  <h3 id={detailHeadingId} className="text-sm font-bold text-slate-100">
                    {detailOp.name}
                  </h3>
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
                  {detailOp.f1FieldContract?.csvTables && (
                    <div>
                      <span className="text-slate-400">CSV 来源表：</span>
                      <span className="font-mono text-emerald-300">
                        {detailOp.f1FieldContract.csvTables.join(', ')}
                      </span>
                    </div>
                  )}
                  {detailOp.f1FieldContract?.csvColumns && (
                    <div>
                      <span className="text-slate-400">核心字段列：</span>
                      <span className="font-mono text-slate-200">
                        {detailOp.f1FieldContract.csvColumns.join(', ')}
                      </span>
                    </div>
                  )}
                </div>

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
                    <span>在一体化画布中进行编排计算</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const target = detailOp;
                      detailDialogRef.current?.close();
                      setSelectedCanvasOp(target);
                      setViewMode('canvas');
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2.5 text-xs text-slate-300 hover:text-white hover:bg-slate-700 transition"
                  >
                    <CopyPlus className="h-3.5 w-3.5" />
                    <span>克隆派生</span>
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

      {/* ═════════════════ 3. 基础算法库全景大表弹窗 (Image 1 标准，按需唤起，不挡首屏) ═════════════════ */}
      {algoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
          <div className="w-full max-w-5xl max-h-[85vh] rounded-2xl border border-slate-800 bg-[#0d1424] shadow-2xl flex flex-col overflow-hidden">
            {/* 算法库弹窗顶栏 */}
            <div className="border-b border-slate-800 bg-[#0a0f1d] px-6 py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400">
                  <Calculator className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-100">基础算法库与计算引擎目录</h2>
                    <span className="rounded bg-sky-500/15 border border-sky-500/30 px-2 py-0.5 text-xs text-sky-300 font-semibold">
                      已注册 {algorithms.length} 项算法引擎
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    收录底层原子级算法能力，基于 F1 仿真输出规范字典驱动独立沙箱调试与算子引用追踪，支持注册扩展新算法。
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setNewAlgoModalOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-600/30 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-600/40 transition shadow-sm"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>➕ 注册 / 接入新算法</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAlgoModalOpen(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* 算法表格内容区 */}
            <div className="overflow-y-auto flex-1 p-6">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800/80 bg-slate-900/60 text-slate-400 font-semibold text-[11px]">
                    <th className="px-4 py-3 w-14 text-center">序号</th>
                    <th className="px-4 py-3 w-48">算法名称 / 标识</th>
                    <th className="px-4 py-3 w-28">分类</th>
                    <th className="px-4 py-3 w-44">计算引擎 / 协议</th>
                    <th className="px-4 py-3">算法描述与能力定义</th>
                    <th className="px-4 py-3 w-28 text-center">引用算子</th>
                    <th className="px-4 py-3 w-56 text-right pr-4">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {algorithms.map((algo) => {
                    const IconComp = getAlgoIcon(algo.iconName);
                    const refOps = getAlgoReferencedOps(algo, operators);
                    return (
                      <tr key={algo.id} className="hover:bg-slate-800/30 transition">
                        <td className="px-4 py-3.5 text-center font-mono text-slate-500 font-semibold">
                          {algo.seq}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300">
                              <IconComp className="h-4 w-4 text-cyan-400" />
                            </div>
                            <div>
                              <div className="font-bold text-xs text-slate-100 flex items-center gap-1.5">
                                <span>{algo.name}</span>
                                {algo.isCustom && (
                                  <span className="rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1 text-[9px]">
                                    自定义
                                  </span>
                                )}
                              </div>
                              <div className="font-mono text-[10px] text-slate-500">{algo.id}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-semibold ${algo.badgeBg}`}>
                            {algo.category}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 font-mono text-slate-300 text-[11px]">
                          {algo.engine}
                        </td>
                        <td className="px-4 py-3.5 text-slate-300 text-xs leading-relaxed max-w-md">
                          {algo.description}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              setSandboxAlgo(algo);
                              setSandboxModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-sky-800/60 bg-sky-950/60 px-2 py-0.5 text-[11px] font-semibold text-sky-400 hover:bg-sky-900/60 transition shadow-sm"
                            title="点击查看引用此算法的具体算子清单"
                          >
                            <Layers className="h-3 w-3" />
                            <span>{refOps.length} 个算子</span>
                          </button>
                        </td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap pr-4">
                          <button
                            type="button"
                            onClick={() => {
                              setSandboxAlgo(algo);
                              setSandboxModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/25 transition shadow-sm"
                            title="进入该算法专属的独立沙箱调试环境进行 Dry-Run 试跑"
                          >
                            <Play className="h-3.5 w-3.5 text-sky-400" />
                            <span>独立沙箱调试</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 弹窗底栏 */}
            <div className="border-t border-slate-800 bg-[#0a0f1d] px-6 py-3 flex items-center justify-between text-xs text-slate-400 shrink-0">
              <span>共收录 {algorithms.length} 门核心基础算法，已全量挂接至画布流水线引擎</span>
              <button
                type="button"
                onClick={() => setAlgoModalOpen(false)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-1.5 text-xs text-slate-300 hover:text-white"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════ 4. 注册 / 接入新算法模态弹窗 ═════════════════ */}
      {newAlgoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-[#0d1424] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                  <Plus className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-100">注册 / 接入基础算法引擎</h3>
              </div>
              <button
                type="button"
                onClick={() => setNewAlgoModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">算法名称 *</label>
                  <input
                    type="text"
                    placeholder="例如：空间态势多边形聚类算法"
                    value={newAlgoForm.name}
                    onChange={(e) => setNewAlgoForm({ ...newAlgoForm, name: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-medium mb-1">算法分类</label>
                  <select
                    value={newAlgoForm.category}
                    onChange={(e) => setNewAlgoForm({ ...newAlgoForm, category: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-100 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="行内计算">行内计算 (公式衍生)</option>
                    <option value="跨行聚合">跨行聚合 (分组降维)</option>
                    <option value="数据输入">数据输入 (表提取与过滤)</option>
                    <option value="结果输出">结果输出 (指标映射挂载)</option>
                    <option value="空间态势">空间态势 (几何与轨迹)</option>
                    <option value="脚本扩展">脚本扩展 (Python 模型)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">执行引擎 / 依赖协议</label>
                <input
                  type="text"
                  placeholder="例如：Python 3.12 SciPy / LibFormula 自定义宏 / REST 微服务"
                  value={newAlgoForm.engine}
                  onChange={(e) => setNewAlgoForm({ ...newAlgoForm, engine: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-100 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">算法描述与能力定义</label>
                <textarea
                  rows={3}
                  placeholder="详细描述算法的数学原理、输入输出参数格式、适用战术场景及约束条件..."
                  value={newAlgoForm.description}
                  onChange={(e) => setNewAlgoForm({ ...newAlgoForm, description: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-slate-100 focus:border-sky-500 focus:outline-none leading-relaxed"
                />
              </div>

              <div className="rounded-lg bg-slate-900/80 p-3 border border-slate-800 text-[11px] text-slate-400 space-y-1">
                <div className="text-slate-300 font-semibold">💡 注册生效机制：</div>
                <div>1. 注册后的算法将立即收录至基础算法库目录。</div>
                <div>2. 系统将自动将其装载入【🎨 画布流水线工坊】的左侧构件栏，供拖拽连线。</div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setNewAlgoModalOpen(false)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:text-white"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreateNewAlgorithm}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 transition shadow-md"
              >
                确认注册并发布到算法库
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════ 5. 单项公式与聚合配置弹窗 ═════════════════ */}
      {formulaModalOp && (
        <FormulaOperatorModal
          isOpen={formulaModalOpen}
          onClose={() => {
            setFormulaModalOpen(false);
            setFormulaModalOp(null);
          }}
          initialConfig={formulaModalOp.customDef?.formulaConfig}
          onSave={async (newCfg) => {
            if (formulaModalOp.customDef) {
              const updatedDef: CustomOperatorDefinition = {
                ...formulaModalOp.customDef,
                formulaConfig: newCfg,
                mode: 'formula_pipeline',
              };
              await evalApi.upsertOperator(updatedDef);
              await onRefresh();
            }
          }}
        />
      )}

      {aggModalOp && (
        <AggregationOperatorModal
          isOpen={aggModalOpen}
          onClose={() => {
            setAggModalOpen(false);
            setAggModalOp(null);
          }}
          initialConfig={aggModalOp.customDef?.aggregationConfig}
          onSave={async (newCfg) => {
            if (aggModalOp.customDef) {
              const updatedDef: CustomOperatorDefinition = {
                ...aggModalOp.customDef,
                aggregationConfig: newCfg,
                mode: 'aggregation',
              };
              await evalApi.upsertOperator(updatedDef);
              await onRefresh();
            }
          }}
        />
      )}

      {/* ═════════════════ 5.5 新建自定义算子全功能弹窗 ═════════════════ */}
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

      {/* ═════════════════ 6. 独立算法沙箱工作台 (输出规范字段驱动 · 零推演文件依赖) ═════════════════ */}
      <AlgorithmSandboxModal
        isOpen={sandboxModalOpen}
        algorithm={sandboxAlgo}
        operators={operators}
        catalog={catalog}
        onClose={() => {
          setSandboxModalOpen(false);
          setSandboxAlgo(null);
        }}
        onSelectOperatorForCanvas={(op) => {
          setSandboxModalOpen(false);
          setAlgoModalOpen(false);
          setSelectedCanvasOp(op);
          setViewMode('canvas');
        }}
      />
    </div>
  );
}
