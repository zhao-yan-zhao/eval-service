import type { V4OperatorScriptSpec } from './types.ts';

/**
 * F1 V4 一库实证算子脚本注册表 — Part 1（第 1~3 章，共 27 项）
 *
 * 严格对齐：
 * 1) d:\project\beifen\metrics_calculation_guide.html 第 1~3 章及 §0 修正口径
 * 2) eval-service/src/engine/python_worker.py AST 安全沙箱白名单与预注入全局契约
 *    （使用预注入的 T/C/in_polygon/params/prev_output_df，严禁使用 eval/exec/open/getattr/dunder）
 * 3) eval-service/AGENTS.md §3 仿真数据特异性（中文 UnitType="武器" 过滤、WeaponEndgame 去重等）
 */
export const V4_OPERATORS_PART1: V4OperatorScriptSpec[] = [
  // =========================================================================
  // 第 1 章：任务效果（1.1 攻击任务 · 1.2 巡逻任务 · 1.3 支援任务）— 9 项
  // =========================================================================

  // 1.1.1 毁伤仿真
  {
    id: 'strike.damage_simulation',
    name: '毁伤仿真',
    chapter: 1,
    category: 'effectiveness',
    militaryLevel: 'MOP',
    domainTag: 'firepower',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '筛选非空战拦截攻击任务目标清单，统计目标最大毁伤（Losses 战损先强制置 1.0），再按参数化损伤比阈值判定完成打击目标明细。',
    requiredTables: ['MissionChanged', 'MissionUnitRelationChanged'],
    optionalTables: ['UnitDamaged', 'Losses', 'UnitCreated'],
    tableColumns: {
      MissionChanged: ['MissionID', 'MissionName', 'Side', 'UnitSide', 'MissionClass', 'SubClass'],
      MissionUnitRelationChanged: ['MissionID', 'UnitID', 'Type'],
      UnitDamaged: ['UnitID', 'DamagePercent'],
      Losses: ['SubjectID'],
      UnitCreated: ['UnitID', 'UnitName'],
    },
    parameterPorts: [
      {
        key: 'damageThreshold',
        label: '损伤比不小于 (0~1)',
        dataType: 'number',
        defaultValue: 0.5,
        description: '判定完成打击目标的最小归一化毁伤阈值（先按 Losses 置 1.0 再比较）',
      },
    ],
    outputColumns: [
      '目标ID',
      '目标名',
      '所属任务ID',
      '所属任务名',
      '目标损伤程度',
      '损伤比不小于',
      '完成打击目标',
      '分方',
    ],
    pythonCode: `
import pandas as pd
import numpy as np

damage_threshold = float(params.get("damageThreshold", 0.5))

missions = T("MissionChanged")
rels = T("MissionUnitRelationChanged")
damaged = T("UnitDamaged")
losses = T("Losses")
units = T("UnitCreated")

COLS = ["目标ID", "目标名", "所属任务ID", "所属任务名", "目标损伤程度", "损伤比不小于", "完成打击目标", "分方"]

if missions.empty or "MissionID" not in missions.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    sub_col = C(missions, "SubClass", "").fillna("").astype(str)
    mask = (C(missions, "MissionClass", "").fillna("").astype(str) == "Strike") & (sub_col != "Air_Intercept")
    sel = missions.loc[mask, ["MissionID"]].copy()
    sel["MissionName"] = C(missions, "MissionName", missions["MissionID"]).fillna(missions["MissionID"]).loc[sel.index]
    if "UnitSide" in missions.columns and missions["UnitSide"].notna().any():
        sel["MissionSide"] = missions["UnitSide"].fillna(C(missions, "Side", "未知")).fillna("未知").astype(str).loc[sel.index]
    elif "Side" in missions.columns:
        sel["MissionSide"] = missions["Side"].fillna("未知").astype(str).loc[sel.index]
    else:
        sel["MissionSide"] = "未知"
    sel = sel.drop_duplicates("MissionID")

    if rels.empty or not {"MissionID", "UnitID", "Type"}.issubset(rels.columns) or sel.empty:
        targets = pd.DataFrame(columns=["MissionID", "UnitID", "MissionName", "MissionSide"])
    else:
        targets = rels.loc[rels["Type"].astype(str) == "StrikeActiveUnit", ["MissionID", "UnitID"]].merge(
            sel, on="MissionID", how="inner"
        )

    if targets.empty:
        output_df = pd.DataFrame(columns=COLS)
    else:
        if not damaged.empty and {"UnitID", "DamagePercent"}.issubset(damaged.columns):
            dmg = pd.to_numeric(damaged["DamagePercent"], errors="coerce").groupby(damaged["UnitID"]).max() / 100.0
            targets["目标损伤程度"] = targets["UnitID"].map(dmg).fillna(0.0).astype(float)
        else:
            targets["目标损伤程度"] = 0.0

        lost = set(losses["SubjectID"].dropna()) if not losses.empty and "SubjectID" in losses.columns else set()
        targets.loc[targets["UnitID"].isin(lost), "目标损伤程度"] = 1.0

        targets["损伤比不小于"] = damage_threshold
        targets["完成打击目标"] = (targets["目标损伤程度"] >= damage_threshold).astype(bool)

        if not units.empty and {"UnitID", "UnitName"}.issubset(units.columns):
            names_map = units.drop_duplicates("UnitID").set_index("UnitID")["UnitName"].to_dict()
            target_names = targets["UnitID"].map(lambda uid: names_map.get(uid, uid) if pd.notna(names_map.get(uid)) else uid)
        else:
            target_names = targets["UnitID"]

        output_df = pd.DataFrame({
            "目标ID": targets["UnitID"].astype(str),
            "目标名": target_names.astype(str),
            "所属任务ID": targets["MissionID"].astype(str),
            "所属任务名": targets["MissionName"].astype(str),
            "目标损伤程度": targets["目标损伤程度"].astype(float),
            "损伤比不小于": targets["损伤比不小于"].astype(float),
            "完成打击目标": targets["完成打击目标"].astype(bool),
            "分方": targets["MissionSide"].astype(str),
        })[COLS]
`.trim(),
  },

  // 1.1.2 单攻击任务指标
  {
    id: 'strike.single_mission_metrics',
    name: '单攻击任务指标',
    chapter: 1,
    category: 'effectiveness',
    militaryLevel: 'MOE',
    domainTag: 'firepower',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '统计单攻击任务的投入单元、目标数、摧毁/命中目标数、5s 窗口持续时间 (N-1)*5、完成打击目标比与任务完成比。',
    requiredTables: ['MissionChanged', 'MissionUnitRelationChanged', 'UnitPositions'],
    optionalTables: ['Losses', 'UnitDamaged'],
    tableColumns: {
      MissionChanged: ['MissionID', 'MissionName', 'Side', 'UnitSide', 'MissionClass', 'SubClass'],
      MissionUnitRelationChanged: ['MissionID', 'UnitID', 'Type'],
      Losses: ['SubjectID'],
      UnitDamaged: ['UnitID', 'DamagePercent'],
      UnitPositions: ['Time', 'UnitID'],
    },
    parameterPorts: [
      {
        key: 'damageThreshold',
        label: '损伤比不小于 (0~1)',
        dataType: 'number',
        defaultValue: 0.5,
        description: '判定单项目标打击成功所需的最小归一化毁伤阈值',
      },
    ],
    outputColumns: [
      '任务ID',
      '任务名',
      '分方',
      '投入单元',
      '目标数',
      '摧毁目标数',
      '命中目标数',
      '持续时间',
      '完成打击目标比',
      '完成比',
    ],
    pythonCode: `
import pandas as pd
import numpy as np

damage_threshold = float(params.get("damageThreshold", 0.5))

missions = T("MissionChanged")
rels = T("MissionUnitRelationChanged")
losses = T("Losses")
damaged = T("UnitDamaged")
positions = T("UnitPositions")

COLS = ["任务ID", "任务名", "分方", "投入单元", "目标数", "摧毁目标数", "命中目标数", "持续时间", "完成打击目标比", "完成比"]

if missions.empty or "MissionID" not in missions.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    sub_col = C(missions, "SubClass", "").fillna("").astype(str)
    mask = (C(missions, "MissionClass", "").fillna("").astype(str) == "Strike") & (sub_col != "Air_Intercept")
    sel = missions.loc[mask].drop_duplicates("MissionID").copy()
    if sel.empty:
        output_df = pd.DataFrame(columns=COLS)
    else:
        name_ser = C(sel, "MissionName", sel["MissionID"]).fillna(sel["MissionID"]).astype(str)
        if "UnitSide" in sel.columns and sel["UnitSide"].notna().any():
            side_ser = sel["UnitSide"].fillna(C(sel, "Side", "未知")).fillna("未知").astype(str)
        elif "Side" in sel.columns:
            side_ser = sel["Side"].fillna("未知").astype(str)
        else:
            side_ser = pd.Series("未知", index=sel.index, dtype="object")

        rel_ok = not rels.empty and {"MissionID", "UnitID", "Type"}.issubset(rels.columns)
        assigned = (
            rels.loc[rels["Type"].astype(str) == "Assigned", ["MissionID", "UnitID"]].merge(sel[["MissionID"]], on="MissionID")
            if rel_ok
            else pd.DataFrame(columns=["MissionID", "UnitID"])
        )
        targets = (
            rels.loc[rels["Type"].astype(str) == "StrikeActiveUnit", ["MissionID", "UnitID"]].merge(sel[["MissionID"]], on="MissionID")
            if rel_ok
            else pd.DataFrame(columns=["MissionID", "UnitID"])
        )
        assigned_cnt = assigned.groupby("MissionID").size() if not assigned.empty else pd.Series(dtype=int)
        target_cnt = targets.groupby("MissionID").size() if not targets.empty else pd.Series(dtype=int)

        lost = set(losses["SubjectID"].dropna()) if not losses.empty and "SubjectID" in losses.columns else set()
        if not targets.empty:
            if not damaged.empty and {"UnitID", "DamagePercent"}.issubset(damaged.columns):
                dmg = pd.to_numeric(damaged["DamagePercent"], errors="coerce").groupby(damaged["UnitID"]).max() / 100.0
                targets["DamagePercent"] = targets["UnitID"].map(dmg).fillna(0.0)
            else:
                targets["DamagePercent"] = 0.0
            targets.loc[targets["UnitID"].isin(lost), "DamagePercent"] = 1.0
            targets["Succ"] = targets["DamagePercent"] >= damage_threshold
            lost_cnt = targets[targets["UnitID"].isin(lost)].groupby("MissionID").size()
            hit_cnt = targets[targets["DamagePercent"] > 0].groupby("MissionID").size()
            succ_rate = targets.groupby("MissionID")["Succ"].mean()
        else:
            lost_cnt = pd.Series(dtype=int)
            hit_cnt = pd.Series(dtype=int)
            succ_rate = pd.Series(dtype=float)

        seconds = {}
        if not assigned.empty and not positions.empty and {"Time", "UnitID"}.issubset(positions.columns):
            pos = positions[["Time", "UnitID"]].copy()
            pos["Time"] = pd.to_datetime(pos["Time"], errors="coerce")
            pos = pos.dropna(subset=["Time"]).merge(assigned[["MissionID", "UnitID"]].drop_duplicates(), on="UnitID")
            if not pos.empty:
                per_unit = {uid: g.set_index("Time").resample("5s").size() for uid, g in pos.groupby("UnitID")}
                for mid, g in pos.groupby("MissionID"):
                    series_list = [per_unit[u].rename(str(u)) for u in g["UnitID"].unique() if u in per_unit]
                    if series_list:
                        presence = pd.concat(series_list, axis=1).fillna(0).sum(axis=1)
                        seconds[mid] = float(max(0, int((presence > 0).sum()) - 1) * 5.0)
                    else:
                        seconds[mid] = 0.0

        base = pd.DataFrame({
            "任务ID": sel["MissionID"].astype(str),
            "任务名": name_ser,
            "分方": side_ser,
        })
        base["投入单元"] = sel["MissionID"].map(assigned_cnt).fillna(0).astype(int)
        base["目标数"] = sel["MissionID"].map(target_cnt).fillna(0).astype(int)
        base["摧毁目标数"] = sel["MissionID"].map(lost_cnt).fillna(0).astype(int)
        base["命中目标数"] = sel["MissionID"].map(hit_cnt).fillna(0).astype(int)
        base["持续时间"] = sel["MissionID"].map(seconds).fillna(0.0).astype(float)
        base["完成打击目标比"] = sel["MissionID"].map(succ_rate).fillna(0.0).astype(float)
        base["完成比"] = (base["完成打击目标比"] >= 1.0).astype(float)
        output_df = base[COLS]
`.trim(),
  },

  // 1.1.3 多攻击任务综合指标
  {
    id: 'strike.composite_mission_metrics',
    name: '多攻击任务综合指标',
    chapter: 1,
    category: 'effectiveness',
    militaryLevel: 'MOFE',
    domainTag: 'firepower',
    layer: 'legacy_aggregate',
    engineKind: 'python_script',
    description:
      '基于单攻击任务指标（或原始底层表独立重算），按分方聚合平均完成比、任务平均时长与平均派遣单元数量。',
    upstreamOperatorId: 'strike.single_mission_metrics',
    requiredTables: ['MissionChanged', 'MissionUnitRelationChanged', 'UnitPositions'],
    optionalTables: ['Losses', 'UnitDamaged'],
    tableColumns: {
      MissionChanged: ['MissionID', 'MissionName', 'Side', 'UnitSide', 'MissionClass', 'SubClass'],
      MissionUnitRelationChanged: ['MissionID', 'UnitID', 'Type'],
      Losses: ['SubjectID'],
      UnitDamaged: ['UnitID', 'DamagePercent'],
      UnitPositions: ['Time', 'UnitID'],
    },
    parameterPorts: [
      {
        key: 'damageThreshold',
        label: '损伤比不小于 (0~1)',
        dataType: 'number',
        defaultValue: 0.5,
        description: '独立重算单攻击任务时判定目标达标的最小毁伤阈值',
      },
    ],
    outputColumns: ['分方', '平均完成比', '任务平均时长', '平均派遣单元数量'],
    pythonCode: `
import pandas as pd
import numpy as np

damage_threshold = float(params.get("damageThreshold", 0.5))
COLS = ["分方", "平均完成比", "任务平均时长", "平均派遣单元数量"]

base = prev_output_df if isinstance(prev_output_df, pd.DataFrame) and not prev_output_df.empty else None
if base is None or not {"分方", "完成比", "持续时间", "投入单元"}.issubset(base.columns):
    missions = T("MissionChanged")
    rels = T("MissionUnitRelationChanged")
    losses = T("Losses")
    damaged = T("UnitDamaged")
    positions = T("UnitPositions")
    if missions.empty or "MissionID" not in missions.columns:
        base = pd.DataFrame(columns=["分方", "完成比", "持续时间", "投入单元"])
    else:
        sub_col = C(missions, "SubClass", "").fillna("").astype(str)
        mask = (C(missions, "MissionClass", "").fillna("").astype(str) == "Strike") & (sub_col != "Air_Intercept")
        sel = missions.loc[mask].drop_duplicates("MissionID").copy()
        if sel.empty:
            base = pd.DataFrame(columns=["分方", "完成比", "持续时间", "投入单元"])
        else:
            if "UnitSide" in sel.columns and sel["UnitSide"].notna().any():
                side_ser = sel["UnitSide"].fillna(C(sel, "Side", "未知")).fillna("未知").astype(str)
            elif "Side" in sel.columns:
                side_ser = sel["Side"].fillna("未知").astype(str)
            else:
                side_ser = pd.Series("未知", index=sel.index, dtype="object")

            rel_ok = not rels.empty and {"MissionID", "UnitID", "Type"}.issubset(rels.columns)
            assigned = (
                rels.loc[rels["Type"].astype(str) == "Assigned", ["MissionID", "UnitID"]].merge(sel[["MissionID"]], on="MissionID")
                if rel_ok
                else pd.DataFrame(columns=["MissionID", "UnitID"])
            )
            targets = (
                rels.loc[rels["Type"].astype(str) == "StrikeActiveUnit", ["MissionID", "UnitID"]].merge(sel[["MissionID"]], on="MissionID")
                if rel_ok
                else pd.DataFrame(columns=["MissionID", "UnitID"])
            )
            lost = set(losses["SubjectID"].dropna()) if not losses.empty and "SubjectID" in losses.columns else set()
            if not targets.empty:
                dmg = (
                    pd.to_numeric(damaged["DamagePercent"], errors="coerce").groupby(damaged["UnitID"]).max() / 100.0
                    if not damaged.empty and {"UnitID", "DamagePercent"}.issubset(damaged.columns)
                    else pd.Series(dtype=float)
                )
                t = targets.copy()
                t["d"] = t["UnitID"].map(dmg).fillna(0.0)
                t.loc[t["UnitID"].isin(lost), "d"] = 1.0
                rate = (t["d"] >= damage_threshold).groupby(t["MissionID"]).mean()
            else:
                rate = pd.Series(dtype=float)

            seconds = {}
            if not assigned.empty and not positions.empty and {"Time", "UnitID"}.issubset(positions.columns):
                pos = positions[["Time", "UnitID"]].copy()
                pos["Time"] = pd.to_datetime(pos["Time"], errors="coerce")
                pos = pos.dropna(subset=["Time"]).merge(assigned[["MissionID", "UnitID"]].drop_duplicates(), on="UnitID")
                if not pos.empty:
                    per = {u: g.set_index("Time").resample("5s").size() for u, g in pos.groupby("UnitID")}
                    for mid, g in pos.groupby("MissionID"):
                        ss = [per[u].rename(str(u)) for u in g["UnitID"].unique() if u in per]
                        if ss:
                            presence = pd.concat(ss, axis=1).fillna(0).sum(axis=1)
                            seconds[mid] = float(max(0, int((presence > 0).sum()) - 1) * 5.0)
            acnt = assigned.groupby("MissionID").size() if not assigned.empty else pd.Series(dtype=int)
            base = pd.DataFrame({
                "分方": side_ser,
                "完成比": sel["MissionID"].map(rate).fillna(0.0).ge(1.0).astype(float),
                "持续时间": sel["MissionID"].map(seconds).fillna(0.0).astype(float),
                "投入单元": sel["MissionID"].map(acnt).fillna(0).astype(int),
            })

if base is None or base.empty or "分方" not in base.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    g = base.copy()
    for c in ["完成比", "持续时间", "投入单元"]:
        g[c] = pd.to_numeric(g[c] if c in g.columns else 0.0, errors="coerce").fillna(0.0)
    out = g.groupby("分方", dropna=False).agg(
        平均完成比=("完成比", "mean"),
        任务平均时长=("持续时间", "mean"),
        平均派遣单元数量=("投入单元", "mean"),
    ).reset_index()
    output_df = out[COLS]
`.trim(),
  },

  // 1.2.1 巡逻单元完成情况
  {
    id: 'patrol.unit_completion_status',
    name: '巡逻单元完成情况',
    chapter: 1,
    category: 'compliance',
    militaryLevel: 'MOP',
    domainTag: 'survivability',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '按原始行序构造巡逻区多边形（不排序），以纯 Python 射线法判定在阵位 5s 窗口，输出单元进入/离开阵位时间、保持秒数与战损标记。',
    requiredTables: [
      'MissionChanged',
      'MissionRefPointRelationChanged',
      'MissionUnitRelationChanged',
      'UnitPositions',
    ],
    optionalTables: ['Losses', 'UnitCreated'],
    tableColumns: {
      MissionChanged: ['MissionID', 'MissionName', 'Side', 'UnitSide', 'MissionClass'],
      MissionRefPointRelationChanged: ['MissionID', 'Type', 'Longitude', 'Latitude'],
      MissionUnitRelationChanged: ['MissionID', 'UnitID', 'Type'],
      UnitPositions: ['Time', 'UnitID', 'UnitLongitude', 'UnitLatitude'],
      Losses: ['SubjectID'],
      UnitCreated: ['UnitID', 'UnitName', 'UnitSide', 'Side'],
    },
    parameterPorts: [],
    outputColumns: ['单元ID', '单元名', '所属任务ID', '任务名', '进入阵位时间', '离开阵位时间', '保持阵位秒数', '损失', '分方'],
    pythonCode: `
import pandas as pd
import numpy as np

missions = T("MissionChanged")
refpoints = T("MissionRefPointRelationChanged")
rels = T("MissionUnitRelationChanged")
positions = T("UnitPositions")
losses = T("Losses")
units = T("UnitCreated")

COLS = ["单元ID", "单元名", "所属任务ID", "任务名", "进入阵位时间", "离开阵位时间", "保持阵位秒数", "损失", "分方"]

if missions.empty or "MissionID" not in missions.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    has_ref = set(refpoints["MissionID"].dropna()) if not refpoints.empty and "MissionID" in refpoints.columns else set()
    mask = (C(missions, "MissionClass", "").fillna("").astype(str) == "Patrol") & missions["MissionID"].isin(has_ref)
    sel = missions.loc[mask].drop_duplicates("MissionID").copy()
    name_by_mid = dict(zip(sel["MissionID"], C(sel, "MissionName", sel["MissionID"]).fillna(sel["MissionID"])))
    if "UnitSide" in sel.columns and sel["UnitSide"].notna().any():
        side_ser = sel["UnitSide"].fillna(C(sel, "Side", "未知")).fillna("未知").astype(str)
    elif "Side" in sel.columns:
        side_ser = sel["Side"].fillna("未知").astype(str)
    else:
        side_ser = pd.Series("未知", index=sel.index, dtype="object")
    side_by_mid = dict(zip(sel["MissionID"], side_ser))

    geos = {}
    if not refpoints.empty and {"MissionID", "Type", "Longitude", "Latitude"}.issubset(refpoints.columns):
        rp = refpoints.loc[C(refpoints, "Type", "").astype(str) == "Patrol"]
        for mid, g in rp.groupby("MissionID", sort=False):
            pts = [
                (float(a), float(b))
                for a, b in zip(pd.to_numeric(g["Longitude"], errors="coerce"), pd.to_numeric(g["Latitude"], errors="coerce"))
                if pd.notna(a) and pd.notna(b)
            ]
            if len(pts) >= 3:
                geos[mid] = pts

    rel_ok = not rels.empty and {"MissionID", "UnitID", "Type"}.issubset(rels.columns)
    assigned = (
        rels.loc[rels["Type"].astype(str) == "Assigned", ["MissionID", "UnitID"]].merge(sel[["MissionID"]], on="MissionID")
        if rel_ok and not sel.empty
        else pd.DataFrame(columns=["MissionID", "UnitID"])
    )
    lost = set(losses["SubjectID"].dropna()) if not losses.empty and "SubjectID" in losses.columns else set()

    unit_series = {}
    if not assigned.empty and not positions.empty and {"Time", "UnitID", "UnitLongitude", "UnitLatitude"}.issubset(positions.columns):
        pos = positions[["Time", "UnitID", "UnitLongitude", "UnitLatitude"]].copy()
        pos["Time"] = pd.to_datetime(pos["Time"], errors="coerce")
        for c in ["UnitLongitude", "UnitLatitude"]:
            pos[c] = pd.to_numeric(pos[c], errors="coerce")
        pos = pos.dropna(subset=["Time", "UnitID", "UnitLongitude", "UnitLatitude"]).merge(
            assigned[["MissionID", "UnitID"]].drop_duplicates(), on="UnitID"
        )
        pos["_in"] = False
        for mid, poly in geos.items():
            idx = pos.index[pos["MissionID"] == mid]
            if len(idx) == 0:
                continue
            pos.loc[idx, "_in"] = [
                in_polygon(a, b, poly) for a, b in zip(pos.loc[idx, "UnitLongitude"], pos.loc[idx, "UnitLatitude"])
            ]
        for (mid, uid), g in pos[pos["_in"]].groupby(["MissionID", "UnitID"]):
            s = g.set_index("Time").resample("5s").size()
            s = s[s > 0]
            if len(s) > 0:
                unit_series[(mid, uid)] = s

    names_dict = (
        units.drop_duplicates("UnitID").set_index("UnitID")["UnitName"].to_dict()
        if not units.empty and {"UnitID", "UnitName"}.issubset(units.columns)
        else {}
    )
    uside_col = "UnitSide" if not units.empty and "UnitSide" in units.columns else ("Side" if not units.empty and "Side" in units.columns else None)
    sides_dict = (
        units.drop_duplicates("UnitID").set_index("UnitID")[uside_col].to_dict()
        if uside_col and "UnitID" in units.columns
        else {}
    )
    rows = []
    for (mid, uid), s in unit_series.items():
        uname = names_dict.get(uid, uid)
        if pd.isna(uname):
            uname = uid
        mside = side_by_mid.get(mid, "未知")
        if mside == "未知" or pd.isna(mside):
            mside = sides_dict.get(uid, "未知")
            if pd.isna(mside):
                mside = "未知"
        rows.append({
            "单元ID": str(uid),
            "单元名": str(uname),
            "所属任务ID": str(mid),
            "任务名": str(name_by_mid.get(mid, mid)),
            "进入阵位时间": s.first_valid_index(),
            "离开阵位时间": s.last_valid_index(),
            "保持阵位秒数": float(len(s) * 5.0),
            "损失": bool(uid in lost),
            "分方": str(mside),
        })
    output_df = pd.DataFrame(rows)[COLS] if rows else pd.DataFrame(columns=COLS)

for c in ["进入阵位时间", "离开阵位时间"]:
    output_df[c] = pd.to_datetime(output_df[c], errors="coerce").dt.strftime("%Y-%m-%d %H:%M:%S").fillna("")
`.trim(),
  },

  // 1.2.2 单巡逻任务指标
  {
    id: 'patrol.single_mission_metrics',
    name: '单巡逻任务指标',
    chapter: 1,
    category: 'compliance',
    militaryLevel: 'MOE',
    domainTag: 'survivability',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '统计单巡逻任务的投入单元、损失单元、在阵位保持秒数 (N*5)，并按参数化在阵位时长与损失上限阈值计算保持时间比和完成比。',
    requiredTables: [
      'MissionChanged',
      'MissionRefPointRelationChanged',
      'MissionUnitRelationChanged',
      'UnitPositions',
    ],
    optionalTables: ['Losses'],
    tableColumns: {
      MissionChanged: ['MissionID', 'MissionName', 'Side', 'UnitSide', 'SubClass', 'MissionClass'],
      MissionRefPointRelationChanged: ['MissionID', 'Type', 'Longitude', 'Latitude'],
      MissionUnitRelationChanged: ['MissionID', 'UnitID', 'Type'],
      UnitPositions: ['Time', 'UnitID', 'UnitLongitude', 'UnitLatitude'],
      Losses: ['SubjectID'],
    },
    parameterPorts: [
      {
        key: 'minOnStationSec',
        label: '保持阵位时间不小于 (秒)',
        dataType: 'number',
        defaultValue: 1800.0,
        description: '判定巡逻任务达标的最低在阵位保持秒数（为 0 时保持时间比取 1.0）',
      },
      {
        key: 'maxLosses',
        label: '损失容忍上限 (损失 <= 阈值)',
        dataType: 'number',
        defaultValue: 1,
        description: '判定巡逻任务达标的最大可接受战损单元数量',
      },
    ],
    outputColumns: [
      '任务ID',
      '任务名',
      '分方',
      '子类型',
      '投入单元',
      '损失单元',
      '保持阵位秒数',
      '保持阵位时间不小于',
      '损失小于',
      '保持时间比',
      '完成比',
    ],
    pythonCode: `
import pandas as pd
import numpy as np

min_on_station_sec = float(params.get("minOnStationSec", 1800.0))
max_losses = int(params.get("maxLosses", 1))

missions = T("MissionChanged")
refpoints = T("MissionRefPointRelationChanged")
rels = T("MissionUnitRelationChanged")
positions = T("UnitPositions")
losses = T("Losses")

COLS = ["任务ID", "任务名", "分方", "子类型", "投入单元", "损失单元", "保持阵位秒数", "保持阵位时间不小于", "损失小于", "保持时间比", "完成比"]

if missions.empty or "MissionID" not in missions.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    has_ref = set(refpoints["MissionID"].dropna()) if not refpoints.empty and "MissionID" in refpoints.columns else set()
    mask = (C(missions, "MissionClass", "").fillna("").astype(str) == "Patrol") & missions["MissionID"].isin(has_ref)
    sel = missions.loc[mask].drop_duplicates("MissionID").copy()
    if sel.empty:
        output_df = pd.DataFrame(columns=COLS)
    else:
        geos = {}
        if not refpoints.empty and {"MissionID", "Type", "Longitude", "Latitude"}.issubset(refpoints.columns):
            for mid, g in refpoints.loc[C(refpoints, "Type", "").astype(str) == "Patrol"].groupby("MissionID", sort=False):
                pts = [
                    (float(a), float(b))
                    for a, b in zip(pd.to_numeric(g["Longitude"], errors="coerce"), pd.to_numeric(g["Latitude"], errors="coerce"))
                    if pd.notna(a) and pd.notna(b)
                ]
                if len(pts) >= 3:
                    geos[mid] = pts

        rel_ok = not rels.empty and {"MissionID", "UnitID", "Type"}.issubset(rels.columns)
        assigned = (
            rels.loc[rels["Type"].astype(str) == "Assigned", ["MissionID", "UnitID"]].merge(sel[["MissionID"]], on="MissionID")
            if rel_ok
            else pd.DataFrame(columns=["MissionID", "UnitID"])
        )
        lost = set(losses["SubjectID"].dropna()) if not losses.empty and "SubjectID" in losses.columns else set()

        unit_series = {}
        if not assigned.empty and not positions.empty and {"Time", "UnitID", "UnitLongitude", "UnitLatitude"}.issubset(positions.columns):
            pos = positions[["Time", "UnitID", "UnitLongitude", "UnitLatitude"]].copy()
            pos["Time"] = pd.to_datetime(pos["Time"], errors="coerce")
            for c in ["UnitLongitude", "UnitLatitude"]:
                pos[c] = pd.to_numeric(pos[c], errors="coerce")
            pos = pos.dropna(subset=["Time", "UnitID", "UnitLongitude", "UnitLatitude"]).merge(
                assigned[["MissionID", "UnitID"]].drop_duplicates(), on="UnitID"
            )
            pos["_in"] = False
            for mid, poly in geos.items():
                idx = pos.index[pos["MissionID"] == mid]
                if len(idx):
                    pos.loc[idx, "_in"] = [
                        in_polygon(a, b, poly) for a, b in zip(pos.loc[idx, "UnitLongitude"], pos.loc[idx, "UnitLatitude"])
                    ]
            for (mid, uid), g in pos[pos["_in"]].groupby(["MissionID", "UnitID"]):
                unit_series[(mid, uid)] = g.set_index("Time").resample("5s").size()

        seconds = {}
        for mid in sel["MissionID"]:
            ss = [s.rename(str(i)) for i, s in enumerate([v for (m, _), v in unit_series.items() if m == mid])]
            seconds[mid] = float(int((pd.concat(ss, axis=1).fillna(0).sum(axis=1) > 0).sum()) * 5.0) if ss else 0.0

        assigned_cnt = assigned.groupby("MissionID").size() if not assigned.empty else pd.Series(dtype=int)
        loss_cnt = assigned[assigned["UnitID"].isin(lost)].groupby("MissionID").size() if not assigned.empty else pd.Series(dtype=int)

        records = []
        for _, row in sel.iterrows():
            mid = row["MissionID"]
            sec = float(seconds.get(mid, 0.0))
            loss_n = int(loss_cnt.get(mid, 0))
            ratio = 1.0 if min_on_station_sec <= 0 else min(1.0, sec / min_on_station_sec)
            done = 1.0 if sec >= min_on_station_sec and loss_n <= max_losses else 0.0
            mname = row["MissionName"] if "MissionName" in sel.columns and pd.notna(row["MissionName"]) else mid
            if "UnitSide" in sel.columns and pd.notna(row["UnitSide"]):
                mside = row["UnitSide"]
            elif "Side" in sel.columns and pd.notna(row["Side"]):
                mside = row["Side"]
            else:
                mside = "未知"
            msub = row["SubClass"] if "SubClass" in sel.columns and pd.notna(row["SubClass"]) else "Patrol"
            records.append({
                "任务ID": str(mid),
                "任务名": str(mname),
                "分方": str(mside),
                "子类型": str(msub),
                "投入单元": int(assigned_cnt.get(mid, 0)),
                "损失单元": loss_n,
                "保持阵位秒数": sec,
                "保持阵位时间不小于": min_on_station_sec,
                "损失小于": max_losses,
                "保持时间比": float(ratio),
                "完成比": float(done),
            })
        output_df = pd.DataFrame(records)[COLS]
`.trim(),
  },

  // 1.2.3 多巡逻任务综合指标
  {
    id: 'patrol.composite_mission_metrics',
    name: '多巡逻任务综合指标',
    chapter: 1,
    category: 'compliance',
    militaryLevel: 'MOFE',
    domainTag: 'survivability',
    layer: 'legacy_aggregate',
    engineKind: 'python_script',
    description:
      '基于单巡逻任务指标（或原始底层表独立重算），按分方聚合平均完成比、平均巡逻时长、平均战损单元数量与平均指派单元数量。',
    upstreamOperatorId: 'patrol.single_mission_metrics',
    requiredTables: [
      'MissionChanged',
      'MissionRefPointRelationChanged',
      'MissionUnitRelationChanged',
      'UnitPositions',
    ],
    optionalTables: ['Losses'],
    tableColumns: {
      MissionChanged: ['MissionID', 'MissionName', 'Side', 'UnitSide', 'SubClass', 'MissionClass'],
      MissionRefPointRelationChanged: ['MissionID', 'Type', 'Longitude', 'Latitude'],
      MissionUnitRelationChanged: ['MissionID', 'UnitID', 'Type'],
      UnitPositions: ['Time', 'UnitID', 'UnitLongitude', 'UnitLatitude'],
      Losses: ['SubjectID'],
    },
    parameterPorts: [
      {
        key: 'minOnStationSec',
        label: '保持阵位时间不小于 (秒)',
        dataType: 'number',
        defaultValue: 1800.0,
        description: '独立重算单巡逻任务时的最低在阵位秒数',
      },
      {
        key: 'maxLosses',
        label: '损失容忍上限 (损失 <= 阈值)',
        dataType: 'number',
        defaultValue: 1,
        description: '独立重算单巡逻任务时的最大可接受战损单元数量',
      },
    ],
    outputColumns: ['分方', '平均完成比', '平均巡逻时长', '平均战损单元数量', '平均指派单元数量'],
    pythonCode: `
import pandas as pd
import numpy as np

min_on_station_sec = float(params.get("minOnStationSec", 1800.0))
max_losses = int(params.get("maxLosses", 1))
COLS = ["分方", "平均完成比", "平均巡逻时长", "平均战损单元数量", "平均指派单元数量"]

base = prev_output_df if isinstance(prev_output_df, pd.DataFrame) and not prev_output_df.empty else None
if base is None or not {"分方", "完成比", "保持阵位秒数", "损失单元", "投入单元"}.issubset(base.columns):
    missions = T("MissionChanged")
    refpoints = T("MissionRefPointRelationChanged")
    rels = T("MissionUnitRelationChanged")
    positions = T("UnitPositions")
    losses = T("Losses")
    if missions.empty or "MissionID" not in missions.columns:
        base = pd.DataFrame(columns=["分方", "完成比", "保持阵位秒数", "损失单元", "投入单元"])
    else:
        has_ref = set(refpoints["MissionID"].dropna()) if not refpoints.empty and "MissionID" in refpoints.columns else set()
        sel = missions.loc[
            (C(missions, "MissionClass", "").fillna("").astype(str) == "Patrol") & missions["MissionID"].isin(has_ref)
        ].drop_duplicates("MissionID").copy()
        if sel.empty:
            base = pd.DataFrame(columns=["分方", "完成比", "保持阵位秒数", "损失单元", "投入单元"])
        else:
            geos = {}
            if not refpoints.empty and {"MissionID", "Type", "Longitude", "Latitude"}.issubset(refpoints.columns):
                for mid, g in refpoints.loc[C(refpoints, "Type", "").astype(str) == "Patrol"].groupby("MissionID", sort=False):
                    pts = [
                        (float(a), float(b))
                        for a, b in zip(pd.to_numeric(g["Longitude"], errors="coerce"), pd.to_numeric(g["Latitude"], errors="coerce"))
                        if pd.notna(a) and pd.notna(b)
                    ]
                    if len(pts) >= 3:
                        geos[mid] = pts

            rel_ok = not rels.empty and {"MissionID", "UnitID", "Type"}.issubset(rels.columns)
            assigned = (
                rels.loc[rels["Type"].astype(str) == "Assigned", ["MissionID", "UnitID"]].merge(sel[["MissionID"]], on="MissionID")
                if rel_ok
                else pd.DataFrame(columns=["MissionID", "UnitID"])
            )
            lost = set(losses["SubjectID"].dropna()) if not losses.empty and "SubjectID" in losses.columns else set()
            seconds = {}
            if not assigned.empty and not positions.empty and {"Time", "UnitID", "UnitLongitude", "UnitLatitude"}.issubset(positions.columns):
                pos = positions[["Time", "UnitID", "UnitLongitude", "UnitLatitude"]].copy()
                pos["Time"] = pd.to_datetime(pos["Time"], errors="coerce")
                for c in ["UnitLongitude", "UnitLatitude"]:
                    pos[c] = pd.to_numeric(pos[c], errors="coerce")
                pos = pos.dropna(subset=["Time", "UnitID", "UnitLongitude", "UnitLatitude"]).merge(
                    assigned[["MissionID", "UnitID"]].drop_duplicates(), on="UnitID"
                )
                pos["_in"] = False
                for mid, poly in geos.items():
                    idx = pos.index[pos["MissionID"] == mid]
                    if len(idx):
                        pos.loc[idx, "_in"] = [
                            in_polygon(a, b, poly) for a, b in zip(pos.loc[idx, "UnitLongitude"], pos.loc[idx, "UnitLatitude"])
                        ]
                rows_map = {}
                for (mid, uid), g in pos[pos["_in"]].groupby(["MissionID", "UnitID"]):
                    rows_map.setdefault(mid, []).append(g.set_index("Time").resample("5s").size().rename(str(uid)))
                for mid, ss in rows_map.items():
                    seconds[mid] = float(int((pd.concat(ss, axis=1).fillna(0).sum(axis=1) > 0).sum()) * 5.0)

            acnt = assigned.groupby("MissionID").size() if not assigned.empty else pd.Series(dtype=int)
            lcnt = assigned[assigned["UnitID"].isin(lost)].groupby("MissionID").size() if not assigned.empty else pd.Series(dtype=int)
            if "UnitSide" in sel.columns and sel["UnitSide"].notna().any():
                side_ser = sel["UnitSide"].fillna(C(sel, "Side", "未知")).fillna("未知").astype(str)
            elif "Side" in sel.columns:
                side_ser = sel["Side"].fillna("未知").astype(str)
            else:
                side_ser = pd.Series("未知", index=sel.index, dtype="object")

            base = pd.DataFrame({
                "分方": side_ser.values,
                "完成比": [
                    1.0 if float(seconds.get(m, 0.0)) >= min_on_station_sec and int(lcnt.get(m, 0)) <= max_losses else 0.0
                    for m in sel["MissionID"]
                ],
                "保持阵位秒数": [float(seconds.get(m, 0.0)) for m in sel["MissionID"]],
                "损失单元": [int(lcnt.get(m, 0)) for m in sel["MissionID"]],
                "投入单元": [int(acnt.get(m, 0)) for m in sel["MissionID"]],
            })

if base is None or base.empty or "分方" not in base.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    g = base.copy()
    for c in ["完成比", "保持阵位秒数", "损失单元", "投入单元"]:
        g[c] = pd.to_numeric(g[c] if c in g.columns else 0.0, errors="coerce").fillna(0.0)
    out = g.groupby("分方", dropna=False).agg(
        平均完成比=("完成比", "mean"),
        平均巡逻时长=("保持阵位秒数", "mean"),
        平均战损单元数量=("损失单元", "mean"),
        平均指派单元数量=("投入单元", "mean"),
    ).reset_index()
    output_df = out[COLS]
`.trim(),
  },

  // 1.3.1 支援单元完成情况
  {
    id: 'support.unit_completion_status',
    name: '支援单元完成情况',
    chapter: 1,
    category: 'compliance',
    militaryLevel: 'MOP',
    domainTag: 'c2',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '按原始行序构造支援航线 LineString（单点复制为重合双点），以纯 math 距离 < corridorDeg 容限判定 5s 在阵位时序。',
    requiredTables: [
      'MissionChanged',
      'MissionRefPointRelationChanged',
      'MissionUnitRelationChanged',
      'UnitPositions',
    ],
    optionalTables: ['Losses', 'UnitCreated'],
    tableColumns: {
      MissionChanged: ['MissionID', 'MissionName', 'Side', 'UnitSide', 'MissionClass'],
      MissionRefPointRelationChanged: ['MissionID', 'Type', 'Longitude', 'Latitude'],
      MissionUnitRelationChanged: ['MissionID', 'UnitID', 'Type'],
      UnitPositions: ['Time', 'UnitID', 'UnitLongitude', 'UnitLatitude'],
      Losses: ['SubjectID'],
      UnitCreated: ['UnitID', 'UnitName', 'UnitSide', 'Side'],
    },
    parameterPorts: [
      {
        key: 'corridorDeg',
        label: '航线走廊容限 (度)',
        dataType: 'number',
        defaultValue: 0.5,
        description: '位置点到支援航线折线的最短欧氏距离严格小于该容限（度）视为在阵位',
      },
    ],
    outputColumns: ['单元ID', '单元名', '所属任务ID', '任务名', '进入阵位时间', '离开阵位时间', '保持阵位秒数', '损失', '分方'],
    pythonCode: `
import pandas as pd
import numpy as np
import math

def _dist_to_line(x, y, coords):
    best = float("inf")
    for i in range(len(coords) - 1):
        x1, y1 = coords[i]
        x2, y2 = coords[i + 1]
        dx, dy = x2 - x1, y2 - y1
        den = dx * dx + dy * dy
        t = 0.0 if den == 0 else max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / den))
        best = min(best, math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)))
    return best

corridor_deg = float(params.get("corridorDeg", 0.5))

missions = T("MissionChanged")
refpoints = T("MissionRefPointRelationChanged")
rels = T("MissionUnitRelationChanged")
positions = T("UnitPositions")
losses = T("Losses")
units = T("UnitCreated")

COLS = ["单元ID", "单元名", "所属任务ID", "任务名", "进入阵位时间", "离开阵位时间", "保持阵位秒数", "损失", "分方"]

if missions.empty or "MissionID" not in missions.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    has_ref = set(refpoints["MissionID"].dropna()) if not refpoints.empty and "MissionID" in refpoints.columns else set()
    sel = missions.loc[
        (C(missions, "MissionClass", "").fillna("").astype(str) == "Support") & missions["MissionID"].isin(has_ref)
    ].drop_duplicates("MissionID").copy()
    name_by_mid = dict(zip(sel["MissionID"], C(sel, "MissionName", sel["MissionID"]).fillna(sel["MissionID"])))
    if "UnitSide" in sel.columns and sel["UnitSide"].notna().any():
        side_ser = sel["UnitSide"].fillna(C(sel, "Side", "未知")).fillna("未知").astype(str)
    elif "Side" in sel.columns:
        side_ser = sel["Side"].fillna("未知").astype(str)
    else:
        side_ser = pd.Series("未知", index=sel.index, dtype="object")
    side_by_mid = dict(zip(sel["MissionID"], side_ser))

    geos = {}
    if not refpoints.empty and {"MissionID", "Type", "Longitude", "Latitude"}.issubset(refpoints.columns):
        for mid, g in refpoints.loc[C(refpoints, "Type", "").astype(str) == "NavigationCourse"].groupby("MissionID", sort=False):
            pts = [
                (float(a), float(b))
                for a, b in zip(pd.to_numeric(g["Longitude"], errors="coerce"), pd.to_numeric(g["Latitude"], errors="coerce"))
                if pd.notna(a) and pd.notna(b)
            ]
            if len(pts) >= 2:
                geos[mid] = pts
            elif len(pts) == 1:
                geos[mid] = [pts[0], pts[0]]

    rel_ok = not rels.empty and {"MissionID", "UnitID", "Type"}.issubset(rels.columns)
    assigned = (
        rels.loc[rels["Type"].astype(str) == "Assigned", ["MissionID", "UnitID"]].merge(sel[["MissionID"]], on="MissionID")
        if not sel.empty and rel_ok
        else pd.DataFrame(columns=["MissionID", "UnitID"])
    )
    lost = set(losses["SubjectID"].dropna()) if not losses.empty and "SubjectID" in losses.columns else set()

    unit_series = {}
    if not assigned.empty and not positions.empty and {"Time", "UnitID", "UnitLongitude", "UnitLatitude"}.issubset(positions.columns):
        pos = positions[["Time", "UnitID", "UnitLongitude", "UnitLatitude"]].copy()
        pos["Time"] = pd.to_datetime(pos["Time"], errors="coerce")
        for c in ["UnitLongitude", "UnitLatitude"]:
            pos[c] = pd.to_numeric(pos[c], errors="coerce")
        pos = pos.dropna(subset=["Time", "UnitID", "UnitLongitude", "UnitLatitude"]).merge(
            assigned[["MissionID", "UnitID"]].drop_duplicates(), on="UnitID"
        )
        pos["_in"] = False
        for mid, line in geos.items():
            idx = pos.index[pos["MissionID"] == mid]
            if len(idx):
                pos.loc[idx, "_in"] = [
                    _dist_to_line(a, b, line) < corridor_deg for a, b in zip(pos.loc[idx, "UnitLongitude"], pos.loc[idx, "UnitLatitude"])
                ]
        for (mid, uid), g in pos[pos["_in"]].groupby(["MissionID", "UnitID"]):
            s = g.set_index("Time").resample("5s").size()
            s = s[s > 0]
            if len(s) > 0:
                unit_series[(mid, uid)] = s

    names_dict = (
        units.drop_duplicates("UnitID").set_index("UnitID")["UnitName"].to_dict()
        if not units.empty and {"UnitID", "UnitName"}.issubset(units.columns)
        else {}
    )
    uside_col = "UnitSide" if not units.empty and "UnitSide" in units.columns else ("Side" if not units.empty and "Side" in units.columns else None)
    sides_dict = (
        units.drop_duplicates("UnitID").set_index("UnitID")[uside_col].to_dict()
        if uside_col and "UnitID" in units.columns
        else {}
    )
    rows = []
    for (mid, uid), s in unit_series.items():
        uname = names_dict.get(uid, uid)
        if pd.isna(uname):
            uname = uid
        mside = side_by_mid.get(mid, "未知")
        if mside == "未知" or pd.isna(mside):
            mside = sides_dict.get(uid, "未知")
            if pd.isna(mside):
                mside = "未知"
        rows.append({
            "单元ID": str(uid),
            "单元名": str(uname),
            "所属任务ID": str(mid),
            "任务名": str(name_by_mid.get(mid, mid)),
            "进入阵位时间": s.first_valid_index(),
            "离开阵位时间": s.last_valid_index(),
            "保持阵位秒数": float(len(s) * 5.0),
            "损失": bool(uid in lost),
            "分方": str(mside),
        })
    output_df = pd.DataFrame(rows)[COLS] if rows else pd.DataFrame(columns=COLS)

for c in ["进入阵位时间", "离开阵位时间"]:
    output_df[c] = pd.to_datetime(output_df[c], errors="coerce").dt.strftime("%Y-%m-%d %H:%M:%S").fillna("")
`.trim(),
  },

  // 1.3.2 单支援任务指标
  {
    id: 'support.single_mission_metrics',
    name: '单支援任务指标',
    chapter: 1,
    category: 'compliance',
    militaryLevel: 'MOE',
    domainTag: 'c2',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '统计单支援任务在航线走廊（距离 < corridorDeg）的 5s 在勤时长 (N*5)、投入/战损单元，并按参数化阈值判定保持时间比与完成比。',
    requiredTables: [
      'MissionChanged',
      'MissionRefPointRelationChanged',
      'MissionUnitRelationChanged',
      'UnitPositions',
    ],
    optionalTables: ['Losses'],
    tableColumns: {
      MissionChanged: ['MissionID', 'MissionName', 'Side', 'UnitSide', 'SubClass', 'MissionClass'],
      MissionRefPointRelationChanged: ['MissionID', 'Type', 'Longitude', 'Latitude'],
      MissionUnitRelationChanged: ['MissionID', 'UnitID', 'Type'],
      UnitPositions: ['Time', 'UnitID', 'UnitLongitude', 'UnitLatitude'],
      Losses: ['SubjectID'],
    },
    parameterPorts: [
      {
        key: 'minOnStationSec',
        label: '保持阵位时间不小于 (秒)',
        dataType: 'number',
        defaultValue: 1800.0,
        description: '判定支援任务达标的最低走廊在勤秒数',
      },
      {
        key: 'maxLosses',
        label: '损失容忍上限 (损失 <= 阈值)',
        dataType: 'number',
        defaultValue: 1,
        description: '判定支援任务达标的最大可接受战损单元数量',
      },
      {
        key: 'corridorDeg',
        label: '航线走廊容限 (度)',
        dataType: 'number',
        defaultValue: 0.5,
        description: '位置点到支援航线折线的最短欧氏距离严格小于该容限（度）',
      },
    ],
    outputColumns: [
      '任务ID',
      '任务名',
      '分方',
      '子类型',
      '投入单元',
      '损失单元',
      '保持阵位秒数',
      '保持阵位时间不小于',
      '损失小于',
      '保持时间比',
      '完成比',
    ],
    pythonCode: `
import pandas as pd
import numpy as np
import math

def _dist_to_line(x, y, coords):
    best = float("inf")
    for i in range(len(coords) - 1):
        x1, y1 = coords[i]
        x2, y2 = coords[i + 1]
        dx, dy = x2 - x1, y2 - y1
        den = dx * dx + dy * dy
        t = 0.0 if den == 0 else max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / den))
        best = min(best, math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)))
    return best

min_on_station_sec = float(params.get("minOnStationSec", 1800.0))
max_losses = int(params.get("maxLosses", 1))
corridor_deg = float(params.get("corridorDeg", 0.5))

missions = T("MissionChanged")
refpoints = T("MissionRefPointRelationChanged")
rels = T("MissionUnitRelationChanged")
positions = T("UnitPositions")
losses = T("Losses")

COLS = ["任务ID", "任务名", "分方", "子类型", "投入单元", "损失单元", "保持阵位秒数", "保持阵位时间不小于", "损失小于", "保持时间比", "完成比"]

if missions.empty or "MissionID" not in missions.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    has_ref = set(refpoints["MissionID"].dropna()) if not refpoints.empty and "MissionID" in refpoints.columns else set()
    sel = missions.loc[
        (C(missions, "MissionClass", "").fillna("").astype(str) == "Support") & missions["MissionID"].isin(has_ref)
    ].drop_duplicates("MissionID").copy()
    if sel.empty:
        output_df = pd.DataFrame(columns=COLS)
    else:
        geos = {}
        if not refpoints.empty and {"MissionID", "Type", "Longitude", "Latitude"}.issubset(refpoints.columns):
            for mid, g in refpoints.loc[C(refpoints, "Type", "").astype(str) == "NavigationCourse"].groupby("MissionID", sort=False):
                pts = [
                    (float(a), float(b))
                    for a, b in zip(pd.to_numeric(g["Longitude"], errors="coerce"), pd.to_numeric(g["Latitude"], errors="coerce"))
                    if pd.notna(a) and pd.notna(b)
                ]
                if len(pts) >= 2:
                    geos[mid] = pts
                elif len(pts) == 1:
                    geos[mid] = [pts[0], pts[0]]

        rel_ok = not rels.empty and {"MissionID", "UnitID", "Type"}.issubset(rels.columns)
        assigned = (
            rels.loc[rels["Type"].astype(str) == "Assigned", ["MissionID", "UnitID"]].merge(sel[["MissionID"]], on="MissionID")
            if rel_ok
            else pd.DataFrame(columns=["MissionID", "UnitID"])
        )
        lost = set(losses["SubjectID"].dropna()) if not losses.empty and "SubjectID" in losses.columns else set()

        seconds = {}
        if not assigned.empty and not positions.empty and {"Time", "UnitID", "UnitLongitude", "UnitLatitude"}.issubset(positions.columns):
            pos = positions[["Time", "UnitID", "UnitLongitude", "UnitLatitude"]].copy()
            pos["Time"] = pd.to_datetime(pos["Time"], errors="coerce")
            for c in ["UnitLongitude", "UnitLatitude"]:
                pos[c] = pd.to_numeric(pos[c], errors="coerce")
            pos = pos.dropna(subset=["Time", "UnitID", "UnitLongitude", "UnitLatitude"]).merge(
                assigned[["MissionID", "UnitID"]].drop_duplicates(), on="UnitID"
            )
            pos["_in"] = False
            for mid, line in geos.items():
                idx = pos.index[pos["MissionID"] == mid]
                if len(idx):
                    pos.loc[idx, "_in"] = [
                        _dist_to_line(a, b, line) < corridor_deg for a, b in zip(pos.loc[idx, "UnitLongitude"], pos.loc[idx, "UnitLatitude"])
                    ]
            by_mid = {}
            for (mid, uid), g in pos[pos["_in"]].groupby(["MissionID", "UnitID"]):
                by_mid.setdefault(mid, []).append(g.set_index("Time").resample("5s").size().rename(str(uid)))
            for mid, ss in by_mid.items():
                seconds[mid] = float(int((pd.concat(ss, axis=1).fillna(0).sum(axis=1) > 0).sum()) * 5.0)

        assigned_cnt = assigned.groupby("MissionID").size() if not assigned.empty else pd.Series(dtype=int)
        loss_cnt = assigned[assigned["UnitID"].isin(lost)].groupby("MissionID").size() if not assigned.empty else pd.Series(dtype=int)

        records = []
        for _, row in sel.iterrows():
            mid = row["MissionID"]
            sec = float(seconds.get(mid, 0.0))
            loss_n = int(loss_cnt.get(mid, 0))
            ratio = 1.0 if min_on_station_sec <= 0 else min(1.0, sec / min_on_station_sec)
            done = 1.0 if sec >= min_on_station_sec and loss_n <= max_losses else 0.0
            mname = row["MissionName"] if "MissionName" in sel.columns and pd.notna(row["MissionName"]) else mid
            if "UnitSide" in sel.columns and pd.notna(row["UnitSide"]):
                mside = row["UnitSide"]
            elif "Side" in sel.columns and pd.notna(row["Side"]):
                mside = row["Side"]
            else:
                mside = "未知"
            msub = row["SubClass"] if "SubClass" in sel.columns and pd.notna(row["SubClass"]) else "Support"
            records.append({
                "任务ID": str(mid),
                "任务名": str(mname),
                "分方": str(mside),
                "子类型": str(msub),
                "投入单元": int(assigned_cnt.get(mid, 0)),
                "损失单元": loss_n,
                "保持阵位秒数": sec,
                "保持阵位时间不小于": min_on_station_sec,
                "损失小于": max_losses,
                "保持时间比": float(ratio),
                "完成比": float(done),
            })
        output_df = pd.DataFrame(records)[COLS]
`.trim(),
  },

  // 1.3.3 多支援任务综合指标
  {
    id: 'support.composite_mission_metrics',
    name: '多支援任务综合指标',
    chapter: 1,
    category: 'compliance',
    militaryLevel: 'MOFE',
    domainTag: 'c2',
    layer: 'legacy_aggregate',
    engineKind: 'python_script',
    description:
      '基于单支援任务指标（或原始底层表独立重算），按分方聚合平均完成比、平均支援时长、平均战损单元数量与平均指派单元数量。',
    upstreamOperatorId: 'support.single_mission_metrics',
    requiredTables: [
      'MissionChanged',
      'MissionRefPointRelationChanged',
      'MissionUnitRelationChanged',
      'UnitPositions',
    ],
    optionalTables: ['Losses'],
    tableColumns: {
      MissionChanged: ['MissionID', 'MissionName', 'Side', 'UnitSide', 'SubClass', 'MissionClass'],
      MissionRefPointRelationChanged: ['MissionID', 'Type', 'Longitude', 'Latitude'],
      MissionUnitRelationChanged: ['MissionID', 'UnitID', 'Type'],
      UnitPositions: ['Time', 'UnitID', 'UnitLongitude', 'UnitLatitude'],
      Losses: ['SubjectID'],
    },
    parameterPorts: [
      {
        key: 'minOnStationSec',
        label: '保持阵位时间不小于 (秒)',
        dataType: 'number',
        defaultValue: 1800.0,
        description: '独立重算单支援任务时的最低走廊在勤秒数',
      },
      {
        key: 'maxLosses',
        label: '损失容忍上限 (损失 <= 阈值)',
        dataType: 'number',
        defaultValue: 1,
        description: '独立重算单支援任务时的最大可接受战损单元数量',
      },
      {
        key: 'corridorDeg',
        label: '航线走廊容限 (度)',
        dataType: 'number',
        defaultValue: 0.5,
        description: '独立重算单支援任务时的航线走廊容限（度）',
      },
    ],
    outputColumns: ['分方', '平均完成比', '平均支援时长', '平均战损单元数量', '平均指派单元数量'],
    pythonCode: `
import pandas as pd
import numpy as np
import math

def _dist_to_line(x, y, coords):
    best = float("inf")
    for i in range(len(coords) - 1):
        x1, y1 = coords[i]
        x2, y2 = coords[i + 1]
        dx, dy = x2 - x1, y2 - y1
        den = dx * dx + dy * dy
        t = 0.0 if den == 0 else max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / den))
        best = min(best, math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)))
    return best

min_on_station_sec = float(params.get("minOnStationSec", 1800.0))
max_losses = int(params.get("maxLosses", 1))
corridor_deg = float(params.get("corridorDeg", 0.5))
COLS = ["分方", "平均完成比", "平均支援时长", "平均战损单元数量", "平均指派单元数量"]

base = prev_output_df if isinstance(prev_output_df, pd.DataFrame) and not prev_output_df.empty else None
if base is None or not {"分方", "完成比", "保持阵位秒数", "损失单元", "投入单元"}.issubset(base.columns):
    missions = T("MissionChanged")
    refpoints = T("MissionRefPointRelationChanged")
    rels = T("MissionUnitRelationChanged")
    positions = T("UnitPositions")
    losses = T("Losses")
    if missions.empty or "MissionID" not in missions.columns:
        base = pd.DataFrame(columns=["分方", "完成比", "保持阵位秒数", "损失单元", "投入单元"])
    else:
        has_ref = set(refpoints["MissionID"].dropna()) if not refpoints.empty and "MissionID" in refpoints.columns else set()
        sel = missions.loc[
            (C(missions, "MissionClass", "").fillna("").astype(str) == "Support") & missions["MissionID"].isin(has_ref)
        ].drop_duplicates("MissionID").copy()
        if sel.empty:
            base = pd.DataFrame(columns=["分方", "完成比", "保持阵位秒数", "损失单元", "投入单元"])
        else:
            geos = {}
            if not refpoints.empty and {"MissionID", "Type", "Longitude", "Latitude"}.issubset(refpoints.columns):
                for mid, g in refpoints.loc[C(refpoints, "Type", "").astype(str) == "NavigationCourse"].groupby("MissionID", sort=False):
                    pts = [
                        (float(a), float(b))
                        for a, b in zip(pd.to_numeric(g["Longitude"], errors="coerce"), pd.to_numeric(g["Latitude"], errors="coerce"))
                        if pd.notna(a) and pd.notna(b)
                    ]
                    if len(pts) >= 2:
                        geos[mid] = pts
                    elif len(pts) == 1:
                        geos[mid] = [pts[0], pts[0]]

            rel_ok = not rels.empty and {"MissionID", "UnitID", "Type"}.issubset(rels.columns)
            assigned = (
                rels.loc[rels["Type"].astype(str) == "Assigned", ["MissionID", "UnitID"]].merge(sel[["MissionID"]], on="MissionID")
                if rel_ok
                else pd.DataFrame(columns=["MissionID", "UnitID"])
            )
            lost = set(losses["SubjectID"].dropna()) if not losses.empty and "SubjectID" in losses.columns else set()
            seconds = {}
            if not assigned.empty and not positions.empty and {"Time", "UnitID", "UnitLongitude", "UnitLatitude"}.issubset(positions.columns):
                pos = positions[["Time", "UnitID", "UnitLongitude", "UnitLatitude"]].copy()
                pos["Time"] = pd.to_datetime(pos["Time"], errors="coerce")
                for c in ["UnitLongitude", "UnitLatitude"]:
                    pos[c] = pd.to_numeric(pos[c], errors="coerce")
                pos = pos.dropna(subset=["Time", "UnitID", "UnitLongitude", "UnitLatitude"]).merge(
                    assigned[["MissionID", "UnitID"]].drop_duplicates(), on="UnitID"
                )
                pos["_in"] = False
                for mid, line in geos.items():
                    idx = pos.index[pos["MissionID"] == mid]
                    if len(idx):
                        pos.loc[idx, "_in"] = [
                            _dist_to_line(a, b, line) < corridor_deg for a, b in zip(pos.loc[idx, "UnitLongitude"], pos.loc[idx, "UnitLatitude"])
                        ]
                by_mid = {}
                for (mid, uid), g in pos[pos["_in"]].groupby(["MissionID", "UnitID"]):
                    by_mid.setdefault(mid, []).append(g.set_index("Time").resample("5s").size().rename(str(uid)))
                for mid, ss in by_mid.items():
                    seconds[mid] = float(int((pd.concat(ss, axis=1).fillna(0).sum(axis=1) > 0).sum()) * 5.0)

            acnt = assigned.groupby("MissionID").size() if not assigned.empty else pd.Series(dtype=int)
            lcnt = assigned[assigned["UnitID"].isin(lost)].groupby("MissionID").size() if not assigned.empty else pd.Series(dtype=int)
            if "UnitSide" in sel.columns and sel["UnitSide"].notna().any():
                side_ser = sel["UnitSide"].fillna(C(sel, "Side", "未知")).fillna("未知").astype(str)
            elif "Side" in sel.columns:
                side_ser = sel["Side"].fillna("未知").astype(str)
            else:
                side_ser = pd.Series("未知", index=sel.index, dtype="object")

            base = pd.DataFrame({
                "分方": side_ser.values,
                "完成比": [
                    1.0 if float(seconds.get(m, 0.0)) >= min_on_station_sec and int(lcnt.get(m, 0)) <= max_losses else 0.0
                    for m in sel["MissionID"]
                ],
                "保持阵位秒数": [float(seconds.get(m, 0.0)) for m in sel["MissionID"]],
                "损失单元": [int(lcnt.get(m, 0)) for m in sel["MissionID"]],
                "投入单元": [int(acnt.get(m, 0)) for m in sel["MissionID"]],
            })

if base is None or base.empty or "分方" not in base.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    g = base.copy()
    for c in ["完成比", "保持阵位秒数", "损失单元", "投入单元"]:
        g[c] = pd.to_numeric(g[c] if c in g.columns else 0.0, errors="coerce").fillna(0.0)
    out = g.groupby("分方", dropna=False).agg(
        平均完成比=("完成比", "mean"),
        平均支援时长=("保持阵位秒数", "mean"),
        平均战损单元数量=("损失单元", "mean"),
        平均指派单元数量=("投入单元", "mean"),
    ).reset_index()
    output_df = out[COLS]
`.trim(),
  },

  // =========================================================================
  // 第 2 章：装备效能（2.1 探测效能 · 2.2 火控效能 · 2.3 武器效能）— 13 项
  // =========================================================================

  // 2.1.1 单元探测
  {
    id: 'detection.unit_detection',
    name: '单元探测',
    chapter: 2,
    category: 'effectiveness',
    militaryLevel: 'MOP',
    domainTag: 'isr',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '通过 EngagementCycle 内连接还原探测目标，过滤探测状态（排除 Unknown），按 (Time, 平台, 目标, 传感器) 四键分组求平均水平发现距离，并补充探测平台型号与分方。',
    requiredTables: ['DetectionIdentificationChanged', 'EngagementCycle'],
    optionalTables: ['UnitCreated'],
    tableColumns: {
      DetectionIdentificationChanged: [
        'ContactID',
        'ContactName',
        'Time',
        'IdentificationStatus',
        'SensorName',
        'SensorPlatformName',
        'SensorPlatformID',
        'SensorPlatformDBName',
        'SensorPlatformClass',
        'SensorPlatformSide',
        'Side',
        'ContactRangeHoriz_nm',
        'ContactRangeSlant_nm',
        'ContactActualUnitID',
        'ContactActualName',
      ],
      EngagementCycle: ['ContactID', 'ContactActualUnitID', 'ContactActualUnitName'],
      UnitCreated: ['UnitID', 'UnitName', 'UnitClass', 'UnitSide', 'Side'],
    },
    parameterPorts: [],
    outputColumns: ['探测平台', '探测目标', '首次发现距离', '探测传感器', '探测平台型号', '分方'],
    pythonCode: `
import pandas as pd
import numpy as np

def _pick(df, names, default="未知"):
    for n in names:
        if n in df.columns and df[n].notna().any():
            return df[n].fillna(default).astype(str)
    return pd.Series(default, index=df.index, dtype="object")

DET_STATUS = {"KnownDomain", "KnownType", "KnownClass", "PreciseID"}
det = T("DetectionIdentificationChanged")
eng = T("EngagementCycle")
units = T("UnitCreated")
COLS = ["探测平台", "探测目标", "首次发现距离", "探测传感器", "探测平台型号", "分方"]

if det.empty or "ContactID" not in det.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    df = det.copy()
    if "ContactActualUnitID" not in df.columns:
        if not eng.empty and {"ContactID", "ContactActualUnitID"}.issubset(eng.columns):
            ecols = ["ContactID", "ContactActualUnitID"] + (["ContactActualUnitName"] if "ContactActualUnitName" in eng.columns else [])
            cmap = eng[ecols].dropna(subset=["ContactID", "ContactActualUnitID"]).drop_duplicates("ContactID")
            df = df.merge(cmap, on="ContactID", how="inner")
        else:
            df = df.iloc[0:0]

    if not df.empty and "Time" in df.columns:
        df["Time"] = pd.to_datetime(df["Time"], errors="coerce")

    keep = C(df, "IdentificationStatus", "").astype(str).isin(DET_STATUS) if "IdentificationStatus" in df.columns else pd.Series(True, index=df.index)
    df = df.loc[keep].copy()
    if df.empty:
        output_df = pd.DataFrame(columns=COLS)
    else:
        uinfo = units.drop_duplicates("UnitID").set_index("UnitID") if not units.empty and "UnitID" in units.columns else pd.DataFrame()
        unit_names = uinfo["UnitName"] if "UnitName" in uinfo.columns else pd.Series(dtype="object")
        unit_classes = uinfo["UnitClass"] if "UnitClass" in uinfo.columns else pd.Series(dtype="object")
        uside_col = "UnitSide" if "UnitSide" in uinfo.columns else ("Side" if "Side" in uinfo.columns else None)
        unit_sides = uinfo[uside_col] if uside_col else pd.Series(dtype="object")

        target_name = _pick(df, ["ContactActualName", "ContactActualUnitName", "ContactName"], default="未知目标")
        if "ContactActualName" not in df.columns and "ContactActualUnitID" in df.columns and len(unit_names):
            mapped = df["ContactActualUnitID"].map(unit_names)
            target_name = mapped.fillna(target_name).astype(str)

        df["_p"] = _pick(df, ["SensorPlatformName", "SensorPlatformID"], default="未知平台")
        df["_t"] = target_name
        df["_s"] = _pick(df, ["SensorName"], default="未知传感器")
        df["_time"] = df["Time"] if "Time" in df.columns else pd.NaT
        dcol = next((c for c in ["ContactRangeHoriz_nm", "ContactRangeSlant_nm", "Range"] if c in df.columns), None)
        df["_d"] = pd.to_numeric(df[dcol], errors="coerce") if dcol else np.nan

        if "SensorPlatformDBName" in df.columns and df["SensorPlatformDBName"].notna().any():
            df["_pm"] = df["SensorPlatformDBName"].fillna("未知型号").astype(str)
        elif "SensorPlatformClass" in df.columns and df["SensorPlatformClass"].notna().any():
            df["_pm"] = df["SensorPlatformClass"].fillna("未知型号").astype(str)
        elif "SensorPlatformID" in df.columns and len(unit_classes):
            df["_pm"] = df["SensorPlatformID"].map(unit_classes).fillna("未知型号").astype(str)
        else:
            df["_pm"] = "未知型号"

        if "SensorPlatformSide" in df.columns and df["SensorPlatformSide"].notna().any():
            df["_side"] = df["SensorPlatformSide"].fillna("未知").astype(str)
        elif "Side" in df.columns and df["Side"].notna().any():
            df["_side"] = df["Side"].fillna("未知").astype(str)
        elif "SensorPlatformID" in df.columns and len(unit_sides):
            df["_side"] = df["SensorPlatformID"].map(unit_sides).fillna("未知").astype(str)
        else:
            df["_side"] = "未知"

        grp = df.groupby(["_time", "_p", "_t", "_s"], dropna=False, sort=False).agg(
            {"_d": "mean", "_pm": "first", "_side": "first"}
        ).reset_index()
        output_df = pd.DataFrame({
            "探测平台": grp["_p"].astype(str),
            "探测目标": grp["_t"].astype(str),
            "首次发现距离": grp["_d"].round(2),
            "探测传感器": grp["_s"].astype(str),
            "探测平台型号": grp["_pm"].astype(str),
            "分方": grp["_side"].astype(str),
        })[COLS]
`.trim(),
  },

  // 2.1.2 型号探测
  {
    id: 'detection.model_detection',
    name: '型号探测',
    chapter: 2,
    category: 'effectiveness',
    militaryLevel: 'MOP',
    domainTag: 'isr',
    layer: 'legacy_aggregate',
    engineKind: 'python_script',
    description:
      '按 (探测平台型号, 探测目标型号) 聚合探测事件，缺失派生型号列时回退至 UnitCreated.UnitClass 映射，计算平均首次发现距离。',
    requiredTables: ['DetectionIdentificationChanged', 'EngagementCycle', 'UnitCreated'],
    optionalTables: [],
    tableColumns: {
      DetectionIdentificationChanged: [
        'ContactID',
        'IdentificationStatus',
        'SensorPlatformID',
        'ContactRangeHoriz_nm',
        'ContactRangeSlant_nm',
        'ContactActualUnitID',
        'SensorPlatformDBName',
        'SensorPlatformClass',
        'ContactActualDBName',
        'ContactActualUnitClass',
      ],
      EngagementCycle: ['ContactID', 'ContactActualUnitID', 'ContactActualUnitClass'],
      UnitCreated: ['UnitID', 'UnitClass'],
    },
    parameterPorts: [],
    outputColumns: ['探测平台型号', '探测目标型号', '平均首次发现距离'],
    pythonCode: `
import pandas as pd
import numpy as np

DET_STATUS = {"KnownDomain", "KnownType", "KnownClass", "PreciseID"}
det = T("DetectionIdentificationChanged")
eng = T("EngagementCycle")
units = T("UnitCreated")
COLS = ["探测平台型号", "探测目标型号", "平均首次发现距离"]

if det.empty or "ContactID" not in det.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    df = det.copy()
    if "ContactActualUnitID" not in df.columns:
        if not eng.empty and {"ContactID", "ContactActualUnitID"}.issubset(eng.columns):
            ecols = ["ContactID", "ContactActualUnitID"] + (["ContactActualUnitClass"] if "ContactActualUnitClass" in eng.columns else [])
            cmap = eng[ecols].dropna(subset=["ContactID", "ContactActualUnitID"]).drop_duplicates("ContactID")
            df = df.merge(cmap, on="ContactID", how="inner")
        else:
            df = df.iloc[0:0]

    keep = C(df, "IdentificationStatus", "").astype(str).isin(DET_STATUS) if "IdentificationStatus" in df.columns else pd.Series(True, index=df.index)
    df = df.loc[keep].copy()
    if df.empty:
        output_df = pd.DataFrame(columns=COLS)
    else:
        uinfo = units.drop_duplicates("UnitID").set_index("UnitID") if not units.empty and "UnitID" in units.columns else pd.DataFrame()

        def _model(col_names, id_col):
            for n in col_names:
                if n in df.columns and df[n].notna().any():
                    return df[n].fillna("未知型号").astype(str)
            if id_col in df.columns and "UnitClass" in uinfo.columns:
                return df[id_col].map(uinfo["UnitClass"]).fillna("未知型号").astype(str)
            return pd.Series("未知型号", index=df.index, dtype="object")

        df["_pm"] = _model(["SensorPlatformDBName", "SensorPlatformClass"], "SensorPlatformID")
        df["_tm"] = _model(["ContactActualDBName", "ContactActualUnitClass"], "ContactActualUnitID")
        dcol = next((c for c in ["ContactRangeHoriz_nm", "ContactRangeSlant_nm", "Range"] if c in df.columns), None)
        df["_d"] = pd.to_numeric(df[dcol], errors="coerce") if dcol else np.nan

        grp = df.groupby(["_pm", "_tm"], dropna=False).agg({"_d": "mean"}).reset_index()
        output_df = pd.DataFrame({
            "探测平台型号": grp["_pm"].astype(str),
            "探测目标型号": grp["_tm"].astype(str),
            "平均首次发现距离": grp["_d"].round(2),
        })[COLS]
`.trim(),
  },

  // 2.2.1 单元识别
  {
    id: 'fire_control.unit_identification',
    name: '单元识别',
    chapter: 2,
    category: 'effectiveness',
    militaryLevel: 'MOP',
    domainTag: 'isr',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '筛选确切识别状态 (KnownClass / PreciseID)，通过 EngagementCycle 内连接并按 (Time, 平台, 目标, 传感器) 分组统计识别距离均值，补充识别平台型号与分方。',
    requiredTables: ['DetectionIdentificationChanged', 'EngagementCycle'],
    optionalTables: ['UnitCreated'],
    tableColumns: {
      DetectionIdentificationChanged: [
        'ContactID',
        'ContactName',
        'Time',
        'IdentificationStatus',
        'SensorName',
        'SensorPlatformName',
        'SensorPlatformID',
        'SensorPlatformDBName',
        'SensorPlatformClass',
        'SensorPlatformSide',
        'Side',
        'ContactRangeHoriz_nm',
        'ContactRangeSlant_nm',
        'ContactActualUnitID',
        'ContactActualName',
      ],
      EngagementCycle: ['ContactID', 'ContactActualUnitID', 'ContactActualUnitName'],
      UnitCreated: ['UnitID', 'UnitName', 'UnitClass', 'UnitSide', 'Side'],
    },
    parameterPorts: [],
    outputColumns: ['识别平台', '识别目标', '首次识别距离', '识别传感器', '识别平台型号', '分方'],
    pythonCode: `
import pandas as pd
import numpy as np

def _pick(df, names, default="未知"):
    for n in names:
        if n in df.columns and df[n].notna().any():
            return df[n].fillna(default).astype(str)
    return pd.Series(default, index=df.index, dtype="object")

IDT_STATUS = {"KnownClass", "PreciseID"}
det = T("DetectionIdentificationChanged")
eng = T("EngagementCycle")
units = T("UnitCreated")
COLS = ["识别平台", "识别目标", "首次识别距离", "识别传感器", "识别平台型号", "分方"]

if det.empty or "ContactID" not in det.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    df = det.copy()
    if "ContactActualUnitID" not in df.columns:
        if not eng.empty and {"ContactID", "ContactActualUnitID"}.issubset(eng.columns):
            ecols = ["ContactID", "ContactActualUnitID"] + (["ContactActualUnitName"] if "ContactActualUnitName" in eng.columns else [])
            cmap = eng[ecols].dropna(subset=["ContactID", "ContactActualUnitID"]).drop_duplicates("ContactID")
            df = df.merge(cmap, on="ContactID", how="inner")
        else:
            df = df.iloc[0:0]

    if not df.empty and "Time" in df.columns:
        df["Time"] = pd.to_datetime(df["Time"], errors="coerce")

    keep = C(df, "IdentificationStatus", "").astype(str).isin(IDT_STATUS) if "IdentificationStatus" in df.columns else pd.Series(True, index=df.index)
    df = df.loc[keep].copy()
    if df.empty:
        output_df = pd.DataFrame(columns=COLS)
    else:
        uinfo = units.drop_duplicates("UnitID").set_index("UnitID") if not units.empty and "UnitID" in units.columns else pd.DataFrame()
        unit_names = uinfo["UnitName"] if "UnitName" in uinfo.columns else pd.Series(dtype="object")
        unit_classes = uinfo["UnitClass"] if "UnitClass" in uinfo.columns else pd.Series(dtype="object")
        uside_col = "UnitSide" if "UnitSide" in uinfo.columns else ("Side" if "Side" in uinfo.columns else None)
        unit_sides = uinfo[uside_col] if uside_col else pd.Series(dtype="object")

        target_name = _pick(df, ["ContactActualName", "ContactActualUnitName", "ContactName"], default="未知目标")
        if "ContactActualName" not in df.columns and "ContactActualUnitID" in df.columns and len(unit_names):
            target_name = df["ContactActualUnitID"].map(unit_names).fillna(target_name).astype(str)

        df["_p"] = _pick(df, ["SensorPlatformName", "SensorPlatformID"], default="未知平台")
        df["_t"] = target_name
        df["_s"] = _pick(df, ["SensorName"], default="未知传感器")
        df["_time"] = df["Time"] if "Time" in df.columns else pd.NaT
        dcol = next((c for c in ["ContactRangeHoriz_nm", "ContactRangeSlant_nm", "Range"] if c in df.columns), None)
        df["_d"] = pd.to_numeric(df[dcol], errors="coerce") if dcol else np.nan

        if "SensorPlatformDBName" in df.columns and df["SensorPlatformDBName"].notna().any():
            df["_pm"] = df["SensorPlatformDBName"].fillna("未知型号").astype(str)
        elif "SensorPlatformClass" in df.columns and df["SensorPlatformClass"].notna().any():
            df["_pm"] = df["SensorPlatformClass"].fillna("未知型号").astype(str)
        elif "SensorPlatformID" in df.columns and len(unit_classes):
            df["_pm"] = df["SensorPlatformID"].map(unit_classes).fillna("未知型号").astype(str)
        else:
            df["_pm"] = "未知型号"

        if "SensorPlatformSide" in df.columns and df["SensorPlatformSide"].notna().any():
            df["_side"] = df["SensorPlatformSide"].fillna("未知").astype(str)
        elif "Side" in df.columns and df["Side"].notna().any():
            df["_side"] = df["Side"].fillna("未知").astype(str)
        elif "SensorPlatformID" in df.columns and len(unit_sides):
            df["_side"] = df["SensorPlatformID"].map(unit_sides).fillna("未知").astype(str)
        else:
            df["_side"] = "未知"

        grp = df.groupby(["_time", "_p", "_t", "_s"], dropna=False, sort=False).agg(
            {"_d": "mean", "_pm": "first", "_side": "first"}
        ).reset_index()
        output_df = pd.DataFrame({
            "识别平台": grp["_p"].astype(str),
            "识别目标": grp["_t"].astype(str),
            "首次识别距离": grp["_d"].round(2),
            "识别传感器": grp["_s"].astype(str),
            "识别平台型号": grp["_pm"].astype(str),
            "分方": grp["_side"].astype(str),
        })[COLS]
`.trim(),
  },

  // 2.2.2 型号识别
  {
    id: 'fire_control.model_identification',
    name: '型号识别',
    chapter: 2,
    category: 'effectiveness',
    militaryLevel: 'MOP',
    domainTag: 'isr',
    layer: 'legacy_aggregate',
    engineKind: 'python_script',
    description:
      '筛选 KnownClass / PreciseID 识别事件，按 (识别平台型号, 识别目标型号) 聚合平均首次识别距离。',
    requiredTables: ['DetectionIdentificationChanged', 'EngagementCycle', 'UnitCreated'],
    optionalTables: [],
    tableColumns: {
      DetectionIdentificationChanged: [
        'ContactID',
        'IdentificationStatus',
        'SensorPlatformID',
        'ContactRangeHoriz_nm',
        'ContactRangeSlant_nm',
        'ContactActualUnitID',
        'SensorPlatformDBName',
        'SensorPlatformClass',
        'ContactActualDBName',
        'ContactActualUnitClass',
      ],
      EngagementCycle: ['ContactID', 'ContactActualUnitID', 'ContactActualUnitClass'],
      UnitCreated: ['UnitID', 'UnitClass'],
    },
    parameterPorts: [],
    outputColumns: ['识别平台型号', '识别目标型号', '平均首次识别距离'],
    pythonCode: `
import pandas as pd
import numpy as np

IDT_STATUS = {"KnownClass", "PreciseID"}
det = T("DetectionIdentificationChanged")
eng = T("EngagementCycle")
units = T("UnitCreated")
COLS = ["识别平台型号", "识别目标型号", "平均首次识别距离"]

if det.empty or "ContactID" not in det.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    df = det.copy()
    if "ContactActualUnitID" not in df.columns:
        if not eng.empty and {"ContactID", "ContactActualUnitID"}.issubset(eng.columns):
            ecols = ["ContactID", "ContactActualUnitID"] + (["ContactActualUnitClass"] if "ContactActualUnitClass" in eng.columns else [])
            cmap = eng[ecols].dropna(subset=["ContactID", "ContactActualUnitID"]).drop_duplicates("ContactID")
            df = df.merge(cmap, on="ContactID", how="inner")
        else:
            df = df.iloc[0:0]

    keep = C(df, "IdentificationStatus", "").astype(str).isin(IDT_STATUS) if "IdentificationStatus" in df.columns else pd.Series(True, index=df.index)
    df = df.loc[keep].copy()
    if df.empty:
        output_df = pd.DataFrame(columns=COLS)
    else:
        uinfo = units.drop_duplicates("UnitID").set_index("UnitID") if not units.empty and "UnitID" in units.columns else pd.DataFrame()

        def _model(col_names, id_col):
            for n in col_names:
                if n in df.columns and df[n].notna().any():
                    return df[n].fillna("未知型号").astype(str)
            if id_col in df.columns and "UnitClass" in uinfo.columns:
                return df[id_col].map(uinfo["UnitClass"]).fillna("未知型号").astype(str)
            return pd.Series("未知型号", index=df.index, dtype="object")

        df["_pm"] = _model(["SensorPlatformDBName", "SensorPlatformClass"], "SensorPlatformID")
        df["_tm"] = _model(["ContactActualDBName", "ContactActualUnitClass"], "ContactActualUnitID")
        dcol = next((c for c in ["ContactRangeHoriz_nm", "ContactRangeSlant_nm", "Range"] if c in df.columns), None)
        df["_d"] = pd.to_numeric(df[dcol], errors="coerce") if dcol else np.nan

        grp = df.groupby(["_pm", "_tm"], dropna=False).agg({"_d": "mean"}).reset_index()
        output_df = pd.DataFrame({
            "识别平台型号": grp["_pm"].astype(str),
            "识别目标型号": grp["_tm"].astype(str),
            "平均首次识别距离": grp["_d"].round(2),
        })[COLS]
`.trim(),
  },

  // 2.2.3 单元杀伤链闭环
  {
    id: 'fire_control.unit_kill_chain_closure',
    name: '单元杀伤链闭环',
    chapter: 2,
    category: 'time',
    militaryLevel: 'MOP',
    domainTag: 'synergy',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '以 UnitCreated 全量单元为底表，左连接发现/识别/齐射/毁伤四节点（不按时间排序直接首行归并，发现晚于或缺失时以识别回填），计算杀伤闭环总时长与闭环标记。',
    requiredTables: ['UnitCreated', 'DetectionIdentificationChanged', 'EngagementCycle'],
    optionalTables: ['WeaponFired', 'UnitDestroyed', 'WeaponEndgame'],
    tableColumns: {
      UnitCreated: ['UnitID', 'UnitName', 'UnitClass', 'UnitSide', 'Side'],
      DetectionIdentificationChanged: [
        'ContactID',
        'Time',
        'IdentificationStatus',
        'SensorPlatformID',
        'SensorPlatformName',
        'ContactActualUnitID',
      ],
      EngagementCycle: ['ContactID', 'ContactActualUnitID', 'UnitSide'],
      WeaponFired: [
        'Time',
        'TargetContactActualUnitID',
        'TargetID',
        'FiringUnitName',
        'FiringUnitID',
        'FiringUnitSide',
      ],
      UnitDestroyed: ['UnitID', 'Time'],
      WeaponEndgame: ['TargetID', 'Result', 'WeaponName'],
    },
    parameterPorts: [],
    outputColumns: [
      '目标ID',
      '目标名',
      '目标型号',
      '分方',
      '发现时间',
      '识别时间',
      '齐射时间',
      '毁伤时间',
      '杀伤闭环总时长',
      '是否闭环',
      '发现平台',
      '识别平台',
      '齐射单元',
      '致命武器',
    ],
    pythonCode: `
import pandas as pd
import numpy as np

def _first_series(df, key, time_col="Time"):
    if df.empty or key not in df.columns or time_col not in df.columns:
        return pd.Series(dtype="datetime64[ns]", name=time_col)
    d = df.copy()
    d[time_col] = pd.to_datetime(d[time_col], errors="coerce")
    return d.groupby(key, sort=False)[time_col].first().rename_axis("UnitID")

DET_STATUS = {"KnownDomain", "KnownType", "KnownClass", "PreciseID"}
IDT_STATUS = {"KnownClass", "PreciseID"}
det = T("DetectionIdentificationChanged")
eng = T("EngagementCycle")
fired = T("WeaponFired")
destroyed = T("UnitDestroyed")
endgame = T("WeaponEndgame")
units = T("UnitCreated")

COLS = ["目标ID", "目标名", "目标型号", "分方", "发现时间", "识别时间", "齐射时间", "毁伤时间", "杀伤闭环总时长", "是否闭环", "发现平台", "识别平台", "齐射单元", "致命武器"]

info = units.drop_duplicates("UnitID").set_index("UnitID") if not units.empty and "UnitID" in units.columns else pd.DataFrame()
uside_col = "UnitSide" if "UnitSide" in info.columns else ("Side" if "Side" in info.columns else None)
u_side_map = info[uside_col] if uside_col else pd.Series(dtype="object")

if not det.empty and "ContactID" in det.columns:
    d = det.copy()
    if "ContactActualUnitID" not in d.columns:
        if not eng.empty and {"ContactID", "ContactActualUnitID"}.issubset(eng.columns):
            ecols = ["ContactID", "ContactActualUnitID"] + (["UnitSide"] if "UnitSide" in eng.columns else [])
            cmap = eng[ecols].dropna(subset=["ContactID", "ContactActualUnitID"]).drop_duplicates("ContactID")
            d = d.merge(cmap, on="ContactID", how="inner")
        else:
            d = d.iloc[0:0]
    if not d.empty and "Time" in d.columns:
        d["Time"] = pd.to_datetime(d["Time"], errors="coerce")
    if not d.empty:
        if "SensorPlatformID" in d.columns and len(u_side_map):
            d["_exec_side"] = d["SensorPlatformID"].map(u_side_map)
        elif "UnitSide" in d.columns:
            d["_exec_side"] = d["UnitSide"]
        else:
            d["_exec_side"] = np.nan
    d_status = C(d, "IdentificationStatus", "").astype(str) if "IdentificationStatus" in d.columns else pd.Series("KnownClass", index=d.index)
    d_det = d.loc[d_status.isin(DET_STATUS)]
    d_idt = d.loc[d_status.isin(IDT_STATUS)]
    t_det = _first_series(d_det, "ContactActualUnitID").rename("DetectionTime")
    t_idt = _first_series(d_idt, "ContactActualUnitID").rename("IdentificationTime")
    det_node = (
        d_det.groupby("ContactActualUnitID", sort=False).first()["SensorPlatformName"].rename("发现平台")
        if not d_det.empty and "ContactActualUnitID" in d_det.columns and "SensorPlatformName" in d_det.columns
        else pd.Series(dtype="object", name="发现平台")
    )
    idt_node = (
        d_idt.groupby("ContactActualUnitID", sort=False).first()["SensorPlatformName"].rename("识别平台")
        if not d_idt.empty and "ContactActualUnitID" in d_idt.columns and "SensorPlatformName" in d_idt.columns
        else pd.Series(dtype="object", name="识别平台")
    )
    det_side = (
        d_det.groupby("ContactActualUnitID", sort=False).first()["_exec_side"].rename("DetExecSide")
        if not d_det.empty and "ContactActualUnitID" in d_det.columns and "_exec_side" in d_det.columns
        else pd.Series(dtype="object", name="DetExecSide")
    )
    idt_side = (
        d_idt.groupby("ContactActualUnitID", sort=False).first()["_exec_side"].rename("IdtExecSide")
        if not d_idt.empty and "ContactActualUnitID" in d_idt.columns and "_exec_side" in d_idt.columns
        else pd.Series(dtype="object", name="IdtExecSide")
    )
else:
    t_det = pd.Series(dtype="datetime64[ns]", name="DetectionTime")
    t_idt = pd.Series(dtype="datetime64[ns]", name="IdentificationTime")
    det_node = pd.Series(dtype="object", name="发现平台")
    idt_node = pd.Series(dtype="object", name="识别平台")
    det_side = pd.Series(dtype="object", name="DetExecSide")
    idt_side = pd.Series(dtype="object", name="IdtExecSide")

fkey = "TargetContactActualUnitID" if not fired.empty and "TargetContactActualUnitID" in fired.columns else ("TargetID" if not fired.empty and "TargetID" in fired.columns else None)
t_fire = _first_series(fired, fkey).rename("FiringTime") if fkey else pd.Series(dtype="datetime64[ns]", name="FiringTime")
fire_node = (
    fired.groupby(fkey, sort=False).first()["FiringUnitName"].rename("齐射单元")
    if fkey and "FiringUnitName" in fired.columns
    else pd.Series(dtype="object", name="齐射单元")
)
if fkey and "FiringUnitSide" in fired.columns:
    fire_side = fired.groupby(fkey, sort=False).first()["FiringUnitSide"].rename("FireExecSide")
elif fkey and "FiringUnitID" in fired.columns and len(u_side_map):
    fire_side = fired.assign(_fs=fired["FiringUnitID"].map(u_side_map)).groupby(fkey, sort=False).first()["_fs"].rename("FireExecSide")
else:
    fire_side = pd.Series(dtype="object", name="FireExecSide")
t_dest = _first_series(destroyed, "UnitID").rename("DestroyedTime") if not destroyed.empty and "UnitID" in destroyed.columns else pd.Series(dtype="datetime64[ns]", name="DestroyedTime")
if not endgame.empty and {"TargetID", "Result"}.issubset(endgame.columns) and "WeaponName" in endgame.columns:
    weapon_node = endgame.loc[endgame["Result"].astype(str) == "KILL"].groupby("TargetID", sort=False).first()["WeaponName"].rename("致命武器")
else:
    weapon_node = pd.Series(dtype="object", name="致命武器")

ids = []
if not units.empty and "UnitID" in units.columns:
    ids.extend(units["UnitID"].dropna().tolist())
for ser in [t_det, t_idt, t_fire, t_dest]:
    ids.extend(list(ser.index))
ids = list(dict.fromkeys(ids))

if not ids:
    output_df = pd.DataFrame(columns=COLS)
else:
    chain = pd.DataFrame(index=pd.Index(ids, name="UnitID"))
    for ser in [t_det, t_idt, t_fire, t_dest, det_node, idt_node, fire_node, weapon_node, det_side, idt_side, fire_side]:
        if len(ser):
            chain = chain.join(ser, how="left")
    for col in ["DetectionTime", "IdentificationTime", "FiringTime", "DestroyedTime"]:
        if col not in chain.columns:
            chain[col] = pd.NaT
        chain[col] = pd.to_datetime(chain[col], errors="coerce")
    for col in ["发现平台", "识别平台", "齐射单元", "致命武器", "DetExecSide", "IdtExecSide", "FireExecSide"]:
        if col not in chain.columns:
            chain[col] = np.nan

    fix_mask = chain["DetectionTime"].isna() | (chain["DetectionTime"] > chain["IdentificationTime"])
    chain.loc[fix_mask, "DetectionTime"] = chain.loc[fix_mask, "IdentificationTime"]
    chain.loc[fix_mask, "发现平台"] = chain.loc[fix_mask, "识别平台"]

    chain["杀伤闭环总时长"] = (chain["DestroyedTime"] - chain["DetectionTime"]).dt.total_seconds()
    chain["是否闭环"] = chain["杀伤闭环总时长"].notna()

    def _attr(col_candidates, default_val):
        fb = pd.Series(default_val, index=chain.index)
        for col in col_candidates:
            if col in info.columns:
                s = pd.Series(chain.index.map(info[col]), index=chain.index)
                return s.fillna(fb)
        return fb

    exec_side_ser = chain["FireExecSide"].fillna(chain["DetExecSide"]).fillna(chain["IdtExecSide"])
    target_side_ser = _attr(["UnitSide", "Side"], "未知")

    chain["目标ID"] = chain.index.astype(str)
    chain["目标名"] = _attr(["UnitName"], chain.index.astype(str)).astype(str)
    chain["目标型号"] = _attr(["UnitClass"], "未知型号").astype(str)
    chain["分方"] = exec_side_ser.fillna(target_side_ser).fillna("未知").astype(str)
    chain["发现时间"] = chain["DetectionTime"]
    chain["识别时间"] = chain["IdentificationTime"]
    chain["齐射时间"] = chain["FiringTime"]
    chain["毁伤时间"] = chain["DestroyedTime"]
    output_df = chain.reset_index(drop=True)[COLS]

    for c in ["发现时间", "识别时间", "齐射时间", "毁伤时间"]:
        output_df[c] = pd.to_datetime(output_df[c], errors="coerce").dt.strftime("%Y-%m-%d %H:%M:%S").fillna("")
`.trim(),
  },

  // 2.2.4 型号杀伤链闭环时间
  {
    id: 'fire_control.model_kill_chain_closure_time',
    name: '型号杀伤链闭环时间',
    chapter: 2,
    category: 'time',
    militaryLevel: 'MOE',
    domainTag: 'synergy',
    layer: 'legacy_aggregate',
    engineKind: 'python_script',
    description:
      '基于单元杀伤链闭环宽表（或原始表独立重算），筛出已闭环目标并按目标型号聚合数量、平均时间、最长与最短时间。',
    upstreamOperatorId: 'fire_control.unit_kill_chain_closure',
    requiredTables: ['UnitCreated', 'DetectionIdentificationChanged', 'EngagementCycle'],
    optionalTables: ['UnitDestroyed'],
    tableColumns: {
      UnitCreated: ['UnitID', 'UnitClass'],
      DetectionIdentificationChanged: ['ContactID', 'Time', 'IdentificationStatus', 'ContactActualUnitID'],
      EngagementCycle: ['ContactID', 'ContactActualUnitID'],
      UnitDestroyed: ['UnitID', 'Time'],
    },
    parameterPorts: [],
    outputColumns: ['型号', '数量', '平均时间', '最长时间', '最短时间'],
    pythonCode: `
import pandas as pd
import numpy as np

COLS = ["型号", "数量", "平均时间", "最长时间", "最短时间"]
base = prev_output_df if isinstance(prev_output_df, pd.DataFrame) and not prev_output_df.empty else None

if base is None or not {"目标型号", "杀伤闭环总时长"}.issubset(base.columns):
    det = T("DetectionIdentificationChanged")
    eng = T("EngagementCycle")
    destroyed = T("UnitDestroyed")
    units = T("UnitCreated")

    if not det.empty and "ContactID" in det.columns and "Time" in det.columns:
        d = det.copy()
        if "ContactActualUnitID" not in d.columns:
            if not eng.empty and {"ContactID", "ContactActualUnitID"}.issubset(eng.columns):
                cmap = eng[["ContactID", "ContactActualUnitID"]].dropna().drop_duplicates("ContactID")
                d = d.merge(cmap, on="ContactID", how="inner")
            else:
                d = d.iloc[0:0]
        if not d.empty:
            d["Time"] = pd.to_datetime(d["Time"], errors="coerce")
            st = C(d, "IdentificationStatus", "").astype(str) if "IdentificationStatus" in d.columns else pd.Series("KnownClass", index=d.index)
            t_det = d.loc[st.isin({"KnownDomain", "KnownType", "KnownClass", "PreciseID"})].groupby("ContactActualUnitID", sort=False)["Time"].first()
            t_idt = d.loc[st.isin({"KnownClass", "PreciseID"})].groupby("ContactActualUnitID", sort=False)["Time"].first()
        else:
            t_det = pd.Series(dtype="datetime64[ns]")
            t_idt = pd.Series(dtype="datetime64[ns]")
    else:
        t_det = pd.Series(dtype="datetime64[ns]")
        t_idt = pd.Series(dtype="datetime64[ns]")

    if not destroyed.empty and {"UnitID", "Time"}.issubset(destroyed.columns):
        ud = destroyed.copy()
        ud["Time"] = pd.to_datetime(ud["Time"], errors="coerce")
        t_dest = ud.groupby("UnitID", sort=False)["Time"].first()
    else:
        t_dest = pd.Series(dtype="datetime64[ns]")

    ids = list(dict.fromkeys(list(t_det.index) + list(t_idt.index) + list(t_dest.index)))
    if not ids:
        base = pd.DataFrame(columns=["目标型号", "杀伤闭环总时长"])
    else:
        chain = pd.DataFrame(index=pd.Index(ids, name="UnitID"))
        chain["DetectionTime"] = pd.to_datetime(t_det.reindex(ids), errors="coerce")
        chain["IdentificationTime"] = pd.to_datetime(t_idt.reindex(ids), errors="coerce")
        chain["DestroyedTime"] = pd.to_datetime(t_dest.reindex(ids), errors="coerce")
        fix_mask = chain["DetectionTime"].isna() | (chain["DetectionTime"] > chain["IdentificationTime"])
        chain.loc[fix_mask, "DetectionTime"] = chain.loc[fix_mask, "IdentificationTime"]
        chain["杀伤闭环总时长"] = (chain["DestroyedTime"] - chain["DetectionTime"]).dt.total_seconds()

        info = units.drop_duplicates("UnitID").set_index("UnitID") if not units.empty and "UnitID" in units.columns else pd.DataFrame()
        cls = pd.Series(chain.index.map(info["UnitClass"]), index=chain.index) if "UnitClass" in info.columns else pd.Series("未知型号", index=chain.index)
        base = pd.DataFrame({"目标型号": cls.fillna("未知型号").astype(str), "杀伤闭环总时长": chain["杀伤闭环总时长"]})

if base is None or base.empty:
    output_df = pd.DataFrame(columns=COLS)
else:
    g = base.copy()
    g["杀伤闭环总时长"] = pd.to_numeric(g["杀伤闭环总时长"], errors="coerce")
    closed = g[g["杀伤闭环总时长"].notna()].copy()
    if closed.empty:
        output_df = pd.DataFrame(columns=COLS)
    else:
        closed["型号"] = C(closed, "目标型号", "未知型号").fillna("未知型号").astype(str)
        out = closed.groupby("型号", dropna=False).agg(
            数量=("杀伤闭环总时长", "size"),
            平均时间=("杀伤闭环总时长", "mean"),
            最长时间=("杀伤闭环总时长", "max"),
            最短时间=("杀伤闭环总时长", "min"),
        ).reset_index()
        out["数量"] = out["数量"].astype(int)
        output_df = out[COLS]
`.trim(),
  },

  // 2.3.1 平台发射情况
  {
    id: 'weapon.platform_launch_status',
    name: '平台发射情况',
    chapter: 2,
    category: 'effectiveness',
    militaryLevel: 'MOP',
    domainTag: 'firepower',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '按 (分方, 发射单元, 武器型号) 统计弹药发射数量与平台自身毁伤状态（同时兼容名称与 UnitID 匹配，武器名回退剥离 " #序号"）。',
    requiredTables: ['WeaponFired'],
    optionalTables: ['UnitDestroyed'],
    tableColumns: {
      WeaponFired: [
        'FiringUnitSide',
        'UnitSide',
        'Side',
        'FiringUnitName',
        'FiringUnitID',
        'WeaponClass',
        'WeaponType',
        'WeaponName',
      ],
      UnitDestroyed: ['UnitID', 'UnitName'],
    },
    parameterPorts: [],
    outputColumns: ['分方', '发射单元', '武器型号', '发射数量', '自身毁伤'],
    pythonCode: `
import pandas as pd
import numpy as np
import re

def _pick(df, names, default="未知"):
    for n in names:
        if n in df.columns and df[n].notna().any():
            return df[n].fillna(default).astype(str)
    return pd.Series(default, index=df.index, dtype="object")

def _strip_serial(s):
    return re.sub(r"\\s+#\\d+$", "", str(s)).strip()

fired = T("WeaponFired")
destroyed = T("UnitDestroyed")
COLS = ["分方", "发射单元", "武器型号", "发射数量", "自身毁伤"]

if fired.empty:
    output_df = pd.DataFrame(columns=COLS)
else:
    df = fired.copy()
    df["_side"] = _pick(df, ["FiringUnitSide", "UnitSide", "Side"], default="未知")
    df["_unit"] = _pick(df, ["FiringUnitName", "FiringUnitID"], default="未知平台")
    if "WeaponClass" in df.columns and df["WeaponClass"].notna().any():
        df["_wpn"] = df["WeaponClass"].fillna("未知型号").astype(str)
    elif "WeaponType" in df.columns and df["WeaponType"].notna().any():
        df["_wpn"] = df["WeaponType"].fillna("未知型号").astype(str)
    elif "WeaponName" in df.columns and df["WeaponName"].notna().any():
        df["_wpn"] = df["WeaponName"].fillna("未知型号").map(_strip_serial)
    else:
        df["_wpn"] = "未知型号"

    lost_names = set(destroyed["UnitName"].dropna().astype(str)) if not destroyed.empty and "UnitName" in destroyed.columns else set()
    lost_ids = set(destroyed["UnitID"].dropna().astype(str)) if not destroyed.empty and "UnitID" in destroyed.columns else set()
    is_lost = pd.Series(False, index=df.index)
    if lost_names and "FiringUnitName" in df.columns:
        is_lost = is_lost | df["FiringUnitName"].astype(str).isin(lost_names)
    if lost_ids and "FiringUnitID" in df.columns:
        is_lost = is_lost | df["FiringUnitID"].astype(str).isin(lost_ids)
    df["_lost"] = is_lost.astype(int)

    grp = df.groupby(["_side", "_unit", "_wpn"], dropna=False).agg(
        发射数量=("_wpn", "size"),
        自身毁伤=("_lost", "max"),
    ).reset_index()
    output_df = pd.DataFrame({
        "分方": grp["_side"].astype(str),
        "发射单元": grp["_unit"].astype(str),
        "武器型号": grp["_wpn"].astype(str),
        "发射数量": grp["发射数量"].astype(int),
        "自身毁伤": grp["自身毁伤"].astype(int),
    })[COLS]
`.trim(),
  },

  // 2.3.2 平台发射指标
  {
    id: 'weapon.platform_launch_metrics',
    name: '平台发射指标',
    chapter: 2,
    category: 'effectiveness',
    militaryLevel: 'MOP',
    domainTag: 'firepower',
    layer: 'legacy_aggregate',
    engineKind: 'python_script',
    description:
      '按发射记录行加权统计分方×平台型号的自身单元生存概率，以及按分方×平台型号×武器型号统计发射总数量。',
    requiredTables: ['WeaponFired'],
    optionalTables: ['UnitDestroyed'],
    tableColumns: {
      WeaponFired: [
        'FiringUnitSide',
        'UnitSide',
        'Side',
        'FiringUnitClass',
        'FiringUnitDBID',
        'FiringUnitName',
        'FiringUnitID',
        'WeaponClass',
        'WeaponType',
        'WeaponName',
      ],
      UnitDestroyed: ['UnitID', 'UnitName'],
    },
    parameterPorts: [],
    outputColumns: ['分方', '平台型号', '武器型号', '自身单元生存概率', '发射总数量'],
    pythonCode: `
import pandas as pd
import numpy as np
import re

def _pick(df, names, default="未知"):
    for n in names:
        if n in df.columns and df[n].notna().any():
            return df[n].fillna(default).astype(str)
    return pd.Series(default, index=df.index, dtype="object")

def _strip_serial(s):
    return re.sub(r"\\s+#\\d+$", "", str(s)).strip()

fired = T("WeaponFired")
destroyed = T("UnitDestroyed")
COLS = ["分方", "平台型号", "武器型号", "自身单元生存概率", "发射总数量"]

if fired.empty:
    output_df = pd.DataFrame(columns=COLS)
else:
    df = fired.copy()
    df["_side"] = _pick(df, ["FiringUnitSide", "UnitSide", "Side"], default="未知")
    df["_class"] = _pick(df, ["FiringUnitClass", "FiringUnitDBID"], default="未知型号")
    if "WeaponClass" in df.columns and df["WeaponClass"].notna().any():
        df["_wpn"] = df["WeaponClass"].fillna("未知型号").astype(str)
    elif "WeaponType" in df.columns and df["WeaponType"].notna().any():
        df["_wpn"] = df["WeaponType"].fillna("未知型号").astype(str)
    elif "WeaponName" in df.columns and df["WeaponName"].notna().any():
        df["_wpn"] = df["WeaponName"].fillna("未知型号").map(_strip_serial)
    else:
        df["_wpn"] = "未知型号"

    lost_names = set(destroyed["UnitName"].dropna().astype(str)) if not destroyed.empty and "UnitName" in destroyed.columns else set()
    lost_ids = set(destroyed["UnitID"].dropna().astype(str)) if not destroyed.empty and "UnitID" in destroyed.columns else set()
    is_lost = pd.Series(False, index=df.index)
    if lost_names and "FiringUnitName" in df.columns:
        is_lost = is_lost | df["FiringUnitName"].astype(str).isin(lost_names)
    if lost_ids and "FiringUnitID" in df.columns:
        is_lost = is_lost | df["FiringUnitID"].astype(str).isin(lost_ids)
    df["_alive"] = (~is_lost).astype(float)

    survive = df.groupby(["_side", "_class"], dropna=False)["_alive"].mean().rename("自身单元生存概率")
    counts = df.groupby(["_side", "_class", "_wpn"], dropna=False).size().rename("发射总数量").reset_index()
    out = counts.merge(survive.reset_index(), on=["_side", "_class"], how="left")
    output_df = pd.DataFrame({
        "分方": out["_side"].astype(str),
        "平台型号": out["_class"].astype(str),
        "武器型号": out["_wpn"].astype(str),
        "自身单元生存概率": out["自身单元生存概率"].round(4),
        "发射总数量": out["发射总数量"].astype(int),
    })[COLS]
`.trim(),
  },

  // 2.3.3 弹药打击情况
  {
    id: 'weapon.munition_engagement_status',
    name: '弹药打击情况',
    chapter: 2,
    category: 'effectiveness',
    militaryLevel: 'MOP',
    domainTag: 'firepower',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '对 WeaponEndgame 按 WeaponID 归并去重并剔除 "No point defence systems employed" 虚构行，输出单枚弹药的飞行时间、发射距离及命中/被拦截/自毁/故障/未命中五态与发射分方。',
    requiredTables: ['WeaponFired', 'WeaponEndgame'],
    optionalTables: ['UnitDestroyed', 'UnitCreated'],
    tableColumns: {
      WeaponFired: [
        'WeaponID',
        'WeaponName',
        'WeaponClass',
        'WeaponType',
        'FiringUnitName',
        'FiringUnitID',
        'FiringUnitSide',
        'UnitSide',
        'Side',
        'TargetContactActualUnitName',
        'TargetContactActualUnitID',
        'TargetID',
        'TargetContactRangeHoriz_nm',
        'TargetContactRangeSlant_nm',
        'Range',
        'Time',
      ],
      WeaponEndgame: ['WeaponID', 'TargetID', 'Result', 'EndgameMessage'],
      UnitDestroyed: ['UnitID', 'Time', 'Cause'],
      UnitCreated: ['UnitID', 'UnitSide', 'Side'],
    },
    parameterPorts: [],
    outputColumns: [
      '武器ID',
      '武器名',
      '武器型号',
      '发射单元',
      '目标单元',
      '飞行时间',
      '发射距离',
      '命中',
      '被拦截',
      '自毁',
      '故障',
      '未命中',
      '发射分方',
    ],
    pythonCode: `
import pandas as pd
import numpy as np
import re

def _pick(df, names, default="未知"):
    for n in names:
        if n in df.columns and df[n].notna().any():
            return df[n].fillna(default).astype(str)
    return pd.Series(default, index=df.index, dtype="object")

def _strip_serial(s):
    return re.sub(r"\\s+#\\d+$", "", str(s)).strip()

def _dedup_endgame(eg):
    if eg.empty:
        return eg
    d = eg.copy()
    if "EndgameMessage" in d.columns:
        msg_l = d["EndgameMessage"].fillna("").astype(str).str.lower()
        d = d[~msg_l.str.contains("no point defence systems employed", na=False)].copy()
    if d.empty or "WeaponID" not in d.columns:
        return d
    rank_map = {"KILL": 5, "HIT": 4, "POINTDEF:SUCCESS": 3, "MISS": 2, "UNDEFINED": 1, "POINTDEF:FAILURE": 0}
    d["_rk"] = C(d, "Result", "").astype(str).str.strip().str.upper().map(rank_map).fillna(0)
    d = d.sort_values("_rk", ascending=False, kind="mergesort").drop_duplicates("WeaponID", keep="first")
    return d.drop(columns=["_rk"])

fired = T("WeaponFired")
endgame = _dedup_endgame(T("WeaponEndgame"))
destroyed = T("UnitDestroyed")
units = T("UnitCreated")
COLS = ["武器ID", "武器名", "武器型号", "发射单元", "目标单元", "飞行时间", "发射距离", "命中", "被拦截", "自毁", "故障", "未命中", "发射分方"]

if fired.empty:
    output_df = pd.DataFrame(columns=COLS)
else:
    df = fired.copy()
    if "WeaponID" not in df.columns:
        df["WeaponID"] = df.index.astype(str)
    fired_ids = set(df["WeaponID"].dropna().astype(str))

    res_s = C(endgame, "Result", "").astype(str).str.strip().str.upper() if not endgame.empty else pd.Series(dtype=str)
    msg_s = C(endgame, "EndgameMessage", "").astype(str) if not endgame.empty else pd.Series(dtype=str)
    cause_s = C(destroyed, "Cause", "").astype(str) if not destroyed.empty else pd.Series(dtype=str)

    hit_ids = set(endgame.loc[res_s.isin(["KILL", "HIT"]), "WeaponID"].dropna().astype(str)) if not endgame.empty and "WeaponID" in endgame.columns else set()
    inter_ids = set()
    if not endgame.empty:
        if "TargetID" in endgame.columns:
            inter_ids.update(endgame.loc[res_s == "KILL", "TargetID"].dropna().astype(str))
            pd_rows = endgame.loc[res_s == "POINTDEF:SUCCESS"]
            for _, er in pd_rows.iterrows():
                tid = str(er["TargetID"]) if "TargetID" in pd_rows.columns and pd.notna(er["TargetID"]) else ""
                wid = str(er["WeaponID"]) if "WeaponID" in pd_rows.columns and pd.notna(er["WeaponID"]) else ""
                if tid and tid in fired_ids:
                    inter_ids.add(tid)
                elif wid:
                    inter_ids.add(wid)
        elif "WeaponID" in endgame.columns:
            inter_ids.update(endgame.loc[res_s == "POINTDEF:SUCCESS", "WeaponID"].dropna().astype(str))

    malf_ids = set(endgame.loc[msg_s.str.contains("故障|Failure", na=False), "WeaponID"].dropna().astype(str)) if not endgame.empty and "WeaponID" in endgame.columns else set()
    self_ids = set(destroyed.loc[cause_s.isin(["-", "Script"]), "UnitID"].dropna().astype(str)) if not destroyed.empty and "UnitID" in destroyed.columns else set()

    w_str = df["WeaponID"].astype(str)
    df["命中"] = w_str.isin(hit_ids)
    df["被拦截"] = w_str.isin(inter_ids)
    df["自毁"] = w_str.isin(self_ids)
    df["故障"] = w_str.isin(malf_ids)
    df["未命中"] = ~(df["命中"] | df["被拦截"] | df["自毁"] | df["故障"])

    dest_time = pd.Series(dtype="datetime64[ns]")
    if not destroyed.empty and {"UnitID", "Time"}.issubset(destroyed.columns):
        dest_time = pd.to_datetime(destroyed["Time"], errors="coerce").groupby(destroyed["UnitID"].astype(str)).first()
    if "Time" in df.columns:
        launch = pd.to_datetime(df["Time"], errors="coerce")
        df["飞行时间"] = (w_str.map(dest_time) - launch).dt.total_seconds()
    else:
        df["飞行时间"] = np.nan

    dcol = next((c for c in ["TargetContactRangeHoriz_nm", "TargetContactRangeSlant_nm", "Range"] if c in df.columns), None)
    df["发射距离"] = pd.to_numeric(df[dcol], errors="coerce") if dcol else np.nan
    if "WeaponClass" in df.columns and df["WeaponClass"].notna().any():
        w_model = df["WeaponClass"].fillna("未知型号").astype(str)
    elif "WeaponType" in df.columns and df["WeaponType"].notna().any():
        w_model = df["WeaponType"].fillna("未知型号").astype(str)
    elif "WeaponName" in df.columns and df["WeaponName"].notna().any():
        w_model = df["WeaponName"].fillna("未知型号").map(_strip_serial)
    else:
        w_model = pd.Series("未知型号", index=df.index, dtype="object")

    firing_side = _pick(df, ["FiringUnitSide", "UnitSide", "Side"], default="未知")
    if (firing_side == "未知").all() and "FiringUnitID" in df.columns and not units.empty and "UnitID" in units.columns:
        uside_col = "UnitSide" if "UnitSide" in units.columns else ("Side" if "Side" in units.columns else None)
        if uside_col:
            u_side_map = units.drop_duplicates("UnitID").set_index("UnitID")[uside_col]
            firing_side = df["FiringUnitID"].map(u_side_map).fillna("未知").astype(str)

    output_df = pd.DataFrame({
        "武器ID": w_str,
        "武器名": _pick(df, ["WeaponName", "WeaponID"], default="未知武器"),
        "武器型号": w_model,
        "发射单元": _pick(df, ["FiringUnitName", "FiringUnitID"], default="未知平台"),
        "目标单元": _pick(df, ["TargetContactActualUnitName", "TargetContactActualUnitID", "TargetID"], default="未知目标"),
        "飞行时间": df["飞行时间"],
        "发射距离": df["发射距离"],
        "命中": df["命中"].astype(bool),
        "被拦截": df["被拦截"].astype(bool),
        "自毁": df["自毁"].astype(bool),
        "故障": df["故障"].astype(bool),
        "未命中": df["未命中"].astype(bool),
        "发射分方": firing_side.astype(str),
    })[COLS]
`.trim(),
  },

  // 2.3.4 弹药效能指标（按型号）
  {
    id: 'weapon.munition_effectiveness_by_model',
    name: '弹药效能指标（按型号）',
    chapter: 2,
    category: 'effectiveness',
    militaryLevel: 'MOE',
    domainTag: 'firepower',
    layer: 'legacy_aggregate',
    engineKind: 'python_script',
    description:
      '基于去重后的单发弹药五类终局状态，按 (发射分方, 武器型号) 分组计算平均飞行时间、平均发射距离、命中率、被拦截率、自毁率、故障率与未命中率。',
    requiredTables: ['WeaponFired', 'WeaponEndgame'],
    optionalTables: ['UnitDestroyed'],
    tableColumns: {
      WeaponFired: [
        'WeaponID',
        'WeaponName',
        'WeaponClass',
        'WeaponType',
        'FiringUnitSide',
        'UnitSide',
        'Side',
        'TargetContactRangeHoriz_nm',
        'TargetContactRangeSlant_nm',
        'Range',
        'Time',
      ],
      WeaponEndgame: ['WeaponID', 'TargetID', 'Result', 'EndgameMessage'],
      UnitDestroyed: ['UnitID', 'Time', 'Cause'],
    },
    parameterPorts: [],
    outputColumns: ['发射分方', '武器型号', '平均飞行时间', '平均发射距离', '命中率', '被拦截率', '自毁率', '故障率', '未命中率'],
    pythonCode: `
import pandas as pd
import numpy as np
import re

def _pick(df, names, default="未知"):
    for n in names:
        if n in df.columns and df[n].notna().any():
            return df[n].fillna(default).astype(str)
    return pd.Series(default, index=df.index, dtype="object")

def _strip_serial(s):
    return re.sub(r"\\s+#\\d+$", "", str(s)).strip()

def _dedup_endgame(eg):
    if eg.empty:
        return eg
    d = eg.copy()
    if "EndgameMessage" in d.columns:
        msg_l = d["EndgameMessage"].fillna("").astype(str).str.lower()
        d = d[~msg_l.str.contains("no point defence systems employed", na=False)].copy()
    if d.empty or "WeaponID" not in d.columns:
        return d
    rank_map = {"KILL": 5, "HIT": 4, "POINTDEF:SUCCESS": 3, "MISS": 2, "UNDEFINED": 1, "POINTDEF:FAILURE": 0}
    d["_rk"] = C(d, "Result", "").astype(str).str.strip().str.upper().map(rank_map).fillna(0)
    d = d.sort_values("_rk", ascending=False, kind="mergesort").drop_duplicates("WeaponID", keep="first")
    return d.drop(columns=["_rk"])

fired = T("WeaponFired")
endgame = _dedup_endgame(T("WeaponEndgame"))
destroyed = T("UnitDestroyed")
COLS = ["发射分方", "武器型号", "平均飞行时间", "平均发射距离", "命中率", "被拦截率", "自毁率", "故障率", "未命中率"]

if fired.empty:
    output_df = pd.DataFrame(columns=COLS)
else:
    d = fired.copy()
    if "WeaponID" not in d.columns:
        d["WeaponID"] = d.index.astype(str)
    fired_ids = set(d["WeaponID"].dropna().astype(str))
    r = C(endgame, "Result", "").astype(str).str.strip().str.upper() if not endgame.empty else pd.Series(dtype=str)
    m = C(endgame, "EndgameMessage", "").astype(str) if not endgame.empty else pd.Series(dtype=str)
    c = C(destroyed, "Cause", "").astype(str) if not destroyed.empty else pd.Series(dtype=str)

    hit_ids = set(endgame.loc[r.isin(["KILL", "HIT"]), "WeaponID"].dropna().astype(str)) if not endgame.empty and "WeaponID" in endgame.columns else set()
    inter_ids = set()
    if not endgame.empty:
        if "TargetID" in endgame.columns:
            inter_ids.update(endgame.loc[r == "KILL", "TargetID"].dropna().astype(str))
            for _, er in endgame.loc[r == "POINTDEF:SUCCESS"].iterrows():
                tid = str(er["TargetID"]) if "TargetID" in endgame.columns and pd.notna(er["TargetID"]) else ""
                wid = str(er["WeaponID"]) if "WeaponID" in endgame.columns and pd.notna(er["WeaponID"]) else ""
                if tid and tid in fired_ids:
                    inter_ids.add(tid)
                elif wid:
                    inter_ids.add(wid)
        elif "WeaponID" in endgame.columns:
            inter_ids.update(endgame.loc[r == "POINTDEF:SUCCESS", "WeaponID"].dropna().astype(str))

    w_str = d["WeaponID"].astype(str)
    d["命中"] = w_str.isin(hit_ids)
    d["被拦截"] = w_str.isin(inter_ids)
    d["自毁"] = w_str.isin(set(destroyed.loc[c.isin(["-", "Script"]), "UnitID"].dropna().astype(str)) if not destroyed.empty and "UnitID" in destroyed.columns else set())
    d["故障"] = w_str.isin(set(endgame.loc[m.str.contains("故障|Failure", na=False), "WeaponID"].dropna().astype(str)) if not endgame.empty and "WeaponID" in endgame.columns else set())
    d["未命中"] = ~(d["命中"] | d["被拦截"] | d["自毁"] | d["故障"])

    dt = pd.Series(dtype="datetime64[ns]")
    if not destroyed.empty and {"UnitID", "Time"}.issubset(destroyed.columns):
        dt = pd.to_datetime(destroyed["Time"], errors="coerce").groupby(destroyed["UnitID"].astype(str)).first()
    d["_flight"] = (w_str.map(dt) - pd.to_datetime(d["Time"], errors="coerce")).dt.total_seconds() if "Time" in d.columns else np.nan
    dcol = next((x for x in ["TargetContactRangeHoriz_nm", "TargetContactRangeSlant_nm", "Range"] if x in d.columns), None)
    d["_dist"] = pd.to_numeric(d[dcol], errors="coerce") if dcol else np.nan
    d["_side"] = _pick(d, ["FiringUnitSide", "UnitSide", "Side"], default="未知")
    if "WeaponClass" in d.columns and d["WeaponClass"].notna().any():
        d["_class"] = d["WeaponClass"].fillna("未知型号").astype(str)
    elif "WeaponType" in d.columns and d["WeaponType"].notna().any():
        d["_class"] = d["WeaponType"].fillna("未知型号").astype(str)
    elif "WeaponName" in d.columns and d["WeaponName"].notna().any():
        d["_class"] = d["WeaponName"].fillna("未知型号").map(_strip_serial)
    else:
        d["_class"] = "未知型号"

    out = d.groupby(["_side", "_class"], dropna=False).agg(
        平均飞行时间=("_flight", "mean"),
        平均发射距离=("_dist", "mean"),
        命中率=("命中", "mean"),
        被拦截率=("被拦截", "mean"),
        自毁率=("自毁", "mean"),
        故障率=("故障", "mean"),
        未命中率=("未命中", "mean"),
    ).reset_index()
    for col in ["命中率", "被拦截率", "自毁率", "故障率", "未命中率"]:
        out[col] = out[col].round(4)
    output_df = pd.DataFrame({
        "发射分方": out["_side"].astype(str),
        "武器型号": out["_class"].astype(str),
        "平均飞行时间": out["平均飞行时间"],
        "平均发射距离": out["平均发射距离"],
        "命中率": out["命中率"],
        "被拦截率": out["被拦截率"],
        "自毁率": out["自毁率"],
        "故障率": out["故障率"],
        "未命中率": out["未命中率"],
    })[COLS]
`.trim(),
  },

  // 2.3.5 弹药效能（按型号+目标）
  {
    id: 'weapon.munition_effectiveness_by_target',
    name: '弹药效能（按型号+目标）',
    chapter: 2,
    category: 'effectiveness',
    militaryLevel: 'MOE',
    domainTag: 'firepower',
    layer: 'legacy_aggregate',
    engineKind: 'python_script',
    description:
      '基于去重后的单发弹药五类终局状态，按 (发射分方, 武器型号, 目标单元ID) 细分统计平均飞行时间、距离与各终局概率。',
    requiredTables: ['WeaponFired', 'WeaponEndgame'],
    optionalTables: ['UnitDestroyed'],
    tableColumns: {
      WeaponFired: [
        'WeaponID',
        'WeaponName',
        'WeaponClass',
        'WeaponType',
        'FiringUnitSide',
        'UnitSide',
        'Side',
        'TargetContactActualUnitID',
        'TargetID',
        'TargetContactRangeHoriz_nm',
        'TargetContactRangeSlant_nm',
        'Range',
        'Time',
      ],
      WeaponEndgame: ['WeaponID', 'TargetID', 'Result', 'EndgameMessage'],
      UnitDestroyed: ['UnitID', 'Time', 'Cause'],
    },
    parameterPorts: [],
    outputColumns: ['发射分方', '武器型号', '目标单元ID', '平均飞行时间', '平均发射距离', '命中率', '被拦截率', '自毁率', '故障率', '未命中率'],
    pythonCode: `
import pandas as pd
import numpy as np
import re

def _pick(df, names, default="未知"):
    for n in names:
        if n in df.columns and df[n].notna().any():
            return df[n].fillna(default).astype(str)
    return pd.Series(default, index=df.index, dtype="object")

def _strip_serial(s):
    return re.sub(r"\\s+#\\d+$", "", str(s)).strip()

def _dedup_endgame(eg):
    if eg.empty:
        return eg
    d = eg.copy()
    if "EndgameMessage" in d.columns:
        msg_l = d["EndgameMessage"].fillna("").astype(str).str.lower()
        d = d[~msg_l.str.contains("no point defence systems employed", na=False)].copy()
    if d.empty or "WeaponID" not in d.columns:
        return d
    rank_map = {"KILL": 5, "HIT": 4, "POINTDEF:SUCCESS": 3, "MISS": 2, "UNDEFINED": 1, "POINTDEF:FAILURE": 0}
    d["_rk"] = C(d, "Result", "").astype(str).str.strip().str.upper().map(rank_map).fillna(0)
    d = d.sort_values("_rk", ascending=False, kind="mergesort").drop_duplicates("WeaponID", keep="first")
    return d.drop(columns=["_rk"])

fired = T("WeaponFired")
endgame = _dedup_endgame(T("WeaponEndgame"))
destroyed = T("UnitDestroyed")
COLS = ["发射分方", "武器型号", "目标单元ID", "平均飞行时间", "平均发射距离", "命中率", "被拦截率", "自毁率", "故障率", "未命中率"]

if fired.empty:
    output_df = pd.DataFrame(columns=COLS)
else:
    d = fired.copy()
    if "WeaponID" not in d.columns:
        d["WeaponID"] = d.index.astype(str)
    fired_ids = set(d["WeaponID"].dropna().astype(str))
    r = C(endgame, "Result", "").astype(str).str.strip().str.upper() if not endgame.empty else pd.Series(dtype=str)
    m = C(endgame, "EndgameMessage", "").astype(str) if not endgame.empty else pd.Series(dtype=str)
    c = C(destroyed, "Cause", "").astype(str) if not destroyed.empty else pd.Series(dtype=str)

    hit_ids = set(endgame.loc[r.isin(["KILL", "HIT"]), "WeaponID"].dropna().astype(str)) if not endgame.empty and "WeaponID" in endgame.columns else set()
    inter_ids = set()
    if not endgame.empty:
        if "TargetID" in endgame.columns:
            inter_ids.update(endgame.loc[r == "KILL", "TargetID"].dropna().astype(str))
            for _, er in endgame.loc[r == "POINTDEF:SUCCESS"].iterrows():
                tid = str(er["TargetID"]) if "TargetID" in endgame.columns and pd.notna(er["TargetID"]) else ""
                wid = str(er["WeaponID"]) if "WeaponID" in endgame.columns and pd.notna(er["WeaponID"]) else ""
                if tid and tid in fired_ids:
                    inter_ids.add(tid)
                elif wid:
                    inter_ids.add(wid)
        elif "WeaponID" in endgame.columns:
            inter_ids.update(endgame.loc[r == "POINTDEF:SUCCESS", "WeaponID"].dropna().astype(str))

    w_str = d["WeaponID"].astype(str)
    d["命中"] = w_str.isin(hit_ids)
    d["被拦截"] = w_str.isin(inter_ids)
    d["自毁"] = w_str.isin(set(destroyed.loc[c.isin(["-", "Script"]), "UnitID"].dropna().astype(str)) if not destroyed.empty and "UnitID" in destroyed.columns else set())
    d["故障"] = w_str.isin(set(endgame.loc[m.str.contains("故障|Failure", na=False), "WeaponID"].dropna().astype(str)) if not endgame.empty and "WeaponID" in endgame.columns else set())
    d["未命中"] = ~(d["命中"] | d["被拦截"] | d["自毁"] | d["故障"])

    dt = pd.Series(dtype="datetime64[ns]")
    if not destroyed.empty and {"UnitID", "Time"}.issubset(destroyed.columns):
        dt = pd.to_datetime(destroyed["Time"], errors="coerce").groupby(destroyed["UnitID"].astype(str)).first()
    d["_flight"] = (w_str.map(dt) - pd.to_datetime(d["Time"], errors="coerce")).dt.total_seconds() if "Time" in d.columns else np.nan
    dcol = next((x for x in ["TargetContactRangeHoriz_nm", "TargetContactRangeSlant_nm", "Range"] if x in d.columns), None)
    d["_dist"] = pd.to_numeric(d[dcol], errors="coerce") if dcol else np.nan
    d["_side"] = _pick(d, ["FiringUnitSide", "UnitSide", "Side"], default="未知")
    if "WeaponClass" in d.columns and d["WeaponClass"].notna().any():
        d["_class"] = d["WeaponClass"].fillna("未知型号").astype(str)
    elif "WeaponType" in d.columns and d["WeaponType"].notna().any():
        d["_class"] = d["WeaponType"].fillna("未知型号").astype(str)
    elif "WeaponName" in d.columns and d["WeaponName"].notna().any():
        d["_class"] = d["WeaponName"].fillna("未知型号").map(_strip_serial)
    else:
        d["_class"] = "未知型号"
    d["_target"] = _pick(d, ["TargetContactActualUnitID", "TargetID"], default="未知目标")

    out = d.groupby(["_side", "_class", "_target"], dropna=False).agg(
        平均飞行时间=("_flight", "mean"),
        平均发射距离=("_dist", "mean"),
        命中率=("命中", "mean"),
        被拦截率=("被拦截", "mean"),
        自毁率=("自毁", "mean"),
        故障率=("故障", "mean"),
        未命中率=("未命中", "mean"),
    ).reset_index()
    for col in ["命中率", "被拦截率", "自毁率", "故障率", "未命中率"]:
        out[col] = out[col].round(4)
    output_df = pd.DataFrame({
        "发射分方": out["_side"].astype(str),
        "武器型号": out["_class"].astype(str),
        "目标单元ID": out["_target"].astype(str),
        "平均飞行时间": out["平均飞行时间"],
        "平均发射距离": out["平均发射距离"],
        "命中率": out["命中率"],
        "被拦截率": out["被拦截率"],
        "自毁率": out["自毁率"],
        "故障率": out["故障率"],
        "未命中率": out["未命中率"],
    })[COLS]
`.trim(),
  },

  // 2.3.6 对地/舰穿透指标
  {
    id: 'weapon.penetration_metrics',
    name: '对地/舰穿透指标',
    chapter: 2,
    category: 'effectiveness',
    militaryLevel: 'MOE',
    domainTag: 'firepower',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '筛选瞄准 Ship/Facility/Vehicle（含中文 舰船/设施/地面单元/车辆）的弹药，按去重终局判定穿透（未拦截且未自毁），计算穿透率与穿透后命中率。',
    requiredTables: ['WeaponFired', 'WeaponEndgame', 'UnitCreated'],
    optionalTables: ['UnitDestroyed'],
    tableColumns: {
      WeaponFired: [
        'WeaponID',
        'WeaponName',
        'WeaponClass',
        'WeaponType',
        'WeaponDBID',
        'FiringUnitSide',
        'UnitSide',
        'Side',
        'TargetContactActualUnitID',
        'TargetID',
        'TargetContactActualUnitType',
      ],
      WeaponEndgame: ['WeaponID', 'TargetID', 'Result', 'EndgameMessage'],
      UnitDestroyed: ['UnitID', 'Cause'],
      UnitCreated: ['UnitID', 'UnitType'],
    },
    parameterPorts: [],
    outputColumns: ['发射分方', '武器型号', '发射数', '穿透数', '命中数', '穿透率', '穿透后命中率'],
    pythonCode: `
import pandas as pd
import numpy as np
import re

def _pick(df, names, default="未知"):
    for n in names:
        if n in df.columns and df[n].notna().any():
            return df[n].fillna(default).astype(str)
    return pd.Series(default, index=df.index, dtype="object")

def _strip_serial(s):
    return re.sub(r"\\s+#\\d+$", "", str(s)).strip()

def _dedup_endgame(eg):
    if eg.empty:
        return eg
    d = eg.copy()
    if "EndgameMessage" in d.columns:
        msg_l = d["EndgameMessage"].fillna("").astype(str).str.lower()
        d = d[~msg_l.str.contains("no point defence systems employed", na=False)].copy()
    if d.empty or "WeaponID" not in d.columns:
        return d
    rank_map = {"KILL": 5, "HIT": 4, "POINTDEF:SUCCESS": 3, "MISS": 2, "UNDEFINED": 1, "POINTDEF:FAILURE": 0}
    d["_rk"] = C(d, "Result", "").astype(str).str.strip().str.upper().map(rank_map).fillna(0)
    d = d.sort_values("_rk", ascending=False, kind="mergesort").drop_duplicates("WeaponID", keep="first")
    return d.drop(columns=["_rk"])

TARGET_TYPES = {"Ship", "Facility", "Vehicle", "LandUnit", "舰船", "设施", "地面单元", "车辆"}

fired = T("WeaponFired")
endgame = _dedup_endgame(T("WeaponEndgame"))
destroyed = T("UnitDestroyed")
units = T("UnitCreated")
COLS = ["发射分方", "武器型号", "发射数", "穿透数", "命中数", "穿透率", "穿透后命中率"]

if fired.empty:
    output_df = pd.DataFrame(columns=COLS)
else:
    d = fired.copy()
    if "WeaponID" not in d.columns:
        d["WeaponID"] = d.index.astype(str)
    fired_ids = set(d["WeaponID"].dropna().astype(str))
    r = C(endgame, "Result", "").astype(str).str.strip().str.upper() if not endgame.empty else pd.Series(dtype=str)
    c = C(destroyed, "Cause", "").astype(str) if not destroyed.empty else pd.Series(dtype=str)

    hit_ids = set(endgame.loc[r.isin(["KILL", "HIT"]), "WeaponID"].dropna().astype(str)) if not endgame.empty and "WeaponID" in endgame.columns else set()
    inter_ids = set()
    if not endgame.empty:
        if "TargetID" in endgame.columns:
            inter_ids.update(endgame.loc[r == "KILL", "TargetID"].dropna().astype(str))
            for _, er in endgame.loc[r == "POINTDEF:SUCCESS"].iterrows():
                tid = str(er["TargetID"]) if "TargetID" in endgame.columns and pd.notna(er["TargetID"]) else ""
                wid = str(er["WeaponID"]) if "WeaponID" in endgame.columns and pd.notna(er["WeaponID"]) else ""
                if tid and tid in fired_ids:
                    inter_ids.add(tid)
                elif wid:
                    inter_ids.add(wid)
        elif "WeaponID" in endgame.columns:
            inter_ids.update(endgame.loc[r == "POINTDEF:SUCCESS", "WeaponID"].dropna().astype(str))

    w_str = d["WeaponID"].astype(str)
    d["Hit"] = w_str.isin(hit_ids)
    d["Intercepted"] = w_str.isin(inter_ids)
    d["SelfDestruction"] = w_str.isin(set(destroyed.loc[c.isin(["-", "Script"]), "UnitID"].dropna().astype(str)) if not destroyed.empty and "UnitID" in destroyed.columns else set())

    tcol = "TargetContactActualUnitID" if "TargetContactActualUnitID" in d.columns else ("TargetID" if "TargetID" in d.columns else None)
    if "TargetContactActualUnitType" in d.columns and d["TargetContactActualUnitType"].notna().any():
        d["_ttype"] = d["TargetContactActualUnitType"].astype(str)
    elif tcol and not units.empty and {"UnitID", "UnitType"}.issubset(units.columns):
        tmap = units.drop_duplicates("UnitID").set_index("UnitID")["UnitType"]
        d["_ttype"] = d[tcol].map(tmap)
        d = d.dropna(subset=["_ttype"]).copy()
        d["_ttype"] = d["_ttype"].astype(str)
    else:
        d["_ttype"] = "Unknown"

    anti = d[d["_ttype"].isin(TARGET_TYPES)].copy()
    if anti.empty:
        output_df = pd.DataFrame(columns=COLS)
    else:
        anti["Penetrated"] = (~anti["Intercepted"]) & (~anti["SelfDestruction"])
        anti["_side"] = _pick(anti, ["FiringUnitSide", "UnitSide", "Side"], default="未知")
        if "WeaponClass" in anti.columns and anti["WeaponClass"].notna().any():
            anti["_class"] = anti["WeaponClass"].fillna("未知型号").astype(str)
        elif "WeaponType" in anti.columns and anti["WeaponType"].notna().any():
            anti["_class"] = anti["WeaponType"].fillna("未知型号").astype(str)
        elif "WeaponDBID" in anti.columns and anti["WeaponDBID"].notna().any():
            anti["_class"] = anti["WeaponDBID"].fillna("未知型号").astype(str)
        elif "WeaponName" in anti.columns and anti["WeaponName"].notna().any():
            anti["_class"] = anti["WeaponName"].fillna("未知型号").map(_strip_serial)
        else:
            anti["_class"] = "未知型号"

        out = anti.groupby(["_side", "_class"], dropna=False).agg(
            发射数=("WeaponID", "size"),
            穿透数=("Penetrated", "sum"),
            命中数=("Hit", "sum"),
        ).reset_index()
        out["穿透率"] = (out["穿透数"] / out["发射数"]).round(4)
        out["穿透后命中率"] = (out["命中数"] / out["穿透数"].replace(0, np.nan)).round(4)
        output_df = pd.DataFrame({
            "发射分方": out["_side"].astype(str),
            "武器型号": out["_class"].astype(str),
            "发射数": out["发射数"].astype(int),
            "穿透数": out["穿透数"].astype(int),
            "命中数": out["命中数"].astype(int),
            "穿透率": out["穿透率"],
            "穿透后命中率": out["穿透后命中率"],
        })[COLS]
`.trim(),
  },

  // 2.3.7 打击范围
  {
    id: 'weapon.engagement_range',
    name: '打击范围',
    chapter: 2,
    category: 'effectiveness',
    militaryLevel: 'MOP',
    domainTag: 'firepower',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '从 WeaponFired 提取最大水平发射距离，同时按 (分方, 型号) 型号级与分方级双口径输出打击范围（海里）。',
    requiredTables: ['WeaponFired'],
    optionalTables: [],
    tableColumns: {
      WeaponFired: [
        'FiringUnitSide',
        'UnitSide',
        'Side',
        'FiringUnitClass',
        'FiringUnitDBID',
        'TargetContactRangeHoriz_nm',
        'TargetContactRangeSlant_nm',
        'Range',
      ],
    },
    parameterPorts: [],
    outputColumns: ['统计口径', '分方', '型号', '打击范围'],
    pythonCode: `
import pandas as pd
import numpy as np

def _pick(df, names, default="未知"):
    for n in names:
        if n in df.columns and df[n].notna().any():
            return df[n].fillna(default).astype(str)
    return pd.Series(default, index=df.index, dtype="object")

fired = T("WeaponFired")
COLS = ["统计口径", "分方", "型号", "打击范围"]

if fired.empty:
    output_df = pd.DataFrame(columns=COLS)
else:
    df = fired.copy()
    df["_side"] = _pick(df, ["FiringUnitSide", "UnitSide", "Side"], default="未知")
    df["_model"] = _pick(df, ["FiringUnitClass", "FiringUnitDBID"], default="未知型号")
    dcol = next((c for c in ["TargetContactRangeHoriz_nm", "TargetContactRangeSlant_nm", "Range"] if c in df.columns), None)
    df["_dist"] = pd.to_numeric(df[dcol], errors="coerce") if dcol else np.nan

    by_class = df.groupby(["_side", "_model"], dropna=False).agg({"_dist": "max"}).reset_index()
    rows1 = pd.DataFrame({
        "统计口径": "型号级",
        "分方": by_class["_side"].astype(str),
        "型号": by_class["_model"].astype(str),
        "打击范围": by_class["_dist"].round(2),
    })
    by_side = df.groupby("_side", dropna=False).agg({"_dist": "max"}).reset_index()
    rows2 = pd.DataFrame({
        "统计口径": "分方级",
        "分方": by_side["_side"].astype(str),
        "型号": "全部",
        "打击范围": by_side["_dist"].round(2),
    })
    output_df = pd.concat([rows1, rows2], ignore_index=True)[COLS]
`.trim(),
  },

  // =========================================================================
  // 第 3 章：成本效益 — 5 项
  // =========================================================================

  // 3.1 分方消耗战损指标
  {
    id: 'cost.side_attrition_metrics',
    name: '分方消耗战损指标',
    chapter: 3,
    category: 'cost',
    militaryLevel: 'MOE',
    domainTag: 'cost',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '排除 Weapon/武器 与 Group/编组 后，按分方归集人员/成本/主战与非主战平台战损、弹药/航油消耗、各军兵种损毁数及战损率与生存率，支持可选表缺失容错。',
    requiredTables: ['UnitCreated'],
    optionalTables: ['UnitDestroyed', 'WeaponFired', 'Expenditures', 'FuelConsumed', 'SideCreated'],
    tableColumns: {
      UnitCreated: ['UnitID', 'UnitType', 'UnitSide', 'Side', 'Crew', 'Cost'],
      UnitDestroyed: ['UnitID'],
      WeaponFired: ['FiringUnitID', 'FiringUnitSide'],
      Expenditures: ['Side', 'Num'],
      FuelConsumed: ['UnitID', 'UnitSide', 'FuelType', 'FuelQuantity'],
      SideCreated: ['SideName'],
    },
    parameterPorts: [
      {
        key: 'nonMainCostThreshold',
        label: '非主战平台成本阈值 (元)',
        dataType: 'number',
        defaultValue: 70000000.0,
        description: '被毁平台成本严格小于该值时计入非主战平台损失（默认 7000 万元）',
      },
      {
        key: 'aircraftDefaultCost',
        label: '战机默认造价 (元)',
        dataType: 'number',
        defaultValue: 455000000.0,
        description: '缺 Cost 列时飞机单位默认造价（默认 4.55 亿元）',
      },
      {
        key: 'shipDefaultCost',
        label: '舰船默认造价 (元)',
        dataType: 'number',
        defaultValue: 14000000000.0,
        description: '缺 Cost 列时舰船单位默认造价（默认 140 亿元）',
      },
      {
        key: 'facilityDefaultCost',
        label: '地面设施默认造价 (元)',
        dataType: 'number',
        defaultValue: 2800000000.0,
        description: '缺 Cost 列时地面设施默认造价（默认 28 亿元）',
      },
      {
        key: 'weaponDefaultCost',
        label: '弹药默认单价 (元)',
        dataType: 'number',
        defaultValue: 7630000.0,
        description: '存活平台已发射弹药默认单价（默认 763 万元）',
      },
    ],
    outputColumns: [
      '分方',
      '人员损失',
      '成本_亿元',
      '平台损失',
      '非主战平台损失',
      '弹药消耗',
      '弹药发射',
      '航空燃油消耗',
      '飞机损失',
      '舰艇损失',
      '地面单元损失',
      '平台数',
      '战损率',
      '平台生存率',
    ],
    pythonCode: `
import pandas as pd
import numpy as np

non_main_cost = float(params.get("nonMainCostThreshold", 7.0e7))
aircraft_cost = float(params.get("aircraftDefaultCost", 4.55e8))
ship_cost = float(params.get("shipDefaultCost", 1.40e10))
facility_cost = float(params.get("facilityDefaultCost", 2.80e9))
weapon_cost = float(params.get("weaponDefaultCost", 7.63e6))

COST_BY_TYPE = {
    "Aircraft": aircraft_cost,
    "飞机": aircraft_cost,
    "Ship": ship_cost,
    "舰船": ship_cost,
    "Submarine": ship_cost,
    "潜艇": ship_cost,
    "Facility": facility_cost,
    "设施": facility_cost,
    "Satellite": facility_cost,
    "卫星": facility_cost,
    "Vehicle": 5.0e7,
    "LandUnit": 5.0e7,
    "地面单元": 5.0e7,
    "车辆": 5.0e7,
    "Weapon": weapon_cost,
    "武器": weapon_cost,
}
NON_PLATFORM_TYPES = {"Weapon", "武器", "Group", "编组"}
AIR_TYPES = {"Aircraft", "飞机"}
SHIP_TYPES = {"Ship", "舰船", "Submarine", "潜艇"}
GROUND_TYPES = {"Facility", "设施", "Vehicle", "LandUnit", "地面单元", "车辆"}

units = T("UnitCreated")
destroyed = T("UnitDestroyed")
fired = T("WeaponFired")
expenditures = T("Expenditures")
fuel = T("FuelConsumed")
sides_df = T("SideCreated")

COLS = ["分方", "人员损失", "成本_亿元", "平台损失", "非主战平台损失", "弹药消耗", "弹药发射", "航空燃油消耗", "飞机损失", "舰艇损失", "地面单元损失", "平台数", "战损率", "平台生存率"]

if units.empty or "UnitID" not in units.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    u = units.drop_duplicates("UnitID").copy()
    side_col = "UnitSide" if "UnitSide" in u.columns else ("Side" if "Side" in u.columns else None)
    if side_col is None:
        u["UnitSide"] = "未知"
        side_col = "UnitSide"
    else:
        u[side_col] = u[side_col].fillna("未知").astype(str)

    u["_type"] = C(u, "UnitType", "Unknown").fillna("Unknown").astype(str)
    u["_crew"] = pd.to_numeric(C(u, "Crew", 0), errors="coerce").fillna(0.0)
    u["_cost"] = pd.to_numeric(u["Cost"], errors="coerce") if "Cost" in u.columns else pd.Series(np.nan, index=u.index)
    u["_cost"] = u["_cost"].fillna(u["_type"].map(COST_BY_TYPE)).fillna(0.0)

    platforms = u[~u["_type"].isin(NON_PLATFORM_TYPES)].copy()
    lost_ids = set(destroyed["UnitID"].dropna()) if not destroyed.empty and "UnitID" in destroyed.columns else set()
    platforms["_destroyed"] = platforms["UnitID"].isin(lost_ids)

    ammo_cost_by_unit = pd.Series(dtype=float)
    if not fired.empty and "FiringUnitID" in fired.columns:
        ammo_cost_by_unit = fired.groupby("FiringUnitID").size().astype(float) * weapon_cost

    platforms["_crew_loss"] = np.where(platforms["_destroyed"], platforms["_crew"], 0.0)
    platforms["_platform_cost"] = np.where(platforms["_destroyed"], platforms["_cost"], 0.0)
    platforms["_weapon_cost"] = np.where(platforms["_destroyed"], 0.0, platforms["UnitID"].map(ammo_cost_by_unit).fillna(0.0))
    platforms["_introduced"] = platforms["_weapon_cost"] + platforms["_platform_cost"]

    ammo_by_side = (
        pd.to_numeric(C(expenditures, "Num", 0), errors="coerce").fillna(0.0).groupby(C(expenditures, "Side", "未知").fillna("未知").astype(str)).sum()
        if not expenditures.empty and "Side" in expenditures.columns
        else pd.Series(dtype=float)
    )
    launch_by_side = (
        fired.groupby(C(fired, "FiringUnitSide", "未知").fillna("未知").astype(str)).size()
        if not fired.empty and "FiringUnitSide" in fired.columns
        else pd.Series(dtype=float)
    )
    if not fuel.empty and "FuelQuantity" in fuel.columns:
        f = fuel.copy()
        if "FuelType" in f.columns:
            f = f[pd.to_numeric(f["FuelType"], errors="coerce") == 2001]
        if "UnitSide" not in f.columns and "UnitID" in f.columns:
            f = f.merge(u[["UnitID", side_col]].rename(columns={side_col: "UnitSide"}), on="UnitID", how="left")
        fuel_by_side = (
            pd.to_numeric(f["FuelQuantity"], errors="coerce").fillna(0.0).groupby(C(f, "UnitSide", "未知").fillna("未知").astype(str)).sum()
            if "UnitSide" in f.columns
            else pd.Series(dtype=float)
        )
    else:
        fuel_by_side = pd.Series(dtype=float)

    du = destroyed.merge(u[["UnitID", "_type"]], on="UnitID", how="inner") if not destroyed.empty and "UnitID" in destroyed.columns else pd.DataFrame(columns=["UnitID", "_type"])

    side_list = []
    if not sides_df.empty and "SideName" in sides_df.columns:
        side_list.extend(sides_df["SideName"].dropna().astype(str).tolist())
    side_list.extend(platforms[side_col].dropna().astype(str).tolist())
    side_list = list(dict.fromkeys(side_list))

    records = []
    for side in side_list:
        g = platforms[platforms[side_col] == side]
        lost = g[g["_destroyed"]]
        total = len(g)
        n_lost = len(lost)
        non_main = int((lost["_platform_cost"] < non_main_cost).sum())
        dg = du[du["UnitID"].isin(set(g["UnitID"]))] if len(du) else du
        records.append({
            "分方": side,
            "人员损失": int(round(float(g["_crew_loss"].sum()))),
            "成本_亿元": round(float(g["_introduced"].sum()) / 1.0e8, 2),
            "平台损失": n_lost,
            "非主战平台损失": non_main,
            "弹药消耗": int(ammo_by_side.get(side, 0)),
            "弹药发射": int(launch_by_side.get(side, 0)),
            "航空燃油消耗": round(float(fuel_by_side.get(side, 0.0)), 2),
            "飞机损失": int(dg["_type"].isin(AIR_TYPES).sum()) if len(dg) else 0,
            "舰艇损失": int(dg["_type"].isin(SHIP_TYPES).sum()) if len(dg) else 0,
            "地面单元损失": int(dg["_type"].isin(GROUND_TYPES).sum()) if len(dg) else 0,
            "平台数": total,
            "战损率": round(n_lost / total, 4) if total else 0.0,
            "平台生存率": round(1.0 - n_lost / total, 4) if total else 1.0,
        })
    output_df = pd.DataFrame(records)[COLS] if records else pd.DataFrame(columns=COLS)
`.trim(),
  },

  // 3.2 分方交换比指标
  {
    id: 'cost.side_exchange_ratio',
    name: '分方交换比指标',
    chapter: 3,
    category: 'cost',
    militaryLevel: 'MOFE',
    domainTag: 'cost',
    layer: 'legacy_aggregate',
    engineKind: 'python_script',
    description:
      '基于分方消耗战损表（prev_output_df 或独立全量重算），按 i<j 单向组合生成分方比 A/B（战损比=平台数比、交换比=战损率比、存活比=平台生存率比），分母为 0 置 NaN。',
    upstreamOperatorId: 'cost.side_attrition_metrics',
    requiredTables: ['UnitCreated'],
    optionalTables: ['UnitDestroyed', 'WeaponFired', 'Expenditures', 'FuelConsumed', 'SideCreated'],
    tableColumns: {
      UnitCreated: ['UnitID', 'UnitType', 'UnitSide', 'Side', 'Crew', 'Cost'],
      UnitDestroyed: ['UnitID'],
      WeaponFired: ['FiringUnitID', 'FiringUnitSide'],
      Expenditures: ['Side', 'Num'],
      FuelConsumed: ['UnitID', 'UnitSide', 'FuelType', 'FuelQuantity'],
      SideCreated: ['SideName'],
    },
    parameterPorts: [
      {
        key: 'nonMainCostThreshold',
        label: '非主战平台成本阈值 (元)',
        dataType: 'number',
        defaultValue: 70000000.0,
        description: '独立重算分方战损时非主战平台判定成本阈值（默认 7000 万元）',
      },
      {
        key: 'aircraftDefaultCost',
        label: '战机默认造价 (元)',
        dataType: 'number',
        defaultValue: 455000000.0,
        description: '独立重算时缺 Cost 列的飞机默认造价',
      },
      {
        key: 'shipDefaultCost',
        label: '舰船默认造价 (元)',
        dataType: 'number',
        defaultValue: 14000000000.0,
        description: '独立重算时缺 Cost 列的舰船默认造价',
      },
      {
        key: 'facilityDefaultCost',
        label: '地面设施默认造价 (元)',
        dataType: 'number',
        defaultValue: 2800000000.0,
        description: '独立重算时缺 Cost 列的地面设施默认造价',
      },
      {
        key: 'weaponDefaultCost',
        label: '弹药默认单价 (元)',
        dataType: 'number',
        defaultValue: 7630000.0,
        description: '独立重算时每枚已发射弹药默认单价',
      },
    ],
    outputColumns: [
      '分方比',
      '人员损失比',
      '成本比',
      '平台损失比',
      '非主战平台损失比',
      '弹药消耗比',
      '弹药发射比',
      '航空燃油消耗比',
      '飞机损失比',
      '舰艇损失比',
      '地面单元损失比',
      '战损比',
      '交换比',
      '存活比',
    ],
    pythonCode: `
import pandas as pd
import numpy as np
from itertools import combinations

NUM_COLS = ["人员损失", "成本", "平台损失", "非主战平台损失", "弹药消耗", "弹药发射", "航空燃油消耗", "飞机损失", "舰艇损失", "地面单元损失", "平台数", "战损率", "平台生存率"]
HEADERS = ["人员损失比", "成本比", "平台损失比", "非主战平台损失比", "弹药消耗比", "弹药发射比", "航空燃油消耗比", "飞机损失比", "舰艇损失比", "地面单元损失比", "战损比", "交换比", "存活比"]
COLS = ["分方比"] + HEADERS

base = prev_output_df if isinstance(prev_output_df, pd.DataFrame) and not prev_output_df.empty else None
if base is None or "分方" not in base.columns:
    non_main_cost = float(params.get("nonMainCostThreshold", 7.0e7))
    aircraft_cost = float(params.get("aircraftDefaultCost", 4.55e8))
    ship_cost = float(params.get("shipDefaultCost", 1.40e10))
    facility_cost = float(params.get("facilityDefaultCost", 2.80e9))
    weapon_cost = float(params.get("weaponDefaultCost", 7.63e6))

    COST_BY_TYPE = {
        "Aircraft": aircraft_cost, "飞机": aircraft_cost,
        "Ship": ship_cost, "舰船": ship_cost, "Submarine": ship_cost, "潜艇": ship_cost,
        "Facility": facility_cost, "设施": facility_cost, "Satellite": facility_cost, "卫星": facility_cost,
        "Vehicle": 5.0e7, "LandUnit": 5.0e7, "地面单元": 5.0e7, "车辆": 5.0e7,
        "Weapon": weapon_cost, "武器": weapon_cost,
    }
    NON_PLATFORM_TYPES = {"Weapon", "武器", "Group", "编组"}
    AIR_TYPES = {"Aircraft", "飞机"}
    SHIP_TYPES = {"Ship", "舰船", "Submarine", "潜艇"}
    GROUND_TYPES = {"Facility", "设施", "Vehicle", "LandUnit", "地面单元", "车辆"}

    units = T("UnitCreated")
    destroyed = T("UnitDestroyed")
    fired = T("WeaponFired")
    expenditures = T("Expenditures")
    fuel = T("FuelConsumed")
    sides_df = T("SideCreated")

    if units.empty or "UnitID" not in units.columns:
        base = pd.DataFrame(columns=["分方"] + NUM_COLS)
    else:
        u = units.drop_duplicates("UnitID").copy()
        side_col = "UnitSide" if "UnitSide" in u.columns else ("Side" if "Side" in u.columns else None)
        if side_col is None:
            u["UnitSide"] = "未知"
            side_col = "UnitSide"
        else:
            u[side_col] = u[side_col].fillna("未知").astype(str)
        u["_type"] = C(u, "UnitType", "Unknown").fillna("Unknown").astype(str)
        u["_crew"] = pd.to_numeric(C(u, "Crew", 0), errors="coerce").fillna(0.0)
        u["_cost"] = pd.to_numeric(u["Cost"], errors="coerce") if "Cost" in u.columns else pd.Series(np.nan, index=u.index)
        u["_cost"] = u["_cost"].fillna(u["_type"].map(COST_BY_TYPE)).fillna(0.0)

        platforms = u[~u["_type"].isin(NON_PLATFORM_TYPES)].copy()
        lost_ids = set(destroyed["UnitID"].dropna()) if not destroyed.empty and "UnitID" in destroyed.columns else set()
        platforms["_destroyed"] = platforms["UnitID"].isin(lost_ids)
        ammo_cost_by_unit = fired.groupby("FiringUnitID").size().astype(float) * weapon_cost if not fired.empty and "FiringUnitID" in fired.columns else pd.Series(dtype=float)
        platforms["_crew_loss"] = np.where(platforms["_destroyed"], platforms["_crew"], 0.0)
        platforms["_platform_cost"] = np.where(platforms["_destroyed"], platforms["_cost"], 0.0)
        platforms["_weapon_cost"] = np.where(platforms["_destroyed"], 0.0, platforms["UnitID"].map(ammo_cost_by_unit).fillna(0.0))
        platforms["_introduced"] = platforms["_weapon_cost"] + platforms["_platform_cost"]

        ammo_by_side = (
            pd.to_numeric(C(expenditures, "Num", 0), errors="coerce").fillna(0.0).groupby(C(expenditures, "Side", "未知").fillna("未知").astype(str)).sum()
            if not expenditures.empty and "Side" in expenditures.columns
            else pd.Series(dtype=float)
        )
        launch_by_side = (
            fired.groupby(C(fired, "FiringUnitSide", "未知").fillna("未知").astype(str)).size()
            if not fired.empty and "FiringUnitSide" in fired.columns
            else pd.Series(dtype=float)
        )
        if not fuel.empty and "FuelQuantity" in fuel.columns:
            f = fuel.copy()
            if "FuelType" in f.columns:
                f = f[pd.to_numeric(f["FuelType"], errors="coerce") == 2001]
            if "UnitSide" not in f.columns and "UnitID" in f.columns:
                f = f.merge(u[["UnitID", side_col]].rename(columns={side_col: "UnitSide"}), on="UnitID", how="left")
            fuel_by_side = (
                pd.to_numeric(f["FuelQuantity"], errors="coerce").fillna(0.0).groupby(C(f, "UnitSide", "未知").fillna("未知").astype(str)).sum()
                if "UnitSide" in f.columns
                else pd.Series(dtype=float)
            )
        else:
            fuel_by_side = pd.Series(dtype=float)

        du = destroyed.merge(u[["UnitID", "_type"]], on="UnitID", how="inner") if not destroyed.empty and "UnitID" in destroyed.columns else pd.DataFrame(columns=["UnitID", "_type"])
        side_list = []
        if not sides_df.empty and "SideName" in sides_df.columns:
            side_list.extend(sides_df["SideName"].dropna().astype(str).tolist())
        side_list.extend(platforms[side_col].dropna().astype(str).tolist())
        side_list = list(dict.fromkeys(side_list))

        rows = []
        for side in side_list:
            g = platforms[platforms[side_col] == side]
            lost = g[g["_destroyed"]]
            total = len(g)
            n_lost = len(lost)
            dg = du[du["UnitID"].isin(set(g["UnitID"]))] if len(du) else du
            rows.append({
                "分方": side,
                "人员损失": round(float(g["_crew_loss"].sum()), 2),
                "成本": round(float(g["_introduced"].sum()) / 1.0e8, 2),
                "平台损失": n_lost,
                "非主战平台损失": int((lost["_platform_cost"] < non_main_cost).sum()),
                "弹药消耗": int(ammo_by_side.get(side, 0)),
                "弹药发射": int(launch_by_side.get(side, 0)),
                "航空燃油消耗": round(float(fuel_by_side.get(side, 0.0)), 2),
                "飞机损失": int(dg["_type"].isin(AIR_TYPES).sum()) if len(dg) else 0,
                "舰艇损失": int(dg["_type"].isin(SHIP_TYPES).sum()) if len(dg) else 0,
                "地面单元损失": int(dg["_type"].isin(GROUND_TYPES).sum()) if len(dg) else 0,
                "平台数": total,
                "战损率": n_lost / total if total else 0.0,
                "平台生存率": 1.0 - n_lost / total if total else 1.0,
            })
        base = pd.DataFrame(rows)
else:
    base = base.rename(columns={"成本_亿元": "成本"})

if base is None or base.empty or len(base) < 2:
    output_df = pd.DataFrame(columns=COLS)
else:
    side_col = "分方" if "分方" in base.columns else "分方比"
    b = base.copy()
    for c in NUM_COLS:
        b[c] = pd.to_numeric(b[c] if c in b.columns else np.nan, errors="coerce")
    records = []
    for i, j in combinations(range(len(b)), 2):
        a, d = b.iloc[i], b.iloc[j]
        rec = {"分方比": str(a[side_col]) + "/" + str(d[side_col])}
        for c, h in zip(NUM_COLS, HEADERS):
            den = d[c]
            rec[h] = np.nan if pd.isna(den) or den == 0 else (round(float(a[c]) / float(den), 4) if pd.notna(a[c]) else np.nan)
        records.append(rec)
    output_df = pd.DataFrame(records)[COLS] if records else pd.DataFrame(columns=COLS)
`.trim(),
  },

  // 3.3 飞机损失（按型号）指标
  {
    id: 'cost.aircraft_losses_by_model',
    name: '飞机损失（按型号）指标',
    chapter: 3,
    category: 'cost',
    militaryLevel: 'MOP',
    domainTag: 'survivability',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '筛选 Aircraft / 飞机（严格排除 Weapon / 武器），以 UnitDestroyed 的 Reason 哨兵值 ("NOtOK") 判定损毁并按 (分方, 飞机型号) 求和，仅输出损失数量 > 0 的型号。',
    requiredTables: ['UnitCreated'],
    optionalTables: ['UnitDestroyed'],
    tableColumns: {
      UnitCreated: ['UnitID', 'UnitType', 'UnitSide', 'Side', 'UnitClass'],
      UnitDestroyed: ['UnitID', 'Reason'],
    },
    parameterPorts: [],
    outputColumns: ['分方', '飞机型号', '损失数量'],
    pythonCode: `
import pandas as pd
import numpy as np

units = T("UnitCreated")
destroyed = T("UnitDestroyed")
COLS = ["分方", "飞机型号", "损失数量"]

if units.empty or "UnitID" not in units.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    u = units.drop_duplicates("UnitID")
    air = u[C(u, "UnitType", "").astype(str).isin(["Aircraft", "飞机"])].copy() if "UnitType" in u.columns else pd.DataFrame(columns=u.columns)
    if air.empty:
        output_df = pd.DataFrame(columns=COLS)
    else:
        if not destroyed.empty and "UnitID" in destroyed.columns:
            d = destroyed[["UnitID"]].copy()
            d["_reason"] = C(destroyed, "Reason", "KILL").fillna("KILL").astype(str)
            d = d.drop_duplicates("UnitID")
            air = air.merge(d, on="UnitID", how="left")
            air["_reason"] = air["_reason"].fillna("NOtOK")
        else:
            air["_reason"] = "NOtOK"

        air["_match"] = (air["_reason"] != "NOtOK").astype(int)
        side_col = "UnitSide" if "UnitSide" in air.columns else ("Side" if "Side" in air.columns else None)
        air["_side"] = C(air, side_col, "未知").fillna("未知").astype(str) if side_col else "未知"
        air["_class"] = C(air, "UnitClass", "未知型号").fillna("未知型号").astype(str)

        out = air.groupby(["_side", "_class"], dropna=False).agg(损失数量=("_match", "sum")).reset_index()
        out = out[out["损失数量"] > 0]
        output_df = pd.DataFrame({
            "分方": out["_side"].astype(str),
            "飞机型号": out["_class"].astype(str),
            "损失数量": out["损失数量"].astype(int),
        })[COLS] if not out.empty else pd.DataFrame(columns=COLS)
`.trim(),
  },

  // 3.4 任务消耗战损指标
  {
    id: 'cost.mission_attrition_metrics',
    name: '任务消耗战损指标',
    chapter: 3,
    category: 'cost',
    militaryLevel: 'MOE',
    domainTag: 'cost',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '从全量 MissionUnitRelationChanged 出发关联平台成本归集结果（排除 Weapon/Group），先按 MissionID 求和，再按 (任务, 分方) 聚合输出人员损失、成本(亿元)与平台损失。',
    requiredTables: ['UnitCreated', 'MissionUnitRelationChanged', 'MissionChanged'],
    optionalTables: ['UnitDestroyed', 'WeaponFired'],
    tableColumns: {
      UnitCreated: ['UnitID', 'UnitType', 'Crew', 'Cost'],
      UnitDestroyed: ['UnitID'],
      WeaponFired: ['FiringUnitID'],
      MissionUnitRelationChanged: ['MissionID', 'UnitID'],
      MissionChanged: ['MissionID', 'MissionName', 'Side', 'UnitSide'],
    },
    parameterPorts: [
      {
        key: 'aircraftDefaultCost',
        label: '战机默认造价 (元)',
        dataType: 'number',
        defaultValue: 455000000.0,
        description: '缺 Cost 列时飞机默认造价',
      },
      {
        key: 'shipDefaultCost',
        label: '舰船默认造价 (元)',
        dataType: 'number',
        defaultValue: 14000000000.0,
        description: '缺 Cost 列时舰船默认造价',
      },
      {
        key: 'facilityDefaultCost',
        label: '地面设施默认造价 (元)',
        dataType: 'number',
        defaultValue: 2800000000.0,
        description: '缺 Cost 列时地面设施默认造价',
      },
      {
        key: 'weaponDefaultCost',
        label: '弹药默认单价 (元)',
        dataType: 'number',
        defaultValue: 7630000.0,
        description: '存活平台已发射弹药默认单价',
      },
    ],
    outputColumns: ['任务', '分方', '人员损失', '成本_亿元', '平台损失'],
    pythonCode: `
import pandas as pd
import numpy as np

aircraft_cost = float(params.get("aircraftDefaultCost", 4.55e8))
ship_cost = float(params.get("shipDefaultCost", 1.40e10))
facility_cost = float(params.get("facilityDefaultCost", 2.80e9))
weapon_cost = float(params.get("weaponDefaultCost", 7.63e6))

COST_BY_TYPE = {
    "Aircraft": aircraft_cost, "飞机": aircraft_cost,
    "Ship": ship_cost, "舰船": ship_cost, "Submarine": ship_cost, "潜艇": ship_cost,
    "Facility": facility_cost, "设施": facility_cost, "Satellite": facility_cost, "卫星": facility_cost,
    "Vehicle": 5.0e7, "LandUnit": 5.0e7, "地面单元": 5.0e7, "车辆": 5.0e7,
    "Weapon": weapon_cost, "武器": weapon_cost,
}
NON_PLATFORM_TYPES = {"Weapon", "武器", "Group", "编组"}

units = T("UnitCreated")
destroyed = T("UnitDestroyed")
fired = T("WeaponFired")
rels = T("MissionUnitRelationChanged")
missions = T("MissionChanged")
COLS = ["任务", "分方", "人员损失", "成本_亿元", "平台损失"]

if rels.empty or "MissionID" not in rels.columns or "UnitID" not in rels.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    u = units.drop_duplicates("UnitID").copy() if not units.empty and "UnitID" in units.columns else pd.DataFrame(columns=["UnitID"])
    if u.empty:
        output_df = pd.DataFrame(columns=COLS)
    else:
        u["_type"] = C(u, "UnitType", "Unknown").fillna("Unknown").astype(str)
        u = u[~u["_type"].isin(NON_PLATFORM_TYPES)].copy()
        u["_crew"] = pd.to_numeric(C(u, "Crew", 0), errors="coerce").fillna(0.0)
        u["_cost"] = pd.to_numeric(u["Cost"], errors="coerce") if "Cost" in u.columns else pd.Series(np.nan, index=u.index)
        u["_cost"] = u["_cost"].fillna(u["_type"].map(COST_BY_TYPE)).fillna(0.0)
        lost_ids = set(destroyed["UnitID"].dropna()) if not destroyed.empty and "UnitID" in destroyed.columns else set()
        u["_destroyed"] = u["UnitID"].isin(lost_ids)
        ammo_cost_by_unit = fired.groupby("FiringUnitID").size().astype(float) * weapon_cost if not fired.empty and "FiringUnitID" in fired.columns else pd.Series(dtype=float)
        u["CrewLoss"] = np.where(u["_destroyed"], u["_crew"], 0.0)
        u["IntroducedCost"] = np.where(u["_destroyed"], u["_cost"], u["UnitID"].map(ammo_cost_by_unit).fillna(0.0))

        r = rels[["MissionID", "UnitID"]].merge(u[["UnitID", "CrewLoss", "IntroducedCost", "_destroyed"]], on="UnitID", how="inner")
        if r.empty:
            output_df = pd.DataFrame(columns=COLS)
        else:
            r["_destroyed"] = r["_destroyed"].astype(float)
            agg = r.groupby("MissionID", dropna=False).agg(
                人员损失=("CrewLoss", "sum"),
                _cost=("IntroducedCost", "sum"),
                平台损失=("_destroyed", "sum"),
            ).reset_index()

            if not missions.empty and "MissionID" in missions.columns:
                mcols = ["MissionID"] + [c for c in ["MissionName", "Side", "UnitSide"] if c in missions.columns]
                agg = agg.merge(missions[mcols].drop_duplicates("MissionID"), on="MissionID", how="left")
            side_col = "UnitSide" if "UnitSide" in agg.columns and agg["UnitSide"].notna().any() else ("Side" if "Side" in agg.columns else None)
            agg["任务"] = C(agg, "MissionName", agg["MissionID"]).fillna(agg["MissionID"]).astype(str)
            agg["分方"] = C(agg, side_col, "未知").fillna("未知").astype(str) if side_col else "未知"

            out = agg.groupby(["任务", "分方"], dropna=False).agg(
                人员损失=("人员损失", "mean"),
                成本_亿元=("_cost", "mean"),
                平台损失=("平台损失", "mean"),
            ).reset_index()
            out["成本_亿元"] = (out["成本_亿元"] / 1.0e8).round(2)
            out["人员损失"] = out["人员损失"].round(2)
            out["平台损失"] = out["平台损失"].round(2)
            output_df = out[COLS]
`.trim(),
  },

  // 3.5 平台毁伤概率指标
  {
    id: 'cost.platform_damage_probability',
    name: '平台毁伤概率指标',
    chapter: 3,
    category: 'cost',
    militaryLevel: 'MOE',
    domainTag: 'survivability',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '排除 Weapon/武器 与 Group/编组，按参数化分级下限 (lightThreshold/mediumThreshold/heavyThreshold) 与 UnitDestroyed 终态统计分方平台毁伤等级计数与占比。',
    requiredTables: ['UnitCreated'],
    optionalTables: ['UnitDamaged', 'UnitDestroyed'],
    tableColumns: {
      UnitCreated: ['UnitID', 'UnitType', 'UnitSide', 'Side', 'DamagePercent'],
      UnitDamaged: ['UnitID', 'DamagePercent'],
      UnitDestroyed: ['UnitID'],
    },
    parameterPorts: [
      {
        key: 'lightThreshold',
        label: '轻伤下限阈值 (严格大于)',
        dataType: 'number',
        defaultValue: 0.0,
        description: '归一化毁伤比例严格大于该值进入轻伤（默认 0.0）',
      },
      {
        key: 'mediumThreshold',
        label: '中伤下限阈值 (严格大于)',
        dataType: 'number',
        defaultValue: 0.25,
        description: '归一化毁伤比例严格大于该值进入中伤（默认 0.25）',
      },
      {
        key: 'heavyThreshold',
        label: '重伤下限阈值 (严格大于)',
        dataType: 'number',
        defaultValue: 0.5,
        description: '归一化毁伤比例严格大于该值进入重伤、无上界（默认 0.5）',
      },
    ],
    outputColumns: ['分方', '毁伤等级', '单元数', '占比'],
    pythonCode: `
import pandas as pd
import numpy as np

light_th = float(params.get("lightThreshold", 0.0))
medium_th = float(params.get("mediumThreshold", 0.25))
heavy_th = float(params.get("heavyThreshold", 0.5))

NON_PLATFORM_TYPES = {"Weapon", "武器", "Group", "编组"}

units = T("UnitCreated")
damaged = T("UnitDamaged")
destroyed = T("UnitDestroyed")
COLS = ["分方", "毁伤等级", "单元数", "占比"]

if units.empty or "UnitID" not in units.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    u = units.drop_duplicates("UnitID").copy()
    u = u[~C(u, "UnitType", "Unknown").fillna("Unknown").astype(str).isin(NON_PLATFORM_TYPES)].copy()
    if u.empty:
        output_df = pd.DataFrame(columns=COLS)
    else:
        if not damaged.empty and {"UnitID", "DamagePercent"}.issubset(damaged.columns):
            dmg = pd.to_numeric(damaged["DamagePercent"], errors="coerce").groupby(damaged["UnitID"]).max() / 100.0
            u["_d"] = u["UnitID"].map(dmg).fillna(0.0)
        elif "DamagePercent" in u.columns:
            u["_d"] = pd.to_numeric(u["DamagePercent"], errors="coerce").fillna(0.0) / 100.0
        else:
            u["_d"] = 0.0

        side_col = "UnitSide" if "UnitSide" in u.columns else ("Side" if "Side" in u.columns else None)
        u["_side"] = C(u, side_col, "未知").fillna("未知").astype(str) if side_col else "未知"

        level = pd.Series("未被击中", index=u.index, dtype="object")
        level[u["_d"] > light_th] = "轻伤"
        level[u["_d"] > medium_th] = "中伤"
        level[u["_d"] > heavy_th] = "重伤"
        lost_ids = set(destroyed["UnitID"].dropna()) if not destroyed.empty and "UnitID" in destroyed.columns else set()
        level[u["UnitID"].isin(lost_ids)] = "被摧毁"
        u["毁伤等级"] = level.astype(str)

        out = u.groupby(["_side", "毁伤等级"], dropna=False).size().rename("单元数").reset_index()
        out["占比"] = (out["单元数"] / out.groupby("_side")["单元数"].transform("sum")).round(4)
        output_df = pd.DataFrame({
            "分方": out["_side"].astype(str),
            "毁伤等级": out["毁伤等级"].astype(str),
            "单元数": out["单元数"].astype(int),
            "占比": out["占比"].astype(float),
        })[COLS]
`.trim(),
  },
];
