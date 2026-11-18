import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  locateCsvDirectory,
  parseCsvLine,
  resolveCanonicalCsvEventName,
} from '../../adapters/csv-adapter.ts';
import { parseF1Time } from '../../core/time-utils.ts';

const execFileAsync = promisify(execFile);

/**
 * LabConsole/tools/event_semantics/registry.json 严格白名单事件名
 * Expenditures / WeaponEndgame / WeaponLost 等不在白名单中，必须仅暂存白名单 CSV。
 */
const REGISTRY_ALLOWLIST_CANONICAL = new Set<string>([
  'SimInfo',
  'UnitCreated',
  'MissionChanged',
  'MissionRefPointRelationChanged',
  'MissionUnitRelationChanged',
  'UnitPositions',
  'WeaponFired',
  'UnitDamaged',
  'WeaponImpact',
  'UnitDestroyed',
  'Explosion',
  'Losses',
]);

/** 新版 F1 EventExporter 列名到 LabConsole registry.json column_aliases 的无损桥接映射 */
const F1_EXTENDED_TO_REGISTRY_COLUMN: Record<string, string> = {
  FiringUnitID: 'UnitID',
  FiringUnitDBID: 'UnitDBID',
  FiringUnitName: 'UnitName',
  FiringUnitType: 'UnitType',
  FiringUnitClass: 'UnitClass',
  FiringUnitSide: 'Side',
  FiringUnitLongitude: 'Longitude',
  FiringUnitLatitude: 'Latitude',
  FiringUnitCourse: 'UnitCourse',
  FiringUnitAltitude_m: 'Altitude',
  TargetContactActualUnitSide: 'TargetSide',
};

export interface PythonMetricsResult {
  available: boolean;
  csvDir: string;
  stagedFiles: string[];
  skippedFiles: string[];
  metrics?: Record<string, unknown>;
  normalizeReport?: Record<string, unknown>;
  reason?: string;
  warnings: string[];
}

function resolveRepoRoot(): string {
  return path.resolve(import.meta.dirname, '..', '..', '..', '..');
}

function collectCsvFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectCsvFiles(full));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.csv')) {
      result.push(full);
    }
  }
  return result;
}

function loadRegistryColumnAliases(registryPath: string): Set<string> {
  if (!fs.existsSync(registryPath)) return new Set();
  const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as {
    column_aliases?: Record<string, string>;
  };
  return new Set(Object.keys(parsed.column_aliases ?? {}));
}

