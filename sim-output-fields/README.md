# F1 / CMO 仿真系统全量输出字段实证总览

> 审计基准：纯代码静态核查 + 仓库实测样本（零修改既有工程代码，只读盘点）。
> 服务目标：为后续独立评估中台（`eval-service`：算子库 / 指标库 / 评估库）提供零臆造、字段级精确的数据契约依据。

---

## 一、F1 仿真七大输出通道全景矩阵

通过检索 `CMO-netcore-src/`、`F1_Console/`、`integration/F1-BS/`、`demo-ui/proxy/` 与 `LabConsole/` 实测产出，F1 仿真体系实际存在 **7 类原始输出通道**（外加 `LabConsole` 与 `demo-ui/proxy` 的衍生归档产出）：

| 编号 | 输出通道 | 源码/实现入口 | 物理载体 / 协议 | 触发机制 | 典型体量 / 频率 | 状态与适用场景 |
|---|---|---|---|---|---|---|
| **A** | **EventExporter 事件/状态导出器** | `CMO-netcore-src/Command_Core/EventExporterManager.cs`, `IEventExporter.cs`, `EventExporter_{CSV,XMLFile,XLS,Sqlite,MySql}.cs` | CSV / XML / XLS / SQLite / MySQL | 初始化导全量基线 + 事件驱动 + 周期抽样 (`ShouldExportEvent`) | CSV 实测 14~31 表；`UnitPositions` 单文件可达 1.18M 行 / 1.8 GB | **核心离线/事后评估数据源**；支持 `TimelineID` 与 `MC_Run` 隔离 |
| **B** | **BS 态势播报 MQTT 实时通道** | 消费端：`integration/F1-BS/src/workers/mqtt.worker.js`, `F1-BS/src/views/...`, `demo-ui/proxy/bs-{listener,diff}.mjs`（※发布端位于外部 BS 后端，不在 `CMO-netcore-src/`） | MQTT over WebSocket / TCP（Base64 + gzip + BOM JSON） | 推演运行周期广播 + 进度/终局/日志主题 | 真机 Q-077 实测全帧 **~0.8 MB/帧 @ ~9 Hz**（代码注 2~3 MB）；2 小时逐帧 ≈ 52 GB | **实时态势算子 / 在线播报 / 状态机演化主数据源** |
| **C** | **TCP `DataOutputServer` & CLI 进度流** | `CMO-netcore-src/Mod/EventDataStreamOutput/DataOutputServer.cs`, `EventExporter_CSV.cs:250`, `Scenario.cs:4687-4693`, `F1_Console/MyConsoleApplication.cs:350-380` | TCP Socket（NDJSON + `\n` / UTF-8 进度串） | `MessageLog` / CSV `EventOutput` 并发推送；CLI 500ms 心跳 | 实时事件流 + `{guid}#{pct:0.00}%MSEND` | 实时消息监控 / 试验方案调度进度感知（`!b_IsAIMode` 时才自启） |
| **D** | **AiAssistant HTTP Bridge 测量与控制遥测** | `CMO-netcore-src/AiAssistant.F1Core/Bridge/AiAssistantBridge.cs`, `CoreSimulationGateway.cs`, `CorePulseEngine.cs`, `MockResultGateway.cs`, `RunMeasurementReader.cs`, `CoreF1AutomationFacade*.cs` | HTTP JSON（默认 `127.0.0.1:9477`：`POST /invoke`, `GET /health`, `POST /bridge/scene/rebind`） | `simulation.run/status`, `result.read`, `measurement.read`, `scenario.audit` | 隔离目录 `{root}/ai/{task}/{run}/` | AI 代理闭环、脉冲与想定时钟门控、运动学同局测量 |
| **E** | **Lua `<LuaXml>` 持久化埋点 & 运行时查询** | `CMO-netcore-src/Command_Core/Lua/{LuaSandBox.cs,PrivateMethods.cs,LuaWrapper_*.cs,F1_Middleware_State.cs}` | `.scen` 内嵌 `<LuaXml><KeyValueDatastore>`, `Side.Score`, `.exu`, `events.xml`, LuaTable | 脚本触发器 (`EventTrigger`) / 外部 `template.execute` / `lua.exec` | 轻量标量判据 + AAR 损毁/消耗清单 | 判据级打分（KeyValue 禁冒号 `:`）、AAR 战果/消耗、`F1_Middleware_*` 管道 |
| **F** | **Tacview ACMI 2.1 遥测** | `CMO-netcore-src/Command_Core/EventExporter_Tacview{2x,Realtime,Pipe}.cs` | ACMI 2.1 文本文件 / TCP 实时流 / 命名管道 | 节流后位置 + 离散交战/毁伤/起降/爆炸事件 | 增量对象属性 + `#seconds.ms` 时戳 | 3D 航迹与空战回放（仅支持 10 类 `ExportedEventType`） |
| **G** | **DIS 分布式交互仿真 PDU 流** | `CMO-netcore-src/Dis/{DisConnector.cs,IDISConnector.cs,DISConnectManager.cs}` | IEEE DIS UDP PDU（OpenDIS） | `EntityState`/`Sees`/`Fire`/`Detonation`/`Ua` 等映射调用 | 毫秒级实体状态 & 交战 PDU | 外部 LVC 联邦互联（※未导出电磁辐射 `EePdu`） |

