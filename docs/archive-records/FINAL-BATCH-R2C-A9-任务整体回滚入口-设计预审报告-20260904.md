# FINAL-BATCH-R2C：A9 任务整体回滚入口设计预审报告

- **日期**：2026-09-04
- **性质**：只读设计预审（零改码、零启 F1）
- **审查现场**：`D:\soft\F1-AI-integration` · 分支 `integration/stable-single-ai`
- **冻结 HEAD**：`4d93828a87c17ef01205ab69ae00be075ed9aa90`（已核验 `git rev-parse HEAD` 一致，未漂移）
- **准绳提示词**：`FINAL-BATCH-R2C-A9-任务整体回滚入口-设计预审-Cursor提示词-20260904.md`

---

## 0. 一句话结论

**功能内核有（T03 回滚服务 + T07.2 编排接缝），生产未组装、用户入口不存在；A9 不能按产品功能判通过。** 推荐方案甲：AI 面板增加「恢复到任务开始前」按钮，并先把 `ScenarioRollbackService` + 进程内加载验题器注入生产 runtime。

---

## 1. 必查事实（逐字锚点）

### 1.1 `TaskOrchestrator.TryRollbackTaskBaselineShape`

源：`CMO-netcore-src/AiAssistant/Application/TaskOrchestrator/TaskOrchestrator.cs`

```text
/// T07.2 A9 shape: callable only from terminal or Paused; uses RollbackOverride or injected adapter.
/// Does not auto-trigger on scene_write_failed (F.4).
public ScenarioRollbackResult TryRollbackTaskBaselineShape(string taskId, string targetScenePath)
{
    if (string.IsNullOrWhiteSpace(taskId)) throw new ArgumentException("taskId", nameof(taskId));
    lock (_gate)
    {
        var task = LoadTask(taskId);
        if (!(TaskStateTransitions.IsTerminal(task.State) || task.State == TaskState.Paused))
            throw new InvalidOperationException("rollback_forbidden_while_running:" + task.State);

        if (RollbackOverride != null)
            return RollbackOverride(taskId, targetScenePath);
        if (_rollback == null)
            throw new InvalidOperationException("rollback_not_configured");
        return _rollback.RollbackTaskBaseline(taskId, targetScenePath);
    }
}
```

| 项 | 事实 |
|---|---|
| 可调用条件 | 任务状态为 **终态** 或 **Paused** |
| 终态定义 | `Completed` / `Failed` / `Cancelled` / `TimedOut`（`TaskStateTransitions.IsTerminal`） |
| 运行中拒绝 | `InvalidOperationException("rollback_forbidden_while_running:" + state)` |
| 未注入服务 | `InvalidOperationException("rollback_not_configured")` |
| 空 taskId | `ArgumentException("taskId")` |
| 锁语义 | 整个方法体在 `lock (_gate)` 内；与编排其它转移共享同一把门 |
| 测试缝 | `RollbackOverride`（internal）可短路，不碰文件/F1 |
| 自动触发 | **无**；注释明确不因 `scene_write_failed` 自动回滚 |
| Recovery / sentinel | **本方法不检查** `RecoveryBlock` / `MutationRecoveryService.IsBlocked`（与 T08.5 设计草案「sentinel 存在则禁用」尚未对齐） |

构造参数默认 `ITaskBaselineRollback rollback = null`，字段 `_rollback` 可为空。

### 1.2 `ScenarioRollbackService.RollbackTaskBaseline`

源：`CMO-netcore-src/AiAssistant/Infrastructure/Backup/BackupServices.cs`

