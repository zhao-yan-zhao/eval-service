// ─────────────────────────────────────────────────────────────
// 全量 44 类仿真推演事件与装备库 ER 关系拓扑数据资产
// 包含 46 张仿真输出表 + 1 张 DB3K 物理装备库字典表 (共 47 表)
// ─────────────────────────────────────────────────────────────

export interface FieldDef {
  name: string;
  type: string;
  isKey?: boolean;
  isForeignKey?: boolean;
  note?: string;
}

export interface TableNode {
  id: string;
  name: string;
  category: 'combat' | 'sensor' | 'platform' | 'mission' | 'system' | 'damage';
  categoryLabel: string;
  color: string;
  headerBg: string;
  headerBorder: string;
  headerText: string;
  defaultX: number;
  defaultY: number;
  width: number;
  fields: FieldDef[];
  isCore?: boolean;
}

export interface RelationLink {
  id: string;
  fromTable: string;
  fromField: string;
  toTable: string;
  toField: string;
  relationType: '1:1' | '1:N' | 'N:1';
  description: string;
  joinNote?: string;
}

export const ALL_TABLE_NODES: TableNode[] = [
  {
    "id": "UnitPositions",
    "name": "UnitPositions",
    "category": "platform",
    "categoryLabel": "兵力与实体",
    "color": "#3b82f6",
    "headerBg": "bg-blue-950/80",
    "headerBorder": "border-blue-700/60",
    "headerText": "text-blue-200",
    "defaultX": 60,
    "defaultY": 100,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitDBID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "实体在装备数据库中的模板标识 (DBID)"
      },
      {
        "name": "UnitName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "UnitType",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "实体类型代码 (Aircraft, Ship, Submarine, Facility)"
      },
      {
        "name": "UnitClass",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "UnitSide",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "所属阵营/分方 (Blue, Red, Neutral)"
      },
      {
        "name": "UnitLongitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "经度 WGS-84 (范围 -180 ~ +180)"
      },
      {
        "name": "UnitLatitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "纬度 WGS-84 (范围 -90 ~ +90)"
      },
      {
        "name": "UnitCourse",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "航向角 (0 ~ 360 度，真北基准)"
      },
      {
        "name": "UnitSpeed_kts",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "地速 (节 Knots, 1节 ≈ 1.852 km/h)"
      },
      {
        "name": "UnitAltitude_m",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "飞行高度 (米 MSL/ASL)"
      },
      {
        "name": "UnitAttitude_Pitch",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "俯仰角 (Pitch, 抬头正低头负)"
      },
      {
        "name": "UnitAttitude_Roll",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "滚转角 (Roll, 右倾正左倾负)"
      },
      {
        "name": "Status",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "当前作战运行状态 (Normal, RTB, Engaging, Ingress)"
      },
      {
        "name": "Condition_AirOps",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "航空作业状态 (Idle, Launching, Recovering)"
      },
      {
        "name": "Condition_DockingOps",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "靠泊进驻作业状态"
      },
      {
        "name": "AssignedMission",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "当前分配绑定的作战任务 ID"
      },
      {
        "name": "DamagePercent",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "综合受损百分比 (0 ~ 100%)"
      },
      {
        "name": "Fire",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "火灾损管状态"
      },
      {
        "name": "Flood",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "进水损管状态"
      },
      {
        "name": "ComponentStatus",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "关键分系统/子模块工作状态"
      },
      {
        "name": "SurvivalStatus",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "存活状态 (Active, Damaged, Destroyed)"
      }
    ],
    "isCore": true
  },
  {
    "id": "ContactPositions",
    "name": "ContactPositions",
    "category": "platform",
    "categoryLabel": "兵力与实体",
    "color": "#3b82f6",
    "headerBg": "bg-blue-950/80",
    "headerBorder": "border-blue-700/60",
    "headerText": "text-blue-200",
    "defaultX": 60,
    "defaultY": 620,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "ContactID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "雷达接触/探测航迹批号 ID"
      },
      {
        "name": "UnitDBID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "实体在装备数据库中的模板标识 (DBID)"
      },
      {
        "name": "ContactName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "探测批号名称 (如: SKUNK #214)"
      },
      {
        "name": "UnitType",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "实体类型代码 (Aircraft, Ship, Submarine, Facility)"
      },
      {
        "name": "UnitClass",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "ObserverSide",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ContactLongitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: deg"
      },
      {
        "name": "ContactLatitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: deg"
      },
      {
        "name": "ContactCourse",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: deg"
      },
      {
        "name": "ContactSpeed_kts",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: kts"
      },
      {
        "name": "ContactAltitude_m",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: m"
      },
      {
        "name": "UnitAttitude_Pitch",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "俯仰角 (Pitch, 抬头正低头负)"
      },
      {
        "name": "UnitAttitude_Roll",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "滚转角 (Roll, 右倾正左倾负)"
      }
    ],
    "isCore": true
  },
  {
    "id": "UnitCreated",
    "name": "UnitCreated",
    "category": "platform",
    "categoryLabel": "兵力与实体",
    "color": "#3b82f6",
    "headerBg": "bg-blue-950/80",
    "headerBorder": "border-blue-700/60",
    "headerText": "text-blue-200",
    "defaultX": 60,
    "defaultY": 1140,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitDBID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "实体在装备数据库中的模板标识 (DBID)"
      },
      {
        "name": "UnitName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "UnitType",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "实体类型代码 (Aircraft, Ship, Submarine, Facility)"
      },
      {
        "name": "UnitClass",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "UnitSide",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "所属阵营/分方 (Blue, Red, Neutral)"
      },
      {
        "name": "UnitLongitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "经度 WGS-84 (范围 -180 ~ +180)"
      },
      {
        "name": "UnitLatitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "纬度 WGS-84 (范围 -90 ~ +90)"
      },
      {
        "name": "UnitCourse",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "航向角 (0 ~ 360 度，真北基准)"
      },
      {
        "name": "UnitAltitude_m",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "飞行高度 (米 MSL/ASL)"
      }
    ],
    "isCore": true
  },
  {
    "id": "LandUnitCreated",
    "name": "LandUnitCreated",
    "category": "platform",
    "categoryLabel": "兵力与实体",
    "color": "#3b82f6",
    "headerBg": "bg-blue-950/80",
    "headerBorder": "border-blue-700/60",
    "headerText": "text-blue-200",
    "defaultX": 60,
    "defaultY": 1660,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "MobileUnitCategory",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "MissionRefPointRelationChanged",
    "name": "MissionRefPointRelationChanged",
    "category": "platform",
    "categoryLabel": "兵力与实体",
    "color": "#3b82f6",
    "headerBg": "bg-blue-950/80",
    "headerBorder": "border-blue-700/60",
    "headerText": "text-blue-200",
    "defaultX": 60,
    "defaultY": 2180,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "MissionID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "作战任务唯一标识符 (Mission ObjectID)"
      },
      {
        "name": "Type",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "变更事件类型 / 几何区域性质 (Patrol, Prosecution, NavigationCourse)"
      },
      {
        "name": "Longitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "空间参考点经度 WGS-84"
      },
      {
        "name": "Latitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "空间参考点纬度 WGS-84"
      },
      {
        "name": "PointIndex",
        "type": "int",
        "isKey": false,
        "isForeignKey": false,
        "note": "任务参考点/航线折线顶点顺序序号 (0..N)"
      }
    ],
    "isCore": false
  },
  {
    "id": "MissionUnitRelationChanged",
    "name": "MissionUnitRelationChanged",
    "category": "platform",
    "categoryLabel": "兵力与实体",
    "color": "#3b82f6",
    "headerBg": "bg-blue-950/80",
    "headerBorder": "border-blue-700/60",
    "headerText": "text-blue-200",
    "defaultX": 60,
    "defaultY": 2700,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "MissionID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "作战任务唯一标识符 (Mission ObjectID)"
      },
      {
        "name": "Type",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "变更事件类型 / 几何区域性质 (Patrol, Prosecution, NavigationCourse)"
      }
    ],
    "isCore": false
  },
  {
    "id": "GroupUnitRelationChanged",
    "name": "GroupUnitRelationChanged",
    "category": "platform",
    "categoryLabel": "兵力与实体",
    "color": "#3b82f6",
    "headerBg": "bg-blue-950/80",
    "headerBorder": "border-blue-700/60",
    "headerText": "text-blue-200",
    "defaultX": 60,
    "defaultY": 3220,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "GroupUnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true
      },
      {
        "name": "ChildUnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true
      }
    ],
    "isCore": false
  },
  {
    "id": "WeaponFired",
    "name": "WeaponFired",
    "category": "combat",
    "categoryLabel": "交战与打击",
    "color": "#ef4444",
    "headerBg": "bg-rose-950/80",
    "headerBorder": "border-rose-700/60",
    "headerText": "text-rose-200",
    "defaultX": 780,
    "defaultY": 100,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "FiringUnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "发射阵地/载机实体唯一 ID"
      },
      {
        "name": "FiringUnitDBID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true
      },
      {
        "name": "FiringUnitName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "发射平台名称"
      },
      {
        "name": "FiringUnitType",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "FiringUnitClass",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "FiringUnitSide",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "FiringUnitLongitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: deg"
      },
      {
        "name": "FiringUnitLatitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: deg"
      },
      {
        "name": "FiringUnitCourse",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: deg"
      },
      {
        "name": "FiringUnitSpeed_kts",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: kts"
      },
      {
        "name": "FiringUnitAltitude_m",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: m"
      },
      {
        "name": "FiringUnitAGL_m",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: m"
      },
      {
        "name": "WeaponID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "武器弹药实体唯一标识 (ObjectID)"
      },
      {
        "name": "WeaponDBID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true
      },
      {
        "name": "WeaponName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "武器型号名称 (如: PL-15, AIM-120D, YJ-18)"
      },
      {
        "name": "WeaponType",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "武器类型 (GuidedWeapon, Torpedo, Gun, Bomb)"
      },
      {
        "name": "WeaponClass",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "TargetContactID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true
      },
      {
        "name": "TargetContactLongitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: deg"
      },
      {
        "name": "TargetContactLatitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: deg"
      },
      {
        "name": "TargetContactHeading",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "empty string if unknown"
      },
      {
        "name": "TargetContactSpeed",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "empty string if unknown"
      },
      {
        "name": "TargetContactAltitude",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "empty string if unknown"
      },
      {
        "name": "TargetContactRangeHoriz_nm",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: nm"
      },
      {
        "name": "TargetContactRangeSlant_nm",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: nm"
      },
      {
        "name": "TargetContactActualUnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true
      },
      {
        "name": "TargetContactActualUnitName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "TargetContactActualUnitClass",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "TargetContactActualUnitSide",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SalvoID",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "CountermeasuresRemaining",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": true
  },
  {
    "id": "WeaponFire",
    "name": "WeaponFire",
    "category": "combat",
    "categoryLabel": "交战与打击",
    "color": "#ef4444",
    "headerBg": "bg-rose-950/80",
    "headerBorder": "border-rose-700/60",
    "headerText": "text-rose-200",
    "defaultX": 780,
    "defaultY": 620,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ],
    "isCore": false
  },
  {
    "id": "WeaponEndgame",
    "name": "WeaponEndgame",
    "category": "combat",
    "categoryLabel": "交战与打击",
    "color": "#ef4444",
    "headerBg": "bg-rose-950/80",
    "headerBorder": "border-rose-700/60",
    "headerText": "text-rose-200",
    "defaultX": 780,
    "defaultY": 1140,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "WeaponID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "武器弹药实体唯一标识 (ObjectID)"
      },
      {
        "name": "WeaponName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "武器型号名称 (如: PL-15, AIM-120D, YJ-18)"
      },
      {
        "name": "WeaponSide",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ParentFiringUnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true
      },
      {
        "name": "ParentFiringUnitName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "TargetID",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "交战目标实体唯一标识 ID"
      },
      {
        "name": "TargetName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "目标实体名称/呼号"
      },
      {
        "name": "TargetSide",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "TargetLongitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "PointDefence writes '-' if target null (SQL bug)"
      },
      {
        "name": "TargetLatitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "PointDefence writes '-' if target null"
      },
      {
        "name": "TargetAltitude_ASL_m",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "目标交战高度 (海拔米)"
      },
      {
        "name": "TargetAltitude_AGL_m",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: m"
      },
      {
        "name": "DistanceFromFiringUnit_Horiz",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "与发射平台水平开火测距"
      },
      {
        "name": "Result",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "终点交战结果 (InterceptHit, Miss, OutOfFuel, ShotDown)"
      },
      {
        "name": "EndgameMessage",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "末端毁伤机理与交战文字判定摘要"
      }
    ],
    "isCore": true
  },
  {
    "id": "WeaponImpact",
    "name": "WeaponImpact",
    "category": "combat",
    "categoryLabel": "交战与打击",
    "color": "#ef4444",
    "headerBg": "bg-rose-950/80",
    "headerBorder": "border-rose-700/60",
    "headerText": "text-rose-200",
    "defaultX": 780,
    "defaultY": 1660,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitLongitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "经度 WGS-84 (范围 -180 ~ +180)"
      },
      {
        "name": "UnitLatitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "纬度 WGS-84 (范围 -90 ~ +90)"
      },
      {
        "name": "UnitCourse",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "航向角 (0 ~ 360 度，真北基准)"
      },
      {
        "name": "UnitSpeed_kts",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "地速 (节 Knots, 1节 ≈ 1.852 km/h)"
      },
      {
        "name": "UnitAltitude_m",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "飞行高度 (米 MSL/ASL)"
      }
    ],
    "isCore": false
  },
  {
    "id": "WeaponLost",
    "name": "WeaponLost",
    "category": "combat",
    "categoryLabel": "交战与打击",
    "color": "#ef4444",
    "headerBg": "bg-rose-950/80",
    "headerBorder": "border-rose-700/60",
    "headerText": "text-rose-200",
    "defaultX": 780,
    "defaultY": 2180,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "DBID",
        "type": "int",
        "isKey": false,
        "isForeignKey": true
      },
      {
        "name": "WeaponName",
        "type": "int",
        "isKey": false,
        "isForeignKey": false,
        "note": "Code labels typeof(int) while Value is string"
      },
      {
        "name": "Side",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "任务所属阵营 (Blue, Red, Green)"
      },
      {
        "name": "Num",
        "type": "int",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "EngagementCycle",
    "name": "EngagementCycle",
    "category": "combat",
    "categoryLabel": "交战与打击",
    "color": "#ef4444",
    "headerBg": "bg-rose-950/80",
    "headerBorder": "border-rose-700/60",
    "headerText": "text-rose-200",
    "defaultX": 780,
    "defaultY": 2700,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "UnitClass",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "UnitSide",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "所属阵营/分方 (Blue, Red, Neutral)"
      },
      {
        "name": "CycleAction",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ContactID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "雷达接触/探测航迹批号 ID"
      },
      {
        "name": "ContactName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "探测批号名称 (如: SKUNK #214)"
      },
      {
        "name": "ContactLongitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: deg"
      },
      {
        "name": "ContactLatitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: deg"
      },
      {
        "name": "ContactRangeHoriz_nm",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: nm"
      },
      {
        "name": "ContactRangeSlant_nm",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: nm"
      },
      {
        "name": "ContactActualUnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true
      },
      {
        "name": "ContactActualUnitName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ContactActualUnitClass",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ContactActualUnitSide",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SalvoID",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "MiscInfo",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "Expenditures",
    "name": "Expenditures",
    "category": "combat",
    "categoryLabel": "交战与打击",
    "color": "#ef4444",
    "headerBg": "bg-rose-950/80",
    "headerBorder": "border-rose-700/60",
    "headerText": "text-rose-200",
    "defaultX": 780,
    "defaultY": 3220,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "DBID",
        "type": "int",
        "isKey": false,
        "isForeignKey": true
      },
      {
        "name": "WeaponName",
        "type": "int",
        "isKey": false,
        "isForeignKey": false,
        "note": "Code labels typeof(int) while Value is string"
      },
      {
        "name": "Side",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "任务所属阵营 (Blue, Red, Green)"
      },
      {
        "name": "Num",
        "type": "int",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "Explosion",
    "name": "Explosion",
    "category": "combat",
    "categoryLabel": "交战与打击",
    "color": "#ef4444",
    "headerBg": "bg-rose-950/80",
    "headerBorder": "border-rose-700/60",
    "headerText": "text-rose-200",
    "defaultX": 780,
    "defaultY": 3740,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "ExplosionID",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ExplosionType",
        "type": "int",
        "isKey": false,
        "isForeignKey": false,
        "note": "(int)WarheadType"
      },
      {
        "name": "Longitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "空间参考点经度 WGS-84"
      },
      {
        "name": "Latitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "空间参考点纬度 WGS-84"
      },
      {
        "name": "Altitude",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: m"
      },
      {
        "name": "EventType",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "PointDefenceAndDECM",
    "name": "PointDefenceAndDECM",
    "category": "combat",
    "categoryLabel": "交战与打击",
    "color": "#ef4444",
    "headerBg": "bg-rose-950/80",
    "headerBorder": "border-rose-700/60",
    "headerText": "text-rose-200",
    "defaultX": 780,
    "defaultY": 4260,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ],
    "isCore": false
  },
  {
    "id": "SensorDetectionAttempt",
    "name": "SensorDetectionAttempt",
    "category": "sensor",
    "categoryLabel": "感知与探测",
    "color": "#10b981",
    "headerBg": "bg-emerald-950/80",
    "headerBorder": "border-emerald-700/60",
    "headerText": "text-emerald-200",
    "defaultX": 420,
    "defaultY": 100,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ],
    "isCore": false
  },
  {
    "id": "SensorDetection",
    "name": "SensorDetection",
    "category": "sensor",
    "categoryLabel": "感知与探测",
    "color": "#10b981",
    "headerBg": "bg-emerald-950/80",
    "headerBorder": "border-emerald-700/60",
    "headerText": "text-emerald-200",
    "defaultX": 420,
    "defaultY": 620,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ],
    "isCore": false
  },
  {
    "id": "ComponentStatusChanged",
    "name": "ComponentStatusChanged",
    "category": "sensor",
    "categoryLabel": "感知与探测",
    "color": "#10b981",
    "headerBg": "bg-emerald-950/80",
    "headerBorder": "border-emerald-700/60",
    "headerText": "text-emerald-200",
    "defaultX": 420,
    "defaultY": 1140,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "ComponentID",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ComponentName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ComponentStatus",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "关键分系统/子模块工作状态"
      },
      {
        "name": "SensorIsActive",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ComponentDamageSeverity",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "PlatformID",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "PlatformName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "UnitJammed",
    "name": "UnitJammed",
    "category": "sensor",
    "categoryLabel": "感知与探测",
    "color": "#10b981",
    "headerBg": "bg-emerald-950/80",
    "headerBorder": "border-emerald-700/60",
    "headerText": "text-emerald-200",
    "defaultX": 420,
    "defaultY": 1660,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "Status",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "当前作战运行状态 (Normal, RTB, Engaging, Ingress)"
      }
    ],
    "isCore": false
  },
  {
    "id": "CommIsJammedChanged",
    "name": "CommIsJammedChanged",
    "category": "sensor",
    "categoryLabel": "感知与探测",
    "color": "#10b981",
    "headerBg": "bg-emerald-950/80",
    "headerBorder": "border-emerald-700/60",
    "headerText": "text-emerald-200",
    "defaultX": 420,
    "defaultY": 2180,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "CommID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true
      },
      {
        "name": "CommName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "IsJammed",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "DetectionIdentificationChanged",
    "name": "DetectionIdentificationChanged",
    "category": "sensor",
    "categoryLabel": "感知与探测",
    "color": "#10b981",
    "headerBg": "bg-emerald-950/80",
    "headerBorder": "border-emerald-700/60",
    "headerText": "text-emerald-200",
    "defaultX": 420,
    "defaultY": 2700,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "ContactID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "雷达接触/探测航迹批号 ID"
      },
      {
        "name": "ContactName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "探测批号名称 (如: SKUNK #214)"
      },
      {
        "name": "IdentificationStatus",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "目标敌我识别状态 (Hostile, Friendly, Unknown)"
      },
      {
        "name": "SensorName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "传感器型号名称 (如: APG-77 AESA Radar)"
      },
      {
        "name": "SensorID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "雷达/光电探测传感器唯一 ID"
      },
      {
        "name": "SensorDBID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true
      },
      {
        "name": "SensorType",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SensorRole",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SensorPlatformName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SensorPlatformID",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "HasUncertaintyArea",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "UncertaintyArea",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ContactRangeHoriz_nm",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: nm"
      },
      {
        "name": "ContactRangeSlant_nm",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "单位: nm"
      },
      {
        "name": "EstimatedDistance",
        "type": "float",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "FirstSensorToUnitRecordCreated",
    "name": "FirstSensorToUnitRecordCreated",
    "category": "sensor",
    "categoryLabel": "感知与探测",
    "color": "#10b981",
    "headerBg": "bg-emerald-950/80",
    "headerBorder": "border-emerald-700/60",
    "headerText": "text-emerald-200",
    "defaultX": 420,
    "defaultY": 3220,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "SensorID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "雷达/光电探测传感器唯一 ID"
      },
      {
        "name": "TargetID",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "交战目标实体唯一标识 ID"
      },
      {
        "name": "Distance",
        "type": "float",
        "isKey": false,
        "isForeignKey": false,
        "note": "传感器首捕测距 (公里/海里)"
      }
    ],
    "isCore": false
  },
  {
    "id": "SensorCreated",
    "name": "SensorCreated",
    "category": "sensor",
    "categoryLabel": "感知与探测",
    "color": "#10b981",
    "headerBg": "bg-emerald-950/80",
    "headerBorder": "border-emerald-700/60",
    "headerText": "text-emerald-200",
    "defaultX": 420,
    "defaultY": 3740,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "SensorID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "雷达/光电探测传感器唯一 ID"
      },
      {
        "name": "SensorName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "传感器型号名称 (如: APG-77 AESA Radar)"
      },
      {
        "name": "SensorDBID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true
      },
      {
        "name": "SensorStatus",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SensorIsActive",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "PS1",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "PMA1",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "PMF1",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "PB1",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SS1",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SMA1",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SMF1",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SB1",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "PS2",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "PMA2",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "PMF2",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "PB2",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SS2",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SMA2",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SMF2",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SB2",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": true
  },
  {
    "id": "SensorClassUsed",
    "name": "SensorClassUsed",
    "category": "sensor",
    "categoryLabel": "感知与探测",
    "color": "#10b981",
    "headerBg": "bg-emerald-950/80",
    "headerBorder": "border-emerald-700/60",
    "headerText": "text-emerald-200",
    "defaultX": 420,
    "defaultY": 4260,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "SensorDBID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true
      },
      {
        "name": "SensorName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "传感器型号名称 (如: APG-77 AESA Radar)"
      },
      {
        "name": "SensorType",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SensorRole",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SensorTechGeneration",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SensorHas360Coverage",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SensorHasVariableMaxRange",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SensorMaxRange",
        "type": "float",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "UnitDamaged",
    "name": "UnitDamaged",
    "category": "damage",
    "categoryLabel": "战损与评估",
    "color": "#f97316",
    "headerBg": "bg-amber-950/80",
    "headerBorder": "border-amber-700/60",
    "headerText": "text-amber-200",
    "defaultX": 1140,
    "defaultY": 100,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "UnitClass",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "UnitSide",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "所属阵营/分方 (Blue, Red, Neutral)"
      },
      {
        "name": "Longitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "空间参考点经度 WGS-84"
      },
      {
        "name": "Latitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "空间参考点纬度 WGS-84"
      },
      {
        "name": "DamagePercent",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "综合受损百分比 (0 ~ 100%)"
      },
      {
        "name": "Fire",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "火灾损管状态"
      },
      {
        "name": "Flooding",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "Reason",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "Cause",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "UnitDestroyed",
    "name": "UnitDestroyed",
    "category": "damage",
    "categoryLabel": "战损与评估",
    "color": "#f97316",
    "headerBg": "bg-amber-950/80",
    "headerBorder": "border-amber-700/60",
    "headerText": "text-amber-200",
    "defaultX": 1140,
    "defaultY": 620,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "UnitClass",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "UnitSide",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "Omitted by UnguidedWeapon.cs:1500-1521 (causes SQLite/MySQL INSERT mismatch)"
      },
      {
        "name": "MiscInfo",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "Reason",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "Cause",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": true
  },
  {
    "id": "Losses",
    "name": "Losses",
    "category": "damage",
    "categoryLabel": "战损与评估",
    "color": "#f97316",
    "headerBg": "bg-amber-950/80",
    "headerBorder": "border-amber-700/60",
    "headerText": "text-amber-200",
    "defaultX": 1140,
    "defaultY": 1140,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "SubjectID",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "DBID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true
      },
      {
        "name": "SubjectName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "Side",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "任务所属阵营 (Blue, Red, Green)"
      },
      {
        "name": "Type",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "变更事件类型 / 几何区域性质 (Patrol, Prosecution, NavigationCourse)"
      },
      {
        "name": "Class",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "WaterSplash",
    "name": "WaterSplash",
    "category": "damage",
    "categoryLabel": "战损与评估",
    "color": "#f97316",
    "headerBg": "bg-amber-950/80",
    "headerBorder": "border-amber-700/60",
    "headerText": "text-amber-200",
    "defaultX": 1140,
    "defaultY": 1660,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ],
    "isCore": false
  },
  {
    "id": "Communication",
    "name": "Communication",
    "category": "mission",
    "categoryLabel": "指挥与保障",
    "color": "#a855f7",
    "headerBg": "bg-purple-950/80",
    "headerBorder": "border-purple-700/60",
    "headerText": "text-purple-200",
    "defaultX": 1500,
    "defaultY": 100,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ],
    "isCore": false
  },
  {
    "id": "CommCreated",
    "name": "CommCreated",
    "category": "mission",
    "categoryLabel": "指挥与保障",
    "color": "#a855f7",
    "headerBg": "bg-purple-950/80",
    "headerBorder": "border-purple-700/60",
    "headerText": "text-purple-200",
    "defaultX": 1860,
    "defaultY": 100,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "CommID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false
      },
      {
        "name": "CommName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "CommDBID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true
      },
      {
        "name": "CommStatus",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "CommClassUsed",
    "name": "CommClassUsed",
    "category": "mission",
    "categoryLabel": "指挥与保障",
    "color": "#a855f7",
    "headerBg": "bg-purple-950/80",
    "headerBorder": "border-purple-700/60",
    "headerText": "text-purple-200",
    "defaultX": 1500,
    "defaultY": 620,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "CommDBID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true
      },
      {
        "name": "CommName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "CommType",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ELF_Radio",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SLF_Radio",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ULF_Radio",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "VLF_Radio",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "LF_Radio",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "MF_Radio",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "HF_Radio",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "VHF_Radio",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "UHF_Radio",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SHF_Radio",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "EHF_Radio",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "FuelConsumed",
    "name": "FuelConsumed",
    "category": "mission",
    "categoryLabel": "指挥与保障",
    "color": "#a855f7",
    "headerBg": "bg-purple-950/80",
    "headerBorder": "border-purple-700/60",
    "headerText": "text-purple-200",
    "defaultX": 1860,
    "defaultY": 620,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "UnitClass",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "UnitSide",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "所属阵营/分方 (Blue, Red, Neutral)"
      },
      {
        "name": "FuelQuantity",
        "type": "float",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "FuelType",
        "type": "int",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "MiscInfo",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "FuelTransfer",
    "name": "FuelTransfer",
    "category": "mission",
    "categoryLabel": "指挥与保障",
    "color": "#a855f7",
    "headerBg": "bg-purple-950/80",
    "headerBorder": "border-purple-700/60",
    "headerText": "text-purple-200",
    "defaultX": 1500,
    "defaultY": 1140,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "UnitClass",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "UnitSide",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "所属阵营/分方 (Blue, Red, Neutral)"
      },
      {
        "name": "ReceiverID",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ReceiverName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ReceiverClass",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ReceiverSide",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "FuelQuantity",
        "type": "float",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "FuelType",
        "type": "int",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "MiscInfo",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "AirOps",
    "name": "AirOps",
    "category": "mission",
    "categoryLabel": "指挥与保障",
    "color": "#a855f7",
    "headerBg": "bg-purple-950/80",
    "headerBorder": "border-purple-700/60",
    "headerText": "text-purple-200",
    "defaultX": 1860,
    "defaultY": 1140,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "UnitClass",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "UnitSide",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "所属阵营/分方 (Blue, Red, Neutral)"
      },
      {
        "name": "UnitLongitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "经度 WGS-84 (范围 -180 ~ +180)"
      },
      {
        "name": "UnitLatitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "纬度 WGS-84 (范围 -90 ~ +90)"
      },
      {
        "name": "Action",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "DepartureHostID",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "DepartureHostName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ArrivalHostID",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ArrivalHostName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "MissionID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "作战任务唯一标识符 (Mission ObjectID)"
      },
      {
        "name": "MissionName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "任务规划名称 (如: 东海防空战斗空中巡逻-01)"
      },
      {
        "name": "TotalFuel",
        "type": "int",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "LoadoutID",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "LoadoutName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "LoadoutStores",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "DockingOps",
    "name": "DockingOps",
    "category": "mission",
    "categoryLabel": "指挥与保障",
    "color": "#a855f7",
    "headerBg": "bg-purple-950/80",
    "headerBorder": "border-purple-700/60",
    "headerText": "text-purple-200",
    "defaultX": 1500,
    "defaultY": 1660,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "UnitClass",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "实体装备型号分类 (如: 歼击机, 驱逐舰, 地空导弹营)"
      },
      {
        "name": "UnitSide",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "所属阵营/分方 (Blue, Red, Neutral)"
      },
      {
        "name": "UnitLongitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "经度 WGS-84 (范围 -180 ~ +180)"
      },
      {
        "name": "UnitLatitude",
        "type": "double",
        "isKey": false,
        "isForeignKey": false,
        "note": "纬度 WGS-84 (范围 -90 ~ +90)"
      },
      {
        "name": "Action",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "DepartureHostID",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "DepartureHostName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ArrivalHostID",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ArrivalHostName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "MissionID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "作战任务唯一标识符 (Mission ObjectID)"
      },
      {
        "name": "MissionName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "任务规划名称 (如: 东海防空战斗空中巡逻-01)"
      },
      {
        "name": "TotalFuel",
        "type": "int",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "CargoTransfer",
    "name": "CargoTransfer",
    "category": "mission",
    "categoryLabel": "指挥与保障",
    "color": "#a855f7",
    "headerBg": "bg-purple-950/80",
    "headerBorder": "border-purple-700/60",
    "headerText": "text-purple-200",
    "defaultX": 1860,
    "defaultY": 1660,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ],
    "isCore": false
  },
  {
    "id": "MissionChanged",
    "name": "MissionChanged",
    "category": "mission",
    "categoryLabel": "指挥与保障",
    "color": "#a855f7",
    "headerBg": "bg-purple-950/80",
    "headerBorder": "border-purple-700/60",
    "headerText": "text-purple-200",
    "defaultX": 1500,
    "defaultY": 2180,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "MissionName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "任务规划名称 (如: 东海防空战斗空中巡逻-01)"
      },
      {
        "name": "MissionID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "作战任务唯一标识符 (Mission ObjectID)"
      },
      {
        "name": "Side",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "任务所属阵营 (Blue, Red, Green)"
      },
      {
        "name": "Category",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "任务战役分类 (Patrol, Strike, Support, Ferry)"
      },
      {
        "name": "MissionClass",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "任务装备适用级别"
      },
      {
        "name": "IsActive",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "任务是否已激活运行 (true / false)"
      },
      {
        "name": "SubClass",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "StartTime",
        "type": "DateTime",
        "isKey": false,
        "isForeignKey": false,
        "note": "任务生效开始时间戳"
      },
      {
        "name": "EndTime",
        "type": "DateTime",
        "isKey": false,
        "isForeignKey": false,
        "note": "任务结束/失效时间戳"
      },
      {
        "name": "TakeOffTime",
        "type": "DateTime",
        "isKey": false,
        "isForeignKey": false,
        "note": "编队起飞集结时刻"
      },
      {
        "name": "TimeOnTarget",
        "type": "DateTime",
        "isKey": false,
        "isForeignKey": false,
        "note": "到达目标区上空时刻 (TOT)"
      }
    ],
    "isCore": false
  },
  {
    "id": "Factors",
    "name": "Factors",
    "category": "mission",
    "categoryLabel": "指挥与保障",
    "color": "#a855f7",
    "headerBg": "bg-purple-950/80",
    "headerBorder": "border-purple-700/60",
    "headerText": "text-purple-200",
    "defaultX": 1860,
    "defaultY": 2180,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "ScenarioFileName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ScenarioFilePath",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "CurrentDataSet",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "CurrentSchemeName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "CurrentSchemeTimes",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "CurrentXmlContent",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "CurrentJsonContent",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "CurrentTxtContent",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "CurrentDetailsTxtContent",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "CurrentDatabase",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "SimInfo",
    "name": "SimInfo",
    "category": "mission",
    "categoryLabel": "指挥与保障",
    "color": "#a855f7",
    "headerBg": "bg-purple-950/80",
    "headerBorder": "border-purple-700/60",
    "headerText": "text-purple-200",
    "defaultX": 1500,
    "defaultY": 2700,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "MonteCarloID",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "MonteCarloIteration",
        "type": "int",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ScnName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "ReferenceTime",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "ZeroHour MM/dd/yyyy HH:mm:ss"
      }
    ],
    "isCore": false
  },
  {
    "id": "SimExecution",
    "name": "SimExecution",
    "category": "mission",
    "categoryLabel": "指挥与保障",
    "color": "#a855f7",
    "headerBg": "bg-purple-950/80",
    "headerBorder": "border-purple-700/60",
    "headerText": "text-purple-200",
    "defaultX": 1860,
    "defaultY": 2700,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ],
    "isCore": false
  },
  {
    "id": "Tick",
    "name": "Tick",
    "category": "mission",
    "categoryLabel": "指挥与保障",
    "color": "#a855f7",
    "headerBg": "bg-purple-950/80",
    "headerBorder": "border-purple-700/60",
    "headerText": "text-purple-200",
    "defaultX": 1500,
    "defaultY": 3220,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ],
    "isCore": false
  },
  {
    "id": "SideCreated",
    "name": "SideCreated",
    "category": "mission",
    "categoryLabel": "指挥与保障",
    "color": "#a855f7",
    "headerBg": "bg-purple-950/80",
    "headerBorder": "border-purple-700/60",
    "headerText": "text-purple-200",
    "defaultX": 1860,
    "defaultY": 3220,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "SideName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "SideID",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "ContactCreated",
    "name": "ContactCreated",
    "category": "mission",
    "categoryLabel": "指挥与保障",
    "color": "#a855f7",
    "headerBg": "bg-purple-950/80",
    "headerBorder": "border-purple-700/60",
    "headerText": "text-purple-200",
    "defaultX": 1500,
    "defaultY": 3740,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "ContactID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "雷达接触/探测航迹批号 ID"
      },
      {
        "name": "ContactName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "探测批号名称 (如: SKUNK #214)"
      },
      {
        "name": "ActualUnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true
      },
      {
        "name": "ActualUnitName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "Side",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "任务所属阵营 (Blue, Red, Green)"
      }
    ],
    "isCore": false
  },
  {
    "id": "WeaponRecordCreated",
    "name": "WeaponRecordCreated",
    "category": "mission",
    "categoryLabel": "指挥与保障",
    "color": "#a855f7",
    "headerBg": "bg-purple-950/80",
    "headerBorder": "border-purple-700/60",
    "headerText": "text-purple-200",
    "defaultX": 1860,
    "defaultY": 3740,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      },
      {
        "name": "UnitID",
        "type": "string",
        "isKey": false,
        "isForeignKey": true,
        "note": "参演作战实体全局唯一标识符 (ObjectID)"
      },
      {
        "name": "UnitName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "作战单元名称/呼号 (如: J-20_#1, Type055_#1)"
      },
      {
        "name": "WeaponRecordName",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "WeaponRecordNumber",
        "type": "int",
        "isKey": false,
        "isForeignKey": false
      },
      {
        "name": "WeaponRecordDBID",
        "type": "int",
        "isKey": false,
        "isForeignKey": true
      },
      {
        "name": "WeaponRecordType",
        "type": "string",
        "isKey": false,
        "isForeignKey": false
      }
    ],
    "isCore": false
  },
  {
    "id": "Max",
    "name": "Max",
    "category": "mission",
    "categoryLabel": "指挥与保障",
    "color": "#a855f7",
    "headerBg": "bg-purple-950/80",
    "headerBorder": "border-purple-700/60",
    "headerText": "text-purple-200",
    "defaultX": 1500,
    "defaultY": 4260,
    "width": 270,
    "fields": [
      {
        "name": "Scenario",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "推演想定工程标识/名称"
      },
      {
        "name": "MC_Run",
        "type": "int",
        "isKey": true,
        "isForeignKey": false,
        "note": "蒙特卡洛推演轮次索引 (1..N)"
      },
      {
        "name": "TimelineID",
        "type": "string",
        "isKey": true,
        "isForeignKey": false,
        "note": "推演时间线唯一标识 UUID"
      },
      {
        "name": "Time",
        "type": "string",
        "isKey": false,
        "isForeignKey": false,
        "note": "仿真推演时刻 (HH:mm:ss 或仿真秒数)"
      }
    ],
    "isCore": false
  },
  {
    "id": "DataWeapon",
    "name": "DataWeapon (DB3K武器物理库)",
    "category": "system",
    "categoryLabel": "DB3K装备字典",
    "color": "#06b6d4",
    "headerBg": "bg-cyan-950/80",
    "headerBorder": "border-cyan-700/60",
    "headerText": "text-cyan-200",
    "defaultX": 1140,
    "defaultY": 2180,
    "width": 270,
    "fields": [
      {
        "name": "ID",
        "type": "int",
        "isKey": true,
        "note": "武器数据库ID (DBID主键)"
      },
      {
        "name": "Name",
        "type": "string(100)",
        "note": "武器标准型号 (如 PL-15)"
      },
      {
        "name": "Type",
        "type": "int",
        "note": "武器物理分类代号"
      },
      {
        "name": "AirRangeMax_nm",
        "type": "double",
        "note": "高空理论最大射程 (海里)"
      },
      {
        "name": "AirRangeMin_nm",
        "type": "double",
        "note": "近界不可逃逸射程 (海里)"
      },
      {
        "name": "Weight_kg",
        "type": "double",
        "note": "全备发射重量 (公斤)"
      },
      {
        "name": "MaxSpeed_kts",
        "type": "double",
        "note": "末端冲刺极限速度 (节)"
      },
      {
        "name": "BurnoutWeight",
        "type": "double",
        "note": "发动机关机后弹体自重"
      },
      {
        "name": "CEP_m",
        "type": "int",
        "note": "圆概率误差半径 (米)"
      }
    ],
    "isCore": true
  }
];

