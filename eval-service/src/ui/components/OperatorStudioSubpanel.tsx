import { CheckCircle2, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  evalApi,
  type CustomOperatorDefinition,
  type F1OutputCatalog,
  type MetricAtomMeta,
  type MetricAtomResult,
  type OperatorDefaultParams,
  type OperatorSourceBinding,
  type StoredRunSummary,
} from '../api.ts';
import {
  buildFieldContractFromText,
  FieldContractEditorFields,
  SourceBindingFields,
} from './OperatorContractAndBindingFields.tsx';

interface OperatorStudioSubpanelProps {
  operators: MetricAtomMeta[];
  runs: StoredRunSummary[];
  initialRunId: string;
  catalog?: F1OutputCatalog | null;
  draftTemplate?: { seq: number; def: CustomOperatorDefinition } | null;
  onRefresh: () => Promise<void>;
}

const PRESET_TEMPLATES: Array<{
  label: string;
  def: Omit<CustomOperatorDefinition, 'createdAt'>;
}> = [
  {
    label: '单弹药效费命中指数 (命中率×100 / 投弹密度)',
    def: {
      id: 'custom.hit_per_munitions_density',
      name: '单平台弹药命中效率指数',
      category: 'effectiveness',
      description: '将武器直接命中率 (%) 与单平台平均投弹密度相除，评估单位火力密度换取命中率的综合效能。',
      expression: 'round((a * 100) / max(b, 0.01))',
      variables: [
        { alias: 'a', atomRef: 'wpn.probability_of_hit' },
        { alias: 'b', atomRef: 'cost.unit_munitions_intensity' },
      ],
      outputType: 'score',
      unit: '效能指数',
      defaultOptimalDirection: 'larger_is_better',
    },
  },
  {
    label: '导弹飞行占比 (平均飞行时长 / 交战总窗口)',
    def: {
      id: 'custom.flight_to_combat_ratio',
      name: '导弹飞航时间占交战窗口比',
      category: 'time',
      description: '测算武器发射至末端平均飞行时长占全交战总窗口时间的比例，辅助识别末端导引窗口占比。',
      expression: 'clamp(a / max(b, 1), 0, 1)',
      variables: [
        { alias: 'a', atomRef: 'kc.engage_to_assess_latency' },
        { alias: 'b', atomRef: 'kc.f2t2ea_total_latency' },
      ],
      outputType: 'ratio',
      unit: '占比 (0-1)',
      defaultOptimalDirection: 'smaller_is_better',
    },
  },
  {
    label: 'CSV 直连：WeaponFired 水平射距均值 (nm)',
    def: {
      id: 'custom.csv_wf_range_avg',
      name: 'WeaponFired 实测射距均值',
      category: 'situation',
      mode: 'source_binding',
      description: '直接读取 EventExporter WeaponFired.csv 的 TargetContactRangeHoriz_nm 列求平均发射距离。',
      expression: '',
      variables: [],
      sourceBinding: {
        sourceType: 'csv',
        csvTable: 'WeaponFired',
        csvColumn: 'TargetContactRangeHoriz_nm',
        filterField: 'FiringUnitSide',
        filterEquals: '${targetSide}',
        aggregation: 'avg',
      },
      outputType: 'score',
      unit: 'nm',
      defaultOptimalDirection: 'larger_is_better',
    },
  },
  {
    label: 'BS 直连：ActiveUnits[].Speed 平台航速均值',
    def: {
      id: 'custom.bs_active_unit_speed_avg',
      name: 'BS 活跃单元航速均值',
      category: 'situation',
      mode: 'source_binding',
      description: '直接提取 BS JSONL 帧 ActiveUnits[].Speed（真机 Q-077 可切换为 ActiveUnits[].CS）统计全帧平均速度。',
      expression: '',
      variables: [],
      sourceBinding: {
        sourceType: 'bs_jsonl',
        bsPath: 'ActiveUnits[].Speed',
        aggregation: 'avg',
      },
      outputType: 'score',
      unit: 'kts',
      defaultOptimalDirection: 'larger_is_better',
    },
  },
];

