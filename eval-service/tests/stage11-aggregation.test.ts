import assert from 'node:assert/strict';
import test from 'node:test';
import type { AggregationOperatorConfig, TableDataset } from '../src/core/types.ts';
import {
  evaluateAggregationDataset,
  validateAggregationConfig,
} from '../src/operators/aggregation-engine.ts';
import { executeFormulaOrAggPreview } from '../src/operators/pipeline-engine.ts';

test('Stage 11.1 - 全表标量聚合 (groupKeys 为空时 N -> 1 标量归约)', () => {
  const sampleDataset: TableDataset = {
    columns: [
      { name: 'unit_id', type: 'string' },
      { name: 'score', type: 'number' },
      { name: 'category', type: 'string' },
    ],
    rows: [
      { unit_id: 'U1', score: 10, category: 'A' },
      { unit_id: 'U2', score: 20, category: 'A' },
      { unit_id: 'U3', score: 30, category: 'B' },
      { unit_id: 'U4', score: 40, category: 'B' },
    ],
  };

  const config: AggregationOperatorConfig = {
    groupKeys: [],
    metrics: [
      { targetField: 'total_count', sourceColumn: '', method: 'COUNT_ALL' },
      { targetField: 'avg_score', sourceColumn: 'score', method: 'AVERAGE' },
      { targetField: 'sum_score', sourceColumn: 'score', method: 'SUM' },
      { targetField: 'max_score', sourceColumn: 'score', method: 'MAX' },
      { targetField: 'min_score', sourceColumn: 'score', method: 'MIN' },
      { targetField: 'distinct_categories', sourceColumn: 'category', method: 'COUNT_DISTINCT' },
    ],
  };

  const result = evaluateAggregationDataset(sampleDataset, config);

  assert.equal(result.rows.length, 1, 'groupKeys 为空时应归约为 1 行');
  assert.equal(result.totalRows, 1);
  const row = result.rows[0];
  assert.equal(row.total_count, 4);
  assert.equal(row.avg_score, 25);
  assert.equal(row.sum_score, 100);
  assert.equal(row.max_score, 40);
  assert.equal(row.min_score, 10);
  assert.equal(row.distinct_categories, 2);

  // Schema 检查
  assert.equal(result.columns.length, 6);
  assert.equal(result.columns[0].name, 'total_count');
  assert.equal(result.columns[1].name, 'avg_score');
  assert.ok(result.columns.every((c) => c.isDerived === true));
});

