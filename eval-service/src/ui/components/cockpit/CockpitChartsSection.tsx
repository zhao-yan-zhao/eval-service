import type * as echarts from 'echarts';
import { useMemo, useState } from 'react';
import { BarChart3, Grid3X3, Radar, Target } from 'lucide-react';
import type { EvaluationDagOutput } from '../../../core/types.ts';
import { EChartPanel } from '../EChartPanel.tsx';
import {
  DYNAMIC_SIDE_COLORS,
  type LeafDiagnosticPoint,
  type PrimaryDimensionRow,
} from './cockpit-v4-helpers.ts';

type RightChartTab = 'bar' | 'heatmap' | 'quadrant';

interface CockpitChartsSectionProps {
  overall: EvaluationDagOutput | null;
  sides: string[];
  focusSide: string;
  dimensions: PrimaryDimensionRow[];
  leafPoints: LeafDiagnosticPoint[];
}

export function CockpitChartsSection({
  overall,
  sides,
  focusSide,
  dimensions,
  leafPoints,
}: CockpitChartsSectionProps) {
  const [rightTab, setRightTab] = useState<RightChartTab>('bar');

  // 1. 左栏：全阵营能力域叠加雷达图（维度 < 3 时自动降级为柱状对比，避免 ECharts radar 报错）
  const radarOption = useMemo<echarts.EChartsOption>(() => {
    if (!overall || dimensions.length === 0) {
      return {
        backgroundColor: 'transparent',
        title: {
          text: '暂无能力维度数据',
          left: 'center',
          top: 'middle',
          textStyle: { color: '#64748b', fontSize: 12, fontWeight: 'normal' },
        },
      };
    }

    if (dimensions.length < 3) {
      const activeNames = sides.length > 0 ? sides : ['综合'];
      return {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        legend: {
          bottom: 0,
          textStyle: { color: '#94a3b8', fontSize: 11 },
        },
        grid: { left: 48, right: 20, top: 24, bottom: 42 },
        xAxis: {
          type: 'category',
          data: dimensions.map((d) => d.label),
          axisLabel: { color: '#cbd5e1', fontSize: 11 },
          axisLine: { lineStyle: { color: '#334155' } },
        },
        yAxis: {
          type: 'value',
          min: 0,
          max: 100,
          axisLabel: { color: '#94a3b8', fontSize: 10 },
          splitLine: { lineStyle: { color: '#1e293b' } },
        },
        series: activeNames.map((name, idx) => ({
          name,
          type: 'bar',
          barMaxWidth: 28,
          itemStyle: {
            color: DYNAMIC_SIDE_COLORS[idx % DYNAMIC_SIDE_COLORS.length],
            borderRadius: [4, 4, 0, 0],
            opacity: focusSide === 'ALL' || focusSide === name ? 0.92 : 0.3,
          },
          data: dimensions.map((d) =>
            sides.length > 0 ? Number((d.bySideScores[name] ?? 0).toFixed(1)) : Number((d.overallScore ?? 0).toFixed(1)),
          ),
        })),
      };
    }

    const indicator = dimensions.map((d) => ({
      name: d.label.length > 8 ? `${d.label.slice(0, 8)}…` : d.label,
      max: 100,
    }));

    const dataSeries: Array<{
      name: string;
      value: number[];
      lineStyle: { width: number; type?: 'solid' | 'dashed'; color?: string; opacity?: number };
      itemStyle: { color?: string; opacity?: number };
      areaStyle?: { opacity: number };
      symbol?: string;
    }> = [];

    if (sides.length > 0) {
      sides.forEach((side, idx) => {
        const color = DYNAMIC_SIDE_COLORS[idx % DYNAMIC_SIDE_COLORS.length];
        const isFocused = focusSide === 'ALL' || focusSide === side;
        dataSeries.push({
          name: side,
          value: dimensions.map((d) => Number((d.bySideScores[side] ?? 0).toFixed(1))),
          lineStyle: {
            width: focusSide === side ? 2.5 : 2,
            color,
            opacity: isFocused ? 1 : 0.22,
          },
          itemStyle: { color, opacity: isFocused ? 1 : 0.25 },
          areaStyle: { opacity: focusSide === side ? 0.28 : isFocused ? 0.14 : 0.03 },
        });
      });
    } else {
      dataSeries.push({
        name: '综合效能',
        value: dimensions.map((d) => Number((d.overallScore ?? 0).toFixed(1))),
        lineStyle: { width: 2.2, color: '#38bdf8' },
        itemStyle: { color: '#38bdf8' },
        areaStyle: { opacity: 0.2 },
      });
    }

    dataSeries.push({
      name: '达标基线 (80分)',
      value: dimensions.map(() => 80),
      symbol: 'none',
      lineStyle: { width: 1.2, type: 'dashed', color: '#475569' },
      itemStyle: { color: '#475569' },
      areaStyle: { opacity: 0 },
    });

    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item' },
      legend: {
        bottom: 0,
        textStyle: { color: '#cbd5e1', fontSize: 11 },
      },
      radar: {
        indicator,
        radius: '62%',
        center: ['50%', '46%'],
        axisName: { color: '#cbd5e1', fontSize: 11 },
        splitNumber: 4,
        splitLine: { lineStyle: { color: '#1e293b' } },
        splitArea: { areaStyle: { color: ['rgba(15,23,42,0.2)', 'rgba(30,41,59,0.25)'] } },
        axisLine: { lineStyle: { color: '#334155' } },
      },
      series: [
        {
          type: 'radar',
          data: dataSeries,
        },
      ],
    };
  }, [overall, dimensions, sides, focusSide]);

  // 2a. 右栏 Tab 1：分维度对比柱状图 / 单方权重贡献条形图
  const barOption = useMemo<echarts.EChartsOption>(() => {
    if (!overall || dimensions.length === 0) {
      return {
        backgroundColor: 'transparent',
        title: {
          text: '暂无维度对比数据',
          left: 'center',
          top: 'middle',
          textStyle: { color: '#64748b', fontSize: 12, fontWeight: 'normal' },
        },
      };
    }

    const labels = dimensions.map((d) => `${d.label} (${(d.weight * 100).toFixed(0)}%)`);

    if (focusSide !== 'ALL' || sides.length === 0) {
      const targetName = focusSide !== 'ALL' ? focusSide : '综合';
      const scores = dimensions.map((d) =>
        focusSide !== 'ALL'
          ? Number((d.bySideScores[focusSide] ?? 0).toFixed(1))
          : Number((d.overallScore ?? 0).toFixed(1)),
      );
      const contribs = dimensions.map((d, idx) =>
        Number((scores[idx] * (d.effectiveWeight || d.weight)).toFixed(1)),
      );
      return {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        legend: {
          bottom: 0,
          textStyle: { color: '#cbd5e1', fontSize: 11 },
        },
        grid: { left: 150, right: 24, top: 16, bottom: 38 },
        xAxis: {
          type: 'value',
          min: 0,
          max: 100,
          axisLabel: { color: '#94a3b8', fontSize: 10 },
          splitLine: { lineStyle: { color: '#1e293b' } },
        },
        yAxis: {
          type: 'category',
          inverse: true,
          data: labels,
          axisLabel: { color: '#cbd5e1', fontSize: 11, width: 138, overflow: 'truncate' },
          axisLine: { lineStyle: { color: '#334155' } },
        },
        series: [
          {
            name: `${targetName}维度得分`,
            type: 'bar',
            barMaxWidth: 14,
            itemStyle: { color: '#38bdf8', borderRadius: [0, 4, 4, 0] },
            data: scores,
          },
          {
            name: '加权总分贡献',
            type: 'bar',
            barMaxWidth: 14,
            itemStyle: { color: '#10b981', borderRadius: [0, 4, 4, 0] },
            data: contribs,
          },
        ],
      };
    }

    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: {
        bottom: 0,
        textStyle: { color: '#cbd5e1', fontSize: 11 },
      },
      grid: { left: 150, right: 20, top: 16, bottom: 38 },
      xAxis: {
        type: 'value',
        min: 0,
        max: 100,
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: labels,
        axisLabel: { color: '#cbd5e1', fontSize: 11, width: 138, overflow: 'truncate' },
        axisLine: { lineStyle: { color: '#334155' } },
      },
      series: sides.map((side, idx) => ({
        name: side,
        type: 'bar',
        barMaxWidth: 13,
        itemStyle: {
          color: DYNAMIC_SIDE_COLORS[idx % DYNAMIC_SIDE_COLORS.length],
          borderRadius: [0, 4, 4, 0],
        },
        data: dimensions.map((d) =>
          d.bySideScores[side] !== null && d.bySideScores[side] !== undefined
            ? Number(d.bySideScores[side]!.toFixed(1))
            : 0,
        ),
      })),
    };
  }, [overall, dimensions, sides, focusSide]);

  // 2b. 右栏 Tab 2：阵营 × 指标得分热力矩阵
  const heatmapOption = useMemo<echarts.EChartsOption>(() => {
    const topLeaves = leafPoints.slice(0, 16);
    if (!overall || topLeaves.length === 0) {
      return {
        backgroundColor: 'transparent',
        title: {
          text: '暂无叶级指标热力数据',
          left: 'center',
          top: 'middle',
          textStyle: { color: '#64748b', fontSize: 12, fontWeight: 'normal' },
        },
      };
    }

    const xLabels = sides.length > 0 ? sides : ['综合'];
    const yLabels = topLeaves.map((p) =>
      p.label.length > 14 ? `${p.label.slice(0, 14)}…` : p.label,
    );
    const data: Array<[number, number, number | string]> = [];

    topLeaves.forEach((leaf, yIdx) => {
      xLabels.forEach((side, xIdx) => {
        const val = sides.length > 0 ? leaf.bySideScores[side] : leaf.score;
        data.push([
          xIdx,
          yIdx,
          val !== null && val !== undefined ? Number(val.toFixed(1)) : '-',
        ]);
      });
    });

    return {
      backgroundColor: 'transparent',
      tooltip: {
        position: 'top',
        formatter: (params: unknown) => {
          const p = params as { value?: [number, number, number | string] };
          const [xi, yi, val] = p.value ?? [0, 0, '-'];
          const leaf = topLeaves[yi];
          const sideName = xLabels[xi];
          return `${sideName} · ${leaf?.label ?? ''}<br/>得分：<b>${val === '-' ? '缺数' : `${val} 分`}</b>`;
        },
      },
      grid: { left: 145, right: 72, top: 12, bottom: 30 },
      xAxis: {
        type: 'category',
        data: xLabels,
        splitArea: { show: true },
        axisLabel: { color: '#cbd5e1', fontSize: 11 },
        axisLine: { lineStyle: { color: '#334155' } },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: yLabels,
        splitArea: { show: true },
        axisLabel: { color: '#cbd5e1', fontSize: 10 },
        axisLine: { lineStyle: { color: '#334155' } },
      },
      visualMap: {
        min: 0,
        max: 100,
        calculable: false,
        orient: 'vertical',
        right: 6,
        top: 'middle',
        itemHeight: 160,
        textStyle: { color: '#94a3b8', fontSize: 10 },
        inRange: {
          color: ['#be123c', '#d97706', '#059669'],
        },
        outOfRange: {
          color: ['#334155'],
        },
      },
      series: [
        {
          type: 'heatmap',
          data,
          label: {
            show: true,
            color: '#f8fafc',
            fontSize: 10,
            formatter: (params: unknown) => {
              const p = params as { value?: [number, number, number | string] };
              const v = p.value?.[2];
              return v === '-' ? '缺数' : String(v ?? '');
            },
          },
          emphasis: {
            itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.6)' },
          },
        },
      ],
    };
  }, [overall, leafPoints, sides]);

  // 2c. 右栏 Tab 3：权重-得分短板诊断四象限散点图
  const quadrantOption = useMemo<echarts.EChartsOption>(() => {
    const validPoints = leafPoints.filter(
      (p) => p.score !== null && p.score !== undefined && p.status !== 'unavailable',
    );
    if (!overall || validPoints.length === 0) {
      return {
        backgroundColor: 'transparent',
        title: {
          text: '暂无可用叶级指标点',
          left: 'center',
          top: 'middle',
          textStyle: { color: '#64748b', fontSize: 12, fontWeight: 'normal' },
        },
      };
    }

    const weightsPct = validPoints.map((p) => Number((p.cascadingWeight * 100).toFixed(2)));
    const avgWeight =
      weightsPct.reduce((a, b) => a + b, 0) / Math.max(1, weightsPct.length);
    const maxWeight = Math.max(avgWeight * 1.6, ...weightsPct, 5);

    const scatterData = validPoints.map((p) => {
      const wPct = Number((p.cascadingWeight * 100).toFixed(2));
      const sc = Number((p.score ?? 0).toFixed(1));
      const isPriority = wPct >= avgWeight && sc < 60;
      return {
        name: p.label,
        value: [wPct, sc],
        parentLabel: p.parentLabel,
        itemStyle: {
          color: isPriority ? '#fb7185' : sc >= 80 ? '#34d399' : '#38bdf8',
          borderColor: '#0f172a',
          borderWidth: 1,
        },
        symbolSize: isPriority ? 14 : 10,
      };
    });

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: (params: unknown) => {
          const p = params as {
            name?: string;
            value?: [number, number];
            data?: { parentLabel?: string };
          };
          const [w, s] = p.value ?? [0, 0];
          return `<b>${p.name ?? ''}</b> (${p.data?.parentLabel ?? ''})<br/>级联权重：${w}%<br/>得分：${s} 分`;
        },
      },
      grid: { left: 48, right: 24, top: 24, bottom: 38 },
      xAxis: {
        type: 'value',
        name: '级联权重 (%)',
        nameLocation: 'middle',
        nameGap: 22,
        nameTextStyle: { color: '#94a3b8', fontSize: 10 },
        min: 0,
        max: Number(maxWeight.toFixed(1)),
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      yAxis: {
        type: 'value',
        name: '得分',
        min: 0,
        max: 100,
        nameTextStyle: { color: '#94a3b8', fontSize: 10 },
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      series: [
        {
          type: 'scatter',
          data: scatterData,
          label: {
            show: true,
            position: 'top',
            fontSize: 10,
            color: '#cbd5e1',
            formatter: (params: unknown) => {
              const p = params as { name?: string; value?: [number, number] };
              const [w, s] = p.value ?? [0, 0];
              if (w >= avgWeight && s < 60) {
                const nm = p.name ?? '';
                return nm.length > 8 ? `${nm.slice(0, 8)}…` : nm;
              }
              return '';
            },
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#475569', type: 'dashed' },
            data: [{ yAxis: 60 }, { xAxis: Number(avgWeight.toFixed(2)) }],
          },
          markArea: {
            silent: true,
            itemStyle: { color: 'rgba(244, 63, 94, 0.08)' },
            data: [
              [
                {
                  name: '优先改进区 (高权重·低得分)',
                  xAxis: Number(avgWeight.toFixed(2)),
                  yAxis: 0,
                  label: {
                    position: 'insideBottomRight',
                    color: '#fda4af',
                    fontSize: 10,
                  },
                },
                { xAxis: Number(maxWeight.toFixed(1)), yAxis: 60 },
              ],
            ],
          },
        },
      ],
    };
  }, [overall, leafPoints]);

  const activeRightOption =
    rightTab === 'bar' ? barOption : rightTab === 'heatmap' ? heatmapOption : quadrantOption;

  return (
    <section className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
      {/* 左栏：能力域雷达对比 */}
      <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-3.5 lg:col-span-5">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
            <Radar className="h-4 w-4 text-cyan-400" />
            <span>能力域多阵营态势对比</span>
          </div>
          <span className="text-[11px] text-slate-400">
            {focusSide === 'ALL' ? '全阵营叠加' : `聚焦：${focusSide}`}
          </span>
        </div>
        <EChartPanel option={radarOption} height={290} />
      </div>

      {/* 右栏：三视角多维分析切换 */}
      <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-3.5 lg:col-span-7">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
            {rightTab === 'bar' ? (
              <BarChart3 className="h-4 w-4 text-emerald-400" />
            ) : rightTab === 'heatmap' ? (
              <Grid3X3 className="h-4 w-4 text-amber-400" />
            ) : (
              <Target className="h-4 w-4 text-rose-400" />
            )}
            <span>
              {rightTab === 'bar'
                ? '一级能力维度得分对比'
                : rightTab === 'heatmap'
                  ? '阵营 × 底层指标得分矩阵'
                  : '权重-得分短板诊断四象限'}
            </span>
          </div>

          <div className="inline-flex rounded-lg border border-[#30363d] bg-[#0d1117] p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setRightTab('bar')}
              className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                rightTab === 'bar'
                  ? 'bg-indigo-600/30 font-semibold text-indigo-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              分维度对比
            </button>
            <button
              type="button"
              onClick={() => setRightTab('heatmap')}
              className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                rightTab === 'heatmap'
                  ? 'bg-indigo-600/30 font-semibold text-indigo-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              指标热力矩阵
            </button>
            <button
              type="button"
              onClick={() => setRightTab('quadrant')}
              className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                rightTab === 'quadrant'
                  ? 'bg-indigo-600/30 font-semibold text-indigo-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              短板四象限
            </button>
          </div>
        </div>
        <EChartPanel option={activeRightOption} height={290} />
      </div>
    </section>
  );
}