function csvEscape(val: string): string {
  if (/[",\r\n]/.test(val)) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

const CROSS_DAY_TIMESPAN_HINT_RE = /(?:^|[,"\s])\d+\.\d{1,3}:[0-5]\d:[0-5]\d/;
const RELATIVE_TIMESPAN_CELL_RE = /^(?:\d+\.)?\d{1,3}:[0-5]\d:[0-5]\d(?:\.\d+)?$/;
const TIME_COL_NAMES = new Set(['Time', 'CurrentTime', 'StartTime', 'EndTime', 'TimeStamp', 'ScenarioTime']);

function normalizeCrossDayTimeCell(raw: string): { value: string; converted: boolean } {
  const trimmed = raw.trim();
  if (!RELATIVE_TIMESPAN_CELL_RE.test(trimmed)) {
    return { value: raw, converted: false };
  }
  const parsed = parseF1Time(trimmed);
  if (!parsed || parsed.kind !== 'relative_seconds' || typeof parsed.relativeSeconds !== 'number') {
    return { value: raw, converted: false };
  }
  return { value: String(Number(parsed.relativeSeconds.toFixed(6))), converted: true };
}

function stageCsvWithRegistryProjection(
  srcPath: string,
  dstPath: string,
  allowedCols: Set<string>,
  relName: string,
  warnings: string[],
): void {
  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
  const raw = fs.readFileSync(srcPath, 'utf-8').replace(/^\uFEFF+/, '');
  const lines = raw.split(/\r?\n/);
  const headerLine = lines[0] ?? '';
  const headers = parseCsvLine(headerLine).map((h) => h.replace(/^\uFEFF+/, '').trim());

  const hasUnknown = allowedCols.size > 0 && headers.some((h) => h && !allowedCols.has(h));
  const hasCrossDayTime = CROSS_DAY_TIMESPAN_HINT_RE.test(raw);
  if (!hasUnknown && !hasCrossDayTime) {
    fs.copyFileSync(srcPath, dstPath);
    return;
  }

  // 构建兼容列索引投影：先保留原已注册列，再将可桥接新版列映射到空缺标准列
  const keepIndices: number[] = [];
  const outHeaders: string[] = [];
  const usedTargets = new Set<string>();
  const droppedCols: string[] = [];
  const bridgedCols: string[] = [];

  if (!hasUnknown) {
    for (let i = 0; i < headers.length; i += 1) {
      keepIndices.push(i);
      outHeaders.push(headers[i]);
    }
  } else {
    for (let i = 0; i < headers.length; i += 1) {
      const col = headers[i];
      if (!col) continue;
      if (allowedCols.has(col)) {
        keepIndices.push(i);
        outHeaders.push(col);
        usedTargets.add(col);
      }
    }

    for (let i = 0; i < headers.length; i += 1) {
      const col = headers[i];
      if (!col || allowedCols.has(col)) continue;
      const mapped = F1_EXTENDED_TO_REGISTRY_COLUMN[col];
      if (mapped && allowedCols.has(mapped) && !usedTargets.has(mapped)) {
        keepIndices.push(i);
        outHeaders.push(mapped);
        usedTargets.add(mapped);
        bridgedCols.push(`${col}->${mapped}`);
      } else {
        droppedCols.push(col);
      }
    }
  }

  const timeColSet = new Set<number>();
  outHeaders.forEach((h, pos) => {
    if (TIME_COL_NAMES.has(h) || /time/i.test(h)) {
      timeColSet.add(pos);
    }
  });

  let convertedTimeCells = 0;
  const outLines: string[] = [outHeaders.map(csvEscape).join(',')];
  for (let r = 1; r < lines.length; r += 1) {
    const line = lines[r];
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const projected = keepIndices.map((idx, outPos) => {
      let cellVal = cells[idx] ?? '';
      if (hasCrossDayTime && (timeColSet.has(outPos) || /^\d+\.\d{1,3}:[0-5]\d:[0-5]\d/.test(cellVal.trim()))) {
        const res = normalizeCrossDayTimeCell(cellVal);
        if (res.converted) {
          cellVal = res.value;
          convertedTimeCells += 1;
        }
      }
      return csvEscape(cellVal);
    });
    outLines.push(projected.join(','));
  }
  fs.writeFileSync(dstPath, outLines.join('\n') + '\n', 'utf-8');
  if (bridgedCols.length > 0 || droppedCols.length > 0) {
    warnings.push(
      `暂存桥接 ${relName}: 映射 [${bridgedCols.join(', ')}]${droppedCols.length > 0 ? `，裁剪扩展列 ${droppedCols.length} 个` : ''}`,
    );
  }
  if (convertedTimeCells > 0) {
    warnings.push(
      `暂存规范化 ${relName}: 已将 ${convertedTimeCells} 条跨天 TimeSpan 锚定转换为 ISO-8601`,
    );
  }
}

/**
 * 调用项目既有开源科学算子链路：
 * `LabConsole/tools/csv_normalize/csv_normalize.py` -> `LabConsole/tools/metrics/metrics.py`
 */
export async function runPythonMetricsAdapter(
  inputDir: string,
  unitPrices?: Record<string, number>,
  onProgress?: (info: { stage: string; message: string; percent?: number; log?: string }) => void,
  signal?: AbortSignal,
): Promise<PythonMetricsResult> {
  const csvDir = locateCsvDirectory(path.resolve(inputDir));
  const warnings: string[] = [];

  if (!fs.existsSync(csvDir)) {
    return {
      available: false,
      csvDir,
      stagedFiles: [],
      skippedFiles: [],
      reason: `CSV 目录不存在: ${csvDir}`,
      warnings,
    };
  }

  const repoRoot = resolveRepoRoot();
  const normalizeScript = path.join(repoRoot, 'LabConsole', 'tools', 'csv_normalize', 'csv_normalize.py');
  const metricsScript = path.join(repoRoot, 'LabConsole', 'tools', 'metrics', 'metrics.py');
  const registryPath = path.join(repoRoot, 'LabConsole', 'tools', 'event_semantics', 'registry.json');

  if (!fs.existsSync(normalizeScript) || !fs.existsSync(metricsScript)) {
    return {
      available: false,
      csvDir,
      stagedFiles: [],
      skippedFiles: [],
      reason: '未找到 LabConsole/tools/csv_normalize/csv_normalize.py 或 metrics.py',
      warnings,
    };
  }

  const allowedCols = loadRegistryColumnAliases(registryPath);
  const allCsv = collectCsvFiles(csvDir);
  const stagedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-eval-py-'));

  try {
    const stageRaw = path.join(tmpRoot, 'raw');
    const stageNorm = path.join(tmpRoot, 'norm');
    fs.mkdirSync(stageRaw, { recursive: true });

    for (let i = 0; i < allCsv.length; i += 1) {
      if (signal?.aborted) {
        const err = new Error('评估任务已中止');
        err.name = 'AbortError';
        throw err;
      }
      const filePath = allCsv[i];
      const canonical = resolveCanonicalCsvEventName(filePath);
      const rel = path.relative(csvDir, filePath);
      if (REGISTRY_ALLOWLIST_CANONICAL.has(canonical)) {
        const fileStat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
        const sizeMb = fileStat ? (fileStat.size / (1024 * 1024)).toFixed(1) : '0';
        const basePct = 12 + Math.round((i / Math.max(allCsv.length, 1)) * 18);
        onProgress?.({
          stage: 'python_stage',
          message: '正在暂存投影规范表 (' + (stagedFiles.length + 1) + '/' + allCsv.length + '): ' + canonical + ' (' + sizeMb + ' MB)',
          percent: basePct,
          log: '[规范投影] 开始处理 (' + (stagedFiles.length + 1) + '/' + allCsv.length + '): ' + canonical + ' (' + sizeMb + ' MB)...',
        });
        const dst = path.join(stageRaw, rel);
        stageCsvWithRegistryProjection(filePath, dst, allowedCols, rel, warnings);
        stagedFiles.push(rel);
        onProgress?.({
          stage: 'python_stage',
          message: '已暂存规范表 (' + stagedFiles.length + '/' + allCsv.length + '): ' + canonical,
          percent: 12 + Math.round(((i + 1) / Math.max(allCsv.length, 1)) * 18),
          log: '[规范投影] (' + stagedFiles.length + '/' + allCsv.length + ') ' + canonical + ' (' + sizeMb + ' MB) 投影暂存完成',
        });
      } else {
        skippedFiles.push(rel);
      }
    }

    if (stagedFiles.length === 0) {
      return {
        available: false,
        csvDir,
        stagedFiles,
        skippedFiles,
        reason: '目录中不包含 registry.json 白名单支持的 CSV 文件',
        warnings,
      };
    }

    if (skippedFiles.length > 0) {
      warnings.push(
        `已按 registry.json 隔离跳过非规范化表（由 TS csv-adapter 直读）: ${skippedFiles.join(', ')}`,
      );
    }

    const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };

    onProgress?.({
      stage: 'python_normalize',
      message: '正在启动 csv_normalize.py 进行 44 类规范表清洗与时空对齐...',
      percent: 31,
      log: '[规范清洗] 启动 csv_normalize.py (共 ' + stagedFiles.length + ' 个规范表待清洗)...',
    });

    const normStartTime = Date.now();
    let normSec = 0;
    const normTimer = setInterval(() => {
      normSec += 1;
      const currentPct = Math.min(48, 31 + Math.floor(normSec * 1.5));
      onProgress?.({
        stage: 'python_normalize',
        message: '正在执行 44 类规范表清洗与时空对齐 (' + normSec + 's)...',
        percent: currentPct,
        log: normSec % 3 === 0 ? '[规范清洗] 规范表时空连续性对齐与别名投影中 (' + normSec + 's)...' : undefined,
      });
    }, 1000);

    try {
      await execFileAsync('python', ['-X', 'utf8', normalizeScript, stageRaw, stageNorm], {
        env,
        timeout: 180000,
        maxBuffer: 20 * 1024 * 1024,
        signal,
      });
    } finally {
      clearInterval(normTimer);
    }

    const normElapsedSec = ((Date.now() - normStartTime) / 1000).toFixed(1);
    onProgress?.({
      stage: 'python_normalize',
      message: '规范表清洗与对齐完成 (耗时 ' + normElapsedSec + 's)',
      percent: 49,
      log: '[规范清洗] 44 类事件表时空清洗完成 (' + normElapsedSec + 's)，生成 normalized/ 干净数据集',
    });

    const normalizedInputDir = path.join(stageNorm, 'normalized');
    const normReportPath = path.join(stageNorm, 'normalize_report.json');
    let normalizeReport: Record<string, unknown> | undefined;
    if (fs.existsSync(normReportPath)) {
      normalizeReport = JSON.parse(fs.readFileSync(normReportPath, 'utf-8')) as Record<string, unknown>;
    }

    const metricsArgs = ['-X', 'utf8', metricsScript, '--input', normalizedInputDir];
    if (unitPrices && Object.keys(unitPrices).length > 0) {
      const pricePath = path.join(tmpRoot, 'prices.json');
      fs.writeFileSync(pricePath, JSON.stringify(unitPrices, null, 2), 'utf-8');
      metricsArgs.push('--prices', pricePath);
    }
    const outPath = path.join(tmpRoot, 'metrics.json');
    metricsArgs.push('--output', outPath);

    onProgress?.({
      stage: 'python_metrics',
      message: '正在启动 metrics.py 执行战斗效能核心指标矩阵计算...',
      percent: 50,
      log: '[效能精算] 启动 metrics.py 科学指标矩阵计算...',
    });

    const metricsStartTime = Date.now();
    let metricsSec = 0;
    const metricsStages = [
      '正在解析对空/对海交战态势与战损交换比 (Loss/Exchange Matrix)',
      '正在计算武器命中率、拦截拦截率与火控弹药效率 (Weapon Effectiveness)',
      '正在评估制空权争夺、防空压制 (SEAD) 与时空态势控制区 (Domain Superiority)',
      '正在统计杀伤链 (Kill Web) 闭环时延与传感器协同覆盖 (Kill Web Latency)',
      '正在聚合全局战役作战效能指标分值矩阵 (Global Metrics Aggregation)',
    ];
    const metricsTimer = setInterval(() => {
      metricsSec += 1;
      const currentPct = Math.min(69, 50 + Math.floor((metricsSec / 60) * 19));
      const stageIdx = Math.min(metricsStages.length - 1, Math.floor(metricsSec / 12));
      const subMsg = metricsStages[stageIdx];
      onProgress?.({
        stage: 'python_metrics',
        message: subMsg + ' (' + metricsSec + 's)...',
        percent: currentPct,
        log: metricsSec % 4 === 0 ? '[效能精算] ' + subMsg + ' (' + metricsSec + 's)...' : undefined,
      });
    }, 1000);

    try {
      await execFileAsync('python', metricsArgs, {
        env,
        timeout: 180000,
        maxBuffer: 20 * 1024 * 1024,
        signal,
      });
    } finally {
      clearInterval(metricsTimer);
    }

    const metricsElapsedSec = ((Date.now() - metricsStartTime) / 1000).toFixed(1);
    onProgress?.({
      stage: 'python_metrics',
      message: '战斗效能核心指标计算完成 (耗时 ' + metricsElapsedSec + 's)',
      percent: 70,
      log: '[效能精算] metrics.py 执行成功 (' + metricsElapsedSec + 's)，已生成 metrics.json 效能度量字典',
    });

    const metrics = JSON.parse(fs.readFileSync(outPath, 'utf-8')) as Record<string, unknown>;
    return {
      available: true,
      csvDir,
      stagedFiles,
      skippedFiles,
      metrics,
      normalizeReport,
      warnings,
    };
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      available: false,
      csvDir,
      stagedFiles,
      skippedFiles,
      reason: `metrics.py 执行降级回退: ${message}`,
      warnings,
    };
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // 忽略 Windows 临时目录锁清理残留
    }
  }
}
