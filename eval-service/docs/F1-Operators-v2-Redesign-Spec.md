# F1 推演评估中台 Operators v2 算子重建定稿清单（美军评估规则对齐版）

> **适用工程**：`eval-service/`（严格遵守主仓库零入侵、Fail-Closed 实证门控、单一真相源、纯净输出原则）
>
> **数据底座**：全量字段名均已逐一核对 `sim-output-fields/schemas/f1-output-catalog.json`（44 类 EventExporter CSV / 333 业务字段 + BS MQTT 7 族路径）
>
> **对标标准**：[JP 5-0 Joint Planning](https://www.esd.whs.mil/Portals/54/Documents/FOID/Reading%20Room/Joint_Staff/18-F-1152_JP_5-0_Joint_Planning_2020.pdf)、[Commander's Handbook for Assessment Planning and Execution](https://www.jcs.mil/Portals/36/Documents/Doctrine/pams_hands/assessment_hbk.pdf)、[DoDI 5000.98](https://www.esd.whs.mil/Portals/54/Documents/DD/issuances/dodi/500098p.PDF)、[DOT&E Quantitative Mission-Focused Measures Guidance](https://www.dote.osd.mil/Portals/97/docs/TEMPGuide/Mission_Focused_Metrics_Guidance_3.0.pdf)、[CJCSM 3500.04 UJTL/JMETL](https://www.jcs.mil/Portals/36/Documents/Doctrine/training/JMETLbook.pdf?ver=2017-12-29-171303-350)

## 一、重建架构与核心规则变更

### 1. 双维分类：美军评估角色 (`evalRole`) × 作战能力域 (`domain`)

废弃旧版模糊的 `time / eff / sit / comp / cost` 单一分类，所有原子算子统一标注两项正交属性：

| 美军评估角色 (`evalRole`) | 条令含义 | 三库综合评估中的处置方式 | 
| ----- | ----- | ----- | 
| **`MOE`**（Measure of Effectiveness） | 作战效能：衡量“是否在做正确的事”，聚焦任务目标达成与对敌实质效果（[JP 5-0](https://www.esd.whs.mil/Portals/54/Documents/FOID/Reading%20Room/Joint_Staff/18-F-1152_JP_5-0_Joint_Planning_2020.pdf)） | 参与顶层体系权重聚合，构成任务成效主维度 | 
| **`MOP`**（Measure of Performance） | 任务/系统性能：衡量“是否把事做正确”，聚焦杀伤链时延、探测与武器命中精度（[JP 5-0](https://www.esd.whs.mil/Portals/54/Documents/FOID/Reading%20Room/Joint_Staff/18-F-1152_JP_5-0_Joint_Planning_2020.pdf)） | 参与性能子维度聚合，不得替代 MOE 判定任务成败 | 
| **`MOS`**（Measure of Suitability） | 作战适用性与保障：衡量出动回收、燃油保障、武器途中可靠性与持续能力（[DoDI 5000.98](https://www.esd.whs.mil/Portals/54/Documents/DD/issuances/dodi/500098p.PDF)） | 独立作为保障/适用性维度评估，不混入火力效能 | 
| **`SURV`**（Survivability） | 生存性与电磁抗毁：衡量己方平台存活、防区外安全裕度、电子战与通信韧性（[DOT&E](https://www.dote.osd.mil/Portals/97/docs/TEMPGuide/Mission_Focused_Metrics_Guidance_3.0.pdf)） | 独立作为生存性维度，与对敌毁伤解耦 | 
| **`GATE`**（Safety / ROE Gate） | 安全红线与交战规则硬约束（如友军误伤、未达 PID 开火） | **不参与线性加权摊薄**；违例触发 `gateStatus: "violated"`，在总评中强制标红预警或封顶 | 

### 2. 四项强制计算铁律

1. **单一物理量纲**：每个算子只输出一种固定物理量纲，禁止“有单价报美元、无单价降级报枚数”的双量纲漂移。

2. **同目标配对（F2T2EA）**：所有杀伤链分段时延必须按 `ContactID` / `ActualUnitID` / `WeaponID` 严格配对计算，输出中位数（`median`）为主值，同时在 `details` 中保留 `mean`、`p90` 与样本数 `n`，禁止拿全局首次侦获与另一目标的首次开火相减。

3. **原始分子/分母透出（蒙特卡洛聚合友好）**：所有比率/概率算子在 `MetricAtomResult` 中强制返回 `numerator`、`denominator` 与 `sampleSize`，支持跨 `SimInfo.MonteCarloIteration` 多局精确合并统计均值与 95% 置信区间（符合 [DOT&E 统计要求](https://www.dote.osd.mil/Portals/97/docs/TEMPGuide/Mission_Focused_Metrics_Guidance_3.0.pdf)）。

4. **盘活原生表 + Fail-Closed**：优先读取 F1 引擎原生表（`EngagementCycle`、`FirstSensorToUnitRecordCreated`、`ComponentStatusChanged`、`UnitJammed`、`CommIsJammedChanged`、`AirOps`、`DockingOps`、`FuelTransfer`），缺表或缺列时严格返回 `status: "unavailable"` 与 `missingDataReason`，严禁编造默认值。

## 二、Operators v2 全量算子定稿清单（共 36 个原子算子）

### 域 1：任务与作战效果（`moe.*`，4 个）

| 序号 | 新算子 ID | 中文名称 | 角色 | 量纲 / 方向 | 精确数学口径 | F1 真实表与字段 | Fail-Closed 条件 | 
| ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | 
| 1 | `moe.mission_success_rate` | 任务达成率（含 Wilson 95% CI） | `MOE` | 比例 (0–1) / 越大越好 | 显式任务判据通过数 ÷ 总判据数，附 Wilson 95% 置信区间 | `spec_criteria`（`metrics.py` / `criteriaResults`） | 无显式任务判据时 `unavailable`，严禁以开火替代成功 | 
| 2 | `moe.target_set_kill_rate` | 指定目标集摧毁率（K-Kill） | `MOE` | 比例 (0–1) / 越大越好 | 目标集中被摧毁的敌方非武器单元去重数 ÷ 目标集初始单元总数（默认可按 `targetUnitFilter` 指定任务目标集，未指定时为全部敌方非武器单元） | `UnitCreated.UnitID, UnitType, UnitSide`、`UnitDestroyed.UnitID, UnitSide`、`Losses.SubjectID, Side, Type` | 敌方目标集基数为 0 或缺损毁表时 `unavailable` | 
| 3 | `moe.target_functional_degradation` | 敌方目标功能/机动毁伤率（BDA F/M-Kill） | `MOE` | 比例 (0–1) / 越大越好 | 敌方非武器目标中发生关键部件损毁（传感器/武器/动力 `ComponentDamageSeverity` 达受损或损毁）或物理毁伤超阈值（可配，默认 `DamagePercent >= 50%`）或已被摧毁的唯一单元数 ÷ 敌方目标总数 | `ComponentStatusChanged.PlatformID, ComponentDamageSeverity, ComponentStatus`、`UnitDamaged.UnitID, DamagePercent, UnitSide`、`UnitDestroyed.UnitID` | 缺 `ComponentStatusChanged` 与 `UnitDamaged` 时 `unavailable`（淘汰旧版武断 `0.5` 权重） | 
| 4 | `moe.zone_control_ratio` | 任务海空域覆盖控制率 | `MOE` | 比例 (0–1) / 越大越好 | 己方传感器/巡逻轨迹在任务多边形内有效覆盖面积 ÷ 任务区总面积 | `MissionRefPointRelationChanged.MissionID, Longitude, Latitude`、`UnitPositions.UnitID, UnitLongitude, UnitLatitude`、BS `ActiveUnits` | 缺少任务区多边形顶点（<3 点）或无航迹时 `unavailable` | 

### 域 2：F2T2EA 杀伤链与 C2（`kc.*`，8 个）

| 序号 | 新算子 ID | 中文名称 | 角色 | 量纲 / 方向 | 精确数学口径 | F1 真实表与字段 | Fail-Closed 条件 | 
| ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | 
| 5 | `kc.first_detection_range` | 首次探测距离（均值/中位数） | `MOP` | nm / 越大越好 | 己方传感器对各敌方非武器目标首次建立探测记录时的距离中位数（`details` 含均值、最大、最小与按传感器分类） | `FirstSensorToUnitRecordCreated.SensorID, TargetID, Distance`、`SensorCreated.SensorID, UnitID`、`UnitCreated.UnitID, UnitSide, UnitType` | 无 `FirstSensorToUnitRecordCreated` 记录时 `unavailable` | 
| 6 | `kc.find_to_pid_latency` | 同目标 Find → PID 识别时延 | `MOP` | 秒 / 越小越好 | 按 `ContactID` 配对：`min(t_PID) - t_ContactCreated` 的中位数（`details` 含均值与 P90），其中 `t_PID` 为首次达到明确识别等级（`KnownType / KnownClass / PreciseID`）时刻 | `ContactCreated.ContactID, ActualUnitID, Side`、`DetectionIdentificationChanged.ContactID, IdentificationStatus` | 无可配对的 Find 与 PID 事件时 `unavailable` | 
| 7 | `kc.pid_to_engage_latency` | 同目标 PID → Engage 交战决策时延 | `MOP` | 秒 / 越小越好 | 按目标（`TargetContactID` / `ActualUnitID`）配对：首次向该目标发射武器时刻 `t_WeaponFired - t_PID` 的中位数（过滤 `< 0` 未达 PID 先开火异常样本，异常数转交 `roe.pid_before_fire_rate`） | `DetectionIdentificationChanged.ContactID, IdentificationStatus`、`WeaponFired.TargetContactID, TargetContactActualUnitID, FiringUnitSide` | 无可配对的 PID 与开火记录时 `unavailable` | 
| 8 | `kc.engage_to_assess_latency` | 同弹药 Engage → Assess 飞行与评估时延 | `MOP` | 秒 / 越小越好 | 按唯一 `WeaponID` 精确配对：`t_WeaponEndgame - t_WeaponFired` 的中位数（`details` 含均值与 P90） | `WeaponFired.WeaponID, FiringUnitSide`、`WeaponEndgame.WeaponID, WeaponSide` | 无可按 `WeaponID` 配对的发射与终局事件时 `unavailable` | 
| 9 | `kc.f2t2ea_total_latency` | 同目标端到端 F2T2EA 杀伤链总时延 | `MOP` | 秒 / 越小越好 | 按同一敌方真值目标 `ActualUnitID` 配对：该目标首次承受有效命中/摧毁时刻 `t_HitOrKill - t_FirstContactCreated` 的中位数（严禁跨目标首尾相减） | `ContactCreated.ContactID, ActualUnitID, Side`、`WeaponEndgame.TargetID, Result`、`UnitDestroyed.UnitID` | 无法按同一目标闭环配对时 `unavailable` | 
| 10 | `kc.pid_coverage_rate` | 目标明确识别覆盖率（PID Rate） | `MOP` | 比例 (0–1) / 越大越好 | 己方达到明确识别等级的敌方非武器唯一 `ActualUnitID` 数 ÷ 敌方初始非武器单元总数 | `DetectionIdentificationChanged.ContactID, IdentificationStatus`、`ContactCreated.ContactID, ActualUnitID, Side`、`UnitCreated.UnitID, UnitType, UnitSide` | 缺识别表或敌方基数为 0 时 `unavailable` | 
| 11 | `kc.track_continuity_loss_max` | 同目标最大跟踪中断（黑障）时长 | `MOP` | 秒 / 越小越好 | 按同一目标统计接触丢失后至重新捕获的最大连续中断时长 | BS `Contacts[]` 差分事件（`detection_lost` / `detection_new`）或 `ContactPositions.ContactID` 采样间隔 | 无连续帧或无接触丢失重捕记录时 `unavailable` | 
| 12 | `kc.engagement_cycle_count` | 原生交战周期计数 | `MOP` | 次 / 参考指标 | 直接基于引擎原生 `EngagementCycle` 事件统计己方有效交战循环次数（按 `UnitID + ContactID + SalvoID` 归并，彻底替代旧版 60s 拍脑袋切片） | `EngagementCycle.UnitID, UnitSide, CycleAction, ContactID, SalvoID` | 缺 `EngagementCycle.csv` 时 `unavailable` | 

### 域 3：火力打击与武器效能（`wpn.*`，6 个）

| 序号 | 新算子 ID | 中文名称 | 角色 | 量纲 / 方向 | 精确数学口径 | F1 真实表与字段 | Fail-Closed 条件 | 
| ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | 
| 13 | `wpn.probability_of_hit` | 单发命中概率（$P_h$） | `MOP` | 比例 (0–1) / 越大越好 | 按 `WeaponID` 去重后终态为 `HIT` 或 `KILL` 的弹药数 ÷ 己方总发射弹药数（分母取 `max(WeaponFired 去重数, WeaponEndgame 去重数 + WeaponLost 总数)`，剔除 `POINTDEF:FAILURE` 重复行） | `WeaponFired.WeaponID, FiringUnitSide`、`WeaponEndgame.WeaponID, WeaponSide, Result`、`WeaponLost.Side, Num` | 总发射数为 0 或缺终局数据时 `unavailable` | 
| 14 | `wpn.probability_of_kill_given_hit` | 命中条件下杀伤概率（$P_{k \mid h}$） | `MOP` | 比例 (0–1) / 越大越好 | 按 `WeaponID` 去重后终态为 `KILL`（或直接导致目标 `UnitDestroyed`）的弹药数 ÷ 命中弹药数（`HIT + KILL`） | `WeaponEndgame.WeaponID, WeaponSide, TargetID, Result`、`UnitDestroyed.UnitID` | 命中弹药数为 0 时 `unavailable` | 
| 15 | `wpn.single_shot_pk` | 单发杀伤概率（$P_{ssk}$） | `MOP` | 比例 (0–1) / 越大越好 | 按 `WeaponID` 去重后实现目标击毁的弹药数 ÷ 己方总发射弹药数（含 `WeaponLost` 途中失效弹，满足 $P_{ssk} = P_h \times P_{k \mid h}$ 一致性约束） | `WeaponFired.WeaponID`、`WeaponEndgame.WeaponID, Result`、`WeaponLost.Num` | 总发射数为 0 时 `unavailable` | 
| 16 | `wpn.terminal_penetration_rate` | 末端突防成功率 | `MOP` | 比例 (0–1) / 越大越好 | 遭遇敌方点防/软杀伤拦截的己方弹药中成功穿透（未触发 `POINTDEF:SUCCESS` / 诱骗失效）的数量 ÷ 实际遭遇拦截的弹药总数（严格剔除 `"No point defence systems employed"` 虚构分母） | `WeaponEndgame.WeaponID, WeaponSide, Result, EndgameMessage` | 无真实点防拦截对抗记录时 `unavailable` | 
| 17 | `wpn.shots_per_kill` | 单毁伤目标平均耗弹量 | `MOP` | 枚 / 击毁 / 越小越好 | 己方总消耗弹药数（优先 `Expenditures.Num`，次选 `WeaponFired` 去重计数） ÷ 敌方被摧毁非武器目标唯一数 | `Expenditures.Side, Num`、`WeaponFired.WeaponID, FiringUnitSide`、`UnitDestroyed.UnitID, UnitSide` | 敌方摧毁目标数为 0 时 `unavailable`（不硬设分母为 1） | 
| 18 | `wpn.inflight_attrition_rate` | 弹药途中失效率 | `MOS` | 比例 (0–1) / 越小越好 | 己方途中丢失/脱锁/燃料耗尽/被中段拦截弹药数 ÷ 己方总消耗弹药数 | `WeaponLost.Side, Num`、`Expenditures.Side, Num`、`WeaponFired.WeaponID` | 缺 `WeaponLost` 且总消耗为 0 时 `unavailable` | 

### 域 4：生存性、机动与电磁对抗（`surv.*`，7 个）

| 序号 | 新算子 ID | 中文名称 | 角色 | 量纲 / 方向 | 精确数学口径 | F1 真实表与字段 | Fail-Closed 条件 | 
| ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | 
| 19 | `surv.force_survival_rate` | 己方作战平台生存率 | `SURV` | 比例 (0–1) / 越大越好 | `1 - (己方被摧毁非武器单元去重数 ÷ 己方参战初始非武器单元总数)`，严格调用 `isWeaponType` 过滤中文 `"武器"` | `UnitCreated.UnitID, UnitType, UnitSide`、`UnitDestroyed.UnitID, UnitSide`、`Losses.SubjectID, Side, Type` | 己方初始非武器单元数为 0 时 `unavailable` | 
| 20 | `surv.loss_exchange_ratio` | 平台战损交换比（LER） | `SURV` | 比值 (敌损:己损) / 越大越好 | 敌方被摧毁非武器单元数 ÷ 己方被摧毁非武器单元数；**己方零战损且敌损 > 0 时标记 `zeroLossVictory: true` 并返回显式上限/无损状态（不将分母硬改 `1` 混淆 `3:0` 与 `3:1`）**，双方均 0 损时返回 `unavailable` | `UnitDestroyed.UnitID, UnitSide`、`Losses.SubjectID, Side, Type`、`UnitCreated.UnitID, UnitType` | 双方均无战损或缺少战损表时 `unavailable` | 
| 21 | `surv.standoff_launch_margin` | 防区外发射距离裕度 | `SURV` | ×MAR / 越大越好 | 己方武器发射时刻实际水平接敌距离（优先原生 `TargetContactRangeHoriz_nm`，次选 Turf WGS84 测地距） ÷ 预设最小脱离/威胁半径 `marNm`（可配）的中位数与最小值 | `WeaponFired.FiringUnitSide, TargetContactRangeHoriz_nm, FiringUnitLongitude, FiringUnitLatitude, TargetContactLongitude, TargetContactLatitude` | 无己方发射记录或无距离坐标时 `unavailable` | 
| 22 | `surv.tot_arrival_delta` | 多路协同到达时间差（TOT Delta） | `MOP` | 秒 / 越小越好 | 优先对比各突击平台首轮命中/到达时刻与 `MissionChanged.TimeOnTarget` 的最大绝对偏差；若无原生 TOT，则统计多突击平台首轮命中时间极差 `max(t) - min(t)` | `MissionChanged.MissionID, Side, TimeOnTarget`、`WeaponEndgame.ParentFiringUnitID, WeaponSide`、`WeaponImpact.UnitID` | 少于 2 个突击平台且无原生 TOT 时 `unavailable` | 
| 23 | `surv.ew_jammed_time_ratio` | 己方平台受电子干扰时长占比 | `SURV` | 比例 (0–1) / 越小越好 | 己方非武器平台处于 `UnitJammed.Status = true` 的累计受干扰机时 ÷ 己方平台总在勤机时 | `UnitJammed.UnitID, Status`、`UnitCreated.UnitID, UnitSide, UnitType`、`SimInfo.Time` | 无 `UnitJammed.csv` 记录时 `unavailable` | 
| 24 | `surv.c2_comm_availability` | C2 通信链路抗干扰可用率 | `SURV` | 比例 (0–1) / 越大越好 | `1 - (己方通信设备处于 CommIsJammedChanged.IsJammed = true 的累计时长 ÷ 己方通信链路总在勤时长)` | `CommCreated.UnitID, CommID`、`CommIsJammedChanged.CommID, IsJammed`、`UnitCreated.UnitID, UnitSide` | 缺 `CommCreated` 或 `CommIsJammedChanged` 时 `unavailable` | 
| 25 | `surv.kinematic_altitude_advantage` | 空域高度势能优势 | `SURV` | m / 越大越好 | 己方活跃空中非武器单元平均飞行高度 − 敌方活跃空中非武器单元平均飞行高度（仅限空中平台，不混入水面/水下单元） | `UnitPositions.UnitID, UnitType, UnitSide, UnitAltitude_m`、BS `ActiveUnits[].CA` | 任一方缺少空中非武器单元高度采样时 `unavailable` | 

### 域 5：持续保障与作战适用性（`mos.*`，4 个）

| 序号 | 新算子 ID | 中文名称 | 角色 | 量纲 / 方向 | 精确数学口径 | F1 真实表与字段 | Fail-Closed 条件 | 
| ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | 
| 26 | `mos.air_sortie_recovery_rate` | 航空出动回收闭环率（含 SGR） | `MOS` | 比例 (0–1) / 越大越好 | 己方安全返航着陆/着舰架次 ÷ 己方起飞出动总架次（`details` 同时输出按小时折算的出动架次率 SGR） | `AirOps.UnitID, UnitSide, Action, DepartureHostID, ArrivalHostID, MissionID` | 无己方 `AirOps.csv` 起飞记录时 `unavailable` | 
| 27 | `mos.docking_ops_recovery_rate` | 舰艇/无人艇出港回收闭环率 | `MOS` | 比例 (0–1) / 越大越好 | 己方安全返港/回坞次 ÷ 己方出港/离坞部署总次 | `DockingOps.UnitID, UnitSide, Action, DepartureHostID, ArrivalHostID` | 无己方 `DockingOps.csv` 记录时 `unavailable` | 
| 28 | `mos.fuel_reserve_min_ratio` | 现存平台最低余油保障率 | `MOS` | 比例 (0–1) / 越大越好 | 终态己方现存作战单元中剩余燃油比（`CQ / MQ`）的**最小值**（`details` 附均值与低于红线 20% 的告警单元列表，防止均值掩盖单机断油风险） | BS `ActiveUnits[].Fuel.FuelRec.{CQ, MQ}`、`AirOps.TotalFuel`、`FuelConsumed.FuelQuantity` | 无燃油容量与余量字段时 `unavailable` | 
| 29 | `mos.refuel_transfer_volume` | 空中加油 / 海上补给保障量 | `MOS` | 燃油单位 / 参考指标 | 统计己方受油/受补单元通过 `FuelTransfer` 成功接收的累计燃油量与补给成功次数 | `FuelTransfer.UnitID, ReceiverID, ReceiverSide, FuelQuantity, FuelType` | 无 `FuelTransfer.csv` 记录时 `unavailable` | 

### 域 6：条令合规、安全红线与效费（`roe.*` & `cost.*`，7 个）

| 序号 | 新算子 ID | 中文名称 | 角色 | 量纲 / 方向 | 精确数学口径 | F1 真实表与字段 | Fail-Closed 条件 | 
| ----- | ----- | ----- | ----- | ----- | ----- | ----- | ----- | 
| 30 | `roe.fratricide_count` | 友军误伤事件数（安全红线） | `GATE` | 次 / 必须为 0 | 审计己方武器 `WeaponEndgame` 命中或击毁己方/友方非武器单元的唯一事件数；**`> 0` 即触发 `gateStatus: "violated"`（硬拦截，绝不折算 0–1 比例）** | `WeaponEndgame.WeaponID, WeaponSide, TargetID, TargetSide, Result` | 无己方终局记录时返回 `0`（标注无交火）或缺表时 `unavailable` | 
| 31 | `roe.pid_before_fire_rate` | 开火前明确识别合规率（PID Gate） | `GATE` | 比例 (0–1) / 必须为 1.0 | 己方所有 `WeaponFired` 事件中，开火时刻 `t_fire` 之前目标 `TargetContactID` 已在 `DetectionIdentificationChanged` 中达到明确识别等级的占比；`< 1.0` 触发 `gateStatus: "violated"` | `WeaponFired.WeaponID, FiringUnitSide, TargetContactID`、`DetectionIdentificationChanged.ContactID, IdentificationStatus` | 缺识别表或无己方开火记录时 `unavailable` | 
| 32 | `roe.corridor_spatial_compliance` | 任务航路走廊空间遵从率 | `MOP` | 比例 (0–1) / 越大越好 | 沿用现有 4 表联动算法：构建任务走廊多边形，对齐在勤生命周期，计算单元在勤时间窗内位于走廊且满足最小安全裕度的时长占比 | `MissionChanged`、`MissionUnitRelationChanged`、`MissionRefPointRelationChanged`、`UnitPositions` | 缺少 4 表任一或无走廊参考点时 `unavailable` | 
| 33 | `roe.wra_engagement_compliance` | WRA 射程与齐射准则合规率 | `MOP` | 比例 (0–1) / 越大越好 | 校验己方 `WeaponFired` 的实际接敌距离（`TargetContactRangeHoriz_nm`）与同 `SalvoID` 齐射枚数是否符合配置的 WRA 规则（默认 BVR 下限 `20 nm`，可配置覆盖） | `WeaponFired.WeaponID, FiringUnitSide, TargetContactRangeHoriz_nm, SalvoID` | 未配置 WRA 规则且无发射记录时 `unavailable` | 
| 34 | `roe.emcon_emission_discipline` | EMCON 电磁静默纪律遵从率 | `MOP` | 比例 (0–1) / 越大越好 | 统计己方要求静默窗口内传感器保持关闭（`SensorIsActive = false`）的时长占比（同时兼容 CSV `ComponentStatusChanged` 与 BS `Sensors[].Active`） | `ComponentStatusChanged.PlatformID, SensorIsActive`、`SensorCreated.UnitID, SensorIsActive`、BS `ActiveUnits[].Sensors[].Active` | 无传感器开关机事件且无 BS 传感器状态时 `unavailable` | 
| 35 | `cost.munitions_expended_count` | 己方弹药总消耗量（纯数量） | `MOS` | 枚 / 越小越好 | 优先读取 `Expenditures.Num` 累加，次选 `WeaponFired` 按 `WeaponID` 去重计数（**纯数量单一量纲，绝不混入货币**） | `Expenditures.Side, Num, WeaponName`、`WeaponFired.WeaponID, FiringUnitSide` | 两表均无己方记录时 `unavailable` | 
| 36 | `cost.monetary_exchange_ratio` | 经济效费比（纯货币 CER） | `MOE` | 货币比 / 越大越好 | 敌方损失装备货币价值 ÷（己方损失装备货币价值 + 己方消耗弹药货币成本）；**未提供完整单价表 `unitPrices` 时严格 `unavailable`，绝不降级为枚数**；分母为 0 时独立标记 | `UnitDestroyed`、`Losses`、`Expenditures` + 外部配置 `unitPrices` | 未提供单价表或关键装备缺单价时 `unavailable` | 

## 三、旧 38 算子逐一废立对照表

| 旧算子 ID | 处置结论 | 对应新算子 ID | 处置理由 | 
| ----- | ----- | ----- | ----- | 
| `time.first_detection` | **废弃** | `kc.first_detection_range` | 相对 `T=0` 受想定初始距离干扰严重，改用原生首次探测距离与同目标相对时延 | 
| `time.first_weapon_fire` | **废弃** | `kc.pid_to_engage_latency` | 相对 `T=0` 无法剥离航渡时间，改为同目标 PID→Engage 相对响应时延 | 
| `time.detect_to_fire_latency` | **重构** | `kc.find_to_pid_latency` + `kc.pid_to_engage_latency` | 拆分 Find→PID 与 PID→Engage 两段，且强制按 `ContactID` 同目标配对 | 
| `time.first_target_hit` | **废弃** | `kc.f2t2ea_total_latency` | 相对 `T=0` 绝对时刻失真，由同目标端到端杀伤链总时延替代 | 
| `time.combat_duration` | **废弃** | `kc.engagement_cycle_count` | 首尾开火跨度受零星尾弹拉伸，缺乏评估方向性，由原生交战周期替代 | 
| `time.blind_zone_duration` | **升级保留** | `kc.track_continuity_loss_max` | 保留并强制按同目标配对统计最大跟踪中断 | 
| `time.bvr_flight_avg` | **升级保留** | `kc.engage_to_assess_latency` | 纳入 F2T2EA 杀伤链标准命名，主值改中位数并附均值/P90 | 
| `time.kill_chain_total_latency` | **重构** | `kc.f2t2ea_total_latency` | 修正为按 `ActualUnitID` 同目标闭环配对，杜绝跨目标错配 | 
| `time.strike_wave_interval` | **废弃** | `kc.engagement_cycle_count` | 20 秒经验切片无美军条令依据，改为原生 `EngagementCycle` | 
| `eff.mission_success_rate` | **升级保留** | `moe.mission_success_rate` | 保留 Wilson 95% CI 与严格 fail-closed，标定为顶层 `MOE` | 
| `eff.hit_rate` | **拆分重构** | `wpn.probability_of_hit` + `wpn.probability_of_kill_given_hit` + `wpn.single_shot_pk` | 严格分离 $P_h / P_{k \mid h} / P_{ssk}$，并将 `WeaponLost` 计入分母防虚高 | 
| `eff.kill_efficiency` | **拆分重构** | `moe.target_set_kill_rate` + `moe.target_functional_degradation` | 淘汰武断的 `0.5` 受损权重，区分 K-Kill 与部件级 F/M-Kill，支持指定目标集 | 
| `eff.attrition_balance` | **拆分重构** | `surv.force_survival_rate` + `surv.loss_exchange_ratio` | 废除“零己损分母改 1”，拆出独立生存率并对无损完胜显式标记 | 
| `eff.engagement_cycles_count` | **替换** | `kc.engagement_cycle_count` | 废除 60s 硬编码切片，直接读取 F1 原生 `EngagementCycle.csv` | 
| `eff.target_penetration_rate` | **升级保留** | `wpn.terminal_penetration_rate` | 保留剔除无点防虚构分母的严谨逻辑，归入武器性能域 | 
| `eff.weapon_loss_ratio` | **重分类保留** | `wpn.inflight_attrition_rate` | 角色从效能调整为适用性 `MOS` | 
| `eff.damage_severity_index` | **合并重构** | `moe.target_functional_degradation` | 与部件级 BDA 功能毁伤整合，避免与毁伤效率重复计权 | 
| `eff.salvo_efficiency` | **修正保留** | `wpn.shots_per_kill` | 分子分母改为“总耗弹 ÷ 击毁目标数”，0 击毁严格 `unavailable` | 
| `eff.air_ops_sortie_completion` | **重分类升级** | `mos.air_sortie_recovery_rate` | 移入 `MOS` 保障域，补充出动架次率 SGR | 
| `eff.sensor_detection_rate` | **重构** | `kc.first_detection_range` | 结合原生 `FirstSensorToUnitRecordCreated` 衡量实际探测距离能力 | 
| `eff.target_identification_rate` | **升级保留** | `kc.pid_coverage_rate` | 保留严谨的 3 表关联去重逻辑，归入 F2T2EA 杀伤链 | 
| `sit.standoff_advantage` | **修正保留** | `surv.standoff_launch_margin` | 优先读原生 `TargetContactRangeHoriz_nm`，明确相对 MAR 裕度 | 
| `sit.formation_dispersion` | **废弃** | — | 默认 5nm 离散比缺乏通用条令方向性（聚集与分散优劣因任务而异），改为用户自定义算子按需编排 | 
| `sit.geometry_arrival_delta` | **升级保留** | `surv.tot_arrival_delta` | 优先对齐原生 `MissionChanged.TimeOnTarget`（TOT） | 
| `sit.area_coverage_ratio` | **重分类保留** | `moe.zone_control_ratio` | 归入 `MOE` 任务区域控制维度 | 
| `sit.kinematic_speed_avg` | **废弃** | — | 平均巡航速度无普遍优劣方向，属于原始态势特征而非评估算子 | 
| `sit.altitude_envelope_advantage` | **修正保留** | `surv.kinematic_altitude_advantage` | 限定仅比较空中非武器平台，防止水面舰艇拉低均值 | 
| `sit.centroid_separation_nm` | **废弃** | — | 质心距离无固定优劣方向（防区外希望远、近距拦截希望近），移出标准库 | 
| `sit.hull_containment_area` | **废弃** | — | 凸包面积无普适方向性，适合作为态势可视化特征而非标准评分算子 | 
| `comp.corridor_compliance` | **升级保留** | `roe.corridor_spatial_compliance` | 保留成熟的 4 表 Turf 走廊空间算法 | 
| `comp.wra_compliance` | **合并升级** | `roe.wra_engagement_compliance` | 与超视距射程纪律合并，统一基于 `WeaponFired` 核查射程（默认 BVR 20nm）与齐射数 | 
| `comp.emcon_silence_discipline` | **升级保留** | `roe.emcon_emission_discipline` | 打通 CSV `ComponentStatusChanged.SensorIsActive`，不再仅依赖 BS 帧 | 
| `comp.friendly_fire_safety` | **重构** | `roe.fratricide_count` | 从 `0–1` 比例彻底改为 **`GATE` 计数型安全红线**（>0 一票否决/标红） | 
| `comp.engagement_range_discipline` | **合并重构** | `roe.wra_engagement_compliance` | 废除拍脑袋 10nm，合并入 WRA 射程合规（默认 BVR 20nm 可配） | 
| `cost.munitions_cost_total` | **拆分重构** | `cost.munitions_expended_count` | 废除双量纲降级，固定输出纯弹药枚数 | 
| `cost.economic_exchange_ratio` | **修正保留** | `cost.monetary_exchange_ratio` | 严格纯货币单价 fail-closed，补充零分母独立处理 | 
| `cost.fuel_remaining_ratio` | **修正升级** | `mos.fuel_reserve_min_ratio` | 主值从均值改为现存单元**最低余油率**（防单机断油被平均掩盖），归入 `MOS` | 
| `cost.unit_munitions_intensity` | **废弃** | `wpn.shots_per_kill` | 单平台投弹密度无明确优劣方向，由单毁伤耗弹量替代 | 

*(注：全新补齐的 4 个能力算子——`surv.ew_jammed_time_ratio`、`surv.c2_comm_availability`、`mos.docking_ops_recovery_rate`、`mos.refuel_transfer_volume` 以及 `roe.pid_before_fire_rate`——在旧 38 算子中无对应项，直接基于 F1 原生表新增。)*

## 四、配套代码与数据底座改造范围

1. **核心契约 (`src/core/types.ts`)**

   * `MetricAtomMeta` 新增：`evalRole: 'MOE' | 'MOP' | 'MOS' | 'SURV' | 'GATE'`、`doctrineRef: string`、`supportsTargetFilter?: boolean`。

   * `MetricAtomResult` 新增：`numerator?: number`、`denominator?: number`、`sampleSize?: number`、`gateStatus?: 'pass' | 'violated' | 'unavailable'`、`zeroLossVictory?: boolean`。

2. **CSV 适配器扩容 (`src/adapters/csv-adapter.ts` & `situation-model.ts`)**

   * 新增解析 7 张 F1 原生表：`EngagementCycle`、`FirstSensorToUnitRecordCreated`、`ComponentStatusChanged`、`UnitJammed`、`CommIsJammedChanged`、`DockingOps`、`FuelTransfer`，并扩展 `MissionChanged` 读取 `StartTime / EndTime / TakeOffTime / TimeOnTarget`。

3. **三库评估引擎红线机制 (`src/systems/evaluator.ts`)**

   * 识别 `evalRole === 'GATE'` 的算子：独立于权重树执行门控审计；任一红线 `violated` 时在 `EvalSummaryV2.conclusion` 与 Markdown 报告顶部注入强制红线告警，并按配置决定是否触发总分封顶。

4. **二库指标与四套预置体系同步更新**

   * 重建 `src/indicators/catalog.json`（36 项指标与 36 算子 1:1 对齐，评分曲线匹配新量纲）；

   * 更新 `bvr-air-combat.json`、`littoral-swarm.json`、`air-defense.json`、`asw-barrier.json` 四套预置体系的指标引用与权重分布，通过树权重校验（$\sum = 1.0 \pm 10^{-4}$）。

## 五、进入编码前需拍板的 3 个设计细节

1. **安全红线 (`GATE`) 触发时的总分策略**：当 `roe.fratricide_count > 0`（友军误伤）或 `roe.pid_before_fire_rate < 1` 触发违例时，三库综合得分是**强制封顶（如 ≤ 40 分 / 直接判 FAIL）**，还是**保留原得分并显著标注“红线违例”标签**？

2. **WRA 超视距默认下限**：`roe.wra_engagement_compliance` 的默认 BVR 射程下限是否采用美军通用的 **`20 nm`**（并允许按场景参数 `minRangeNm` 覆盖）？

3. **旧算子 ID 兼容方式**：既然推倒重建，是**彻底切换为新命名空间（`moe.* / kc.* / wpn.* / surv.* / mos.* / roe.* / cost.*`）并同步更新全部测试用例**，还是在过渡期保留旧 ID 别名映射？