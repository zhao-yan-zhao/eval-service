import fs from 'node:fs';
import path from 'node:path';
import { locateCsvDirectory, readCsvTable, resolveCanonicalCsvEventName } from './csv-adapter.ts';

export interface SimulationDataSource {
  id: string;
  name: string;
  kind: 'csv_dir' | 'jsonl_file';
  path: string;
  description?: string;
  isBuiltin?: boolean;
  enabled?: boolean;
  scenarioName?: string;
  createdAt: string;
  updatedAt: string;
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

export interface DataSourceStatus {
  source: SimulationDataSource;
  accessible: boolean;
  fileCount?: number;
  totalSizeBytes?: number;
  scenarioName?: string;
  timelineId?: string;
  tablesFound?: string[];
  importedRunId?: string;
  error?: string;
}

export function probeSimulationPath(inputPath: string): DataSourceProbeResult {
  if (!inputPath || !inputPath.trim()) {
    return { accessible: false, path: inputPath, error: '路径不能为空' };
  }
  const cleanPath = inputPath.trim();
  if (!fs.existsSync(cleanPath)) {
    return { accessible: false, path: cleanPath, error: '磁盘路径不存在或无法访问' };
  }

  const stat = fs.statSync(cleanPath);
  if (stat.isDirectory()) {
    const csvDir = locateCsvDirectory(cleanPath);
    let files: string[] = [];
    try {
      files = fs.readdirSync(csvDir).filter((f) => f.toLowerCase().endsWith('.csv'));
    } catch (err) {
      return {
        accessible: false,
        path: cleanPath,
        error: `读取目录失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (files.length === 0) {
      return {
        accessible: true,
        path: cleanPath,
        kind: 'csv_dir',
        fileCount: 0,
        totalSizeBytes: 0,
        tablesFound: [],
        error: '目录内未找到任何 .csv 文件',
      };
    }

    let totalSizeBytes = 0;
    const tables: string[] = [];
    let scenarioName: string | undefined;
    let timelineId: string | undefined;

    for (const f of files) {
      const full = path.join(csvDir, f);
      try {
        const s = fs.statSync(full);
        totalSizeBytes += s.size;
        const canon = resolveCanonicalCsvEventName(f);
        if (!tables.includes(canon)) tables.push(canon);

        if (canon === 'SimInfo') {
          const simInfo = readCsvTable(full, { maxRows: 1 });
          const row = simInfo.rows[0]?.data;
          if (row) {
            scenarioName = row.ScnName || scenarioName;
            timelineId = row.TimelineID || timelineId;
          }
        }
      } catch {
        // 忽略单文件探针异常
      }
    }

    return {
      accessible: true,
      path: cleanPath,
      kind: 'csv_dir',
      fileCount: files.length,
      totalSizeBytes,
      scenarioName,
      timelineId,
      tablesFound: tables.sort(),
    };
  }

  if (stat.isFile()) {
    const isJsonl = cleanPath.toLowerCase().endsWith('.jsonl');
    let lineCount = 0;
    let scenarioName: string | undefined;
    if (isJsonl) {
      try {
        const fd = fs.openSync(cleanPath, 'r');
        const buf = Buffer.alloc(4096);
        const bytesRead = fs.readSync(fd, buf, 0, buf.length, null);
        fs.closeSync(fd);
        const head = buf.toString('utf8', 0, bytesRead);
        const firstLine = head.split(/\r?\n/)[0];
        if (firstLine?.trim()) {
          const parsed = JSON.parse(firstLine);
          scenarioName = parsed.scenarioName || parsed.scnName || path.basename(cleanPath);
        }
      } catch {
        // 忽略探针解析错误
      }
    }

    return {
      accessible: true,
      path: cleanPath,
      kind: 'jsonl_file',
      fileCount: 1,
      totalSizeBytes: stat.size,
      scenarioName: scenarioName ?? path.basename(cleanPath),
    };
  }

  return { accessible: false, path: cleanPath, error: '不支持的文件类型（仅支持目录或 .jsonl 文件）' };
}

export class DataSourceStore {
  private filePath: string;
  private sources = new Map<string, SimulationDataSource>();
  private activeSourceId: string | null = null;

  constructor(filePath?: string, builtinSamples?: { gj11CsvDir?: string; bsSampleJsonl?: string }) {
    this.filePath =
      filePath ?? path.resolve(import.meta.dirname, '..', '..', 'data', 'simulation-data-sources.json');
    this.initDefaults(builtinSamples);
    this.load();
    this.loadEnvDirs();
  }

  private initDefaults(builtin?: { gj11CsvDir?: string; bsSampleJsonl?: string }): void {
    const now = new Date().toISOString();
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

    const gj11Path =
      builtin?.gj11CsvDir ??
      path.join(
        repoRoot,
        'LabConsole',
        'outputs',
        'm6-verify-runs',
        '39c47807bece4e0690feb0598f7a92d1',
        'GJ11-PL15试射-90nm正对-80nm-1',
        'EventExport_CSV',
      );

    const bsPath =
      builtin?.bsSampleJsonl ??
      path.join(repoRoot, 'demo-ui', 'proxy', 'testdata', 'bs-frames-sample.jsonl');

    const default55thPath = 'J:\\55所\\想定导出\\EventExport_CSV';

    const presets: SimulationDataSource[] = [
      {
        id: 'gj11_bvr_real',
        name: 'GJ-11 vs HaveRaider BVR 实测 (LabConsole 双BOM全表)',
        kind: 'csv_dir',
        path: gj11Path,
        description: '既有 LabConsole 验证运行基准输出，包含武器交战与命中实证',
        isBuiltin: true,
        enabled: true,
        scenarioName: 'GJ-11 vs HaveRaider BVR实测CSV (双BOM全表)',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '55th_taihai_csv',
        name: '55所台海场景想定全量事件导出 (EventExport_CSV)',
        kind: 'csv_dir',
        path: default55thPath,
        description: '55所大型实景推演事件全量导出（台海场景，包含红/蓝/绿/俄多阵营）',
        isBuiltin: true,
        enabled: true,
        scenarioName: '台海场景',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'bs_frames_sample',
        name: 'BS 状态帧基准集群样例 (bs-frames-sample.jsonl)',
        kind: 'jsonl_file',
        path: bsPath,
        description: 'demo-ui 既有态势状态帧样本，包含 7 族状态与近岸集群轨迹',
        isBuiltin: true,
        enabled: true,
        scenarioName: 'BS 状态帧基准集群样例 (bs-frames-sample.jsonl)',
        createdAt: now,
        updatedAt: now,
      },
    ];

    for (const p of presets) {
      this.sources.set(p.id, p);
    }
  }

  private normalizePathKey(p: string): string {
    return path.resolve(p.trim()).toLowerCase();
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as
        | SimulationDataSource[]
        | { activeSourceId?: string; sources?: SimulationDataSource[] };
      const list = Array.isArray(parsed) ? parsed : (parsed.sources ?? []);
      if (!Array.isArray(parsed) && parsed.activeSourceId) {
        this.activeSourceId = parsed.activeSourceId;
      }
      const seenPaths = new Map<string, string>();
      for (const existing of this.sources.values()) {
        seenPaths.set(this.normalizePathKey(existing.path), existing.id);
      }
      if (Array.isArray(list)) {
        for (const item of list) {
          if (!item?.id || !item?.path) continue;
          const pKey = this.normalizePathKey(item.path);
          const dupId = seenPaths.get(pKey);
          if (dupId && dupId !== item.id) {
            if (this.activeSourceId === item.id) {
              this.activeSourceId = dupId;
            }
            continue;
          }
          seenPaths.set(pKey, item.id);
          this.sources.set(item.id, item);
        }
      }
    } catch {
      // 容错读取
    }
  }

  private loadEnvDirs(): void {
    const envDirs = process.env.EVAL_SIM_DATA_DIRS;
    if (!envDirs) return;
    const paths = envDirs
      .split(/[;,]/)
      .map((p) => p.trim())
      .filter(Boolean);
    const now = new Date().toISOString();
    for (let i = 0; i < paths.length; i += 1) {
      const p = paths[i];
      const id = `env_dir_${i + 1}`;
      if (!this.sources.has(id)) {
        this.sources.set(id, {
          id,
          name: `环境变量数据源 ${i + 1}: ${path.basename(p)}`,
          kind: 'csv_dir',
          path: p,
          description: '通过 EVAL_SIM_DATA_DIRS 环境变量配置的数据源目录',
          isBuiltin: false,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const payload = {
        activeSourceId: this.getActiveSourceId(),
        sources: Array.from(this.sources.values()),
      };
      fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch {
      // 容错写入
    }
  }

  resolveRunIdForSource(sourceId: string): string {
    if (sourceId === 'gj11_bvr_real') return 'gj11_pl15_bvr_real';
    if (sourceId === 'bs_frames_sample') return 'bs_sample_swarm_demo';
    return sourceId;
  }

  getActiveSourceId(): string {
    if (this.activeSourceId && this.sources.has(this.activeSourceId)) {
      return this.activeSourceId;
    }
    const taihai = this.sources.get('55th_taihai_csv');
    if (taihai && fs.existsSync(taihai.path)) {
      return '55th_taihai_csv';
    }
    if (this.sources.has('gj11_bvr_real')) return 'gj11_bvr_real';
    return Array.from(this.sources.keys())[0] ?? '';
  }

  setActiveSourceId(id: string): SimulationDataSource {
    const existing = this.sources.get(id);
    if (!existing) {
      throw new Error(`未找到数据源: ${id}`);
    }
    this.activeSourceId = id;
    this.save();
    return existing;
  }

  listAll(knownRunIds?: Set<string>): DataSourceStatus[] {
    const result: DataSourceStatus[] = [];
    for (const src of this.sources.values()) {
      const probe = probeSimulationPath(src.path);
      const canonicalRunId = this.resolveRunIdForSource(src.id);
      const isImported =
        knownRunIds &&
        (knownRunIds.has(canonicalRunId) ||
          knownRunIds.has(src.id) ||
          (probe.timelineId && knownRunIds.has(`csv-${probe.timelineId}`)) ||
          (probe.timelineId && knownRunIds.has(probe.timelineId)));

      result.push({
        source: src,
        accessible: probe.accessible,
        fileCount: probe.fileCount,
        totalSizeBytes: probe.totalSizeBytes,
        scenarioName: probe.scenarioName ?? src.scenarioName,
        timelineId: probe.timelineId,
        tablesFound: probe.tablesFound,
        importedRunId: isImported ? canonicalRunId : undefined,
        error: probe.error,
      });
    }
    return result;
  }

  get(id: string): SimulationDataSource | undefined {
    return this.sources.get(id);
  }

  upsert(source: Omit<SimulationDataSource, 'createdAt' | 'updatedAt'>): SimulationDataSource {
    const now = new Date().toISOString();
    const pKey = this.normalizePathKey(source.path);
    const samePathExisting = Array.from(this.sources.values()).find(
      (s) => this.normalizePathKey(s.path) === pKey,
    );
    const existing = this.sources.get(source.id) ?? samePathExisting;
    const item: SimulationDataSource = {
      ...existing,
      ...source,
      id: existing?.id ?? source.id,
      isBuiltin: existing?.isBuiltin ?? source.isBuiltin,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.sources.set(item.id, item);
    this.save();
    return item;
  }

  delete(id: string): boolean {
    const existing = this.sources.get(id);
    if (!existing) return false;
    if (existing.isBuiltin) {
      throw new Error(`内置测试数据源 [${id}] 受系统保护，禁止直接删除`);
    }
    const res = this.sources.delete(id);
    if (res) this.save();
    return res;
  }
}
