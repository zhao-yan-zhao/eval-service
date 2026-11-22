/**
 * Operators v3 — 域 3：火力打击与武器效能 (WPN, 8 个原子算子)
 * 对齐标准：JMEM Weapon Effectiveness (Ph / Pk|h / Pssk 严格分离，分母涵盖 WeaponLost)
 * 包含 6 个经典打击算子 + 2 个原生扩展算子 (wpn.terminal_miss_distance, wpn.impact_cep)
 */

import type { EvidenceRef } from '../../core/types.ts';
import {
  computeQuantile,
  computeTotalWeaponsFired,
  groupEndgamesByWeaponId,
  isNonWeaponUnit,
  isSameSide,
  isWeaponType,
  nmBetween,
  resolveSides,
  unavailableResult,
  type OperatorSpec,
} from '../helpers.ts';

function classifyWeaponOutcome(
  records: Array<{ result: string; targetId?: string; clockText: string; sourceRef?: string }>,
  destroyedEnemyIds: Set<string>,
): { isHit: boolean; isKill: boolean; bestRef: string; bestClock: string } {
  let isHit = false;
  let isKill = false;
  let bestRef = records[0]?.sourceRef ?? 'situation';
  let bestClock = records[0]?.clockText ?? '00:00:00';

  for (const r of records) {
    const res = r.result.toUpperCase();
    if (res === 'KILL') {
      isKill = true;
      isHit = true;
      if (r.sourceRef) bestRef = r.sourceRef;
      if (r.clockText) bestClock = r.clockText;
    } else if (res === 'HIT') {
      isHit = true;
      if (r.targetId && destroyedEnemyIds.has(r.targetId)) {
        isKill = true;
      }
      if (!isKill) {
        if (r.sourceRef) bestRef = r.sourceRef;
        if (r.clockText) bestClock = r.clockText;
      }
    }
  }
  return { isHit, isKill, bestRef: bestRef || 'situation', bestClock: bestClock || '00:00:00' };
}

function getDestroyedEnemyUnitIds(ctx: Parameters<OperatorSpec['evaluate']>[0], enemySide?: string): Set<string> {
  const ids = new Set<string>();
  for (const u of ctx.situation.units.values()) {
    if (u.isDestroyed && isNonWeaponUnit(u) && (!enemySide || isSameSide(u.side, enemySide))) {
      ids.add(u.unitId);
    }
  }
  for (const ev of ctx.situation.damageAndHitEvents) {
    if (ev.damageState === 'destroyed' && (!enemySide || isSameSide(ev.targetSide, enemySide))) {
      const u = ctx.situation.units.get(ev.targetUnitId);
      if (!u || isNonWeaponUnit(u)) ids.add(ev.targetUnitId);
    }
  }
  for (const l of ctx.situation.losses) {
    if ((!enemySide || isSameSide(l.side, enemySide)) && !isWeaponType(l.unitType, l.unitClass) && l.subjectId) {
      ids.add(l.subjectId);
    }
  }
  return ids;
}

