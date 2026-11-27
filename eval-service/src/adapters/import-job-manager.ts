import fs from 'node:fs';
import path from 'node:path';
import { locateCsvDirectory } from './csv-adapter.ts';
import {
  DEFAULT_SIMULATIONS_DIR,
  ensureSimulationsDir,
  resolvePhysicalPath,
  type DataSourceStore,
} from './data-source-store.ts';
import { buildSituationModel } from '../core/situation-model.ts';
import type { EvalSqliteStore, ImportJobRecord } from './sqlite-store.ts';

export interface ImportJobProgressView extends ImportJobRecord {
  percent: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
}

export type JobBroadcastFn = (event: string, payload: unknown) => void;

const CHUNK_EVENT_BATCH_SIZE = 2000;

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export class ImportJobManager {
  private readonly getSqliteStore: () => EvalSqliteStore;
  private readonly dataSourceStore: DataSourceStore;
  private readonly broadcast: JobBroadcastFn;
  private readonly activeAborts = new Map<string, { controller: AbortController; reason?: 'pause' | 'cancel' }>();
  private readonly runtimeMetrics = new Map<string, { startedAtMs: number; startBytes: number; lastSpeedBps: number }>();

  constructor(options: {
    getSqliteStore: () => EvalSqliteStore;
    dataSourceStore: DataSourceStore;
    broadcast: JobBroadcastFn;
  }) {
    this.getSqliteStore = options.getSqliteStore;
    this.dataSourceStore = options.dataSourceStore;
    this.broadcast = options.broadcast;
  }

  private enrichView(job: ImportJobRecord): ImportJobProgressView {
    const percent =
      job.totalBytes > 0
        ? Math.min(100, Math.round((job.processedBytes / job.totalBytes) * 1000) / 10)
        : job.totalFiles > 0
          ? Math.min(100, Math.round((job.processedFiles / job.totalFiles) * 1000) / 10)
          : job.status === 'completed'
            ? 100
            : 0;

    const rt = this.runtimeMetrics.get(job.jobId);
    let speedBytesPerSec = rt?.lastSpeedBps ?? 0;
    if (job.status === 'running' && rt) {
      const elapsedSec = Math.max(0.2, (Date.now() - rt.startedAtMs) / 1000);
      const deltaBytes = Math.max(0, job.processedBytes - rt.startBytes);
      speedBytesPerSec = Math.round(deltaBytes / elapsedSec);
      rt.lastSpeedBps = speedBytesPerSec;
    }

    const remainingBytes = Math.max(0, job.totalBytes - job.processedBytes);
    const etaSeconds =
      job.status === 'running' && speedBytesPerSec > 0 && remainingBytes > 0
        ? Math.ceil(remainingBytes / speedBytesPerSec)
        : null;

    return {
      ...job,
      percent: job.status === 'completed' ? 100 : percent,
      speedBytesPerSec,
      etaSeconds,
    };
  }

  listJobs(limit = 30): ImportJobProgressView[] {
    return this.getSqliteStore()
      .listImportJobs(limit)
      .map((j) => this.enrichView(j));
  }

  getJob(jobId: string): ImportJobProgressView | null {
    const j = this.getSqliteStore().getImportJob(jobId);
    return j ? this.enrichView(j) : null;
  }

  pauseJob(jobId: string): ImportJobProgressView | null {
    const store = this.getSqliteStore();
    const existing = store.getImportJob(jobId);
    if (!existing) return null;

    const active = this.activeAborts.get(jobId);
    if (active) {
      active.reason = 'pause';
      active.controller.abort();
      return this.enrichView({ ...existing, status: 'paused', updatedAt: new Date().toISOString() });
    }
    if (existing.status === 'running') {
      existing.status = 'paused';
      existing.updatedAt = new Date().toISOString();
      store.upsertImportJob(existing);
    }
    return this.enrichView(existing);
  }

  deleteJob(jobId: string): boolean {
    const active = this.activeAborts.get(jobId);
    if (active) {
      active.reason = 'cancel';
      active.controller.abort();
      this.activeAborts.delete(jobId);
    }
    this.runtimeMetrics.delete(jobId);
    const ok = this.getSqliteStore().deleteImportJob(jobId);
    this.broadcast('data_source_job_removed', { jobId });
    return ok;
  }

  private emitProgress(job: ImportJobRecord): void {
    const view = this.enrichView(job);
    this.broadcast('data_source_job_progress', view);
  }

  async startArchiveJob(sourceId: string, resumeJobId?: string): Promise<ImportJobProgressView> {
    const ds = this.dataSourceStore.get(sourceId);
    if (!ds) throw new Error(`未找到数据源: ${sourceId}`);

    const resolvedPath = resolvePhysicalPath(ds.path, ds.id);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`数据源路径不存在或不可访问: ${resolvedPath}`);
    }

    const store = this.getSqliteStore();
    // 检查是否已有正在运行的任务
    const runningSame = store
      .listImportJobs(20)
      .find((j) => j.sourceId === sourceId && j.jobType === 'archive' && j.status === 'running');
    if (runningSame && this.activeAborts.has(runningSame.jobId)) {
      return this.enrichView(runningSame);
    }

    ensureSimulationsDir();
    const now = new Date().toISOString();
    let job: ImportJobRecord | null = resumeJobId ? store.getImportJob(resumeJobId) : null;

    // 收集文件列表
    const fileItems: Array<{ name: string; srcPath: string; size: number }> = [];
    let targetDir = '';
    if (ds.kind === 'csv_dir') {
      const csvDir = locateCsvDirectory(resolvedPath);
      const files = fs.readdirSync(csvDir).filter((f) => f.toLowerCase().endsWith('.csv'));
      if (files.length === 0) {
        throw new Error(`目录内未找到任何 .csv 文件: ${csvDir}`);
      }
      targetDir = path.join(DEFAULT_SIMULATIONS_DIR, ds.id);
      fs.mkdirSync(targetDir, { recursive: true });
      for (const f of files) {
        const full = path.join(csvDir, f);
        const st = fs.statSync(full);
        fileItems.push({ name: f, srcPath: full, size: st.size });
      }
    } else {
      const st = fs.statSync(resolvedPath);
      const fileName = `${ds.id}.jsonl`;
      targetDir = DEFAULT_SIMULATIONS_DIR;
      fileItems.push({ name: fileName, srcPath: resolvedPath, size: st.size });
    }

    const totalBytes = fileItems.reduce((sum, f) => sum + f.size, 0);

    if (!job || job.sourceId !== sourceId || job.jobType !== 'archive') {
      job = {
        jobId: `job_arch_${ds.id}_${Date.now().toString(36)}`,
        sourceId: ds.id,
        sourceName: ds.name,
        jobType: 'archive',
        status: 'running',
        totalFiles: fileItems.length,
        processedFiles: 0,
        totalBytes,
        processedBytes: 0,
        completedFiles: [],
        createdAt: now,
        updatedAt: now,
      };
    } else {
      job = {
        ...job,
        status: 'running',
        totalFiles: fileItems.length,
        totalBytes,
        error: undefined,
        updatedAt: now,
      };
    }

    store.upsertImportJob(job);
    const controller = new AbortController();
    const abortEntry = { controller, reason: undefined as 'pause' | 'cancel' | undefined };
    this.activeAborts.set(job.jobId, abortEntry);
    this.runtimeMetrics.set(job.jobId, {
      startedAtMs: Date.now(),
      startBytes: job.processedBytes,
      lastSpeedBps: 0,
    });
    this.emitProgress(job);

    // 后台异步流式拷贝
    void (async () => {
      try {
        const completedSet = new Set(job.completedFiles);
        let processedFiles = 0;
        let processedBytes = 0;
        for (const item of fileItems) {
          if (completedSet.has(item.name)) {
            processedFiles += 1;
            processedBytes += item.size;
          }
        }
        job.processedFiles = processedFiles;
        job.processedBytes = processedBytes;

        for (const item of fileItems) {
          if (controller.signal.aborted) {
            break;
          }
          if (completedSet.has(item.name)) {
            continue;
          }

          job.currentFile = item.name;
          job.updatedAt = new Date().toISOString();
          store.upsertImportJob(job);
          this.emitProgress(job);

          const destPath = path.join(targetDir, item.name);
          const tmpPath = `${destPath}.part`;

          await this.copyFileStreamWithAbort(item.srcPath, tmpPath, controller.signal, (chunkBytes) => {
            // 实时节流更新字节进度
            job!.processedBytes = processedBytes + chunkBytes;
            this.emitProgress(job!);
          });

          if (controller.signal.aborted) {
            try {
              if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
            } catch {
              // ignore
            }
            break;
          }

          if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          fs.renameSync(tmpPath, destPath);

          completedSet.add(item.name);
          processedFiles += 1;
          processedBytes += item.size;
          job.completedFiles = Array.from(completedSet);
          job.processedFiles = processedFiles;
          job.processedBytes = processedBytes;
          job.updatedAt = new Date().toISOString();
          store.upsertImportJob(job);
          this.emitProgress(job);

          await yieldEventLoop();
        }

        if (controller.signal.aborted) {
          if (abortEntry.reason === 'pause') {
            job.status = 'paused';
            job.error = '已由用户暂停，保留断点检查点';
          } else {
            job.status = 'cancelled';
            job.error = '任务已取消';
          }
          job.updatedAt = new Date().toISOString();
          store.upsertImportJob(job);
          this.emitProgress(job);
          return;
        }

        // 全部复制完成，自动将数据源路径更新为专用目录相对路径
        const finalTarget = ds.kind === 'csv_dir' ? targetDir : path.join(targetDir, `${ds.id}.jsonl`);
        this.dataSourceStore.relocateSourcePath(ds.id, finalTarget);

        job.status = 'completed';
        job.currentFile = undefined;
        job.processedFiles = fileItems.length;
        job.processedBytes = totalBytes;
        job.updatedAt = new Date().toISOString();
        store.upsertImportJob(job);
        this.emitProgress(job);
      } catch (err) {
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
        job.updatedAt = new Date().toISOString();
        store.upsertImportJob(job);
        this.emitProgress(job);
      } finally {
        this.activeAborts.delete(job.jobId);
      }
    })();

    return this.enrichView(job);
  }

  private copyFileStreamWithAbort(
    src: string,
    dest: string,
    signal: AbortSignal,
    onBytes: (copiedBytes: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const rs = fs.createReadStream(src, { highWaterMark: 256 * 1024 });
      const ws = fs.createWriteStream(dest);
      let copied = 0;
      let lastEmitAt = 0;

      const onAbort = () => {
        rs.destroy();
        ws.destroy();
        resolve();
      };
      signal.addEventListener('abort', onAbort, { once: true });

      rs.on('data', (chunk) => {
        copied += chunk.length;
        const now = Date.now();
        if (now - lastEmitAt > 250) {
          lastEmitAt = now;
          onBytes(copied);
        }
      });

      rs.on('error', (err) => {
        signal.removeEventListener('abort', onAbort);
        ws.destroy();
        reject(err);
      });

      ws.on('error', (err) => {
        signal.removeEventListener('abort', onAbort);
        rs.destroy();
        reject(err);
      });

      ws.on('finish', () => {
        signal.removeEventListener('abort', onAbort);
        onBytes(copied);
        resolve();
      });

      rs.pipe(ws);
    });
  }

  async startSqliteImportJob(sourceId: string, resumeJobId?: string): Promise<ImportJobProgressView> {
    const ds = this.dataSourceStore.get(sourceId);
    if (!ds) throw new Error(`未找到数据源: ${sourceId}`);

    const resolvedPath = resolvePhysicalPath(ds.path, ds.id);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`数据源路径不存在或不可访问: ${resolvedPath}`);
    }

    const store = this.getSqliteStore();
    const runningSame = store
      .listImportJobs(20)
      .find((j) => j.sourceId === sourceId && j.jobType === 'sqlite_import' && j.status === 'running');
    if (runningSame && this.activeAborts.has(runningSame.jobId)) {
      return this.enrichView(runningSame);
    }

    const now = new Date().toISOString();
    let job: ImportJobRecord | null = resumeJobId ? store.getImportJob(resumeJobId) : null;

    if (!job || job.sourceId !== sourceId || job.jobType !== 'sqlite_import') {
      job = {
        jobId: `job_sql_${ds.id}_${Date.now().toString(36)}`,
        sourceId: ds.id,
        sourceName: ds.name,
        jobType: 'sqlite_import',
        status: 'running',
        totalFiles: 1,
        processedFiles: 0,
        totalBytes: 100,
        processedBytes: 0,
        currentFile: '正在解析仿真态势与事件索引...',
        completedFiles: [],
        totalEventsImported: 0,
        createdAt: now,
        updatedAt: now,
      };
    } else {
      job = {
        ...job,
        status: 'running',
        error: undefined,
        currentFile: '正在从断点恢复解析...',
        updatedAt: now,
      };
    }

    store.upsertImportJob(job);
    const controller = new AbortController();
    const abortEntry = { controller, reason: undefined as 'pause' | 'cancel' | undefined };
    this.activeAborts.set(job.jobId, abortEntry);
    this.runtimeMetrics.set(job.jobId, {
      startedAtMs: Date.now(),
      startBytes: job.processedBytes,
      lastSpeedBps: 0,
    });
    this.emitProgress(job);

    void (async () => {
      try {
        const runId = this.dataSourceStore.resolveRunIdForSource(ds.id);
        const situation =
          ds.kind === 'csv_dir'
            ? await buildSituationModel({ runId, csvDir: resolvedPath, scenarioPath: ds.path })
            : await buildSituationModel({ runId, jsonlFile: resolvedPath, scenarioPath: ds.path });
        situation.scenarioName = ds.name || ds.scenarioName || situation.scenarioName;

        if (controller.signal.aborted) {
          job!.status = abortEntry.reason === 'pause' ? 'paused' : 'cancelled';
          job!.updatedAt = new Date().toISOString();
          store.upsertImportJob(job!);
          this.emitProgress(job!);
          return;
        }

        const totalEvents = situation.events.length;
        const unitArray = Array.from(situation.units.values());
        const totalBatches = Math.max(1, Math.ceil(totalEvents / CHUNK_EVENT_BATCH_SIZE));
        const completedBatches = new Set(job!.completedFiles);
        const isFresh = completedBatches.size === 0;

        if (isFresh) {
          store.clearSituationRunData(runId);
        }
        store.saveSituationRunMetadata(situation);

        job!.totalFiles = totalBatches + 1; // +1 代表单元轨迹批
        job!.totalBytes = Math.max(1, totalEvents + unitArray.length);
        let processedUnitsDone = completedBatches.has('__units__');
        let processedEventsCount = 0;

        for (let b = 0; b < totalBatches; b += 1) {
          if (completedBatches.has(`batch_${b}`)) {
            processedEventsCount += Math.min(CHUNK_EVENT_BATCH_SIZE, totalEvents - b * CHUNK_EVENT_BATCH_SIZE);
          }
        }
        job!.processedFiles = completedBatches.size;
        job!.processedBytes = processedEventsCount + (processedUnitsDone ? unitArray.length : 0);
        job!.totalEventsImported = processedEventsCount;
        store.upsertImportJob(job!);
        this.emitProgress(job!);

        // 1. 分批写入事件
        for (let b = 0; b < totalBatches; b += 1) {
          if (controller.signal.aborted) break;
          const batchKey = `batch_${b}`;
          if (completedBatches.has(batchKey)) continue;

          const startIdx = b * CHUNK_EVENT_BATCH_SIZE;
          const slice = situation.events.slice(startIdx, startIdx + CHUNK_EVENT_BATCH_SIZE);

          job!.currentFile = `事件批次 ${b + 1}/${totalBatches} (${startIdx + slice.length}/${totalEvents})`;
          store.appendSituationEventsBatch(runId, slice, startIdx + 1);

          completedBatches.add(batchKey);
          processedEventsCount += slice.length;
          job!.completedFiles = Array.from(completedBatches);
          job!.processedFiles = completedBatches.size;
          job!.processedBytes = processedEventsCount + (processedUnitsDone ? unitArray.length : 0);
          job!.totalEventsImported = processedEventsCount;
          job!.updatedAt = new Date().toISOString();
          store.upsertImportJob(job!);
          this.emitProgress(job!);

          await yieldEventLoop();
        }

        // 2. 写入单元轨迹状态
        if (!controller.signal.aborted && !processedUnitsDone) {
          job!.currentFile = `作战单元轨迹 (${unitArray.length} 个单元)`;
          store.appendUnitStatesBatch(runId, unitArray);
          completedBatches.add('__units__');
          processedUnitsDone = true;
          job!.completedFiles = Array.from(completedBatches);
          job!.processedFiles = completedBatches.size;
          job!.processedBytes = processedEventsCount + unitArray.length;
          job!.updatedAt = new Date().toISOString();
          store.upsertImportJob(job!);
          this.emitProgress(job!);
        }

        if (controller.signal.aborted) {
          job!.status = abortEntry.reason === 'pause' ? 'paused' : 'cancelled';
          job!.error = abortEntry.reason === 'pause' ? '已由用户暂停，保留断点检查点' : '任务已取消';
          job!.updatedAt = new Date().toISOString();
          store.upsertImportJob(job!);
          this.emitProgress(job!);
          return;
        }

        job!.status = 'completed';
        job!.currentFile = undefined;
        job!.processedFiles = job!.totalFiles;
        job!.processedBytes = job!.totalBytes;
        job!.updatedAt = new Date().toISOString();
        store.upsertImportJob(job!);
        this.emitProgress(job!);
      } catch (err) {
        job!.status = 'failed';
        job!.error = err instanceof Error ? err.message : String(err);
        job!.updatedAt = new Date().toISOString();
        store.upsertImportJob(job!);
        this.emitProgress(job!);
      } finally {
        this.activeAborts.delete(job!.jobId);
      }
    })();

    return this.enrichView(job);
  }

  async startDeleteRunJob(runId: string, scenarioName?: string): Promise<ImportJobProgressView> {
    const store = this.getSqliteStore();
    const now = new Date().toISOString();
    const job: ImportJobRecord = {
      jobId: `job_del_${runId}_${Date.now().toString(36)}`,
      sourceId: runId,
      sourceName: scenarioName || runId,
      jobType: 'delete_run',
      status: 'running',
      totalFiles: 5,
      processedFiles: 0,
      totalBytes: 5,
      processedBytes: 0,
      currentFile: '准备清理场次数据...',
      completedFiles: [],
      createdAt: now,
      updatedAt: now,
    };
    store.upsertImportJob(job);
    this.emitProgress(job);

    void (async () => {
      try {
        await yieldEventLoop();
        store.deleteRun(runId, (stage, step, totalSteps) => {
          job.currentFile = stage;
          job.totalFiles = totalSteps;
          job.totalBytes = totalSteps;
          job.processedFiles = step;
          job.processedBytes = step;
          job.updatedAt = new Date().toISOString();
          store.upsertImportJob(job);
          this.emitProgress(job);
        });
        job.status = 'completed';
        job.currentFile = '清理完成并已压缩空间';
        job.processedFiles = job.totalFiles;
        job.processedBytes = job.totalBytes;
        job.updatedAt = new Date().toISOString();
        store.upsertImportJob(job);
        this.emitProgress(job);
      } catch (err) {
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
        job.updatedAt = new Date().toISOString();
        store.upsertImportJob(job);
        this.emitProgress(job);
      }
    })();

    return this.enrichView(job);
  }

  async resumeJob(jobId: string): Promise<ImportJobProgressView> {
    const existing = this.getSqliteStore().getImportJob(jobId);
    if (!existing) throw new Error(`未找到任务: ${jobId}`);
    if (existing.jobType === 'archive') {
      return this.startArchiveJob(existing.sourceId, jobId);
    }
    return this.startSqliteImportJob(existing.sourceId, jobId);
  }
}
