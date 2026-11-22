import type { CanvasEdge, CanvasNode } from './canvas-types.ts';
import { findCatalogTable } from './schema-catalog.ts';

export interface DownstreamConsumerInfo {
  nodeId: string;
  nodeTitle: string;
  nodeType: string;
  reason: string;
}

export interface InputPortUsage {
  name: string;
  sourceNodeId?: string;
  sourceNodeTitle?: string;
  isConsumedByThisNode: boolean;
  usageReason: string;
}

export interface OutputPortUsage {
  name: string;
  isDerived: boolean;
  isConsumedDownstream: boolean;
  consumers: DownstreamConsumerInfo[];
}

export interface NodeLineageReport {
  inputPorts: InputPortUsage[];
  outputPorts: OutputPortUsage[];
  consumedInputCount: number;
  totalInputCount: number;
  consumedOutputCount: number;
  totalOutputCount: number;
  downstreamBranchesCount: number;
}

/**
 * 提取某个节点自身核心算法实际消费（直接依赖）的字段名列表
 */
export function getNodeConsumedInputFields(
  node: CanvasNode,
  availableColumns: string[] = []
): { fieldName: string; reason: string }[] {
  const result: { fieldName: string; reason: string }[] = [];
  const added = new Set<string>();

  const addField = (name?: string, reason = '计算消费') => {
    if (name && !added.has(name)) {
      added.add(name);
      result.push({ fieldName: name, reason });
    }
  };

  const cfg = node.config || {};

  switch (node.type) {
    case 'data_input':
      // 表输入节点从底表读取，不消费上游节点字段
      break;

    case 'inline_calc':
      // 从所有公式表达式中提取被引用的字段
      if (Array.isArray(cfg.derivedColumns)) {
        for (const col of cfg.derivedColumns) {
          const expr = col.expression || '';
          // 匹配 [FieldName] 或 单词名
          const bracketMatches = expr.match(/\[([^\]]+)\]/g);
          if (bracketMatches) {
            for (const bm of bracketMatches) {
              const fname = bm.slice(1, -1).trim();
              addField(fname, `公式 [${col.name}] 引用`);
            }
          }
          // 同时匹配已存在的上游字段名
          for (const avail of availableColumns) {
            if (avail && expr.includes(avail)) {
              addField(avail, `公式 [${col.name}] 变量`);
            }
          }
        }
      }
      break;

    case 'spatial':
      // 空间几何求解器依赖的坐标、高度、时空实体键
      addField(cfg.lonField || 'UnitLongitude', '实体经度输入');
      addField(cfg.latField || 'UnitLatitude', '实体纬度输入');
      addField(cfg.altField || 'UnitAltitude_m', '实体高度输入');
      addField(cfg.unitIdField || 'UnitID', '作战单元唯一键');
      addField(cfg.missionIdField || 'MissionID', '任务规划唯一键');
      addField(cfg.geomLonField || 'Longitude', '走廊几何参考经度');
      addField(cfg.geomLatField || 'Latitude', '走廊几何参考纬度');
      addField(cfg.geomGroupField || 'MissionID', '走廊分组外键');
      addField(cfg.geomOrderField || 'PointIndex', '参考点顺序序号');
      break;

    case 'group_agg':
      // 分组聚合算子消费 groupBy/groupKeys 键与聚合 sourceField/sourceColumn
      const groupKeys = cfg.groupKeys || cfg.groupBy || [];
      if (Array.isArray(groupKeys)) {
        for (const g of groupKeys) {
          addField(g, 'GroupBy 主键聚合');
        }
      }
      const aggItems = cfg.aggregations || cfg.metrics || [];
      if (Array.isArray(aggItems)) {
        for (const agg of aggItems) {
          const src = agg.sourceField || agg.sourceColumn;
          if (src) {
            addField(src, `${agg.method || '聚合'} 统计源列`);
          }
        }
      }
      break;

    case 'result_output':
      // 结果输出算子消费目标指标字段
      addField(cfg.targetField, '挂载评估指标值');
      if (cfg.metricConfig?.targetField) {
        addField(cfg.metricConfig.targetField, '三库指标目标列');
      }
      break;

    case 'python_script':
      // Python 脚本中引用的字段
      if (cfg.pythonScriptCode) {
        for (const avail of availableColumns) {
          if (avail && cfg.pythonScriptCode.includes(avail)) {
            addField(avail, 'Python 脚本引用');
          }
        }
      }
      break;
  }

  return result;
}

