import {
  AlertCircle,
  BarChart3,
  Check,
  ChevronRight,
  Eye,
  Info,
  Layers,
  Plus,
  RotateCcw,
  Table,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import type {
  AggregationMethod,
  AggregationMetricItem,
  AggregationOperatorConfig,
  DatasetColumn,
  TableDataset,
} from '../api.ts';
import { evaluateAggregationDataset } from '../../operators/aggregation-engine.ts';

export interface AggregationOperatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialConfig?: AggregationOperatorConfig;
  upstreamColumns?: DatasetColumn[];
  sampleDataset?: TableDataset;
  onSave: (config: AggregationOperatorConfig) => void;
  readOnly?: boolean;
}

const METHOD_OPTIONS: Array<{ value: AggregationMethod; label: string; desc: string }> = [
  { value: 'AVERAGE', label: '平均值 (AVERAGE)', desc: '计算数值列的算术均值' },
  { value: 'SUM', label: '累加求和 (SUM)', desc: '计算数值列的累加总量' },
  { value: 'MAX', label: '最大值 (MAX)', desc: '提取列中的最大极限值' },
  { value: 'MIN', label: '最小值 (MIN)', desc: '提取列中的最小极限值' },
  { value: 'COUNT_ALL', label: '样本行数 (COUNT_ALL)', desc: '统计样本行总数 (无需源列)' },
  { value: 'COUNT_DISTINCT', label: '去重计数 (COUNT_DISTINCT)', desc: '统计不重复的唯一取值数量' },
  { value: 'STDEV', label: '样本标准差 (STDEV)', desc: '衡量样本数据的离散程度波动' },
];

const DEFAULT_UPSTREAM_COLUMNS: DatasetColumn[] = [
  { name: 'Entity_ID', type: 'string', description: '作战实体编号' },
  { name: 'Side', type: 'string', description: '战术阵营 (Red/Blue)' },
  { name: 'UnitName', type: 'string', description: '单元名称' },
  { name: 'TargetContactRangeHoriz_nm', type: 'number', description: '接触水平射距 (nm)' },
  { name: 'Speed_kt', type: 'number', description: '航速 (节)' },
  { name: 'Altitude_m', type: 'number', description: '飞行高度 (米)' },
  { name: 'Damage_Percent', type: 'number', description: '战损损伤比 (0-100)' },
  { name: 'WeaponCount', type: 'number', description: '可用弹药数' },
  { name: 'IsHit', type: 'boolean', description: '末端命中指示' },
];

const DEFAULT_SAMPLE_DATASET: TableDataset = {
  columns: DEFAULT_UPSTREAM_COLUMNS,
  rows: [
    {
      Entity_ID: 'U-101',
      Side: 'Red',
      UnitName: 'Su-35 #1',
      TargetContactRangeHoriz_nm: 48.5,
      Speed_kt: 520,
      Altitude_m: 8500,
      Damage_Percent: 12.5,
      WeaponCount: 4,
      IsHit: true,
    },
    {
      Entity_ID: 'U-102',
      Side: 'Red',
      UnitName: 'Su-35 #2',
      TargetContactRangeHoriz_nm: 54.2,
      Speed_kt: 545,
      Altitude_m: 8800,
      Damage_Percent: 0.0,
      WeaponCount: 6,
      IsHit: false,
    },
    {
      Entity_ID: 'U-103',
      Side: 'Blue',
      UnitName: 'F-16V #1',
      TargetContactRangeHoriz_nm: 36.8,
      Speed_kt: 480,
      Altitude_m: 7200,
      Damage_Percent: 85.0,
      WeaponCount: 2,
      IsHit: true,
    },
    {
      Entity_ID: 'U-104',
      Side: 'Blue',
      UnitName: 'F-16V #2',
      TargetContactRangeHoriz_nm: 62.1,
      Speed_kt: 510,
      Altitude_m: 9100,
      Damage_Percent: 24.0,
      WeaponCount: 4,
      IsHit: false,
    },
    {
      Entity_ID: 'U-105',
      Side: 'Blue',
      UnitName: 'E-2D AEW',
      TargetContactRangeHoriz_nm: 110.0,
      Speed_kt: 320,
      Altitude_m: 10500,
      Damage_Percent: 0.0,
      WeaponCount: 0,
      IsHit: false,
    },
  ],
};

