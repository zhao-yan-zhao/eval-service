# F1 AI 助手实施任务清单

> 前置原则：所有任务保持“自动闭环”目标；M3 可行性失败必须上报，不得以人工执行替代。  
> **准绳 PRD**：`F1-AI助手-PRD-v1.3.md`。编排/知识选型见 `docs/ADR/002-technology-selection.md`（C# 原生；不用 LangGraph；V1 不用 Semantic Kernel；静态知识包 + `IKnowledgeSource` 预留）。  
> **阶段一**：T00～T01.6 已完成并 **Go**；下一项产品开发待 owner 批准后从 T02 起。

## T00 — 测试框架与 F1 Smoke Harness 决策（P0）
- **目标**：确认 `.NET 5` 兼容的测试框架和可重复的 F1 冒烟方式；默认建议 xUnit + `Microsoft.NET.Test.Sdk`，若仓库已有约定则服从约定。
- **涉及模块**：`F1-AllInOne.sln`、`CMO-netcore-src/*.csproj`；建议新增 `tests/F1.AiAssistant.Tests/`、`tests/F1.AiAssistant.Smoke/`。
- **前置依赖**：无。
- **产出物**：测试选型 ADR、可运行空测试、Smoke 启动/清理规范和本地命令。
- **验收**：`dotnet test` 能执行纯逻辑测试；Harness 可在隔离副本加载场景、收集日志、超时退出且不污染源场景。
- **风险**：GUI/许可证/原生依赖可能无法无头运行；此时 GUI smoke 必须显式标为专机人工测试。

## T01.1 — PoC：场景加载、识别与隔离基线
- **目标**：以最小 `.scen`（蓝红各 1 单元、无附件、10 脉冲小于 60 秒）验证加载、源路径、fingerprint、场景摘要和临时工作副本。
- **依据/涉及模块**：`ClientCore.CurrentScenario`、`LoadSave`、`SOURCE_ANALYSIS.md` E04。
- **前置依赖**：T00、可分发测试场景。
- **产出物**：JSONL：`run_id/source_hash/working_hash/scene_title/unit_count/start_utc`。
- **验收**：连续三次摘要一致且源文件 hash 不变。
- **风险点**：当前场景可能没有保存路径。

## T01.2 — PoC：受控变更、保存与回滚
- **目标**：用固定结构化命令或审核模板修改一个非破坏性参数，验证保存、重载、回滚；禁止自由模型 Lua。
- **依据/涉及模块**：`LuaSandBox.RunScript`（E01）、无 UI 保存入口（E04）。
- **前置依赖**：T01.1。
- **产出物**：变更前后 fingerprint、备份 hash、回滚 hash、错误日志。
- **验收**：连续三次“变更→保存→重载→回滚→重载”成功，回滚 hash 等于基线且不弹保存对话框。
- **风险点**：保存语义或附件未明确。

## T01.3 — PoC：自动步进与进度可观测性
- **目标**：在选定执行上下文运行 10 与 100 脉冲，验证时间推进与可观测进度。
- **依据/涉及模块**：`LUA_F1_RunSimulationForStep`、`Advance1Pulse`、`MainGameLoop`（E02/E03）。
- **前置依赖**：T01.2。
- **产出物**：每 10 脉冲 JSONL：`requested_steps/completed_steps/time_before/time_after/elapsed_ms/exception`，以及候选实现选型记录。
- **验收**：10、100 脉冲各连续三次成功，时间单调推进；60 秒无进度或异常被吞没即失败。
- **风险点**：`Advance1Pulse` 和 `MainGameLoop` 不得在无证据情况下混用。

## T01.4 — PoC：取消、超时与运行态恢复
- **目标**：验证长运行可取消并恢复可保存/编辑状态；PoC 超时为 60 秒，仅用于验证，不替代 PRD 的 60 分钟。
- **前置依赖**：T01.3。
- **产出物**：取消请求/确认/最终状态、残留线程进程检查、停止后保存检查 JSONL。
- **验收**：连续三次取消后 10 秒内结束，无残留 job、无 UI 卡死、场景锁释放。
- **风险点**：若必须杀 F1 进程才停止，M3 为阻塞风险，立即上报。

