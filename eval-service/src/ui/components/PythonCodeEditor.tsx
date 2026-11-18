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
  CheckCircle2,
  Code2,
  Copy,
  Maximize2,
  Minimize2,
  Play,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import { evalApi } from '../api.ts';
import { AlgorithmOutputVisualizer } from './AlgorithmOutputVisualizer.tsx';

export interface PythonCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  height?: string;
  readOnly?: boolean;
  upstreamColumns?: string[];
  placeholder?: string;
  enableFullscreenModal?: boolean;
  onRunTest?: () => void;
}

// 基础静态语法与结构守卫校验
function analyzePythonScript(code: string): { valid: boolean; error?: string } {
  if (!code.trim()) {
    return { valid: false, error: '算法代码不能为空' };
  }
  if (!code.includes('def evaluate(context):') && !code.includes('def evaluate(context) :')) {
    return { valid: false, error: '缺少约定主入口: def evaluate(context):' };
  }
  if (!code.includes('return')) {
    return { valid: false, error: '入口函数必须包含 return 返回计算结果字典' };
  }

  // 括号对称性校验
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

  // 常见语法误报检测 (如 0.95. 或尾随非法点符号)
  const lines = code.split('\n');
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx].trim();
    if (line.startsWith('#')) continue;
    // 检查是否存在类似于 0.95. 或 .95. 的异常浮点字面量
    if (/\b\d+\.\d+\.\s*(?:,|}|\)|$)/.test(line)) {
      return { valid: false, error: `第 ${lineIdx + 1} 行存在非法数字格式 (如多余的小数点)` };
    }
  }

  return { valid: true };
}

