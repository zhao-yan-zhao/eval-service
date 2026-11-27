import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EvalSqliteStore,
  cloneDatabaseFile,
  listAvailableDatabases,
} from './adapters/sqlite-store.ts';
import {
  DataSourceStore,
  probeSimulationPath,
  resolvePhysicalPath,
  type SimulationDataSource,
} from './adapters/data-source-store.ts';
import { ImportJobManager } from './adapters/import-job-manager.ts';
import { locateCsvDirectory } from './adapters/csv-adapter.ts';
import {
  buildRunSourceProfile,
  isSafePreviewQuery,
  type F1OutputCatalog,
} from './adapters/source-profiler.ts';
import { buildSituationModel } from './core/situation-model.ts';
import type {
  AggregationOperatorConfig,
  FormulaOperatorConfig,
  TableDataset,
} from './core/types.ts';
import { EffectStore } from './effects/store.ts';
import { DagNodeCache } from './engine/dag-executor.ts';
import { handleV4ApiRequest, type V4RouteDeps } from './engine/v4-routes.ts';
import { MetricGraphStore } from './indicators/metric-graph-store.ts';
import { getOperatorPipelineBlueprint } from './operators/blueprints.ts';
import {
  ComponentRegistryStore,
  validateComponentManifest,
  type ComponentManifest,
} from './operators/component-store.ts';
import { evaluateFormulaExpression, validateFormula } from './operators/formula-engine.ts';
import {
  computeAhpWeights,
  computeEntropyWeights,
  computeCriticWeights,
  computeCombinedWeights,
  computeTopsisRank,
  computeVikorRank,
  runPythonSandboxScript,
} from './operators/mcda-adapter.ts';
import { executeFormulaOrAggPreview } from './operators/pipeline-engine.ts';
import { deriveContractFromNodes, extractRunTableDataset } from './operators/pipeline-utils.ts';
import {
  disposeV4OperatorPool,
  listV4OperatorSummaries,
  runV4OperatorById,
} from './operators/v4/index.ts';
import { V4OperatorStore } from './operators/v4/store.ts';
import { RealtimeMonitor } from './realtime/monitor.ts';
import { SystemDagStore } from './systems/system-dag-store.ts';

const EVAL_SERVICE_ROOT = path.resolve(import.meta.dirname, '..');
const REPO_ROOT = path.resolve(EVAL_SERVICE_ROOT, '..');

export const BUILTIN_SAMPLES = {
  gj11CsvDir: path.join(
    REPO_ROOT,
    'LabConsole',
    'outputs',
    'm6-verify-runs',
    '39c47807bece4e0690feb0598f7a92d1',
    'GJ11-PL15试射-90nm正对-80nm-1',
    'EventExport_CSV',
  ),
  bsSampleJsonl: path.join(REPO_ROOT, 'demo-ui', 'proxy', 'testdata', 'bs-frames-sample.jsonl'),
  fieldsCatalogJson: path.join(REPO_ROOT, 'sim-output-fields', 'schemas', 'f1-output-catalog.json'),
  taihaiCsvDir: 'J:\\55所\\想定导出\\EventExport_CSV',
};

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

function sendError(res: http.ServerResponse, status: number, error: string): void {
  sendJson(res, status, { ok: false, error });
}

