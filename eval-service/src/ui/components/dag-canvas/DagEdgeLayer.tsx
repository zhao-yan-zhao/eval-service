import React, { useId, useState } from 'react';
import { X } from 'lucide-react';
import type { DagGraphKind } from '../../../core/types.ts';
import {
  DAG_GRAPH_ISOLATION_META,
  DEFAULT_DAG_NODE_HEIGHT,
  DEFAULT_DAG_NODE_WIDTH,
  type DagCanvasEdge,
  type DagCanvasNode,
  type DagNodeStatus,
} from './types.ts';

export interface DagEdgeLayerProps {
  nodes: DagCanvasNode[];
  edges: DagCanvasEdge[];
  graphKind: DagGraphKind;
  selectedEdgeId?: string | null;
  readOnly?: boolean;
  onSelectEdge?: (edgeId: string | null) => void;
  onDeleteEdge?: (edgeId: string) => void;
  onUpdateEdgeWeight?: (edgeId: string, weight: number) => void;
  connectingFromNodeId?: string | null;
  connectingMousePos?: { x: number; y: number } | null;
  connectingPreviewValid?: boolean | null;
}

function getBezierPath(startX: number, startY: number, endX: number, endY: number): string {
  const deltaX = Math.max(Math.abs(endX - startX) * 0.48, 52);
  // AGENTS.md §2.5 SVG 防退化守卫：
  // 当 startY === endY 时 SVG objectBoundingBox 高度为 0，会导致线性渐变完全隐形；
  // 添加 0.05px 亚像素偏移并配合下方纯色实线基座，确保水平连线始终清晰可见。
  const safeEndY = Math.abs(endY - startY) < 0.1 ? startY + 0.05 : endY;
  return `M ${startX} ${startY} C ${startX + deltaX} ${startY}, ${endX - deltaX} ${safeEndY}, ${endX} ${safeEndY}`;
}

function resolveEdgeEffectiveStatus(
  edge: DagCanvasEdge,
  sourceNode: DagCanvasNode,
  targetNode: DagCanvasNode,
): DagNodeStatus {
  if (edge.status) return edge.status;
  if (sourceNode.status === 'violated' || targetNode.status === 'violated') return 'violated';
  if (sourceNode.status === 'unavailable') return 'unavailable';
  if (sourceNode.status === 'degraded') return 'degraded';
  if (sourceNode.status === 'running' || targetNode.status === 'running') return 'running';
  if (sourceNode.status === 'valid' && targetNode.status === 'valid') return 'valid';
  return 'idle';
}

