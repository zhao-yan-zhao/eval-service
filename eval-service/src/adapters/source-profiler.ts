/**
 * Stage 7 离线仿真产物（EventExporter CSV 与 BS JSONL 帧流）只读剖析器
 * - 零写盘、零复制原始大文件进 eval.db
 * - 与 sim-output-fields/schemas/f1-output-catalog.json（44 类标准导出事件 + 7 族 BS 路径）实时逐表/逐帧对照
 * - 所有文件名匹配仅限已发现目录列表，绝不拼接未校验路径参数
 */

import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error demo-ui/proxy/bs-diff.mjs 为无类型标注 ESM 模块
import { scenarioOf, unwrapRecord } from '../../../demo-ui/proxy/bs-diff.mjs';
import {
  locateCsvDirectory,
  readCsvTable,
  resolveCanonicalCsvEventName,
} from './csv-adapter.ts';
import { unwrapEntity } from './frame-adapter.ts';
import type {
  BsFamilyCatalogGroup,
  BsFamilyKey,
  BsPathMetricItem,
  CatalogEventField,
  CatalogEventSpec,
  CsvRunPresence,
  CsvTablePreview,
  CsvTableProfileEntry,
  F1OutputCatalog,
  LinkedOperatorSummary,
  MetricAtomMeta,
  RunSourceProfile,
  SituationModel,
} from '../core/types.ts';

export type {
  BsFamilyCatalogGroup,
  BsFamilyKey,
  BsPathMetricItem,
  CatalogEventField,
  CatalogEventSpec,
  CsvRunPresence,
  CsvTablePreview,
  CsvTableProfileEntry,
  F1OutputCatalog,
  LinkedOperatorSummary,
  RunSourceProfile,
};

interface InternalPathCounter {
  id: string;
  family: BsFamilyKey;
  familyLabel: string;
  pathExpr: string;
  label: string;
  matchTokens: string[];
  discrepancyNote?: string;
  hitFrames: number;
  totalItemCount: number;
  sampleValue?: string;
}

const BS_FAMILY_LABELS: Record<BsFamilyKey, string> = {
  root: '根节点 Scenario 与全局环境',
  side_wrapper: '阵营包装器 Sides[].Side',
  side_fields: '阵营内实体、目标与任务区 (Side Fields)',
  unit_wrapper: '活跃单元包装器 ActiveUnits[].<UnitType>',
  unit_fields: '活跃单元运动、毁伤、弹药与传感 (Unit Fields)',
  non_active: '非活跃单元 NonActiveUnits (落点/非制导武器)',
  scenario_events: '引擎触发器与推演事件 (Events / SimEvents)',
};

const FAMILY_ORDER: BsFamilyKey[] = [
  'root',
  'side_wrapper',
  'side_fields',
  'unit_wrapper',
  'unit_fields',
  'non_active',
  'scenario_events',
];

