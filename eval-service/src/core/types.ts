/**
 * F1 / CMO 仿真推演评估中台核心强类型契约
 * 严格对齐：
 * 1) docs/推演评估中台总体设计方案.md (§2.1, §4.1, §5.1, §5.2, §6.3, §7.1, §7.3)
 * 2) sim-output-fields/schemas/f1-output-catalog.json（实证字段与偏差 D1-D9 纠偏契约）
 */

export type OperatorCategory = 'time' | 'effectiveness' | 'situation' | 'compliance' | 'cost';
export type PipelineCategory = 'data_input' | 'inline_calc' | 'group_agg' | 'result_output' | 'spatial' | 'python_script';
export type OperatorReadiness = 'batch_a_ready' | 'batch_b_pending';
export type RequiredDataSource = 'situation' | 'events' | 'unit_states' | 'csv' | 'db3k';
export type OperatorOutputType = 'duration_seconds' | 'rate' | 'count' | 'ratio' | 'score';
export type OptimalDirection = 'smaller_is_better' | 'larger_is_better' | 'range_bounded';

export interface EvidenceRef {
  source: 'frame' | 'csv' | 'event' | 'sqlite';
  ref: string | number;
  scenarioClock: string;
  description: string;
  snippet?: Record<string, unknown>;
}

export interface OperatorDefaultParams {
  targetSide?: string;
  enemySide?: string;
  safeRadiusNm?: number;
  minRangeNm?: number;
  expectedSpacingNm?: number;
  arrivalLineLon?: number;
  waveGapSeconds?: number;
  minSafeMarginKm?: number;
  thresholdLow?: number;
  thresholdHigh?: number;
  [key: string]: unknown;
}

export interface OperatorFieldContract {
  csvTables?: string[];
  csvColumns?: string[];
  bsFramePaths?: string[];
  discrepancyNotes?: string[];
}

export interface BuiltinOperatorOverride {
  id: string;
  name?: string;
  description?: string;
  unit?: string;
  defaultOptimalDirection?: OptimalDirection;
  defaultParams?: OperatorDefaultParams;
  f1FieldContract?: OperatorFieldContract;
  updatedAt?: string;
}

export interface MetricAtomMeta {
  id: string;
  name: string;
  category: OperatorCategory;
  description: string;
  readiness: OperatorReadiness;
  requiredDataSources: RequiredDataSource[];
  outputType: OperatorOutputType;
  unit?: string;
  defaultOptimalDirection: OptimalDirection;
  isCustom?: boolean;
  isOverridden?: boolean;
  mode?: 'formula' | 'source_binding' | 'formula_pipeline' | 'aggregation' | 'spatial' | 'python_script';
  pipelineCategory?: PipelineCategory | string;
  defaultParams?: OperatorDefaultParams;
  builtinDefaults?: {
    name: string;
    description: string;
    unit?: string;
    defaultOptimalDirection: OptimalDirection;
    f1FieldContract?: OperatorFieldContract;
  };
  customDef?: CustomOperatorDefinition;
  /** 所依赖的 F1 实证底层数据源字段，直接对齐 sim-output-fields */
  f1FieldContract: OperatorFieldContract;
}

export interface GeoPoint {
  lon: number;
  lat: number;
}

export interface EvalPolygon {
  id: string;
  name?: string;
  side?: string;
  points: GeoPoint[]; // 闭合或不闭合点序列，adapter 自动闭合
}

export interface ThreatZone {
  id: string;
  name?: string;
  side: string;
  lon: number;
  lat: number;
  radiusNm: number;
}

export interface UnitTrackPoint {
  scenarioSeconds: number;
  clockText: string;
  lon: number;
  lat: number;
  altitudeM?: number;
  heading?: number;
  speedKts?: number;
  pitch?: number;
  roll?: number;
  damagePercent?: number;
  lineRef?: number;
}

export interface SituationUnit {
  unitId: string;
  unitName: string;
  side: string;
  unitType?: string;
  unitClass: string;
  dbid?: string;
  firstSeenSeconds: number;
  firstSeenClock: string;
  lastSeenSeconds: number;
  lastSeenClock: string;
  isDestroyed: boolean;
  destroyedSeconds?: number;
  destroyedClock?: string;
  damageState: 'ok' | 'damaged' | 'destroyed';
  damagePercent?: number;
  ammoInitial: number;
  ammoRemaining: number;
  /** 记录传感器当前或已知开关态（若引擎帧未导出，必须为 null，严禁臆造） */
  emconStates: Array<{
    scenarioSeconds: number;
    clockText: string;
    sensorId: string;
    sensorName?: string;
    active: boolean;
    authorized?: boolean;
    lineRef: string | number;
  }>;
  trackPoints: UnitTrackPoint[];
}

