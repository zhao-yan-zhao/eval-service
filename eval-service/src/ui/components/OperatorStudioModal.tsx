import {
  Activity,
  AlertCircle,
  ArrowRight,
  BarChart3,
  Calculator,
  Check,
  ChevronRight,
  Cpu,
  Database,
  Eye,
  FileSpreadsheet,
  GitBranch,
  Info,
  Layers,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings,
  Sparkles,
  Table,
  Workflow,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import type {
  AggregationOperatorConfig,
  CustomOperatorDefinition,
  DatasetColumn,
  F1OutputCatalog,
  FormulaOperatorConfig,
  MetricAtomMeta,
  OperatorCategory,
  OperatorOutputType,
  OptimalDirection,
  StoredRunSummary,
  TableDataset,
} from '../api.ts';
import { evalApi } from '../api.ts';
import { AggregationOperatorModal } from './AggregationOperatorModal.tsx';
import { FormulaOperatorModal } from './FormulaOperatorModal.tsx';
import { evaluateFormulaDataset } from '../../operators/formula-engine.ts';
import { evaluateAggregationDataset } from '../../operators/aggregation-engine.ts';

export interface OperatorStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  operators: MetricAtomMeta[];
  initialOperator?: MetricAtomMeta | null;
  initialDraft?: CustomOperatorDefinition | null;
  runs: StoredRunSummary[];
  catalog?: F1OutputCatalog | null;
  onSaved: (meta: MetricAtomMeta, message: string) => Promise<void>;
}

