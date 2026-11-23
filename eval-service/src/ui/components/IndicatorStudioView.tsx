import type * as echarts from 'echarts';
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  FlaskConical,
  Gauge,
  GitBranch,
  Layers,
  Link2,
  Plus,
  PlusCircle,
  Save,
  Search,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  evalApi,
  type IndicatorBacktestRunItem,
  type IndicatorBacktestSummary,
  type IndicatorDefinition,
  type IndicatorReduceMethod,
  type IndicatorSourceBinding,
  type IndicatorSystem,
  type MetricAtomMeta,
  type ScoringRule,
  type StoredRunSummary,
} from '../api.ts';
import { applyScoringRule } from '../../core/scoring-functions.ts';
import { validateFormula } from '../../operators/formula-engine.ts';
import { EChartPanel } from './EChartPanel.tsx';
import { MetricDagStudioPanel } from './v4/index.ts';

interface IndicatorStudioViewProps {
  indicators: IndicatorDefinition[];
  operators: MetricAtomMeta[];
  runs?: StoredRunSummary[];
  selectedRunId?: string;
  activeSourceId?: string;
  focusedIndicatorTarget?: { id: string; nonce: number } | null;
  onRefresh: () => Promise<void>;
  onDrillDownToOperator?: (operatorId: string) => void;
}

const DEFAULT_STEPS: Array<{ val: number; score: number }> = [
  { val: 0, score: 0 },
  { val: 50, score: 50 },
  { val: 80, score: 85 },
  { val: 100, score: 100 },
];

function inferUnitForOperator(op: MetricAtomMeta | undefined, atomId: string): string {
  if (op?.unit) return op.unit;
  if (atomId.startsWith('time.') || atomId.includes('latency') || atomId.includes('loss_max') || atomId.includes('delta')) return 's';
  if (atomId.includes('rate') || atomId.includes('ratio')) return '0-1';
  if (atomId.includes('range') || atomId.includes('distance')) return 'km';
  return '';
}

function isUnitRatioLike(op: MetricAtomMeta | undefined, atomId: string): boolean {
  if (!op && !atomId) return false;
  if (atomId.includes('attrition_balance') || atomId.includes('exchange_ratio')) return false;
  const u = (op?.unit ?? '').toLowerCase();
  if (u.includes('0-1') || u.includes('比例')) return true;
  if (op?.outputType === 'rate') return true;
  return false;
}

function formatAxisVal(v: string): string {
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  if (Number.isInteger(n)) return String(n);
  if (Math.abs(n) < 10) return Number(n.toFixed(2)).toString();
  return n.toFixed(1);
}

