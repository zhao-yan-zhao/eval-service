import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  BuiltinOperatorOverride,
  CustomOperatorDefinition,
  EffectDefinition,
  EvaluationDagOutput,
  EvaluationSystemDag,
  EvidenceRef,
  IndicatorDefinition,
  IndicatorSystem,
  MetricAtomMeta,
  MetricGraphDefinition,
  SituationContact,
  SituationModel,
  SituationUnit,
  StructuredSimEvent,
  SystemEvaluationOutput,
  TacticalFeedbackPayload,
  V4MetricSnapshotItem,
} from '../core/types.ts';
import { loadBuiltinEffectPresets } from '../effects/store.ts';
import { BUILTIN_METRIC_GRAPHS } from '../indicators/metric-graph-store.ts';
import { BUILTIN_COMPONENTS, type ComponentManifest } from '../operators/component-store.ts';
import { ALL_V4_OPERATOR_SCRIPTS } from '../operators/v4/index.ts';
import type { V4OperatorScriptSpec } from '../operators/v4/types.ts';
import { BUILTIN_SYSTEM_DAGS } from '../systems/system-dag-store.ts';

const DEFAULT_DB_PATH = path.resolve(import.meta.dirname, '..', '..', 'data', 'eval.db');
export const CURRENT_SCHEMA_VERSION = '4.0.0';

export interface V4ListFilter {
  builtinOnly?: boolean;
  customOnly?: boolean;
}

export type V4StoredOperator = V4OperatorScriptSpec & {
  isBuiltin?: boolean;
  updatedAt?: string;
};

export type V4StoredMetricGraph = MetricGraphDefinition & {
  version?: string;
  builtin?: boolean;
};

export type V4StoredSystemDag = EvaluationSystemDag & {
  builtin?: boolean;
  metricGraphId?: string;
  createdAt?: string;
  updatedAt?: string;
};

export interface V4SeedLibrariesPayload {
  operators?: V4StoredOperator[];
  effects?: EffectDefinition[];
  metricGraphs?: V4StoredMetricGraph[];
  systemDags?: V4StoredSystemDag[];
  components?: ComponentManifest[];
  overwriteExisting?: boolean;
}

export interface V4SeedLibrariesResult {
  skipped: boolean;
  inserted: {
    operators: number;
    effects: number;
    metricGraphs: number;
    systemDags: number;
    components: number;
  };
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

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

export interface ImportJobRecord {
  jobId: string;
  sourceId: string;
  sourceName?: string;
  jobType: 'archive' | 'sqlite_import' | 'delete_run';
  status: 'running' | 'paused' | 'interrupted' | 'completed' | 'failed' | 'cancelled';
  totalFiles: number;
  processedFiles: number;
  totalBytes: number;
  processedBytes: number;
  currentFile?: string;
  completedFiles: string[];
  totalEventsImported?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredV4EvalSideSummary {
  side: string;
  overallScore: number | null;
  rawOverallScore: number | null;
  gateVerdict: 'PASS' | 'WARNING' | 'DISQUALIFIED';
  availableWeightRatio: number;
}

export interface StoredV4EvalSummary {
  evalId: string;
  runId: string;
  dataSourceId?: string;
  systemId: string;
  systemName: string;
  systemVersion: string;
  metricGraphId?: string;
  sides: string[];
  overallScore: number | null;
  gateVerdict: 'PASS' | 'WARNING' | 'DISQUALIFIED';
  availableWeightRatio: number;
  sideSummaries: StoredV4EvalSideSummary[];
  createdAt: string;
}

export interface StoredV4EvalRecord extends StoredV4EvalSummary {
  overall: EvaluationDagOutput;
  bySide: Record<string, EvaluationDagOutput>;
  metricSnapshots?: V4MetricSnapshotItem[];
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
  private lastBackupPath: string | null = null;

  constructor(dbPath = DEFAULT_DB_PATH, options?: { autoSeed?: boolean }) {
    this.dbPath = dbPath;
    const existedOnDisk =
      dbPath !== ':memory:' && fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0;
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA busy_timeout = 10000;');
    this.backupLegacyDatabaseIfNeeded(existedOnDisk);
    this.initSchema();

    const currentSchemaVersion = this.getMeta('schema_version');
    if (
      !currentSchemaVersion ||
      compareSemver(currentSchemaVersion, CURRENT_SCHEMA_VERSION) < 0
    ) {
      this.setMeta('schema_version', CURRENT_SCHEMA_VERSION);
    }

    // 如果库已标记为全新空白库（is_blank=1）或已完成初始化（is_initialized=1），绝不自动写入预置数据
    const isBlank = this.getMeta('is_blank') === '1';
    const isInitialized = this.getMeta('is_initialized') === '1';
    if (!isBlank && !isInitialized && options?.autoSeed !== false) {
      this.seedThreeLibraries();
    }
  }

  getSchemaVersion(): string | null {
    return this.getMeta('schema_version');
  }

  getLastBackupPath(): string | null {
    return this.lastBackupPath;
  }

  private safeTableCount(sql: string): number {
    try {
      const row = this.db.prepare(sql).get() as { c?: number } | undefined;
      return Number(row?.c ?? 0);
    } catch {
      return 0;
    }
  }

  private hasLegacyV2Data(): boolean {
    return (
      this.safeTableCount('SELECT COUNT(*) AS c FROM custom_operators') > 0 ||
      this.safeTableCount('SELECT COUNT(*) AS c FROM operator_overrides') > 0 ||
      this.safeTableCount('SELECT COUNT(*) AS c FROM indicator_definitions WHERE is_builtin = 0') > 0 ||
      this.safeTableCount('SELECT COUNT(*) AS c FROM indicator_systems WHERE is_builtin = 0') > 0 ||
      this.safeTableCount('SELECT COUNT(*) AS c FROM eval_results') > 0
    );
  }

