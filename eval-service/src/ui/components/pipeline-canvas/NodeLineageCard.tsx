import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Layers,
  Network,
  Share2,
} from 'lucide-react';
import type { NodeLineageReport } from './lineage-analyzer.ts';
import type { PipelineNodeType } from './canvas-types.ts';

interface NodeLineageCardProps {
  report: NodeLineageReport;
  nodeTitle: string;
  nodeType: PipelineNodeType;
}

export function NodeLineageCard({ report, nodeTitle, nodeType }: NodeLineageCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<'inputs' | 'outputs'>('outputs');

  return (
    <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] overflow-hidden shadow-lg transition">
      {/* 头部标题与统计总览 */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between p-3 bg-slate-900/60 hover:bg-slate-800/50 transition text-left"
      >
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-emerald-400" />
          <span className="font-bold text-xs text-slate-200 tracking-wide">
            节点输入与输出字段
          </span>
          <span className="rounded bg-emerald-950 border border-emerald-800/80 px-1.5 py-0.2 text-[10px] text-emerald-300 font-mono">
            直接上游 ➔ 本节点产出
          </span>
        </div>
        <div className="text-slate-400">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>

      {isExpanded && (
        <div className="p-3 border-t border-slate-800/80 space-y-3">
          {/* 状态徽章总览条 */}
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg bg-slate-900/90 border border-slate-800 p-2 space-y-0.5">
              <div className="text-slate-400 text-[10px] flex items-center justify-between">
                <span>直接上游输入字段</span>
                <span className="font-mono text-cyan-300 font-bold">
                  {report.totalInputCount > 0 ? `${report.consumedInputCount} / ${report.totalInputCount}` : '根节点输入'}
                </span>
              </div>
              <div className="text-slate-200 font-semibold truncate">
                {report.totalInputCount > 0
                  ? `${report.consumedInputCount} 列参与计算 · 共 ${report.totalInputCount} 列上游输入`
                  : '事件表直接输入'}
              </div>
            </div>

            <div className="rounded-lg bg-slate-900/90 border border-slate-800 p-2 space-y-0.5">
              <div className="text-slate-400 text-[10px] flex items-center justify-between">
                <span>本节点产出字段</span>
                <span className="font-mono text-emerald-400 font-bold">
                  {report.consumedOutputCount} / {report.totalOutputCount} 列
                </span>
              </div>
              <div className="text-slate-200 font-semibold truncate">
                {report.downstreamBranchesCount > 0
                  ? `产出 ${report.totalOutputCount} 列 · 连通 ${report.downstreamBranchesCount} 个下游`
                  : `产出 ${report.totalOutputCount} 列 · 终点输出`}
              </div>
            </div>
          </div>

          {/* 切换 Tab */}
          <div className="flex border-b border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('inputs')}
              className={`flex-1 py-1.5 text-center font-medium border-b-2 transition ${
                activeTab === 'inputs'
                  ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              直接上游输入 ({report.totalInputCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('outputs')}
              className={`flex-1 py-1.5 text-center font-medium border-b-2 transition ${
                activeTab === 'outputs'
                  ? 'border-emerald-400 text-emerald-300 bg-emerald-950/20'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              本节点产出 ({report.totalOutputCount})
            </button>
          </div>

          {/* 选项卡内容 1: 输入端 */}
          {activeTab === 'inputs' && (
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {report.inputPorts.length === 0 ? (
                <div className="py-4 text-center text-slate-500 text-xs">
                  {nodeType === 'data_input'
                    ? '此节点为表输入根节点，直接从仿真事件底表抽取数据，无画布上游依赖。'
                    : '当前节点尚未连接任何上游节点输入。请在画布中拖拽连线。'}
                </div>
              ) : (
                report.inputPorts.map((inPort) => (
                  <div
                    key={inPort.name}
                    className="flex items-center justify-between rounded-lg bg-slate-900/60 border border-slate-800/80 px-2.5 py-1.5 text-xs hover:border-slate-700 transition"
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <div className="flex items-center gap-1.5 font-mono">
                        <span className="font-semibold text-slate-200">{inPort.name}</span>
                        {inPort.sourceNodeTitle && (
                          <span className="text-[10px] text-slate-500 truncate max-w-[130px]">
                            ({inPort.sourceNodeTitle})
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 truncate">
                        {inPort.usageReason}
                      </span>
                    </div>

                    <div className="shrink-0">
                      {inPort.isConsumedByThisNode ? (
                        <span className="inline-flex items-center gap-1 rounded bg-cyan-950 border border-cyan-800 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300">
                          <CheckCircle2 className="h-3 w-3 text-cyan-400" />
                          <span>本节点参与计算</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">
                          <span>上游字段</span>
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 选项卡内容 2: 输出端与多下游消费 */}
          {activeTab === 'outputs' && (
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {report.outputPorts.length === 0 ? (
                <div className="py-4 text-center text-slate-500 text-xs">
                  暂无对外输出字段，请检查算子配置或试算执行。
                </div>
              ) : (
                report.outputPorts.map((outPort) => (
                  <div
                    key={outPort.name}
                    className={`flex flex-col gap-1 rounded-lg border p-2 text-xs transition ${
                      outPort.isConsumedDownstream
                        ? 'bg-slate-900/70 border-emerald-900/40 hover:border-emerald-700/60'
                        : 'bg-slate-900/40 border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-mono">
                        {outPort.name}
                      </div>

                      <div>
                        {outPort.isConsumedDownstream ? (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-950 border border-emerald-800 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                            <Share2 className="h-3 w-3 text-emerald-400" />
                            <span>下游已消费 ({outPort.consumers.length} 分支)</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500">
                            <span>⚪ 未被下游消费</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 下游消费者展开清单 */}
                    {outPort.isConsumedDownstream ? (
                      <div className="flex flex-wrap gap-1 mt-0.5 pl-2 border-l border-emerald-800/40">
                        {outPort.consumers.map((c, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded bg-emerald-950/50 border border-emerald-800/60 px-1.5 py-0.2 text-[10px] text-emerald-200 font-mono"
                          >
                            <ArrowDownRight className="h-2.5 w-2.5 text-emerald-400" />
                            <strong className="text-slate-300">{c.nodeTitle}</strong>
                            <span className="text-slate-400">({c.reason})</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-500 pl-2">
                        下游节点当前均未消费此字段。若为末梢指标列可直接用于前端展示。
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
