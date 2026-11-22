import { Plus, RotateCcw, Save, SlidersHorizontal, Trash2, Workflow, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  evalApi,
  type CustomOperatorDefinition,
  type F1OutputCatalog,
  type MetricAtomMeta,
  type OperatorDefaultParams,
  type OperatorSourceBinding,
} from '../api.ts';
import {
  buildFieldContractFromText,
  FieldContractEditorFields,
  SourceBindingFields,
} from './OperatorContractAndBindingFields.tsx';
import { getOperatorSpecificParamKeys, PARAM_DEFINITIONS } from './operator-param-defs.ts';

interface OperatorInlineEditorProps {
  operator: MetricAtomMeta;
  allOperators: MetricAtomMeta[];
  catalog?: F1OutputCatalog | null;
  headingId?: string;
  onCancel: () => void;
  onSaved: (updatedMeta: MetricAtomMeta, message: string) => Promise<void>;
  onDeleted?: (deletedAtomId: string) => Promise<void>;
  onOpenPipeline?: (operator: MetricAtomMeta) => void;
}

function toNumStr(v?: number): string {
  return v !== undefined && Number.isFinite(v) ? String(v) : '';
}

function toOptNum(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function OperatorInlineEditor({
  operator,
  allOperators,
  catalog = null,
  headingId,
  onCancel,
  onSaved,
  onDeleted,
  onOpenPipeline,
}: OperatorInlineEditorProps) {
  const isCustom = Boolean(operator.isCustom && operator.customDef);

  const [name, setName] = useState(operator.name);
  const [unit, setUnit] = useState(operator.unit ?? '');
  const [direction, setDirection] = useState(operator.defaultOptimalDirection);
  const [description, setDescription] = useState(operator.description);

  // F1 实证字段契约标注 (csvTables / csvColumns / bsFramePaths / discrepancyNotes)
  const [csvTablesText, setCsvTablesText] = useState(
    (operator.f1FieldContract.csvTables ?? []).join(', '),
  );
  const [csvColumnsText, setCsvColumnsText] = useState(
    (operator.f1FieldContract.csvColumns ?? []).join(', '),
  );
  const [bsPathsText, setBsPathsText] = useState(
    (operator.f1FieldContract.bsFramePaths ?? []).join(' | '),
  );
  const [notesText, setNotesText] = useState(
    (operator.f1FieldContract.discrepancyNotes ?? []).join('；'),
  );

  // 默认运行参数基线
  const [targetSide, setTargetSide] = useState(operator.defaultParams?.targetSide ?? '');
  const [enemySide, setEnemySide] = useState(operator.defaultParams?.enemySide ?? '');
  const [safeRadiusNm, setSafeRadiusNm] = useState(toNumStr(operator.defaultParams?.safeRadiusNm));
  const [minRangeNm, setMinRangeNm] = useState(toNumStr(operator.defaultParams?.minRangeNm));
  const [expectedSpacingNm, setExpectedSpacingNm] = useState(
    toNumStr(operator.defaultParams?.expectedSpacingNm),
  );
  const [arrivalLineLon, setArrivalLineLon] = useState(
    toNumStr(operator.defaultParams?.arrivalLineLon),
  );
  const [waveGapSeconds, setWaveGapSeconds] = useState(
    toNumStr(operator.defaultParams?.waveGapSeconds),
  );
  const [minSafeMarginKm, setMinSafeMarginKm] = useState(
    toNumStr(operator.defaultParams?.minSafeMarginKm),
  );
  const [thresholdLow, setThresholdLow] = useState(
    toNumStr(operator.defaultParams?.thresholdLow),
  );
  const [thresholdHigh, setThresholdHigh] = useState(
    toNumStr(operator.defaultParams?.thresholdHigh),
  );

  // 动态参数基线按需展示
  const [showAllParams, setShowAllParams] = useState(false);
  const specificKeys = useMemo(
    () => new Set(getOperatorSpecificParamKeys(operator)),
    [operator],
  );

  // 自定义算子专属字段（计算模式、公式/直连提取、变量、领域、输出类型）
  const [customMode, setCustomMode] = useState<
    'formula' | 'source_binding' | 'formula_pipeline' | 'aggregation'
  >(operator.customDef?.mode ?? 'formula');
  const [category, setCategory] = useState(operator.category);
  const [outputType, setOutputType] = useState(operator.outputType);
  const [expression, setExpression] = useState(operator.customDef?.expression ?? '');
  const [variables, setVariables] = useState<Array<{ alias: string; atomRef: string }>>(
    operator.customDef?.variables.map((v) => ({ ...v })) ?? [],
  );
  const [sourceBinding, setSourceBinding] = useState<OperatorSourceBinding>(
    operator.customDef?.sourceBinding ?? {
      sourceType: 'csv',
      csvTable: operator.f1FieldContract.csvTables?.[0] ?? 'WeaponFired',
      csvColumn: operator.f1FieldContract.csvColumns?.[0] ?? 'TargetContactRangeHoriz_nm',
      bsPath: operator.f1FieldContract.bsFramePaths?.[0] ?? 'ActiveUnits[].CS',
      aggregation: 'avg',
    },
  );

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pipelineInfo, setPipelineInfo] = useState<{
    hasPipeline: boolean;
    nodeCount: number;
    title?: string;
    derivedContract?: any;
  } | null>(null);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  // 监听并拉取当前算子的画布算法流水线（实现单一真相源）
  useEffect(() => {
    let active = true;
    evalApi
      .getOperatorPipeline(operator.id)
      .then((res) => {
        if (!active) return;
        const nodes = res.pipeline?.nodes || res.blueprint?.nodes || [];
        if (nodes.length > 0) {
          setPipelineInfo({
            hasPipeline: true,
            nodeCount: nodes.length,
            title: res.pipeline?.pipelineTitle || res.blueprint?.name,
            derivedContract: res.derivedContract,
          });

          // 若当前契约为空，自动从画布流水线初始化
          if (
            (!operator.f1FieldContract.csvTables || operator.f1FieldContract.csvTables.length === 0) &&
            res.derivedContract?.csvTables?.length > 0
          ) {
            setCsvTablesText(res.derivedContract.csvTables.join(', '));
            if (res.derivedContract.csvColumns?.length > 0) {
              setCsvColumnsText(res.derivedContract.csvColumns.join(', '));
            }
            if (res.derivedContract.defaultParams?.minSafeMarginKm !== undefined) {
              setMinSafeMarginKm(String(res.derivedContract.defaultParams.minSafeMarginKm));
            }
            if (res.derivedContract.defaultParams?.thresholdLow !== undefined) {
              setThresholdLow(String(res.derivedContract.defaultParams.thresholdLow));
            }
            if (res.derivedContract.defaultParams?.thresholdHigh !== undefined) {
              setThresholdHigh(String(res.derivedContract.defaultParams.thresholdHigh));
            }
          }
        } else {
          setPipelineInfo(null);
        }
      })
      .catch(() => {
        if (active) setPipelineInfo(null);
      });
    return () => {
      active = false;
    };
  }, [operator.id]);

  const handleSyncFromPipeline = () => {
    if (!pipelineInfo?.derivedContract) {
      setErrorMsg('未检测到此算子的画布流水线节点数据');
      return;
    }
    const d = pipelineInfo.derivedContract;
    if (d.csvTables?.length > 0) setCsvTablesText(d.csvTables.join(', '));
    if (d.csvColumns?.length > 0) setCsvColumnsText(d.csvColumns.join(', '));
    if (d.defaultParams?.minSafeMarginKm !== undefined) {
      setMinSafeMarginKm(String(d.defaultParams.minSafeMarginKm));
    }
    if (d.defaultParams?.thresholdLow !== undefined) {
      setThresholdLow(String(d.defaultParams.thresholdLow));
    }
    if (d.defaultParams?.thresholdHigh !== undefined) {
      setThresholdHigh(String(d.defaultParams.thresholdHigh));
    }
    if (d.unit) setUnit(d.unit);
    if (d.optimalDirection) setDirection(d.optimalDirection);
    if (d.discrepancyNotes?.length > 0) {
      const existing = notesText ? notesText.split(/[；;\n]+/).map((s: string) => s.trim()).filter(Boolean) : [];
      const combined = Array.from(new Set([...existing, ...d.discrepancyNotes]));
      setNotesText(combined.join('；'));
    }
    setSyncToast(`已自动从画布节点同步：${d.csvTables?.length || 0} 张表、${d.csvColumns?.length || 0} 个核心列及运行参数！`);
    setTimeout(() => setSyncToast(null), 3500);
  };

  useEffect(() => {
    setName(operator.name);
    setUnit(operator.unit ?? '');
    setDirection(operator.defaultOptimalDirection);
    setDescription(operator.description);
    setCsvTablesText((operator.f1FieldContract.csvTables ?? []).join(', '));
    setCsvColumnsText((operator.f1FieldContract.csvColumns ?? []).join(', '));
    setBsPathsText((operator.f1FieldContract.bsFramePaths ?? []).join(' | '));
    setNotesText((operator.f1FieldContract.discrepancyNotes ?? []).join('；'));
    setTargetSide(operator.defaultParams?.targetSide ?? '');
    setEnemySide(operator.defaultParams?.enemySide ?? '');
    setSafeRadiusNm(toNumStr(operator.defaultParams?.safeRadiusNm));
    setMinRangeNm(toNumStr(operator.defaultParams?.minRangeNm));
    setExpectedSpacingNm(toNumStr(operator.defaultParams?.expectedSpacingNm));
    setArrivalLineLon(toNumStr(operator.defaultParams?.arrivalLineLon));
    setWaveGapSeconds(toNumStr(operator.defaultParams?.waveGapSeconds));
    setMinSafeMarginKm(toNumStr(operator.defaultParams?.minSafeMarginKm));
    setThresholdLow(toNumStr(operator.defaultParams?.thresholdLow));
    setThresholdHigh(toNumStr(operator.defaultParams?.thresholdHigh));
    setCustomMode(operator.customDef?.mode ?? 'formula');
    setCategory(operator.category);
    setOutputType(operator.outputType);
    setExpression(operator.customDef?.expression ?? '');
    setVariables(operator.customDef?.variables.map((v) => ({ ...v })) ?? []);
    setSourceBinding(
      operator.customDef?.sourceBinding ?? {
        sourceType: 'csv',
        csvTable: operator.f1FieldContract.csvTables?.[0] ?? 'WeaponFired',
        csvColumn: operator.f1FieldContract.csvColumns?.[0] ?? 'TargetContactRangeHoriz_nm',
        bsPath: operator.f1FieldContract.bsFramePaths?.[0] ?? 'ActiveUnits[].CS',
        aggregation: 'avg',
      },
    );
    setErrorMsg(null);
  }, [operator]);

  const selectableRefs = allOperators.filter((op) => op.id !== operator.id);

  const buildDefaultParams = (): OperatorDefaultParams | undefined => {
    const out: OperatorDefaultParams = {};
    if (targetSide.trim()) out.targetSide = targetSide.trim();
    if (enemySide.trim()) out.enemySide = enemySide.trim();
    const numericMap: Array<[keyof OperatorDefaultParams, string]> = [
      ['safeRadiusNm', safeRadiusNm],
      ['minRangeNm', minRangeNm],
      ['expectedSpacingNm', expectedSpacingNm],
      ['arrivalLineLon', arrivalLineLon],
      ['waveGapSeconds', waveGapSeconds],
      ['minSafeMarginKm', minSafeMarginKm],
      ['thresholdLow', thresholdLow],
      ['thresholdHigh', thresholdHigh],
    ];
    for (const [key, raw] of numericMap) {
      const n = toOptNum(raw);
      if (n !== undefined) {
        (out as Record<string, number>)[key] = n;
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };

  const handleSave = async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const defaultParams = buildDefaultParams();
      const f1FieldContract = buildFieldContractFromText({
        csvTablesText,
        csvColumnsText,
        bsPathsText,
        notesText,
      });
      if (isCustom && operator.customDef) {
        const customPayload: CustomOperatorDefinition = {
          id: operator.id,
          name: name.trim(),
          category,
          description: description.trim(),
          mode: customMode,
          expression: expression.trim(),
          variables: variables.filter((v) => v.alias.trim() && v.atomRef),
          ...(customMode === 'source_binding' ? { sourceBinding } : {}),
          ...(Object.keys(f1FieldContract).length > 0 ? { f1FieldContract } : {}),
          outputType,
          unit: unit.trim() || undefined,
          defaultOptimalDirection: direction,
          defaultParams,
          createdAt: operator.customDef.createdAt,
        };
        const res = await evalApi.updateOperator(operator.id, customPayload);
        await onSaved(res.operator, `已保存自定义算子 ${operator.id} 配置与数据源映射，并同步全库口径`);
      } else {
        const res = await evalApi.updateOperator(operator.id, {
          id: operator.id,
          name: name.trim(),
          description: description.trim(),
          unit: unit.trim(),
          defaultOptimalDirection: direction,
          defaultParams,
          f1FieldContract,
        });
        await onSaved(res.operator, `已覆写内置算子 ${operator.id} 的口径、字段映射与默认参数`);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await evalApi.resetOperatorOverride(operator.id);
      await onSaved(res.operator, `已恢复内置算子 ${operator.id} 的出厂默认定义与参数`);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isCustom) return;
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`确定要删除自定义算子「${operator.name} (${operator.id})」吗？此操作不可撤销。`)
    ) {
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      await evalApi.deleteOperator(operator.id);
      await onDeleted?.(operator.id);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex max-h-[86vh] flex-col text-xs">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3.5 shrink-0">
        <div className="min-w-0">
          <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold text-white">
            <SlidersHorizontal className="h-4 w-4 text-cyan-400 shrink-0" />
            <span>{isCustom ? '编辑自定义算子配置' : '覆写内置算子口径、字段映射与默认参数'}</span>
            <span className="rounded bg-cyan-500/15 border border-cyan-400/30 px-2 py-0.5 font-mono text-[11px] font-normal text-cyan-200">
              {operator.id}
            </span>
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {onOpenPipeline && (
            <button
              type="button"
              onClick={() => onOpenPipeline(operator)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/50 bg-cyan-600/25 px-2.5 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-600/40 hover:text-white transition shadow-sm"
              title="在画布工坊中打开此算子的完整算法流水线编排"
            >
              <Workflow className="h-3.5 w-3.5 text-cyan-300" />
              <span>🎨 打开画布算法编排</span>
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            aria-label="关闭算子配置弹窗"
            className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-white/10 hover:text-white shrink-0"
          >
            <X className="h-3.5 w-3.5" />
            关闭
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block sm:col-span-2">
          <span className="text-slate-400 block mb-1">算子显示名称</span>
          <input
            autoFocus
            aria-label="编辑算子名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-1.5 text-slate-100"
          />
        </label>

        <label className="block">
          <span className="text-slate-400 block mb-1">输出单位</span>
          <input
            aria-label="编辑算子单位"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="秒 / 命中率 / nm"
            className="w-full rounded-lg border border-white/15 bg-slate-900 px-2.5 py-1.5 text-slate-100"
          />
        </label>

        <label className="block">
          <span className="text-slate-400 block mb-1">优劣方向</span>
          <select
            aria-label="编辑算子优劣方向"
            value={direction}
            onChange={(e) => setDirection(e.target.value as MetricAtomMeta['defaultOptimalDirection'])}
            className="w-full rounded-lg border border-white/15 bg-slate-900 px-2.5 py-1.5 text-slate-100"
          >
            <option value="smaller_is_better">smaller_is_better（越小越好）</option>
            <option value="larger_is_better">larger_is_better（越大越好）</option>
            <option value="range_bounded">range_bounded（区间收敛）</option>
          </select>
        </label>

        {isCustom && (
          <>
            <label className="block">
              <span className="text-slate-400 block mb-1">所属领域</span>
              <select
                aria-label="编辑自定义算子领域"
                value={category}
                onChange={(e) => setCategory(e.target.value as MetricAtomMeta['category'])}
                className="w-full rounded-lg border border-white/15 bg-slate-900 px-2.5 py-1.5 text-slate-100"
              >
                <option value="time">time (时效域)</option>
                <option value="effectiveness">effectiveness (效能域)</option>
                <option value="situation">situation (态势域)</option>
                <option value="compliance">compliance (合规域)</option>
                <option value="cost">cost (成本域)</option>
              </select>
            </label>
            <label className="block">
              <span className="text-slate-400 block mb-1">输出类型</span>
              <select
                aria-label="编辑自定义算子输出类型"
                value={outputType}
                onChange={(e) => setOutputType(e.target.value as MetricAtomMeta['outputType'])}
                className="w-full rounded-lg border border-white/15 bg-slate-900 px-2.5 py-1.5 text-slate-100"
              >
                <option value="score">score</option>
                <option value="ratio">ratio</option>
                <option value="rate">rate</option>
                <option value="count">count</option>
                <option value="duration_seconds">duration_seconds</option>
              </select>
            </label>
          </>
        )}

        <label className="block sm:col-span-2">
          <span className="text-slate-400 block mb-1">物理口径说明</span>
          <textarea
            aria-label="编辑算子说明"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-slate-900 px-2.5 py-1.5 text-slate-100"
          />
        </label>
      </div>

      {isCustom && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400">计算模式：</span>
            <button
              type="button"
              onClick={() => setCustomMode('formula')}
              className={`rounded border px-2.5 py-1 ${
                customMode === 'formula'
                  ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                  : 'border-[#30363d] bg-[#0f141a] text-slate-300'
              }`}
            >
              公式组合模式
            </button>
            <button
              type="button"
              onClick={() => setCustomMode('source_binding')}
              className={`rounded-lg border px-2.5 py-1 ${
                customMode === 'source_binding'
                  ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-200'
                  : 'border-white/15 bg-slate-900 text-slate-300'
              }`}
            >
              数据源直连提取 (CSV / BS 路径)
            </button>
          </div>

          {customMode === 'source_binding' ? (
            <SourceBindingFields
              binding={sourceBinding}
              onChange={setSourceBinding}
              catalog={catalog}
            />
          ) : (
            <div className="space-y-2 rounded-lg border border-violet-400/25 bg-violet-500/5 p-2.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-violet-200">衍生公式与变量绑定</span>
                <button
                  type="button"
                  onClick={() => {
                    const nextLetter = String.fromCharCode(97 + (variables.length % 26));
                    const alias = variables.some((v) => v.alias === nextLetter)
                      ? `v${variables.length + 1}`
                      : nextLetter;
                    setVariables([
                      ...variables,
                      { alias, atomRef: selectableRefs[0]?.id ?? 'kc.first_detection_range' },
                    ]);
                  }}
                  className="inline-flex items-center gap-1 rounded border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-white/10"
                >
                  <Plus className="h-3 w-3" />
                  添加变量
                </button>
              </div>
              <div className="space-y-1.5">
                {variables.map((v, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-1.5 items-center">
                    <input
                      aria-label={`编辑变量别名 ${idx + 1}`}
                      value={v.alias}
                      onChange={(e) => {
                        const next = [...variables];
                        next[idx] = { ...v, alias: e.target.value };
                        setVariables(next);
                      }}
                      className="col-span-3 rounded border border-white/15 bg-slate-900 px-2 py-1 font-mono text-cyan-200"
                    />
                    <select
                      aria-label={`编辑变量引用 ${idx + 1}`}
                      value={v.atomRef}
                      onChange={(e) => {
                        const next = [...variables];
                        next[idx] = { ...v, atomRef: e.target.value };
                        setVariables(next);
                      }}
                      className="col-span-8 rounded border border-white/15 bg-slate-900 px-2 py-1 font-mono text-slate-100"
                    >
                      {selectableRefs.map((op) => (
                        <option key={op.id} value={op.id}>
                          {op.id} — {op.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={variables.length <= 1}
                      aria-label="删除变量绑定"
                      onClick={() => setVariables(variables.filter((_, i) => i !== idx))}
                      className="col-span-1 flex justify-center text-rose-300 hover:text-rose-200 disabled:opacity-30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <label className="block">
                <span className="text-[#8b949e] block mb-1">计算表达式</span>
                <input
                  aria-label="编辑算子公式"
                  value={expression}
                  onChange={(e) => setExpression(e.target.value)}
                  className="w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 font-mono text-blue-300"
                />
              </label>
            </div>
          )}
        </div>
      )}

      {syncToast && (
        <div className="rounded-lg border border-sky-400/50 bg-sky-500/15 px-3 py-2 text-xs text-sky-200 flex items-center justify-between">
          <span>{syncToast}</span>
          <button
            type="button"
            onClick={() => setSyncToast(null)}
            className="text-sky-300 hover:text-white ml-2"
          >
            ×
          </button>
        </div>
      )}

      <FieldContractEditorFields
        csvTablesText={csvTablesText}
        csvColumnsText={csvColumnsText}
        bsPathsText={bsPathsText}
        notesText={notesText}
        catalog={catalog}
        isBuiltin={!isCustom}
        sourceBinding={isCustom && customMode === 'source_binding' ? sourceBinding : null}
        onSyncFromPipeline={pipelineInfo ? handleSyncFromPipeline : undefined}
        pipelineInfo={pipelineInfo}
        onOpenPipeline={onOpenPipeline ? () => onOpenPipeline(operator) : undefined}
        onChange={(patch) => {
          if (patch.csvTablesText !== undefined) setCsvTablesText(patch.csvTablesText);
          if (patch.csvColumnsText !== undefined) setCsvColumnsText(patch.csvColumnsText);
          if (patch.bsPathsText !== undefined) setBsPathsText(patch.bsPathsText);
          if (patch.notesText !== undefined) setNotesText(patch.notesText);
        }}
      />

      {/* 全局默认运行参数基线（动态按需过滤） */}
      <div className="space-y-2 rounded-md border border-[#2a313c] bg-[#0f141a] p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-200">
              默认运行参数基线（用于批量对比、指标评估与沙箱初值）
            </span>
            {specificKeys.size === 0 && (
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                纯事件/统计类
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowAllParams((prev) => !prev)}
            className="text-[11px] text-cyan-400 hover:text-cyan-300 underline"
          >
            {showAllParams ? '收起非关联参数' : '+ 展开全部可选参数'}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {/* 通用阵营参数（始终保留） */}
          <label className="block">
            <span className="text-slate-400 block mb-0.5">我方阵营 targetSide</span>
            <input
              aria-label="默认 targetSide"
              value={targetSide}
              onChange={(e) => setTargetSide(e.target.value)}
              placeholder="默认自动识别（如 红方）"
              className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-slate-100"
            />
          </label>
          <label className="block">
            <span className="text-slate-400 block mb-0.5">敌方阵营 enemySide</span>
            <input
              aria-label="默认 enemySide"
              value={enemySide}
              onChange={(e) => setEnemySide(e.target.value)}
              placeholder="默认自动识别（如 蓝方）"
              className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-slate-100"
            />
          </label>

          {/* 专属物理阈值参数（按需或展开时展示） */}
          {(showAllParams || specificKeys.has('safeRadiusNm') || safeRadiusNm !== '') && (
            <label className="block">
              <span className="text-slate-400 block mb-0.5">
                安全半径 safeRadiusNm (nm)
                {specificKeys.has('safeRadiusNm') && (
                  <span className="ml-1 text-[10px] text-blue-400 font-mono">· 适用</span>
                )}
              </span>
              <input
                aria-label="默认 safeRadiusNm"
                type="number"
                step="0.5"
                value={safeRadiusNm}
                onChange={(e) => setSafeRadiusNm(e.target.value)}
                placeholder="默认 30 或场景威胁区"
                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-slate-100"
              />
            </label>
          )}

          {(showAllParams || specificKeys.has('minRangeNm') || minRangeNm !== '') && (
            <label className="block">
              <span className="text-slate-400 block mb-0.5">
                最小射距 minRangeNm (nm)
                {specificKeys.has('minRangeNm') && (
                  <span className="ml-1 text-[10px] text-blue-400 font-mono">· 适用</span>
                )}
              </span>
              <input
                aria-label="默认 minRangeNm"
                type="number"
                step="1"
                value={minRangeNm}
                onChange={(e) => setMinRangeNm(e.target.value)}
                placeholder="默认 10"
                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-slate-100"
              />
            </label>
          )}

          {(showAllParams || specificKeys.has('expectedSpacingNm') || expectedSpacingNm !== '') && (
            <label className="block">
              <span className="text-slate-400 block mb-0.5">
                编队间距 expectedSpacingNm (nm)
                {specificKeys.has('expectedSpacingNm') && (
                  <span className="ml-1 text-[10px] text-blue-400 font-mono">· 适用</span>
                )}
              </span>
              <input
                aria-label="默认 expectedSpacingNm"
                type="number"
                step="0.5"
                value={expectedSpacingNm}
                onChange={(e) => setExpectedSpacingNm(e.target.value)}
                placeholder="默认 5"
                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-slate-100"
              />
            </label>
          )}

          {(showAllParams || specificKeys.has('arrivalLineLon') || arrivalLineLon !== '') && (
            <label className="block">
              <span className="text-slate-400 block mb-0.5">
                到达经线 arrivalLineLon (°)
                {specificKeys.has('arrivalLineLon') && (
                  <span className="ml-1 text-[10px] text-blue-400 font-mono">· 适用</span>
                )}
              </span>
              <input
                aria-label="默认 arrivalLineLon"
                type="number"
                step="0.1"
                value={arrivalLineLon}
                onChange={(e) => setArrivalLineLon(e.target.value)}
                placeholder="未指定（突防测距需填）"
                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-slate-100"
              />
            </label>
          )}

          {(showAllParams || specificKeys.has('waveGapSeconds') || waveGapSeconds !== '') && (
            <label className="block sm:col-span-3">
              <span className="text-slate-400 block mb-0.5">
                波次间隔阈值 waveGapSeconds (秒)
                {specificKeys.has('waveGapSeconds') && (
                  <span className="ml-1 text-[10px] text-blue-400 font-mono">· 适用</span>
                )}
              </span>
              <input
                aria-label="默认 waveGapSeconds"
                type="number"
                step="5"
                value={waveGapSeconds}
                onChange={(e) => setWaveGapSeconds(e.target.value)}
                placeholder="默认 60"
                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-slate-100"
              />
            </label>
          )}

          {(showAllParams || specificKeys.has('minSafeMarginKm') || minSafeMarginKm !== '') && (
            <label className="block">
              <span className="text-slate-400 block mb-0.5">
                走廊安全裕度 minSafeMarginKm (km)
                {specificKeys.has('minSafeMarginKm') && (
                  <span className="ml-1 text-[10px] text-blue-400 font-mono">· 适用</span>
                )}
              </span>
              <input
                aria-label="默认 minSafeMarginKm"
                type="number"
                step="1"
                value={minSafeMarginKm}
                onChange={(e) => setMinSafeMarginKm(e.target.value)}
                placeholder="默认 15.0"
                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-slate-100"
              />
            </label>
          )}

          {(showAllParams || specificKeys.has('thresholdLow') || thresholdLow !== '') && (
            <label className="block">
              <span className="text-slate-400 block mb-0.5">
                达标门限下限 thresholdLow (0-1)
                {specificKeys.has('thresholdLow') && (
                  <span className="ml-1 text-[10px] text-blue-400 font-mono">· 适用</span>
                )}
              </span>
              <input
                aria-label="默认 thresholdLow"
                type="number"
                step="0.05"
                value={thresholdLow}
                onChange={(e) => setThresholdLow(e.target.value)}
                placeholder="默认 0.85"
                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-slate-100"
              />
            </label>
          )}

          {(showAllParams || specificKeys.has('thresholdHigh') || thresholdHigh !== '') && (
            <label className="block">
              <span className="text-slate-400 block mb-0.5">
                优秀门限上限 thresholdHigh (0-1)
                {specificKeys.has('thresholdHigh') && (
                  <span className="ml-1 text-[10px] text-blue-400 font-mono">· 适用</span>
                )}
              </span>
              <input
                aria-label="默认 thresholdHigh"
                type="number"
                step="0.05"
                value={thresholdHigh}
                onChange={(e) => setThresholdHigh(e.target.value)}
                placeholder="默认 0.95"
                className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 text-slate-100"
              />
            </label>
          )}
        </div>

        {/* 字段用途说明提示条 */}
        <div className="rounded bg-slate-900/60 p-2 text-[11px] text-slate-400 leading-relaxed">
          {specificKeys.size === 0 ? (
            <span>
              ℹ️ 该算子基于底层仿真推演事实数据（时间戳/命中状态）直接统计，无需外置物理门限。仅需确认评测视角（我方/敌方）。
            </span>
          ) : (
            <div className="space-y-0.5">
              <span className="font-medium text-slate-300">当前算子消费阈值说明：</span>
              {Array.from(specificKeys).map((k) => (
                <div key={k} className="text-slate-400">
                  <span className="font-mono text-cyan-300">{PARAM_DEFINITIONS[k].label} ({k})</span>
                  ：{PARAM_DEFINITIONS[k].description}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-rose-500/35 bg-rose-500/15 p-2.5 text-rose-200">
          {errorMsg}
        </div>
      )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-slate-950/60 px-5 py-3 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500 px-4 py-1.5 font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? '保存中…' : '保存配置并重算'}
          </button>

          {!isCustom && operator.isOverridden && (
            <button
              type="button"
              disabled={saving}
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/35 bg-amber-500/10 px-3 py-1.5 font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              恢复默认
            </button>
          )}

          {isCustom && (
            <button
              type="button"
              disabled={saving}
              onClick={handleDelete}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 font-medium text-rose-200 hover:bg-rose-500/25 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除算子
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-slate-300 hover:bg-white/10"
        >
          取消
        </button>
      </div>
    </div>
  );
}