## T01.5 — PoC：结果导出与指标读取
- **目标**：确认 CSV、SQLite 或其他真实结果源，定义 run 关联、完成信号、字段语义与最小指标。
- **依据/涉及模块**：`EventExporter_Sqlite`（E05）。
- **前置依赖**：T01.3。
- **产出物**：结果源合同、样例、读取器 spike、每次运行的事件数和目标指标。
- **验收**：连续三次区分旧结果和当前 `run_id` 结果；无法确认完成信号则失败。
- **风险点**：~~PRD CSV 与 SQLite exporter 不确定~~ → **已裁定：权威源=CSV**（见 `docs/notes/t01.5-result-source-contract.md`）。

## T01.6 — PoC：UI 响应性、线程模型与 Go/No-Go
- **目标**：验证运行期间 UI 响应，确认 `TimeAdvanced/onAdvance1Pulsed` 回调的线程要求，输出 M3 闸门结论。
- **依据/涉及模块**：`ClientCore.Advance1Pulse`（E03）、`MainForm`（E07）。
- **前置依赖**：T01.1–T01.5。
- **产出物**：线程 ID、250ms UI 心跳、最大响应延迟、能力矩阵、Go/No-Go ADR。
- **验收**：100 脉冲期间 UI 心跳不连续丢失超过 2 秒；T01.1–T01.6 全通过才可产品化 PoC 代码。
- **风险点**：跨线程异常或 UI 冻结即判定当前路径不可用；临时代码仅放 `poc/`，失败则删除、保留日志/ADR。
- **状态**：已完成，建议 Go（`docs/ADR/003-t01.6-go-nogo.md`）。

## T02 — 定义 AI 基础域模型与本地迁移
- **目标**：落地会话、消息、任务、步骤、备份、设置与状态机模型。
- **涉及模块**：新建 `CMO-netcore-src/AiAssistant/{Domain,Infrastructure}`；更新对应 `.csproj`。
- **前置依赖**：T01.6 Go 结论、`DATABASE_DESIGN.md`。
- **产出物**：SQLite schema/migration、DTO、枚举、repository、程序目录初始化器。
- **验收**：首次启动建库；迁移幂等；会话/任务/审计可重启恢复；无密钥明文。
- **风险**：程序集引用/输出目录与现有 DLL 引用方式不一致。
- **状态**：已完成（2026-08-12）；证据 `runs/T02-execution-record.md`。

## T03 — 场景锁、备份、回滚与变更事务
- **目标**：实现单实例互斥、fingerprint、任务基线/改动前备份、任务级回滚与清理策略。
- **涉及模块**：新建 `AiAssistant/F1Integration`、`Infrastructure/BackupService`；对接 `ClientCore`/`LoadSave`。
- **前置依赖**：T01.6、T02。
- **产出物**：`ScenarioExecutionGate`、`ScenarioLockService`、原子文件备份器、回滚服务、保留清理 job。
- **验收**：运行中编辑被阻止；暂停后可编辑；恢复必重读；回滚可正常加载；50/30天/5GB策略生效。
- **风险**：当前场景可能未落盘、文件锁或保存格式存在附属资源。
- **状态**：已完成（2026-08-12）；证据 `runs/T03-execution-record.md`。

## T04 — F1 自动化网关与受控工具集
- **目标**：把现有 F1 能力转换为可审计、结构化、受限的工具，不让模型触碰全局对象。
- **涉及模块**：`AiAssistant/F1Integration/*`；`LuaSandBox`、`DBFunctions`、事件导出相关代码。
- **前置依赖**：T01.6 Go 结论、T03。
- **产出物**：`IF1AutomationFacade`、结构化场景工具、保存/运行/结果/DB3K 工具、JSON Schema、固定 Lua 模板库。
- **验收**：模型只能调用结构化工具；非法路径、任意 Lua/命令均拒绝并审计；每个可变工具自动备份；DB 查询只读且限量。
- **风险**：`LuaPolicyValidator` 不可作为沙箱；自由 Lua 不进入 V1 工具协议。
- **状态**：已完成（2026-08-12）；证据 `runs/T04-execution-record.md`（Facade 现为内存实现，接口可替换为 Core）。

