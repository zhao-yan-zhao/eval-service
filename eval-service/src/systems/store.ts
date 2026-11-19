import fs from 'node:fs';
import path from 'node:path';
import type { EvalSqliteStore } from '../adapters/sqlite-store.ts';
import type { IndicatorSystem } from '../core/types.ts';
import { defaultIndicatorStore, type IndicatorStore } from '../indicators/store.ts';
import { validateIndicatorSystem } from './validator.ts';

const PRESETS_DIR = path.resolve(import.meta.dirname, 'presets');
const DEFAULT_CUSTOM_SYSTEMS_PATH = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'data',
  'custom-systems.json',
);

export class SystemStore {
  private readonly customFilePath: string;
  private readonly indicatorStore: IndicatorStore;
  private readonly sqliteStore?: EvalSqliteStore;
  private presets: IndicatorSystem[] = [];
  private custom: Map<string, IndicatorSystem> = new Map();

  constructor(
    customFilePath = DEFAULT_CUSTOM_SYSTEMS_PATH,
    indicatorStore = defaultIndicatorStore,
    sqliteStore?: EvalSqliteStore,
  ) {
    this.customFilePath = customFilePath;
    this.indicatorStore = indicatorStore;
    this.sqliteStore = sqliteStore;
    this.load();
  }

  private load(): void {
    this.presets = [];

    // 1. 加载内置预设体系
    if (this.sqliteStore) {
      const dbPresets = this.sqliteStore.listSystems({ builtinOnly: true });
      if (dbPresets.length > 0) {
        this.presets = dbPresets;
      }
    }
    if (this.presets.length === 0 && fs.existsSync(PRESETS_DIR)) {
      const files = fs
        .readdirSync(PRESETS_DIR)
        .filter((f) => f.endsWith('.json'))
        .sort();
      for (const f of files) {
        try {
          const parsed = JSON.parse(
            fs.readFileSync(path.join(PRESETS_DIR, f), 'utf-8'),
          ) as IndicatorSystem;
          const presetObj = { ...parsed, builtin: true };
          this.presets.push(presetObj);
          if (this.sqliteStore) {
            this.sqliteStore.saveSystem(presetObj, true);
          }
        } catch {}
      }
    }

    // 2. 加载用户自定义体系
    if (this.sqliteStore) {
      const dbCustom = this.sqliteStore.listSystems({ customOnly: true });
      if (dbCustom.length > 0) {
        this.custom.clear();
        for (const s of dbCustom) {
          this.custom.set(s.systemId, { ...s, builtin: false });
        }
        return;
      }
    }

    if (fs.existsSync(this.customFilePath)) {
      try {
        const items = JSON.parse(
          fs.readFileSync(this.customFilePath, 'utf-8'),
        ) as IndicatorSystem[];
        this.custom.clear();
        for (const s of items) {
          this.custom.set(s.systemId, { ...s, builtin: false });
          if (this.sqliteStore) {
            this.sqliteStore.saveSystem(s, false);
          }
        }
      } catch {
        this.custom.clear();
      }
    }
  }

  private persistCustom(): void {
    if (this.sqliteStore) {
      for (const s of this.custom.values()) {
        this.sqliteStore.saveSystem(s, false);
      }
    }
    if (this.customFilePath && (!this.sqliteStore || this.customFilePath !== DEFAULT_CUSTOM_SYSTEMS_PATH)) {
      try {
        fs.mkdirSync(path.dirname(this.customFilePath), { recursive: true });
        fs.writeFileSync(
          this.customFilePath,
          JSON.stringify([...this.custom.values()], null, 2),
          'utf-8',
        );
      } catch {
        // 兼容只读或临时沙箱环境
      }
    }
  }

  listAll(): IndicatorSystem[] {
    const byId = new Map<string, IndicatorSystem>();
    for (const p of this.presets) byId.set(p.systemId, p);
    for (const c of this.custom.values()) byId.set(c.systemId, c);
    return [...byId.values()];
  }

  get(systemId: string): IndicatorSystem | undefined {
    return this.custom.get(systemId) ?? this.presets.find((p) => p.systemId === systemId);
  }

  upsertCustom(system: IndicatorSystem): IndicatorSystem {
    const check = validateIndicatorSystem(system, this.indicatorStore);
    if (!check.valid) {
      throw new Error(`评估体系校验失败: ${check.errors.join('; ')}`);
    }
    const clean: IndicatorSystem = { ...system, builtin: false };
    this.custom.set(clean.systemId, clean);
    if (this.sqliteStore) {
      this.sqliteStore.saveSystem(clean, false);
    }
    this.persistCustom();
    return clean;
  }

  deleteCustom(systemId: string): boolean {
    const builtinOnly =
      this.presets.some((p) => p.systemId === systemId) && !this.custom.has(systemId);
    if (builtinOnly) {
      throw new Error(`不允许删除内置预置评估体系: ${systemId}`);
    }
    const deleted = this.custom.delete(systemId);
    if (deleted) {
      if (this.sqliteStore) {
        this.sqliteStore.deleteSystem(systemId);
      }
      this.persistCustom();
    }
    return deleted;
  }
}

export const defaultSystemStore = new SystemStore();
