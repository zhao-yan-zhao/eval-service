/**
 * LibFormula AST 解析与求值引擎（零 eval / 零 new Function）
 * 满足 Stage 10 算子流水线核心契约：
 * 1. 运算符支持：+ - * / ^ (幂) = <> != < <= > >= & (文本拼接) 括号 () 分隔符 , ;
 * 2. 字面量支持：数字、双引号/单引号字符串、布尔值 TRUE/FALSE、NULL
 * 3. 函数库（四类完整覆盖）：
 *    - 逻辑：IF, AND, OR, NOT, SWITCH, COALESCE, IFNULL
 *    - 数学：ROUND, TRUNC, ABS, SQRT, MOD, POWER, CLAMP, CEIL, FLOOR, MAX, MIN, AVG
 *    - 文本：CONCATENATE, LEFT, RIGHT, MID, LEN, LOWER, UPPER, TRIM
 *    - 日期时间：DATEDIFF, DATEADD, YEAR, MONTH, DAY
 * 4. 拓扑依赖排序（Kahn 算法）与循环依赖检测
 * 5. 除零保护、空值传播、安全类型转换
 * 6. 数据集行级衍生计算：evaluateFormulaDataset(dataset, config): TableDataset
 */

import type {
  DerivedColumnConfig,
  FieldDataType,
  FormulaOperatorConfig,
  TableDataset,
} from '../core/types.ts';

// ──────────────────── 词法分析 Tokenizer ────────────────────

export type TokenType =
  | 'num'
  | 'str'
  | 'bool'
  | 'null'
  | 'ident'
  | 'op'
  | 'paren'
  | 'sep';

export interface Token {
  type: TokenType;
  value: string | number | boolean | null;
  raw: string;
  pos: number;
}

const MULTI_CHAR_OPS = ['<=', '>=', '<>', '!='];
const SINGLE_CHAR_OPS = new Set(['+', '-', '*', '/', '^', '=', '<', '>', '&']);

export function tokenizeFormula(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = expr.length;

  while (i < len) {
    const ch = expr[i];

    // 空白字符
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    // 括号
    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch, raw: ch, pos: i });
      i += 1;
      continue;
    }

    // 分隔符（同时支持逗号与分号）
    if (ch === ',' || ch === ';') {
      tokens.push({ type: 'sep', value: ch, raw: ch, pos: i });
      i += 1;
      continue;
    }

    // 多字符运算符 <=, >=, <>, !=
    if (i + 1 < len) {
      const two = expr.slice(i, i + 2);
      if (MULTI_CHAR_OPS.includes(two)) {
        tokens.push({ type: 'op', value: two, raw: two, pos: i });
        i += 2;
        continue;
      }
    }

    // 单字符运算符
    if (SINGLE_CHAR_OPS.has(ch)) {
      tokens.push({ type: 'op', value: ch, raw: ch, pos: i });
      i += 1;
      continue;
    }

    // 中括号包裹的字段标识符，如 [Target Unit Name] 或 [speed_kts]
    if (ch === '[') {
      const closeIdx = expr.indexOf(']', i + 1);
      if (closeIdx === -1) {
        throw new Error(`缺少闭合中括号 "]"（起始于位置 ${i}）`);
      }
      const rawIdent = expr.slice(i + 1, closeIdx);
      tokens.push({ type: 'ident', value: rawIdent, raw: expr.slice(i, closeIdx + 1), pos: i });
      i = closeIdx + 1;
      continue;
    }

    // 字符串字面量（支持双引号 "text" 与单引号 'text'，支持 "" 或 \" 转义）
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let val = '';
      while (j < len) {
        if (expr[j] === '\\' && j + 1 < len) {
          const next = expr[j + 1];
          if (next === quote || next === '\\') {
            val += next;
            j += 2;
            continue;
          }
          if (next === 'n') {
            val += '\n';
            j += 2;
            continue;
          }
          if (next === 't') {
            val += '\t';
            j += 2;
            continue;
          }
          val += next;
          j += 2;
          continue;
        }
        if (expr[j] === quote) {
          // Excel 风格重复引号转义 "" -> "
          if (j + 1 < len && expr[j + 1] === quote) {
            val += quote;
            j += 2;
            continue;
          }
          break;
        }
        val += expr[j];
        j += 1;
      }
      if (j >= len || expr[j] !== quote) {
        throw new Error(`未闭合的字符串字面量（起始于位置 ${i}）`);
      }
      tokens.push({ type: 'str', value: val, raw: expr.slice(i, j + 1), pos: i });
      i = j + 1;
      continue;
    }

    // 数字字面量（含浮点与科学计数法）
    if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < len && /[0-9]/.test(expr[i + 1]))) {
      let j = i;
      let hasDot = false;
      while (j < len) {
        const c = expr[j];
        if (/[0-9]/.test(c)) {
          j += 1;
        } else if (c === '.') {
          if (hasDot) break;
          hasDot = true;
          j += 1;
        } else if ((c === 'e' || c === 'E') && j + 1 < len) {
          const next = expr[j + 1];
          if (/[0-9]/.test(next) || next === '+' || next === '-') {
            j += 2;
            while (j < len && /[0-9]/.test(expr[j])) j += 1;
            break;
          }
          break;
        } else {
          break;
        }
      }
      const numStr = expr.slice(i, j);
      const numVal = Number(numStr);
      if (!Number.isFinite(numVal)) {
        throw new Error(`无效数字字面量 "${numStr}"`);
      }
      tokens.push({ type: 'num', value: numVal, raw: numStr, pos: i });
      i = j;
      continue;
    }

    // 标识符（变量、函数名、关键字 TRUE/FALSE/NULL，支持中文字段名）
    if (/[a-zA-Z_\u4e00-\u9fa5]/.test(ch)) {
      let j = i;
      while (j < len && /[a-zA-Z0-9_\u4e00-\u9fa5]/.test(expr[j])) {
        j += 1;
      }
      const rawWord = expr.slice(i, j);
      const upper = rawWord.toUpperCase();

      // 判断后面紧跟着的是否是 '('（若是函数调用，保持为 ident）
      let peekK = j;
      while (peekK < len && /\s/.test(expr[peekK])) peekK += 1;
      const isCall = peekK < len && expr[peekK] === '(';

      if (!isCall) {
        if (upper === 'TRUE') {
          tokens.push({ type: 'bool', value: true, raw: rawWord, pos: i });
          i = j;
          continue;
        }
        if (upper === 'FALSE') {
          tokens.push({ type: 'bool', value: false, raw: rawWord, pos: i });
          i = j;
          continue;
        }
        if (upper === 'NULL') {
          tokens.push({ type: 'null', value: null, raw: rawWord, pos: i });
          i = j;
          continue;
        }
      }

      tokens.push({ type: 'ident', value: rawWord, raw: rawWord, pos: i });
      i = j;
      continue;
    }

    throw new Error(`表达式在位置 ${i} 包含非法字符 "${ch}"`);
  }

  return tokens;
}

