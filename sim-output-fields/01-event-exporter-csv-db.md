# 01. EventExporter 事件/状态导出通道字段全集（CSV / XML / XLS / SQLite / MySQL）

> 依据源码：`CMO-netcore-src/Command_Core/IEventExporter.cs`、`EventExporterManager.cs`、`EventExporter_CSV.cs`、`EventExporter_XMLFile.cs`、`EventExporter_XLS.cs`、`EventExporter_Sqlite.cs`、`EventExporter_MySql.cs` 及各业务类 `Export*` 调用点。
> 实证对照：`LabConsole/content/csv-inventory-raw.json`（外部全量真机 31 表）、`LabConsole/outputs/` & `LabConsole/runs/`（仓内实测 15 类原始引擎 CSV）。

---

## 一、配置门控、文件名与通用前缀规则

### 1.1 四套开关优先级（极易踩坑）

1. **`F1Config\EventExportExtra.ini`**（`EventExporterManager` 静态构造 `EventExporterManager.cs:110-171` 读一次）：
   - `F1Config\EventExport.ini`（`Exporter_General.cs:87`）**未被使用**。
   - **重要**：仅当 `ClientCore.RunInCmdMode == true` 时才从 INI 读取通道总开关 `ExportXML` / `ExportXLS` / `ExportCSV` / `ExportTacview` / `ExportMySql` / `ExportSqlite` / `ExportTacviewRealtime`（`:131-139`）；其余字段在所有模式下均从 INI 读取。
   - 静态变量代码默认值 vs INI 缺省 fallback（`EventExporterManager.cs:64-87, 148-170`）：
     - 代码初始 `true`（INI fallback `false`）：`UnitPos`, `WeaponFired`, `UnitDestroyed`, `Damage` (`UnitDamaged`), `ContactPositions`, `AirOps`, `DockingOps`, `IsExportInterval`。
     - 代码初始 `true`（**未写入 INI 也未从 INI 读取，恒保持 `true`**）：`Expenditures`, `Losses`, `WeaponLost`。
     - 代码初始 `false`（INI fallback `false`）：`EngagementCycle`, `WeaponEndgame`, `SensorDetectionAttempt`, `PointDefenceAndDECM`, `WeaponImpact`, `Explosion`, `FuelTransfer`, `FuelConsumed`, `IsExportTimeSpan`, `IsExportExperimentEvaluation`。
     - `ExportInterval`：默认 `0` 秒（负值钳位到 `0`）；`IsCSVExportSameFile`：默认 `true`。
2. **CLI 试验设计模式（`F1_Console.exe -M 1`，即 `GameGeneral.b_IsSchemeRun == true`）**：
   - `MyConsoleApplication.cs:455-508, 661-673` 解析 `-M`, `-SCHEMENAME`, `-SCHEMERUNTIMES`, `-S <LuaScript.lua>`（并自动派生 `SchemaFangAnName` 与 `Weapon.json` 路径）。
   - `EventExporter_CSV.SetScenario()`（`EventExporter_CSV.cs:101-130`）在 `b_IsSchemeRun == true` 时**无视 INI，将 20 个导出标志全部强制置为 `true`**，并将 `IsExportTimeSpan = true`、`IsExportExperimentEvaluation = true`。
3. **AiAssistant Bridge 模式（`CorePulseEngine.PrepareJobHost` -> `EventExporterManager.EnableCsvExport(isolateExportDir, true)`）**：
   - `b_IsSchemeRun` 为 `false`，禁用 SQLite，保留 `IsExportExperimentEvaluation` 等为 `EventExportExtra.ini` 中的配置值；**若现场 INI 未打开对应开关，Bridge 单局默认不会输出 `WeaponEndgame`、`EngagementCycle`、`Tick`、`Factors`、`Sensor*`、`Comm*` 等表**。
4. **节流规则（`EventExporterManager.ShouldExportEvent` `:2125-2150`）**：
   - 仅当 `IsExportInterval == true` 时，对且仅对 **`UnitPositions`、`ContactPositions`、`FuelConsumed`** 3 个事件做秒级节流：要求 `theScen.SecondIsChangingOnThisPulse == true` 且 `(theScen.Time - LastEventTime).TotalSeconds >= ExportInterval`（随后更新共享静态 `LastEventTime` 并只在等于 `0` 的当前脉冲放行）。其余 39 个事件不受 `ExportInterval` 节流。

### 1.2 文件命名、双 BOM 与序列化差异

| 维度 | CSV (`EventExporter_CSV.cs`) | XML (`EventExporter_XMLFile.cs`) / XLS (`EventExporter_XLS.cs`) | SQLite / MySQL (`EventExporter_{Sqlite,MySql}.cs`) |
|---|---|---|---|
| **输出目录** | `{FileExportFolder}\EventExport_CSV`（若 `b_IsSchemeRun`：`{Parent}\EventExport_CSV\{SchemaName}\{SchemaFangAnName}\{SchemaCurrentTimes}`） | `{ExportDir}` 下独立文件 | SQLite 库文件 / MySQL `CMOExport` |
| **文件名/表名来源** | `result.EventType.ToString() + ".csv"`（`:208`） | `EventTypeToStr(result.EventType)`（`:1979-1984` 两者当前等价，均返回 `"UnitDamaged"`） | `DBTablesDefine`（36 张表，键为 `EventTypeToStr`） |
| **阵营拆文件** | 若 `SplitFilesBySide`：`{FileNamePrefix}_{sideName}_{EventType}.csv`；否则 `{FileNamePrefix}_{EventType}.csv`（`:208-213`），`FileNamePrefix` 为启动时 `YYYY-M-D_H.m.s` | 不按阵营拆表 | 不按阵营拆表 |
| **编码/BOM 实况** | **`WriteCSVHeader` (`:292-295`) 用 `new UTF8Encoding(true)` 又显式写入 `'\uFEFF'` -> 恒为双 UTF-8 BOM `\xEF\xBB\xBF\xEF\xBB\xBF`（仓内 15 类实测 CSV 已逐一字节验证 `boms=2`）**；后续追加行用 `File.AppendText` | 标准 XML / Excel（XLS 每次重写全表） | SQL INSERT 批处理（MySQL 最大 500/批，SQLite 1000/批） |
| **字段裁剪** | **原样输出 `EventParameters` 全部键**（按插入顺序） | 原样输出全部键 | **仅保留 `DBTablesDefine[tbName]` 中声明的列**（额外列如 `Scenario`、`MC_Run` 等全部丢弃） |

