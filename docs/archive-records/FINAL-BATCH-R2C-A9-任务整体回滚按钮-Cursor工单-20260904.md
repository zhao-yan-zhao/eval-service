# FINAL-BATCH-R2C：A9 任务整体回滚按钮 Cursor 工单

## 0. Owner 已拍板的最终功能

Owner 选择 **A：稳定版现在补“恢复到任务开始前”按钮**。以下规则已冻结，不得再反问或擅自换方案：

1. 按钮放在 AI 助手的任务控制区域，操作**当前面板绑定的任务**。
2. 仅 `Completed / Failed / Cancelled / TimedOut` 终态任务可用。
3. `Paused`、运行中和其它非终态都不可用，即使旧内核允许 Paused 也要在正式入口收紧。
4. 点击必须二次确认，明确提示将覆盖当前工作想定，未保存修改会丢失。
5. 不自动保存回滚前内容，不另存，不猜“最近任务”，不允许用户手填 task_id。
6. 必须走既有任务基线备份、身份、hash、执行门和指纹更新；UI 禁止直接 `File.Copy`。
7. 回滚成功必须让 F1 内存中的当前想定与磁盘恢复结果一致；只改磁盘、不刷新内存不得报成功。
8. 自由 Lua、单步撤销、历史任务选择器都不在本单。

## 1. 开工基线与独立工作区

- 源仓：`D:\soft\F1-AI-integration`
- 冻结 SHA：`4d93828a87c17ef01205ab69ae00be075ed9aa90`
- 新 worktree：`D:\soft\F1-AI-final-r2c`
- 新分支：`fix/final-a9-rollback`

开工硬门：

1. 核对源仓 HEAD 必须等于冻结 SHA。
2. worktree 路径和分支必须都不存在；任一已存在立即停工，不得覆盖、删除、清理或复用。
3. 从冻结 SHA 新建独立 worktree/分支。不得直接改 integration；不得改 `D:\soft\F1-AI` demo 主工作区。
4. 记录开工 HEAD、分支、`git status --short`。

## 2. 预审报告与已确认事实

先完整阅读并逐项核对：

`D:\soft\F1-AI\FINAL-BATCH-R2C-A9-任务整体回滚入口-设计预审报告-20260904.md`

所有引用必须先 `rg` 再引。已确认但仍需你在当前 worktree 复核：

- `ScenarioRollbackService.RollbackTaskBaseline` 已有备份身份、文件存在、hash、覆盖后验 hash、加载验证、任务指纹更新。
- `TaskOrchestrator.TryRollbackTaskBaselineShape` 有入口形状，但 production composition 没有注入 rollback，直接走会 `rollback_not_configured`。
- 生产 `IF1ScenarioLoadVerifier` 实现未找到；POC Console verifier 不能当生产默认。
- `ITaskControlBridge`、controller、任务面板目前没有 rollback 命令。
- 手工 File→Load 不等于产品 A9，禁止当实现或验收替代品。

## 3. 分三轮独立 WIP，逐轮过门

### R2C-1：安全的生产回滚接线

目标：production runtime 真正配置 rollback service，并能在当前 F1 进程内加载恢复后的同一路径。

必须满足：

1. 构造 `ScenarioRollbackService` 并通过已有 adapter/接口注入 `TaskOrchestrator`。
2. 新增最小生产 `IF1ScenarioLoadVerifier`（命名可按代码风格调整），复用磁盘上已有的主机想定加载/重载接缝；禁止启动第二个 F1、禁止外壳 Console、禁止 UI 自动化。
3. verifier 成功必须代表：当前进程已加载恢复后的目标路径，且能读回可核对的想定标题/身份；仅 `File.Exists` 或只读磁盘标题不算。
4. target 只能来自 `task.ScenePath` 的规范化全路径。正式 bridge/UI 不接受外部 target 参数。
5. production composition 测试必须证明不再 `rollback_not_configured`，但不得真覆盖 owner 文件。

安全补强一并处理：

- `.rollback-partial` 在可安全清理的成功/失败路径应收敛，不能长期堆积；若为取证必须保留，需明确条件和文案，不能所有异常都遗留。
- 覆盖磁盘后若进程内 reload 失败，不得回报整体成功；错误结果必须明确区分“磁盘已恢复但界面加载失败”，并保留可恢复证据。
- 不自动清除 recovery/inflight sentinel，不冒充“确认恢复”。

若找不到安全的进程内 reload 接缝，**R2C-1 立即停工**，逐字列出已查位置和缺口，不得用 File→Load、反射私有 UI 或启动第二进程降级替代。

建议 commit：`final-r2c-1 WIP: wire guarded production baseline rollback`

### R2C-2：任务桥与控制器命令

目标：把回滚变成任务面板能安全调用的异步命令。

冻结接口行为：

1. bridge 新增无外部 task_id/路径参数的“回滚当前绑定任务”异步命令；task_id 唯一来自当前 `TaskControlSnapshot.TaskId`。
2. 执行前重新读取权威任务状态，不能只信旧 UI snapshot。
3. 仅终态允许；Paused 必须拒绝。
4. 以下任一情况禁用/拒绝且零写：无当前任务、无基线、备份丢失/软删、task 身份不符、hash 不符、路径不符、命令 in-flight、恢复锁/哨兵存在、锁身份不一致。
5. 回滚期间其它任务控制按钮按现有 in-flight 纪律禁用，UI 线程不得阻塞。
6. 结果转换成稳定的 `TaskControlCommandResult` 与中文用户文案；机器码可留诊断明细，不得把堆栈糊脸。
7. 成功后刷新 snapshot/任务条；不得把已结束任务改回 Running，也不得篡改任务历史状态。

