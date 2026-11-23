/**
 * F1 V4 一库算子统一执行引擎 (V4OperatorRunner)
 *
 * 职责：
 * 1. 基于 `executeDagGraph` 解析 `upstreamOperatorId` 依赖链，组成一库 `operator` DAG；
 * 2. 支持 SHA-256 内容寻址缓存 (`DagNodeCache`) 与运行时参数端口覆盖透传；
 * 3. 在 `csvDir` 或 `inputDfDict` 上执行 Fail-Closed 必需底表检查，缺失直接返回 `status: 'unavailable'`；
 * 4. 通过常驻 `PythonWorkerPool` 执行沙箱科学计算脚本，支持 `prev_output_df` 级联与快速列裁剪加载 (`tableColumns`)。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  DagEdge,
  DagGraphDefinition,
  DagNodeBase,
  EvidenceRef,
  FieldDataType,
  MetricDomainTag,
  MetricMilitaryLevel,
  OperatorCategory,
  OperatorNodeExecutionResult,
  ParameterPortSpec,
  TableDataset,
} from '../../core/types.ts';
import {
  DagNodeCache,
  type DagNodeExecutionOutput,
  canonicalJsonStringify,
  executeDagGraph,
} from '../../engine/dag-executor.ts';
import {
  type PythonTableInput,
  PythonWorkerPool,
  createPythonWorkerPool,
} from '../../engine/python-worker.ts';

export interface V4OperatorSpecLike {
  id: string;
  name: string;
  chapter: number;
  category: OperatorCategory;
  militaryLevel: MetricMilitaryLevel;
  domainTag: MetricDomainTag;
  description: string;
  requiredTables: string[];
  optionalTables?: string[];
  upstreamOperatorId?: string;
  tableColumns?: Record<string, string[]>;
  parameterPorts: ParameterPortSpec[];
  outputColumns:
    | string[]
    | Array<{
        name: string;
        type: FieldDataType;
        description?: string;
      }>;
  pythonCode: string;
}

export type V4OperatorSpecsSource =
  | Map<string, V4OperatorSpecLike>
  | Record<string, V4OperatorSpecLike>
  | ReadonlyArray<V4OperatorSpecLike>;

export interface V4OperatorRunContext {
  runId: string;
  csvDir?: string;
  inputDfDict?: Record<string, PythonTableInput>;
  prevOutputDf?: PythonTableInput | null;
  /** 支持按算子 ID 映射 `{ [operatorId]: params }` 或扁平参数 `{ paramKey: val }` */
  paramOverrides?: Record<string, unknown>;
  /** 显式按算子 ID 注入的参数覆盖 */
  paramOverridesByOperatorId?: Record<string, Record<string, unknown>>;
  globalParams?: Record<string, unknown>;
  cache?: DagNodeCache;
  pythonPool?: PythonWorkerPool;
  timeoutMs?: number;
}

export interface V4OperatorDagRunResult {
  runId: string;
  topologicalOrder: string[];
  results: Record<string, OperatorNodeExecutionResult>;
  cacheHits: number;
  cacheMisses: number;
  totalLatencyMs: number;
}

interface OperatorDagNode extends DagNodeBase {
  operatorId: string;
  specVersionHash: string;
  dataSourceSignature: string;
}

const TABLE_ALIASES: Record<string, string[]> = {
  unitdamaged: ['damage'],
  damage: ['unitdamaged'],
};

function stripCsvExt(name: string): string {
  const trimmed = name.trim();
  return trimmed.toLowerCase().endsWith('.csv') ? trimmed.slice(0, -4) : trimmed;
}

function normTableKey(name: string): string {
  return stripCsvExt(name).toLowerCase();
}

export function toSpecsMap(source: V4OperatorSpecsSource): Map<string, V4OperatorSpecLike> {
  if (source instanceof Map) {
    return new Map(source);
  }
  const map = new Map<string, V4OperatorSpecLike>();
  if (Array.isArray(source)) {
    for (const spec of source) {
      if (spec && spec.id) {
        map.set(spec.id, spec);
      }
    }
    return map;
  }
  for (const [key, spec] of Object.entries(source)) {
    if (spec) {
      map.set(spec.id || key, spec);
    }
  }
  return map;
}

