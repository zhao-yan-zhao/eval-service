import type * as echarts from 'echarts';
import {
  AlertTriangle,
  ChevronRight,
  Database,
  Eye,
  FileSpreadsheet,
  FolderOpen,
  Layers,
  Radio,
  Search,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  evalApi,
  type CsvRunPresence,
  type CsvTableProfileEntry,
  type RunSourceProfile,
  type StoredRunSummary,
} from '../api.ts';
import { EChartPanel } from './EChartPanel.tsx';

interface SourceProfilePanelProps {
  runId: string;
  runSummary?: StoredRunSummary;
}

type TableFilter =
  | 'all'
  | 'active_with_rows'
  | 'empty_header_only'
  | 'missing_in_run'
  | 'dead_or_placeholder';

const PRESENCE_META: Record<
  CsvRunPresence,
  { label: string; badgeClass: string; chartColor: string }
> = {
  active_with_rows: {
    label: '已产出·有行',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35',
    chartColor: '#10b981',
  },
  empty_header_only: {
    label: '已生成·空表',
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/35',
    chartColor: '#38bdf8',
  },
  missing_in_run: {
    label: '未产出',
    badgeClass: 'bg-slate-700/60 text-slate-300 border-slate-600/60',
    chartColor: '#64748b',
  },
  unused_enum: {
    label: '死枚举 D5',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/35',
    chartColor: '#f59e0b',
  },
  placeholder: {
    label: '引擎占位',
    badgeClass: 'bg-slate-800/80 text-slate-400 border-slate-700/70',
    chartColor: '#475569',
  },
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function SourceProfilePanel({ runId, runSummary }: SourceProfilePanelProps) {
  const [profile, setProfile] = useState<RunSourceProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [tableFilter, setTableFilter] = useState<TableFilter>('all');
  const [tableSearch, setTableSearch] = useState('');
  const [inspectedTable, setInspectedTable] = useState<CsvTableProfileEntry | null>(null);
  const [previewTable, setPreviewTable] = useState<string | undefined>(undefined);
  const [previewLoading, setPreviewLoading] = useState(false);

  // 切换 Run 时清空上一局预览状态并重新剖析来源目录/JSONL 帧
  useEffect(() => {
    setPreviewTable(undefined);
    setInspectedTable(null);
  }, [runId]);

  useEffect(() => {
    if (!runId) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrorMsg(null);
    if (previewTable) setPreviewLoading(true);

    evalApi
      .getRunSourceProfile(runId, {
        previewTable,
        previewLimit: 50,
      })
      .then((res) => {
        if (!cancelled) setProfile(res.profile);
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runId, previewTable]);

  // ECharts 1: 44 类标准 EventExporter 事件状态饼图
  const catalogPieOption = useMemo<echarts.EChartsOption>(() => {
    const s = profile?.csvProfile.statusSummary;
    const total = profile?.runMeta.totalCatalogEvents ?? 44;
    const activeTotal = (s?.activeWithRows ?? 0) + (s?.emptyHeaderOnly ?? 0);
    const data = [
      {
        name: '已产出(含行)',
        value: s?.activeWithRows ?? 0,
        itemStyle: { color: PRESENCE_META.active_with_rows.chartColor },
      },
      {
        name: '已生成(仅表头)',
        value: s?.emptyHeaderOnly ?? 0,
        itemStyle: { color: PRESENCE_META.empty_header_only.chartColor },
      },
      {
        name: '本局未导出',
        value: s?.missingInRun ?? 0,
        itemStyle: { color: PRESENCE_META.missing_in_run.chartColor },
      },
      {
        name: '死枚举 (D5)',
        value: s?.unusedEnum ?? 0,
        itemStyle: { color: PRESENCE_META.unused_enum.chartColor },
      },
      {
        name: '引擎占位',
        value: s?.placeholder ?? 0,
        itemStyle: { color: PRESENCE_META.placeholder.chartColor },
      },
    ];

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} 张 ({d}%)',
      },
      legend: {
        bottom: 0,
        textStyle: { color: '#cbd5e1', fontSize: 11 },
      },
      title: {
        text: `${activeTotal}/${total}`,
        subtext: '已生成表',
        left: 'center',
        top: '33%',
        textStyle: { color: '#f8fafc', fontSize: 20, fontWeight: 700 },
        subtextStyle: { color: '#94a3b8', fontSize: 11 },
      },
      series: [
        {
          type: 'pie',
          radius: ['46%', '70%'],
          center: ['50%', '43%'],
          label: { show: false },
          itemStyle: { borderColor: '#0f172a', borderWidth: 2 },
          data,
        },
      ],
    };
  }, [profile]);

  // ECharts 2: 本局已发现 CSV 表行数排行条形图
  const csvRowsBarOption = useMemo<echarts.EChartsOption>(() => {
    const discovered = (profile?.csvProfile.tables ?? [])
      .filter((t) => t.fileNames.length > 0)
      .sort((a, b) => a.rowCount - b.rowCount);

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: unknown) => {
          const item = Array.isArray(params) ? params[0] : params;
          const idx = (item as { dataIndex?: number }).dataIndex ?? 0;
          const t = discovered[idx];
          if (!t) return '';
          return [
            `<strong>${t.name}</strong>`,
            `数据行数: ${t.rowCount} (文件总行数: ${t.rawFileRowCount})`,
            `列数: ${t.actualHeaders.length} (规范 ${t.expectedHeaders.length})`,
            `体积: ${formatBytes(t.bytes)} · BOM×${t.bomCount}`,
            `文件: ${t.fileNames.join(', ')}`,
          ].join('<br/>');
        },
      },
      grid: { left: 10, right: 44, top: 14, bottom: 26, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: '#94a3b8', fontSize: 11 },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      yAxis: {
        type: 'category',
        data: discovered.map((t) => t.name),
        axisLabel: { color: '#e2e8f0', fontSize: 11, width: 132, overflow: 'truncate' },
      },
      series: [
        {
          name: '数据行数',
          type: 'bar',
          data: discovered.map((t) => ({
            value: t.rowCount,
            itemStyle: {
              color: t.rowCount > 0 ? '#22d3ee' : '#475569',
              borderRadius: [0, 4, 4, 0],
            },
          })),
          label: {
            show: true,
            position: 'right',
            color: '#cbd5e1',
            fontSize: 11,
          },
        },
      ],
    };
  }, [profile]);

  // ECharts 3: BS JSONL 路径跨帧命中率条形图
  const bsPathHitOption = useMemo<echarts.EChartsOption>(() => {
    const metrics = [...(profile?.bsProfile.pathMetrics ?? [])].reverse();
    const hasFrames = (profile?.bsProfile.parsedFrames ?? 0) > 0;

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: unknown) => {
          const item = Array.isArray(params) ? params[0] : params;
          const idx = (item as { dataIndex?: number }).dataIndex ?? 0;
          const m = metrics[idx];
          if (!m) return '';
          const ops =
            m.drivenOperators.length > 0
              ? m.drivenOperators.map((o) => `${o.id}(${o.readiness === 'batch_a_ready' ? 'A' : 'B'})`).join(', ')
              : '基础态势结构字段';
          return [
            `<strong>${m.pathExpr}</strong>`,
            `所属族: ${m.familyLabel}`,
            hasFrames
              ? `帧命中: ${m.hitFrames} / ${m.totalFrames} (${Math.round(m.hitRate * 100)}%) · 累计要素: ${m.totalItemCount}`
              : '当前 Run 无 BS 帧文件（规范结构对照模式）',
            m.sampleValue ? `首帧样例: ${m.sampleValue}` : '',
            `关联算子: ${ops}`,
            m.discrepancyNote ? `实证说明: ${m.discrepancyNote}` : '',
          ]
            .filter(Boolean)
            .join('<br/>');
        },
      },
      grid: { left: 10, right: 48, top: 14, bottom: 28, containLabel: true },
      xAxis: {
        type: 'value',
        min: 0,
        max: 100,
        axisLabel: { color: '#94a3b8', fontSize: 11, formatter: '{value}%' },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      yAxis: {
        type: 'category',
        data: metrics.map((m) => m.label.split(' ')[0]),
        axisLabel: { color: '#cbd5e1', fontSize: 11, width: 140, overflow: 'truncate' },
      },
      series: [
        {
          name: '帧命中率',
          type: 'bar',
          data: metrics.map((m) => {
            const pct = hasFrames ? Math.round(m.hitRate * 100) : 0;
            const color = !hasFrames
              ? '#475569'
              : m.hitFrames > 0
                ? '#10b981'
                : m.drivenOperators.some((o) => o.readiness === 'batch_b_pending')
                  ? '#f59e0b'
                  : '#64748b';
            return {
              value: pct,
              itemStyle: { color, borderRadius: [0, 4, 4, 0] },
            };
          }),
          label: {
            show: true,
            position: 'right',
            color: '#cbd5e1',
            fontSize: 11,
            formatter: (p: { dataIndex?: number }) => {
              const m = metrics[p.dataIndex ?? 0];
              if (!m || !hasFrames) return 'N/A';
              return `${m.hitFrames}/${m.totalFrames}`;
            },
          },
        },
      ],
    };
  }, [profile]);

  const filteredTables = useMemo(() => {
    const list = profile?.csvProfile.tables ?? [];
    const q = tableSearch.trim().toLowerCase();
    return list.filter((t) => {
      if (tableFilter === 'active_with_rows' && t.runPresence !== 'active_with_rows') return false;
      if (tableFilter === 'empty_header_only' && t.runPresence !== 'empty_header_only') return false;
      if (tableFilter === 'missing_in_run' && t.runPresence !== 'missing_in_run') return false;
      if (
        tableFilter === 'dead_or_placeholder' &&
        t.runPresence !== 'unused_enum' &&
        t.runPresence !== 'placeholder'
      ) {
        return false;
      }
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.fileNames.some((f) => f.toLowerCase().includes(q)) ||
        t.catalogFields.some((f) => f.name.toLowerCase().includes(q)) ||
        t.drivenOperators.some((o) => o.name.toLowerCase().includes(q) || o.id.toLowerCase().includes(q))
      );
    });
  }, [profile, tableFilter, tableSearch]);

  if (loading && !profile) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">
        正在读取当前 Run 磁盘来源表与 BS JSONL 帧路径统计...
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-300">
        来源文件剖析失败：{errorMsg}
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">
        请先选择或导入一个仿真 Run，系统将实时对账其底层 CSV 来源表与 BS JSONL 帧路径。
      </div>
    );
  }

  const { runMeta, csvProfile, bsProfile } = profile;
  const bsPopulatedCount = bsProfile.pathMetrics.filter((m) => m.hitFrames > 0).length;
  const wrapperEntries = Object.entries(bsProfile.unitWrapperTypes);

  return (
    <div className="space-y-4">
      {!runMeta.sourceAvailable && runMeta.sourceMissingReason && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="min-w-0 leading-relaxed">{runMeta.sourceMissingReason}</div>
        </div>
      )}

      {/* 顶部来源基座 KPI 概览卡 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <FolderOpen className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>来源格式与磁盘定位</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-slate-100 font-mono">
              {runMeta.sourceKind}
            </span>
            {csvProfile.maxBomCount > 1 && (
              <span className="px-1.5 py-0.5 rounded text-[11px] bg-amber-500/15 text-amber-300 border border-amber-500/35">
                双 BOM×{csvProfile.maxBomCount}
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 break-all" title={runMeta.scenarioPath}>
            {runSummary?.scenarioName ?? runMeta.scenarioName}
            {runMeta.timelineId ? ` · Timeline ${runMeta.timelineId.slice(0, 8)}...` : ''}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>CSV 表覆盖（vs {runMeta.totalCatalogEvents} 标准）</span>
          </div>
          <div className="text-2xl font-bold text-slate-100">
            {csvProfile.statusSummary.activeWithRows}
            <span className="text-sm font-normal text-slate-400">
              {' '}
              / {runMeta.totalCatalogEvents} 有数据
            </span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            仅表头 {csvProfile.statusSummary.emptyHeaderOnly} · 未触发{' '}
            {csvProfile.statusSummary.missingInRun} · 死枚举{' '}
            {csvProfile.statusSummary.unusedEnum}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <Database className="w-4 h-4 text-sky-400 shrink-0" />
            <span>CSV 磁盘体积与行规模</span>
          </div>
          <div className="text-2xl font-bold text-slate-100">
            {csvProfile.totalDataRows.toLocaleString()}
            <span className="text-sm font-normal text-slate-400"> 行</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {csvProfile.discoveredFileCount} 个文件 · {formatBytes(csvProfile.totalBytes)}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <Radio className="w-4 h-4 text-violet-400 shrink-0" />
            <span>BS JSONL 帧与路径命中</span>
          </div>
          <div className="text-2xl font-bold text-slate-100">
            {bsProfile.fileExists ? `${bsPopulatedCount}/${bsProfile.pathMetrics.length}` : '0 帧'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {bsProfile.fileExists
              ? `已解析 ${bsProfile.parsedFrames}/${bsProfile.totalLines} 帧 (${formatBytes(bsProfile.bytes)})`
              : '仅提供 7 族 BS MQTT 规范对照'}
          </div>
        </div>
      </div>

      {/* Part 1: EventExporter CSV 来源表统计与 44 表对照 */}
      <section
        className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 space-y-4 min-w-0"
        aria-labelledby="csv-source-section-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 id="csv-source-section-title" className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              EventExporter CSV 来源表统计与 {runMeta.totalCatalogEvents} 标准事件对照
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              目录：
              <span className="font-mono text-slate-300 break-all">
                {csvProfile.csvDir ?? '（当前 Run 无 CSV 导出目录）'}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
              目录版本 v{runMeta.catalogVersion}
            </span>
            <span className="px-2 py-0.5 rounded border border-slate-700 bg-slate-950/80 text-slate-300">
              BOM 文件数 {csvProfile.bomFilesCount}/{csvProfile.discoveredFileCount}
            </span>
          </div>
        </div>

        {/* 双图统计：左 44 标准事件分布 + 右 本局文件行数排行 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3 min-w-0">
            <div className="text-xs font-medium text-slate-300 mb-1">
              F1 标准 {runMeta.totalCatalogEvents} 类导出事件状态占比
            </div>
            <EChartPanel option={catalogPieOption} height={260} />
          </div>

          <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3 min-w-0">
            <div className="text-xs font-medium text-slate-300 mb-1">
              本局已导出 CSV 表真实行数分布
            </div>
            {csvProfile.discoveredFileCount > 0 ? (
              <EChartPanel option={csvRowsBarOption} height={260} />
            ) : (
              <div className="h-[260px] flex flex-col items-center justify-center text-center px-4 text-xs text-slate-400 gap-2">
                <FileSpreadsheet className="w-8 h-8 text-slate-600" />
                <p>当前 Run ({runMeta.sourceKind}) 磁盘未发现 .csv 文件。</p>
                <p className="text-slate-500">
                  下方仍保留全部 {runMeta.totalCatalogEvents} 类 EventExporter 标准事件字段与 D1–D7 约束供核查，或切换 Run 查看 GJ11-PL15 实证 CSV。
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 过滤与检索栏 */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['all', `全部 (${csvProfile.tables.length})`],
                ['active_with_rows', `有数据 (${csvProfile.statusSummary.activeWithRows})`],
                ['empty_header_only', `仅表头 (${csvProfile.statusSummary.emptyHeaderOnly})`],
                ['missing_in_run', `本局未导出 (${csvProfile.statusSummary.missingInRun})`],
                [
                  'dead_or_placeholder',
                  `死枚举/占位 (${csvProfile.statusSummary.unusedEnum + csvProfile.statusSummary.placeholder})`,
                ],
              ] as Array<[TableFilter, string]>
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTableFilter(k)}
                className={`px-2.5 py-1 rounded-md text-xs border transition ${
                  tableFilter === k
                    ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/50'
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="relative flex items-center text-xs">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 pointer-events-none" />
            <input
              type="search"
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="筛选表名 / 列名 / 算子..."
              aria-label="筛选 CSV 来源表"
              className="pl-8 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-200 w-56 max-w-full"
            />
          </label>
        </div>

        {/* 44 类来源表对比矩阵 */}
        <div
          tabIndex={0}
          role="region"
          aria-labelledby="csv-matrix-caption"
          className="responsive-table-wrap responsive-table-scroll-y rounded-lg border border-slate-800/80 bg-slate-950/50"
        >
          <table className="w-full text-xs text-left">
            <caption id="csv-matrix-caption" className="sr-only">
              EventExporter 来源表与 F1 标准目录对照表
            </caption>
            <thead className="text-slate-400 border-b border-slate-800">
              <tr>
                <th scope="col" className="px-2.5 py-2 font-medium">
                  标准事件表
                </th>
                <th scope="col" className="px-2.5 py-2 font-medium">
                  本局状态
                </th>
                <th scope="col" className="px-2.5 py-2 font-medium hide-narrow-col">
                  行数 / 体积 / BOM
                </th>
                <th scope="col" className="px-2.5 py-2 font-medium hide-narrow-col">
                  列对齐 (实有/规范)
                </th>
                <th scope="col" className="px-2.5 py-2 font-medium hide-narrow-col">
                  关联算子
                </th>
                <th scope="col" className="px-2.5 py-2 font-medium text-right">
                  查看
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {filteredTables.map((t) => {
                const pm = PRESENCE_META[t.runPresence];
                const isSelected = inspectedTable?.name === t.name;
                return (
                  <tr
                    key={`${t.catalogId ?? 'x'}-${t.name}`}
                    className={`hover:bg-slate-800/35 ${isSelected ? 'bg-cyan-500/10' : ''}`}
                  >
                    <th scope="row" className="px-2.5 py-2 font-normal align-top">
                      <div className="font-mono text-slate-100 font-medium">
                        {t.catalogId !== null ? `#${t.catalogId} ` : ''}
                        {t.name}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-0.5 text-[10px] text-slate-500">
                        {t.dbTable && <span className="px-1 rounded bg-slate-800">DB表</span>}
                        {t.tacview && <span className="px-1 rounded bg-slate-800">Tacview</span>}
                        {t.sideSplitKey && (
                          <span className="px-1 rounded bg-slate-800">Side:{t.sideSplitKey}</span>
                        )}
                      </div>
                    </th>
                    <td className="px-2.5 py-2 align-top whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded border text-[11px] ${pm.badgeClass}`}>
                        {pm.label}
                      </span>
                    </td>
                    <td className="px-2.5 py-2 align-top hide-narrow-col font-mono text-slate-300">
                      {t.fileNames.length > 0 ? (
                        <>
                          <div>
                            {t.rowCount} 行 · {formatBytes(t.bytes)}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            BOM×{t.bomCount} · {t.fileNames.join(', ')}
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2 align-top hide-narrow-col">
                      <div className="font-mono text-slate-300">
                        {t.actualHeaders.length > 0
                          ? `${t.actualHeaders.length} 列 / 规范 ${t.expectedHeaders.length} 列`
                          : `规范 ${t.expectedHeaders.length} 列`}
                      </div>
                      {t.actualHeaders.length > 0 &&
                        t.missingColumns.length === 0 &&
                        t.extraColumns.length === 0 && (
                          <span className="text-[11px] text-emerald-400">字段完全对齐</span>
                        )}
                      {t.missingColumns.length > 0 && (
                        <span className="text-[11px] text-amber-300 mr-2">
                          缺 {t.missingColumns.length} 列
                        </span>
                      )}
                      {t.extraColumns.length > 0 && (
                        <span className="text-[11px] text-cyan-300">
                          +{t.extraColumns.length} 扩展列
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top hide-narrow-col">
                      {t.drivenOperators.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {t.drivenOperators.map((op) => (
                            <span
                              key={op.id}
                              title={`${op.name} (${op.category})`}
                              className={`px-1.5 py-0.5 rounded text-[10px] border ${
                                op.readiness === 'batch_a_ready'
                                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                                  : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                              }`}
                            >
                              {op.id}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-right whitespace-nowrap">
                      <div className="inline-flex gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setInspectedTable(isSelected ? null : t)
                          }
                          className="px-2 py-1 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-[11px] text-slate-200"
                        >
                          字段
                        </button>
                        {t.fileNames.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setPreviewTable(t.name)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-cyan-500/40 bg-cyan-500/15 hover:bg-cyan-500/25 text-[11px] text-cyan-200"
                          >
                            <Eye className="w-3 h-3" />
                            预览
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredTables.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                    无匹配的导出事件表
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 内联字段定义检查抽屉 */}
        {inspectedTable && (
          <div className="rounded-lg border border-cyan-500/35 bg-slate-950/90 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-cyan-200 font-mono">
                表结构详情：{inspectedTable.name} ({inspectedTable.catalogFields.length} 规范业务字段)
              </div>
              <button
                type="button"
                onClick={() => setInspectedTable(null)}
                aria-label="关闭表结构详情"
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {inspectedTable.gating && (
              <div className="text-[11px] text-slate-400 font-mono break-all">
                引擎门控条件：{inspectedTable.gating}
              </div>
            )}
            {inspectedTable.note && (
              <div className="text-[11px] text-amber-300">实证备注：{inspectedTable.note}</div>
            )}
            {inspectedTable.missingColumns.length > 0 && (
              <div className="text-[11px] text-amber-300">
                本局缺失列：{inspectedTable.missingColumns.join(', ')}
              </div>
            )}
            {inspectedTable.extraColumns.length > 0 && (
              <div className="text-[11px] text-cyan-300">
                本局新增/扩展列：{inspectedTable.extraColumns.join(', ')}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
              {inspectedTable.catalogFields.map((f) => (
                <span
                  key={f.name}
                  title={f.note ?? `${f.cs_type ?? ''} -> ${f.db_type ?? '无DB列'}`}
                  className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-300"
                >
                  {f.name}
                  {f.unit ? ` (${f.unit})` : ''}
                  {f.cs_type ? `: ${f.cs_type}` : ''}
                </span>
              ))}
              {inspectedTable.catalogFields.length === 0 && (
                <span className="text-xs text-slate-500">该占位/死枚举无导出字段。</span>
              )}
            </div>
          </div>
        )}

        {/* 原始 CSV 前 50 行在线预览 */}
        {previewTable && (
          <div className="rounded-lg border border-sky-500/40 bg-slate-950/90 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-sky-200 font-mono">
                原始 CSV 行预览：{previewTable}
                {profile.csvProfile.preview &&
                  ` （显示前 ${profile.csvProfile.preview.rows.length} / 共 ${profile.csvProfile.preview.totalRows} 行）`}
              </div>
              <button
                type="button"
                onClick={() => setPreviewTable(undefined)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-700 text-[11px] text-slate-300 hover:bg-slate-800"
              >
                <X className="w-3 h-3" /> 收起预览
              </button>
            </div>
            {previewLoading ? (
              <div className="py-4 text-xs text-slate-400">正在流式解析前 50 行 CSV 记录...</div>
            ) : profile.csvProfile.preview ? (
              <div
                tabIndex={0}
                role="region"
                aria-label={`${previewTable} 原始数据预览`}
                className="responsive-table-wrap responsive-table-scroll-y rounded border border-slate-800 bg-slate-950"
              >
                <table className="w-full text-[11px] text-left font-mono">
                  <thead className="text-slate-400 border-b border-slate-800">
                    <tr>
                      <th scope="col" className="px-2 py-1.5 whitespace-nowrap">
                        #行
                      </th>
                      {profile.csvProfile.preview.headers.map((h) => (
                        <th key={h} scope="col" className="px-2 py-1.5 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {profile.csvProfile.preview.rows.map((r, idx) => (
                      <tr key={`${r.file}-${r.line}-${idx}`} className="hover:bg-slate-900/70">
                        <th scope="row" className="px-2 py-1 text-slate-500 whitespace-nowrap font-normal">
                          L{r.line}
                        </th>
                        {profile.csvProfile.preview!.headers.map((h) => (
                          <td
                            key={h}
                            title={r.data[h] ?? ''}
                            className="px-2 py-1 text-slate-300 whitespace-nowrap max-w-[220px] truncate"
                          >
                            {r.data[h] || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-3 text-xs text-slate-500">该表当前无可预览数据行。</div>
            )}
          </div>
        )}
      </section>

      {/* Part 2: BS JSONL 帧路径统计与 7 族路径规范手风琴 */}
      <section
        className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 space-y-4 min-w-0"
        aria-labelledby="bs-source-section-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 id="bs-source-section-title" className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Layers className="w-4 h-4 text-violet-400" />
              BS JSONL 帧路径命中率与 7 族规范结构（D2 / D3 / Batch B 门控）
            </h3>
            <p className="text-xs text-slate-400 mt-0.5 break-all">
              源文件：
              <span className="font-mono text-slate-300">
                {bsProfile.jsonlFile ?? '（当前 Run 无关联磁盘 JSONL）'}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="px-2 py-0.5 rounded border border-violet-500/35 bg-violet-500/10 text-violet-200">
              解析 {bsProfile.parsedFrames} 帧 · 错误 {bsProfile.parseErrors}
            </span>
            <span className="px-2 py-0.5 rounded border border-slate-700 bg-slate-950 text-slate-300">
              字符串标量帧 {bsProfile.stringifiedScalarFrames}/{bsProfile.parsedFrames}
            </span>
            <span className="px-2 py-0.5 rounded border border-slate-700 bg-slate-950 text-slate-300">
              单键包装帧 {bsProfile.singleKeyWrapperFrames}/{bsProfile.parsedFrames}
            </span>
          </div>
        </div>

        {wrapperEntries.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-slate-400">ActiveUnits 类型包装分布：</span>
            {wrapperEntries.map(([k, v]) => (
              <span
                key={k}
                className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 font-mono text-cyan-300"
              >
                {k}: {v}
              </span>
            ))}
          </div>
        )}

        {/* BS 路径命中率横向柱状图 */}
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3 min-w-0">
          <div className="text-xs font-medium text-slate-300 mb-1">
            BS 关键数据路径跨帧命中率（绿色 = 帧实有，琥珀 = Batch B 算子门控空缺 0%）
          </div>
          <EChartPanel option={bsPathHitOption} height={380} />
        </div>

        {/* 7 族场景路径原生手风琴（<details>，不在 <summary> 内放标题） */}
        <section className="source-accordion space-y-2" aria-labelledby="bs-families-heading">
          <h4 id="bs-families-heading" className="text-xs font-semibold text-slate-300">
            BS MQTT Scenario 7 族路径实测与规范清单
          </h4>
          {bsProfile.familyCatalog.map((fam) => {
            const familyMetrics = bsProfile.pathMetrics.filter((m) => m.family === fam.key);
            const defaultOpen = fam.key === 'unit_fields' || fam.key === 'side_fields';
            return (
              <details
                key={fam.key}
                open={defaultOpen}
                className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2"
              >
                <summary className="text-xs font-medium text-slate-200 py-0.5">
                  <ChevronRight className="accordion-chevron w-4 h-4 text-slate-400" />
                  <span className="font-mono text-cyan-300">{fam.key}</span>
                  <span>{fam.label}</span>
                  <span className="ml-auto px-2 py-0.5 rounded text-[11px] bg-slate-900 border border-slate-800 text-slate-300">
                    {bsProfile.fileExists
                      ? `实测命中 ${fam.populatedPathsCount}/${fam.totalTrackedCount}`
                      : `追踪 ${fam.totalTrackedCount} 项规范路径`}
                  </span>
                </summary>

                <div className="pt-2.5 pb-1 space-y-2.5 border-t border-slate-800/70 mt-2">
                  <div className="flex flex-wrap gap-1.5">
                    {fam.rawPaths.map((p) => (
                      <span
                        key={p}
                        className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-[11px] text-slate-400 break-all"
                      >
                        {p}
                      </span>
                    ))}
                  </div>

                  {familyMetrics.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {familyMetrics.map((m) => {
                        const hitPct = bsProfile.fileExists ? Math.round(m.hitRate * 100) : null;
                        return (
                          <div
                            key={m.id}
                            className="rounded border border-slate-800/80 bg-slate-900/60 p-2.5 text-xs space-y-1 min-w-0"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-slate-100 break-all">{m.pathExpr}</span>
                              {hitPct !== null ? (
                                <span
                                  className={`shrink-0 px-1.5 py-0.5 rounded text-[11px] font-mono ${
                                    m.hitFrames > 0
                                      ? 'bg-emerald-500/15 text-emerald-300'
                                      : 'bg-amber-500/15 text-amber-300'
                                  }`}
                                >
                                  {m.hitFrames}/{m.totalFrames} ({hitPct}%)
                                </span>
                              ) : (
                                <span className="shrink-0 px-1.5 py-0.5 rounded text-[11px] bg-slate-800 text-slate-400">
                                  规范路径
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400">{m.label}</div>
                            {m.sampleValue && (
                              <div className="text-[11px] font-mono text-slate-500 break-all">
                                样例：{m.sampleValue}
                              </div>
                            )}
                            {m.discrepancyNote && (
                              <div className="text-[11px] text-amber-300/90">{m.discrepancyNote}</div>
                            )}
                            {m.drivenOperators.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-0.5">
                                {m.drivenOperators.map((op) => (
                                  <span
                                    key={op.id}
                                    className={`px-1.5 py-0.5 rounded text-[10px] border ${
                                      op.readiness === 'batch_a_ready'
                                        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                                        : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                    }`}
                                  >
                                    {op.id} · {op.readiness === 'batch_a_ready' ? 'Batch A' : 'Batch B 门控'}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </section>

        {/* BS MQTT 11 Topics 规范速览 */}
        <div className="pt-1">
          <div className="text-[11px] text-slate-400 mb-1.5">
            BS MQTT / WebSocket 全部 {bsProfile.topics.length} 个订阅主题（sim-output-fields 实证清单）：
          </div>
          <div className="flex flex-wrap gap-1.5">
            {bsProfile.topics.map((topic) => (
              <span
                key={topic}
                className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300"
              >
                {topic}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
