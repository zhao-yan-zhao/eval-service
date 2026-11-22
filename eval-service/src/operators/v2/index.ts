/**
 * Operators v2 全量算子汇总入口（共 41 个实证算子）
 * 包含：1 项空间走廊算法 (roe.corridor_spatial_compliance) + 40 项全要素实证算法算子
 */

import type { OperatorSpec } from '../helpers.ts';
import { ROE_AND_COST_OPERATORS } from './roe-cost.ts';
import { NEW_OPERATORS } from './new-operators.ts';

export const OPERATORS_V2: OperatorSpec[] = [
  ...ROE_AND_COST_OPERATORS,
  ...NEW_OPERATORS,
];

export const LEGACY_OPERATOR_ID_MAP: Record<
  string,
  { action: 'replaced' | 'split' | 'deprecated'; replacements: string[]; reason: string }
> = {};

export function getLegacyOperatorMigrationHint(atomId: string) {
  return LEGACY_OPERATOR_ID_MAP[atomId];
}