| 项 | 事实 |
|---|---|
| 门闩 | `_gate.RunExclusive(...)`（`ScenarioExecutionGate` 单锁串行） |
| 备份身份 | `task.BaselineBackupId` → `GetBackup`；校验 `backup.TaskId == taskId`、未软删、`BackupPath` 文件存在 |
| hash | 备份行 `FileHash` 为期望值；先拷到 `target + ".rollback-partial"` 算 hash，再覆盖 `target`，再验目标 hash |
| 目标路径 | `Path.GetFullPath(targetScenePath ?? task.ScenePath)` |
| 加载/恢复动作 | 磁盘覆盖成功后调用 `_verifier.LoadTitle(target, 3min)`；成功则 `_store.UpdateTaskFingerprint(taskId, after)` |
| 异常码（消息） | `task_missing` / `baseline_missing` / `baseline_backup_missing` / `baseline_task_mismatch` / `baseline_deleted` / `rollback_hash_mismatch` / `rollback_target_hash_mismatch`；缺文件为 `FileNotFoundException` |
| 失败后安全状态 | **不完全 fail-closed**：（1）temp hash 不符时目标未改，但 `.rollback-partial` **无 finally 清理**可能残留；（2）已覆盖目标后若 `LoadTitle` 失败：磁盘已是备份内容，**指纹未更新**，内存场景是否刷新取决于 verifier 实现——生产侧目前无 verifier |

基线写入侧（A8 关联）：`AtomicBackupService.CreateBackup(..., BackupKind.TaskBaseline)` 成功入库后会 `SetTaskBaselineBackupId`（同文件约 L98–99）。Planning→Locked 时编排调 `TryCreateTaskBaselineBackup`。

### 1.3 生产 composition 是否注入 rollback

源：`CMO-netcore-src/AiAssistant.F1Core/AiAssistantCompositionRoot.cs` `CreateProductionRuntime`

```text
var backups = new AtomicBackupService(paths, store, gate);
...
var orchestrator = new TaskOrchestrator(
    store, locks, tools, registry, backups,
    simulation: simulationGateway,
    orphanProbe: orphanProbe);
```

| 项 | 事实 |
|---|---|
| `AtomicBackupService` | **已注入**（可建 TaskBaseline） |
| `ScenarioRollbackService` | **未构造** |
| `ITaskBaselineRollback` / Adapter | **未注入** → `_rollback == null` |
| `IF1ScenarioLoadVerifier` 生产实现 | **未找到**（仅 `poc/T03/.../F1ConsoleScenarioLoadVerifier.cs`） |

因此：即便有人直接调 `TryRollbackTaskBaselineShape`，生产也会抛 `rollback_not_configured`。

### 1.4 AI 面板 / 任务桥 / 按钮命令

| 表面 | 按钮/命令 | 是否调用回滚 |
|---|---|---|
| `AiAssistantTaskPanel` | 执行任务 / 暂停 / 继续 / 中断 / 确认恢复 / 查看汇报 | **否**；中断文案写明「场景不会自动回滚」 |
| `AiAssistantChatPanel` | 发送 / 取消 / 诊断 | **否**；诊断为 T05.6 烟测入口 |
| `AiAssistantPanelForm.RollbackBindUnlocked` | 绑定失败回退 | **否**（解绑 runtime/bridge，非想定回滚） |
| `ITaskControlBridge` | `Start/Pause/Resume/Cancel/AcknowledgeRecovery` | **无 Rollback API** |
| `ProductionTaskControlBridge` | 同上投影 | **无回滚** |

全 `Command/` 下对 `TryRollback` / `RollbackTaskBaseline` /「恢复到任务」：**未找到**产品调用。

### 1.5 受支持的 CLI / 诊断 / Lua / operator 入口

| 入口 | 结论 |
|---|---|
| `poc/T03/T03LockBackupDemo` | POC：直构 `ScenarioRollbackService` + Console `-R/-C` 验标题；**非生产产品路径** |
| L1：`T03LockBackupTests.Rollback_restores_bytes_and_calls_verifier` | FakeVerifier 单测 |
| L1：`T07_2_ToolChainTests.F4_A9_Mock_seam_callable_only_when_terminal_or_Paused` | 仅测门闩 + Override，不碰真服务 |
| 聊天「诊断」 | T05.6，不调回滚 |
| Lua / 受支持运维 CLI | **未找到** |

### 1.6 验收矩阵 A9 与自动测试能证明到哪一层

矩阵原文（`验收矩阵.md`）：

