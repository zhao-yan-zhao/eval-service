import type {
  MetricDomainTag,
  MetricMilitaryLevel,
  OperatorCategory,
  ParameterPortSpec,
} from '../../core/types.ts';

export type {
  MetricDomainTag,
  MetricMilitaryLevel,
  OperatorCategory,
  ParameterPortSpec,
};

export type V4OperatorLayer = 'fact' | 'legacy_aggregate';

export type V4OperatorEngineKind =
  | 'python_script'
  | 'data_input'
  | 'inline_calc'
  | 'group_agg'
  | 'spatial';

/**
 * F1 V4 算子脚本契约定义（一库 TableDataset 进 -> TableDataset 出）
 */
export interface V4OperatorScriptSpec {
  id: string;
  name: string;
  chapter: number;
  category: OperatorCategory;
  militaryLevel: MetricMilitaryLevel;
  domainTag: MetricDomainTag;
  description: string;
  layer?: V4OperatorLayer;
  engineKind?: V4OperatorEngineKind;
  requiredTables: string[];
  optionalTables?: string[];
  upstreamOperatorId?: string;
  tableColumns?: Record<string, string[]>;
  parameterPorts: ParameterPortSpec[];
  outputColumns: string[];
  pythonCode: string;
}
