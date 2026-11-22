# FIX-6C（批6C 合同治理：Mock/生产对齐 6 项，重发）Cursor 工单

> 完整自足提示词，owner 原样搬运。本单为**重发**：原批6C 工单文本丢失，批6C 尚未开工。批6A（D-09 integer 严格校验）已在 fix6 worktree 关门，本轮在其上继续。

## 0. 现场

- 施工目录：`D:\soft\F1-AI-fix6`（git worktree，分支 `fix/p2-contract-a`），HEAD = `48a64cf`（批6A）。
- 基线链：`6145316`（批1）→ `48a64cf`（fix-6a）。L1 基线 725/725（批6A 关门时监理亲跑）。
- 纪律：具名 `git add`（禁 -A）；`Command_Core/BinaryGridProvider.cs`、`Terrain.cs`、`backup/`、`runs/` 永不提交；每轮收工 WIP 提交。

## 1. 任务背景（D-12）

D-12 = Mock（InMemory/测试替身）与生产实现的工具合同不一致：同一工具同一输入，Mock 和生产的行为/错误码/副作用不同，导致测试通过≠生产可用。批6A 已产出全量差异清单并完成 D-09；监理已裁决本轮**只修与"演示线回合"无关的 6 项**，其余（unit.add/mission/doctrine/event 四个 stub 工具）归批6D、排在演示线回合后，**本轮不许碰**。

## 2. 本轮范围（6 项，以生产实现为准对齐 Mock）

对每个工具：先定位生产处理器与 Mock/InMemory 对应实现，grep 引用实际代码（引不到写"未找到"），列差异点，再改 Mock 对齐。**只改 Mock/测试侧；若发现生产侧才是真 bug，停工上报监理，不自行改生产。**

1. **update_position readback**：Mock 执行位置更新后应模拟生产的读回行为（生产会读回/校验实际位置状态，Mock 不得直接回成功假值）。
2. **scenario.save 失败路径**：Mock 要有与生产一致的失败路径（保存失败时的错误码/状态/副作用），不得只会成功。
3. **simulation.run Mock drain 双信号**：Mock 的 simulation.run 要复刻生产"完成 + drain"双信号语义（推演完成信号与事件导出 drain 信号分离），不得单信号假完成。
4. **simulation.stop CSV teardown + 诊断字段**：Mock 的 simulation.stop 要携带与生产一致的 teardown 行为与诊断字段（停止确认/导出收尾），字段名与生产逐字对齐。
5. **result.read isolate dir**：Mock 的 result.read 要按生产口径从隔离目录（ai/{task}/{run}）读结果，不得绕开隔离目录约定。
6. **db3k not_bound / file_missing + filters**：Mock 的 db3k 工具要复刻生产的 not_bound（库未绑定）与 file_missing（文件缺失）错误路径，以及 filters 参数的过滤语义。

## 3. 验收门

- 每项至少 1 条 L1 反例（同一输入打 Mock 和生产合同断言行为一致）；新增测试进既有测试项目；
- 全量 L1 **0 红**（= 725 + 本轮新增）：`dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore`，输出落 runs/ 不提交（restore 怪癖同前：先 restore 再 --no-restore）；
- 本轮若零生产改动：AllInOne 可免跑；**只要动了 CMO-netcore-src 下任何文件**：`dotnet build CMO-netcore-src\F1-AllInOne.csproj -c Debug -p:Platform=x64 -t:Rebuild --no-restore` 0 错（输出落 runs/）；
- 完事报告：commit 清单、6 项逐条「差异点→对齐方式→测试名」映射表、未找到/待确认项、两门输出路径。

## 4. 平行在途提示

- fix5（审计链）已关门，在 D:\soft\F1-AI-fix5；批4 返修在 D:\soft\F1-AI-fix4。均不动你的 worktree。
- 不要改 `AiAssistantStore*.cs`、`AuditHashChain.cs`、`MigrationCatalog.cs`、`AiAssistantCompositionRoot.cs`（批5 区域）；不要改 `TaskOrchestrator.cs`、`MutationRecoveryService.cs`（批4 在途）。确需触碰 → 停工上报。
