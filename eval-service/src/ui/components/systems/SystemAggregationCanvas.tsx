import {
  AlertTriangle,
  Calculator,
  ChevronRight,
  Database,
  Filter,
  Layers,
  Maximize2,
  Minimize2,
  Minus,
  Play,
  Plus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  IndicatorDefinition,
  IndicatorSystem,
  StoredRunSummary,
  SystemEvaluationOutput,
} from '../../api.ts';
import {
  computeAggregationCanvasLayout,
  type AggCanvasEdge,
  type AggCanvasNode,
} from './aggregation-canvas-layout.ts';

export interface SystemAggregationCanvasProps {
  system: IndicatorSystem;
  indicators: IndicatorDefinition[];
  selectedNodeId?: string;
  onSelectNodeById: (nodeId: string) => void;
  evalOutput?: SystemEvaluationOutput | null;
  evaluating?: boolean;
  onRunEvaluation?: (runId: string) => void;
  runs?: StoredRunSummary[];
  selectedRunId?: string;
  onSelectRunId?: (runId: string) => void;
  isStale?: boolean;
  onAddChildDimension?: (parentId: string) => void;
  onAddChildIndicator?: (parentId: string) => void;
}

export function SystemAggregationCanvas({
  system,
  indicators,
  selectedNodeId,
  onSelectNodeById,
  evalOutput,
  evaluating = false,
  onRunEvaluation,
  runs = [],
  selectedRunId = '',
  onSelectRunId,
  isStale = false,
  onAddChildDimension,
  onAddChildIndicator,
}: SystemAggregationCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Viewport transforms (Pan & Zoom)
  const [scale, setScale] = useState<number>(0.85);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 30, y: 30 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; initPanX: number; initPanY: number }>({
    startX: 0,
    startY: 0,
    initPanX: 30,
    initPanY: 30,
  });

  const [activeRun, setActiveRun] = useState<string>(selectedRunId || (runs[0]?.runId ?? ''));

  useEffect(() => {
    if (selectedRunId) setActiveRun(selectedRunId);
  }, [selectedRunId]);

  // Compute Layout
  const layout = useMemo(() => {
    return computeAggregationCanvasLayout(system, indicators, evalOutput);
  }, [system, indicators, evalOutput]);

  // Auto-fit initial scale when system changes or container resizes
  const handleFitView = useCallback(() => {
    if (!containerRef.current || layout.canvasWidth === 0) return;
    const { clientWidth, clientHeight } = containerRef.current;
    if (clientWidth <= 0 || clientHeight <= 0) return;

    const scaleX = (clientWidth - 64) / layout.canvasWidth;
    const scaleY = (clientHeight - 64) / layout.canvasHeight;
    const fitScale = Math.min(Math.max(Math.min(scaleX, scaleY), 0.4), 1.2);

    setScale(Number(fitScale.toFixed(2)));
    setPan({
      x: Math.max(20, Math.round((clientWidth - layout.canvasWidth * fitScale) / 2)),
      y: Math.max(20, Math.round((clientHeight - layout.canvasHeight * fitScale) / 2)),
    });
  }, [layout.canvasWidth, layout.canvasHeight]);

  useEffect(() => {
    handleFitView();
  }, [system.systemId]);

  // Pan interactions
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initPanX: pan.x,
      initPanY: pan.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;
    setPan({
      x: dragStartRef.current.initPanX + dx,
      y: dragStartRef.current.initPanY + dy,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    setScale((prev) => {
      const next = prev * zoomFactor;
      return Math.min(Math.max(next, 0.35), 1.6);
    });
  };

  // Connected edges for the selected node
  const activeEdgeMap = useMemo(() => {
    const map = new Map<string, 'selected' | 'dimmed' | 'normal'>();
    if (!selectedNodeId) return map;

    for (const edge of layout.edges) {
      if (edge.sourceNodeId === selectedNodeId || edge.targetNodeId === selectedNodeId) {
        map.set(edge.id, 'selected');
      } else {
        map.set(edge.id, 'dimmed');
      }
    }
    return map;
  }, [selectedNodeId, layout.edges]);

  const renderScorePill = (score: number | null, isStaleVal: boolean) => {
    if (score === null) {
      return (
        <span className="rounded bg-slate-800/80 border border-slate-700/60 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
          未出数
        </span>
      );
    }
    let colorClass = 'bg-rose-500/20 text-rose-300 border-rose-500/40';
    if (score >= 80) colorClass = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    else if (score >= 60) colorClass = 'bg-amber-500/20 text-amber-300 border-amber-500/40';

    return (
      <span
        className={`rounded border px-1.5 py-0.5 text-[11px] font-bold font-mono ${colorClass} ${
          isStaleVal ? 'border-dashed opacity-80' : ''
        }`}
        title={isStaleVal ? '注意：此得分为上一版试算结果' : undefined}
      >
        {score.toFixed(1)} 分{isStaleVal ? '*' : ''}
      </span>
    );
  };

  return (
    <div className="relative flex flex-col h-full w-full bg-[#090d16] overflow-hidden select-none">
      {/* 顶部控制栏 */}
      <div className="z-20 flex flex-wrap items-center justify-between gap-3 border-b border-[#21262d] bg-[#0d1117]/90 px-4 py-2.5 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="flex items-center gap-1.5 text-slate-300 font-medium">
            <Layers className="h-4 w-4 text-cyan-400" />
            <span>聚合透视画布</span>
          </span>
          <span className="text-slate-600">|</span>

          {/* 局次推演选择器 */}
          <div className="flex items-center gap-1.5">
            <span className="text-[#8b949e]">推演场次:</span>
            <select
              value={activeRun}
              onChange={(e) => {
                setActiveRun(e.target.value);
                onSelectRunId?.(e.target.value);
              }}
              className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              {runs.map((r) => (
                <option key={r.runId} value={r.runId}>
                  {r.scenarioName || r.runId} [{r.runId}]
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            disabled={evaluating || !activeRun}
            onClick={() => onRunEvaluation?.(activeRun)}
            className="inline-flex items-center gap-1.5 rounded bg-cyan-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50 shadow-sm"
          >
            <Play className={`h-3.5 w-3.5 ${evaluating ? 'animate-spin' : 'fill-white'}`} />
            {evaluating ? '试算中…' : '试算草稿'}
          </button>
        </div>

        {/* 右侧缩放控制与视口复位 */}
        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center rounded border border-[#30363d] bg-[#161b22] text-slate-300">
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(0.35, s - 0.1))}
              className="px-2 py-1 hover:bg-slate-800 transition"
              title="缩小"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="px-2 py-1 font-mono text-[11px] text-[#8b949e] border-x border-[#30363d]">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(1.6, s + 0.1))}
              className="px-2 py-1 hover:bg-slate-800 transition"
              title="放大"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleFitView}
            className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#161b22] px-2.5 py-1 text-slate-300 hover:border-cyan-500 hover:text-cyan-300 transition"
            title="自适应居中"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>自适应</span>
          </button>

          {/* 图例 */}
          <div className="hidden lg:flex items-center gap-3 text-[11px] text-[#8b949e] border-l border-[#30363d] pl-3">
            <span className="flex items-center gap-1">
              <span className="h-2 w-4 rounded-full bg-cyan-500/70 inline-block" />
              <span>基准连线</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-4 rounded-full bg-purple-500/90 inline-block" />
              <span>实效重归一</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-4 rounded-full bg-rose-500/80 inline-block" />
              <span>缺数/熔断</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-4 rounded-full bg-amber-400 inline-block" />
              <span>公式变量</span>
            </span>
          </div>
        </div>
      </div>

      {/* 结构变更后 Stale 过期状态守卫提示条 */}
      {isStale && (
        <div className="z-10 flex items-center justify-between border-b border-amber-500/30 bg-amber-950/40 px-4 py-1.5 text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <span>
              <strong>提示：</strong>当前体系结构、权重或聚合策略已变更，画布得分为上一版试算结果。请点击「试算草稿」刷新。
            </span>
          </div>
          <button
            type="button"
            disabled={evaluating || !activeRun}
            onClick={() => onRunEvaluation?.(activeRun)}
            className="rounded bg-amber-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-amber-500 disabled:opacity-50"
          >
            立即重新试算
          </button>
        </div>
      )}

      {/* 画布视口主容器 */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        className={`relative flex-1 overflow-hidden cursor-${isDragging ? 'grabbing' : 'grab'}`}
      >
        {/* 缩放与平移图层 */}
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transformOrigin: '0 0',
            width: layout.canvasWidth,
            height: layout.canvasHeight,
          }}
          className="relative transition-transform duration-75 ease-out"
        >
          {/* SVG 连线层 */}
          <svg
            width={layout.canvasWidth}
            height={layout.canvasHeight}
            className="absolute inset-0 pointer-events-none"
            style={{ overflow: 'visible' }}
          >
            <defs>
              {/* ID 隔离：全部带 agg- 前缀 */}
              <linearGradient id="agg-edge-normal" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#0891b2" stopOpacity="0.8" />
              </linearGradient>
              <linearGradient id="agg-edge-renorm" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#c084fc" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#9333ea" stopOpacity="0.95" />
              </linearGradient>
              <linearGradient id="agg-edge-missing" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#e11d48" stopOpacity="0.85" />
              </linearGradient>
              <linearGradient id="agg-edge-formula" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#d97706" stopOpacity="0.9" />
              </linearGradient>
              <linearGradient id="agg-edge-selected" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#059669" stopOpacity="1" />
              </linearGradient>

              {/* 箭头 Marker */}
              <marker
                id="agg-arrow-normal"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0891b2" />
              </marker>
              <marker
                id="agg-arrow-renorm"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#9333ea" />
              </marker>
              <marker
                id="agg-arrow-missing"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#e11d48" />
              </marker>
              <marker
                id="agg-arrow-formula"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#d97706" />
              </marker>
              <marker
                id="agg-arrow-selected"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981" />
              </marker>
            </defs>

            {/* 连线与胶囊标签渲染 */}
            {layout.edges.map((edge) => {
              const activeStatus = activeEdgeMap.get(edge.id);
              const isSel = activeStatus === 'selected';
              const isDim = activeStatus === 'dimmed';

              let stroke = 'url(#agg-edge-normal)';
              let markerEnd = 'url(#agg-arrow-normal)';
              let strokeWidth = 2;
              let strokeDasharray: string | undefined = undefined;

              if (isSel) {
                stroke = 'url(#agg-edge-selected)';
                markerEnd = 'url(#agg-arrow-selected)';
                strokeWidth = 3;
              } else if (edge.visualKind === 'renormalized') {
                stroke = 'url(#agg-edge-renorm)';
                markerEnd = 'url(#agg-arrow-renorm)';
                strokeWidth = 2.5;
              } else if (edge.visualKind === 'missing') {
                stroke = 'url(#agg-edge-missing)';
                markerEnd = 'url(#agg-arrow-missing)';
                strokeDasharray = '4 3';
              } else if (edge.visualKind === 'formula_var') {
                stroke = 'url(#agg-edge-formula)';
                markerEnd = 'url(#agg-arrow-formula)';
              }

              return (
                <g
                  key={edge.id}
                  className={`transition-opacity duration-200 ${
                    isDim ? 'opacity-20' : 'opacity-100'
                  }`}
                >
                  <path
                    d={edge.pathData}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                    strokeDasharray={strokeDasharray}
                    markerEnd={markerEnd}
                  />

                  {/* 连线中点胶囊标签 */}
                  <g transform={`translate(${edge.midX}, ${edge.midY})`}>
                    <rect
                      x={-48}
                      y={-10}
                      width={96}
                      height={20}
                      rx={10}
                      fill="#0d1117"
                      stroke={
                        isSel
                          ? '#10b981'
                          : edge.visualKind === 'renormalized'
                            ? '#9333ea'
                            : edge.visualKind === 'missing'
                              ? '#f43f5e'
                              : '#30363d'
                      }
                      strokeWidth={1}
                      className="pointer-events-auto"
                    />
                    <text
                      x={0}
                      y={3.5}
                      textAnchor="middle"
                      fill={
                        isSel
                          ? '#6ee7b7'
                          : edge.visualKind === 'renormalized'
                            ? '#d8b4fe'
                            : edge.visualKind === 'missing'
                              ? '#fda4af'
                              : '#94a3b8'
                      }
                      fontSize="10"
                      fontFamily="monospace"
                      fontWeight="500"
                    >
                      {edge.badgeText}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>

          {/* HTML 卡片节点层 */}
          {layout.nodes.map((node) => {
            const isSelected = selectedNodeId === node.nodeId;

            if (node.kind === 'leaf') {
              return (
                <div
                  key={node.key}
                  id={`agg-node-${node.nodeId}`}
                  style={{
                    position: 'absolute',
                    left: `${node.x}px`,
                    top: `${node.y}px`,
                    width: `${node.width}px`,
                    height: `${node.height}px`,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectNodeById(node.nodeId);
                  }}
                  className={`group rounded-lg border bg-[#161b22] p-2.5 shadow-md transition-all duration-200 cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? 'border-emerald-500 ring-2 ring-emerald-500/40 bg-[#1c222d]'
                      : 'border-[#30363d] hover:border-cyan-500/70 hover:shadow-cyan-950/30'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-slate-200 group-hover:text-cyan-300">
                          {node.name}
                        </span>
                        <span className="block truncate font-mono text-[10px] text-[#8b949e]">
                          {node.indicatorRef || node.nodeId}
                        </span>
                      </div>
                      <div className="shrink-0">{renderScorePill(node.score, isStale)}</div>
                    </div>

                    {/* 叶子指标计算配置标签 */}
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {node.indicatorDef?.bindingMode === 'composite' ? (
                        <span className="rounded bg-purple-950/50 border border-purple-500/30 px-1 py-0.2 text-[9px] font-mono text-purple-300">
                          复合 AST ({node.indicatorDef.sources?.length ?? 0}源)
                        </span>
                      ) : (
                        <span className="rounded bg-blue-950/50 border border-blue-500/30 px-1 py-0.2 text-[9px] font-mono text-blue-300 truncate max-w-[150px]">
                          {node.indicatorDef?.atomRef || '单算子'}
                        </span>
                      )}
                      {node.indicatorDef?.unit && (
                        <span className="rounded bg-slate-800 px-1 py-0.2 text-[9px] text-slate-400">
                          {node.indicatorDef.unit}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 复合模式输入源别名 */}
                  {node.indicatorDef?.bindingMode === 'composite' &&
                    node.indicatorDef.sources &&
                    node.indicatorDef.sources.length > 0 && (
                      <div className="mt-1.5 border-t border-[#262c36] pt-1 flex flex-wrap gap-1">
                        {node.indicatorDef.sources.slice(0, 4).map((s, idx) => (
                          <span
                            key={idx}
                            className="rounded bg-slate-800/80 px-1 py-0.2 font-mono text-[9px] text-slate-300"
                          >
                            {s.alias}
                          </span>
                        ))}
                      </div>
                    )}
                </div>
              );
            }

            if (node.kind === 'dimension') {
              return (
                <div
                  key={node.key}
                  id={`agg-node-${node.nodeId}`}
                  style={{
                    position: 'absolute',
                    left: `${node.x}px`,
                    top: `${node.y}px`,
                    width: `${node.width}px`,
                    height: `${node.height}px`,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectNodeById(node.nodeId);
                  }}
                  className={`group rounded-lg border bg-[#161b22] p-3 shadow-md transition-all duration-200 cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? 'border-emerald-500 ring-2 ring-emerald-500/40 bg-[#1c222d]'
                      : 'border-[#30363d] hover:border-cyan-500/70 hover:shadow-cyan-950/30'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-bold text-slate-100 group-hover:text-cyan-300">
                            {node.name}
                          </span>
                          {node.nodeCode && (
                            <span className="rounded bg-cyan-950/50 border border-cyan-500/40 px-1 py-0.2 font-mono text-[9px] text-cyan-300">
                              {node.nodeCode}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-[#8b949e]">权重: {(node.weight * 100).toFixed(0)}%</span>
                      </div>
                      <div className="shrink-0">{renderScorePill(node.score, isStale)}</div>
                    </div>

                    {/* 策略与缺失标签 */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-slate-800/90 border border-slate-700/60 px-1.5 py-0.5 text-[10px] font-mono text-cyan-300">
                        {node.strategy}
                      </span>
                      <span className="rounded bg-slate-800/90 border border-slate-700/60 px-1.5 py-0.5 text-[10px] text-slate-400">
                        {node.missingPolicy}
                      </span>
                    </div>

                    {/* 算式透明窗 */}
                    <div className="mt-2 rounded border border-[#262c36] bg-[#0c1017] px-2 py-1.5 font-mono text-[11px] text-cyan-200 truncate">
                      <span className="text-slate-500 mr-1">ƒ:</span>
                      {node.equationText || '暂未出数'}
                    </div>
                  </div>

                  {/* 卡片底部快捷造点操作栏 */}
                  <div className="mt-2 flex items-center justify-between border-t border-[#262c36] pt-1.5 text-[10px] text-slate-400">
                    <span className="font-mono text-slate-500">L{node.bottomUpLevel} 聚合节点</span>
                    <div className="flex items-center gap-1">
                      {onAddChildDimension && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddChildDimension(node.nodeId);
                          }}
                          className="rounded border border-[#30363d] bg-[#1a202c] px-1.5 py-0.5 text-slate-300 hover:border-cyan-500 hover:text-cyan-300"
                        >
                          + 子维度
                        </button>
                      )}
                      {onAddChildIndicator && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddChildIndicator(node.nodeId);
                          }}
                          className="rounded border border-[#30363d] bg-[#1a202c] px-1.5 py-0.5 text-blue-300 hover:border-blue-500 hover:text-blue-200"
                        >
                          + 指标
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            // Root Node
            return (
              <div
                key={node.key}
                id={`agg-node-${node.nodeId}`}
                style={{
                  position: 'absolute',
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                  width: `${node.width}px`,
                  height: `${node.height}px`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectNodeById(node.nodeId);
                }}
                className={`group rounded-xl border bg-gradient-to-br from-[#161f2e] to-[#0f1520] p-3.5 shadow-xl transition-all duration-200 cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'border-emerald-500 ring-2 ring-emerald-500/50'
                    : 'border-cyan-500/40 hover:border-cyan-400'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="h-4 w-4 text-cyan-400" />
                        <h4 className="text-sm font-bold text-white group-hover:text-cyan-300">
                          {node.name}
                        </h4>
                      </div>
                      <span className="font-mono text-[10px] text-cyan-400/80">体系最终效能裁决</span>
                    </div>

                    <div className="text-right">
                      {renderScorePill(node.score, isStale)}
                      {typeof node.rawOverallScore === 'number' &&
                        node.rawOverallScore !== node.score && (
                          <span className="block font-mono text-[10px] text-slate-400">
                            原始: {node.rawOverallScore.toFixed(1)}
                          </span>
                        )}
                    </div>
                  </div>

                  {/* 门控裁决状态 */}
                  {node.gateVerdict && (
                    <div className="mt-2 flex items-center gap-1.5">
                      {node.gateVerdict === 'PASS' ? (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          红线裁决: PASS
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-rose-500/20 border border-rose-500/40 px-2 py-0.5 text-xs font-semibold text-rose-300">
                          <ShieldAlert className="h-3.5 w-3.5" />
                          门控拦截: {node.gateVerdict}
                        </span>
                      )}
                      <span className="rounded bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                        {node.strategy}
                      </span>
                    </div>
                  )}

                  {/* 总分聚合算式 */}
                  <div className="mt-2 rounded border border-cyan-500/20 bg-[#080d14] px-2.5 py-1.5 font-mono text-xs text-cyan-300 truncate">
                    <span className="text-slate-500 mr-1.5">Σ:</span>
                    {node.equationText || '暂未出数'}
                  </div>
                </div>

                {/* 底部快捷添加顶级维度 */}
                <div className="mt-2 flex items-center justify-between border-t border-cyan-900/40 pt-1.5 text-[10px] text-slate-400">
                  <span className="text-cyan-400/70 font-mono">根决策汇总</span>
                  {onAddChildDimension && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddChildDimension('root');
                      }}
                      className="rounded border border-cyan-500/40 bg-cyan-950/40 px-2 py-0.5 text-cyan-300 hover:bg-cyan-500/20"
                    >
                      + 顶级维度
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
