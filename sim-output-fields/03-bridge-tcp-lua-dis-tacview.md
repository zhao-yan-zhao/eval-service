# 03. Bridge / TCP / Lua / Tacview / DIS 与下游衍生表输出字段

> 本文件汇编除 `EventExporter` 与 `BS MQTT` 外的其余 **5 类 F1 原生输出通道**，以及 **`LabConsole` 下游清洗/计算衍生契约**（均直接来自对应 `.cs` / `.lua` / `.py` 源码实证）。

---

## 一、AiAssistant HTTP Bridge 输出契约（默认 `http://127.0.0.1:9477/`）

源码位置：`CMO-netcore-src/AiAssistant.F1Core/Bridge/AiAssistantBridge.cs`、`SimulationContracts.cs`、`CoreSimulationGateway.cs`、`CorePulseEngine.cs`、`MockResultGateway.cs`、`RunMeasurementReader.cs`、`CoreF1AutomationFacade*.cs`、`ToolRegistry.cs`。

### 1.1 端点一览
- `GET /health` -> `{ ok: true, scene, lua_channel? }`（`AiAssistantBridge.cs:1268-1277`）
- `POST /bridge/scene/rebind` -> `{ ok, error, message, binding_task_id, scene_path, fingerprint, generation }`（`:950-990, 1252-1266`）
- `POST /invoke` -> 传入 `{ tool, args, token, idempotency_key }` 调用白名单工具（33 个基础工具 + 条件性 `lua.exec`，见 `CoreF1AutomationFacade.cs:32-67`）。与推演输出直接相关的核心工具如下：

### 1.2 `simulation.run` & `simulation.status` -> `SimulationJobSnapshot`（`SimulationContracts.cs:279-357`）

| JSON 键 | C# 属性 / 类型 | 说明 / 枚举取值 |
|---|---|---|
| `ok`, `partial`, `used_process_kill`, `edit_blocked` | `bool` | 执行状态、早退标记、是否强杀、编辑锁（`IsEditBlocked` 在停止未确认时粘滞） |
| `status` | `SimulationJobStatus` | `None`, `Running`, `DrainingExport`, `Succeeded`, `Stopped`, `TimedOut`, `Failed` |
| `phase` | `SimulationPhase` | `Idle`, `Pulsing`, `DrainingExport`, `Finalizing` |
| `requested_pulses`, `completed_pulses` | `int` | 脉冲数；`simulation.run` 当前仅支持 `speed == "max"`，脉冲范围 `[1, 100000]` |
| `job_id`, `run_id`, `timeline_id` | `string` | 单局运行时 `Scenario.TimelineID` 被隔离设置为 `runId` |
| `export_dir_ref` | `string` | 隔离输出目录 `{root}/ai/{task}/{run}/` |
| `error_code`, `stop_reason`, `stop_diagnostics`, `failure_reason` | `string` | `FailureReason` 最长 500 字符（异常类名+消息+首帧堆栈） |
| `duration_semantics` | `string` | `pulses` \| `seconds` \| `minutes` |
| `target_game_seconds`, `resolution_at_start`, `resolution_at_end`, `elapsed_game_seconds` | `double` / `double?` | 真实游戏时钟推进度量（秒；`GameResolution` 秒/脉冲） |
| `start_clock`, `target_clock`, `end_clock` | `string` (ISO 8601 `"o"`) | 想定真实时钟（非墙钟） |
| `termination_reason` | `string` | `scenario_ended`, `scenario_ended_before_target` (`partial=true`), `engine_stalled`, `engine_stalled_before_target` (`partial=true`), `clock_target_reached`, `clock_target_not_reached`, `pulse_limit_reached`, `user_or_orchestrator`, `wall_clock`, `orchestrator_cancel_idempotent`, `error:<code>` |