// ──────────────────── 抽象语法树 AST 定义 ────────────────────

export type ASTNode =
  | { type: 'Literal'; value: unknown; rawType: 'number' | 'string' | 'boolean' | 'null' }
  | { type: 'Identifier'; name: string }
  | { type: 'UnaryOp'; op: '+' | '-' | 'NOT'; argument: ASTNode }
  | {
      type: 'BinaryOp';
      op: '+' | '-' | '*' | '/' | '^' | '=' | '<>' | '!=' | '<' | '<=' | '>' | '>=' | '&';
      left: ASTNode;
      right: ASTNode;
    }
  | { type: 'FunctionCall'; name: string; args: ASTNode[] };

// ──────────────────── 递归下降语法解析器 ────────────────────

export class LibFormulaParser {
  private readonly tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new Error('表达式意外结束');
    this.pos += 1;
    return t;
  }

  parse(): ASTNode {
    if (this.tokens.length === 0) {
      throw new Error('表达式不能为空');
    }
    const node = this.parseComparison();
    if (this.pos < this.tokens.length) {
      const extra = this.tokens[this.pos];
      throw new Error(`表达式末尾存在多余符号 "${extra.raw}"（位置 ${extra.pos}）`);
    }
    return node;
  }

  // 1. 比较运算：=, <>, !=, <, <=, >, >=
  private parseComparison(): ASTNode {
    let left = this.parseConcat();
    while (true) {
      const t = this.peek();
      if (
        t?.type === 'op' &&
        (t.value === '=' ||
          t.value === '<>' ||
          t.value === '!=' ||
          t.value === '<' ||
          t.value === '<=' ||
          t.value === '>' ||
          t.value === '>=')
      ) {
        this.consume();
        const right = this.parseConcat();
        left = {
          type: 'BinaryOp',
          op: t.value as any,
          left,
          right,
        };
      } else {
        break;
      }
    }
    return left;
  }

  // 2. 文本拼接：&
  private parseConcat(): ASTNode {
    let left = this.parseAddSub();
    while (true) {
      const t = this.peek();
      if (t?.type === 'op' && t.value === '&') {
        this.consume();
        const right = this.parseAddSub();
        left = { type: 'BinaryOp', op: '&', left, right };
      } else {
        break;
      }
    }
    return left;
  }

  // 3. 加减运算：+, -
  private parseAddSub(): ASTNode {
    let left = this.parseMulDiv();
    while (true) {
      const t = this.peek();
      if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
        this.consume();
        const right = this.parseMulDiv();
        left = { type: 'BinaryOp', op: t.value as '+' | '-', left, right };
      } else {
        break;
      }
    }
    return left;
  }

  // 4. 乘除运算：*, /
  private parseMulDiv(): ASTNode {
    let left = this.parseExponentiation();
    while (true) {
      const t = this.peek();
      if (t?.type === 'op' && (t.value === '*' || t.value === '/')) {
        this.consume();
        const right = this.parseExponentiation();
        left = { type: 'BinaryOp', op: t.value as '*' | '/', left, right };
      } else {
        break;
      }
    }
    return left;
  }

  // 5. 幂运算：^（右结合）
  private parseExponentiation(): ASTNode {
    const left = this.parseUnary();
    const t = this.peek();
    if (t?.type === 'op' && t.value === '^') {
      this.consume();
      const right = this.parseExponentiation();
      return { type: 'BinaryOp', op: '^', left, right };
    }
    return left;
  }

  // 6. 一元运算：+, -, NOT
  private parseUnary(): ASTNode {
    const t = this.peek();
    if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
      this.consume();
      const argument = this.parseUnary();
      return { type: 'UnaryOp', op: t.value as '+' | '-', argument };
    }
    if (t?.type === 'ident' && String(t.value ?? '').toUpperCase() === 'NOT') {
      // 检查其后紧跟的若不是括号，作为一元 NOT 操作符
      const next = this.tokens[this.pos + 1];
      if (next?.type !== 'paren' || next.value !== '(') {
        this.consume();
        const argument = this.parseUnary();
        return { type: 'UnaryOp', op: 'NOT', argument };
      }
    }
    return this.parsePrimary();
  }

  // 7. 基本单元 Primary：字面量、括号、函数调用、标识符
  private parsePrimary(): ASTNode {
    const t = this.peek();
    if (!t) throw new Error('期望表达式或字面量，但到达结尾');

    if (t.type === 'num') {
      this.consume();
      return { type: 'Literal', value: t.value, rawType: 'number' };
    }

    if (t.type === 'str') {
      this.consume();
      return { type: 'Literal', value: t.value, rawType: 'string' };
    }

    if (t.type === 'bool') {
      this.consume();
      return { type: 'Literal', value: t.value, rawType: 'boolean' };
    }

    if (t.type === 'null') {
      this.consume();
      return { type: 'Literal', value: null, rawType: 'null' };
    }

    if (t.type === 'paren' && t.value === '(') {
      this.consume();
      const expr = this.parseComparison();
      const close = this.peek();
      if (!close || close.type !== 'paren' || close.value !== ')') {
        throw new Error('缺少闭合右括号 ")"');
      }
      this.consume();
      return expr;
    }

    if (t.type === 'ident') {
      const identToken = this.consume();
      const identName = String(identToken.value);

      // 检查是否为函数调用
      const next = this.peek();
      if (next?.type === 'paren' && next.value === '(') {
        this.consume(); // 消费 '('
        const args: ASTNode[] = [];
        const afterOpen = this.peek();
        if (!afterOpen || afterOpen.type !== 'paren' || afterOpen.value !== ')') {
          args.push(this.parseComparison());
          while (true) {
            const sep = this.peek();
            if (sep?.type === 'sep') {
              this.consume(); // 消费 ',' 或 ';'
              args.push(this.parseComparison());
            } else {
              break;
            }
          }
        }
        const close = this.peek();
        if (!close || close.type !== 'paren' || close.value !== ')') {
          throw new Error(`函数 "${identName}()" 缺少闭合括号 ")"`);
        }
        this.consume();
        return {
          type: 'FunctionCall',
          name: identName.toUpperCase(),
          args,
        };
      }

      return { type: 'Identifier', name: identName };
    }

    throw new Error(`意外符号 "${t.raw}"（位置 ${t.pos}）`);
  }
}

