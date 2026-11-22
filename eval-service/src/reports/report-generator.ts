import type {
  EvaluatedDimensionNode,
  EvaluatedLeafNode,
  SituationModel,
  SystemEvaluationOutput,
} from '../core/types.ts';
import { buildDirectivesForAtom } from './feedback-generator.ts';

function collectLeaves(
  nodes: Array<EvaluatedDimensionNode | EvaluatedLeafNode>,
): EvaluatedLeafNode[] {
  const out: EvaluatedLeafNode[] = [];
  for (const n of nodes) {
    if (n.kind === 'indicator') out.push(n);
    else out.push(...collectLeaves(n.children));
  }
  return out;
}

/**
 * 执行事实 / 指标 / 证据隔离规范生成 Markdown 评估报告
 */
export function generateEvaluationReportMarkdown(
  evalOut: SystemEvaluationOutput,
  situation: SituationModel,
): string {
  const lines: string[] = [];
  const allLeaves = collectLeaves(evalOut.rootTree.children);
  const unavailableLeaves = allLeaves.filter((l) => l.rawResult.status === 'unavailable');
  const weakLeaves = allLeaves.filter(
    (l) => l.score !== null && l.score < 80,
  ).sort((a, b) => (a.score ?? 100) - (b.score ?? 100));

  lines.push(`# ${evalOut.systemName} — 推演复盘评估报告`);
  lines.push('');
  lines.push(`- **评估流水号**：\`${evalOut.evalId}\``);
  lines.push(`- **推演运行 ID**：\`${evalOut.runId}\`（数据源：\`${situation.coverage.sourceKind}\`）`);
  lines.push(
    `- **综合效能总分**：**${evalOut.overallScore !== null ? `${evalOut.overallScore.toFixed(2)} / 100` : '不可用'}**（数据置信度：\`${evalOut.overallConfidence}\`，有效权重覆盖率：${(evalOut.availableWeightRatio * 100).toFixed(1)}%）`,
  );
  lines.push(`- **推演时间窗口**：\`${situation.startGameClock}\` ~ \`${situation.endGameClock}\`（累计 ${situation.totalGameSeconds.toFixed(1)} 秒）`);
  lines.push(`- **参演阵营**：${situation.sides.join(' vs ') || '未标定'}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  lines.push('## 一、客观观测事实（KPI 与可追溯证据）');
  lines.push('');
  lines.push('| 核心指标 (KPI) | 实测观测值 | 状态 | 对应算子 |');
  lines.push('| --- | --- | --- | --- |');
  for (const k of evalOut.evalSummaryV2.kpis) {
    lines.push(
      `| ${k.label} | ${k.value} | \`${k.status ?? 'unavailable'}\` | \`${k.atomRef ?? '-'}\` |`,
    );
  }
  lines.push('');

  lines.push('## 二、分项评估维度与指标得分');
  lines.push('');
  lines.push('| 评估维度 | 配置权重 | 实际得分 | 基准线 |');
  lines.push('| --- | --- | --- | --- |');
  for (const d of evalOut.dimensions) {
    lines.push(
      `| ${d.name} | ${(d.weight * 100).toFixed(1)}% | ${d.score !== null ? `${d.score.toFixed(2)} 分` : '数据缺失'} | 80.0 分 |`,
    );
  }
  lines.push('');
  lines.push('### 指标测算明细与证据引用（观察事实 / 模型推断 / 证据依据）');
  lines.push('');
  lines.push('| 指标名称 | 计算算子 | 原始测定值 (单位/物理量纲) | 归一化得分 | 有效权重 | 证据引用 Ref |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const leaf of allLeaves) {
    const refText =
      leaf.rawResult.evidenceRefs.length > 0
        ? leaf.rawResult.evidenceRefs
            .slice(0, 2)
            .map((e) => `\`${e.ref}\` (${e.scenarioClock})`)
            .join('； ')
        : '—';
    const displayVal = leaf.rawResult.displayValue || (leaf.rawResult.value !== null ? String(leaf.rawResult.value) : 'N/A');
    lines.push(
      `| ${leaf.name} | \`${leaf.atomRef}\` | ${displayVal} | ${leaf.score !== null ? leaf.score.toFixed(1) : 'N/A'} | ${(leaf.effectiveWeight * 100).toFixed(1)}% | ${refText} |`,
    );
  }
  lines.push('');

  lines.push('## 三、缺失数据与降级诚实性审计（数据项说明）');
  lines.push('');
  if (unavailableLeaves.length === 0 && situation.coverage.warnings.length === 0) {
    lines.push('- 本次评估所依赖的算子数据均已完整输入，未发生数据缺项。');
  } else {
    for (const ul of unavailableLeaves) {
      lines.push(
        `- **[\`${ul.atomRef}\`] 数据缺失**：${ul.rawResult.missingDataReason ?? '缺少必需输入'}（按规则不计入加权计算）`,
      );
    }
    for (const w of situation.coverage.warnings) {
      lines.push(`- 数据提示：${w}`);
    }
  }
  lines.push('');

  lines.push('## 四、评估结论与战术改进建议');
  lines.push('');
  lines.push(`> **综合定级**：${evalOut.evalSummaryV2.judgement}`);
  lines.push('');
  lines.push(evalOut.evalSummaryV2.conclusion);
  lines.push('');

  if (weakLeaves.length > 0) {
    lines.push('### 战术反哺调整指令与交战参数补丁');
    lines.push('');
    lines.push('| 薄弱指标 | 实测得分 | 军事运筹改进指令 | 推荐参数补丁 (Patches) |');
    lines.push('| --- | --- | --- | --- |');
    for (const wl of weakLeaves.slice(0, 5)) {
      const { directives, patches } = buildDirectivesForAtom(wl.atomRef);
      const directiveSummary = directives.join('； ');
      const patchSummary = Object.keys(patches).length > 0 ? `\`${JSON.stringify(patches)}\`` : '—';
      lines.push(
        `| ${wl.name} (\`${wl.atomRef}\`) | ${wl.score?.toFixed(1) ?? 'N/A'} | ${directiveSummary} | ${patchSummary} |`,
      );
    }
    lines.push('');
  }

  lines.push('### 关键时序证据摘录');
  lines.push('');
  for (const ev of evalOut.evalSummaryV2.evidenceTimeline.slice(0, 12)) {
    lines.push(`- \`${ev.scenarioClock}\` **${ev.event}** — ${ev.desc}（证据：\`${ev.ref}\`）`);
  }

    if (evalOut.gateAudit && evalOut.gateAudit.length > 0) {
    lines.push('');
    lines.push('### 安全红线与 ROE 门控审计（GATE）');
    lines.push('');
    lines.push(
      `- **门控裁决**：\`${evalOut.gateVerdict ?? 'PASS'}\`｜生效总分：\`${evalOut.overallScore ?? 'N/A'}\`｜未封顶原始效能分：\`${evalOut.rawOverallScore ?? evalOut.overallScore ?? 'N/A'}\``,
    );
    for (const g of evalOut.gateAudit) {
      lines.push(`- **${g.name}** (\`${g.atomId}\`, ${g.gateMode.toUpperCase()}): \`${g.gateStatus.toUpperCase()}\` — ${g.displayValue}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
