import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  initFrameIngestion,
  ingestFrameLine,
  type FrameIngestionState,
} from '../adapters/frame-adapter.ts';
import type { EvalSqliteStore, RealtimeJudgementCard } from '../adapters/sqlite-store.ts';
import type {
  IndicatorDefinition,
  IndicatorSystem,
  MetricAtomResult,
  StructuredSimEvent,
} from '../core/types.ts';
import { defaultIndicatorStore, type IndicatorStore } from '../indicators/store.ts';
import { evaluateAllOperators } from '../operators/registry.ts';
import { defaultSystemStore } from '../systems/store.ts';
import { isDimensionNode } from '../systems/validator.ts';

export type RealtimeStreamListener = (payload: {
  type: 'frame' | 'card' | 'card_updated' | 'status';
  runId: string;
  data: unknown;
}) => void;

export interface ActiveRealtimeSession {
  runId: string;
  systemId: string;
  frameState: FrameIngestionState;
  lines: string[];
  cursor: number;
  status: 'idle' | 'playing' | 'paused' | 'completed';
  speedMultiplier: number;
  timer?: NodeJS.Timeout;
  cooldownMap: Map<string, { lastSeconds: number; severity: 'major' | 'minor' }>;
  suppressedCount: number;
  cards: RealtimeJudgementCard[];
  latestAtoms: Record<string, MetricAtomResult>;
}

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

function collectIndicatorIds(system: IndicatorSystem): string[] {
  const out: string[] = [];
  const walk = (nodes: IndicatorSystem['root']['children']) => {
    for (const n of nodes) {
      if (isDimensionNode(n)) walk(n.children);
      else out.push(n.indicatorRef);
    }
  };
  walk(system.root.children);
  return [...new Set(out)];
}

export class RealtimeMonitor {
  private readonly sqliteStore?: EvalSqliteStore;
  private readonly indicatorStore: IndicatorStore;
  private readonly sessions = new Map<string, ActiveRealtimeSession>();
  private readonly listeners = new Set<RealtimeStreamListener>();

  constructor(opts?: { sqliteStore?: EvalSqliteStore; indicatorStore?: IndicatorStore }) {
    this.sqliteStore = opts?.sqliteStore;
    this.indicatorStore = opts?.indicatorStore ?? defaultIndicatorStore;
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
      systemId: params.systemId ?? 'sys_littoral_swarm_v1',
      frameState,
      lines: params.lines,
      cursor: 0,
      status: 'idle',
      speedMultiplier: Math.max(0.5, Math.min(params.speedMultiplier ?? 2, 20)),
      cooldownMap: new Map(),
      suppressedCount: 0,
      cards: [],
      latestAtoms: {},
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

  stepFrame(runId: string, lineOverride?: string): {
    done: boolean;
    emittedEvents: StructuredSimEvent[];
    newCards: RealtimeJudgementCard[];
  } {
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
    const ctx = { runId, situation: s.frameState.model };
    s.latestAtoms = evaluateAllOperators(ctx);

    const newCards = this.evaluateRealtimeTriggers(s, emittedEvents);
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

  private evaluateRealtimeTriggers(
    s: ActiveRealtimeSession,
    emittedEvents: StructuredSimEvent[],
  ): RealtimeJudgementCard[] {
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
          triggerAtomId: 'eff.attrition_balance',
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

    // 2) 扫描体系指标配置的 alarmThreshold
    const sys = defaultSystemStore.get(s.systemId);
    if (sys) {
      const indIds = collectIndicatorIds(sys);
      for (const id of indIds) {
        const ind: IndicatorDefinition | undefined = this.indicatorStore.get(id);
        if (!ind?.alarmThreshold) continue;
        const atomRes = s.latestAtoms[ind.atomRef];
        if (!atomRes || atomRes.status === 'unavailable' || typeof atomRes.value !== 'number') {
          continue;
        }
        const th = ind.alarmThreshold;
        if (checkThresholdTriggered(atomRes.value, th.operator, th.value)) {
          const c = this.tryEmitCard(s, {
            runId: s.runId,
            scenarioClock: model.endGameClock,
            scenarioSeconds: model.totalGameSeconds,
            severity: th.severity,
            triggerIndicatorId: ind.indicatorId,
            triggerAtomId: ind.atomRef,
            title: `指标阈值触发：${ind.name}`,
            situationSummary: `${th.messageTemplate ?? ind.name + ' 触发阈值告警'}（当前实测：${atomRes.displayValue}，阈值 ${th.operator} ${th.value}）。`,
            riskAssessment: `指标 ${ind.name} 实测值偏离预设阈值，持续偏离可能影响「${sys.name}」综合效能评估。`,
            suggestion: '请选择「继续观察」确认态势走势，或「暂停检查」调整对应 WRA / 航路脚本。',
            evidenceRefs: atomRes.evidenceRefs.slice(0, 3),
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
      try {
        const res = this.stepFrame(runId);
        if (res.done && s.timer) {
          clearInterval(s.timer);
          s.timer = undefined;
        }
      } catch {
        if (s.timer) clearInterval(s.timer);
      }
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
