# ADR-002：技术选型与知识库形态（PRD V1.3 / Q13·Q14）

- **日期**：2026-08-12
- **状态**：**已确认**（随 PRD V1.3）
- **准绳**：`F1-AI助手-PRD-v1.3.md`（Q13、Q14、§11.4）
- **关联**：`TECH_SPEC.md`、`TASKS.md` T06/T07/T09、`OPEN_QUESTIONS.md`
- **编号说明**：本文件按产品要求命名为 `002-technology-selection.md`。仓库内另有历史文件 `002-t01.2-save-rollback-options.md`（T01.2 方案请示）。二者文件名不同、主题不同；引用时请写全文件名，避免只说「ADR-002」。

---

## 决策背景

F1 AI 助手需在 **.NET 5 / WinForms+WPF 宿主**内交付全自动闭环（改→跑→看→再改）。编排层与知识层若引入 Python 工作流或过重的智能体框架，会带来双运行时、部署/运维负担，并与现有 `Command_Core`、工具白名单、`CancellationToken` 取消模型冲突。PRD V1.3 将 Q13（编排）、Q14（知识库）正式关闭。

阶段一 PoC（T00～T01.6）已 **Go**；本 ADR 不改变「全自动闭环」硬性要求，只固化 V1 实现栈。

---

## 决策

### 1. 采用 C# 原生实现（含原因）

| 采用 | 原因 |
|---|---|
| **C# 原生任务状态机** 实现闭环编排（`TaskOrchestrator`） | 与 F1 同进程、同语言；直接复用 `CancellationToken`、线程封送与工具注册表；部署单运行时 |
| **System.Net.Http** + SSE 解析实现模型接入 | 无额外编排/智能体框架依赖；OpenAI 兼容协议由自有适配器统一 |
| **ToolRegistry + JSON Schema + SQLite（assistant.db）** | 与既有 `TECH_SPEC` / `DATABASE_DESIGN` 一致；审计、备份、设置同源 |

大脑（编排）与手（`IF1AutomationFacade` / 工具集）保持清晰接口，将来若行为复杂化可只替换编排层。

### 2. 不采用 LangGraph（及同类）的原因

- LangGraph / Python 工作流运行时需要 **第二套运行时** 与进程间通信，增加安装、调试与失败域。
- 与「内嵌 F1、单实例串行、场景锁、软停」同进程模型不匹配。
- V1 **不引入**外部工作流引擎（任意语言）。

### 3. 静态知识包 V1 的范围

**包含：**

- 本地静态、**版本化**知识包目录（如 `F1/AiAssistant/knowledge/`）
- `manifest`（含版本号、文件清单、兼容声明）
- 知识文件与示例（CMO Lua 规范、常见坑、经验等）
- 可插拔接口预留：`IKnowledgeSource`（或等价），供编排/提示组装只读读取

**不包含（V1 明确不做）：**

- 向量数据库、Embedding、自动检索 / RAG 流水线
- 自动知识库构建、知识库后台管理 UI
- 任何可绕过工具白名单或安全校验的「直接执行知识包内容」路径

知识包内容进入模型上下文时，仍只能通过受控提示/只读查询；**实际改场景、跑推演必须走工具白名单**。

### 4. Semantic Kernel 的引入门槛

- **V1 不引入** Semantic Kernel NuGet 依赖，不作为实现路径。
- .NET 优先；SK 仅为 **后续备选**，须同时满足：
  1. 原生状态机在可维护性或能力上出现 **可证据化** 瓶颈（非偏好）；
  2. 经 **独立 ADR** 评估（收益、依赖体积、与工具白名单/取消模型兼容性、回退方案）；
  3. owner 书面批准后再改 `TECH_SPEC` / `TASKS`。
- 极端情况再考虑 Python sidecar——同样须独立 ADR，且 **不得**默认化。

### 5. 对 T06 / T07 / T09 的影响

| 任务 | 影响 |
|---|---|
| **T06** | `IModelProvider` 用 C# 原生 HTTP/SSE；DPAPI；不引入 SK |
| **T07** | `TaskOrchestrator` 用 C# 原生状态机完成闭环；不引入 LangGraph / 外部工作流引擎 |
| **T09** | 落地静态知识包 + manifest/版本兼容；实现或预留 `IKnowledgeSource`；**不**做向量库/Embedding/自动构建 |

### 6. 被明确排除的内容（V1）

- LangGraph、Python 工作流运行时、外部工作流引擎
- Semantic Kernel（当前依赖与实现）
- 向量检索、Embedding、自动 RAG、知识库后台管理
- 任何以「知识包」名义绕过工具白名单 / `LuaPolicyValidator` / 场景锁的执行通道
- 将全自动闭环降级为「AI 只写文件、人手动跑」

---

## 后果

- 文档与实现合同以本 ADR + PRD V1.3 为准；旧稿若暗示「可选 LangGraph / 当前上 SK / V1 上向量库」一律作废。
- 不新增本 ADR 所排除的 NuGet 包；功能代码变更不在本轮范围。
