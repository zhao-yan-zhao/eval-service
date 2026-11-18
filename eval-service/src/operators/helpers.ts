import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import distance from '@turf/distance';
import { point as turfPoint, polygon as turfPolygon } from '@turf/helpers';
import type {
  DamageAndHitEvent,
  EvalPolygon,
  GeoPoint,
  MetricAtomContext,
  MetricAtomResult,
  SituationModel,
  SituationUnit,
} from '../core/types.ts';

export const KM_PER_NM = 1.852;

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

function matchSide(paramSide: string | undefined, availableSides: string[]): string | undefined {
  if (!paramSide) return undefined;
  if (availableSides.includes(paramSide)) return paramSide;
  const lower = paramSide.toLowerCase();
  const ciMatch = availableSides.find((s) => s.toLowerCase() === lower);
  if (ciMatch) return ciMatch;
  return paramSide;
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
    enemySide = sides.find((s) => s !== targetSide);
  }
  return { targetSide, enemySide };
}

export function unavailableResult(
  atomId: string,
  reason: string,
): MetricAtomResult {
  return {
    atomId,
    value: null,
    displayValue: '无有效证据 (不可用)',
    status: 'unavailable',
    confidence: 'low',
    evidenceRefs: [],
    missingDataReason: reason,
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
