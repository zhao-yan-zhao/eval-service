import type * as echarts from 'echarts';
import { BarChart3, Download, GitCompareArrows, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  evalApi,
  type MetricAtomMeta,
  type MetricAtomResult,
  type OperatorComparisonRow,
  type StoredRunSummary,
} from '../api.ts';
import { EChartPanel } from './EChartPanel.tsx';

interface OperatorBenchmarkPanelProps {
  operators: MetricAtomMeta[];
  runs: StoredRunSummary[];
  initialRunId: string;
}

const DOMAIN_ORDER = ['time', 'effectiveness', 'situation', 'compliance', 'cost'] as const;
const DOMAIN_NAMES: Record<string, string> = {
  time: '时效域 (time)',
  effectiveness: '效能域 (eff)',
  situation: '态势域 (sit)',
  compliance: '合规域 (comp)',
  cost: '成本域 (cost)',
};

function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(val: unknown): string {
  const s = String(val ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function statusPillClass(status: MetricAtomResult['status'] | undefined): string {
  if (status === 'valid') return 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30';
  if (status === 'degraded') return 'bg-amber-400/15 text-amber-200 border-amber-400/30';
  return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
}

export function OperatorBenchmarkPanel({
  operators,
  runs,
  initialRunId,
}: OperatorBenchmarkPanelProps) {
  const [runIdA, setRunIdA] = useState<string>(initialRunId || runs[0]?.runId || '');
  const [runIdB, setRunIdB] = useState<string>(
    runs.find((r) => r.runId !== (initialRunId || runs[0]?.runId))?.runId ??
      runs[0]?.runId ??
      '',
  );
  const [rows, setRows] = useState<OperatorComparisonRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'valid' | 'unavailable' | 'diff'>('all');
  const [search, setSearch] = useState('');

  const handleRunCompare = async () => {
    const a = runIdA || runs[0]?.runId;
    const b = runIdB || a;
    if (!a || !b) return;
    setLoading(true);
    setError(null);
    try {
      const res = await evalApi.compareOperatorsRuns(a, b);
      setRows(res.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const summary = useMemo(() => {
    const list = rows ?? [];
    const countStatus = (pick: (r: OperatorComparisonRow) => MetricAtomResult | undefined) => {
      let valid = 0;
      let degraded = 0;
      let unavailable = 0;
      for (const r of list) {
        const st = pick(r)?.status;
        if (st === 'valid') valid += 1;
        else if (st === 'degraded') degraded += 1;
        else unavailable += 1;
      }
      return { valid, degraded, unavailable };
    };
    return {
      a: countStatus((r) => r.runA),
      b: countStatus((r) => r.runB),
    };
  }, [rows]);

  const domainChartOption = useMemo<echarts.EChartsOption>(() => {
    const countsA = DOMAIN_ORDER.map((dom) => {
      if (!rows) return operators.filter((o) => o.category === dom).length;
      return rows.filter((r) => r.meta.category === dom && r.runA?.status === 'valid').length;
    });
    const countsB = DOMAIN_ORDER.map((dom) => {
      if (!rows) return operators.filter((o) => o.category === dom && o.readiness === 'batch_a_ready').length;
      return rows.filter((r) => r.meta.category === dom && r.runB?.status === 'valid').length;
    });
    const totalByDom = DOMAIN_ORDER.map(
      (dom) => operators.filter((o) => o.category === dom).length,
    );

    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: {
        top: 0,
        textStyle: { color: '#cbd5e1', fontSize: 11 },
      },
      grid: { left: 16, right: 16, top: 32, bottom: 24, containLabel: true },
      xAxis: {
        type: 'category',
        data: DOMAIN_ORDER.map((d) => DOMAIN_NAMES[d] ?? d),
        axisLabel: { color: '#cbd5e1', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: '#94a3b8', fontSize: 11 },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      series: [
        {
          name: rows ? 'Run A 有效 (valid)' : '注册算子总数',
          type: 'bar',
          data: countsA,
          itemStyle: { color: '#22d3ee', borderRadius: [4, 4, 0, 0] },
        },
        {
          name: rows ? 'Run B 有效 (valid)' : 'Batch A 就绪数',
          type: 'bar',
          data: countsB,
          itemStyle: { color: '#10b981', borderRadius: [4, 4, 0, 0] },
        },
        {
          name: '域内总容量',
          type: 'line',
          data: totalByDom,
          itemStyle: { color: '#94a3b8' },
          lineStyle: { type: 'dashed', color: '#64748b' },
        },
      ],
    };
  }, [rows, operators]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (statusFilter === 'valid' && r.runA?.status !== 'valid' && r.runB?.status !== 'valid') {
        return false;
      }
      if (
        statusFilter === 'unavailable' &&
        r.runA?.status !== 'unavailable' &&
        r.runB?.status !== 'unavailable'
      ) {
        return false;
      }
      if (statusFilter === 'diff' && r.runA?.status === r.runB?.status && r.deltaNumeric === 0) {
        return false;
      }
      if (!q) return true;
      return (
        r.meta.id.toLowerCase().includes(q) ||
        r.meta.name.toLowerCase().includes(q) ||
        r.meta.category.toLowerCase().includes(q)
      );
    });
  }, [rows, statusFilter, search]);

  const handleExportJson = () => {
    if (!rows) return;
    triggerDownload(
      `operator-benchmark-${runIdA}-vs-${runIdB}.json`,
      JSON.stringify({ generatedAt: new Date().toISOString(), runIdA, runIdB, rows }, null, 2),
      'application/json;charset=utf-8',
    );
  };

  const handleExportCsv = () => {
    if (!rows) return;
    const header = [
      'AtomID',
      'Name',
      'Category',
      'Custom',
      `RunA(${runIdA})_Status`,
      `RunA(${runIdA})_Value`,
      `RunA(${runIdA})_Display`,
      `RunB(${runIdB})_Status`,
      `RunB(${runIdB})_Value`,
      `RunB(${runIdB})_Display`,
      'Delta_A_Minus_B',
    ];
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [
          r.meta.id,
          r.meta.name,
          r.meta.category,
          r.meta.isCustom ? 'true' : 'false',
          r.runA?.status,
          r.runA?.value ?? '',
          r.runA?.displayValue,
          r.runB?.status,
          r.runB?.value ?? '',
          r.runB?.displayValue,
          r.deltaNumeric ?? '',
        ]
          .map(escapeCsvCell)
          .join(','),
      ),
    ];
    triggerDownload(
      `operator-benchmark-${runIdA}-vs-${runIdB}.csv`,
      '\uFEFF' + lines.join('\n'),
      'text/csv;charset=utf-8',
    );
  };

  return (
    <div className="space-y-3.5">
      <section className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
              <GitCompareArrows className="h-4 w-4 text-blue-400" />
              全库批量对比矩阵
            </h3>
            <p className="text-xs text-[#8b949e] mt-0.5">
              遍历全部 {operators.length} 个算子，对比两局推演的实测输出率与差值
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={loading || runs.length === 0}
              onClick={handleRunCompare}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              {loading ? '批量解算中…' : '执行全库横向对比'}
            </button>
            {rows && (
              <>
                <button
                  type="button"
                  onClick={handleExportJson}
                  className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-xs text-slate-200 hover:border-slate-500"
                >
                  <Download className="h-3.5 w-3.5" /> 导出 JSON
                </button>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-xs text-slate-200 hover:border-slate-500"
                >
                  <Download className="h-3.5 w-3.5" /> 导出 CSV
                </button>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <label className="block">
            <span className="text-[#8b949e] block mb-1">基准推演 A (Run A)</span>
            <select
              aria-label="选择基准推演 Run A"
              value={runIdA}
              onChange={(e) => setRunIdA(e.target.value)}
              className="w-full rounded-md border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100"
            >
              {runs.map((r) => (
                <option key={r.runId} value={r.runId}>
                  {r.scenarioName} ({r.runId})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[#8b949e] block mb-1">对比推演 B (Run B)</span>
            <select
              aria-label="选择对比推演 Run B"
              value={runIdB}
              onChange={(e) => setRunIdB(e.target.value)}
              className="w-full rounded-md border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100"
            >
              {runs.map((r) => (
                <option key={r.runId} value={r.runId}>
                  {r.scenarioName} ({r.runId})
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <p className="rounded-md bg-rose-500/15 border border-rose-500/35 p-2.5 text-xs text-rose-200">
            {error}
          </p>
        )}
      </section>

      {/* 五域覆盖率 / 对比分布图 */}
      <section className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h4 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <BarChart3 className="h-4 w-4 text-blue-400" />
            {rows ? 'Run A vs Run B 五域有效出数对比' : '五域算子容量与 Batch A 就绪基线'}
          </h4>
          {rows && (
            <div className="flex flex-wrap gap-2 text-[11px] tabular-nums">
              <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30">
                Run A: valid {summary.a.valid} · degraded {summary.a.degraded} · unavail {summary.a.unavailable}
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                Run B: valid {summary.b.valid} · degraded {summary.b.degraded} · unavail {summary.b.unavailable}
              </span>
            </div>
          )}
        </div>
        <EChartPanel option={domainChartOption} height={240} />
      </section>

      {rows && (
        <section className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5 text-xs">
              {(
                [
                  ['all', `全部 (${rows.length})`],
                  ['valid', '至少一侧 valid'],
                  ['unavailable', '含数据缺失项'],
                  ['diff', '存在状态或数值差异'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setStatusFilter(k)}
                  className={`rounded border px-2.5 py-1 text-xs ${
                    statusFilter === k
                      ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                      : 'border-white/10 bg-slate-950/60 text-slate-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="筛选对比结果算子..."
              aria-label="筛选全库对比结果"
              className="rounded-lg border border-white/15 bg-slate-900 px-3 py-1.5 text-xs text-slate-100"
            />
          </div>

          <div
            tabIndex={0}
            role="region"
            aria-label="双 Run 全量算子横向对比矩阵"
            className="responsive-table-wrap responsive-table-scroll-y rounded-xl border border-white/10"
          >
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/90 text-slate-300">
                <tr>
                  <th scope="col" className="px-3 py-2">算子 ID / 名称</th>
                  <th scope="col" className="px-3 py-2 hide-narrow-col">领域</th>
                  <th scope="col" className="px-3 py-2">Run A 结果</th>
                  <th scope="col" className="px-3 py-2">Run B 结果</th>
                  <th scope="col" className="px-3 py-2 hide-narrow-col">数值差 (A - B)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredRows.map((r) => (
                  <tr key={r.meta.id} className="hover:bg-white/[0.03]">
                    <th scope="row" className="px-3 py-2 font-normal">
                      <div className="font-mono text-[11px] text-cyan-300 flex items-center gap-1.5">
                        <span>{r.meta.id}</span>
                        {r.meta.isCustom && (
                          <span className="px-1 py-0.2 rounded bg-violet-500/20 text-violet-200 border border-violet-500/35 text-[10px]">
                            自定义
                          </span>
                        )}
                      </div>
                      <div className="text-slate-100 font-medium">{r.meta.name}</div>
                    </th>
                    <td className="px-3 py-2 text-slate-400 hide-narrow-col">{r.meta.category}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded border px-1.5 py-0.5 text-[10px] mr-1.5 ${statusPillClass(r.runA?.status)}`}
                      >
                        {r.runA?.status}
                      </span>
                      <span className="text-slate-200 font-mono text-[11px]">
                        {r.runA?.displayValue}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded border px-1.5 py-0.5 text-[10px] mr-1.5 ${statusPillClass(r.runB?.status)}`}
                      >
                        {r.runB?.status}
                      </span>
                      <span className="text-slate-200 font-mono text-[11px]">
                        {r.runB?.displayValue}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-300 hide-narrow-col tabular-nums">
                      {r.deltaNumeric === null
                        ? '—'
                        : `${r.deltaNumeric >= 0 ? '+' : ''}${r.deltaNumeric}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