### 1.3 `result.read` -> `ResultReadSnapshot`（`SimulationContracts.cs:388-463`, `MockResultGateway.cs`）
- 硬契约：**仅读取 CSV（`source = "csv"`，禁 SQLite）**，严格按 `TimelineID == runId` 过滤；支持 `aggregation` (`none | by_side | by_unit`) 与 `max_rows` (`1..5000`)；Facade 额外注入 `scenario_clock`。
- 返回键：`ok`, `run_id`, `source` (`"csv"`), `partial`, `retryable`, `export_dir_ref`, `error_code`, `user_message`, `lock_retry_attempts`, `scenario_clock`
- `metrics`: `{ event_rows_this_run, event_rows_other_run, csv_file_count, empty_metrics }`
- `aggregation`: `Record<string, int>`
- `sample_rows`: `Array<Record<string, string>>`
- `csv_file_refs`: `Array<{ path, event_type, bytes }>`

### 1.4 `measurement.read` -> `RunMeasurementReader`（`RunMeasurementReader.cs:1-698`, `CoreF1AutomationFacade.cs:2056-2080`）
- 解析隔离目录下 `*UnitPositions*.csv`（按 `TimelineID == runId` 及可选 `unit_id` 过滤），产出同局运动学证据：
  - 顶层：`ok`, `run_id`, `measurement_status` (`ok | empty | partial_anomaly | unit_not_found_in_run_data`), `artifact_path`, `artifact_sha256`, `artifact_bytes`, `artifact_files`, `rows_this_run`, `rows_other_run`, `clock_anomalies`
  - `units[]` 每单元：`unit_id`, `unit_name`, `unit_side`, `unit_class`, `sample_count`, `first_time_seconds`, `last_time_seconds`, `time_span_seconds`, `has_position_columns`, `clock_anomalies`, `distance_nm` (累计航程), `displacement_nm` (起终直线位移), `speed_reported_mean_kts`, `speed_reported_last_kts`, `speed_derived_mean_kts`, `speed_derived_segment_mean_kts`, `speed_derived_max_kts`

### 1.5 `scenario.audit` -> `scenario-audit/v1`（`CoreF1AutomationFacade.ScenarioAudit.cs:60-589`）
- 只读分页盘点当前想定：`schema_version = "scenario-audit/v1"`, `collection` (`units | missions | events | reference_points | areas | database | all`), `offset`, `max_items` (上限 200), `total`, `returned_count`, `truncated`, `next_offset`, `snapshot_generation` (SHA-256), `recognized_spawn_unit_plans`, `database` (`bound, path, file_size_bytes, mtime, hash, db_name, file_name, dbid, db_registry_status`) 及 `db3k.detail` 装备详情证据。
- **Boundary**：`LuaExecDiff.cs:11` / `CoreF1AutomationFacade.cs:1832` 明文规定 Bridge 不捕获 KeyValue / 接触 / 姿态（`"键值/接触/姿态不入对账"`）。

---

## 二、TCP `DataOutputServer` 与 `F1-Console` CLI 输出

### 2.1 TCP `DataOutputServer`（`CMO-netcore-src/Mod/EventDataStreamOutput/{DataOutputServer.cs,DataMessage.cs}`, `ClientCore.cs:1085-1103`）
- 配置来自 `F1Config/EventDataStreamOutput.ini`（`[Server] Port`、`AutoStart`）；仅在 `isAutoStart && !GameGeneral.b_IsAIMode` 时自启。
- 线路格式：**UTF-8 NDJSON**（`JsonConvert.SerializeObject(msg) + "\n"`）：
  ```json
  {
    "DataStreamType": 1,       // 0=Unknown, 1=MessageLog, 2=EventOutput
    "MessageEventType": 4,     // DataStreamType=1 时为 LoggedMessage.MessageType; =2 时为 ExportedEventType byte
    "MessageContent": "..."
  }
  ```
