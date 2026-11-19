# Cursor C：A9 R1 最新候选补证与测试补强

先完整读取 `D:\soft\F1-AI\CONTINUE-20260909-并行执行公共约束.md`，本文件与公共约束共同构成本轮完整工单。你负责执行，不担任独立验收者。

## 基线

- 工作目录：`D:\soft\F1-AI-final-r2c`
- 分支：`fix/final-a9-rollback`
- 预期 HEAD：`e15c8a330af8ba57b93041cd0902be1d35fcdd0a`
- R1 差异：`4ac8593..e15c8a3`；整批差异：`4d93828..e15c8a3`。
- 历史四个提交保留：79eef72、663dfa7、4ac8593、e15c8a3；目前未合入 integration。

## 必读

根 `D:\soft\F1-AI` 下：

- `FINAL-BATCH-R2C-A9-任务整体回滚按钮-Cursor工单-20260904.md`
- `FINAL-BATCH-R2C-A9-任务整体回滚按钮-完事报告-20260904.md`（仅覆盖 4ac8593，不代表 R1）
- `FINAL-BATCH-R2C-R1-A9可编辑想定重载与当前路径守卫-Cursor工单-20260904.md`

本工作区下：

- `CMO-netcore-src/Command/AiAssistantHost/HostScenarioReloader.cs`
- `CMO-netcore-src/AiAssistant.F1Core/EditableScenarioReloadBinder.cs`
- `CMO-netcore-src/AiAssistant.F1Core/ProductionTaskCoordinator.cs`
- `CMO-netcore-src/AiAssistant.F1Core/HostScenarioLoadVerifier.cs`
- `CMO-netcore-src/AiAssistant/Infrastructure/Backup/BackupServices.cs`
- `tests/F1.AiAssistant.Tests/FinalBatchR2CR1_EditableReloadAndSceneGuardTests.cs`
- `tests/F1.AiAssistant.Tests/FinalBatchR2C_A9RollbackEntryTests.cs`
- `runs/final-r2c-r1-20260907/` 中四个原始日志。

## 已知证据与重点

历史日志为具名 14、相关 93、全量 980、AllInOne 0 错误；这只是历史执行记录，本轮报告需明确自己的运行结果。

现有 R1 测试使用 `HostScenarioReloader.LoadScenarioObjectOverride` 和 `ApplyLoadedScenarioOverride`。测试名声称 same_process，并不能单独证明真实解析文件、真实宿主切换或 UI 已恢复。`R2CR1_OldCode_editable_RoleNone_predicted_reload_step2` 中有复制旧判断的代码，也不能仅靠名称当“旧生产实现已锁红”。请逐字核对并诚实分级证据，禁止先认定这些都是产品缺陷。

## 目标与执行

1. 补齐 R1 完事报告：18 个变更文件逐个说明必要性，与 R1 原工单获准范围核对，范围疑点单列；不靠全绿消除疑点。
2. 追踪真实 ClientCore.HandleScenarioLoaded/SetCurrentScenario 行为（只读 Command_Core），列出无测试 override 时的完整调用链：当前路径读取 → 串行门 → preflight → 覆盖 → 文件解析 → 新 Scenario 中 side 重绑定 → 宿主切换 → 身份读回。
3. 核对副作用边界：预知 side 缺失/重复时是否零覆盖；点击前切 A→B、空路径、非法路径是否零写/零 reload；路径比较是否与真正覆盖处受同一执行保护；普通想定保持原行为；可编辑标志的内存临时调整如何恢复，备份字节是否不变；覆盖后不可预知失败是否诚实报告并保留证据。
4. 将现有测试分成纯 helper、Host 接缝替身、真实非交互解析/装配、Owner UI 四层，逐项写清覆盖和缺口。必要时只补确定性行为测试，特别是之前的“复制旧条件”替代真实旧实现锁红，以及 fake Apply 掩盖真实切换。能安全做的非交互真实路径验证可做；若必须加载真实 Owner 想定/GUI 才可完成，列未证，不自行控窗。
5. 旧实现锁红应实际执行 git show 对应旧实现的隔离夹具；不能修改当前生产实现后再改回来，不能复制旧 if 冒充生产回归。无法安全建立旧实现夹具时如实报告缺少旧码红日志。
6. 完成公共约束中的具名/相关/全量 L1/AllInOne，附 diff --check、逐文件变更、禁区扫描与起止状态。发现生产问题保留最小反例和逐文件修复建议，等同任务追加工单，本轮不改生产实现。

## 允许写入

仅上述两份 A9 测试（必要时新增 `FinalBatchR2CContinuationTests.cs`）和本工作区 `runs/continue-20260909-r2c-*`。不改工程/依赖、Command_Core、生产 reloader/coordinator、模型/事件/审计/数据库、integration 或共享文档。必要测试修订单独 WIP commit，具名 add，不 amend。

## 必交付

- `D:\soft\F1-AI-final-r2c\runs\continue-20260909-r2c-report.md`
- `D:\soft\F1-AI-final-r2c\runs\continue-20260909-r2c-knowledge.md`
- UTF-8 原始运行日志，报告逐个引用。

报告包括真实执行模型名（不能确定准确档位就写未知）、起止 SHA、四层证据对照、实际命令/退出码/数量、未证点、范围疑点、最小返修建议、最短 Owner 真机按钮点验草案。草案只使用“恢复到任务开始前”正式按钮，验证同一 F1 中画面与磁盘同时恢复；不得用手动打开备份替代按钮验收。另列切到不同想定拒绝、取消确认零改动、失败恢复语义。

不要执行真机草案。结束时明确提醒：“已记录知识，知识增量见上述绝对路径；尚未独立验收或合入。”
