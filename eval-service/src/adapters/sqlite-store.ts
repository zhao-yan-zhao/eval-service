import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  EvidenceRef,
  SituationContact,
  SituationModel,
  SituationUnit,
  StructuredSimEvent,
  SystemEvaluationOutput,
  TacticalFeedbackPayload,
} from '../core/types.ts';

const DEFAULT_DB_PATH = path.resolve(import.meta.dirname, '..', '..', 'data', 'eval.db');

export interface StoredRunSummary {
  runId: string;
  scenarioName: string;
  sourceKind: string;
  scenarioPath: string;
  timelineId: string | null;
  startClock: string;
  endClock: string;
  totalGameSeconds: number;
  sides: string[];
  unitCount: number;
  eventCount: number;
  importedAt: string;
}

export interface StoredEvalSummary {
  evalId: string;
  runId: string;
  systemId: string;
  systemName: string;
  systemVersion: string;
  overallScore: number | null;
  overallConfidence: string;
  availableWeightRatio: number;
  createdAt: string;
}

export interface RealtimeJudgementCard {
  cardId: string;
  runId: string;
  scenarioClock: string;
  scenarioSeconds: number;
  severity: 'major' | 'minor';
  triggerIndicatorId: string;
  triggerAtomId: string;
  title: string;
  situationSummary: string;
  riskAssessment: string;
  suggestion: string;
  evidenceRefs: EvidenceRef[];
  hitlAction: 'pending' | 'observe' | 'pause_inspect' | 'ignore_expected';
  hitlNote?: string;
  createdAt: string;
  resolvedAt?: string;
}

interface SerializedSituationSnapshot {
  model: Omit<SituationModel, 'units' | 'contacts'> & {
    units: Array<[string, SituationUnit]>;
    contacts: Array<[string, SituationContact]>;
  };
}

export function serializeSituationSnapshot(m: SituationModel): string {
  const payload: SerializedSituationSnapshot = {
    model: {
      ...m,
      units: Array.from(m.units.entries()),
      contacts: Array.from(m.contacts.entries()),
    },
  };
  return JSON.stringify(payload);
}

export function deserializeSituationSnapshot(raw: string): SituationModel {
  const parsed = JSON.parse(raw) as SerializedSituationSnapshot;
  const m = parsed.model;
  return {
    ...m,
    units: new Map<string, SituationUnit>(m.units ?? []),
    contacts: new Map<string, SituationContact>(m.contacts ?? []),
  };
}

export class EvalSqliteStore {
  readonly dbPath: string;
  private readonly db: DatabaseSync;

