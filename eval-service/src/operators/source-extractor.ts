import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error demo-ui/proxy/bs-diff.mjs 为无类型标注 ESM 模块
import { scenarioOf, unwrapRecord } from '../../../demo-ui/proxy/bs-diff.mjs';
import {
  locateCsvDirectory,
  readCsvTable,
  resolveCanonicalCsvEventName,
} from '../adapters/csv-adapter.ts';
import { unwrapEntity } from '../adapters/frame-adapter.ts';
import type {
  CustomOperatorDefinition,
  EvidenceRef,
  MetricAtomContext,
  MetricAtomResult,
  SourceBindingAgg,
} from '../core/types.ts';
import { resolveSides, unavailableResult } from './helpers.ts';

function resolveFilterValue(
  rawEquals: string | undefined,
  ctx: MetricAtomContext,
): string | undefined {
  if (rawEquals === undefined) return undefined;
  const trimmed = rawEquals.trim();
  if (!trimmed) return undefined;
  const { targetSide, enemySide } = resolveSides(ctx.situation, ctx.customParams);
  if (trimmed === '${targetSide}') return targetSide;
  if (trimmed === '${enemySide}') return enemySide;
  return trimmed;
}

function aggregateValues(
  atomId: string,
  agg: SourceBindingAgg,
  values: unknown[],
  matchedRowCount: number,
  evidenceRefs: EvidenceRef[],
  unit: string | undefined,
  extraDetails: Record<string, unknown>,
): MetricAtomResult {
  const nonEmpty = values.filter((v) => v !== undefined && v !== null && String(v).trim() !== '');

  if (agg === 'count_rows') {
    return {
      atomId,
      value: matchedRowCount,
      displayValue: `${matchedRowCount}${unit ? ` ${unit}` : ' 行'}`,
      status: 'valid',
      confidence: 'high',
      evidenceRefs,
      details: { ...extraDetails, aggregation: agg, matchedRowCount },
    };
  }

  if (agg === 'count_non_empty') {
    return {
      atomId,
      value: nonEmpty.length,
      displayValue: `${nonEmpty.length}${unit ? ` ${unit}` : ' 条'}`,
      status: 'valid',
      confidence: 'high',
      evidenceRefs,
      details: { ...extraDetails, aggregation: agg, matchedRowCount, nonEmptyCount: nonEmpty.length },
    };
  }

  if (agg === 'count_distinct') {
    const distinct = new Set(nonEmpty.map((v) => String(v).trim()));
    return {
      atomId,
      value: distinct.size,
      displayValue: `${distinct.size}${unit ? ` ${unit}` : ' 种'}`,
      status: 'valid',
      confidence: 'high',
      evidenceRefs,
      details: {
        ...extraDetails,
        aggregation: agg,
        matchedRowCount,
        distinctCount: distinct.size,
        sampleDistinct: [...distinct].slice(0, 8),
      },
    };
  }

  const nums: number[] = [];
  for (const raw of nonEmpty) {
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (Number.isFinite(n)) nums.push(n);
  }

  if (nums.length === 0) {
    return unavailableResult(
      atomId,
      `数据源已命中 ${matchedRowCount} 条记录，但目标字段均无法解析为有限数值 (${agg})`,
    );
  }

  let outVal = nums[0]!;
  if (agg === 'sum') outVal = nums.reduce((a, b) => a + b, 0);
  else if (agg === 'avg') outVal = nums.reduce((a, b) => a + b, 0) / nums.length;
  else if (agg === 'min') outVal = Math.min(...nums);
  else if (agg === 'max') outVal = Math.max(...nums);
  else if (agg === 'first_num') outVal = nums[0]!;
  else if (agg === 'last_num') outVal = nums[nums.length - 1]!;

  const rounded = Math.round(outVal * 10000) / 10000;
  return {
    atomId,
    value: rounded,
    displayValue: `${rounded}${unit ? ` ${unit}` : ''}`,
    status: 'valid',
    confidence: 'high',
    evidenceRefs,
    details: {
      ...extraDetails,
      aggregation: agg,
      matchedRowCount,
      numericSampleCount: nums.length,
    },
  };
}

function resolveCsvHeaderCaseInsensitive(headers: string[], target?: string): string | undefined {
  if (!target) return undefined;
  const trimmed = target.trim();
  const exact = headers.find((h) => h === trimmed);
  if (exact) return exact;
  const low = trimmed.toLowerCase();
  return headers.find((h) => h.toLowerCase() === low);
}

