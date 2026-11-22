import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import distance from '@turf/distance';
import { point as turfPoint, polygon as turfPolygon } from '@turf/helpers';
import type {
  DamageAndHitEvent,
  EvalPolygon,
  GeoPoint,
  MetricAtomContext,
  MetricAtomMeta,
  MetricAtomResult,
  SituationModel,
  SituationUnit,
  TargetUnitFilter,
  WeaponEndgameRecord,
} from '../core/types.ts';

export const KM_PER_NM = 1.852;

export interface OperatorSpec {
  meta: MetricAtomMeta;
  evaluate: (ctx: MetricAtomContext) => MetricAtomResult;
}

export function nmBetween(a: GeoPoint, b: GeoPoint): number {
  const km = distance(turfPoint([a.lon, a.lat]), turfPoint([b.lon, b.lat]), {
    units: 'kilometers',
  });
  return km / KM_PER_NM;
}

export function isPointInsidePolygon(pt: GeoPoint, poly: EvalPolygon): boolean {
  if (poly.points.length < 3) return false;
  const ring = poly.points.map((p) => [p.lon, p.lat]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return booleanPointInPolygon(turfPoint([pt.lon, pt.lat]), turfPolygon([ring]));
}

const SIDE_ALIAS_GROUPS: string[][] = [
  ['blue', '蓝方', '蓝', 'blueteam', 'blue_force', '蓝军'],
  ['red', '红方', '红', 'redteam', 'red_force', '红军'],
  ['green', '绿方', '绿', 'greenteam'],
  ['russian', '俄方', '俄', 'russianteam'],
  ['neutral', '中立', '中立方'],
];

export function getSideCanonicalKey(s: string): string {
  const clean = s.trim().toLowerCase();
  for (const group of SIDE_ALIAS_GROUPS) {
    if (group.some((alias) => clean === alias || clean.includes(alias))) {
      return group[0];
    }
  }
  return clean;
}

export function matchSide(paramSide: string | undefined, availableSides: string[]): string | undefined {
  if (!paramSide) return undefined;
  if (availableSides.includes(paramSide)) return paramSide;
  const lower = paramSide.toLowerCase();
  const ciMatch = availableSides.find((s) => s.toLowerCase() === lower);
  if (ciMatch) return ciMatch;

  const paramKey = getSideCanonicalKey(paramSide);
  const aliasMatch = availableSides.find((s) => getSideCanonicalKey(s) === paramKey);
  if (aliasMatch) return aliasMatch;

  const incMatch = availableSides.find(
    (s) => s.toLowerCase().includes(lower) || lower.includes(s.toLowerCase()),
  );
  if (incMatch) return incMatch;

  return paramSide;
}

export function isSameSide(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const cleanA = a.trim().toLowerCase();
  const cleanB = b.trim().toLowerCase();
  if (cleanA === cleanB) return true;
  if (getSideCanonicalKey(cleanA) === getSideCanonicalKey(cleanB)) return true;
  return cleanA.includes(cleanB) || cleanB.includes(cleanA);
}

/**
 * 完全阵营中立的双方解析器：
 * 绝不硬编码任何阵营名称（如红方/蓝方/Red/Blue），严格将 Side 作为推演数据中的普通字符串维度动态解析
 */
export function resolveSides(
  situation: SituationModel,
  customParams?: MetricAtomContext['customParams'],
): { targetSide?: string; enemySide?: string } {
  const sides = situation.sides.filter((s) => s && s !== 'Unknown');
  let targetSide = matchSide(customParams?.targetSide, sides);
  if (!targetSide) {
    targetSide = situation.weaponFiredEvents[0]?.firerSide ?? sides[0];
  }
  let enemySide = matchSide(customParams?.enemySide, sides);
  if (!enemySide && targetSide) {
    enemySide = sides.find((s) => !isSameSide(s, targetSide));
  }
  return { targetSide, enemySide };
}

export function unavailableResult(
  atomId: string,
  reason: string,
  isGate = false,
): MetricAtomResult {
  return {
    atomId,
    value: null,
    displayValue: '无有效证据 (不可用)',
    status: 'unavailable',
    confidence: 'low',
    evidenceRefs: [],
    missingDataReason: reason,
    ...(isGate ? { gateStatus: 'unavailable' as const } : {}),
  };
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'N/A';
  if (seconds < 120) return `${seconds.toFixed(1)} 秒`;
  const mins = seconds / 60;
  if (mins < 120) return `${mins.toFixed(1)} 分钟`;
  return `${(seconds / 3600).toFixed(2)} 小时`;
}

export function nearestTrackPoint(unit: SituationUnit, targetSeconds: number): GeoPoint | null {
  if (unit.trackPoints.length === 0) return null;
  let best = unit.trackPoints[0];
  let bestDiff = Math.abs(best.scenarioSeconds - targetSeconds);
  for (let i = 1; i < unit.trackPoints.length; i += 1) {
    const pt = unit.trackPoints[i];
    const diff = Math.abs(pt.scenarioSeconds - targetSeconds);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = pt;
    }
  }
  return { lon: best.lon, lat: best.lat };
}

