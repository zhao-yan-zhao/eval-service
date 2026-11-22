# ADR-000: T00 — 测试框架与 F1 Smoke Harness 决策

- **状态**：已接受并落地（C1–C4 已确认；空测试工程已创建且 `dotnet test` 通过）
- **日期**：2026-08-11
- **任务**：`TASKS.md` T00（P0）
- **范围**：仅测试选型与冒烟策略；不实现 AI 助手业务代码；不开始 T01

## 1. 背景

AI 助手开发需要可重复的自动化测试与受控 F1 冒烟。仓库文档（`TEST_PLAN.md` / `TASKS.md`）要求先完成 T00，确认：

1. `.NET 5` 兼容的单元测试框架；
2. 测试分层与自动化边界；
3. F1 GUI / 推演内核 Smoke Harness 的启动、隔离、超时与清理规范。

## 2. 已读取与核验的材料

### 2.1 项目文档

- `F1-AI助手-PRD-v1.2.md`
- `TECH_SPEC.md`
- `TASKS.md`
- `SOURCE_ANALYSIS.md`
- `DATABASE_DESIGN.md`
- `TEST_PLAN.md`
- `OPEN_QUESTIONS.md`

### 2.2 解决方案与工程

- `F1-AllInOne.sln`（含：`BasicDevTool`、`OSInterface/*`、`F1-DarkUI`、`F1-AllInOne`）
- `CMO-netcore-src/F1-AllInOne.csproj`（`net5.0-windows` WinExe，主解决方案构建入口）
- `CMO-netcore-src/F1-App.csproj`（`net5.0-windows` WinExe；**不在** `F1-AllInOne.sln`）
- `CMO-netcore-src/F1-Core.csproj`（`net5.0` 类库；**不在** `F1-AllInOne.sln`）
- `F1_Console/F1-Console.csproj`（`net5.0` Exe，`ProjectReference` → `F1-Core`；**不在** `F1-AllInOne.sln`）
- 输出目录 `F1/` 已存在 `F1.exe`、`F1-Console.exe`、`F1-Core.dll`、`IntelliLock.Licensing.dll`、`NLua`/`KeraLua`/`lua54.dll`、`System.Data.SQLite`/`SQLite.Interop.dll` 等运行时依赖

### 2.3 与“测试”相关的既有源码（非正式测试框架）

- `CMO-netcore-src/Command/RegressionTests.cs`：DarkUI 窗体“回归测试”，由 `MainForm` 菜单打开；**不是** `dotnet test` 项目
- `CMO-netcore-src/Command_Core/Lua/LuaUnitTests.cs`：空壳 `QueryUnitTests()`
- `CMO-netcore-src/Command_Core/TestUnit.cs`：领域类型 `Module_Unit.Unit` 子类，非测试

### 2.4 未发现

- `tests/` 目录
- `*Tests*.csproj` / `*Test*.csproj`
- 任何 `PackageReference` 到 xUnit / NUnit / MSTest / `Microsoft.NET.Test.Sdk`
- CI 流水线、`.runsettings`、`Directory.Build.props` 中的测试约定
- `docs/`（本 ADR 创建时新建）

### 2.5 本机 SDK 观察

- 已安装：`dotnet` SDK `5.0.408`（与目标框架一致）

## 3. 结论：仓库是否已有测试框架约定

**结论：无正式、可服从的自动化测试框架约定。**

依据：

1. 无测试工程、无测试 NuGet 包、无 `dotnet test` 入口；
2. 现有“回归测试”是 GUI 内嵌窗体，不可作为 AI 助手模块的 `dotnet test` 基线；
3. `TECH_SPEC.md` / `TEST_PLAN.md` / `TASKS.md` 均已预判“无现成测试骨架”，并默认建议 xUnit。

因此 T00 采用文档默认建议，而非迁移既有约定。

## 4. 测试框架选择

### 4.1 决策

