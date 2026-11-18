import assert from 'node:assert/strict';
import test from 'node:test';
import type { FormulaOperatorConfig, TableDataset } from '../src/core/types.ts';
import {
  evaluateFormulaAST,
  evaluateFormulaDataset,
  evaluateFormulaExpression,
  extractVariableReferences,
  parseFormulaAST,
  sortDerivedColumns,
  tokenizeFormula,
  validateFormula,
  validateFormulaSyntax,
} from '../src/operators/formula-engine.ts';

test('Stage 10.1 - Tokenizer: 词法解析四则、幂、比较、分号/逗号分隔符及括号与字面量', () => {
  const expr = 'IF([Hit Dist] <= 10.5; "HIT"; "MISS") + (3 ^ 2) * -4 / 2 <> 0';
  const tokens = tokenizeFormula(expr);

  // 验证中括号标识符
  const hitDistToken = tokens.find((t) => t.type === 'ident' && t.value === 'Hit Dist');
  assert.ok(hitDistToken, '应该识别中括号标识符 [Hit Dist]');

  // 验证多字符比较运算符 <=, <>
  const lteToken = tokens.find((t) => t.type === 'op' && t.value === '<=');
  assert.ok(lteToken, '应该识别 <=');
  const neqToken = tokens.find((t) => t.type === 'op' && t.value === '<>');
  assert.ok(neqToken, '应该识别 <>');

  // 验证分号分隔符 ; 与逗号
  const semicolonTokens = tokens.filter((t) => t.type === 'sep' && t.value === ';');
  assert.equal(semicolonTokens.length, 2, '应该识别 2 个分号分隔符');

  // 验证幂运算符 ^
  const powToken = tokens.find((t) => t.type === 'op' && t.value === '^');
  assert.ok(powToken, '应该识别 ^');

  // 验证字符串与数字字面量
  const strHit = tokens.find((t) => t.type === 'str' && t.value === 'HIT');
  assert.ok(strHit, '应该识别字符串 "HIT"');
  const num105 = tokens.find((t) => t.type === 'num' && t.value === 10.5);
  assert.ok(num105, '应该识别浮点数 10.5');

  // 验证布尔与空值字面量
  const boolTokens = tokenizeFormula('TRUE = false AND null');
  assert.equal(boolTokens[0].type, 'bool');
  assert.equal(boolTokens[0].value, true);
  assert.equal(boolTokens[2].type, 'bool');
  assert.equal(boolTokens[2].value, false);
  assert.equal(boolTokens[4].type, 'null');
  assert.equal(boolTokens[4].value, null);
});

test('Stage 10.2 - AST Parser: 运算符优先级、结合性与语法树构建', () => {
  // 1. 优先级：乘除高于加减
  const ast1 = parseFormulaAST('2 + 3 * 4');
  assert.equal(ast1.type, 'BinaryOp');
  if (ast1.type === 'BinaryOp') {
    assert.equal(ast1.op, '+');
    assert.equal(ast1.left.type, 'Literal');
    assert.equal(ast1.right.type, 'BinaryOp');
    if (ast1.right.type === 'BinaryOp') {
      assert.equal(ast1.right.op, '*');
    }
  }

  // 2. 幂运算优先于乘除且为右结合：2 ^ 3 ^ 2 => 2 ^ (3 ^ 2) = 512
  const astPow = parseFormulaAST('2 ^ 3 ^ 2');
  const valPow = evaluateFormulaAST(astPow, {});
  assert.equal(valPow, 512);

  // 3. 比较运算优先级低于算术运算：1 + 2 = 3 => (1 + 2) = 3 => true
  const astCmp = parseFormulaAST('1 + 2 = 3');
  assert.equal(evaluateFormulaAST(astCmp, {}), true);

  // 4. 文本拼接运算符 &
  const astConcat = parseFormulaAST('"Unit_" & 42');
  assert.equal(evaluateFormulaAST(astConcat, {}), 'Unit_42');

  // 5. 分号与逗号作为函数实参分隔符等价
  const astSemi = parseFormulaAST('IF(1 > 0; 100; 200)');
  assert.equal(evaluateFormulaAST(astSemi, {}), 100);
  const astComma = parseFormulaAST('IF(1 > 0, 100, 200)');
  assert.equal(evaluateFormulaAST(astComma, {}), 100);

  // 6. 异常语法拦截
  assert.throws(() => parseFormulaAST('1 + (2 * 3'), /缺少闭合右括号/);
  assert.throws(() => evaluateFormulaAST(parseFormulaAST('ROUND()'), {}), /ROUND/);
  assert.throws(() => parseFormulaAST(''), /表达式不能为空/);
});

