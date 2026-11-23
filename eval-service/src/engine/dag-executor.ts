/**
 * F1 推演评估中台 V4 通用 DAG 执行内核 (DAG Executor)
 *
 * 核心职责：
 * 1. Kahn 拓扑排序与强连通分量（Tarjan SCC）判环 + 悬空边检测
 * 2. 运行时参数端口解析与沿边级联覆盖透传
 * 3. SHA-256 规范 JSON 内容寻址缓存（DagNodeCache）
 * 4. Fail-Closed 缺失状态沿拓扑传播与异步节点调度
 */

import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type {
  DagEdge,
  DagGraphDefinition,
  DagGraphKind,
  DagNodeBase,
  EvidenceRef,
  NodeExecutionCacheEntry,
  OperatorNodeExecutionResult,
  TableDataset,
} from '../core/types.ts';

// ──────────────────── 1. 判环与拓扑排序类型与实现 ────────────────────

export interface CycleDetectionResult {
  hasCycle: boolean;
  cycleNodeIds: string[];
  missingEdgeRefs: string[];
}

function compareAscii(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * 将新就绪节点（inDegree === 0）按字典序降序插入已排序队列，
 * 以便使用 `pop()` O(1) 取出字典序最小的节点 ID。
 */
function insertReadyDesc(queueDesc: string[], nodeId: string): void {
  let lo = 0;
  let hi = queueDesc.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    // 队列按降序排列：寻找第一个 <= nodeId 的位置
    if (compareAscii(queueDesc[mid]!, nodeId) > 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  queueDesc.splice(lo, 0, nodeId);
}

/**
 * 使用迭代版 Tarjan SCC 识别有向图中实际参与环路的节点集合（SCC 大小 > 1 或存在自环）。
 */
function findNodesInCycles(
  nodeIds: string[],
  outgoing: Map<string, string[]>,
): string[] {
  let indexCounter = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const tarjanStack: string[] = [];
  const cycleSet = new Set<string>();

  interface Frame {
    nodeId: string;
    neighbors: string[];
    edgeIdx: number;
  }

  for (const startId of nodeIds) {
    if (indices.has(startId)) continue;

    const callStack: Frame[] = [
      { nodeId: startId, neighbors: outgoing.get(startId) ?? [], edgeIdx: 0 },
    ];
    indices.set(startId, indexCounter);
    lowlink.set(startId, indexCounter);
    indexCounter += 1;
    tarjanStack.push(startId);
    onStack.add(startId);

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1]!;
      const u = frame.nodeId;

      if (frame.edgeIdx < frame.neighbors.length) {
        const v = frame.neighbors[frame.edgeIdx]!;
        frame.edgeIdx += 1;

        if (u === v) {
          cycleSet.add(u);
        }

        if (!indices.has(v)) {
          indices.set(v, indexCounter);
          lowlink.set(v, indexCounter);
          indexCounter += 1;
          tarjanStack.push(v);
          onStack.add(v);
          callStack.push({
            nodeId: v,
            neighbors: outgoing.get(v) ?? [],
            edgeIdx: 0,
          });
        } else if (onStack.has(v)) {
          const curLow = lowlink.get(u)!;
          const vIdx = indices.get(v)!;
          if (vIdx < curLow) {
            lowlink.set(u, vIdx);
          }
        }
      } else {
        callStack.pop();
        if (callStack.length > 0) {
          const parent = callStack[callStack.length - 1]!.nodeId;
          const childLow = lowlink.get(u)!;
          if (childLow < lowlink.get(parent)!) {
            lowlink.set(parent, childLow);
          }
        }

        if (lowlink.get(u) === indices.get(u)) {
          const scc: string[] = [];
          while (tarjanStack.length > 0) {
            const w = tarjanStack.pop()!;
            onStack.delete(w);
            scc.push(w);
            if (w === u) break;
          }
          if (scc.length > 1) {
            for (const member of scc) {
              cycleSet.add(member);
            }
          }
        }
      }
    }
  }

  return Array.from(cycleSet).sort(compareAscii);
}

