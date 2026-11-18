import { Check, ChevronDown, ChevronUp, Database, Plus, Sparkles, Workflow, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type {
  F1OutputCatalog,
  OperatorFieldContract,
  OperatorSourceBinding,
  SourceBindingAgg,
} from '../api.ts';

const AGG_OPTIONS: Array<{ value: SourceBindingAgg; label: string; numericOnly: boolean }> = [
  { value: 'avg', label: 'avg (数值均值)', numericOnly: true },
  { value: 'sum', label: 'sum (数值求和)', numericOnly: true },
  { value: 'min', label: 'min (最小值)', numericOnly: true },
  { value: 'max', label: 'max (最大值)', numericOnly: true },
  { value: 'count_rows', label: 'count_rows (命中行数)', numericOnly: false },
  { value: 'count_non_empty', label: 'count_non_empty (非空条数)', numericOnly: false },
  { value: 'count_distinct', label: 'count_distinct (去重基数)', numericOnly: false },
  { value: 'first_num', label: 'first_num (首条数值)', numericOnly: true },
  { value: 'last_num', label: 'last_num (末条数值)', numericOnly: true },
];

const BS_PATH_SUGGESTIONS: Array<{ value: string; hint: string }> = [
  { value: 'ActiveUnits[].Speed', hint: 'bs-frames 样本航速' },
  { value: 'ActiveUnits[].CS', hint: '真机 Q-077 当前航速' },
  { value: 'ActiveUnits[].Altitude', hint: '平台高度' },
  { value: 'ActiveUnits[].CA', hint: '真机 Q-077 高度' },
  { value: 'ActiveUnits[].Fuel.FuelRec[].CQ', hint: '当前剩余油量' },
  { value: 'ActiveUnits[].Fuel.FuelRec[].MQ', hint: '最大载油量' },
  { value: 'ActiveUnits[].Mounts[].Mount.MW[].WRec.CL', hint: '当前挂架余弹' },
  { value: 'Sides[].Side.Contacts[]', hint: '阵营包装探测目标列表' },
  { value: 'Sides[].Contacts[]', hint: '标准探测目标列表' },
  { value: 'NonActiveUnits[].Lon', hint: '损耗/失活单元经度' },
  { value: 'Scenario.Time', hint: '想定推演时钟' },
  { value: 'bs-diff:weapon_fired', hint: '差分事件：武器发射' },
  { value: 'bs-diff:detection_new', hint: '差分事件：新增探测' },
  { value: 'bs-diff:unit_destroyed', hint: '差分事件：单元被毁' },
  { value: 'bs-diff:unit_maneuver', hint: '差分事件：航向/速度机动' },
  { value: 'bs-diff:detection_lost', hint: '差分事件：目标丢失' },
];

const NUMERIC_CS_TYPE_RE = /int|double|float|decimal|long|short|byte|single|number/i;

export function splitListInput(raw: string, sepRegex: RegExp): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(sepRegex)) {
    const trimmed = part.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function buildFieldContractFromText(texts: {
  csvTablesText: string;
  csvColumnsText: string;
  bsPathsText: string;
  notesText: string;
}): OperatorFieldContract {
  const csvTables = splitListInput(texts.csvTablesText, /[,，\n]+/);
  const csvColumns = splitListInput(texts.csvColumnsText, /[,，\n]+/);
  const bsFramePaths = splitListInput(texts.bsPathsText, /[|\n]+/);
  const discrepancyNotes = splitListInput(texts.notesText, /[;；\n]+/);
  return {
    ...(csvTables.length > 0 ? { csvTables } : {}),
    ...(csvColumns.length > 0 ? { csvColumns } : {}),
    ...(bsFramePaths.length > 0 ? { bsFramePaths } : {}),
    ...(discrepancyNotes.length > 0 ? { discrepancyNotes } : {}),
  };
}

interface CatalogSuggestionOption {
  value: string;
  meta?: string;
  badge?: string;
}

interface TokenContractFieldProps {
  label: string;
  inputAriaLabel: string;
  placeholder: string;
  valueText: string;
  sepRegex: RegExp;
  joinSep: string;
  onChangeText: (next: string) => void;
  suggestions: CatalogSuggestionOption[];
  pickerToggleLabel: string;
  emptyPickerHint: string;
  chipTone: 'emerald' | 'cyan' | 'amber' | 'slate';
  identifierField?: boolean;
  multilineNote?: boolean;
  fullWidth?: boolean;
}

const CHIP_TONE_CLASSES: Record<TokenContractFieldProps['chipTone'], string> = {
  emerald: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100',
  cyan: 'border-cyan-400/40 bg-cyan-500/15 text-cyan-100',
  amber: 'border-amber-400/40 bg-amber-500/15 text-amber-100',
  slate: 'border-white/20 bg-slate-800/80 text-slate-200',
};

/**
 * 多值契约标签选择器：已选条目渲染为完整可读可删标签，避免长列表在单行框内截断；
 * 同时保留可展开的 F1 规范目录多选抽屉与防输入法误触的 Enter/失焦提交。
 */
function TokenContractField({
  label,
  inputAriaLabel,
  placeholder,
  valueText,
  sepRegex,
  joinSep,
  onChangeText,
  suggestions,
  pickerToggleLabel,
  emptyPickerHint,
  chipTone,
  identifierField = true,
  multilineNote = false,
  fullWidth = false,
}: TokenContractFieldProps) {
  const uid = useId();
  const [draft, setDraft] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const items = useMemo(() => splitListInput(valueText, sepRegex), [valueText, sepRegex]);
  const selectedSet = useMemo(() => new Set(items), [items]);
  const suggestionMap = useMemo(() => {
    const m = new Map<string, CatalogSuggestionOption>();
    for (const s of suggestions) m.set(s.value, s);
    return m;
  }, [suggestions]);

  const commitItems = (next: string[]) => {
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const entry of next) {
      const t = entry.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      deduped.push(t);
    }
    onChangeText(deduped.join(joinSep));
  };

  const commitDraft = () => {
    const parsed = splitListInput(draft, sepRegex);
    if (parsed.length === 0) {
      setDraft('');
      return;
    }
    commitItems([...items, ...parsed]);
    setDraft('');
  };

  const toggleItem = (val: string) => {
    if (selectedSet.has(val)) {
      commitItems(items.filter((x) => x !== val));
    } else {
      commitItems([...items, val]);
    }
  };

  const filteredSuggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return suggestions;
    return suggestions.filter(
      (s) =>
        s.value.toLowerCase().includes(q) ||
        (s.meta && s.meta.toLowerCase().includes(q)) ||
        (s.badge && s.badge.toLowerCase().includes(q)),
    );
  }, [suggestions, draft]);

  const panelId = `${uid}-picker`;
  const inputId = `${uid}-input`;

  return (
    <div
      className={`rounded-lg border border-white/10 bg-slate-950/75 p-2 space-y-1.5 ${
        fullWidth ? 'sm:col-span-2' : ''
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <label htmlFor={inputId} className="text-[11px] font-medium text-slate-300">
          {label}
          <span className="ml-1.5 text-[10px] font-normal text-slate-400">
            （已选 {items.length} 项）
          </span>
        </label>
        <div className="flex items-center gap-1.5">
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => commitItems([])}
              className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-400 hover:border-rose-400/40 hover:text-rose-200"
            >
              清空
            </button>
          )}
          <button
            type="button"
            aria-expanded={pickerOpen}
            aria-controls={panelId}
            onClick={() => setPickerOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded border border-cyan-400/35 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200 hover:bg-cyan-500/20"
          >
            {pickerToggleLabel} ({suggestions.length})
            {pickerOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* 已选标签列表（完整包裹显示，不再单行截断） */}
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => {
            const matchedMeta = suggestionMap.get(item)?.meta;
            return (
              <span
                key={item}
                title={matchedMeta ? `${item} · ${matchedMeta}` : item}
                className={`inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] leading-tight ${CHIP_TONE_CLASSES[chipTone]}`}
              >
                <span className={identifierField ? 'font-mono break-all' : 'break-words'}>
                  {item}
                </span>
                {matchedMeta && !multilineNote && (
                  <span className="text-[10px] opacity-70 truncate max-w-[9rem]">
                    · {matchedMeta}
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`移除 ${item}`}
                  onClick={() => commitItems(items.filter((x) => x !== item))}
                  className="ml-0.5 rounded p-0.5 opacity-75 hover:bg-black/30 hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : (
        <div className="text-[11px] text-slate-500 italic">尚未标注，请点击「{pickerToggleLabel}」多选或下方输入添加</div>
      )}

      {/* 输入搜索 / 新增条目框 */}
      <div className="flex items-stretch gap-1.5">
        <input
          id={inputId}
          aria-label={inputAriaLabel}
          value={draft}
          onChange={(e) => {
            const val = e.target.value;
            if (sepRegex.test(val.replace(/\n/g, '')) && val.split(sepRegex).length > 1) {
              const parts = splitListInput(val, sepRegex);
              if (parts.length > 0) {
                commitItems([...items, ...parts]);
                setDraft('');
                return;
              }
            }
            setDraft(val);
            if (val.trim() && !pickerOpen && suggestions.length > 0) {
              setPickerOpen(true);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (e.nativeEvent.isComposing) return;
              e.preventDefault();
              commitDraft();
            }
          }}
          placeholder={placeholder}
          autoCorrect={identifierField ? 'off' : undefined}
          autoCapitalize={identifierField ? 'none' : undefined}
          spellCheck={identifierField ? false : undefined}
          className={`flex-1 min-w-0 rounded border border-white/15 bg-slate-900 px-2 py-1 text-xs ${
            identifierField ? 'font-mono text-slate-100' : 'text-slate-100'
          }`}
        />
        <button
          type="button"
          onClick={commitDraft}
          className="inline-flex items-center gap-1 rounded border border-white/15 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-cyan-400/50 hover:text-cyan-200 shrink-0"
        >
          <Plus className="h-3 w-3" /> 添加
        </button>
      </div>

      {/* 可折叠的目录候选多选列表 */}
      {pickerOpen && (
        <div
          id={panelId}
          className="rounded-md border border-white/10 bg-slate-900/95 p-2 max-h-48 overflow-y-auto space-y-1.5"
        >
          {filteredSuggestions.length === 0 ? (
            <div className="text-[11px] text-slate-400 py-1">{emptyPickerHint}</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {filteredSuggestions.map((opt) => {
                const active = selectedSet.has(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggleItem(opt.value)}
                    title={opt.meta ? `${opt.value} — ${opt.meta}` : opt.value}
                    className={`inline-flex max-w-full items-center gap-1 rounded border px-2 py-1 text-left text-[11px] transition ${
                      active
                        ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-100'
                        : 'border-white/10 bg-slate-950/70 text-slate-300 hover:border-white/30 hover:bg-slate-800'
                    }`}
                  >
                    {active && <Check className="h-3 w-3 shrink-0 text-cyan-300" />}
                    <span className={identifierField ? 'font-mono break-all' : 'break-words'}>
                      {opt.value}
                    </span>
                    {opt.badge && (
                      <span className="rounded bg-white/10 px-1 py-0.2 text-[10px] text-slate-300 shrink-0">
                        {opt.badge}
                      </span>
                    )}
                    {opt.meta && (
                      <span className="text-[10px] text-slate-400 truncate max-w-[14rem]">
                        {opt.meta}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SourceBindingFields({
  binding,
  onChange,
  catalog,
}: {
  binding: OperatorSourceBinding;
  onChange: (next: OperatorSourceBinding) => void;
  catalog?: F1OutputCatalog | null;
}) {
  const uid = useId();
  const [tableFilter, setTableFilter] = useState('');

  const csvEvents = useMemo(() => {
    const list = [...(catalog?.event_exporter?.events ?? [])];
    list.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [catalog]);

  const sharedCols = useMemo(
    () => catalog?.event_exporter?.shared_make_paras_dict_prefix ?? [],
    [catalog],
  );

  const matchedEvent = useMemo(
    () =>
      csvEvents.find(
        (ev) => ev.name.toLowerCase() === (binding.csvTable ?? '').trim().toLowerCase(),
      ),
    [csvEvents, binding.csvTable],
  );

  const colSpecs = useMemo(() => {
    const out: Array<{ name: string; cs_type?: string; note?: string; isNumeric: boolean }> = [];
    const seen = new Set<string>();
    const pushCol = (c: { name: string; cs_type?: string; note?: string }) => {
      if (!c.name || seen.has(c.name)) return;
      seen.add(c.name);
      out.push({
        name: c.name,
        cs_type: c.cs_type,
        note: c.note,
        isNumeric: Boolean(c.cs_type && NUMERIC_CS_TYPE_RE.test(c.cs_type)),
      });
    };
    for (const c of matchedEvent?.fields ?? []) pushCol(c);
    for (const c of sharedCols) pushCol(c);
    return out;
  }, [matchedEvent, sharedCols]);

  const isNumericAgg =
    AGG_OPTIONS.find((o) => o.value === binding.aggregation)?.numericOnly ?? false;

  const catalogBsPaths = useMemo(() => {
    const out: string[] = BS_PATH_SUGGESTIONS.map((s) => s.value);
    if (catalog?.bs_mqtt?.scenario_paths) {
      for (const v of Object.values(catalog.bs_mqtt.scenario_paths)) {
        if (typeof v === 'string') out.push(v);
        else if (Array.isArray(v)) out.push(...v);
      }
    }
    return [...new Set(out)];
  }, [catalog]);

  const filteredTables = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    if (!q) return csvEvents;
    return csvEvents.filter(
      (ev) =>
        ev.name.toLowerCase().includes(q) ||
        (ev.note && ev.note.toLowerCase().includes(q)),
    );
  }, [csvEvents, tableFilter]);

  return (
    <div className="space-y-3 rounded-xl border border-emerald-400/25 bg-emerald-500/5 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-emerald-200 flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5 text-emerald-400" />
          数据源直连提取引擎配置（真实解析底层文件）
        </span>
        <span className="text-[11px] text-slate-400">选择来源通道后可逐列/路径点选</span>
      </div>

      {/* 互斥 2 选 1：使用原生单选框分段按钮组 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
        <fieldset className="space-y-1">
          <legend className="text-slate-400 mb-1">数据源类型</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                { value: 'csv', label: 'EventExporter CSV 表列' },
                { value: 'bs_jsonl', label: 'BS JSONL 帧路径' },
              ] as const
            ).map((opt) => {
              const active = binding.sourceType === opt.value;
              return (
                <label
                  key={opt.value}
                  className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-center font-medium transition focus-within:ring-2 focus-within:ring-cyan-400 ${
                    active
                      ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-100'
                      : 'border-white/15 bg-slate-900 text-slate-300 hover:border-white/30'
                  }`}
                >
                  <input
                    type="radio"
                    name={`${uid}-source-type`}
                    value={opt.value}
                    checked={active}
                    onChange={() => onChange({ ...binding, sourceType: opt.value })}
                    className="sr-only"
                  />
                  {opt.label}
                </label>
              );
            })}
          </div>
        </fieldset>

        <label className="block">
          <span className="text-slate-400 block mb-1">聚合算子</span>
          <select
            aria-label="数据源聚合方式"
            value={binding.aggregation}
            onChange={(e) =>
              onChange({
                ...binding,
                aggregation: e.target.value as SourceBindingAgg,
              })
            }
            className="w-full rounded-lg border border-white/15 bg-slate-900 px-2.5 py-1.5 text-slate-100"
          >
            {AGG_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {binding.sourceType === 'csv' ? (
        <div className="space-y-2.5 rounded-lg border border-white/10 bg-slate-950/60 p-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-1">
                <label htmlFor={`${uid}-csv-table`} className="text-slate-400">
                  CSV 来源表 (csvTable)
                </label>
                {matchedEvent?.note && (
                  <span className="text-[10px] text-emerald-300 truncate max-w-[12rem]">
                    {matchedEvent.note}
                  </span>
                )}
              </div>
              {csvEvents.length > 0 && (
                <select
                  aria-label="从目录选择 CSV 来源表"
                  value={matchedEvent?.name ?? ''}
                  onChange={(e) => {
                    const nextTable = e.target.value;
                    if (!nextTable) return;
                    const ev = csvEvents.find((item) => item.name === nextTable);
                    const firstCol = ev?.fields?.[0]?.name ?? binding.csvColumn;
                    onChange({
                      ...binding,
                      csvTable: nextTable,
                      csvColumn: firstCol,
                    });
                  }}
                  className="w-full rounded-lg border border-emerald-400/30 bg-slate-900 px-2 py-1 text-emerald-200"
                >
                  <option value="">— 从 44 张标准事件表选取 —</option>
                  {filteredTables.map((ev) => (
                    <option key={ev.name} value={ev.name}>
                      {ev.name}
                      {ev.note ? ` · ${ev.note}` : ''}
                      {ev.status !== 'active' ? ` [${ev.status}]` : ''}
                    </option>
                  ))}
                </select>
              )}
              <input
                id={`${uid}-csv-table`}
                aria-label="直连 CSV 来源表"
                value={binding.csvTable ?? ''}
                onChange={(e) => {
                  onChange({ ...binding, csvTable: e.target.value });
                  setTableFilter(e.target.value);
                }}
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="或手动输入自定义表名，如 WeaponFired"
                className="w-full rounded-lg border border-white/15 bg-slate-900 px-2.5 py-1 font-mono text-emerald-200"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor={`${uid}-csv-col`} className="text-slate-400 block">
                核心字段列 (csvColumn)
                {isNumericAgg && (
                  <span className="ml-1 text-[10px] text-amber-300">· 数值聚合</span>
                )}
              </label>
              {colSpecs.length > 0 && (
                <select
                  aria-label="从当前表字段选取核心列"
                  value={colSpecs.some((c) => c.name === binding.csvColumn) ? binding.csvColumn : ''}
                  onChange={(e) => {
                    if (e.target.value) onChange({ ...binding, csvColumn: e.target.value });
                  }}
                  className="w-full rounded-lg border border-cyan-400/30 bg-slate-900 px-2 py-1 text-cyan-100"
                >
                  <option value="">
                    — 从 {matchedEvent?.name || '当前表'} ({colSpecs.length} 列) 选取 —
                  </option>
                  {colSpecs.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                      {c.cs_type ? ` (${c.cs_type})` : ''}
                      {c.note ? ` · ${c.note}` : ''}
                    </option>
                  ))}
                </select>
              )}
              <input
                id={`${uid}-csv-col`}
                aria-label="直连 CSV 核心字段列"
                value={binding.csvColumn ?? ''}
                onChange={(e) => onChange({ ...binding, csvColumn: e.target.value })}
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="例如：TargetContactRangeHoriz_nm"
                className="w-full rounded-lg border border-white/15 bg-slate-900 px-2.5 py-1 font-mono text-slate-100"
              />
            </div>
          </div>

          {colSpecs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              <span className="text-[10px] text-slate-400 mr-1">快速选列：</span>
              {colSpecs.slice(0, 10).map((c) => {
                const selected = binding.csvColumn === c.name;
                return (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => onChange({ ...binding, csvColumn: c.name })}
                    title={`${c.name}${c.cs_type ? ` (${c.cs_type})` : ''}${c.note ? ` · ${c.note}` : ''}`}
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                      selected
                        ? 'border-cyan-400 bg-cyan-500/25 text-cyan-100'
                        : c.isNumeric && isNumericAgg
                          ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400'
                          : 'border-white/10 bg-slate-900 text-slate-300 hover:border-white/30'
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-white/10 bg-slate-950/60 p-2.5">
          <label className="block">
            <span className="text-slate-400 block mb-1">BS JSONL 路径表达式 (bsPath)</span>
            <input
              aria-label="直连 BS JSONL 路径"
              value={binding.bsPath ?? ''}
              onChange={(e) => onChange({ ...binding, bsPath: e.target.value })}
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="例如：ActiveUnits[].Speed 或 ActiveUnits[].CS"
              className="w-full rounded-lg border border-white/15 bg-slate-900 px-2.5 py-1.5 font-mono text-amber-200"
            />
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-slate-400">常用路径：</span>
            {catalogBsPaths.slice(0, 10).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onChange({ ...binding, bsPath: p })}
                className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                  binding.bsPath === p
                    ? 'border-amber-400 bg-amber-500/20 text-amber-100'
                    : 'border-white/10 bg-slate-900 text-slate-300 hover:border-amber-400/40'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 可选过滤条件 + 快捷阵营占位符 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <label className="block">
          <span className="text-slate-400 block mb-1">可选过滤字段 (filterField)</span>
          <input
            aria-label="可选过滤字段"
            list={binding.sourceType === 'csv' ? `${uid}-csv-filter-cols` : undefined}
            value={binding.filterField ?? ''}
            onChange={(e) => onChange({ ...binding, filterField: e.target.value })}
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={binding.sourceType === 'csv' ? '例如：FiringUnitSide' : '例如：Side / Name'}
            className="w-full rounded-lg border border-white/15 bg-slate-900 px-2.5 py-1.5 font-mono text-slate-100"
          />
          {binding.sourceType === 'csv' && (
            <datalist id={`${uid}-csv-filter-cols`}>
              {colSpecs.map((c) => (
                <option key={c.name} value={c.name} />
              ))}
            </datalist>
          )}
        </label>

        <div className="space-y-1">
          <label className="block">
            <span className="text-slate-400 block mb-1">过滤目标值（支持动态阵营变量）</span>
            <input
              aria-label="过滤目标值"
              value={binding.filterEquals ?? ''}
              onChange={(e) => onChange({ ...binding, filterEquals: e.target.value })}
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="${targetSide} 或 红方"
              className="w-full rounded-lg border border-white/15 bg-slate-900 px-2.5 py-1.5 text-slate-100"
            />
          </label>
          <div className="flex flex-wrap gap-1">
            {['${targetSide}', '${enemySide}', '红方', '蓝方', 'Blue', 'Red'].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => onChange({ ...binding, filterEquals: preset })}
                className="rounded border border-white/10 bg-slate-900 px-1.5 py-0.5 text-[10px] font-mono text-slate-300 hover:border-emerald-400/50 hover:text-emerald-200"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FieldContractEditorFields({
  csvTablesText,
  csvColumnsText,
  bsPathsText,
  notesText,
  onChange,
  catalog,
  isBuiltin,
  sourceBinding,
  onSyncFromPipeline,
  pipelineInfo,
  onOpenPipeline,
}: {
  csvTablesText: string;
  csvColumnsText: string;
  bsPathsText: string;
  notesText: string;
  onChange: (patch: Partial<{
    csvTablesText: string;
    csvColumnsText: string;
    bsPathsText: string;
    notesText: string;
  }>) => void;
  catalog?: F1OutputCatalog | null;
  isBuiltin: boolean;
  sourceBinding?: OperatorSourceBinding | null;
  onSyncFromPipeline?: () => void;
  pipelineInfo?: { hasPipeline: boolean; nodeCount: number; title?: string } | null;
  onOpenPipeline?: () => void;
}) {
  const csvEvents = useMemo(() => {
    const list = [...(catalog?.event_exporter?.events ?? [])];
    list.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [catalog]);

  const selectedTables = useMemo(
    () => splitListInput(csvTablesText, /[,，\n]+/),
    [csvTablesText],
  );

  // CSV 来源表候选（全部 44 表 + 中文释义 + 字段数）
  const csvTableSuggestions = useMemo<CatalogSuggestionOption[]>(
    () =>
      csvEvents.map((ev) => ({
        value: ev.name,
        meta: ev.note,
        badge: `${ev.fields?.length ?? 0}列`,
      })),
    [csvEvents],
  );

  // 核心字段列候选：严格按当前已选 CSV 来源表自动级联聚合字段
  const csvColumnSuggestions = useMemo<CatalogSuggestionOption[]>(() => {
    const out: CatalogSuggestionOption[] = [];
    const seen = new Set<string>();
    const pushField = (name: string, badge?: string, meta?: string) => {
      if (!name || seen.has(name)) return;
      seen.add(name);
      out.push({ value: name, badge, meta });
    };

    const selectedLower = new Set(selectedTables.map((t) => t.toLowerCase()));
    const matchedEvents = csvEvents.filter((ev) => selectedLower.has(ev.name.toLowerCase()));

    for (const ev of matchedEvents) {
      for (const f of ev.fields ?? []) {
        pushField(f.name, f.cs_type, `${ev.name}${f.note ? ` · ${f.note}` : ''}`);
      }
    }
    for (const f of catalog?.event_exporter?.shared_make_paras_dict_prefix ?? []) {
      pushField(f.name, f.cs_type, `公共前缀${f.note ? ` · ${f.note}` : ''}`);
    }
    if (matchedEvents.length === 0) {
      for (const common of ['Time', 'FiringUnitSide', 'TargetUnitSide', 'Side', 'UnitID', 'UnitName', 'WeaponID']) {
        pushField(common, '常用', '先选 CSV 来源表可展开专属字段');
      }
    }
    return out;
  }, [selectedTables, csvEvents, catalog]);

  // BS JSONL 路径候选
  const bsSuggestions = useMemo<CatalogSuggestionOption[]>(() => {
    const out: CatalogSuggestionOption[] = [];
    const seen = new Set<string>();
    const add = (value: string, badge?: string, meta?: string) => {
      if (!value || seen.has(value)) return;
      seen.add(value);
      out.push({ value, badge, meta });
    };
    for (const item of BS_PATH_SUGGESTIONS) {
      add(item.value, item.value.startsWith('bs-diff:') ? '差分事件' : 'BS路径', item.hint);
    }
    if (catalog?.bs_mqtt?.scenario_paths) {
      for (const [group, rawVal] of Object.entries(catalog.bs_mqtt.scenario_paths)) {
        const list = typeof rawVal === 'string' ? [rawVal] : Array.isArray(rawVal) ? rawVal : [];
        for (const p of list) add(p, group);
      }
    }
    return out;
  }, [catalog]);

  // 口径偏差备注候选（来自 catalog.doc_discrepancies + 常见口径提示）
  const discrepancySuggestions = useMemo<CatalogSuggestionOption[]>(() => {
    const out: CatalogSuggestionOption[] = (catalog?.doc_discrepancies ?? []).map((note, idx) => ({
      value: note,
      badge: `D${idx + 1}`,
    }));
    if (out.length === 0) {
      out.push(
        { value: 'UnitType="武器" / UnitClass="Weapon" 需从平台战损中排除', badge: '口径' },
        { value: '部分 Bridge 推演默认关闭 IsExportExperimentEvaluation 时无 ContactCreated.csv', badge: 'Bridge' },
      );
    }
    return out;
  }, [catalog]);

  const handleSyncFromBinding = () => {
    if (!sourceBinding) return;
    if (sourceBinding.sourceType === 'csv') {
      const nextTables = splitListInput(
        `${csvTablesText}, ${sourceBinding.csvTable ?? ''}`,
        /[,，\n]+/,
      ).join(', ');
      const nextCols = splitListInput(
        `${csvColumnsText}, ${sourceBinding.csvColumn ?? ''}, ${sourceBinding.filterField ?? ''}`,
        /[,，\n]+/,
      ).join(', ');
      onChange({ csvTablesText: nextTables, csvColumnsText: nextCols });
    } else if (sourceBinding.bsPath?.trim()) {
      const nextBs = splitListInput(
        `${bsPathsText} | ${sourceBinding.bsPath}`,
        /[|\n]+/,
      ).join(' | ');
      onChange({ bsPathsText: nextBs });
    }
  };

  return (
    <div className="space-y-2.5 rounded-lg border border-amber-400/25 bg-amber-500/5 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-amber-200">
            底层数据来源与字段映射 (f1FieldContract)
          </span>
          {pipelineInfo?.hasPipeline && (
            <span className="inline-flex items-center gap-1 rounded bg-sky-500/20 border border-sky-400/40 px-2 py-0.5 text-[10px] text-sky-300 font-mono">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
              <span>已连接画布流水线 ({pipelineInfo.nodeCount} 节点)</span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onSyncFromPipeline && (
            <button
              type="button"
              onClick={onSyncFromPipeline}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/60 bg-sky-600/30 px-2.5 py-1 text-[11px] font-semibold text-sky-200 hover:bg-sky-600/50 hover:border-sky-300 shadow-sm transition cursor-pointer"
              title="一键从该算子的画布流水线节点中提取所有引用的 CSV 表、字段列及计算参数，实现单一真相源完全对齐"
            >
              <Sparkles className="h-3 w-3 text-sky-300" />
              <span>⚡ 从画布节点自动同步</span>
            </button>
          )}
          {onOpenPipeline && (
            <button
              type="button"
              onClick={onOpenPipeline}
              className="inline-flex items-center gap-1 rounded border border-cyan-400/40 bg-cyan-600/20 px-2 py-1 text-[11px] text-cyan-200 hover:bg-cyan-600/30 cursor-pointer"
              title="打开画布工坊进行可视化节点拓扑编排"
            >
              <Workflow className="h-3 w-3 text-cyan-300" />
              <span>🎨 打开画布编排</span>
            </button>
          )}
          {sourceBinding && (
            <button
              type="button"
              onClick={handleSyncFromBinding}
              className="rounded border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-200 hover:bg-emerald-500/25"
            >
              从直连提取同步表列/路径
            </button>
          )}
          <span className="text-[11px] text-slate-400">
            {isBuiltin
              ? '更新字段映射及「仿真输出规范 / 源文件剖析」反查（不改动内置 TS 计算）'
              : '更新目录与「仿真输出规范」映射反查（支持点选多值标签，无需手敲分隔符）'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <TokenContractField
          label="CSV 来源表 (csvTables)"
          inputAriaLabel="编辑 CSV 来源表"
          placeholder="搜索或输入表名回车添加，如 WeaponFired"
          valueText={csvTablesText}
          sepRegex={/[,，\n]+/}
          joinSep=", "
          onChangeText={(next) => onChange({ csvTablesText: next })}
          suggestions={csvTableSuggestions}
          pickerToggleLabel="选择 CSV 表"
          emptyPickerHint="未匹配到 F1 事件表，可直接回车添加自定义表名"
          chipTone="emerald"
        />

        <TokenContractField
          label="核心字段列 (csvColumns)"
          inputAriaLabel="编辑核心字段列"
          placeholder="搜索或输入列名回车添加（已按上方 CSV 表过滤）"
          valueText={csvColumnsText}
          sepRegex={/[,，\n]+/}
          joinSep=", "
          onChangeText={(next) => onChange({ csvColumnsText: next })}
          suggestions={csvColumnSuggestions}
          pickerToggleLabel={selectedTables.length > 0 ? '联动选列' : '常用列'}
          emptyPickerHint="当前表中未找到匹配字段，可直接回车添加列名"
          chipTone="cyan"
        />

        <TokenContractField
          label="BS JSONL 路径 (bsFramePaths)"
          inputAriaLabel="编辑 BS JSONL 路径"
          placeholder="输入路径表达式或 bs-diff 事件回车添加，如 ActiveUnits[].Speed"
          valueText={bsPathsText}
          sepRegex={/[|\n]+/}
          joinSep=" | "
          onChangeText={(next) => onChange({ bsPathsText: next })}
          suggestions={bsSuggestions}
          pickerToggleLabel="选择 BS 路径"
          emptyPickerHint="未匹配到预设路径，可直接回车添加自定义 JSONL 路径"
          chipTone="amber"
          fullWidth
        />

        <TokenContractField
          label="口径说明 / 偏差备注 (discrepancyNotes)"
          inputAriaLabel="编辑口径偏差备注"
          placeholder="输入口径说明或偏差备注回车添加，或从右侧插入 D1-D9 实证记录"
          valueText={notesText}
          sepRegex={/[;；\n]+/}
          joinSep="；"
          onChangeText={(next) => onChange({ notesText: next })}
          suggestions={discrepancySuggestions}
          pickerToggleLabel="D1-D9 备注库"
          emptyPickerHint="无匹配条目，可输入任意说明回车添加"
          chipTone="slate"
          identifierField={false}
          multilineNote
          fullWidth
        />
      </div>
    </div>
  );
}
