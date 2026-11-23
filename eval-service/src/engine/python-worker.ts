/**
 * F1 V4 常驻 Python 沙箱进程池 (JSON-RPC over stdin/stdout)
 *
 * 核心能力：
 * 1. 懒加载常驻 Python 进程（`python -u python_worker.py`），预加载 pandas/numpy 等科学计算库，消除冷启动；
 * 2. 基于请求 ID 关联 + 单进程 FIFO 串行调度，杜绝并发请求相互串台或因前序超时误杀后续调用；
 * 3. 任务级超时控制（超时代为强杀挂死进程并自动拉起全新进程，调用方 Promise 干净 reject）；
 * 4. 崩溃自动重启（受 maxRestarts 熔断保护，成功执行一次后重置连续崩溃计数）；
 * 5. 干净的 dispose() 生命周期管理，确保关闭全部 stdio 管道与定时器，不阻塞测试/服务进程退出。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { DatasetColumn, FieldDataType, TableDataset } from '../core/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_WORKER_SCRIPT_PATH = path.resolve(__dirname, 'python_worker.py');

export interface PythonWorkerPoolOptions {
  pythonBin?: string;
  workerScriptPath?: string;
  timeoutMs?: number;
  maxRestarts?: number;
}

export type PythonTableInput =
  | TableDataset
  | {
      columns?: Array<DatasetColumn | string>;
      schema?: Array<DatasetColumn | string>;
      rows?: Array<Record<string, unknown>>;
    }
  | Array<Record<string, unknown>>;

export interface PythonExecuteRequest {
  code: string;
  inputDfDict?: Record<string, PythonTableInput>;
  input_df_dict?: Record<string, PythonTableInput>;
  prevOutputDf?: PythonTableInput | null;
  prev_output_df?: PythonTableInput | null;
  params?: Record<string, unknown>;
  timeoutMs?: number;
  csvDir?: string;
  requiredTables?: string[];
  optionalTables?: string[];
  tableColumns?: Record<string, string[]>;
}

export interface PythonExecuteResult {
  success: boolean;
  dataset?: TableDataset;
  logs?: string;
  latencyMs: number;
  error?: string;
  securityBlocked?: boolean;
  missingTables?: string[];
}

export interface PythonPingResult {
  pong: boolean;
  pythonVersion: string;
  pandasVersion: string;
  numpyVersion?: string;
  shapelyAvailable?: boolean;
  pid?: number;
  latencyMs: number;
}

export interface PythonWorkerPoolStats {
  pid: number | null;
  restartCount: number;
  consecutiveRestarts: number;
  activeRequests: number;
  queuedRequests: number;
  disposed: boolean;
}

interface RawWorkerResponse {
  id?: string | number | null;
  ok?: boolean;
  status?: string;
  result?: Record<string, unknown>;
  dataset?: {
    columns?: Array<{ name: string; displayName?: string; type?: string }>;
    rows?: Array<Record<string, unknown>>;
    totalRows?: number;
  };
  logs?: string;
  latencyMs?: number;
  error?: string;
  securityError?: string | null;
  securityBlocked?: boolean;
  missingTables?: string[];
}

interface QueuedTask {
  id: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
  enqueuedAt: number;
  resolve: (resp: RawWorkerResponse) => void;
  reject: (err: Error) => void;
}

interface ActiveTask extends QueuedTask {
  timer: NodeJS.Timeout;
  dispatchedAt: number;
}

const activePools = new Set<PythonWorkerPool>();
let exitHookRegistered = false;

function ensureProcessExitCleanup(): void {
  if (exitHookRegistered) return;
  exitHookRegistered = true;
  process.once('exit', () => {
    for (const pool of activePools) {
      pool.disposeSync();
    }
    activePools.clear();
  });
}

function normalizeDatasetColumns(
  rawCols: Array<{ name: string; displayName?: string; type?: string }> | undefined,
): DatasetColumn[] {
  if (!Array.isArray(rawCols)) return [];
  const validTypes = new Set<FieldDataType>(['number', 'boolean', 'datetime', 'string']);
  return rawCols.map((col) => {
    const typeCandidate = (col.type ?? 'string') as FieldDataType;
    const colType: FieldDataType = validTypes.has(typeCandidate) ? typeCandidate : 'string';
    return {
      name: String(col.name ?? ''),
      displayName: col.displayName ? String(col.displayName) : String(col.name ?? ''),
      type: colType,
    };
  });
}

function toTableDataset(
  rawDataset: RawWorkerResponse['dataset'],
): TableDataset | undefined {
  if (!rawDataset) return undefined;
  const columns = normalizeDatasetColumns(rawDataset.columns);
  const rows = Array.isArray(rawDataset.rows) ? rawDataset.rows : [];
  return {
    columns,
    schema: columns,
    rows,
    totalRows: typeof rawDataset.totalRows === 'number' ? rawDataset.totalRows : rows.length,
  };
}

export class PythonWorkerPool {
  private readonly pythonBin: string;
  private readonly workerScriptPath: string;
  private readonly defaultTimeoutMs: number;
  private readonly maxRestarts: number;

  private child: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private activeTask: ActiveTask | null = null;
  private waitingQueue: QueuedTask[] = [];
  private nextRequestSeq = 1;
  private restartCount = 0;
  private consecutiveRestarts = 0;
  private restartLimitExceeded = false;
  private disposed = false;
  private stderrTail = '';

  constructor(options: PythonWorkerPoolOptions = {}) {
    this.pythonBin = options.pythonBin ?? process.env.PYTHON_BIN ?? 'python';
    this.workerScriptPath = options.workerScriptPath ?? DEFAULT_WORKER_SCRIPT_PATH;
    this.defaultTimeoutMs = options.timeoutMs ?? 15_000;
    this.maxRestarts = options.maxRestarts ?? 5;
    ensureProcessExitCleanup();
    activePools.add(this);
  }

  public getStats(): PythonWorkerPoolStats {
    return {
      pid: this.child && this.child.exitCode === null && !this.child.killed ? (this.child.pid ?? null) : null,
      restartCount: this.restartCount,
      consecutiveRestarts: this.consecutiveRestarts,
      activeRequests: this.activeTask ? 1 : 0,
      queuedRequests: this.waitingQueue.length,
      disposed: this.disposed,
    };
  }

  public async ping(timeoutMs?: number): Promise<PythonPingResult> {
    const started = performance.now();
    const resp = await this.sendRpc({ method: 'ping' }, timeoutMs ?? this.defaultTimeoutMs);
    if (!resp.ok || !resp.result) {
      throw new Error(resp.error ?? 'Python worker ping failed');
    }
    const r = resp.result;
    return {
      pong: Boolean(r.pong),
      pythonVersion: String(r.pythonVersion ?? ''),
      pandasVersion: String(r.pandasVersion ?? ''),
      numpyVersion: r.numpyVersion !== undefined ? String(r.numpyVersion) : undefined,
      shapelyAvailable: r.shapelyAvailable !== undefined ? Boolean(r.shapelyAvailable) : undefined,
      pid: typeof r.pid === 'number' ? r.pid : undefined,
      latencyMs: Number((performance.now() - started).toFixed(2)),
    };
  }

  public async execute(req: PythonExecuteRequest): Promise<PythonExecuteResult> {
    const started = performance.now();
    const inputDfDict = req.inputDfDict ?? req.input_df_dict ?? {};
    const prevOutputDf =
      req.prevOutputDf !== undefined ? req.prevOutputDf : (req.prev_output_df ?? null);
    const params = req.params ?? {};

    const rpcPayload: Record<string, unknown> = {
      method: 'execute',
      code: req.code,
      input_df_dict: inputDfDict,
      prev_output_df: prevOutputDf,
      params,
    };
    if (req.csvDir !== undefined) {
      rpcPayload.csv_dir = req.csvDir;
    }
    if (req.requiredTables !== undefined) {
      rpcPayload.required_tables = req.requiredTables;
    }
    if (req.optionalTables !== undefined) {
      rpcPayload.optional_tables = req.optionalTables;
    }
    if (req.tableColumns !== undefined) {
      rpcPayload.table_columns = req.tableColumns;
    }

    const resp = await this.sendRpc(rpcPayload, req.timeoutMs ?? this.defaultTimeoutMs);

    const latencyMs = Number((performance.now() - started).toFixed(2));
    if (resp.ok) {
      return {
        success: true,
        dataset: toTableDataset(resp.dataset),
        logs: resp.logs ?? '',
        latencyMs,
      };
    }

    return {
      success: false,
      logs: resp.logs ?? '',
      latencyMs,
      error: resp.error ?? resp.securityError ?? 'Python execution failed',
      securityBlocked: Boolean(resp.securityBlocked),
      ...(Array.isArray(resp.missingTables) ? { missingTables: resp.missingTables } : {}),
    };
  }

  public disposeSync(): void {
    if (this.disposed) return;
    this.disposed = true;
    activePools.delete(this);

    const disposeErr = new Error('PythonWorkerPool has been disposed');
    if (this.activeTask) {
      clearTimeout(this.activeTask.timer);
      const task = this.activeTask;
      this.activeTask = null;
      task.reject(disposeErr);
    }

    while (this.waitingQueue.length > 0) {
      const queued = this.waitingQueue.shift()!;
      queued.reject(disposeErr);
    }

    const proc = this.child;
    this.teardownStreams();
    this.child = null;

    if (proc) {
      try {
        proc.removeAllListeners();
        proc.kill();
        proc.unref();
      } catch {
        // ignore kill error on already exited child
      }
    }
  }

  public async dispose(): Promise<void> {
    const proc = this.child;
    const alreadyExited = !proc || proc.exitCode !== null || proc.killed;

    let waitExit: Promise<void> | null = null;
    if (proc && !alreadyExited) {
      waitExit = new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(fallbackTimer);
          resolve();
        };
        const fallbackTimer = setTimeout(finish, 400);
        fallbackTimer.unref();
        proc.once('close', finish);
      });
    }

    this.disposeSync();

    if (waitExit) {
      await waitExit;
    }
  }

  private sendRpc(
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<RawWorkerResponse> {
    if (this.disposed) {
      return Promise.reject(new Error('PythonWorkerPool has been disposed'));
    }

    const id = `py_${this.nextRequestSeq++}`;
    return new Promise<RawWorkerResponse>((resolve, reject) => {
      this.waitingQueue.push({
        id,
        payload,
        timeoutMs,
        enqueuedAt: performance.now(),
        resolve,
        reject,
      });
      this.pumpQueue();
    });
  }

  private pumpQueue(): void {
    if (this.disposed || this.activeTask || this.waitingQueue.length === 0) {
      return;
    }

    try {
      this.ensureWorker();
    } catch (err) {
      const failure = err instanceof Error ? err : new Error(String(err));
      while (this.waitingQueue.length > 0) {
        this.waitingQueue.shift()!.reject(failure);
      }
      return;
    }

    const proc = this.child;
    if (!proc || !proc.stdin || !proc.stdin.writable) {
      return;
    }

    const task = this.waitingQueue.shift()!;
    const timer = setTimeout(() => {
      this.handleTaskTimeout(task.id, task.timeoutMs);
    }, task.timeoutMs);

    this.activeTask = {
      ...task,
      timer,
      dispatchedAt: performance.now(),
    };

    const line = JSON.stringify({ id: task.id, ...task.payload }) + '\n';
    try {
      proc.stdin.write(line, 'utf-8');
    } catch (err) {
      if (this.activeTask?.id === task.id) {
        clearTimeout(this.activeTask.timer);
        this.activeTask = null;
      }
      const writeErr = err instanceof Error ? err : new Error(String(err));
      task.reject(writeErr);
      this.pumpQueue();
    }
  }

  private ensureWorker(): void {
    if (this.disposed) {
      throw new Error('PythonWorkerPool has been disposed');
    }
    if (this.restartLimitExceeded) {
      throw new Error(`Python worker exceeded maxRestarts (${this.maxRestarts})`);
    }
    if (this.child && !this.child.killed && this.child.exitCode === null) {
      return;
    }
    this.spawnWorker();
  }

  private spawnWorker(): void {
    if (this.disposed) return;

    this.teardownStreams();
    this.stderrTail = '';

    const proc = spawn(this.pythonBin, ['-u', this.workerScriptPath], {
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = proc;

    let handledExit = false;

    if (proc.stderr) {
      proc.stderr.on('data', (chunk: Buffer) => {
        if (this.child !== proc) return;
        this.stderrTail = (this.stderrTail + chunk.toString('utf-8')).slice(-4096);
      });
    }

    if (proc.stdout) {
      const rl = readline.createInterface({
        input: proc.stdout,
        crlfDelay: Infinity,
      });
      this.rl = rl;
      rl.on('line', (line: string) => {
        if (this.child !== proc) return;
        this.handleStdoutLine(line);
      });
    }

    proc.on('error', (err: Error) => {
      if (this.child !== proc || handledExit) return;
      handledExit = true;
      this.handleWorkerDeath(proc, `Python worker spawn error: ${err.message}`, true);
    });

    proc.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (this.child !== proc || handledExit) return;
      handledExit = true;
      const stderrInfo = this.stderrTail.trim();
      const detail = stderrInfo
        ? `Python worker exited unexpectedly (code=${code}, signal=${signal}): ${stderrInfo}`
        : `Python worker exited unexpectedly (code=${code}, signal=${signal})`;
      this.handleWorkerDeath(proc, detail, false);
    });
  }

  private handleStdoutLine(rawLine: string): void {
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    let parsed: RawWorkerResponse;
    try {
      parsed = JSON.parse(trimmed) as RawWorkerResponse;
    } catch {
      return;
    }

    const active = this.activeTask;
    if (!active) return;

    if (parsed.id !== undefined && parsed.id !== null && String(parsed.id) !== active.id) {
      return;
    }

    clearTimeout(active.timer);
    this.activeTask = null;
    this.consecutiveRestarts = 0;
    this.restartLimitExceeded = false;
    active.resolve(parsed);
    this.pumpQueue();
  }

  private handleTaskTimeout(taskId: string, timeoutMs: number): void {
    const active = this.activeTask;
    if (!active || active.id !== taskId) return;

    this.activeTask = null;
    const staleProc = this.child;
    this.teardownStreams();
    this.child = null;

    if (staleProc) {
      try {
        staleProc.removeAllListeners();
        staleProc.kill();
        staleProc.unref();
      } catch {
        // ignore
      }
    }

    active.reject(new Error(`Python worker execution timed out after ${timeoutMs}ms`));

    if (!this.disposed) {
      if (this.consecutiveRestarts < this.maxRestarts) {
        this.consecutiveRestarts += 1;
        this.restartCount += 1;
        this.spawnWorker();
        this.pumpQueue();
      } else {
        this.restartLimitExceeded = true;
        const limitErr = new Error(
          `Python worker exceeded maxRestarts (${this.maxRestarts}) after timeout`,
        );
        while (this.waitingQueue.length > 0) {
          this.waitingQueue.shift()!.reject(limitErr);
        }
      }
    }
  }

  private handleWorkerDeath(proc: ChildProcess, reason: string, isSpawnError: boolean): void {
    if (this.child === proc) {
      this.teardownStreams();
      this.child = null;
    }

    const deathErr = new Error(reason);
    if (this.activeTask) {
      clearTimeout(this.activeTask.timer);
      const active = this.activeTask;
      this.activeTask = null;
      active.reject(deathErr);
    }

    if (this.disposed) {
      while (this.waitingQueue.length > 0) {
        this.waitingQueue.shift()!.reject(deathErr);
      }
      return;
    }

    if (isSpawnError || this.consecutiveRestarts >= this.maxRestarts) {
      this.restartLimitExceeded = true;
      const exhaustedErr = isSpawnError
        ? deathErr
        : new Error(`${reason}; maxRestarts (${this.maxRestarts}) exhausted`);
      while (this.waitingQueue.length > 0) {
        this.waitingQueue.shift()!.reject(exhaustedErr);
      }
      return;
    }

    this.consecutiveRestarts += 1;
    this.restartCount += 1;
    if (this.waitingQueue.length > 0) {
      this.spawnWorker();
      this.pumpQueue();
    }
  }

  private teardownStreams(): void {
    if (this.rl) {
      try {
        this.rl.removeAllListeners();
        this.rl.close();
      } catch {
        // ignore
      }
      this.rl = null;
    }
    const proc = this.child;
    if (proc) {
      try {
        if (proc.stdin && !proc.stdin.destroyed) proc.stdin.destroy();
        if (proc.stdout && !proc.stdout.destroyed) proc.stdout.destroy();
        if (proc.stderr && !proc.stderr.destroyed) proc.stderr.destroy();
      } catch {
        // ignore
      }
    }
  }
}

let defaultPool: PythonWorkerPool | null = null;

export function createPythonWorkerPool(
  options?: PythonWorkerPoolOptions,
): PythonWorkerPool {
  return new PythonWorkerPool(options);
}

export function getDefaultPythonWorkerPool(
  options?: PythonWorkerPoolOptions,
): PythonWorkerPool {
  if (!defaultPool || defaultPool.getStats().disposed) {
    defaultPool = new PythonWorkerPool(options);
  }
  return defaultPool;
}

export async function executePythonScript(
  req: PythonExecuteRequest,
): Promise<PythonExecuteResult> {
  return getDefaultPythonWorkerPool().execute(req);
}

export async function disposeDefaultPythonWorkerPool(): Promise<void> {
  if (defaultPool) {
    const pool = defaultPool;
    defaultPool = null;
    await pool.dispose();
  }
}
