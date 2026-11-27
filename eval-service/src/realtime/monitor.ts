import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  initFrameIngestion,
  ingestFrameLine,
  type FrameIngestionState,
} from '../adapters/frame-adapter.ts';
import type { EvalSqliteStore, RealtimeJudgementCard } from '../adapters/sqlite-store.ts';
import type {
  AlarmThreshold,
  EffectDefinition,
  EvaluationSystemDag,
  EvidenceRef,
  SituationModel,
  StructuredSimEvent,
} from '../core/types.ts';
import { defaultEffectStore, type EffectStore } from '../effects/store.ts';
import { defaultMetricGraphStore, type MetricGraphStore } from '../indicators/metric-graph-store.ts';
import {
  isNonWeaponUnit,
  isPointInsidePolygon,
  isSameSide,
} from '../operators/helpers.ts';
import {
  V4_OPERATOR_SPEC_MAP,
  getDefaultV4OperatorRunner,
  type V4OperatorRunner,
} from '../operators/v4/index.ts';
import {
  defaultSystemDagStore,
  type SystemDagStore,
} from '../systems/system-dag-store.ts';

export type RealtimeStreamListener = (payload: {
  type: 'frame' | 'card' | 'card_updated' | 'status';
  runId: string;
  data: unknown;
}) => void;

export interface RealtimeMetricSample {
  metricId: string;
  status: 'valid' | 'degraded' | 'unavailable';
  value: number | null;
  displayValue: string;
  evidenceRefs: EvidenceRef[];
  missingDataReason?: string;
}

export interface ActiveRealtimeAlarmRule {
  effectId: string;
  effectName: string;
  metricId: string;
  operatorId: string;
  targetField?: string;
  threshold: AlarmThreshold;
}

export interface ActiveRealtimeSession {
  runId: string;
  systemId: string;
  frameState: FrameIngestionState;
  lines: string[];
  cursor: number;
  status: 'idle' | 'playing' | 'paused' | 'completed';
  speedMultiplier: number;
  timer?: NodeJS.Timeout;
  inFlight: boolean;
  cooldownMap: Map<string, { lastSeconds: number; severity: 'major' | 'minor' }>;
  suppressedCount: number;
  cards: RealtimeJudgementCard[];
  latestMetrics: Record<string, RealtimeMetricSample>;
}

export interface RealtimeMonitorOptions {
  sqliteStore?: EvalSqliteStore;
  systemDagStore?: SystemDagStore;
  effectStore?: EffectStore;
  metricGraphStore?: MetricGraphStore;
  v4Runner?: V4OperatorRunner;
  /** @deprecated legacy V2 option ignored after V4 migration; kept optional during server.ts transition */
  indicatorStore?: unknown;
}

const DEFAULT_V4_REALTIME_SYSTEM_ID = 'sys_v4_metrics_guide_full';
const COOLDOWN_SCENARIO_SECONDS = 300; // 5 分钟防骚扰冷却窗口

function checkThresholdTriggered(
  val: number,
  op: '>' | '<' | '==' | '>=' | '<=',
  threshold: number,
): boolean {
  switch (op) {
    case '>':
      return val > threshold;
    case '<':
      return val < threshold;
    case '==':
      return Math.abs(val - threshold) < 1e-6;
    case '>=':
      return val >= threshold;
    case '<=':
      return val <= threshold;
    default:
      return false;
  }
}

/**
 * 将流式 BS 帧聚合出的 SituationModel 转为 V4 算子标准 inputDfDict 格式，
 * 供需要时按需调用 V4OperatorRunner。
 */
