import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TableDataset } from '../src/core/types.ts';
import { evaluateAggregationDataset } from '../src/operators/aggregation-engine.ts';
import { evaluateFormulaDataset } from '../src/operators/formula-engine.ts';
import {
  defaultMetricGraphStore,
  evaluateMetricGraph,
  type MetricOperatorInput,
} from '../src/indicators/metric-graph-store.ts';
import { defaultSystemDagStore } from '../src/systems/system-dag-store.ts';
import { evaluateSystemDag } from '../src/systems/dag-evaluator.ts';
import { defaultEffectStore } from '../src/effects/store.ts';
import { createEvalApp } from '../src/server.ts';

test('Stage 12.1 - 一库流水线内核：行内公式衍生 (evaluateFormulaDataset) 与跨行分组聚合 (evaluateAggregationDataset) 贯通', () => {
  const sampleDs: TableDataset = {
    columns: [
      { name: 'FiringUnitSide', type: 'string' },
      { name: 'TargetContactRangeHoriz_nm', type: 'number' },
    ],
    rows: [
      { FiringUnitSide: '红方', TargetContactRangeHoriz_nm: 60 },
      { FiringUnitSide: '红方', TargetContactRangeHoriz_nm: 40 },
      { FiringUnitSide: '蓝方', TargetContactRangeHoriz_nm: 30 },
    ],
    totalRows: 3,
  };

  const derived = evaluateFormulaDataset(sampleDs, {
    derivedColumns: [
      {
        columnName: 'target_range_horiz',
        dataType: 'number',
        expression: 'IFNULL([TargetContactRangeHoriz_nm], 30)',
      },
      {
        columnName: 'efficiency_score',
        dataType: 'number',
        expression: 'ROUND(CLAMP(target_range_horiz * 1.5, 10, 100), 2)',
      },
    ],
  });

  assert.equal(derived.rows.length, 3);
  assert.equal(derived.rows[0].efficiency_score, 90);
  assert.equal(derived.rows[1].efficiency_score, 60);

  const agg = evaluateAggregationDataset(derived, {
    groupKeys: ['FiringUnitSide'],
    metrics: [
      { targetField: 'salvo_total', sourceColumn: '', method: 'COUNT_ALL' },
      { targetField: 'avg_efficiency_score', sourceColumn: 'efficiency_score', method: 'AVERAGE' },
      { targetField: 'max_efficiency_score', sourceColumn: 'efficiency_score', method: 'MAX' },
    ],
  });

  assert.equal(agg.rows.length, 2);
  const red = agg.rows.find((r) => r.FiringUnitSide === '红方');
  assert.ok(red);
  assert.equal(red.salvo_total, 2);
  assert.equal(red.avg_efficiency_score, 75);
  assert.equal(red.max_efficiency_score, 90);
});

test('Stage 12.2 - V4 三库端到端闭环：一库数据流 ➔ 二库指标 DAG ➔ 三库体系 DAG 综合评分', async () => {
  const mg = defaultMetricGraphStore.get('mg_v4_joint_demo');
  const sd = defaultSystemDagStore.get('sys_v4_joint_demo');
  assert.ok(mg && sd);

  const mkDs = (cols: string[], rows: Record<string, unknown>[]): TableDataset => ({
    columns: cols.map((name) => ({
      name,
      type: typeof rows[0]?.[name] === 'number' ? 'number' : 'string',
    })),
    rows,
    totalRows: rows.length,
  });

  const opInputs: Record<string, MetricOperatorInput> = {
    'strike.single_mission_metrics': {
      status: 'valid',
      dataset: mkDs(['任务ID', '任务名', '分方', '完成比'], [
        { 任务ID: 'S1', 任务名: '突击1', 分方: '红方', 完成比: 0.92 },
      ]),
    },
    'patrol.composite_mission_metrics': {
      status: 'valid',
      dataset: mkDs(['分方', '平均完成比'], [{ 分方: '红方', 平均完成比: 0.88 }]),
    },
    'isr.detection_rate': {
      status: 'valid',
      dataset: mkDs(['分方', '发现率'], [{ 分方: '红方', 发现率: 0.9 }]),
    },
    'c2.situational_completeness': {
      status: 'valid',
      dataset: mkDs(['分方', '态势完整度'], [{ 分方: '红方', 态势完整度: 0.92 }]),
    },
    'fire_control.unit_kill_chain_closure': {
      status: 'valid',
      dataset: mkDs(['目标ID', '分方', '杀伤闭环总时长'], [
        { 目标ID: 'T1', 分方: '红方', 杀伤闭环总时长: 50 },
      ]),
    },
    'cost.side_exchange_ratio': {
      status: 'valid',
      dataset: mkDs(['分方比', '交换比'], [{ 分方比: '红方/蓝方', 交换比: 2.8 }]),
    },
    'roe.fratricide_count': {
      status: 'valid',
      dataset: mkDs(['分方', 'FratricideCount'], [{ 分方: '红方', FratricideCount: 0 }]),
    },
    'roe.corridor_spatial_compliance': {
      status: 'valid',
      dataset: mkDs(['分方', '遵从率'], [{ 分方: '红方', 遵从率: 0.96 }]),
    },
  };

  const mgRes = await evaluateMetricGraph(mg, opInputs);
  const sysRes = evaluateSystemDag(sd, mgRes.metricInputsForSystem, {
    effectStore: defaultEffectStore,
  });
  assert.equal(sysRes.gateVerdict, 'PASS');
  assert.ok(sysRes.overallScore !== null && sysRes.overallScore > 70 && sysRes.overallScore <= 100);
});

