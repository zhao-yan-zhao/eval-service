import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import type {
  DagGraphDefinition,
  EffectDefinition,
  EvaluationSystemDag,
  MetricGraphDefinition,
  OperatorNodeExecutionResult,
  TableDataset,
} from '../src/core/types.ts';
import { EffectStore } from '../src/effects/store.ts';
import { DagNodeCache, type DagNodeExecutionResult } from '../src/engine/dag-executor.ts';
import {
  discoverSidesFromOperatorResults,
  handleV4ApiRequest,
  sliceOperatorResultsBySide,
  type V4RouteDeps,
} from '../src/engine/v4-routes.ts';
import {
  MetricGraphStore,
  evaluateMetricGraph,
  type MetricOperatorInput,
} from '../src/indicators/metric-graph-store.ts';
import { SystemDagStore, type StoredEvaluationSystemDag } from '../src/systems/system-dag-store.ts';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

function makeStrikeDataset(rows: Array<Record<string, unknown>>): TableDataset {
  return {
    id: 'ds_strike',
    columns: [
      { name: 'MissionID', type: 'string' },
      { name: 'Side', type: 'string' },
      { name: 'TargetDamage', type: 'number' },
      { name: 'Completed', type: 'number' },
      { name: 'TotalTargets', type: 'number' },
    ],
    rows,
    totalRows: rows.length,
    dimensionKeys: ['MissionID', 'Side'],
    measureKeys: ['TargetDamage', 'Completed', 'TotalTargets'],
  };
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function requestJson<T = Record<string, unknown>>(
  baseUrl: string,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const resp = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await resp.json()) as T;
  return { status: resp.status, data };
}

// ──────────────────── 1. MetricGraphStore 校验与强隔离 ────────────────────

describe('MetricGraphStore validation, strong isolation, and persistence', () => {
  it('persists valid metric graphs, includes builtin demo, and rejects cycles & subjective weights', () => {
    const dir = createTempDir('f1-v4-mg-');
    const storePath = path.join(dir, 'v4-metric-graphs.json');
    const store = new MetricGraphStore(storePath);

    // 内置示范图存在且受删除保护
    const demo = store.get('mg_v4_joint_demo');
    assert.ok(demo);
    assert.equal(demo.builtin, true);
    assert.equal(store.validate(demo).valid, true);
    assert.throws(() => store.delete('mg_v4_joint_demo'), /不允许删除内置预置/);

    // 1) 判环：双节点有向环必须拒绝
    const cyclicGraph: MetricGraphDefinition = {
      graphId: 'mg_cycle_bad',
      name: 'Cycle Graph',
      graphKind: 'metric',
      nodes: [
        {
          id: 'n1',
          kind: 'metric',
          label: 'M1',
          position: { x: 0, y: 0 },
          metricConfig: {
            metricId: 'm1',
            name: 'M1',
            militaryLevel: 'MOP',
            domainTag: 'firepower',
            mode: 'from_metric_agg',
          },
        },
        {
          id: 'n2',
          kind: 'metric',
          label: 'M2',
          position: { x: 200, y: 0 },
          metricConfig: {
            metricId: 'm2',
            name: 'M2',
            militaryLevel: 'MOE',
            domainTag: 'firepower',
            mode: 'from_metric_agg',
          },
        },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2' },
        { id: 'e2', sourceNodeId: 'n2', targetNodeId: 'n1' },
      ],
    };
    const cycleCheck = store.validate(cyclicGraph);
    assert.equal(cycleCheck.valid, false);
    assert.equal(cycleCheck.hasCycle, true);
    assert.throws(() => store.upsert(cyclicGraph), /环路/);

    // 2) 强隔离：连线夹带 weight 必须拒绝
    const weightSmuggledEdgeGraph: MetricGraphDefinition = {
      graphId: 'mg_weight_bad',
      name: 'Weight Smuggled Edge',
      graphKind: 'metric',
      nodes: [
        {
          id: 'n1',
          kind: 'metric',
          label: 'M1',
          position: { x: 0, y: 0 },
          metricConfig: {
            metricId: 'm1',
            name: 'M1',
            militaryLevel: 'MOP',
            domainTag: 'firepower',
            mode: 'from_operator',
            sourceRef: 'op1',
          },
        },
        {
          id: 'n2',
          kind: 'metric',
          label: 'M2',
          position: { x: 200, y: 0 },
          metricConfig: {
            metricId: 'm2',
            name: 'M2',
            militaryLevel: 'MOE',
            domainTag: 'firepower',
            mode: 'from_metric_agg',
          },
        },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n2', weight: 0.6 },
      ],
    };
    const weightEdgeCheck = store.validate(weightSmuggledEdgeGraph);
    assert.equal(weightEdgeCheck.valid, false);
    assert.ok(weightEdgeCheck.errors.some((e) => e.includes('weight')));
    assert.throws(() => store.upsert(weightSmuggledEdgeGraph), /强隔离/);

    // 3) 强隔离：节点夹带 scoringRule 必须拒绝
    const scoringSmuggledNodeGraph: MetricGraphDefinition = {
      graphId: 'mg_scoring_bad',
      name: 'Scoring Smuggled Node',
      graphKind: 'metric',
      nodes: [
        {
          id: 'n1',
          kind: 'metric',
          label: 'M1',
          position: { x: 0, y: 0 },
          params: { scoringRule: { type: 'larger_is_better', worst: 0, optimal: 1 } },
          metricConfig: {
            metricId: 'm1',
            name: 'M1',
            militaryLevel: 'MOP',
            domainTag: 'firepower',
            mode: 'from_operator',
            sourceRef: 'op1',
          },
        },
      ],
      edges: [],
    };
    assert.equal(store.validate(scoringSmuggledNodeGraph).valid, false);

    // 4) 合法指标图持久化并可重加载删除
    const validGraph: MetricGraphDefinition = {
      graphId: 'mg_custom_valid',
      name: 'Valid Custom Metric DAG',
      graphKind: 'metric',
      nodes: [
        {
          id: 'n1',
          kind: 'metric',
          label: 'Op Metric',
          position: { x: 0, y: 0 },
          metricConfig: {
            metricId: 'custom.raw_hit',
            name: 'Raw Hit',
            militaryLevel: 'MOP',
            domainTag: 'firepower',
            mode: 'from_operator',
            sourceRef: 'op.hit',
            targetField: 'Hits',
            reduce: 'sum',
          },
        },
      ],
      edges: [],
    };
    const saved = store.upsert(validGraph);
    assert.equal(saved.graphId, 'mg_custom_valid');

    const reloaded = new MetricGraphStore(storePath);
    assert.ok(reloaded.get('mg_custom_valid'));
    assert.equal(reloaded.delete('mg_custom_valid'), true);
    assert.equal(reloaded.get('mg_custom_valid'), undefined);
  });
});

// ──────────────────── 2. evaluateMetricGraph 多层执行与 Fail-Closed ────────────────────