interface KahnAnalysisResult {
  hasCycle: boolean;
  cycleNodeIds: string[];
  missingEdgeRefs: string[];
  duplicateNodeIds: string[];
  sortedOrder: string[];
}

function analyzeGraphTopology<TNode extends Pick<DagNodeBase, 'id'>>(
  nodes: ReadonlyArray<TNode>,
  edges: ReadonlyArray<Pick<DagEdge, 'id' | 'sourceNodeId' | 'targetNodeId'>>,
): KahnAnalysisResult {
  const uniqueNodeIds: string[] = [];
  const nodeIdSet = new Set<string>();
  const duplicateNodeSet = new Set<string>();

  for (const node of nodes) {
    if (nodeIdSet.has(node.id)) {
      duplicateNodeSet.add(node.id);
    } else {
      nodeIdSet.add(node.id);
      uniqueNodeIds.push(node.id);
    }
  }

  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const id of uniqueNodeIds) {
    inDegree.set(id, 0);
    outgoing.set(id, []);
  }

  const missingEdgeRefs: string[] = [];
  for (const edge of edges) {
    const hasSource = nodeIdSet.has(edge.sourceNodeId);
    const hasTarget = nodeIdSet.has(edge.targetNodeId);
    if (!hasSource) {
      missingEdgeRefs.push(`edge:${edge.id}:missing_source:${edge.sourceNodeId}`);
    }
    if (!hasTarget) {
      missingEdgeRefs.push(`edge:${edge.id}:missing_target:${edge.targetNodeId}`);
    }
    if (hasSource && hasTarget) {
      outgoing.get(edge.sourceNodeId)!.push(edge.targetNodeId);
      inDegree.set(edge.targetNodeId, (inDegree.get(edge.targetNodeId) ?? 0) + 1);
    }
  }

  // Kahn 算法：使用字典序确定性队列
  const readyDesc: string[] = [];
  for (const id of uniqueNodeIds) {
    if ((inDegree.get(id) ?? 0) === 0) {
      insertReadyDesc(readyDesc, id);
    }
  }

  const sortedOrder: string[] = [];
  while (readyDesc.length > 0) {
    const current = readyDesc.pop()!;
    sortedOrder.push(current);

    const targets = outgoing.get(current) ?? [];
    for (const nextId of targets) {
      const nextDeg = (inDegree.get(nextId) ?? 0) - 1;
      inDegree.set(nextId, nextDeg);
      if (nextDeg === 0) {
        insertReadyDesc(readyDesc, nextId);
      }
    }
  }

  const hasCycle = sortedOrder.length < uniqueNodeIds.length;
  let cycleNodeIds: string[] = [];
  if (hasCycle) {
    const visited = new Set(sortedOrder);
    const remainingIds = uniqueNodeIds.filter((id) => !visited.has(id));
    cycleNodeIds = findNodesInCycles(remainingIds, outgoing);
  }

  return {
    hasCycle,
    cycleNodeIds,
    missingEdgeRefs,
    duplicateNodeIds: Array.from(duplicateNodeSet).sort(compareAscii),
    sortedOrder,
  };
}

/**
 * 基于 Kahn 算法检测有向环（含自环、双节点环、多节点环）及悬空边引用。
 */
export function detectCycles<TNode extends Pick<DagNodeBase, 'id'>>(
  nodes: ReadonlyArray<TNode>,
  edges: ReadonlyArray<Pick<DagEdge, 'id' | 'sourceNodeId' | 'targetNodeId'>>,
): CycleDetectionResult {
  const analysis = analyzeGraphTopology(nodes, edges);
  return {
    hasCycle: analysis.hasCycle,
    cycleNodeIds: analysis.cycleNodeIds,
    missingEdgeRefs: analysis.missingEdgeRefs,
  };
}

/**
 * 返回确定性的 DAG 拓扑节点 ID 序列；若存在环路、悬空边或重复节点 ID 则抛出异常。
 */
