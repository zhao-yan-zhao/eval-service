/**
 * F1 官方仿真输出规范事件表与物理字段全集目录 (44+ 类规范事件表 + 完整字段元数据字典)
 * 固定包含前置列: Scenario (想定标识), MC_Run (推演轮次), TimelineID (时间线UUID), Time (仿真时刻)
 * 支持外部 JSON 导入覆盖、导出与物理量纲持久化
 */

export interface CatalogFieldItem {
  name: string;
  cs_type: string;
  unit?: string;
  note?: string;
}

export interface CatalogTableSpec {
  id: string;
  name: string;
  category: string;
  fieldsCount: number;
  fields: CatalogFieldItem[];
}

export interface CatalogMetadataContainer {
  version: string;
  title: string;
  updatedAt: string;
  description: string;
  totalTables: number;
  tables: CatalogTableSpec[];
}

export const ALL_SPEC_EVENTS: CatalogTableSpec[] = [
  {
    "id": "UnitPositions.csv",
    "name": "UnitPositions",
    "category": "空间几何与时序态势",
    "fieldsCount": 26,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "cs_type": "string",
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitDBID",
        "cs_type": "string",
        "note": "实体在装备数据库中的模板标识 (DBID)"
      },
      {
        "name": "UnitName",
        "cs_type": "string",
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "UnitType",
        "cs_type": "string",
        "note": "实体类型代码 (Aircraft, Ship, Submarine, Facility)"
      },
      {
        "name": "UnitClass",
        "cs_type": "string",
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "UnitSide",
        "cs_type": "string",
        "note": "所属阵营/分方 (Blue, Red, Neutral)"
      },
      {
        "name": "UnitLongitude",
        "cs_type": "double",
        "unit": "deg",
        "note": "经度 WGS-84 (范围 -180 ~ +180)"
      },
      {
        "name": "UnitLatitude",
        "cs_type": "double",
        "unit": "deg",
        "note": "纬度 WGS-84 (范围 -90 ~ +90)"
      },
      {
        "name": "UnitCourse",
        "cs_type": "float",
        "unit": "deg",
        "note": "航向角 (0 ~ 360 度，真北基准)"
      },
      {
        "name": "UnitSpeed_kts",
        "cs_type": "float",
        "unit": "kts",
        "note": "地速 (节 Knots, 1节 ≈ 1.852 km/h)"
      },
      {
        "name": "UnitAltitude_m",
        "cs_type": "float",
        "unit": "m",
        "note": "飞行高度 (米 MSL/ASL)"
      },
      {
        "name": "UnitAttitude_Pitch",
        "cs_type": "float",
        "unit": "deg",
        "note": "俯仰角 (Pitch, 抬头正低头负)"
      },
      {
        "name": "UnitAttitude_Roll",
        "cs_type": "float",
        "unit": "deg",
        "note": "滚转角 (Roll, 右倾正左倾负)"
      },
      {
        "name": "Status",
        "cs_type": "string",
        "note": "当前作战运行状态 (Normal, RTB, Engaging, Ingress)"
      },
      {
        "name": "Condition_AirOps",
        "cs_type": "string",
        "note": "航空作业状态 (Idle, Launching, Recovering)"
      },
      {
        "name": "Condition_DockingOps",
        "cs_type": "string",
        "note": "靠泊进驻作业状态"
      },
      {
        "name": "AssignedMission",
        "cs_type": "string",
        "note": "当前分配绑定的作战任务 ID"
      },
      {
        "name": "DamagePercent",
        "cs_type": "float",
        "unit": "%",
        "note": "综合受损百分比 (0 ~ 100%)"
      },
      {
        "name": "Fire",
        "cs_type": "string",
        "note": "火灾损管状态"
      },
      {
        "name": "Flood",
        "cs_type": "string",
        "note": "进水损管状态"
      },
      {
        "name": "ComponentStatus",
        "cs_type": "string",
        "note": "关键分系统/子模块工作状态"
      },
      {
        "name": "SurvivalStatus",
        "cs_type": "string",
        "note": "存活状态 (Active, Damaged, Destroyed)"
      }
    ]
  },
  {
    "id": "ContactPositions.csv",
    "name": "ContactPositions",
    "category": "空间几何与时序态势",
    "fieldsCount": 17,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "ContactID",
        "cs_type": "string",
        "note": "雷达接触/探测航迹批号 ID"
      },
      {
        "name": "UnitDBID",
        "cs_type": "string",
        "note": "实体在装备数据库中的模板标识 (DBID)"
      },
      {
        "name": "ContactName",
        "cs_type": "string",
        "note": "探测批号名称 (如: SKUNK #214)"
      },
      {
        "name": "UnitType",
        "cs_type": "string",
        "note": "实体类型代码 (Aircraft, Ship, Submarine, Facility)"
      },
      {
        "name": "UnitClass",
        "cs_type": "string",
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "ObserverSide",
        "cs_type": "string"
      },
      {
        "name": "ContactLongitude",
        "cs_type": "double",
        "unit": "deg"
      },
      {
        "name": "ContactLatitude",
        "cs_type": "double",
        "unit": "deg"
      },
      {
        "name": "ContactCourse",
        "cs_type": "float",
        "unit": "deg"
      },
      {
        "name": "ContactSpeed_kts",
        "cs_type": "float",
        "unit": "kts"
      },
      {
        "name": "ContactAltitude_m",
        "cs_type": "float",
        "unit": "m"
      },
      {
        "name": "UnitAttitude_Pitch",
        "cs_type": "float",
        "unit": "deg",
        "note": "俯仰角 (Pitch, 抬头正低头负)"
      },
      {
        "name": "UnitAttitude_Roll",
        "cs_type": "float",
        "unit": "deg",
        "note": "滚转角 (Roll, 右倾正左倾负)"
      }
    ]
  },
  {
    "id": "UnitCreated.csv",
    "name": "UnitCreated",
    "category": "空间几何与时序态势",
    "fieldsCount": 14,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "cs_type": "string",
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitDBID",
        "cs_type": "string",
        "note": "实体在装备数据库中的模板标识 (DBID)"
      },
      {
        "name": "UnitName",
        "cs_type": "string",
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "UnitType",
        "cs_type": "string",
        "note": "实体类型代码 (Aircraft, Ship, Submarine, Facility)"
      },
      {
        "name": "UnitClass",
        "cs_type": "string",
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "UnitSide",
        "cs_type": "string",
        "note": "所属阵营/分方 (Blue, Red, Neutral)"
      },
      {
        "name": "UnitLongitude",
        "cs_type": "double",
        "unit": "deg",
        "note": "经度 WGS-84 (范围 -180 ~ +180)"
      },
      {
        "name": "UnitLatitude",
        "cs_type": "double",
        "unit": "deg",
        "note": "纬度 WGS-84 (范围 -90 ~ +90)"
      },
      {
        "name": "UnitCourse",
        "cs_type": "float",
        "unit": "deg",
        "note": "航向角 (0 ~ 360 度，真北基准)"
      },
      {
        "name": "UnitAltitude_m",
        "cs_type": "float",
        "unit": "m",
        "note": "飞行高度 (米 MSL/ASL)"
      }
    ]
  },
  {
    "id": "LandUnitCreated.csv",
    "name": "LandUnitCreated",
    "category": "空间几何与时序态势",
    "fieldsCount": 7,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "cs_type": "string",
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "cs_type": "string",
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "MobileUnitCategory",
        "cs_type": "string"
      }
    ]
  },
  {
    "id": "MissionRefPointRelationChanged.csv",
    "name": "MissionRefPointRelationChanged",
    "category": "空间几何与时序态势",
    "fieldsCount": 9,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "MissionID",
        "cs_type": "string",
        "note": "作战任务唯一标识符 (Mission ObjectID)"
      },
      {
        "name": "Type",
        "cs_type": "string",
        "note": "变更事件类型 / 几何区域性质 (Patrol, Prosecution, NavigationCourse)"
      },
      {
        "name": "Longitude",
        "cs_type": "double",
        "unit": "deg",
        "note": "空间参考点经度 WGS-84"
      },
      {
        "name": "Latitude",
        "cs_type": "double",
        "unit": "deg",
        "note": "空间参考点纬度 WGS-84"
      },
      {
        "name": "PointIndex",
        "cs_type": "int",
        "note": "任务参考点/航线折线顶点顺序序号 (0..N)"
      }
    ]
  },
  {
    "id": "MissionUnitRelationChanged.csv",
    "name": "MissionUnitRelationChanged",
    "category": "空间几何与时序态势",
    "fieldsCount": 7,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "cs_type": "string",
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "MissionID",
        "cs_type": "string",
        "note": "作战任务唯一标识符 (Mission ObjectID)"
      },
      {
        "name": "Type",
        "cs_type": "string",
        "note": "变更事件类型 / 几何区域性质 (Patrol, Prosecution, NavigationCourse)"
      }
    ]
  },
  {
    "id": "GroupUnitRelationChanged.csv",
    "name": "GroupUnitRelationChanged",
    "category": "空间几何与时序态势",
    "fieldsCount": 6,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "GroupUnitID",
        "cs_type": "string"
      },
      {
        "name": "ChildUnitID",
        "cs_type": "string"
      }
    ]
  },
  {
    "id": "WeaponFired.csv",
    "name": "WeaponFired",
    "category": "武器交战与末端毁伤",
    "fieldsCount": 35,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "FiringUnitID",
        "cs_type": "string",
        "note": "发射阵地/载机实体唯一 ID"
      },
      {
        "name": "FiringUnitDBID",
        "cs_type": "string"
      },
      {
        "name": "FiringUnitName",
        "cs_type": "string",
        "note": "发射平台名称"
      },
      {
        "name": "FiringUnitType",
        "cs_type": "string"
      },
      {
        "name": "FiringUnitClass",
        "cs_type": "string"
      },
      {
        "name": "FiringUnitSide",
        "cs_type": "string"
      },
      {
        "name": "FiringUnitLongitude",
        "cs_type": "double",
        "unit": "deg"
      },
      {
        "name": "FiringUnitLatitude",
        "cs_type": "double",
        "unit": "deg"
      },
      {
        "name": "FiringUnitCourse",
        "cs_type": "double",
        "unit": "deg"
      },
      {
        "name": "FiringUnitSpeed_kts",
        "cs_type": "float",
        "unit": "kts"
      },
      {
        "name": "FiringUnitAltitude_m",
        "cs_type": "float",
        "unit": "m"
      },
      {
        "name": "FiringUnitAGL_m",
        "cs_type": "float",
        "unit": "m"
      },
      {
        "name": "WeaponID",
        "cs_type": "string",
        "note": "武器弹药实体唯一标识 (ObjectID)"
      },
      {
        "name": "WeaponDBID",
        "cs_type": "string"
      },
      {
        "name": "WeaponName",
        "cs_type": "string",
        "note": "武器型号名称 (如: PL-15, AIM-120D, YJ-18)"
      },
      {
        "name": "WeaponType",
        "cs_type": "string",
        "note": "武器类型 (GuidedWeapon, Torpedo, Gun, Bomb)"
      },
      {
        "name": "WeaponClass",
        "cs_type": "string"
      },
      {
        "name": "TargetContactID",
        "cs_type": "string"
      },
      {
        "name": "TargetContactLongitude",
        "cs_type": "double",
        "unit": "deg"
      },
      {
        "name": "TargetContactLatitude",
        "cs_type": "double",
        "unit": "deg"
      },
      {
        "name": "TargetContactHeading",
        "cs_type": "float",
        "unit": "deg",
        "note": "empty string if unknown"
      },
      {
        "name": "TargetContactSpeed",
        "cs_type": "float",
        "unit": "kts",
        "note": "empty string if unknown"
      },
      {
        "name": "TargetContactAltitude",
        "cs_type": "float",
        "unit": "m",
        "note": "empty string if unknown"
      },
      {
        "name": "TargetContactRangeHoriz_nm",
        "cs_type": "float",
        "unit": "nm"
      },
      {
        "name": "TargetContactRangeSlant_nm",
        "cs_type": "float",
        "unit": "nm"
      },
      {
        "name": "TargetContactActualUnitID",
        "cs_type": "string"
      },
      {
        "name": "TargetContactActualUnitName",
        "cs_type": "string"
      },
      {
        "name": "TargetContactActualUnitClass",
        "cs_type": "string"
      },
      {
        "name": "TargetContactActualUnitSide",
        "cs_type": "string"
      },
      {
        "name": "SalvoID",
        "cs_type": "string"
      },
      {
        "name": "CountermeasuresRemaining",
        "cs_type": "string"
      }
    ]
  },
  {
    "id": "WeaponFire.csv",
    "name": "WeaponFire",
    "category": "武器交战与末端毁伤",
    "fieldsCount": 4,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ]
  },
  {
    "id": "WeaponEndgame.csv",
    "name": "WeaponEndgame",
    "category": "武器交战与末端毁伤",
    "fieldsCount": 19,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "WeaponID",
        "cs_type": "string",
        "note": "武器弹药实体唯一标识 (ObjectID)"
      },
      {
        "name": "WeaponName",
        "cs_type": "string",
        "note": "武器型号名称 (如: PL-15, AIM-120D, YJ-18)"
      },
      {
        "name": "WeaponSide",
        "cs_type": "string"
      },
      {
        "name": "ParentFiringUnitID",
        "cs_type": "string"
      },
      {
        "name": "ParentFiringUnitName",
        "cs_type": "string"
      },
      {
        "name": "TargetID",
        "cs_type": "string",
        "note": "交战目标实体唯一标识 ID"
      },
      {
        "name": "TargetName",
        "cs_type": "string",
        "note": "目标实体名称/呼号"
      },
      {
        "name": "TargetSide",
        "cs_type": "string"
      },
      {
        "name": "TargetLongitude",
        "cs_type": "double",
        "unit": "deg",
        "note": "PointDefence writes '-' if target null (SQL bug)"
      },
      {
        "name": "TargetLatitude",
        "cs_type": "double",
        "unit": "deg",
        "note": "PointDefence writes '-' if target null"
      },
      {
        "name": "TargetAltitude_ASL_m",
        "cs_type": "float",
        "unit": "m",
        "note": "目标交战高度 (海拔米)"
      },
      {
        "name": "TargetAltitude_AGL_m",
        "cs_type": "float",
        "unit": "m"
      },
      {
        "name": "DistanceFromFiringUnit_Horiz",
        "cs_type": "float",
        "unit": "nm",
        "note": "与发射平台水平开火测距"
      },
      {
        "name": "Result",
        "cs_type": "string",
        "note": "终点交战结果 (InterceptHit, Miss, OutOfFuel, ShotDown)"
      },
      {
        "name": "EndgameMessage",
        "cs_type": "string",
        "note": "末端毁伤机理与交战文字判定摘要"
      }
    ]
  },
  {
    "id": "WeaponImpact.csv",
    "name": "WeaponImpact",
    "category": "武器交战与末端毁伤",
    "fieldsCount": 10,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "cs_type": "string",
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitLongitude",
        "cs_type": "double",
        "unit": "deg",
        "note": "经度 WGS-84 (范围 -180 ~ +180)"
      },
      {
        "name": "UnitLatitude",
        "cs_type": "double",
        "unit": "deg",
        "note": "纬度 WGS-84 (范围 -90 ~ +90)"
      },
      {
        "name": "UnitCourse",
        "cs_type": "float",
        "unit": "deg",
        "note": "航向角 (0 ~ 360 度，真北基准)"
      },
      {
        "name": "UnitSpeed_kts",
        "cs_type": "float",
        "unit": "kts",
        "note": "地速 (节 Knots, 1节 ≈ 1.852 km/h)"
      },
      {
        "name": "UnitAltitude_m",
        "cs_type": "float",
        "unit": "m",
        "note": "飞行高度 (米 MSL/ASL)"
      }
    ]
  },
  {
    "id": "WeaponLost.csv",
    "name": "WeaponLost",
    "category": "武器交战与末端毁伤",
    "fieldsCount": 8,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "DBID",
        "cs_type": "int"
      },
      {
        "name": "WeaponName",
        "cs_type": "int",
        "note": "Code labels typeof(int) while Value is string"
      },
      {
        "name": "Side",
        "cs_type": "string",
        "note": "任务所属阵营 (Blue, Red, Green)"
      },
      {
        "name": "Num",
        "cs_type": "int"
      }
    ]
  },
  {
    "id": "EngagementCycle.csv",
    "name": "EngagementCycle",
    "category": "武器交战与末端毁伤",
    "fieldsCount": 21,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "cs_type": "string",
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "cs_type": "string",
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "UnitClass",
        "cs_type": "string",
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "UnitSide",
        "cs_type": "string",
        "note": "所属阵营/分方 (Blue, Red, Neutral)"
      },
      {
        "name": "CycleAction",
        "cs_type": "string"
      },
      {
        "name": "ContactID",
        "cs_type": "string",
        "note": "雷达接触/探测航迹批号 ID"
      },
      {
        "name": "ContactName",
        "cs_type": "string",
        "note": "探测批号名称 (如: SKUNK #214)"
      },
      {
        "name": "ContactLongitude",
        "cs_type": "double",
        "unit": "deg"
      },
      {
        "name": "ContactLatitude",
        "cs_type": "double",
        "unit": "deg"
      },
      {
        "name": "ContactRangeHoriz_nm",
        "cs_type": "float",
        "unit": "nm"
      },
      {
        "name": "ContactRangeSlant_nm",
        "cs_type": "float",
        "unit": "nm"
      },
      {
        "name": "ContactActualUnitID",
        "cs_type": "string"
      },
      {
        "name": "ContactActualUnitName",
        "cs_type": "string"
      },
      {
        "name": "ContactActualUnitClass",
        "cs_type": "string"
      },
      {
        "name": "ContactActualUnitSide",
        "cs_type": "string"
      },
      {
        "name": "SalvoID",
        "cs_type": "string"
      },
      {
        "name": "MiscInfo",
        "cs_type": "string"
      }
    ]
  },
  {
    "id": "Expenditures.csv",
    "name": "Expenditures",
    "category": "武器交战与末端毁伤",
    "fieldsCount": 8,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "DBID",
        "cs_type": "int"
      },
      {
        "name": "WeaponName",
        "cs_type": "int",
        "note": "Code labels typeof(int) while Value is string"
      },
      {
        "name": "Side",
        "cs_type": "string",
        "note": "任务所属阵营 (Blue, Red, Green)"
      },
      {
        "name": "Num",
        "cs_type": "int"
      }
    ]
  },
  {
    "id": "Explosion.csv",
    "name": "Explosion",
    "category": "武器交战与末端毁伤",
    "fieldsCount": 10,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "ExplosionID",
        "cs_type": "string"
      },
      {
        "name": "ExplosionType",
        "cs_type": "int",
        "note": "(int)WarheadType"
      },
      {
        "name": "Longitude",
        "cs_type": "double",
        "unit": "deg",
        "note": "空间参考点经度 WGS-84"
      },
      {
        "name": "Latitude",
        "cs_type": "double",
        "unit": "deg",
        "note": "空间参考点纬度 WGS-84"
      },
      {
        "name": "Altitude",
        "cs_type": "float",
        "unit": "m"
      },
      {
        "name": "EventType",
        "cs_type": "string"
      }
    ]
  },
  {
    "id": "PointDefenceAndDECM.csv",
    "name": "PointDefenceAndDECM",
    "category": "武器交战与末端毁伤",
    "fieldsCount": 4,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ]
  },
  {
    "id": "SensorDetectionAttempt.csv",
    "name": "SensorDetectionAttempt",
    "category": "传感器感知与电磁对抗",
    "fieldsCount": 4,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ]
  },
  {
    "id": "SensorDetection.csv",
    "name": "SensorDetection",
    "category": "传感器感知与电磁对抗",
    "fieldsCount": 4,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ]
  },
  {
    "id": "ComponentStatusChanged.csv",
    "name": "ComponentStatusChanged",
    "category": "传感器感知与电磁对抗",
    "fieldsCount": 11,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "ComponentID",
        "cs_type": "string"
      },
      {
        "name": "ComponentName",
        "cs_type": "string"
      },
      {
        "name": "ComponentStatus",
        "cs_type": "string",
        "note": "关键分系统/子模块工作状态"
      },
      {
        "name": "SensorIsActive",
        "cs_type": "string"
      },
      {
        "name": "ComponentDamageSeverity",
        "cs_type": "string"
      },
      {
        "name": "PlatformID",
        "cs_type": "string"
      },
      {
        "name": "PlatformName",
        "cs_type": "string"
      }
    ]
  },
  {
    "id": "UnitJammed.csv",
    "name": "UnitJammed",
    "category": "传感器感知与电磁对抗",
    "fieldsCount": 6,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "cs_type": "string",
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "Status",
        "cs_type": "string",
        "note": "当前作战运行状态 (Normal, RTB, Engaging, Ingress)"
      }
    ]
  },
  {
    "id": "CommIsJammedChanged.csv",
    "name": "CommIsJammedChanged",
    "category": "传感器感知与电磁对抗",
    "fieldsCount": 7,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "CommID",
        "cs_type": "string"
      },
      {
        "name": "CommName",
        "cs_type": "string"
      },
      {
        "name": "IsJammed",
        "cs_type": "string"
      }
    ]
  },
  {
    "id": "DetectionIdentificationChanged.csv",
    "name": "DetectionIdentificationChanged",
    "category": "传感器感知与电磁对抗",
    "fieldsCount": 19,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "ContactID",
        "cs_type": "string",
        "note": "雷达接触/探测航迹批号 ID"
      },
      {
        "name": "ContactName",
        "cs_type": "string",
        "note": "探测批号名称 (如: SKUNK #214)"
      },
      {
        "name": "IdentificationStatus",
        "cs_type": "string",
        "note": "目标敌我识别状态 (Hostile, Friendly, Unknown)"
      },
      {
        "name": "SensorName",
        "cs_type": "string",
        "note": "传感器型号名称 (如: APG-77 AESA Radar)"
      },
      {
        "name": "SensorID",
        "cs_type": "string",
        "note": "雷达/光电探测传感器唯一 ID"
      },
      {
        "name": "SensorDBID",
        "cs_type": "string"
      },
      {
        "name": "SensorType",
        "cs_type": "string"
      },
      {
        "name": "SensorRole",
        "cs_type": "string"
      },
      {
        "name": "SensorPlatformName",
        "cs_type": "string"
      },
      {
        "name": "SensorPlatformID",
        "cs_type": "string"
      },
      {
        "name": "HasUncertaintyArea",
        "cs_type": "string"
      },
      {
        "name": "UncertaintyArea",
        "cs_type": "string"
      },
      {
        "name": "ContactRangeHoriz_nm",
        "cs_type": "float",
        "unit": "nm"
      },
      {
        "name": "ContactRangeSlant_nm",
        "cs_type": "float",
        "unit": "nm"
      },
      {
        "name": "EstimatedDistance",
        "cs_type": "float"
      }
    ]
  },
  {
    "id": "FirstSensorToUnitRecordCreated.csv",
    "name": "FirstSensorToUnitRecordCreated",
    "category": "传感器感知与电磁对抗",
    "fieldsCount": 7,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "SensorID",
        "cs_type": "string",
        "note": "雷达/光电探测传感器唯一 ID"
      },
      {
        "name": "TargetID",
        "cs_type": "string",
        "note": "交战目标实体唯一标识 ID"
      },
      {
        "name": "Distance",
        "cs_type": "float",
        "unit": "km",
        "note": "传感器首捕测距 (公里/海里)"
      }
    ]
  },
  {
    "id": "SensorCreated.csv",
    "name": "SensorCreated",
    "category": "传感器感知与电磁对抗",
    "fieldsCount": 27,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "cs_type": "string",
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "cs_type": "string",
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "SensorID",
        "cs_type": "string",
        "note": "雷达/光电探测传感器唯一 ID"
      },
      {
        "name": "SensorName",
        "cs_type": "string",
        "note": "传感器型号名称 (如: APG-77 AESA Radar)"
      },
      {
        "name": "SensorDBID",
        "cs_type": "string"
      },
      {
        "name": "SensorStatus",
        "cs_type": "string"
      },
      {
        "name": "SensorIsActive",
        "cs_type": "string"
      },
      {
        "name": "PS1",
        "cs_type": "string"
      },
      {
        "name": "PMA1",
        "cs_type": "string"
      },
      {
        "name": "PMF1",
        "cs_type": "string"
      },
      {
        "name": "PB1",
        "cs_type": "string"
      },
      {
        "name": "SS1",
        "cs_type": "string"
      },
      {
        "name": "SMA1",
        "cs_type": "string"
      },
      {
        "name": "SMF1",
        "cs_type": "string"
      },
      {
        "name": "SB1",
        "cs_type": "string"
      },
      {
        "name": "PS2",
        "cs_type": "string"
      },
      {
        "name": "PMA2",
        "cs_type": "string"
      },
      {
        "name": "PMF2",
        "cs_type": "string"
      },
      {
        "name": "PB2",
        "cs_type": "string"
      },
      {
        "name": "SS2",
        "cs_type": "string"
      },
      {
        "name": "SMA2",
        "cs_type": "string"
      },
      {
        "name": "SMF2",
        "cs_type": "string"
      },
      {
        "name": "SB2",
        "cs_type": "string"
      }
    ]
  },
  {
    "id": "SensorClassUsed.csv",
    "name": "SensorClassUsed",
    "category": "传感器感知与电磁对抗",
    "fieldsCount": 12,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "SensorDBID",
        "cs_type": "string"
      },
      {
        "name": "SensorName",
        "cs_type": "string",
        "note": "传感器型号名称 (如: APG-77 AESA Radar)"
      },
      {
        "name": "SensorType",
        "cs_type": "string"
      },
      {
        "name": "SensorRole",
        "cs_type": "string"
      },
      {
        "name": "SensorTechGeneration",
        "cs_type": "string"
      },
      {
        "name": "SensorHas360Coverage",
        "cs_type": "string"
      },
      {
        "name": "SensorHasVariableMaxRange",
        "cs_type": "string"
      },
      {
        "name": "SensorMaxRange",
        "cs_type": "float"
      }
    ]
  },
  {
    "id": "UnitDamaged.csv",
    "name": "UnitDamaged",
    "category": "战损评估与毁伤效果",
    "fieldsCount": 15,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "cs_type": "string",
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "cs_type": "string",
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "UnitClass",
        "cs_type": "string",
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "UnitSide",
        "cs_type": "string",
        "note": "所属阵营/分方 (Blue, Red, Neutral)"
      },
      {
        "name": "Longitude",
        "cs_type": "double",
        "unit": "deg",
        "note": "空间参考点经度 WGS-84"
      },
      {
        "name": "Latitude",
        "cs_type": "double",
        "unit": "deg",
        "note": "空间参考点纬度 WGS-84"
      },
      {
        "name": "DamagePercent",
        "cs_type": "string",
        "unit": "percent_F6",
        "note": "综合受损百分比 (0 ~ 100%)"
      },
      {
        "name": "Fire",
        "cs_type": "string",
        "note": "火灾损管状态"
      },
      {
        "name": "Flooding",
        "cs_type": "string"
      },
      {
        "name": "Reason",
        "cs_type": "string"
      },
      {
        "name": "Cause",
        "cs_type": "string"
      }
    ]
  },
  {
    "id": "UnitDestroyed.csv",
    "name": "UnitDestroyed",
    "category": "战损评估与毁伤效果",
    "fieldsCount": 11,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "cs_type": "string",
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "cs_type": "string",
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "UnitClass",
        "cs_type": "string",
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "UnitSide",
        "cs_type": "string",
        "note": "Omitted by UnguidedWeapon.cs:1500-1521 (causes SQLite/MySQL INSERT mismatch)"
      },
      {
        "name": "MiscInfo",
        "cs_type": "string"
      },
      {
        "name": "Reason",
        "cs_type": "string"
      },
      {
        "name": "Cause",
        "cs_type": "string"
      }
    ]
  },
  {
    "id": "Losses.csv",
    "name": "Losses",
    "category": "战损评估与毁伤效果",
    "fieldsCount": 10,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "SubjectID",
        "cs_type": "string"
      },
      {
        "name": "DBID",
        "cs_type": "string"
      },
      {
        "name": "SubjectName",
        "cs_type": "string"
      },
      {
        "name": "Side",
        "cs_type": "string",
        "note": "任务所属阵营 (Blue, Red, Green)"
      },
      {
        "name": "Type",
        "cs_type": "string",
        "note": "变更事件类型 / 几何区域性质 (Patrol, Prosecution, NavigationCourse)"
      },
      {
        "name": "Class",
        "cs_type": "string"
      }
    ]
  },
  {
    "id": "WaterSplash.csv",
    "name": "WaterSplash",
    "category": "战损评估与毁伤效果",
    "fieldsCount": 4,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ]
  },
  {
    "id": "Communication.csv",
    "name": "Communication",
    "category": "指挥通信与后勤保障",
    "fieldsCount": 4,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ]
  },
  {
    "id": "CommCreated.csv",
    "name": "CommCreated",
    "category": "指挥通信与后勤保障",
    "fieldsCount": 10,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "cs_type": "string",
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "cs_type": "string",
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "CommID",
        "cs_type": "string"
      },
      {
        "name": "CommName",
        "cs_type": "string"
      },
      {
        "name": "CommDBID",
        "cs_type": "string"
      },
      {
        "name": "CommStatus",
        "cs_type": "string"
      }
    ]
  },
  {
    "id": "CommClassUsed.csv",
    "name": "CommClassUsed",
    "category": "指挥通信与后勤保障",
    "fieldsCount": 18,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "CommDBID",
        "cs_type": "string"
      },
      {
        "name": "CommName",
        "cs_type": "string"
      },
      {
        "name": "CommType",
        "cs_type": "string"
      },
      {
        "name": "ELF_Radio",
        "cs_type": "string"
      },
      {
        "name": "SLF_Radio",
        "cs_type": "string"
      },
      {
        "name": "ULF_Radio",
        "cs_type": "string"
      },
      {
        "name": "VLF_Radio",
        "cs_type": "string"
      },
      {
        "name": "LF_Radio",
        "cs_type": "string"
      },
      {
        "name": "MF_Radio",
        "cs_type": "string"
      },
      {
        "name": "HF_Radio",
        "cs_type": "string"
      },
      {
        "name": "VHF_Radio",
        "cs_type": "string"
      },
      {
        "name": "UHF_Radio",
        "cs_type": "string"
      },
      {
        "name": "SHF_Radio",
        "cs_type": "string"
      },
      {
        "name": "EHF_Radio",
        "cs_type": "string"
      }
    ]
  },
  {
    "id": "FuelConsumed.csv",
    "name": "FuelConsumed",
    "category": "指挥通信与后勤保障",
    "fieldsCount": 11,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "cs_type": "string",
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "cs_type": "string",
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "UnitClass",
        "cs_type": "string",
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "UnitSide",
        "cs_type": "string",
        "note": "所属阵营/分方 (Blue, Red, Neutral)"
      },
      {
        "name": "FuelQuantity",
        "cs_type": "float"
      },
      {
        "name": "FuelType",
        "cs_type": "int"
      },
      {
        "name": "MiscInfo",
        "cs_type": "string"
      }
    ]
  },
  {
    "id": "FuelTransfer.csv",
    "name": "FuelTransfer",
    "category": "指挥通信与后勤保障",
    "fieldsCount": 15,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "cs_type": "string",
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "cs_type": "string",
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "UnitClass",
        "cs_type": "string",
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "UnitSide",
        "cs_type": "string",
        "note": "所属阵营/分方 (Blue, Red, Neutral)"
      },
      {
        "name": "ReceiverID",
        "cs_type": "string"
      },
      {
        "name": "ReceiverName",
        "cs_type": "string"
      },
      {
        "name": "ReceiverClass",
        "cs_type": "string"
      },
      {
        "name": "ReceiverSide",
        "cs_type": "string"
      },
      {
        "name": "FuelQuantity",
        "cs_type": "float"
      },
      {
        "name": "FuelType",
        "cs_type": "int"
      },
      {
        "name": "MiscInfo",
        "cs_type": "string"
      }
    ]
  },
  {
    "id": "AirOps.csv",
    "name": "AirOps",
    "category": "指挥通信与后勤保障",
    "fieldsCount": 21,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "cs_type": "string",
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "cs_type": "string",
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "UnitClass",
        "cs_type": "string",
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "UnitSide",
        "cs_type": "string",
        "note": "所属阵营/分方 (Blue, Red, Neutral)"
      },
      {
        "name": "UnitLongitude",
        "cs_type": "double",
        "unit": "deg",
        "note": "经度 WGS-84 (范围 -180 ~ +180)"
      },
      {
        "name": "UnitLatitude",
        "cs_type": "double",
        "unit": "deg",
        "note": "纬度 WGS-84 (范围 -90 ~ +90)"
      },
      {
        "name": "Action",
        "cs_type": "string"
      },
      {
        "name": "DepartureHostID",
        "cs_type": "string"
      },
      {
        "name": "DepartureHostName",
        "cs_type": "string"
      },
      {
        "name": "ArrivalHostID",
        "cs_type": "string"
      },
      {
        "name": "ArrivalHostName",
        "cs_type": "string"
      },
      {
        "name": "MissionID",
        "cs_type": "string",
        "note": "作战任务唯一标识符 (Mission ObjectID)"
      },
      {
        "name": "MissionName",
        "cs_type": "string",
        "note": "任务规划名称 (如: 东海防空战斗空中巡逻-01)"
      },
      {
        "name": "TotalFuel",
        "cs_type": "int"
      },
      {
        "name": "LoadoutID",
        "cs_type": "string"
      },
      {
        "name": "LoadoutName",
        "cs_type": "string"
      },
      {
        "name": "LoadoutStores",
        "cs_type": "string"
      }
    ]
  },
  {
    "id": "DockingOps.csv",
    "name": "DockingOps",
    "category": "指挥通信与后勤保障",
    "fieldsCount": 18,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "cs_type": "string",
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "cs_type": "string",
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "UnitClass",
        "cs_type": "string",
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "UnitSide",
        "cs_type": "string",
        "note": "所属阵营/分方 (Blue, Red, Neutral)"
      },
      {
        "name": "UnitLongitude",
        "cs_type": "double",
        "unit": "deg",
        "note": "经度 WGS-84 (范围 -180 ~ +180)"
      },
      {
        "name": "UnitLatitude",
        "cs_type": "double",
        "unit": "deg",
        "note": "纬度 WGS-84 (范围 -90 ~ +90)"
      },
      {
        "name": "Action",
        "cs_type": "string"
      },
      {
        "name": "DepartureHostID",
        "cs_type": "string"
      },
      {
        "name": "DepartureHostName",
        "cs_type": "string"
      },
      {
        "name": "ArrivalHostID",
        "cs_type": "string"
      },
      {
        "name": "ArrivalHostName",
        "cs_type": "string"
      },
      {
        "name": "MissionID",
        "cs_type": "string",
        "note": "作战任务唯一标识符 (Mission ObjectID)"
      },
      {
        "name": "MissionName",
        "cs_type": "string",
        "note": "任务规划名称 (如: 东海防空战斗空中巡逻-01)"
      },
      {
        "name": "TotalFuel",
        "cs_type": "int"
      }
    ]
  },
  {
    "id": "CargoTransfer.csv",
    "name": "CargoTransfer",
    "category": "指挥通信与后勤保障",
    "fieldsCount": 4,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ]
  },
  {
    "id": "MissionChanged.csv",
    "name": "MissionChanged",
    "category": "指挥通信与后勤保障",
    "fieldsCount": 15,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "MissionName",
        "cs_type": "string",
        "note": "任务规划名称 (如: 东海防空战斗空中巡逻-01)"
      },
      {
        "name": "MissionID",
        "cs_type": "string",
        "note": "作战任务唯一标识符 (Mission ObjectID)"
      },
      {
        "name": "Side",
        "cs_type": "string",
        "note": "任务所属阵营 (Blue, Red, Green)"
      },
      {
        "name": "Category",
        "cs_type": "string",
        "note": "任务战役分类 (Patrol, Strike, Support, Ferry)"
      },
      {
        "name": "MissionClass",
        "cs_type": "string",
        "note": "任务装备适用级别"
      },
      {
        "name": "IsActive",
        "cs_type": "string",
        "note": "任务是否已激活运行 (true / false)"
      },
      {
        "name": "SubClass",
        "cs_type": "string"
      },
      {
        "name": "StartTime",
        "cs_type": "DateTime",
        "note": "任务生效开始时间戳"
      },
      {
        "name": "EndTime",
        "cs_type": "DateTime",
        "note": "任务结束/失效时间戳"
      },
      {
        "name": "TakeOffTime",
        "cs_type": "DateTime",
        "note": "编队起飞集结时刻"
      },
      {
        "name": "TimeOnTarget",
        "cs_type": "DateTime",
        "note": "到达目标区上空时刻 (TOT)"
      }
    ]
  },
  {
    "id": "Factors.csv",
    "name": "Factors",
    "category": "指挥通信与后勤保障",
    "fieldsCount": 14,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "ScenarioFileName",
        "cs_type": "string"
      },
      {
        "name": "ScenarioFilePath",
        "cs_type": "string"
      },
      {
        "name": "CurrentDataSet",
        "cs_type": "string"
      },
      {
        "name": "CurrentSchemeName",
        "cs_type": "string"
      },
      {
        "name": "CurrentSchemeTimes",
        "cs_type": "string"
      },
      {
        "name": "CurrentXmlContent",
        "cs_type": "string"
      },
      {
        "name": "CurrentJsonContent",
        "cs_type": "string"
      },
      {
        "name": "CurrentTxtContent",
        "cs_type": "string"
      },
      {
        "name": "CurrentDetailsTxtContent",
        "cs_type": "string"
      },
      {
        "name": "CurrentDatabase",
        "cs_type": "string"
      }
    ]
  },
  {
    "id": "SimInfo.csv",
    "name": "SimInfo",
    "category": "指挥通信与后勤保障",
    "fieldsCount": 8,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "MonteCarloID",
        "cs_type": "string"
      },
      {
        "name": "MonteCarloIteration",
        "cs_type": "int"
      },
      {
        "name": "ScnName",
        "cs_type": "string"
      },
      {
        "name": "ReferenceTime",
        "cs_type": "string",
        "note": "ZeroHour MM/dd/yyyy HH:mm:ss"
      }
    ]
  },
  {
    "id": "SimExecution.csv",
    "name": "SimExecution",
    "category": "指挥通信与后勤保障",
    "fieldsCount": 4,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ]
  },
  {
    "id": "Tick.csv",
    "name": "Tick",
    "category": "指挥通信与后勤保障",
    "fieldsCount": 4,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ]
  },
  {
    "id": "SideCreated.csv",
    "name": "SideCreated",
    "category": "指挥通信与后勤保障",
    "fieldsCount": 6,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "SideName",
        "cs_type": "string"
      },
      {
        "name": "SideID",
        "cs_type": "string"
      }
    ]
  },
  {
    "id": "ContactCreated.csv",
    "name": "ContactCreated",
    "category": "指挥通信与后勤保障",
    "fieldsCount": 9,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "ContactID",
        "cs_type": "string",
        "note": "雷达接触/探测航迹批号 ID"
      },
      {
        "name": "ContactName",
        "cs_type": "string",
        "note": "探测批号名称 (如: SKUNK #214)"
      },
      {
        "name": "ActualUnitID",
        "cs_type": "string"
      },
      {
        "name": "ActualUnitName",
        "cs_type": "string"
      },
      {
        "name": "Side",
        "cs_type": "string",
        "note": "任务所属阵营 (Blue, Red, Green)"
      }
    ]
  },
  {
    "id": "WeaponRecordCreated.csv",
    "name": "WeaponRecordCreated",
    "category": "指挥通信与后勤保障",
    "fieldsCount": 10,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "cs_type": "string",
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "cs_type": "string",
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "WeaponRecordName",
        "cs_type": "string"
      },
      {
        "name": "WeaponRecordNumber",
        "cs_type": "int"
      },
      {
        "name": "WeaponRecordDBID",
        "cs_type": "int"
      },
      {
        "name": "WeaponRecordType",
        "cs_type": "string"
      }
    ]
  },
  {
    "id": "Max.csv",
    "name": "Max",
    "category": "指挥通信与后勤保障",
    "fieldsCount": 4,
    "fields": [
      {
        "name": "Scenario",
        "cs_type": "string",
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "cs_type": "int",
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "cs_type": "string",
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "cs_type": "string",
        "unit": "s",
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ]
  }
];

export function findCatalogTable(tableName?: string, catalogList: CatalogTableSpec[] = ALL_SPEC_EVENTS): CatalogTableSpec | undefined {
  if (!tableName) return catalogList[0];
  const clean = tableName.replace(/\.csv$/i, '').toLowerCase();
  return (
    catalogList.find((t) => t.name.toLowerCase() === clean) ||
    catalogList.find((t) => t.id.toLowerCase() === clean + '.csv') ||
    catalogList[0]
  );
}