export function DagEdgeLayer({
  nodes,
  edges,
  graphKind,
  selectedEdgeId,
  readOnly = false,
  onSelectEdge,
  onDeleteEdge,
  onUpdateEdgeWeight,
  connectingFromNodeId,
  connectingMousePos,
  connectingPreviewValid,
}: DagEdgeLayerProps) {
  const rawUid = useId();
  const uid = rawUid.replace(/[^a-zA-Z0-9_-]/g, '');
  const meta = DAG_GRAPH_ISOLATION_META[graphKind];

  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [weightDraft, setWeightDraft] = useState<string>('');

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const commitWeightEdit = (edgeId: string) => {
    const parsed = Number.parseFloat(weightDraft);
    if (Number.isFinite(parsed) && parsed >= 0) {
      const clamped = Math.round(Math.min(Math.max(parsed, 0), 10) * 10000) / 10000;
      onUpdateEdgeWeight?.(edgeId, clamped);
    }
    setEditingEdgeId(null);
  };

  const renderedEdges = edges
    .map((edge) => {
      const sourceNode = nodeMap.get(edge.sourceNodeId);
      const targetNode = nodeMap.get(edge.targetNodeId);
      if (!sourceNode || !targetNode) return null;

      const srcW = sourceNode.width ?? DEFAULT_DAG_NODE_WIDTH;
      const srcH = sourceNode.height ?? DEFAULT_DAG_NODE_HEIGHT;
      const tgtH = targetNode.height ?? DEFAULT_DAG_NODE_HEIGHT;

      const startX = sourceNode.position.x + srcW;
      const startY = sourceNode.position.y + srcH / 2;
      const endX = targetNode.position.x;
      const endY = targetNode.position.y + tgtH / 2;
      const pathData = getBezierPath(startX, startY, endX, endY);
      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;
      const effectiveStatus = resolveEdgeEffectiveStatus(edge, sourceNode, targetNode);

      return {
        edge,
        pathData,
        midX,
        midY,
        effectiveStatus,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <div className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <style>{`
            @keyframes dag-dash-flow-${uid} {
              from { stroke-dashoffset: 18; }
              to { stroke-dashoffset: 0; }
            }
          `}</style>

          {/* 正常隔离态选中绿光 / 红线违例红光滤镜 */}
          <filter id={`${uid}-selected-glow`} x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id={`${uid}-violated-glow`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <linearGradient id={`${uid}-grad-normal`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={meta.edgeGradStartHex} stopOpacity="0.85" />
            <stop offset="100%" stopColor={meta.edgeGradEndHex} stopOpacity="0.92" />
          </linearGradient>

          <linearGradient id={`${uid}-grad-selected`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>

          <linearGradient id={`${uid}-grad-degraded`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.95" />
          </linearGradient>

          <linearGradient id={`${uid}-grad-violated`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f43f5e" />
            <stop offset="100%" stopColor="#fb7185" />
          </linearGradient>

          <marker
            id={`${uid}-arrow-normal`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.2 L 9.5 5 L 0 8.8 z" fill={meta.edgeArrowHex} />
          </marker>

          <marker
            id={`${uid}-arrow-selected`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.2 L 9.5 5 L 0 8.8 z" fill="#34d399" />
          </marker>

          <marker
            id={`${uid}-arrow-unavailable`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.2 L 9.5 5 L 0 8.8 z" fill="#f59e0b" />
          </marker>

          <marker
            id={`${uid}-arrow-violated`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.2 L 9.5 5 L 0 8.8 z" fill="#f43f5e" />
          </marker>
        </defs>

        {renderedEdges.map(({ edge, pathData, effectiveStatus }) => {
          const isSelected = selectedEdgeId === edge.id;
          const isHovered = hoveredEdgeId === edge.id;
          const isUnavailable = effectiveStatus === 'unavailable';
          const isViolated = effectiveStatus === 'violated';
          const isDegraded = effectiveStatus === 'degraded';
          const isVirtual = Boolean(edge.isVirtualCollapsed);

          let baseStroke = meta.edgeBaseHex;
          let gradUrl = `url(#${uid}-grad-normal)`;
          let markerUrl = `url(#${uid}-arrow-normal)`;
          let strokeWidth = isSelected ? 3.5 : isHovered ? 2.8 : 2.2;
          let dashArray: string | undefined = isVirtual ? '5,4' : undefined;
          let filterUrl: string | undefined = undefined;

          if (isSelected) {
            baseStroke = '#10b981';
            gradUrl = `url(#${uid}-grad-selected)`;
            markerUrl = `url(#${uid}-arrow-selected)`;
            filterUrl = `url(#${uid}-selected-glow)`;
            dashArray = isUnavailable ? '6,4' : undefined;
          } else if (isViolated) {
            baseStroke = '#e11d48';
            gradUrl = `url(#${uid}-grad-violated)`;
            markerUrl = `url(#${uid}-arrow-violated)`;
            filterUrl = `url(#${uid}-violated-glow)`;
            strokeWidth = isHovered ? 3.2 : 2.6;
          } else if (isUnavailable) {
            baseStroke = '#ef4444';
            gradUrl = `url(#${uid}-grad-degraded)`;
            markerUrl = `url(#${uid}-arrow-unavailable)`;
            dashArray = '6,4';
          } else if (isDegraded) {
            baseStroke = '#d97706';
            gradUrl = `url(#${uid}-grad-degraded)`;
            markerUrl = `url(#${uid}-arrow-unavailable)`;
          } else if (isVirtual) {
            baseStroke = '#64748b';
          }

          return (
            <g
              key={edge.id}
              className="pointer-events-auto"
              onMouseEnter={() => setHoveredEdgeId(edge.id)}
              onMouseLeave={() => setHoveredEdgeId((prev) => (prev === edge.id ? null : prev))}
            >
              {/* 宽透明点击热区 */}
              <path
                d={pathData}
                fill="none"
                stroke="transparent"
                strokeWidth="18"
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectEdge?.(edge.id);
                }}
              />

              {/* 纯色实线基座：保证水平直连或任何渲染上下文中连线主体始终可见 */}
              <path
                d={pathData}
                fill="none"
                stroke={baseStroke}
                strokeWidth={strokeWidth}
                strokeOpacity={isVirtual ? 0.55 : isSelected ? 0.95 : 0.8}
                strokeDasharray={dashArray}
              />

              {/* 渐变/发光视觉主线 */}
              {!isVirtual && (
                <path
                  d={pathData}
                  fill="none"
                  stroke={gradUrl}
                  strokeWidth={strokeWidth}
                  strokeDasharray={dashArray}
                  filter={filterUrl}
                  markerEnd={markerUrl}
                />
              )}

              {/* 动态数据流光效（非缺数且非虚拟折叠桥接时启用） */}
              {!isUnavailable && !isVirtual && (
                <path
                  d={pathData}
                  fill="none"
                  stroke={isViolated ? '#fda4af' : isSelected ? '#a7f3d0' : meta.edgeFlowHex}
                  strokeWidth={isSelected ? 2.2 : 1.8}
                  strokeDasharray="4,14"
                  className={isHovered || isSelected ? 'opacity-95' : 'opacity-55'}
                  style={{
                    animation: `dag-dash-flow-${uid} ${effectiveStatus === 'running' ? '0.8s' : '1.6s'} linear infinite`,
                  }}
                />
              )}
            </g>
          );
        })}

        {/* 实时拖拽创建连线的引导预览虚线 */}
        {connectingFromNodeId &&
          connectingMousePos &&
          (() => {
            const sourceNode = nodeMap.get(connectingFromNodeId);
            if (!sourceNode) return null;
            const srcW = sourceNode.width ?? DEFAULT_DAG_NODE_WIDTH;
            const srcH = sourceNode.height ?? DEFAULT_DAG_NODE_HEIGHT;
            const startX = sourceNode.position.x + srcW;
            const startY = sourceNode.position.y + srcH / 2;
            const pathData = getBezierPath(startX, startY, connectingMousePos.x, connectingMousePos.y);
            const previewColor =
              connectingPreviewValid === false
                ? '#f43f5e'
                : connectingPreviewValid === true
                  ? '#10b981'
                  : meta.edgeArrowHex;

            return (
              <path
                d={pathData}
                fill="none"
                stroke={previewColor}
                strokeWidth="2.5"
                strokeDasharray="6,5"
              />
            );
          })()}
      </svg>

      {/* HTML 交互徽章叠加层：系统权重可点击编辑、状态提示与删除按钮 */}
      <div className="pointer-events-none absolute inset-0 overflow-visible">
        {renderedEdges.map(({ edge, midX, midY, effectiveStatus }) => {
          const isSelected = selectedEdgeId === edge.id;
          const isHovered = hoveredEdgeId === edge.id;
          const isEditing = editingEdgeId === edge.id;
          const isSystemMode = graphKind === 'system' && !edge.isVirtualCollapsed;
          const showDelete = !readOnly && !edge.isVirtualCollapsed && Boolean(onDeleteEdge) && (isSelected || isHovered);

          const hasLabel = Boolean(edge.label && edge.label.trim().length > 0);
          const showBadge =
            isSystemMode ||
            edge.isVirtualCollapsed ||
            isSelected ||
            isHovered ||
            effectiveStatus === 'unavailable' ||
            effectiveStatus === 'violated' ||
            hasLabel;

          if (!showBadge) return null;

          const weightNum = typeof edge.weight === 'number' && Number.isFinite(edge.weight) ? edge.weight : 0;
          const hasRenormalized =
            typeof edge.effectiveWeight === 'number' &&
            Number.isFinite(edge.effectiveWeight) &&
            Math.abs(edge.effectiveWeight - weightNum) > 1e-4;

          return (
            <div
              key={`overlay-${edge.id}`}
              style={{
                left: `${midX}px`,
                top: `${midY}px`,
                transform: 'translate(-50%, -50%)',
              }}
              className="pointer-events-auto absolute z-20 flex items-center gap-1"
              onMouseEnter={() => setHoveredEdgeId(edge.id)}
              onMouseLeave={() => setHoveredEdgeId((prev) => (prev === edge.id ? null : prev))}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {/* 三库 system 画布局部入边权重交互徽章 */}
              {isSystemMode && (
                isEditing ? (
                  <div className="flex items-center gap-1 rounded-md border border-indigo-400 bg-[#0d1117] px-1.5 py-0.5 shadow-xl">
                    <span className="font-mono text-[10px] text-indigo-300">w=</span>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max="10"
                      autoFocus
                      value={weightDraft}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setWeightDraft(raw);
                        const parsed = Number.parseFloat(raw);
                        if (Number.isFinite(parsed) && parsed >= 0) {
                          onUpdateEdgeWeight?.(
                            edge.id,
                            Math.round(Math.min(Math.max(parsed, 0), 10) * 10000) / 10000,
                          );
                        }
                      }}
                      onBlur={() => commitWeightEdit(edge.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitWeightEdit(edge.id);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setEditingEdgeId(null);
                        }
                      }}
                      className="w-14 rounded border border-[#30363d] bg-[#161b22] px-1 py-0.5 text-center font-mono text-[11px] font-semibold text-slate-100 focus:border-indigo-400 focus:outline-none"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    title={readOnly ? '入边局部权重' : '点击选择并修改入边权重'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectEdge?.(edge.id);
                      if (!readOnly && onUpdateEdgeWeight) {
                        setWeightDraft(weightNum.toFixed(2));
                        setEditingEdgeId(edge.id);
                      }
                    }}
                    className={`flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold shadow-md transition ${
                      isSelected
                        ? 'border-emerald-400 bg-emerald-950/95 text-emerald-200 ring-1 ring-emerald-400/50'
                        : effectiveStatus === 'violated'
                          ? 'border-rose-500/70 bg-rose-950/95 text-rose-200'
                          : effectiveStatus === 'unavailable'
                            ? 'border-amber-500/60 bg-amber-950/95 text-amber-200 border-dashed'
                            : 'border-[#30363d] bg-[#161b22]/95 text-indigo-200 hover:border-indigo-400 hover:text-white'
                    }`}
                  >
                    <span>w = {weightNum.toFixed(2)}</span>
                    {hasRenormalized && (
                      <span className="text-violet-300">→ {edge.effectiveWeight!.toFixed(2)}</span>
                    )}
                  </button>
                )
              )}

              {/* 非 system 模式下的连线状态/别名徽章 */}
              {!isSystemMode && (edge.isVirtualCollapsed || effectiveStatus === 'unavailable' || effectiveStatus === 'violated' || hasLabel) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!edge.isVirtualCollapsed) {
                      onSelectEdge?.(edge.id);
                    }
                  }}
                  className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] shadow-md ${
                    edge.isVirtualCollapsed
                      ? 'border-slate-600/70 bg-[#161b22]/90 text-slate-300 border-dashed'
                      : effectiveStatus === 'violated'
                        ? 'border-rose-500/70 bg-rose-950/95 text-rose-200'
                        : effectiveStatus === 'unavailable'
                          ? 'border-amber-500/60 bg-amber-950/95 text-amber-200 border-dashed'
                          : 'border-[#30363d] bg-[#161b22]/95 text-slate-300'
                  }`}
                >
                  {edge.isVirtualCollapsed
                    ? '折叠跨接'
                    : effectiveStatus === 'violated'
                      ? '红线违例'
                      : effectiveStatus === 'unavailable'
                        ? '断链缺数'
                        : edge.label}
                </button>
              )}

              {/* 删除连线按钮 */}
              {showDelete && (
                <button
                  type="button"
                  title="删除连线"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteEdge?.(edge.id);
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded-full border border-rose-500/70 bg-[#0d1117] text-rose-400 shadow-lg transition hover:bg-rose-600 hover:text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