  private backupLegacyDatabaseIfNeeded(existedOnDisk: boolean): void {
    if (!existedOnDisk || this.dbPath === ':memory:') return;
    const currentVer = this.getMeta('schema_version');
    if (currentVer && compareSemver(currentVer, CURRENT_SCHEMA_VERSION) >= 0) {
      return;
    }
    if (!this.hasLegacyV2Data()) {
      return;
    }
    try {
      this.checkpoint();
      const now = new Date();
      const pad = (n: number, len = 2) => String(n).padStart(len, '0');
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
      const backupPath = `${this.dbPath}.v2-backup-${stamp}.bak`;
      fs.copyFileSync(this.dbPath, backupPath);
      this.lastBackupPath = backupPath;
    } catch (err) {
      console.warn('[sqlite-store] auto-backup legacy V2 database failed:', err);
    }
  }

  getMeta(key: string): string | null {
    try {
      const row = this.db
        .prepare('SELECT value FROM store_meta WHERE key = ?')
        .get(key) as { value: string } | undefined;
      return row ? row.value : null;
    } catch {
      return null;
    }
  }

  setMeta(key: string, value: string): void {
    try {
      this.db
        .prepare('INSERT OR REPLACE INTO store_meta (key, value) VALUES (?, ?)')
        .run(key, value);
    } catch {
      // 容错处理
    }
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

      CREATE TABLE IF NOT EXISTS operator_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        mode TEXT NOT NULL,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        pipeline_category TEXT,
        output_type TEXT NOT NULL,
        unit TEXT NOT NULL,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_operators_builtin ON operator_definitions (is_builtin);
      CREATE INDEX IF NOT EXISTS idx_operators_category ON operator_definitions (category);

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

      CREATE TABLE IF NOT EXISTS store_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS v4_eval_results (
        eval_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        data_source_id TEXT,
        system_id TEXT NOT NULL,
        system_name TEXT NOT NULL,
        system_version TEXT NOT NULL DEFAULT '1.0.0',
        metric_graph_id TEXT,
        sides_json TEXT NOT NULL,
        overall_score REAL,
        gate_verdict TEXT NOT NULL DEFAULT 'PASS',
        available_weight_ratio REAL NOT NULL DEFAULT 0,
        side_summaries_json TEXT NOT NULL,
        overall_json TEXT NOT NULL,
        by_side_json TEXT NOT NULL,
        metric_snapshots_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_v4_eval_results_run_created
        ON v4_eval_results (run_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS v4_operators (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        chapter INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL,
        military_level TEXT NOT NULL,
        domain_tag TEXT NOT NULL,
        layer TEXT NOT NULL DEFAULT 'fact',
        engine_kind TEXT NOT NULL DEFAULT 'python_script',
        is_builtin INTEGER NOT NULL DEFAULT 0,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_v4_operators_builtin ON v4_operators (is_builtin);
      CREATE INDEX IF NOT EXISTS idx_v4_operators_domain ON v4_operators (domain_tag);
      CREATE INDEX IF NOT EXISTS idx_v4_operators_layer ON v4_operators (layer);

      CREATE TABLE IF NOT EXISTS v4_effects (
        effect_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        gate_mode TEXT,
        domain_tag TEXT,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_v4_effects_builtin ON v4_effects (is_builtin);
      CREATE INDEX IF NOT EXISTS idx_v4_effects_role ON v4_effects (role);

      CREATE TABLE IF NOT EXISTS v4_metric_graphs (
        graph_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '1.0.0',
        is_builtin INTEGER NOT NULL DEFAULT 0,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_v4_metric_graphs_builtin ON v4_metric_graphs (is_builtin);

      CREATE TABLE IF NOT EXISTS v4_system_dags (
        system_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '1.0.0',
        metric_graph_id TEXT,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_v4_system_dags_builtin ON v4_system_dags (is_builtin);

      CREATE TABLE IF NOT EXISTS v4_components (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        engine_type TEXT NOT NULL DEFAULT 'builtin',
        is_builtin INTEGER NOT NULL DEFAULT 0,
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_v4_components_builtin ON v4_components (is_builtin);

      CREATE TABLE IF NOT EXISTS import_jobs (
        job_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_name TEXT,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL,
        total_files INTEGER NOT NULL DEFAULT 0,
        processed_files INTEGER NOT NULL DEFAULT 0,
        total_bytes INTEGER NOT NULL DEFAULT 0,
        processed_bytes INTEGER NOT NULL DEFAULT 0,
        current_file TEXT,
        completed_files_json TEXT NOT NULL DEFAULT '[]',
        total_events_imported INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_import_jobs_source ON import_jobs (source_id, updated_at DESC);
    `);

    try {
      this.db.exec('ALTER TABLE v4_eval_results ADD COLUMN metric_snapshots_json TEXT');
    } catch {
      // 列已存在时静默跳过
    }

    // 服务重启恢复：将异常中止的 running 任务自动标记为 interrupted，保留断点信息供继续
    try {
      this.markRunningJobsInterrupted();
    } catch {
      // 忽略首次建表或只读容错
    }
  }

  seedThreeLibraries(): void {
    if (this.getMeta('is_blank') === '1') {
      return;
    }

    const now = new Date().toISOString();
    const dataDir = path.resolve(import.meta.dirname, '..', '..', 'data');

    // 1. V4 一库算子 (v4_operators: 全部内置 V4 算子)
    try {
      if (this.countV4Operators() === 0) {
        for (const op of ALL_V4_OPERATOR_SCRIPTS) {
          if (op?.id) {
            this.upsertV4Operator({ ...op, isBuiltin: true, updatedAt: now }, true);
          }
        }
      }
    } catch (err) {
      console.warn('[sqlite-store] seed v4_operators failed:', err);
    }

    // 2. V4 一库算子画布流水线 (operator_pipelines)
    try {
      const pipelineCount = Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM operator_pipelines').get() as { c: number }).c,
      );
      const pipelinesFile = path.join(dataDir, 'operator-pipelines.json');
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

    // 3. V4 效果库 (v4_effects: 内置预设 + 可选自定义导入)
    try {
      if (this.countV4Effects() === 0) {
        for (const preset of loadBuiltinEffectPresets()) {
          if (preset?.effectId) {
            this.upsertV4Effect({ ...preset, isBuiltin: true }, true);
          }
        }
        const customEffectsFile = path.join(dataDir, 'custom-effects.json');
        if (fs.existsSync(customEffectsFile)) {
          const items = JSON.parse(fs.readFileSync(customEffectsFile, 'utf-8'));
          if (Array.isArray(items)) {
            for (const item of items) {
              if (item?.effectId && item.effectId !== 'eff_test_metric') {
                this.upsertV4Effect({ ...item, isBuiltin: false }, false);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[sqlite-store] seed v4_effects failed:', err);
    }

    // 4. V4 二库指标图 (v4_metric_graphs: 内置示范图 + 可选自定义导入)
    try {
      if (this.countV4MetricGraphs() === 0) {
        for (const graph of BUILTIN_METRIC_GRAPHS) {
          if (graph?.graphId) {
            this.upsertV4MetricGraph({ ...graph, builtin: true }, true);
          }
        }
        const customGraphsFile = path.join(dataDir, 'v4-metric-graphs.json');
        if (fs.existsSync(customGraphsFile)) {
          const items = JSON.parse(fs.readFileSync(customGraphsFile, 'utf-8'));
          if (Array.isArray(items)) {
            for (const item of items) {
              if (item?.graphId && item.graphId !== 'mg_test_cockpit') {
                this.upsertV4MetricGraph({ ...item, builtin: false }, false);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[sqlite-store] seed v4_metric_graphs failed:', err);
    }

    // 5. V4 三库评估体系 DAG (v4_system_dags: 内置示范体系 + 可选自定义导入)
    try {
      if (this.countV4SystemDags() === 0) {
        for (const dag of BUILTIN_SYSTEM_DAGS) {
          if (dag?.systemId) {
            this.upsertV4SystemDag({ ...dag, builtin: true }, true);
          }
        }
        const customDagsFile = path.join(dataDir, 'v4-system-dags.json');
        if (fs.existsSync(customDagsFile)) {
          const items = JSON.parse(fs.readFileSync(customDagsFile, 'utf-8'));
          if (Array.isArray(items)) {
            for (const item of items) {
              if (item?.systemId) {
                this.upsertV4SystemDag({ ...item, builtin: false }, false);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[sqlite-store] seed v4_system_dags failed:', err);
    }

    // 6. V4 画布组件库 (v4_components: 内置核心组件 + 可选自定义导入)
    try {
      if (this.countV4Components() === 0) {
        for (const comp of BUILTIN_COMPONENTS) {
          if (comp?.id) {
            this.upsertV4Component({ ...comp, isBuiltin: true, isCustom: false }, true);
          }
        }
        const customCompFile = path.join(dataDir, 'custom-components.json');
        if (fs.existsSync(customCompFile)) {
          const items = JSON.parse(fs.readFileSync(customCompFile, 'utf-8'));
          if (Array.isArray(items)) {
            for (const item of items) {
              if (item?.id && !BUILTIN_COMPONENTS.some((b) => b.id === item.id)) {
                this.upsertV4Component({ ...item, isBuiltin: false, isCustom: true }, false);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[sqlite-store] seed v4_components failed:', err);
    }

    try {
      this.setMeta('schema_version', CURRENT_SCHEMA_VERSION);
      this.setMeta('is_initialized', '1');
      this.setMeta('is_seeded', '1');
      this.setMeta('is_blank', '0');
    } catch {
      // 容错处理
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

  deleteRun(runId: string, onProgress?: (stage: string, step: number, totalSteps: number) => void): boolean {
    let deleted = false;
    const totalSteps = 5;
    onProgress?.('清理评估快照与研判卡片', 1, totalSteps);
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM eval_results WHERE run_id = ?').run(runId);
      this.db.prepare('DELETE FROM v4_eval_results WHERE run_id = ?').run(runId);
      this.db.prepare('DELETE FROM realtime_cards WHERE run_id = ?').run(runId);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    onProgress?.('清理作战单元时空航迹 (unit_states)', 2, totalSteps);
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM unit_states WHERE run_id = ?').run(runId);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    onProgress?.('清理仿真事件链 (simulation_events)', 3, totalSteps);
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM simulation_events WHERE run_id = ?').run(runId);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    onProgress?.('移除场次元数据 (simulation_runs)', 4, totalSteps);
    this.db.exec('BEGIN');
    try {
      const res = this.db.prepare('DELETE FROM simulation_runs WHERE run_id = ?').run(runId);
      deleted = Number(res.changes ?? 0) > 0;
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    if (deleted) {
      onProgress?.('压缩数据库空间 (VACUUM)', 5, totalSteps);
      try {
        this.db.exec('VACUUM');
      } catch {
        // 忽略 VACUUM 占用容错
      }
    }
    return deleted;
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

  saveV4Evaluation(record: StoredV4EvalRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO v4_eval_results (
          eval_id, run_id, data_source_id, system_id, system_name, system_version,
          metric_graph_id, sides_json, overall_score, gate_verdict,
          available_weight_ratio, side_summaries_json, overall_json, by_side_json,
          metric_snapshots_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.evalId,
        record.runId,
        record.dataSourceId ?? null,
        record.systemId,
        record.systemName,
        record.systemVersion || '1.0.0',
        record.metricGraphId ?? null,
        JSON.stringify(record.sides),
        record.overallScore,
        record.gateVerdict,
        record.availableWeightRatio,
        JSON.stringify(record.sideSummaries),
        JSON.stringify(record.overall),
        JSON.stringify(record.bySide),
        record.metricSnapshots ? JSON.stringify(record.metricSnapshots) : null,
        record.createdAt,
      );
  }

  listV4Evaluations(runId?: string, limit = 50): StoredV4EvalSummary[] {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const rows = (
      runId
        ? this.db
            .prepare(
              `SELECT eval_id, run_id, data_source_id, system_id, system_name, system_version,
                      metric_graph_id, sides_json, overall_score, gate_verdict,
                      available_weight_ratio, side_summaries_json, created_at
               FROM v4_eval_results
               WHERE run_id = ?
               ORDER BY created_at DESC
               LIMIT ?`,
            )
            .all(runId, safeLimit)
        : this.db
            .prepare(
              `SELECT eval_id, run_id, data_source_id, system_id, system_name, system_version,
                      metric_graph_id, sides_json, overall_score, gate_verdict,
                      available_weight_ratio, side_summaries_json, created_at
               FROM v4_eval_results
               ORDER BY created_at DESC
               LIMIT ?`,
            )
            .all(safeLimit)
    ) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      evalId: String(r.eval_id),
      runId: String(r.run_id),
      dataSourceId: r.data_source_id ? String(r.data_source_id) : undefined,
      systemId: String(r.system_id),
      systemName: String(r.system_name),
      systemVersion: String(r.system_version || '1.0.0'),
      metricGraphId: r.metric_graph_id ? String(r.metric_graph_id) : undefined,
      sides: JSON.parse(String(r.sides_json || '[]')) as string[],
      overallScore: r.overall_score !== null && r.overall_score !== undefined ? Number(r.overall_score) : null,
      gateVerdict: (String(r.gate_verdict || 'PASS') as StoredV4EvalSummary['gateVerdict']),
      availableWeightRatio: Number(r.available_weight_ratio ?? 0),
      sideSummaries: JSON.parse(String(r.side_summaries_json || '[]')) as StoredV4EvalSideSummary[],
      createdAt: String(r.created_at),
    }));
  }

  getV4Evaluation(evalId: string): StoredV4EvalRecord | null {
    const r = this.db
      .prepare(
        `SELECT eval_id, run_id, data_source_id, system_id, system_name, system_version,
                metric_graph_id, sides_json, overall_score, gate_verdict,
                available_weight_ratio, side_summaries_json, overall_json, by_side_json,
                metric_snapshots_json, created_at
         FROM v4_eval_results WHERE eval_id = ?`,
      )
      .get(evalId) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      evalId: String(r.eval_id),
      runId: String(r.run_id),
      dataSourceId: r.data_source_id ? String(r.data_source_id) : undefined,
      systemId: String(r.system_id),
      systemName: String(r.system_name),
      systemVersion: String(r.system_version || '1.0.0'),
      metricGraphId: r.metric_graph_id ? String(r.metric_graph_id) : undefined,
      sides: JSON.parse(String(r.sides_json || '[]')) as string[],
      overallScore: r.overall_score !== null && r.overall_score !== undefined ? Number(r.overall_score) : null,
      gateVerdict: (String(r.gate_verdict || 'PASS') as StoredV4EvalSummary['gateVerdict']),
      availableWeightRatio: Number(r.available_weight_ratio ?? 0),
      sideSummaries: JSON.parse(String(r.side_summaries_json || '[]')) as StoredV4EvalSideSummary[],
      overall: JSON.parse(String(r.overall_json || '{}')) as EvaluationDagOutput,
      bySide: JSON.parse(String(r.by_side_json || '{}')) as Record<string, EvaluationDagOutput>,
      ...(r.metric_snapshots_json
        ? { metricSnapshots: JSON.parse(String(r.metric_snapshots_json)) as V4MetricSnapshotItem[] }
        : {}),
      createdAt: String(r.created_at),
    };
  }

  deleteV4Evaluation(evalId: string): boolean {
    const info = this.db.prepare('DELETE FROM v4_eval_results WHERE eval_id = ?').run(evalId);
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

  // ─── 一库：算子库统一存储 (operator_definitions: 36 内置 + 自定义) ───
  listOperatorDefinitions(filter?: { builtinOnly?: boolean; customOnly?: boolean }): MetricAtomMeta[] {
    let sql = 'SELECT data_json FROM operator_definitions';
    if (filter?.builtinOnly) {
      sql += ' WHERE is_builtin = 1';
    } else if (filter?.customOnly) {
      sql += ' WHERE is_builtin = 0';
    }
    sql += ' ORDER BY id ASC';
    const rows = this.db.prepare(sql).all() as Array<{ data_json: string }>;
    return rows.map((r) => JSON.parse(r.data_json) as MetricAtomMeta);
  }

  getOperatorDefinition(id: string): MetricAtomMeta | null {
    const row = this.db
      .prepare('SELECT data_json FROM operator_definitions WHERE id = ?')
      .get(id) as { data_json: string } | undefined;
    if (!row?.data_json) return null;
    return JSON.parse(row.data_json) as MetricAtomMeta;
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

    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO operator_definitions (
            id, name, category, mode, is_builtin, pipeline_category, output_type, unit, data_json, updated_at
          ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
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
    } catch {
      // 容错处理
    }
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
    try {
      this.db.prepare('DELETE FROM operator_definitions WHERE id = ? AND is_builtin = 0').run(id);
    } catch {
      // 容错处理
    }
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

  // ─── V4 一库：V4 算子库 (v4_operators) ───
  listV4Operators(
    filter?: V4ListFilter & { domainTag?: string; layer?: string },
  ): V4StoredOperator[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter?.builtinOnly) {
      where.push('is_builtin = 1');
    } else if (filter?.customOnly) {
      where.push('is_builtin = 0');
    }
    if (filter?.domainTag) {
      where.push('domain_tag = ?');
      params.push(filter.domainTag);
    }
    if (filter?.layer) {
      where.push('layer = ?');
      params.push(filter.layer);
    }
    const sql =
      'SELECT data_json FROM v4_operators' +
      (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY chapter ASC, id ASC';
    const rows = this.db.prepare(sql).all(...params) as Array<{ data_json: string }>;
    return rows.map((r) => JSON.parse(r.data_json) as V4StoredOperator);
  }

  getV4Operator(id: string): V4StoredOperator | null {
    const row = this.db
      .prepare('SELECT data_json FROM v4_operators WHERE id = ?')
      .get(id) as { data_json: string } | undefined;
    if (!row?.data_json) return null;
    return JSON.parse(row.data_json) as V4StoredOperator;
  }

  upsertV4Operator(spec: V4StoredOperator, isBuiltin?: boolean): void {
    const now = spec.updatedAt ?? new Date().toISOString();
    const builtinFlag = isBuiltin ?? Boolean(spec.isBuiltin);
    const payload: V4StoredOperator = {
      ...spec,
      layer: spec.layer ?? 'fact',
      engineKind: spec.engineKind ?? 'python_script',
      isBuiltin: builtinFlag,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT OR REPLACE INTO v4_operators (
          id, name, chapter, category, military_level, domain_tag,
          layer, engine_kind, is_builtin, data_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        payload.id,
        payload.name,
        Number(payload.chapter ?? 0),
        payload.category,
        payload.militaryLevel,
        payload.domainTag,
        payload.layer ?? 'fact',
        payload.engineKind ?? 'python_script',
        builtinFlag ? 1 : 0,
        JSON.stringify(payload),
        now,
      );
  }

  deleteV4Operator(id: string, opts?: { allowBuiltin?: boolean }): boolean {
    const sql = opts?.allowBuiltin
      ? 'DELETE FROM v4_operators WHERE id = ?'
      : 'DELETE FROM v4_operators WHERE id = ? AND is_builtin = 0';
    const info = this.db.prepare(sql).run(id);
    return info.changes > 0;
  }

  countV4Operators(filter?: V4ListFilter): number {
    let sql = 'SELECT COUNT(*) AS c FROM v4_operators';
    if (filter?.builtinOnly) sql += ' WHERE is_builtin = 1';
    else if (filter?.customOnly) sql += ' WHERE is_builtin = 0';
    return Number((this.db.prepare(sql).get() as { c: number }).c);
  }

  // ─── V4 效果库 (v4_effects) ───
  listV4Effects(filter?: V4ListFilter & { role?: 'effect' | 'gate' }): EffectDefinition[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter?.builtinOnly) {
      where.push('is_builtin = 1');
    } else if (filter?.customOnly) {
      where.push('is_builtin = 0');
    }
    if (filter?.role) {
      where.push('role = ?');
      params.push(filter.role);
    }
    const sql =
      'SELECT data_json FROM v4_effects' +
      (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY effect_id ASC';
    const rows = this.db.prepare(sql).all(...params) as Array<{ data_json: string }>;
    return rows.map((r) => JSON.parse(r.data_json) as EffectDefinition);
  }

  getV4Effect(effectId: string): EffectDefinition | null {
    const row = this.db
      .prepare('SELECT data_json FROM v4_effects WHERE effect_id = ?')
      .get(effectId) as { data_json: string } | undefined;
    if (!row?.data_json) return null;
    return JSON.parse(row.data_json) as EffectDefinition;
  }

  upsertV4Effect(def: EffectDefinition, isBuiltin?: boolean): void {
    const now = new Date().toISOString();
    const builtinFlag = isBuiltin ?? Boolean(def.isBuiltin);
    const payload: EffectDefinition = { ...def, isBuiltin: builtinFlag };
    this.db
      .prepare(
        `INSERT OR REPLACE INTO v4_effects (
          effect_id, name, role, gate_mode, domain_tag, is_builtin, data_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        payload.effectId,
        payload.name,
        payload.role,
        payload.gateMode ?? null,
        payload.domainTag ?? null,
        builtinFlag ? 1 : 0,
        JSON.stringify(payload),
        now,
      );
  }

  deleteV4Effect(effectId: string, opts?: { allowBuiltin?: boolean }): boolean {
    const sql = opts?.allowBuiltin
      ? 'DELETE FROM v4_effects WHERE effect_id = ?'
      : 'DELETE FROM v4_effects WHERE effect_id = ? AND is_builtin = 0';
    const info = this.db.prepare(sql).run(effectId);
    return info.changes > 0;
  }

  countV4Effects(filter?: V4ListFilter): number {
    let sql = 'SELECT COUNT(*) AS c FROM v4_effects';
    if (filter?.builtinOnly) sql += ' WHERE is_builtin = 1';
    else if (filter?.customOnly) sql += ' WHERE is_builtin = 0';
    return Number((this.db.prepare(sql).get() as { c: number }).c);
  }

  // ─── V4 二库：指标图 (v4_metric_graphs) ───
  listV4MetricGraphs(filter?: V4ListFilter): V4StoredMetricGraph[] {
    let sql = 'SELECT data_json FROM v4_metric_graphs';
    if (filter?.builtinOnly) sql += ' WHERE is_builtin = 1';
    else if (filter?.customOnly) sql += ' WHERE is_builtin = 0';
    sql += ' ORDER BY graph_id ASC';
    const rows = this.db.prepare(sql).all() as Array<{ data_json: string }>;
    return rows.map((r) => JSON.parse(r.data_json) as V4StoredMetricGraph);
  }

  getV4MetricGraph(graphId: string): V4StoredMetricGraph | null {
    const row = this.db
      .prepare('SELECT data_json FROM v4_metric_graphs WHERE graph_id = ?')
      .get(graphId) as { data_json: string } | undefined;
    if (!row?.data_json) return null;
    return JSON.parse(row.data_json) as V4StoredMetricGraph;
  }

  upsertV4MetricGraph(graph: V4StoredMetricGraph, isBuiltin?: boolean): void {
    const now = new Date().toISOString();
    const builtinFlag = isBuiltin ?? Boolean(graph.builtin);
    const createdAt = graph.createdAt ?? now;
    const updatedAt = graph.updatedAt ?? now;
    const payload: V4StoredMetricGraph = {
      ...graph,
      graphKind: 'metric',
      builtin: builtinFlag,
      createdAt,
      updatedAt,
    };
    this.db
      .prepare(
        `INSERT OR REPLACE INTO v4_metric_graphs (
          graph_id, name, version, is_builtin, data_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        payload.graphId,
        payload.name,
        payload.version ?? '1.0.0',
        builtinFlag ? 1 : 0,
        JSON.stringify(payload),
        createdAt,
        updatedAt,
      );
  }

  deleteV4MetricGraph(graphId: string, opts?: { allowBuiltin?: boolean }): boolean {
    const sql = opts?.allowBuiltin
      ? 'DELETE FROM v4_metric_graphs WHERE graph_id = ?'
      : 'DELETE FROM v4_metric_graphs WHERE graph_id = ? AND is_builtin = 0';
    const info = this.db.prepare(sql).run(graphId);
    return info.changes > 0;
  }

  countV4MetricGraphs(filter?: V4ListFilter): number {
    let sql = 'SELECT COUNT(*) AS c FROM v4_metric_graphs';
    if (filter?.builtinOnly) sql += ' WHERE is_builtin = 1';
    else if (filter?.customOnly) sql += ' WHERE is_builtin = 0';
    return Number((this.db.prepare(sql).get() as { c: number }).c);
  }

  // ─── V4 三库：评估体系 DAG (v4_system_dags) ───
  listV4SystemDags(filter?: V4ListFilter): V4StoredSystemDag[] {
    let sql = 'SELECT data_json FROM v4_system_dags';
    if (filter?.builtinOnly) sql += ' WHERE is_builtin = 1';
    else if (filter?.customOnly) sql += ' WHERE is_builtin = 0';
    sql += ' ORDER BY system_id ASC';
    const rows = this.db.prepare(sql).all() as Array<{ data_json: string }>;
    return rows.map((r) => JSON.parse(r.data_json) as V4StoredSystemDag);
  }

  getV4SystemDag(systemId: string): V4StoredSystemDag | null {
    const row = this.db
      .prepare('SELECT data_json FROM v4_system_dags WHERE system_id = ?')
      .get(systemId) as { data_json: string } | undefined;
    if (!row?.data_json) return null;
    return JSON.parse(row.data_json) as V4StoredSystemDag;
  }

  upsertV4SystemDag(dag: V4StoredSystemDag, isBuiltin?: boolean): void {
    const now = new Date().toISOString();
    const builtinFlag = isBuiltin ?? Boolean(dag.builtin);
    const createdAt = dag.createdAt ?? now;
    const updatedAt = dag.updatedAt ?? now;
    const payload: V4StoredSystemDag = {
      ...dag,
      builtin: builtinFlag,
      createdAt,
      updatedAt,
    };
    this.db
      .prepare(
        `INSERT OR REPLACE INTO v4_system_dags (
          system_id, name, version, metric_graph_id, is_builtin, data_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        payload.systemId,
        payload.name,
        payload.version ?? '1.0.0',
        payload.metricGraphId ?? null,
        builtinFlag ? 1 : 0,
        JSON.stringify(payload),
        createdAt,
        updatedAt,
      );
  }

  deleteV4SystemDag(systemId: string, opts?: { allowBuiltin?: boolean }): boolean {
    const sql = opts?.allowBuiltin
      ? 'DELETE FROM v4_system_dags WHERE system_id = ?'
      : 'DELETE FROM v4_system_dags WHERE system_id = ? AND is_builtin = 0';
    const info = this.db.prepare(sql).run(systemId);
    return info.changes > 0;
  }

  countV4SystemDags(filter?: V4ListFilter): number {
    let sql = 'SELECT COUNT(*) AS c FROM v4_system_dags';
    if (filter?.builtinOnly) sql += ' WHERE is_builtin = 1';
    else if (filter?.customOnly) sql += ' WHERE is_builtin = 0';
    return Number((this.db.prepare(sql).get() as { c: number }).c);
  }

  // ─── V4 画布组件库 (v4_components) ───
  listV4Components(filter?: V4ListFilter): ComponentManifest[] {
    let sql = 'SELECT data_json FROM v4_components';
    if (filter?.builtinOnly) sql += ' WHERE is_builtin = 1';
    else if (filter?.customOnly) sql += ' WHERE is_builtin = 0';
    sql += ' ORDER BY id ASC';
    const rows = this.db.prepare(sql).all() as Array<{ data_json: string }>;
    return rows.map((r) => JSON.parse(r.data_json) as ComponentManifest);
  }

  getV4Component(id: string): ComponentManifest | null {
    const row = this.db
      .prepare('SELECT data_json FROM v4_components WHERE id = ?')
      .get(id) as { data_json: string } | undefined;
    if (!row?.data_json) return null;
    return JSON.parse(row.data_json) as ComponentManifest;
  }

  upsertV4Component(manifest: ComponentManifest, isBuiltin?: boolean): void {
    const now = new Date().toISOString();
    const builtinFlag = isBuiltin ?? Boolean(manifest.isBuiltin);
    const payload: ComponentManifest = {
      ...manifest,
      isBuiltin: builtinFlag,
      isCustom: !builtinFlag,
    };
    this.db
      .prepare(
        `INSERT OR REPLACE INTO v4_components (
          id, name, category, engine_type, is_builtin, data_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        payload.id,
        payload.name,
        payload.category ?? 'custom',
        payload.engineType ?? 'builtin',
        builtinFlag ? 1 : 0,
        JSON.stringify(payload),
        now,
      );
  }

  deleteV4Component(id: string, opts?: { allowBuiltin?: boolean }): boolean {
    const sql = opts?.allowBuiltin
      ? 'DELETE FROM v4_components WHERE id = ?'
      : 'DELETE FROM v4_components WHERE id = ? AND is_builtin = 0';
    const info = this.db.prepare(sql).run(id);
    return info.changes > 0;
  }

  countV4Components(filter?: V4ListFilter): number {
    let sql = 'SELECT COUNT(*) AS c FROM v4_components';
    if (filter?.builtinOnly) sql += ' WHERE is_builtin = 1';
    else if (filter?.customOnly) sql += ' WHERE is_builtin = 0';
    return Number((this.db.prepare(sql).get() as { c: number }).c);
  }

  // ─── V4 三库统一种子装载（严格尊重 is_blank=1 空白库隔离） ───
  seedV4Libraries(payload: V4SeedLibrariesPayload): V4SeedLibrariesResult {
    const inserted = {
      operators: 0,
      effects: 0,
      metricGraphs: 0,
      systemDags: 0,
      components: 0,
    };
    if (this.getMeta('is_blank') === '1') {
      return { skipped: true, inserted };
    }

    const overwrite = Boolean(payload.overwriteExisting);
    this.db.exec('BEGIN');
    try {
      if (payload.operators?.length && (overwrite || this.countV4Operators() === 0)) {
        for (const op of payload.operators) {
          if (op?.id) {
            this.upsertV4Operator(op, op.isBuiltin ?? true);
            inserted.operators += 1;
          }
        }
      }
      if (payload.effects?.length && (overwrite || this.countV4Effects() === 0)) {
        for (const eff of payload.effects) {
          if (eff?.effectId) {
            this.upsertV4Effect(eff, eff.isBuiltin ?? true);
            inserted.effects += 1;
          }
        }
      }
      if (payload.metricGraphs?.length && (overwrite || this.countV4MetricGraphs() === 0)) {
        for (const graph of payload.metricGraphs) {
          if (graph?.graphId) {
            this.upsertV4MetricGraph(graph, graph.builtin ?? true);
            inserted.metricGraphs += 1;
          }
        }
      }
      if (payload.systemDags?.length && (overwrite || this.countV4SystemDags() === 0)) {
        for (const dag of payload.systemDags) {
          if (dag?.systemId) {
            this.upsertV4SystemDag(dag, dag.builtin ?? true);
            inserted.systemDags += 1;
          }
        }
      }
      if (payload.components?.length && (overwrite || this.countV4Components() === 0)) {
        for (const comp of payload.components) {
          if (comp?.id) {
            this.upsertV4Component(comp, comp.isBuiltin ?? true);
            inserted.components += 1;
          }
        }
      }
      this.setMeta('schema_version', CURRENT_SCHEMA_VERSION);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    return { skipped: false, inserted };
  }

  // ─────────────────────────────────────────────────────────────
  // 断点续传任务状态表 (import_jobs) 与分批增量入库
  // ─────────────────────────────────────────────────────────────

  markRunningJobsInterrupted(): number {
    const now = new Date().toISOString();
    const res = this.db
      .prepare(
        `UPDATE import_jobs
         SET status = 'interrupted',
             error = COALESCE(error, '服务重启或意外中断，支持从断点继续'),
             updated_at = ?
         WHERE status = 'running'`,
      )
      .run(now);
    return Number(res.changes ?? 0);
  }

  upsertImportJob(job: ImportJobRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO import_jobs (
          job_id, source_id, source_name, job_type, status,
          total_files, processed_files, total_bytes, processed_bytes,
          current_file, completed_files_json, total_events_imported,
          error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        job.jobId,
        job.sourceId,
        job.sourceName ?? null,
        job.jobType,
        job.status,
        job.totalFiles,
        job.processedFiles,
        job.totalBytes,
        job.processedBytes,
        job.currentFile ?? null,
        JSON.stringify(job.completedFiles ?? []),
        job.totalEventsImported ?? 0,
        job.error ?? null,
        job.createdAt,
        job.updatedAt,
      );
  }

  private mapImportJobRow(row: Record<string, unknown>): ImportJobRecord {
    let completedFiles: string[] = [];
    try {
      completedFiles = JSON.parse(String(row.completed_files_json || '[]'));
    } catch {
      completedFiles = [];
    }
    return {
      jobId: String(row.job_id),
      sourceId: String(row.source_id),
      sourceName: row.source_name ? String(row.source_name) : undefined,
      jobType: String(row.job_type) as ImportJobRecord['jobType'],
      status: String(row.status) as ImportJobRecord['status'],
      totalFiles: Number(row.total_files ?? 0),
      processedFiles: Number(row.processed_files ?? 0),
      totalBytes: Number(row.total_bytes ?? 0),
      processedBytes: Number(row.processed_bytes ?? 0),
      currentFile: row.current_file ? String(row.current_file) : undefined,
      completedFiles: Array.isArray(completedFiles) ? completedFiles : [],
      totalEventsImported: Number(row.total_events_imported ?? 0),
      error: row.error ? String(row.error) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  getImportJob(jobId: string): ImportJobRecord | null {
    const row = this.db
      .prepare('SELECT * FROM import_jobs WHERE job_id = ?')
      .get(jobId) as Record<string, unknown> | undefined;
    return row ? this.mapImportJobRow(row) : null;
  }

  listImportJobs(limit = 50): ImportJobRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM import_jobs ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapImportJobRow(r));
  }

  deleteImportJob(jobId: string): boolean {
    const res = this.db.prepare('DELETE FROM import_jobs WHERE job_id = ?').run(jobId);
    return Number(res.changes ?? 0) > 0;
  }

  clearSituationRunData(runId: string): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM simulation_events WHERE run_id = ?').run(runId);
      this.db.prepare('DELETE FROM unit_states WHERE run_id = ?').run(runId);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  saveSituationRunMetadata(model: SituationModel): void {
    const now = new Date().toISOString();
    const snapshot = serializeSituationSnapshot(model);
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
  }

  appendSituationEventsBatch(runId: string, events: StructuredSimEvent[], startSeq: number): void {
    if (events.length === 0) return;
    this.db.exec('BEGIN');
    try {
      const insEvt = this.db.prepare(
        `INSERT OR IGNORE INTO simulation_events (
          run_id, event_id, seq, scenario_seconds, clock_text,
          side, kind, subject, object, severity, source, ref, detail_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      events.forEach((ev, idx) => {
        insEvt.run(
          runId,
          ev.eventId,
          startSeq + idx,
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
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  appendUnitStatesBatch(runId: string, units: SituationUnit[]): void {
    if (units.length === 0) return;
    this.db.exec('BEGIN');
    try {
      const insTrack = this.db.prepare(
        `INSERT INTO unit_states (
          run_id, unit_id, unit_name, side, unit_type, unit_class,
          scenario_seconds, lon, lat, altitude_m, heading, speed_kts, damage_state, ammo_remaining
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const u of units) {
        for (const pt of u.trackPoints) {
          insTrack.run(
            runId,
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
      v4Evaluations: Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM v4_eval_results').get() as { c: number }).c,
      ),
      realtimeCards: Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM realtime_cards').get() as { c: number }).c,
      ),
      builtinOperators: Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM operator_definitions WHERE is_builtin = 1').get() as { c: number }).c,
      ),
      customOperators: Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM custom_operators').get() as { c: number }).c,
      ),
      totalOperators: Number(
        (this.db.prepare('SELECT COUNT(*) AS c FROM operator_definitions').get() as { c: number }).c,
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
      v4Operators: this.countV4Operators(),
      v4Effects: this.countV4Effects(),
      v4MetricGraphs: this.countV4MetricGraphs(),
      v4SystemDags: this.countV4SystemDags(),
      v4Components: this.countV4Components(),
    };
    let dbBytes = 0;
    if (this.dbPath !== ':memory:' && fs.existsSync(this.dbPath)) {
      dbBytes = fs.statSync(this.dbPath).size;
    }
    return { dbPath: this.dbPath, dbBytes, counts };
  }

  checkpoint(): void {
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {
      // 容错处理
    }
  }

  close(): void {
    this.checkpoint();
    this.db.close();
  }
}

export interface DatabaseInfo {
  filename: string;
  filePath: string;
  fileSize: number;
  modifiedAt: string;
  isActive: boolean;
  category?: 'operator' | 'scenario' | 'hybrid';
  counts?: Record<string, number>;
}

export function listAvailableDatabases(dataDir?: string, activeDbPath?: string): DatabaseInfo[] {
  const dir = dataDir ?? path.resolve(import.meta.dirname, '..', '..', 'data');
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.db') && !f.endsWith('-wal') && !f.endsWith('-shm'));
  const list: DatabaseInfo[] = [];
  const resolvedActive = activeDbPath ? path.resolve(activeDbPath) : '';
  for (const f of files) {
    const fullPath = path.join(dir, f);
    try {
      const stat = fs.statSync(fullPath);
      let category: 'operator' | 'scenario' | 'hybrid' = 'hybrid';
      try {
        const tempDb = new DatabaseSync(fullPath, { readOnly: true });
        try {
          const metaRow = tempDb
            .prepare("SELECT value FROM store_meta WHERE key = 'db_type'")
            .get() as { value: string } | undefined;
          if (metaRow?.value === 'operator' || metaRow?.value === 'scenario' || metaRow?.value === 'hybrid') {
            category = metaRow.value;
          }
        } catch {
          // store_meta 表可能不存在
        }
        if (category === 'hybrid' && (!tempDb || !fs.existsSync(fullPath))) {
          const isOp = f.startsWith('operator');
          const isSc = f.startsWith('scenario') || f === 'eval.db';
          if (isOp) {
            category = 'operator';
          } else if (isSc) {
            category = 'scenario';
          }
        }
        tempDb.close();
      } catch {
        const isOp = f.startsWith('operator');
        const isSc = f.startsWith('scenario') || f === 'eval.db';
        category = isOp ? 'operator' : isSc ? 'scenario' : 'hybrid';
      }

      list.push({
        filename: f,
        filePath: fullPath,
        fileSize: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        isActive: path.resolve(fullPath) === resolvedActive,
        category,
      });
    } catch {
      // 容错处理已删除或无法访问的文件
    }
  }
  return list.sort(
    (a, b) =>
      (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0) ||
      new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime() ||
      a.filename.localeCompare(b.filename),
  );
}

export function cloneDatabaseFile(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`源数据库文件不存在: ${sourcePath}`);
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

export const defaultSqliteStore = new EvalSqliteStore();
