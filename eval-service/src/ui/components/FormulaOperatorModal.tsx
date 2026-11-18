import {
  AlertCircle,
  Calculator,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Eye,
  Info,
  Maximize2,
  Minimize2,
  Plus,
  Play,
  RotateCcw,
  Sparkles,
  Table,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  DatasetColumn,
  DerivedColumnConfig,
  FieldDataType,
  FormulaOperatorConfig,
  TableDataset,
} from '../api.ts';
import { evalApi } from '../api.ts';
import {
  evaluateFormulaDataset,
  parseFormulaAST,
  sortDerivedColumns,
  tokenizeFormula,
} from '../../operators/formula-engine.ts';

export interface FormulaOperatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialConfig?: FormulaOperatorConfig;
  upstreamColumns?: DatasetColumn[];
  sampleDataset?: TableDataset;
  onSave: (config: FormulaOperatorConfig) => void;
  readOnly?: boolean;
}

// 常用函数定义库（四大分类）
interface FunctionDocItem {
  name: string;
  cnName: string;
  category: 'math' | 'logic' | 'text' | 'datetime';
  signature: string;
  snippet: string;
  cursorOffsetInside: number;
  description: string;
  example: string;
}

const FUNCTION_LIBRARY: FunctionDocItem[] = [
  // 数学运算
  {
    name: 'ROUND',
    cnName: '四舍五入',
    category: 'math',
    signature: 'ROUND(value; digits)',
    snippet: 'ROUND(; 2)',
    cursorOffsetInside: 4,
    description: '对数值进行四舍五入，保留指定小数位数。',
    example: 'ROUND(TargetRange_nm * 1.852; 2)',
  },
  {
    name: 'TRUNC',
    cnName: '截断取整',
    category: 'math',
    signature: 'TRUNC(value; digits)',
    snippet: 'TRUNC(; 0)',
    cursorOffsetInside: 4,
    description: '直接截断到指定小数位数，不进行四舍五入。',
    example: 'TRUNC(Speed_kt; 0)',
  },
  {
    name: 'ABS',
    cnName: '绝对值',
    category: 'math',
    signature: 'ABS(number)',
    snippet: 'ABS()',
    cursorOffsetInside: 1,
    description: '返回数值的绝对值（非负数）。',
    example: 'ABS(ActualLon - ExpectedLon)',
  },
  {
    name: 'SQRT',
    cnName: '平方根',
    category: 'math',
    signature: 'SQRT(number)',
    snippet: 'SQRT()',
    cursorOffsetInside: 1,
    description: '返回数值的正平方根。',
    example: 'SQRT(DeltaX ^ 2 + DeltaY ^ 2)',
  },
  {
    name: 'MOD',
    cnName: '取模求余',
    category: 'math',
    signature: 'MOD(dividend; divisor)',
    snippet: 'MOD(; )',
    cursorOffsetInside: 3,
    description: '返回两数相除后的余数。',
    example: 'MOD(HeadingDeg; 360)',
  },
  {
    name: 'POWER',
    cnName: '乘幂运算',
    category: 'math',
    signature: 'POWER(base; exp)',
    snippet: 'POWER(; 2)',
    cursorOffsetInside: 4,
    description: '计算底数的指定次幂。',
    example: 'POWER(SpeedRatio; 2)',
  },
  {
    name: 'CLAMP',
    cnName: '区间截断',
    category: 'math',
    signature: 'CLAMP(val; min; max)',
    snippet: 'CLAMP(; 0; 100)',
    cursorOffsetInside: 8,
    description: '将数值限制在 [min, max] 闭区间内。',
    example: 'CLAMP(HitRate * 100; 0; 100)',
  },
  {
    name: 'CEIL',
    cnName: '向上取整',
    category: 'math',
    signature: 'CEIL(number)',
    snippet: 'CEIL()',
    cursorOffsetInside: 1,
    description: '返回大于或等于指定数值的最小整数。',
    example: 'CEIL(MissileCount / 2)',
  },
  {
    name: 'FLOOR',
    cnName: '向下取整',
    category: 'math',
    signature: 'FLOOR(number)',
    snippet: 'FLOOR()',
    cursorOffsetInside: 1,
    description: '返回小于或等于指定数值的最大整数。',
    example: 'FLOOR(FlightTimeSec / 60)',
  },
  {
    name: 'MAX',
    cnName: '最大值',
    category: 'math',
    signature: 'MAX(a; b; ...)',
    snippet: 'MAX(; )',
    cursorOffsetInside: 3,
    description: '返回参数列表中的最大数值。',
    example: 'MAX(Speed_kt; MinSafeSpeed)',
  },
  {
    name: 'MIN',
    cnName: '最小值',
    category: 'math',
    signature: 'MIN(a; b; ...)',
    snippet: 'MIN(; )',
    cursorOffsetInside: 3,
    description: '返回参数列表中的最小数值。',
    example: 'MIN(CombatAltitude; 12000)',
  },
  {
    name: 'AVG',
    cnName: '参数均值',
    category: 'math',
    signature: 'AVG(a; b; ...)',
    snippet: 'AVG(; )',
    cursorOffsetInside: 3,
    description: '计算给定参数的算术平均值。',
    example: 'AVG(Speed1; Speed2; Speed3)',
  },

  // 逻辑分支
  {
    name: 'IF',
    cnName: '条件判断',
    category: 'logic',
    signature: 'IF(condition; val_true; val_false)',
    snippet: 'IF(; "YES"; "NO")',
    cursorOffsetInside: 14,
    description: '根据逻辑条件返回不同结果分支。',
    example: 'IF(Damage_Percent >= 80; "Destroyed"; "Active")',
  },
  {
    name: 'AND',
    cnName: '逻辑与',
    category: 'logic',
    signature: 'AND(cond1; cond2; ...)',
    snippet: 'AND(; )',
    cursorOffsetInside: 3,
    description: '当且仅当所有条件为真时返回 TRUE。',
    example: 'AND(Range_nm <= 50; Altitude_m >= 2000)',
  },
  {
    name: 'OR',
    cnName: '逻辑或',
    category: 'logic',
    signature: 'OR(cond1; cond2; ...)',
    snippet: 'OR(; )',
    cursorOffsetInside: 3,
    description: '任一条件为真时返回 TRUE。',
    example: 'OR(IsLeader = TRUE; Rank >= 3)',
  },
  {
    name: 'NOT',
    cnName: '逻辑非',
    category: 'logic',
    signature: 'NOT(condition)',
    snippet: 'NOT()',
    cursorOffsetInside: 1,
    description: '反转逻辑表达式的布尔真假值。',
    example: 'NOT(IsFriendly)',
  },
  {
    name: 'SWITCH',
    cnName: '多分支匹配',
    category: 'logic',
    signature: 'SWITCH(expr; case1; val1; default)',
    snippet: 'SWITCH(; "A"; 1; 0)',
    cursorOffsetInside: 12,
    description: '根据表达式取值多重分支匹配。',
    example: 'SWITCH(UnitType; "Fighter"; 10; "Bomber"; 20; 5)',
  },
  {
    name: 'COALESCE',
    cnName: '首次非空',
    category: 'logic',
    signature: 'COALESCE(val1; val2; ...)',
    snippet: 'COALESCE(; 0)',
    cursorOffsetInside: 4,
    description: '依次求值并返回第一个非 NULL 的有效值。',
    example: 'COALESCE(DirectHitScore; FallbackScore; 0)',
  },
  {
    name: 'IFNULL',
    cnName: '空值替补',
    category: 'logic',
    signature: 'IFNULL(val; fallback)',
    snippet: 'IFNULL(; 0)',
    cursorOffsetInside: 4,
    description: '当首个参数为 NULL 时使用默认值替补。',
    example: 'IFNULL(MissileSpeed; 0)',
  },

  // 文本处理
  {
    name: 'CONCATENATE',
    cnName: '文本拼接',
    category: 'text',
    signature: 'CONCATENATE(text1; text2; ...)',
    snippet: 'CONCATENATE(; )',
    cursorOffsetInside: 3,
    description: '将多个字符串或字段顺序合并为一个完整文本。',
    example: 'CONCATENATE(Side; "_"; UnitName)',
  },
  {
    name: 'LEFT',
    cnName: '左侧截取',
    category: 'text',
    signature: 'LEFT(text; count)',
    snippet: 'LEFT(; 4)',
    cursorOffsetInside: 4,
    description: '从文本开头截取指定数量字符。',
    example: 'LEFT(UnitID; 3)',
  },
  {
    name: 'RIGHT',
    cnName: '右侧截取',
    category: 'text',
    signature: 'RIGHT(text; count)',
    snippet: 'RIGHT(; 4)',
    cursorOffsetInside: 4,
    description: '从文本末尾截取指定数量字符。',
    example: 'RIGHT(Timestamp; 8)',
  },
  {
    name: 'MID',
    cnName: '中段截取',
    category: 'text',
    signature: 'MID(text; start; count)',
    snippet: 'MID(; 1; 4)',
    cursorOffsetInside: 7,
    description: '从文本指定索引起截取指定字符数。',
    example: 'MID(SerialNo; 2; 5)',
  },
  {
    name: 'LEN',
    cnName: '字符长度',
    category: 'text',
    signature: 'LEN(text)',
    snippet: 'LEN()',
    cursorOffsetInside: 1,
    description: '统计字符串所包含的字符总数。',
    example: 'LEN(Description)',
  },
  {
    name: 'LOWER',
    cnName: '转换为小写',
    category: 'text',
    signature: 'LOWER(text)',
    snippet: 'LOWER()',
    cursorOffsetInside: 1,
    description: '将字符串内所有英文字符转换为小写。',
    example: 'LOWER(CallSign)',
  },
  {
    name: 'UPPER',
    cnName: '转换为大写',
    category: 'text',
    signature: 'UPPER(text)',
    snippet: 'UPPER()',
    cursorOffsetInside: 1,
    description: '将字符串内所有英文字符转换为大写。',
    example: 'UPPER(UnitRole)',
  },
  {
    name: 'TRIM',
    cnName: '清除首尾空白',
    category: 'text',
    signature: 'TRIM(text)',
    snippet: 'TRIM()',
    cursorOffsetInside: 1,
    description: '移除文本前后的空格与不可见符号。',
    example: 'TRIM(RawCode)',
  },

  // 日期时间
  {
    name: 'DATEDIFF',
    cnName: '时间差计算',
    category: 'datetime',
    signature: 'DATEDIFF(unit; date1; date2)',
    snippet: 'DATEDIFF("second"; ; )',
    cursorOffsetInside: 3,
    description: '计算两个时间点在指定单位下的差值（date2 - date1）。',
    example: 'DATEDIFF("second"; LaunchTime; HitTime)',
  },
  {
    name: 'DATEADD',
    cnName: '时间偏移递增',
    category: 'datetime',
    signature: 'DATEADD(unit; amount; date)',
    snippet: 'DATEADD("second"; 10; )',
    cursorOffsetInside: 1,
    description: '在基准时间戳上增加指定数量的秒/分/小时。',
    example: 'DATEADD("second"; 120; StartClock)',
  },
  {
    name: 'YEAR',
    cnName: '提取年份',
    category: 'datetime',
    signature: 'YEAR(date)',
    snippet: 'YEAR()',
    cursorOffsetInside: 1,
    description: '从日期时间字段中提取四位数字年份。',
    example: 'YEAR(CreatedDate)',
  },
  {
    name: 'MONTH',
    cnName: '提取月份',
    category: 'datetime',
    signature: 'MONTH(date)',
    snippet: 'MONTH()',
    cursorOffsetInside: 1,
    description: '从日期时间字段中提取 1-12 月份数。',
    example: 'MONTH(CreatedDate)',
  },
  {
    name: 'DAY',
    cnName: '提取日',
    category: 'datetime',
    signature: 'DAY(date)',
    snippet: 'DAY()',
    cursorOffsetInside: 1,
    description: '从日期时间字段中提取日（1-31）。',
    example: 'DAY(CreatedDate)',
  },
];