function scanCsvDirectory(csvDir: string): {
  exists: boolean;
  files: Array<{ name: string; lowerName: string; fullPath: string; mtimeMs: number; size: number }>;
} {
  try {
    const stat = fs.statSync(csvDir);
    if (!stat.isDirectory()) {
      return { exists: false, files: [] };
    }
    const entries = fs.readdirSync(csvDir, { withFileTypes: true });
    const files: Array<{
      name: string;
      lowerName: string;
      fullPath: string;
      mtimeMs: number;
      size: number;
    }> = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.csv')) continue;
      const fullPath = path.join(csvDir, entry.name);
      try {
        const fstat = fs.statSync(fullPath);
        files.push({
          name: entry.name,
          lowerName: entry.name.toLowerCase(),
          fullPath,
          mtimeMs: Math.trunc(fstat.mtimeMs),
          size: fstat.size,
        });
      } catch {
        // skip unreadable entry
      }
    }
    return { exists: true, files };
  } catch {
    return { exists: false, files: [] };
  }
}

function resolveCsvFileFromScan(
  files: Array<{ name: string; lowerName: string; fullPath: string; mtimeMs: number; size: number }>,
  tableName: string,
): { name: string; lowerName: string; fullPath: string; mtimeMs: number; size: number } | undefined {
  const baseLower = normTableKey(tableName);
  if (!baseLower) return undefined;
  const candidates = [baseLower, ...(TABLE_ALIASES[baseLower] ?? [])];

  for (const cand of candidates) {
    const exact = `${cand}.csv`;
    const hit = files.find((f) => f.lowerName === exact);
    if (hit) return hit;
  }

  for (const cand of candidates) {
    const suffix = `_${cand}.csv`;
    const matched = files.filter((f) => f.lowerName.endsWith(suffix)).sort((a, b) => a.lowerName.localeCompare(b.lowerName));
    if (matched.length > 0) {
      return matched[matched.length - 1];
    }
  }

  return undefined;
}

function buildInputDfKeySet(inputDfDict?: Record<string, PythonTableInput>): Set<string> {
  const keys = new Set<string>();
  if (!inputDfDict) return keys;
  for (const rawKey of Object.keys(inputDfDict)) {
    const norm = normTableKey(rawKey);
    if (norm) keys.add(norm);
  }
  return keys;
}

