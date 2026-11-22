import fs from 'node:fs';
import path from 'node:path';
import type { EvalSqliteStore } from '../adapters/sqlite-store.ts';
import type {
  BuiltinOperatorOverride,
  OperatorDefaultParams,
  OperatorFieldContract,
  OptimalDirection,
} from '../core/types.ts';

const DEFAULT_OVERRIDES_PATH = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'data',
  'operator-overrides.json',
);

const NUMERIC_PARAM_KEYS: Array<keyof OperatorDefaultParams> = [
  'safeRadiusNm',
  'minRangeNm',
  'expectedSpacingNm',
  'arrivalLineLon',
  'waveGapSeconds',
  'minSafeMarginKm',
  'thresholdLow',
  'thresholdHigh',
];

const VALID_DIRECTIONS = new Set<OptimalDirection>([
  'smaller_is_better',
  'larger_is_better',
  'range_bounded',
]);

export function sanitizeDefaultParams(
  raw?: OperatorDefaultParams | Record<string, unknown> | null,
): { params?: OperatorDefaultParams; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { params: undefined, errors };
  }
  const src = raw as Record<string, unknown>;
  const out: OperatorDefaultParams = {};

  for (const strKey of ['targetSide', 'enemySide'] as const) {
    const val = src[strKey];
    if (typeof val === 'string' && val.trim()) {
      out[strKey] = val.trim();
    }
  }

  for (const numKey of NUMERIC_PARAM_KEYS) {
    const val = src[numKey];
    if (val === undefined || val === null || val === '') continue;
    const num = Number(val);
    if (!Number.isFinite(num)) {
      errors.push(`默认参数 ${String(numKey)} 必须为有限数值`);
    } else {
      (out as Record<string, number>)[numKey] = num;
    }
  }

  return {
    params: Object.keys(out).length > 0 ? out : undefined,
    errors,
  };
}

function cleanStrArray(arr?: unknown): string[] | undefined {
  if (!Array.isArray(arr)) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.length > 0 ? out : undefined;
}

export function sanitizeFieldContract(
  raw?: OperatorFieldContract | Record<string, unknown> | null,
): OperatorFieldContract | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  const csvTables = cleanStrArray(src.csvTables);
  const csvColumns = cleanStrArray(src.csvColumns);
  const bsFramePaths = cleanStrArray(src.bsFramePaths);
  const discrepancyNotes = cleanStrArray(src.discrepancyNotes);
  const out: OperatorFieldContract = {
    ...(csvTables ? { csvTables } : {}),
    ...(csvColumns ? { csvColumns } : {}),
    ...(bsFramePaths ? { bsFramePaths } : {}),
    ...(discrepancyNotes ? { discrepancyNotes } : {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}

export class OperatorOverrideStore {
  private readonly filePath: string;
  private sqliteStore?: EvalSqliteStore;
  private items: Map<string, BuiltinOperatorOverride> = new Map();

  constructor(filePath = DEFAULT_OVERRIDES_PATH, sqliteStore?: EvalSqliteStore) {
    this.filePath = filePath;
    this.sqliteStore = sqliteStore;
    this.load();
  }

  rebindSqliteStore(newStore: EvalSqliteStore): void {
    this.sqliteStore = newStore;
    this.items.clear();
    const fromDb = this.sqliteStore.listOperatorOverrides();
    for (const [id, item] of Object.entries(fromDb)) {
      this.items.set(id, item);
    }
  }

  private load(): void {
    if (this.sqliteStore) {
      const fromDb = this.sqliteStore.listOperatorOverrides();
      const keys = Object.keys(fromDb);
      if (keys.length > 0) {
        this.items.clear();
        for (const [id, item] of Object.entries(fromDb)) {
          this.items.set(id, item);
        }
        return;
      }
    }

    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as BuiltinOperatorOverride[];
      if (Array.isArray(parsed)) {
        this.items.clear();
        for (const item of parsed) {
          if (item && typeof item.id === 'string') {
            this.items.set(item.id, item);
            if (this.sqliteStore) {
              this.sqliteStore.saveOperatorOverride(item.id, item);
            }
          }
        }
      }
    } catch {
      this.items.clear();
    }
  }

  private persist(): void {
    if (this.sqliteStore) {
      for (const item of this.items.values()) {
        this.sqliteStore.saveOperatorOverride(item.id, item);
      }
    }
    if (this.filePath && (!this.sqliteStore || this.filePath !== DEFAULT_OVERRIDES_PATH)) {
      try {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify([...this.items.values()], null, 2), 'utf-8');
      } catch {
        // 兼容只读或临时沙箱环境
      }
    }
  }

  listAll(): BuiltinOperatorOverride[] {
    return [...this.items.values()];
  }

  get(id: string): BuiltinOperatorOverride | undefined {
    return this.items.get(id);
  }

  upsert(
    input: BuiltinOperatorOverride,
    builtinIds: Set<string>,
  ): BuiltinOperatorOverride {
    if (!builtinIds.has(input.id)) {
      throw new Error(`内置算子不存在，无法覆写: ${input.id}`);
    }
    const errs: string[] = [];
    if (input.name !== undefined && !input.name.trim()) {
      errs.push('算子显示名称不能为空');
    }
    if (
      input.defaultOptimalDirection !== undefined &&
      !VALID_DIRECTIONS.has(input.defaultOptimalDirection)
    ) {
      errs.push(`非法优劣方向: ${String(input.defaultOptimalDirection)}`);
    }
    const { params, errors: paramErrs } = sanitizeDefaultParams(input.defaultParams);
    errs.push(...paramErrs);

    if (errs.length > 0) {
      throw new Error(`内置算子配置校验失败: ${errs.join('；')}`);
    }

    const cleanContract =
      input.f1FieldContract !== undefined
        ? sanitizeFieldContract(input.f1FieldContract) ?? {}
        : undefined;

    const clean: BuiltinOperatorOverride = {
      id: input.id,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(input.unit !== undefined ? { unit: input.unit.trim() } : {}),
      ...(input.defaultOptimalDirection !== undefined
        ? { defaultOptimalDirection: input.defaultOptimalDirection }
        : {}),
      ...(params ? { defaultParams: params } : {}),
      ...(cleanContract !== undefined ? { f1FieldContract: cleanContract } : {}),
      updatedAt: new Date().toISOString(),
    };

    this.items.set(clean.id, clean);
    if (this.sqliteStore) {
      this.sqliteStore.saveOperatorOverride(clean.id, clean);
    }
    this.persist();
    return clean;
  }

  delete(id: string): boolean {
    const removed = this.items.delete(id);
    if (removed) {
      if (this.sqliteStore) {
        this.sqliteStore.deleteOperatorOverride(id);
      }
      this.persist();
    }
    return removed;
  }
}

export const defaultOperatorOverrideStore = new OperatorOverrideStore();
