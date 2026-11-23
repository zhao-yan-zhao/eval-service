import type {
  AggregationMethod,
  AggregationMetricItem,
  AggregationOperatorConfig,
  BsFamilyCatalogGroup,
  BsPathMetricItem,
  BuiltinOperatorOverride,
  CatalogChannelSpec,
  CatalogEventField,
  CatalogEventSpec,
  CatalogJoinRecipe,
  CsvRunPresence,
  CsvTablePreview,
  CsvTableProfileEntry,
  CustomOperatorDefinition,
  DatasetColumn,
  DerivedColumnConfig,
  EffectDefinition,
  EvalSummaryV2,
  EvaluationDagOutput,
  EvaluationSystemDag,
  EvidenceRef,
  F1OutputCatalog,
  FieldDataType,
  FormulaOperatorConfig,
  IndicatorDefinition,
  IndicatorReduceMethod,
  IndicatorSourceBinding,
  IndicatorSystem,
  MetricAtomMeta,
  MetricAtomResult,
  MetricGraphDefinition,
  OperatorCategory,
  OperatorComparisonRow,
  OperatorDefaultParams,
  OperatorFieldContract,
  OperatorNodeExecutionResult,
  OperatorOutputType,
  OperatorSourceBinding,
  OperatorSweepPoint,
  OptimalDirection,
  PipelinePreviewResult,
  RunSourceProfile,
  ScoringRule,
  SourceBindingAgg,
  StructuredSimEvent,
  SystemEvaluationOutput,
  TableDataset,
  TacticalFeedbackPayload,
} from '../core/types.ts';

export type {
  AggregationMethod,
  AggregationMetricItem,
  AggregationOperatorConfig,
  BsFamilyCatalogGroup,
  BsPathMetricItem,
  BuiltinOperatorOverride,
  CatalogChannelSpec,
  CatalogEventField,
  CatalogEventSpec,
  CatalogJoinRecipe,
  CsvRunPresence,
  CsvTablePreview,
  CsvTableProfileEntry,
  CustomOperatorDefinition,
  DatasetColumn,
  DerivedColumnConfig,
  EffectDefinition,
  EvalSummaryV2,
  EvaluationDagOutput,
  EvaluationSystemDag,
  EvidenceRef,
  F1OutputCatalog,
  FieldDataType,
  FormulaOperatorConfig,
  IndicatorDefinition,
  IndicatorReduceMethod,
  IndicatorSourceBinding,
  IndicatorSystem,
  MetricAtomMeta,
  MetricAtomResult,
  MetricGraphDefinition,
  OperatorCategory,
  OperatorComparisonRow,
  OperatorDefaultParams,
  OperatorFieldContract,
  OperatorNodeExecutionResult,
  OperatorOutputType,
  OperatorSourceBinding,
  OperatorSweepPoint,
  OptimalDirection,
  PipelinePreviewResult,
  RunSourceProfile,
  ScoringRule,
  SourceBindingAgg,
  StructuredSimEvent,
  SystemEvaluationOutput,
  TableDataset,
  TacticalFeedbackPayload,
};

export interface IndicatorBacktestRunItem {
  runId: string;
  scenarioName: string;
  sourceKind: string;
  status: 'valid' | 'degraded' | 'unavailable';
  rawValue: number | boolean | null;
  numericValue?: number | null;
  displayValue: string;
  score: number | null;
  alarmTriggered: boolean;
  missingDataReason?: string;
  evidenceRefs: EvidenceRef[];
  details?: Record<string, unknown>;
}