function evaluateCsvBinding(
  def: CustomOperatorDefinition,
  ctx: MetricAtomContext,
): MetricAtomResult {
  const binding = def.sourceBinding!;
  const scenarioPath = ctx.situation.scenarioPath;
  if (!scenarioPath || !fs.existsSync(scenarioPath) || !fs.statSync(scenarioPath).isDirectory()) {
    return unavailableResult(def.id, '当前 Run 未关联本地 EventExporter CSV 目录，无法直连提取 CSV 表列');
  }
  const csvDir = locateCsvDirectory(scenarioPath);
  if (!fs.existsSync(csvDir) || !fs.statSync(csvDir).isDirectory()) {
    return unavailableResult(def.id, `未找到 CSV 目录: ${csvDir}`);
  }

  const targetTable = (binding.csvTable ?? '').trim().toLowerCase();
  if (!targetTable) {
    return unavailableResult(def.id, '数据源直连缺少 csvTable 配置');
  }

  const csvFiles = fs
    .readdirSync(csvDir)
    .filter((f) => f.toLowerCase().endsWith('.csv'))
    .filter((f) => {
      const canonical = resolveCanonicalCsvEventName(f).toLowerCase();
      const stem = f.replace(/\.csv$/i, '').toLowerCase();
      return canonical === targetTable || stem === targetTable || f.toLowerCase() === targetTable;
    });

  if (csvFiles.length === 0) {
    return unavailableResult(def.id, `CSV 目录中未找到事件表 "${binding.csvTable}"`);
  }

  const filterTarget = resolveFilterValue(binding.filterEquals, ctx);
  const filterColRaw = binding.filterField?.trim();

  const values: unknown[] = [];
  const evidenceRefs: EvidenceRef[] = [];
  let matchedRowCount = 0;
  let columnMatchedAnywhere = !binding.csvColumn?.trim();
  const discoveredHeaders = new Set<string>();

  for (const fileName of csvFiles) {
    const fullPath = path.join(csvDir, fileName);
    const table = readCsvTable(fullPath, ctx.situation.timelineId);
    for (const h of table.headers) discoveredHeaders.add(h);

    const colHeader = resolveCsvHeaderCaseInsensitive(table.headers, binding.csvColumn);
    const filterHeader = resolveCsvHeaderCaseInsensitive(table.headers, filterColRaw);
    if (binding.csvColumn?.trim() && colHeader) {
      columnMatchedAnywhere = true;
    }
    if (binding.csvColumn?.trim() && !colHeader) continue;

    for (const row of table.rows) {
      if (filterColRaw && filterTarget !== undefined) {
        if (!filterHeader) continue;
        const cell = (row.data[filterHeader] ?? '').trim();
        if (cell.toLowerCase() !== filterTarget.toLowerCase()) continue;
      }
      matchedRowCount += 1;
      const cellVal = colHeader ? row.data[colHeader] : undefined;
      if (colHeader) values.push(cellVal);

      if (evidenceRefs.length < 5) {
        evidenceRefs.push({
          source: 'csv',
          ref: `CSV:${row.file}#L${row.line}`,
          scenarioClock: row.data.Time ?? '-',
          description: colHeader
            ? `${binding.csvTable}.${colHeader} = ${cellVal ?? '(空)'}`
            : `命中 ${binding.csvTable} 记录`,
        });
      }
    }
  }

  if (!columnMatchedAnywhere) {
    const sampleCols = [...discoveredHeaders].slice(0, 12).join(', ');
    return unavailableResult(
      def.id,
      `表 "${binding.csvTable}" 中不存在字段列 "${binding.csvColumn}"（可用列: ${sampleCols || '无数据表头'}）`,
    );
  }

  return aggregateValues(def.id, binding.aggregation, values, matchedRowCount, evidenceRefs, def.unit, {
    mode: 'source_binding',
    sourceType: 'csv',
    csvTable: binding.csvTable,
    csvColumn: binding.csvColumn ?? null,
    matchedFiles: csvFiles,
    filterApplied: filterColRaw ? `${filterColRaw}=${filterTarget ?? ''}` : null,
  });
}

interface BsMatchedItem {
  value: unknown;
  parent: Record<string, unknown> | null;
}

function normalizePathTokens(rawPath: string): string[] {
  const clean = rawPath.trim().replace(/^Scenario\./i, '');
  if (!clean) return [];
  return clean
    .split('.')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '<UnitType>');
}

