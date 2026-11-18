import type { EvidenceRef, MetricAtomContext, MetricAtomResult } from '../../core/types.ts';
import { isNonWeaponUnit, isWeaponType, resolveSides, unavailableResult } from '../helpers.ts';
import type { OperatorSpec } from '../time/index.ts';

function lookupPrice(
  prices: Record<string, number> | undefined,
  keys: Array<string | undefined>,
): number | undefined {
  if (!prices) return undefined;
  for (const k of keys) {
    if (!k) continue;
    if (typeof prices[k] === 'number' && Number.isFinite(prices[k])) return prices[k];
    const trimmed = k.replace(/\s+#\d+$/, '').trim();
    if (typeof prices[trimmed] === 'number' && Number.isFinite(prices[trimmed])) return prices[trimmed];
  }
  return undefined;
}

function collectOwnExpenditures(ctx: MetricAtomContext, targetSide?: string) {
  if (ctx.situation.expenditures.length > 0) {
    const items = ctx.situation.expenditures.filter(
      (e) => !targetSide || e.side === targetSide,
    );
    return items.map((e) => ({
      weaponName: e.weaponName,
      dbid: e.dbid,
      num: e.num,
      ref: e.sourceRef,
    }));
  }

  // 回退使用 WeaponFired 统计发射总数
  return ctx.situation.weaponFiredEvents
    .filter((f) => !targetSide || f.firerSide === targetSide)
    .map((f) => ({
      weaponName: f.weaponTypeNormalized,
      dbid: f.weaponDbid,
      num: f.rounds,
      ref: f.sourceRef,
    }));
}

export const COST_OPERATORS: OperatorSpec[] = [
  {
    meta: {
      id: 'cost.munitions_cost_total',
      name: '弹药消耗总量 / 货币成本',
      category: 'cost',
      mode: 'aggregation',
      pipelineCategory: 'group_agg',
      description:
        '优先读取 Expenditures.csv（次选 WeaponFired 发射计数）累计己方弹药消耗；若提供单价表 unitPrices 则折算总货币成本，否则降级报告实耗弹药枚数。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'events'],
      outputType: 'count',
      unit: '成本 / 枚数',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['Expenditures', 'WeaponFired'],
        csvColumns: ['DBID', 'WeaponName', 'Side', 'Num'],
        discrepancyNotes: ['D9：Expenditures.csv 不在 LabConsole 默认允许表中，本算子直接基于实证 csv-adapter 读取'],
      },
    },
    evaluate(ctx): MetricAtomResult {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const items = collectOwnExpenditures(ctx, targetSide);

      if (items.length === 0) {
        if (!ctx.situation.coverage.hasExpenditures && !ctx.situation.coverage.hasWeaponFired) {
          return unavailableResult(
            'cost.munitions_cost_total',
            '无 Expenditures 消耗账单与 WeaponFired 开火记录',
          );
        }
        return {
          atomId: 'cost.munitions_cost_total',
          value: 0,
          displayValue: '0 枚 (未消耗弹药)',
          status: 'valid',
          confidence: 'high',
          evidenceRefs: [],
        };
      }

      const prices = { ...(ctx.situation.unitPrices ?? {}), ...(ctx.customParams?.unitPrices ?? {}) };
      const hasAnyPrices = Object.keys(prices).length > 0;

      let totalRounds = 0;
      let totalCost = 0;
      let pricedRounds = 0;
      const byWeapon = new Map<string, { rounds: number; cost: number }>();
      const evidenceRefs: EvidenceRef[] = [];

      for (const item of items) {
        totalRounds += item.num;
        const unitPrice = lookupPrice(prices, [item.dbid, item.weaponName]);
        const itemCost = unitPrice !== undefined ? unitPrice * item.num : 0;
        if (unitPrice !== undefined) {
          pricedRounds += item.num;
          totalCost += itemCost;
        }
        const cur = byWeapon.get(item.weaponName) ?? { rounds: 0, cost: 0 };
        cur.rounds += item.num;
        cur.cost += itemCost;
        byWeapon.set(item.weaponName, cur);

        if (evidenceRefs.length < 8) {
          evidenceRefs.push({
            source: item.ref.startsWith('CSV:') ? 'csv' : 'frame',
            ref: item.ref,
            scenarioClock: ctx.situation.endGameClock,
            description: `消耗 ${item.weaponName} × ${item.num}${unitPrice !== undefined ? ` (单价 ${unitPrice})` : ''}`,
          });
        }
      }

      const breakdown = Object.fromEntries(byWeapon.entries());

      if (hasAnyPrices && pricedRounds > 0) {
        const roundedCost = Math.round(totalCost * 100) / 100;
        const partial = pricedRounds < totalRounds;
        return {
          atomId: 'cost.munitions_cost_total',
          value: roundedCost,
          displayValue: `${roundedCost.toLocaleString('en-US')} 货币单位 (${totalRounds} 枚)`,
          status: partial ? 'degraded' : 'valid',
          confidence: partial ? 'medium' : 'high',
          evidenceRefs,
          details: { totalCost: roundedCost, totalRounds, pricedRounds, hasPrices: true, breakdown },
        };
      }

      return {
        atomId: 'cost.munitions_cost_total',
        value: totalRounds,
        displayValue: `${totalRounds} 枚 (未配单价，以弹药总数计)`,
        status: 'degraded',
        confidence: 'medium',
        evidenceRefs,
        details: { totalRounds, hasPrices: false, breakdown },
      };
    },
  },
  {
    meta: {
      id: 'cost.economic_exchange_ratio',
      name: '经济效费比 (毁敌价值/己方战损与耗弹成本)',
      category: 'cost',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description:
        '依据装备单价表计算（敌方损失装备价值）/（己方损失装备价值 + 己方弹药消耗成本）；未配置单价表时不计算该指标。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'unit_states'],
      outputType: 'ratio',
      unit: '经济效费比',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['Losses', 'UnitDestroyed', 'Expenditures'],
        csvColumns: ['DBID', 'SubjectName', 'WeaponName', 'Side', 'Num'],
        discrepancyNotes: ['各型装备价值差异较大，未配置装备单价表时不进行直接比值计算'],
      },
    },
    evaluate(ctx): MetricAtomResult {
      const prices = { ...(ctx.situation.unitPrices ?? {}), ...(ctx.customParams?.unitPrices ?? {}) };
      if (Object.keys(prices).length === 0) {
        if (typeof ctx.csvStats?.cost_effectiveness === 'number') {
          const val = Math.round(ctx.csvStats.cost_effectiveness * 100) / 100;
          return {
            atomId: 'cost.economic_exchange_ratio',
            value: val,
            displayValue: `${val.toFixed(2)}× (metrics.py)`,
            status: 'valid',
            confidence: 'high',
            evidenceRefs: [
              {
                source: 'csv',
                ref: 'metrics.py:cost_effectiveness',
                scenarioClock: ctx.situation.endGameClock,
                description: `LabConsole metrics.py 计算经济效费比: ${val.toFixed(2)}`,
              },
            ],
          };
        }

        return unavailableResult(
          'cost.economic_exchange_ratio',
          '缺少装备及弹药单价表 (unitPrices)，无法将平台战损与弹药消耗折算为可比经济当量',
        );
      }

      const { targetSide, enemySide } = resolveSides(ctx.situation, ctx.customParams);
      if (!targetSide || !enemySide) {
        return unavailableResult('cost.economic_exchange_ratio', '缺少红蓝双方阵营标识');
      }

      const calcDestroyedPlatformCost = (side: string) => {
        const seen = new Set<string>();
        let cost = 0;
        let missingPriceCount = 0;
        const refs: EvidenceRef[] = [];

        const tryAdd = (id: string, dbid?: string, name?: string, unitClass?: string, ref?: string, clock?: string) => {
          if (seen.has(id)) return;
          seen.add(id);
          const p = lookupPrice(prices, [dbid, name, unitClass]);
          if (p !== undefined) {
            cost += p;
            if (refs.length < 4) {
              refs.push({
                source: 'csv',
                ref: ref ?? id,
                scenarioClock: clock ?? ctx.situation.endGameClock,
                description: `${side} 损失计价 ${name ?? id}: ${p}`,
              });
            }
          } else {
            missingPriceCount += 1;
          }
        };

        for (const l of ctx.situation.losses) {
          if (l.side === side && !isWeaponType(l.unitType, l.unitClass)) {
            tryAdd(l.subjectId, l.dbid, l.subjectName, l.unitClass, l.sourceRef);
          }
        }
        for (const u of ctx.situation.units.values()) {
          if (u.side === side && isNonWeaponUnit(u) && (u.isDestroyed || u.damageState === 'destroyed')) {
            tryAdd(u.unitId, u.dbid, u.unitName, u.unitClass, u.unitId, u.destroyedClock ?? u.lastSeenClock);
          }
        }

        return { cost, missingPriceCount, refs, lostCount: seen.size };
      };

      const ownPlatform = calcDestroyedPlatformCost(targetSide);
      const enemyPlatform = calcDestroyedPlatformCost(enemySide);
      const ammoItems = collectOwnExpenditures(ctx, targetSide);
      let ammoCost = 0;
      for (const a of ammoItems) {
        const p = lookupPrice(prices, [a.dbid, a.weaponName]);
        if (p !== undefined) ammoCost += p * a.num;
      }

      const denominator = ownPlatform.cost + ammoCost;
      if (denominator <= 0 && enemyPlatform.cost <= 0) {
        return unavailableResult(
          'cost.economic_exchange_ratio',
          '战损单元与消耗弹药在单价表 unitPrices 中均未命中任何报价项',
        );
      }

      const ratio = denominator > 0 ? enemyPlatform.cost / denominator : enemyPlatform.cost;
      const missingAny = ownPlatform.missingPriceCount > 0 || enemyPlatform.missingPriceCount > 0;

      return {
        atomId: 'cost.economic_exchange_ratio',
        value: Math.round(ratio * 100) / 100,
        displayValue: `${ratio.toFixed(2)}× (敌损 ${enemyPlatform.cost.toLocaleString('en-US')} / 己投 ${denominator.toLocaleString('en-US')})`,
        status: missingAny ? 'degraded' : 'valid',
        confidence: missingAny ? 'medium' : 'high',
        evidenceRefs: [...enemyPlatform.refs, ...ownPlatform.refs].slice(0, 8),
        details: {
          enemyDestroyedValue: enemyPlatform.cost,
          ownDestroyedValue: ownPlatform.cost,
          ownMunitionsCost: ammoCost,
          denominator,
        },
      };
    },
  },
  {
    meta: {
      id: 'cost.fuel_remaining_ratio',
      name: '平台平均余油保障率',
      category: 'cost',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description: '依据 BS 帧 ActiveUnits[].Fuel.FuelRec (CQ/MQ) 计算己方现存作战单元平均剩余燃油百分比，衡量后勤续航裕度。',
      readiness: 'batch_b_pending',
      requiredDataSources: ['situation', 'csv'],
      outputType: 'rate',
      unit: '余油率 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        bsFramePaths: ['ActiveUnits[].Fuel.FuelRec.{FT,CQ,MQ}'],
        csvTables: ['FuelConsumed', 'FuelTransfer'],
        csvColumns: ['UnitID', 'FuelQuantity', 'FuelType'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const recs = (ctx.situation.fuelRecords ?? []).filter((f) => !targetSide || f.side === targetSide);
      const withRatio = recs.filter(
        (r) => r.currentQty !== undefined && r.maxQty !== undefined && r.maxQty > 0,
      );
      if (withRatio.length === 0) {
        return unavailableResult(
          'cost.fuel_remaining_ratio',
          '当前数据源未采集到包含燃油状态 (CQ/MQ) 的记录，无法统计终态余油率',
        );
      }
      const avgRatio =
        withRatio.reduce((acc, r) => acc + Math.min(1, r.currentQty! / r.maxQty!), 0) /
        withRatio.length;
      return {
        atomId: 'cost.fuel_remaining_ratio',
        value: Math.round(avgRatio * 10000) / 10000,
        displayValue: `${(avgRatio * 100).toFixed(1)}%（覆盖 ${withRatio.length} 单元）`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: withRatio.slice(0, 5).map((r) => ({
          source: r.sourceRef.startsWith('CSV:') ? 'csv' : 'frame',
          ref: r.sourceRef,
          scenarioClock: ctx.situation.endGameClock,
          description: `${r.unitName ?? r.unitId} 余油 ${r.currentQty}/${r.maxQty}`,
        })),
      };
    },
  },
  {
    meta: {
      id: 'cost.unit_munitions_intensity',
      name: '单参战平台平均投弹密度',
      category: 'cost',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description: '统计己方消耗弹药总数与己方投入非武器作战平台数之比，衡量火力投送密度与平台弹仓利用率。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'unit_states'],
      outputType: 'ratio',
      unit: '枚 / 平台',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['Expenditures', 'WeaponFired', 'UnitCreated'],
        csvColumns: ['Num', 'WeaponName', 'UnitType', 'UnitSide'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const platforms = [...ctx.situation.units.values()].filter(
        (u) => (!targetSide || u.side === targetSide) && isNonWeaponUnit(u),
      );
      if (platforms.length === 0) {
        return unavailableResult('cost.unit_munitions_intensity', '缺少己方非武器作战平台台账，无法核算单平台投弹密度');
      }
      const items = collectOwnExpenditures(ctx, targetSide);
      if (items.length === 0 && !ctx.situation.coverage.hasExpenditures && !ctx.situation.coverage.hasWeaponFired) {
        return unavailableResult('cost.unit_munitions_intensity', '无 Expenditures 或 WeaponFired 耗弹数据');
      }
      const totalRounds = items.reduce((acc, i) => acc + i.num, 0);
      const density = totalRounds / platforms.length;
      return {
        atomId: 'cost.unit_munitions_intensity',
        value: Math.round(density * 100) / 100,
        displayValue: `${density.toFixed(2)} 枚/平台 (${totalRounds} 枚 / ${platforms.length} 平台)`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'UnitCreated+Expenditures',
            scenarioClock: ctx.situation.endGameClock,
            description: `${targetSide ?? '己方'} 共出动 ${platforms.length} 个平台，总投弹 ${totalRounds} 枚`,
          },
        ],
      };
    },
  },
];
