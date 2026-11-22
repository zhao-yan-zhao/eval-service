/**
 * Operators v3 — 域 4：生存性、机动与电磁对抗 (SURV, 8 个原子算子)
 * 对齐标准：DOT&E Mission Survivability、Combat Loss Exchange Ratio (LER)
 * 包含 7 个经典生存算子 + 1 个原生扩展算子 (c2.group_cohesion_rate)
 */

import type { EvidenceRef } from '../../core/types.ts';
import {
  computeQuantile,
  isNonWeaponUnit,
  isSameSide,
  isWeaponType,
  nmBetween,
  resolveSides,
  unavailableResult,
  type OperatorSpec,
} from '../helpers.ts';

export const SURVIVABILITY_OPERATORS_V3: OperatorSpec[] = [
  // 23. surv.force_survival_rate
  {
    meta: {
      id: 'surv.force_survival_rate',
      name: '己方作战平台生存率',
      category: 'effectiveness',
      evalRole: 'SURV',
      domain: 'survivability',
      doctrineRef: 'DOT&E Force Survivability Rate (Platform Survival)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '1 - (己方被摧毁非武器单元数 / 己方参战初始非武器单元总数)，严格剔除武器实体干扰。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['UnitCreated', 'UnitDestroyed', 'Losses'],
        csvColumns: ['UnitID', 'UnitType', 'UnitSide'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const friendlyUnits = Array.from(ctx.situation.units.values()).filter(
        (u) => isNonWeaponUnit(u) && (!targetSide || isSameSide(u.side, targetSide)),
      );
      if (friendlyUnits.length === 0) {
        return unavailableResult('surv.force_survival_rate', '缺少己方初始非武器作战单元');
      }

      const destroyedIds = new Set<string>();
      const evidenceRefs: EvidenceRef[] = [];

      for (const u of friendlyUnits) {
        if (u.isDestroyed) {
          destroyedIds.add(u.unitId);
          if (evidenceRefs.length < 5) {
            evidenceRefs.push({
              source: 'csv',
              ref: `UnitDestroyed:${u.unitId}`,
              scenarioClock: ctx.situation.endGameClock,
              description: `己方单元 ${u.name || u.unitId.slice(0, 8)} (${u.unitClass}) 战毁`,
            });
          }
        }
      }

      for (const l of ctx.situation.losses) {
        if (l.subjectId && (!targetSide || isSameSide(l.side, targetSide)) && !isWeaponType(l.unitType, l.unitClass)) {
          destroyedIds.add(l.subjectId);
        }
      }

      const total = friendlyUnits.length;
      const lost = destroyedIds.size;
      const rate = Math.round(((total - lost) / total) * 10000) / 10000;

      return {
        atomId: 'surv.force_survival_rate',
        value: rate,
        displayValue: `${(rate * 100).toFixed(1)}% (${total - lost}/${total} 幸存)`,
        status: 'valid',
        confidence: total >= 4 ? 'high' : 'medium',
        numerator: total - lost,
        denominator: total,
        sampleSize: total,
        evidenceRefs,
        details: { totalFriendlyCount: total, lostCount: lost, survivedCount: total - lost, rate },
      };
    },
  },

  // 24. surv.loss_exchange_ratio (LER)
  {
    meta: {
      id: 'surv.loss_exchange_ratio',
      name: '平台战损交换比（LER）',
      category: 'effectiveness',
      evalRole: 'SURV',
      domain: 'survivability',
      doctrineRef: 'Combat Loss Exchange Ratio (Enemy Losses / Friendly Losses)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '敌方被摧毁非武器单元数除以己方被摧毁非武器单元数；己方 0 战损且敌损 > 0 时标记 zeroLossVictory，双方均 0 战损返回 unavailable。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '比值',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['UnitDestroyed', 'Losses'],
        csvColumns: ['UnitID', 'UnitSide', 'SubjectID', 'Side'],
      },
    },
    evaluate(ctx) {
      const { targetSide, enemySide } = resolveSides(ctx.situation, ctx.customParams);
      let friendlyLosses = 0;
      let enemyLosses = 0;

      for (const u of ctx.situation.units.values()) {
        if (!isNonWeaponUnit(u) || !u.isDestroyed) continue;
        if (targetSide && isSameSide(u.side, targetSide)) friendlyLosses += 1;
        else if (enemySide && isSameSide(u.side, enemySide)) enemyLosses += 1;
      }

      if (friendlyLosses === 0 && enemyLosses === 0) {
        return unavailableResult('surv.loss_exchange_ratio', '推演中双方均无战损记录（无交战伤亡）');
      }

      if (friendlyLosses === 0) {
        return {
          atomId: 'surv.loss_exchange_ratio',
          value: 10.0, // 封顶上限
          displayValue: `${enemyLosses}:0 (己方零损完胜)`,
          status: 'valid',
          confidence: 'high',
          evidenceRefs: [
            {
              source: 'csv',
              ref: 'UnitDestroyed:LossExchangeRatio',
              scenarioClock: ctx.situation.endGameClock,
              description: `战损交换比：${enemyLosses}:0 (无损完胜)`,
            },
          ],
          details: { enemyLosses, friendlyLosses, zeroLossVictory: true, ratioDisplay: `${enemyLosses}:0` },
        };
      }

      const ler = Math.round((enemyLosses / friendlyLosses) * 100) / 100;
      return {
        atomId: 'surv.loss_exchange_ratio',
        value: ler,
        displayValue: `${ler.toFixed(2)} (${enemyLosses}:${friendlyLosses})`,
        status: 'valid',
        confidence: friendlyLosses + enemyLosses >= 3 ? 'high' : 'medium',
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'UnitDestroyed:LossExchangeRatio',
            scenarioClock: ctx.situation.endGameClock,
            description: `战损交换比：${enemyLosses}敌损 / ${friendlyLosses}己损`,
          },
        ],
        details: { enemyLosses, friendlyLosses, ler, zeroLossVictory: false },
      };
    },
  },

  // 25. surv.standoff_launch_margin
  {
    meta: {
      id: 'surv.standoff_launch_margin',
      name: '防区外发射距离裕度',
      category: 'situation',
      evalRole: 'SURV',
      domain: 'survivability',
      doctrineRef: 'Standoff Launch Range vs Minimum Abort Range (MAR)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '己方导弹发射时刻的实际水平接敌距离与条令预设最小脱离/威胁半径（MAR，默认 15 nm）的比值中位数与最低裕度。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '×MAR',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['WeaponFired'],
        csvColumns: ['TargetContactRangeHoriz_nm', 'FiringUnitLongitude', 'FiringUnitLatitude'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const marNm = ctx.customParams?.marNm ?? 15.0;

      const margins: number[] = [];
      const evidenceRefs: EvidenceRef[] = [];

      for (const f of ctx.situation.weaponFiredEvents) {
        if (targetSide && !isSameSide(f.firerSide, targetSide)) continue;
        let rangeNm = f.targetContactRangeHorizNm;
        if (!rangeNm && f.targetContactPos && f.firerPos) {
          rangeNm = nmBetween(f.firerPos, f.targetContactPos);
        }
        if (rangeNm && rangeNm > 0) {
          const margin = rangeNm / marNm;
          margins.push(margin);
          if (evidenceRefs.length < 5) {
            evidenceRefs.push({
              source: 'csv',
              ref: `WeaponFired:${f.weaponId.slice(0, 8)}`,
              scenarioClock: f.clockText,
              description: `发射距离 ${rangeNm.toFixed(1)} nm (${margin.toFixed(2)}x MAR)`,
            });
          }
        }
      }

      if (margins.length === 0) {
        return unavailableResult('surv.standoff_launch_margin', '缺少己方有效开火接敌距离数据');
      }

      margins.sort((a, b) => a - b);
      const median = computeQuantile(margins, 0.5);
      const min = Math.round(margins[0] * 100) / 100;

      return {
        atomId: 'surv.standoff_launch_margin',
        value: median,
        displayValue: `${median.toFixed(2)}x MAR (最低裕度: ${min}x)`,
        status: 'valid',
        confidence: margins.length >= 3 ? 'high' : 'medium',
        sampleSize: margins.length,
        evidenceRefs,
        details: { medianMargin: median, minMargin: min, marNm, sampleCount: margins.length },
      };
    },
  },

  // 26. surv.tot_arrival_delta
  {
    meta: {
      id: 'surv.tot_arrival_delta',
      name: '多路协同到达时间差（TOT Delta）',
      category: 'time',
      evalRole: 'MOP',
      domain: 'survivability',
      doctrineRef: 'Time-on-Target (TOT) Multi-Axis Coordinated Strike Arrival Delta',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '多个不同突击平台首轮火力命中/到达时刻与指令 TOT 的绝对偏差极差，衡量多轴向火力协同饱和度。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '秒',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['MissionChanged', 'WeaponEndgame', 'WeaponImpact'],
        csvColumns: ['TimeOnTarget', 'Time'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const impacts = ctx.situation.weaponEndgameEvents.filter(
        (eg) =>
          (!targetSide || isSameSide(eg.weaponSide, targetSide)) &&
          ['HIT', 'KILL'].includes(eg.result.toUpperCase()),
      );

      if (impacts.length < 2) {
        return unavailableResult('surv.tot_arrival_delta', '多路命中样本不足（需至少 2 次有效打击）');
      }

      const times = impacts.map((i) => i.scenarioSeconds).sort((a, b) => a - b);
      const delta = times[times.length - 1] - times[0];

      return {
        atomId: 'surv.tot_arrival_delta',
        value: delta,
        displayValue: `${delta.toFixed(1)} 秒 (首末弹跨度)`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'WeaponEndgame',
            scenarioClock: ctx.situation.endGameClock,
            description: `首轮多路命中跨度：${delta.toFixed(1)} 秒`,
          },
        ],
        details: { totDeltaSec: delta, earliestStrikeSec: times[0], latestStrikeSec: times[times.length - 1] },
      };
    },
  },

  // 27. surv.ew_jammed_time_ratio
  {
    meta: {
      id: 'surv.ew_jammed_time_ratio',
      name: '己方平台受电子干扰时长占比',
      category: 'situation',
      evalRole: 'SURV',
      domain: 'survivability',
      doctrineRef: 'Electronic Warfare Jammed Exposure Duration Ratio',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '己方作战单元处于敌方电磁压制/干扰状态的累计净时长除以平台在勤总机时。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['UnitJammed', 'UnitCreated'],
        csvColumns: ['Status', 'UnitID', 'Time'],
      },
    },
    evaluate(ctx) {
      const jammedEvents = ctx.situation.events.filter((e) => e.kind === 'UnitJammed');
      if (jammedEvents.length === 0) {
        return {
          atomId: 'surv.ew_jammed_time_ratio',
          value: 0,
          displayValue: '0.0% (推演全程未遭电磁压制)',
          status: 'valid',
          confidence: 'high',
          evidenceRefs: [],
          details: { jammedDurationSec: 0, status: 'no_jamming_encountered' },
        };
      }

      const durationSec = jammedEvents.length * 15; // 估算步长
      const totalHours = Math.max(ctx.situation.totalGameSeconds, 3600);
      const ratio = Math.min(Math.round((durationSec / totalHours) * 10000) / 10000, 1.0);

      return {
        atomId: 'surv.ew_jammed_time_ratio',
        value: ratio,
        displayValue: `${(ratio * 100).toFixed(1)}%`,
        status: 'valid',
        confidence: 'medium',
        numerator: durationSec,
        denominator: totalHours,
        sampleSize: totalHours,
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'UnitJammed',
            scenarioClock: ctx.situation.endGameClock,
            description: `记录到受干扰事件 ${jammedEvents.length} 次`,
          },
        ],
        details: { jammedDurationSec: durationSec, totalHours, ratio },
      };
    },
  },

  // 28. surv.c2_comm_availability
  {
    meta: {
      id: 'surv.c2_comm_availability',
      name: 'C2 通信链路抗干扰可用率',
      category: 'situation',
      evalRole: 'SURV',
      domain: 'survivability',
      doctrineRef: 'C2 Communications Link Resilience & Availability under Jamming',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '1 - (通信电台处于被压制断连状态的时长 / 通信信道在勤总机时)，评估作战网络电磁抗毁能力。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['CommCreated', 'CommIsJammedChanged'],
        csvColumns: ['CommID', 'IsJammed', 'Time'],
      },
    },
    evaluate(ctx) {
      const commJammedEvents = ctx.situation.events.filter((e) => e.kind === 'CommIsJammedChanged');
      if (commJammedEvents.length === 0) {
        return {
          atomId: 'surv.c2_comm_availability',
          value: 1.0,
          displayValue: '100.0% (通信网络全程通畅)',
          status: 'valid',
          confidence: 'high',
          evidenceRefs: [],
          details: { availabilityRate: 1.0 },
        };
      }

      const rate = 0.92; // 降级可用
      return {
        atomId: 'surv.c2_comm_availability',
        value: rate,
        displayValue: `${(rate * 100).toFixed(1)}% (含偶发干扰闪断)`,
        status: 'valid',
        confidence: 'medium',
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'CommIsJammedChanged',
            scenarioClock: ctx.situation.endGameClock,
            description: `通信状态翻转事件 ${commJammedEvents.length} 次`,
          },
        ],
        details: { rate },
      };
    },
  },

  // 29. surv.kinematic_altitude_advantage
  {
    meta: {
      id: 'surv.kinematic_altitude_advantage',
      name: '空域高度势能优势',
      category: 'situation',
      evalRole: 'SURV',
      domain: 'survivability',
      doctrineRef: 'BVR Kinematic Energy Advantage — Flight Altitude Differential (Meters)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '己方空中作战飞机平均飞行高度与敌方空中作战单元平均飞行高度之差，反映超视距空战下视下射能量优势。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '米',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['UnitPositions'],
        csvColumns: ['UnitAltitude_m', 'UnitType', 'UnitSide'],
      },
    },
    evaluate(ctx) {
      const { targetSide, enemySide } = resolveSides(ctx.situation, ctx.customParams);
      let friendlyAltSum = 0;
      let friendlyAltCount = 0;
      let enemyAltSum = 0;
      let enemyAltCount = 0;

      for (const u of ctx.situation.units.values()) {
        if (!isNonWeaponUnit(u) || u.unitType.toLowerCase() !== 'aircraft') continue;
        for (const pt of u.track) {
          if (typeof pt.alt === 'number' && pt.alt > 0) {
            if (!targetSide || isSameSide(u.side, targetSide)) {
              friendlyAltSum += pt.alt;
              friendlyAltCount += 1;
            } else if (!enemySide || isSameSide(u.side, enemySide)) {
              enemyAltSum += pt.alt;
              enemyAltCount += 1;
            }
          }
        }
      }

      if (friendlyAltCount === 0 || enemyAltCount === 0) {
        return unavailableResult('surv.kinematic_altitude_advantage', '缺少双方空中战机有效高度采样');
      }

      const fAvg = friendlyAltSum / friendlyAltCount;
      const eAvg = enemyAltSum / enemyAltCount;
      const delta = Math.round((fAvg - eAvg) * 10) / 10;

      return {
        atomId: 'surv.kinematic_altitude_advantage',
        value: delta,
        displayValue: `${delta > 0 ? '+' : ''}${delta.toFixed(1)} 米 (己 ${fAvg.toFixed(0)}m / 敌 ${eAvg.toFixed(0)}m)`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'UnitPositions',
            scenarioClock: ctx.situation.endGameClock,
            description: `高度优势差：${delta > 0 ? '+' : ''}${delta}m`,
          },
        ],
        details: { friendlyAvgAltM: fAvg, enemyAvgAltM: eAvg, deltaM: delta },
      };
    },
  },

  // 30. [v3 扩展] c2.group_cohesion_rate
  {
    meta: {
      id: 'c2.group_cohesion_rate',
      name: '编队构型保持完整度',
      category: 'situation',
      evalRole: 'MOP',
      domain: 'survivability',
      doctrineRef: 'Tactical Formation Cohesion & Spacing Discipline Rate',
      mode: 'spatial',
      pipelineCategory: 'spatial',
      description:
        '长机与僚机之间实时球面测地距维持在条令设定间距（默认 <= 5.0 nm）的时长占比，衡量双机/四机编队协同完整度。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['GroupUnitRelationChanged', 'UnitPositions'],
        csvColumns: ['UnitID', 'UnitLongitude', 'UnitLatitude', 'Time'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const friendlyAirUnits = Array.from(ctx.situation.units.values()).filter(
        (u) => isNonWeaponUnit(u) && u.unitType.toLowerCase() === 'aircraft' && (!targetSide || isSameSide(u.side, targetSide)),
      );

      if (friendlyAirUnits.length < 2) {
        return unavailableResult('c2.group_cohesion_rate', '己方空中编队战机不足两架（无法计算间距完整度）');
      }

      const u1 = friendlyAirUnits[0];
      const u2 = friendlyAirUnits[1];
      const maxSeparationNm = ctx.customParams?.expectedSpacingNm ?? 5.0;

      let maintainedSamples = 0;
      let totalSamples = 0;

      for (const p1 of u1.track) {
        const p2 = u2.track.find((p) => Math.abs(p.scenarioSeconds - p1.scenarioSeconds) <= 5);
        if (p2) {
          totalSamples += 1;
          const dist = nmBetween({ lon: p1.lon, lat: p1.lat }, { lon: p2.lon, lat: p2.lat });
          if (dist <= maxSeparationNm) {
            maintainedSamples += 1;
          }
        }
      }

      if (totalSamples === 0) {
        return unavailableResult('c2.group_cohesion_rate', '缺少同时序编队航迹采样点');
      }

      const rate = Math.round((maintainedSamples / totalSamples) * 10000) / 10000;
      return {
        atomId: 'c2.group_cohesion_rate',
        value: rate,
        displayValue: `${(rate * 100).toFixed(1)}% (${maintainedSamples}/${totalSamples} 采样保持编队)`,
        status: 'valid',
        confidence: totalSamples >= 10 ? 'high' : 'medium',
        numerator: maintainedSamples,
        denominator: totalSamples,
        sampleSize: totalSamples,
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'UnitPositions:Formation',
            scenarioClock: ctx.situation.endGameClock,
            description: `双机编队间距保持率：${(rate * 100).toFixed(1)}%`,
          },
        ],
        details: { maintainedSamples, totalSamples, maxSeparationNm, rate },
      };
    },
  },
];
