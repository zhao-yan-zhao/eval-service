import type * as echarts from 'echarts';
import {
  AlertTriangle,
  BellRing,
  Download,
  FlaskConical,
  Gauge,
  Layers,
  Link2,
  Plus,
  PlusCircle,
  Save,
  Search,
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
  type IndicatorSystem,
  type MetricAtomMeta,
  type ScoringRule,
  type StoredRunSummary,
} from '../api.ts';
import { applyScoringRule } from '../../core/scoring-functions.ts';
import { EChartPanel } from './EChartPanel.tsx';

interface IndicatorStudioViewProps {
  indicators: IndicatorDefinition[];
  operators: MetricAtomMeta[];
  runs?: StoredRunSummary[];
  selectedRunId?: string;
  focusedIndicatorTarget?: { id: string; nonce: number } | null;
  onRefresh: () => Promise<void>;
}

const DEFAULT_STEPS: Array<{ val: number; score: number }> = [
  { val: 0, score: 0 },
  { val: 50, score: 50 },
  { val: 80, score: 85 },
  { val: 100, score: 100 },
];

function inferUnitForOperator(op: MetricAtomMeta | undefined, atomId: string): string {
  if (op?.unit) return op.unit;
  if (atomId.startsWith('time.')) return 's';
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

export function IndicatorStudioView({
  indicators,
  operators,
  runs = [],
  selectedRunId = '',
  focusedIndicatorTarget = null,
  onRefresh,
}: IndicatorStudioViewProps) {
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
  const [atomRef, setAtomRef] = useState(operators[0]?.id ?? 'time.detect_to_fire_latency');
  const [targetField, setTargetField] = useState('');
  const [unit, setUnit] = useState('');
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

  const selectedOpMeta = useMemo(() => operators.find((o) => o.id === atomRef), [operators, atomRef]);

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
    setAtomRef(def.atomRef);
    setTargetField(def.targetField ?? '');
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
      atomRef,
      targetField: targetField.trim() || undefined,
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
          时效: ['time.'],
          效能: ['eff.', 'effectiveness.'],
          态势: ['sit.', 'situation.'],
          合规: ['comp.', 'compliance.'],
          成本: ['cost.'],
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
                        {mounts.length > 0 && (
                          <span className="shrink-0 rounded bg-sky-500/15 border border-sky-500/30 px-1.5 py-0.5 text-[10px] text-sky-300">
                            挂载 {mounts.length}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-blue-300">
                        {ind.indicatorId} · {ind.atomRef}
                        {ind.targetField ? `#${ind.targetField}` : ''}
                        {ind.unit ? ` [${ind.unit}]` : ''}
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
      <section className="min-w-0 space-y-3.5 lg:col-span-7 panel-isolate">
        <form onSubmit={handleSave} className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
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
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? '保存中…' : '保存为标准自定义指标'}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
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

            <div>
              <label htmlFor="ind-target-field" className="mb-1 block text-[#8b949e]">
                目标输出字段 (targetField，多列输出时指定)
              </label>
              <input
                id="ind-target-field"
                list="target-field-datalist"
                placeholder="默认取标量或首列，如 HitRate, KillHits"
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

            <div>
              <label htmlFor="ind-side" className="mb-1 block text-[#8b949e]">
                阵营切片过滤 (Side，可选)
              </label>
              <input
                id="ind-side"
                placeholder="留空为全量；可填 红方, 蓝方, PLAAF"
                value={filterSide}
                onChange={(e) => setFilterSide(e.target.value)}
                className="w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="ind-rule" className="mb-1 block text-[#8b949e]">
                评分归一化函数
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

            {/* 额外多维切片条件 filterCriteria */}
            <div className="sm:col-span-2 rounded border border-[#262d38] bg-[#0f141a]/70 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-[#8b949e]">
                  多维行筛选条件 (filterCriteria，多列输出按列名精确匹配提取)
                </span>
                <button
                  type="button"
                  onClick={() => setExtraFilters((prev) => [...prev, { key: '', value: '' }])}
                  className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5 text-[11px] text-blue-300 hover:border-blue-500"
                >
                  <Plus className="h-3 w-3" />
                  添加筛选条件
                </button>
              </div>
              {extraFilters.length > 0 && (
                <div className="space-y-1.5">
                  {extraFilters.map((row, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        placeholder="字段名（如 MissionID / WeaponType）"
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
              )}
            </div>

            {ruleType === 'target_range' && (
              <>
                <div>
                  <label htmlFor="ind-opt-lo" className="mb-1 block text-[#8b949e]">
                    最优满分区间下界 (optLo = 100分)
                  </label>
                  <input
                    id="ind-opt-lo"
                    type="number"
                    step="any"
                    required
                    value={optRangeLo}
                    onChange={(e) => setOptRangeLo(Number(e.target.value))}
                    className="tabular-nums w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="ind-opt-hi" className="mb-1 block text-[#8b949e]">
                    最优满分区间上界 (optHi = 100分)
                  </label>
                  <input
                    id="ind-opt-hi"
                    type="number"
                    step="any"
                    required
                    value={optRangeHi}
                    onChange={(e) => setOptRangeHi(Number(e.target.value))}
                    className="tabular-nums w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="ind-tol-lo" className="mb-1 block text-[#8b949e]">
                    容忍下限归零值 (tolLo = 0分)
                  </label>
                  <input
                    id="ind-tol-lo"
                    type="number"
                    step="any"
                    required
                    value={tolRangeLo}
                    onChange={(e) => setTolRangeLo(Number(e.target.value))}
                    className="tabular-nums w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="ind-tol-hi" className="mb-1 block text-[#8b949e]">
                    容忍上限归零值 (tolHi = 0分)
                  </label>
                  <input
                    id="ind-tol-hi"
                    type="number"
                    step="any"
                    required
                    value={tolRangeHi}
                    onChange={(e) => setTolRangeHi(Number(e.target.value))}
                    className="tabular-nums w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100"
                  />
                </div>
              </>
            )}

            {(ruleType === 'smaller_is_better' || ruleType === 'larger_is_better') && (
              <>
                <div>
                  <label htmlFor="ind-opt" className="mb-1 block text-[#8b949e]">
                    最优满分值 (optimal = 100分)
                  </label>
                  <input
                    id="ind-opt"
                    type="number"
                    step="any"
                    required
                    value={optimal}
                    onChange={(e) => setOptimal(Number(e.target.value))}
                    className="tabular-nums w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="ind-wst" className="mb-1 block text-[#8b949e]">
                    最劣归零值 (worst = 0分)
                  </label>
                  <input
                    id="ind-wst"
                    type="number"
                    step="any"
                    required
                    value={worst}
                    onChange={(e) => setWorst(Number(e.target.value))}
                    className="tabular-nums w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100"
                  />
                </div>
              </>
            )}

            {ruleType === 'linear' && (
              <>
                <div>
                  <label htmlFor="ind-lo" className="mb-1 block text-[#8b949e]">
                    0 分边界值 (bounds[0]，可大于上界以反向)
                  </label>
                  <input
                    id="ind-lo"
                    type="number"
                    step="any"
                    required
                    value={boundLo}
                    onChange={(e) => setBoundLo(Number(e.target.value))}
                    className="tabular-nums w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="ind-hi" className="mb-1 block text-[#8b949e]">
                    100 分边界值 (bounds[1])
                  </label>
                  <input
                    id="ind-hi"
                    type="number"
                    step="any"
                    required
                    value={boundHi}
                    onChange={(e) => setBoundHi(Number(e.target.value))}
                    className="tabular-nums w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100"
                  />
                </div>
              </>
            )}

            {ruleType === 'boolean' && (
              <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-end rounded border border-[#262d38] bg-[#0f141a] p-2.5">
                <div>
                  <label htmlFor="ind-bool-true" className="mb-1 block text-[#8b949e]">
                    条件为真 (true / 1) 得分
                  </label>
                  <input
                    id="ind-bool-true"
                    type="number"
                    step="any"
                    min={0}
                    max={100}
                    required
                    value={boolTrueScore}
                    onChange={(e) => setBoolTrueScore(Number(e.target.value))}
                    className="tabular-nums w-full rounded border border-[#30363d] bg-[#161b22] px-2.5 py-1.5 text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="ind-bool-false" className="mb-1 block text-[#8b949e]">
                    条件为假 (false / 0) 得分
                  </label>
                  <input
                    id="ind-bool-false"
                    type="number"
                    step="any"
                    min={0}
                    max={100}
                    required
                    value={boolFalseScore}
                    onChange={(e) => setBoolFalseScore(Number(e.target.value))}
                    className="tabular-nums w-full rounded border border-[#30363d] bg-[#161b22] px-2.5 py-1.5 text-slate-100"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const prevT = boolTrueScore;
                    setBoolTrueScore(boolFalseScore);
                    setBoolFalseScore(prevT);
                  }}
                  className="rounded border border-[#30363d] bg-[#161b22] px-3 py-1.5 text-xs text-blue-300 hover:border-blue-500"
                >
                  正/反向对调 (红线反转)
                </button>
              </div>
            )}

            {ruleType === 'step' && (
              <div className="sm:col-span-2 rounded border border-[#262d38] bg-[#0f141a] p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-slate-200">
                    自定义多档阶梯阈值（按实测值 &ge; 阈值就高落档）
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setStepRows([
                          { val: 0, score: 20 },
                          { val: 0.4, score: 60 },
                          { val: 0.65, score: 85 },
                          { val: 0.85, score: 100 },
                        ])
                      }
                      className="rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500"
                    >
                      正向四档(比率)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setStepRows([
                          { val: 0, score: 100 },
                          { val: 60, score: 85 },
                          { val: 150, score: 60 },
                          { val: 300, score: 0 },
                        ])
                      }
                      className="rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500"
                    >
                      反向四档(耗时)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setStepRows((prev) => [
                          ...prev,
                          { val: (prev[prev.length - 1]?.val ?? 0) + 10, score: 80 },
                        ])
                      }
                      className="inline-flex items-center gap-1 rounded border border-blue-500/40 bg-blue-500/15 px-2 py-0.5 text-[10px] text-blue-300 hover:bg-blue-500/25"
                    >
                      <Plus className="h-3 w-3" />
                      添加档位
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {stepRows.map((row, idx) => (
                    <div key={idx} className="grid grid-cols-12 items-center gap-2">
                      <span className="col-span-2 text-[10px] text-[#8b949e] font-mono">
                        第 {idx + 1} 档
                      </span>
                      <label className="col-span-5 flex items-center gap-1.5 text-[11px] text-[#8b949e]">
                        <span className="shrink-0">&ge;</span>
                        <input
                          type="number"
                          step="any"
                          required
                          value={row.val}
                          onChange={(e) =>
                            setStepRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, val: Number(e.target.value) } : r)),
                            )
                          }
                          className="tabular-nums w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-xs text-slate-100"
                        />
                      </label>
                      <label className="col-span-4 flex items-center gap-1.5 text-[11px] text-[#8b949e]">
                        <span className="shrink-0">得分</span>
                        <input
                          type="number"
                          step="any"
                          min={0}
                          max={100}
                          required
                          value={row.score}
                          onChange={(e) =>
                            setStepRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, score: Number(e.target.value) } : r)),
                            )
                          }
                          className="tabular-nums w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 font-mono text-xs text-emerald-300"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={stepRows.length <= 1}
                        onClick={() => setStepRows((prev) => prev.filter((_, i) => i !== idx))}
                        className="col-span-1 rounded p-1 text-[#8b949e] hover:bg-rose-500/15 hover:text-rose-300 disabled:opacity-30"
                        aria-label="删除阶梯档位"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {scaleWarnings.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-950/25 p-2.5 text-xs text-amber-200 space-y-1">
              {scaleWarnings.map((w, idx) => (
                <div key={idx} className="flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 text-xs">
            <label htmlFor="ind-desc" className="mb-1 block text-[#8b949e]">
              指标口径说明
            </label>
            <textarea
              id="ind-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-100"
            />
          </div>

          {/* 实时告警阈值 */}
          <div className="mt-3 rounded-md border border-amber-500/25 bg-[#0f141a] p-3 text-xs space-y-2">
            <label className="inline-flex items-center gap-2 font-medium text-amber-300">
              <input
                type="checkbox"
                checked={enableAlarm}
                onChange={(e) => setEnableAlarm(e.target.checked)}
              />
              <BellRing className="h-3.5 w-3.5" />
              启用实时告警阈值
            </label>

            {enableAlarm && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={alarmOp}
                    onChange={(e) => setAlarmOp(e.target.value as '>' | '<' | '>=' | '<=')}
                    className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-slate-100"
                  >
                    <option value=">">实测值 &gt;</option>
                    <option value="<">实测值 &lt;</option>
                    <option value=">=">实测值 &gt;=</option>
                    <option value="<=">实测值 &lt;=</option>
                  </select>
                  <input
                    type="number"
                    step="any"
                    value={alarmVal}
                    onChange={(e) => setAlarmVal(Number(e.target.value))}
                    className="tabular-nums rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-slate-100"
                  />
                  <select
                    value={alarmSeverity}
                    onChange={(e) => setAlarmSeverity(e.target.value as 'major' | 'minor')}
                    className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-slate-100"
                  >
                    <option value="major">重大告警 (major)</option>
                    <option value="minor">一般预警 (minor)</option>
                  </select>
                </div>
                <input
                  type="text"
                  value={alarmMessageTemplate}
                  onChange={(e) => setAlarmMessageTemplate(e.target.value)}
                  placeholder="自定义触发告警提示文案（留空则按指标名自动生成）"
                  className="w-full rounded border border-[#30363d] bg-[#161b22] px-2.5 py-1 text-xs text-slate-100 placeholder:text-slate-500"
                />
              </>
            )}
          </div>

          {statusMsg && (
            <p
              className={`mt-3 rounded p-2 text-xs ${
                statusMsg.kind === 'ok'
                  ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  : 'border border-rose-500/40 bg-rose-500/10 text-rose-200'
              }`}
            >
              {statusMsg.text}
            </p>
          )}
        </form>

        <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Gauge className="h-4 w-4 text-emerald-400" />
              <span>评分映射曲线与真实测试数据回测（0–100 分）</span>
            </h4>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={backtesting || !selectedRunId}
                onClick={() => handleRunBacktest('current')}
                className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40"
                title="对全局选定的当前测试场次运行算子并映射得分"
              >
                <FlaskConical className="h-3 w-3" />
                {backtesting ? '回测中…' : '回测当前测试数据'}
              </button>
              <button
                type="button"
                disabled={backtesting || runs.length === 0}
                onClick={() => handleRunBacktest('all')}
                className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1 text-[11px] text-slate-200 hover:border-blue-500 disabled:opacity-40"
                title="对全库所有已导入推演场次运行回测并汇总分布"
              >
                全量场次回测 ({runs.length})
              </button>
            </div>
          </div>

          <EChartPanel option={curveOption} height={220} />

          {/* P1 实时试算与实测值交互条 */}
          <div className="rounded-lg border border-slate-800 bg-[#0c101a] p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">输入推演实测值:</span>
                <input
                  type="number"
                  step="any"
                  value={testInputVal}
                  onChange={(e) => setTestInputVal(e.target.value)}
                  className="tabular-nums w-24 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-emerald-300 focus:border-emerald-500 focus:outline-none"
                  placeholder="如 85"
                />
                <span className="text-slate-500 text-[11px] font-mono">{unit || ''}</span>
              </div>

              {currentScore !== null ? (
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">实时归一化得分:</span>
                  <span className="text-sm font-bold font-mono text-emerald-400">
                    {currentScore.toFixed(1)} <span className="text-[10px] text-slate-400 font-normal">分</span>
                  </span>
                </div>
              ) : (
                <span className="text-slate-500 text-xs italic">无有效数值</span>
              )}
            </div>

            {backtestError && (
              <div className="rounded border border-rose-500/40 bg-rose-950/30 p-2 text-[11px] text-rose-300">
                回测失败：{backtestError}
              </div>
            )}

            {backtestSummary && (
              <div className="mt-2 space-y-2 border-t border-slate-800 pt-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2 text-slate-300 tabular-nums">
                    <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-blue-300">
                      有效样本 {backtestSummary.validCount}/{backtestSummary.totalRuns}
                    </span>
                    {backtestSummary.minValue !== null && (
                      <span>
                        实测范围: <strong className="text-slate-100">{backtestSummary.minValue} ~ {backtestSummary.maxValue}</strong> (均值 {backtestSummary.avgValue})
                      </span>
                    )}
                    {backtestSummary.avgScore !== null && (
                      <span>
                        均分: <strong className="text-emerald-300">{backtestSummary.avgScore}</strong>
                      </span>
                    )}
                  </div>
                  {backtestSummary.validCount >= 1 &&
                    ruleType !== 'step' &&
                    ruleType !== 'boolean' && (
                      <button
                        type="button"
                        onClick={handleCalibrateFromBacktest}
                        className="inline-flex items-center gap-1 rounded border border-purple-500/40 bg-purple-500/15 px-2 py-0.5 text-[10px] text-purple-200 hover:bg-purple-500/25"
                        title="按当前回测极值自动推荐填充评分阈值"
                      >
                        <Sparkles className="h-3 w-3" />
                        按实测极值推荐门限
                      </button>
                    )}
                </div>

                <div className="max-h-36 overflow-y-auto space-y-1">
                  {backtestResults.map((r) => (
                    <button
                      key={r.runId}
                      type="button"
                      onClick={() => {
                        if (typeof r.numericValue === 'number') {
                          setTestInputVal(String(Number(r.numericValue.toFixed(3))));
                        }
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded border border-[#262d38] bg-[#161b22] px-2.5 py-1.5 text-left text-[11px] hover:border-blue-500/60 transition"
                    >
                      <div className="min-w-0 flex-1 truncate text-slate-200">
                        <span className="font-medium">{r.scenarioName}</span>
                        <span className="ml-1.5 font-mono text-[10px] text-[#8b949e]">[{r.runId}]</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 tabular-nums font-mono">
                        <span
                          className={
                            r.status === 'unavailable' ? 'text-rose-400' : 'text-cyan-300'
                          }
                          title={r.missingDataReason}
                        >
                          {r.displayValue}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
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
                          <span className="rounded bg-rose-500/20 px-1 py-0.5 text-[9px] text-rose-300">
                            告警
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[11px] text-slate-400 leading-relaxed">
              💡 <strong>实测联动点高亮</strong>：点击上方「回测当前测试数据 / 全量场次回测」或手动输入测定值，即可在曲线图上实时定位得分点并一键反推门限。
            </p>
          </div>

          {/* P2 三库血缘感知卡片 */}
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
                💡 当前指标暂未被任何三库评估体系引用，可在【三库设计器】中自由挂载或在流水线中一键发布。
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
