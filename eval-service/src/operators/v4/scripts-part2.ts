/**
 * F1 V4 一库算子脚本库（Part 2：第 4–7 章，共 13 个 Python 科学计算算子）
 *
 * 严格对齐：
 * 1. `d:\project\beifen\metrics_calculation_guide.html` 第 4、5、6、7 章及 §0 逻辑纠偏
 * 2. `eval-service/src/engine/python_worker.py` AST 安全沙箱契约：
 *    - 仅使用白名单库（pandas / numpy / math），零 eval/exec/open/getattr/dunder
 *    - 零 geopandas/shapely 强依赖（纯 numpy 网格面积与物理公式）
 *    - 直接调用预注入契约函数 T(name)、C(df, col, default) 与变量 params / prev_output_df
 */

import type {
  MetricDomainTag,
  MetricMilitaryLevel,
  OperatorCategory,
  ParameterPortSpec,
} from '../../core/types.ts';

export interface V4OperatorScriptSpecLike {
  id: string;
  name: string;
  chapter: number;
  category: OperatorCategory;
  militaryLevel: MetricMilitaryLevel;
  domainTag: MetricDomainTag;
  description: string;
  layer?: 'fact' | 'legacy_aggregate';
  engineKind?: 'python_script' | 'data_input' | 'inline_calc' | 'group_agg' | 'spatial';
  requiredTables: string[];
  optionalTables?: string[];
  upstreamOperatorId?: string;
  tableColumns?: Record<string, string[]>;
  parameterPorts: ParameterPortSpec[];
  outputColumns: string[];
  pythonCode: string;
}