### 1.3 `MakeParasDict` 公共前缀字段（`EventExporterManager.cs:1513-1546`）

除 **`SimInfo`**（手动建表）和 **`Factors`**（调用 `MakeParasDict(..., addTimeCol: false)` 故意省略 `Time`）外，其余活跃事件默认包含以下前缀：

| 字段名 | C# `DataType` (`MaxStringLength`) | 条件 | 取值与格式说明 | SQLite/MySQL (`DBTablesDefine`) |
|---|---|---|---|---|
| `Scenario` | `typeof(string)` (`500`) | 仅 `theScen.MonteCarloIteration > 0` | `theScen.Title` | **丢弃（全 36 张 DB 表均未声明）** |
| `MC_Run` | `typeof(int)` (`0`) | 仅 `theScen.MonteCarloIteration > 0` | `theScen.MonteCarloIteration` | **丢弃（全 36 张 DB 表均未声明）** |
| `TimelineID` | `typeof(string)` (`40`) | 必选 | `theScen.TimelineID`（GUID / Bridge `runId`） | `string`（全 36 表均含） |
| `Time` | `typeof(TimeSpan)` (`0`/`30`) 或 `typeof(DateTime)` | `addTimeCol == true` | `UseZeroHour == true` 时：`theScen.Time.Subtract(theScen.ZeroHour).ToString("c")`（形如 `[d.]hh:mm:ss[.fffffff]`）；`false` 时：`theScen.Time.ToString("MM/dd/yyyy HH:mm:ss") + "." + Millisecond.ToString("D3")` | `string`（除 `Factors` 外 35 表均含；`EventExporterManager.cs:521` 将 `Factors.Time` 注释） |

---

## 二、44 个 `ExportedEventType` 全量总表（代码实况 × 实盘对照）

状态标记说明：
- **活跃**：源码存在真实调用点。
- **死枚举（0 调用）**：枚举存在（或有开关），全仓无 `ExportEvent` 调用点。
- `DB`：是否在 `DBTablesDefine`（36 张）中；`Tacview`：`IsTacviewExportEvent` / 实际写入行为；`全量31`：见 `csv-inventory-raw.json`；`仓内15`：在 `LabConsole/outputs` + `LabConsole/runs` 存在真实带双 BOM 引擎 CSV。