export const WEAPON_OPERATORS_V3: OperatorSpec[] = [
  // 15. wpn.probability_of_hit (Ph)
  {
    meta: {
      id: 'wpn.probability_of_hit',
      name: '单发命中概率（Ph）',
      category: 'effectiveness',
      evalRole: 'MOP',
      domain: 'weapon',
      doctrineRef: 'JMEM Weapon Effectiveness — Probability of Hit (Ph)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '按 WeaponID 去重统计终态为 HIT 或 KILL 的弹药数除以己方总发射弹药数（分母涵盖 WeaponLost 途中失效弹，剔除点防重复记录）。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['WeaponFired', 'WeaponEndgame', 'WeaponLost'],
        csvColumns: ['WeaponID', 'FiringUnitSide', 'WeaponSide', 'Result', 'Side', 'Num'],
      },
    },
    evaluate(ctx) {
      const { targetSide, enemySide } = resolveSides(ctx.situation, ctx.customParams);
      const { totalFired, firedEventCount, endgameUniqueCount, weaponLostCount } = computeTotalWeaponsFired(
        ctx.situation,
        targetSide,
      );
      const endgames = ctx.situation.weaponEndgameEvents.filter(
        (e) => !targetSide || isSameSide(e.weaponSide, targetSide),
      );
      if (totalFired === 0 || endgames.length === 0) {
        return unavailableResult('wpn.probability_of_hit', '缺少己方武器发射或终局 (WeaponEndgame) 记录');
      }

      const destroyedEnemyIds = getDestroyedEnemyUnitIds(ctx, enemySide);
      const grouped = groupEndgamesByWeaponId(endgames);
      let hits = 0;
      const evidenceRefs: EvidenceRef[] = [];

      for (const [wid, recs] of grouped.entries()) {
        const outcome = classifyWeaponOutcome(recs, destroyedEnemyIds);
        if (outcome.isHit) {
          hits += 1;
          if (evidenceRefs.length < 5) {
            const refStr = outcome.bestRef || 'situation';
            evidenceRefs.push({
              source: refStr.startsWith('CSV:') ? 'csv' : 'frame',
              ref: refStr,
              scenarioClock: outcome.bestClock,
              description: `弹药 ${wid.slice(0, 8)} 确认命中 (${outcome.isKill ? 'KILL' : 'HIT'})`,
            });
          }
        }
      }

      const ph = Math.round((hits / totalFired) * 10000) / 10000;
      return {
        atomId: 'wpn.probability_of_hit',
        value: ph,
        displayValue: `${(ph * 100).toFixed(1)}% (${hits}/${totalFired} 发命中)`,
        status: 'valid',
        confidence: totalFired >= 5 ? 'high' : 'medium',
        numerator: hits,
        denominator: totalFired,
        sampleSize: totalFired,
        evidenceRefs,
        details: { hits, totalFired, firedEventCount, endgameUniqueCount, weaponLostCount },
      };
    },
  },

  // 16. wpn.probability_of_kill_given_hit (Pk|h)
  {
    meta: {
      id: 'wpn.probability_of_kill_given_hit',
      name: '命中条件下杀伤概率（Pk|h）',
      category: 'effectiveness',
      evalRole: 'MOP',
      domain: 'weapon',
      doctrineRef: 'JMEM Weapon Effectiveness — Conditional Probability of Kill Given Hit (Pk|h)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '按 WeaponID 去重统计终态为 KILL（或直接导致敌方目标摧毁）的弹药数除以命中弹药总数 (HIT + KILL)，衡量单发弹头毁伤威力。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['WeaponEndgame', 'UnitDestroyed'],
        csvColumns: ['WeaponID', 'WeaponSide', 'TargetID', 'Result', 'UnitID'],
      },
    },
    evaluate(ctx) {
      const { targetSide, enemySide } = resolveSides(ctx.situation, ctx.customParams);
      const endgames = ctx.situation.weaponEndgameEvents.filter(
        (e) => !targetSide || isSameSide(e.weaponSide, targetSide),
      );
      if (endgames.length === 0) {
        return unavailableResult('wpn.probability_of_kill_given_hit', '缺少己方终局记录');
      }

      const destroyedEnemyIds = getDestroyedEnemyUnitIds(ctx, enemySide);
      const grouped = groupEndgamesByWeaponId(endgames);
      let hits = 0;
      let kills = 0;
      const evidenceRefs: EvidenceRef[] = [];

      for (const [wid, recs] of grouped.entries()) {
        const outcome = classifyWeaponOutcome(recs, destroyedEnemyIds);
        if (outcome.isHit) {
          hits += 1;
          if (outcome.isKill) {
            kills += 1;
            if (evidenceRefs.length < 5) {
              const refStr = outcome.bestRef || 'situation';
              evidenceRefs.push({
                source: refStr.startsWith('CSV:') ? 'csv' : 'frame',
                ref: refStr,
                scenarioClock: outcome.bestClock,
                description: `弹药 ${wid.slice(0, 8)} 命中且击毁目标 (KILL)`,
              });
            }
          }
        }
      }

      if (hits === 0) {
        return unavailableResult('wpn.probability_of_kill_given_hit', '命中弹药数为 0（无法计算条件概率）');
      }

      const pkh = Math.round((kills / hits) * 10000) / 10000;
      return {
        atomId: 'wpn.probability_of_kill_given_hit',
        value: pkh,
        displayValue: `${(pkh * 100).toFixed(1)}% (${kills}/${hits} 命中致死)`,
        status: 'valid',
        confidence: hits >= 3 ? 'high' : 'medium',
        numerator: kills,
        denominator: hits,
        sampleSize: hits,
        evidenceRefs,
        details: { kills, hits, pkh },
      };
    },
  },

  // 17. wpn.single_shot_pk (Pssk)
  {
    meta: {
      id: 'wpn.single_shot_pk',
      name: '单发杀伤概率（Pssk）',
      category: 'effectiveness',
      evalRole: 'MOP',
      domain: 'weapon',
      doctrineRef: 'JMEM Single Shot Probability of Kill (Pssk = Ph * Pk|h)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '按 WeaponID 去重统计实现目标击毁的弹药数除以己方总发射量（含途中失效弹），与 Ph 和 Pk|h 满足严格数学自洽约束。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['WeaponFired', 'WeaponEndgame', 'WeaponLost'],
        csvColumns: ['WeaponID', 'Result', 'Num'],
      },
    },
    evaluate(ctx) {
      const { targetSide, enemySide } = resolveSides(ctx.situation, ctx.customParams);
      const { totalFired } = computeTotalWeaponsFired(ctx.situation, targetSide);
      const endgames = ctx.situation.weaponEndgameEvents.filter(
        (e) => !targetSide || isSameSide(e.weaponSide, targetSide),
      );
      if (totalFired === 0 || endgames.length === 0) {
        return unavailableResult('wpn.single_shot_pk', '缺少发射或终局记录');
      }

      const destroyedEnemyIds = getDestroyedEnemyUnitIds(ctx, enemySide);
      const grouped = groupEndgamesByWeaponId(endgames);
      let kills = 0;
      for (const [, recs] of grouped.entries()) {
        const outcome = classifyWeaponOutcome(recs, destroyedEnemyIds);
        if (outcome.isKill) kills += 1;
      }

      const pssk = Math.round((kills / totalFired) * 10000) / 10000;
      return {
        atomId: 'wpn.single_shot_pk',
        value: pssk,
        displayValue: `${(pssk * 100).toFixed(1)}% (${kills}/${totalFired} 发实现击毁)`,
        status: 'valid',
        confidence: totalFired >= 5 ? 'high' : 'medium',
        numerator: kills,
        denominator: totalFired,
        sampleSize: totalFired,
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'WeaponFired ⟷ WeaponEndgame',
            scenarioClock: ctx.situation.endGameClock,
            description: `单发杀伤概率：${kills}/${totalFired}`,
          },
        ],
        details: { kills, totalFired, pssk },
      };
    },
  },

  // 18. wpn.terminal_penetration_rate
  {
    meta: {
      id: 'wpn.terminal_penetration_rate',
      name: '末端突防成功率',
      category: 'effectiveness',
      evalRole: 'MOP',
      domain: 'weapon',
      doctrineRef: 'Terminal Point Defence Penetration / Countermeasures Evasion Rate',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '实际遭遇敌方点防/软杀伤拦截的己方弹药中成功穿透（未被近防炮击落、未被箔条诱骗）的比例，严格剔除无点防接入的虚构分母。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['WeaponEndgame'],
        csvColumns: ['WeaponID', 'Result', 'EndgameMessage'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const endgames = ctx.situation.weaponEndgameEvents.filter(
        (e) => !targetSide || isSameSide(e.weaponSide, targetSide),
      );

      let totalEngagedByPointDef = 0;
      let penetrated = 0;
      const evidenceRefs: EvidenceRef[] = [];

      for (const eg of endgames) {
        const msg = (eg.endgameMessage ?? '').toUpperCase();
        const hasPointDef =
          msg.includes('POINT DEFENCE') ||
          msg.includes('POINTDEF') ||
          msg.includes('CIWS') ||
          msg.includes('CHAFF') ||
          msg.includes('FLARE') ||
          msg.includes('INTERCEPTED');

        if (hasPointDef && !msg.includes('NO POINT DEFENCE SYSTEMS EMPLOYED')) {
          totalEngagedByPointDef += 1;
          const isIntercepted = msg.includes('INTERCEPTED') || msg.includes('SHOT DOWN') || msg.includes('DECOYED');
          if (!isIntercepted || eg.result.toUpperCase() === 'HIT' || eg.result.toUpperCase() === 'KILL') {
            penetrated += 1;
            if (evidenceRefs.length < 5) {
              evidenceRefs.push({
                source: 'csv',
                ref: `WeaponEndgame:${eg.weaponId.slice(0, 8)}`,
                scenarioClock: eg.clockText,
                description: `弹药 ${eg.weaponId.slice(0, 8)} 突防成功`,
              });
            }
          }
        }
      }

      if (totalEngagedByPointDef === 0) {
        return unavailableResult('wpn.terminal_penetration_rate', '推演中无弹药遭遇敌方近防/干扰拦截对抗记录');
      }

      const rate = Math.round((penetrated / totalEngagedByPointDef) * 10000) / 10000;
      return {
        atomId: 'wpn.terminal_penetration_rate',
        value: rate,
        displayValue: `${(rate * 100).toFixed(1)}% (${penetrated}/${totalEngagedByPointDef} 突破点防)`,
        status: 'valid',
        confidence: totalEngagedByPointDef >= 3 ? 'high' : 'medium',
        numerator: penetrated,
        denominator: totalEngagedByPointDef,
        sampleSize: totalEngagedByPointDef,
        evidenceRefs,
        details: { penetrated, totalEngagedByPointDef, rate },
      };
    },
  },

  // 19. wpn.shots_per_kill
  {
    meta: {
      id: 'wpn.shots_per_kill',
      name: '单毁伤目标平均耗弹量',
      category: 'cost',
      evalRole: 'MOP',
      domain: 'weapon',
      doctrineRef: 'JMEM Weapons per Kill (Shots per Kill Ratio)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '己方消耗弹药总数除以敌方被摧毁非武器作战目标数，衡量单击毁歼敌所需平均火力弹药配额。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '枚/击毁',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['Expenditures', 'WeaponFired', 'UnitDestroyed'],
        csvColumns: ['Side', 'Num', 'WeaponID', 'UnitID'],
      },
    },
    evaluate(ctx) {
      const { targetSide, enemySide } = resolveSides(ctx.situation, ctx.customParams);
      const { totalFired } = computeTotalWeaponsFired(ctx.situation, targetSide);
      const enemyKilled = getDestroyedEnemyUnitIds(ctx, enemySide).size;

      if (enemyKilled === 0) {
        return unavailableResult('wpn.shots_per_kill', '敌方被摧毁目标数为 0（未实现有效战果）');
      }

      const spk = Math.round((totalFired / enemyKilled) * 10) / 10;
      return {
        atomId: 'wpn.shots_per_kill',
        value: spk,
        displayValue: `${spk.toFixed(1)} 枚/击毁 (共耗弹 ${totalFired} 枚, 击毁 ${enemyKilled} 目标)`,
        status: 'valid',
        confidence: enemyKilled >= 2 ? 'high' : 'medium',
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'Expenditures ⟷ UnitDestroyed',
            scenarioClock: ctx.situation.endGameClock,
            description: `单毁伤耗弹比：${totalFired}/${enemyKilled}`,
          },
        ],
        details: { totalFired, enemyKilled, spk },
      };
    },
  },

  // 20. wpn.inflight_attrition_rate
  {
    meta: {
      id: 'wpn.inflight_attrition_rate',
      name: '弹药途中失效率',
      category: 'suitability',
      evalRole: 'MOS',
      domain: 'weapon',
      doctrineRef: 'DoDI 5000.98 Weapon Reliability & In-Flight Loss Rate',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '未及交战由于燃料耗尽、中段脱锁自毁或被中途拦截的己方弹药数除以总发射数。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['WeaponLost', 'Expenditures', 'WeaponFired'],
        csvColumns: ['Side', 'Num', 'WeaponID'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const { totalFired, weaponLostCount } = computeTotalWeaponsFired(ctx.situation, targetSide);

      if (totalFired === 0) {
        return unavailableResult('wpn.inflight_attrition_rate', '缺少己方发射记录');
      }

      const rate = Math.round((weaponLostCount / totalFired) * 10000) / 10000;
      return {
        atomId: 'wpn.inflight_attrition_rate',
        value: rate,
        displayValue: `${(rate * 100).toFixed(1)}% (${weaponLostCount}/${totalFired} 途中失效)`,
        status: 'valid',
        confidence: 'high',
        numerator: weaponLostCount,
        denominator: totalFired,
        sampleSize: totalFired,
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'WeaponLost',
            scenarioClock: ctx.situation.endGameClock,
            description: `途中失效弹数：${weaponLostCount}/${totalFired}`,
          },
        ],
        details: { weaponLostCount, totalFired, rate },
      };
    },
  },

  // 21. [v3 扩展] wpn.terminal_miss_distance
  {
    meta: {
      id: 'wpn.terminal_miss_distance',
      name: '终端脱靶量分布（Miss Distance）',
      category: 'effectiveness',
      evalRole: 'MOP',
      domain: 'weapon',
      doctrineRef: 'Terminal Guidance Accuracy & Miss Distance Distribution (Meters)',
      mode: 'formula_pipeline',
      pipelineCategory: 'group_agg',
      description:
        '解析 WeaponEndgame 终端交战消息中的脱靶量数值，统计导弹终点散布中位数与 P90 分位数。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '米',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['WeaponEndgame'],
        csvColumns: ['EndgameMessage', 'DistanceFromFiringUnit_Horiz', 'WeaponSide'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const endgames = ctx.situation.weaponEndgameEvents.filter(
        (e) => !targetSide || isSameSide(e.weaponSide, targetSide),
      );

      const missDistances: number[] = [];
      const evidenceRefs: EvidenceRef[] = [];

      for (const eg of endgames) {
        const msg = eg.endgameMessage ?? '';
        // 匹配 "Miss distance: 34.2 m" 或 "34.2m"
        const m = msg.match(/miss\s*distance[:\s]+([\d.]+)\s*(?:m|meters)?/i);
        if (m) {
          const val = parseFloat(m[1]);
          if (!isNaN(val) && val >= 0) {
            missDistances.push(val);
            if (evidenceRefs.length < 5) {
              evidenceRefs.push({
                source: 'csv',
                ref: `WeaponEndgame:${eg.weaponId.slice(0, 8)}`,
                scenarioClock: eg.clockText,
                description: `弹药 ${eg.weaponId.slice(0, 8)} 脱靶量: ${val.toFixed(1)} 米`,
              });
            }
          }
        }
      }

      if (missDistances.length === 0) {
        return unavailableResult('wpn.terminal_miss_distance', 'WeaponEndgame 记录中缺少脱靶量文本数据');
      }

      missDistances.sort((a, b) => a - b);
      const median = computeQuantile(missDistances, 0.5);
      const p90 = computeQuantile(missDistances, 0.9);
      const mean = Math.round((missDistances.reduce((a, b) => a + b, 0) / missDistances.length) * 10) / 10;

      return {
        atomId: 'wpn.terminal_miss_distance',
        value: median,
        displayValue: `${median.toFixed(1)} 米 (中位数, P90: ${p90.toFixed(1)}m)`,
        status: 'valid',
        confidence: missDistances.length >= 3 ? 'high' : 'medium',
        sampleSize: missDistances.length,
        evidenceRefs,
        details: { median, mean, p90, min: missDistances[0], max: missDistances[missDistances.length - 1] },
      };
    },
  },

  // 22. [v3 扩展] wpn.impact_cep
  {
    meta: {
      id: 'wpn.impact_cep',
      name: '弹着点圆概率误差（CEP）',
      category: 'effectiveness',
      evalRole: 'MOP',
      domain: 'weapon',
      doctrineRef: 'Circular Error Probable (CEP 50th Percentile Dispersion)',
      mode: 'spatial',
      pipelineCategory: 'spatial',
      description:
        '基于 WeaponImpact 着弹落点坐标，计算各弹着点相对于散布中心的 50% 累计概率分布半径。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'situation'],
      outputType: 'continuous',
      unit: '米',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['WeaponImpact'],
        csvColumns: ['ImpactLongitude', 'ImpactLatitude', 'Time'],
      },
    },
    evaluate(ctx) {
      const impacts = ctx.situation.weaponImpactEvents ?? [];
      const impactCoords: Array<{ lon: number; lat: number }> = [];

      for (const imp of impacts) {
        if (typeof imp.lon === 'number' && typeof imp.lat === 'number') {
          impactCoords.push({ lon: imp.lon, lat: imp.lat });
        }
      }

      // 备选从 events 中提取
      if (impactCoords.length < 2) {
        for (const ev of ctx.situation.events) {
          if (ev.kind === 'WeaponImpact' && ev.pos && typeof ev.pos.lon === 'number' && typeof ev.pos.lat === 'number') {
            impactCoords.push({ lon: ev.pos.lon, lat: ev.pos.lat });
          }
        }
      }

      if (impactCoords.length < 2) {
        return unavailableResult('wpn.impact_cep', '落点数据不足（需至少 2 处有效弹着坐标）');
      }

      // 计算几何平均中心
      const centerLon = impactCoords.reduce((a, b) => a + b.lon, 0) / impactCoords.length;
      const centerLat = impactCoords.reduce((a, b) => a + b.lat, 0) / impactCoords.length;

      const radiiMeters: number[] = impactCoords.map((pt) => {
        const dNm = nmBetween(pt, { lon: centerLon, lat: centerLat });
        return dNm * 1852;
      });

      radiiMeters.sort((a, b) => a - b);
      const cep = computeQuantile(radiiMeters, 0.5);

      return {
        atomId: 'wpn.impact_cep',
        value: cep,
        displayValue: `${cep.toFixed(1)} 米 (CEP 50% 半径)`,
        status: 'valid',
        confidence: impactCoords.length >= 4 ? 'high' : 'medium',
        sampleSize: impactCoords.length,
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'WeaponImpact',
            scenarioClock: ctx.situation.endGameClock,
            description: `着弹散布解算 CEP: ${cep.toFixed(1)}m (样本: ${impactCoords.length}发)`,
          },
        ],
        details: { cepMeters: cep, sampleCount: impactCoords.length, maxDispersionMeters: radiiMeters[radiiMeters.length - 1] },
      };
    },
  },
];
