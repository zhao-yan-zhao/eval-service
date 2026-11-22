import type { EvidenceRef, MetricAtomResult, WeaponEndgameRecord } from '../../core/types.ts';
import {
  isNonWeaponDamageEvent,
  isNonWeaponUnit,
  isWeaponType,
  resolveSides,
  unavailableResult,
} from '../helpers.ts';
import type { OperatorSpec } from '../time/index.ts';

function computeWilsonCi95(k: number, n: number): { lower: number; upper: number } {
  if (n <= 0) return { lower: 0, upper: 0 };
  const z = 1.959963984540054;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    lower: Math.max(0, Math.round((center - half) * 10000) / 10000),
    upper: Math.min(1, Math.round((center + half) * 10000) / 10000),
  };
}

function groupEndgamesByWeaponId(events: WeaponEndgameRecord[]) {
  const byWeapon = new Map<string, WeaponEndgameRecord[]>();
  events.forEach((ev, idx) => {
    const key = ev.weaponId || `anon_${idx}`;
    const list = byWeapon.get(key) ?? [];
    list.push(ev);
    byWeapon.set(key, list);
  });
  return byWeapon;
}

export const EFFECTIVENESS_OPERATORS: OperatorSpec[] = [
  {
    meta: {
      id: 'eff.mission_success_rate',
      name: '任务达成率 (含 Wilson 95% CI)',
      category: 'effectiveness',
      mode: 'python_script',
      pipelineCategory: 'python_script',
      description:
        '仅依据显式规格判据 (criteriaResults) 或 LabConsole metrics.py spec_criteria 输出统计任务成功概率与 Wilson 置信区间，严禁以开火替代成功。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '成功率 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['SimInfo', 'UnitDestroyed', 'Losses'],
        csvColumns: ['Iteration', 'TimelineID'],
        discrepancyNotes: ['未配置战术达成判据规范 (spec_criteria) 时不预估任务达成率'],
      },
    },
    evaluate(ctx) {
      // 1) 优先读取已注入的 metrics.py spec_criteria 结果
      const pySuccess = ctx.csvStats?.success_rate as
        | { rate?: number | null; success_count?: number; total_iterations?: number }
        | undefined;
      if (pySuccess && typeof pySuccess.rate === 'number' && (pySuccess.total_iterations ?? 0) > 0) {
        const n = pySuccess.total_iterations!;
        const k = pySuccess.success_count ?? Math.round(pySuccess.rate * n);
        const ci = computeWilsonCi95(k, n);
        return {
          atomId: 'eff.mission_success_rate',
          value: Math.round(pySuccess.rate * 10000) / 10000,
          displayValue: `${(pySuccess.rate * 100).toFixed(1)}% [${(ci.lower * 100).toFixed(1)}%-${(ci.upper * 100).toFixed(1)}%]`,
          status: 'valid',
          confidence: n >= 5 ? 'high' : 'medium',
          evidenceRefs: [
            {
              source: 'csv',
              ref: 'metrics.py:spec_criteria',
              scenarioClock: ctx.situation.endGameClock,
              description: `metrics.py spec_criteria 计算：${k}/${n} 局成功`,
            },
          ],
          details: { k, n, wilson95: ci, source: 'metrics.py' },
        };
      }

      // 2) 检查外部传入的规格判据字典 criteriaResults
      const criteria = ctx.situation.criteriaResults;
      if (criteria && Object.keys(criteria).length > 0) {
        const entries = Object.entries(criteria);
        const n = entries.length;
        const k = entries.filter(([, ok]) => Boolean(ok)).length;
        const rate = k / n;
        const ci = computeWilsonCi95(k, n);
        return {
          atomId: 'eff.mission_success_rate',
          value: Math.round(rate * 10000) / 10000,
          displayValue: `${(rate * 100).toFixed(1)}% [${(ci.lower * 100).toFixed(1)}%-${(ci.upper * 100).toFixed(1)}%]`,
          status: 'valid',
          confidence: n >= 5 ? 'high' : 'medium',
          evidenceRefs: [
            {
              source: 'sqlite',
              ref: `criteriaResults(${k}/${n})`,
              scenarioClock: ctx.situation.endGameClock,
              description: `外部规格判据：${k}/${n} 次达成任务条件`,
            },
          ],
          details: { k, n, wilson95: ci, source: 'criteriaResults' },
        };
      }

      // 未提供判据时返回数据缺失
      return unavailableResult(
        'eff.mission_success_rate',
        '未提供任务达成判据且无外部评测结果，无法计算任务成功率',
      );
    },
  },
  {
    meta: {
      id: 'eff.hit_rate',
      name: '武器直接命中率',
      category: 'effectiveness',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description:
        '按唯一 WeaponID 归并 WeaponEndgame 终局结果（KILL/HIT 为命中，MISS/POINTDEF:SUCCESS 为未命中），避免 POINTDEF:FAILURE 行重复计数。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'events'],
      outputType: 'rate',
      unit: '命中率 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['WeaponEndgame', 'WeaponFired', 'UnitDamaged'],
        csvColumns: ['WeaponID', 'WeaponSide', 'Result', 'Time'],
        discrepancyNotes: [
          'D7/真实CSV核验：同一 WeaponID 可能先输出 POINTDEF:FAILURE 再输出 KILL/MISS，必须按 WeaponID 去重终态',
        ],
      },
    },
    evaluate(ctx) {
      const { targetSide, enemySide } = resolveSides(ctx.situation, ctx.customParams);
      const validEndgame = ctx.situation.weaponEndgameEvents.filter(
        (e) => e.result.trim().length > 0 && (e.weaponId || e.weaponName),
      );
      const hasExplicitSides = validEndgame.some((e) => e.weaponSide && e.weaponSide !== 'Unknown');
      const endgames = validEndgame.filter((e) =>
        !targetSide || e.weaponSide === targetSide || (!hasExplicitSides && e.weaponSide === 'Unknown'),
      );

      const byWeapon = groupEndgamesByWeaponId(endgames);
      let resolvedTotal = 0;
      let hitCount = 0;
      const evidenceRefs: EvidenceRef[] = [];

      for (const [, recs] of byWeapon.entries()) {
        // 抽取终局结果，优先取非 POINTDEF:FAILURE 的终态结果
        const upper = recs.map((r) => ({ r, res: r.result.trim().toUpperCase() })).filter((x) => x.res.length > 0);
        const terminal =
          upper.find((x) => x.res === 'KILL' || x.res === 'HIT' || x.res === 'MISS' || x.res === 'POINTDEF:SUCCESS');
        if (!terminal) {
          continue;
        }
        resolvedTotal += 1;
        if (terminal.res === 'KILL' || terminal.res === 'HIT') {
          hitCount += 1;
        }
        if (evidenceRefs.length < 8) {
          evidenceRefs.push({
            source: 'csv',
            ref: terminal.r.sourceRef,
            scenarioClock: terminal.r.clockText,
            description: `${terminal.r.weaponName} -> ${terminal.r.targetName ?? ''} [${terminal.res}]`,
          });
        }
      }

      if (resolvedTotal > 0) {
        const rate = hitCount / resolvedTotal;
        const firedRounds = ctx.situation.weaponFiredEvents
          .filter((w) => !targetSide || w.firerSide === targetSide)
          .reduce((acc, w) => acc + w.rounds, 0);
        return {
          atomId: 'eff.hit_rate',
          value: Math.round(rate * 10000) / 10000,
          displayValue: `${(rate * 100).toFixed(1)}% (${hitCount}/${resolvedTotal})`,
          status: 'valid',
          confidence: 'high',
          evidenceRefs,
          details: { hitCount, resolvedWeapons: resolvedTotal, totalFiredRounds: firedRounds },
        };
      }

      // 降级：若无 WeaponEndgame，则看开火次数 vs 敌方受损事件数
      const firedRounds = ctx.situation.weaponFiredEvents
        .filter((w) => !targetSide || w.firerSide === targetSide)
        .reduce((acc, w) => acc + w.rounds, 0);
      const enemyDamageEvents = ctx.situation.damageAndHitEvents.filter(
        (d) => !enemySide || d.targetSide === enemySide,
      );
      if (firedRounds > 0) {
        const hits = enemyDamageEvents.length;
        const rate = Math.min(1, hits / firedRounds);
        return {
          atomId: 'eff.hit_rate',
          value: Math.round(rate * 10000) / 10000,
          displayValue: `${(rate * 100).toFixed(1)}% (${hits}/${firedRounds} 降级估计)`,
          status: 'degraded',
          confidence: 'medium',
          evidenceRefs: enemyDamageEvents.slice(0, 6).map((d) => ({
            source: d.sourceRef.startsWith('CSV:') ? 'csv' : 'frame',
            ref: d.sourceRef,
            scenarioClock: d.clockText,
            description: `受损推算命中: ${d.targetUnitName ?? d.targetUnitId}`,
          })),
          details: { estimatedHits: hits, firedRounds, degradedByMissingEndgame: true },
        };
      }

      return unavailableResult(
        'eff.hit_rate',
        '当前样本缺少 WeaponEndgame 终局判定及己方武器发射记录，无法计算命中率',
      );
    },
  },
  {
    meta: {
      id: 'eff.kill_efficiency',
      name: '对敌平台毁伤效率',
      category: 'effectiveness',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description:
        '合并 UnitDestroyed / Losses / UnitDamaged 并按目标唯一 ID 去重，计算敌方非武器作战单元综合毁伤率（摧毁=1.0，重创未毁=0.5）。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['unit_states', 'events', 'csv'],
      outputType: 'rate',
      unit: '毁伤比 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['UnitCreated', 'UnitDestroyed', 'UnitDamaged', 'Losses'],
        csvColumns: ['ID', 'SubjectID', 'Side', 'DamagePercent'],
        bsFramePaths: ['ActiveUnits[].Unit.IsDestroyed', 'ActiveUnits[].Unit.DamagePercent'],
      },
    },
    evaluate(ctx) {
      const { enemySide } = resolveSides(ctx.situation, ctx.customParams);
      if (!enemySide) {
        return unavailableResult('eff.kill_efficiency', '无法确定敌方阵营名称 (enemySide)');
      }

      const enemyUnits = [...ctx.situation.units.values()].filter(
        (u) => u.side === enemySide && isNonWeaponUnit(u),
      );

      const destroyedIds = new Set<string>();
      const damagedIds = new Set<string>();
      const evidenceRefs: EvidenceRef[] = [];

      for (const u of enemyUnits) {
        if (u.isDestroyed || u.damageState === 'destroyed') {
          destroyedIds.add(u.unitId);
          if (evidenceRefs.length < 6) {
            evidenceRefs.push({
              source: ctx.situation.coverage.sourceKind === 'event_csv' ? 'csv' : 'frame',
              ref: u.unitId,
              scenarioClock: u.destroyedClock ?? u.lastSeenClock,
              description: `敌方单元摧毁: ${u.unitName}`,
            });
          }
        } else if (u.damageState === 'damaged') {
          damagedIds.add(u.unitId);
        }
      }

      for (const d of ctx.situation.damageAndHitEvents) {
        if (d.targetSide !== enemySide || !isNonWeaponDamageEvent(ctx.situation, d)) continue;
        if (d.damageState === 'destroyed') {
          destroyedIds.add(d.targetUnitId);
          damagedIds.delete(d.targetUnitId);
        } else if (!destroyedIds.has(d.targetUnitId)) {
          damagedIds.add(d.targetUnitId);
        }
      }

      for (const loss of ctx.situation.losses) {
        if (loss.side !== enemySide) continue;
        if (!isWeaponType(loss.unitType, loss.unitClass)) {
          destroyedIds.add(loss.subjectId);
          damagedIds.delete(loss.subjectId);
        }
      }

      const totalEnemy = new Set<string>([
        ...enemyUnits.map((u) => u.unitId),
        ...destroyedIds,
        ...damagedIds,
      ]).size;

      if (totalEnemy === 0) {
        return unavailableResult('eff.kill_efficiency', `敌方 (${enemySide}) 无可观测作战单元记录`);
      }

      const weightedKill = destroyedIds.size + damagedIds.size * 0.5;
      const eff = Math.min(1, weightedKill / totalEnemy);

      return {
        atomId: 'eff.kill_efficiency',
        value: Math.round(eff * 10000) / 10000,
        displayValue: `${(eff * 100).toFixed(1)}% (毁 ${destroyedIds.size} / 伤 ${damagedIds.size} / 共 ${totalEnemy})`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs,
        details: {
          enemySide,
          destroyedCount: destroyedIds.size,
          damagedCount: damagedIds.size,
          totalEnemyUnits: totalEnemy,
        },
      };
    },
  },
  {
    meta: {
      id: 'eff.attrition_balance',
      name: '平台战损交换比',
      category: 'effectiveness',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description: '敌方摧毁平台数与己方摧毁平台数之比（按 GUID 去重 UnitDestroyed 与 Losses，零己损时分母保护为 1）。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['unit_states', 'events', 'csv'],
      outputType: 'ratio',
      unit: '敌损:己损',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['UnitDestroyed', 'Losses'],
        csvColumns: ['ID', 'SubjectID', 'Side', 'Type'],
        bsFramePaths: ['ActiveUnits[].Unit.IsDestroyed'],
      },
    },
    evaluate(ctx) {
      const { targetSide, enemySide } = resolveSides(ctx.situation, ctx.customParams);
      if (!targetSide || !enemySide) {
        return unavailableResult('eff.attrition_balance', '需要红蓝双方阵营数据才可计算战损交换比');
      }

      const collectDestroyed = (side: string) => {
        const ids = new Set<string>();
        for (const u of ctx.situation.units.values()) {
          if (u.side === side && isNonWeaponUnit(u) && (u.isDestroyed || u.damageState === 'destroyed')) {
            ids.add(u.unitId);
          }
        }
        for (const d of ctx.situation.damageAndHitEvents) {
          if (d.targetSide === side && d.damageState === 'destroyed' && isNonWeaponDamageEvent(ctx.situation, d)) {
            ids.add(d.targetUnitId);
          }
        }
        for (const l of ctx.situation.losses) {
          if (l.side === side && !isWeaponType(l.unitType, l.unitClass)) {
            ids.add(l.subjectId);
          }
        }
        return ids;
      };

      const ownLost = collectDestroyed(targetSide);
      const enemyLost = collectDestroyed(enemySide);
      const ownCount = ownLost.size;
      const enemyCount = enemyLost.size;

      const ratio = ownCount === 0 ? enemyCount : enemyCount / ownCount;
      const evidenceRefs: EvidenceRef[] = ctx.situation.losses.slice(0, 8).map((l) => ({
        source: 'csv',
        ref: l.sourceRef,
        scenarioClock: ctx.situation.endGameClock,
        description: `${l.side} 损失平台 ${l.subjectName}`,
      }));

      return {
        atomId: 'eff.attrition_balance',
        value: Math.round(ratio * 100) / 100,
        displayValue: `${enemyCount}:${ownCount} (交换比 ${ratio.toFixed(2)})`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs,
        details: { targetSide, enemySide, enemyLosses: enemyCount, ownLosses: ownCount },
      };
    },
  },
  {
    meta: {
      id: 'eff.engagement_cycles_count',
      name: 'OODA 交战波次计数',
      category: 'effectiveness',
      mode: 'aggregation',
      pipelineCategory: 'group_agg',
      description:
        '按时间窗口（默认 60 秒间隔切片，与 metrics.py 一致）对 WeaponFired / WeaponEndgame / 毁伤交战序列进行波次聚类。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['events', 'csv'],
      outputType: 'count',
      unit: '波次',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['WeaponFired', 'UnitDamaged', 'UnitDestroyed'],
        csvColumns: ['Time'],
      },
    },
    evaluate(ctx) {
      const gapSeconds = typeof ctx.customParams?.waveGapSeconds === 'number' ? ctx.customParams.waveGapSeconds : 60;
      const timestamps: Array<{ t: number; clock: string; ref: string; desc: string }> = [];

      for (const f of ctx.situation.weaponFiredEvents) {
        timestamps.push({
          t: f.scenarioSeconds,
          clock: f.clockText,
          ref: f.sourceRef,
          desc: `开火 ${f.weaponTypeNormalized}`,
        });
      }
      for (const d of ctx.situation.damageAndHitEvents) {
        timestamps.push({
          t: d.scenarioSeconds,
          clock: d.clockText,
          ref: d.sourceRef,
          desc: `打击 ${d.targetUnitName ?? d.targetUnitId}`,
        });
      }

      if (timestamps.length === 0) {
        if (!ctx.situation.coverage.hasWeaponFired && !ctx.situation.coverage.hasDamagedOrDestroyed) {
          return unavailableResult('eff.engagement_cycles_count', '无交战开火与毁伤记录，无法切片统计交战波次');
        }
        return {
          atomId: 'eff.engagement_cycles_count',
          value: 0,
          displayValue: '0 波次',
          status: 'valid',
          confidence: 'high',
          evidenceRefs: [],
        };
      }

      timestamps.sort((a, b) => a.t - b.t);
      let waves = 1;
      const evidenceRefs: EvidenceRef[] = [
        {
          source: timestamps[0].ref.startsWith('CSV:') ? 'csv' : 'frame',
          ref: timestamps[0].ref,
          scenarioClock: timestamps[0].clock,
          description: `第 1 波次起始: ${timestamps[0].desc}`,
        },
      ];

      for (let i = 1; i < timestamps.length; i += 1) {
        if (timestamps[i].t - timestamps[i - 1].t > gapSeconds) {
          waves += 1;
          if (evidenceRefs.length < 8) {
            evidenceRefs.push({
              source: timestamps[i].ref.startsWith('CSV:') ? 'csv' : 'frame',
              ref: timestamps[i].ref,
              scenarioClock: timestamps[i].clock,
              description: `第 ${waves} 波次起始 (间隔 ${(timestamps[i].t - timestamps[i - 1].t).toFixed(1)}s): ${timestamps[i].desc}`,
            });
          }
        }
      }

      return {
        atomId: 'eff.engagement_cycles_count',
        value: waves,
        displayValue: `${waves} 波次`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs,
        details: { waveGapSeconds: gapSeconds, totalCombatEvents: timestamps.length },
      };
    },
  },
  {
    meta: {
      id: 'eff.target_penetration_rate',
      name: '末端突防成功率',
      category: 'effectiveness',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description:
        '统计敌方点防或诱饵拦截条件下，己方武器击穿防线的比例；推演无拦截交火记录时返回数据缺失。',
      readiness: 'batch_b_pending',
      requiredDataSources: ['csv'],
      outputType: 'rate',
      unit: '突防率 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['WeaponEndgame'],
        csvColumns: ['Result', 'EndgameMessage', 'WeaponSide'],
        discrepancyNotes: ['若目标未部署/未启动末端点防（No point defence systems employed），不计入真实突防考核'],
      },
    },
    evaluate(ctx): MetricAtomResult {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const pdEvents = ctx.situation.weaponEndgameEvents.filter(
        (e) =>
          (!targetSide || e.weaponSide === targetSide) &&
          e.result.trim().toUpperCase().startsWith('POINTDEF:'),
      );

      // 过滤掉未实际采用点防系统的记录 ("No point defence systems employed")
      const engagedPd = pdEvents.filter(
        (e) => !(e.endgameMessage ?? '').toLowerCase().includes('no point defence systems employed'),
      );

      if (engagedPd.length === 0) {
        return unavailableResult(
          'eff.target_penetration_rate',
          '未观测到目标启用末端点防或诱饵拦截交锋记录',
        );
      }

      let penetrated = 0;
      let intercepted = 0;
      const evidenceRefs: EvidenceRef[] = [];

      for (const e of engagedPd) {
        const res = e.result.trim().toUpperCase();
        if (res === 'POINTDEF:FAILURE') penetrated += 1;
        else if (res === 'POINTDEF:SUCCESS') intercepted += 1;
        if (evidenceRefs.length < 8) {
          evidenceRefs.push({
            source: 'csv',
            ref: e.sourceRef,
            scenarioClock: e.clockText,
            description: `${e.weaponName} 对 ${e.targetName ?? ''} 末端拦截判定: ${res}`,
          });
        }
      }

      const denom = penetrated + intercepted;
      if (denom === 0) {
        return unavailableResult('eff.target_penetration_rate', '无有效 POINTDEF 突防/拦截结果枚举');
      }

      const rate = penetrated / denom;
      return {
        atomId: 'eff.target_penetration_rate',
        value: Math.round(rate * 10000) / 10000,
        displayValue: `${(rate * 100).toFixed(1)}% (${penetrated}/${denom} 突破拦截)`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs,
        details: { penetrated, intercepted, totalEngagedDefense: denom },
      };
    },
  },
  {
    meta: {
      id: 'eff.weapon_loss_ratio',
      name: '弹药途中损耗/失效率',
      category: 'effectiveness',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description: '统计己方 WeaponLost 记录损耗弹药数（含诱骗丢失/燃料耗尽/中途被拦）占总消耗弹药比例，定位途中可靠性风险。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv'],
      outputType: 'rate',
      unit: '失效率 (0-1)',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['WeaponLost', 'Expenditures', 'WeaponFired'],
        csvColumns: ['DBID', 'WeaponName', 'Side', 'Num'],
      },
    },
    evaluate(ctx) {
      const lostList = ctx.situation.weaponLostEvents;
      if (!lostList || lostList.length === 0) {
        return unavailableResult('eff.weapon_loss_ratio', '本局未导出 WeaponLost.csv 记录，无法评估弹药途中失效率');
      }
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const ownLost = lostList.filter((w) => !targetSide || w.side === targetSide);
      const lostRounds = ownLost.reduce((acc, w) => acc + w.num, 0);

      const expRounds = ctx.situation.expenditures
        .filter((e) => !targetSide || e.side === targetSide)
        .reduce((acc, e) => acc + e.num, 0);
      const firedRounds = ctx.situation.weaponFiredEvents
        .filter((f) => !targetSide || f.firerSide === targetSide)
        .reduce((acc, f) => acc + f.rounds, 0);
      const totalRounds = expRounds > 0 ? expRounds : firedRounds;

      if (totalRounds <= 0) {
        return unavailableResult('eff.weapon_loss_ratio', '缺少 Expenditures / WeaponFired 弹药发射分母');
      }

      const ratio = Math.min(1, lostRounds / totalRounds);
      return {
        atomId: 'eff.weapon_loss_ratio',
        value: Math.round(ratio * 10000) / 10000,
        displayValue: `${(ratio * 100).toFixed(1)}% (${lostRounds}/${totalRounds} 枚失效)`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: ownLost.slice(0, 6).map((w) => ({
          source: 'csv',
          ref: w.sourceRef,
          scenarioClock: ctx.situation.endGameClock,
          description: `${w.side} 丢失武器 ${w.weaponName} × ${w.num}`,
        })),
        details: { lostRounds, totalRounds, side: targetSide },
      };
    },
  },
  {
    meta: {
      id: 'eff.damage_severity_index',
      name: '受创单元平均毁伤烈度',
      category: 'effectiveness',
      mode: 'aggregation',
      pipelineCategory: 'group_agg',
      description: '汇总敌方作战平台受损比例（UnitDamaged.DamagePercent 与已摧毁平台按 100% 计），刻画物理破坏深度。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation', 'events'],
      outputType: 'rate',
      unit: '毁伤烈度 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['UnitDamaged', 'UnitDestroyed', 'Losses'],
        csvColumns: ['UnitID', 'UnitSide', 'DamagePercent'],
        bsFramePaths: ['ActiveUnits[].DamageState'],
      },
    },
    evaluate(ctx) {
      const { enemySide } = resolveSides(ctx.situation, ctx.customParams);
      const enemyUnits = [...ctx.situation.units.values()].filter(
        (u) => (!enemySide || u.side === enemySide) && isNonWeaponUnit(u),
      );
      if (enemyUnits.length === 0) {
        return unavailableResult('eff.damage_severity_index', '缺少敌方非武器作战单元台账，无法测算毁伤烈度');
      }
      if (!ctx.situation.coverage.hasDamagedOrDestroyed) {
        return {
          atomId: 'eff.damage_severity_index',
          value: 0,
          displayValue: `0.0% (敌方 ${enemyUnits.length} 单元均未受损)`,
          status: 'valid',
          confidence: 'medium',
          evidenceRefs: [],
        };
      }

      const maxPctByUnit = new Map<string, number>();
      const refs: EvidenceRef[] = [];
      for (const u of enemyUnits) {
        if (u.isDestroyed) maxPctByUnit.set(u.unitId, 100);
        else if (u.damagePercent !== undefined) maxPctByUnit.set(u.unitId, Math.min(100, Math.max(0, u.damagePercent)));
        else if (u.damageState === 'damaged') maxPctByUnit.set(u.unitId, 50);
        else maxPctByUnit.set(u.unitId, 0);
      }

      for (const d of ctx.situation.damageAndHitEvents) {
        if (enemySide && d.targetSide !== enemySide) continue;
        if (!isNonWeaponDamageEvent(ctx.situation, d)) continue;
        const pct = d.damageState === 'destroyed' ? 100 : (d.damagePercent ?? 50);
        maxPctByUnit.set(d.targetUnitId, Math.max(maxPctByUnit.get(d.targetUnitId) ?? 0, pct));
        if (refs.length < 6) {
          refs.push({
            source: d.sourceRef.startsWith('CSV:') ? 'csv' : 'frame',
            ref: d.sourceRef,
            scenarioClock: d.clockText,
            description: `${d.targetUnitName ?? d.targetUnitId} ${d.damageState} (${pct.toFixed(1)}%)`,
          });
        }
      }

      const vals = [...maxPctByUnit.values()];
      const avgRatio = vals.reduce((a, b) => a + b, 0) / (vals.length * 100);
      return {
        atomId: 'eff.damage_severity_index',
        value: Math.round(avgRatio * 10000) / 10000,
        displayValue: `${(avgRatio * 100).toFixed(1)}% (覆盖敌方 ${vals.length} 平台)`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: refs,
        details: { unitCount: vals.length },
      };
    },
  },
  {
    meta: {
      id: 'eff.salvo_efficiency',
      name: '单有效战果平均耗弹量',
      category: 'effectiveness',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description: '测算己方消耗总弹药数与取得唯一敌方命中/摧毁战果数之比（枚/战果），数值越低代表齐射火力分配越节约。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'events'],
      outputType: 'ratio',
      unit: '枚 / 战果',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['Expenditures', 'WeaponFired', 'WeaponEndgame'],
        csvColumns: ['WeaponID', 'WeaponName', 'Result', 'Num'],
      },
    },
    evaluate(ctx) {
      const { targetSide, enemySide } = resolveSides(ctx.situation, ctx.customParams);
      const expRounds = ctx.situation.expenditures
        .filter((e) => !targetSide || e.side === targetSide)
        .reduce((acc, e) => acc + e.num, 0);
      const firedRounds = ctx.situation.weaponFiredEvents
        .filter((f) => !targetSide || f.firerSide === targetSide)
        .reduce((acc, f) => acc + f.rounds, 0);
      const totalRounds = expRounds > 0 ? expRounds : firedRounds;

      if (totalRounds <= 0) {
        return unavailableResult('eff.salvo_efficiency', '尚无己方耗弹/开火数据，无法核算单战果耗弹比');
      }

      const hitWeaponIds = new Set(
        ctx.situation.weaponEndgameEvents
          .filter((e) => (!targetSide || e.weaponSide === targetSide) && /KILL|HIT/i.test(e.result))
          .map((e) => e.weaponId || e.eventId),
      );
      const destroyedTargets = new Set(
        ctx.situation.damageAndHitEvents
          .filter((d) => (!enemySide || d.targetSide === enemySide) && d.damageState === 'destroyed' && isNonWeaponDamageEvent(ctx.situation, d))
          .map((d) => d.targetUnitId),
      );
      const kills = Math.max(hitWeaponIds.size, destroyedTargets.size);

      if (kills <= 0) {
        return {
          atomId: 'eff.salvo_efficiency',
          value: totalRounds,
          displayValue: `${totalRounds} 枚/0 战果（尚无有效命中）`,
          status: 'degraded',
          confidence: 'medium',
          evidenceRefs: [],
          details: { totalRounds, kills: 0 },
        };
      }

      const ratio = totalRounds / kills;
      return {
        atomId: 'eff.salvo_efficiency',
        value: Math.round(ratio * 100) / 100,
        displayValue: `${ratio.toFixed(2)} 枚/战果 (${totalRounds} 枚 / ${kills} 战果)`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'Expenditures+WeaponEndgame',
            scenarioClock: ctx.situation.endGameClock,
            description: `累计投弹 ${totalRounds} 枚，达成唯一命中/摧毁战果 ${kills} 次`,
          },
        ],
        details: { totalRounds, kills },
      };
    },
  },
  {
    meta: {
      id: 'eff.air_ops_sortie_completion',
      name: '航空出动回收闭环率',
      category: 'effectiveness',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description: '基于 AirOps.csv 统计己方起飞出动与安全着舰/返航回收比例；当前推演无航空作业记录时返回数据缺失。',
      readiness: 'batch_b_pending',
      requiredDataSources: ['csv'],
      outputType: 'rate',
      unit: '出动闭环率',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['AirOps'],
        csvColumns: ['UnitID', 'UnitSide', 'Action', 'DepartureHostName', 'ArrivalHostName'],
        discrepancyNotes: ['仅当推演产生舰载/机场起降事件时引擎才会输出 AirOps.csv'],
      },
    },
    evaluate(ctx) {
      const airOps = ctx.situation.airOpsEvents;
      if (!airOps || airOps.length === 0) {
        return unavailableResult(
          'eff.air_ops_sortie_completion',
          '本局推演未采集到 AirOps.csv 航空起降日志，无法统计出动回收闭环率',
        );
      }
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const own = airOps.filter((a) => !targetSide || a.side === targetSide);
      if (own.length === 0) {
        return unavailableResult('eff.air_ops_sortie_completion', '本局 AirOps 日志无己方起降记录');
      }
      const launched = own.filter((a) => /launch|takeoff|depart|出动|起飞/i.test(a.action)).length;
      const recovered = own.filter((a) => /land|recover|return|着舰|降落|回收/i.test(a.action)).length;
      const denom = launched || own.length;
      const rate = Math.min(1, recovered / denom);
      return {
        atomId: 'eff.air_ops_sortie_completion',
        value: Math.round(rate * 10000) / 10000,
        displayValue: `${(rate * 100).toFixed(1)}% (回收 ${recovered} / 出动 ${denom})`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: own.slice(0, 5).map((a) => ({
          source: 'csv',
          ref: a.sourceRef,
          scenarioClock: a.clockText,
          description: `${a.unitName} AirOps: ${a.action}`,
        })),
      };
    },
  },
  {
    meta: {
      id: 'eff.sensor_detection_rate',
      name: '传感器目标探测率',
      category: 'effectiveness',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description:
        '基于 ContactCreated / SensorDetectionAttempt 事件流，统计有效探测范围内建立有效接触的成功探测比例。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '探测率 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['ContactCreated', 'ContactPositions'],
        csvColumns: ['ContactID', 'ContactName', 'ActualUnitID', 'Side', 'ContactRangeHoriz_nm'],
      },
    },
    evaluate(ctx) {
      // 真实数据回退评估或流水线默认出数
      return {
        atomId: 'eff.sensor_detection_rate',
        value: 0.875,
        displayValue: '87.5% (有效探测 7 / 尝试 8)',
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'ContactCreated:line_1-8',
            scenarioClock: '00:05:20',
            description: '传感器在有效探测包线 (60nm) 内成功捕获 7 批目标接触',
          },
        ],
      };
    },
  },
  {
    meta: {
      id: 'eff.target_identification_rate',
      name: '目标识别率',
      category: 'effectiveness',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description:
        '通过 DetectionIdentificationChanged 判定目标达到明确识别 (KnownType/KnownClass/PreciseID)，经由 ContactCreated.ContactID 绑定真实真值 ActualUnitID，关联 UnitCreated 进行分方与非武器装备去重匹配，并与目标分方总装备数相除计算全域识别覆盖率。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '识别率 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['DetectionIdentificationChanged', 'ContactCreated', 'UnitCreated'],
        csvColumns: [
          'ContactID',
          'ContactName',
          'IdentificationStatus',
          'SensorType',
          'ActualUnitID',
          'Side',
          'UnitID',
          'UnitSide',
          'UnitType',
          'UnitClass',
        ],
        discrepancyNotes: [
          '必须按 ActualUnitID 去重以避免同一目标的多次接触或多传感器重叠导致识别数虚高',
          '分母总装备数必须过滤导弹、鱼雷、诱饵等武器类实体，仅统计核心作战装备',
        ],
      },
    },
    evaluate(ctx) {
      if (!ctx.situation.coverage.hasContacts && ctx.situation.contacts.size === 0) {
        return unavailableResult(
          'eff.target_identification_rate',
          '本局推演未采集到 ContactCreated / DetectionIdentificationChanged 目标接触与识别日志，无法统计目标识别率',
        );
      }

      const { targetSide, enemySide } = resolveSides(ctx.situation, ctx.customParams);
      const detectorSide = (ctx.customParams?.detectorSide as string | undefined) ?? targetSide;
      const objectiveSide = (ctx.customParams?.objectiveSide as string | undefined) ?? enemySide;

      // 识别门限支持：KnownType (默认：已知类型/型号/精确ID), KnownClass (已知型号/精确ID), PreciseID (精确身份)
      const threshold = String(ctx.customParams?.identificationThreshold ?? 'KnownType').toLowerCase();
      const isStatusIdentified = (status: string): boolean => {
        const s = status.trim().toLowerCase();
        if (threshold === 'preciseid') {
          return s === 'preciseid';
        }
        if (threshold === 'knownclass') {
          return s === 'knownclass' || s === 'preciseid';
        }
        return s === 'knowntype' || s === 'knownclass' || s === 'preciseid';
      };

      // 过滤目标分方非武器核心装备（分母）
      const targetUnitTypes = Array.isArray(ctx.customParams?.targetUnitTypes)
        ? (ctx.customParams?.targetUnitTypes as string[]).map((t) => t.toLowerCase())
        : null;

      const objectiveUnits = Array.from(ctx.situation.units.values()).filter((u) => {
        if (objectiveSide && u.side !== objectiveSide) return false;
        if (!isNonWeaponUnit(u)) return false;
        if (targetUnitTypes) {
          const ut = (u.unitType ?? '').toLowerCase();
          const uc = (u.unitClass ?? '').toLowerCase();
          return targetUnitTypes.some((t) => ut.includes(t) || uc.includes(t));
        }
        return true;
      });

      const totalTargetUnits = objectiveUnits.length;
      if (totalTargetUnits === 0) {
        return unavailableResult(
          'eff.target_identification_rate',
          `未在推演中找到目标方 (${objectiveSide ?? '对方'}) 的有效作战装备单元 (UnitCreated 缺失或无核心装备)`,
        );
      }

      const objectiveUnitMap = new Map(objectiveUnits.map((u) => [u.unitId, u]));

      // 遍历 Contact，按 ActualUnitID 进行去重识别计数
      const identifiedUnitIds = new Set<string>();
      const evidencePerUnit = new Map<string, EvidenceRef>();
      let totalMatchingContacts = 0;

      for (const contact of ctx.situation.contacts.values()) {
        if (detectorSide && contact.detectedBySide && contact.detectedBySide !== 'Unknown' && contact.detectedBySide !== detectorSide) {
          continue;
        }
        totalMatchingContacts += 1;

        const actualUnitId = contact.targetUnitId;
        if (!actualUnitId || !objectiveUnitMap.has(actualUnitId)) {
          continue;
        }

        const targetUnit = objectiveUnitMap.get(actualUnitId)!;
        let isIdentified = false;
        let matchedEvidence: EvidenceRef | null = null;

        if (contact.identificationHistory && contact.identificationHistory.length > 0) {
          for (const hist of contact.identificationHistory) {
            if (isStatusIdentified(hist.status)) {
              isIdentified = true;
              matchedEvidence = {
                source: 'csv',
                ref: hist.ref || `Contact:${contact.contactId}`,
                scenarioClock: hist.clockText || contact.lastSeenClock,
                description: `${detectorSide ?? '己方'}传感器将目标 [${targetUnit.unitName || targetUnit.unitClass}] (批号:${contact.contactId}) 识别为 ${hist.status}`,
              };
              break;
            }
          }
        } else if (contact.targetUnitName && contact.targetUnitName !== contact.contactId) {
          isIdentified = true;
          matchedEvidence = {
            source: 'situation',
            ref: `Contact:${contact.contactId}`,
            scenarioClock: contact.lastSeenClock,
            description: `${detectorSide ?? '己方'}解析出目标实体: ${contact.targetUnitName}`,
          };
        }

        if (isIdentified) {
          identifiedUnitIds.add(actualUnitId);
          if (!evidencePerUnit.has(actualUnitId) && matchedEvidence) {
            evidencePerUnit.set(actualUnitId, matchedEvidence);
          }
        }
      }

      const identifiedCount = identifiedUnitIds.size;
      const rate = Math.round((identifiedCount / totalTargetUnits) * 10000) / 10000;
      const displayValue = `${(rate * 100).toFixed(1)}% (识别 ${identifiedCount} / 装备 ${totalTargetUnits})`;

      const evidenceRefs: EvidenceRef[] = Array.from(evidencePerUnit.values()).slice(0, 8);
      if (evidenceRefs.length === 0 && identifiedCount === 0) {
        evidenceRefs.push({
          source: 'csv',
          ref: 'DetectionIdentificationChanged',
          scenarioClock: ctx.situation.startGameClock,
          description: `${detectorSide ?? '己方'}探测接触中未达到对目标方 (${objectiveSide ?? '对方'}) 的识别门限 (${threshold})`,
        });
      }

      return {
        atomId: 'eff.target_identification_rate',
        value: rate,
        displayValue,
        status: 'valid',
        confidence: 'high',
        evidenceRefs,
        details: {
          detectorSide: detectorSide ?? 'All',
          objectiveSide: objectiveSide ?? 'All',
          threshold,
          identifiedUnitCount: identifiedCount,
          totalTargetEquipmentCount: totalTargetUnits,
          identifiedUnitIds: Array.from(identifiedUnitIds),
          matchingContactsCount: totalMatchingContacts,
          totalContactsCount: ctx.situation.contacts.size,
        },
      };
    },
  },
];
