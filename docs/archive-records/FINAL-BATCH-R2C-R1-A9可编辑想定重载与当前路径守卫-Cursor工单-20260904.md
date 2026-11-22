# FINAL-BATCH-R2C-R1：A9 可编辑想定重载与当前路径守卫 Cursor 返修工单

## 0. 结论与开工令

R2C 三轮虽然自动测试全绿，但监理逐字复核发现两项会直接破坏 Owner 真机验收的生产缺口，**当前 `4ac8593` 不得合入 integration、不得灌装、不得宣称 A9 完成**：

1. Owner 日常使用的是“可编辑想定”。现有生产 `HostScenarioReloader` 对 `LastSavedInScenEdit=true && RoleNone` 固定返回 `reload_step2_predicted`。按钮会先把备份覆盖到磁盘，然后重新加载失败，用户看到“磁盘已恢复但界面重新加载失败”，并没有完成“当前 F1 画面恢复到任务开始前”。
2. 点击回滚时没有再次读取并核对 F1 当前实际打开的想定路径。任务结束后若 Owner 切到另一个想定，按钮仍可能按旧任务路径恢复旧文件，缺少防误操作的权威路径门。

本轮在现有工作区继续，不得重建或覆盖：

- worktree：`D:\soft\F1-AI-final-r2c`
- 分支：`fix/final-a9-rollback`
- 必须开工 HEAD：`4ac8593e2b094127215e3a69b98323017fba488b`
- 历史必须原样保留：`79eef72` → `663dfa7` → `4ac8593`
- 本轮另建独立 WIP commit，建议：`final-r2c-r1 WIP: guard current scene and reload editable baseline`

不得 amend/reset/rebase 覆盖前三轮；若 HEAD、分支或源码/测试状态不符，立即停工报告。既有 `runs/` 脏项不得加入 commit。

## 1. 开工前必须逐字复核的磁盘事实

所有引用先 `rg` 再引。至少核对：

- `CMO-netcore-src/Command/AiAssistantHost/HostScenarioReloader.cs`：当前约 101–107 行对 `LastSavedInScenEdit && RoleNone` 返回 `reload_step2_predicted`。
- `CMO-netcore-src/AiAssistant.F1Core/HostScenarioLoadVerifier.cs`：生产 verifier 最终调用 `IF1AutomationFacade.TryReloadFromFile`。
- `CMO-netcore-src/AiAssistant.F1Core/ProductionTaskCoordinator.cs`：`RollbackBaselineAsync` 当前调用 `_orchestrator.TryRollbackTaskBaselineShape(taskId, targetScenePath: null)`，没有拿 `ScenePathProvider` 的当前宿主路径和 `task.ScenePath` 做最终相等校验。
- `CMO-netcore-src/Command/MainForm.cs`：生产已把 `ScenePathProvider = () => ClientCore.CurrentScenarioFullFilePath` 交给 composition，可复用，禁止另猜路径。
- `tests/F1.AiAssistant.Tests/FinalBatchR2C_A9RollbackEntryTests.cs`：现有 fake facade 测试没有覆盖真实 `HostScenarioReloader` 的可编辑想定分支，也没有覆盖“任务结束后切到另一想定”的拒绝行为。

若任一引用在当前磁盘不存在，写“未找到”并停工，不得拿报告文字代替代码事实。

## 2. 缺口 A：让可编辑想定在当前 F1 进程内安全重载

### 2.1 必须先锁红

新增生产接缝级测试，证明旧 `4ac8593` 的真实失败，而不是只测 fake facade：

1. 构造/加载 `LastSavedInScenEdit=true`、`RoleNone`、至少含一个 side 的测试想定，走生产 `HostScenarioReloader` 等价真实路径；旧码必须稳定得到 `reload_step2_predicted`。
2. 修后必须在**同一个 F1 进程**内完成重载，不弹 `ChooseSide`、不启动第二个 F1、不靠 UI 自动化。
3. 重载后至少核对：
   - `ClientCore.CurrentScenario` 已换成从恢复文件解析出的对象；
   - 当前想定路径规范化后等于任务 `ScenePath`；
   - 当前 side 由回滚前的稳定身份在恢复想定中重新解析，不能沿用指向旧 Scenario 的对象引用；
   - 想定标题/对象身份读回与恢复文件一致。
4. side 在恢复想定中不存在、重复或无法唯一解析时必须 fail-closed；不得自动选第一方，不得打开交互选择框后宣称成功。

测试若受 F1 静态全局状态影响，必须完整保存/恢复现场，不能污染其它 L1。

### 2.2 修复合同

允许最小修改：`CMO-netcore-src/Command/AiAssistantHost/HostScenarioReloader.cs`。先追踪并说明 `ClientCore.HandleScenarioLoaded` / `SetCurrentScenario` 的真实行为，再选最小安全接缝。

冻结要求：

- 保留普通非可编辑想定原行为。
- 对可编辑想定，自动重载必须显式保留“当前用户所选 side”的稳定标识（优先对象 GUID/稳定 ID；若代码中确无可靠 ID，再以唯一名称，但必须证明唯一；不得自行假定业务规则）。
- 解析恢复文件后，在新 Scenario 内重新找到该 side，再完成 host 切换；不得把旧 Scenario 的 side 对象塞入新 Scenario。
- 不允许通过永久篡改备份内容、清除 `LastSavedInScenEdit` 后另存、启动第二进程、反射私有 UI、SendKeys/鼠标点击、自动选择第一方来绕过。
- 成功必须表示磁盘与当前内存想定均已恢复；仅文件复制成功不算。
- 任何可以在覆盖目标文件前预知的 reload/side 失败，都必须在覆盖前拦截并保持目标文件字节不变。若现有接口无法预检，可做最小 typed preflight，但不得吞并成“先覆盖再试试”。
- 若覆盖后发生不可预知的宿主切换异常，仍按既有专门状态报告，不得假成功；保留恢复证据的规则要写清。

