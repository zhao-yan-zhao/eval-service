# FINAL-BATCH-R2B-R2：A14 同名大小写与历史重复关联收敛 Cursor 工单

## 0. 开工令

R2B-R1 已修好“Lua 返回 nil 却假报成功”和“固定只扫到 128”；但监理逐字复核仍发现三条确定性缺口，因此 `42fc539` 暂不合入 integration。本轮只收这三个尾项，不重做已正确部分。

- worktree：`D:\soft\F1-AI-final-r2b`
- 分支：`fix/final-a14-events`
- 开工 HEAD 必须为：`42fc53982aae0f17537ad43be7740541acc4fefa`
- 保留历史：`585f810` → `2d9adee` → `42fc539`
- 新建独立 WIP，建议：`final-r2b-r2 WIP: converge case variants and duplicate event links`

禁止重建 worktree、amend/reset/rebase、提交既有 `runs/` 脏项。

## 1. 三个已确认缺口

所有引用先 `rg` 再引。

### A. 同名仅大小写不同，清理前缀却区分大小写

- F1 的 event/action 查找在 `LuaEvent.cs` 使用 `StringComparison.OrdinalIgnoreCase`；`Mine` 与 `mine` 会命中同一事件/动作。
- 当前 R1 清理用 Lua：`string.sub(_desc,1,_plen)==_prefix`，是大小写敏感。
- 因此第一次建 `Mine` 两动作，第二次以 `mine` 缩成一动作时，旧 `Mine_action_2` 不会被清理，违反同名真 upsert。

### B. 固定 list sentinel 可能与真实 action 重名

- 当前使用固定 `OwnedActionListSentinel="__f1_ai_orphan_scan__"` 调 `SetAction(mode='list', description=sentinel)`，依赖“查不到该 description 时返回全部”。
- `LuaEvent.cs` 的 list 分支会先按 description 查找；一旦想定里真实存在这个名字的 action，就只返回该匹配项，不返回全表。
- 所以 sentinel 不是可靠的“列全部”协议，清理会漏项。不得仅把 sentinel 换成另一个拍脑袋字符串或随机字符串来降低概率。

### C. 只 remove 一次不能收敛旧版本已产生的重复关联

- 旧稳定前模板对 EventAction/EventTrigger 关联反复 `mode='add'`，而 F1 add 不去重，磁盘/测试想定可能已有同一对象重复关联。
- `LuaEvent.cs` 的 remove 最终是 `List.Remove(eventAction/eventTrigger)`，一次只移除一个引用。
- 当前 R1 每个关联只 remove 一次再 add 一次：若原来有两个或更多重复引用，执行后仍多于一个；trigger recreate 还可能因为残余引用导致组件 remove/add 失败。
- 真 upsert 必须把这种历史状态收敛成恰好一个 trigger 和请求数量的 actions，而不是只保证“从干净新代码跑两次不重复”。

## 2. 必须先锁红

用真实非交互 `Scenario_LuaSandbox` 行为测试，至少覆盖：

1. 首次 `Mine` 建 2 个动作；第二次 `mine` 建 1 个动作。最终同一事件仅 1 个 action，旧 `Mine_action_2` 关联与 owned 组件均收敛；不得因大小写生成第二套组件。
2. 预置名为 `__f1_ai_orphan_scan__` 的普通/其他事件 action，再做 130→1 缩减；owned `_action_2..130` 仍全部清理，该普通 action 原样保留。旧 R1 必须在此确定性锁红。
3. 人工用真实 F1 Lua API 给同一 event 预置同一 trigger 引用至少 3 次、同一 action 引用至少 3 次，再执行一次 upsert；最终 event 的 owned trigger/action 引用各恰好一次，组件也各恰好一个。
4. 重复关联收敛后再执行一次，仍保持恰好一次，证明幂等。
5. R1 的首次创建、二次内容/时间更新、nil 错误回传、130→1、外部组件保留测试继续绿。