> **A9** | 选任务备份点恢复到任务开始前 | … | AUTO_VERIFIED | T03 Console 回滚验标题（ROLLBACK_F1_TITLE） | T03 | owner 拍板甲（2026-08-20）：接受整体回滚现状，UI 选点挪二阶段 | 未跑 | 联调终验 L3 专机抽检一次整体回滚即升 MACHINE_PASS；UI 选点入口转 T08.5 backlog（P2） |

PRD v1.3：`A9 | 任务级回滚 | 选择任务备份点可成功恢复到该任务开始前的场景状态`；Q4 已确认「第一版按任务整体回滚」。

| 证明层 | 已证？ | 说明 |
|---|---|---|
| 备份文件可原子写出 + DB 记 `BaselineBackupId` | 是 | T03 / A8 路径 |
| `RollbackTaskBaseline` 覆盖工作副本 + Fake/Console 验标题 | 是（组件/POC） | `ROLLBACK_F1_TITLE:TEST` |
| 编排门闩（仅终态/Paused） | 是（Mock） | T07.2 |
| 生产注入 rollback + 进程内加载 | **否** | composition 缺口 |
| 用户可点的产品入口 | **否** | T08.5 backlog |
| 专机 MACHINE_PASS | **否** | 矩阵「专机验证：未跑」 |

AUTO_VERIFIED ≠ 用户功能闭合。

### 1.7 为何「文件菜单手工加载 `.scen`」不能当 A9 产品功能

| | 产品 `RollbackTaskBaseline` | 文件 → 加载想定（手工） |
|---|---|---|
| 身份 | 校验 task↔baseline↔backup.TaskId | 用户自选任意文件，无 DB 身份核验 |
| hash | 强制与备份 `FileHash` 一致 | 不验备份表 hash |
| Gate | 走 `ScenarioExecutionGate` | 绕过 AI 回滚服务 |
| 指纹 | 成功后 `UpdateTaskFingerprint` | **不**更新 `ai_tasks.scene_fingerprint` |
| 内存 | 依赖 verifier/LoadTitle 合同 | 主机加载成功则内存更新，但与任务记录脱钩 |
| 可证明 | 「任务整体回滚功能」 | 仅「该备份文件可被 F1 打开」 |

P3 编排报告把 File→Load 写成 owner 甲口径手测路径，**只能证明备份可加载（偏 A8 抽检）**，**不能**把 A9 产品功能报通过。二者禁止混报。

---

## 2. 产品现状总表

| 维度 | 现状 | 判语 |
|---|---|---|
| 内核能力 | `ScenarioRollbackService.RollbackTaskBaseline` + `TryRollbackTaskBaselineShape` 接缝存在 | **有** |
| 生产是否组装 | composition **未**注入 rollback / verifier | **未组装** |
| 用户入口 | 面板/桥/菜单 **无**「恢复到任务开始前」 | **无** |
| 自动测试 | 组件回滚 + Mock 门闩；无 UI/生产接线测 | **覆盖到服务层形状** |
| 真机可操作性 | 普通用户无法从产品内调用；仅 POC/手工加载 | **不可作为产品操作** |
| A9 按产品功能 | 需求是「选任务备份点恢复」；入口与接线缺失 | **不能判通过** |

**明确结论：功能内核有、用户功能未完成。禁止写「用文件菜单手动加载即可通过」。**

---

## 3. 方案比较（大白话 + 优缺点）

### 方案甲：AI 面板增加「恢复到任务开始前」按钮（推荐候选）

- 仅对 **已结束（或经 owner 确认含 Paused）且有合法基线** 的**当前绑定任务**可用；
- 文案展示将恢复的任务短 id、想定路径；二次确认；
- 只调现有 `TryRollbackTaskBaselineShape` → `RollbackTaskBaseline`，不复制逻辑；
- 成功后必须让 F1 **内存场景**与磁盘一致并刷新面板；失败中文提示，保留备份与 `.rollback-partial`/日志证据。

| 优点 | 缺点 |
|---|---|
| 用户看得懂；演示闭环；真机可验 A9 | 要动 WinForms + composition |
| 走身份/hash/Gate，可锁红 | 误点风险 → 必须二次确认 |
| 与 PRD「一键恢复到任务开始前」同向 | 需定「当前任务」语义；Paused 是否可点待拍板 |

