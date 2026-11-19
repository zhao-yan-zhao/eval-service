# FIX-6D-R1 双回合测试夹具同步——Cursor 续做工单（2026-08-31）

> 可原样搬运给原 6D Cursor。结论：6D-1 生产合同对齐方向正确；当前唯一获准修复的是旧双回合 L1 测试中的两条合法 `unit.add` 样本缺少生产必填字段。只补测试数据，不改断言、不改 6D-1 源码。R1 全量归零后，才可继续原工单 6D-2→6D-3→6D-4。

## 一、开工门

- worktree：`D:\soft\F1-AI-integration`
- 分支：`integration/stable-single-ai`
- 必须开工 HEAD：`05b283b5dc5a649f9c1ee6a0c22ef5a01f4f2a5a`
- 该 HEAD 必须包含独立 commit：`fix-6d-1 WIP: align in-memory unit add contract`
- 源码/测试必须干净，仅既有 `runs/` 脏项可存在。

若 HEAD、分支或脏项不符，停工报告；禁止 reset、clean、stash、amend、rebase。

## 二、监理已核实的事实

1. `T07_9_DualRoundMockE2ETests.cs` 的 `UnitAddArgs` 和 `UnitAddArgs2` 是两次预期成功的舰船创建，但当前都只有 `side/dbname/lat/lon/name`，缺生产必填 `dbid/unit_type`。
2. 6D-1 后它们被 `PrecheckWriteTool` 正确拒绝，因此 `facade.CallLog` 只有 simulation/result，没有 `unit.add`；监理单跑已稳定复现该失败。
3. `RemediationStage2_OrchestratorTests.cs` 不获准修改：其中 `{}` 只是故意构造的损坏 journal，另一条 unit.add 在 mixed-simulation 批次门前被整体拒绝、不会执行；没有全量红证据。
4. `Fix5_AuditChainR1Tests.A2_*` 与 6D-1 无代码交集，监理单跑 1/1 通过，按既有并发偶发观察；本单禁止修改审计链或其测试。
5. 监理已亲验当前 6D-1：范围仅 facade+新测试、diff check/禁区绿；逐字校验与 `LuaUnitAddTemplate/LuaCourseTemplate` 对齐；具名相关 22/22；AllInOne csproj Rebuild 0错/1138警告。6D-1 尚未关门，因为全量 L1 未归零。

## 三、唯一获准改动

只准修改：

`tests/F1.AiAssistant.Tests/T07_9_DualRoundMockE2ETests.cs`

只准改两个常量：

- `UnitAddArgs`：保留原字段和语义，增加 `"dbid":1001,"unit_type":"Ship"`
- `UnitAddArgs2`：保留原字段和语义，增加 `"dbid":1002,"unit_type":"Ship"`

说明：生产只要求 dbid 为正整数，并未在该 Parse 阶段验证 DBID/类型对应关系；1001/1002 也是 InMemory 已种入的正整数样本。不得借此增加 DB 查询或业务规则。

不得修改：

- `BadUnitArgs`（它本来就是错误输入）
- 本文件任何断言、测试流程、暂停/恢复/审计逻辑
- `RemediationStage2_OrchestratorTests.cs`
- `Fix5_AuditChainR1Tests.cs` 或任何审计链文件
- `InMemoryF1AutomationFacade.cs`、生产 Core/Lua/schema/恢复区域
- `runs/`、`backup/`、`BinaryGridProvider.cs`、`Terrain.cs`

## 四、独立提交

只使用具名 add：

```powershell
git add tests/F1.AiAssistant.Tests/T07_9_DualRoundMockE2ETests.cs
```

新建独立 commit，严禁 amend 05b283b：

```text
fix-6d-r1 WIP: align dual-round unit add fixtures
```

## 五、验收门

先跑精确红项，必须 1/1 绿：

```powershell
dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore --filter "FullyQualifiedName~T07_9_DualRoundMockE2ETests.DualRound_mutate_run_look_pause_resume_second_round_completes_with_hash_chain"
```

再跑 T07_9 全类和 6D-1 相关组：

```powershell
dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore --filter "FullyQualifiedName~T07_9_DualRoundMockE2ETests|FullyQualifiedName~Fix6D|FullyQualifiedName~StableR3_B1|FullyQualifiedName~Demo1_UnitAdd"
```

然后必须全量 L1 0 红：

```powershell
dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore
```

最后仍按铁律亲跑 AllInOne csproj，不认 sln：

```powershell
dotnet build CMO-netcore-src\F1-AllInOne.csproj -c Debug -p:Platform=x64 -t:Rebuild --no-restore
```

并执行：

```powershell
git diff --check 05b283b5dc5a649f9c1ee6a0c22ef5a01f4f2a5a..HEAD
git show --name-status --stat HEAD
git status --short
```

所有日志落 `runs/`，永不提交。

### 并发审计偶发口径

- 全量 L1 若只有 `Fix5_AuditChainR1Tests.A2_*` 偶发失败，先精确单跑留证；单跑绿仍不等于全量门绿，必须再完整跑一次全量 L1 并取得 0 红，才能继续 6D-2。
- 全量测试若长时间无输出/不收口，停工并报告开始时间、已运行时长、最后输出、相关进程快照；不得用 kill 全局进程、跳过测试或过滤掉审计测试换绿。
- 任何其他红项立即停工，不准自行扩文件。

## 六、继续 6D-2 的条件

只有以下全部成立才可直接回到原施工工单，从 6D-2 开始：

1. R1 独立 commit 仅上述测试文件。
2. 精确红项、相关组、全量 L1 全绿。
3. AllInOne Debug x64 Rebuild 0错。
4. diff check/禁区/status 合规。

任一不成立就只交 R1 停工报告，不进入 6D-2。

## 七、报告格式

1. 开工/收工 SHA、R1 commit、历史链。
2. 两个常量的改前/改后逐字对照；确认没有改 BadUnitArgs/断言。
3. 精确红项、相关组、全量 L1、AllInOne 的退出码/数量/日志。
4. diff check、commit 文件清单、最终 status、具名 add 声明。
5. 明确：未改 RemediationStage2、审计链、6D-1 源码；未 amend/reset/rebase/push/tag；未提交 runs/禁区。
6. 若四门全绿且已继续 6D-2/3/4，再按原 6D 施工单逐轮报告，不得合并 WIP。

Cursor 自报不算关门；最终仍由监理亲跑四门。
