/**
 * 统一持续态势模型（SituationModel）构造与融合入口
 * 同一契约同时支撑：
 * 1) 事后评估（BS JSONL 回放 / EventExporter 双BOM CSV / 两者融合）
 * 2) 实时增量推演（在线帧流维护）
 */

import path from 'node:path';
import { parseCsvDirectoryToSituation } from '../adapters/csv-adapter.ts';
import {
  createEmptySituationModel,
  parseFramesJsonlFile,
  parseFramesJsonlText,
} from '../adapters/frame-adapter.ts';
import type {
  EvalPolygon,
  SituationModel,
  ThreatZone,
} from './types.ts';

export interface BuildSituationOptions {
  runId?: string;
  scenarioPath?: string;
  jsonlFile?: string;
  jsonlText?: string;
  csvDir?: string;
  targetTimelineId?: string;
  corridors?: EvalPolygon[];
  patrolAreas?: EvalPolygon[];
  threatZones?: ThreatZone[];
  unitPrices?: Record<string, number>;
  criteriaResults?: Record<string, boolean>;
}

export async function buildSituationModel(opts: BuildSituationOptions): Promise<SituationModel> {
  let model: SituationModel;
  const fallbackRunId = opts.runId ?? `run-${Date.now().toString(36)}`;

  if (opts.jsonlFile) {
    const res = await parseFramesJsonlFile(opts.jsonlFile, fallbackRunId);
    model = res.model;
  } else if (opts.jsonlText) {
    const res = parseFramesJsonlText(opts.jsonlText, fallbackRunId, opts.scenarioPath ?? '<inline>');
    model = res.model;
  } else if (opts.csvDir) {
    const res = parseCsvDirectoryToSituation(opts.csvDir, {
      runId: opts.runId,
      targetTimelineId: opts.targetTimelineId,
      scenarioPath: opts.scenarioPath ?? opts.csvDir,
    });
    model = res.model;
  } else {
    model = createEmptySituationModel(fallbackRunId, opts.scenarioPath ?? '<empty>');
  }

  // 若同时提供了帧 JSONL 与 CSV 目录，则将 CSV 的精准交战终局与战损/消耗合并进来（hybrid 模式）
  if ((opts.jsonlFile || opts.jsonlText) && opts.csvDir) {
    const csvRes = parseCsvDirectoryToSituation(opts.csvDir, {
      runId: model.runId,
      targetTimelineId: opts.targetTimelineId,
      scenarioPath: opts.scenarioPath ?? opts.csvDir,
    });
    const csvModel = csvRes.model;
    model.coverage.sourceKind = 'hybrid';
    model.timelineId = csvModel.timelineId ?? model.timelineId;
    model.scenarioName = csvModel.scenarioName ?? model.scenarioName;

    if (csvModel.weaponFiredEvents.length > 0 && model.weaponFiredEvents.length === 0) {
      model.weaponFiredEvents = csvModel.weaponFiredEvents;
      model.coverage.hasWeaponFired = true;
    }
    if (csvModel.weaponEndgameEvents.length > 0) {
      model.weaponEndgameEvents = csvModel.weaponEndgameEvents;
      model.coverage.hasWeaponEndgame = true;
      model.coverage.hasPointDefense = csvModel.coverage.hasPointDefense;
    }
    if (csvModel.expenditures.length > 0) {
      model.expenditures = csvModel.expenditures;
      model.coverage.hasExpenditures = true;
    }
    if (csvModel.losses.length > 0) {
      model.losses = csvModel.losses;
      model.coverage.hasLosses = true;
    }
    if (csvModel.damageAndHitEvents.length > 0 && model.damageAndHitEvents.length === 0) {
      model.damageAndHitEvents = csvModel.damageAndHitEvents;
      model.coverage.hasDamagedOrDestroyed = true;
    }
    model.monteCarloId = csvModel.monteCarloId ?? model.monteCarloId;
    model.monteCarloIteration = csvModel.monteCarloIteration ?? model.monteCarloIteration;
    if (csvModel.engagementCycleEvents?.length) {
      model.engagementCycleEvents = csvModel.engagementCycleEvents;
      model.coverage.hasEngagementCycle = true;
    }
    if (csvModel.firstSensorDetections?.length) {
      model.firstSensorDetections = csvModel.firstSensorDetections;
      model.coverage.hasFirstSensorRecord = true;
    }
    if (csvModel.componentStatusEvents?.length) {
      model.componentStatusEvents = csvModel.componentStatusEvents;
      model.coverage.hasComponentStatus = true;
    }
    if (csvModel.unitJamEvents?.length) {
      model.unitJamEvents = csvModel.unitJamEvents;
      model.coverage.hasEwJamming = true;
    }
    if (csvModel.commDevices?.length) {
      model.commDevices = csvModel.commDevices;
    }
    if (csvModel.commJamEvents?.length) {
      model.commJamEvents = csvModel.commJamEvents;
      model.coverage.hasCommJamming = true;
    }
    if (csvModel.dockingOpsEvents?.length) {
      model.dockingOpsEvents = csvModel.dockingOpsEvents;
      model.coverage.hasDockingOps = true;
    }
    if (csvModel.fuelTransferEvents?.length) {
      model.fuelTransferEvents = csvModel.fuelTransferEvents;
      model.coverage.hasFuelTransfer = true;
    }
    if (csvModel.missionMetas?.length) {
      model.missionMetas = csvModel.missionMetas;
      model.coverage.hasMissionMeta = true;
    }
    if (csvModel.weaponLostEvents?.length) {
      model.weaponLostEvents = csvModel.weaponLostEvents;
    }
    if (csvModel.airOpsEvents?.length) {
      model.airOpsEvents = csvModel.airOpsEvents;
    }
    for (const s of csvModel.sides) {
      if (!model.sides.includes(s)) model.sides.push(s);
    }
    model.coverage.warnings.push(...csvModel.coverage.warnings);
  }

  if (opts.corridors?.length) {
    model.corridors.push(...opts.corridors);
    model.coverage.hasPolygonsOrCorridors = true;
  }
  if (opts.patrolAreas?.length) {
    model.patrolAreas.push(...opts.patrolAreas);
    model.coverage.hasPolygonsOrCorridors = true;
  }
  if (opts.threatZones?.length) {
    model.threatZones.push(...opts.threatZones);
  }
  if (opts.unitPrices) {
    model.unitPrices = { ...(model.unitPrices ?? {}), ...opts.unitPrices };
  }
  if (opts.criteriaResults) {
    model.criteriaResults = opts.criteriaResults;
  }
  if (opts.scenarioPath && !model.scenarioPath) {
    model.scenarioPath = path.resolve(opts.scenarioPath);
  }

  return model;
}