export interface SituationContact {
  contactId: string;
  targetUnitId?: string;
  targetUnitName?: string;
  detectedBySide: string;
  firstSeenSeconds: number;
  firstSeenClock: string;
  lastSeenSeconds: number;
  lastSeenClock: string;
  isLost: boolean;
  cumulativeDetectedSeconds: number;
  lostIntervals: Array<{
    lostAtSeconds: number;
    reacquiredAtSeconds: number;
    durationSeconds: number;
    lostClock: string;
    reacquiredClock: string;
    ref: string | number;
  }>;
  identificationHistory?: Array<{
    scenarioSeconds: number;
    clockText: string;
    status: string;
    sensorId?: string;
    rangeHorizNm?: number;
    ref: string | number;
  }>;
}

export interface WeaponFiredRecord {
  eventId: string;
  scenarioSeconds: number;
  clockText: string;
  firerUnitId: string;
  firerName: string;
  firerSide: string;
  firerLon?: number;
  firerLat?: number;
  weaponId?: string;
  weaponDbid?: string;
  /** 已剥离 " #序号" 后缀的规范武器型号 */
  weaponTypeNormalized: string;
  weaponNameRaw: string;
  rounds: number;
  targetContactId?: string;
  targetUnitId?: string;
  targetName?: string;
  targetSide?: string;
  targetLon?: number;
  targetLat?: number;
  rangeHorizNm?: number;
  salvoId?: string;
  sourceRef: string;
}

export interface WeaponEndgameRecord {
  eventId: string;
  scenarioSeconds: number;
  clockText: string;
  weaponId: string;
  weaponName: string;
  weaponSide: string;
  parentFiringUnitId?: string;
  targetId?: string;
  targetName?: string;
  targetSide?: string;
  result: string; // KILL | HIT | MISS | POINTDEF:SUCCESS | POINTDEF:FAILURE | UNDEFINED
  endgameMessage?: string;
  sourceRef: string;
}

export interface DamageAndHitEvent {
  eventId: string;
  scenarioSeconds: number;
  clockText: string;
  targetUnitId: string;
  targetUnitName?: string;
  targetSide: string;
  damageState: 'damaged' | 'destroyed';
  damagePercent?: number;
  sourceWeapon?: string;
  reason?: string;
  cause?: string;
  sourceRef: string;
}

export interface ExpenditureRecord {
  side: string;
  dbid: string;
  weaponName: string;
  num: number;
  sourceRef: string;
}

export interface LossRecord {
  side: string;
  subjectId: string;
  dbid: string;
  subjectName: string;
  unitType: string;
  unitClass: string;
  sourceRef: string;
}

export interface StructuredSimEvent {
  eventId: string;
  scenarioSeconds: number;
  clockText: string;
  side: string | null;
  kind:
    | 'unit_new'
    | 'unit_destroyed'
    | 'unit_damaged'
    | 'weapon_fired'
    | 'weapon_endgame'
    | 'weapon_impact'
    | 'unit_maneuver'
    | 'detection_new'
    | 'detection_lost'
    | 'identification_change'
    | 'engine_event'
    | 'playback_state'
    | 'parse_error';
  subject: string | null;
  object: string | null;
  severity: 'major' | 'minor';
  detail: Record<string, unknown>;
  source: 'frame' | 'csv' | 'diff' | 'engine_push';
  ref: string | number;
}

export interface TelemetryCoverage {
  sourceKind: 'bs_jsonl' | 'event_csv' | 'hybrid';
  hasPositionTracks: boolean;
  hasContacts: boolean;
  hasWeaponFired: boolean;
  hasWeaponEndgame: boolean;
  hasPointDefense: boolean;
  hasDamagedOrDestroyed: boolean;
  hasSensorStates: boolean;
  hasWraRules: boolean;
  hasPolygonsOrCorridors: boolean;
  hasExpenditures: boolean;
  hasLosses: boolean;
  bomCountDetected?: number;
  warnings: string[];
}

