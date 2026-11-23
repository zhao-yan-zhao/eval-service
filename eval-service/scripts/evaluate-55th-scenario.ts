import fs from 'node:fs';
import path from 'node:path';
import { createPythonWorkerPool } from '../src/engine/python-worker.ts';
import { sliceOperatorResultsBySide } from '../src/engine/v4-routes.ts';
import {
  defaultMetricGraphStore,
  evaluateMetricGraph,
  type MetricGraphExecutionResult,
  type MetricOperatorInput,
} from '../src/indicators/metric-graph-store.ts';
import { ALL_V4_OPERATOR_SCRIPTS, V4OperatorRunner } from '../src/operators/v4/index.ts';
import type { EvaluationDagOutput, EvaluationSystemDag, MetricGraphDefinition } from '../src/core/types.ts';
import { evaluateSystemDag } from '../src/systems/dag-evaluator.ts';
import { defaultSystemDagStore } from '../src/systems/system-dag-store.ts';

const TARGET_SIDES = ['红方', '绿方', '蓝方'] as const;
type TargetSide = (typeof TARGET_SIDES)[number];

interface SideEvaluationBundle {
  side: TargetSide;
  mgResult: MetricGraphExecutionResult;
  mgLatencyMs: number;
  sysEval: EvaluationDagOutput;
}

function buildMetricChapterResolver(mgDef: MetricGraphDefinition) {
  const opSpecById = new Map(ALL_V4_OPERATOR_SCRIPTS.map((s) => [s.id, s]));
  const nodeById = new Map(mgDef.nodes.map((n) => [n.id, n]));
  const nodeIdByMetricId = new Map<string, string>();
  for (const node of mgDef.nodes) {
    if (node.metricConfig?.metricId) {
      nodeIdByMetricId.set(node.metricConfig.metricId, node.id);
    }
  }

  const incomingSourceIds = new Map<string, string[]>();
  for (const node of mgDef.nodes) {
    incomingSourceIds.set(node.id, []);
  }
  for (const edge of mgDef.edges ?? []) {
    incomingSourceIds.get(edge.targetNodeId)?.push(edge.sourceNodeId);
  }

  const resolveChapters = (nodeId: string, visited = new Set<string>()): number[] => {
    if (visited.has(nodeId)) return [];
    visited.add(nodeId);

    const node = nodeById.get(nodeId);
    if (!node) return [];
    const mc = node.metricConfig;
    const mode = mc?.mode ?? 'from_operator';

    if (mode === 'from_operator') {
      const opId = mc?.sourceRef || node.id;
      const spec = opSpecById.get(opId);
      return spec ? [spec.chapter] : [];
    }

    const chapterSet = new Set<number>();
    if (mc?.sourceRef) {
      const refNodeId = nodeById.has(mc.sourceRef)
        ? mc.sourceRef
        : nodeIdByMetricId.get(mc.sourceRef);
      if (refNodeId) {
        for (const ch of resolveChapters(refNodeId, new Set(visited))) {
          chapterSet.add(ch);
        }
      } else {
        const directOp = opSpecById.get(mc.sourceRef);
        if (directOp) chapterSet.add(directOp.chapter);
      }
    }

    for (const srcId of incomingSourceIds.get(nodeId) ?? []) {
      for (const ch of resolveChapters(srcId, new Set(visited))) {
        chapterSet.add(ch);
      }
    }

    return [...chapterSet].sort((a, b) => a - b);
  };

  return (nodeId: string): string => {
    const chapters = resolveChapters(nodeId);
    if (chapters.length === 0) return '-';
    if (chapters.length === 1) return `第 ${chapters[0]} 章`;
    return `第 ${chapters.join(', ')} 章`;
  };
}

function formatMetricValue(val: number | boolean | null | undefined): string {
  if (val === null || val === undefined) return '-';
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return '-';
    return Math.abs(val) >= 1000 ? val.toFixed(2) : val.toFixed(4);
  }
  return String(val);
}

function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return '`unavailable`';
  }
  return `**${score.toFixed(2)}**`;
}

function resolveAdvantageSide(bundles: SideEvaluationBundle[], getter: (b: SideEvaluationBundle) => number | null | undefined): string {
  const ranked = bundles
    .map((b) => ({ side: b.side, val: getter(b) }))
    .filter((item): item is { side: TargetSide; val: number } => typeof item.val === 'number' && Number.isFinite(item.val));
  if (ranked.length === 0) return '-';
  ranked.sort((a, b) => b.val - a.val);
  if (ranked.length > 1 && Math.abs(ranked[0].val - ranked[1].val) < 1e-6) {
    return ranked.filter((r) => Math.abs(r.val - ranked[0].val) < 1e-6).map((r) => r.side).join(' / ');
  }
  return ranked[0].side;
}