export function PythonCodeEditor({
  value,
  onChange,
  height = '240px',
  readOnly = false,
  upstreamColumns = [],
  placeholder = '# 编写 Python 3.12 算法代码...',
  enableFullscreenModal = true,
  onRunTest,
}: PythonCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);

  // 沉浸式弹窗内的独立试跑状态
  const [modalTestResult, setModalTestResult] = useState<{
    status: 'success' | 'error';
    output?: any;
    stdout?: string;
    stderr?: string;
    latencyMs?: number;
  } | null>(null);
  const [isModalTesting, setIsModalTesting] = useState(false);

  // 实时分析代码语法与结构
  const scriptStatus = useMemo(() => analyzePythonScript(value), [value]);

  // 自定义智能自动补全数据源 (结合上游规范字段 + Python 常用科学计算库)
  const customPythonCompletions = useMemo(() => {
    return (context: CompletionContext): CompletionResult | null => {
      const word = context.matchBefore(/[\w\.]+/);
      if (!word && !context.explicit) return null;

      const columnOptions = upstreamColumns.map((col) => ({
        label: col,
        type: 'variable',
        detail: '上游入参字段',
        apply: `context.get('${col}', 0.0)`,
      }));

      const builtInOptions = [
        { label: 'context', type: 'variable', detail: '入参上下文字典' },
        { label: 'np.array', type: 'function', detail: '构造 NumPy 矩阵', apply: 'np.array($0)' },
        { label: 'np.mean', type: 'function', detail: '计算均值' },
        { label: 'np.sum', type: 'function', detail: '计算求和' },
        { label: 'np.max', type: 'function', detail: '计算最大值' },
        { label: 'np.min', type: 'function', detail: '计算最小值' },
        { label: 'np.dot', type: 'function', detail: '向量/矩阵点积' },
        { label: 'math.sqrt', type: 'function', detail: '平方根' },
        { label: 'math.exp', type: 'function', detail: '指数函数' },
        { label: 'math.radians', type: 'function', detail: '角度转弧度' },
      ];

      return {
        from: word ? word.from : context.pos,
        options: [...columnOptions, ...builtInOptions],
      };
    };
  }, [upstreamColumns]);

  // 初始化 CodeMirror 实例
  useEffect(() => {
    if (!containerRef.current) return;

    const readOnlyCompartment = new Compartment();
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const newValue = update.state.doc.toString();
        onChange(newValue);
      }
    });

    // 暗黑主题与字体自适应微调
    const customTheme = EditorView.theme({
      '&': {
        height: '100%',
        fontSize: '12px',
        backgroundColor: '#0a0f1d',
      },
      '.cm-scroller': {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
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
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        python(),
        oneDark,
        customTheme,
        keymap.of([indentWithTab]),
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

  // 格式化代码骨架
  const handleFormatCode = () => {
    if (!value.trim()) return;
    // 清洗多余空行与尾随空白
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

  // 沉浸式弹窗内的真机试算
  const handleModalRunTest = async () => {
    setIsModalTesting(true);
    const mockCtx: Record<string, unknown> = {};
    for (const col of upstreamColumns) {
      mockCtx[col] = 100.0;
    }
    const t0 = performance.now();
    try {
      const res = await evalApi.runPythonSandbox({
        script: value,
        context: mockCtx,
      });
      const t1 = performance.now();
      setModalTestResult({
        status: res.status,
        output: res.output,
        stdout: res.stdout,
        stderr: res.stderr,
        latencyMs: res.latencyMs ?? +(t1 - t0).toFixed(2),
      });
    } catch (err: any) {
      const t1 = performance.now();
      setModalTestResult({
        status: 'error',
        stderr: err.message,
        latencyMs: +(t1 - t0).toFixed(2),
      });
    } finally {
      setIsModalTesting(false);
    }
  };

  return (
    <div className="flex flex-col rounded-xl border border-slate-800 bg-[#0a0f1d] overflow-hidden shadow-lg transition-all focus-within:border-fuchsia-500/80">
      {/* ════════════════ 顶部控制栏 (Status & Action Bar) ════════════════ */}
      <div className="flex items-center justify-between border-b border-slate-800/80 bg-[#070b16] px-3 py-1.5 text-xs">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-fuchsia-300">
            <Code2 className="h-3.5 w-3.5 text-fuchsia-400" />
            <span>Python 3.12</span>
          </div>

          {/* 实时语法与入口守卫状态 */}
          {scriptStatus.valid ? (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-1.5 py-0.5 rounded">
              <CheckCircle2 className="h-3 w-3" />
              <span>语法守卫正常</span>
            </span>
          ) : (
            <span
              className="flex items-center gap-1 text-[10px] text-amber-300 bg-amber-950/60 border border-amber-800/60 px-1.5 py-0.5 rounded cursor-help"
              title={scriptStatus.error}
            >
              <AlertCircle className="h-3 w-3 text-amber-400" />
              <span className="truncate max-w-[180px]">{scriptStatus.error}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <button
            type="button"
            onClick={handleFormatCode}
            className="p-1 rounded hover:bg-slate-800 hover:text-slate-200 transition"
            title="整理格式"
          >
            <Sparkles className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded hover:bg-slate-800 hover:text-slate-200 transition"
            title="复制代码"
          >
            <Copy className={`h-3.5 w-3.5 ${copied ? 'text-emerald-400' : ''}`} />
          </button>
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

      {/* ════════════════ CodeMirror 编辑器容器 ════════════════ */}
      <div
        ref={containerRef}
        style={{ height }}
        className="w-full overflow-hidden text-xs font-mono"
      />

      {/* ════════════════ 底部快捷提示栏 ════════════════ */}
      <div className="flex items-center justify-between border-t border-slate-800/80 bg-[#070b16] px-3 py-1 text-[10px] text-slate-500 font-mono">
        <div className="flex items-center gap-2">
          <span>Tab: 缩进4空格</span>
          <span>•</span>
          <span>Ctrl+Space: 上游字段联想</span>
        </div>
        <div>CPython 3.12 守护进程</div>
      </div>

      {/* ════════════════ 沉浸式宽屏工作台 Modal (Zen Mode) ════════════════ */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-6 animate-in fade-in duration-150">
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
                      CodeMirror 6 + CPython
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    大屏算法编辑、上游入参字段实时点注、真机单步沙箱试算闭环
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
              {/* 左侧 2 栏：全尺寸代码编辑 */}
              <div className="lg:col-span-2 border-r border-slate-800 flex flex-col bg-[#080d19]">
                <div className="border-b border-slate-800/80 bg-[#0a0f1d] px-4 py-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300">算法主程序 (evaluate)</span>
                  {scriptStatus.valid ? (
                    <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> 语法校验通过
                    </span>
                  ) : (
                    <span className="text-[10px] text-amber-400 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> {scriptStatus.error}
                    </span>
                  )}
                </div>
                <div className="flex-1 p-2 overflow-auto">
                  <textarea
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    rows={22}
                    className="w-full h-full rounded-lg border border-slate-700/80 bg-[#060a14] p-4 font-mono text-xs text-purple-200 leading-relaxed focus:border-fuchsia-500 focus:outline-none resize-none"
                    spellCheck={false}
                  />
                </div>
              </div>

              {/* 右侧 1 栏：上游字段托盘与即时真机试算反馈 */}
              <div className="flex flex-col bg-[#0b1120] p-4 space-y-4 overflow-y-auto">
                {/* 上游字段点击注入 */}
                <div className="rounded-xl border border-slate-800 bg-[#070b16] p-3 space-y-2">
                  <div className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                    <span>💡 上游可用入参字段</span>
                    <span className="text-[10px] text-slate-500">{upstreamColumns.length} 个字段</span>
                  </div>
                  {upstreamColumns.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                      {upstreamColumns.map((col) => (
                        <button
                          key={col}
                          type="button"
                          onClick={() => {
                            const snippet = `    ${col.toLowerCase()} = context.get('${col}', 0.0)\n`;
                            if (value.includes('def evaluate(context):')) {
                              onChange(
                                value.replace('def evaluate(context):\n', `def evaluate(context):\n${snippet}`),
                              );
                            } else {
                              onChange(`${value}\n${snippet}`);
                            }
                          }}
                          className="px-2 py-1 rounded bg-fuchsia-950/70 border border-fuchsia-800/60 text-[10px] font-mono text-fuchsia-300 hover:bg-fuchsia-900 hover:text-white transition"
                          title="点击在 evaluate 函数首部插入该字段读取代码"
                        >
                          + {col}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500">上游暂无流转字段（独立纯算法节点）</div>
                  )}
                </div>

                {/* 真机试算操作 */}
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={handleModalRunTest}
                    disabled={isModalTesting}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 text-xs font-bold text-white transition shadow-lg disabled:opacity-50"
                  >
                    <Play className={`h-4 w-4 ${isModalTesting ? 'animate-spin' : ''}`} />
                    <span>{isModalTesting ? '正在真机试算...' : '▷ 运行单步真机试算 (CPython 3.12)'}</span>
                  </button>
                </div>

                {/* 试算输出结果 */}
                {modalTestResult && (
                  <div className="rounded-xl border border-slate-800 bg-[#070b16] p-3 space-y-2 flex-1">
                    <div className="flex items-center justify-between text-xs">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          modalTestResult.status === 'success'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : 'bg-red-950 text-red-300 border border-red-800'
                        }`}
                      >
                        {modalTestResult.status === 'success' ? '✔ 运行通过' : '✖ 运行异常'}
                      </span>
                      <span className="text-[10px] font-mono text-cyan-400">
                        {modalTestResult.latencyMs} ms
                      </span>
                    </div>

                    {modalTestResult.output && (
                      <AlgorithmOutputVisualizer output={modalTestResult.output} title="试算产出可视化" />
                    )}

                    {modalTestResult.stdout && (
                      <div className="space-y-1">
                        <div className="text-[10px] text-slate-400 flex items-center gap-1">
                          <Terminal className="h-3 w-3" /> 控制台输出 (stdout):
                        </div>
                        <pre className="text-[10px] font-mono text-slate-300 bg-black/40 p-2 rounded max-h-24 overflow-auto">
                          {modalTestResult.stdout}
                        </pre>
                      </div>
                    )}

                    {modalTestResult.stderr && (
                      <div className="text-[10px] font-mono text-red-400 bg-red-950/40 p-2 rounded border border-red-900/60">
                        {modalTestResult.stderr}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 弹窗底栏 */}
            <div className="flex items-center justify-between border-t border-slate-800 bg-[#0b111f] px-6 py-3">
              <span className="text-[11px] text-slate-400 font-mono">
                所有改动已实时双向绑定至当前算子流水线节点
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
