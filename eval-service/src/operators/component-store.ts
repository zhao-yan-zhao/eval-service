import fs from 'node:fs';
import path from 'node:path';
import type { EvalSqliteStore } from '../adapters/sqlite-store.ts';

function isSqliteStoreLike(v: unknown): v is EvalSqliteStore {
  return (
    Boolean(v) &&
    typeof v === 'object' &&
    typeof (v as EvalSqliteStore).listV4Components === 'function' &&
    typeof (v as EvalSqliteStore).getMeta === 'function'
  );
}

export interface ComponentIOItem {
  name: string;
  type: 'dataset' | 'scalar' | 'any';
  description?: string;
  required?: boolean;
}

export interface ComponentConfigProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  title?: string;
  description?: string;
  default?: any;
  enum?: (string | number)[];
  enumNames?: string[];
  minimum?: number;
  maximum?: number;
  items?: any;
}

export interface ComponentConfigSchema {
  type: 'object';
  required?: string[];
  properties: Record<string, ComponentConfigProperty>;
}

export interface ComponentManifest {
  id: string;
  name: string;
  version?: string;
  category: 'data_input' | 'inline_calc' | 'group_agg' | 'result_output' | 'spatial' | 'python_script' | 'custom';
  categoryLabel?: string;
  engine: string;
  engineType: 'builtin' | 'libformula' | 'python' | 'aggregation' | 'http';
  iconName?: 'Database' | 'Calculator' | 'BarChart3' | 'Target' | 'Compass' | 'Code2' | 'Cpu' | 'Workflow';
  description: string;
  isBuiltin: boolean;
  isCustom?: boolean;
  author?: string;
  createdAt?: string;
  runtime?: {
    entrypoint?: string;
    scriptCode?: string;
    timeoutMs?: number;
  };
  io?: {
    inputs?: ComponentIOItem[];
    outputs?: ComponentIOItem[];
  };
  configSchema: ComponentConfigSchema;
}

