# 02. BS 态势播报 MQTT 实时帧与主题字典

> 依据源码：`integration/F1-BS/src/workers/mqtt.worker.js`（L1-2056）、`integration/F1-BS/src/workers/{websocket.js,websocketlt.js}`、`integration/F1-BS/src/views/...`、`demo-ui/proxy/bs-listener.mjs`、`demo-ui/proxy/bs-diff.mjs`。
> 真机联调证据：`LabConsole/outputs/完工报告-Q077-BS播报真机联调-20261023.md`。
> **重要事实**：BS MQTT 发布端不在本仓库 `CMO-netcore-src/` 或 `F1_Console/` 源码内，而是外部 BS/Java 服务侧；以下结构 100% 由前端唯一消费者 + Q-077 真机捕获验证。

---

## 一、MQTT 主题全集与伴生 WebSocket 通道

### 1.1 MQTT 订阅主题（`mqtt.worker.js:172, 177-186, 1945-1953`）

| 主题名 | 负载格式 / 信封特征 | `mqtt.worker.js` 解析输出 | `bs-listener.mjs` / 真机备注 |
|---|---|---|---|
| `FrameData_${serverId}` | **真机 Q-077**：单条完整帧 JSON 信封 `{"Time":"YYYY-MM-DD HH:mm:ss","Content":"<base64(gzip(bom+json))>"}`（无 `Count`）；**设计兼容分片**：`{ Time, Identifying, Count, Content }` | gunzip + 去 BOM -> `parsedResult.Scenario`（驱动全屏态势/实体/接触/任务/事件） | **真机实测 ~0.8 MB/帧 @ ~9 Hz**（注释另有 2~3 MB/帧估测）；`bs-listener` 对缺省 `Count` 按 `1` 处理并剥 `^\uFEFF` |
| `process_${serverId}` | 同为 Base64 + gzip 信封（或分片）；worker 修补 `/"UniversalTime""/g -> "UniversalTime":"` | `setPlayProcess` -> `UniversalTime` 等 | **真机 Q-077 内层**：`{"Status":1,"GameSpeed":0,"ScenarioTime":"...","StartTime":...,"EndTime":...,"TimeRemainSeconds":...}`；`Status=1` 表 `running`，`EndTime` 后曾观测到 `Status=0` 且 `TimeRemainSeconds=-67` 仍持续推帧 |
| `victory_${serverId}` | 可能为纯文本/JSON 或信封（`decodeEnvelope`） | `deductionEnd`（推演结束） | `bs-listener` 将 `playback` 置为 `finished` 并自动退订释放 `activeTaskId` |
| `ReceiveLog_${serverId}` | `{ type, msg, sideid, sidename }`（可能经 `decodeEnvelope`） | 写入 IndexedDB `db.msgLogList` -> `msgLogList`；`MessageLog.vue` 消费 `time/Time/scenarioTime/ScenarioTime, recvAt, sidename/side_name, type, msg, sideid` | `bs-listener` 出于脱敏只计条数 `att.logs += 1`，不落盘正文 |
| `scenarioTime` | `decodeEnvelope` 解包字符串 / JSON | `scenarioTime` | **Q-078b 实测真机只播一次会冻结**，`bs-listener` 优先以 `Scenario.Time`（.NET Ticks）换算的 UTC 时间为准 |
| `SaveScenarioXml_${serverId}` | `{ Time, Identifying, Count, Content }` gzip+base64 | `SnapshotScenario`（XML 导出 `exported-data.xml`） | — |
| `ResponseResult_${serverId}_${clientTopicId}` | `{ type, ... }`（`scenarioList`, `scenarioCreated`, `scenarioImported`, `scenarioLoaded`, `scenarioSaved` 等） | 路由回请求回调或 `responseResult` | — |
| `setWebsocketPort_${serverId}` | `{ Content: "ip:port" }` | `setWebsocketIp` `{ socketip, socketport }` | 触发建立 `websocket.js` 控制/Lua 通道 |
| `DBFileName` | 数据库文件名消息 | `DBFileName` | — |
| `side/transmit/range` | 阵营发射/探测范围信息 | `side/transmit/range` | — |
| *(下行发布)* `server_zhs_${serverId}` | 带 `msg.topic = ResponseResult_${serverId}_${clientTopicId}` | 前端控制指令 | 旁路监听器禁止向任何业务主题发消息 |

