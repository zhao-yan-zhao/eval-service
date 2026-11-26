import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search, Table2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { V4MetricSnapshotItem, V4MetricTableSlice } from '../../../core/types.ts';
import {
  formatMetricObjectiveValue,
  serializeMetricSliceToCsv,
} from './cockpit-v4-helpers.ts';

interface CockpitMetricTablesTabProps {
  snapshots: V4MetricSnapshotItem[];
  sides: string[];
  focusSide: string;
  selectedMetricId: string | null;
  onSelectMetricId: (metricId: string) => void;
}

function formatCellValue(val: unknown): string {
  if (val === null || val === undefined || val === '') return '--';
  if (typeof val === 'boolean') return val ? '是' : '否';
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return '--';
    return Number.isInteger(val) ? String(val) : Number(val.toFixed(4)).toString();
  }
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

export function CockpitMetricTablesTab({
  snapshots,
  sides,
  focusSide,
  selectedMetricId,
  onSelectMetricId,
}: CockpitMetricTablesTabProps) {
  const [listQuery, setListQuery] = useState('');
  const [localSide, setLocalSide] = useState<string>(focusSide || 'ALL');
  const [tableQuery, setTableQuery] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    if (focusSide === 'ALL' || sides.includes(focusSide)) {
      setLocalSide(focusSide);
    } else {
      setLocalSide('ALL');
    }
  }, [focusSide, sides]);

  const filteredSnapshots = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    if (!q) return snapshots;
    return snapshots.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.metricId.toLowerCase().includes(q) ||
        (s.parentEffectLabel?.toLowerCase().includes(q) ?? false),
    );
  }, [snapshots, listQuery]);

  const activeSnapshot = useMemo(() => {
    if (snapshots.length === 0) return null;
    if (selectedMetricId) {
      const hit = snapshots.find(
        (s) => s.metricId === selectedMetricId || s.proxyNodeId === selectedMetricId,
      );
      if (hit) return hit;
    }
    return filteredSnapshots[0] ?? snapshots[0];
  }, [snapshots, filteredSnapshots, selectedMetricId]);

  useEffect(() => {
    setSortCol(null);
    setTableQuery('');
  }, [activeSnapshot?.metricId]);

  const activeSlice: V4MetricTableSlice | null = useMemo(() => {
    if (!activeSnapshot) return null;
    if (localSide !== 'ALL' && activeSnapshot.bySide[localSide]) {
      return activeSnapshot.bySide[localSide];
    }
    return activeSnapshot.overall;
  }, [activeSnapshot, localSide]);

  const sortedAndFilteredRows = useMemo(() => {
    if (!activeSlice) return [];
    const q = tableQuery.trim().toLowerCase();
    const cols = activeSlice.columns;
    let rows = activeSlice.rows;

    if (q) {
      rows = rows.filter((row) =>
        cols.some((col) =>
          String(row[col.name] ?? '')
            .toLowerCase()
            .includes(q),
        ),
      );
    }

    if (!sortCol) return rows;
    return [...rows].sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      if (va === vb) return 0;
      if (va === null || va === undefined || va === '') return 1;
      if (vb === null || vb === undefined || vb === '') return -1;
      const cmp =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb), 'zh-Hans-CN', { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [activeSlice, tableQuery, sortCol, sortDir]);

  const handleToggleSort = (colName: string) => {
    if (sortCol === colName) {
      if (sortDir === 'asc') {
        setSortDir('desc');
      } else {
        setSortCol(null);
      }
    } else {
      setSortCol(colName);
      setSortDir('asc');
    }
  };

  const handleExportCsv = () => {
    if (!activeSnapshot || !activeSlice) return;
    const csv = serializeMetricSliceToCsv(activeSlice);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `metric-${activeSnapshot.metricId}-${localSide}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (snapshots.length === 0) {
    return (
      <div className="p-8 text-center text-xs text-slate-500">
        当前评估体系暂无关联的客观指标二维表快照（请先点击「运行评估」或切换已支持 V4 指标快照的评估记录）
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[340px]">
      {/* 左侧：体系关联指标列表 */}
      <div className="min-w-0 border-b border-[#30363d] bg-[#0d1117]/60 lg:col-span-4 lg:border-b-0 lg:border-r">
        <div className="border-b border-[#30363d]/70 p-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={listQuery}
              onChange={(e) => setListQuery(e.target.value)}
              placeholder="筛选体系指标名称或 ID..."
              className="w-full rounded-md border border-[#30363d] bg-[#0d1117] py-1.5 pl-8 pr-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="max-h-[340px] divide-y divide-[#30363d]/50 overflow-y-auto">
          {filteredSnapshots.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">未匹配到指标</div>
          ) : (
            filteredSnapshots.map((item) => {
              const isSelected = activeSnapshot?.metricId === item.metricId;
              const slice =
                localSide !== 'ALL' && item.bySide[localSide]
                  ? item.bySide[localSide]
                  : item.overall;
              return (
                <button
                  key={item.proxyNodeId}
                  type="button"
                  onClick={() => onSelectMetricId(item.metricId)}
                  className={`flex w-full items-start justify-between gap-2 px-3 py-2.5 text-left transition cursor-pointer ${
                    isSelected
                      ? 'bg-cyan-500/15 text-cyan-100 border-l-2 border-l-cyan-400'
                      : 'text-slate-300 hover:bg-[#161b22]'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{item.label}</div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
                      {item.metricId}
                      {item.parentEffectLabel ? ` · ${item.parentEffectLabel}` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`rounded border px-1.5 py-0 font-mono text-[10px] ${
                        slice.status === 'unavailable'
                          ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                          : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                      }`}
                    >
                      {slice.status === 'unavailable' ? '缺数' : `${slice.totalRows} 行`}
                    </span>
                    {slice.value !== null && slice.value !== undefined && (
                      <span className="font-mono text-[10px] text-cyan-300 tabular-nums">
                        {formatMetricObjectiveValue(slice.value, item.targetField)}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* 右侧：二维数据表视图 */}
      <div className="min-w-0 flex flex-col lg:col-span-8">
        {activeSnapshot && activeSlice && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#30363d]/80 bg-[#0d1117]/40 px-3.5 py-2.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Table2 className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                  <span className="truncate text-xs font-semibold text-slate-100">
                    {activeSnapshot.label}
                  </span>
                  <span className="font-mono text-[10px] text-slate-400">
                    ({activeSnapshot.metricId})
                  </span>
                  {activeSnapshot.targetField && (
                    <span className="rounded border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan-200">
                      提取字段: {activeSnapshot.targetField}
                      {activeSnapshot.reduce ? ` · ${activeSnapshot.reduce}` : ''}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {sides.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 rounded-md border border-[#30363d] bg-[#0d1117] p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setLocalSide('ALL')}
                      className={`rounded px-2 py-0.5 transition cursor-pointer ${
                        localSide === 'ALL'
                          ? 'bg-indigo-600/35 font-semibold text-indigo-200'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      综合
                    </button>
                    {sides.map((s) => (
                      <button
                        key={`m-side-${s}`}
                        type="button"
                        onClick={() => setLocalSide(s)}
                        className={`rounded px-2 py-0.5 transition cursor-pointer ${
                          localSide === s
                            ? 'bg-cyan-600/30 font-semibold text-cyan-200'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}

                <input
                  type="text"
                  value={tableQuery}
                  onChange={(e) => setTableQuery(e.target.value)}
                  placeholder="搜索表内行内容..."
                  className="w-full sm:w-44 rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                />

                <button
                  type="button"
                  disabled={activeSlice.rows.length === 0}
                  onClick={handleExportCsv}
                  className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1 text-[11px] text-slate-200 hover:border-cyan-500/50 disabled:opacity-40 transition cursor-pointer"
                >
                  <Download className="h-3 w-3 text-cyan-400" />
                  <span>导出 CSV</span>
                </button>
              </div>
            </div>

            {activeSlice.truncated && (
              <div className="border-b border-amber-500/30 bg-amber-500/10 px-3.5 py-1.5 text-[11px] text-amber-200">
                当前快照已展示前 {activeSlice.rows.length} 行（原始共 {activeSlice.totalRows} 行），导出 CSV 包含当前快照全部行。
              </div>
            )}

            <div className="max-h-[340px] flex-1 overflow-auto">
              {activeSlice.status === 'unavailable' || activeSlice.rows.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  {activeSlice.missingDataReason || '当前阵营切片下该指标暂无实证数据行'}
                </div>
              ) : (
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 border-b border-[#30363d] bg-[#0d1117] text-[11px] text-slate-400">
                    <tr>
                      <th className="px-2.5 py-2 font-mono text-[10px] text-slate-500">#</th>
                      {activeSlice.columns.map((col) => {
                        const isTarget = col.name === activeSnapshot.targetField;
                        const isSorted = sortCol === col.name;
                        return (
                          <th
                            key={col.name}
                            className={`px-3 py-2 font-medium whitespace-nowrap ${
                              isTarget ? 'bg-cyan-500/10 text-cyan-200' : ''
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => handleToggleSort(col.name)}
                              className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                              title={col.name}
                            >
                              <span>{col.displayName || col.name}</span>
                              {isSorted ? (
                                sortDir === 'asc' ? (
                                  <ArrowUp className="h-3 w-3 text-cyan-400" />
                                ) : (
                                  <ArrowDown className="h-3 w-3 text-cyan-400" />
                                )
                              ) : (
                                <ArrowUpDown className="h-3 w-3 opacity-40" />
                              )}
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#30363d]/60">
                    {sortedAndFilteredRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={1 + activeSlice.columns.length}
                          className="px-4 py-8 text-center text-xs text-slate-500"
                        >
                          无匹配筛选条件的行记录
                        </td>
                      </tr>
                    ) : (
                      sortedAndFilteredRows.map((row, idx) => (
                        <tr key={`mrow-${idx}`} className="hover:bg-[#1b2230]/70">
                          <td className="px-2.5 py-1.5 font-mono text-[10px] text-slate-500 tabular-nums">
                            {idx + 1}
                          </td>
                          {activeSlice.columns.map((col) => {
                            const isTarget = col.name === activeSnapshot.targetField;
                            const raw = row[col.name];
                            return (
                              <td
                                key={`${idx}-${col.name}`}
                                className={`px-3 py-1.5 whitespace-nowrap font-mono text-[11px] ${
                                  isTarget
                                    ? 'bg-cyan-500/5 font-semibold text-cyan-200'
                                    : 'text-slate-200'
                                }`}
                              >
                                {formatCellValue(raw)}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
