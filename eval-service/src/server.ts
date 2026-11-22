import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  EvalSqliteStore,
  cloneDatabaseFile,
  listAvailableDatabases,
  type DatabaseInfo,
} from './adapters/sqlite-store.ts';
import {
  DataSourceStore,
  probeSimulationPath,
  type SimulationDataSource,
} from './adapters/data-source-store.ts';
import { sampleScoringCurve } from './core/scoring-functions.ts';
import { buildSituationModel } from './core/situation-model.ts';
import type {
  BuiltinOperatorOverride,
  CustomOperatorDefinition,
  IndicatorDefinition,
  IndicatorSystem,
  OperatorComparisonRow,
  ScoringRule,
  SystemDimensionNode,
  SystemEvaluationOutput,
  SystemIndicatorLeaf,
} from './core/types.ts';
import {
  IndicatorStore,
  extractAtomRefParts,
  isAlarmThresholdTriggered,
  resolveIndicatorOutputFromAtoms,
} from './indicators/store.ts';
import {
  getOperatorCategories,
  handleOperatorPreview,
  handleValidateFormula,
} from './engine/api.ts';
import { draftSystemFromNaturalLanguage } from './nl/intent-mapper.ts';
import { CustomOperatorStore } from './operators/custom-store.ts';
import { runPythonMetricsAdapter } from './operators/effectiveness/metrics-py-adapter.ts';
import {
  computeAhpWeights,
  computeEntropyWeights,
  computeCriticWeights,
  computeCombinedWeights,
  computeTopsisRank,
  computeVikorRank,
  runPythonSandboxScript,
} from './operators/mcda-adapter.ts';
import { OperatorOverrideStore } from './operators/override-store.ts';
import { getOperatorPipelineBlueprint } from './operators/blueprints.ts';
import { deriveContractFromNodes, extractRunTableDataset } from './operators/pipeline-utils.ts';
import {
  defaultComponentStore,
  validateComponentManifest,
  type ComponentManifest,
} from './operators/component-store.ts';
import {
  BUILTIN_OPERATOR_IDS,
  evaluateAllOperators,
  evaluateOperator,
  getOperatorMeta,
  hasOperator,
  listOperatorMetas,
  previewCustomFormula,
  sweepOperatorParameter,
} from './operators/registry.ts';
import {
  buildRunSourceProfile,
  isSafePreviewQuery,
  type F1OutputCatalog,
} from './adapters/source-profiler.ts';
import { RealtimeMonitor } from './realtime/monitor.ts';
import { generateTacticalFeedback } from './reports/feedback-generator.ts';
import { generateEvaluationReportMarkdown } from './reports/report-generator.ts';
import { evaluateIndicatorSystem } from './systems/evaluator.ts';
import { SystemStore } from './systems/store.ts';
import {
  isDimensionNode,
  normalizeSystemWeights,
  validateIndicatorSystem,
} from './systems/validator.ts';

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
  customOperatorsPath?: string;
  operatorOverridesPath?: string;
  operatorPipelinesPath?: string;
  customIndicatorsPath?: string;
  customSystemsPath?: string;
  dataSourcesPath?: string;
  distUiDir?: string;
  autoSeed?: boolean;
  sqliteStore?: EvalSqliteStore;
  customOperatorStore?: CustomOperatorStore;
  operatorOverrideStore?: OperatorOverrideStore;
  indicatorStore?: IndicatorStore;
  systemStore?: SystemStore;
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
    // 默认优先加载最全的 eval.db 统一数据库（完整承载算子/指标/体系三库资产与推演数据）
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
    'listCustomOperators',
    'getCustomOperator',
    'saveCustomOperator',
    'deleteCustomOperator',
    'listOperatorOverrides',
    'getOperatorOverride',
    'saveOperatorOverride',
    'deleteOperatorOverride',
    'getOperatorPipeline',
    'saveOperatorPipeline',
    'listIndicators',
    'getIndicator',
    'saveIndicator',
    'deleteIndicator',
    'listSystems',
    'getSystem',
    'saveSystem',
    'deleteSystem',
    'listOperatorDefinitions',
    'getOperatorDefinition',
    'saveOperatorDefinition',
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
              realtimeCards: scStats.counts.realtimeCards ?? 0,
              builtinOperators: opStats.counts.builtinOperators ?? 0,
              customOperators: opStats.counts.customOperators ?? 0,
              totalOperators: opStats.counts.totalOperators ?? 0,
              operatorOverrides: opStats.counts.operatorOverrides ?? 0,
              operatorPipelines: opStats.counts.operatorPipelines ?? 0,
              indicators: opStats.counts.indicators ?? 0,
              systems: opStats.counts.systems ?? 0,
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
  const customOperatorStore =
    deps?.customOperatorStore ?? new CustomOperatorStore(deps?.customOperatorsPath, operatorSqliteStore);
  const operatorOverrideStore =
    deps?.operatorOverrideStore ?? new OperatorOverrideStore(deps?.operatorOverridesPath, operatorSqliteStore);
  const indicatorStore =
    deps?.indicatorStore ??
    new IndicatorStore(
      deps?.customIndicatorsPath,
      (atomId) => hasOperator(atomId, customOperatorStore),
      operatorSqliteStore,
    );
  const systemStore =
    deps?.systemStore ?? new SystemStore(deps?.customSystemsPath, indicatorStore, operatorSqliteStore);
  const monitor = new RealtimeMonitor({ sqliteStore: scenarioSqliteStore, indicatorStore });
  const distUiDir = deps?.distUiDir ?? path.join(EVAL_SERVICE_ROOT, 'dist-ui');

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

        const bvrSys = systemStore.get('sys_corridor_compliance_v1') || systemStore.listAll()[0];
        if (bvrSys) {
          const pyRes = await runPythonMetricsAdapter(BUILTIN_SAMPLES.gj11CsvDir).catch(() => null);
          const out = evaluateIndicatorSystem(
            bvrSys,
            {
              runId: gj11Sit.runId,
              situation: gj11Sit,
              csvStats: pyRes?.metrics,
              customParams: { targetSide: '红方', enemySide: '蓝方' },
            },
            { indicatorStore, customOperatorStore, operatorOverrideStore },
          );
          const md = generateEvaluationReportMarkdown(out, gj11Sit);
          const fb = generateTacticalFeedback(out, gj11Sit);
          sqliteStore.saveEvaluation(out, md, fb);
        }
      }

      if (fs.existsSync(BUILTIN_SAMPLES.bsSampleJsonl) && (!sqliteStore.getRunSituation('bs_sample_swarm_demo') || force)) {
        const bsSit = await buildSituationModel({
          runId: 'bs_sample_swarm_demo',
          jsonlFile: BUILTIN_SAMPLES.bsSampleJsonl,
          scenarioPath: BUILTIN_SAMPLES.bsSampleJsonl,
        });
        bsSit.scenarioName = 'BS 状态帧基准集群样例 (bs-frames-sample.jsonl)';
        sqliteStore.saveSituationRun(bsSit);

        const swarmSys = systemStore.get('sys_corridor_compliance_v1') || systemStore.listAll()[0];
        if (swarmSys) {
          const out = evaluateIndicatorSystem(
            swarmSys,
            { runId: bsSit.runId, situation: bsSit },
            { indicatorStore, customOperatorStore, operatorOverrideStore },
          );
          const md = generateEvaluationReportMarkdown(out, bsSit);
          const fb = generateTacticalFeedback(out, bsSit);
          sqliteStore.saveEvaluation(out, md, fb);
        }
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
  monitor.subscribe((payload) => {
    const msg = `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
      if (!client.writableEnded) {
        client.write(msg);
      }
    }
  });

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
      customOperatorStore.rebindSqliteStore(operatorSqliteStore);
      operatorOverrideStore.rebindSqliteStore(operatorSqliteStore);
      indicatorStore.rebindSqliteStore(operatorSqliteStore);
      systemStore.rebindSqliteStore(operatorSqliteStore);
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
    customOperatorStore.rebindSqliteStore(operatorSqliteStore);
    operatorOverrideStore.rebindSqliteStore(operatorSqliteStore);
    indicatorStore.rebindSqliteStore(operatorSqliteStore);
    systemStore.rebindSqliteStore(operatorSqliteStore);
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
          builtinOperatorsCount: BUILTIN_OPERATOR_IDS.size,
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
            sendJson(res, 200, { ok: true, created: safeFilename, switched: true, ...switchRes });
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
            sendJson(res, 200, { ok: true, cloned: safeFilename, switched: true, ...switchRes });
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
            sendJson(res, 200, { ok: true, uploaded: safeFilename, switched: true, ...switchRes });
          } else {
            sendJson(res, 200, { ok: true, uploaded: safeFilename, switched: false, size: buf.length });
          }
        } catch (err) {
          sendError(res, 500, '上传数据库失败: ' + String(err));
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

          // 核心自动同步：画布编排即算子真相源 (Single Source of Truth)
          // 自动将画布中的表输入、字段选择与计算参数同步至算子契约库中
          const derived = deriveContractFromNodes(body.nodes || []);
          if (BUILTIN_OPERATOR_IDS.has(body.operatorId)) {
            const existingOverride = operatorOverrideStore.get(body.operatorId);
            const existingMeta = getOperatorMeta(body.operatorId, customOperatorStore, operatorOverrideStore);
            operatorOverrideStore.upsert(
              {
                id: body.operatorId,
                name: existingOverride?.name || existingMeta?.name,
                unit: derived.unit || existingOverride?.unit || existingMeta?.unit,
                defaultOptimalDirection:
                  derived.optimalDirection ||
                  existingOverride?.defaultOptimalDirection ||
                  existingMeta?.defaultOptimalDirection,
                description: existingOverride?.description || existingMeta?.description,
                f1FieldContract: {
                  csvTables:
                    derived.csvTables.length > 0
                      ? derived.csvTables
                      : existingOverride?.f1FieldContract?.csvTables || existingMeta?.f1FieldContract?.csvTables,
                  csvColumns:
                    derived.csvColumns.length > 0
                      ? derived.csvColumns
                      : existingOverride?.f1FieldContract?.csvColumns || existingMeta?.f1FieldContract?.csvColumns,
                  bsFramePaths:
                    existingOverride?.f1FieldContract?.bsFramePaths || existingMeta?.f1FieldContract?.bsFramePaths,
                  discrepancyNotes: [
                    ...(existingOverride?.f1FieldContract?.discrepancyNotes ||
                      existingMeta?.f1FieldContract?.discrepancyNotes ||
                      []),
                    ...derived.discrepancyNotes,
                  ].filter((v, i, a) => a.indexOf(v) === i),
                },
                defaultParams: {
                  ...(existingMeta?.defaultParams || {}),
                  ...(existingOverride?.defaultParams || {}),
                  ...derived.defaultParams,
                },
              },
              BUILTIN_OPERATOR_IDS,
            );
          } else if (customOperatorStore.get(body.operatorId)) {
            const customDef = customOperatorStore.get(body.operatorId)!;
            const allKnown = new Set(
              listOperatorMetas(customOperatorStore, operatorOverrideStore).map((m) => m.id),
            );
            customOperatorStore.upsert(
              {
                ...customDef,
                unit: derived.unit || customDef.unit,
                defaultOptimalDirection: derived.optimalDirection || customDef.defaultOptimalDirection,
                f1FieldContract: {
                  csvTables:
                    derived.csvTables.length > 0
                      ? derived.csvTables
                      : customDef.f1FieldContract?.csvTables,
                  csvColumns:
                    derived.csvColumns.length > 0
                      ? derived.csvColumns
                      : customDef.f1FieldContract?.csvColumns,
                  bsFramePaths: customDef.f1FieldContract?.bsFramePaths,
                  discrepancyNotes: [
                    ...(customDef.f1FieldContract?.discrepancyNotes || []),
                    ...derived.discrepancyNotes,
                  ].filter((v, i, a) => a.indexOf(v) === i),
                },
                defaultParams: {
                  ...(customDef.defaultParams || {}),
                  ...derived.defaultParams,
                },
              },
              BUILTIN_OPERATOR_IDS,
              allKnown,
            );
          }

          sendJson(res, 200, {
            ok: true,
            message: `算子 [${body.operatorId}] 流水线配置已成功持久化，并已自动同步底层数据契约与参数`,
            saved: pipelineRecord,
            derivedContract: derived,
            updatedMeta: getOperatorMeta(body.operatorId, customOperatorStore, operatorOverrideStore),
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

      // ─── 一库：算子库 ───
      if (req.method === 'GET' && pathname === '/api/operators/categories') {
        const catData = getOperatorCategories(customOperatorStore, operatorOverrideStore);
        sendJson(res, 200, catData);
        return;
      }

      if (req.method === 'POST' && pathname === '/api/operators/preview') {
        try {
          const body = await readJsonBody(req);
          const preview = handleOperatorPreview(body);
          sendJson(res, 200, preview);
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/api/operators/validate-formula') {
        try {
          const body = await readJsonBody(req);
          const valRes = handleValidateFormula(body);
          sendJson(res, 200, valRes);
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
          components: defaultComponentStore.list(),
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
          const imported = defaultComponentStore.import(manifest);
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
          const deleted = defaultComponentStore.delete(compId);
          sendJson(res, 200, { ok: true, deleted, id: compId });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      if (req.method === 'GET' && pathname === '/api/operators') {
        sendJson(res, 200, {
          ok: true,
          operators: listOperatorMetas(customOperatorStore, operatorOverrideStore),
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/operators') {
        const body = await readJsonBody<CustomOperatorDefinition>(req);
        try {
          const allKnown = new Set(
            listOperatorMetas(customOperatorStore, operatorOverrideStore).map((m) => m.id),
          );
          const saved = customOperatorStore.upsert(body, BUILTIN_OPERATOR_IDS, allKnown);
          sendJson(res, 200, {
            ok: true,
            operator: saved,
            meta: getOperatorMeta(saved.id, customOperatorStore, operatorOverrideStore),
          });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      const opOverrideDelMatch = pathname.match(/^\/api\/operators\/([^/]+)\/override$/);
      if (req.method === 'DELETE' && opOverrideDelMatch) {
        const atomId = opOverrideDelMatch[1];
        if (!BUILTIN_OPERATOR_IDS.has(atomId)) {
          sendError(res, 400, `仅内置标准算子支持恢复默认覆写: ${atomId}`);
          return;
        }
        const reset = operatorOverrideStore.delete(atomId);
        const restored = getOperatorMeta(atomId, customOperatorStore, operatorOverrideStore);
        sendJson(res, 200, { ok: true, reset, operator: restored });
        return;
      }

      const opPutMatch = pathname.match(/^\/api\/operators\/([^/]+)$/);
      if (req.method === 'PUT' && opPutMatch) {
        const atomId = opPutMatch[1];
        try {
          if (BUILTIN_OPERATOR_IDS.has(atomId)) {
            const body = await readJsonBody<BuiltinOperatorOverride>(req);
            const saved = operatorOverrideStore.upsert(
              { ...body, id: atomId },
              BUILTIN_OPERATOR_IDS,
            );
            const meta = getOperatorMeta(atomId, customOperatorStore, operatorOverrideStore);
            sendJson(res, 200, { ok: true, operator: meta, override: saved });
            return;
          }
          if (customOperatorStore.get(atomId)) {
            const body = await readJsonBody<CustomOperatorDefinition>(req);
            const allKnown = new Set(
              listOperatorMetas(customOperatorStore, operatorOverrideStore).map((m) => m.id),
            );
            const saved = customOperatorStore.upsert(
              { ...body, id: atomId },
              BUILTIN_OPERATOR_IDS,
              allKnown,
            );
            const meta = getOperatorMeta(atomId, customOperatorStore, operatorOverrideStore);
            sendJson(res, 200, { ok: true, operator: meta, customDef: saved });
            return;
          }
          sendError(res, 404, `未找到算子: ${atomId}`);
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      const opDelMatch = pathname.match(/^\/api\/operators\/([^/]+)$/);
      if (req.method === 'DELETE' && opDelMatch) {
        const atomId = opDelMatch[1];
        if (BUILTIN_OPERATOR_IDS.has(atomId)) {
          sendError(res, 400, `不允许删除内置标准算子: ${atomId}`);
          return;
        }
        const usedByIndicators = indicatorStore
          .listAll()
          .filter((i) => i.atomRef === atomId)
          .map((i) => i.indicatorId);
        if (usedByIndicators.length > 0) {
          sendError(
            res,
            409,
            `算子 ${atomId} 正被指标 (${usedByIndicators.join(', ')}) 引用，请先解除绑定后再删除`,
          );
          return;
        }
        const usedByCustomOps = customOperatorStore
          .listAll()
          .filter((c) => c.id !== atomId && c.variables.some((v) => v.atomRef === atomId))
          .map((c) => c.id);
        if (usedByCustomOps.length > 0) {
          sendError(
            res,
            409,
            `算子 ${atomId} 正被衍生算子引用 (${usedByCustomOps.join(', ')})，请先调整衍生公式后再删除`,
          );
          return;
        }
        const deleted = customOperatorStore.delete(atomId);
        if (fs.existsSync(OPERATOR_PIPELINES_FILE)) {
          try {
            const data = JSON.parse(fs.readFileSync(OPERATOR_PIPELINES_FILE, 'utf-8'));
            if (data[atomId]) {
              delete data[atomId];
              fs.writeFileSync(OPERATOR_PIPELINES_FILE, JSON.stringify(data, null, 2), 'utf-8');
            }
          } catch {
            // ignore
          }
        }
        sendJson(res, 200, { ok: true, deleted });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/operators/preview-formula') {
        const body = await readJsonBody<{
          definition: CustomOperatorDefinition;
          runId: string;
          customParams?: Record<string, unknown>;
        }>(req);
        const sit = sqliteStore.getRunSituation(body.runId);
        if (!sit) {
          sendError(res, 404, `未找到运行记录: ${body.runId}`);
          return;
        }
        const preview = previewCustomFormula(
          body.definition,
          { runId: body.runId, situation: sit, customParams: body.customParams },
          customOperatorStore,
          operatorOverrideStore,
        );
        sendJson(res, 200, { ok: true, ...preview });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/operators/compare-runs') {
        const body = await readJsonBody<{
          runIdA: string;
          runIdB: string;
          customParams?: Record<string, unknown>;
        }>(req);
        const sitA = sqliteStore.getRunSituation(body.runIdA);
        const sitB = sqliteStore.getRunSituation(body.runIdB);
        if (!sitA || !sitB) {
          sendError(res, 404, `对比 Run 不存在: ${!sitA ? body.runIdA : body.runIdB}`);
          return;
        }
        const resA = evaluateAllOperators(
          { runId: body.runIdA, situation: sitA, customParams: body.customParams },
          customOperatorStore,
          operatorOverrideStore,
        );
        const resB = evaluateAllOperators(
          { runId: body.runIdB, situation: sitB, customParams: body.customParams },
          customOperatorStore,
          operatorOverrideStore,
        );
        const metas = listOperatorMetas(customOperatorStore, operatorOverrideStore);
        const rows: OperatorComparisonRow[] = metas.map((meta) => {
          const a = resA[meta.id]!;
          const b = resB[meta.id]!;
          const deltaNumeric =
            typeof a?.value === 'number' && typeof b?.value === 'number'
              ? Math.round((a.value - b.value) * 10000) / 10000
              : null;
          return { meta, runA: a, runB: b, deltaNumeric };
        });
        sendJson(res, 200, {
          ok: true,
          runIdA: body.runIdA,
          runIdB: body.runIdB,
          rows,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/operators/evaluate-all') {
        const body = await readJsonBody<{ runId: string; customParams?: Record<string, unknown> }>(req);
        const sit = sqliteStore.getRunSituation(body.runId);
        if (!sit) {
          sendError(res, 404, `未找到运行记录: ${body.runId}`);
          return;
        }
        const results = evaluateAllOperators(
          {
            runId: body.runId,
            situation: sit,
            customParams: body.customParams,
          },
          customOperatorStore,
          operatorOverrideStore,
        );
        sendJson(res, 200, { ok: true, runId: body.runId, results });
        return;
      }

      const opSweepMatch = pathname.match(/^\/api\/operators\/([^/]+)\/sweep$/);
      if (req.method === 'POST' && opSweepMatch) {
        const atomId = opSweepMatch[1];
        const body = await readJsonBody<{
          runId: string;
          paramKey: 'safeRadiusNm' | 'arrivalLineLon' | 'expectedSpacingNm' | 'minRangeNm' | 'waveGapSeconds';
          min: number;
          max: number;
          steps?: number;
          customParams?: Record<string, unknown>;
        }>(req);
        const sit = sqliteStore.getRunSituation(body.runId);
        if (!sit) {
          sendError(res, 404, `未找到运行记录: ${body.runId}`);
          return;
        }
        const points = sweepOperatorParameter(
          atomId,
          { runId: body.runId, situation: sit, customParams: body.customParams },
          body.paramKey,
          Number(body.min),
          Number(body.max),
          body.steps ?? 9,
          customOperatorStore,
          operatorOverrideStore,
        );
        sendJson(res, 200, { ok: true, atomId, paramKey: body.paramKey, points });
        return;
      }

      const opEvalMatch = pathname.match(/^\/api\/operators\/([^/]+)\/evaluate$/);
      if (req.method === 'POST' && opEvalMatch) {
        const atomId = opEvalMatch[1];
        const body = await readJsonBody<{ runId: string; customParams?: Record<string, unknown> }>(req);
        const sit = sqliteStore.getRunSituation(body.runId);
        if (!sit) {
          sendError(res, 404, `未找到运行记录: ${body.runId}`);
          return;
        }
        const result = evaluateOperator(
          atomId,
          {
            runId: body.runId,
            situation: sit,
            customParams: body.customParams,
          },
          customOperatorStore,
          new Set(),
          operatorOverrideStore,
        );
        sendJson(res, 200, { ok: true, result });
        return;
      }

      // ─── 二库：标准指标库 ───
      if (req.method === 'GET' && pathname === '/api/indicators') {
        sendJson(res, 200, { ok: true, indicators: indicatorStore.listAll() });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/indicators/preview-curve') {
        const body = await readJsonBody<{ scoring: ScoringRule; samples?: number }>(req);
        const points = sampleScoringCurve(body.scoring, body.samples ?? 40);
        sendJson(res, 200, { ok: true, points });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/indicators/backtest') {
        const body = await readJsonBody<{
          indicator: IndicatorDefinition;
          runIds?: string[];
          targetSide?: string;
        }>(req);
        if (!body?.indicator?.scoring?.type) {
          sendError(res, 400, '回测请求必须包含有效的 indicator.scoring');
          return;
        }

        const isComposite = body.indicator.bindingMode === 'composite';
        const neededBaseIds: string[] = [];

        if (isComposite) {
          if (!Array.isArray(body.indicator.sources) || body.indicator.sources.length === 0) {
            sendError(res, 400, '复合指标回测必须包含至少一个输入源 (sources)');
            return;
          }
          if (!body.indicator.composeFormula?.trim()) {
            sendError(res, 400, '复合指标回测必须包含复合公式 (composeFormula)');
            return;
          }
          const idSet = new Set<string>();
          for (const src of body.indicator.sources) {
            const { baseAtomId } = extractAtomRefParts(src.atomRef, src.targetField);
            if (!hasOperator(baseAtomId, customOperatorStore)) {
              sendError(res, 400, `未找到复合输入源算子: ${baseAtomId}`);
              return;
            }
            idSet.add(baseAtomId);
          }
          neededBaseIds.push(...idSet);
        } else {
          if (!body.indicator.atomRef) {
            sendError(res, 400, '单算子指标回测必须包含有效的 indicator.atomRef');
            return;
          }
          const { baseAtomId } = extractAtomRefParts(body.indicator.atomRef, body.indicator.targetField);
          if (!hasOperator(baseAtomId, customOperatorStore)) {
            sendError(res, 400, `未找到算子: ${baseAtomId}`);
            return;
          }
          neededBaseIds.push(baseAtomId);
        }

        const allRuns = sqliteStore.listRuns();
        const targetRuns =
          Array.isArray(body.runIds) && body.runIds.length > 0
            ? allRuns.filter((r) => body.runIds!.includes(r.runId))
            : allRuns;

        const results = targetRuns.map((run) => {
          const sit = sqliteStore.getRunSituation(run.runId);
          if (!sit) {
            return {
              runId: run.runId,
              scenarioName: run.scenarioName,
              sourceKind: run.sourceKind,
              status: 'unavailable' as const,
              rawValue: null,
              displayValue: '运行态缺失',
              score: null,
              alarmTriggered: false,
              missingDataReason: `无法加载场次 ${run.runId} 的态势数据`,
              evidenceRefs: [],
            };
          }

          const atomResultsMap: Record<string, MetricAtomResult> = {};
          for (const baseId of neededBaseIds) {
            const atomRes = evaluateOperator(
              baseId,
              {
                runId: run.runId,
                situation: sit,
                targetSide: body.targetSide?.trim() || undefined,
              },
              customOperatorStore,
              new Set(),
              operatorOverrideStore,
            );
            atomResultsMap[baseId] = atomRes;
          }

          if (!isComposite && body.indicator.atomRef) {
            atomResultsMap[body.indicator.atomRef] = atomResultsMap[neededBaseIds[0]];
          } else if (isComposite && Array.isArray(body.indicator.sources)) {
            for (const src of body.indicator.sources) {
              const { baseAtomId } = extractAtomRefParts(src.atomRef, src.targetField);
              if (atomResultsMap[baseAtomId]) {
                atomResultsMap[src.atomRef] = atomResultsMap[baseAtomId];
              }
            }
          }

          const resolved = resolveIndicatorOutputFromAtoms(body.indicator, atomResultsMap);
          const numVal =
            typeof resolved.rawResult.value === 'number' && Number.isFinite(resolved.rawResult.value)
              ? resolved.rawResult.value
              : typeof resolved.rawResult.value === 'boolean'
                ? resolved.rawResult.value
                  ? 1
                  : 0
                : null;
          return {
            runId: run.runId,
            scenarioName: run.scenarioName,
            sourceKind: run.sourceKind,
            status: resolved.rawResult.status,
            rawValue: resolved.rawResult.value,
            numericValue: numVal,
            displayValue: resolved.rawResult.displayValue,
            score: resolved.score,
            alarmTriggered:
              resolved.rawResult.status !== 'unavailable' &&
              isAlarmThresholdTriggered(resolved.rawResult.value, body.indicator.alarmThreshold),
            missingDataReason: resolved.rawResult.missingDataReason,
            evidenceRefs: resolved.rawResult.evidenceRefs.slice(0, 4),
            details: (resolved.rawResult.details as Record<string, unknown>) ?? undefined,
          };
        });

        const validNumeric = results
          .map((r) => r.numericValue)
          .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
        const validScores = results
          .map((r) => r.score)
          .filter((s): s is number => typeof s === 'number' && Number.isFinite(s));

        const round2 = (n: number) => Math.round(n * 100) / 100;
        const summary = {
          totalRuns: results.length,
          validCount: validNumeric.length,
          minValue: validNumeric.length > 0 ? Math.min(...validNumeric) : null,
          maxValue: validNumeric.length > 0 ? Math.max(...validNumeric) : null,
          avgValue:
            validNumeric.length > 0
              ? round2(validNumeric.reduce((a, b) => a + b, 0) / validNumeric.length)
              : null,
          minScore: validScores.length > 0 ? Math.min(...validScores) : null,
          maxScore: validScores.length > 0 ? Math.max(...validScores) : null,
          avgScore:
            validScores.length > 0
              ? round2(validScores.reduce((a, b) => a + b, 0) / validScores.length)
              : null,
        };

        sendJson(res, 200, { ok: true, results, summary });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/indicators/import') {
        const body = await readJsonBody<{ indicators: IndicatorDefinition[] }>(req);
        const saved = indicatorStore.upsertBatchCustom(body.indicators);
        sendJson(res, 200, { ok: true, count: saved.length, indicators: saved });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/indicators') {
        const body = await readJsonBody<IndicatorDefinition>(req);
        const saved = indicatorStore.upsertCustom(body);
        sendJson(res, 200, { ok: true, indicator: saved });
        return;
      }

      const indDelMatch = pathname.match(/^\/api\/indicators\/([^/]+)$/);
      if (req.method === 'DELETE' && indDelMatch) {
        const indId = decodeURIComponent(indDelMatch[1]);

        // 校验是否有三库评估体系正引用该指标 (级联删除安全保护)
        const referencingSystems: string[] = [];
        const scanNode = (n: any, sysName: string) => {
          if (n?.indicatorRef === indId) {
            referencingSystems.push(sysName);
            return;
          }
          if (Array.isArray(n?.children)) {
            for (const ch of n.children) {
              scanNode(ch, sysName);
            }
          }
        };

        for (const sys of systemStore.listAll()) {
          scanNode(sys.root, sys.name || sys.systemId);
        }

        if (referencingSystems.length > 0) {
          const uniqueSys = Array.from(new Set(referencingSystems));
          sendJson(res, 409, {
            ok: false,
            error: `指标 "${indId}" 正被评估体系 [${uniqueSys.join(', ')}] 引用，禁止直接删除。请先在对应评估体系中解除引用。`,
            referencingSystems: uniqueSys,
          });
          return;
        }

        const deleted = indicatorStore.deleteCustom(indId);
        sendJson(res, 200, { ok: true, deleted });
        return;
      }

      // ─── 三库：评估体系库 ───
      if (req.method === 'GET' && pathname === '/api/systems') {
        sendJson(res, 200, { ok: true, systems: systemStore.listAll() });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/systems/validate') {
        const body = await readJsonBody<{ system: IndicatorSystem; autoNormalize?: boolean }>(req);
        const sys = body.autoNormalize ? normalizeSystemWeights(body.system) : body.system;
        const validation = validateIndicatorSystem(sys, indicatorStore);
        sendJson(res, 200, { ok: true, system: sys, validation });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/systems') {
        const body = await readJsonBody<IndicatorSystem>(req);
        const saved = systemStore.upsertCustom(body);
        sendJson(res, 200, { ok: true, system: saved });
        return;
      }

      const sysDelMatch = pathname.match(/^\/api\/systems\/([^/]+)$/);
      if (req.method === 'DELETE' && sysDelMatch) {
        const deleted = systemStore.deleteCustom(sysDelMatch[1]);
        sendJson(res, 200, { ok: true, deleted });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/systems/draft-nl') {
        const body = await readJsonBody<{ prompt: string; systemId?: string; name?: string }>(req);
        if (!body.prompt || !body.prompt.trim()) {
          sendError(res, 400, '任务需求描述 prompt 不能为空');
          return;
        }
        const draft = await draftSystemFromNaturalLanguage(body.prompt, {
          systemId: body.systemId,
          name: body.name,
          indicatorStore,
        });
        sendJson(res, 200, { ok: true, ...draft });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/systems/objective-weights') {
        const body = await readJsonBody<{
          systemId?: string;
          system?: IndicatorSystem;
          dimensionIds?: string[];
          runIds?: string[];
          method?: 'entropy' | 'critic' | 'combined';
          objectiveMethod?: 'entropy' | 'critic';
          subjectiveWeights?: number[];
          alpha?: number;
        }>(req);

        const sys = body.system ?? (body.systemId ? systemStore.get(body.systemId) : null);
        if (!sys) {
          sendError(res, 400, '必须提供有效的 systemId 或完整 system 体系定义');
          return;
        }

        const rawRunIds =
          body.runIds && Array.isArray(body.runIds) && body.runIds.length > 0
            ? body.runIds
            : sqliteStore.listRuns().map((r) => r.runId);
        const candidateRunIds = Array.from(new Set(rawRunIds));
        if (candidateRunIds.length < 2) {
          sendError(res, 400, '客观赋权与组合赋权至少需要 2 个有效推演方案（Run）进行横向对比');
          return;
        }

        const allNodes: Array<SystemDimensionNode | SystemIndicatorLeaf> = [];
        const collectNodes = (node: SystemDimensionNode | SystemIndicatorLeaf) => {
          allNodes.push(node);
          if (isDimensionNode(node)) {
            for (const ch of node.children) collectNodes(ch);
          }
        };
        for (const ch of sys.root.children) collectNodes(ch);

        let targetNodes: Array<SystemDimensionNode | SystemIndicatorLeaf> = [];
        if (body.dimensionIds && body.dimensionIds.length > 0) {
          for (const tid of body.dimensionIds) {
            const found = allNodes.find((n) =>
              isDimensionNode(n) ? n.id === tid : n.indicatorRef === tid,
            );
            if (found) targetNodes.push(found);
          }
        } else {
          targetNodes = sys.root.children;
        }

        if (targetNodes.length < 2) {
          sendError(res, 400, '赋权目标节点数量必须大于等于 2 项');
          return;
        }

        const targetIds = targetNodes.map((n) => (isDimensionNode(n) ? n.id : n.indicatorRef));
        const targetNames = targetNodes.map((n) =>
          isDimensionNode(n) ? n.name : n.customLabel || indicatorStore.get(n.indicatorRef)?.name || n.indicatorRef,
        );
        const subjectiveWeightsFromSys = targetNodes.map((n) => n.weight);

        const findNodeScore = (evaluated: SystemEvaluationOutput, targetId: string): number | null => {
          const d = evaluated.dimensions.find((x) => x.id === targetId);
          if (d && d.score !== null) return d.score;
          const searchTree = (node: {
            children?: Array<{ kind: string; id?: string; indicatorRef?: string; name?: string; score: number | null; children?: unknown[] }>;
          }): number | null => {
            if (!node.children) return null;
            for (const c of node.children) {
              if (c.kind === 'dimension' && c.id === targetId) return c.score;
              if (c.kind === 'indicator' && (c.indicatorRef === targetId || c.name === targetId)) {
                return c.score;
              }
              if (c.children) {
                const sub = searchTree(c as { children?: Array<{ kind: string; id?: string; indicatorRef?: string; name?: string; score: number | null; children?: unknown[] }> });
                if (sub !== null) return sub;
              }
            }
            return null;
          };
          return searchTree(evaluated.rootTree as { children?: Array<{ kind: string; id?: string; indicatorRef?: string; name?: string; score: number | null; children?: unknown[] }> });
        };

        const validRuns: string[] = [];
        const matrix: number[][] = [];
        for (const rId of candidateRunIds) {
          const sit = sqliteStore.getRunSituation(rId);
          if (!sit) continue;

          let evalOut: SystemEvaluationOutput | null = null;
          if (!body.system) {
            const cached = sqliteStore.listEvaluations(rId).find((e) => e.systemId === sys.systemId);
            if (cached) {
              const full = sqliteStore.getEvaluation(cached.evalId);
              if (full) evalOut = full.output;
            }
          }
          if (!evalOut) {
            evalOut = evaluateIndicatorSystem(
              sys,
              { runId: rId, situation: sit },
              { indicatorStore, customOperatorStore, operatorOverrideStore },
            );
          }

          const rowScores = targetIds.map((tid) => {
            const sc = findNodeScore(evalOut!, tid);
            return sc !== null && Number.isFinite(sc) ? Number(sc) : 0;
          });
          validRuns.push(rId);
          matrix.push(rowScores);
        }

        if (validRuns.length < 2) {
          sendError(res, 400, '所选推演场次中有效可评估的方案少于 2 局，无法执行客观赋权对比');
          return;
        }

        const method = body.method ?? 'entropy';
        const directions = targetNames.map(() => 'larger_is_better' as const);
        let weights: number[] = [];
        let objectiveWeights: number[] = [];
        let diagnostics: Record<string, unknown> = {};

        if (method === 'entropy') {
          const ew = await computeEntropyWeights(matrix, directions, targetNames);
          weights = ew.weights;
          objectiveWeights = ew.weights;
          diagnostics = {
            entropies: ew.entropies,
            namedWeights: ew.namedWeights,
            note: ew.note,
          };
        } else if (method === 'critic') {
          const cw = await computeCriticWeights(matrix, directions, targetNames);
          weights = cw.weights;
          objectiveWeights = cw.weights;
          diagnostics = {
            stdDevs: cw.stdDevs,
            conflictScores: cw.conflictScores,
            namedWeights: cw.namedWeights,
            note: cw.note,
          };
        } else if (method === 'combined') {
          const objMethod = body.objectiveMethod ?? 'entropy';
          let objNote: string | undefined;
          if (objMethod === 'critic') {
            const cw = await computeCriticWeights(matrix, directions, targetNames);
            objectiveWeights = cw.weights;
            objNote = cw.note;
          } else {
            const ew = await computeEntropyWeights(matrix, directions, targetNames);
            objectiveWeights = ew.weights;
            objNote = ew.note;
          }

          const rawSub =
            body.subjectiveWeights && body.subjectiveWeights.length === targetNodes.length
              ? body.subjectiveWeights
              : subjectiveWeightsFromSys;
          const sumSub = rawSub.reduce((a, b) => a + b, 0) || 1;
          const subWeights = rawSub.map((w) => w / sumSub);
          const alpha = typeof body.alpha === 'number' ? Math.max(0, Math.min(1, body.alpha)) : 0.5;

          const comb = await computeCombinedWeights({
            subjectiveWeights: subWeights,
            objectiveWeights,
            alpha,
            criterionNames: targetNames,
          });
          weights = comb.weights;
          diagnostics = {
            alphaUsed: comb.alphaUsed,
            subjectiveUsed: comb.subjectiveUsed,
            objectiveUsed: comb.objectiveUsed,
            objectiveMethod: objMethod,
            namedWeights: comb.namedWeights,
            note: objNote,
          };
        } else {
          sendError(res, 400, `不支持的赋权方法: ${String(method)}`);
          return;
        }

        const sumW = weights.reduce((a, b) => a + b, 0) || 1;
        const normalizedWeights = weights.map((w) => Math.round((w / sumW) * 10000) / 10000);

        sendJson(res, 200, {
          ok: true,
          method,
          targetIds,
          targetNames,
          runs: validRuns,
          matrix,
          weights: normalizedWeights,
          normalizedWeights,
          objectiveWeights,
          diagnostics,
        });
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
        const knownRunIds = new Set(sqliteStore.listRuns().map((r) => r.runId));
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
          if (!fs.existsSync(ds.path)) {
            sendError(res, 400, `数据源路径不存在或不可访问: ${ds.path}`);
            return;
          }
          dataSourceStore.setActiveSourceId(ds.id);
          const runId = dataSourceStore.resolveRunIdForSource(ds.id);
          if (!sqliteStore.getRunSituation(runId)) {
            const situation =
              ds.kind === 'csv_dir'
                ? await buildSituationModel({ runId, csvDir: ds.path, scenarioPath: ds.path })
                : await buildSituationModel({ runId, jsonlFile: ds.path, scenarioPath: ds.path });
            situation.scenarioName = ds.name || ds.scenarioName || situation.scenarioName;
            sqliteStore.saveSituationRun(situation);
          }
          const knownRunIds = new Set(sqliteStore.listRuns().map((r) => r.runId));
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
          const body = await readJsonBody<{ path: string }>(req);
          const probeRes = probeSimulationPath(body.path);
          sendJson(res, 200, { ok: true, probe: probeRes });
        } catch (err) {
          sendError(res, 400, err instanceof Error ? err.message : String(err));
        }
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
        if (!fs.existsSync(ds.path)) {
          sendError(res, 400, `数据源路径不存在或不可访问: ${ds.path}`);
          return;
        }
        try {
          const runId = dataSourceStore.resolveRunIdForSource(ds.id);
          let situation;
          if (ds.kind === 'csv_dir') {
            situation = await buildSituationModel({
              runId,
              csvDir: ds.path,
              scenarioPath: ds.path,
            });
          } else {
            situation = await buildSituationModel({
              runId,
              jsonlFile: ds.path,
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
        } else if (body.kind === 'builtin_bs') {
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
          operators: listOperatorMetas(customOperatorStore, operatorOverrideStore),
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

      // ─── 事后评估执行与报告/反哺查询 ───
      if (req.method === 'POST' && pathname === '/api/evaluate') {
        const body = await readJsonBody<{
          runId: string;
          systemId?: string;
          system?: IndicatorSystem;
          previewOnly?: boolean;
          customParams?: Record<string, unknown>;
          runPythonMetrics?: boolean;
        }>(req);

        const sit = sqliteStore.getRunSituation(body.runId);
        if (!sit) {
          sendError(res, 404, `未找到运行记录: ${body.runId}`);
          return;
        }

        let sys: IndicatorSystem | undefined;
        if (body.system && typeof body.system === 'object') {
          const valRes = validateIndicatorSystem(body.system, indicatorStore);
          if (!valRes.valid) {
            sendError(res, 400, `草稿体系校验失败: ${valRes.errors.join('；')}`);
            return;
          }
          sys = body.system;
        } else if (body.systemId) {
          sys = systemStore.get(body.systemId);
          if (!sys) {
            sendError(res, 404, `未找到评估体系: ${body.systemId}`);
            return;
          }
        } else {
          sendError(res, 400, '必须提供 systemId 或 system 草稿对象');
          return;
        }

        let pyMetrics: Record<string, unknown> | undefined;
        let pyStatus: Record<string, unknown> | undefined;
        if (
          body.runPythonMetrics !== false &&
          (sit.coverage.sourceKind === 'event_csv' || sit.coverage.sourceKind === 'hybrid') &&
          sit.scenarioPath &&
          fs.existsSync(sit.scenarioPath)
        ) {
          const pyRes = await runPythonMetricsAdapter(
            sit.scenarioPath,
            (body.customParams?.unitPrices as Record<string, number> | undefined) ?? sit.unitPrices,
          );
          if (pyRes.available) pyMetrics = pyRes.metrics;
          pyStatus = {
            available: pyRes.available,
            stagedCount: pyRes.stagedFiles.length,
            skippedCount: pyRes.skippedFiles.length,
            warnings: pyRes.warnings,
            reason: pyRes.reason,
          };
        }

        const output = evaluateIndicatorSystem(
          sys,
          {
            runId: body.runId,
            situation: sit,
            csvStats: pyMetrics,
            customParams: body.customParams,
          },
          { indicatorStore, customOperatorStore, operatorOverrideStore },
        );
        const reportMd = generateEvaluationReportMarkdown(output, sit);
        const feedback = generateTacticalFeedback(output, sit);
        if (!body.previewOnly) {
          sqliteStore.saveEvaluation(output, reportMd, feedback);
        }

        sendJson(res, 200, {
          ok: true,
          evalId: output.evalId,
          output,
          reportMd,
          feedback,
          pythonMetrics: pyStatus ?? null,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/evaluate/stream') {
        const body = await readJsonBody<{
          runId: string;
          systemId?: string;
          system?: IndicatorSystem;
          previewOnly?: boolean;
          customParams?: Record<string, unknown>;
          runPythonMetrics?: boolean;
        }>(req);

        let sys: IndicatorSystem | undefined;
        if (body.system && typeof body.system === 'object') {
          const valRes = validateIndicatorSystem(body.system, indicatorStore);
          if (!valRes.valid) {
            sendError(res, 400, `草稿体系校验失败: ${valRes.errors.join('；')}`);
            return;
          }
          sys = body.system;
        } else if (body.systemId) {
          sys = systemStore.get(body.systemId);
          if (!sys) {
            sendError(res, 404, `未找到评估体系: ${body.systemId}`);
            return;
          }
        } else {
          sendError(res, 400, '必须提供 systemId 或 system 草稿对象');
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'X-Accel-Buffering': 'no',
        });
        (res as any).flushHeaders?.();
        res.socket?.setNoDelay(true);
        res.write(': handshake-ok\n\n');

        const startedAt = Date.now();
        const abortCtrl = new AbortController();
        res.on('close', () => {
          if (!res.writableFinished) {
            abortCtrl.abort();
          }
        });
        const emitEvent = (event: string, payload: Record<string, unknown>) => {
          if (res.writableEnded || abortCtrl.signal.aborted) return;
          res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
        };
        const emitProgress = (payload: {
          percent: number;
          stage: string;
          message: string;
          log?: string;
        }) => {
          emitEvent('progress', {
            ...payload,
            elapsedMs: Date.now() - startedAt,
          });
        };

        try {
          emitProgress({
            percent: 5,
            stage: 'db_load',
            message: `正在从 eval.db 读取推演态势与轨迹快照 (${body.runId})…`,
            log: `[数据加载] 开始读取推演态势与轨迹快照 (RunId: ${body.runId})...`,
          });
          await new Promise<void>((r) => setImmediate(r));
          if (abortCtrl.signal.aborted) return;

          const sit = sqliteStore.getRunSituation(body.runId);
          if (!sit) {
            emitEvent('error', { ok: false, error: `未找到运行记录: ${body.runId}` });
            return;
          }
          if (abortCtrl.signal.aborted) return;

          emitProgress({
            percent: 16,
            stage: 'load',
            message: `已加载推演态势 (${sit.units.size} 单元 · ${sit.events.length} 事件) 与体系「${sys.name}」`,
            log: `[态势就绪] 已装载 ${sit.units.size} 个推演单元、${sit.events.length} 条推演事件，体系「${sys.name}」初始化完成`,
          });

          let pyMetrics: Record<string, unknown> | undefined;
          let pyStatus: Record<string, unknown> | undefined;
          if (
            body.runPythonMetrics !== false &&
            (sit.coverage.sourceKind === 'event_csv' || sit.coverage.sourceKind === 'hybrid') &&
            sit.scenarioPath &&
            fs.existsSync(sit.scenarioPath)
          ) {
            const pyRes = await runPythonMetricsAdapter(
              sit.scenarioPath,
              (body.customParams?.unitPrices as Record<string, number> | undefined) ?? sit.unitPrices,
              (info) => {
                emitProgress({
                  percent: info.percent ?? 45,
                  stage: info.stage,
                  message: info.message,
                  log: info.log,
                });
              },
              abortCtrl.signal,
            );
            if (pyRes.available) pyMetrics = pyRes.metrics;
            pyStatus = {
              available: pyRes.available,
              stagedCount: pyRes.stagedFiles.length,
              skippedCount: pyRes.skippedFiles.length,
              warnings: pyRes.warnings,
              reason: pyRes.reason,
            };
          }
          if (abortCtrl.signal.aborted) return;

          emitProgress({
            percent: 72,
            stage: 'operators',
            message: '正在执行物理算子、自定义流水线与指标归一化求值…',
            log: '[体系求值] 调度多层级算子拓扑、公式衍生与多属性指标打分归一化...',
          });

          const output = evaluateIndicatorSystem(
            sys,
            {
              runId: body.runId,
              situation: sit,
              csvStats: pyMetrics,
              customParams: body.customParams,
            },
            { indicatorStore, customOperatorStore, operatorOverrideStore },
          );

          emitProgress({
            percent: 90,
            stage: 'report',
            message: '正在生成 Markdown 评估报告与战术反哺指令…',
            log: '[报告反哺] 计算完成，正在合成实证结论报告、战术指挥建议与物理证据链...',
          });

          const reportMd = generateEvaluationReportMarkdown(output, sit);
          const feedback = generateTacticalFeedback(output, sit);

          emitProgress({
            percent: 96,
            stage: 'persist',
            message: '正在将评估结果与证据链写入 eval.db…',
            log: '[结果落盘] 将综合评分、维度雷达数据与评估版本持久化至 SQLite eval.db...',
          });

          if (abortCtrl.signal.aborted) return;
          if (!body.previewOnly) {
            sqliteStore.saveEvaluation(output, reportMd, feedback);
          }

          emitEvent('done', {
            ok: true,
            evalId: output.evalId,
            output,
            reportMd,
            feedback,
            pythonMetrics: pyStatus ?? null,
            elapsedMs: Date.now() - startedAt,
            log: `[评估完成] 全链路评估顺利完成，总耗时 ${((Date.now() - startedAt) / 1000).toFixed(2)}s`,
          });
        } catch (err) {
          if (abortCtrl.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
            return;
          }
          emitEvent('error', {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          if (!res.writableEnded) res.end();
        }
        return;
      }

      if (req.method === 'GET' && pathname === '/api/evaluations') {
        const runId = reqUrl.searchParams.get('runId') || undefined;
        sendJson(res, 200, { ok: true, evaluations: sqliteStore.listEvaluations(runId) });
        return;
      }

      const evalDetailMatch = pathname.match(/^\/api\/evaluations\/([^/]+)$/);
      if (req.method === 'GET' && evalDetailMatch) {
        const found = sqliteStore.getEvaluation(evalDetailMatch[1]);
        if (!found) {
          sendError(res, 404, `未找到评估记录: ${evalDetailMatch[1]}`);
          return;
        }
        sendJson(res, 200, { ok: true, ...found });
        return;
      }

      if (req.method === 'DELETE' && evalDetailMatch) {
        const evalId = evalDetailMatch[1];
        const deleted = sqliteStore.deleteEvaluation(evalId);
        if (!deleted) {
          sendError(res, 404, `未找到评估记录: ${evalId}`);
          return;
        }
        sendJson(res, 200, { ok: true, evalId, message: '评估记录已删除' });
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
          if (ds.sourceKind !== 'jsonl_file') {
            sendError(res, 400, `数据源 ${ds.id} 类型为 ${ds.sourceKind}，实时伴随流仅支持 jsonl_file 数据源`);
            return;
          }
          if (!fs.existsSync(ds.path)) {
            sendError(res, 400, `数据源文件不存在: ${ds.path}`);
            return;
          }
          monitor.createSessionFromFile({
            runId,
            jsonlFile: ds.path,
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
          monitor.stepFrame(runId);
        } else if (body.action === 'push_frame') {
          if (!body.frameLine) throw new Error('push_frame 必须提供 frameLine');
          monitor.stepFrame(runId, body.frameLine);
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
    customOperatorStore,
    operatorOverrideStore,
    indicatorStore,
    systemStore,
    monitor,
    ensureSeedData,
    switchActiveDatabase,
    close: async () => {
      for (const c of sseClients) {
        c.end();
      }
      sseClients.clear();
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