function IndicatorFlowStrip({
  bindingMode,
  atomRef,
  targetField,
  sources,
  reduceMethod,
  filterSide,
  composeFormula,
  ruleType,
  enableAlarm,
  alarmOp,
  alarmVal,
  latestBacktest,
  currentScore,
  onNavigateCard,
}: {
  bindingMode: 'single' | 'composite';
  atomRef: string;
  targetField?: string;
  sources: IndicatorSourceBinding[];
  reduceMethod: IndicatorReduceMethod;
  filterSide: string;
  composeFormula: string;
  ruleType: ScoringRule['type'];
  enableAlarm: boolean;
  alarmOp: string;
  alarmVal: number;
  latestBacktest?: IndicatorBacktestRunItem;
  currentScore: number | null;
  onNavigateCard: (cardId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5">
      <div className="mb-1.5 flex items-center justify-between text-[11px] text-[#8b949e]">
        <span className="font-semibold text-slate-300">指标全生命周期流向透视</span>
        <span className="text-[10px]">点击阶段卡片快速平滑定位</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {/* ① 数据源 */}
        <div
          onClick={() => onNavigateCard('ind-card-source')}
          className="flex-1 min-w-[120px] rounded border border-[#30363d] bg-[#161b22] p-2 cursor-pointer hover:border-blue-500/70 transition"
        >
          <div className="flex items-center justify-between text-[10px] text-blue-400 font-medium">
            <span>① 数据源</span>
            <span className="font-mono text-[9px] text-[#8b949e]">
              {bindingMode === 'composite' ? 'Composite' : 'Single'}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-xs text-slate-100 font-semibold">
            {bindingMode === 'composite'
              ? `${sources.length} 个输入源`
              : `${atomRef}${targetField ? '#' + targetField : ''}`}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-[#8b949e]">
            {latestBacktest
              ? latestBacktest.status === 'unavailable'
                ? '实测: 缺数'
                : `实测: ${latestBacktest.displayValue}`
              : '待执行回测'}
          </div>
        </div>

        <ChevronRight className="h-3 w-3 text-slate-600 shrink-0" />

        {/* ② 切片·归约 */}
        <div
          onClick={() => onNavigateCard('ind-card-source')}
          className="flex-1 min-w-[110px] rounded border border-[#30363d] bg-[#161b22] p-2 cursor-pointer hover:border-blue-500/70 transition"
        >
          <div className="flex items-center justify-between text-[10px] text-purple-400 font-medium">
            <span>② 切片·归约</span>
          </div>
          <div className="mt-1 truncate font-mono text-xs text-slate-100 font-semibold">
            {filterSide ? `阵营: ${filterSide}` : '全阵营'} · {reduceMethod}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-[#8b949e]">多行 ➔ 标量降维</div>
        </div>

        {bindingMode === 'composite' && (
          <>
            <ChevronRight className="h-3 w-3 text-slate-600 shrink-0" />
            {/* ③ 复合衍生 */}
            <div
              onClick={() => onNavigateCard('ind-card-source')}
              className="flex-1 min-w-[120px] rounded border border-[#30363d] bg-[#161b22] p-2 cursor-pointer hover:border-purple-500/70 transition"
            >
              <div className="flex items-center justify-between text-[10px] text-purple-400 font-medium">
                <span>③ 复合公式</span>
              </div>
              <div className="mt-1 truncate font-mono text-xs text-purple-300 font-semibold">
                {composeFormula || '未配置公式'}
              </div>
              <div className="mt-0.5 truncate text-[10px] text-[#8b949e]">
                {latestBacktest && typeof latestBacktest.numericValue === 'number'
                  ? `值: ${latestBacktest.numericValue.toFixed(2)}`
                  : 'LibFormula AST'}
              </div>
            </div>
          </>
        )}

        <ChevronRight className="h-3 w-3 text-slate-600 shrink-0" />

        {/* ④ 评分映射 */}
        <div
          onClick={() => onNavigateCard('ind-card-scoring')}
          className="flex-1 min-w-[110px] rounded border border-[#30363d] bg-[#161b22] p-2 cursor-pointer hover:border-emerald-500/70 transition"
        >
          <div className="flex items-center justify-between text-[10px] text-emerald-400 font-medium">
            <span>{bindingMode === 'composite' ? '④' : '③'} 评分映射</span>
          </div>
          <div className="mt-1 truncate font-mono text-xs text-emerald-300 font-bold">
            {latestBacktest && latestBacktest.score !== null
              ? `${latestBacktest.score.toFixed(1)} 分 (实测)`
              : currentScore !== null
                ? `${currentScore.toFixed(1)} 分 (本地)`
                : '0–100 映射'}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-[#8b949e]">{ruleType}</div>
        </div>

        <ChevronRight className="h-3 w-3 text-slate-600 shrink-0" />

        {/* ⑤ 告警门限 */}
        <div
          onClick={() => onNavigateCard('ind-card-alarm')}
          className="flex-1 min-w-[100px] rounded border border-[#30363d] bg-[#161b22] p-2 cursor-pointer hover:border-amber-500/70 transition"
        >
          <div className="flex items-center justify-between text-[10px] text-amber-400 font-medium">
            <span>{bindingMode === 'composite' ? '⑤' : '④'} 告警门限</span>
          </div>
          <div className="mt-1 truncate font-mono text-xs font-semibold">
            {!enableAlarm ? (
              <span className="text-slate-500">未启用</span>
            ) : latestBacktest ? (
              latestBacktest.alarmTriggered ? (
                <span className="text-rose-400">⚠ 触发告警</span>
              ) : (
                <span className="text-emerald-400">PASS 正常</span>
              )
            ) : (
              <span className="text-amber-300">
                {alarmOp} {alarmVal}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-[#8b949e]">
            {enableAlarm ? '实时越限监测' : '无预警'}
          </div>
        </div>
      </div>
    </div>
  );
}

export function IndicatorStudioView({
  indicators,
  operators,
  runs = [],
  selectedRunId = '',
  activeSourceId,
  focusedIndicatorTarget = null,
  onRefresh,
  onDrillDownToOperator,
}: IndicatorStudioViewProps) {
  const [studioMode, setStudioMode] = useState<'classic' | 'v4_dag'>('v4_dag');
  const [selectedId, setSelectedId] = useState<string>(indicators[0]?.indicatorId ?? '');

  // 左侧搜索与筛选状态
  const [searchQuery, setSearchQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'builtin' | 'custom' | 'mounted'>('all');
  const [domainTagFilter, setDomainTagFilter] = useState<string>('all');

  useEffect(() => {
    if (!focusedIndicatorTarget?.id) return;
    setSearchQuery('');
    setScopeFilter('all');
    setDomainTagFilter('all');
    const matched = indicators.find((i) => i.indicatorId === focusedIndicatorTarget.id);
    if (matched) {
      setSelectedId(matched.indicatorId);
    }
  }, [focusedIndicatorTarget, indicators]);

  // 表单字段 (受控状态 + 原生 HTML constraint attributes 配合 :user-invalid 交互后报错)
  const [indicatorId, setIndicatorId] = useState('ind_custom_ooda');
  const [name, setName] = useState('高速打击链 OODA 阈值');
  const [description, setDescription] = useState('自定义 OODA 延时标定指标，90s 内极佳，360s 归零');
  const [bindingMode, setBindingMode] = useState<'single' | 'composite'>('single');
  const [atomRef, setAtomRef] = useState(operators[0]?.id ?? 'kc.pid_to_engage_latency');
  const [targetField, setTargetField] = useState('');
  const [unit, setUnit] = useState('');
  const [reduceMethod, setReduceMethod] = useState<IndicatorReduceMethod>('mean');
  const [sources, setSources] = useState<IndicatorSourceBinding[]>([]);
  const [composeFormula, setComposeFormula] = useState('');
  const [filterSide, setFilterSide] = useState('');
  const [extraFilters, setExtraFilters] = useState<Array<{ key: string; value: string }>>([]);
  const [tagsText, setTagsText] = useState('自定义');
  const [ruleType, setRuleType] = useState<ScoringRule['type']>('smaller_is_better');
  const [optimal, setOptimal] = useState(90);
  const [worst, setWorst] = useState(360);
  const [boundLo, setBoundLo] = useState(0);
  const [boundHi, setBoundHi] = useState(100);
  const [optRangeLo, setOptRangeLo] = useState(8000);
  const [optRangeHi, setOptRangeHi] = useState(10000);
  const [tolRangeLo, setTolRangeLo] = useState(6000);
  const [tolRangeHi, setTolRangeHi] = useState(12000);
  const [stepRows, setStepRows] = useState<Array<{ val: number; score: number }>>(DEFAULT_STEPS);
  const [boolTrueScore, setBoolTrueScore] = useState(100);
  const [boolFalseScore, setBoolFalseScore] = useState(0);

  const [enableAlarm, setEnableAlarm] = useState(true);
  const [alarmOp, setAlarmOp] = useState<'>' | '<' | '>=' | '<='>('>');
  const [alarmVal, setAlarmVal] = useState(200);
  const [alarmSeverity, setAlarmSeverity] = useState<'major' | 'minor'>('major');
  const [alarmMessageTemplate, setAlarmMessageTemplate] = useState('');

  // P1 实测数据即时试算输入
  const [testInputVal, setTestInputVal] = useState<string>('85');

  // P0 真实测试数据回测状态
  const [backtesting, setBacktesting] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [backtestResults, setBacktestResults] = useState<IndicatorBacktestRunItem[]>([]);
  const [backtestSummary, setBacktestSummary] = useState<IndicatorBacktestSummary | null>(null);

  // P2 三库血缘与级联保护
  const [systems, setSystems] = useState<IndicatorSystem[]>([]);

  const [curvePts, setCurvePts] = useState<Array<{ x: number; score: number }>>([]);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  const [highlightedCard, setHighlightedCard] = useState<string | null>(null);
  const [showFilterDetails, setShowFilterDetails] = useState(false);

  const scrollToCard = (cardId: string) => {
    const el = document.getElementById(cardId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setHighlightedCard(cardId);
      setTimeout(() => setHighlightedCard(null), 1600);
    }
  };

  const selectedOpMeta = useMemo(() => operators.find((o) => o.id === atomRef), [operators, atomRef]);
  const compositeFormulaCheck = useMemo(() => {
    if (bindingMode !== 'composite') return null;
    if (!composeFormula.trim()) return { valid: false, errors: ['请输入复合公式'] };
    const aliases = sources.map((s) => s.alias.trim()).filter(Boolean);
    return validateFormula(composeFormula, aliases);
  }, [bindingMode, composeFormula, sources]);

  useEffect(() => {
    evalApi
      .listSystems()
      .then((res) => {
        if (res?.systems) setSystems(res.systems);
      })
      .catch(() => {});
  }, [indicators.length]);

  // 全库挂载映射，用于左侧挂载标签与删除校验
  const mountedByIndicator = useMemo(() => {
    const map = new Map<
      string,
      Array<{ systemId: string; systemName: string; dimensionName: string; weight: number }>
    >();
    const scan = (node: any, sysId: string, sysName: string, dimName: string) => {
      if (node?.indicatorRef) {
        const list = map.get(node.indicatorRef) ?? [];
        list.push({
          systemId: sysId,
          systemName: sysName,
          dimensionName: dimName,
          weight: node.weight ?? 0,
        });
        map.set(node.indicatorRef, list);
      }
      const currentDim = node?.name || dimName;
      if (Array.isArray(node?.children)) {
        for (const ch of node.children) {
          scan(ch, sysId, sysName, currentDim);
        }
      }
    };
    for (const sys of systems) {
      scan(sys.root, sys.systemId, sys.name || sys.systemId, '根节点');
    }
    return map;
  }, [systems]);

  const referencingSystems = useMemo(
    () => (selectedId ? (mountedByIndicator.get(selectedId) ?? []) : []),
    [selectedId, mountedByIndicator],
  );

  const loadIntoForm = (def: IndicatorDefinition) => {
    setSelectedId(def.indicatorId);
    setIndicatorId(def.builtin ? `${def.indicatorId}_custom` : def.indicatorId);
    setName(def.builtin ? `${def.name} (自定义副本)` : def.name);
    setDescription(def.description ?? '');
    setBindingMode(def.bindingMode || 'single');
    setAtomRef(def.atomRef);
    setTargetField(def.targetField ?? '');
    setReduceMethod(def.reduce || 'mean');
    setSources(def.sources ? JSON.parse(JSON.stringify(def.sources)) : []);
    setComposeFormula(def.composeFormula || '');
    const op = operators.find((o) => o.id === def.atomRef);
    setUnit(def.unit || inferUnitForOperator(op, def.atomRef));

    const criteria = def.filterCriteria ?? {};
    setFilterSide(criteria.Side !== undefined ? String(criteria.Side) : '');
    setExtraFilters(
      Object.entries(criteria)
        .filter(([k]) => k !== 'Side')
        .map(([key, val]) => ({ key, value: String(val) })),
    );
    setTagsText((def.tags && def.tags.length > 0 ? def.tags : ['自定义']).join(', '));

    setRuleType(def.scoring.type);
    setOptimal(def.scoring.optimal ?? 0);
    setWorst(def.scoring.worst ?? 100);
    setBoundLo(def.scoring.bounds?.[0] ?? 0);
    setBoundHi(def.scoring.bounds?.[1] ?? 100);
    if (def.scoring.type === 'target_range') {
      setOptRangeLo(def.scoring.optimalRange?.[0] ?? 0);
      setOptRangeHi(def.scoring.optimalRange?.[1] ?? 100);
      setTolRangeLo(def.scoring.toleranceRange?.[0] ?? (def.scoring.optimalRange?.[0] ?? 0) - 20);
      setTolRangeHi(def.scoring.toleranceRange?.[1] ?? (def.scoring.optimalRange?.[1] ?? 100) + 20);
    }
    if (def.scoring.type === 'step' && Array.isArray(def.scoring.steps) && def.scoring.steps.length > 0) {
      setStepRows([...def.scoring.steps].sort((a, b) => a.val - b.val));
    } else if (def.scoring.type === 'step') {
      setStepRows(DEFAULT_STEPS);
    }
    setBoolTrueScore(def.scoring.trueScore ?? 100);
    setBoolFalseScore(def.scoring.falseScore ?? 0);

    if (def.alarmThreshold) {
      setEnableAlarm(true);
      setAlarmOp(def.alarmThreshold.operator === '==' ? '>=' : def.alarmThreshold.operator);
      setAlarmVal(def.alarmThreshold.value);
      setAlarmSeverity(def.alarmThreshold.severity);
      setAlarmMessageTemplate(def.alarmThreshold.messageTemplate ?? '');
    } else {
      setEnableAlarm(false);
      setAlarmMessageTemplate('');
    }
    setBacktestResults([]);
    setBacktestSummary(null);
    setBacktestError(null);
    setStatusMsg(null);
  };

  const hasLoadedInitialRef = useRef(false);
  useEffect(() => {
    if (!hasLoadedInitialRef.current && indicators.length > 0) {
      hasLoadedInitialRef.current = true;
      loadIntoForm(indicators[0]);
    }
  }, [indicators]);

  const currentRule: ScoringRule = useMemo(() => {
    if (ruleType === 'smaller_is_better' || ruleType === 'larger_is_better') {
      return { type: ruleType, optimal: Number(optimal), worst: Number(worst) };
    }
    if (ruleType === 'linear') {
      return { type: 'linear', bounds: [Number(boundLo), Number(boundHi)] };
    }
    if (ruleType === 'boolean') {
      return { type: 'boolean', trueScore: Number(boolTrueScore), falseScore: Number(boolFalseScore) };
    }
    if (ruleType === 'target_range') {
      return {
        type: 'target_range',
        optimalRange: [Number(optRangeLo), Number(optRangeHi)],
        toleranceRange: [Number(tolRangeLo), Number(tolRangeHi)],
      };
    }
    const cleanSteps = (stepRows.length > 0 ? stepRows : DEFAULT_STEPS)
      .filter((s) => Number.isFinite(Number(s.val)) && Number.isFinite(Number(s.score)))
      .map((s) => ({ val: Number(s.val), score: Math.max(0, Math.min(100, Number(s.score))) }))
      .sort((a, b) => a.val - b.val);
    return {
      type: 'step',
      steps: cleanSteps.length > 0 ? cleanSteps : DEFAULT_STEPS,
    };
  }, [
    ruleType,
    optimal,
    worst,
    boundLo,
    boundHi,
    optRangeLo,
    optRangeHi,
    tolRangeLo,
    tolRangeHi,
    stepRows,
    boolTrueScore,
    boolFalseScore,
  ]);

  // 口径数量级与边界自洽检查（非阻塞提示）
  const scaleWarnings = useMemo(() => {
    const warns: string[] = [];
    if (isUnitRatioLike(selectedOpMeta, atomRef)) {
      const nums: number[] = [];
      if (ruleType === 'smaller_is_better' || ruleType === 'larger_is_better') {
        nums.push(optimal, worst);
      } else if (ruleType === 'linear') {
        nums.push(boundLo, boundHi);
      } else if (ruleType === 'target_range') {
        nums.push(optRangeLo, optRangeHi, tolRangeLo, tolRangeHi);
      } else if (ruleType === 'step') {
        nums.push(...stepRows.map((s) => s.val));
      }
      if (nums.some((n) => Number.isFinite(n) && Math.abs(n) > 1.5)) {
        warns.push(
          `注意量纲数量级：算子「${atomRef}」输出类型为比率 (0–1 小数)，当前配置存在大于 1.5 的门限值，请确认是否应填写小数（如 0.80 而非 80）。`,
        );
      }
    }
    if (ruleType === 'target_range') {
      if (optRangeLo > optRangeHi) {
        warns.push('区间下界 (optLo) 应小于或等于上界 (optHi)。');
      }
      if (tolRangeLo > optRangeLo || optRangeHi > tolRangeHi) {
        warns.push('容忍边界 (tolLo / tolHi) 必须包络最优满分区间 (optLo / optHi)。');
      }
    }
    return warns;
  }, [
    selectedOpMeta,
    atomRef,
    ruleType,
    optimal,
    worst,
    boundLo,
    boundHi,
    optRangeLo,
    optRangeHi,
    tolRangeLo,
    tolRangeHi,
    stepRows,
  ]);

  // 实时试算点
  const testNumeric = parseFloat(testInputVal);
  const currentScore = useMemo(() => {
    if (Number.isNaN(testNumeric)) return null;
    return applyScoringRule(testNumeric, currentRule);
  }, [testNumeric, currentRule]);

  useEffect(() => {
    let active = true;
    evalApi
      .previewIndicatorCurve(currentRule, 32)
      .then((res) => {
        if (active) setCurvePts(res.points);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [currentRule]);

  const buildDraftDefinition = (): IndicatorDefinition => {
    const criteria: Record<string, string | number | boolean> = {};
    if (filterSide.trim()) criteria.Side = filterSide.trim();
    for (const row of extraFilters) {
      const k = row.key.trim();
      const v = row.value.trim();
      if (!k || !v) continue;
      const num = Number(v);
      if (v === 'true') criteria[k] = true;
      else if (v === 'false') criteria[k] = false;
      else if (!Number.isNaN(num) && v !== '') criteria[k] = num;
      else criteria[k] = v;
    }

    const parsedTags = tagsText
      .split(/[,，、]/)
      .map((t) => t.trim())
      .filter(Boolean);

    return {
      indicatorId: indicatorId.trim() || 'ind_draft_preview',
      name: name.trim() || '未命名指标',
      description: description.trim(),
      bindingMode,
      atomRef: bindingMode === 'single' ? atomRef : (sources[0]?.atomRef || ''),
      targetField: bindingMode === 'single' ? (targetField.trim() || undefined) : undefined,
      reduce: reduceMethod,
      ...(bindingMode === 'composite'
        ? {
            sources,
            composeFormula: composeFormula.trim(),
          }
        : {}),
      unit: unit.trim() || undefined,
      filterCriteria: Object.keys(criteria).length > 0 ? criteria : undefined,
      scoring: currentRule,
      alarmThreshold: enableAlarm
        ? {
            operator: alarmOp,
            value: Number(alarmVal),
            severity: alarmSeverity,
            messageTemplate:
              alarmMessageTemplate.trim() || `${name.trim() || indicatorId.trim()} 实测触发门限 (${alarmOp} ${alarmVal})`,
          }
        : undefined,
      tags: parsedTags.length > 0 ? parsedTags : ['自定义'],
    };
  };

  const curveOption = useMemo<echarts.EChartsOption>(() => {
    const isNumericValid = !Number.isNaN(testNumeric) && currentScore !== null;
    const sortedCurve = [...curvePts].sort((a, b) => a.x - b.x);

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          if (!params || !params.length) return '';
          const p = params[0];
          const valLabel = Array.isArray(p.data) ? p.data[1] : p.data;
          return `测定值 x: ${p.axisValue ?? p.data?.[0]}<br/>归一化分: <strong>${valLabel} 分</strong>`;
        },
      },
      grid: { left: 48, right: 30, top: 56, bottom: 32 },
      xAxis: {
        type: 'category',
        data: sortedCurve.map((p) => String(p.x)),
        name: `测定值${unit ? ` (${unit})` : ''}`,
        nameTextStyle: { color: '#94a3b8', fontSize: 10 },
        axisLabel: {
          color: '#94a3b8',
          fontSize: 10,
          formatter: formatAxisVal,
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        name: '归一化得分 (分)',
        nameTextStyle: { color: '#94a3b8', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,0.12)' } },
        axisLabel: { color: '#cbd5e1', fontSize: 10 },
      },
      series: [
        {
          type: 'line',
          smooth: ruleType !== 'step' && ruleType !== 'boolean',
          step: ruleType === 'step' ? 'end' : undefined,
          data: sortedCurve.map((p) => p.score),
          lineStyle: { color: '#3b82f6', width: 2.5 },
          itemStyle: { color: '#60a5fa' },
          areaStyle: { color: 'rgba(59,130,246,0.12)' },
          markPoint: isNumericValid && sortedCurve.length > 0
            ? {
                data: [
                  {
                    name: '实测联动定位点',
                    coord: [
                      String(
                        sortedCurve.reduce(
                          (prev, curr) =>
                            Math.abs(curr.x - testNumeric) < Math.abs(prev.x - testNumeric) ? curr : prev,
                          sortedCurve[0],
                        ).x,
                      ),
                      currentScore,
                    ],
                    value: `${currentScore}分`,
                    symbol: 'pin',
                    symbolSize: 44,
                    itemStyle: { color: '#10b981' },
                    label: { color: '#ffffff', fontSize: 10, fontWeight: 'bold' },
                  },
                ],
              }
            : undefined,
        },
      ],
    };
  }, [curvePts, ruleType, unit, testNumeric, currentScore]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMsg(null);
    try {
      const def = buildDraftDefinition();
      await evalApi.upsertIndicator(def);
      await onRefresh();
      setSelectedId(def.indicatorId);
      setStatusMsg({ kind: 'ok', text: `已保存指标「${def.name}」，可在评估体系中引用。` });
    } catch (err) {
      setStatusMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setStatusMsg(null);
    const refs = mountedByIndicator.get(id) ?? [];
    if (refs.length > 0) {
      const sysList = Array.from(new Set(refs.map((s) => s.systemName))).join('、');
      setStatusMsg({
        kind: 'err',
        text: `无法删除指标「${id}」：该指标正被评估体系【${sysList}】作为打分叶子节点引用！请先在三库体系中解除引用。`,
      });
      return;
    }
    try {
      await evalApi.deleteIndicator(id);
      await onRefresh();
      if (selectedId === id) setSelectedId('');
      setStatusMsg({ kind: 'ok', text: `已移除自定义指标 ${id}` });
    } catch (err) {
      setStatusMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleRunBacktest = async (mode: 'current' | 'all') => {
    setBacktesting(true);
    setBacktestError(null);
    try {
      const draft = buildDraftDefinition();
      const targetIds = mode === 'current' && selectedRunId ? [selectedRunId] : undefined;
      const res = await evalApi.backtestIndicator({
        indicator: draft,
        runIds: targetIds,
        targetSide: filterSide.trim() || undefined,
      });
      setBacktestResults(res.results);
      setBacktestSummary(res.summary);
      const firstValid = res.results.find((r) => typeof r.numericValue === 'number');
      if (firstValid && typeof firstValid.numericValue === 'number') {
        setTestInputVal(String(Number(firstValid.numericValue.toFixed(3))));
      }
    } catch (err) {
      setBacktestError(err instanceof Error ? err.message : String(err));
    } finally {
      setBacktesting(false);
    }
  };

  const handleCalibrateFromBacktest = () => {
    if (!backtestSummary || backtestSummary.minValue === null || backtestSummary.maxValue === null) return;
    const minV = backtestSummary.minValue;
    const maxV = backtestSummary.maxValue;
    const span = maxV - minV || Math.max(Math.abs(minV) * 0.2, 1);
    const padMin = Number((minV - span * 0.15).toFixed(2));
    const padMax = Number((maxV + span * 0.15).toFixed(2));
    if (ruleType === 'smaller_is_better') {
      setOptimal(Number(minV.toFixed(2)));
      setWorst(padMax);
    } else if (ruleType === 'larger_is_better') {
      setOptimal(Number(maxV.toFixed(2)));
      setWorst(Math.max(0, padMin));
    } else if (ruleType === 'linear') {
      setBoundLo(padMin);
      setBoundHi(padMax);
    } else if (ruleType === 'target_range') {
      setOptRangeLo(Number(minV.toFixed(2)));
      setOptRangeHi(Number(maxV.toFixed(2)));
      setTolRangeLo(padMin);
      setTolRangeHi(padMax);
    }
  };

  const handleExportIndicators = () => {
    const payload = JSON.stringify(filteredIndicators, null, 2);
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `f1_indicators_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportIndicatorsFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setStatusMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list: IndicatorDefinition[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.indicators)
          ? parsed.indicators
          : [];
      const res = await evalApi.importIndicators(list);
      await onRefresh();
      setStatusMsg({ kind: 'ok', text: `已成功批量导入并持久化 ${res.count} 项自定义指标。` });
    } catch (err) {
      setStatusMsg({
        kind: 'err',
        text: `批量导入失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const filteredIndicators = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return indicators.filter((ind) => {
      if (scopeFilter === 'builtin' && !ind.builtin) return false;
      if (scopeFilter === 'custom' && ind.builtin) return false;
      if (scopeFilter === 'mounted' && (mountedByIndicator.get(ind.indicatorId)?.length ?? 0) === 0) {
        return false;
      }
      if (domainTagFilter !== 'all') {
        const tagMatch = (ind.tags ?? []).some((t) => t.includes(domainTagFilter));
        const prefixMap: Record<string, string[]> = {
          时效: ['time.', 'kc.'],
          效能: ['eff.', 'effectiveness.', 'moe.', 'wpn.'],
          态势: ['sit.', 'situation.', 'surv.'],
          合规: ['comp.', 'compliance.', 'roe.'],
          成本: ['cost.', 'mos.'],
        };
        const atomMatch = (prefixMap[domainTagFilter] ?? []).some((p) => ind.atomRef.startsWith(p));
        if (!tagMatch && !atomMatch) return false;
      }
      if (!q) return true;
      return (
        ind.indicatorId.toLowerCase().includes(q) ||
        ind.name.toLowerCase().includes(q) ||
        ind.atomRef.toLowerCase().includes(q) ||
        (ind.description ?? '').toLowerCase().includes(q) ||
        (ind.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [indicators, searchQuery, scopeFilter, domainTagFilter, mountedByIndicator]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <button
          type="button"
          id={studioMode === 'v4_dag' ? 'btn-indicator-mode-classic' : 'btn-indicator-mode-v4-dag'}
          onClick={() => setStudioMode((m) => (m === 'v4_dag' ? 'classic' : 'v4_dag'))}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#161b22] px-2.5 py-1 text-[11px] font-medium text-[#8b949e] hover:border-slate-500 hover:text-slate-200 transition"
        >
          {studioMode === 'v4_dag' ? (
            <>
              <Layers className="h-3 w-3" />
              <span>切换经典标量表单</span>
            </>
          ) : (
            <>
              <GitBranch className="h-3 w-3 text-emerald-400" />
              <span>返回 V4 指标 DAG 画布</span>
            </>
          )}
        </button>
      </div>

      {studioMode === 'v4_dag' ? (
        <MetricDagStudioPanel
          selectedRunId={selectedRunId}
          activeSourceId={activeSourceId}
          onDrillDownToOperator={onDrillDownToOperator}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
      {/* 左侧指标清单 */}
      <section className="min-w-0 flex flex-col rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5 lg:col-span-5 panel-isolate">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
            <Layers className="h-4 w-4 text-blue-400" />
            指标列表 ({filteredIndicators.length}/{indicators.length})
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={handleExportIndicators}
              className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#0f141a] px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500"
              title="导出当前列表指标定义 JSON"
            >
              <Download className="h-3 w-3" />
              导出
            </button>
            <button
              type="button"
              onClick={() => importFileRef.current?.click()}
              className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#0f141a] px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500"
              title="批量导入指标定义 JSON"
            >
              <Upload className="h-3 w-3" />
              导入
            </button>
            <input
              ref={importFileRef}
              type="file"
              accept=".json"
              className="sr-only"
              onChange={handleImportIndicatorsFile}
            />
            <button
              type="button"
              onClick={() => {
                setSelectedId('');
                setIndicatorId(`ind_custom_${Date.now().toString(36).slice(-4)}`);
                setName('新建战术考核指标');
                setBindingMode('single');
                setSources([]);
                setComposeFormula('');
                setReduceMethod('mean');
                setTargetField('');
                setExtraFilters([]);
                setTagsText('自定义');
                setStatusMsg(null);
              }}
              className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1 text-xs text-blue-300 hover:border-blue-500"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              新建草案
            </button>
          </div>
        </div>

        {/* 检索与领域筛选条 */}
        <div className="mb-2.5 space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[#8b949e]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索指标名、ID、算子或标签…"
              className="w-full rounded-md border border-[#30363d] bg-[#0f141a] py-1.5 pl-8 pr-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            {(
              [
                ['all', '全部'],
                ['mounted', '已挂载'],
                ['builtin', '内置'],
                ['custom', '自定义'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setScopeFilter(k)}
                className={`rounded px-2 py-0.5 transition ${
                  scopeFilter === k
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                    : 'bg-[#0f141a] text-[#8b949e] border border-[#262d38] hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
            <span className="mx-0.5 h-3 w-px bg-[#262d38]" aria-hidden="true" />
            {['all', '时效', '效能', '态势', '合规', '成本'].map((dom) => (
              <button
                key={dom}
                type="button"
                onClick={() => setDomainTagFilter(dom)}
                className={`rounded px-1.5 py-0.5 transition ${
                  domainTagFilter === dom
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-[#0f141a] text-[#8b949e] border border-[#262d38] hover:text-slate-200'
                }`}
              >
                {dom === 'all' ? '全领域' : dom}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-[320px] max-h-[820px] space-y-1.5 overflow-y-auto pr-1">
          {filteredIndicators.length === 0 ? (
            <div className="rounded-md border border-dashed border-[#30363d] bg-[#0f141a] p-6 text-center text-xs text-[#8b949e]">
              未检索到匹配指标，可尝试清空过滤条件或点击「新建草案」。
            </div>
          ) : (
            filteredIndicators.map((ind) => {
              const active = ind.indicatorId === selectedId;
              const mounts = mountedByIndicator.get(ind.indicatorId) ?? [];
              return (
                <div
                  key={ind.indicatorId}
                  onClick={() => loadIntoForm(ind)}
                  className={`cursor-pointer rounded-md border p-2.5 transition ${
                    active
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-[#262d38] bg-[#0f141a] hover:border-[#374151]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-medium text-slate-100">{ind.name}</span>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                            ind.builtin ? 'bg-[#1c2128] text-[#8b949e]' : 'bg-blue-500/15 text-blue-300'
                          }`}
                        >
                          {ind.builtin ? '内置' : '自定义'}
                        </span>
                        {ind.bindingMode === 'composite' && (
                          <span className="shrink-0 rounded bg-purple-500/15 border border-purple-500/30 px-1.5 py-0.5 text-[10px] text-purple-300">
                            多算子复合
                          </span>
                        )}
                        {mounts.length > 0 && (
                          <span className="shrink-0 rounded bg-sky-500/15 border border-sky-500/30 px-1.5 py-0.5 text-[10px] text-sky-300">
                            挂载 {mounts.length}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-blue-300">
                        {ind.bindingMode === 'composite' ? (
                          <span className="text-purple-300">
                            {ind.indicatorId} · 公式: {ind.composeFormula || '未配置'} ({ind.sources?.length ?? 0}源)
                          </span>
                        ) : (
                          <>
                            {ind.indicatorId} · {ind.atomRef}
                            {ind.targetField ? `#${ind.targetField}` : ''}
                            {ind.unit ? ` [${ind.unit}]` : ''}
                          </>
                        )}
                      </p>
                      {ind.filterCriteria && Object.keys(ind.filterCriteria).length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {Object.entries(ind.filterCriteria).map(([fk, fv]) => (
                            <span
                              key={fk}
                              className="inline-block rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 px-1 py-0.2 text-[9px] font-mono"
                            >
                              {fk}={String(fv)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {!ind.builtin && (
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          void handleDelete(ind.indicatorId);
                        }}
                        className="rounded p-1 text-[#8b949e] hover:bg-rose-500/15 hover:text-rose-300"
                        aria-label={`删除指标 ${ind.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] text-[#8b949e]">{ind.description}</p>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* 右侧表单与 ECharts 评分曲线实时预览 */}
      <section className="min-w-0 space-y-3 lg:col-span-7 panel-isolate">
        <form onSubmit={handleSave} className="space-y-3">
          {/* 顶部动作条 */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#2a313c] bg-[#161b22] p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-100">指标评分规则编辑</h3>
              {selectedId ? (
                indicators.find((i) => i.indicatorId === selectedId)?.builtin ? (
                  <span className="rounded bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300">
                    基于内置 [{selectedId}] 派生副本
                  </span>
                ) : (
                  <span className="rounded bg-blue-900/40 border border-blue-500/40 px-1.5 py-0.5 text-[11px] text-blue-300">
                    编辑自定义 [{selectedId}]
                  </span>
                )
              ) : (
                <span className="rounded bg-emerald-900/40 border border-emerald-500/40 px-1.5 py-0.5 text-[11px] text-emerald-300">
                  新建空白指标草案
                </span>
              )}
            </div>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50 shadow-sm"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? '保存中…' : '保存为标准自定义指标'}
            </button>
          </div>

          {statusMsg && (
            <div
              className={`rounded-lg p-2.5 text-xs ${
                statusMsg.kind === 'ok'
                  ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  : 'border border-rose-500/40 bg-rose-500/10 text-rose-200'
              }`}
            >
              {statusMsg.text}
            </div>
          )}

          {/* 顶部 IndicatorFlowStrip 阶段流向条 */}
          <IndicatorFlowStrip
            bindingMode={bindingMode}
            atomRef={atomRef}
            targetField={targetField}
            sources={sources}
            reduceMethod={reduceMethod}
            filterSide={filterSide}
            composeFormula={composeFormula}
            ruleType={ruleType}
            enableAlarm={enableAlarm}
            alarmOp={alarmOp}
            alarmVal={alarmVal}
            latestBacktest={backtestResults[0]}
            currentScore={currentScore}
            onNavigateCard={scrollToCard}
          />

          {/* Card ①: 基础标识与口径 */}
          <div
            id="ind-card-basic"
            className={`rounded-lg border bg-[#161b22] p-3.5 space-y-3 transition-all duration-300 ${
              highlightedCard === 'ind-card-basic'
                ? 'border-blue-500 ring-2 ring-blue-500/40 shadow-lg shadow-blue-500/10'
                : 'border-[#30363d]'
            }`}
          >
            <div className="flex items-center gap-1.5 border-b border-[#262c36] pb-2 text-xs font-semibold text-slate-200">
              <Sliders className="h-4 w-4 text-blue-400" />
              <span>① 基础标识与口径</span>
            </div>
            <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
              <div>
                <label htmlFor="ind-name" className="mb-1 block text-[#8b949e]">
                  指标中文名称
                </label>
                <input
                  id="ind-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="ind-id" className="mb-1 block text-[#8b949e]">
                  指标 ID (仅字母/数字/_.-)
                </label>
                <input
                  id="ind-id"
                  required
                  pattern="(?:[a-zA-Z0-9_.]|-)+"
                  value={indicatorId}
                  onChange={(e) => setIndicatorId(e.target.value)}
                  className="w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 font-mono text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="ind-unit" className="mb-1 block text-[#8b949e]">
                  物理量纲/单位 (Unit)
                </label>
                <input
                  id="ind-unit"
                  placeholder="如: 0-1, %, s, km, 架, 枚/战果"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="ind-tags" className="mb-1 block text-[#8b949e]">
                  业务标签 (逗号分隔，用于分类检索)
                </label>
                <input
                  id="ind-tags"
                  placeholder="如: 效能, 精确打击, 空战"
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  className="w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="ind-desc" className="mb-1 block text-[#8b949e]">
                  指标口径说明
                </label>
                <textarea
                  id="ind-desc"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Card ②: 数据源与合成规则 */}
          <div
            id="ind-card-source"
            className={`rounded-lg border bg-[#161b22] p-3.5 space-y-3 transition-all duration-300 ${
              highlightedCard === 'ind-card-source'
                ? 'border-purple-500 ring-2 ring-purple-500/40 shadow-lg shadow-purple-500/10'
                : 'border-[#30363d]'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262c36] pb-2 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                <Layers className="h-4 w-4 text-purple-400" />
                <span>② 数据源与合成规则</span>
              </div>
              <div className="flex items-center gap-1 rounded bg-[#0f141a] border border-[#30363d] p-0.5">
                <button
                  type="button"
                  onClick={() => setBindingMode('single')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                    bindingMode === 'single'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-[#8b949e] hover:text-slate-200'
                  }`}
                >
                  单算子直绑 (Single)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBindingMode('composite');
                    if (sources.length === 0) {
                      setSources([
                        {
                          alias: 'm1',
                          atomRef: atomRef || operators[0]?.id || '',
                          reduce: 'mean',
                          missingPolicy: 'fail',
                        },
                      ]);
                    }
                  }}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                    bindingMode === 'composite'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-[#8b949e] hover:text-slate-200'
                  }`}
                >
                  多算子复合 (Composite)
                </button>
              </div>
            </div>

            {bindingMode === 'single' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 text-xs">
                  <div className="md:col-span-5">
                    <label htmlFor="ind-atom" className="mb-1 block text-[#8b949e]">
                      绑定计算算子
                    </label>
                    <select
                      id="ind-atom"
                      value={atomRef}
                      onChange={(e) => {
                        const newRef = e.target.value;
                        setAtomRef(newRef);
                        const op = operators.find((o) => o.id === newRef);
                        const inferred = inferUnitForOperator(op, newRef);
                        if (inferred) setUnit(inferred);
                      }}
                      className="w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100"
                    >
                      {operators.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.id} — {o.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-4">
                    <label htmlFor="ind-target-field" className="mb-1 block text-[#8b949e]">
                      输出字段 (targetField)
                    </label>
                    <input
                      id="ind-target-field"
                      list="target-field-datalist"
                      placeholder="默认取标量或首列"
                      value={targetField}
                      onChange={(e) => setTargetField(e.target.value)}
                      className="w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100 focus:border-blue-500 focus:outline-none"
                    />
                    <datalist id="target-field-datalist">
                      {(
                        selectedOpMeta?.f1FieldContract?.csvColumns || [
                          'HitRate',
                          'KillHits',
                          'FiredCount',
                          'DamagePercent',
                          'ActiveDuration_s',
                          'InCorridorDuration_s',
                          'UnitComplianceRate',
                          'MinMargin_km',
                          'value',
                          'score',
                        ]
                      ).map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>

                  <div className="md:col-span-3">
                    <label htmlFor="ind-reduce" className="mb-1 block text-[#8b949e]">
                      多行归约方法 (reduce)
                    </label>
                    <select
                      id="ind-reduce"
                      value={reduceMethod}
                      onChange={(e) => setReduceMethod(e.target.value as IndicatorReduceMethod)}
                      className="w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100"
                    >
                      <option value="mean">mean (算术均值)</option>
                      <option value="sum">sum (累加和)</option>
                      <option value="max">max (最大值)</option>
                      <option value="min">min (最小值)</option>
                      <option value="median">median (中位数)</option>
                      <option value="last">last (最新值)</option>
                      <option value="first">first (首行)</option>
                    </select>
                  </div>
                </div>

                {/* 可折叠的数据切片过滤 */}
                <div className="rounded border border-[#262c36] bg-[#0f141a]/60 p-2.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setShowFilterDetails((prev) => !prev)}
                    className="flex w-full items-center justify-between text-left text-[11px] font-medium text-slate-300 hover:text-white"
                  >
                    <span>
                      数据切片过滤配置 (Side 阵营与多维行筛选{extraFilters.length > 0 ? ` · ${extraFilters.length}条` : ''})
                    </span>
                    {showFilterDetails ? (
                      <ChevronUp className="h-3.5 w-3.5 text-[#8b949e]" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-[#8b949e]" />
                    )}
                  </button>

                  {showFilterDetails && (
                    <div className="mt-2.5 space-y-2 border-t border-[#262c36] pt-2">
                      <div>
                        <label htmlFor="ind-side" className="mb-1 block text-[#8b949e]">
                          阵营切片过滤 (Side，可选)
                        </label>
                        <input
                          id="ind-side"
                          placeholder="留空为全量；可填 红方, 蓝方, PLAAF"
                          value={filterSide}
                          onChange={(e) => setFilterSide(e.target.value)}
                          className="w-full rounded border border-[#30363d] bg-[#161b22] px-2.5 py-1.5 text-slate-100 focus:border-blue-500 focus:outline-none"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-[#8b949e]">
                            多维行筛选条件 (filterCriteria，按列名精确匹配)
                          </span>
                          <button
                            type="button"
                            onClick={() => setExtraFilters((prev) => [...prev, { key: '', value: '' }])}
                            className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5 text-[10px] text-blue-300 hover:border-blue-500"
                          >
                            <Plus className="h-3 w-3" />
                            添加筛选条件
                          </button>
                        </div>
                        {extraFilters.map((row, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input
                              placeholder="字段名（如 MissionID）"
                              value={row.key}
                              onChange={(e) =>
                                setExtraFilters((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)),
                                )
                              }
                              className="flex-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[11px] text-slate-100"
                            />
                            <span className="text-slate-500">=</span>
                            <input
                              placeholder="匹配值（如 PL-15）"
                              value={row.value}
                              onChange={(e) =>
                                setExtraFilters((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)),
                                )
                              }
                              className="flex-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-[11px] text-slate-100"
                            />
                            <button
                              type="button"
                              onClick={() => setExtraFilters((prev) => prev.filter((_, i) => i !== idx))}
                              className="rounded p-1 text-[#8b949e] hover:bg-rose-500/15 hover:text-rose-300"
                              aria-label="删除筛选条件"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                {/* 复合模式通栏输入源卡片 */}
                <div className="rounded-md border border-purple-500/30 bg-purple-950/15 p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-purple-300">
                      多算子输入源列表 ({sources.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const nextIdx = sources.length + 1;
                        setSources([
                          ...sources,
                          {
                            alias: `src_${nextIdx}`,
                            atomRef: operators[0]?.id || '',
                            reduce: 'mean',
                            missingPolicy: 'fail',
                          },
                        ]);
                      }}
                      className="inline-flex items-center gap-1 rounded border border-purple-500/40 bg-purple-500/15 px-2 py-0.5 text-[11px] text-purple-200 hover:bg-purple-500/25"
                    >
                      <Plus className="h-3 w-3" />
                      添加输入源
                    </button>
                  </div>

                  <div className="space-y-2">
                    {sources.map((src, sIdx) => {
                      const srcOpMeta = operators.find((o) => o.id === src.atomRef);
                      const srcFieldCols = srcOpMeta?.f1FieldContract?.csvColumns || [];
                      return (
                        <div
                          key={sIdx}
                          className="rounded border border-[#30363d] bg-[#0f141a] p-2.5 text-xs space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262c36] pb-1.5">
                            <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                              <span className="text-[#8b949e] font-mono text-[11px]">变量名:</span>
                              <input
                                type="text"
                                value={src.alias}
                                onChange={(e) => {
                                  const updated = [...sources];
                                  updated[sIdx] = {
                                    ...src,
                                    alias: e.target.value.replace(/[^A-Za-z0-9_]/g, ''),
                                  };
                                  setSources(updated);
                                }}
                                placeholder="如: strike_rate"
                                className="w-36 rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5 font-mono text-purple-300"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => setSources(sources.filter((_, idx) => idx !== sIdx))}
                              className="rounded p-1 text-[#8b949e] hover:bg-rose-500/15 hover:text-rose-300"
                              title="删除输入源"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                            <div className="sm:col-span-4">
                              <span className="text-[10px] text-[#8b949e] block mb-0.5">引用算子:</span>
                              <select
                                value={src.atomRef}
                                onChange={(e) => {
                                  const updated = [...sources];
                                  updated[sIdx] = { ...src, atomRef: e.target.value };
                                  setSources(updated);
                                }}
                                className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-[11px] text-slate-100"
                              >
                                {operators.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.id} — {o.name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="sm:col-span-3">
                              <span className="text-[10px] text-[#8b949e] block mb-0.5">目标字段:</span>
                              <input
                                type="text"
                                list={`src-field-list-${sIdx}`}
                                value={src.targetField || ''}
                                onChange={(e) => {
                                  const updated = [...sources];
                                  updated[sIdx] = { ...src, targetField: e.target.value || undefined };
                                  setSources(updated);
                                }}
                                placeholder="输出列(默认标量)"
                                className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5 text-[11px] text-slate-100"
                              />
                              {srcFieldCols.length > 0 && (
                                <datalist id={`src-field-list-${sIdx}`}>
                                  {srcFieldCols.map((col) => (
                                    <option key={col} value={col} />
                                  ))}
                                </datalist>
                              )}
                            </div>

                            <div className="sm:col-span-2">
                              <span className="text-[10px] text-[#8b949e] block mb-0.5">归约聚合:</span>
                              <select
                                value={src.reduce || 'mean'}
                                onChange={(e) => {
                                  const updated = [...sources];
                                  updated[sIdx] = { ...src, reduce: e.target.value as IndicatorReduceMethod };
                                  setSources(updated);
                                }}
                                className="w-full rounded border border-[#30363d] bg-[#161b22] px-1.5 py-0.5 text-[11px] text-slate-100"
                              >
                                <option value="mean">mean</option>
                                <option value="sum">sum</option>
                                <option value="max">max</option>
                                <option value="min">min</option>
                                <option value="median">median</option>
                                <option value="last">last</option>
                                <option value="first">first</option>
                              </select>
                            </div>

                            <div className="sm:col-span-3">
                              <span className="text-[10px] text-[#8b949e] block mb-0.5">缺失策略:</span>
                              <select
                                value={src.missingPolicy || 'fail'}
                                onChange={(e) => {
                                  const policy = e.target.value as 'fail' | 'fallback';
                                  const updated = [...sources];
                                  updated[sIdx] = {
                                    ...src,
                                    missingPolicy: policy,
                                    fallbackValue: policy === 'fallback' ? (src.fallbackValue ?? 0) : undefined,
                                  };
                                  setSources(updated);
                                }}
                                className="w-full rounded border border-[#30363d] bg-[#161b22] px-1.5 py-0.5 text-[11px] text-slate-100"
                              >
                                <option value="fail">fail (熔断)</option>
                                <option value="fallback">fallback (常数)</option>
                              </select>
                            </div>
                          </div>

                          {src.missingPolicy === 'fallback' && (
                            <div className="flex items-center gap-2 pt-1 border-t border-[#262c36]">
                              <span className="text-[10px] text-amber-300 shrink-0">
                                兜底常数 (fallbackValue):
                              </span>
                              <input
                                type="number"
                                step="any"
                                value={src.fallbackValue ?? 0}
                                onChange={(e) => {
                                  const v = Number(e.target.value);
                                  const updated = [...sources];
                                  updated[sIdx] = { ...src, fallbackValue: Number.isFinite(v) ? v : 0 };
                                  setSources(updated);
                                }}
                                className="w-28 rounded border border-amber-500/40 bg-[#161b22] px-1.5 py-0.5 font-mono text-[11px] text-amber-200"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* 全宽通栏 LibFormula AST 公式区 */}
                  <div className="space-y-1.5 pt-2 border-t border-purple-500/30">
                    <div className="flex items-center justify-between">
                      <label htmlFor="ind-compose-formula" className="block text-purple-300 font-medium text-xs">
                        LibFormula AST 复合公式 (引用变量名)
                      </label>
                      {compositeFormulaCheck && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border ${
                            compositeFormulaCheck.valid
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                              : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                          }`}
                        >
                          {compositeFormulaCheck.valid ? 'AST 语法通过' : compositeFormulaCheck.errors[0]}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1">
                      {sources.map((s, idx) =>
                        s.alias ? (
                          <button
                            key={`${s.alias}-${idx}`}
                            type="button"
                            onClick={() =>
                              setComposeFormula((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${s.alias}`)
                            }
                            className="rounded border border-purple-500/40 bg-purple-500/15 px-1.5 py-0.5 font-mono text-[10px] text-purple-200 hover:bg-purple-500/30"
                            title={`插入变量 ${s.alias}`}
                          >
                            +{s.alias}
                          </button>
                        ) : null,
                      )}
                      {['IF(, , )', 'MIN(, )', 'MAX(, )', 'AVG(, )', 'SQRT()', 'ROUND(, 2)'].map((fn) => (
                        <button
                          key={fn}
                          type="button"
                          onClick={() => setComposeFormula((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${fn}`)}
                          className="rounded border border-[#30363d] bg-[#161b22] px-1.5 py-0.5 font-mono text-[10px] text-slate-300 hover:border-slate-500"
                          title={`插入函数模板 ${fn}`}
                        >
                          {fn.split('(')[0]}
                        </button>
                      ))}
                    </div>

                    <input
                      id="ind-compose-formula"
                      value={composeFormula}
                      onChange={(e) => setComposeFormula(e.target.value)}
                      placeholder="如: IF(cost > 0, (completion * 1000) / cost, completion)"
                      className="w-full rounded border border-purple-500/40 bg-[#0f141a] px-2.5 py-1.5 font-mono text-purple-200 text-xs focus:border-purple-400 focus:outline-none"
                    />
                    <p className="text-[10px] text-[#8b949e]">
                      微秒级 AST 求值，支持多源算子与常数四则运算，严防除零风险与列污染。
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Card ③: 归一化评分与映射曲线 (双列同屏排版) */}
          <div
            id="ind-card-scoring"
            className={`rounded-lg border bg-[#161b22] p-3.5 space-y-3 transition-all duration-300 ${
              highlightedCard === 'ind-card-scoring'
                ? 'border-emerald-500 ring-2 ring-emerald-500/40 shadow-lg shadow-emerald-500/10'
                : 'border-[#30363d]'
            }`}
          >
            <div className="flex items-center gap-1.5 border-b border-[#262c36] pb-2 text-xs font-semibold text-slate-200">
              <Gauge className="h-4 w-4 text-emerald-400" />
              <span>③ 归一化评分与映射曲线 (0–100 分)</span>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              {/* 左列：评分函数类型与参数 (lg:col-span-5) */}
              <div className="space-y-3 lg:col-span-5 text-xs">
                <div>
                  <label htmlFor="ind-rule" className="mb-1 block text-[#8b949e]">
                    评分归一化函数类型
                  </label>
                  <select
                    id="ind-rule"
                    value={ruleType}
                    onChange={(e) => setRuleType(e.target.value as ScoringRule['type'])}
                    className="w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100"
                  >
                    <option value="smaller_is_better">越小越好 (smaller_is_better)</option>
                    <option value="larger_is_better">越大越好 (larger_is_better)</option>
                    <option value="target_range">区间适度最优 (target_range / 梯形)</option>
                    <option value="linear">线性区间映射 (linear)</option>
                    <option value="step">阶梯分段计分 (step)</option>
                    <option value="boolean">布尔判据 (boolean)</option>
                  </select>
                </div>

                {/* 参数紧凑配置区：防撑爆防挤压 */}
                <div className="rounded border border-[#262c36] bg-[#0f141a] p-2.5 space-y-2">
                  {(ruleType === 'smaller_is_better' || ruleType === 'larger_is_better') && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="ind-opt" className="mb-1 block text-[#8b949e] text-[11px]">
                          最优满分值 (opt=100分)
                        </label>
                        <input
                          id="ind-opt"
                          type="number"
                          step="any"
                          required
                          value={optimal}
                          onChange={(e) => setOptimal(Number(e.target.value))}
                          className="tabular-nums w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-slate-100 font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label htmlFor="ind-wst" className="mb-1 block text-[#8b949e] text-[11px]">
                          最劣归零值 (wst=0分)
                        </label>
                        <input
                          id="ind-wst"
                          type="number"
                          step="any"
                          required
                          value={worst}
                          onChange={(e) => setWorst(Number(e.target.value))}
                          className="tabular-nums w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-slate-100 font-mono text-xs"
                        />
                      </div>
                    </div>
                  )}

                  {ruleType === 'target_range' && (
                    <div className="space-y-1.5">
                      <span className="text-[10px] text-slate-400 block font-medium">梯形适度区间 (tolLo &le; optLo &le; optHi &le; tolHi)</span>
                      <div className="grid grid-cols-2 gap-1.5">
                        <div>
                          <label htmlFor="ind-opt-lo" className="text-[10px] text-[#8b949e] block">optLo (100分)</label>
                          <input
                            id="ind-opt-lo"
                            type="number"
                            step="any"
                            value={optRangeLo}
                            onChange={(e) => setOptRangeLo(Number(e.target.value))}
                            className="tabular-nums w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-slate-100 font-mono text-xs"
                          />
                        </div>
                        <div>
                          <label htmlFor="ind-opt-hi" className="text-[10px] text-[#8b949e] block">optHi (100分)</label>
                          <input
                            id="ind-opt-hi"
                            type="number"
                            step="any"
                            value={optRangeHi}
                            onChange={(e) => setOptRangeHi(Number(e.target.value))}
                            className="tabular-nums w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-slate-100 font-mono text-xs"
                          />
                        </div>
                        <div>
                          <label htmlFor="ind-tol-lo" className="text-[10px] text-[#8b949e] block">tolLo (0分)</label>
                          <input
                            id="ind-tol-lo"
                            type="number"
                            step="any"
                            value={tolRangeLo}
                            onChange={(e) => setTolRangeLo(Number(e.target.value))}
                            className="tabular-nums w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-slate-100 font-mono text-xs"
                          />
                        </div>
                        <div>
                          <label htmlFor="ind-tol-hi" className="text-[10px] text-[#8b949e] block">tolHi (0分)</label>
                          <input
                            id="ind-tol-hi"
                            type="number"
                            step="any"
                            value={tolRangeHi}
                            onChange={(e) => setTolRangeHi(Number(e.target.value))}
                            className="tabular-nums w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-slate-100 font-mono text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {ruleType === 'linear' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="ind-lo" className="text-[11px] text-[#8b949e] block mb-0.5">0 分界限 (bounds[0])</label>
                        <input
                          id="ind-lo"
                          type="number"
                          step="any"
                          value={boundLo}
                          onChange={(e) => setBoundLo(Number(e.target.value))}
                          className="tabular-nums w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-slate-100 font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label htmlFor="ind-hi" className="text-[11px] text-[#8b949e] block mb-0.5">100 分界限 (bounds[1])</label>
                        <input
                          id="ind-hi"
                          type="number"
                          step="any"
                          value={boundHi}
                          onChange={(e) => setBoundHi(Number(e.target.value))}
                          className="tabular-nums w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-slate-100 font-mono text-xs"
                        />
                      </div>
                    </div>
                  )}

                  {ruleType === 'boolean' && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label htmlFor="ind-bool-true" className="text-[11px] text-[#8b949e] block mb-0.5">真 (true) 得分</label>
                          <input
                            id="ind-bool-true"
                            type="number"
                            step="any"
                            value={boolTrueScore}
                            onChange={(e) => setBoolTrueScore(Number(e.target.value))}
                            className="tabular-nums w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-slate-100 font-mono text-xs"
                          />
                        </div>
                        <div>
                          <label htmlFor="ind-bool-false" className="text-[11px] text-[#8b949e] block mb-0.5">假 (false) 得分</label>
                          <input
                            id="ind-bool-false"
                            type="number"
                            step="any"
                            value={boolFalseScore}
                            onChange={(e) => setBoolFalseScore(Number(e.target.value))}
                            className="tabular-nums w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-slate-100 font-mono text-xs"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const prevT = boolTrueScore;
                          setBoolTrueScore(boolFalseScore);
                          setBoolFalseScore(prevT);
                        }}
                        className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-[11px] text-blue-300 hover:border-blue-500"
                      >
                        正/反向对调
                      </button>
                    </div>
                  )}

                  {ruleType === 'step' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400">多档阶梯 (&ge; 阈值落档)</span>
                        <button
                          type="button"
                          onClick={() =>
                            setStepRows((prev) => [
                              ...prev,
                              { val: (prev[prev.length - 1]?.val ?? 0) + 10, score: 80 },
                            ])
                          }
                          className="inline-flex items-center gap-0.5 rounded border border-blue-500/40 bg-blue-500/15 px-1.5 py-0.5 text-[9px] text-blue-300"
                        >
                          <Plus className="h-2.5 w-2.5" /> 加档
                        </button>
                      </div>
                      <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                        {stepRows.map((row, idx) => (
                          <div key={idx} className="flex items-center gap-1.5">
                            <span className="text-[10px] text-[#8b949e] w-8 shrink-0">&ge;</span>
                            <input
                              type="number"
                              step="any"
                              value={row.val}
                              onChange={(e) =>
                                setStepRows((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, val: Number(e.target.value) } : r)),
                                )
                              }
                              className="tabular-nums flex-1 rounded border border-[#30363d] bg-[#161b22] px-1.5 py-0.5 font-mono text-[11px] text-slate-100"
                            />
                            <span className="text-[10px] text-slate-400 shrink-0">➔</span>
                            <input
                              type="number"
                              step="any"
                              value={row.score}
                              onChange={(e) =>
                                setStepRows((prev) =>
                                  prev.map((r, i) => (i === idx ? { ...r, score: Number(e.target.value) } : r)),
                                )
                              }
                              className="tabular-nums w-14 rounded border border-[#30363d] bg-[#161b22] px-1.5 py-0.5 font-mono text-[11px] text-emerald-300"
                            />
                            <button
                              type="button"
                              disabled={stepRows.length <= 1}
                              onClick={() => setStepRows((prev) => prev.filter((_, i) => i !== idx))}
                              className="rounded p-0.5 text-[#8b949e] hover:text-rose-300 disabled:opacity-20"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {scaleWarnings.length > 0 && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-950/25 p-2 text-[11px] text-amber-200 space-y-1">
                    {scaleWarnings.map((w, idx) => (
                      <div key={idx} className="flex items-start gap-1">
                        <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5 text-amber-400" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 右列：曲线图 + 试算交互 + 回测摘要 (lg:col-span-7) */}
              <div className="space-y-3 lg:col-span-7 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="font-semibold text-slate-300 text-xs">实测回测与映射曲线</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={backtesting || !selectedRunId}
                      onClick={() => handleRunBacktest('current')}
                      className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40"
                    >
                      <FlaskConical className="h-3 w-3" />
                      {backtesting ? '回测中…' : '回测当前测试数据'}
                    </button>
                    <button
                      type="button"
                      disabled={backtesting || runs.length === 0}
                      onClick={() => handleRunBacktest('all')}
                      className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#0f141a] px-2 py-1 text-[11px] text-slate-200 hover:border-blue-500 disabled:opacity-40"
                    >
                      全量回测 ({runs.length})
                    </button>
                    {backtestSummary &&
                      backtestSummary.validCount >= 1 &&
                      ruleType !== 'step' &&
                      ruleType !== 'boolean' && (
                        <button
                          type="button"
                          onClick={handleCalibrateFromBacktest}
                          className="inline-flex items-center gap-1 rounded border border-purple-500/40 bg-purple-500/15 px-2 py-1 text-[11px] text-purple-200 hover:bg-purple-500/25"
                        >
                          <Sparkles className="h-3 w-3" />
                          推荐门限
                        </button>
                      )}
                  </div>
                </div>

                <div className="rounded border border-[#2a313c] bg-[#0d1117] p-1.5">
                  <EChartPanel option={curveOption} height={220} />
                </div>

                {/* 实时试算与实测值交互条 */}
                <div className="rounded border border-[#2a313c] bg-[#0f141a] p-2.5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[#8b949e]">推演实测值:</span>
                      <input
                        type="number"
                        step="any"
                        value={testInputVal}
                        onChange={(e) => setTestInputVal(e.target.value)}
                        className="tabular-nums w-24 rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5 font-mono text-xs text-emerald-300 focus:border-emerald-500 focus:outline-none"
                        placeholder="如: 85"
                      />
                      <span className="text-slate-500 text-[11px] font-mono">{unit || ''}</span>
                    </div>

                    {currentScore !== null ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[#8b949e]">实时得分:</span>
                        <span className="text-sm font-bold font-mono text-emerald-400">
                          {currentScore.toFixed(1)} <span className="text-[10px] text-slate-400 font-normal">分</span>
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-500 text-xs italic">无有效数值</span>
                    )}
                  </div>

                  {backtestError && (
                    <div className="rounded border border-rose-500/40 bg-rose-950/30 p-1.5 text-[11px] text-rose-300">
                      回测失败：{backtestError}
                    </div>
                  )}

                  {backtestSummary && (
                    <div className="border-t border-[#262c36] pt-2 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-[#8b949e]">
                        <span>
                          有效: <strong className="text-slate-200">{backtestSummary.validCount}/{backtestSummary.totalRuns}</strong>
                          {backtestSummary.minValue !== null && (
                            <> · 范围: <strong className="text-slate-200">{backtestSummary.minValue}~{backtestSummary.maxValue}</strong></>
                          )}
                          {backtestSummary.avgScore !== null && (
                            <> · 均分: <strong className="text-emerald-300">{backtestSummary.avgScore}</strong></>
                          )}
                        </span>
                      </div>

                      <div className="max-h-28 overflow-y-auto space-y-1">
                        {backtestResults.map((r) => (
                          <div
                            key={r.runId}
                            onClick={() => {
                              if (typeof r.numericValue === 'number') {
                                setTestInputVal(String(Number(r.numericValue.toFixed(3))));
                              }
                            }}
                            className="flex items-center justify-between gap-2 rounded border border-[#262d38] bg-[#161b22] px-2 py-1 text-[11px] cursor-pointer hover:border-blue-500/60 transition"
                          >
                            <div className="min-w-0 flex-1 truncate text-slate-200">
                              <span className="font-medium">{r.scenarioName}</span>
                              <span className="ml-1 font-mono text-[10px] text-[#8b949e]">[{r.runId}]</span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5 tabular-nums font-mono text-[10px]">
                              <span className={r.status === 'unavailable' ? 'text-rose-400' : 'text-cyan-300'}>
                                {r.displayValue}
                              </span>
                              <span
                                className={`rounded px-1 py-0.2 ${
                                  r.score === null
                                    ? 'bg-slate-800 text-slate-400'
                                    : r.score >= 80
                                      ? 'bg-emerald-500/20 text-emerald-300'
                                      : r.score >= 60
                                        ? 'bg-amber-500/20 text-amber-300'
                                        : 'bg-rose-500/20 text-rose-300'
                                }`}
                              >
                                {r.score !== null ? `${r.score.toFixed(1)}分` : 'unavailable'}
                              </span>
                              {r.alarmTriggered && (
                                <span className="rounded bg-rose-500/20 px-1 py-0.2 text-[9px] text-rose-300">
                                  告警
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Card ④: 实时告警阈值 */}
          <div
            id="ind-card-alarm"
            className={`rounded-lg border bg-[#161b22] p-3.5 space-y-2 transition-all duration-300 ${
              highlightedCard === 'ind-card-alarm'
                ? 'border-amber-500 ring-2 ring-amber-500/40 shadow-lg shadow-amber-500/10'
                : 'border-[#30363d]'
            }`}
          >
            <div className="flex items-center justify-between border-b border-[#262c36] pb-2 text-xs">
              <label className="inline-flex items-center gap-2 font-semibold text-amber-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableAlarm}
                  onChange={(e) => setEnableAlarm(e.target.checked)}
                  className="rounded border-[#30363d] bg-[#0f141a]"
                />
                <BellRing className="h-4 w-4" />
                <span>④ 实时告警阈值</span>
              </label>
              <span className="text-[11px] text-[#8b949e]">
                {enableAlarm ? '已开启实测越限监控' : '未开启'}
              </span>
            </div>

            {!enableAlarm ? (
              <p className="text-[11px] text-[#8b949e]">
                未启用实时告警阈值。勾选后可在推演或回测实测值超出安全门限时触发重大/一般告警。
              </p>
            ) : (
              <div className="space-y-2 pt-1 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <div className="sm:col-span-3">
                    <select
                      value={alarmOp}
                      onChange={(e) => setAlarmOp(e.target.value as '>' | '<' | '>=' | '<=')}
                      className="w-full rounded border border-[#30363d] bg-[#0f141a] px-2 py-1 text-slate-100"
                    >
                      <option value=">">实测值 &gt;</option>
                      <option value="<">实测值 &lt;</option>
                      <option value=">=">实测值 &gt;=</option>
                      <option value="<=">实测值 &lt;=</option>
                    </select>
                  </div>
                  <div className="sm:col-span-4">
                    <input
                      type="number"
                      step="any"
                      value={alarmVal}
                      onChange={(e) => setAlarmVal(Number(e.target.value))}
                      className="tabular-nums w-full rounded border border-[#30363d] bg-[#0f141a] px-2 py-1 text-slate-100 font-mono"
                    />
                  </div>
                  <div className="sm:col-span-5">
                    <select
                      value={alarmSeverity}
                      onChange={(e) => setAlarmSeverity(e.target.value as 'major' | 'minor')}
                      className="w-full rounded border border-[#30363d] bg-[#0f141a] px-2 py-1 text-slate-100"
                    >
                      <option value="major">重大告警 (major)</option>
                      <option value="minor">一般预警 (minor)</option>
                    </select>
                  </div>
                </div>
                <input
                  type="text"
                  value={alarmMessageTemplate}
                  onChange={(e) => setAlarmMessageTemplate(e.target.value)}
                  placeholder="自定义触发告警提示文案（留空则按指标名自动生成）"
                  className="w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1 text-xs text-slate-100 placeholder:text-slate-500"
                />
              </div>
            )}
          </div>

          {/* 底部: 三库血缘感知 */}
          <div className="rounded-lg border border-sky-500/30 bg-sky-950/20 p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between text-sky-300 font-semibold">
              <span className="flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5 text-sky-400" />
                <span>三库血缘感知 (Used by Systems)</span>
              </span>
              <span className="rounded bg-sky-500/20 border border-sky-500/40 px-1.5 py-0.5 text-[10px] font-mono text-sky-300">
                {referencingSystems.length > 0 ? `已挂载 ${referencingSystems.length} 处` : '未挂载'}
              </span>
            </div>

            {referencingSystems.length > 0 ? (
              <div className="space-y-1.5 pt-1">
                <p className="text-[11px] text-slate-300">
                  当前指标正被以下评估体系作为评估叶子节点引用（已开启级联删除安全保护）：
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {referencingSystems.map((ref, idx) => (
                    <span
                      key={idx}
                      className="rounded bg-sky-900/40 border border-sky-700/60 px-2 py-0.5 text-[11px] text-sky-200 flex items-center gap-1"
                    >
                      <span className="font-semibold">{ref.systemName}</span>
                      <span className="text-sky-400">›</span>
                      <span>{ref.dimensionName}</span>
                      <span className="rounded bg-sky-800/80 px-1 py-0.2 text-[9px] font-mono text-sky-300 ml-1">
                        权重 {(ref.weight * 100).toFixed(0)}%
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">
                当前指标暂未被任何三库评估体系引用，可在【体系架构】中挂载至对应评估维度。
              </p>
            )}
          </div>
        </form>
      </section>
    </div>
      )}
    </div>
  );
}