export interface IndicatorBacktestSummary {
  totalRuns: number;
  validCount: number;
  minValue: number | null;
  maxValue: number | null;
  avgValue: number | null;
  minScore: number | null;
  maxScore: number | null;
  avgScore: number | null;
}

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

  listOperators: () => requestJson<{ operators: MetricAtomMeta[] }>('/api/operators'),

  upsertOperator: (def: CustomOperatorDefinition) =>
    requestJson<{ operator: CustomOperatorDefinition; meta?: MetricAtomMeta }>('/api/operators', {
      method: 'POST',
      body: JSON.stringify(def),
    }),

  updateOperator: (
    atomId: string,
    payload: BuiltinOperatorOverride | CustomOperatorDefinition,
  ) =>
    requestJson<{ operator: MetricAtomMeta }>(`/api/operators/${encodeURIComponent(atomId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  resetOperatorOverride: (atomId: string) =>
    requestJson<{ reset: boolean; operator: MetricAtomMeta }>(
      `/api/operators/${encodeURIComponent(atomId)}/override`,
      { method: 'DELETE' },
    ),

  deleteOperator: (atomId: string) =>
    requestJson<{ deleted: boolean }>(`/api/operators/${encodeURIComponent(atomId)}`, {
      method: 'DELETE',
    }),

  // 获取持久化的算子专属流水线配置
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

  // 保存并持久化算子专属流水线配置至后端 JSON
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
      updatedMeta?: MetricAtomMeta;
    }>('/api/operator-pipelines', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  previewOperatorFormula: (
    definition: CustomOperatorDefinition,
    runId: string,
    customParams?: Record<string, unknown>,
  ) =>
    requestJson<{ valid: boolean; errors: string[]; result: MetricAtomResult }>(
      '/api/operators/preview-formula',
      {
        method: 'POST',
        body: JSON.stringify({ definition, runId, customParams }),
      },
    ),

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

  getOperatorCategories: () =>
    requestJson<{
      categories: Array<{ id: string; name: string; description: string; badgeColor: string }>;
    }>('/api/operators/categories'),

  compareOperatorsRuns: (runIdA: string, runIdB: string, customParams?: Record<string, unknown>) =>
    requestJson<{ runIdA: string; runIdB: string; rows: OperatorComparisonRow[] }>(
      '/api/operators/compare-runs',
      {
        method: 'POST',
        body: JSON.stringify({ runIdA, runIdB, customParams }),
      },
    ),

  sweepOperator: (
    atomId: string,
    params: {
      runId: string;
      paramKey:
        | 'safeRadiusNm'
        | 'arrivalLineLon'
        | 'expectedSpacingNm'
        | 'minRangeNm'
        | 'waveGapSeconds';
      min: number;
      max: number;
      steps?: number;
      customParams?: Record<string, unknown>;
    },
  ) =>
    requestJson<{ atomId: string; paramKey: string; points: OperatorSweepPoint[] }>(
      `/api/operators/${encodeURIComponent(atomId)}/sweep`,
      {
        method: 'POST',
        body: JSON.stringify(params),
      },
    ),

  evaluateOperator: (atomId: string, runId: string, customParams?: Record<string, unknown>) =>
    requestJson<{ result: MetricAtomResult }>(`/api/operators/${encodeURIComponent(atomId)}/evaluate`, {
      method: 'POST',
      body: JSON.stringify({ runId, customParams }),
    }),

  evaluateAllOperators: (runId: string, customParams?: Record<string, unknown>) =>
    requestJson<{ results: Record<string, MetricAtomResult> }>('/api/operators/evaluate-all', {
      method: 'POST',
      body: JSON.stringify({ runId, customParams }),
    }),

  listIndicators: () => requestJson<{ indicators: IndicatorDefinition[] }>('/api/indicators'),

  previewIndicatorCurve: (scoring: ScoringRule, samples = 36) =>
    requestJson<{ points: Array<{ x: number; score: number }> }>('/api/indicators/preview-curve', {
      method: 'POST',
      body: JSON.stringify({ scoring, samples }),
    }),

  upsertIndicator: (def: IndicatorDefinition) =>
    requestJson<{ indicator: IndicatorDefinition }>('/api/indicators', {
      method: 'POST',
      body: JSON.stringify(def),
    }),

  backtestIndicator: (payload: {
    indicator: IndicatorDefinition;
    runIds?: string[];
    targetSide?: string;
  }) =>
    requestJson<{
      ok: boolean;
      results: IndicatorBacktestRunItem[];
      summary: IndicatorBacktestSummary;
    }>('/api/indicators/backtest', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  importIndicators: (indicators: IndicatorDefinition[]) =>
    requestJson<{ ok: boolean; count: number; indicators: IndicatorDefinition[] }>('/api/indicators/import', {
      method: 'POST',
      body: JSON.stringify({ indicators }),
    }),

  deleteIndicator: (indicatorId: string) =>
    requestJson<{ deleted: boolean }>(`/api/indicators/${encodeURIComponent(indicatorId)}`, {
      method: 'DELETE',
    }),

  listSystems: () => requestJson<{ systems: IndicatorSystem[] }>('/api/systems'),

  validateSystem: (system: IndicatorSystem, autoNormalize = false) =>
    requestJson<{
      system: IndicatorSystem;
      validation: { valid: boolean; errors: string[]; warnings: string[] };
    }>('/api/systems/validate', {
      method: 'POST',
      body: JSON.stringify({ system, autoNormalize }),
    }),

  upsertSystem: (system: IndicatorSystem) =>
    requestJson<{ system: IndicatorSystem }>('/api/systems', {
      method: 'POST',
      body: JSON.stringify(system),
    }),

  deleteSystem: (systemId: string) =>
    requestJson<{ deleted: boolean }>(`/api/systems/${encodeURIComponent(systemId)}`, {
      method: 'DELETE',
    }),

  draftSystemNl: (prompt: string, name?: string) =>
    requestJson<{
      system: IndicatorSystem;
      validation: { valid: boolean; errors: string[]; warnings: string[] };
      mode: string;
      matchedDomains: string[];
      rationale: string;
    }>('/api/systems/draft-nl', {
      method: 'POST',
      body: JSON.stringify({ prompt, name }),
    }),

  computeAhp: (matrix: number[][], names?: string[]) =>
    requestJson<{
      weights: number[];
      namedWeights: Record<string, number> | null;
      lambdaMax: number;
      ci: number;
      ri: number;
      cr: number;
      consistent: boolean;
    }>('/api/mcda/ahp', {
      method: 'POST',
      body: JSON.stringify({ matrix, names }),
    }),

  computeEntropy: (
    matrix: number[][],
    directions: Array<'smaller_is_better' | 'larger_is_better'>,
    criterionNames?: string[],
  ) =>
    requestJson<{ weights: number[]; entropies: number[] }>('/api/mcda/entropy', {
      method: 'POST',
      body: JSON.stringify({ matrix, directions, criterionNames }),
    }),

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

  computeObjectiveWeights: (params: {
    systemId?: string;
    system?: IndicatorSystem;
    dimensionIds?: string[];
    runIds?: string[];
    method: 'entropy' | 'critic' | 'combined';
    objectiveMethod?: 'entropy' | 'critic';
    subjectiveWeights?: number[];
    alpha?: number;
  }) =>
    requestJson<{
      method: 'entropy' | 'critic' | 'combined';
      targetIds: string[];
      targetNames: string[];
      runs: string[];
      matrix: number[][];
      weights: number[];
      normalizedWeights: number[];
      objectiveWeights: number[];
      diagnostics: Record<string, unknown>;
    }>('/api/systems/objective-weights', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

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

  importDataSource: (id: string) =>
    requestJson<{
      runId: string;
      scenarioName: string;
      unitCount: number;
      eventCount: number;
      sides: string[];
    }>(`/api/data-sources/${encodeURIComponent(id)}/import`, {
      method: 'POST',
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

  getRunDetail: (runId: string) =>
    requestJson<{
      runId: string;
      scenarioName: string;
      scenarioPath: string;
      startGameClock: string;
      endGameClock: string;
      totalGameSeconds: number;
      sides: string[];
      coverage: Record<string, unknown>;
      units: Array<{
        unitId: string;
        unitName: string;
        side: string;
        unitType?: string;
        unitClass: string;
        damageState: string;
        ammoRemaining: number;
        trackPointCount: number;
      }>;
    }>(`/api/runs/${encodeURIComponent(runId)}`),

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

  runEvaluate: (body: {
    runId: string;
    systemId?: string;
    system?: IndicatorSystem;
    previewOnly?: boolean;
    customParams?: Record<string, unknown>;
    runPythonMetrics?: boolean;
  }) =>
    requestJson<{
      evalId: string;
      output: SystemEvaluationOutput;
      reportMd: string;
      feedback: TacticalFeedbackPayload;
      pythonMetrics: Record<string, unknown> | null;
    }>('/api/evaluate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  runEvaluateStream: async (
    body: {
      runId: string;
      systemId?: string;
      system?: IndicatorSystem;
      previewOnly?: boolean;
      customParams?: Record<string, unknown>;
      runPythonMetrics?: boolean;
    },
    onProgress: (info: { percent: number; stage: string; message: string; elapsedMs: number; log?: string }) => void,
    signal?: AbortSignal,
  ): Promise<{
    evalId: string;
    output: SystemEvaluationOutput;
    reportMd: string;
    feedback: TacticalFeedbackPayload;
    pythonMetrics: Record<string, unknown> | null;
  }> => {
    const res = await fetch('/api/evaluate/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '');
      throw new Error(txt || `HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let finalResult: {
      evalId: string;
      output: SystemEvaluationOutput;
      reportMd: string;
      feedback: TacticalFeedbackPayload;
      pythonMetrics: Record<string, unknown> | null;
    } | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        if (!block.trim()) continue;
        let eventName = 'message';
        const dataLines: string[] = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) continue;
        const parsed = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
        if (eventName === 'progress') {
          onProgress({
            percent: Number(parsed.percent ?? 0),
            stage: String(parsed.stage ?? ''),
            message: String(parsed.message ?? ''),
            elapsedMs: Number(parsed.elapsedMs ?? 0),
            log: parsed.log ? String(parsed.log) : undefined,
          });
        } else if (eventName === 'error') {
          throw new Error(String(parsed.error ?? '评估执行失败'));
        } else if (eventName === 'done') {
          finalResult = parsed as unknown as NonNullable<typeof finalResult>;
        }
      }
    }
    if (!finalResult) {
      throw new Error('评估流式通道未返回最终结果');
    }
    return finalResult;
  },

  listEvaluations: (runId?: string) =>
    requestJson<{ evaluations: StoredEvalSummary[] }>(
      `/api/evaluations${runId ? `?runId=${encodeURIComponent(runId)}` : ''}`,
    ),

  getEvaluation: (evalId: string) =>
    requestJson<{
      output: SystemEvaluationOutput;
      reportMd: string;
      feedback: TacticalFeedbackPayload;
    }>(`/api/evaluations/${encodeURIComponent(evalId)}`),

  deleteEvaluation: (evalId: string) =>
    requestJson<{ ok: boolean; evalId: string; message?: string }>(
      `/api/evaluations/${encodeURIComponent(evalId)}`,
      { method: 'DELETE' },
    ),

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

  getSchemaCatalog: () =>
    requestJson<{ ok: boolean; catalog: any }>('/api/schema/catalog'),

  saveSchemaCatalog: (catalog: any) =>
    requestJson<{ ok: boolean; message: string; totalTables: number }>('/api/schema/catalog', {
      method: 'POST',
      body: JSON.stringify(catalog),
    }),

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
  listV4Operators: () =>
    requestJson<{ ok: boolean; operators: Array<Record<string, unknown>> }>('/api/v4/operators'),

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
};