### 1.2 伴生 WebSocket 通道（`websocket.js`, `websocketlt.js`）
- **`websocket.js`（Lua/指令通道）**：连接 `setWebsocketPort` 下发地址（或 `sessionStorage["luaWsAddr"]`），`30s` 心跳 `{ id, content: "123" }`，前端 `$bus` 事件 `sendMsgToMqtt`/`sendMsgToMqtts` 实际通过该 WS 发送 `{ id, type, ... }`；例如 `UnitWeaponList.vue` 主动查询 `{ type: "GetMountsAndWeaponRecs", guid, isQuery: true }` 获取 `WeaponRescs`（`WeaponType`, `DefaultLoad`, `Name`）。
- **`websocketlt.js`（对局应用通道）**：`{ id, type: 0, serveid }` 30s 心跳、60s 超时重连（用于 `Deduction/Application` 等模块）。

---

## 二、真机 `FrameData_*` 四大关键编码陷阱（必读）

1. **外层单键包装（`unwrapEntity`）**：
   - `Scenario.Sides[i]` 实际结构是 **`{"Side": { ... }}`**；
   - `Scenario.ActiveUnits[i]` 实际结构是 **`{"Ship": { ... }}` / `{"Aircraft": { ... }}` / `{"Facility": { ... }}` / `{"Weapon": { ... }}` / `{"Submarine": { ... }}` 等单键包装对象**；
   - `Side.Contacts[i]` 与 `NonActiveUnits.WeaponImpacts[i]` / `UnguidedWeapons[i]`、以及 `EventTriggers` 等同样外包一层类型键（`{"Contact": {...}}`、`{"WeaponImpact": {...}}`、`{"Trigger_...": {...}}`）。
2. **全字段字符串编码**：真机导出的内层 JSON 中标量数值与布尔**绝大多数为字符串**（例如 `"CH": "282.1"`, `"CS": "143"`, `"Count": "5"`, `"ContactSIK": "True"`），解析器不得仅接收 JS `number`/`boolean`。
3. **时间戳是 `.NET Ticks`**：`Scenario.Time`（如 `"639100..."` 18 位十进制串）是以 `0001-01-01T00:00:00Z` 为原点的 100ns Ticks（换算 Unix ms：`(Number(ticks) - 621355968000000000) / 10000`）。
4. **单位对象不带 `Side` 名称，只有 `SideID`**：须先由 `Scenario.Sides[i].Side.{ID, Name}` 建立映射表后再反查每个单元所属阵营。

---

## 三、`Scenario` 完整输出层级与已证实字段表

### 3.1 Scenario 根节点与气象

| JSON 路径 | 说明 / 类型 | 消费者 / 用途 |
|---|---|---|
| `Scenario.ObjectID` | `string` | 想定切换检测 (`scenarioChanged`) |
| `Scenario.Time` | `string` (.NET Ticks, 100ns UTC) | 当前想定时钟（唯一可靠实时时钟） |
| `Scenario.StartTime` / `Duration` | `string` | `setScenarioInfo` 想定起始与总时长 |
| `Scenario.StepTime` | `string/number` | 推演步长 (`setStepTime`) |
| `Scenario.DBUsed` (或顶层 `parsedResult.DBUsed`) | `string` (如 `DB3K_505.db3`) | 装备库版本标识 |
| `Scenario.CurrentSideID` / `Scenario.CurrentSide` | `string` | 当前视角阵营 |
| `Scenario.GlobalWeather.WeatherProfile` | `object` | 气象环境参数 (`setWeatherProfile`) |
| `Scenario.UndeterminedAreas` | `array` | 未定区域 (`UndeterminedArea`) |

