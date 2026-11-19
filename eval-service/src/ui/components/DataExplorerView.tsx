import type * as echarts from 'echarts';
import {
  AlertTriangle,
  Download,
  FileUp,
  MapPin,
  Search,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import {
  evalApi,
  type F1OutputCatalog,
  type StoredRunSummary,
  type StructuredSimEvent,
} from '../api.ts';
import { EChartPanel } from './EChartPanel.tsx';
import { SourceProfilePanel } from './SourceProfilePanel.tsx';

interface DataExplorerViewProps {
  runs: StoredRunSummary[];
  catalog?: F1OutputCatalog | null;
  selectedRunId: string;
  onSelectRun: (runId: string) => void;
  onRefresh: () => Promise<void>;
}

export function DataExplorerView({
  runs,
  catalog = null,
  selectedRunId,
  onSelectRun,
  onRefresh,
}: DataExplorerViewProps) {
  const [subTab, setSubTab] = useState<'sources' | 'sqlite'>('sources');
  const sourceTabRef = useRef<HTMLButtonElement | null>(null);
  const sqliteTabRef = useRef<HTMLButtonElement | null>(null);
  const selectedRunSummary = useMemo(
    () => runs.find((r) => r.runId === selectedRunId),
    [runs, selectedRunId],
  );

  const handleSubTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next: 'sources' | 'sqlite' =
      e.key === 'Home'
        ? 'sources'
        : e.key === 'End'
          ? 'sqlite'
          : subTab === 'sources'
            ? 'sqlite'
            : 'sources';
    setSubTab(next);
    (next === 'sources' ? sourceTabRef.current : sqliteTabRef.current)?.focus();
  };

  const [dbStats, setDbStats] = useState<{
    dbPath: string;
    dbBytes: number;
    counts: Record<string, number>;
  } | null>(null);
  const [tracks, setTracks] = useState<
    Array<{
      unitId: string;
      unitName: string;
      side: string;
      unitClass: string;
      damageState: string;
      points: Array<{ scenarioSeconds: number; lon: number; lat: number; altitudeM: number | null }>;
    }>
  >([]);
  const [trackSideFilter, setTrackSideFilter] = useState<'all' | 'red' | 'blue'>('all');
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');

  const [events, setEvents] = useState<StructuredSimEvent[]>([]);
  const [eventTotal, setEventTotal] = useState(0);
  const [kindFilter, setKindFilter] = useState('');
  const [eventSearch, setEventSearch] = useState('');
  const [fallbackDiscrepancies, setFallbackDiscrepancies] = useState<string[]>([]);
  const discrepancies = useMemo(
    () => catalog?.doc_discrepancies ?? fallbackDiscrepancies,
    [catalog, fallbackDiscrepancies],
  );

  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refreshMetadata = async () => {
    try {
      const h = await evalApi.getHealth();
      setDbStats(h.db);
      if (!catalog) {
        const cat = await evalApi.getFieldsCatalog();
        if (Array.isArray(cat.catalog.doc_discrepancies)) {
          setFallbackDiscrepancies(cat.catalog.doc_discrepancies);
        }
      }
    } catch {
      // 忽略次要拉取错误
    }
  };

  const refreshRunData = async (runId: string) => {
    if (!runId) return;
    try {
      const [tr, ev] = await Promise.all([
        evalApi.getRunTracks(runId),
        evalApi.getRunEvents(runId, { kind: kindFilter || undefined, search: eventSearch || undefined, limit: 150 }),
      ]);
      setTracks(tr.tracks);
      setEvents(ev.events);
      setEventTotal(ev.total);
    } catch (e) {
      setImportMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  };

  useEffect(() => {
    void refreshMetadata();
  }, [runs.length]);

  useEffect(() => {
    void refreshRunData(selectedRunId);
  }, [selectedRunId, kindFilter, eventSearch]);

  const handleUploadJsonl = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const text = await file.text();
      const res = await evalApi.importRun({
        kind: 'jsonl_text',
        scenarioName: file.name,
        text,
      });
      await onRefresh();
      await refreshMetadata();
      onSelectRun(res.runId);
      setImportMsg({
        kind: 'ok',
        text: `已导入本地 JSONL「${file.name}」：识别 ${res.unitCount} 单元 / ${res.eventCount} 事件`,
      });
    } catch (err) {
      setImportMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setImporting(false);
      ev.target.value = '';
    }
  };

  const filteredTracks = useMemo(() => {
    let list = tracks.filter((t) => t.points.length > 0);
    if (trackSideFilter === 'red') {
      list = list.filter((t) => t.side === '红方' || t.side.toLowerCase() === 'red');
    } else if (trackSideFilter === 'blue') {
      list = list.filter((t) => t.side === '蓝方' || t.side.toLowerCase() === 'blue');
    }
    return list;
  }, [tracks, trackSideFilter]);

  const selectedUnitEvents = useMemo(() => {
    if (!selectedUnitId) return [];
    const unit = tracks.find((t) => t.unitId === selectedUnitId);
    if (!unit) return [];
    const uName = unit.unitName.toLowerCase();
    const uId = unit.unitId.toLowerCase();
    return events.filter(
      (e) =>
        (e.subject && (e.subject.toLowerCase().includes(uName) || e.subject.toLowerCase().includes(uId))) ||
        (e.object && (e.object.toLowerCase().includes(uName) || e.object.toLowerCase().includes(uId))),
    );
  }, [selectedUnitId, tracks, events]);

  const handleExportEventsCsv = () => {
    if (events.length === 0) return;
    const headers = ['推演时钟', '阵营', '事件类型', '主体', '客体', '记录Ref', '原始ID'];
    const rows = events.map((ev) => [
      `"${String(ev.clockText ?? '').replace(/"/g, '""')}"`,
      `"${String(ev.side ?? '').replace(/"/g, '""')}"`,
      `"${String(ev.kind ?? '').replace(/"/g, '""')}"`,
      `"${String(ev.subject ?? '').replace(/"/g, '""')}"`,
      `"${String(ev.object ?? '').replace(/"/g, '""')}"`,
      `"${String(ev.ref ?? '').replace(/"/g, '""')}"`,
      `"${String(ev.eventId ?? '').replace(/"/g, '""')}"`,
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simulation_events_${selectedRunId}_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const trackChartOption = useMemo<echarts.EChartsOption>(() => {
    if (filteredTracks.length === 0) {
      return {
        backgroundColor: 'transparent',
        title: {
          text: tracks.length === 0 ? '该 Run 暂无经纬度轨迹样本' : '当前阵营筛选下无轨迹样本',
          left: 'center',
          top: 'middle',
          textStyle: { color: '#64748b', fontSize: 13 },
        },
      };
    }

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: (params: unknown) => {
          const p = params as { seriesName?: string; data?: [number, number, number] };
          const d = p.data;
          if (!d) return p.seriesName ?? '';
          return `${p.seriesName}<br/>经度: ${d[0].toFixed(4)}°<br/>纬度: ${d[1].toFixed(4)}°<br/>时刻: ${d[2].toFixed(1)}s`;
        },
      },
      legend: {
        type: 'scroll',
        bottom: 0,
        textStyle: { color: '#cbd5e1', fontSize: 10 },
      },
      grid: { left: 54, right: 20, top: 24, bottom: 52 },
      xAxis: {
        type: 'value',
        scale: true,
        name: '经度 (°E)',
        axisLabel: { color: '#94a3b8', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,0.12)' } },
      },
      yAxis: {
        type: 'value',
        scale: true,
        name: '纬度 (°N)',
        axisLabel: {
          color: '#94a3b8',
          fontSize: 10,
          formatter: (v: number) => v.toFixed(2),
        },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,0.12)' } },
      },
      series: filteredTracks.slice(0, 20).map((t) => {
        const isRed = t.side === '红方' || t.side.toLowerCase() === 'red';
        const isHighlighted = selectedUnitId ? t.unitId === selectedUnitId : false;
        const isDimmed = selectedUnitId ? t.unitId !== selectedUnitId : false;

        const baseColor = isRed ? '#fb7185' : '#38bdf8';
        const lineWidth = isHighlighted ? 3.5 : isDimmed ? 1.0 : 2.0;
        const opacity = isDimmed ? 0.3 : 1.0;
        const symbolSize = isHighlighted ? 8 : 6;

        return {
          name: `${t.unitName} (${t.side})`,
          type: 'line',
          showSymbol: isHighlighted || t.points.length <= 8,
          symbolSize,
          lineStyle: {
            width: lineWidth,
            type: t.damageState === 'destroyed' ? 'dashed' : 'solid',
            color: baseColor,
            opacity,
          },
          itemStyle: { color: baseColor, opacity },
          data: t.points.map((pt) => [pt.lon, pt.lat, pt.scenarioSeconds]),
        };
      }),
    };
  }, [filteredTracks, tracks.length, selectedUnitId]);

  return (
    <div className="space-y-4">
      {/* 单局 Run 切换上下文条与二级视角切换标签 */}
      <div className="rounded-lg border border-[#2a313c] bg-[#161b22] px-4 pt-3 pb-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-100">
              单局推演数据与字段覆盖情况
            </h2>
            <p className="text-xs text-[#8b949e] mt-0.5">
              统计所选场次 CSV 导出表（44 类标准事件）与状态帧字段命中率，并支持航迹与事件检索
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-300 shrink-0">
            <span className="text-[#8b949e] shrink-0 whitespace-nowrap">推演样本：</span>
            <select
              aria-label="选择要剖析的推演 Run"
              value={selectedRunId}
              onChange={(e) => onSelectRun(e.target.value)}
              className="px-2.5 py-1.5 rounded-md bg-[#0f141a] border border-[#30363d] text-xs text-slate-100 max-w-[260px] truncate"
            >
              {runs.map((r) => (
                <option key={r.runId} value={r.runId}>
                  {r.scenarioName} ({r.sourceKind === "csv_dir" ? "CSV 目录" : r.sourceKind === "jsonl_file" ? "JSONL 状态帧" : r.sourceKind})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="单局数据资产与来源剖析子标签"
          onKeyDown={handleSubTabKeyDown}
          className="subtab-bar border-b border-[#262d38]"
        >
          <button
            ref={sourceTabRef}
            id="data-subtab-sources"
            type="button"
            role="tab"
            aria-selected={subTab === 'sources'}
            aria-controls="data-panel-sources"
            tabIndex={subTab === 'sources' ? 0 : -1}
            onClick={() => setSubTab('sources')}
            className="subtab-btn"
          >
            单局源文件剖析
          </button>
          <button
            ref={sqliteTabRef}
            id="data-subtab-sqlite"
            type="button"
            role="tab"
            aria-selected={subTab === 'sqlite'}
            aria-controls="data-panel-sqlite"
            tabIndex={subTab === 'sqlite' ? 0 : -1}
            onClick={() => setSubTab('sqlite')}
            className="subtab-btn"
          >
            航迹、事件与 eval.db
          </button>
        </div>
      </div>

      <section
        id="data-panel-sources"
        role="tabpanel"
        aria-labelledby="data-subtab-sources"
        hidden={subTab !== 'sources'}
      >
        <div className="space-y-4">
          <SourceProfilePanel runId={selectedRunId} runSummary={selectedRunSummary} />
        </div>
      </section>

      <section
        id="data-panel-sqlite"
        role="tabpanel"
        aria-labelledby="data-subtab-sqlite"
        hidden={subTab !== 'sqlite'}
      >
        <div className="space-y-4">
          {/* SQLite eval.db 冷热库统计条 */}
      {dbStats && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3">
            <span className="text-xs text-[#8b949e]">推演局数 (Runs)</span>
            <p className="tabular-nums mt-1 text-xl font-semibold text-blue-300">
              {dbStats.counts.runs ?? 0}
            </p>
          </div>
          <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3">
            <span className="text-xs text-[#8b949e]">事件记录 (Events)</span>
            <p className="tabular-nums mt-1 text-xl font-semibold text-slate-100">
              {dbStats.counts.events ?? 0}
            </p>
          </div>
          <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3">
            <span className="text-xs text-[#8b949e]">轨迹采样 (UnitStates)</span>
            <p className="tabular-nums mt-1 text-xl font-semibold text-emerald-300">
              {dbStats.counts.unitStates ?? 0}
            </p>
          </div>
          <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3">
            <span className="text-xs text-[#8b949e]">评估快照 (Evals)</span>
            <p className="tabular-nums mt-1 text-xl font-semibold text-amber-300">
              {dbStats.counts.evaluations ?? 0}
            </p>
          </div>
          <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3">
            <span className="text-xs text-[#8b949e]">数据库体积</span>
            <p className="tabular-nums mt-1 text-xl font-semibold text-slate-200">
              {dbStats.dbBytes >= 1024 * 1024 ? `${(dbStats.dbBytes / (1024 * 1024)).toFixed(2)} MB` : `${(dbStats.dbBytes / 1024).toFixed(1)} KB`}
            </p>
          </div>
        </section>
      )}

      {/* 快捷操作与数据源引导条 */}
      <section className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-[#8b949e]">
            如需添加外部目录或切换全局默认测试数据，请使用页面右上角「测试数据」配置中心。
          </span>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#30363d] bg-[#0f141a] px-3 py-1.5 text-xs text-slate-200 hover:border-slate-500">
            <FileUp className="h-3.5 w-3.5 text-emerald-400" />
            上传本地 JSONL
            <input
              type="file"
              accept=".jsonl,.txt,.log"
              className="sr-only"
              onChange={handleUploadJsonl}
            />
          </label>
        </div>

        {importMsg && (
          <p
            className={`mt-2.5 rounded p-2 text-xs ${
              importMsg.kind === 'ok'
                ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                : 'border border-rose-500/40 bg-rose-500/10 text-rose-200'
            }`}
          >
            {importMsg.text}
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
        {/* 空间经纬度轨迹图 */}
        <section className="min-w-0 rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5 lg:col-span-6 panel-isolate">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
              <MapPin className="h-4 w-4 text-blue-400" />
              单元空间航迹回放
            </h3>
            <span className="text-xs text-[#8b949e] truncate max-w-[220px]">
              {selectedRunSummary?.scenarioName ?? selectedRunId}
            </span>
          </div>

          {/* 阵营过滤与单机高亮交互栏 */}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1 bg-[#0f141a] border border-[#30363d] rounded p-0.5">
              <button
                type="button"
                onClick={() => setTrackSideFilter('all')}
                className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                  trackSideFilter === 'all'
                    ? 'bg-[#21262d] text-slate-100 font-medium'
                    : 'text-[#8b949e] hover:text-slate-300'
                }`}
              >
                全阵营 ({tracks.length})
              </button>
              <button
                type="button"
                onClick={() => setTrackSideFilter('red')}
                className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                  trackSideFilter === 'red'
                    ? 'bg-rose-500/20 text-rose-300 font-medium'
                    : 'text-[#8b949e] hover:text-rose-300'
                }`}
              >
                红方
              </button>
              <button
                type="button"
                onClick={() => setTrackSideFilter('blue')}
                className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                  trackSideFilter === 'blue'
                    ? 'bg-sky-500/20 text-sky-300 font-medium'
                    : 'text-[#8b949e] hover:text-sky-300'
                }`}
              >
                蓝方
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <select
                aria-label="高亮单机航迹"
                value={selectedUnitId}
                onChange={(e) => setSelectedUnitId(e.target.value)}
                className="px-2 py-1 rounded bg-[#0f141a] border border-[#30363d] text-[11px] text-slate-100 max-w-[170px] truncate"
              >
                <option value="">全部平台 (高亮单机...)</option>
                {filteredTracks.map((t) => (
                  <option key={t.unitId} value={t.unitId}>
                    {t.unitName} ({t.side})
                  </option>
                ))}
              </select>
              {selectedUnitId && (
                <button
                  type="button"
                  onClick={() => setSelectedUnitId('')}
                  className="text-[11px] text-slate-400 hover:text-slate-200 underline"
                >
                  重置
                </button>
              )}
            </div>
          </div>

          <EChartPanel option={trackChartOption} height={310} />

          {/* 高亮单机关键事件时序时间点卡片 */}
          {selectedUnitId && (
            <div className="mt-2.5 rounded border border-blue-500/30 bg-blue-500/5 p-2 text-xs space-y-1">
              <div className="flex items-center justify-between text-blue-300 font-medium">
                <span>
                  平台事件时序：{tracks.find((t) => t.unitId === selectedUnitId)?.unitName}（共 {selectedUnitEvents.length} 条关联事件）
                </span>
              </div>
              {selectedUnitEvents.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto pt-0.5">
                  {selectedUnitEvents.slice(0, 8).map((ev) => (
                    <span
                      key={ev.eventId}
                      className="px-1.5 py-0.5 rounded bg-[#0f141a] border border-[#30363d] text-[10px] text-slate-300 font-mono"
                      title={`${ev.clockText} ${ev.kind}: ${ev.subject} -> ${ev.object ?? ''}`}
                    >
                      <span className="text-amber-400">{ev.clockText}</span> <span className="text-blue-300">{ev.kind}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-slate-500">该单元暂无独立关联触发事件。</div>
              )}
            </div>
          )}
        </section>

        {/* 实证偏差 D1-D9 备忘卡 */}
        <section className="min-w-0 rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5 lg:col-span-6 panel-isolate">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-300">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              字段契约与实测偏差说明 (D1–D9)
            </h3>
            <span className="text-[11px] text-slate-400">
              详见「输出字段规范」全局字典
            </span>
          </div>
          <div className="max-h-[310px] space-y-1.5 overflow-y-auto pr-1 text-xs">
            {discrepancies.map((item, i) => (
              <div
                key={i}
                className="rounded border border-[#262d38] bg-[#0f141a] p-2.5 leading-relaxed text-slate-300"
              >
                {item}
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* simulation_events 数据库明细检索表 */}
      <section className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5 panel-isolate">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
          <h3 className="tabular-nums text-sm font-semibold text-slate-100">
            推演事件明细 simulation_events（共 {eventTotal} 条，显示前 {events.length} 条）
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className="rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100"
            >
              <option value="">全部事件类型</option>
              <option value="weapon_fired">weapon_fired (开火)</option>
              <option value="weapon_endgame">weapon_endgame (终局)</option>
              <option value="unit_damaged">unit_damaged (损伤)</option>
              <option value="unit_destroyed">unit_destroyed (被毁)</option>
              <option value="detection_new">detection_new (首次侦获)</option>
              <option value="unit_new">unit_new (创建)</option>
            </select>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[#8b949e]" />
              <input
                value={eventSearch}
                onChange={(e) => setEventSearch(e.target.value)}
                placeholder="检索主体 / 目标 / Ref…"
                className="rounded border border-[#30363d] bg-[#0f141a] py-1.5 pl-8 pr-3 text-slate-100"
              />
            </div>
            <button
              type="button"
              onClick={handleExportEventsCsv}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-[#30363d] bg-[#0f141a] hover:bg-[#21262d] text-slate-200 text-xs transition-colors"
              title="导出当前筛选结果为 CSV (含 UTF-8 BOM)"
            >
              <Download className="h-3.5 w-3.5 text-cyan-400" />
              导出当前事件 (CSV)
            </button>
          </div>
        </div>

        <div className="responsive-table-wrap max-h-80 overflow-y-auto rounded-md border border-[#2a313c]" tabIndex={0}>
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[#0f141a] text-[#8b949e]">
              <tr>
                <th scope="col" className="px-3 py-2">推演时钟</th>
                <th scope="col" className="px-3 py-2">阵营</th>
                <th scope="col" className="px-3 py-2">事件类型</th>
                <th scope="col" className="px-3 py-2">主体 -&gt; 客体</th>
                <th scope="col" className="px-3 py-2 hide-narrow-col">记录 Ref</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#262d38]">
              {events.map((ev) => (
                <tr key={ev.eventId} className="hover:bg-[#1c2128]">
                  <td className="tabular-nums whitespace-nowrap px-3 py-1.5 font-mono text-blue-300">
                    {ev.clockText}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-slate-300">{ev.side ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-amber-300">{ev.kind}</td>
                  <td className="px-3 py-1.5 text-slate-100">
                    {ev.subject ?? '—'}
                    {ev.object ? ` -> ${ev.object}` : ''}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[#8b949e] hide-narrow-col">{ev.ref}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
        </div>
      </section>
    </div>
  );
}