test('Stage 12.3 - REST APIs: /api/v4/operators, /api/operators/preview, /api/operators/validate-formula 端到端校验', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f1-s12-v4-http-'));
  const app = await createEvalApp({
    dbPath: path.join(tmpDir, 'eval.db'),
    autoSeed: false,
  });

  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', () => resolve()));
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /api/v4/operators
    const opsRes = (await fetch(`${baseUrl}/api/v4/operators?layer=all`).then((r) => r.json())) as {
      ok: boolean;
      operators: Array<{ id: string }>;
    };
    assert.equal(opsRes.ok, true);
    assert.ok(opsRes.operators.length >= 42);

    // 2. POST /api/operators/validate-formula
    const valGoodRes = (await fetch(`${baseUrl}/api/operators/validate-formula`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expression: 'IF([speed] > 1000, [dist] / 2, [dist] * 1.5)',
        availableColumns: ['speed', 'dist', 'side'],
      }),
    }).then((r) => r.json())) as {
      ok: boolean;
      valid: boolean;
      referencedVariables: string[];
      errors: string[];
    };
    assert.equal(valGoodRes.ok, true);
    assert.equal(valGoodRes.valid, true);
    assert.deepEqual(valGoodRes.referencedVariables.sort(), ['dist', 'speed']);
    assert.equal(valGoodRes.errors.length, 0);

    const valBadRes = (await fetch(`${baseUrl}/api/operators/validate-formula`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expression: '[unknown_col] + 10',
        availableColumns: ['speed', 'dist'],
      }),
    }).then((r) => r.json())) as { ok: boolean; valid: boolean; errors: string[] };
    assert.equal(valBadRes.valid, false);
    assert.ok(valBadRes.errors.some((e) => e.includes('unknown_col')));

    // 3. POST /api/operators/preview (formula)
    const formulaPreviewRes = (await fetch(`${baseUrl}/api/operators/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sampleDataset: {
          columns: [
            { name: 'fighter', type: 'string' },
            { name: 'speed_kmh', type: 'number' },
          ],
          rows: [
            { fighter: 'J20-A', speed_kmh: 2200 },
            { fighter: 'J20-B', speed_kmh: 1800 },
          ],
        },
        type: 'formula_pipeline',
        formulaConfig: {
          derivedColumns: [
            { columnName: 'speed_mach', dataType: 'number', expression: 'ROUND(speed_kmh / 1225, 2)' },
          ],
        },
      }),
    }).then((r) => r.json())) as {
      ok: boolean;
      totalRows: number;
      diffCols: string[];
      previewRows: Array<Record<string, unknown>>;
    };
    assert.equal(formulaPreviewRes.ok, true);
    assert.equal(formulaPreviewRes.totalRows, 2);
    assert.deepEqual(formulaPreviewRes.diffCols, ['speed_mach']);
    assert.equal(formulaPreviewRes.previewRows[0].speed_mach, 1.8);

    // 4. POST /api/operators/preview (aggregation)
    const aggPreviewRes = (await fetch(`${baseUrl}/api/operators/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sampleDataset: {
          columns: [
            { name: 'side', type: 'string' },
            { name: 'damage', type: 'number' },
          ],
          rows: [
            { side: '红方', damage: 45 },
            { side: '红方', damage: 55 },
            { side: '蓝方', damage: 30 },
          ],
        },
        type: 'aggregation',
        aggregationConfig: {
          groupKeys: ['side'],
          metrics: [
            { targetField: 'count', sourceColumn: '', method: 'COUNT_ALL' },
            { targetField: 'avg_dmg', sourceColumn: 'damage', method: 'AVERAGE' },
          ],
        },
      }),
    }).then((r) => r.json())) as {
      ok: boolean;
      totalRows: number;
      diffCols: string[];
      previewRows: Array<Record<string, unknown>>;
    };
    assert.equal(aggPreviewRes.ok, true);
    assert.equal(aggPreviewRes.totalRows, 2);
    assert.deepEqual(aggPreviewRes.diffCols, ['count', 'avg_dmg']);
    const redRow = aggPreviewRes.previewRows.find((r) => r.side === '红方');
    assert.ok(redRow);
    assert.equal(redRow.count, 2);
    assert.equal(redRow.avg_dmg, 50);
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