test('Stage 11.2 - 复合多主键流式分组聚合 (Composite groupKeys)', () => {
  const sampleDataset: TableDataset = {
    columns: [
      { name: 'side', type: 'string' },
      { name: 'unit_type', type: 'string' },
      { name: 'kill_count', type: 'number' },
      { name: 'loss_count', type: 'number' },
      { name: 'pilot_name', type: 'string' },
    ],
    rows: [
      { side: '红方', unit_type: 'Fighter', kill_count: 3, loss_count: 0, pilot_name: 'P1' },
      { side: '红方', unit_type: 'Fighter', kill_count: 5, loss_count: 1, pilot_name: 'P2' },
      { side: '红方', unit_type: 'Bomber', kill_count: 1, loss_count: 0, pilot_name: 'P3' },
      { side: '蓝方', unit_type: 'Fighter', kill_count: 2, loss_count: 2, pilot_name: 'P4' },
      { side: '蓝方', unit_type: 'Fighter', kill_count: 0, loss_count: 1, pilot_name: 'P5' },
    ],
  };

  const config: AggregationOperatorConfig = {
    groupKeys: ['side', 'unit_type'],
    metrics: [
      { targetField: 'sortie_count', sourceColumn: '', method: 'COUNT_ALL' },
      { targetField: 'total_kills', sourceColumn: 'kill_count', method: 'SUM' },
      { targetField: 'avg_kills', sourceColumn: 'kill_count', method: 'AVERAGE' },
      { targetField: 'max_kills', sourceColumn: 'kill_count', method: 'MAX' },
      { targetField: 'total_losses', sourceColumn: 'loss_count', method: 'SUM' },
      { targetField: 'lead_pilot', sourceColumn: 'pilot_name', method: 'FIRST' },
      { targetField: 'tail_pilot', sourceColumn: 'pilot_name', method: 'LAST' },
    ],
  };

  const result = evaluateAggregationDataset(sampleDataset, config);

  // 应该产生 3 个分组桶：[红方, Fighter], [红方, Bomber], [蓝方, Fighter]
  assert.equal(result.rows.length, 3);

  // 查找 红方 Fighter 分组
  const redFighter = result.rows.find((r) => r.side === '红方' && r.unit_type === 'Fighter');
  assert.ok(redFighter);
  assert.equal(redFighter.sortie_count, 2);
  assert.equal(redFighter.total_kills, 8);
  assert.equal(redFighter.avg_kills, 4);
  assert.equal(redFighter.max_kills, 5);
  assert.equal(redFighter.total_losses, 1);
  assert.equal(redFighter.lead_pilot, 'P1');
  assert.equal(redFighter.tail_pilot, 'P2');

  // 查找 红方 Bomber 分组
  const redBomber = result.rows.find((r) => r.side === '红方' && r.unit_type === 'Bomber');
  assert.ok(redBomber);
  assert.equal(redBomber.sortie_count, 1);
  assert.equal(redBomber.total_kills, 1);
  assert.equal(redBomber.lead_pilot, 'P3');
  assert.equal(redBomber.tail_pilot, 'P3');

  // 查找 蓝方 Fighter 分组
  const blueFighter = result.rows.find((r) => r.side === '蓝方' && r.unit_type === 'Fighter');
  assert.ok(blueFighter);
  assert.equal(blueFighter.sortie_count, 2);
  assert.equal(blueFighter.total_kills, 2);
  assert.equal(blueFighter.avg_kills, 1);
  assert.equal(blueFighter.total_losses, 3);

  // Schema 检查：分组主键在前，非衍生；度量在后，为衍生
  assert.equal(result.columns[0].name, 'side');
  assert.equal(result.columns[0].isDerived, false);
  assert.equal(result.columns[1].name, 'unit_type');
  assert.equal(result.columns[1].isDerived, false);
  assert.equal(result.columns[2].name, 'sortie_count');
  assert.equal(result.columns[2].isDerived, true);
});

test('Stage 11.3 - 统计方法全量覆盖与精算 (AVERAGE, SUM, MAX, MIN, COUNT_ALL, COUNT_DISTINCT, COUNT_NON_EMPTY, STDEV, STDEVP, FIRST, LAST)', () => {
  // 数据集：包含 null、undefined、空字符串与不同数值
  const sampleDataset: TableDataset = {
    columns: [
      { name: 'val', type: 'number' },
      { name: 'str_val', type: 'string' },
    ],
    rows: [
      { val: 10, str_val: 'alpha' },
      { val: 20, str_val: 'beta' },
      { val: 30, str_val: 'alpha' },
      { val: null, str_val: '' },
      { val: 40, str_val: 'gamma' },
      { val: undefined, str_val: null },
    ],
  };

  const config: AggregationOperatorConfig = {
    groupKeys: [],
    metrics: [
      { targetField: 'cnt_all', sourceColumn: '', method: 'COUNT_ALL' },
      { targetField: 'cnt_non_empty_num', sourceColumn: 'val', method: 'COUNT_NON_EMPTY' },
      { targetField: 'cnt_non_empty_str', sourceColumn: 'str_val', method: 'COUNT_NON_EMPTY' },
      { targetField: 'cnt_distinct_str', sourceColumn: 'str_val', method: 'COUNT_DISTINCT' },
      { targetField: 'sum_val', sourceColumn: 'val', method: 'SUM' },
      { targetField: 'avg_val', sourceColumn: 'val', method: 'AVERAGE' },
      { targetField: 'min_val', sourceColumn: 'val', method: 'MIN' },
      { targetField: 'max_val', sourceColumn: 'val', method: 'MAX' },
      { targetField: 'stdev_sample', sourceColumn: 'val', method: 'STDEV' },
      { targetField: 'stdev_pop', sourceColumn: 'val', method: 'STDEVP' },
      { targetField: 'first_str', sourceColumn: 'str_val', method: 'FIRST' },
      { targetField: 'last_str', sourceColumn: 'str_val', method: 'LAST' },
    ],
  };

  const res = evaluateAggregationDataset(sampleDataset, config);
  const row = res.rows[0];

  assert.equal(row.cnt_all, 6, 'COUNT_ALL 应统计所有 6 行');
  assert.equal(row.cnt_non_empty_num, 4, '非空数值行数为 4 (10, 20, 30, 40)');
  assert.equal(row.cnt_non_empty_str, 4, '非空字符串行数为 4 (alpha, beta, alpha, gamma)');
  assert.equal(row.cnt_distinct_str, 4, '去重集合包含 "alpha", "beta", "", "gamma"');
  assert.equal(row.sum_val, 100);
  assert.equal(row.avg_val, 25);
  assert.equal(row.min_val, 10);
  assert.equal(row.max_val, 40);

  // Welford 算法验证：[10, 20, 30, 40]
  // 均值 = 25
  // 方差 sampleVar = ((10-25)^2 + (20-25)^2 + (30-25)^2 + (40-25)^2) / (4 - 1) = (225 + 25 + 25 + 225) / 3 = 500 / 3 = 166.666667
  // STDEV = sqrt(166.666667) = 12.909944
  assert.ok(Math.abs((row.stdev_sample as number) - 12.909944) < 1e-4);

  // 总体方差 popVar = 500 / 4 = 125
  // STDEVP = sqrt(125) = 11.18034
  assert.ok(Math.abs((row.stdev_pop as number) - 11.18034) < 1e-4);

  assert.equal(row.first_str, 'alpha');
  assert.equal(row.last_str, 'gamma');
});

