import type * as echarts from 'echarts';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, GitCompare, Play, X } from 'lucide-react';
import type { EvaluationSystemDag } from '../../../core/types.ts';
import {
  evalApi,
  type StoredRunSummary,
  type StoredV4EvalRecord,
  type V4CompareSidesResponse,
} from '../../api.ts';
import { EChartPanel } from '../EChartPanel.tsx';
import {
  DYNAMIC_SIDE_COLORS,
  extractPrimaryDimensions,
} from './cockpit-v4-helpers.ts';

interface CockpitMcdaDrawerProps {
  runs: StoredRunSummary[];
  systemId: string;
  systemDag?: EvaluationSystemDag | null;
  activeRecord?: StoredV4EvalRecord | null;
  availableSides: string[];
  onClose: () => void;
}

interface McdaComparisonState {
  alternatives: Array<{
    runId: string;
    label: string;
    overallScore: number | null;
    dimScores: number[];
  }>;
  dimNames: string[];
  hasMissingFallback: boolean;
  topsisRanking: Array<{
    rank: number;
    name: string;
    closeness: number;
    dPlus: number;
    dMinus: number;
  }>;
  vikorRanking: Array<{
    rank: number;
    name: string;
    S: number;
    R: number;
    Q: number;
  }>;
  acceptableAdvantage: boolean;
  acceptableStability: boolean;
  compromiseBest: string;
}

