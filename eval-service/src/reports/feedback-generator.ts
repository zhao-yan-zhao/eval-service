import type {
  EvaluatedDimensionNode,
  EvaluatedLeafNode,
  SituationModel,
  SystemEvaluationOutput,
  TacticalFeedbackPayload,
} from '../core/types.ts';
import { resolveSides } from '../operators/helpers.ts';

function flattenLeavesWithDimension(
  nodes: Array<EvaluatedDimensionNode | EvaluatedLeafNode>,
  dimName = '综合',
): Array<{ dimName: string; leaf: EvaluatedLeafNode }> {
  const res: Array<{ dimName: string; leaf: EvaluatedLeafNode }> = [];
  for (const n of nodes) {
    if (n.kind === 'indicator') {
      res.push({ dimName, leaf: n });
    } else {
      res.push(...flattenLeavesWithDimension(n.children, n.name));
    }
  }
  return res;
}

function buildDirectivesForAtom(atomRef: string): {
  directives: string[];
  patches: Record<string, unknown>;
} {
  switch (atomRef) {
    case 'sit.standoff_advantage':
      return {
        directives: [
          '提升防区外开火距离，保持机队在敌方核心防空威胁圈外实施超视距齐射',
          '控制前哨侦察平台前突深度，加强协同中继制导距离',
        ],
        patches: {
          wra: { maintain_standoff_factor: 1.25 },
          doctrine: { disengage_when_inside_sam_envelope: true },
        },
      };
    case 'time.detect_to_fire_latency':
    case 'time.first_weapon_fire':
      return {
        directives: [
          '针对已识别的高威胁目标缩短交战审批流程，提升自主开火响应速度',
          '前置探测单元启用跨平台协同数据链，压缩目标确认与分发延迟',
        ],
        patches: {
          wra: { auto_engage_classified_hostiles: true, approval_timeout_sec: 15 },
        },
      };
    case 'eff.hit_rate':
    case 'eff.target_penetration_rate':
      return {
        directives: [
          '调整射击策略为双发齐射或多方位协同突击，降低目标机动脱靶率',
          '严格核查发射瞬间的不可逃逸区 (NEZ) 范围，避免极限射程无效耗弹',
        ],
        patches: {
          salvo: { rounds_per_target: 2, fire_within_nez_ratio: 0.75 },
        },
      };
    case 'comp.corridor_compliance':
      return {
        directives: [
          '控制航路点转向偏离容差（<=2 nm），防止规避机动期间超出指定空域走廊',
        ],
        patches: {
          navigation: { enforce_corridor_boundary: true, deviation_tolerance_nm: 2.0 },
        },
      };
    case 'cost.munitions_cost_total':
    case 'cost.economic_exchange_ratio':
      return {
        directives: [
          '按目标价值分级匹配弹药（高价值目标分配远程弹药，轻型/低威胁目标分配低成本弹药）',
        ],
        patches: {
          wra: { forbid_high_tier_munition_on_low_value_targets: true },
        },
      };
    default:
      return {
        directives: [
          `针对指标【${atomRef}】实测差距调整任务规划与交战规则参数`,
        ],
        patches: {},
      };
  }
}

export function generateTacticalFeedback(
  evalOut: SystemEvaluationOutput,
  situation: SituationModel,
): TacticalFeedbackPayload {
  const { targetSide } = resolveSides(situation);
  const leaves = flattenLeavesWithDimension(evalOut.rootTree.children);

  let grade: TacticalFeedbackPayload['tacticalGrade'] = 'INCOMPLETE';
  if (evalOut.overallScore !== null) {
    if (evalOut.overallScore >= 85) grade = 'A';
    else if (evalOut.overallScore >= 75) grade = 'B+';
    else if (evalOut.overallScore >= 60) grade = 'B';
    else if (evalOut.overallScore >= 45) grade = 'C';
    else grade = 'D';
  }

  const weakItems = leaves
    .filter((x) => x.leaf.score !== null && x.leaf.score < 80)
    .sort((a, b) => (a.leaf.score ?? 100) - (b.leaf.score ?? 100))
    .slice(0, 5);

  const mergedPatches: Record<string, unknown> = {};
  const weaknessDiagnostics = weakItems.map((item, idx) => {
    const { directives, patches } = buildDirectivesForAtom(item.leaf.atomRef);
    Object.assign(mergedPatches, patches);
    const numVal =
      typeof item.leaf.rawResult.value === 'number' ? item.leaf.rawResult.value : null;
    return {
      code: `WEAK_${String(idx + 1).padStart(2, '0')}_${item.leaf.atomRef.replace(/\./g, '_').toUpperCase()}`,
      dimension: item.dimName,
      metricAtom: item.leaf.atomRef,
      observedValue: numVal,
      benchmarkValue: 80,
      score: item.leaf.score,
      diagnosis: `${item.leaf.name} 实测得分为 ${item.leaf.score?.toFixed(1) ?? 'N/A'}（实测值：${item.leaf.rawResult.displayValue}），低于基准 80 分，为该维度主要薄弱指标。`,
      evidenceRefs: item.leaf.rawResult.evidenceRefs.slice(0, 4),
      suggestedDirectives: directives,
    };
  });

  return {
    $schema: 'https://f1-ai.schema/tactical-feedback/v1.json',
    runId: evalOut.runId,
    evaluatedSide: targetSide ?? '红方',
    overallScore: evalOut.overallScore,
    tacticalGrade: grade,
    weaknessDiagnostics,
    recommendedDoctrinePatches: mergedPatches,
  };
}