export function AggregationOperatorModal({
  isOpen,
  onClose,
  initialConfig,
  upstreamColumns = DEFAULT_UPSTREAM_COLUMNS,
  sampleDataset = DEFAULT_SAMPLE_DATASET,
  onSave,
  readOnly = false,
}: AggregationOperatorModalProps) {
  const headingId = useId();

  // Step 1: 分组主键字段 (Group Keys)
  const [groupKeys, setGroupKeys] = useState<string[]>(() => {
    if (initialConfig?.groupKeys && initialConfig.groupKeys.length > 0) {
      return [...initialConfig.groupKeys];
    }
    return ['Side'];
  });

  // Step 2: 聚合统计度量 (Aggregations)
  const [metrics, setMetrics] = useState<AggregationMetricItem[]>(() => {
    if (initialConfig?.metrics && initialConfig.metrics.length > 0) {
      return initialConfig.metrics.map((m, idx) => ({
        id: m.id || `metric_${idx + 1}`,
        targetField: m.targetField,
        sourceColumn: m.sourceColumn,
        method: m.method || 'AVERAGE',
        description: m.description || '',
      }));
    }
    return [
      {
        id: 'metric_1',
        targetField: 'avg_contact_range_nm',
        sourceColumn: 'TargetContactRangeHoriz_nm',
        method: 'AVERAGE',
        description: '平均水平接触测距',
      },
      {
        id: 'metric_2',
        targetField: 'max_speed_kt',
        sourceColumn: 'Speed_kt',
        method: 'MAX',
        description: '最大机动航速',
      },
      {
        id: 'metric_3',
        targetField: 'total_entities',
        sourceColumn: 'Entity_ID',
        method: 'COUNT_ALL',
        description: '实体样本总数',
      },
    ];
  });

  // 预览状态
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [previewData, setPreviewData] = useState<TableDataset | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLatencyMs, setPreviewLatencyMs] = useState<number>(0);

  // 初始化重置
  useEffect(() => {
    if (initialConfig) {
      setGroupKeys(initialConfig.groupKeys ? [...initialConfig.groupKeys] : []);
      if (initialConfig.metrics && initialConfig.metrics.length > 0) {
        setMetrics(
          initialConfig.metrics.map((m, idx) => ({
            id: m.id || `metric_${idx + 1}`,
            targetField: m.targetField,
            sourceColumn: m.sourceColumn,
            method: m.method || 'AVERAGE',
            description: m.description || '',
          })),
        );
      }
    }
  }, [initialConfig]);

  // 分组键操作
  const handleAddGroupKey = () => {
    const unselected = upstreamColumns.find((c) => !groupKeys.includes(c.name));
    const nextKey = unselected ? unselected.name : upstreamColumns[0]?.name;
    if (nextKey && !groupKeys.includes(nextKey)) {
      setGroupKeys((prev) => [...prev, nextKey]);
    }
  };

  const handleUpdateGroupKey = (index: number, newKey: string) => {
    setGroupKeys((prev) => {
      const copy = [...prev];
      copy[index] = newKey;
      return copy;
    });
  };

  const handleRemoveGroupKey = (index: number) => {
    setGroupKeys((prev) => prev.filter((_, i) => i !== index));
  };

  // 度量行操作
  const handleAddMetric = () => {
    const numericCol =
      upstreamColumns.find((c) => c.type === 'number')?.name ||
      upstreamColumns[0]?.name ||
      '';
    const newIdx = metrics.length + 1;
    setMetrics((prev) => [
      ...prev,
      {
        id: `metric_${Date.now()}_${newIdx}`,
        targetField: `agg_field_${newIdx}`,
        sourceColumn: numericCol,
        method: 'AVERAGE',
        description: '',
      },
    ]);
  };

  const handleUpdateMetric = (index: number, partial: Partial<AggregationMetricItem>) => {
    setMetrics((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index]!, ...partial };
      return copy;
    });
  };

  const handleRemoveMetric = (index: number) => {
    if (metrics.length <= 1) {
      alert('请保留至少一个聚合统计度量。');
      return;
    }
    setMetrics((prev) => prev.filter((_, i) => i !== index));
  };

  // 基础校验
  const validationError = useMemo(() => {
    if (metrics.length === 0) return '请添加至少一个聚合度量。';
    const targetSet = new Set<string>();
    for (const m of metrics) {
      const tf = m.targetField.trim();
      if (!tf) return '度量输出字段名不能为空。';
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tf)) {
        return `输出字段名 "${tf}" 格式不规范，必须以字母或下划线开头。`;
      }
      if (targetSet.has(tf)) {
        return `输出度量字段名 "${tf}" 重复。`;
      }
      targetSet.add(tf);
      if (m.method !== 'COUNT_ALL' && !m.sourceColumn) {
        return `度量 "${tf}" 必须选择源数据列。`;
      }
    }
    return null;
  }, [metrics]);

  // 执行输出预览
  const handleExecutePreview = () => {
    if (validationError) {
      alert(`无法预览: ${validationError}`);
      return;
    }
    setShowPreview(true);
    setPreviewError(null);
    const t0 = performance.now();
    try {
      const config: AggregationOperatorConfig = {
        groupKeys,
        metrics,
      };
      const result = evaluateAggregationDataset(sampleDataset, config);
      setPreviewData(result);
      setPreviewLatencyMs(Math.round(performance.now() - t0));
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
      setPreviewData(null);
    }
  };

  // 保存配置
  const handleConfirm = () => {
    if (validationError) {
      alert(`保存失败: ${validationError}`);
      return;
    }
    onSave({
      groupKeys,
      metrics,
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
    >
      <div className="flex h-[92vh] w-full max-w-[1200px] flex-col overflow-hidden rounded-xl border border-[#1e293b] bg-[#0b1120] text-[#f1f5f9] shadow-2xl">
        {/* Header (严格对齐 Image 3) */}
        <header className="flex items-center justify-between border-b border-[#1e293b] bg-[#0f172a] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 id={headingId} className="text-base font-bold text-white tracking-wide">
                  数据汇总
                </h2>
                <span className="rounded-md border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                  跨行聚合 · N ➔ 1 / 分组统计
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-400">
                按指定主键 (如评估对象) 将多行明细样本聚合为 1 行标量指标 (N -&gt; 1)。支持平均值、极值、累加求和及标准差统计。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭弹窗"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-[#1e293b] hover:text-white transition"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Modal Main Content: Step 1 (Group Keys) + Step 2 (Aggregations) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Step 1: 分组主键字段 (Group Keys) */}
          <section className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1e293b] pb-3 mb-4">
              <div>
                <h3 className="text-xs font-bold text-white flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-amber-300 font-mono text-[11px]">
                    1
                  </span>
                  分组主键字段 (Group Keys)
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  指定用于多维分组的主键字段。若未指定任何主键，则全量明细样本将汇总为 1 行全局标量指标。
                </p>
              </div>

              <button
                type="button"
                disabled={readOnly}
                onClick={handleAddGroupKey}
                className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/25 transition disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                添加分组字段
              </button>
            </div>

            {groupKeys.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#1e293b] p-4 text-center text-xs text-slate-400">
                <Info className="inline h-4 w-4 mr-1 text-amber-400" />
                当前未配置分组字段：全表样本将直接跨行聚合为{' '}
                <span className="font-semibold text-amber-300">1 行全局标量指标</span>。
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {groupKeys.map((keyName, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg border border-[#1e293b] bg-[#090e17] px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-[10px] font-mono text-slate-500">#{idx + 1}</span>
                      <select
                        value={keyName}
                        disabled={readOnly}
                        onChange={(e) => handleUpdateGroupKey(idx, e.target.value)}
                        className="bg-transparent font-medium text-amber-200 focus:outline-none w-full"
                      >
                        {upstreamColumns.map((col) => (
                          <option key={col.name} value={col.name} className="bg-[#0b1120] text-white">
                            {col.name} ({col.type})
                          </option>
                        ))}
                      </select>
                    </div>

                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => handleRemoveGroupKey(idx)}
                        title="删除该分组字段"
                        className="rounded p-1 text-slate-500 hover:text-rose-400 transition"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Step 2: 聚合统计度量 (Aggregations) */}
          <section className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1e293b] pb-3 mb-4">
              <div>
                <h3 className="text-xs font-bold text-white flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-amber-300 font-mono text-[11px]">
                    2
                  </span>
                  聚合统计度量 (Aggregations)
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  为每个分组或全表配置汇总统计规则，指定源数据列与统计聚合算法。
                </p>
              </div>

              <button
                type="button"
                disabled={readOnly}
                onClick={handleAddMetric}
                className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/25 transition disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                添加聚合度量
              </button>
            </div>

            {/* Table (Strictly matching Image 3 structure) */}
            <div className="overflow-x-auto rounded-lg border border-[#1e293b]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#090e17] text-slate-400 border-b border-[#1e293b]">
                  <tr>
                    <th className="px-3 py-2.5 text-[11px] w-12 text-center">序号</th>
                    <th className="px-3 py-2.5 text-[11px] w-56">
                      输出统计字段名<span className="text-rose-400 ml-0.5">*</span>
                    </th>
                    <th className="px-3 py-2.5 text-[11px] w-52">源数据列</th>
                    <th className="px-3 py-2.5 text-[11px]">聚合统计方法</th>
                    <th className="px-3 py-2.5 text-[11px] w-16 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e293b] bg-[#0b1120]">
                  {metrics.map((item, idx) => (
                    <tr key={item.id || idx} className="hover:bg-[#0f172a]/70 transition">
                      <td className="px-3 py-2.5 font-mono text-center text-slate-500">
                        {idx + 1}
                      </td>

                      {/* 输出统计字段名* */}
                      <td className="px-3 py-2.5">
                        <input
                          type="text"
                          value={item.targetField}
                          disabled={readOnly}
                          onChange={(e) =>
                            handleUpdateMetric(idx, { targetField: e.target.value })
                          }
                          placeholder="例如: avg_damage_ratio"
                          className="w-full rounded border border-[#1e293b] bg-[#090e17] px-2.5 py-1 font-mono text-xs text-white placeholder-slate-600 focus:border-amber-500 focus:outline-none"
                        />
                      </td>

                      {/* 源数据列 */}
                      <td className="px-3 py-2.5">
                        {item.method === 'COUNT_ALL' ? (
                          <span className="text-[11px] text-slate-500 italic px-2">
                            * 全部行 (无需指定列)
                          </span>
                        ) : (
                          <select
                            value={item.sourceColumn}
                            disabled={readOnly}
                            onChange={(e) =>
                              handleUpdateMetric(idx, { sourceColumn: e.target.value })
                            }
                            className="w-full rounded border border-[#1e293b] bg-[#090e17] px-2 py-1 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
                          >
                            {upstreamColumns.map((col) => (
                              <option
                                key={col.name}
                                value={col.name}
                                className="bg-[#0b1120] text-white"
                              >
                                {col.name} ({col.type})
                              </option>
                            ))}
                          </select>
                        )}
                      </td>

                      {/* 聚合统计方法 */}
                      <td className="px-3 py-2.5">
                        <select
                          value={item.method}
                          disabled={readOnly}
                          onChange={(e) =>
                            handleUpdateMetric(idx, {
                              method: e.target.value as AggregationMethod,
                            })
                          }
                          className="w-full rounded border border-[#1e293b] bg-[#090e17] px-2 py-1 text-xs font-medium text-amber-300 focus:border-amber-500 focus:outline-none"
                        >
                          {METHOD_OPTIONS.map((opt) => (
                            <option
                              key={opt.value}
                              value={opt.value}
                              className="bg-[#0b1120] text-white"
                            >
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* 操作 */}
                      <td className="px-3 py-2.5 text-center">
                        {metrics.length > 1 && !readOnly && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMetric(idx)}
                            title="删除该聚合度量"
                            className="rounded p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {validationError && (
              <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300 flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{validationError}</span>
              </div>
            )}
          </section>
        </div>

        {/* 预览抽屉 (Output Preview Drawer) */}
        {showPreview && (
          <div className="border-t border-[#1e293b] bg-[#090e17] p-4 max-h-72 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Table className="h-4 w-4 text-amber-400" />
                <h4 className="text-xs font-semibold text-white">
                  聚合输出样本预览
                </h4>
                {previewLatencyMs > 0 && (
                  <span className="rounded bg-[#1e293b] px-1.5 py-0.5 text-[10px] text-slate-400 font-mono">
                    {previewLatencyMs} ms
                  </span>
                )}
                <span className="text-[11px] text-slate-400">
                  （明细 {sampleDataset.rows.length} 行 ➔ 聚合为 {previewData?.rows.length ?? 0} 行）
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowPreview(false)}
                className="text-xs text-slate-400 hover:text-white"
              >
                收起预览
              </button>
            </div>

            {previewError ? (
              <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
                <AlertCircle className="inline h-4 w-4 mr-1.5" />
                聚合预览执行失败: {previewError}
              </div>
            ) : previewData ? (
              <div className="overflow-x-auto rounded border border-[#1e293b]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#0f172a] text-slate-400 border-b border-[#1e293b]">
                    <tr>
                      <th className="px-3 py-2 text-[11px]">#</th>
                      {previewData.columns.map((col) => {
                        const isMetric = metrics.some((m) => m.targetField === col.name);
                        return (
                          <th
                            key={col.name}
                            className={`px-3 py-2 font-mono ${
                              isMetric
                                ? 'bg-amber-950/60 text-amber-300 border-l border-r border-amber-500/30'
                                : 'text-slate-200'
                            }`}
                          >
                            <div className="flex items-center gap-1">
                              <span>{col.name}</span>
                              {isMetric && (
                                <span className="rounded bg-amber-500/20 px-1 py-0.2 text-[9px] text-amber-300 border border-amber-500/30">
                                  聚合
                                </span>
                              )}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e293b]">
                    {previewData.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-[#0f172a]/60">
                        <td className="px-3 py-2 font-mono text-slate-500">{rIdx + 1}</td>
                        {previewData.columns.map((col) => {
                          const isMetric = metrics.some((m) => m.targetField === col.name);
                          const val = row[col.name];
                          return (
                            <td
                              key={col.name}
                              className={`px-3 py-2 font-mono ${
                                isMetric
                                  ? 'bg-amber-500/10 text-amber-100 font-semibold border-l border-r border-amber-500/20'
                                  : 'text-slate-300'
                              }`}
                            >
                              {val === null || val === undefined
                                ? 'NULL'
                                : typeof val === 'number'
                                  ? Number.isInteger(val)
                                    ? val
                                    : val.toFixed(3)
                                  : String(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        )}

        {/* Footer (Strictly matching Image 3: [输出预览], [取消], [确定]) */}
        <footer className="flex items-center justify-between border-t border-[#1e293b] bg-[#0f172a] px-6 py-3.5">
          <button
            type="button"
            onClick={handleExecutePreview}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 transition"
          >
            <Eye className="h-4 w-4" />
            输出预览
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#334155] bg-transparent px-4 py-1.5 text-xs font-medium text-slate-300 hover:bg-[#1e293b] hover:text-white transition"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={readOnly || Boolean(validationError)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-medium text-slate-950 font-semibold shadow-md hover:bg-amber-400 transition disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              确定
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