export function situationModelToInputDfDict(
  model: SituationModel,
): Record<string, Array<Record<string, unknown>>> {
  const sideCreated = model.sides.map((s) => ({ SideName: s }));
  const unitCreated: Array<Record<string, unknown>> = [];
  const unitPositions: Array<Record<string, unknown>> = [];
  const losses: Array<Record<string, unknown>> = [];

  for (const u of model.units.values()) {
    unitCreated.push({
      UnitID: u.unitId,
      UnitName: u.unitName,
      UnitType: u.unitType,
      UnitClass: u.unitClass,
      UnitSide: u.side,
    });
    if (u.isDestroyed && isNonWeaponUnit(u)) {
      losses.push({
        SubjectID: u.unitId,
        SubjectName: u.unitName,
        SubjectSide: u.side,
      });
    }
    for (const pt of u.trackPoints) {
      unitPositions.push({
        Time: pt.clockText,
        UnitID: u.unitId,
        UnitName: u.unitName,
        UnitType: u.unitType,
        UnitSide: u.side,
        UnitLongitude: pt.lon,
        UnitLatitude: pt.lat,
        UnitAltitude_m: pt.altitudeM ?? 0,
      });
    }
  }

  const weaponEndgame = (model.weaponEndgameEvents ?? []).map((e) => ({
    WeaponID: e.weaponId,
    WeaponSide: e.weaponSide,
    TargetID: e.targetId ?? '',
    Result: e.result,
    EndgameMessage: e.endgameMessage ?? '',
  }));

  const missionChanged: Array<Record<string, unknown>> = [];
  const missionRefPoints: Array<Record<string, unknown>> = [];
  const missionUnitRel: Array<Record<string, unknown>> = [];

  for (const c of model.corridors ?? []) {
    missionChanged.push({
      MissionID: c.id,
      MissionName: c.name ?? c.id,
      Side: c.side ?? model.sides[0] ?? '未知',
      MissionClass: 'Patrol',
    });
    c.points.forEach((pt, idx) => {
      missionRefPoints.push({
        Time: model.startGameClock ?? '00:00:00',
        MissionID: c.id,
        Type: 'Create',
        PointIndex: idx + 1,
        Longitude: pt.lon,
        Latitude: pt.lat,
      });
    });
    for (const u of model.units.values()) {
      if (isNonWeaponUnit(u) && (!c.side || isSameSide(u.side, c.side))) {
        missionUnitRel.push({
          Time: model.startGameClock ?? '00:00:00',
          MissionID: c.id,
          UnitID: u.unitId,
          Type: 'Assigned',
        });
      }
    }
  }

  const dict: Record<string, Array<Record<string, unknown>>> = {
    SideCreated: sideCreated,
    UnitCreated: unitCreated,
    UnitPositions: unitPositions,
    Losses: losses,
    WeaponEndgame: weaponEndgame,
  };
  if (missionChanged.length > 0) {
    dict.MissionChanged = missionChanged;
    dict.MissionRefPointRelationChanged = missionRefPoints;
    dict.MissionUnitRelationChanged = missionUnitRel;
  }
  return dict;
}

/**
 * 高频流式 TS 快速计算器（零 Python IPC 开销）：
 * 针对帧级高频刷新的安全红线与战损指标，直接基于 SituationModel 实时计算。
 */
