/**
 * BS MQTT / JSONL 帧流适配器
 * - 复用仓库既有 demo-ui/proxy/bs-diff.mjs 的差分与防御性解析能力（避免重复实现事件卡生成与容器缺失防护）
 * - 增强兼容 sim-output-fields/02-bs-mqtt-frames-and-topics.md 中的全部真机 Q-077 编码陷阱：
 *   1) 单键包装 unwrapEntity ({"Ship":...}, {"Side":...}, {"Contact":...})
 *   2) 全标量字符串编码 ("CH", "CS", "CA", "Count", "SIK")
 *   3) SideID -> SideName 映射反查
 *   4) Scenario.Time .NET Ticks 与 ISO-8601 双支持
 *   5) 传感器 Active/RangeMax、Mounts/Magazines 余弹与任务区/参考点多边形解析
 */

import fs from 'node:fs';
import readline from 'node:readline';
// 直接复用现有经过多轮鉴定的纯差分实现
// @ts-expect-error demo-ui/proxy/bs-diff.mjs 为无类型标注 ESM 模块
import { diffFrames, resetEventIdSeq, unwrapRecord, scenarioOf } from '../../../demo-ui/proxy/bs-diff.mjs';
import { formatSecondsToClock, parseF1Time } from '../core/time-utils.ts';
import type {
  EvalPolygon,
  GeoPoint,
  SituationContact,
  SituationModel,
  SituationUnit,
  StructuredSimEvent,
} from '../core/types.ts';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function unwrapEntity<T = Record<string, unknown>>(obj: unknown): T | null {
  if (!isPlainObject(obj)) return null;
  const keys = Object.keys(obj);
  if (keys.length === 1 && isPlainObject(obj[keys[0]])) {
    return obj[keys[0]] as T;
  }
  return obj as T;
}

function entityWrapperType(obj: unknown): string | undefined {
  if (!isPlainObject(obj)) return undefined;
  const keys = Object.keys(obj);
  if (keys.length === 1 && isPlainObject(obj[keys[0]])) return keys[0];
  return undefined;
}

function pickStr(obj: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const val = obj[k];
    if (typeof val === 'string' && val.trim() !== '') return val.trim();
  }
  return undefined;
}

function pickNum(obj: Record<string, unknown> | null, keys: string[]): number | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const val = obj[k];
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string' && val.trim() !== '') {
      const n = Number(val);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function normalizeGuid(id: string | undefined): string {
  return (id ?? '').trim().toLowerCase();
}

function extractAmmoRemaining(unit: Record<string, unknown>): number | null {
  // 兼容演示样本 Weapons: [{ Name, Count }] 与真机 Q-077 Mounts[].Mount.MW[].WRec
  let sum = 0;
  let found = false;

  const containers = [unit.Weapons, unit.Mounts, unit.Launchers, unit.Magazines];
  for (const c of containers) {
    if (!Array.isArray(c)) continue;
    for (const rawItem of c) {
      const item = unwrapEntity(rawItem);
      if (!item) continue;
      // 直接带数量字段
      const directCount = pickNum(item, [
        'Count', 'count', 'Quantity', 'quantity', 'Rounds', 'rounds',
        'CurrentLoad', 'DefaultLoad', 'Remaining', 'remaining',
      ]);
      if (directCount !== undefined) {
        sum += directCount;
        found = true;
      }
      // 嵌套 Weapons 数组
      if (Array.isArray(item.Weapons)) {
        for (const subRaw of item.Weapons) {
          const sub = unwrapEntity(subRaw);
          const n = pickNum(sub, ['Count', 'count', 'CurrentLoad', 'DefaultLoad', 'Quantity']);
          if (n !== undefined) {
            sum += n;
            found = true;
          }
        }
      }
      // 真机 MW / MMW 挂架记录
      for (const mwKey of ['MW', 'MMW']) {
        const mwArr = item[mwKey];
        if (!Array.isArray(mwArr)) continue;
        for (const recWrap of mwArr) {
          const rec = unwrapEntity(recWrap);
          const n = pickNum(rec, ['CurrentLoad', 'DefaultLoad', 'Count', 'Quantity', 'CL']);
          if (n !== undefined) {
            sum += n;
            found = true;
          }
        }
      }
    }
  }
  return found ? sum : null;
}

