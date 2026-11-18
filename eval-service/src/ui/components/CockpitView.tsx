import type * as echarts from 'echarts';
import MarkdownIt from 'markdown-it';
import {
  Activity,
  CheckCircle2,
  Download,
  FileText,
  GitCompare,
  Play,
  ShieldAlert,
  Square,
  TerminalSquare,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  evalApi,
  type StoredEvalSummary,
  type StoredRunSummary,
  type SystemEvaluationOutput,
  type TacticalFeedbackPayload,
} from '../api.ts';
import type { IndicatorSystem } from '../../core/types.ts';
import { EChartPanel } from './EChartPanel.tsx';

const mdParser = new MarkdownIt({ html: false, linkify: true, breaks: true });

interface CockpitViewProps {
  runs: StoredRunSummary[];
  systems: IndicatorSystem[];
  selectedRunId: string;
  selectedSystemId: string;
  onSelectRun: (runId: string) => void;
  onSelectSystem: (systemId: string) => void;
}

export function CockpitView({
  runs,
  systems,
  selectedRunId,
  selectedSystemId,
  onSelectRun,
  onSelectSystem,
}: CockpitViewProps) {
  const [targetSide, setTargetSide] = useState<string>('');
  const [evaluations, setEvaluations] = useState<StoredEvalSummary[]>([]);
  const uniqueEvaluations = useMemo(() => {
    const seen = new Set<string>();
    const list: StoredEvalSummary[] = [];
    for (const ev of evaluations) {
      if (seen.has(ev.systemId)) continue;
      seen.add(ev.systemId);
      list.push(ev);
      if (list.length >= 6) break;
    }
    return list;
  }, [evaluations]);
  const [activeEvalId, setActiveEvalId] = useState<string>('');
  const [detail, setDetail] = useState<{
    output: SystemEvaluationOutput;
    reportMd: string;
    feedback: TacticalFeedbackPayload;
  } | null>(null);
  const [pyNote, setPyNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [evalProgress, setEvalProgress] = useState<{
    percent: number;
    stage: string;
    message: string;
    elapsedMs: number;
  } | null>(null);
  const [pipelineLogs, setPipelineLogs] = useState<Array<{
    id: string;
    time: string;
    stage: string;
    text: string;
  }>>([]);
  const [showPipelineDrawer, setShowPipelineDrawer] = useState<boolean>(false);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (showPipelineDrawer && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [pipelineLogs.length, showPipelineDrawer]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<'report' | 'feedback' | 'timeline'>('report');

  // TOPSIS + VIKOR 多方案对比工作台状态
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareRunIds, setCompareRunIds] = useState<string[]>([]);
  const [mcdaResult, setMcdaResult] = useState<{
    systemName: string;
    dims: string[];
    weights: number[];
    alternatives: Array<{
      runId: string;
      label: string;
      overallScore: number | null;
      dimScores: number[];
    }>;
    topsis: {
      ranking: Array<{ rank: number; name: string; index: number; closeness: number; dPlus: number; dMinus: number }>;
    };
    vikor: {
      ranking: Array<{ rank: number; name: string; index: number; S: number; R: number; Q: number }>;
      compromiseSolution: string[];
      acceptableAdvantage: boolean;
      acceptableStability: boolean;
      vUsed: number;
    };
  } | null>(null);
  const [topsisLoading, setTopsisLoading] = useState(false);

  useEffect(() => {
    if (runs.length > 0 && compareRunIds.length === 0) {
      setCompareRunIds(runs.slice(0, 6).map((r) => r.runId));
    }
  }, [runs, compareRunIds.length]);

  // 原生 <dialog> 查看单条证据详情
  const evidenceDialogRef = useRef<HTMLDialogElement | null>(null);
  const [inspectedEvidence, setInspectedEvidence] = useState<{
    scenarioClock: string;
    event: string;
    ref: string;
    desc: string;
  } | null>(null);

  const loadEvaluations = async (runId?: string, pickEvalId?: string) => {
    try {
      const res = await evalApi.listEvaluations(runId);
      setEvaluations(res.evaluations);
      const nextId = pickEvalId || res.evaluations[0]?.evalId || '';
      setActiveEvalId(nextId);
      if (nextId) {
        const d = await evalApi.getEvaluation(nextId);
        setDetail(d);
      } else {
        setDetail(null);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void loadEvaluations(selectedRunId || undefined);
  }, [selectedRunId]);

  const handleSelectEval = async (evalId: string) => {
    setActiveEvalId(evalId);
    try {
      const d = await evalApi.getEvaluation(evalId);
      setDetail(d);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const evalAbortRef = useRef<AbortController | null>(null);

  const handleStopEvaluation = () => {
    evalAbortRef.current?.abort();
  };

  const handleRunEvaluation = async () => {
    if (!selectedRunId || !selectedSystemId) return;
    evalAbortRef.current?.abort();
    const ctrl = new AbortController();
    evalAbortRef.current = ctrl;
    setLoading(true);
    const startedAt = Date.now();
    const nowTimeStr = () => {
      const d = new Date();
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0') + '.' + String(d.getMilliseconds()).padStart(3, '0');
    };
    setEvalProgress({ percent: 4, stage: 'init', message: '正在初始化评估任务…', elapsedMs: 0 });
    setPipelineLogs([
      {
        id: Date.now() + '-init',
        time: nowTimeStr(),
        stage: 'init',
        text: '[任务启动] 评估任务启动 (方案: ' + selectedRunId + ', 体系: ' + selectedSystemId + ')',
      },
    ]);
    setErrorMsg(null);
    setPyNote(null);

    const stageCeiling = (stage: string, currentPct: number): number => {
      if (stage === 'init' || stage === 'db_load') return 15;
      if (stage === 'load') return 20;
      if (stage === 'python_stage') return 38;
      if (stage === 'python_normalize') return 52;
      if (stage === 'python_metrics') return 70;
      if (stage === 'operators') return 88;
      if (stage === 'report') return 95;
      if (stage === 'persist') return 99;
      return Math.min(99, currentPct + 10);
    };

    const ticker = window.setInterval(() => {
      setEvalProgress((prev) => {
        if (!prev) return prev;
        const ceiling = stageCeiling(prev.stage, prev.percent);
        let nextPct = prev.percent;
        if (prev.percent < ceiling) {
          nextPct = Math.min(ceiling, Number((prev.percent + Math.max(0.2, (ceiling - prev.percent) * 0.08)).toFixed(2)));
        } else if (prev.percent < Math.min(99, ceiling + 3.5)) {
          // 消除卡死感：逼近天花板时平滑微步前进 (+0.02%/tick)，保持心跳呼吸感
          nextPct = Number((prev.percent + 0.02).toFixed(2));
        }
        return {
          ...prev,
          percent: nextPct,
          elapsedMs: Date.now() - startedAt,
        };
      });
    }, 120);

    try {
      const customParams = targetSide.trim() ? { targetSide: targetSide.trim() } : undefined;
      const res = await evalApi.runEvaluateStream(
        {
          runId: selectedRunId,
          systemId: selectedSystemId,
          customParams,
        },
        (progress) => {
          setEvalProgress((prev) => ({
            percent: Math.max(prev?.percent ?? 0, progress.percent),
            stage: progress.stage,
            message: progress.message,
            elapsedMs: progress.elapsedMs || Date.now() - startedAt,
          }));
          if (progress.log) {
            setPipelineLogs((prev) => [
              ...prev.slice(-299),
              {
                id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
                time: nowTimeStr(),
                stage: progress.stage,
                text: progress.log,
              },
            ]);
          }
        },
        ctrl.signal,
      );
      setDetail({ output: res.output, reportMd: res.reportMd, feedback: res.feedback });
      setActiveEvalId(res.evalId);
      if (res.pythonMetrics) {
        const pm = res.pythonMetrics as { available?: boolean; stagedCount?: number; reason?: string };
        setPyNote(
          pm.available
            ? `已联动 Python metrics.py 完成科学指标核验（暂存白名单 CSV ${pm.stagedCount ?? 0} 份）`
            : `Python metrics.py 降级跳过：${pm.reason ?? '仅使用全量原生 TS 适配器'}`,
        );
      }
      await loadEvaluations(selectedRunId, res.evalId);
    } catch (e) {
      const errText = ctrl.signal.aborted || (e instanceof Error && e.name === 'AbortError')
        ? '已手动停止评估并释放后端计算资源'
        : (e instanceof Error ? e.message : String(e));
      setErrorMsg(errText);
      setPipelineLogs((prev) => [
        ...prev,
        {
          id: Date.now() + '-err',
          time: nowTimeStr(),
          stage: 'error',
          text: '[中断] ' + errText,
        },
      ]);
    } finally {
      window.clearInterval(ticker);
      evalAbortRef.current = null;
      setLoading(false);
      setEvalProgress(null);
    }
  };

  const handleDeleteEvaluation = async (evalId: string, ev?: React.MouseEvent) => {
    ev?.stopPropagation();
    try {
      await evalApi.deleteEvaluation(evalId);
      await loadEvaluations(selectedRunId);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRunMcdaCompare = async (overrideRunIds?: string[]) => {
    const targetRunIds = overrideRunIds ?? compareRunIds;
    if (targetRunIds.length < 2) {
      setErrorMsg('多方案 TOPSIS + VIKOR 对比至少需要勾选 2 局推演方案（Run）');
      return;
    }
    if (!selectedSystemId) {
      setErrorMsg('请先选择一个评估体系');
      return;
    }
    setTopsisLoading(true);
    setErrorMsg(null);
    setCompareOpen(true);
    try {
      const allEvalsRes = await evalApi.listEvaluations();
      const outputs: SystemEvaluationOutput[] = [];

      for (const rId of targetRunIds) {
        const matched = allEvalsRes.evaluations.find(
          (e) => e.runId === rId && e.systemId === selectedSystemId,
        );
        if (matched) {
          const detailRes = await evalApi.getEvaluation(matched.evalId);
          outputs.push(detailRes.output);
        } else {
          // 尚未对该体系评估，自动补跑
          const runRes = await evalApi.runEvaluate({
            runId: rId,
            systemId: selectedSystemId,
            customParams: targetSide.trim() ? { targetSide: targetSide.trim() } : undefined,
          });
          outputs.push(runRes.output);
        }
      }

      if (outputs.length < 2) {
        throw new Error('有效评估方案不足 2 个，无法执行 MCDA 对比');
      }

      const dims = outputs[0].dimensions.map((d) => d.name);
      const weights = outputs[0].dimensions.map((d) => d.weight);
      const alternatives = outputs.map((o) => {
        const runMeta = runs.find((r) => r.runId === o.runId);
        return runMeta?.scenarioName ? `${runMeta.scenarioName} [${o.runId}]` : o.runId;
      });
      const matrix = outputs.map((o) =>
        dims.map((dimName) => {
          const found = o.dimensions.find((x) => x.name === dimName);
          return found?.score ?? 0;
        }),
      );
      const directions = dims.map(() => 'larger_is_better' as const);

      const [topsisRes, vikorRes] = await Promise.all([
        evalApi.computeTopsis({
          matrix,
          weights,
          directions,
          alternatives,
        }),
        evalApi.computeVikor({
          matrix,
          weights,
          directions,
          alternatives,
          v: 0.5,
        }),
      ]);

      const sortedVikor = [...vikorRes.ranking].sort((a, b) => a.Q - b.Q);
      const dq = 1 / Math.max(1, sortedVikor.length - 1);
      const acceptableAdvantage =
        sortedVikor.length >= 2 ? sortedVikor[1].Q - sortedVikor[0].Q >= dq : true;
      const minS = Math.min(...sortedVikor.map((x) => x.S));
      const minR = Math.min(...sortedVikor.map((x) => x.R));
      const topVikor = sortedVikor[0];
      const acceptableStability = topVikor
        ? topVikor.S <= minS + 1e-6 || topVikor.R <= minR + 1e-6
        : false;
      const compromiseSolution = vikorRes.compromiseBest
        ? [vikorRes.compromiseBest]
        : sortedVikor.slice(0, 1).map((x) => x.name);

      setMcdaResult({
        systemName: outputs[0].systemName,
        dims,
        weights,
        alternatives: outputs.map((o, idx) => ({
          runId: o.runId,
          label: alternatives[idx],
          overallScore: o.overallScore,
          dimScores: matrix[idx],
        })),
        topsis: { ranking: topsisRes.ranking },
        vikor: {
          ranking: vikorRes.ranking,
          compromiseSolution,
          acceptableAdvantage,
          acceptableStability,
          vUsed: vikorRes.vParameter,
        },
      });
      await loadEvaluations(selectedRunId);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setTopsisLoading(false);
    }
  };

  const compareRadarOption = useMemo<echarts.EChartsOption>(() => {
    if (!mcdaResult || mcdaResult.dims.length === 0) return {};
    const palette = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item' },
      legend: {
        bottom: 0,
        textStyle: { color: '#cbd5e1', fontSize: 11 },
        data: mcdaResult.alternatives.map((a) => a.label),
      },
      radar: {
        indicator: mcdaResult.dims.map((name) => ({ name, max: 100 })),
        radius: '60%',
        center: ['50%', '45%'],
        axisName: { color: '#cbd5e1', fontSize: 11 },
        splitArea: { areaStyle: { color: ['rgba(30,41,59,0.2)', 'rgba(15,23,42,0.4)'] } },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,0.2)' } },
        axisLine: { lineStyle: { color: 'rgba(148,163,184,0.25)' } },
      },
      series: [
        {
          type: 'radar',
          data: mcdaResult.alternatives.map((alt, idx) => ({
            value: alt.dimScores.map((s) => Number(s.toFixed(1))),
            name: alt.label,
            lineStyle: { color: palette[idx % palette.length], width: 2 },
            itemStyle: { color: palette[idx % palette.length] },
            areaStyle: { color: palette[idx % palette.length], opacity: 0.1 },
          })),
        },
      ],
    };
  }, [mcdaResult]);

  const handleExportCompareMd = () => {
    if (!mcdaResult) return;
    const lines = [
      `# 多方案 MCDA 决策对比报告 (${mcdaResult.systemName})`,
      '',
      `- 生成时间：${new Date().toLocaleString()}`,
      `- 对比方案数：${mcdaResult.alternatives.length}`,
      `- VIKOR 决策准则：C1 可接受优势=${mcdaResult.vikor.acceptableAdvantage ? '通过' : '不满足'}，C2 决策稳定性=${mcdaResult.vikor.acceptableStability ? '通过' : '不满足'}`,
      `- 推荐折中解：${mcdaResult.vikor.compromiseSolution.join(' / ')}`,
      '',
      '## 综合排序对比表',
      '',
      '| 方案 | 综合得分 | TOPSIS 贴近度 (Ci) | TOPSIS 排名 | VIKOR 群效益 (Si) | VIKOR 遗憾 (Ri) | VIKOR 折中 (Qi) | VIKOR 排名 |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ];
    for (const alt of mcdaResult.alternatives) {
      const top = mcdaResult.topsis.ranking.find((r) => r.name === alt.label);
      const vik = mcdaResult.vikor.ranking.find((r) => r.name === alt.label);
      lines.push(
        `| ${alt.label} | ${alt.overallScore !== null ? alt.overallScore.toFixed(2) : 'N/A'} | ${top ? (top.closeness * 100).toFixed(2) + '%' : '-'} | ${top ? '#' + top.rank : '-'} | ${vik ? vik.S.toFixed(4) : '-'} | ${vik ? vik.R.toFixed(4) : '-'} | ${vik ? vik.Q.toFixed(4) : '-'} | ${vik ? '#' + vik.rank : '-'} |`,
      );
    }
    downloadText(`mcda-compare-${Date.now()}.md`, lines.join('\n'), 'text/markdown;charset=utf-8');
  };

  const radarOption = useMemo<echarts.EChartsOption>(() => {
    const radarData = detail?.output.evalSummaryV2.radar;
    if (!radarData || radarData.dimensions.length === 0) {
      return { backgroundColor: 'transparent', title: { text: '暂无评估雷达', left: 'center', top: 'middle', textStyle: { color: '#64748b', fontSize: 13 } } };
    }
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item' },
      legend: {
        bottom: 0,
        data: [
          { name: '当前实测评估', itemStyle: { color: '#60a5fa' } },
          { name: '及格基准 (80分)', itemStyle: { color: '#8b949e', opacity: 0.7 }, lineStyle: { type: 'dashed' } },
        ],
        textStyle: { color: '#cbd5e1', fontSize: 11 },
      },
      radar: {
        radius: '64%',
        center: ['50%', '46%'],
        indicator: radarData.dimensions.map((name) => ({ name, max: 100 })),
        axisName: { color: '#cbd5e1', fontSize: 11 },
        splitArea: { areaStyle: { color: ['rgba(59,130,246,0.03)', 'rgba(15,23,42,0.28)'] } },
        splitLine: { lineStyle: { color: 'rgba(148,163,184,0.18)' } },
        axisLine: { lineStyle: { color: 'rgba(148,163,184,0.22)' } },
      },
      series: [
        {
          type: 'radar',
          data: [
            {
              value: radarData.scores,
              name: '当前实测评估',
              symbolSize: 5,
              lineStyle: { color: '#3b82f6', width: 2 },
              itemStyle: { color: '#60a5fa' },
              areaStyle: { color: 'rgba(59,130,246,0.18)' },
            },
            {
              value: radarData.benchmark,
              name: '及格基准 (80分)',
              symbol: 'none',
              lineStyle: { color: '#8b949e', type: 'dashed', width: 1.4 },
              itemStyle: { color: '#8b949e' },
              areaStyle: { color: 'rgba(148,163,184,0.05)' },
            },
          ],
        },
      ],
    };
  }, [detail]);

  const barOption = useMemo<echarts.EChartsOption>(() => {
    const dims = detail?.output.dimensions ?? [];
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (val) => (val === null ? '数据缺失' : `${Number(val).toFixed(1)} 分`),
      },
      grid: { left: 16, right: 86, top: 18, bottom: 28, containLabel: true },
      xAxis: {
        type: 'value',
        max: 100,
        splitLine: { lineStyle: { color: 'rgba(148,163,184,0.12)' } },
        axisLabel: { color: '#8b949e', fontSize: 11 },
      },
      yAxis: {
        type: 'category',
        data: dims.map((d) => d.name),
        axisLabel: { color: '#e6edf3', fontSize: 11 },
        axisLine: { lineStyle: { color: 'rgba(148,163,184,0.2)' } },
      },
      series: [
        {
          type: 'bar',
          barWidth: 16,
          data: dims.map((d) => {
            const unavail = d.score === null;
            const v = unavail ? 0 : Number((d.score ?? 0).toFixed(1));
            return {
              value: v,
              itemStyle: {
                borderRadius: [0, 4, 4, 0],
                color: unavail ? '#4b5563' : v >= 80 ? '#22c55e' : v >= 60 ? '#3b82f6' : '#eab308',
              },
              label: {
                show: true,
                position: 'right',
                color: unavail ? '#8b949e' : '#e6edf3',
                formatter: unavail ? '数据缺失' : `${v.toFixed(1)} 分`,
                fontSize: 11,
              },
            };
          }),
        },
      ],
    };
  }, [detail]);

  const downloadText = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reportHtml = useMemo(() => {
    if (!detail?.reportMd) return '';
    return mdParser.render(detail.reportMd);
  }, [detail]);

  return (
    <div className="space-y-3.5">
      {/* 控制顶条 */}
      <section className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-56">
            <label htmlFor="cockpit-run-sel" className="mb-1 block text-xs font-medium text-[#8b949e]">
              推演场次
            </label>
            <select
              id="cockpit-run-sel"
              value={selectedRunId}
              onChange={(e) => onSelectRun(e.target.value)}
              className="w-full rounded-md border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-sm text-[#e6edf3] focus:border-blue-500 focus:outline-none"
            >
              {runs.map((r) => (
                <option key={r.runId} value={r.runId}>
                  {r.scenarioName} [{r.runId}] ({r.sourceKind === "csv_dir" ? "CSV 目录" : r.sourceKind === "jsonl_file" ? "JSONL 状态帧" : r.sourceKind} · {r.eventCount}事件)
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0 flex-1 basis-56">
            <label htmlFor="cockpit-sys-sel" className="mb-1 block text-xs font-medium text-[#8b949e]">
              评估体系
            </label>
            <select
              id="cockpit-sys-sel"
              value={selectedSystemId}
              onChange={(e) => onSelectSystem(e.target.value)}
              className="w-full rounded-md border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-sm text-[#e6edf3] focus:border-blue-500 focus:outline-none"
            >
              {systems.map((s) => (
                <option key={s.systemId} value={s.systemId}>
                  {s.name} ({s.version})
                </option>
              ))}
            </select>
          </div>

          <div className="w-36 shrink-0">
            <label htmlFor="cockpit-side-input" className="mb-1 block text-xs font-medium text-[#8b949e]">
              评估阵营（可选）
            </label>
            <input
              id="cockpit-side-input"
              value={targetSide}
              onChange={(e) => setTargetSide(e.target.value)}
              placeholder="自动 / 红方 / 蓝方"
              className="w-full rounded-md border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-sm text-[#e6edf3] placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {loading ? (
              <button
                type="button"
                onClick={handleStopEvaluation}
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/60 bg-rose-950/50 px-3.5 py-1.5 text-sm font-medium text-rose-200 transition hover:border-rose-400 hover:bg-rose-900/60"
                title="立即中止当前评估任务，终止 Python 子进程并释放计算资源"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                停止计算
              </button>
            ) : (
              <button
                type="button"
                disabled={!selectedRunId || !selectedSystemId}
                onClick={handleRunEvaluation}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" />
                运行评估
              </button>
            )}

            <button
              type="button"
              disabled={topsisLoading}
              onClick={() => {
                if (!compareOpen) {
                  setCompareOpen(true);
                  if (compareRunIds.length >= 2) {
                    void handleRunMcdaCompare();
                  }
                } else {
                  setCompareOpen(false);
                }
              }}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
                compareOpen
                  ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                  : 'border-[#30363d] bg-[#0f141a] text-slate-200 hover:border-slate-500'
              }`}
            >
              <GitCompare className="h-3.5 w-3.5 text-amber-400" />
              {topsisLoading ? 'MCDA 计算中…' : '多方案 TOPSIS 排序 (含 VIKOR)'}
            </button>
          </div>
        </div>

        {/* 历史评估切换条（按体系去重，保留最新一条 + 删除操作） */}
        {uniqueEvaluations.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-[#262d38] pt-2.5 text-xs text-[#8b949e]">
            <span>历史评估：</span>
            {uniqueEvaluations.map((ev) => (
              <div
                key={ev.evalId}
                className={`tabular-nums inline-flex max-w-[260px] items-center rounded border text-xs transition ${
                  ev.evalId === activeEvalId
                    ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                    : 'border-[#2a313c] bg-[#0f141a] text-slate-300 hover:border-slate-500'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleSelectEval(ev.evalId)}
                  title={`${ev.systemName} · ${ev.overallScore !== null ? `${ev.overallScore.toFixed(1)}分` : "N/A"} (${ev.runId})`}
                  className="inline-flex min-w-0 items-center px-2 py-1"
                >
                  <span className="truncate">{ev.systemName}</span>
                  <span className="ml-1 shrink-0">· {ev.overallScore !== null ? `${ev.overallScore.toFixed(1)}分` : "N/A"}</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => handleDeleteEvaluation(ev.evalId, e)}
                  title="删除该条历史评估记录"
                  aria-label="删除评估记录"
                  className="border-l border-[#2a313c] px-1.5 py-1 text-slate-500 hover:text-rose-400"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {pyNote && !loading && (
          <p className="mt-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-300">
            {pyNote}
          </p>
        )}
        {errorMsg && (
          <p className="mt-2 rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-200">
            {errorMsg}
          </p>
        )}
      </section>

      {/* 多方案 MCDA 决策对比工作台（TOPSIS + VIKOR + 多方案雷达图） */}
      {compareOpen && (
        <section className="space-y-3 rounded-lg border border-amber-500/35 bg-[#161b22] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262d38] pb-2.5">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-300">
                <GitCompare className="h-4 w-4" />
                多方案 MCDA 综合决策对比（TOPSIS + VIKOR 双算法）
              </h3>
              <p className="mt-0.5 text-xs text-[#8b949e]">
                勾选至少 2 局推演方案（若所选场次尚未对当前体系评估，点击运行将自动快速补跑），同步比对贴近度 (Ci) 与折中解 (Qi)。
              </p>
            </div>
            <div className="flex items-center gap-2">
              {mcdaResult && (
                <button
                  type="button"
                  onClick={handleExportCompareMd}
                  className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1 text-xs text-slate-200 hover:border-slate-500"
                >
                  <Download className="h-3.5 w-3.5" />
                  导出对比简报 (.md)
                </button>
              )}
              <button
                type="button"
                onClick={() => setCompareOpen(false)}
                className="rounded p-1 text-[#8b949e] hover:bg-[#1c2128] hover:text-white"
                aria-label="收起对比面板"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[#8b949e]">
                选择对比推演场次（已选 {compareRunIds.length}/{runs.length}）：
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setCompareRunIds(
                      compareRunIds.length === runs.length ? [] : runs.map((r) => r.runId),
                    )
                  }
                  className="text-blue-400 hover:underline"
                >
                  {compareRunIds.length === runs.length ? '清空选择' : '全选'}
                </button>
                <button
                  type="button"
                  disabled={topsisLoading || compareRunIds.length < 2}
                  onClick={() => handleRunMcdaCompare()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1 font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  {topsisLoading ? '批量评估与排序中…' : '执行 TOPSIS + VIKOR 对比'}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {runs.map((r) => {
                const checked = compareRunIds.includes(r.runId);
                return (
                  <label
                    key={r.runId}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded border px-2.5 py-1 transition ${
                      checked
                        ? 'border-amber-500/60 bg-amber-500/15 text-amber-200'
                        : 'border-[#30363d] bg-[#0f141a] text-slate-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setCompareRunIds((prev) => [...prev, r.runId]);
                        } else {
                          setCompareRunIds((prev) => prev.filter((id) => id !== r.runId));
                        }
                      }}
                      className="accent-amber-500"
                    />
                    <span className="max-w-[220px] truncate">{r.scenarioName || r.runId}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {mcdaResult && (
            <div className="grid grid-cols-1 gap-3 pt-2 lg:grid-cols-12">
              <div className="space-y-2.5 lg:col-span-7">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`rounded px-2 py-0.5 font-medium ${
                      mcdaResult.vikor.acceptableAdvantage
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-amber-500/15 text-amber-300'
                    }`}
                  >
                    VIKOR C1 可接受优势: {mcdaResult.vikor.acceptableAdvantage ? '通过' : '未拉开明显差距'}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 font-medium ${
                      mcdaResult.vikor.acceptableStability
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-amber-500/15 text-amber-300'
                    }`}
                  >
                    VIKOR C2 决策稳定性: {mcdaResult.vikor.acceptableStability ? '通过' : '存在次优妥协'}
                  </span>
                  <span className="rounded bg-blue-500/15 px-2 py-0.5 text-blue-300">
                    推荐折中解: {mcdaResult.vikor.compromiseSolution.join(' / ')}
                  </span>
                </div>

                <div className="responsive-table-wrap rounded-md border border-[#2a313c]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#0f141a] text-slate-300">
                      <tr>
                        <th className="px-2.5 py-2">方案</th>
                        <th className="px-2 py-2 text-right">综合得分</th>
                        <th className="px-2 py-2 text-right">TOPSIS Ci (排名)</th>
                        <th className="px-2 py-2 text-right">VIKOR Si</th>
                        <th className="px-2 py-2 text-right">VIKOR Ri</th>
                        <th className="px-2 py-2 text-right">VIKOR Qi (排名)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#262d38]">
                      {mcdaResult.alternatives.map((alt) => {
                        const top = mcdaResult.topsis.ranking.find((r) => r.name === alt.label);
                        const vik = mcdaResult.vikor.ranking.find((r) => r.name === alt.label);
                        return (
                          <tr key={alt.runId} className="hover:bg-[#0f141a]/60">
                            <td className="max-w-[160px] truncate px-2.5 py-2 font-medium text-slate-100" title={alt.label}>
                              {alt.label}
                            </td>
                            <td className="px-2.5 py-2 text-right tabular-nums font-mono text-slate-200">
                              {alt.overallScore !== null ? alt.overallScore.toFixed(1) : 'N/A'}
                            </td>
                            <td className="px-2.5 py-2 text-right tabular-nums font-mono text-blue-300">
                              {top ? `${(top.closeness * 100).toFixed(1)}% (Rank #${top.rank})` : '-'}
                            </td>
                            <td className="px-2.5 py-2 text-right tabular-nums font-mono text-slate-300">
                              {vik ? vik.S.toFixed(3) : '-'}
                            </td>
                            <td className="px-2.5 py-2 text-right tabular-nums font-mono text-slate-300">
                              {vik ? vik.R.toFixed(3) : '-'}
                            </td>
                            <td className="px-2.5 py-2 text-right tabular-nums font-mono text-emerald-300">
                              {vik ? `${vik.Q.toFixed(3)} (#${vik.rank})` : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-md border border-[#2a313c] bg-[#0f141a] p-2.5 lg:col-span-5">
                <div className="mb-1 text-xs font-medium text-slate-300">多方案一级维度能力雷达叠加</div>
                <EChartPanel option={compareRadarOption} height={260} />
              </div>
            </div>
          )}
        </section>
      )}

      {pipelineLogs.length > 0 && !loading && (
        <div className="flex items-center justify-between rounded border border-[#21262d] bg-[#0d1117] px-3 py-1.5 text-xs">
          <span className="flex items-center gap-2 text-slate-300 text-[11px]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            本轮透明流水线已执行完毕（共 {pipelineLogs.length} 条里程碑与执行日志）
          </span>
          <button
            type="button"
            onClick={() => setShowPipelineDrawer((v) => !v)}
            className="text-xs text-cyan-400 hover:text-cyan-300 font-medium hover:underline"
          >
            {showPipelineDrawer ? '收起流水日志 ▲' : '查看透明流水日志明细 ▼'}
          </button>
        </div>
      )}
      {showPipelineDrawer && !loading && (
        <div className="rounded-md border border-[#30363d] bg-[#090d13] p-3 text-xs shadow-inner">
          <div className="flex items-center justify-between border-b border-[#21262d] pb-2 mb-2 text-[11px]">
            <span className="flex items-center gap-1.5 font-semibold text-slate-300">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
              透明流水线执行归档日志 ({pipelineLogs.length} 条)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const allText = pipelineLogs.map((l) => '[' + l.time + '] [' + l.stage + '] ' + l.text).join(String.fromCharCode(10));
                  navigator.clipboard?.writeText(allText);
                }}
                className="text-[#8b949e] hover:text-slate-200 text-[10px] underline"
              >
                复制全部日志
              </button>
              <button
                type="button"
                onClick={() => setShowPipelineDrawer(false)}
                className="text-[#8b949e] hover:text-slate-200 text-[10px]"
              >
                收起
              </button>
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto font-mono text-[11px] space-y-1 pr-1 custom-scrollbar">
            {pipelineLogs.map((log) => (
              <div key={log.id} className="flex items-start gap-2 leading-relaxed hover:bg-[#161b22] px-1 rounded">
                <span className="shrink-0 text-slate-500">{log.time}</span>
                <span className="shrink-0 text-cyan-400">[{log.stage}]</span>
                <span className="text-slate-200 break-all">{log.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <section className="rounded-lg border border-[#2a313c] bg-[#161b22] px-6 py-6 shadow-xl">
          <div className="mx-auto max-w-xl space-y-4">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-medium text-blue-200">
                <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
                {evalProgress?.message ?? '正在加载推演态势与评估体系…'}
              </span>
              <span className="tabular-nums font-mono text-cyan-300 font-semibold">
                {Math.round(evalProgress?.percent ?? 0)}% · {((evalProgress?.elapsedMs ?? 0) / 1000).toFixed(1)}s
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#0a0d12] border border-[#2a313c]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-600 via-cyan-400 to-emerald-400 transition-all duration-200 ease-out"
                style={{ width: (Math.max(4, Math.min(100, evalProgress?.percent ?? 4))) + '%' }}
              />
            </div>

            {/* 单行流水摘要 + 抽屉折叠展开按钮 */}
            <div className="flex items-center justify-between rounded border border-[#21262d] bg-[#0d1117] px-3 py-1.5 text-[11px]">
              <div className="flex items-center gap-2 min-w-0 text-[#8b949e]">
                <span className="shrink-0 text-cyan-400 font-semibold">⚡ 流水:</span>
                <span className="truncate font-mono text-slate-300">
                  {pipelineLogs[pipelineLogs.length - 1]?.text ?? '流水线准备就绪...'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowPipelineDrawer((v) => !v)}
                className="ml-3 shrink-0 flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-cyan-400 hover:text-cyan-300 hover:bg-[#1f2937] transition-colors"
              >
                <span>{showPipelineDrawer ? '收起流水日志 ▲' : '展开透明流水日志 (' + pipelineLogs.length + ') ▼'}</span>
              </button>
            </div>

            {/* 展开的透明流水线日志控制台 */}
            {showPipelineDrawer && (
              <div className="rounded-md border border-[#30363d] bg-[#090d13] p-3 text-xs shadow-inner">
                <div className="flex items-center justify-between border-b border-[#21262d] pb-2 mb-2 text-[11px]">
                  <span className="flex items-center gap-1.5 font-semibold text-slate-300">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    透明流水线实时执行日志 ({pipelineLogs.length} 条)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const allText = pipelineLogs.map((l) => '[' + l.time + '] [' + l.stage + '] ' + l.text).join(String.fromCharCode(10));
                        navigator.clipboard?.writeText(allText);
                      }}
                      className="text-[#8b949e] hover:text-slate-200 text-[10px] underline"
                    >
                      复制日志
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPipelineDrawer(false)}
                      className="text-[#8b949e] hover:text-slate-200 text-[10px]"
                    >
                      收起
                    </button>
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto font-mono text-[11px] space-y-1 pr-1 custom-scrollbar">
                  {pipelineLogs.map((log) => (
                    <div key={log.id} className="flex items-start gap-2 leading-relaxed hover:bg-[#161b22] px-1 rounded">
                      <span className="shrink-0 text-slate-500">{log.time}</span>
                      <span className="shrink-0 text-cyan-400">[{log.stage}]</span>
                      <span className="text-slate-200 break-all">{log.text}</span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </div>
            )}

            <p className="text-center text-[11px] text-slate-500">
              评估完成后将自动展示综合得分、维度雷达图、评估报告、战术反哺与物理证据链
            </p>
          </div>
        </section>
      ) : detail ? (
        <>
          {/* 总分与 4 KPI 卡片 */}
          <section className="grid grid-cols-1 gap-3 lg:grid-cols-5">
            <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-4 lg:col-span-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[#8b949e]">
                    综合得分
                  </span>
                  <h2 className="mt-1 text-sm font-semibold leading-snug text-slate-100">
                    {detail.output.evalSummaryV2.conclusionTitle}
                  </h2>
                </div>
                <span className="shrink-0 rounded border border-[#30363d] bg-[#0f141a] px-2 py-0.5 text-xs font-medium text-emerald-400">
                  等级 {detail.feedback.tacticalGrade}
                </span>
              </div>

              <div className="mt-2.5 flex items-baseline gap-2.5">
                <span className="tabular-nums text-3xl font-bold tracking-tight text-blue-400">
                  {detail.output.overallScore !== null ? detail.output.overallScore.toFixed(1) : 'N/A'}
                </span>
                <span className="text-xs text-[#8b949e]">/ 100.0</span>
                <span className="tabular-nums ml-auto text-xs text-[#8b949e]">
                  权重覆盖 {(detail.output.availableWeightRatio * 100).toFixed(0)}% · 置信度{' '}
                  {detail.output.overallConfidence}
                </span>
              </div>

              <p className="mt-2.5 text-xs leading-relaxed text-slate-300">
                {detail.output.evalSummaryV2.conclusion}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadText(
                      `evaluation_report_${detail.output.evalId}.md`,
                      detail.reportMd,
                      'text/markdown;charset=utf-8',
                    )
                  }
                  className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1 text-xs text-slate-200 hover:border-slate-500"
                >
                  <Download className="h-3.5 w-3.5" />
                  导出报告 (.md)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadText(
                      `tactical_feedback_${detail.output.evalId}.json`,
                      JSON.stringify(detail.feedback, null, 2),
                      'application/json;charset=utf-8',
                    )
                  }
                  className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1 text-xs text-slate-200 hover:border-slate-500"
                >
                  <Download className="h-3.5 w-3.5" />
                  导出调参建议 (.json)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:col-span-3">
              {detail.output.evalSummaryV2.kpis.map((kpi, idx) => {
                const unavail = kpi.status === 'unavailable';
                const degraded = kpi.status === 'degraded';
                return (
                  <div
                    key={`${kpi.label}-${idx}`}
                    className={`rounded-lg border p-3.5 ${
                      unavail
                        ? 'border-dashed border-rose-500/40 bg-[#161b22]'
                        : degraded
                          ? 'border-amber-500/40 bg-[#161b22]'
                          : 'border-[#2a313c] bg-[#161b22]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[#8b949e]">{kpi.label}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          unavail
                            ? 'bg-rose-500/15 text-rose-300'
                            : degraded
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-emerald-500/15 text-emerald-300'
                        }`}
                      >
                        {kpi.status ?? 'unknown'}
                      </span>
                    </div>
                    <p className="tabular-nums mt-1.5 text-lg font-semibold text-slate-100">{kpi.value}</p>
                    <p className="mt-1 font-mono text-[11px] text-slate-500">{kpi.atomRef}</p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 雷达图与条形对比图 */}
          <section className="grid grid-cols-1 gap-3 lg:grid-cols-2 panel-isolate">
            <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-100 min-w-0">
                  <Activity className="h-4 w-4 text-blue-400 shrink-0" />
                  <span className="truncate">能力维度对比（实测 vs 80分基准）</span>
                </h3>
                <span className="text-xs text-[#8b949e]">{detail.output.evalSummaryV2.judgement}</span>
              </div>
              <EChartPanel option={radarOption} height={290} />
            </div>

            <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  一级维度得分分布
                </h3>
                <span className="tabular-nums text-xs text-[#8b949e]">
                  {detail.output.evalSummaryV2.compareNote}
                </span>
              </div>
              <EChartPanel option={barOption} height={290} />
            </div>
          </section>

          {/* 报告 / 调整建议 / 证据溯源 切换选项卡 */}
          <section className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5">
            <div role="tablist" aria-label="评估产物视图" className="flex flex-wrap gap-2 border-b border-[#262d38] pb-2">
              <button
                role="tab"
                type="button"
                aria-selected={subTab === 'report'}
                aria-controls="panel-cockpit-report"
                onClick={() => setSubTab('report')}
                className={`inline-flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-sm font-medium transition ${
                  subTab === 'report'
                    ? 'border-blue-500 text-blue-300'
                    : 'border-transparent text-[#8b949e] hover:text-slate-200'
                }`}
              >
                <FileText className="h-4 w-4" />
                评估报告
              </button>
              <button
                role="tab"
                type="button"
                aria-selected={subTab === 'feedback'}
                aria-controls="panel-cockpit-feedback"
                onClick={() => setSubTab('feedback')}
                className={`inline-flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-sm font-medium transition ${
                  subTab === 'feedback'
                    ? 'border-blue-500 text-blue-300'
                    : 'border-transparent text-[#8b949e] hover:text-slate-200'
                }`}
              >
                <ShieldAlert className="h-4 w-4" />
                短板诊断与调整建议 ({detail.feedback.weaknessDiagnostics.length})
              </button>
              <button
                role="tab"
                type="button"
                aria-selected={subTab === 'timeline'}
                aria-controls="panel-cockpit-timeline"
                onClick={() => setSubTab('timeline')}
                className={`inline-flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-sm font-medium transition ${
                  subTab === 'timeline'
                    ? 'border-blue-500 text-blue-300'
                    : 'border-transparent text-[#8b949e] hover:text-slate-200'
                }`}
              >
                <TerminalSquare className="h-4 w-4" />
                物理证据时间轴 ({detail.output.evalSummaryV2.evidenceTimeline.length})
              </button>
            </div>

            <div
              id="panel-cockpit-report"
              role="tabpanel"
              hidden={subTab !== 'report'}
              className="mt-3.5 max-w-none space-y-2 text-sm leading-relaxed text-slate-200 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-slate-100 [&_h2]:mt-4 [&_h2]:border-b [&_h2]:border-[#262d38] [&_h2]:pb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-blue-300 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-slate-100 [&_table]:my-2.5 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-[#2a313c] [&_th]:bg-[#0f141a] [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-xs [&_td]:border [&_td]:border-[#2a313c] [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:text-xs [&_code]:rounded [&_code]:bg-[#0f141a] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-blue-300 [&_blockquote]:border-l-2 [&_blockquote]:border-blue-500 [&_blockquote]:pl-3 [&_blockquote]:text-slate-300"
              dangerouslySetInnerHTML={{ __html: reportHtml }}
            />

            <div id="panel-cockpit-feedback" role="tabpanel" hidden={subTab !== 'feedback'} className="mt-3.5 space-y-3">
              {detail.feedback.weaknessDiagnostics.length === 0 ? (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
                  全部有效指标均达到或高于 80 分基准线，暂无待整改项。
                </div>
              ) : (
                <div className="space-y-2.5">
                  {detail.feedback.weaknessDiagnostics.map((w) => (
                    <div key={w.code} className="rounded-md border border-[#2a313c] bg-[#0f141a] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 font-mono text-xs font-semibold text-amber-300">
                          <ShieldAlert className="h-3.5 w-3.5" />
                          {w.code} · {w.dimension}
                        </span>
                        <span className="tabular-nums rounded bg-rose-500/15 px-2 py-0.5 text-xs text-rose-300">
                          得分 {w.score?.toFixed(1) ?? 'N/A'}（基准 {w.benchmarkValue}）
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs text-slate-200">{w.diagnosis}</p>
                      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-blue-300">
                        {w.suggestedDirectives.map((d, i) => (
                          <li key={i}>{d}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <h4 className="mb-1.5 text-xs font-medium text-[#8b949e]">
                  建议参数补丁（JSON）
                </h4>
                <pre className="overflow-x-auto rounded-md border border-[#2a313c] bg-[#0f141a] p-3 font-mono text-xs text-emerald-300">
                  {JSON.stringify(detail.feedback.recommendedDoctrinePatches, null, 2)}
                </pre>
              </div>
            </div>

            <div id="panel-cockpit-timeline" role="tabpanel" hidden={subTab !== 'timeline'} className="mt-3.5">
              <div className="responsive-table-wrap rounded-md border border-[#2a313c]" tabIndex={0}>
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#0f141a] text-[#8b949e]">
                    <tr>
                      <th scope="col" className="px-3 py-2">推演时钟</th>
                      <th scope="col" className="px-3 py-2">事件类型</th>
                      <th scope="col" className="px-3 py-2">描述</th>
                      <th scope="col" className="px-3 py-2 hide-narrow-col">数据定位 Ref</th>
                      <th scope="col" className="px-3 py-2">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#262d38]">
                    {detail.output.evalSummaryV2.evidenceTimeline.map((row, idx) => (
                      <tr key={`${row.ref}-${idx}`} className="hover:bg-[#1c2128]">
                        <td className="tabular-nums whitespace-nowrap px-3 py-1.5 font-mono text-blue-300">
                          {row.scenarioClock}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-amber-300">{row.event}</td>
                        <td className="px-3 py-1.5 text-slate-200">{row.desc}</td>
                        <td className="px-3 py-1.5 font-mono text-[#8b949e] hide-narrow-col">{row.ref}</td>
                        <td className="px-3 py-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setInspectedEvidence(row);
                              evidenceDialogRef.current?.showModal();
                            }}
                            className="rounded border border-[#30363d] bg-[#0f141a] px-2 py-0.5 text-[11px] text-blue-300 hover:border-blue-500"
                          >
                            溯源详情
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      ) : null}

      {/* 原生 HTML <dialog>：严禁手动加 role="dialog" / aria-modal / Esc 劫持 */}
      <dialog ref={evidenceDialogRef} className="w-full max-w-lg p-4">
        <div className="flex items-start justify-between gap-3 border-b border-[#2a313c] pb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">证据记录详情</h3>
            <p className="text-xs text-[#8b949e]">定位原始帧行号或 CSV 记录位置</p>
          </div>
          <button
            type="button"
            onClick={() => evidenceDialogRef.current?.close()}
            className="rounded p-1 text-[#8b949e] hover:bg-[#1c2128] hover:text-white"
            aria-label="关闭弹窗"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {inspectedEvidence && (
          <div className="mt-3 space-y-2.5 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-[#2a313c] bg-[#0f141a] p-2.5">
                <span className="text-[#8b949e]">推演时间</span>
                <p className="tabular-nums mt-1 font-mono text-sm text-blue-300">
                  {inspectedEvidence.scenarioClock}
                </p>
              </div>
              <div className="rounded-md border border-[#2a313c] bg-[#0f141a] p-2.5">
                <span className="text-[#8b949e]">事件分类</span>
                <p className="mt-1 font-mono text-sm text-amber-300">{inspectedEvidence.event}</p>
              </div>
            </div>
            <div className="rounded-md border border-[#2a313c] bg-[#0f141a] p-2.5">
              <span className="text-[#8b949e]">记录定位 (Ref)</span>
              <p className="mt-1 break-all font-mono text-emerald-300">{inspectedEvidence.ref}</p>
            </div>
            <div className="rounded-md border border-[#2a313c] bg-[#0f141a] p-2.5">
              <span className="text-[#8b949e]">事件摘要</span>
              <p className="mt-1 text-slate-100">{inspectedEvidence.desc}</p>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