function evaluateFastStreamingMetric(
  metricId: string,
  model: SituationModel,
): RealtimeMetricSample | null {
  if (metricId === 'cost.side_attrition_rate' || metricId === 'cost.side_attrition_metrics') {
    const nonWeapons = [...model.units.values()].filter((u) => isNonWeaponUnit(u));
    if (nonWeapons.length === 0) {
      return {
        metricId,
        status: 'unavailable',
        value: null,
        displayValue: '-',
        evidenceRefs: [],
        missingDataReason: '当前态势帧暂无非武器作战单元样本',
      };
    }
    const destroyed = nonWeapons.filter((u) => u.isDestroyed);
    const rate = Math.round((destroyed.length / nonWeapons.length) * 10000) / 10000;
    return {
      metricId,
      status: 'valid',
      value: rate,
      displayValue: `${(rate * 100).toFixed(1)}% (${destroyed.length}/${nonWeapons.length})`,
      evidenceRefs: destroyed.slice(0, 3).map((u) => ({
        source: 'frame',
        ref: `unit:${u.unitId}`,
        scenarioClock: model.endGameClock,
        description: `战损单元: ${u.unitName} (${u.side})`,
      })),
    };
  }

  if (metricId === 'roe.fratricide_count') {
    const endgames = model.weaponEndgameEvents ?? [];
    let fratricides = 0;
    const seenWeapons = new Set<string>();
    const evidenceRefs: EvidenceRef[] = [];

    for (const eg of endgames) {
      if (eg.endgameMessage && eg.endgameMessage.toLowerCase().includes('no point defence systems employed')) {
        continue;
      }
      if (!['HIT', 'KILL'].includes((eg.result ?? '').toUpperCase())) continue;
      if (eg.weaponId && seenWeapons.has(eg.weaponId)) continue;
      if (eg.weaponId) seenWeapons.add(eg.weaponId);
      if (!eg.targetId) continue;

      const targetUnit = model.units.get(eg.targetId);
      if (targetUnit && isNonWeaponUnit(targetUnit) && eg.weaponSide && isSameSide(targetUnit.side, eg.weaponSide)) {
        fratricides += 1;
        if (evidenceRefs.length < 3) {
          evidenceRefs.push({
            source: 'frame',
            ref: `WeaponEndgame:${eg.weaponId}`,
            scenarioClock: eg.clockText ?? model.endGameClock,
            description: `友军误伤事件: ${eg.weaponSide} 武器命中友方 ${targetUnit.unitName}`,
          });
        }
      }
    }

    return {
      metricId,
      status: 'valid',
      value: fratricides,
      displayValue: `${fratricides} 次`,
      evidenceRefs,
    };
  }

  if (metricId === 'roe.corridor_spatial_compliance') {
    const corridors = model.corridors ?? [];
    if (corridors.length === 0) {
      return {
        metricId,
        status: 'unavailable',
        value: null,
        displayValue: '-',
        evidenceRefs: [],
        missingDataReason: '当前推演帧未提供航路走廊多边形，遵循 Fail-Closed',
      };
    }
    const units = [...model.units.values()].filter((u) => isNonWeaponUnit(u));
    let total = 0;
    let inside = 0;
    const outRefs: EvidenceRef[] = [];
    for (const u of units) {
      for (const pt of u.trackPoints) {
        total += 1;
        const ok = corridors.some((c) => isPointInsidePolygon({ lon: pt.lon, lat: pt.lat }, c));
        if (ok) inside += 1;
        else if (outRefs.length < 3) {
          outRefs.push({
            source: 'frame',
            ref: `Track:line#${pt.lineRef ?? 0}`,
            scenarioClock: pt.clockText,
            description: `${u.unitName} 越出航路走廊 (${pt.lon.toFixed(3)}, ${pt.lat.toFixed(3)})`,
          });
        }
      }
    }
    if (total === 0) {
      return {
        metricId,
        status: 'unavailable',
        value: null,
        displayValue: '-',
        evidenceRefs: [],
        missingDataReason: '无可用非武器单位航迹点样本',
      };
    }
    const rate = Math.round((inside / total) * 10000) / 10000;
    return {
      metricId,
      status: 'valid',
      value: rate,
      displayValue: `${(rate * 100).toFixed(1)}% (${inside}/${total})`,
      evidenceRefs: outRefs,
    };
  }

  return null;
}

export class RealtimeMonitor {
  private sqliteStore?: EvalSqliteStore;
  private readonly systemDagStore: SystemDagStore;
  private readonly effectStore: EffectStore;
  private readonly metricGraphStore: MetricGraphStore;
  private readonly v4Runner?: V4OperatorRunner;
  private readonly sessions = new Map<string, ActiveRealtimeSession>();
  private readonly listeners = new Set<RealtimeStreamListener>();

  constructor(opts?: RealtimeMonitorOptions) {
    this.sqliteStore = opts?.sqliteStore;
    this.systemDagStore = opts?.systemDagStore ?? defaultSystemDagStore;
    this.effectStore = opts?.effectStore ?? defaultEffectStore;
    this.metricGraphStore = opts?.metricGraphStore ?? defaultMetricGraphStore;
    this.v4Runner = opts?.v4Runner;
  }

  rebindSqliteStore(newStore: EvalSqliteStore): void {
    for (const session of this.sessions.values()) {
      if (session.timer) {
        clearInterval(session.timer);
        session.timer = undefined;
      }
      session.status = 'idle';
      session.inFlight = false;
    }
    this.sessions.clear();
    this.sqliteStore = newStore;
    this.emit({
      type: 'status',
      runId: '',
      data: null,
    });
  }

