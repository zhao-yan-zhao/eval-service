import type { EvidenceRef, MetricAtomContext, MetricAtomMeta, MetricAtomResult } from '../../core/types.ts';
import { formatDuration, isNonWeaponDamageEvent, resolveSides, unavailableResult } from '../helpers.ts';

export interface OperatorSpec {
  meta: MetricAtomMeta;
  evaluate: (ctx: MetricAtomContext) => MetricAtomResult;
}

function findFirstDetection(ctx: MetricAtomContext) {
  const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
  const detEvents = ctx.situation.events
    .filter((e) => e.kind === 'detection_new' && (!targetSide || !e.side || e.side === targetSide))
    .sort((a, b) => a.scenarioSeconds - b.scenarioSeconds);

  if (detEvents.length > 0) {
    const first = detEvents[0];
    return {
      seconds: first.scenarioSeconds,
      clockText: first.clockText,
      evidence: {
        source: first.source === 'csv' ? 'csv' : 'frame',
        ref: first.ref,
        scenarioClock: first.clockText,
        description: `${first.side ?? targetSide ?? '侦察方'} 首次捕获接触 ${first.subject ?? ''}`,
      } as EvidenceRef,
    };
  }

  // 回退检查 contacts 表 firstSeenSeconds
  const contacts = [...ctx.situation.contacts.values()]
    .filter((c) => !targetSide || c.detectedBySide === targetSide)
    .sort((a, b) => a.firstSeenSeconds - b.firstSeenSeconds);
  if (contacts.length > 0) {
    const c = contacts[0];
    return {
      seconds: c.firstSeenSeconds,
      clockText: c.firstSeenClock,
      evidence: {
        source: 'frame' as const,
        ref: c.contactId,
        scenarioClock: c.firstSeenClock,
        description: `接触 ${c.targetUnitName ?? c.contactId} 首次纳入探测队列`,
      },
    };
  }
  return null;
}

function findFirstFire(ctx: MetricAtomContext) {
  const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
  const fires = ctx.situation.weaponFiredEvents
    .filter((w) => !targetSide || w.firerSide === targetSide || w.firerSide === 'Unknown')
    .sort((a, b) => a.scenarioSeconds - b.scenarioSeconds);
  if (fires.length === 0) return null;
  const f = fires[0];
  return {
    seconds: f.scenarioSeconds,
    clockText: f.clockText,
    evidence: {
      source: f.sourceRef.startsWith('CSV:') ? 'csv' : 'frame',
      ref: f.sourceRef,
      scenarioClock: f.clockText,
      description: `${f.firerName} 发射 ${f.weaponTypeNormalized} (${f.rounds} 枚)`,
    } as EvidenceRef,
  };
}

