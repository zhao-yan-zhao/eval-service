import fs from 'node:fs';
import path from 'node:path';
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
  private presets: IndicatorSystem[] = [];
  private custom: Map<string, IndicatorSystem> = new Map();

  constructor(
    customFilePath = DEFAULT_CUSTOM_SYSTEMS_PATH,
    indicatorStore = defaultIndicatorStore,
  ) {
    this.customFilePath = customFilePath;
    this.indicatorStore = indicatorStore;
    this.load();
  }

  private load(): void {
    this.presets = [];
    if (fs.existsSync(PRESETS_DIR)) {
      const files = fs
        .readdirSync(PRESETS_DIR)
        .filter((f) => f.endsWith('.json'))
        .sort();
      for (const f of files) {
        const parsed = JSON.parse(
          fs.readFileSync(path.join(PRESETS_DIR, f), 'utf-8'),
        ) as IndicatorSystem;
        this.presets.push({ ...parsed, builtin: true });
      }
    }

    if (fs.existsSync(this.customFilePath)) {
      const items = JSON.parse(
        fs.readFileSync(this.customFilePath, 'utf-8'),
      ) as IndicatorSystem[];
      this.custom.clear();
      for (const s of items) {
        this.custom.set(s.systemId, { ...s, builtin: false });
      }
    }
  }

  private persistCustom(): void {
    fs.mkdirSync(path.dirname(this.customFilePath), { recursive: true });
    fs.writeFileSync(
      this.customFilePath,
      JSON.stringify([...this.custom.values()], null, 2),
      'utf-8',
    );
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
    if (deleted) this.persistCustom();
    return deleted;
  }
}

export const defaultSystemStore = new SystemStore();