| 项 | 选择 |
|---|---|
| 框架 | **xUnit** |
| 运行时 SDK | **Microsoft.NET.Test.Sdk** |
| 目标框架（纯逻辑） | **net5.0** |
| 断言 / 发现 | xUnit 内置 + `xunit.runner.visualstudio` |
| 覆盖率包 | **本阶段不引入**（避免额外大型依赖；后续按需） |

### 4.2 依据

1. `TASKS.md` T00 / `TEST_PLAN.md` 在无既有约定时明确推荐该组合；
2. 与仓库主目标框架 `.NET 5` 兼容；本机已有 SDK 5.0.408；
3. xUnit 适合并行友好的纯逻辑测试；AI 编排状态机、Schema、摘要等天然适合 Fact/Theory；
4. 不引入 NUnit/MSTest 双轨，降低认知与 CI 成本。

### 4.3 建议包版本基线（空项目落地时采用；可微调）

> 版本以“仍支持 net5.0、体积小”为原则；精确锁定 **待确认**（见第 8 节）。

建议起点：

- `Microsoft.NET.Test.Sdk`：`17.3.2`（或同代仍支持 net5 的补丁版）
- `xunit`：`2.4.2`
- `xunit.runner.visualstudio`：`2.4.5`

### 4.4 明确不选

- **不以** GUI `RegressionTests` 作为自动化框架；
- **不**在 T00 引入 Playwright / Appium / SpecFlow 等 GUI 自动化栈；
- **不**在 T00 引入大型 mock/DI 框架（后续 AI 代码落地时再按需）。

## 5. 测试分层

与 `TEST_PLAN.md` 对齐，固化为四层：

| 层 | 建议项目路径 | 测什么 | 依赖边界 |
|---|---|---|---|
| L1 纯逻辑单元测试 | `tests/F1.AiAssistant.Tests/` | 状态机、轮次/超时/重试、Schema、指纹、脱敏、摘要裁剪、Lua 策略校验器（纯函数） | **禁止**引用 `F1-App` / `F1-AllInOne`；未来仅引用独立 `AiAssistant` 类库（尚不存在）；编排层依赖 `IF1AutomationFacade` 的 fake |
| L2 文件/SQLite/DPAPI 集成测试 | `tests/F1.AiAssistant.IntegrationTests/` | `assistant.db` 迁移、原子备份、DPAPI、临时目录隔离、本地 SSE mock server | 可用 `System.Data.SQLite` / 临时目录；DPAPI 仅 Windows；**不**启动 F1 GUI |
| L3 F1 GUI / 推演内核 Smoke | `tests/F1.AiAssistant.Smoke/` | 隔离副本加载场景、受控变更、保存/回滚、步进、超时退出、日志收集 | 进程级驱动 `F1.exe` 和/或 `F1-Console.exe`；默认 **Trait=SpecialMachine**；不污染源场景 |
| L4 外部模型联调 | 可暂挂在 Integration 或独立手册用例 | DeepSeek / 量界智算 / 本地模型真实 SSE + tool-call | 需要账号与网络；**禁止**进入默认 `dotnet test` |

> T00 空骨架优先落地 L1；L2/L3 可同批建空项目或分批——见下方修改计划（待你确认）。

## 6. 自动化边界

### 6.1 默认可自动运行（开发机 / 未来 CI）

- L1：`dotnet test` 纯逻辑；
- L2 中不依赖 GUI/许可证/真实模型的部分：SQLite 迁移、临时文件备份、HTTP SSE fake、工具参数拒绝；
- Mock 编排：只打 `IF1AutomationFacade` fake（按 `TEST_PLAN.md`）。

### 6.2 仅专机或人工 Smoke

以下默认 **不** 进入无头 CI；必须显式 Trait / 手册执行，并保留日志（必要时录屏）：