test('Stage 10.3 - 逻辑分支函数全量覆盖 (IF, AND, OR, NOT, SWITCH, COALESCE, IFNULL)', () => {
  const scope = {
    score: 85,
    status: 'ACTIVE',
    nullVal: null,
    undefinedVal: undefined,
  };

  // IF 分支
  assert.equal(evaluateFormulaAST(parseFormulaAST('IF(score >= 80, "PASS", "FAIL")'), scope), 'PASS');
  assert.equal(evaluateFormulaAST(parseFormulaAST('IF(score < 60, "FAIL", "PASS")'), scope), 'PASS');

  // AND / OR / NOT
  assert.equal(evaluateFormulaAST(parseFormulaAST('AND(score > 80, status = "ACTIVE")'), scope), true);
  assert.equal(evaluateFormulaAST(parseFormulaAST('AND(score > 90, status = "ACTIVE")'), scope), false);
  assert.equal(evaluateFormulaAST(parseFormulaAST('OR(score > 90, status = "ACTIVE")'), scope), true);
  assert.equal(evaluateFormulaAST(parseFormulaAST('OR(score > 90, status = "INACTIVE")'), scope), false);
  assert.equal(evaluateFormulaAST(parseFormulaAST('NOT(status = "INACTIVE")'), scope), true);

  // SWITCH 多分支
  const switchExpr = 'SWITCH(status, "IDLE", 0, "ACTIVE", 1, "DESTROYED", -1, 999)';
  assert.equal(evaluateFormulaAST(parseFormulaAST(switchExpr), scope), 1);
  assert.equal(evaluateFormulaAST(parseFormulaAST(switchExpr), { status: 'UNKNOWN' }), 999);

  // COALESCE 与 IFNULL
  assert.equal(evaluateFormulaAST(parseFormulaAST('COALESCE(nullVal, undefinedVal, score, 0)'), scope), 85);
  assert.equal(evaluateFormulaAST(parseFormulaAST('COALESCE(nullVal, undefinedVal, 123)'), scope), 123);
  assert.equal(evaluateFormulaAST(parseFormulaAST('IFNULL(nullVal, 99)'), scope), 99);
  assert.equal(evaluateFormulaAST(parseFormulaAST('IFNULL(score, 99)'), scope), 85);
});

test('Stage 10.4 - 数学运算函数全量覆盖 (ROUND, TRUNC, ABS, SQRT, MOD, POWER, CLAMP, CEIL, FLOOR, MAX, MIN, AVG)', () => {
  const scope = { x: -14.654, y: 3, a: 10, b: 25, c: 40 };

  // ROUND & TRUNC
  assert.equal(evaluateFormulaAST(parseFormulaAST('ROUND(x, 2)'), scope), -14.65);
  assert.equal(evaluateFormulaAST(parseFormulaAST('TRUNC(x, 1)'), scope), -14.6);
  assert.equal(evaluateFormulaAST(parseFormulaAST('ROUND(12.345)'), {}), 12);

  // ABS & SQRT
  assert.equal(evaluateFormulaAST(parseFormulaAST('ABS(x)'), scope), 14.654);
  assert.equal(evaluateFormulaAST(parseFormulaAST('SQRT(b)'), scope), 5);
  assert.equal(evaluateFormulaAST(parseFormulaAST('SQRT(-9)'), {}), null); // 负数开方 fail-closed 为 null

  // MOD & POWER
  assert.equal(evaluateFormulaAST(parseFormulaAST('MOD(17, 5)'), {}), 2);
  assert.equal(evaluateFormulaAST(parseFormulaAST('POWER(2, 4)'), {}), 16);

  // CLAMP (限制在 [lo, hi])
  assert.equal(evaluateFormulaAST(parseFormulaAST('CLAMP(120, 0, 100)'), {}), 100);
  assert.equal(evaluateFormulaAST(parseFormulaAST('CLAMP(-20, 0, 100)'), {}), 0);
  assert.equal(evaluateFormulaAST(parseFormulaAST('CLAMP(50, 0, 100)'), {}), 50);

  // CEIL & FLOOR
  assert.equal(evaluateFormulaAST(parseFormulaAST('CEIL(4.1)'), {}), 5);
  assert.equal(evaluateFormulaAST(parseFormulaAST('FLOOR(4.9)'), {}), 4);

  // MAX, MIN, AVG
  assert.equal(evaluateFormulaAST(parseFormulaAST('MAX(a, b, c)'), scope), 40);
  assert.equal(evaluateFormulaAST(parseFormulaAST('MIN(a, b, c)'), scope), 10);
  assert.equal(evaluateFormulaAST(parseFormulaAST('AVG(a, b, c)'), scope), 25);
});

