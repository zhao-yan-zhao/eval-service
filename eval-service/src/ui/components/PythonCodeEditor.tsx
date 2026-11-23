import React, { useEffect, useRef, useState, useMemo } from 'react';
import { basicSetup, EditorView } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Code2,
  Copy,
  Database,
  ExternalLink,
  HelpCircle,
  Layers,
  Maximize2,
  Minimize2,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Table,
  Target,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import { evalApi } from '../api.ts';
import { AlgorithmOutputVisualizer } from './AlgorithmOutputVisualizer.tsx';

export interface UpstreamTableColumn {
  name: string;
  type?: string;
  desc?: string;
  sampleValues?: any[];
}

export interface UpstreamTableItem {
  id: string;
  label: string;
  tableName: string;
  isRawTable?: boolean;
  columns: UpstreamTableColumn[];
}

export interface PythonCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  height?: string;
  readOnly?: boolean;
  upstreamColumns?: string[];
  upstreamTables?: UpstreamTableItem[];
  contextPayload?: Record<string, unknown>;
  placeholder?: string;
  enableFullscreenModal?: boolean;
  isWideLayout?: boolean;
  outputColumns?: string[];
  onUpdateOutputColumns?: (columns: string[]) => void;
  timeoutMs?: number;
  onUpdateTimeoutMs?: (ms: number) => void;
  onRunTest?: () => void;
  isTesting?: boolean;
  testResult?: {
    status: 'success' | 'error';
    output?: any;
    stdout?: string;
    stderr?: string;
    latencyMs?: number;
    errorLine?: number;
  } | null;
  onSyncOutputColumns?: (columns: string[]) => void;
}

// 基础静态语法与结构守卫校验
function analyzePythonScript(code: string): {
  valid: boolean;
  mode: 'dataframe' | 'evaluate' | 'unknown';
  error?: string;
} {
  if (!code.trim()) {
    return { valid: false, mode: 'unknown', error: '算法代码不能为空' };
  }
  const hasEvaluateFn = code.includes('def evaluate(context):') || code.includes('def evaluate(context) :');
  const hasDataFrameOutput = /\boutput_df\s*=/.test(code) || /\bresult\s*=/.test(code);

  if (hasDataFrameOutput) {
    const parenCheck = checkParentheses(code);
    if (!parenCheck.valid) {
      return { valid: false, mode: 'dataframe', error: parenCheck.error };
    }
    return { valid: true, mode: 'dataframe' };
  }

  if (hasEvaluateFn) {
    if (!code.includes('return')) {
      return { valid: false, mode: 'evaluate', error: '入口函数必须包含 return 返回计算结果字典' };
    }
    const parenCheck = checkParentheses(code);
    if (!parenCheck.valid) {
      return { valid: false, mode: 'evaluate', error: parenCheck.error };
    }
    return { valid: true, mode: 'evaluate' };
  }

  return { valid: false, mode: 'unknown', error: '需给 output_df 赋值 DataFrame 产出或定义 def evaluate(context):' };
}

function checkParentheses(code: string): { valid: boolean; error?: string } {
  const stack: string[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  let inString: string | null = null;
  let inComment = false;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '\n') {
      inComment = false;
      continue;
    }
    if (inComment) continue;

    if (ch === '#' && !inString) {
      inComment = true;
      continue;
    }

    if ((ch === '"' || ch === "'") && code[i - 1] !== '\\') {
      if (inString === ch) {
        inString = null;
      } else if (!inString) {
        inString = ch;
      }
      continue;
    }

    if (inString) continue;

    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push(ch);
    } else if (ch === ')' || ch === ']' || ch === '}') {
      const expected = pairs[ch];
      const actual = stack.pop();
      if (actual !== expected) {
        return { valid: false, error: `括号不匹配: 遇到 '${ch}' 但未找到对应的 '${expected}'` };
      }
    }
  }

  if (stack.length > 0) {
    return { valid: false, error: `存在未闭合的括号: '${stack[stack.length - 1]}'` };
  }

  return { valid: true };
}

/**
 * 实时从 Python 源码中静态推断 output_df 所包含的数据列契约
 * 兼容模式：
 * 1. COLS / OUTPUT_COLS = ['列1', '列2', ...] 显式列清单
 * 2. output_df = pd.DataFrame({'列1': ..., '列2': ...}) 字典构造
 * 3. output_df = df[['列1', '列2']] 切片投影
 * 4. output_df['列名'] = ... 逐列直接赋值
 * 5. out.groupby('分方').agg(平均完成比=(...), ...) 分组聚合命名元组
 * 6. return { "列1": ..., "列2": ... } 或 result = { ... } 标量/结构化字典返回
 */