export interface SituationModel {
  runId: string;
  scenarioPath: string;
  scenarioName?: string;
  scenarioFingerprint?: string;
  timelineId?: string;
  startGameClock: string;
  endGameClock: string;
  totalGameSeconds: number;
  terminationReason?: string;
  isPartial?: boolean;
  sides: string[];
  units: Map<string, SituationUnit>;
  contacts: Map<string, SituationContact>;
  weaponFiredEvents: WeaponFiredRecord[];
  weaponEndgameEvents: WeaponEndgameRecord[];
  damageAndHitEvents: DamageAndHitEvent[];
  expenditures: ExpenditureRecord[];
  losses: LossRecord[];
  events: StructuredSimEvent[];
  corridors: EvalPolygon[];
  patrolAreas: EvalPolygon[];
  threatZones: ThreatZone[];
  sensorCoverageBaseline?: Array<{
    unitId: string;
    side: string;
    sensorId: string;
    sensorMaxRangeNm: number;
  }>;
  /** 扩展遥测资产（可选，保持向前兼容；无对应来源表时不伪造） */
  weaponLostEvents?: Array<{
    weaponName: string;
    dbid: string;
    side: string;
    num: number;
    sourceRef: string;
  }>;
  weaponImpactEvents?: Array<{
    unitId: string;
    scenarioSeconds: number;
    clockText: string;
    speedKts?: number;
    altitudeM?: number;
    lon?: number;
    lat?: number;
    sourceRef: string;
  }>;
  fuelRecords?: Array<{
    unitId: string;
    unitName?: string;
    side: string;
    currentQty?: number;
    maxQty?: number;
    consumedQty?: number;
    sourceRef: string;
  }>;
  airOpsEvents?: Array<{
    unitId: string;
    unitName: string;
    side: string;
    action: string;
    scenarioSeconds: number;
    clockText: string;
    sourceRef: string;
  }>;
  sensorClassCount?: number;
  commClassCount?: number;
  coverage: TelemetryCoverage;
  /** 可选外部单价表 { dbidOrName: price } */
  unitPrices?: Record<string, number>;
  /** 可选蒙卡局判据结果 { iter: boolean } (严格对齐 metrics.py FAIL-CLOSED) */
  criteriaResults?: Record<string, boolean>;
}

export interface MetricAtomContext {
  runId: string;
  situation: SituationModel;
  csvStats?: Record<string, unknown>;
  customParams?: {
    targetSide?: string;
    enemySide?: string;
    safeRadiusNm?: number;
    arrivalLineLon?: number;
    corridors?: EvalPolygon[];
    patrolAreas?: EvalPolygon[];
    threatZones?: ThreatZone[];
    unitPrices?: Record<string, number>;
    expectedSpacingNm?: number;
    unauthorizedWindowSeconds?: [number, number];
    silent?: boolean;
    [key: string]: unknown;
  };
}

export interface MetricAtomResult {
  atomId: string;
  value: number | boolean | null;
  displayValue: string;
  status: 'valid' | 'degraded' | 'unavailable';
  confidence: 'high' | 'medium' | 'low';
  evidenceRefs: EvidenceRef[];
  missingDataReason?: string;
  details?: Record<string, unknown>;
}

// ──────────────────── 二库：标准指标库与评分卡口 ────────────────────

export interface ScoringRule {
  type: 'linear' | 'smaller_is_better' | 'larger_is_better' | 'step' | 'boolean' | 'target_range';
  bounds?: [number, number];
  scoreRange?: [number, number];
  optimal?: number;
  worst?: number;
  optimalRange?: [number, number];
  toleranceRange?: [number, number];
  steps?: Array<{ val: number; score: number }>;
  trueScore?: number;
  falseScore?: number;
}

export interface AlarmThreshold {
  operator: '>' | '<' | '==' | '>=' | '<=';
  value: number;
  severity: 'major' | 'minor';
  messageTemplate?: string;
}

export interface IndicatorDefinition {
  indicatorId: string;
  name: string;
  description?: string;
  atomRef: string;
  targetField?: string;
  unit?: string;
  filterCriteria?: Record<string, string | number | boolean>;
  scoring: ScoringRule;
  alarmThreshold?: AlarmThreshold;
  tags?: string[];
  builtin?: boolean;
}