  subscribe(listener: RealtimeStreamListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(payload: Parameters<RealtimeStreamListener>[0]): void {
    for (const l of this.listeners) {
      try {
        l(payload);
      } catch {
        // 忽略单个 SSE 断线异常
      }
    }
  }

  createSessionFromFile(params: {
    runId: string;
    jsonlFile: string;
    systemId?: string;
    speedMultiplier?: number;
  }): ActiveRealtimeSession {
    const raw = fs.readFileSync(params.jsonlFile, 'utf-8');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return this.createSessionFromLines({
      runId: params.runId,
      scenarioPath: params.jsonlFile,
      lines,
      systemId: params.systemId,
      speedMultiplier: params.speedMultiplier,
    });
  }

  createSessionFromLines(params: {
    runId: string;
    scenarioPath: string;
    lines: string[];
    systemId?: string;
    speedMultiplier?: number;
  }): ActiveRealtimeSession {
    this.stopSession(params.runId);
    const frameState = initFrameIngestion(params.runId, params.scenarioPath);
    const session: ActiveRealtimeSession = {
      runId: params.runId,
      systemId: params.systemId ?? DEFAULT_V4_REALTIME_SYSTEM_ID,
      frameState,
      lines: params.lines,
      cursor: 0,
      status: 'idle',
      speedMultiplier: Math.max(0.5, Math.min(params.speedMultiplier ?? 2, 20)),
      inFlight: false,
      cooldownMap: new Map(),
      suppressedCount: 0,
      cards: [],
      latestMetrics: {},
    };
    this.sessions.set(params.runId, session);
    return session;
  }

  getSessionSnapshot(runId: string) {
    const s = this.sessions.get(runId);
    if (!s) return null;
    const model = s.frameState.model;
    return {
      runId: s.runId,
      systemId: s.systemId,
      status: s.status,
      cursor: s.cursor,
      totalFrames: s.lines.length,
      speedMultiplier: s.speedMultiplier,
      scenarioClock: model.endGameClock,
      totalGameSeconds: model.totalGameSeconds,
      sides: model.sides,
      unitCount: model.units.size,
      destroyedUnits: [...model.units.values()].filter((u) => u.isDestroyed).length,
      eventCount: model.events.length,
      suppressedCount: s.suppressedCount,
      cards: s.cards,
      recentEvents: model.events.slice(-15),
      units: [...model.units.values()].map((u) => ({
        unitId: u.unitId,
        unitName: u.unitName,
        side: u.side,
        unitClass: u.unitClass,
        damageState: u.damageState,
        ammoRemaining: u.ammoRemaining,
        lastPos: u.trackPoints[u.trackPoints.length - 1] ?? null,
      })),
    };
  }

  private collectActiveAlarmRules(dag: EvaluationSystemDag & { metricGraphId?: string }): ActiveRealtimeAlarmRule[] {
    const rules: ActiveRealtimeAlarmRule[] = [];
    const metricToOp = new Map<string, { operatorId: string; targetField?: string }>();

    if (dag.metricGraphId) {
      const mg = this.metricGraphStore.get(dag.metricGraphId);
      if (mg) {
        for (const n of mg.nodes) {
          const mc = n.metricConfig;
          if (mc?.metricId && mc.mode === 'from_operator' && mc.sourceRef) {
            metricToOp.set(mc.metricId, {
              operatorId: mc.sourceRef,
              targetField: mc.targetField,
            });
          }
        }
      }
    }

    for (const node of dag.nodes) {
      if (node.kind !== 'effect' && node.kind !== 'gate') continue;
      const effect: EffectDefinition | undefined =
        node.inlineEffect ?? (node.refId ? this.effectStore.get(node.refId) : undefined);
      const binding = effect?.metricBinding;
      if (!effect || !binding?.alarmThreshold) continue;

      const mapped = metricToOp.get(binding.metricId);
      rules.push({
        effectId: effect.effectId,
        effectName: effect.name,
        metricId: binding.metricId,
        operatorId: mapped?.operatorId ?? binding.metricId,
        targetField: binding.targetField ?? mapped?.targetField,
        threshold: binding.alarmThreshold,
      });
    }

    return rules;
  }

  private async evaluateMetricForRule(
    s: ActiveRealtimeSession,
    rule: ActiveRealtimeAlarmRule,
  ): Promise<RealtimeMetricSample> {
    const cached = s.latestMetrics[rule.metricId];
    if (cached) return cached;

    const model = s.frameState.model;
    // 1. 优先走高频流式 TS 快速计算路径
    const fast = evaluateFastStreamingMetric(rule.metricId, model);
    if (fast) {
      s.latestMetrics[rule.metricId] = fast;
      return fast;
    }

    // 2. 按需回退 V4OperatorRunner（仅对活跃 alarmThreshold 引用的已注册 V4 算子）
    if (V4_OPERATOR_SPEC_MAP.has(rule.operatorId)) {
      try {
        const runner = this.v4Runner ?? getDefaultV4OperatorRunner();
        const inputDfDict = situationModelToInputDfDict(model);
        const opRes = await runner.runOperator(rule.operatorId, {
          runId: `${s.runId}:f${s.frameState.frameCount}`,
          inputDfDict,
        });
        if (opRes.status !== 'unavailable' && opRes.dataset && opRes.dataset.rows.length > 0) {
          const col =
            rule.targetField ??
            opRes.dataset.columns.find((c) => c.type === 'number')?.name ??
            Object.keys(opRes.dataset.rows[0]).find(
              (k) => typeof opRes.dataset!.rows[0][k] === 'number',
            );
          const nums = col
            ? opRes.dataset.rows
                .map((r) => Number(r[col]))
                .filter((v) => Number.isFinite(v))
            : [];
          if (nums.length > 0) {
            const avg = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10000) / 10000;
            const sample: RealtimeMetricSample = {
              metricId: rule.metricId,
              status: 'valid',
              value: avg,
              displayValue: String(avg),
              evidenceRefs: opRes.evidenceRefs.slice(0, 3),
            };
            s.latestMetrics[rule.metricId] = sample;
            return sample;
          }
        }
        const unavail: RealtimeMetricSample = {
          metricId: rule.metricId,
          status: 'unavailable',
          value: null,
          displayValue: '-',
          evidenceRefs: opRes.evidenceRefs.slice(0, 3),
          missingDataReason: opRes.missingDataReason ?? 'V4 算子返回空样本',
        };
        s.latestMetrics[rule.metricId] = unavail;
        return unavail;
      } catch (err) {
        const unavail: RealtimeMetricSample = {
          metricId: rule.metricId,
          status: 'unavailable',
          value: null,
          displayValue: '-',
          evidenceRefs: [],
          missingDataReason: err instanceof Error ? err.message : String(err),
        };
        s.latestMetrics[rule.metricId] = unavail;
        return unavail;
      }
    }

    const fallback: RealtimeMetricSample = {
      metricId: rule.metricId,
      status: 'unavailable',
      value: null,
      displayValue: '-',
      evidenceRefs: [],
      missingDataReason: `未找到对应 V4 算子: ${rule.operatorId}`,
    };
    s.latestMetrics[rule.metricId] = fallback;
    return fallback;
  }

