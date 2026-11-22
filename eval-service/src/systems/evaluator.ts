import crypto from 'node:crypto';
import { applyScoringRule } from '../core/scoring-functions.ts';
import type {
  AggregationStrategy,
  EvalSummaryV2,
  EvaluatedDimensionNode,
  EvaluatedLeafNode,
  GateAuditItem,
  GateVerdict,
  IndicatorSystem,
  MetricAtomContext,
  MetricAtomResult,
  NodeMissingPolicy,
  SystemDimensionNode,
  SystemEvaluationOutput,
  SystemIndicatorLeaf,
  SystemKpiBinding,
} from '../core/types.ts';
import { defaultIndicatorStore, resolveIndicatorOutputFromAtoms, type IndicatorStore } from '../indicators/store.ts';
import type { CustomOperatorStore } from '../operators/custom-store.ts';
import { formatDuration, resolveSides } from '../operators/helpers.ts';
import type { OperatorOverrideStore } from '../operators/override-store.ts';
import { evaluateAllOperators, listOperatorMetas } from '../operators/registry.ts';
import { calculateNodeAggregation } from './aggregation-strategies.ts';
import { isDimensionNode } from './validator.ts';

function formatKpiValue(binding: SystemKpiBinding, res: MetricAtomResult | undefined): string {
  if (!res || res.status === 'unavailable' || res.value === null) {
    return '不可用 (缺失字段)';
  }
  if (typeof res.value === 'boolean') {
    return res.value ? '合规' : '违规';
  }
  const num = res.value;
  switch (binding.formatter) {
    case 'percent_ci':
    case 'ratio':
      return res.displayValue || `${(num * 100).toFixed(1)}%`;
    case 'duration_min':
      return `${(num / 60).toFixed(2)} 分钟`;
    case 'duration_sec':
      return formatDuration(num);
    case 'currency':
      return `${num.toLocaleString('en-US')}`;
    case 'count':
    default:
      return res.displayValue || String(num);
  }
}

export interface EvaluateSystemOptions {
  evalId?: string;
  indicatorStore?: IndicatorStore;
  customOperatorStore?: CustomOperatorStore;
  operatorOverrideStore?: OperatorOverrideStore;
  precomputedAtoms?: Record<string, MetricAtomResult>;
}

