# 源码证据索引（F1 AI 助手）

> 证据基线：工作区提交 `48afb17bec4bef1b5a62444cd98fe5a29d573b65`。行号按当前工作区文本计数；反编译/混合 VB 风格源码后续变更会导致行号漂移，复核时以“文件 + 方法”优先。本文只陈述已验证源码事实；可行性结论明确标注为 **待 PoC**。

## E01：Lua 沙箱可执行脚本，但不是 AI 安全边界
- **位置**：`CMO-netcore-src/Command_Core/Lua/LuaSandBox.cs:L1014-L1035`。
- **事实**：`LuaSandBox.RunScript(string str, bool RunInteractively, ...)` 以 `Monitor.Enter(ScriptLockObj)` 串行化脚本入口，并进入 `_LuaSandbox` 执行分支。
- **推论**：可封装为受控执行后端；`ScriptLockObj` 仅保护该方法的脚本并发，**不能证明**场景对象、保存、推演和 UI 的整体线程安全。

## E02：存在 Lua 到推演步进的调用链
- **注册证据**：`LuaSandBox.cs:L331,L335` 将 `F1_RunSimulationForStep`、`F1_RunSimulationForStepAlt` 注册到 Lua。
- **实现证据**：`LuaSandBox.cs:L1888-L1913` 的 `LUA_F1_RunSimulationForStep(int steps)` 读取 `ClientCore.CurrentScenario`（L1898），循环调用 `ClientCore.Advance1Pulse`（L1902-L1911）。
- **替代实现**：`LuaSandBox.cs:L1917-L1933` 的 `...Alt` 直接循环调用 `GameGeneral.MainGameLoop(ref scenario)`（L1921-L1932）。
- **外部使用证据**：`CMO-netcore-src/Mod/ArchitecturalInterconnect.cs:L164-L169` 的 `ProcessSimStep()` 构造 `F1_RunSimulationForStep(10)`，并调用 `CurrentScenario.Scenario_LuaSandbox.RunScript(cmd, false)`。
- **调用链**：`ArchitecturalInterconnect.ProcessSimStep` → `Scenario_LuaSandbox.RunScript` → `LUA_F1_RunSimulationForStep` → `ClientCore.Advance1Pulse` → `GameGeneral.MainGameLoop`。
- **待 PoC**：不证明后台线程可调用、自然结束判定、可靠取消、运行态与编辑态切换，或长时间运行不阻塞 UI。

## E03：步进会触发核心循环及回调，线程模型未显式声明
- **位置**：`CMO-netcore-src/Command_Core/ClientCore.cs:L2342-L2389`。
- **事实**：`Advance1Pulse` 在 L2350 同步调用 `GameGeneral.MainGameLoop(ref theScen)`；L2379 写 `MustRefreshMainForm`；L2380-L2383 调 `TimeAdvanced?.Invoke`；L2385-L2388 调 `onAdvance1Pulsed()`。
- **风险依据**：回调是否访问 WinForms/WPF 控件、回调目标是否要求 UI 线程，源码片段未建立调度契约。因此文档中“所有 F1 操作经现有调度上下文串行”的设计是**建议**，不是现状事实，须由 T01.6 验证。

## E04：保存有 Core 入口也有 UI 对话分支
- **Core 入口**：`CMO-netcore-src/Command_Core/LoadSave/LoadSave.cs:L29` 为 `SaveScenario(Scenario, Side, string, bool, bool)`；`ClientCore.cs:L2090-L2106` 调用 XML/常规保存。
- **路径状态**：`ClientCore.cs:L158` 声明静态 `SaveScenarioPath`；`MainForm.cs:L50436-L50483` 在路径为空时显示 `SaveFileDialog`，并赋回 `SaveScenarioPath`；`MainForm.cs:L50532` 调 `ClientCore.SaveCurrentScenario`。
- **推论**：AI 不得调用会弹出对话框的保存路径；必须在任务启动时确认可写、已绑定的场景路径，并用无 UI 的 Core 保存入口。附件/运行态/重载的完整语义仍为 **待 PoC**。

## E05：已发现 SQLite 事件导出，不足以证明 CSV 合同
- **位置**：`CMO-netcore-src/Command_Core/EventExporter_Sqlite.cs:L17-L49,L63-L70`。
- **事实**：`EventExporter_Sqlite` 名称为 SQLite（L21-L23），维护 `ConcurrentQueue`（L25）、后台 `Thread ExportThread`（L38）和 `SQLiteConnection DBConn`（L33），`Start()` 于 L63 开始并设置 `IsStopped=false`（L70）。
- **结论**：源码确认一个 SQLite 导出器存在；**未确认** PRD 所称 CSV 导出入口、文件完成信号、表/字段稳定性。因此 `result.read` 必须设计为适配层，结果源在 T01.5 决定。

## E06：场景持有 SQLite DB 连接，DB3K 查询可复用但需只读外观
- **位置**：`CMO-netcore-src/Command_Core/Scenario.cs:L1303-L1318`。
- **事实**：`Scenario.DBConnection` 在 `_DBConnection` 为空且 `DBUsed` 非空时，通过 `DBOps.GetFileDBConnString(DBUsed)` 创建 `SQLiteConnection`（L1307-L1316）。
- **补充**：`CMO-netcore-src/Command_Core/DAL/DBFunctions.cs:L18-L22` 定义 `Command_Core.DAL.DBFunctions`；顶部引用 `System.Data.SQLite`（L7）。
- **待核验**：具体可供装备/武器/传感器检索的方法、是否参数化、数据库文件与权限策略。AI 层应只暴露固定、分页、参数化的查询，而不是任意 SQL。

## E07：主窗体是 DarkUI/WinForms 宿主
- **位置**：`CMO-netcore-src/Command/MainForm.cs:L56`：`MainForm : DarkSecondaryFormBase, IMainForm`；`MainForm.cs:L35617` 创建 `System.Windows.Forms.SaveFileDialog`。
- **结论**：AI 面板优先采用现有 DarkUI/WinForms 模式；项目是否在局部混用 WPF 由 `F1-App.csproj`（`UseWPF`/`UseWindowsForms`）确认。控件更新必须通过被 T01.6 验证的 UI 调度方式。