测试须保存/恢复 Lua singleton/global，不能污染全量 L1。

## 3. 修复合同

### 3.1 去掉不可靠 sentinel

推荐利用 `CoreF1AutomationFacade.EventUpsert` 已在 UI 串行上下文中持有的真实 `Scenario`：

- 在 C# 从 `scen.SimEvents` / `scen.EventActions` 读取当前实际事件描述和 owned action 描述；匹配规则与 F1 一致，使用 `OrdinalIgnoreCase`。
- owned 名只能严格满足“该事件规范描述 + `_action_` + 正整数”；只把序号大于本次请求数量的真实描述列表传给模板做显式解绑/删除。
- `BuildScript` 可增加内部参数承载规范事件名/待清理描述列表，但公开 tool schema 与回执不变。
- 不允许固定 sentinel、随机 sentinel、固定 128/256 上限，也不得把 schema 收紧到 128。

如采用别的方案，必须证明对任意已有 action 名都能列出全量且不碰外部组件；不能靠“这个名字一般没人用”。

### 3.2 大小写统一

- 找到现有 event 时，以该事件在 Scenario 中的实际 `Description` 作为 owned 组件规范前缀；首次创建才用请求 `event_name`。
- F1 event 查找仍按既有忽略大小写语义，不创建仅大小写不同的第二事件。
- action 更新/清理/关联全部围绕同一规范前缀。

### 3.3 清掉全部重复关联再只加一次

- 对当前 event 与 owned trigger/action 的关联，必须重复 remove 直到返回 nil，或依据当前 Scenario 中的真实重复计数执行足量 remove；随后 add 恰好一次并检查非 nil。
- 不得无限循环无保护。若用“直到 nil”，增加合理的进展/次数护栏；护栏应来自当前实际关联数或明确安全上界，而不是动作业务上限。
- trigger 只有在全部旧关联解除后才 remove/recreate；任一步必需操作 nil 继续沿用 R1 稳定错误码返回，禁止 `upserted`。
- 只收敛当前 event 的本工具稳定命名组件；其他事件和普通组件不得改变。

## 4. 获准范围与禁区

最小允许：

- `CMO-netcore-src/AiAssistant.F1Core/LuaEventTemplate.cs`
- `CMO-netcore-src/AiAssistant.F1Core/CoreF1AutomationFacade.cs`
- `tests/F1.AiAssistant.Tests/FinalBatchR2BR1_EventExecutionTests.cs`
- `tests/F1.AiAssistant.Tests/FinalBatchR2B_EventUpsertTests.cs`
- 必要时新建一份 R2 行为测试

禁止修改 `Command_Core/**`、ToolRegistry/schema、Mock、任务循环、A9、模型提示词、审计链、数据库、想定及运行包。确需扩围先停工报告。

必须保留：相对分钟=`scen.Time.AddMinutes(N).ToBinary()`、R1 所有必需步骤 nil 检查、中文错误收敛、无假成功。

## 5. 门禁、Git 与报告

具名 add；禁 `git add -A`/`.`；不提交 `runs/`、`backup/`、`BinaryGridProvider.cs`、`Terrain.cs`；不 push/tag，不启动 F1。

完成后跑：

1. R2 具名真实执行测试；
2. R2B 全组 + Demo1C + Fix6D Event；
3. 全量 L1：`dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore`；
4. AllInOne：`dotnet build CMO-netcore-src\F1-AllInOne.csproj -c Debug -p:Platform=x64 -t:Rebuild --no-restore`；
5. `git diff --check 42fc539..HEAD`、status、禁区扫描。

报告必须写：开工/收工 SHA、旧码三项锁红、规范事件名来源、无 sentinel 的全量 owned 枚举方式、重复关联如何收敛、大小写反例、真实 Scenario 最终计数、四门结果。

监理复验通过前不得合入 integration、灌装或让 Owner 真机测 A14。
