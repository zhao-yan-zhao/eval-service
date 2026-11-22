import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { TABLE_SAMPLE_DATASETS } from './table-sample-catalog.ts';

export interface InconsistencyDiagnosis {
  pairIndices: [number, number];
  pairNames: [string, string];
  currentRatio: number;
  suggestedRatio: number;
  maxDeviation: number;
  recommendation: string;
}

export interface AhpResult {
  weights: number[];
  namedWeights: Record<string, number> | null;
  lambdaMax: number;
  ci: number;
  ri: number;
  cr: number;
  consistent: boolean;
  inconsistencyDiagnosis?: InconsistencyDiagnosis | null;
}

export interface EntropyWeightResult {
  weights: number[];
  namedWeights: Record<string, number> | null;
  entropies: number[];
  note?: string;
}

export interface CriticWeightResult {
  weights: number[];
  namedWeights: Record<string, number> | null;
  stdDevs: number[];
  conflictScores: number[];
  note?: string;
}

export interface CombinedWeightResult {
  weights: number[];
  namedWeights: Record<string, number> | null;
  alphaUsed: number;
  subjectiveUsed: number[];
  objectiveUsed: number[];
}

export interface TopsisRankItem {
  rank: number;
  name: string;
  index: number;
  closeness: number;
  dPlus: number;
  dMinus: number;
  dimensionAttribution?: Record<string, number>;
}

export interface TopsisResult {
  ranking: TopsisRankItem[];
  weightsUsed: number[];
  idealBest: number[];
  idealWorst: number[];
  llmEvaluationContext?: {
    bestAlternative: string;
    secondAlternative: string;
    scoreGap: number;
    summary: string;
  };
}

export interface VikorRankItem {
  rank: number;
  name: string;
  index: number;
  S: number;
  R: number;
  Q: number;
}

export interface VikorResult {
  ranking: VikorRankItem[];
  vParameter: number;
  weightsUsed: number[];
  compromiseBest: string;
}

export interface PythonSandboxRunResult {
  status: 'success' | 'error';
  output?: any;
  stdout?: string;
  stderr?: string;
  latencyMs: number;
}

function resolveScriptPath(): string {
  return path.resolve(import.meta.dirname, '..', '..', 'python', 'mcda_algorithms.py');
}

// ─────────────────────────────────────────────────────────────
// 持久化 Python Worker 守护进程池 (Zero-Cold-Start Daemon)
// ─────────────────────────────────────────────────────────────
class PythonDaemonClient {
  private child: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private pendingRequests = new Map<
    number,
    {
      resolve: (data: any) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private nextRequestId = 1;
  private isSpawning = false;

  private ensureProcess(): void {
    if (this.child && !this.child.killed && this.child.exitCode === null) {
      return;
    }
    if (this.isSpawning) return;
    this.isSpawning = true;

    try {
      const scriptPath = resolveScriptPath();
      this.child = spawn('python', ['-X', 'utf8', scriptPath, '--daemon'], {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // 允许主进程在无未决任务时自然退出，不被后台守护进程挂死
      this.child.unref();
      if (this.child.stdin && typeof (this.child.stdin as any).unref === 'function') {
        (this.child.stdin as any).unref();
      }
      if (this.child.stdout && typeof (this.child.stdout as any).unref === 'function') {
        (this.child.stdout as any).unref();
      }
      if (this.child.stderr && typeof (this.child.stderr as any).unref === 'function') {
        (this.child.stderr as any).unref();
      }

      if (this.child.stdout) {
        this.rl = readline.createInterface({ input: this.child.stdout });
        this.rl.on('line', (line: string) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          try {
            const parsed = JSON.parse(trimmed);
            const reqId = parsed.id;
            if (reqId && this.pendingRequests.has(reqId)) {
              const pending = this.pendingRequests.get(reqId)!;
              this.pendingRequests.delete(reqId);
              clearTimeout(pending.timer);
              if (parsed.ok) {
                pending.resolve(parsed.data);
              } else {
                pending.reject(new Error(parsed.error || 'Python daemon computation error'));
              }
            }
          } catch (err) {
            // ignore non-json log lines
          }
        });
      }

      this.child.on('error', (err) => {
        this.cleanup(new Error(`Python daemon process error: ${err.message}`));
      });

      this.child.on('close', (code) => {
        this.cleanup(new Error(`Python daemon closed unexpectedly with code ${code}`));
      });
    } finally {
      this.isSpawning = false;
    }
  }

  private cleanup(err: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingRequests.clear();
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        // ignore
      }
      this.child = null;
    }
  }

  public shutdown(): void {
    this.cleanup(new Error('Python daemon explicitly shut down'));
  }