  async stepFrame(
    runId: string,
    lineOverride?: string,
  ): Promise<{
    done: boolean;
    emittedEvents: StructuredSimEvent[];
    newCards: RealtimeJudgementCard[];
  }> {
    const s = this.sessions.get(runId);
    if (!s) throw new Error(`未找到实时推演会话: ${runId}`);

    let lineText = lineOverride;
    let lineNo = s.frameState.frameCount + 1;
    if (lineText === undefined) {
      if (s.cursor >= s.lines.length) {
        s.status = 'completed';
        if (s.timer) {
          clearInterval(s.timer);
          s.timer = undefined;
        }
        this.emit({ type: 'status', runId, data: this.getSessionSnapshot(runId) });
        return { done: true, emittedEvents: [], newCards: [] };
      }
      lineText = s.lines[s.cursor];
      s.cursor += 1;
      lineNo = s.cursor;
    } else {
      s.lines.push(lineText);
      s.cursor = s.lines.length;
      if (s.status === 'idle' || s.status === 'completed') {
        s.status = 'playing';
      }
    }

    const emittedEvents = ingestFrameLine(s.frameState, lineText, lineNo, {
      trackAllSamples: true,
    });

    // 每帧清空缓存并按需计算活跃规则指标
    s.latestMetrics = {};
    const newCards = await this.evaluateRealtimeTriggers(s, emittedEvents);

    this.emit({
      type: 'frame',
      runId,
      data: {
        snapshot: this.getSessionSnapshot(runId),
        emittedEvents,
      },
    });
    for (const c of newCards) {
      this.emit({ type: 'card', runId, data: c });
    }

    if (lineOverride === undefined && s.cursor >= s.lines.length) {
      s.status = 'completed';
      if (s.timer) {
        clearInterval(s.timer);
        s.timer = undefined;
      }
      this.emit({ type: 'status', runId, data: this.getSessionSnapshot(runId) });
    }

    return { done: s.status === 'completed', emittedEvents, newCards };
  }