  constructor(dbPath = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA busy_timeout = 10000;');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS simulation_runs (
        run_id TEXT PRIMARY KEY,
        scenario_name TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        scenario_path TEXT NOT NULL,
        timeline_id TEXT,
        start_clock TEXT NOT NULL,
        end_clock TEXT NOT NULL,
        total_game_seconds REAL NOT NULL,
        sides_json TEXT NOT NULL,
        coverage_json TEXT NOT NULL,
        unit_count INTEGER NOT NULL,
        event_count INTEGER NOT NULL,
        situation_snapshot_json TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS simulation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        scenario_seconds REAL NOT NULL,
        clock_text TEXT NOT NULL,
        side TEXT,
        kind TEXT NOT NULL,
        subject TEXT,
        object TEXT,
        severity TEXT NOT NULL,
        source TEXT NOT NULL,
        ref TEXT NOT NULL,
        detail_json TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES simulation_runs(run_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_sim_events_run_time ON simulation_events (run_id, scenario_seconds);
      CREATE INDEX IF NOT EXISTS idx_sim_events_run_kind ON simulation_events (run_id, kind);

      CREATE TABLE IF NOT EXISTS unit_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        unit_id TEXT NOT NULL,
        unit_name TEXT NOT NULL,
        side TEXT NOT NULL,
        unit_type TEXT,
        unit_class TEXT NOT NULL,
        scenario_seconds REAL NOT NULL,
        lon REAL NOT NULL,
        lat REAL NOT NULL,
        altitude_m REAL,
        heading REAL,
        speed_kts REAL,
        damage_state TEXT NOT NULL,
        ammo_remaining INTEGER NOT NULL,
        FOREIGN KEY (run_id) REFERENCES simulation_runs(run_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_unit_states_run_unit ON unit_states (run_id, unit_id, scenario_seconds);

      CREATE TABLE IF NOT EXISTS eval_results (
        eval_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        system_id TEXT NOT NULL,
        system_name TEXT NOT NULL,
        system_version TEXT NOT NULL,
        overall_score REAL,
        overall_confidence TEXT NOT NULL,
        available_weight_ratio REAL NOT NULL,
        dimensions_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        report_md TEXT NOT NULL,
        feedback_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES simulation_runs(run_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_eval_results_run ON eval_results (run_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS realtime_cards (
        card_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        scenario_clock TEXT NOT NULL,
        scenario_seconds REAL NOT NULL,
        severity TEXT NOT NULL,
        trigger_indicator_id TEXT NOT NULL,
        trigger_atom_id TEXT NOT NULL,
        title TEXT NOT NULL,
        situation_summary TEXT NOT NULL,
        risk_assessment TEXT NOT NULL,
        suggestion TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        hitl_action TEXT NOT NULL,
        hitl_note TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_rt_cards_run ON realtime_cards (run_id, created_at DESC);
    `);
  }

  saveSituationRun(model: SituationModel): void {
    const now = new Date().toISOString();
    const snapshot = serializeSituationSnapshot(model);

    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('DELETE FROM simulation_events WHERE run_id = ?')
        .run(model.runId);
      this.db
        .prepare('DELETE FROM unit_states WHERE run_id = ?')
        .run(model.runId);

      this.db
        .prepare(
          `INSERT OR REPLACE INTO simulation_runs (
            run_id, scenario_name, source_kind, scenario_path, timeline_id,
            start_clock, end_clock, total_game_seconds, sides_json, coverage_json,
            unit_count, event_count, situation_snapshot_json, imported_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          model.runId,
          model.scenarioName || path.basename(model.scenarioPath) || model.runId,
          model.coverage.sourceKind,
          model.scenarioPath,
          model.timelineId ?? null,
          model.startGameClock,
          model.endGameClock,
          model.totalGameSeconds,
          JSON.stringify(model.sides),
          JSON.stringify(model.coverage),
          model.units.size,
          model.events.length,
          snapshot,
          now,
        );

      const insEvt = this.db.prepare(
        `INSERT INTO simulation_events (
          run_id, event_id, seq, scenario_seconds, clock_text,
          side, kind, subject, object, severity, source, ref, detail_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      model.events.forEach((ev, idx) => {
        insEvt.run(
          model.runId,
          ev.eventId,
          idx + 1,
          ev.scenarioSeconds,
          ev.clockText,
          ev.side ?? null,
          ev.kind,
          ev.subject ?? null,
          ev.object ?? null,
          ev.severity,
          ev.source,
          String(ev.ref),
          JSON.stringify(ev.detail ?? {}),
        );
      });

      const insTrack = this.db.prepare(
        `INSERT INTO unit_states (
          run_id, unit_id, unit_name, side, unit_type, unit_class,
          scenario_seconds, lon, lat, altitude_m, heading, speed_kts, damage_state, ammo_remaining
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      for (const u of model.units.values()) {
        for (const pt of u.trackPoints) {
          insTrack.run(
            model.runId,
            u.unitId,
            u.unitName,
            u.side,
            u.unitType ?? null,
            u.unitClass,
            pt.scenarioSeconds,
            pt.lon,
            pt.lat,
            pt.altitudeM ?? null,
            pt.heading ?? null,
            pt.speedKts ?? null,
            u.damageState,
            u.ammoRemaining,
          );
        }
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  listRuns(): StoredRunSummary[] {
    const rows = this.db
      .prepare(
        `SELECT run_id, scenario_name, source_kind, scenario_path, timeline_id,
                start_clock, end_clock, total_game_seconds, sides_json,
                unit_count, event_count, imported_at
         FROM simulation_runs
         ORDER BY imported_at DESC`,
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      runId: String(r.run_id),
      scenarioName: String(r.scenario_name),
      sourceKind: String(r.source_kind),
      scenarioPath: String(r.scenario_path),
      timelineId: r.timeline_id ? String(r.timeline_id) : null,
      startClock: String(r.start_clock),
      endClock: String(r.end_clock),
      totalGameSeconds: Number(r.total_game_seconds),
      sides: JSON.parse(String(r.sides_json)) as string[],
      unitCount: Number(r.unit_count),
      eventCount: Number(r.event_count),
      importedAt: String(r.imported_at),
    }));
  }

  getRunSituation(runId: string): SituationModel | null {
    const row = this.db
      .prepare('SELECT situation_snapshot_json FROM simulation_runs WHERE run_id = ?')
      .get(runId) as { situation_snapshot_json?: string } | undefined;
    if (!row?.situation_snapshot_json) return null;
    return deserializeSituationSnapshot(row.situation_snapshot_json);
  }

  queryEvents(
    runId: string,
    opts?: { kind?: string; side?: string; severity?: string; search?: string; limit?: number; offset?: number },
  ): { total: number; events: StructuredSimEvent[] } {
    const where: string[] = ['run_id = ?'];
    const params: Array<string | number> = [runId];
    if (opts?.kind) {
      where.push('kind = ?');
      params.push(opts.kind);
    }
    if (opts?.side) {
      where.push('side = ?');
      params.push(opts.side);
    }
    if (opts?.severity) {
      where.push('severity = ?');
      params.push(opts.severity);
    }
    if (opts?.search) {
      where.push('(subject LIKE ? OR object LIKE ? OR ref LIKE ?)');
      const pat = `%${opts.search}%`;
      params.push(pat, pat, pat);
    }

    const whereSql = where.join(' AND ');
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS cnt FROM simulation_events WHERE ${whereSql}`)
      .get(...params) as { cnt: number };

    const limit = Math.min(opts?.limit ?? 200, 1000);
    const offset = Math.max(opts?.offset ?? 0, 0);
    const rows = this.db
      .prepare(
        `SELECT event_id, scenario_seconds, clock_text, side, kind, subject, object,
                severity, source, ref, detail_json
         FROM simulation_events
         WHERE ${whereSql}
         ORDER BY scenario_seconds ASC, seq ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Array<Record<string, unknown>>;

    return {
      total: Number(countRow.cnt),
      events: rows.map((r) => ({
        eventId: String(r.event_id),
        scenarioSeconds: Number(r.scenario_seconds),
        clockText: String(r.clock_text),
        side: r.side ? String(r.side) : null,
        kind: String(r.kind) as StructuredSimEvent['kind'],
        subject: r.subject ? String(r.subject) : null,
        object: r.object ? String(r.object) : null,
        severity: String(r.severity) as 'major' | 'minor',
        source: String(r.source) as StructuredSimEvent['source'],
        ref: String(r.ref),
        detail: JSON.parse(String(r.detail_json)) as Record<string, unknown>,
      })),
    };
  }

  queryUnitTracks(runId: string): Array<{
    unitId: string;
    unitName: string;
    side: string;
    unitClass: string;
    damageState: string;
    points: Array<{ scenarioSeconds: number; lon: number; lat: number; altitudeM: number | null }>;
  }> {
    const rows = this.db
      .prepare(
        `SELECT unit_id, unit_name, side, unit_class, damage_state, scenario_seconds, lon, lat, altitude_m
         FROM unit_states
         WHERE run_id = ?
         ORDER BY unit_id ASC, scenario_seconds ASC`,
      )
      .all(runId) as Array<Record<string, unknown>>;

    const byUnit = new Map<
      string,
      {
        unitId: string;
        unitName: string;
        side: string;
        unitClass: string;
        damageState: string;
        points: Array<{ scenarioSeconds: number; lon: number; lat: number; altitudeM: number | null }>;
      }
    >();
    for (const r of rows) {
      const uid = String(r.unit_id);
      let entry = byUnit.get(uid);
      if (!entry) {
        entry = {
          unitId: uid,
          unitName: String(r.unit_name),
          side: String(r.side),
          unitClass: String(r.unit_class),
          damageState: String(r.damage_state),
          points: [],
        };
        byUnit.set(uid, entry);
      }
      entry.points.push({
        scenarioSeconds: Number(r.scenario_seconds),
        lon: Number(r.lon),
        lat: Number(r.lat),
        altitudeM: r.altitude_m !== null ? Number(r.altitude_m) : null,
      });
    }
    return [...byUnit.values()];
  }

  saveEvaluation(
    output: SystemEvaluationOutput,
    reportMd: string,
    feedback: TacticalFeedbackPayload,
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO eval_results (
          eval_id, run_id, system_id, system_name, system_version,
          overall_score, overall_confidence, available_weight_ratio,
          dimensions_json, result_json, report_md, feedback_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        output.evalId,
        output.runId,
        output.systemId,
        output.systemName,
        output.systemVersion ?? '1.0.0',
        output.overallScore,
        output.overallConfidence,
        output.availableWeightRatio,
        JSON.stringify(output.dimensions),
        JSON.stringify(output),
        reportMd,
        JSON.stringify(feedback),
        output.createdAt,
      );
  }

  listEvaluations(runId?: string): StoredEvalSummary[] {
    const sql = runId
      ? `SELECT eval_id, run_id, system_id, system_name, system_version,
                overall_score, overall_confidence, available_weight_ratio, created_at
         FROM eval_results WHERE run_id = ? ORDER BY created_at DESC`
      : `SELECT eval_id, run_id, system_id, system_name, system_version,
                overall_score, overall_confidence, available_weight_ratio, created_at
         FROM eval_results ORDER BY created_at DESC`;
    const rows = (runId ? this.db.prepare(sql).all(runId) : this.db.prepare(sql).all()) as Array<
      Record<string, unknown>
    >;
    return rows.map((r) => ({
      evalId: String(r.eval_id),
      runId: String(r.run_id),
      systemId: String(r.system_id),
      systemName: String(r.system_name),
      systemVersion: String(r.system_version),
      overallScore: r.overall_score !== null ? Number(r.overall_score) : null,
      overallConfidence: String(r.overall_confidence),
      availableWeightRatio: Number(r.available_weight_ratio),
      createdAt: String(r.created_at),
    }));
  }

  getEvaluation(evalId: string): {
    output: SystemEvaluationOutput;
    reportMd: string;
    feedback: TacticalFeedbackPayload;
  } | null {
    const row = this.db
      .prepare('SELECT result_json, report_md, feedback_json FROM eval_results WHERE eval_id = ?')
      .get(evalId) as
      | { result_json?: string; report_md?: string; feedback_json?: string }
      | undefined;
    if (!row?.result_json) return null;
    return {
      output: JSON.parse(row.result_json) as SystemEvaluationOutput,
      reportMd: row.report_md ?? '',
      feedback: JSON.parse(row.feedback_json ?? '{}') as TacticalFeedbackPayload,
    };
  }

  deleteEvaluation(evalId: string): boolean {
    const info = this.db.prepare('DELETE FROM eval_results WHERE eval_id = ?').run(evalId);
    return info.changes > 0;
  }

  saveRealtimeCard(card: RealtimeJudgementCard): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO realtime_cards (
          card_id, run_id, scenario_clock, scenario_seconds, severity,
          trigger_indicator_id, trigger_atom_id, title,
          situation_summary, risk_assessment, suggestion, evidence_refs_json,
          hitl_action, hitl_note, created_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        card.cardId,
        card.runId,
        card.scenarioClock,
        card.scenarioSeconds,
        card.severity,
        card.triggerIndicatorId,
        card.triggerAtomId,
        card.title,
        card.situationSummary,
        card.riskAssessment,
        card.suggestion,
        JSON.stringify(card.evidenceRefs),
        card.hitlAction,
        card.hitlNote ?? null,
        card.createdAt,
        card.resolvedAt ?? null,
      );
  }

  updateRealtimeCardAction(
    cardId: string,
    hitlAction: 'observe' | 'pause_inspect' | 'ignore_expected',
    hitlNote?: string,
  ): RealtimeJudgementCard | null {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE realtime_cards SET hitl_action = ?, hitl_note = ?, resolved_at = ? WHERE card_id = ?',
      )
      .run(hitlAction, hitlNote ?? null, now, cardId);
    const list = this.listRealtimeCards();
    return list.find((c) => c.cardId === cardId) ?? null;
  }

  listRealtimeCards(runId?: string): RealtimeJudgementCard[] {
    const sql = runId
      ? 'SELECT * FROM realtime_cards WHERE run_id = ? ORDER BY created_at DESC LIMIT 200'
      : 'SELECT * FROM realtime_cards ORDER BY created_at DESC LIMIT 200';
    const rows = (runId ? this.db.prepare(sql).all(runId) : this.db.prepare(sql).all()) as Array<
      Record<string, unknown>
    >;
    return rows.map((r) => ({
      cardId: String(r.card_id),
      runId: String(r.run_id),
      scenarioClock: String(r.scenario_clock),
      scenarioSeconds: Number(r.scenario_seconds),
      severity: String(r.severity) as 'major' | 'minor',
      triggerIndicatorId: String(r.trigger_indicator_id),
      triggerAtomId: String(r.trigger_atom_id),
      title: String(r.title),
      situationSummary: String(r.situation_summary),
      riskAssessment: String(r.risk_assessment),
      suggestion: String(r.suggestion),
      evidenceRefs: JSON.parse(String(r.evidence_refs_json)) as EvidenceRef[],
      hitlAction: String(r.hitl_action) as RealtimeJudgementCard['hitlAction'],
      hitlNote: r.hitl_note ? String(r.hitl_note) : undefined,
      createdAt: String(r.created_at),
      resolvedAt: r.resolved_at ? String(r.resolved_at) : undefined,
    }));
  }

  getStats() {
    const counts = {
      runs: Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM simulation_runs').get() as { c: number }).c,
      ),
      events: Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM simulation_events').get() as { c: number }).c,
      ),
      unitStates: Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM unit_states').get() as { c: number }).c,
      ),
      evaluations: Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM eval_results').get() as { c: number }).c,
      ),
      realtimeCards: Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM realtime_cards').get() as { c: number }).c,
      ),
    };
    let dbBytes = 0;
    if (this.dbPath !== ':memory:' && fs.existsSync(this.dbPath)) {
      dbBytes = fs.statSync(this.dbPath).size;
    }
    return { dbPath: this.dbPath, dbBytes, counts };
  }

  close(): void {
    this.db.close();
  }
}

export const defaultSqliteStore = new EvalSqliteStore();