function extractPoints(rawArea: unknown, rpMap: Map<string, GeoPoint>): GeoPoint[] {
  if (!Array.isArray(rawArea)) return [];
  const pts: GeoPoint[] = [];
  for (const entry of rawArea) {
    const obj = unwrapEntity(entry);
    if (!obj) continue;
    const directLon = pickNum(obj, ['Lon', 'Longitude', 'LonLR']);
    const directLat = pickNum(obj, ['Lat', 'Latitude', 'LatLR']);
    if (directLon !== undefined && directLat !== undefined) {
      pts.push({ lon: directLon, lat: directLat });
      continue;
    }
    const rpObj = isPlainObject(obj.RPoint) ? (obj.RPoint as Record<string, unknown>) : obj;
    const rpLon = pickNum(rpObj, ['Lon', 'Longitude']);
    const rpLat = pickNum(rpObj, ['Lat', 'Latitude']);
    if (rpLon !== undefined && rpLat !== undefined) {
      pts.push({ lon: rpLon, lat: rpLat });
      continue;
    }
    const rpId = pickStr(rpObj, ['ID', 'Id', 'ObjectID']);
    if (rpId && rpMap.has(normalizeGuid(rpId))) {
      pts.push(rpMap.get(normalizeGuid(rpId))!);
    }
  }
  return pts;
}

function mapDiffKind(kind: string): StructuredSimEvent['kind'] {
  const validKinds: Set<string> = new Set([
    'unit_new',
    'unit_destroyed',
    'unit_damaged',
    'weapon_fired',
    'weapon_endgame',
    'weapon_impact',
    'unit_maneuver',
    'detection_new',
    'detection_lost',
    'engine_event',
    'playback_state',
    'parse_error',
  ]);
  return validKinds.has(kind) ? (kind as StructuredSimEvent['kind']) : 'engine_event';
}

export interface FrameIngestionState {
  model: SituationModel;
  prevRecord: Record<string, unknown> | null;
  baseEpochMs: number | null;
  frameCount: number;
  maxSeconds: number;
}

export function createEmptySituationModel(
  runId: string,
  scenarioPath: string,
  sourceKind: 'bs_jsonl' | 'event_csv' | 'hybrid' = 'bs_jsonl',
): SituationModel {
  return {
    runId,
    scenarioPath,
    startGameClock: '00:00:00',
    endGameClock: '00:00:00',
    totalGameSeconds: 0,
    sides: [],
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
      sourceKind,
      hasPositionTracks: false,
      hasContacts: false,
      hasWeaponFired: false,
      hasWeaponEndgame: false,
      hasPointDefense: false,
      hasDamagedOrDestroyed: false,
      hasSensorStates: false,
      hasWraRules: false,
      hasPolygonsOrCorridors: false,
      hasExpenditures: false,
      hasLosses: false,
      warnings: [],
    },
  };
}

export function initFrameIngestion(runId: string, scenarioPath: string): FrameIngestionState {
  resetEventIdSeq(runId.slice(0, 8) || 'eval');
  return {
    model: createEmptySituationModel(runId, scenarioPath, 'bs_jsonl'),
    prevRecord: null,
    baseEpochMs: null,
    frameCount: 0,
    maxSeconds: 0,
  };
}

