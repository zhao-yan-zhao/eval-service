import React from 'react';
import {
  BarChart3,
  Calculator,
  ChevronRight,
  Database,
  ExternalLink,
  Layers,
  Sparkles,
  Target,
  Workflow,
} from 'lucide-react';

interface AlgorithmOperatorsTableProps {
  onOpenFormulaModal: () => void;
  onOpenAggregationModal: () => void;
  onOpenCanvas: (focusNodeType?: 'data_input' | 'inline_calc' | 'group_agg' | 'result_output') => void;
}

export function AlgorithmOperatorsTable({
  onOpenFormulaModal,
  onOpenAggregationModal,
  onOpenCanvas,
}: AlgorithmOperatorsTableProps) {
  const algorithms = [
    {
      seq: 1,
      id: 'data_input',
      name: '表输入',
      category: '数据输入',
      categoryBadge: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
      description: '查询一个数据库表 / 提取仿真事件日志 (CSV / 态势帧 JSONL)',
      icon: Database,
      primaryAction: {
        label: '在画布中编排',
        action: () => onOpenCanvas('data_input'),
      },
    },
    {
      seq: 2,
      id: 'inline_calc',
      name: '公式',
      category: '行内计算',
      categoryBadge: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
      description: '使用LibFormula计算公式。支持行内四则运算、函数嵌套 (LibFormula 语法) 及多字段逻辑处理，生成衍生列。',
      icon: Calculator,
      primaryAction: {
        label: '打开公式计算 (图二)',
        action: onOpenFormulaModal,
      },
    },
    {
      seq: 3,
      id: 'group_agg',
      name: '数据汇总',
      category: '跨行聚合',
      categoryBadge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      description: '按指定字段分组聚合统计，支持求和、均值、极值、计数等聚合计算。将多行明细样本聚合为 1 行标量指标 (N ➔ 1)。',
      icon: BarChart3,
      primaryAction: {
        label: '打开数据汇总 (图三)',
        action: onOpenAggregationModal,
      },
    },
    {
      seq: 4,
      id: 'result_output',
      name: '结果处理',
      category: '结果输出',
      categoryBadge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      description: '结果处理与指标收口。将计算结果自动绑定至二库（指标配置）与三库（评估体系树）。',
      icon: Target,
      primaryAction: {
        label: '在画布中收口',
        action: () => onOpenCanvas('result_output'),
      },
    },
  ];

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#090e18] shadow-2xl overflow-hidden">
      {/* 头部标题与导引 */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-800/80 bg-[#0d1424] px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-100">核心算法算子体系 (Image 1 标准规范)</h2>
            <span className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-400 font-medium">
              标准 4 大计算底座
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            涵盖数据输入、行内公式衍生计算、跨行分组汇总与结果输出，所有复杂业务指标均由此 4 类基础算子流水线编排而成。
          </p>
        </div>

        <button
          type="button"
          onClick={() => onOpenCanvas()}
          className="flex items-center gap-1.5 rounded-xl border border-cyan-400/50 bg-gradient-to-r from-cyan-500/20 to-sky-500/20 px-3.5 py-2 text-xs font-bold text-cyan-200 hover:from-cyan-500/30 hover:to-sky-500/30 shadow-lg shadow-cyan-950/40 transition"
        >
          <Workflow className="h-4 w-4 text-cyan-300" />
          <span>在一体化画布中编排此 4 类算子 ➔</span>
        </button>
      </div>

      {/* 核心算子表格 (严格还原 Image 1) */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-800/80 bg-[#0b111f] text-slate-400 font-semibold text-[11px] uppercase tracking-wider">
              <th className="px-5 py-3.5 w-16 text-center">序号</th>
              <th className="px-5 py-3.5 w-48">算法名称</th>
              <th className="px-5 py-3.5 w-36">分类</th>
              <th className="px-5 py-3.5">算法描述</th>
              <th className="px-5 py-3.5 w-64 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50 font-sans">
            {algorithms.map((algo) => (
              <tr key={algo.id} className="hover:bg-slate-800/30 transition group">
                <td className="px-5 py-4 text-center font-mono text-slate-400 font-medium">
                  {algo.seq}
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-slate-800/80 text-slate-300 border border-slate-700/60">
                      <algo.icon className="h-4 w-4" />
                    </div>
                    <span className="font-bold text-sm text-slate-100">{algo.name}</span>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <span className={`inline-block rounded-md border px-2.5 py-1 text-xs font-semibold ${algo.categoryBadge}`}>
                    {algo.category}
                  </span>
                </td>
                <td className="px-5 py-4 text-slate-300 text-xs leading-relaxed max-w-xl">
                  {algo.description}
                </td>
                <td className="px-5 py-4 text-right space-x-2">
                  <button
                    type="button"
                    onClick={algo.primaryAction.action}
                    className="inline-flex items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/15 px-2.5 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/25 transition shadow-sm"
                  >
                    <span>{algo.primaryAction.label}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenCanvas(algo.id as any)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:text-slate-100 transition"
                  >
                    <Workflow className="h-3.5 w-3.5 text-slate-400" />
                    <span>画布</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
