/**
 * F1 EventExporter CSV 适配器
 * 实证契约对齐 sim-output-fields/01-event-exporter-csv-db.md：
 * 1) 剥除双 UTF-8 BOM（\xEF\xBB\xBF\xEF\xBB\xBF）及列名前导 \uFEFF
 * 2) 从 YYYY-M-D_H.m.s_[Side_]EventType.csv 提取规范事件类型，兼容 UnitDamaged.csv 与 Damage.csv 别名
 * 3) 按单局 TimelineID（可选过滤目标 run）隔离解析，绝不跨局静默混合
 * 4) 统一 .toLowerCase() 归一化 GUID 主键，剥离 WeaponName " #\d+" 序号后缀
 * 5) 保留精确证据行号 Ref（CSV:<FileName>#L<LineNo>）
 */

import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { formatSecondsToClock, parseF1Time } from '../core/time-utils.ts';
import type {
  EvalPolygon,
  GeoPoint,
  SituationModel,
  SituationUnit,
  StructuredSimEvent,
} from '../core/types.ts';
import { createEmptySituationModel } from './frame-adapter.ts';

function stripAllBom(text: string): { clean: string; bomCount: number } {
  let pos = 0;
  while (pos < text.length && text.charCodeAt(pos) === 0xfeff) {
    pos += 1;
  }
  return { clean: text.slice(pos), bomCount: pos };
}

/** 支持双引号转义与内嵌逗号的标准 RFC4180 CSV 行解析器 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export interface CsvRowRecord {
  file: string;
  line: number;
  data: Record<string, string>;
}

export function resolveCanonicalCsvEventName(filename: string): string {
  const stem = path.basename(filename, path.extname(filename));
  const raw = stem.includes('_') ? stem.slice(stem.lastIndexOf('_') + 1) : stem;
  const low = raw.toLowerCase();
  if (low === 'damage' || low === 'unitdamaged') return 'UnitDamaged';
  return raw;
}

function normalizeGuid(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

function toNum(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (!t || t === '-') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export function locateCsvDirectory(inputDir: string): string {
  const sub = path.join(inputDir, 'EventExport_CSV');
  if (fs.existsSync(sub) && fs.statSync(sub).isDirectory()) {
    return sub;
  }
  return inputDir;
}

/** 按 RFC4180 完整切分多行引号记录，并返回每条记录起始的 1-based 行号 */
function splitCsvRecords(text: string): Array<{ lineNumber: number; recordText: string }> {
  const out: Array<{ lineNumber: number; recordText: string }> = [];
  let inQuotes = false;
  let recStart = 0;
  let recStartLine = 1;
  let currentLine = 1;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      const recordText = text.slice(recStart, i);
      if (recordText.trim()) {
        out.push({ lineNumber: recStartLine, recordText });
      }
      if (ch === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      currentLine += 1;
      recStart = i + 1;
      recStartLine = currentLine;
    } else if (inQuotes && (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n'))) {
      currentLine += 1;
    }
  }
  const tail = text.slice(recStart);
  if (tail.trim()) {
    out.push({ lineNumber: recStartLine, recordText: tail });
  }
  return out;
}

export interface ReadCsvTableOptions {
  targetTimelineId?: string;
  maxRows?: number;
  sampleStep?: number;
  headerOnly?: boolean;
  countOnly?: boolean;
}

export function readCsvTable(
  filePath: string,
  targetTimelineIdOrOptions?: string | ReadCsvTableOptions,
): {
  bomCount: number;
  headers: string[];
  rows: CsvRowRecord[];
  totalRowsScanned?: number;
} {
  const opts: ReadCsvTableOptions =
    typeof targetTimelineIdOrOptions === 'string'
      ? { targetTimelineId: targetTimelineIdOrOptions }
      : targetTimelineIdOrOptions ?? {};

  const stat = fs.statSync(filePath);
  const relName = path.basename(filePath);

  // If small file (< 5MB) and no early-stop or downsampling requested, fast-path
  if (
    stat.size < 5 * 1024 * 1024 &&
    !opts.maxRows &&
    !opts.sampleStep &&
    !opts.headerOnly &&
    !opts.countOnly
  ) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const { clean, bomCount } = stripAllBom(raw);
    const records = splitCsvRecords(clean);
    if (records.length === 0) return { bomCount, headers: [], rows: [] };

    const headerLine = records[0].recordText.replace(/^\uFEFF+/g, '');
    if (!headerLine.trim()) return { bomCount, headers: [], rows: [] };
    const headers = parseCsvLine(headerLine).map((h) => h.replace(/^\uFEFF+/g, '').trim());
    const rows: CsvRowRecord[] = [];

    for (let i = 1; i < records.length; i += 1) {
      const { lineNumber, recordText } = records[i];
      if (!recordText.trim()) continue;
      const cols = parseCsvLine(recordText);
      const data: Record<string, string> = {};
      for (let c = 0; c < headers.length; c += 1) {
        data[headers[c]] = (cols[c] ?? '').trim();
      }
      if (
        opts.targetTimelineId &&
        data.TimelineID &&
        normalizeGuid(data.TimelineID) !== normalizeGuid(opts.targetTimelineId)
      ) {
        continue;
      }
      rows.push({
        file: relName,
        line: lineNumber,
        data,
      });
    }

    return { bomCount, headers, rows, totalRowsScanned: rows.length };
  }

  // Chunked stream reader for large files (> 5MB) or bounded/header-only queries
  const fd = fs.openSync(filePath, 'r');
  const decoder = new StringDecoder('utf8');
  try {
    const bufSize = 64 * 1024;
    const buf = Buffer.alloc(bufSize);
    let remainder = '';
    let bytesRead = 0;
    let lineNum = 0;
    let bomCount = 0;
    let headers: string[] = [];
    const rows: CsvRowRecord[] = [];
    let isFirstChunk = true;
    let totalMatchingRows = 0;

    while ((bytesRead = fs.readSync(fd, buf, 0, bufSize, null)) > 0) {
      let chunkStr: string;
      if (isFirstChunk) {
        isFirstChunk = false;
        let offset = 0;
        while (
          offset + 3 <= bytesRead &&
          buf[offset] === 0xef &&
          buf[offset + 1] === 0xbb &&
          buf[offset + 2] === 0xbf
        ) {
          bomCount += 1;
          offset += 3;
        }
        chunkStr = remainder + decoder.write(buf.subarray(offset, bytesRead));
      } else {
        chunkStr = remainder + decoder.write(buf.subarray(0, bytesRead));
      }

      const lines = chunkStr.split(/\r?\n/);
      remainder = lines.pop() ?? '';

      for (const line of lines) {
        lineNum += 1;
        if (lineNum === 1) {
          const headerLine = line.replace(/^\uFEFF+/g, '');
          headers = parseCsvLine(headerLine).map((h) => h.replace(/^\uFEFF+/g, '').trim());
          if (opts.headerOnly) {
            return { bomCount, headers, rows: [], totalRowsScanned: 0 };
          }
          continue;
        }
        if (!line.trim()) continue;

        if (opts.sampleStep && lineNum % opts.sampleStep !== 0) {
          continue;
        }

        const cols = parseCsvLine(line);
        const data: Record<string, string> = {};
        for (let c = 0; c < headers.length; c += 1) {
          data[headers[c]] = (cols[c] ?? '').trim();
        }

        if (
          opts.targetTimelineId &&
          data.TimelineID &&
          normalizeGuid(data.TimelineID) !== normalizeGuid(opts.targetTimelineId)
        ) {
          continue;
        }

        totalMatchingRows += 1;
        if (!opts.countOnly) {
          rows.push({
            file: relName,
            line: lineNum,
            data,
          });
        }

        if (opts.maxRows && rows.length >= opts.maxRows) {
          return { bomCount, headers, rows, totalRowsScanned: totalMatchingRows };
        }
      }
    }

    const finalChunk = remainder + decoder.end();
    if (finalChunk.trim()) {
      lineNum += 1;
      if (lineNum > 1 && (!opts.sampleStep || lineNum % opts.sampleStep === 0)) {
        const cols = parseCsvLine(finalChunk);
        const data: Record<string, string> = {};
        for (let c = 0; c < headers.length; c += 1) {
          data[headers[c]] = (cols[c] ?? '').trim();
        }
        if (
          !opts.targetTimelineId ||
          !data.TimelineID ||
          normalizeGuid(data.TimelineID) === normalizeGuid(opts.targetTimelineId)
        ) {
          totalMatchingRows += 1;
          if (!opts.countOnly && (!opts.maxRows || rows.length < opts.maxRows)) {
            rows.push({
              file: relName,
              line: lineNum,
              data,
            });
          }
        }
      }
    }

    return { bomCount, headers, rows, totalRowsScanned: totalMatchingRows };
  } finally {
    fs.closeSync(fd);
  }
}

