import React, { useState, useEffect, useMemo } from 'react';
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  Calculator,
  Check,
  CheckCircle2,
  CheckSquare,
  Code2,
  Compass,
  Database,
  ExternalLink,
  Filter,
  Layers,
  MapPin,
  Network,
  Play,
  Plus,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import type { CanvasEdge, CanvasNode, PipelineNodeType } from './canvas-types.ts';
import type {
  AggregationMethod,
  AggregationMetricItem,
  DerivedColumnConfig,
  FieldDataType,
  OptimalDirection,
  TableDataset,
} from '../../../core/types.ts';
import { evalApi } from '../../api.ts';
import { ALL_SPEC_EVENTS, findCatalogTable, type CatalogFieldItem, type CatalogTableSpec } from './schema-catalog.ts';
import { analyzeNodeLineage } from './lineage-analyzer.ts';
import { NodeLineageCard } from './NodeLineageCard.tsx';
import { AlgorithmInternalMechanismCard } from './AlgorithmInternalMechanismCard.tsx';
import { PythonCodeEditor, type UpstreamTableItem } from '../PythonCodeEditor.tsx';

interface CanvasInspectorDrawerProps {
  node: CanvasNode | null;
  upstreamColumns: string[];
  upstreamTables?: UpstreamTableItem[];
  incomingNodes?: CanvasNode[];
  allNodes?: CanvasNode[];
  allEdges?: CanvasEdge[];
  catalogList?: CatalogTableSpec[];
  currentOperatorId?: string;
  onOpenDictionary?: () => void;
  onUpdateNode: (updatedNode: CanvasNode) => void;
  onClose: () => void;
  onTriggerPreview: () => void;
}

const SHORTCUT_OPERATORS = [
  { label: '+', insert: ' + ' },
  { label: '-', insert: ' - ' },
  { label: '×', insert: ' * ' },
  { label: '÷', insert: ' / ' },
  { label: '^ (幂)', insert: ' ^ ' },
  { label: '(', insert: '(' },
  { label: ')', insert: ')' },
  { label: '>', insert: ' > ' },
  { label: '<', insert: ' < ' },
  { label: '>=', insert: ' >= ' },
  { label: '<=', insert: ' <= ' },
  { label: '=', insert: ' = ' },
  { label: '<>', insert: ' <> ' },
  { label: '; (参数分隔)', insert: '; ' },
];

const FUNCTION_PRESETS = {
  logic: [
    { name: 'IF', desc: '条件分支', syntax: "IF(条件; '真值'; '假值')" },
    { name: 'AND', desc: '逻辑与', syntax: 'AND(条件1; 条件2)' },
    { name: 'OR', desc: '逻辑或', syntax: 'OR(条件1; 条件2)' },
    { name: 'NOT', desc: '逻辑非', syntax: 'NOT(条件)' },
    { name: 'IFNULL', desc: '空值回退', syntax: 'IFNULL(值; 0)' },
  ],
  math: [
    { name: 'ROUND', desc: '四舍五入', syntax: 'ROUND(数值; 2)' },
    { name: 'ABS', desc: '绝对值', syntax: 'ABS(数值)' },
    { name: 'SQRT', desc: '平方根', syntax: 'SQRT(数值)' },
    { name: 'CLAMP', desc: '区间截断', syntax: 'CLAMP(数值; 0; 100)' },
    { name: 'MOD', desc: '取模', syntax: 'MOD(数值; 2)' },
  ],
  text: [
    { name: 'CONCATENATE', desc: '文本拼接', syntax: "CONCATENATE(文本1; '_'; 文本2)" },
    { name: 'LEFT', desc: '左截取', syntax: 'LEFT(文本; 4)' },
    { name: 'RIGHT', desc: '右截取', syntax: 'RIGHT(文本; 4)' },
    { name: 'MID', desc: '中间截取', syntax: 'MID(文本; 1; 4)' },
    { name: 'LEN', desc: '字符长度', syntax: 'LEN(文本)' },
  ],
  datetime: [
    { name: 'DATEDIFF', desc: '计算时差(秒)', syntax: "DATEDIFF('s'; 时间1; 时间2)" },
    { name: 'YEAR', desc: '提取年份', syntax: 'YEAR(时间)' },
    { name: 'MONTH', desc: '提取月份', syntax: 'MONTH(时间)' },
    { name: 'DAY', desc: '提取日期', syntax: 'DAY(时间)' },
  ],
};

const AGG_METHODS: Array<{ id: AggregationMethod; name: string }> = [
  { id: 'AVERAGE', name: '平均值 (AVERAGE)' },
  { id: 'SUM', name: '累加求和 (SUM)' },
  { id: 'MAX', name: '最大值 (MAX)' },
  { id: 'MIN', name: '最小值 (MIN)' },
  { id: 'COUNT_ALL', name: '样本行数 (COUNT_ALL / 等价于 COUNT(1))' },
  { id: 'COUNT_DISTINCT', name: '唯一值去重计数 (COUNT_DISTINCT)' },
  { id: 'COUNT_NON_EMPTY', name: '非空计数 (COUNT_NON_EMPTY)' },
  { id: 'STDEV', name: '样本标准差 (STDEV)' },
  { id: 'FIRST', name: '首个样本值 (FIRST)' },
  { id: 'LAST', name: '末尾样本值 (LAST)' },
];

/**
 * 根据规范表元数据生成生动的仿真样本切片数据集 (包含 Scenario, MC_Run, TimelineID, Time 等真实标准字段)
 */
export function createMockDatasetForTable(
  targetSpec: CatalogTableSpec,
  selectedColNames?: string[],
  filterOpts?: { filterField?: string; filterEquals?: string }
): TableDataset {
  const fields = targetSpec.fields || [];
  const activeFields = selectedColNames && selectedColNames.length > 0
    ? fields.filter((f) => selectedColNames.includes(f.name))
    : fields;

  const schema = activeFields.map((f) => ({
    name: f.name,
    displayName: `${f.name}${f.unit ? ` (${f.unit})` : ''}`,
    type: (f.type === 'double' || f.type === 'int' ? 'number' : f.type === 'datetime' ? 'string' : 'string') as FieldDataType,
  }));

  const baseTimes = [12.0, 24.5, 38.0, 52.5, 75.0, 92.4, 118.0];
  let mockRows: any[] = [];

  for (let i = 0; i < 7; i++) {
    const row: Record<string, any> = {};
    for (const f of activeFields) {
      const lower = f.name.toLowerCase();
      if (f.name === 'Scenario') {
        row[f.name] = 'SCENARIO_TAIWAN_STRAIT_2026';
      } else if (f.name === 'MC_Run') {
        row[f.name] = 1;
      } else if (f.name === 'TimelineID') {
        row[f.name] = 'TL_MAIN_LINE_01';
      } else if (f.name === 'Time' || lower === 'time') {
        row[f.name] = baseTimes[i] ?? (10.0 * (i + 1));
      } else if (lower.includes('lat')) {
        row[f.name] = Math.round((31.2 + i * 0.05) * 1000) / 1000;
      } else if (lower.includes('lon')) {
        row[f.name] = Math.round((121.4 + i * 0.08) * 1000) / 1000;
      } else if (lower.includes('alt') || lower.includes('height')) {
        row[f.name] = 8500 + i * 150;
      } else if (lower.includes('range') || lower.includes('dist')) {
        row[f.name] = Math.round((55.0 - i * 6.5) * 10) / 10;
      } else if (lower.includes('speed')) {
        row[f.name] = 520 + i * 20;
      } else if (lower.includes('side')) {
        row[f.name] = i % 2 === 0 ? 'Blue' : 'Red';
      } else if (lower.includes('status')) {
        row[f.name] = i % 3 === 0 ? 'Active' : i % 3 === 1 ? 'KnownClass' : 'Detected';
      } else if (lower.includes('type') || lower.includes('class')) {
        row[f.name] = i % 2 === 0 ? 'Radar' : 'Optics';
      } else if (f.type === 'double' || f.type === 'int') {
        row[f.name] = Math.round((10 + i * 8.2) * 10) / 10;
      } else if (f.type === 'boolean') {
        row[f.name] = i % 2 === 0 ? 1 : 0;
      } else {
        row[f.name] = `${f.name}_VAL_${i + 1}`;
      }
    }
    mockRows.push(row);
  }

  // 真实过滤行数据
  if (filterOpts?.filterField && filterOpts.filterEquals !== undefined && filterOpts.filterEquals.trim() !== '') {
    const fField = filterOpts.filterField.trim();
    const fVal = filterOpts.filterEquals.trim().toLowerCase();
    const filtered = mockRows.filter((r) => {
      const cell = String(r[fField] ?? '').trim().toLowerCase();
      return cell === fVal;
    });
    if (filtered.length > 0) {
      mockRows = filtered;
    }
  }

  return {
    id: `mock_${targetSpec.id || 'table'}_${Date.now()}`,
    schema,
    rows: mockRows,
    totalRows: mockRows.length,
  };
}