// ──────────────────── 三库：评估体系 DSL ────────────────────

export interface SystemKpiBinding {
  label: string;
  atomRef: string;
  formatter: 'percent_ci' | 'duration_min' | 'duration_sec' | 'count' | 'ratio' | 'currency';
}

export interface SystemIndicatorLeaf {
  id?: string;
  indicatorRef: string;
  weight: number;
  customLabel?: string;
}

export interface SystemDimensionNode {
  id: string;
  name: string;
  weight: number;
  method?: 'weighted_sum';
  children: Array<SystemDimensionNode | SystemIndicatorLeaf>;
}

export interface IndicatorSystem {
  $schema?: string;
  systemId: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  targetTags: string[];
  kpis: SystemKpiBinding[];
  root: {
    name: string;
    weight: number;
    method: 'weighted_sum';
    children: Array<SystemDimensionNode | SystemIndicatorLeaf>;
  };
  builtin?: boolean;
}

export interface EvaluatedLeafNode {
  kind: 'indicator';
  indicatorRef: string;
  name: string;
  atomRef: string;
  weight: number;
  effectiveWeight: number;
  rawResult: MetricAtomResult;
  score: number | null;
  weightedContribution: number;
}

export interface EvaluatedDimensionNode {
  kind: 'dimension';
  id: string;
  name: string;
  weight: number;
  effectiveWeight: number;
  score: number | null;
  availableWeightRatio: number;
  children: Array<EvaluatedDimensionNode | EvaluatedLeafNode>;
}

export interface SystemEvaluationOutput {
  evalId: string;
  runId: string;
  systemId: string;
  systemName: string;
  systemVersion: string;
  createdAt: string;
  overallScore: number | null;
  overallConfidence: 'high' | 'medium' | 'low';
  availableWeightRatio: number;
  dimensions: Array<{ id: string; name: string; weight: number; score: number | null }>;
  rootTree: {
    name: string;
    score: number | null;
    children: Array<EvaluatedDimensionNode | EvaluatedLeafNode>;
  };
  atomResults: Record<string, MetricAtomResult>;
  evalSummaryV2: EvalSummaryV2;
}

// ──────────────────── 产出契约 v2 & 战术反哺 ────────────────────

export interface EvalSummaryV2 {
  kpis: Array<{ label: string; value: string; status?: 'valid' | 'degraded' | 'unavailable'; atomRef?: string }>;
  compareNote: string;
  bars: Array<{ label: string; value: number; unit: string }>;
  radar: {
    dimensions: string[];
    scores: number[];
    benchmark: number[];
  };
  conclusionTitle: string;
  conclusion: string;
  judgement: string;
  evidenceTimeline: Array<{
    scenarioClock: string;
    event: string;
    ref: string;
    desc: string;
  }>;
}

export interface TacticalFeedbackPayload {
  $schema: 'https://f1-ai.schema/tactical-feedback/v1.json';
  runId: string;
  evaluatedSide: string;
  overallScore: number | null;
  tacticalGrade: 'A' | 'B+' | 'B' | 'C' | 'D' | 'INCOMPLETE';
  weaknessDiagnostics: Array<{
    code: string;
    dimension: string;
    metricAtom: string;
    observedValue: number | null;
    benchmarkValue: number;
    score: number | null;
    diagnosis: string;
    evidenceRefs: EvidenceRef[];
    suggestedDirectives: string[];
  }>;
  recommendedDoctrinePatches: Record<string, unknown>;
}

// ──────────────────── 离线仿真产物剖析契约 (Stage 7) ────────────────────

export interface CatalogEventField {
  name: string;
  cs_type?: string;
  db_type?: string | null;
  max_len?: number;
  unit?: string;
  note?: string;
  condition?: string;
  enum_values?: string[];
}

export interface CatalogEventSpec {
  id: number;
  name: string;
  status: 'active' | 'unused_enum' | 'placeholder';
  call_sites?: string[];
  gating?: string;
  throttled?: boolean;
  side_split_key?: string | null;
  db_table?: boolean;
  db_cols_count?: number;
  tacview?: boolean;
  in_scan_31?: boolean;
  in_repo_samples?: boolean;
  has_make_paras_prefix?: boolean;
  has_time_col?: boolean;
  note?: string;
  fields?: CatalogEventField[];
}

