import fs from 'node:fs';
import path from 'node:path';
import type { DatasetColumn, FieldDataType, OperatorDefaultParams, OptimalDirection, SituationModel, TableDataset } from '../core/types.ts';
import { locateCsvDirectory, readCsvTable, resolveCanonicalCsvEventName } from '../adapters/csv-adapter.ts';

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

    // 2.5 python_script 节点
    if (n.type === 'python_script') {
      topologyParts.push(`Python 算法沙箱 [${n.title || '执行内核'}]`);
      if (Array.isArray(cfg.outputColumns)) {
        for (const c of cfg.outputColumns) {
          if (typeof c === 'string' && c.trim()) colSet.add(c.trim());
        }
      }
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

export interface RunTableDataExtractResult {
  found: boolean;
  dataset?: TableDataset & {
    sourceRunId?: string;
    sourceTableName?: string;
    isRealData?: boolean;
    scenarioName?: string;
  };
  reason?: string;
  totalAvailableRows?: number;
}

/**
 * 从推演场景 (SituationModel) 中精准抽取指定事件底表的真实切片数据集 (TableDataset)
 * 支持 BOM 剥离、字段类型推导、可选阵营过滤与行数切片
 * 遵循 Fail-Closed 实证门控原则，缺数时返回明确原因，绝不凭空伪造虚假样本
 */
export function extractRunTableDataset(
  sit: SituationModel,
  tableName: string,
  options?: {
    filterField?: string;
    filterEquals?: string;
    limit?: number;
  },
): RunTableDataExtractResult {
  const rawTable = (tableName || '').trim();
  if (!rawTable) {
    return { found: false, reason: '未指定底表名称 (csvTable)' };
  }

  const targetCanonical = resolveCanonicalCsvEventName(rawTable).toLowerCase();
  const targetStem = rawTable.replace(/\.csv$/i, '').trim().toLowerCase();

  // 1. 优先从 scenarioPath (CSV 目录) 查找真实导出的 CSV 底表文件
  const scenarioPath = sit.scenarioPath;
  if (scenarioPath && fs.existsSync(scenarioPath)) {
    const isDir = fs.statSync(scenarioPath).isDirectory();
    const csvDir = isDir ? locateCsvDirectory(scenarioPath) : null;
    if (csvDir && fs.existsSync(csvDir) && fs.statSync(csvDir).isDirectory()) {
      const allFiles = fs.readdirSync(csvDir).filter((f) => f.toLowerCase().endsWith('.csv'));
      const matchedFiles = allFiles.filter((f) => {
        const can = resolveCanonicalCsvEventName(f).toLowerCase();
        const stem = f.replace(/\.csv$/i, '').trim().toLowerCase();
        return can === targetCanonical || stem === targetStem || f.toLowerCase() === rawTable.toLowerCase();
      });

      if (matchedFiles.length > 0) {
        const maxLimit = Math.max(1, Math.min(options?.limit ?? 10000, 200000));
        const mergedRows: Array<Record<string, unknown>> = [];
        let discoveredHeaders: string[] = [];

        for (const fileName of matchedFiles) {
          const fullPath = path.join(csvDir, fileName);
          const parsed = readCsvTable(fullPath, {
            targetTimelineId: sit.timelineId ?? undefined,
            maxRows: maxLimit,
          });

          if (discoveredHeaders.length === 0 && parsed.headers.length > 0) {
            discoveredHeaders = parsed.headers;
          }

          for (const r of parsed.rows) {
            // 可选阵营/字段过滤逻辑
            if (options?.filterField && options?.filterEquals !== undefined && options.filterEquals !== '') {
              const cellVal = (r.data[options.filterField] ?? '').trim().toLowerCase();
              const targetVal = options.filterEquals.trim().toLowerCase();
              if (
                (targetVal === 'red' || targetVal === '红方') &&
                !(cellVal === 'red' || cellVal === '红方' || cellVal.includes('red') || cellVal.includes('红'))
              ) {
                continue;
              } else if (
                (targetVal === 'blue' || targetVal === '蓝方') &&
                !(cellVal === 'blue' || cellVal === '蓝方' || cellVal.includes('blue') || cellVal.includes('蓝'))
              ) {
                continue;
              } else if (targetVal !== 'red' && targetVal !== '红方' && targetVal !== 'blue' && targetVal !== '蓝方') {
                if (cellVal !== targetVal) continue;
              }
            }

            // 转换数据类型（数字、布尔、字符串）
            const rowObj: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(r.data)) {
              const trimmed = (v ?? '').trim();
              if (trimmed === '' || trimmed === '-') {
                rowObj[k] = null;
              } else if (!isNaN(Number(trimmed)) && !trimmed.startsWith('0x')) {
                rowObj[k] = Number(trimmed);
              } else if (trimmed.toLowerCase() === 'true') {
                rowObj[k] = true;
              } else if (trimmed.toLowerCase() === 'false') {
                rowObj[k] = false;
              } else {
                rowObj[k] = trimmed;
              }
            }
            mergedRows.push(rowObj);
            if (mergedRows.length >= maxLimit) break;
          }
          if (mergedRows.length >= maxLimit) break;
        }

        // 构造 Dataset 字段类型定义
        const columns: DatasetColumn[] = discoveredHeaders.map((h) => {
          let isNum = false;
          let isBool = false;
          let nonNullCount = 0;
          for (const row of mergedRows.slice(0, 30)) {
            const val = row[h];
            if (val !== null && val !== undefined) {
              nonNullCount++;
              if (typeof val === 'number') isNum = true;
              if (typeof val === 'boolean') isBool = true;
            }
          }
          let type: FieldDataType = 'string';
          if (nonNullCount > 0) {
            if (isNum && !isBool) type = 'number';
            else if (isBool && !isNum) type = 'boolean';
          }
          return {
            name: h,
            displayName: h,
            type,
          };
        });

        const dataset: TableDataset & {
          sourceRunId?: string;
          sourceTableName?: string;
          isRealData?: boolean;
          scenarioName?: string;
        } = {
          id: `dataset_${sit.runId}_${targetCanonical}`,
          columns,
          schema: columns,
          rows: mergedRows,
          totalRows: mergedRows.length,
          sourceRunId: sit.runId,
          sourceTableName: targetCanonical,
          isRealData: true,
          scenarioName: sit.scenarioName || sit.runId,
        };

        return {
          found: true,
          dataset,
          totalAvailableRows: mergedRows.length,
        };
      }
    }
  }

  // 2. 次选：从已存储的仿真事件表 (sit.events) 中聚合提取
  if (sit.events && sit.events.length > 0) {
    const matchingEvents = sit.events.filter((e) => {
      const k = (e.kind || '').toLowerCase();
      return k === targetCanonical || k === targetStem;
    });

    if (matchingEvents.length > 0) {
      const maxLimit = Math.max(1, Math.min(options?.limit ?? 200, 2000));
      const mergedRows: Array<Record<string, unknown>> = [];
      const allKeySet = new Set<string>(['Time', 'EventID', 'Side', 'Kind', 'Subject', 'Object']);

      for (const ev of matchingEvents) {
        let detail: Record<string, unknown> = {};
        try {
          detail = typeof (ev as any).detail === 'object' ? (ev as any).detail : JSON.parse((ev as any).detail_json || '{}');
        } catch {}
        for (const dk of Object.keys(detail)) allKeySet.add(dk);

        const rowObj: Record<string, unknown> = {
          Time: ev.clockText || ev.scenarioSeconds,
          EventID: ev.eventId,
          Side: ev.side || '',
          Kind: ev.kind,
          Subject: ev.subject || '',
          Object: ev.object || '',
          ...detail,
        };

        if (options?.filterField && options?.filterEquals !== undefined && options.filterEquals !== '') {
          const cVal = String(rowObj[options.filterField] ?? '').trim().toLowerCase();
          const tVal = options.filterEquals.trim().toLowerCase();
          if (cVal !== tVal) continue;
        }

        mergedRows.push(rowObj);
        if (mergedRows.length >= maxLimit) break;
      }

      const columns: DatasetColumn[] = Array.from(allKeySet).map((k) => ({
        name: k,
        displayName: k,
        type: k === 'Time' && typeof mergedRows[0]?.[k] === 'number' ? 'number' : 'string',
      }));

      return {
        found: true,
        dataset: {
          id: `dataset_${sit.runId}_${targetCanonical}`,
          columns,
          schema: columns,
          rows: mergedRows,
          totalRows: mergedRows.length,
          sourceRunId: sit.runId,
          sourceTableName: targetCanonical,
          isRealData: true,
          scenarioName: sit.scenarioName || sit.runId,
        },
        totalAvailableRows: mergedRows.length,
      };
    }
  }

  return {
    found: false,
    reason: `推演场景 [${sit.scenarioName || sit.runId}] 中未发现事件底表 "${tableName}" 数据`,
  };
}
