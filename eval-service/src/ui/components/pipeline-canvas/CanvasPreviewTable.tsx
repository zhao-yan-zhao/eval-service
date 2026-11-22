import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Database,
  Download,
  Eye,
  Maximize2,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { CanvasNode } from './canvas-types.ts';
import type { TableDataset } from '../../../core/types.ts';

interface CanvasPreviewTableProps {
  selectedNode?: CanvasNode | null;
  dataset?: TableDataset | null;
  diffCols?: string[];
  latencyMs?: number;
  isExecuting?: boolean;
  defaultCollapsed?: boolean;
}

export function CanvasPreviewTable({
  selectedNode,
  dataset,
  diffCols = [],
  latencyMs,
  isExecuting = false,
  defaultCollapsed = true,
}: CanvasPreviewTableProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const diffColSet = new Set(diffCols);

  const columns = dataset?.columns?.length ? dataset.columns : (dataset?.schema || []);
  const rows = dataset?.rows || [];

  return (
    <div
      className={`border-t border-slate-800 bg-[#090d16] flex flex-col transition-all duration-200 ${
        isCollapsed ? 'h-10' : 'h-64'
      }`}
    >
      {/* ─── 预览区头部控制条 ─── */}
      <div
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="flex h-10 items-center justify-between border-b border-slate-800/80 px-4 bg-[#0d1424] cursor-pointer select-none hover:bg-[#11192e] transition"
      >
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-slate-200">
            <Eye className="h-3.5 w-3.5 text-sky-400" />
            <span>节点输出切片预览</span>
          </div>

          {selectedNode ? (
            <div className="flex items-center gap-2">
              <span className="text-slate-500">|</span>
              <span className="text-slate-300 font-medium">{selectedNode.title}</span>
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                {selectedNode.type}
              </span>
            </div>
          ) : (
            <span className="text-slate-500 text-[11px]">(未选中节点，展示末端输出)</span>
          )}

          {dataset && (
            <div className="hidden md:flex items-center gap-2 text-[11px] text-slate-400">
              <span className="text-slate-600">·</span>
              {(dataset as any)?.isRealData ? (
                <span
                  className="flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-emerald-300 text-[10px] font-semibold"
                  title={`数据源自推演场景: ${(dataset as any).scenarioName || (dataset as any).sourceRunId}`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>实测场景: {(dataset as any).scenarioName || (dataset as any).sourceRunId || '已绑定场景'}</span>
                </span>
              ) : (
                <span
                  className="rounded bg-slate-800/80 border border-slate-700/80 px-1.5 py-0.5 text-slate-400 text-[10px]"
                  title="当前采用规范预设样本作为底座"
                >
                  预设样本
                </span>
              )}
              <span className="text-slate-600">·</span>
              <span>样本切片: <strong className="text-slate-200">{rows.length}</strong> 行</span>
              <span className="text-slate-600">·</span>
              <span>总列数: <strong className="text-slate-200">{columns.length}</strong> 列</span>
              {diffCols.length > 0 && (
                <span className="flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-400 border border-emerald-500/20 font-medium">
                  <Sparkles className="h-3 w-3" />
                  新增/衍生列: {diffCols.length} 个
                </span>
              )}
            </div>
          )}

          {latencyMs !== undefined && (
            <div className="hidden lg:flex items-center gap-1 text-[11px] text-amber-400 font-mono">
              <Zap className="h-3 w-3" />
              <span>{latencyMs.toFixed(1)}ms</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isExecuting && (
            <span className="flex items-center gap-1.5 text-xs text-sky-400 animate-pulse">
              <span className="h-2 w-2 rounded-full bg-sky-400" />
              正在试算数据流...
            </span>
          )}

          {isCollapsed && (
            <span className="hidden sm:inline-block text-[11px] text-slate-500 mr-1">
              点击展开明细
            </span>
          )}

          <button
            type="button"
            title={isCollapsed ? '展开预览面板' : '折叠预览面板'}
            onClick={(e) => {
              e.stopPropagation();
              setIsCollapsed(!isCollapsed);
            }}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition"
          >
            {isCollapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* ─── 表格内容区 ─── */}
      {!isCollapsed && (
        <div className="flex-1 overflow-auto bg-[#070b12] text-xs">
          {rows.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-slate-500 space-y-2 py-8">
              <Database className="h-8 w-8 text-slate-700" />
              <p>暂无输出数据切片。请确保上游节点已连接并配置，或点击顶部 [▶ 全链路试运行] 触发数据流推演。</p>
            </div>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-[#0f172a] shadow-sm">
                <tr className="border-b border-slate-800 text-[11px] font-semibold tracking-wider text-slate-400">
                  <th className="px-3 py-2 w-12 text-center text-slate-600">#</th>
                  {columns.map((col) => {
                    const isDiff = diffColSet.has(col.name);
                    return (
                      <th
                        key={col.name}
                        className={`px-3 py-2 whitespace-nowrap ${
                          isDiff
                            ? 'bg-emerald-950/40 text-emerald-300 border-b-2 border-emerald-500'
                            : 'text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span>{col.displayName || col.name}</span>
                          <span className="rounded bg-slate-800/80 px-1 py-0.2 text-[9px] text-slate-400 font-mono">
                            {col.type}
                          </span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50 font-mono text-[11px]">
                {rows.slice(0, 50).map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/40 transition">
                    <td className="px-3 py-1.5 text-center text-slate-600 select-none">
                      {idx + 1}
                    </td>
                    {columns.map((col) => {
                      const val = row[col.name];
                      const isDiff = diffColSet.has(col.name);
                      return (
                        <td
                          key={col.name}
                          className={`px-3 py-1.5 whitespace-nowrap truncate max-w-[240px] ${
                            isDiff
                              ? 'bg-emerald-950/20 text-emerald-300 font-semibold'
                              : 'text-slate-300'
                          }`}
                        >
                          {val === null || val === undefined ? (
                            <span className="text-slate-600 italic">null</span>
                          ) : typeof val === 'number' ? (
                            Number.isFinite(val) ? (
                              Number.isInteger(val) ? (
                                val.toLocaleString()
                              ) : (
                                Number(val.toFixed(4)).toString()
                              )
                            ) : (
                              String(val)
                            )
                          ) : (
                            String(val)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