describe('evaluateMetricGraph multi-layer execution, caching, and Fail-Closed', () => {
  it('executes from_operator -> from_metric_agg -> from_metric_formula and maps metricInputsForSystem', async () => {
    const cache = new DagNodeCache();
    const graph: MetricGraphDefinition = {
      graphId: 'mg_multilayer_test',
      name: 'Multi-layer Metric DAG',
      graphKind: 'metric',
      nodes: [
        {
          id: 'mn_op_red_detail',
          kind: 'metric',
          label: '红方目标毁伤明细 (filter + groupBy)',
          position: { x: 0, y: 0 },
          metricConfig: {
            metricId: 'strike.red_mission_summary',
            name: '红方任务聚合',
            militaryLevel: 'MOP',
            domainTag: 'firepower',
            mode: 'from_operator',
            sourceRef: 'strike.damage_simulation',
            filterCriteria: { Side: '红方' },
            groupBy: ['MissionID'],
            targetField: 'Completed',
            reduce: 'sum',
            unit: 'count',
          },
        },
        {
          id: 'mn_op_red_total',
          kind: 'metric',
          label: '红方总目标数 (scalar reduce)',
          position: { x: 0, y: 160 },
          metricConfig: {
            metricId: 'strike.red_total_targets',
            name: '红方总目标数',
            militaryLevel: 'MOP',
            domainTag: 'firepower',
            mode: 'from_operator',
            sourceRef: 'strike.damage_simulation',
            filterCriteria: { Side: '红方' },
            targetField: 'TotalTargets',
            reduce: 'sum',
            unit: 'count',
          },
        },
        {
          id: 'mn_agg_completed',
          kind: 'metric',
          label: '二次聚合完成总数',
          position: { x: 280, y: 0 },
          metricConfig: {
            metricId: 'strike.red_completed_sum',
            name: '红方完成目标总数',
            militaryLevel: 'MOE',
            domainTag: 'firepower',
            mode: 'from_metric_agg',
            targetField: 'Completed',
            reduce: 'sum',
            unit: 'count',
          },
        },
        {
          id: 'mn_formula_rate',
          kind: 'metric',
          label: '综合完成率 (公式)',
          position: { x: 560, y: 80 },
          metricConfig: {
            metricId: 'strike.red_completion_rate',
            name: '红方突击综合完成率',
            militaryLevel: 'MOFE',
            domainTag: 'firepower',
            mode: 'from_metric_formula',
            formulaExpression: 'completed_cnt / total_cnt',
            unit: 'ratio',
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          sourceNodeId: 'mn_op_red_detail',
          targetNodeId: 'mn_agg_completed',
        },
        {
          id: 'e2',
          sourceNodeId: 'mn_agg_completed',
          targetNodeId: 'mn_formula_rate',
          targetAlias: 'completed_cnt',
        },
        {
          id: 'e3',
          sourceNodeId: 'mn_op_red_total',
          targetNodeId: 'mn_formula_rate',
          targetAlias: 'total_cnt',
        },
      ],
    };

    const dataset = makeStrikeDataset([
      { MissionID: 'M1', Side: '红方', TargetDamage: 0.9, Completed: 1, TotalTargets: 1 },
      { MissionID: 'M1', Side: '红方', TargetDamage: 0.6, Completed: 1, TotalTargets: 1 },
      { MissionID: 'M2', Side: '红方', TargetDamage: 0.2, Completed: 0, TotalTargets: 1 },
      { MissionID: 'M2', Side: '红方', TargetDamage: 0.8, Completed: 1, TotalTargets: 1 },
      { MissionID: 'B1', Side: '蓝方', TargetDamage: 1.0, Completed: 1, TotalTargets: 1 },
    ]);

    const res1 = await evaluateMetricGraph(
      graph,
      {
        'strike.damage_simulation': {
          status: 'valid',
          dataset,
        },
      },
      { runId: 'run_1', cache },
    );

    assert.equal(res1.cacheMisses, 4);
    assert.equal(res1.cacheHits, 0);

    // 验证 groupBy 产出了 2 个任务分组行 (M1: 2, M2: 1)
    const detailNode = res1.nodeResults['mn_op_red_detail'];
    assert.equal(detailNode.status, 'valid');
    assert.equal(detailNode.dataset?.rows.length, 2);
    assert.deepEqual(detailNode.dataset?.dimensionKeys, ['MissionID']);
    assert.equal(
      detailNode.dataset?.rows.find((r) => r.MissionID === 'M1')?.Completed,
      2,
    );

    // 验证 from_metric_agg 输出 scalar value + dataset
    const aggNode = res1.nodeResults['mn_agg_completed'];
    assert.equal(aggNode.status, 'valid');
    assert.equal(aggNode.value, 3);
    assert.ok(aggNode.dataset);

    // 验证 from_metric_formula 3 / 4 = 0.75
    const formulaNode = res1.nodeResults['mn_formula_rate'];
    assert.equal(formulaNode.status, 'valid');
    assert.equal(formulaNode.value, 0.75);

    // metricInputsForSystem 同时支持按 nodeId 和 metricId 索引
    assert.equal(res1.metricInputsForSystem['mn_formula_rate']?.value, 0.75);
    assert.equal(res1.metricInputsForSystem['strike.red_completion_rate']?.value, 0.75);

    // 相同输入二次执行全部命中缓存
    const res2 = await evaluateMetricGraph(
      graph,
      {
        'strike.damage_simulation': {
          status: 'valid',
          dataset,
        },
      },
      { runId: 'run_1', cache },
    );
    assert.equal(res2.cacheHits, 4);
    assert.equal(res2.cacheMisses, 0);

    // 上游数据变化时缓存自动失效并重新计算
    const updatedDataset = makeStrikeDataset([
      { MissionID: 'M1', Side: '红方', TargetDamage: 0.9, Completed: 1, TotalTargets: 1 },
      { MissionID: 'M1', Side: '红方', TargetDamage: 0.9, Completed: 1, TotalTargets: 1 },
    ]);
    const res3 = await evaluateMetricGraph(
      graph,
      {
        'strike.damage_simulation': {
          status: 'valid',
          dataset: updatedDataset,
        },
      },
      { runId: 'run_1', cache },
    );
    assert.equal(res3.cacheMisses, 4);
    assert.equal(res3.nodeResults['mn_formula_rate'].value, 1);
  });

  it('enforces Fail-Closed on zero division and unavailable upstream operators', async () => {
    const graph: MetricGraphDefinition = {
      graphId: 'mg_fail_closed',
      name: 'Fail Closed Test',
      graphKind: 'metric',
      nodes: [
        {
          id: 'n_num',
          kind: 'metric',
          label: 'Numerator',
          position: { x: 0, y: 0 },
          metricConfig: {
            metricId: 'm.num',
            name: 'Num',
            militaryLevel: 'MOP',
            domainTag: 'firepower',
            mode: 'from_operator',
            sourceRef: 'op.num',
          },
        },
        {
          id: 'n_den',
          kind: 'metric',
          label: 'Denominator',
          position: { x: 0, y: 120 },
          metricConfig: {
            metricId: 'm.den',
            name: 'Den',
            militaryLevel: 'MOP',
            domainTag: 'firepower',
            mode: 'from_operator',
            sourceRef: 'op.den',
          },
        },
        {
          id: 'n_div',
          kind: 'metric',
          label: 'Ratio',
          position: { x: 260, y: 60 },
          metricConfig: {
            metricId: 'm.ratio',
            name: 'Ratio',
            militaryLevel: 'MOE',
            domainTag: 'firepower',
            mode: 'from_metric_formula',
            formulaExpression: 'n_num / n_den',
          },
        },
        {
          id: 'n_downstream',
          kind: 'metric',
          label: 'Downstream Agg',
          position: { x: 520, y: 60 },
          metricConfig: {
            metricId: 'm.downstream',
            name: 'Downstream',
            militaryLevel: 'MOFE',
            domainTag: 'firepower',
            mode: 'from_metric_agg',
          },
        },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'n_num', targetNodeId: 'n_div' },
        { id: 'e2', sourceNodeId: 'n_den', targetNodeId: 'n_div' },
        { id: 'e3', sourceNodeId: 'n_div', targetNodeId: 'n_downstream' },
      ],
    };

    // 1) 除零 Fail-Closed 并向 n_downstream 传播
    const zeroDivRes = await evaluateMetricGraph(graph, {
      'op.num': { status: 'valid', value: 10 },
      'op.den': { status: 'valid', value: 0 },
    });
    assert.equal(zeroDivRes.nodeResults['n_div'].status, 'unavailable');
    assert.equal(zeroDivRes.nodeResults['n_div'].value, null);
    assert.ok(zeroDivRes.nodeResults['n_div'].missingDataReason?.includes('0'));
    assert.equal(zeroDivRes.nodeResults['n_downstream'].status, 'unavailable');

    // 2) 上游算子缺失 Fail-Closed
    const missingRes = await evaluateMetricGraph(graph, {
      'op.num': { status: 'valid', value: 10 },
      'op.den': {
        status: 'unavailable',
        missingDataReason: '缺少 WeaponEndgame.csv',
      },
    });
    assert.equal(missingRes.nodeResults['n_den'].status, 'unavailable');
    assert.equal(missingRes.nodeResults['n_div'].status, 'unavailable');
    assert.ok(
      missingRes.nodeResults['n_div'].missingDataReason?.includes('WeaponEndgame.csv'),
    );
    assert.equal(missingRes.nodeResults['n_downstream'].status, 'unavailable');
  });
});

// ──────────────────── 3. SystemDagStore 预设保护与 CRUD ────────────────────

describe('SystemDagStore preset protection and persistence', () => {
  it('loads sys_v4_joint_demo builtin, protects it from deletion, and supports custom CRUD', () => {
    const dir = createTempDir('f1-v4-sys-');
    const effStore = new EffectStore(path.join(dir, 'custom-effects.json'));
    const sysPath = path.join(dir, 'v4-system-dags.json');
    const store = new SystemDagStore(sysPath, effStore);

    const demo = store.get('sys_v4_joint_demo');
    assert.ok(demo);
    assert.equal(demo.builtin, true);
    assert.equal(store.validate(demo).valid, true);
    assert.ok(demo.nodes.some((n) => n.kind === 'metric_proxy'));
    assert.ok(demo.nodes.some((n) => n.kind === 'effect'));
    assert.ok(demo.nodes.some((n) => n.kind === 'gate'));
    assert.throws(() => store.delete('sys_v4_joint_demo'), /不允许删除内置预置/);

    const customDag: EvaluationSystemDag = {
      systemId: 'sys_custom_demo',
      name: 'Custom System DAG',
      version: '1.0.0',
      terminalEffectNodeId: 'ef_top',
      nodes: [
        {
          id: 'px_1',
          kind: 'metric_proxy',
          label: 'Strike Proxy',
          refId: 'strike.composite_mission_metrics',
          position: { x: 0, y: 0 },
        },
        {
          id: 'ef_leaf',
          kind: 'effect',
          label: 'Leaf Effect',
          refId: 'eff_strike_mission',
          position: { x: 250, y: 0 },
        },
        {
          id: 'ef_top',
          kind: 'effect',
          label: 'Terminal Effect',
          position: { x: 500, y: 0 },
          inlineEffect: {
            effectId: 'eff_top_inline',
            name: 'Top',
            role: 'effect',
            aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
          },
        },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'px_1', targetNodeId: 'ef_leaf' },
        { id: 'e2', sourceNodeId: 'ef_leaf', targetNodeId: 'ef_top', weight: 1.0 },
      ],
    };

    const saved = store.upsert(customDag);
    assert.equal(saved.systemId, 'sys_custom_demo');

    const reloaded = new SystemDagStore(sysPath, effStore);
    assert.ok(reloaded.get('sys_custom_demo'));
    assert.equal(reloaded.delete('sys_custom_demo'), true);
    assert.equal(reloaded.get('sys_custom_demo'), undefined);
  });
});

// ──────────────────── 4. /api/v4/* HTTP 全链路与 paramOverrides 透传测试 ────────────────────