建议 commit：`final-r2c-2 WIP: expose terminal-task rollback command`

### R2C-3：任务面板按钮与二次确认

目标：在 `AiAssistantTaskPanel` 任务控制区增加用户可见入口。

冻结 UI：

- 按钮：`恢复到任务开始前`
- 确认框标题：`确认恢复想定？`
- 确认正文至少包含：
  - `将把当前想定恢复为该任务开始前的备份。`
  - 当前任务短 id 与想定文件名；
  - `当前未保存的修改将丢失，且不会自动另存。是否继续？`
- 成功：`已恢复到任务开始前。`
- 常见失败必须中文：任务仍在运行、暂停任务不允许、无可用基线、备份不完整、恢复功能未就绪、磁盘已恢复但界面重新加载失败、存在待处理恢复锁等。

按钮只在全部静态条件已满足时启用；即使 UI 错误启用，bridge/服务的权威检查仍必须再次拒绝，不能把安全只放在按钮层。

确认框选择取消：零 bridge 调用、零文件写入、零任务状态变化。

建议 commit：`final-r2c-3 WIP: add restore-to-task-start button`

## 4. 默认获准文件范围

按实际结构可在以下范围内做最小改动；每个文件都必须在报告中说明必要性：

- `CMO-netcore-src/AiAssistant.F1Core/AiAssistantCompositionRoot.cs`
- `CMO-netcore-src/AiAssistant.F1Core/` 下新增一个最小 host scenario verifier/adapter 文件
- `CMO-netcore-src/AiAssistant/Application/TaskOrchestrator/ITaskBaselineRollback.cs`
- `CMO-netcore-src/AiAssistant/Application/TaskOrchestrator/TaskOrchestrator.cs`（仅正式入口收紧/预检确有必要时）
- `CMO-netcore-src/AiAssistant/Infrastructure/Backup/BackupServices.cs`
- `CMO-netcore-src/AiAssistant/Infrastructure/TaskControl/TaskControlController.cs`
- 现有 `ProductionTaskControlBridge` 所在文件
- `CMO-netcore-src/Command/AiAssistantTaskPanel.cs`
- `UserFacingErrorCatalog.cs`（先 `rg` 定位真实路径）
- 新建或扩展本功能具名测试文件，优先新建 `tests/F1.AiAssistant.Tests/FinalBatchR2C_A9RollbackEntryTests.cs`

若需要改 `Client`/`MainForm`/场景加载核心或 `Command_Core` 才能做生产 reload，先停工报告最小扩围清单和理由，禁止自行越界。

## 5. 必须先锁红的测试

至少覆盖以下 12 项；旧码锁红、修后转绿：

1. production composition 的 rollback 不是 null，不再报 `rollback_not_configured`。
2. Completed 当前任务成功调用一次 rollback，使用其自身 ScenePath。
3. Failed/Cancelled/TimedOut 允许。
4. Running/Locked/ExecutingTool/Waiting*/Completing 全拒绝，零调用。
5. Paused 明确拒绝，零调用。
6. 无当前 TaskId 不猜最近任务。
7. 无 BaselineBackupId/文件丢失/软删/TaskId 不匹配分别拒绝。
8. hash 被破坏时目标文件不被坏内容覆盖。
9. sentinel/RecoveryBlock 存在时拒绝，不 clear、不 ack。
10. 确认框取消零调用、零写。
11. 回滚命令异步，不在 UI 线程同步做文件复制/加载。
12. reload 失败不得显示成功；若磁盘已覆盖，返回专门中文状态并保留证据。
13. 成功后刷新视图，但原任务终态不被改写。
14. 双击/并发点击只有一个 in-flight 调用。

测试不得只断言按钮文案存在；必须锁住生产接线、身份来源、终态收窄和零写副作用。

## 6. 逐轮门禁与最终门

每个 WIP 完成都要：

1. 具名测试；
2. A9/T03/T07.2/TaskControl 相关回归组；
3. 全量 L1：`dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore`；
4. AllInOne：`dotnet build CMO-netcore-src\F1-AllInOne.csproj -c Debug -p:Platform=x64 -t:Rebuild --no-restore`；
5. `git diff --check 4d93828..HEAD`；
6. `git status --short` 与禁区扫描。

任一全量门变红，停在该 WIP，不进入下一轮；逐条区分本轮回归与既有偶发，单跑绿不能代替全量 0 红。

## 7. Git 与禁区

- 每轮单独 WIP commit，禁止 amend 前一轮。
- 只用具名 `git add <file>`；禁止 `git add -A` / `git add .`。
- 永不提交：`runs/`、`backup/`、`Command_Core/BinaryGridProvider.cs`、`Terrain.cs`。
- 不 reset/rebase 覆盖历史，不 push/tag，不改验收矩阵，不灌运行包，不启动 F1，不控制 owner 窗口。

## 8. 完事报告

必须包含：

- 开工/每轮/收工 SHA；
- 每轮文件清单与必要性；
- 旧码锁红日志；
- production reload 的真实接缝和“内存已切换”的证明；
- 按钮启用表、确认框文案、所有失败中文映射；
- 12+ 条反例结果；
- 每轮及最终的 L1、AllInOne、diff check、status；
- 明确说明：仅终态、Paused 不允许、不自动保存、不猜 task_id、无 UI File.Copy、未清恢复哨兵。

代码完成仍不等于关门。报告回来后由监理亲跑四门；合入新候选后再由 Owner 做一次最短真机按钮点验。

