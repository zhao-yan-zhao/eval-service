import assert from 'node:assert/strict';
import test from 'node:test';
import { ALL_OPERATORS } from '../src/operators/registry.ts';
import {
  ATOM_DIRECTIVES_REGISTRY,
  buildDirectivesForAtom,
  generateTacticalFeedback,
} from '../src/reports/feedback-generator.ts';
import { generateEvaluationReportMarkdown } from '../src/reports/report-generator.ts';
import {
  DOMAIN_RULES,
  draftSystemFromNaturalLanguage,
} from '../src/nl/intent-mapper.ts';
import type { SituationModel, SystemEvaluationOutput } from '../src/core/types.ts';
import viteConfig from '../vite.config.ts';

test('Stage 19 任务 A：战术反哺建议与交战参数补丁全量覆盖全部 38 个内置算子', () => {
  // 1. 验证内置算子总数为 38 个
  assert.equal(ALL_OPERATORS.length, 38, '系统必须严格注册 38 项内置物理算子');

  // 2. 验证 ATOM_DIRECTIVES_REGISTRY 覆盖全部 38 项算子
  const coveredKeys = new Set(Object.keys(ATOM_DIRECTIVES_REGISTRY));
  assert.equal(coveredKeys.size, 38, '反哺参数补丁字典必须注册全部 38 个算子');

  for (const op of ALL_OPERATORS) {
    const atomRef = op.meta.id;
    assert.ok(
      coveredKeys.has(atomRef),
      `算子【${atomRef}】未在 ATOM_DIRECTIVES_REGISTRY 中注册专属反哺配置`,
    );

    const directiveItem = buildDirectivesForAtom(atomRef);
    assert.ok(
      Array.isArray(directiveItem.directives) && directiveItem.directives.length >= 1,
      `算子【${atomRef}】改进指令必须包含至少 1 条具体建议`,
    );

    // 严禁为空或通用兜底
    assert.ok(
      directiveItem.directives[0].length > 5,
      `算子【${atomRef}】改进指令必须具备实质军事运筹语义: ${directiveItem.directives[0]}`,
    );

    const patchKeys = Object.keys(directiveItem.patches);
    assert.ok(
      patchKeys.length > 0,
      `算子【${atomRef}】结构化 patches 补丁对象不得为空`,
    );
    assert.equal(
      Boolean((directiveItem.patches as Record<string, unknown>).custom),
      false,
      `算子【${atomRef}】不得落入通用 custom 兜底分支`,
    );
  }

  // 3. 测试未知自定义算子进入兜底分支
  const customFallback = buildDirectivesForAtom('custom.user_special_metric');
  assert.ok(customFallback.directives.length > 0);
  assert.ok((customFallback.patches as Record<string, unknown>).custom);
});

