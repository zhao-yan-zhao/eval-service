/**
 * Operators v3 SQLite 专用数据库构建器与数据引擎
 * 负责将全量 42 个算子、专属流水线蓝图与多维分析视图持久化至独立 SQLite 数据库
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OPERATORS_V3 } from './index.ts';
import { getOperatorPipelineBlueprint } from '../blueprints.ts';

export const DEFAULT_V3_DB_PATH = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'data',
  'operators-v3.db',
);

const PIPELINES_JSON_PATH = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'data',
  'operator-pipelines.json',
);

/** 为新增的 6 个原生扩展算子构造规范的 DAG 画布蓝图 */
function createDefaultPipelineForV3Ext(opMeta: (typeof OPERATORS_V3)[number]['meta']) {
  const opId = opMeta.id;
  const primaryTable = opMeta.f1FieldContract.csvTables[0] || 'GenericTable';
  const primaryCol = opMeta.f1FieldContract.csvColumns[0] || 'Value';
  const targetField = opId.split('.').pop() || 'result';
  const sanitizedId = opId.replace(/[^a-zA-Z0-9_]/g, '_');

  const inputNodeId = `node_in_${sanitizedId}`;
  const calcNodeId = `node_calc_${sanitizedId}`;
  const outNodeId = `node_out_${sanitizedId}`;

  const inputNode = {
    id: inputNodeId,
    type: 'data_input' as const,
    title: `全量输入: ${primaryTable}`,
    description: `规范化抽取 ${primaryTable} 事件流`,
    x: 80,
    y: 120,
    config: {
      sourceType: 'csv',
      csvTable: primaryTable.endsWith('.csv') ? primaryTable : `${primaryTable}.csv`,
      selectedColumns: opMeta.f1FieldContract.csvColumns,
    },
  };

  const isAgg = opMeta.pipelineCategory === 'group_agg';
  const processNode = isAgg
    ? {
        id: calcNodeId,
        type: 'group_agg' as const,
        title: `跨行聚合: ${opMeta.name}`,
        description: `按 Side 分组聚合统计 (${primaryCol})`,
        x: 480,
        y: 120,
        config: {
          groupKeys: ['Side'],
          aggregations: [
            {
              sourceField: primaryCol,
              method: 'AVERAGE',
              outputField: targetField,
            },
          ],
        },
      }
    : {
        id: calcNodeId,
        type: 'inline_calc' as const,
        title: `行内计算: ${opMeta.name}`,
        description: `CLAMP(${primaryCol}, 0, 999999)`,
        x: 480,
        y: 120,
        config: {
          derivedColumns: [
            {
              name: targetField,
              expression: `CLAMP(${primaryCol}, 0, 999999)`,
              outputType: 'numeric',
            },
          ],
        },
      };

  const outputNode = {
    id: outNodeId,
    type: 'result_output' as const,
    title: `指标输出: ${opMeta.name}`,
    description: `输出 ${opMeta.name} (${opMeta.unit})`,
    x: 900,
    y: 120,
    config: {
      targetField,
      indicatorName: opMeta.name,
      indicatorUnit: opMeta.unit,
      optimalDirection: opMeta.defaultOptimalDirection,
    },
  };

  const edges = [
    {
      id: `e1_${sanitizedId}`,
      sourceNodeId: inputNodeId,
      targetNodeId: calcNodeId,
      label: '中立数据流',
    },
    {
      id: `e2_${sanitizedId}`,
      sourceNodeId: calcNodeId,
      targetNodeId: outNodeId,
      label: '度量收口',
    },
  ];

  return {
    operatorId: opId,
    pipelineTitle: `${opMeta.name} 专属流水线`,
    nodes: [inputNode, processNode, outputNode],
    edges,
    dataset: {
      rows: [
        { [primaryCol]: 10.5, TargetID: 'T-001', Side: '红方' },
        { [primaryCol]: 12.0, TargetID: 'T-002', Side: '红方' },
      ],
    },
  };
}

/**
 * 往指定 SQLite 数据库写入/更新全量 42 个算子、流水线与多维视图
 */