export const BUILTIN_COMPONENTS: ComponentManifest[] = [
  {
    id: 'algo_table_input',
    name: '表输入 (数据抽取)',
    version: '1.0.0',
    category: 'data_input',
    categoryLabel: '数据输入',
    engine: 'CSV / 态势帧流式抽取器',
    engineType: 'builtin',
    iconName: 'Database',
    description: '提取仿真推演事件数据 (CSV/态势帧)，支持字段选择、行级过滤与时钟对齐，向下游算法提供规范 TableDataset。',
    isBuiltin: true,
    io: {
      inputs: [],
      outputs: [{ name: 'output_dataset', type: 'dataset', description: '初始抽取规范数据集' }],
    },
    configSchema: {
      type: 'object',
      required: ['csvTable'],
      properties: {
        sourceType: {
          type: 'string',
          title: '数据源类型',
          default: 'csv',
          enum: ['csv', 'bs_jsonl'],
          enumNames: ['CSV 事件表', '态势帧 (JSONL)'],
        },
        csvTable: {
          type: 'string',
          title: '关联底表 (CSV Table)',
          description: '从 44 类 F1 仿真规范事件表中选择输入表',
        },
        filterField: {
          type: 'string',
          title: '行级过滤字段',
          description: '可选：例如 UnitType 或 TargetSide',
        },
        filterEquals: {
          type: 'string',
          title: '过滤匹配值',
          description: '可选：与过滤字段精确匹配的值',
        },
      },
    },
  },
  {
    id: 'algo_lib_formula',
    name: '公式计算 (行内计算)',
    version: '1.0.0',
    category: 'inline_calc',
    categoryLabel: '行内计算',
    engine: 'LibFormula AST 递归下降语法树 (零 eval)',
    engineType: 'libformula',
    iconName: 'Calculator',
    description: '基于纯 AST 语法引擎，执行行内四则运算、函数嵌套 (数学/逻辑/文本/时间) 及多列衍生逻辑。',
    isBuiltin: true,
    io: {
      inputs: [{ name: 'input_dataset', type: 'dataset', required: true }],
      outputs: [{ name: 'output_dataset', type: 'dataset', description: '追加衍生列后的数据集' }],
    },
    configSchema: {
      type: 'object',
      properties: {
        derivedColumns: {
          type: 'array',
          title: '衍生计算列清单',
          description: '包含列名、LibFormula 公式表达式与数据类型',
        },
      },
    },
  },
  {
    id: 'algo_group_agg',
    name: '数据汇总 (跨行聚合)',
    version: '1.0.0',
    category: 'group_agg',
    categoryLabel: '跨行聚合',
    engine: 'Welford 流式多主键聚合器',
    engineType: 'aggregation',
    iconName: 'BarChart3',
    description: '按多分组主键聚合统计，支持求和(SUM)、均值(AVERAGE)、极值(MAX/MIN)、计数(COUNT)、方差(STDEV)等聚合规约。',
    isBuiltin: true,
    io: {
      inputs: [{ name: 'input_dataset', type: 'dataset', required: true }],
      outputs: [{ name: 'output_dataset', type: 'dataset', description: '聚合降维后的标量或分组数据集' }],
    },
    configSchema: {
      type: 'object',
      properties: {
        groupKeys: {
          type: 'array',
          title: '分组主键 (Group By Keys)',
          description: '例如 UnitID 或 MissionID，留空表示全表标量聚合',
        },
        aggregations: {
          type: 'array',
          title: '聚合指标项',
          description: '指定统计方法、源字段及输出指标字段名',
        },
      },
    },
  },
  {
    id: 'algo_spatial_geom',
    name: '空间几何算法',
    version: '1.0.0',
    category: 'spatial',
    categoryLabel: '空间几何',
    engine: 'Turf.js 空间几何分析引擎',
    engineType: 'builtin',
    iconName: 'Compass',
    description: '基于经纬度与高程进行空间任务走廊安全裕度、合围多边形穿透、凸包几何以及威胁距离计算。',
    isBuiltin: true,
    io: {
      inputs: [{ name: 'input_dataset', type: 'dataset', required: true }],
      outputs: [{ name: 'output_dataset', type: 'dataset', description: '包含空间遵从率与裕度的判定数据集' }],
    },
    configSchema: {
      type: 'object',
      required: ['spatialRule'],
      properties: {
        spatialRule: {
          type: 'string',
          title: '几何判定规则',
          default: 'corridor_check',
          enum: ['corridor_check', 'threat_distance', 'containment_polygon'],
          enumNames: ['任务走廊遵从判定', '威胁斜距与防空圈', '空域合围多边形穿透'],
        },
        minSafeMarginKm: {
          type: 'number',
          title: '安全裕度阈值 (km)',
          default: 5.0,
          minimum: 0.1,
          maximum: 200.0,
        },
      },
    },
  },
  {
    id: 'algo_python_script',
    name: 'Python 算法执行器',
    version: '1.0.0',
    category: 'python_script',
    categoryLabel: '脚本扩展',
    engine: 'Python 3.12 / NumPy / SciPy 桥接',
    engineType: 'python',
    iconName: 'Code2',
    description: '调用外部隔离 Python 脚本，支持气动模型、雷达探测包络拟合与复杂的运筹优化求解。',
    isBuiltin: true,
    io: {
      inputs: [{ name: 'input_dataset', type: 'dataset', required: true }],
      outputs: [{ name: 'output_dataset', type: 'dataset', description: 'Python 输出纯净 DataFrame' }],
    },
    configSchema: {
      type: 'object',
      required: ['pythonScriptCode'],
      properties: {
        pythonScriptCode: {
          type: 'string',
          title: 'Python 算法代码',
          description: '需实现 evaluate(context) 函数并返回包含 rows/columns 的字典',
        },
        timeoutMs: {
          type: 'number',
          title: '执行超时限制 (ms)',
          default: 5000,
          minimum: 500,
          maximum: 30000,
        },
      },
    },
  },
  {
    id: 'algo_result_output',
    name: '结果处理 (指标收口)',
    version: '1.0.0',
    category: 'result_output',
    categoryLabel: '结果输出',
    engine: '二库指标绑定与体系挂载适配器',
    engineType: 'builtin',
    iconName: 'Target',
    description: '结果处理与指标收口，将标量计算结果绑定至二库指标，并挂载到三库体系树。',
    isBuiltin: true,
    io: {
      inputs: [{ name: 'input_dataset', type: 'dataset', required: true }],
      outputs: [{ name: 'scalar_metric', type: 'scalar', description: '最终输出的评估度量值' }],
    },
    configSchema: {
      type: 'object',
      required: ['targetField'],
      properties: {
        targetField: {
          type: 'string',
          title: '收口指标字段名',
          description: '流水线最终作为指标输出的字段',
        },
        indicatorName: {
          type: 'string',
          title: '二库指标绑定名称',
        },
        optimalDirection: {
          type: 'string',
          title: '优劣极性方向',
          enum: ['higher_better', 'lower_better', 'nominal_best'],
          enumNames: ['越大越优 (Higher Better)', '越小越优 (Lower Better)', '区间适中 (Nominal Best)'],
        },
      },
    },
  },
];