export function topologicalSort<TNode extends Pick<DagNodeBase, 'id'>>(
  nodes: ReadonlyArray<TNode>,
  edges: ReadonlyArray<Pick<DagEdge, 'id' | 'sourceNodeId' | 'targetNodeId'>>,
): string[] {
  const analysis = analyzeGraphTopology(nodes, edges);
  if (analysis.duplicateNodeIds.length > 0) {
    throw new Error(
      `DAG topologicalSort failed: duplicate node ID(s): ${analysis.duplicateNodeIds.join(', ')}`,
    );
  }
  if (analysis.missingEdgeRefs.length > 0) {
    throw new Error(
      `DAG topologicalSort failed: dangling edge reference(s): ${analysis.missingEdgeRefs.join('; ')}`,
    );
  }
  if (analysis.hasCycle) {
    throw new Error(
      `DAG topologicalSort failed: directed cycle detected involving node(s): ${analysis.cycleNodeIds.join(', ')}`,
    );
  }
  return analysis.sortedOrder;
}

// ──────────────────── 2. 参数端口解析与沿边覆盖透传 ────────────────────

export interface ResolveNodeParamsOptions {
  /** 图级默认参数 */
  globalParams?: Record<string, unknown>;
  /** 运行时图级参数覆盖（覆盖 globalParams，仍低于节点自身 params） */
  globalParamOverrides?: Record<string, unknown>;
  /** 沿入边继承的上游指定静态参数（高于 globalParams，低于 node.params） */
  propagatedParams?: Record<string, unknown>;
  /** 全局或沿边透传的共享外部覆盖（高于 node.params，低于节点显式 paramOverridesByNodeId[nodeId]） */
  sharedOverrides?: Record<string, unknown>;
  /** 沿入边透传的上游外部覆盖或上游执行体产出的动态参数（高于 node.params，低于直接指定节点的覆盖） */
  upstreamOverrides?: Record<string, unknown>;
  /** 外部按节点 ID 注入的精确覆盖（例如三库效果层透传给二库/一库节点，最高优先级） */
  paramOverridesByNodeId?: Record<string, Record<string, unknown>>;
}

function assignDefinedEntries(
  target: Record<string, unknown>,
  source: Record<string, unknown> | undefined,
): void {
  if (!source) return;
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      target[key] = value;
    }
  }
}

/**
 * 解析单个节点生效的运行时参数。
 * 优先级（由低到高）：
 * 1) node.parameterPorts[].defaultValue
 * 2) graph.globalParams (+ globalParamOverrides)
 * 3) 沿入边继承的上游指定共享参数 (propagatedParams)
 * 4) node.params
 * 5) 沿入边或共享透传的外部覆盖 (sharedOverrides -> upstreamOverrides)
 * 6) 外部精确覆盖 paramOverridesByNodeId[node.id]
 */
export function resolveNodeRuntimeParams(
  node: Pick<DagNodeBase, 'id' | 'parameterPorts' | 'params'>,
  options: ResolveNodeParamsOptions = {},
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const port of node.parameterPorts ?? []) {
    if (port.key && port.defaultValue !== undefined) {
      resolved[port.key] = port.defaultValue;
    }
  }

  assignDefinedEntries(resolved, options.globalParams);
  assignDefinedEntries(resolved, options.globalParamOverrides);
  assignDefinedEntries(resolved, options.propagatedParams);
  assignDefinedEntries(resolved, node.params);
  assignDefinedEntries(resolved, options.sharedOverrides);
  assignDefinedEntries(resolved, options.upstreamOverrides);
  assignDefinedEntries(resolved, options.paramOverridesByNodeId?.[node.id]);

  return resolved;
}

// ──────────────────── 3. 规范 JSON 序列化与 SHA-256 缓存 ────────────────────

function canonicalizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  const t = typeof value;
  if (t === 'boolean' || t === 'string') {
    return value;
  }
  if (t === 'number') {
    const num = value as number;
    if (!Number.isFinite(num)) return null;
    return Object.is(num, -0) ? 0 : num;
  }
  if (t === 'bigint') {
    return (value as bigint).toString();
  }
  if (t !== 'object') {
    return null;
  }

  const obj = value as object;
  if (seen.has(obj)) {
    throw new Error('Cannot compute canonical JSON for circular object reference');
  }

  if (obj instanceof Date) {
    return Number.isNaN(obj.getTime()) ? null : obj.toISOString();
  }

  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      return obj.map((item) =>
        item === undefined || typeof item === 'function' || typeof item === 'symbol'
          ? null
          : canonicalizeValue(item, seen),
      );
    }

    if (obj instanceof Set) {
      const serializedItems = Array.from(obj.values())
        .map((item) => canonicalJsonStringify(item))
        .sort(compareAscii);
      return { __type: 'Set', values: serializedItems };
    }

    if (obj instanceof Map) {
      const sortedEntries = Array.from(obj.entries())
        .map(([k, v]) => [canonicalJsonStringify(k), canonicalizeValue(v, seen)] as const)
        .sort(([a], [b]) => compareAscii(a, b));
      return { __type: 'Map', entries: sortedEntries };
    }

    const record = obj as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort(compareAscii);
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      const propVal = record[key];
      if (propVal === undefined || typeof propVal === 'function' || typeof propVal === 'symbol') {
        continue;
      }
      out[key] = canonicalizeValue(propVal, seen);
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

/**
 * 确定性规范 JSON 序列化（递归按键字典序排序，忽略 undefined 属性）。
 */
export function canonicalJsonStringify(value: unknown): string {
  const canonical = canonicalizeValue(value, new WeakSet<object>());
  return JSON.stringify(canonical);
}

export interface NodeCacheKeyInput {
  runId: string;
  graphKind: DagGraphKind;
  nodeId: string;
  nodeKind: string;
  nodeDefPayload?: unknown;
  resolvedParams?: Record<string, unknown>;
  upstreamCacheKeys?: Record<string, string> | string[];
}

/**
 * 计算节点内容寻址 SHA-256 缓存键。
 * 对 `{ runId, graphKind, nodeId, nodeKind, nodeDefPayload, resolvedParams, upstreamCacheKeys }`
 * 进行规范 JSON 序列化后取 SHA-256 十六进制摘要。
 */