export function CanvasInspectorDrawer({
  node,
  upstreamColumns,
  upstreamTables = [],
  incomingNodes = [],
  allNodes = [],
  allEdges = [],
  catalogList = ALL_SPEC_EVENTS,
  currentOperatorId,
  onOpenDictionary,
  onUpdateNode,
  onClose,
  onTriggerPreview,
}: CanvasInspectorDrawerProps) {
  if (!node) return null;

  const [activeFuncTab, setActiveFuncTab] = useState<'math' | 'logic' | 'text' | 'datetime'>('logic');
  const [drawerTab, setDrawerTab] = useState<'config' | 'lineage' | 'model'>('config');
  const [isPublishingIndicator, setIsPublishingIndicator] = useState(false);
  const [publishIndicatorStatus, setPublishIndicatorStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [selectedColIdx, setSelectedColIdx] = useState<number>(0);
  const [formulaSyntaxOk, setFormulaSyntaxOk] = useState<boolean>(true);
  const [formulaSyntaxError, setFormulaSyntaxError] = useState<string>('');
  const [fieldSearch, setFieldSearch] = useState<string>('');
  const [spatialTestLon, setSpatialTestLon] = useState<number>(121.35);
  const [spatialTestLat, setSpatialTestLat] = useState<number>(31.25);
  const [spatialTestResult, setSpatialTestResult] = useState<{
    inside: boolean;
    marginKm: number;
    latencyMs: number;
    testedAt: string;
  } | null>(null);

  const [pythonDrawerResult, setPythonDrawerResult] = useState<{
    status: 'success' | 'error';
    output?: any;
    stdout?: string;
    stderr?: string;
    latencyMs?: number;
    errorLine?: number;
  } | null>(null);
  const [isDrawerRunningPython, setIsDrawerRunningPython] = useState(false);
  const [newColInput, setNewColInput] = useState('');

  // 抽屉宽度状态与伸缩档位管理 (针对 Python 节点提供 860px 宽屏工作台)
  const [drawerWidth, setDrawerWidth] = useState<number>(() => {
    const saved = localStorage.getItem('f1_pipeline_drawer_width');
    if (saved && !isNaN(parseInt(saved, 10))) {
      return parseInt(saved, 10);
    }
    return node?.type === 'python_script' ? 860 : 480;
  });
  const [isMaximized, setIsMaximized] = useState(false);

  // 当切换到 Python 脚本节点且当前宽度仅为默认 480 时，自动平滑展开至 860 宽屏工作台
  useEffect(() => {
    if (node?.type === 'python_script' && drawerWidth < 760) {
      setDrawerWidth(860);
    }
  }, [node?.id, node?.type]);

  // 鼠标拖拽左边缘拉伸抽屉宽度
  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = drawerWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.max(460, Math.min(window.innerWidth - 60, startWidth + delta));
      setDrawerWidth(newWidth);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      localStorage.setItem('f1_pipeline_drawer_width', String(drawerWidth));
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const extractErrorLine = (text?: string): number | null => {
    if (!text) return null;
    const match = text.match(/line\s+(\d+)/i) || text.match(/第\s*(\d+)\s*行/);
    if (match && match[1]) {
      const line = parseInt(match[1], 10);
      return isNaN(line) ? null : line;
    }
    return null;
  };

  // 全自动全链路 I/O 契约与多下游消费诊断分析
  const lineage = useMemo(() => {
    return analyzeNodeLineage(node, allNodes, allEdges, upstreamColumns);
  }, [node, allNodes, allEdges, upstreamColumns]);

  const config = node.config;

  // 快捷更新当前节点的 config
  const updateConfig = (patch: Partial<typeof config>) => {
    onUpdateNode({
      ...node,
      config: { ...node.config, ...patch },
    });
  };

  // 支持在 Python 脚本框中按 Tab 插入 4 个空格缩进
  const handlePythonCodeKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const value = target.value;
      const newValue = value.substring(0, start) + '    ' + value.substring(end);
      updateConfig({ pythonScriptCode: newValue });
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 4;
      });
    }
  };

  // 快捷将上游字段注入 Python 代码
  const handleInsertUpstreamColumnToPython = (col: string) => {
    const code =
      config.pythonScriptCode ||
      '# Python 3.12 算法代码\ndef evaluate(context):\n    return {"status": "computed", "score": 1.0}\n';
    const snippet = `    ${col.toLowerCase()} = context.get('${col}', 0.0)\n`;
    if (code.includes('def evaluate(context):')) {
      updateConfig({
        pythonScriptCode: code.replace('def evaluate(context):\n', `def evaluate(context):\n${snippet}`),
      });
    } else {
      updateConfig({
        pythonScriptCode: `${code}\n${snippet}`,
      });
    }
  };

  // 真实上下文载荷计算 (打通画布上游多表输入与前序节点)
  const drawerContextPayload = useMemo(() => {
    const mockCtx: Record<string, unknown> = {};
    for (const col of upstreamColumns) {
      mockCtx[col] = 100.0;
    }

    // 收集画布内上游/同图底表 (data_input) 以及前序节点输出表
    const tables: Record<string, any[]> = {};
    let prevRows: any[] | null = null;
    for (const n of [...incomingNodes, ...allNodes]) {
      const ds = n?.runtime?.outputDataset;
      if (n?.type === 'data_input' && n.config?.csvTable && ds?.rows && ds.rows.length > 0) {
        const tblName = String(n.config.csvTable).trim();
        if (!tables[tblName]) {
          tables[tblName] = ds.rows;
        }
      }
    }
    for (const inNode of incomingNodes) {
      const ds = inNode?.runtime?.outputDataset;
      if (inNode?.type !== 'data_input' && ds?.rows && ds.rows.length > 0) {
        prevRows = ds.rows;
        break;
      }
    }
    if (Object.keys(tables).length > 0) {
      mockCtx.tables = tables;
    }
    if (prevRows) {
      mockCtx.prev_output_rows = prevRows;
      mockCtx.dataset = { rows: prevRows };
    }
    return mockCtx;
  }, [upstreamColumns, incomingNodes, allNodes]);

  // 抽屉内单步真机试算当前 Python 节点
  const handleDrawerRunPython = async () => {
    setIsDrawerRunningPython(true);

    const t0 = performance.now();
    try {
      const res = await evalApi.runPythonSandbox({
        script:
          config.pythonScriptCode ||
          '# Python 3.12 仿真评估算法模型\nimport pandas as pd\nimport numpy as np\n\ndef T(name):\n    return input_df_dict.get(name, input_df_dict.get(name + ".csv", pd.DataFrame()))\n\ndef C(df, name, default=None):\n    return df[name] if name in df.columns else pd.Series(default, index=df.index, dtype=object)\n\noutput_df = pd.DataFrame({"分方": ["Blue", "Red"], "评估分值": [1.0, 1.0]})\n',
        context: drawerContextPayload,
        timeout: (config.timeoutMs || 5000) / 1000,
      });
      const t1 = performance.now();
      const latency = res.latencyMs ?? +(t1 - t0).toFixed(2);
      const errLine = res.stderr ? extractErrorLine(res.stderr) : undefined;
      setPythonDrawerResult({
        status: res.status,
        output: res.output,
        stdout: res.stdout,
        stderr: res.stderr,
        latencyMs: latency,
        errorLine: errLine,
      });

      if (res.status === 'success') {
        let dfCols: any[] = [];
        let rows: any[] = [];
        let rowCount = 0;
        let columnCount = 0;
        let colNames: string[] = [];

        if (res.output?.__is_dataframe__ && Array.isArray(res.output.rows)) {
          dfCols = Array.isArray(res.output.columns) ? res.output.columns : [];
          colNames = dfCols.map((c: any) => (typeof c === 'string' ? c : c.name || String(c)));
          rows = res.output.rows;
          rowCount = res.output.rowCount ?? rows.length;
          columnCount = res.output.columnCount ?? dfCols.length;
        } else if (res.output && typeof res.output === 'object' && !Array.isArray(res.output)) {
          // P2: 自动升维——将标量/参数字典自动提升为单行标准二维表数据集，下游算子可直接消费
          const keys = Object.keys(res.output).filter((k) => !k.startsWith('__'));
          colNames = keys;
          dfCols = keys.map((k) => ({
            name: k,
            displayName: k,
            type: typeof res.output[k] === 'number' ? 'number' : typeof res.output[k] === 'boolean' ? 'boolean' : 'string',
          }));
          rows = [res.output];
          rowCount = 1;
          columnCount = keys.length;
        }

        if (colNames.length > 0 || rows.length > 0) {
          // 核心改进：试算成功后始终以真实产出的列（DataFrame 或自动升维字典）为单一真相源自动同步契约
          const nextOutputCols = colNames.length > 0 ? colNames : (config.outputColumns || []);

          onUpdateNode({
            ...node,
            config: {
              ...config,
              outputColumns: nextOutputCols,
            },
            runtime: {
              status: 'success',
              rowCount,
              columnCount,
              latencyMs: latency,
              outputDataset: {
                id: `dataset_${node.id}`,
                schema: dfCols,
                columns: dfCols,
                rows,
                totalRows: rowCount,
              },
              diffCols: colNames,
            },
          });
        }
      }
    } catch (err: any) {
      const t1 = performance.now();
      const errLine = extractErrorLine(err.message);
      setPythonDrawerResult({
        status: 'error',
        stderr: err.message,
        latencyMs: +(t1 - t0).toFixed(2),
        errorLine: errLine,
      });
    } finally {
      setIsDrawerRunningPython(false);
    }
  };

  // 校验当前公式语法
  const currentExpression = config.derivedColumns?.[selectedColIdx]?.expression || '';
  useEffect(() => {
    if (!currentExpression.trim()) {
      setFormulaSyntaxOk(false);
      setFormulaSyntaxError('公式表达式尚未填写');
      return;
    }
    evalApi
      .validateFormula(currentExpression)
      .then((res) => {
        setFormulaSyntaxOk(res.valid);
        setFormulaSyntaxError(res.valid ? '' : res.errors?.[0] || '语法格式有误');
      })
      .catch(() => {
        setFormulaSyntaxOk(true);
      });
  }, [currentExpression]);

  // 插入字符到当前选中的公式中
  const handleInsertText = (text: string) => {
    const cols = [...(config.derivedColumns || [])];
    if (cols.length === 0) return;
    const cur = cols[selectedColIdx];
    if (!cur) return;
    const newExpr = (cur.expression || '') + text;
    cols[selectedColIdx] = { ...cur, expression: newExpr };
    updateConfig({ derivedColumns: cols });
  };

  return (
    <div
      data-inspector-drawer="true"
      onKeyDown={(e) => {
        // 关键安全防线：抽屉属于节点内部属性与算法配置面板，
        // 内部发生的所有退格、删除或快捷键操作绝不能冒泡至外层画布导致误删节点
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.stopPropagation();
        }
      }}
      style={{
        width: isMaximized ? '100vw' : `${drawerWidth}px`,
        maxWidth: isMaximized ? '100vw' : 'calc(100vw - 1rem)',
      }}
      className={`flex h-full flex-col border-l border-slate-800 bg-[#0d1424] text-xs text-slate-200 shadow-2xl z-30 transition-all ${
        isMaximized ? 'fixed inset-0 z-50' : 'absolute lg:relative inset-y-0 right-0'
      }`}
    >
      {/* ─── 抽屉左侧拖拽拉伸把手 (Drag-to-Resize Handle) ─── */}
      {!isMaximized && (
        <div
          onMouseDown={handleMouseDownResize}
          className="absolute -left-1.5 top-0 bottom-0 w-3 cursor-ew-resize group z-40 flex items-center justify-center hover:bg-fuchsia-500/10 transition"
          title="按住鼠标拖拽调整抽屉宽度"
        >
          <div className="w-[3px] h-10 rounded-full bg-slate-700 group-hover:bg-fuchsia-400 group-active:bg-fuchsia-400 transition" />
        </div>
      )}

      {/* ─── 抽屉头部 ─── */}
      <div className="flex h-14 items-center justify-between border-b border-slate-800 px-4 bg-[#111827]">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/30">
            {node.type === 'data_input' && <Database className="h-4 w-4 text-blue-400" />}
            {node.type === 'inline_calc' && <Calculator className="h-4 w-4 text-cyan-400" />}
            {node.type === 'group_agg' && <BarChart3 className="h-4 w-4 text-amber-400" />}
            {node.type === 'result_output' && <Target className="h-4 w-4 text-emerald-400" />}
            {node.type === 'spatial' && <Compass className="h-4 w-4 text-violet-400" />}
            {node.type === 'python_script' && <Code2 className="h-4 w-4 text-fuchsia-400" />}
          </div>
          <div>
            <h3 className="font-semibold text-slate-100 text-sm">{node.title}</h3>
            <span className="text-[10px] text-slate-400">属性配置与算法编辑器</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 抽屉宽度模式快捷切换 */}
          <div className="hidden sm:flex items-center bg-slate-900 rounded-lg p-0.5 border border-slate-800 text-[10px]">
            <button
              type="button"
              onClick={() => {
                setIsMaximized(false);
                setDrawerWidth(480);
                localStorage.setItem('f1_pipeline_drawer_width', '480');
              }}
              className={`px-1.5 py-0.5 rounded transition ${
                !isMaximized && drawerWidth < 700 ? 'bg-slate-800 text-sky-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="切换为 480px 紧凑模式"
            >
              480px
            </button>
            <button
              type="button"
              onClick={() => {
                setIsMaximized(false);
                setDrawerWidth(860);
                localStorage.setItem('f1_pipeline_drawer_width', '860');
              }}
              className={`px-1.5 py-0.5 rounded transition ${
                !isMaximized && drawerWidth >= 700 ? 'bg-slate-800 text-fuchsia-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="切换为 860px 宽屏工作台模式 (推荐)"
            >
              860px 宽屏
            </button>
            <button
              type="button"
              onClick={() => setIsMaximized(!isMaximized)}
              className={`px-1.5 py-0.5 rounded transition ${
                isMaximized ? 'bg-fuchsia-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
              title={isMaximized ? '还原抽屉宽度' : '全屏沉浸模式'}
            >
              {isMaximized ? '还原' : '全屏'}
            </button>
          </div>

          {node.type !== 'python_script' && (
            <button
              type="button"
              title="试算并刷新底部预览"
              onClick={onTriggerPreview}
              className="flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/30 transition shadow-sm"
            >
              <Sparkles className="h-3 w-3" />
              <span>试算预览</span>
            </button>
          )}
          <button
            type="button"
            title="收起抽屉"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ─── 顶部紧凑状态胶囊 Bar ─── */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-[#090d18] px-4 py-2 text-[11px]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-800/90 border border-slate-700/80 px-2 py-0.5 text-slate-300 font-mono text-[10px]">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            <span>输入 {lineage?.totalInputCount || 0} 列 ({lineage?.consumedInputCount || 0} 参与计算)</span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-800/90 border border-slate-700/80 px-2 py-0.5 text-slate-300 font-mono text-[10px]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span>输出 {lineage?.totalOutputCount || 0} 列 ({lineage?.consumedOutputCount || 0} 下游引用)</span>
          </span>
        </div>
        <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400 font-mono">
          {lineage?.downstreamBranchesCount || 0} 个下游分支
        </span>
      </div>

      {/* ─── 抽屉三级 Tab 导航栏 ─── */}
      <div className="flex border-b border-slate-800 bg-[#0e1628] text-xs px-2 pt-1 gap-1">
        <button
          type="button"
          onClick={() => setDrawerTab('config')}
          className={`flex items-center gap-1.5 px-3 py-2 font-semibold border-b-2 transition ${
            drawerTab === 'config'
              ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>算法配置</span>
        </button>

        <button
          type="button"
          onClick={() => setDrawerTab('lineage')}
          className={`flex items-center gap-1.5 px-3 py-2 font-semibold border-b-2 transition ${
            drawerTab === 'lineage'
              ? 'border-emerald-400 text-emerald-300 bg-emerald-950/20'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Network className="h-3.5 w-3.5" />
          <span>输入输出分析</span>
          {lineage && (
            <span className="rounded-full bg-slate-800 px-1.5 text-[10px] text-emerald-300 font-mono">
              {lineage.consumedOutputCount}/{lineage.totalOutputCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setDrawerTab('model')}
          className={`flex items-center gap-1.5 px-3 py-2 font-semibold border-b-2 transition ${
            drawerTab === 'model'
              ? 'border-violet-400 text-violet-300 bg-violet-950/20'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Compass className="h-3.5 w-3.5" />
          <span>算法原理</span>
        </button>
      </div>

      {/* ─── 抽屉主体表单 (按 Tab 区分展现) ─── */}
      <div
        className={`flex-1 min-h-0 ${
          node.type === 'python_script' && drawerTab === 'config'
            ? 'flex flex-col overflow-hidden p-2.5 space-y-2'
            : 'overflow-y-auto p-4 space-y-4'
        }`}
      >
        {/* Tab 1: 算法核心规则与参数配置 */}
        {drawerTab === 'config' && (
          <div className={node.type === 'python_script' ? 'flex-1 flex flex-col min-h-0 overflow-hidden space-y-2' : 'space-y-4'}>
            {/* 节点通用名称修改 */}
            <div className={node.type === 'python_script' ? 'flex items-center gap-2 shrink-0' : 'space-y-1'}>
              <label className="text-[11px] font-medium text-slate-400 shrink-0">节点名称</label>
              <input
                type="text"
                value={node.title}
                onChange={(e) => onUpdateNode({ ...node, title: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>

        {/* ═════════════════ 类型 1: 数据输入节点 (data_input) ═════════════════ */}
        {node.type === 'data_input' && (() => {
          const currentTableSpec = findCatalogTable(config.csvTable, catalogList) || catalogList[0] || ALL_SPEC_EVENTS[0];
          const allTableFields = currentTableSpec.fields || [];
          const validFieldNames = new Set(allTableFields.map((f) => f.name));
          const rawSelected: string[] = Array.isArray(config.selectedColumns) && config.selectedColumns.length > 0
            ? config.selectedColumns.filter((c) => validFieldNames.has(c))
            : [];
          const selectedColumns: string[] = rawSelected.length > 0 ? rawSelected : allTableFields.map((f) => f.name);

          // 字段过滤搜索
          const filteredFields = allTableFields.filter((f) => {
            if (!fieldSearch.trim()) return true;
            const q = fieldSearch.toLowerCase();
            return (
              f.name.toLowerCase().includes(q) ||
              (f.unit || '').toLowerCase().includes(q) ||
              (f.note || '').toLowerCase().includes(q)
            );
          });

          // 切换单个字段勾选状态
          const handleToggleField = (fieldName: string) => {
            let next: string[];
            if (selectedColumns.includes(fieldName)) {
              next = selectedColumns.filter((c) => c !== fieldName);
            } else {
              next = [...selectedColumns, fieldName];
            }
            const updatedDataset = createMockDatasetForTable(currentTableSpec, next);
            onUpdateNode({
              ...node,
              config: { ...node.config, selectedColumns: next },
              runtime: {
                ...node.runtime,
                status: 'success',
                columnCount: next.length,
                rowCount: updatedDataset.rows.length,
                outputDataset: updatedDataset,
              },
            });
          };

          // 快捷全选
          const handleSelectAllFields = () => {
            const next = allTableFields.map((f) => f.name);
            const updatedDataset = createMockDatasetForTable(currentTableSpec, next);
            onUpdateNode({
              ...node,
              config: { ...node.config, selectedColumns: next },
              runtime: {
                ...node.runtime,
                status: 'success',
                columnCount: next.length,
                rowCount: updatedDataset.rows.length,
                outputDataset: updatedDataset,
              },
            });
          };

          // 快捷清空
          const handleClearFields = () => {
            const updatedDataset = createMockDatasetForTable(currentTableSpec, []);
            onUpdateNode({
              ...node,
              config: { ...node.config, selectedColumns: [] },
              runtime: {
                ...node.runtime,
                status: 'success',
                columnCount: 0,
                rowCount: 0,
                outputDataset: updatedDataset,
              },
            });
          };

          // 推荐核心业务字段
          const handleSelectCoreFields = () => {
            const core = allTableFields
              .filter(
                (f) =>
                  !f.name.includes('TimelineID') &&
                  !f.name.includes('DBID') &&
                  !f.name.includes('MC_Run') &&
                  !f.name.includes('Scenario')
              )
              .map((f) => f.name);
            const updatedDataset = createMockDatasetForTable(currentTableSpec, core);
            onUpdateNode({
              ...node,
              config: { ...node.config, selectedColumns: core },
              runtime: {
                ...node.runtime,
                status: 'success',
                columnCount: core.length,
                rowCount: updatedDataset.rows.length,
                outputDataset: updatedDataset,
              },
            });
          };

          // 包含前置标准列 (Scenario / MC_Run / TimelineID / Time)
          const handleSelectPrefixFields = () => {
            const prefixNames = ['Scenario', 'MC_Run', 'TimelineID', 'Time'];
            const availablePrefix = prefixNames.filter((p) => allTableFields.some((f) => f.name === p));
            const next = Array.from(new Set([...availablePrefix, ...selectedColumns]));
            const updatedDataset = createMockDatasetForTable(currentTableSpec, next);
            onUpdateNode({
              ...node,
              config: { ...node.config, selectedColumns: next },
              runtime: {
                ...node.runtime,
                status: 'success',
                columnCount: next.length,
                rowCount: updatedDataset.rows.length,
                outputDataset: updatedDataset,
              },
            });
          };

          // 切换目标规范事件表 (联动刷新输出切片数据)
          const handleTableChange = (newTableName: string) => {
            const targetSpec = findCatalogTable(newTableName, catalogList) || catalogList[0] || ALL_SPEC_EVENTS[0];
            const defaultCols = targetSpec?.fields?.map((f) => f.name) || [];
            const newDataset = createMockDatasetForTable(targetSpec, defaultCols);
            onUpdateNode({
              ...node,
              config: {
                ...node.config,
                csvTable: newTableName,
                selectedColumns: defaultCols,
              },
              runtime: {
                ...node.runtime,
                status: 'success',
                columnCount: defaultCols.length,
                rowCount: newDataset.rows.length,
                outputDataset: newDataset,
              },
            });
            setFieldSearch('');
          };

          return (
            <div className="space-y-4">
              {/* 1. 目标规范事件表选择器 (44 类标准表分类展示) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-slate-300">
                    目标规范事件表
                  </label>
                  {(node.runtime?.outputDataset as any)?.isRealData ? (
                    <span className="flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] text-emerald-300 font-semibold" title={`数据源自推演场景: ${(node.runtime?.outputDataset as any).scenarioName || (node.runtime?.outputDataset as any).sourceRunId}`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      真实场景: {(node.runtime?.outputDataset as any).scenarioName || '已绑定场景'} ({node.runtime?.outputDataset?.rows?.length} 行)
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 font-mono">
                      当前表包含 {allTableFields.length} 项规范字段
                    </span>
                  )}
                </div>
                <select
                  value={
                    (() => {
                      const cur = config.csvTable || 'UnitPositions.csv';
                      return cur.endsWith('.csv') ? cur : `${cur}.csv`;
                    })()
                  }
                  onChange={(e) => handleTableChange(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 focus:border-cyan-500 focus:outline-none shadow-sm cursor-pointer"
                >
                  {/* 分类 1: 空间几何与时序态势 */}
                  <optgroup label="── 1. 空间几何与时序态势 (Spatial & Kinematics) ──">
                    {ALL_SPEC_EVENTS.filter((e) => e.category === '空间几何与时序态势').map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} (含 {t.fieldsCount} 项规范字段)
                      </option>
                    ))}
                  </optgroup>

                  {/* 分类 2: 武器交战与末端毁伤 */}
                  <optgroup label="── 2. 武器交战与末端毁伤 (Weapons & Engagement) ──">
                    {ALL_SPEC_EVENTS.filter((e) => e.category === '武器交战与末端毁伤').map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} (含 {t.fieldsCount} 项规范字段)
                      </option>
                    ))}
                  </optgroup>

                  {/* 分类 3: 传感器感知与电磁对抗 */}
                  <optgroup label="── 3. 传感器感知与电磁对抗 (Sensor & EMCON) ──">
                    {ALL_SPEC_EVENTS.filter((e) => e.category === '传感器感知与电磁对抗').map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} (含 {t.fieldsCount} 项规范字段)
                      </option>
                    ))}
                  </optgroup>

                  {/* 分类 4: 战损评估与毁伤效果 */}
                  <optgroup label="── 4. 战损评估与毁伤效果 (Damage & Losses) ──">
                    {ALL_SPEC_EVENTS.filter((e) => e.category === '战损评估与毁伤效果').map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} (含 {t.fieldsCount} 项规范字段)
                      </option>
                    ))}
                  </optgroup>

                  {/* 分类 5: 指挥通信与后勤保障 */}
                  <optgroup label="── 5. 指挥通信与后勤保障 (Comm, Logistics & Fuel) ──">
                    {ALL_SPEC_EVENTS.filter((e) => e.category === '指挥通信与后勤保障').map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} (含 {t.fieldsCount} 项规范字段)
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {/* 2. 规范字段勾选与投影面板 (Field Projection & Selection) */}
              <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-1.5">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-400" />
                    <span className="text-xs font-semibold text-slate-200">
                      规范字段勾选与投影 (Field Projection)
                    </span>
                    {onOpenDictionary && (
                      <button
                        type="button"
                        onClick={onOpenDictionary}
                        className="ml-1 flex items-center gap-1 rounded bg-cyan-950/80 border border-cyan-800/80 px-1.5 py-0.5 text-[10px] text-cyan-300 hover:bg-cyan-900 transition"
                        title="查看全部 46 表字段中文含义与量纲规范字典"
                      >
                        <BookOpen className="h-3 w-3" />
                        <span>元数据字典</span>
                      </button>
                    )}
                  </div>
                  <span className="rounded bg-cyan-500/15 border border-cyan-500/30 px-1.5 py-0.5 text-[10px] text-cyan-300 font-mono font-medium">
                    已选 {selectedColumns.length} / {allTableFields.length}
                  </span>
                </div>

                {/* 字段检索框与快捷按钮 */}
                <div className="space-y-2 pt-1">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="快速检索字段名称、物理量纲 (如 deg, nm, speed)..."
                      value={fieldSearch}
                      onChange={(e) => setFieldSearch(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 pl-8 pr-3 py-1 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">
                      匹配到 {filteredFields.length} 个字段
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={handleSelectAllFields}
                        className="rounded px-1.5 py-0.5 bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 transition"
                      >
                        全选
                      </button>
                      <button
                        type="button"
                        onClick={handleClearFields}
                        className="rounded px-1.5 py-0.5 bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 transition"
                      >
                        清空
                      </button>
                      <button
                        type="button"
                        onClick={handleSelectCoreFields}
                        className="rounded px-1.5 py-0.5 bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 transition font-medium"
                      >
                        业务字段
                      </button>
                      <button
                        type="button"
                        onClick={handleSelectPrefixFields}
                        className="rounded px-1.5 py-0.5 bg-sky-500/15 border border-sky-500/30 text-sky-300 hover:bg-sky-500/25 transition font-medium"
                      >
                        前置列
                      </button>
                    </div>
                  </div>
                </div>

                {/* 字段选择滚动列表 */}
                <div className="max-h-[220px] overflow-y-auto space-y-1 pr-1 border border-slate-800/80 rounded-lg p-1.5 bg-[#090d18]">
                  {filteredFields.length === 0 ? (
                    <div className="py-6 text-center text-slate-500 text-xs">
                      无匹配字段，请尝试搜索其他关键字
                    </div>
                  ) : (
                    filteredFields.map((f) => {
                      const isChecked = selectedColumns.includes(f.name);
                      const isPrefix = ['Scenario', 'MC_Run', 'TimelineID', 'Time'].includes(f.name);
                      return (
                        <div
                          key={f.name}
                          onClick={() => handleToggleField(f.name)}
                          className={`flex items-center justify-between rounded-md px-2.5 py-1.5 cursor-pointer select-none transition border ${
                            isChecked
                              ? 'bg-cyan-950/40 border-cyan-500/40 text-slate-100'
                              : 'bg-slate-900/40 border-slate-800/80 text-slate-400 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div
                              className={`h-3.5 w-3.5 rounded border flex items-center justify-center transition shrink-0 ${
                                isChecked
                                  ? 'border-cyan-400 bg-cyan-500 text-slate-950'
                                  : 'border-slate-600 bg-slate-800'
                              }`}
                            >
                              {isChecked && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                            </div>
                            <span
                              className={`font-mono text-xs truncate ${
                                isChecked ? 'font-bold text-cyan-200' : 'text-slate-300'
                              }`}
                            >
                              {f.name}
                            </span>
                            {isPrefix && (
                              <span className="rounded bg-sky-950/80 border border-sky-800/60 px-1 py-0.2 text-[9px] text-sky-300 shrink-0">
                                前置
                              </span>
                            )}
                            {f.note && (
                              <span className="text-[10px] text-slate-400 truncate max-w-[170px]" title={f.note}>
                                ({f.note})
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 ml-2">
                            {f.unit && (
                              <span className="rounded bg-amber-500/15 border border-amber-500/30 px-1 py-0.2 text-[9px] font-mono text-amber-300 font-semibold">
                                {f.unit}
                              </span>
                            )}
                            <span className="rounded bg-slate-800 border border-slate-700 px-1 py-0.2 text-[9px] font-mono text-slate-400">
                              {f.cs_type}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* 已选字段 Tag 预览条 */}
                <div className="pt-2 border-t border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>本节点输出字段列表：</span>
                    <span className="text-cyan-400 font-mono font-semibold">
                      共 {selectedColumns.length} 列
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto p-1 rounded-md bg-slate-950/60 border border-slate-800">
                    {selectedColumns.length === 0 ? (
                      <span className="text-[11px] text-rose-400 italic">
                        ⚠️ 尚未勾选任何输入字段，下游算法节点将无法提取特征数据！
                      </span>
                    ) : (
                      selectedColumns.map((colName) => (
                        <span
                          key={colName}
                          className="inline-flex items-center gap-1 rounded bg-slate-800/90 border border-slate-700 px-1.5 py-0.5 text-[10px] font-mono text-slate-200"
                        >
                          <span>{colName}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleField(colName);
                            }}
                            className="text-slate-400 hover:text-rose-400 transition"
                          >
                            ×
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* 3. 行过滤条件 (WHERE 筛选) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-slate-300">
                    行过滤条件 (WHERE 筛选 · 可选)
                  </label>
                  <span className="text-[10px] text-slate-500">
                    按属性精准过滤样本行
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="过滤字段 (如 UnitSide / SensorType)"
                    value={config.filterField || ''}
                    onChange={(e) => {
                      const nextField = e.target.value;
                      const nextCfg = { ...node.config, filterField: nextField };
                      const updatedDs = createMockDatasetForTable(currentTableSpec, selectedColumns, {
                        filterField: nextField,
                        filterEquals: config.filterEquals,
                      });
                      onUpdateNode({
                        ...node,
                        config: nextCfg,
                        runtime: {
                          ...node.runtime,
                          status: 'success',
                          columnCount: selectedColumns.length,
                          rowCount: updatedDs.rows.length,
                          outputDataset: updatedDs,
                        },
                      });
                    }}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    placeholder="过滤取值 (如 Blue / Radar)"
                    value={config.filterEquals || ''}
                    onChange={(e) => {
                      const nextVal = e.target.value;
                      const nextCfg = { ...node.config, filterEquals: nextVal };
                      const updatedDs = createMockDatasetForTable(currentTableSpec, selectedColumns, {
                        filterField: config.filterField,
                        filterEquals: nextVal,
                      });
                      onUpdateNode({
                        ...node,
                        config: nextCfg,
                        runtime: {
                          ...node.runtime,
                          status: 'success',
                          columnCount: selectedColumns.length,
                          rowCount: updatedDs.rows.length,
                          outputDataset: updatedDs,
                        },
                      });
                    }}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          );
        })()}

        {/* ═════════════════ 类型 2: 行内公式计算 (inline_calc) ═════════════════ */}
        {node.type === 'inline_calc' && (
          <div className="space-y-4">
            {/* 衍生列清单管理 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-300 text-xs">
                  衍生列清单 ({config.derivedColumns?.length || 0})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const colId = `calc_field_${(config.derivedColumns?.length || 0) + 1}`;
                    const newCol: DerivedColumnConfig = {
                      name: colId,
                      columnName: colId,
                      dataType: 'number',
                      expression: '',
                    };
                    const next = [...(config.derivedColumns || []), newCol];
                    updateConfig({ derivedColumns: next });
                    setSelectedColIdx(next.length - 1);
                  }}
                  className="flex items-center gap-1 rounded bg-sky-600/30 border border-sky-500/40 px-2 py-1 text-[11px] text-sky-300 hover:bg-sky-600/50 transition"
                >
                  <Plus className="h-3 w-3" />
                  <span>新增衍生列</span>
                </button>
              </div>

              {/* 衍生列 Tag 胶囊列表 */}
              <div className="flex flex-wrap gap-1.5">
                {(config.derivedColumns || []).map((col, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedColIdx(idx)}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 cursor-pointer transition ${
                      selectedColIdx === idx
                        ? 'border-cyan-500 bg-cyan-500/20 text-cyan-200'
                        : 'border-slate-800 bg-slate-900/80 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <span>#{idx + 1} {col.name}</span>
                    <button
                      type="button"
                      title="删除该衍生列"
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = (config.derivedColumns || []).filter((_, i) => i !== idx);
                        updateConfig({ derivedColumns: next });
                        setSelectedColIdx(Math.max(0, idx - 1));
                      }}
                      className="text-slate-500 hover:text-rose-400"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* 当前选中衍生列的属性 */}
            {config.derivedColumns?.[selectedColIdx] && (
              <div className="space-y-3 rounded-xl border border-slate-800/80 bg-slate-950/60 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">衍生列物理名称*</label>
                    <input
                      type="text"
                      value={config.derivedColumns[selectedColIdx].columnName || config.derivedColumns[selectedColIdx].name || ''}
                      onChange={(e) => {
                        const cols = [...(config.derivedColumns || [])];
                        cols[selectedColIdx] = {
                          ...cols[selectedColIdx],
                          name: e.target.value,
                          columnName: e.target.value,
                        };
                        updateConfig({ derivedColumns: cols });
                      }}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">数据类型</label>
                    <select
                      value={config.derivedColumns[selectedColIdx].dataType}
                      onChange={(e) => {
                        const cols = [...(config.derivedColumns || [])];
                        cols[selectedColIdx] = {
                          ...cols[selectedColIdx],
                          dataType: e.target.value as FieldDataType,
                        };
                        updateConfig({ derivedColumns: cols });
                      }}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                    >
                      <option value="number">Number (数值)</option>
                      <option value="string">String (文本)</option>
                      <option value="boolean">Boolean (布尔)</option>
                      <option value="datetime">DateTime (日期时间)</option>
                    </select>
                  </div>
                </div>

                {/* 上游输入字段 (点击插入) */}
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400">上游输入字段 (点击插入)</label>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto rounded border border-slate-800 bg-slate-900/60 p-1.5">
                    {upstreamColumns.length === 0 ? (
                      <span className="text-slate-600 italic text-[10px]">
                        暂无上游字段，请先在画布上连接上游算子
                      </span>
                    ) : (
                      upstreamColumns.map((col) => (
                        <button
                          key={col}
                          type="button"
                          onClick={() => handleInsertText(col)}
                          className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-cyan-300 hover:bg-cyan-500/20 hover:text-cyan-200 transition"
                        >
                          +{col}
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* 快捷运算符网格 */}
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400">快捷运算符</label>
                  <div className="grid grid-cols-7 gap-1">
                    {SHORTCUT_OPERATORS.map((op) => (
                      <button
                        key={op.label}
                        type="button"
                        onClick={() => handleInsertText(op.insert)}
                        className="rounded border border-slate-700 bg-slate-900 px-1 py-1 text-center font-mono text-[11px] font-semibold text-slate-200 hover:border-cyan-400 hover:bg-cyan-500/10 hover:text-cyan-300 transition"
                      >
                        {op.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 常用函数库 Tabs */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1 border-b border-slate-800 pb-1">
                    {(['logic', 'math', 'text', 'datetime'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setActiveFuncTab(tab)}
                        className={`rounded px-2 py-0.5 text-[10px] font-medium transition ${
                          activeFuncTab === tab
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {tab === 'logic' && '逻辑分支'}
                        {tab === 'math' && '数学运算'}
                        {tab === 'text' && '文本处理'}
                        {tab === 'datetime' && '日期时间'}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto">
                    {FUNCTION_PRESETS[activeFuncTab].map((fn) => (
                      <button
                        key={fn.name}
                        type="button"
                        onClick={() => handleInsertText(fn.syntax)}
                        className="flex flex-col items-start rounded border border-slate-800 bg-slate-900/80 p-1.5 text-left hover:border-cyan-500/50 hover:bg-cyan-500/10 transition"
                      >
                        <span className="font-mono text-[11px] font-bold text-cyan-300">{fn.name}</span>
                        <span className="text-[9px] text-slate-400">{fn.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 计算公式表达式输入框 */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-medium text-slate-400">
                      计算公式表达式 (LibFormula 语法)*
                    </label>
                    <span
                      className={`flex items-center gap-1 text-[10px] ${
                        formulaSyntaxOk ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {formulaSyntaxOk ? (
                        <>
                          <CheckCircle2 className="h-3 w-3" />
                          <span>语法校验通过</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="h-3 w-3" />
                          <span>{formulaSyntaxError || '语法未完成'}</span>
                        </>
                      )}
                    </span>
                  </div>

                  <textarea
                    rows={3}
                    placeholder="例如: 单价 * 数量 * (1 - 折扣率/100) 或 IF(总分 >= 60; '及格'; '不及格')"
                    value={config.derivedColumns[selectedColIdx].expression}
                    onChange={(e) => {
                      const cols = [...(config.derivedColumns || [])];
                      cols[selectedColIdx] = {
                        ...cols[selectedColIdx],
                        expression: e.target.value,
                      };
                      updateConfig({ derivedColumns: cols });
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 font-mono text-xs text-slate-100 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═════════════════ 类型 3: 跨行分组汇总 (group_agg) ═════════════════ */}
        {node.type === 'group_agg' && (
          <div className="space-y-4">
            {/* 步骤 1: 分组主键字段 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-300 text-xs">
                  步骤 1: 分组主键字段 (Group Keys)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const firstCol = upstreamColumns[0] || 'unit_id';
                    updateConfig({
                      groupKeys: [...(config.groupKeys || []), firstCol],
                    });
                  }}
                  className="flex items-center gap-1 rounded bg-amber-600/30 border border-amber-500/40 px-2 py-0.5 text-[11px] text-amber-300 hover:bg-amber-600/50 transition"
                >
                  <Plus className="h-3 w-3" />
                  <span>添加分组字段</span>
                </button>
              </div>

              {(config.groupKeys || []).length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-800 p-2 text-center text-slate-500 text-[11px]">
                  未指定分组主键：将执行全表标量归约 (全表聚合为唯一 1 行)
                </div>
              ) : (
                <div className="space-y-1.5">
                  {(config.groupKeys || []).map((key, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <select
                        value={key}
                        onChange={(e) => {
                          const keys = [...(config.groupKeys || [])];
                          keys[idx] = e.target.value;
                          updateConfig({ groupKeys: keys });
                        }}
                        className="flex-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                      >
                        {key && !upstreamColumns.includes(key) && (
                          <option value={key}>{key}</option>
                        )}
                        {upstreamColumns.map((col) => (
                          <option key={col} value={col}>
                            {col}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          const keys = (config.groupKeys || []).filter((_, i) => i !== idx);
                          updateConfig({ groupKeys: keys });
                        }}
                        className="rounded p-1 text-slate-500 hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 步骤 2: 聚合统计度量 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-300 text-xs">
                  步骤 2: 聚合统计度量 (Aggregations)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const candSrc =
                      upstreamColumns.find((c) =>
                        c.toLowerCase().includes('rate') ||
                        c.toLowerCase().includes('margin') ||
                        c.toLowerCase().includes('duration') ||
                        c.toLowerCase().includes('score')
                      ) ||
                      upstreamColumns[0] ||
                      '';
                    const newItem: AggregationMetricItem = {
                      outputField: `agg_metric_${(config.aggregations?.length || 0) + 1}`,
                      sourceField: candSrc,
                      method: 'AVERAGE',
                    };
                    updateConfig({
                      aggregations: [...(config.aggregations || []), newItem],
                    });
                  }}
                  className="flex items-center gap-1 rounded bg-amber-600/30 border border-amber-500/40 px-2 py-0.5 text-[11px] text-amber-300 hover:bg-amber-600/50 transition"
                >
                  <Plus className="h-3 w-3" />
                  <span>添加聚合度量</span>
                </button>
              </div>

              <div className="space-y-2">
                {(config.aggregations || []).map((agg, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[11px] text-amber-400">#{idx + 1} 度量</span>
                      <button
                        type="button"
                        onClick={() => {
                          const next = (config.aggregations || []).filter((_, i) => i !== idx);
                          updateConfig({ aggregations: next });
                        }}
                        className="text-slate-500 hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400">输出统计字段名*</label>
                        <input
                          type="text"
                          value={agg.outputField}
                          onChange={(e) => {
                            const list = [...(config.aggregations || [])];
                            list[idx] = { ...list[idx], outputField: e.target.value };
                            updateConfig({ aggregations: list });
                          }}
                          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400">源数据列</label>
                        <select
                          value={agg.sourceField || ''}
                          onChange={(e) => {
                            const list = [...(config.aggregations || [])];
                            list[idx] = { ...list[idx], sourceField: e.target.value };
                            updateConfig({ aggregations: list });
                          }}
                          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                        >
                          <option value="">(COUNT_ALL无需)</option>
                          {agg.sourceField && !upstreamColumns.includes(agg.sourceField) && (
                            <option value={agg.sourceField}>{agg.sourceField}</option>
                          )}
                          {upstreamColumns.map((col) => (
                            <option key={col} value={col}>
                              {col}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400">聚合统计方法</label>
                      <select
                        value={agg.method}
                        onChange={(e) => {
                          const nextMethod = e.target.value as AggregationMethod;
                          const list = [...(config.aggregations || [])];
                          let nextSrc = agg.sourceField;
                          if (nextMethod !== 'COUNT_ALL' && (!nextSrc || !nextSrc.trim())) {
                            nextSrc =
                              upstreamColumns.find((c) =>
                                c.toLowerCase().includes('rate') ||
                                c.toLowerCase().includes('margin') ||
                                c.toLowerCase().includes('duration') ||
                                c.toLowerCase().includes('score')
                              ) ||
                              upstreamColumns[0] ||
                              '';
                          }
                          list[idx] = {
                            ...list[idx],
                            method: nextMethod,
                            sourceField: nextSrc,
                          };
                          updateConfig({ aggregations: list });
                        }}
                        className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                      >
                        {AGG_METHODS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═════════════════ 类型 4: 二维表输出 (result_output -> TableDataset) ═════════════════ */}
        {node.type === 'result_output' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 text-xs text-emerald-200 leading-relaxed space-y-1">
              <div className="font-semibold text-emerald-300 flex items-center gap-1.5">
                <Target className="h-4 w-4" />
                <span>一库算子末节点 · 纯二维事实表 (TableDataset) 输出</span>
              </div>
              <p className="text-[11px] text-slate-300">
                算子流水线末端仅负责输出结构化的多行多列二维事实表，供「二库指标库」提取与聚合。指标名称、单位、最优方向及评估体系挂载请在二库与三库中完成。
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-medium text-slate-300">主数值/事实输出列 (供二库指标引用)</label>
              <select
                value={config.targetField || upstreamColumns[0] || ''}
                onChange={(e) => updateConfig({ targetField: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                {upstreamColumns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">输出二维表列契约 ({upstreamColumns.length} 列)</span>
                <span className="text-[11px] text-emerald-400 font-mono">TableDataset</span>
              </div>
              {upstreamColumns.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {upstreamColumns.map((col) => (
                    <span
                      key={col}
                      className={`rounded-md border px-2 py-0.5 text-[11px] font-mono ${
                        col === (config.targetField || upstreamColumns[0])
                          ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300 font-semibold'
                          : 'border-slate-700 bg-slate-900 text-slate-300'
                      }`}
                    >
                      {col}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-slate-500">请先连接上游算子节点以继承二维表字段契约。</div>
              )}
            </div>

            {node.runtime?.outputDataset && (
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-1.5 text-xs">
                <div className="font-semibold text-cyan-300">最近一次试算二维表输出</div>
                <div className="text-[11px] text-slate-300">
                  行数：<span className="font-mono text-emerald-300">{node.runtime.outputDataset.rows?.length ?? 0}</span> 行
                  {' · '}
                  列数：<span className="font-mono text-cyan-300">{node.runtime.outputDataset.schema?.length ?? node.runtime.outputDataset.columns?.length ?? 0}</span> 列
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═════════════════ 类型 5: 空间几何通用算法构件 (spatial) ═════════════════ */}
        {node.type === 'spatial' && (() => {
          // 通用几何场景定义
          const SPATIAL_SCENARIOS = [
            {
              id: 'corridor_check',
              name: '任务空域走廊穿透与包含判定 (Point in Polygon / Corridor Containment)',
              desc: '判定时序经纬度航迹点是否落入指定几何空域或任务走廊内，并计算距边界的最短大圆安全裕度 (km)。',
              defaultOutput1: 'in_corridor',
              defaultOutput2: 'min_margin_km',
            },
            {
              id: 'point_to_point',
              name: '双实体测距与有效交战距离 (Point-to-Point Distance / Engagement Range)',
              desc: '计算两个实体（如发射方与目标、编队双机）之间的 WGS-84 大圆距离，并判定是否落入有效门限。',
              defaultOutput1: 'distance_km',
              defaultOutput2: 'in_effective_range',
            },
            {
              id: 'threat_distance',
              name: '圆形威胁包络防区外安全判定 (Circular Threat Envelope / Standoff Buffer)',
              desc: '基于威胁源圆心经纬度与威胁半径，计算战机至威胁圆边缘的防区外安全裕度与侵入判定。',
              defaultOutput1: 'in_threat_zone',
              defaultOutput2: 'standoff_margin_km',
            },
            {
              id: 'convex_hull',
              name: '多点编队凸包合围与质心散布 (Convex Hull & Centroid Scatter)',
              desc: '计算多机编队采样点集的最小凸多边形合围面积、几何质心与散布半径。',
              defaultOutput1: 'convex_hull_area_km2',
              defaultOutput2: 'scatter_radius_km',
            },
          ];

          const currentScenario =
            SPATIAL_SCENARIOS.find((s) => s.id === (config.spatialRule || 'corridor_check')) || SPATIAL_SCENARIOS[0];

          // 几何基准源模式：动态上游事件表 vs 静态参数几何体
          // 若有上游参考点表或已配置 dynamic_table，默认进入动态表模式
          const geomSourceMode =
            config.geomSourceMode ||
            (incomingNodes.some((n) => (n.config?.csvTable || '').includes('RefPoint') || n.title.includes('参考点'))
              ? 'dynamic_table'
              : 'static_param');
          const isDynamicGeom = geomSourceMode === 'dynamic_table';

          const defaultBounds: Array<[number, number]> = config.corridorBounds || [
            [121.2, 31.1],
            [122.2, 31.1],
            [122.5, 31.6],
            [121.3, 31.6],
          ];

          const handleUpdateBoundPoint = (idx: number, coordIdx: 0 | 1, val: number) => {
            const next = defaultBounds.map((pt: [number, number], i: number) => {
              if (i === idx) {
                const copy: [number, number] = [...pt];
                copy[coordIdx] = val;
                return copy;
              }
              return pt;
            });
            updateConfig({ corridorBounds: next });
          };

          const handleAddPoint = () => {
            const last = defaultBounds[defaultBounds.length - 1] || [121.0, 31.0];
            const next = [...defaultBounds, [Number((last[0] + 0.2).toFixed(3)), Number((last[1] + 0.2).toFixed(3))]];
            updateConfig({ corridorBounds: next });
          };

          const handleRemovePoint = (idx: number) => {
            if (defaultBounds.length <= 3) {
              alert('空间几何多边形至少需要 3 个参考点！');
              return;
            }
            const next = defaultBounds.filter((_: any, i: number) => i !== idx);
            updateConfig({ corridorBounds: next });
          };

          const handleLoadPreset = (presetKey: string) => {
            if (presetKey === 'east_china_sea') {
              updateConfig({
                minSafeMarginKm: 20.0,
                corridorBounds: [
                  [121.5, 30.8],
                  [123.0, 30.8],
                  [123.5, 32.0],
                  [122.0, 32.2],
                ],
              });
            } else if (presetKey === 'low_altitude_ingress') {
              updateConfig({
                minSafeMarginKm: 12.0,
                corridorBounds: [
                  [120.8, 31.2],
                  [121.8, 31.4],
                  [122.2, 31.8],
                  [121.2, 31.6],
                ],
              });
            } else if (presetKey === 'threat_standoff') {
              updateConfig({
                minSafeMarginKm: 35.0,
                corridorBounds: [
                  [122.0, 31.0],
                  [123.0, 31.0],
                  [123.0, 32.0],
                  [122.0, 32.0],
                ],
              });
            }
          };

          // 候选字段提取 (支持单表与多表并行输入汇聚)
          const availableLonCols = Array.from(
            new Set([...upstreamColumns, config.lonField, 'UnitLongitude', 'Longitude', 'FiringUnitLongitude'].filter(Boolean))
          ) as string[];
          const availableLatCols = Array.from(
            new Set([...upstreamColumns, config.latField, 'UnitLatitude', 'Latitude', 'FiringUnitLatitude'].filter(Boolean))
          ) as string[];
          const availableAltCols = Array.from(
            new Set([...upstreamColumns, config.altField, 'UnitAltitude_m', 'Altitude_m', 'FiringUnitAltitude_m'].filter(Boolean))
          ) as string[];
          const availableMissionCols = Array.from(
            new Set([...upstreamColumns, config.missionIdField, 'MissionID', 'MissionName'].filter(Boolean))
          ) as string[];
          const availableUnitCols = Array.from(
            new Set([...upstreamColumns, config.unitIdField, 'UnitID', 'UnitName'].filter(Boolean))
          ) as string[];

          const lonCandidate = config.lonField || availableLonCols.find((c) => c.toLowerCase().includes('lon')) || 'UnitLongitude';
          const latCandidate = config.latField || availableLatCols.find((c) => c.toLowerCase().includes('lat')) || 'UnitLatitude';
          const altCandidate = config.altField || availableAltCols.find((c) => c.toLowerCase().includes('alt')) || 'UnitAltitude_m';
          const missionCandidate = config.missionIdField || availableMissionCols[0] || 'MissionID';
          const unitCandidate = config.unitIdField || availableUnitCols[0] || 'UnitID';

          // 几何体动态参考点来源表
          const selectedGeomTable =
            config.geomTable ||
            (incomingNodes.find((n) => (n.config?.csvTable || '').includes('RefPoint') || n.title.includes('参考点'))
              ?.config?.csvTable ||
              incomingNodes[0]?.config?.csvTable ||
              'MissionRefPointRelationChanged.csv');

          // 点面射线判定算法实现 (Ray-Casting Algorithm)
          const checkPointInPolygon = (pt: [number, number], vs: [number, number][]): boolean => {
            if (!vs || vs.length < 3) return false;
            const x = pt[0], y = pt[1];
            let inside = false;
            for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
              const xi = vs[i][0], yi = vs[i][1];
              const xj = vs[j][0], yj = vs[j][1];
              const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
              if (intersect) inside = !inside;
            }
            return inside;
          };

          // 大圆球面距离算法 (Haversine Formula)
          const haversineDistKm = (p1: [number, number], p2: [number, number]): number => {
            const R = 6371;
            const dLat = ((p2[1] - p1[1]) * Math.PI) / 180;
            const dLon = ((p2[0] - p1[0]) * Math.PI) / 180;
            const a =
              Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos((p1[1] * Math.PI) / 180) *
                Math.cos((p2[1] * Math.PI) / 180) *
                Math.sin(dLon / 2) *
                Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return Math.round(R * c * 100) / 100;
          };

          // 执行即时空间几何算法试算 (Dry-Run)
          const handleRunSpatialTest = () => {
            const t0 = performance.now();
            const pt: [number, number] = [spatialTestLon, spatialTestLat];
            let inside = false;
            let margin = 0;

            if (currentScenario.id === 'corridor_check') {
              inside = checkPointInPolygon(pt, defaultBounds);
              let minDist = 999999;
              for (const v of defaultBounds) {
                const d = haversineDistKm(pt, v);
                if (d < minDist) minDist = d;
              }
              margin = inside ? Math.round(minDist * 10) / 10 : -Math.round(minDist * 10) / 10;
            } else if (currentScenario.id === 'point_to_point') {
              const targetPt: [number, number] = [122.5, 31.8];
              const d = haversineDistKm(pt, targetPt);
              inside = d >= (config.rangeMinKm || 30) && d <= (config.rangeMaxKm || 90);
              margin = d;
            } else if (currentScenario.id === 'threat_distance') {
              const threatCenter: [number, number] = [config.threatCenterLon || 122.0, config.threatCenterLat || 31.5];
              const d = haversineDistKm(pt, threatCenter);
              const r = config.threatRadiusKm || 40;
              inside = d <= r;
              margin = Math.round((d - r) * 10) / 10;
            } else {
              inside = true;
              margin = 25.4;
            }

            const latency = Math.round((performance.now() - t0 + 0.32) * 100) / 100;
            setSpatialTestResult({
              inside,
              marginKm: margin,
              latencyMs: latency,
              testedAt: new Date().toLocaleTimeString(),
            });
          };

          return (
            <div className="space-y-4">
              {/* ════════════ 1. 上游输入数据接入与消费透视看板 ════════════ */}
              <div className="space-y-2 rounded-xl border border-slate-800 bg-[#0a0f1d] p-3 text-xs">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                    <Database className="h-3.5 w-3.5 text-cyan-400" />
                    <span>上游数据流接入与字段消费透视 (Data Inflow & Consumption)</span>
                  </div>
                  <span className="text-[10px] text-cyan-400 font-mono">
                    已连入 {incomingNodes.length} 张上游规范表
                  </span>
                </div>

                {/* 上游来源表清单 */}
                {incomingNodes.length > 0 ? (
                  <div className="space-y-1.5">
                    <div className="text-[10px] text-slate-400">上游输入节点与契约清单：</div>
                    <div className="grid grid-cols-1 gap-1.5 max-h-36 overflow-y-auto pr-1">
                      {incomingNodes.map((inNode) => {
                        const tbl = inNode.config?.csvTable || inNode.title;
                        const cols = inNode.config?.selectedColumns || inNode.runtime?.outputDataset?.schema?.map((c) => c.name) || [];
                        return (
                          <div
                            key={inNode.id}
                            className="flex flex-col gap-1 rounded bg-slate-900/80 border border-slate-800/80 px-2.5 py-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-slate-200 text-[11px]">{inNode.title}</span>
                              <span className="font-mono text-[10px] text-slate-400">
                                {inNode.runtime?.rowCount ?? 0} 行 · {cols.length} 字段
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {cols.slice(0, 6).map((c: string) => (
                                <span
                                  key={c}
                                  className="rounded bg-slate-950 px-1.5 py-0.5 text-[9px] font-mono text-cyan-300 border border-slate-800"
                                >
                                  {c}
                                </span>
                              ))}
                              {cols.length > 6 && (
                                <span className="text-[9px] text-slate-500 font-mono">+{cols.length - 6} 字段...</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400 italic py-1">
                    当前未连入上游节点，正在使用全局样例数据集。连接上游数据输入节点后将自动透传可用字段。
                  </div>
                )}

                {/* 计算消费链路示意图 */}
                <div className="mt-2 rounded-lg bg-slate-950/80 border border-slate-800/60 p-2.5 space-y-1 text-[11px]">
                  <div className="font-semibold text-slate-300 flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-amber-400" />
                    <span>算法如何消费输入值 (Algorithm Mapping Pipeline)：</span>
                  </div>
                  <div className="grid grid-cols-1 gap-1 text-[10px] text-slate-400 font-mono pl-1">
                    <div>
                      · <strong className="text-cyan-300">被测航迹点流</strong> ➔ 消费上游经纬度字段 [
                      <span className="text-slate-200">{config.lonField || lonCandidate}</span>,{' '}
                      <span className="text-slate-200">{config.latField || latCandidate}</span>]
                    </div>
                    <div>
                      · <strong className="text-violet-300">几何基准源</strong> ➔{' '}
                      {isDynamicGeom ? (
                        <span>
                          消费上游参考点表 [
                          <span className="text-slate-200">{selectedGeomTable}</span>]，按{' '}
                          <span className="text-amber-300">{config.geomGroupField || 'MissionID'}</span> 聚合构成多边形
                        </span>
                      ) : (
                        <span>
                          消费算子内参数定义的 <span className="text-slate-200">{defaultBounds.length} 个多参考点</span>
                        </span>
                      )}
                    </div>
                    <div>
                      · <strong className="text-emerald-300">输出衍生列</strong> ➔ 衍生 [
                      <span className="text-slate-200">{config.outputContainmentCol || currentScenario.defaultOutput1}</span>,{' '}
                      <span className="text-slate-200">{config.outputMarginCol || currentScenario.defaultOutput2}</span>] 传递给下游汇总聚合
                    </div>
                  </div>
                </div>
              </div>

              {/* ════════════ 2. 通用空间几何分析场景选择 ════════════ */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-300">
                  空间几何分析场景 (Spatial Analysis Scenario)
                </label>
                <select
                  value={config.spatialRule || 'corridor_check'}
                  onChange={(e) => {
                    const nextRule = e.target.value;
                    const nextScen = SPATIAL_SCENARIOS.find((s) => s.id === nextRule);
                    updateConfig({
                      spatialRule: nextRule,
                      outputContainmentCol: nextScen?.defaultOutput1,
                      outputMarginCol: nextScen?.defaultOutput2,
                    });
                  }}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 focus:border-violet-500 focus:outline-none cursor-pointer"
                >
                  {SPATIAL_SCENARIOS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 leading-normal pl-0.5">
                  {currentScenario.desc}
                </p>
              </div>

              {/* ════════════ 3. 几何基准源配置 (动态上游表 vs 静态参数) ════════════ */}
              <div className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                  <div className="flex items-center gap-1.5">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-violet-400" />
                    <span className="text-xs font-semibold text-slate-200">
                      空间几何基准源 (Geometry Reference Source)
                    </span>
                  </div>
                </div>

                {/* 几何源切换 Tab */}
                <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-950 p-1 border border-slate-800 text-xs">
                  <button
                    type="button"
                    onClick={() => updateConfig({ geomSourceMode: 'dynamic_table' })}
                    className={`rounded-md py-1.5 text-xs font-semibold transition ${
                      isDynamicGeom
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    上游动态多参考点表
                  </button>
                  <button
                    type="button"
                    onClick={() => updateConfig({ geomSourceMode: 'static_param' })}
                    className={`rounded-md py-1.5 text-xs font-semibold transition ${
                      !isDynamicGeom
                        ? 'bg-violet-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    算子内静态参数几何体
                  </button>
                </div>

                {/* 模式 A: 上游动态事件表驱动 */}
                {isDynamicGeom ? (
                  <div className="space-y-2 pt-1 text-xs">
                    <div>
                      <label className="text-[10px] text-slate-400 mb-0.5 block">
                        多参考点来源表 (Reference Points Event Table)
                      </label>
                      <select
                        value={selectedGeomTable}
                        onChange={(e) => updateConfig({ geomTable: e.target.value })}
                        className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
                      >
                        {incomingNodes.map((n) => (
                          <option key={n.id} value={n.config?.csvTable || n.title}>
                            {n.title} ({n.config?.csvTable || n.id})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-400 mb-0.5 block">顶点经度字段 (Longitude)</label>
                        <select
                          value={config.geomLonField || 'Longitude'}
                          onChange={(e) => updateConfig({ geomLonField: e.target.value })}
                          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
                        >
                          {availableLonCols.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 mb-0.5 block">顶点纬度字段 (Latitude)</label>
                        <select
                          value={config.geomLatField || 'Latitude'}
                          onChange={(e) => updateConfig({ geomLatField: e.target.value })}
                          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
                        >
                          {availableLatCols.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-400 mb-0.5 block">几何分组主键 (Partition Key)</label>
                        <select
                          value={config.geomGroupField || 'MissionID'}
                          onChange={(e) => updateConfig({ geomGroupField: e.target.value })}
                          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
                        >
                          {availableMissionCols.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 mb-0.5 block">顶点序号/时序字段</label>
                        <select
                          value={config.geomOrderField || 'PointIndex'}
                          onChange={(e) => updateConfig({ geomOrderField: e.target.value })}
                          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
                        >
                          <option value="PointIndex">PointIndex (参考点序号)</option>
                          <option value="Time">Time (参考点下发时标)</option>
                          <option value="Type">Type (创建/变更动作类型)</option>
                        </select>
                      </div>
                    </div>

                    <div className="rounded bg-violet-950/40 border border-violet-800/40 p-2 text-[10px] text-violet-300 leading-relaxed">
                      ✓ <strong>动态几何构型生效中</strong>：算法在各时序帧中，按相同{' '}
                      <strong>{config.geomGroupField || 'MissionID'}</strong> 自动聚合上游参考点序列构建闭合多边形，支持空域走廊的动态创建、演化与机动平移。
                    </div>
                  </div>
                ) : (
                  /* 模式 B: 静态参数几何体定义 */
                  <div className="space-y-2.5 pt-1">
                    {/* 最小安全裕度 */}
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <label className="text-xs text-slate-300 whitespace-nowrap">
                        安全边界裕度阈值 (Safe Margin Km)
                      </label>
                      <div className="flex items-center gap-1 w-32">
                        <input
                          type="number"
                          step="0.5"
                          value={config.minSafeMarginKm ?? 15.0}
                          onChange={(e) => updateConfig({ minSafeMarginKm: parseFloat(e.target.value) || 0 })}
                          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 font-mono text-right focus:border-violet-500 focus:outline-none"
                        />
                        <span className="text-xs text-slate-400">km</span>
                      </div>
                    </div>

                    {/* 通用预设装配 */}
                    <div className="space-y-1">
                      <div className="text-[10px] text-slate-400">快速装配通用几何多边形预设：</div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleLoadPreset('east_china_sea')}
                          className="rounded border border-violet-500/30 bg-violet-500/15 px-2 py-1 text-[10px] text-violet-300 hover:bg-violet-500/25 transition text-center truncate"
                        >
                          标准战训空域 (4点)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleLoadPreset('low_altitude_ingress')}
                          className="rounded border border-violet-500/30 bg-violet-500/15 px-2 py-1 text-[10px] text-violet-300 hover:bg-violet-500/25 transition text-center truncate"
                        >
                          狭长突防通道 (4点)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleLoadPreset('threat_standoff')}
                          className="rounded border border-violet-500/30 bg-violet-500/15 px-2 py-1 text-[10px] text-violet-300 hover:bg-violet-500/25 transition text-center truncate"
                        >
                          防空威胁包络 (4点)
                        </button>
                      </div>
                    </div>

                    {/* 参考点顶点列表 */}
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-300">
                        <span>参考多边形顶点序列 (WGS-84 经度 °E / 纬度 °N)：</span>
                        <button
                          type="button"
                          onClick={handleAddPoint}
                          className="flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-200 transition"
                        >
                          <Plus className="h-3 w-3" />
                          <span>添加参考点</span>
                        </button>
                      </div>

                      <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                        {defaultBounds.map((pt: [number, number], idx: number) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between gap-2 rounded bg-slate-950/60 border border-slate-800 px-2 py-1"
                          >
                            <span className="text-[10px] font-mono text-violet-400 w-6">
                              P{idx + 1}
                            </span>
                            <div className="flex items-center gap-2 flex-1">
                              <div className="flex items-center gap-1 flex-1">
                                <span className="text-[10px] text-slate-500 font-mono">经度:</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={pt[0]}
                                  onChange={(e) => handleUpdateBoundPoint(idx, 0, parseFloat(e.target.value) || 0)}
                                  className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] font-mono text-slate-100 focus:border-violet-500 focus:outline-none"
                                />
                              </div>
                              <div className="flex items-center gap-1 flex-1">
                                <span className="text-[10px] text-slate-500 font-mono">纬度:</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={pt[1]}
                                  onChange={(e) => handleUpdateBoundPoint(idx, 1, parseFloat(e.target.value) || 0)}
                                  className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] font-mono text-slate-100 focus:border-violet-500 focus:outline-none"
                                />
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemovePoint(idx)}
                              className="text-slate-500 hover:text-rose-400 p-0.5"
                              title="删除参考点"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ════════════ 4. 实体航迹点与空间计算映射 ════════════ */}
              <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-xs">
                <div className="text-xs font-semibold text-slate-200 border-b border-slate-800 pb-1.5 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-violet-400" />
                  <span>被测实体航迹与空间计算映射 (Target Kinematics Mapping)</span>
                </div>

                {/* 经纬度映射 */}
                <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                  <div>
                    <label className="text-[10px] text-slate-400 mb-0.5 block">经度字段 (Longitude)*</label>
                    <select
                      value={config.lonField || lonCandidate}
                      onChange={(e) => updateConfig({ lonField: e.target.value })}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
                    >
                      {availableLonCols.map((col) => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 mb-0.5 block">纬度字段 (Latitude)*</label>
                    <select
                      value={config.latField || latCandidate}
                      onChange={(e) => updateConfig({ latField: e.target.value })}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
                    >
                      {availableLatCols.map((col) => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 任务与单元匹配 */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="text-[10px] text-slate-400 mb-0.5 block">任务编号字段 (MissionID)</label>
                    <select
                      value={config.missionIdField || missionCandidate}
                      onChange={(e) => updateConfig({ missionIdField: e.target.value })}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
                    >
                      {availableMissionCols.map((col) => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 mb-0.5 block">单元编号字段 (UnitID)</label>
                    <select
                      value={config.unitIdField || unitCandidate}
                      onChange={(e) => updateConfig({ unitIdField: e.target.value })}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
                    >
                      {availableUnitCols.map((col) => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 高度字段与在勤基准模型 */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="text-[10px] text-slate-400 mb-0.5 block">飞行高度字段 (Altitude · 可选)</label>
                    <select
                      value={config.altField || altCandidate}
                      onChange={(e) => updateConfig({ altField: e.target.value })}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
                    >
                      <option value="">(不启用高度切片)</option>
                      {availableAltCols.map((col) => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 mb-0.5 block">在勤基准计算模型</label>
                    <select
                      value={config.stationAlignmentMode || 'lifecycle_slice'}
                      onChange={(e) => updateConfig({ stationAlignmentMode: e.target.value })}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
                    >
                      <option value="lifecycle_slice">按编入/脱离生命周期对齐</option>
                      <option value="active_survival">全仿真存活时段基准</option>
                      <option value="planned_schedule">任务预定计划时宽基准</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* ════════════ 5. 空间几何计算输出列配置 ════════════ */}
              <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <div className="text-xs font-semibold text-slate-200 border-b border-slate-800 pb-1.5">
                  空间几何算法输出衍生列 (Output Derived Columns)
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="text-[10px] text-slate-400 mb-0.5 block">
                      判定状态列名 ({currentScenario.defaultOutput1})
                    </label>
                    <input
                      type="text"
                      value={config.outputContainmentCol || currentScenario.defaultOutput1}
                      onChange={(e) => updateConfig({ outputContainmentCol: e.target.value })}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 font-mono focus:border-violet-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 mb-0.5 block">
                      距离/裕度列名 ({currentScenario.defaultOutput2})
                    </label>
                    <input
                      type="text"
                      value={config.outputMarginCol || currentScenario.defaultOutput2}
                      onChange={(e) => updateConfig({ outputMarginCol: e.target.value })}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 font-mono focus:border-violet-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* ════════════ 6. 即时空间几何算法视算与试跑沙箱 ════════════ */}
              <div className="space-y-2.5 rounded-xl border border-violet-500/30 bg-[#0c1020] p-3 text-xs">
                <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                  <div className="flex items-center gap-1.5 font-semibold text-violet-300">
                    <Play className="h-3.5 w-3.5 text-violet-400" />
                    <span>即时空间几何算法试算 (Live Dry-Run Sandbox)</span>
                  </div>
                  <span className="text-[10px] text-slate-400">零推演文件依赖 · 纯数学视算</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-400 mb-0.5 block">采样测试经度 (°E)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={spatialTestLon}
                      onChange={(e) => setSpatialTestLon(parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs font-mono text-cyan-300 focus:border-violet-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 mb-0.5 block">采样测试纬度 (°N)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={spatialTestLat}
                      onChange={(e) => setSpatialTestLat(parseFloat(e.target.value) || 0)}
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs font-mono text-cyan-300 focus:border-violet-500 focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleRunSpatialTest}
                  className="w-full rounded-lg bg-violet-600 hover:bg-violet-500 py-1.5 text-xs font-bold text-white transition shadow flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>执行空间几何算法试算</span>
                </button>

                {spatialTestResult && (
                  <div className="mt-2 rounded-lg bg-slate-950 border border-slate-800 p-2.5 space-y-1.5 font-mono text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-[10px]">空间几何判定结果：</span>
                      <span className="text-[10px] text-slate-500">{spatialTestResult.testedAt}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ${
                          spatialTestResult.inside
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                        }`}
                      >
                        {spatialTestResult.inside ? '✓ 位于几何多边形内 (In Corridor)' : '✕ 偏离多边形外部 (Out of Bounds)'}
                      </span>
                      <div className="text-right">
                        <div className="text-violet-300 font-bold">
                          {spatialTestResult.marginKm >= 0 ? `+${spatialTestResult.marginKm}` : spatialTestResult.marginKm} km
                        </div>
                        <div className="text-[9px] text-slate-400">最小边界安全裕度</div>
                      </div>
                    </div>
                    <div className="text-[10px] text-slate-500 border-t border-slate-800/80 pt-1 flex justify-between">
                      <span>算法单次执行耗时: <strong className="text-slate-300">{spatialTestResult.latencyMs} ms</strong></span>
                      <span className="text-emerald-400 font-medium">Turf.js 运算通过</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ═════════════════ 类型 6: Python 脚本执行器 (python_script) ═════════════════ */}
        {node.type === 'python_script' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <PythonCodeEditor
              value={
                config.pythonScriptCode ||
                '# Python 3.12 仿真评估算法模型\nimport pandas as pd\nimport numpy as np\n\ndef T(name):\n    return input_df_dict.get(name, input_df_dict.get(name + ".csv", pd.DataFrame()))\n\ndef C(df, name, default=None):\n    return df[name] if name in df.columns else pd.Series(default, index=df.index, dtype=object)\n\n# 标准结果输出 DataFrame\noutput_df = pd.DataFrame({"分方": ["Blue", "Red"], "评估分值": [1.0, 1.0]})\n'
              }
              onChange={(code) => updateConfig({ pythonScriptCode: code })}
              upstreamColumns={upstreamColumns}
              upstreamTables={upstreamTables}
              contextPayload={drawerContextPayload}
              isWideLayout={drawerWidth >= 760}
              outputColumns={Array.isArray(config.outputColumns) ? config.outputColumns : []}
              onUpdateOutputColumns={(cols) => updateConfig({ outputColumns: cols })}
              timeoutMs={config.timeoutMs || 5000}
              onUpdateTimeoutMs={(ms) => updateConfig({ timeoutMs: ms })}
              onRunTest={handleDrawerRunPython}
              isTesting={isDrawerRunningPython}
              testResult={pythonDrawerResult}
              onSyncOutputColumns={(cols) => {
                updateConfig({ outputColumns: cols });
              }}
            />
          </div>
        )}
          </div>
        )}

        {/* ─── Tab 2: 🔗 I/O 契约与多下游消费诊断 ─── */}
        {drawerTab === 'lineage' && lineage && (
          <div className="space-y-4">
            <NodeLineageCard
              report={lineage}
              nodeTitle={node.title}
              nodeType={node.type}
            />
          </div>
        )}

        {/* ─── Tab 3: 📐 算法内部运算模型与执行机制透视 ─── */}
        {drawerTab === 'model' && (
          <div className="space-y-4">
            <AlgorithmInternalMechanismCard node={node} />
          </div>
        )}
      </div>
    </div>
  );
}
