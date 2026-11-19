import {
  AlertTriangle,
  Award,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Folder,
  FolderOpen,
  Layers,
  Network,
  Percent,
  Search,
  Target,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { IndicatorDefinition, IndicatorSystem } from '../../../core/types.ts';
import { flattenSystemTree, type FlatTreeNode } from './tree-walker.ts';

export interface SystemHierarchyTreeProps {
  system: IndicatorSystem;
  indicatorMap?: Map<string, IndicatorDefinition>;
  evalScores?: Record<string, number>;
  selectedNodeId?: string | null;
  onSelectNode?: (node: FlatTreeNode) => void;
  className?: string;
}

export function SystemHierarchyTree({
  system,
  indicatorMap,
  evalScores,
  selectedNodeId,
  onSelectNode,
  className = '',
}: SystemHierarchyTreeProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  // 展平体系树
  const flatNodes = useMemo(() => {
    return flattenSystemTree(system, indicatorMap, evalScores);
  }, [system, indicatorMap, evalScores]);

  // 汇总统计
  const summary = useMemo(() => {
    let dims = 0;
    let leaves = 0;
    for (const n of flatNodes) {
      if (n.kind === 'dimension') dims++;
      else if (n.kind === 'leaf') leaves++;
    }
    return { total: flatNodes.length, dims, leaves };
  }, [flatNodes]);

  // 折叠 / 展开单个节点
  const toggleCollapse = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  // 全部展开
  const handleExpandAll = () => {
    setCollapsedIds(new Set());
  };

  // 全部折叠 (折叠除根节点以外的所有维度节点)
  const handleCollapseAll = () => {
    const dimIds = flatNodes
      .filter((n) => n.kind === 'dimension' || n.kind === 'root')
      .map((n) => n.id);
    setCollapsedIds(new Set(dimIds));
  };

  // 搜索过滤与可见性判断
  const normalizedQuery = searchQuery.trim().toLowerCase();

  // 若处于搜索状态，找出所有匹配项及其路径上的所有父节点
  const matchedAncestorIds = useMemo(() => {
    if (!normalizedQuery) return null;
    const ids = new Set<string>();
    for (const node of flatNodes) {
      const matches =
        node.name.toLowerCase().includes(normalizedQuery) ||
        node.id.toLowerCase().includes(normalizedQuery) ||
        (node.indicatorRef && node.indicatorRef.toLowerCase().includes(normalizedQuery)) ||
        (node.atomRef && node.atomRef.toLowerCase().includes(normalizedQuery));
      if (matches) {
        for (const ancestorId of node.path) {
          ids.add(ancestorId);
        }
      }
    }
    return ids;
  }, [flatNodes, normalizedQuery]);

  // 节点最终可见性
  const visibleNodes = useMemo(() => {
    return flatNodes.filter((node) => {
      // 搜索模式下：仅展示匹配节点及其祖先节点
      if (matchedAncestorIds !== null) {
        return matchedAncestorIds.has(node.id);
      }

      // 非搜索模式下：若任一祖先节点处于折叠状态，则隐藏该节点
      for (let i = 0; i < node.path.length - 1; i++) {
        const ancestorId = node.path[i];
        if (collapsedIds.has(ancestorId)) {
          return false;
        }
      }
      return true;
    });
  }, [flatNodes, collapsedIds, matchedAncestorIds]);

  return (
    <div
      className={`flex flex-col h-full bg-[#161b22] border border-[#2a313c] rounded-lg overflow-hidden text-[#e6edf3] ${className}`}
    >
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#0f141a] border-b border-[#2a313c]">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-semibold tracking-wide text-gray-200">
            体系层级树
          </span>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#21262d] text-gray-400 border border-[#30363d]">
            {summary.dims} 维度 / {summary.leaves} 指标
          </span>
        </div>

        {/* 展开/折叠与搜索快捷操作 */}
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索节点/指标/算子..."
              className="w-40 sm:w-48 pl-7 pr-6 py-1 text-xs bg-[#0d1117] border border-[#30363d] rounded text-[#e6edf3] placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                title="清空搜索"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleExpandAll}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded text-gray-300 transition-colors"
            title="全部展开"
          >
            <ChevronsUpDown className="w-3.5 h-3.5 text-gray-400" />
            <span className="hidden sm:inline">全部展开</span>
          </button>

          <button
            type="button"
            onClick={handleCollapseAll}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded text-gray-300 transition-colors"
            title="全部折叠"
          >
            <ChevronsDownUp className="w-3.5 h-3.5 text-gray-400" />
            <span className="hidden sm:inline">全部折叠</span>
          </button>
        </div>
      </div>

      {/* 树节点列表 */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#21262d]/50 p-1">
        {visibleNodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500 text-xs">
            <Search className="w-8 h-8 mb-2 opacity-40" />
            <span>无匹配的指标或维度节点</span>
          </div>
        ) : (
          visibleNodes.map((node) => {
            const isSelected = selectedNodeId === node.id;
            const isCollapsed = collapsedIds.has(node.id);
            const hasChildren = node.childrenCount > 0;
            const isRoot = node.kind === 'root';
            const isDim = node.kind === 'dimension';
            const isLeaf = node.kind === 'leaf';

            // 深度缩进与缩进参考线
            const indentPadding = node.depth * 20;

            // 权重百分比
            const localWeightPct = (node.localWeight * 100).toFixed(1);
            const globalWeightPct = (node.globalWeight * 100).toFixed(1);
            const weightBarWidth = Math.min(100, Math.max(4, Math.round(node.localWeight * 100)));

            // 评估分数颜色判断
            let scoreBg = 'bg-gray-800 text-gray-300 border-gray-700';
            if (typeof node.score === 'number') {
              if (node.score >= 80) {
                scoreBg = 'bg-emerald-950/80 text-emerald-300 border-emerald-600/60';
              } else if (node.score >= 60) {
                scoreBg = 'bg-amber-950/80 text-amber-300 border-amber-600/60';
              } else {
                scoreBg = 'bg-rose-950/80 text-rose-300 border-rose-600/60';
              }
            }

            return (
              <div
                key={node.id}
                onClick={() => onSelectNode?.(node)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onSelectNode?.(node);
                  }
                }}
                className={`group flex items-center justify-between gap-3 px-2 py-1.5 rounded transition-all cursor-pointer select-none ${
                  isSelected
                    ? 'bg-blue-600/15 border border-blue-500/80 shadow-[0_0_12px_rgba(59,130,246,0.15)] ring-1 ring-blue-500/40'
                    : 'hover:bg-[#21262d]/60 border border-transparent'
                }`}
                style={{ paddingLeft: `${indentPadding + 8}px` }}
              >
                {/* 左侧：折叠箭头 + 节点图标 + 节点名称 + 层级标签 */}
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  {/* 折叠/展开按键 */}
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={(e) => toggleCollapse(node.id, e)}
                      className="p-0.5 text-gray-400 hover:text-white rounded hover:bg-[#30363d]/60 transition-colors"
                      title={isCollapsed ? '展开子项' : '折叠子项'}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                  ) : (
                    <span className="w-4 text-center text-gray-600 text-xs select-none">
                      •
                    </span>
                  )}

                  {/* 节点类型图标 */}
                  {isRoot && (
                    <span title="根节点" className="shrink-0 flex items-center">
                      <Network className="w-4 h-4 text-blue-400" />
                    </span>
                  )}
                  {isDim &&
                    (isCollapsed ? (
                      <span title="维度节点 (已折叠)" className="shrink-0 flex items-center">
                        <Folder className="w-4 h-4 text-amber-400" />
                      </span>
                    ) : (
                      <span title="维度节点 (已展开)" className="shrink-0 flex items-center">
                        <FolderOpen className="w-4 h-4 text-amber-400" />
                      </span>
                    ))}
                  {isLeaf && (
                    <span title="指标叶子节点" className="shrink-0 flex items-center">
                      <Target className="w-4 h-4 text-emerald-400" />
                    </span>
                  )}

                  {/* 节点名称与深度Badge */}
                  <span
                    className={`truncate text-xs ${
                      isRoot
                        ? 'text-blue-300 font-semibold'
                        : isDim
                        ? 'text-gray-100 font-medium'
                        : 'text-gray-200'
                    }`}
                    title={node.name}
                  >
                    {node.name}
                  </span>

                  {/* 关联指标 & 算子 Pill（低干扰精简徽标，悬停查看完整 ID） */}
                  {node.indicatorRef && (
                    <span
                      className="hidden 2xl:inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-indigo-950/50 text-indigo-300/80 border border-indigo-800/40 shrink-0 font-mono"
                      title={`绑定指标: ${node.indicatorRef}`}
                    >
                      {node.indicatorRef.replace(/^ind_/, '')}
                    </span>
                  )}
                  {node.atomRef && (
                    <span
                      className="hidden xl:inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-cyan-950/50 text-cyan-300/80 border border-cyan-800/40 shrink-0 font-mono"
                      title={`底层算子: ${node.atomRef}`}
                    >
                      {node.atomRef}
                    </span>
                  )}
                </div>

                {/* 右侧：权重进度条、权重数字、警告告警、得分Badge */}
                <div className="flex items-center gap-2.5 shrink-0">
                  {/* 权重比例条与百分比 */}
                  <div
                    className="flex items-center gap-1.5"
                    title={`本级权重: ${localWeightPct}% | 全局贡献: ${globalWeightPct}%`}
                  >
                    <div className="w-12 h-1.5 bg-[#21262d] rounded-full overflow-hidden hidden sm:block border border-[#30363d]/60">
                      <div
                        className={`h-full rounded-full ${
                          isRoot
                            ? 'bg-blue-500'
                            : isDim
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                        style={{ width: `${weightBarWidth}%` }}
                      />
                    </div>
                    <span className="text-[11px] tabular-nums font-mono text-gray-300 min-w-[42px] text-right">
                      {localWeightPct}%
                    </span>
                  </div>

                  {/* 权重和校验异常警告 Badge */}
                  {(isRoot || isDim) && !node.weightSumValid && (
                    <span
                      className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-600/60 font-mono animate-pulse"
                      title={`警告：该分支子项权重之和为 ${(node.weightSum * 100).toFixed(
                        1,
                      )}%，未满 100%`}
                    >
                      <AlertTriangle className="w-3 h-3 text-amber-400" />
                      <span>{(node.weightSum * 100).toFixed(0)}% ≠ 100%</span>
                    </span>
                  )}

                  {/* 评估得分展示 Badge */}
                  {typeof node.score === 'number' ? (
                    <span
                      className={`flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border font-mono font-semibold ${scoreBg}`}
                      title={`评估得分: ${node.score.toFixed(1)} 分`}
                    >
                      <Award className="w-3 h-3" />
                      <span>{node.score.toFixed(1)}</span>
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 底部小图例 */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#0f141a] border-t border-[#2a313c] text-[11px] text-gray-400">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Network className="w-3 h-3 text-blue-400" />
            <span>根节点</span>
          </span>
          <span className="flex items-center gap-1">
            <Folder className="w-3 h-3 text-amber-400" />
            <span>维度</span>
          </span>
          <span className="flex items-center gap-1">
            <Target className="w-3 h-3 text-emerald-400" />
            <span>指标</span>
          </span>
        </div>
        <span className="text-gray-500">点击行即可选中并在右侧查看详细契约</span>
      </div>
    </div>
  );
}