export function isWeaponType(unitType?: string, unitClass?: string): boolean {
  const t = `${unitType ?? ''} ${unitClass ?? ''}`.toLowerCase();
  return /\bweapon\b|武器|missile|torpedo|rocket|guidedbomb|chaff|flare|decoy|sonobuoy|诱饵|弹|导弹|鱼雷|浮标/.test(t);
}

export function isNonWeaponUnit(u: SituationUnit): boolean {
  return !isWeaponType(u.unitType, u.unitClass);
}

export function isNonWeaponDamageEvent(situation: SituationModel, ev: DamageAndHitEvent): boolean {
  const unit = situation.units.get(ev.targetUnitId);
  if (unit) return isNonWeaponUnit(unit);
  return !isWeaponType(ev.targetUnitName);
}

export function isAirPlatform(u: SituationUnit): boolean {
  if (!isNonWeaponUnit(u)) return false;
  const t = `${u.unitType ?? ''} ${u.unitClass ?? ''}`.toLowerCase();
  if (/aircraft|uav|ucav|fighter|bomber|awacs|aew|tanker|heli|helicopter|drone|飞机|战机|无人机|预警机|加油机|直升机|轰炸机/.test(t)) {
    return true;
  }
  if (/ship|submarine|facility|surface|ground|vessel|艇|舰|潜艇|地面|雷达站/.test(t)) {
    return false;
  }
  return u.trackPoints.some((p) => (p.altitudeM ?? 0) > 50);
}

/** 判定识别状态是否达到美军 PID (Positive Identification) 明确识别等级 */
export function isPositiveIdentification(status?: string): boolean {
  if (!status) return false;
  const s = status.trim().toLowerCase();
  return (
    s === 'knowntype' ||
    s === 'knownclass' ||
    s === 'preciseid' ||
    s === 'known_type' ||
    s === 'known_class' ||
    s === 'precise_id' ||
    s.includes('precise') ||
    s.includes('knownclass') ||
    s.includes('knowntype') ||
    s.includes('明确识别') ||
    s.includes('精确识别')
  );
}

/** 目标集过滤（区分任务指定 Target Set 与全场单位） */
export function matchesTargetFilter(unit: SituationUnit, filter?: TargetUnitFilter): boolean {
  if (!filter) return true;
  if (filter.unitIds?.length) {
    const idSet = new Set(filter.unitIds.map((x) => x.trim().toLowerCase()));
    if (!idSet.has(unit.unitId.toLowerCase())) return false;
  }
  if (filter.unitTypes?.length) {
    const uType = (unit.unitType ?? '').toLowerCase();
    if (!filter.unitTypes.some((t) => uType.includes(t.toLowerCase()))) return false;
  }
  if (filter.unitNamePattern) {
    if (!new RegExp(filter.unitNamePattern, 'i').test(unit.unitName)) return false;
  }
  if (filter.unitClassPattern) {
    if (!new RegExp(filter.unitClassPattern, 'i').test(unit.unitClass)) return false;
  }
  return true;
}

/** 计算 Wilson 95% 置信区间（DOT&E 推荐小样本二项比例置信区间） */
export function computeWilsonCi95(k: number, n: number): { lower: number; upper: number } {
  if (n <= 0) return { lower: 0, upper: 0 };
  const z = 1.959963984540054;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    lower: Math.max(0, Math.round((center - half) * 10000) / 10000),
    upper: Math.min(1, Math.round((center + half) * 10000) / 10000),
  };
}