describe('V4 HTTP routes end-to-end flow including paramOverrides propagation', () => {
  let server: http.Server;
  let baseUrl = '';
  let operatorCallLog: Array<{ operatorId: string; body: Record<string, unknown> }> = [];

  it('handles all /api/v4/* endpoints and propagates paramOverrides from Effect -> Metric -> mock runOperator', async () => {
    const dir = createTempDir('f1-v4-http-');
    const effectStore = new EffectStore(path.join(dir, 'custom-effects.json'));
    const metricGraphStore = new MetricGraphStore(path.join(dir, 'v4-metric-graphs.json'));
    const systemDagStore = new SystemDagStore(path.join(dir, 'v4-system-dags.json'), effectStore);
    const cache = new DagNodeCache();
    operatorCallLog = [];

    const deps: V4RouteDeps = {
      effectStore,
      metricGraphStore,
      systemDagStore,
      cache,
      listOperators: () => [
        { id: 'strike.damage_simulation', name: '目标毁伤仿真', category: 'effectiveness' },
        { id: 'roe.fratricide_count', name: '友军误伤统计', category: 'compliance' },
      ],
      resolveCsvDir: (runId) => (runId === 'run_with_ds' ? '/mock/csv/dir' : undefined),
      runOperator: async (operatorId, body): Promise<OperatorNodeExecutionResult> => {
        operatorCallLog.push({ operatorId, body });
        const params = (body.params ?? {}) as Record<string, unknown>;

        if (operatorId === 'strike.damage_simulation') {
          const threshold =
            typeof params.damageThreshold === 'number' ? params.damageThreshold : 0.5;
          // 模拟两枚弹药分别造成 0.6 和 0.9 毁伤：
          // 当 threshold=0.5 -> 两目标皆达标 (completionRate = 1.0)
          // 当 threshold=0.8 -> 仅 0.9 达标 (completionRate = 0.5)
          const rows = [
            { TargetID: 'T1', Side: '红方', Damage: 0.6, Achieved: 0.6 >= threshold ? 1 : 0 },
            { TargetID: 'T2', Side: '红方', Damage: 0.9, Achieved: 0.9 >= threshold ? 1 : 0 },
          ];
          return {
            nodeId: operatorId,
            status: 'valid',
            dataset: {
              id: 'ds_damage',
              columns: [
                { name: 'TargetID', type: 'string' },
                { name: 'Side', type: 'string' },
                { name: 'Damage', type: 'number' },
                { name: 'Achieved', type: 'number' },
              ],
              rows,
              totalRows: rows.length,
              dimensionKeys: ['TargetID', 'Side'],
              measureKeys: ['Damage', 'Achieved'],
            },
            evidenceRefs: [
              {
                source: 'csv',
                ref: 'UnitDamaged.csv',
                scenarioClock: '00:12:00',
                description: `按阈值 ${threshold} 计算目标毁伤达成情况`,
              },
            ],
            cacheKey: `mock_${operatorId}_${threshold}`,
            latencyMs: 2,
          };
        }

        if (operatorId === 'roe.fratricide_count') {
          const fratCount = Number(params.mockFratricide ?? 0);
          return {
            nodeId: operatorId,
            status: 'valid',
            dataset: {
              id: 'ds_frat',
              columns: [{ name: 'FratricideCount', type: 'number' }],
              rows: [{ FratricideCount: fratCount }],
              totalRows: 1,
              measureKeys: ['FratricideCount'],
            },
            evidenceRefs: [],
            cacheKey: `mock_frat_${fratCount}`,
            latencyMs: 1,
          };
        }

        return {
          nodeId: operatorId,
          status: 'unavailable',
          evidenceRefs: [],
          missingDataReason: `未注册的测试算子: ${operatorId}`,
          cacheKey: '',
          latencyMs: 0,
        };
      },
    };

    server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);
      const handled = await handleV4ApiRequest(
        req,
        res,
        pathname,
        readJsonBody,
        sendJson,
        deps,
      );
      if (!handled) {
        sendJson(res, 404, { ok: false, error: 'Not Found' });
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // A. 非 v4 路由回退 false -> 404
      const nonV4 = await requestJson(baseUrl, 'GET', '/api/legacy/ping');
      assert.equal(nonV4.status, 404);

      // B. 一库算子列举与执行 (含 resolveCsvDir)
      const opsRes = await requestJson<{ ok: boolean; operators: Array<{ id: string }> }>(
        baseUrl,
        'GET',
        '/api/v4/operators',
      );
      assert.equal(opsRes.status, 200);
      assert.equal(opsRes.data.operators.length, 2);

      const opRunRes = await requestJson<{ ok: boolean; result: OperatorNodeExecutionResult }>(
        baseUrl,
        'POST',
        '/api/v4/operators/run',
        {
          operatorId: 'strike.damage_simulation',
          runId: 'run_with_ds',
          params: { damageThreshold: 0.5 },
        },
      );
      assert.equal(opRunRes.status, 200);
      assert.equal(opRunRes.data.result.status, 'valid');
      assert.equal(operatorCallLog[0].body.csvDir, '/mock/csv/dir');

      // C. 独立效果库 CRUD & 内置保护
      const effectsList = await requestJson<{ ok: boolean; effects: EffectDefinition[] }>(
        baseUrl,
        'GET',
        '/api/v4/effects',
      );
      assert.equal(effectsList.status, 200);
      assert.ok(effectsList.data.effects.some((e) => e.effectId === 'eff_strike_mission'));

      const delBuiltinEff = await requestJson(
        baseUrl,
        'DELETE',
        '/api/v4/effects/eff_strike_mission',
      );
      assert.equal(delBuiltinEff.status, 403);

      const customEffect: EffectDefinition = {
        effectId: 'eff_strict_strike_80',
        name: '高标准突击效果(毁伤>=0.8)',
        domainTag: 'firepower',
        role: 'effect',
        metricBinding: {
          metricId: 'strike.achieved_rate',
          reduce: 'mean',
          paramOverrides: {
            damageThreshold: 0.8,
          },
          scoringRule: {
            type: 'larger_is_better',
            worst: 0.0,
            optimal: 1.0,
          },
        },
        aggregation: {
          strategy: 'weighted_sum',
          missingPolicy: 'skip_renormalize',
        },
      };
      const saveEff = await requestJson<{ ok: boolean; effect: EffectDefinition }>(
        baseUrl,
        'POST',
        '/api/v4/effects',
        customEffect,
      );
      assert.equal(saveEff.status, 200);
      assert.equal(saveEff.data.effect.effectId, 'eff_strict_strike_80');

      // D. 指标 DAG CRUD & 执行
      const customMetricGraph: MetricGraphDefinition = {
        graphId: 'mg_e2e_strike',
        name: '端到端突击指标图',
        graphKind: 'metric',
        nodes: [
          {
            id: 'mn_damage_detail',
            kind: 'metric',
            label: '毁伤明细',
            position: { x: 0, y: 0 },
            metricConfig: {
              metricId: 'strike.damage_detail',
              name: '毁伤明细',
              militaryLevel: 'MOP',
              domainTag: 'firepower',
              mode: 'from_operator',
              sourceRef: 'strike.damage_simulation',
            },
          },
          {
            id: 'mn_achieved_rate',
            kind: 'metric',
            label: '突击达标率',
            position: { x: 260, y: 0 },
            metricConfig: {
              metricId: 'strike.achieved_rate',
              name: '突击达标率',
              militaryLevel: 'MOE',
              domainTag: 'firepower',
              mode: 'from_metric_agg',
              targetField: 'Achieved',
              reduce: 'mean',
            },
          },
          {
            id: 'mn_frat',
            kind: 'metric',
            label: '误伤计数',
            position: { x: 0, y: 160 },
            metricConfig: {
              metricId: 'roe.fratricide_count',
              name: '误伤计数',
              militaryLevel: 'MOP',
              domainTag: 'survivability',
              mode: 'from_operator',
              sourceRef: 'roe.fratricide_count',
              targetField: 'FratricideCount',
              reduce: 'sum',
            },
          },
        ],
        edges: [
          { id: 'me_1', sourceNodeId: 'mn_damage_detail', targetNodeId: 'mn_achieved_rate' },
        ],
      };

      const badMgRes = await requestJson(baseUrl, 'POST', '/api/v4/metric-graphs', {
        ...customMetricGraph,
        edges: [{ id: 'me_bad', sourceNodeId: 'mn_damage_detail', targetNodeId: 'mn_achieved_rate', weight: 0.5 }],
      });
      assert.equal(badMgRes.status, 400);

      const saveMgRes = await requestJson(
        baseUrl,
        'POST',
        '/api/v4/metric-graphs',
        customMetricGraph,
      );
      assert.equal(saveMgRes.status, 200);

      // 直接执行指标 DAG（默认阈值 0.5 -> Achieved = [1, 1] -> mean = 1.0）
      const execMgRes = await requestJson<{
        ok: boolean;
        metricInputsForSystem: Record<string, { value?: number }>;
      }>(baseUrl, 'POST', '/api/v4/metric-graphs/execute', {
        graphId: 'mg_e2e_strike',
        runId: 'run_e2e_1',
      });
      assert.equal(execMgRes.status, 200);
      assert.equal(execMgRes.data.metricInputsForSystem['strike.achieved_rate']?.value, 1);

      // E. 体系 DAG 校验 / 权重自动归一 / 保存 / 全链路评估 (含 paramOverrides 向下透传)
      const unnormalizedSys: EvaluationSystemDag = {
        systemId: 'sys_e2e_strike',
        name: '端到端评估体系',
        version: '1.0.0',
        terminalEffectNodeId: 'ef_terminal',
        nodes: [
          {
            id: 'px_strike',
            kind: 'metric_proxy',
            label: '突击达标率代理',
            refId: 'strike.achieved_rate',
            position: { x: 0, y: 0 },
          },
          {
            id: 'px_frat',
            kind: 'metric_proxy',
            label: '误伤代理',
            refId: 'roe.fratricide_count',
            position: { x: 0, y: 150 },
          },
          {
            id: 'ef_strike',
            kind: 'effect',
            label: '高标准突击效果',
            refId: 'eff_strict_strike_80',
            position: { x: 260, y: 0 },
          },
          {
            id: 'gt_frat',
            kind: 'gate',
            label: '误伤硬门控',
            refId: 'gate_fratricide_zero',
            position: { x: 260, y: 150 },
          },
          {
            id: 'ef_terminal',
            kind: 'effect',
            label: '终态效能',
            position: { x: 520, y: 0 },
            inlineEffect: {
              effectId: 'eff_e2e_term',
              name: '终态效能',
              role: 'effect',
              aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
            },
          },
        ],
        edges: [
          { id: 'se_1', sourceNodeId: 'px_strike', targetNodeId: 'ef_strike' },
          { id: 'se_2', sourceNodeId: 'px_frat', targetNodeId: 'gt_frat' },
          // 故意给未归一化权重 3.0，测试 normalizeWeights: true
          { id: 'se_3', sourceNodeId: 'ef_strike', targetNodeId: 'ef_terminal', weight: 3 },
        ],
      };

      const valRaw = await requestJson<{ ok: boolean; valid: boolean }>(
        baseUrl,
        'POST',
        '/api/v4/system-dags/validate',
        { system: unnormalizedSys },
      );
      assert.equal(valRaw.status, 200);
      assert.equal(valRaw.data.valid, false);

      const valNorm = await requestJson<{
        ok: boolean;
        valid: boolean;
        normalizedSystem: EvaluationSystemDag;
      }>(baseUrl, 'POST', '/api/v4/system-dags/validate', {
        system: unnormalizedSys,
        normalizeWeights: true,
      });
      assert.equal(valNorm.status, 200);
      assert.equal(valNorm.data.valid, true);
      assert.equal(valNorm.data.normalizedSystem.edges[2].weight, 1);

      const saveSys = await requestJson(baseUrl, 'POST', '/api/v4/system-dags', {
        system: unnormalizedSys,
        normalizeWeights: true,
      });
      assert.equal(saveSys.status, 200);

      // 关键验证：全链路评估时，ef_strike 绑定 eff_strict_strike_80 (damageThreshold=0.8)
      // 经由 strike.achieved_rate 反向透传至上游 strike.damage_simulation，使完成率由 1.0 变为 0.5 (50 分)！
      operatorCallLog = [];
      const evalRes = await requestJson<{
        ok: boolean;
        overallScore: number | null;
        rawOverallScore: number | null;
        gateVerdict: string;
        resolvedParamOverrides: Record<string, Record<string, unknown>>;
        metricGraphResult: { nodeResults: Record<string, { value?: number }> };
        operatorResults: Record<string, OperatorNodeExecutionResult>;
      }>(baseUrl, 'POST', '/api/v4/system-dags/evaluate', {
        systemId: 'sys_e2e_strike',
        metricGraphId: 'mg_e2e_strike',
        runId: 'run_e2e_override',
      });
      assert.equal(evalRes.status, 200);
      assert.equal(evalRes.data.resolvedParamOverrides['strike.achieved_rate']?.damageThreshold, 0.8);

      const strikeCall = operatorCallLog.find(
        (c) => c.operatorId === 'strike.damage_simulation',
      );
      assert.ok(strikeCall);
      assert.equal(
        (strikeCall.body.params as Record<string, unknown>).damageThreshold,
        0.8,
      );
      assert.equal(
        evalRes.data.metricGraphResult.nodeResults['mn_achieved_rate'].value,
        0.5,
      );
      assert.equal(evalRes.data.overallScore, 50);
      assert.equal(evalRes.data.gateVerdict, 'PASS');
      assert.ok(evalRes.data.operatorResults['strike.damage_simulation']?.dataset);

      // Hard GATE 违例封顶 <= 39 分验证
      const evalViolated = await requestJson<{
        ok: boolean;
        overallScore: number | null;
        rawOverallScore: number | null;
        gateVerdict: string;
      }>(baseUrl, 'POST', '/api/v4/system-dags/evaluate', {
        systemId: 'sys_e2e_strike',
        metricGraphId: 'mg_e2e_strike',
        runId: 'run_e2e_gate_violated',
        params: { mockFratricide: 1 },
      });
      assert.equal(evalViolated.status, 200);
      assert.equal(evalViolated.data.gateVerdict, 'DISQUALIFIED');
      assert.equal(evalViolated.data.rawOverallScore, 50);
      assert.equal(evalViolated.data.overallScore, 39);

      // 删除自定义资源 & 验证内置系统受保护
      const delBuiltinSys = await requestJson(
        baseUrl,
        'DELETE',
        '/api/v4/system-dags/sys_v4_joint_demo',
      );
      assert.equal(delBuiltinSys.status, 403);

      const delCustomSys = await requestJson(
        baseUrl,
        'DELETE',
        '/api/v4/system-dags/sys_e2e_strike',
      );
      assert.equal(delCustomSys.status, 200);

      const delCustomMg = await requestJson(
        baseUrl,
        'DELETE',
        '/api/v4/metric-graphs/mg_e2e_strike',
      );
      assert.equal(delCustomMg.status, 200);

      const delCustomEff = await requestJson(
        baseUrl,
        'DELETE',
        '/api/v4/effects/eff_strict_strike_80',
      );
      assert.equal(delCustomEff.status, 200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

// ──────────────────── 5. sliceOperatorResultsBySide 共享阵营切片单元测试 ────────────────────

describe('sliceOperatorResultsBySide shared side-slicing helper', () => {
  const sampleResults: Record<string, MetricOperatorInput> = {
    'op.by_fenfang': {
      status: 'valid',
      dataset: {
        columns: [
          { name: '分方', type: 'string' },
          { name: '完成比', type: 'number' },
        ],
        rows: [
          { 分方: '红方', 完成比: 0.9 },
          { 分方: '绿方', 完成比: 0.4 },
          { 分方: '蓝方', 完成比: 0.7 },
        ],
        totalRows: 3,
      },
    },
    'op.by_firing_side': {
      status: 'valid',
      dataset: {
        columns: [
          { name: '发射分方', type: 'string' },
          { name: '命中', type: 'boolean' },
        ],
        rows: [
          { 发射分方: '红方', 命中: true },
          { 发射分方: '红方', 命中: false },
          { 发射分方: '绿方', 命中: true },
        ],
        totalRows: 3,
      },
    },
    'op.by_ratio_col': {
      status: 'valid',
      dataset: {
        columns: [
          { name: '分方比', type: 'string' },
          { name: '战损交换比', type: 'number' },
        ],
        rows: [
          { 分方比: '红方/绿方', 战损交换比: 3.5 },
          { 分方比: '绿方/红方', 战损交换比: 0.28 },
        ],
        totalRows: 2,
      },
    },
    'op.global_equipment': {
      status: 'valid',
      dataset: {
        columns: [
          { name: '传感器型号', type: 'string' },
          { name: '探测距离_海里', type: 'number' },
        ],
        rows: [
          { 传感器型号: 'J-20 Radar', 探测距离_海里: 180 },
          { 传感器型号: 'E-2K', 探测距离_海里: 220 },
        ],
        totalRows: 2,
      },
    },
  };

  it('passes through unchanged for undefined, ALL, and 全部', () => {
    assert.strictEqual(sliceOperatorResultsBySide(sampleResults, undefined), sampleResults);
    assert.strictEqual(sliceOperatorResultsBySide(sampleResults, 'ALL'), sampleResults);
    assert.strictEqual(sliceOperatorResultsBySide(sampleResults, '全部'), sampleResults);
  });

  it('slices 分方, 发射分方, 分方比 prefix, and preserves global tables', () => {
    const red = sliceOperatorResultsBySide(sampleResults, '红方');
    assert.equal(red['op.by_fenfang'].dataset?.rows.length, 1);
    assert.equal(red['op.by_fenfang'].dataset?.rows[0]['完成比'], 0.9);
    assert.equal(red['op.by_fenfang'].dataset?.totalRows, 1);

    assert.equal(red['op.by_firing_side'].dataset?.rows.length, 2);
    assert.equal(red['op.by_firing_side'].dataset?.totalRows, 2);

    assert.equal(red['op.by_ratio_col'].dataset?.rows.length, 1);
    assert.equal(red['op.by_ratio_col'].dataset?.rows[0]['分方比'], '红方/绿方');

    // 无分方列的全局表透传不裁剪
    assert.equal(red['op.global_equipment'].dataset?.rows.length, 2);

    // 未命中任何行时保留 columns 且 totalRows = 0，evaluateMetricGraph 安全降级 unavailable
    const white = sliceOperatorResultsBySide(sampleResults, '白方');
    assert.equal(white['op.by_fenfang'].dataset?.rows.length, 0);
    assert.equal(white['op.by_fenfang'].dataset?.totalRows, 0);
    assert.equal(white['op.by_fenfang'].dataset?.columns.length, 2);
  });

  it('lets evaluateMetricGraph Fail-Closed cleanly on 0-row sliced tables without crashing', async () => {
    const graph: MetricGraphDefinition = {
      graphId: 'mg_empty_slice',
      name: 'Empty Slice Fail-Closed',
      graphKind: 'metric',
      nodes: [
        {
          id: 'mn_1',
          kind: 'metric',
          label: '任务完成率',
          position: { x: 0, y: 0 },
          metricConfig: {
            metricId: 'strike.completion',
            name: '任务完成率',
            militaryLevel: 'MOE',
            domainTag: 'firepower',
            mode: 'from_operator',
            sourceRef: 'op.by_fenfang',
            targetField: '完成比',
            reduce: 'mean',
          },
        },
      ],
      edges: [],
    };
    const emptySliced = sliceOperatorResultsBySide(sampleResults, '白方');
    const res = await evaluateMetricGraph(graph, emptySliced, { runId: 'run_empty_slice' });
    assert.equal(res.nodeResults['mn_1'].status, 'unavailable');
    assert.equal(res.nodeResults['mn_1'].value, null);
  });
});

// ──────────────────── 6. Plan A 路由：?layer=fact/all、targetSide 切片与混合内核算子 DAG 执行 ────────────────────

describe('V4 Plan A routes: operator layer filtering, side slicing, and mixed-kernel operator-graphs/execute', () => {
  it('supports GET /api/v4/operators?layer=fact|all, targetSide slicing, and POST /api/v4/operator-graphs/execute', async () => {
    const dir = createTempDir('f1-v4-plan-a-');
    const csvDir = path.join(dir, 'csv');
    fs.mkdirSync(csvDir, { recursive: true });

    // 写入带双 UTF-8 BOM 和时间戳前缀的真机风格 CSV 文件
    const posCsvContent =
      '\uFEFF\uFEFFTime,UnitID,UnitName,UnitSide,UnitLongitude,UnitLatitude\n' +
      '00:01:00,u1,J-20-1,红方,120.5,24.5\n' +
      '00:02:00,u2,J-20-2,红方,122.0,26.0\n' +
      '00:03:00,u3,F-16-1,蓝方,120.6,24.6\n';
    fs.writeFileSync(
      path.join(csvDir, '2026-11-23_10.00.0_UnitPositions.csv'),
      posCsvContent,
      'utf8',
    );

    const effectStore = new EffectStore(path.join(dir, 'custom-effects.json'));
    const metricGraphStore = new MetricGraphStore(path.join(dir, 'v4-metric-graphs.json'));
    const systemDagStore = new SystemDagStore(path.join(dir, 'v4-system-dags.json'), effectStore);
    const cache = new DagNodeCache();

    const allOps = [
      { id: 'strike.single_mission_metrics', name: '单突击任务客观明细', layer: 'fact' },
      { id: 'strike.composite_mission_metrics', name: '突击任务综合聚合(旧)', layer: 'legacy_aggregate' },
    ];
    const builtinComponents = [
      { id: 'data_input', name: '数据输入', engineKind: 'data_input' },
      { id: 'inline_calc', name: '行内公式 (TS LibFormula)', engineKind: 'inline_calc' },
      { id: 'group_agg', name: '跨行分组聚合 (TS GroupBy)', engineKind: 'group_agg' },
      { id: 'spatial', name: '空间几何 (TS Turf)', engineKind: 'spatial' },
      { id: 'python_script', name: '自定义 Python 脚本', engineKind: 'python_script' },
    ];

    const deps: V4RouteDeps = {
      effectStore,
      metricGraphStore,
      systemDagStore,
      cache,
      listOperators: (opts) =>
        opts?.layer === 'fact' ? allOps.filter((o) => o.layer === 'fact') : allOps,
      listComponents: () => builtinComponents,
      resolveCsvDir: () => csvDir,
      runOperator: async (operatorId): Promise<OperatorNodeExecutionResult> => {
        if (operatorId === 'strike.single_mission_metrics') {
          const rows = [
            { 任务ID: 'M1', 分方: '红方', 完成比: 0.9 },
            { 任务ID: 'M2', 分方: '红方', 完成比: 0.7 },
            { 任务ID: 'M3', 分方: '蓝方', 完成比: 0.4 },
          ];
          return {
            nodeId: operatorId,
            status: 'valid',
            dataset: {
              id: 'ds_strike_single',
              columns: [
                { name: '任务ID', type: 'string' },
                { name: '分方', type: 'string' },
                { name: '完成比', type: 'number' },
              ],
              rows,
              totalRows: rows.length,
            },
            evidenceRefs: [
              {
                source: 'csv',
                ref: 'MissionChanged.csv',
                scenarioClock: '00:10:00',
                description: '单突击任务客观统计',
              },
            ],
            cacheKey: 'ck_strike_single',
            latencyMs: 1,
          };
        }
        return {
          nodeId: operatorId,
          status: 'unavailable',
          evidenceRefs: [],
          missingDataReason: `未知算子: ${operatorId}`,
          cacheKey: '',
          latencyMs: 0,
        };
      },
    };

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);
      const handled = await handleV4ApiRequest(
        req,
        res,
        pathname,
        readJsonBody,
        sendJson,
        deps,
      );
      if (!handled) {
        sendJson(res, 404, { ok: false, error: 'Not Found' });
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // 1) GET /api/v4/operators?layer=fact vs ?layer=all + components
      const factOpsRes = await requestJson<{
        ok: boolean;
        operators: Array<{ id: string; layer: string }>;
        components: Array<{ id: string }>;
      }>(baseUrl, 'GET', '/api/v4/operators?layer=fact');
      assert.equal(factOpsRes.status, 200);
      assert.equal(factOpsRes.data.operators.length, 1);
      assert.equal(factOpsRes.data.operators[0].id, 'strike.single_mission_metrics');
      assert.equal(factOpsRes.data.components.length, 5);

      const allOpsRes = await requestJson<{
        ok: boolean;
        operators: Array<{ id: string; layer: string }>;
        components: Array<{ id: string }>;
      }>(baseUrl, 'GET', '/api/v4/operators?layer=all');
      assert.equal(allOpsRes.status, 200);
      assert.equal(allOpsRes.data.operators.length, 2);

      // 2) POST /api/v4/metric-graphs/execute & /api/v4/system-dags/evaluate targetSide 统一阵营切片
      const sideMetricGraph: MetricGraphDefinition = {
        graphId: 'mg_side_slice_test',
        name: '阵营切片测试图',
        graphKind: 'metric',
        nodes: [
          {
            id: 'mn_strike',
            kind: 'metric',
            label: '突击平均完成比',
            position: { x: 0, y: 0 },
            metricConfig: {
              metricId: 'strike.avg_completion',
              name: '突击平均完成比',
              militaryLevel: 'MOE',
              domainTag: 'firepower',
              mode: 'from_operator',
              sourceRef: 'strike.single_mission_metrics',
              targetField: '完成比',
              reduce: 'mean',
            },
          },
        ],
        edges: [],
      };

      const redMg = await requestJson<{
        ok: boolean;
        metricInputsForSystem: Record<string, { value?: number }>;
      }>(baseUrl, 'POST', '/api/v4/metric-graphs/execute', {
        graph: sideMetricGraph,
        runId: 'run_side_1',
        targetSide: '红方',
      });
      assert.equal(redMg.status, 200);
      assert.equal(redMg.data.metricInputsForSystem['strike.avg_completion']?.value, 0.8);

      const blueMg = await requestJson<{
        ok: boolean;
        metricInputsForSystem: Record<string, { value?: number }>;
      }>(baseUrl, 'POST', '/api/v4/metric-graphs/execute', {
        graph: sideMetricGraph,
        runId: 'run_side_1',
        targetSide: '蓝方',
      });
      assert.equal(blueMg.status, 200);
      assert.equal(blueMg.data.metricInputsForSystem['strike.avg_completion']?.value, 0.4);

      const sideSysDag: EvaluationSystemDag = {
        systemId: 'sys_side_slice_test',
        name: '阵营切片体系测试',
        version: '1.0.0',
        terminalEffectNodeId: 'ef_term',
        nodes: [
          {
            id: 'px_1',
            kind: 'metric_proxy',
            label: '突击完成比',
            refId: 'strike.avg_completion',
            position: { x: 0, y: 0 },
          },
          {
            id: 'ef_term',
            kind: 'effect',
            label: '综合突击效能',
            position: { x: 240, y: 0 },
            inlineEffect: {
              effectId: 'eff_side_inline',
              name: '突击效能',
              role: 'effect',
              metricBinding: {
                metricId: 'strike.avg_completion',
                scoringRule: { type: 'larger_is_better', worst: 0, optimal: 1 },
              },
              aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
            },
          },
        ],
        edges: [{ id: 'e1', sourceNodeId: 'px_1', targetNodeId: 'ef_term' }],
      };

      const redSysEval = await requestJson<{ ok: boolean; overallScore: number }>(
        baseUrl,
        'POST',
        '/api/v4/system-dags/evaluate',
        {
          system: sideSysDag,
          metricGraph: sideMetricGraph,
          runId: 'run_side_sys',
          targetSide: '红方',
        },
      );
      assert.equal(redSysEval.status, 200);
      assert.equal(redSysEval.data.overallScore, 80);

      const blueSysEval = await requestJson<{ ok: boolean; overallScore: number }>(
        baseUrl,
        'POST',
        '/api/v4/system-dags/evaluate',
        {
          system: sideSysDag,
          metricGraph: sideMetricGraph,
          runId: 'run_side_sys',
          targetSide: '蓝方',
        },
      );
      assert.equal(blueSysEval.status, 200);
      assert.equal(blueSysEval.data.overallScore, 40);

      // 3) POST /api/v4/operator-graphs/execute 混合内核 DAG: fact_operator -> TS inline_calc -> TS group_agg
      const mixedOpGraph: DagGraphDefinition = {
        graphId: 'op_mixed_kernel_demo',
        name: '混合内核算子 DAG',
        graphKind: 'operator',
        nodes: [
          {
            id: 'n_fact',
            kind: 'fact_operator',
            label: '单突击任务明细',
            position: { x: 0, y: 0 },
            params: { operatorId: 'strike.single_mission_metrics' },
          },
          {
            id: 'n_calc',
            kind: 'inline_calc',
            label: '百分比与达标衍生列',
            position: { x: 240, y: 0 },
            params: {
              derivedColumns: [
                { columnName: '完成百分比', dataType: 'number', expression: '完成比 * 100' },
                { columnName: '是否优秀', dataType: 'number', expression: 'IF(完成比 >= 0.8, 1, 0)' },
              ],
            },
          },
          {
            id: 'n_agg',
            kind: 'group_agg',
            label: '分方均值与优秀次数汇总',
            position: { x: 480, y: 0 },
            params: {
              groupKeys: ['分方'],
              metrics: [
                { targetField: '平均完成百分比', sourceColumn: '完成百分比', method: 'AVERAGE' },
                { targetField: '优秀任务数', sourceColumn: '是否优秀', method: 'SUM' },
              ],
            },
          },
        ],
        edges: [
          { id: 'oe1', sourceNodeId: 'n_fact', targetNodeId: 'n_calc' },
          { id: 'oe2', sourceNodeId: 'n_calc', targetNodeId: 'n_agg' },
        ],
      };

      const mixedExec1 = await requestJson<{
        ok: boolean;
        topologicalOrder: string[];
        cacheHits: number;
        cacheMisses: number;
        nodeResults: Record<string, DagNodeExecutionResult>;
      }>(baseUrl, 'POST', '/api/v4/operator-graphs/execute', {
        graph: mixedOpGraph,
        runId: 'run_mixed_1',
      });
      assert.equal(mixedExec1.status, 200);
      assert.deepEqual(mixedExec1.data.topologicalOrder, ['n_fact', 'n_calc', 'n_agg']);
      assert.equal(mixedExec1.data.cacheMisses, 3);

      const calcRes = mixedExec1.data.nodeResults['n_calc'];
      assert.equal(calcRes.status, 'valid');
      assert.equal(calcRes.dataset?.rows[0]['完成百分比'], 90);
      assert.equal(calcRes.dataset?.rows[0]['是否优秀'], 1);

      const aggRes = mixedExec1.data.nodeResults['n_agg'];
      assert.equal(aggRes.status, 'valid');
      assert.equal(aggRes.dataset?.rows.length, 2);
      const redAggRow = aggRes.dataset?.rows.find((r) => r['分方'] === '红方');
      assert.equal(redAggRow?.['平均完成百分比'], 80);
      assert.equal(redAggRow?.['优秀任务数'], 1);

      // 相同 runId 二次执行应全部命中内容寻址缓存
      const mixedExec2 = await requestJson<{
        ok: boolean;
        cacheHits: number;
        cacheMisses: number;
      }>(baseUrl, 'POST', '/api/v4/operator-graphs/execute', {
        graph: mixedOpGraph,
        runId: 'run_mixed_1',
      });
      assert.equal(mixedExec2.status, 200);
      assert.equal(mixedExec2.data.cacheHits, 3);
      assert.equal(mixedExec2.data.cacheMisses, 0);

      // 4) data_input (双 BOM CSV) -> spatial (Turf polygon check) -> group_agg
      const csvSpatialGraph: DagGraphDefinition = {
        graphId: 'op_csv_spatial_demo',
        name: 'CSV + 空间几何流水线',
        graphKind: 'operator',
        nodes: [
          {
            id: 'n_csv',
            kind: 'data_input',
            label: '读取轨迹表',
            position: { x: 0, y: 0 },
            params: { csvTable: 'UnitPositions' },
          },
          {
            id: 'n_spatial',
            kind: 'spatial',
            label: '任务走廊越界判定',
            position: { x: 240, y: 0 },
            params: {
              polygon: [
                [120.0, 24.0],
                [121.0, 24.0],
                [121.0, 25.0],
                [120.0, 25.0],
              ],
            },
          },
          {
            id: 'n_agg_side',
            kind: 'group_agg',
            label: '按阵营统计点数',
            position: { x: 480, y: 0 },
            params: {
              groupKeys: ['UnitSide'],
              metrics: [{ targetField: '轨迹点数', sourceColumn: 'UnitID', method: 'COUNT_ALL' }],
            },
          },
        ],
        edges: [
          { id: 'se1', sourceNodeId: 'n_csv', targetNodeId: 'n_spatial' },
          { id: 'se2', sourceNodeId: 'n_spatial', targetNodeId: 'n_agg_side' },
        ],
      };

      const csvSpatialExec = await requestJson<{
        ok: boolean;
        nodeResults: Record<string, DagNodeExecutionResult>;
      }>(baseUrl, 'POST', '/api/v4/operator-graphs/execute', {
        graph: csvSpatialGraph,
        runId: 'run_csv_spatial',
      });
      assert.equal(csvSpatialExec.status, 200);
      assert.equal(csvSpatialExec.data.nodeResults['n_csv'].status, 'valid');
      assert.equal(csvSpatialExec.data.nodeResults['n_csv'].dataset?.rows.length, 3);
      assert.equal(csvSpatialExec.data.nodeResults['n_spatial'].status, 'valid');
      assert.equal(
        csvSpatialExec.data.nodeResults['n_spatial'].dataset?.rows.find((r) => r.UnitID === 'u1')?.InPolygon,
        true,
      );
      assert.equal(
        csvSpatialExec.data.nodeResults['n_spatial'].dataset?.rows.find((r) => r.UnitID === 'u2')?.InPolygon,
        false,
      );
      assert.equal(csvSpatialExec.data.nodeResults['n_agg_side'].status, 'valid');
      assert.equal(
        csvSpatialExec.data.nodeResults['n_agg_side'].dataset?.rows.find((r) => r.UnitSide === '红方')?.['轨迹点数'],
        2,
      );

      // 5) Fail-Closed: 缺失底表沿算子 DAG 向下游传播 unavailable
      const missingTableGraph: DagGraphDefinition = {
        graphId: 'op_missing_table',
        name: '缺失底表 Fail-Closed 测试',
        graphKind: 'operator',
        nodes: [
          {
            id: 'n_missing',
            kind: 'data_input',
            label: '缺失表',
            position: { x: 0, y: 0 },
            params: { csvTable: 'NonExistentTable' },
          },
          {
            id: 'n_downstream_calc',
            kind: 'inline_calc',
            label: '下游公式',
            position: { x: 240, y: 0 },
            params: {
              derivedColumns: [{ columnName: 'X', dataType: 'number', expression: '1 + 1' }],
            },
          },
        ],
        edges: [{ id: 'me1', sourceNodeId: 'n_missing', targetNodeId: 'n_downstream_calc' }],
      };

      const missingExec = await requestJson<{
        ok: boolean;
        nodeResults: Record<string, DagNodeExecutionResult>;
      }>(baseUrl, 'POST', '/api/v4/operator-graphs/execute', {
        graph: missingTableGraph,
        runId: 'run_missing_table',
      });
      assert.equal(missingExec.status, 200);
      assert.equal(missingExec.data.nodeResults['n_missing'].status, 'unavailable');
      assert.ok(missingExec.data.nodeResults['n_missing'].missingDataReason?.includes('NonExistentTable'));
      assert.equal(missingExec.data.nodeResults['n_downstream_calc'].status, 'unavailable');
      assert.ok(missingExec.data.nodeResults['n_downstream_calc'].missingDataReason?.includes('n_missing'));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

// ──────────────────── 7. 动态多阵营发现与同屏对比试算 (compare-sides) ────────────────────

describe('discoverSidesFromOperatorResults & POST /api/v4/metric-graphs/:graphId/compare-sides', () => {
  it('discovers deduplicated sides in appearance order across canonical columns and 分方比 prefixes', () => {
    const opResults: Record<string, MetricOperatorInput> = {
      'op.unavail': {
        status: 'unavailable',
        missingDataReason: '缺失 CSV',
        dataset: {
          columns: [{ name: '分方', type: 'string' }],
          rows: [{ 分方: '不应被发现的失效阵营' }],
          totalRows: 1,
        },
      },
      'op.global': {
        status: 'valid',
        dataset: {
          columns: [{ name: '型号', type: 'string' }],
          rows: [{ 型号: 'Radar-X' }],
          totalRows: 1,
        },
      },
      'op.side_and_all': {
        status: 'valid',
        dataset: {
          columns: [
            { name: '分方', type: 'string' },
            { name: '发射分方', type: 'string' },
          ],
          rows: [
            { 分方: 'ALL', 发射分方: '全部' },
            { 分方: '', 发射分方: '  ' },
            { 分方: '绿方', 发射分方: '绿方' },
            { 分方: '红方', 发射分方: null },
          ],
          totalRows: 4,
        },
      },
      'op.eng_cols': {
        status: 'degraded',
        dataset: {
          columns: [
            { name: 'Side', type: 'string' },
            { name: 'UnitSide', type: 'string' },
            { name: 'FiringUnitSide', type: 'string' },
            { name: 'TargetSide', type: 'string' },
          ],
          rows: [
            {
              Side: '蓝方',
              UnitSide: '绿方',
              FiringUnitSide: '特遣纵队-A',
              TargetSide: '假想敌-B',
            },
          ],
          totalRows: 1,
        },
      },
      'op.ratio_colon_and_slash': {
        status: 'valid',
        dataset: {
          columns: [
            { name: '分方比', type: 'string' },
            { name: '交换比', type: 'number' },
          ],
          rows: [
            { 分方比: '全部/红方', 交换比: 1.0 },
            { 分方比: '紫方:蓝方', 交换比: 2.1 },
            { 分方比: '绿方/红方', 交换比: 0.9 },
            { 分方比: '橙方/蓝方', 交换比: 1.5 },
          ],
          totalRows: 4,
        },
      },
    };

    const sides = discoverSidesFromOperatorResults(opResults);
    assert.deepEqual(sides, ['绿方', '红方', '蓝方', '特遣纵队-A', '假想敌-B', '紫方', '橙方']);
  });

  it('runs operators once, discovers sides dynamically (绿方/红方/蓝方), and returns overall + bySide', async () => {
    const dir = createTempDir('f1-v4-compare-sides-');
    const effectStore = new EffectStore(path.join(dir, 'custom-effects.json'));
    const metricGraphStore = new MetricGraphStore(path.join(dir, 'v4-metric-graphs.json'));
    const systemDagStore = new SystemDagStore(path.join(dir, 'v4-system-dags.json'), effectStore);

    const savedGraph: MetricGraphDefinition = {
      graphId: 'mg_compare_3sides',
      name: '三阵营动态对比指标图',
      graphKind: 'metric',
      nodes: [
        {
          id: 'mn_completion',
          kind: 'metric',
          label: '突击任务完成度',
          position: { x: 0, y: 0 },
          metricConfig: {
            metricId: 'strike.completion',
            name: '突击任务完成度',
            militaryLevel: 'MOP',
            domainTag: 'firepower',
            mode: 'from_operator',
            sourceRef: 'strike.single_mission_metrics',
            targetField: '完成比',
            reduce: 'mean',
            unit: 'ratio',
          },
        },
        {
          id: 'mn_hit_rate',
          kind: 'metric',
          label: '弹药命中率',
          position: { x: 0, y: 160 },
          metricConfig: {
            metricId: 'weapon.hit_rate',
            name: '弹药命中率',
            militaryLevel: 'MOP',
            domainTag: 'firepower',
            mode: 'from_operator',
            sourceRef: 'weapon.engagement',
            targetField: '命中值',
            reduce: 'mean',
            unit: 'ratio',
          },
        },
        {
          id: 'mn_composite',
          kind: 'metric',
          label: '综合火力效能指数',
          position: { x: 300, y: 80 },
          metricConfig: {
            metricId: 'firepower.composite_index',
            name: '综合火力效能指数',
            militaryLevel: 'MOE',
            domainTag: 'firepower',
            mode: 'from_metric_formula',
            formulaExpression: '(completion + hit) / 2',
            unit: 'ratio',
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          sourceNodeId: 'mn_completion',
          targetNodeId: 'mn_composite',
          targetAlias: 'completion',
        },
        {
          id: 'e2',
          sourceNodeId: 'mn_hit_rate',
          targetNodeId: 'mn_composite',
          targetAlias: 'hit',
        },
      ],
    };
    metricGraphStore.upsert(savedGraph);

    const opCallCounts: Record<string, number> = {};
    const deps: V4RouteDeps = {
      effectStore,
      metricGraphStore,
      systemDagStore,
      cache: new DagNodeCache(),
      listOperators: () => [],
      runOperator: async (operatorId): Promise<OperatorNodeExecutionResult> => {
        opCallCounts[operatorId] = (opCallCounts[operatorId] ?? 0) + 1;
        if (operatorId === 'strike.single_mission_metrics') {
          const rows = [
            { 任务ID: 'M1', 分方: '绿方', 完成比: 0.6 },
            { 任务ID: 'M2', 分方: '红方', 完成比: 0.9 },
            { 任务ID: 'M3', 分方: '红方', 完成比: 0.7 },
            { 任务ID: 'M4', 分方: '蓝方', 完成比: 0.4 },
          ];
          return {
            nodeId: operatorId,
            status: 'valid',
            dataset: {
              columns: [
                { name: '任务ID', type: 'string' },
                { name: '分方', type: 'string' },
                { name: '完成比', type: 'number' },
              ],
              rows,
              totalRows: rows.length,
            },
            evidenceRefs: [],
            cacheKey: 'ck_strike',
            latencyMs: 1,
          };
        }
        if (operatorId === 'weapon.engagement') {
          const rows = [
            { 发射分方: '绿方', 命中值: 1.0 },
            { 发射分方: '红方', 命中值: 0.6 },
            { 发射分方: '蓝方', 命中值: 0.2 },
          ];
          return {
            nodeId: operatorId,
            status: 'valid',
            dataset: {
              columns: [
                { name: '发射分方', type: 'string' },
                { name: '命中值', type: 'number' },
              ],
              rows,
              totalRows: rows.length,
            },
            evidenceRefs: [],
            cacheKey: 'ck_weapon',
            latencyMs: 1,
          };
        }
        return {
          nodeId: operatorId,
          status: 'unavailable',
          evidenceRefs: [],
          missingDataReason: `未知算子: ${operatorId}`,
          cacheKey: '',
          latencyMs: 0,
        };
      },
    };

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);
      const handled = await handleV4ApiRequest(
        req,
        res,
        pathname,
        readJsonBody,
        sendJson,
        deps,
      );
      if (!handled) {
        sendJson(res, 404, { ok: false, error: 'Not Found' });
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const missingRes = await requestJson<{ ok: boolean; error: string }>(
        baseUrl,
        'POST',
        '/api/v4/metric-graphs/mg_non_existent/compare-sides',
        { runId: 'run_404' },
      );
      assert.equal(missingRes.status, 404);
      assert.equal(missingRes.data.ok, false);

      const compareRes = await requestJson<{
        ok: boolean;
        graphId: string;
        sides: string[];
        overall: {
          nodeResults: Record<string, { status: string; value?: number | null }>;
        };
        bySide: Record<
          string,
          {
            nodeResults: Record<string, { status: string; value?: number | null }>;
          }
        >;
      }>(baseUrl, 'POST', '/api/v4/metric-graphs/mg_compare_3sides/compare-sides', {
        runId: 'run_compare_1',
      });

      assert.equal(compareRes.status, 200);
      assert.equal(compareRes.data.ok, true);
      assert.equal(compareRes.data.graphId, 'mg_compare_3sides');
      assert.deepEqual(compareRes.data.sides, ['绿方', '红方', '蓝方']);

      // 全量算子仅执行一次，绝不按阵营数重复拉起
      assert.equal(opCallCounts['strike.single_mission_metrics'], 1);
      assert.equal(opCallCounts['weapon.engagement'], 1);

      // overall: completion mean(0.6, 0.9, 0.7, 0.4)=0.65, hit mean(1.0, 0.6, 0.2)=0.6, composite=0.625
      assert.ok(Math.abs((compareRes.data.overall.nodeResults['mn_completion'].value ?? 0) - 0.65) < 1e-9);
      assert.ok(Math.abs((compareRes.data.overall.nodeResults['mn_hit_rate'].value ?? 0) - 0.6) < 1e-9);
      assert.ok(Math.abs((compareRes.data.overall.nodeResults['mn_composite'].value ?? 0) - 0.625) < 1e-9);

      // 绿方: completion=0.6, hit=1.0, composite=0.8
      assert.equal(compareRes.data.bySide['绿方'].nodeResults['mn_completion'].status, 'valid');
      assert.ok(Math.abs((compareRes.data.bySide['绿方'].nodeResults['mn_completion'].value ?? 0) - 0.6) < 1e-9);
      assert.ok(Math.abs((compareRes.data.bySide['绿方'].nodeResults['mn_hit_rate'].value ?? 0) - 1.0) < 1e-9);
      assert.ok(Math.abs((compareRes.data.bySide['绿方'].nodeResults['mn_composite'].value ?? 0) - 0.8) < 1e-9);

      // 红方: completion=mean(0.9, 0.7)=0.8, hit=0.6, composite=0.7
      assert.ok(Math.abs((compareRes.data.bySide['红方'].nodeResults['mn_completion'].value ?? 0) - 0.8) < 1e-9);
      assert.ok(Math.abs((compareRes.data.bySide['红方'].nodeResults['mn_hit_rate'].value ?? 0) - 0.6) < 1e-9);
      assert.ok(Math.abs((compareRes.data.bySide['红方'].nodeResults['mn_composite'].value ?? 0) - 0.7) < 1e-9);

      // 蓝方: completion=0.4, hit=0.2, composite=0.3
      assert.ok(Math.abs((compareRes.data.bySide['蓝方'].nodeResults['mn_completion'].value ?? 0) - 0.4) < 1e-9);
      assert.ok(Math.abs((compareRes.data.bySide['蓝方'].nodeResults['mn_hit_rate'].value ?? 0) - 0.2) < 1e-9);
      assert.ok(Math.abs((compareRes.data.bySide['蓝方'].nodeResults['mn_composite'].value ?? 0) - 0.3) < 1e-9);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

// ──────────────────── 8. 三库体系动态多阵营对比评估 (system-dags/:systemId/compare-sides) ────────────────────

describe('POST /api/v4/system-dags/:systemId/compare-sides', () => {
  it('runs operators once, discovers sides dynamically (绿方/红方/蓝方), and returns overall + bySide scores & gateVerdict', async () => {
    const dir = createTempDir('f1-v4-sys-compare-sides-');
    const effectStore = new EffectStore(path.join(dir, 'custom-effects.json'));
    const metricGraphStore = new MetricGraphStore(path.join(dir, 'v4-metric-graphs.json'));
    const systemDagStore = new SystemDagStore(path.join(dir, 'v4-system-dags.json'), effectStore);

    const savedGraph: MetricGraphDefinition = {
      graphId: 'mg_sys_compare_3sides',
      name: '三库体系动态对比指标图',
      graphKind: 'metric',
      nodes: [
        {
          id: 'mn_completion',
          kind: 'metric',
          label: '突击任务完成度',
          position: { x: 0, y: 0 },
          metricConfig: {
            metricId: 'strike.completion',
            name: '突击任务完成度',
            militaryLevel: 'MOP',
            domainTag: 'firepower',
            mode: 'from_operator',
            sourceRef: 'strike.single_mission_metrics',
            targetField: '完成比',
            reduce: 'mean',
            unit: 'ratio',
          },
        },
        {
          id: 'mn_hit_rate',
          kind: 'metric',
          label: '弹药命中率',
          position: { x: 0, y: 140 },
          metricConfig: {
            metricId: 'weapon.hit_rate',
            name: '弹药命中率',
            militaryLevel: 'MOP',
            domainTag: 'firepower',
            mode: 'from_operator',
            sourceRef: 'weapon.engagement',
            targetField: '命中值',
            reduce: 'mean',
            unit: 'ratio',
          },
        },
        {
          id: 'mn_fratricide',
          kind: 'metric',
          label: '友军误伤计数',
          position: { x: 0, y: 280 },
          metricConfig: {
            metricId: 'roe.fratricide_count',
            name: '友军误伤计数',
            militaryLevel: 'MOP',
            domainTag: 'survivability',
            mode: 'from_operator',
            sourceRef: 'roe.fratricide_count',
            targetField: 'FratricideCount',
            reduce: 'sum',
            unit: 'count',
          },
        },
      ],
      edges: [],
    };
    metricGraphStore.upsert(savedGraph);

    const savedSystem: StoredEvaluationSystemDag = {
      systemId: 'sys_compare_3sides',
      name: '三阵营体系对比评估模型',
      version: '1.0.0',
      metricGraphId: 'mg_sys_compare_3sides',
      terminalEffectNodeId: 'ef_terminal',
      // 故意预设单阵营 targetSide，验证 compare-sides 不受其限制且能发现全部分方
      globalParams: {
        targetSide: '红方',
      },
      nodes: [
        {
          id: 'px_completion',
          kind: 'metric_proxy',
          label: '突击任务完成度代理',
          refId: 'strike.completion',
          position: { x: 0, y: 0 },
        },
        {
          id: 'px_hit',
          kind: 'metric_proxy',
          label: '弹药命中率代理',
          refId: 'weapon.hit_rate',
          position: { x: 0, y: 140 },
        },
        {
          id: 'px_frat',
          kind: 'metric_proxy',
          label: '友军误伤计数代理',
          refId: 'roe.fratricide_count',
          position: { x: 0, y: 280 },
        },
        {
          id: 'ef_strike',
          kind: 'effect',
          label: '突击达成效果',
          position: { x: 240, y: 0 },
          inlineEffect: {
            effectId: 'eff_cmp_strike',
            name: '突击达成效果',
            role: 'effect',
            metricBinding: {
              metricId: 'strike.completion',
              scoringRule: { type: 'larger_is_better', worst: 0, optimal: 1 },
            },
            aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
          },
        },
        {
          id: 'ef_hit',
          kind: 'effect',
          label: '武器命中效果',
          position: { x: 240, y: 140 },
          inlineEffect: {
            effectId: 'eff_cmp_hit',
            name: '武器命中效果',
            role: 'effect',
            metricBinding: {
              metricId: 'weapon.hit_rate',
              scoringRule: { type: 'larger_is_better', worst: 0, optimal: 1 },
            },
            aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
          },
        },
        {
          id: 'dim_firepower',
          kind: 'dimension',
          label: '火力打击维度',
          position: { x: 500, y: 70 },
          inlineEffect: {
            effectId: 'eff_cmp_dim_firepower',
            name: '火力打击维度',
            role: 'effect',
            aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
          },
        },
        {
          id: 'gt_frat',
          kind: 'gate',
          label: '误伤红线硬门控',
          refId: 'gate_fratricide_zero',
          position: { x: 240, y: 280 },
        },
        {
          id: 'ef_terminal',
          kind: 'effect',
          label: '体系综合效能',
          position: { x: 760, y: 70 },
          inlineEffect: {
            effectId: 'eff_cmp_terminal',
            name: '体系综合效能',
            role: 'effect',
            aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
          },
        },
      ],
      edges: [
        { id: 'e_s1', sourceNodeId: 'px_completion', targetNodeId: 'ef_strike' },
        { id: 'e_s2', sourceNodeId: 'px_hit', targetNodeId: 'ef_hit' },
        { id: 'e_s3', sourceNodeId: 'px_frat', targetNodeId: 'gt_frat' },
        { id: 'e_d1', sourceNodeId: 'ef_strike', targetNodeId: 'dim_firepower', weight: 0.6 },
        { id: 'e_d2', sourceNodeId: 'ef_hit', targetNodeId: 'dim_firepower', weight: 0.4 },
        { id: 'e_t1', sourceNodeId: 'dim_firepower', targetNodeId: 'ef_terminal', weight: 1.0 },
      ],
    };
    systemDagStore.upsert(savedSystem);

    const opCallCounts: Record<string, number> = {};
    const opReceivedParams: Record<string, Record<string, unknown>> = {};
    const deps: V4RouteDeps = {
      effectStore,
      metricGraphStore,
      systemDagStore,
      cache: new DagNodeCache(),
      listOperators: () => [],
      runOperator: async (operatorId, body): Promise<OperatorNodeExecutionResult> => {
        opCallCounts[operatorId] = (opCallCounts[operatorId] ?? 0) + 1;
        opReceivedParams[operatorId] = (body.params as Record<string, unknown>) ?? {};
        if (operatorId === 'strike.single_mission_metrics') {
          const rows = [
            { 任务ID: 'M1', 分方: '绿方', 完成比: 0.6 },
            { 任务ID: 'M2', 分方: '红方', 完成比: 0.9 },
            { 任务ID: 'M3', 分方: '红方', 完成比: 0.7 },
            { 任务ID: 'M4', 分方: '蓝方', 完成比: 0.5 },
          ];
          return {
            nodeId: operatorId,
            status: 'valid',
            dataset: {
              columns: [
                { name: '任务ID', type: 'string' },
                { name: '分方', type: 'string' },
                { name: '完成比', type: 'number' },
              ],
              rows,
              totalRows: rows.length,
            },
            evidenceRefs: [],
            cacheKey: 'ck_sys_strike',
            latencyMs: 1,
          };
        }
        if (operatorId === 'weapon.engagement') {
          const rows = [
            { 发射分方: '绿方', 命中值: 1.0 },
            { 发射分方: '红方', 命中值: 0.6 },
            { 发射分方: '蓝方', 命中值: 0.5 },
          ];
          return {
            nodeId: operatorId,
            status: 'valid',
            dataset: {
              columns: [
                { name: '发射分方', type: 'string' },
                { name: '命中值', type: 'number' },
              ],
              rows,
              totalRows: rows.length,
            },
            evidenceRefs: [],
            cacheKey: 'ck_sys_weapon',
            latencyMs: 1,
          };
        }
        if (operatorId === 'roe.fratricide_count') {
          const rows = [
            { 分方: '绿方', FratricideCount: 0 },
            { 分方: '红方', FratricideCount: 0 },
            { 分方: '蓝方', FratricideCount: 1 },
          ];
          return {
            nodeId: operatorId,
            status: 'valid',
            dataset: {
              columns: [
                { name: '分方', type: 'string' },
                { name: 'FratricideCount', type: 'number' },
              ],
              rows,
              totalRows: rows.length,
            },
            evidenceRefs: [],
            cacheKey: 'ck_sys_frat',
            latencyMs: 1,
          };
        }
        return {
          nodeId: operatorId,
          status: 'unavailable',
          evidenceRefs: [],
          missingDataReason: `未知算子: ${operatorId}`,
          cacheKey: '',
          latencyMs: 0,
        };
      },
    };

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);
      const handled = await handleV4ApiRequest(
        req,
        res,
        pathname,
        readJsonBody,
        sendJson,
        deps,
      );
      if (!handled) {
        sendJson(res, 404, { ok: false, error: 'Not Found' });
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const missingRes = await requestJson<{ ok: boolean; error: string }>(
        baseUrl,
        'POST',
        '/api/v4/system-dags/sys_non_existent/compare-sides',
        { runId: 'run_404' },
      );
      assert.equal(missingRes.status, 404);
      assert.equal(missingRes.data.ok, false);

      type SideEvalShape = {
        overallScore: number | null;
        rawOverallScore: number | null;
        gateVerdict: string;
        resolvedParamOverrides: Record<string, Record<string, unknown>>;
        nodeResults: Record<string, { score: number | null; status: string }>;
      };

      const compareRes = await requestJson<{
        ok: boolean;
        systemId: string;
        runId: string;
        metricGraphId: string;
        sides: string[];
        overall: SideEvalShape;
        bySide: Record<string, SideEvalShape>;
      }>(baseUrl, 'POST', '/api/v4/system-dags/sys_compare_3sides/compare-sides', {
        runId: 'run_sys_compare_1',
      });

      assert.equal(compareRes.status, 200);
      assert.equal(compareRes.data.ok, true);
      assert.equal(compareRes.data.systemId, 'sys_compare_3sides');
      assert.equal(compareRes.data.runId, 'run_sys_compare_1');
      assert.equal(compareRes.data.metricGraphId, 'mg_sys_compare_3sides');
      assert.deepEqual(compareRes.data.sides, ['绿方', '红方', '蓝方']);

      // 全量算子仅运行 1 次，且参数覆写成功透传至底层算子
      assert.equal(opCallCounts['strike.single_mission_metrics'], 1);
      assert.equal(opCallCounts['weapon.engagement'], 1);
      assert.equal(opCallCounts['roe.fratricide_count'], 1);
      assert.equal(opReceivedParams['roe.fratricide_count']?.zeroTolerance, true);
      assert.equal(opReceivedParams['strike.single_mission_metrics']?.targetSide, undefined);

      // overall: strike=mean(0.6,0.9,0.7,0.5)=0.675 (67.5), hit=mean(1.0,0.6,0.5)=0.7 (70)
      // dim_firepower = 0.6*67.5 + 0.4*70 = 68.5, 蓝方误伤导致 overall 触发 Hard GATE -> 封顶 39
      assert.ok(Math.abs((compareRes.data.overall.nodeResults['dim_firepower']?.score ?? 0) - 68.5) < 1e-6);
      assert.ok(Math.abs((compareRes.data.overall.rawOverallScore ?? 0) - 68.5) < 1e-6);
      assert.equal(compareRes.data.overall.gateVerdict, 'DISQUALIFIED');
      assert.equal(compareRes.data.overall.overallScore, 39);

      // 绿方: strike=60, hit=100 -> dim_firepower=76, PASS -> overallScore=76
      const green = compareRes.data.bySide['绿方'];
      assert.equal(green.gateVerdict, 'PASS');
      assert.ok(Math.abs((green.nodeResults['dim_firepower']?.score ?? 0) - 76) < 1e-6);
      assert.ok(Math.abs((green.rawOverallScore ?? 0) - 76) < 1e-6);
      assert.ok(Math.abs((green.overallScore ?? 0) - 76) < 1e-6);

      // 红方: strike=80, hit=60 -> dim_firepower=72, PASS -> overallScore=72
      const red = compareRes.data.bySide['红方'];
      assert.equal(red.gateVerdict, 'PASS');
      assert.ok(Math.abs((red.nodeResults['dim_firepower']?.score ?? 0) - 72) < 1e-6);
      assert.ok(Math.abs((red.rawOverallScore ?? 0) - 72) < 1e-6);
      assert.ok(Math.abs((red.overallScore ?? 0) - 72) < 1e-6);

      // 蓝方: strike=50, hit=50 -> dim_firepower=50, 误伤=1 触发 Hard GATE -> DISQUALIFIED, raw=50, overall=39
      const blue = compareRes.data.bySide['蓝方'];
      assert.equal(blue.gateVerdict, 'DISQUALIFIED');
      assert.ok(Math.abs((blue.nodeResults['dim_firepower']?.score ?? 0) - 50) < 1e-6);
      assert.ok(Math.abs((blue.rawOverallScore ?? 0) - 50) < 1e-6);
      assert.equal(blue.overallScore, 39);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
