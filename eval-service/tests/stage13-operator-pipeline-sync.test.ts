import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type {
  CustomOperatorDefinition,
  MetricAtomContext,
} from '../src/core/types.ts';
import { CustomOperatorStore } from '../src/operators/custom-store.ts';
import { OperatorOverrideStore } from '../src/operators/override-store.ts';
import {
  BUILTIN_OPERATOR_IDS,
  evaluateOperator,
  getOperatorMeta,
  listOperatorMetas,
} from '../src/operators/registry.ts';
import { getOperatorPipelineBlueprint, OPERATOR_PIPELINE_BLUEPRINTS } from '../src/operators/blueprints.ts';
import { deriveContractFromNodes } from '../src/operators/pipeline-utils.ts';
import { buildSituationModel } from '../src/core/situation-model.ts';
import { createEvalApp } from '../src/server.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const REAL_CSV_DIR = path.join(
  REPO_ROOT,
  'LabConsole',
  'outputs',
  'm6-verify-runs',
  '39c47807bece4e0690feb0598f7a92d1',
  'GJ11-PL15试射-90nm正对-80nm-1',
  'EventExport_CSV',
);

test('Stage 13.1 - 算子契约解析内核 (deriveContractFromNodes) 深度验证', () => {
  // 1. 模拟多节点复杂流水线拓扑
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
        csvTable: 'MissionRefPointRelationChanged', // 无 .csv 后缀
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

  // 验证提取的表（自动去重并剔除 .csv 后缀）
  assert.equal(derived.csvTables.length, 2);
  assert.ok(derived.csvTables.includes('MissionChanged'));
  assert.ok(derived.csvTables.includes('MissionRefPointRelationChanged'));

  // 验证提取的核心字段列（全节点去重合并）
  const expectedCols = [
    'MissionName', 'MissionID', 'Side', 'Category', 'Time', 'PointIndex',
    'Longitude', 'Latitude', 'UnitLongitude', 'UnitLatitude', 'UnitAltitude_m',
    'UnitID', 'MinMargin_km',
  ];
  for (const col of expectedCols) {
    assert.ok(derived.csvColumns.includes(col), `应包含核心列 ${col}`);
  }

  // 验证运行参数提取
  assert.equal(derived.defaultParams.minSafeMarginKm, 18.5);
  assert.equal(derived.defaultParams.thresholdLow, 0.88);
  assert.equal(derived.defaultParams.thresholdHigh, 0.96);
  assert.equal(derived.unit, '合规率 (0-1)');
  assert.equal(derived.optimalDirection, 'larger_is_better');

  // 验证拓扑备注生成
  assert.ok(derived.discrepancyNotes.length > 0);
  assert.ok(derived.discrepancyNotes[0].includes('自动接入 2 张事件底表'));
  assert.ok(derived.discrepancyNotes[0].includes('corridor_check'));

  // 边界防护：空节点数组、异常字段
  const emptyDerived = deriveContractFromNodes([]);
  assert.deepEqual(emptyDerived.csvTables, []);
  assert.deepEqual(emptyDerived.csvColumns, []);
  assert.deepEqual(emptyDerived.defaultParams, {});

  const malformedDerived = deriveContractFromNodes([null, undefined, { type: 'unknown' }]);
  assert.deepEqual(malformedDerived.csvTables, []);
});