export function computeNodeCacheKey(input: NodeCacheKeyInput): string {
  const normalizedUpstream = Array.isArray(input.upstreamCacheKeys)
    ? [...input.upstreamCacheKeys].sort(compareAscii)
    : input.upstreamCacheKeys ?? {};

  const payload = {
    runId: input.runId,
    graphKind: input.graphKind,
    nodeId: input.nodeId,
    nodeKind: input.nodeKind,
    nodeDefPayload: input.nodeDefPayload ?? null,
    resolvedParams: input.resolvedParams ?? {},
    upstreamCacheKeys: normalizedUpstream,
  };

  const canonical = canonicalJsonStringify(payload);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * 扩展的节点缓存项（向后完全兼容核心契约 `NodeExecutionCacheEntry`）。
 */
export interface CachedDagNodeEntry extends NodeExecutionCacheEntry {
  value?: number | boolean | null;
  evidenceRefs?: EvidenceRef[];
  details?: Record<string, unknown>;
  propagatedParams?: Record<string, unknown>;
  latencyMs?: number;
}

export interface DagNodeCacheStats {
  hits: number;
  misses: number;
}

/**
 * 节点级内容寻址内存缓存，支持命中/未命中统计。
 */
export class DagNodeCache {
  private readonly store = new Map<string, CachedDagNodeEntry>();
  private hitsCount = 0;
  private missesCount = 0;

  get(cacheKey: string): CachedDagNodeEntry | undefined {
    const entry = this.store.get(cacheKey);
    if (entry !== undefined) {
      this.hitsCount += 1;
      return entry;
    }
    this.missesCount += 1;
    return undefined;
  }

  set(entry: NodeExecutionCacheEntry | CachedDagNodeEntry): this {
    this.store.set(entry.cacheKey, entry);
    return this;
  }

  has(cacheKey: string): boolean {
    return this.store.has(cacheKey);
  }

  delete(cacheKey: string): boolean {
    return this.store.delete(cacheKey);
  }

  clear(): void {
    this.store.clear();
    this.hitsCount = 0;
    this.missesCount = 0;
  }

  size(): number {
    return this.store.size;
  }

  stats(): DagNodeCacheStats {
    return {
      hits: this.hitsCount,
      misses: this.missesCount,
    };
  }
}

// ──────────────────── 4. Fail-Closed 传播与 DAG 异步执行引擎 ────────────────────

export interface DagExecutionNode extends DagNodeBase {
  /** 允许在部分上游节点为 unavailable 时仍执行本节点（默认 false，执行 Fail-Closed 阻断） */
  allowPartialUpstream?: boolean;
}

export interface DagNodeExecutionOutput {
  status: 'valid' | 'degraded' | 'unavailable';
  dataset?: TableDataset;
  value?: number | boolean | null;
  evidenceRefs?: EvidenceRef[];
  missingDataReason?: string;
  details?: Record<string, unknown>;
  /** 可选：向上游之后所有直连下游节点广播的运行期参数 */
  propagatedParams?: Record<string, unknown>;
}

/**
 * 单节点执行结果（兼容一库 `OperatorNodeExecutionResult` 与二/三库标量结果）。
 */
export interface DagNodeExecutionResult extends OperatorNodeExecutionResult {
  value?: number | boolean | null;
  cacheHit: boolean;
  resolvedParams: Record<string, unknown>;
  details?: Record<string, unknown>;
  propagatedParams?: Record<string, unknown>;
}

export interface DagNodeExecutionContext<TNode extends DagNodeBase = DagNodeBase> {
  runId: string;
  graphId: string;
  graphKind: DagGraphKind;
  node: TNode;
  resolvedParams: Record<string, unknown>;
  upstreamResults: Record<string, DagNodeExecutionResult>;
  upstreamEdges: DagEdge[];
  downstreamEdges: DagEdge[];
  cacheKey: string;
}

export interface ExecuteDagGraphOptions<TNode extends DagNodeBase = DagNodeBase> {
  runId: string;
  cache?: DagNodeCache;
  paramOverrides?: Record<string, Record<string, unknown>>;
  globalParamOverrides?: Record<string, unknown>;
  /**
   * 沿边参数传播策略：
   * - `string[]`: 指定的共享参数键名列表，从上游沿边向下游节点继承传播
   * - `true`: 沿边向下游传播上游的外部覆盖及执行返回的 `propagatedParams`
   * - `Record<string, unknown>`: 作为全图共享外部覆盖参数应用到所有节点
   */
  propagateParams?: boolean | string[] | Record<string, unknown>;
  /**
   * 按源节点 ID 指定的沿边传播覆盖（既作用于该节点自身，也沿出边逐级向下游传播）
   */
  upstreamOverrides?: Record<string, Record<string, unknown>>;
  /** 是否允许节点在存在 unavailable 上游时继续执行 executor */
  allowPartialUpstream?: boolean | ((node: TNode) => boolean);
  executor: (ctx: DagNodeExecutionContext<TNode>) => Promise<DagNodeExecutionOutput>;
}

export interface DagGraphExecutionResult {
  graphId: string;
  graphKind: DagGraphKind;
  runId: string;
  topologicalOrder: string[];
  nodeResults: Record<string, DagNodeExecutionResult>;
  cacheHits: number;
  cacheMisses: number;
  totalLatencyMs: number;
}

function isTableDataset(value: unknown): value is TableDataset {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate.columns) && Array.isArray(candidate.rows);
}

function buildNodeDefPayload<TNode extends DagNodeBase>(
  node: TNode,
  incomingEdges: DagEdge[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    // 剔除纯画布 UI 属性及已单独纳入哈希键的字段
    if (
      key === 'id' ||
      key === 'kind' ||
      key === 'position' ||
      key === 'collapsed' ||
      key === 'params'
    ) {
      continue;
    }
    if (value !== undefined) {
      payload[key] = value;
    }
  }

  // 若入边带有局部权重（如三库效果叠加权重）或端口别名，纳入节点定义哈希确保调权即失效重算
  const edgeBindings = incomingEdges
    .filter((edge) => edge.weight !== undefined || edge.targetAlias !== undefined)
    .map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      ...(edge.weight !== undefined ? { weight: edge.weight } : {}),
      ...(edge.targetAlias !== undefined ? { targetAlias: edge.targetAlias } : {}),
    }))
    .sort((a, b) => compareAscii(a.sourceNodeId, b.sourceNodeId) || compareAscii(a.id, b.id));

  if (edgeBindings.length > 0) {
    payload.incomingEdgeBindings = edgeBindings;
  }

  return payload;
}