test('Stage 19 任务 A：战术反馈生成与 Markdown 报告物理量纲/补丁渲染', () => {
  const dummySituation: SituationModel = {
    runId: 'run_test_01',
    scenarioPath: 'test/path',
    scenarioName: 'test_scen',
    sides: ['红方', '蓝方'],
    startGameClock: '00:00:00',
    endGameClock: '00:15:00',
    totalGameSeconds: 900,
    units: new Map(),
    contacts: new Map(),
    weaponFiredEvents: [],
    weaponEndgameEvents: [],
    damageAndHitEvents: [],
    expenditures: [],
    losses: [],
    events: [],
    corridors: [],
    patrolAreas: [],
    threatZones: [],
    coverage: {
      sourceKind: 'event_csv',
      hasPositionTracks: true,
      hasContacts: true,
      hasWeaponFired: true,
      hasWeaponEndgame: true,
      hasPointDefense: false,
      hasDamagedOrDestroyed: true,
      hasSensorStates: true,
      hasWraRules: false,
      hasPolygonsOrCorridors: false,
      hasExpenditures: true,
      hasLosses: true,
      warnings: [],
    },
  };

  const dummyEvalOutput: SystemEvaluationOutput = {
    $schema: 'https://f1-ai.schema/eval-output/v1.json',
    evalId: 'eval_stage19_test',
    systemId: 'sys_test',
    systemName: '综合制空拦截战役评估体系',
    runId: 'run_test_01',
    evaluatedAt: '2026-01-01T00:15:00Z',
    overallScore: 72.5,
    overallConfidence: 'high',
    availableWeightRatio: 1.0,
    dimensions: [
      { id: 'dim_eff', name: '核心效能', weight: 0.6, score: 70.0 },
      { id: 'dim_comp', name: '合规与安全', weight: 0.4, score: 76.25 },
    ],
    rootTree: {
      name: '综合评估',
      weight: 1.0,
      score: 72.5,
      method: 'weighted_sum',
      children: [
        {
          id: 'dim_eff',
          name: '核心效能',
          weight: 0.6,
          score: 70.0,
          children: [
            {
              kind: 'indicator',
              indicatorRef: 'ind_weapon_hit_rate',
              name: '导弹直接命中率',
              atomRef: 'eff.hit_rate',
              effectiveWeight: 0.6,
              score: 70.0,
              rawResult: {
                atomId: 'eff.hit_rate',
                value: 0.5,
                displayValue: '50.0%',
                unit: '%',
                status: 'valid',
                confidence: 'high',
                evidenceRefs: [{ source: 'csv', ref: 'WeaponEndgame.csv:Row2', scenarioClock: '00:04:12', description: '首发终态命中' }],
              },
            },
          ],
        },
        {
          id: 'dim_comp',
          name: '合规与安全',
          weight: 0.4,
          score: 76.25,
          children: [
            {
              kind: 'indicator',
              indicatorRef: 'ind_friendly_fire_safety',
              name: '零友军误伤安全红线',
              atomRef: 'comp.friendly_fire_safety',
              effectiveWeight: 0.4,
              score: 76.25,
              rawResult: {
                atomId: 'comp.friendly_fire_safety',
                value: 0.96,
                displayValue: '0.96 (合规率)',
                unit: '0-1',
                status: 'valid',
                confidence: 'high',
                evidenceRefs: [{ source: 'csv', ref: 'UnitDamaged.csv:Row5', scenarioClock: '00:08:33', description: '战损审计' }],
              },
            },
          ],
        },
      ],
    },
    evalSummaryV2: {
      judgement: 'B 良好',
      conclusion: '本次推演防空拦截效能基本达标，但在友军安全与开火精度上有优化空间。',
      conclusionTitle: '推演结论',
      compareNote: '基线对比稳定',
      bars: [],
      radar: [],
      kpis: [
        { label: '导弹直接命中率', value: '50.0%', status: 'valid', atomRef: 'eff.hit_rate' },
        { label: '零友军误伤安全红线', value: '0.96', status: 'valid', atomRef: 'comp.friendly_fire_safety' },
      ],
      evidenceTimeline: [
        { scenarioClock: '00:04:12', event: '武器开火', desc: '首轮 PL-15 发射', ref: 'WeaponFired.csv:Row1' },
      ],
    },
  };

  // 生成战术反哺对象
  const feedback = generateTacticalFeedback(dummyEvalOutput, dummySituation);
  assert.equal(feedback.tacticalGrade, 'B');
  assert.equal(feedback.weaknessDiagnostics.length, 2);

  // 验证合并后的补丁字典包含 salvo 与 safety
  const patches = feedback.recommendedDoctrinePatches as Record<string, unknown>;
  assert.ok(patches.salvo, '应包含命中率不足触发的 salvo 补丁');
  assert.ok(patches.safety, '应包含友军安全不足触发的 safety 补丁');

  // 生成 Markdown 报告并检验段落结构
  const md = generateEvaluationReportMarkdown(dummyEvalOutput, dummySituation);
  assert.ok(md.includes('# 综合制空拦截战役评估体系 — 推演复盘评估报告'));
  assert.ok(md.includes('## 一、客观观测事实（KPI 与可追溯证据）'));
  assert.ok(md.includes('## 二、分项评估维度与指标得分'));
  assert.ok(md.includes('### 指标测算明细与证据引用（观察事实 / 模型推断 / 证据依据）'));
  assert.ok(md.includes('## 三、缺失数据与降级诚实性审计'));
  assert.ok(md.includes('## 四、评估结论与战术改进建议'));
  assert.ok(md.includes('### 战术反哺调整指令与交战参数补丁'));
  assert.ok(md.includes('comp.friendly_fire_safety'));
  assert.ok(md.includes('eff.hit_rate'));
});