export const TIME_OPERATORS: OperatorSpec[] = [
  {
    meta: {
      id: 'time.first_detection',
      name: '首次侦获时间',
      category: 'time',
      mode: 'aggregation',
      pipelineCategory: 'group_agg',
      description: '推演开始至己方首次建立敌方目标接触（detection_new 或 ContactCreated）的时长（秒）。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['events', 'situation'],
      outputType: 'duration_seconds',
      unit: '秒',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['ContactCreated', 'DetectionIdentificationChanged'],
        csvColumns: ['Time', 'ContactID', 'ActualUnitID', 'Side', 'SensorType', 'ContactRangeHoriz_nm'],
        bsFramePaths: ['Sides[].Side.Contacts[]', 'bs-diff:detection_new'],
        discrepancyNotes: ['部分 Bridge 推演默认关闭 IsExportExperimentEvaluation 时无 ContactCreated.csv'],
      },
    },
    evaluate(ctx) {
      const det = findFirstDetection(ctx);
      if (!det) {
        return unavailableResult(
          'time.first_detection',
          '当前推演样本未记录任何目标发现事件或接触数据（ContactCreated / Contacts 缺失）',
        );
      }
      return {
        atomId: 'time.first_detection',
        value: Math.round(det.seconds * 100) / 100,
        displayValue: formatDuration(det.seconds),
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [det.evidence],
      };
    },
  },
  {
    meta: {
      id: 'time.first_weapon_fire',
      name: '首次交火时间',
      category: 'time',
      mode: 'aggregation',
      pipelineCategory: 'group_agg',
      description: '推演开始至己方首次发射武器（weapon_fired / WeaponFired）的场景耗时（秒）。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['events', 'csv', 'situation'],
      outputType: 'duration_seconds',
      unit: '秒',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['WeaponFired'],
        csvColumns: ['Time', 'FiringUnitID', 'FiringUnitSide', 'WeaponID', 'WeaponName'],
        bsFramePaths: ['ActiveUnits[].Mounts/Weapons', 'bs-diff:weapon_fired'],
      },
    },
    evaluate(ctx) {
      const fire = findFirstFire(ctx);
      if (!fire) {
        return unavailableResult('time.first_weapon_fire', '推演中未观测到武器发射事件');
      }
      return {
        atomId: 'time.first_weapon_fire',
        value: Math.round(fire.seconds * 100) / 100,
        displayValue: formatDuration(fire.seconds),
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [fire.evidence],
      };
    },
  },
  {
    meta: {
      id: 'time.detect_to_fire_latency',
      name: '侦察-交火响应延迟',
      category: 'time',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description: '从首次发现目标到首次发起武器攻击之间的时间差（秒），衡量侦打一体链路敏捷性。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['events', 'situation'],
      outputType: 'duration_seconds',
      unit: '秒',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['ContactCreated', 'WeaponFired'],
        bsFramePaths: ['Sides[].Side.Contacts[]', 'bs-diff:weapon_fired'],
      },
    },
    evaluate(ctx) {
      const det = findFirstDetection(ctx);
      const fire = findFirstFire(ctx);
      if (!det || !fire) {
        return unavailableResult(
          'time.detect_to_fire_latency',
          `无法计算延迟：${!det ? '缺少首次侦获证据' : ''}${!det && !fire ? '且' : ''}${!fire ? '缺少首次发射证据' : ''}`,
        );
      }
      const latency = Math.max(0, Math.round((fire.seconds - det.seconds) * 100) / 100);
      return {
        atomId: 'time.detect_to_fire_latency',
        value: latency,
        displayValue: formatDuration(latency),
        status: fire.seconds < det.seconds ? 'degraded' : 'valid',
        confidence: fire.seconds < det.seconds ? 'medium' : 'high',
        evidenceRefs: [det.evidence, fire.evidence],
        missingDataReason:
          fire.seconds < det.seconds
            ? '观测到先于本局捕获接触的协同/预先发射事件，按 0 秒截断并降级'
            : undefined,
      };
    },
  },
  {
    meta: {
      id: 'time.first_target_hit',
      name: '首发命中时间',
      category: 'time',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description: '推演开始至敌方首次承受命中/损伤/被毁（WeaponEndgame KILL/HIT 或 UnitDamaged/Destroyed）的时间。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['events', 'csv'],
      outputType: 'duration_seconds',
      unit: '秒',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['WeaponEndgame', 'UnitDamaged', 'UnitDestroyed'],
        csvColumns: ['Time', 'Result', 'TargetSide', 'DamagePercent'],
        bsFramePaths: ['bs-diff:unit_destroyed', 'bs-diff:engine_event(WeaponHit)'],
        discrepancyNotes: ['引擎原生导出为 UnitDamaged.csv（D1），需兼容 Damage.csv'],
      },
    },
    evaluate(ctx) {
      const { enemySide } = resolveSides(ctx.situation, ctx.customParams);
      const candidates: Array<{ sec: number; ref: EvidenceRef }> = [];

      for (const eg of ctx.situation.weaponEndgameEvents) {
        if ((eg.result === 'KILL' || eg.result === 'HIT') && (!enemySide || eg.targetSide === enemySide)) {
          candidates.push({
            sec: eg.scenarioSeconds,
            ref: {
              source: 'csv',
              ref: eg.sourceRef,
              scenarioClock: eg.clockText,
              description: `${eg.weaponName} 命中 ${eg.targetName ?? eg.targetId ?? '目标'} (${eg.result})`,
            },
          });
        }
      }
      for (const dh of ctx.situation.damageAndHitEvents) {
        if ((!enemySide || dh.targetSide === enemySide) && isNonWeaponDamageEvent(ctx.situation, dh)) {
          candidates.push({
            sec: dh.scenarioSeconds,
            ref: {
              source: dh.sourceRef.startsWith('CSV:') ? 'csv' : 'frame',
              ref: dh.sourceRef,
              scenarioClock: dh.clockText,
              description: `${dh.targetUnitName ?? dh.targetUnitId} ${dh.damageState === 'destroyed' ? '被毁' : '受损'}`,
            },
          });
        }
      }

      candidates.sort((a, b) => a.sec - b.sec);
      if (candidates.length === 0) {
        return unavailableResult('time.first_target_hit', '未检测到敌方受损或被命中记录');
      }
      const first = candidates[0];
      return {
        atomId: 'time.first_target_hit',
        value: Math.round(first.sec * 100) / 100,
        displayValue: formatDuration(first.sec),
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [first.ref],
      };
    },
  },
  {
    meta: {
      id: 'time.combat_duration',
      name: '实际交战总窗口',
      category: 'time',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description: '最后一次武器终局/战损事件时刻减去首次武器发射时刻（秒），刻画高强度交战跨度。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['events', 'csv'],
      outputType: 'duration_seconds',
      unit: '秒',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['WeaponFired', 'WeaponEndgame', 'UnitDamaged', 'UnitDestroyed'],
      },
    },
    evaluate(ctx) {
      const fires = [...ctx.situation.weaponFiredEvents].sort((a, b) => a.scenarioSeconds - b.scenarioSeconds);
      if (fires.length === 0) {
        return unavailableResult('time.combat_duration', '无发射事件，无法定义交战窗口起点');
      }
      const start = fires[0];
      const endEvents = [
        ...ctx.situation.damageAndHitEvents.map((d) => ({
          sec: d.scenarioSeconds,
          clock: d.clockText,
          ref: d.sourceRef,
          desc: `${d.targetUnitName ?? d.targetUnitId} 毁伤事件`,
        })),
        ...ctx.situation.weaponEndgameEvents.map((e) => ({
          sec: e.scenarioSeconds,
          clock: e.clockText,
          ref: e.sourceRef,
          desc: `${e.weaponName} 终局 (${e.result})`,
        })),
      ].sort((a, b) => b.sec - a.sec);

      const endPoint = endEvents[0] ?? {
        sec: fires[fires.length - 1].scenarioSeconds,
        clock: fires[fires.length - 1].clockText,
        ref: fires[fires.length - 1].sourceRef,
        desc: '末次开火（无战损记录回退）',
      };

      const duration = Math.max(0, Math.round((endPoint.sec - start.scenarioSeconds) * 100) / 100);
      return {
        atomId: 'time.combat_duration',
        value: duration,
        displayValue: formatDuration(duration),
        status: endEvents.length === 0 ? 'degraded' : 'valid',
        confidence: endEvents.length === 0 ? 'medium' : 'high',
        evidenceRefs: [
          {
            source: start.sourceRef.startsWith('CSV:') ? 'csv' : 'frame',
            ref: start.sourceRef,
            scenarioClock: start.clockText,
            description: `首次开火: ${start.firerName} 发射 ${start.weaponTypeNormalized}`,
          },
          {
            source: endPoint.ref.startsWith('CSV:') ? 'csv' : 'frame',
            ref: endPoint.ref,
            scenarioClock: endPoint.clock,
            description: `交战收尾: ${endPoint.desc}`,
          },
        ],
      };
    },
  },
  {
    meta: {
      id: 'time.blind_zone_duration',
      name: '最大情报黑障时长',
      category: 'time',
      mode: 'aggregation',
      pipelineCategory: 'group_agg',
      description: '目标从接触丢失 (detection_lost) 至重新捕获之间的最大中断时长（秒），反映预警跟踪连续性。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['events', 'situation'],
      outputType: 'duration_seconds',
      unit: '秒',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        bsFramePaths: ['Sides[].Side.Contacts[]', 'bs-diff:detection_lost'],
        csvTables: ['ContactCreated', 'ContactPositions'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      if (!ctx.situation.coverage.hasContacts) {
        return unavailableResult(
          'time.blind_zone_duration',
          '当前数据集不含接触列表 (Contacts)，无法衡量目标连续跟踪与黑障情况',
        );
      }

      let maxGap = 0;
      const refs: EvidenceRef[] = [];
      for (const c of ctx.situation.contacts.values()) {
        if (targetSide && c.detectedBySide !== targetSide) continue;
        for (const interval of c.lostIntervals) {
          if (interval.durationSeconds > maxGap) {
            maxGap = interval.durationSeconds;
            refs.length = 0;
            refs.push({
              source: 'frame',
              ref: interval.ref,
              scenarioClock: `${interval.lostClock} → ${interval.reacquiredClock}`,
              description: `接触 ${c.targetUnitName ?? c.contactId} 断链再捕获间隔 ${interval.durationSeconds} 秒`,
            });
          }
        }
      }

      // 若存在当前未恢复丢失且后续帧仍持续推演，记录当前挂起盲区
      for (const c of ctx.situation.contacts.values()) {
        if (targetSide && c.detectedBySide !== targetSide) continue;
        if (c.isLost && ctx.situation.totalGameSeconds > c.lastSeenSeconds) {
          const gap = ctx.situation.totalGameSeconds - c.lastSeenSeconds;
          if (gap > maxGap) {
            maxGap = gap;
            refs.length = 0;
            refs.push({
              source: 'frame',
              ref: c.contactId,
              scenarioClock: `${c.lastSeenClock} → ${ctx.situation.endGameClock}`,
              description: `接触 ${c.targetUnitName ?? c.contactId} 丢失后直至局末未再捕获`,
            });
          }
        }
      }

      const rounded = Math.round(maxGap * 100) / 100;
      return {
        atomId: 'time.blind_zone_duration',
        value: rounded,
        displayValue: rounded === 0 ? '0.0 秒 (全程连续跟踪)' : formatDuration(rounded),
        status: 'valid',
        confidence: 'high',
        evidenceRefs: refs.length
          ? refs
          : [
              {
                source: 'frame',
                ref: 'Contacts:all',
                scenarioClock: ctx.situation.endGameClock,
                description: '全程保持接触连续性，未发生丢失再捕获中断',
              },
            ],
      };
    },
  },
  {
    meta: {
      id: 'time.bvr_flight_avg',
      name: '武器发射至末端平均飞行耗时',
      category: 'time',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description: '按唯一 WeaponID 关联 WeaponFired 发射时刻与 WeaponEndgame 末端判定时刻，测算导弹平均实际飞行耗时（秒）。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'events'],
      outputType: 'duration_seconds',
      unit: '秒',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['WeaponFired', 'WeaponEndgame'],
        csvColumns: ['WeaponID', 'Time', 'WeaponName', 'Result'],
        discrepancyNotes: ['Join 配方 weapon_hit_rate：需将两侧 WeaponID 统一去横杠小写并忽略空白 Result 行'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const firedByWeapon = new Map<string, (typeof ctx.situation.weaponFiredEvents)[number]>();
      for (const f of ctx.situation.weaponFiredEvents) {
        if (!f.weaponId) continue;
        if (targetSide && f.firerSide !== targetSide && f.firerSide !== 'Unknown') continue;
        const key = f.weaponId.toLowerCase();
        if (!firedByWeapon.has(key)) firedByWeapon.set(key, f);
      }
      if (firedByWeapon.size === 0) {
        return unavailableResult('time.bvr_flight_avg', '缺少带 WeaponID 的 WeaponFired 记录，无法关联飞行时长');
      }

      const durations: number[] = [];
      const refs: EvidenceRef[] = [];
      const terminalEndByWeapon = new Map<string, (typeof ctx.situation.weaponEndgameEvents)[number]>();
      for (const eg of ctx.situation.weaponEndgameEvents) {
        if (!eg.weaponId || !eg.result.trim()) continue;
        const key = eg.weaponId.toLowerCase();
        const prev = terminalEndByWeapon.get(key);
        const upper = eg.result.trim().toUpperCase();
        if (!prev || upper === 'KILL' || upper === 'HIT' || upper === 'MISS' || upper === 'POINTDEF:SUCCESS') {
          terminalEndByWeapon.set(key, eg);
        }
      }

      for (const [wid, eg] of terminalEndByWeapon.entries()) {
        const f = firedByWeapon.get(wid);
        if (!f) continue;
        const dt = eg.scenarioSeconds - f.scenarioSeconds;
        if (dt >= 0) {
          durations.push(dt);
          if (refs.length < 5) {
            refs.push({
              source: 'csv',
              ref: eg.sourceRef,
              scenarioClock: `${f.clockText} → ${eg.clockText}`,
              description: `${f.weaponTypeNormalized} (${wid.slice(0, 8)}) 飞行 ${dt.toFixed(1)} 秒 → ${eg.result}`,
            });
          }
        }
      }

      if (durations.length === 0) {
        return unavailableResult('time.bvr_flight_avg', 'WeaponFired 与 WeaponEndgame 未通过 WeaponID 成功匹配任何飞行终态');
      }

      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      return {
        atomId: 'time.bvr_flight_avg',
        value: Math.round(avg * 100) / 100,
        displayValue: `${formatDuration(avg)}（${durations.length} 枚匹配样本）`,
        status: 'valid',
        confidence: durations.length >= 2 ? 'high' : 'medium',
        evidenceRefs: refs,
        details: {
          sampleCount: durations.length,
          minSeconds: Math.min(...durations),
          maxSeconds: Math.max(...durations),
        },
      };
    },
  },
  {
    meta: {
      id: 'time.kill_chain_total_latency',
      name: '端到端杀伤链总时延',
      category: 'time',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description: '从己方首次侦获目标（ContactCreated / Contacts）到首发武器有效命中（KILL / HIT / 敌方毁伤）的全链条闭合时延。',
      readiness: 'batch_b_pending',
      requiredDataSources: ['events', 'situation', 'csv'],
      outputType: 'duration_seconds',
      unit: '秒',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['ContactCreated', 'WeaponEndgame', 'UnitDestroyed'],
        bsFramePaths: ['Sides[].Side.Contacts[]', 'ActiveUnits[].DamageState'],
        discrepancyNotes: ['若数据源缺少首次侦获接触事件 (ContactCreated)，无法闭合杀伤链完整时延'],
      },
    },
    evaluate(ctx) {
      const det = findFirstDetection(ctx);
      if (!det) {
        return unavailableResult('time.kill_chain_total_latency', '缺少首次侦获接触时间，无法闭合 F2T2EA 全杀伤链时延');
      }
      const { targetSide, enemySide } = resolveSides(ctx.situation, ctx.customParams);
      const hits = ctx.situation.weaponEndgameEvents
        .filter((e) => (!targetSide || e.weaponSide === targetSide) && /KILL|HIT/i.test(e.result))
        .sort((a, b) => a.scenarioSeconds - b.scenarioSeconds);
      const dmgHits = ctx.situation.damageAndHitEvents
        .filter((d) => (!enemySide || d.targetSide === enemySide) && isNonWeaponDamageEvent(ctx.situation, d))
        .sort((a, b) => a.scenarioSeconds - b.scenarioSeconds);

      const firstHitSec = hits[0]?.scenarioSeconds ?? dmgHits[0]?.scenarioSeconds;
      const firstHitClock = hits[0]?.clockText ?? dmgHits[0]?.clockText;
      const firstHitRef = hits[0]?.sourceRef ?? dmgHits[0]?.sourceRef;
      if (firstHitSec === undefined || !firstHitClock || !firstHitRef) {
        return unavailableResult('time.kill_chain_total_latency', '已记录侦获接触，但尚无有效命中或敌方战损终局时间');
      }
      const total = Math.max(0, firstHitSec - det.seconds);
      return {
        atomId: 'time.kill_chain_total_latency',
        value: Math.round(total * 100) / 100,
        displayValue: `${formatDuration(total)}（${det.evidence.scenarioClock} → ${firstHitClock}）`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [
          det.evidence,
          {
            source: firstHitRef.startsWith('CSV:') ? 'csv' : 'frame',
            ref: firstHitRef,
            scenarioClock: firstHitClock,
            description: `首次命中/战损达成（全杀伤链闭合耗时 ${total.toFixed(1)} 秒）`,
          },
        ],
      };
    },
  },
  {
    meta: {
      id: 'time.strike_wave_interval',
      name: '打击波次平均重打击间隔',
      category: 'time',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description: '将间隔大于 20 秒的火力发射事件聚类为独立攻击波次（或读取 AirOps 起飞波次），统计波次间平均时间间隔（秒）。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'events'],
      outputType: 'duration_seconds',
      unit: '秒',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['WeaponFired', 'AirOps'],
        csvColumns: ['Time', 'FiringUnitSide', 'WeaponID', 'Action'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const sortedFires = ctx.situation.weaponFiredEvents
        .filter((w) => !targetSide || w.firerSide === targetSide || w.firerSide === 'Unknown')
        .sort((a, b) => a.scenarioSeconds - b.scenarioSeconds);

      if (sortedFires.length === 0) {
        return unavailableResult('time.strike_wave_interval', '缺少己方开火记录，无法聚类攻击波次');
      }

      const waveStarts: Array<{ sec: number; clock: string; ref: string; name: string }> = [
        {
          sec: sortedFires[0].scenarioSeconds,
          clock: sortedFires[0].clockText,
          ref: sortedFires[0].sourceRef,
          name: sortedFires[0].weaponTypeNormalized,
        },
      ];
      let lastSec = sortedFires[0].scenarioSeconds;
      for (let i = 1; i < sortedFires.length; i += 1) {
        const f = sortedFires[i];
        if (f.scenarioSeconds - lastSec > 20) {
          waveStarts.push({ sec: f.scenarioSeconds, clock: f.clockText, ref: f.sourceRef, name: f.weaponTypeNormalized });
        }
        lastSec = f.scenarioSeconds;
      }

      if (waveStarts.length < 2) {
        return {
          atomId: 'time.strike_wave_interval',
          value: 0,
          displayValue: `0.0 秒（单波次集中发射 ${sortedFires.length} 次）`,
          status: 'degraded',
          confidence: 'medium',
          evidenceRefs: [
            {
              source: 'csv',
              ref: waveStarts[0].ref,
              scenarioClock: waveStarts[0].clock,
              description: `所有 ${sortedFires.length} 次发射集中在单一波次（间隔 <= 20 秒）`,
            },
          ],
          details: { waveCount: 1, firingEvents: sortedFires.length },
        };
      }

      const gaps: number[] = [];
      for (let i = 1; i < waveStarts.length; i += 1) {
        gaps.push(waveStarts[i].sec - waveStarts[i - 1].sec);
      }
      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      return {
        atomId: 'time.strike_wave_interval',
        value: Math.round(avgGap * 100) / 100,
        displayValue: `${formatDuration(avgGap)}（共 ${waveStarts.length} 波次）`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: waveStarts.slice(0, 5).map((w, idx) => ({
          source: w.ref.startsWith('CSV:') ? 'csv' : 'frame',
          ref: w.ref,
          scenarioClock: w.clock,
          description: `波次 #${idx + 1} 开启：${w.name}`,
        })),
        details: { waveCount: waveStarts.length, gapsSeconds: gaps },
      };
    },
  },
];
