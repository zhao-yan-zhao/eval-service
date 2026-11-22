import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Award,
  BookOpen,
  Boxes,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Database,
  FileCode,
  Folder,
  Layers,
  Network,
  Percent,
  Sliders,
  Target,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  AggregationStrategy,
  IndicatorDefinition,
  IndicatorSystem,
  MetricAtomMeta,
  NodeAggregationConfig,
  NodeMissingPolicy,
  ScoringRule,
} from '../../../core/types.ts';
import { validateFormula } from '../../../operators/formula-engine.ts';
import { generateEquivalentFormula } from '../../../systems/formula-codegen.ts';
import {
  flattenSystemTree,
  isDimensionNode,
  type FlatTreeNode,
} from './tree-walker.ts';

export interface NodeConfigPatch {
  name?: string;
  nodeCode?: string;
  aggregation?: NodeAggregationConfig;
}

export interface SystemNodeDetailPanelProps {
  node: FlatTreeNode | null;
  system: IndicatorSystem;
  indicatorMap?: Map<string, IndicatorDefinition>;
  operators?: MetricAtomMeta[];
  operatorMap?: Map<string, MetricAtomMeta>;
  evalScores?: Record<string, number>;
  onClose?: () => void;
  onSelectNode?: (node: FlatTreeNode) => void;
  onUpdateWeight?: (nodeId: string, newWeight: number) => void;
  onUpdateNodeConfig?: (nodeId: string, patch: NodeConfigPatch) => void;
  onNavigateToTab?: (tab: 'operators' | 'indicators', targetId?: string) => void;
  className?: string;
}

