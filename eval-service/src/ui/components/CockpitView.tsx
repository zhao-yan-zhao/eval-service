import MarkdownIt from 'markdown-it';
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  FileText,
  GitCompare,
  Layers,
  Play,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EvaluationDagOutput, EvaluationSystemDag } from '../../core/types.ts';
import {
  evalApi,
  type StoredRunSummary,
  type StoredV4EvalRecord,
  type StoredV4EvalSummary,
} from '../api.ts';
import { UnifiedAssetSelector, type UnifiedAssetOption } from './v4/UnifiedAssetSelector.tsx';
import { CockpitChartsSection } from './cockpit/CockpitChartsSection.tsx';
import { CockpitMcdaDrawer } from './cockpit/CockpitMcdaDrawer.tsx';
import { CockpitMetricTablesTab } from './cockpit/CockpitMetricTablesTab.tsx';
import {
  DYNAMIC_SIDE_COLORS,
  buildHierarchyDetailRows,
  collectV4EvidenceItems,
  extractLeafDiagnosticPoints,
  extractPrimaryDimensions,
  formatMetricObjectiveValue,
  generateV4ReportMarkdown,
  type V4EvidenceRow,
} from './cockpit/cockpit-v4-helpers.ts';

const mdParser = new MarkdownIt({ html: false, linkify: true, breaks: true });

interface CockpitViewProps {
  runs: StoredRunSummary[];
  selectedRunId: string;
  activeSourceId?: string;
  onSelectRun: (runId: string) => void;
  onOpenV4SystemCanvas?: () => void;
  onNavigateToTab?: (tab: 'operators' | 'indicators' | 'systems', targetId?: string) => void;
}

type ReviewTabKey = 'hierarchy' | 'metrics' | 'gates' | 'evidence' | 'report';

function verdictBadgeClass(verdict?: string): string {
  if (verdict === 'DISQUALIFIED') {
    return 'border-rose-500/60 bg-rose-500/20 text-rose-200';
  }
  if (verdict === 'WARNING') {
    return 'border-amber-500/55 bg-amber-500/20 text-amber-200';
  }
  return 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300';
}