export function CockpitMcdaDrawer({
  runs,
  systemId,
  systemDag,
  activeRecord,
  availableSides,
  onClose,
}: CockpitMcdaDrawerProps) {
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>(() =>
    [...runs]
      .sort((a, b) => a.unitCount - b.unitCount)
      .slice(0, Math.min(2, runs.length))
      .map((r) => r.runId),
  );
  const [targetSide, setTargetSide] = useState<string>('ALL');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<McdaComparisonState | null>(null);

  useEffect(() => {
    setSelectedRunIds((prev) => {
      const valid = prev.filter((id) => runs.some((r) => r.runId === id));
      return valid.length >= 2
        ? valid
        : [...runs]
            .sort((a, b) => a.unitCount - b.unitCount)
            .slice(0, Math.min(2, runs.length))
            .map((r) => r.runId);
    });
  }, [runs]);

  const toggleRun = (runId: string) => {
    setSelectedRunIds((prev) =>
      prev.includes(runId) ? prev.filter((id) => id !== runId) : [...prev, runId],
    );
  };

  const handleRunMcda = async () => {
    if (selectedRunIds.length < 2) {
      setErrorMsg('请至少勾选 2 局推演样本进行对比排序');
      return;
    }
    if (!systemId) {
      setErrorMsg('请先选择评估体系');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      let resolvedDag = systemDag ?? null;
      if (!resolvedDag) {
        const sysRes = await evalApi.listV4SystemDags().catch(() => null);
        resolvedDag = sysRes?.systems?.find((s) => s.systemId === systemId) ?? null;
      }

      const batch: Array<{
        runId: string;
        label: string;
        resp: Pick<V4CompareSidesResponse, 'overall' | 'bySide' | 'sides'>;
      }> = [];
      for (const runId of selectedRunIds) {
        if (activeRecord && activeRecord.runId === runId && activeRecord.systemId === systemId) {
          const runMeta = runs.find((r) => r.runId === runId);
          batch.push({
            runId,
            label: runMeta?.scenarioName || runId,
            resp: {
              overall: activeRecord.overall,
              bySide: activeRecord.bySide,
              sides: activeRecord.sides,
            },
          });
          continue;
        }
        const resp = await evalApi.compareV4SystemSides(systemId, {
          runId,
          persist: false,
          ...(resolvedDag ? { system: resolvedDag } : {}),
        });
        const runMeta = runs.find((r) => r.runId === runId);
        batch.push({
          runId,
          label: runMeta?.scenarioName || runId,
          resp,
        });
      }

      const perRunDims = batch.map((item) => {
        const chosenEval =
          targetSide !== 'ALL' && item.resp.bySide?.[targetSide]
            ? item.resp.bySide[targetSide]
            : item.resp.overall;
        const dims = extractPrimaryDimensions(
          resolvedDag,
          item.resp.overall,
          item.resp.bySide,
          item.resp.sides ?? [],
        );
        return {
          ...item,
          chosenEval,
          dims,
        };
      });

      const templateDims = perRunDims[0]?.dims ?? [];
      if (templateDims.length === 0) {
        throw new Error('所选评估体系未解析出一级能力维度，无法构造 MCDA 决策矩阵');
      }

      const rawWeightSum = templateDims.reduce((acc, d) => acc + Math.max(0, d.weight), 0);
      const weights =
        rawWeightSum > 0
          ? templateDims.map((d) => Math.max(0, d.weight) / rawWeightSum)
          : templateDims.map(() => 1 / templateDims.length);

      let hasMissingFallback = false;
      const matrix = perRunDims.map((item) =>
        templateDims.map((td) => {
          const matched = item.dims.find((d) => d.nodeId === td.nodeId);
          const val =
            targetSide !== 'ALL'
              ? matched?.bySideScores?.[targetSide] ?? matched?.overallScore
              : matched?.overallScore;
          if (val === null || val === undefined || !Number.isFinite(val)) {
            hasMissingFallback = true;
            return 0;
          }
          return Number(val.toFixed(2));
        }),
      );

      const alternatives = perRunDims.map((item) => item.label);
      const directions = templateDims.map(() => 'larger_is_better' as const);

      const [topsisRes, vikorRes] = await Promise.all([
        evalApi.computeTopsis({ matrix, weights, directions, alternatives }),
        evalApi.computeVikor({ matrix, weights, directions, alternatives, v: 0.5 }),
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

      setResult({
        alternatives: perRunDims.map((item, idx) => ({
          runId: item.runId,
          label: item.label,
          overallScore: item.chosenEval?.overallScore ?? null,
          dimScores: matrix[idx],
        })),
        dimNames: templateDims.map((d) => d.label),
        hasMissingFallback,
        topsisRanking: topsisRes.ranking,
        vikorRanking: vikorRes.ranking,
        acceptableAdvantage,
        acceptableStability,
        compromiseBest: vikorRes.compromiseBest || sortedVikor[0]?.name || '',
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const radarOption = useMemo<echarts.EChartsOption>(() => {
    if (!result || result.dimNames.length < 3) {
      return {
        backgroundColor: 'transparent',
        title: {
          text: result ? '维度不足 3 项，请查看左侧排位表' : '勾选样本并点击运行对比',
          left: 'center',
          top: 'middle',
          textStyle: { color: '#64748b', fontSize: 11, fontWeight: 'normal' },
        },
      };
    }

    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item' },
      legend: {
        bottom: 0,
        textStyle: { color: '#cbd5e1', fontSize: 10 },
      },
      radar: {
        indicator: result.dimNames.map((n) => ({ name: n, max: 100 })),
        radius: '60%',
        center: ['50%', '45%'],
        axisName: { color: '#cbd5e1', fontSize: 10 },
        splitLine: { lineStyle: { color: '#1e293b' } },
        axisLine: { lineStyle: { color: '#334155' } },
      },
      series: [
        {
          type: 'radar',
          data: result.alternatives.map((alt, idx) => ({
            name: alt.label,
            value: alt.dimScores,
            lineStyle: {
              width: 2,
              color: DYNAMIC_SIDE_COLORS[idx % DYNAMIC_SIDE_COLORS.length],
            },
            itemStyle: {
              color: DYNAMIC_SIDE_COLORS[idx % DYNAMIC_SIDE_COLORS.length],
            },
            areaStyle: { opacity: 0.12 },
          })),
        },
      ],
    };
  }, [result]);

  const handleExportMd = () => {
    if (!result) return;
    const lines = [
      `# 多方案 MCDA 优选对比简报 (${systemDag?.name || systemId})`,
      '',
      `- **评估视角**：${targetSide === 'ALL' ? '综合全域' : targetSide}`,
      `- **VIKOR 推荐折中解**：**${result.compromiseBest}**（C1 可接受优势=${result.acceptableAdvantage ? '通过' : '未满足'}，C2 稳定性=${result.acceptableStability ? '通过' : '未满足'}）`,
      '',
      '| 方案名称 | 综合得分 | TOPSIS 贴近度 (Ci) | TOPSIS 排位 | VIKOR 群效益 (Si) | VIKOR 遗憾 (Ri) | VIKOR 折中 (Qi) | VIKOR 排位 |',
      '| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ];
    for (const alt of result.alternatives) {
      const top = result.topsisRanking.find((r) => r.name === alt.label);
      const vik = result.vikorRanking.find((r) => r.name === alt.label);
      lines.push(
        `| ${alt.label} | ${alt.overallScore !== null ? alt.overallScore.toFixed(1) : '缺数'} | ${top ? top.closeness.toFixed(4) : '--'} | #${top?.rank ?? '-'} | ${vik ? vik.S.toFixed(4) : '--'} | ${vik ? vik.R.toFixed(4) : '--'} | ${vik ? vik.Q.toFixed(4) : '--'} | #${vik?.rank ?? '-'} |`,
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mcda-compare-${systemId}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-xl border border-cyan-500/35 bg-[#111827] p-3.5 shadow-lg">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#30363d] pb-2.5">
        <div className="flex items-center gap-2">
          <GitCompare className="h-4 w-4 text-cyan-400" />
          <span className="text-xs font-semibold text-slate-100">
            多方案横向优选对比（TOPSIS + VIKOR）
          </span>
          {result && (
            <span className="rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
              推荐方案：{result.compromiseBest}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {availableSides.length > 0 && (
            <select
              value={targetSide}
              onChange={(e) => setTargetSide(e.target.value)}
              className="rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="ALL">综合视角</option>
              {availableSides.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            disabled={loading || selectedRunIds.length < 2}
            onClick={() => void handleRunMcda()}
            className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50 transition cursor-pointer"
          >
            <Play className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? '计算排序中...' : '执行 TOPSIS + VIKOR 对比'}</span>
          </button>

          {result && (
            <button
              type="button"
              onClick={handleExportMd}
              className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-1.5 text-xs text-slate-200 hover:border-cyan-500/50 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>导出对比简报</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            title="收起多方案对比"
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 样本多选条 */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[11px] text-slate-400">勾选对比样本（≥2 局）：</span>
        {runs.map((r) => {
          const checked = selectedRunIds.includes(r.runId);
          return (
            <label
              key={r.runId}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition cursor-pointer ${
                checked
                  ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-200'
                  : 'border-[#30363d] bg-[#0d1117] text-slate-400 hover:text-slate-200'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleRun(r.runId)}
                className="accent-cyan-500"
              />
              <span className="max-w-[200px] truncate">{r.scenarioName || r.runId}</span>
            </label>
          );
        })}
      </div>

      {errorMsg && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-rose-500/50 bg-rose-950/50 px-3 py-2 text-xs text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      {result && (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
          <div className="overflow-x-auto rounded-lg border border-[#30363d] bg-[#0d1117] lg:col-span-7">
            {result.hasMissingFallback && (
              <div className="border-b border-amber-500/30 bg-amber-950/30 px-3 py-1.5 text-[11px] text-amber-200">
                提示：部分样本个别维度数据缺失，排序矩阵中暂按 0 分计入对比。
              </div>
            )}
            <table className="w-full border-collapse text-left text-xs">
              <thead className="border-b border-[#30363d] bg-[#161b22] text-[11px] text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">方案样本</th>
                  <th className="px-2.5 py-2 font-medium text-right">综合得分</th>
                  <th className="px-2.5 py-2 font-medium text-right">TOPSIS Ci</th>
                  <th className="px-2.5 py-2 font-medium text-center">TOPSIS 排位</th>
                  <th className="px-2.5 py-2 font-medium text-right">VIKOR Qi</th>
                  <th className="px-2.5 py-2 font-medium text-center">VIKOR 排位</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#30363d]/60">
                {result.topsisRanking.map((topRow) => {
                  const alt = result.alternatives.find((a) => a.label === topRow.name);
                  const vikRow = result.vikorRanking.find((r) => r.name === topRow.name);
                  return (
                    <tr key={topRow.name} className="hover:bg-[#161b22]/70">
                      <td className="px-3 py-2 font-medium text-slate-100">{topRow.name}</td>
                      <td className="px-2.5 py-2 text-right font-mono tabular-nums text-cyan-200">
                        {alt?.overallScore !== null && alt?.overallScore !== undefined
                          ? alt.overallScore.toFixed(1)
                          : '--'}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono tabular-nums text-slate-200">
                        {topRow.closeness.toFixed(4)}
                      </td>
                      <td className="px-2.5 py-2 text-center font-mono font-semibold text-emerald-300">
                        {`Rank #${topRow.rank}`}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono tabular-nums text-slate-200">
                        {vikRow ? vikRow.Q.toFixed(4) : '--'}
                      </td>
                      <td className="px-2.5 py-2 text-center font-mono text-indigo-300">
                        {vikRow ? `#${vikRow.rank}` : '--'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5 lg:col-span-5">
            <EChartPanel option={radarOption} height={220} />
          </div>
        </div>
      )}
    </section>
  );
}