async function readJsonBody<T = Record<string, unknown>>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const ch of req) {
    const buf = Buffer.isBuffer(ch) ? ch : Buffer.from(ch);
    total += buf.length;
    if (total > 20 * 1024 * 1024) {
      throw new Error('请求体超过 20MB 限制');
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

function serveStaticFile(distDir: string, urlPath: string, res: http.ServerResponse): boolean {
  if (!fs.existsSync(distDir)) return false;
  const cleanPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  let target = path.resolve(distDir, cleanPath);
  if (!target.startsWith(path.resolve(distDir))) {
    return false;
  }
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    // SPA 回退至 index.html
    target = path.join(distDir, 'index.html');
  }
  if (!fs.existsSync(target)) return false;
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control':
      ext === '.html' ? 'no-cache, no-store, must-revalidate' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(target).pipe(res);
  return true;
}

function sanitizeDbFilename(name: string): string {
  const clean = path.basename(name.trim());
  if (!clean || clean === '.' || clean === '..') {
    throw new Error('无效的数据库文件名');
  }
  return clean.endsWith('.db') ? clean : `${clean}.db`;
}

export interface EvalServerDeps {
  dbPath?: string;
  operatorDbPath?: string;
  scenarioDbPath?: string;
  operatorPipelinesPath?: string;
  dataSourcesPath?: string;
  distUiDir?: string;
  autoSeed?: boolean;
  sqliteStore?: EvalSqliteStore;
  v4OperatorStore?: V4OperatorStore;
  effectStore?: EffectStore;
  metricGraphStore?: MetricGraphStore;
  systemDagStore?: SystemDagStore;
  componentStore?: ComponentRegistryStore;
  /** @deprecated legacy V2 options kept optional for transitional test callers */
  customOperatorsPath?: string;
  operatorOverridesPath?: string;
  customIndicatorsPath?: string;
  customSystemsPath?: string;
}

export async function createEvalApp(deps?: EvalServerDeps) {
  let operatorSqliteStore: EvalSqliteStore;
  let scenarioSqliteStore: EvalSqliteStore;

  if (deps?.sqliteStore) {
    operatorSqliteStore = deps.sqliteStore;
    scenarioSqliteStore = deps.sqliteStore;
  } else if (deps?.operatorDbPath || deps?.scenarioDbPath) {
    const defaultEvalPath = path.join(EVAL_SERVICE_ROOT, 'data', 'eval.db');
    operatorSqliteStore = new EvalSqliteStore(
      deps?.operatorDbPath ?? defaultEvalPath,
      { autoSeed: deps?.autoSeed },
    );
    scenarioSqliteStore = new EvalSqliteStore(
      deps?.scenarioDbPath ?? deps?.dbPath ?? defaultEvalPath,
      { autoSeed: deps?.autoSeed },
    );
  } else if (deps?.dbPath) {
    operatorSqliteStore = new EvalSqliteStore(deps.dbPath, { autoSeed: deps?.autoSeed });
    scenarioSqliteStore = operatorSqliteStore;
  } else {
    // 默认优先加载最全的 eval.db 统一数据库（完整承载 V4 三库资产与推演数据）
    const defaultEvalPath = path.join(EVAL_SERVICE_ROOT, 'data', 'eval.db');
    operatorSqliteStore = new EvalSqliteStore(defaultEvalPath, { autoSeed: deps?.autoSeed });
    scenarioSqliteStore = operatorSqliteStore;
  }

  try {
    if (operatorSqliteStore === scenarioSqliteStore) {
      if (!operatorSqliteStore.getMeta('db_type')) {
        operatorSqliteStore.setMeta('db_type', 'hybrid');
      }
    } else {
      if (!operatorSqliteStore.getMeta('db_type')) {
        operatorSqliteStore.setMeta('db_type', 'operator');
      }
      if (!scenarioSqliteStore.getMeta('db_type')) {
        scenarioSqliteStore.setMeta('db_type', 'scenario');
      }
    }
  } catch {}

  const OPERATOR_METHODS = new Set([
    'getOperatorPipeline',
    'saveOperatorPipeline',
    'listOperatorPipelines',
    'deleteOperatorPipeline',
    'listV4Operators',
    'getV4Operator',
    'upsertV4Operator',
    'deleteV4Operator',
    'countV4Operators',
    'listV4Effects',
    'getV4Effect',
    'upsertV4Effect',
    'deleteV4Effect',
    'countV4Effects',
    'listV4MetricGraphs',
    'getV4MetricGraph',
    'upsertV4MetricGraph',
    'deleteV4MetricGraph',
    'countV4MetricGraphs',
    'listV4SystemDags',
    'getV4SystemDag',
    'upsertV4SystemDag',
    'deleteV4SystemDag',
    'countV4SystemDags',
    'listV4Components',
    'getV4Component',
    'upsertV4Component',
    'deleteV4Component',
    'countV4Components',
    'seedV4Libraries',
  ]);

  const sqliteStore: any = new Proxy({}, {
    get(_target, prop) {
      if (OPERATOR_METHODS.has(prop as string)) {
        return (operatorSqliteStore as any)[prop]?.bind(operatorSqliteStore);
      }
      if (prop === 'getStats') {
        return () => {
          const opStats = operatorSqliteStore.getStats();
          const scStats = scenarioSqliteStore.getStats();
          return {
            dbPath: scenarioSqliteStore.dbPath,
            operatorDbPath: operatorSqliteStore.dbPath,
            scenarioDbPath: scenarioSqliteStore.dbPath,
            dbBytes: scStats.dbBytes + (operatorSqliteStore === scenarioSqliteStore ? 0 : opStats.dbBytes),
            counts: {
              runs: scStats.counts.runs ?? 0,
              events: scStats.counts.events ?? 0,
              unitStates: scStats.counts.unitStates ?? 0,
              evaluations: scStats.counts.evaluations ?? 0,
              v4Evaluations: scStats.counts.v4Evaluations ?? 0,
              realtimeCards: scStats.counts.realtimeCards ?? 0,
              operatorPipelines: opStats.counts.operatorPipelines ?? 0,
              v4Operators: opStats.counts.v4Operators ?? 0,
              v4Effects: opStats.counts.v4Effects ?? 0,
              v4MetricGraphs: opStats.counts.v4MetricGraphs ?? 0,
              v4SystemDags: opStats.counts.v4SystemDags ?? 0,
              v4Components: opStats.counts.v4Components ?? 0,
              builtinOperators: opStats.counts.v4Operators ?? 0,
              customOperators: opStats.counts.customOperators ?? 0,
              totalOperators: opStats.counts.v4Operators ?? 0,
              operatorOverrides: opStats.counts.operatorOverrides ?? 0,
              indicators: opStats.counts.v4MetricGraphs ?? 0,
              systems: opStats.counts.v4SystemDags ?? 0,
            },
          };
        };
      }
      if (prop === 'close') {
        return () => {
          try { operatorSqliteStore.close(); } catch {}
          if (scenarioSqliteStore !== operatorSqliteStore) {
            try { scenarioSqliteStore.close(); } catch {}
          }
        };
      }
      if (prop === 'checkpoint') {
        return () => {
          try { operatorSqliteStore.checkpoint(); } catch {}
          if (scenarioSqliteStore !== operatorSqliteStore) {
            try { scenarioSqliteStore.checkpoint(); } catch {}
          }
        };
      }
      if (prop === 'dbPath') {
        return scenarioSqliteStore.dbPath;
      }
      return (scenarioSqliteStore as any)[prop]?.bind(scenarioSqliteStore);
    },
  });

  const dataSourceStore = new DataSourceStore(deps?.dataSourcesPath, BUILTIN_SAMPLES);
  const v4OperatorStore = deps?.v4OperatorStore ?? new V4OperatorStore(operatorSqliteStore);
  const effectStore = deps?.effectStore ?? new EffectStore(operatorSqliteStore);
  const metricGraphStore =
    deps?.metricGraphStore ?? new MetricGraphStore(undefined, { sqliteStore: operatorSqliteStore });
  const systemDagStore = deps?.systemDagStore ?? new SystemDagStore(operatorSqliteStore, effectStore);
  const componentStore = deps?.componentStore ?? new ComponentRegistryStore(operatorSqliteStore);
  const monitor = new RealtimeMonitor({
    sqliteStore: scenarioSqliteStore,
    systemDagStore,
    effectStore,
    metricGraphStore,
  });
  const distUiDir = deps?.distUiDir ?? path.join(EVAL_SERVICE_ROOT, 'dist-ui');

  // ─── V4 全链路 DAG 中台依赖 ───
  const v4Cache = new DagNodeCache();
  const resolveV4CsvDir = (runId?: string, dataSourceId?: string): string | undefined => {
    const checkDir = (rawPath?: string): string | undefined => {
      if (!rawPath) return undefined;
      try {
        if (!fs.existsSync(rawPath)) return undefined;
        const stat = fs.statSync(rawPath);
        if (!stat.isDirectory()) return undefined;
        return locateCsvDirectory(rawPath);
      } catch {
        return undefined;
      }
    };

    if (runId) {
      const sit = sqliteStore.getRunSituation(runId);
      if (sit?.scenarioPath) {
        const hit = checkDir(sit.scenarioPath);
        if (hit) return hit;
      }
      if (sit?.coverage?.sourceKind && sit.coverage.sourceKind !== 'event_csv') {
        return undefined;
      }
      const dsByRun = dataSourceStore.get(runId);
      if (dsByRun?.kind === 'csv_dir') {
        const hit = checkDir(resolvePhysicalPath(dsByRun.path, dsByRun.id));
        if (hit) return hit;
      }
      if (runId === '55th_taihai_csv') {
        const hit = checkDir(BUILTIN_SAMPLES.taihaiCsvDir);
        if (hit) return hit;
      }
      if (runId === 'gj11_pl15_bvr_real') {
        const hit = checkDir(BUILTIN_SAMPLES.gj11CsvDir);
        if (hit) return hit;
      }
    }

    if (dataSourceId) {
      const ds = dataSourceStore.get(dataSourceId);
      if (ds?.kind === 'csv_dir') {
        const hit = checkDir(resolvePhysicalPath(ds.path, ds.id));
        if (hit) return hit;
      }
    }

    const activeId = dataSourceStore.getActiveSourceId();
    const activeDs = activeId ? dataSourceStore.get(activeId) : undefined;
    if (activeDs?.kind === 'csv_dir') {
      const hit = checkDir(resolvePhysicalPath(activeDs.path, activeDs.id));
      if (hit) return hit;
    }

    return undefined;
  };

  const v4RouteDeps: V4RouteDeps = {
    effectStore,
    metricGraphStore,
    systemDagStore,
    v4OperatorStore,
    cache: v4Cache,
    listOperators: (opts) => listV4OperatorSummaries(opts),
    listComponents: () => componentStore.list(),
    resolveCsvDir: resolveV4CsvDir,
    getEvalStore: () => sqliteStore,
    runOperator: async (operatorId, body) => {
      const runId =
        typeof body.runId === 'string' && body.runId.trim() ? body.runId.trim() : 'default_v4_run';
      const dataSourceId =
        typeof body.dataSourceId === 'string' && body.dataSourceId.trim()
          ? body.dataSourceId.trim()
          : undefined;
      const csvDir =
        (typeof body.csvDir === 'string' && body.csvDir.trim() ? body.csvDir.trim() : undefined) ??
        resolveV4CsvDir(runId, dataSourceId);
      const rawParams =
        body.params && typeof body.params === 'object' && !Array.isArray(body.params)
          ? (body.params as Record<string, unknown>)
          : undefined;
      return runV4OperatorById(operatorId, {
        runId,
        ...(csvDir ? { csvDir } : {}),
        ...(body.inputDfDict && typeof body.inputDfDict === 'object'
          ? { inputDfDict: body.inputDfDict as Record<string, any> }
          : {}),
        ...(rawParams ? { paramOverrides: rawParams } : {}),
        cache: v4Cache,
      });
    },
  };

  async function ensureSeedData(force = false): Promise<void> {
    if (force || sqliteStore.listRuns().length === 0) {
      if (fs.existsSync(BUILTIN_SAMPLES.gj11CsvDir) && (!sqliteStore.getRunSituation('gj11_pl15_bvr_real') || force)) {
        const gj11Sit = await buildSituationModel({
          runId: 'gj11_pl15_bvr_real',
          csvDir: BUILTIN_SAMPLES.gj11CsvDir,
          scenarioPath: BUILTIN_SAMPLES.gj11CsvDir,
        });
        gj11Sit.scenarioName = 'GJ-11 vs HaveRaider BVR实测CSV (双BOM全表)';
        sqliteStore.saveSituationRun(gj11Sit);
      }

      if (fs.existsSync(BUILTIN_SAMPLES.bsSampleJsonl) && (!sqliteStore.getRunSituation('bs_sample_swarm_demo') || force)) {
        const bsSit = await buildSituationModel({
          runId: 'bs_sample_swarm_demo',
          jsonlFile: BUILTIN_SAMPLES.bsSampleJsonl,
          scenarioPath: BUILTIN_SAMPLES.bsSampleJsonl,
        });
        bsSit.scenarioName = 'BS 状态帧基准集群样例 (bs-frames-sample.jsonl)';
        sqliteStore.saveSituationRun(bsSit);
      }
    }

    // 自动感知 55所实景导出数据 (若宿主磁盘存在且尚未入库，且非单元/端到端测试套件环境下自动种子化导入)
    const taihaiPath = BUILTIN_SAMPLES.taihaiCsvDir;
    const isTest = Boolean(process.env.NODE_TEST_CONTEXT || process.env.VITEST || process.env.NODE_ENV === 'test');
    if (!isTest && fs.existsSync(taihaiPath) && !sqliteStore.getRunSituation('55th_taihai_csv')) {
      const taihaiSit = await buildSituationModel({
        runId: '55th_taihai_csv',
        csvDir: taihaiPath,
        scenarioPath: taihaiPath,
      }).catch(() => null);
      if (taihaiSit) {
        taihaiSit.scenarioName = '55所台海场景实测 (EventExport_CSV)';
        sqliteStore.saveSituationRun(taihaiSit);
      }
    }
  }

  if (deps?.autoSeed !== false) {
    await ensureSeedData();
  }

  const sourceProfileCache = new Map<
    string,
    { cachedAt: number; profile: ReturnType<typeof buildRunSourceProfile> }
  >();

  const sseClients = new Set<http.ServerResponse>();
  const broadcastSse = (event: string, payload: unknown) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
      if (!client.writableEnded) {
        client.write(msg);
      }
    }
  };
  monitor.subscribe((payload) => {
    broadcastSse(payload.type, payload);
  });

  const importJobManager = new ImportJobManager({
    getSqliteStore: () => sqliteStore,
    dataSourceStore,
    broadcast: broadcastSse,
  });

  const rebindV4AssetStores = (newOpStore: EvalSqliteStore) => {
    v4OperatorStore.rebindSqliteStore(newOpStore);
    effectStore.rebindSqliteStore(newOpStore);
    metricGraphStore.rebindSqliteStore(newOpStore);
    systemDagStore.rebindSqliteStore(newOpStore);
    componentStore.rebindSqliteStore(newOpStore);
    v4Cache.clear();
  };

  const switchActiveDatabase = (
    newDbPath: string,
    type: 'operator' | 'scenario' | 'all' = 'scenario',
  ) => {
    if (type === 'operator') {
      try {
        operatorSqliteStore.checkpoint();
        operatorSqliteStore.close();
      } catch (err) {
        console.warn('[server] 关闭旧算子库连接时异常:', err);
      }
      operatorSqliteStore = new EvalSqliteStore(newDbPath, { autoSeed: false });
      rebindV4AssetStores(operatorSqliteStore);
      return {
        ok: true,
        type: 'operator' as const,
        activeDb: path.basename(operatorSqliteStore.dbPath),
        dbPath: operatorSqliteStore.dbPath,
        stats: operatorSqliteStore.getStats(),
      };
    }

    if (type === 'scenario') {
      try {
        scenarioSqliteStore.checkpoint();
        scenarioSqliteStore.close();
      } catch (err) {
        console.warn('[server] 关闭旧想定数据连接时异常:', err);
      }
      scenarioSqliteStore = new EvalSqliteStore(newDbPath, { autoSeed: false });
      sourceProfileCache.clear();
      monitor.rebindSqliteStore(scenarioSqliteStore);
      return {
        ok: true,
        type: 'scenario' as const,
        activeDb: path.basename(scenarioSqliteStore.dbPath),
        dbPath: scenarioSqliteStore.dbPath,
        stats: scenarioSqliteStore.getStats(),
      };
    }

    // type === 'all'
    try {
      operatorSqliteStore.checkpoint();
      operatorSqliteStore.close();
    } catch {}
    if (scenarioSqliteStore !== operatorSqliteStore) {
      try {
        scenarioSqliteStore.checkpoint();
        scenarioSqliteStore.close();
      } catch {}
    }
    const targetStore = new EvalSqliteStore(newDbPath, { autoSeed: false });
    operatorSqliteStore = targetStore;
    scenarioSqliteStore = targetStore;
    sourceProfileCache.clear();
    rebindV4AssetStores(operatorSqliteStore);
    monitor.rebindSqliteStore(scenarioSqliteStore);

    return {
      ok: true,
      type: 'all' as const,
      activeDb: path.basename(scenarioSqliteStore.dbPath),
      dbPath: scenarioSqliteStore.dbPath,
      stats: scenarioSqliteStore.getStats(),
    };
  };

  const server = http.createServer(async (req, res) => {
    if (!req.url || !req.method) {
      sendError(res, 400, 'Malformed request');
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    const reqUrl = new URL(req.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(reqUrl.pathname);

    try {
      // ─── 健康检查 & 字段契约 ───
      if (req.method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, {
          ok: true,
          service: 'f1-eval-service',
          version: '1.0.0',
          nodeVersion: process.version,
          db: sqliteStore.getStats(),
          builtinSamples: {
            gj11CsvAvailable: fs.existsSync(BUILTIN_SAMPLES.gj11CsvDir),
            bsSampleAvailable: fs.existsSync(BUILTIN_SAMPLES.bsSampleJsonl),
            fieldsCatalogAvailable: fs.existsSync(BUILTIN_SAMPLES.fieldsCatalogJson),
            taihaiCsvAvailable: fs.existsSync(BUILTIN_SAMPLES.taihaiCsvDir),
          },
        });
        return;
      }

      // ─── V4 全链路 DAG 评估中台 REST API (/api/v4/*) ───
      if (pathname.startsWith('/api/v4')) {
        const handled = await handleV4ApiRequest(
          req,
          res,
          pathname,
          readJsonBody,
          sendJson,
          v4RouteDeps,
        );
        if (handled) return;
      }

      // ─── 数据库解耦管理接口（算子库归算子库，想定数据归想定数据） ───
      if (req.method === 'GET' && pathname === '/api/db/current') {
        sendJson(res, 200, {
          ok: true,
          operatorDb: {
            current: path.basename(operatorSqliteStore.dbPath),
            dbPath: operatorSqliteStore.dbPath,
            stats: operatorSqliteStore.getStats(),
          },
          scenarioDb: {
            current: path.basename(scenarioSqliteStore.dbPath),
            dbPath: scenarioSqliteStore.dbPath,
            stats: scenarioSqliteStore.getStats(),
          },
          current: path.basename(scenarioSqliteStore.dbPath),
          dbPath: scenarioSqliteStore.dbPath,
          stats: sqliteStore.getStats(),
          builtinOperatorsCount: v4OperatorStore.list({ builtinOnly: true }).length,
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/db/list') {
        try {
          const dataDir = path.resolve(EVAL_SERVICE_ROOT, 'data');
          const allDatabases = listAvailableDatabases(dataDir);
          const opPath = path.resolve(operatorSqliteStore.dbPath);
          const scPath = path.resolve(scenarioSqliteStore.dbPath);

          const operatorDatabases = allDatabases
            .filter((d) => d.category === 'operator' || d.category === 'hybrid' || d.filePath === opPath)
            .map((d) => ({ ...d, isActive: d.filePath === opPath }));

          const scenarioDatabases = allDatabases
            .filter((d) => d.category === 'scenario' || d.category === 'hybrid' || d.filePath === scPath)
            .map((d) => ({ ...d, isActive: d.filePath === scPath }));

          sendJson(res, 200, {
            ok: true,
            currentOperatorDb: path.basename(operatorSqliteStore.dbPath),
            currentScenarioDb: path.basename(scenarioSqliteStore.dbPath),
            operatorDatabases,
            scenarioDatabases,
            allDatabases: allDatabases.map((d) => ({
              ...d,
              isOperatorActive: d.filePath === opPath,
              isScenarioActive: d.filePath === scPath,
            })),
            current: path.basename(scenarioSqliteStore.dbPath),
            currentPath: scenarioSqliteStore.dbPath,
            databases: allDatabases.map((d) => ({ ...d, isActive: d.filePath === scPath })),
          });
        } catch (err) {
          sendError(res, 500, '获取数据库列表失败: ' + String(err));
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/api/db/switch') {
        try {
          const body = await readJsonBody<{
            type?: 'operator' | 'scenario' | 'all';
            dbName?: string;
            dbPath?: string;
          }>(req);
          let targetPath = '';
          if (body.dbPath) {
            targetPath = path.resolve(body.dbPath);
          } else if (body.dbName) {
            const safe = sanitizeDbFilename(body.dbName);
            targetPath = path.resolve(EVAL_SERVICE_ROOT, 'data', safe);
          } else {
            sendError(res, 400, '缺少 dbName 或 dbPath 参数');
            return;
          }

          if (!fs.existsSync(targetPath)) {
            sendError(res, 404, `未找到目标数据库文件: ${targetPath}`);
            return;
          }

          const defaultType =
            body.type ??
            (operatorSqliteStore === scenarioSqliteStore
              ? 'all'
              : path.basename(targetPath).startsWith('operator')
                ? 'operator'
                : 'scenario');
          const result = switchActiveDatabase(targetPath, defaultType);
          sendJson(res, 200, result);
        } catch (err) {
          sendError(res, 500, '切换数据库失败: ' + String(err));
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/api/db/create') {
        try {
          const body = await readJsonBody<{
            type?: 'operator' | 'scenario' | 'all';
            dbName?: string;
            dbPath?: string;
            template?: 'empty' | 'standard';
            switchNow?: boolean;
          }>(req);
          const rawName = body.dbPath || body.dbName;
          if (!rawName) {
            sendError(res, 400, '缺少必要参数 dbName 或 dbPath');
            return;
          }
          let targetPath = '';
          if (body.dbPath || rawName.includes('/') || rawName.includes('\\')) {
            targetPath = path.resolve(rawName);
          } else {
            const safeFilename = sanitizeDbFilename(rawName);
            const dataDir = path.resolve(EVAL_SERVICE_ROOT, 'data');
            fs.mkdirSync(dataDir, { recursive: true });
            targetPath = path.join(dataDir, safeFilename);
          }
          const safeFilename = path.basename(targetPath);
          if (fs.existsSync(targetPath)) {
            sendError(res, 400, `数据库「${safeFilename}」已存在`);
            return;
          }

          const autoSeed = body.template !== 'empty';
          const newStore = new EvalSqliteStore(targetPath, { autoSeed });
          const createType =
            body.type ??
            (operatorSqliteStore === scenarioSqliteStore
              ? 'all'
              : safeFilename.startsWith('operator')
                ? 'operator'
                : 'scenario');

          const effectiveDbType = createType === 'all' ? 'operator' : createType;
          newStore.setMeta('db_type', effectiveDbType);
          newStore.setMeta('is_initialized', '1');
          newStore.setMeta('is_blank', body.template === 'empty' ? '1' : '0');
          newStore.setMeta('is_seeded', autoSeed ? '1' : '0');
          newStore.checkpoint();

          if (body.switchNow !== false) {
            newStore.close();
            const switchRes = switchActiveDatabase(targetPath, createType);
            sendJson(res, 200, { ...switchRes, ok: true, created: safeFilename, switched: true });
          } else {
            const stats = newStore.getStats();
            newStore.close();
            sendJson(res, 200, { ok: true, created: safeFilename, switched: false, stats });
          }
        } catch (err) {
          sendError(res, 500, '创建场景数据库失败: ' + String(err));
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/api/db/clone') {
        try {
          const body = await readJsonBody<{
            type?: 'operator' | 'scenario' | 'all';
            targetDbName?: string;
            targetPath?: string;
            switchNow?: boolean;
          }>(req);
          const rawName = body.targetPath || body.targetDbName;
          if (!rawName) {
            sendError(res, 400, '缺少必要参数 targetDbName 或 targetPath');
            return;
          }
          let targetPath = '';
          if (body.targetPath || rawName.includes('/') || rawName.includes('\\')) {
            targetPath = path.resolve(rawName);
          } else {
            const safeFilename = sanitizeDbFilename(rawName);
            const dataDir = path.resolve(EVAL_SERVICE_ROOT, 'data');
            fs.mkdirSync(dataDir, { recursive: true });
            targetPath = path.join(dataDir, safeFilename);
          }
          const safeFilename = path.basename(targetPath);
          if (fs.existsSync(targetPath)) {
            sendError(res, 400, `目标数据库「${safeFilename}」已存在`);
            return;
          }
          const cloneType =
            body.type ??
            (operatorSqliteStore === scenarioSqliteStore
              ? 'all'
              : safeFilename.startsWith('operator')
                ? 'operator'
                : 'scenario');
          const srcStore = cloneType === 'operator' ? operatorSqliteStore : scenarioSqliteStore;
          if (srcStore.dbPath === ':memory:' || !fs.existsSync(srcStore.dbPath)) {
            sendError(res, 400, '源数据库处于内存模式或文件不存在，无法克隆');
            return;
          }
          srcStore.checkpoint();
          cloneDatabaseFile(srcStore.dbPath, targetPath);
          try {
            const clonedStore = new EvalSqliteStore(targetPath, { autoSeed: false });
            clonedStore.setMeta('db_type', cloneType === 'all' ? 'operator' : cloneType);
            clonedStore.checkpoint();
            clonedStore.close();
          } catch {}

          if (body.switchNow !== false) {
            const switchRes = switchActiveDatabase(targetPath, cloneType);
            sendJson(res, 200, { ...switchRes, ok: true, cloned: safeFilename, switched: true });
          } else {
            sendJson(res, 200, { ok: true, cloned: safeFilename, switched: false });
          }
        } catch (err) {
          sendError(res, 500, '克隆数据库失败: ' + String(err));
        }
        return;
      }

      if (req.method === 'GET' && pathname === '/api/db/export') {
        const exportType = reqUrl.searchParams.get('type') === 'operator' ? 'operator' : 'scenario';
        const targetStore = exportType === 'operator' ? operatorSqliteStore : scenarioSqliteStore;
        targetStore.checkpoint();
        if (targetStore.dbPath === ':memory:' || !fs.existsSync(targetStore.dbPath)) {
          sendError(res, 400, '内存数据库或文件不存在，无法导出');
          return;
        }
        const stat = fs.statSync(targetStore.dbPath);
        const filename = path.basename(targetStore.dbPath);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.sqlite3',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
          'Content-Length': stat.size,
          'Access-Control-Allow-Origin': '*',
        });
        fs.createReadStream(targetStore.dbPath).pipe(res);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/db/upload') {
        try {
          const body = await readJsonBody<{
            filename: string;
            contentBase64: string;
            switchNow?: boolean;
          }>(req);
          if (!body.filename || !body.contentBase64) {
            sendError(res, 400, '缺少必要参数 filename 或 contentBase64');
            return;
          }
          const safeFilename = sanitizeDbFilename(body.filename);
          const dataDir = path.resolve(EVAL_SERVICE_ROOT, 'data');
          fs.mkdirSync(dataDir, { recursive: true });
          const targetPath = path.join(dataDir, safeFilename);
          const buf = Buffer.from(body.contentBase64, 'base64');
          fs.writeFileSync(targetPath, buf);

          if (body.switchNow !== false) {
            const switchRes = switchActiveDatabase(targetPath);
            sendJson(res, 200, { ...switchRes, ok: true, uploaded: safeFilename, switched: true });
          } else {
            sendJson(res, 200, { ok: true, uploaded: safeFilename, switched: false, size: buf.length });
          }
        } catch (err) {
          sendError(res, 500, '上传数据库失败: ' + String(err));
        }
        return;
      }

      if (req.method === 'DELETE' && pathname === '/api/db/file') {
        try {
          const filename = reqUrl.searchParams.get('filename')?.trim();
          if (!filename) {
            sendError(res, 400, '缺少 filename 参数');
            return;
          }
          const safeFilename = path.basename(filename);
          if (!/\.(db|sqlite|sqlite3)$/i.test(safeFilename)) {
            sendError(res, 400, '仅允许删除 .db / .sqlite / .sqlite3 数据库文件');
            return;
          }
          const dataDir = path.resolve(EVAL_SERVICE_ROOT, 'data');
          const targetPath = path.resolve(dataDir, safeFilename);
          if (!targetPath.startsWith(dataDir)) {
            sendError(res, 403, '禁止越权访问目录');
            return;
          }
          if (
            targetPath === path.resolve(operatorSqliteStore.dbPath) ||
            targetPath === path.resolve(scenarioSqliteStore.dbPath)
          ) {
            sendError(res, 400, `数据库「${safeFilename}」当前正在挂载使用中，请先切换到其他库后再删除`);
            return;
          }
          if (!fs.existsSync(targetPath)) {
            sendError(res, 404, `数据库文件不存在: ${safeFilename}`);
            return;
          }
          fs.unlinkSync(targetPath);
          // 清理可能伴随的 WAL/SHM 文件
          for (const ext of ['-wal', '-shm']) {
            if (fs.existsSync(`${targetPath}${ext}`)) {
              try {
                fs.unlinkSync(`${targetPath}${ext}`);
              } catch {
                // ignore
              }
            }
          }
          sendJson(res, 200, { ok: true, deleted: true, filename: safeFilename });
        } catch (err) {
          sendError(res, 500, '删除数据库文件失败: ' + String(err));
        }
        return;
      }

      // ─── 手动加载内置推演样例数据接口 ───
      if (
        req.method === 'POST' &&
        (pathname === '/api/sample-data/load-builtin' || pathname === '/api/db/load-builtin-samples')
      ) {
        try {
          await ensureSeedData(true);
          const runs = scenarioSqliteStore.listRuns();
          sendJson(res, 200, {
            ok: true,
            message: '成功手动加载内置推演样例数据',
            runsCount: runs.length,
            runs: runs.map((r) => ({ runId: r.runId, scenarioName: r.scenarioName })),
          });
        } catch (err) {
          sendError(res, 500, '加载内置推演样例数据失败: ' + String(err));
        }
        return;
      }

      const loadFieldsCatalog = (): F1OutputCatalog | null => {
        if (!fs.existsSync(BUILTIN_SAMPLES.fieldsCatalogJson)) {
          return null;
        }
        return JSON.parse(
          fs.readFileSync(BUILTIN_SAMPLES.fieldsCatalogJson, 'utf-8'),
        ) as F1OutputCatalog;
      };

      if (req.method === 'GET' && pathname === '/api/fields-catalog') {
        const catalog = loadFieldsCatalog();
        if (!catalog) {
          sendError(res, 404, '未找到 sim-output-fields/schemas/f1-output-catalog.json');
          return;
        }
        sendJson(res, 200, { ok: true, catalog });
        return;
      }

      const SIM_SCHEMA_CATALOG_FILE = path.join(EVAL_SERVICE_ROOT, 'data', 'simulation-schema-catalog.json');
      const OPERATOR_PIPELINES_FILE = deps?.operatorPipelinesPath ?? path.join(EVAL_SERVICE_ROOT, 'data', 'operator-pipelines.json');

      // ─── 算子专属画布流水线持久化接口 (GET / POST) ───
      if (req.method === 'GET' && pathname.startsWith('/api/operator-pipelines/')) {
        const opId = decodeURIComponent(pathname.slice('/api/operator-pipelines/'.length));
        try {
          let pipeline: any = null;
          if (deps?.operatorPipelinesPath) {
            // 当测试或调用方显式指定隔离的流水线文件路径时，严格以该指定文件为准
            if (fs.existsSync(OPERATOR_PIPELINES_FILE)) {
              const raw = fs.readFileSync(OPERATOR_PIPELINES_FILE, 'utf-8');
              const data = JSON.parse(raw);
              if (data && data[opId]) {
                pipeline = data[opId];
              }
            }
          } else {
            // 默认与生产运行模式：优先由 sqliteStore 提供，回退至全局文件
            pipeline = sqliteStore.getOperatorPipeline(opId);
            if (!pipeline && fs.existsSync(OPERATOR_PIPELINES_FILE)) {
              const raw = fs.readFileSync(OPERATOR_PIPELINES_FILE, 'utf-8');
              const data = JSON.parse(raw);
              if (data && data[opId]) {
                pipeline = data[opId];
                sqliteStore.saveOperatorPipeline(pipeline);
              }
            }
          }
          const bp = pipeline ? null : getOperatorPipelineBlueprint(opId);
          const nodes = pipeline?.nodes || bp?.nodes || [];
          const derivedContract = deriveContractFromNodes(nodes);
          sendJson(res, 200, {
            ok: true,
            operatorId: opId,
            pipeline,
            blueprint: bp,
            derivedContract,
          });
        } catch (err) {
          sendError(res, 500, '读取算子流水线配置失败: ' + String(err));
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/api/operator-pipelines') {
        try {
          const body = await readJsonBody<{
            operatorId: string;
            pipelineTitle: string;
            nodes: any[];
            edges: any[];
            dataset?: any;
          }>(req);
          if (!body || !body.operatorId) {
            sendError(res, 400, '缺少必要参数 operatorId');
            return;
          }
          const pipelineRecord = {
            operatorId: body.operatorId,
            pipelineTitle: body.pipelineTitle,
            nodes: body.nodes || [],
            edges: body.edges || [],
            dataset: body.dataset,
            updatedAt: new Date().toISOString(),
          };
          if (!deps?.operatorPipelinesPath) {
            sqliteStore.saveOperatorPipeline(pipelineRecord);
          } else {
            let existingData: Record<string, any> = {};
            if (fs.existsSync(OPERATOR_PIPELINES_FILE)) {
              try {
                existingData = JSON.parse(fs.readFileSync(OPERATOR_PIPELINES_FILE, 'utf-8'));
              } catch {
                existingData = {};
              }
            }
            existingData[body.operatorId] = pipelineRecord;
            try {
              fs.mkdirSync(path.dirname(OPERATOR_PIPELINES_FILE), { recursive: true });
              fs.writeFileSync(OPERATOR_PIPELINES_FILE, JSON.stringify(existingData, null, 2), 'utf-8');
            } catch {
              // 兼容只读/临时目录
            }
          }

          // 核心自动同步：画布编排即算子真相源 (Single Source of Truth -> V4OperatorStore)
          const derived = deriveContractFromNodes(body.nodes || []);
          const existingV4Op = v4OperatorStore.get(body.operatorId);
          if (existingV4Op) {
            const mergedRequiredTables =
              derived.csvTables.length > 0 ? derived.csvTables : existingV4Op.requiredTables;
            const updatedPorts = (existingV4Op.parameterPorts ?? []).map((port) => {
              if (
                derived.defaultParams &&
                Object.prototype.hasOwnProperty.call(derived.defaultParams, port.key)
              ) {
                return {
                  ...port,
                  defaultValue: derived.defaultParams[port.key] as any,
                };
              }
              return port;
            });
            v4OperatorStore.update(body.operatorId, {
              requiredTables: mergedRequiredTables,
              parameterPorts: updatedPorts,
            });
          }

          sendJson(res, 200, {
            ok: true,
            message: `算子 [${body.operatorId}] 流水线配置已成功持久化，并已自动同步底层 V4 算子契约与参数`,
            saved: pipelineRecord,
            derivedContract: derived,
            updatedOperator: v4OperatorStore.get(body.operatorId),
          });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      if (req.method === 'GET' && pathname === '/api/schema/catalog') {
        if (!fs.existsSync(SIM_SCHEMA_CATALOG_FILE)) {
          sendError(res, 404, 'Schema catalog not found on disk');
          return;
        }
        try {
          const data = JSON.parse(fs.readFileSync(SIM_SCHEMA_CATALOG_FILE, 'utf-8'));
          sendJson(res, 200, { ok: true, catalog: data });
        } catch (err) {
          sendError(res, 500, 'Failed to read simulation schema catalog: ' + String(err));
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/api/schema/catalog') {
        try {
          const body = await readJsonBody(req);
          if (!body || !body.tables || !Array.isArray(body.tables)) {
            sendError(res, 400, 'Invalid catalog format: expected { tables: [...] }');
            return;
          }
          fs.writeFileSync(SIM_SCHEMA_CATALOG_FILE, JSON.stringify(body, null, 2), 'utf-8');
          sendJson(res, 200, { ok: true, message: '仿真规范字典已成功持久化至磁盘', totalTables: body.tables.length });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      // ─── 算子画布预览 / 公式校验 / Python 沙箱试算（共享底座接口） ───
      if (req.method === 'POST' && pathname === '/api/operators/preview') {
        try {
          const body = await readJsonBody<{
            sampleDataset?: TableDataset;
            dataset?: TableDataset;
            nodeConfig?: any;
            formulaConfig?: FormulaOperatorConfig;
            aggregationConfig?: AggregationOperatorConfig;
            type?: 'formula' | 'formula_pipeline' | 'aggregation';
            maxPreviewRows?: number;
          }>(req);
          const rawSample = body.sampleDataset ?? body.dataset ?? { columns: [], rows: [] };
          const sampleCols = rawSample.columns ?? (rawSample as any).schema ?? [];
          const sample: TableDataset = {
            ...rawSample,
            columns: sampleCols,
            schema: sampleCols,
          };
          const rawNodeConfig =
            body.nodeConfig ??
            (body.type === 'aggregation' || body.aggregationConfig
              ? { type: 'aggregation', aggregationConfig: body.aggregationConfig }
              : { type: 'formula_pipeline', formulaConfig: body.formulaConfig });
          const preview = executeFormulaOrAggPreview(sample, rawNodeConfig, {
            maxPreviewRows: body.maxPreviewRows ?? 100,
          });
          sendJson(res, 200, { ok: preview.success, ...preview });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/api/operators/validate-formula') {
        try {
          const body = await readJsonBody<{
            expression?: string;
            formula?: string;
            availableColumns?: string[];
            columns?: string[];
          }>(req);
          const expr = body.expression ?? body.formula ?? '';
          const cols = body.availableColumns ?? body.columns;
          const valRes = validateFormula(expr, cols);
          sendJson(res, 200, {
            ok: true,
            valid: valRes.valid,
            errors: valRes.errors,
            referencedVariables: valRes.referencedVariables,
          });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/api/operators/preview-formula') {
        try {
          const body = await readJsonBody<{
            expression?: string;
            formula?: string;
            variables?: Record<string, number>;
          }>(req);
          const expr = body.expression ?? body.formula ?? '';
          if (!expr.trim()) {
            sendError(res, 400, '缺少公式表达式 expression');
            return;
          }
          const evalRes = evaluateFormulaExpression(expr, body.variables ?? {});
          sendJson(res, 200, {
            ok: evalRes.ok,
            value: evalRes.ok ? evalRes.value : null,
            ...(evalRes.ok ? {} : { error: evalRes.reason }),
          });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/api/operators/run-python') {
        try {
          const body = await readJsonBody<{
            script: string;
            context?: Record<string, unknown>;
            timeout?: number;
          }>(req);
          const runRes = await runPythonSandboxScript({
            script: body.script,
            context: body.context,
            timeout: body.timeout,
          });
          sendJson(res, 200, { ok: true, ...runRes });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      // ─── 算子组件库与 JSON Schema 扩展插件注册接口 ───
      if (req.method === 'GET' && pathname === '/api/components') {
        sendJson(res, 200, {
          ok: true,
          components: componentStore.list(),
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/components/validate') {
        try {
          const body = await readJsonBody<{ manifest: any }>(req);
          const check = validateComponentManifest(body.manifest || body);
          sendJson(res, 200, {
            ok: true,
            valid: check.valid,
            errors: check.errors,
          });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/api/components/import') {
        try {
          const body = await readJsonBody<{ manifest: ComponentManifest } | ComponentManifest>(req);
          const manifest = 'manifest' in body ? body.manifest : body;
          const imported = componentStore.import(manifest);
          sendJson(res, 200, {
            ok: true,
            component: imported,
          });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      const compDelMatch = pathname.match(/^\/api\/components\/([^/]+)$/);
      if (req.method === 'DELETE' && compDelMatch) {
        const compId = compDelMatch[1];
        try {
          const deleted = componentStore.delete(compId);
          sendJson(res, 200, { ok: true, deleted, id: compId });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      // ─── MCDA 科学计算接口 (NumPy / SciPy) ───
      if (req.method === 'POST' && pathname === '/api/mcda/ahp') {
        const body = await readJsonBody<{ matrix: number[][]; names?: string[] }>(req);
        const ahp = await computeAhpWeights(body.matrix, body.names);
        sendJson(res, 200, { ok: true, ...ahp });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/mcda/entropy') {
        const body = await readJsonBody<{
          matrix: number[][];
          directions?: Array<'smaller_is_better' | 'larger_is_better'>;
          criterionNames?: string[];
        }>(req);
        const ew = await computeEntropyWeights(body.matrix, body.directions, body.criterionNames);
        sendJson(res, 200, { ok: true, ...ew });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/mcda/critic') {
        const body = await readJsonBody<{
          matrix: number[][];
          directions?: Array<'smaller_is_better' | 'larger_is_better'>;
          criterionNames?: string[];
        }>(req);
        const cw = await computeCriticWeights(body.matrix, body.directions, body.criterionNames);
        sendJson(res, 200, { ok: true, ...cw });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/mcda/combined') {
        const body = await readJsonBody<{
          subjectiveWeights: number[];
          objectiveWeights: number[];
          alpha?: number;
          criterionNames?: string[];
        }>(req);
        const comb = await computeCombinedWeights(body);
        sendJson(res, 200, { ok: true, ...comb });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/mcda/topsis') {
        const body = await readJsonBody<{
          matrix: number[][];
          weights?: number[];
          directions?: Array<'smaller_is_better' | 'larger_is_better'>;
          alternatives?: string[];
          customIdealBest?: number[];
          customIdealWorst?: number[];
        }>(req);
        const topsis = await computeTopsisRank(body);
        sendJson(res, 200, { ok: true, ...topsis });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/mcda/vikor') {
        const body = await readJsonBody<{
          matrix: number[][];
          weights?: number[];
          directions?: Array<'smaller_is_better' | 'larger_is_better'>;
          alternatives?: string[];
          v?: number;
        }>(req);
        const vikor = await computeVikorRank(body);
        sendJson(res, 200, { ok: true, ...vikor });
        return;
      }

      // ─── 仿真数据源与测试目录配置 API ───
      if (req.method === 'GET' && pathname === '/api/data-sources') {
        const knownRunIds = new Set<string>((sqliteStore.listRuns() as Array<{ runId: string }>).map((r) => r.runId));
        const activeSourceId = dataSourceStore.getActiveSourceId();
        sendJson(res, 200, {
          ok: true,
          activeSourceId,
          activeRunId: dataSourceStore.resolveRunIdForSource(activeSourceId),
          dataSources: dataSourceStore.listAll(knownRunIds),
        });
        return;
      }

      if ((req.method === 'POST' || req.method === 'PUT') && pathname === '/api/data-sources/active') {
        try {
          const body = await readJsonBody<{ sourceId: string }>(req);
          if (!body.sourceId) {
            sendError(res, 400, '必须提供 sourceId');
            return;
          }
          const ds = dataSourceStore.get(body.sourceId);
          if (!ds) {
            sendError(res, 404, `未找到数据源: ${body.sourceId}`);
            return;
          }
          const resolvedPath = resolvePhysicalPath(ds.path, ds.id);
          if (!fs.existsSync(resolvedPath)) {
            sendError(res, 400, `数据源路径不存在或不可访问: ${resolvedPath}`);
            return;
          }
          dataSourceStore.setActiveSourceId(ds.id);
          const runId = dataSourceStore.resolveRunIdForSource(ds.id);
          if (!sqliteStore.getRunSituation(runId)) {
            const situation =
              ds.kind === 'csv_dir'
                ? await buildSituationModel({ runId, csvDir: resolvedPath, scenarioPath: ds.path })
                : await buildSituationModel({ runId, jsonlFile: resolvedPath, scenarioPath: ds.path });
            situation.scenarioName = ds.name || ds.scenarioName || situation.scenarioName;
            sqliteStore.saveSituationRun(situation);
          }
          const knownRunIds = new Set<string>((sqliteStore.listRuns() as Array<{ runId: string }>).map((r) => r.runId));
          sendJson(res, 200, {
            ok: true,
            activeSourceId: ds.id,
            runId,
            dataSources: dataSourceStore.listAll(knownRunIds),
          });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/api/data-sources/probe') {
        try {
          const body = await readJsonBody<{ path: string; sourceId?: string }>(req);
          const probeRes = probeSimulationPath(body.path, body.sourceId);
          sendJson(res, 200, { ok: true, probe: probeRes });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      if (req.method === 'GET' && pathname === '/api/data-sources/jobs') {
        sendJson(res, 200, {
          ok: true,
          jobs: importJobManager.listJobs(),
        });
        return;
      }

      const dsJobPauseMatch = pathname.match(/^\/api\/data-sources\/jobs\/([^/]+)\/pause$/);
      if (req.method === 'POST' && dsJobPauseMatch) {
        const jobId = decodeURIComponent(dsJobPauseMatch[1]);
        const job = importJobManager.pauseJob(jobId);
        if (!job) {
          sendError(res, 404, `未找到任务: ${jobId}`);
          return;
        }
        sendJson(res, 200, { ok: true, job });
        return;
      }

      const dsJobResumeMatch = pathname.match(/^\/api\/data-sources\/jobs\/([^/]+)\/resume$/);
      if (req.method === 'POST' && dsJobResumeMatch) {
        try {
          const jobId = decodeURIComponent(dsJobResumeMatch[1]);
          const job = await importJobManager.resumeJob(jobId);
          sendJson(res, 200, { ok: true, job });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      const dsJobDelMatch = pathname.match(/^\/api\/data-sources\/jobs\/([^/]+)$/);
      if (req.method === 'DELETE' && dsJobDelMatch) {
        const jobId = decodeURIComponent(dsJobDelMatch[1]);
        const deleted = importJobManager.deleteJob(jobId);
        sendJson(res, 200, { ok: true, deleted });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/data-sources') {
        try {
          const body = await readJsonBody<SimulationDataSource>(req);
          if (!body.id || !body.path) {
            sendError(res, 400, '数据源必须包含 id 与 path');
            return;
          }
          const saved = dataSourceStore.upsert(body);
          sendJson(res, 200, { ok: true, dataSource: saved });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      const dsRelocateMatch = pathname.match(/^\/api\/data-sources\/([^/]+)\/relocate$/);
      if ((req.method === 'PUT' || req.method === 'POST') && dsRelocateMatch) {
        try {
          const dsId = decodeURIComponent(dsRelocateMatch[1]);
          const body = await readJsonBody<{ newPath: string }>(req);
          if (!body.newPath) {
            sendError(res, 400, '必须提供 newPath');
            return;
          }
          const updated = dataSourceStore.relocateSourcePath(dsId, body.newPath);
          const knownRunIds = new Set<string>((sqliteStore.listRuns() as Array<{ runId: string }>).map((r) => r.runId));
          sendJson(res, 200, {
            ok: true,
            dataSource: updated,
            dataSources: dataSourceStore.listAll(knownRunIds),
          });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      const dsArchiveMatch = pathname.match(/^\/api\/data-sources\/([^/]+)\/archive$/);
      if (req.method === 'POST' && dsArchiveMatch) {
        try {
          const dsId = decodeURIComponent(dsArchiveMatch[1]);
          const body = await readJsonBody<{ resumeJobId?: string }>(req).catch(() => ({} as { resumeJobId?: string }));
          const job = await importJobManager.startArchiveJob(dsId, body.resumeJobId);
          sendJson(res, 200, { ok: true, job });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      const dsImportSqliteMatch = pathname.match(/^\/api\/data-sources\/([^/]+)\/import-sqlite$/);
      if (req.method === 'POST' && dsImportSqliteMatch) {
        try {
          const dsId = decodeURIComponent(dsImportSqliteMatch[1]);
          const body = await readJsonBody<{ resumeJobId?: string }>(req).catch(() => ({} as { resumeJobId?: string }));
          const job = await importJobManager.startSqliteImportJob(dsId, body.resumeJobId);
          sendJson(res, 200, { ok: true, job });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      const dsDelMatch = pathname.match(/^\/api\/data-sources\/([^/]+)$/);
      if (req.method === 'DELETE' && dsDelMatch) {
        try {
          const ok = dataSourceStore.delete(decodeURIComponent(dsDelMatch[1]));
          sendJson(res, 200, { ok: true, deleted: ok });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      const dsImportMatch = pathname.match(/^\/api\/data-sources\/([^/]+)\/import$/);
      if (req.method === 'POST' && dsImportMatch) {
        const dsId = decodeURIComponent(dsImportMatch[1]);
        const ds = dataSourceStore.get(dsId);
        if (!ds) {
          sendError(res, 404, `未找到数据源: ${dsId}`);
          return;
        }
        const resolvedPath = resolvePhysicalPath(ds.path, ds.id);
        if (!fs.existsSync(resolvedPath)) {
          sendError(res, 400, `数据源路径不存在或不可访问: ${resolvedPath}`);
          return;
        }
        try {
          const runId = dataSourceStore.resolveRunIdForSource(ds.id);
          let situation;
          if (ds.kind === 'csv_dir') {
            situation = await buildSituationModel({
              runId,
              csvDir: resolvedPath,
              scenarioPath: ds.path,
            });
          } else {
            situation = await buildSituationModel({
              runId,
              jsonlFile: resolvedPath,
              scenarioPath: ds.path,
            });
          }
          situation.scenarioName = ds.name || ds.scenarioName || situation.scenarioName;
          sqliteStore.saveSituationRun(situation);
          sendJson(res, 200, {
            ok: true,
            runId: situation.runId,
            scenarioName: situation.scenarioName,
            coverage: situation.coverage,
            sides: situation.sides,
            unitCount: situation.units.size,
            eventCount: situation.events.length,
          });
        } catch (err) {
          sendError(res, 500, `导入数据源失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }

      // ─── 推演 Run 导入与 eval.db 探针 ───
      if (req.method === 'GET' && pathname === '/api/runs') {
        sendJson(res, 200, { ok: true, runs: sqliteStore.listRuns() });
        return;
      }

      const runDelMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (req.method === 'DELETE' && runDelMatch) {
        try {
          const runId = decodeURIComponent(runDelMatch[1]);
          const isAsync = reqUrl.searchParams.get('async') === 'true';
          if (isAsync) {
            const existingRun = sqliteStore.listRuns().find((r) => r.runId === runId);
            const job = await importJobManager.startDeleteRunJob(runId, existingRun?.scenarioName);
            sendJson(res, 200, { ok: true, job });
            return;
          }
          const deleted = sqliteStore.deleteRun(runId);
          sendJson(res, 200, { ok: true, deleted, runId });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/api/runs/import') {
        const body = await readJsonBody<{
          kind: 'builtin_gj11' | 'builtin_bs' | 'builtin_55th' | '55th_taihai' | 'csv_dir' | 'jsonl_file' | 'jsonl_text';
          runId?: string;
          scenarioName?: string;
          path?: string;
          text?: string;
          unitPrices?: Record<string, number>;
          criteriaResults?: Record<string, boolean>;
        }>(req);

        const runId = body.runId?.trim() || `run_${crypto.randomUUID().slice(0, 8)}`;
        let situation;
        if (body.kind === 'builtin_gj11') {
          situation = await buildSituationModel({
            runId,
            csvDir: BUILTIN_SAMPLES.gj11CsvDir,
            unitPrices: body.unitPrices,
            criteriaResults: body.criteriaResults,
          });
          situation.scenarioName = body.scenarioName || 'GJ-11 vs HaveRaider BVR实测CSV';
        } else if (body.kind === 'builtin_55th' || (body as any).kind === '55th_taihai') {
          const default55th = dataSourceStore.get('55th_taihai_csv')?.path ?? BUILTIN_SAMPLES.taihaiCsvDir;
          situation = await buildSituationModel({
            runId,
            csvDir: default55th,
            scenarioPath: default55th,
            unitPrices: body.unitPrices,
            criteriaResults: body.criteriaResults,
          });
          situation.scenarioName = body.scenarioName || '55所台海场景实测 (EventExport_CSV)';
        } else if ((body.kind as string) === 'builtin_gj11') {
          situation = await buildSituationModel({
            runId,
            csvDir: BUILTIN_SAMPLES.gj11CsvDir,
            unitPrices: body.unitPrices,
            criteriaResults: body.criteriaResults,
          });
          situation.scenarioName = body.scenarioName || 'GJ-11 vs HaveRaider BVR实测CSV';
        } else if (body.kind === 'builtin_bs') {
          situation = await buildSituationModel({
            runId,
            jsonlFile: BUILTIN_SAMPLES.bsSampleJsonl,
            unitPrices: body.unitPrices,
            criteriaResults: body.criteriaResults,
          });
          situation.scenarioName = body.scenarioName || 'BS 状态帧样例 (bs-frames-sample.jsonl)';
        } else if (body.kind === 'csv_dir') {
          if (!body.path) throw new Error('csv_dir 模式必须提供 path');
          situation = await buildSituationModel({
            runId,
            csvDir: body.path,
            unitPrices: body.unitPrices,
            criteriaResults: body.criteriaResults,
          });
          if (body.scenarioName) situation.scenarioName = body.scenarioName;
        } else if (body.kind === 'jsonl_file') {
          if (!body.path) throw new Error('jsonl_file 模式必须提供 path');
          situation = await buildSituationModel({
            runId,
            jsonlFile: body.path,
            unitPrices: body.unitPrices,
            criteriaResults: body.criteriaResults,
          });
          if (body.scenarioName) situation.scenarioName = body.scenarioName;
        } else if (body.kind === 'jsonl_text') {
          if (!body.text) throw new Error('jsonl_text 模式必须提供 text');
          situation = await buildSituationModel({
            runId,
            jsonlText: body.text,
            scenarioPath: '<uploaded.jsonl>',
            unitPrices: body.unitPrices,
            criteriaResults: body.criteriaResults,
          });
          situation.scenarioName = body.scenarioName || '<uploaded.jsonl>';
        } else {
          sendError(res, 400, `未知导入类型: ${String(body.kind)}`);
          return;
        }

        sqliteStore.saveSituationRun(situation);
        sendJson(res, 200, {
          ok: true,
          runId: situation.runId,
          scenarioName: situation.scenarioName,
          coverage: situation.coverage,
          sides: situation.sides,
          unitCount: situation.units.size,
          eventCount: situation.events.length,
        });
        return;
      }

      const runDetailMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (req.method === 'GET' && runDetailMatch) {
        const sit = sqliteStore.getRunSituation(runDetailMatch[1]);
        if (!sit) {
          sendError(res, 404, `未找到运行记录: ${runDetailMatch[1]}`);
          return;
        }
        sendJson(res, 200, {
          ok: true,
          runId: sit.runId,
          scenarioName: sit.scenarioName,
          scenarioPath: sit.scenarioPath,
          startGameClock: sit.startGameClock,
          endGameClock: sit.endGameClock,
          totalGameSeconds: sit.totalGameSeconds,
          sides: sit.sides,
          coverage: sit.coverage,
          units: [...sit.units.values()].map((u) => ({
            unitId: u.unitId,
            unitName: u.unitName,
            side: u.side,
            unitType: u.unitType,
            unitClass: u.unitClass,
            damageState: u.damageState,
            ammoRemaining: u.ammoRemaining,
            trackPointCount: u.trackPoints.length,
          })),
        });
        return;
      }

      const runEventsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
      if (req.method === 'GET' && runEventsMatch) {
        const eventsRes = sqliteStore.queryEvents(runEventsMatch[1], {
          kind: reqUrl.searchParams.get('kind') || undefined,
          side: reqUrl.searchParams.get('side') || undefined,
          severity: reqUrl.searchParams.get('severity') || undefined,
          search: reqUrl.searchParams.get('search') || undefined,
          limit: reqUrl.searchParams.get('limit') ? Number(reqUrl.searchParams.get('limit')) : undefined,
          offset: reqUrl.searchParams.get('offset') ? Number(reqUrl.searchParams.get('offset')) : undefined,
        });
        sendJson(res, 200, { ok: true, ...eventsRes });
        return;
      }

      const runTracksMatch = pathname.match(/^\/api\/runs\/([^/]+)\/tracks$/);
      if (req.method === 'GET' && runTracksMatch) {
        const tracks = sqliteStore.queryUnitTracks(runTracksMatch[1]);
        sendJson(res, 200, { ok: true, tracks });
        return;
      }

      const runSourceProfileMatch = pathname.match(/^\/api\/runs\/([^/]+)\/source-profile$/);
      if (req.method === 'GET' && runSourceProfileMatch) {
        const runId = runSourceProfileMatch[1];
        const rawPreviewTable = reqUrl.searchParams.get('previewTable') ?? undefined;
        if (rawPreviewTable !== undefined && !isSafePreviewQuery(rawPreviewTable)) {
          sendError(res, 400, '非法的 previewTable 参数（禁止路径分隔符与 ..）');
          return;
        }
        if (!rawPreviewTable) {
          const cached = sourceProfileCache.get(runId);
          if (cached && Date.now() - cached.cachedAt < 30_000) {
            sendJson(res, 200, { ok: true, profile: cached.profile });
            return;
          }
        }
        const sit = sqliteStore.getRunSituation(runId);
        if (!sit) {
          sendError(res, 404, `未找到运行记录: ${runId}`);
          return;
        }
        const rawLimit = Number(reqUrl.searchParams.get('previewLimit') ?? '50');
        const previewLimit = Number.isFinite(rawLimit)
          ? Math.max(1, Math.min(200, Math.floor(rawLimit)))
          : 50;
        const catalog = loadFieldsCatalog() ?? {};
        const profile = buildRunSourceProfile({
          situation: sit,
          catalog,
          operators: v4OperatorStore.list().map((op) => ({
            id: op.id,
            name: op.name,
            category: op.category,
            description: op.description,
            readiness: 'batch_a_ready' as const,
            requiredDataSources: ['csv' as const],
            outputType: 'score' as const,
            unit: '',
            defaultOptimalDirection: 'larger_is_better' as const,
            f1FieldContract: {
              csvTables: op.requiredTables,
              csvColumns: op.outputColumns,
            },
          })),
          previewTable: rawPreviewTable,
          previewLimit,
        });
        if (!rawPreviewTable) {
          sourceProfileCache.set(runId, { cachedAt: Date.now(), profile });
        }
        sendJson(res, 200, { ok: true, profile });
        return;
      }

      const runTableDataMatch = pathname.match(/^\/api\/runs\/([^/]+)\/table-data$/);
      if (req.method === 'GET' && runTableDataMatch) {
        const runId = decodeURIComponent(runTableDataMatch[1]);
        const tableName = reqUrl.searchParams.get('tableName') || '';
        const filterField = reqUrl.searchParams.get('filterField') || undefined;
        const filterEquals = reqUrl.searchParams.get('filterEquals') || undefined;
        const rawLimit = Number(reqUrl.searchParams.get('limit') ?? '200');
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(2000, Math.floor(rawLimit))) : 200;

        const sit = sqliteStore.getRunSituation(runId);
        if (!sit) {
          sendError(res, 404, `未找到推演场次记录: ${runId}`);
          return;
        }

        const extractRes = extractRunTableDataset(sit, tableName, { filterField, filterEquals, limit });
        sendJson(res, 200, {
          ok: true,
          found: extractRes.found,
          dataset: extractRes.dataset,
          reason: extractRes.reason,
          scenarioName: sit.scenarioName || sit.runId,
          runId: sit.runId,
        });
        return;
      }

      // ─── 实时 Q-109 研判与 SSE 流 ───
      if (req.method === 'GET' && pathname === '/api/realtime/stream') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      if (req.method === 'POST' && pathname === '/api/realtime/sessions') {
        const body = await readJsonBody<{
          runId?: string;
          source?: 'builtin_bs' | 'jsonl_text' | 'data_source';
          sourceId?: string;
          jsonlText?: string;
          jsonlLines?: string[];
          jsonlFile?: string;
          systemId?: string;
          speedMultiplier?: number;
        }>(req);

        // 安全防线：拒绝任意未注册路径直传
        if (body.jsonlFile !== undefined) {
          sendError(res, 400, '禁止直接传递任意文件路径 jsonlFile，请使用已注册的 sourceId 或内联 jsonlLines');
          return;
        }

        const runId = body.runId?.trim() || `rt_${crypto.randomUUID().slice(0, 8)}`;
        if (Array.isArray(body.jsonlLines) && body.jsonlLines.length > 0) {
          const lines = body.jsonlLines.map((l) => String(l).trim()).filter((l) => l.length > 0);
          monitor.createSessionFromLines({
            runId,
            scenarioPath: '<realtime_inline_lines>',
            lines,
            systemId: body.systemId,
            speedMultiplier: body.speedMultiplier,
          });
        } else if (body.jsonlText && body.jsonlText.trim()) {
          const lines = body.jsonlText.split(/\r?\n/).filter((l) => l.trim().length > 0);
          monitor.createSessionFromLines({
            runId,
            scenarioPath: '<realtime_stream>',
            lines,
            systemId: body.systemId,
            speedMultiplier: body.speedMultiplier,
          });
        } else if (body.sourceId && body.sourceId.trim()) {
          const ds = dataSourceStore.get(body.sourceId.trim());
          if (!ds) {
            sendError(res, 404, `未找到已注册数据源: ${body.sourceId}`);
            return;
          }
          if (ds.kind !== 'jsonl_file') {
            sendError(res, 400, `数据源 ${ds.id} 类型为 ${ds.kind}，实时伴随流仅支持 jsonl_file 数据源`);
            return;
          }
          const resolvedJsonl = resolvePhysicalPath(ds.path, ds.id);
          if (!fs.existsSync(resolvedJsonl)) {
            sendError(res, 400, `数据源文件不存在: ${resolvedJsonl}`);
            return;
          }
          monitor.createSessionFromFile({
            runId,
            jsonlFile: resolvedJsonl,
            systemId: body.systemId,
            speedMultiplier: body.speedMultiplier,
          });
        } else {
          monitor.createSessionFromFile({
            runId,
            jsonlFile: BUILTIN_SAMPLES.bsSampleJsonl,
            systemId: body.systemId,
            speedMultiplier: body.speedMultiplier,
          });
        }
        sendJson(res, 200, { ok: true, snapshot: monitor.getSessionSnapshot(runId) });
        return;
      }

      const rtGetMatch = pathname.match(/^\/api\/realtime\/sessions\/([^/]+)$/);
      if (req.method === 'GET' && rtGetMatch) {
        const snap = monitor.getSessionSnapshot(rtGetMatch[1]);
        if (!snap) {
          sendError(res, 404, `未找到实时会话: ${rtGetMatch[1]}`);
          return;
        }
        sendJson(res, 200, { ok: true, snapshot: snap });
        return;
      }

      const rtCtrlMatch = pathname.match(/^\/api\/realtime\/sessions\/([^/]+)\/control$/);
      if (req.method === 'POST' && rtCtrlMatch) {
        const runId = rtCtrlMatch[1];
        const body = await readJsonBody<{
          action: 'play' | 'pause' | 'step' | 'stop' | 'push_frame';
          speedMultiplier?: number;
          frameLine?: string;
        }>(req);

        if (body.action === 'play') {
          monitor.startPlayback(runId, body.speedMultiplier);
        } else if (body.action === 'pause') {
          monitor.pausePlayback(runId);
        } else if (body.action === 'step') {
          await monitor.stepFrame(runId);
        } else if (body.action === 'push_frame') {
          if (!body.frameLine) throw new Error('push_frame 必须提供 frameLine');
          await monitor.stepFrame(runId, body.frameLine);
        } else if (body.action === 'stop') {
          monitor.stopSession(runId);
          sendJson(res, 200, { ok: true, stopped: true });
          return;
        }
        sendJson(res, 200, { ok: true, snapshot: monitor.getSessionSnapshot(runId) });
        return;
      }

      const rtCardMatch = pathname.match(/^\/api\/realtime\/sessions\/([^/]+)\/cards\/([^/]+)\/action$/);
      if (req.method === 'POST' && rtCardMatch) {
        const [, runId, cardId] = rtCardMatch;
        const body = await readJsonBody<{
          action: 'observe' | 'pause_inspect' | 'ignore_expected';
          note?: string;
        }>(req);
        const updated = monitor.resolveCard(runId, cardId, body.action, body.note);
        if (!updated) {
          sendError(res, 404, `未找到 Q-109 研判卡片: ${cardId}`);
          return;
        }
        sendJson(res, 200, { ok: true, card: updated, snapshot: monitor.getSessionSnapshot(runId) });
        return;
      }

      // ─── 静态 SPA 托管 (构建后单端口直访) ───
      if (req.method === 'GET' && !pathname.startsWith('/api/')) {
        if (serveStaticFile(distUiDir, pathname, res)) {
          return;
        }
      }

      sendError(res, 404, `Not Found: ${req.method} ${pathname}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendError(res, 500, msg);
    }
  });

  return {
    server,
    get sqliteStore() {
      return sqliteStore;
    },
    v4OperatorStore,
    effectStore,
    metricGraphStore,
    systemDagStore,
    componentStore,
    monitor,
    ensureSeedData,
    switchActiveDatabase,
    close: async () => {
      for (const c of sseClients) {
        c.end();
      }
      sseClients.clear();
      await disposeV4OperatorPool().catch(() => {});
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      sqliteStore.close();
    },
  };
}

// 仅当直接启动 server.ts 时自动监听端口 127.0.0.1:7280
const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const port = Number(process.env.PORT ?? 7280);
  const host = process.env.HOST ?? '127.0.0.1';
  createEvalApp({ autoSeed: false })
    .then((app) => {
      app.server.listen(port, host, () => {
        console.log(`[eval-service] listening on http://${host}:${port}`);
      });
    })
    .catch((err) => {
      console.error('[eval-service] startup failed:', err);
      process.exit(1);
    });
}