export function parseFormulaAST(expr: string): ASTNode {
  const tokens = tokenizeFormula(expr);
  const parser = new LibFormulaParser(tokens);
  return parser.parse();
}

// ──────────────────── 变量提取工具 ────────────────────

export function extractVariableReferences(node: ASTNode, out: Set<string> = new Set()): Set<string> {
  switch (node.type) {
    case 'Identifier':
      out.add(node.name);
      break;
    case 'UnaryOp':
      extractVariableReferences(node.argument, out);
      break;
    case 'BinaryOp':
      extractVariableReferences(node.left, out);
      extractVariableReferences(node.right, out);
      break;
    case 'FunctionCall':
      for (const arg of node.args) {
        extractVariableReferences(arg, out);
      }
      break;
    case 'Literal':
      break;
  }
  return out;
}

// ──────────────────── 类型安全转换与辅助工具 ────────────────────

function coerceToNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function coerceToString(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  return String(val);
}

function coerceToBoolean(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return !Number.isNaN(val) && val !== 0;
  if (typeof val === 'string') {
    const low = val.trim().toLowerCase();
    if (low === 'true' || low === '1') return true;
    if (low === 'false' || low === '0' || low === '') return false;
    return true;
  }
  return Boolean(val);
}

function looseEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a === null || a === undefined) && (b === null || b === undefined);
  }
  const na = coerceToNumber(a);
  const nb = coerceToNumber(b);
  if (na !== null && nb !== null) {
    return Math.abs(na - nb) < 1e-12;
  }
  return coerceToString(a).toLowerCase() === coerceToString(b).toLowerCase();
}

function parseClockOrDate(val: unknown): { kind: 'clock'; seconds: number } | { kind: 'date'; ms: number } | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    // 假设若是时间戳或纯秒数
    if (val > 1000000000) return { kind: 'date', ms: val > 100000000000 ? val : val * 1000 };
    return { kind: 'clock', seconds: val };
  }
  const s = String(val).trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?$/.test(s)) {
    const parts = s.split(':').map(Number);
    const sec = parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0);
    return { kind: 'clock', seconds: sec };
  }
  const d = new Date(s);
  const ms = d.getTime();
  if (!Number.isNaN(ms)) {
    return { kind: 'date', ms };
  }
  return null;
}