// 模拟真实推演战例样本数据集（上游输入）
const DEFAULT_STUDIO_DATASET: TableDataset = {
  columns: [
    { name: 'Entity_ID', type: 'string', description: '作战实体编号' },
    { name: 'Side', type: 'string', description: '战术阵营 (Red/Blue)' },
    { name: 'UnitName', type: 'string', description: '战机/实体名称' },
    { name: 'TargetContactRangeHoriz_nm', type: 'number', description: '水平接触测距 (海里)' },
    { name: 'Speed_kt', type: 'number', description: '实时航速 (节)' },
    { name: 'Altitude_m', type: 'number', description: '飞行高度 (米)' },
    { name: 'Damage_Percent', type: 'number', description: '战损损伤比 (0-100)' },
    { name: 'WeaponCount', type: 'number', description: '可用弹药数' },
    { name: 'IsHit', type: 'boolean', description: '末端命中指示' },
  ],
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

const PRESET_TEMPLATES: Array<{
  label: string;
  categoryTag: 'data_input' | 'inline_calc' | 'group_agg' | 'result_output';
  def: CustomOperatorDefinition;
}> = [
  {
    label: 'LibFormula：超视距水平射距换算公里与损伤等级衍生',
    categoryTag: 'inline_calc',
    def: {
      id: 'custom.bvr_range_and_severity_calc',
      name: '超视距水平射距与毁伤等级行内衍生',
      category: 'situation',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description: '对上游战例样本进行逐行 LibFormula 衍生，计算公制射距及损伤高低等级。',
      expression: '',
      variables: [],
      formulaConfig: {
        derivedColumns: [
          {
            id: 'c1',
            columnName: 'TargetRange_km',
            dataType: 'number',
            expression: 'ROUND(TargetContactRangeHoriz_nm * 1.852; 2)',
            description: '海里转公里',
          },
          {
            id: 'c2',
            columnName: 'Damage_Severity',
            dataType: 'string',
            expression: 'IF(Damage_Percent >= 50; "High_Loss"; "Normal")',
            description: '战损损伤等级评定',
          },
        ],
      },
      outputType: 'score',
      unit: 'km',
      defaultOptimalDirection: 'larger_is_better',
    },
  },
  {
    label: '跨行聚合：按战术阵营统计平均射距与最大机动航速',
    categoryTag: 'group_agg',
    def: {
      id: 'custom.side_combat_range_agg',
      name: '分阵营空战射距与航速跨行汇总',
      category: 'effectiveness',
      mode: 'aggregation',
      pipelineCategory: 'group_agg',
      description: '按战术阵营 (Side) 分组聚合多行样本，输出平均射距、最大航速与样本行数。',
      expression: '',
      variables: [],
      aggregationConfig: {
        groupKeys: ['Side'],
        metrics: [
          {
            id: 'm1',
            targetField: 'avg_contact_range',
            sourceColumn: 'TargetContactRangeHoriz_nm',
            method: 'AVERAGE',
            description: '阵营平均接触水平射距',
          },
          {
            id: 'm2',
            targetField: 'max_speed',
            sourceColumn: 'Speed_kt',
            method: 'MAX',
            description: '阵营最高机动航速',
          },
          {
            id: 'm3',
            targetField: 'sample_count',
            sourceColumn: 'Entity_ID',
            method: 'COUNT_ALL',
            description: '阵营实体数量',
          },
        ],
      },
      outputType: 'score',
      unit: 'nm',
      defaultOptimalDirection: 'larger_is_better',
    },
  },
  {
    label: '全链路流水线：行内衍生 ➔ 全表聚合为 1 行标量',
    categoryTag: 'result_output',
    def: {
      id: 'custom.pipeline_full_avg_range_scalar',
      name: '全链路空战公制射距全局标量',
      category: 'effectiveness',
      mode: 'formula_pipeline',
      pipelineCategory: 'result_output',
      description: '先通过 LibFormula 计算 TargetRange_km，再跨行全局聚合为 1 行平均标量值。',
      expression: '',
      variables: [],
      formulaConfig: {
        derivedColumns: [
          {
            id: 'c1',
            columnName: 'TargetRange_km',
            dataType: 'number',
            expression: 'ROUND(TargetContactRangeHoriz_nm * 1.852; 2)',
          },
        ],
      },
      aggregationConfig: {
        groupKeys: [],
        metrics: [
          {
            id: 'm1',
            targetField: 'global_avg_range_km',
            sourceColumn: 'TargetRange_km',
            method: 'AVERAGE',
          },
        ],
      },
      outputType: 'score',
      unit: 'km',
      defaultOptimalDirection: 'larger_is_better',
    },
  },
];

export function OperatorStudioModal({
  isOpen,
  onClose,
  operators,
  initialOperator,
  initialDraft,
  runs,
  catalog,
  onSaved,
}: OperatorStudioModalProps) {
  const headingId = useId();

  // 基础元数据
  const [operatorId, setOperatorId] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<OperatorCategory>('effectiveness');
  const [pipelineCategory, setPipelineCategory] = useState<
    'data_input' | 'inline_calc' | 'group_agg' | 'result_output'
  >('inline_calc');
  const [mode, setMode] = useState<
    'formula_pipeline' | 'aggregation' | 'formula' | 'source_binding'
  >('formula_pipeline');
  const [description, setDescription] = useState('');
  const [outputType, setOutputType] = useState<OperatorOutputType>('score');
  const [unit, setUnit] = useState('nm');
  const [direction, setDirection] = useState<OptimalDirection>('larger_is_better');

  // 流水线子配置
  const [formulaConfig, setFormulaConfig] = useState<FormulaOperatorConfig>({
    derivedColumns: [
      {
        id: 'c1',
        columnName: 'target_range_km',
        dataType: 'number',
        expression: 'ROUND(TargetContactRangeHoriz_nm * 1.852; 2)',
        description: '海里转公里',
      },
    ],
  });

  const [aggregationConfig, setAggregationConfig] = useState<AggregationOperatorConfig>({
    groupKeys: ['Side'],
    metrics: [
      {
        id: 'm1',
        targetField: 'avg_combat_range',
        sourceColumn: 'TargetContactRangeHoriz_nm',
        method: 'AVERAGE',
      },
      {
        id: 'm2',
        targetField: 'total_entities',
        sourceColumn: 'Entity_ID',
        method: 'COUNT_ALL',
      },
    ],
  });

  // 弹出子节点配置弹窗状态
  const [isFormulaModalOpen, setIsFormulaModalOpen] = useState(false);
  const [isAggModalOpen, setIsAggModalOpen] = useState(false);

  // 演练运行与结果状态
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<{
    stage1Dataset: TableDataset;
    stage2Dataset?: TableDataset;
    stage3Dataset?: TableDataset;
    scalarValue?: number | string | null;
    latencyMs: number;
  } | null>(null);

  // 初始化草稿或算子数据
  useEffect(() => {
    if (initialOperator) {
      setOperatorId(initialOperator.id);
      setName(initialOperator.name);
      setCategory(initialOperator.category);
      setDescription(initialOperator.description);
      setOutputType(initialOperator.outputType);
      setUnit(initialOperator.unit ?? '');
      setDirection(initialOperator.defaultOptimalDirection);
      if (initialOperator.customDef) {
        setMode(initialOperator.customDef.mode ?? 'formula_pipeline');
        if (initialOperator.customDef.pipelineCategory) {
          setPipelineCategory(
            initialOperator.customDef.pipelineCategory as any,
          );
        }
        if (initialOperator.customDef.formulaConfig) {
          setFormulaConfig(initialOperator.customDef.formulaConfig);
        }
        if (initialOperator.customDef.aggregationConfig) {
          setAggregationConfig(initialOperator.customDef.aggregationConfig);
        }
      }
    } else if (initialDraft) {
      setOperatorId(initialDraft.id);
      setName(initialDraft.name);
      setCategory(initialDraft.category);
      setDescription(initialDraft.description);
      setOutputType(initialDraft.outputType);
      setUnit(initialDraft.unit ?? '');
      setDirection(initialDraft.defaultOptimalDirection);
      setMode(initialDraft.mode ?? 'formula_pipeline');
      if (initialDraft.pipelineCategory) {
        setPipelineCategory(initialDraft.pipelineCategory as any);
      }
      if (initialDraft.formulaConfig) {
        setFormulaConfig(initialDraft.formulaConfig);
      }
      if (initialDraft.aggregationConfig) {
        setAggregationConfig(initialDraft.aggregationConfig);
      }
    } else {
      // 默认生成全新流水线草稿
      const rand = Math.floor(Math.random() * 900 + 100);
      setOperatorId(`custom.pipeline_op_${rand}`);
      setName(`空战全链路综合衍生算子 #${rand}`);
      setCategory('effectiveness');
      setPipelineCategory('inline_calc');
      setMode('formula_pipeline');
      setDescription('基于 LibFormula 行内衍生与跨行汇总构建的综合推演算子。');
      setOutputType('score');
      setUnit('分');
      setDirection('larger_is_better');
    }
    setDryRunResult(null);
    setSaveError(null);
  }, [initialOperator, initialDraft, isOpen]);

  // 加载模版
  const handleApplyTemplate = (tmpl: (typeof PRESET_TEMPLATES)[0]) => {
    const rand = Math.floor(Math.random() * 900 + 100);
    setOperatorId(`${tmpl.def.id}_${rand}`);
    setName(tmpl.def.name);
    setCategory(tmpl.def.category);
    setPipelineCategory(tmpl.categoryTag);
    setMode(tmpl.def.mode ?? 'formula_pipeline');
    setDescription(tmpl.def.description);
    setOutputType(tmpl.def.outputType);
    setUnit(tmpl.def.unit ?? '');
    setDirection(tmpl.def.defaultOptimalDirection);
    if (tmpl.def.formulaConfig) setFormulaConfig(tmpl.def.formulaConfig);
    if (tmpl.def.aggregationConfig) setAggregationConfig(tmpl.def.aggregationConfig);
    setDryRunResult(null);
  };

  // 全流水线 Dry Run
  const handleDryRun = async () => {
    setDryRunLoading(true);
    setSaveError(null);
    const t0 = performance.now();
    try {
      let currentDataset: TableDataset = DEFAULT_STUDIO_DATASET;
      let stage2: TableDataset | undefined;
      let stage3: TableDataset | undefined;

      // 阶段 2：行内公式衍生 (如果配置了公式)
      if (
        (mode === 'formula_pipeline' || mode === 'formula') &&
        formulaConfig.derivedColumns &&
        formulaConfig.derivedColumns.length > 0
      ) {
        stage2 = evaluateFormulaDataset(currentDataset, formulaConfig);
        currentDataset = stage2;
      }

      // 阶段 3：跨行聚合 (如果配置了聚合)
      if (
        (mode === 'aggregation' || mode === 'formula_pipeline') &&
        aggregationConfig.metrics &&
        aggregationConfig.metrics.length > 0
      ) {
        stage3 = evaluateAggregationDataset(currentDataset, aggregationConfig);
        currentDataset = stage3;
      }

      // 标量提取 (取首行首个数值度量)
      let scalar: number | string | null = null;
      if (currentDataset.rows.length > 0) {
        const firstRow = currentDataset.rows[0];
        const lastCol = currentDataset.columns[currentDataset.columns.length - 1];
        if (lastCol && firstRow) {
          scalar = firstRow[lastCol.name] as any;
        }
      }

      const latencyMs = Math.round(performance.now() - t0);
      setDryRunResult({
        stage1Dataset: DEFAULT_STUDIO_DATASET,
        stage2Dataset: stage2,
        stage3Dataset: stage3,
        scalarValue: scalar,
        latencyMs,
      });
    } catch (err) {
      setSaveError(`流水线演算报错: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDryRunLoading(false);
    }
  };

  // 保存并提交至后端算子库
  const handleSaveOperator = async () => {
    if (!operatorId.trim()) {
      alert('请输入合法的算子 ID（例如 custom.my_op）');
      return;
    }
    if (!name.trim()) {
      alert('请输入算子名称');
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const def: CustomOperatorDefinition = {
        id: operatorId.trim(),
        name: name.trim(),
        category,
        pipelineCategory,
        mode,
        description: description.trim(),
        expression: '',
        variables: [],
        formulaConfig:
          mode === 'formula_pipeline' || mode === 'formula' ? formulaConfig : undefined,
        aggregationConfig:
          mode === 'aggregation' || mode === 'formula_pipeline' ? aggregationConfig : undefined,
        outputType,
        unit: unit.trim(),
        defaultOptimalDirection: direction,
      };

      const res = await evalApi.upsertOperator(def);
      const meta = res.meta ?? ({
        ...def,
        readiness: 'batch_a_ready',
        requiredDataSources: ['csv', 'situation'],
        f1FieldContract: { csvTables: ['WeaponFired'], csvColumns: ['TargetContactRangeHoriz_nm'] },
        isCustom: true,
      } as MetricAtomMeta);

      await onSaved(meta, `自定义算子 ${def.id}「${def.name}」已成功保存并注册至算子库！`);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
    >
      <div className="flex h-[94vh] w-full max-w-[1380px] flex-col overflow-hidden rounded-xl border border-[#1e293b] bg-[#0b1120] text-[#f1f5f9] shadow-2xl">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[#1e293b] bg-[#0f172a] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-400">
              <Workflow className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 id={headingId} className="text-base font-bold text-white tracking-wide">
                  算子流水线工坊 (Operator Studio)
                </h2>
                <span className="rounded-md border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300">
                  一库 · 算子库深度定制
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-400">
                面向 F1/CMO 仿真数据的全链路算子构建器：从原始数据源输入，经由 LibFormula 行内衍生与跨行分组汇总，生成面向评估体系的标量度量。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭工坊弹窗"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-[#1e293b] hover:text-white transition"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* 三库联动视效横幅 (Three-Library Visual Connection Banner) */}
        <div className="border-b border-[#1e293b] bg-[#090e17] px-6 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            {/* 一库 */}
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500/20 text-blue-300 font-mono text-[11px] font-bold">
                1
              </span>
              <span className="font-semibold text-blue-300">一库：流水线算子库</span>
              <span className="text-[10px] text-slate-400 font-mono">
                [数据输入 ➔ 行内计算 ➔ 跨行聚合 ➔ 标量输出]
              </span>
            </div>

            <ArrowRight className="h-3.5 w-3.5 text-slate-600 hidden md:block" />

            {/* 二库 */}
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/20 text-violet-300 font-mono text-[11px] font-bold">
                2
              </span>
              <span className="font-semibold text-violet-300">二库：指标配置</span>
              <span className="text-[10px] text-slate-400 font-mono">
                [归一化打分曲线 · 权重约束 · 证据链]
              </span>
            </div>

            <ArrowRight className="h-3.5 w-3.5 text-slate-600 hidden md:block" />

            {/* 三库 */}
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-[11px] font-bold">
                3
              </span>
              <span className="font-semibold text-emerald-300">三库：评估体系</span>
              <span className="text-[10px] text-slate-400 font-mono">
                [AHP/熵权/TOPSIS 决策树 ➔ 态势与战术研判]
              </span>
            </div>
          </div>
        </div>

        {/* Modal Main Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* 模版快捷载入条 */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#1e293b] bg-[#0f172a] p-3">
            <div className="flex items-center gap-2 text-xs text-slate-300 font-medium">
              <Sparkles className="h-4 w-4 text-amber-400" />
              <span>载入典型推演算子预设模版：</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {PRESET_TEMPLATES.map((tmpl, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleApplyTemplate(tmpl)}
                  className="rounded-md border border-[#334155] bg-[#090e17] px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:border-sky-400 hover:text-sky-200 transition"
                >
                  {tmpl.label}
                </button>
              ))}
            </div>
          </div>

          {/* 基础元数据表单 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 rounded-xl border border-[#1e293b] bg-[#0f172a] p-5">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                算子 ID<span className="text-rose-400 ml-0.5">*</span>
              </label>
              <input
                type="text"
                value={operatorId}
                onChange={(e) => setOperatorId(e.target.value)}
                placeholder="例如: custom.bvr_avg_range"
                className="w-full rounded border border-[#1e293b] bg-[#090e17] px-3 py-1.5 font-mono text-xs text-white placeholder-slate-600 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                算子名称<span className="text-rose-400 ml-0.5">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如: 超视距空战武器平均射距"
                className="w-full rounded border border-[#1e293b] bg-[#090e17] px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                业务评估领域
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as OperatorCategory)}
                className="w-full rounded border border-[#1e293b] bg-[#090e17] px-3 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
              >
                <option value="effectiveness">效能域 (Effectiveness)</option>
                <option value="time">时效域 (Time)</option>
                <option value="situation">态势域 (Situation)</option>
                <option value="compliance">合规域 (Compliance)</option>
                <option value="cost">成本域 (Cost)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                流水线分类标签 (Image 1 对应)
              </label>
              <select
                value={pipelineCategory}
                onChange={(e) => setPipelineCategory(e.target.value as any)}
                className="w-full rounded border border-[#1e293b] bg-[#090e17] px-3 py-1.5 text-xs font-medium text-sky-300 focus:border-sky-500 focus:outline-none"
              >
                <option value="data_input">数据输入 (Data Input)</option>
                <option value="inline_calc">行内计算 (Inline Calc)</option>
                <option value="group_agg">跨行聚合 (Group Agg)</option>
                <option value="result_output">结果输出 (Result Output)</option>
              </select>
            </div>

            {/* 第二行：输出参数与极性 */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                输出类型
              </label>
              <select
                value={outputType}
                onChange={(e) => setOutputType(e.target.value as OperatorOutputType)}
                className="w-full rounded border border-[#1e293b] bg-[#090e17] px-3 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
              >
                <option value="score">综合评分 / 标量数值</option>
                <option value="ratio">比率 / 百分比 (0-1)</option>
                <option value="duration_seconds">时间间隔 (秒)</option>
                <option value="count">计数值 (次/个)</option>
                <option value="rate">速率 / 频率</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                度量单位
              </label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="例如: nm, km, %, 秒"
                className="w-full rounded border border-[#1e293b] bg-[#090e17] px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                极性倾向 (Optimal Direction)
              </label>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as OptimalDirection)}
                className="w-full rounded border border-[#1e293b] bg-[#090e17] px-3 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
              >
                <option value="larger_is_better">越大约优 (Larger is Better)</option>
                <option value="smaller_is_better">越小越优 (Smaller is Better)</option>
                <option value="range_bounded">区间最优 (Range Bounded)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                计算模式
              </label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as any)}
                className="w-full rounded border border-[#1e293b] bg-[#090e17] px-3 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none"
              >
                <option value="formula_pipeline">公式衍生流水线 (LibFormula 行内衍生)</option>
                <option value="aggregation">跨行数据汇总 (多行聚合为标量)</option>
                <option value="formula">传统标量公式 (多算子加权组合)</option>
                <option value="source_binding">CSV/BS 数据源直连提取</option>
              </select>
            </div>

            <div className="sm:col-span-4">
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                算子业务描述
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="详细说明该算子的物理含义、推演用途及在评估指标中的应用场景…"
                className="w-full rounded border border-[#1e293b] bg-[#090e17] px-3 py-2 text-xs text-white placeholder-slate-600 focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>

          {/* 流水线交互节点卡片 (Pipeline Interactive Nodes) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-white flex items-center gap-2">
                <Workflow className="h-4 w-4 text-sky-400" />
                算子处理流水线节点
              </h3>
              <span className="text-[11px] text-slate-400">
                点击节点右侧按钮即可启动可视化节点配置弹窗 (Image 2 / Image 3)
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Node 1: 数据输入 */}
              <div className="rounded-xl border border-blue-500/30 bg-[#0f172a] p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="rounded bg-blue-500/15 px-2 py-0.5 text-[11px] font-semibold text-blue-300 border border-blue-500/30">
                      数据输入 (Data Input)
                    </span>
                    <Database className="h-4 w-4 text-blue-400" />
                  </div>
                  <h4 className="text-xs font-bold text-white">上游明细样本</h4>
                  <p className="mt-1 text-[11px] text-slate-400">
                    仿真推演 CSV (WeaponFired) 或 BS 态势帧明细流，包含 {DEFAULT_STUDIO_DATASET.columns.length} 个基础字段。
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-[#1e293b] flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">已就绪 (5 行样本)</span>
                  <span className="text-blue-400 font-mono">Stage 1</span>
                </div>
              </div>

              {/* Node 2: 行内计算 (LibFormula) */}
              <div
                className={`rounded-xl border p-4 flex flex-col justify-between transition ${
                  mode === 'formula_pipeline' || mode === 'formula'
                    ? 'border-sky-500/40 bg-[#0f172a] shadow-md'
                    : 'border-[#1e293b] bg-[#090e17] opacity-60'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="rounded bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-300 border border-sky-500/30">
                      行内计算 (LibFormula)
                    </span>
                    <Calculator className="h-4 w-4 text-sky-400" />
                  </div>
                  <h4 className="text-xs font-bold text-white">公式计算节点</h4>
                  <p className="mt-1 text-[11px] text-slate-400">
                    已配置{' '}
                    <span className="text-sky-300 font-bold font-mono">
                      {formulaConfig.derivedColumns.length}
                    </span>{' '}
                    个衍生计算列：
                    {formulaConfig.derivedColumns.map((c) => c.columnName).join(', ') || '无'}。
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-[#1e293b] flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setIsFormulaModalOpen(true)}
                    className="inline-flex items-center gap-1 rounded bg-sky-500/20 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/30 border border-sky-500/40 transition"
                  >
                    <Settings className="h-3 w-3" />
                    配置公式节点
                  </button>
                  <span className="text-sky-400 font-mono text-[11px]">Stage 2</span>
                </div>
              </div>

              {/* Node 3: 跨行聚合 (Group Agg) */}
              <div
                className={`rounded-xl border p-4 flex flex-col justify-between transition ${
                  mode === 'aggregation' || mode === 'formula_pipeline'
                    ? 'border-amber-500/40 bg-[#0f172a] shadow-md'
                    : 'border-[#1e293b] bg-[#090e17] opacity-60'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300 border border-amber-500/30">
                      跨行聚合 (Group Agg)
                    </span>
                    <BarChart3 className="h-4 w-4 text-amber-400" />
                  </div>
                  <h4 className="text-xs font-bold text-white">数据汇总节点</h4>
                  <p className="mt-1 text-[11px] text-slate-400">
                    分组主键:{' '}
                    <span className="text-amber-300 font-mono">
                      {aggregationConfig.groupKeys.join(', ') || '全局归一'}
                    </span>
                    ，已配置{' '}
                    <span className="text-amber-300 font-bold font-mono">
                      {aggregationConfig.metrics.length}
                    </span>{' '}
                    项聚合度量。
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-[#1e293b] flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setIsAggModalOpen(true)}
                    className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 transition"
                  >
                    <Settings className="h-3 w-3" />
                    配置汇总节点
                  </button>
                  <span className="text-amber-400 font-mono text-[11px]">Stage 3</span>
                </div>
              </div>

              {/* Node 4: 结果输出 */}
              <div className="rounded-xl border border-emerald-500/30 bg-[#0f172a] p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 border border-emerald-500/30">
                      结果输出 (Result Output)
                    </span>
                    <Check className="h-4 w-4 text-emerald-400" />
                  </div>
                  <h4 className="text-xs font-bold text-white">二库/三库下游映射</h4>
                  <p className="mt-1 text-[11px] text-slate-400">
                    输出标量值将直接提供给指标库 (二库) 进行打分映射，并挂载于评估体系树 (三库)。
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-[#1e293b] flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">输出单位: {unit || '无'}</span>
                  <span className="text-emerald-400 font-mono">Stage 4</span>
                </div>
              </div>
            </div>
          </div>

          {/* 全流水线演练试算区 (Dry Run) */}
          <div className="rounded-xl border border-[#1e293b] bg-[#0f172a] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e293b] pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Play className="h-4 w-4 text-sky-400" />
                <h4 className="text-xs font-bold text-white">
                  流水线演算验证 (Dry Run)
                </h4>
                {dryRunResult && (
                  <span className="rounded bg-[#1e293b] px-2 py-0.5 text-[10px] text-emerald-400 font-mono">
                    耗时 {dryRunResult.latencyMs} ms · 运算成功
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={handleDryRun}
                disabled={dryRunLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-200 hover:bg-sky-500/25 transition disabled:opacity-50"
              >
                <Activity className="h-3.5 w-3.5" />
                {dryRunLoading ? '演练运算中…' : '执行全流水线试算'}
              </button>
            </div>

            {dryRunResult ? (
              <div className="space-y-4">
                {/* 最终标量展示 */}
                <div className="flex items-center gap-4 rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3">
                  <span className="text-xs text-slate-300">
                    全流水线输出标量结果:
                  </span>
                  <span className="text-base font-bold font-mono text-emerald-300">
                    {dryRunResult.scalarValue !== undefined && dryRunResult.scalarValue !== null
                      ? String(dryRunResult.scalarValue)
                      : '无可用标量'}
                  </span>
                  {unit && <span className="text-xs text-slate-400">({unit})</span>}
                </div>

                {/* 聚合或衍生数据集预览 */}
                <div className="overflow-x-auto rounded border border-[#1e293b] max-h-56">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#090e17] text-slate-400 border-b border-[#1e293b]">
                      <tr>
                        <th className="px-3 py-2 text-[11px]">#</th>
                        {(
                          dryRunResult.stage3Dataset?.columns ??
                          dryRunResult.stage2Dataset?.columns ??
                          dryRunResult.stage1Dataset.columns
                        ).map((c) => (
                          <th key={c.name} className="px-3 py-2 font-mono text-slate-200">
                            {c.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1e293b] bg-[#0b1120]">
                      {(
                        dryRunResult.stage3Dataset?.rows ??
                        dryRunResult.stage2Dataset?.rows ??
                        dryRunResult.stage1Dataset.rows
                      ).map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-[#0f172a]/60">
                          <td className="px-3 py-2 font-mono text-slate-500">{rIdx + 1}</td>
                          {(
                            dryRunResult.stage3Dataset?.columns ??
                            dryRunResult.stage2Dataset?.columns ??
                            dryRunResult.stage1Dataset.columns
                          ).map((c) => (
                            <td key={c.name} className="px-3 py-2 font-mono text-slate-300">
                              {String(row[c.name] ?? 'NULL')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-slate-500">
                点击上方「执行全流水线试算」按钮，即可验证行内公式与跨行汇总在此战例数据集上的执行结果。
              </div>
            )}

            {saveError && (
              <div className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{saveError}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between border-t border-[#1e293b] bg-[#0f172a] px-6 py-4">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Info className="h-3.5 w-3.5" />
            <span>保存后将立即注册至算子库，并在二库 (指标) 与三库 (体系) 中立即可选。</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#334155] bg-transparent px-4 py-2 text-xs font-medium text-slate-300 hover:bg-[#1e293b] hover:text-white transition"
            >
              取消
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSaveOperator}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-5 py-2 text-xs font-medium text-white shadow-md hover:bg-sky-400 transition disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isSaving ? '正在注册…' : '保存并注册算子'}
            </button>
          </div>
        </footer>
      </div>

      {/* 公式节点弹窗 */}
      <FormulaOperatorModal
        isOpen={isFormulaModalOpen}
        onClose={() => setIsFormulaModalOpen(false)}
        initialConfig={formulaConfig}
        upstreamColumns={DEFAULT_STUDIO_DATASET.columns}
        sampleDataset={DEFAULT_STUDIO_DATASET}
        onSave={(newCfg) => setFormulaConfig(newCfg)}
      />

      {/* 数据汇总节点弹窗 */}
      <AggregationOperatorModal
        isOpen={isAggModalOpen}
        onClose={() => setIsAggModalOpen(false)}
        initialConfig={aggregationConfig}
        upstreamColumns={
          formulaConfig.derivedColumns && formulaConfig.derivedColumns.length > 0
            ? [
                ...DEFAULT_STUDIO_DATASET.columns,
                ...formulaConfig.derivedColumns.map((c) => ({
                  name: c.columnName,
                  type: c.dataType,
                  description: c.description || '衍生列',
                })),
              ]
            : DEFAULT_STUDIO_DATASET.columns
        }
        sampleDataset={
          formulaConfig.derivedColumns && formulaConfig.derivedColumns.length > 0
            ? evaluateFormulaDataset(DEFAULT_STUDIO_DATASET, formulaConfig)
            : DEFAULT_STUDIO_DATASET
        }
        onSave={(newCfg) => setAggregationConfig(newCfg)}
      />
    </div>
  );
}