export function SystemNodeDetailPanel({
  node,
  system,
  indicatorMap,
  operators,
  operatorMap,
  evalScores,
  onClose,
  onSelectNode,
  onUpdateWeight,
  onUpdateNodeConfig,
  onNavigateToTab,
  className = '',
}: SystemNodeDetailPanelProps) {
  const [confirmSwitchVisual, setConfirmSwitchVisual] = useState(false);

  useEffect(() => {
    setConfirmSwitchVisual(false);
  }, [node?.id]);
  // 建立算子查找 Map
  const opMap = useMemo(() => {
    if (operatorMap) return operatorMap;
    const map = new Map<string, MetricAtomMeta>();
    if (operators) {
      for (const op of operators) {
        map.set(op.id, op);
      }
    }
    return map;
  }, [operatorMap, operators]);

  // 所有扁平化节点以便面包屑寻址
  const flatNodes = useMemo(() => {
    return flattenSystemTree(system, indicatorMap, evalScores);
  }, [system, indicatorMap, evalScores]);

  const flatNodeMap = useMemo(() => {
    const map = new Map<string, FlatTreeNode>();
    for (const n of flatNodes) {
      map.set(n.id, n);
    }
    return map;
  }, [flatNodes]);

  const isRoot = node?.kind === 'root';
  const isDim = node?.kind === 'dimension';
  const isLeaf = node?.kind === 'leaf';

  // 维度节点的孩子列表
  const childNodes: FlatTreeNode[] = useMemo(() => {
    if (!node || (!isRoot && !isDim)) return [];
    return flatNodes.filter(
      (n) => n.path.length === node.path.length + 1 && n.path[node.depth] === node.id,
    );
  }, [flatNodes, isRoot, isDim, node]);

  // 面包屑路径
  const breadcrumbNodes = useMemo(() => {
    if (!node) return [];
    return node.path
      .map((id) => flatNodeMap.get(id))
      .filter((n): n is FlatTreeNode => Boolean(n));
  }, [node, flatNodeMap]);

  // 当没有选中节点时的空态占位
  if (!node) {
    return (
      <div
        className={`flex flex-col items-center justify-center p-8 text-center bg-[#161b22] border border-[#2a313c] rounded-lg text-gray-400 min-h-[380px] ${className}`}
      >
        <div className="p-3 mb-3 rounded-full bg-[#21262d] text-gray-500">
          <Layers className="w-8 h-8" />
        </div>
        <h3 className="text-sm font-semibold text-gray-200 mb-1">
          未选择任何节点
        </h3>
        <p className="text-xs text-gray-500 max-w-[240px]">
          请在左侧体系层级树或全景拓扑图中点击任意节点，查看详细的权重分配、指标定义与底层算子数据源契约。
        </p>
      </div>
    );
  }

  const origNode = node.originalNode as any;

  // 绑定指标定义
  const indicatorDef = node.indicatorRef
    ? indicatorMap?.get(node.indicatorRef)
    : undefined;

  // 底层实证算子元数据
  const atomId = node.atomRef || indicatorDef?.atomRef;
  const operatorMeta = atomId ? opMap.get(atomId) : undefined;

  // 评分规则
  const scoringRule: ScoringRule | undefined = indicatorDef?.scoring;

  // 评估得分等级与赋色
  const score = node.score;
  let scoreColorClass = 'text-gray-300';
  let scoreBadgeClass = 'bg-gray-800 text-gray-300 border-gray-700';
  let scoreLabel = '暂未评分';
  if (typeof score === 'number') {
    if (score >= 80) {
      scoreColorClass = 'text-emerald-400';
      scoreBadgeClass = 'bg-emerald-950/80 text-emerald-300 border-emerald-600/60';
      scoreLabel = '优 (>= 80)';
    } else if (score >= 60) {
      scoreColorClass = 'text-amber-400';
      scoreBadgeClass = 'bg-amber-950/80 text-amber-300 border-amber-600/60';
      scoreLabel = '良/中 (60 - 79)';
    } else {
      scoreColorClass = 'text-rose-400';
      scoreBadgeClass = 'bg-rose-950/80 text-rose-300 border-rose-600/60';
      scoreLabel = '未达标 (< 60)';
    }
  }

  return (
    <div
      className={`flex flex-col bg-[#161b22] border border-[#2a313c] rounded-lg overflow-hidden text-[#e6edf3] ${className}`}
    >
      {/* 头部：类型标识、节点名、关闭按键 */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#0f141a] border-b border-[#2a313c]">
        <div className="flex items-center gap-2 min-w-0">
          {isRoot && <Network className="w-4 h-4 text-blue-400 shrink-0" />}
          {isDim && <Folder className="w-4 h-4 text-amber-400 shrink-0" />}
          {isLeaf && <Target className="w-4 h-4 text-emerald-400 shrink-0" />}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-gray-200 truncate">
                {node.name}
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#21262d] text-gray-400 border border-[#30363d] shrink-0">
                {isRoot ? '根节点' : isDim ? '评估维度' : '叶子指标'}
              </span>
            </div>
            <div className="text-[11px] font-mono text-gray-500 truncate">
              ID: {node.id}
            </div>
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-200 rounded hover:bg-[#21262d] transition-colors"
            title="关闭面板"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 面包屑导航 */}
      {breadcrumbNodes.length > 1 && (
        <div className="flex items-center gap-1 px-3.5 py-1.5 bg-[#0d1117] border-b border-[#21262d] text-[11px] text-gray-400 overflow-x-auto">
          {breadcrumbNodes.map((bNode, idx) => {
            const isLast = idx === breadcrumbNodes.length - 1;
            return (
              <div key={bNode.id} className="flex items-center gap-1 shrink-0">
                {idx > 0 && <ChevronRight className="w-3 h-3 text-gray-600" />}
                <button
                  type="button"
                  disabled={isLast}
                  onClick={() => onSelectNode?.(bNode)}
                  className={`truncate max-w-[120px] transition-colors ${
                    isLast
                      ? 'text-gray-200 font-medium cursor-default'
                      : 'hover:text-blue-400 cursor-pointer text-gray-400'
                  }`}
                  title={bNode.name}
                >
                  {bNode.name}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* 主体可滚动区域 */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        {/* 1. 权重配置卡片 */}
        <section className="bg-[#0f141a] border border-[#2a313c] rounded-md p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-300">
              <Percent className="w-3.5 h-3.5 text-blue-400" />
              <span>权重与贡献配置</span>
            </span>
            <span className="text-[10px] text-gray-500 font-mono">
              Depth L{node.depth}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-[#161b22] border border-[#21262d] rounded p-2">
              <div className="text-gray-400 text-[11px]">本级局部权重</div>
              <div className="text-base font-bold font-mono text-blue-400 mt-0.5">
                {node.localWeight.toFixed(4)} ({(node.localWeight * 100).toFixed(1)}%)
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">
                同级子项分配占比
              </div>
            </div>

            <div className="bg-[#161b22] border border-[#21262d] rounded p-2">
              <div className="text-gray-400 text-[11px]">全局级联贡献</div>
              <div className="text-base font-bold font-mono text-emerald-400 mt-0.5">
                {node.globalWeight.toFixed(4)} ({(node.globalWeight * 100).toFixed(1)}%)
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">
                在体系总分的绝对占比
              </div>
            </div>
          </div>

          {/* 权重比例条与就地微调滑块 */}
          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between items-center text-[11px] text-gray-400">
              <span className="flex items-center gap-1">
                <span>就地权重微调</span>
                {onUpdateWeight && !isRoot && (
                  <span className="text-[10px] text-blue-400 font-mono">(可拖动或输入)</span>
                )}
              </span>
              <div className="flex items-center gap-1 font-mono">
                {onUpdateWeight && !isRoot ? (
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="1.00"
                    value={node.localWeight}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v > 0) onUpdateWeight(node.id, Math.min(1, Math.max(0.01, v)));
                    }}
                    className="w-16 px-1.5 py-0.5 bg-[#0d1117] border border-[#30363d] rounded text-right text-xs text-blue-300 focus:outline-none focus:border-blue-500"
                  />
                ) : (
                  <span>{(node.localWeight * 100).toFixed(1)}%</span>
                )}
              </div>
            </div>
            {onUpdateWeight && !isRoot ? (
              <input
                type="range"
                min="0.01"
                max="1.00"
                step="0.01"
                value={node.localWeight}
                onChange={(e) => onUpdateWeight(node.id, parseFloat(e.target.value))}
                className="w-full accent-blue-500 h-1.5 bg-[#21262d] rounded-lg cursor-pointer"
              />
            ) : (
              <div className="w-full h-1.5 bg-[#21262d] rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{
                    width: `${Math.min(100, Math.max(2, node.localWeight * 100))}%`,
                  }}
                />
              </div>
            )}
          </div>

          {/* 维度/根节点权重总和状态 */}
          {(isRoot || isDim) && (() => {
            const aggMode = origNode?.aggregation?.mode === 'formula' ? 'formula' : 'visual';
            const aggStrat = origNode?.aggregation?.strategy || 'weighted_sum';
            const needsSum1 = aggMode !== 'formula' && (aggStrat === 'weighted_sum' || aggStrat === 'weighted_product' || aggStrat === 'geometric_mean');
            if (!needsSum1) return null;
            return (
              <div
                className={`flex items-center justify-between p-2 rounded text-xs border ${
                  node.weightSumValid
                    ? 'bg-emerald-950/30 text-emerald-300 border-emerald-800/40'
                    : 'bg-amber-950/40 text-amber-300 border-amber-600/50'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {node.weightSumValid ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  )}
                  <span>
                    {node.weightSumValid
                      ? `下级权重和正常 (${node.childrenCount} 个子项 = 100%)`
                      : `下级权重异常: 当前合计 ${(node.weightSum * 100).toFixed(1)}% ≠ 100%`}
                  </span>
                </div>
              </div>
            );
          })()}

          {/* 节点标识码 (nodeCode) 与名称编辑 */}
          {onUpdateNodeConfig && (
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#21262d] text-xs">
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">节点名称</label>
                <input
                  type="text"
                  value={origNode?.name || node.name}
                  onChange={(e) => onUpdateNodeConfig(node.id, { name: e.target.value })}
                  className="w-full px-2 py-1 bg-[#0d1117] border border-[#30363d] rounded text-xs text-gray-200 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-400 block mb-1">
                  变量标识码 (nodeCode)
                </label>
                <input
                  type="text"
                  value={origNode?.nodeCode ?? ''}
                  placeholder="如 dim_strike"
                  onChange={(e) => {
                    const cleanCode = e.target.value.replace(/[^A-Za-z0-9_]/g, '');
                    onUpdateNodeConfig(node.id, { nodeCode: cleanCode || undefined });
                  }}
                  className="w-full px-2 py-1 bg-[#0d1117] border border-[#30363d] rounded font-mono text-xs text-purple-300 focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>
          )}
        </section>

        {/* 多策略聚合与双模算法配置 */}
        {(isRoot || isDim) && (() => {
          const currentAgg: NodeAggregationConfig = origNode?.aggregation ?? {
            mode: 'visual',
            strategy: 'weighted_sum',
            missingPolicy: 'skip_renormalize',
          };
          const currentMode = currentAgg.mode === 'formula' ? 'formula' : 'visual';
          const currentStrategy: AggregationStrategy =
            currentAgg.strategy && currentAgg.strategy !== 'formula' ? currentAgg.strategy : 'weighted_sum';
          const currentMissing: NodeMissingPolicy = currentAgg.missingPolicy || 'skip_renormalize';
          const directChildItems = childNodes.map((ch) => ({
            id: ch.id,
            nodeCode: (ch.originalNode as any)?.nodeCode as string | undefined,
            weight: ch.localWeight,
          }));
          const equivFormula = generateEquivalentFormula(currentStrategy, directChildItems);
          const directChildCodes = directChildItems
            .map((c) => c.nodeCode)
            .filter((x): x is string => Boolean(x && x.trim()));
          const missingChildCodes = directChildItems.some((c) => !c.nodeCode || !c.nodeCode.trim());
          const formulaCheck =
            currentMode === 'formula'
              ? currentAgg.customFormula?.trim()
                ? validateFormula(currentAgg.customFormula, directChildCodes)
                : { valid: false, errors: ['自定义公式不能为空'] }
              : null;

          const updateAgg = (patch: Partial<NodeAggregationConfig>) => {
            onUpdateNodeConfig?.(node.id, {
              aggregation: {
                ...currentAgg,
                ...patch,
              },
            });
          };

          return (
            <section className="bg-[#0f141a] border border-[#2a313c] rounded-md p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-300">
                  <Cpu className="w-3.5 h-3.5 text-purple-400" />
                  <span>聚合策略与算法模式</span>
                </span>
                {origNode?.nodeCode && (
                  <span className="font-mono text-[10px] text-purple-300 bg-purple-950/40 border border-purple-800/50 px-1.5 py-0.5 rounded">
                    code: {origNode.nodeCode}
                  </span>
                )}
              </div>

              {/* 双模状态机切换 */}
              {onUpdateNodeConfig && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (currentMode === 'formula') {
                        setConfirmSwitchVisual(true);
                      }
                    }}
                    className={`flex-1 py-1.5 px-2 rounded text-xs font-medium border transition ${
                      currentMode === 'visual'
                        ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                        : 'border-[#30363d] bg-[#161b22] text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    可视化策略向导
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmSwitchVisual(false);
                      if (currentMode !== 'formula') {
                        updateAgg({
                          mode: 'formula',
                          strategy: 'formula',
                          customFormula: currentAgg.customFormula?.trim() || equivFormula || '',
                        });
                      }
                    }}
                    className={`flex-1 py-1.5 px-2 rounded text-xs font-medium border transition ${
                      currentMode === 'formula'
                        ? 'border-purple-500 bg-purple-500/20 text-purple-300'
                        : 'border-[#30363d] bg-[#161b22] text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    自定义 AST 公式
                  </button>
                </div>
              )}

              {/* 切回向导确认条 */}
              {confirmSwitchVisual && currentMode === 'formula' && (
                <div className="rounded border border-amber-500/50 bg-amber-950/30 p-2 text-xs text-amber-200 space-y-2">
                  <div>切回「可视化策略向导」后，系统将由向导策略重新生成等效计算规则，自定义公式将不再作为主导表达式。确认切换？</div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmSwitchVisual(false)}
                      className="px-2 py-0.5 rounded border border-[#30363d] bg-[#161b22] text-gray-300"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmSwitchVisual(false);
                        updateAgg({
                          mode: 'visual',
                          strategy: currentStrategy,
                        });
                      }}
                      className="px-2 py-0.5 rounded bg-amber-600 text-white hover:bg-amber-500"
                    >
                      确认切回向导
                    </button>
                  </div>
                </div>
              )}

              {/* 公式态提示 */}
              {currentMode === 'formula' && (
                <div className="rounded border border-purple-500/40 bg-purple-950/25 px-2.5 py-1.5 text-[11px] text-purple-300">
                  当前由自定义公式接管，上方可视化向导已锁定；切回向导将覆盖公式行为。
                </div>
              )}

              {/* 可视化策略向导区（公式模式下灰化锁定） */}
              <div
                className={`space-y-2 text-xs transition-opacity ${
                  currentMode === 'formula' ? 'opacity-50 pointer-events-none select-none' : ''
                }`}
              >
                <div>
                  <span className="text-gray-400 text-[11px] block mb-1">聚合策略 (Visual Strategy):</span>
                  {onUpdateNodeConfig ? (
                    <select
                      value={currentStrategy}
                      onChange={(e) =>
                        updateAgg({
                          mode: 'visual',
                          strategy: e.target.value as AggregationStrategy,
                        })
                      }
                      className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs text-purple-200"
                    >
                      <option value="weighted_sum">weighted_sum — 加权求和（线性补偿）</option>
                      <option value="weighted_product">weighted_product — 加权乘积（协同短板）</option>
                      <option value="geometric_mean">geometric_mean — 加权几何平均</option>
                      <option value="maximin">maximin — 木桶最弱项（取最低短板）</option>
                      <option value="max">max — 最优择优（冗余择优）</option>
                      <option value="mean">mean — 等权算术平均</option>
                    </select>
                  ) : (
                    <span className="font-medium text-purple-300">{currentStrategy}</span>
                  )}
                </div>

                <div>
                  <span className="text-gray-400 text-[11px] block mb-1">缺失值处理策略 (Missing Policy):</span>
                  {onUpdateNodeConfig ? (
                    <select
                      value={currentMissing}
                      onChange={(e) =>
                        updateAgg({
                          missingPolicy: e.target.value as NodeMissingPolicy,
                        })
                      }
                      className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs text-gray-200"
                    >
                      <option value="skip_renormalize">skip_renormalize — 剔除缺失并自动重归一</option>
                      <option value="fail">fail — 严格熔断不可用 (Fail-Closed)</option>
                      <option value="worst">worst — 按 0 分惩罚计入</option>
                      <option value="neutral">neutral — 按 50 分中性计入</option>
                    </select>
                  ) : (
                    <span className="text-gray-300">{currentMissing}</span>
                  )}
                </div>

                {currentMode === 'visual' && equivFormula && (
                  <div className="pt-1">
                    <span className="text-gray-400 text-[11px] block mb-1">自动生成等效公式只读预览:</span>
                    <div className="rounded bg-[#161b22] border border-[#30363d] p-2 font-mono text-[11px] text-cyan-300/90 break-all">
                      {equivFormula}
                    </div>
                  </div>
                )}
              </div>

              {/* 自定义 AST 公式编辑区 */}
              {currentMode === 'formula' && (
                <div className="space-y-2 pt-2 border-t border-[#21262d]">
                  <div className="flex items-center justify-between">
                    <span className="text-purple-300 text-[11px] font-medium">自定义 LibFormula AST 表达式</span>
                    {formulaCheck && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${
                          formulaCheck.valid
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                            : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                        }`}
                      >
                        {formulaCheck.valid ? 'AST 语法通过' : formulaCheck.errors[0]}
                      </span>
                    )}
                  </div>

                  {missingChildCodes && (
                    <div className="rounded border border-amber-500/40 bg-amber-950/20 px-2 py-1 text-[10px] text-amber-300">
                      提示：部分直接子节点尚未设置 nodeCode，请点击子节点并配置变量标识码后再引用。
                    </div>
                  )}

                  {directChildCodes.length > 0 && onUpdateNodeConfig && (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[10px] text-gray-400">快捷插入变量:</span>
                      {directChildCodes.map((code) => (
                        <button
                          key={code}
                          type="button"
                          onClick={() =>
                            updateAgg({
                              customFormula: `${currentAgg.customFormula || ''}${
                                currentAgg.customFormula && !currentAgg.customFormula.endsWith(' ') ? ' ' : ''
                              }${code}`,
                            })
                          }
                          className="rounded border border-purple-500/40 bg-purple-500/15 px-1.5 py-0.5 font-mono text-[10px] text-purple-200 hover:bg-purple-500/30"
                        >
                          +{code}
                        </button>
                      ))}
                    </div>
                  )}

                  {onUpdateNodeConfig ? (
                    <textarea
                      rows={3}
                      value={currentAgg.customFormula ?? ''}
                      onChange={(e) =>
                        updateAgg({
                          mode: 'formula',
                          strategy: 'formula',
                          customFormula: e.target.value,
                        })
                      }
                      placeholder="输入表达式，如: IF(dim_roe < 80, MIN(dim_roe, 60), 0.5 * dim_a + 0.5 * dim_b)"
                      className="w-full rounded bg-[#161b22] border border-purple-500/40 p-2 font-mono text-purple-200 text-xs focus:outline-none focus:border-purple-400"
                    />
                  ) : (
                    <div className="rounded bg-[#161b22] border border-purple-500/30 p-2 font-mono text-purple-200 text-xs break-all">
                      {currentAgg.customFormula}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })()}

        {/* 2. 评估得分展示卡片 */}
        <section className="bg-[#0f141a] border border-[#2a313c] rounded-md p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-300">
              <Award className="w-3.5 h-3.5 text-yellow-400" />
              <span>推演评估得分</span>
            </span>
            {typeof score === 'number' && (
              <span className={`text-[10px] px-1.5 py-0.2 rounded border ${scoreBadgeClass}`}>
                {scoreLabel}
              </span>
            )}
          </div>

          {typeof score === 'number' ? (
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold font-mono ${scoreColorClass}`}>
                {score.toFixed(1)}
              </span>
              <span className="text-xs text-gray-400">/ 100 分</span>
            </div>
          ) : (
            <div className="text-xs text-gray-500 py-1">
              暂未关联推演执行得分（可在总览中运行推演评测计算得分）
            </div>
          )}
        </section>

        {/* 3. 维度子节点分布列表（仅对根节点与维度节点可见） */}
        {(isRoot || isDim) && (
          <section className="bg-[#0f141a] border border-[#2a313c] rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-300">
                <Boxes className="w-3.5 h-3.5 text-amber-400" />
                <span>下级直接分支 ({childNodes.length})</span>
              </span>
            </div>

            {childNodes.length === 0 ? (
              <div className="text-xs text-gray-500 py-1">当前节点暂无子节点</div>
            ) : (
              <div className="divide-y divide-[#21262d] max-h-48 overflow-y-auto">
                {childNodes.map((child) => (
                  <div
                    key={child.id}
                    onClick={() => onSelectNode?.(child)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onSelectNode?.(child);
                    }}
                    className="flex items-center justify-between py-1.5 px-1 hover:bg-[#21262d] rounded cursor-pointer transition-colors text-xs"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      {child.kind === 'dimension' ? (
                        <Folder className="w-3 h-3 text-amber-400 shrink-0" />
                      ) : (
                        <Target className="w-3 h-3 text-emerald-400 shrink-0" />
                      )}
                      <span className="truncate text-gray-200">{child.name}</span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-gray-400 text-[11px]">
                        {(child.localWeight * 100).toFixed(0)}%
                      </span>
                      {typeof child.score === 'number' && (
                        <span className="font-mono text-emerald-400 text-[11px]">
                          {child.score.toFixed(1)}分
                        </span>
                      )}
                      <ArrowRight className="w-3 h-3 text-gray-500" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* 4. 叶子指标详细契约（仅对叶子节点展示） */}
        {isLeaf && (
          <>
            {/* 4.1 指标定义 */}
            <section className="bg-[#0f141a] border border-[#2a313c] rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-300">
                  <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                  <span>标准指标定义</span>
                </span>
                <div className="flex items-center gap-2">
                  {indicatorDef?.builtin && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-950 text-blue-300 border border-blue-800">
                      内置指标
                    </span>
                  )}
                  {onNavigateToTab && node.indicatorRef && (
                    <button
                      type="button"
                      onClick={() => onNavigateToTab('indicators', node.indicatorRef)}
                      className="text-[11px] text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-0.5"
                      title="直达指标配置工作台查看或编辑此指标评分规则"
                    >
                      编辑指标 ↗
                    </button>
                  )}
                </div>
              </div>

              <div className="text-xs space-y-1.5">
                <div>
                  <span className="text-gray-400">指标标识：</span>
                  <span className="font-mono text-indigo-300">
                    {node.indicatorRef}
                  </span>
                  {indicatorDef?.targetField && (
                    <span className="ml-2 font-mono text-cyan-300 text-[11px]">
                      #{indicatorDef.targetField}
                    </span>
                  )}
                  {indicatorDef?.unit && (
                    <span className="ml-1.5 text-slate-400 font-mono text-[11px]">
                      [{indicatorDef.unit}]
                    </span>
                  )}
                  {indicatorDef?.filterCriteria?.Side && (
                    <span className="ml-2 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 px-1 py-0.2 text-[9px] font-mono">
                      Side: {String(indicatorDef.filterCriteria.Side)}
                    </span>
                  )}
                </div>
                {origNode?.nodeCode && (
                  <div>
                    <span className="text-gray-400">节点标识码：</span>
                    <span className="font-mono text-purple-300">
                      {origNode.nodeCode}
                    </span>
                    <span className="ml-1.5 text-gray-500 text-[10px]">(可被父节点公式直接引用)</span>
                  </div>
                )}
                {indicatorDef?.bindingMode === 'composite' && (
                  <div className="mt-2 p-2 rounded bg-purple-950/20 border border-purple-800/40 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-purple-300 font-semibold text-xs">
                      <span>多算子复合指标</span>
                      <span className="text-[10px] text-purple-400 font-normal">
                        ({indicatorDef.sources?.length ?? 0} 个输入源)
                      </span>
                    </div>
                    {indicatorDef.composeFormula && (
                      <div>
                        <span className="text-gray-400 text-[11px]">复合公式：</span>
                        <code className="text-purple-200 font-mono text-xs bg-[#161b22] px-1.5 py-0.5 rounded">
                          {indicatorDef.composeFormula}
                        </code>
                      </div>
                    )}
                    {indicatorDef.sources && indicatorDef.sources.length > 0 && (
                      <div className="space-y-1 pt-1">
                        <span className="text-gray-400 text-[11px] block">输入源列表：</span>
                        {indicatorDef.sources.map((s, idx) => (
                          <div key={idx} className="text-[11px] font-mono text-gray-300 flex items-center gap-2 bg-[#161b22] p-1 rounded">
                            <span className="text-purple-400">{s.alias}</span>
                            <span className="text-gray-500">←</span>
                            <span className="text-blue-300">{s.atomRef}</span>
                            {s.targetField && <span className="text-cyan-300">#{s.targetField}</span>}
                            <span className="text-gray-500">[{s.reduce || 'mean'}]</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {indicatorDef?.description && (
                  <div>
                    <span className="text-gray-400">描述：</span>
                    <span className="text-gray-300">
                      {indicatorDef.description}
                    </span>
                  </div>
                )}
                {indicatorDef?.tags && indicatorDef.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {indicatorDef.tags.map((t) => (
                      <span
                        key={t}
                        className="text-[10px] px-1.5 py-0.2 bg-[#21262d] text-gray-400 rounded border border-[#30363d]"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* 4.2 评分卡口规则 */}
            <section className="bg-[#0f141a] border border-[#2a313c] rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-300">
                  <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                  <span>评分卡口 (Scoring Rule)</span>
                </span>
                {scoringRule && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#21262d] text-emerald-400 border border-[#30363d] font-mono">
                    {scoringRule.type}
                  </span>
                )}
              </div>

              {scoringRule ? (
                <div className="text-xs space-y-1.5 bg-[#161b22] p-2 rounded border border-[#21262d]">
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    {scoringRule.bounds && (
                      <div>
                        <span className="text-gray-500">数值区间 [min, max]:</span>
                        <div className="font-mono text-gray-300">
                          [{scoringRule.bounds[0]}, {scoringRule.bounds[1]}]
                        </div>
                      </div>
                    )}
                    {typeof scoringRule.optimal === 'number' && (
                      <div>
                        <span className="text-gray-500">最优值 (Optimal):</span>
                        <div className="font-mono text-emerald-400 font-semibold">
                          {scoringRule.optimal}
                        </div>
                      </div>
                    )}
                    {typeof scoringRule.worst === 'number' && (
                      <div>
                        <span className="text-gray-500">最劣值 (Worst):</span>
                        <div className="font-mono text-rose-400 font-semibold">
                          {scoringRule.worst}
                        </div>
                      </div>
                    )}
                    {scoringRule.scoreRange && (
                      <div>
                        <span className="text-gray-500">得分范围:</span>
                        <div className="font-mono text-gray-300">
                          [{scoringRule.scoreRange[0]}, {scoringRule.scoreRange[1]}]
                        </div>
                      </div>
                    )}
                    {scoringRule.type === 'target_range' && (
                      <>
                        {scoringRule.optimalRange && (
                          <div>
                            <span className="text-gray-500">最优满分区间 (100分):</span>
                            <div className="font-mono text-emerald-400 font-semibold">
                              [{scoringRule.optimalRange[0]}, {scoringRule.optimalRange[1]}]
                            </div>
                          </div>
                        )}
                        {scoringRule.toleranceRange && (
                          <div>
                            <span className="text-gray-500">容忍外延归零区间 (0分):</span>
                            <div className="font-mono text-amber-400 font-semibold">
                              [{scoringRule.toleranceRange[0]}, {scoringRule.toleranceRange[1]}]
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {scoringRule.steps && scoringRule.steps.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-[#2a313c]">
                      <div className="text-[11px] text-gray-400 mb-1">阶梯评分表：</div>
                      <div className="space-y-0.5">
                        {scoringRule.steps.map((st, idx) => (
                          <div
                            key={idx}
                            className="flex justify-between text-[10px] font-mono text-gray-300 bg-[#0d1117] px-1.5 py-0.5 rounded"
                          >
                            <span>阈值 &gt;= {st.val}</span>
                            <span className="text-emerald-400">{st.score} 分</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {indicatorDef?.alarmThreshold && (
                    <div className="mt-2 pt-2 border-t border-[#2a313c] flex items-center gap-1.5 text-[11px] text-rose-300">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      <span>
                        告警阈值: {indicatorDef.alarmThreshold.operator}{' '}
                        {indicatorDef.alarmThreshold.value} (
                        {indicatorDef.alarmThreshold.severity})
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-gray-500">未定义显式评分规则</div>
              )}
            </section>

            {/* 4.3 底层实证算子与数据源字段映射 */}
            <section className="bg-[#0f141a] border border-[#2a313c] rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-300">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                  <span>底层实证算子元数据</span>
                </span>
                <div className="flex items-center gap-2">
                  {operatorMeta && (
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded border ${
                        operatorMeta.readiness === 'batch_a_ready'
                          ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800'
                          : 'bg-amber-950/70 text-amber-300 border-amber-800'
                      }`}
                    >
                      {operatorMeta.readiness}
                    </span>
                  )}
                  {onNavigateToTab && atomId && (
                    <button
                      type="button"
                      onClick={() => onNavigateToTab('operators', atomId)}
                      className="text-[11px] text-cyan-400 hover:text-cyan-300 hover:underline flex items-center gap-0.5"
                      title="直达算子库工作台调试或查看此算子公式"
                    >
                      调试算子 ↗
                    </button>
                  )}
                </div>
              </div>

              <div className="text-xs space-y-1.5">
                <div>
                  <span className="text-gray-400">算子标识：</span>
                  <span className="font-mono text-cyan-300">
                    {atomId || '未配置'}
                  </span>
                </div>
                {operatorMeta && (
                  <>
                    <div>
                      <span className="text-gray-400">算子名称：</span>
                      <span className="text-gray-200">{operatorMeta.name}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] bg-[#161b22] p-2 rounded border border-[#21262d]">
                      <div>
                        <span className="text-gray-500">分类：</span>
                        <div className="font-mono text-gray-300">
                          {operatorMeta.category}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500">输出类型：</span>
                        <div className="font-mono text-gray-300">
                          {operatorMeta.outputType}
                          {operatorMeta.unit ? ` (${operatorMeta.unit})` : ''}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500">优化趋向：</span>
                        <div className="font-mono text-gray-300">
                          {operatorMeta.defaultOptimalDirection}
                        </div>
                      </div>
                      <div>
                        <span className="text-gray-500">数据源类型：</span>
                        <div className="font-mono text-gray-300">
                          {operatorMeta.requiredDataSources?.join(', ') || '通用'}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* 实证字段契约 (F1 Field Contract) */}
              {operatorMeta?.f1FieldContract && (
                <div className="mt-3 pt-2 border-t border-[#2a313c] space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-300">
                    <Database className="w-3.5 h-3.5 text-purple-400" />
                    <span>实证底层数据源契约 (sim-output-fields)</span>
                  </div>

                  {operatorMeta.f1FieldContract.csvTables &&
                    operatorMeta.f1FieldContract.csvTables.length > 0 && (
                      <div className="text-[11px] bg-[#161b22] p-2 rounded border border-[#21262d] space-y-1">
                        <div className="text-gray-400">依赖 CSV 数据表：</div>
                        <div className="flex flex-wrap gap-1">
                          {operatorMeta.f1FieldContract.csvTables.map((tbl) => (
                            <span
                              key={tbl}
                              className="px-1.5 py-0.5 rounded bg-[#0d1117] text-purple-300 border border-[#30363d] font-mono text-[10px]"
                            >
                              {tbl}
                            </span>
                          ))}
                        </div>
                        {operatorMeta.f1FieldContract.csvColumns && (
                          <div className="text-[10px] text-gray-500 font-mono mt-1">
                            关键列:{' '}
                            {operatorMeta.f1FieldContract.csvColumns.join(', ')}
                          </div>
                        )}
                      </div>
                    )}

                  {operatorMeta.f1FieldContract.bsFramePaths &&
                    operatorMeta.f1FieldContract.bsFramePaths.length > 0 && (
                      <div className="text-[11px] bg-[#161b22] p-2 rounded border border-[#21262d] space-y-1">
                        <div className="text-gray-400">底层 BS 引擎帧路径：</div>
                        <div className="flex flex-wrap gap-1">
                          {operatorMeta.f1FieldContract.bsFramePaths.map((p) => (
                            <span
                              key={p}
                              className="px-1.5 py-0.5 rounded bg-[#0d1117] text-cyan-300 border border-[#30363d] font-mono text-[10px]"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                  {operatorMeta.f1FieldContract.discrepancyNotes &&
                    operatorMeta.f1FieldContract.discrepancyNotes.length > 0 && (
                      <div className="text-[10px] bg-amber-950/30 text-amber-300 border border-amber-800/40 p-2 rounded space-y-0.5">
                        <div className="font-semibold text-amber-400">
                          偏差处理规范 (Discrepancy Notes):
                        </div>
                        <ul className="list-disc list-inside space-y-0.5">
                          {operatorMeta.f1FieldContract.discrepancyNotes.map(
                            (note, i) => (
                              <li key={i}>{note}</li>
                            ),
                          )}
                        </ul>
                      </div>
                    )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
