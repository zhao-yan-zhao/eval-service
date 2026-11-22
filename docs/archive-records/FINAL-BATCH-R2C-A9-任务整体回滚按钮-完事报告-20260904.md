# FINAL-BATCH-R2C：A9 任务整体回滚按钮 完事报告

- **日期**：2026-09-04
- **工作区**：`D:\soft\F1-AI-final-r2c`
- **分支**：`fix/final-a9-rollback`
- **冻结基线**：`4d93828a87c17ef01205ab69ae00be075ed9aa90`
- **收工 HEAD**：`4ac8593e2b094127215e3a69b98323017fba488b`

---

## 1. SHA 轨迹

| 节点 | SHA | 说明 |
|---|---|---|
| 开工基线 | `4d93828a87c17ef01205ab69ae00be075ed9aa90` | integration 冻结点；worktree 新建 |
| R2C-1 | `79eef72bf6150b829ca631ae3b5ee49421862aa5` | 生产 rollback 接线 + Host verifier |
| R2C-2 | `663dfa7cd935e5d50ffe335e87f6711461f2e824` | bridge/controller 终态回滚命令 |
| R2C-3 / 收工 | `4ac8593e2b094127215e3a69b98323017fba488b` | 面板按钮 + 二次确认 |

未 push、未 tag、未 amend 前一轮。

---

## 2. 每轮文件清单与必要性

### R2C-1
| 文件 | 必要性 |
|---|---|
| `AiAssistantCompositionRoot.cs` | 构造 `ScenarioRollbackService` + Adapter 注入 Orchestrator |
| `HostScenarioLoadVerifier.cs`（新建） | 生产 `IF1ScenarioLoadVerifier`：进程内 `TryReloadFromFile` + `CaptureScenarioIdentity` |
| `BackupServices.cs` | `.rollback-partial` 收敛；reload 失败区分 `rollback_disk_restored_reload_failed` |
| `FinalBatchR2C_A9RollbackEntryTests.cs` | 锁红 composition / hash / reload 失败 |

### R2C-2
| 文件 | 必要性 |
|---|---|
| `ProductionTaskCoordinator.cs` | 权威重读任务态；仅终态；Paused 拒绝；目标仅 `task.ScenePath` |
| `ProductionTaskControlBridge.cs` | 异步 `RollbackBaselineAsync`（无外部 task_id/路径参数） |
| `TaskControlController.cs` / `TaskControlViewState.cs` | 启用条件 + ConfirmRollback + in-flight |
| `UserFacingErrorCatalog.cs` | 失败中文映射 |
| Adapter 桩补齐（LockIdentity / 测试 Fake） | 接口扩展后编译对齐 |
| 具名测试扩展 | 终态/Paused/无任务/基线/哨兵/并发 |

### R2C-3
| 文件 | 必要性 |
|---|---|
| `AiAssistantTaskPanel.cs` | 「恢复到任务开始前」按钮、确认框、成功/失败文案、绑定 `RollbackEnabled` |
| `FinalBatchR2C_A9RollbackEntryTests.cs` | 面板源码文案锁 + 确认取消零调用等 |

未改 `Client`/`MainForm`/`Command_Core`；进程内 reload 走已有 `IF1AutomationFacade.TryReloadFromFile`。

---

## 3. Production reload 接缝与“内存已切换”证明

真实接缝：

1. 磁盘覆盖完成（hash 过门）后，`ScenarioRollbackService` 调 `_verifier.LoadTitle(target, …)`。
2. 生产 verifier = `HostScenarioLoadVerifier`：
   - `_facade.TryReloadFromFile(canonical, …)` — 当前 F1 进程加载恢复后路径；
   - `_facade.CaptureScenarioIdentity()` — 读回内存 `ScenarioObjectId`（及 Title）；
   - 身份缺失 / reload 失败 → `rollback_disk_restored_reload_failed:…`，**不得**当整体成功。
3. 成功后服务更新任务指纹；UI 刷新 snapshot，**不**把终态改回 Running。

证明：`R2C1_HostVerifier_reloads_then_reads_in_memory_identity_title`（reload 后读身份）；`R2C1_HostVerifier_reload_fail_does_not_treat_disk_as_success` / `R2C2_Reload_fail_maps_chinese_and_not_success`。

禁止路径均未使用：File→Load 替代、反射私有 UI、第二进程 Console verifier、UI `File.Copy`。

---

## 4. 按钮启用表 / 确认框 / 中文失败映射

**启用（全部满足）**：有当前 `TaskId`；状态 ∈ Completed/Failed/Cancelled/TimedOut；基线可用；无 RecoveryBlock；无 mutation sentinel；锁身份一致；非 command in-flight。

**禁用**：Running/Locked/ExecutingTool/Waiting*/Completing/Queued/Planning；**Paused**；无任务；无基线；哨兵/恢复锁；身份不符。

