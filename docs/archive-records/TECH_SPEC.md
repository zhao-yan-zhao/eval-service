# F1 推演系统 AI 助手技术方案

> **准绳 PRD**：`F1-AI助手-PRD-v1.3.md`（V1.2 仅存档）。技术选型与知识库形态见 `docs/ADR/002-technology-selection.md`（Q13/Q14）。

## 1. 项目理解
### 目标、角色、流程与约束
- **目标**：在 F1 Windows 桌面程序内，以中文对话驱动“读场景/改场景或 Lua/保存/运行/读结果/再调整”的单实例自动闭环；不得退化为人工启动推演。
- **角色**：仅本机使用者，无账号、无角色分级；模型不是授权主体，只能调用注册工具。
- **主流程**：提交任务→锁定当前场景→建立任务基线备份→模型规划及工具调用→必要时修改/保存→运行→导出并解析结果→判定或下一轮→解锁并输出摘要。暂停须解锁；恢复须重新读取场景。中断须停止后续动作并保留记录。
- **硬约束（PRD）**：默认最多 5 轮（1–20）、单轮 60 分钟、任务 3 小时、同错重试 3 次；任务级回滚；备份 50 个/30 天/5GB；会话日志永久（手动删）；仅中文；外网首用提醒；API key 不入日志。

### 1.1 V1 技术选型（已确认，不得擅自偏离）
- **编排**：V1 使用 **C# 原生任务状态机**与闭环编排（`TaskOrchestrator`），大脑/手接口分离（编排 ↔ `IF1AutomationFacade` / `ToolRegistry`）。
- **模型与基础设施**：沿用既有设计——`System.Net.Http`（OpenAI 兼容 SSE）、`CancellationToken`、工具注册表、JSON Schema、独立 SQLite（`assistant.db`）、Windows DPAPI。
- **明确不引入**：LangGraph、Python 工作流运行时、任何外部工作流引擎；**V1 不引入 Semantic Kernel**（无对应 NuGet 依赖）。
- **Semantic Kernel 再议门槛**：仅当原生状态机出现可证据化瓶颈，且经 **独立 ADR** 评估并获 owner 批准后，才重新考虑；不得作为当前实现默认项。扩展路线为 **.NET 优先**。
- **全自动闭环**：本选型不改变 PRD 硬性要求；不得降级为“AI 只写文件、人手动执行”。

## 2. 现有代码库分析（基于已读取源码）
### 技术栈与构建
- `.NET 5`：`CMO-netcore-src/F1-App.csproj` 是 `net5.0-windows` WinExe，同时启用 WinForms/WPF，启动对象 `Command.My.MyApplication`，输出 `../F1`。
- 核心库：`F1-Core.csproj`（`net5.0`）；应用项目引用已编译的 `F1-Core.dll`、`F1-DarkUI.dll` 等。项目含 `F1-AllInOne.sln`、`DarkUI`、`BasicDevTool`。
- UI 为 `Command/`、`forms/`、`Map/` 等目录，DarkUI 控件在 `DarkUI/`；推演领域逻辑在 `Command_Core/`；扩展/桥接已有 `Mod/ArchitecturalInterconnect.cs`。未在根目录发现标准单元测试项目（**待完整构建核验**）。
- 数据：`System.Data.SQLite`、`CsvHelper`、NLua/KeraLua 已是编译依赖（见 `F1-App.csproj`）。

