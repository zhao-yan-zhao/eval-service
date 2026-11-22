/**
 * 规则与空间合规域算子（保留核心空间算法：任务航路走廊空间遵从率）
 */

import type { EvidenceRef } from '../../core/types.ts';
import type { OperatorSpec } from '../helpers.ts';
import {
  isNonWeaponUnit,
  isPointInsidePolygon,
  isSameSide,
  resolveSides,
  unavailableResult,
} from '../helpers.ts';

export const ROE_AND_COST_OPERATORS: OperatorSpec[] = [
  // 1. roe.corridor_spatial_compliance
  {
    meta: {
      id: 'roe.corridor_spatial_compliance',
      name: '任务航路走廊空间遵从率',
      category: 'compliance',
      evalRole: 'MOP',
      domain: 'roe_cost',
      doctrineRef: 'Airspace Control Order (ACO) — Transit Corridor Compliance',
      mode: 'spatial',
      pipelineCategory: 'spatial',
      description:
        '接入 4 张规范事件表（MissionChanged / MissionRefPointRelationChanged / MissionUnitRelationChanged / UnitPositions）：构建任务走廊多边形并统计己方非武器单元航迹点位于走廊内的比例。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['situation', 'unit_states', 'csv'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      defaultParams: {
        minSafeMarginKm: 15.0,
      },
      f1FieldContract: {
        csvTables: [
          'MissionChanged',
          'MissionRefPointRelationChanged',
          'MissionUnitRelationChanged',
          'UnitPositions',
        ],
        csvColumns: [
          'MissionID',
          'MissionName',
          'Side',
          'Longitude',
          'Latitude',
          'UnitID',
          'UnitLongitude',
          'UnitLatitude',
        ],
      },
    },
    evaluate(ctx) {
      const corridors = [...(ctx.customParams?.corridors ?? []), ...ctx.situation.corridors];
      if (corridors.length === 0) {
        return unavailableResult(
          'roe.corridor_spatial_compliance',
          '当前推演未提供航路走廊多边形 (MissionRefPointRelationChanged / corridors)，遵循 Fail-Closed 不默认 100%',
        );
      }

      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const effectiveSide = (ctx.customParams?.targetSide ? targetSide : corridors[0]?.side) || targetSide;
      const units = [...ctx.situation.units.values()].filter(
        (u) => (!effectiveSide || isSameSide(u.side, effectiveSide)) && isNonWeaponUnit(u),
      );

      let total = 0;
      let inside = 0;
      const outRefs: EvidenceRef[] = [];

      for (const u of units) {
        for (const pt of u.trackPoints) {
          total += 1;
          const ok = corridors.some((c) => isPointInsidePolygon({ lon: pt.lon, lat: pt.lat }, c));
          if (ok) inside += 1;
          else if (outRefs.length < 5) {
            outRefs.push({
              source: ctx.situation.coverage.sourceKind === 'event_csv' ? 'csv' : 'frame',
              ref: `Track:line#${pt.lineRef ?? 0}`,
              scenarioClock: pt.clockText,
              description: `${u.unitName} 越出航路走廊 (${pt.lon.toFixed(3)}, ${pt.lat.toFixed(3)})`,
            });
          }
        }
      }

      if (total === 0) {
        return unavailableResult('roe.corridor_spatial_compliance', '无可用非武器单位航迹点样本');
      }

      const rate = Math.round((inside / total) * 10000) / 10000;
      return {
        atomId: 'roe.corridor_spatial_compliance',
        value: rate,
        displayValue: `${(rate * 100).toFixed(1)}% (${inside}/${total} 航迹点)`,
        status: 'valid',
        confidence: 'high',
        numerator: inside,
        denominator: total,
        sampleSize: total,
        evidenceRefs: outRefs.length
          ? outRefs
          : [
              {
                source: 'csv',
                ref: corridors[0].id,
                scenarioClock: ctx.situation.endGameClock,
                description: `全部 ${total} 个航迹采样点均位于任务航路走廊内`,
              },
            ],
        details: { inside, total, corridorCount: corridors.length },
      };
    },
  },
];
