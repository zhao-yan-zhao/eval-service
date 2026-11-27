import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ALL_V4_OPERATOR_SCRIPTS } from '../src/operators/v4/index.ts';
import { OPERATOR_PIPELINE_BLUEPRINTS } from '../src/operators/blueprints.ts';
import { deriveContractFromNodes } from '../src/operators/pipeline-utils.ts';
import { createEvalApp } from '../src/server.ts';

test('Stage 13.1 - 算子契约解析内核 (deriveContractFromNodes) 深度验证', () => {
  const mockNodes = [
    {
      id: 'node_1',
      type: 'data_input',
      title: '任务定义流',
      config: {
        csvTable: 'MissionChanged.csv',
        selectedColumns: ['MissionName', 'MissionID', 'Side', 'Category'],
        filterField: 'Side',
      },
    },
    {
      id: 'node_2',
      type: 'data_input',
      title: '走廊参考点',
      config: {
        csvTable: 'MissionRefPointRelationChanged',
        selectedColumns: ['Time', 'PointIndex', 'Longitude', 'Latitude'],
      },
    },
    {
      id: 'node_3',
      type: 'spatial',
      title: '空间走廊判定',
      config: {
        geomTable: 'MissionRefPointRelationChanged.csv',
        geomLonField: 'Longitude',
        geomLatField: 'Latitude',
        geomGroupField: 'MissionID',
        geomOrderField: 'PointIndex',
        minSafeMarginKm: 18.5,
        lonField: 'UnitLongitude',
        latField: 'UnitLatitude',
        altField: 'UnitAltitude_m',
        unitIdField: 'UnitID',
        spatialRule: 'corridor_check',
      },
    },
    {
      id: 'node_4',
      type: 'group_agg',
      title: '任务级聚合',
      config: {
        groupKeys: ['MissionID', 'MissionName'],
        aggregations: [
          { outputField: 'avg_margin', sourceField: 'MinMargin_km', method: 'AVERAGE' },
          { outputField: 'total_units', sourceField: 'UnitID', method: 'COUNT_ALL' },
        ],
      },
    },
    {
      id: 'node_5',
      type: 'result_output',
      title: '指标输出',
      config: {
        indicatorUnit: '合规率 (0-1)',
        optimalDirection: 'larger_is_better',
        thresholdLow: 0.88,
        thresholdHigh: 0.96,
      },
    },
  ];

  const derived = deriveContractFromNodes(mockNodes);
  assert.equal(derived.csvTables.length, 2);
  assert.ok(derived.csvTables.includes('MissionChanged'));
  assert.ok(derived.csvTables.includes('MissionRefPointRelationChanged'));

  for (const col of [
    'MissionName', 'MissionID', 'Side', 'Category', 'Time', 'PointIndex',
    'Longitude', 'Latitude', 'UnitLongitude', 'UnitLatitude', 'UnitAltitude_m',
    'UnitID', 'MinMargin_km',
  ]) {
    assert.ok(derived.csvColumns.includes(col), `应包含核心列 ${col}`);
  }

  assert.equal(derived.defaultParams.minSafeMarginKm, 18.5);
  assert.equal(derived.defaultParams.thresholdLow, 0.88);
  assert.equal(derived.defaultParams.thresholdHigh, 0.96);
  assert.equal(derived.unit, '合规率 (0-1)');
  assert.equal(derived.optimalDirection, 'larger_is_better');
  assert.ok(derived.discrepancyNotes[0].includes('自动接入 2 张事件底表'));

  assert.deepEqual(deriveContractFromNodes([]).csvTables, []);
  assert.deepEqual(deriveContractFromNodes([null, undefined, { type: 'unknown' }]).csvTables, []);
});