## T05 — 推演任务执行器与结果读取
- **目标**：把 T01 选定机制封装为可取消/可超时/可查询的异步 simulation job，解析事件结果为指标。
- **涉及模块**：`AiAssistant/F1Integration/SimulationGateway`、`ResultGateway`；既有 `GameGeneral`/`EventExporter_*`。
- **前置依赖**：T01.6、T04。
- **产出物**：状态轮询、超时/停止、现场收集、**CSV** 导出适配器和聚合器（SQLite 不作结果合同）。
- **验收**：60 分钟/总时限可配置；终止无残留；万行结果不阻塞 UI；导出缺失错误可诊断。
- **风险**：完成信号与 TimelineID 隔离须遵守 T01.5 合同。

## T06 — 模型接入、SSE 与密钥安全
- **目标**：实现可切换本地/DeepSeek/量界智算的统一 OpenAI 兼容提供方；**使用 C# 原生 `System.Net.Http` + SSE 解析**，不引入 Semantic Kernel 或 Python 客户端。
- **涉及模块**：`AiAssistant/Infrastructure/Models`、`ai_settings`、设置 UI。
- **前置依赖**：T02；Q1/Q2 用于最终联调。
- **产出物**：`IModelProvider`、原生 HTTP/SSE 解析、工具调用适配、DPAPI 密钥仓库、连接测试和外发确认。
- **验收**：Mock SSE 与三源（凭据提供后）均能流式对话/工具调用；401/429/超时可区分；日志不含 key。
- **风险**：供应商 tool calling 兼容差异；**禁止**为“方便”提前引入 SK。

## T07 — 闭环编排、摘要与审计
- **目标**：以 **C# 原生任务状态机**自动多轮调用模型和工具，执行限额、暂停/恢复/中断及上下文压缩；**不**使用 LangGraph、Python 工作流或外部工作流引擎。
- **涉及模块**：`AiAssistant/Application/TaskOrchestrator`、审计/摘要服务；可选只读依赖 `IKnowledgeSource`。
- **前置依赖**：T03–T06。
- **产出物**：原生任务状态机、重试/退避、滑窗摘要、审计 hash 链、最终汇报生成器。
- **验收**：至少两轮“改跑看改”；第 5 轮/3 小时/同错 3 次自动终止；暂停恢复重读场景；不记录隐藏推理。
- **风险**：模型可能不遵守目标，需规则化终止条件和 tool 参数校验。

## T08.1 — DarkUI 入口与空面板
- **目标/涉及模块**：在 `Command/MainForm.cs` 增加 DarkUI 风格菜单入口、可关闭空面板。
- **前置依赖**：T00、T01.6。
- **产出物/验收**：入口可打开关闭，且不影响既有场景操作。
- **风险点**：宿主线程与视觉模式必须基于 E07 复用。

## T08.2 — 设置页与模型源配置
- **目标**：模型源、循环参数、外网提醒、连接测试。
- **前置依赖**：T02、T06、T08.1。
- **产出物/验收**：密钥掩码和 DPAPI、首用外网提醒、错误分类正确。
- **风险点**：供应商工具调用兼容差异。

## T08.3 — 流式聊天视图
- **目标**：中文消息、流式文本、发送/取消和上下文状态。
- **前置依赖**：T02、T06、T08.1。
- **产出物/验收**：SSE 不阻塞 UI，重启恢复会话。
- **风险点**：长文本渲染和 UI 调度。

## T08.4 — 任务状态与控制区
- **目标**：展示轮次/动作，提供暂停、继续和中断。
- **前置依赖**：T03、T05、T07、T08.1。
- **产出物/验收**：状态与锁一致，暂停恢复重读场景，中断无残留 job。
- **风险点**：M3 停止能力依赖 T01.4。

## T08.5 — 历史、审计日志与回滚视图
- **目标**：会话列表、步骤审计详情、任务级回滚入口。
- **前置依赖**：T02、T03、T07、T08.1。
- **产出物/验收**：可查看 hash 链、定位备份、执行并验证回滚。
- **风险点**：大日志分页与备份清理后的引用显示。

