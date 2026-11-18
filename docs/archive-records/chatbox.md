下面是更新后的完整版本。当前对话不能直接创建本地文件附件，你可以将以下内容保存为：

```text
AI项目协作总控备份.md
```

建议同时备份到项目目录和独立备份目录。

```markdown
# F1-AI 项目协作总控备份

> 用途：当 AI 对话中断、模型更换或上下文丢失时，帮助新的 AI 快速恢复项目背景、工作制度、模型分工和当前进度。
>
> 更新时间：2026-08-13
>
> 文档性质：项目协作规则与状态备份，不替代 PRD、技术方案、执行记录和审查报告。

---

## 一、项目目标

本项目是在 F1 / Command Modern Operations 桌面程序中集成 AI 助手。

目标流程：

```text
用户用中文提出任务
→ AI 读取场景
→ AI 通过受控工具修改场景
→ 自动保存
→ 自动运行推演
→ 读取结果
→ 根据结果继续调整
→ 形成多轮自动闭环
```

PRD 的核心硬性要求：

```text
1. 不得用人工启动推演替代自动闭环。
2. 不得把全自动流程偷偷降级成半自动流程。
3. 场景修改前必须备份。
4. 修改、保存、运行、结果读取和恢复必须可审计。
5. 失败时必须安全阻断，不能继续盲目修改。
6. 任务级回滚必须可验证。
```

当前项目按照 PRD 的以下结构推进：

```text
M1 ~ M9：产品模块
A1 ~ A16：验收标准
```

所有技术任务、审查和阶段放行都必须以 PRD 为最终业务依据。

---

## 二、我的角色定位

我在本项目中担任：

```text
技术负责人
架构审查员
任务拆解与流程控制者
多模型协作协调者
Cursor 输出复核者
高风险闸门判断者
```

我的主要职责：

1. 审查需求是否被正确转换为技术方案；
2. 判断 Cursor 的实现是否符合 PRD 和任务边界；
3. 检查是否存在安全、线程、保存、恢复、路径、数据库和架构风险；
4. 判断当前任务是否达标；
5. 决定下一步应该继续、修复、换模型还是停止；
6. 为 Cursor、Luna、Sol 编写任务提示词；
7. 在模型之间传递准确的上下文和已验证经验；
8. 防止项目在多个模型之间反复绕圈。

我不应假设自己可以：

- 直接访问用户电脑上的完整源码；
- 直接运行 F1；
- 直接执行本地命令；
- 直接修改用户本地文件。

这些操作由 Cursor 完成，结果再交给我复核。

---

## 三、模型分工与使用策略

经过实际使用评估，当前模型策略如下：

```text
Luna：默认主力，承担大部分任务
Sol：少量高难度任务和高风险审查
Terra：弃用，不再作为常规模型使用
```

### 1. Luna：默认主力模型

定位：

```text
高性价比执行模型
日常编程模型
文档和测试主力
机械审查模型
```

Luna 负责大部分工作：

- 读取项目源码；
- 执行明确的小任务；
- 编写普通代码；
- 编写测试；
- 修改文档；
- 运行构建和测试；
- 生成执行记录；
- 生成 review-pack；
- 维护三份活文档；
- 维护 `runs/knowledge.md`；
- 处理普通 bug；
- 做机械一致性检查；
- 执行已定案的方案；
- 执行低风险重构；
- 生成 Smoke 证据；
- 做普通失败排查。

Luna 适合：

```text
任务边界明确
修改文件明确
技术方案已经定案
有清晰验收标准
不需要重新判断总体架构
```

Luna 不应独立决定：

- 是否修改核心架构；
- 是否修改 `ClientCore.cs` / `LoadSave.cs`；
- 是否扩大任务范围；
- 是否允许进入下一个高风险里程碑；
- 是否接受全自动闭环降级；
- 是否把 S1 PASS 认定为 F04.2 PASS；
- 是否进入 F04.3、F04.5 或 T05。

### 2. Sol：少量高难度任务

定位：

```text
高难度编程模型
复杂代码审查模型
运行时和架构风险分析模型
```

Sol 只在 Luna 无法稳定推进、或任务本身属于高风险时使用。

适合交给 Sol 的任务：

- 启动链、MainSplash、MainForm、UI 线程问题；
- `ClientCore.Initialize` / `CoreInitialize`；
- `HandleScenarioLoaded` 和 reload 语义；
- 保存、恢复和回滚；
- `RecoveryRequired`、sentinel、orphan；
- `EnterRecovery` 状态机；
- 生产 runtime 组合；
- `ToolService.Invoke` 边界；
- `F1-Core` / `Command_Core` 引用隔离；
- `HB-INLINE` 编译边界；
- 路径、symlink、junction、reparse point；
- 复杂并发和取消语义；
- 真实 F1 Smoke 证据审查；
- Luna 连续两轮无法推进的运行时问题。

Sol 的角色不是默认执行所有任务，而是：

```text
在 Luna 处理不了或风险较高时介入；
给出定点诊断、代码修复或高风险审查；
完成后把结论交给我判断。
```

### 3. Terra：弃用

当前决定：

```text
后续弃用 Terra，不再作为常规模型使用。
```

原因：

- 价格最高；
- 对当前项目的投入产出比不高；
- 许多原本需要 Terra 的架构裁决，已经通过文档、任务拆分和 Sol 审查完成；
- 当前采用“Luna 默认执行 + Sol 高风险介入 + 用户最终授权”的方式更符合实际成本。

Terra 历史产出的报告仍然有效，包括：

- S1/S2 拆分裁决；
- F04.2-R-D2 闸门意见；
- F04.2 高风险 allowlist；
- reload、recovery、Smoke 的历史约束。

但是：

```text
历史 Terra 报告作为项目约束和参考；
不再主动调用 Terra 生成新报告。
```

如果未来遇到极端重大架构决策，优先方案是：

```text
先由我审查；
必要时使用 Sol；
由用户做最终授权。
```

---

## 四、模型切换规则

### 默认流程

```text
Luna 执行
→ Luna 生成执行记录
→ Luna 做机械复查
→ 我审查结果
```

### 高风险流程

```text
Luna 执行或分析
→ Luna 机械检查
→ Sol 做高风险代码/证据审查
→ 我判断是否允许下一步
```

### 从 Luna 切换到 Sol 的条件

满足以下任一条件，就不要让 Luna 继续无限尝试：

1. 同一个问题连续两轮没有实质推进；
2. 反复修改但新增证据很少；
3. 卡在启动、许可、UI、线程、资源或运行时加载；
4. 涉及 `ClientCore`、`LoadSave`、`MainForm`、reload 或 recovery；
5. 需要判断多个架构方案；
6. Luna 开始反复重写方案但没有新的源码证据；
7. Luna 无法区分“代码问题”和“环境问题”；
8. 任务需要真实 F1 运行时证据；
9. 需要判断是否扩大 allowlist；
10. 需要判断是否能进入下一个高风险阶段。

切换时不要把整个历史对话重新喂给 Sol。只提供：

```text
当前任务
当前状态
已验证有效的方法
已验证无效的方法
当前阻塞点
关键源码文件
关键执行记录
禁止事项
需要 Sol 判断的问题
```

---

## 五、项目目录与重要文件

### 当前工作区

```text
D:\soft\F1-AI
```

### F1 运行目录

```text
D:\soft\F1-AI\F1
```

### 常用程序

```text
D:\soft\F1-AI\F1\F1.exe
D:\soft\F1-AI\F1\F1-Console.exe
```

### 测试场景

```text
TEST-MINI.scen
```

已验证目标单位：

```text
XOYR7W-0HNNNGACTSBIB
```

单位：

```text
F-15E Strike Eagle
```

### 重要文档

```text
F1-AI助手-PRD-v1.2.md
TECH_SPEC.md
TASKS.md
SOURCE_ANALYSIS.md
DATABASE_DESIGN.md
TEST_PLAN.md
OPEN_QUESTIONS.md
```

### 三份活文档

```text
进度看板.md
原理说明.md
变更记录.md
```

### 知识与证据

```text
runs/knowledge.md
runs/
reviews/
review-packs/
docs/ADR/
```

---

## 六、三份活文档制度

### 1. 进度看板.md

面向人，简短说明：

- 当前完成到哪里；
- 正在做什么；
- 下一步是什么；
- 当前阻塞点；
- 是否允许进入下一步。

不写长日志。

### 2. 原理说明.md

用非程序员能理解的话说明：

- 系统如何运行；
- 用户输入后发生什么；
- 模型、工具、场景、推演和结果如何流动；
- 为什么采用当前设计；
- 当前有哪些限制和风险。

### 3. 变更记录.md

每项任务记录：

- 改了什么；
- 为什么改；
- 动了哪些文件；
- 如何验证；
- 有什么风险。

详细命令、原始日志和 hash 放在 `runs/` 中。

---

## 七、知识文件制度

统一知识文件：

```text
runs/knowledge.md
```

每次开始任务前必须读取，每次任务结束后必须更新。

知识文件只记录可复用经验，不写流水账。

建议结构：

```text
## 已确认规则
## 已验证有效的方法
## 已验证无效的方法
## 常见卡点
## 重要路径 / 环境变量
## 固定测试资产
## 阶段闸门口径
## 历史想定 / LuaServer 可复用经验
## 已过时内容
```

### 当前已确认的关键经验

1. F1 进程存活不等于进入 MainForm；
2. `StartGameWindowThread` 不等于 MainForm；
3. `load-armed-probe` / `shown-armed-probe` 是确认主窗体生命周期的关键证据；
4. 资源缺失可能导致初始化异常被吞，表现为假 Terrain 等待；
5. `D:\CMO` 下的 Symbols、DB、WW Cache 会影响启动；
6. 大型 WW Cache 不要整树复制，容易导致磁盘不足；
7. 启动卡住 1～2 分钟且没有有效 probe 或日志时，应停止等待并转为诊断；
8. LandCover 约 195 个文件已确认可以完成，不是本轮死锁根因；
9. Smoke 必须操作工作副本，不得修改原始 fixture；
10. 当前已验证 Smoke 目标单位是 `XOYR7W-0HNNNGACTSBIB`；
11. S1 默认清理 `LastSavedInScenEdit`；
12. C1 使用 `F1_AI_SMOKE_EXPECT_STEP2=1` 保留 Step2 条件；
13. `HandleScenarioTitleChanged` 曾出现非当前 Scenario / UI Invoke 相关 NRE；
14. S1 PASS 不等于 F04.2 PASS；
15. 不得把构建成功、进程存活、exit 0、窗口存在、目录非空或 L1 通过当成真实 Smoke PASS；
16. `-R` Console 路径不能替代 GUI MainForm 成功链证据；
17. 资源完整后，真实 S1 成功链已跑通；
18. S1 真实成功链 run：
    ```text
    s1-20260813-110622
    ```
19. S1 成功链包含：
    ```text
    加载工作副本
    → UpdateSceneContext
    → EnsureSmokeTask
    → ToolService.Invoke × 3
    → reload
    → verify
    → smoke-complete.marker
    ```
20. S1 复验结果为：
    ```text
    RESULT=PASS
    ```

---

## 八、S1 / S2 阶段规则

### S1

S1 只证明真实成功路径：

```text
加载工作副本
→ 读取摘要
→ 移动单位
→ 保存
→ reload
→ 再次验证
```

当前 S1 状态：

```text
S1：PASS
```

但：

```text
S1 PASS ≠ F04.2 PASS
```

### S2

S2 是不可删除的安全验收，当前尚未运行或授权。

S2 必须验证：

#### S2A：自动补偿成功

```text
Core mutate 成功
→ Outcome/fingerprint 失败
→ EnterRecovery
→ restore
→ reload
→ compensation audit
→ auto-ack
→ sentinel 清除
→ IsBlocked=false
```

#### S2B：reload 失败后阻断

```text
Core mutate 成功
→ outcome_fail + reload_fail
→ recovery/inflight 保留
→ IsBlocked=true
→ 后续 mutation 被拒绝
→ Core/Dispatch 不再增加
```

#### S2C：跨进程 orphan 阻断

第一进程：

```text
稳定留下权威 sentinel
→ 写 handoff
→ 退出
```

第二进程：

```text
同一 W2 root
→ 同一 canonical work path
→ 同一 task id
→ AttachExisting
→ startup orphan 发现
→ IsBlocked=true
→ 只验证，不清理、不 ack、不修复
```

S2 注入规则：

```text
SMOKE == 1
CONFIRM == YES
INJECT ∈ AllowedInjectSet
ModeInjectComboLegal(mode, inject)
```

S2 要求：

- Debug / Release 一致；
- 普通 composition 使用 no-op policy；
- 不使用全局可写静态开关；
- 每次注入 one-shot；
- 记录：
  - `smoke_injected=true`
  - `inject_point`
  - `inject_token`
  - `run_id`
  - `phase_id`

---

## 九、重要安全边界

禁止随意修改：

```text
ClientCore.cs
LoadSave.cs
Lua 相关文件
DB3K 相关文件
```

除非另开高风险方案并重新审查。

当前仍禁止：

```text
F04.3
F04.5
T05
```

S1 PASS 不会自动解锁这些任务。

生产工具边界：

```text
Tools
→ IF1AutomationFacade
→ F1Core adapter
→ F1 Core
```

普通层不得直接引用：

```text
F1-Core
Command_Core
ClientCore
Scenario
LuaSandBox
```

模型不得直接接触 Core 对象。

---

## 十、S1 当前复验结果

最新 S1 复验：

```text
run_id：s1-20260813-110622
耗时：约 28 秒
结果：smoke-complete.marker RESULT=PASS
```

实际链路：

```text
fixture 加载
→ 工作副本复制
→ UpdateSceneContext
→ EnsureSmokeTask
→ ToolService.Invoke × 3
→ reload
→ verify
→ completion marker
```

测试单位：

```text
XOYR7W-0HNNNGACTSBIB
F-15E Strike Eagle
```

移动结果：

```text
坐标小幅变化约 +0.05°
reload 后读回成功
```

隔离结果：

```text
原始 fixture hash 前后不变
WritableRoot.txt 保持 D:\CMO
Smoke 使用独立 W2 writable root
```

当前结论：

```text
S1 PASS
F04.2 PASS：No
S2：NOT RUN / 未授权
```

---

## 十一、启动诊断经验

曾经出现：

```text
F1.exe 进程存在
MainSplash_Shown 已进入
MainForm_Load / MainForm_Shown 未执行
```

最终查明，启动环境缺少：

```text
D:\CMO\Symbols
D:\CMO\DB
D:\CMO\WW\Cache
```

资源缺失时，初始化异常可能被吞掉，外在表现类似 Terrain 等待。

补齐资源后：

```text
约 8.2 秒进入 MainForm_Shown
LandCover 约 195 个文件全部完成
```

因此：

```text
F1 进程存活 ≠ F1 启动成功
必须看到 MainForm_Load / MainForm_Shown 或真实 Smoke marker
```

### 启动诊断探针

项目中曾使用 9 个只写日志的 ENTRY-PROBE 文件。

这些探针用于确认：

- MainSplash_Shown；
- MainForm_Load；
- MainForm_Shown；
- CoreInitialize；
- LandCover 加载区间。

后续处理原则：

```text
如果保留探针，必须增加环境变量门控；
否则在诊断完成后删除。
```

探针不能长期无条件写生产日志。

---

## 十二、当前任务推进规则

每个任务遵循：

```text
1. 新开或确认当前任务对话；
2. 读取 runs/knowledge.md；
3. 读取当前任务指定文件；
4. 用大白话汇报准备做什么；
5. 执行一个小任务；
6. 生成 execution record；
7. 更新三份活文档；
8. 更新 runs/knowledge.md；
9. Luna 做机械检查；
10. 高风险时 Sol 做代码/证据审查；
11. 我判断是否进入下一步；
12. 用户确认后再进入下一任务。
```

不要一口气做多个里程碑。

---

## 十三、审查分级

### 普通任务

```text
Luna 执行或审查
```

适用：

- 文档；
- 普通测试；
- 明确的小范围代码；
- 执行记录；
- 低风险 UI；
- 机械检查。

### 高风险任务

```text
Luna 初步处理
→ Sol 审查
→ 我判断是否放行
```

适用：

- MainForm；
- ClientCore；
- LoadSave；
- reload；
- recovery；
- sentinel；
- orphan；
- 路径安全；
- 线程和 UI 调度；
- 真实 Smoke；
- 生产装配；
- S2 状态机。

### Terra

当前弃用：

```text
不再主动调用 Terra。
```

历史 Terra 报告只作为约束和参考保留。

---

## 十四、模型执行限制

### Luna 必须遵守

- 任务开始前读取 `runs/knowledge.md`；
- 不重复尝试已知失败路径；
- 不把方案当成实现；
- 不把进程存活当成功；
- 不把 S1 PASS 当 F04.2 PASS；
- 不得越过 allowlist；
- 发现高风险问题时停止并报告；
- 任务结束后更新知识文件。

### Sol 必须遵守

- 只在明确的高风险任务中介入；
- 优先读取 review-pack、execution record 和关键源码；
- 不重复机械检查已经确认的内容；
- 直接指出 P0/P1；
- 给出文件、方法、证据位置；
- 不擅自修改代码；
- 不擅自放行下一个里程碑。

### Cursor 必须遵守

- 每次新任务先读知识文件；
- 只执行一个任务；
- 任务结束后停止；
- 不自行进入下一个任务；
- 不扩大 allowlist；
- 不用人工操作代替自动闭环；
- 失败时标记 BLOCKED；
- 真实证据不足时不能猜 PASS。

---

## 十五、任务完成判定

以下内容不能单独证明任务完成：

```text
代码能编译
测试通过
F1.exe 进程存在
窗口出现
exit code 0
目录非空
review-pack 已生成
模型说“应该可以”
```

必须根据任务要求提供对应证据。

真实 Smoke 至少需要：

```text
smoke-complete.marker
RESULT=PASS
真实 ToolService.Invoke 记录
fixture/work hash
坐标修改前后
save hash
reload 后坐标
SaveScenarioPath
scene identity
UpdateSceneContext
assistant.db
audit
backup
sentinel 生命周期
```

---

## 十六、恢复工作提示词

当新的 AI 接手项目时，先发送：

```text
你正在接管 F1-AI 项目。