| 类别 | 原因 |
|---|---|
| F1 GUI 冒烟（`F1.exe` + WinForms/WPF） | UI 线程、交互对话框、DPI/DarkUI 宿主 |
| 推演内核真实步进 / 长跑 | 原生依赖（`lua54`/`NLua`）、GIS/`LandCover`、全局场景状态；停止/线程模型 **待 PoC**（`OPEN_QUESTIONS` P0-1） |
| 许可证相关路径 | `IntelliLock.Licensing` 存在；专机许可状态 **待确认** |
| 真实模型联调 | PRD Q1/Q2 凭据未齐；外网与数据外发策略 |
| DB3K 只读大库查询（若依赖受许可/大文件分发） | 测试资产与权限 **待确认** |

### 6.3 分类标签约定（Smoke / Integration）

建议 xUnit Trait：

- `Category=Unit` — 默认跑
- `Category=Integration` — 默认可跑（Windows）
- `Category=Smoke` + `SpecialMachine=true` — 专机
- `Category=ExternalModel` — 凭据门控，人工/专机

示例过滤：

```text
dotnet test tests/F1.AiAssistant.Tests --filter Category=Unit
dotnet test --filter "Category!=Smoke&Category!=ExternalModel"
```

## 7. Smoke Harness 策略

### 7.1 目标（对应 T00 验收）

Harness 必须能够：

1. 在**隔离工作副本**上加载场景；
2. 收集日志（stdout/stderr + F1 写入日志路径若可定位）；
3. **超时退出**；
4. **不污染源场景**（源文件 hash 不变）。

### 7.2 推荐形态（进程级 Harness，而非进程内引用 WinExe）

```text
测试编排（Smoke 项目 / 脚本）
  → 复制源 .scen 到临时工作目录（唯一 run_id）
  → 启动宿主进程（候选见下）并传入工作副本路径
  → 监控心跳/日志；超时则尝试优雅停止，失败则终止进程
  → 断言：源 hash 不变；工作副本与日志落盘；清理临时目录（失败时保留现场）
```

**候选宿主（优先级与状态）：**

| 优先级 | 宿主 | 现状 | 用途 |
|---|---|---|---|
| A | `F1/F1-Console.exe` | 已存在；支持命令行加载场景等参数（`MyConsoleApplication.ProcessArgs`） | 优先评估为**无 GUI** 推演/加载冒烟宿主 |
| B | `F1/F1.exe` | GUI WinExe | UI 响应、菜单、保存对话框规避等 GUI 专机冒烟 |
| C | 未来 `IF1AutomationFacade` 进程内 PoC | 尚不存在；属 T01 范围 | 产品化后的正式自动化入口 |

> **待确认**：A 是否满足 T01 所需的保存/步进/停止/结果读取；若不满足，不得假设可替代 GUI。T01.6 UI 响应性必须以 B 或正式 GUI 路径验证。

### 7.3 启动 / 清理规范（草案）