export function parseCsvDirectoryToSituation(
  inputDir: string,
  options?: { runId?: string; targetTimelineId?: string; scenarioPath?: string },
): {
  model: SituationModel;
  csvDir: string;
  tableCounts: Record<string, number>;
  detectedTimelineIds: string[];
} {
  const csvDir = locateCsvDirectory(inputDir);
  if (!fs.existsSync(csvDir)) {
    throw new Error(`CSV 目录不存在: ${csvDir}`);
  }

  const allFiles = fs
    .readdirSync(csvDir)
    .filter((f) => f.toLowerCase().endsWith('.csv'))
    .sort();
  if (allFiles.length === 0) {
    throw new Error(`目录下未找到任何 CSV 文件: ${csvDir}`);
  }

  // 仅对 SituationModel 所需的核心表格加载完整行，对非核心大表（如 ContactPositions 1GB+）仅统计行数与 BOM，防止内存溢出
  const SITUATION_ESSENTIAL_TABLES = new Set<string>([
    'SimInfo',
    'UnitCreated',
    'UnitPositions',
    'WeaponFired',
    'WeaponEndgame',
    'UnitDamaged',
    'UnitDestroyed',
    'Expenditures',
    'Losses',
    'ContactCreated',
    'DetectionIdentificationChanged',
    'SensorCreated',
    'WeaponLost',
    'WeaponImpact',
    'FuelConsumed',
    'AirOps',
    'SensorClassUsed',
    'CommClassUsed',
    'MissionRefPointRelationChanged',
    'EngagementCycle',
    'FirstSensorToUnitRecordCreated',
    'ComponentStatusChanged',
    'UnitJammed',
    'CommCreated',
    'CommIsJammedChanged',
    'DockingOps',
    'FuelTransfer',
    'MissionChanged',
  ]);

  const tables = new Map<string, CsvRowRecord[]>();
  const tableCounts: Record<string, number> = {};
  const timelineSet = new Set<string>();
  let maxBom = 0;

  for (const fileName of allFiles) {
    const full = path.join(csvDir, fileName);
    const stat = fs.statSync(full);
    const canonical = resolveCanonicalCsvEventName(fileName);
    const isEssential = SITUATION_ESSENTIAL_TABLES.has(canonical);

    // 对于非核心表格（如 ContactPositions 1GB+ 或 Tick 等），仅执行高速流式行数与 BOM 统计，不载入行对象
    if (!isEssential) {
      const isLarge = stat.size > 5 * 1024 * 1024;
      const parsed = isLarge
        ? readCsvTable(full, { countOnly: true, targetTimelineId: options?.targetTimelineId })
        : readCsvTable(full, options?.targetTimelineId);
      maxBom = Math.max(maxBom, parsed.bomCount);
      tableCounts[canonical] =
        (tableCounts[canonical] ?? 0) + (parsed.totalRowsScanned ?? parsed.rows.length);
      continue;
    }

    // 对于超大核心底表（例如 UnitPositions > 50MB，通常包含数百万行采样），启用步长降采样以保护 V8 堆内存
    const isLargeEssential = stat.size > 50 * 1024 * 1024;
    const parsed = isLargeEssential
      ? readCsvTable(full, {
          targetTimelineId: options?.targetTimelineId,
          sampleStep: 25,
        })
      : readCsvTable(full, options?.targetTimelineId);

    maxBom = Math.max(maxBom, parsed.bomCount);
    const existing = tables.get(canonical) ?? [];
    for (let rIdx = 0; rIdx < parsed.rows.length; rIdx += 1) {
      existing.push(parsed.rows[rIdx]);
    }
    tables.set(canonical, existing);
    tableCounts[canonical] =
      (tableCounts[canonical] ?? 0) + (parsed.totalRowsScanned ?? parsed.rows.length);
    for (const r of parsed.rows) {
      if (r.data.TimelineID) timelineSet.add(r.data.TimelineID);
    }
  }

  const detectedTimelineIds = [...timelineSet];
  if (!options?.targetTimelineId && detectedTimelineIds.length > 1) {
    throw new Error(
      `CSV 目录存在多个 TimelineID (${detectedTimelineIds.join(', ')})，禁止静默跨局汇总，请显式指定 targetTimelineId`,
    );
  }

  const simInfoRow = tables.get('SimInfo')?.[0];
  const timelineId = detectedTimelineIds[0] ?? options?.targetTimelineId;
  const runId = options?.runId ?? timelineId ?? `csv-${path.basename(inputDir)}`;
  const model = createEmptySituationModel(
    runId,
    options?.scenarioPath ?? csvDir,
    'event_csv',
  );
  model.timelineId = timelineId;
  model.coverage.bomCountDetected = maxBom;
  model.scenarioName = simInfoRow?.data.ScnName;
  if (simInfoRow?.data.MonteCarloID) {
    model.monteCarloId = simInfoRow.data.MonteCarloID;
  }
  const mcIter = toNum(simInfoRow?.data.MonteCarloIteration);
  if (mcIter !== undefined) {
    model.monteCarloIteration = mcIter;
  }

  // 解析绝对时间或相对 TimeSpan 到统一秒基准
  let baseEpochMs: number | null = null;
  if (simInfoRow?.data.ReferenceTime) {
    const refParsed = parseF1Time(simInfoRow.data.ReferenceTime);
    if (refParsed?.kind === 'epoch_ms' && refParsed.epochMs !== undefined) {
      baseEpochMs = refParsed.epochMs;
    }
  }
  const simStartParsed = simInfoRow?.data.Time ? parseF1Time(simInfoRow.data.Time) : null;
  if (simStartParsed?.kind === 'epoch_ms' && simStartParsed.epochMs !== undefined && baseEpochMs === null) {
    baseEpochMs = simStartParsed.epochMs;
  }

  // 第一遍扫描全部 Time 找出最小 epoch_ms 作为基准（当 SimInfo 为绝对时间但其他表为绝对时间时）
  if (baseEpochMs === null) {
    for (const rows of tables.values()) {
      for (const r of rows) {
        const pt = parseF1Time(r.data.Time);
        if (pt?.kind === 'epoch_ms' && pt.epochMs !== undefined) {
          baseEpochMs = baseEpochMs === null ? pt.epochMs : Math.min(baseEpochMs, pt.epochMs);
        }
      }
    }
  }

  let maxSeconds = 0;
  let seq = 0;
  const nextId = () => `evt-csv-${(++seq).toString().padStart(5, '0')}`;

  const toSecondsAndClock = (rawTime: string | undefined): { sec: number; clock: string } => {
    const pt = parseF1Time(rawTime);
    if (!pt) return { sec: 0, clock: '00:00:00' };
    if (pt.kind === 'relative_seconds' && pt.relativeSeconds !== undefined) {
      maxSeconds = Math.max(maxSeconds, pt.relativeSeconds);
      return { sec: pt.relativeSeconds, clock: pt.clockText };
    }
    if (pt.kind === 'epoch_ms' && pt.epochMs !== undefined) {
      const origin = baseEpochMs ?? pt.epochMs;
      const sec = Math.max(0, (pt.epochMs - origin) / 1000);
      maxSeconds = Math.max(maxSeconds, sec);
      return { sec, clock: pt.clockText };
    }
    return { sec: 0, clock: '00:00:00' };
  };

  const addSide = (s: string | undefined) => {
    const trimmed = (s ?? '').trim();
    if (trimmed && trimmed !== '-' && !model.sides.includes(trimmed)) {
      model.sides.push(trimmed);
    }
  };

  // 1) UnitCreated -> 建立完整单位台账
  for (const r of tables.get('UnitCreated') ?? []) {
    const d = r.data;
    const uid = normalizeGuid(d.UnitID);
    if (!uid) continue;
    const { sec, clock } = toSecondsAndClock(d.Time);
    const side = d.UnitSide || 'Unknown';
    addSide(side);
    const lon = toNum(d.UnitLongitude);
    const lat = toNum(d.UnitLatitude);
    const alt = toNum(d.UnitAltitude_m);
    const course = toNum(d.UnitCourse);

    const su: SituationUnit = {
      unitId: uid,
      unitName: d.UnitName || uid,
      side,
      unitType: d.UnitType,
      unitClass: d.UnitClass || 'Unknown',
      dbid: d.UnitDBID,
      firstSeenSeconds: sec,
      firstSeenClock: clock,
      lastSeenSeconds: sec,
      lastSeenClock: clock,
      isDestroyed: false,
      damageState: 'ok',
      ammoInitial: 0,
      ammoRemaining: 0,
      emconStates: [],
      trackPoints: [],
    };
    if (lon !== undefined && lat !== undefined) {
      su.trackPoints.push({
        scenarioSeconds: sec,
        clockText: clock,
        lon,
        lat,
        altitudeM: alt,
        heading: course,
        lineRef: r.line,
      });
      model.coverage.hasPositionTracks = true;
    }
    model.units.set(uid, su);
    model.events.push({
      eventId: nextId(),
      scenarioSeconds: sec,
      clockText: clock,
      side,
      kind: 'unit_new',
      subject: su.unitName,
      object: su.unitClass,
      severity: 'minor',
      detail: { unitId: uid, dbid: d.UnitDBID },
      source: 'csv',
      ref: `CSV:${r.file}#L${r.line}`,
    });
  }

  // 2) UnitPositions -> 轨迹时序
  for (const r of tables.get('UnitPositions') ?? []) {
    const d = r.data;
    const uid = normalizeGuid(d.UnitID);
    if (!uid) continue;
    const { sec, clock } = toSecondsAndClock(d.Time);
    const side = d.UnitSide || 'Unknown';
    addSide(side);
    const lon = toNum(d.UnitLongitude);
    const lat = toNum(d.UnitLatitude);
    const speed = toNum(d.UnitSpeed_kts);
    const course = toNum(d.UnitCourse);
    const alt = toNum(d.UnitAltitude_m);

    let su = model.units.get(uid);
    if (!su) {
      su = {
        unitId: uid,
        unitName: d.UnitName || uid,
        side,
        unitType: d.UnitType,
        unitClass: d.UnitClass || 'Unknown',
        dbid: d.UnitDBID,
        firstSeenSeconds: sec,
        firstSeenClock: clock,
        lastSeenSeconds: sec,
        lastSeenClock: clock,
        isDestroyed: false,
        damageState: 'ok',
        ammoInitial: 0,
        ammoRemaining: 0,
        emconStates: [],
        trackPoints: [],
      };
      model.units.set(uid, su);
    }
    su.lastSeenSeconds = Math.max(su.lastSeenSeconds, sec);
    su.lastSeenClock = clock;
    if (lon !== undefined && lat !== undefined) {
      model.coverage.hasPositionTracks = true;
      const lastPt = su.trackPoints[su.trackPoints.length - 1];
      // 空间轨迹按至少 5 秒步长采样，避免千万级轨迹点挤爆浏览器与数据库
      if (!lastPt || sec - lastPt.scenarioSeconds >= 5) {
        su.trackPoints.push({
          scenarioSeconds: sec,
          clockText: clock,
          lon,
          lat,
          altitudeM: alt,
          heading: course,
          speedKts: speed,
          pitch: toNum(d.UnitAttitude_Pitch),
          roll: toNum(d.UnitAttitude_Roll),
          lineRef: r.line,
        });
      }
    }
  }

  // 3) WeaponFired -> 发射记录（注意 WeaponName 剥除 #\d+ 后缀）
  for (const r of tables.get('WeaponFired') ?? []) {
    const d = r.data;
    const { sec, clock } = toSecondsAndClock(d.Time);
    const firerSide = d.FiringUnitSide || d.UnitSide || 'Unknown';
    addSide(firerSide);
    const targetSide = d.TargetContactActualUnitSide;
    if (targetSide && targetSide !== '-') addSide(targetSide);

    const wRaw = d.WeaponName || 'UnknownWeapon';
    const wNorm = wRaw.replace(/\s+#\d+$/, '');
    const wid = normalizeGuid(d.WeaponID);
    const ref = `CSV:${r.file}#L${r.line}`;

    model.coverage.hasWeaponFired = true;
    model.weaponFiredEvents.push({
      eventId: nextId(),
      scenarioSeconds: sec,
      clockText: clock,
      firerUnitId: normalizeGuid(d.FiringUnitID),
      firerName: d.FiringUnitName || d.FiringUnitID || 'Unknown',
      firerSide,
      firerLon: toNum(d.FiringUnitLongitude),
      firerLat: toNum(d.FiringUnitLatitude),
      weaponId: wid || undefined,
      weaponDbid: d.WeaponDBID,
      weaponTypeNormalized: wNorm,
      weaponNameRaw: wRaw,
      rounds: 1,
      targetContactId: normalizeGuid(d.TargetContactID) || undefined,
      targetUnitId: normalizeGuid(d.TargetContactActualUnitID) || undefined,
      targetName: d.TargetContactActualUnitName,
      targetSide: targetSide && targetSide !== '-' ? targetSide : undefined,
      targetLon: toNum(d.TargetContactLongitude),
      targetLat: toNum(d.TargetContactLatitude),
      rangeHorizNm: toNum(d.TargetContactRangeHoriz_nm),
      salvoId: d.SalvoID || undefined,
      sourceRef: ref,
    });

    model.events.push({
      eventId: nextId(),
      scenarioSeconds: sec,
      clockText: clock,
      side: firerSide,
      kind: 'weapon_fired',
      subject: d.FiringUnitName || d.FiringUnitID || 'Unknown',
      object: wNorm,
      severity: 'major',
      detail: {
        weaponId: wid,
        targetName: d.TargetContactActualUnitName,
        rangeHorizNm: toNum(d.TargetContactRangeHoriz_nm),
      },
      source: 'csv',
      ref,
    });
  }

  // 4) WeaponEndgame -> 终局命中 / 点防御拦截记录
  for (const r of tables.get('WeaponEndgame') ?? []) {
    const d = r.data;
    const { sec, clock } = toSecondsAndClock(d.Time);
    const wSide = d.WeaponSide || 'Unknown';
    addSide(wSide);
    if (d.TargetSide && d.TargetSide !== '-') addSide(d.TargetSide);
    const res = (d.Result || '').trim();
    const ref = `CSV:${r.file}#L${r.line}`;

    model.coverage.hasWeaponEndgame = true;
    if (res.startsWith('POINTDEF:')) {
      model.coverage.hasPointDefense = true;
    }

    model.weaponEndgameEvents.push({
      eventId: nextId(),
      scenarioSeconds: sec,
      clockText: clock,
      weaponId: normalizeGuid(d.WeaponID),
      weaponName: (d.WeaponName || '').replace(/\s+#\d+$/, ''),
      weaponSide: wSide,
      parentFiringUnitId: normalizeGuid(d.ParentFiringUnitID) || undefined,
      targetId: normalizeGuid(d.TargetID) || undefined,
      targetName: d.TargetName,
      targetSide: d.TargetSide,
      result: res,
      endgameMessage: d.EndgameMessage,
      sourceRef: ref,
    });

    model.events.push({
      eventId: nextId(),
      scenarioSeconds: sec,
      clockText: clock,
      side: wSide,
      kind: 'weapon_endgame',
      subject: (d.WeaponName || '').replace(/\s+#\d+$/, ''),
      object: d.TargetName || d.TargetID || null,
      severity: res === 'KILL' || res === 'HIT' ? 'major' : 'minor',
      detail: { result: res, weaponId: normalizeGuid(d.WeaponID), message: d.EndgameMessage },
      source: 'csv',
      ref,
    });
  }

  // 5) UnitDamaged (含 Damage.csv 兼容) & UnitDestroyed
  for (const r of tables.get('UnitDamaged') ?? []) {
    const d = r.data;
    const { sec, clock } = toSecondsAndClock(d.Time);
    const uid = normalizeGuid(d.UnitID);
    const side = d.UnitSide || model.units.get(uid)?.side || 'Unknown';
    addSide(side);
    const ref = `CSV:${r.file}#L${r.line}`;
    const dmgPct = toNum(d.DamagePercent);

    model.coverage.hasDamagedOrDestroyed = true;
    const su = model.units.get(uid);
    if (su) {
      if (su.damageState === 'ok') su.damageState = 'damaged';
      su.damagePercent = dmgPct;
    }
    model.damageAndHitEvents.push({
      eventId: nextId(),
      scenarioSeconds: sec,
      clockText: clock,
      targetUnitId: uid,
      targetUnitName: d.UnitName || su?.unitName,
      targetSide: side,
      damageState: 'damaged',
      damagePercent: dmgPct,
      reason: d.Reason,
      cause: d.Cause,
      sourceWeapon: d.Cause && d.Cause !== '-' ? d.Cause : undefined,
      sourceRef: ref,
    });
    model.events.push({
      eventId: nextId(),
      scenarioSeconds: sec,
      clockText: clock,
      side,
      kind: 'unit_damaged',
      subject: d.UnitName || uid,
      object: d.Cause && d.Cause !== '-' ? d.Cause : null,
      severity: 'major',
      detail: { damagePercent: dmgPct, reason: d.Reason, cause: d.Cause },
      source: 'csv',
      ref,
    });
  }

  for (const r of tables.get('UnitDestroyed') ?? []) {
    const d = r.data;
    const { sec, clock } = toSecondsAndClock(d.Time);
    const uid = normalizeGuid(d.UnitID);
    const su = model.units.get(uid);
    const side = (d.UnitSide && d.UnitSide !== '-' ? d.UnitSide : su?.side) || 'Unknown';
    addSide(side);
    const ref = `CSV:${r.file}#L${r.line}`;

    model.coverage.hasDamagedOrDestroyed = true;
    if (su) {
      su.isDestroyed = true;
      su.destroyedSeconds = sec;
      su.destroyedClock = clock;
      su.damageState = 'destroyed';
    }
    model.damageAndHitEvents.push({
      eventId: nextId(),
      scenarioSeconds: sec,
      clockText: clock,
      targetUnitId: uid,
      targetUnitName: d.UnitName || su?.unitName,
      targetSide: side,
      damageState: 'destroyed',
      reason: d.Reason,
      cause: d.Cause,
      sourceWeapon: d.Cause && d.Cause !== '-' ? d.Cause : undefined,
      sourceRef: ref,
    });
    model.events.push({
      eventId: nextId(),
      scenarioSeconds: sec,
      clockText: clock,
      side,
      kind: 'unit_destroyed',
      subject: d.UnitName || uid,
      object: d.Cause && d.Cause !== '-' ? d.Cause : null,
      severity: 'major',
      detail: { unitId: uid, reason: d.Reason, cause: d.Cause },
      source: 'csv',
      ref,
    });
  }

  // 6) Expenditures & Losses AAR
  for (const r of tables.get('Expenditures') ?? []) {
    const d = r.data;
    const num = Number(d.Num ?? 0);
    if (!Number.isFinite(num)) continue;
    addSide(d.Side);
    model.coverage.hasExpenditures = true;
    model.expenditures.push({
      side: d.Side || 'Unknown',
      dbid: d.DBID || '',
      weaponName: d.WeaponName || '',
      num,
      sourceRef: `CSV:${r.file}#L${r.line}`,
    });
  }

  for (const r of tables.get('Losses') ?? []) {
    const d = r.data;
    addSide(d.Side);
    model.coverage.hasLosses = true;
    model.losses.push({
      side: d.Side || 'Unknown',
      subjectId: normalizeGuid(d.SubjectID),
      dbid: d.DBID || '',
      subjectName: d.SubjectName || '',
      unitType: d.Type || '',
      unitClass: d.Class || '',
      sourceRef: `CSV:${r.file}#L${r.line}`,
    });
  }

  // 7) 探测、接触与传感器初始记录（若本局开启 IsExportExperimentEvaluation）
  for (const r of tables.get('ContactCreated') ?? []) {
    const d = r.data;
    const { sec, clock } = toSecondsAndClock(d.Time);
    const cid = normalizeGuid(d.ContactID);
    if (!cid) continue;
    addSide(d.Side);
    model.coverage.hasContacts = true;
    model.contacts.set(cid, {
      contactId: cid,
      targetUnitId: normalizeGuid(d.ActualUnitID) || undefined,
      targetUnitName: d.ActualUnitName,
      detectedBySide: d.Side || 'Unknown',
      firstSeenSeconds: sec,
      firstSeenClock: clock,
      lastSeenSeconds: sec,
      lastSeenClock: clock,
      isLost: false,
      cumulativeDetectedSeconds: 0,
      lostIntervals: [],
    });
    model.events.push({
      eventId: nextId(),
      scenarioSeconds: sec,
      clockText: clock,
      side: d.Side || null,
      kind: 'detection_new',
      subject: d.ContactName || cid,
      object: d.ActualUnitName || null,
      severity: 'major',
      detail: { contactId: cid, actualUnitId: normalizeGuid(d.ActualUnitID) },
      source: 'csv',
      ref: `CSV:${r.file}#L${r.line}`,
    });
  }

  // 7.1) DetectionIdentificationChanged (目标识别状态变更事件流)
  for (const r of tables.get('DetectionIdentificationChanged') ?? []) {
    const d = r.data;
    const cid = normalizeGuid(d.ContactID);
    if (!cid) continue;
    const { sec, clock } = toSecondsAndClock(d.Time);
    let contact = model.contacts.get(cid);
    if (!contact) {
      contact = {
        contactId: cid,
        targetUnitName: d.ContactName,
        detectedBySide: 'Unknown',
        firstSeenSeconds: sec,
        firstSeenClock: clock,
        lastSeenSeconds: sec,
        lastSeenClock: clock,
        isLost: false,
        cumulativeDetectedSeconds: 0,
        lostIntervals: [],
        identificationHistory: [],
      };
      model.contacts.set(cid, contact);
      model.coverage.hasContacts = true;
    }
    if (!contact.identificationHistory) {
      contact.identificationHistory = [];
    }
    contact.identificationHistory.push({
      scenarioSeconds: sec,
      clockText: clock,
      status: String(d.IdentificationStatus || '').trim(),
      sensorId: normalizeGuid(d.SensorID) || undefined,
      rangeHorizNm: toNum(d.ContactRangeHoriz_nm) ?? undefined,
      ref: `CSV:${r.file}#L${r.line}`,
    });
    // 若接触未明确探测方且存在传感器挂载平台，推断探测方阵营
    if (d.SensorPlatformID && (!contact.detectedBySide || contact.detectedBySide === 'Unknown')) {
      const parent = model.units.get(normalizeGuid(d.SensorPlatformID));
      if (parent?.side) {
        contact.detectedBySide = parent.side;
      }
    }
    model.events.push({
      eventId: nextId(),
      scenarioSeconds: sec,
      clockText: clock,
      side: contact.detectedBySide || null,
      kind: 'identification_change',
      subject: d.ContactName || cid,
      object: d.IdentificationStatus || null,
      severity: 'minor',
      detail: {
        contactId: cid,
        status: d.IdentificationStatus,
        sensorName: d.SensorName,
        rangeNm: toNum(d.ContactRangeHoriz_nm),
      },
      source: 'csv',
      ref: `CSV:${r.file}#L${r.line}`,
    });
  }

  const sensorOwnerMap = new Map<string, { unitId: string; side?: string; sensorName?: string }>();
  for (const r of tables.get('SensorCreated') ?? []) {
    const d = r.data;
    const uid = normalizeGuid(d.UnitID);
    const sid = normalizeGuid(d.SensorID);
    const su = model.units.get(uid);
    if (sid) {
      sensorOwnerMap.set(sid, {
        unitId: uid,
        side: su?.side,
        sensorName: d.SensorName || undefined,
      });
    }
    if (!su) continue;
    const active = String(d.SensorIsActive).toLowerCase() === 'true';
    su.emconStates.push({
      scenarioSeconds: su.firstSeenSeconds,
      clockText: su.firstSeenClock,
      sensorId: sid,
      sensorName: d.SensorName,
      active,
      lineRef: `CSV:${r.file}#L${r.line}`,
    });
    model.coverage.hasSensorStates = true;
  }

  // 7.2) FirstSensorToUnitRecordCreated (原生首次探测距离与目标关联)
  const firstSensorRows = tables.get('FirstSensorToUnitRecordCreated') ?? [];
  if (firstSensorRows.length > 0) {
    model.firstSensorDetections = [];
    for (const r of firstSensorRows) {
      const d = r.data;
      const dist = toNum(d.Distance);
      if (dist === undefined) continue;
      const sid = normalizeGuid(d.SensorID);
      const tid = normalizeGuid(d.TargetID);
      if (!sid || !tid) continue;
      const { sec, clock } = toSecondsAndClock(d.Time);
      const owner = sensorOwnerMap.get(sid);
      model.firstSensorDetections.push({
        scenarioSeconds: sec,
        clockText: clock,
        sensorId: sid,
        targetId: tid,
        distanceNm: dist,
        observerUnitId: owner?.unitId,
        observerSide: owner?.side,
        sensorName: owner?.sensorName,
        sourceRef: `CSV:${r.file}#L${r.line}`,
      });
    }
    if (model.firstSensorDetections.length > 0) {
      model.coverage.hasFirstSensorRecord = true;
    }
  }

  // 7.3) EngagementCycle (原生交战周期事件流)
  const engCycleRows = tables.get('EngagementCycle') ?? [];
  if (engCycleRows.length > 0) {
    model.engagementCycleEvents = [];
    for (const r of engCycleRows) {
      const d = r.data;
      const { sec, clock } = toSecondsAndClock(d.Time);
      addSide(d.UnitSide);
      if (d.ContactActualUnitSide) addSide(d.ContactActualUnitSide);
      model.engagementCycleEvents.push({
        scenarioSeconds: sec,
        clockText: clock,
        unitId: normalizeGuid(d.UnitID),
        unitName: d.UnitName || '',
        unitClass: d.UnitClass || '',
        unitSide: d.UnitSide || 'Unknown',
        cycleAction: d.CycleAction || '',
        contactId: normalizeGuid(d.ContactID) || undefined,
        contactName: d.ContactName || undefined,
        contactRangeHorizNm: toNum(d.ContactRangeHoriz_nm),
        contactActualUnitId: normalizeGuid(d.ContactActualUnitID) || undefined,
        contactActualUnitSide: d.ContactActualUnitSide || undefined,
        salvoId: d.SalvoID || undefined,
        sourceRef: `CSV:${r.file}#L${r.line}`,
      });
    }
    if (model.engagementCycleEvents.length > 0) {
      model.coverage.hasEngagementCycle = true;
    }
  }

  // 7.4) ComponentStatusChanged (部件级 BDA 功能毁伤 + EMCON 传感器开关机状态)
  const compRows = tables.get('ComponentStatusChanged') ?? [];
  if (compRows.length > 0) {
    model.componentStatusEvents = [];
    for (const r of compRows) {
      const d = r.data;
      const { sec, clock } = toSecondsAndClock(d.Time);
      const pid = normalizeGuid(d.PlatformID);
      const cid = normalizeGuid(d.ComponentID);
      const unit = model.units.get(pid);
      const rawActive = String(d.SensorIsActive ?? '').trim().toLowerCase();
      const sensorIsActive =
        rawActive === 'true' || rawActive === '1'
          ? true
          : rawActive === 'false' || rawActive === '0'
            ? false
            : undefined;
      model.componentStatusEvents.push({
        scenarioSeconds: sec,
        clockText: clock,
        componentId: cid,
        componentName: d.ComponentName || '',
        componentStatus: d.ComponentStatus || '',
        sensorIsActive,
        componentDamageSeverity: d.ComponentDamageSeverity || '',
        platformId: pid,
        platformName: d.PlatformName || unit?.unitName || '',
        platformSide: unit?.side,
        sourceRef: `CSV:${r.file}#L${r.line}`,
      });
      if (unit && sensorIsActive !== undefined) {
        unit.emconStates.push({
          scenarioSeconds: sec,
          clockText: clock,
          sensorId: cid || d.ComponentName || 'sensor',
          sensorName: d.ComponentName || undefined,
          active: sensorIsActive,
          lineRef: `CSV:${r.file}#L${r.line}`,
        });
        model.coverage.hasSensorStates = true;
      }
    }
    if (model.componentStatusEvents.length > 0) {
      model.coverage.hasComponentStatus = true;
    }
  }

  // 7.45) UnitJammed / CommCreated / CommIsJammedChanged (电子战与 C2 通信抗干扰)
  const jamRows = tables.get('UnitJammed') ?? [];
  if (jamRows.length > 0) {
    model.unitJamEvents = [];
    for (const r of jamRows) {
      const d = r.data;
      const uid = normalizeGuid(d.UnitID);
      if (!uid) continue;
      const { sec, clock } = toSecondsAndClock(d.Time);
      const rawStatus = String(d.Status ?? '').trim();
      const low = rawStatus.toLowerCase();
      const isJammed = low === 'true' || low === '1' || low === 'jammed' || low === 'yes';
      const unit = model.units.get(uid);
      model.unitJamEvents.push({
        scenarioSeconds: sec,
        clockText: clock,
        unitId: uid,
        unitSide: unit?.side,
        isJammed,
        rawStatus,
        sourceRef: `CSV:${r.file}#L${r.line}`,
      });
    }
    if (model.unitJamEvents.length > 0) {
      model.coverage.hasEwJamming = true;
    }
  }

  const commOwnerMap = new Map<string, { unitId: string; side?: string }>();
  const commCreatedRows = tables.get('CommCreated') ?? [];
  if (commCreatedRows.length > 0) {
    model.commDevices = [];
    for (const r of commCreatedRows) {
      const d = r.data;
      const uid = normalizeGuid(d.UnitID);
      const commId = normalizeGuid(d.CommID);
      if (!commId) continue;
      const unit = model.units.get(uid);
      commOwnerMap.set(commId, { unitId: uid, side: unit?.side });
      model.commDevices.push({
        unitId: uid,
        unitName: d.UnitName || unit?.unitName || '',
        unitSide: unit?.side,
        commId,
        commName: d.CommName || '',
        commDbid: d.CommDBID || undefined,
        commStatus: d.CommStatus || undefined,
        sourceRef: `CSV:${r.file}#L${r.line}`,
      });
    }
  }

  const commJamRows = tables.get('CommIsJammedChanged') ?? [];
  if (commJamRows.length > 0) {
    model.commJamEvents = [];
    for (const r of commJamRows) {
      const d = r.data;
      const commId = normalizeGuid(d.CommID);
      if (!commId) continue;
      const { sec, clock } = toSecondsAndClock(d.Time);
      const low = String(d.IsJammed ?? '').trim().toLowerCase();
      const isJammed = low === 'true' || low === '1' || low === 'yes';
      const owner = commOwnerMap.get(commId);
      model.commJamEvents.push({
        scenarioSeconds: sec,
        clockText: clock,
        commId,
        commName: d.CommName || '',
        unitId: owner?.unitId,
        unitSide: owner?.side,
        isJammed,
        sourceRef: `CSV:${r.file}#L${r.line}`,
      });
    }
    if (model.commJamEvents.length > 0) {
      model.coverage.hasCommJamming = true;
    }
  }

  // 7.5) WeaponLost / WeaponImpact / FuelConsumed / AirOps / SensorClassUsed / CommClassUsed
  const weaponLostRows = tables.get('WeaponLost') ?? [];
  if (weaponLostRows.length > 0) {
    model.weaponLostEvents = [];
    for (const r of weaponLostRows) {
      const d = r.data;
      const num = Number(d.Num ?? 0);
      if (!Number.isFinite(num)) continue;
      addSide(d.Side);
      model.weaponLostEvents.push({
        weaponName: d.WeaponName || '',
        dbid: d.DBID || '',
        side: d.Side || 'Unknown',
        num,
        sourceRef: `CSV:${r.file}#L${r.line}`,
      });
    }
  }

  const impactRows = tables.get('WeaponImpact') ?? [];
  if (impactRows.length > 0) {
    model.weaponImpactEvents = [];
    for (const r of impactRows) {
      const d = r.data;
      const { sec, clock } = toSecondsAndClock(d.Time);
      model.weaponImpactEvents.push({
        unitId: normalizeGuid(d.UnitID),
        scenarioSeconds: sec,
        clockText: clock,
        speedKts: toNum(d.UnitSpeed_kts),
        altitudeM: toNum(d.UnitAltitude_m),
        lon: toNum(d.UnitLongitude),
        lat: toNum(d.UnitLatitude),
        sourceRef: `CSV:${r.file}#L${r.line}`,
      });
    }
  }

  const fuelRows = tables.get('FuelConsumed') ?? [];
  if (fuelRows.length > 0) {
    const fuelMap = new Map<
      string,
      { unitId: string; unitName?: string; side?: string; consumedQty: number; sourceRef?: string }
    >();
    for (const r of fuelRows) {
      const d = r.data;
      const uid = normalizeGuid(d.UnitID);
      if (!uid) continue;
      const qty = toNum(d.FuelQuantity) ?? 0;
      const side = d.UnitSide || 'Unknown';
      addSide(side);
      const existing = fuelMap.get(uid);
      if (existing) {
        existing.consumedQty += qty;
      } else {
        fuelMap.set(uid, {
          unitId: uid,
          unitName: d.UnitName,
          side,
          consumedQty: qty,
          sourceRef: `CSV:${r.file}#L${r.line}`,
        });
      }
    }
    model.fuelRecords = [...fuelMap.values()];
  }

  const airOpsRows = tables.get('AirOps') ?? [];
  if (airOpsRows.length > 0) {
    model.airOpsEvents = [];
    for (const r of airOpsRows) {
      const d = r.data;
      const { sec, clock } = toSecondsAndClock(d.Time);
      addSide(d.UnitSide);
      model.airOpsEvents.push({
        unitId: normalizeGuid(d.UnitID),
        unitName: d.UnitName || '',
        side: d.UnitSide || 'Unknown',
        action: d.Action || '',
        scenarioSeconds: sec,
        clockText: clock,
        sourceRef: `CSV:${r.file}#L${r.line}`,
      });
    }
  }

  const dockingRows = tables.get('DockingOps') ?? [];
  if (dockingRows.length > 0) {
    model.dockingOpsEvents = [];
    for (const r of dockingRows) {
      const d = r.data;
      const { sec, clock } = toSecondsAndClock(d.Time);
      addSide(d.UnitSide);
      model.dockingOpsEvents.push({
        scenarioSeconds: sec,
        clockText: clock,
        unitId: normalizeGuid(d.UnitID),
        unitName: d.UnitName || '',
        side: d.UnitSide || 'Unknown',
        action: d.Action || '',
        departureHostId: normalizeGuid(d.DepartureHostID) || undefined,
        arrivalHostId: normalizeGuid(d.ArrivalHostID) || undefined,
        missionId: normalizeGuid(d.MissionID) || undefined,
        totalFuel: toNum(d.TotalFuel),
        sourceRef: `CSV:${r.file}#L${r.line}`,
      });
    }
    if (model.dockingOpsEvents.length > 0) {
      model.coverage.hasDockingOps = true;
    }
  }

  const fuelTransferRows = tables.get('FuelTransfer') ?? [];
  if (fuelTransferRows.length > 0) {
    model.fuelTransferEvents = [];
    for (const r of fuelTransferRows) {
      const d = r.data;
      const qty = toNum(d.FuelQuantity);
      if (qty === undefined) continue;
      const { sec, clock } = toSecondsAndClock(d.Time);
      addSide(d.UnitSide);
      addSide(d.ReceiverSide);
      model.fuelTransferEvents.push({
        scenarioSeconds: sec,
        clockText: clock,
        unitId: normalizeGuid(d.UnitID),
        unitName: d.UnitName || '',
        unitSide: d.UnitSide || 'Unknown',
        receiverId: normalizeGuid(d.ReceiverID),
        receiverName: d.ReceiverName || '',
        receiverSide: d.ReceiverSide || 'Unknown',
        fuelQuantity: qty,
        fuelType: d.FuelType || undefined,
        sourceRef: `CSV:${r.file}#L${r.line}`,
      });
    }
    if (model.fuelTransferEvents.length > 0) {
      model.coverage.hasFuelTransfer = true;
    }
  }

  const missionChangedRows = tables.get('MissionChanged') ?? [];
  if (missionChangedRows.length > 0) {
    const missionMap = new Map<string, NonNullable<SituationModel['missionMetas']>[number]>();
    for (const r of missionChangedRows) {
      const d = r.data;
      const mid = normalizeGuid(d.MissionID);
      if (!mid) continue;
      addSide(d.Side);
      const parseOptSec = (raw?: string) => {
        if (!raw || !raw.trim() || raw.trim() === '-') return undefined;
        return toSecondsAndClock(raw).sec;
      };
      const prev = missionMap.get(mid);
      const isActLow = String(d.IsActive ?? '').trim().toLowerCase();
      missionMap.set(mid, {
        missionId: mid,
        missionName: d.MissionName || prev?.missionName || mid,
        side: d.Side || prev?.side || 'Unknown',
        category: d.Category || prev?.category,
        missionClass: d.MissionClass || prev?.missionClass,
        isActive: isActLow === 'true' ? true : isActLow === 'false' ? false : prev?.isActive,
        startTimeSeconds: parseOptSec(d.StartTime) ?? prev?.startTimeSeconds,
        endTimeSeconds: parseOptSec(d.EndTime) ?? prev?.endTimeSeconds,
        takeOffTimeSeconds: parseOptSec(d.TakeOffTime) ?? prev?.takeOffTimeSeconds,
        timeOnTargetSeconds: parseOptSec(d.TimeOnTarget) ?? prev?.timeOnTargetSeconds,
        timeOnTargetRaw: d.TimeOnTarget?.trim() || prev?.timeOnTargetRaw,
        sourceRef: `CSV:${r.file}#L${r.line}`,
      });
    }
    model.missionMetas = [...missionMap.values()];
    if (model.missionMetas.length > 0) {
      model.coverage.hasMissionMeta = true;
    }
  }

  const scRows = tables.get('SensorClassUsed') ?? [];
  if (scRows.length > 0) model.sensorClassCount = scRows.length;
  const ccRows = tables.get('CommClassUsed') ?? [];
  if (ccRows.length > 0) model.commClassCount = ccRows.length;

  // 8) MissionRefPointRelationChanged -> 构筑任务区多边形
  const missionPolys = new Map<string, { type: string; pts: GeoPoint[] }>();
  for (const r of tables.get('MissionRefPointRelationChanged') ?? []) {
    const d = r.data;
    const mid = normalizeGuid(d.MissionID);
    const lon = toNum(d.Longitude);
    const lat = toNum(d.Latitude);
    if (!mid || lon === undefined || lat === undefined) continue;
    const entry = missionPolys.get(mid) ?? { type: d.Type || 'Patrol', pts: [] };
    entry.pts.push({ lon, lat });
    missionPolys.set(mid, entry);
  }
  for (const [mid, entry] of missionPolys.entries()) {
    if (entry.pts.length >= 3) {
      const poly: EvalPolygon = { id: mid, name: mid, points: entry.pts };
      if (entry.type === 'NavigationCourse') model.corridors.push(poly);
      else model.patrolAreas.push(poly);
      model.coverage.hasPolygonsOrCorridors = true;
    }
  }

  model.events.sort((a, b) => a.scenarioSeconds - b.scenarioSeconds);
  const firstEventClock = model.events[0]?.clockText ?? simStartParsed?.clockText ?? '00:00:00';
  model.startGameClock = firstEventClock;
  model.totalGameSeconds = maxSeconds;
  model.endGameClock = formatSecondsToClock(maxSeconds);

  if (maxBom >= 2) {
    model.coverage.warnings.push(`已检测并自动剥离原始引擎 CSV 双 UTF-8 BOM (BOMs=${maxBom})`);
  }
  if (!model.coverage.hasContacts) {
    model.coverage.warnings.push('本局 CSV 未包含 ContactCreated/ContactPositions（IsExportExperimentEvaluation 可能未开启），探测链算子将按证据缺口安全降级');
  }

  return {
    model,
    csvDir,
    tableCounts,
    detectedTimelineIds,
  };
}
