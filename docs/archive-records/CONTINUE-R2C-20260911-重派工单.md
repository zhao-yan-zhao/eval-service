# CONTINUE-R2C-20260911：A9 R1 补证重派工单（替换 20260909 版）

> 给 Cursor C 新对话窗口的重派工单（按章程「打转/忘约束立刻换窗」，不要沿用 9 月 9 日旧窗口）。9 月 9 日那次执行**失败且无有效交付**：具名/相关/全量均约 0.5–0.7 秒 exit 0 且日志无测试计数（假绿）、gate-summary 记 named=0/related=0/l1=0/allinone=1、曾尝试用 Chocolatey 联网安装 dotnet-5.0-sdk（违反离线约束）、未交付报告与知识增量。本工单替代 `CONTINUE-R2C-20260909-Cursor提示词.md`，任务目标不变，纪律收紧。

## 可直接粘贴给 Cursor 的提示词

```text
你接手 CONTINUE-R2C-20260911：A9 R1 最新候选补证与测试补强（重派）。你是执行者，不是验收者；完成后只交付证据，不能自评通过、不能合入 integration、不能制作/灌装 F1.exe。先完整读取 D:\soft\F1-AI\CONTINUE-20260909-并行执行公共约束.md 与 D:\soft\F1-AI\多模型协作章程.md，二者与本工单共同构成完整任务。

【工作区与基线】
- 只在 D:\soft\F1-AI-final-r2c 施工；分支 fix/final-a9-rollback；开工 HEAD 必须是 e15c8a330af8ba57b93041cd0902be1d35fcdd0a。
- 历史链 79eef72 -> 663dfa7 -> 4ac8593 -> e15c8a3 必须保留。禁止 reset、rebase、amend、checkout 覆盖、清理 runs，禁止修改或提交既有 runs/ 证据。
- 开工先 git status --short --branch。当前有一处既存未提交改动：tests/F1.AiAssistant.Tests/FinalBatchR2CR1_EditableReloadAndSceneGuardTests.cs（上一轮把“复制旧条件冒充锁红”的注释改成了诚实说明，方向正确）。先核对该 diff，确认无误后可具名 add 进你的 WIP 提交；若有疑义先报告，不擅自扩大改动。runs/continue-20260909-r2c-fixes/HostScenarioReloader-4ac8593.cs 是上一轮留的旧码快照，保留不提交。
- 先建立一个仅本任务、具名文件暂存的 WIP 提交：continue-r2c-20260911 WIP: A9 R1 evidence and test reinforcement。绝对禁止 git add -A。

【环境纪律（上一轮在此翻车，逐条遵守）】
- dotnet 不在 PATH，一律用全路径 "C:\Program Files\dotnet\dotnet.exe"。
- 禁止安装任何 SDK/运行时/包：不 choco、不 winget、不联网 restore、不复制 DLL。NuGet 只用 NUGET_PACKAGES=D:\soft\F1-AI\.nuget-packages；测试与构建一律 --no-restore。
- dotnet 阶段用命名 Mutex Local\F1AI_20260909_DotnetGate，同一 PowerShell 进程内 WaitOne(最多30秒)/finally ReleaseMutex/Dispose。
- 通过 = exit 0 + 日志含逐测试/总计的通过、失败、跳过实数 + 耗时与测试规模相称。0.5 秒 exit 0、日志为空或无测试计数一律作废，如实报告“未跑成”并给出阻塞原因，禁止把空日志写成通过。
- 若本机权限下出现 DPAPI、环回端口、NuGet 路径等环境阻塞，如实分类报告并留日志，不得改断言凑绿、不得联网解决。

【必读】
1. D:\soft\F1-AI\CONTINUE-20260909-并行执行公共约束.md
2. D:\soft\F1-AI\FINAL-BATCH-R2C-A9-任务整体回滚按钮-Cursor工单-20260904.md 及 完事报告-20260904.md（仅覆盖 4ac8593）
3. D:\soft\F1-AI\FINAL-BATCH-R2C-R1-A9可编辑想定重载与当前路径守卫-Cursor工单-20260904.md
4. D:\soft\F1-AI-final-r2c\runs\final-r2c-r1-20260907\ 四个原始日志（具名14/相关93/全量980 的历史记录，仅作对照，不算你本轮成绩）
5. 源码：HostScenarioReloader.cs、EditableScenarioReloadBinder.cs、ProductionTaskCoordinator.cs、HostScenarioLoadVerifier.cs、BackupServices.cs、FinalBatchR2CR1_EditableReloadAndSceneGuardTests.cs、FinalBatchR2C_A9RollbackEntryTests.cs、FinalBatchR2CContinuationTests.cs（若存在）

【任务目标（与 20260909 版相同，逐条落实）】
1. 补齐 R1 完事报告：18 个变更文件逐个说明必要性，与 R1 原工单获准范围核对，范围疑点单列；不靠全绿消除疑点。
2. 追踪真实 ClientCore.HandleScenarioLoaded/SetCurrentScenario 行为（只读 Command_Core），列出无测试 override 时的完整调用链。
3. 核对副作用边界：side 缺失/重复零覆盖；点击前切 A→B、空路径、非法路径零写/零 reload；路径比较与真正覆盖处同一执行保护；普通想定原行为；可编辑标志内存临时调整的恢复；覆盖后失败的诚实报告。
4. 现有测试按 纯 helper / Host 接缝替身 / 真实非交互解析装配 / Owner UI 四层逐项写清覆盖与缺口。只补确定性行为测试；特别是用 git show 4ac8593 的真实旧实现做隔离夹具锁红（FinalBatchR2CContinuationTests 中已有的 OldHostScenarioReloaderSnapshot4ac8593 方向是对的，核实它是否真的执行旧语义），禁止复制旧 if 冒充。
5. 验证序列至少依次：R2CR1+R2C_A9+Continuation 具名、相关组、全量 L1、CMO-netcore-src\F1-AllInOne.csproj Debug x64 Rebuild（--no-restore）。每条记录命令、退出码、通过/失败/跳过实数、耗时。

【交付（强制，缺一不算收工）】
- 报告：runs\continue-20260911-r2c-report.md
- 知识增量：runs\continue-20260911-r2c-knowledge.md（触发症状→根因→验证方法→源码位置与SHA/日志→适用范围→尚未证明）
- UTF-8 原始日志新目录 runs\continue-20260911-r2c-<时间戳>\，报告逐个引用
- 报告含：真实执行模型名、起止 SHA、四层证据对照、实际命令/退出码/实数、未证点、范围疑点、最小返修建议、最短 Owner 真机按钮点验草案（只用“恢复到任务开始前”正式按钮，同一 F1 中画面与磁盘同时恢复；另列切到不同想定拒绝、取消确认零改动、失败恢复语义）
- 不要执行真机草案。收工消息写明报告/知识/日志绝对路径，提醒监理汇总知识；明确声明“尚未独立验收或合入”。
```

## 监理留档（非提示词正文）

- 重派原因：20260909 执行假绿全灭 + 违反离线约束（choco 装 SDK）+ 无报告/知识交付；git 事实：HEAD 未动（e15c8a3），仅一份测试注释诚实化改动未提交。
- 本计划风险点（按铁律四明示）：(1) 新窗口可能把既存未提交注释改动误当自己的成果或误删——已在提示词中点名该 diff 并要求先核对；(2) 若本机 dotnet 环境本身有问题（上一轮 sdk-install 的动机未明），执行端可能再次想装 SDK——已明令禁止并要求如实报告阻塞；(3) R2C 与 R2B 共享仓库元数据与 Mutex，并行时 dotnet 阶段会自动串行，读源码不受影响。
- 该工单仅落盘，待 Owner 粘贴到 Cursor C 新窗口启动。