### 与 PRD 直接相关的现有能力
| PRD 能力 | 状态 | 依据与结论 |
|---|---|---|
| 当前场景/Lua 执行 | 部分存在 | `Command_Core/ClientCore.cs` 持有 `CurrentScenario`；`Scenario.Scenario_LuaSandbox` 延迟创建；`LuaSandBox.RunScript` 可执行脚本，事件动作 `EventAction_LuaScript` 也调用它。需封装为受控工具，不能把任意 Lua 直接暴露给模型。 |
| 场景修改 | 部分存在 | Lua 沙箱注册大量 `ScenEdit_*` API（`LuaSandBox.cs`），`LuaEvent.cs` 可管理 Lua 事件动作/条件。缺少 AI 变更事务、白名单策略、结构化差异和统一错误契约。 |
| 保存/加载 | 部分存在 | `Command_Core/LoadSave/LoadSave.cs`、`ScenContainer`、`ClientCore.HandleScenarioLoaded` 等路径已存在。要确认“保存当前编辑态”的线程/模式前置条件。 |
| 推演驱动 | 部分存在，但高风险 | `LuaSandBox.LUA_F1_RunSimulationForStep` 使用 `ClientCore.Advance1Pulse`；`...Alt` 调用 `GameGeneral.MainGameLoop`；`Mod/ArchitecturalInterconnect.cs` 已调用 `F1_RunSimulationForStep(10)`。这推翻了 PRD 中“完全无驱动代码”的绝对表述，但尚非稳定异步任务 API。阻塞、UI 线程、停止与完成判定必须 PoC。 |
| 结果导出 | PoC 已裁定 | **权威结果源 = CSV**（T01.5）；完成信号 = `Game.Pause()` + `CsvExporter.QueueLength==0`。SQLite exporter 仅旁路，不作 `result.read` 合同。 |
| DB3K 查询 | 部分存在 | `Scenario.DBConnection`、`DBOps` 注册 DB3K，`DAL/DBFunctions.cs` 已提供平台/武器/传感器等查询。需加只读、参数化、分页、结果脱敏/截断的工具外观。 |
| 主界面嵌入 | 需要新增 | `Command/MainForm.cs` 是关键宿主；没有发现 AI 面板、会话或模型客户端模块。需按 DarkUI 模式新增菜单、停靠/子窗体、聊天视图。 |
| 模型/SSE、会话、日志、备份、闭环 | 需要新增 | 未发现 OpenAI 客户端、任务状态机、AI 专用存储和回滚模块。 |

### 风险、冲突及建议
1. **M3 可行性（已更新）**：阶段一 PoC（T00～T01.6）已 **Go**（见 ADR-003）。产品化仍须遵守后台脉冲 + UI 封送；内嵌面板真实心跳待 T08 补测。失败不得降级为人工执行。
2. **Lua 安全边界冲突**：PRD 的“模型生成 Lua 后执行”与工具白名单存在冲突。模型默认不能提交自由 Lua；只能调用结构化工具。若必须使用 Lua，只能由 C# 根据审核过的固定模板生成，并由 `LuaPolicyValidator` 作为第二道拒绝层。
3. **并发/线程风险**：`CurrentScenario`、NLua、`Advance1Pulse` 看起来是全局/可变状态，不可并发。引入单一 `ScenarioExecutionGate`，所有读写/运行在现有 F1 调度上下文串行执行；网络与 CSV 解析后台执行，UI 仅 `BeginInvoke`。
4. **PRD“思考日志”风险**：不应要求或存储模型隐藏推理。记录可审计的计划摘要、工具调用、参数摘要、返回摘要、错误、轮次和最终依据；满足可追溯而不依赖隐式思维链。
5. **模型协议不确定**：OpenAI 兼容不保证 tool-call/SSE 字段一致；量界智算必须最小联调。应让 `IModelProvider` 返回内部统一事件，不让供应商格式进入任务引擎。

