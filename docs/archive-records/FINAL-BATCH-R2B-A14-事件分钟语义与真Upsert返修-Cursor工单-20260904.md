# FINAL-BATCH-R2B：A14 事件分钟语义与真 Upsert 返修 Cursor 工单

## 0. 任务结论

这是 A14 正规结构化事件功能的代码返修单，分两个独立 WIP：

1. **R2B-1 必做**：`trigger_minutes=N` 必须表示“从当前想定时间起 N 分钟后”，不能把整数 N 直接当 F1 的绝对时间值。
2. **R2B-2 审清后做**：工具名叫 `event.upsert`，同名再次调用必须更新为最新配置，不能因同名 trigger/action 已存在而失败，也不能悄悄累加旧组件。

自由 Lua/自定义脚本不在本单，owner 已决定以后开发。

开工基线固定为：

- 源仓：`D:\soft\F1-AI-integration`
- 源提交：`4d93828a87c17ef01205ab69ae00be075ed9aa90`
- 新 worktree：`D:\soft\F1-AI-final-r2b`
- 新分支：`fix/final-a14-events`

## 1. 开工硬门

1. 核对源仓 HEAD 必须等于冻结 SHA。
2. 新 worktree 路径与分支必须都不存在；任一已存在立即停工，不得覆盖/删除/复用。
3. 从冻结 SHA 新建独立 worktree/分支；不得直接改 integration 或主 demo 工作区。
4. 记录开工 HEAD、分支、status。

## 2. 已确认的旧码问题（仍须你先 rg 再引用）

- `CMO-netcore-src/AiAssistant.F1Core/LuaEventTemplate.cs` 当前 `BuildScript(EventRequest req)` 把 `req.TriggerMinutes` 原样写进 `ScenEdit_SetTrigger(... type='Time', Time='<整数>')`。
- `CMO-netcore-src/Command_Core/Lua/LuaEvent.cs` 的 Time trigger 走 F1 的绝对时间表示；`1`/`2` 不能代表“当前想定时间后 1/2 分钟”。
- `CoreF1AutomationFacade.EventUpsert` 已拿到当前 `Scenario scen`，可使用 `scen.Time`；禁止使用系统时钟 `DateTime.Now/UtcNow`。
- 当前模板每次固定描述名后仍使用 `ScenEdit_SetTrigger(mode='add')`、`ScenEdit_SetAction(mode='add')`、事件关联 `mode='add'`；同名第二次调用存在确定的失败/累加嫌疑。
- `Command_Core/Lua/LuaEvent.cs` 显示：Trigger 支持 add/list/remove/update，事件关联 trigger/action 支持 add/remove/replace。必须按磁盘真实实现确认参数形状，不能猜 Lua API。

## 3. R2B-1 冻结合同：相对分钟

1. `trigger_minutes=N` 的基准只允许是调用当刻的 `scen.Time`。
2. 目标时刻为 `scen.Time.AddMinutes(N)`，传给 F1 的值必须是该目标时刻所需的绝对时间编码（当前实现链应以 `DateTime.ToBinary()` 为准，但你必须先沿解析端逐字确认）。
3. 计算与格式化必须 invariant；禁止系统时间、时区漂移、字符串区域设置漂移。
4. 现有 schema 范围 1–100000 保持，不擅自改业务上限。
5. 回执继续保留用户输入的 `trigger_minutes`；若新增 `trigger_at` 字段必须先有必要性和兼容性测试，否则不扩合同。

### R2B-1 获准文件

- `CMO-netcore-src/AiAssistant.F1Core/LuaEventTemplate.cs`
- `CMO-netcore-src/AiAssistant.F1Core/CoreF1AutomationFacade.cs`
- `tests/F1.AiAssistant.Tests/Demo1C_CommitB_Tests.cs`（把旧的 `Time='2'` 错断言改为正确绝对时间）
- 新建 `tests/F1.AiAssistant.Tests/FinalBatchR2B_EventTimingTests.cs`

若必须改其它生产文件，停工上报，不得自行扩围。

### R2B-1 锁红

至少证明：

- 固定想定时间 + 2 分钟得到精确 `ToBinary()` 值，旧码 `Time='2'` 必红；
- 不同基准时间产生不同绝对触发值；
- 不受本机 `Now/UtcNow` 影响；
- 1 与 100000 边界仍可构造，越界仍由既有校验拒绝；
- Core facade 把当前 `scen.Time` 传到模板，而非模板自行取钟。

完成后做独立 WIP commit，建议：`final-r2b-1 WIP: bind event delay to scenario time`。

## 4. R2B-2 冻结合同：同名真 Upsert

先逐字审清 Lua API，再实现。不得为了绿测试编造不存在的调用。

同名第二次调用的结果必须：

1. 仍只有一个同名事件；
2. 事件 enabled 状态为第二次请求值；
3. 只关联第二次请求对应的一个 trigger 与其 action 集；
4. 第一次请求遗留的关联不再生效；动作数量变少时，多余旧动作也不应继续挂在事件上；
5. 不删除、不替换其他事件拥有的非本工具组件；
6. 失败不得留下“半更新”却回报 `upserted`。若现有 Lua API 无法提供安全的原子/可恢复更新，**不要降级假装完成**：保留 R2B-1 commit，停止 R2B-2，并报告可选设计、优缺点与需要 owner 拍板之处。

优先利用稳定描述名定位本工具创建的 trigger/action，并用磁盘已证实的 update/remove/replace 语义。需特别证明“组件已存在时不会再次 add 同名对象”。

### R2B-2 获准文件

- `CMO-netcore-src/AiAssistant.F1Core/LuaEventTemplate.cs`
- `CMO-netcore-src/AiAssistant.F1Core/CoreF1AutomationFacade.cs`（只有确有必要）
- `tests/F1.AiAssistant.Tests/Demo1C_CommitB_Tests.cs`
- 新建 `tests/F1.AiAssistant.Tests/FinalBatchR2B_EventUpsertTests.cs`

不得用只验证 InMemory 最新快照的测试冒充生产真 upsert；`Fix6D_Event_MockProdAlignmentTests` 只能作为回归组，不是充分证据。

完成后做第二个独立 WIP commit，建议：`final-r2b-2 WIP: make structured event upsert idempotent`。

## 5. 每个 WIP 的门禁

每个 WIP 完成即分别跑并记录：

- 本轮具名测试；
- `Demo1C_CommitB_Tests` + `Fix6D_Event_MockProdAlignmentTests`；
- 全量 L1：`dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore`；
- AllInOne：`dotnet build CMO-netcore-src\F1-AllInOne.csproj -c Debug -p:Platform=x64 -t:Rebuild --no-restore`；
- `git diff --check 4d93828..HEAD`。

只准具名 add；禁 `git add -A`/`.`；永不提交 `runs/`、`backup/`、`Command_Core/BinaryGridProvider.cs`、`Terrain.cs`。不得修改 Command_Core 来迁就模板，不 push/tag，不改验收矩阵，不启动 F1。

## 6. 完事报告

必须包含：开工/各 WIP/收工 SHA；每轮文件清单；旧码锁红；绝对时间计算的逐字证据；同名第二次调用如何去旧、建新、关联且不碰其他事件；全量门结果与日志；最终 status；若 R2B-2 停工，清楚写“相对分钟已完成 / 真 upsert 待确认”，不得合称 A14 完成。

