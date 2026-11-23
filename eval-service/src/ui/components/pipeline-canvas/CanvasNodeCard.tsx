import React, { useState } from 'react';
import {
  BarChart3,
  Calculator,
  ChevronRight,
  Code2,
  Compass,
  Database,
  Layers,
  Plus,
  Target,
  Trash2,
  Zap,
} from 'lucide-react';
import type { CanvasNode, PipelineNodeType } from './canvas-types.ts';

interface CanvasNodeCardProps {
  node: CanvasNode;
  isSelected: boolean;
  isConnecting?: boolean;
  onSelect: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onStartConnect: (nodeId: string, e?: React.MouseEvent) => void;
  onEndConnect: (nodeId: string) => void;
  onQuickSpawn: (sourceNodeId: string, targetType: PipelineNodeType) => void;
  onDragStart: (e: React.MouseEvent, nodeId: string) => void;
}

const CATEGORY_META: Record<
  PipelineNodeType,
  {
    name: string;
    badgeBg: string;
    badgeText: string;
    borderColor: string;
    accentColor: string;
    icon: typeof Database;
  }
> = {
  data_input: {
    name: '数据输入',
    badgeBg: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    badgeText: '数据输入',
    borderColor: 'border-blue-500/40 hover:border-blue-400',
    accentColor: 'text-blue-400',
    icon: Database,
  },
  inline_calc: {
    name: '行内计算',
    badgeBg: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    badgeText: '行内计算',
    borderColor: 'border-cyan-500/40 hover:border-cyan-400',
    accentColor: 'text-cyan-400',
    icon: Calculator,
  },
  group_agg: {
    name: '跨行聚合',
    badgeBg: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    badgeText: '跨行聚合',
    borderColor: 'border-amber-500/40 hover:border-amber-400',
    accentColor: 'text-amber-400',
    icon: BarChart3,
  },
  result_output: {
    name: '二维表输出',
    badgeBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    badgeText: '二维表输出',
    borderColor: 'border-emerald-500/40 hover:border-emerald-400',
    accentColor: 'text-emerald-400',
    icon: Target,
  },
  spatial: {
    name: '空间几何',
    badgeBg: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
    badgeText: '空间态势',
    borderColor: 'border-violet-500/40 hover:border-violet-400',
    accentColor: 'text-violet-400',
    icon: Compass,
  },
  python_script: {
    name: 'Python脚本',
    badgeBg: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30',
    badgeText: '脚本扩展',
    borderColor: 'border-fuchsia-500/40 hover:border-fuchsia-400',
    accentColor: 'text-fuchsia-400',
    icon: Code2,
  },
};

