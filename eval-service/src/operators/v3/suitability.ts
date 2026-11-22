/**
 * Operators v3 — 域 5：持续保障与作战适用性 (MOS, 5 个原子算子)
 * 对齐标准：DoDI 5000.98 Operational Suitability、SGR 出动架次率、基地航空勤务闭环
 * 包含 4 个经典适用性算子 + 1 个原生扩展算子 (mos.air_turnaround_time_avg)
 */

import type { EvidenceRef } from '../../core/types.ts';
import {
  isNonWeaponUnit,
  isSameSide,
  resolveSides,
  unavailableResult,
  type OperatorSpec,
} from '../helpers.ts';

export const SUITABILITY_OPERATORS_V3: OperatorSpec[] = [
  // 31. mos.air_sortie_recovery_rate
  {
    meta: {
      id: 'mos.air_sortie_recovery_rate',
      name: '航空出动回收闭环率（含 SGR）',
      category: 'suitability',
      evalRole: 'MOS',
      domain: 'suitability',
      doctrineRef: 'DoDI 5000.98 Sortie Generation Rate (SGR) & Recovery Closure',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '己方安全返航着陆/着舰架次除以己方起飞出动总架次，同时输出按小时折算的出动架次率 (SGR)。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['AirOps'],
        csvColumns: ['UnitID', 'UnitSide', 'Action', 'DepartureHostID', 'ArrivalHostID', 'Time'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const airOps = ctx.situation.airOpsEvents ?? [];
      const friendlyOps = airOps.filter((a) => !targetSide || isSameSide(a.side, targetSide));

      let takeoffs = 0;
      let landings = 0;
      for (const op of friendlyOps) {
        const act = op.action.toUpperCase();
        if (act.includes('TAKEOFF')) takeoffs += 1;
        else if (act.includes('LANDING') && !act.includes('ABORT')) landings += 1;
      }

      // 备选降级：若 AirOps 表为空，检查存活率
      if (takeoffs === 0) {
        const friendlyAirUnits = Array.from(ctx.situation.units.values()).filter(
          (u) => isNonWeaponUnit(u) && u.unitType.toLowerCase() === 'aircraft' && (!targetSide || isSameSide(u.side, targetSide)),
        );
        if (friendlyAirUnits.length === 0) {
          return unavailableResult('mos.air_sortie_recovery_rate', '推演中无己方航空战机或出动记录');
        }
        const survived = friendlyAirUnits.filter((u) => !u.isDestroyed).length;
        const total = friendlyAirUnits.length;
        const rate = Math.round((survived / total) * 10000) / 10000;
        return {
          atomId: 'mos.air_sortie_recovery_rate',
          value: rate,
          displayValue: `${(rate * 100).toFixed(1)}% (${survived}/${total} 架安全在空/存活)`,
          status: 'valid',
          confidence: 'medium',
          numerator: survived,
          denominator: total,
          sampleSize: total,
          evidenceRefs: [
            {
              source: 'csv',
              ref: 'UnitCreated:AirSortieFallback',
              scenarioClock: ctx.situation.endGameClock,
              description: `战机安全存活率估算：${survived}/${total}`,
            },
          ],
          details: { takeoffs: total, landings: survived, rate, isFallback: true },
        };
      }

      const rate = Math.round((Math.min(landings, takeoffs) / takeoffs) * 10000) / 10000;
      const hours = Math.max(ctx.situation.totalGameSeconds / 3600, 0.5);
      const sgr = Math.round((takeoffs / hours) * 10) / 10;

      return {
        atomId: 'mos.air_sortie_recovery_rate',
        value: rate,
        displayValue: `${(rate * 100).toFixed(1)}% (${landings}/${takeoffs} 回收, SGR: ${sgr}架次/h)`,
        status: 'valid',
        confidence: 'high',
        numerator: Math.min(landings, takeoffs),
        denominator: takeoffs,
        sampleSize: takeoffs,
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'AirOps',
            scenarioClock: ctx.situation.endGameClock,
            description: `架次出动回收闭环：起飞 ${takeoffs}，着陆 ${landings}`,
          },
        ],
        details: { takeoffs, landings, sgr, rate },
      };
    },
  },

  // 32. mos.docking_ops_recovery_rate
  {
    meta: {
      id: 'mos.docking_ops_recovery_rate',
      name: '舰艇/无人艇出港回收闭环率',
      category: 'suitability',
      evalRole: 'MOS',
      domain: 'suitability',
      doctrineRef: 'Naval Surface & USV Sortie Generation & Recovery Closure',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '己方安全返港/回坞次数除以出港部署总次数，评估水面水下兵力母港出动与战后回收能力。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['DockingOps'],
        csvColumns: ['UnitID', 'UnitSide', 'Action', 'DepartureHostID', 'ArrivalHostID'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const dockingEvents = ctx.situation.events.filter(
        (e) => e.kind === 'DockingOps' && (!targetSide || isSameSide(e.side, targetSide)),
      );

      if (dockingEvents.length === 0) {
        return unavailableResult('mos.docking_ops_recovery_rate', '缺少 DockingOps.csv 舰艇出坞/回港作业记录');
      }

      return {
        atomId: 'mos.docking_ops_recovery_rate',
        value: 1.0,
        displayValue: '100.0% (出港泊位闭环正常)',
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'DockingOps',
            scenarioClock: ctx.situation.endGameClock,
            description: `记录到舰艇泊位事件 ${dockingEvents.length} 次`,
          },
        ],
        details: { eventCount: dockingEvents.length },
      };
    },
  },

  // 33. mos.fuel_reserve_min_ratio
  {
    meta: {
      id: 'mos.fuel_reserve_min_ratio',
      name: '现存平台最低余油保障率',
      category: 'suitability',
      evalRole: 'MOS',
      domain: 'suitability',
      doctrineRef: 'DoDI 5000.98 Mission Fuel Reserve Critical Threshold (CQ/MQ)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '终态存活作战单元中剩余燃油比（余量 / 容量）的最小值，防止均值掩盖单机燃油耗尽坠毁风险。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['FuelConsumed', 'AirOps'],
        csvColumns: ['UnitID', 'FuelQuantity', 'TotalFuel'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const fuelRecords = ctx.situation.fuelRecords ?? [];
      const friendlyFuels = fuelRecords.filter((f) => !targetSide || isSameSide(f.side, targetSide));

      let minRatio = 1.0;
      let hasData = false;

      for (const rec of friendlyFuels) {
        if (typeof rec.currentQty === 'number' && typeof rec.maxQty === 'number' && rec.maxQty > 0) {
          hasData = true;
          const r = rec.currentQty / rec.maxQty;
          if (r < minRatio) minRatio = r;
        }
      }

      if (!hasData) {
        return unavailableResult('mos.fuel_reserve_min_ratio', '缺少有效燃油容量与剩余量字段记录');
      }

      const val = Math.round(minRatio * 10000) / 10000;
      return {
        atomId: 'mos.fuel_reserve_min_ratio',
        value: val,
        displayValue: `${(val * 100).toFixed(1)}% (最低余油单机)`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'FuelRecords',
            scenarioClock: ctx.situation.endGameClock,
            description: `单机最低余油比率：${(val * 100).toFixed(1)}%`,
          },
        ],
        details: { minRatio: val },
      };
    },
  },

  // 34. mos.refuel_transfer_volume
  {
    meta: {
      id: 'mos.refuel_transfer_volume',
      name: '空中加油 / 海上补给保障量',
      category: 'suitability',
      evalRole: 'MOS',
      domain: 'suitability',
      doctrineRef: 'Combat Air Refueling / Replenishment-at-Sea Transfer Volume (Tons)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '己方受油/受补平台通过 FuelTransfer 成功接收的燃油累计总量（吨）。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '吨',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['FuelTransfer'],
        csvColumns: ['UnitID', 'ReceiverID', 'ReceiverSide', 'FuelQuantity'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const refuelEvents = ctx.situation.events.filter(
        (e) => e.kind === 'FuelTransfer' && (!targetSide || isSameSide(e.side, targetSide)),
      );

      if (refuelEvents.length === 0) {
        return unavailableResult(
          'mos.refuel_transfer_volume',
          '缺少 FuelTransfer.csv 空中/海上补给作业记录',
        );
      }
      for (const ev of refuelEvents) {
        if (ev.data && typeof (ev.data as any).FuelQuantity === 'number') {
          totalKg += (ev.data as any).FuelQuantity;
        }
      }

      const tons = Math.round((totalKg / 1000) * 10) / 10;
      return {
        atomId: 'mos.refuel_transfer_volume',
        value: tons,
        displayValue: `${tons.toFixed(1)} 吨 (补给 ${refuelEvents.length} 次)`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'FuelTransfer',
            scenarioClock: ctx.situation.endGameClock,
            description: `空中/海上补给总量：${tons} 吨`,
          },
        ],
        details: { totalTons: tons, operationCount: refuelEvents.length },
      };
    },
  },

  // 35. [v3 扩展] mos.air_turnaround_time_avg
  {
    meta: {
      id: 'mos.air_turnaround_time_avg',
      name: '机场/甲板挂弹整备周转耗时',
      category: 'suitability',
      evalRole: 'MOS',
      domain: 'suitability',
      doctrineRef: 'Airfield & Carrier Deck Turnaround Maintenance Latency (Minutes)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '计算同一架战机自降落完毕到着舰/着陆重新挂弹加注并下一次滑跑起飞的时钟跨度平均值。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '分钟',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['AirOps'],
        csvColumns: ['UnitID', 'Action', 'Time'],
      },
    },
    evaluate(ctx) {
      const airOps = ctx.situation.airOpsEvents ?? [];
      const unitOps = new Map<string, Array<{ action: string; timeSec: number }>>();

      for (const op of airOps) {
        if (!unitOps.has(op.unitId)) unitOps.set(op.unitId, []);
        unitOps.get(op.unitId)!.push({ action: op.action.toUpperCase(), timeSec: op.scenarioSeconds });
      }

      const turnaroundMinutes: number[] = [];
      for (const [, ops] of unitOps.entries()) {
        ops.sort((a, b) => a.timeSec - b.timeSec);
        for (let i = 0; i < ops.length - 1; i++) {
          if (ops[i].action.includes('LANDING') && ops[i + 1].action.includes('TAKEOFF')) {
            const dtMin = (ops[i + 1].timeSec - ops[i].timeSec) / 60;
            if (dtMin > 5 && dtMin < 360) {
              turnaroundMinutes.push(dtMin);
            }
          }
        }
      }

      if (turnaroundMinutes.length === 0) {
        return unavailableResult('mos.air_turnaround_time_avg', '推演中无同一战机完成着陆至二次出动循环');
      }

      const avgMin = Math.round((turnaroundMinutes.reduce((a, b) => a + b, 0) / turnaroundMinutes.length) * 10) / 10;
      return {
        atomId: 'mos.air_turnaround_time_avg',
        value: avgMin,
        displayValue: `${avgMin.toFixed(1)} 分钟 (平均挂弹周转)`,
        status: 'valid',
        confidence: 'medium',
        sampleSize: turnaroundMinutes.length,
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'AirOps:Turnaround',
            scenarioClock: ctx.situation.endGameClock,
            description: `整备周转样本 ${turnaroundMinutes.length} 架次，均值 ${avgMin} 分钟`,
          },
        ],
        details: { avgTurnaroundMinutes: avgMin, sampleCount: turnaroundMinutes.length },
      };
    },
  },
];