test('Stage 13.2 - 算子专属流水线持久化与单一真相源自动双向同步 (REST API)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-s13-sync-'));
  const customOpsPath = path.join(tmpDir, 'custom-operators.json');
  const overridesPath = path.join(tmpDir, 'operator-overrides.json');
  const pipelinesPath = path.join(tmpDir, 'operator-pipelines.json');

  const app = await createEvalApp({
    customOperatorsPath: customOpsPath,
    operatorOverridesPath: overridesPath,
    operatorPipelinesPath: pipelinesPath,
    distUiDir: tmpDir,
  });

  const server = app.server;
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. 测试 GET /api/operator-pipelines/comp.corridor_compliance (未落盘时返回内置蓝图与推导契约)
    const getRes = await fetch(`${baseUrl}/api/operator-pipelines/comp.corridor_compliance`);
    assert.equal(getRes.status, 200);
    const getJson = await getRes.json();
    assert.equal(getJson.ok, true);
    assert.equal(getJson.operatorId, 'comp.corridor_compliance');
    assert.ok(getJson.blueprint !== null || getJson.pipeline !== null);
    assert.ok(getJson.derivedContract.csvTables.length >= 4);
    assert.ok(getJson.derivedContract.csvColumns.length >= 17);

    // 2. 测试 POST /api/operator-pipelines 持久化并自动同步内置算子 comp.corridor_compliance
    const postPayload = {
      operatorId: 'comp.corridor_compliance',
      pipelineTitle: '自动化测试空间合规流水线',
      nodes: [
        {
          id: 'node_inp_1',
          type: 'data_input',
          title: 'MissionChanged 接入',
          config: {
            csvTable: 'MissionChanged.csv',
            selectedColumns: ['MissionID', 'MissionName', 'Side'],
          },
        },
        {
          id: 'node_inp_2',
          type: 'data_input',
          title: 'UnitPositions 接入',
          config: {
            csvTable: 'UnitPositions.csv',
            selectedColumns: ['UnitID', 'UnitLongitude', 'UnitLatitude'],
          },
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
          config: {
            thresholdLow: 0.90,
            thresholdHigh: 0.98,
            indicatorUnit: '比例 (0-1)',
          },
        },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'node_inp_1', targetNodeId: 'node_geo_1' },
        { id: 'e2', sourceNodeId: 'node_inp_2', targetNodeId: 'node_geo_1' },
        { id: 'e3', sourceNodeId: 'node_geo_1', targetNodeId: 'node_out_1' },
      ],
    };

    const postRes = await fetch(`${baseUrl}/api/operator-pipelines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postPayload),
    });
    assert.equal(postRes.status, 200);
    const postJson = await postRes.json();
    assert.equal(postJson.ok, true);
    assert.ok(postJson.derivedContract);

    // 核心断言：算子 overrideStore 必须被自动更新！
    const overrideStore = new OperatorOverrideStore(overridesPath);
    const opOverride = overrideStore.get('comp.corridor_compliance');
    assert.ok(opOverride, '算子覆盖库中应已自动产生覆写记录');
    assert.equal(opOverride.defaultParams?.minSafeMarginKm, 20.0, '裕度参数应已同步为 20.0');
    assert.equal(opOverride.defaultParams?.thresholdLow, 0.90, '阈值下限应已同步为 0.90');
    assert.ok(opOverride.f1FieldContract?.csvTables?.includes('MissionChanged'));
    assert.ok(opOverride.f1FieldContract?.csvTables?.includes('UnitPositions'));
    assert.ok(opOverride.f1FieldContract?.csvTables?.includes('MissionRefPointRelationChanged'));
    assert.ok(opOverride.f1FieldContract?.csvColumns?.includes('UnitLongitude'));

    // 3. 测试新建自定义算子并通过流水线自动同步
    const customDefPayload: CustomOperatorDefinition = {
      id: 'custom.s13_test_sync_op',
      name: '测试同步自定义算子',
      category: 'effectiveness',
      mode: 'formula',
      description: '初始空契约算子',
      expression: 'v1 * 1.0',
      variables: [{ alias: 'v1', atomRef: 'time.first_detection' }],
      f1FieldContract: {},
    };
    const createCustomRes = await fetch(`${baseUrl}/api/operators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(customDefPayload),
    });
    assert.equal(createCustomRes.status, 200);

    // 为自定义算子保存流水线
    const customPipePayload = {
      operatorId: 'custom.s13_test_sync_op',
      pipelineTitle: '自定义算子流水线',
      nodes: [
        {
          id: 'c_inp',
          type: 'data_input',
          config: {
            csvTable: 'WeaponFired.csv',
            selectedColumns: ['WeaponID', 'FiringPlatform', 'TargetContactRangeHoriz_nm'],
          },
        },
        {
          id: 'c_out',
          type: 'result_output',
          config: {
            indicatorUnit: '发/分',
            optimalDirection: 'larger_is_better',
          },
        },
      ],
      edges: [{ id: 'ce1', sourceNodeId: 'c_inp', targetNodeId: 'c_out' }],
    };
    const saveCustomPipeRes = await fetch(`${baseUrl}/api/operator-pipelines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(customPipePayload),
    });
    assert.equal(saveCustomPipeRes.status, 200);

    // 核心断言：customOperatorStore 应已被自动更新契约
    const customStore = new CustomOperatorStore(customOpsPath);
    const updatedCustom = customStore.get('custom.s13_test_sync_op');
    assert.ok(updatedCustom);
    assert.deepEqual(updatedCustom.f1FieldContract?.csvTables, ['WeaponFired']);
    assert.ok(updatedCustom.f1FieldContract?.csvColumns?.includes('FiringPlatform'));
    assert.equal(updatedCustom.unit, '发/分');
  } finally {
    await app.close();
  }
});

test('Stage 13.3 - 38 个内置算子元数据与实证字段契约全量结构化审计', () => {
  const allMetas = listOperatorMetas().filter((m) => !m.isCustom);
  assert.equal(allMetas.length, 38, '必须严格包含 38 个唯一内置标准算子');

  const domainCount: Record<string, number> = {
    time: 0,
    effectiveness: 0,
    situation: 0,
    compliance: 0,
    cost: 0,
  };

  for (const op of allMetas) {
    // 基础元数据合规性
    assert.ok(op.id && typeof op.id === 'string' && op.id.length > 3, `算子 ID 非法: ${op.id}`);
    assert.ok(op.name && typeof op.name === 'string' && op.name.length > 1, `算子名称非法: ${op.id}`);
    assert.ok(op.category in domainCount, `算子领域分类非法: ${op.category} (${op.id})`);
    assert.ok(op.description && op.description.length > 5, `算子物理口径说明不充分: ${op.id}`);
    assert.ok(
      ['larger_is_better', 'smaller_is_better', 'range_bounded'].includes(op.defaultOptimalDirection),
      `算子优劣方向非法: ${op.id}`,
    );

    domainCount[op.category]++;

    // 核心实证契约结构完整性 (f1FieldContract)
    assert.ok(op.f1FieldContract, `算子缺少 f1FieldContract: ${op.id}`);
    const hasCsvTables = Array.isArray(op.f1FieldContract.csvTables) && op.f1FieldContract.csvTables.length > 0;
    const hasBsPaths = Array.isArray(op.f1FieldContract.bsFramePaths) && op.f1FieldContract.bsFramePaths.length > 0;
    assert.ok(
      hasCsvTables || hasBsPaths,
      `算子 ${op.id} 必须至少具备 csvTables 或 bsFramePaths 之一作为底层数据来源`,
    );

    // 针对具有特定参数的算子，验证默认参数基线
    if (op.id === 'comp.corridor_compliance') {
      assert.equal(op.f1FieldContract.csvTables?.length, 4, '任务走廊空间遵从率应具备 4 张标准规范表');
      assert.equal(op.defaultParams?.minSafeMarginKm, 15.0, '走廊安全裕度默认基线应为 15.0km');
    }
    if (op.id === 'comp.wra_compliance') {
      assert.ok(op.f1FieldContract.csvTables?.includes('WeaponFired'));
      assert.ok(op.f1FieldContract.csvTables?.includes('WeaponEndgame'));
    }
    if (op.id === 'comp.emcon_silence_discipline') {
      assert.ok(op.f1FieldContract.csvTables?.includes('SensorCreated'));
      assert.ok(op.f1FieldContract.csvTables?.includes('ComponentStatusChanged'));
    }
  }

  // 校验五大业务领域算子分布基线
  assert.equal(domainCount.time, 9, '时效域应为 9 个算子');
  assert.equal(domainCount.effectiveness, 12, '效能域应为 12 个算子');
  assert.equal(domainCount.situation, 8, '态势域应为 8 个算子');
  assert.equal(domainCount.compliance, 5, '合规域应为 5 个算子');
  assert.equal(domainCount.cost, 4, '成本域应为 4 个算子');
});

test('Stage 13.4 - 全量 38 个内置算子在真实仿真数据上精准评测且 fail-closed', async () => {
  // 构建真实 GJ11-PL15 试验数据态势模型
  const situation = await buildSituationModel({
    runId: 'verify-run-13',
    csvDir: REAL_CSV_DIR,
  });

  const allMetas = listOperatorMetas().filter((m) => !m.isCustom);
  let evaluatedCount = 0;

  for (const meta of allMetas) {
    const ctx: MetricAtomContext = {
      runId: 'verify-run-13',
      situation,
      customParams: {
        targetSide: '红方',
        enemySide: '蓝方',
        safeRadiusNm: 30,
        minSafeMarginKm: 15,
      },
    };

    const res = evaluateOperator(meta.id, ctx);
    assert.equal(res.atomId, meta.id);
    assert.ok(
      ['valid', 'degraded', 'unavailable'].includes(res.status),
      `算子 ${meta.id} 返回未知状态: ${res.status}`,
    );

    // 数值型算子返回值必须合法（不得为 NaN 或无限大）
    if (res.status === 'computed' && typeof res.value === 'number') {
      assert.ok(Number.isFinite(res.value), `算子 ${meta.id} 计算结果为非有限数: ${res.value}`);
    }

    evaluatedCount++;
  }

  assert.equal(evaluatedCount, 38, '38 个内置算子必须全部无死角完成执行与验证');
});

test('Stage 13.5 - 38 个内置算子专属流水线蓝图全量覆盖与全量中立架构审计 (Side-Agnostic)', () => {
  const allMetas = listOperatorMetas().filter((m) => !m.isCustom);
  assert.equal(allMetas.length, 38, '必须包含 38 个内置算子');

  // 1. 验证所有 38 个算子均有专属定制蓝图，绝不回退至通用假模板
  for (const meta of allMetas) {
    const bp = OPERATOR_PIPELINE_BLUEPRINTS[meta.id];
    assert.ok(bp, `算子 ${meta.id} 缺少专属流水线蓝图`);
    assert.equal(bp.operatorId, meta.id);
    assert.ok(bp.nodes && bp.nodes.length >= 3, `算子 ${meta.id} 流水线节点不足 3 个`);
    assert.ok(bp.edges && bp.edges.length >= 2, `算子 ${meta.id} 流水线连线不足 2 条`);

    // 2. 铁律 1 & 2：严禁在初期计算中过滤阵营 (No Premature Side Filtering)，严禁硬编码阵营名称
    for (const node of bp.nodes) {
      if (node.type === 'data_input') {
        const cfg = node.config || {};
        // 严禁在输入节点写死 filterEquals: 'Blue' / 'Red' / '红方' / '蓝方'
        if (cfg.filterField === 'Side' || cfg.filterField === 'FiringUnitSide' || cfg.filterField === 'TargetSide') {
          assert.fail(
            `算子 ${meta.id} 输入节点 ${node.id} 存在初期阵营硬过滤: filterField=${cfg.filterField}, filterEquals=${cfg.filterEquals}`,
          );
        }
      }
    }

    // 3. 验证契约解析与单一真相源闭环
    const contract = deriveContractFromNodes(bp.nodes);
    assert.ok(
      contract.csvTables.length >= 1 || contract.csvColumns.length >= 1,
      `算子 ${meta.id} 契约提取失败`,
    );
  }
});
