import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as echarts from 'echarts';
import { BarChart3, Code2, LineChart, PieChart, Sparkles } from 'lucide-react';

export interface AlgorithmOutputVisualizerProps {
  output: any;
  title?: string;
}

interface ArraySeriesInfo {
  key: string;
  data: number[];
  length: number;
}

export function AlgorithmOutputVisualizer({ output, title }: AlgorithmOutputVisualizerProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const [viewMode, setViewMode] = useState<'chart' | 'json'>('chart');
  const [chartType, setChartType] = useState<'line' | 'bar'>('line');

  // 解析 output 中的所有数值型数组
  const detectedSeries = useMemo<ArraySeriesInfo[]>(() => {
    if (!output || typeof output !== 'object') return [];
    const seriesList: ArraySeriesInfo[] = [];

    for (const [key, val] of Object.entries(output)) {
      if (Array.isArray(val) && val.length > 0) {
        // 检查数组项是否主要为数值
        const numericData = val.filter((item): item is number => typeof item === 'number' && !isNaN(item));
        if (numericData.length === val.length && numericData.length >= 2) {
          seriesList.push({
            key,
            data: numericData,
            length: numericData.length,
          });
        }
      }
    }
    return seriesList;
  }, [output]);

  // 提取数值型标量指标 (用于卡片呈现)
  const scalarMetrics = useMemo(() => {
    if (!output || typeof output !== 'object') return [];
    return Object.entries(output)
      .filter(([, v]) => typeof v === 'number' || (typeof v === 'string' && !Array.isArray(v)))
      .map(([k, v]) => ({
        key: k,
        val: typeof v === 'number' ? (v % 1 !== 0 ? +v.toFixed(3) : v) : v,
      }));
  }, [output]);

  const hasChartData = detectedSeries.length > 0;

  // 初始化与更新 ECharts
  useEffect(() => {
    if (!chartRef.current || !hasChartData || viewMode !== 'chart') return;

    if (!chartInstanceRef.current) {
      chartInstanceRef.current = echarts.init(chartRef.current, 'dark');
    }
    const chart = chartInstanceRef.current;

    // 确定 X 轴点数（取最长数组长度）
    const maxLen = Math.max(...detectedSeries.map((s) => s.length));
    const xAxisData = Array.from({ length: maxLen }, (_, i) => `T${i + 1}`);

    // 系列配色盘 (霓虹暗黑风：青、紫、绿、橙)
    const colorPalette = ['#06b6d4', '#d946ef', '#10b981', '#f59e0b', '#3b82f6'];

    const seriesConfig = detectedSeries.map((s, idx) => ({
      name: s.key,
      type: chartType,
      data: s.data,
      smooth: chartType === 'line',
      symbolSize: 6,
      lineStyle: { width: 2.5 },
      itemStyle: { color: colorPalette[idx % colorPalette.length] },
      areaStyle:
        chartType === 'line'
          ? {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: `${colorPalette[idx % colorPalette.length]}33` },
                { offset: 1, color: `${colorPalette[idx % colorPalette.length]}00` },
              ]),
            }
          : undefined,
    }));

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', label: { backgroundColor: '#1e293b' } },
        backgroundColor: '#0f172a',
        borderColor: '#334155',
        textStyle: { color: '#f8fafc', fontSize: 11 },
      },
      legend: {
        data: detectedSeries.map((s) => s.key),
        textStyle: { color: '#94a3b8', fontSize: 11 },
        top: 4,
      },
      grid: {
        top: 36,
        left: 48,
        right: 20,
        bottom: 28,
      },
      xAxis: {
        type: 'category',
        data: xAxisData,
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#64748b', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        scale: true,
        splitLine: { lineStyle: { color: '#1e293b' } },
        axisLabel: { color: '#64748b', fontSize: 10 },
      },
      series: seriesConfig,
    };

    chart.setOption(option, true);

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [detectedSeries, chartType, viewMode, hasChartData]);

  useEffect(() => {
    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.dispose();
        chartInstanceRef.current = null;
      }
    };
  }, []);

  if (!output) {
    return (
      <div className="p-4 text-center text-xs text-slate-500 font-mono">
        暂无计算产出数据
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-[#070b16] p-3 space-y-3">
      {/* 顶栏控制 */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-300">{title || '算法计算结果透视'}</span>
          {hasChartData && (
            <span className="flex items-center gap-1 text-[10px] text-fuchsia-400 bg-fuchsia-950/60 border border-fuchsia-800/40 px-1.5 py-0.5 rounded font-mono">
              <Sparkles className="h-3 w-3" />
              <span>检测到 {detectedSeries.length} 组数组指标</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {hasChartData && (
            <div className="flex rounded border border-slate-800 bg-slate-900/80 p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => setChartType('line')}
                className={`px-1.5 py-0.5 rounded transition ${
                  chartType === 'line' ? 'bg-fuchsia-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="折线平滑图"
              >
                <LineChart className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setChartType('bar')}
                className={`px-1.5 py-0.5 rounded transition ${
                  chartType === 'bar' ? 'bg-fuchsia-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="柱状对比图"
              >
                <BarChart3 className="h-3 w-3" />
              </button>
            </div>
          )}

          <div className="flex rounded border border-slate-800 bg-slate-900/80 p-0.5 text-[10px]">
            {hasChartData && (
              <button
                type="button"
                onClick={() => setViewMode('chart')}
                className={`px-2 py-0.5 rounded transition ${
                  viewMode === 'chart' ? 'bg-fuchsia-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                📊 曲线图表
              </button>
            )}
            <button
              type="button"
              onClick={() => setViewMode('json')}
              className={`px-2 py-0.5 rounded transition ${
                viewMode === 'json' ? 'bg-fuchsia-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📝 原始 JSON
            </button>
          </div>
        </div>
      </div>

      {/* 标量指标关键卡片 */}
      {scalarMetrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {scalarMetrics.slice(0, 4).map(({ key, val }) => (
            <div
              key={key}
              className="rounded-lg bg-slate-900/70 border border-slate-800 p-2 space-y-0.5 overflow-hidden"
            >
              <div className="text-[10px] text-slate-400 font-mono truncate">{key}</div>
              <div className="text-sm font-bold font-mono text-cyan-300 truncate">
                {String(val)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ECharts 图表展示区 */}
      {hasChartData && viewMode === 'chart' ? (
        <div
          ref={chartRef}
          style={{ width: '100%', height: '180px' }}
          className="rounded-lg bg-[#050811] border border-slate-900"
        />
      ) : (
        <pre className="text-xs font-mono text-emerald-300 bg-slate-950 p-2.5 rounded-lg border border-slate-900 max-h-48 overflow-auto">
          {JSON.stringify(output, null, 2)}
        </pre>
      )}
    </div>
  );
}