// ──────────────────── 函数库执行注册表 ────────────────────

type EvaluatorFunc = (
  args: ASTNode[],
  scope: Record<string, unknown>,
  evalNode: (n: ASTNode, s: Record<string, unknown>) => unknown,
) => unknown;

const BUILTIN_FUNCTIONS: Record<string, EvaluatorFunc> = {
  // ── 逻辑分支 ──
  IF: (args, scope, evalNode) => {
    if (args.length < 2) throw new Error('IF(condition, true_val, [false_val]) 至少需要 2 个参数');
    const cond = coerceToBoolean(evalNode(args[0], scope));
    if (cond) {
      return evalNode(args[1], scope);
    }
    return args.length > 2 ? evalNode(args[2], scope) : null;
  },

  AND: (args, scope, evalNode) => {
    if (args.length === 0) return true;
    for (const arg of args) {
      if (!coerceToBoolean(evalNode(arg, scope))) return false;
    }
    return true;
  },

  OR: (args, scope, evalNode) => {
    if (args.length === 0) return false;
    for (const arg of args) {
      if (coerceToBoolean(evalNode(arg, scope))) return true;
    }
    return false;
  },

  NOT: (args, scope, evalNode) => {
    if (args.length !== 1) throw new Error('NOT(x) 仅接受 1 个参数');
    return !coerceToBoolean(evalNode(args[0], scope));
  },

  SWITCH: (args, scope, evalNode) => {
    if (args.length < 3) throw new Error('SWITCH(target, case1, val1, ...) 至少需要 3 个参数');
    const target = evalNode(args[0], scope);
    const hasDefault = args.length % 2 === 0;
    const pairCount = Math.floor((args.length - 1) / 2);
    for (let p = 0; p < pairCount; p += 1) {
      const caseVal = evalNode(args[1 + p * 2], scope);
      if (looseEqual(target, caseVal)) {
        return evalNode(args[2 + p * 2], scope);
      }
    }
    if (hasDefault) {
      return evalNode(args[args.length - 1], scope);
    }
    return null;
  },

  COALESCE: (args, scope, evalNode) => {
    for (const arg of args) {
      const v = evalNode(arg, scope);
      if (v !== null && v !== undefined && !Number.isNaN(v)) {
        return v;
      }
    }
    return null;
  },

  IFNULL: (args, scope, evalNode) => {
    if (args.length !== 2) throw new Error('IFNULL(val, defaultVal) 需要 2 个参数');
    const v = evalNode(args[0], scope);
    if (v === null || v === undefined || Number.isNaN(v)) {
      return evalNode(args[1], scope);
    }
    return v;
  },

  // ── 数学运算 ──
  ROUND: (args, scope, evalNode) => {
    if (args.length < 1) throw new Error('ROUND(x, [digits]) 至少需要 1 个参数');
    const n = coerceToNumber(evalNode(args[0], scope));
    if (n === null) return null;
    const digits = args.length > 1 ? (coerceToNumber(evalNode(args[1], scope)) ?? 0) : 0;
    const factor = Math.pow(10, Math.round(digits));
    return Math.round(n * factor) / factor;
  },

  TRUNC: (args, scope, evalNode) => {
    if (args.length < 1) throw new Error('TRUNC(x, [digits]) 至少需要 1 个参数');
    const n = coerceToNumber(evalNode(args[0], scope));
    if (n === null) return null;
    const digits = args.length > 1 ? (coerceToNumber(evalNode(args[1], scope)) ?? 0) : 0;
    const factor = Math.pow(10, Math.round(digits));
    return Math.trunc(n * factor) / factor;
  },

  ABS: (args, scope, evalNode) => {
    if (args.length !== 1) throw new Error('ABS(x) 仅接受 1 个参数');
    const n = coerceToNumber(evalNode(args[0], scope));
    return n === null ? null : Math.abs(n);
  },

  SQRT: (args, scope, evalNode) => {
    if (args.length !== 1) throw new Error('SQRT(x) 仅接受 1 个参数');
    const n = coerceToNumber(evalNode(args[0], scope));
    if (n === null || n < 0) return null;
    return Math.sqrt(n);
  },

  MOD: (args, scope, evalNode) => {
    if (args.length !== 2) throw new Error('MOD(n, d) 需要 2 个参数');
    const n = coerceToNumber(evalNode(args[0], scope));
    const d = coerceToNumber(evalNode(args[1], scope));
    if (n === null || d === null || Math.abs(d) < 1e-15) return null;
    return n % d;
  },

  POWER: (args, scope, evalNode) => {
    if (args.length !== 2) throw new Error('POWER(base, exp) 需要 2 个参数');
    const b = coerceToNumber(evalNode(args[0], scope));
    const e = coerceToNumber(evalNode(args[1], scope));
    if (b === null || e === null) return null;
    const res = Math.pow(b, e);
    return Number.isFinite(res) ? res : null;
  },

  CLAMP: (args, scope, evalNode) => {
    if (args.length !== 3) throw new Error('CLAMP(x, lo, hi) 需要 3 个参数');
    const x = coerceToNumber(evalNode(args[0], scope));
    const lo = coerceToNumber(evalNode(args[1], scope));
    const hi = coerceToNumber(evalNode(args[2], scope));
    if (x === null || lo === null || hi === null) return null;
    return Math.min(hi, Math.max(lo, x));
  },

  CEIL: (args, scope, evalNode) => {
    if (args.length !== 1) throw new Error('CEIL(x) 仅接受 1 个参数');
    const n = coerceToNumber(evalNode(args[0], scope));
    return n === null ? null : Math.ceil(n);
  },

  FLOOR: (args, scope, evalNode) => {
    if (args.length !== 1) throw new Error('FLOOR(x) 仅接受 1 个参数');
    const n = coerceToNumber(evalNode(args[0], scope));
    return n === null ? null : Math.floor(n);
  },

  MAX: (args, scope, evalNode) => {
    if (args.length === 0) return null;
    const nums: number[] = [];
    for (const arg of args) {
      const v = coerceToNumber(evalNode(arg, scope));
      if (v !== null) nums.push(v);
    }
    return nums.length > 0 ? Math.max(...nums) : null;
  },

  MIN: (args, scope, evalNode) => {
    if (args.length === 0) return null;
    const nums: number[] = [];
    for (const arg of args) {
      const v = coerceToNumber(evalNode(arg, scope));
      if (v !== null) nums.push(v);
    }
    return nums.length > 0 ? Math.min(...nums) : null;
  },

  AVG: (args, scope, evalNode) => {
    if (args.length === 0) return null;
    const nums: number[] = [];
    for (const arg of args) {
      const v = coerceToNumber(evalNode(arg, scope));
      if (v !== null) nums.push(v);
    }
    if (nums.length === 0) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  },

  // ── 文本处理 ──
  CONCATENATE: (args, scope, evalNode) => {
    return args.map((a) => coerceToString(evalNode(a, scope))).join('');
  },

  LEFT: (args, scope, evalNode) => {
    if (args.length < 1) throw new Error('LEFT(text, [n]) 至少需要 1 个参数');
    const str = coerceToString(evalNode(args[0], scope));
    const n = args.length > 1 ? (coerceToNumber(evalNode(args[1], scope)) ?? 1) : 1;
    return str.substring(0, Math.max(0, Math.floor(n)));
  },

  RIGHT: (args, scope, evalNode) => {
    if (args.length < 1) throw new Error('RIGHT(text, [n]) 至少需要 1 个参数');
    const str = coerceToString(evalNode(args[0], scope));
    const n = args.length > 1 ? (coerceToNumber(evalNode(args[1], scope)) ?? 1) : 1;
    const count = Math.max(0, Math.floor(n));
    return str.substring(Math.max(0, str.length - count));
  },

  MID: (args, scope, evalNode) => {
    if (args.length < 2) throw new Error('MID(text, start, [len]) 至少需要 2 个参数');
    const str = coerceToString(evalNode(args[0], scope));
    const start = coerceToNumber(evalNode(args[1], scope)) ?? 1;
    const len = args.length > 2 ? (coerceToNumber(evalNode(args[2], scope)) ?? str.length) : str.length;
    // 遵循 Excel / LibFormula 1-based 索引规范
    const startIdx = Math.max(0, Math.floor(start) - 1);
    return str.substring(startIdx, startIdx + Math.max(0, Math.floor(len)));
  },

  LEN: (args, scope, evalNode) => {
    if (args.length !== 1) throw new Error('LEN(text) 需要 1 个参数');
    const v = evalNode(args[0], scope);
    if (v === null || v === undefined) return null;
    return String(v).length;
  },

  LOWER: (args, scope, evalNode) => {
    if (args.length !== 1) throw new Error('LOWER(text) 需要 1 个参数');
    return coerceToString(evalNode(args[0], scope)).toLowerCase();
  },

  UPPER: (args, scope, evalNode) => {
    if (args.length !== 1) throw new Error('UPPER(text) 需要 1 个参数');
    return coerceToString(evalNode(args[0], scope)).toUpperCase();
  },

  TRIM: (args, scope, evalNode) => {
    if (args.length !== 1) throw new Error('TRIM(text) 需要 1 个参数');
    return coerceToString(evalNode(args[0], scope)).trim();
  },

  // ── 日期时间 ──
  DATEDIFF: (args, scope, evalNode) => {
    if (args.length < 2) throw new Error('DATEDIFF(unit, d1, d2) 或 DATEDIFF(d1, d2, [unit])');
    const raw0 = evalNode(args[0], scope);
    const raw1 = evalNode(args[1], scope);
    const raw2 = args.length > 2 ? evalNode(args[2], scope) : undefined;

    let unit = 'day';
    let d1Raw: unknown = raw0;
    let d2Raw: unknown = raw1;

    const unitList = new Set(['s', 'second', 'seconds', 'm', 'minute', 'minutes', 'h', 'hour', 'hours', 'd', 'day', 'days']);
    if (typeof raw0 === 'string' && unitList.has(raw0.toLowerCase())) {
      unit = raw0.toLowerCase();
      d1Raw = raw1;
      d2Raw = raw2;
    } else if (raw2 !== undefined) {
      unit = String(raw2).toLowerCase();
    }

    const t1 = parseClockOrDate(d1Raw);
    const t2 = parseClockOrDate(d2Raw);
    if (!t1 || !t2) return null;

    let diffSec: number;
    if (t1.kind === 'clock' && t2.kind === 'clock') {
      diffSec = t2.seconds - t1.seconds;
    } else {
      const ms1 = t1.kind === 'date' ? t1.ms : t1.seconds * 1000;
      const ms2 = t2.kind === 'date' ? t2.ms : t2.seconds * 1000;
      diffSec = (ms2 - ms1) / 1000;
    }

    switch (unit) {
      case 's':
      case 'second':
      case 'seconds':
        return Math.round(diffSec * 1000) / 1000;
      case 'm':
      case 'minute':
      case 'minutes':
        return Math.round((diffSec / 60) * 1000) / 1000;
      case 'h':
      case 'hour':
      case 'hours':
        return Math.round((diffSec / 3600) * 1000) / 1000;
      case 'd':
      case 'day':
      case 'days':
      default:
        return Math.round((diffSec / 86400) * 1000) / 1000;
    }
  },

  DATEADD: (args, scope, evalNode) => {
    if (args.length < 3) throw new Error('DATEADD(unit, amount, date) 需要 3 个参数');
    const unit = String(evalNode(args[0], scope)).toLowerCase();
    const amount = coerceToNumber(evalNode(args[1], scope)) ?? 0;
    const dateRaw = evalNode(args[2], scope);
    const t = parseClockOrDate(dateRaw);
    if (!t) return null;

    let secDelta = 0;
    switch (unit) {
      case 's':
      case 'second':
      case 'seconds':
        secDelta = amount;
        break;
      case 'm':
      case 'minute':
      case 'minutes':
        secDelta = amount * 60;
        break;
      case 'h':
      case 'hour':
      case 'hours':
        secDelta = amount * 3600;
        break;
      case 'd':
      case 'day':
      case 'days':
      default:
        secDelta = amount * 86400;
        break;
    }

    if (t.kind === 'clock') {
      const newSec = Math.max(0, Math.floor(t.seconds + secDelta));
      const hh = String(Math.floor(newSec / 3600)).padStart(2, '0');
      const mm = String(Math.floor((newSec % 3600) / 60)).padStart(2, '0');
      const ss = String(newSec % 60).padStart(2, '0');
      return `${hh}:${mm}:${ss}`;
    }

    const newMs = t.ms + secDelta * 1000;
    return new Date(newMs).toISOString();
  },

  YEAR: (args, scope, evalNode) => {
    if (args.length !== 1) throw new Error('YEAR(date) 需要 1 个参数');
    const t = parseClockOrDate(evalNode(args[0], scope));
    if (!t || t.kind !== 'date') return null;
    return new Date(t.ms).getUTCFullYear();
  },

  MONTH: (args, scope, evalNode) => {
    if (args.length !== 1) throw new Error('MONTH(date) 需要 1 个参数');
    const t = parseClockOrDate(evalNode(args[0], scope));
    if (!t || t.kind !== 'date') return null;
    return new Date(t.ms).getUTCMonth() + 1;
  },

  DAY: (args, scope, evalNode) => {
    if (args.length !== 1) throw new Error('DAY(date) 需要 1 个参数');
    const t = parseClockOrDate(evalNode(args[0], scope));
    if (!t || t.kind !== 'date') return null;
    return new Date(t.ms).getUTCDate();
  },
};