export interface CatalogChannelSpec {
  id: string;
  name: string;
  entry_points?: string[];
  consumer_entry_points?: string[];
  gating_sources?: string[];
  gating_note?: string;
  recommended_primary_format?: string;
  csv_quirks?: string[];
  publisher_location?: string;
  observed_rate_q077?: string;
}

export interface CatalogJoinRecipe {
  recipe: string;
  left?: string;
  right?: string;
  then?: string;
  path?: string;
  inputs?: string[];
  scope?: string;
}

export interface F1OutputCatalog {
  catalog_id?: string;
  catalog_version?: string;
  audit_basis?: {
    source_trees?: string[];
    note?: string;
  };
  channels?: CatalogChannelSpec[];
  event_exporter?: {
    shared_make_paras_dict_prefix?: CatalogEventField[];
    events?: CatalogEventSpec[];
  };
  bs_mqtt?: {
    topics?: string[];
    scenario_paths?: Record<string, string | string[]>;
  };
  bridge_and_auxiliary?: {
    http_bridge_default_url?: string;
    bridge_tools?: Record<string, string[]>;
    tcp_data_output_server?: { config?: string; wire_format?: string };
    dis_pdus_sent?: string[];
    dis_pdus_absent?: string[];
  };
  join_graph?: CatalogJoinRecipe[];
  doc_discrepancies?: string[];
}

export interface LinkedOperatorSummary {
  id: string;
  name: string;
  category: string;
  readiness: string;
}

export type CsvRunPresence =
  | 'active_with_rows'
  | 'empty_header_only'
  | 'missing_in_run'
  | 'unused_enum'
  | 'placeholder';

export interface CsvTableProfileEntry {
  catalogId: number | null;
  name: string;
  catalogStatus: 'active' | 'unused_enum' | 'placeholder' | 'extra_unlisted';
  runPresence: CsvRunPresence;
  dbTable: boolean;
  tacview: boolean;
  inScan31: boolean;
  inRepoSamples: boolean;
  gating?: string;
  sideSplitKey?: string | null;
  note?: string;
  fileNames: string[];
  bytes: number;
  bomCount: number;
  rowCount: number;
  rawFileRowCount: number;
  actualHeaders: string[];
  expectedHeaders: string[];
  missingColumns: string[];
  extraColumns: string[];
  catalogFields: CatalogEventField[];
  drivenOperators: LinkedOperatorSummary[];
}

export interface CsvTablePreview {
  tableName: string;
  fileNames: string[];
  headers: string[];
  totalRows: number;
  limit: number;
  rows: Array<{
    file: string;
    line: number;
    data: Record<string, string>;
  }>;
}

export type BsFamilyKey =
  | 'root'
  | 'side_wrapper'
  | 'side_fields'
  | 'unit_wrapper'
  | 'unit_fields'
  | 'non_active'
  | 'scenario_events';

export interface BsPathMetricItem {
  id: string;
  family: BsFamilyKey;
  familyLabel: string;
  pathExpr: string;
  label: string;
  hitFrames: number;
  totalFrames: number;
  hitRate: number;
  totalItemCount: number;
  sampleValue?: string;
  discrepancyNote?: string;
  drivenOperators: LinkedOperatorSummary[];
}

export interface BsFamilyCatalogGroup {
  key: BsFamilyKey;
  label: string;
  rawPaths: string[];
  populatedPathsCount: number;
  totalTrackedCount: number;
}

export interface RunSourceProfile {
  runMeta: {
    runId: string;
    scenarioName: string;
    sourceKind: string;
    scenarioPath: string;
    timelineId: string | null;
    sourceAvailable: boolean;
    sourceMissingReason?: string;
    catalogVersion: string;
    totalCatalogEvents: number;
    totalCatalogBsTopics: number;
  };
  csvProfile: {
    csvDir: string | null;
    dirExists: boolean;
    bomFilesCount: number;
    maxBomCount: number;
    discoveredFileCount: number;
    totalDataRows: number;
    totalBytes: number;
    statusSummary: {
      activeWithRows: number;
      emptyHeaderOnly: number;
      missingInRun: number;
      unusedEnum: number;
      placeholder: number;
    };
    tables: CsvTableProfileEntry[];
    preview: CsvTablePreview | null;
  };
  bsProfile: {
    jsonlFile: string | null;
    fileExists: boolean;
    bytes: number;
    totalLines: number;
    parsedFrames: number;
    parseErrors: number;
    stringifiedScalarFrames: number;
    singleKeyWrapperFrames: number;
    unitWrapperTypes: Record<string, number>;
    topics: string[];
    pathMetrics: BsPathMetricItem[];
    familyCatalog: BsFamilyCatalogGroup[];
  };
}