### 方案乙：受支持的本机运维命令 / 诊断入口

- 命令显式传 `task_id` + 目标场景绝对路径；
- 仍必须走身份/hash/终态保护；
- 禁止教用户 `copy backup over scen`。

| 优点 | 缺点 |
|---|---|
| UI 改动可能更小；便于脚本 | 非程序员难用；演示不直观 |
| 可先验证生产接线 | 易选错 task_id；仍不算「产品入口」闭环 PRD 用户故事 |

### 方案丙：仅保留手工 File→Load

| 优点 | 缺点 |
|---|---|
| 零开发；应急能打开备份文件 | **不是**任务整体回滚；不更新指纹/不验身份 |
| | **不能证明 A9**；默认不接受为关门方案 |

### 方案丁（附加，不删甲乙丙）：先做「生产接线 + 无 UI 的受控诊断一键」，再补面板按钮

把乙做成 Debug/受控诊断，甲做正式入口。优点：可分两刀合入；缺点：诊断仍非用户功能，A9 关门仍要甲。

---

## 4. 推荐设计（方案甲）— 可施工级

### 4.1 最小生产文件清单（建议）

| 文件 | 作用 |
|---|---|
| `AiAssistantCompositionRoot.cs` | 构造 `ScenarioRollbackService` + Adapter，注入 `TaskOrchestrator` |
| 新建 `HostScenarioLoadVerifier`（或等价，放 F1Core） | `IF1ScenarioLoadVerifier`：进程内 `TryReloadFromFile` / 读当前 Title，**禁止**再壳出 Console 当生产默认 |
| `ITaskBaselineRollback.cs` / Adapter | 已有，接线即可 |
| `ITaskControlBridge` + `ProductionTaskControlBridge` + Coordinator | 增加 `RollbackBaselineAsync`（或同名） |
| `TaskControlViewState` / Controller | 启用条件 + 文案 |
| `AiAssistantTaskPanel.cs`（或 T08.5 历史区；本单最小可落任务条） | 增加按钮与确认框 |
| `UserFacingErrorCatalog.cs` | 中文映射上述异常码 |

测试文件清单：

| 文件 | 作用 |
|---|---|
| `T03LockBackupTests.cs` | 回归既有回滚 |
| 新建 `A9_RollbackEntryTests.cs`（名可调） | 启用/禁用、确认取消零调用、接线非 null |
| 扩展 bridge/controller 单测 | 快照驱动按钮态 |
| 可选 composition 测 | 生产 runtime `_rollback` 已配置（可反射/窄接口探测） |

### 4.2 UI 文案与启用条件

- 按钮文案：**恢复到任务开始前**
- 二次确认标题：**确认恢复想定？**
- 确认正文模板：  
  `将把当前想定恢复为任务开始前的备份。`  
  `任务：{taskId前8位}…`  
  `想定：{文件名或短路径}`  
  `此操作会覆盖磁盘上的当前工作副本，且不会自动另存你的未保存修改。是否继续？`  
  按钮：确定 / 取消
- 成功：`已恢复到任务开始前。标题：{F1Title}`
- 失败：`无法恢复：{中文原因}`（保留证据，不吞异常细节到仅英文码）

**启用（全部满足）：**

1. bridge 可用且快照有非空 `TaskId`（**禁止**猜「最后一个任务」）；
2. 状态 ∈ 终态（及 owner 若拍板含 Paused）；
3. Store 上该任务 `BaselineBackupId` 非空，备份未软删，文件存在；
4. `MutationRecoveryService.IsBlocked(taskId)` == false；
5. `RecoveryBlock` 为空（或 UI 与「确认恢复」互斥：有恢复锁时只亮确认恢复）；
6. 命令未 in-flight；锁身份一致（`LockIdentityKnown` 时 TaskId==ActiveTaskId 的既有规则）。

**禁用：** Running/Queued/Locked/ExecutingTool/Completing/Waiting*；无基线；hash/文件预检失败；sentinel；身份不一致。

### 4.3 `task_id` 从哪来

