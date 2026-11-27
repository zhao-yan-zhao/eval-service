import type {
  AggregationMethod,
  AggregationMetricItem,
  AggregationOperatorConfig,
  BsFamilyCatalogGroup,
  BsPathMetricItem,
  CatalogChannelSpec,
  CatalogEventField,
  CatalogEventSpec,
  CatalogJoinRecipe,
  CsvRunPresence,
  CsvTablePreview,
  CsvTableProfileEntry,
  DatasetColumn,
  DerivedColumnConfig,
  EffectDefinition,
  EvaluationDagOutput,
  EvaluationSystemDag,
  EvidenceRef,
  F1OutputCatalog,
  FieldDataType,
  FormulaOperatorConfig,
  MetricDomainTag,
  MetricGraphDefinition,
  MetricMilitaryLevel,
  OperatorCategory,
  OperatorDefaultParams,
  OperatorFieldContract,
  OperatorNodeExecutionResult,
  OperatorOutputType,
  OperatorSourceBinding,
  OptimalDirection,
  ParameterPortSpec,
  PipelinePreviewResult,
  RunSourceProfile,
  ScoringRule,
  SourceBindingAgg,
  StructuredSimEvent,
  TableDataset,
  V4MetricSnapshotItem,
  V4MetricTableSlice,
} from '../core/types.ts';

export type {
  AggregationMethod,
  AggregationMetricItem,
  AggregationOperatorConfig,
  BsFamilyCatalogGroup,
  BsPathMetricItem,
  CatalogChannelSpec,
  CatalogEventField,
  CatalogEventSpec,
  CatalogJoinRecipe,
  CsvRunPresence,
  CsvTablePreview,
  CsvTableProfileEntry,
  DatasetColumn,
  DerivedColumnConfig,
  EffectDefinition,
  EvaluationDagOutput,
  EvaluationSystemDag,
  EvidenceRef,
  F1OutputCatalog,
  FieldDataType,
  FormulaOperatorConfig,
  MetricDomainTag,
  MetricGraphDefinition,
  MetricMilitaryLevel,
  OperatorCategory,
  OperatorDefaultParams,
  OperatorFieldContract,
  OperatorNodeExecutionResult,
  OperatorOutputType,
  OperatorSourceBinding,
  OptimalDirection,
  ParameterPortSpec,
  PipelinePreviewResult,
  RunSourceProfile,
  ScoringRule,
  SourceBindingAgg,
  StructuredSimEvent,
  TableDataset,
  V4MetricSnapshotItem,
  V4MetricTableSlice,
};

export type V4OperatorLayer = 'fact' | 'legacy_aggregate';

export type V4OperatorEngineKind =
  | 'python_script'
  | 'data_input'
  | 'inline_calc'
  | 'group_agg'
  | 'spatial';

/**
 * V4 一库算子前端统一视图契约（对应 GET/POST/PUT /api/v4/operators 返回结构）
 */
export interface V4OperatorItem {
  id: string;
  name: string;
  chapter: number;
  category: OperatorCategory;
  militaryLevel: MetricMilitaryLevel;
  domainTag: MetricDomainTag;
  description: string;
  layer: V4OperatorLayer;
  engineKind: V4OperatorEngineKind;
  isBuiltin: boolean;
  requiredTables: string[];
  optionalTables?: string[];
  upstreamOperatorId?: string;
  tableColumns?: Record<string, string[]>;
  parameterPorts: ParameterPortSpec[];
  outputColumns: Array<{ name: string; type: string } | string>;
  outputColumnNames: string[];
  pythonCode: string;
  updatedAt?: string;
}

export interface V4OperatorUpsertInput {
  id: string;
  name: string;
  chapter?: number;
  category?: OperatorCategory;
  militaryLevel?: MetricMilitaryLevel;
  domainTag?: MetricDomainTag;
  description?: string;
  layer?: V4OperatorLayer;
  engineKind?: V4OperatorEngineKind;
  requiredTables?: string[];
  optionalTables?: string[];
  upstreamOperatorId?: string;
  tableColumns?: Record<string, string[]>;
  parameterPorts?: ParameterPortSpec[];
  outputColumns?: string[];
  pythonCode?: string;
}

export type V4OperatorUpdatePatch = Partial<Omit<V4OperatorUpsertInput, 'id'>>;

