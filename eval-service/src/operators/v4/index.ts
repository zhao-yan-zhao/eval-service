/**
 * F1 V4 一库实证算子总注册表与执行入口（共 42 项实证算子，覆盖 第 1~8 章）
 */

import type { OperatorNodeExecutionResult } from '../../core/types.ts';
import type {
  V4OperatorEngineKind,
  V4OperatorLayer,
  V4OperatorScriptSpec,
} from './types.ts';
import { V4_OPERATORS_PART1 } from './scripts-part1.ts';
import { V4_OPERATORS_PART2 } from './scripts-part2.ts';
import { V4_OPERATORS_PART3 } from './scripts-part3.ts';
import {
  V4OperatorRunner,
  type V4OperatorRunContext,
  type V4OperatorSpecLike,
  runV4Operator,
  runV4OperatorDag,
} from './v4-operator-runner.ts';

export type {
  V4OperatorEngineKind,
  V4OperatorLayer,
  V4OperatorScriptSpec,
  V4OperatorSpecLike,
  V4OperatorRunContext,
};
export { V4OperatorRunner, runV4Operator, runV4OperatorDag };

export const ALL_V4_OPERATOR_SCRIPTS: V4OperatorScriptSpec[] = [
  ...V4_OPERATORS_PART1,
  ...(V4_OPERATORS_PART2 as unknown as V4OperatorScriptSpec[]),
  ...V4_OPERATORS_PART3,
];

export const V4_FACT_OPERATORS: V4OperatorScriptSpec[] = ALL_V4_OPERATOR_SCRIPTS.filter(
  (spec) => (spec.layer ?? 'fact') === 'fact',
);

export interface V4BuiltinComponentSpec {
  id: string;
  name: string;
  description: string;
  engineKind: V4OperatorEngineKind;
  category: V4OperatorScriptSpec['category'];
}

export const V4_BUILTIN_COMPONENTS: V4BuiltinComponentSpec[] = [
  {
    id: 'builtin.data_input',
    name: '数据输入 (Data Input)',
    description:
      '读取 F1 仿真导出的原始 CSV 事件底表，自动剥离双 UTF-8 BOM 并推断字段类型输出 TableDataset。',
    engineKind: 'data_input',
    category: 'situation',
  },
  {
    id: 'builtin.inline_calc',
    name: '行内公式衍生 (LibFormula)',
    description:
      '基于纯 AST 递归下降公式引擎 (IF/MAX/MIN/ROUND/COALESCE) 对上游 TableDataset 执行零 eval 行级衍生列计算。',
    engineKind: 'inline_calc',
    category: 'effectiveness',
  },
  {
    id: 'builtin.group_agg',
    name: '跨行分组聚合 (GroupBy)',
    description:
      '按指定维度列 (groupKeys) 对上游 TableDataset 进行多维分组归约 (SUM/AVERAGE/COUNT/MAX/MIN)，遵循纯净输出原则。',
    engineKind: 'group_agg',
    category: 'effectiveness',
  },
  {
    id: 'builtin.spatial',
    name: '空间几何判定 (Spatial)',
    description:
      '对航迹点与任务多边形/航线走廊执行空间包含与边距合规判定，输出标准空间几何判定数据集。',
    engineKind: 'spatial',
    category: 'compliance',
  },
  {
    id: 'builtin.python_script',
    name: '自定义 Python 算子 (Python Sandbox)',
    description:
      '在 AST 安全沙箱常驻 Python Worker 进程中运行自定义 pandas/numpy 科学计算脚本产出 TableDataset。',
    engineKind: 'python_script',
    category: 'effectiveness',
  },
];

export function listV4BuiltinComponents(): V4BuiltinComponentSpec[] {
  return V4_BUILTIN_COMPONENTS.map((c) => ({ ...c }));
}

export const V4_OPERATOR_SPEC_MAP = new Map<string, V4OperatorScriptSpec>(
  ALL_V4_OPERATOR_SCRIPTS.map((spec) => [spec.id, spec]),
);

export function getV4OperatorSpec(operatorId: string): V4OperatorScriptSpec | undefined {
  return V4_OPERATOR_SPEC_MAP.get(operatorId);
}

export interface V4OperatorSummary {
  id: string;
  name: string;
  chapter: number;
  category: V4OperatorScriptSpec['category'];
  militaryLevel: V4OperatorScriptSpec['militaryLevel'];
  domainTag: V4OperatorScriptSpec['domainTag'];
  description: string;
  layer: V4OperatorLayer;
  engineKind: V4OperatorEngineKind;
  requiredTables: string[];
  optionalTables: string[];
  upstreamOperatorId?: string;
  parameterPorts: V4OperatorScriptSpec['parameterPorts'];
  outputColumns: Array<{ name: string; type?: string; description?: string }>;
  outputColumnNames: string[];
  pythonCode: string;
}

export function listV4OperatorSummaries(options?: {
  layer?: 'fact' | 'all';
}): V4OperatorSummary[] {
  const sourceList =
    options?.layer === 'fact' ? V4_FACT_OPERATORS : ALL_V4_OPERATOR_SCRIPTS;
  return sourceList.map((spec) => ({
    id: spec.id,
    name: spec.name,
    chapter: spec.chapter,
    category: spec.category,
    militaryLevel: spec.militaryLevel,
    domainTag: spec.domainTag,
    description: spec.description,
    layer: spec.layer ?? 'fact',
    engineKind: spec.engineKind ?? 'python_script',
    requiredTables: spec.requiredTables,
    optionalTables: spec.optionalTables ?? [],
    ...(spec.upstreamOperatorId ? { upstreamOperatorId: spec.upstreamOperatorId } : {}),
    parameterPorts: spec.parameterPorts,
    outputColumns: spec.outputColumns.map((colName) => ({
      name: colName,
      type: 'string',
    })),
    outputColumnNames: [...spec.outputColumns],
    pythonCode: spec.pythonCode,
  }));
}

let sharedRunner: V4OperatorRunner | null = null;

export function getDefaultV4OperatorRunner(): V4OperatorRunner {
  if (!sharedRunner) {
    sharedRunner = new V4OperatorRunner(ALL_V4_OPERATOR_SCRIPTS);
  }
  return sharedRunner;
}

export async function runV4OperatorById(
  operatorId: string,
  ctx: V4OperatorRunContext,
): Promise<OperatorNodeExecutionResult> {
  return getDefaultV4OperatorRunner().runOperator(operatorId, ctx);
}

export async function runV4OperatorDagByIds(
  targetIds: string[],
  ctx: V4OperatorRunContext,
) {
  return getDefaultV4OperatorRunner().runDag(targetIds, ctx);
}

export async function disposeV4OperatorPool(): Promise<void> {
  if (sharedRunner) {
    const r = sharedRunner;
    sharedRunner = null;
    await r.dispose();
  }
}