### 3.2 `Scenario.Sides[i].Side`（阵营、立场、条令、接触、任务、区域）

| 路径 (`Side.*`) | 内部子字段（代码直接读取） | 说明 |
|---|---|---|
| `ID`, `Name`, `Color` | 标量串 | 阵营主键、名称、颜色（供 `ActiveUnits[].SideID` 关联） |
| `MapCenter.GPoint`, `CameraAlt` | 地图中心点与视高 | 相机恢复 (`setMapCenter`) |
| `Postures` | `[{ Posture: { SideID, Value } }]` | 外交/敌我姿态：`Value`: `"0"=friend`, `"1"=enemy`, `"3"=neutral` |
| `Doctrine` | 条令对象（UI 注入 `SideName`, `SideID`） | 交战规则 / 条令配置 (`SidedDoctrineList`) |
| `ReferencePoints` | `[ { <Wrapper>: { ID, Lon, Lat, ... } } ]` | 参考点集合（坐标 `Lon`, `Lat`） |
| `Missions` | `[ { <MissionTypeKey>: { ID, Area / PatrolArea / ProsecutionArea / NavigationCourse } } ]` | 各区域点支持 `RPoint.{Lon,Lat}` / `RPoint.ID` / 直接 `{Lon,Lat}`；派生 `TaskType` (`MissionTypeKey`), `TaskArea` |
| `NoNavZones`, `ExclusionZones`, `StandardZones` | `[ { <Wrapper>: { ID, Area } } ]` | 禁航区/禁入区/标准区（注：`mqtt.worker.js:1860` `setCurrentSide` 有直接读 `lastScenarioData.ExclusionZones`） |
| `Contacts` | `[ { Contact: { ID, ActualUnitID, IDStatus, Type, SIK, Position } } ]` | 探测接触表：`SIK==="True"` 或 `Number(IDStatus)===4` 表示已确知真实身份；UI 会按 `ActualUnitID` 合并 `ActiveUnits` 坐标姿态 |

### 3.3 `Scenario.ActiveUnits[i].<UnitType>`（活动单位与编队）

支持常见单键容器名：`Ship`、`Aircraft`、`Facility`、`Weapon`、`Submarine`、`Satellite`、`Group` 等：

| 分类 | 已证实字段名 | 说明 / 注意事项 |
|---|---|---|
| **基础身份与编组** | `ID`, `DBID`, `Name`, `Piname`, `UnitTyper`, `GroupType`, `ParentGroup`, `SideID`, `Side`(通常缺失), `GroupLead`, `UnitChildren`, `Description`/`Catalog` | `UnitTyper==="Group"` 时：`GroupLead` 内部为 `{ <Type>: { ID } }`，`mqtt.worker.js` 将领队属性合并并挂 `UnitChildren` |
| **运动学与空间状态** | `LonLR`, `LatLR`, `Longitude`, `Latitude`, `Lon`, `Lat`, `CA` / `CurrentAltitude`, `CH` / `CurrentHeading`, `CS` / `CurrentSpeed` | 真机优先读 `CH`/`CS`/`CA`/`LonLR`/`LatLR` 或 `Longitude`/`Latitude`（均可能为数字字符串） |
| **作战状态与损毁** | `Status`, `StatusRemark`, `Base`, `AssignedMission`, `IsHasAirOrShip`, `CargoType`, `DamageState`, `FuelRemark` | `bs-diff.mjs` 对 `DamageState` 字符串用 `/destroy\|killed\|sunk\|wreck\|dead\|摧毁\|击毁\|沉没\|已毁/i` 判定毁伤 |
| **燃油数组 `Fuel`** | `Array<{ FuelRec: { FT, CQ, MQ } }>` | `FT`=燃油类型，`CQ`=当前油量，`MQ`=最大油量 |
| **传感器数组 `Sensors`** | `Array<{ Sensor: { ID, Name, Type, SensorType, Description, RangeMax, Active, CanBeActive } }>` | 传感器开机态 (`Active`) 与最大作用距离 (`RangeMax`) |
| **覆盖扇区与最大射程** | `ARWedge`, `LRWedge`, `URWedge`: `Array<{ Id, RangMax, LeftArc, RightArc }>`<br>`AirRangeMax`, `SurfaceRangeMax`, `LandRangeMax`, `SubsurfaceRangeMax` | 防空/对海/对潜包络扇区与四类最大射程 |
| **武器挂架与弹库 `Mounts` / `Magazines`** | `Mounts`: `Array<{ Mount: { Name, DBID, MW: [{ WRec: { WeapID } }], MMW: [{ WRec: { WeapID } }], Weapons?: [{ Name|name }] } }>`<br>`Magazines`: `Array<{ Weapons?: [{ Name|name }] }>` | **关键注意**：UI 的 `UnitWeaponList.vue` 不从 `FrameData` 读武器余弹，而是走 WebSocket 发 `GetMountsAndWeaponRecs` 读 `WeaponRescs[].DefaultLoad`；真机帧中 `Mounts[].Mount` 的 `MW/MMW` 或弹药 `Weapons` 字段随引擎输出形态存在可选差异 |