## T09 — 知识包、测试、发布演练
- **目标**：落地 **静态、版本化知识包**（manifest + 知识文件 + 示例），完成回归、真实模型联调、备份恢复与发布迁移；**预留** `IKnowledgeSource`（或等价）检索/取用接口，**V1 不实现**向量数据库、Embedding、自动检索或知识库后台管理。
- **涉及模块**：`F1/AiAssistant/knowledge/`、`AiAssistant` 知识加载适配、测试项目/脚本、安装/部署配置。
- **前置依赖**：T01–T08、Q1/Q2。
- **产出物**：知识包 manifest 与版本声明、`IKnowledgeSource` 预留实现（静态文件源）、测试证据、升级/回退说明、验收报告。
- **验收**：PRD A1–A16 全量通过或记录阻塞项；安装后原场景与旧功能不受影响；知识包缺失/损坏有明确错误；知识内容不能绕过工具白名单与安全校验。
- **风险**：CMOLua 资料再分发合规（OPEN_QUESTIONS #11）；不得把 RAG/向量库塞进 V1 范围。

---

# V2 工具扩容（lucas 毕业考导向，owner 2026-08-17 拍板 A/A/A/A）

> 路线细节与缺口对照：`runs/V2-工具扩容路线草案.md`。启动前置：V1 主线（T05/T07）收口。
> 纪律不变：白名单逐一登记、T04 备份审计链、cursor→luna/sol→监理亲验→owner 拍板。

## V2.1 — 查询补齐（只读，最先做）
- **状态**：L1 已落地（分支 `wip/v2.1-query-tools` @ `775b682`；专项 7/7 PASS）。待 luna/sol 审 + 监理亲验 + 专机「口述 vs UI」。
- **目标**：`contact.query`、`unit.status`、`referencepoint.list`/`area.query`。
- **验收**：AI 能口述战场态势并与 UI 画面一致。
- **证据**：`runs/V2.1-execution-record.md`、`runs/V2.1-l1-reverify.txt`。

## V2.2 — 场景结构工具
- **目标**：`referencepoint.add/update`、`area.define`、`unit.add_batch`（单次上限 200，散布策略：随机/网格/沿线）。
- **验收**：一条指令完成考题 §2.1+§3.1 初始部署，抽查落点在多边形陆地内。

## V2.3 — 行为编排升级
- **目标**：`event.upsert` Lua 静态校验（对齐 T09 注册表白名单，禁自由 Io/Os）；「静默/开火/机动/补给」参数化循环模板。
- **验收**：考题蓝方 50 车非同步循环跑 30 分钟推演无脚本错误。

## V2.4 — 闭环决策脚本
- **目标**：识别闭环模板（未识别→派最近空闲光电→判明）与打击闭环模板（分区指派→单发→评估窗→续打/停打→跨区平移）。
- **验收**：考题 §4.4/§4.5 呈现脉冲式接火而非齐射。

## V2.5 — 毕业考全真
- **目标**：从 `acceptance/lucas/` 空想定出发，AI 全程自动建场→跑→评→改→再跑。
- **验收**：考题 §7 清单 15 条通过 ≥12 条（owner 2026-08-20 拍板甲：题面实际 15 条为准），且核心闭环项第 9–13 条必须全过。

---

# DB-DIAG-01 — 数据库"查看器卡死"成因与规律排查（纯研究单，零写入）

- **状态**：已完成（2026-09-17），待监理验收。
- **交付物**：
  - `LabConsole\workorders\DB-DIAG-01-排查报告.md`
  - `LabConsole\tools\dbtool\VALIDATE-PROPOSAL.md`
  - `LabConsole\workorders\DB-DIAG-01.engineer.log`
- **变更**：工单文件 `LabConsole\workorders\DB-DIAG-01.md` 已追加「施工交付」。
- **验收**：按工单验收判据执行；本次施工环境未挂载真实数据库与参考源码，实证证据待补齐。
- **TASKS.md 登记**：本条记录即登记。