// ──────────────────── Stage 9：自定义衍生算子与工作台对比/扫参 ────────────────────

// ──────────────────── Stage 9 & Stage 10：算子流水线与 LibFormula/聚合计算契约 ────────────────────

export type FieldDataType = 'number' | 'string' | 'boolean' | 'datetime';

export interface DatasetColumn {
  name: string;
  type: FieldDataType;
  displayName?: string;
  description?: string;
  isDerived?: boolean;
}

export interface TableDataset {
  id?: string;
  columns: DatasetColumn[];
  schema?: DatasetColumn[] | any[];
  rows: Array<Record<string, unknown>>;
  totalRows?: number;
}

export interface DerivedColumnConfig {
  id?: string;
  columnName?: string;
  name?: string;
  dataType?: FieldDataType;
  expression: string;
  overwriteColumn?: string;
  description?: string;
  outputType?: string;
}

export interface FormulaOperatorConfig {
  derivedColumns: DerivedColumnConfig[];
  upstreamColumns?: DatasetColumn[];
}

export type AggregationMethod =
  | 'AVERAGE'
  | 'SUM'
  | 'MAX'
  | 'MIN'
  | 'COUNT_ALL'
  | 'COUNT_DISTINCT'
  | 'COUNT_NON_EMPTY'
  | 'STDEV'
  | 'STDEVP'
  | 'FIRST'
  | 'LAST';

export interface AggregationMetricItem {
  id?: string;
  targetField?: string;
  outputField?: string;
  sourceColumn?: string;
  sourceField?: string;
  method: AggregationMethod;
  dataType?: FieldDataType;
  description?: string;
}

export interface AggregationOperatorConfig {
  groupKeys: string[];
  metrics: AggregationMetricItem[];
}

export interface PipelinePreviewResult {
  previewSchema: DatasetColumn[];
  previewRows: Array<Record<string, unknown>>;
  totalRows: number;
  diffCols: string[];
  latencyMs: number;
  success: boolean;
  errors?: string[];
}

export interface CustomOperatorVarBinding {
  alias: string;
  atomRef: string;
}

export type SourceBindingAgg =
  | 'count_rows'
  | 'count_non_empty'
  | 'count_distinct'
  | 'sum'
  | 'avg'
  | 'min'
  | 'max'
  | 'first_num'
  | 'last_num';

export interface OperatorSourceBinding {
  sourceType: 'csv' | 'bs_jsonl';
  csvTable?: string;
  csvColumn?: string;
  bsPath?: string;
  filterField?: string;
  filterEquals?: string;
  aggregation: SourceBindingAgg;
}

export interface CustomOperatorDefinition {
  id: string;
  name: string;
  category: OperatorCategory;
  description: string;
  mode?: 'formula' | 'source_binding' | 'formula_pipeline' | 'aggregation' | 'spatial' | 'python_script';
  pipelineCategory?: 'data_input' | 'inline_calc' | 'group_agg' | 'result_output' | string;
  expression: string;
  variables: CustomOperatorVarBinding[];
  sourceBinding?: OperatorSourceBinding;
  formulaConfig?: FormulaOperatorConfig;
  aggregationConfig?: AggregationOperatorConfig;
  targetField?: string;
  f1FieldContract?: OperatorFieldContract;
  outputType: OperatorOutputType;
  unit?: string;
  defaultOptimalDirection: OptimalDirection;
  defaultParams?: OperatorDefaultParams;
  createdAt?: string;
  updatedAt?: string;
}

export interface OperatorSweepPoint {
  paramValue: number;
  value: number | null;
  status: MetricAtomResult['status'];
  displayValue: string;
}

export interface OperatorComparisonRow {
  meta: MetricAtomMeta;
  runA: MetricAtomResult;
  runB: MetricAtomResult;
  deltaNumeric: number | null;
}
