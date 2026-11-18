import * as echarts from 'echarts';
import { ChevronsDown, ChevronsUp, Network, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { IndicatorDefinition, IndicatorSystem } from '../../../core/types.ts';
import {
  flattenSystemTree,
  isDimensionNode,
  type FlatTreeNode,
} from './tree-walker.ts';

export interface SystemTopologyChartProps {
  system: IndicatorSystem;
  indicatorMap?: Map<string, IndicatorDefinition>;
  evalScores?: Record<string, number>;
  selectedNodeId?: string | null;
  onSelectNode?: (node: FlatTreeNode) => void;
  height?: number | string;
  className?: string;
}

interface EChartsNodeData {
  id: string;
  name: string;
  kind: 'root' | 'dimension' | 'leaf';
  localWeight: number;
  globalWeight: number;
  score?: number | null;
  indicatorRef?: string;
  atomRef?: string;
  weightSumValid?: boolean;
  itemStyle?: Record<string, unknown>;
  symbol?: string;
  symbolSize?: number | [number, number];
  label?: Record<string, unknown>;
  children?: EChartsNodeData[];
}

export function SystemTopologyChart({
  system,
  indicatorMap,
  evalScores,
  selectedNodeId,
  onSelectNode,
  height = 540,
  className = '',
}: SystemTopologyChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [expandDepth, setExpandDepth] = useState<number>(-1); // -1 表示全部展开，1 表示仅展开第一层维度

  // 展平节点映射，方便根据 ID 快速唤起 onSelectNode
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

  // 构建 ECharts Tree 树状层级数据模型
  const chartTreeData = useMemo<EChartsNodeData | null>(() => {
    if (!system || !system.root) return null;

    const rootFlat = flatNodes.find((n) => n.kind === 'root');
    const rootId = rootFlat?.id || system.systemId || 'root';
    const isRootSelected = selectedNodeId === rootId;

    const rootScore = rootFlat?.score ?? null;

    function buildBranch(nodeId: string): EChartsNodeData[] {
      const parentFlat = flatNodeMap.get(nodeId);
      if (!parentFlat) return [];

      const origNode = parentFlat.originalNode;
      const children =
        'children' in origNode && Array.isArray(origNode.children)
          ? origNode.children
          : [];

      return children.map((child): EChartsNodeData => {
        if (isDimensionNode(child)) {
          const dimFlat = flatNodeMap.get(child.id);
          const isSelected = selectedNodeId === child.id;
          const score = dimFlat?.score ?? null;

          // 根据得分与选中态赋色
          let strokeColor = '#f59e0b'; // amber-500
          let fillColor = '#451a03'; // amber-950
          if (typeof score === 'number') {
            if (score >= 80) {
              strokeColor = '#10b981';
              fillColor = '#064e3b';
            } else if (score < 60) {
              strokeColor = '#f43f5e';
              fillColor = '#4c0519';
            }
          }

          if (isSelected) {
            strokeColor = '#38bdf8'; // sky-400
          }

          return {
            id: child.id,
            name: child.name,
            kind: 'dimension',
            localWeight: dimFlat?.localWeight ?? child.weight,
            globalWeight: dimFlat?.globalWeight ?? 0,
            score,
            weightSumValid: dimFlat?.weightSumValid ?? true,
            symbol: 'roundRect',
            symbolSize: [170, 36],
            itemStyle: {
              color: fillColor,
              borderColor: strokeColor,
              borderWidth: isSelected ? 3 : 1.5,
              shadowBlur: isSelected ? 12 : 3,
              shadowColor: isSelected ? 'rgba(56, 189, 248, 0.8)' : 'rgba(0, 0, 0, 0.4)',
              borderRadius: 6,
            },
            label: {
              position: 'inside',
              verticalAlign: 'middle',
              align: 'center',
              color: '#f3f4f6',
              fontSize: 11,
              fontWeight: 500,
            },
            children: buildBranch(child.id),
          };
        } else {
          // 叶子指标
          const leafId = child.id || child.indicatorRef;
          const leafFlat = flatNodeMap.get(leafId);
          const indDef = indicatorMap?.get(child.indicatorRef);
          const leafName = child.customLabel || indDef?.name || child.indicatorRef;
          const isSelected = selectedNodeId === leafId;
          const score = leafFlat?.score ?? null;

          let strokeColor = '#10b981'; // emerald-500
          let fillColor = '#064e3b'; // emerald-950
          if (typeof score === 'number') {
            if (score >= 80) {
              strokeColor = '#34d399';
              fillColor = '#064e3b';
            } else if (score >= 60) {
              strokeColor = '#fbbf24';
              fillColor = '#451a03';
            } else {
              strokeColor = '#fb7185';
              fillColor = '#4c0519';
            }
          }

          if (isSelected) {
            strokeColor = '#38bdf8';
          }

          return {
            id: leafId,
            name: leafName,
            kind: 'leaf',
            localWeight: leafFlat?.localWeight ?? child.weight,
            globalWeight: leafFlat?.globalWeight ?? 0,
            score,
            indicatorRef: child.indicatorRef,
            atomRef: indDef?.atomRef,
            symbol: 'circle',
            symbolSize: 14,
            itemStyle: {
              color: fillColor,
              borderColor: strokeColor,
              borderWidth: isSelected ? 3 : 2,
              shadowBlur: isSelected ? 10 : 0,
              shadowColor: 'rgba(56, 189, 248, 0.7)',
            },
            label: {
              position: 'right',
              verticalAlign: 'middle',
              align: 'left',
              color: isSelected ? '#38bdf8' : '#e6edf3',
              fontSize: 11,
              distance: 8,
            },
          };
        }
      });
    }

    return {
      id: rootId,
      name: system.root.name || system.name || '评估体系根节点',
      kind: 'root',
      localWeight: 1.0,
      globalWeight: 1.0,
      score: rootScore,
      weightSumValid: rootFlat?.weightSumValid ?? true,
      symbol: 'roundRect',
      symbolSize: [180, 42],
      itemStyle: {
        color: '#1e3a8a',
        borderColor: isRootSelected ? '#38bdf8' : '#60a5fa',
        borderWidth: isRootSelected ? 3 : 2,
        shadowBlur: isRootSelected ? 16 : 8,
        shadowColor: isRootSelected ? 'rgba(56, 189, 248, 0.9)' : 'rgba(37, 99, 235, 0.5)',
        borderRadius: 8,
      },
      label: {
        position: 'inside',
        verticalAlign: 'middle',
        align: 'center',
        color: '#ffffff',
        fontSize: 12,
        fontWeight: 'bold',
      },
      children: buildBranch(rootId),
    };
  }, [system, flatNodes, flatNodeMap, indicatorMap, selectedNodeId]);

  // ECharts 实例初始化与生命周期
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    chartRef.current = chart;

    // 点击事件监听 -> 派发选中节点事件
    chart.on('click', (params: any) => {
      const data = params.data as EChartsNodeData | undefined;
      if (data?.id) {
        const found = flatNodeMap.get(data.id);
        if (found && onSelectNode) {
          onSelectNode(found);
        }
      }
    });

    const ro = new ResizeObserver(() => {
      chart.resize();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [flatNodeMap, onSelectNode]);

  // 更新配置项
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartTreeData) return;

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        triggerOn: 'mousemove',
        backgroundColor: '#161b22',
        borderColor: '#30363d',
        textStyle: { color: '#e6edf3', fontSize: 12 },
        formatter: (params: any) => {
          const d = params.data as EChartsNodeData;
          if (!d) return '';

          const kindLabel =
            d.kind === 'root'
              ? '体系根节点'
              : d.kind === 'dimension'
              ? '评估维度'
              : '指标叶子';

          const localPct = (d.localWeight * 100).toFixed(1);
          const globalPct = (d.globalWeight * 100).toFixed(1);
          const scoreHtml =
            typeof d.score === 'number'
              ? `<div style="margin-top:4px;"><span style="color:#9ca3af;">评估得分:</span> <strong style="color:${
                  d.score >= 80 ? '#34d399' : d.score >= 60 ? '#fbbf24' : '#f87171'
                };">${d.score.toFixed(1)} 分</strong></div>`
              : '';

          const indHtml = d.indicatorRef
            ? `<div style="margin-top:2px;font-size:11px;color:#818cf8;">指标ID: ${d.indicatorRef}</div>`
            : '';
          const atomHtml = d.atomRef
            ? `<div style="margin-top:2px;font-size:11px;color:#22d3ee;">算子ID: ${d.atomRef}</div>`
            : '';
          const warnHtml =
            d.weightSumValid === false
              ? `<div style="margin-top:4px;color:#fbbf24;font-size:11px;">⚠️ 子节点权重和未满 100%</div>`
              : '';

          return `
            <div style="padding: 2px 4px; min-width: 160px;">
              <div style="font-weight: 600; color: #f3f4f6; margin-bottom: 4px;">${d.name}</div>
              <div style="font-size: 11px; color: #9ca3af; margin-bottom: 4px;">[${kindLabel}]</div>
              <div style="display:flex; justify-content:space-between; gap:12px; font-size:11px;">
                <span style="color:#9ca3af;">本级权重:</span>
                <span style="color:#60a5fa; font-family:monospace;">${localPct}%</span>
              </div>
              <div style="display:flex; justify-content:space-between; gap:12px; font-size:11px;">
                <span style="color:#9ca3af;">全局权重:</span>
                <span style="color:#34d399; font-family:monospace;">${globalPct}%</span>
              </div>
              ${scoreHtml}
              ${indHtml}
              ${atomHtml}
              ${warnHtml}
            </div>
          `;
        },
      },
      series: [
        {
          type: 'tree',
          data: [chartTreeData],
          top: '6%',
          left: '20%',
          bottom: '6%',
          right: '28%',
          layout: 'orthogonal',
          orient: 'LR',
          edgeShape: 'curve',
          symbol: 'emptyCircle',
          symbolSize: 8,
          initialTreeDepth: expandDepth, // 支持全局受控全部展开(-1)或仅收起至维度层(1)
          roam: true,
          expandAndCollapse: true,
          animationDuration: 400,
          animationDurationUpdate: 400,
          lineStyle: {
            color: '#475569',
            width: 1.5,
            curveness: 0.5,
          },
          label: {
            formatter: (params: any) => {
              const d = params.data as EChartsNodeData;
              if (d.kind === 'leaf') {
                const wt = `(${(d.localWeight * 100).toFixed(0)}%)`;
                const sc =
                  typeof d.score === 'number' ? ` [${d.score.toFixed(0)}分]` : '';
                return `${d.name} ${wt}${sc}`;
              }
              const wt = `(${(d.localWeight * 100).toFixed(0)}%)`;
              return `${d.name} ${wt}`;
            },
          },
        },
      ],
    };

    chart.setOption(option, { notMerge: true });
  }, [chartTreeData, expandDepth]);

  // 控制操作：放大、缩小、还原视角
  const handleZoom = (direction: 'in' | 'out') => {
    const chart = chartRef.current;
    if (!chart) return;
    const option = chart.getOption() as any;
    const currentZoom = option.series?.[0]?.zoom || 1;
    const nextZoom = direction === 'in' ? currentZoom * 1.25 : currentZoom / 1.25;
    chart.setOption({
      series: [{ zoom: Math.max(0.2, Math.min(nextZoom, 5)) }],
    });
  };

  const handleResetZoom = () => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption({
      series: [{ zoom: 1, center: null }],
    });
  };

  return (
    <div
      className={`relative flex flex-col bg-[#161b22] border border-[#2a313c] rounded-lg overflow-hidden text-[#e6edf3] ${className}`}
    >
      {/* 顶部标题与控制栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#0f141a] border-b border-[#2a313c]">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold tracking-wide text-gray-200">
            体系全景拓扑图 (LR 树状布局)
          </span>
          <span className="text-[11px] text-gray-500">
            支持鼠标滚轮缩放、拖拽平移及点击节点联动
          </span>
        </div>

        {/* 视角与展开控制按钮 */}
        <div className="flex items-center gap-1.5">
          <div className="inline-flex rounded border border-[#30363d] bg-[#21262d] p-0.5 mr-1">
            <button
              type="button"
              onClick={() => setExpandDepth(-1)}
              className={`inline-flex shrink-0 whitespace-nowrap items-center gap-1 px-2 py-0.5 text-[11px] rounded transition ${
                expandDepth === -1 ? 'bg-blue-600 text-white font-medium' : 'text-gray-400 hover:text-white'
              }`}
              title="全部展开下级指标"
            >
              <ChevronsDown className="w-3 h-3" />
              展开全部
            </button>
            <button
              type="button"
              onClick={() => setExpandDepth(1)}
              className={`inline-flex shrink-0 whitespace-nowrap items-center gap-1 px-2 py-0.5 text-[11px] rounded transition ${
                expandDepth === 1 ? 'bg-blue-600 text-white font-medium' : 'text-gray-400 hover:text-white'
              }`}
              title="仅保留维度层，收起所有子指标"
            >
              <ChevronsUp className="w-3 h-3" />
              收起叶子
            </button>
          </div>

          <button
            type="button"
            onClick={() => handleZoom('in')}
            className="p-1 text-gray-400 hover:text-white rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] transition-colors"
            title="放大视角"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleZoom('out')}
            className="p-1 text-gray-400 hover:text-white rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] transition-colors"
            title="缩小视角"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleResetZoom}
            className="p-1 text-gray-400 hover:text-white rounded bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] transition-colors"
            title="重置视角"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ECharts 渲染容器 */}
      <div
        ref={containerRef}
        style={{ height: typeof height === 'number' ? `${height}px` : height, width: '100%' }}
        className="w-full flex-1 min-h-[380px]"
      />

      {/* 底部拓扑图例 */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-1.5 bg-[#0f141a] border-t border-[#2a313c] text-[11px] text-gray-400">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-blue-600 border border-blue-400" />
            <span>体系根节点</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-800 border border-amber-500" />
            <span>评估维度</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 border border-emerald-400" />
            <span>指标叶子 (及格/优秀)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-600 border border-rose-400" />
            <span>指标叶子 (告警/低分)</span>
          </span>
        </div>
        <span className="text-gray-500">点击图上任意节点可高亮并查看属性</span>
      </div>
    </div>
  );
}