function createPathCounters(): InternalPathCounter[] {
  return [
    {
      id: 'root.time',
      family: 'root',
      familyLabel: BS_FAMILY_LABELS.root,
      pathExpr: 'Scenario.Time',
      label: '推演时钟 Time (.NET Ticks / ISO)',
      matchTokens: ['Time'],
      discrepancyNote: 'D2: 真机为 .NET Ticks 字符串，样本帧可为 ISO 或 frame wrapper',
      hitFrames: 0,
      totalItemCount: 0,
    },
    {
      id: 'root.global_weather',
      family: 'root',
      familyLabel: BS_FAMILY_LABELS.root,
      pathExpr: 'Scenario.GlobalWeather',
      label: '全局气象 GlobalWeather',
      matchTokens: ['GlobalWeather'],
      hitFrames: 0,
      totalItemCount: 0,
    },
    {
      id: 'side.sides',
      family: 'side_wrapper',
      familyLabel: BS_FAMILY_LABELS.side_wrapper,
      pathExpr: 'Scenario.Sides[] (.Side)',
      label: '推演阵营集合 Sides[]',
      matchTokens: ['Sides[]'],
      hitFrames: 0,
      totalItemCount: 0,
    },
    {
      id: 'side.contacts',
      family: 'side_fields',
      familyLabel: BS_FAMILY_LABELS.side_fields,
      pathExpr: 'Sides[].(Side.)Contacts[]',
      label: '目标情报 Contacts[]（支持真值 ActualUnitID）',
      matchTokens: ['Contacts[]', 'detection_new', 'detection_lost'],
      hitFrames: 0,
      totalItemCount: 0,
    },
    {
      id: 'side.missions',
      family: 'side_fields',
      familyLabel: BS_FAMILY_LABELS.side_fields,
      pathExpr: 'Sides[].(Side.)Missions[]',
      label: '任务与巡逻航线多边形 Missions[]',
      matchTokens: ['Missions[]', 'NavigationCourse'],
      discrepancyNote: '缺失时 mission_envelope_coverage 与航线偏航指标降级为不可用',
      hitFrames: 0,
      totalItemCount: 0,
    },
    {
      id: 'side.reference_points',
      family: 'side_fields',
      familyLabel: BS_FAMILY_LABELS.side_fields,
      pathExpr: 'Sides[].(Side.)ReferencePoints[]',
      label: '参考点与禁航/警戒区 ReferencePoints[]',
      matchTokens: ['ReferencePoints', 'ThreatZones'],
      hitFrames: 0,
      totalItemCount: 0,
    },
    {
      id: 'side.doctrine_postures',
      family: 'side_fields',
      familyLabel: BS_FAMILY_LABELS.side_fields,
      pathExpr: 'Sides[].(Side.)Doctrine / Postures[]',
      label: '条令 Doctrine 与外交姿态 Postures[]',
      matchTokens: ['Doctrine', 'WRA'],
      discrepancyNote: 'WRA 具体规则通常不直接随 BS 帧下发，需 Bridge scenario.audit 补充',
      hitFrames: 0,
      totalItemCount: 0,
    },
    {
      id: 'unit.active_units',
      family: 'unit_wrapper',
      familyLabel: BS_FAMILY_LABELS.unit_wrapper,
      pathExpr: 'Scenario.ActiveUnits[]',
      label: '活跃作战单元列表 ActiveUnits[]',
      matchTokens: ['ActiveUnits[]'],
      hitFrames: 0,
      totalItemCount: 0,
    },
    {
      id: 'unit.single_key_wrapper',
      family: 'unit_wrapper',
      familyLabel: BS_FAMILY_LABELS.unit_wrapper,
      pathExpr: 'ActiveUnits[].<Ship|Aircraft|...>',
      label: '单键实体类型包装器 <UnitType>',
      matchTokens: ['<Ship|Aircraft'],
      discrepancyNote: 'D2: 真机按实体类别套单键对象，演示样本通常已解包',
      hitFrames: 0,
      totalItemCount: 0,
    },
    {
      id: 'unit.kinematics',
      family: 'unit_fields',
      familyLabel: BS_FAMILY_LABELS.unit_fields,
      pathExpr: 'ActiveUnits[].Lon / Lat / CH / CS / CA',
      label: '运动学经纬航向航速高度位姿',
      matchTokens: ['LonLR/LatLR', 'ActiveUnits[]'],
      hitFrames: 0,
      totalItemCount: 0,
    },
    {
      id: 'unit.damage_state',
      family: 'unit_fields',
      familyLabel: BS_FAMILY_LABELS.unit_fields,
      pathExpr: 'ActiveUnits[].DamageState / IsDestroyed',
      label: '毁伤状态 DamageState / IsDestroyed',
      matchTokens: ['DamagePercent', 'IsDestroyed', 'unit_destroyed'],
      hitFrames: 0,
      totalItemCount: 0,
    },
    {
      id: 'unit.weapons_mounts',
      family: 'unit_fields',
      familyLabel: BS_FAMILY_LABELS.unit_fields,
      pathExpr: 'ActiveUnits[].Weapons / Mounts / Magazines',
      label: '武器挂载与余弹量 Weapons / Mounts',
      matchTokens: ['Mounts/Weapons', 'weapon_fired'],
      hitFrames: 0,
      totalItemCount: 0,
    },
    {
      id: 'unit.sensors_active',
      family: 'unit_fields',
      familyLabel: BS_FAMILY_LABELS.unit_fields,
      pathExpr: 'ActiveUnits[].Sensors[].Sensor.Active / RangeMax',
      label: '传感器开关与作用距离 Sensors[].Active',
      matchTokens: ['Sensors[].Sensor.Active', 'Sensors[].Sensor.RangeMax', 'Sensors[].Active'],
      discrepancyNote: '推演帧若未导出传感器开机状态与任务区多边形，相关合规与覆盖指标标记为数据缺失',
      hitFrames: 0,
      totalItemCount: 0,
    },
    {
      id: 'unit.fuel',
      family: 'unit_fields',
      familyLabel: BS_FAMILY_LABELS.unit_fields,
      pathExpr: 'ActiveUnits[].Fuel[].FuelRec.{FT,CQ,MQ}',
      label: '燃油剩余记录 Fuel[].FuelRec',
      matchTokens: ['Fuel'],
      hitFrames: 0,
      totalItemCount: 0,
    },
    {
      id: 'non_active.any',
      family: 'non_active',
      familyLabel: BS_FAMILY_LABELS.non_active,
      pathExpr: 'Scenario.NonActiveUnits.{WeaponImpacts,UnguidedWeapons}',
      label: '非活跃单元 NonActiveUnits',
      matchTokens: ['NonActiveUnits'],
      hitFrames: 0,
      totalItemCount: 0,
    },
    {
      id: 'events.scenario_events',
      family: 'scenario_events',
      familyLabel: BS_FAMILY_LABELS.scenario_events,
      pathExpr: 'Scenario.Events[] / SimEvents / EventTriggers',
      label: '场景事件与触发器 Events / SimEvents',
      matchTokens: ['SimEvents', 'Events[]', 'engine_event'],
      discrepancyNote: 'D2: 真机结构为 EventTriggers/SimEvents，样本帧可带 Events[]',
      hitFrames: 0,
      totalItemCount: 0,
    },
  ];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function summarizeSample(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.length > 64 ? `${v.slice(0, 61)}...` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 64 ? `${s.slice(0, 61)}...` : s;
  } catch {
    return String(v);
  }
}