| Enum ID | EventType 名称 | 状态 | 主叫门控开关 | 节流 | DB (36) | Tacview | 全量 (31) | 仓内 (15) | 字段数 (常规 / MC) |
|---|---|---|---|---|---|---|---|---|---|
| 0 | `None` | 占位枚举 | — | — | ✗ | ✗ | ✗ | ✗ | 0 |
| 1 | `WeaponFired` | 活跃 | `ExportWeaponFired` (默true/INI:false) | ✗ | ✓ (31列) | ✓ | ✓ (33) | ✓ (33) | 33 / 35 |
| 2 | `WeaponEndgame` | 活跃 | `ExportWeaponEndgame` (默false) | ✗ | ✓ (17列) | ✓ | ✓ (17) | ✓ (17) | 17 / 19 |
| 3 | `FuelConsumed` | 活跃 | `IsExportFuelConsumedEvent` + `ExportFuelConsumed` (默false) | **✓** | ✓ (6列) | ✗ | ✓ (9) | ✗ | 9 / 11 |
| 4 | `UnitDestroyed` | 活跃 | `ExportUnitDestroyed` (默true/INI:false) | ✗ | ✓ (9列) | ✓ | ✓ (9) | ✓ (9) | 9 (Unguided 8) / +2 |
| 5 | `SensorDetectionAttempt` | **死枚举 (0调用)** | `IsExportSensorDetectionAttemptEvent` -> `ExportSensorDetectionFailure` | — | ✗ | ✗ | ✗ | ✗ | 0 (CSV switch 有死键 `SensorParentSide`) |
| 6 | `PointDefenceAndDECM` | **死枚举 (0调用)** | `IsExportPointDefenceAndDECMEvent` -> `ExportSensorDetectionSuccess` | — | ✗ | ✗ | ✗ | ✗ | 0 |
| 7 | `UnitPositions` | 活跃 | `ExportUnitPositions` (默true/INI:false) | **✓** | ✓ (10列) | ✓ | ✓ (15) | ✓ (15) | 15 (全开关+8) / +2 |
| 8 | `EngagementCycle` | 活跃 | `ExportEngagementCycle` (默false; Side.cs 缺 `IsOperating`) | ✗ | ✓ (19列) | 选择性 | ✓ (19) | ✗ | 19 / 21 |
| 9 | `FuelTransfer` | 活跃 | `IsExportFuelTransferEvent` + `ExportFuelTransfer` (默false) | ✗ | ✓ (7列) | ✗ | ✗ | ✗ | 13 / 15 |
| 10 | `WeaponImpact` | 活跃 | **检查 `ExportExplosions` (非 `ExportWeaponImpacts`!)** | ✗ | ✓ (8列) | ✓ | ✓ (8) | ✓ (8) | 8 / 10 |
| 11 | `Explosion` | 活跃 | `ExportExplosions` | ✗ | **✗ (漏配)** | ✓ | ✓ (8) | ✓ (8) | 8 / 10 |
| 12 | `AirOps` | 活跃 | `ExportAirOps` (默true/INI:false) | ✗ | ✓ (19列) | ✓ (`Landing`消隐) | ✗ | ✗ | 19 / 21 |
| 13 | `DockingOps` | 活跃 | `ExportDockingOps` (默true/INI:false) | ✗ | ✓ (16列) | ✓ (`Docking`消隐) | ✗ | ✗ | 16 / 18 |
| 14 | `WaterSplash` | **死枚举 (0调用)** | — | — | ✗ | ✗ | ✗ | ✗ | 0 |
| 15 | `ContactPositions` | 活跃 | `ExportContactPositions` (或非 GodsEye Realtime/Pipe) | **✓** | ✓ (15列) | ✓ | ✓ (15) | ✗ | 15 / 17 |
| 16 | `SimExecution` | **死枚举 (0调用)** | — | — | ✗ | ✗ | ✗ | ✗ | 0 |
| 17 | `UnitDamaged` | 活跃 | `ExportUnitDamaged` (默true/INI:false) | ✗ | ✓ (13列) | 转为 `UnitPositions` | ✓ (13) | ✓ (13) | 13 / 15 |
| 18 | `CargoTransfer` | **死枚举 (0调用)** | `ExportCargoTransfer` | — | ✗ | ✗ | ✗ | ✗ | 0 |
| 19 | `Max` | 占位枚举 | — | — | ✗ | ✗ | ✗ | ✗ | 0 |
| 20 | `SimInfo` | 活跃 | `IsOperating && !IsBaseInfoExported` | ✗ | ✓ (6列) | ✗ | ✓ (6) | ✓ (6) | 6 (无 MC 前缀) |
| 21 | `UnitCreated` | 活跃 | `IsOperating` (初始/新增单位) | ✗ | ✓ (12列) | ✗ | ✓ (12) | ✓ (12) | 12 / 14 |
| 22 | `Expenditures` | 活跃 | `ExportExpenditures` (恒默true) | ✗ | ✓ (6列) | ✗ | ✓ (6) | ✓ (6) | 6 / 8 |
| 23 | `Losses` | 活跃 | `ExportLosses` (恒默true) | ✗ | ✓ (8列) | ✗ | ✓ (8) | ✓ (8) | 8 / 10 |
| 24 | `WeaponLost` | 活跃 | `ExportWeaponLost` (恒默true) | ✗ | ✓ (6列) | ✗ | ✓ (6) | ✓ (6) | 6 / 8 |
| 25 | `MissionChanged` | 活跃 | `IsOperating` | ✗ | ✓ (13列) | ✗ | ✓ (13) | ✓ (13) | 13 / 15 |
| 26 | `MissionUnitRelationChanged` | 活跃 | `IsOperating` | ✗ | ✓ (5列) | ✗ | ✓ (5) | ✓ (5) | 5 / 7 |
| 27 | `MissionRefPointRelationChanged` | 活跃 | `IsOperating` | ✗ | ✓ (6列) | ✗ | ✓ (6) | ✓ (6) | 6 / 8 |
| 28 | `Factors` | 活跃 | `IsExportExperimentEvaluation` | ✗ | ✓ (9列) | ✗ | ✓ (11) | ✗ | 11 / 13 (无 `Time`) |
| 29 | `DetectionIdentificationChanged` | 活跃 | `ExportStatusIDChange && IsExportExperimentEvaluation` | ✗ | ✓ (17列) | ✗ | ✓ (17) | ✗ | 17 / 19 |
| 30 | `GroupUnitRelationChanged` | 活跃 | `IsExportExperimentEvaluation` + 初始/新Group | ✗ | ✓ (4列) | ✗ | ✗ | ✗ | 4 / 6 |
| 31 | `UnitJammed` | 活跃 | `SecondIsChangingOnThisPulse && IsExportExperimentEvaluation` | ✗ | ✓ (4列) | ✗ | ✗ | ✗ | 4 / 6 |
| 32 | `SensorCreated` | 活跃 | `IsExportExperimentEvaluation` (非Group单位) | ✗ | ✓ (25列) | ✗ | ✓ (25) | ✗ | 25 / 27 |
| 33 | `SensorClassUsed` | 活跃 | `IsExportExperimentEvaluation` (按DBID去重) | ✗ | ✓ (10列) | ✗ | ✓ (10) | ✗ | 10 / 12 |
| 34 | `CommCreated` | 活跃 | `IsExportExperimentEvaluation` (非Group单位) | ✗ | ✓ (8列) | ✗ | ✓ (8) | ✗ | 8 / 10 |
| 35 | `CommClassUsed` | 活跃 | `IsExportExperimentEvaluation` (按DBID去重) | ✗ | ✓ (16列) | ✗ | ✓ (16) | ✗ | 16 / 18 |
| 36 | `WeaponRecordCreated` | 活跃 | `IsExportExperimentEvaluation` (挂载/弹库) | ✗ | ✓ (8列) | ✗ | ✓ (8) | ✗ | 8 / 10 |
| 37 | `ComponentStatusChanged` | 活跃 | 仅订阅检查 `IsExportExperimentEvaluation`（※回调未判 `IsOperating`） | ✗ | ✓ (9列) | ✗ | ✓ (9) | ✗ | 9 / 11 |
| 38 | `CommIsJammedChanged` | 活跃 | 仅订阅检查 `IsExportExperimentEvaluation`（※回调未判 `IsOperating`） | ✗ | ✓ (5列) | ✗ | ✗ | ✗ | 5 / 7 |
| 39 | `LandUnitCreated` | 活跃 | `IsExportExperimentEvaluation` + 设施/地面机动单位 | ✗ | ✓ (5列) | ✗ | ✓ (5) | ✗ | 5 / 7 |
| 40 | `Tick` | 活跃 | `SecondIsChangingOnThisPulse && IsExportExperimentEvaluation` | ✗ | ✓ (2列) | ✗ | ✓ (2) | ✗ | 2 / 4 |
| 41 | `SideCreated` | 活跃 | `IsExportExperimentEvaluation` | ✗ | ✓ (4列) | ✗ | ✓ (4) | ✗ | 4 / 6 |
| 42 | `ContactCreated` | 活跃 | 初始导出受 `IsExportExperimentEvaluation`；`Side.ContactAdded2` 订阅后检查 `IsOperating` | ✗ | ✓ (7列) | ✗ | ✓ (7) | ✗ | 7 / 9 |
| 43 | `FirstSensorToUnitRecordCreated` | 活跃 | `IsExportExperimentEvaluation` (按 `(SensorID, TargetID)` 去重) | ✗ | ✓ (5列) | ✗ | ✓ (5) | ✗ | 5 / 7 |
| *(注释)* | `SensorStatusChanged` | **未定义/已注释** | `EventExporterManager.cs:872-881` | — | ✗ | ✗ | ✗ | ✗ | 拟定 `SensorID, SensorName, SensorIsActive, PlatformID, PlatformName` |

---

## 三、逐表详细字段规格（按业务域分组）

*(除 `SimInfo` 和 `Factors` 外，每张表最前面均隐含共享前缀：`[Scenario, MC_Run,] TimelineID, Time`。下面仅列出各表**特有业务字段**，并标注共享前缀例外及 SQLite/MySQL 差异。)*