/** 计算指定分位数 (q: 0~1) */
export function computeQuantile(values: number[], q = 0.5): number {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return 0;
  if (clean.length === 1) return clean[0];
  const idx = Math.min(clean.length - 1, Math.max(0, Math.ceil(clean.length * q) - 1));
  return clean[idx];
}

/** 分布统计：中位数、均值、P90、最小、最大与样本量 */
export function computeDistributionStats(values: number[]): {
  n: number;
  median: number;
  mean: number;
  p90: number;
  min: number;
  max: number;
} | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = clean.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
  const mean = clean.reduce((acc, v) => acc + v, 0) / n;
  const p90Idx = Math.min(n - 1, Math.ceil(n * 0.9) - 1);
  return {
    n,
    median: Math.round(median * 1000) / 1000,
    mean: Math.round(mean * 1000) / 1000,
    p90: Math.round(clean[p90Idx] * 1000) / 1000,
    min: Math.round(clean[0] * 1000) / 1000,
    max: Math.round(clean[n - 1] * 1000) / 1000,
  };
}

/** 按 WeaponID 归并 WeaponEndgame（消除双行 POINTDEF:FAILURE 重复计数） */
export function groupEndgamesByWeaponId(events: WeaponEndgameRecord[]): Map<string, WeaponEndgameRecord[]> {
  const byWeapon = new Map<string, WeaponEndgameRecord[]>();
  events.forEach((ev, idx) => {
    const key = ev.weaponId || `anon_${idx}`;
    const list = byWeapon.get(key) ?? [];
    list.push(ev);
    byWeapon.set(key, list);
  });
  return byWeapon;
}

/** 计算己方武器总发射数（分母强制涵盖 WeaponLost 途中失效弹，防 Ph/Pssk 虚高） */
export function computeTotalWeaponsFired(
  situation: SituationModel,
  targetSide?: string,
): { totalFired: number; firedEventCount: number; endgameUniqueCount: number; weaponLostCount: number } {
  const firedEvents = situation.weaponFiredEvents.filter(
    (w) => !targetSide || isSameSide(w.firerSide, targetSide),
  );
  const firedUniqueIds = new Set<string>();
  let firedRoundsFallback = 0;
  for (const w of firedEvents) {
    if (w.weaponId) firedUniqueIds.add(w.weaponId);
    else firedRoundsFallback += Math.max(1, w.rounds || 1);
  }
  const firedEventCount = firedUniqueIds.size + firedRoundsFallback;

  const endgames = situation.weaponEndgameEvents.filter(
    (e) => !targetSide || isSameSide(e.weaponSide, targetSide),
  );
  const endgameUniqueCount = groupEndgamesByWeaponId(endgames).size;

  const weaponLostCount = (situation.weaponLostEvents ?? [])
    .filter((l) => !targetSide || isSameSide(l.side, targetSide))
    .reduce((sum, l) => sum + (Number.isFinite(l.num) ? l.num : 0), 0);

  const totalFired = Math.max(firedEventCount, endgameUniqueCount + weaponLostCount);
  return { totalFired, firedEventCount, endgameUniqueCount, weaponLostCount };
}

/** 区间状态积分：计算状态切换序列在 [startSec, endSec] 内处于 true 态的累计时长 */
export function integrateBooleanStateDuration(
  transitions: Array<{ scenarioSeconds: number; state: boolean }>,
  startSec: number,
  endSec: number,
  initialState = false,
): number {
  if (endSec <= startSec) return 0;
  const sorted = [...transitions].sort((a, b) => a.scenarioSeconds - b.scenarioSeconds);
  let curState = initialState;
  let curTime = startSec;
  let activeDuration = 0;

  for (const tr of sorted) {
    const t = Math.max(startSec, Math.min(endSec, tr.scenarioSeconds));
    if (tr.scenarioSeconds <= startSec) {
      curState = tr.state;
      continue;
    }
    if (t > curTime && curState) {
      activeDuration += t - curTime;
    }
    curTime = t;
    curState = tr.state;
    if (tr.scenarioSeconds >= endSec) break;
  }
  if (endSec > curTime && curState) {
    activeDuration += endSec - curTime;
  }
  return Math.max(0, activeDuration);
}
