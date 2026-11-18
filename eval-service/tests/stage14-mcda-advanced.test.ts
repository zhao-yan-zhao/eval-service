import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeAhpWeights,
  computeCriticWeights,
  computeCombinedWeights,
  computeEntropyWeights,
  computeTopsisRank,
  computeVikorRank,
  runPythonSandboxScript,
  shutdownPythonMcdaDaemon,
} from '../src/operators/mcda-adapter.ts';

test('Stage 14.1 - 持久化守护进程 (Daemon) 高速并发与一致性诊断定位', async () => {
  // 1. 测试连续快速调用（验证守护进程低延迟）
  const t0 = performance.now();
  const ahpOk = await computeAhpWeights(
    [
      [1, 2, 4],
      [1 / 2, 1, 2],
      [1 / 4, 1 / 2, 1],
    ],
    ['态势感知', '毁伤效能', '反应速度'],
  );
  const t1 = performance.now();

  assert.equal(ahpOk.consistent, true);
  assert.ok(ahpOk.cr < 0.01);
  assert.equal(ahpOk.weights.length, 3);
  assert.equal(ahpOk.inconsistencyDiagnosis, null);

  // 第二次调用（守护进程已就绪，时延极低）
  const t2 = performance.now();
  const ahpSecond = await computeAhpWeights([
    [1, 3],
    [1 / 3, 1],
  ]);
  const t3 = performance.now();
  assert.equal(ahpSecond.consistent, true);
  assert.ok(t3 - t2 < 100, `守护进程热调用耗时应极低，实际: ${t3 - t2}ms`);

  // 2. 测试高阶 RI (n=16) 外推计算
  const matrix16 = Array.from({ length: 16 }, () => Array(16).fill(1));
  const ahp16 = await computeAhpWeights(matrix16);
  assert.ok(ahp16.ri > 1.59, `n=16 时 RI 应通过公式计算大于 1.59，实际: ${ahp16.ri}`);

  // 3. 测试不一致性矩阵并精确定位矛盾指标对
  const inconsistentMatrix = [
    [1, 9, 1 / 9],
    [1 / 9, 1, 9],
    [9, 1 / 9, 1],
  ];
  const ahpBad = await computeAhpWeights(inconsistentMatrix, ['火力', '速度', '成本']);
  assert.equal(ahpBad.consistent, false);
  assert.ok(ahpBad.cr > 0.1);
  assert.ok(ahpBad.inconsistencyDiagnosis !== null && ahpBad.inconsistencyDiagnosis !== undefined);
  assert.ok(ahpBad.inconsistencyDiagnosis!.recommendation.includes('建议重点核验'));
});

test('Stage 14.2 - CRITIC 客观赋权法与主客观组合赋权 (Combined Weights)', async () => {
  // 3 方案 x 3 指标
  const matrix = [
    [0.9, 320, 15],
    [0.7, 450, 25],
    [0.85, 280, 10],
  ];
  const dirs: Array<'larger_is_better' | 'smaller_is_better'> = [
    'larger_is_better',
    'larger_is_better',
    'smaller_is_better',
  ];
  const names = ['命中率', '巡航速度', '油耗成本'];

  // 1. CRITIC 赋权测试
  const critic = await computeCriticWeights(matrix, dirs, names);
  assert.equal(critic.weights.length, 3);
  const sumCritic = critic.weights.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sumCritic - 1.0) < 1e-4);
  assert.equal(critic.stdDevs.length, 3);
  assert.equal(critic.conflictScores.length, 3);

  // 2. 主客观组合赋权测试 (alpha = 0.6 主观权重)
  const subjWeights = [0.5, 0.3, 0.2];
  const combined = await computeCombinedWeights({
    subjectiveWeights: subjWeights,
    objectiveWeights: critic.weights,
    alpha: 0.6,
    criterionNames: names,
  });
  assert.equal(combined.weights.length, 3);
  const sumCombined = combined.weights.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sumCombined - 1.0) < 1e-4);
  assert.equal(combined.alphaUsed, 0.6);
  assert.ok(combined.namedWeights !== null);
});

