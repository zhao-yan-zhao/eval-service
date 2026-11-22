# FINAL-BATCH-R2B-R1：A14 Lua 静默失败与动作清理边界 Cursor 返修工单

## 0. 监理裁决与开工令

R2B-1“`trigger_minutes=N` 绑定当前 `scen.Time + N 分钟`”合同已逐字复核正确；R2B-2“同名真 upsert”**未通过合同门**。虽然现有测试全绿，但生产脚本存在确定的假成功路径，`2d9adee` 不得合入 integration、不得灌装、不得宣称 A14 完成。

继续使用现有工作区，不得重建或覆盖：

- worktree：`D:\soft\F1-AI-final-r2b`
- 分支：`fix/final-a14-events`
- 必须开工 HEAD：`2d9adee63ef1bf3e652e965332c35ac3ebcdb4be`
- 历史必须保留：`4d93828` → `585f810` → `2d9adee`
- 新增独立 WIP commit，建议：`final-r2b-r1 WIP: detect silent Lua failures and clean all owned actions`

禁止 amend/reset/rebase；既有 `runs/` 脏项不得提交。若 HEAD、分支或源码/测试状态不符，立即停工报告。

## 1. 开工前必须逐字复核的两个缺陷

所有引用先 `rg` 再引；引不到写“未找到”。

### 缺陷 A：`pcall` 在生产非交互路径不能表示 F1 API 成功

已确认调用链，仍须你在磁盘复核：

1. `CoreF1AutomationFacade.RunLuaScript` 调用 `scen.Scenario_LuaSandbox.RunScript(script, false, ...)`，即 `RunInteractive=false`。
2. `Command_Core/Lua/LuaSandBox.cs` 的 `LUA_ScenEdit_SetAction`、`LUA_ScenEdit_SetTrigger`、`LUA_ScenEdit_SetEventTrigger`、`LUA_ScenEdit_SetEventAction` 都在底层异常时：仅当 `RunInteractive` 才重抛；非交互路径返回 `null/nil`。
3. `Command_Core/Lua/LuaEvent.cs` 中 `ScenEdit_SetAction(mode='update')` 在目标 action 不存在时会抛 `Action not found`，但经上述 wrapper 到 Lua 侧变成 `nil`，并不继续抛出。
4. 当前 `LuaEventTemplate.cs` 约 188 行使用：`if not pcall(function() ScenEdit_SetAction(mode='update'...) end) then add end`。wrapper 已吞异常后，`pcall` 返回 `true`，因此首次创建时不会执行 add。
5. 后续关联 add、trigger add 等返回 `nil` 也未检查；脚本最终仍 `return _e`。Facade 看到非空事件名就回报 `status=upserted`，形成“动作/关联没建好但告诉用户成功”。

这直接违反原工单：“失败不得留下半更新却回报 upserted”。不得用现有字符串形状测试掩盖。

### 缺陷 B：固定清理到 128 与公开合同不一致

- 当前模板固定 `OwnedActionOrphanScanCap = 128`，只清 `{event}_action_{N+1..128}`。
- 当前 `event.upsert` schema 的 `actions` 只有 `type=array`，没有 `maxItems=128`；`ParseAndValidate` 也没有 128 上限。
- 因此旧请求若有第 129 个及以后动作，后续缩短请求时这些旧组件不会被清理，仍可能残留。

本轮不允许擅自把公开 actions 上限收紧为 128。若无法利用 F1 的 list 返回安全枚举本工具拥有的组件，停工报告方案与优缺点，交监理/Owner 决策。

## 2. 必须先补的确定性锁红

### 2.1 静默失败/假成功

至少覆盖：

1. 空白 Scenario 首次 `event.upsert`：action update miss 在非交互 wrapper 下返回 nil；修复前不会 fallback add，必须锁红。
2. 首次成功后，真实 Scenario 中必须恰有：一个同名 event、一个 owned trigger、请求数量的 owned actions；event 关联数量准确。
3. 同名第二次：enabled、绝对触发时间、各 action 内容均为第二次请求；不重复关联。
4. 任何**必须成功**的 SetEvent/SetTrigger/SetAction/SetEventTrigger/SetEventAction 返回 nil 时，脚本必须最终 `return nil, '<稳定错误码>'` 或等价结构，使 `CoreF1AutomationFacade.RunLuaScript` 抛出并禁止 `status=upserted`。
5. 不能只断言生成脚本包含某段字符串；至少一组测试必须走真实 `Scenario_LuaSandbox.RunScript(..., false, ...)` 或能够忠实复现 wrapper“异常→nil”的生产执行 seam，并检查 Scenario 实际对象/关联。

测试必须隔离并恢复 Lua 单例、Scenario/global 静态状态，不能污染全量 L1。

### 2.2 超过 128 的缩减清理

至少覆盖：

