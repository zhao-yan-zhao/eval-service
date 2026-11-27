import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EvalSqliteStore, type StoredV4EvalRecord } from '../src/adapters/sqlite-store.ts';
import type { EvaluationDagOutput, EvaluationSystemDag, V4MetricSnapshotItem } from '../src/core/types.ts';
import { EffectStore } from '../src/effects/store.ts';
import { handleV4ApiRequest, type V4RouteDeps } from '../src/engine/v4-routes.ts';
import { MetricGraphStore } from '../src/indicators/metric-graph-store.ts';
import { SystemDagStore } from '../src/systems/system-dag-store.ts';
import {
  buildHierarchyDetailRows,
  collectV4EvidenceItems,
  extractLeafDiagnosticPoints,
  extractPrimaryDimensions,
  formatMetricObjectiveValue,
  generateV4ReportMarkdown,
  serializeMetricSliceToCsv,
} from '../src/ui/components/cockpit/cockpit-v4-helpers.ts';

function makeEvalOutput(evalId: string, overallScore: number | null, sideLabel = '综合'): EvaluationDagOutput {
  return {
    evalId,
    runId: 'run_test_01',
    systemId: 'sys_test_v4',
    systemName: '测试V4体系',
    systemVersion: '1.0.0',
    createdAt: '2026-11-25T10:00:00.000Z',
    terminalEffectNodeId: 'eff_root',
    overallScore,
    rawOverallScore: overallScore,
    gateVerdict: 'PASS',
    gateAudit: [
      {
        atomId: 'gate_loss',
        name: '战损红线',
        gateMode: 'hard',
        gateStatus: 'pass',
        displayValue: '12%',
        evidenceRefs: [],
      },
    ],
    availableWeightRatio: 0.8,
    topologicalOrder: ['m1', 'm2', 'dim_1', 'dim_2', 'eff_root'],
    nodeResults: {
      eff_root: {
        nodeId: 'eff_root',
        label: '综合效能',
        role: 'effect',
        score: overallScore,
        status: 'valid',
        availableWeightRatio: 0.8,
        effectiveWeights: { e_d1: 0.6, e_d2: 0.4 },
        evidenceRefs: [],
        incomingEdgeIds: ['e_d1', 'e_d2'],
        depth: 0,
      },
      dim_1: {
        nodeId: 'dim_1',
        label: '火力打击',
        role: 'effect',
        score: 88,
        status: 'valid',
        availableWeightRatio: 1,
        effectiveWeights: { e_m1: 1 },
        evidenceRefs: [],
        incomingEdgeIds: ['e_m1'],
        depth: 1,
      },
      dim_2: {
        nodeId: 'dim_2',
        label: '态势感知',
        role: 'effect',
        score: null,
        status: 'unavailable',
        availableWeightRatio: 0,
        effectiveWeights: {},
        missingDataReason: '缺少 ContactCreated.csv',
        evidenceRefs: [],
        incomingEdgeIds: ['e_m2'],
        depth: 1,
      },
      m1: {
        nodeId: 'm1',
        label: '打击任务完成比',
        role: 'metric_proxy',
        score: 88,
        rawValue: 0.88,
        status: 'valid',
        availableWeightRatio: 1,
        effectiveWeights: {},
        evidenceRefs: [
          {
            source: 'csv',
            ref: 'MissionChanged.csv#1',
            scenarioClock: '00:12:00',
            description: `${sideLabel} 打击任务完成`,
            snippet: { rate: 0.88 },
          },
        ],
        incomingEdgeIds: [],
        depth: 2,
      },
      m2: {
        nodeId: 'm2',
        label: '目标发现率',
        role: 'metric_proxy',
        score: null,
        status: 'unavailable',
        availableWeightRatio: 0,
        effectiveWeights: {},
        missingDataReason: '缺少 ContactCreated.csv',
        evidenceRefs: [],
        incomingEdgeIds: [],
        depth: 2,
      },
    },
  };
}