**唯一来源**：任务控制快照的 `TaskControlSnapshot.TaskId`（即当前面板绑定/展示的那条任务）。

禁止：

- 「库里最新一条任务」；
- 「上次跑过的任意 Completed」；
- 用户手填 GUID（方案甲正式入口不提供；方案乙诊断可另开且强制确认）。

无 TaskId 时按钮禁用，状态文案「当前无任务可恢复」。

### 4.4 异常路径处理

| 情况 | 处理 |
|---|---|
| Running / 非 Paused 非终态 | 按钮禁用；若仍调用 → `rollback_forbidden_while_running` →「任务仍在运行，无法恢复」 |
| Paused | **待 owner 确认**（内核允许；产品是否开放见 §5） |
| `RecoveryBlock` / 确认恢复亮起 | 禁用回滚；引导先走「确认恢复」 |
| `IsBlocked`（inflight/recovery 文件哨兵） | 禁用；**不** clear、**不** ack（对齐 T08.5 / F04.2） |
| 备份不存在 / 已软删 | 禁用或失败「任务开始前备份不可用」 |
| hash 不符 | 中止；尽量不覆盖目标；提示保留 `.rollback-partial` 供取证 |
| 路径不符（目标 ≠ 任务 ScenePath 且非显式允许） | 默认只允许恢复到 `task.ScenePath` 全路径；拒绝静默写到别的文件 |
| `rollback_not_configured` | 视为生产缺陷；中文「恢复功能未就绪」 |
| Load/Reload 失败 | 磁盘可能已覆盖：明确提示「文件已写回备份，但界面加载失败，请用文件菜单加载同一路径并联系取证」；**不要**谎称成功 |

### 4.5 磁盘 vs 内存

回滚服务只保证：磁盘目标 hash==备份 + verifier.LoadTitle。

生产 verifier **必须**基于已接线的 `IHostScenarioReloader` / `TryReloadFromFile`，使 LoadTitle 与内存加载同路径，避免「磁盘已回滚、内存仍是改后态」。

按钮成功路径顺序建议：

1. 后台：`TryRollbackTaskBaselineShape(taskId, task.ScenePath)`  
2. verifier 内已 reload → 内存更新  
3. UI 线程：刷新任务条/聊天状态；必要时触发主机「当前想定已变更」通知  

若拆成「先只写盘再单独 reload」：两步须同一成功判定，任一步失败按上表失败文案。

### 4.6 是否先保存当前想定

**默认不得静默 Ctrl+S 覆盖用户额外修改。**

推荐产品行为：确认框写明将覆盖工作副本；**不**自动保存「回滚前的脏内存」到原路径。

| 选项 | 说明 |
|---|---|
| 甲（推荐） | 不自动保存；确认文案警告未保存修改将丢失 |
| 乙 | 提供「另存当前再恢复」高级勾选（另存到用户指定路径，**绝不**默认覆盖基线备份） |

### 4.7 至少 8 条锁红测试设计

1. **Running 禁用/拒绝**：Locked 或 ExecutingTool 调入口 → `rollback_forbidden_while_running`，零次真 Rollback。  
2. **终态 + Override/Fake 成功一次**：Completed 仅调用 1 次 Rollback。  
3. **确认取消零调用**：点按钮后取消 → 服务调用次数 0。  
4. **无 BaselineBackupId**：禁用或 `baseline_missing`。  
5. **backup.TaskId 不匹配**：`baseline_task_mismatch`。  
6. **软删基线**：`baseline_deleted`，按钮禁用。  
7. **hash 破坏的备份文件**：`rollback_hash_mismatch`，目标工作副本 hash 不变（或断言未变成坏备份）。  
8. **sentinel IsBlocked**：入口禁用且不 clear inflight/recovery。  
9. **（加严）生产 composition**：CreateProductionRuntime 后 `TryRollback` 不再报 `rollback_not_configured`（可用 Fake verifier）。  
10. **（加严）Reload 失败**：磁盘已写时 UI 不得报整体成功。

### 4.8 与 A6 / A8 / D-04 / D-08 交互