export function evaluateIndicatorSystem(
  system: IndicatorSystem,
  ctx: MetricAtomContext,
  options?: EvaluateSystemOptions,
): SystemEvaluationOutput {
  const indicatorStore = options?.indicatorStore ?? defaultIndicatorStore;
  // 按体系默认 WRA 规则注入上下文（调用方显式传入优先）
  const effectiveCtx: MetricAtomContext =
    system.defaultWraRules && !ctx.customParams?.wraRules
      ? {
          ...ctx,
          customParams: {
            ...(ctx.customParams ?? {}),
            wraRules: system.defaultWraRules,
          },
        }
      : ctx;
  const atomResults =
    options?.precomputedAtoms ??
    evaluateAllOperators(effectiveCtx, options?.customOperatorStore, options?.operatorOverrideStore);
  const evalId = options?.evalId ?? `eval-${crypto.randomUUID().slice(0, 8)}`;

  const evalNode = (
    node: SystemDimensionNode | SystemIndicatorLeaf,
    depth = 1,
  ): EvaluatedDimensionNode | EvaluatedLeafNode => {
    if (!isDimensionNode(node)) {
      const def = indicatorStore.get(node.indicatorRef);
      if (!def) {
        const missingRaw: MetricAtomResult = {
          atomId: node.indicatorRef,
          value: null,
          displayValue: '指标未定义',
          status: 'unavailable',
          confidence: 'low',
          evidenceRefs: [],
          missingDataReason: `指标库中缺少 ${node.indicatorRef}`,
        };
        return {
          kind: 'indicator',
          id: node.id,
          nodeCode: node.nodeCode,
          indicatorRef: node.indicatorRef,
          name: node.customLabel || node.indicatorRef,
          atomRef: node.indicatorRef,
          weight: node.weight,
          effectiveWeight: 0,
          rawResult: missingRaw,
          score: null,
          weightedContribution: 0,
          depth,
        };
      }

      const { rawResult, score } = resolveIndicatorOutputFromAtoms(def, atomResults);

      return {
        kind: 'indicator',
        id: node.id,
        nodeCode: node.nodeCode,
        indicatorRef: node.indicatorRef,
        name: node.customLabel || def.name || node.indicatorRef,
        atomRef: def.atomRef,
        weight: node.weight,
        effectiveWeight: score !== null ? node.weight : 0,
        rawResult,
        score,
        weightedContribution: score !== null ? Math.round(score * node.weight * 100) / 100 : 0,
        depth,
      };
    }

    const evaluatedChildren = node.children.map((ch) => evalNode(ch, depth + 1));
    const strategy: AggregationStrategy =
      node.aggregation?.mode === 'formula'
        ? 'formula'
        : node.aggregation?.strategy ?? 'weighted_sum';
    const missingPolicy: NodeMissingPolicy = node.aggregation?.missingPolicy ?? 'skip_renormalize';
    const customFormula = node.aggregation?.customFormula;

    const childInputs = evaluatedChildren.map((ch) => ({
      id: ch.kind === 'dimension' ? ch.id : (ch.id || ch.indicatorRef),
      nodeCode: ch.nodeCode,
      weight: ch.weight,
      score: ch.score,
    }));

    const aggRes = calculateNodeAggregation(strategy, missingPolicy, childInputs, customFormula);

    for (let i = 0; i < evaluatedChildren.length; i += 1) {
      const ch = evaluatedChildren[i];
      ch.effectiveWeight = aggRes.effectiveWeights[i] ?? 0;
      if (ch.kind === 'indicator' && ch.score !== null) {
        ch.weightedContribution = Math.round(ch.score * ch.effectiveWeight * 100) / 100;
      }
    }

    return {
      kind: 'dimension',
      id: node.id,
      nodeCode: node.nodeCode,
      name: node.name,
      weight: node.weight,
      effectiveWeight: aggRes.score !== null ? node.weight : 0,
      score: aggRes.score,
      availableWeightRatio: aggRes.availableWeightRatio,
      strategyUsed: aggRes.strategyUsed,
      missingPolicyUsed: aggRes.missingPolicyUsed,
      formulaApplied: aggRes.formulaApplied,
      depth,
      children: evaluatedChildren,
    };
  };

  const rootChildren = system.root.children.map((c) => evalNode(c, 1));
  const rootStrategy: AggregationStrategy =
    system.root.aggregation?.mode === 'formula'
      ? 'formula'
      : system.root.aggregation?.strategy ?? 'weighted_sum';
  const rootMissingPolicy: NodeMissingPolicy =
    system.root.aggregation?.missingPolicy ?? 'skip_renormalize';
  const rootCustomFormula = system.root.aggregation?.customFormula;

  const rootChildInputs = rootChildren.map((ch) => ({
    id: ch.kind === 'dimension' ? ch.id : (ch.id || ch.indicatorRef),
    nodeCode: ch.nodeCode,
    weight: ch.weight,
    score: ch.score,
  }));

  const rootAggRes = calculateNodeAggregation(
    rootStrategy,
    rootMissingPolicy,
    rootChildInputs,
    rootCustomFormula,
  );

  for (let i = 0; i < rootChildren.length; i += 1) {
    const ch = rootChildren[i];
    ch.effectiveWeight = rootAggRes.effectiveWeights[i] ?? 0;
    if (ch.kind === 'indicator' && ch.score !== null) {
      ch.weightedContribution = Math.round(ch.score * ch.effectiveWeight * 100) / 100;
    }
  }

  const availableWeightRatio = rootAggRes.availableWeightRatio;
  const rawOverallScore = rootAggRes.score;

  // 独立审计全部 GATE 角色安全红线（双轨制：保留 rawOverallScore，Hard Gate 违例封顶 <= 39）
  const allMetas = listOperatorMetas(options?.customOperatorStore, options?.operatorOverrideStore);
  const gateAudit: GateAuditItem[] = [];
  let hasHardViolation = false;
  let hasSoftViolation = false;

  for (const meta of allMetas) {
    if (meta.evalRole !== 'GATE') continue;
    const res = atomResults[meta.id];
    const gateMode = system.gatePolicies?.[meta.id] ?? meta.gateMode ?? 'soft';
    const gateStatus = res?.gateStatus ?? (res?.status === 'unavailable' ? 'unavailable' : 'pass');
    gateAudit.push({
      atomId: meta.id,
      name: meta.name,
      gateMode,
      gateStatus,
      displayValue: res?.displayValue ?? '未评估',
      evidenceRefs: res?.evidenceRefs ?? [],
    });
    if (gateStatus === 'violated') {
      if (gateMode === 'hard') hasHardViolation = true;
      else hasSoftViolation = true;
    }
  }

  const gateVerdict: GateVerdict = hasHardViolation
    ? 'DISQUALIFIED'
    : hasSoftViolation
      ? 'WARNING'
      : 'PASS';

  const overallScore =
    rawOverallScore === null
      ? null
      : hasHardViolation
        ? Math.min(rawOverallScore, 39)
        : rawOverallScore;

  let overallConfidence: 'high' | 'medium' | 'low' = 'low';
  if (overallScore !== null) {
    overallConfidence =
      availableWeightRatio >= 0.75 ? 'high' : availableWeightRatio >= 0.4 ? 'medium' : 'low';
  }

  const dimensions: Array<{ id: string; name: string; weight: number; score: number | null }> = [];
  for (const ch of rootChildren) {
    if (ch.kind === 'dimension') {
      dimensions.push({ id: ch.id, name: ch.name, weight: ch.weight, score: ch.score });
    } else {
      dimensions.push({ id: ch.indicatorRef, name: ch.name, weight: ch.weight, score: ch.score });
    }
  }

  // 构建 eval-summary.json v2 (严格对齐 StatBoard.tsx + 雷达 + 证据时间轴)
  const { targetSide, enemySide } = resolveSides(ctx.situation, ctx.customParams);
  const kpis = (system.kpis ?? []).map((k) => {
    const res = atomResults[k.atomRef];
    return {
      label: k.label,
      value: formatKpiValue(k, res),
      status: res?.status ?? 'unavailable',
      atomRef: k.atomRef,
    };
  });

  const bars = dimensions.map((d) => ({
    label: d.name,
    value: d.score !== null ? Math.round(d.score * 10) / 10 : 0,
    unit: '分',
  }));

  const radar = {
    dimensions: dimensions.map((d) => d.name),
    scores: dimensions.map((d) => (d.score !== null ? Math.round(d.score * 10) / 10 : 0)),
    benchmark: dimensions.map(() => 80),
  };

  const validDims = dimensions.filter((d) => d.score !== null);
  const sortedDesc = [...validDims].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const bestDim = sortedDesc[0];
  const worstDim = sortedDesc[sortedDesc.length - 1];

  const conclusionTitle =
    overallScore !== null
      ? hasHardViolation
        ? `${system.name} — [红线一票否决 DISQUALIFIED] 封顶得分 ${overallScore.toFixed(1)} (原始效能分 ${rawOverallScore?.toFixed(1)})`
        : hasSoftViolation
          ? `${system.name} — [ROE 告警 WARNING] 综合得分 ${overallScore.toFixed(1)} / 100`
          : `${system.name} — 综合得分 ${overallScore.toFixed(1)} / 100`
      : `${system.name} — 数据不完备 (无法合成总分)`;

  const conclusionParts: string[] = [
    `评估对象：${targetSide ?? '己方'}${enemySide ? ` vs ${enemySide}` : ''}（数据源：${ctx.situation.coverage.sourceKind}，指标有效权重覆盖率：${(availableWeightRatio * 100).toFixed(0)}%）。`,
  ];
  if (bestDim && worstDim) {
    conclusionParts.push(
      `分项评估中，「${bestDim.name}」得分最高（${bestDim.score?.toFixed(1)} 分），「${worstDim.name}」得分最低（${worstDim.score?.toFixed(1)} 分）。`,
    );
  }
  if (ctx.situation.coverage.warnings.length > 0) {
    conclusionParts.push(`数据提示：${ctx.situation.coverage.warnings.slice(0, 2).join('；')}。`);
  }

  let judgement = '数据缺失无法评定';
  if (hasHardViolation) {
    const violatedNames = gateAudit
      .filter((g) => g.gateStatus === 'violated' && g.gateMode === 'hard')
      .map((g) => g.name)
      .join('、');
    judgement = `安全红线一票否决 (DISQUALIFIED) · 触发硬红线：${violatedNames}（生效得分封顶 ${overallScore?.toFixed(1) ?? 'N/A'}，原始效能分 ${rawOverallScore?.toFixed(1) ?? 'N/A'}）`;
  } else if (overallScore !== null) {
    if (overallScore >= 85) judgement = '优等 (A) · 战术达成度高，各核心指标均达标';
    else if (overallScore >= 75) judgement = '良好 (B+) · 战术态势良好，主要作战效能达标';
    else if (overallScore >= 60) judgement = '中等 (B) · 基本满足战术要求，部分指标存在不足';
    else judgement = '不达标 (C/D) · 关键杀伤链或条令合规未达基本要求';
    if (hasSoftViolation) {
      judgement = `${judgement}（注意：存在 ROE 软红线告警）`;
    }
    if (availableWeightRatio < 0.6) {
      judgement = `${judgement}（部分遥测数据缺失，置信度下调为 ${overallConfidence}）`;
    }
  }

  const keyEvents = ctx.situation.events
    .filter((e) =>
      e.severity === 'major' ||
      e.kind === 'weapon_fired' ||
      e.kind === 'weapon_endgame' ||
      e.kind === 'detection_new',
    )
    .sort((a, b) => a.scenarioSeconds - b.scenarioSeconds)
    .slice(0, 24);

  const evidenceTimeline = keyEvents.map((e) => ({
    scenarioClock: e.clockText,
    event: e.kind,
    ref: String(e.ref),
    desc: `${e.side ? `[${e.side}] ` : ''}${e.subject ?? ''}${e.object ? ` -> ${e.object}` : ''}`,
  }));

  const evalSummaryV2: EvalSummaryV2 = {
    kpis,
    compareNote: `视角 ${targetSide ?? '默认'}${enemySide ? ` 对阵 ${enemySide}` : ''} · 有效指标覆盖率 ${(availableWeightRatio * 100).toFixed(0)}% · 推演跨度 ${ctx.situation.startGameClock}~${ctx.situation.endGameClock}`,
    bars,
    radar,
    conclusionTitle,
    conclusion: conclusionParts.join(' '),
    judgement,
    evidenceTimeline,
  };

  return {
    evalId,
    runId: ctx.runId,
    systemId: system.systemId,
    systemName: system.name,
    systemVersion: system.version,
    createdAt: new Date().toISOString(),
    overallScore,
    rawOverallScore,
    gateVerdict,
    gateAudit,
    overallConfidence,
    availableWeightRatio,
    dimensions,
    rootTree: {
      id: system.root.id,
      nodeCode: system.root.nodeCode,
      name: system.root.name,
      score: overallScore,
      strategyUsed: rootAggRes.strategyUsed,
      missingPolicyUsed: rootAggRes.missingPolicyUsed,
      formulaApplied: rootAggRes.formulaApplied,
      children: rootChildren,
    },
    atomResults,
    evalSummaryV2,
  };
}