- **仅 2 处真实生产者**：
  1. **日志流**（`Scenario.cs:4687-4693`）：`DataStreamType = MessageLog`，`MessageEventType = (byte)LoggedMessage.MessageType`（`None=0`, `NewContact=1`, `ContactChange=2`, `WeaponLogic=3`, `WeaponEndgame=4`, `WeaponDamage=5`, `UnitLost=6`, `UnitDamage=7`, `PointDefence=8`, `UI=9`, `WeaponImpact=10`, `AirOps=11`, `DockingOps=12`, `SpecialMessage=13`, `EventEngine=14`, `NewMineContact=15`, `CommsJamming=16`, `CommsDisruption=17`, `NewWeaponContact=18`, `Sonar=19`, `DefensiveJamming=20`, `OffensiveJamming=21`, `UnitAI=22`, `UnguidedWeapon=23`, `System=24`, `CargoOps=25`, `UnitAIEmergency=26`, `LuaInputMessage=98`, `OpenDebugUI=99`），`MessageContent = "[{SideName}|]{Timestamp}|{Text}"`。
  2. **事件 CSV 行实时镜像**（`EventExporter_CSV.cs:247-251`）：`DataStreamType = EventOutput`，`MessageEventType = (byte)result.EventType`，`MessageContent` 为当条完整的 CSV 逗号转义行（**无表头**）。

### 2.2 `F1_Console` CLI（`F1_Console/MyConsoleApplication.cs:340-696`）
- 命令行参数：`-R <scen>`, `-C <out.xml>`, `-S <LuaScript.lua>`, `-M <0|1>` (`b_IsSchemeRun`), `-TCP <ip>`, `-PORT <port>`, `-SCHEMENAME <name>`, `-SCHEMERUNTIMES <int>`, `-GUID <guid>`, `-PULSERESOLUTION <double>`, `-AIMODE <0|1>`, `-LUASERVERPORT <port>`, `-AUTORUN <0|1>`。
- **TCP 进度报文**（`b_IsSchemeRun && TCP_PORT > 0`）：每 `500 ms` 发送 UTF-8 字符串 `"{g_RunGuid}#{pct:0.00}%MSEND"`，结束发送 `"{g_RunGuid}#100.00%MSEND"` 后 `Process.GetCurrentProcess().Kill()`；stdout 循环输出 `theScen.Time`（每 500 ms）。

---

## 三、Lua `<LuaXml>` 埋点与运行时查询接口（`CMO-netcore-src/Command_Core/Lua/`）

### 3.1 `<LuaXml>` KeyValue 持久化与评分通道（`LuaSandBox.cs:453-460, 2720-2870`, `Scenario.cs:2437-2439`, `CNT-04`）
- **`ScenEdit_SetKeyValue(key, value[, forCampaign])`**：将键值对作为 XML 子元素 `<key>value</key>` 写入 `Scenario.LuaXml` 下的 `<KeyValueDatastore>`，随 `scenario.save` 保存为纯文本 `.scen` XML。
  - **硬约束**：C# 用 `XElement(key, value)`，**`key` 严禁包含冒号 `:`**（会直接抛 `XName` 异常），必须用点号 `.`（如 `lab.judge.version`, `lab.ev.red_destroyed.<guid>`）。
- **`ScenEdit_GetKeyValue` / `ScenEdit_GetKeyStore` / `ScenEdit_ClearKeyValue`**：读写与清空键值库。
- **`ScenEdit_SetScore(SideNameOrID, Score, 'Reason')` / `ScenEdit_GetScore(SideNameOrID)`**：读取或修改阵营总分 (`side.GetTotalScore`) 与改分原因日志。
- **`ScenEdit_CurrentTime()`**：返回当前场景时钟 Unix 秒（替代 `os.time` 保证可复现性）；另有 `ScenEdit_GetDateTimeTicks`、`ScenEdit_GetTimeOfDay`、`ScenEdit_GetWeather()`（`{ temp, rainfall, undercloud, seastate }`）。

### 3.2 Lua AAR / 实时对象导出与中间件（`PrivateMethods.cs`, `LuaWrapper_*.cs`, `F1_Middleware_State.cs`）
- **`VP_GetScenario()` -> `LuaWrapper_Scenario`**：`guid, Duration, DurationNum, StartTime, StartTimeNum, CurrentTime, CurrentTimeNum, DBUsed, Complexity, Difficulty, ScenSetting, ScenDate, Title, ContentTag, CampaignID, CampaignSessionID, CampaignScore, InCampaignMode, GameMode, GameStatus, FileName, FileNamePath, SaveVersion, Sides(数量), HasStarted, Status("Paused"|"Running"|"未定义"), PlayerSide, TimeCompression`。
- **`VP_GetSide({side=...})` / `VP_GetSides()` -> `LuaWrapper_Side`**：
  - 基础与集合：`guid, ObjectID, name, doctrine, units, contacts, exclusionzones, nonavzones, standardzones, customenvironmentzones, rps, awareness, proficiency, hasmines, missions, Operation, Chalks`
  - **内置 AAR 统计表**：`losses` (`[{ type, dbid, name, count }]` 源自 `mySide.AAR.Losses`)、`expenditures` (`[{ type="Weapon", dbid, name, count }]` 源自 `mySide.AAR.Expenditures`)。