> 补充说明（下游消费派生层，**非 F1 原生输出**）：
> - `LabConsole/outputs` 与 `LabConsole/tools/{csv_normalize,metrics,csvkit}` 会将原始 CSV 去时间戳前缀与双 BOM、把 `UnitDamaged` 或测试夹具映射为规范表（含测试夹具中的 `Damage.csv`），并计算 `metrics.py`、`matrix_results.csv`、`per_run_metrics.csv`、`summary_by_scenario.csv`。
> - `demo-ui/proxy/bs-diff.mjs` 对 `FrameData_*` 做帧间差分，生成事件卡流（`MAJOR_KINDS` 5 类 / `MINOR_KINDS` 3 类）。

---

## 二、文档与代码实证核对清单（纠偏汇总）

遵照“**遇到文档写的内容必须到代码中实事求是查证**”原则，以下为对照 `docs/推演评估中台总体设计方案.md`、`LabConsole/content/CSV表清点与用途.md` 及源码注释发现的**核心事实偏差**：

| 编号 | 文档/注释原述 | 源码/真机实证结论 | 依据位置 | 对评估中台的直接影响 |
|---|---|---|---|---|
| **D1** | 设计方案 §3.1 称引擎离线 CSV 包含 **`Damage.csv`** | **引擎原生从不输出 `Damage.csv`**！`ExportedEventType.UnitDamaged = 17`，`EventExporter_CSV.cs` 用 `result.EventType.ToString()` 生成 **`UnitDamaged.csv`**。`Damage.csv` 仅存在于 `LabConsole/runs/` 的人工测试夹具或 `csv_normalize` 归档别名中。 | `IEventExporter.cs:50`<br>`EventExporter_CSV.cs:208`<br>`EventExporterManager.cs:330` | 中台 CSV 适配器必须以 `UnitDamaged.csv`（或去前缀 `*UnitDamaged*.csv`）为主名，兼容 `Damage.csv` 别名。 |
| **D2** | 设计方案 §3.1 称 BS MQTT 帧包含 **`Heading`/`Speed`/`DamageState`/`Count`/`Contacts`/`Events`**，且“数值型字段已格式化完备，场景时间采用 ISO8601 或 .NET Ticks” | 1) 真实帧全为**字符串编码数字**（如 `"CH": "282.1"`、`"CS": "143"`、`"Count": "5"`）；<br>2) 航向/速度实为 `CH`/`CurrentHeading` 与 `CS`/`CurrentSpeed`；`Count` 为分片信封或武器记录字段，UI 自身用 `Mounts[].Mount.MW[].WRec` / `Fuel[].FuelRec`；<br>3) `ActiveUnits[i]`、`Sides[i]`、`Contacts[i]` 均包了一层类型键（`{"Ship":{...}}` / `{"Side":{...}}` / `{"Contact":{...}}`）；<br>4) 场景事件字段是 **`EventTriggers` / `EventConditions` / `EventActions` / `SimEvents`（或 `SimEvent`）**，不是 `Events`；<br>5) `Scenario.Time` 实测为 **.NET Ticks** 字符串，`scenarioTime` 主题真机只播一次会冻结。 | `mqtt.worker.js:531-826`<br>`bs-diff.mjs:46-63,110-114,243-264`<br>`bs-listener.mjs:508,825-834`<br>`完工报告-Q077-BS播报真机联调-20261023.md:19-30` | 状态模型构造器必须：**剥壳 (`unwrapEntity`) + 字符串转数值 + `SideID→SideName` 映射 + `.NET Ticks` 转 UTC 时钟 + 读取 `SimEvents/EventTriggers`**。 |
| **D3** | 设计方案 §3.2 按 BS 帧 **1Hz 分片**估算体积，且 `mqtt.worker.js` 按 `{Time,Identifying,Count,Content}` 分片 | Q-077 真机实测 **`FrameData_<sid>` 单条消息即完整一帧**（无 `Count`/`Identifying`），信封 `{Time, Content}` 内层 gunzip 后**带 UTF-8 BOM (`\xEF\xBB\xBF`)**，且推流频率为 **~9 Hz、单帧 ~0.8 MB**（非 1 Hz）。 | `bs-listener.mjs:403-420,497-498`<br>`完工报告-Q077:13-20,51` | 监听器不得强制要求 `Count > 0`，解析前必须先剥 BOM，落盘必须支持抽稀（如每 10 帧 + 关键事件全保）。 |
| **D4** | 设计方案 §3.3 `bs-commentary` 文档预期通过 `process_<sid>` 获取结束态 | 真机实测在想定 `EndTime` 之后仍以 9Hz 发帧，**`process_<sid>` 内层 `Status=1` 表示 `running`**，局末观测到 `Status=0` 且 `TimeRemainSeconds=-67` 但未断流；真机终局应以 **`victory_<sid>`** 或 `Scenario.Time` + 业务状态判定，不能假定 `Status=0` 必为 `finished`。 | `bs-listener.mjs:361-392`<br>`完工报告-Q077:21,76` | 实时态评估器对 `process Status=0` 应保持 fail-closed，结合 `victory_` 与时钟推进检测。 |
| **D5** | `CSV表清点与用途.md:122` 称“**`WeaponImpact / EngagementCycle / SensorDetectionAttempt` 等开关在 `F1Config\EventExportExtra.ini`**”；`IEventExporter.cs:66` 注释称“**`UnitJammed` 以下未配置 SQL 导出，仅支持 CSV**” | 1) **`SensorDetectionAttempt` (5)、`PointDefenceAndDECM` (6)、`WaterSplash` (14)、`SimExecution` (16)、`CargoTransfer` (18) 在全库零调用点（死枚举）**，在 `EventExportExtra.ini` 中打开也不会产生任何行；<br>2) `WeaponImpact.cs:175` 检查的是 **`ExportExplosions`** 而不是 `ExportWeaponImpacts`！INI `IsExportWeaponImpactEvent` 实际不控制任何导出；<br>3) **`IEventExporter.cs:66` 注释完全过时**：`UnitJammed` 及其后所有 13 张表（至 `FirstSensorToUnitRecordCreated`）均已在 `DBTablesDefine` 定义（共 36 张）；**真正漏配在 `DBTablesDefine` 导致 SQLite/MySQL 静默丢弃的是 `Explosion` (11)**！ | `EventExporterManager.cs:221-715`<br>`WeaponImpact.cs:175`<br>`IEventExporter.cs:38-78` | 指标/算子严禁依赖 5 个死枚举与 `SensorStatusChanged`；如需捕获雷达未探测事件，必须走事件日志或补充引擎埋点；切勿把 `Explosion` 依赖压在 SQLite/MySQL 通道。 |
| **D6** | 假设 `EventExport.ini` 控制自动导出或所有通道默认开相同事件 | 1) `F1Config\EventExport.ini` 仅为废弃常量，实际读 `EventExportExtra.ini`（仅 `RunInCmdMode` 下由 INI 控制通道）；<br>2) `b_IsSchemeRun=true`（CLI `-M 1`）时，`EventExporter_CSV.SetScenario` **强制全开 20 个导出开关 + `IsExportExperimentEvaluation=true`**；<br>3) AiAssistant Bridge 走 `EnableCsvExport(dir, true)`，**不设 `b_IsSchemeRun`**，仅在 INI 已配置时或使用默认值（`Expenditures/Losses/WeaponLost` 因不在 INI 读写而默认 `true`；`IsExportExperimentEvaluation` 默认 `false` 则不生成 `Tick`/`Factors`/`Sensor*`/`Comm*`/`SideCreated`/`ComponentStatusChanged`！）。 | `EventExporterManager.cs:64-171`<br>`EventExporter_CSV.cs:101-124`<br>`CorePulseEngine.cs:200-375`<br>`MyConsoleApplication.cs:455-467` | 若后续服务经由 AiAssistant Bridge 启动推演，必须确认 `EventExportExtra.ini` 是否开启 `IsExportExperimentEvaluation`、`IsExportWeaponEndgameEvent` 等，否则默认不会落盘实验评估全套 CSV！ |
| **D7** | `CSVExporter` 直接被 pandas / SQL 工具标准读取 | 1) Raw CSV 头部恒写入 **双 UTF-8 BOM (`\xEF\xBB\xBF\xEF\xBB\xBF`)**，仅读 `utf-8-sig` 仍会残留第二个 `\ufeff` 在首列名 `TimelineID` 前；<br>2) `DBTablesDefine` 对 `UnitPositions`/`WeaponFired`/`Factors`/`FuelConsumed`/`FuelTransfer`/`UnitCreated` 等表**丢弃了 CSV 中的多列**，且存在 `UnguidedWeapon` 缺 `UnitSide`、MySQL `INSERT INTO UnitCreate` 拼写错、`WeaponEndgame` 裸连 `"-"` 导致 SQL 插入失败等缺陷；<br>3) `EventExporterManager.cs:852,889` 的 `OnComponentStatusChanged` 与 `OnCommJammedChanged` **未检查 `IsOperating`**。 | `EventExporter_CSV.cs:292-295`<br>`EventExporter_Sqlite.cs:269-290`<br>`EventExporter_MySql.cs:236`<br>`UnguidedWeapon.cs:1500-1521`<br>`EventExporterManager.cs:852-898` | **离线事件解析强烈建议只读 CSV（并剥除所有前导 `\ufeff`），禁用引擎内置 SQLite/MySQL 导出**（Bridge `SimulationContracts.cs:388` 已践行这一硬约束）。 |
| **D8** | 认为 Lua `KeyValue` 支持任意键名或内置全量单位列表 API | 1) CMO 使用 `XElement(key, value)` 写入 XML，`key` 含冒号 `:` 会直接抛异常，必须用 `.`（如 `lab.judge.version`）；<br>2) 沙箱无全局 `ScenEdit_GetUnits()`，需 `VP_GetSide({side=...}).units` 或事件触发器内 `ScenEdit_UnitX()`；<br>3) `ScenEdit_QueryDB` 只返回 `mount`/`sensor`/`weapon`，查平台类型返回 `null`；<br>4) AiAssistant Bridge 的 `LuaExecDiff` **刻意不捕获 KeyValue/Contacts/Postures**。 | `LuaSandBox.cs:2720-2870`<br>`CNT-04:55,73,79`<br>`PrivateMethods.cs:11606-11674`<br>`LuaExecDiff.cs:11` | 通过 Lua 埋点需恪守 `.` 命名；需从保存的 `.scen` 的 `<LuaXml><KeyValueDatastore>` 解析，或在 `template.execute` 显式返回。 |
| **D9** | 误以为 BS MQTT 发布端代码就在本仓库 `CMO-netcore-src/` 中 | 全仓检索 `FrameData_`、`victory_`、`ReceiveLog_`、`SaveScenarioXml_` 仅在前端/代理消费者 `integration/F1-BS/` 与 `demo-ui/proxy/` 命中，C# 引擎源码及 `F1_Console` 内**不存在 BS MQTT 发布逻辑**（由外部 Java/BS 服务侧发布）。 | `integration/F1-BS/src/workers/mqtt.worker.js`<br>`demo-ui/proxy/bs-listener.mjs` | 若需扩充 `FrameData_*` 字段，需对接外部 BS 后端或通过 WebSocket/Lua 旁路补采。 |