export const ALL_RELATION_LINKS: RelationLink[] = [
  {
    "id": "rel_fire_endgame",
    "fromTable": "WeaponFired",
    "fromField": "WeaponID",
    "toTable": "WeaponEndgame",
    "toField": "WeaponID",
    "relationType": "1:1",
    "description": "单发武器命中闭环：每枚发射导弹与末端命中/脱靶结果严格 1:1 闭环关联",
    "joinNote": "用于计算单发杀伤率 (Pk) 与实际打击时空射程"
  },
  {
    "id": "rel_fire_unit",
    "fromTable": "WeaponFired",
    "fromField": "FiringUnitID",
    "toTable": "UnitCreated",
    "toField": "UnitID",
    "relationType": "N:1",
    "description": "开火平台归属：将开火事件回溯到具体的战斗机呼号或防空连阵地",
    "joinNote": "用于统计单机开火发射频次与武器消耗分布"
  },
  {
    "id": "rel_fire_db3k",
    "fromTable": "WeaponFired",
    "fromField": "WeaponDBID",
    "toTable": "DataWeapon",
    "toField": "ID",
    "relationType": "N:1",
    "description": "武器物理参数对齐：将动态发射事件关联至DB3K静态最大设计射程与战斗部威力",
    "joinNote": "用于计算开火时刻的发射距离相比理论最大射程的包线利用率"
  },
  {
    "id": "rel_unit_track",
    "fromTable": "UnitCreated",
    "fromField": "UnitID",
    "toTable": "UnitPositions",
    "toField": "UnitID",
    "relationType": "1:N",
    "description": "时空真值航迹流：将实体静态出场配置与其高频时序经纬度、高度与航速关联",
    "joinNote": "用于态势重放、编队间距计算与空域覆盖率度量"
  },
  {
    "id": "rel_unit_destroy",
    "fromTable": "UnitCreated",
    "fromField": "UnitID",
    "toTable": "UnitDestroyed",
    "toField": "UnitID",
    "relationType": "1:1",
    "description": "阵亡与战损对账：将出场编队与实际战损记录关联，核算生存率与交换比",
    "joinNote": "用于计算阵营生存率、战损发生时间分布与毁伤致因"
  },
  {
    "id": "rel_unit_damaged",
    "fromTable": "UnitCreated",
    "fromField": "UnitID",
    "toTable": "UnitDamaged",
    "toField": "UnitID",
    "relationType": "1:N",
    "description": "实体战伤记录：将作战平台与其多次被击中受损记录关联",
    "joinNote": "用于统计装备抗毁冗余度与战损渐进过程"
  },
  {
    "id": "rel_unit_sensor",
    "fromTable": "UnitCreated",
    "fromField": "UnitID",
    "toTable": "SensorCreated",
    "toField": "UnitID",
    "relationType": "1:N",
    "description": "机载载荷装配清单：将战机/舰艇与其挂载的有源相控阵雷达及光电吊舱关联",
    "joinNote": "用于评估传感器网络覆盖广度与多机协同探测能力"
  },
  {
    "id": "rel_contact_created_pos",
    "fromTable": "ContactCreated",
    "fromField": "ContactID",
    "toTable": "ContactPositions",
    "toField": "ContactID",
    "relationType": "1:N",
    "description": "目标接触轨迹跟踪：接触生成事件与后续时序估测航迹点关联",
    "joinNote": "用于雷达航迹滤波、航向解算与识别置信度分析"
  },
  {
    "id": "rel_contact_truth_unit",
    "fromTable": "ContactCreated",
    "fromField": "ActualUnitID",
    "toTable": "UnitCreated",
    "toField": "UnitID",
    "relationType": "N:1",
    "description": "探测真值匹配：将探测方创建的Contact目标与物理真值目标精确配对",
    "joinNote": "用于计算发现延迟 (Detection Latency) 与敌我识别准确率"
  },
  {
    "id": "rel_unit_comm",
    "fromTable": "UnitCreated",
    "fromField": "UnitID",
    "toTable": "CommCreated",
    "toField": "UnitID",
    "relationType": "1:N",
    "description": "通信节点装配：将实体与其装载的战术数据链、无线电台设备关联",
    "joinNote": "用于评估通信网络拓扑连通度与链路鲁棒性"
  },
  {
    "id": "rel_fuel_consumed",
    "fromTable": "UnitCreated",
    "fromField": "UnitID",
    "toTable": "FuelConsumed",
    "toField": "UnitID",
    "relationType": "1:N",
    "description": "燃油消耗监控：实体各推演时段的燃油消耗记录",
    "joinNote": "用于核算作战半径与巡航效能"
  },
  {
    "id": "rel_fuel_transfer",
    "fromTable": "UnitCreated",
    "fromField": "UnitID",
    "toTable": "FuelTransfer",
    "toField": "UnitID",
    "relationType": "1:N",
    "description": "空中受油/加油作业：实体加油作业流水与航程延伸分析",
    "joinNote": "用于空中加油保障效能评估"
  },
  {
    "id": "rel_air_ops",
    "fromTable": "UnitCreated",
    "fromField": "UnitID",
    "toTable": "AirOps",
    "toField": "UnitID",
    "relationType": "1:N",
    "description": "航母/机场起降作业：舰载机出动与回收流水关联",
    "joinNote": "用于出动架次率与甲板调度效率分析"
  },
  {
    "id": "rel_docking_ops",
    "fromTable": "UnitCreated",
    "fromField": "UnitID",
    "toTable": "DockingOps",
    "toField": "UnitID",
    "relationType": "1:N",
    "description": "港口靠泊与进驻作业：舰艇入坞与装载状态流转",
    "joinNote": "用于后勤保障与港口周转能力评估"
  },
  {
    "id": "rel_mission_unit",
    "fromTable": "MissionChanged",
    "fromField": "MissionID",
    "toTable": "MissionUnitRelationChanged",
    "toField": "MissionID",
    "relationType": "1:N",
    "description": "任务兵力编组：作战任务流转与参演编队成员动态分配",
    "joinNote": "用于任务达成度与兵力使用效率度量"
  },
  {
    "id": "rel_mission_refpoint",
    "fromTable": "MissionChanged",
    "fromField": "MissionID",
    "toTable": "MissionRefPointRelationChanged",
    "toField": "MissionID",
    "relationType": "1:N",
    "description": "任务巡逻空域：作战任务与其参考参考点集合 (CAP/Strike Zone)",
    "joinNote": "用于空域封锁区覆盖率与拦截线效能评估"
  },
  {
    "id": "rel_engagement_cycle",
    "fromTable": "UnitCreated",
    "fromField": "UnitID",
    "toTable": "EngagementCycle",
    "toField": "UnitID",
    "relationType": "1:N",
    "description": "交战周期跟踪：作战单元从发现、锁定、分配到交战各阶段时长",
    "joinNote": "用于分析OODA杀伤链各环节时间消耗"
  },
  {
    "id": "rel_unit_jammed",
    "fromTable": "UnitCreated",
    "fromField": "UnitID",
    "toTable": "UnitJammed",
    "toField": "UnitID",
    "relationType": "1:N",
    "description": "电磁压制记录：实体受到雷达/通信干扰的时间与压制频段",
    "joinNote": "用于评估电子对抗压制效能与软杀伤贡献"
  },
  {
    "id": "rel_endgame_target_destroy",
    "fromTable": "WeaponEndgame",
    "fromField": "TargetID",
    "toTable": "UnitDestroyed",
    "toField": "UnitID",
    "relationType": "N:1",
    "description": "毁伤战果核验：终点命中目标与最终击毁战损记录对齐",
    "joinNote": "用于校验毁伤评估闭环"
  }
];

// 兼容既有 8 张核心骨干表导出
export const CORE_TABLE_NODES: TableNode[] = ALL_TABLE_NODES.filter((n) => n.isCore);

export const CORE_RELATION_LINKS: RelationLink[] = ALL_RELATION_LINKS.filter((l) =>
  ['rel_fire_endgame', 'rel_fire_unit', 'rel_fire_db3k', 'rel_unit_track', 'rel_unit_destroy', 'rel_unit_sensor', 'rel_contact_truth_unit'].includes(l.id)
);