1. **工作根目录**：`%TEMP%\F1.AiAssistant.Smoke\{run_id}\`（或仓库外专用盘；**路径最终待确认**）
2. **输入**：只读源场景目录 → 复制为 `working\`；记录 `source_hash` / `working_hash`
3. **环境**：工作目录设为 `F1\` 旁或显式设置，保证原生 DLL 可解析；**不得**改写仓库内源场景
4. **超时**：PoC 级默认 60s（与 T01 一致）；产品级时限属 PRD，不在 T00 固化
5. **退出**：先发取消/停止信号（若 API 可得）→ 等待 ≤10s → `Kill` 进程树 → 检查无残留
6. **产物**：`smoke-log.jsonl`（run_id、hashes、exit_code、elapsed_ms、exception）
7. **清理**：成功可删临时目录；失败保留现场供 T01 分析

### 7.4 与 T01 的边界

- T00 **只定义**框架与 Harness 规范；
- T01.* 才在 Harness 上跑真实最小场景 PoC；
- 若 GUI/许可证导致无法无头运行：GUI smoke **显式标为专机人工测试**（本 ADR 第 6.2 节），不得假装 CI 绿灯。

## 8. 确认项与剩余待确认

### 8.1 已确认（2026-08-11）

| ID | 结论 |
|---|---|
| C1 | 新建独立 `tests/F1.AiAssistant.sln`，**暂不**加入 `F1-AllInOne.sln` |
| C2 | 同批三个空项目：Tests / IntegrationTests / Smoke |
| C3 | 锁定 `Microsoft.NET.Test.Sdk 17.3.2`、`xunit 2.4.2`、`xunit.runner.visualstudio 2.4.5` |
| C4 | 批准 `F1-Console` 为 L3 默认无 GUI Smoke **候选宿主**；仅记录与后续探测，**禁止**修改 `F1-Console` 源码 |

### 8.2 仍待确认

| ID | 问题 | 影响 |
|---|---|---|
| C5 | 专机许可：自动化启动 `F1.exe` / `F1-Console.exe` 是否需要有效 IntelliLock 许可？CI/共享机是否具备？ | 能否自动化 Smoke |
| C6 | 可分发最小测试场景（`.scen`）路径与是否可进仓库？ | T01.1 前置 |
| C7 | L2 是否允许在测试中使用 `System.Data.SQLite` 与 Windows DPAPI（与 `OPEN_QUESTIONS` P2-9 相关）？ | Integration 范围 |
| C8 | 未来 `AiAssistant` 代码落在独立类库还是先挂 `F1-AllInOne`/`F1-App`？影响 Tests 的 `ProjectReference` 策略 | 引用方式 |

## 9. 空测试项目落地状态（已执行）

> C1–C4 已确认并落地。独立解决方案：`tests/F1.AiAssistant.sln`（**未**修改 `F1-AllInOne.sln`）。

### 9.1 已创建项目

| 项目 | 路径 | TFM | NuGet（锁定） | 引用 F1-App/Core/AllInOne | 哨兵 |
|---|---|---|---|---|---|
| A | `tests/F1.AiAssistant.Tests/` | `net5.0` | Test.Sdk 17.3.2 / xunit 2.4.2 / runner 2.4.5 | 否 | `Framework_IsWired`（Category=Unit） |
| B | `tests/F1.AiAssistant.IntegrationTests/` | `net5.0-windows` | 同上 | 否 | `Framework_IsWired`（Category=Integration） |
| C | `tests/F1.AiAssistant.Smoke/` | `net5.0-windows` | 同上 | 否 | `Framework_IsWired_SpecialMachine`（`Skip` + Category=Smoke + SpecialMachine=true） |

### 9.2 验证命令

```text
dotnet test tests/F1.AiAssistant.sln -c Debug
```

预期：Unit + Integration 通过；Smoke 默认 Skip，不进入失败路径。

### 9.3 明确不做（仍适用）

- 不修改 `CMO-netcore-src/**` 与 `F1_Console/**` 生产源码；
- 不新增 AI 助手业务代码；
- 不开始 T01 PoC；
- 不把 Smoke 计入默认绿灯（已用 Skip 保证）。

## 10. 决策摘要

1. **无既有自动化测试约定** → 采用 **xUnit + Microsoft.NET.Test.Sdk**，目标 **net5.0**。
2. **四层测试**：Unit / Integration / F1 Smoke / External Model；默认自动化仅 Unit + 无 GUI 的 Integration。
3. **Smoke = 进程级隔离副本 Harness**；优先评估 `F1-Console.exe`，GUI/`F1.exe` 与真实推演标为专机；许可证与可无头性 **待确认**。
4. **空测试项目计划已备妥，等待确认 C1–C3（及可选 C2）后再改 sln/csproj。**

## 11. 后续

- 你确认第 8–9 节后：创建空项目并跑通 `dotnet test`（完成 T00 工程验收项）。
- 然后才能进入 **T01.1**（最小场景加载 PoC）。