/**
 * 推导某个节点对外输出的完整字段列表
 */
export function getNodeOutputColumns(
  node: CanvasNode,
  upstreamCols: string[] = []
): { name: string; isDerived: boolean }[] {
  const result: { name: string; isDerived: boolean }[] = [];
  const added = new Set<string>();

  const addCol = (name: string, isDerived: boolean) => {
    if (name && !added.has(name)) {
      added.add(name);
      result.push({ name, isDerived });
    }
  };

  // 1. 若当前节点已经具有明确产出数据集 (静态蓝图预设或最新执行结果)
  const runtimeCols = node.runtime?.outputDataset?.schema
    || (node.runtime?.outputDataset as any)?.columns;
  if (Array.isArray(runtimeCols) && runtimeCols.length > 0) {
    if (node.type === 'spatial') {
      // 空间几何算子：严格过滤出空间求解器产出列，杜绝上游 raw 事件底表列污染
      const spatialValidNames = new Set([
        'MissionID', 'MissionName', 'UnitID', 'UnitName', 'ActiveDuration_s',
        'InCorridorDuration_s', 'UnitComplianceRate', 'MinMargin_km', 'ComplianceStatus',
        node.config?.outputContainmentCol || 'in_corridor',
        node.config?.outputMarginCol || 'min_margin_km',
      ]);
      const filtered = runtimeCols.filter((c) => spatialValidNames.has(c.name));
      if (filtered.length > 0) {
        for (const c of filtered) {
          addCol(c.name, c.isDerived ?? false);
        }
        return result;
      }
    } else if (node.type === 'group_agg') {
      // 聚合算子：严格仅输出分组键与聚合度量产出列，杜绝底表列泄露
      const gKeys = new Set(node.config?.groupKeys || node.config?.groupBy || []);
      const aggKeys = new Set(
        (node.config?.aggregations || node.config?.metrics || [])
          .map((a: any) => a.outputField || a.targetField)
          .filter(Boolean)
      );
      const filtered = runtimeCols.filter((c) => gKeys.has(c.name) || aggKeys.has(c.name));
      if (filtered.length > 0) {
        for (const c of filtered) {
          addCol(c.name, c.isDerived ?? false);
        }
        return result;
      }
    } else {
      for (const c of runtimeCols) {
        addCol(c.name, c.isDerived ?? false);
      }
      return result;
    }
  }

  const cfg = node.config || {};

  switch (node.type) {
    case 'data_input': {
      if (Array.isArray(cfg.selectedColumns) && cfg.selectedColumns.length > 0) {
        for (const c of cfg.selectedColumns) {
          addCol(c, false);
        }
      } else if (cfg.csvTable) {
        const spec = findCatalogTable(cfg.csvTable);
        if (spec && Array.isArray(spec.fields)) {
          for (const f of spec.fields) {
            addCol(f.name, false);
          }
        }
      }
      break;
    }

    case 'inline_calc': {
      // 纯净输出：仅输出本节点公式计算产出的衍生列
      if (Array.isArray(cfg.derivedColumns)) {
        for (const d of cfg.derivedColumns) {
          const colName = d.columnName || d.name;
          if (colName) {
            addCol(colName, true);
          }
        }
      }
      break;
    }

    case 'spatial': {
      // 空间几何求解器核心业务判定与遵从率产出字段
      addCol('MissionID', false);
      addCol('MissionName', false);
      addCol('UnitID', false);
      addCol('UnitName', false);
      addCol('ActiveDuration_s', true);
      addCol('InCorridorDuration_s', true);
      addCol('UnitComplianceRate', true);
      addCol('MinMargin_km', true);
      addCol('ComplianceStatus', true);
      addCol(cfg.outputContainmentCol || 'in_corridor', true);
      addCol(cfg.outputMarginCol || 'min_margin_km', true);
      break;
    }

    case 'group_agg': {
      // 仅输出本节点定义的分组键与聚合统计度量字段
      const gKeys = cfg.groupKeys || cfg.groupBy || [];
      if (Array.isArray(gKeys)) {
        for (const g of gKeys) {
          addCol(g, false);
        }
      }
      const aggs = cfg.aggregations || cfg.metrics || [];
      if (Array.isArray(aggs)) {
        for (const agg of aggs) {
          const outName = agg.targetField || agg.outputField;
          if (outName) {
            addCol(outName, true);
          }
        }
      }
      break;
    }

    case 'python_script': {
      if (Array.isArray(cfg.outputColumns) && cfg.outputColumns.length > 0) {
        for (const col of cfg.outputColumns) {
          if (typeof col === 'string' && col.trim()) {
            addCol(col.trim(), true);
          } else if (col && typeof col.name === 'string' && col.name.trim()) {
            addCol(col.name.trim(), true);
          }
        }
      } else if (cfg.outputScoreField) {
        addCol(cfg.outputScoreField, true);
      } else {
        addCol('py_result', true);
      }
      break;
    }

    case 'result_output': {
      if (cfg.targetField) {
        addCol(cfg.targetField, false);
      }
      addCol('metric_score', true);
      addCol('metric_grade', true);
      break;
    }
  }

  return result;
}