---

## 三、本目录文件索引

| 文件 | 用途 | 核心内容 |
|---|---|---|
| [`01-event-exporter-csv-db.md`](./01-event-exporter-csv-db.md) | **EventExporter 全表字典** | 全部 44 个 `ExportedEventType` 枚举逐一拆解（精确列名、C# 类型、DB 类型、单位、条件列、开关/节流门控、36 表 `DBTablesDefine` 差异与 SQL Bug、31 表外部扫描 vs 15 表仓内样本、四大联表配方与 `LabConsole` 兼容层）。 |
| [`02-bs-mqtt-frames-and-topics.md`](./02-bs-mqtt-frames-and-topics.md) | **BS MQTT 实时帧与主题字典** | 11 类 MQTT 主题与双 WebSocket 通道；Q-077 真实信封/BOM/字符串数字/`.NET Ticks` 规范；`Scenario` 完整 JSON 树（`Sides`、`ActiveUnits`、传感器/扇区/挂载/弹药/燃油、`NonActiveUnits`、`Contacts`、`Missions`、`Zones`、`SimEvents/Triggers/Conditions/Actions`）；`bs-diff` 衍生事件卡规范。 |
| [`03-bridge-tcp-lua-dis-tacview.md`](./03-bridge-tcp-lua-dis-tacview.md) | **Bridge / TCP / Lua / DIS / Tacview 与下游衍生表** | AiAssistant HTTP Bridge（`simulation.run/status`, `result.read`, `measurement.read`, `scenario.audit`）；TCP `DataOutputServer`（28 种 `MessageType` + `EventOutput`）与 `F1-Console` 参数/`%MSEND`；Lua 运行时 API 与 `<LuaXml>`；Tacview ACMI 2.1；DIS PDUs；`LabConsole` `metrics.py` 与跑批衍生表契约。 |
| [`schemas/f1-output-catalog.json`](./schemas/f1-output-catalog.json) | **机器可读总目录 JSON Schema** | 结构化索引全部通道、44 类导出事件字段与类型、BS MQTT 路径、Bridge 契约、DIS/Tacview/Lua 输出、跨表主键联接图 (`join_graph`) 与文档偏差 (`doc_discrepancies`)，可直接供 `eval-service` 代码加载或校验。 |
