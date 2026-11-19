# FINAL-RUNTIME-R2：旧终态运行记录兼容返修报告

**完成时刻：** 2026-09-02 14:50 (+08)  
**证据目录：** `D:\soft\F1-AI-integration\runs\final-runtime-r2-20260902\`  
**工单：** `D:\soft\F1-AI\FINAL-RUNTIME-R2-旧终态运行记录兼容返修-Cursor工单-20260902.md`

---

## 一、结论（先看）

残留恢复扫描现在对「schema=1 + 终态 + `recovery_block` JSON null + key/task_id 一致」的惰性旧记录做只读跳过，不再调用 `TaskRuntimeState.FromJson`；其余记录仍走严格解析并 fail-closed。  
`FromJson` 版本检查、composition「恢复异常则禁用 runtime」、schema=2 残留 block 清理语义均未改动。未触碰生产 `assistant.db`/wal/shm，未启动 F1，未 push/tag。

---

## 二、开工 / 收工基线

| 项 | 值 |
|----|-----|
| 工作区 | `D:\soft\F1-AI-integration` |
| 分支 | `integration/stable-single-ai` |
| 开工 HEAD | `a0e56757d2ff7da8cda2addbce02c4cb3f4e8643` |
| 收工 HEAD | `26effb30d3cc9989c3ad24a5f76675dc24b10575` |
| 独立 WIP commit | `26effb3` — `final-runtime-r2 WIP: ignore inert legacy terminal runtime records` |
| 开工脏项 | 仅 `runs/`（允许） |

---

## 三、改动文件 stat

```
git diff --name-status a0e5675..HEAD
M       CMO-netcore-src/AiAssistant/Application/TaskOrchestrator/TaskOrchestrator.cs
A       tests/F1.AiAssistant.Tests/FinalRuntimeR2_LegacyTerminalRuntimeTests.cs

git diff --stat a0e5675..HEAD
 .../TaskOrchestrator/TaskOrchestrator.cs           |  77 ++++++++
 .../FinalRuntimeR2_LegacyTerminalRuntimeTests.cs   | 209 +++++++++++++++++++++
 2 files changed, 286 insertions(+)
```

`git diff --check a0e5675..HEAD` → exit **0**

具名 `git add` 仅上述两路径；未 `git add -A`。

---

## 四、实现要点

在 `SweepResidualRecoveryBlocksUnlocked` 循环内、调用 `FromJson` 之前，增加 `TryClassifyInertLegacyTerminalRuntimeV1`（`JsonDocument` 只读窄口径分类）：

- 命中则记 outcome `Action=skip_legacy_terminal_runtime_v1`，**不**增加 `ActionCount`，`continue`；
- 未命中则原样 `FromJson` → 既有残留 block 清理或自然 fail-closed。

未修改：`TaskRuntimeState.cs`、`AiAssistantCompositionRoot.cs`、Store/迁移/UI/DB。

---

## 五、合同 3.1 七条件落实

| # | 条件 | 落实 |
|---|------|------|
| 1 | key 严格 `task_runtime:{taskId}` 且 taskId 非空 | `StartsWith("task_runtime:", Ordinal)` + substring 非空 |
| 2 | JSON 合法对象 | `JsonDocument.Parse` + `RootElement.ValueKind == Object`；`JsonException` → false → FromJson |
| 3 | `schema` 存在、整数、逐字 `1` | `TryGetProperty` + `Number` + `TryGetInt32` + `== 1` |
| 4 | `task_id` 非空字符串，与 key 用 `Ordinal` 一致 | `GetString` + `string.Equals(..., Ordinal)` |
| 5 | `recovery_block` 存在且 JSON `null` | 缺字段 / 非 Null → false（空串、非 null 字符串均不跳过） |
| 6 | `_store.GetTask(taskId)` 存在 | `task == null` → false |
| 7 | `TaskStateTransitions.IsTerminal` | 非终态 → false → FromJson fail-closed |

全部成立才跳过；不写库、不升级、不删 JSON。

---

## 六、锁红（先测后改）

日志：`runs/final-runtime-r2-20260902/01-lockred-FinalRuntimeR2.log`  
exit **1**（预期）

| 测试 | 旧码结果 |
|------|----------|
| `R2A_terminal_schema1_null_block_survives_RecoverOnStartup_byte_for_byte` | **FAIL** `InvalidOperationException : runtime_schema_unsupported:1` @ `FromJson` ← `SweepResidual` |
| `R2B_skip_schema1_then_still_clear_schema2_residual_block` | **FAIL** 同上 |
| R2-C … R2-G（含 missing field） | **PASS**（旧码已 fail-closed） |

合计：失败 2 / 通过 6 / 总计 8。

---

## 七、验收门结果

| 门 | 命令 / 范围 | 退出码 | 日志 |
|----|-------------|--------|------|
| Diff check | `git diff --check a0e5675..HEAD` | **0** | — |
| Named | FinalRuntimeR2 全组 + T07_7 | **0**（25 通过） | `02-named-FinalRuntimeR2-and-T07_7.log` |
| L1 全量 | `dotnet test tests\F1.AiAssistant.Tests\...\csproj --no-restore` | **0**（935 通过 / 0 失败） | `03-l1-full.log` |
| AllInOne | `dotnet build CMO-netcore-src\F1-AllInOne.csproj -c Debug -p:Platform=x64 -t:Rebuild --no-restore` | **0**（0 错误 / 1138 警告） | `04-allinone-rebuild.log` |

T07.7 含 `B1_terminal_leftover_block_converges_on_next_Recover_no_new_crash_audit` — 通过。

---

## 八、证明摘要

1. **旧 schema=1 JSON 未被改写**：R2-A / R2-B 断言 `GetSetting` 与种子字符串 `Equal`；跳过路径不调用 `Save`/`UpsertSetting`。  
2. **schema=2 残留 block 仍清理**：R2-B 在可跳过 schema=1 之后仍出现 `clear_residual_block`，`RecoveryBlock` 变 null，`ActionCount==1`。  
3. **未知/危险仍 fail-closed**：R2-C（非终态）、R2-D（非 null block）、R2-E（schema=3）、R2-F（key/task_id 不一致）、R2-G（malformed / 缺字段）均抛出并可诊断（至少含 `runtime_schema_unsupported` 或解析异常）。  
4. **不吞异常**：无 `catch { continue; }`；分类失败一律回落到 `FromJson`。

---

## 九、最终 git status（短）

工作树除既有 `runs/` 证据外无源码脏项；本单证据在 `runs/final-runtime-r2-20260902/`（未提交）。

```
# HEAD 26effb3 相对 a0e5675 仅两文件
M  CMO-netcore-src/.../TaskOrchestrator.cs
A  tests/.../FinalRuntimeR2_LegacyTerminalRuntimeTests.cs
# 工作树其余均为 runs/ 既有/本单证据（不入库）
```

---

## 十、纪律声明

- 未打开、未写入、未删除生产 `D:\soft\F1\F1-测试\data\assistant.db` 及其 `-wal`/`-shm`/备份。  
- 未启动 F1；未灌装候选运行包；未进入 A1–A16 真机终验。  
- 未 push、未 tag、未 amend/reset/rebase/stash/clean。  
- 测试数据全部在 `%TEMP%\F1.AiAssistant.FinalRuntimeR2.Tests\...` 生成。

**停下等待监理亲跑四门。** 未经监理关门，不得灌装候选运行包。
