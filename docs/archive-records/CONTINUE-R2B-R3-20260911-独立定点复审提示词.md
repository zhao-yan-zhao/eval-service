# A14 R2B-R3 独立定点复审（单轮）

你是独立审查端，复审 R3 返修是否关闭了你自己在 `reviews/independent-r2b-20260911.md` 中判定的两项 P1 与历史锁红缺口。不写业务代码、不代执行端自评、不执行真机操作。按 `D:\soft\F1-AI\多模型协作章程.md` 采用高风险定点审查；角色与实际模型/档位如实记录。本轮为「返修后再审」的第二轮；两轮仍不过按章程呈报 owner 拍板，不第三轮空转。

工作区 `D:\soft\F1-AI-final-r2b`，预期 HEAD `406278fa102a8fbb3b5685a953b7976978812469`（链 585f810 → 2d9adee → 42fc539 → a34ad8f → c7a7081 → 406278f）；集成基线仍 be51696，开工核 Git 事实，HEAD/源码若变化先报告差异。既存 runs 脏项保留。R3 差异只看 `a34ad8f..406278f`。

必读：

- `D:\soft\F1-AI\reviews\independent-r2b-20260911.md`（你的上轮结论与缺陷真源）
- `D:\soft\F1-AI\FINAL-BATCH-R2B-R3-A14共享动作与同名事件守卫-Cursor工单-20260911.md`
- `D:\soft\F1-AI-final-r2b\runs\final-r2b-r3-20260911-report.md`
- `D:\soft\F1-AI-final-r2b\runs\final-r2b-r3-20260911-knowledge.md`
- `D:\soft\F1-AI\CONTINUE-R2B-R3-20260911-监理复核记录.md`（若尚未存在，报告未找到，待监理提供，不编造其结论）
- 生产 `CMO-netcore-src\AiAssistant.F1Core\LuaEventTemplate.cs`（本次唯一被改生产文件）、只读 `CoreF1AutomationFacade.cs` 与 `Command_Core\Lua\LuaEvent.cs`
- 新增测试 `FinalBatchR2BR3_EventGuardTests.cs`、`FinalBatchR2BR3_HistoricalLockRedTests.cs`

定点回答：

1. **P1-1 是否真正关闭**：`RejectIfKeepOwnedActionsShared` 的判定（ReferenceEquals 或同 ObjectID）能否被你上轮构造的「Other 链接同一物理 action」场景绕过？拒绝是否确定发生在 BuildScript/RunLuaScript 之前，拒绝后目标与 Other 的事件/trigger/action/links/脚本文本是否字节等价？有无新引入的误拒（无共享的正常 Mine→mine upsert 是否仍通）？
2. **P1-2 是否真正关闭**：`CollectEventsMatching` 的匹配规则与 F1 真实名称/ID 匹配语义是否一致（含 Description 与 ObjectID 两路、OrdinalIgnoreCase）？候选 >1 时 fail-closed 是否覆盖你指出的 first/last 拆写全部路径？单候选行为有无回退？
3. **历史锁红补证是否达标**：三份 git-show 留档与真实 `git show <SHA>` 是否一致；测试内适配器是否保留了旧实现的关键缺陷语义而非只抄片段；LOCK_RED_OBSERVED 各行是否由实际运行旧逻辑产生（对照 `named-r3-console.log` 与测试源码）；有无「断言当前实现正确」冒充「观察到旧实现错误」。
4. **范围纪律**：`a34ad8f..406278f` 是否只含 LuaEventTemplate.cs 与两份新测试；有无借机重构、改 facade、动 Command_Core/schema/csproj。
5. **已知未覆盖项的处置**：执行端自述「未来定时动作真实触发」仍未证明。明确写出该缺口是否阻止本批合入；如阻止，给出最小补证要求；如不阻止，写明理由并列入后续真机验证项。
6. 给出**可合入 / 需返修 / 需补证**的明确结论和条件；自动测试通过不是 MACHINE_PASS，不提前批准合入 integration、运行包灌装或发布。

产物：仅写 `D:\soft\F1-AI\reviews\independent-r2b-r3-20260911.md`，含审查者真实身份、完整 SHA、风险级别、逐项原文引用/行号、可复现反例、最小建议、知识增量。公共知识由监理统一汇总，不直接写 runs/knowledge.md、HANDOFF 或验收矩阵。不修改、提交、合并或清理任何其他文件，不启动 F1。

已有监理/执行测试日志可只读复核，无代码变化且证据充分时不重复整轮编译；需要新增执行时遵守公共约束中的 dotnet 命名 Mutex（`Local\F1AI_20260909_DotnetGate`）与离线 NuGet（`D:\soft\F1-AI\.nuget-packages`），所有外部访问需符合本轮无真模型/无生产数据的边界。

## 监理留档（非提示词正文）

- 本计划风险点（按铁律四明示）：(1) 复审端若只看测试绿而不核 git-show 留档真实性，可能放过伪造锁红——已要求逐 SHA 对照；(2) 守卫基于「同 ObjectID 也算共享」，可能误拒极端但合法的跨事件复用场景——要求复审端专门找误拒反例；(3) 执行端报告自述与日志一致性监理已核，但监理亲跑本轮受阻（见复核记录），复审端如需重跑须走 Mutex。
