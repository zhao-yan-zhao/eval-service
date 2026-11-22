# FINAL-BATCH-R2A：A5/A13 多轮收尾纪律返修报告

日期：2026-09-04  
结论：**通过（代码返修完成）** — 去掉无条件“收到自动结果后立即最终总结”，改为先对照用户成功标准的有界多轮纪律；A13 仍钉 `Failed(round_limit)`，未放宽无关侦察。

## 1. 开工 / 收工

| 项 | 值 |
|---|---|
| 源仓 | `D:\soft\F1-AI-integration` |
| 开工冻结 SHA | `4d93828a87c17ef01205ab69ae00be075ed9aa90` |
| worktree | `D:\soft\F1-AI-final-r2a` |
| 分支 | `fix/final-a5-rounds` |
| WIP commit | `fcdcdfb057a73ae2b010a6d0170f154db2697aa8` |
| 收工 HEAD | `fcdcdfb057a73ae2b010a6d0170f154db2697aa8` |
| 提交信息 | `final-r2a WIP: allow bounded multi-round evaluation` |

开工硬门：源仓 HEAD = 冻结 SHA；`D:\soft\F1-AI-final-r2a` 与 `fix/final-a5-rounds` 均不存在后新建。未改 `D:\soft\F1-AI` 主工作区，未在 integration 直接施工。

## 2. 文件清单（仅此 2 个纳入提交）

1. `CMO-netcore-src/AiAssistant/Application/TaskOrchestrator/ProductionTaskSystemPrompt.cs`
2. `tests/F1.AiAssistant.Tests/FinalBatchR2A_MultiRoundPromptTests.cs`（新建）

未改 `TaskOrchestrator.cs`、事件工具、配置、验收矩阵；未 push / tag / 灌装 / 启动 F1。

## 3. 旧码锁红证据

在旧提示词（`4d93828` 正文）上先加测试再修：

- 日志：`D:\soft\F1-AI-final-r2a\runs\final-r2a-lockred-20260904.log`
- 结果：**失败 5 / 通过 0 / 总计 5**

| 测试名 | 失败点 |
|---|---|
| `Prompt_rejects_unconditional_immediate_finalize_after_auto_result` | `Assert.DoesNotContain` 命中旧句「随后必须直接用中文输出最终任务总结，结束任务」 |
| `Prompt_requires_compare_user_success_criteria_then_branch` | 缺「先对照用户明文给出的成功标准」 |
| `Prompt_scopes_extra_result_read_per_run_not_whole_task` | 缺「对同一个 run」 |
| `Prompt_multi_round_only_when_user_states_criteria_and_adjust_rerun` | 缺「仅当用户明文要求可验证成功标准且未满足则调整/再跑时」 |
| `A13_round_limit_terminal_remains_Failed_not_Completed` | 缺提示词句「达到轮次上限，目标未完全满足」 |

## 4. 新旧提示词对照（收尾纪律核心）

### 旧（冲突）

- 「仿真完成后…自动注入。在该注入之后，result.read 最多只允许再补充调用 1 次…**随后必须直接用中文输出最终任务总结，结束任务**…」
- 「…**仿真完成且收到自动结果后，必须立即写最终总结**，收尾补充调用最多 1 次。」

→ 与用户「未达目标则调整再跑」明文目标自相矛盾。

### 新（冻结合同）

- 每轮系统自动注入该轮 `result.read` 保持不变。
- **对同一个 run**：注入后再补最多 1 次不同聚合维度；禁止换参数反复读同一 run；下一轮新 run 可有自己的一次系统自动结果。
- 收到该轮自动结果后**必须先对照用户明文成功标准**：
  - 已满足 → 中文总结结束；
  - 未满足且尚有轮次 → **仅当**用户明文要求可验证成功标准且未满足则调整/再跑时，允许少量相关只读、获授权写入、`scenario.save`、再发起下一轮仿真；
  - 无法安全判断/调整 → 如实总结结束，不得盲目试错；
  - 已达轮次上限 → 停止、不再发工具调用，中文说明「达到轮次上限，目标未完全满足」。
- 普通单轮任务仍直接收尾。
- 明确「多轮许可不得扩大成无关侦察」；`scenario.get_summary` 全程最多 1 次保持。

## 5. 门禁结果

| 门 | 退出码 | 数量 / 说明 | 日志 |
|---|---|---|---|
| 旧码锁红（具名 5） | ≠0（预期失败） | 失败 5，通过 0 | `runs/final-r2a-lockred-20260904.log` |
| 修后具名测试 | 0 | 失败 0，通过 5 | `runs/final-r2a-named-pass-20260904.log` |
| 相关组（含 DualRound / limit / 提示词） | 0 | 失败 0，通过 33 | `runs/final-r2a-related-20260904.log` |
| 全量 L1 | 0 | 失败 0，通过 **944** | `runs/final-r2a-l1-full-20260904.log` |
| AllInOne Rebuild x64 | 0 | **0 错误**，1138 警告 | `runs/final-r2a-allinone-20260904.log` |
| `git diff --check 4d93828..HEAD` | 0 | 无 whitespace 问题 | — |

说明：worktree 初缺 `许可注册\IntelliLock.Licensing.dll`（未入库），首次 AllInOne 报 `CS0246 IntelliLock`；从 integration 同路径拷入本地 DLL 后按工单命令 Rebuild 通过。该 DLL **未提交**。

`T07_9_DualRoundMockE2ETests` 未改；全量 L1 覆盖其通过。A13 相关 `T07_4` / DualRound 限轮路径仍为 `Failed` + `round_limit`，新测试亦钉 `LimitPriority.RoundLimitCode`、中文标签「失败」≠「已完成」、以及提示词上限句。

## 6. 最终 `git status --short`（worktree）

```
 M runs/stage5-evidence/openai-strict-request-raw.json
?? runs/final-r2a-allinone-20260904.log
?? runs/final-r2a-allinone-restore-20260904.log
?? runs/final-r2a-l1-full-20260904.log
?? runs/final-r2a-lockred-20260904.log
?? runs/final-r2a-named-pass-20260904.log
?? runs/final-r2a-related-20260904.log
```

`runs/` 脏项均未纳入提交（符合工单）。

## 7. 合同确认

1. **A13**：达 `max_rounds` 仍是 **`Failed(round_limit)` + 中文可见总结**，不算产品失败、**未改成 Completed**。
2. **未放宽无关侦察**：仍禁止与目标无关的 `contact.query` / `unit.status` / `db3k.search`；多轮口子仅限用户明文成功标准 + 调整/再跑所需的少量相关检查与授权写入。
3. **仅改提示词即可满足冻结合同**，无需扩大到编排器。
