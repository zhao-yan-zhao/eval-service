import React from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ChevronDown,
  ChevronRight,
  Compass,
  Cpu,
  Database,
  GitBranch,
  Layers,
  ShieldAlert,
  ShieldCheck,
  Target,
  Trash2,
  Zap,
} from 'lucide-react';
import type { DagGraphKind } from '../../../core/types.ts';
import {
  DAG_GRAPH_ISOLATION_META,
  DEFAULT_DAG_NODE_HEIGHT,
  DEFAULT_DAG_NODE_WIDTH,
  type DagCanvasNode,
  type DagNodeStatus,
  type IncomingWeightSummary,
} from './types.ts';

export interface DagNodeItemProps {
  node: DagCanvasNode;
  graphKind: DagGraphKind;
  isSelected: boolean;
  isHighlighted?: boolean;
  isConnecting?: boolean;
  isConnectSource?: boolean;
  isConnectTargetValid?: boolean | null;
  readOnly?: boolean;
  hasInputPort?: boolean;
  hasOutputPort?: boolean;
  hasCollapsibleChildren?: boolean;
  collapsedDescendantCount?: number;
  incomingWeightSummary?: IncomingWeightSummary;
  onSelect: (nodeId: string) => void;
  onDelete?: (nodeId: string) => void;
  onStartConnect: (nodeId: string, e: React.MouseEvent) => void;
  onEndConnect: (nodeId: string) => void;
  onToggleCollapse?: (nodeId: string, collapsed: boolean) => void;
  onDrillDown?: (nodeId: string) => void;
  onDragStart: (e: React.MouseEvent, nodeId: string) => void;
}

const STATUS_STYLE_MAP: Record<
  DagNodeStatus,
  { label: string; pillClass: string; dotClass: string; cardBorderOverride?: string }
> = {
  idle: {
    label: '待运行',
    pillClass: 'border-slate-700 bg-slate-800/80 text-slate-400',
    dotClass: 'bg-slate-400',
  },
  running: {
    label: '计算中',
    pillClass: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
    dotClass: 'bg-sky-400 animate-pulse',
  },
  valid: {
    label: '正常',
    pillClass: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
    dotClass: 'bg-emerald-400',
  },
  degraded: {
    label: '降级',
    pillClass: 'border-amber-500/45 bg-amber-500/15 text-amber-300',
    dotClass: 'bg-amber-400',
    cardBorderOverride: 'border-amber-500/50',
  },
  unavailable: {
    label: '缺数',
    pillClass: 'border-rose-500/45 bg-rose-950/70 text-rose-300 border-dashed',
    dotClass: 'bg-amber-400',
    cardBorderOverride: 'border-amber-500/55 border-dashed',
  },
  violated: {
    label: '红线违例',
    pillClass: 'border-rose-500/70 bg-rose-500/20 text-rose-200',
    dotClass: 'bg-rose-500 animate-pulse',
    cardBorderOverride: 'border-rose-500/80 shadow-rose-950/60',
  },
};

function resolveKindBadgeAndIcon(node: DagCanvasNode, graphKind: DagGraphKind) {
  if (graphKind === 'operator') {
    const kindLabels: Record<string, string> = {
      data_input: '表输入',
      inline_calc: '公式衍生',
      group_agg: '分组聚合',
      spatial: '空间几何',
      python_script: 'Python脚本',
      result_output: '算子输出',
    };
    const Icon =
      node.kind === 'data_input'
        ? Database
        : node.kind === 'spatial'
          ? Compass
          : node.kind === 'result_output'
            ? Target
            : Cpu;
    return {
      text: node.summary?.badgeText || kindLabels[node.kind] || node.kind,
      badgeClass: 'border-cyan-500/35 bg-cyan-500/10 text-cyan-300',
      Icon,
    };
  }

  if (graphKind === 'metric') {
    const level = node.summary?.militaryLevel;
    const levelClass =
      level === 'MOFE'
        ? 'border-teal-400/45 bg-teal-500/15 text-teal-200'
        : level === 'MOE'
          ? 'border-emerald-400/45 bg-emerald-500/15 text-emerald-200'
          : 'border-sky-400/40 bg-sky-500/15 text-sky-200';
    return {
      text: level || node.summary?.badgeText || node.kind,
      badgeClass: levelClass,
      Icon: Layers,
    };
  }

  // system graphKind
  const role = node.summary?.role;
  if (role === 'gate' || node.kind === 'gate') {
    const isHard = node.summary?.gateMode === 'hard';
    return {
      text: `GATE · ${isHard ? 'HARD' : 'SOFT'}`,
      badgeClass: isHard
        ? 'border-rose-500/45 bg-rose-500/15 text-rose-300'
        : 'border-amber-500/45 bg-amber-500/15 text-amber-300',
      Icon: node.status === 'violated' ? ShieldAlert : ShieldCheck,
    };
  }
  if (role === 'metric_proxy' || node.kind === 'metric_proxy') {
    return {
      text: '指标输入',
      badgeClass: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300',
      Icon: Layers,
    };
  }
  return {
    text: node.summary?.isTerminal ? '终态效果' : node.summary?.badgeText || '效果节点',
    badgeClass: 'border-indigo-500/45 bg-indigo-500/15 text-indigo-300',
    Icon: GitBranch,
  };
}

