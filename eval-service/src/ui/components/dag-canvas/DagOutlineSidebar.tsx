import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  Layers,
  LocateFixed,
  Scale,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import type { DagGraphKind } from '../../../core/types.ts';
import {
  computeDagTopologicalInfo,
  computeIncomingWeightSummary,
  type DagCanvasEdge,
  type DagCanvasNode,
  type DagNodeStatus,
} from './types.ts';

export interface DagOutlineSidebarProps {
  nodes: DagCanvasNode[];
  edges: DagCanvasEdge[];
  graphKind: DagGraphKind;
  selectedNodeId?: string | null;
  hiddenNodeIds?: Set<string>;
  side?: 'left' | 'right';
  readOnly?: boolean;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge?: (edgeId: string | null) => void;
  onUpdateEdgeWeight?: (edgeId: string, weight: number) => void;
  onClose?: () => void;
}

type OutlineGroupMode = 'depth' | 'kind';

const STATUS_DOT: Record<DagNodeStatus, string> = {
  idle: 'bg-slate-500',
  running: 'bg-sky-400 animate-pulse',
  valid: 'bg-emerald-400',
  degraded: 'bg-amber-400',
  unavailable: 'bg-amber-400 ring-2 ring-rose-500/40',
  violated: 'bg-rose-500 animate-pulse',
};

function formatNodeMetricReadout(node: DagCanvasNode, graphKind: DagGraphKind): string {
  if (node.status === 'unavailable') return '缺数';
  const s = node.summary;
  if (graphKind === 'operator') {
    if (s?.rowCount !== undefined) {
      return `${s.rowCount}×${s.columnCount ?? 0}`;
    }
    return '待算';
  }
  if (graphKind === 'metric') {
    if (s?.displayValue !== undefined) {
      return `${s.displayValue}${s.unit ? ` ${s.unit}` : ''}`;
    }
    if (typeof s?.value === 'number') {
      const formatted = Number.isInteger(s.value) ? String(s.value) : s.value.toFixed(2);
      return `${formatted}${s.unit ? ` ${s.unit}` : ''}`;
    }
    if (typeof s?.value === 'boolean') return s.value ? 'TRUE' : 'FALSE';
    return '--';
  }
  // system
  if (s?.role === 'gate' || node.kind === 'gate' || s?.gateStatus !== undefined) {
    if (s?.gateStatus === 'violated' || node.status === 'violated') {
      return s?.gateMode === 'hard' ? 'DISQUALIFIED' : 'WARNING';
    }
    return 'PASS';
  }
  if (typeof s?.score === 'number' && Number.isFinite(s.score)) {
    return `${s.score.toFixed(1)} 分`;
  }
  if (typeof s?.rawValue === 'number' && Number.isFinite(s.rawValue)) {
    return s.rawValue.toFixed(2);
  }
  return '--';
}