function walkBsPath(
  node: unknown,
  tokens: string[],
  idx: number,
  parentObj: Record<string, unknown> | null,
  out: BsMatchedItem[],
): void {
  if (node === undefined || node === null) return;
  if (idx >= tokens.length) {
    out.push({ value: node, parent: parentObj });
    return;
  }

  const rawSeg = tokens[idx]!;
  // 支持兼容写法如 (Side.)Contacts[] -> 提取真实字段名
  const segClean = rawSeg.replace(/^\([^)]*\)/, '');
  const isArraySeg = segClean.endsWith('[]');
  const key = isArraySeg ? segClean.slice(0, -2) : segClean;

  if (!key) {
    if (Array.isArray(node)) {
      for (const el of node) {
        const unwrapped = unwrapEntity<Record<string, unknown>>(el) ?? (el as Record<string, unknown>);
        walkBsPath(unwrapped, tokens, idx + 1, unwrapped, out);
      }
    }
    return;
  }

  if (typeof node !== 'object' || Array.isArray(node)) return;
  let obj = node as Record<string, unknown>;
  if (!(key in obj)) {
    const unwrapped = unwrapEntity<Record<string, unknown>>(obj);
    if (unwrapped && key in unwrapped) {
      obj = unwrapped;
    } else {
      // 允许数组元素的中间容器被扁平跳过一步
      const keys = Object.keys(obj);
      if (keys.length === 1 && typeof obj[keys[0]!] === 'object' && obj[keys[0]!] !== null) {
        const inner = obj[keys[0]!] as Record<string, unknown>;
        if (key in inner) obj = inner;
        else return;
      } else {
        return;
      }
    }
  }

  const child = obj[key];
  if (child === undefined || child === null) return;

  if (isArraySeg) {
    if (!Array.isArray(child)) return;
    for (const item of child) {
      const itemObj =
        item && typeof item === 'object' && !Array.isArray(item)
          ? (unwrapEntity<Record<string, unknown>>(item) ?? (item as Record<string, unknown>))
          : null;
      walkBsPath(itemObj ?? item, tokens, idx + 1, itemObj ?? obj, out);
    }
    return;
  }

  if (idx === tokens.length - 1) {
    out.push({ value: child, parent: obj });
    return;
  }

  const nextObj =
    child && typeof child === 'object' && !Array.isArray(child)
      ? (unwrapEntity<Record<string, unknown>>(child) ?? (child as Record<string, unknown>))
      : child;
  walkBsPath(nextObj, tokens, idx + 1, typeof nextObj === 'object' ? (nextObj as Record<string, unknown>) : obj, out);
}

function evaluateBsJsonlBinding(
  def: CustomOperatorDefinition,
  ctx: MetricAtomContext,
): MetricAtomResult {
  const binding = def.sourceBinding!;
  const scenarioPath = ctx.situation.scenarioPath;
  if (!scenarioPath || !fs.existsSync(scenarioPath) || !fs.statSync(scenarioPath).isFile()) {
    return unavailableResult(def.id, '当前 Run 未关联本地 BS JSONL 帧文件，无法直连提取 JSONL 路径');
  }

  const tokens = normalizePathTokens(binding.bsPath ?? '');
  if (tokens.length === 0) {
    return unavailableResult(def.id, '数据源直连缺少有效的 bsPath 路径表达式');
  }

  const rawLines = fs.readFileSync(scenarioPath, 'utf-8').split(/\r?\n/);
  const filterTarget = resolveFilterValue(binding.filterEquals, ctx);
  const filterKey = binding.filterField?.trim();

  const values: unknown[] = [];
  const evidenceRefs: EvidenceRef[] = [];
  let matchedRowCount = 0;
  let parsedFrames = 0;

  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i]!.trim();
    if (!line) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    parsedFrames += 1;
    const unwrapped = unwrapRecord(record) as { frame?: unknown };
    const sc = (scenarioOf(unwrapped.frame) ?? scenarioOf(record)) as Record<string, unknown> | null;
    if (!sc || typeof sc !== 'object') continue;

    const hits: BsMatchedItem[] = [];
    walkBsPath(sc, tokens, 0, sc, hits);

    for (const hit of hits) {
      if (filterKey && filterTarget !== undefined) {
        const fv = hit.parent ? hit.parent[filterKey] : undefined;
        if (fv === undefined || fv === null) continue;
        if (String(fv).trim().toLowerCase() !== filterTarget.toLowerCase()) continue;
      }
      matchedRowCount += 1;
      values.push(hit.value);
      if (evidenceRefs.length < 5) {
        evidenceRefs.push({
          source: 'frame',
          ref: `FRAME:${i + 1}`,
          scenarioClock: String(sc.Time ?? '-'),
          description: `${binding.bsPath} = ${
            typeof hit.value === 'object' ? JSON.stringify(hit.value).slice(0, 60) : String(hit.value)
          }`,
        });
      }
    }
  }

  if (parsedFrames === 0 || matchedRowCount === 0) {
    return unavailableResult(
      def.id,
      `在 ${parsedFrames} 帧 BS JSONL 中未命中路径 "${binding.bsPath}"${filterKey && filterTarget ? ` (过滤 ${filterKey}=${filterTarget})` : ''}`,
    );
  }

  return aggregateValues(def.id, binding.aggregation, values, matchedRowCount, evidenceRefs, def.unit, {
    mode: 'source_binding',
    sourceType: 'bs_jsonl',
    bsPath: binding.bsPath,
    parsedFrames,
    filterApplied: filterKey ? `${filterKey}=${filterTarget ?? ''}` : null,
  });
}

export function evaluateSourceBindingOperator(
  def: CustomOperatorDefinition,
  ctx: MetricAtomContext,
): MetricAtomResult {
  if (!def.sourceBinding) {
    return unavailableResult(def.id, '数据源直连算子缺少 sourceBinding 配置');
  }
  if (def.sourceBinding.sourceType === 'csv') {
    return evaluateCsvBinding(def, ctx);
  }
  return evaluateBsJsonlBinding(def, ctx);
}