async function runEndToEndEvaluation() {
  const csvDir = process.env.F1_55TH_CSV_DIR || 'J:\\55所\\想定导出\\EventExport_CSV';
  const outDir = path.resolve(import.meta.dirname, '..', 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, '55th-taihai-evaluation-report.md');

  console.log(`[E2E] Starting Plan A End-to-End Evaluation on 55th dataset: ${csvDir}`);

  const pool = createPythonWorkerPool({ timeoutMs: 120_000 });
  const runner = new V4OperatorRunner(ALL_V4_OPERATOR_SCRIPTS);

  try {
    const ping = await pool.ping();
    console.log(`[E2E] Python worker initialized: ${ping.pythonVersion}, PID: ${ping.pid}`);

    // ──────────────────── 阶段 1: 一库实证算子 DAG 真机执行 ────────────────────
    console.log(`[E2E] Stage 1: Executing ${ALL_V4_OPERATOR_SCRIPTS.length} V4 Operators DAG...`);
    const opStartTime = Date.now();
    const opDagResult = await runner.runDag(
      ALL_V4_OPERATOR_SCRIPTS.map((s) => s.id),
      {
        runId: 'e2e-55th-taihai',
        csvDir,
        pythonPool: pool,
        timeoutMs: 120_000,
      },
    );
    const opTotalMs = Date.now() - opStartTime;
    console.log(
      `[E2E] Stage 1 finished in ${opTotalMs}ms. Topological order count: ${opDagResult.topologicalOrder.length}`,
    );

    // ──────────────────── 阶段 2 & 3: 二库客观指标 DAG + 三库效果体系（三阵营全评估） ────────────────────
    const mgDef =
      defaultMetricGraphStore.get('mg_v4_metrics_guide_full') ??
      defaultMetricGraphStore.listAll()[0];
    if (!mgDef) throw new Error('Metric graph mg_v4_metrics_guide_full not found!');

    const sysDef =
      defaultSystemDagStore.get('sys_v4_metrics_guide_full') ??
      defaultSystemDagStore.listAll()[0];
    if (!sysDef) throw new Error('System DAG sys_v4_metrics_guide_full not found!');

    const operatorInputs: Record<string, MetricOperatorInput> = {};
    for (const [opId, res] of Object.entries(opDagResult.results)) {
      operatorInputs[opId] = {
        status: res.status,
        dataset: res.dataset,
        evidenceRefs: res.evidenceRefs,
        missingDataReason: res.missingDataReason,
        cacheKey: res.cacheKey,
      };
    }

    const sideBundles: SideEvaluationBundle[] = [];
    for (const side of TARGET_SIDES) {
      console.log(`[E2E] Evaluating Side (${side}) via shared sliceOperatorResultsBySide...`);
      const slicedInputs = sliceOperatorResultsBySide(operatorInputs, side);
      const mgStart = Date.now();
      const mgResult = await evaluateMetricGraph(mgDef, slicedInputs, {
        runId: `e2e-55th-mg-${side}`,
      });
      const mgLatencyMs = Date.now() - mgStart;

      const sysEval = evaluateSystemDag(
        {
          ...sysDef,
          globalParams: {
            ...(sysDef.globalParams ?? {}),
            targetSide: side,
          },
        },
        mgResult.metricInputsForSystem,
        { evalId: `eval-55th-${side}`, runId: 'e2e-55th-taihai' },
      );

      sideBundles.push({ side, mgResult, mgLatencyMs, sysEval });
      console.log(
        `  ${side}: overallScore=${sysEval.overallScore?.toFixed(2) ?? 'null'}, raw=${sysEval.rawOverallScore?.toFixed(2) ?? 'null'}, gate=${sysEval.gateVerdict}, validWeightRatio=${(sysEval.availableWeightRatio * 100).toFixed(1)}%`,
      );
    }

    const reportMd = generateMarkdownReport({
      csvDir,
      opDagResult,
      opTotalMs,
      mgDef,
      sysDef,
      sideBundles,
    });

    fs.writeFileSync(reportPath, reportMd, 'utf8');
    console.log(`[E2E] Report successfully written to: ${reportPath}`);

    return {
      opDagResult,
      sideBundles,
      reportPath,
    };
  } finally {
    await pool.dispose();
  }
}

