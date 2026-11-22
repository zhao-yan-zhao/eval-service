# 开工提示词：Q-062 WRA 域名清零漏拦 + db3k.detail 性能子表 + save 子目录 — Cursor — 2026-10-21

## 0. 一句话

三段打包：A=武器条令"按域清零"实际只清了"未识别接触"一行（真机已实锤漏拦，**P0**）；B=db3k.detail 查不到航速（速度在性能子表没开口）；C=想定另存建不了子目录。A/B 走 C#（攒编译波 4），C 纯 proxy 零编译可先行。

## 1. A 段：WRA 域名映射漏拦（P0，先源码核查再修）

### 病根（已实锤，直接给你）

- 桥侧 `CMO-netcore-src/AiAssistant.F1Core/LuaSetWraTemplate.cs:26-28`：
  `air → Air_Contact_Unknown_Type`、`surface → Surface_Contact_Unknown_Type`、`subsurface → Subsurface_Contact_Unknown_Type`——**域名只落到"未识别类型"一行**。
- 引擎侧 `CMO-netcore-src/Command_Core/Doctrine.cs:1701` `_WRA_WeaponTargetType` 枚举：每个域几十行具体类型（Aircraft_Unspecified=2000、5th_Generation=2001…MicroUAV=2032、Guided_Weapon_Subsonic=2204…），接触被识别后走具体类型行。
- **真机实锤（2026-10-21 晚短局）**：面板 AI 对红方三艘伯克执行 air/surface 制导武器清零且读回"生效"后，红方仍在场景时 00:19/00:21/00:50/01:21 发射 RIM-174A SM-6×4（打 MQ-9B 侦察机）。留档：`slot-01\data\EventExport\ai\bridge-23a75d769434\32dd15e459ce47539e8ae35c4810cc2c\candidate-地狱景观集群-S1缩比-v1\EventExport_CSV\2026-10-21_20.32.38_Expenditures.csv`。

### 你要做的

1. **先核查回落语义**（Doctrine.cs 内 WRA 查找链：`WRA_DetermineTargetType`、具体类型行未设置时用哪行兜底、Unknown_Type 是否兜底行、引擎默认行的出厂值）：把"为什么清了 Unknown 行还发射"的完整因果链写进报告，附文件:行号。
2. **修法**：`doctrine.set_wra` 的 `target_type` 短名语义改为**该域全部枚举行批量设置**（按枚举数值段分域；先按第 1 步的回落语义确定最小必要集合——若 Unknown 行确为兜底，可能只需"全域具体行+兜底行"一起清）。保持旧短名兼容（air/surface/subsurface/land 仍可用，语义升级为全域）；允许传引擎枚举原名作高级用法（白名单校验 `_WRA_WeaponTargetType` 合法值）。
3. **全参数生效性一并搞通（owner 10-21 21:35 追加）**：不只是清零——`weapons_per_salvo`（几发齐射）、`firing_range` / `self_defence_range`（多少海里内才开火/自卫开火、"max"）三个参数要逐一真机验证**写了真生效**（读回对账逐行核实），别只修 weapons_per_salvo=0 这一个玩法。参数与引擎 WRA 表字段（`WRA` 表的 `WEAPONS_PER_SALVO`/`FIRING_RANGE`/`SELF_DEFENCE`，LuaDoctrine.cs:2995 附近有组装代码）的对应关系写进报告。
4. **读回对账同步**：现有"写后读回无效应报 *_no_effect"逻辑要逐行读回批量结果，任何一行写入失败都要报出哪行。
5. C# 单测：域名展开集合正确（air 域含 1999/2000-2199 段全部枚举）、旧短名兼容、非法枚举拒绝、读回对账、三个范围/齐射参数落表正确。

## 2. B 段：db3k.detail 增加性能子表（航速/油耗）

- **库实查结论（监理已做，直接用）**：速度不在主表——`DataPropulsionPerformance(ID, AltitudeBand, Throttle, Speed, AltitudeMin, AltitudeMax, Consumption)`，按 ID 与主表关联。实证：伯克 DDG-104（ID=3151）= 4 档：5/15/26/37 节 + 油耗 1.22/1.52/2.9/5.72。DataShip/DataAircraft 主表均无 Speed 列。
- **修法**：`db3k.detail` 返回增加 `propulsion` 段（该条目全部油门档行；无记录给空数组，不报错）。模板只增不改（参照 Q-048 D_*、Q-057 R_* 的只增纪律）；适用类型按表实际覆盖范围（ship/submarine/aircraft/groundunit 都查一遍，报告里给覆盖矩阵）。
- C# 单测：有记录条目返回档位齐全、无记录条目空数组、回归既有 detail 字段零变化。

## 3. C 段：scenario.save 授权根内子目录自动创建（纯 proxy，零编译）

- **现象**：面板 AI 另存想定到"主题子目录"失败——桥侧 `CanonicalScenePath.WalkRootToTarget` 要求中间目录全部存在，缺一级报 `path_missing`；AI 没有建目录能力。
- **修法**：`demo-ui/proxy/scenario-list.mjs` 的 `normalizeScenarioPathForBridge`（Q-060 刚上线）在 `scenario.save` 分支（非 load）换算通过后，对授权根内目标路径**自动 `fs.mkdirSync(dirname, {recursive:true})`**；`load` 分支不建目录（必须读已存在文件）；越界/含 `..` 依旧 fail-closed（先校验再建目录，顺序不能反）。
- 测试（追加到 `proxy/scenario-path-resolve.test.mjs`，`test:all` 清单不动条目只绿）：save 到不存在的两级子目录→建目录成功且路径放行；load 到不存在目录→不建目录、报不存在；越界路径→拒绝且**断言磁盘上没建出任何目录**。

## 4. 红线

- A/B 改 C# 但**不编译不部署**（监理攒编译波 4 统一做）；C 段可独立先行验收。
- 不改 .env、不连真桥、不起 F1；不动 Q-016 确认门 / Q-059 懒拉起 / guard.mjs / claimcheck。
- 模板只增不改；旧接口行为回归零变化。
- 完工前 C# `dotnet test` 相关用例绿 + proxy `npm run test:all` 绿（整单 runner 怪病犯了就分半跑，如实记录）。

## 5. 交付物

1. 代码改动 + 测试。
2. 完工报告 `D:\soft\F1-AI\LabConsole\outputs\完工报告-Q062-WRA域清零与detail性能子表-Cursor-20261021.md`：A 段回落语义因果链（文件:行号）、域名展开集合清单、B 段类型覆盖矩阵、C 段测试逐条结果、未碰项打勾。
3. 代码留工作区不提交，监理验收后统一入库。