  private tryEmitCard(
    s: ActiveRealtimeSession,
    candidate: Omit<RealtimeJudgementCard, 'cardId' | 'createdAt' | 'hitlAction'>,
  ): RealtimeJudgementCard | null {
    const key = `${candidate.triggerIndicatorId}:${candidate.triggerAtomId}`;
    const prev = s.cooldownMap.get(key);
    const nowSec = s.frameState.model.totalGameSeconds;

    if (prev) {
      const withinCooldown = nowSec - prev.lastSeconds < COOLDOWN_SCENARIO_SECONDS;
      const escalated = prev.severity === 'minor' && candidate.severity === 'major';
      if (withinCooldown && !escalated) {
        s.suppressedCount += 1;
        return null;
      }
    }

    s.cooldownMap.set(key, { lastSeconds: nowSec, severity: candidate.severity });
    const card: RealtimeJudgementCard = {
      ...candidate,
      cardId: `q109-${crypto.randomUUID().slice(0, 8)}`,
      hitlAction: 'pending',
      createdAt: new Date().toISOString(),
    };
    s.cards.unshift(card);
    this.sqliteStore?.saveRealtimeCard(card);
    return card;
  }

  private async evaluateRealtimeTriggers(
    s: ActiveRealtimeSession,
    emittedEvents: StructuredSimEvent[],
  ): Promise<RealtimeJudgementCard[]> {
    const created: RealtimeJudgementCard[] = [];
    const model = s.frameState.model;

    // 1) 事件驱动即时重大研判 (例如核心平台战损)
    for (const ev of emittedEvents) {
      if (ev.kind === 'unit_destroyed') {
        const c = this.tryEmitCard(s, {
          runId: s.runId,
          scenarioClock: model.endGameClock,
          scenarioSeconds: model.totalGameSeconds,
          severity: 'major',
          triggerIndicatorId: 'rt_unit_loss_alert',
          triggerAtomId: 'cost.side_attrition_rate',
          title: `平台损毁告警：${ev.subject ?? '未知单元'}`,
          situationSummary: `${ev.clockText} 时刻观测到 ${ev.side ?? ''} 单元 ${ev.subject ?? ''} 损毁状态跳变。`,
          riskAssessment: '当前兵力/火控节点受损，可能导致后续局部火力覆盖缺口或交换比恶化。',
          suggestion: '建议核查邻近护航编队受威胁度，并评估是否触发撤出走廊或启用备选接战预案。',
          evidenceRefs: [
            {
              source: 'frame',
              ref: ev.ref,
              scenarioClock: ev.clockText,
              description: `平台损毁: ${ev.subject ?? ''}`,
            },
          ],
        });
        if (c) created.push(c);
      }
    }

    // 2) 扫描 V4 体系 DAG 中的 effect/gate 节点配置的 alarmThreshold
    const dag =
      this.systemDagStore.get(s.systemId) ??
      this.systemDagStore.get(DEFAULT_V4_REALTIME_SYSTEM_ID);
    if (dag) {
      const rules = this.collectActiveAlarmRules(dag);
      for (const rule of rules) {
        const sample = await this.evaluateMetricForRule(s, rule);
        if (sample.status === 'unavailable' || sample.value === null) {
          continue;
        }
        const th = rule.threshold;
        if (checkThresholdTriggered(sample.value, th.operator, th.value)) {
          const c = this.tryEmitCard(s, {
            runId: s.runId,
            scenarioClock: model.endGameClock,
            scenarioSeconds: model.totalGameSeconds,
            severity: th.severity,
            triggerIndicatorId: rule.effectId,
            triggerAtomId: rule.metricId,
            title: `效果/门控阈值触发：${rule.effectName}`,
            situationSummary: `${th.messageTemplate ?? rule.effectName + ' 触发阈值告警'}（当前实测：${sample.displayValue}，阈值 ${th.operator} ${th.value}）。`,
            riskAssessment: `指标 ${rule.metricId} 实测值偏离预设阈值，持续偏离可能影响「${dag.name}」综合效能评估。`,
            suggestion: '请选择「继续观察」确认态势走势，或「暂停检查」调整对应 WRA / 航路脚本。',
            evidenceRefs: sample.evidenceRefs.slice(0, 3),
          });
          if (c) created.push(c);
        }
      }
    }

    return created;
  }