test('Stage 14.3 - TOPSIS 绝对基准与 VIKOR 折中排序算法', async () => {
  const matrix = [
    [0.92, 120, 4.5], // 方案A
    [0.78, 90, 8.2],  // 方案B
    [0.85, 110, 6.0], // 方案C
  ];
  const dirs: Array<'larger_is_better' | 'smaller_is_better'> = [
    'larger_is_better',
    'larger_is_better',
    'smaller_is_better',
  ];
  const weights = [0.4, 0.3, 0.3];
  const alts = ['方案A', '方案B', '方案C'];

  // 1. TOPSIS 增强：包含绝对理想解与属性归因
  const topsis = await computeTopsisRank({
    matrix,
    weights,
    directions: dirs,
    alternatives: alts,
    customIdealBest: [1.0, 150, 3.0],
    customIdealWorst: [0.6, 60, 10.0],
  });
  assert.equal(topsis.ranking[0].name, '方案A');
  assert.ok(topsis.ranking[0].closeness > topsis.ranking[1].closeness);
  assert.ok(topsis.ranking[0].dimensionAttribution !== undefined);
  assert.ok(topsis.llmEvaluationContext !== undefined);
  assert.equal(topsis.llmEvaluationContext?.bestAlternative, '方案A');

  // 2. VIKOR 折中排序测试
  const vikor = await computeVikorRank({
    matrix,
    weights,
    directions: dirs,
    alternatives: alts,
    v: 0.5,
  });
  assert.equal(vikor.ranking.length, 3);
  assert.equal(vikor.ranking[0].rank, 1);
  assert.equal(vikor.compromiseBest, '方案A');
});

test('Stage 14.4 - Python 算法沙箱真机执行内核 (runPythonSandboxScript)', async () => {
  // 1. 正常函数试跑
  const scriptCode = `
import math

def evaluate(context):
    v = context.get('speed', 100.0)
    angle_deg = context.get('angle', 45.0)
    rad = math.radians(angle_deg)
    h_max = (v ** 2) * (math.sin(rad) ** 2) / (2 * 9.8)
    print(f"[TEST_LOG] Computed h_max = {h_max:.2f} m")
    return {
        "status": "ok",
        "h_max_m": round(h_max, 2)
    }
`;
  const res = await runPythonSandboxScript({
    script: scriptCode,
    context: { speed: 200.0, angle: 30.0 },
  });

  assert.equal(res.status, 'success');
  assert.ok(res.output !== undefined);
  assert.equal(res.output.status, 'ok');
  assert.ok(res.output.h_max_m > 0);
  assert.ok(res.stdout?.includes('[TEST_LOG] Computed h_max'));

  // 2. 异常脚本捕获 (SyntaxError / ZeroDivisionError)
  const badScript = `
def evaluate(context):
    return 10 / 0
`;
  const errRes = await runPythonSandboxScript({
    script: badScript,
    context: {},
  });
  assert.equal(errRes.status, 'error');
  assert.ok(errRes.stderr?.includes('ZeroDivisionError'));

  // 3. 安全沙箱防线：拦截危险模块注入与敏感调用 (AST Guard)
  const unsafeImportScript = `
import os

def evaluate(context):
    return {"env": os.environ.get("PATH")}
`;
  const secImportRes = await runPythonSandboxScript({
    script: unsafeImportScript,
    context: {},
  });
  assert.equal(secImportRes.status, 'error');
  assert.ok(secImportRes.stderr?.includes('[SECURITY_VIOLATION]'));
  assert.ok(secImportRes.stderr?.includes('os'));

  const unsafeCallScript = `
def evaluate(context):
    f = open("dummy.txt", "w")
    return {"status": "pwned"}
`;
  const secCallRes = await runPythonSandboxScript({
    script: unsafeCallScript,
    context: {},
  });
  assert.equal(secCallRes.status, 'error');
  assert.ok(secCallRes.stderr?.includes('[SECURITY_VIOLATION]'));
  assert.ok(secCallRes.stderr?.includes('open'));
});