| 能力 | 交互 |
|---|---|
| **A6 暂停** | 内核允许 Paused 回滚；若产品开放，回滚后锁/MustReread 状态须定义（建议回滚仅对终态开放，Paused 先 Resume 流程或先 Cancel，见 §5） |
| **A8 写前备份** | 回滚只用 **TaskBaseline**，不用 BeforeMutation 链；A8 继续负责每次写前备份可加载 |
| **D-04 身份核验** | 目标路径必须是任务 `ScenePath`；成功后指纹更新为备份 hash；与锁身份字段一致，避免「场景：锁身份不一致」误伤 |
| **D-08 恢复锁** | `RecoveryBlock` / 缺 runtime 合同存在时禁用回滚；回滚不得冒充 Clear RecoveryBlock；与「确认恢复」互斥 |

### 4.9 本单不做（红线）

| 红线 | 原因 |
|---|---|
| 单步/按工具调用撤销 | PRD Q4：V1 仅任务整体 |
| UI 直接 `File.Copy` 绕过服务 | 丢掉身份/hash/Gate |
| 自动 `scene_write_failed`→回滚 | T07.2 F.4 明确禁止本形状自动触发 |
| 用 File→Load 报 A9 MACHINE_PASS | 混报禁止 |
| clear/ack mutation sentinel | 属 F04.2 恢复链 |
| 猜最后一个 task_id | 误恢复他人任务 |
| 静默保存脏场景到工作副本后再回滚 | 掩盖用户修改 |
| 改 schema / 新恢复机制 | 超出本入口单 |
| 把 POC Console verifier 当生产默认 | 专机 GUI 路径不稳定且体验差 |

---

## 5. 待 owner 确认

### 5.1 Paused 状态能否点「恢复到任务开始前」

- **是什么**：内核 `TryRollbackTaskBaselineShape` 允许 Paused；暂停中用户可能已手改场景。  
- **甲**：仅终态可点（Paused 禁用）。  
- **乙**：Paused 也可点（与内核一致）。  
- **优点甲**：避免与 A6 手改/MustReread 纠缠。 **优点乙**：坏改后可立刻回到任务前。  
- **缺点甲**：暂停中要先中断/结束才能恢复。 **缺点乙**：与锁、重读、未保存手改交互复杂。  
- **推荐**：**甲（仅终态）**，与「任务整体回滚」心智更干净。

### 5.2 按钮放任务控制条还是等 T08.5 历史轨

- **是什么**：T08.5 草案把回滚放在「任务审计详情」；矩阵写 UI 选点 P2 backlog。  
- **甲**：本单最小落在任务控制条（有当前 TaskId）。  
- **乙**：坚持等完整历史三视图再做。  
- **优点甲**：终验可关门 A9。 **优点乙**：IA 更贴 PRD「在任务改动记录中选择」。  
- **缺点甲**：无多任务列表时只能恢复「当前绑定任务」。 **缺点乙**：A9 继续无入口。  
- **推荐**：**甲先关门**；历史轨后续增强为「选历史任务再恢复」（仍整任务基线，非单步）。

### 5.3 回滚前是否提供「另存当前」

- **甲**：只警告，不另存。  
- **乙**：确认框可选另存。  
- **推荐**：**甲**（实现更小）；若演示常误点再加乙。

### 5.4 终验是否允许「仅 POC/手工加载」升 MACHINE_PASS

- **甲**：不允许；必须产品入口或至少生产接线 + 受控诊断一键。  
- **乙**：允许 File→Load 目视升格（旧 P3 写法）。  
- **推荐**：**甲**。乙与本预审红线冲突。

---

## 6. 收工说明

- 未改源码/测试/矩阵/配置/数据库/想定；未启 F1；未 commit。  
- 本报告为唯一写出物。

**报告路径**：`D:\soft\F1-AI\FINAL-BATCH-R2C-A9-任务整体回滚入口-设计预审报告-20260904.md`

**结论**：内核有回滚、生产未接线、面板无入口 → **功能内核有、用户功能未完成**；推荐方案甲并先补 composition + 进程内 verifier，再用当前绑定 `TaskId` 做二次确认恢复。
