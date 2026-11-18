import type { EvidenceRef, MetricAtomContext, MetricAtomResult, SituationUnit } from '../../core/types.ts';
import {
  isNonWeaponUnit,
  isPointInsidePolygon,
  nearestTrackPoint,
  nmBetween,
  resolveSides,
  unavailableResult,
} from '../helpers.ts';
import type { OperatorSpec } from '../time/index.ts';

function stdDev(nums: number[]): number {
  if (nums.length <= 1) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((acc, v) => acc + (v - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

export const SITUATION_OPERATORS: OperatorSpec[] = [
  {
    meta: {
      id: 'sit.standoff_advantage',
      name: '防区外发射安全度',
      category: 'situation',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description:
        '基于 Turf.js WGS84 测地距计算己方发射时刻至目标或敌方警戒圈的最小距离与安全警戒半径比值（>1.0 表防区外发射）。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['situation', 'events', 'csv'],
      outputType: 'ratio',
      unit: '×警戒半径',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['WeaponFired', 'UnitPositions'],
        csvColumns: ['FiringUnitLongitude', 'FiringUnitLatitude', 'TargetContactLongitude', 'TargetContactLatitude', 'TargetContactRangeHoriz_nm'],
        bsFramePaths: ['ActiveUnits[].LonLR/LatLR', 'ThreatZones'],
      },
    },
    evaluate(ctx) {
      const { targetSide, enemySide } = resolveSides(ctx.situation, ctx.customParams);
      const safeRadiusNm = Number(
        ctx.customParams?.safeRadiusNm ?? ctx.situation.threatZones[0]?.radiusNm ?? 30,
      );
      const fires = ctx.situation.weaponFiredEvents.filter(
        (w) => !targetSide || w.firerSide === targetSide || w.firerSide === 'Unknown',
      );
      if (fires.length === 0) {
        return unavailableResult('sit.standoff_advantage', '无发射记录，无法评估发射阵位距离');
      }

      const enemyUnits: SituationUnit[] = [...ctx.situation.units.values()].filter(
        (u) => (!enemySide || u.side === enemySide) && isNonWeaponUnit(u) && u.trackPoints.length > 0,
      );

      const ratios: number[] = [];
      const refs: EvidenceRef[] = [];

      for (const f of fires) {
        let distNm: number | null = null;
        if (f.rangeHorizNm !== undefined && Number.isFinite(f.rangeHorizNm) && f.rangeHorizNm > 0) {
          distNm = f.rangeHorizNm;
        } else if (f.firerLon !== undefined && f.firerLat !== undefined) {
          if (f.targetLon !== undefined && f.targetLat !== undefined) {
            distNm = nmBetween({ lon: f.firerLon, lat: f.firerLat }, { lon: f.targetLon, lat: f.targetLat });
          } else if (enemyUnits.length > 0) {
            let minNm = Infinity;
            for (const eu of enemyUnits) {
              const ept = nearestTrackPoint(eu, f.scenarioSeconds);
              if (ept) minNm = Math.min(minNm, nmBetween({ lon: f.firerLon, lat: f.firerLat }, ept));
            }
            if (Number.isFinite(minNm)) distNm = minNm;
          }
        } else {
          const fu = ctx.situation.units.get(f.firerUnitId);
          const fpt = fu ? nearestTrackPoint(fu, f.scenarioSeconds) : null;
          if (fpt && enemyUnits.length > 0) {
            let minNm = Infinity;
            for (const eu of enemyUnits) {
              const ept = nearestTrackPoint(eu, f.scenarioSeconds);
              if (ept) minNm = Math.min(minNm, nmBetween(fpt, ept));
            }
            if (Number.isFinite(minNm)) distNm = minNm;
          }
        }

        if (distNm !== null && safeRadiusNm > 0) {
          const ratio = distNm / safeRadiusNm;
          ratios.push(ratio);
          if (refs.length < 4) {
            refs.push({
              source: f.sourceRef.startsWith('CSV:') ? 'csv' : 'frame',
              ref: f.sourceRef,
              scenarioClock: f.clockText,
              description: `${f.firerName} 发射距离 ${distNm.toFixed(1)} nm（安全阈值 ${safeRadiusNm} nm → ${ratio.toFixed(2)}×）`,
            });
          }
        }
      }

      if (ratios.length === 0) {
        return unavailableResult('sit.standoff_advantage', '发射记录与敌方单位均缺乏经纬度，无法求解测地距');
      }

      const avg = Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 1000) / 1000;
      const minRatio = Math.min(...ratios);
      return {
        atomId: 'sit.standoff_advantage',
        value: avg,
        displayValue: `${avg.toFixed(2)}×（最低 ${minRatio.toFixed(2)}× 安全半径 ${safeRadiusNm}nm）`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: refs,
        details: { safeRadiusNm, sampleCount: ratios.length, minRatio },
      };
    },
  },
  {
    meta: {
      id: 'sit.formation_dispersion',
      name: '编队航行离散度',
      category: 'situation',
      mode: 'aggregation',
      pipelineCategory: 'group_agg',
      description: '利用 Turf.js 测地距计算己方作战单元两两间距的标准差与期望间距（默认 5nm）比值，监控无人群散群与聚集。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['situation', 'unit_states'],
      outputType: 'ratio',
      unit: '离散比',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['UnitPositions', 'UnitCreated'],
        csvColumns: ['UnitID', 'UnitSide', 'UnitLongitude', 'UnitLatitude'],
        bsFramePaths: ['ActiveUnits[].LonLR/LatLR'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const expectedSpacingNm = Number(ctx.customParams?.expectedSpacingNm ?? 5);
      const units = [...ctx.situation.units.values()].filter(
        (u) => (!targetSide || u.side === targetSide) && isNonWeaponUnit(u) && !u.isDestroyed && u.trackPoints.length > 0,
      );

      if (units.length < 2) {
        return unavailableResult('sit.formation_dispersion', `至少需要 2 个含轨迹的${targetSide ?? '己方'}非弹药单元，当前仅 ${units.length} 个`);
      }

      const sampleSec = ctx.situation.totalGameSeconds / 2;
      const pts = units.map((u) => ({ unit: u, pt: nearestTrackPoint(u, sampleSec)! })).filter((x) => x.pt);
      const pairDists: number[] = [];
      for (let i = 0; i < pts.length; i += 1) {
        for (let j = i + 1; j < pts.length; j += 1) {
          pairDists.push(nmBetween(pts[i].pt, pts[j].pt));
        }
      }
      const sd = stdDev(pairDists);
      const ratio = expectedSpacingNm > 0 ? Math.round((sd / expectedSpacingNm) * 1000) / 1000 : sd;
      return {
        atomId: 'sit.formation_dispersion',
        value: ratio,
        displayValue: `${ratio.toFixed(2)}（距标准差 ${sd.toFixed(2)} nm）`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [
          {
            source: ctx.situation.coverage.sourceKind === 'event_csv' ? 'csv' : 'frame',
            ref: 'UnitPositions:mid',
            scenarioClock: ctx.situation.endGameClock,
            description: `采样 ${pts.length} 个作战单元 ${pairDists.length} 组两两间距，均值 ${(pairDists.reduce((a, b) => a + b, 0) / pairDists.length).toFixed(2)} nm`,
          },
        ],
        details: { pairCount: pairDists.length, stdDevNm: sd, expectedSpacingNm },
      };
    },
  },
  {
    meta: {
      id: 'sit.geometry_arrival_delta',
      name: '多路突击交会时间差',
      category: 'situation',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description: '统计不同突击平台到达攻击触发线（或各自首轮火力到达目标区间）的最大时间差（秒），评估多路协同饱和能力。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['events', 'situation'],
      outputType: 'duration_seconds',
      unit: '秒',
      defaultOptimalDirection: 'smaller_is_better',
      f1FieldContract: {
        csvTables: ['WeaponFired', 'UnitPositions'],
        bsFramePaths: ['ActiveUnits[]', 'bs-diff:weapon_fired'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const firstHitPerUnit = new Map<string, { sec: number; clock: string; name: string; ref: string }>();

      // 若显式设置经度到达分界线则测轨迹穿越时间，否则按多发射单元首发射击时间戳
      const lineLon = ctx.customParams?.arrivalLineLon;
      if (typeof lineLon === 'number' && Number.isFinite(lineLon)) {
        for (const u of ctx.situation.units.values()) {
          if ((targetSide && u.side !== targetSide) || !isNonWeaponUnit(u)) continue;
          const cross = u.trackPoints.find((p) => p.lon >= lineLon);
          if (cross) {
            firstHitPerUnit.set(u.unitId, {
              sec: cross.scenarioSeconds,
              clock: cross.clockText,
              name: u.unitName,
              ref: `Track:line#${cross.lineRef ?? 1}`,
            });
          }
        }
      } else {
        for (const f of ctx.situation.weaponFiredEvents) {
          if (targetSide && f.firerSide !== targetSide) continue;
          const cur = firstHitPerUnit.get(f.firerUnitId);
          if (!cur || f.scenarioSeconds < cur.sec) {
            firstHitPerUnit.set(f.firerUnitId, {
              sec: f.scenarioSeconds,
              clock: f.clockText,
              name: f.firerName,
              ref: f.sourceRef,
            });
          }
        }
      }

      const arr = [...firstHitPerUnit.values()].sort((a, b) => a.sec - b.sec);
      if (arr.length < 2) {
        return unavailableResult('sit.geometry_arrival_delta', '需要至少 2 个独立突击单元的同步到达/交火时间点');
      }

      const delta = Math.round((arr[arr.length - 1].sec - arr[0].sec) * 100) / 100;
      return {
        atomId: 'sit.geometry_arrival_delta',
        value: delta,
        displayValue: `${delta.toFixed(1)} 秒（${arr.length} 路协同）`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [
          {
            source: 'event',
            ref: arr[0].ref,
            scenarioClock: arr[0].clock,
            description: `最早到达/开火: ${arr[0].name}`,
          },
          {
            source: 'event',
            ref: arr[arr.length - 1].ref,
            scenarioClock: arr[arr.length - 1].clock,
            description: `最晚到达/开火: ${arr[arr.length - 1].name}`,
          },
        ],
      };
    },
  },
  {
    meta: {
      id: 'sit.area_coverage_ratio',
      name: '任务海空域扫描率',
      category: 'situation',
      mode: 'spatial',
      pipelineCategory: 'spatial',
      description: '结合任务区边界多边形与各平台传感器扫描轨迹，计算任务区综合覆盖比例；缺少边界或轨迹数据时返回数据缺失。',
      readiness: 'batch_b_pending',
      requiredDataSources: ['situation', 'db3k'],
      outputType: 'rate',
      unit: '比例 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['MissionRefPointRelationChanged', 'SensorClassUsed', 'UnitPositions'],
        bsFramePaths: ['Sides[].Side.Missions[]', 'ActiveUnits[].Sensors[].Sensor.RangeMax'],
        discrepancyNotes: ['仅当同时存在任务区多边形与传感包络/轨迹时有效，否则严格返回 unavailable'],
      },
    },
    evaluate(ctx) {
      const areas = [...(ctx.customParams?.patrolAreas ?? []), ...ctx.situation.patrolAreas];
      if (areas.length === 0 || !ctx.situation.coverage.hasPositionTracks) {
        return unavailableResult(
          'sit.area_coverage_ratio',
          '缺少任务区多边形定义 (MissionRefPointRelationChanged / PatrolArea) 或有效单位航迹',
        );
      }

      const poly = areas[0];
      const lons = poly.points.map((p) => p.lon);
      const lats = poly.points.map((p) => p.lat);
      const minLon = Math.min(...lons);
      const maxLon = Math.max(...lons);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);

      const radiusNm = ctx.situation.sensorCoverageBaseline?.[0]?.sensorMaxRangeNm ?? 20;
      const units = [...ctx.situation.units.values()].filter((u) => isNonWeaponUnit(u));
      const allPts = units.flatMap((u) => u.trackPoints);

      let insideGrid = 0;
      let coveredGrid = 0;
      const steps = 12;
      for (let ix = 0; ix < steps; ix += 1) {
        for (let iy = 0; iy < steps; iy += 1) {
          const gp = {
            lon: minLon + ((maxLon - minLon) * (ix + 0.5)) / steps,
            lat: minLat + ((maxLat - minLat) * (iy + 0.5)) / steps,
          };
          if (!isPointInsidePolygon(gp, poly)) continue;
          insideGrid += 1;
          if (allPts.some((tp) => nmBetween(gp, tp) <= radiusNm)) {
            coveredGrid += 1;
          }
        }
      }

      if (insideGrid === 0) {
        return unavailableResult('sit.area_coverage_ratio', '任务区多边形面积退化，无有效内部网格');
      }
      const ratio = Math.round((coveredGrid / insideGrid) * 10000) / 10000;
      return {
        atomId: 'sit.area_coverage_ratio',
        value: ratio,
        displayValue: `${(ratio * 100).toFixed(1)}% (${coveredGrid}/${insideGrid} 栅格)`,
        status: ctx.situation.sensorCoverageBaseline?.length ? 'valid' : 'degraded',
        confidence: ctx.situation.sensorCoverageBaseline?.length ? 'high' : 'medium',
        evidenceRefs: [
          {
            source: 'frame',
            ref: poly.id,
            scenarioClock: ctx.situation.endGameClock,
            description: `基于 Turf.js 栅格扫掠评估区域 ${poly.name ?? poly.id}（假设半径 ${radiusNm} nm）`,
          },
        ],
      };
    },
  },
  {
    meta: {
      id: 'sit.kinematic_speed_avg',
      name: '作战平台平均巡航航速',
      category: 'situation',
      mode: 'aggregation',
      pipelineCategory: 'group_agg',
      description: '遍历己方非武器作战单元运动轨迹采样点（UnitPositions.UnitSpeed_kts / ActiveUnits.CS），计算全域平均与峰值航速（节）。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['situation', 'unit_states', 'csv'],
      outputType: 'count',
      unit: 'kts',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['UnitPositions'],
        csvColumns: ['UnitID', 'UnitSide', 'UnitSpeed_kts'],
        bsFramePaths: ['ActiveUnits[].CS', 'ActiveUnits[].CurrentSpeed'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const units = [...ctx.situation.units.values()].filter(
        (u) => (!targetSide || u.side === targetSide) && isNonWeaponUnit(u),
      );
      const speeds: number[] = [];
      let maxSpd = 0;
      let maxUnit = '';
      for (const u of units) {
        for (const pt of u.trackPoints) {
          if (pt.speedKts !== undefined && Number.isFinite(pt.speedKts)) {
            speeds.push(pt.speedKts);
            if (pt.speedKts > maxSpd) {
              maxSpd = pt.speedKts;
              maxUnit = u.unitName;
            }
          }
        }
      }
      if (speeds.length === 0) {
        return unavailableResult('sit.kinematic_speed_avg', '航迹点缺少速度字段 (UnitSpeed_kts / CS)，无法核算巡航航速');
      }
      const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      return {
        atomId: 'sit.kinematic_speed_avg',
        value: Math.round(avg * 100) / 100,
        displayValue: `${avg.toFixed(1)} kts（峰值 ${maxSpd.toFixed(1)} kts · ${speeds.length} 采样）`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [
          {
            source: ctx.situation.coverage.sourceKind === 'event_csv' ? 'csv' : 'frame',
            ref: 'UnitPositions:Speed',
            scenarioClock: ctx.situation.endGameClock,
            description: `${units.length} 个平台 ${speeds.length} 次采样均值 ${avg.toFixed(1)} kts（最高 ${maxUnit}）`,
          },
        ],
        details: { minKts: Math.min(...speeds), maxKts: maxSpd, sampleCount: speeds.length },
      };
    },
  },
  {
    meta: {
      id: 'sit.altitude_envelope_advantage',
      name: '红蓝空域高度势能优势',
      category: 'situation',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description: '比较己方与敌方非武器单元平均飞行高度（UnitAltitude_m / CA），正值表示具备高空位势优势（米）。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['situation', 'unit_states', 'csv'],
      outputType: 'count',
      unit: 'm',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['UnitPositions'],
        csvColumns: ['UnitID', 'UnitSide', 'UnitAltitude_m'],
        bsFramePaths: ['ActiveUnits[].CA', 'ActiveUnits[].CurrentAltitude'],
      },
    },
    evaluate(ctx) {
      const { targetSide, enemySide } = resolveSides(ctx.situation, ctx.customParams);
      if (!targetSide || !enemySide) {
        return unavailableResult('sit.altitude_envelope_advantage', '缺少红蓝双边标识，无法对比高度势能差');
      }
      const meanAlt = (side: string) => {
        const vals: number[] = [];
        for (const u of ctx.situation.units.values()) {
          if (u.side !== side || !isNonWeaponUnit(u)) continue;
          for (const pt of u.trackPoints) {
            if (pt.altitudeM !== undefined && Number.isFinite(pt.altitudeM)) vals.push(pt.altitudeM);
          }
        }
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      };
      const ownAlt = meanAlt(targetSide);
      const enemyAlt = meanAlt(enemySide);
      if (ownAlt === null || enemyAlt === null) {
        return unavailableResult('sit.altitude_envelope_advantage', '己方或敌方缺乏高度采样字段 (UnitAltitude_m / CA)');
      }
      const delta = ownAlt - enemyAlt;
      return {
        atomId: 'sit.altitude_envelope_advantage',
        value: Math.round(delta * 10) / 10,
        displayValue: `${delta >= 0 ? '+' : ''}${delta.toFixed(0)} m（己方 ${ownAlt.toFixed(0)}m vs 敌 ${enemyAlt.toFixed(0)}m）`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [
          {
            source: ctx.situation.coverage.sourceKind === 'event_csv' ? 'csv' : 'frame',
            ref: 'UnitPositions:Altitude',
            scenarioClock: ctx.situation.endGameClock,
            description: `${targetSide} 均高 ${ownAlt.toFixed(0)} m，${enemySide} 均高 ${enemyAlt.toFixed(0)} m`,
          },
        ],
        details: { ownAvgAltM: ownAlt, enemyAvgAltM: enemyAlt },
      };
    },
  },
  {
    meta: {
      id: 'sit.centroid_separation_nm',
      name: '红蓝兵力几何质心间距',
      category: 'situation',
      mode: 'spatial',
      pipelineCategory: 'spatial',
      description: '基于 Turf.js WGS84 测地距计算推演终末/中段红蓝双方现存兵力几何质心间的海里距离，反映前沿交锋接敌态势。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['situation', 'unit_states'],
      outputType: 'ratio',
      unit: 'nm',
      defaultOptimalDirection: 'range_bounded',
      f1FieldContract: {
        csvTables: ['UnitPositions'],
        bsFramePaths: ['ActiveUnits[].LonLR/LatLR'],
      },
    },
    evaluate(ctx) {
      const { targetSide, enemySide } = resolveSides(ctx.situation, ctx.customParams);
      if (!targetSide || !enemySide) {
        return unavailableResult('sit.centroid_separation_nm', '缺少红蓝双边阵营，无法解算兵力质心距');
      }
      const centroidAt = (side: string, tSec: number) => {
        const pts = [...ctx.situation.units.values()]
          .filter((u) => u.side === side && isNonWeaponUnit(u) && u.trackPoints.length > 0)
          .map((u) => nearestTrackPoint(u, tSec))
          .filter((p): p is NonNullable<typeof p> => p !== null);
        if (pts.length === 0) return null;
        return {
          lon: pts.reduce((a, p) => a + p.lon, 0) / pts.length,
          lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length,
          count: pts.length,
        };
      };
      const tEnd = ctx.situation.totalGameSeconds;
      const cOwn = centroidAt(targetSide, tEnd);
      const cEnemy = centroidAt(enemySide, tEnd);
      if (!cOwn || !cEnemy) {
        return unavailableResult('sit.centroid_separation_nm', '红蓝双方缺少空间轨迹坐标，无法求取质心');
      }
      const distNm = nmBetween(cOwn, cEnemy);
      const cOwnStart = centroidAt(targetSide, 0);
      const cEnemyStart = centroidAt(enemySide, 0);
      const initDistNm = cOwnStart && cEnemyStart ? nmBetween(cOwnStart, cEnemyStart) : distNm;
      return {
        atomId: 'sit.centroid_separation_nm',
        value: Math.round(distNm * 100) / 100,
        displayValue: `${distNm.toFixed(1)} nm（初距 ${initDistNm.toFixed(1)} nm）`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [
          {
            source: 'frame',
            ref: 'Centroid:End',
            scenarioClock: ctx.situation.endGameClock,
            description: `${targetSide}(${cOwn.count}单元) 质心 (${cOwn.lon.toFixed(2)}, ${cOwn.lat.toFixed(2)}) ↔ ${enemySide}(${cEnemy.count}单元)`,
          },
        ],
        details: { endDistanceNm: distNm, startDistanceNm: initDistNm },
      };
    },
  },
  {
    meta: {
      id: 'sit.hull_containment_area',
      name: '己方编队凸包控制空域面积',
      category: 'situation',
      mode: 'spatial',
      pipelineCategory: 'spatial',
      description: '利用 Andrew 单调链求解己方活跃平台末端经纬度二维凸包，并按球面投影测算覆盖空域面积（km²），衡量分散/展开控制能力。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['situation', 'unit_states'],
      outputType: 'count',
      unit: 'km²',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['UnitPositions'],
        bsFramePaths: ['ActiveUnits[].LonLR/LatLR'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const pts = [...ctx.situation.units.values()]
        .filter((u) => (!targetSide || u.side === targetSide) && isNonWeaponUnit(u) && u.trackPoints.length > 0)
        .map((u) => nearestTrackPoint(u, ctx.situation.totalGameSeconds))
        .filter((p): p is NonNullable<typeof p> => p !== null);

      if (pts.length < 3) {
        if (pts.length === 2) {
          const spanKm = nmBetween(pts[0], pts[1]) * 1.852;
          return {
            atomId: 'sit.hull_containment_area',
            value: 0,
            displayValue: `0.0 km²（仅 2 个单元，连线宽 ${spanKm.toFixed(1)} km）`,
            status: 'degraded',
            confidence: 'medium',
            evidenceRefs: [],
            details: { unitCount: 2, spanKm },
          };
        }
        return unavailableResult('sit.hull_containment_area', `构成多边形至少需要 3 个己方定位单元，当前仅 ${pts.length} 个`);
      }

      // 将经纬度映射为围绕质心的局部等距平面千米坐标，求取凸包面积
      const lat0 = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
      const lon0 = pts.reduce((a, p) => a + p.lon, 0) / pts.length;
      const kmPerLat = 111.32;
      const kmPerLon = 111.32 * Math.cos((lat0 * Math.PI) / 180);
      const xy = pts
        .map((p) => ({ x: (p.lon - lon0) * kmPerLon, y: (p.lat - lat0) * kmPerLat }))
        .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));

      const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

      const lower: typeof xy = [];
      for (const p of xy) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
      }
      const upper: typeof xy = [];
      for (let i = xy.length - 1; i >= 0; i -= 1) {
        const p = xy[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
      }
      const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
      let area = 0;
      for (let i = 0; i < hull.length; i += 1) {
        const j = (i + 1) % hull.length;
        area += hull[i].x * hull[j].y - hull[j].x * hull[i].y;
      }
      const areaKm2 = Math.abs(area) / 2;
      return {
        atomId: 'sit.hull_containment_area',
        value: Math.round(areaKm2 * 100) / 100,
        displayValue: `${areaKm2.toFixed(1)} km²（${pts.length} 单元 · ${hull.length} 凸包顶点）`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: [
          {
            source: 'frame',
            ref: 'ConvexHull',
            scenarioClock: ctx.situation.endGameClock,
            description: `围绕质心 (${lon0.toFixed(2)}, ${lat0.toFixed(2)}) 形成 ${hull.length} 顶点凸包空域`,
          },
        ],
        details: { unitCount: pts.length, hullVertices: hull.length },
      };
    },
  },
];