请先读取：
- AI项目协作总控备份.md
- runs/knowledge.md
- 进度看板.md
- 原理说明.md
- 变更记录.md

不要假设之前的聊天上下文。

请用中文输出：
1. 你理解的项目目标；
2. 当前模型分工：Luna 默认主力、Sol 高风险介入、Terra 弃用；
3. 当前 S1/S2/F04.2/F04.3/F04.5/T05 状态；
4. 已知的重要启动、Smoke、资源和路径经验；
5. 当前允许做什么；
6. 当前禁止做什么；
7. 下一步建议是什么。

在用户确认前：
- 不修改代码；
- 不启动 F1；
- 不运行 Smoke；
- 不进入下一任务。
```

---

## 十七、最终协作原则

```text
Kimi：说清楚业务需求和验收标准；
Luna：承担大部分执行、编程、测试和机械审查；
Sol：处理少量高难度代码、运行时和安全审查；
Terra：弃用，仅保留历史裁决作为参考；
我：负责技术把关、任务拆解、模型切换和阶段放行；
用户：决定高风险授权和最终业务取舍。
```

必须始终遵守：

```text
证据不足不能猜成功。
失败不能悄悄缩水。
方案批准不等于代码完成。
代码完成不等于真实 Smoke 通过。
S1 PASS 不等于 F04.2 PASS。
真实 Smoke 通过也不自动解锁下一个里程碑。
```
```