test('SqliteEvalStore: saveV4Evaluation, listV4Evaluations, getV4Evaluation, deleteV4Evaluation', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-v4-eval-'));
  const dbPath = path.join(tmpDir, 'eval.db');
  const store = new EvalSqliteStore(dbPath);
  try {
    const overall = makeEvalOutput('v4eval_1', 82.5);
    const red = makeEvalOutput('v4eval_1_红方', 86.0, '红方');
    const truncatedRows = Array.from({ length: 200 }, (_, i) => ({ unit: `U${i}`, rate: 0.85 }));
    const sampleSnapshots: V4MetricSnapshotItem[] = [
      {
        metricId: 'strike.rate',
        proxyNodeId: 'm1',
        label: '打击任务完成比',
        parentEffectId: 'dim_1',
        parentEffectLabel: '火力打击',
        targetField: 'rate',
        reduce: 'mean',
        overall: {
          status: 'valid',
          value: 0.88,
          columns: [{ name: 'unit', type: 'string' }, { name: 'rate', type: 'number' }],
          rows: truncatedRows,
          totalRows: 250,
          truncated: true,
        },
        bySide: {
          红方: {
            status: 'valid',
            value: 0.91,
            columns: [{ name: 'unit', type: 'string' }, { name: 'rate', type: 'number' }],
            rows: [{ unit: 'U1', rate: 0.91 }],
            totalRows: 1,
            truncated: false,
          },
        },
      },
    ];

    const record: StoredV4EvalRecord = {
      evalId: 'v4eval_1',
      runId: 'run_test_01',
      dataSourceId: 'ds_1',
      systemId: 'sys_test_v4',
      systemName: '测试V4体系',
      systemVersion: '1.0.0',
      metricGraphId: 'mg_1',
      sides: ['红方'],
      overallScore: 82.5,
      gateVerdict: 'PASS',
      availableWeightRatio: 0.8,
      sideSummaries: [
        {
          side: '红方',
          overallScore: 86.0,
          rawOverallScore: 86.0,
          gateVerdict: 'PASS',
          availableWeightRatio: 0.8,
        },
      ],
      overall,
      bySide: { 红方: red },
      metricSnapshots: sampleSnapshots,
      createdAt: '2026-11-25T10:00:00.000Z',
    };

    store.saveV4Evaluation(record);
    const listAll = store.listV4Evaluations();
    assert.equal(listAll.length, 1);
    assert.equal(listAll[0].evalId, 'v4eval_1');
    assert.deepEqual(listAll[0].sides, ['红方']);

    const byRun = store.listV4Evaluations('run_test_01');
    assert.equal(byRun.length, 1);
    assert.equal(store.listV4Evaluations('other_run').length, 0);

    const loaded = store.getV4Evaluation('v4eval_1');
    assert.ok(loaded);
    assert.equal(loaded.overall.overallScore, 82.5);
    assert.equal(loaded.bySide['红方']?.overallScore, 86.0);
    assert.equal(loaded.metricSnapshots?.length, 1);
    assert.equal(loaded.metricSnapshots?.[0].overall.totalRows, 250);
    assert.equal(loaded.metricSnapshots?.[0].overall.truncated, true);
    assert.equal(loaded.metricSnapshots?.[0].overall.rows.length, 200);
    assert.equal(loaded.metricSnapshots?.[0].bySide['红方']?.value, 0.91);

    assert.equal(store.deleteV4Evaluation('v4eval_1'), true);
    assert.equal(store.getV4Evaluation('v4eval_1'), null);
    assert.equal(store.listV4Evaluations().length, 0);
  } finally {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('v4-routes: compare-sides persists by default, skips with persist=false, and GET/DELETE evaluations work', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-v4-route-eval-'));
  const dbPath = path.join(tmpDir, 'eval.db');
  const store = new EvalSqliteStore(dbPath);
  try {
    const effectStore = new EffectStore(store);
    const metricGraphStore = new MetricGraphStore('', { sqliteStore: store });
    const systemDagStore = new SystemDagStore(store, effectStore);

    effectStore.upsertCustom({
      effectId: 'eff_test_metric',
      name: '测试命中率效果',
      role: 'effect',
      domainTag: 'firepower',
      metricBinding: {
        metricId: 'm_hit_rate',
        reduce: 'mean',
        scoringRule: { type: 'larger_is_better', optimal: 1, worst: 0 },
      },
      aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
    });

    metricGraphStore.upsert({
      graphId: 'mg_test_cockpit',
      name: '测试指标图',
      graphKind: 'metric',
      nodes: [
        {
          id: 'n_op',
          kind: 'metric',
          label: '命中率',
          position: { x: 0, y: 0 },
          metricConfig: {
            metricId: 'm_hit_rate',
            name: '命中率',
            militaryLevel: 'MOP',
            domainTag: 'firepower',
            mode: 'from_operator',
            sourceRef: 'op_hit',
            targetField: 'rate',
            reduce: 'mean',
          },
        },
      ],
      edges: [],
    });

    systemDagStore.upsert({
      systemId: 'sys_test_cockpit',
      name: '测试评估体系',
      version: '1.0.0',
      metricGraphId: 'mg_test_cockpit',
      terminalEffectNodeId: 'eff_test_metric',
      nodes: [
        {
          id: 'mp_hit_rate',
          kind: 'metric_proxy',
          refId: 'm_hit_rate',
          label: '命中率',
          position: { x: 0, y: 100 },
        },
        {
          id: 'eff_test_metric',
          kind: 'effect',
          label: '测试命中率效果',
          position: { x: 200, y: 100 },
          inlineEffect: {
            effectId: 'eff_test_metric',
            name: '测试命中率效果',
            role: 'effect',
            domainTag: 'firepower',
            metricBinding: {
              metricId: 'm_hit_rate',
              targetField: 'rate',
              reduce: 'mean',
              scoringRule: { type: 'larger_is_better', optimal: 1, worst: 0 },
            },
            aggregation: { strategy: 'weighted_sum', missingPolicy: 'skip_renormalize' },
          },
        },
      ],
      edges: [
        { id: 'e_mp_eff', sourceNodeId: 'mp_hit_rate', targetNodeId: 'eff_test_metric', weight: 1 },
      ],
    } as Parameters<typeof systemDagStore.upsert>[0]);

    const deps: V4RouteDeps = {
      effectStore,
      metricGraphStore,
      systemDagStore,
      getEvalStore: () => store,
      listOperators: () => [],
      runOperator: async () => ({
        nodeId: 'op_hit',
        operatorId: 'op_hit',
        status: 'valid',
        cacheKey: 'ck_op_hit',
        dataset: {
          id: 'ds_op_hit',
          columns: [
            { name: '分方', displayName: '分方', type: 'string' },
            { name: 'rate', displayName: 'rate', type: 'number' },
          ],
          schema: [
            { name: '分方', displayName: '分方', type: 'string' },
            { name: 'rate', displayName: 'rate', type: 'number' },
          ],
          rows: [
            { 分方: '红方', rate: 0.9 },
            { 分方: '蓝方', rate: 0.6 },
          ],
          totalRows: 2,
        },
        evidenceRefs: [],
        latencyMs: 1,
      }),
    };

    const callRoute = async (method: string, reqUrl: string, bodyObj?: unknown) => {
      const pathname = reqUrl.split('?')[0];
      let status = 200;
      let payload: any = null;
      const req = { method, url: reqUrl } as IncomingMessage;
      const res = {} as ServerResponse;
      const handled = await handleV4ApiRequest(
        req,
        res,
        pathname,
        async () => (bodyObj ?? {}) as Record<string, unknown>,
        (_r, st, data) => {
          status = st;
          payload = data;
        },
        deps,
      );
      return { handled, status, payload };
    };

    // 1. persist=false 不落库
    const dryRes = await callRoute('POST', '/api/v4/system-dags/sys_test_cockpit/compare-sides', {
      runId: 'run_dry',
      persist: false,
    });
    assert.equal(dryRes.handled, true);
    assert.equal(dryRes.status, 200);
    assert.deepEqual(dryRes.payload.sides, ['红方', '蓝方']);
    assert.equal(store.listV4Evaluations().length, 0);

    // 2. 默认落库
    const saveRes = await callRoute('POST', '/api/v4/system-dags/sys_test_cockpit/compare-sides', {
      runId: 'run_saved',
    });
    assert.equal(saveRes.status, 200);
    assert.ok(saveRes.payload.evalId);
    assert.equal(saveRes.payload.metricSnapshots?.length, 1);
    assert.equal(saveRes.payload.metricSnapshots?.[0].metricId, 'm_hit_rate');
    assert.equal(saveRes.payload.metricSnapshots?.[0].overall.totalRows, 2);
    assert.equal(saveRes.payload.metricSnapshots?.[0].bySide['红方']?.totalRows, 1);
    const evalId = saveRes.payload.evalId as string;

    const listRes = await callRoute('GET', '/api/v4/evaluations?runId=run_saved');
    assert.equal(listRes.status, 200);
    assert.equal(listRes.payload.evaluations.length, 1);
    assert.equal(listRes.payload.evaluations[0].evalId, evalId);

    const getRes = await callRoute('GET', `/api/v4/evaluations/${encodeURIComponent(evalId)}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.payload.evaluation.bySide['红方'].overallScore, 90);
    assert.equal(getRes.payload.evaluation.metricSnapshots?.length, 1);

    const delRes = await callRoute('DELETE', `/api/v4/evaluations/${encodeURIComponent(evalId)}`);
    assert.equal(delRes.status, 200);
    assert.equal(delRes.payload.deleted, true);
    assert.equal(store.listV4Evaluations().length, 0);
  } finally {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('cockpit-v4-helpers: dimension extraction, quadrant weights, hierarchy, evidence, and markdown report', () => {
  const systemDag: EvaluationSystemDag = {
    systemId: 'sys_test_v4',
    name: '测试V4体系',
    version: '1.0.0',
    terminalEffectNodeId: 'eff_root',
    nodes: [
      { id: 'eff_root', kind: 'effect', label: '综合效能', position: { x: 600, y: 100 } },
      { id: 'dim_1', kind: 'effect', label: '火力打击', position: { x: 300, y: 50 } },
      { id: 'dim_2', kind: 'effect', label: '态势感知', position: { x: 300, y: 150 } },
      { id: 'm1', kind: 'metric_proxy', refId: 'strike.rate', label: '打击任务完成比', position: { x: 50, y: 50 } },
      { id: 'm2', kind: 'metric_proxy', refId: 'isr.detect', label: '目标发现率', position: { x: 50, y: 150 } },
    ],
    edges: [
      { id: 'e_d1', sourceNodeId: 'dim_1', targetNodeId: 'eff_root', weight: 0.6 },
      { id: 'e_d2', sourceNodeId: 'dim_2', targetNodeId: 'eff_root', weight: 0.4 },
      { id: 'e_m1', sourceNodeId: 'm1', targetNodeId: 'dim_1', weight: 1 },
      { id: 'e_m2', sourceNodeId: 'm2', targetNodeId: 'dim_2', weight: 1 },
    ],
  };

  const overall = makeEvalOutput('e1', 88);
  const bySide = { 红方: makeEvalOutput('e1_red', 91, '红方') };

  const dims = extractPrimaryDimensions(systemDag, overall, bySide, ['红方']);
  assert.equal(dims.length, 2);
  assert.equal(dims[0].label, '火力打击');
  assert.equal(dims[0].weight, 0.6);
  assert.equal(dims[0].bySideScores['红方'], 88);

  const leaves = extractLeafDiagnosticPoints(systemDag, overall, bySide, ['红方'], 'ALL');
  assert.equal(leaves.length, 2);
  assert.equal(leaves[0].nodeId, 'dim_1');
  assert.equal(leaves[0].score, 88);
  assert.equal(leaves[0].cascadingWeight, 0.6);
  assert.equal(leaves[1].nodeId, 'dim_2');
  assert.equal(leaves[1].status, 'unavailable');

  const snaps: V4MetricSnapshotItem[] = [
    {
      metricId: 'strike.rate',
      proxyNodeId: 'm1',
      label: '打击任务完成比',
      parentEffectId: 'dim_1',
      parentEffectLabel: '火力打击',
      targetField: 'rate',
      reduce: 'mean',
      overall: {
        status: 'valid',
        value: 0.88,
        columns: [{ name: 'unit', type: 'string' }, { name: 'rate', type: 'number' }],
        rows: [{ unit: 'A,1', rate: 0.88 }],
        totalRows: 1,
        truncated: false,
      },
      bySide: {
        红方: {
          status: 'valid',
          value: 0.91,
          columns: [{ name: 'unit', type: 'string' }, { name: 'rate', type: 'number' }],
          rows: [{ unit: 'A,1', rate: 0.91 }],
          totalRows: 1,
          truncated: false,
        },
      },
    },
  ];

  const rows = buildHierarchyDetailRows(systemDag, overall, bySide, ['红方'], snaps);
  assert.ok(rows.some((r) => r.kind === 'terminal'));
  assert.ok(rows.some((r) => r.kind === 'dimension' && r.label === '火力打击'));
  const proxyRow = rows.find((r) => r.kind === 'metric_proxy' && r.metricId === 'strike.rate');
  assert.ok(proxyRow);
  assert.equal(proxyRow.weight, null);
  assert.equal(proxyRow.bySideRawValues?.['红方'], 0.91);
  assert.equal(proxyRow.bySideRowCounts?.['红方'], 1);

  assert.equal(formatMetricObjectiveValue(0.88, 'rate'), '88.0%');
  assert.equal(formatMetricObjectiveValue(null, 'rate'), '--');

  const csv = serializeMetricSliceToCsv(snaps[0].overall);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"A,1",0.88'));

  const evs = collectV4EvidenceItems(overall, bySide, ['红方']);
  assert.equal(evs.length, 2);

  const md = generateV4ReportMarkdown(
    {
      systemId: 'sys_test_v4',
      systemName: '测试V4体系',
      systemVersion: '1.0.0',
      runId: 'run_test_01',
      createdAt: '2026-11-25T10:00:00.000Z',
      sides: ['红方'],
      overall,
      bySide,
    },
    systemDag,
  );
  assert.ok(md.includes('测试V4体系 — 评估简报'));
  assert.ok(md.includes('缺少 ContactCreated.csv'));
});
