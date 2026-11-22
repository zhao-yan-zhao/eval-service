# FINAL-BATCH-R2B-R3：A14 共享动作与同名事件守卫、历史锁红补证

> 给 Cursor 的单任务返修工单。审查结论是“返修后再审”，不是允许合入或宣布 A14 通过。只处理独立审查已定位的两项 P1 与旧实现锁红补证，禁止借机重构 A14。

## 可直接粘贴给 Cursor 的提示词

```text
你接手 FINAL-BATCH-R2B-R3：A14 共享动作与同名事件守卫 + 历史锁红补证。你是执行者，不是验收者；完成后只交付证据，不能自评通过、不能合入 integration、不能制作/灌装 F1.exe。

【工作区与基线】
- 只在 D:\soft\F1-AI-final-r2b 施工；分支应为 fix/final-a14-events；开始时 HEAD 必须是 a34ad8f5d3e3242463dc64c67c647e9b4ec3622f。
- 历史链 585f810 -> 2d9adee -> 42fc539 -> a34ad8f 必须保留。禁止 reset、rebase、amend、checkout 覆盖、清理 runs，禁止修改或提交既有 runs/ 证据。
- 开工先运行 git status --short --branch。当前允许既有 runs/ 日志/脚本脏项；若发现任何非本任务生产或测试源码脏改，立即停止并报告，不得吞入提交。
- 先建立一个仅本任务、具名文件暂存的 WIP 提交：final-r2b-r3 WIP: guard shared actions and ambiguous events。绝对禁止 git add -A。

【必须先完整阅读】
1. D:\soft\F1-AI\多模型协作章程.md
2. D:\soft\F1-AI\CONTINUE-20260909-并行执行公共约束.md
3. D:\soft\F1-AI\CONTINUE-R2B-20260909-Cursor提示词.md 及其 R1、R2 后续工单
4. D:\soft\F1-AI\reviews\independent-r2b-20260911.md（本工单的缺陷真源）
5. D:\soft\F1-AI\CONTINUE-R2B-20260911-监理复核记录.md
6. runs\continue-20260909-r2b-report.md 与 runs\continue-20260909-r2b-knowledge.md
7. CMO\AI\Tools\LuaEventTemplate.cs、CMO\AI\Tools\CoreF1AutomationFacade.cs、Command_Core\Lua\LuaEvent.cs（后者只读）以及现有 FinalBatchR2B* 事件测试。

【可改范围】
- 生产仅可改 CMO\AI\Tools\LuaEventTemplate.cs；只有在异常/错误传递确有必要且能说明原因时才可额外改 CoreF1AutomationFacade.cs。
- 仅可改现有相关 FinalBatchR2B* 事件测试，或新增 FinalBatchR2BR3_EventGuardTests.cs、FinalBatchR2BR3_HistoricalLockRedTests.cs。
- 报告、原始日志、知识增量只写 runs\。
- 禁止改 Command_Core、BinaryGridProvider、Terrain、ToolRegistry、schema、csproj、Mock、任务循环、A9，以及任何非本任务文件；禁止安装 SDK/NuGet、手工拷 DLL、启动 F1 或改生产数据。

【P1-1：共享“保留动作”必须 fail-closed】
独立审查已证实：LuaEventTemplate.cs 当前可对 Mine 中保留的 Mine_action_1 做 ScenEdit_SetAction update；若另一 SimEvent（如 Other）也链接同一全局 action，对 Mine 的 upsert 会暗中改掉 Other 所见脚本，却仍返回 upserted。

在任何 Lua 写入、BuildScript、事件/触发器/动作变异之前加入确定性 preflight：对于本次计划中会“保留并原地更新”的 owned action，只要该物理 action 被目标事件以外的任一 SimEvent 引用，必须拒绝本次请求。不要自动克隆、改名、解绑、删除或修复 Other；拒绝后目标/Other 的事件、触发器、动作链接和 action 脚本文本均须字节等价保持不变。无共享引用的正常 Mine -> mine 真 upsert 仍必须通过。

错误要有稳定机器可识别码（建议 event_owned_action_shared）；先查当前 facade 的真实错误传递方式，再在测试中按真实返回/异常断言。不可把错误伪装成 status=upserted，也不可只靠 UI 文案。守卫需基于 F1 实际对象和匹配语义，而不是测试侧猜测。

新增真实、非交互 Scenario_LuaSandbox 行为测试：用 Lua/API 构造 Mine 与 Other 共用一个物理 action，记录两事件配置、两者 links、动作脚本，再调用 facade 的 EventUpsert。必须证明调用失败且所有快照不变；同时覆盖未共享正常更新。

【P1-2：同名/同 ID 候选非唯一必须拒绝】
独立审查已证实：ResolvePlan/FindEventIgnoreCase 会取第一个同名 SimEvent，而 LuaEvent.Get/SetEvent 与 SetEventAction 取最后一个、SetEventTrigger 取第一个；两个描述均为 Twin 的事件可由 ScenEdit_SetEvent(mode='add') 构造，现有实现可能将状态拆到不同事件后仍报 upserted。

在任何 Lua 写入前，按当前 F1 的真实名称/ID 匹配规则收集候选。目标匹配到多于一个 SimEvent 时，必须 fail-closed，建议稳定码 event_ambiguous_event。不能静默选第一个/最后一个、不能去重或删除旧事件。新增真实 Scenario_LuaSandbox 行为测试：用实际 ScenEdit_SetEvent 添加两个 Twin，建立至少三条 action links，并在调用 facade 前后对全部 Twin 的事件/trigger/action/links/action scripts 做快照比较。调用不能是 upserted，且状态完全不变；断言不得依赖枚举顺序。

两个 preflight 必须在 BuildScript/RunLuaScript 前完成；测试要能证明不是“先部分写入再报错”。保留原有单一候选、无共享动作的行为与 R2B 现有覆盖。

【历史真实锁红补证：必须实际运行旧实现，不得伪造】
独立审查要求三个旧提交的最小、隔离、test-only 历史适配器。可为编译需要做最小签名适配，但必须在测试源码和报告中写明实际来源 git show <SHA>:<path>、保留足以证明的源代码语义，并实际执行该历史实现；绝不能复制一段 if、Assert.False(true)、手写“旧错误结果”或只检查 SHA 文本。

- 4d93828：实际调用旧 BuildScript 路径，捕获其 Time='2'，并与正确 DateTime.ToBinary 值 638409097200000000 对照，记录 LOCK_RED_OBSERVED。
- 2d9adee：实际运行旧逻辑，见证 blank first action 与 130 -> 1 的旧失败/孤儿行为。
- 42fc539：实际运行旧逻辑，见证 Mine/mine 清理、sentinel+130 -> 1、重复链接收敛的缺陷行为。

测试套件本身可以绿色：它要断言“旧实现实际产生了已知错误”，并输出 LOCK_RED_OBSERVED；这不是把当前测试故意跑红。若真实旧源码因签名/依赖无法形成最小适配器，立即停止，报告 exact git-show 文件、签名和阻塞点，不得拿假的锁红证据替代。

【验证与离线环境】
- 使用 NUGET_PACKAGES=D:\soft\F1-AI\.nuget-packages。不得用 C:\Users\Administrator\.nuget\packages，不得联网安装/复制包。若需 restore，只为修复生成 props 的离线路径并留日志。
- dotnet 阶段用项目约定的命名 Mutex 串行；记录每条实际命令、退出码、通过/失败/跳过数和耗时。0.5 秒 exit 0 且没有测试输出不计通过。
- 至少依次跑：包含新增 R3 与历史锁红的具名测试；FinalBatchR2B*；相关 A14 + Demo1C CommitB + Fix6D Event；全量 L1；F1-AllInOne.sln Debug x64 Rebuild。
- 提交前核对 42fc539..HEAD 和 4d93828..HEAD diff、git status、禁改目录扫描。只具名 git add 本任务生产/测试文件，提交信息：final-r2b-r3: guard shared actions and ambiguous events。

【交付与知识（强制）】
- 原始日志根：runs\final-r2b-r3-20260911-<timestamp>\
- 报告：runs\final-r2b-r3-20260911-report.md
- 知识增量：runs\final-r2b-r3-20260911-knowledge.md
- 报告必须列：起止 SHA、改动逐文件理由、两项 preflight 的判定规则与拒绝前快照证据、两个真实 sandbox 测试、三个旧 SHA 的 git-show 来源/实际运行输出/LOCK_RED_OBSERVED、每次测试实数、构建结果、警告、已知未覆盖的“未来定时动作真实触发”缺口，以及不合入/待独立复审声明。
- 知识文件必须记录：共享全局 action 的所有权风险；LuaEvent 同名事件 first/last API 不一致；旧码锁红的可复现取证方式；离线 NuGet 路径。收工消息必须明确写出报告、知识、原始日志的绝对路径，并提醒监理将知识增量汇总进中央知识库。
- 完成后停止等待独立复审；不得自行 merge、灌装、标记 MACHINE_PASS 或删除临时证据。
```

## 监理留档

- 基线：`D:\soft\F1-AI-final-r2b` / `fix/final-a14-events` @ `a34ad8f5d3e3242463dc64c67c647e9b4ec3622f`。
- 返修来源：`reviews\independent-r2b-20260911.md` 的 P1 共享保留动作、P1 同名事件歧义、历史真实锁红三项缺口。
- 该工单仅已落盘，尚未自动派发；验收结论仍为“不可合入”。