const DEFAULT_UPSTREAM_COLUMNS: DatasetColumn[] = [
  { name: 'Entity_ID', type: 'string', description: '作战实体唯一编号' },
  { name: 'Side', type: 'string', description: '战术阵营 (Red/Blue)' },
  { name: 'UnitName', type: 'string', description: '战机/舰艇名称' },
  { name: 'TargetContactRangeHoriz_nm', type: 'number', description: '目标水平接触测距 (海里)' },
  { name: 'Speed_kt', type: 'number', description: '实时航速 (节)' },
  { name: 'Altitude_m', type: 'number', description: '高度 (米)' },
  { name: 'Damage_Percent', type: 'number', description: '战损损伤百分比 (0-100)' },
  { name: 'WeaponCount', type: 'number', description: '挂载可用弹药数' },
  { name: 'IsHit', type: 'boolean', description: '末端武器命中命中指示' },
];

const DEFAULT_SAMPLE_DATASET: TableDataset = {
  columns: DEFAULT_UPSTREAM_COLUMNS,
  rows: [
    {
      Entity_ID: 'U-101',
      Side: 'Red',
      UnitName: 'Su-35 #1',
      TargetContactRangeHoriz_nm: 48.5,
      Speed_kt: 520,
      Altitude_m: 8500,
      Damage_Percent: 12.5,
      WeaponCount: 4,
      IsHit: true,
    },
    {
      Entity_ID: 'U-102',
      Side: 'Red',
      UnitName: 'Su-35 #2',
      TargetContactRangeHoriz_nm: 54.2,
      Speed_kt: 545,
      Altitude_m: 8800,
      Damage_Percent: 0.0,
      WeaponCount: 6,
      IsHit: false,
    },
    {
      Entity_ID: 'U-103',
      Side: 'Blue',
      UnitName: 'F-16V #1',
      TargetContactRangeHoriz_nm: 36.8,
      Speed_kt: 480,
      Altitude_m: 7200,
      Damage_Percent: 85.0,
      WeaponCount: 2,
      IsHit: true,
    },
    {
      Entity_ID: 'U-104',
      Side: 'Blue',
      UnitName: 'F-16V #2',
      TargetContactRangeHoriz_nm: 62.1,
      Speed_kt: 510,
      Altitude_m: 9100,
      Damage_Percent: 24.0,
      WeaponCount: 4,
      IsHit: false,
    },
    {
      Entity_ID: 'U-105',
      Side: 'Blue',
      UnitName: 'E-2D AEW',
      TargetContactRangeHoriz_nm: 110.0,
      Speed_kt: 320,
      Altitude_m: 10500,
      Damage_Percent: 0.0,
      WeaponCount: 0,
      IsHit: false,
    },
  ],
};

