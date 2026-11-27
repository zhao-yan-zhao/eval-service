/**
 * F1 V4 一库算子脚本库（Part 3：第 8 章 ROE 合规与安全红线，共 2 个实证算子）
 *
 * 补齐 Phase 1 迁移在用但 V4 缺失的两项核心算子：
 * 1. `roe.corridor_spatial_compliance` — 任务航路走廊空间遵从率 (spatial)
 * 2. `roe.fratricide_count` — 友军误伤事件数安全红线 (python_script)
 *
 * 严格遵循 `eval-service/AGENTS.md` 工程铁律：
 * - Fail-Closed 实证门控（缺表/缺走廊/缺样本绝不伪造 1.0）
 * - 显式过滤 `UnitType == "武器"` / `"Weapon"`，防止导弹误算为作战平台
 * - `WeaponEndgame` 按 `WeaponID` 归并去重并剔除 `"No point defence systems employed"` 虚构行
 * - 零 eval / 零危险导入，严格通过 `python_worker.py` AST 安全沙箱执行
 */

import type { V4OperatorScriptSpec } from './types.ts';

export const V4_OPERATORS_PART3: V4OperatorScriptSpec[] = [
  // ──────────────────── 第 8 章：ROE 合规与安全红线（2 项） ────────────────────
  {
    id: 'roe.corridor_spatial_compliance',
    name: '任务航路走廊空间遵从率',
    chapter: 8,
    category: 'compliance',
    militaryLevel: 'MOE',
    domainTag: 'c2',
    layer: 'fact',
    engineKind: 'spatial',
    description:
      '8.1 任务航路走廊空间遵从率：接入 4 张规范事件表（MissionChanged / MissionRefPointRelationChanged / MissionUnitRelationChanged / UnitPositions），剔除武器实体（UnitType=="武器"），按任务参考点构造空域多边形并以射线法 in_polygon() 判定航迹点在走廊内的比例与最小安全裕度（km）。',
    requiredTables: [
      'MissionChanged',
      'MissionRefPointRelationChanged',
      'MissionUnitRelationChanged',
      'UnitPositions',
    ],
    optionalTables: ['UnitCreated'],
    tableColumns: {
      MissionChanged: ['MissionID', 'MissionName', 'Side', 'UnitSide', 'Category', 'MissionClass'],
      MissionRefPointRelationChanged: ['Time', 'MissionID', 'Type', 'PointIndex', 'Longitude', 'Latitude'],
      MissionUnitRelationChanged: ['Time', 'MissionID', 'UnitID', 'Type'],
      UnitPositions: [
        'Time',
        'UnitID',
        'UnitName',
        'UnitType',
        'UnitSide',
        'Side',
        'UnitLongitude',
        'UnitLatitude',
      ],
      UnitCreated: ['UnitID', 'UnitName', 'UnitType', 'UnitSide', 'Side'],
    },
    parameterPorts: [
      {
        key: 'minSafeMarginKm',
        label: '最小安全裕度阈值 (km)',
        dataType: 'number',
        defaultValue: 15.0,
        description: '用于评估航迹点与走廊边界安全距离裕度的参考阈值（公里）',
      },
      {
        key: 'minComplianceRate',
        label: '合规判定最低遵从率 (0~1)',
        dataType: 'number',
        defaultValue: 0.85,
        description: '单装航迹点位于走廊内的最低合规占比阈值，默认 0.85',
      },
    ],
    outputColumns: [
      '分方',
      '任务ID',
      '任务名',
      '单元ID',
      '单元名',
      '总航迹点数',
      '走廊内点数',
      '遵从率',
      '最小安全裕度_km',
      '合规状态',
    ],
    pythonCode: `import math
import pandas as pd
import numpy as np

missions = T("MissionChanged")
refpoints = T("MissionRefPointRelationChanged")
rels = T("MissionUnitRelationChanged")
positions = T("UnitPositions")
units = T("UnitCreated")

COLS = [
    "分方",
    "任务ID",
    "任务名",
    "单元ID",
    "单元名",
    "总航迹点数",
    "走廊内点数",
    "遵从率",
    "最小安全裕度_km",
    "合规状态",
]

min_safe_margin_km = float(params.get("minSafeMarginKm", 15.0))
min_compliance_rate = float(params.get("minComplianceRate", 0.85))

def _is_weapon(utype):
    if pd.isna(utype):
        return False
    s = str(utype).strip().lower()
    return s in ("武器", "weapon", "weapons", "missile", "munitions", "torpedo", "bomb")

def _point_to_seg_km(lon, lat, x1, y1, x2, y2):
    cos_lat = math.cos(math.radians((lat + 0.5 * (y1 + y2)) * 0.5))
    kx = 111.32 * max(cos_lat, 1e-6)
    ky = 110.574
    px, py = lon * kx, lat * ky
    ax, ay = x1 * kx, y1 * ky
    bx, by = x2 * kx, y2 * ky
    dx, dy = bx - ax, by - ay
    denom = dx * dx + dy * dy
    if denom <= 1e-12:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / denom))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy)

def _signed_margin_km(lon, lat, poly, inside):
    n = len(poly)
    if n < 3:
        return 0.0
    best = 1e18
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        d = _point_to_seg_km(lon, lat, x1, y1, x2, y2)
        if d < best:
            best = d
    return best if inside else -best

if (
    missions.empty
    or "MissionID" not in missions.columns
    or refpoints.empty
    or not {"MissionID", "Longitude", "Latitude"}.issubset(refpoints.columns)
    or positions.empty
    or not {"UnitID", "UnitLongitude", "UnitLatitude"}.issubset(positions.columns)
):
    output_df = pd.DataFrame(columns=COLS)
else:
    # 1. 构建任务元信息（名称、分方）
    m_dedup = missions.dropna(subset=["MissionID"]).drop_duplicates("MissionID").copy()
    name_by_mid = dict(
        zip(
            m_dedup["MissionID"].astype(str),
            C(m_dedup, "MissionName", m_dedup["MissionID"]).fillna(m_dedup["MissionID"]).astype(str),
        )
    )
    if "UnitSide" in m_dedup.columns and m_dedup["UnitSide"].notna().any():
        m_side_ser = m_dedup["UnitSide"].fillna(C(m_dedup, "Side", "未知")).fillna("未知").astype(str)
    elif "Side" in m_dedup.columns:
        m_side_ser = m_dedup["Side"].fillna("未知").astype(str)
    else:
        m_side_ser = pd.Series("未知", index=m_dedup.index, dtype="object")
    side_by_mid = dict(zip(m_dedup["MissionID"].astype(str), m_side_ser))

    # 2. 按 MissionID 构造走廊多边形（排除 Remove/Delete 操作；有 PointIndex 时按序排列）
    rp = refpoints.dropna(subset=["MissionID"]).copy()
    rp["MissionID"] = rp["MissionID"].astype(str)
    if "Type" in rp.columns:
        t_low = rp["Type"].fillna("").astype(str).str.strip().str.lower()
        rp = rp[~t_low.isin(["remove", "delete", "removed", "deleted", "unassign"])].copy()
    rp["_lon"] = pd.to_numeric(rp["Longitude"], errors="coerce")
    rp["_lat"] = pd.to_numeric(rp["Latitude"], errors="coerce")
    rp = rp.dropna(subset=["_lon", "_lat"])
    if "PointIndex" in rp.columns:
        rp["_idx"] = pd.to_numeric(rp["PointIndex"], errors="coerce")
        if rp["_idx"].notna().any():
            rp = rp.sort_values(["MissionID", "_idx"], kind="mergesort")

    polys = {}
    for mid, g in rp.groupby("MissionID", sort=False):
        pts = [(float(a), float(b)) for a, b in zip(g["_lon"], g["_lat"])]
        if len(pts) >= 3:
            polys[str(mid)] = pts

    if not polys:
        output_df = pd.DataFrame(columns=COLS)
    else:
        # 3. 构造单元信息与武器过滤字典（严格剔除 UnitType == "武器"）
        unit_type_map = {}
        unit_name_map = {}
        unit_side_map = {}
        if not units.empty and "UnitID" in units.columns:
            u_dedup = units.dropna(subset=["UnitID"]).drop_duplicates("UnitID")
            uids = u_dedup["UnitID"].astype(str)
            if "UnitType" in u_dedup.columns:
                unit_type_map = dict(zip(uids, u_dedup["UnitType"]))
            if "UnitName" in u_dedup.columns:
                unit_name_map = dict(zip(uids, u_dedup["UnitName"].fillna(uids).astype(str)))
            us_col = "UnitSide" if "UnitSide" in u_dedup.columns else ("Side" if "Side" in u_dedup.columns else None)
            if us_col:
                unit_side_map = dict(zip(uids, u_dedup[us_col].fillna("未知").astype(str)))

        # 4. 筛选有效单元-任务指派关系（兼容 Assigned / Assign / 非 Unassign）
        assigned_pairs = pd.DataFrame(columns=["MissionID", "UnitID"])
        if not rels.empty and {"MissionID", "UnitID"}.issubset(rels.columns):
            r = rels.dropna(subset=["MissionID", "UnitID"]).copy()
            r["MissionID"] = r["MissionID"].astype(str)
            r["UnitID"] = r["UnitID"].astype(str)
            r = r[r["MissionID"].isin(polys.keys())]
            if "Type" in r.columns:
                rt = r["Type"].fillna("").astype(str).str.strip().str.lower()
                # 排除 StrikeActiveUnit（目标）和 Unassign/Remove
                r = r[~rt.isin(["strikeactiveunit", "unassign", "unassigned", "remove", "removed", "delete"])]
            assigned_pairs = r[["MissionID", "UnitID"]].drop_duplicates()

        # 5. 清洗航迹点并严格剔除武器单元
        pos = positions.dropna(subset=["UnitID"]).copy()
        pos["UnitID"] = pos["UnitID"].astype(str)
        pos["_lon"] = pd.to_numeric(pos["UnitLongitude"], errors="coerce")
        pos["_lat"] = pd.to_numeric(pos["UnitLatitude"], errors="coerce")
        pos = pos.dropna(subset=["_lon", "_lat"])

        if "UnitType" in pos.columns:
            pos = pos[~pos["UnitType"].map(_is_weapon)].copy()
        if unit_type_map:
            pos = pos[~pos["UnitID"].map(lambda uid: _is_weapon(unit_type_map.get(uid)))].copy()

        if pos.empty:
            output_df = pd.DataFrame(columns=COLS)
        else:
            if "UnitName" in pos.columns:
                for uid, uname in zip(pos["UnitID"], pos["UnitName"]):
                    if uid not in unit_name_map and pd.notna(uname):
                        unit_name_map[uid] = str(uname)
            ps_col = "UnitSide" if "UnitSide" in pos.columns else ("Side" if "Side" in pos.columns else None)
            if ps_col:
                for uid, uside in zip(pos["UnitID"], pos[ps_col]):
                    if uid not in unit_side_map and pd.notna(uside):
                        unit_side_map[uid] = str(uside)

            # 若有明确任务-单元指派关系则按指派映射；否则按同阵营匹配多边形
            if not assigned_pairs.empty:
                joined = pos[["UnitID", "_lon", "_lat"]].merge(assigned_pairs, on="UnitID", how="inner")
            else:
                # 兜底：同阵营单元对同阵营任务多边形求最佳走廊归属
                fallback_rows = []
                for mid in polys.keys():
                    mside = side_by_mid.get(mid, "未知")
                    for uid in pos["UnitID"].unique():
                        uside = unit_side_map.get(uid, "未知")
                        if mside == "未知" or uside == "未知" or mside.strip().lower() == uside.strip().lower():
                            fallback_rows.append({"MissionID": mid, "UnitID": uid})
                if fallback_rows:
                    joined = pos[["UnitID", "_lon", "_lat"]].merge(
                        pd.DataFrame(fallback_rows).drop_duplicates(), on="UnitID", how="inner"
                    )
                else:
                    joined = pd.DataFrame(columns=["UnitID", "_lon", "_lat", "MissionID"])

            if joined.empty:
                output_df = pd.DataFrame(columns=COLS)
            else:
                rows = []
                for (mid, uid), g in joined.groupby(["MissionID", "UnitID"], sort=False):
                    poly = polys.get(str(mid))
                    if not poly:
                        continue
                    total_pts = int(len(g))
                    if total_pts == 0:
                        continue
                    inside_pts = 0
                    min_margin = 1e18
                    for lon_v, lat_v in zip(g["_lon"], g["_lat"]):
                        ok = bool(in_polygon(float(lon_v), float(lat_v), poly))
                        if ok:
                            inside_pts += 1
                        mg = _signed_margin_km(float(lon_v), float(lat_v), poly, ok)
                        if mg < min_margin:
                            min_margin = mg
                    rate = round(inside_pts / total_pts, 4)
                    margin_val = round(min_margin, 2) if min_margin < 1e17 else 0.0
                    mside = side_by_mid.get(str(mid), "未知")
                    if mside == "未知" or not mside:
                        mside = unit_side_map.get(str(uid), "未知")
                    status_str = "合规" if (rate >= min_compliance_rate and margin_val >= -1e-6) else "越界告警"
                    rows.append(
                        {
                            "分方": str(mside),
                            "任务ID": str(mid),
                            "任务名": str(name_by_mid.get(str(mid), mid)),
                            "单元ID": str(uid),
                            "单元名": str(unit_name_map.get(str(uid), uid)),
                            "总航迹点数": total_pts,
                            "走廊内点数": inside_pts,
                            "遵从率": float(rate),
                            "最小安全裕度_km": float(margin_val),
                            "合规状态": status_str,
                        }
                    )
                output_df = pd.DataFrame(rows, columns=COLS) if rows else pd.DataFrame(columns=COLS)
`,
  },

  {
    id: 'roe.fratricide_count',
    name: '友军误伤事件数（安全红线）',
    chapter: 8,
    category: 'compliance',
    militaryLevel: 'MOP',
    domainTag: 'survivability',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '8.2 友军误伤安全红线：对 WeaponEndgame 按 WeaponID 归并去重并剔除 "No point defence systems employed" 虚构行，关联 UnitCreated（及可选 WeaponFired）核验发射方与受击非武器目标阵营，统计各分方友军误伤事件计数（FratricideCount）。',
    requiredTables: ['WeaponEndgame', 'UnitCreated'],
    optionalTables: ['WeaponFired', 'SideCreated'],
    tableColumns: {
      WeaponEndgame: [
        'WeaponID',
        'WeaponName',
        'WeaponSide',
        'ParentFiringUnitID',
        'TargetID',
        'TargetName',
        'TargetSide',
        'Result',
        'EndgameMessage',
      ],
      UnitCreated: ['UnitID', 'UnitName', 'UnitType', 'UnitClass', 'UnitSide', 'Side'],
      WeaponFired: ['WeaponID', 'FiringUnitID', 'FiringUnitSide'],
      SideCreated: ['SideName'],
    },
    parameterPorts: [
      {
        key: 'zeroTolerance',
        label: '零容忍红线开关',
        dataType: 'boolean',
        defaultValue: true,
        description: '开启后任一友军误伤事件即标记为违规',
      },
    ],
    outputColumns: ['分方', 'FratricideCount', '误伤事件数', '总终态命中数', '红线状态'],
    pythonCode: `import pandas as pd
import numpy as np

endgame_raw = T("WeaponEndgame")
units = T("UnitCreated")
fired = T("WeaponFired")
sides_df = T("SideCreated")

COLS = ["分方", "FratricideCount", "误伤事件数", "总终态命中数", "红线状态"]
zero_tolerance = bool(params.get("zeroTolerance", True))

def _is_weapon(utype):
    if pd.isna(utype):
        return False
    s = str(utype).strip().lower()
    return s in ("武器", "weapon", "weapons", "missile", "munitions", "torpedo", "bomb")

def _norm_side(val):
    if pd.isna(val):
        return ""
    s = str(val).strip().lower()
    if s in ("红方", "red", "red side", "红"):
        return "red"
    if s in ("蓝方", "blue", "blue side", "蓝"):
        return "blue"
    if s in ("绿方", "green", "green side", "绿"):
        return "green"
    return s

def _dedup_endgame(eg):
    if eg.empty:
        return eg
    d = eg.copy()
    if "EndgameMessage" in d.columns:
        msg_l = d["EndgameMessage"].fillna("").astype(str).str.lower()
        d = d[~msg_l.str.contains("no point defence systems employed", na=False)].copy()
    if d.empty or "WeaponID" not in d.columns:
        return d
    rank_map = {
        "KILL": 5,
        "HIT": 4,
        "POINTDEF:SUCCESS": 3,
        "MISS": 2,
        "UNDEFINED": 1,
        "POINTDEF:FAILURE": 0,
    }
    d["_rk"] = C(d, "Result", "").astype(str).str.strip().str.upper().map(rank_map).fillna(0)
    d = d.sort_values("_rk", ascending=False, kind="mergesort").drop_duplicates("WeaponID", keep="first")
    return d.drop(columns=["_rk"])

endgame = _dedup_endgame(endgame_raw)

# 构造单元阵营与类型查找表
unit_side_map = {}
unit_type_map = {}
if not units.empty and "UnitID" in units.columns:
    u_dedup = units.dropna(subset=["UnitID"]).drop_duplicates("UnitID")
    uids = u_dedup["UnitID"].astype(str)
    us_col = "UnitSide" if "UnitSide" in u_dedup.columns else ("Side" if "Side" in u_dedup.columns else None)
    if us_col:
        unit_side_map = dict(zip(uids, u_dedup[us_col].fillna("").astype(str)))
    if "UnitType" in u_dedup.columns:
        unit_type_map = dict(zip(uids, u_dedup["UnitType"]))

# 可选 WeaponFired 补齐发射方阵营
fired_side_map = {}
if not fired.empty and "WeaponID" in fired.columns:
    f_dedup = fired.dropna(subset=["WeaponID"]).drop_duplicates("WeaponID")
    fs_col = "FiringUnitSide" if "FiringUnitSide" in f_dedup.columns else None
    if fs_col:
        fired_side_map = dict(zip(f_dedup["WeaponID"].astype(str), f_dedup[fs_col].fillna("").astype(str)))

# 收集活跃分方列表（保持出现顺序）
all_sides = []
seen_norm = set()
def _register_side(raw_val):
    if pd.isna(raw_val):
        return
    s = str(raw_val).strip()
    if not s or s.lower() in ("nan", "none", "未知", "unknown"):
        return
    ns = _norm_side(s)
    if ns and ns not in seen_norm:
        seen_norm.add(ns)
        all_sides.append((ns, s))

if not sides_df.empty and "SideName" in sides_df.columns:
    for v in sides_df["SideName"].dropna().tolist():
        _register_side(v)
for v in unit_side_map.values():
    _register_side(v)
if not endgame.empty and "WeaponSide" in endgame.columns:
    for v in endgame["WeaponSide"].dropna().tolist():
        _register_side(v)

if not all_sides:
    output_df = pd.DataFrame(columns=COLS)
else:
    frat_counts = {ns: 0 for ns, _ in all_sides}
    hit_counts = {ns: 0 for ns, _ in all_sides}

    if not endgame.empty:
        for _, row in endgame.iterrows():
            res = str(row["Result"]).strip().upper() if "Result" in endgame.columns and pd.notna(row["Result"]) else ""
            if res not in ("HIT", "KILL"):
                continue

            wid = str(row["WeaponID"]) if "WeaponID" in endgame.columns and pd.notna(row["WeaponID"]) else ""
            f_uid = str(row["ParentFiringUnitID"]) if "ParentFiringUnitID" in endgame.columns and pd.notna(row["ParentFiringUnitID"]) else ""
            t_uid = str(row["TargetID"]) if "TargetID" in endgame.columns and pd.notna(row["TargetID"]) else ""

            f_side_raw = ""
            if "WeaponSide" in endgame.columns and pd.notna(row["WeaponSide"]):
                f_side_raw = str(row["WeaponSide"]).strip()
            if not f_side_raw and wid in fired_side_map:
                f_side_raw = fired_side_map[wid]
            if not f_side_raw and f_uid in unit_side_map:
                f_side_raw = unit_side_map[f_uid]

            f_norm = _norm_side(f_side_raw)
            if not f_norm:
                continue
            if f_norm not in hit_counts:
                _register_side(f_side_raw)
                frat_counts[f_norm] = 0
                hit_counts[f_norm] = 0
            hit_counts[f_norm] += 1

            if not t_uid:
                continue
            # 剔除拦截敌方/友方导弹等武器目标
            if t_uid in unit_type_map and _is_weapon(unit_type_map[t_uid]):
                continue

            t_side_raw = ""
            if "TargetSide" in endgame.columns and pd.notna(row["TargetSide"]):
                t_side_raw = str(row["TargetSide"]).strip()
            if not t_side_raw and t_uid in unit_side_map:
                t_side_raw = unit_side_map[t_uid]
            t_norm = _norm_side(t_side_raw)

            if t_norm and t_norm == f_norm:
                frat_counts[f_norm] += 1

    rows = []
    for ns, display_side in all_sides:
        fc = int(frat_counts.get(ns, 0))
        hc = int(hit_counts.get(ns, 0))
        status_str = "违规" if (zero_tolerance and fc > 0) else "合格"
        rows.append(
            {
                "分方": display_side,
                "FratricideCount": fc,
                "误伤事件数": fc,
                "总终态命中数": hc,
                "红线状态": status_str,
            }
        )
    output_df = pd.DataFrame(rows, columns=COLS)
`,
  },
];