test('Stage 11.4 - 边界值防御：空表与全空列安全降级', () => {
  // 1. 全空数据集进行全表标量聚合
  const emptyDataset: TableDataset = {
    columns: [{ name: 'val', type: 'number' }],
    rows: [],
  };

  const configEmpty: AggregationOperatorConfig = {
    groupKeys: [],
    metrics: [
      { targetField: 'cnt', sourceColumn: '', method: 'COUNT_ALL' },
      { targetField: 'sum_val', sourceColumn: 'val', method: 'SUM' },
      { targetField: 'avg_val', sourceColumn: 'val', method: 'AVERAGE' },
      { targetField: 'stdev_val', sourceColumn: 'val', method: 'STDEV' },
      { targetField: 'first_val', sourceColumn: 'val', method: 'FIRST' },
    ],
  };

  const resEmpty = evaluateAggregationDataset(emptyDataset, configEmpty);
  assert.equal(resEmpty.rows.length, 1);
  assert.equal(resEmpty.rows[0].cnt, 0);
  assert.equal(resEmpty.rows[0].sum_val, 0);
  assert.equal(resEmpty.rows[0].avg_val, null);
  assert.equal(resEmpty.rows[0].stdev_val, null);
  assert.equal(resEmpty.rows[0].first_val, null);

  // 2. 带分组主键的空数据集应返回 0 行
  const configGroupEmpty: AggregationOperatorConfig = {
    groupKeys: ['unit_side'],
    metrics: [{ targetField: 'cnt', sourceColumn: '', method: 'COUNT_ALL' }],
  };
  const resGroupEmpty = evaluateAggregationDataset(emptyDataset, configGroupEmpty);
  assert.equal(resGroupEmpty.rows.length, 0);

  // 3. 样本量不足计算 STDEV (N=1 时 sample stdev 返回 null)
  const singleRowDataset: TableDataset = {
    columns: [{ name: 'val', type: 'number' }],
    rows: [{ val: 100 }],
  };
  const resSingle = evaluateAggregationDataset(singleRowDataset, {
    groupKeys: [],
    metrics: [
      { targetField: 'stdev', sourceColumn: 'val', method: 'STDEV' },
      { targetField: 'stdevp', sourceColumn: 'val', method: 'STDEVP' },
    ],
  });
  assert.equal(resSingle.rows[0].stdev, null, 'N=1 时样本标准差由于自由度不足应返回 null');
  assert.equal(resSingle.rows[0].stdevp, 0, 'N=1 时总体标准差应为 0');
});