function isPartialUpstreamAllowed<TNode extends DagNodeBase>(
  node: TNode,
  option: boolean | ((node: TNode) => boolean) | undefined,
): boolean {
  if ((node as DagExecutionNode).allowPartialUpstream === true) {
    return true;
  }
  if (typeof option === 'function') {
    return option(node);
  }
  return option === true;
}

function restoreResultFromCache(
  entry: CachedDagNodeEntry,
  resolvedParams: Record<string, unknown>,
): DagNodeExecutionResult {
  const result: DagNodeExecutionResult = {
    nodeId: entry.nodeId,
    status: entry.status,
    evidenceRefs: entry.evidenceRefs ?? [],
    cacheKey: entry.cacheKey,
    cacheHit: true,
    latencyMs: 0,
    resolvedParams,
  };

  if (isTableDataset(entry.payload)) {
    result.dataset = entry.payload;
    if (entry.value !== undefined) {
      result.value = entry.value;
    }
  } else if (entry.value !== undefined) {
    result.value = entry.value;
  } else {
    result.value = entry.payload;
  }

  if (entry.missingDataReason !== undefined) {
    result.missingDataReason = entry.missingDataReason;
  }
  if (entry.details !== undefined) {
    result.details = entry.details;
  }
  if (entry.propagatedParams !== undefined) {
    result.propagatedParams = entry.propagatedParams;
  }

  return result;
}

/**
 * 执行通用有向无环图（一库算子 DAG / 二库指标 DAG / 三库体系 DAG）。
 */