test('Stage 10.5 - 文本处理函数全量覆盖 (CONCATENATE, LEFT, RIGHT, MID, LEN, LOWER, UPPER, TRIM)', () => {
  const scope = { code: '  F1-PL15-BVR  ', target: 'TARGET_ALPHA' };

  // CONCATENATE
  assert.equal(
    evaluateFormulaAST(parseFormulaAST('CONCATENATE("Side: ", "RED", " - ", 2026)'), {}),
    'Side: RED - 2026',
  );

  // TRIM, LOWER, UPPER
  assert.equal(evaluateFormulaAST(parseFormulaAST('TRIM(code)'), scope), 'F1-PL15-BVR');
  assert.equal(evaluateFormulaAST(parseFormulaAST('LOWER("HELLO_WORLD")'), {}), 'hello_world');
  assert.equal(evaluateFormulaAST(parseFormulaAST('UPPER("radar_echo")'), {}), 'RADAR_ECHO');

  // LEFT, RIGHT, MID (遵循 1-based 索引规范)
  assert.equal(evaluateFormulaAST(parseFormulaAST('LEFT(target, 6)'), scope), 'TARGET');
  assert.equal(evaluateFormulaAST(parseFormulaAST('RIGHT(target, 5)'), scope), 'ALPHA');
  assert.equal(evaluateFormulaAST(parseFormulaAST('MID(target, 8, 5)'), scope), 'ALPHA');

  // LEN
  assert.equal(evaluateFormulaAST(parseFormulaAST('LEN(target)'), scope), 12);
  assert.equal(evaluateFormulaAST(parseFormulaAST('LEN(null)'), {}), null);
});

test('Stage 10.6 - 日期时间处理函数 (DATEDIFF, DATEADD, YEAR, MONTH, DAY)', () => {
  // DATEDIFF 时钟格式 (秒数差)
  const clockDiffSec = evaluateFormulaAST(
    parseFormulaAST('DATEDIFF("04:00:00", "04:02:30", "s")'),
    {},
  );
  assert.equal(clockDiffSec, 150);

  // DATEDIFF 分钟差
  const clockDiffMin = evaluateFormulaAST(
    parseFormulaAST('DATEDIFF("04:00:00", "04:05:00", "m")'),
    {},
  );
  assert.equal(clockDiffMin, 5);

  // DATEDIFF 日期天数差
  const dayDiff = evaluateFormulaAST(
    parseFormulaAST('DATEDIFF("2026-06-01", "2026-06-11", "d")'),
    {},
  );
  assert.equal(dayDiff, 10);

  // DATEADD
  const addedMin = evaluateFormulaAST(
    parseFormulaAST('DATEADD("m", 15, "04:00:00")'),
    {},
  );
  assert.equal(addedMin, '04:15:00');

  // YEAR, MONTH, DAY
  const dtScope = { missionDate: '2026-11-15T08:30:00Z' };
  assert.equal(evaluateFormulaAST(parseFormulaAST('YEAR(missionDate)'), dtScope), 2026);
  assert.equal(evaluateFormulaAST(parseFormulaAST('MONTH(missionDate)'), dtScope), 11);
  assert.equal(evaluateFormulaAST(parseFormulaAST('DAY(missionDate)'), dtScope), 15);
});