| UI | 文案 |
|---|---|
| 按钮 | `恢复到任务开始前` |
| 确认标题 | `确认恢复想定？` |
| 确认正文 | 含「将把当前想定恢复为该任务开始前的备份。」+ 短 task id + 想定文件名 +「当前未保存的修改将丢失，且不会自动另存。是否继续？」 |
| 成功 | `已恢复到任务开始前。` |
| 取消 | `user_declined` → 零 bridge、零写 |

| 机器码/前缀 | 中文 |
|---|---|
| `rollback_forbidden_while_running*` | 任务仍在运行，无法恢复 |
| `rollback_forbidden_while_paused` | 暂停任务不允许恢复到任务开始前 |
| `baseline_missing` | 无可用基线，无法恢复到任务开始前 |
| `baseline_backup_missing` / `baseline_deleted` | 备份不完整，无法恢复 |
| `rollback_not_configured` | 恢复功能未就绪 |
| `rollback_disk_restored_reload_failed*` | 磁盘已恢复但界面重新加载失败，请保留现场证据 |
| `recovery_blocked` | 存在待处理恢复锁，请先确认恢复 |
| `no_current_task` | 当前无任务可恢复 |

---

## 5. 反例结果（具名测试，全绿）

| # | 覆盖 | 测试 |
|---|---|---|
| 1 | composition 非 null / 非 `rollback_not_configured` | `R2C1_Production_composition…` |
| 2 | Completed 一次调用，用自身 ScenePath | `R2C2_Completed_calls_rollback_once…` |
| 3 | Failed/Cancelled/TimedOut 允许 | `R2C2_Terminal_states_allow_rollback` |
| 4 | Running 族全拒绝零调用 | `R2C2_NonTerminal_rejects_zero_calls` |
| 5 | Paused 明确拒绝 | `R2C2_Paused_explicitly_rejected_zero_calls` |
| 6 | 无 TaskId 不猜最近 | `R2C2_No_current_task_does_not_guess_latest` |
| 7 | 无基线/文件丢失/软删/TaskId 不符 | `R2C2_Baseline_missing_file_soft_delete_mismatch_reject` |
| 8 | hash 破坏不覆盖目标 | `R2C1_Hash_mismatch_cleans_partial…` |
| 9 | sentinel 拒绝且不 clear/ack | `R2C2_Sentinel_blocks_without_clear_or_ack` |
| 10 | 确认取消零调用 | `R2C3_Confirm_cancel_zero_bridge_calls` |
| 11 | 异步离 UI 同步路径 | `R2C2_Bridge_dispatches_rollback_off_caller_sync_context` |
| 12 | reload 失败非成功 + 中文 | `R2C2_Reload_fail_maps_chinese…` / `R2C1_Reload_fail_after_disk…` |
| 13 | 视图启用收紧 / 终态不回写 Running | View + Coordinator 路径（成功刷新 snapshot，状态保持终态） |
| 14 | 双击仅一 in-flight | `R2C3_Double_click_single_in_flight` |

另：面板源码文案锁 `R2C3_Panel_source_locks_button_and_confirm_copy`；中文目录 `R2C3_Chinese_catalog…`。

具名：27 通过；相关回归组：116 通过。

---

## 6. 门禁结果

| 轮次 | L1 全量 | AllInOne Rebuild | diff --check | status 禁区 |
|---|---|---|---|---|
| R2C-1 | 见 `runs/r2c1-l1-full.txt` | 绿 | 绿 | 仅 runs 未提交 |
| R2C-2 | 965 通过 | 0 错误 | 绿 | 仅 runs 未提交 |
| R2C-3 | **966 通过 / 0 失败** | **0 错误 / 1136 警告** | **绿** | 仅 `runs/*` 与既有 evidence 脏文件未提交 |

---

## 7. 冻结红线声明（逐条）

- **仅终态**可回滚；**Paused 不允许**（产品入口收紧，即使旧内核曾允许）。
- **不**自动保存回滚前内容；**不**另存；确认框明示未保存修改丢失。
- **不**猜最近 task_id；正式入口**无**手填 task_id；唯一来源当前面板绑定快照。
- UI **无** `File.Copy`；走 Gate + 身份 + hash + verifier。
- **未** clear / ack recovery / inflight sentinel；有恢复锁时禁用回滚。
- 磁盘已恢复但 reload 失败 → 专门中文错误，保留 `.rollback-partial` 等证据，**不**报成功。

---

## 8. 交接

代码三轮 WIP 已在 `fix/final-a9-rollback`。  
**代码完成 ≠ 关门**：请监理亲跑四门；合入新候选后由 Owner 做最短真机按钮点验。

工作区：`D:\soft\F1-AI-final-r2c` · HEAD `4ac8593e2b094127215e3a69b98323017fba488b`