export function seedV3OperatorsToDb(db: DatabaseSync): {
  insertedOperators: number;
  insertedPipelines: number;
} {
  const now = new Date().toISOString();

  // 1. 初始化核心表结构
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS operator_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      mode TEXT NOT NULL,
      is_builtin INTEGER NOT NULL DEFAULT 1,
      pipeline_category TEXT,
      output_type TEXT NOT NULL,
      unit TEXT NOT NULL,
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_v3_operators_builtin ON operator_definitions (is_builtin);
    CREATE INDEX IF NOT EXISTS idx_v3_operators_category ON operator_definitions (category);

    CREATE TABLE IF NOT EXISTS operator_pipelines (
      operator_id TEXT PRIMARY KEY,
      pipeline_title TEXT NOT NULL,
      nodes_json TEXT NOT NULL,
      edges_json TEXT NOT NULL,
      dataset_json TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- 结构化多维全景视图：无需展开 JSON 直接多字段高维过滤
    DROP VIEW IF EXISTS v_operator_catalog;
    CREATE VIEW v_operator_catalog AS
    SELECT
      id,
      name,
      category,
      json_extract(data_json, '$.domain') AS domain,
      json_extract(data_json, '$.evalRole') AS eval_role,
      output_type,
      unit,
      mode,
      pipeline_category,
      json_extract(data_json, '$.defaultOptimalDirection') AS optimal_direction,
      json_extract(data_json, '$.doctrineRef') AS doctrine_ref,
      json_extract(data_json, '$.description') AS description,
      json_extract(data_json, '$.f1FieldContract.csvTables') AS required_tables,
      json_extract(data_json, '$.f1FieldContract.csvColumns') AS required_columns,
      is_builtin,
      updated_at
    FROM operator_definitions;

    -- 物理域汇总视图
    DROP VIEW IF EXISTS v_domain_summary;
    CREATE VIEW v_domain_summary AS
    SELECT
      json_extract(data_json, '$.domain') AS domain,
      json_extract(data_json, '$.evalRole') AS eval_role,
      COUNT(*) AS operator_count
    FROM operator_definitions
    GROUP BY 1, 2
    ORDER BY 1, 2;
  `);

  // 2. 批量写入 42 个算子元数据
  const insertOpStmt = db.prepare(`
    INSERT OR REPLACE INTO operator_definitions (
      id, name, category, mode, is_builtin, pipeline_category, output_type, unit, data_json, updated_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
  `);

  for (const op of OPERATORS_V3) {
    insertOpStmt.run(
      op.meta.id,
      op.meta.name,
      op.meta.category,
      op.meta.mode ?? 'formula_pipeline',
      op.meta.pipelineCategory ?? null,
      op.meta.outputType,
      op.meta.unit ?? '',
      JSON.stringify(op.meta),
      now,
    );
  }

  // 3. 读取并写入流水线蓝图
  let basePipelines: Record<string, any> = {};
  if (fs.existsSync(PIPELINES_JSON_PATH)) {
    try {
      basePipelines = JSON.parse(fs.readFileSync(PIPELINES_JSON_PATH, 'utf-8'));
    } catch {
      basePipelines = {};
    }
  }

  const insertPipeStmt = db.prepare(`
    INSERT OR REPLACE INTO operator_pipelines (
      operator_id, pipeline_title, nodes_json, edges_json, dataset_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  let pipelineCount = 0;
  for (const op of OPERATORS_V3) {
    const opId = op.meta.id;
    let pipe = basePipelines[opId];
    if (!pipe) {
      const bp = getOperatorPipelineBlueprint(opId, op.meta.name);
      if (bp && bp.nodes && bp.nodes.length > 0) {
        pipe = {
          operatorId: opId,
          pipelineTitle: bp.name ? `${bp.name} 专属流水线` : `${op.meta.name} 专属流水线`,
          nodes: bp.nodes,
          edges: bp.edges,
          dataset: bp.defaultDataset,
          updatedAt: now,
        };
      } else {
        pipe = createDefaultPipelineForV3Ext(op.meta);
      }
    }

    insertPipeStmt.run(
      opId,
      pipe.pipelineTitle || `${op.meta.name} 专属流水线`,
      JSON.stringify(pipe.nodes || []),
      JSON.stringify(pipe.edges || []),
      pipe.dataset ? JSON.stringify(pipe.dataset) : null,
      pipe.updatedAt || now,
    );
    pipelineCount += 1;
  }

  // 4. 写入元数据标签
  const setMetaStmt = db.prepare('INSERT OR REPLACE INTO store_meta (key, value) VALUES (?, ?)');
  setMetaStmt.run('db_type', 'operator');
  setMetaStmt.run('catalog_version', '3.0.0');
  setMetaStmt.run('operator_count', String(OPERATORS_V3.length));
  setMetaStmt.run('pipeline_count', String(pipelineCount));
  setMetaStmt.run('generated_at', now);
  setMetaStmt.run('is_initialized', '1');

  return {
    insertedOperators: OPERATORS_V3.length,
    insertedPipelines: pipelineCount,
  };
}

/**
 * 构建独立的 Operators v3 SQLite 数据库文件（默认位于 eval-service/data/operators-v3.db）
 */
export function buildV3OperatorDatabase(targetPath = DEFAULT_V3_DB_PATH): {
  dbPath: string;
  operatorCount: number;
  pipelineCount: number;
} {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  // 如果目标存在旧库，关闭并覆盖
  const db = new DatabaseSync(targetPath);
  try {
    const stats = seedV3OperatorsToDb(db);
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {
      // checkpoint fail-safe
    }
    return {
      dbPath: targetPath,
      operatorCount: stats.insertedOperators,
      pipelineCount: stats.insertedPipelines,
    };
  } finally {
    db.close();
  }
}

// 允许通过命令行直接执行: npx tsx eval-service/src/operators/v3/db.ts
if (process.argv[1] && process.argv[1].endsWith('db.ts')) {
  const result = buildV3OperatorDatabase();
  console.log(`[Operators-V3-DB] 成功构建 42 算子 SQLite 数据库:`);
  console.log(`- 路径: ${result.dbPath}`);
  console.log(`- 算子总数: ${result.operatorCount}`);
  console.log(`- 流水线总数: ${result.pipelineCount}`);
}