test('Stage 10.7 - 除零保护、空值传播与安全隐式类型转换', () => {
  // 1. 除零保护：evaluateFormulaAST(..., { throwOnZeroDivision: false }) 返回 null
  const zeroDivVal = evaluateFormulaAST(parseFormulaAST('100 / 0'), {}, { throwOnZeroDivision: false });
  assert.equal(zeroDivVal, null);

  // evaluateFormulaExpression 捕获除零返回 ok: false, reason: ZERO_DIVISION 或分母为 0
  const exprRes = evaluateFormulaExpression('100 / 0', {});
  assert.equal(exprRes.ok, false);
  if (!exprRes.ok) {
    assert.match(exprRes.reason, /分母为 0|除零错误|ZERO_DIVISION/);
  }

  // 2. 空值传播：null + 10 => null, null * 5 => null
  assert.equal(evaluateFormulaAST(parseFormulaAST('null + 10'), {}), null);
  assert.equal(evaluateFormulaAST(parseFormulaAST('5 * null'), {}), null);
  assert.equal(evaluateFormulaAST(parseFormulaAST('IFNULL(null, 42)'), {}), 42);

  // 3. 隐式类型转换：数字字符串与数字相加
  assert.equal(evaluateFormulaAST(parseFormulaAST('"12.5" + 2.5'), {}), 15);
  // 布尔值参与算术运算：TRUE => 1, FALSE => 0
  assert.equal(evaluateFormulaAST(parseFormulaAST('TRUE + 10'), {}), 11);
  assert.equal(evaluateFormulaAST(parseFormulaAST('FALSE + 10'), {}), 10);
});

test('Stage 10.8 - 拓扑依赖排序 (Kahn 算法) 与循环依赖检测', () => {
  // 1. 乱序定义的多衍生列：C 依赖 B，B 依赖 A，A 依赖原始列 raw_val
  const cols = [
    { columnName: 'col_c', dataType: 'number' as const, expression: 'col_b * 2' },
    { columnName: 'col_a', dataType: 'number' as const, expression: 'raw_val + 10' },
    { columnName: 'col_b', dataType: 'number' as const, expression: 'col_a * 3' },
  ];

  const sorted = sortDerivedColumns(cols);
  assert.deepEqual(
    sorted.map((c) => c.columnName),
    ['col_a', 'col_b', 'col_c'],
    '应该依据先决依赖将 col_a -> col_b -> col_c 拓扑排序',
  );

  // 2. 直接自环引用异常拦截：A 引用 A
  assert.throws(
    () =>
      sortDerivedColumns([
        { columnName: 'self_col', dataType: 'number', expression: 'self_col + 1' },
      ]),
    /循环依赖拦截|自身/,
  );

  // 3. 间接相互环依赖异常拦截：A -> B -> A
  assert.throws(
    () =>
      sortDerivedColumns([
        { columnName: 'node_a', dataType: 'number', expression: 'node_b + 1' },
        { columnName: 'node_b', dataType: 'number', expression: 'node_a + 2' },
      ]),
    /循环依赖|Circular Dependency/,
  );

  // 4. 三节点长环：A -> B -> C -> A
  assert.throws(
    () =>
      sortDerivedColumns([
        { columnName: 'node_a', dataType: 'number', expression: 'node_b + 1' },
        { columnName: 'node_b', dataType: 'number', expression: 'node_c + 1' },
        { columnName: 'node_c', dataType: 'number', expression: 'node_a + 1' },
      ]),
    /循环依赖|Circular Dependency/,
  );
});