- **`VP_GetUnit` / `ScenEdit_GetUnit` / `F1_GetUnit`**：暴露 `guid, name, side, type, typeN, subtype, category, classname, dbid, latitude, longitude, altitude, speed, groundSpeed, throttle, heading, desiredheading, pitch, roll, damage, fuel, fuels, fuelstate, weaponstate, unitstate, condition, condition_v, magazines, mounts, sensors, components, airFacilities, dockFacilities, cargo, loadoutdbid, readytime, mission, group, formation, course, ascontact, targetedBy, firingAt, firedOn, signature, noiseLevel, outOfComms, jammed, jammer, weather, OODA, doctrine`。
- **`VP_GetContact` / `ScenEdit_GetContact` / `ScenEdit_GetContacts`**：暴露 `guid, name, actualunitid, actualunitdbid, latitude, longitude, speed, heading, altitude, posture, observer_posture, areaofuncertainty, type, typed, type_description, classificationlevel, potentialmatches, side, fromside, detectedBySide, age, BDA, emissions, detectionBy, targetedBy, firingAt, firedOn, lastDetections, markedAsDecoy`。
- **XML/文本转储函数**：
  - `VP_ExportUnits(table, fileName)` -> 写 `<fileName>.exu`（含 `ContentScenario` 与单位 SBR Delta + `Damage/Mounts/Magazines/Propulsion/OnboardCargo`）并追加 `Logs/LuaExport.txt`；
  - `Tool_DumpEvents()` -> 写 `<FileName> events.xml`；`ScenEdit_ExportScenarioToXML()` / `ScenEdit_ExportDoctrineToXML()` / `ScenEdit_ExportMission()`；
  - `F1_Middleware_Init` / `F1_Middleware_Step` -> 输出 `|` 分隔记录 `WeaponInit:` / `LaunchableCheck:` / `WeaponLaunch:`。

---

## 四、Tacview ACMI 2.1 与 DIS 分布式交互仿真 PDU

### 4.1 Tacview (`EventExporter_Tacview2x.cs`, `TacviewRealtime.cs`, `TacviewPipe.cs`)
- 文件头（`:1776-1778`）：`FileType=text/acmi/tacview\r\nFileVersion=2.1\r\n0,ReferenceTime=<yyyy-MM-ddThh:mm:ss>Z`
- 时间帧格式：`#<Floor(TotalSeconds)>.<ms:D3>`；销毁/着陆/回坞删号：`-{tacviewID}`。
- 坐标姿态（`PrintPositionAndAttitude` `:302-508`）：`T=<Lon>|<Lat>|<Alt>[|<Roll>|<Pitch>|<Heading>]`（水面舰仅在非 Ship 或 Facility 时写高程；未含高程的 Contact 按类型填充 `6000`/`200000`/地形高/0）。
- 声明属性（`DeclareNewUnit` `:702-830`）：`Type=<Size>+<Domain>+<Class>`, `Length`, `Width`, `Height`(部分建筑), `Coalition`, `Color` (`Blue/Red/White/Orange/Green`), `Name` (`UnitClass`), `Pilot` (`Unit.Name`), `Group`, `Parent` (武器父平台 ID)。
- **仅处理 10 类 `ExportedEventType`**：`UnitPositions`, `ContactPositions`, `WeaponFired`, `WeaponEndgame` (`HIT`/`KILL` 消隐), `UnitDestroyed` (消隐), `UnitDamaged` (在 `GetEventString:1385-1389` 篡改为 `UnitPositions`), `AirOps` (`Landing` 消隐), `DockingOps` (`Docking` 消隐), `WeaponImpact`, `Explosion` (`Type=Misc+Explosion`), 以及选择性的 `EngagementCycle` (`Dropping contact` 与 `Contact ID status changed`)。

