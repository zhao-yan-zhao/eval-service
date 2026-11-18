import type { IndicatorDefinition, IndicatorSystem, SystemDimensionNode } from '../core/types.ts';
import { defaultIndicatorStore, type IndicatorStore } from '../indicators/store.ts';
import { listOperatorMetas } from '../operators/registry.ts';
import { normalizeSystemWeights, validateIndicatorSystem, type SystemValidationResult } from '../systems/validator.ts';

interface KeywordBoostRule {
  keywords: string[];
  domainLabel: string;
  categoryWeights: Partial<Record<'effectiveness' | 'time' | 'situation' | 'compliance' | 'cost', number>>;
  indicatorBoosts?: Record<string, number>;
}

const DOMAIN_RULES: KeywordBoostRule[] = [
  {
    keywords: ['反潜', '潜艇', '声呐', '浮标', '封锁', '巡逻', 'asw', 'submarine'],
    domainLabel: '海上反潜与区域封锁',
    categoryWeights: { situation: 0.30, time: 0.25, effectiveness: 0.25, compliance: 0.15, cost: 0.05 },
    indicatorBoosts: {
      ind_blind_zone_control: 2.0,
      ind_patrol_coverage: 2.0,
      ind_emcon_discipline: 1.8,
      ind_first_detect_fast: 1.6,
    },
  },
  {
    keywords: ['超视距', 'bvr', '空战', 'pl-15', 'aim-120', '歼击', '空空'],
    domainLabel: '超视距空战与先敌发射',
    categoryWeights: { effectiveness: 0.40, time: 0.25, situation: 0.20, cost: 0.10, compliance: 0.05 },
    indicatorBoosts: {
      ind_weapon_hit_rate: 2.0,
      ind_attrition_exchange: 1.9,
      ind_first_fire_tempo: 1.7,
      ind_standoff_margin: 1.7,
    },
  },
  {
    keywords: ['防空', '反导', '拦截', '要地', 'sam', 'wra', '突防'],
    domainLabel: '区域防空反导与截击纪律',
    categoryWeights: { effectiveness: 0.38, time: 0.25, compliance: 0.17, situation: 0.12, cost: 0.08 },
    indicatorBoosts: {
      ind_ooda_latency: 2.0,
      ind_wra_compliance: 1.8,
      ind_target_penetration: 1.7,
      ind_weapon_hit_rate: 1.7,
    },
  },
  {
    keywords: ['集群', '无人机', '协同', '饱和', '走廊', '蜂群', 'swarm'],
    domainLabel: '无人集群协同与饱和突击',
    categoryWeights: { effectiveness: 0.32, situation: 0.28, time: 0.18, compliance: 0.12, cost: 0.10 },
    indicatorBoosts: {
      ind_formation_stability: 2.0,
      ind_saturation_sync: 2.0,
      ind_corridor_compliance: 1.8,
      ind_enemy_kill_eff: 1.7,
    },
  },
  {
    keywords: ['成本', '经济', '效费比', '省弹', '费效', '预算', 'cost'],
    domainLabel: '高经济效费比约束',
    categoryWeights: { cost: 0.30, effectiveness: 0.35, time: 0.15, situation: 0.12, compliance: 0.08 },
    indicatorBoosts: {
      ind_ammo_economy: 2.2,
      ind_econ_exchange_ratio: 2.2,
    },
  },
  {
    keywords: ['反应', '速度', '时效', 'ooda', '抢先', '延时', '快'],
    domainLabel: '快节奏 OODA 时效优先',
    categoryWeights: { time: 0.38, effectiveness: 0.32, situation: 0.15, compliance: 0.08, cost: 0.07 },
    indicatorBoosts: {
      ind_first_detect_fast: 2.0,
      ind_first_fire_tempo: 1.9,
      ind_ooda_latency: 2.2,
      ind_first_hit_speed: 1.8,
    },
  },
  {
    keywords: ['合规', '走廊', '静默', '规则', 'roe', 'emcon', '安全'],
    domainLabel: '空间走廊与电磁交战纪律',
    categoryWeights: { compliance: 0.30, situation: 0.25, effectiveness: 0.25, time: 0.12, cost: 0.08 },
    indicatorBoosts: {
      ind_corridor_compliance: 2.2,
      ind_wra_compliance: 2.0,
      ind_emcon_discipline: 2.0,
      ind_standoff_margin: 1.8,
    },
  },
];

const CATEGORY_TITLES: Record<'effectiveness' | 'time' | 'situation' | 'compliance' | 'cost', string> = {
  effectiveness: '任务毁伤与核心效能',
  time: '杀伤链 OODA 时效',
  situation: '空间态势与阵位协同',
  compliance: '交战规则与电磁合规',
  cost: '弹药消耗与经济费效',
};

export interface NlDraftResult {
  system: IndicatorSystem;
  validation: SystemValidationResult;
  mode: 'deterministic_dsl' | 'llm_enhanced';
  matchedDomains: string[];
  rationale: string;
}

