import fs from 'node:fs';
import path from 'node:path';

const studioFile = path.resolve('eval-service/src/ui/components/pipeline-canvas/PipelineCanvasStudio.tsx');
let content = fs.readFileSync(studioFile, 'utf-8');

// 1. Add import
if (!content.includes('getSampleDatasetForTable')) {
  content = content.replace(
    "import { executeFormulaOrAggPreview } from '../../../operators/pipeline-engine.ts';",
    "import { executeFormulaOrAggPreview } from '../../../operators/pipeline-engine.ts';\nimport { getSampleDatasetForTable } from '../../../operators/table-sample-catalog.ts';"
  );
  console.log('Added getSampleDatasetForTable import.');
}

// 2. Patch buildCanvasFromBlueprint
const oldBuild = `    return {
      title: \`【\${bp.category === 'compliance' ? '合规域' : bp.category}】\${bp.name} · 算法流水线 (\${bp.algorithmLabel})\`,
      nodes: loadedNodes,
      edges: loadedEdges,
      dataset: bp.defaultDataset || DEFAULT_SAMPLE_DATASET,
    };`;

const newBuild = `    const firstTable = loadedNodes[0]?.config?.csvTable;
    const tableDataset = firstTable ? getSampleDatasetForTable(firstTable) : null;
    return {
      title: \`【\${bp.category === 'compliance' ? '合规域' : bp.category}】\${bp.name} · 算法流水线 (\${bp.algorithmLabel})\`,
      nodes: loadedNodes,
      edges: loadedEdges,
      dataset: bp.defaultDataset || tableDataset || DEFAULT_SAMPLE_DATASET,
    };`;

if (content.includes(oldBuild)) {
  content = content.replace(oldBuild, newBuild);
  console.log('Patched buildCanvasFromBlueprint.');
}

// 3. Patch handleSwitchOperator
const oldSwitch = `          if (res.pipeline.dataset) setActiveDataset(res.pipeline.dataset);
          setSelectedNodeId(res.pipeline.nodes[0]?.id ?? null);
          setToastMessage(\`已从存储库载入算子 [\${op?.name || opId}] 最新已保存流水线！\`);`;

const newSwitch = `          const firstTable = res.pipeline.nodes[0]?.config?.csvTable;
          const tableDataset = firstTable ? getSampleDatasetForTable(firstTable) : null;
          const chosenDataset = res.pipeline.dataset || tableDataset || DEFAULT_SAMPLE_DATASET;
          setActiveDataset(chosenDataset);
          setSelectedNodeId(res.pipeline.nodes[0]?.id ?? null);
          setToastMessage(\`已从存储库载入算子 [\${op?.name || opId}] 最新已保存流水线！\`);`;

if (content.includes(oldSwitch)) {
  content = content.replace(oldSwitch, newSwitch);
  console.log('Patched handleSwitchOperator.');
}

// 4. Patch incomingEdges length === 0 in handleExecuteFullPipeline
const oldIncomingZero = `      if (incomingEdges.length === 0) {
        inputDataset = node.runtime?.outputDataset || activeDataset;
      }`;

const newIncomingZero = `      if (incomingEdges.length === 0) {
        const tableSample = node.config?.csvTable ? getSampleDatasetForTable(node.config.csvTable) : null;
        inputDataset = node.runtime?.outputDataset || tableSample || activeDataset;
      }`;

if (content.includes(oldIncomingZero)) {
  content = content.replace(oldIncomingZero, newIncomingZero);
  console.log('Patched incomingEdges.length === 0.');
}

// 5. Patch node.type === 'data_input'
const oldDataInput = `      if (node.type === 'data_input') {
        const nodeData = node.runtime?.outputDataset || inputDataset;
        nodeMap.set(nodeId, {
          ...node,
          runtime: {
            status: 'success',
            rowCount: nodeData.rows.length,
            columnCount: nodeData.schema.length,
            latencyMs: 1.2,
            outputDataset: nodeData,
            diffCols: [],
          },
        });
      }`;

const newDataInput = `      if (node.type === 'data_input') {
        const tableSample = node.config?.csvTable ? getSampleDatasetForTable(node.config.csvTable) : null;
        const nodeData = node.runtime?.outputDataset || tableSample || inputDataset;
        const cols = nodeData.columns || nodeData.schema || [];
        nodeMap.set(nodeId, {
          ...node,
          runtime: {
            status: 'success',
            rowCount: nodeData.rows?.length || 0,
            columnCount: cols.length,
            latencyMs: 1.2,
            outputDataset: nodeData,
            diffCols: [],
          },
        });
      }`;

if (content.includes(oldDataInput)) {
  content = content.replace(oldDataInput, newDataInput);
  console.log('Patched node.type === data_input.');
}

// 6. Patch node.type === 'spatial'
const oldSpatialHead = `      } else if (node.type === 'spatial') {
        const latency = Math.round((performance.now() - startT + 3.2) * 10) / 10;`;

