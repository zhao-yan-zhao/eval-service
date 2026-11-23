import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Database,
  Grid3X3,
  Layers,
  Search,
  Table2,
  X,
} from 'lucide-react';
import type { DatasetColumn, FieldDataType, TableDataset } from '../../../core/types.ts';

export interface V4TablePivotPreviewProps {
  dataset?: TableDataset | null;
  title?: string;
  maxRows?: number;
  emptyText?: string;
}

type PreviewViewMode = 'table' | 'pivot';
type PivotAggMethod = 'SUM' | 'AVG' | 'MAX' | 'MIN' | 'COUNT';

const AGG_LABELS: Record<PivotAggMethod, string> = {
  SUM: '求和 (SUM)',
  AVG: '均值 (AVG)',
  MAX: '最大 (MAX)',
  MIN: '最小 (MIN)',
  COUNT: '计数 (COUNT)',
};

const TYPE_BADGE_MAP: Record<FieldDataType, { short: string; cls: string }> = {
  number: { short: 'num', cls: 'border-cyan-500/35 bg-cyan-500/10 text-cyan-300' },
  string: { short: 'str', cls: 'border-slate-600/70 bg-slate-800/80 text-slate-300' },
  boolean: { short: 'bool', cls: 'border-purple-500/35 bg-purple-500/10 text-purple-300' },
  datetime: { short: 'dt', cls: 'border-amber-500/35 bg-amber-500/10 text-amber-300' },
};

const MAX_PIVOT_COLS = 40;

function inferFieldTypeFromSamples(rows: Array<Record<string, unknown>>, key: string): FieldDataType {
  for (let i = 0; i < Math.min(rows.length, 25); i += 1) {
    const val = rows[i]?.[key];
    if (val === null || val === undefined || val === '') continue;
    if (typeof val === 'boolean') return 'boolean';
    if (typeof val === 'number' && Number.isFinite(val)) return 'number';
    if (typeof val === 'string') {
      if (/^\d{4}-\d{2}-\d{2}/.test(val)) return 'datetime';
      const n = Number(val);
      if (val.trim() !== '' && Number.isFinite(n)) return 'number';
      return 'string';
    }
    return 'string';
  }
  return 'string';
}

function normalizeDatasetColumns(dataset?: TableDataset | null): DatasetColumn[] {
  if (!dataset) return [];
  const rawCols =
    Array.isArray(dataset.columns) && dataset.columns.length > 0
      ? dataset.columns
      : Array.isArray(dataset.schema) && dataset.schema.length > 0
        ? (dataset.schema as DatasetColumn[])
        : [];

  const rows = Array.isArray(dataset.rows) ? dataset.rows : [];
  const colMap = new Map<string, DatasetColumn>();

  for (const col of rawCols) {
    if (!col || !col.name) continue;
    colMap.set(col.name, {
      name: col.name,
      type: col.type || inferFieldTypeFromSamples(rows, col.name),
      displayName: col.displayName,
      description: col.description,
      isDerived: col.isDerived,
    });
  }

  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    const row = rows[i];
    if (!row || typeof row !== 'object') continue;
    for (const key of Object.keys(row)) {
      if (!colMap.has(key)) {
        colMap.set(key, {
          name: key,
          type: inferFieldTypeFromSamples(rows, key),
        });
      }
    }
  }

  return Array.from(colMap.values());
}

function toNumeric(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toDimLabel(val: unknown): string {
  if (val === null || val === undefined || val === '') return '(空)';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return String(val);
}

function formatNumericValue(val: number): string {
  if (!Number.isFinite(val)) return '—';
  if (Number.isInteger(val)) return val.toLocaleString();
  return Number(val.toFixed(4)).toString();
}

function aggregateBucket(values: unknown[], method: PivotAggMethod): number | null {
  if (method === 'COUNT') {
    return values.length;
  }
  const nums: number[] = [];
  for (const v of values) {
    const n = toNumeric(v);
    if (n !== null) nums.push(n);
  }
  if (nums.length === 0) return null;

  switch (method) {
    case 'SUM':
      return nums.reduce((acc, n) => acc + n, 0);
    case 'AVG':
      return nums.reduce((acc, n) => acc + n, 0) / nums.length;
    case 'MAX':
      return Math.max(...nums);
    case 'MIN':
      return Math.min(...nums);
    default:
      return null;
  }
}

function compareDimLabels(a: string, b: string): number {
  if (a === '(空)' && b !== '(空)') return 1;
  if (b === '(空)' && a !== '(空)') return -1;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && a.trim() !== '' && b.trim() !== '') {
    return na - nb;
  }
  return a.localeCompare(b, 'zh-Hans-CN');
}