## 3. 总体架构与模块划分
```text
DarkUI AI 面板/设置/历史/日志
  → AiApplicationFacade（UI 调度、状态投影）
  → TaskOrchestrator（状态机、轮次/超时/取消、摘要）
     ├→ IModelProvider（OpenAI-compatible SSE + adapters）
     ├→ ToolRegistry / ToolPolicy
     │  └→ F1AutomationFacade（唯一 Core 访问入口）
     │     ├→ ScenarioGateway / LuaGateway / SimulationGateway
     │     ├→ ResultGateway / Db3kQueryGateway
     │     └→ ScenarioExecutionGate
     └→ AiStore（SQLite/JSON 元数据）+ BackupService + AuditLog
```
- 新增独立 `CMO-netcore-src/AiAssistant/`，分为 `Domain`（任务、会话、审计 DTO）、`Application`（编排）、`Infrastructure`（HTTP、文件、SQLite）、`F1Integration`（唯一依赖 `Command_Core` 的适配器）、`UI`（仅应用项目引用）。避免在 `Scenario`、`LuaSandBox` 直接混入模型代码。
- **状态机（C# 原生）**：`Queued → Planning → Locked → ExecutingTool/WaitingSimulation → Paused → Completing → Completed|Failed|Cancelled|TimedOut`；状态转移和解锁用 `try/finally`，每次转移落审计。实现位于 `AiAssistant/Application`，**不**依赖 LangGraph / Semantic Kernel / 外部工作流引擎。

### 3.1 知识包与检索预留（Q14）
- **V1**：本地**静态、版本化知识包**（目录建议 `F1/AiAssistant/knowledge/`），包含：
  - `manifest`（版本号、文件清单、兼容范围、校验信息）
  - 知识文件与示例（CMO Lua 规范、常见坑、经验等）
- **接口**：预留 `IKnowledgeSource`（或等价）只读接入编排/提示组装；V1 实现可为“按 manifest 加载文件 + 简单按 id/标签取用”，**不**实现向量数据库、Embedding、自动检索流水线或知识库后台管理。
- **安全**：知识包**不能**绕过工具白名单与安全校验；不得提供“执行知识包内任意脚本/命令”的旁路。知识仅作上下文材料；改场景/跑推演必须经 `ToolRegistry`。
- **后续**：检索式知识库（RAG）属第二版候选，只替换 `IKnowledgeSource` 实现，不改闭环状态机合同。

## 4. 核心数据与接口设计
### 本地表/文件
- `ai_settings`：provider、base_url、model、加密密钥密文、外发确认、轮次/时限/保留策略。
- `ai_sessions`、`ai_messages`：会话、角色、正文/摘要、token 估计、创建时间、删除标记。
- `ai_tasks`：task_id、session_id、scene_path、scene_fingerprint、状态、轮次、时间限制、基线备份、结果摘要、错误码。
- `ai_task_steps`：序号、类型（plan/tool/run/result）、请求/响应摘要、开始/结束、结果、重试号、关联备份、不可篡改 hash 链。
- `ai_backups`：备份 id、任务/步骤、原路径、备份路径、大小、hash、创建时间；备份二进制放 `F1/AiAssistant/backups/YYYY/MM/`，元数据放 SQLite。目录按 PRD 为 `F1/AiAssistant/{data,logs,backups,knowledge}`。

### 工具契约（模型看见的仅为 JSON Schema）
- `scenario.get_summary(scope, max_items)`：结构化阵营/单元/任务/事件摘要，不返回整文件。
- `unit.add(...)`、`unit.update_position(...)`、`mission.create_or_update(...)`、`doctrine.set(...)`、`event.upsert(...)`：模型仅提交受 JSON Schema 约束的结构化参数；网关校验 fingerprint/范围/数量后直调 Core，或由 C# 选用固定 Lua 模板执行。
- `scenario.save()`：保存并校验落盘指纹。
- `simulation.run(duration, speed, termination_condition)` / `simulation.stop()` / `simulation.status()`：异步 job 状态，内部使用既有步进/主循环 PoC 选定实现。
- `result.read(run_id, filters, aggregation)`：流式解析导出数据，返回指标、样本与文件引用。
- `db3k.search(entity_type, query, filters, limit)`：只读、参数化、最多 N 条。
- 工具不接受任意文件路径或 shell 命令；路径由任务绑定场景及受控导出目录推导。

### 外部模型接口
`IModelProvider.StreamAsync(ModelRequest, CancellationToken)` 产出 `TextDelta | ToolCall | Usage | Completed | Fault`。实现基于 **`System.Net.Http`** 对 `POST {base_url}/chat/completions` 做 SSE 消费；**不**使用 Semantic Kernel 或 Python 客户端。先适配 text + function/tool call 两种常见响应；若供应商无工具调用，**不可默默降级**，而是在联调结论中确认是否允许受控 JSON 指令协议。