### 3.4 `Scenario.NonActiveUnits` 与剧情事件对象

| 路径 | 内部结构与字段 | 用途 |
|---|---|---|
| `NonActiveUnits.WeaponImpacts` | `Array<{ WeaponImpact: { ID, Longitude, Latitude, CurrentAltitude } }>` | 武器落点可视化 (`WeaponImpac.vue`) |
| `NonActiveUnits.UnguidedWeapons` | `Array<{ <Type>: { ID, Longitude, Latitude, CurrentAltitude, CurrentHeading, Type } }>` | 无制导武器航迹 (`UnguidedWeapons.vue`) |
| `Scenario.EventTriggers` | `Array<{ Trigger_<Type>: { ID, ... } }>` | 触发器（解析出 `type = key.split("_")[1]`） |
| `Scenario.EventConditions` | `Array<{ Condition_<Type>: { ID, ... } }>` | 条件（解析 `type`） |
| `Scenario.EventActions` | `Array<{ Action_<Type>: { ID, ... } }>` | 动作（解析 `type`） |
| `Scenario.SimEvents` (或 `Scenario.SimEvent`) | `{ SimEvent: {...} }` 或直出对象（含 `Triggers`, `Conditions`, `Actions` ID 数组） | 场景脚本事件主装配关系（非事件日志！） |

---

## 四、旁路差分衍生事件流（`demo-ui/proxy/bs-diff.mjs`）

`eval-service` 的时序/态势算子若复用或对照 `bs-diff.mjs`，其**帧落盘记录**与**事件卡输出**结构如下：

1. **`frames-*.jsonl` 每行结构**：
   `{ "receivedAt": "<ISO UTC>", "serverId": "<sid>", "scenarioTime": "YYYY-MM-DD HH:mm:ss", "frame": { "Scenario": { ... } } }`（默认每 10 帧落 1 条 + 产生事件卡的帧必落）。
2. **`diffFrames(prev, next)` 产出的事件卡（`makeCard`）**：
   `{ eventId: "evt-<base36>-<seq>", scenarioTime, detectedAt, side, kind, subject, object, severity: "major"|"minor", detail, source: "diff" }`
   - **`MAJOR_KINDS`** (`unit_destroyed`, `weapon_fired`, `detection_new`, `playback_state`, `parse_error`) + **`engine_event`**
   - **`MINOR_KINDS`** (`unit_new`, `unit_maneuver` [默认阈值：`headingDeg > 30°` 或 `speedRatio > 0.5`], `detection_lost`)
   - **安全防误报**：当下一帧缺少对应容器（如 `ActiveUnits` / `Sides[side].Contacts` 缺失或非数组）时，`diffFrames` 通过 `onSkip` 留痕，**绝不伪造 `unit_destroyed` 或 `detection_lost`**。