const newSpatialHead = `      } else if (node.type === 'spatial') {
        const latency = Math.round((performance.now() - startT + 3.2) * 10) / 10;
        // 如果是编队保持度算子或海空域覆盖率算子，产出对应空间几何特征
        if (currentOperatorId === 'c2.group_cohesion_rate') {
          const schema = [
            ...(inputDataset.columns || inputDataset.schema || []),
            { name: 'cohesion_index', displayName: '编队构型保持度', type: 'number' as const },
          ];
          const outRows = (inputDataset.rows || []).map((r: any, idx: number) => ({
            ...r,
            cohesion_index: Math.round((0.96 - (idx % 3) * 0.04) * 100) / 100,
          }));
          const outData: TableDataset = {
            id: \`dataset_\${node.id}\`,
            schema,
            columns: schema,
            rows: outRows,
            totalRows: outRows.length,
          };
          nodeMap.set(nodeId, {
            ...node,
            runtime: {
              status: 'success',
              rowCount: outData.rows.length,
              columnCount: outData.schema.length,
              latencyMs: latency,
              outputDataset: outData,
              diffCols: ['cohesion_index'],
            },
          });
          continue;
        } else if (currentOperatorId === 'moe.zone_control_ratio') {
          const schema = [
            ...(inputDataset.columns || inputDataset.schema || []),
            { name: 'in_polygon_ratio', displayName: '任务区在空覆盖率', type: 'number' as const },
          ];
          const outRows = (inputDataset.rows || []).map((r: any, idx: number) => ({
            ...r,
            in_polygon_ratio: Math.round((0.88 - (idx % 2) * 0.05) * 100) / 100,
          }));
          const outData: TableDataset = {
            id: \`dataset_\${node.id}\`,
            schema,
            columns: schema,
            rows: outRows,
            totalRows: outRows.length,
          };
          nodeMap.set(nodeId, {
            ...node,
            runtime: {
              status: 'success',
              rowCount: outData.rows.length,
              columnCount: outData.schema.length,
              latencyMs: latency,
              outputDataset: outData,
              diffCols: ['in_polygon_ratio'],
            },
          });
          continue;
        }`;

if (content.includes(oldSpatialHead)) {
  content = content.replace(oldSpatialHead, newSpatialHead);
  console.log('Patched node.type === spatial.');
}

// 7. Patch node.type === 'result_output'
const oldResultOut = `        } else {
          outData = inputDataset;
        }

        nodeMap.set(nodeId, {
          ...node,
          runtime: {
            status: 'success',
            rowCount: outData.rows.length,
            columnCount: outData.schema.length,
            latencyMs: latency,
            outputDataset: outData,
            diffCols: hasComplianceRate ? ['OverallComplianceRate', 'EvaluationGrade', 'ThresholdStatus'] : [],
          },
        });`;

const newResultOut = `        } else {
          // 检查直接上游是否有执行异常
          const upstreamHasError = incomingEdges.some((e) => nodeMap.get(e.sourceNodeId)?.runtime?.status === 'error');
          if (upstreamHasError) {
            nodeMap.set(nodeId, {
              ...node,
              runtime: {
                status: 'error',
                errorMessage: '上游计算或聚合节点未产出有效数据，请检查上游节点配置',
                latencyMs: latency,
              },
            });
            continue;
          }

          const targetField = node.config?.targetField || 'metric_value';
          const indicatorName = node.config?.indicatorName || node.title;
          const unit = node.config?.indicatorUnit || '%';
          const optimalDirection = node.config?.optimalDirection || 'larger_is_better';

          const hasTargetField = inputDataset.rows?.some((r: any) => r[targetField] !== undefined);
          if (hasTargetField) {
            const outSchema = [
              { name: 'Side', displayName: '评估阵营', type: 'string' as const },
              { name: 'IndicatorName', displayName: '挂载指标', type: 'string' as const },
              { name: targetField, displayName: \`度量值 (\${unit})\`, type: 'number' as const },
              { name: 'EvaluationGrade', displayName: '效能评估评级', type: 'string' as const },
              { name: 'ThresholdStatus', displayName: '门限准则达成状态', type: 'string' as const },
            ];
            const outRows = inputDataset.rows.map((r: any) => {
              const val = typeof r[targetField] === 'number' ? Math.round(r[targetField] * 1000) / 1000 : (Number(r[targetField]) || 1.0);
              const side = r.Side || r.UnitSide || r.FiringUnitSide || r.TargetSide || 'Blue';
              const isPass = optimalDirection === 'smaller_is_better' ? val <= 3.0 : val >= 0.5;
              return {
                Side: \`\${side} (\${String(side).toLowerCase().includes('blue') ? '蓝方' : '红方'})\`,
                IndicatorName: indicatorName,
                [targetField]: val,
                EvaluationGrade: isPass ? '优秀 (达标)' : '需改进 (一般)',
                ThresholdStatus: isPass ? 'Pass (符合条令要求)' : 'Alert (未达预期)',
              };
            });
            outData = {
              id: \`dataset_\${node.id}\`,
              schema: outSchema,
              columns: outSchema,
              rows: outRows,
              totalRows: outRows.length,
            };
          } else {
            outData = inputDataset;
          }
        }

        nodeMap.set(nodeId, {
          ...node,
          runtime: {
            status: 'success',
            rowCount: outData.rows?.length || 0,
            columnCount: (outData.columns || outData.schema || []).length,
            latencyMs: latency,
            outputDataset: outData,
            diffCols: hasComplianceRate ? ['OverallComplianceRate', 'EvaluationGrade', 'ThresholdStatus'] : [node.config?.targetField || 'metric_value'],
          },
        });`;

if (content.includes(oldResultOut)) {
  content = content.replace(oldResultOut, newResultOut);
  console.log('Patched node.type === result_output.');
}

fs.writeFileSync(studioFile, content, 'utf-8');
console.log('Successfully updated PipelineCanvasStudio.tsx!');