const OPERATOR_BUTTONS = [
  { label: '+', insert: ' + ', title: '加法' },
  { label: '-', insert: ' - ', title: '减法' },
  { label: '*', insert: ' * ', title: '乘法' },
  { label: '/', insert: ' / ', title: '除法' },
  { label: '^', insert: ' ^ ', title: '幂运算' },
  { label: '(', insert: '(', title: '左括号' },
  { label: ')', insert: ')', title: '右括号' },
  { label: '>', insert: ' > ', title: '大于' },
  { label: '<', insert: ' < ', title: '小于' },
  { label: '>=', insert: ' >= ', title: '大于等于' },
  { label: '<=', insert: ' <= ', title: '小于等于' },
  { label: '=', insert: ' = ', title: '等于' },
  { label: '<>', insert: ' <> ', title: '不等于' },
  { label: ';', insert: '; ', title: '参数分隔符' },
];

export function FormulaOperatorModal({
  isOpen,
  onClose,
  initialConfig,
  upstreamColumns = DEFAULT_UPSTREAM_COLUMNS,
  sampleDataset = DEFAULT_SAMPLE_DATASET,
  onSave,
  readOnly = false,
}: FormulaOperatorModalProps) {
  const headingId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 衍生列清单
  const [columns, setColumns] = useState<DerivedColumnConfig[]>(() => {
    if (initialConfig?.derivedColumns && initialConfig.derivedColumns.length > 0) {
      return initialConfig.derivedColumns.map((col, idx) => ({
        id: col.id || `col_${idx + 1}`,
        columnName: col.columnName || `calc_col_${idx + 1}`,
        dataType: col.dataType || 'number',
        expression: col.expression || '',
        overwriteColumn: col.overwriteColumn || '',
        description: col.description || '',
      }));
    }
    return [
      {
        id: 'col_1',
        columnName: 'target_range_km',
        dataType: 'number',
        expression: 'ROUND(TargetContactRangeHoriz_nm * 1.852; 2)',
        overwriteColumn: '',
        description: '将海里测距换算为公里',
      },
    ];
  });

  const [activeIdx, setActiveIdx] = useState<number>(0);
  const activeCol = columns[activeIdx] ?? columns[0];

  // 函数库分类 Tab: 数学运算 | 逻辑分支 | 文本处理 | 日期时间
  const [funcTab, setFuncTab] = useState<'math' | 'logic' | 'text' | 'datetime'>('math');
  const [funcSearch, setFuncSearch] = useState('');

  // 预览状态
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [previewData, setPreviewData] = useState<TableDataset | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLatencyMs, setPreviewLatencyMs] = useState<number>(0);

  // 同步初态
  useEffect(() => {
    if (initialConfig?.derivedColumns && initialConfig.derivedColumns.length > 0) {
      setColumns(
        initialConfig.derivedColumns.map((col, idx) => ({
          id: col.id || `col_${idx + 1}`,
          columnName: col.columnName || `calc_col_${idx + 1}`,
          dataType: col.dataType || 'number',
          expression: col.expression || '',
          overwriteColumn: col.overwriteColumn || '',
          description: col.description || '',
        })),
      );
      setActiveIdx(0);
    }
  }, [initialConfig]);

  // 更新当前选中的衍生列
  const updateActiveColumn = (partial: Partial<DerivedColumnConfig>) => {
    if (activeIdx < 0 || activeIdx >= columns.length) return;
    setColumns((prev) => {
      const copy = [...prev];
      copy[activeIdx] = { ...copy[activeIdx]!, ...partial };
      return copy;
    });
  };

  // 新增衍生列
  const handleAddColumn = () => {
    const newIdx = columns.length + 1;
    const newCol: DerivedColumnConfig = {
      id: `col_${Date.now()}_${newIdx}`,
      columnName: `calc_field_${newIdx}`,
      dataType: 'number',
      expression: '',
      overwriteColumn: '',
      description: '',
    };
    setColumns((prev) => [...prev, newCol]);
    setActiveIdx(columns.length);
  };

  // 删除衍生列
  const handleDeleteColumn = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (columns.length <= 1) {
      alert('请保留至少一个衍生计算列。');
      return;
    }
    const next = columns.filter((_, i) => i !== index);
    setColumns(next);
    if (activeIdx >= next.length) {
      setActiveIdx(Math.max(0, next.length - 1));
    } else if (activeIdx === index) {
      setActiveIdx(Math.max(0, index - 1));
    }
  };

  // 光标处插入文本
  const insertTextAtCursor = (text: string, cursorOffsetInside = 0) => {
    const el = textareaRef.current;
    if (!el || !activeCol) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.substring(0, start);
    const after = el.value.substring(end);
    const nextExpr = before + text + after;
    updateActiveColumn({ expression: nextExpr });

    setTimeout(() => {
      el.focus();
      const pos = start + text.length - cursorOffsetInside;
      el.setSelectionRange(pos, pos);
    }, 15);
  };

  // 语法实时校验
  const validationStatus = useMemo(() => {
    if (!activeCol || !activeCol.expression.trim()) {
      return { valid: false, message: '请输入公式表达式' };
    }
    try {
      tokenizeFormula(activeCol.expression);
      parseFormulaAST(activeCol.expression);
      return { valid: true, message: 'LibFormula 语法校验通过' };
    } catch (err) {
      return {
        valid: false,
        message: err instanceof Error ? err.message : '公式语法错误，请检查括号与参数',
      };
    }
  }, [activeCol?.expression]);

  // 全量衍生列循环依赖校验
  const dependencyValidation = useMemo(() => {
    try {
      sortDerivedColumns(columns);
      return { hasCycle: false };
    } catch (err) {
      return {
        hasCycle: true,
        message: err instanceof Error ? err.message : '检测到衍生列循环依赖',
      };
    }
  }, [columns]);

  // 过滤后的函数库
  const filteredFunctions = useMemo(() => {
    const q = funcSearch.trim().toLowerCase();
    return FUNCTION_LIBRARY.filter((item) => {
      if (item.category !== funcTab) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.cnName.includes(q) ||
        item.description.includes(q)
      );
    });
  }, [funcTab, funcSearch]);

  // 执行输出预览
  const handleExecutePreview = async () => {
    setShowPreview(true);
    setPreviewError(null);
    const t0 = performance.now();
    try {
      // 优先调用本地安全引擎或者后端 API
      const result = evaluateFormulaDataset(sampleDataset, {
        derivedColumns: columns,
      });
      setPreviewData(result);
      setPreviewLatencyMs(Math.round(performance.now() - t0));
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
      setPreviewData(null);
    }
  };

  // 保存并提交
  const handleConfirm = () => {
    if (dependencyValidation.hasCycle) {
      alert(`无法保存：${dependencyValidation.message}`);
      return;
    }
    const emptyExpr = columns.find((c) => !c.expression.trim());
    if (emptyExpr) {
      alert(`请为衍生列「${emptyExpr.columnName}」输入计算公式。`);
      return;
    }
    onSave({
      derivedColumns: columns,
      upstreamColumns,
    });
    onClose();
  };

  if (!isOpen) return null;

  const derivedColNames = new Set(columns.map((c) => c.columnName));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
    >
      <div className="flex h-[92vh] w-full max-w-[1320px] flex-col overflow-hidden rounded-xl border border-[#1e293b] bg-[#0b1120] text-[#f1f5f9] shadow-2xl">
        {/* Header (严格对齐 Image 2) */}
        <header className="flex items-center justify-between border-b border-[#1e293b] bg-[#0f172a] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-400">
              <Calculator className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 id={headingId} className="text-base font-bold text-white tracking-wide">
                  公式计算
                </h2>
                <span className="rounded-md border border-sky-500/30 bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300">
                  行内计算 · LibFormula
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-400">
                在此节点中为数据集新增或衍生计算列。支持行内四则运算、函数嵌套 (LibFormula 语法) 及多字段逻辑处理。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭弹窗"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-[#1e293b] hover:text-white transition"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Main Body: Left (衍生列清单) + Right (编辑面板) */}
        <div className="flex flex-1 min-h-0 divide-x divide-[#1e293b] overflow-hidden">
          {/* 左侧：衍生列清单 (N) */}
          <aside className="flex w-72 flex-col bg-[#090e17] shrink-0">
            <div className="flex items-center justify-between border-b border-[#1e293b] px-4 py-3">
              <span className="text-xs font-semibold text-slate-300">
                衍生列清单 ({columns.length})
              </span>
              <button
                type="button"
                onClick={handleAddColumn}
                disabled={readOnly}
                className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/15 px-2 py-1 text-[11px] font-medium text-sky-300 hover:bg-sky-500/25 transition disabled:opacity-50"
              >
                <Plus className="h-3 w-3" />
                新增衍生列
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {columns.map((col, idx) => {
                const isActive = idx === activeIdx;
                const isConfigured = Boolean(col.expression.trim());
                return (
                  <div
                    key={col.id || idx}
                    onClick={() => setActiveIdx(idx)}
                    className={`group flex items-center justify-between rounded-lg border p-2.5 text-xs cursor-pointer transition ${
                      isActive
                        ? 'border-sky-500 bg-sky-500/15 shadow-sm'
                        : 'border-[#1e293b] bg-[#0f172a] hover:border-slate-600'
                    }`}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-slate-400">#{idx + 1}</span>
                        <span className="font-medium text-slate-200 truncate">
                          {col.columnName || '未命名列'}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="rounded bg-[#1e293b] px-1.5 py-0.2 text-[10px] font-mono text-slate-300 uppercase">
                          {col.dataType}
                        </span>
                        {isConfigured ? (
                          <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                            <Check className="h-2.5 w-2.5" /> 已配置
                          </span>
                        ) : (
                          <span className="text-[10px] text-amber-400">未设置公式</span>
                        )}
                      </div>
                    </div>
                    {columns.length > 1 && !readOnly && (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteColumn(idx, e)}
                        title="删除该衍生列"
                        className="rounded p-1 text-slate-500 opacity-60 hover:opacity-100 hover:bg-rose-500/20 hover:text-rose-300 transition"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {dependencyValidation.hasCycle && (
              <div className="m-2 rounded-md border border-rose-500/40 bg-rose-500/10 p-2 text-[11px] text-rose-300">
                <AlertCircle className="inline h-3.5 w-3.5 mr-1" />
                {dependencyValidation.message}
              </div>
            )}
          </aside>

          {/* 右侧：当前衍生列配置 */}
          <main className="flex flex-1 flex-col overflow-y-auto bg-[#0b1120] p-6 space-y-5">
            {activeCol ? (
              <>
                {/* 1. 基础字段属性栏 */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      衍生列名称<span className="text-rose-400 ml-0.5">*</span>
                    </label>
                    <input
                      type="text"
                      value={activeCol.columnName}
                      disabled={readOnly}
                      onChange={(e) => updateActiveColumn({ columnName: e.target.value })}
                      placeholder="例如: damage_ratio"
                      className="w-full rounded-md border border-[#1e293b] bg-[#090e17] px-3 py-1.5 font-mono text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      数据类型
                    </label>
                    <select
                      value={activeCol.dataType}
                      disabled={readOnly}
                      onChange={(e) =>
                        updateActiveColumn({ dataType: e.target.value as FieldDataType })
                      }
                      className="w-full rounded-md border border-[#1e293b] bg-[#090e17] px-3 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    >
                      <option value="number">Number (数值型)</option>
                      <option value="string">String (文本型)</option>
                      <option value="boolean">Boolean (布尔型)</option>
                      <option value="datetime">DateTime (日期时间)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      覆盖已有字段 (可选)
                    </label>
                    <select
                      value={activeCol.overwriteColumn || ''}
                      disabled={readOnly}
                      onChange={(e) => updateActiveColumn({ overwriteColumn: e.target.value })}
                      className="w-full rounded-md border border-[#1e293b] bg-[#090e17] px-3 py-1.5 text-xs text-white focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    >
                      <option value="">-- 不覆盖 (作为新字段) --</option>
                      {upstreamColumns.map((col) => (
                        <option key={col.name} value={col.name}>
                          覆盖: {col.name} ({col.type})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 2. 上游输入字段 (点击插入) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-300">
                      上游输入字段 (点击插入公式)
                    </span>
                    <span className="text-[11px] text-slate-500">
                      点击字段标签自动插入至当前光标位置
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 rounded-lg border border-[#1e293b] bg-[#0f172a] p-2.5">
                    {upstreamColumns.map((col) => (
                      <button
                        key={col.name}
                        type="button"
                        disabled={readOnly}
                        onClick={() => insertTextAtCursor(col.name)}
                        title={`${col.description || col.name} [${col.type}]`}
                        className="inline-flex items-center gap-1 rounded-md border border-[#334155] bg-[#090e17] px-2 py-1 font-mono text-[11px] text-sky-200 hover:border-sky-400 hover:bg-sky-500/10 transition"
                      >
                        <span>{col.name}</span>
                        <span className="text-[9px] text-slate-400">({col.type})</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. 快捷运算符 */}
                <div>
                  <span className="block text-xs font-semibold text-slate-300 mb-1.5">
                    快捷运算符
                  </span>
                  <div className="grid grid-cols-7 sm:grid-cols-14 gap-1.5 rounded-lg border border-[#1e293b] bg-[#0f172a] p-2.5">
                    {OPERATOR_BUTTONS.map((op) => (
                      <button
                        key={op.label}
                        type="button"
                        disabled={readOnly}
                        onClick={() => insertTextAtCursor(op.insert)}
                        title={op.title}
                        className="flex h-8 items-center justify-center rounded border border-[#334155] bg-[#090e17] font-mono text-xs font-bold text-slate-200 hover:border-sky-400 hover:bg-sky-500/20 hover:text-white transition"
                      >
                        {op.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 4. 常用函数库 (Tabs: 数学运算, 逻辑分支, 文本处理, 日期时间) */}
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1 border-b border-[#1e293b]">
                      <button
                        type="button"
                        onClick={() => setFuncTab('math')}
                        className={`px-3 py-1 text-xs font-medium border-b-2 transition ${
                          funcTab === 'math'
                            ? 'border-sky-400 text-sky-300'
                            : 'border-transparent text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        数学运算
                      </button>
                      <button
                        type="button"
                        onClick={() => setFuncTab('logic')}
                        className={`px-3 py-1 text-xs font-medium border-b-2 transition ${
                          funcTab === 'logic'
                            ? 'border-sky-400 text-sky-300'
                            : 'border-transparent text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        逻辑分支
                      </button>
                      <button
                        type="button"
                        onClick={() => setFuncTab('text')}
                        className={`px-3 py-1 text-xs font-medium border-b-2 transition ${
                          funcTab === 'text'
                            ? 'border-sky-400 text-sky-300'
                            : 'border-transparent text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        文本处理
                      </button>
                      <button
                        type="button"
                        onClick={() => setFuncTab('datetime')}
                        className={`px-3 py-1 text-xs font-medium border-b-2 transition ${
                          funcTab === 'datetime'
                            ? 'border-sky-400 text-sky-300'
                            : 'border-transparent text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        日期时间
                      </button>
                    </div>

                    <input
                      type="text"
                      value={funcSearch}
                      onChange={(e) => setFuncSearch(e.target.value)}
                      placeholder="搜索函数名 / 释义…"
                      className="rounded border border-[#1e293b] bg-[#090e17] px-2.5 py-1 text-[11px] text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 max-h-48 overflow-y-auto rounded-lg border border-[#1e293b] bg-[#0f172a] p-2.5">
                    {filteredFunctions.map((fn) => (
                      <div
                        key={fn.name}
                        onClick={() => insertTextAtCursor(fn.snippet, fn.cursorOffsetInside)}
                        title={`点击插入 ${fn.signature}\n示例: ${fn.example}`}
                        className="group flex flex-col justify-between rounded border border-[#1e293b] bg-[#090e17] p-2 text-left cursor-pointer hover:border-sky-500 hover:bg-sky-500/10 transition"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-bold text-sky-300">
                            {fn.name}
                          </span>
                          <span className="text-[10px] text-slate-400">{fn.cnName}</span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-400 line-clamp-1">
                          {fn.description}
                        </p>
                        <div className="mt-1 font-mono text-[10px] text-slate-500 truncate group-hover:text-slate-300">
                          {fn.signature}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 5. 计算公式表达式 (LibFormula 语法)* */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-300">
                      计算公式表达式 (LibFormula 语法)<span className="text-rose-400 ml-0.5">*</span>
                    </label>
                    {/* Live Validation Badge */}
                    <div
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${
                        validationStatus.valid
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                          : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                      }`}
                    >
                      {validationStatus.valid ? (
                        <>
                          <Check className="h-3 w-3" />
                          <span>{validationStatus.message}</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="h-3 w-3" />
                          <span className="truncate max-w-[280px]">
                            {validationStatus.message}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <textarea
                    ref={textareaRef}
                    rows={4}
                    value={activeCol.expression}
                    disabled={readOnly}
                    onChange={(e) => updateActiveColumn({ expression: e.target.value })}
                    placeholder='例如: IF(Damage_Percent >= 80; "Destroyed"; ROUND(TargetContactRangeHoriz_nm * 1.852; 2))'
                    className="w-full rounded-lg border border-[#1e293b] bg-[#090e17] p-3 font-mono text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />

                  <div className="mt-1.5 flex flex-wrap items-center justify-between text-[11px] text-slate-400">
                    <span>提示：字符串使用双引号包裹，参数分隔使用分号 (;) 或逗号 (,)。</span>
                    <button
                      type="button"
                      onClick={() =>
                        updateActiveColumn({
                          expression: 'ROUND(TargetContactRangeHoriz_nm * 1.852; 2)',
                        })
                      }
                      className="text-sky-400 hover:underline"
                    >
                      填入示例: 射距海里转公里
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-slate-500">
                请在左侧选择或添加衍生列
              </div>
            )}
          </main>
        </div>

        {/* 预览抽屉 (Output Preview Drawer) */}
        {showPreview && (
          <div className="border-t border-[#1e293b] bg-[#090e17] p-4 max-h-72 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Table className="h-4 w-4 text-sky-400" />
                <h4 className="text-xs font-semibold text-white">
                  输出样本预览
                </h4>
                {previewLatencyMs > 0 && (
                  <span className="rounded bg-[#1e293b] px-1.5 py-0.5 text-[10px] text-slate-400 font-mono">
                    {previewLatencyMs} ms
                  </span>
                )}
                <span className="text-[11px] text-slate-400">
                  （蓝色高亮列为新增/覆盖的衍生计算列）
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowPreview(false)}
                className="text-xs text-slate-400 hover:text-white"
              >
                收起预览
              </button>
            </div>

            {previewError ? (
              <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
                <AlertCircle className="inline h-4 w-4 mr-1.5" />
                预览求值失败: {previewError}
              </div>
            ) : previewData ? (
              <div className="overflow-x-auto rounded border border-[#1e293b]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#0f172a] text-slate-400 border-b border-[#1e293b]">
                    <tr>
                      <th className="px-3 py-2 text-[11px]">#</th>
                      {previewData.columns.map((col) => {
                        const isDerived = derivedColNames.has(col.name);
                        return (
                          <th
                            key={col.name}
                            className={`px-3 py-2 font-mono ${
                              isDerived
                                ? 'bg-sky-950/60 text-sky-300 border-l border-r border-sky-500/40'
                                : 'text-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-1">
                              <span>{col.name}</span>
                              {isDerived && (
                                <span className="rounded bg-sky-500/20 px-1 py-0.2 text-[9px] text-sky-300 border border-sky-500/30">
                                  衍生
                                </span>
                              )}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e293b]">
                    {previewData.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-[#0f172a]/60">
                        <td className="px-3 py-2 font-mono text-slate-500">{rIdx + 1}</td>
                        {previewData.columns.map((col) => {
                          const isDerived = derivedColNames.has(col.name);
                          const val = row[col.name];
                          return (
                            <td
                              key={col.name}
                              className={`px-3 py-2 font-mono ${
                                isDerived
                                  ? 'bg-sky-500/10 text-sky-100 font-semibold border-l border-r border-sky-500/20'
                                  : 'text-slate-300'
                              }`}
                            >
                              {val === null || val === undefined
                                ? 'NULL'
                                : typeof val === 'boolean'
                                  ? val ? 'TRUE' : 'FALSE'
                                  : String(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        )}

        {/* Footer (对齐 Image 2: [输出预览], [取消], [确定]) */}
        <footer className="flex items-center justify-between border-t border-[#1e293b] bg-[#0f172a] px-6 py-3.5">
          <button
            type="button"
            onClick={handleExecutePreview}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3.5 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 transition"
          >
            <Eye className="h-4 w-4" />
            输出预览
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#334155] bg-transparent px-4 py-1.5 text-xs font-medium text-slate-300 hover:bg-[#1e293b] hover:text-white transition"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={readOnly || dependencyValidation.hasCycle}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-1.5 text-xs font-medium text-white shadow-md hover:bg-sky-400 transition disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              确定
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