export function ingestFrameLine(
  state: FrameIngestionState,
  rawLine: string,
  lineNo: number,
  options?: { trackAllSamples?: boolean },
): StructuredSimEvent[] {
  const trimmed = rawLine.replace(/^\uFEFF+/g, '').trim();
  if (!trimmed) return [];

  const model = state.model;
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(trimmed) as Record<string, unknown>;
  } catch (err) {
    const parseErr: StructuredSimEvent = {
      eventId: `evt-parse-${lineNo}`,
      scenarioSeconds: state.maxSeconds,
      clockText: formatSecondsToClock(state.maxSeconds),
      side: null,
      kind: 'parse_error',
      subject: `line ${lineNo}`,
      object: null,
      severity: 'major',
      detail: { message: err instanceof Error ? err.message : String(err), lineNo },
      source: 'diff',
      ref: `Frame:line#${lineNo}`,
    };
    model.events.push(parseErr);
    return [parseErr];
  }

  state.frameCount += 1;
  const unwrapped = unwrapRecord(record);
  const scenario = scenarioOf(unwrapped.frame) as Record<string, unknown> | null;
  if (!scenario) return [];

  // 1) 场景时钟换算（优先 scenario.Time，其次 outer scenarioTime）
  const rawTime = pickStr(scenario, ['Time']) ?? unwrapped.scenarioTime ?? undefined;
  const parsedTime = parseF1Time(rawTime);
  let scenarioSeconds = state.maxSeconds;
  let clockText = formatSecondsToClock(scenarioSeconds);
  if (parsedTime) {
    if (parsedTime.kind === 'epoch_ms' && parsedTime.epochMs !== undefined) {
      if (state.baseEpochMs === null) {
        state.baseEpochMs = parsedTime.epochMs;
        model.startGameClock = parsedTime.clockText;
      }
      scenarioSeconds = Math.max(0, (parsedTime.epochMs - state.baseEpochMs) / 1000);
      clockText = parsedTime.clockText;
    } else if (parsedTime.relativeSeconds !== undefined) {
      scenarioSeconds = parsedTime.relativeSeconds;
      clockText = parsedTime.clockText;
    }
  }
  state.maxSeconds = Math.max(state.maxSeconds, scenarioSeconds);
  model.totalGameSeconds = state.maxSeconds;
  model.endGameClock = clockText;
  if (state.frameCount === 1 && model.startGameClock === '00:00:00') {
    model.startGameClock = clockText;
  }

  // 2) 建立 SideID -> SideName 映射表 + 提取参考点 / 任务区 / Contacts
  const sideIdToName = new Map<string, string>();
  const rpMap = new Map<string, GeoPoint>();

  if (Array.isArray(scenario.Sides)) {
    for (const rawSideItem of scenario.Sides) {
      const sideObj = unwrapEntity(rawSideItem);
      if (!sideObj) continue;
      const sName = pickStr(sideObj, ['Name', 'SideName']) ?? 'Unknown';
      const sId = pickStr(sideObj, ['ID', 'Id', 'ObjectID']);
      if (sId) sideIdToName.set(normalizeGuid(sId), sName);
      if (sName !== 'Unknown' && !model.sides.includes(sName)) {
        model.sides.push(sName);
      }

      // 参考点缓存供 Mission 区域索引
      if (Array.isArray(sideObj.ReferencePoints)) {
        for (const rawRp of sideObj.ReferencePoints) {
          const rp = unwrapEntity(rawRp);
          const rpId = pickStr(rp, ['ID', 'Id', 'ObjectID']);
          const lon = pickNum(rp, ['Lon', 'Longitude', 'LonLR']);
          const lat = pickNum(rp, ['Lat', 'Latitude', 'LatLR']);
          if (rpId && lon !== undefined && lat !== undefined) {
            rpMap.set(normalizeGuid(rpId), { lon, lat });
          }
        }
      }

      // 首次见到任务多边形则记录为巡逻/任务走廊备选
      if (state.frameCount === 1 && Array.isArray(sideObj.Missions)) {
        for (const rawMission of sideObj.Missions) {
          const m = unwrapEntity(rawMission);
          if (!m) continue;
          const mId = pickStr(m, ['ID', 'ObjectID']) ?? `mission-${model.patrolAreas.length + 1}`;
          const mName = pickStr(m, ['Name', 'MissionName']) ?? mId;
          for (const areaKey of ['PatrolArea', 'Area', 'ProsecutionArea', 'NavigationCourse']) {
            const pts = extractPoints(m[areaKey], rpMap);
            if (pts.length >= 3) {
              const poly: EvalPolygon = { id: `${mId}:${areaKey}`, name: mName, side: sName, points: pts };
              if (areaKey === 'NavigationCourse') {
                model.corridors.push(poly);
              } else {
                model.patrolAreas.push(poly);
              }
              model.coverage.hasPolygonsOrCorridors = true;
            }
          }
        }
      }

      // Contacts 追踪与盲区时长统计
      if (Array.isArray(sideObj.Contacts)) {
        model.coverage.hasContacts = true;
        const activeContactKeys = new Set<string>();
        for (const rawContact of sideObj.Contacts) {
          const c = unwrapEntity(rawContact);
          if (!c) continue;
          const cid = normalizeGuid(
            pickStr(c, ['ObjectID', 'ObjectId', 'ID', 'Id', 'Guid', 'TargetID', 'Name']) ?? '',
          );
          if (!cid) continue;
          activeContactKeys.add(cid);
          const targetId = pickStr(c, ['ActualUnitID', 'TargetID', 'TargetUnitID']);
          const targetName = pickStr(c, ['Name', 'TargetName']);
          const idStatus = pickStr(c, ['IdentificationStatus', 'IDStatus', 'IdStatus']);
          const existing = model.contacts.get(cid);
          if (!existing) {
            model.contacts.set(cid, {
              contactId: cid,
              targetUnitId: targetId ? normalizeGuid(targetId) : undefined,
              targetUnitName: targetName,
              detectedBySide: sName,
              firstSeenSeconds: scenarioSeconds,
              firstSeenClock: clockText,
              lastSeenSeconds: scenarioSeconds,
              lastSeenClock: clockText,
              isLost: false,
              cumulativeDetectedSeconds: 0,
              lostIntervals: [],
              identificationHistory: idStatus
                ? [
                    {
                      scenarioSeconds,
                      clockText,
                      status: idStatus,
                      ref: `Frame:line#${lineNo}`,
                    },
                  ]
                : [],
            });
          } else {
            if (idStatus) {
              if (!existing.identificationHistory) existing.identificationHistory = [];
              const lastHist = existing.identificationHistory[existing.identificationHistory.length - 1];
              if (!lastHist || lastHist.status !== idStatus) {
                existing.identificationHistory.push({
                  scenarioSeconds,
                  clockText,
                  status: idStatus,
                  ref: `Frame:line#${lineNo}`,
                });
              }
            }
            if (existing.isLost) {
              // 从丢失恢复 -> 记录一次情报黑障窗口
              const dur = Math.max(0, scenarioSeconds - existing.lastSeenSeconds);
              existing.lostIntervals.push({
                lostAtSeconds: existing.lastSeenSeconds,
                reacquiredAtSeconds: scenarioSeconds,
                durationSeconds: dur,
                lostClock: existing.lastSeenClock,
                reacquiredClock: clockText,
                ref: `Frame:line#${lineNo}`,
              });
              existing.isLost = false;
            } else {
              existing.cumulativeDetectedSeconds += Math.max(0, scenarioSeconds - existing.lastSeenSeconds);
            }
            existing.lastSeenSeconds = scenarioSeconds;
            existing.lastSeenClock = clockText;
          }
        }
        // 本阵营当前帧仍存在但未出现在本帧 Contacts 的已知接触标记丢失
        for (const contact of model.contacts.values()) {
          if (contact.detectedBySide === sName && !activeContactKeys.has(contact.contactId)) {
            contact.isLost = true;
          }
        }
      }
    }
  }

  // 3) 解析 ActiveUnits（剥壳 + SideID反查 + 字符串转数字 + 传感器/余弹）
  if (Array.isArray(scenario.ActiveUnits)) {
    for (const rawUnit of scenario.ActiveUnits) {
      const wrapperType = entityWrapperType(rawUnit);
      const u = unwrapEntity(rawUnit);
      if (!u) continue;
      const uid = normalizeGuid(pickStr(u, ['ObjectID', 'ObjectId', 'Guid', 'GUID', 'ID', 'Id', 'Name']));
      if (!uid) continue;

      const sideId = pickStr(u, ['SideID', 'SideId']);
      const side =
        pickStr(u, ['Side', 'SideName', 'Force', 'Coalition']) ??
        (sideId ? sideIdToName.get(normalizeGuid(sideId)) : undefined) ??
        'Unknown';
      if (side !== 'Unknown' && !model.sides.includes(side)) {
        model.sides.push(side);
      }

      const lon = pickNum(u, ['Longitude', 'LonLR', 'Lon']);
      const lat = pickNum(u, ['Latitude', 'LatLR', 'Lat']);
      const alt = pickNum(u, ['Altitude', 'CA', 'CurrentAltitude']);
      const heading = pickNum(u, ['Heading', 'Course', 'CH', 'CurrentHeading']);
      const speed = pickNum(u, ['Speed', 'Velocity', 'CS', 'CurrentSpeed']);
      const dmgRaw = pickStr(u, ['DamageState', 'DamageStatus', 'Damage']) ?? 'ok';
      const isDestr = /destroy|killed|sunk|wreck|dead|摧毁|击毁|沉没|已毁/i.test(dmgRaw);
      const isDmg = !isDestr && /light|medium|heavy|minor|major|damag|受损|轻伤|重伤/i.test(dmgRaw);
      const dmgState: SituationUnit['damageState'] = isDestr ? 'destroyed' : isDmg ? 'damaged' : 'ok';
      if (dmgState !== 'ok') model.coverage.hasDamagedOrDestroyed = true;

      const ammo = extractAmmoRemaining(u);
      const unitName = pickStr(u, ['Name', 'UnitName']) ?? uid;
      const unitClass = pickStr(u, ['UnitClass', 'Class', 'Catalog', 'Description']) ?? wrapperType ?? 'Unknown';
      const unitType = pickStr(u, ['UnitTyper', 'UnitType']) ?? wrapperType;

      let su = model.units.get(uid);
      if (!su) {
        su = {
          unitId: uid,
          unitName,
          side,
          unitType,
          unitClass,
          dbid: pickStr(u, ['DBID', 'Dbid']),
          firstSeenSeconds: scenarioSeconds,
          firstSeenClock: clockText,
          lastSeenSeconds: scenarioSeconds,
          lastSeenClock: clockText,
          isDestroyed: isDestr,
          destroyedSeconds: isDestr ? scenarioSeconds : undefined,
          destroyedClock: isDestr ? clockText : undefined,
          damageState: dmgState,
          ammoInitial: ammo ?? 0,
          ammoRemaining: ammo ?? 0,
          emconStates: [],
          trackPoints: [],
        };
        model.units.set(uid, su);
      } else {
        su.lastSeenSeconds = scenarioSeconds;
        su.lastSeenClock = clockText;
        if (ammo !== null) su.ammoRemaining = ammo;
        if (isDestr && !su.isDestroyed) {
          su.isDestroyed = true;
          su.destroyedSeconds = scenarioSeconds;
          su.destroyedClock = clockText;
          su.damageState = 'destroyed';
        } else if (dmgState === 'damaged' && su.damageState === 'ok') {
          su.damageState = 'damaged';
        }
      }

      // 传感器开关采样（真实存在 Sensors 数组且含 Active 布尔或 "True"/"False" 才记录）
      if (Array.isArray(u.Sensors)) {
        for (const rawS of u.Sensors) {
          const s = unwrapEntity(rawS);
          if (!s || s.Active === undefined) continue;
          const activeBool =
            typeof s.Active === 'boolean' ? s.Active : String(s.Active).toLowerCase() === 'true';
          const sid = pickStr(s, ['ID', 'Id']) ?? 'sensor-unknown';
          su.emconStates.push({
            scenarioSeconds,
            clockText,
            sensorId: sid,
            sensorName: pickStr(s, ['Name']),
            active: activeBool,
            lineRef: `Frame:line#${lineNo}`,
          });
          model.coverage.hasSensorStates = true;
        }
      }

      // 燃油记录 Fuel.FuelRec ({ FT, CQ, MQ })
      const fuelObj = unwrapEntity(u.Fuel);
      const fuelRec = fuelObj ? unwrapEntity(fuelObj.FuelRec) : null;
      if (fuelRec) {
        const cq = pickNum(fuelRec, ['CQ', 'CurrentQuantity']);
        const mq = pickNum(fuelRec, ['MQ', 'MaxQuantity']);
        if (cq !== undefined && mq !== undefined && mq > 0) {
          model.fuelRecords ??= [];
          const existingIdx = model.fuelRecords.findIndex((f) => f.unitId === uid);
          const entry = {
            unitId: uid,
            unitName,
            side,
            currentQty: cq,
            maxQty: mq,
            sourceRef: `Frame:line#${lineNo}`,
          };
          if (existingIdx >= 0) model.fuelRecords[existingIdx] = entry;
          else model.fuelRecords.push(entry);
        }
      }

      if (lon !== undefined && lat !== undefined) {
        model.coverage.hasPositionTracks = true;
        const lastPt = su.trackPoints[su.trackPoints.length - 1];
        const changedEnough =
          options?.trackAllSamples ||
          !lastPt ||
          scenarioSeconds - lastPt.scenarioSeconds >= 5 ||
          Math.abs(lastPt.lon - lon) > 1e-4 ||
          Math.abs(lastPt.lat - lat) > 1e-4 ||
          Math.abs((lastPt.heading ?? 0) - (heading ?? 0)) > 5;
        if (changedEnough) {
          su.trackPoints.push({
            scenarioSeconds,
            clockText,
            lon,
            lat,
            altitudeM: alt,
            heading,
            speedKts: speed,
            lineRef: lineNo,
          });
        }
      }
    }
  }

  // 4) 调用 demo-ui/proxy/bs-diff.mjs 提取结构化事件卡
  const diffCards = diffFrames(state.prevRecord, record) as Array<{
    eventId: string;
    scenarioTime: string | null;
    side: string | null;
    kind: string;
    subject: string | null;
    object: string | null;
    severity: 'major' | 'minor';
    detail: Record<string, unknown>;
    source: 'diff' | 'engine_push';
  }>;

  const emitted: StructuredSimEvent[] = [];
  for (const card of diffCards) {
    const mappedKind = mapDiffKind(card.kind);
    const ev: StructuredSimEvent = {
      eventId: card.eventId,
      scenarioSeconds,
      clockText,
      side: card.side,
      kind: mappedKind,
      subject: card.subject,
      object: card.object,
      severity: card.severity,
      detail: card.detail ?? {},
      source: card.source ?? 'diff',
      ref: `Frame:line#${lineNo}`,
    };
    model.events.push(ev);
    emitted.push(ev);

    // 同步推进 weaponFiredEvents / damageAndHitEvents / engine hits
    if (mappedKind === 'weapon_fired') {
      model.coverage.hasWeaponFired = true;
      const firerKey = normalizeGuid(
        (card.detail?.unitId as string) ?? card.subject ?? '',
      );
      const firerUnit = model.units.get(firerKey);
      const lastTrack = firerUnit?.trackPoints[firerUnit.trackPoints.length - 1];
      const wName = String(card.object ?? card.detail?.weapon ?? 'Weapon');
      model.weaponFiredEvents.push({
        eventId: card.eventId,
        scenarioSeconds,
        clockText,
        firerUnitId: firerKey,
        firerName: card.subject ?? firerUnit?.unitName ?? firerKey,
        firerSide: card.side ?? firerUnit?.side ?? 'Unknown',
        firerLon: lastTrack?.lon,
        firerLat: lastTrack?.lat,
        weaponTypeNormalized: wName.replace(/\s+#\d+$/, ''),
        weaponNameRaw: wName,
        rounds: Number(card.detail?.delta ?? 1) || 1,
        sourceRef: `Frame:line#${lineNo}`,
      });
    } else if (mappedKind === 'unit_destroyed') {
      model.coverage.hasDamagedOrDestroyed = true;
      const targetKey = normalizeGuid((card.detail?.unitId as string) ?? card.subject ?? '');
      const u = model.units.get(targetKey);
      if (u && !u.isDestroyed) {
        u.isDestroyed = true;
        u.destroyedSeconds = scenarioSeconds;
        u.destroyedClock = clockText;
        u.damageState = 'destroyed';
      }
      model.damageAndHitEvents.push({
        eventId: card.eventId,
        scenarioSeconds,
        clockText,
        targetUnitId: targetKey,
        targetUnitName: card.subject ?? u?.unitName,
        targetSide: card.side ?? u?.side ?? 'Unknown',
        damageState: 'destroyed',
        reason: String(card.detail?.damageState ?? 'destroyed'),
        sourceRef: `Frame:line#${lineNo}`,
      });
    } else if (mappedKind === 'engine_event') {
      const evPayload = isPlainObject(card.detail?.event)
        ? (card.detail.event as Record<string, unknown>)
        : null;
      const evType = pickStr(evPayload, ['Type', 'type', 'Kind', 'kind']) ?? '';
      if (/WeaponHit|WeaponEndgame|UnitDamaged/i.test(evType)) {
        model.coverage.hasDamagedOrDestroyed = true;
        const tid = normalizeGuid(pickStr(evPayload, ['TargetID', 'Target', 'UnitID']) ?? '');
        const tUnit = tid ? model.units.get(tid) : undefined;
        model.damageAndHitEvents.push({
          eventId: card.eventId,
          scenarioSeconds,
          clockText,
          targetUnitId: tid || normalizeGuid(card.subject ?? ''),
          targetUnitName: tUnit?.unitName ?? card.subject ?? undefined,
          targetSide: card.side ?? tUnit?.side ?? 'Unknown',
          damageState: 'damaged',
          sourceWeapon: pickStr(evPayload, ['Weapon', 'WeaponName']),
          reason: evType,
          sourceRef: `Frame:line#${lineNo}`,
        });
      }
    }
  }

  state.prevRecord = record;
  return emitted;
}

export async function parseFramesJsonlFile(
  filePath: string,
  runId: string,
  options?: { trackAllSamples?: boolean },
): Promise<{
  model: SituationModel;
  events: StructuredSimEvent[];
  frameCount: number;
}> {
  const state = initFrameIngestion(runId, filePath);
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let lineNo = 0;
  for await (const rawLine of rl) {
    lineNo += 1;
    ingestFrameLine(state, rawLine, lineNo, options);
  }

  return {
    model: state.model,
    events: state.model.events,
    frameCount: state.frameCount,
  };
}

export function parseFramesJsonlText(
  text: string,
  runId: string,
  scenarioPath = '<inline>',
): {
  model: SituationModel;
  events: StructuredSimEvent[];
  frameCount: number;
} {
  const state = initFrameIngestion(runId, scenarioPath);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    ingestFrameLine(state, lines[i], i + 1, { trackAllSamples: true });
  }
  return {
    model: state.model,
    events: state.model.events,
    frameCount: state.frameCount,
  };
}