function formatCellContent(val: unknown): React.ReactNode {
  if (val === null || val === undefined) {
    return <span className="italic text-slate-600">null</span>;
  }
  if (typeof val === 'boolean') {
    return (
      <span
        className={`inline-block rounded border px-1.5 py-0.2 font-mono text-[10px] font-semibold ${
          val
            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
            : 'border-rose-500/40 bg-rose-500/15 text-rose-300'
        }`}
      >
        {val ? 'TRUE' : 'FALSE'}
      </span>
    );
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      return <span className="text-amber-400">{String(val)}</span>;
    }
    return <span className="tabular-nums text-cyan-200">{formatNumericValue(val)}</span>;
  }
  if (typeof val === 'object') {
    const json = JSON.stringify(val);
    return (
      <span className="text-slate-400" title={json}>
        {json}
      </span>
    );
  }
  const str = String(val);
  return <span title={str}>{str}</span>;
}

export function V4TablePivotPreview({
  dataset,
  title,
  maxRows = 200,
  emptyText = '暂无 TableDataset 数据，请先执行算子或指标节点',
}: V4TablePivotPreviewProps) {
  const [viewMode, setViewMode] = useState<PreviewViewMode>('table');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllRows, setShowAllRows] = useState(false);

  const [rowDim, setRowDim] = useState<string>('');
  const [colDim, setColDim] = useState<string>('');
  const [measureCol, setMeasureCol] = useState<string>('');
  const [aggMethod, setAggMethod] = useState<PivotAggMethod>('AVG');

  const columns = useMemo(() => normalizeDatasetColumns(dataset), [dataset]);
  const rows = useMemo(
    () => (Array.isArray(dataset?.rows) ? dataset.rows : []),
    [dataset],
  );
  const totalRowCount = dataset?.totalRows ?? rows.length;

  const dimensionKeySet = useMemo(
    () => new Set(dataset?.dimensionKeys ?? []),
    [dataset?.dimensionKeys],
  );
  const measureKeySet = useMemo(
    () => new Set(dataset?.measureKeys ?? []),
    [dataset?.measureKeys],
  );

  // 区分候选维度列与候选度量列（支持 planId / runId / 分方 / 型号 / 任务）
  const { dimCandidates, measureCandidates } = useMemo(() => {
    const dims: DatasetColumn[] = [];
    const measures: DatasetColumn[] = [];
    const priorityDimNames = new Set([
      'planId',
      'runId',
      'iteration',
      'Side',
      'side',
      'TargetSide',
      'UnitSide',
      'MissionName',
      'MissionID',
      'Model',
      'WeaponType',
      'UnitClass',
      'UnitName',
    ]);

    for (const col of columns) {
      const isExplicitDim = dimensionKeySet.has(col.name) || priorityDimNames.has(col.name);
      const isExplicitMeasure = measureKeySet.has(col.name);

      if (isExplicitMeasure || (col.type === 'number' && !isExplicitDim)) {
        measures.push(col);
      }
      if (
        isExplicitDim ||
        col.type === 'string' ||
        col.type === 'boolean' ||
        col.type === 'datetime'
      ) {
        dims.push(col);
      }
    }

    // 兜底：任何列都可作为维度或计数列
    const finalDims = dims.length > 0 ? dims : columns;
    const finalMeasures =
      measures.length > 0
        ? measures
        : columns.filter((c) => c.type === 'number' || c.type === 'boolean');

    return {
      dimCandidates: finalDims,
      measureCandidates: finalMeasures,
    };
  }, [columns, dimensionKeySet, measureKeySet]);

  // 数据集变化时自动选定合理默认维度/度量
  useEffect(() => {
    setShowAllRows(false);
    const colNames = new Set(columns.map((c) => c.name));

    setRowDim((prev) => {
      if (prev && colNames.has(prev)) return prev;
      return dimCandidates[0]?.name ?? columns[0]?.name ?? '';
    });

    setColDim((prev) => {
      if (prev && colNames.has(prev)) return prev;
      const firstRowDim = dimCandidates[0]?.name ?? columns[0]?.name ?? '';
      const secondDim = dimCandidates.find((c) => c.name !== firstRowDim);
      // 若第二维度基数适中（<= 16），默认展开 2D 交叉透视，否则保留可选
      if (secondDim && rows.length > 0) {
        const distinct = new Set(rows.slice(0, 300).map((r) => toDimLabel(r[secondDim.name])));
        if (distinct.size >= 2 && distinct.size <= 16) {
          return secondDim.name;
        }
      }
      return '';
    });

    setMeasureCol((prev) => {
      if (prev && colNames.has(prev)) return prev;
      return measureCandidates[0]?.name ?? columns[0]?.name ?? '';
    });
  }, [columns, dimCandidates, measureCandidates, rows]);

  // 明细表关键词搜索过滤
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      columns.some((col) => {
        const v = row?.[col.name];
        if (v === null || v === undefined) return false;
        return String(v).toLowerCase().includes(q);
      }),
    );
  }, [rows, columns, searchQuery]);

  const displayedRows = useMemo(() => {
    if (showAllRows) return filteredRows;
    return filteredRows.slice(0, maxRows);
  }, [filteredRows, showAllRows, maxRows]);

  // 浏览器端实时多维交叉透视计算
  const pivotResult = useMemo(() => {
    if (!rowDim || rows.length === 0) {
      return null;
    }

    const rowKeySet = new Set<string>();
    const colKeySet = new Set<string>();
    const cellBuckets = new Map<string, unknown[]>();
    const rowBuckets = new Map<string, unknown[]>();
    const colBuckets = new Map<string, unknown[]>();
    const allValues: unknown[] = [];

    const effectiveMeasure = measureCol || columns[0]?.name || '';
    const hasColDim = Boolean(colDim && colDim !== rowDim);

    for (const row of rows) {
      const rKey = toDimLabel(row?.[rowDim]);
      const cKey = hasColDim ? toDimLabel(row?.[colDim]) : '__ALL__';
      const val = effectiveMeasure ? row?.[effectiveMeasure] : 1;

      rowKeySet.add(rKey);
      if (hasColDim) colKeySet.add(cKey);

      const cellKey = `${rKey}\u0000${cKey}`;
      const cellArr = cellBuckets.get(cellKey);
      if (cellArr) cellArr.push(val);
      else cellBuckets.set(cellKey, [val]);

      const rArr = rowBuckets.get(rKey);
      if (rArr) rArr.push(val);
      else rowBuckets.set(rKey, [val]);

      if (hasColDim) {
        const cArr = colBuckets.get(cKey);
        if (cArr) cArr.push(val);
        else colBuckets.set(cKey, [val]);
      }

      allValues.push(val);
    }

    const rowKeys = Array.from(rowKeySet).sort(compareDimLabels);
    const allColKeys = hasColDim ? Array.from(colKeySet).sort(compareDimLabels) : [];
    const truncatedCols = allColKeys.length > MAX_PIVOT_COLS;
    const colKeys = truncatedCols ? allColKeys.slice(0, MAX_PIVOT_COLS) : allColKeys;

    const matrix = rowKeys.map((rKey) => {
      const cells = colKeys.map((cKey) => {
        const vals = cellBuckets.get(`${rKey}\u0000${cKey}`) ?? [];
        return {
          colKey: cKey,
          count: vals.length,
          value: aggregateBucket(vals, aggMethod),
        };
      });
      const rVals = rowBuckets.get(rKey) ?? [];
      return {
        rowKey: rKey,
        count: rVals.length,
        rowTotal: aggregateBucket(rVals, aggMethod),
        cells,
      };
    });

    const colTotals = colKeys.map((cKey) => ({
      colKey: cKey,
      value: aggregateBucket(colBuckets.get(cKey) ?? [], aggMethod),
    }));

    const grandTotal = aggregateBucket(allValues, aggMethod);

    return {
      hasColDim,
      effectiveMeasure,
      rowKeys,
      colKeys,
      totalColDistinctCount: allColKeys.length,
      truncatedCols,
      matrix,
      colTotals,
      grandTotal,
    };
  }, [rows, rowDim, colDim, measureCol, aggMethod, columns]);

  // 快捷交叉透视预设（若存在 planId/runId/Side 等列）
  const quickPresets = useMemo(() => {
    const names = new Set(columns.map((c) => c.name));
    const presets: Array<{ label: string; r: string; c: string }> = [];
    if (names.has('planId') && names.has('runId')) {
      presets.push({ label: 'planId × runId', r: 'planId', c: 'runId' });
    }
    const sideCol = ['Side', 'side', 'TargetSide', 'UnitSide'].find((n) => names.has(n));
    const missionCol = ['MissionName', 'MissionID'].find((n) => names.has(n));
    const modelCol = ['Model', 'WeaponType', 'UnitClass'].find((n) => names.has(n));

    if (sideCol && missionCol) {
      presets.push({ label: `${missionCol} × ${sideCol}`, r: missionCol, c: sideCol });
    }
    if (sideCol && modelCol) {
      presets.push({ label: `${modelCol} × ${sideCol}`, r: modelCol, c: sideCol });
    }
    if (names.has('planId') && sideCol) {
      presets.push({ label: `planId × ${sideCol}`, r: 'planId', c: sideCol });
    }
    return presets;
  }, [columns]);

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-[#30363d] bg-[#0d1117] text-slate-200">
      {/* 顶栏：标题、数据集元信息、Table / Pivot 切换 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#30363d] bg-[#161b22] px-3.5 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Database className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
          <span className="truncate text-xs font-semibold text-slate-100">
            {title || 'TableDataset 数据透视与明细预览'}
          </span>

          <span className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-0.5 font-mono text-[10px] text-slate-300 tabular-nums">
            {totalRowCount.toLocaleString()} 行 × {columns.length} 列
          </span>

          {dataset?.planId && (
            <span className="rounded border border-indigo-500/40 bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300">
              plan: {dataset.planId}
            </span>
          )}
          {dataset?.runId && (
            <span className="rounded border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
              run: {dataset.runId}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {viewMode === 'table' && rows.length > 0 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="检索单元格内容..."
                className="w-44 rounded-md border border-[#30363d] bg-[#0d1117] py-1 pl-6 pr-6 text-[11px] text-slate-200 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  title="清空搜索"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}

          {/* 视图切换开关 */}
          <div className="flex rounded-md border border-[#30363d] bg-[#0d1117] p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1 transition cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-cyan-500/20 text-cyan-200 font-semibold border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Table2 className="h-3 w-3" />
              <span>二维明细表</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('pivot')}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1 transition cursor-pointer ${
                viewMode === 'pivot'
                  ? 'bg-emerald-500/20 text-emerald-200 font-semibold border border-emerald-500/40'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Grid3X3 className="h-3 w-3" />
              <span>多维交叉透视</span>
            </button>
          </div>
        </div>
      </div>

      {/* 空数据集状态 */}
      {!dataset || (rows.length === 0 && columns.length === 0) ? (
        <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 px-4 py-8 text-center text-slate-500">
          <Layers className="h-6 w-6 text-slate-600" />
          <p className="max-w-md text-xs">{emptyText}</p>
        </div>
      ) : viewMode === 'table' ? (
        /* ── 视图 1：二维明细表 (Table) ── */
        <div className="flex flex-col">
          {/* 列结构标签栏 */}
          {columns.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-[#30363d]/70 bg-[#0d1117] px-3 py-1.5 text-[10px]">
              <span className="font-semibold text-slate-400 mr-1">列契约:</span>
              {columns.map((col) => {
                const isDim = dimensionKeySet.has(col.name);
                const isMsr = measureKeySet.has(col.name);
                const tBadge = TYPE_BADGE_MAP[col.type] ?? TYPE_BADGE_MAP.string;
                return (
                  <span
                    key={`badge-${col.name}`}
                    title={col.description || col.displayName || col.name}
                    className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#161b22] px-1.5 py-0.5 font-mono text-slate-300"
                  >
                    <span>{col.name}</span>
                    <span className={`rounded border px-1 text-[9px] ${tBadge.cls}`}>
                      {tBadge.short}
                    </span>
                    {isDim && (
                      <span className="rounded bg-amber-500/15 px-1 text-[9px] text-amber-300">
                        DIM
                      </span>
                    )}
                    {isMsr && (
                      <span className="rounded bg-emerald-500/15 px-1 text-[9px] text-emerald-300">
                        MSR
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          )}

          {/* 滚动数据表 */}
          <div className="max-h-[300px] overflow-auto bg-[#0d1117]">
            {filteredRows.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                {rows.length === 0 ? emptyText : '没有匹配当前搜索关键词的数据行'}
              </div>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-[#161b22] shadow-sm">
                  <tr className="border-b border-[#30363d] text-[11px] text-slate-300">
                    <th className="w-11 border-r border-[#30363d]/60 px-2.5 py-2 text-center font-mono text-[10px] text-slate-500">
                      #
                    </th>
                    {columns.map((col) => {
                      const tBadge = TYPE_BADGE_MAP[col.type] ?? TYPE_BADGE_MAP.string;
                      const isDim = dimensionKeySet.has(col.name);
                      const isMsr = measureKeySet.has(col.name);
                      return (
                        <th
                          key={col.name}
                          className="whitespace-nowrap border-r border-[#30363d]/40 px-3 py-2 font-semibold"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>{col.displayName || col.name}</span>
                            <span className={`rounded border px-1 py-0 text-[9px] font-mono ${tBadge.cls}`}>
                              {tBadge.short}
                            </span>
                            {isDim && (
                              <span className="rounded bg-amber-500/15 px-1 text-[9px] font-mono text-amber-300">
                                维
                              </span>
                            )}
                            {isMsr && (
                              <span className="rounded bg-emerald-500/15 px-1 text-[9px] font-mono text-emerald-300">
                                量
                              </span>
                            )}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363d]/50 font-mono text-[11px]">
                  {displayedRows.map((row, rowIdx) => (
                    <tr key={rowIdx} className="hover:bg-[#161b22]/85 transition-colors">
                      <td className="border-r border-[#30363d]/50 px-2.5 py-1.5 text-center text-[10px] text-slate-500 tabular-nums">
                        {rowIdx + 1}
                      </td>
                      {columns.map((col) => (
                        <td
                          key={col.name}
                          className="max-w-[260px] truncate whitespace-nowrap border-r border-[#30363d]/30 px-3 py-1.5 text-slate-200"
                        >
                          {formatCellContent(row?.[col.name])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 底部状态与截断控制 */}
          {filteredRows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#30363d] bg-[#161b22]/70 px-3.5 py-1.5 text-[11px] text-slate-400">
              <span>
                显示 <strong className="font-mono text-slate-200">{displayedRows.length}</strong> /{' '}
                <strong className="font-mono text-slate-200">{filteredRows.length}</strong> 行
                {searchQuery.trim() && ` (总行数 ${rows.length})`}
              </span>

              {filteredRows.length > maxRows && (
                <button
                  type="button"
                  onClick={() => setShowAllRows((prev) => !prev)}
                  className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-0.5 text-[10px] text-cyan-300 hover:border-cyan-500/60 transition cursor-pointer"
                >
                  {showAllRows
                    ? `收起至前 ${maxRows} 行`
                    : `展开全部 ${filteredRows.length} 行`}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        /* ── 视图 2：多维交叉透视 (Pivot) ── */
        <div className="flex flex-col">
          {/* 透视交互控制栏 */}
          <div className="flex flex-wrap items-center gap-2 border-b border-[#30363d] bg-[#0d1117] px-3.5 py-2.5 text-xs">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span>行维度</span>
              <select
                value={rowDim}
                onChange={(e) => setRowDim(e.target.value)}
                className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                {columns.map((c) => (
                  <option key={`r-${c.name}`} value={c.name}>
                    {c.displayName ? `${c.displayName} (${c.name})` : c.name}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => {
                if (!colDim) return;
                const prevRow = rowDim;
                setRowDim(colDim);
                setColDim(prevRow);
              }}
              disabled={!colDim}
              title="互换行列维度"
              className="rounded border border-[#30363d] bg-[#161b22] p-1 text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed transition"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
            </button>

            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span>列维度</span>
              <select
                value={colDim}
                onChange={(e) => setColDim(e.target.value)}
                className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                <option value="">(无列维度 · 一维分组)</option>
                {columns
                  .filter((c) => c.name !== rowDim)
                  .map((c) => (
                    <option key={`c-${c.name}`} value={c.name}>
                      {c.displayName ? `${c.displayName} (${c.name})` : c.name}
                    </option>
                  ))}
              </select>
            </label>

            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span>值度量</span>
              <select
                value={measureCol}
                onChange={(e) => setMeasureCol(e.target.value)}
                className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                {(aggMethod === 'COUNT' ? columns : measureCandidates.length > 0 ? measureCandidates : columns).map(
                  (c) => (
                    <option key={`m-${c.name}`} value={c.name}>
                      {c.displayName ? `${c.displayName} (${c.name})` : c.name}
                    </option>
                  ),
                )}
              </select>
            </label>

            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span>聚合</span>
              <select
                value={aggMethod}
                onChange={(e) => setAggMethod(e.target.value as PivotAggMethod)}
                className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-xs text-emerald-300 focus:border-emerald-500 focus:outline-none"
              >
                {(Object.keys(AGG_LABELS) as PivotAggMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {AGG_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>

            {quickPresets.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 ml-auto">
                <span className="text-[10px] text-slate-500">快捷交叉:</span>
                {quickPresets.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      setRowDim(p.r);
                      setColDim(p.c);
                    }}
                    className="rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5 font-mono text-[10px] text-emerald-300 hover:border-emerald-500/60 transition cursor-pointer"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 交叉透视结果表 */}
          {!pivotResult || rows.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              {emptyText}
            </div>
          ) : (
            <>
              {pivotResult.truncatedCols && (
                <div className="border-b border-amber-500/30 bg-amber-950/30 px-3.5 py-1 text-[11px] text-amber-300">
                  列维度 [{colDim}] 共有 {pivotResult.totalColDistinctCount} 个唯一值，已截断展示前 {MAX_PIVOT_COLS} 列以保持流畅交互。
                </div>
              )}

              <div className="max-h-[300px] overflow-auto bg-[#0d1117]">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-[#161b22]">
                    <tr className="border-b border-[#30363d] text-[11px] text-slate-300">
                      <th className="sticky left-0 z-20 border-r border-[#30363d] bg-[#161b22] px-3 py-2 font-semibold text-amber-200">
                        {rowDim}
                        {pivotResult.hasColDim ? ` \\ ${colDim}` : ''}
                      </th>
                      {pivotResult.hasColDim ? (
                        pivotResult.colKeys.map((cKey) => (
                          <th
                            key={cKey}
                            className="whitespace-nowrap border-r border-[#30363d]/50 px-3 py-2 text-right font-mono font-semibold text-cyan-200"
                          >
                            {cKey}
                          </th>
                        ))
                      ) : (
                        <th className="whitespace-nowrap border-r border-[#30363d]/50 px-3 py-2 text-right font-mono font-semibold text-slate-400">
                          样本行数
                        </th>
                      )}
                      <th className="whitespace-nowrap bg-[#1b2230] px-3 py-2 text-right font-mono font-bold text-emerald-300">
                        {pivotResult.hasColDim ? '行汇总' : `${aggMethod}(${pivotResult.effectiveMeasure})`}
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-[#30363d]/50 font-mono text-[11px]">
                    {pivotResult.matrix.map((rowItem) => (
                      <tr key={rowItem.rowKey} className="hover:bg-[#161b22]/85 transition-colors">
                        <td className="sticky left-0 z-10 border-r border-[#30363d] bg-[#0d1117] px-3 py-1.5 font-semibold text-slate-200 whitespace-nowrap">
                          {rowItem.rowKey}
                        </td>
                        {pivotResult.hasColDim ? (
                          rowItem.cells.map((cell) => (
                            <td
                              key={cell.colKey}
                              title={`样本数: ${cell.count}`}
                              className="border-r border-[#30363d]/35 px-3 py-1.5 text-right tabular-nums"
                            >
                              {cell.value === null ? (
                                <span className="text-slate-600">—</span>
                              ) : (
                                <span className="text-slate-100">{formatNumericValue(cell.value)}</span>
                              )}
                            </td>
                          ))
                        ) : (
                          <td className="border-r border-[#30363d]/35 px-3 py-1.5 text-right tabular-nums text-slate-400">
                            {rowItem.count}
                          </td>
                        )}
                        <td className="bg-[#161b22]/55 px-3 py-1.5 text-right font-semibold tabular-nums text-emerald-300">
                          {rowItem.rowTotal === null ? '—' : formatNumericValue(rowItem.rowTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>

                  <tfoot>
                    <tr className="border-t-2 border-[#30363d] bg-[#161b22] font-mono text-[11px] font-bold">
                      <td className="sticky left-0 z-10 border-r border-[#30363d] bg-[#161b22] px-3 py-2 text-emerald-300">
                        总计 ({aggMethod})
                      </td>
                      {pivotResult.hasColDim ? (
                        pivotResult.colTotals.map((ct) => (
                          <td
                            key={`tot-${ct.colKey}`}
                            className="border-r border-[#30363d]/50 px-3 py-2 text-right tabular-nums text-cyan-200"
                          >
                            {ct.value === null ? '—' : formatNumericValue(ct.value)}
                          </td>
                        ))
                      ) : (
                        <td className="border-r border-[#30363d]/50 px-3 py-2 text-right tabular-nums text-slate-300">
                          {rows.length}
                        </td>
                      )}
                      <td className="bg-[#1b2230] px-3 py-2 text-right tabular-nums text-emerald-300">
                        {pivotResult.grandTotal === null
                          ? '—'
                          : formatNumericValue(pivotResult.grandTotal)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