  startPlayback(runId: string, speedMultiplier?: number): void {
    const s = this.sessions.get(runId);
    if (!s) throw new Error(`未找到会话: ${runId}`);
    if (speedMultiplier !== undefined) {
      s.speedMultiplier = Math.max(0.5, Math.min(speedMultiplier, 20));
    }
    if (s.timer) {
      clearInterval(s.timer);
      s.timer = undefined;
    }
    if (s.cursor >= s.lines.length) {
      s.status = 'completed';
      this.emit({ type: 'status', runId, data: this.getSessionSnapshot(runId) });
      return;
    }
    s.status = 'playing';
    const intervalMs = Math.max(120, Math.round(900 / s.speedMultiplier));
    s.timer = setInterval(() => {
      if (s.inFlight) return;
      s.inFlight = true;
      void this.stepFrame(runId)
        .then((res) => {
          if (res.done && s.timer) {
            clearInterval(s.timer);
            s.timer = undefined;
          }
        })
        .catch(() => {
          if (s.timer) {
            clearInterval(s.timer);
            s.timer = undefined;
          }
        })
        .finally(() => {
          s.inFlight = false;
        });
    }, intervalMs);
    this.emit({ type: 'status', runId, data: this.getSessionSnapshot(runId) });
  }

  pausePlayback(runId: string): void {
    const s = this.sessions.get(runId);
    if (!s) return;
    if (s.timer) {
      clearInterval(s.timer);
      s.timer = undefined;
    }
    if (s.status !== 'completed') s.status = 'paused';
    this.emit({ type: 'status', runId, data: this.getSessionSnapshot(runId) });
  }

  stopSession(runId: string): void {
    const s = this.sessions.get(runId);
    if (s?.timer) {
      clearInterval(s.timer);
    }
    this.sessions.delete(runId);
  }

  resolveCard(
    runId: string,
    cardId: string,
    action: 'observe' | 'pause_inspect' | 'ignore_expected',
    note?: string,
  ): RealtimeJudgementCard | null {
    const s = this.sessions.get(runId);
    const now = new Date().toISOString();
    let updated: RealtimeJudgementCard | null = null;
    if (s) {
      if (action === 'pause_inspect') {
        this.pausePlayback(runId);
      }
      const card = s.cards.find((c) => c.cardId === cardId);
      if (card) {
        card.hitlAction = action;
        card.hitlNote = note;
        card.resolvedAt = now;
        updated = card;
      }
    }
    const dbUpdated = this.sqliteStore?.updateRealtimeCardAction(cardId, action, note);
    const finalCard = updated ?? dbUpdated ?? null;
    if (finalCard) {
      this.emit({ type: 'card_updated', runId, data: finalCard });
    }
    return finalCard;
  }
}
