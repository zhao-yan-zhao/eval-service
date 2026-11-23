/**
 * F1 / CMO 仿真推演评估中台核心强类型契约
 * 严格对齐：
 * 1) docs/推演评估中台总体设计方案.md (§2.1, §4.1, §5.1, §5.2, §6.3, §7.1, §7.3)
 * 2) sim-output-fields/schemas/f1-output-catalog.json（实证字段与偏差 D1-D9 纠偏契约）
 */

export type OperatorCategory = 'time' | 'effectiveness' | 'situation' | 'compliance' | 'cost';
export type EvalRole = 'MOE' | 'MOP' | 'MOS' | 'SURV' | 'GATE';
export type OperatorDomain = 'moe' | 'kill_chain' | 'weapon' | 'survivability' | 'suitability' | 'roe_cost';
export type GateMode = 'hard' | 'soft';
export type GateStatus = 'pass' | 'violated' | 'unavailable';
export type PipelineCategory = 'data_input' | 'inline_calc' | 'group_agg' | 'result_output' | 'spatial' | 'python_script';
export type OperatorReadiness = 'batch_a_ready' | 'batch_b_pending';
export type RequiredDataSource = 'situation' | 'events' | 'unit_states' | 'csv' | 'db3k';
export type OperatorOutputType = 'duration_seconds' | 'rate' | 'count' | 'ratio' | 'score';
export type OptimalDirection = 'smaller_is_better' | 'larger_is_better' | 'range_bounded';

/** WRA (Weapon Release Authority) 交战射程与齐射规则 */
export interface WraRules {
  minRangeNm?: number;
  maxRangeNm?: number;
  maxSalvoSize?: number;
  doctrineProfile?: 'bvr_air' | 'standoff_strike' | 'air_defense' | 'asw' | 'custom';
}

/** 指定目标集过滤器（用于区分任务目标集 Target Set 与全场单位） */
export interface TargetUnitFilter {
  unitIds?: string[];
  unitNamePattern?: string;
  unitClassPattern?: string;
  unitTypes?: string[];
}

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
  /** 美军评估角色分层：MOE(作战效能) / MOP(任务性能) / MOS(适用保障) / SURV(生存性) / GATE(安全红线) */
  evalRole?: EvalRole;
  /** Operators v2 能力域 */
  domain?: OperatorDomain;
  /** 对齐的美军条令/运筹口径参考 */
  doctrineRef?: string;
  /** 仅 GATE 角色有效：hard=一票否决/总分封顶，soft=红线告警 */
  gateMode?: GateMode;
  /** 是否支持按任务指定目标集过滤 */
  supportsTargetFilter?: boolean;
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
  hasEngagementCycle?: boolean;
  hasFirstSensorRecord?: boolean;
  hasComponentStatus?: boolean;
  hasEwJamming?: boolean;
  hasCommJamming?: boolean;
  hasDockingOps?: boolean;
  hasFuelTransfer?: boolean;
  hasMissionMeta?: boolean;
  bomCountDetected?: number;
  warnings: string[];
}

export interface EngagementCycleRecord {
  scenarioSeconds: number;
  clockText: string;
  unitId: string;
  unitName: string;
  unitClass: string;
  unitSide: string;
  cycleAction: string;
  contactId?: string;
  contactName?: string;
  contactRangeHorizNm?: number;
  contactActualUnitId?: string;
  contactActualUnitSide?: string;
  salvoId?: string;
  sourceRef: string;
}

export interface FirstSensorDetectionRecord {
  scenarioSeconds: number;
  clockText: string;
  sensorId: string;
  targetId: string;
  distanceNm: number;
  observerUnitId?: string;
  observerSide?: string;
  sensorName?: string;
  sourceRef: string;
}

export interface ComponentStatusRecord {
  scenarioSeconds: number;
  clockText: string;
  componentId: string;
  componentName: string;
  componentStatus: string;
  sensorIsActive?: boolean;
  componentDamageSeverity: string;
  platformId: string;
  platformName: string;
  platformSide?: string;
  sourceRef: string;
}

export interface UnitJamRecord {
  scenarioSeconds: number;
  clockText: string;
  unitId: string;
  unitSide?: string;
  isJammed: boolean;
  rawStatus: string;
  sourceRef: string;
}

export interface CommDeviceRecord {
  unitId: string;
  unitName: string;
  unitSide?: string;
  commId: string;
  commName: string;
  commDbid?: string;
  commStatus?: string;
  sourceRef: string;
}

export interface CommJamRecord {
  scenarioSeconds: number;
  clockText: string;
  commId: string;
  commName: string;
  unitId?: string;
  unitSide?: string;
  isJammed: boolean;
  sourceRef: string;
}

