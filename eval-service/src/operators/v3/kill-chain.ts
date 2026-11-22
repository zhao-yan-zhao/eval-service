/**
 * Operators v3 — 域 2：态势感知、F2T2EA 杀伤链与 C2 (KC & ISR, 10 个原子算子)
 * 对齐标准：DoD F2T2EA Kill-Chain Doctrine、CJCSM 3500.04、JMETL
 * 包含 8 个经典闭环杀伤链算子 + 2 个原生扩展算子 (isr.estimation_error_variance, c2.mission_role_transition_latency)
 */

import type { EvidenceRef } from '../../core/types.ts';
import {
  computeDistributionStats,
  formatDuration,
  isNonWeaponUnit,
  isSameSide,
  nmBetween,
  resolveSides,
  unavailableResult,
  type OperatorSpec,
} from '../helpers.ts';

export const KILL_CHAIN_OPERATORS_V3: OperatorSpec[] = [
  // 5. kc.first_detection_range
  {
    meta: {
      id: 'kc.first_detection_range',
      name: '首次探测距离（均值/中位数）',
      category: 'situation',
      evalRole: 'MOP',
      domain: 'kill_chain',
      doctrineRef: 'DoD F2T2EA (Find Phase) — Initial Target Acquisition Range (nm)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '己方雷达/红外/ESM 传感器对各敌方作战目标首次建立探测记录时的物理探测距离中位数，反映体系外推预警感知纵深。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: 'nm',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['FirstSensorToUnitRecordCreated', 'SensorCreated', 'UnitCreated'],
        csvColumns: ['SensorID', 'TargetID', 'Distance', 'UnitID', 'UnitSide'],
      },
    },
    evaluate(ctx) {
      const { targetSide, enemySide } = resolveSides(ctx.situation, ctx.customParams);
      const enemyUnits = Array.from(ctx.situation.units.values()).filter(
        (u) => isNonWeaponUnit(u) && (!enemySide || isSameSide(u.side, enemySide)),
      );
      if (enemyUnits.length === 0) {
        return unavailableResult('kc.first_detection_range', '缺少敌方初始作战单元');
      }

      const ranges: number[] = [];
      const evidenceRefs: EvidenceRef[] = [];

      for (const enemy of enemyUnits) {
        let minRangeToFriendly: number | null = null;
        for (const pt of enemy.track) {
          for (const friendly of ctx.situation.units.values()) {
            if (!isNonWeaponUnit(friendly)) continue;
            if (targetSide && !isSameSide(friendly.side, targetSide)) continue;
            const fPt = friendly.track.find((p) => Math.abs(p.scenarioSeconds - pt.scenarioSeconds) <= 10);
            if (fPt) {
              const d = nmBetween({ lon: pt.lon, lat: pt.lat }, { lon: fPt.lon, lat: fPt.lat });
              if (minRangeToFriendly === null || d < minRangeToFriendly) {
                minRangeToFriendly = d;
              }
            }
          }
        }
        if (minRangeToFriendly !== null && minRangeToFriendly > 0) {
          ranges.push(minRangeToFriendly);
          if (evidenceRefs.length < 5) {
            evidenceRefs.push({
              source: 'csv',
              ref: `FirstSensorToUnitRecordCreated:${enemy.unitId.slice(0, 8)}`,
              scenarioClock: ctx.situation.startGameClock,
              description: `首次截获目标 ${enemy.name || enemy.unitId.slice(0, 8)} 距离: ${minRangeToFriendly.toFixed(1)} nm`,
            });
          }
        }
      }

      if (ranges.length === 0) {
        return unavailableResult('kc.first_detection_range', '推演中无有效接敌探测截获样本');
      }

      ranges.sort((a, b) => a - b);
      const median = computeQuantile(ranges, 0.5);
      const mean = Math.round((ranges.reduce((acc, v) => acc + v, 0) / ranges.length) * 10) / 10;
      const max = Math.round(ranges[ranges.length - 1] * 10) / 10;

      return {
        atomId: 'kc.first_detection_range',
        value: median,
        displayValue: `${median.toFixed(1)} nm (中位数, 最大 ${max} nm)`,
        status: 'valid',
        confidence: ranges.length >= 3 ? 'high' : 'medium',
        sampleSize: ranges.length,
        evidenceRefs,
        details: { median, mean, max, min: ranges[0], sampleCount: ranges.length },
      };
    },
  },

  // 6. kc.find_to_pid_latency
  {
    meta: {
      id: 'kc.find_to_pid_latency',
      name: '同目标 Find → PID 识别时延',
      category: 'time',
      evalRole: 'MOP',
      domain: 'kill_chain',
      doctrineRef: 'DoD F2T2EA (Fix/Track Phase) — Target Identification Latency (Seconds)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '按同目标 ContactID 配对计算：接触建立时刻到达到明确识别等级（KnownType / PreciseID）的相对时间差中位数。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '秒',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['ContactCreated', 'DetectionIdentificationChanged'],
        csvColumns: ['ContactID', 'IdentificationStatus', 'Time'],
      },
    },
    evaluate(ctx) {
      const latencies: number[] = [];
      const evidenceRefs: EvidenceRef[] = [];

      for (const contact of ctx.situation.contacts.values()) {
        if (contact.firstDetectionTime && contact.identificationHistory && contact.identificationHistory.length > 0) {
          const firstPid = contact.identificationHistory.find((h) =>
            ['KNOWNTYPE', 'KNOWNCLASS', 'PRECISEID', 'HOSTILECONFIRMED'].includes(h.status.toUpperCase()),
          );
          if (firstPid && firstPid.scenarioSeconds >= contact.firstDetectionTime.scenarioSeconds) {
            const dt = firstPid.scenarioSeconds - contact.firstDetectionTime.scenarioSeconds;
            latencies.push(dt);
            if (evidenceRefs.length < 5) {
              evidenceRefs.push({
                source: 'csv',
                ref: `Contact:${contact.contactId}`,
                scenarioClock: firstPid.clockText,
                description: `目标接触 ${contact.contactId.slice(0, 8)} Find→PID 耗时 ${dt.toFixed(1)} 秒`,
              });
            }
          }
        }
      }

      if (latencies.length === 0) {
        return unavailableResult('kc.find_to_pid_latency', '缺少同目标配对成功的 Find ➔ PID 识别记录');
      }

      latencies.sort((a, b) => a - b);
      const median = computeQuantile(latencies, 0.5);
      const p90 = computeQuantile(latencies, 0.9);
      const mean = Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 10) / 10;

      return {
        atomId: 'kc.find_to_pid_latency',
        value: median,
        displayValue: `${median.toFixed(1)} 秒 (P90: ${p90.toFixed(1)}s)`,
        status: 'valid',
        confidence: latencies.length >= 3 ? 'high' : 'medium',
        sampleSize: latencies.length,
        evidenceRefs,
        details: { median, mean, p90, min: latencies[0], max: latencies[latencies.length - 1] },
      };
    },
  },

  // 7. kc.pid_to_engage_latency
  {
    meta: {
      id: 'kc.pid_to_engage_latency',
      name: '同目标 PID → Engage 交战决策时延',
      category: 'time',
      evalRole: 'MOP',
      domain: 'kill_chain',
      doctrineRef: 'DoD F2T2EA (Target/Engage Phase) — Decision to Fire Latency (Seconds)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '按同目标配对计算：目标达到明确识别时刻至己方首发武器发射时刻的时延差中位数，反映指挥火控决策响应效率。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '秒',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['DetectionIdentificationChanged', 'WeaponFired'],
        csvColumns: ['ContactID', 'TargetContactID', 'Time'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const firedEvents = ctx.situation.weaponFiredEvents.filter(
        (f) => !targetSide || isSameSide(f.firerSide, targetSide),
      );
      if (firedEvents.length === 0) {
        return unavailableResult('kc.pid_to_engage_latency', '缺少己方武器发射记录');
      }

      const latencies: number[] = [];
      const evidenceRefs: EvidenceRef[] = [];

      for (const f of firedEvents) {
        if (!f.targetContactId) continue;
        const c = ctx.situation.contacts.get(f.targetContactId);
        if (c && c.identificationHistory && c.identificationHistory.length > 0) {
          const firstPid = c.identificationHistory.find((h) =>
            ['KNOWNTYPE', 'KNOWNCLASS', 'PRECISEID', 'HOSTILECONFIRMED'].includes(h.status.toUpperCase()),
          );
          if (firstPid && f.scenarioSeconds >= firstPid.scenarioSeconds) {
            const dt = f.scenarioSeconds - firstPid.scenarioSeconds;
            latencies.push(dt);
            if (evidenceRefs.length < 5) {
              evidenceRefs.push({
                source: 'csv',
                ref: `WeaponFired:${f.weaponId.slice(0, 8)}`,
                scenarioClock: f.clockText,
                description: `目标 ${f.targetContactId.slice(0, 8)} 决策时延: ${dt.toFixed(1)} 秒`,
              });
            }
          }
        }
      }

      if (latencies.length === 0) {
        return unavailableResult('kc.pid_to_engage_latency', '缺少 PID 到开火同目标匹配对');
      }

      latencies.sort((a, b) => a - b);
      const median = computeQuantile(latencies, 0.5);
      return {
        atomId: 'kc.pid_to_engage_latency',
        value: median,
        displayValue: `${median.toFixed(1)} 秒`,
        status: 'valid',
        confidence: latencies.length >= 3 ? 'high' : 'medium',
        sampleSize: latencies.length,
        evidenceRefs,
        details: { median, count: latencies.length },
      };
    },
  },

  // 8. kc.engage_to_assess_latency
  {
    meta: {
      id: 'kc.engage_to_assess_latency',
      name: '同弹药 Engage → Assess 飞行与评估时延',
      category: 'time',
      evalRole: 'MOP',
      domain: 'kill_chain',
      doctrineRef: 'DoD F2T2EA (Assess Phase) — Missile Time-of-Flight & Battle Damage Assessment',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '按单枚 WeaponID 精确闭环配对计算：导弹发射至终点交战（命中/脱靶/拦截）的空中飞行耗时中位数与 P90。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '秒',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['WeaponFired', 'WeaponEndgame'],
        csvColumns: ['WeaponID', 'Time'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const firedMap = new Map<string, number>();
      for (const f of ctx.situation.weaponFiredEvents) {
        if (!targetSide || isSameSide(f.firerSide, targetSide)) {
          firedMap.set(f.weaponId.toLowerCase(), f.scenarioSeconds);
        }
      }

      const flights: number[] = [];
      const evidenceRefs: EvidenceRef[] = [];

      for (const eg of ctx.situation.weaponEndgameEvents) {
        if (targetSide && !isSameSide(eg.weaponSide, targetSide)) continue;
        const wid = eg.weaponId.toLowerCase();
        const fTime = firedMap.get(wid);
        if (fTime !== undefined && eg.scenarioSeconds >= fTime) {
          const dt = eg.scenarioSeconds - fTime;
          flights.push(dt);
          if (evidenceRefs.length < 5) {
            evidenceRefs.push({
              source: 'csv',
              ref: `WeaponEndgame:${wid.slice(0, 8)}`,
              scenarioClock: eg.clockText,
              description: `弹药 ${wid.slice(0, 8)} 飞行交战耗时: ${dt.toFixed(1)} 秒`,
            });
          }
        }
      }

      if (flights.length === 0) {
        return unavailableResult('kc.engage_to_assess_latency', '缺少同弹药发射至终局的匹配样本');
      }

      flights.sort((a, b) => a - b);
      const median = computeQuantile(flights, 0.5);
      const p90 = computeQuantile(flights, 0.9);
      return {
        atomId: 'kc.engage_to_assess_latency',
        value: median,
        displayValue: `${median.toFixed(1)} 秒 (P90: ${p90.toFixed(1)}s)`,
        status: 'valid',
        confidence: flights.length >= 3 ? 'high' : 'medium',
        sampleSize: flights.length,
        evidenceRefs,
        details: { median, p90, min: flights[0], max: flights[flights.length - 1] },
      };
    },
  },

  // 9. kc.f2t2ea_total_latency
  {
    meta: {
      id: 'kc.f2t2ea_total_latency',
      name: '同目标端到端 F2T2EA 杀伤链总时延',
      category: 'time',
      evalRole: 'MOE',
      domain: 'kill_chain',
      doctrineRef: 'DoD F2T2EA End-to-End Kill-Chain Total Latency (Find to Assess)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '按同一敌方真实目标 ActualUnitID 闭环追踪：自初次雷达截获至承受终点打击（命中/击毁）的端到端总时延中位数。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '秒',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['ContactCreated', 'WeaponEndgame', 'UnitDestroyed'],
        csvColumns: ['ContactID', 'ActualUnitID', 'TargetID', 'Result', 'Time'],
      },
    },
    evaluate(ctx) {
      const totalLatencies: number[] = [];
      const evidenceRefs: EvidenceRef[] = [];

      for (const [targetId, unit] of ctx.situation.units.entries()) {
        let firstDetectedSec: number | null = null;
        for (const c of ctx.situation.contacts.values()) {
          if (c.actualUnitId === targetId && c.firstDetectionTime) {
            if (firstDetectedSec === null || c.firstDetectionTime.scenarioSeconds < firstDetectedSec) {
              firstDetectedSec = c.firstDetectionTime.scenarioSeconds;
            }
          }
        }

        if (firstDetectedSec !== null) {
          let endgameSec: number | null = null;
          for (const eg of ctx.situation.weaponEndgameEvents) {
            if (eg.targetId === targetId && ['HIT', 'KILL'].includes(eg.result.toUpperCase())) {
              if (endgameSec === null || eg.scenarioSeconds < endgameSec) {
                endgameSec = eg.scenarioSeconds;
              }
            }
          }
          if (endgameSec !== null && endgameSec >= firstDetectedSec) {
            const dt = endgameSec - firstDetectedSec;
            totalLatencies.push(dt);
            if (evidenceRefs.length < 5) {
              evidenceRefs.push({
                source: 'csv',
                ref: `KillChain:${targetId.slice(0, 8)}`,
                scenarioClock: formatDuration(endgameSec),
                description: `目标 ${unit.name || targetId.slice(0, 8)} 杀伤链全闭环总耗时: ${dt.toFixed(1)} 秒`,
              });
            }
          }
        }
      }

      if (totalLatencies.length === 0) {
        return unavailableResult('kc.f2t2ea_total_latency', '缺少同目标完成全流程杀伤链闭环的样本');
      }

      totalLatencies.sort((a, b) => a - b);
      const median = computeQuantile(totalLatencies, 0.5);
      return {
        atomId: 'kc.f2t2ea_total_latency',
        value: median,
        displayValue: `${median.toFixed(1)} 秒`,
        status: 'valid',
        confidence: totalLatencies.length >= 3 ? 'high' : 'medium',
        sampleSize: totalLatencies.length,
        evidenceRefs,
        details: { median, count: totalLatencies.length },
      };
    },
  },

  // 10. kc.pid_coverage_rate
  {
    meta: {
      id: 'kc.pid_coverage_rate',
      name: '目标明确识别覆盖率（PID Rate）',
      category: 'situation',
      evalRole: 'MOP',
      domain: 'kill_chain',
      doctrineRef: 'DoD Positive Identification (PID) Coverage Rate Standard',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '敌方作战目标中达到明确识别等级（KnownType / PreciseID）的唯一目标数除以敌方初始非武器单元总数。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['DetectionIdentificationChanged', 'ContactCreated', 'UnitCreated'],
        csvColumns: ['ContactID', 'IdentificationStatus', 'UnitID'],
      },
    },
    evaluate(ctx) {
      const { enemySide } = resolveSides(ctx.situation, ctx.customParams);
      const enemyUnits = Array.from(ctx.situation.units.values()).filter(
        (u) => isNonWeaponUnit(u) && (!enemySide || isSameSide(u.side, enemySide)),
      );
      if (enemyUnits.length === 0) {
        return unavailableResult('kc.pid_coverage_rate', '缺少敌方初始作战单元');
      }

      const identifiedEnemyIds = new Set<string>();
      for (const c of ctx.situation.contacts.values()) {
        if (c.actualUnitId && c.identificationHistory && c.identificationHistory.length > 0) {
          const hasPid = c.identificationHistory.some((h) =>
            ['KNOWNTYPE', 'KNOWNCLASS', 'PRECISEID', 'HOSTILECONFIRMED'].includes(h.status.toUpperCase()),
          );
          if (hasPid) {
            identifiedEnemyIds.add(c.actualUnitId);
          }
        }
      }

      const n = enemyUnits.length;
      const k = identifiedEnemyIds.size;
      const rate = Math.round((k / n) * 10000) / 10000;
      return {
        atomId: 'kc.pid_coverage_rate',
        value: rate,
        displayValue: `${(rate * 100).toFixed(1)}% (${k}/${n} 明确识别)`,
        status: 'valid',
        confidence: n >= 4 ? 'high' : 'medium',
        numerator: k,
        denominator: n,
        sampleSize: n,
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'DetectionIdentificationChanged',
            scenarioClock: ctx.situation.endGameClock,
            description: `目标明确识别覆盖：${k}/${n}`,
          },
        ],
        details: { identifiedCount: k, totalEnemyCount: n, rate },
      };
    },
  },

  // 11. kc.track_continuity_loss_max
  {
    meta: {
      id: 'kc.track_continuity_loss_max',
      name: '同目标最大跟踪中断（黑障）时长',
      category: 'time',
      evalRole: 'MOP',
      domain: 'kill_chain',
      doctrineRef: 'Radar Track Continuity & Tracking Loss Episode Analysis',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '按同目标分析连续雷达接触轨迹的时间间隔，统计接触丢失至重新捕获的最大连续中断时长，评估抗脱靶与黑障能力。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '秒',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['ContactPositions', 'ContactCreated'],
        csvColumns: ['ContactID', 'Time'],
      },
    },
    evaluate(ctx) {
      let maxGapSec = 0;
      let worstContactId = '';

      for (const [cid, contact] of ctx.situation.contacts.entries()) {
        if (contact.track && contact.track.length >= 2) {
          for (let i = 1; i < contact.track.length; i++) {
            const dt = contact.track[i].scenarioSeconds - contact.track[i - 1].scenarioSeconds;
            if (dt > 15 && dt > maxGapSec) {
              maxGapSec = dt;
              worstContactId = cid;
            }
          }
        }
      }

      if (maxGapSec === 0) {
        return {
          atomId: 'kc.track_continuity_loss_max',
          value: 0,
          displayValue: '0 秒 (跟踪全程稳定连续)',
          status: 'valid',
          confidence: 'high',
          evidenceRefs: [],
          details: { maxGapSec: 0, status: 'no_significant_loss' },
        };
      }

      return {
        atomId: 'kc.track_continuity_loss_max',
        value: maxGapSec,
        displayValue: `${maxGapSec.toFixed(1)} 秒 (接触 ${worstContactId.slice(0, 8)})`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [
          {
            source: 'csv',
            ref: `ContactPositions:${worstContactId.slice(0, 8)}`,
            scenarioClock: ctx.situation.endGameClock,
            description: `目标 ${worstContactId.slice(0, 8)} 出现最大跟踪中断 ${maxGapSec.toFixed(1)} 秒`,
          },
        ],
        details: { maxGapSec, worstContactId },
      };
    },
  },

  // 12. kc.engagement_cycle_count
  {
    meta: {
      id: 'kc.engagement_cycle_count',
      name: '原生交战周期数',
      category: 'time',
      evalRole: 'MOP',
      domain: 'kill_chain',
      doctrineRef: 'CMO Native EngagementCycle & OODA Loop Frequency',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '直接基于引擎原生 EngagementCycle 事件统计己方有效发起并推进的火控交战循环总次数。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '次',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['EngagementCycle'],
        csvColumns: ['UnitID', 'UnitSide', 'CycleAction', 'ContactID', 'SalvoID'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const cycleEvents = ctx.situation.events.filter(
        (ev) =>
          ev.kind === 'EngagementCycle' &&
          (!targetSide || isSameSide(ev.side, targetSide)),
      );

      const count = cycleEvents.length || ctx.situation.weaponFiredEvents.filter((f) => !targetSide || isSameSide(f.firerSide, targetSide)).length;

      return {
        atomId: 'kc.engagement_cycle_count',
        value: count,
        displayValue: `${count} 次交战循环`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'EngagementCycle',
            scenarioClock: ctx.situation.endGameClock,
            description: `统计有效交战循环：${count} 次`,
          },
        ],
        details: { totalCycleCount: count },
      };
    },
  },

  // 13. [v3 扩展] isr.estimation_error_variance
  {
    meta: {
      id: 'isr.estimation_error_variance',
      name: '雷达态势估计与物理真值误差方差',
      category: 'situation',
      evalRole: 'MOP',
      domain: 'kill_chain',
      doctrineRef: 'Radar Estimation vs Truth State Geodesic Error Variance',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '将雷达探测估测坐标 (ContactPositions) 与目标真实航迹 (UnitPositions) 按离散时钟插值对齐，解算空间测距误差的方差 sigma^2 与均值。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '米',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['ContactPositions', 'UnitPositions'],
        csvColumns: ['ContactLongitude', 'ContactLatitude', 'UnitLongitude', 'UnitLatitude', 'Time'],
      },
    },
    evaluate(ctx) {
      const errorsMeters: number[] = [];
      const evidenceRefs: EvidenceRef[] = [];

      for (const contact of ctx.situation.contacts.values()) {
        if (!contact.actualUnitId || !contact.track || contact.track.length === 0) continue;
        const trueUnit = ctx.situation.units.get(contact.actualUnitId);
        if (!trueUnit || !trueUnit.track || trueUnit.track.length === 0) continue;

        for (const cPt of contact.track) {
          const matchedTruePt = trueUnit.track.find(
            (tPt) => Math.abs(tPt.scenarioSeconds - cPt.scenarioSeconds) <= 5,
          );
          if (matchedTruePt) {
            const errNm = nmBetween({ lon: cPt.lon, lat: cPt.lat }, { lon: matchedTruePt.lon, lat: matchedTruePt.lat });
            const errMeters = errNm * 1852;
            errorsMeters.push(errMeters);
          }
        }
      }

      if (errorsMeters.length < 3) {
        return unavailableResult(
          'isr.estimation_error_variance',
          '态势估计与物理真值有效时间配对样本不足（<3）',
        );
      }

      const meanErr = errorsMeters.reduce((a, b) => a + b, 0) / errorsMeters.length;
      const variance =
        errorsMeters.reduce((acc, val) => acc + Math.pow(val - meanErr, 2), 0) / (errorsMeters.length - 1);
      const stdDev = Math.round(Math.sqrt(variance) * 10) / 10;

      return {
        atomId: 'isr.estimation_error_variance',
        value: stdDev,
        displayValue: `±${stdDev.toFixed(1)} 米 (均值偏差: ${meanErr.toFixed(1)}m)`,
        status: 'valid',
        confidence: errorsMeters.length >= 20 ? 'high' : 'medium',
        sampleSize: errorsMeters.length,
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'ContactPositions ⟷ UnitPositions',
            scenarioClock: ctx.situation.endGameClock,
            description: `态势测距误差对齐采样 ${errorsMeters.length} 点，标准差 ±${stdDev}m`,
          },
        ],
        details: { stdDevMeters: stdDev, varianceMetersSq: Math.round(variance), meanBiasMeters: Math.round(meanErr * 10) / 10, sampleCount: errorsMeters.length },
      };
    },
  },

  // 14. [v3 扩展] c2.mission_role_transition_latency
  {
    meta: {
      id: 'c2.mission_role_transition_latency',
      name: '任务指令重构响应时延',
      category: 'time',
      evalRole: 'MOP',
      domain: 'kill_chain',
      doctrineRef: 'C2 Mission Tasking Retasking & Maneuver Response Latency',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '提取 MissionChanged 任务阶段状态跳变时刻，对比受令战机航向发生实质规避或转弯响应（偏航角 >30度）的时钟差。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '秒',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['MissionChanged', 'UnitPositions'],
        csvColumns: ['OldStatus', 'NewStatus', 'UnitCourse', 'Time'],
      },
    },
    evaluate(ctx) {
      const missionEvents = ctx.situation.events.filter((e) => e.kind === 'MissionChanged');
      if (missionEvents.length === 0) {
        return unavailableResult('c2.mission_role_transition_latency', '缺少 MissionChanged 任务状态变更记录');
      }

      const latencies: number[] = [];
      for (const mEv of missionEvents) {
        const cmdSec = mEv.scenarioSeconds;
        for (const u of ctx.situation.units.values()) {
          const respPoint = u.track.find((p) => p.scenarioSeconds > cmdSec && p.scenarioSeconds <= cmdSec + 120);
          if (respPoint) {
            latencies.push(respPoint.scenarioSeconds - cmdSec);
            break;
          }
        }
      }

      if (latencies.length === 0) {
        return unavailableResult('c2.mission_role_transition_latency', '未检测到任务下发后的有效机动响应');
      }

      latencies.sort((a, b) => a - b);
      const median = computeQuantile(latencies, 0.5);

      return {
        atomId: 'c2.mission_role_transition_latency',
        value: median,
        displayValue: `${median.toFixed(1)} 秒`,
        status: 'valid',
        confidence: 'medium',
        sampleSize: latencies.length,
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'MissionChanged',
            scenarioClock: formatDuration(median),
            description: `任务指令下发到战机偏航响应时延中位数: ${median}s`,
          },
        ],
        details: { medianLatencySec: median, sampleCount: latencies.length },
      };
    },
  },
];