function generateMarkdownReport(data: {
  csvDir: string;
  opDagResult: Awaited<ReturnType<V4OperatorRunner['runDag']>>;
  opTotalMs: number;
  mgDef: MetricGraphDefinition;
  sysDef: EvaluationSystemDag;
  sideBundles: SideEvaluationBundle[];
}): string {
  const { csvDir, opDagResult, opTotalMs, mgDef, sysDef, sideBundles } = data;
  const bundleBySide = new Map(sideBundles.map((b) => [b.side, b]));
  const red = bundleBySide.get('红方')!;
  const green = bundleBySide.get('绿方')!;
  const blue = bundleBySide.get('蓝方')!;

  const allOpResults = Object.values(opDagResult.results);
  const validOps = allOpResults.filter((r) => r.status === 'valid');
  const unavailOps = allOpResults.filter((r) => r.status === 'unavailable');

  const resolveChapterLabel = buildMetricChapterResolver(mgDef);

  // 动态读取终态效果节点及其直接子领域节点（零硬编码 ID 假设）
  const sysNodeById = new Map(sysDef.nodes.map((n) => [n.id, n]));
  const terminalIncomingEdges = sysDef.edges.filter(
    (e) => e.targetNodeId === sysDef.terminalEffectNodeId,
  );

  let md = `# F1 推演评估中台 V4 Plan A 真机实证评估报告（55所台海场景 · 三阵营全量）

> **生成时间**：${new Date().toISOString()}  
> **数据源路径**：\`${csvDir}\`  
> **推演架构版本**：F1 Eval-Service V4 Plan A（纯客观事实算子 + 共享阵营切片 + 二库分层聚合 + 三库效果合成）  
> **评估体系**：\`${sysDef.systemId}\`（${sysDef.name}） ⟵ \`${mgDef.graphId}\`（${mgDef.name}）  
> **实证准则**：**Fail-Closed 零臆造原则**（缺失底表或空切片严格返回 \`unavailable\` 并标明理由，严禁伪造默认数值）

---

## 1. 评估总览与三阵营效能对比（红方 / 绿方 / 蓝方）

| 对比维度 | 红方 (Red) | 绿方 (Green) | 蓝方 (Blue) | 优势方 | 说明 |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **体系综合效能最终得分** | ${formatScore(red.sysEval.overallScore)} | ${formatScore(green.sysEval.overallScore)} | ${formatScore(blue.sysEval.overallScore)} | **${resolveAdvantageSide(sideBundles, (b) => b.sysEval.overallScore)}** | 门控裁决后的终态效果分 |
| **未受门控封顶原始分** | ${formatScore(red.sysEval.rawOverallScore)} | ${formatScore(green.sysEval.rawOverallScore)} | ${formatScore(blue.sysEval.rawOverallScore)} | **${resolveAdvantageSide(sideBundles, (b) => b.sysEval.rawOverallScore)}** | 门控一票否决前无量纲效果总分 |
| **红线安全门控裁决** | **\`${red.sysEval.gateVerdict}\`** | **\`${green.sysEval.gateVerdict}\`** | **\`${blue.sysEval.gateVerdict}\`** | - | Hard 一票否决与 Soft 预警双轨审计 |
| **有效权重覆盖率** | \`${(red.sysEval.availableWeightRatio * 100).toFixed(1)}%\` | \`${(green.sysEval.availableWeightRatio * 100).toFixed(1)}%\` | \`${(blue.sysEval.availableWeightRatio * 100).toFixed(1)}%\` | - | \`skip_renormalize\` 动态有效权重比 |
`;

  for (const edge of terminalIncomingEdges) {
    const domNode = sysNodeById.get(edge.sourceNodeId);
    const label = domNode?.label ?? edge.sourceNodeId;
    const weightStr = typeof edge.weight === 'number' ? `权重 ${edge.weight.toFixed(2)}` : '动态权重';
    md += `| **${label}** | ${formatScore(red.sysEval.nodeResults[edge.sourceNodeId]?.score)} | ${formatScore(green.sysEval.nodeResults[edge.sourceNodeId]?.score)} | ${formatScore(blue.sysEval.nodeResults[edge.sourceNodeId]?.score)} | **${resolveAdvantageSide(sideBundles, (b) => b.sysEval.nodeResults[edge.sourceNodeId]?.score)}** | ${weightStr} (\`${edge.sourceNodeId}\`) |\n`;
  }

  md += `\n---

## 2. 红线门控安全审计明细

双轨门控机制严格按照军事交战规则执行：**Hard GATE** 违规触发一票否决并将体系总分封顶至 39 分；**Soft GATE** 违规记录 \`WARNING\` 预警并保留诊断溯源。
`;

  for (const bundle of sideBundles) {
    md += `\n### 2.${sideBundles.indexOf(bundle) + 1} ${bundle.side}门控审计
| 门控名称 | 门控模式 | 裁决状态 | 实测物理值 | 审计结论 |
| :--- | :---: | :---: | :---: | :--- |
`;
    if (bundle.sysEval.gateAudit.length === 0) {
      md += `| (无门控节点) | - | - | - | - |\n`;
    } else {
      for (const item of bundle.sysEval.gateAudit) {
        const statusIcon =
          item.gateStatus === 'pass'
            ? '✅ PASS'
            : item.gateStatus === 'violated'
            ? '❌ VIOLATED'
            : '⚠️ UNAVAILABLE';
        const conclusion =
          item.gateStatus === 'pass'
            ? '安全受控'
            : item.gateStatus === 'violated'
            ? item.gateMode === 'hard'
              ? '触发一票否决 (总分封顶 <= 39)'
              : '触发软门控告警 (WARNING)'
            : '数据缺失 (Fail-Closed)';
        md += `| ${item.name} | \`${item.gateMode.toUpperCase()}\` | **${statusIcon}** | \`${item.displayValue}\` | ${conclusion} |\n`;
      }
    }
  }

  md += `\n---

## 3. 三库多层效果节点评分明细（三阵营对照）

本体系严格遵循局部入边权重和 $\\sum w_i = 1.0000$ 运筹学约束，节点缺数时由 \`skip_renormalize\` 动态重归一有效入边权重。

| 层级 | 效果节点名称 | 节点ID | 角色 | 红方得分 | 绿方得分 | 蓝方得分 | 映射/聚合策略 |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
`;

  for (const nodeId of red.sysEval.topologicalOrder) {
    const rNode = red.sysEval.nodeResults[nodeId];
    if (!rNode || rNode.role === 'metric_proxy') continue;
    const gNode = green.sysEval.nodeResults[nodeId];
    const bNode = blue.sysEval.nodeResults[nodeId];
    md += `| ${rNode.depth} | ${rNode.label} | \`${nodeId}\` | \`${rNode.role}\` | ${formatScore(rNode.score)} | ${formatScore(gNode?.score)} | ${formatScore(bNode?.score)} | \`${rNode.strategyUsed ?? 'metricBinding'}\` |\n`;
  }

  md += `\n---

## 4. 二库客观指标 DAG 计算结果（严格由算子 \`spec.chapter\` 溯源）

二库指标严格强隔离，不包含任何打分函数或权重，纯粹反映推演仿真产生的物理度量与多维聚合值。

| 章节 | 指标名称 | 指标ID | 计算模式 | 运筹层级 | 红方实测值 | 绿方实测值 | 蓝方实测值 | 状态 | 量纲单位 |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
`;

  for (const nodeId of red.mgResult.topologicalOrder) {
    const node = mgDef.nodes.find((n) => n.id === nodeId);
    if (!node) continue;
    const mc = node.metricConfig;
    const rRes = red.mgResult.nodeResults[nodeId];
    const gRes = green.mgResult.nodeResults[nodeId];
    const bRes = blue.mgResult.nodeResults[nodeId];

    const anyValid =
      rRes?.status === 'valid' || gRes?.status === 'valid' || bRes?.status === 'valid';
    const statusBadge = anyValid ? '✅ valid' : '⚠️ unavailable';
    const chapterStr = resolveChapterLabel(nodeId);

    md += `| ${chapterStr} | ${mc?.name ?? node.label} | \`${mc?.metricId ?? node.id}\` | \`${mc?.mode ?? '-'}\` | \`${mc?.militaryLevel ?? '-'}\` | \`${formatMetricValue(rRes?.value)}\` | \`${formatMetricValue(gRes?.value)}\` | \`${formatMetricValue(bRes?.value)}\` | ${statusBadge} | \`${mc?.unit ?? '-'}\` |\n`;
  }

  md += `\n---

## 5. 一库 ${ALL_V4_OPERATOR_SCRIPTS.length} 项实证算子真机体检矩阵（有效 ${validOps.length} / 不可用 ${unavailOps.length}）

一库算子通过常驻 Python Worker 进程池执行，支持双 UTF-8 BOM 自动剔除与列裁剪加速。本次真机体检执行耗时 **${(opTotalMs / 1000).toFixed(1)} 秒**。

| 序号 | 算子名称 | 算子ID | 层级定位 | 章节 | 状态 | 产出行数 | 产出列数 | 耗时(ms) | 核心产出列明细 |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
`;

  let idx = 1;
  for (const opId of opDagResult.topologicalOrder) {
    const res = opDagResult.results[opId];
    const spec = ALL_V4_OPERATOR_SCRIPTS.find((s) => s.id === opId);
    const rows = res?.dataset?.rows?.length ?? 0;
    const cols = res?.dataset?.columns?.length ?? 0;
    const colNames = res?.dataset?.columns?.map((c) => c.name).join(', ') ?? '-';
    const statusBadge = res?.status === 'valid' ? '✅ valid' : '⚠️ unavailable';
    const msStr = typeof res?.latencyMs === 'number' ? res.latencyMs.toFixed(1) : '0';
    const layerLabel = (spec as { layer?: string } | undefined)?.layer ?? 'fact';
    md += `| ${idx++} | ${spec?.name ?? opId} | \`${opId}\` | \`${layerLabel}\` | 第 ${spec?.chapter ?? '-'} 章 | ${statusBadge} | ${rows} | ${cols} | ${msStr} | \`${colNames.slice(0, 50)}${colNames.length > 50 ? '...' : ''}\` |\n`;
  }

  md += `\n---

## 6. Fail-Closed 缺失证据链与缺表诊断分析

根据推演评估中台实证门控铁律，当推演引擎未导出特定事件表或某阵营在某维度无样本时，评估系统绝不伪造默认数值（杜绝 \`|| 0.85\`），严格返回 \`unavailable\` 并将缺失证据链向上透传。

| 算子ID | 算子名称 | 缺失必需表 | 缺失判定证据说明 |
| :--- | :--- | :--- | :--- |
`;

  if (unavailOps.length === 0) {
    md += `| (无) | 全部算子均具备有效证据链 | - | - |\n`;
  } else {
    for (const op of unavailOps) {
      const spec = ALL_V4_OPERATOR_SCRIPTS.find((s) => s.id === op.nodeId);
      md += `| \`${op.nodeId}\` | ${spec?.name ?? op.nodeId} | \`${spec?.requiredTables.join(', ') ?? '-'}\` | ${op.missingDataReason ?? '-'} |\n`;
    }
  }

  md += `\n---

## 7. 结论与交付合规性声明

1. **三库 Plan A 强隔离验证**：一库共执行 **${ALL_V4_OPERATOR_SCRIPTS.length}** 项算子（有效 **${validOps.length}** 项，Fail-Closed 不可用 **${unavailOps.length}** 项），二库 \`${mgDef.graphId}\` 共计算 **${mgDef.nodes.length}** 项客观指标，三库 \`${sysDef.systemId}\` 完成全部 **${TARGET_SIDES.length}** 个活跃阵营（红方 / 绿方 / 蓝方）评估。
2. **前后端统一阵营切片管道**：本脚本与 REST API（\`/api/v4/metric-graphs/execute\`、\`/api/v4/system-dags/evaluate\`）共同调用 \`v4-routes.ts\` 导出的 \`sliceOperatorResultsBySide\`，彻底消除双份实现漂移。
3. **三阵营评估结果摘要**：
   - 红方综合得分 **${red.sysEval.overallScore?.toFixed(2) ?? 'unavailable'}**（门控裁决 \`${red.sysEval.gateVerdict}\`）
   - 绿方综合得分 **${green.sysEval.overallScore?.toFixed(2) ?? 'unavailable'}**（门控裁决 \`${green.sysEval.gateVerdict}\`）
   - 蓝方综合得分 **${blue.sysEval.overallScore?.toFixed(2) ?? 'unavailable'}**（门控裁决 \`${blue.sysEval.gateVerdict}\`）
`;

  return md;
}

runEndToEndEvaluation().catch((err) => {
  console.error('[E2E] Evaluation failed:', err);
  process.exitCode = 1;
});