## 5. 安全、可靠性、性能、测试与部署
- **密钥**：Windows DPAPI `ProtectedData`（当前用户范围）；UI 仅显示掩码；日志按字段名单脱敏。外网首切由 `ExternalDataNoticeAcknowledged` 持久化。
- **错误**：统一 `AiError {Code, UserMessage, Retryable, DiagnosticId}`；网络限流指数退避，模型参数/Lua 错误最多 3 次，磁盘/备份/写场景失败为安全阻断；终止时收集 Lua/推演现场且不得覆盖原错误。
- **一致性**：任务启动时取得场景锁与 fingerprint；暂停释放锁；恢复重新读取并更新版本；每次可变工具先创建原子备份（临时文件、hash、rename）。回滚要求目标场景未锁定且与任务绑定，恢复后重新加载/刷新。
- **性能**：HTTP/SSE 和 CSV 流式读取后台；CSV 仅聚合关键事件并将原始文件以引用保留；DB 查询分页、缓存稳定元数据；任务单实例串行。
- **测试**：纯逻辑单元测试、文件/SQLite 集成测试、模型 Mock SSE、F1 驱动 PoC/冒烟、真实供应商联调和验收 A1–A16；详见 `TEST_PLAN.md`。
- **迁移**：新增库和文件夹不改现有场景格式；首次启动创建 schema（含版本迁移）；先 feature flag `AiAssistant.Enabled=false` 发布，M3 PoC 与回滚演练通过后开启。需提供离线安装包包含依赖，不引入运行时在线安装。

## 6. 设计补充（可复核性、安全边界与数据库）
### 6.1 源码事实与待验证结论的边界
- 全部文件、方法、行号、调用链和“事实/待 PoC”标记见 `SOURCE_ANALYSIS.md`。本方案以该文件为可复核索引；行号基线为 Git `48afb17bec4bef1b5a62444cd98fe5a29d573b65`。
- 已验证事实：`LuaSandBox.RunScript` 存在脚本锁；`F1_RunSimulationForStep` 经 `Advance1Pulse` 调 `GameGeneral.MainGameLoop`；`ArchitecturalInterconnect.ProcessSimStep` 已实际从 Lua 调十步；SQLite 事件导出器存在后台线程。具体证据为 E01–E06。
- 未验证结论（产品化前仍须在对应任务补证据）：内嵌助手面板内真实 UI 心跳（T08/A1）、三源真实联调（Q1/Q2）、业务场景成功指标。T01 已给出：后台步进选型、软停、CSV 结果合同、线程封送契约；不得回退为“未证实则降级人工”。

### 6.2 场景编辑的强制安全模型
- 模型默认不能提交自由 Lua；只能调用结构化工具。若必须使用 Lua，只能由 C# 根据审核过的固定模板生成，并由 `LuaPolicyValidator` 作为第二道拒绝层。
- 模型可见工具包括：`unit.add`、`unit.update_position`、`mission.create_or_update`、`doctrine.set`、`event.upsert`、`scenario.get_summary`、`scenario.save`、`simulation.*`、`result.read`、`db3k.search`。
- 每个结构化工具定义 JSON Schema、可操作对象范围、字段取值范围、最大批量数和预期场景 fingerprint；`F1AutomationFacade` 在场景锁内校验后优先直调现有 Core API。`LuaPolicyValidator` 不构成安全沙箱；无法映射到审核模板的需求必须要求用户澄清或停止任务。

### 6.3 数据库实现约束
- `DATABASE_DESIGN.md` 是 T02 的实现合同，规定 schema 版本表、迁移顺序、失败回滚、字段类型、主外键、索引、软删、hash 链和备份引用。
- AI 元数据使用独立 `assistant.db`，不得共享 `Scenario.DBConnection`；任务状态以 `row_version` 乐观锁保护，场景操作以文件原子备份与 DB 审计事务组合保证可恢复。