export function inferOutputColumnsFromPythonCode(code: string): string[] {
  if (!code || !code.trim()) return [];
  const cols = new Set<string>();

  // 1. 匹配 COLS = [...] 或 OUTPUT_COLS = [...] 或 TARGET_COLS = [...]
  const colsListMatch = code.match(/(?:COLS|OUTPUT_COLS|TARGET_COLUMNS|COLUMNS)\s*=\s*\[([\s\S]*?)\]/i);
  if (colsListMatch && colsListMatch[1]) {
    const items = colsListMatch[1].match(/['"][^'"]+['"]/g);
    if (items && items.length > 0) {
      items.forEach((item) => {
        const clean = item.replace(/['"]/g, '').trim();
        if (clean) cols.add(clean);
      });
      if (cols.size > 0) return Array.from(cols);
    }
  }

  // 2. 匹配 output_df = pd.DataFrame({...}) 字典键名
  const dfDictMatch = code.match(/output_df\s*=\s*pd\.DataFrame\s*\(\s*\{([\s\S]*?)\}\s*\)/);
  if (dfDictMatch && dfDictMatch[1]) {
    const keys = dfDictMatch[1].match(/['"][^'"]+['"]\s*:/g);
    if (keys && keys.length > 0) {
      keys.forEach((k) => {
        const clean = k.replace(/['":\s]/g, '').trim();
        if (clean) cols.add(clean);
      });
      if (cols.size > 0) return Array.from(cols);
    }
  }

  // 3. 匹配 output_df = ...[['列1', '列2', ...]]
  const subsetMatch = code.match(/output_df\s*=\s*[\w\.]+\s*\[\s*\[([\s\S]*?)\]\s*\]/);
  if (subsetMatch && subsetMatch[1]) {
    const items = subsetMatch[1].match(/['"][^'"]+['"]/g);
    if (items && items.length > 0) {
      items.forEach((item) => {
        const clean = item.replace(/['"]/g, '').trim();
        if (clean) cols.add(clean);
      });
      if (cols.size > 0) return Array.from(cols);
    }
  }

  // 4. 匹配 output_df["列名"] = ...
  const directAssignMatches = code.matchAll(/output_df\s*\[\s*['"]([^'"]+)['"]\s*\]\s*=/g);
  for (const m of directAssignMatches) {
    if (m[1]) cols.add(m[1].trim());
  }

  // 5. 匹配 groupby(...).agg(列1=(...), 列2=(...))
  const aggMatches = code.matchAll(/\.agg\s*\(([\s\S]*?)\)/g);
  for (const agg of aggMatches) {
    if (agg[1]) {
      const namedArgs = agg[1].matchAll(/([a-zA-Z_\u4e00-\u9fa5][\w\u4e00-\u9fa5]*)\s*=/g);
      for (const na of namedArgs) {
        if (na[1] && !['dropna', 'as_index'].includes(na[1])) {
          cols.add(na[1].trim());
        }
      }
    }
  }
  const groupbyMatch = code.match(/\.groupby\s*\(\s*['"]([^'"]+)['"]/);
  if (groupbyMatch && groupbyMatch[1]) {
    cols.add(groupbyMatch[1].trim());
  }

  // 6. 匹配 return { "列1": ..., "列2": ... } 或 result = { ... } 字典键名 (适配单点 evaluate 算法与传统字典产出)
  const dictMatches = code.matchAll(/(?:return|result|output_dict|res)\s*=?\s*\{([\s\S]*?)\}/g);
  for (const dm of dictMatches) {
    if (dm[1]) {
      const keys = dm[1].matchAll(/['"]([^'"]+)['"]\s*:/g);
      for (const k of keys) {
        if (k[1]) {
          const clean = k[1].trim();
          if (clean && !clean.startsWith('__')) {
            cols.add(clean);
          }
        }
      }
    }
  }

  return Array.from(cols);
}

// 针对推演评估场景的军事实战常用算法片段
const COMMON_SNIPPETS = [
  {
    category: '1. 作战实体与时序清洗',
    items: [
      {
        label: 'T("表名") 安全导表',
        desc: '安全读取上游输入底表 (支持 .csv 后缀容错)',
        code: 'missions_df = T("MissionChanged")\nlosses_df = T("Losses")\n',
      },
      {
        label: 'C(df, "列名") 安全取列',
        desc: '安全读取字段列，缺列时自动返回兜底 Series',
        code: 'speed = C(df, "FiringUnitSpeed_kts", default=0.0)\n',
      },
      {
        label: '过滤武器弹药 (防自毁误算)',
        desc: '剔除武器弹药消耗，仅统计战机作战单元战损',
        code: '# 军规防坑守则：UnitType=="武器" 为飞行中导弹，严禁误算为己方战机战损\naircraft_only = df[~df["UnitType"].isin(["武器", "Weapon", "Decoy"])]\n',
      },
      {
        label: '有效交战时序窗口截断',
        desc: '按任务时序截取有效推演事件 (如 0 ~ 3600 秒)',
        code: 'valid_events = df[(df["Time"] >= 0) & (df["Time"] <= 3600)]\n',
      },
      {
        label: '双表左连接 (Left Join)',
        desc: '通过 UnitID 将两张底表关键字段关联',
        code: 'merged = pd.merge(missions_df, units_df, on="UnitID", how="left")\n',
      },
    ],
  },
  {
    category: '2. 战损与交换比精算',
    items: [
      {
        label: '红蓝战损单元数量统计',
        desc: '过滤武器后按阵营统计被击落与毁伤战机总数',
        code: 'loss_summary = losses_df[~losses_df["UnitType"].isin(["武器", "Weapon"])].groupby("Side").size().reset_index(name="战损单元数")\n',
      },
      {
        label: '战损交换比平滑精算',
        desc: '计算蓝红战损比 (Blue_Loss / Red_Loss，带除零平滑保护)',
        code: 'blue_loss = float(loss_summary.loc[loss_summary["Side"] == "Blue", "战损单元数"].sum() if "Blue" in loss_summary["Side"].values else 0)\nred_loss = float(loss_summary.loc[loss_summary["Side"] == "Red", "战损单元数"].sum() if "Red" in loss_summary["Side"].values else 0)\nloss_exchange_ratio = round(blue_loss / max(red_loss, 0.5), 3)\n',
      },
      {
        label: '机队幸存率与健康度',
        desc: '按阵营统计战机最终幸存比例 (DamagePercent < 100%)',
        code: 'survival_df = units_df.groupby("Side")["DamagePercent"].apply(lambda s: (s < 100.0).mean()).reset_index(name="机队幸存率")\n',
      },
    ],
  },
  {
    category: '3. 任务航线与空域合规',
    items: [
      {
        label: '走廊在勤率与保持时长',
        desc: '按巡逻/战巡任务聚合在勤时间与合规比例',
        code: 'corridor_summary = missions_df.groupby("Side").agg(\n    平均在勤率=("UnitComplianceRate", "mean"),\n    保持阵位秒数=("InCorridorDuration_s", "sum")\n).reset_index()\n',
      },
      {
        label: '巡逻任务综合打分模型',
        desc: '结合到位率与战损扣分的综合效能模型',
        code: 'score = round(max(0.0, min(1.0, float(avg_completion) - float(loss_penalty) * 0.1)), 3)\n',
      },
    ],
  },
  {
    category: '4. 标准二维契约产出',
    items: [
      {
        label: '红蓝阵营长表 (推荐契约)',
        desc: '产出标准的二维指标 DataFrame (必须赋值给 output_df)',
        code: 'output_df = pd.DataFrame({\n    "分方": ["Blue", "Red"],\n    "评估分值": [0.88, 0.65],\n    "战损单元数": [1, 3],\n    "阵位保持时长": [1240.0, 890.0]\n})\n',
      },
      {
        label: '标量归约单值表',
        desc: '全演习全局综合效能指标单一汇总产出',
        code: 'output_df = pd.DataFrame([{\n    "全局作战效能分": 0.852,\n    "战损交换比": 0.333,\n    "航路遵从度": 0.941\n}])\n',
      },
    ],
  },
];

// 获取字段类型微标
function getFieldTypeBadge(type?: string, name?: string) {
  const lowerName = (name || '').toLowerCase();
  const lowerType = (type || '').toLowerCase();
  if (
    lowerType === 'int' ||
    lowerType === 'double' ||
    lowerType === 'float' ||
    lowerType === 'number' ||
    lowerName.includes('count') ||
    lowerName.includes('rate') ||
    lowerName.includes('score') ||
    lowerName.includes('alt') ||
    lowerName.includes('speed') ||
    lowerName.includes('range') ||
    lowerName.includes('duration')
  ) {
    return { symbol: '#', text: '数值', bg: 'bg-violet-950/80 border-violet-800 text-violet-300' };
  }
  if (lowerType === 'datetime' || lowerName.includes('time')) {
    return { symbol: '⏱', text: '时序', bg: 'bg-cyan-950/80 border-cyan-800 text-cyan-300' };
  }
  if (
    lowerName.includes('side') ||
    lowerName.includes('status') ||
    lowerName.includes('type') ||
    lowerName.includes('class') ||
    lowerName.includes('result')
  ) {
    return { symbol: '🏷', text: '枚举', bg: 'bg-emerald-950/80 border-emerald-800 text-emerald-300' };
  }
  return { symbol: 'T', text: '文本', bg: 'bg-slate-800/90 border-slate-700 text-slate-300' };
}

export function PythonCodeEditor({
  value,
  onChange,
  height,
  readOnly = false,
  upstreamColumns = [],
  upstreamTables = [],
  contextPayload,
  placeholder = '# 编写 Python 3.12 算法代码...',
  enableFullscreenModal = true,
  isWideLayout = false,
  outputColumns = [],
  onUpdateOutputColumns,
  timeoutMs = 5000,
  onUpdateTimeoutMs,
  onRunTest,
  isTesting = false,
  testResult = null,
  onSyncOutputColumns,
}: PythonCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const modalContainerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const modalEditorViewRef = useRef<EditorView | null>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isSnippetsOpen, setIsSnippetsOpen] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [insertMode, setInsertMode] = useState<'column_name' | 'extract_stmt'>('column_name');
  const [rightInspectorTab, setRightInspectorTab] = useState<'assets' | 'contract'>('assets');
  const [hoveredCol, setHoveredCol] = useState<{ col: UpstreamTableColumn; tableName: string; x: number; y: number } | null>(null);
  const [isAccordionOpen, setIsAccordionOpen] = useState(false);
  const [debugTab, setDebugTab] = useState<'grid' | 'stdout' | 'viz'>('grid');
  const [isTrayCollapsed, setIsTrayCollapsed] = useState(false);
  const [newColInput, setNewColInput] = useState('');

  // 内部试跑状态（用于全屏 Zen Mode 或外部未提供 onRunTest 时的本地兜底）
  const [internalTestResult, setInternalTestResult] = useState<{
    status: 'success' | 'error';
    output?: any;
    stdout?: string;
    stderr?: string;
    latencyMs?: number;
    errorLine?: number;
  } | null>(null);
  const [isInternalTesting, setIsInternalTesting] = useState(false);

  // 综合试算结果（优先取外部传入的真机结果）
  const activeTestResult = testResult || internalTestResult;
  const activeIsTesting = isTesting || isInternalTesting;

  // 实时分析代码语法与结构
  const scriptStatus = useMemo(() => analyzePythonScript(value), [value]);

  // 实时从 Python 代码静态推断 output_df 所包含的列
  const inferredColumns = useMemo(() => inferOutputColumnsFromPythonCode(value), [value]);

  // 如果当前契约列为空，但代码中已显式推断出列定义，自动初始化填充
  useEffect(() => {
    if ((!outputColumns || outputColumns.length === 0) && inferredColumns.length > 0 && onUpdateOutputColumns) {
      onUpdateOutputColumns(inferredColumns);
      if (onSyncOutputColumns) onSyncOutputColumns(inferredColumns);
    }
  }, [inferredColumns]);

  // 从 stderr 或 error 中提取报错行号 (如: line 14, in <module>)
  const extractErrorLine = (text?: string): number | null => {
    if (!text) return null;
    const match = text.match(/line\s+(\d+)/i) || text.match(/第\s*(\d+)\s*行/);
    if (match && match[1]) {
      const line = parseInt(match[1], 10);
      return isNaN(line) ? null : line;
    }
    return null;
  };

  // 获取当前活跃的 CodeMirror 视图
  const getActiveView = () => {
    if (isFullscreen && modalEditorViewRef.current) {
      return modalEditorViewRef.current;
    }
    return editorViewRef.current;
  };

  // 在光标所在位置精准插入文本
  const insertAtCursor = (text: string) => {
    const view = getActiveView();
    if (!view) {
      const sep = value.endsWith('\n') ? '' : '\n';
      onChange(value + sep + text);
      return;
    }
    const state = view.state;
    const selection = state.selection.main;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: text },
      selection: { anchor: selection.from + text.length },
    });
    view.focus();
  };

  // 滚动并高亮定位到指定行
  const jumpToLine = (lineNumber: number) => {
    const view = getActiveView();
    if (!view || lineNumber <= 0) return;
    const doc = view.state.doc;
    if (lineNumber > doc.lines) return;
    const line = doc.line(lineNumber);
    view.dispatch({
      selection: { anchor: line.from, head: line.to },
      scrollIntoView: true,
    });
    view.focus();
  };

  // 触发试算（外部优先，内部兜底）
  const triggerRunTest = async () => {
    if (onRunTest) {
      onRunTest();
      return;
    }
    setIsInternalTesting(true);
    setInternalTestResult(null);

    const mockCtx: Record<string, unknown> = { ...(contextPayload || {}) };
    for (const col of upstreamColumns) {
      if (!(col in mockCtx)) {
        mockCtx[col] = 100.0;
      }
    }

    const t0 = performance.now();
    try {
      const res = await evalApi.runPythonSandbox({
        script: value,
        context: mockCtx,
        timeout: (timeoutMs || 5000) / 1000,
      });
      const t1 = performance.now();
      const latency = res.latencyMs ?? +(t1 - t0).toFixed(2);
      const errLine = extractErrorLine(res.stderr);

      setInternalTestResult({
        status: res.status,
        output: res.output,
        stdout: res.stdout,
        stderr: res.stderr,
        latencyMs: latency,
        errorLine: errLine ?? undefined,
      });

      if (
        res.status === 'success' &&
        res.output?.__is_dataframe__ &&
        Array.isArray(res.output.columns) &&
        onSyncOutputColumns
      ) {
        const colNames = res.output.columns.map((c: any) => (typeof c === 'string' ? c : c.name || String(c)));
        onSyncOutputColumns(colNames);
      }
    } catch (err: any) {
      const t1 = performance.now();
      const errLine = extractErrorLine(err.message);
      setInternalTestResult({
        status: 'error',
        stderr: err.message,
        latencyMs: +(t1 - t0).toFixed(2),
        errorLine: errLine ?? undefined,
      });
    } finally {
      setIsInternalTesting(false);
    }
  };

  // 自定义智能自动补全数据源 (结合上游规范字段 + DataFrame 常用操作)
  const customPythonCompletions = useMemo(() => {
    return (context: CompletionContext): CompletionResult | null => {
      const word = context.matchBefore(/[\w\.]+/);
      if (!word && !context.explicit) return null;

      // 1. 上游字段候选列表
      const colOptions = upstreamColumns.map((col) => ({
        label: col,
        type: 'variable',
        detail: '上游入参字段',
        apply: `'${col}'`,
      }));

      // 2. 表级快速导表候选
      const tableOptions = upstreamTables.map((t) => ({
        label: `T("${t.tableName}")`,
        type: 'function',
        detail: `读取上游底表 [${t.label}]`,
        apply: `T("${t.tableName}")`,
      }));

      // 3. 常用内建变量与函数
      const builtInOptions = [
        { label: 'T', type: 'function', detail: '安全导表函数 T("表名")', apply: 'T("$0")' },
        { label: 'C', type: 'function', detail: '安全取列函数 C(df, "列名")', apply: 'C($0, "")' },
        { label: 'input_df_dict', type: 'variable', detail: '多表 DataFrame 字典 (按表名索引)' },
        { label: 'prev_output_df', type: 'variable', detail: '前序计算节点输出 DataFrame' },
        { label: 'output_df', type: 'variable', detail: '算子最终输出 DataFrame' },
        { label: 'pd.DataFrame', type: 'function', detail: '构造 Pandas DataFrame' },
        { label: 'pd.merge', type: 'function', detail: '双表关联 Merge' },
        { label: 'np.mean', type: 'function', detail: '计算均值' },
        { label: 'np.sum', type: 'function', detail: '计算求和' },
        { label: 'np.max', type: 'function', detail: '计算最大值' },
        { label: 'np.min', type: 'function', detail: '计算最小值' },
      ];

      return {
        from: word ? word.from : context.pos,
        options: [...tableOptions, ...colOptions, ...builtInOptions],
      };
    };
  }, [upstreamColumns, upstreamTables]);

  // CodeMirror 主题配置
  const customTheme = useMemo(
    () =>
      EditorView.theme({
        '&': {
          height: '100%',
          fontSize: '12px',
          backgroundColor: '#0a0f1d',
        },
        '.cm-scroller': {
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          lineHeight: '1.6',
        },
        '.cm-gutters': {
          backgroundColor: '#070b16',
          color: '#475569',
          borderRight: '1px solid #1e293b',
        },
        '.cm-activeLine': {
          backgroundColor: 'rgba(217, 70, 239, 0.07)',
        },
        '.cm-activeLineGutter': {
          backgroundColor: 'rgba(217, 70, 239, 0.15)',
          color: '#e879f9',
        },
        '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
          backgroundColor: 'rgba(217, 70, 239, 0.3) !important',
        },
        '&.cm-focused': {
          outline: 'none',
        },
      }),
    [],
  );

  // 初始化普通模式 CodeMirror 实例 (含 Ctrl+Enter 快捷键)
  useEffect(() => {
    if (!containerRef.current) return;

    const readOnlyCompartment = new Compartment();
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const newValue = update.state.doc.toString();
        onChange(newValue);
      }
    });

    const runShortcutKeymap = keymap.of([
      {
        key: 'Mod-Enter',
        run: () => {
          triggerRunTest();
          return true;
        },
      },
      indentWithTab,
    ]);

    // 关键事件防护：阻止 CodeMirror 内的键盘事件向上冒泡到 window，
    // 确保在编辑代码时按 Backspace/Delete 绝不会穿透触发外层画布的节点删除逻辑
    const stopBubbleEvents = EditorView.domEventHandlers({
      keydown: (event) => {
        event.stopPropagation();
        return false;
      },
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        python(),
        oneDark,
        customTheme,
        runShortcutKeymap,
        stopBubbleEvents,
        autocompletion({ override: [customPythonCompletions] }),
        readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
        updateListener,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    editorViewRef.current = view;

    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
  }, []);

  // 保持外部传入的 value 同步到 CodeMirror
  useEffect(() => {
    const view = editorViewRef.current;
    if (view) {
      const cur = view.state.doc.toString();
      if (cur !== value) {
        view.dispatch({
          changes: { from: 0, to: cur.length, insert: value },
        });
      }
    }
  }, [value]);

  // 初始化 Zen Mode 全屏模式 CodeMirror 实例
  useEffect(() => {
    if (!isFullscreen || !modalContainerRef.current) return;

    const readOnlyCompartment = new Compartment();
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const newValue = update.state.doc.toString();
        onChange(newValue);
      }
    });

    const modalTheme = EditorView.theme({
      '&': {
        height: '100%',
        fontSize: '13px',
        backgroundColor: '#080d19',
      },
      '.cm-scroller': {
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        lineHeight: '1.65',
      },
      '.cm-gutters': {
        backgroundColor: '#060a14',
        color: '#475569',
        borderRight: '1px solid #1e293b',
      },
      '.cm-activeLine': {
        backgroundColor: 'rgba(217, 70, 239, 0.08)',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'rgba(217, 70, 239, 0.2)',
        color: '#e879f9',
      },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: 'rgba(217, 70, 239, 0.35) !important',
      },
      '&.cm-focused': {
        outline: 'none',
      },
    });

    const stopBubbleEvents = EditorView.domEventHandlers({
      keydown: (event) => {
        event.stopPropagation();
        return false;
      },
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        python(),
        oneDark,
        modalTheme,
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              triggerRunTest();
              return true;
            },
          },
          indentWithTab,
        ]),
        stopBubbleEvents,
        autocompletion({ override: [customPythonCompletions] }),
        readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
        updateListener,
      ],
    });

    const view = new EditorView({
      state,
      parent: modalContainerRef.current,
    });

    modalEditorViewRef.current = view;

    return () => {
      view.destroy();
      modalEditorViewRef.current = null;
    };
  }, [isFullscreen]);

  // 同步外部 value 到全屏 CodeMirror
  useEffect(() => {
    if (!isFullscreen) return;
    const view = modalEditorViewRef.current;
    if (view) {
      const cur = view.state.doc.toString();
      if (cur !== value) {
        view.dispatch({
          changes: { from: 0, to: cur.length, insert: value },
        });
      }
    }
  }, [value, isFullscreen]);

  // 格式化代码骨架
  const handleFormatCode = () => {
    if (!value.trim()) return;
    const cleaned = value
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
    onChange(cleaned);
  };

  // 复制源码
  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // 一键重置为标准骨架
  const handleResetToStandardSkeleton = () => {
    const tableImports = upstreamTables.map((t) => {
      const varName = t.tableName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      return `# ${varName}_df = T("${t.tableName}")  # 读取 ${t.label}`;
    });

    const importBlock =
      tableImports.length > 0
        ? tableImports.join('\n')
        : '# missions = T("MissionChanged")\n# units = T("UnitPositions")\n# prev = prev_output_df';

    const skeleton = `# Python 3.12 仿真评估算法模型
import pandas as pd
import numpy as np

def T(name):
    """安全读取输入底表 (支持带或不带 .csv 后缀)"""
    return input_df_dict.get(name, input_df_dict.get(name + ".csv", pd.DataFrame()))

def C(df, name, default=None):
    """安全读取字段列，缺列时自动返回默认 Series"""
    return df[name] if name in df.columns else pd.Series(default, index=df.index, dtype=object)

# 1. 获取输入底表与前序数据
${importBlock}

# 2. 核心算法处理与运筹统计 (示例)
# 规范建议：UnitType 包含 "武器" 时需显式过滤，避免导弹自毁计入机队战损

# 3. 标准结果输出 DataFrame (支持多列业务指标)
output_df = pd.DataFrame({
    "分方": ["Blue", "Red"],
    "评估分值": [1.0, 1.0],
})
`;
    onChange(skeleton);
  };

  // 过滤后的上游表与字段列表
  const filteredUpstreamTables = useMemo(() => {
    if (!searchKeyword.trim()) return upstreamTables;
    const kw = searchKeyword.trim().toLowerCase();
    return upstreamTables
      .map((t) => {
        const tableMatch = t.label.toLowerCase().includes(kw) || t.tableName.toLowerCase().includes(kw);
        const matchedCols = t.columns.filter(
          (c) => c.name.toLowerCase().includes(kw) || (c.desc && c.desc.toLowerCase().includes(kw)),
        );
        if (tableMatch) return t;
        if (matchedCols.length > 0) return { ...t, columns: matchedCols };
        return null;
      })
      .filter(Boolean) as UpstreamTableItem[];
  }, [upstreamTables, searchKeyword]);

  // 总上游字段数统计
  const totalUpstreamColsCount = useMemo(() => {
    return upstreamTables.reduce((acc, t) => acc + (t.columns?.length || 0), 0);
  }, [upstreamTables]);

  // 渲染单个数据资产探针组件 (可在右侧侧栏或紧凑展开浮层复用，采用 Tab 切换保证纵向空间充足)
  const renderDataAssetsInspector = (isRightSidebar = false) => (
    <div className={`flex flex-col h-full bg-[#070b16] ${isRightSidebar ? 'p-3' : 'p-3'}`}>
      {/* 顶部双 Tab 切换：上游资产 vs 输出契约 */}
      <div className="flex items-center gap-1 pb-2 border-b border-slate-800/80 shrink-0">
        <button
          type="button"
          onClick={() => setRightInspectorTab('assets')}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold transition ${
            rightInspectorTab === 'assets'
              ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
          }`}
        >
          <Database className="h-3.5 w-3.5" />
          <span>上游资产 ({upstreamTables.length}表·{totalUpstreamColsCount}列)</span>
        </button>
        <button
          type="button"
          onClick={() => setRightInspectorTab('contract')}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold transition ${
            rightInspectorTab === 'contract'
              ? 'bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/40'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
          }`}
        >
          <Target className="h-3.5 w-3.5" />
          <span>输出契约 ({outputColumns.length}列)</span>
        </button>
      </div>

      {rightInspectorTab === 'assets' ? (
        <div className="flex-1 flex flex-col min-h-0 pt-2">
          <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
            <div className="relative flex-1">
              <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="搜索表名、字段、中文说明..."
                className="w-full pl-7 pr-6 py-1 rounded-md border border-slate-700/80 bg-slate-900/90 text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-fuchsia-500"
              />
              {searchKeyword && (
                <button
                  type="button"
                  onClick={() => setSearchKeyword('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-0.5 bg-slate-900 rounded p-0.5 border border-slate-800 text-[10px] shrink-0">
              <button
                type="button"
                onClick={() => setInsertMode('column_name')}
                className={`px-1.5 py-0.5 rounded text-[9px] ${
                  insertMode === 'column_name' ? 'bg-fuchsia-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="点击字段在光标处插入 '字段名'"
              >
                '列名'
              </button>
              <button
                type="button"
                onClick={() => setInsertMode('extract_stmt')}
                className={`px-1.5 py-0.5 rounded text-[9px] ${
                  insertMode === 'extract_stmt' ? 'bg-fuchsia-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="点击字段在光标处插入 C(df, '字段名')"
              >
                C(df,'列')
              </button>
            </div>
          </div>

          {/* 上游数据表与字段树 (完整纵向高度) */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0">
        {filteredUpstreamTables.length > 0 ? (
          filteredUpstreamTables.map((tbl) => {
            const varName = tbl.tableName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
            return (
              <div
                key={tbl.id}
                className="rounded-lg border border-slate-800/80 bg-[#0a0f1d] p-2 flex flex-col gap-1.5 shadow-sm hover:border-slate-700 transition"
              >
                {/* 表级标题栏与导表按钮 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 overflow-hidden">
                    <Table className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                    <span className="font-semibold text-sky-200 text-xs truncate" title={tbl.label}>
                      {tbl.label}
                    </span>
                    <span className="font-mono text-[9px] text-slate-500 shrink-0">({tbl.tableName})</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => insertAtCursor(`${varName}_df = T("${tbl.tableName}")\n`)}
                    className="px-1.5 py-0.5 rounded bg-sky-950/80 border border-sky-800/70 text-[9px] font-mono text-sky-300 hover:bg-sky-900 hover:text-white transition shrink-0"
                    title={`在光标处插入导表语句: ${varName}_df = T("${tbl.tableName}")`}
                  >
                    + 导表
                  </button>
                </div>

                {/* 字段列表 (带类型徽标与 Hover 样本预览) */}
                <div className="flex flex-wrap gap-1">
                  {tbl.columns.map((col) => {
                    const badge = getFieldTypeBadge(col.type, col.name);
                    return (
                      <div
                        key={col.name}
                        className="relative"
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setHoveredCol({
                            col,
                            tableName: tbl.tableName,
                            x: rect.left,
                            y: rect.top,
                          });
                        }}
                        onMouseLeave={() => setHoveredCol(null)}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (insertMode === 'column_name') {
                              insertAtCursor(`'${col.name}'`);
                            } else {
                              insertAtCursor(`C(${varName}_df, '${col.name}')`);
                            }
                          }}
                          className="px-1.5 py-0.5 rounded bg-slate-900/90 hover:bg-fuchsia-950/80 border border-slate-700/80 hover:border-fuchsia-600/80 text-[10px] font-mono text-slate-300 hover:text-fuchsia-200 transition flex items-center gap-1 group shadow-sm"
                        >
                          <span className={`px-0.5 text-[8px] rounded border font-sans ${badge.bg}`}>
                            {badge.symbol}
                          </span>
                          <span className="group-hover:text-fuchsia-300">{col.name}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-center py-6 text-slate-500 text-xs">
            {searchKeyword ? '未匹配到包含该关键词的表或字段' : '当前节点暂无直接上游连线'}
          </div>
        )}
          </div>
        </div>
      ) : (
        /* 产出列契约声明与超时参数管理 (独立 Tab 完整空间) */
        <div className="flex-1 overflow-y-auto pt-3 space-y-3 min-h-0">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-1">
            <Target className="h-3 w-3 text-cyan-400" />
            <span>产出数据列契约 ({outputColumns.length} 列)</span>
          </span>
          {(() => {
            const hasDf = activeTestResult?.output?.__is_dataframe__ && Array.isArray(activeTestResult.output.columns);
            const isDict = activeTestResult?.output && typeof activeTestResult.output === 'object' && !Array.isArray(activeTestResult.output) && !activeTestResult.output.__is_dataframe__;
            if (!hasDf && !isDict) return null;
            return (
              <button
                type="button"
                onClick={() => {
                  let cols: string[] = [];
                  if (hasDf) {
                    cols = activeTestResult.output.columns.map((c: any) =>
                      typeof c === 'string' ? c : c.name || String(c),
                    );
                  } else if (isDict) {
                    cols = Object.keys(activeTestResult.output).filter((k) => !k.startsWith('__'));
                  }
                  if (onUpdateOutputColumns) onUpdateOutputColumns(cols);
                  if (onSyncOutputColumns) onSyncOutputColumns(cols);
                }}
                className="text-[9px] text-cyan-300 hover:text-cyan-200 bg-cyan-950/80 border border-cyan-800/70 px-1.5 py-0.5 rounded transition flex items-center gap-1"
                title="从当前试算成功的产出提取所有字段列同步至契约"
              >
                <Sparkles className="h-2.5 w-2.5" />
                <span>⚡ 试算同步</span>
              </button>
            );
          })()}
        </div>

        {/* 产出列胶囊标签 */}
        <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
          {outputColumns.length > 0 ? (
            outputColumns.map((col, idx) => (
              <span
                key={`${col}-${idx}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/60 text-cyan-300 text-[10px] font-mono"
              >
                <span>{col}</span>
                {onUpdateOutputColumns && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = outputColumns.filter((_, i) => i !== idx);
                      onUpdateOutputColumns(next);
                    }}
                    className="text-cyan-500 hover:text-red-400 transition"
                    title="移除该列声明"
                  >
                    ×
                  </button>
                )}
              </span>
            ))
          ) : (
            <span className="text-[10px] text-slate-500 italic">暂未声明（试算后点击上方同步或下方输入）</span>
          )}
        </div>

        {/* 代码静态推断列快速一键同步 */}
        {inferredColumns.length > 0 &&
          inferredColumns.some((c) => !outputColumns.includes(c)) &&
          onUpdateOutputColumns && (
            <button
              type="button"
              onClick={() => {
                const merged = Array.from(new Set([...outputColumns, ...inferredColumns]));
                onUpdateOutputColumns(merged);
                if (onSyncOutputColumns) onSyncOutputColumns(merged);
              }}
              className="w-full mt-1.5 px-2 py-1 rounded bg-fuchsia-950/70 hover:bg-fuchsia-900 border border-fuchsia-800/80 text-[10px] text-fuchsia-300 transition flex items-center justify-between group shadow-sm"
              title="根据代码中 COLS/DataFrame 静态语法推断出的列，一键填充至契约"
            >
              <span className="flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-fuchsia-400 group-hover:rotate-12 transition-transform" />
                <span>代码推断检测到 {inferredColumns.length} 列</span>
              </span>
              <span className="underline font-bold text-[9px]">⚡ 一键采纳</span>
            </button>
          )}

        {/* 手动添加列与超时 */}
        {onUpdateOutputColumns && (
          <div className="flex items-center gap-1 pt-1">
            <input
              type="text"
              value={newColInput}
              onChange={(e) => setNewColInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newColInput.trim()) {
                  e.preventDefault();
                  const col = newColInput.trim();
                  if (!outputColumns.includes(col)) {
                    onUpdateOutputColumns([...outputColumns, col]);
                  }
                  setNewColInput('');
                }
              }}
              placeholder="添加产出列名 (回车确认)"
              className="flex-1 rounded border border-slate-700/80 bg-slate-900 px-2 py-1 text-[10px] text-slate-100 font-mono focus:border-cyan-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                if (newColInput.trim()) {
                  const col = newColInput.trim();
                  if (!outputColumns.includes(col)) {
                    onUpdateOutputColumns([...outputColumns, col]);
                  }
                  setNewColInput('');
                }
              }}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-200 font-bold"
            >
              +
            </button>
          </div>
        )}

        {onUpdateTimeoutMs && (
          <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
            <span>执行超时限制:</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={timeoutMs}
                onChange={(e) => onUpdateTimeoutMs(parseInt(e.target.value) || 5000)}
                className="w-16 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-200 font-mono text-right focus:border-fuchsia-500 focus:outline-none"
              />
              <span>ms</span>
            </div>
          </div>
        )}
        </div>
      )}
    </div>
  );

  return (
    <div
      onKeyDown={(e) => {
        // 关键防线：组件内部处理的所有键盘事件（包含 Backspace/Delete），
        // 阻止冒泡到外层画布，杜绝在编辑代码或输入列名时触发节点删除
        e.stopPropagation();
      }}
      className="flex flex-col h-full rounded-xl border border-slate-800 bg-[#0a0f1d] overflow-hidden shadow-2xl transition-all focus-within:border-fuchsia-500/80 min-h-0"
    >
      {/* ════════════════ 顶部控制栏 (Status & Action Bar) ════════════════ */}
      <div className="flex items-center justify-between border-b border-slate-800/80 bg-[#070b16] px-3 py-1.5 text-xs shrink-0">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-fuchsia-300 shrink-0">
            <Code2 className="h-3.5 w-3.5 text-fuchsia-400" />
            <span>Python 3.12</span>
          </div>

          {/* 实时语法与入口守卫状态 */}
          {scriptStatus.valid ? (
            <span
              className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border truncate ${
                scriptStatus.mode === 'dataframe'
                  ? 'text-emerald-300 bg-emerald-950/60 border-emerald-800/60'
                  : 'text-sky-300 bg-sky-950/60 border-sky-800/60'
              }`}
            >
              <CheckCircle2 className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {scriptStatus.mode === 'dataframe' ? 'DataFrame 契约就绪 (output_df)' : '函数契约 evaluate'}
              </span>
            </span>
          ) : (
            <span
              className="flex items-center gap-1 text-[10px] text-amber-300 bg-amber-950/60 border border-amber-800/60 px-2 py-0.5 rounded cursor-help truncate"
              title={scriptStatus.error}
            >
              <AlertCircle className="h-3 w-3 text-amber-400 shrink-0" />
              <span className="truncate max-w-[220px]">{scriptStatus.error}</span>
            </span>
          )}
        </div>

        {/* 顶部操作按钮 */}
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 shrink-0">
          {/* 常用算法片段下拉菜单 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsSnippetsOpen((prev) => !prev)}
              className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition text-[10px] border border-slate-700/60"
              title="插入军事推演常用算法模版"
            >
              <Sparkles className="h-3 w-3 text-fuchsia-400" />
              <span>常用模版</span>
              <ChevronDown className="h-2.5 w-2.5" />
            </button>

            {isSnippetsOpen && (
              <div className="absolute right-0 top-full mt-1 w-72 rounded-xl border border-slate-700 bg-[#0d1424] shadow-2xl z-40 p-2 space-y-2 text-xs">
                <div className="text-[10px] font-semibold text-slate-400 px-1 pb-1 border-b border-slate-800 flex items-center justify-between">
                  <span>点击在光标处插入算法片段</span>
                  <span className="text-[9px] text-fuchsia-400 font-mono">CPython 3.12</span>
                </div>
                <div className="max-h-72 overflow-y-auto space-y-2.5 pr-0.5">
                  {COMMON_SNIPPETS.map((group) => (
                    <div key={group.category} className="space-y-1">
                      <div className="text-[10px] font-bold text-fuchsia-300 px-1 flex items-center gap-1">
                        <span>{group.category}</span>
                      </div>
                      <div className="space-y-1">
                        {group.items.map((item) => (
                          <button
                            key={item.label}
                            type="button"
                            onClick={() => {
                              insertAtCursor(item.code);
                              setIsSnippetsOpen(false);
                            }}
                            className="w-full text-left p-1.5 rounded-lg hover:bg-slate-800/90 text-slate-200 transition flex flex-col group border border-transparent hover:border-slate-700"
                          >
                            <span className="font-semibold text-[11px] text-slate-200 group-hover:text-fuchsia-300">
                              {item.label}
                            </span>
                            <span className="text-[9px] text-slate-400 truncate mt-0.5">{item.desc}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 重置为标准骨架 */}
          <button
            type="button"
            onClick={handleResetToStandardSkeleton}
            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800/60 hover:bg-slate-700 hover:text-slate-200 transition text-[10px] border border-slate-700/60"
            title="根据当前上游连入底表生成标准 DataFrame 骨架代码"
          >
            <RotateCcw className="h-3 w-3 text-cyan-400" />
            <span>标准骨架</span>
          </button>

          {/* 整理代码 */}
          <button
            type="button"
            onClick={handleFormatCode}
            className="p-1 rounded hover:bg-slate-800 hover:text-slate-200 transition"
            title="整理格式 (去除尾部空格与多余空行)"
          >
            <Sparkles className="h-3.5 w-3.5" />
          </button>

          {/* 复制代码 */}
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded hover:bg-slate-800 hover:text-slate-200 transition"
            title="复制代码到剪贴板"
          >
            <Copy className={`h-3.5 w-3.5 ${copied ? 'text-emerald-400' : ''}`} />
          </button>

          {/* 单步真机试算按钮 (支持快捷键 Ctrl+Enter) */}
          <button
            type="button"
            onClick={triggerRunTest}
            disabled={activeIsTesting}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-bold text-[10px] transition shadow-md disabled:opacity-50"
            title="单步真机试算当前算法 (快捷键: Ctrl + Enter)"
          >
            <Play className={`h-3 w-3 ${activeIsTesting ? 'animate-spin' : ''}`} />
            <span>{activeIsTesting ? '计算中...' : '▷ 试算 (Ctrl+Enter)'}</span>
          </button>

          {/* 全屏 Zen Mode */}
          {enableFullscreenModal && (
            <button
              type="button"
              onClick={() => setIsFullscreen(true)}
              className="p-1 rounded hover:bg-slate-800 hover:text-fuchsia-300 transition"
              title="沉浸式宽屏全屏编辑 (Zen Mode)"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ════════════════ 窄屏模式下的上游数据源折叠手风琴条 ════════════════ */}
      {!isWideLayout && upstreamTables.length > 0 && (
        <div className="border-b border-slate-800/80 bg-[#080d19] shrink-0">
          <div
            onClick={() => setIsAccordionOpen(!isAccordionOpen)}
            className="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-slate-900 transition text-[11px]"
          >
            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Database className="h-3 w-3 text-cyan-400" />
              <span>上游数据源 ({upstreamTables.length} 表 · {totalUpstreamColsCount} 列)</span>
            </span>
            <div className="flex items-center gap-1.5 text-slate-400 text-[10px]">
              <span className="text-[9px] text-fuchsia-400 font-mono">
                {isAccordionOpen ? '点击收起' : '点击展开查阅与插入'}
              </span>
              {isAccordionOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </div>
          </div>
          {isAccordionOpen && (
            <div className="max-h-60 border-t border-slate-800/80">
              {renderDataAssetsInspector(false)}
            </div>
          )}
        </div>
      )}

      {/* ════════════════ 主体工作区 (双栏布局支持) ════════════════ */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* 左侧主编辑与调试区 */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {/* CodeMirror 编辑器容器 (自适应撑满剩余高度) */}
          <div
            ref={containerRef}
            style={{ height: height || '100%' }}
            className="flex-1 w-full overflow-hidden text-xs font-mono min-h-0"
          />

          {/* 底部快捷提示条 */}
          <div className="flex items-center justify-between border-t border-slate-800/80 bg-[#070b16] px-3 py-1 text-[10px] text-slate-500 font-mono shrink-0">
            <div className="flex items-center gap-2 truncate">
              <span>Ctrl+Enter: 单步真机试算</span>
              <span>•</span>
              <span>Tab: 缩进4空格</span>
              <span>•</span>
              <span>Ctrl+Space: 智能补全</span>
              <span>•</span>
              <span>T("表名") / C(df, "列名")</span>
            </div>
            <div className="shrink-0 flex items-center gap-1 text-[9px] text-slate-400">
              <span>CPython 3.12 沙箱</span>
            </div>
          </div>

          {/* ════════════════ 底部交互式 DataGrid 与调试控制台 (可折叠) ════════════════ */}
          {activeTestResult && (
            <div
              className={`border-t border-slate-800/90 bg-[#080d19] flex flex-col shrink-0 transition-all duration-150 ${
                isTrayCollapsed ? 'h-8' : 'h-52'
              }`}
            >
              {/* 控制台顶栏 */}
              <div className="flex items-center justify-between px-3 h-8 border-b border-slate-800/80 bg-[#060a14] shrink-0 text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      activeTestResult.status === 'success'
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/80'
                        : 'bg-red-950/80 text-red-300 border border-red-800/80'
                    }`}
                  >
                    {activeTestResult.status === 'success' ? '✔ 运行成功' : '✖ 运行异常'}
                  </span>
                  <span className="text-[10px] text-cyan-400 font-mono">
                    耗时: {activeTestResult.latencyMs} ms
                  </span>

                  {/* 报错行号一键穿梭 */}
                  {activeTestResult.errorLine && (
                    <button
                      type="button"
                      onClick={() => jumpToLine(activeTestResult.errorLine!)}
                      className="px-2 py-0.5 rounded bg-amber-950/80 border border-amber-800/80 text-amber-300 hover:text-amber-200 text-[10px] font-mono flex items-center gap-1 transition"
                      title="点击代码平滑滚动并高亮报错行"
                    >
                      <span>📍 错误行: 第 {activeTestResult.errorLine} 行</span>
                      <ArrowRight className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>

                {/* Tab 切换与收起按钮 */}
                <div className="flex items-center gap-1 text-[10px]">
                  <div className="flex items-center bg-slate-900 rounded p-0.5 border border-slate-800 mr-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDebugTab('grid');
                        setIsTrayCollapsed(false);
                      }}
                      className={`px-2 py-0.5 rounded ${
                        debugTab === 'grid' && !isTrayCollapsed
                          ? 'bg-slate-800 text-sky-300 font-medium'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      📊 数据表格 (DataGrid)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDebugTab('stdout');
                        setIsTrayCollapsed(false);
                      }}
                      className={`px-2 py-0.5 rounded ${
                        debugTab === 'stdout' && !isTrayCollapsed
                          ? 'bg-slate-800 text-sky-300 font-medium'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      📜 控制台 (stdout)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDebugTab('viz');
                        setIsTrayCollapsed(false);
                      }}
                      className={`px-2 py-0.5 rounded ${
                        debugTab === 'viz' && !isTrayCollapsed
                          ? 'bg-slate-800 text-sky-300 font-medium'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      📈 可视化
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsTrayCollapsed(!isTrayCollapsed)}
                    className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
                    title={isTrayCollapsed ? '展开调试面板' : '折叠调试面板'}
                  >
                    {isTrayCollapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* 控制台内容主体 */}
              {!isTrayCollapsed && (
                <div className="flex-1 overflow-auto p-2 min-h-0 font-mono text-xs">
                  {/* Tab 1: 交互式 DataGrid */}
                  {debugTab === 'grid' && (
                    <div className="h-full flex flex-col">
                      {activeTestResult.output && activeTestResult.output.__is_dataframe__ ? (
                        <div className="h-full flex flex-col">
                          <div className="flex items-center justify-between pb-1.5 text-[10px] text-slate-400">
                            <span className="text-emerald-400 font-medium">
                              DataFrame 产出: {activeTestResult.output.rowCount || (activeTestResult.output.rows || []).length} 行 × {activeTestResult.output.columnCount || (activeTestResult.output.columns || []).length} 列
                            </span>
                            {onSyncOutputColumns && Array.isArray(activeTestResult.output.columns) && (
                              <button
                                type="button"
                                onClick={() => {
                                  const cols = activeTestResult.output.columns.map((c: any) =>
                                    typeof c === 'string' ? c : c.name || String(c),
                                  );
                                  onSyncOutputColumns(cols);
                                }}
                                className="px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-800/80 text-cyan-300 hover:bg-cyan-900 transition flex items-center gap-1"
                              >
                                <Sparkles className="h-2.5 w-2.5" />
                                <span>⚡ 采纳此 {activeTestResult.output.columns.length} 列为下游契约</span>
                              </button>
                            )}
                          </div>
                          <div className="flex-1 overflow-auto border border-slate-800 rounded bg-[#060a14]">
                            <table className="w-full text-left border-collapse text-[11px]">
                              <thead className="sticky top-0 bg-[#0d1424] text-slate-300 border-b border-slate-800 z-10">
                                <tr>
                                  <th className="py-1 px-2 border-r border-slate-800/80 text-slate-500 w-8 text-center">#</th>
                                  {(activeTestResult.output.columns || []).map((col: any) => {
                                    const colName = typeof col === 'string' ? col : col.name || String(col);
                                    return (
                                      <th key={colName} className="py-1 px-2 border-r border-slate-800/80 font-semibold text-cyan-300">
                                        {colName}
                                      </th>
                                    );
                                  })}
                                </tr>
                              </thead>
                              <tbody>
                                {(activeTestResult.output.rows || []).map((row: any, rIdx: number) => (
                                  <tr key={rIdx} className="hover:bg-slate-800/40 border-b border-slate-800/40">
                                    <td className="py-1 px-2 border-r border-slate-800/80 text-slate-500 text-center font-mono text-[10px]">
                                      {rIdx + 1}
                                    </td>
                                    {(activeTestResult.output.columns || []).map((col: any) => {
                                      const colName = typeof col === 'string' ? col : col.name || String(col);
                                      const cellVal = row[colName];
                                      const isNum = typeof cellVal === 'number';
                                      return (
                                        <td
                                          key={colName}
                                          className={`py-1 px-2 border-r border-slate-800/80 font-mono text-[10px] truncate max-w-[200px] ${
                                            isNum ? 'text-violet-300' : 'text-slate-200'
                                          }`}
                                          title={String(cellVal ?? '')}
                                        >
                                          {cellVal !== undefined && cellVal !== null ? String(cellVal) : <span className="text-slate-600">null</span>}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : activeTestResult.output && typeof activeTestResult.output === 'object' && !Array.isArray(activeTestResult.output) ? (
                        <div className="h-full flex flex-col">
                          <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1 px-1">
                            <span className="flex items-center gap-1.5 text-cyan-400 font-mono">
                              <span>⚡ 结构化字典产出 (已自动映射为单行表格)</span>
                            </span>
                            <span className="text-[9px] text-slate-500 font-mono">共 {Object.keys(activeTestResult.output).filter(k => !k.startsWith('__')).length} 个字段</span>
                          </div>
                          <div className="flex-1 overflow-auto border border-slate-800/80 rounded bg-black/40">
                            <table className="w-full border-collapse text-left">
                              <thead className="bg-[#0b1222] sticky top-0 z-10 border-b border-slate-800 text-[9px] font-mono text-slate-400 uppercase">
                                <tr>
                                  <th className="py-1 px-2 border-r border-slate-800 w-10 text-center text-slate-500">#</th>
                                  {Object.keys(activeTestResult.output).filter(k => !k.startsWith('__')).map((key) => (
                                    <th key={key} className="py-1 px-2 border-r border-slate-800 font-medium text-slate-300">
                                      <div className="flex items-center gap-1">
                                        <span className="text-cyan-400 font-bold">{key}</span>
                                        <span className="text-[8px] text-slate-500">
                                          {typeof (activeTestResult.output as any)[key] === 'number' ? '#' : typeof (activeTestResult.output as any)[key] === 'boolean' ? '?' : 'T'}
                                        </span>
                                      </div>
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                <tr className="hover:bg-slate-900/50">
                                  <td className="py-1 px-2 border-r border-slate-800 text-center text-[9px] font-mono text-slate-500 bg-slate-950/40">1</td>
                                  {Object.keys(activeTestResult.output).filter(k => !k.startsWith('__')).map((key) => {
                                    const val = (activeTestResult.output as any)[key];
                                    const isNum = typeof val === 'number';
                                    return (
                                      <td
                                        key={key}
                                        className={`py-1 px-2 border-r border-slate-800/80 font-mono text-[10px] truncate max-w-[220px] ${
                                          isNum ? 'text-violet-300' : 'text-slate-200'
                                        }`}
                                        title={String(val ?? '')}
                                      >
                                        {val !== undefined && val !== null ? (typeof val === 'object' ? JSON.stringify(val) : String(val)) : <span className="text-slate-600">null</span>}
                                      </td>
                                    );
                                  })}
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : activeTestResult.output ? (
                        <div className="h-full flex flex-col">
                          <span className="text-[10px] text-slate-400 mb-1">标量或结构化计算产出:</span>
                          <pre className="flex-1 text-[10px] text-emerald-300 overflow-auto bg-black/40 p-2 rounded border border-slate-800/80">
                            {JSON.stringify(activeTestResult.output, null, 2)}
                          </pre>
                        </div>
                      ) : activeTestResult.stderr ? (
                        <div className="h-full flex flex-col">
                          <span className="text-[10px] text-red-400 mb-1">异常 Traceback:</span>
                          <pre className="flex-1 text-[10px] text-red-300 overflow-auto bg-red-950/30 p-2 rounded border border-red-900/60 whitespace-pre-wrap">
                            {activeTestResult.stderr}
                          </pre>
                        </div>
                      ) : (
                        <div className="text-slate-500 text-center py-6 text-xs">无产出数据</div>
                      )}
                    </div>
                  )}

                  {/* Tab 2: 控制台输出 stdout */}
                  {debugTab === 'stdout' && (
                    <div className="h-full flex flex-col">
                      {activeTestResult.stdout ? (
                        <pre className="flex-1 text-[10px] text-slate-200 overflow-auto bg-black/40 p-2 rounded border border-slate-800/80 whitespace-pre-wrap">
                          {activeTestResult.stdout}
                        </pre>
                      ) : (
                        <div className="text-slate-500 text-center py-6 text-xs italic">
                          脚本执行期间未调用 print() 打印标准输出
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tab 3: 可视化 */}
                  {debugTab === 'viz' && (
                    <div className="h-full flex flex-col overflow-auto">
                      {activeTestResult.output ? (
                        <AlgorithmOutputVisualizer output={activeTestResult.output} title="试算产出结构透视" />
                      ) : (
                        <div className="text-slate-500 text-center py-6 text-xs">暂无图表数据</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 右侧数据资产探针 (宽屏模式下常驻并列展示，彻底释放主编辑区高度) */}
        {isWideLayout && (
          <div className="w-72 lg:w-80 border-l border-slate-800 bg-[#070b16] flex flex-col h-full min-h-0 shrink-0">
            {renderDataAssetsInspector(true)}
          </div>
        )}
      </div>

      {/* 悬停字段样本与元数据 Tooltip 卡片 */}
      {hoveredCol && (
        <div
          style={{
            position: 'fixed',
            left: `${Math.min(hoveredCol.x, window.innerWidth - 260)}px`,
            top: `${Math.max(10, hoveredCol.y - 120)}px`,
          }}
          className="z-50 w-60 rounded-xl border border-slate-700 bg-[#0d1424] p-2.5 shadow-2xl text-xs space-y-1.5 animate-in fade-in duration-100 pointer-events-none"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-1">
            <span className="font-bold text-slate-100 font-mono text-[11px] truncate">{hoveredCol.col.name}</span>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-sky-300 font-mono">
              {hoveredCol.col.type || 'number'}
            </span>
          </div>
          {hoveredCol.col.desc && (
            <div className="text-[10px] text-slate-400 line-clamp-2">{hoveredCol.col.desc}</div>
          )}
          <div className="space-y-0.5 text-[9px] font-mono text-slate-400 bg-slate-900/80 p-1.5 rounded border border-slate-800">
            <div className="text-slate-500">归属底表: <span className="text-slate-300">{hoveredCol.tableName}</span></div>
            {hoveredCol.col.sampleValues && hoveredCol.col.sampleValues.length > 0 ? (
              <div className="text-slate-500">
                推演样本: <span className="text-emerald-400">{JSON.stringify(hoveredCol.col.sampleValues)}</span>
              </div>
            ) : (
              <div className="text-slate-500 italic">样本值: [12.0, 24.5, 38.0] (仿真切片)</div>
            )}
          </div>
          <div className="text-[9px] text-fuchsia-400/90 text-right">点击直接插入到代码光标处</div>
        </div>
      )}

      {/* ════════════════ 沉浸式宽屏工作台 Modal (Zen Mode) ════════════════ */}
      {isFullscreen && (
        <div
          role="dialog"
          aria-modal="true"
          onKeyDown={(e) => {
            e.stopPropagation();
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-6 animate-in fade-in duration-150"
        >
          <div className="w-full max-w-6xl h-[88vh] rounded-2xl border border-slate-700 bg-[#0d1424] shadow-2xl overflow-hidden flex flex-col">
            {/* 弹窗顶栏 */}
            <div className="flex items-center justify-between border-b border-slate-800 bg-[#0b111f] px-6 py-3.5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-fuchsia-500/15 text-fuchsia-400 border border-fuchsia-500/30">
                  <Code2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <span>Python 算法模型沉浸式工作台 (Zen Mode)</span>
                    <span className="font-mono text-[10px] text-fuchsia-400 bg-fuchsia-950/60 border border-fuchsia-800/60 rounded px-2 py-0.5">
                      CodeMirror 6 + CPython 3.12
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    大屏算法编辑、上游入参多表分组点注、光标感知插入与真机沙箱试算闭环
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsFullscreen(false)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition"
                  title="收起并同步到抽屉"
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsFullscreen(false)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-red-950/80 hover:text-red-300 transition"
                  title="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* 弹窗主体左右分栏 */}
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 overflow-hidden">
              {/* 左侧 2 栏：全尺寸 CodeMirror 6 专业代码编辑 */}
              <div className="lg:col-span-2 border-r border-slate-800 flex flex-col bg-[#080d19]">
                <div className="border-b border-slate-800/80 bg-[#0a0f1d] px-4 py-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300 flex items-center gap-2">
                    <span>算法主程序 (标准 DataFrame 契约)</span>
                    <span className="text-[10px] font-mono text-slate-500">output_df = ...</span>
                  </span>
                  <div className="flex items-center gap-2">
                    {scriptStatus.valid ? (
                      <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {scriptStatus.mode === 'dataframe' ? 'DataFrame 契约就绪' : '函数契约 evaluate'}
                      </span>
                    ) : (
                      <span className="text-[10px] text-amber-400 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> {scriptStatus.error}
                      </span>
                    )}
                  </div>
                </div>

                {/* 全屏 CodeMirror 容器 */}
                <div ref={modalContainerRef} className="flex-1 overflow-hidden" />
              </div>

              {/* 右侧 1 栏：数据资产探针与试算控制台 */}
              <div className="flex flex-col bg-[#0b1120] p-4 space-y-4 overflow-y-auto">
                {renderDataAssetsInspector(true)}
              </div>
            </div>

            {/* 弹窗底栏 */}
            <div className="flex items-center justify-between border-t border-slate-800 bg-[#0b111f] px-6 py-3">
              <span className="text-[11px] text-slate-400 font-mono">
                所有改动已实时双向绑定至当前算子流水线节点 (DataFrame 契约输出)
              </span>
              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                className="px-4 py-1.5 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 text-xs font-bold text-white transition shadow"
              >
                完成并收起
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
