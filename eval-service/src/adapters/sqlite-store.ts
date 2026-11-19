import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  BuiltinOperatorOverride,
  CustomOperatorDefinition,
  EvidenceRef,
  IndicatorDefinition,
  IndicatorSystem,
  SituationContact,
  SituationModel,
  SituationUnit,
  StructuredSimEvent,
  SystemEvaluationOutput,
  TacticalFeedbackPayload,
} from '../core/types.ts';

const DEFAULT_DB_PATH = path.resolve(import.meta.dirname, '..', '..', 'data', 'eval.db');

export interface StoredOperatorPipeline {
  operatorId: string;
  pipelineTitle: string;
  nodes: any[];
  edges: any[];
  dataset?: any;
  updatedAt: string;
}

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
    this.seedThreeLibraries();
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

      CREATE TABLE IF NOT EXISTS custom_operators (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        mode TEXT NOT NULL,
        pipeline_category TEXT,
        output_type TEXT NOT NULL,
        unit TEXT NOT NULL,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS operator_overrides (
        operator_id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS operator_pipelines (
        operator_id TEXT PRIMARY KEY,
        pipeline_title TEXT NOT NULL,
        nodes_json TEXT NOT NULL,
        edges_json TEXT NOT NULL,
        dataset_json TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS indicator_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        atom_ref TEXT NOT NULL,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_indicators_category ON indicator_definitions (category);
      CREATE INDEX IF NOT EXISTS idx_indicators_builtin ON indicator_definitions (is_builtin);

      CREATE TABLE IF NOT EXISTS indicator_systems (
        system_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        tree_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_systems_builtin ON indicator_systems (is_builtin);
    `);
  }

  seedThreeLibraries(): void {
    const now = new Date().toISOString();

    // 1. operator_overrides
    try {
      const overrideCount = Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM operator_overrides').get() as { c: number }).c,
      );
      const overridesFile = path.resolve(import.meta.dirname, '..', '..', 'data', 'operator-overrides.json');
      if (overrideCount === 0 && fs.existsSync(overridesFile)) {
        const raw = fs.readFileSync(overridesFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const stmt = this.db.prepare(
            'INSERT OR REPLACE INTO operator_overrides (operator_id, data_json, updated_at) VALUES (?, ?, ?)',
          );
          for (const item of parsed) {
            if (item && item.id) {
              stmt.run(item.id, JSON.stringify(item), now);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[sqlite-store] seed operator_overrides failed:', err);
    }

    // 2. custom_operators
    try {
      const customOpsCount = Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM custom_operators').get() as { c: number }).c,
      );
      const customOpsFile = path.resolve(import.meta.dirname, '..', '..', 'data', 'custom-operators.json');
      if (customOpsCount === 0 && fs.existsSync(customOpsFile)) {
        const raw = fs.readFileSync(customOpsFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const stmt = this.db.prepare(
            `INSERT OR REPLACE INTO custom_operators (
              id, name, category, mode, pipeline_category, output_type, unit, data_json, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          for (const def of parsed) {
            if (def && def.id) {
              stmt.run(
                def.id,
                def.name || '',
                def.category || 'effectiveness',
                def.mode || 'formula_pipeline',
                def.pipelineCategory || null,
                def.outputType || 'score',
                def.unit || '',
                JSON.stringify(def),
                now,
              );
            }
          }
        }
      }
    } catch (err) {
      console.warn('[sqlite-store] seed custom_operators failed:', err);
    }

    // 3. operator_pipelines
    try {
      const pipelineCount = Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM operator_pipelines').get() as { c: number }).c,
      );
      const pipelinesFile = path.resolve(import.meta.dirname, '..', '..', 'data', 'operator-pipelines.json');
      if (pipelineCount === 0 && fs.existsSync(pipelinesFile)) {
        const raw = fs.readFileSync(pipelinesFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const stmt = this.db.prepare(
            `INSERT OR REPLACE INTO operator_pipelines (
              operator_id, pipeline_title, nodes_json, edges_json, dataset_json, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)`,
          );
          for (const [opId, p] of Object.entries(parsed)) {
            const pipe = p as any;
            stmt.run(
              opId,
              pipe.pipelineTitle || opId,
              JSON.stringify(pipe.nodes || []),
              JSON.stringify(pipe.edges || []),
              pipe.dataset ? JSON.stringify(pipe.dataset) : null,
              pipe.updatedAt || now,
            );
          }
        }
      }
    } catch (err) {
      console.warn('[sqlite-store] seed operator_pipelines failed:', err);
    }

    // 4. indicator_definitions (builtins + custom)
    try {
      const indCount = Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM indicator_definitions').get() as { c: number }).c,
      );
      if (indCount === 0) {
        const stmt = this.db.prepare(
          `INSERT OR REPLACE INTO indicator_definitions (
            id, name, category, atom_ref, is_builtin, data_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        const builtinCatalogFile = path.resolve(import.meta.dirname, '..', 'indicators', 'catalog.json');
        if (fs.existsSync(builtinCatalogFile)) {
          const raw = fs.readFileSync(builtinCatalogFile, 'utf-8');
          const items = JSON.parse(raw);
          if (Array.isArray(items)) {
            for (const item of items) {
              if (item && item.indicatorId) {
                stmt.run(
                  item.indicatorId,
                  item.name || '',
                  item.category || '',
                  item.atomRef || '',
                  1,
                  JSON.stringify({ ...item, builtin: true }),
                  now,
                );
              }
            }
          }
        }
        const customIndFile = path.resolve(import.meta.dirname, '..', '..', 'data', 'custom-indicators.json');
        if (fs.existsSync(customIndFile)) {
          const raw = fs.readFileSync(customIndFile, 'utf-8');
          const items = JSON.parse(raw);
          if (Array.isArray(items)) {
            for (const item of items) {
              if (item && item.indicatorId) {
                stmt.run(
                  item.indicatorId,
                  item.name || '',
                  item.category || '',
                  item.atomRef || '',
                  0,
                  JSON.stringify({ ...item, builtin: false }),
                  now,
                );
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[sqlite-store] seed indicator_definitions failed:', err);
    }

    // 5. indicator_systems (presets + custom)
    try {
      const sysCount = Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM indicator_systems').get() as { c: number }).c,
      );
      if (sysCount === 0) {
        const stmt = this.db.prepare(
          `INSERT OR REPLACE INTO indicator_systems (
            system_id, name, version, is_builtin, tree_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        );
        const presetsDir = path.resolve(import.meta.dirname, '..', 'systems', 'presets');
        if (fs.existsSync(presetsDir)) {
          const files = fs.readdirSync(presetsDir).filter((f) => f.endsWith('.json')).sort();
          for (const f of files) {
            const parsed = JSON.parse(fs.readFileSync(path.join(presetsDir, f), 'utf-8'));
            if (parsed && parsed.systemId) {
              stmt.run(
                parsed.systemId,
                parsed.name || '',
                parsed.version || '1.0.0',
                1,
                JSON.stringify({ ...parsed, builtin: true }),
                now,
              );
            }
          }
        }
        const customSysFile = path.resolve(import.meta.dirname, '..', '..', 'data', 'custom-systems.json');
        if (fs.existsSync(customSysFile)) {
          const raw = fs.readFileSync(customSysFile, 'utf-8');
          const items = JSON.parse(raw);
          if (Array.isArray(items)) {
            for (const s of items) {
              if (s && s.systemId) {
                stmt.run(
                  s.systemId,
                  s.name || '',
                  s.version || '1.0.0',
                  0,
                  JSON.stringify({ ...s, builtin: false }),
                  now,
                );
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[sqlite-store] seed indicator_systems failed:', err);
    }
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

  // ─── 一库：自定义算子 (custom_operators) ───
  saveCustomOperator(def: CustomOperatorDefinition): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO custom_operators (
          id, name, category, mode, pipeline_category, output_type, unit, data_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        def.id,
        def.name,
        def.category,
        def.mode ?? 'formula_pipeline',
        def.pipelineCategory ?? null,
        def.outputType ?? 'score',
        def.unit ?? '',
        JSON.stringify(def),
        now,
      );
  }

  getCustomOperator(id: string): CustomOperatorDefinition | null {
    const row = this.db
      .prepare('SELECT data_json FROM custom_operators WHERE id = ?')
      .get(id) as { data_json: string } | undefined;
    if (!row?.data_json) return null;
    return JSON.parse(row.data_json) as CustomOperatorDefinition;
  }

  listCustomOperators(): CustomOperatorDefinition[] {
    const rows = this.db
      .prepare('SELECT data_json FROM custom_operators ORDER BY id ASC')
      .all() as Array<{ data_json: string }>;
    return rows.map((r) => JSON.parse(r.data_json) as CustomOperatorDefinition);
  }

  deleteCustomOperator(id: string): boolean {
    const info = this.db.prepare('DELETE FROM custom_operators WHERE id = ?').run(id);
    return info.changes > 0;
  }

  // ─── 一库：内置算子覆写 (operator_overrides) ───
  saveOperatorOverride(id: string, override: BuiltinOperatorOverride): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT OR REPLACE INTO operator_overrides (operator_id, data_json, updated_at) VALUES (?, ?, ?)',
      )
      .run(id, JSON.stringify(override), now);
  }

  getOperatorOverride(id: string): BuiltinOperatorOverride | null {
    const row = this.db
      .prepare('SELECT data_json FROM operator_overrides WHERE operator_id = ?')
      .get(id) as { data_json: string } | undefined;
    if (!row?.data_json) return null;
    return JSON.parse(row.data_json) as BuiltinOperatorOverride;
  }

  listOperatorOverrides(): Record<string, BuiltinOperatorOverride> {
    const rows = this.db
      .prepare('SELECT operator_id, data_json FROM operator_overrides ORDER BY operator_id ASC')
      .all() as Array<{ operator_id: string; data_json: string }>;
    const out: Record<string, BuiltinOperatorOverride> = {};
    for (const r of rows) {
      out[r.operator_id] = JSON.parse(r.data_json) as BuiltinOperatorOverride;
    }
    return out;
  }

  deleteOperatorOverride(id: string): boolean {
    const info = this.db.prepare('DELETE FROM operator_overrides WHERE operator_id = ?').run(id);
    return info.changes > 0;
  }

  // ─── 一库：算子专属 DAG 画布流水线 (operator_pipelines) ───
  saveOperatorPipeline(pipeline: {
    operatorId: string;
    pipelineTitle: string;
    nodes: any[];
    edges: any[];
    dataset?: any;
    updatedAt?: string;
  }): void {
    const now = pipeline.updatedAt || new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO operator_pipelines (
          operator_id, pipeline_title, nodes_json, edges_json, dataset_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pipeline.operatorId,
        pipeline.pipelineTitle,
        JSON.stringify(pipeline.nodes || []),
        JSON.stringify(pipeline.edges || []),
        pipeline.dataset ? JSON.stringify(pipeline.dataset) : null,
        now,
      );
  }

  getOperatorPipeline(operatorId: string): StoredOperatorPipeline | null {
    const row = this.db
      .prepare(
        'SELECT operator_id, pipeline_title, nodes_json, edges_json, dataset_json, updated_at FROM operator_pipelines WHERE operator_id = ?',
      )
      .get(operatorId) as
      | {
          operator_id: string;
          pipeline_title: string;
          nodes_json: string;
          edges_json: string;
          dataset_json: string | null;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      operatorId: row.operator_id,
      pipelineTitle: row.pipeline_title,
      nodes: JSON.parse(row.nodes_json),
      edges: JSON.parse(row.edges_json),
      dataset: row.dataset_json ? JSON.parse(row.dataset_json) : undefined,
      updatedAt: row.updated_at,
    };
  }

  listOperatorPipelines(): Record<string, StoredOperatorPipeline> {
    const rows = this.db
      .prepare(
        'SELECT operator_id, pipeline_title, nodes_json, edges_json, dataset_json, updated_at FROM operator_pipelines ORDER BY operator_id ASC',
      )
      .all() as Array<{
      operator_id: string;
      pipeline_title: string;
      nodes_json: string;
      edges_json: string;
      dataset_json: string | null;
      updated_at: string;
    }>;
    const out: Record<string, StoredOperatorPipeline> = {};
    for (const r of rows) {
      out[r.operator_id] = {
        operatorId: r.operator_id,
        pipelineTitle: r.pipeline_title,
        nodes: JSON.parse(r.nodes_json),
        edges: JSON.parse(r.edges_json),
        dataset: r.dataset_json ? JSON.parse(r.dataset_json) : undefined,
        updatedAt: r.updated_at,
      };
    }
    return out;
  }

  deleteOperatorPipeline(operatorId: string): boolean {
    const info = this.db.prepare('DELETE FROM operator_pipelines WHERE operator_id = ?').run(operatorId);
    return info.changes > 0;
  }

  // ─── 二库：指标库定义 (indicator_definitions) ───
  saveIndicator(def: IndicatorDefinition, isBuiltin = false): void {
    const now = new Date().toISOString();
    const payload = { ...def, builtin: isBuiltin };
    this.db
      .prepare(
        `INSERT OR REPLACE INTO indicator_definitions (
          id, name, category, atom_ref, is_builtin, data_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        def.indicatorId,
        def.name,
        (def as any).category || (def.tags && def.tags[0]) || '',
        def.atomRef,
        isBuiltin ? 1 : 0,
        JSON.stringify(payload),
        now,
      );
  }

  getIndicator(id: string): IndicatorDefinition | null {
    const row = this.db
      .prepare('SELECT data_json FROM indicator_definitions WHERE id = ?')
      .get(id) as { data_json: string } | undefined;
    if (!row?.data_json) return null;
    return JSON.parse(row.data_json) as IndicatorDefinition;
  }

  listIndicators(filter?: { builtinOnly?: boolean; customOnly?: boolean }): IndicatorDefinition[] {
    let sql = 'SELECT data_json FROM indicator_definitions';
    if (filter?.builtinOnly) {
      sql += ' WHERE is_builtin = 1';
    } else if (filter?.customOnly) {
      sql += ' WHERE is_builtin = 0';
    }
    sql += ' ORDER BY id ASC';
    const rows = this.db.prepare(sql).all() as Array<{ data_json: string }>;
    return rows.map((r) => JSON.parse(r.data_json) as IndicatorDefinition);
  }

  deleteIndicator(id: string): boolean {
    const info = this.db
      .prepare('DELETE FROM indicator_definitions WHERE id = ? AND is_builtin = 0')
      .run(id);
    return info.changes > 0;
  }

  // ─── 三库：评估体系树定义 (indicator_systems) ───
  saveSystem(system: IndicatorSystem, isBuiltin = false): void {
    const now = new Date().toISOString();
    const payload = { ...system, builtin: isBuiltin };
    this.db
      .prepare(
        `INSERT OR REPLACE INTO indicator_systems (
          system_id, name, version, is_builtin, tree_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        system.systemId,
        system.name,
        system.version,
        isBuiltin ? 1 : 0,
        JSON.stringify(payload),
        now,
      );
  }

  getSystem(systemId: string): IndicatorSystem | null {
    const row = this.db
      .prepare('SELECT tree_json FROM indicator_systems WHERE system_id = ?')
      .get(systemId) as { tree_json: string } | undefined;
    if (!row?.tree_json) return null;
    return JSON.parse(row.tree_json) as IndicatorSystem;
  }

  listSystems(filter?: { builtinOnly?: boolean; customOnly?: boolean }): IndicatorSystem[] {
    let sql = 'SELECT tree_json FROM indicator_systems';
    if (filter?.builtinOnly) {
      sql += ' WHERE is_builtin = 1';
    } else if (filter?.customOnly) {
      sql += ' WHERE is_builtin = 0';
    }
    sql += ' ORDER BY system_id ASC';
    const rows = this.db.prepare(sql).all() as Array<{ tree_json: string }>;
    return rows.map((r) => JSON.parse(r.tree_json) as IndicatorSystem);
  }

  deleteSystem(systemId: string): boolean {
    const info = this.db
      .prepare('DELETE FROM indicator_systems WHERE system_id = ? AND is_builtin = 0')
      .run(systemId);
    return info.changes > 0;
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
      customOperators: Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM custom_operators').get() as { c: number }).c,
      ),
      operatorOverrides: Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM operator_overrides').get() as { c: number }).c,
      ),
      operatorPipelines: Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM operator_pipelines').get() as { c: number }).c,
      ),
      indicators: Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM indicator_definitions').get() as { c: number }).c,
      ),
      systems: Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM indicator_systems').get() as { c: number }).c,
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