export async function executeDagGraph<TNode extends DagNodeBase = DagNodeBase>(
  graph: DagGraphDefinition<TNode>,
  options: ExecuteDagGraphOptions<TNode>,
): Promise<DagGraphExecutionResult> {
  const graphStart = performance.now();
  const topologicalOrder = topologicalSort(graph.nodes, graph.edges);

  const nodeById = new Map<string, TNode>();
  for (const node of graph.nodes) {
    nodeById.set(node.id, node);
  }

  const incomingByTarget = new Map<string, DagEdge[]>();
  const outgoingBySource = new Map<string, DagEdge[]>();
  for (const id of topologicalOrder) {
    incomingByTarget.set(id, []);
    outgoingBySource.set(id, []);
  }
  for (const edge of graph.edges) {
    incomingByTarget.get(edge.targetNodeId)?.push(edge);
    outgoingBySource.get(edge.sourceNodeId)?.push(edge);
  }
  for (const list of incomingByTarget.values()) {
    list.sort((a, b) => compareAscii(a.sourceNodeId, b.sourceNodeId) || compareAscii(a.id, b.id));
  }
  for (const list of outgoingBySource.values()) {
    list.sort((a, b) => compareAscii(a.targetNodeId, b.targetNodeId) || compareAscii(a.id, b.id));
  }

  const designatedKeys = Array.isArray(options.propagateParams)
    ? options.propagateParams
    : undefined;
  const propagateOverridesAlongEdges =
    options.propagateParams === true || (designatedKeys !== undefined && designatedKeys.length > 0);
  const sharedOverrides =
    options.propagateParams &&
    typeof options.propagateParams === 'object' &&
    !Array.isArray(options.propagateParams)
      ? options.propagateParams
      : undefined;

  // 记录各节点可供下游继承的参数：静态指定传播参数 vs 外部/动态覆盖
  const nodeOutgoingStaticParams = new Map<string, Record<string, unknown>>();
  const nodeOutgoingOverrides = new Map<string, Record<string, unknown>>();
  const nodeResults: Record<string, DagNodeExecutionResult> = {};

  let cacheHits = 0;
  let cacheMisses = 0;

  for (const nodeId of topologicalOrder) {
    const node = nodeById.get(nodeId)!;
    const upstreamEdges = incomingByTarget.get(nodeId) ?? [];
    const downstreamEdges = outgoingBySource.get(nodeId) ?? [];

    // 1. 收集沿入边继承的参数与覆盖
    const inheritedStaticParams: Record<string, unknown> = {};
    const inheritedOverrides: Record<string, unknown> = {};
    const upstreamResults: Record<string, DagNodeExecutionResult> = {};
    const upstreamCacheKeys: Record<string, string> = {};

    for (const edge of upstreamEdges) {
      const srcId = edge.sourceNodeId;
      const srcRes = nodeResults[srcId];
      if (srcRes) {
        upstreamResults[srcId] = srcRes;
        upstreamCacheKeys[srcId] = srcRes.cacheKey;
      }
      assignDefinedEntries(inheritedStaticParams, nodeOutgoingStaticParams.get(srcId));
      assignDefinedEntries(inheritedOverrides, nodeOutgoingOverrides.get(srcId));
    }
    // 源节点自身的 upstreamOverrides 也作用于自己并继续向下传播
    assignDefinedEntries(inheritedOverrides, options.upstreamOverrides?.[nodeId]);

    const resolvedParams = resolveNodeRuntimeParams(node, {
      globalParams: graph.globalParams,
      globalParamOverrides: options.globalParamOverrides,
      propagatedParams: inheritedStaticParams,
      sharedOverrides,
      upstreamOverrides: inheritedOverrides,
      paramOverridesByNodeId: options.paramOverrides,
    });

    // 计算当前节点向后继传递的静态/外部参数（供后续节点使用）
    const nextOutgoingStatic: Record<string, unknown> = {};
    const nextOutgoingOverrides: Record<string, unknown> = {};
    assignDefinedEntries(nextOutgoingOverrides, inheritedOverrides);
    if (propagateOverridesAlongEdges) {
      const directNodeOverride = options.paramOverrides?.[nodeId];
      if (designatedKeys) {
        for (const key of designatedKeys) {
          if (directNodeOverride && directNodeOverride[key] !== undefined) {
            nextOutgoingOverrides[key] = directNodeOverride[key];
          } else if (inheritedOverrides[key] !== undefined) {
            nextOutgoingOverrides[key] = inheritedOverrides[key];
          } else if (node.params && node.params[key] !== undefined) {
            nextOutgoingStatic[key] = node.params[key];
          } else if (inheritedStaticParams[key] !== undefined) {
            nextOutgoingStatic[key] = inheritedStaticParams[key];
          } else if (options.globalParamOverrides?.[key] !== undefined) {
            nextOutgoingStatic[key] = options.globalParamOverrides[key];
          } else if (graph.globalParams?.[key] !== undefined) {
            nextOutgoingStatic[key] = graph.globalParams[key];
          }
        }
      } else if (options.propagateParams === true) {
        assignDefinedEntries(nextOutgoingOverrides, directNodeOverride);
      }
    }

    // 2. 计算内容寻址缓存键并查询缓存
    const nodeDefPayload = buildNodeDefPayload(node, upstreamEdges);
    const cacheKey = computeNodeCacheKey({
      runId: options.runId,
      graphKind: graph.graphKind,
      nodeId: node.id,
      nodeKind: node.kind,
      nodeDefPayload,
      resolvedParams,
      upstreamCacheKeys,
    });

    const cachedEntry = options.cache?.get(cacheKey);
    if (cachedEntry !== undefined) {
      cacheHits += 1;
      const restored = restoreResultFromCache(cachedEntry, resolvedParams);
      nodeResults[nodeId] = restored;
      assignDefinedEntries(nextOutgoingOverrides, restored.propagatedParams);
      nodeOutgoingStaticParams.set(nodeId, nextOutgoingStatic);
      nodeOutgoingOverrides.set(nodeId, nextOutgoingOverrides);
      continue;
    }

    cacheMisses += 1;

    // 3. Fail-Closed 传播：上游任一必需节点为 unavailable 时直接阻断执行
    const seenUpstreamIds = new Set<string>();
    const failedUpstreamDescriptions: string[] = [];
    for (const edge of upstreamEdges) {
      const srcId = edge.sourceNodeId;
      if (seenUpstreamIds.has(srcId)) continue;
      seenUpstreamIds.add(srcId);
      const srcRes = upstreamResults[srcId];
      if (srcRes && srcRes.status === 'unavailable') {
        failedUpstreamDescriptions.push(
          srcRes.missingDataReason ? `${srcId} (${srcRes.missingDataReason})` : srcId,
        );
      }
    }

    if (
      failedUpstreamDescriptions.length > 0 &&
      !isPartialUpstreamAllowed(node, options.allowPartialUpstream)
    ) {
      const missingDataReason = `Upstream node(s) unavailable: ${failedUpstreamDescriptions.join('; ')}`;
      const failClosedResult: DagNodeExecutionResult = {
        nodeId,
        status: 'unavailable',
        evidenceRefs: [],
        missingDataReason,
        cacheKey,
        cacheHit: false,
        latencyMs: 0,
        resolvedParams,
      };
      nodeResults[nodeId] = failClosedResult;
      options.cache?.set({
        cacheKey,
        graphKind: graph.graphKind,
        nodeId,
        status: 'unavailable',
        payload: null,
        missingDataReason,
        computedAt: new Date().toISOString(),
        evidenceRefs: [],
        latencyMs: 0,
      });
      nodeOutgoingStaticParams.set(nodeId, nextOutgoingStatic);
      nodeOutgoingOverrides.set(nodeId, nextOutgoingOverrides);
      continue;
    }

    // 4. 未命中缓存且上游就绪：异步执行节点算子
    const execStart = performance.now();
    const execOut = await options.executor({
      runId: options.runId,
      graphId: graph.graphId,
      graphKind: graph.graphKind,
      node,
      resolvedParams,
      upstreamResults,
      upstreamEdges,
      downstreamEdges,
      cacheKey,
    });
    const latencyMs = Math.max(0, Math.round((performance.now() - execStart) * 1000) / 1000);

    const nodeResult: DagNodeExecutionResult = {
      nodeId,
      status: execOut.status,
      ...(execOut.dataset !== undefined ? { dataset: execOut.dataset } : {}),
      ...(execOut.value !== undefined ? { value: execOut.value } : {}),
      evidenceRefs: execOut.evidenceRefs ?? [],
      ...(execOut.missingDataReason !== undefined
        ? { missingDataReason: execOut.missingDataReason }
        : {}),
      cacheKey,
      cacheHit: false,
      latencyMs,
      resolvedParams,
      ...(execOut.details !== undefined ? { details: execOut.details } : {}),
      ...(execOut.propagatedParams !== undefined
        ? { propagatedParams: execOut.propagatedParams }
        : {}),
    };

    nodeResults[nodeId] = nodeResult;
    assignDefinedEntries(nextOutgoingOverrides, execOut.propagatedParams);
    nodeOutgoingStaticParams.set(nodeId, nextOutgoingStatic);
    nodeOutgoingOverrides.set(nodeId, nextOutgoingOverrides);

    const cachePayload: TableDataset | number | boolean | null =
      execOut.dataset !== undefined
        ? execOut.dataset
        : execOut.value !== undefined
        ? execOut.value
        : null;

    options.cache?.set({
      cacheKey,
      graphKind: graph.graphKind,
      nodeId,
      status: execOut.status,
      payload: cachePayload,
      ...(execOut.value !== undefined && execOut.dataset !== undefined
        ? { value: execOut.value }
        : {}),
      ...(execOut.missingDataReason !== undefined
        ? { missingDataReason: execOut.missingDataReason }
        : {}),
      computedAt: new Date().toISOString(),
      evidenceRefs: nodeResult.evidenceRefs,
      ...(execOut.details !== undefined ? { details: execOut.details } : {}),
      ...(execOut.propagatedParams !== undefined
        ? { propagatedParams: execOut.propagatedParams }
        : {}),
      latencyMs,
    });
  }

  const totalLatencyMs = Math.max(0, Math.round((performance.now() - graphStart) * 1000) / 1000);

  return {
    graphId: graph.graphId,
    graphKind: graph.graphKind,
    runId: options.runId,
    topologicalOrder,
    nodeResults,
    cacheHits,
    cacheMisses,
    totalLatencyMs,
  };
}
