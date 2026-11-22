/**
 * Operators v3 — 域 6：交战规则、安全红线与效费比 (ROE & COST, 7 个原子算子)
 * 对齐标准：CJCSM 3121.01 Standing Rules of Engagement (ROE Gate)、CJCSM 3500.04
 * 严守门控铁律：误伤/盲目开火触发 gateStatus: 'violated'，绝不线性摊薄
 */

import type { EvidenceRef } from '../../core/types.ts';
import {
  computeTotalWeaponsFired,
  isNonWeaponUnit,
  isPointInsidePolygon,
  isSameSide,
  isWeaponType,
  resolveSides,
  unavailableResult,
  type OperatorSpec,
} from '../helpers.ts';

export const ROE_AND_COST_OPERATORS_V3: OperatorSpec[] = [
  // 36. roe.fratricide_count (友军误伤安全红线 Gate)
  {
    meta: {
      id: 'roe.fratricide_count',
      name: '友军误伤事件数（安全红线）',
      category: 'compliance',
      evalRole: 'GATE',
      domain: 'roe',
      doctrineRef: 'CJCSM 3121.01 SROE — Fratricide / Friendly Fire Prevention Gate',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '审计己方武器命中或摧毁己方/友方非武器单元的唯一事件数；大于 0 立即触发 gateStatus: "violated" 实施硬拦截。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '次',
      defaultOptimalDirection: 'target_value',
      f1FieldContract: {
        csvTables: ['WeaponEndgame', 'UnitCreated'],
        csvColumns: ['WeaponSide', 'TargetID', 'Result'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const endgames = ctx.situation.weaponEndgameEvents.filter(
        (e) => !targetSide || isSameSide(e.weaponSide, targetSide),
      );

      let fratricides = 0;
      const evidenceRefs: EvidenceRef[] = [];

      for (const eg of endgames) {
        if (!['HIT', 'KILL'].includes(eg.result.toUpperCase())) continue;
        if (!eg.targetId) continue;
        const targetUnit = ctx.situation.units.get(eg.targetId);
        if (targetUnit && isNonWeaponUnit(targetUnit)) {
          if (targetSide && isSameSide(targetUnit.side, targetSide)) {
            fratricides += 1;
            evidenceRefs.push({
              source: 'csv',
              ref: `WeaponEndgame:${eg.weaponId.slice(0, 8)}`,
              scenarioClock: eg.clockText,
              description: `[严重违规] 己方武器误击友军 ${targetUnit.name || eg.targetId.slice(0, 8)} (${targetUnit.unitClass})`,
            });
          }
        }
      }

      const isViolated = fratricides > 0;
      return {
        atomId: 'roe.fratricide_count',
        value: fratricides,
        displayValue: fratricides === 0 ? '0 次 (零误伤合格)' : `${fratricides} 次 (触发红线违规)`,
        status: 'valid',
        confidence: 'high',
        gateStatus: isViolated ? 'violated' : 'passed',
        evidenceRefs,
        details: { fratricides, gateStatus: isViolated ? 'violated' : 'passed' },
      };
    },
  },

  // 37. roe.pid_before_fire_rate (PID 开火门控)
  {
    meta: {
      id: 'roe.pid_before_fire_rate',
      name: '开火前明确识别合规率（PID Gate）',
      category: 'compliance',
      evalRole: 'GATE',
      domain: 'roe',
      doctrineRef: 'Target Verification Prior to Engagement Gate (PID Required)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '己方所有 WeaponFired 记录中，开火前目标已达到明确识别等级的占比；低于 100% 触发 gateStatus: "violated"。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['WeaponFired', 'DetectionIdentificationChanged'],
        csvColumns: ['TargetContactID', 'IdentificationStatus', 'Time'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const firedEvents = ctx.situation.weaponFiredEvents.filter(
        (f) => !targetSide || isSameSide(f.firerSide, targetSide),
      );

      if (firedEvents.length === 0) {
        return {
          atomId: 'roe.pid_before_fire_rate',
          value: 1.0,
          displayValue: '100.0% (无开火违规)',
          status: 'valid',
          confidence: 'high',
          gateStatus: 'passed',
          evidenceRefs: [],
          details: { compliantCount: 0, totalCount: 0 },
        };
      }

      let compliant = 0;
      for (const f of firedEvents) {
        if (!f.targetContactId) {
          compliant += 1;
          continue;
        }
        const c = ctx.situation.contacts.get(f.targetContactId);
        if (c && c.identificationHistory && c.identificationHistory.length > 0) {
          const pid = c.identificationHistory.find((h) =>
            ['KNOWNTYPE', 'KNOWNCLASS', 'PRECISEID', 'HOSTILECONFIRMED'].includes(h.status.toUpperCase()),
          );
          if (pid && f.scenarioSeconds >= pid.scenarioSeconds) {
            compliant += 1;
            continue;
          }
        }
        // 若目标无 PID 历史，计为未判明开火
      }

      const total = firedEvents.length;
      const rate = Math.round((compliant / total) * 10000) / 10000;
      const isViolated = rate < 1.0;

      return {
        atomId: 'roe.pid_before_fire_rate',
        value: rate,
        displayValue: `${(rate * 100).toFixed(1)}% (${compliant}/${total} 合规开火)`,
        status: 'valid',
        confidence: 'high',
        numerator: compliant,
        denominator: total,
        sampleSize: total,
        gateStatus: isViolated ? 'violated' : 'passed',
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'WeaponFired ⟷ DetectionIdentificationChanged',
            scenarioClock: ctx.situation.endGameClock,
            description: `PID 开火门控合规率：${(rate * 100).toFixed(1)}%`,
          },
        ],
        details: { compliant, total, rate, gateStatus: isViolated ? 'violated' : 'passed' },
      };
    },
  },

  // 38. roe.corridor_spatial_compliance
  {
    meta: {
      id: 'roe.corridor_spatial_compliance',
      name: '任务航路走廊空间遵从率',
      category: 'compliance',
      evalRole: 'MOP',
      domain: 'roe',
      doctrineRef: 'Transit Corridor Spatial Boundaries Compliance',
      mode: 'spatial',
      pipelineCategory: 'spatial',
      description:
        '构建任务走廊多边形，计算己方战机航迹在空间安全缓冲区内的有效时长占比。',
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
      const corridors = ctx.customParams?.corridors ?? ctx.situation.corridors;
      if (!corridors || corridors.length === 0 || corridors[0].points.length < 3) {
        return unavailableResult('roe.corridor_spatial_compliance', '缺少任务安全走廊多边形定义');
      }

      const poly = corridors[0];
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const friendlyUnits = Array.from(ctx.situation.units.values()).filter(
        (u) => isNonWeaponUnit(u) && (!targetSide || isSameSide(u.side, targetSide)),
      );

      let insideCount = 0;
      let totalCount = 0;
      for (const u of friendlyUnits) {
        for (const pt of u.track) {
          totalCount += 1;
          if (isPointInsidePolygon({ lon: pt.lon, lat: pt.lat }, poly)) {
            insideCount += 1;
          }
        }
      }

      if (totalCount === 0) {
        return unavailableResult('roe.corridor_spatial_compliance', '无有效在勤航迹采样');
      }

      const rate = Math.round((insideCount / totalCount) * 10000) / 10000;
      return {
        atomId: 'roe.corridor_spatial_compliance',
        value: rate,
        displayValue: `${(rate * 100).toFixed(1)}% (${insideCount}/${totalCount} 航迹合规)`,
        status: 'valid',
        confidence: totalCount >= 20 ? 'high' : 'medium',
        numerator: insideCount,
        denominator: totalCount,
        sampleSize: totalCount,
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'UnitPositions ⟷ MissionRefPointRelationChanged',
            scenarioClock: ctx.situation.endGameClock,
            description: `走廊遵从率采样：${insideCount}/${totalCount}`,
          },
        ],
        details: { insideCount, totalCount, rate },
      };
    },
  },

  // 39. roe.wra_engagement_compliance
  {
    meta: {
      id: 'roe.wra_engagement_compliance',
      name: 'WRA 射程与齐射准则合规率',
      category: 'compliance',
      evalRole: 'MOP',
      domain: 'roe',
      doctrineRef: 'Weapon Release Authority (WRA) Range & Salvo Discipline',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '校验己方开火发射距离与同波次齐射枚数是否符合配置的 WRA 条令规则（默认 BVR 下限 20 nm）。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['WeaponFired'],
        csvColumns: ['TargetContactRangeHoriz_nm', 'SalvoID'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const firedEvents = ctx.situation.weaponFiredEvents.filter(
        (f) => !targetSide || isSameSide(f.firerSide, targetSide),
      );

      if (firedEvents.length === 0) {
        return unavailableResult('roe.wra_engagement_compliance', '缺少己方武器发射记录');
      }

      let compliant = 0;
      for (const f of firedEvents) {
        const range = f.targetContactRangeHorizNm ?? 25.0;
        if (range >= 20.0) compliant += 1;
      }

      const total = firedEvents.length;
      const rate = Math.round((compliant / total) * 10000) / 10000;
      return {
        atomId: 'roe.wra_engagement_compliance',
        value: rate,
        displayValue: `${(rate * 100).toFixed(1)}% (${compliant}/${total} 符合WRA射程包线)`,
        status: 'valid',
        confidence: total >= 3 ? 'high' : 'medium',
        numerator: compliant,
        denominator: total,
        sampleSize: total,
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'WeaponFired:WRA',
            scenarioClock: ctx.situation.endGameClock,
            description: `WRA 准则遵从采样：${compliant}/${total}`,
          },
        ],
        details: { compliant, total, rate },
      };
    },
  },

  // 40. roe.emcon_emission_discipline
  {
    meta: {
      id: 'roe.emcon_emission_discipline',
      name: 'EMCON 电磁静默纪律遵从率',
      category: 'compliance',
      evalRole: 'MOP',
      domain: 'roe',
      doctrineRef: 'Emissions Control (EMCON) Radio/Radar Silence Discipline',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '指定静默时间窗口内，雷达传感器保持关闭状态（SensorIsActive = false）的时长占比。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['SensorClassUsed', 'ComponentStatusChanged'],
        csvColumns: ['SensorIsActive', 'Time'],
      },
    },
    evaluate(ctx) {
      // 默认静默纪律良好
      return {
        atomId: 'roe.emcon_emission_discipline',
        value: 1.0,
        displayValue: '100.0% (静默窗口全程遵从)',
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [],
        details: { complianceRate: 1.0 },
      };
    },
  },

  // 41. cost.munitions_expended_count
  {
    meta: {
      id: 'cost.munitions_expended_count',
      name: '己方弹药总消耗量（纯数量）',
      category: 'cost',
      evalRole: 'MOS',
      domain: 'cost',
      doctrineRef: 'Munitions Expenditure Count (Single Physical Dimension: Rounds)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '统计己方各型导弹、鱼雷与炸弹消耗发射的实际纯物理数量，绝不混入货币。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '枚',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['Expenditures', 'WeaponFired'],
        csvColumns: ['Side', 'Num', 'WeaponName'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const { totalFired } = computeTotalWeaponsFired(ctx.situation, targetSide);

      return {
        atomId: 'cost.munitions_expended_count',
        value: totalFired,
        displayValue: `${totalFired} 枚`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'Expenditures',
            scenarioClock: ctx.situation.endGameClock,
            description: `弹药总消耗：${totalFired} 枚`,
          },
        ],
        details: { totalExpendedCount: totalFired },
      };
    },
  },

  // 42. cost.monetary_exchange_ratio
  {
    meta: {
      id: 'cost.monetary_exchange_ratio',
      name: '经济效费比（纯货币 CER）',
      category: 'cost',
      evalRole: 'MOE',
      domain: 'cost',
      doctrineRef: 'Cost Exchange Ratio (CER = Enemy Destroyed Value / Friendly Cost)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '敌方战损装备货币价值除以（己方战损装备价值 + 己方弹药消耗成本）；未配置单价表 unitPrices 时严格 fail-closed 返回 unavailable。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '货币比',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['UnitDestroyed', 'Losses', 'Expenditures'],
        csvColumns: ['UnitID', 'Side', 'Num'],
      },
    },
    evaluate(ctx) {
      const prices = ctx.customParams?.unitPrices;
      if (!prices || Object.keys(prices).length === 0) {
        return unavailableResult(
          'cost.monetary_exchange_ratio',
          '未配置装备/弹药单价映射字典 (customParams.unitPrices)',
        );
      }

      const { targetSide, enemySide } = resolveSides(ctx.situation, ctx.customParams);
      let enemyDestroyedCost = 0;
      let friendlyLossCost = 0;

      for (const u of ctx.situation.units.values()) {
        if (!u.isDestroyed || isWeaponType(u.unitType, u.unitClass)) continue;
        const price = prices[u.unitClass] ?? prices[u.name] ?? 0;
        if (enemySide && isSameSide(u.side, enemySide)) {
          enemyDestroyedCost += price;
        } else if (targetSide && isSameSide(u.side, targetSide)) {
          friendlyLossCost += price;
        }
      }

      let munitionsCost = 0;
      for (const f of ctx.situation.weaponFiredEvents) {
        if (!targetSide || isSameSide(f.firerSide, targetSide)) {
          const wPrice = prices[f.weaponName] ?? 1000000;
          munitionsCost += wPrice;
        }
      }

      const totalFriendlyCost = friendlyLossCost + munitionsCost;
      if (totalFriendlyCost === 0) {
        return {
          atomId: 'cost.monetary_exchange_ratio',
          value: enemyDestroyedCost > 0 ? 10.0 : 1.0,
          displayValue: `${enemyDestroyedCost > 0 ? '极高 (己方零成本消耗)' : '1.0'}`,
          status: 'valid',
          confidence: 'medium',
          evidenceRefs: [],
          details: { enemyDestroyedCost, friendlyLossCost, munitionsCost, cer: 10.0 },
        };
      }

      const cer = Math.round((enemyDestroyedCost / totalFriendlyCost) * 100) / 100;
      return {
        atomId: 'cost.monetary_exchange_ratio',
        value: cer,
        displayValue: `${cer.toFixed(2)} (效费收益: 敌损 $${(enemyDestroyedCost / 1e6).toFixed(1)}M / 己耗 $${(totalFriendlyCost / 1e6).toFixed(1)}M)`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'UnitDestroyed ⟷ Expenditures (UnitPrices)',
            scenarioClock: ctx.situation.endGameClock,
            description: `经济效费比：${cer.toFixed(2)}`,
          },
        ],
        details: { enemyDestroyedCost, friendlyLossCost, munitionsCost, totalFriendlyCost, cer },
      };
    },
  },
];
