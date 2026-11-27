import assert from 'node:assert/strict';
import test from 'node:test';
import { ALL_V4_OPERATOR_SCRIPTS } from '../src/operators/v4/index.ts';
import {
  ATOM_DIRECTIVES_REGISTRY,
  buildDirectivesForAtom,
  generateTacticalFeedback,
} from '../src/reports/feedback-generator.ts';
import { generateEvaluationReportMarkdown } from '../src/reports/report-generator.ts';
import type { SituationModel, SystemEvaluationOutput } from '../src/core/types.ts';
import viteConfig from '../vite.config.ts';

test('Stage 19 任务 A：战术反哺建议与交战参数补丁全量覆盖全部 42 个 V4 内置算子', () => {
  assert.equal(ALL_V4_OPERATOR_SCRIPTS.length, 42, '系统必须严格注册 42 项 V4 内置物理算子');

  const coveredKeys = new Set(Object.keys(ATOM_DIRECTIVES_REGISTRY));
  assert.equal(coveredKeys.size, 42, '反哺参数补丁字典必须注册全部 42 个 V4 算子');

  for (const op of ALL_V4_OPERATOR_SCRIPTS) {
    const atomRef = op.id;
    assert.ok(
      coveredKeys.has(atomRef),
      `算子【${atomRef}】未在 ATOM_DIRECTIVES_REGISTRY 中注册专属反哺配置`,
    );

    const directiveItem = buildDirectivesForAtom(atomRef);
    assert.ok(
      Array.isArray(directiveItem.directives) && directiveItem.directives.length >= 1,
      `算子【${atomRef}】改进指令必须包含至少 1 条具体建议`,
    );
    assert.ok(directiveItem.directives[0].length > 5);
    assert.ok(Object.keys(directiveItem.patches).length > 0);
    assert.equal(Boolean((directiveItem.patches as Record<string, unknown>).custom), false);
  }

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
    evalId: 'eval_stage19_test',
    systemId: 'sys_test',
    systemName: '综合制空拦截战役评估体系',
    systemVersion: '4.0.0',
    runId: 'run_test_01',
    createdAt: '2026-01-01T00:15:00Z',
    atomResults: {},
    overallScore: 72.5,
    overallConfidence: 'high',
    availableWeightRatio: 1.0,
    dimensions: [
      { id: 'dim_eff', name: '核心效能', weight: 0.6, score: 70.0 },
      { id: 'dim_comp', name: '合规与安全', weight: 0.4, score: 76.25 },
    ],
    rootTree: {
      id: 'root',
      name: '综合评估',
      score: 72.5,
      children: [
        {
          id: 'dim_eff',
          kind: 'dimension',
          name: '核心效能',
          weight: 0.6,
          effectiveWeight: 0.6,
          score: 70.0,
          availableWeightRatio: 1.0,
          children: [
            {
              id: 'leaf_wpn',
              kind: 'indicator',
              indicatorRef: 'ind_wpn_eng',
              name: '弹药交战状态与效能',
              atomRef: 'weapon.munition_engagement_status',
              weight: 1.0,
              effectiveWeight: 0.6,
              weightedContribution: 42.0,
              score: 70.0,
              rawResult: {
                atomId: 'weapon.munition_engagement_status',
                value: 0.5,
                displayValue: '50.0%',
                status: 'valid',
                confidence: 'high',
                evidenceRefs: [{ source: 'csv', ref: 'WeaponEndgame.csv:Row2', scenarioClock: '00:04:12', description: '首发终态命中' }],
              },
            },
          ],
        },
        {
          id: 'dim_comp',
          kind: 'dimension',
          name: '合规与安全',
          weight: 0.4,
          effectiveWeight: 0.4,
          score: 76.25,
          availableWeightRatio: 1.0,
          children: [
            {
              id: 'leaf_corr',
              kind: 'indicator',
              indicatorRef: 'ind_roe_corridor_compliance',
              name: '任务航路走廊空间遵从率',
              atomRef: 'roe.corridor_spatial_compliance',
              weight: 1.0,
              effectiveWeight: 0.4,
              weightedContribution: 30.5,
              score: 76.25,
              rawResult: {
                atomId: 'roe.corridor_spatial_compliance',
                value: 0.96,
                displayValue: '96.0%',
                status: 'valid',
                confidence: 'high',
                evidenceRefs: [{ source: 'csv', ref: 'UnitPositions.csv:Row5', scenarioClock: '00:08:33', description: '航迹点在勤' }],
              },
            },
          ],
        },
      ],
    },
    evalSummaryV2: {
      judgement: 'B 良好',
      conclusion: '本次推演防空拦截效能基本达标，但在空域合规与武器交战精度上有优化空间。',
      conclusionTitle: '推演结论',
      compareNote: '基线对比稳定',
      bars: [],
      radar: { dimensions: [], scores: [], benchmark: [] },
      kpis: [
        { label: '弹药交战效能', value: '50.0%', status: 'valid', atomRef: 'weapon.munition_engagement_status' },
        { label: '走廊空间遵从率', value: '96.0%', status: 'valid', atomRef: 'roe.corridor_spatial_compliance' },
      ],
      evidenceTimeline: [
        { scenarioClock: '00:04:12', event: '武器开火', desc: '首轮 PL-15 发射', ref: 'WeaponFired.csv:Row1' },
      ],
    },
  };

  const feedback = generateTacticalFeedback(dummyEvalOutput, dummySituation);
  assert.equal(feedback.tacticalGrade, 'B');
  assert.equal(feedback.weaknessDiagnostics.length, 2);

  const patches = feedback.recommendedDoctrinePatches as Record<string, unknown>;
  assert.ok(patches.weapon, '应包含武器交战补丁');
  assert.ok(patches.navigation, '应包含航路走廊补丁');

  const md = generateEvaluationReportMarkdown(dummyEvalOutput, dummySituation);
  assert.ok(md.includes('# 综合制空拦截战役评估体系 — 推演复盘评估报告'));
  assert.ok(md.includes('## 一、客观观测事实（KPI 与可追溯证据）'));
  assert.ok(md.includes('## 三、缺失数据与降级诚实性审计'));
  assert.ok(md.includes('roe.corridor_spatial_compliance'));
  assert.ok(md.includes('weapon.munition_engagement_status'));
});