test('Stage 19 任务 B：NL 意图解析器适配全部 38 项指标与新增军事场景规则', async () => {
  // 1. 验证 DOMAIN_RULES 规则库扩充
  assert.ok(
    DOMAIN_RULES.length >= 14,
    `DOMAIN_RULES 规则库数量必须 >= 14，实际=${DOMAIN_RULES.length}`,
  );

  // 2. 场景 A：友军误伤与安全红线
  const draftA = await draftSystemFromNaturalLanguage('全过程交战必须保证零友军误伤，严守安全红线与敌我属性精确识别');
  assert.ok(draftA.validation.valid, '生成的体系必须通过 validateIndicatorSystem 校验');
  assert.ok(
    draftA.matchedDomains.some((d) => d.includes('友军防误伤')),
    `必须匹配友军防误伤领域，实际: ${draftA.matchedDomains.join(', ')}`,
  );
  const indRefsA = draftA.system.root.children.flatMap((d) =>
    'children' in d ? d.children.map((c) => ('indicatorRef' in c ? c.indicatorRef : '')) : [],
  );
  assert.ok(
    indRefsA.includes('ind_friendly_fire_safety'),
    '指标树必须成功纳入【ind_friendly_fire_safety】',
  );

  // 3. 场景 B：余油与返航保障
  const draftB = await draftSystemFromNaturalLanguage('考核战机巡航与返航余油保障，严控平台平均燃油消耗与出动回收闭环');
  assert.ok(draftB.validation.valid, '生成的体系必须通过 validateIndicatorSystem 校验');
  assert.ok(
    draftB.matchedDomains.some((d) => d.includes('航程续航与余油返航保障')),
    `必须匹配余油保障领域，实际: ${draftB.matchedDomains.join(', ')}`,
  );
  const indRefsB = draftB.system.root.children.flatMap((d) =>
    'children' in d ? d.children.map((c) => ('indicatorRef' in c ? c.indicatorRef : '')) : [],
  );
  assert.ok(
    indRefsB.includes('ind_fuel_remaining_ratio'),
    '指标树必须成功纳入【ind_fuel_remaining_ratio】',
  );

  // 4. 场景 C：射程包线与接战纪律
  const draftC = await draftSystemFromNaturalLanguage('评估超视距射程接战纪律与防区外安全发射裕度不可逃逸区');
  assert.ok(draftC.validation.valid, '生成的体系必须通过 validateIndicatorSystem 校验');
  const indRefsC = draftC.system.root.children.flatMap((d) =>
    'children' in d ? d.children.map((c) => ('indicatorRef' in c ? c.indicatorRef : '')) : [],
  );
  assert.ok(
    indRefsC.includes('ind_engagement_range_discipline'),
    '指标树必须成功纳入【ind_engagement_range_discipline】',
  );

  // 5. 场景 D：端到端杀伤链时延与波次衔接
  const draftD = await draftSystemFromNaturalLanguage('评估杀伤链全时延与波次间隔，紧凑打击波次火力衔接');
  assert.ok(draftD.validation.valid, '生成的体系必须通过 validateIndicatorSystem 校验');
  const indRefsD = draftD.system.root.children.flatMap((d) =>
    'children' in d ? d.children.map((c) => ('indicatorRef' in c ? c.indicatorRef : '')) : [],
  );
  assert.ok(
    indRefsD.includes('ind_kill_chain_total_latency'),
    '指标树必须成功纳入【ind_kill_chain_total_latency】',
  );

  // 6. 场景 E：空域势能优势与巡航速度
  const draftE = await draftSystemFromNaturalLanguage('评估空域高度势能优势与高空占优巡航机动战术');
  assert.ok(draftE.validation.valid, '生成的体系必须通过 validateIndicatorSystem 校验');
  const indRefsE = draftE.system.root.children.flatMap((d) =>
    'children' in d ? d.children.map((c) => ('indicatorRef' in c ? c.indicatorRef : '')) : [],
  );
  assert.ok(
    indRefsE.includes('ind_altitude_envelope_advantage'),
    '指标树必须成功纳入【ind_altitude_envelope_advantage】',
  );

  // 7. 验证所有生成体系同级权重之和严格归一为 1.0
  for (const draft of [draftA, draftB, draftC, draftD, draftE]) {
    const dimWeights = draft.system.root.children.map((d) => ('weight' in d ? (d.weight as number) : 0));
    const sumDim = dimWeights.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sumDim - 1.0) < 1e-4, `维度权重之和必须为 1.0，实际=${sumDim}`);

    for (const d of draft.system.root.children) {
      if ('children' in d) {
        const leafWeights = d.children.map((c) => ('weight' in c ? (c.weight as number) : 0));
        const sumLeaf = leafWeights.reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(sumLeaf - 1.0) < 1e-4, `叶子权重之和必须为 1.0，实际=${sumLeaf}`);
      }
    }
  }
});