若在不修改 `Command_Core` 的前提下找不到安全接缝，立即停工并列出：查过的真实方法、阻塞点、所需最小扩围文件、甲/乙方案及各自优缺点。**禁止自行修改 `Command_Core`。**

## 3. 缺口 B：点击时权威核对当前宿主想定路径

### 3.1 必须先锁红

至少新增以下确定性反例：

1. 任务在 `A.scen` 结束，随后 `ScenePathProvider` 返回 `B.scen`；点击回滚必须返回稳定错误码 `rollback_current_scene_mismatch`，目标 A/B、partial、备份均零写，host reload 调用为 0。
2. 当前宿主路径为空、无效或规范化失败：同样 fail-closed、零写、零 reload。
3. 仅大小写/分隔符差异但规范化为同一 Windows 路径：应允许继续，避免字符串假不等。
4. UI 快照生成时路径相符、点击前切成 B：UI 即使仍显示可点，bridge/coordinator 的权威复核也必须拒绝，证明安全不只在按钮层。

### 3.2 修复合同

- 将已有 `ProductionAiOptions.ScenePathProvider` 以最小方式注入 A9 的权威控制路径；不要新增第二套场景来源。
- `RollbackBaselineAsync` 在开始回滚前重新读取当前宿主路径，并与权威任务记录 `task.ScenePath` 做规范化全路径比较。
- 在真正覆盖磁盘前还要位于同一串行控制/执行门内，避免检查后切换的明显竞态。若需把当前路径传入 orchestrator/service，只能由 production coordinator 内部传递，公开 UI/bridge 仍不得接受用户提供的 task_id 或路径。
- 不相等、空值、路径解析失败统一 fail-closed 为 `rollback_current_scene_mismatch`（诊断 detail 可细分）；补中文文案，例如“当前打开的想定不是该任务对应的想定，已停止恢复，未改动文件。”
- UI 应在能取得可信当前路径且不相符时禁用按钮；但 bridge/coordinator 必须始终二次核验。
- 仍只允许终态，Paused/Running 等规则、二次确认、命令单飞、恢复锁与 hash/身份门均不得放宽。

## 4. 获准文件范围

在证明必要的前提下，仅允许最小改动：

- `CMO-netcore-src/Command/AiAssistantHost/HostScenarioReloader.cs`
- R2C 已改的 `CMO-netcore-src/AiAssistant.F1Core/` composition/coordinator/enricher/verifier/bridge 文件
- R2C 已改的 task-control、rollback service、面板和中文错误目录文件
- `tests/F1.AiAssistant.Tests/FinalBatchR2C_A9RollbackEntryTests.cs`
- 可新建一份专门的 `FinalBatchR2CR1_*Tests.cs`

禁止改：

- `Command_Core/**`（包括 `ClientCore.cs`、`BinaryGridProvider.cs`、`Terrain.cs`）
- 模型/SSE、任务循环、审计链、数据库迁移、事件、飞机/Facility、V2.2
- `backup/`、`runs/`、owner 想定、生产 `assistant.db`

若需要超出获准范围，先停工列出逐文件理由，不得夹带。

## 5. 回归要求

除本轮锁红测试外，至少确认：

- R2C 既有具名测试全绿；
- 普通非可编辑想定重载保持原行为；
- 可编辑想定不存在 side/side 不唯一时零覆盖；
- current scene mismatch/empty/invalid 零文件副作用；
- backup task_id/hash/path/sentinel/recovery/terminal/Paused 等既有门不弱化；
- reload 失败仍不显示成功；任务历史终态不改写；
- 按钮取消、双击、命令 in-flight 行为不变；
- `reload_step2_predicted` 不得简单删除成无条件放行，必须有新的 side 重绑定证据。

## 6. 四门与 Git 纪律

修复后必须依次执行：

1. 本轮具名测试；
2. R2C/A9/TaskControl/production wiring/host reload 相关组；
3. 全量 L1：`dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore`；
4. AllInOne：`dotnet build CMO-netcore-src\F1-AllInOne.csproj -c Debug -p:Platform=x64 -t:Rebuild --no-restore`；
5. `git diff --check 4ac8593..HEAD`；
6. `git status --short`、commit 文件清单、禁区扫描。

必须具名 `git add <file>`；禁止 `git add -A` / `git add .`。不得 amend/reset/rebase，不 push/tag，不灌运行包，不启动或控制 Owner 的 F1 窗口。`runs/` 仅存日志，永不提交。

## 7. 完事报告

报告必须包括：

- 开工/收工 SHA、独立 R1 commit、逐文件必要性；
- 两类旧码锁红的逐字输出与日志路径；
- 可编辑想定如何绕开交互但仍正确保留 side，实际调用链与成功读回证据；
- current scene path 的来源、规范化比较位置、点击时二次核验与零写证明；
- 所有失败码和中文文案；
- 具名/相关/L1/AllInOne/diff/status 结果；
- 明确声明未改 Command_Core、未放宽终态/Paused/hash/身份/恢复锁门、未使用 UI 自动化、未提交禁区。

代码完成仍不等于关门。报告回来后由监理重新亲跑四门；通过后才允许合入 integration 和安排 Owner 真机点一次按钮。