export async function draftSystemFromNaturalLanguage(
  prompt: string,
  options?: {
    systemId?: string;
    name?: string;
    indicatorStore?: IndicatorStore;
  },
): Promise<NlDraftResult> {
  const indicatorStore = options?.indicatorStore ?? defaultIndicatorStore;
  const allIndicators = indicatorStore.listAll();
  const metas = new Map(listOperatorMetas().map((m) => [m.id, m]));
  const lowerPrompt = prompt.toLowerCase();

  // 聚合领域权重基线
  const catScores: Record<'effectiveness' | 'time' | 'situation' | 'compliance' | 'cost', number> = {
    effectiveness: 0.35,
    time: 0.22,
    situation: 0.20,
    compliance: 0.13,
    cost: 0.10,
  };
  const indicatorPriority = new Map<string, number>();
  const matchedDomains: string[] = [];

  for (const rule of DOMAIN_RULES) {
    const hits = rule.keywords.filter((kw) => lowerPrompt.includes(kw.toLowerCase()));
    if (hits.length > 0) {
      matchedDomains.push(`${rule.domainLabel} (命中: ${hits.join('/')})`);
      for (const [k, w] of Object.entries(rule.categoryWeights)) {
        const key = k as keyof typeof catScores;
        catScores[key] = (catScores[key] ?? 0) + (w ?? 0) * hits.length * 0.5;
      }
      if (rule.indicatorBoosts) {
        for (const [indId, boost] of Object.entries(rule.indicatorBoosts)) {
          indicatorPriority.set(indId, (indicatorPriority.get(indId) ?? 1) + boost * hits.length);
        }
      }
    }
  }

  // 同时按算子与指标名称直接匹配加权
  for (const ind of allIndicators) {
    const text = `${ind.name} ${ind.description ?? ''} ${(ind.tags ?? []).join(' ')}`.toLowerCase();
    for (const token of lowerPrompt.split(/[\s,，。；;、]+/).filter((t) => t.length >= 2)) {
      if (text.includes(token)) {
        indicatorPriority.set(ind.indicatorId, (indicatorPriority.get(ind.indicatorId) ?? 1) + 1.5);
      }
    }
  }

  // 按五域分组并选取高相关指标构成严谨维度树
  const byCategory = new Map<'effectiveness' | 'time' | 'situation' | 'compliance' | 'cost', IndicatorDefinition[]>();
  for (const ind of allIndicators) {
    const meta = metas.get(ind.atomRef);
    if (!meta) continue;
    const arr = byCategory.get(meta.category) ?? [];
    arr.push(ind);
    byCategory.set(meta.category, arr);
  }

  const dimensions: SystemDimensionNode[] = [];
  for (const [cat, rawList] of byCategory.entries()) {
    const ranked = [...rawList].sort(
      (a, b) => (indicatorPriority.get(b.indicatorId) ?? 1) - (indicatorPriority.get(a.indicatorId) ?? 1),
    );
    const chosen = ranked.slice(0, Math.min(cat === 'effectiveness' ? 4 : 3, ranked.length));
    if (chosen.length === 0) continue;

    dimensions.push({
      id: `dim_${cat}`,
      name: CATEGORY_TITLES[cat],
      weight: catScores[cat],
      children: chosen.map((ind) => ({
        indicatorRef: ind.indicatorId,
        weight: indicatorPriority.get(ind.indicatorId) ?? 1,
      })),
    });
  }

  // 挑选顶栏最受关注的 4 项 KPI
  const allChosenLeaves = dimensions.flatMap((d) =>
    d.children.map((ch) => ({
      id: 'indicatorRef' in ch ? ch.indicatorRef : '',
      pri: 'indicatorRef' in ch ? (indicatorPriority.get(ch.indicatorRef) ?? 1) : 0,
    })),
  );
  allChosenLeaves.sort((a, b) => b.pri - a.pri);

  const kpis = allChosenLeaves.slice(0, 4).map((x) => {
    const def = indicatorStore.get(x.id)!;
    const meta = metas.get(def.atomRef);
    const formatter: IndicatorSystem['kpis'][number]['formatter'] =
      meta?.outputType === 'duration_seconds'
        ? 'duration_sec'
        : meta?.outputType === 'count'
          ? 'count'
          : 'ratio';
    return {
      label: def.name,
      atomRef: def.atomRef,
      formatter,
    };
  });

  const cleanSlug =
    options?.systemId ??
    `sys_nl_${Date.now().toString(36)}`;

  const draftRaw: IndicatorSystem = {
    $schema: 'https://f1-ai.schema/eval-system/v1.json',
    systemId: cleanSlug,
    name: options?.name?.trim() || `定制评估体系：${prompt.slice(0, 22)}${prompt.length > 22 ? '…' : ''}`,
    version: '1.0.0-draft',
    author: '体系生成引擎',
    description: `基于任务需求描述自动构建：「${prompt}」`,
    targetTags: ['体系草案', ...(matchedDomains.length ? [matchedDomains[0].split(' ')[0]] : ['通用'])],
    kpis,
    root: {
      name: '综合评估',
      weight: 1.0,
      method: 'weighted_sum',
      children: dimensions,
    },
    builtin: false,
  };

  const normalized = normalizeSystemWeights(draftRaw);
  const validation = validateIndicatorSystem(normalized, indicatorStore);

  const rationale =
    matchedDomains.length > 0
      ? `已识别关键任务特征：${matchedDomains.join('；')}，据此调整各维度权重并配置关联指标。`
      : '未匹配到特定领域特征词，已按标准通用架构配置各维度与对应指标。';

  return {
    system: normalized,
    validation,
    mode: 'deterministic_dsl',
    matchedDomains,
    rationale,
  };
}