export function CockpitView({
  runs,
  selectedRunId,
  activeSourceId,
  onSelectRun,
  onOpenV4SystemCanvas,
  onNavigateToTab,
}: CockpitViewProps) {
  const [v4Systems, setV4Systems] = useState<EvaluationSystemDag[]>([]);
  const [selectedSystemId, setSelectedSystemId] = useState<string>('sys_v4_metrics_guide_full');
  const [historyList, setHistoryList] = useState<StoredV4EvalSummary[]>([]);
  const [activeRecord, setActiveRecord] = useState<StoredV4EvalRecord | null>(null);
  const [focusSide, setFocusSide] = useState<string>('ALL');

  const [evaluating, setEvaluating] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mcdaOpen, setMcdaOpen] = useState(false);
  const [reviewTab, setReviewTab] = useState<ReviewTabKey>('hierarchy');
  const [selectedMetricId, setSelectedMetricId] = useState<string | null>(null);
  const [collapsedRowKeys, setCollapsedRowKeys] = useState<Set<string>>(new Set());
  const [evidenceSideFilter, setEvidenceSideFilter] = useState<string>('ALL');
  const [evidenceQuery, setEvidenceQuery] = useState<string>('');
  const [selectedEvidence, setSelectedEvidence] = useState<V4EvidenceRow | null>(null);

  const evidenceDialogRef = useRef<HTMLDialogElement | null>(null);
  const evalSeqRef = useRef<number>(0);

  // 加载全部 V4 评估体系
  const loadV4Systems = useCallback(async () => {
    try {
      const res = await evalApi.listV4SystemDags();
      const list = Array.isArray(res.systems) ? res.systems : [];
      setV4Systems(list);
      if (list.length > 0) {
        const preferred =
          list.find((s) => s.systemId === 'sys_v4_metrics_guide_full') ?? list[0];
        setSelectedSystemId((prev) =>
          list.some((s) => s.systemId === prev) ? prev : preferred.systemId,
        );
      }
      return list;
    } catch {
      return [] as EvaluationSystemDag[];
    }
  }, []);

  const activeSystemDag = useMemo(
    () =>
      v4Systems.find((s) => s.systemId === (activeRecord?.systemId || selectedSystemId)) ??
      v4Systems[0] ??
      null,
    [v4Systems, activeRecord?.systemId, selectedSystemId],
  );

  const systemSelectorOptions = useMemo<UnifiedAssetOption[]>(
    () =>
      v4Systems.map((s) => ({
        id: s.systemId,
        label: s.name || s.systemId,
        subLabel: s.systemId,
        group: s.builtin ? '内置评估体系' : '自定义体系',
        badge: `v${s.version || '1.0.0'}`,
        badgeTone: s.builtin ? 'indigo' : 'cyan',
      })),
    [v4Systems],
  );

  const runCompareSides = useCallback(
    async (sysId: string, runId: string, systemObj?: EvaluationSystemDag) => {
      if (!sysId || !runId) return;
      const seq = ++evalSeqRef.current;
      setEvaluating(true);
      setErrorMsg(null);
      try {
        const res = await evalApi.compareV4SystemSides(sysId, {
          runId,
          dataSourceId: activeSourceId && activeSourceId === runId ? activeSourceId : undefined,
          persist: true,
        });
        if (evalSeqRef.current !== seq) return;
        const record: StoredV4EvalRecord = {
          evalId: res.evalId || `v4eval_${Date.now()}`,
          runId: res.runId || runId,
          dataSourceId: activeSourceId || undefined,
          systemId: res.systemId || sysId,
          systemName: res.systemName || systemObj?.name || sysId,
          systemVersion: res.systemVersion || systemObj?.version || '1.0.0',
          metricGraphId: res.metricGraphId,
          sides: res.sides ?? [],
          overallScore: res.overall?.overallScore ?? null,
          gateVerdict: res.overall?.gateVerdict ?? 'PASS',
          availableWeightRatio: res.overall?.availableWeightRatio ?? 0,
          sideSummaries: res.sideSummaries ?? [],
          overall: res.overall,
          bySide: res.bySide ?? {},
          ...(res.metricSnapshots ? { metricSnapshots: res.metricSnapshots } : {}),
          createdAt: res.createdAt || new Date().toISOString(),
        };
        setActiveRecord(record);
        setFocusSide('ALL');
        // 刷新该样本的持久化历史列表
        const histRes = await evalApi.listV4Evaluations(runId, 20).catch(() => null);
        if (evalSeqRef.current === seq && histRes?.evaluations) {
          setHistoryList(histRes.evaluations);
        }
      } catch (err) {
        if (evalSeqRef.current === seq) {
          setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (evalSeqRef.current === seq) {
          setEvaluating(false);
        }
      }
    },
    [activeSourceId],
  );

  // 初始化或切换推演样本时：优先恢复该样本最新已落库 V4 评估；若暂无记录则自动跑一次
  useEffect(() => {
    let cancelled = false;
    evalSeqRef.current += 1;
    setEvaluating(false);
    const bootstrap = async () => {
      const systems = v4Systems.length > 0 ? v4Systems : await loadV4Systems();
      if (cancelled || !selectedRunId) return;

      setLoadingHistory(true);
      setErrorMsg(null);
      try {
        const histRes = await evalApi.listV4Evaluations(selectedRunId, 20);
        if (cancelled) return;
        const list = histRes.evaluations ?? [];
        setHistoryList(list);

        if (list.length > 0) {
          const detailRes = await evalApi.getV4Evaluation(list[0].evalId);
          if (!cancelled && detailRes.evaluation) {
            setActiveRecord(detailRes.evaluation);
            setSelectedSystemId(detailRes.evaluation.systemId);
            setFocusSide('ALL');
            return;
          }
        }

        // 无历史记录时：对中小规模样本自动评估，超大规模样本提示手动触发
        const currentRun = runs.find((r) => r.runId === selectedRunId);
        if (currentRun && currentRun.unitCount > 200) {
          setActiveRecord(null);
          return;
        }
        const defaultSys =
          systems.find((s) => s.systemId === selectedSystemId) ??
          systems.find((s) => s.systemId === 'sys_v4_metrics_guide_full') ??
          systems[0];
        if (!cancelled && defaultSys) {
          await runCompareSides(defaultSys.systemId, selectedRunId, defaultSys);
        }
      } catch {
        // 静默兜底，允许用户手动点运行
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
      evalSeqRef.current += 1;
    };
  }, [selectedRunId]);

  const handleSelectHistory = async (evalId: string) => {
    try {
      const res = await evalApi.getV4Evaluation(evalId);
      if (res.evaluation) {
        setActiveRecord(res.evaluation);
        setSelectedSystemId(res.evaluation.systemId);
        setFocusSide('ALL');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteHistory = async (evalId: string) => {
    try {
      await evalApi.deleteV4Evaluation(evalId);
      const next = historyList.filter((h) => h.evalId !== evalId);
      setHistoryList(next);
      if (activeRecord?.evalId === evalId) {
        if (next.length > 0) {
          await handleSelectHistory(next[0].evalId);
        } else {
          setActiveRecord(null);
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // 打开原生证据弹窗
  useEffect(() => {
    const dlg = evidenceDialogRef.current;
    if (!dlg) return;
    if (selectedEvidence && !dlg.open) {
      dlg.showModal();
    } else if (!selectedEvidence && dlg.open) {
      dlg.close();
    }
  }, [selectedEvidence]);

  const sides = activeRecord?.sides ?? [];
  const overall = activeRecord?.overall ?? null;
  const bySide = activeRecord?.bySide ?? {};
  const metricSnapshots = activeRecord?.metricSnapshots ?? [];

  const activeFocusedEval: EvaluationDagOutput | null = useMemo(() => {
    if (!activeRecord) return null;
    if (focusSide !== 'ALL' && bySide[focusSide]) return bySide[focusSide];
    return overall;
  }, [activeRecord, focusSide, bySide, overall]);

  const dimensions = useMemo(
    () => extractPrimaryDimensions(activeSystemDag, overall, bySide, sides),
    [activeSystemDag, overall, bySide, sides],
  );

  const leafPoints = useMemo(
    () => extractLeafDiagnosticPoints(activeSystemDag, overall, bySide, sides, focusSide),
    [activeSystemDag, overall, bySide, sides, focusSide],
  );

  const hierarchyRows = useMemo(
    () => buildHierarchyDetailRows(activeSystemDag, overall, bySide, sides, metricSnapshots),
    [activeSystemDag, overall, bySide, sides, metricSnapshots],
  );

  const visibleHierarchyRows = useMemo(() => {
    const collapsedPrefixes: string[] = [];
    for (const key of collapsedRowKeys) {
      collapsedPrefixes.push(`${key}::`);
    }
    return hierarchyRows.filter(
      (r) => !collapsedPrefixes.some((prefix) => r.rowKey.startsWith(prefix)),
    );
  }, [hierarchyRows, collapsedRowKeys]);

  const evidenceItems = useMemo(
    () => collectV4EvidenceItems(overall, bySide, sides),
    [overall, bySide, sides],
  );

  const filteredEvidenceItems = useMemo(() => {
    const q = evidenceQuery.trim().toLowerCase();
    return evidenceItems.filter((item) => {
      if (evidenceSideFilter !== 'ALL' && item.side !== evidenceSideFilter) return false;
      if (!q) return true;
      return (
        item.nodeLabel.toLowerCase().includes(q) ||
        item.source.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        String(item.ref).toLowerCase().includes(q)
      );
    });
  }, [evidenceItems, evidenceSideFilter, evidenceQuery]);

  const reportMarkdown = useMemo(() => {
    if (!activeRecord) return '';
    return generateV4ReportMarkdown(activeRecord, activeSystemDag);
  }, [activeRecord, activeSystemDag]);

  const reportHtml = useMemo(
    () => (reportMarkdown ? mdParser.render(reportMarkdown) : ''),
    [reportMarkdown],
  );

  // 执行摘要统计（最强/最弱维度、红线数、缺数节点数）
  const executiveInsights = useMemo(() => {
    const scoredDims = dimensions
      .map((d) => ({
        label: d.label,
        score:
          focusSide !== 'ALL' && sides.length > 0
            ? d.bySideScores[focusSide]
            : d.overallScore,
      }))
      .filter((d): d is { label: string; score: number } => d.score !== null && Number.isFinite(d.score))
      .sort((a, b) => b.score - a.score);

    const strongest = scoredDims[0] ?? null;
    const weakest = scoredDims.length > 0 ? scoredDims[scoredDims.length - 1] : null;

    const gates = activeFocusedEval?.gateAudit ?? [];
    const violatedGates = gates.filter((g) => g.gateStatus === 'violated');
    const allNodes = Object.values(activeFocusedEval?.nodeResults ?? {});
    const unavailNodes = allNodes.filter((n) => n.status === 'unavailable');

    return {
      strongest,
      weakest,
      totalGates: gates.length,
      violatedGateCount: violatedGates.length,
      totalNodeCount: allNodes.length,
      validNodeCount: allNodes.length - unavailNodes.length,
      unavailNodes,
    };
  }, [dimensions, focusSide, sides.length, activeFocusedEval]);

  const handleExportMd = () => {
    if (!reportMarkdown || !activeRecord) return;
    const blob = new Blob([reportMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eval-report-${activeRecord.systemId}-${activeRecord.runId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    if (!activeRecord) return;
    const blob = new Blob([JSON.stringify(activeRecord, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eval-snapshot-${activeRecord.systemId}-${activeRecord.runId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3.5 text-slate-100">
      {/* ════════════════════ 第 1 层：单行统一控制台 + 历史评估切换条 ════════════════════ */}
      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* 推演样本 */}
            <label className="flex items-center gap-1.5 text-xs">
              <span className="text-[11px] font-medium text-slate-400">推演样本:</span>
              <select
                aria-label="选择推演样本"
                value={selectedRunId}
                onChange={(e) => onSelectRun(e.target.value)}
                className="h-8 max-w-[230px] rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none cursor-pointer"
              >
                {runs.map((r) => (
                  <option key={r.runId} value={r.runId}>
                    {r.scenarioName || r.runId}
                  </option>
                ))}
              </select>
            </label>

            {/* V4 评估体系下拉选择器 */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-slate-400">评估体系:</span>
              <UnifiedAssetSelector
                value={selectedSystemId}
                options={systemSelectorOptions}
                placeholder="选择评估体系..."
                searchPlaceholder="搜索体系名称或 ID..."
                accent="indigo"
                onChange={(sysId) => {
                  setSelectedSystemId(sysId);
                  const sysObj = v4Systems.find((s) => s.systemId === sysId);
                  if (selectedRunId) {
                    void runCompareSides(sysId, selectedRunId, sysObj);
                  }
                }}
              />
            </div>

            {/* 动态阵营切片胶囊 */}
            {sides.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[#30363d] bg-[#0d1117] p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setFocusSide('ALL')}
                  className={`rounded-md px-2 py-1 transition cursor-pointer ${
                    focusSide === 'ALL'
                      ? 'bg-indigo-600/35 font-semibold text-indigo-200'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  全部阵营 ({sides.length})
                </button>
                {sides.map((side) => (
                  <button
                    key={`pill-${side}`}
                    type="button"
                    onClick={() => setFocusSide(side)}
                    className={`rounded-md px-2 py-1 transition cursor-pointer ${
                      focusSide === side
                        ? 'bg-cyan-600/30 font-semibold text-cyan-200'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {side}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={evaluating || !selectedRunId || !selectedSystemId}
              onClick={() => {
                const sysObj = v4Systems.find((s) => s.systemId === selectedSystemId);
                void runCompareSides(selectedSystemId, selectedRunId, sysObj);
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 transition cursor-pointer"
            >
              {evaluating ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
              <span>{evaluating ? '评估中...' : '运行评估'}</span>
            </button>

            <button
              type="button"
              onClick={() => setMcdaOpen((prev) => !prev)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition cursor-pointer ${
                mcdaOpen
                  ? 'border-cyan-500/60 bg-cyan-500/20 text-cyan-200'
                  : 'border-[#30363d] bg-[#0d1117] text-slate-200 hover:border-cyan-500/50'
              }`}
            >
              <GitCompare className="h-3.5 w-3.5 text-cyan-400" />
              <span>多方案优选</span>
            </button>

            <button
              type="button"
              disabled={!activeRecord}
              onClick={handleExportMd}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40 transition cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-slate-400" />
              <span>导出简报</span>
            </button>

            {onOpenV4SystemCanvas && (
              <button
                type="button"
                onClick={onOpenV4SystemCanvas}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/10 px-2.5 text-xs font-medium text-indigo-300 hover:bg-indigo-500/20 transition cursor-pointer"
              >
                <span>评估体系</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 历史评估记录条 */}
        {historyList.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-[#30363d]/70 pt-2 text-[11px]">
            <span className="text-slate-400">已存评估：</span>
            {historyList.slice(0, 6).map((item) => {
              const isActive = activeRecord?.evalId === item.evalId;
              return (
                <div
                  key={item.evalId}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 transition ${
                    isActive
                      ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200'
                      : 'border-[#30363d] bg-[#0d1117] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void handleSelectHistory(item.evalId)}
                    className="inline-flex items-center gap-1.5 cursor-pointer"
                    title={`${item.systemName} · ${item.createdAt}`}
                  >
                    <span className="max-w-[160px] truncate">{item.systemName}</span>
                    <span className="font-mono text-[10px] text-cyan-300">
                      {item.overallScore !== null ? `${item.overallScore.toFixed(1)}分` : '缺数'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteHistory(item.evalId)}
                    title="删除该条历史评估记录"
                    className="ml-0.5 rounded p-0.5 text-slate-500 hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {errorMsg && (
        <div className="flex items-center justify-between rounded-lg border border-rose-500/50 bg-rose-950/50 px-3.5 py-2 text-xs text-rose-200">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-rose-300 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 按需展开：多方案 MCDA 横向优选 */}
      {mcdaOpen && (
        <CockpitMcdaDrawer
          runs={runs}
          systemId={selectedSystemId}
          systemDag={activeSystemDag}
          activeRecord={activeRecord}
          availableSides={sides}
          onClose={() => setMcdaOpen(false)}
        />
      )}

      {(() => {
        const selectedRunMeta = runs.find((r) => r.runId === selectedRunId);
        if (
          !activeRecord &&
          !evaluating &&
          !loadingHistory &&
          selectedRunMeta &&
          selectedRunMeta.unitCount > 200
        ) {
          return (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                <span>
                  当前样本规模较大（{selectedRunMeta.unitCount} 个单元），已跳过首屏自动计算；请点击「运行评估」执行并自动缓存结果。
                </span>
              </div>
            </div>
          );
        }
        return null;
      })()}

      {/* ════════════════════ 第 2 层：核心战果与红线决策带 ════════════════════ */}
      <section className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
        {/* 左侧：动态阵营综合计分卡 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 lg:col-span-8">
          {sides.length > 0 ? (
            sides.map((side, idx) => {
              const sEval = bySide[side];
              const isSelected = focusSide === side;
              const colorHex = DYNAMIC_SIDE_COLORS[idx % DYNAMIC_SIDE_COLORS.length];
              const score = sEval?.overallScore ?? null;
              const rawScore = sEval?.rawOverallScore ?? null;
              const isCapped =
                sEval?.gateVerdict === 'DISQUALIFIED' &&
                rawScore !== null &&
                score !== null &&
                rawScore > score + 0.05;

              return (
                <button
                  key={`kpi-${side}`}
                  type="button"
                  onClick={() => setFocusSide((prev) => (prev === side ? 'ALL' : side))}
                  title="点击切换焦点阵营视图"
                  className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition cursor-pointer ${
                    isSelected
                      ? 'border-cyan-400 bg-cyan-950/25 ring-1 ring-cyan-400/50'
                      : 'border-[#30363d] bg-[#161b22] hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: colorHex }}
                      />
                      <span className="text-xs font-semibold text-slate-100">{side}</span>
                    </div>
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${verdictBadgeClass(sEval?.gateVerdict)}`}
                    >
                      {sEval?.gateVerdict ?? 'PASS'}
                    </span>
                  </div>

                  <div className="mt-2.5 flex items-baseline gap-2">
                    <span className="font-mono text-2xl font-bold tabular-nums text-white">
                      {score !== null ? score.toFixed(1) : '--'}
                    </span>
                    <span className="text-xs text-slate-500">/ 100</span>
                    {isCapped && (
                      <span className="ml-auto font-mono text-[10px] text-rose-300">
                        原始 {rawScore!.toFixed(1)}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                    <span>权重覆盖</span>
                    <span className="font-mono tabular-nums text-slate-300">
                      {sEval ? `${(sEval.availableWeightRatio * 100).toFixed(0)}%` : '--'}
                    </span>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="sm:col-span-2 xl:col-span-3 flex flex-col justify-between rounded-xl border border-[#30363d] bg-[#161b22] p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scale className="h-4 w-4 text-indigo-400" />
                  <span className="text-xs font-semibold text-slate-100">
                    {activeRecord?.systemName || '综合效能评估'}
                  </span>
                </div>
                <span
                  className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${verdictBadgeClass(overall?.gateVerdict)}`}
                >
                  {overall?.gateVerdict ?? (evaluating || loadingHistory ? '计算中' : '待评估')}
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-mono text-3xl font-bold tabular-nums text-white">
                  {overall?.overallScore !== null && overall?.overallScore !== undefined
                    ? overall.overallScore.toFixed(1)
                    : '--'}
                </span>
                <span className="text-xs text-slate-500">/ 100</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400">
                权重覆盖率：{overall ? `${(overall.availableWeightRatio * 100).toFixed(0)}%` : '--'}
              </div>
            </div>
          )}
        </div>

        {/* 右侧：关键洞察摘要卡 */}
        <div className="flex flex-col justify-between rounded-xl border border-[#30363d] bg-[#161b22] p-3.5 lg:col-span-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-100">关键诊断摘要</span>
            <span className="font-mono text-[10px] text-slate-400">
              {focusSide === 'ALL' ? '综合口径' : `${focusSide}口径`}
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-[#30363d]/70 bg-[#0d1117] px-2.5 py-1.5">
              <span className="text-slate-400">优势 / 短板维度</span>
              <span className="truncate font-medium text-slate-200">
                {executiveInsights.strongest
                  ? `${executiveInsights.strongest.label} (${executiveInsights.strongest.score.toFixed(0)}) / ${executiveInsights.weakest?.label ?? '--'} (${executiveInsights.weakest?.score.toFixed(0) ?? '--'})`
                  : '--'}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg border border-[#30363d]/70 bg-[#0d1117] px-2.5 py-1.5">
              <span className="text-slate-400">安全门控审计</span>
              <span
                className={`font-mono font-semibold ${
                  executiveInsights.violatedGateCount > 0 ? 'text-rose-300' : 'text-emerald-300'
                }`}
              >
                {executiveInsights.totalGates === 0
                  ? '无门控触发'
                  : executiveInsights.violatedGateCount > 0
                    ? `${executiveInsights.violatedGateCount} / ${executiveInsights.totalGates} 项触发告警`
                    : `${executiveInsights.totalGates} 项全部通过`}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg border border-[#30363d]/70 bg-[#0d1117] px-2.5 py-1.5">
              <span className="text-slate-400">实证节点完整度</span>
              <span className="font-mono text-slate-200">
                {executiveInsights.totalNodeCount > 0
                  ? `${executiveInsights.validNodeCount} / ${executiveInsights.totalNodeCount} 有效${
                      executiveInsights.unavailNodes.length > 0
                        ? ` (${executiveInsights.unavailNodes.length} 项缺数)`
                        : ''
                    }`
                  : '--'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════ 第 3 层：多维可视化双栏分析区 ════════════════════ */}
      <CockpitChartsSection
        overall={overall}
        sides={sides}
        focusSide={focusSide}
        dimensions={dimensions}
        leafPoints={leafPoints}
      />

      {/* ════════════════════ 第 4 层：深度复盘 4 页签区 ════════════════════ */}
      <section className="overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22]">
        <div
          role="tablist"
          aria-label="评估深度复盘页签"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-[#30363d] bg-[#0d1117] px-3.5 py-2"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { key: 'hierarchy', label: `层次得分明细 (${hierarchyRows.length})` },
                { key: 'metrics', label: `体系指标明细 (${metricSnapshots.length})` },
                {
                  key: 'gates',
                  label: `门控与缺数审计 (${executiveInsights.totalGates + executiveInsights.unavailNodes.length})`,
                },
                { key: 'evidence', label: `物理证据溯源 (${evidenceItems.length})` },
                { key: 'report', label: '评估简报与导出' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={reviewTab === tab.key}
                onClick={() => setReviewTab(tab.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                  reviewTab === tab.key
                    ? 'bg-indigo-600/25 text-indigo-200 border border-indigo-500/50'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {reviewTab === 'report' && activeRecord && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportMd}
                className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#161b22] px-2.5 py-1 text-[11px] text-slate-200 hover:border-cyan-500/50 cursor-pointer"
              >
                <FileText className="h-3 w-3 text-cyan-400" />
                <span>导出 Markdown</span>
              </button>
              <button
                type="button"
                onClick={handleExportJson}
                className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#161b22] px-2.5 py-1 text-[11px] text-slate-200 hover:border-indigo-500/50 cursor-pointer"
              >
                <Database className="h-3 w-3 text-indigo-400" />
                <span>导出 JSON 快照</span>
              </button>
            </div>
          )}
        </div>

        <div className="max-h-[420px] min-h-[220px] overflow-auto">
          {reviewTab === 'hierarchy' && (
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-[#30363d] bg-[#0d1117] text-[11px] text-slate-400">
                <tr>
                  <th className="px-3.5 py-2 font-medium">节点名称</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">权重</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">状态</th>
                  {sides.length > 0 ? (
                    sides.map((side) => (
                      <th
                        key={`th-h-${side}`}
                        className="px-3 py-2 font-medium whitespace-nowrap text-right"
                      >
                        {side}
                      </th>
                    ))
                  ) : (
                    <th className="px-3 py-2 font-medium whitespace-nowrap text-right">得分</th>
                  )}
                  <th className="px-3 py-2 font-medium whitespace-nowrap text-right">下钻</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]/60">
                {visibleHierarchyRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4 + Math.max(1, sides.length)}
                      className="px-4 py-10 text-center text-xs text-slate-500"
                    >
                      暂无评估明细，请先选择推演样本与评估体系并运行评估
                    </td>
                  </tr>
                ) : (
                  visibleHierarchyRows.map((row) => {
                    const isCollapsed = collapsedRowKeys.has(row.rowKey);
                    return (
                      <tr key={row.rowKey} className="hover:bg-[#1b2230]/70">
                        <td className="px-3.5 py-2">
                          <div
                            className="flex items-center gap-1.5"
                            style={{ paddingLeft: `${row.depth * 18}px` }}
                          >
                            {row.hasChildren ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setCollapsedRowKeys((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(row.rowKey)) next.delete(row.rowKey);
                                    else next.add(row.rowKey);
                                    return next;
                                  })
                                }
                                className="rounded p-0.5 text-slate-400 hover:text-white cursor-pointer"
                              >
                                {isCollapsed ? (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                )}
                              </button>
                            ) : (
                              <span className="inline-block w-4 text-center text-slate-600">•</span>
                            )}
                            <span
                              className={
                                row.kind === 'terminal'
                                  ? 'font-semibold text-indigo-200'
                                  : row.kind === 'dimension'
                                    ? 'font-medium text-slate-100'
                                    : row.kind === 'gate'
                                      ? 'font-medium text-rose-200'
                                      : 'text-slate-300'
                              }
                            >
                              {row.label}
                            </span>
                            {row.metricId && (
                              <span className="font-mono text-[10px] text-slate-500">
                                ({row.metricId})
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-slate-400 tabular-nums whitespace-nowrap">
                          {row.kind === 'metric_proxy' ? (
                            <span className="inline-flex rounded border border-cyan-500/35 bg-cyan-500/10 px-1.5 py-0.5 font-sans text-[10px] text-cyan-300">
                              客观指标
                            </span>
                          ) : row.weight !== null ? (
                            `${(row.weight * 100).toFixed(1)}%`
                          ) : (
                            '--'
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span
                            title={row.missingDataReason}
                            className={`inline-flex rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                              row.status === 'unavailable'
                                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                                : row.gateStatus === 'violated'
                                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                                  : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                            }`}
                          >
                            {row.status === 'unavailable'
                              ? '缺数'
                              : row.gateStatus === 'violated'
                                ? '告警'
                                : '正常'}
                          </span>
                        </td>
                        {sides.length > 0 ? (
                          sides.map((side) => {
                            if (row.kind === 'metric_proxy') {
                              const rawVal = row.bySideRawValues?.[side];
                              const rowCount = row.bySideRowCounts?.[side] ?? 0;
                              return (
                                <td
                                  key={`${row.rowKey}-${side}`}
                                  className="px-3 py-2 text-right font-mono tabular-nums text-cyan-200 whitespace-nowrap"
                                >
                                  {rawVal !== null && rawVal !== undefined ? (
                                    <span className="inline-flex items-center gap-1">
                                      <span>{formatMetricObjectiveValue(rawVal, row.targetField)}</span>
                                      {rowCount > 0 && (
                                        <span className="text-[10px] text-slate-400">· {rowCount}行</span>
                                      )}
                                    </span>
                                  ) : rowCount > 0 ? (
                                    <span className="text-[11px] text-cyan-300">{rowCount} 行表</span>
                                  ) : (
                                    <span className="text-slate-500">--</span>
                                  )}
                                </td>
                              );
                            }
                            const val = row.bySideScores[side];
                            return (
                              <td
                                key={`${row.rowKey}-${side}`}
                                className="px-3 py-2 text-right font-mono tabular-nums text-slate-200 whitespace-nowrap"
                              >
                                {val !== null && val !== undefined ? val.toFixed(1) : '--'}
                              </td>
                            );
                          })
                        ) : (
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                            {row.kind === 'metric_proxy' ? (
                              row.overallRaw !== null && row.overallRaw !== undefined ? (
                                <span className="inline-flex items-center gap-1 text-cyan-200">
                                  <span>{formatMetricObjectiveValue(row.overallRaw, row.targetField)}</span>
                                  {(row.overallRowCount ?? 0) > 0 && (
                                    <span className="text-[10px] text-slate-400">
                                      · {row.overallRowCount}行
                                    </span>
                                  )}
                                </span>
                              ) : (row.overallRowCount ?? 0) > 0 ? (
                                <span className="text-[11px] text-cyan-300">{row.overallRowCount} 行表</span>
                              ) : (
                                <span className="text-slate-500">--</span>
                              )
                            ) : row.overallScore !== null ? (
                              row.overallScore.toFixed(1)
                            ) : (
                              '--'
                            )}
                          </td>
                        )}
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {row.kind === 'metric_proxy' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedMetricId(row.metricId || row.nodeId);
                                  setReviewTab('metrics');
                                }}
                                className="inline-flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/20 cursor-pointer"
                              >
                                <span>明细表</span>
                              </button>
                            )}
                            {row.metricId && onNavigateToTab ? (
                              <button
                                type="button"
                                onClick={() => onNavigateToTab('indicators', row.metricId)}
                                className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-500/20 cursor-pointer"
                              >
                                <Layers className="h-3 w-3" />
                                <span>指标库</span>
                              </button>
                            ) : onOpenV4SystemCanvas ? (
                              <button
                                type="button"
                                onClick={onOpenV4SystemCanvas}
                                className="inline-flex items-center gap-1 rounded border border-indigo-500/40 bg-indigo-500/10 px-2 py-0.5 text-[10px] text-indigo-200 hover:bg-indigo-500/20 cursor-pointer"
                              >
                                <span>体系画布</span>
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {reviewTab === 'metrics' && (
            <CockpitMetricTablesTab
              snapshots={metricSnapshots}
              sides={sides}
              focusSide={focusSide}
              selectedMetricId={selectedMetricId}
              onSelectMetricId={setSelectedMetricId}
            />
          )}

          {reviewTab === 'gates' && (
            <div className="space-y-4 p-3.5">
              <div>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  <span>安全红线门控审计</span>
                </h4>
                {(activeFocusedEval?.gateAudit ?? []).length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[#30363d] p-4 text-center text-xs text-slate-500">
                    当前体系未触发或未配置门控审计项
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {(activeFocusedEval?.gateAudit ?? []).map((g) => (
                      <div
                        key={g.atomId}
                        className="flex items-center justify-between rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-xs"
                      >
                        <div>
                          <div className="font-medium text-slate-100">{g.name}</div>
                          <div className="font-mono text-[10px] text-slate-500">
                            {g.gateMode === 'hard' ? '硬门控' : '软门控'} · 实测 {g.displayValue}
                          </div>
                        </div>
                        <span
                          className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                            g.gateStatus === 'violated'
                              ? 'border-rose-500/50 bg-rose-500/20 text-rose-200'
                              : g.gateStatus === 'pass'
                                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                : 'border-slate-700 bg-slate-800 text-slate-300'
                          }`}
                        >
                          {g.gateStatus}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  <span>数据缺失诊断（共 {executiveInsights.unavailNodes.length} 项）</span>
                </h4>
                {executiveInsights.unavailNodes.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[#30363d] p-4 text-center text-xs text-emerald-300/80">
                    所有实证节点数据完整，无缺数项
                  </div>
                ) : (
                  <table className="w-full border-collapse rounded-lg border border-[#30363d] text-left text-xs">
                    <thead className="border-b border-[#30363d] bg-[#0d1117] text-[11px] text-slate-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">节点名称</th>
                        <th className="px-3 py-2 font-medium">标识</th>
                        <th className="px-3 py-2 font-medium">缺失原因</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#30363d]/60 bg-[#0d1117]/60">
                      {executiveInsights.unavailNodes.map((n) => (
                        <tr key={n.nodeId}>
                          <td className="px-3 py-2 font-medium text-slate-200">{n.label}</td>
                          <td className="px-3 py-2 font-mono text-[11px] text-slate-400">{n.nodeId}</td>
                          <td className="px-3 py-2 text-amber-200/90">
                            {n.missingDataReason || '推演日志缺少必要底表或字段'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {reviewTab === 'evidence' && (
            <div className="p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                {sides.length > 0 && (
                  <select
                    value={evidenceSideFilter}
                    onChange={(e) => setEvidenceSideFilter(e.target.value)}
                    className="rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1 text-xs text-slate-200"
                  >
                    <option value="ALL">全部阵营</option>
                    {sides.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                    <option value="综合">综合</option>
                  </select>
                )}
                <input
                  type="text"
                  value={evidenceQuery}
                  onChange={(e) => setEvidenceQuery(e.target.value)}
                  placeholder="按节点、表名或证据描述筛选..."
                  className="w-full sm:w-64 rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              {filteredEvidenceItems.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#30363d] p-6 text-center text-xs text-slate-500">
                  暂无可展示的物理证据溯源记录
                </div>
              ) : (
                <div className="divide-y divide-[#30363d]/60 rounded-lg border border-[#30363d] bg-[#0d1117]">
                  {filteredEvidenceItems.slice(0, 80).map((ev) => (
                    <div
                      key={ev.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-[#161b22]/70"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded border border-cyan-500/35 bg-cyan-500/10 px-1.5 py-0 text-[10px] text-cyan-200">
                            {ev.side}
                          </span>
                          <span className="font-medium text-slate-100">{ev.nodeLabel}</span>
                          <span className="font-mono text-[10px] text-slate-500">
                            {ev.source} · {String(ev.ref)}
                          </span>
                          {ev.scenarioClock && (
                            <span className="font-mono text-[10px] text-slate-400">
                              {ev.scenarioClock}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-300">
                          {ev.description}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedEvidence(ev)}
                        className="shrink-0 rounded border border-[#30363d] bg-[#161b22] px-2.5 py-1 text-[11px] text-cyan-300 hover:border-cyan-500/50 cursor-pointer"
                      >
                        溯源详情
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {reviewTab === 'report' && (
            <div className="p-4">
              {reportHtml ? (
                <div
                  className="prose prose-invert prose-sm max-w-none text-slate-200"
                  dangerouslySetInnerHTML={{ __html: reportHtml }}
                />
              ) : (
                <div className="py-10 text-center text-xs text-slate-500">
                  运行评估后将自动生成结构化评估简报
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* 原生 <dialog> 物理证据详情弹窗 */}
      <dialog
        ref={evidenceDialogRef}
        onCancel={(e) => {
          e.preventDefault();
          setSelectedEvidence(null);
        }}
        className="m-auto w-full max-w-xl rounded-xl border border-[#30363d] bg-[#161b22] p-0 text-slate-100 shadow-2xl backdrop:bg-black/70"
      >
        {selectedEvidence && (
          <div className="flex flex-col">
            <div className="flex items-center justify-between border-b border-[#30363d] px-4 py-3">
              <div className="text-sm font-semibold text-slate-100">
                物理证据溯源详情 · {selectedEvidence.nodeLabel}
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvidence(null)}
                className="rounded border border-[#30363d] px-2 py-1 text-xs text-slate-300 hover:text-white cursor-pointer"
              >
                关闭弹窗
              </button>
            </div>
            <div className="space-y-2.5 p-4 text-xs">
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5 font-mono text-[11px]">
                <div>阵营：{selectedEvidence.side}</div>
                <div>来源：{selectedEvidence.source}</div>
                <div>索引：{String(selectedEvidence.ref)}</div>
                <div>时间刻：{selectedEvidence.scenarioClock || '--'}</div>
              </div>
              <div className="text-slate-200">{selectedEvidence.description}</div>
              {selectedEvidence.snippet && (
                <pre className="max-h-64 overflow-auto rounded-lg border border-[#30363d] bg-[#0d1117] p-3 font-mono text-[11px] text-slate-300">
                  {JSON.stringify(selectedEvidence.snippet, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