### A. 仿真元信息、阵营与试验因子（4 表）

#### 1. `SimInfo`（`EventExporterManager.cs:969-976`, `DBTablesDefine:225-232`）
- **无 `Scenario`/`MC_Run` 前缀**（手动构造字典）；`Time` 固定为 `StartTime.ToString("MM/dd/yyyy HH:mm:ss")` (`typeof(string)`).
- 触发：`ExportBaseInfo()` 单局初始一次（SQLite 复用旧库且同想定除外）。

| 字段名 | C# 类型 | DB 类型 | 来源表达式 / 单位 |
|---|---|---|---|
| `TimelineID` | `string` | `string` | `CurrentScn.TimelineID` |
| `Time` | `string` | `string` | `CurrentScn.StartTime` (`MM/dd/yyyy HH:mm:ss`) |
| `MonteCarloID` | `string` | `string` | `EventExporterManager.MonteCarloID` |
| `MonteCarloIteration` | `int` | `int` | `EventExporterManager.MonteCarloIteration` |
| `ScnName` | `string` | `string` | `CurrentScn.Title.Replace('\'', '"')` |
| `ReferenceTime` | `string` | `string` | `CurrentScn.ZeroHour` (`MM/dd/yyyy HH:mm:ss`) |

#### 2. `Factors`（`EventExporterManager.cs:810-846`, `DBTablesDefine:519-531`）
- **调用 `MakeParasDict(eventExporter, 10, false)` — 无 `Time` 列！**

| 字段名 | C# 类型 | DB 类型 | 来源表达式 / 说明 |
|---|---|---|---|
| `ScenarioFileName` | `string` | `string` | `CurrentScn.FileName` |
| `ScenarioFilePath` | `string` | `string` | `Path.GetDirectoryName(GameGeneral.SchemeScenarioFullName)` |
| `CurrentDataSet` | `string` | `string` | `GameGeneral.SchemaName`（空时 `"UnnamedDataset"`） |
| `CurrentSchemeName` | `string` | `string` | `GameGeneral.SchemaFangAnName`（空时 `"UnnamedScenario"`） |
| `CurrentSchemeTimes` | `string` (传int) | **`int`** | `GameGeneral.SchemaCurrentTimes` |
| `CurrentXmlContent` | `string` | `string` | `<SchemeFangAnName>.xml` 全文（源自 `WeaponFile.Replace("Weapon.json", SchemaFangAnName + ".xml")`） |
| `CurrentJsonContent` | `string` | `string` | `GameGeneral.WeaponFile` (`Weapon.json`) 全文 |
| `CurrentTxtContent` | `string` | **✗ DB 丢弃** | `<SchemeDir>\<SchemaName>.txt` 全文 |
| `CurrentDetailsTxtContent` | `string` | **✗ DB 丢弃** | `<SchemeDir>\<SchemaFangAnName>\<SchemaFangAnName>.txt` 全文 |
| `CurrentDatabase` | `string` | `string` | `ClientCore.CurrentDB.FileName.Replace("自定义版-", "")` |

#### 3. `SideCreated`（`EventExporterManager.cs:1371-1384`, `DBTablesDefine:688-694`）
- **字段**：`SideName` (`string` -> `side.Name`), `SideID` (`string(40)` -> `side.ObjectID`)。

#### 4. `Tick`（`EventExporterManager.cs:2048-2060`, `DBTablesDefine:682-686`）
- **特有字段**：无，仅 `[Scenario, MC_Run,] TimelineID, Time`。每秒推演推进时输出（`SecondIsChangingOnThisPulse && oldState != null && IsExportExperimentEvaluation`）。

---

### B. 单位创建、位置快照与编组/陆战补充（4 表）

#### 5. `UnitCreated`（`EventExporterManager.cs:1271-1359`, `DBTablesDefine:234-247`）
- 初始加载 + 推演中新增单位（包含在飞制导武器，但部分非活动武器不出现）。`SplitFilesBySide` 键：`UnitSide`。
- **Known Bug**: `EventExporter_MySql.cs:236` 拼写错为 `INSERT INTO UnitCreate`。

| 字段名 | C# 类型 (MaxLen) | DB 类型 | 说明 / 单位 |
|---|---|---|---|
| `UnitID` | `string(40)` | `string` | `ObjectID` |
| `UnitDBID` | `string(10)` | `string` | `DBID`（DB3K 主键） |
| `UnitName` | `string(500)` | `string` | `Name` |
| `UnitType` | `string(20)` | `string` | `UnitType_String`（如 `飞机`/`舰船`/`设施`/`导弹` 或英文枚举） |
| `UnitClass` | `string(500)` | `string` | `UnitClass`（null 转 `""`） |
| `UnitSide` | `string(500)` | `string` | `GetUnitSide().Name` |
| `UnitLongitude` | `double` | `double` | 经度（deg） |
| `UnitLatitude` | `double` | `double` | 纬度（deg） |
| `UnitCourse` | `float` | `float` | 航向 `CurrentHeading`（deg） |
| `UnitAltitude_m` | `float` | `float` | 海拔高 `GetCurrentAltitude()`（m） |

#### 6. `UnitPositions`（`ActiveUnit_Kinematics.cs:2720-2814`, `UnguidedWeapon.cs:2825-2872`, `DBTablesDefine:249-260`）
- 节流：`ShouldExportEvent` 当 `IsExportInterval == true`；另需 `LocationExportPossibleThisTick == true`（或 `ForceUpdate`）。`SplitFilesBySide` 键：`UnitSide`。
- **Notice**: `UnguidedWeapon` 在 `GetUnitSide() == null` 且 `LocationExportPossibleThisTick` 为 false 时存在 NRE Bug（`:2837,2860`）。