test('Stage 11.5 - 参数校验与异常防御 (validateAggregationConfig)', () => {
  const availableCols = ['id', 'score', 'team'];

  // 1. 无 metrics 报错
  const errNoMetrics = validateAggregationConfig({ groupKeys: ['team'], metrics: [] }, availableCols);
  assert.ok(errNoMetrics.some((e) => e.includes('至少需要配置 1 项度量')));

  // 2. 字段重名拦截
  const errDupTarget = validateAggregationConfig(
    {
      groupKeys: ['team'],
      metrics: [
        { targetField: 'agg_score', sourceColumn: 'score', method: 'SUM' },
        { targetField: 'agg_score', sourceColumn: 'score', method: 'AVERAGE' },
      ],
    },
    availableCols,
  );
  assert.ok(errDupTarget.some((e) => e.includes('重复定义')));

  // 3. 输出字段名不能与 groupKeys 同名
  const errSameAsGroup = validateAggregationConfig(
    {
      groupKeys: ['team'],
      metrics: [{ targetField: 'team', sourceColumn: 'score', method: 'SUM' }],
    },
    availableCols,
  );
  assert.ok(errSameAsGroup.some((e) => e.includes('不能与分组主键同名')));

  // 4. 引用未在上游存在的列
  const errUnknownCol = validateAggregationConfig(
    {
      groupKeys: ['non_existent_key'],
      metrics: [{ targetField: 'out', sourceColumn: 'unknown_source', method: 'AVERAGE' }],
    },
    availableCols,
  );
  assert.ok(errUnknownCol.some((e) => e.includes('non_existent_key')));
  assert.ok(errUnknownCol.some((e) => e.includes('unknown_source')));
});

test('Stage 11.6 - 流水线即时预览 Dry-Run (executeFormulaOrAggPreview)', () => {
  const sampleDataset: TableDataset = {
    columns: [
      { name: 'fighter_id', type: 'string' },
      { name: 'speed_mach', type: 'number' },
      { name: 'altitude_m', type: 'number' },
    ],
    rows: [
      { fighter_id: 'J20-01', speed_mach: 1.8, altitude_m: 12000 },
      { fighter_id: 'J20-02', speed_mach: 2.1, altitude_m: 13500 },
      { fighter_id: 'J20-03', speed_mach: 1.6, altitude_m: 11000 },
    ],
  };

  // 1. 预览公式节点
  const formulaPreview = executeFormulaOrAggPreview(sampleDataset, {
    type: 'formula_pipeline',
    formulaConfig: {
      derivedColumns: [
        {
          columnName: 'is_supersonic',
          dataType: 'boolean',
          expression: 'speed_mach >= 1.0',
        },
        {
          columnName: 'energy_metric',
          dataType: 'number',
          expression: 'ROUND(speed_mach * (altitude_m / 1000), 2)',
        },
      ],
    },
  });

  assert.equal(formulaPreview.success, true);
  assert.equal(formulaPreview.totalRows, 3);
  assert.deepEqual(formulaPreview.diffCols, ['is_supersonic', 'energy_metric']);
  assert.equal(formulaPreview.previewRows[0].is_supersonic, true);
  assert.equal(formulaPreview.previewRows[0].energy_metric, 21.6);
  assert.ok(typeof formulaPreview.latencyMs === 'number' && formulaPreview.latencyMs >= 0);

  // 2. 预览聚合节点
  const aggPreview = executeFormulaOrAggPreview(sampleDataset, {
    type: 'aggregation',
    aggregationConfig: {
      groupKeys: [],
      metrics: [
        { targetField: 'max_speed', sourceColumn: 'speed_mach', method: 'MAX' },
        { targetField: 'avg_altitude', sourceColumn: 'altitude_m', method: 'AVERAGE' },
      ],
    },
  });

  assert.equal(aggPreview.success, true);
  assert.equal(aggPreview.totalRows, 1);
  assert.deepEqual(aggPreview.diffCols, ['max_speed', 'avg_altitude']);
  assert.equal(aggPreview.previewRows[0].max_speed, 2.1);
  assert.equal(aggPreview.previewRows[0].avg_altitude, 12166.666667);

  // 3. 错误配置预览优雅捕获
  const badPreview = executeFormulaOrAggPreview(sampleDataset, {
    type: 'aggregation',
    aggregationConfig: {
      groupKeys: ['invalid_field'],
      metrics: [],
    },
  });
  assert.equal(badPreview.success, false);
  assert.ok(badPreview.errors && badPreview.errors.length > 0);
});