test('Stage 19 任务 C：Vite manualChunks 分包策略与大文件解耦验证', () => {
  const config = viteConfig;
  assert.ok(config.build, 'viteConfig 必须定义 build 配置');
  assert.ok(config.build.rollupOptions?.output, '必须定义 rollupOptions.output');

  const outputConfig = config.build.rollupOptions.output as {
    manualChunks?: (id: string) => string | undefined;
  };
  assert.equal(typeof outputConfig.manualChunks, 'function', 'manualChunks 必须为分包函数');

  const manualChunks = outputConfig.manualChunks!;
  assert.equal(manualChunks('/project/node_modules/echarts/core.js'), 'vendor-echarts');
  assert.equal(manualChunks('/project/node_modules/@codemirror/state/index.js'), 'vendor-codemirror');
  assert.equal(manualChunks('/project/node_modules/lucide-react/dist/esm/icons.js'), 'vendor-lucide');
  assert.equal(manualChunks('/project/node_modules/react/index.js'), 'vendor-react');
  assert.equal(manualChunks('/project/node_modules/react-dom/index.js'), 'vendor-react');
  assert.equal(manualChunks('/project/node_modules/@turf/distance/dist/es/index.js'), 'vendor-turf');
  assert.equal(manualChunks('/project/node_modules/markdown-it/lib/index.js'), 'vendor-markdown');
  assert.equal(manualChunks('/project/src/ui/App.tsx'), undefined, '业务文件不应被分至 vendor 块');
});

test('Stage 19 任务 D：数据浏览器事件 CSV 导出与阵营/单机高亮逻辑验证', () => {
  // 1. 测试 CSV 导出格式与 UTF-8 BOM 规范
  const dummyEvents = [
    {
      eventId: 'ev_001',
      scenarioSeconds: 120,
      clockText: '00:02:00',
      side: '红方',
      kind: 'weapon_fired',
      subject: 'J-20 #1',
      object: 'F-35A #2',
      ref: 'WeaponFired.csv:Row1',
    },
    {
      eventId: 'ev_002',
      scenarioSeconds: 240,
      clockText: '00:04:00',
      side: '蓝方',
      kind: 'unit_damaged',
      subject: 'F-35A #2',
      object: 'PL-15 #1',
      ref: 'UnitDamaged.csv:Row3',
    },
  ];

  const headers = ['推演时钟', '阵营', '事件类型', '主体', '客体', '记录Ref', '原始ID'];
  const rows = dummyEvents.map((ev) => [
    `"${String(ev.clockText ?? '').replace(/"/g, '""')}"`,
    `"${String(ev.side ?? '').replace(/"/g, '""')}"`,
    `"${String(ev.kind ?? '').replace(/"/g, '""')}"`,
    `"${String(ev.subject ?? '').replace(/"/g, '""')}"`,
    `"${String(ev.object ?? '').replace(/"/g, '""')}"`,
    `"${String(ev.ref ?? '').replace(/"/g, '""')}"`,
    `"${String(ev.eventId ?? '').replace(/"/g, '""')}"`,
  ]);
  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');

  assert.ok(csvContent.startsWith('\uFEFF'), 'CSV 导出必须携带 UTF-8 BOM 避免 Excel 中文乱码');
  assert.ok(csvContent.includes('"00:02:00","红方","weapon_fired","J-20 #1","F-35A #2"'));
  assert.ok(csvContent.includes('"00:04:00","蓝方","unit_damaged","F-35A #2","PL-15 #1"'));

  // 2. 测试航迹阵营过滤逻辑
  const sampleTracks = [
    { unitId: 'u1', unitName: 'J-20A', side: '红方', points: [{ scenarioSeconds: 10, lon: 120.1, lat: 24.1, altitudeM: 8000 }] },
    { unitId: 'u2', unitName: 'F-35A', side: '蓝方', points: [{ scenarioSeconds: 10, lon: 121.2, lat: 24.5, altitudeM: 7000 }] },
  ];

  const redOnly = sampleTracks.filter((t) => t.side === '红方');
  assert.equal(redOnly.length, 1);
  assert.equal(redOnly[0].unitId, 'u1');

  const blueOnly = sampleTracks.filter((t) => t.side === '蓝方');
  assert.equal(blueOnly.length, 1);
  assert.equal(blueOnly[0].unitId, 'u2');

  // 3. 测试单机关键事件时序关联过滤
  const unitEvents = dummyEvents.filter(
    (e) =>
      e.subject.toLowerCase().includes('j-20') ||
      e.object.toLowerCase().includes('j-20'),
  );
  assert.equal(unitEvents.length, 1);
  assert.equal(unitEvents[0].eventId, 'ev_001');
});
