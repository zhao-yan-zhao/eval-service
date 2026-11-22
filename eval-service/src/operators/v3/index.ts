/**
 * Operators v3 全量算子汇总入口（共 42 个原子算子，覆盖 6 大能力域与 8 大事件表域）
 * 严格对齐 F1-Operators-v3 精细化设计规范
 */

import type { OperatorSpec } from '../helpers.ts';
import type { MetricAtomMeta } from '../../core/types.ts';
import { KILL_CHAIN_OPERATORS_V3 } from './kill-chain.ts';
import { MOE_OPERATORS_V3 } from './moe.ts';
import { ROE_AND_COST_OPERATORS_V3 } from './roe-cost.ts';
import { SUITABILITY_OPERATORS_V3 } from './suitability.ts';
import { SURVIVABILITY_OPERATORS_V3 } from './survivability.ts';
import { WEAPON_OPERATORS_V3 } from './weapon.ts';

export const OPERATORS_V3: OperatorSpec[] = [
  ...MOE_OPERATORS_V3,
  ...KILL_CHAIN_OPERATORS_V3,
  ...WEAPON_OPERATORS_V3,
  ...SURVIVABILITY_OPERATORS_V3,
  ...SUITABILITY_OPERATORS_V3,
  ...ROE_AND_COST_OPERATORS_V3,
];

export const OPERATOR_V3_MAP = new Map<string, OperatorSpec>(
  OPERATORS_V3.map((op) => [op.meta.id, op]),
);

export function listV3OperatorMetas(): MetricAtomMeta[] {
  return OPERATORS_V3.map((op) => op.meta);
}

export function exportV3Catalog(): {
  version: string;
  totalCount: number;
  generatedAt: string;
  operators: MetricAtomMeta[];
} {
  return {
    version: '3.0.0',
    totalCount: OPERATORS_V3.length,
    generatedAt: new Date().toISOString(),
    operators: listV3OperatorMetas(),
  };
}

export {
  DEFAULT_V3_DB_PATH,
  buildV3OperatorDatabase,
  seedV3OperatorsToDb,
} from './db.ts';