export function CanvasNodeCard({
  node,
  isSelected,
  isConnecting = false,
  onSelect,
  onDelete,
  onStartConnect,
  onEndConnect,
  onQuickSpawn,
  onDragStart,
}: CanvasNodeCardProps) {
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const fallbackMeta = {
    name: '通用算子节点',
    badgeBg: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
    badgeText: '算子节点',
    borderColor: 'border-slate-500/40 hover:border-slate-400',
    accentColor: 'text-slate-400',
    icon: Database,
  };
  const meta = CATEGORY_META[node.type] || fallbackMeta;
  const Icon = meta.icon || Database;

  // 提取配置摘要文字
  const getSummaryText = () => {
    switch (node.type) {
      case 'data_input':
        return node.config.csvTable
          ? `规范事件表: ${node.config.csvTable}`
          : '事件输入表';
      case 'inline_calc': {
        const count = node.config.derivedColumns?.length ?? 0;
        return count > 0
          ? `${count} 个公式衍生列 (LibFormula)`
          : '暂无衍生列，点击右侧配置';
      }
      case 'group_agg': {
        const keyCount = node.config.groupKeys?.length ?? 0;
        const aggCount = node.config.aggregations?.length ?? 0;
        return keyCount > 0
          ? `按 ${keyCount} 主键分组 · ${aggCount} 项聚合度量`
          : '全表标量归约 (N ➔ 1)';
      }
      case 'result_output':
        return node.config.targetField
          ? `输出二维表 · 主列: ${node.config.targetField}`
          : '输出结构化二维事实表 (TableDataset)';
      case 'spatial':
        return node.config.spatialRule === 'threat_distance'
          ? '空间威胁几何测距'
          : '任务走廊空间安全裕度判定';
      case 'python_script':
        return 'Python 外部科学计算扩展';
      default:
        return '算子数据节点';
    }
  };

  const runtime = node.runtime;
  const statusColor =
    runtime?.status === 'success'
      ? 'bg-emerald-400 ring-emerald-500/30'
      : runtime?.status === 'error'
      ? 'bg-rose-500 ring-rose-500/30'
      : runtime?.status === 'running'
      ? 'bg-sky-400 animate-pulse ring-sky-500/30'
      : 'bg-slate-400 ring-slate-500/20';

  return (
    <div
      style={{
        transform: `translate(${node.x}px, ${node.y}px)`,
        width: `${node.width || 280}px`,
        height: `${node.height || 124}px`,
      }}
      className={`group absolute select-none cursor-grab active:cursor-grabbing rounded-xl border bg-[#0b1120]/95 backdrop-blur-md shadow-2xl transition-shadow flex flex-col justify-between ${
        isSelected
          ? `ring-2 ring-sky-400 border-sky-400 shadow-sky-950/60 shadow-2xl`
          : `${meta.borderColor} shadow-black/60`
      }`}
      onMouseDown={(e) => onDragStart(e, node.id)}
      onMouseUp={() => {
        // 当从上游拖出连线并在本卡片上松开时，自动连接此节点
        onEndConnect(node.id);
      }}
    >
      {/* ─── 左侧输入端口 (非输入节点拥有，平时隐藏，hover或连线时显现) ─── */}
      {node.type !== 'data_input' && (
        <div
          title="输入端口：拖入连线"
          className={`group/port absolute -left-3 top-1/2 -translate-y-1/2 cursor-crosshair p-1 z-10 transition-opacity duration-150 ${
            isConnecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          onMouseUp={(e) => {
            e.stopPropagation();
            onEndConnect(node.id);
          }}
        >
          <div className="h-4 w-4 rounded-full border-2 border-slate-700 bg-[#0b1120] transition group-hover/port:scale-125 group-hover/port:border-sky-400 group-hover/port:bg-sky-500 shadow-md flex items-center justify-center">
            <div className="h-1.5 w-1.5 rounded-full bg-slate-400 group-hover/port:bg-white" />
          </div>
        </div>
      )}

      {/* ─── 卡片头部 ─── */}
      <div className="flex h-[38px] shrink-0 items-center justify-between border-b border-slate-800/80 px-3 bg-slate-900/40 rounded-t-xl">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`p-1 rounded-md bg-slate-800/80 shrink-0 ${meta.accentColor}`}>
            <Icon className="h-4 w-4" />
          </div>
          <span className="font-semibold text-xs tracking-wide text-slate-100 truncate max-w-[130px]">
            {node.title}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-1">
          <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${meta.badgeBg}`}>
            {meta.badgeText}
          </span>
          <button
            type="button"
            title="删除节点"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(node.id);
            }}
            className="rounded p-1 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400 transition"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* ─── 卡片内容区 ─── */}
      <div className="p-2.5 flex-1 flex flex-col justify-between overflow-hidden">
        <div className="text-[11px] text-slate-300 leading-snug line-clamp-2">
          {getSummaryText()}
        </div>

        {/* 吞吐与运行状态 Bar */}
        <div className="flex items-center justify-between rounded-lg bg-slate-950/60 border border-slate-800/60 px-2.5 py-1 text-[10px] shrink-0">
          <div className="flex items-center gap-1.5 text-slate-400">
            <span className={`inline-block h-2 w-2 rounded-full ring-2 ${statusColor}`} />
            <span className="truncate">
              {runtime?.status === 'error'
                ? (runtime?.errorMessage ? `异常: ${runtime.errorMessage}` : '计算异常')
                : runtime?.rowCount !== undefined
                ? `${runtime.rowCount} 行`
                : '待执行'}
            </span>
            {runtime?.status !== 'error' && runtime?.columnCount !== undefined && (
              <span className="text-slate-500 shrink-0">· {runtime.columnCount} 列</span>
            )}
          </div>

          {runtime?.latencyMs !== undefined && (
            <div className="flex items-center gap-1 text-slate-500 font-mono">
              <Zap className="h-2.5 w-2.5 text-amber-400" />
              <span>{runtime.latencyMs.toFixed(1)}ms</span>
            </div>
          )}
        </div>
      </div>

      {/* ─── 右侧输出端口 (非输出节点拥有，平时隐藏，hover或连线时显现) ─── */}
      {node.type !== 'result_output' && (
        <div
          title="输出端口：拖拽以此节点为上游进行连线"
          className={`group/port absolute -right-3 top-1/2 -translate-y-1/2 cursor-crosshair p-1 z-10 transition-opacity duration-150 ${
            isConnecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          onMouseDown={(e) => {
            e.stopPropagation();
            onStartConnect(node.id, e);
          }}
        >
          <div className="h-4 w-4 rounded-full border-2 border-slate-700 bg-[#0b1120] transition group-hover/port:scale-125 group-hover/port:border-sky-400 group-hover/port:bg-sky-500 shadow-md flex items-center justify-center">
            <div className="h-1.5 w-1.5 rounded-full bg-sky-400 group-hover/port:bg-white" />
          </div>
        </div>
      )}

      {/* ─── 顺向快速衍生 (+) 按钮 (平时隐藏，hover时显现) ─── */}
      {node.type !== 'result_output' && (
        <div
          className={`absolute -right-3 -bottom-3 z-20 transition-opacity duration-150 ${
            quickMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseEnter={() => setQuickMenuOpen(true)}
          onMouseLeave={() => setQuickMenuOpen(false)}
        >
          <button
            type="button"
            title="快速衍生下游节点"
            onClick={(e) => {
              e.stopPropagation();
              setQuickMenuOpen(!quickMenuOpen);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-sky-400/50 bg-sky-600 text-white shadow-lg hover:scale-110 hover:bg-sky-500 transition"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>

          {/* 浮动菜单 */}
          {quickMenuOpen && (
            <div className="absolute left-7 top-0 w-36 rounded-xl border border-slate-700 bg-[#0f172a] p-1.5 shadow-2xl space-y-1 text-xs">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickSpawn(node.id, 'inline_calc');
                  setQuickMenuOpen(false);
                }}
                className="w-full flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-cyan-300 hover:bg-cyan-500/20 transition"
              >
                <Calculator className="h-3.5 w-3.5" />
                <span>+ 公式计算</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickSpawn(node.id, 'group_agg');
                  setQuickMenuOpen(false);
                }}
                className="w-full flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-amber-300 hover:bg-amber-500/20 transition"
              >
                <BarChart3 className="h-3.5 w-3.5" />
                <span>+ 跨行汇总</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickSpawn(node.id, 'result_output');
                  setQuickMenuOpen(false);
                }}
                className="w-full flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-emerald-300 hover:bg-emerald-500/20 transition"
              >
                <Target className="h-3.5 w-3.5" />
                <span>+ 二维表输出</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
