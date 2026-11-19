import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSituationModel } from '../src/core/situation-model.ts';
import { evaluateFormulaExpression, validateFormulaSyntax } from '../src/operators/formula-engine.ts';
import { evaluateAllOperators, evaluateOperator, sweepOperatorParameter } from '../src/operators/registry.ts';
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
const BS_SAMPLE_JSONL = path.join(
  REPO_ROOT,
  'demo-ui',
  'proxy',
  'testdata',
  'bs-frames-sample.jsonl',
);

test('Stage 9：15 个新增内置算子在真实 GJ11 CSV 与 BS JSONL 上精准出数且遵循 fail-closed', async () => {
  const gj11 = await buildSituationModel({ runId: 'gj11-s9', csvDir: REAL_CSV_DIR });
  const ctxGj11 = { runId: 'gj11-s9', situation: gj11, customParams: { targetSide: '红方', enemySide: '蓝方' } };

  const flightAvg = evaluateOperator('time.bvr_flight_avg', ctxGj11);
  assert.equal(flightAvg.status, 'valid');
  assert.ok(typeof flightAvg.value === 'number' && flightAvg.value > 0);

  const lossRatio = evaluateOperator('eff.weapon_loss_ratio', ctxGj11);
  assert.equal(lossRatio.status, 'valid');
  assert.ok(typeof lossRatio.value === 'number' && lossRatio.value >= 0 && lossRatio.value <= 1);

  const dmgSeverity = evaluateOperator('eff.damage_severity_index', ctxGj11);
  assert.equal(dmgSeverity.status, 'valid');
  assert.ok(typeof dmgSeverity.value === 'number' && dmgSeverity.value > 0);

  const salvoEff = evaluateOperator('eff.salvo_efficiency', ctxGj11);
  assert.equal(salvoEff.status, 'valid');
  assert.equal(salvoEff.value, 3); // 红方消耗 3 枚 PL-15 取得 1 击落战果

  const speedAvg = evaluateOperator('sit.kinematic_speed_avg', ctxGj11);
  assert.equal(speedAvg.status, 'valid');
  assert.ok(typeof speedAvg.value === 'number' && speedAvg.value > 100);

  const altAdv = evaluateOperator('sit.altitude_envelope_advantage', ctxGj11);
  assert.equal(altAdv.status, 'valid');

  const centroidNm = evaluateOperator('sit.centroid_separation_nm', ctxGj11);
  assert.equal(centroidNm.status, 'valid');
  assert.ok(typeof centroidNm.value === 'number' && centroidNm.value > 0);

  const friendlyFire = evaluateOperator('comp.friendly_fire_safety', ctxGj11);
  assert.equal(friendlyFire.status, 'valid');
  assert.equal(friendlyFire.value, 1);

  const rangeDisc = evaluateOperator('comp.engagement_range_discipline', ctxGj11);
  assert.equal(rangeDisc.status, 'valid');
  assert.ok(typeof rangeDisc.value === 'number' && rangeDisc.value > 0);

  const intensity = evaluateOperator('cost.unit_munitions_intensity', ctxGj11);
  assert.equal(intensity.status, 'valid');
  assert.ok(typeof intensity.value === 'number' && intensity.value > 0);

  // Batch B 未导出表必须严格 fail-closed
  assert.equal(evaluateOperator('eff.air_ops_sortie_completion', ctxGj11).status, 'unavailable');
  assert.equal(evaluateOperator('cost.fuel_remaining_ratio', ctxGj11).status, 'unavailable');
  assert.equal(evaluateOperator('time.kill_chain_total_latency', ctxGj11).status, 'unavailable');

  // BS 样本检查（多单元空间凸包面积 & 扫参敏感性）
  const bs = await buildSituationModel({ runId: 'bs-s9', jsonlFile: BS_SAMPLE_JSONL });
  const bsAll = evaluateAllOperators({ runId: 'bs-s9', situation: bs });
  assert.equal(bsAll['sit.kinematic_speed_avg'].status, 'valid');
  assert.equal(bsAll['sit.centroid_separation_nm'].status, 'valid');

  const sweepPts = sweepOperatorParameter(
    'comp.engagement_range_discipline',
    ctxGj11,
    'minRangeNm',
    10,
    100,
    5,
  );
  assert.equal(sweepPts.length, 5);
  assert.ok((sweepPts[0].value ?? 0) >= (sweepPts[4].value ?? 0));
});