function markHit(
  counter: InternalPathCounter,
  count: number,
  sample?: unknown,
): void {
  if (count <= 0) return;
  counter.hitFrames += 1;
  counter.totalItemCount += count;
  if (!counter.sampleValue && sample !== undefined) {
    counter.sampleValue = summarizeSample(sample);
  }
}

function hasAnyKey(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
      return obj[k];
    }
  }
  return undefined;
}

function linkOperatorsToCsvTable(
  tableName: string,
  operators: MetricAtomMeta[],
): LinkedOperatorSummary[] {
  const lowTarget = tableName.toLowerCase();
  return operators
    .filter((op) =>
      (op.f1FieldContract.csvTables ?? []).some((t) => t.toLowerCase() === lowTarget),
    )
    .map((op) => ({
      id: op.id,
      name: op.name,
      category: op.category,
      readiness: op.readiness,
    }));
}

function linkOperatorsToBsTokens(
  matchTokens: string[],
  operators: MetricAtomMeta[],
): LinkedOperatorSummary[] {
  return operators
    .filter((op) => {
      const paths = op.f1FieldContract.bsFramePaths ?? [];
      return paths.some((p) => matchTokens.some((tok) => p.includes(tok)));
    })
    .map((op) => ({
      id: op.id,
      name: op.name,
      category: op.category,
      readiness: op.readiness,
    }));
}

function computeExpectedCsvHeaders(
  spec: CatalogEventSpec,
  actualHeaders: string[],
): string[] {
  const out: string[] = [];
  const hasMcCols = actualHeaders.includes('Scenario') || actualHeaders.includes('MC_Run');
  if (spec.has_make_paras_prefix) {
    if (hasMcCols) {
      out.push('Scenario', 'MC_Run');
    }
    out.push('TimelineID');
    if (spec.has_time_col !== false) {
      out.push('Time');
    }
  }
  for (const f of spec.fields ?? []) {
    if (!out.includes(f.name)) out.push(f.name);
  }
  return out;
}

export function isSafePreviewQuery(raw: string): boolean {
  if (!raw || raw.length > 120) return false;
  if (raw.includes('/') || raw.includes('\\') || raw.includes('..') || raw.includes('\0')) {
    return false;
  }
  return true;
}