| 字段名 | C# 类型 (MaxLen) | DB 类型 | 来源 / 单位 |
|---|---|---|---|
| `UnitID` | `string(40)` | `string` | `ObjectID` |
| `UnitDBID` | `string(10)` | **✗ DB 丢弃** | `DBID` / `_DBID` |
| `UnitName` | `string(500)` | **✗ DB 丢弃** | `Name` |
| `UnitType` | `string(20)` | **✗ DB 丢弃** | `UnitType_String` |
| `UnitClass` | `string(500)` | **✗ DB 丢弃** | `UnitClass` |
| `UnitSide` | `string(500)` | **✗ DB 丢弃** | `GetUnitSide().Name` |
| `UnitLongitude` | `double` | `double` | 经度（deg） |
| `UnitLatitude` | `double` | `double` | 纬度（deg） |
| `UnitCourse` | `float` | `float` | 航向 `CurrentHeading`（deg） |
| `UnitSpeed_kts` | `float` | `float` | 航速 `CurrentSpeed`（节 knots） |
| `UnitAltitude_m` | `float` | `float` | 海拔高度（m） |
| `UnitAttitude_Pitch` | `float` | `float` | 俯仰角（Aircraft/Missile/Torpedo 用 `Attitude_Pitch_Derived()`） |
| `UnitAttitude_Roll` | `float` | `float` | 横滚角 `Attitude_Roll`（deg） |
| *(条件)* `Status`, `Condition_AirOps`, `Condition_DockingOps`, `AssignedMission` | `string(100)` | ✗ | 仅当 `UsesUnitMissionAndStatus == true`（目前所有具体导出器均为 `false`） |
| *(条件)* `DamagePercent` (`float`), `Fire` (`string`), `Flood` (`string`), `ComponentStatus` (`string(4000)`) | — | ✗ | 仅当 `UsesUnitDamage == true`（目前均为 `false`）；`ComponentStatus` 单故障组件尾部多一个 `|`（`:2807`） |

#### 7. `LandUnitCreated`（`EventExporterManager.cs:1251-1269`, `DBTablesDefine:673-680`）
- 触发：`unit.IsFacility || unit.IsMobileGroundUnit` 且 `IsExportExperimentEvaluation`。
- 字段：`UnitID` (`string`), `UnitName` (`string`), `MobileUnitCategory` (`string` -> `IMobileGroundUnit._MobileUnitCategory`)。

#### 8. `GroupUnitRelationChanged`（`EventExporterManager.cs:1314-1327`, `DBTablesDefine:553-558`）
- 触发：`ActiveUnit_val.IsGroup` 且 `IsExportExperimentEvaluation`。
- 字段：`GroupUnitID` (`string(40)`), `ChildUnitID` (`string(40)`).

---

### C. 武器发射、交战周期、终局、爆炸与损伤销毁（7 表）

#### 9. `WeaponFired`（`ActiveUnit_Weaponry.cs:11692-11794`, `DBTablesDefine:262-294`）
- `theTarget == null` 时提前退出。`SplitFilesBySide` 键：`FiringUnitSide`。实测 `WeaponName` 常带实例后缀（如 `"CH-AA-10 Abaddon [PL-15] #3"`），聚合型号需剥除 `\s+#\d+$`。

| 字段名 | C# 类型 (MaxLen) | DB 类型 | 说明 / 单位 |
|---|---|---|---|
| `FiringUnitID` / `DBID` / `Name` / `Type` / `Class` / `Side` | `string(40/10/500/20/500/500)` | `string` | 发射平台信息 |
| `FiringUnitLongitude` / `Latitude` | `double` | `double` | 经纬度（deg） |
| `FiringUnitCourse` | **`double`** | **`float`** | 发射时平台航向（deg） |
| `FiringUnitSpeed_kts` / `Altitude_m` / `AGL_m` | `float` | `float` | 节 / 海拔 m / 真高 m |
| `WeaponID` / `DBID` / `Name` / `Type` / `Class` | `string(40/10/500/200/500)` | `string` | 弹药实例（`WeaponType` 经 `Misc.ToEnglishString`） |
| `TargetContactID` | `string(40)` | `string` | 目标接触 ID |
| `TargetContactLongitude` / `Latitude` | `double` | `double` | 接触经纬度 |
| `TargetContactHeading` / `Speed` / `Altitude` | `float` (值可为 `""`) | `float` | 若 `Heading/Speed/AltitudeIsKnown` 为 false 则传空串 `""` |
| `TargetContactRangeHoriz_nm` / `Slant_nm` | `float` | `float` | 水平/斜距（海里 nm） |
| `TargetContactActualUnitID` / `Name` / `Class` / `Side` | `string(40/500/500/500)` | `string` | `ActualUnit == null` 时 ID/Class/Side 填 `"-"`，Name 填 `theTarget.Name` |
| `SalvoID` | `string` | **✗ DB 丢弃** | `theSalvo == null ? "" : theSalvo.ObjectID` |
| `CountermeasuresRemaining` | `string` | **✗ DB 丢弃** | 当 `theTarget.IsWeaponContact` 时为 `"<数量>x <WeaponDBID>\|..."`，否则 `""` |

#### 10. `WeaponEndgame`（3 个调用点：`ActiveUnit_Weaponry.cs:7841`, `UnguidedWeapon.cs:2721`, `Weapon.cs:10130`; `DBTablesDefine:296-314`）
- `SplitFilesBySide` 键：`WeaponSide`。同一 `WeaponID` 可产生多条记录（如先点防御 `POINTDEF:FAILURE` 后接末端 `KILL`/`MISS`），统计终局应按同 `Time` 末条。

| 字段名 | C# 类型 (MaxLen) | DB 类型 | 3 个调用点差异与注意点 |
|---|---|---|---|
| `WeaponID` / `Name` / `Side` | `string(40/500/500)` | `string` | 武器实例 |
| `ParentFiringUnitID` / `Name` | `string(40/500)` | `string` | `FiringParent == null` 时 `"-"` |
| `TargetID` / `Name` / `Side` | `string(40/500/500)` | `string` | `ActiveUnit_Weaponry`: null 时填 `"-"`; `Weapon.cs`: 填 `""` |
| `TargetLongitude` / `Latitude` / `Altitude_ASL_m` / `Altitude_AGL_m` | `double` / `float` | `double` / `float` | **DB Bug**：`ActiveUnit_Weaponry` 目标为空时写 `"-"`，SQL 插数值列语法报错 |
| `DistanceFromFiringUnit_Horiz` | `float` | `float` | 海里（`FiringParent == null` 时 `""`） |
| `Result` | `string(20/10)` | `string` | `ActiveUnit_Weaponry`: `UNDEFINED` / `POINTDEF:SUCCESS` / `POINTDEF:FAILURE`；`Weapon`/`UnguidedWeapon`: `KILL` / `HIT` / `MISS` |
| `EndgameMessage` | `string` | `string` | 点防消息 (`\|` 拼接) 或交战详情文本 |