function computeSpecVersionHash(spec: V4OperatorSpecLike): string {
  const canonical = canonicalJsonStringify({
    id: spec.id,
    requiredTables: spec.requiredTables,
    optionalTables: spec.optionalTables ?? [],
    upstreamOperatorId: spec.upstreamOperatorId ?? null,
    tableColumns: spec.tableColumns ?? {},
    pythonCode: spec.pythonCode,
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function computeDataSourceSignature(
  spec: V4OperatorSpecLike,
  ctx: V4OperatorRunContext,
  csvScan: ReturnType<typeof scanCsvDirectory>,
): string {
  const relevantTables = new Set<string>([
    ...spec.requiredTables,
    ...(spec.optionalTables ?? []),
  ]);
  const inputSummary: Record<string, unknown> = {};
  if (ctx.inputDfDict) {
    const keys = Object.keys(ctx.inputDfDict).sort();
    for (const k of keys) {
      if (relevantTables.size === 0 || relevantTables.has(stripCsvExt(k)) || relevantTables.has(k)) {
        inputSummary[k] = ctx.inputDfDict[k];
      }
    }
  }

  const csvSummary: Array<{ table: string; file?: string; mtimeMs?: number; size?: number }> = [];
  if (ctx.csvDir) {
    for (const tbl of Array.from(relevantTables).sort()) {
      const matched = resolveCsvFileFromScan(csvScan.files, tbl);
      csvSummary.push(
        matched
          ? { table: tbl, file: matched.name, mtimeMs: matched.mtimeMs, size: matched.size }
          : { table: tbl },
      );
    }
  }

  const canonical = canonicalJsonStringify({
    csvDir: ctx.csvDir ? path.resolve(ctx.csvDir) : null,
    csvExists: ctx.csvDir ? csvScan.exists : null,
    csvSummary,
    inputSummary,
    hasExplicitPrev: ctx.prevOutputDf !== undefined && ctx.prevOutputDf !== null,
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function splitParamOverrides(
  targetIds: string[],
  specsMap: Map<string, V4OperatorSpecLike>,
  ctx: V4OperatorRunContext,
): {
  perNodeOverrides: Record<string, Record<string, unknown>>;
  globalParamOverrides: Record<string, unknown>;
} {
  const perNodeOverrides: Record<string, Record<string, unknown>> = {};
  const globalParamOverrides: Record<string, unknown> = {
    ...(ctx.globalParams ?? {}),
  };

  if (ctx.paramOverrides) {
    for (const [k, v] of Object.entries(ctx.paramOverrides)) {
      if (specsMap.has(k) && v && typeof v === 'object' && !Array.isArray(v)) {
        perNodeOverrides[k] = {
          ...(perNodeOverrides[k] ?? {}),
          ...(v as Record<string, unknown>),
        };
      } else if (v !== undefined) {
        globalParamOverrides[k] = v;
        for (const tid of targetIds) {
          perNodeOverrides[tid] = {
            ...(perNodeOverrides[tid] ?? {}),
            [k]: v,
          };
        }
      }
    }
  }

  if (ctx.paramOverridesByOperatorId) {
    for (const [opId, ov] of Object.entries(ctx.paramOverridesByOperatorId)) {
      if (!ov) continue;
      perNodeOverrides[opId] = {
        ...(perNodeOverrides[opId] ?? {}),
        ...ov,
      };
    }
  }

  return { perNodeOverrides, globalParamOverrides };
}

function buildEvidenceRefs(
  spec: V4OperatorSpecLike,
  ctx: V4OperatorRunContext,
  csvScan: ReturnType<typeof scanCsvDirectory>,
  inputKeySet: Set<string>,
  dataset?: TableDataset,
): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  const allTables = [...spec.requiredTables, ...(spec.optionalTables ?? [])];

  for (const tbl of allTables) {
    const norm = normTableKey(tbl);
    if (inputKeySet.has(norm)) {
      refs.push({
        source: 'csv',
        ref: `memory:${stripCsvExt(tbl)}`,
        scenarioClock: 'FULL_RUN',
        description: `内存表输入 ${stripCsvExt(tbl)}`,
      });
      continue;
    }
    if (ctx.csvDir && csvScan.exists) {
      const matched = resolveCsvFileFromScan(csvScan.files, tbl);
      if (matched) {
        refs.push({
          source: 'csv',
          ref: `CSV:${matched.name}`,
          scenarioClock: 'FULL_RUN',
          description: `推演事件底表 ${matched.name} (${matched.size} bytes)`,
        });
      }
    }
  }

  if (dataset) {
    refs.push({
      source: 'csv',
      ref: `operator:${spec.id}`,
      scenarioClock: 'FULL_RUN',
      description: `算子 ${spec.id} 输出 ${dataset.totalRows ?? dataset.rows.length} 行 × ${dataset.columns.length} 列`,
      snippet: {
        totalRows: dataset.totalRows ?? dataset.rows.length,
        columns: dataset.columns.map((c) => c.name),
      },
    });
  }

  return refs;
}

function computeStandaloneCacheKey(operatorId: string, runId: string, detail: string): string {
  return crypto
    .createHash('sha256')
    .update(canonicalJsonStringify({ operatorId, runId, detail }), 'utf8')
    .digest('hex');
}

export async function runV4OperatorDag(
  targetIds: string[],
  allSpecsSource: V4OperatorSpecsSource,
  ctx: V4OperatorRunContext,
): Promise<V4OperatorDagRunResult> {
  const specsMap = toSpecsMap(allSpecsSource);
  const csvScan = ctx.csvDir ? scanCsvDirectory(ctx.csvDir) : { exists: false, files: [] };
  const inputKeySet = buildInputDfKeySet(ctx.inputDfDict);

  // 1. 校验目标算子存在性并收集依赖闭合子图（沿 upstreamOperatorId 回溯）
  const unknownTargetResults: Record<string, OperatorNodeExecutionResult> = {};
  const subgraphSpecIds = new Set<string>();
  const visitingQueue: string[] = [];

  for (const tid of targetIds) {
    if (!specsMap.has(tid)) {
      unknownTargetResults[tid] = {
        nodeId: tid,
        status: 'unavailable',
        evidenceRefs: [],
        missingDataReason: `未找到算子定义: ${tid}`,
        cacheKey: computeStandaloneCacheKey(tid, ctx.runId, 'unknown_operator'),
        latencyMs: 0,
      };
    } else if (!subgraphSpecIds.has(tid)) {
      subgraphSpecIds.add(tid);
      visitingQueue.push(tid);
    }
  }

  const missingUpstreamByTarget = new Map<string, string>();
  const useExplicitPrevForTargets =
    ctx.prevOutputDf !== undefined && ctx.prevOutputDf !== null && targetIds.length === 1;

  while (visitingQueue.length > 0) {
    const curId = visitingQueue.shift()!;
    const spec = specsMap.get(curId)!;
    const upId = spec.upstreamOperatorId;
    if (!upId) continue;

    // 若调用方显式传入 prevOutputDf 给单目标算子，允许独立直跑而不强求执行上游
    if (useExplicitPrevForTargets && targetIds.includes(curId)) {
      continue;
    }

    if (!specsMap.has(upId)) {
      missingUpstreamByTarget.set(curId, upId);
      continue;
    }
    if (!subgraphSpecIds.has(upId)) {
      subgraphSpecIds.add(upId);
      visitingQueue.push(upId);
    }
  }

  if (subgraphSpecIds.size === 0) {
    return {
      runId: ctx.runId,
      topologicalOrder: [],
      results: unknownTargetResults,
      cacheHits: 0,
      cacheMisses: 0,
      totalLatencyMs: 0,
    };
  }

  const nodes: OperatorDagNode[] = [];
  const edges: DagEdge[] = [];

  for (const opId of subgraphSpecIds) {
    const spec = specsMap.get(opId)!;
    nodes.push({
      id: spec.id,
      kind: 'python_operator',
      label: spec.name,
      position: { x: 0, y: 0 },
      parameterPorts: spec.parameterPorts,
      operatorId: spec.id,
      specVersionHash: computeSpecVersionHash(spec),
      dataSourceSignature: computeDataSourceSignature(spec, ctx, csvScan),
    });

    if (
      spec.upstreamOperatorId &&
      subgraphSpecIds.has(spec.upstreamOperatorId) &&
      !(useExplicitPrevForTargets && targetIds.includes(spec.id))
    ) {
      edges.push({
        id: `edge_${spec.upstreamOperatorId}__${spec.id}`,
        sourceNodeId: spec.upstreamOperatorId,
        targetNodeId: spec.id,
      });
    }
  }

  const graph: DagGraphDefinition<OperatorDagNode> = {
    graphId: `v4_ops_${ctx.runId}`,
    name: 'V4 Operator Execution Subgraph',
    graphKind: 'operator',
    nodes,
    edges,
    globalParams: ctx.globalParams,
  };

  const { perNodeOverrides, globalParamOverrides } = splitParamOverrides(
    targetIds,
    specsMap,
    ctx,
  );

  let ownedPool: PythonWorkerPool | null = null;
  const pool =
    ctx.pythonPool ??
    (() => {
      ownedPool = createPythonWorkerPool({
        timeoutMs: ctx.timeoutMs ?? (ctx.csvDir ? 60_000 : 15_000),
      });
      return ownedPool;
    })();

  try {
    const dagOut = await executeDagGraph<OperatorDagNode>(graph, {
      runId: ctx.runId,
      cache: ctx.cache,
      paramOverrides: perNodeOverrides,
      globalParamOverrides,
      executor: async (nodeCtx): Promise<DagNodeExecutionOutput> => {
        const spec = specsMap.get(nodeCtx.node.id)!;

        // Fail-Closed: 上游算子声明缺失
        const missingUp = missingUpstreamByTarget.get(spec.id);
        if (missingUp) {
          return {
            status: 'unavailable',
            evidenceRefs: [],
            missingDataReason: `缺少上游依赖算子定义: ${missingUp}`,
          };
        }

        // Fail-Closed: 检查 csvDir 是否有效及 requiredTables 是否齐备
        if (ctx.csvDir && !csvScan.exists) {
          const unresolved = spec.requiredTables.filter(
            (tbl) => !inputKeySet.has(normTableKey(tbl)),
          );
          if (unresolved.length > 0 || spec.requiredTables.length === 0) {
            return {
              status: 'unavailable',
              evidenceRefs: [],
              missingDataReason:
                unresolved.length > 0
                  ? `缺少必需推演事件底表（CSV 目录不存在: ${ctx.csvDir}）: ${unresolved.join(', ')}`
                  : `推演事件 CSV 目录不存在: ${ctx.csvDir}`,
            };
          }
        }

        const missingTables: string[] = [];
        for (const reqTable of spec.requiredTables) {
          const norm = normTableKey(reqTable);
          if (inputKeySet.has(norm)) continue;
          if (ctx.csvDir && csvScan.exists && resolveCsvFileFromScan(csvScan.files, reqTable)) {
            continue;
          }
          missingTables.push(stripCsvExt(reqTable));
        }

        if (missingTables.length > 0) {
          return {
            status: 'unavailable',
            evidenceRefs: [],
            missingDataReason: `缺少必需推演事件底表: ${missingTables.join(', ')}`,
          };
        }

        let prevOutput: PythonTableInput | null = null;
        if (
          spec.upstreamOperatorId &&
          nodeCtx.upstreamResults[spec.upstreamOperatorId]?.dataset
        ) {
          prevOutput = nodeCtx.upstreamResults[spec.upstreamOperatorId]!.dataset!;
        } else if (useExplicitPrevForTargets && targetIds.includes(spec.id)) {
          prevOutput = ctx.prevOutputDf ?? null;
        }

        const execRes = await pool.execute({
          code: spec.pythonCode,
          csvDir: ctx.csvDir,
          requiredTables: spec.requiredTables,
          optionalTables: spec.optionalTables,
          tableColumns: spec.tableColumns,
          inputDfDict: ctx.inputDfDict,
          prevOutputDf: prevOutput,
          params: nodeCtx.resolvedParams,
          timeoutMs: ctx.timeoutMs ?? (ctx.csvDir ? 60_000 : undefined),
        });

        if (!execRes.success || !execRes.dataset) {
          const reason =
            execRes.missingTables && execRes.missingTables.length > 0
              ? `缺少必需推演事件底表: ${execRes.missingTables.join(', ')}`
              : execRes.error ?? 'Python 算子执行失败';
          return {
            status: 'unavailable',
            evidenceRefs: [],
            missingDataReason: reason,
          };
        }

        return {
          status: 'valid',
          dataset: execRes.dataset,
          evidenceRefs: buildEvidenceRefs(
            spec,
            ctx,
            csvScan,
            inputKeySet,
            execRes.dataset,
          ),
        };
      },
    });

    const results: Record<string, OperatorNodeExecutionResult> = {
      ...unknownTargetResults,
    };
    for (const [nodeId, nodeRes] of Object.entries(dagOut.nodeResults)) {
      results[nodeId] = {
        nodeId: nodeRes.nodeId,
        status: nodeRes.status,
        ...(nodeRes.dataset !== undefined ? { dataset: nodeRes.dataset } : {}),
        evidenceRefs: nodeRes.evidenceRefs,
        ...(nodeRes.missingDataReason !== undefined
          ? { missingDataReason: nodeRes.missingDataReason }
          : {}),
        cacheKey: nodeRes.cacheKey,
        latencyMs: nodeRes.latencyMs,
      };
    }

    return {
      runId: dagOut.runId,
      topologicalOrder: dagOut.topologicalOrder,
      results,
      cacheHits: dagOut.cacheHits,
      cacheMisses: dagOut.cacheMisses,
      totalLatencyMs: dagOut.totalLatencyMs,
    };
  } finally {
    if (ownedPool) {
      await ownedPool.dispose();
    }
  }
}

export async function runV4Operator(
  specOrId: V4OperatorSpecLike | string,
  allSpecsSource: V4OperatorSpecsSource,
  ctx: V4OperatorRunContext,
): Promise<OperatorNodeExecutionResult> {
  const specsMap = toSpecsMap(allSpecsSource);
  let targetId: string;
  if (typeof specOrId === 'string') {
    targetId = specOrId;
  } else {
    targetId = specOrId.id;
    if (!specsMap.has(specOrId.id)) {
      specsMap.set(specOrId.id, specOrId);
    }
  }

  const dagResult = await runV4OperatorDag([targetId], specsMap, ctx);
  return (
    dagResult.results[targetId] ?? {
      nodeId: targetId,
      status: 'unavailable',
      evidenceRefs: [],
      missingDataReason: `算子 ${targetId} 未产出执行结果`,
      cacheKey: computeStandaloneCacheKey(targetId, ctx.runId, 'missing_result'),
      latencyMs: 0,
    }
  );
}

export class V4OperatorRunner {
  private readonly specsMap: Map<string, V4OperatorSpecLike>;
  private readonly defaultCache?: DagNodeCache;
  private readonly externalPool?: PythonWorkerPool;
  private ownedPool: PythonWorkerPool | null = null;

  constructor(
    specs: V4OperatorSpecsSource = [],
    options: { cache?: DagNodeCache; pythonPool?: PythonWorkerPool } = {},
  ) {
    this.specsMap = toSpecsMap(specs);
    this.defaultCache = options.cache;
    this.externalPool = options.pythonPool;
  }

  public listSpecs(): V4OperatorSpecLike[] {
    return Array.from(this.specsMap.values());
  }

  public getSpec(operatorId: string): V4OperatorSpecLike | undefined {
    return this.specsMap.get(operatorId);
  }

  public registerSpecs(specs: V4OperatorSpecsSource): this {
    for (const [k, v] of toSpecsMap(specs)) {
      this.specsMap.set(k, v);
    }
    return this;
  }

  private getOrCreatePool(timeoutMs?: number): PythonWorkerPool {
    if (this.externalPool) return this.externalPool;
    if (!this.ownedPool || this.ownedPool.getStats().disposed) {
      this.ownedPool = createPythonWorkerPool({
        timeoutMs: timeoutMs ?? 30_000,
      });
    }
    return this.ownedPool;
  }

  public async runOperator(
    operatorIdOrSpec: string | V4OperatorSpecLike,
    ctx: V4OperatorRunContext,
  ): Promise<OperatorNodeExecutionResult> {
    const pool = ctx.pythonPool ?? this.getOrCreatePool(ctx.timeoutMs);
    const cache = ctx.cache ?? this.defaultCache;
    return runV4Operator(operatorIdOrSpec, this.specsMap, {
      ...ctx,
      cache,
      pythonPool: pool,
    });
  }

  public async runDag(
    targetIds: string[],
    ctx: V4OperatorRunContext,
  ): Promise<V4OperatorDagRunResult> {
    const pool = ctx.pythonPool ?? this.getOrCreatePool(ctx.timeoutMs);
    const cache = ctx.cache ?? this.defaultCache;
    return runV4OperatorDag(targetIds, this.specsMap, {
      ...ctx,
      cache,
      pythonPool: pool,
    });
  }

  public async dispose(): Promise<void> {
    if (this.ownedPool) {
      const pool = this.ownedPool;
      this.ownedPool = null;
      await pool.dispose();
    }
  }
}
