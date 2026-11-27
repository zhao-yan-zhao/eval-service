import { Code2, RotateCcw, Save, SlidersHorizontal, Trash2, Workflow, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  evalApi,
  type F1OutputCatalog,
  type MetricDomainTag,
  type MetricMilitaryLevel,
  type OperatorCategory,
  type ParameterPortSpec,
  type V4OperatorEngineKind,
  type V4OperatorItem,
  type V4OperatorLayer,
} from '../api.ts';
import {
  FieldContractEditorFields,
  splitListInput,
} from './OperatorContractAndBindingFields.tsx';

interface OperatorInlineEditorProps {
  operator: V4OperatorItem;
  allOperators: V4OperatorItem[];
  catalog?: F1OutputCatalog | null;
  headingId?: string;
  onCancel: () => void;
  onSaved: (updatedOp: V4OperatorItem, message: string) => Promise<void>;
  onDeleted?: (deletedOpId: string) => Promise<void>;
  onOpenPipeline?: (operator: V4OperatorItem) => void;
}

export function OperatorInlineEditor({
  operator,
  catalog = null,
  headingId,
  onCancel,
  onSaved,
  onDeleted,
  onOpenPipeline,
}: OperatorInlineEditorProps) {
  const isCustom = !operator.isBuiltin;

  const [name, setName] = useState(operator.name);
  const [category, setCategory] = useState<OperatorCategory>(operator.category);
  const [domainTag, setDomainTag] = useState<MetricDomainTag>(operator.domainTag);
  const [militaryLevel, setMilitaryLevel] = useState<MetricMilitaryLevel>(operator.militaryLevel);
  const [layer, setLayer] = useState<V4OperatorLayer>(operator.layer ?? 'fact');
  const [engineKind, setEngineKind] = useState<V4OperatorEngineKind>(operator.engineKind ?? 'python_script');
  const [description, setDescription] = useState(operator.description);
  const [pythonCode, setPythonCode] = useState(operator.pythonCode ?? '');

  // V4 实证底表与输出列契约
  const [requiredTablesText, setRequiredTablesText] = useState(
    (operator.requiredTables ?? []).join(', '),
  );
  const [optionalTablesText, setOptionalTablesText] = useState(
    (operator.optionalTables ?? []).join(', '),
  );
  const [outputColumnsText, setOutputColumnsText] = useState(
    (operator.outputColumnNames ?? []).join(', '),
  );
  const [notesText, setNotesText] = useState('');

  // V4 参数端口（ParameterPortSpec）默认值覆写
  const [paramPorts, setParamPorts] = useState<ParameterPortSpec[]>(
    (operator.parameterPorts ?? []).map((p) => ({ ...p })),
  );

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pipelineInfo, setPipelineInfo] = useState<{
    hasPipeline: boolean;
    nodeCount: number;
    title?: string;
    derivedContract?: {
      csvTables?: string[];
      csvColumns?: string[];
      discrepancyNotes?: string[];
    };
  } | null>(null);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    evalApi
      .getOperatorPipeline(operator.id)
      .then((res) => {
        if (!active) return;
        const nodes = res.pipeline?.nodes || res.blueprint?.nodes || [];
        if (nodes.length > 0) {
          const derived = res.derivedContract;
          setPipelineInfo({
            hasPipeline: true,
            nodeCount: nodes.length,
            title: res.pipeline?.pipelineTitle || res.blueprint?.name,
            derivedContract: derived,
          });
          if (
            (!operator.requiredTables || operator.requiredTables.length === 0) &&
            derived?.csvTables &&
            derived.csvTables.length > 0
          ) {
            setRequiredTablesText(derived.csvTables.join(', '));
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
  }, [operator.id, operator.requiredTables]);

  const handleSyncFromPipeline = () => {
    const d = pipelineInfo?.derivedContract;
    if (!d) {
      setErrorMsg('未检测到此算子的画布流水线节点数据');
      return;
    }
    if (d.csvTables && d.csvTables.length > 0) {
      setRequiredTablesText(d.csvTables.join(', '));
    }
    if (d.csvColumns && d.csvColumns.length > 0) {
      setOutputColumnsText(d.csvColumns.join(', '));
    }
    if (d.discrepancyNotes && d.discrepancyNotes.length > 0) {
      const existing = notesText
        ? notesText.split(/[；;\n]+/).map((s) => s.trim()).filter(Boolean)
        : [];
      const combined = Array.from(new Set([...existing, ...d.discrepancyNotes]));
      setNotesText(combined.join('；'));
    }
    setSyncToast(
      `已自动从画布节点同步：${d.csvTables?.length ?? 0} 张表、${d.csvColumns?.length ?? 0} 个输出列！`,
    );
    setTimeout(() => setSyncToast(null), 3500);
  };

  useEffect(() => {
    setName(operator.name);
    setCategory(operator.category);
    setDomainTag(operator.domainTag);
    setMilitaryLevel(operator.militaryLevel);
    setLayer(operator.layer ?? 'fact');
    setEngineKind(operator.engineKind ?? 'python_script');
    setDescription(operator.description);
    setPythonCode(operator.pythonCode ?? '');
    setRequiredTablesText((operator.requiredTables ?? []).join(', '));
    setOptionalTablesText((operator.optionalTables ?? []).join(', '));
    setOutputColumnsText((operator.outputColumnNames ?? []).join(', '));
    setParamPorts((operator.parameterPorts ?? []).map((p) => ({ ...p })));
    setErrorMsg(null);
  }, [operator]);

  const handleSave = async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const requiredTables = splitListInput(requiredTablesText, /[,，\n]+/);
      const optionalTables = splitListInput(optionalTablesText, /[,，\n]+/);
      const outputColumns = splitListInput(outputColumnsText, /[,，\n]+/);
      const res = await evalApi.updateV4Operator(operator.id, {
        name: name.trim() || operator.name,
        category,
        domainTag,
        militaryLevel,
        layer,
        engineKind,
        description: description.trim(),
        requiredTables,
        optionalTables,
        outputColumns,
        parameterPorts: paramPorts,
        pythonCode,
      });
      await onSaved(
        res.operator,
        isCustom
          ? `已保存自定义 V4 算子 ${operator.id} 配置与数据源映射`
          : `已覆写内置 V4 算子 ${operator.id} 的口径、字段映射与参数端口`,
      );
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
      const res = await evalApi.resetV4OperatorOverride(operator.id);
      await onSaved(res.operator, `已恢复内置 V4 算子 ${operator.id} 的出厂默认定义与参数`);
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
      !window.confirm(`确定要删除自定义 V4 算子「${operator.name} (${operator.id})」吗？此操作不可撤销。`)
    ) {
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      await evalApi.deleteV4Operator(operator.id);
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
            <span>{isCustom ? '编辑自定义 V4 算子配置' : '覆写内置 V4 算子口径、底表契约与参数端口'}</span>
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
              <span>打开画布算法编排</span>
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
            <span className="text-slate-400 block mb-1">业务领域 (Category)</span>
            <select
              aria-label="编辑算子领域"
              value={category}
              onChange={(e) => setCategory(e.target.value as OperatorCategory)}
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
            <span className="text-slate-400 block mb-1">执行引擎 (EngineKind)</span>
            <select
              aria-label="编辑算子引擎"
              value={engineKind}
              onChange={(e) => setEngineKind(e.target.value as V4OperatorEngineKind)}
              className="w-full rounded-lg border border-white/15 bg-slate-900 px-2.5 py-1.5 text-slate-100"
            >
              <option value="python_script">python_script (Python AST 沙箱)</option>
              <option value="spatial">spatial (空间几何)</option>
              <option value="inline_calc">inline_calc (行内公式)</option>
              <option value="group_agg">group_agg (跨行聚合)</option>
              <option value="data_input">data_input (底表直连)</option>
            </select>
          </label>

          <label className="block">
            <span className="text-slate-400 block mb-1">层级定位 (Layer)</span>
            <select
              aria-label="编辑算子层级"
              value={layer}
              onChange={(e) => setLayer(e.target.value as V4OperatorLayer)}
              className="w-full rounded-lg border border-white/15 bg-slate-900 px-2.5 py-1.5 text-slate-100"
            >
              <option value="fact">fact (V4 客观事实算子)</option>
              <option value="legacy_aggregate">legacy_aggregate (V4 汇总算子)</option>
            </select>
          </label>

          <label className="block">
            <span className="text-slate-400 block mb-1">军事度量层级 (MilitaryLevel)</span>
            <select
              aria-label="编辑军事层级"
              value={militaryLevel}
              onChange={(e) => setMilitaryLevel(e.target.value as MetricMilitaryLevel)}
              className="w-full rounded-lg border border-white/15 bg-slate-900 px-2.5 py-1.5 text-slate-100"
            >
              <option value="DP">DP (基础数据)</option>
              <option value="MOP">MOP (性能度量)</option>
              <option value="MOE">MOE (效能度量)</option>
              <option value="MOFE">MOFE (体系效能)</option>
            </select>
          </label>

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
          csvTablesText={requiredTablesText}
          csvColumnsText={outputColumnsText}
          bsPathsText={optionalTablesText}
          notesText={notesText}
          catalog={catalog}
          isBuiltin={!isCustom}
          sourceBinding={null}
          onSyncFromPipeline={pipelineInfo ? handleSyncFromPipeline : undefined}
          pipelineInfo={pipelineInfo}
          onOpenPipeline={onOpenPipeline ? () => onOpenPipeline(operator) : undefined}
          onChange={(patch) => {
            if (patch.csvTablesText !== undefined) setRequiredTablesText(patch.csvTablesText);
            if (patch.csvColumnsText !== undefined) setOutputColumnsText(patch.csvColumnsText);
            if (patch.bsPathsText !== undefined) setOptionalTablesText(patch.bsPathsText);
            if (patch.notesText !== undefined) setNotesText(patch.notesText);
          }}
        />

        {/* V4 参数端口 (ParameterPorts) */}
        {paramPorts.length > 0 && (
          <div className="space-y-2 rounded-md border border-[#2a313c] bg-[#0f141a] p-2.5">
            <div className="font-medium text-slate-200">
              V4 参数端口默认值 ({paramPorts.length} 项)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {paramPorts.map((port, idx) => (
                <label key={port.key} className="block">
                  <span className="text-slate-400 block mb-0.5">
                    {port.label} <span className="font-mono text-cyan-300">({port.key})</span>
                  </span>
                  <input
                    value={String(port.defaultValue ?? '')}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const next = [...paramPorts];
                      let parsed: unknown = raw;
                      if (typeof port.defaultValue === 'number') {
                        const n = Number(raw);
                        parsed = raw.trim() !== '' && Number.isFinite(n) ? n : raw;
                      } else if (typeof port.defaultValue === 'boolean') {
                        parsed = raw === 'true' || raw === '1';
                      }
                      next[idx] = { ...port, defaultValue: parsed };
                      setParamPorts(next);
                    }}
                    className="w-full rounded border border-white/15 bg-slate-950 px-2 py-1 font-mono text-slate-100"
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        {/* V4 Python AST 沙箱脚本 */}
        <div className="space-y-1.5 rounded-md border border-[#2a313c] bg-[#070b14] p-3">
          <div className="flex items-center gap-1.5 font-medium text-fuchsia-300">
            <Code2 className="h-3.5 w-3.5" />
            <span>V4 Python AST 沙箱计算脚本 (pythonCode)</span>
          </div>
          <textarea
            aria-label="编辑 Python 脚本"
            rows={8}
            value={pythonCode}
            onChange={(e) => setPythonCode(e.target.value)}
            spellCheck={false}
            placeholder="# 通过 T('TableName') 读取底表，产出含 Side 列的 output_df"
            className="w-full rounded-lg border border-slate-800 bg-[#0b101b] p-2.5 font-mono text-[11px] leading-relaxed text-slate-200 focus:border-fuchsia-500/60 focus:outline-none"
          />
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs text-rose-200">
            {errorMsg}
          </div>
        )}
      </div>

      {/* 底部保存/重置/删除栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-slate-950/60 px-5 py-3 shrink-0">
        <div className="flex items-center gap-2">
          {!isCustom ? (
            <button
              type="button"
              disabled={saving}
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              恢复出厂默认
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={handleDelete}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-500/20 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除自定义算子
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-white/15 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 hover:text-white"
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/50 bg-cyan-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{saving ? '保存中...' : '保存配置'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