#### 11. `EngagementCycle`（4 个调用点：`ActiveUnit_AI.cs:10290`, `ActiveUnit_Sensory.cs:5357`, `Contact.cs:3593`, `Side.cs:5447`; `DBTablesDefine:344-364`）
- **注意**：`Side.cs:5405` 仅判断 `ExportEngagementCycle` 而未判 `IsOperating`。`SplitFilesBySide` 键：`UnitSide`。

| 字段名 | C# 类型 (MaxLen) | DB 类型 | 说明 |
|---|---|---|---|
| `UnitID` / `Name` / `Class` / `Side` | `string(40/500/500/500)` | `string` | 观察/射手单元 |
| `CycleAction` | `string(200)` | `string` | 如 `"New contact"`、`"Contact ID status changed: ..."`、`"Assign Weapon Salvo"`、`"Dropping contact"` 等 |
| `ContactID` / `Name` | `string(40/500)` | `string` | 接触实体 |
| `ContactLongitude` / `Latitude` | `double` | `double` | `ActiveUnit_AI`/`Contact` 先 `.ToString()` |
| `ContactRangeHoriz_nm` / `Slant_nm` | `float` | `float` | 观察者为空时在 AI/Contact 传 `""`，在 Sensory 传 `0.0` |
| `ContactActualUnitID` / `Name` / `Class` / `Side` | `string(40/500/500/500)` | `string` | 接触对应真实单位（若无则 `""`） |
| `SalvoID` | `string` | `string` | 仅 `Side.cs` 赋值 `weaponSalvo.ObjectID`，其余为空串 |
| `MiscInfo` | `string` | `string` | `Side.cs` 为 `"Weapons assigned: <qty>x <Name> [DBID: <DBID>]"` |

#### 12. `WeaponImpact`（`WeaponImpact.cs:171-200`, `Scenario.cs:6887`, `DBTablesDefine:426-435`）
- **门控 Bug**：检查 `applicableEventExporter.ExportExplosions`（并非 `ExportWeaponImpacts`）。
- 字段（8 列）：`UnitID` (`string(40)`), `UnitLongitude` (`double`), `UnitLatitude` (`double`), `UnitCourse` (`float`), `UnitSpeed_kts` (`float`), `UnitAltitude_m` (`float`)。（无 Side 列，`SplitFilesBySide` 归空前缀）

#### 13. `Explosion`（`Explosion.cs:1952-1981`, `Scenario.cs:6895`, **不在 `DBTablesDefine`**）
- 门控：`ExportExplosions`（`Tacview2x` 及子类 getter 恒为 `true`）。SQLite/MySQL 静默跳过！
- 字段（8 列）：`ExplosionID` (`string(40)`), `ExplosionType` (`int` 实为 `(int)theExpl.WarheadType`), `Longitude` (`double`), `Latitude` (`double`), `Altitude` (`float`), `EventType` (`string(40)` 固定 `"Explosion"`).

#### 14. `UnitDamaged`（`Scenario.cs:4987-5043`, `DBTablesDefine:316-330`）
- 枚举 ID = 17。CSV 文件名固定为 `*UnitDamaged.csv`（**不是 `Damage.csv`**）。`SplitFilesBySide` 键：`UnitSide`。

| 字段名 | C# 类型 (MaxLen) | DB 类型 | 说明 |
|---|---|---|---|
| `UnitID` / `UnitName` / `UnitClass` / `UnitSide` | `string(40/500/500/500)` | `string` | 受创单位 |
| `Longitude` / `Latitude` | `double` | `double` | 经纬度 |
| `DamagePercent` | `string(10)` | `string` | `DamagePercent.ToString("F6")`（ActiveUnit），否则 `"0"` |
| `Fire` / `Flooding` | `string` | `string` | 火灾/进水等级枚举串，无则 `"-"` |
| `Reason` / `Cause` | `string` | `string` | 毁伤原因与致伤武器/来源 |

#### 15. `UnitDestroyed`（2 个调用点：`Scenario.cs:5045-5080`, `UnguidedWeapon.cs:1485-1524`, `DBTablesDefine:332-342`）
- `SplitFilesBySide` 键：`UnitSide`。
- 字段：`UnitID` (`string(40)`), `UnitName` (`string(500)`), `UnitClass` (`string(500)`), `UnitSide` (`string(500)`), `MiscInfo` (`string`), `Reason` (`string`), `Cause` (`string` 默认 `"-"`).
- **Bug**：`UnguidedWeapon.cs:1500-1521` 调用点**漏掉 `UnitSide` 键**，导致 SQLite/MySQL INSERT 参数列数不匹配（8 值插 9 列报错）。

---

### D. 战损与弹药统计 AAR（3 表）

#### 16. `Expenditures`（`Side.cs:62-95`, `DBTablesDefine:455-462`）
- 字段：`DBID` (`int` -> DB `string`), `WeaponName` (`typeof(int)` [源码标注错，实存字符串] -> DB `string`), `Side` (`string` -> `OwnSide.Name`), `Num` (`int` -> DB `int`).

#### 17. `WeaponLost`（`Side.cs:97-137`, `DBTablesDefine:477-484`）
- 同 `Expenditures`（非交战武器损耗，如故障/燃料耗尽坠毁），6 列字段完全一致。

#### 18. `Losses`（`Side.cs:138-187`, `DBTablesDefine:464-473`）
- 字段：`SubjectID` (`string`), `DBID` (`string` <- `keyArray[1]`), `SubjectName` (`string`), `Side` (`string`), `Type` (`string` <- `keyArray[0]`, 如 `Aircraft`), `Class` (`string`).

---

### E. 探测、接触、识别与电子干扰（5 表）

#### 19. `ContactCreated`（`EventExporterManager.cs:901-933`, `DBTablesDefine:696-705`）
- 字段：`ContactID` (`string`), `ContactName` (`string`), `ActualUnitID` (`string`, `contact.ActualUnit?.ObjectID`), `ActualUnitName` (`string`), `Side` (`string` 观测方)。