test('Stage 13.2 - V4 算子流水线持久化与单一真相源自动同步至 v4_operators (REST API)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-s13-v4-sync-'));
  const app = await createEvalApp({
    dbPath: path.join(tmpDir, 'eval.db'),
    operatorPipelinesPath: path.join(tmpDir, 'operator-pipelines.json'),
    distUiDir: tmpDir,
    autoSeed: false,
  });

  await new Promise<void>((resolve) => app.server.listen(0, resolve));
  const port = (app.server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /api/operator-pipelines/roe.corridor_spatial_compliance
    const getRes = await fetch(`${baseUrl}/api/operator-pipelines/roe.corridor_spatial_compliance`);
    assert.equal(getRes.status, 200);
    const getJson = (await getRes.json()) as {
      ok: boolean;
      operatorId: string;
      blueprint: unknown;
      pipeline: unknown;
      derivedContract: { csvTables: string[]; csvColumns: string[] };
    };
    assert.equal(getJson.ok, true);
    assert.equal(getJson.operatorId, 'roe.corridor_spatial_compliance');
    assert.ok(getJson.blueprint !== null || getJson.pipeline !== null);
    assert.ok(getJson.derivedContract.csvTables.length >= 4);

    // 2. POST /api/operator-pipelines 同步更新 V4 内置算子
    const postRes = await fetch(`${baseUrl}/api/operator-pipelines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorId: 'roe.corridor_spatial_compliance',
        pipelineTitle: '自动化测试空间合规流水线',
        nodes: [
          {
            id: 'node_inp_1',
            type: 'data_input',
            title: 'MissionChanged 接入',
            config: { csvTable: 'MissionChanged.csv', selectedColumns: ['MissionID', 'MissionName', 'Side'] },
          },
          {
            id: 'node_inp_2',
            type: 'data_input',
            title: 'UnitPositions 接入',
            config: { csvTable: 'UnitPositions.csv', selectedColumns: ['UnitID', 'UnitLongitude', 'UnitLatitude'] },
          },
          {
            id: 'node_geo_1',
            type: 'spatial',
            title: '走廊判定',
            config: {
              geomTable: 'MissionRefPointRelationChanged.csv',
              minSafeMarginKm: 20.0,
              lonField: 'UnitLongitude',
              latField: 'UnitLatitude',
              unitIdField: 'UnitID',
            },
          },
          {
            id: 'node_out_1',
            type: 'result_output',
            title: '合规率输出',
            config: { thresholdLow: 0.9, thresholdHigh: 0.98, indicatorUnit: '比例 (0-1)' },
          },
        ],
        edges: [
          { id: 'e1', sourceNodeId: 'node_inp_1', targetNodeId: 'node_geo_1' },
          { id: 'e2', sourceNodeId: 'node_inp_2', targetNodeId: 'node_geo_1' },
          { id: 'e3', sourceNodeId: 'node_geo_1', targetNodeId: 'node_out_1' },
        ],
      }),
    });
    assert.equal(postRes.status, 200);
    const postJson = (await postRes.json()) as { ok: boolean; derivedContract?: { csvTables: string[] } };
    assert.equal(postJson.ok, true);
    assert.ok(postJson.derivedContract?.csvTables.includes('MissionChanged'));

    // 3. 新建 V4 自定义算子并同步流水线
    const createCustomRes = await fetch(`${baseUrl}/api/v4/operators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'custom.s13_v4_sync_op',
        name: '测试同步 V4 自定义算子',
        chapter: 8,
        category: 'effectiveness',
        militaryLevel: 'MOP',
        domainTag: 'firepower',
        description: 'V4 自定义算子契约同步测试',
        requiredTables: ['WeaponFired'],
        parameterPorts: [],
        outputColumns: ['分方', 'value'],
        pythonCode: 'import pandas as pd\noutput_df = pd.DataFrame([{"分方": "红方", "value": 1.0}])',
      }),
    });
    assert.equal(createCustomRes.status, 200);

    const saveCustomPipeRes = await fetch(`${baseUrl}/api/operator-pipelines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorId: 'custom.s13_v4_sync_op',
        pipelineTitle: 'V4 自定义算子流水线',
        nodes: [
          {
            id: 'c_inp',
            type: 'data_input',
            config: { csvTable: 'WeaponFired.csv', selectedColumns: ['WeaponID', 'FiringUnitID'] },
          },
          {
            id: 'c_out',
            type: 'result_output',
            config: { indicatorUnit: '发/分', optimalDirection: 'larger_is_better' },
          },
        ],
        edges: [{ id: 'ce1', sourceNodeId: 'c_inp', targetNodeId: 'c_out' }],
      }),
    });
    assert.equal(saveCustomPipeRes.status, 200);

    const fetchedOp = (await fetch(`${baseUrl}/api/v4/operators/custom.s13_v4_sync_op`).then((r) =>
      r.json(),
    )) as { ok: boolean; operator: { id: string; requiredTables: string[] } };
    assert.equal(fetchedOp.ok, true);
    assert.ok(fetchedOp.operator.requiredTables.includes('WeaponFired'));
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Stage 13.3 - 42 个 V4 内置算子元数据、实证底表契约与专属流水线蓝图全量审计', () => {
  assert.equal(ALL_V4_OPERATOR_SCRIPTS.length, 42, '必须严格包含 42 个唯一 V4 内置标准算子');

  for (const op of ALL_V4_OPERATOR_SCRIPTS) {
    assert.ok(op.id && op.id.length > 3, `算子 ID 非法: ${op.id}`);
    assert.ok(op.name && op.name.length > 1, `算子名称非法: ${op.id}`);
    assert.ok(op.description && op.description.length > 5, `算子说明不充分: ${op.id}`);
    assert.ok(op.requiredTables.length > 0, `算子 ${op.id} 必须声明至少 1 张 requiredTables`);
    assert.ok(op.outputColumns.length > 0, `算子 ${op.id} 必须声明 outputColumns`);

    const bp = OPERATOR_PIPELINE_BLUEPRINTS[op.id];
    assert.ok(bp, `算子 ${op.id} 缺少专属流水线蓝图`);
    assert.equal(bp.operatorId, op.id);
    assert.ok(bp.nodes && bp.nodes.length >= 3, `算子 ${op.id} 流水线节点不足 3 个`);
    assert.ok(bp.edges && bp.edges.length >= 2, `算子 ${op.id} 流水线连线不足 2 条`);

    for (const node of bp.nodes) {
      if (node.type === 'data_input') {
        const cfg = node.config || {};
        if (
          cfg.filterField === 'Side' ||
          cfg.filterField === 'FiringUnitSide' ||
          cfg.filterField === 'TargetSide'
        ) {
          assert.fail(`算子 ${op.id} 输入节点 ${node.id} 存在初期阵营硬过滤`);
        }
      }
    }
  }
});