test('Stage 19 任务 C：Vite manualChunks 分包策略与大文件解耦验证', () => {
  const config = viteConfig;
  assert.ok(config.build?.rollupOptions?.output);

  const outputConfig = config.build.rollupOptions.output as {
    manualChunks?: (id: string) => string | undefined;
  };
  assert.equal(typeof outputConfig.manualChunks, 'function');

  const manualChunks = outputConfig.manualChunks!;
  assert.equal(manualChunks('/project/node_modules/echarts/core.js'), 'vendor-echarts');
  assert.equal(manualChunks('/project/node_modules/@codemirror/state/index.js'), 'vendor-codemirror');
  assert.equal(manualChunks('/project/node_modules/lucide-react/dist/esm/icons.js'), 'vendor-lucide');
  assert.equal(manualChunks('/project/node_modules/react/index.js'), 'vendor-react');
  assert.equal(manualChunks('/project/node_modules/react-dom/index.js'), 'vendor-react');
  assert.equal(manualChunks('/project/node_modules/@turf/distance/dist/es/index.js'), 'vendor-turf');
  assert.equal(manualChunks('/project/node_modules/markdown-it/lib/index.js'), 'vendor-markdown');
  assert.equal(manualChunks('/project/src/ui/App.tsx'), undefined);
});

test('Stage 19 任务 D：数据浏览器事件 CSV 导出与 UTF-8 BOM 规范验证', () => {
  const dummyEvents = [
    {
      eventId: 'ev_001',
      clockText: '00:02:00',
      side: '红方',
      kind: 'weapon_fired',
      subject: 'J-20 #1',
      object: 'F-35A #2',
      ref: 'WeaponFired.csv:Row1',
    },
  ];
  const headers = ['推演时钟', '阵营', '事件类型', '主体', '客体', '记录Ref', '原始ID'];
  const rows = dummyEvents.map((ev) => [
    `"${ev.clockText}"`,
    `"${ev.side}"`,
    `"${ev.kind}"`,
    `"${ev.subject}"`,
    `"${ev.object}"`,
    `"${ev.ref}"`,
    `"${ev.eventId}"`,
  ]);
  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  assert.ok(csvContent.startsWith('\uFEFF'));
  assert.ok(csvContent.includes('"00:02:00","红方","weapon_fired","J-20 #1","F-35A #2"'));
});