  public async call<T>(payload: Record<string, unknown>, timeoutMs = 8000): Promise<T> {
    this.ensureProcess();
    if (!this.child || !this.child.stdin || !this.child.stdin.writable) {
      throw new Error('Python daemon stdin is not writable');
    }

    const id = this.nextRequestId++;
    const message = JSON.stringify({ id, ...payload }) + '\n';

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Python daemon call timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      try {
        this.child!.stdin!.write(message, 'utf-8');
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}

const daemonClient = new PythonDaemonClient();

process.once('beforeExit', () => {
  daemonClient.shutdown();
});
process.once('exit', () => {
  daemonClient.shutdown();
});

export function shutdownPythonMcdaDaemon(): void {
  daemonClient.shutdown();
}

/**
 * 兜底单次命令行调用 (One-Shot Fallback)
 */
async function runPythonMcdaOneShot<T>(payload: Record<string, unknown>): Promise<T> {
  const scriptPath = resolveScriptPath();
  return new Promise<T>((resolve, reject) => {
    const child = spawn('python', ['-X', 'utf8', scriptPath], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const stderr = Buffer.concat(stderrChunks).toString('utf-8');
      if (code !== 0) {
        reject(new Error(`mcda_algorithms.py exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as T);
      } catch (err) {
        reject(new Error(`Invalid JSON from mcda_algorithms.py: ${String(err)} | ${stdout}`));
      }
    });

    child.stdin.write(JSON.stringify(payload), 'utf-8');
    child.stdin.end();
  });
}

/**
 * 统一执行入口：优先使用守护进程加速，若异常自动回退至单次执行
 */
async function runPythonMcda<T>(payload: Record<string, unknown>): Promise<T> {
  try {
    return await daemonClient.call<T>(payload);
  } catch {
    // 降级回退
    return await runPythonMcdaOneShot<T>(payload);
  }
}

export async function computeAhpWeights(
  matrix: number[][],
  names?: string[],
): Promise<AhpResult> {
  return runPythonMcda<AhpResult>({ action: 'ahp', matrix, names });
}

export async function computeEntropyWeights(
  matrix: number[][],
  directions?: Array<'smaller_is_better' | 'larger_is_better'>,
  criterionNames?: string[],
): Promise<EntropyWeightResult> {
  return runPythonMcda<EntropyWeightResult>({
    action: 'entropy',
    matrix,
    directions,
    criterionNames,
  });
}

export async function computeCriticWeights(
  matrix: number[][],
  directions?: Array<'smaller_is_better' | 'larger_is_better'>,
  criterionNames?: string[],
): Promise<CriticWeightResult> {
  return runPythonMcda<CriticWeightResult>({
    action: 'critic',
    matrix,
    directions,
    criterionNames,
  });
}

export async function computeCombinedWeights(params: {
  subjectiveWeights: number[];
  objectiveWeights: number[];
  alpha?: number;
  criterionNames?: string[];
}): Promise<CombinedWeightResult> {
  return runPythonMcda<CombinedWeightResult>({
    action: 'combined',
    ...params,
  });
}

export async function computeTopsisRank(params: {
  matrix: number[][];
  weights?: number[];
  directions?: Array<'smaller_is_better' | 'larger_is_better'>;
  alternatives?: string[];
  customIdealBest?: number[];
  customIdealWorst?: number[];
}): Promise<TopsisResult> {
  return runPythonMcda<TopsisResult>({ action: 'topsis', ...params });
}

export async function computeVikorRank(params: {
  matrix: number[][];
  weights?: number[];
  directions?: Array<'smaller_is_better' | 'larger_is_better'>;
  alternatives?: string[];
  v?: number;
}): Promise<VikorResult> {
  return runPythonMcda<VikorResult>({ action: 'vikor', ...params });
}

let cachedDefaultSampleTables: Record<string, any[]> | null = null;

function getDefaultSampleTables(): Record<string, any[]> {
  if (!cachedDefaultSampleTables) {
    const out: Record<string, any[]> = {};
    for (const [k, ds] of Object.entries(TABLE_SAMPLE_DATASETS)) {
      if (ds && Array.isArray(ds.rows)) {
        out[k] = ds.rows;
      }
    }
    cachedDefaultSampleTables = out;
  }
  return cachedDefaultSampleTables;
}

export async function runPythonSandboxScript(params: {
  script: string;
  context?: Record<string, unknown>;
  timeout?: number;
}): Promise<PythonSandboxRunResult> {
  const ctx: Record<string, unknown> = { ...(params.context ?? {}) };
  const usesDataFrameContract =
    params.script.includes('input_df_dict') ||
    params.script.includes('prev_output_df') ||
    params.script.includes('output_df');

  if (usesDataFrameContract) {
    const explicitTables =
      ctx.tables && typeof ctx.tables === 'object' && !Array.isArray(ctx.tables)
        ? (ctx.tables as Record<string, unknown>)
        : {};
    ctx.tables = {
      ...getDefaultSampleTables(),
      ...explicitTables,
    };
  }

  return runPythonMcda<PythonSandboxRunResult>({
    action: 'run_script',
    script: params.script,
    context: ctx,
    timeout: params.timeout ?? 5.0,
  });
}