// ──────────────────── AST 纯解释执行核心 ────────────────────

export function evaluateFormulaAST(
  node: ASTNode,
  scope: Record<string, unknown>,
  options: { strictIdentifiers?: boolean; throwOnZeroDivision?: boolean } = {},
): unknown {
  switch (node.type) {
    case 'Literal':
      return node.value;

    case 'Identifier': {
      if (node.name in scope) {
        return scope[node.name];
      }
      // 不区分大小写匹配
      const upper = node.name.toUpperCase();
      for (const [k, v] of Object.entries(scope)) {
        if (k.toUpperCase() === upper) return v;
      }
      if (options.strictIdentifiers) {
        throw new Error(`未绑定的变量标识符 "${node.name}"`);
      }
      return null;
    }

    case 'UnaryOp': {
      const v = evaluateFormulaAST(node.argument, scope, options);
      if (node.op === '+') {
        return coerceToNumber(v);
      }
      if (node.op === '-') {
        const n = coerceToNumber(v);
        return n === null ? null : -n;
      }
      if (node.op === 'NOT') {
        return !coerceToBoolean(v);
      }
      return null;
    }

    case 'BinaryOp': {
      const left = evaluateFormulaAST(node.left, scope, options);
      const right = evaluateFormulaAST(node.right, scope, options);

      // 文本连接符 &
      if (node.op === '&') {
        return coerceToString(left) + coerceToString(right);
      }

      // 比较操作
      if (node.op === '=' || (node.op as string) === '==') {
        return looseEqual(left, right);
      }
      if (node.op === '<>' || node.op === '!=') {
        return !looseEqual(left, right);
      }
      if (node.op === '<' || node.op === '<=' || node.op === '>' || node.op === '>=') {
        if (left === null || left === undefined || right === null || right === undefined) {
          return false;
        }
        const nl = coerceToNumber(left);
        const nr = coerceToNumber(right);
        if (nl !== null && nr !== null) {
          if (node.op === '<') return nl < nr;
          if (node.op === '<=') return nl <= nr;
          if (node.op === '>') return nl > nr;
          if (node.op === '>=') return nl >= nr;
        }
        const sl = coerceToString(left);
        const sr = coerceToString(right);
        if (node.op === '<') return sl < sr;
        if (node.op === '<=') return sl <= sr;
        if (node.op === '>') return sl > sr;
        if (node.op === '>=') return sl >= sr;
        return false;
      }

      // 四则与幂运算（空值传播）
      const numL = coerceToNumber(left);
      const numR = coerceToNumber(right);
      if (numL === null || numR === null) {
        return null;
      }

      if (node.op === '+') return numL + numR;
      if (node.op === '-') return numL - numR;
      if (node.op === '*') return numL * numR;
      if (node.op === '/') {
        if (Math.abs(numR) < 1e-15) {
          if (options.throwOnZeroDivision) {
            throw new Error('ZERO_DIVISION');
          }
          return null;
        }
        return numL / numR;
      }
      if (node.op === '^') {
        const p = Math.pow(numL, numR);
        return Number.isFinite(p) ? p : null;
      }
      return null;
    }

    case 'FunctionCall': {
      const funcName = node.name.toUpperCase();
      const fn = BUILTIN_FUNCTIONS[funcName];
      if (!fn) {
        throw new Error(`不支持的函数 "${node.name}"`);
      }
      return fn(node.args, scope, (subNode, subScope) =>
        evaluateFormulaAST(subNode, subScope, options),
      );
    }
  }
}