export function DagNodeItem({
  node,
  graphKind,
  isSelected,
  isHighlighted = false,
  isConnecting = false,
  isConnectSource = false,
  isConnectTargetValid = null,
  readOnly = false,
  hasInputPort = true,
  hasOutputPort = true,
  hasCollapsibleChildren = false,
  collapsedDescendantCount = 0,
  incomingWeightSummary,
  onSelect,
  onDelete,
  onStartConnect,
  onEndConnect,
  onToggleCollapse,
  onDrillDown,
  onDragStart,
}: DagNodeItemProps) {
  const width = node.width ?? DEFAULT_DAG_NODE_WIDTH;
  const height = node.height ?? DEFAULT_DAG_NODE_HEIGHT;
  const isoMeta = DAG_GRAPH_ISOLATION_META[graphKind];
  const statusStyle = STATUS_STYLE_MAP[node.status] ?? STATUS_STYLE_MAP.idle;
  const { text: kindBadgeText, badgeClass: kindBadgeClass, Icon } = resolveKindBadgeAndIcon(
    node,
    graphKind,
  );

  const canShowCollapse = hasCollapsibleChildren || Boolean(node.collapsed);
  const showDrillDown =
    Boolean(onDrillDown) &&
    (node.canDrillDown === true ||
      (node.canDrillDown !== false &&
        (graphKind === 'system' ||
          graphKind === 'metric' ||
          Boolean(node.summary?.dataset || node.summary?.tableName || node.summary?.metricId))));

  // 多入边体系节点显示局部权重和检验徽章
  const showWeightSumBadge =
    graphKind === 'system' &&
    node.summary?.role !== 'metric_proxy' &&
    node.kind !== 'metric_proxy' &&
    incomingWeightSummary &&
    (incomingWeightSummary.incomingCount > 1 ||
      (incomingWeightSummary.incomingCount === 1 && !incomingWeightSummary.isBalanced));

  const renderPayloadBlock = () => {
    const s = node.summary;

    if (node.status === 'unavailable') {
      return (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            <span>数据缺失</span>
          </div>
          <div
            className="truncate text-[10px] text-slate-400"
            title={s?.missingDataReason || '推演日志中缺少对应底表或关键字段'}
          >
            {s?.missingDataReason || '推演日志中缺少对应底表或字段'}
          </div>
        </div>
      );
    }

    if (graphKind === 'operator') {
      const hasDims = s?.rowCount !== undefined || s?.columnCount !== undefined;
      return (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-sm font-bold text-cyan-200 tabular-nums">
              {hasDims ? `${s?.rowCount ?? 0} 行 × ${s?.columnCount ?? 0} 列` : 'TableDataset 待运行'}
            </span>
            {s?.tableName && (
              <span className="truncate font-mono text-[10px] text-slate-400 max-w-[110px]" title={s.tableName}>
                {s.tableName}
              </span>
            )}
          </div>
          <div className="truncate text-[10px] text-slate-400" title={s?.subtitle}>
            {s?.subtitle || '表进表出算子变换节点'}
          </div>
        </div>
      );
    }

    if (graphKind === 'metric') {
      const valText =
        s?.displayValue !== undefined
          ? s.displayValue
          : typeof s?.value === 'number'
            ? Number.isInteger(s.value)
              ? String(s.value)
              : s.value.toFixed(2)
            : typeof s?.value === 'boolean'
              ? s.value
                ? 'TRUE'
                : 'FALSE'
              : '--';

      return (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-1 min-w-0">
              <span className="font-mono text-base font-bold text-emerald-200 tabular-nums truncate">
                {valText}
              </span>
              {s?.unit && <span className="font-mono text-[10px] text-emerald-400/80 shrink-0">{s.unit}</span>}
            </div>
            {s?.domainTag && (
              <span className="rounded bg-[#0d1117] border border-[#30363d] px-1.5 py-0.5 font-mono text-[9px] text-slate-400 uppercase shrink-0">
                {s.domainTag}
              </span>
            )}
          </div>
          <div className="truncate text-[10px] text-slate-400" title={s?.subtitle || s?.metricId}>
            {s?.subtitle || s?.metricId || '客观指标（无主观权重）'}
          </div>
        </div>
      );
    }

    // system graphKind
    const isGate = s?.role === 'gate' || node.kind === 'gate' || s?.gateStatus !== undefined;
    if (isGate) {
      const gateState =
        s?.gateStatus === 'violated' || node.status === 'violated'
          ? s?.gateMode === 'hard'
            ? 'DISQUALIFIED'
            : 'WARNING'
          : s?.gateStatus === 'unavailable'
            ? 'UNAVAILABLE'
            : 'PASS';

      const gateBadgeClass =
        gateState === 'DISQUALIFIED'
          ? 'text-rose-300 bg-rose-500/20 border-rose-500/60'
          : gateState === 'WARNING'
            ? 'text-amber-300 bg-amber-500/20 border-amber-500/50'
            : gateState === 'UNAVAILABLE'
              ? 'text-slate-300 bg-slate-800 border-slate-600'
              : 'text-emerald-300 bg-emerald-500/15 border-emerald-500/40';

      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className={`rounded border px-2 py-0.5 font-mono text-xs font-bold ${gateBadgeClass}`}>
              GATE: {gateState}
            </span>
            {typeof s?.score === 'number' && (
              <span className="font-mono text-xs font-semibold text-slate-300 tabular-nums">
                {s.score.toFixed(1)} / 100
              </span>
            )}
          </div>
          <div className="truncate text-[10px] text-slate-400" title={s?.subtitle}>
            {s?.subtitle || (s?.gateMode === 'hard' ? '硬红线：违例总分封顶 ≤ 39' : '软红线：违例触发告警')}
          </div>
        </div>
      );
    }

    const scoreNum = typeof s?.score === 'number' && Number.isFinite(s.score) ? s.score : null;
    const scorePct = scoreNum !== null ? Math.min(Math.max(scoreNum, 0), 100) : 0;
    const scoreColor =
      scoreNum === null
        ? 'text-slate-400'
        : scoreNum >= 80
          ? 'text-emerald-300'
          : scoreNum >= 60
            ? 'text-indigo-200'
            : 'text-rose-300';
    const barColor =
      scoreNum === null
        ? 'bg-slate-700'
        : scoreNum >= 80
          ? 'bg-emerald-500'
          : scoreNum >= 60
            ? 'bg-indigo-500'
            : 'bg-rose-500';

    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`font-mono text-base font-bold tabular-nums ${scoreColor}`}>
            {scoreNum !== null ? `${scoreNum.toFixed(1)} / 100` : '-- / 100'}
          </span>
          {s?.strategy && (
            <span className="font-mono text-[9px] text-slate-400 truncate max-w-[100px]" title={s.strategy}>
              {s.strategy}
            </span>
          )}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#0d1117] border border-[#30363d]/70">
          <div
            className={`h-full rounded-full transition-all duration-300 ${barColor}`}
            style={{ width: `${scorePct}%` }}
          />
        </div>
      </div>
    );
  };

  let containerBorderClass = statusStyle.cardBorderOverride || isoMeta.cardBorderClass;
  if (isHighlighted) {
    containerBorderClass =
      'ring-2 ring-amber-400 border-amber-400 shadow-[0_0_24px_rgba(251,191,36,0.35)]';
  } else if (isSelected) {
    containerBorderClass = isoMeta.selectedRingClass;
  }

  return (
    <div
      style={{
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
        width: `${width}px`,
        height: `${height}px`,
      }}
      data-node-id={node.id}
      className={`group absolute select-none rounded-xl border bg-[#161b22]/95 backdrop-blur-md shadow-2xl transition-shadow flex flex-col justify-between ${
        readOnly ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
      } ${containerBorderClass}`}
      onMouseDown={(e) => {
        if (readOnly) {
          e.stopPropagation();
          onSelect(node.id);
          return;
        }
        onDragStart(e, node.id);
      }}
      onMouseUp={() => {
        if (isConnecting && !isConnectSource && hasInputPort) {
          onEndConnect(node.id);
        }
      }}
    >
      {/* 左侧输入端口 */}
      {hasInputPort && !readOnly && (
        <div
          title={
            isConnecting && !isConnectSource && isConnectTargetValid === false
              ? '不可连接（隔离拦截或将形成环路）'
              : '输入端口：拖入连线'
          }
          className={`group/inport absolute -left-3 top-1/2 -translate-y-1/2 z-20 p-1 transition-opacity duration-150 ${
            isConnecting && !isConnectSource
              ? 'opacity-100 cursor-crosshair'
              : 'opacity-0 group-hover:opacity-100 cursor-crosshair'
          }`}
          onMouseUp={(e) => {
            e.stopPropagation();
            onEndConnect(node.id);
          }}
        >
          <div
            className={`flex h-4 w-4 items-center justify-center rounded-full border-2 bg-[#0d1117] shadow-md transition ${
              isConnecting && !isConnectSource
                ? isConnectTargetValid === false
                  ? 'border-rose-500 bg-rose-950 scale-110'
                  : `scale-125 ${isoMeta.portActiveClass}`
                : 'border-[#30363d] group-hover/inport:scale-125 group-hover/inport:border-slate-300'
            }`}
          >
            <div
              className={`h-1.5 w-1.5 rounded-full ${
                isConnecting && !isConnectSource && isConnectTargetValid === false
                  ? 'bg-rose-400'
                  : 'bg-slate-300'
              }`}
            />
          </div>
        </div>
      )}

      {/* 卡片头部 */}
      <div className="flex h-[34px] shrink-0 items-center justify-between gap-1.5 rounded-t-xl border-b border-[#30363d]/80 bg-[#0d1117]/85 px-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <div className={`shrink-0 rounded p-1 bg-[#161b22] border border-[#30363d]/70 ${isoMeta.accentTextClass}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <span className="flex-1 truncate text-xs font-semibold text-slate-100" title={node.label}>
            {node.label}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {canShowCollapse && onToggleCollapse && (
            <button
              type="button"
              title={node.collapsed ? '展开折叠子图' : '折叠子图'}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse(node.id, !node.collapsed);
              }}
              className="flex items-center gap-0.5 rounded border border-[#30363d] bg-[#161b22] px-1 py-0.5 text-[10px] text-slate-300 transition hover:border-slate-500 hover:text-white cursor-pointer"
            >
              {node.collapsed ? (
                <ChevronRight className="h-3 w-3 text-amber-300" />
              ) : (
                <ChevronDown className="h-3 w-3 text-slate-400" />
              )}
            </button>
          )}

          {!readOnly && onDelete && (
            <button
              type="button"
              title="删除节点"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(node.id);
              }}
              className="hidden group-hover:inline-flex group-focus-within:inline-flex rounded p-1 text-slate-500 transition hover:bg-rose-500/20 hover:text-rose-400 cursor-pointer"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* 卡片主体区 */}
      <div className="flex flex-1 flex-col justify-between overflow-hidden px-3 py-1.5">
        {/* 类型 + 状态 + 局部权重和校验行 */}
        <div className="flex items-center justify-between gap-1.5 overflow-hidden">
          <div className="flex items-center gap-1 min-w-0">
            <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold whitespace-nowrap ${kindBadgeClass}`}>
              {kindBadgeText}
            </span>
            {showWeightSumBadge && incomingWeightSummary && (
              <span
                title={
                  incomingWeightSummary.isBalanced
                    ? '权重和校验通过 (1.00)'
                    : '入边权重和不等于 1.00'
                }
                className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold whitespace-nowrap tabular-nums ${
                  incomingWeightSummary.isBalanced
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                    : incomingWeightSummary.sum === 0 || incomingWeightSummary.sum > 1.0001
                      ? 'border-rose-500/60 bg-rose-500/20 text-rose-300'
                      : 'border-amber-500/60 bg-amber-500/20 text-amber-300'
                }`}
              >
                Σw={incomingWeightSummary.sum.toFixed(2)}
              </span>
            )}
          </div>

          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${statusStyle.pillClass}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dotClass}`} />
            <span>{statusStyle.label}</span>
          </span>
        </div>

        {/* 核心数据载荷摘要 */}
        <div className="my-0.5">{renderPayloadBlock()}</div>
      </div>

      {/* 卡片底部工具栏：折叠摘要 / 耗时缓存 / 下钻溯源 */}
      <div className="flex h-[28px] shrink-0 items-center justify-between gap-2 rounded-b-xl border-t border-[#30363d]/70 bg-[#0d1117]/75 px-2.5 text-[10px]">
        <div className="flex min-w-0 items-center gap-1.5 text-slate-400">
          {node.collapsed ? (
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse?.(node.id, false);
              }}
              className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-amber-200 hover:bg-amber-500/25 transition cursor-pointer"
              title="点击展开已折叠子节点"
            >
              <span>
                已折叠{collapsedDescendantCount > 0 ? ` ${collapsedDescendantCount} 节点` : '子图'}
              </span>
            </button>
          ) : (
            <>
              {typeof node.depth === 'number' && (
                <span className="rounded bg-[#161b22] border border-[#30363d] px-1 py-0.5 font-mono text-[9px] text-slate-400">
                  L{node.depth}
                </span>
              )}
              {node.summary?.latencyMs !== undefined && (
                <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-slate-400 tabular-nums">
                  <Zap className="h-2.5 w-2.5 text-amber-400" />
                  {node.summary.latencyMs.toFixed(1)}ms
                </span>
              )}
              {node.summary?.cacheHit && (
                <span className="rounded bg-emerald-500/10 border border-emerald-500/30 px-1 font-mono text-[9px] text-emerald-300">
                  CACHE
                </span>
              )}
              {node.summary?.latencyMs === undefined && !node.summary?.cacheHit && node.groupId && (
                <span className="truncate font-mono text-[9px] text-slate-500" title={node.groupId}>
                  {node.groupId}
                </span>
              )}
            </>
          )}
        </div>

        {showDrillDown && (
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDrillDown?.(node.id);
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-[#30363d] bg-[#161b22] px-1.5 py-0.5 text-[10px] font-medium text-slate-200 transition hover:border-cyan-400/60 hover:bg-cyan-500/15 hover:text-cyan-200 cursor-pointer"
            title={node.drillDownLabel || '穿透下钻至上游实证依据'}
          >
            <ArrowDownRight className="h-3 w-3 text-cyan-400" />
            <span>{node.drillDownLabel || '下钻溯源'}</span>
          </button>
        )}
      </div>

      {/* 右侧输出端口 */}
      {hasOutputPort && !readOnly && (
        <div
          title="输出端口：拖拽连线至下游节点"
          className={`group/outport absolute -right-3 top-1/2 -translate-y-1/2 z-20 cursor-crosshair p-1 transition-opacity duration-150 ${
            isConnectSource || isConnecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          onMouseDown={(e) => {
            e.stopPropagation();
            onStartConnect(node.id, e);
          }}
        >
          <div
            className={`flex h-4 w-4 items-center justify-center rounded-full border-2 bg-[#0d1117] shadow-md transition ${
              isConnectSource
                ? `scale-125 ${isoMeta.portActiveClass}`
                : 'border-[#30363d] group-hover/outport:scale-125 group-hover/outport:border-slate-300'
            }`}
          >
            <div className="h-1.5 w-1.5 rounded-full bg-slate-200" />
          </div>
        </div>
      )}
    </div>
  );
}
