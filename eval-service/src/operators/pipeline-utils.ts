import type { OperatorDefaultParams, OptimalDirection } from '../core/types.ts';

export interface DerivedPipelineContract {
  csvTables: string[];
  csvColumns: string[];
  defaultParams: Partial<OperatorDefaultParams>;
  unit?: string;
  optimalDirection?: OptimalDirection;
  discrepancyNotes: string[];
}

/**
 * 自动从画布算法流水线节点中解析契约字段与运行参数
 * 实现“画布编排即算子真相源 (Single Source of Truth)”
 */
export function deriveContractFromNodes(nodes: any[]): DerivedPipelineContract {
  const tableSet = new Set<string>();
  const colSet = new Set<string>();
  const defaultParams: Partial<OperatorDefaultParams> = {};
  let unit: string | undefined;
  let optimalDirection: OptimalDirection | undefined;
  const topologyParts: string[] = [];

  for (const n of nodes || []) {
    if (!n) continue;
    const cfg = n.config || {};

    // 1. data_input 节点（直接抽取数据源底表与选择的列）
    if (n.type === 'data_input') {
      if (cfg.csvTable && typeof cfg.csvTable === 'string') {
        const cleanTable = cfg.csvTable.replace(/\.csv$/i, '').trim();
        if (cleanTable) tableSet.add(cleanTable);
      }
      if (Array.isArray(cfg.selectedColumns)) {
        for (const col of cfg.selectedColumns) {
          if (typeof col === 'string' && col.trim()) {
            colSet.add(col.trim());
          }
        }
      }
      if (cfg.filterField && typeof cfg.filterField === 'string' && cfg.filterField.trim()) {
        colSet.add(cfg.filterField.trim());
      }
    }

    // 2. spatial 空间几何节点
    if (n.type === 'spatial') {
      if (cfg.geomTable && typeof cfg.geomTable === 'string') {
        const cleanTable = cfg.geomTable.replace(/\.csv$/i, '').trim();
        if (cleanTable) tableSet.add(cleanTable);
      }
      for (const fieldKey of [
        'geomLonField',
        'geomLatField',
        'geomGroupField',
        'geomOrderField',
        'lonField',
        'latField',
        'altField',
        'missionIdField',
        'unitIdField',
      ]) {
        const f = cfg[fieldKey];
        if (typeof f === 'string' && f.trim()) {
          colSet.add(f.trim());
        }
      }
      if (cfg.minSafeMarginKm !== undefined && cfg.minSafeMarginKm !== null && cfg.minSafeMarginKm !== '') {
        const val = Number(cfg.minSafeMarginKm);
        if (Number.isFinite(val)) defaultParams.minSafeMarginKm = val;
      }
      topologyParts.push(`空间几何判定规则 [${cfg.spatialRule || 'corridor_check'}]`);
    }

    // 3. group_agg 节点
    if (n.type === 'group_agg') {
      const keys = cfg.groupKeys || cfg.groupBy || [];
      if (Array.isArray(keys)) {
        for (const k of keys) {
          if (typeof k === 'string' && k.trim()) colSet.add(k.trim());
        }
      }
      const aggs = cfg.aggregations || cfg.metrics || [];
      if (Array.isArray(aggs)) {
        for (const agg of aggs) {
          if (agg?.sourceField && typeof agg.sourceField === 'string' && agg.sourceField.trim()) {
            colSet.add(agg.sourceField.trim());
          }
        }
      }
      topologyParts.push(`分组聚合 [${(keys || []).join(', ') || '全局'}]`);
    }

    // 4. result_output 节点
    if (n.type === 'result_output') {
      if (cfg.indicatorUnit && typeof cfg.indicatorUnit === 'string') {
        unit = cfg.indicatorUnit.trim();
      }
      if (cfg.optimalDirection) {
        optimalDirection = cfg.optimalDirection;
      }
      if (cfg.thresholdLow !== undefined && cfg.thresholdLow !== null && cfg.thresholdLow !== '') {
        const val = Number(cfg.thresholdLow);
        if (Number.isFinite(val)) defaultParams.thresholdLow = val;
      }
      if (cfg.thresholdHigh !== undefined && cfg.thresholdHigh !== null && cfg.thresholdHigh !== '') {
        const val = Number(cfg.thresholdHigh);
        if (Number.isFinite(val)) defaultParams.thresholdHigh = val;
      }
    }
  }

  const csvTables = Array.from(tableSet);
  const csvColumns = Array.from(colSet);
  const note = `与画布算法编排节点深度同步：自动接入 ${csvTables.length} 张事件底表 (${csvTables.join(', ')})，引用 ${csvColumns.length} 个核心计算字段${topologyParts.length > 0 ? `，经 ${topologyParts.join(' ➔ ')} 输出指标` : ''}。`;

  return {
    csvTables,
    csvColumns,
    defaultParams,
    unit,
    optimalDirection,
    discrepancyNotes: [note],
  };
}
