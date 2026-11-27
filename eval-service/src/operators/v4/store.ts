import type {
  EvalSqliteStore,
  V4ListFilter,
  V4StoredOperator,
} from '../../adapters/sqlite-store.ts';
import { ALL_V4_OPERATOR_SCRIPTS } from './index.ts';
import type { V4OperatorScriptSpec } from './types.ts';

export interface V4OperatorFilter extends V4ListFilter {
  domainTag?: string;
  layer?: string;
}

export class V4OperatorStore {
  private sqliteStore?: EvalSqliteStore;
  private readonly builtinTemplates: Map<string, V4OperatorScriptSpec>;
  private readonly memoryItems = new Map<string, V4StoredOperator>();
  private readonly autoSeedBuiltins: boolean;

  constructor(
    sqliteStore?: EvalSqliteStore,
    options?: { seedBuiltins?: boolean; builtinSpecs?: V4OperatorScriptSpec[] },
  ) {
    this.sqliteStore = sqliteStore;
    this.autoSeedBuiltins = options?.seedBuiltins !== false;
    const baseSpecs = options?.builtinSpecs ?? ALL_V4_OPERATOR_SCRIPTS;
    this.builtinTemplates = new Map(baseSpecs.map((s) => [s.id, structuredClone(s)]));
    this.load();
  }

  getSqliteStore(): EvalSqliteStore | undefined {
    return this.sqliteStore;
  }

  rebindSqliteStore(newStore: EvalSqliteStore): void {
    this.sqliteStore = newStore;
    this.load();
  }

  private load(): void {
    if (this.sqliteStore) {
      const isBlank = this.sqliteStore.getMeta('is_blank') === '1';
      if (!isBlank && this.autoSeedBuiltins && this.sqliteStore.countV4Operators() === 0) {
        this.seedBuiltins([...this.builtinTemplates.values()]);
      }
      return;
    }

    this.memoryItems.clear();
    if (this.autoSeedBuiltins) {
      for (const spec of this.builtinTemplates.values()) {
        this.memoryItems.set(spec.id, {
          ...structuredClone(spec),
          layer: spec.layer ?? 'fact',
          engineKind: spec.engineKind ?? 'python_script',
          isBuiltin: true,
        });
      }
    }
  }

  seedBuiltins(specs: V4OperatorScriptSpec[] = [...this.builtinTemplates.values()]): number {
    for (const s of specs) {
      if (s?.id) {
        this.builtinTemplates.set(s.id, structuredClone(s));
      }
    }

    if (this.sqliteStore) {
      if (this.sqliteStore.getMeta('is_blank') === '1') {
        return 0;
      }
      let count = 0;
      for (const spec of specs) {
        if (!spec?.id) continue;
        this.sqliteStore.upsertV4Operator(
          {
            ...structuredClone(spec),
            layer: spec.layer ?? 'fact',
            engineKind: spec.engineKind ?? 'python_script',
            isBuiltin: true,
          },
          true,
        );
        count += 1;
      }
      return count;
    }

    let count = 0;
    for (const spec of specs) {
      if (!spec?.id) continue;
      this.memoryItems.set(spec.id, {
        ...structuredClone(spec),
        layer: spec.layer ?? 'fact',
        engineKind: spec.engineKind ?? 'python_script',
        isBuiltin: true,
      });
      count += 1;
    }
    return count;
  }

  list(filter?: V4OperatorFilter): V4StoredOperator[] {
    if (this.sqliteStore) {
      return this.sqliteStore.listV4Operators(filter);
    }

    let items = [...this.memoryItems.values()];
    if (filter?.builtinOnly) items = items.filter((i) => i.isBuiltin === true);
    else if (filter?.customOnly) items = items.filter((i) => i.isBuiltin !== true);
    if (filter?.domainTag) items = items.filter((i) => i.domainTag === filter.domainTag);
    if (filter?.layer) items = items.filter((i) => (i.layer ?? 'fact') === filter.layer);
    return items
      .sort((a, b) => (a.chapter - b.chapter) || a.id.localeCompare(b.id))
      .map((i) => structuredClone(i));
  }

  get(id: string): V4StoredOperator | null {
    if (this.sqliteStore) {
      return this.sqliteStore.getV4Operator(id);
    }
    const found = this.memoryItems.get(id);
    return found ? structuredClone(found) : null;
  }

  upsert(spec: V4StoredOperator, isBuiltin?: boolean): V4StoredOperator {
    if (!spec || typeof spec.id !== 'string' || !spec.id.trim()) {
      throw new Error('V4 算子定义缺少有效的 id');
    }
    if (!spec.name || typeof spec.name !== 'string' || !spec.name.trim()) {
      throw new Error('V4 算子定义缺少有效的 name');
    }
    const existing = this.get(spec.id);
    const builtinFlag = isBuiltin ?? existing?.isBuiltin ?? Boolean(spec.isBuiltin);
    const clean: V4StoredOperator = {
      ...structuredClone(spec),
      layer: spec.layer ?? 'fact',
      engineKind: spec.engineKind ?? 'python_script',
      isBuiltin: builtinFlag,
      updatedAt: new Date().toISOString(),
    };

    if (this.sqliteStore) {
      this.sqliteStore.upsertV4Operator(clean, builtinFlag);
    } else {
      this.memoryItems.set(clean.id, clean);
    }
    return structuredClone(clean);
  }

  update(id: string, patch: Partial<V4StoredOperator>): V4StoredOperator {
    const existing = this.get(id);
    if (!existing) {
      throw new Error(`未找到 V4 算子: ${id}`);
    }
    const merged: V4StoredOperator = {
      ...existing,
      ...structuredClone(patch),
      id: existing.id,
      isBuiltin: existing.isBuiltin,
      updatedAt: new Date().toISOString(),
    };
    if (this.sqliteStore) {
      this.sqliteStore.upsertV4Operator(merged, Boolean(existing.isBuiltin));
    } else {
      this.memoryItems.set(merged.id, merged);
    }
    return structuredClone(merged);
  }

  delete(id: string, opts?: { allowBuiltin?: boolean }): boolean {
    const existing = this.get(id);
    if (!existing) return false;
    if (existing.isBuiltin && !opts?.allowBuiltin) {
      throw new Error(`不允许删除内置 V4 算子: ${id}`);
    }
    if (this.sqliteStore) {
      return this.sqliteStore.deleteV4Operator(id, opts);
    }
    return this.memoryItems.delete(id);
  }

  resetOverride(id: string): V4StoredOperator {
    const template = this.builtinTemplates.get(id);
    if (!template) {
      throw new Error(`仅支持重置内置 V4 算子，未找到内置模板: ${id}`);
    }
    const restored: V4StoredOperator = {
      ...structuredClone(template),
      layer: template.layer ?? 'fact',
      engineKind: template.engineKind ?? 'python_script',
      isBuiltin: true,
      updatedAt: new Date().toISOString(),
    };
    if (this.sqliteStore) {
      this.sqliteStore.upsertV4Operator(restored, true);
    } else {
      this.memoryItems.set(restored.id, restored);
    }
    return structuredClone(restored);
  }
}

export const defaultV4OperatorStore = new V4OperatorStore();
