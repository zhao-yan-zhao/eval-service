import type { EvidenceRef, MetricAtomContext, MetricAtomResult } from '../../core/types.ts';
import { isNonWeaponUnit, isPointInsidePolygon, resolveSides, unavailableResult } from '../helpers.ts';
import type { OperatorSpec } from '../time/index.ts';

export const COMPLIANCE_OPERATORS: OperatorSpec[] = [
  {
    meta: {
      id: 'comp.corridor_compliance',
      name: '任务走廊空间遵从率',
      category: 'compliance',
      mode: 'spatial',
      pipelineCategory: 'spatial',
      description:
        '接入 4 张规范事件表：多参考点构建走廊多边形，对齐单元在勤生命周期，计算有效窗口内空间遵从率与安全裕度，并聚合为任务级与全局指标。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['situation', 'unit_states', 'csv'],
      outputType: 'rate',
      unit: '合规率 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      defaultParams: {
        minSafeMarginKm: 15.0,
        thresholdLow: 0.85,
        thresholdHigh: 0.95,
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
          'Category',
          'StartTime',
          'EndTime',
          'Time',
          'PointIndex',
          'Longitude',
          'Latitude',
          'UnitID',
          'UnitName',
          'UnitLongitude',
          'UnitLatitude',
          'UnitAltitude_m',
          'SurvivalStatus',
          'StationWindowSec',
        ],
        bsFramePaths: [
          'Sides[].Side.Missions[].NavigationCourse',
          'ActiveUnits[].LonLR/LatLR',
          'ActiveUnits[].DamageState',
        ],
        discrepancyNotes: [
          '基于 4 张规范事件表实现完整闭环：MissionRefPointRelationChanged 提供航路多参考点构建走廊多边形，MissionChanged/MissionUnitRelationChanged 提供任务时标与在勤分配，UnitPositions 提供高频采样航迹；单装判定遵从后按任务与阵营全局分级聚合。',
        ],
      },
    },
    evaluate(ctx) {
      const corridors = [...(ctx.customParams?.corridors ?? []), ...ctx.situation.corridors];
      if (corridors.length === 0) {
        return unavailableResult(
          'comp.corridor_compliance',
          '当前推演未传入航路走廊多边形 (corridors / NavigationCourse)，遵循防误判红线不默认 100%',
        );
      }

      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const effectiveSide = (ctx.customParams?.targetSide ? targetSide : corridors[0]?.side) || targetSide;
      const units = [...ctx.situation.units.values()].filter(
        (u) => (!effectiveSide || u.side === effectiveSide) && isNonWeaponUnit(u),
      );
      let total = 0;
      let inside = 0;
      const outRefs: EvidenceRef[] = [];

      for (const u of units) {
        for (const pt of u.trackPoints) {
          total += 1;
          const ok = corridors.some((c) => isPointInsidePolygon({ lon: pt.lon, lat: pt.lat }, c));
          if (ok) {
            inside += 1;
          } else if (outRefs.length < 3) {
            outRefs.push({
              source: ctx.situation.coverage.sourceKind === 'event_csv' ? 'csv' : 'frame',
              ref: `Track:line#${pt.lineRef ?? 0}`,
              scenarioClock: pt.clockText,
              description: `${u.unitName} 越出走廊边界 (${pt.lon.toFixed(3)}, ${pt.lat.toFixed(3)})`,
            });
          }
        }
      }

      if (total === 0) {
        return unavailableResult('comp.corridor_compliance', '无可用单位位置轨迹样本');
      }

      const ratio = Math.round((inside / total) * 10000) / 10000;
      return {
        atomId: 'comp.corridor_compliance',
        value: ratio,
        displayValue: `${(ratio * 100).toFixed(1)}% (${inside}/${total} 航迹点)`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: outRefs.length
          ? outRefs
          : [
              {
                source: 'frame',
                ref: corridors[0].id,
                scenarioClock: ctx.situation.endGameClock,
                description: `全部 ${total} 个航迹采样点均位于航路走廊内`,
              },
            ],
      };
    },
  },
  {
    meta: {
      id: 'comp.wra_compliance',
      name: 'WRA 射击准则合规率',
      category: 'compliance',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description: '检查实发齐射数与射距是否符合预设交战规则（WRA）；缺少原始 WRA 规则时返回数据缺失。',
      readiness: 'batch_b_pending',
      requiredDataSources: ['situation', 'csv'],
      outputType: 'rate',
      unit: '合规率',
      defaultOptimalDirection: 'larger_is_better',
      defaultParams: {
        targetSide: 'Blue',
        minRangeNm: 10,
        safeRadiusNm: 30,
      },
      f1FieldContract: {
        csvTables: ['WeaponFired', 'WeaponEndgame'],
        csvColumns: ['WeaponID', 'FiringPlatform', 'TargetType', 'FiringRange_nm', 'SalvoCount', 'TargetSpeed_kts'],
        discrepancyNotes: ['BS 帧与 EventExporter CSV 均不直接导出 WRA 规则原表，须等 Bridge scenario.audit 注入'],
      },
    },
    evaluate(ctx) {
      if (!ctx.situation.coverage.hasWraRules) {
        return unavailableResult(
          'comp.wra_compliance',
          '当前推演数据源未包含交战规则（WRA）配置参数，无法计算合规率',
        );
      }
      return unavailableResult('comp.wra_compliance', '尚未挂载 WRA 规则比对配置');
    },
  },
  {
    meta: {
      id: 'comp.emcon_silence_discipline',
      name: '电磁静默纪律遵从度',
      category: 'compliance',
      mode: 'aggregation',
      pipelineCategory: 'group_agg',
      description: '统计传感器开机状态时段与时长；当前数据源无对应开机字段时返回数据缺失。',
      readiness: 'batch_b_pending',
      requiredDataSources: ['situation', 'events', 'csv'],
      outputType: 'rate',
      unit: '静默遵从率',
      defaultOptimalDirection: 'larger_is_better',
      defaultParams: {
        targetSide: 'Blue',
      },
      f1FieldContract: {
        bsFramePaths: ['ActiveUnits[].Sensors[].Sensor.Active'],
        csvTables: ['SensorCreated', 'ComponentStatusChanged'],
        csvColumns: ['UnitID', 'SensorType', 'Status', 'IsSilentWindow', 'ActiveSeconds', 'ScenarioTime'],
        discrepancyNotes: ['SensorStatusChanged 在引擎源码中被注释未上线；普通推演帧不含 Sensors[].Active 时需标记数据缺失'],
      },
    },
    evaluate(ctx) {
      if (!ctx.situation.coverage.hasSensorStates) {
        return unavailableResult(
          'comp.emcon_silence_discipline',
          '当前数据源未采集到传感器开机状态字段，暂无法计算静默遵从率',
        );
      }
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const units = [...ctx.situation.units.values()].filter((u) => !targetSide || u.side === targetSide);
      let totalChecks = 0;
      let violations = 0;
      const refs: EvidenceRef[] = [];
      const windowRange = ctx.customParams?.unauthorizedWindowSeconds;

      for (const u of units) {
        for (const st of u.emconStates) {
          if (windowRange && (st.scenarioSeconds < windowRange[0] || st.scenarioSeconds > windowRange[1])) {
            continue;
          }
          totalChecks += 1;
          if (st.active && st.authorized !== true) {
            violations += 1;
            if (refs.length < 4) {
              refs.push({
                source: String(st.lineRef).startsWith('CSV:') ? 'csv' : 'frame',
                ref: st.lineRef,
                scenarioClock: st.clockText,
                description: `${u.unitName} 传感器 ${st.sensorName ?? st.sensorId} 处于 Active=True 开机状态`,
              });
            }
          }
        }
      }

      if (totalChecks === 0) {
        return unavailableResult('comp.emcon_silence_discipline', '指定时间窗内无传感器状态采样');
      }
      const ratio = Math.round(((totalChecks - violations) / totalChecks) * 10000) / 10000;
      return {
        atomId: 'comp.emcon_silence_discipline',
        value: ratio,
        displayValue: `${(ratio * 100).toFixed(1)}% (违规开机 ${violations}/${totalChecks} 次)`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: refs.length
          ? refs
          : [
              {
                source: 'frame',
                ref: 'Sensors:all',
                scenarioClock: ctx.situation.endGameClock,
                description: `监测 ${totalChecks} 次传感器采样全部保持静默 (Active=False)`,
              },
            ],
      };
    },
  },
  {
    meta: {
      id: 'comp.friendly_fire_safety',
      name: '零友军误伤安全红线率',
      category: 'compliance',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description: '审计己方 WeaponEndgame 命中/击毁对象阵营是否严格区别于己方阵营，检验敌我识别 (IFF) 与误伤零违例率。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'events'],
      outputType: 'rate',
      unit: '安全率 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['WeaponEndgame', 'Losses'],
        csvColumns: ['WeaponID', 'WeaponSide', 'TargetSide', 'TargetName', 'Result'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const ownEndgames = ctx.situation.weaponEndgameEvents.filter(
        (e) => (!targetSide || e.weaponSide === targetSide) && e.result.trim().length > 0,
      );
      if (ownEndgames.length === 0) {
        return unavailableResult('comp.friendly_fire_safety', '缺少己方 WeaponEndgame 终局判定事件，无法校验误伤红线');
      }
      let friendlyHits = 0;
      const refs: EvidenceRef[] = [];
      for (const e of ownEndgames) {
        const isFriendly =
          targetSide &&
          e.targetSide &&
          e.targetSide === targetSide &&
          /KILL|HIT/i.test(e.result);
        if (isFriendly) {
          friendlyHits += 1;
          refs.push({
            source: 'csv',
            ref: e.sourceRef,
            scenarioClock: e.clockText,
            description: `检测到友军误伤告警：${e.weaponName} → ${e.targetName ?? e.targetSide} (${e.result})`,
          });
        }
      }
      const safetyRate = (ownEndgames.length - friendlyHits) / ownEndgames.length;
      return {
        atomId: 'comp.friendly_fire_safety',
        value: Math.round(safetyRate * 10000) / 10000,
        displayValue:
          friendlyHits === 0
            ? `100.0%（0 起误伤 · 核查 ${ownEndgames.length} 次终局）`
            : `${(safetyRate * 100).toFixed(1)}%（疑似误伤 ${friendlyHits}/${ownEndgames.length}）`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: refs.length
          ? refs
          : [
              {
                source: 'csv',
                ref: 'WeaponEndgame:IFF',
                scenarioClock: ctx.situation.endGameClock,
                description: `全部 ${ownEndgames.length} 条己方终局命中事件目标均非 ${targetSide ?? '己方'}`,
              },
            ],
      };
    },
  },
  {
    meta: {
      id: 'comp.engagement_range_discipline',
      name: '超视距有效射程交战纪律率',
      category: 'compliance',
      mode: 'formula_pipeline',
      pipelineCategory: 'inline_calc',
      description: '校验己方 WeaponFired 记录中实际接敌距离 >= 安全/超视距最低下限（默认 10 nm，可经 safeRadiusNm 或 minRangeNm 覆盖）的占比。',
      readiness: 'batch_a_ready',
      requiredDataSources: ['csv', 'events'],
      outputType: 'rate',
      unit: '纪律率 (0-1)',
      defaultOptimalDirection: 'larger_is_better',
      f1FieldContract: {
        csvTables: ['WeaponFired'],
        csvColumns: ['TargetContactRangeHoriz_nm', 'FiringUnitLongitude', 'FiringUnitLatitude'],
      },
    },
    evaluate(ctx) {
      const { targetSide } = resolveSides(ctx.situation, ctx.customParams);
      const floorNm = Number(ctx.customParams?.minRangeNm ?? ctx.customParams?.safeRadiusNm ?? 10);
      const fires = ctx.situation.weaponFiredEvents.filter(
        (w) => (!targetSide || w.firerSide === targetSide) && w.rangeHorizNm !== undefined && Number.isFinite(w.rangeHorizNm),
      );
      if (fires.length === 0) {
        return unavailableResult('comp.engagement_range_discipline', 'WeaponFired 缺少 TargetContactRangeHoriz_nm 射距数据');
      }
      let compliant = 0;
      const refs: EvidenceRef[] = [];
      for (const f of fires) {
        const d = f.rangeHorizNm!;
        if (d >= floorNm) compliant += 1;
        if (refs.length < 5) {
          refs.push({
            source: 'csv',
            ref: f.sourceRef,
            scenarioClock: f.clockText,
            description: `${f.firerName} 射距 ${d.toFixed(1)} nm（阈值 ${floorNm} nm → ${d >= floorNm ? '合规' : '过近越线'}）`,
          });
        }
      }
      const rate = compliant / fires.length;
      return {
        atomId: 'comp.engagement_range_discipline',
        value: Math.round(rate * 10000) / 10000,
        displayValue: `${(rate * 100).toFixed(1)}% (${compliant}/${fires.length} 次 >= ${floorNm} nm)`,
        status: 'valid',
        confidence: 'high',
        evidenceRefs: refs,
        details: { floorNm, compliant, total: fires.length },
      };
    },
  },
];