// ──────────────────── 衍生列拓扑排序（Kahn 算法） ────────────────────

export function sortDerivedColumns(rawColumns: DerivedColumnConfig[]): DerivedColumnConfig[] {
  const columns = (rawColumns || []).map((c: any) => {
    const colName = c.columnName || c.name || '';
    return {
      ...c,
      columnName: colName,
      name: colName,
    };
  });
  if (columns.length <= 1) {
    if (columns.length === 1) {
      // 检查单列直接自环引用
      const ast = parseFormulaAST(columns[0].expression);
      const refs = extractVariableReferences(ast);
      if (refs.has(columns[0].columnName)) {
        throw new Error(
          `循环依赖拦截：列 "${columns[0].columnName}" 在表达式中直接引用了自身`,
        );
      }
    }
    return [...columns];
  }

  const colMap = new Map<string, DerivedColumnConfig>();
  const inDegree = new Map<string, number>();
  const graph = new Map<string, Set<string>>();
  const astMap = new Map<string, ASTNode>();

  for (const c of columns) {
    colMap.set(c.columnName, c);
    inDegree.set(c.columnName, 0);
    graph.set(c.columnName, new Set());
    const ast = parseFormulaAST(c.expression);
    astMap.set(c.columnName, ast);
  }

  for (const c of columns) {
    const ast = astMap.get(c.columnName)!;
    const refs = extractVariableReferences(ast);

    if (refs.has(c.columnName)) {
      throw new Error(`循环依赖拦截：列 "${c.columnName}" 引用了自身`);
    }

    for (const ref of refs) {
      // 仅对当前批次中定义的其他衍生列建依赖图
      if (colMap.has(ref)) {
        // ref 是 c 的先决依赖：ref -> c
        graph.get(ref)!.add(c.columnName);
        inDegree.set(c.columnName, (inDegree.get(c.columnName) ?? 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [name, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(name);
    }
  }

  const sorted: DerivedColumnConfig[] = [];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    sorted.push(colMap.get(curr)!);

    const neighbors = graph.get(curr);
    if (neighbors) {
      for (const n of neighbors) {
        const nextDeg = (inDegree.get(n) ?? 1) - 1;
        inDegree.set(n, nextDeg);
        if (nextDeg === 0) {
          queue.push(n);
        }
      }
    }
  }

  if (sorted.length < columns.length) {
    const cycleNodes = [...inDegree.entries()]
      .filter(([, deg]) => deg > 0)
      .map(([name]) => name);
    throw new Error(
      `检测到衍生列之间存在循环依赖 (Circular Dependency): [${cycleNodes.join(' <-> ')}]`,
    );
  }

  return sorted;
}

// ──────────────────── 全量数据集求值 evaluateFormulaDataset ────────────────────

export function evaluateFormulaDataset(
  dataset: TableDataset,
  config: FormulaOperatorConfig,
): TableDataset {
  const datasetCols = dataset.columns ?? (dataset as any).schema ?? [];
  const rawDerivedCols = config.derivedColumns ?? [];
  const derivedCols = rawDerivedCols.map((c: any) => {
    const colName = c.columnName || c.name || '';
    return {
      ...c,
      columnName: colName,
      name: colName,
    };
  });
  if (derivedCols.length === 0) {
    return {
      columns: [...datasetCols],
      schema: [...datasetCols],
      rows: dataset.rows.map((r) => ({ ...r })),
      totalRows: dataset.rows.length,
    };
  }

  // 1. Kahn 拓扑排序与环检测
  const sortedCols = sortDerivedColumns(derivedCols);

  // 2. 预解析语法树（极大提升百万行遍历效率）
  const compiled = sortedCols.map((c) => ({
    config: c,
    ast: parseFormulaAST(c.expression),
  }));

  // 3. 行级求值与空值保护
  const newRows: Array<Record<string, unknown>> = [];
  for (const originalRow of dataset.rows) {
    const rowScope: Record<string, unknown> = { ...originalRow };

    for (const item of compiled) {
      const { config: colCfg, ast } = item;
      const rawVal = evaluateFormulaAST(ast, rowScope, {
        strictIdentifiers: false,
        throwOnZeroDivision: false,
      });

      // 根据声明的 dataType 执行格式收口
      let finalVal: unknown = rawVal;
      if (colCfg.dataType === 'number') {
        const num = coerceToNumber(rawVal);
        finalVal = num !== null ? Math.round(num * 1000000) / 1000000 : null;
      } else if (colCfg.dataType === 'string') {
        finalVal = rawVal !== null && rawVal !== undefined ? coerceToString(rawVal) : null;
      } else if (colCfg.dataType === 'boolean') {
        finalVal = rawVal !== null && rawVal !== undefined ? coerceToBoolean(rawVal) : null;
      }

      rowScope[colCfg.columnName] = finalVal;
      if (colCfg.overwriteColumn && colCfg.overwriteColumn !== colCfg.columnName) {
        rowScope[colCfg.overwriteColumn] = finalVal;
      }
    }

    newRows.push(rowScope);
  }

  // 4. 构建输出 Schema（保留原列并追加/覆盖衍生列标记）
  const colMap = new Map<string, { type: FieldDataType; isDerived?: boolean; description?: string }>();
  for (const c of datasetCols) {
    colMap.set(c.name, {
      type: c.type,
      isDerived: c.isDerived,
      description: c.description,
    });
  }

  for (const c of sortedCols) {
    colMap.set(c.columnName, {
      type: c.dataType,
      isDerived: true,
      description: c.description ?? `公式衍生列: ${c.expression}`,
    });
    if (c.overwriteColumn) {
      colMap.set(c.overwriteColumn, {
        type: c.dataType,
        isDerived: true,
        description: `由衍生列覆盖: ${c.expression}`,
      });
    }
  }

  const newColumns = [...colMap.entries()].map(([name, meta]) => ({
    name,
    type: meta.type,
    isDerived: meta.isDerived,
    description: meta.description,
  }));

  return {
    columns: newColumns,
    schema: newColumns,
    rows: newRows,
    totalRows: newRows.length,
  };
}

// ──────────────────── 语法校验与向后兼容适配器 ────────────────────

export function validateFormula(
  expression: string,
  availableColumns?: string[],
): { valid: boolean; errors: string[]; referencedVariables: string[] } {
  const errors: string[] = [];
  const referenced: string[] = [];

  if (!expression || !expression.trim()) {
    return { valid: false, errors: ['公式表达式不能为空'], referencedVariables: [] };
  }

  try {
    const ast = parseFormulaAST(expression);
    const refs = extractVariableReferences(ast);
    referenced.push(...refs);

    if (availableColumns && availableColumns.length > 0) {
      const allowed = new Set(availableColumns.map((c) => c.toUpperCase()));
      for (const r of refs) {
        if (!allowed.has(r.toUpperCase())) {
          errors.push(`未知的变量或字段 "${r}"`);
        }
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return {
    valid: errors.length === 0,
    errors,
    referencedVariables: referenced,
  };
}

/**
 * Stage 9 向后兼容接口：校验公式语法
 */
export function validateFormulaSyntax(expression: string, declaredAliases: string[]): string[] {
  const res = validateFormula(expression, declaredAliases);
  return res.errors;
}

/**
 * Stage 9 向后兼容接口：单行纯数值表达式求值
 */
export function evaluateFormulaExpression(
  expression: string,
  vars: Record<string, number>,
): { ok: true; value: number } | { ok: false; reason: string } {
  try {
    const ast = parseFormulaAST(expression);
    const raw = evaluateFormulaAST(ast, vars, {
      strictIdentifiers: true,
      throwOnZeroDivision: true,
    });
    if (raw === null || raw === undefined) {
      return { ok: false, reason: '表达式计算结果为空或无效' };
    }
    const num = coerceToNumber(raw);
    if (num === null || !Number.isFinite(num)) {
      return { ok: false, reason: '表达式计算结果溢出或为 NaN' };
    }
    return { ok: true, value: Math.round(num * 10000) / 10000 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'ZERO_DIVISION') {
      return { ok: false, reason: '表达式运行期分母为 0，已降级为不可用' };
    }
    return { ok: false, reason: msg };
  }
}