test('Stage 10.9 - 数据集行级衍生计算 (evaluateFormulaDataset) 与覆盖列支持', () => {
  const inputDataset: TableDataset = {
    columns: [
      { name: 'unit_name', type: 'string' },
      { name: 'distance_km', type: 'number' },
      { name: 'is_engaged', type: 'boolean' },
    ],
    rows: [
      { unit_name: 'Fighter-01', distance_km: 15.0, is_engaged: true },
      { unit_name: 'Fighter-02', distance_km: 0.0, is_engaged: false },
      { unit_name: 'Fighter-03', distance_km: null, is_engaged: true },
    ],
  };

  const config: FormulaOperatorConfig = {
    derivedColumns: [
      // 衍生列 1: 距离转海里 (1 km = 0.539957 nm)
      {
        columnName: 'distance_nm',
        dataType: 'number',
        expression: 'ROUND(distance_km * 0.539957, 2)',
      },
      // 衍生列 2: 危险等级（依赖衍生列 1）
      {
        columnName: 'threat_level',
        dataType: 'string',
        expression: 'IF(distance_nm <= 5, "CRITICAL", IF(distance_nm <= 10, "HIGH", "NORMAL"))',
      },
      // 衍生列 3: 覆盖已有列 is_engaged
      {
        columnName: 'override_engaged',
        dataType: 'boolean',
        expression: 'IF(distance_nm <= 10, TRUE, FALSE)',
        overwriteColumn: 'is_engaged',
      },
      // 衍生列 4: 除零安全保护 (验证行级不抛异常，结果为 null)
      {
        columnName: 'inv_dist',
        dataType: 'number',
        expression: '100 / distance_km',
      },
    ],
  };

  const out = evaluateFormulaDataset(inputDataset, config);

  assert.equal(out.rows.length, 3);
  assert.equal(out.totalRows, 3);

  // 验证第 1 行衍生结果
  const r0 = out.rows[0];
  assert.equal(r0.distance_nm, 8.1); // 15 * 0.539957 = 8.099355 -> ROUND(..., 2) = 8.1
  assert.equal(r0.threat_level, 'HIGH');
  assert.equal(r0.is_engaged, true);
  assert.equal(Math.round((r0.inv_dist as number) * 100) / 100, 6.67);

  // 验证第 2 行 (distance_km = 0, 除零测试)
  const r1 = out.rows[1];
  assert.equal(r1.distance_nm, 0);
  assert.equal(r1.threat_level, 'CRITICAL');
  assert.equal(r1.is_engaged, true); // 0 <= 10 => TRUE 覆盖
  assert.equal(r1.inv_dist, null, '除零应得到 null');

  // 验证第 3 行 (distance_km = null, 空值传播测试)
  const r2 = out.rows[2];
  assert.equal(r2.distance_nm, null);
  assert.equal(r2.inv_dist, null);

  // 验证输出 Schema 正确追加衍生标记与类型
  const schemaMap = new Map(out.columns.map((c) => [c.name, c]));
  assert.equal(schemaMap.get('distance_nm')?.isDerived, true);
  assert.equal(schemaMap.get('distance_nm')?.type, 'number');
  assert.equal(schemaMap.get('threat_level')?.isDerived, true);
  assert.equal(schemaMap.get('threat_level')?.type, 'string');
});

test('Stage 10.10 - 语法校验与变量提取 API (validateFormula & extractVariableReferences)', () => {
  // 1. 变量提取
  const ast = parseFormulaAST('IF(alpha > 10, beta * 2, gamma + delta)');
  const refs = extractVariableReferences(ast);
  assert.deepEqual([...refs].sort(), ['alpha', 'beta', 'delta', 'gamma']);

  // 2. 合法性与白名单校验
  const validRes = validateFormula('alpha * 2 + beta', ['alpha', 'beta', 'omega']);
  assert.equal(validRes.valid, true);
  assert.equal(validRes.errors.length, 0);
  assert.deepEqual(validRes.referencedVariables.sort(), ['alpha', 'beta']);

  // 3. 未知变量拦截
  const unknownRes = validateFormula('alpha * 2 + unknown_x', ['alpha', 'beta']);
  assert.equal(unknownRes.valid, false);
  assert.ok(unknownRes.errors.some((e) => e.includes('unknown_x')));

  // 4. 空公式或非法语法拦截
  const emptyRes = validateFormula('   ');
  assert.equal(emptyRes.valid, false);
  const syntaxErrRes = validateFormula('10 + * 5');
  assert.equal(syntaxErrRes.valid, false);

  // 5. 向后兼容 validateFormulaSyntax
  const legacyErrors = validateFormulaSyntax('a + b', ['a', 'b']);
  assert.equal(legacyErrors.length, 0);
});