export interface DataSourceStatus {
  source: {
    id: string;
    name: string;
    kind: 'csv_dir' | 'jsonl_file';
    path: string;
    description?: string;
    isBuiltin?: boolean;
    enabled?: boolean;
    scenarioName?: string;
  };
  accessible: boolean;
  fileCount?: number;
  totalSizeBytes?: number;
  scenarioName?: string;
  timelineId?: string;
  tablesFound?: string[];
  importedRunId?: string;
  error?: string;
}

export interface DataSourceProbeResult {
  accessible: boolean;
  path: string;
  kind?: 'csv_dir' | 'jsonl_file';
  scenarioName?: string;
  timelineId?: string;
  fileCount?: number;
  totalSizeBytes?: number;
  tablesFound?: string[];
  error?: string;
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
  evidenceRefs: Array<{
    source: string;
    ref: string | number;
    scenarioClock: string;
    description: string;
  }>;
  hitlAction: 'pending' | 'observe' | 'pause_inspect' | 'ignore_expected';
  hitlNote?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface RealtimeSnapshot {
  runId: string;
  systemId: string;
  status: 'idle' | 'playing' | 'paused' | 'completed';
  cursor: number;
  totalFrames: number;
  speedMultiplier: number;
  scenarioClock: string;
  totalGameSeconds: number;
  sides: string[];
  unitCount: number;
  destroyedUnits: number;
  eventCount: number;
  suppressedCount: number;
  cards: RealtimeJudgementCard[];
  recentEvents: StructuredSimEvent[];
  units: Array<{
    unitId: string;
    unitName: string;
    side: string;
    unitClass: string;
    damageState: string;
    ammoRemaining: number;
    lastPos: { lon: number; lat: number; heading?: number } | null;
  }>;
}

export interface ComponentIOItem {
  name: string;
  type: 'dataset' | 'scalar' | 'any';
  description?: string;
  required?: boolean;
}

export interface ComponentConfigProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  title?: string;
  description?: string;
  default?: any;
  enum?: (string | number)[];
  enumNames?: string[];
  minimum?: number;
  maximum?: number;
  items?: any;
}

export interface ComponentConfigSchema {
  type: 'object';
  required?: string[];
  properties: Record<string, ComponentConfigProperty>;
}