export function DagOutlineSidebar({
  nodes,
  edges,
  graphKind,
  selectedNodeId,
  hiddenNodeIds,
  side = 'right',
  readOnly = false,
  onSelectNode,
  onSelectEdge,
  onUpdateEdgeWeight,
  onClose,
}: DagOutlineSidebarProps) {
  const [groupMode, setGroupMode] = useState<OutlineGroupMode>('depth');
  const [searchText, setSearchText] = useState('');
  const [draftWeights, setDraftWeights] = useState<Record<string, string>>({});

  const realEdges = useMemo(
    () => edges.filter((e) => !e.isVirtualCollapsed),
    [edges],
  );

  const { order: topoOrder, depthMap } = useMemo(
    () => computeDagTopologicalInfo(nodes, realEdges),
    [nodes, realEdges],
  );

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const statusCounts = useMemo(() => {
    let valid = 0;
    let degraded = 0;
    let issue = 0;
    for (const n of nodes) {
      if (n.status === 'valid') valid++;
      else if (n.status === 'degraded') degraded++;
      else if (n.status === 'unavailable' || n.status === 'violated') issue++;
    }
    return { valid, degraded, issue };
  }, [nodes]);

  const filteredOrderedNodes = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const ordered = topoOrder
      .map((id) => nodeMap.get(id))
      .filter((n): n is DagCanvasNode => Boolean(n));
    if (!q) return ordered;
    return ordered.filter(
      (n) =>
        n.label.toLowerCase().includes(q) ||
        n.id.toLowerCase().includes(q) ||
        n.kind.toLowerCase().includes(q) ||
        (n.groupId && n.groupId.toLowerCase().includes(q)),
    );
  }, [topoOrder, nodeMap, searchText]);

  const groupedSections = useMemo(() => {
    const groups = new Map<string, { key: string; title: string; items: DagCanvasNode[] }>();

    for (const node of filteredOrderedNodes) {
      let groupKey = '';
      let groupTitle = '';
      if (groupMode === 'depth') {
        const d = typeof node.depth === 'number' ? node.depth : (depthMap.get(node.id) ?? 0);
        groupKey = `L${d}`;
        groupTitle = d === 0 ? `L0 · 源节点层` : `L${d} · 第 ${d} 拓扑层`;
      } else {
        const k = node.summary?.role || node.summary?.militaryLevel || node.kind || 'node';
        groupKey = k;
        groupTitle = `类型 · ${k}`;
      }

      const existing = groups.get(groupKey);
      if (existing) {
        existing.items.push(node);
      } else {
        groups.set(groupKey, { key: groupKey, title: groupTitle, items: [node] });
      }
    }

    const arr = Array.from(groups.values());
    if (groupMode === 'depth') {
      arr.sort((a, b) => Number(a.key.slice(1)) - Number(b.key.slice(1)));
    }
    return arr;
  }, [filteredOrderedNodes, groupMode, depthMap]);

  // 三库 system 模式：入边权重矩阵（所有存在入边的目标效果节点）
  const systemWeightTargets = useMemo(() => {
    if (graphKind !== 'system') return [];
    const targets: Array<{
      targetNode: DagCanvasNode;
      incomingEdges: DagCanvasEdge[];
      summary: ReturnType<typeof computeIncomingWeightSummary>;
    }> = [];

    for (const id of topoOrder) {
      const targetNode = nodeMap.get(id);
      if (!targetNode) continue;
      const incomingEdges = realEdges.filter((e) => e.targetNodeId === id);
      if (incomingEdges.length === 0) continue;
      targets.push({
        targetNode,
        incomingEdges,
        summary: computeIncomingWeightSummary(id, realEdges),
      });
    }
    return targets;
  }, [graphKind, topoOrder, nodeMap, realEdges]);

  const handleNormalizeTargetWeights = (targetId: string, incomingEdges: DagCanvasEdge[]) => {
    if (readOnly || !onUpdateEdgeWeight || incomingEdges.length === 0) return;
    const rawTotal = incomingEdges.reduce(
      (acc, e) => acc + (typeof e.weight === 'number' && e.weight > 0 ? e.weight : 0),
      0,
    );
    let running = 0;
    incomingEdges.forEach((edge, idx) => {
      let nextW: number;
      if (idx === incomingEdges.length - 1) {
        nextW = Math.round(Math.max(0, 1 - running) * 10000) / 10000;
      } else {
        const share =
          rawTotal > 0
            ? (typeof edge.weight === 'number' && edge.weight > 0 ? edge.weight : 0) / rawTotal
            : 1 / incomingEdges.length;
        nextW = Math.round(share * 10000) / 10000;
        running += nextW;
      }
      onUpdateEdgeWeight(edge.id, nextW);
    });
    setDraftWeights((prev) => {
      const next = { ...prev };
      for (const e of incomingEdges) delete next[e.id];
      return next;
    });
  };

  return (
    <aside
      className={`flex h-full w-80 shrink-0 flex-col bg-[#0d1117] text-slate-200 z-20 ${
        side === 'left' ? 'border-r border-[#30363d]' : 'border-l border-[#30363d]'
      }`}
    >
      {/* 头部标题与关闭按钮 */}
      <div className="flex items-center justify-between border-b border-[#30363d] bg-[#161b22] px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          {graphKind === 'system' ? (
            <Scale className="h-4 w-4 text-indigo-400 shrink-0" />
          ) : (
            <Layers className="h-4 w-4 text-cyan-400 shrink-0" />
          )}
          <span className="truncate text-xs font-semibold text-slate-100">
            {graphKind === 'system' ? '拓扑大纲与局部权重矩阵' : 'DAG 拓扑大纲'}
          </span>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="收起大纲面板"
            className="rounded p-1 text-slate-400 transition hover:bg-[#30363d]/60 hover:text-white cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* 状态摘要与分组切换 */}
      <div className="space-y-2 border-b border-[#30363d] bg-[#0d1117] px-3 py-2">
        <div className="flex items-center justify-between gap-2 text-[10px]">
          <div className="flex items-center gap-2 font-mono">
            <span className="text-slate-400">节点 {nodes.length}</span>
            <span className="text-emerald-300">正常 {statusCounts.valid}</span>
            {statusCounts.degraded > 0 && (
              <span className="text-amber-300">降级 {statusCounts.degraded}</span>
            )}
            {statusCounts.issue > 0 && (
              <span className="text-rose-300">异常 {statusCounts.issue}</span>
            )}
          </div>
          <div className="flex rounded-md border border-[#30363d] bg-[#161b22] p-0.5 text-[10px]">
            <button
              type="button"
              onClick={() => setGroupMode('depth')}
              className={`rounded px-1.5 py-0.5 transition cursor-pointer ${
                groupMode === 'depth'
                  ? 'bg-[#30363d] text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              拓扑层级
            </button>
            <button
              type="button"
              onClick={() => setGroupMode('kind')}
              className={`rounded px-1.5 py-0.5 transition cursor-pointer ${
                groupMode === 'kind'
                  ? 'bg-[#30363d] text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              节点类型
            </button>
          </div>
        </div>

        {/* 搜索过滤框 */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="检索节点名称、类型或分组..."
            className="w-full rounded-md border border-[#30363d] bg-[#161b22] py-1 pl-8 pr-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
          />
        </div>
      </div>

      {/* 主体滚动区：大纲列表 + system 模式内联权重矩阵 */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#30363d]/70">
        {/* 1. 分组节点列表 */}
        <div className="p-2.5 space-y-2.5">
          {groupedSections.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">未匹配到符合条件的节点</div>
          ) : (
            groupedSections.map((section) => (
              <div key={section.key} className="space-y-1">
                <div className="flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <span>{section.title}</span>
                  <span className="font-mono text-slate-500">{section.items.length}</span>
                </div>

                <div className="space-y-1">
                  {section.items.map((node) => {
                    const isSelected = selectedNodeId === node.id;
                    const isCollapsedChild = hiddenNodeIds?.has(node.id);
                    const readout = formatNodeMetricReadout(node, graphKind);
                    const weightSummary =
                      graphKind === 'system'
                        ? computeIncomingWeightSummary(node.id, realEdges)
                        : null;

                    return (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => onSelectNode(node.id)}
                        className={`w-full flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition cursor-pointer ${
                          isSelected
                            ? 'border-cyan-500/70 bg-cyan-950/35 text-white shadow-sm'
                            : 'border-[#30363d]/60 bg-[#161b22]/75 text-slate-300 hover:border-[#30363d] hover:bg-[#161b22]'
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${
                              STATUS_DOT[node.status] ?? STATUS_DOT.idle
                            }`}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <span className="truncate text-xs font-medium">{node.label}</span>
                              {isCollapsedChild && (
                                <span className="shrink-0 rounded bg-amber-500/15 px-1 font-mono text-[9px] text-amber-300">
                                  已折叠
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
                              <span className="truncate max-w-[110px]">
                                {node.summary?.militaryLevel || node.summary?.role || node.kind}
                              </span>
                              {weightSummary && weightSummary.incomingCount > 0 && (
                                <span
                                  className={
                                    weightSummary.isBalanced ? 'text-emerald-400' : 'text-amber-300'
                                  }
                                >
                                  Σw={weightSummary.sum.toFixed(2)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          <span
                            className={`font-mono text-[11px] font-semibold tabular-nums ${
                              node.status === 'violated'
                                ? 'text-rose-300'
                                : node.status === 'unavailable'
                                  ? 'text-amber-300'
                                  : node.status === 'valid'
                                    ? 'text-emerald-300'
                                    : 'text-slate-300'
                            }`}
                          >
                            {readout}
                          </span>
                          <LocateFixed className="h-3 w-3 text-slate-500 opacity-70" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* 2. 三库 system 模式专属：内联入边局部权重矩阵编辑器 */}
        {graphKind === 'system' && (
          <div className="p-2.5 space-y-2.5 bg-[#090d14]">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-300">
                <GitBranch className="h-3.5 w-3.5" />
                <span>入边局部权重矩阵 (Σw = 1.00)</span>
              </div>
              <span className="font-mono text-[10px] text-slate-500">
                {systemWeightTargets.length} 合成节点
              </span>
            </div>

            {systemWeightTargets.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#30363d] bg-[#161b22]/50 p-3 text-center text-[11px] text-slate-500">
                当前尚无合成入边连线，拖拽节点连线后可在此实时调节局部权重
              </div>
            ) : (
              <div className="space-y-2.5">
                {systemWeightTargets.map(({ targetNode, incomingEdges, summary }) => {
                  const isTargetSelected = selectedNodeId === targetNode.id;

                  return (
                    <div
                      key={`matrix-${targetNode.id}`}
                      className={`rounded-lg border p-2 transition ${
                        isTargetSelected
                          ? 'border-indigo-400/70 bg-[#161b22]'
                          : !summary.isBalanced
                            ? 'border-amber-500/50 bg-[#161b22]/85'
                            : 'border-[#30363d] bg-[#161b22]/65'
                      }`}
                    >
                      {/* 目标效果节点标题 + Σw 平衡校验 */}
                      <div className="mb-2 flex items-center justify-between gap-1.5">
                        <button
                          type="button"
                          onClick={() => onSelectNode(targetNode.id)}
                          className="truncate text-left text-[11px] font-semibold text-slate-100 hover:text-indigo-300 transition cursor-pointer"
                          title={`点击定位节点: ${targetNode.label}`}
                        >
                          {targetNode.label}
                        </button>

                        <div className="flex shrink-0 items-center gap-1">
                          <span
                            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
                              summary.isBalanced
                                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                : summary.sum > 1.0001 || summary.sum === 0
                                  ? 'border-rose-500/55 bg-rose-500/15 text-rose-300'
                                  : 'border-amber-500/55 bg-amber-500/15 text-amber-300'
                            }`}
                          >
                            {summary.isBalanced ? (
                              <CheckCircle2 className="h-2.5 w-2.5" />
                            ) : summary.sum > 1.0001 ? (
                              <ShieldAlert className="h-2.5 w-2.5" />
                            ) : (
                              <AlertTriangle className="h-2.5 w-2.5" />
                            )}
                            Σw={summary.sum.toFixed(2)}
                          </span>

                          {!readOnly && onUpdateEdgeWeight && !summary.isBalanced && (
                            <button
                              type="button"
                              onClick={() => handleNormalizeTargetWeights(targetNode.id, incomingEdges)}
                              className="rounded border border-indigo-500/40 bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-medium text-indigo-200 hover:bg-indigo-500/30 transition cursor-pointer"
                              title="按比例自动归一化入边权重至 1.00"
                            >
                              归一化
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 各入边权重内联编辑行 */}
                      <div className="space-y-1.5">
                        {incomingEdges.map((edge) => {
                          const srcNode = nodeMap.get(edge.sourceNodeId);
                          const currentWeight =
                            typeof edge.weight === 'number' && Number.isFinite(edge.weight)
                              ? edge.weight
                              : 0;
                          const displayDraft =
                            draftWeights[edge.id] !== undefined
                              ? draftWeights[edge.id]
                              : currentWeight.toFixed(2);

                          return (
                            <div
                              key={edge.id}
                              onClick={() => onSelectEdge?.(edge.id)}
                              className="flex items-center justify-between gap-2 rounded border border-[#30363d]/70 bg-[#0d1117] px-2 py-1 text-[11px]"
                            >
                              <div className="flex min-w-0 items-center gap-1.5">
                                <span
                                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                    STATUS_DOT[srcNode?.status ?? 'idle']
                                  }`}
                                />
                                <span
                                  className="truncate text-slate-300"
                                  title={srcNode?.label || edge.sourceNodeId}
                                >
                                  {srcNode?.label || edge.sourceNodeId}
                                </span>
                              </div>

                              <div className="flex shrink-0 items-center gap-1">
                                <input
                                  type="number"
                                  step="0.05"
                                  min="0"
                                  max="10"
                                  disabled={readOnly || !onUpdateEdgeWeight}
                                  value={displayDraft}
                                  aria-label={`权重 ${srcNode?.label || edge.sourceNodeId} 到 ${targetNode.label}`}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    setDraftWeights((prev) => ({ ...prev, [edge.id]: raw }));
                                    const parsed = Number.parseFloat(raw);
                                    if (Number.isFinite(parsed) && parsed >= 0) {
                                      const clamped =
                                        Math.round(Math.min(Math.max(parsed, 0), 10) * 10000) /
                                        10000;
                                      onUpdateEdgeWeight?.(edge.id, clamped);
                                    }
                                  }}
                                  onBlur={() => {
                                    setDraftWeights((prev) => {
                                      const next = { ...prev };
                                      delete next[edge.id];
                                      return next;
                                    });
                                  }}
                                  className="w-16 rounded border border-[#30363d] bg-[#161b22] px-1.5 py-0.5 text-right font-mono text-[11px] font-semibold text-indigo-200 tabular-nums focus:border-indigo-400 focus:outline-none disabled:opacity-60"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
