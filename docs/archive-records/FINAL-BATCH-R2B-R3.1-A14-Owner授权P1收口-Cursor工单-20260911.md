# FINAL-BATCH-R2B R3.1：Owner 授权的一次性 A14 P1 收口工单

## 身份、边界与停止条件

这是 owner 在 2026-09-11 明确授权的**一次性窄返修**，用来处理第二轮独立复审
`reviews/independent-r2b-r3-20260911.md` 已确认的 P1 和归档完整性问题。它不是 R4，不自动触发第三轮独立审查，也不等于合入批准、`MACHINE_PASS`、灌装或发布。

- 工作区：`D:\soft\F1-AI-final-r2b`
- 分支：`fix/final-a14-events`
- 开工基线：`406278fa102a8fbb3b5685a953b7976978812469`
- 集成工作区：`D:\soft\F1-AI-integration` @ `be51696de7cd9c481f84c0dcfa884749ddf69d12`，**禁止修改**。
- 既有 `runs/` 脏项、未跟踪日志与 `runs/stage5-evidence/openai-strict-request-raw.json` 均属历史证据，保留；不清理、不纳入本次提交。
- 不启动 F1，不访问生产数据/真实模型，不安装 SDK/依赖，不手工复制 DLL，不改 `Command_Core`、schema、csproj、solution、Mock 或任务循环，不执行 `git add -A`、rebase、merge、push、灌装。
- 若需求无法在下列明确生产文件范围内安全闭合，停止并写出阻塞证据；不要扩大改动。

先完整阅读：

1. `D:\soft\F1-AI\多模型协作章程.md`
2. `D:\soft\F1-AI\HANDOFF.md`
3. `D:\soft\F1-AI\reviews\independent-r2b-r3-20260911.md`
4. `D:\soft\F1-AI\FINAL-BATCH-R2B-R3-A14共享动作与同名事件守卫-Cursor工单-20260911.md`
5. 本工单，以及候选 `runs/final-r2b-r3-20260911-report.md`、对应知识增量和原始日志。

再只读核对 `git status --short --branch`、`git log --oneline -8`、`git diff --check a34ad8f..HEAD`。若 Git 报 dubious ownership，只对命令使用 `-c safe.directory=D:/soft/F1-AI-final-r2b`，不得写全局 Git 配置。

## 本次唯一允许的生产与测试范围

允许修改的生产文件仅为：

- `CMO-netcore-src/AiAssistant.F1Core/LuaEventTemplate.cs`
- `CMO-netcore-src/AiAssistant.F1Core/CoreF1AutomationFacade.cs`

若确有必要，允许只为稳定错误码的既有机制修改：

- `CMO-netcore-src/AiAssistant/Tools/MutationNoHitErrorCodes.cs`

允许测试范围：

- `tests/F1.AiAssistant.Tests/FinalBatchR2BR3_EventGuardTests.cs`
- 新增一个仅属于本工单的 `FinalBatchR2BR31_*Tests.cs`；优先复用既有 `LuaSandboxSingleton`、`CoreFacadeFactory` 和快照方法。

运行证据只写入 `runs/final-r2b-r3.1-20260911-*`。不得修改旧报告来伪造新结论。

## 要完成的四项闭环

### 1. 真实 ToolInvocationService 链稳定拒绝

当前 `CoreF1AutomationFacade.PrecheckWriteTool("event.upsert")` 只做 `ParseAndValidate`；R3 的 `ResolvePlan` guard 因而在 `ToolInvocationService` 的 intent、备份和 inflight sentinel 之后才触发，并被降级成 `core_invoke_failed`/recovery。

在 facade 的现有 event.upsert precheck 中，先 `ParseAndValidate(args)`，再对当前 scenario 调用**同一份** `LuaEventTemplate.ResolvePlan(scen, request)`。这必须发生在任何 Lua、BuildScript、intent、备份或 sentinel 之前。不得复制另一套 guard 逻辑。

增加真实 `ToolInvocationService` 链的测试（不得只直调 facade），至少构造并断言：

- shared keep-owned action：`ToolCallResult.Ok == false` 且 `ErrorCode == "event_owned_action_shared"`；
- ambiguous Twin：`ToolCallResult.Ok == false` 且 `ErrorCode == "event_ambiguous_event"`；
- 两例均不得返回 `core_invoke_failed`，不得进入 recovery、不得遗留 inflight、不得创建写阶段 backup/intent，Scenario 快照前后一致；
- 正常的无共享 `Mine -> mine` 仍可沿工具链得到 `upserted`。

优先使 precheck 直接返回稳定码，因此不必扩大 no-hit whitelist；若实现证明 whitelist 是唯一必要改动，必须同时证明它仍在写前、不会误把真实写失败当无变更，并在报告中解释理由。

### 2. 与 F1 一致且可安全往返的事件 selector

R3 的 `CollectEventsMatching` 直接以原请求做 `OrdinalIgnoreCase` 比较；F1 `LuaEvent` 则先对输入做当前文化 `ToLower()`，再以 `OrdinalIgnoreCase` 匹配 Description/ObjectID。两者在 `zh-CN` 下对 `i` / `İ`（U+0130）不等价，可能令 preflight 规划一个事件、Lua 写另一个事件仍回 `upserted`。