export interface ComponentManifest {
  id: string;
  name: string;
  version?: string;
  category: 'data_input' | 'inline_calc' | 'group_agg' | 'result_output' | 'spatial' | 'python_script' | 'custom';
  categoryLabel?: string;
  engine: string;
  engineType: 'builtin' | 'libformula' | 'python' | 'aggregation' | 'http';
  iconName?: 'Database' | 'Calculator' | 'BarChart3' | 'Target' | 'Compass' | 'Code2' | 'Cpu' | 'Workflow';
  description: string;
  isBuiltin: boolean;
  isCustom?: boolean;
  author?: string;
  createdAt?: string;
  runtime?: {
    entrypoint?: string;
    scriptCode?: string;
    timeoutMs?: number;
  };
  io?: {
    inputs?: ComponentIOItem[];
    outputs?: ComponentIOItem[];
  };
  configSchema: ComponentConfigSchema;
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

export interface V4CompareSidesResponse {
  ok: boolean;
  evalId?: string;
  createdAt?: string;
  systemId: string;
  systemName?: string;
  systemVersion?: string;
  runId: string;
  metricGraphId?: string;
  sides: string[];
  sideSummaries?: StoredV4EvalSideSummary[];
  overall: EvaluationDagOutput;
  bySide: Record<string, EvaluationDagOutput>;
  metricSnapshots?: V4MetricSnapshotItem[];
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const data = (await res.json()) as { ok?: boolean; error?: string } & T;
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

export const evalApi = {
  // ─── 系统健康检查与字段规范目录 ───
  getHealth: () =>
    requestJson<{
      ok: boolean;
      nodeVersion: string;
      db: {
        dbPath: string;
        dbBytes: number;
        counts: { runs: number; events: number; unitStates: number; evaluations: number; realtimeCards: number };
      };
      builtinSamples: Record<string, boolean>;
    }>('/api/health'),

  getFieldsCatalog: () => requestJson<{ catalog: F1OutputCatalog }>('/api/fields-catalog'),

  getSchemaCatalog: () =>
    requestJson<{ ok: boolean; catalog: any }>('/api/schema/catalog'),

  saveSchemaCatalog: (catalog: any) =>
    requestJson<{ ok: boolean; message: string; totalTables: number }>('/api/schema/catalog', {
      method: 'POST',
      body: JSON.stringify(catalog),
    }),

  // ─── 算子组件库与 JSON Schema 扩展插件注册接口 ───
  listComponents: () => requestJson<{ ok: boolean; components: ComponentManifest[] }>('/api/components'),

  validateComponent: (manifest: Partial<ComponentManifest>) =>
    requestJson<{ ok: boolean; valid: boolean; errors?: string[] }>('/api/components/validate', {
      method: 'POST',
      body: JSON.stringify({ manifest }),
    }),

  importComponent: (manifest: ComponentManifest) =>
    requestJson<{ ok: boolean; component: ComponentManifest }>('/api/components/import', {
      method: 'POST',
      body: JSON.stringify({ manifest }),
    }),

  deleteComponent: (id: string) =>
    requestJson<{ ok: boolean; deleted: boolean; id: string }>(`/api/components/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // ─── 算子画布流水线 & 共享沙箱底座 ───
  getOperatorPipeline: (operatorId: string) =>
    requestJson<{
      ok: boolean;
      operatorId: string;
      pipeline: any | null;
      blueprint?: any;
      derivedContract?: {
        csvTables: string[];
        csvColumns: string[];
        defaultParams: Partial<OperatorDefaultParams>;
        unit?: string;
        optimalDirection?: OptimalDirection;
        discrepancyNotes: string[];
      };
    }>(`/api/operator-pipelines/${encodeURIComponent(operatorId)}`),

  saveOperatorPipeline: (body: {
    operatorId: string;
    pipelineTitle: string;
    nodes: any[];
    edges: any[];
    dataset?: any;
  }) =>
    requestJson<{
      ok: boolean;
      message: string;
      saved: any;
      derivedContract?: any;
      updatedMeta?: V4OperatorItem;
    }>('/api/operator-pipelines', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  previewPipeline: (body: {
    nodeType: 'formula' | 'aggregation';
    formulaConfig?: FormulaOperatorConfig;
    aggregationConfig?: AggregationOperatorConfig;
    sampleDataset?: TableDataset;
    runId?: string;
    tableName?: string;
  }) =>
    requestJson<PipelinePreviewResult>('/api/operators/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  validateFormula: (expression: string) =>
    requestJson<{ valid: boolean; errors?: string[]; variables?: string[] }>(
      '/api/operators/validate-formula',
      {
        method: 'POST',
        body: JSON.stringify({ expression }),
      },
    ),

  runPythonSandbox: (params: {
    script: string;
    context?: Record<string, unknown>;
    timeout?: number;
  }) =>
    requestJson<{
      ok: boolean;
      status: 'success' | 'error';
      output?: any;
      stdout?: string;
      stderr?: string;
      latencyMs: number;
    }>('/api/operators/run-python', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  // ─── MCDA 运筹学算法接口 ───
  computeTopsis: (params: {
    matrix: number[][];
    weights?: number[];
    directions: Array<'smaller_is_better' | 'larger_is_better'>;
    alternatives: string[];
  }) =>
    requestJson<{
      ranking: Array<{ rank: number; name: string; index: number; closeness: number; dPlus: number; dMinus: number }>;
      weightsUsed: number[];
    }>('/api/mcda/topsis', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  computeVikor: (params: {
    matrix: number[][];
    weights?: number[];
    directions: Array<'smaller_is_better' | 'larger_is_better'>;
    alternatives: string[];
    v?: number;
  }) =>
    requestJson<{
      ranking: Array<{ rank: number; name: string; index: number; S: number; R: number; Q: number }>;
      compromiseBest: string;
      vParameter: number;
      weightsUsed: number[];
    }>('/api/mcda/vikor', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  // ─── 推演数据源与场次管理 ───
  listDataSources: () =>
    requestJson<{ activeSourceId: string; activeRunId: string; dataSources: DataSourceStatus[] }>(
      '/api/data-sources',
    ),

  setActiveDataSource: (sourceId: string) =>
    requestJson<{ activeSourceId: string; runId: string; dataSources: DataSourceStatus[] }>(
      '/api/data-sources/active',
      {
        method: 'POST',
        body: JSON.stringify({ sourceId }),
      },
    ),

  probeDataSource: (path: string) =>
    requestJson<{ probe: DataSourceProbeResult }>('/api/data-sources/probe', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  upsertDataSource: (source: {
    id: string;
    name: string;
    kind: 'csv_dir' | 'jsonl_file';
    path: string;
    description?: string;
    enabled?: boolean;
  }) =>
    requestJson<{ dataSource: any }>('/api/data-sources', {
      method: 'POST',
      body: JSON.stringify(source),
    }),

  deleteDataSource: (id: string) =>
    requestJson<{ deleted: boolean }>(`/api/data-sources/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  listRuns: () => requestJson<{ runs: StoredRunSummary[] }>('/api/runs'),

  getRunTableData: (
    runId: string,
    tableName: string,
    params?: { filterField?: string; filterEquals?: string; limit?: number },
  ) => {
    const qs = new URLSearchParams();
    qs.set('tableName', tableName);
    if (params?.filterField) qs.set('filterField', params.filterField);
    if (params?.filterEquals) qs.set('filterEquals', params.filterEquals);
    if (params?.limit) qs.set('limit', String(params.limit));
    return requestJson<{
      ok: boolean;
      found: boolean;
      dataset?: TableDataset & {
        sourceRunId?: string;
        sourceTableName?: string;
        isRealData?: boolean;
        scenarioName?: string;
      };
      reason?: string;
      scenarioName?: string;
      runId: string;
    }>(`/api/runs/${encodeURIComponent(runId)}/table-data?${qs.toString()}`);
  },

  importRun: (body: {
    kind: 'builtin_gj11' | 'builtin_bs' | 'builtin_55th' | '55th_taihai' | 'csv_dir' | 'jsonl_file' | 'jsonl_text';
    runId?: string;
    scenarioName?: string;
    path?: string;
    text?: string;
    unitPrices?: Record<string, number>;
    criteriaResults?: Record<string, boolean>;
  }) =>
    requestJson<{ runId: string; scenarioName: string; unitCount: number; eventCount: number }>(
      '/api/runs/import',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),

  getRunEvents: (runId: string, params?: { kind?: string; side?: string; search?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.kind) qs.set('kind', params.kind);
    if (params?.side) qs.set('side', params.side);
    if (params?.search) qs.set('search', params.search);
    if (params?.limit) qs.set('limit', String(params.limit));
    return requestJson<{ total: number; events: StructuredSimEvent[] }>(
      `/api/runs/${encodeURIComponent(runId)}/events?${qs.toString()}`,
    );
  },

  getRunTracks: (runId: string) =>
    requestJson<{
      tracks: Array<{
        unitId: string;
        unitName: string;
        side: string;
        unitClass: string;
        damageState: string;
        points: Array<{ scenarioSeconds: number; lon: number; lat: number; altitudeM: number | null }>;
      }>;
    }>(`/api/runs/${encodeURIComponent(runId)}/tracks`),

  getRunSourceProfile: (
    runId: string,
    opts?: { previewTable?: string; previewLimit?: number },
  ) => {
    const qs = new URLSearchParams();
    if (opts?.previewTable) qs.set('previewTable', opts.previewTable);
    if (opts?.previewLimit) qs.set('previewLimit', String(opts.previewLimit));
    const q = qs.toString();
    return requestJson<{ profile: RunSourceProfile }>(
      `/api/runs/${encodeURIComponent(runId)}/source-profile${q ? `?${q}` : ''}`,
    );
  },

  // ─── 实时伴随研判监控 ───
  createRealtimeSession: (body: {
    runId?: string;
    source?: 'builtin_bs' | 'jsonl_text' | 'data_source';
    sourceId?: string;
    jsonlText?: string;
    jsonlLines?: string[];
    systemId?: string;
    speedMultiplier?: number;
  }) =>
    requestJson<{ snapshot: RealtimeSnapshot }>('/api/realtime/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getRealtimeSession: (runId: string) =>
    requestJson<{ snapshot: RealtimeSnapshot }>(`/api/realtime/sessions/${encodeURIComponent(runId)}`),

  controlRealtimeSession: (
    runId: string,
    body: {
      action: 'play' | 'pause' | 'step' | 'stop' | 'push_frame';
      speedMultiplier?: number;
      frameLine?: string;
    },
  ) =>
    requestJson<{ snapshot?: RealtimeSnapshot; stopped?: boolean }>(
      `/api/realtime/sessions/${encodeURIComponent(runId)}/control`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),

  actOnRealtimeCard: (
    runId: string,
    cardId: string,
    action: 'observe' | 'pause_inspect' | 'ignore_expected',
    note?: string,
  ) =>
    requestJson<{ card: RealtimeJudgementCard; snapshot: RealtimeSnapshot }>(
      `/api/realtime/sessions/${encodeURIComponent(runId)}/cards/${encodeURIComponent(cardId)}/action`,
      {
        method: 'POST',
        body: JSON.stringify({ action, note }),
      },
    ),

  // ─── 数据库管理与内置样本加载 ───
  getCurrentDb: () =>
    requestJson<{
      ok: boolean;
      operatorDb?: {
        current: string;
        dbPath: string;
        stats: {
          dbPath: string;
          dbBytes: number;
          counts: Record<string, number>;
        };
      };
      scenarioDb?: {
        current: string;
        dbPath: string;
        stats: {
          dbPath: string;
          dbBytes: number;
          counts: Record<string, number>;
        };
      };
      current: string;
      dbPath: string;
      stats: {
        dbPath: string;
        dbBytes: number;
        counts: Record<string, number>;
      };
      builtinOperatorsCount: number;
    }>('/api/db/current'),

  listDatabases: (dir?: string) =>
    requestJson<{
      ok: boolean;
      currentOperatorDb?: string;
      currentScenarioDb?: string;
      operatorDatabases?: Array<{
        filename: string;
        filePath: string;
        fileSize: number;
        modifiedAt: string;
        isActive: boolean;
        category?: 'operator' | 'scenario' | 'hybrid';
      }>;
      scenarioDatabases?: Array<{
        filename: string;
        filePath: string;
        fileSize: number;
        modifiedAt: string;
        isActive: boolean;
        category?: 'operator' | 'scenario' | 'hybrid';
      }>;
      allDatabases?: Array<{
        filename: string;
        filePath: string;
        fileSize: number;
        modifiedAt: string;
        isActive: boolean;
        category?: 'operator' | 'scenario' | 'hybrid';
      }>;
      current: string;
      currentPath: string;
      databases: Array<{
        filename: string;
        filePath: string;
        fileSize: number;
        modifiedAt: string;
        isActive: boolean;
        category?: 'operator' | 'scenario' | 'hybrid';
      }>;
    }>(dir ? `/api/db/list?dir=${encodeURIComponent(dir)}` : '/api/db/list'),

  switchDatabase: (params: { type?: 'operator' | 'scenario' | 'all'; dbName?: string; dbPath?: string }) =>
    requestJson<{
      ok: boolean;
      type?: 'operator' | 'scenario' | 'all';
      activeDb: string;
      dbPath: string;
      stats: {
        dbPath: string;
        dbBytes: number;
        counts: Record<string, number>;
      };
    }>('/api/db/switch', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  createDatabase: (params: {
    type?: 'operator' | 'scenario' | 'all';
    dbName?: string;
    dbPath?: string;
    template?: 'empty' | 'standard';
    switchNow?: boolean;
  }) =>
    requestJson<{
      ok: boolean;
      created: string;
      switched: boolean;
      activeDb?: string;
      dbPath?: string;
      stats?: any;
    }>('/api/db/create', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  cloneDatabase: (params: { type?: 'operator' | 'scenario' | 'all'; targetDbName?: string; targetPath?: string; switchNow?: boolean }) =>
    requestJson<{
      ok: boolean;
      cloned: string;
      switched: boolean;
      activeDb?: string;
      dbPath?: string;
    }>('/api/db/clone', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  uploadDatabase: (params: { type?: 'operator' | 'scenario' | 'all'; filename: string; contentBase64: string; switchNow?: boolean }) =>
    requestJson<{
      ok: boolean;
      uploaded: string;
      switched: boolean;
      activeDb?: string;
      dbPath?: string;
      size?: number;
    }>('/api/db/upload', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  getDatabaseExportUrl: (type?: 'operator' | 'scenario') =>
    type ? `/api/db/export?type=${encodeURIComponent(type)}` : '/api/db/export',

  loadBuiltinSamples: (force = true) =>
    requestJson<{ ok: boolean; message: string; runsCount: number }>('/api/sample-data/load-builtin', {
      method: 'POST',
      body: JSON.stringify({ force }),
    }),

  // ─── V4 全链路 DAG 评估中台接口 (/api/v4/*) ───
  listV4Operators: (params?: { layer?: 'fact' | 'all'; domain?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.layer) qs.set('layer', params.layer);
    if (params?.domain) qs.set('domain', params.domain);
    if (params?.search) qs.set('search', params.search);
    const q = qs.toString();
    return requestJson<{ ok: boolean; operators: V4OperatorItem[]; components?: unknown[] }>(
      `/api/v4/operators${q ? `?${q}` : ''}`,
    );
  },

  getV4Operator: (operatorId: string) =>
    requestJson<{ ok: boolean; operator: V4OperatorItem }>(
      `/api/v4/operators/${encodeURIComponent(operatorId)}`,
    ),

  upsertV4Operator: (operator: V4OperatorUpsertInput) =>
    requestJson<{ ok: boolean; operator: V4OperatorItem }>('/api/v4/operators', {
      method: 'POST',
      body: JSON.stringify({ operator }),
    }),

  updateV4Operator: (operatorId: string, patch: V4OperatorUpdatePatch) =>
    requestJson<{ ok: boolean; operator: V4OperatorItem }>(
      `/api/v4/operators/${encodeURIComponent(operatorId)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ operator: patch }),
      },
    ),

  deleteV4Operator: (operatorId: string) =>
    requestJson<{ ok: boolean; operatorId: string; deleted: boolean }>(
      `/api/v4/operators/${encodeURIComponent(operatorId)}`,
      { method: 'DELETE' },
    ),

  resetV4OperatorOverride: (operatorId: string) =>
    requestJson<{ ok: boolean; operatorId: string; operator: V4OperatorItem }>(
      `/api/v4/operators/${encodeURIComponent(operatorId)}/override`,
      { method: 'DELETE' },
    ),

  resetAllV4OperatorOverrides: () =>
    requestJson<{ ok: boolean; resetCount: number }>('/api/v4/operators/reset-all-overrides', {
      method: 'POST',
    }),

  runV4Operator: (body: {
    operatorId: string;
    runId?: string;
    dataSourceId?: string;
    csvDir?: string;
    inputDfDict?: Record<string, unknown>;
    params?: Record<string, unknown>;
  }) =>
    requestJson<{ ok: boolean; result: OperatorNodeExecutionResult }>('/api/v4/operators/run', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listV4Effects: () =>
    requestJson<{ ok: boolean; effects: EffectDefinition[] }>('/api/v4/effects'),

  saveV4Effect: (effect: EffectDefinition) =>
    requestJson<{ ok: boolean; effect: EffectDefinition }>('/api/v4/effects', {
      method: 'POST',
      body: JSON.stringify({ effect }),
    }),

  deleteV4Effect: (effectId: string) =>
    requestJson<{ ok: boolean; effectId: string; deleted: boolean }>(
      `/api/v4/effects/${encodeURIComponent(effectId)}`,
      { method: 'DELETE' },
    ),

  previewV4EffectCurve: (scoringRule: ScoringRule, samples = 36) =>
    requestJson<{ ok: boolean; points: Array<{ x: number; score: number }> }>(
      '/api/v4/effects/preview-curve',
      {
        method: 'POST',
        body: JSON.stringify({ scoringRule, samples }),
      },
    ),

  listV4MetricGraphs: () =>
    requestJson<{ ok: boolean; graphs: MetricGraphDefinition[] }>('/api/v4/metric-graphs'),

  saveV4MetricGraph: (graph: MetricGraphDefinition) =>
    requestJson<{ ok: boolean; graph: MetricGraphDefinition }>('/api/v4/metric-graphs', {
      method: 'POST',
      body: JSON.stringify({ graph }),
    }),

  deleteV4MetricGraph: (graphId: string) =>
    requestJson<{ ok: boolean; graphId: string; deleted: boolean }>(
      `/api/v4/metric-graphs/${encodeURIComponent(graphId)}`,
      { method: 'DELETE' },
    ),

  executeV4MetricGraph: (body: {
    graph?: MetricGraphDefinition;
    graphId?: string;
    runId?: string;
    dataSourceId?: string;
    csvDir?: string;
    operatorResults?: Record<string, unknown>;
    paramOverrides?: Record<string, Record<string, unknown>>;
    globalParams?: Record<string, unknown>;
  }) =>
    requestJson<Record<string, unknown>>('/api/v4/metric-graphs/execute', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listV4SystemDags: () =>
    requestJson<{ ok: boolean; systems: EvaluationSystemDag[] }>('/api/v4/system-dags'),

  saveV4SystemDag: (system: EvaluationSystemDag, normalizeWeights = false) =>
    requestJson<{ ok: boolean; system: EvaluationSystemDag }>('/api/v4/system-dags', {
      method: 'POST',
      body: JSON.stringify({ system, normalizeWeights }),
    }),

  deleteV4SystemDag: (systemId: string) =>
    requestJson<{ ok: boolean; systemId: string; deleted: boolean }>(
      `/api/v4/system-dags/${encodeURIComponent(systemId)}`,
      { method: 'DELETE' },
    ),

  validateV4SystemDag: (body: {
    system?: EvaluationSystemDag;
    systemId?: string;
    normalizeWeights?: boolean;
  }) =>
    requestJson<Record<string, unknown>>('/api/v4/system-dags/validate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  draftV4SystemDagNl: (
    prompt: string,
    opts?: { name?: string; systemId?: string; metricGraphId?: string },
  ) =>
    requestJson<{
      ok: boolean;
      system: EvaluationSystemDag & { metricGraphId?: string };
      validation: { valid: boolean; errors: string[]; warnings: string[] };
      matchedDomains: string[];
      rationale: string[];
    }>('/api/v4/system-dags/draft-nl', {
      method: 'POST',
      body: JSON.stringify({ prompt, ...opts }),
    }),

  computeV4ObjectiveWeights: (params: {
    systemId?: string;
    nodeId?: string;
    runIds?: string[];
    matrix?: number[][];
    method: 'entropy' | 'critic' | 'combined';
    objectiveMethod?: 'entropy' | 'critic';
    subjectiveWeights?: number[];
    alpha?: number;
    directions?: Array<'smaller_is_better' | 'larger_is_better'>;
    criterionNames?: string[];
  }) =>
    requestJson<{
      ok: boolean;
      method: string;
      weights: number[];
      normalizedWeights?: number[];
      objectiveWeights?: number[];
      criterionNames?: string[];
      diagnostics?: Record<string, unknown>;
    }>('/api/v4/system-dags/objective-weights', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  evaluateV4SystemDag: (body: {
    system?: EvaluationSystemDag;
    systemId?: string;
    metricGraph?: MetricGraphDefinition;
    metricGraphId?: string;
    metricInputs?: Record<string, unknown>;
    runId?: string;
    dataSourceId?: string;
    csvDir?: string;
  }) =>
    requestJson<{
      ok: boolean;
      output: EvaluationDagOutput & { resolvedParamOverrides?: Record<string, Record<string, unknown>> };
      metricGraphResult?: Record<string, unknown>;
      operatorResults?: Record<string, unknown>;
    }>('/api/v4/system-dags/evaluate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  compareV4SystemSides: (
    systemId: string,
    body: {
      runId?: string;
      dataSourceId?: string;
      persist?: boolean;
      system?: EvaluationSystemDag;
    },
  ) =>
    requestJson<V4CompareSidesResponse>(
      `/api/v4/system-dags/${encodeURIComponent(systemId)}/compare-sides`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),

  listV4Evaluations: (runId?: string, limit = 50) => {
    const params = new URLSearchParams();
    if (runId) params.set('runId', runId);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    return requestJson<{ ok: boolean; evaluations: StoredV4EvalSummary[] }>(
      `/api/v4/evaluations${qs ? `?${qs}` : ''}`,
    );
  },

  getV4Evaluation: (evalId: string) =>
    requestJson<{ ok: boolean; evaluation: StoredV4EvalRecord }>(
      `/api/v4/evaluations/${encodeURIComponent(evalId)}`,
    ),

  deleteV4Evaluation: (evalId: string) =>
    requestJson<{ ok: boolean; evalId: string; deleted: boolean }>(
      `/api/v4/evaluations/${encodeURIComponent(evalId)}`,
      { method: 'DELETE' },
    ),
};