export function OperatorStudioSubpanel({
  operators,
  runs,
  initialRunId,
  catalog = null,
  draftTemplate = null,
  onRefresh,
}: OperatorStudioSubpanelProps) {
  const [mode, setMode] = useState<
    'formula' | 'source_binding' | 'formula_pipeline' | 'aggregation'
  >('formula');
  const [id, setId] = useState('custom.hit_per_munitions_density');
  const [name, setName] = useState('单平台弹药命中效率指数');
  const [category, setCategory] = useState<CustomOperatorDefinition['category']>('effectiveness');
  const [outputType, setOutputType] = useState<CustomOperatorDefinition['outputType']>('score');
  const [direction, setDirection] =
    useState<CustomOperatorDefinition['defaultOptimalDirection']>('larger_is_better');
  const [unit, setUnit] = useState('效能指数');
  const [description, setDescription] = useState(
    '组合现有算子计算：将命中率放大并按投弹密度归一化。',
  );
  const [expression, setExpression] = useState('round((a * 100) / max(b, 0.01))');
  const [variables, setVariables] = useState<Array<{ alias: string; atomRef: string }>>([
    { alias: 'a', atomRef: 'wpn.probability_of_hit' },
    { alias: 'b', atomRef: 'cost.unit_munitions_intensity' },
  ]);
  const [sourceBinding, setSourceBinding] = useState<OperatorSourceBinding>({
    sourceType: 'csv',
    csvTable: 'WeaponFired',
    csvColumn: 'TargetContactRangeHoriz_nm',
    filterField: 'FiringUnitSide',
    filterEquals: '${targetSide}',
    aggregation: 'avg',
  });
  const [csvTablesText, setCsvTablesText] = useState('');
  const [csvColumnsText, setCsvColumnsText] = useState('');
  const [bsPathsText, setBsPathsText] = useState('');
  const [notesText, setNotesText] = useState('');
  const [defaultParams, setDefaultParams] = useState<OperatorDefaultParams | undefined>(undefined);

  const [previewRunId, setPreviewRunId] = useState(initialRunId || runs[0]?.runId || '');
  const [previewOut, setPreviewOut] = useState<{
    valid: boolean;
    errors: string[];
    result: MetricAtomResult;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const customOps = useMemo(() => operators.filter((o) => o.isCustom), [operators]);

  const buildDef = (): CustomOperatorDefinition => {
    const f1FieldContract = buildFieldContractFromText({
      csvTablesText,
      csvColumnsText,
      bsPathsText,
      notesText,
    });
    return {
      id: id.trim(),
      name: name.trim(),
      category,
      description: description.trim(),
      mode,
      expression: expression.trim(),
      variables: variables.filter((v) => v.alias.trim() && v.atomRef),
      ...(mode === 'source_binding' ? { sourceBinding } : {}),
      ...(Object.keys(f1FieldContract).length > 0 ? { f1FieldContract } : {}),
      outputType,
      unit: unit.trim() || undefined,
      defaultOptimalDirection: direction,
      ...(defaultParams ? { defaultParams } : {}),
    };
  };

  const applyTemplate = (def: Omit<CustomOperatorDefinition, 'createdAt'>) => {
    setMode(def.mode ?? 'formula');
    setId(def.id);
    setName(def.name);
    setCategory(def.category);
    setOutputType(def.outputType);
    setDirection(def.defaultOptimalDirection);
    setUnit(def.unit ?? '');
    setDescription(def.description);
    setExpression(def.expression);
    setVariables(def.variables.map((v) => ({ ...v })));
    if (def.sourceBinding) {
      setSourceBinding({ ...def.sourceBinding });
    } else if (def.f1FieldContract) {
      setSourceBinding({
        sourceType: def.f1FieldContract.csvTables?.length ? 'csv' : 'bs_jsonl',
        csvTable: def.f1FieldContract.csvTables?.[0] ?? 'WeaponFired',
        csvColumn: def.f1FieldContract.csvColumns?.[0] ?? '',
        bsPath: def.f1FieldContract.bsFramePaths?.[0] ?? 'ActiveUnits[].CS',
        aggregation: 'avg',
      });
    }
    setCsvTablesText((def.f1FieldContract?.csvTables ?? []).join(', '));
    setCsvColumnsText((def.f1FieldContract?.csvColumns ?? []).join(', '));
    setBsPathsText((def.f1FieldContract?.bsFramePaths ?? []).join(' | '));
    setNotesText((def.f1FieldContract?.discrepancyNotes ?? []).join('；'));
    setDefaultParams(def.defaultParams);
    setPreviewOut(null);
    setStatusMsg(null);
  };

  useEffect(() => {
    if (!draftTemplate) return;
    applyTemplate(draftTemplate.def);
    setStatusMsg({
      kind: 'ok',
      text: `已从算子「${draftTemplate.def.variables[0]?.atomRef ?? draftTemplate.def.id}」克隆生成衍生草稿，可修改公式或参数后试算并保存。`,
    });
  }, [draftTemplate]);

  const handleAddVar = () => {
    const nextLetter = String.fromCharCode(97 + (variables.length % 26));
    const alias = variables.some((v) => v.alias === nextLetter)
      ? `v${variables.length + 1}`
      : nextLetter;
    setVariables([...variables, { alias, atomRef: operators[0]?.id ?? 'kc.pid_to_engage_latency' }]);
  };

  const handlePreview = async () => {
    const rid = previewRunId || runs[0]?.runId;
    if (!rid) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const res = await evalApi.previewOperatorFormula(buildDef(), rid);
      setPreviewOut(res);
    } catch (e) {
      setStatusMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const res = await evalApi.upsertOperator(buildDef());
      await onRefresh();
      setStatusMsg({
        kind: 'ok',
        text: `已保存衍生算子 ${res.operator.id}，现可在「指标配置」直接绑定引用！`,
      });
    } catch (e) {
      setStatusMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (atomId: string) => {
    setBusy(true);
    setStatusMsg(null);
    try {
      await evalApi.deleteOperator(atomId);
      await onRefresh();
      setStatusMsg({ kind: 'ok', text: `已删除自定义算子 ${atomId}` });
    } catch (e) {
      setStatusMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
      {/* 左侧：公式编辑器与变量绑定 */}
      <section className="lg:col-span-7 rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              自定义公式与字段提取
            </h3>
            <p className="text-xs text-[#8b949e] mt-0.5">
              支持 <code className="text-blue-300">+ - * / ( )</code> 及{' '}
              <code className="text-blue-300">min / max / abs / sqrt / avg / clamp / round</code>，任一引用算子缺数时结果记为不可用。
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-[#8b949e]">快速模板：</span>
          {PRESET_TEMPLATES.map((tpl) => (
            <button
              key={tpl.def.id}
              type="button"
              onClick={() => applyTemplate(tpl.def)}
              className="rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1 text-blue-300 hover:border-blue-500"
            >
              {tpl.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <label className="block">
            <span className="text-slate-400 block mb-1">算子 ID（建议 `custom.` 前缀）</span>
            <input
              aria-label="自定义算子 ID"
              value={id}
              onChange={(e) => setId(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-slate-900 px-2.5 py-1.5 font-mono text-slate-100"
            />
          </label>
          <label className="block">
            <span className="text-slate-400 block mb-1">算子显示名称</span>
            <input
              aria-label="自定义算子名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-slate-900 px-2.5 py-1.5 text-slate-100"
            />
          </label>
          <label className="block">
            <span className="text-slate-400 block mb-1">所属领域</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as CustomOperatorDefinition['category'])}
              className="w-full rounded-lg border border-white/15 bg-slate-900 px-2.5 py-1.5 text-slate-100"
            >
              <option value="time">time (时效域)</option>
              <option value="effectiveness">effectiveness (效能域)</option>
              <option value="situation">situation (态势域)</option>
              <option value="compliance">compliance (合规域)</option>
              <option value="cost">cost (成本域)</option>
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="text-slate-400 block mb-1">输出类型</span>
              <select
                value={outputType}
                onChange={(e) => setOutputType(e.target.value as CustomOperatorDefinition['outputType'])}
                className="w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 text-slate-100"
              >
                <option value="score">score</option>
                <option value="ratio">ratio</option>
                <option value="rate">rate</option>
                <option value="count">count</option>
                <option value="duration_seconds">duration_seconds</option>
              </select>
            </label>
            <label className="block">
              <span className="text-slate-400 block mb-1">最优方向</span>
              <select
                value={direction}
                onChange={(e) =>
                  setDirection(e.target.value as CustomOperatorDefinition['defaultOptimalDirection'])
                }
                className="w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 text-slate-100"
              >
                <option value="larger_is_better">越大越优</option>
                <option value="smaller_is_better">越小越优</option>
                <option value="range_bounded">区间适中</option>
              </select>
            </label>
            <label className="block">
              <span className="text-slate-400 block mb-1">物理单位</span>
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 text-slate-100"
              />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400">构建模式：</span>
          <button
            type="button"
            onClick={() => setMode('formula')}
            className={`rounded border px-3 py-1 font-medium ${
              mode === 'formula'
                ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                : 'border-[#30363d] bg-[#0f141a] text-slate-300'
            }`}
          >
            公式组合模式
          </button>
          <button
            type="button"
            onClick={() => setMode('source_binding')}
            className={`rounded-lg border px-3 py-1 font-medium ${
              mode === 'source_binding'
                ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-200'
                : 'border-white/15 bg-slate-900 text-slate-300'
            }`}
          >
            数据源直连提取 (CSV 表列 / BS 路径)
          </button>
        </div>

        {/* 变量绑定清单或数据源直连提取配置 */}
        {mode === 'source_binding' ? (
          <SourceBindingFields
            binding={sourceBinding}
            onChange={setSourceBinding}
            catalog={catalog}
          />
        ) : (
          <>
            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">变量与底层算子绑定</span>
                <button
                  type="button"
                  onClick={handleAddVar}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-slate-900 px-2 py-1 text-[11px] text-cyan-300 hover:border-cyan-400/50"
                >
                  <Plus className="h-3 w-3" /> 添加变量
                </button>
              </div>

              <div className="space-y-2">
                {variables.map((v, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-2 text-xs">
                    <input
                      aria-label={`变量别名 ${idx + 1}`}
                      value={v.alias}
                      onChange={(e) => {
                        const copy = [...variables];
                        copy[idx] = { ...v, alias: e.target.value };
                        setVariables(copy);
                      }}
                      className="w-20 rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 font-mono text-cyan-300"
                      placeholder="a"
                    />
                    <span className="text-slate-500">=</span>
                    <select
                      aria-label={`变量绑定算子 ${idx + 1}`}
                      value={v.atomRef}
                      onChange={(e) => {
                        const copy = [...variables];
                        copy[idx] = { ...v, atomRef: e.target.value };
                        setVariables(copy);
                      }}
                      className="flex-1 min-w-[200px] rounded-lg border border-white/15 bg-slate-900 px-2.5 py-1.5 text-slate-100"
                    >
                      {operators.map((op) => (
                        <option key={op.id} value={op.id}>
                          {op.id} — {op.name}
                        </option>
                      ))}
                    </select>
                    {variables.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setVariables(variables.filter((_, i) => i !== idx))}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-500/10"
                        title="移除变量"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <label className="block text-xs">
              <span className="text-slate-400 block mb-1">数学组合表达式</span>
              <input
                aria-label="自定义算子数学表达式"
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                className="w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 font-mono text-cyan-200"
                placeholder="例如：(a * 100) / max(b, 1)"
              />
            </label>
          </>
        )}

        <FieldContractEditorFields
          csvTablesText={csvTablesText}
          csvColumnsText={csvColumnsText}
          bsPathsText={bsPathsText}
          notesText={notesText}
          catalog={catalog}
          isBuiltin={false}
          sourceBinding={mode === 'source_binding' ? sourceBinding : null}
          onChange={(patch) => {
            if (patch.csvTablesText !== undefined) setCsvTablesText(patch.csvTablesText);
            if (patch.csvColumnsText !== undefined) setCsvColumnsText(patch.csvColumnsText);
            if (patch.bsPathsText !== undefined) setBsPathsText(patch.bsPathsText);
            if (patch.notesText !== undefined) setNotesText(patch.notesText);
          }}
        />

        <label className="block text-xs">
          <span className="text-slate-400 block mb-1">算子物理含义说明</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-1.5 text-slate-200"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <select
            aria-label="公式调试样本 Run"
            value={previewRunId}
            onChange={(e) => setPreviewRunId(e.target.value)}
            className="rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-xs text-slate-100"
          >
            {runs.map((r) => (
              <option key={r.runId} value={r.runId}>
                试算样本：{r.scenarioName}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={handlePreview}
            className="rounded-xl border border-cyan-400/50 bg-cyan-500/15 px-3.5 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
          >
            {mode === 'source_binding' ? '实时试算数据源提取' : '实时试算表达式'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" /> 保存到算子库
          </button>
        </div>

        {statusMsg && (
          <div
            className={`rounded-xl border p-2.5 text-xs ${
              statusMsg.kind === 'ok'
                ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                : 'border-rose-500/35 bg-rose-500/10 text-rose-200'
            }`}
          >
            {statusMsg.text}
          </div>
        )}
      </section>

      {/* 右侧：试算结果 + 已保存自定义算子库 */}
      <section className="lg:col-span-5 space-y-3.5">
        {previewOut && (
          <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5 space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-100 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-blue-400" />
                公式沙箱试算结果
              </span>
              <span
                className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                  previewOut.result.status === 'valid'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : previewOut.result.status === 'degraded'
                      ? 'bg-amber-500/15 text-amber-300'
                      : 'bg-rose-500/15 text-rose-300'
                }`}
              >
                {previewOut.result.status}
              </span>
            </div>
            {!previewOut.valid && previewOut.errors.length > 0 && (
              <div className="rounded bg-rose-500/15 p-2 text-rose-200">
                语法/引用错误：{previewOut.errors.join('；')}
              </div>
            )}
            <div className="flex items-baseline justify-between">
              <span className="text-[#8b949e]">测算结果</span>
              <span className="text-base font-semibold text-blue-300 tabular-nums">
                {previewOut.result.displayValue}
              </span>
            </div>
            {previewOut.result.missingDataReason && (
              <p className="rounded bg-rose-500/10 p-2 text-rose-200">
                {previewOut.result.missingDataReason}
              </p>
            )}
            {previewOut.result.details && (
              <pre className="rounded bg-[#0f141a] p-2 font-mono text-[11px] text-slate-300 overflow-x-auto">
                {JSON.stringify(previewOut.result.details, null, 2)}
              </pre>
            )}
          </div>
        )}

        <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5 space-y-2.5">
          <h4 className="text-sm font-semibold text-slate-100">
            已落盘自定义算子 ({customOps.length})
          </h4>
          {customOps.length === 0 ? (
            <p className="text-xs text-[#8b949e]">
              当前暂无自定义算子。可在左侧选择模板或编写表达式后点击「保存到算子库」。
            </p>
          ) : (
            <ul className="space-y-2">
              {customOps.map((op) => (
                <li
                  key={op.id}
                  className="rounded-md border border-[#262d38] bg-[#0f141a] p-2.5 text-xs space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-blue-300 truncate">{op.id}</div>
                      <div className="font-medium text-slate-100">{op.name}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {op.customDef && (
                        <button
                          type="button"
                          onClick={() => applyTemplate(op.customDef!)}
                          className="rounded border border-[#30363d] px-2 py-0.5 text-[11px] text-slate-300 hover:border-blue-500"
                        >
                          载入编辑
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDelete(op.id)}
                        className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-200 hover:bg-rose-500/20"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  {op.customDef && (
                    <div className="font-mono text-[11px] text-[#8b949e] truncate">
                      {op.customDef.expression}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