function isContainedInside(parentDir: string, candidateFile: string): boolean {
  try {
    const parentReal = fs.realpathSync(parentDir);
    const candidateReal = fs.realpathSync(candidateFile);
    const rel = path.relative(parentReal, candidateReal);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

function profileCsvDirectory(
  csvDirInput: string | null,
  timelineId: string | null,
  catalogEvents: CatalogEventSpec[],
  operators: MetricAtomMeta[],
  previewTable?: string,
  previewLimit = 50,
): {
  profile: RunSourceProfile['csvProfile'];
  dirExists: boolean;
} {
  const resolvedInput = csvDirInput && csvDirInput.trim() ? path.resolve(csvDirInput) : null;
  if (!resolvedInput || !fs.existsSync(resolvedInput) || !fs.statSync(resolvedInput).isDirectory()) {
    const emptyTables: CsvTableProfileEntry[] = catalogEvents.map((ev) => ({
      catalogId: ev.id,
      name: ev.name,
      catalogStatus: ev.status,
      runPresence:
        ev.status === 'placeholder'
          ? 'placeholder'
          : ev.status === 'unused_enum'
            ? 'unused_enum'
            : 'missing_in_run',
      dbTable: Boolean(ev.db_table),
      tacview: Boolean(ev.tacview),
      inScan31: Boolean(ev.in_scan_31),
      inRepoSamples: Boolean(ev.in_repo_samples),
      gating: ev.gating,
      sideSplitKey: ev.side_split_key,
      note: ev.note,
      fileNames: [],
      bytes: 0,
      bomCount: 0,
      rowCount: 0,
      rawFileRowCount: 0,
      actualHeaders: [],
      expectedHeaders: computeExpectedCsvHeaders(ev, []),
      missingColumns: [],
      extraColumns: [],
      catalogFields: ev.fields ?? [],
      drivenOperators: linkOperatorsToCsvTable(ev.name, operators),
    }));

    return {
      dirExists: false,
      profile: {
        csvDir: resolvedInput,
        dirExists: false,
        bomFilesCount: 0,
        maxBomCount: 0,
        discoveredFileCount: 0,
        totalDataRows: 0,
        totalBytes: 0,
        statusSummary: {
          activeWithRows: 0,
          emptyHeaderOnly: 0,
          missingInRun: emptyTables.filter((t) => t.runPresence === 'missing_in_run').length,
          unusedEnum: emptyTables.filter((t) => t.runPresence === 'unused_enum').length,
          placeholder: emptyTables.filter((t) => t.runPresence === 'placeholder').length,
        },
        tables: emptyTables,
        preview: null,
      },
    };
  }

  const csvDir = locateCsvDirectory(resolvedInput);
  const csvFileNames = fs
    .readdirSync(csvDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.csv'))
    .map((d) => d.name)
    .sort();

  interface DiscoveredGroup {
    canonicalName: string;
    fileNames: string[];
    bytes: number;
    bomCount: number;
    rowCount: number;
    rawFileRowCount: number;
    headers: string[];
  }

  const discovered = new Map<string, DiscoveredGroup>();
  let bomFilesCount = 0;
  let maxBomCount = 0;
  let totalBytes = 0;
  let totalDataRows = 0;

  const countCsvFileRowsFast = (
    filePath: string,
  ): { bomCount: number; headers: string[]; rowCount: number } => {
    const head = readCsvTable(filePath, { headerOnly: true });
    const fd = fs.openSync(filePath, 'r');
    let newlineCount = 0;
    let lastByte = 0;
    try {
      const buf = Buffer.allocUnsafe(1024 * 1024);
      while (true) {
        const bytesRead = fs.readSync(fd, buf, 0, buf.length, null);
        if (bytesRead === 0) break;
        lastByte = buf[bytesRead - 1];
        let idx = -1;
        while ((idx = buf.indexOf(10, idx + 1)) !== -1 && idx < bytesRead) {
          newlineCount += 1;
        }
      }
    } finally {
      fs.closeSync(fd);
    }
    const totalLines = newlineCount + (lastByte !== 10 && lastByte !== 0 ? 1 : 0);
    return {
      bomCount: head.bomCount,
      headers: head.headers,
      rowCount: Math.max(0, totalLines - 1),
    };
  };

  for (const fileName of csvFileNames) {
    const fullPath = path.join(csvDir, fileName);
    if (!isContainedInside(csvDir, fullPath)) continue;
    const stat = fs.statSync(fullPath);
    const canonicalName = resolveCanonicalCsvEventName(fileName);
    const isLarge = stat.size > 10 * 1024 * 1024;
    let bomCount = 0;
    let headers: string[] = [];
    let allRowCount = 0;
    let runRowCount = 0;

    if (isLarge) {
      const fast = countCsvFileRowsFast(fullPath);
      bomCount = fast.bomCount;
      headers = fast.headers;
      allRowCount = fast.rowCount;
      runRowCount = fast.rowCount;
    } else {
      const allParsed = readCsvTable(fullPath);
      const runParsed = timelineId ? readCsvTable(fullPath, timelineId) : allParsed;
      bomCount = allParsed.bomCount;
      headers = allParsed.headers;
      allRowCount = allParsed.rows.length;
      runRowCount = runParsed.rows.length;
    }

    if (bomCount > 0) bomFilesCount += 1;
    maxBomCount = Math.max(maxBomCount, bomCount);
    totalBytes += stat.size;
    totalDataRows += runRowCount;

    const existing = discovered.get(canonicalName) ?? {
      canonicalName,
      fileNames: [],
      bytes: 0,
      bomCount: 0,
      rowCount: 0,
      rawFileRowCount: 0,
      headers: [],
    };
    existing.fileNames.push(fileName);
    existing.bytes += stat.size;
    existing.bomCount = Math.max(existing.bomCount, bomCount);
    existing.rowCount += runRowCount;
    existing.rawFileRowCount += allRowCount;
    if (existing.headers.length === 0 && headers.length > 0) {
      existing.headers = headers;
    }
    discovered.set(canonicalName, existing);
  }

  const catalogNames = new Set(catalogEvents.map((e) => e.name));
  const tables: CsvTableProfileEntry[] = catalogEvents.map((ev) => {
    const found = discovered.get(ev.name);
    const expectedHeaders = computeExpectedCsvHeaders(ev, found?.headers ?? []);
    const actualHeaders = found?.headers ?? [];

    let runPresence: CsvRunPresence;
    if (found) {
      runPresence = found.rowCount > 0 ? 'active_with_rows' : 'empty_header_only';
    } else if (ev.status === 'placeholder') {
      runPresence = 'placeholder';
    } else if (ev.status === 'unused_enum') {
      runPresence = 'unused_enum';
    } else {
      runPresence = 'missing_in_run';
    }

    const expectedSet = new Set(expectedHeaders);
    const actualSet = new Set(actualHeaders);

    return {
      catalogId: ev.id,
      name: ev.name,
      catalogStatus: ev.status,
      runPresence,
      dbTable: Boolean(ev.db_table),
      tacview: Boolean(ev.tacview),
      inScan31: Boolean(ev.in_scan_31),
      inRepoSamples: Boolean(ev.in_repo_samples),
      gating: ev.gating,
      sideSplitKey: ev.side_split_key,
      note: ev.note,
      fileNames: found?.fileNames ?? [],
      bytes: found?.bytes ?? 0,
      bomCount: found?.bomCount ?? 0,
      rowCount: found?.rowCount ?? 0,
      rawFileRowCount: found?.rawFileRowCount ?? 0,
      actualHeaders,
      expectedHeaders,
      missingColumns: found ? expectedHeaders.filter((c) => !actualSet.has(c)) : [],
      extraColumns: found ? actualHeaders.filter((c) => !expectedSet.has(c)) : [],
      catalogFields: ev.fields ?? [],
      drivenOperators: linkOperatorsToCsvTable(ev.name, operators),
    };
  });

  // 收录规范目录之外但真实磁盘出现的 CSV 表（如有）
  for (const [canon, found] of discovered.entries()) {
    if (catalogNames.has(canon)) continue;
    tables.push({
      catalogId: null,
      name: canon,
      catalogStatus: 'extra_unlisted',
      runPresence: found.rowCount > 0 ? 'active_with_rows' : 'empty_header_only',
      dbTable: false,
      tacview: false,
      inScan31: false,
      inRepoSamples: false,
      fileNames: found.fileNames,
      bytes: found.bytes,
      bomCount: found.bomCount,
      rowCount: found.rowCount,
      rawFileRowCount: found.rawFileRowCount,
      actualHeaders: found.headers,
      expectedHeaders: [],
      missingColumns: [],
      extraColumns: found.headers,
      catalogFields: [],
      drivenOperators: linkOperatorsToCsvTable(canon, operators),
    });
  }

  let preview: CsvTablePreview | null = null;
  if (previewTable && isSafePreviewQuery(previewTable)) {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(previewLimit) || 50));
    const matchedGroup =
      discovered.get(previewTable) ??
      [...discovered.values()].find(
        (g) => g.canonicalName.toLowerCase() === previewTable.toLowerCase() || g.fileNames.includes(previewTable),
      );
    if (matchedGroup) {
      const mergedRows: CsvTablePreview['rows'] = [];
      let headers = matchedGroup.headers;
      for (const safeFileName of matchedGroup.fileNames) {
        if (!csvFileNames.includes(safeFileName)) continue;
        const parsed = readCsvTable(path.join(csvDir, safeFileName), {
          targetTimelineId: timelineId ?? undefined,
          maxRows: safeLimit,
        });
        if (headers.length === 0) headers = parsed.headers;
        for (const r of parsed.rows) {
          mergedRows.push(r);
        }
      }
      preview = {
        tableName: matchedGroup.canonicalName,
        fileNames: matchedGroup.fileNames,
        headers,
        totalRows: matchedGroup.rowCount,
        limit: safeLimit,
        rows: mergedRows.slice(0, safeLimit),
      };
    }
  }

  return {
    dirExists: true,
    profile: {
      csvDir,
      dirExists: true,
      bomFilesCount,
      maxBomCount,
      discoveredFileCount: csvFileNames.length,
      totalDataRows,
      totalBytes,
      statusSummary: {
        activeWithRows: tables.filter((t) => t.runPresence === 'active_with_rows').length,
        emptyHeaderOnly: tables.filter((t) => t.runPresence === 'empty_header_only').length,
        missingInRun: tables.filter((t) => t.runPresence === 'missing_in_run').length,
        unusedEnum: tables.filter((t) => t.runPresence === 'unused_enum').length,
        placeholder: tables.filter((t) => t.runPresence === 'placeholder').length,
      },
      tables,
      preview,
    },
  };
}

function buildBsFamilyCatalog(
  catalog: F1OutputCatalog,
  pathMetrics: BsPathMetricItem[],
): BsFamilyCatalogGroup[] {
  const rawMap = catalog.bs_mqtt?.scenario_paths ?? {};
  return FAMILY_ORDER.map((key) => {
    const rawVal = rawMap[key];
    const rawPaths = Array.isArray(rawVal)
      ? rawVal.map(String)
      : typeof rawVal === 'string' && rawVal.length > 0
        ? [rawVal]
        : [];
    const matchingMetrics = pathMetrics.filter((m) => m.family === key);
    return {
      key,
      label: BS_FAMILY_LABELS[key],
      rawPaths,
      populatedPathsCount: matchingMetrics.filter((m) => m.hitFrames > 0).length,
      totalTrackedCount: matchingMetrics.length,
    };
  });
}

function profileBsJsonlFile(
  jsonlPathInput: string | null,
  catalog: F1OutputCatalog,
  operators: MetricAtomMeta[],
): RunSourceProfile['bsProfile'] {
  const counters = createPathCounters();
  const counterMap = new Map(counters.map((c) => [c.id, c]));
  const topics = catalog.bs_mqtt?.topics ?? [];

  if (!jsonlPathInput || !fs.existsSync(jsonlPathInput) || !fs.statSync(jsonlPathInput).isFile()) {
    const pathMetrics: BsPathMetricItem[] = counters.map((c) => ({
      id: c.id,
      family: c.family,
      familyLabel: c.familyLabel,
      pathExpr: c.pathExpr,
      label: c.label,
      hitFrames: 0,
      totalFrames: 0,
      hitRate: 0,
      totalItemCount: 0,
      discrepancyNote: c.discrepancyNote,
      drivenOperators: linkOperatorsToBsTokens(c.matchTokens, operators),
    }));
    return {
      jsonlFile: jsonlPathInput,
      fileExists: false,
      bytes: 0,
      totalLines: 0,
      parsedFrames: 0,
      parseErrors: 0,
      stringifiedScalarFrames: 0,
      singleKeyWrapperFrames: 0,
      unitWrapperTypes: {},
      topics,
      pathMetrics,
      familyCatalog: buildBsFamilyCatalog(catalog, pathMetrics),
    };
  }

  const stat = fs.statSync(jsonlPathInput);
  const rawText = fs.readFileSync(jsonlPathInput, 'utf8').replace(/^\uFEFF+/g, '');
  const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  let parsedFrames = 0;
  let parseErrors = 0;
  let stringifiedScalarFrames = 0;
  let singleKeyWrapperFrames = 0;
  const unitWrapperTypes: Record<string, number> = {};

  for (const line of lines) {
    let record: unknown;
    try {
      record = JSON.parse(line.replace(/^\uFEFF+/g, '').trim());
    } catch {
      parseErrors += 1;
      continue;
    }

    parsedFrames += 1;
    const unwrapped = unwrapRecord(record) as {
      frame: Record<string, unknown> | null;
      scenarioTime: string | null;
    };
    const scen = scenarioOf(unwrapped.frame) as Record<string, unknown> | null;
    if (!scen) continue;

    let frameHasStringScalar = false;
    let frameHasWrapper = false;

    const timeVal = unwrapped.scenarioTime ?? scen.Time;
    if (timeVal !== undefined && timeVal !== null && timeVal !== '') {
      markHit(counterMap.get('root.time')!, 1, timeVal);
    }

    if (scen.GlobalWeather !== undefined && scen.GlobalWeather !== null) {
      markHit(counterMap.get('root.global_weather')!, 1, scen.GlobalWeather);
    }

    const sides = Array.isArray(scen.Sides) ? scen.Sides : [];
    if (sides.length > 0) {
      markHit(counterMap.get('side.sides')!, sides.length);
    }

    let contactsCount = 0;
    let contactSample: unknown;
    let missionsCount = 0;
    let refPtsCount = 0;
    let doctrinePosturesCount = 0;

    for (const rawSide of sides) {
      if (isPlainObject(rawSide) && 'Side' in rawSide && isPlainObject(rawSide.Side)) {
        frameHasWrapper = true;
      }
      const side = unwrapEntity<Record<string, unknown>>(rawSide);
      if (!side) continue;

      if (Array.isArray(side.Contacts)) {
        contactsCount += side.Contacts.length;
        if (!contactSample && side.Contacts[0]) {
          contactSample = unwrapEntity(side.Contacts[0]);
        }
        for (const c of side.Contacts) {
          const uc = unwrapEntity<Record<string, unknown>>(c);
          if (uc && typeof uc.SIK === 'string') frameHasStringScalar = true;
        }
      }
      if (Array.isArray(side.Missions)) missionsCount += side.Missions.length;
      if (Array.isArray(side.ReferencePoints)) refPtsCount += side.ReferencePoints.length;
      if (Array.isArray(side.NoNavZones)) refPtsCount += side.NoNavZones.length;
      if (Array.isArray(side.ExclusionZones)) refPtsCount += side.ExclusionZones.length;
      if (Array.isArray(side.StandardZones)) refPtsCount += side.StandardZones.length;
      if (side.Doctrine) doctrinePosturesCount += 1;
      if (Array.isArray(side.Postures)) doctrinePosturesCount += side.Postures.length;
    }

    markHit(counterMap.get('side.contacts')!, contactsCount, contactSample);
    markHit(counterMap.get('side.missions')!, missionsCount);
    markHit(counterMap.get('side.reference_points')!, refPtsCount);
    markHit(counterMap.get('side.doctrine_postures')!, doctrinePosturesCount);

    const activeUnits = Array.isArray(scen.ActiveUnits) ? scen.ActiveUnits : [];
    markHit(counterMap.get('unit.active_units')!, activeUnits.length);

    let wrapperCountInFrame = 0;
    let kinCount = 0;
    let dmgCount = 0;
    let weaponMountCount = 0;
    let sensorActiveCount = 0;
    let fuelCount = 0;

    for (const rawU of activeUnits) {
      if (!isPlainObject(rawU)) continue;
      const keys = Object.keys(rawU);
      if (keys.length === 1 && isPlainObject(rawU[keys[0]])) {
        wrapperCountInFrame += 1;
        frameHasWrapper = true;
        unitWrapperTypes[keys[0]] = (unitWrapperTypes[keys[0]] ?? 0) + 1;
      } else {
        unitWrapperTypes['(unwrapped)'] = (unitWrapperTypes['(unwrapped)'] ?? 0) + 1;
      }

      const u = unwrapEntity<Record<string, unknown>>(rawU);
      if (!u) continue;

      if (typeof u.CH === 'string' || typeof u.CS === 'string' || typeof u.CA === 'string') {
        frameHasStringScalar = true;
      }

      const lon = hasAnyKey(u, ['LonLR', 'Longitude', 'Lon']);
      const lat = hasAnyKey(u, ['LatLR', 'Latitude', 'Lat']);
      if (lon !== undefined && lat !== undefined) {
        kinCount += 1;
      }
      if (u.DamageState !== undefined || u.IsDestroyed !== undefined || u.DamagePercent !== undefined) {
        dmgCount += 1;
      }
      for (const ck of ['Weapons', 'Mounts', 'Launchers', 'Magazines']) {
        if (Array.isArray(u[ck]) && (u[ck] as unknown[]).length > 0) {
          weaponMountCount += (u[ck] as unknown[]).length;
        }
      }
      if (Array.isArray(u.Sensors)) {
        for (const rawS of u.Sensors) {
          const sObj = unwrapEntity<Record<string, unknown>>(rawS);
          if (sObj && ('Active' in sObj || 'RangeMax' in sObj || 'CanBeActive' in sObj)) {
            sensorActiveCount += 1;
          }
        }
      }
      if (Array.isArray(u.Fuel) && u.Fuel.length > 0) {
        fuelCount += u.Fuel.length;
      }
    }

    markHit(counterMap.get('unit.single_key_wrapper')!, wrapperCountInFrame);
    markHit(counterMap.get('unit.kinematics')!, kinCount);
    markHit(counterMap.get('unit.damage_state')!, dmgCount);
    markHit(counterMap.get('unit.weapons_mounts')!, weaponMountCount);
    markHit(counterMap.get('unit.sensors_active')!, sensorActiveCount);
    markHit(counterMap.get('unit.fuel')!, fuelCount);

    let nonActiveCount = 0;
    if (Array.isArray(scen.NonActiveUnits)) {
      nonActiveCount = scen.NonActiveUnits.length;
    } else if (isPlainObject(scen.NonActiveUnits)) {
      const imp = Array.isArray(scen.NonActiveUnits.WeaponImpacts)
        ? scen.NonActiveUnits.WeaponImpacts.length
        : 0;
      const ung = Array.isArray(scen.NonActiveUnits.UnguidedWeapons)
        ? scen.NonActiveUnits.UnguidedWeapons.length
        : 0;
      nonActiveCount = imp + ung;
    }
    markHit(counterMap.get('non_active.any')!, nonActiveCount);

    let evtCount = 0;
    if (Array.isArray(scen.Events)) evtCount += scen.Events.length;
    if (Array.isArray(scen.EventTriggers)) evtCount += scen.EventTriggers.length;
    if (Array.isArray(scen.SimEvents)) evtCount += scen.SimEvents.length;
    if (isPlainObject(scen.SimEvent)) evtCount += 1;
    markHit(counterMap.get('events.scenario_events')!, evtCount);

    if (frameHasStringScalar) stringifiedScalarFrames += 1;
    if (frameHasWrapper) singleKeyWrapperFrames += 1;
  }

  const denom = Math.max(parsedFrames, 1);
  const pathMetrics: BsPathMetricItem[] = counters.map((c) => ({
    id: c.id,
    family: c.family,
    familyLabel: c.familyLabel,
    pathExpr: c.pathExpr,
    label: c.label,
    hitFrames: c.hitFrames,
    totalFrames: parsedFrames,
    hitRate: parsedFrames > 0 ? Number((c.hitFrames / denom).toFixed(4)) : 0,
    totalItemCount: c.totalItemCount,
    sampleValue: c.sampleValue,
    discrepancyNote: c.discrepancyNote,
    drivenOperators: linkOperatorsToBsTokens(c.matchTokens, operators),
  }));

  return {
    jsonlFile: jsonlPathInput,
    fileExists: true,
    bytes: stat.size,
    totalLines: lines.length,
    parsedFrames,
    parseErrors,
    stringifiedScalarFrames,
    singleKeyWrapperFrames,
    unitWrapperTypes,
    topics,
    pathMetrics,
    familyCatalog: buildBsFamilyCatalog(catalog, pathMetrics),
  };
}

export function buildRunSourceProfile(input: {
  situation: SituationModel;
  catalog: F1OutputCatalog;
  operators: MetricAtomMeta[];
  previewTable?: string;
  previewLimit?: number;
}): RunSourceProfile {
  const { situation, catalog, operators, previewTable, previewLimit } = input;
  const catalogEvents = catalog.event_exporter?.events ?? [];
  const sourceKind = situation.coverage.sourceKind;
  const scenarioPath = situation.scenarioPath ?? '';
  const pathExists = Boolean(scenarioPath && fs.existsSync(scenarioPath));

  const isCsvRun = sourceKind === 'event_csv' || sourceKind === 'hybrid';
  const isBsRun = sourceKind === 'bs_jsonl' || sourceKind === 'hybrid';

  let csvDirCandidate: string | null = null;
  let jsonlFileCandidate: string | null = null;

  if (pathExists) {
    const st = fs.statSync(scenarioPath);
    if (isCsvRun && st.isDirectory()) {
      csvDirCandidate = scenarioPath;
    } else if (isBsRun && st.isFile()) {
      jsonlFileCandidate = scenarioPath;
    } else if (isBsRun && st.isDirectory()) {
      // 允许 hybrid 目录内附带首个 .jsonl 文件剖析
      const firstJsonl = fs
        .readdirSync(scenarioPath)
        .find((f) => f.toLowerCase().endsWith('.jsonl') || f.toLowerCase().endsWith('.ndjson'));
      if (firstJsonl) jsonlFileCandidate = path.join(scenarioPath, firstJsonl);
      csvDirCandidate = scenarioPath;
    }
  }

  const csvResult = profileCsvDirectory(
    csvDirCandidate,
    situation.timelineId ?? null,
    catalogEvents,
    operators,
    previewTable,
    previewLimit,
  );
  if (!csvDirCandidate) {
    csvResult.profile.csvDir = isCsvRun ? scenarioPath || null : null;
  }

  const bsResult = profileBsJsonlFile(jsonlFileCandidate, catalog, operators);
  if (!jsonlFileCandidate && isBsRun) {
    bsResult.jsonlFile = scenarioPath || null;
  }

  const sourceAvailable = csvResult.dirExists || bsResult.fileExists;
  let sourceMissingReason: string | undefined;
  if (!sourceAvailable) {
    if (scenarioPath === '<uploaded.jsonl>' || scenarioPath === '<realtime_stream>') {
      sourceMissingReason =
        '当前 Run 为前端上传的纯文本 JSONL（<uploaded.jsonl>），系统按「不复制进 eval.db」原则未在服务端持久化原文件；若需逐帧统计与表结构校验，请使用磁盘 JSONL/CSV 目录路径导入或切换内置样本。';
    } else {
      sourceMissingReason = `磁盘源路径不可用或已移动 (${scenarioPath || '未配置'})，当前仅展示规范目录结构对照。`;
    }
  }

  return {
    runMeta: {
      runId: situation.runId,
      scenarioName: situation.scenarioName ?? situation.runId,
      sourceKind,
      scenarioPath,
      timelineId: situation.timelineId ?? null,
      sourceAvailable,
      sourceMissingReason,
      catalogVersion: catalog.catalog_version ?? '1.0.0',
      totalCatalogEvents: catalogEvents.length,
      totalCatalogBsTopics: (catalog.bs_mqtt?.topics ?? []).length,
    },
    csvProfile: csvResult.profile,
    bsProfile: bsResult,
  };
}