export function validateComponentManifest(manifest: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['组件 Manifest 必须是合法的 JSON 对象'] };
  }

  if (!manifest.id || typeof manifest.id !== 'string') {
    errors.push('缺少组件唯一标识 id (必须是字符串)');
  } else if (!/^[a-zA-Z0-9_-]+$/.test(manifest.id)) {
    errors.push(`组件 id "${manifest.id}" 格式非法，只允许英文、数字、下划线与中划线`);
  }

  if (!manifest.name || typeof manifest.name !== 'string') {
    errors.push('缺少组件名称 name (必须是非空字符串)');
  }

  if (!manifest.description || typeof manifest.description !== 'string') {
    errors.push('缺少组件功能描述 description');
  }

  if (!manifest.configSchema || typeof manifest.configSchema !== 'object') {
    errors.push('缺少 configSchema 配置 Schema (必须是对象)');
  } else {
    if (manifest.configSchema.type !== 'object') {
      errors.push('configSchema.type 必须是 "object"');
    }
    if (!manifest.configSchema.properties || typeof manifest.configSchema.properties !== 'object') {
      errors.push('configSchema.properties 必须是属性对象字典');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export class ComponentRegistryStore {
  private readonly filePath: string;
  private sqliteStore?: EvalSqliteStore;
  private builtinItems: ComponentManifest[] = [];
  private customItems: Map<string, ComponentManifest> = new Map();

  constructor(filePathOrStore?: string | EvalSqliteStore, sqliteStore?: EvalSqliteStore) {
    if (isSqliteStoreLike(filePathOrStore)) {
      this.filePath = path.join(process.cwd(), 'data', 'custom-components.json');
      this.sqliteStore = filePathOrStore;
    } else {
      this.filePath = filePathOrStore || path.join(process.cwd(), 'data', 'custom-components.json');
      this.sqliteStore = sqliteStore;
    }
    this.load();
  }

  getSqliteStore(): EvalSqliteStore | undefined {
    return this.sqliteStore;
  }

  rebindSqliteStore(newStore: EvalSqliteStore): void {
    this.sqliteStore = newStore;
    this.load();
  }

  private loadFromSqlite(): void {
    if (!this.sqliteStore) return;
    const isBlank = this.sqliteStore.getMeta('is_blank') === '1';

    if (!isBlank && this.sqliteStore.countV4Components() === 0) {
      for (const comp of BUILTIN_COMPONENTS) {
        this.sqliteStore.upsertV4Component({ ...comp, isBuiltin: true, isCustom: false }, true);
      }
      if (this.filePath && fs.existsSync(this.filePath)) {
        try {
          const raw = fs.readFileSync(this.filePath, 'utf-8');
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            for (const item of list) {
              if (item && item.id && !BUILTIN_COMPONENTS.some((b) => b.id === item.id)) {
                this.sqliteStore.upsertV4Component(
                  { ...item, isCustom: true, isBuiltin: false },
                  false,
                );
              }
            }
          }
        } catch {
          // 容错降级
        }
      }
    }

    this.builtinItems = this.sqliteStore.listV4Components({ builtinOnly: true });
    this.customItems.clear();
    for (const item of this.sqliteStore.listV4Components({ customOnly: true })) {
      if (item?.id) {
        this.customItems.set(item.id, { ...item, isCustom: true, isBuiltin: false });
      }
    }
  }

  private load(): void {
    if (this.sqliteStore) {
      this.loadFromSqlite();
      return;
    }

    this.builtinItems = [...BUILTIN_COMPONENTS];
    this.customItems.clear();
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item && item.id) {
            this.customItems.set(item.id, { ...item, isCustom: true, isBuiltin: false });
          }
        }
      }
    } catch {
      // 容错降级
    }
  }

  private save(): void {
    if (this.sqliteStore) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Array.from(this.customItems.values());
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // 容错降级
    }
  }

  list(): ComponentManifest[] {
    const list: ComponentManifest[] = [...this.builtinItems];
    for (const custom of this.customItems.values()) {
      list.push(custom);
    }
    return list;
  }

  get(id: string): ComponentManifest | null {
    const builtin = this.builtinItems.find((c) => c.id === id);
    if (builtin) return builtin;
    return this.customItems.get(id) || null;
  }

  import(manifest: ComponentManifest): ComponentManifest {
    const val = validateComponentManifest(manifest);
    if (!val.valid) {
      throw new Error(`组件导入校验失败: ${val.errors.join('; ')}`);
    }

    if (this.builtinItems.some((c) => c.id === manifest.id)) {
      throw new Error(`禁止覆盖内置核心组件 "${manifest.id}"`);
    }

    const item: ComponentManifest = {
      ...manifest,
      isBuiltin: false,
      isCustom: true,
      createdAt: manifest.createdAt || new Date().toISOString(),
      engineType: manifest.engineType || 'python',
      category: manifest.category || 'custom',
    };

    this.customItems.set(item.id, item);
    if (this.sqliteStore) {
      this.sqliteStore.upsertV4Component(item, false);
    } else {
      this.save();
    }
    return item;
  }

  delete(id: string): boolean {
    if (this.builtinItems.some((c) => c.id === id)) {
      throw new Error(`内置核心组件 "${id}" 受系统级保护，禁止删除`);
    }
    const existed = this.customItems.delete(id);
    if (existed) {
      if (this.sqliteStore) {
        this.sqliteStore.deleteV4Component(id);
      } else {
        this.save();
      }
    }
    return existed;
  }
}

export const defaultComponentStore = new ComponentRegistryStore();