### 4.2 DIS PDU 输出（`CMO-netcore-src/Dis/DisConnector.cs`, `IDISConnector.cs`, `DISConnectManager.cs`）
- **`EntityStatePdu`** (`EntityState` & `UnitDestroyed` `:754-905, 1178-1207`)：`ForceId`, `ExerciseID`, `EntityID`, `EntityType` (7段标准分类，映射表或自定义地图), `Marking` (ASCII 最多 11 字节), `EntityLocation` (ECEF XYZ `Vector3Double`), `EntityLinearVelocity` (`m/s`), `EntityOrientation` (`Phi/Psi/Theta`), `DeadReckoningParameters` (算法 1/4 + 加速度/角速度), `EntityAppearance` (损伤位 0/8/16/24 + 飞机油门/状态位)。
- **`SeesPdu`**（随每次 `EntityStatePdu` 发送 `:908-920`）：硬编码向量喷管参数（`10, 10`）。
- **`FirePdu`** (`:923-968`)：`FiringEntityID`, `TargetEntityID`, `MunitionID`, `EventID`, `LocationInWorldCoordinates`, `BurstDescriptor` (`"武器_" + weaponDbID`, `Quantity=1`), `Range` (`TargetContactRangeSlant_nm * 1852.0f`)。
- **`DetonationPdu`** (`:969-1177`)：`MunitionID`, `FiringEntityID`, `TargetEntityID`, `LocationInWorldCoordinates`, `Velocity`, `LocationInEntityCoordinates`, `DetonationResult`（按碰撞介质/结果映射 `AirHit`, `WaterBlast*`, `GroundImpact`, `EntityImpact`, `MissDueToEndGameFailure` 等）。
- **`UaPdu`（被动声呐）** (`:1208-1263`)：`PassiveParameterIndex` (`DesiredSpeed`), `PropulsionPlantConfiguration` (`0/1/2/4/7`)。
- **会话控制 PDU**：`StartResumePdu`, `StopFreezePdu` (`Reason=1`), `ActionRequestPdu` (`ActionID = speed`)。
- **未实现/死代码**：**全仓不输出电磁辐射 `EePdu`**；`SideForceIDMapPDU.cs` 存在但无任何调用点（实走 `F1Config/DisSideForceIDMap.ini`）。

---

## 五、下游 `LabConsole` 清洗归一化与统计衍生表（非引擎直出，供中台复用对照）

在 `docs/推演评估中台总体设计方案.md` §2.3 明确计划复用 `LabConsole/tools/metrics/metrics.py` 适配器。该层产生的**衍生格式**与原生引擎差异如下：

1. **`csv_normalize.py` 产出 (`normalized/*.csv` + `normalize_report.json`)**：
   - 去双 BOM 与时间戳前缀；对重复列按 `__2`/`__3` 重命名；用 `event_semantics/registry.json` 做事件别名与列名统一（兼容人工夹具里的 `Damage.csv`, `MunitionName`, `PlatformName`, `PulseCount` 等）。
2. **`metrics.py` (`METRICS_VERSION = "1.0"`) 输出 JSON**：
   - 键：`metrics_version`, `generated_at`, `success_definition` (`"spec_criteria"`), `success_rate`, `success_ci` (`wilson 95%` + `file_line` 溯源), `losses_by_side`, `shots_fired`, `hits`, `consumption`, `first_event_times`, `engagement_cycles` (`SEGMENT_GAP_SECONDS = 60`), `game_seconds`, `cost_basis`, `cost_effectiveness`, `consumption_comparison`, `cost_details`, `cost_notes`, `success_rate_reason`（多 run 时包装在 `multi_run: true, run_metrics: {...}`）。
3. **批跑/矩阵聚合 CSV**（带单 BOM 或无 BOM，存在于 `LabConsole/outputs/{mc-coarse-240,matrix/results,handoff-地狱景观-20261023}/`）：
   - `per_run_metrics.csv` (10 列), `summary_by_scenario.csv` (10 列), `matrix_results.csv` (28 列), `单位台账-现役.csv` (8 中文列：初始编制台账)。