export interface DockingOpsRecord {
  scenarioSeconds: number;
  clockText: string;
  unitId: string;
  unitName: string;
  side: string;
  action: string;
  departureHostId?: string;
  arrivalHostId?: string;
  missionId?: string;
  totalFuel?: number;
  sourceRef: string;
}

export interface FuelTransferRecord {
  scenarioSeconds: number;
  clockText: string;
  unitId: string;
  unitName: string;
  unitSide: string;
  receiverId: string;
  receiverName: string;
  receiverSide: string;
  fuelQuantity: number;
  fuelType?: string;
  sourceRef: string;
}

export interface MissionMetaRecord {
  missionId: string;
  missionName: string;
  side: string;
  category?: string;
  missionClass?: string;
  isActive?: boolean;
  startTimeSeconds?: number;
  endTimeSeconds?: number;
  takeOffTimeSeconds?: number;
  timeOnTargetSeconds?: number;
  timeOnTargetRaw?: string;
  sourceRef: string;
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
  /** SimInfo 蒙特卡洛元数据 */
  monteCarloId?: string;
  monteCarloIteration?: number;
  /** Operators v2 新增原生表遥测资产（严格对齐 f1-output-catalog.json） */
  engagementCycleEvents?: EngagementCycleRecord[];
  firstSensorDetections?: FirstSensorDetectionRecord[];
  componentStatusEvents?: ComponentStatusRecord[];
  unitJamEvents?: UnitJamRecord[];
  commDevices?: CommDeviceRecord[];
  commJamEvents?: CommJamRecord[];
  dockingOpsEvents?: DockingOpsRecord[];
  fuelTransferEvents?: FuelTransferRecord[];
  missionMetas?: MissionMetaRecord[];
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
    /** Operators v2 新增参数：MAR 脱离半径、WRA 规则、目标集过滤、BDA 毁伤阈值、门控策略 */
    marNm?: number;
    wraRules?: WraRules;
    targetUnitFilter?: TargetUnitFilter;
    bdaDamageThresholdPct?: number;
    gateMode?: GateMode;
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
  /** 支持多局蒙特卡洛精确合并的原始分子/分母与样本量 */
  numerator?: number;
  denominator?: number;
  sampleSize?: number;
  /** 仅 GATE 角色算子输出：红线门控状态 */
  gateStatus?: GateStatus;
  /** 零己损完胜标记（避免将 3:0 与 3:1 混为一谈） */
  zeroLossVictory?: boolean;
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

export type IndicatorReduceMethod = 'mean' | 'sum' | 'max' | 'min' | 'median' | 'last' | 'first';

export interface IndicatorSourceBinding {
  alias: string;
  atomRef: string;
  targetField?: string;
  reduce?: IndicatorReduceMethod;
  filterCriteria?: Record<string, string | number | boolean>;
  missingPolicy?: 'fail' | 'fallback';
  fallbackValue?: number;
}

export interface IndicatorDefinition {
  indicatorId: string;
  name: string;
  description?: string;
  bindingMode?: 'single' | 'composite';
  atomRef: string;
  targetField?: string;
  reduce?: IndicatorReduceMethod;
  filterCriteria?: Record<string, string | number | boolean>;
  sources?: IndicatorSourceBinding[];
  composeFormula?: string;
  unit?: string;
  scoring: ScoringRule;
  alarmThreshold?: AlarmThreshold;
  tags?: string[];
  builtin?: boolean;
}

// ──────────────────── 三库：评估体系 DSL ────────────────────

export type AggregationStrategy =
  | 'weighted_sum'
  | 'weighted_product'
  | 'geometric_mean'
  | 'maximin'
  | 'max'
  | 'mean'
  | 'formula';

export type NodeMissingPolicy =
  | 'skip_renormalize'
  | 'fail'
  | 'worst'
  | 'neutral';

export interface NodeAggregationConfig {
  mode: 'visual' | 'formula';
  strategy: AggregationStrategy;
  missingPolicy?: NodeMissingPolicy;
  customFormula?: string;
  ahpMatrix?: number[][];
  ahpCr?: number;
}

export interface SystemKpiBinding {
  label: string;
  atomRef: string;
  formatter: 'percent_ci' | 'duration_min' | 'duration_sec' | 'count' | 'ratio' | 'currency';
}

export interface SystemIndicatorLeaf {
  id?: string;
  nodeCode?: string;
  indicatorRef: string;
  weight: number;
  customLabel?: string;
}

export interface SystemDimensionNode {
  id: string;
  nodeCode?: string;
  name: string;
  weight: number;
  aggregation?: NodeAggregationConfig;
  method?: 'weighted_sum';
  children: Array<SystemDimensionNode | SystemIndicatorLeaf>;
}

export interface IndicatorSystemRoot {
  id?: string;
  nodeCode?: string;
  name: string;
  weight: number;
  aggregation?: NodeAggregationConfig;
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
  /** 体系场景默认 WRA 规则（单算子裸跑缺省时自动按场景注入） */
  defaultWraRules?: WraRules;
  /** 体系安全红线门控策略覆盖（如 roe.fratricide_count: 'hard', roe.pid_before_fire_rate: 'soft'） */
  gatePolicies?: Record<string, GateMode>;
  kpis: SystemKpiBinding[];
  root: IndicatorSystemRoot;
  builtin?: boolean;
}

export interface EvaluatedLeafNode {
  kind: 'indicator';
  id?: string;
  nodeCode?: string;
  indicatorRef: string;
  name: string;
  atomRef: string;
  weight: number;
  effectiveWeight: number;
  rawResult: MetricAtomResult;
  score: number | null;
  weightedContribution: number;
  depth?: number;
}

export interface EvaluatedDimensionNode {
  kind: 'dimension';
  id: string;
  nodeCode?: string;
  name: string;
  weight: number;
  effectiveWeight: number;
  score: number | null;
  availableWeightRatio: number;
  strategyUsed?: AggregationStrategy;
  missingPolicyUsed?: NodeMissingPolicy;
  formulaApplied?: string;
  depth?: number;
  children: Array<EvaluatedDimensionNode | EvaluatedLeafNode>;
}

export type GateVerdict = 'PASS' | 'WARNING' | 'DISQUALIFIED';

export interface GateAuditItem {
  atomId: string;
  name: string;
  gateMode: GateMode;
  gateStatus: GateStatus;
  displayValue: string;
  evidenceRefs: EvidenceRef[];
}

export interface SystemEvaluationOutput {
  evalId: string;
  runId: string;
  systemId: string;
  systemName: string;
  systemVersion: string;
  createdAt: string;
  /** 生效总分（若触发 Hard Gate 一票否决，将被封顶 <= 39） */
  overallScore: number | null;
  /** 未封顶的原始战术效能总分（用于复盘诊断） */
  rawOverallScore?: number | null;
  /** 安全红线门控总裁决：PASS / WARNING / DISQUALIFIED */
  gateVerdict?: GateVerdict;
  /** 独立安全红线审计明细 */
  gateAudit?: GateAuditItem[];
  overallConfidence: 'high' | 'medium' | 'low';
  availableWeightRatio: number;
  dimensions: Array<{ id: string; name: string; weight: number; score: number | null }>;
  rootTree: {
    id?: string;
    nodeCode?: string;
    name: string;
    score: number | null;
    strategyUsed?: AggregationStrategy;
    missingPolicyUsed?: NodeMissingPolicy;
    formulaApplied?: string;
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
  /** V4 多维表维度主键列与度量列声明（Tidy Data 元信息） */
  dimensionKeys?: string[];
  measureKeys?: string[];
  /** V4 多方案 / 多局实验自动注入的标识字段 */
  planId?: string;
  runId?: string;
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
  dataset?: TableDataset;
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

// ──────────────────── V4：全链路 DAG 评估架构核心强类型契约 ────────────────────

/** 节点运行时参数声明（支持从效果层向一库/二库透传行级物理阈值） */
export interface ParameterPortSpec {
  key: string;
  label: string;
  dataType: 'number' | 'string' | 'boolean' | 'json';
  defaultValue: unknown;
  description?: string;
}

/** 三层 DAG 画布强类型隔离标记 */
export type DagGraphKind = 'operator' | 'metric' | 'system';

export interface DagEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  /** 仅 system 画布有效：指向目标效果节点的局部权重（入边之和=1.0） */
  weight?: number;
  /** 可选端口绑定：将上游输出列或结果绑定到目标节点变量别名 */
  targetAlias?: string;
}

export interface DagNodeBase {
  id: string;
  kind: string;
  label: string;
  position: { x: number; y: number };
  collapsed?: boolean;
  /** 节点声明的可外部覆盖参数端口 */
  parameterPorts?: ParameterPortSpec[];
  /** 当前节点实参或参数透传覆盖 */
  params?: Record<string, unknown>;
}

/** 通用 DAG 图定义（一库算子与二库指标共享拓扑骨架，通过 graphKind 强隔离） */
export interface DagGraphDefinition<TNode extends DagNodeBase = DagNodeBase> {
  graphId: string;
  name: string;
  description?: string;
  graphKind: DagGraphKind;
  nodes: TNode[];
  edges: DagEdge[];
  globalParams?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

/** 一库算子节点输出：强契约为 TableDataset + Fail-Closed 证据状态 */
export interface OperatorNodeExecutionResult {
  nodeId: string;
  status: 'valid' | 'degraded' | 'unavailable';
  dataset?: TableDataset;
  evidenceRefs: EvidenceRef[];
  missingDataReason?: string;
  cacheKey: string;
  latencyMs: number;
}

/** 二库指标军事运筹层次与五大能力域标签 */
export type MetricMilitaryLevel = 'MOP' | 'MOE' | 'MOFE';
export type MetricDomainTag = 'firepower' | 'isr' | 'survivability' | 'c2' | 'synergy' | 'cost';

/** 二库指标节点配置：支持引用算子表、聚合切片或引用其他指标二次派生（无权重、无主观打分） */
export interface MetricNodeConfig {
  metricId: string;
  name: string;
  description?: string;
  militaryLevel: MetricMilitaryLevel;
  domainTag: MetricDomainTag;
  mode: 'from_operator' | 'from_metric_agg' | 'from_metric_formula';
  /** 上游来源 ID（operatorId 或 upstream metricId） */
  sourceRef?: string;
  filterCriteria?: Record<string, unknown>;
  groupBy?: string[];
  targetField?: string;
  reduce?: IndicatorReduceMethod;
  /** 多指标复合计算表达式（走 LibFormula 安全 AST） */
  formulaExpression?: string;
  unit?: string;
}

/** 二库指标 DAG 图定义 */
export interface MetricGraphDefinition extends DagGraphDefinition<
  DagNodeBase & { metricConfig?: MetricNodeConfig }
> {
  graphKind: 'metric';
}

/** 三库独立效果定义：效果组件库核心模型，支持人工判定标准、效用映射与无限层级叠加 */
export interface EffectDefinition {
  effectId: string;
  name: string;
  description?: string;
  isBuiltin?: boolean;
  domainTag?: MetricDomainTag;
  /** 角色：普通效果合成 / 安全红线门控 */
  role: 'effect' | 'gate';
  gateMode?: GateMode;
  /** 接入二库指标时的降维切片与效用转换规则（人工完成标准在此生效） */
  metricBinding?: {
    metricId: string;
    sliceFilter?: Record<string, unknown>;
    targetField?: string;
    reduce?: IndicatorReduceMethod;
    /** 透传给上游算子/指标的参数覆盖（如毁伤达标线 0.5、在阵位最低秒数 1800） */
    paramOverrides?: Record<string, unknown>;
    scoringRule: ScoringRule;
    alarmThreshold?: AlarmThreshold;
  };
  /** 合成策略：当由多个子效果/指标入边叠加时生效 */
  aggregation: {
    strategy: AggregationStrategy;
    missingPolicy: NodeMissingPolicy;
    customFormula?: string;
    ahpMatrix?: number[][];
    ahpCr?: number;
  };
}

/** 三库评估体系 DAG（替代旧版固定树 Root，支持无限层级自由有向无环图） */
export interface EvaluationSystemDag {
  systemId: string;
  name: string;
  version: string;
  description?: string;
  /** 画布节点：可以是引用二库的 MetricProxy，也可以是内置/独立/私有的 EffectNode */
  nodes: Array<DagNodeBase & { refId?: string; inlineEffect?: EffectDefinition }>;
  edges: DagEdge[];
  /** 指定作为体系最终综合效能输出的终态效果节点 ID */
  terminalEffectNodeId: string;
  /** 全局方案级默认参数（如 targetSide、enemySide、WRA 规则等） */
  globalParams?: Record<string, unknown>;
}

/** 三库效果 DAG 单节点评估结果 */
export interface EvaluatedEffectNode {
  nodeId: string;
  effectId?: string;
  label: string;
  role: 'effect' | 'gate' | 'metric_proxy';
  gateMode?: GateMode;
  gateStatus?: GateStatus;
  rawValue?: number | boolean | null;
  score: number | null;
  status: 'valid' | 'degraded' | 'unavailable';
  availableWeightRatio: number;
  effectiveWeights: Record<string, number>;
  strategyUsed?: AggregationStrategy;
  missingPolicyUsed?: NodeMissingPolicy;
  missingDataReason?: string;
  evidenceRefs: EvidenceRef[];
  incomingEdgeIds: string[];
  depth: number;
}

/** 三库评估体系 DAG 整体输出 */
export interface EvaluationDagOutput {
  evalId: string;
  runId: string;
  systemId: string;
  systemName: string;
  systemVersion: string;
  createdAt: string;
  terminalEffectNodeId: string;
  overallScore: number | null;
  rawOverallScore: number | null;
  gateVerdict: GateVerdict;
  gateAudit: GateAuditItem[];
  availableWeightRatio: number;
  nodeResults: Record<string, EvaluatedEffectNode>;
  topologicalOrder: string[];
}

/** 节点级内容寻址缓存项 */
export interface NodeExecutionCacheEntry {
  cacheKey: string;
  graphKind: DagGraphKind;
  nodeId: string;
  status: 'valid' | 'degraded' | 'unavailable';
  payload: TableDataset | number | boolean | null;
  missingDataReason?: string;
  computedAt: string;
}