export const V4_OPERATORS_PART2: V4OperatorScriptSpecLike[] = [
  // ──────────────────── 第 4 章：侦察预警（5 项） ────────────────────
  {
    id: 'isr.reconnaissance_range',
    name: '侦察范围',
    chapter: 4,
    category: 'situation',
    militaryLevel: 'MOP',
    domainTag: 'isr',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '4.1 侦察范围：DetectionIdentificationChanged 内连接 UnitCreated，按 (分方, 平台型号) 取最大水平探测距离 ContactRangeHoriz_nm，再按型号汇聚均值。',
    requiredTables: ['DetectionIdentificationChanged', 'UnitCreated'],
    tableColumns: {
      DetectionIdentificationChanged: [
        'SensorPlatformID',
        'ContactRangeHoriz_nm',
        'ContactRangeSlant_nm',
      ],
      UnitCreated: ['UnitID', 'UnitClass', 'UnitSide', 'Side'],
    },
    parameterPorts: [],
    outputColumns: ['型号', '探测范围_海里', '分方'],
    pythonCode: `import pandas as pd
import numpy as np

det = T("DetectionIdentificationChanged")
units = T("UnitCreated")
COLS = ["型号", "探测范围_海里", "分方"]

if det.empty or "SensorPlatformID" not in det.columns or units.empty or "UnitID" not in units.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    ucols = ["UnitID"] + [c for c in ["UnitClass", "UnitSide", "Side"] if c in units.columns]
    u = units[ucols].dropna(subset=["UnitID"]).drop_duplicates("UnitID").rename(columns={"UnitClass": "_model"})
    dcols = ["SensorPlatformID"] + [c for c in ["ContactRangeHoriz_nm", "ContactRangeSlant_nm"] if c in det.columns]
    d = det[dcols].dropna(subset=["SensorPlatformID"]).merge(
        u, left_on="SensorPlatformID", right_on="UnitID", how="inner"
    )
    if d.empty:
        output_df = pd.DataFrame(columns=COLS)
    else:
        side_col = "UnitSide" if "UnitSide" in d.columns else ("Side" if "Side" in d.columns else None)
        d["_side"] = C(d, side_col, "未知").fillna("未知") if side_col else "未知"
        d["_model"] = C(d, "_model", "未知型号").fillna("未知型号")
        dcol = (
            "ContactRangeHoriz_nm"
            if "ContactRangeHoriz_nm" in d.columns
            else ("ContactRangeSlant_nm" if "ContactRangeSlant_nm" in d.columns else None)
        )
        d["_dist"] = pd.to_numeric(d[dcol], errors="coerce") if dcol else np.nan
        out = d.groupby(["_side", "_model"], dropna=False).agg(_dist=("_dist", "max")).reset_index()
        show = out.groupby("_model", dropna=False).agg(_dist=("_dist", "mean")).reset_index()
        sides = d.groupby("_model", dropna=False)["_side"].first()
        output_df = pd.DataFrame(
            {
                "型号": show["_model"],
                "探测范围_海里": pd.to_numeric(show["_dist"], errors="coerce").round(2),
                "分方": show["_model"].map(sides).fillna("未知"),
            }
        )[COLS]
`,
  },

  {
    id: 'isr.detection_rate',
    name: '发现率',
    chapter: 4,
    category: 'effectiveness',
    militaryLevel: 'MOE',
    domainTag: 'isr',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '4.2 发现率：统计被考虑平台 (默认 Aircraft/Ship) 出现在 ContactCreated.ActualUnitID 的比例，按观测方汇聚所有非己方目标数与发现数。',
    requiredTables: ['UnitCreated', 'ContactCreated'],
    optionalTables: ['SideCreated'],
    tableColumns: {
      UnitCreated: ['UnitID', 'UnitType', 'UnitSide', 'Side'],
      ContactCreated: ['ContactID', 'ActualUnitID'],
      SideCreated: ['SideName'],
    },
    parameterPorts: [
      {
        key: 'consideredUnitTypes',
        label: '纳入统计平台类型',
        dataType: 'json',
        defaultValue: ['Aircraft', 'Ship'],
        description: '潜在目标单元类型过滤列表，默认 ["Aircraft", "Ship"]',
      },
    ],
    outputColumns: ['分方', '发现目标数', '潜在目标数', '发现率'],
    pythonCode: `import pandas as pd
import numpy as np

units = T("UnitCreated")
contacts = T("ContactCreated")
sides_df = T("SideCreated")
COLS = ["分方", "发现目标数", "潜在目标数", "发现率"]

raw_types = params.get("consideredUnitTypes", ["Aircraft", "Ship"])
considered_types = (
    [str(x) for x in raw_types]
    if isinstance(raw_types, (list, tuple, set)) and len(raw_types) > 0
    else ["Aircraft", "Ship"]
)

if units.empty or "UnitID" not in units.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    u = units.dropna(subset=["UnitID"]).drop_duplicates("UnitID").copy()
    side_col = "UnitSide" if "UnitSide" in u.columns else ("Side" if "Side" in u.columns else None)
    u["_side"] = C(u, side_col, "未知").fillna("未知") if side_col else "未知"
    considered = (
        u[C(u, "UnitType").astype(str).isin(considered_types)].copy()
        if "UnitType" in u.columns
        else u.copy()
    )
    actual_ids = (
        set(contacts["ActualUnitID"].dropna())
        if not contacts.empty and "ActualUnitID" in contacts.columns
        else set()
    )
    considered["_detected"] = considered["UnitID"].isin(actual_ids)
    mid = considered.groupby("_side", dropna=False).agg(
        Detected=("_detected", "sum"),
        Considered=("_detected", "size"),
    )

    side_list = []
    if not sides_df.empty and "SideName" in sides_df.columns:
        side_list.extend(sides_df["SideName"].dropna().tolist())
    side_list.extend(mid.index.tolist())
    side_list = list(dict.fromkeys(side_list))

    records = []
    for side in side_list:
        others = mid[mid.index != side]
        found = int(others["Detected"].sum())
        total = int(others["Considered"].sum())
        records.append(
            {
                "分方": side,
                "发现目标数": found,
                "潜在目标数": total,
                "发现率": round(found / total, 4) if total else 0.0,
            }
        )
    output_df = pd.DataFrame(records)[COLS] if records else pd.DataFrame(columns=COLS)
`,
  },

  {
    id: 'isr.identification_latency',
    name: '识别用时',
    chapter: 4,
    category: 'time',
    militaryLevel: 'MOP',
    domainTag: 'isr',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '4.3 识别用时：由探测状态与识别状态分别取各目标首行时间（不排序），计算 IdentificationTime - DetectionTime 并仅保留严格大于阈值的正差值行，附带传感器平台分方。',
    requiredTables: ['DetectionIdentificationChanged'],
    optionalTables: ['EngagementCycle', 'UnitCreated'],
    tableColumns: {
      DetectionIdentificationChanged: [
        'Time',
        'ContactID',
        'IdentificationStatus',
        'ContactActualUnitID',
        'SensorPlatformID',
      ],
      EngagementCycle: ['ContactID', 'ContactActualUnitID'],
      UnitCreated: ['UnitID', 'UnitName', 'UnitSide', 'Side'],
    },
    parameterPorts: [
      {
        key: 'minLatencySec',
        label: '最小正识别用时过滤(秒)',
        dataType: 'number',
        defaultValue: 0,
        description: '仅保留 IdentificationTime - DetectionTime > minLatencySec 的记录，默认 0',
      },
    ],
    outputColumns: ['单元', '识别时间_秒', '分方'],
    pythonCode: `import pandas as pd
import numpy as np

det = T("DetectionIdentificationChanged")
eng = T("EngagementCycle")
units = T("UnitCreated")
COLS = ["单元", "识别时间_秒", "分方"]
min_lat = float(params.get("minLatencySec", 0.0))

u_clean = units.dropna(subset=["UnitID"]).drop_duplicates("UnitID").set_index("UnitID") if not units.empty and "UnitID" in units.columns else pd.DataFrame()
names = u_clean["UnitName"] if "UnitName" in u_clean.columns else pd.Series(dtype=object)
side_col = "UnitSide" if "UnitSide" in u_clean.columns else ("Side" if "Side" in u_clean.columns else None)
u_sides = u_clean[side_col] if side_col else pd.Series(dtype=object)

if (
    isinstance(prev_output_df, pd.DataFrame)
    and not prev_output_df.empty
    and {"DetectionTime", "IdentificationTime"}.issubset(prev_output_df.columns)
):
    c_prev = prev_output_df.copy()
    c_prev["DetectionTime"] = pd.to_datetime(c_prev["DetectionTime"], errors="coerce")
    c_prev["IdentificationTime"] = pd.to_datetime(c_prev["IdentificationTime"], errors="coerce")
    c_prev = c_prev.dropna(subset=["DetectionTime", "IdentificationTime"])
    delta = (c_prev["IdentificationTime"] - c_prev["DetectionTime"]).dt.total_seconds()
    keep = delta > min_lat
    if not bool(keep.any()):
        output_df = pd.DataFrame(columns=COLS)
    else:
        if "UnitName" in c_prev.columns:
            u_col = c_prev["UnitName"]
        elif "ContactActualUnitID" in c_prev.columns:
            u_col = c_prev["ContactActualUnitID"].map(names).fillna(c_prev["ContactActualUnitID"])
        else:
            u_col = pd.Series(c_prev.index.astype(str), index=c_prev.index)
        side_ser = C(c_prev, "分方", "未知").fillna("未知").astype(str)
        output_df = pd.DataFrame({"单元": u_col[keep], "识别时间_秒": delta[keep].round(2), "分方": side_ser[keep]}).reset_index(
            drop=True
        )[COLS]
elif det.empty or "ContactID" not in det.columns or "Time" not in det.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    d = det.copy()
    if (
        "ContactActualUnitID" not in d.columns
        and not eng.empty
        and {"ContactID", "ContactActualUnitID"}.issubset(eng.columns)
    ):
        cmap = eng[["ContactID", "ContactActualUnitID"]].dropna().drop_duplicates("ContactID")
        d = d.merge(cmap, on="ContactID", how="inner")
    d["Time"] = pd.to_datetime(d["Time"], errors="coerce")
    d = d.dropna(subset=["Time"])
    st = (
        C(d, "IdentificationStatus").astype(str)
        if "IdentificationStatus" in d.columns
        else pd.Series("KnownClass", index=d.index)
    )
    key = "ContactActualUnitID" if "ContactActualUnitID" in d.columns else "ContactID"
    if "SensorPlatformID" in d.columns and len(u_sides):
        d["_sensor_side"] = d["SensorPlatformID"].map(u_sides)
    else:
        d["_sensor_side"] = np.nan

    d_det_rows = d.loc[st.isin({"KnownDomain", "KnownType", "KnownClass", "PreciseID"})]
    d_idt_rows = d.loc[st.isin({"KnownClass", "PreciseID"})]

    t_det = d_det_rows.groupby(key)["Time"].first().rename("DetectionTime")
    t_idt = d_idt_rows.groupby(key)["Time"].first().rename("IdentificationTime")
    s_det = d_det_rows.groupby(key)["_sensor_side"].first().rename("SensorSide")
    s_idt = d_idt_rows.groupby(key)["_sensor_side"].first().rename("IdtSensorSide")

    if t_det.empty or t_idt.empty:
        output_df = pd.DataFrame(columns=COLS)
    else:
        chain = pd.concat([t_det, t_idt], axis=1).dropna()
        if chain.empty:
            output_df = pd.DataFrame(columns=COLS)
        else:
            chain = chain.join(s_det, how="left").join(s_idt, how="left")
            delta = (chain["IdentificationTime"] - chain["DetectionTime"]).dt.total_seconds()
            keep = delta > min_lat
            if not bool(keep.any()):
                output_df = pd.DataFrame(columns=COLS)
            else:
                unit_names = pd.Series(chain.index.map(names), index=chain.index).fillna(
                    pd.Series(chain.index.astype(str), index=chain.index)
                )
                fallback_side = pd.Series(chain.index.map(u_sides), index=chain.index) if len(u_sides) else pd.Series("未知", index=chain.index)
                sensor_sides = chain["SensorSide"].fillna(chain["IdtSensorSide"]).fillna(fallback_side).fillna("未知").astype(str)
                output_df = pd.DataFrame(
                    {
                        "单元": unit_names[keep],
                        "识别时间_秒": delta[keep].round(2),
                        "分方": sensor_sides[keep],
                    }
                ).reset_index(drop=True)[COLS]
`,
  },

  {
    id: 'isr.early_warning_time',
    name: '预警时间',
    chapter: 4,
    category: 'time',
    militaryLevel: 'MOE',
    domainTag: 'isr',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '4.4 预警时间：探测记录内连接 ContactCreated 获弹体 ActualUnitID，再关联 WeaponEndgame 终局时间（不筛选 Result），计算 结束时间 - 最小发现时间。',
    requiredTables: ['DetectionIdentificationChanged', 'ContactCreated', 'WeaponEndgame'],
    tableColumns: {
      DetectionIdentificationChanged: ['ContactID', 'Time'],
      ContactCreated: ['ContactID', 'ActualUnitID', 'ActualUnitName'],
      WeaponEndgame: ['WeaponID', 'Time'],
    },
    parameterPorts: [],
    outputColumns: ['被发现单元', '发现时间', '结束时间', '预警时间_秒'],
    pythonCode: `import pandas as pd
import numpy as np

det = T("DetectionIdentificationChanged")
contacts = T("ContactCreated")
endgame = T("WeaponEndgame")
COLS = ["被发现单元", "发现时间", "结束时间", "预警时间_秒"]

if (
    det.empty
    or "ContactID" not in det.columns
    or "Time" not in det.columns
    or contacts.empty
    or "ContactID" not in contacts.columns
):
    output_df = pd.DataFrame(columns=COLS)
else:
    ccols = ["ContactID"] + [c for c in ["ActualUnitID", "ActualUnitName"] if c in contacts.columns]
    c = (
        contacts[ccols]
        .dropna(subset=["ContactID"])
        .drop_duplicates("ContactID")
        .rename(
            columns={
                "ActualUnitID": "ContactActualUnitID",
                "ActualUnitName": "ContactActualUnitName",
            }
        )
    )
    d = det[["ContactID", "Time"]].rename(columns={"Time": "DetectedTime"})
    d["DetectedTime"] = pd.to_datetime(d["DetectedTime"], errors="coerce")
    d = d.merge(c, on="ContactID", how="inner")

    if (
        "ContactActualUnitID" in d.columns
        and not endgame.empty
        and {"WeaponID", "Time"}.issubset(endgame.columns)
    ):
        eg = endgame[["WeaponID", "Time"]].rename(columns={"Time": "EndgameTime"})
        eg["EndgameTime"] = pd.to_datetime(eg["EndgameTime"], errors="coerce")
        d = d.merge(eg, left_on="ContactActualUnitID", right_on="WeaponID", how="inner")
    else:
        d["EndgameTime"] = pd.NaT

    if d.empty or "ContactActualUnitID" not in d.columns:
        output_df = pd.DataFrame(columns=COLS)
    else:
        name_ser = (
            C(d, "ContactActualUnitName", d["ContactActualUnitID"])
            .fillna(d["ContactActualUnitID"])
            .fillna("未知")
        )
        d["_name"] = name_ser
        grp = (
            d.groupby("ContactActualUnitID", dropna=False)
            .agg(
                被发现单元=("_name", "first"),
                发现时间=("DetectedTime", "min"),
                结束时间=("EndgameTime", "first"),
            )
            .reset_index()
        )
        grp["预警时间_秒"] = (grp["结束时间"] - grp["发现时间"]).dt.total_seconds().round(2)
        output_df = grp[COLS].copy()
        for col_t in ["发现时间", "结束时间"]:
            output_df[col_t] = (
                pd.to_datetime(output_df[col_t], errors="coerce")
                .dt.strftime("%Y-%m-%d %H:%M:%S")
                .fillna("")
            )
`,
  },

  {
    id: 'isr.radar_coverage_area',
    name: '侦察效率（探测区域面积）',
    chapter: 4,
    category: 'situation',
    militaryLevel: 'MOE',
    domainTag: 'isr',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '4.5 侦察效率：航迹 1 分钟重采样插值与末点补全，筛选有效开机雷达计算 min(SensorMaxRange, 雷达地平线)，使用纯 numpy 网格计算多雷达并集覆盖面积。',
    requiredTables: ['UnitPositions', 'SensorCreated', 'SensorClassUsed'],
    optionalTables: ['ComponentStatusChanged', 'UnitDestroyed', 'Tick', 'UnitCreated', 'DetectionIdentificationChanged'],
    tableColumns: {
      UnitPositions: [
        'Time',
        'UnitID',
        'UnitLongitude',
        'UnitLatitude',
        'UnitCourse',
        'UnitAltitude_m',
      ],
      SensorCreated: [
        'UnitID',
        'SensorID',
        'SensorDBID',
        'SensorStatus',
        'SensorIsActive',
        'SensorType',
        'SensorMaxRange',
        'SensorHas360Coverage',
      ],
      SensorClassUsed: [
        'SensorDBID',
        'SensorType',
        'SensorMaxRange',
        'SensorHas360Coverage',
      ],
      DetectionIdentificationChanged: [
        'SensorID',
        'SensorDBID',
        'SensorType',
        'SensorPlatformID',
        'SensorPlatformName',
      ],
      ComponentStatusChanged: ['Time', 'ComponentID', 'ComponentStatus'],
      UnitDestroyed: ['Time', 'UnitID'],
      Tick: ['Time'],
      UnitCreated: ['UnitID', 'UnitSide', 'Side'],
    },
    parameterPorts: [
      {
        key: 'targetAltitudeM',
        label: '目标基准高度(米)',
        dataType: 'number',
        defaultValue: 40.0,
        description: '雷达地平线计算的目标高度假设，默认 40 米',
      },
      {
        key: 'gridResolution',
        label: '并集面积网格分辨率',
        dataType: 'number',
        defaultValue: 60,
        description: '用于多雷达并集覆盖面积数值积分的网格步数，默认 60',
      },
      {
        key: 'sectorHalfAngleDeg',
        label: '非360度扇区半角(度)',
        dataType: 'number',
        defaultValue: 60.0,
        description: '非全向雷达沿航向对称覆盖半角，默认 ±60°',
      },
    ],
    outputColumns: ['分方', '时间', '面积_平方米', '面积_平方公里'],
    pythonCode: `import pandas as pd
import numpy as np
import math

target_alt_m = float(params.get("targetAltitudeM", 40.0))
grid_res = max(10, int(params.get("gridResolution", 60)))
sector_half_deg = float(params.get("sectorHalfAngleDeg", 60.0))

def radar_horizon_nm(detection_alt_m, tgt_alt_m):
    a = max(0.0, float(detection_alt_m))
    t = max(0.0, float(tgt_alt_m))
    d1 = math.sqrt(12742000.0 * a + a * a)
    d2 = math.sqrt(12742000.0 * t + t * t)
    return (d1 + d2) / 1852.0

def union_area_m2(circles, grid, half_deg):
    if not circles:
        return 0.0
    xmin = min(c[0] - c[2] for c in circles)
    xmax = max(c[0] + c[2] for c in circles)
    ymin = min(c[1] - c[2] for c in circles)
    ymax = max(c[1] + c[2] for c in circles)
    if xmax <= xmin or ymax <= ymin:
        return 0.0
    x_edges = np.linspace(xmin, xmax, grid + 1)
    y_edges = np.linspace(ymin, ymax, grid + 1)
    gx = (x_edges[:-1] + x_edges[1:]) / 2.0
    gy = (y_edges[:-1] + y_edges[1:]) / 2.0
    X, Y = np.meshgrid(gx, gy)
    covered = np.zeros(X.shape, dtype=bool)
    for cx, cy, r, course, is360 in circles:
        mask = (X - cx) ** 2 + (Y - cy) ** 2 <= r * r
        if not is360:
            bearing = 90.0 - np.degrees(np.arctan2(Y - cy, X - cx))
            diff = (bearing - float(course) + 180.0) % 360.0 - 180.0
            mask = mask & (np.abs(diff) <= half_deg)
        covered = covered | mask
    cell = ((xmax - xmin) / grid) * ((ymax - ymin) / grid)
    return float(covered.sum() * cell)

positions = T("UnitPositions")
sensor_created = T("SensorCreated")
sensor_class = T("SensorClassUsed")
component = T("ComponentStatusChanged")
destroyed = T("UnitDestroyed")
tick = T("Tick")
units = T("UnitCreated")
COLS = ["分方", "时间", "面积_平方米", "面积_平方公里"]

if sensor_created.empty or "UnitID" not in sensor_created.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    sc = sensor_created.copy()
    if (
        not sensor_class.empty
        and "SensorDBID" in sensor_class.columns
        and "SensorDBID" in sc.columns
    ):
        extra = [
            c
            for c in ["SensorDBID", "SensorType", "SensorMaxRange", "SensorHas360Coverage"]
            if c in sensor_class.columns
        ]
        sc = sc.merge(
            sensor_class[extra].drop_duplicates("SensorDBID"),
            on="SensorDBID",
            how="left",
            suffixes=("", "_cls"),
        )
        for col_cls in ["SensorType", "SensorMaxRange", "SensorHas360Coverage"]:
            alt_col = col_cls + "_cls"
            if alt_col in sc.columns:
                if col_cls in sc.columns:
                    sc[col_cls] = sc[col_cls].fillna(sc[alt_col])
                else:
                    sc[col_cls] = sc[alt_col]
    sc_radars = sc[C(sc, "SensorType").astype(str) == "Radar"].copy() if "SensorType" in sc.columns else pd.DataFrame()
    det = T("DetectionIdentificationChanged")
    if sc_radars.empty and not det.empty and "SensorType" in det.columns:
        det_radars = det[C(det, "SensorType").astype(str) == "Radar"].copy()
        if not det_radars.empty and "SensorPlatformID" in det_radars.columns:
            det_r = (
                det_radars[["SensorPlatformID", "SensorDBID"]]
                .dropna(subset=["SensorPlatformID"])
                .drop_duplicates("SensorPlatformID")
                .rename(columns={"SensorPlatformID": "UnitID"})
            )
            if not sensor_class.empty and "SensorDBID" in sensor_class.columns:
                det_r = det_r.merge(
                    sensor_class[["SensorDBID", "SensorMaxRange", "SensorHas360Coverage"]].drop_duplicates("SensorDBID"),
                    on="SensorDBID",
                    how="left",
                )
            det_r["_maxrange"] = pd.to_numeric(C(det_r, "SensorMaxRange", 150.0), errors="coerce").fillna(150.0)
            det_r["_is360"] = C(det_r, "SensorHas360Coverage", True).astype(str).str.lower().isin(["true", "1", "1.0"])
            radar = det_r[["UnitID", "_maxrange", "_is360"]].dropna(subset=["UnitID"]).drop_duplicates("UnitID")
        else:
            radar = pd.DataFrame(columns=["UnitID", "_maxrange", "_is360"])
    else:
        sc = sc_radars
        sc["_active"] = C(sc, "SensorIsActive", True).astype(str).str.lower().isin(["true", "1", "1.0"])
        sc["_status"] = C(sc, "SensorStatus", "Operational").astype(str)
        if not component.empty and {"Time", "ComponentStatus"}.issubset(component.columns):
            comp = component.copy()
            comp["Time"] = pd.to_datetime(comp["Time"], errors="coerce")
            comp = comp.dropna(subset=["Time"]).sort_values("Time")
            if not comp.empty and "ComponentID" in comp.columns and "SensorID" in sc.columns:
                last = comp.groupby("ComponentID")["ComponentStatus"].last()
                sc["_status"] = sc["SensorID"].map(last).fillna(sc["_status"])
        sc = sc[sc["_active"] & (sc["_status"] == "Operational")].copy()
        sc["_maxrange"] = pd.to_numeric(C(sc, "SensorMaxRange", 0), errors="coerce").fillna(0.0)
        sc["_is360"] = (
            C(sc, "SensorHas360Coverage", True)
            .astype(str)
            .str.lower()
            .isin(["true", "1", "1.0"])
        )
        radar = sc[["UnitID", "_maxrange", "_is360"]].dropna(subset=["UnitID"]).drop_duplicates("UnitID")

    if radar.empty:
        output_df = pd.DataFrame(columns=COLS)
    else:
        tick_times = (
            pd.to_datetime(C(tick, "Time", pd.NaT), errors="coerce").dropna()
            if not tick.empty
            else pd.Series(dtype="datetime64[ns]")
        )
        t_end = tick_times.max() if len(tick_times) else pd.NaT
        dest_time = {}
        if not destroyed.empty and {"UnitID", "Time"}.issubset(destroyed.columns):
            dd = destroyed.copy()
            dd["Time"] = pd.to_datetime(dd["Time"], errors="coerce")
            dest_time = dd.dropna(subset=["Time"]).groupby("UnitID")["Time"].first().to_dict()

        num_cols = [
            c
            for c in ["UnitLongitude", "UnitLatitude", "UnitCourse", "UnitAltitude_m"]
            if c in positions.columns
        ]
        frames = []
        if not positions.empty and {"Time", "UnitID"}.issubset(positions.columns) and num_cols:
            p = positions[["Time", "UnitID"] + num_cols].copy()
            p["Time"] = pd.to_datetime(p["Time"], errors="coerce")
            for c in num_cols:
                p[c] = pd.to_numeric(p[c], errors="coerce").astype(float)
            p = p.dropna(subset=["Time", "UnitID"])
            p = p[p["UnitID"].isin(set(radar["UnitID"]))]
            for uid, g in p.groupby("UnitID"):
                s = g.set_index("Time")[num_cols].resample("1min").mean().interpolate("index")
                target = dest_time.get(uid, t_end)
                if len(s) and pd.notna(target) and abs((s.index[-1] - target).total_seconds()) > 5:
                    s.loc[target] = s.iloc[-1]
                    s = s.sort_index()
                s["UnitID"] = uid
                frames.append(s.reset_index())

        rs = (
            pd.concat(frames, ignore_index=True)
            if frames
            else pd.DataFrame(columns=["Time", "UnitID"] + num_cols)
        )

        if not units.empty and "UnitID" in units.columns:
            side_col = "UnitSide" if "UnitSide" in units.columns else ("Side" if "Side" in units.columns else None)
            uside = (
                units.dropna(subset=["UnitID"]).drop_duplicates("UnitID").set_index("UnitID")[side_col]
                if side_col
                else pd.Series(dtype=object)
            )
        else:
            uside = pd.Series(dtype=object)

        if rs.empty:
            output_df = pd.DataFrame(columns=COLS)
        else:
            rs["_side"] = rs["UnitID"].map(uside).fillna("未知")
            rs = rs.merge(radar, on="UnitID", how="inner")
            records = []
            for (t_val, side), g in rs.groupby(["Time", "_side"], dropna=False):
                lat_ser = pd.to_numeric(C(g, "UnitLatitude", 0.0), errors="coerce").fillna(0.0)
                lon_ser = pd.to_numeric(C(g, "UnitLongitude", 0.0), errors="coerce").fillna(0.0)
                lat0 = float(lat_ser.mean()) if len(lat_ser) else 0.0
                lon0 = float(lon_ser.mean()) if len(lon_ser) else 0.0
                m_per_lon = 111320.0 * max(0.01, math.cos(math.radians(lat0)))
                circles = []
                for _, row in g.iterrows():
                    alt_val = row["UnitAltitude_m"] if "UnitAltitude_m" in g.columns else 0.0
                    alt = float(alt_val) if pd.notna(alt_val) else 0.0
                    eff = min(float(row["_maxrange"]), radar_horizon_nm(alt, target_alt_m))
                    lon_v = row["UnitLongitude"] if "UnitLongitude" in g.columns and pd.notna(row["UnitLongitude"]) else lon0
                    lat_v = row["UnitLatitude"] if "UnitLatitude" in g.columns and pd.notna(row["UnitLatitude"]) else lat0
                    cx = (float(lon_v) - lon0) * m_per_lon
                    cy = (float(lat_v) - lat0) * 111320.0
                    course_val = row["UnitCourse"] if "UnitCourse" in g.columns else 0.0
                    course = float(course_val) if pd.notna(course_val) else 0.0
                    circles.append((cx, cy, eff * 1852.0, course, bool(row["_is360"])))
                area = union_area_m2(circles, grid_res, sector_half_deg)
                records.append(
                    {
                        "分方": side,
                        "时间": t_val,
                        "面积_平方米": round(area, 2),
                        "面积_平方公里": round(area / 1.0e6, 4),
                    }
                )
            output_df = pd.DataFrame(records)[COLS] if records else pd.DataFrame(columns=COLS)

if not output_df.empty:
    output_df["时间"] = (
        pd.to_datetime(output_df["时间"], errors="coerce")
        .dt.strftime("%Y-%m-%d %H:%M:%S")
        .fillna("")
    )
`,
  },

  // ──────────────────── 第 5 章：指挥控制体系效能（1 项） ────────────────────
  {
    id: 'c2.situational_completeness',
    name: '态势完整度',
    chapter: 5,
    category: 'situation',
    militaryLevel: 'MOE',
    domainTag: 'c2',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '5.1 态势完整度：以 UnitType != "Group" 全集（含武器）重算己方全知单元与非己方被发现目标数之比，独立于 4.2 发现率口径。',
    requiredTables: ['UnitCreated', 'ContactCreated'],
    optionalTables: ['SideCreated'],
    tableColumns: {
      UnitCreated: ['UnitID', 'UnitType', 'UnitSide', 'Side'],
      ContactCreated: ['ContactID', 'ActualUnitID'],
      SideCreated: ['SideName'],
    },
    parameterPorts: [
      {
        key: 'excludedUnitTypes',
        label: '排除单元类型',
        dataType: 'json',
        defaultValue: ['Group'],
        description: '默认仅排除 Group 编组节点，纳入含武器在内的全部作战实体',
      },
    ],
    outputColumns: ['分方', '呈现单元数', '所有单元数', '态势呈现率', '态势完整度'],
    pythonCode: `import pandas as pd
import numpy as np

units = T("UnitCreated")
contacts = T("ContactCreated")
sides_df = T("SideCreated")
COLS = ["分方", "呈现单元数", "所有单元数", "态势呈现率", "态势完整度"]

raw_excl = params.get("excludedUnitTypes", ["Group"])
excluded_types = (
    [str(x) for x in raw_excl]
    if isinstance(raw_excl, (list, tuple, set))
    else ["Group"]
)

if units.empty or "UnitID" not in units.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    u = units.dropna(subset=["UnitID"]).drop_duplicates("UnitID").copy()
    side_col = "UnitSide" if "UnitSide" in u.columns else ("Side" if "Side" in u.columns else None)
    u["_side"] = C(u, side_col, "未知").fillna("未知") if side_col else "未知"
    universe = (
        u[~C(u, "UnitType").astype(str).isin(excluded_types)].copy()
        if "UnitType" in u.columns
        else u.copy()
    )
    actual_ids = (
        set(contacts["ActualUnitID"].dropna())
        if not contacts.empty and "ActualUnitID" in contacts.columns
        else set()
    )
    universe["_detected"] = universe["UnitID"].isin(actual_ids)
    mid = universe.groupby("_side", dropna=False).agg(
        Detected=("_detected", "sum"),
        Considered=("_detected", "size"),
    )

    side_list = []
    if not sides_df.empty and "SideName" in sides_df.columns:
        side_list.extend(sides_df["SideName"].dropna().tolist())
    side_list.extend(mid.index.tolist())
    side_list = list(dict.fromkeys(side_list))
    total_all = int(mid["Considered"].sum())

    records = []
    for side in side_list:
        own = int(mid["Considered"].get(side, 0))
        others = mid[mid.index != side]
        known = int(others["Detected"].sum()) + own
        considered = int(others["Considered"].sum()) + own
        denom = considered if considered else total_all
        rate_val = round(known / denom, 4) if denom else 0.0
        records.append(
            {
                "分方": side,
                "呈现单元数": known,
                "所有单元数": denom,
                "态势呈现率": rate_val,
                "态势完整度": rate_val,
            }
        )
    output_df = pd.DataFrame(records)[COLS] if records else pd.DataFrame(columns=COLS)
`,
  },

  // ──────────────────── 第 6 章：电子干扰电子进攻体系效能（3 项） ────────────────────
  {
    id: 'ew.jamming_duration',
    name: '持续干扰时间',
    chapter: 6,
    category: 'time',
    militaryLevel: 'MOP',
    domainTag: 'synergy',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '6.1 持续干扰时间：解析 UnitJammed 的 jammed/unjammed 交替区间（首条非 jammed 补推演起点，末条 jammed 补被毁/推演终点），配对积分求和并排除 Group。',
    requiredTables: ['UnitJammed'],
    optionalTables: ['Tick', 'UnitDestroyed', 'UnitCreated'],
    tableColumns: {
      UnitJammed: ['Time', 'UnitID', 'Status'],
      Tick: ['Time'],
      UnitDestroyed: ['Time', 'UnitID'],
      UnitCreated: ['UnitID', 'UnitName', 'UnitSide', 'Side', 'UnitType'],
    },
    parameterPorts: [
      {
        key: 'excludedUnitTypes',
        label: '排除单元类型',
        dataType: 'json',
        defaultValue: ['Group'],
        description: '过滤的编组单元类型，默认 ["Group"]',
      },
    ],
    outputColumns: ['单元ID', '单元名', '分方', '累计受扰秒数'],
    pythonCode: `import pandas as pd
import numpy as np

uj_df = T("UnitJammed")
tick = T("Tick")
destroyed = T("UnitDestroyed")
units = T("UnitCreated")
COLS = ["单元ID", "单元名", "分方", "累计受扰秒数"]

raw_excl = params.get("excludedUnitTypes", ["Group"])
excluded_types = (
    [str(x) for x in raw_excl]
    if isinstance(raw_excl, (list, tuple, set))
    else ["Group"]
)

if uj_df.empty or not {"UnitID", "Time", "Status"}.issubset(uj_df.columns):
    output_df = pd.DataFrame(columns=COLS)
else:
    uj = uj_df.copy()
    uj["Time"] = pd.to_datetime(uj["Time"], errors="coerce")
    uj = uj.dropna(subset=["UnitID", "Time"])
    if uj.empty:
        output_df = pd.DataFrame(columns=COLS)
    else:
        uj["_jammed"] = C(uj, "Status").astype(str).str.lower().eq("jammed")
        tick_times = (
            pd.to_datetime(C(tick, "Time", pd.NaT), errors="coerce").dropna()
            if not tick.empty
            else pd.Series(dtype="datetime64[ns]")
        )
        t_begin = tick_times.min() if len(tick_times) else uj["Time"].min()
        t_end = tick_times.max() if len(tick_times) else uj["Time"].max()
        dest_time = {}
        if not destroyed.empty and {"UnitID", "Time"}.issubset(destroyed.columns):
            dd = destroyed.copy()
            dd["Time"] = pd.to_datetime(dd["Time"], errors="coerce")
            dest_time = (
                dd.dropna(subset=["UnitID", "Time"])
                .sort_values("Time")
                .groupby("UnitID")["Time"]
                .first()
                .to_dict()
            )
        info = (
            units.dropna(subset=["UnitID"]).drop_duplicates("UnitID").set_index("UnitID")
            if not units.empty and "UnitID" in units.columns
            else pd.DataFrame()
        )

        records = []
        for uid, g in uj.sort_values("Time").groupby("UnitID"):
            g = g.sort_values("Time")
            ts = []
            if not bool(g.iloc[0]["_jammed"]):
                ts.append(t_begin)
            ts.extend(g["Time"].tolist())
            if bool(g.iloc[-1]["_jammed"]):
                ts.append(dest_time.get(uid, t_end))
            if len(ts) % 2 != 0:
                ts.append(dest_time.get(uid, t_end))
            s = pd.Series(pd.to_datetime(ts)).dropna()
            duration = (
                float(
                    (
                        s.iloc[1::2].reset_index(drop=True) - s.iloc[::2].reset_index(drop=True)
                    )
                    .dt.total_seconds()
                    .sum()
                )
                if len(s) >= 2
                else 0.0
            )
            name, side = uid, "未知"
            if len(info) and uid in info.index:
                row = info.loc[uid]
                if "UnitName" in info.columns and pd.notna(row["UnitName"]):
                    name = row["UnitName"]
                if "UnitSide" in info.columns and pd.notna(row["UnitSide"]):
                    side = row["UnitSide"]
                elif "Side" in info.columns and pd.notna(row["Side"]):
                    side = row["Side"]
            records.append(
                {
                    "单元ID": uid,
                    "单元名": name,
                    "分方": side,
                    "累计受扰秒数": round(duration, 2),
                }
            )

        if not records:
            output_df = pd.DataFrame(columns=COLS)
        else:
            out = pd.DataFrame(records)
            if not info.empty and "UnitType" in info.columns and len(excluded_types) > 0:
                out = out[~out["单元ID"].map(info["UnitType"]).isin(excluded_types)]
            output_df = out[COLS].reset_index(drop=True)
`,
  },

  {
    id: 'ew.hf_comm_jamming_detail',
    name: '短波通信网台干扰明细',
    chapter: 6,
    category: 'effectiveness',
    militaryLevel: 'MOP',
    domainTag: 'synergy',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '6.2.1 短波通信网台干扰明细：筛选 HF_Radio=True 的短波通信网台，针对 CommIsJammedChanged 中有状态变更的网台计算交替区间受扰秒数、平台运行秒数及干扰占比。',
    requiredTables: ['CommCreated', 'CommClassUsed', 'CommIsJammedChanged'],
    optionalTables: ['UnitCreated', 'UnitDestroyed', 'Tick'],
    tableColumns: {
      CommCreated: ['CommID', 'CommName', 'CommDBID', 'UnitID', 'UnitName'],
      CommClassUsed: ['CommDBID', 'HF_Radio'],
      CommIsJammedChanged: ['CommID', 'Time', 'IsJammed'],
      UnitCreated: ['UnitID', 'UnitSide', 'Side'],
      UnitDestroyed: ['Time', 'UnitID'],
      Tick: ['Time'],
    },
    parameterPorts: [],
    outputColumns: ['通信网台名', '平台单元名', '被干扰秒数', '运行秒数', '干扰占比', '干扰时间占比', '分方'],
    pythonCode: `import pandas as pd
import numpy as np

comm = T("CommCreated")
comm_class = T("CommClassUsed")
jam = T("CommIsJammedChanged")
units = T("UnitCreated")
destroyed = T("UnitDestroyed")
tick = T("Tick")
COLS = ["通信网台名", "平台单元名", "被干扰秒数", "运行秒数", "干扰占比", "干扰时间占比", "分方"]

if comm.empty or "CommID" not in comm.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    hf = comm.copy()
    if (
        not comm_class.empty
        and {"CommDBID", "HF_Radio"}.issubset(comm_class.columns)
        and "CommDBID" in hf.columns
    ):
        hf = hf.merge(
            comm_class[["CommDBID", "HF_Radio"]].drop_duplicates("CommDBID"),
            on="CommDBID",
            how="left",
        )
        mask = C(hf, "HF_Radio", False).astype(str).str.lower().isin(["true", "1", "1.0"])
        hf = hf[mask]
    else:
        hf = hf.iloc[0:0]

    if hf.empty or jam.empty or not {"CommID", "Time"}.issubset(jam.columns):
        output_df = pd.DataFrame(columns=COLS)
    else:
        state = jam.copy()
        state["Time"] = pd.to_datetime(state["Time"], errors="coerce")
        state["_jammed"] = (
            C(state, "IsJammed", False).astype(str).str.lower().isin(["true", "1", "1.0"])
        )
        state = state.dropna(subset=["CommID", "Time"])

        tick_times = (
            pd.to_datetime(C(tick, "Time", pd.NaT), errors="coerce").dropna()
            if not tick.empty
            else pd.Series(dtype="datetime64[ns]")
        )
        t_begin = (
            tick_times.min()
            if len(tick_times)
            else (state["Time"].min() if len(state) else pd.NaT)
        )
        t_end = (
            tick_times.max()
            if len(tick_times)
            else (state["Time"].max() if len(state) else pd.NaT)
        )

        dest_time = {}
        if not destroyed.empty and {"UnitID", "Time"}.issubset(destroyed.columns):
            dd = destroyed.copy()
            dd["Time"] = pd.to_datetime(dd["Time"], errors="coerce")
            dest_time = (
                dd.dropna(subset=["UnitID", "Time"])
                .sort_values("Time")
                .groupby("UnitID")["Time"]
                .first()
                .to_dict()
            )

        side_col = (
            "UnitSide"
            if not units.empty and "UnitSide" in units.columns
            else ("Side" if not units.empty and "Side" in units.columns else None)
        )
        side_map = (
            units.dropna(subset=["UnitID"]).drop_duplicates("UnitID").set_index("UnitID")[side_col]
            if side_col and "UnitID" in units.columns
            else pd.Series(dtype=object)
        )

        hf_ids = set(hf["CommID"].dropna())
        rows = []
        for cid, g in state.groupby("CommID"):
            if cid not in hf_ids:
                continue
            g = g.sort_values("Time")
            info = hf[hf["CommID"] == cid].iloc[0]
            uid = info["UnitID"] if "UnitID" in info.index else None
            end = dest_time.get(uid, t_end)
            ts = []
            if not bool(g.iloc[0]["_jammed"]):
                ts.append(t_begin)
            ts.extend(g["Time"].tolist())
            if bool(g.iloc[-1]["_jammed"]):
                ts.append(end)
            if len(ts) % 2 != 0:
                ts.append(end)
            s = pd.Series(pd.to_datetime(ts)).dropna()
            if len(s) < 2:
                continue
            jammed_sec = float(
                (s.iloc[1::2].reset_index(drop=True) - s.iloc[::2].reset_index(drop=True))
                .dt.total_seconds()
                .sum()
            )
            operating_sec = (
                float((end - t_begin).total_seconds())
                if pd.notna(end) and pd.notna(t_begin)
                else 0.0
            )
            side_val = "未知"
            if uid is not None and isinstance(side_map, pd.Series) and uid in side_map.index:
                cand_side = side_map.loc[uid]
                if pd.notna(cand_side):
                    side_val = cand_side
            comm_name = info["CommName"] if "CommName" in info.index and pd.notna(info["CommName"]) else cid
            plat_name = (
                info["UnitName"]
                if "UnitName" in info.index and pd.notna(info["UnitName"])
                else (uid if uid is not None else "未知")
            )
            ratio_val = round(jammed_sec / operating_sec, 4) if operating_sec > 0 else 0.0
            rows.append(
                {
                    "通信网台名": comm_name,
                    "平台单元名": plat_name,
                    "被干扰秒数": round(jammed_sec, 2),
                    "运行秒数": round(operating_sec, 2),
                    "干扰占比": ratio_val,
                    "干扰时间占比": ratio_val,
                    "分方": side_val,
                }
            )
        output_df = pd.DataFrame(rows)[COLS] if rows else pd.DataFrame(columns=COLS)
`,
  },

  {
    id: 'ew.hf_comm_jamming_side_summary',
    name: '短波通信分方汇总',
    chapter: 6,
    category: 'effectiveness',
    militaryLevel: 'MOE',
    domainTag: 'synergy',
    layer: 'legacy_aggregate',
    engineKind: 'python_script',
    description:
      '6.2.2 短波通信分方汇总：统计全部短波网台 (HF_Radio=True) 按所属分方汇总，按是否出现在 CommIsJammedChanged 中计数被干扰网台数（非干扰占比 > 0）。',
    requiredTables: ['CommCreated', 'CommClassUsed', 'CommIsJammedChanged'],
    optionalTables: ['UnitCreated'],
    tableColumns: {
      CommCreated: ['CommID', 'CommDBID', 'UnitID'],
      CommClassUsed: ['CommDBID', 'HF_Radio'],
      CommIsJammedChanged: ['CommID'],
      UnitCreated: ['UnitID', 'UnitSide', 'Side'],
    },
    parameterPorts: [],
    outputColumns: ['分方', '被干扰网台数', '通信网台数', '干扰率'],
    pythonCode: `import pandas as pd
import numpy as np

comm = T("CommCreated")
comm_class = T("CommClassUsed")
jam = T("CommIsJammedChanged")
units = T("UnitCreated")
COLS = ["分方", "被干扰网台数", "通信网台数", "干扰率"]

if comm.empty or "CommID" not in comm.columns:
    output_df = pd.DataFrame(columns=COLS)
else:
    hf = comm.copy()
    if (
        not comm_class.empty
        and {"CommDBID", "HF_Radio"}.issubset(comm_class.columns)
        and "CommDBID" in hf.columns
    ):
        hf = hf.merge(
            comm_class[["CommDBID", "HF_Radio"]].drop_duplicates("CommDBID"),
            on="CommDBID",
            how="left",
        )
        hf = hf[C(hf, "HF_Radio", False).astype(str).str.lower().isin(["true", "1", "1.0"])].copy()
    else:
        hf = hf.iloc[0:0]

    if hf.empty:
        output_df = pd.DataFrame(columns=COLS)
    else:
        side_col = (
            "UnitSide"
            if not units.empty and "UnitSide" in units.columns
            else ("Side" if not units.empty and "Side" in units.columns else None)
        )
        side_map = (
            units.dropna(subset=["UnitID"]).drop_duplicates("UnitID").set_index("UnitID")[side_col]
            if side_col and "UnitID" in units.columns
            else pd.Series(dtype=object)
        )
        hf["_side"] = hf["UnitID"].map(side_map).fillna("未知") if "UnitID" in hf.columns else "未知"
        jammed_ids = (
            set(jam["CommID"].dropna())
            if not jam.empty and "CommID" in jam.columns
            else set()
        )
        hf["_any_jammed"] = hf["CommID"].isin(jammed_ids)
        out = hf.groupby("_side", dropna=False).agg(
            被干扰网台数=("_any_jammed", "sum"),
            通信网台数=("CommID", "size"),
        ).reset_index()
        out["干扰率"] = (out["被干扰网台数"] / out["通信网台数"]).round(4)
        output_df = pd.DataFrame(
            {
                "分方": out["_side"],
                "被干扰网台数": out["被干扰网台数"].astype(int),
                "通信网台数": out["通信网台数"].astype(int),
                "干扰率": out["干扰率"],
            }
        )[COLS]
`,
  },

  // ──────────────────── 第 7 章：防空反导体系效能（4 项） ────────────────────
  {
    id: 'air_defense.detection_zone',
    name: '防空探测区域',
    chapter: 7,
    category: 'situation',
    militaryLevel: 'MOP',
    domainTag: 'firepower',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '7.1 探测区域：FirstSensorToUnitRecordCreated 关联 SensorCreated 与 UnitCreated，筛选地面防空单元 (Facility/Vehicle) 并按 (分方, UnitDBID) 取最大首次探测距离。',
    requiredTables: ['FirstSensorToUnitRecordCreated', 'SensorCreated', 'UnitCreated'],
    optionalTables: ['DetectionIdentificationChanged'],
    tableColumns: {
      FirstSensorToUnitRecordCreated: ['SensorID', 'Distance'],
      SensorCreated: ['SensorID', 'UnitID'],
      UnitCreated: ['UnitID', 'UnitType', 'UnitSide', 'Side', 'UnitDBID', 'UnitClass'],
      DetectionIdentificationChanged: ['SensorID', 'SensorPlatformID'],
    },
    parameterPorts: [
      {
        key: 'unitTypes',
        label: '地面/水面防空单元类型',
        dataType: 'json',
        defaultValue: ['Facility', 'Vehicle', 'Ship', '设施', '车辆', '舰船', '水面舰艇'],
        description: '防空探测单元类型，默认纳入 ["Facility", "Vehicle", "Ship", "设施", "车辆", "舰船", "水面舰艇"]',
      },
    ],
    outputColumns: ['型号', '分方', '最大探测距离_海里'],
    pythonCode: `import pandas as pd
import numpy as np

first = T("FirstSensorToUnitRecordCreated")
sensors = T("SensorCreated")
units = T("UnitCreated")
det = T("DetectionIdentificationChanged")
COLS = ["型号", "分方", "最大探测距离_海里"]

raw_utypes = params.get("unitTypes", ["Facility", "Vehicle", "Ship", "设施", "车辆", "舰船", "水面舰艇"])
target_types = (
    [str(x) for x in raw_utypes]
    if isinstance(raw_utypes, (list, tuple, set)) and len(raw_utypes) > 0
    else ["Facility", "Vehicle", "Ship", "设施", "车辆", "舰船", "水面舰艇"]
)

if (
    first.empty
    or "SensorID" not in first.columns
    or (sensors.empty and det.empty)
    or units.empty
    or "UnitID" not in units.columns
):
    output_df = pd.DataFrame(columns=COLS)
else:
    fcols = ["SensorID"] + [c for c in ["Distance"] if c in first.columns]
    s_map = (
        sensors[["SensorID", "UnitID"]].dropna(subset=["SensorID"]).drop_duplicates("SensorID")
        if not sensors.empty and "SensorID" in sensors.columns and "UnitID" in sensors.columns
        else pd.DataFrame(columns=["SensorID", "UnitID"])
    )
    if not det.empty and "SensorID" in det.columns and "SensorPlatformID" in det.columns:
        det_map = (
            det[["SensorID", "SensorPlatformID"]]
            .dropna(subset=["SensorID", "SensorPlatformID"])
            .rename(columns={"SensorPlatformID": "UnitID"})
            .drop_duplicates("SensorID")
        )
        s_map = pd.concat([s_map, det_map]).drop_duplicates("SensorID") if not s_map.empty else det_map

    d = first[fcols].merge(
        s_map,
        on="SensorID",
        how="inner",
    )
    ucols = ["UnitID"] + [
        c for c in ["UnitType", "UnitSide", "Side", "UnitDBID", "UnitClass"] if c in units.columns
    ]
    d = (
        d.merge(
            units[ucols].dropna(subset=["UnitID"]).drop_duplicates("UnitID"),
            on="UnitID",
            how="inner",
        )
        if "UnitID" in d.columns
        else d.iloc[0:0]
    )
    d["Distance"] = pd.to_numeric(C(d, "Distance", np.nan), errors="coerce")
    d = d[C(d, "UnitType").astype(str).isin(target_types)].copy()
    if d.empty:
        output_df = pd.DataFrame(columns=COLS)
    else:
        side_col = "UnitSide" if "UnitSide" in d.columns else ("Side" if "Side" in d.columns else None)
        d["_side"] = C(d, side_col, "未知").fillna("未知") if side_col else "未知"
        d["_dbid"] = C(d, "UnitDBID", "未知").astype(str)
        d["_class"] = C(d, "UnitClass", "未知型号").fillna("未知型号")
        out = (
            d.groupby(["_side", "_dbid"], dropna=False)
            .agg(最大探测距离_海里=("Distance", "max"), 型号=("_class", "first"))
            .reset_index()
        )
        output_df = pd.DataFrame(
            {
                "型号": out["型号"],
                "分方": out["_side"],
                "最大探测距离_海里": pd.to_numeric(out["最大探测距离_海里"], errors="coerce").round(2),
            }
        )[COLS]
`,
  },

  {
    id: 'air_defense.unit_intercept_zone',
    name: '拦截区域（单元级）',
    chapter: 7,
    category: 'effectiveness',
    militaryLevel: 'MOP',
    domainTag: 'firepower',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '7.2.1 拦截区域（单元级）：筛选 SAM 击落记录（Result=KILL、目标 Aircraft/Weapon、发射平台 Facility），按发射单元 ParentFiringUnitID 统计最远拦截水平距离。',
    requiredTables: ['WeaponEndgame', 'UnitCreated'],
    tableColumns: {
      WeaponEndgame: [
        'Result',
        'TargetID',
        'ParentFiringUnitID',
        'ParentFiringUnitName',
        'DistanceFromFiringUnit_Horiz',
      ],
      UnitCreated: ['UnitID', 'UnitClass', 'UnitType', 'UnitSide', 'Side', 'UnitDBID'],
    },
    parameterPorts: [],
    outputColumns: ['发射平台ID', '发射平台名', '分方', '发射平台型号', '发射距离_海里'],
    pythonCode: `import pandas as pd
import numpy as np

endgame = T("WeaponEndgame")
units = T("UnitCreated")
COLS = ["发射平台ID", "发射平台名", "分方", "发射平台型号", "发射距离_海里"]

if (
    endgame.empty
    or "Result" not in endgame.columns
    or units.empty
    or "UnitID" not in units.columns
):
    output_df = pd.DataFrame(columns=COLS)
else:
    k = endgame[C(endgame, "Result").astype(str) == "KILL"].copy()
    if k.empty or "TargetID" not in k.columns or "ParentFiringUnitID" not in k.columns:
        output_df = pd.DataFrame(columns=COLS)
    else:
        u_clean = units.dropna(subset=["UnitID"]).drop_duplicates("UnitID")
        if "UnitType" in u_clean.columns:
            t = u_clean[["UnitID", "UnitType"]].rename(
                columns={"UnitID": "TargetID", "UnitType": "TargetUnitType"}
            )
            k = k.merge(t, on="TargetID", how="inner")
        else:
            k["TargetUnitType"] = "Aircraft"

        pcols = ["UnitID"] + [
            c for c in ["UnitClass", "UnitType", "UnitSide", "Side", "UnitDBID"] if c in u_clean.columns
        ]
        p = u_clean[pcols].rename(
            columns={
                "UnitID": "ParentFiringUnitID",
                "UnitClass": "_class",
                "UnitType": "_ptype",
                "UnitDBID": "_dbid",
                "UnitSide": "_side",
                "Side": "_side2",
            }
        )
        k = k.merge(p, on="ParentFiringUnitID", how="inner")
        if "_side" not in k.columns:
            k["_side"] = C(k, "_side2", "未知")
        if "_ptype" not in k.columns:
            k["_ptype"] = "Facility"
        if "_class" not in k.columns:
            k["_class"] = "未知型号"
        target_types = ["Aircraft", "Weapon", "飞机", "武器"]
        firing_types = ["Facility", "Vehicle", "Ship", "设施", "车辆", "舰船", "水面舰艇"]
        k = k[
            C(k, "TargetUnitType").astype(str).isin(target_types)
            & C(k, "_ptype").astype(str).isin(firing_types)
        ].copy()
        if k.empty:
            output_df = pd.DataFrame(columns=COLS)
        else:
            k["_dist"] = pd.to_numeric(C(k, "DistanceFromFiringUnit_Horiz", np.nan), errors="coerce")
            k["_fname"] = (
                C(k, "ParentFiringUnitName", k["ParentFiringUnitID"]).fillna(k["ParentFiringUnitID"])
                if "ParentFiringUnitName" in k.columns
                else k["ParentFiringUnitID"]
            )
            out = (
                k.groupby("ParentFiringUnitID", dropna=False)
                .agg(
                    发射距离_海里=("_dist", "max"),
                    发射平台名=("_fname", "first"),
                    分方=("_side", "first"),
                    发射平台型号=("_class", "first"),
                )
                .reset_index()
            )
            output_df = pd.DataFrame(
                {
                    "发射平台ID": out["ParentFiringUnitID"],
                    "发射平台名": out["发射平台名"].fillna(out["ParentFiringUnitID"]),
                    "分方": out["分方"].fillna("未知"),
                    "发射平台型号": out["发射平台型号"].fillna("未知型号"),
                    "发射距离_海里": pd.to_numeric(out["发射距离_海里"], errors="coerce").round(2),
                }
            )[COLS]
`,
  },

  {
    id: 'air_defense.model_intercept_zone',
    name: '拦截区域（型号级）',
    chapter: 7,
    category: 'effectiveness',
    militaryLevel: 'MOP',
    domainTag: 'firepower',
    layer: 'legacy_aggregate',
    engineKind: 'python_script',
    description:
      '7.2.2 拦截区域（型号级）：在 SAM 击落记录上按 (发射方, 发射平台 UnitDBID) 分组取最远拦截水平距离。',
    requiredTables: ['WeaponEndgame', 'UnitCreated'],
    tableColumns: {
      WeaponEndgame: [
        'Result',
        'TargetID',
        'ParentFiringUnitID',
        'DistanceFromFiringUnit_Horiz',
      ],
      UnitCreated: ['UnitID', 'UnitClass', 'UnitType', 'UnitSide', 'Side', 'UnitDBID'],
    },
    parameterPorts: [],
    outputColumns: ['发射平台型号', '分方', '发射距离_海里'],
    pythonCode: `import pandas as pd
import numpy as np

endgame = T("WeaponEndgame")
units = T("UnitCreated")
COLS = ["发射平台型号", "分方", "发射距离_海里"]

if (
    endgame.empty
    or "Result" not in endgame.columns
    or units.empty
    or "UnitID" not in units.columns
):
    output_df = pd.DataFrame(columns=COLS)
else:
    k = endgame[C(endgame, "Result").astype(str) == "KILL"].copy()
    if k.empty or "TargetID" not in k.columns or "ParentFiringUnitID" not in k.columns:
        output_df = pd.DataFrame(columns=COLS)
    else:
        u_clean = units.dropna(subset=["UnitID"]).drop_duplicates("UnitID")
        if "UnitType" in u_clean.columns:
            t = u_clean[["UnitID", "UnitType"]].rename(
                columns={"UnitID": "TargetID", "UnitType": "TargetUnitType"}
            )
            k = k.merge(t, on="TargetID", how="inner")
        else:
            k["TargetUnitType"] = "Aircraft"

        pcols = ["UnitID"] + [
            c for c in ["UnitClass", "UnitType", "UnitSide", "Side", "UnitDBID"] if c in u_clean.columns
        ]
        p = u_clean[pcols].rename(
            columns={
                "UnitID": "ParentFiringUnitID",
                "UnitClass": "_class",
                "UnitType": "_ptype",
                "UnitDBID": "_dbid",
                "UnitSide": "_side",
                "Side": "_side2",
            }
        )
        k = k.merge(p, on="ParentFiringUnitID", how="inner")
        if "_side" not in k.columns:
            k["_side"] = C(k, "_side2", "未知")
        if "_ptype" not in k.columns:
            k["_ptype"] = "Facility"
        if "_class" not in k.columns:
            k["_class"] = "未知型号"
        if "_dbid" not in k.columns:
            k["_dbid"] = "未知"
        target_types = ["Aircraft", "Weapon", "飞机", "武器"]
        firing_types = ["Facility", "Vehicle", "Ship", "设施", "车辆", "舰船", "水面舰艇"]
        k = k[
            C(k, "TargetUnitType").astype(str).isin(target_types)
            & C(k, "_ptype").astype(str).isin(firing_types)
        ].copy()
        if k.empty:
            output_df = pd.DataFrame(columns=COLS)
        else:
            k["_dist"] = pd.to_numeric(C(k, "DistanceFromFiringUnit_Horiz", np.nan), errors="coerce")
            k["_dbid"] = k["_dbid"].astype(str)
            out = (
                k.groupby(["_side", "_dbid"], dropna=False)
                .agg(发射距离_海里=("_dist", "max"), 发射平台型号=("_class", "first"))
                .reset_index()
            )
            output_df = pd.DataFrame(
                {
                    "发射平台型号": out["发射平台型号"].fillna("未知型号"),
                    "分方": out["_side"].fillna("未知"),
                    "发射距离_海里": pd.to_numeric(out["发射距离_海里"], errors="coerce").round(2),
                }
            )[COLS]
`,
  },

  {
    id: 'air_defense.composite_interception_probability',
    name: '综合拦截概率',
    chapter: 7,
    category: 'effectiveness',
    militaryLevel: 'MOFE',
    domainTag: 'firepower',
    layer: 'fact',
    engineKind: 'python_script',
    description:
      '7.3 综合拦截概率：Assign Weapon Salvo 按拦截方 UnitSide 分组并按 ContactActualUnitID 去重计数尝试拦截目标数，与 SAM KILL 成功拦截数相除得综合拦截率。',
    requiredTables: ['EngagementCycle', 'WeaponEndgame', 'UnitCreated'],
    optionalTables: ['SideCreated'],
    tableColumns: {
      EngagementCycle: ['UnitID', 'UnitSide', 'CycleAction', 'ContactActualUnitID'],
      WeaponEndgame: ['Result', 'WeaponSide', 'ParentFiringUnitSide', 'TargetID', 'ParentFiringUnitID'],
      UnitCreated: ['UnitID', 'UnitType', 'UnitSide', 'Side'],
      SideCreated: ['SideName'],
    },
    parameterPorts: [],
    outputColumns: ['分方', '尝试拦截目标数', '成功拦截数', '综合拦截率'],
    pythonCode: `import pandas as pd
import numpy as np

eng = T("EngagementCycle")
endgame = T("WeaponEndgame")
units = T("UnitCreated")
sides_df = T("SideCreated")
COLS = ["分方", "尝试拦截目标数", "成功拦截数", "综合拦截率"]

u_clean = (
    units.dropna(subset=["UnitID"]).drop_duplicates("UnitID")
    if not units.empty and "UnitID" in units.columns
    else pd.DataFrame()
)

if eng.empty or "CycleAction" not in eng.columns:
    targetting = pd.Series(dtype=float, name="尝试拦截目标数")
else:
    e = eng[C(eng, "CycleAction").astype(str) == "Assign Weapon Salvo"].copy()
    if "ContactActualUnitID" in e.columns and not u_clean.empty and "UnitType" in u_clean.columns:
        t = u_clean[["UnitID", "UnitType"]].rename(
            columns={"UnitID": "ContactActualUnitID", "UnitType": "TargetUnitType"}
        )
        e = e.merge(t, on="ContactActualUnitID", how="inner")
        p = u_clean[["UnitID", "UnitType"]].rename(
            columns={"UnitType": "ParentFiringUnitType"}
        )
        e = (
            e.merge(p, on="UnitID", how="left")
            if "UnitID" in e.columns
            else e.assign(ParentFiringUnitType="Facility")
        )
    else:
        e = e.assign(TargetUnitType="Weapon", ParentFiringUnitType="Facility")

    target_types = ["Weapon", "Aircraft", "武器", "飞机"]
    firing_types = ["Facility", "Vehicle", "Ship", "设施", "车辆", "舰船", "水面舰艇"]
    e = e[
        C(e, "TargetUnitType").astype(str).isin(target_types)
        & C(e, "ParentFiringUnitType").astype(str).isin(firing_types)
    ].copy()
    e["_side"] = C(e, "UnitSide", "未知").fillna("未知")
    if "ContactActualUnitID" in e.columns and len(e):
        dedup = e.groupby("ContactActualUnitID", dropna=False).agg(_side=("_side", "first"))
        targetting = dedup.groupby("_side", dropna=False).size().rename("尝试拦截目标数")
    else:
        targetting = pd.Series(dtype=float, name="尝试拦截目标数")

if endgame.empty or "Result" not in endgame.columns:
    kills = pd.Series(dtype=float, name="成功拦截数")
else:
    k = endgame[C(endgame, "Result").astype(str) == "KILL"].copy()
    if (
        not k.empty
        and {"TargetID", "ParentFiringUnitID"}.issubset(k.columns)
        and not u_clean.empty
        and "UnitType" in u_clean.columns
    ):
        t_k = u_clean[["UnitID", "UnitType"]].rename(
            columns={"UnitID": "TargetID", "UnitType": "TargetUnitType"}
        )
        k = k.merge(t_k, on="TargetID", how="inner")
        p_k = u_clean[["UnitID", "UnitType"]].rename(
            columns={"UnitID": "ParentFiringUnitID", "UnitType": "ParentFiringUnitType"}
        )
        k = k.merge(p_k, on="ParentFiringUnitID", how="inner")
        k = k[
            C(k, "TargetUnitType").astype(str).isin(target_types)
            & C(k, "ParentFiringUnitType").astype(str).isin(firing_types)
        ].copy()

    if k.empty:
        kills = pd.Series(dtype=float, name="成功拦截数")
    else:
        if "WeaponSide" in k.columns:
            side_ser = k["WeaponSide"].fillna("未知")
        elif "ParentFiringUnitSide" in k.columns:
            side_ser = k["ParentFiringUnitSide"].fillna("未知")
        else:
            side_ser = pd.Series("未知", index=k.index)
        kills = side_ser.groupby(side_ser).size().rename("成功拦截数")

side_list = []
if not sides_df.empty and "SideName" in sides_df.columns:
    side_list.extend(sides_df["SideName"].dropna().tolist())
side_list.extend(list(targetting.index) + list(kills.index))
side_list = list(dict.fromkeys(side_list))

if not side_list:
    output_df = pd.DataFrame(columns=COLS)
else:
    rows = []
    for side in side_list:
        n_try = int(targetting.get(side, 0))
        n_kill = int(kills.get(side, 0))
        rows.append(
            {
                "分方": side,
                "尝试拦截目标数": n_try,
                "成功拦截数": n_kill,
                "综合拦截率": round(n_kill / n_try, 4) if n_try else np.nan,
            }
        )
    output_df = pd.DataFrame(rows)[COLS]
`,
  },
];

export default V4_OPERATORS_PART2;