在 `LuaEventTemplate` 抽出单一、可测试的 selector 规则，并让候选收集、canonical 的选择和最终 Lua 使用的 selector 遵循相同合同。实现必须：

- 精确复刻当前 F1 host 的“`ToLower()` 后 `OrdinalIgnoreCase`”查找语义，不能擅自换成 invariant 或仅 raw ordinal 比较；
- 对不能安全往返、可能让新建/后续 trigger/action API 指向不同事件的名称，在 Lua 前 fail-closed，返回稳定机器码（建议 `event_selector_not_roundtrippable`；如采用别码须在报告说明）；
- 保留 ASCII/普通大小写的 `Mine -> mine` 正常收敛；
- 不允许出现“规划 `İ`、实际修改 `i`、仍回 `upserted`”的结果。

测试必须在 `zh-CN` 显式保存并在 `finally` 恢复 `CultureInfo.CurrentCulture`/`CurrentUICulture`，用真实非交互 `Scenario_LuaSandbox` 建立 `i` 与 `İ` 的反例。断言要么写前稳定拒绝且全 Scenario 不变，要么只按清晰记录的 F1 唯一目标更新；绝不能错误目标后成功。也覆盖不存在但不可安全往返的新名称，证明不会先 add 再在后续 API 失败留下半成品。

### 3. shared action 的 ObjectID 大小写代理

将 `RejectIfKeepOwnedActionsShared` 的 ObjectID 比较调整为与 F1 查找规则一致的 `OrdinalIgnoreCase`（`ReferenceEquals` 快路径保留）。增加不同对象引用、ObjectID 仅大小写不同的行为测试；如果宿主对象无法构造这种代理，记录具体 API/类型限制和最小可复现证据，不得伪造通过。

### 4. 无损补正 R3 历史 git-show 归档

仅重建下列两份旧 archive，不改历史测试、提交或旧执行日志：

- `runs/final-r2b-r3-20260911-20260911-151359/git-show-2d9adee-LuaEventTemplate.cs`
- `runs/final-r2b-r3-20260911-20260911-151359/git-show-42fc539-LuaEventTemplate.cs`

注意：上述目录名中的年份须先以磁盘实际目录为准；当前预期目录是 `final-r2b-r3-20260911-20260911-151359`。从完整 SHA 的 Git blob 以无损字节方式重导出，不经控制台转码；然后把 UTF-8/换行规范、SHA-256 和与 `git show <sha>:CMO-netcore-src/AiAssistant.F1Core/LuaEventTemplate.cs` 的比较结果写进本轮 raw log。比较必须为内容一致；若无法无损重建，报告阻塞，不得继续声称“原始全文”。不需要因 archive 重建而重跑六项历史锁红，除非历史适配器源码本身发生改动。

## 构建、测试与证据纪律

使用同一 mutex、离线 NuGet 路径 `D:\soft\F1-AI\.nuget-packages`。每条命令保存原始 stdout/stderr、exit code、开始/结束时间、HEAD 和工作目录；零字节或无测试汇总的 exit 0 不计通过。

至少执行并报告：

1. 新增 R3.1 具名测试和 R3 guard 具名测试；
2. `FinalBatchR2B*` 全量；
3. 相关 A14 / Demo1C / Fix6D；
4. L1 全量；
5. `F1-AllInOne.csproj` Debug x64 Rebuild；
6. 原工单要求的 `F1-AllInOne.sln` Debug x64 Rebuild 只可如实尝试和记录。

第 6 项若仍受 `BasicDevTool` 外部 post-build copy/资产失败影响：不得更改外部环境、不得以 csproj 成功替代 solution 成功、不得标绿；保留精确失败日志，等待 owner 后续决定是否修复或豁免这一门。R3.1 结束时也不自动发起新独立复审。

只将本工单明确许可的生产/测试源码提交，提交前逐文件 `git diff --check` 和 `git diff --name-only <baseline>..HEAD`；建议提交信息：

`final-r2b-r3.1: precheck event guards and align selectors`

## 报告、知识与回传格式（强制）

完成后在候选工作区写：

- `runs/final-r2b-r3.1-20260911-report.md`
- `runs/final-r2b-r3.1-20260911-knowledge.md`
- `runs/final-r2b-r3.1-20260911-<timestamp>\` 原始日志目录。

知识增量必须记录：真实工具链 precheck 的顺序与错误码合同、F1 文化 selector/不可往返名称规则、ObjectID 大小写语义、archive 无损导出和 hash 验证方法、solution gate 的实际状态与边界。提醒：知识不是口头总结；写完文件后在回传中给出绝对路径。

回传只给证据：HEAD、精确文件列表、每个新测试的实际断言和结果、所有门禁数字/日志路径、archive hash/比较结果、solution gate 实况、风险/未覆盖项。禁止写“独立复审通过”“可合入”“MACHINE_PASS”“已灌装/发布”。完成报告和知识后停止，等待监理/owner 指令。