/**
 * 全自动 DAG 依赖追踪与双向消费诊断
 */
export function analyzeNodeLineage(
  currentNode: CanvasNode,
  allNodes: CanvasNode[],
  allEdges: CanvasEdge[],
  upstreamCols: string[] = []
): NodeLineageReport {
  // 1. 查找所有直接上游节点与连入
  const inEdges = allEdges.filter((e) => e.targetNodeId === currentNode.id);
  const incomingNodes = inEdges
    .map((e) => allNodes.find((n) => n.id === e.sourceNodeId))
    .filter(Boolean) as CanvasNode[];

  // 2. 分析当前节点自身的输入契约及本节点消费情况
  const thisNodeConsumed = getNodeConsumedInputFields(currentNode, upstreamCols);
  const thisConsumedMap = new Map<string, string>();
  for (const item of thisNodeConsumed) {
    thisConsumedMap.set(item.fieldName, item.reason);
  }

  const inputPorts: InputPortUsage[] = [];
  const processedInFields = new Set<string>();

  for (const inCol of upstreamCols) {
    if (processedInFields.has(inCol)) continue;
    processedInFields.add(inCol);

    // 寻找来源节点
    let srcTitle: string | undefined;
    let srcId: string | undefined;
    for (const inNode of incomingNodes) {
      const nodeOuts = getNodeOutputColumns(inNode, []);
      if (nodeOuts.some((o) => o.name === inCol)) {
        srcTitle = inNode.title;
        srcId = inNode.id;
        break;
      }
    }

    const isConsumed = thisConsumedMap.has(inCol);
    inputPorts.push({
      name: inCol,
      sourceNodeId: srcId,
      sourceNodeTitle: srcTitle,
      isConsumedByThisNode: isConsumed,
      usageReason: isConsumed
        ? thisConsumedMap.get(inCol)!
        : '上游输入字段 (待消费/可选)',
    });
  }

  // 3. 计算当前节点的输出契约
  const outputDefs = getNodeOutputColumns(currentNode, upstreamCols);

  // 4. 查找所有直接下游节点 (多分支支持)
  const outEdges = allEdges.filter((e) => e.sourceNodeId === currentNode.id);
  const downstreamNodes = outEdges
    .map((e) => allNodes.find((n) => n.id === e.targetNodeId))
    .filter(Boolean) as CanvasNode[];

  const outputPorts: OutputPortUsage[] = [];

  for (const outCol of outputDefs) {
    const consumers: DownstreamConsumerInfo[] = [];

    for (const downNode of downstreamNodes) {
      // 提取下游节点在当前输入中实际消费的字段
      const downConsumed = getNodeConsumedInputFields(
        downNode,
        outputDefs.map((o) => o.name)
      );
      const match = downConsumed.find((c) => c.fieldName === outCol.name);
      if (match) {
        consumers.push({
          nodeId: downNode.id,
          nodeTitle: downNode.title,
          nodeType: downNode.type,
          reason: match.reason,
        });
      }
    }

    outputPorts.push({
      name: outCol.name,
      isDerived: outCol.isDerived,
      isConsumedDownstream: consumers.length > 0,
      consumers,
    });
  }

  const consumedInputCount = inputPorts.filter((p) => p.isConsumedByThisNode).length;
  const consumedOutputCount = outputPorts.filter((p) => p.isConsumedDownstream).length;

  return {
    inputPorts,
    outputPorts,
    consumedInputCount,
    totalInputCount: inputPorts.length,
    consumedOutputCount,
    totalOutputCount: outputPorts.length,
    downstreamBranchesCount: downstreamNodes.length,
  };
}
