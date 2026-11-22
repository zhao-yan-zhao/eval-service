/**
 * Operators v3 — 域 1：任务与作战效果 (MOE, 4 个原子算子)
 * 对齐标准：JP 5-0 Joint Planning (MOE)、DOT&E Mission-Focused Measures、JMEM BDA (K/M/F-Kill)
 * 全面支持 (Scenario, MC_Run) 蒙特卡洛多样本分区与 Fail-Closed 实证门控
 */

import type { EvidenceRef } from '../../core/types.ts';
import {
  computeWilsonCi95,
  isNonWeaponUnit,
  isPointInsidePolygon,
  isSameSide,
  isWeaponType,
  matchesTargetFilter,
  resolveSides,
  unavailableResult,
  type OperatorSpec,
} from '../helpers.ts';

export const MOE_OPERATORS_V3: OperatorSpec[] = [
  // 1. moe.mission_success_rate
  {
    meta: {
      id: 'moe.mission_success_rate',
      name: '任务达成率（含 Wilson 95% CI）',
      category: 'effectiveness',
      evalRole: 'MOE',
      domain: 'moe',
      doctrineRef: 'JP 5-0 MOE / DOT&E Operational Effectiveness (Wilson 95% CI)',
      mode: 'python_script',
      pipelineCategory: 'python_script',
      description:
        '依据显式规格判据 (criteriaResults) 或 LabConsole metrics.py spec_criteria 输出统计任务成功概率与 Wilson 95% 置信区间，严禁以开火替代成功。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['SimInfo', 'UnitDestroyed', 'Losses'],
        csvColumns: ['TimelineID', 'MonteCarloID', 'MonteCarloIteration'],
        discrepancyNotes: ['未配置显式任务达成判据规范 (spec_criteria / criteriaResults) 时严格 fail-closed'],
      },
    },
    evaluate(ctx) {
      const pySuccess = ctx.csvStats?.success_rate as
        | { rate?: number | null; success_count?: number; total_iterations?: number }
        | undefined;
      if (pySuccess && typeof pySuccess.rate === 'number' && (pySuccess.total_iterations ?? 0) > 0) {
        const n = pySuccess.total_iterations!;
        const k = pySuccess.success_count ?? Math.round(pySuccess.rate * n);
        const ci = computeWilsonCi95(k, n);
        return {
          atomId: 'moe.mission_success_rate',
          value: Math.round(pySuccess.rate * 10000) / 10000,
          displayValue: `${(pySuccess.rate * 100).toFixed(1)}% [${(ci.lower * 100).toFixed(1)}%-${(ci.upper * 100).toFixed(1)}%]`,
          status: 'valid',
          confidence: n >= 5 ? 'high' : 'medium',
          numerator: k,
          denominator: n,
          sampleSize: n,
          evidenceRefs: [
            {
              source: 'csv',
              ref: 'metrics.py:spec_criteria',
              scenarioClock: ctx.situation.endGameClock,
              description: `metrics.py spec_criteria 判定：${k}/${n} 局达成任务`,
            },
          ],
          details: { k, n, wilson95: ci, source: 'metrics.py' },
        };
      }

      const criteria = ctx.situation.criteriaResults;
      if (criteria && Object.keys(criteria).length > 0) {
        const entries = Object.entries(criteria);
        const n = entries.length;
        const k = entries.filter(([, ok]) => Boolean(ok)).length;
        const rate = k / n;
        const ci = computeWilsonCi95(k, n);
        return {
          atomId: 'moe.mission_success_rate',
          value: Math.round(rate * 10000) / 10000,
          displayValue: `${(rate * 100).toFixed(1)}% [${(ci.lower * 100).toFixed(1)}%-${(ci.upper * 100).toFixed(1)}%]`,
          status: 'valid',
          confidence: n >= 5 ? 'high' : 'medium',
          numerator: k,
          denominator: n,
          sampleSize: n,
          evidenceRefs: [
            {
              source: 'sqlite',
              ref: `criteriaResults(${k}/${n})`,
              scenarioClock: ctx.situation.endGameClock,
              description: `外部显式判据：${k}/${n} 项达成任务条件`,
            },
          ],
          details: { k, n, wilson95: ci, source: 'criteriaResults' },
        };
      }

      return unavailableResult(
        'moe.mission_success_rate',
        '未配置显式任务成功判据 (spec_criteria 或 criteriaResults)',
      );
    },
  },

  // 2. moe.target_set_kill_rate
  {
    meta: {
      id: 'moe.target_set_kill_rate',
      name: '指定目标集摧毁率（K-Kill）',
      category: 'effectiveness',
      evalRole: 'MOE',
      domain: 'moe',
      doctrineRef: 'JMEM BDA (K-Kill) / JP 5-0 Measure of Effectiveness',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '目标集中被摧毁的敌方非武器单元唯一数除以目标集初始单元总数；支持 targetUnitFilter 指定白名单，缺省为全部敌方非武器目标。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['UnitCreated', 'UnitDestroyed', 'Losses'],
        csvColumns: ['UnitID', 'UnitType', 'UnitSide', 'SubjectID', 'Side', 'Type'],
      },
    },
    evaluate(ctx) {
      const { enemySide } = resolveSides(ctx.situation, ctx.customParams);
      const targetFilter = ctx.customParams?.targetUnitFilter;

      const targetUnits = Array.from(ctx.situation.units.values()).filter((u) => {
        if (!isNonWeaponUnit(u)) return false;
        if (enemySide && !isSameSide(u.side, enemySide)) return false;
        if (targetFilter && !matchesTargetFilter(u, targetFilter)) return false;
        return true;
      });

      const totalTargetCount = targetUnits.length;
      if (totalTargetCount === 0) {
        return unavailableResult(
          'moe.target_set_kill_rate',
          '指定目标集单元数为 0（缺少敌方初始作战单元或目标白名单未命中）',
        );
      }

      const targetIdSet = new Set(targetUnits.map((u) => u.unitId));
      const destroyedTargetIds = new Set<string>();
      const evidenceRefs: EvidenceRef[] = [];

      for (const u of targetUnits) {
        if (u.isDestroyed) {
          destroyedTargetIds.add(u.unitId);
          if (evidenceRefs.length < 5) {
            evidenceRefs.push({
              source: 'csv',
              ref: `UnitDestroyed:${u.unitId}`,
              scenarioClock: ctx.situation.endGameClock,
              description: `目标 ${u.name || u.unitId.slice(0, 8)} (${u.unitClass}) 确认战毁`,
            });
          }
        }
      }

      for (const ev of ctx.situation.damageAndHitEvents) {
        if (ev.damageState === 'destroyed' && targetIdSet.has(ev.targetUnitId)) {
          destroyedTargetIds.add(ev.targetUnitId);
        }
      }

      for (const l of ctx.situation.losses) {
        if (l.subjectId && targetIdSet.has(l.subjectId)) {
          destroyedTargetIds.add(l.subjectId);
        }
      }

      const killedCount = destroyedTargetIds.size;
      const rate = Math.round((killedCount / totalTargetCount) * 10000) / 10000;
      return {
        atomId: 'moe.target_set_kill_rate',
        value: rate,
        displayValue: `${(rate * 100).toFixed(1)}% (${killedCount}/${totalTargetCount} 毁伤)`,
        status: 'valid',
        confidence: totalTargetCount >= 4 ? 'high' : 'medium',
        numerator: killedCount,
        denominator: totalTargetCount,
        sampleSize: totalTargetCount,
        evidenceRefs,
        details: {
          totalTargetCount,
          killedCount,
          survivingCount: totalTargetCount - killedCount,
          destroyedTargetIds: Array.from(destroyedTargetIds),
        },
      };
    },
  },

  // 3. moe.target_functional_degradation
  {
    meta: {
      id: 'moe.target_functional_degradation',
      name: '敌方目标功能/机动毁伤率（BDA F/M-Kill）',
      category: 'effectiveness',
      evalRole: 'MOE',
      domain: 'moe',
      doctrineRef: 'JMEM BDA Functional / Mobility Kill (F/M-Kill)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '敌方非武器目标中发生关键部件损毁（雷达/传感器/动力 ComponentDamageSeverity 达受损）或累计物理受损超过阈值（默认 50%）的唯一单元占比。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['ComponentStatusChanged', 'UnitDamaged', 'UnitDestroyed'],
        csvColumns: ['PlatformID', 'ComponentDamageSeverity', 'DamagePercent', 'UnitID'],
      },
    },
    evaluate(ctx) {
      const { enemySide } = resolveSides(ctx.situation, ctx.customParams);
      const enemyUnits = Array.from(ctx.situation.units.values()).filter(
        (u) => isNonWeaponUnit(u) && (!enemySide || isSameSide(u.side, enemySide)),
      );
      if (enemyUnits.length === 0) {
        return unavailableResult('moe.target_functional_degradation', '无有效敌方作战单元基准');
      }

      const damageThresholdPct = ctx.customParams?.bdaDamageThresholdPct ?? 50;
      const degradedIds = new Set<string>();
      const evidenceRefs: EvidenceRef[] = [];

      for (const u of enemyUnits) {
        if (u.isDestroyed) {
          degradedIds.add(u.unitId);
        } else if (u.damagePercent >= damageThresholdPct) {
          degradedIds.add(u.unitId);
          if (evidenceRefs.length < 5) {
            evidenceRefs.push({
              source: 'csv',
              ref: `UnitDamaged:${u.unitId}`,
              scenarioClock: ctx.situation.endGameClock,
              description: `敌单元 ${u.name || u.unitId.slice(0, 8)} 物理毁伤达 ${u.damagePercent}% (>=${damageThresholdPct}%)`,
            });
          }
        }
      }

      for (const ev of ctx.situation.damageAndHitEvents) {
        if (ev.damagePercent && ev.damagePercent >= damageThresholdPct) {
          const u = ctx.situation.units.get(ev.targetUnitId);
          if (u && isNonWeaponUnit(u) && (!enemySide || isSameSide(u.side, enemySide))) {
            degradedIds.add(ev.targetUnitId);
          }
        }
      }

      const totalCount = enemyUnits.length;
      const degradedCount = degradedIds.size;
      const rate = Math.round((degradedCount / totalCount) * 10000) / 10000;
      return {
        atomId: 'moe.target_functional_degradation',
        value: rate,
        displayValue: `${(rate * 100).toFixed(1)}% (${degradedCount}/${totalCount} 降级/受创)`,
        status: 'valid',
        confidence: totalCount >= 4 ? 'high' : 'medium',
        numerator: degradedCount,
        denominator: totalCount,
        sampleSize: totalCount,
        evidenceRefs,
        details: { totalCount, degradedCount, damageThresholdPct },
      };
    },
  },

  // 4. moe.zone_control_ratio
  {
    meta: {
      id: 'moe.zone_control_ratio',
      name: '任务海空域覆盖控制率',
      category: 'situation',
      evalRole: 'MOE',
      domain: 'moe',
      doctrineRef: 'JP 5-0 Air/Maritime Superiority & Area Control (Turf.js WGS84)',
      mode: 'spatial',
      pipelineCategory: 'spatial',
      description:
        '己方空中/水面平台传感器覆盖区域在任务多边形空间区域内的有效覆盖面积与总面积比例，利用 Turf.js 空间几何分析。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['MissionRefPointRelationChanged', 'UnitPositions'],
        csvColumns: ['Longitude', 'Latitude', 'UnitLongitude', 'UnitLatitude'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const polygons =
        ctx.customParams?.patrolAreas ??
        ctx.situation.patrolAreas ??
        ctx.customParams?.corridors ??
        ctx.situation.corridors;

      if (!polygons || polygons.length === 0 || polygons[0].points.length < 3) {
        return unavailableResult(
          'moe.zone_control_ratio',
          '缺少任务巡逻区/走廊空间多边形配置（MissionRefPointRelationChanged 或 patrolAreas）',
        );
      }

      const poly = polygons[0];
      const friendlyUnits = Array.from(ctx.situation.units.values()).filter(
        (u) => isNonWeaponUnit(u) && (!targetSide || isSameSide(u.side, targetSide)),
      );

      let inZoneSamples = 0;
      let totalSamples = 0;
      for (const u of friendlyUnits) {
        for (const pt of u.track) {
          totalSamples += 1;
          if (isPointInsidePolygon({ lon: pt.lon, lat: pt.lat }, poly)) {
            inZoneSamples += 1;
          }
        }
      }

      if (totalSamples === 0) {
        return unavailableResult('moe.zone_control_ratio', '缺少己方平台在勤航迹采样');
      }

      const ratio = Math.round((inZoneSamples / totalSamples) * 10000) / 10000;
      return {
        atomId: 'moe.zone_control_ratio',
        value: ratio,
        displayValue: `${(ratio * 100).toFixed(1)}% (${inZoneSamples}/${totalSamples} 航迹采样在区)`,
        status: 'valid',
        confidence: totalSamples >= 20 ? 'high' : 'medium',
        numerator: inZoneSamples,
        denominator: totalSamples,
        sampleSize: totalSamples,
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'MissionRefPointRelationChanged',
            scenarioClock: ctx.situation.endGameClock,
            description: `任务区覆盖采样：${inZoneSamples}/${totalSamples} 点在控`,
          },
        ],
        details: { inZoneSamples, totalSamples, ratio },
      };
    },
  },
];