#### 20. `ContactPositions`（`ActiveUnit_Sensory.cs:2655-2732`, `DBTablesDefine:437-453`）
- 节流（`IsExportInterval`）。`SplitFilesBySide` 键：`ObserverSide`。
- 字段：`ContactID` (`string(40)`), `UnitDBID` (`string(10)` -> `ActualUnit.DBID`), `ContactName` (`string(500)`), `UnitType` (`string(20)`), `UnitClass` (`string(500)`), `ObserverSide` (`string(500)`), `ContactLongitude` (`double`), `ContactLatitude` (`double`), `ContactCourse` (`float`, 未知时 `""`), `ContactSpeed_kts` (`float`, 未知时 `""`), `ContactAltitude_m` (`float`, 未知时 `""`), `UnitAttitude_Pitch` (`float`), `UnitAttitude_Roll` (`float`).

#### 21. `DetectionIdentificationChanged`（`Contact.cs:3425-3504`, `DBTablesDefine:533-551`）
- 门控：`ExportStatusIDChange && IsExportExperimentEvaluation`。
- 字段：`ContactID` (`40`), `ContactName` (`500`), `IdentificationStatus` (`50`), `SensorName` (`50`), `SensorID` (`50`), `SensorDBID` (`50`), `SensorType` (`50`), `SensorRole` (`50`), `SensorPlatformName` (`50`), `SensorPlatformID` (`50`), `HasUncertaintyArea` (`10`), `UncertaintyArea` (`string(10)` -> DB **`float`**), `ContactRangeHoriz_nm` (`float`), `ContactRangeSlant_nm` (`float`), `EstimatedDistance` (`float`, 无时 `0`).

#### 22. `FirstSensorToUnitRecordCreated`（`ActiveUnit_Sensory.cs:2906-2956`, `DBTablesDefine:707-714`）
- 仅首次 `(Sensor.ObjectID, DetectedUnit.ObjectID)` 捕获时导出（`IsExportExperimentEvaluation`）。
- 字段：`SensorID` (`string(50)`), `TargetID` (`string(50)`), `Distance` (`float` -> DB `double`).

#### 23. `UnitJammed`（`EventExporterManager.cs:1987-2046`, `DBTablesDefine:560-565`）
- 仅在受干扰状态跃变时导出（`IsExportExperimentEvaluation`）。
- 字段：`UnitID` (`string(40)`), `Status` (`string(20)` -> `"jammed"` / `"unjammed"`).

---

### F. 传感器、通信设备、武器库存与组件状态（7 表）

#### 24. `SensorCreated`（`EventExporterManager.cs:1161-1198`, `DBTablesDefine:567-584`）
- 字段：`UnitID`, `UnitName`, `SensorID`, `SensorName`, `SensorDBID`, `SensorStatus`, `SensorIsActive`, 以及 16 个扇区布尔字符串 `PS1, PMA1, PMF1, PB1, SS1, SMA1, SMF1, SB1, PS2, PMA2, PMF2, PB2, SS2, SMA2, SMF2, SB2`（全部 `string`）。

#### 25. `SensorClassUsed`（`EventExporterManager.cs:1143-1159`, `DBTablesDefine:586-598`）
- 按 `sensor.DBID` 去重。
- 字段：`SensorDBID`, `SensorName`, `SensorType`, `SensorRole`, `SensorTechGeneration`, `SensorHas360Coverage`, `SensorHasVariableMaxRange`（以上 `string`）, `SensorMaxRange` (`float` -> DB `string`).

#### 26. `CommCreated`（`EventExporterManager.cs:1237-1248`, `DBTablesDefine:600-610`）
- 字段：`UnitID`, `UnitName`, `CommID`, `CommName`, `CommDBID`, `CommStatus`（全部 `string`）。

#### 27. `CommClassUsed`（`EventExporterManager.cs:1205-1235`, `DBTablesDefine:612-637`）
- 按 `comm.DBID` 去重。
- 字段：`CommDBID`, `CommName`, `CommType`, 以及 11 个频段布尔字符串 `ELF_Radio, SLF_Radio, ULF_Radio, VLF_Radio, LF_Radio, MF_Radio, HF_Radio, VHF_Radio, UHF_Radio, SHF_Radio, EHF_Radio`。

#### 28. `CommIsJammedChanged`（`EventExporterManager.cs:886-899`, `DBTablesDefine:664-671`）
- 字段：`CommID` (`string`), `CommName` (`string`), `IsJammed` (`string`, 传 `bool`). **Bug**：未判 `IsOperating`。

#### 29. `WeaponRecordCreated`（`EventExporterManager.cs:1027-1137`, `DBTablesDefine:639-649`）
- 导出初始可用非训练武器挂载/弹库（`CurrentLoad > 0`；跳过 `BuddyStore/DropTank/FerryTank/HeliTowedPackage/TrainingRound`）。
- 字段：`UnitID` (`string`), `UnitName` (`string`), `WeaponRecordName` (`string`), `WeaponRecordNumber` (`int`), `WeaponRecordDBID` (`int` -> DB `string`), `WeaponRecordType` (`string`: `"Loadout"` / `"LoadoutSensorPod"` / `"Magazine"` / `"Mount"`).

#### 30. `ComponentStatusChanged`（`EventExporterManager.cs:849-883`, `DBTablesDefine:651-662`）
- 字段：`ComponentID`, `ComponentName`, `ComponentStatus`, `SensorIsActive` (传 `bool` 标 `typeof(string)`), `ComponentDamageSeverity`, `PlatformID`, `PlatformName`。**Bug**：未判 `IsOperating`。

---

### G. 任务计划、航空/停靠作业与燃油保障（7 表）

#### 31. `MissionChanged`（`EventExporterManager.cs:1387-1426`, `DBTablesDefine:486-500`）
- `SplitFilesBySide` 键：`Side`。
- 字段：`MissionName` (`100`), `MissionID` (`40`), `Side` (`100`), `Category` (`20`), `MissionClass` (`20`), `IsActive` (`20`), `SubClass` (`20`: Patrol.Type / Strike.Type / Support.NavigationLoopType), `StartTime`, `EndTime`, `TakeOffTime`, `TimeOnTarget`（C# 为 `DateTime` 类型标记 + `ExtractDateTime()` `"MM/dd/yyyy HH:mm:ss.fff"`，null 用 `DateTime.MinValue` -> `"01/01/0001 00:00:00.000"`；DB 为 `string`）。