test('Stage 9：安全表达式 DSL（零 eval）解析、除零降级与非法脚本拦截', () => {
  assert.deepEqual(validateFormulaSyntax('round((a * 100) / max(b, 0.01))', ['a', 'b']), []);
  assert.ok(validateFormulaSyntax('process.exit(1)', ['a']).length > 0);
  assert.ok(validateFormulaSyntax('a + unknownVar', ['a']).length > 0);

  const okRes = evaluateFormulaExpression('clamp(avg(a, b) * 2, 0, 100)', { a: 10, b: 20 });
  assert.equal(okRes.ok, true);
  if (okRes.ok) assert.equal(okRes.value, 30);

  const divZero = evaluateFormulaExpression('a / (b - b)', { a: 10, b: 5 });
  assert.equal(divZero.ok, false);
});

test('Stage 9：自定义算子 API 全链路（预览 / 落盘 / 二库引用 / 删除保护 / 对比与扫参）', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-eval-s9-'));
  const app = await createEvalApp({
    dbPath: path.join(tmpDir, 'eval.db'),
    customOperatorsPath: path.join(tmpDir, 'custom-operators.json'),
    operatorOverridesPath: path.join(tmpDir, 'operator-overrides.json'),
    customIndicatorsPath: path.join(tmpDir, 'custom-indicators.json'),
    customSystemsPath: path.join(tmpDir, 'custom-systems.json'),
    autoSeed: true,
  });

  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', () => resolve()));
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. 列出默认 38 个内置算子
    const list0 = await fetch(`${baseUrl}/api/operators`).then((r) => r.json() as Promise<{ operators: Array<{ id: string }> }>);
    assert.equal(list0.operators.length, 38);

    // 2. 预览组合衍生算子表达式
    const customDef = {
      id: 'custom.s9_hit_per_density',
      name: 'Stage9 自定义命中效费指数',
      category: 'effectiveness',
      description: '验证自定义组合衍生算子',
      expression: 'round((a * 100) / max(b, 0.1))',
      variables: [
        { alias: 'a', atomRef: 'eff.hit_rate' },
        { alias: 'b', atomRef: 'cost.unit_munitions_intensity' },
      ],
      outputType: 'score',
      unit: '指数',
      defaultOptimalDirection: 'larger_is_better',
    };
    const prevRes = await fetch(`${baseUrl}/api/operators/preview-formula`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definition: customDef, runId: 'gj11_pl15_bvr_real' }),
    }).then((r) => r.json() as Promise<{ valid: boolean; result: { status: string; value: number } }>);
    assert.equal(prevRes.valid, true);
    assert.equal(prevRes.result.status, 'valid');
    assert.ok(prevRes.result.value > 0);

    // 3. 保存自定义算子（36 -> 37），并在二库绑定指标
    const saveRes = await fetch(`${baseUrl}/api/operators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(customDef),
    });
    assert.equal(saveRes.status, 200);

    const indRes = await fetch(`${baseUrl}/api/indicators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indicatorId: 'ind_s9_custom_bound',
        name: '绑定自定义算子指标',
        atomRef: 'custom.s9_hit_per_density',
        scoring: { type: 'larger_is_better', optimal: 50, worst: 0 },
      }),
    });
    assert.equal(indRes.status, 200);

    // 4. 被指标引用时删除自定义算子应返回 409 冲突保护；就地全字段更新；解绑后删除成功
    const putCustomRes = await fetch(`${baseUrl}/api/operators/custom.s9_hit_per_density`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...customDef,
        name: 'Stage9 自定义命中效费指数 (已改名)',
        expression: 'round((a * 50) / max(b, 0.1))',
        defaultParams: { targetSide: '红方' },
      }),
    }).then((r) => r.json() as Promise<{ ok: boolean; operator: { name: string; defaultParams?: { targetSide?: string } } }>);
    assert.equal(putCustomRes.ok, true);
    assert.equal(putCustomRes.operator.name, 'Stage9 自定义命中效费指数 (已改名)');
    assert.equal(putCustomRes.operator.defaultParams?.targetSide, '红方');

    // 4b. 内置算子元数据与 defaultParams 就地覆写、全局生效验证及恢复默认
    const evalDefaultBefore = await fetch(
      `${baseUrl}/api/operators/comp.engagement_range_discipline/evaluate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'gj11_pl15_bvr_real' }),
      },
    ).then((r) => r.json() as Promise<{ result: { value: boolean | number | null } }>);

    const putBuiltinRes = await fetch(
      `${baseUrl}/api/operators/comp.engagement_range_discipline`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '最低射程纪律 (严苛覆写 999nm)',
          defaultParams: { minRangeNm: 999 },
        }),
      },
    ).then(
      (r) =>
        r.json() as Promise<{
          ok: boolean;
          operator: { isOverridden?: boolean; name: string; defaultParams?: { minRangeNm?: number } };
        }>,
    );
    assert.equal(putBuiltinRes.ok, true);
    assert.equal(putBuiltinRes.operator.isOverridden, true);
    assert.equal(putBuiltinRes.operator.defaultParams?.minRangeNm, 999);

    // 验证覆写后的默认参数在未显式传参时自动全局生效（compare-runs 与单算子 evaluate）
    const evalOverridden = await fetch(
      `${baseUrl}/api/operators/comp.engagement_range_discipline/evaluate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'gj11_pl15_bvr_real' }),
      },
    ).then((r) => r.json() as Promise<{ result: { value: number | null } }>);
    assert.equal(evalOverridden.result.value, 0);

    // 调用方显式传参仍优先于默认覆写
    const evalCallerWins = await fetch(
      `${baseUrl}/api/operators/comp.engagement_range_discipline/evaluate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'gj11_pl15_bvr_real', customParams: { minRangeNm: 1 } }),
      },
    ).then((r) => r.json() as Promise<{ result: { value: number | null } }>);
    assert.equal(evalCallerWins.result.value, 1);

    // 恢复默认后恢复原始计算逻辑
    const resetRes = await fetch(
      `${baseUrl}/api/operators/comp.engagement_range_discipline/override`,
      { method: 'DELETE' },
    ).then((r) => r.json() as Promise<{ ok: boolean; reset: boolean; operator: { isOverridden?: boolean } }>);
    assert.equal(resetRes.ok, true);
    assert.equal(resetRes.reset, true);
    assert.equal(resetRes.operator.isOverridden, false);

    const evalAfterReset = await fetch(
      `${baseUrl}/api/operators/comp.engagement_range_discipline/evaluate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: 'gj11_pl15_bvr_real' }),
      },
    ).then((r) => r.json() as Promise<{ result: { value: boolean | number | null } }>);
    assert.equal(evalAfterReset.result.value, evalDefaultBefore.result.value);

    // 非法 ID / 空名称拒绝
    const notFoundPut = await fetch(`${baseUrl}/api/operators/unknown.op_xyz`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test' }),
    });
    assert.equal(notFoundPut.status, 404);

    const emptyNamePut = await fetch(`${baseUrl}/api/operators/comp.engagement_range_discipline`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    assert.equal(emptyNamePut.status, 400);

    const delProtected = await fetch(`${baseUrl}/api/operators/custom.s9_hit_per_density`, {
      method: 'DELETE',
    });
    assert.equal(delProtected.status, 409);

    await fetch(`${baseUrl}/api/indicators/ind_s9_custom_bound`, { method: 'DELETE' });
    const delOk = await fetch(`${baseUrl}/api/operators/custom.s9_hit_per_density`, {
      method: 'DELETE',
    });
    assert.equal(delOk.status, 200);

    // 禁止删除内置算子
    const delBuiltin = await fetch(`${baseUrl}/api/operators/time.first_weapon_fire`, {
      method: 'DELETE',
    });
    assert.equal(delBuiltin.status, 400);

    // 5. 双 Run 横向批量对比 & 敏感性扫参
    const cmpRes = await fetch(`${baseUrl}/api/operators/compare-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runIdA: 'gj11_pl15_bvr_real',
        runIdB: 'bs_sample_swarm_demo',
      }),
    }).then((r) => r.json() as Promise<{ rows: unknown[] }>);
    assert.equal(cmpRes.rows.length, 38);

    const sweepRes = await fetch(`${baseUrl}/api/operators/comp.engagement_range_discipline/sweep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'gj11_pl15_bvr_real',
        paramKey: 'minRangeNm',
        min: 10,
        max: 90,
        steps: 6,
      }),
    }).then((r) => r.json() as Promise<{ points: Array<{ paramValue: number }> }>);
    assert.equal(sweepRes.points.length, 6);

    // 6. f1FieldContract 覆写联动源文件剖析 & 数据源直连提取 (CSV + BS JSONL) 实算
    const contractPut = await fetch(`${baseUrl}/api/operators/time.first_weapon_fire`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        f1FieldContract: {
          csvTables: ['WeaponFired', 'UnitPositions'],
          csvColumns: ['Time', 'FiringUnitID', 'WeaponID'],
          bsFramePaths: ['Sides[].Contacts[]'],
          discrepancyNotes: ['Stage9 扩展测试血缘覆写'],
        },
      }),
    }).then((r) => r.json() as Promise<{ ok: boolean; operator: { f1FieldContract: { csvTables?: string[] } } }>);
    assert.equal(contractPut.ok, true);
    assert.deepEqual(contractPut.operator.f1FieldContract.csvTables, ['WeaponFired', 'UnitPositions']);

    // 验证 /api/runs/:id/source-profile 反向关联即时体现 UnitPositions -> time.first_weapon_fire
    const profRes = await fetch(`${baseUrl}/api/runs/gj11_pl15_bvr_real/source-profile`).then(
      (r) =>
        r.json() as Promise<{
          profile: { csvProfile: { tables: Array<{ name: string; drivenOperators: Array<{ id: string }> }> } };
        }>,
    );
    const unitPosEntry = profRes.profile.csvProfile.tables.find((t) => t.name === 'UnitPositions');
    assert.ok(unitPosEntry?.drivenOperators.some((o) => o.id === 'time.first_weapon_fire'));
    await fetch(`${baseUrl}/api/operators/time.first_weapon_fire/override`, { method: 'DELETE' });

    // 7. 数据源直连提取模式 (CSV WeaponFired 射距均值 + BS ActiveUnits[].CS 航速均值 + 公式二次组合)
    const csvExtractDef = {
      id: 'custom.s9_csv_wf_range_avg',
      name: '直连 CSV 武器发射射距均值',
      category: 'situation',
      mode: 'source_binding',
      description: '直连提取 WeaponFired.TargetContactRangeHoriz_nm',
      expression: '',
      variables: [],
      sourceBinding: {
        sourceType: 'csv',
        csvTable: 'WeaponFired',
        csvColumn: 'TargetContactRangeHoriz_nm',
        filterField: 'FiringUnitSide',
        filterEquals: '${targetSide}',
        aggregation: 'avg',
      },
      outputType: 'score',
      unit: 'nm',
      defaultOptimalDirection: 'larger_is_better',
    };
    const csvPreview = await fetch(`${baseUrl}/api/operators/preview-formula`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definition: csvExtractDef, runId: 'gj11_pl15_bvr_real' }),
    }).then((r) => r.json() as Promise<{ valid: boolean; result: { status: string; value: number } }>);
    assert.equal(csvPreview.valid, true);
    assert.equal(csvPreview.result.status, 'valid');
    assert.ok(csvPreview.result.value > 0);

    // 缺表或不存在列名严格 fail-closed
    const badColPreview = await fetch(`${baseUrl}/api/operators/preview-formula`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        definition: {
          ...csvExtractDef,
          sourceBinding: { ...csvExtractDef.sourceBinding, csvColumn: 'NoSuchColumn_XYZ' },
        },
        runId: 'gj11_pl15_bvr_real',
      }),
    }).then((r) => r.json() as Promise<{ valid: boolean; result: { status: string } }>);
    assert.equal(badColPreview.result.status, 'unavailable');

    const bsExtractDef = {
      id: 'custom.s9_bs_speed_avg',
      name: '直连 BS ActiveUnits.Speed 均值',
      category: 'situation',
      mode: 'source_binding',
      description: '直连提取 BS ActiveUnits[].Speed',
      expression: '',
      variables: [],
      sourceBinding: {
        sourceType: 'bs_jsonl',
        bsPath: 'ActiveUnits[].Speed',
        aggregation: 'avg',
      },
      outputType: 'score',
      unit: 'kts',
      defaultOptimalDirection: 'larger_is_better',
    };
    const bsPreview = await fetch(`${baseUrl}/api/operators/preview-formula`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definition: bsExtractDef, runId: 'bs_sample_swarm_demo' }),
    }).then((r) => r.json() as Promise<{ valid: boolean; result: { status: string; value: number } }>);
    assert.equal(bsPreview.valid, true);
    assert.equal(bsPreview.result.status, 'valid');
    assert.ok(bsPreview.result.value > 0);

    // 路径在样本中不存在时严格 fail-closed 为 unavailable
    const bsMissingPreview = await fetch(`${baseUrl}/api/operators/preview-formula`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        definition: {
          ...bsExtractDef,
          sourceBinding: { sourceType: 'bs_jsonl', bsPath: 'ActiveUnits[].NoSuchField', aggregation: 'avg' },
        },
        runId: 'bs_sample_swarm_demo',
      }),
    }).then((r) => r.json() as Promise<{ valid: boolean; result: { status: string } }>);
    assert.equal(bsMissingPreview.result.status, 'unavailable');

    // 保存 CSV 提取算子并作为底层变量给公式算子二次组合
    await fetch(`${baseUrl}/api/operators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(csvExtractDef),
    });
    const chainedDef = {
      id: 'custom.s9_chained_km',
      name: '射距均值换算公里',
      category: 'situation',
      mode: 'formula',
      description: '将直连 nm 转换为 km',
      expression: 'round(a * 1.852)',
      variables: [{ alias: 'a', atomRef: 'custom.s9_csv_wf_range_avg' }],
      outputType: 'score',
      unit: 'km',
      defaultOptimalDirection: 'larger_is_better',
    };
    const chainedRes = await fetch(`${baseUrl}/api/operators/preview-formula`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definition: chainedDef, runId: 'gj11_pl15_bvr_real' }),
    }).then((r) => r.json() as Promise<{ valid: boolean; result: { status: string; value: number } }>);
    assert.equal(chainedRes.valid, true);
    assert.equal(chainedRes.result.status, 'valid');
    assert.ok(chainedRes.result.value > csvPreview.result.value);
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