1. 先建立 130 个本工具稳定命名的 owned actions，再以 1 个 action 同名 upsert；修后 `_action_2.._action_130` 均不再关联且组件按安全规则收敛。
2. 同时放置其他事件的 action，以及名称不属于 `{event}_action_<正整数>` 的组件；不得删除或解绑。
3. 不得用新增 `maxItems=128` 让测试过绿。

若真实 F1 API/测试成本使 130 个实体执行不可行，可用生产等价的 list/分类 seam 做确定性行为测试，但必须同时有真实 API 返回形状的逐字证据，不能只测自造字符串。

## 3. 修复合同

### 3.1 所有必需 Lua 步骤检查返回值

优先按真实 API 返回值修复，而不是依赖 `pcall`：

- `SetEvent` add/update：保存返回值；nil 即失败。
- action update：返回非 nil 才算更新成功；nil 时再 add，add 仍 nil 则失败。
- trigger recreate 的 add：返回 nil 必须失败。
- event-trigger link add：返回 nil 必须失败。
- event-action link add：返回 nil 必须失败。
- 允许缺失的 remove/unlink 属幂等清理，可忽略“未找到”的 nil；但随后的创建/关联必须检查。
- 最终只有所有必需对象与关联均成功时才 `return _e`；失败必须返回 `nil,error`，并被现有 `RunLuaScript` 的双返回值检查识别。

错误码应稳定、可诊断，至少区分 event、trigger、action、trigger-link、action-link 哪一步失败；用户层仍走既有中文错误收敛，禁止泄露堆栈。

不能把 `RunInteractive` 改成 true，不能修改 Command_Core wrapper 来迁就模板，不能把吞错路径解释成成功。

### 3.2 清理全部 owned 多余动作，不设拍脑袋上限

- 先逐字确认 `ScenEdit_SetAction(mode='list')` 或其它现有只读 API 的真实返回表形状。
- 从实际存在的 actions 中，只选择 description 严格匹配当前工具命名空间：`{event_name}_action_<正整数>`，且序号大于新请求 actions.Count 的组件。
- 对筛中的组件先从当前 event 解绑，再尝试删除；不得枚举/删除其他前缀、其他事件的普通动作或模糊相似名称。
- 如同名 owned action 还被其他事件引用，底层删除应 fail-closed/保留，不得破坏别的事件；报告清楚说明行为。
- 禁止固定扫描 128/256/任意常量假装“全部”。
- 不改公开 schema 业务上限；如确实只能通过设置上限才能正确，停工给出“动态枚举”和“收紧 schema”两方案的大白话优缺点，由 Owner 拍板，不得自行选择。

### 3.3 保持已正确部分

- `trigger_minutes` 继续严格使用调用当刻 `scen.Time.AddMinutes(N).ToBinary()`，禁止系统时间。
- enabled、action 内容、动作缩减、同名事件只保留一份等 R2B 合同不放宽。
- 只处理本工具稳定命名组件；不得删除整个事件重建来规避检查，除非先停工证明这是唯一安全方案。
- 不宣称事务原子性；但绝不允许已知失败仍回报 `upserted`，再次同名调用必须能够收敛前次可恢复的半状态。

## 4. 获准范围

仅允许最小修改：

- `CMO-netcore-src/AiAssistant.F1Core/LuaEventTemplate.cs`
- `CMO-netcore-src/AiAssistant.F1Core/CoreF1AutomationFacade.cs`（仅错误回传/读回确有必要时）
- `tests/F1.AiAssistant.Tests/FinalBatchR2B_EventUpsertTests.cs`
- 可新增 `tests/F1.AiAssistant.Tests/FinalBatchR2BR1_EventExecutionTests.cs`
- `tests/F1.AiAssistant.Tests/Demo1C_CommitB_Tests.cs`（仅同步真实脚本合同）

禁止改 `Command_Core/**`、ToolRegistry schema、InMemory Mock、模型提示词、任务循环、A9/R2C、审计链、数据库迁移、运行包、想定和生产数据库。确需扩围先停工逐文件报告。

## 5. Git、门禁与完事报告

具名 add；禁止 `git add -A` / `git add .`；不提交 `runs/`、`backup/`、`BinaryGridProvider.cs`、`Terrain.cs`；不 push/tag，不启动或控制 Owner 的 F1。

修后依次执行：

1. R2B-R1 具名行为测试；
2. R2B 全组 + Demo1C + Fix6D Event；
3. 全量 L1：`dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore`；
4. AllInOne：`dotnet build CMO-netcore-src\F1-AllInOne.csproj -c Debug -p:Platform=x64 -t:Rebuild --no-restore`；
5. `git diff --check 2d9adee..HEAD`、status、commit 文件与禁区扫描。

完事报告必须包含：开工/收工 SHA；旧码静默失败锁红；真实非交互 wrapper 证据；首次创建与二次 upsert 后 Scenario 实际对象/关联计数；130→1 清理结果；每个必需步骤的 nil→错误码表；全量门结果；具名 add 与禁区声明。

代码完成仍不等于关门。监理复验通过前不合入 integration、不灌装、不让 Owner 真机测 A14。