#### 32. `MissionUnitRelationChanged`（`EventExporterManager.cs:1428-1470, 1502-1510`, `DBTablesDefine:502-508`）
- 字段：`UnitID` (`40`), `MissionID` (`40`), `Type` (`20`: `"Assigned"` / `"StrikeContact"` / `"StrikeActiveUnit"` / `"StrikeUndefinedType"`).

#### 33. `MissionRefPointRelationChanged`（`EventExporterManager.cs:1435-1485, 1489-1499`, `DBTablesDefine:510-517`）
- 字段：`MissionID` (`40`), `Type` (`20`: `"Patrol"` / `"Prosecution"` / `"NavigationCourse"`), `Longitude` (`double`), `Latitude` (`double`).

#### 34. `AirOps`（`Aircraft_AirOps.cs:3545,3554,3760, 3895-3981`, `DBTablesDefine:385-405`）
- 字段：`UnitID`, `UnitName`, `UnitClass`, `UnitSide`, `UnitLongitude` (`double`), `UnitLatitude` (`double`), `Action` (`"Landing"` / `"TakingOff"`), `DepartureHostID` (常空), `DepartureHostName` (常空), `ArrivalHostID`, `ArrivalHostName`, `MissionID`, `MissionName`, `TotalFuel` (`int`), `LoadoutID`, `LoadoutName`, `LoadoutStores` (`"<Load>x <WeaponDBID>\|..."` 或无载荷时 `CurrentHostUnit.Name`).

#### 35. `DockingOps`（`ActiveUnit_DockingOps.cs:3869, 4430-4480`, `DBTablesDefine:407-424`）
- 同 `AirOps` 但无 Loadout 3 列，且 `Action` 硬编码为 `"Docking"`。

#### 36. `FuelConsumed`（`ActiveUnit.cs:7329-7363`, `DBTablesDefine:366-373`）
- 节流（`IsExportInterval`）。`SplitFilesBySide` 键：`UnitSide`。
- 字段：`UnitID` (`40`), `UnitName` (`500`, **DB丢弃**), `UnitClass` (`500`, **DB丢弃**), `UnitSide` (`500`, **DB丢弃**), `FuelQuantity` (`float` -> DB `double`), `FuelType` (`int`), `MiscInfo` (`string(500)`).

#### 37. `FuelTransfer`（`ActiveUnit.cs:7283-7327`, `DBTablesDefine:375-383`）
- `SplitFilesBySide` 键：`UnitSide`。
- 字段：`UnitID`, `UnitName`/`UnitClass`/`UnitSide` (**DB丢弃**), `ReceiverID`, `ReceiverName`/`ReceiverClass`/`ReceiverSide` (**DB丢弃**), `FuelQuantity` (`float` -> DB `double`), `FuelType` (`int`), `MiscInfo` (`string(500)`).

---

### H. 死枚举 / 未接线事件清单（不可用，禁止作为算子数据源）

| Enum ID | 名称 | 源码情况 |
|---|---|---|
| 0, 19 | `None`, `Max` | 枚举边界占位符 |
| 5 | `SensorDetectionAttempt` | 仅开关名 + `EventExporter_CSV.cs:195-197` 读取不存在的 `SensorParentSide`；全库无 `ExportEvent` 调用 |
| 6 | `PointDefenceAndDECM` | 仅 `ExportSensorDetectionSuccess` 映射；全库无调用 |
| 14 | `WaterSplash` | 仅 `TacviewClient.cs:589` 旧枚举判断；全库无调用 |
| 16 | `SimExecution` | 无任何引用 |
| 18 | `CargoTransfer` | 仅 `Tacview2x` 未使用布尔字段；全库无调用 |
| — | `SensorStatusChanged` | `EventExporterManager.cs:872-881` 大段注释代码，未加入枚举与表定义 |

---

## 四、跨表主键、联表配方与 `LabConsole` 实测校验要点

1. **四项预处理铁律**（见 `LabConsole/content/CSV表清点与用途.md` 与 `LabConsole/tools/csv_normalize/csv_normalize.py`）：
   - **去双 BOM**：文件开头与首列列头务必用 `.lstrip('\ufeff')`（`utf-8-sig` 只去 1 个，仍会留第 2 个 BOM 导致 `TimelineID` 匹配失败）。
   - **单 Run 锁隔离**：按文件名前缀 `{Y}-{M}-{D}_{H}.{m}.{s}_` 与行内 `TimelineID`（+ 若 `MC_Run > 0` 按 `MC_Run`）隔离单局数据，严禁跨 run 联表。
   - **双时间格式兼容**：`Time` 列可能是相对 `TimeSpan`（`UseZeroHour=true`，如 `00:02:04.8000000` 或 `1.02:00:00`），也可能是绝对 `DateTime`（`UseZeroHour=false`，`MM/dd/yyyy HH:mm:ss.fff`）。`SimInfo.Time` 与 `MissionChanged.*Time` 恒为绝对 `MM/dd/yyyy HH:mm:ss[.fff]`。
   - **GUID 大小写与武器后缀**：`UnitCreated.UnitID` 与 `UnitDestroyed.UnitID` / `WeaponFired.WeaponID` 大小写可能不同（如在飞导弹在 `WeaponFired` 中常见小写 `qokjun-...` 而部分单位表为大写 `QOKJUN-...`），联表前须统一 `.lower()`；统计武器型号时用 `\s+#\d+$` 剥离实例编号。

2. **四大验证联表配方**（`LabConsole/tools/csvkit/join_recipes.py`）：
   - **武器命中率**：`WeaponFired.WeaponID` ↔ `WeaponEndgame.WeaponID`（取同 `WeaponID` 最晚 `Time` 行判 `KILL/HIT/MISS/POINTDEF:FAILURE`；无 endgame 记 `unknown`）。
   - **单位存活曲线**：`UnitCreated.UnitID` ↔ `UnitDestroyed.UnitID`（需区分初始单位与发射产生的导弹/消耗品）。
   - **探测链误差**：`ContactCreated (ContactID -> ActualUnitID)` -> `ContactPositions` vs `UnitPositions` 按最近时间对齐计算大圆海里误差。
   - **效费比**：`Expenditures(DBID, Side, Num)` + `Losses(SubjectID, DBID, Side, Type, Class)`（注意：`Losses` 覆盖含非活动对象的损毁口径，通常略宽于 `UnitDestroyed`）。
