# Cursor B：A14 最新候选补证与测试补强

先完整读取 `D:\soft\F1-AI\CONTINUE-20260909-并行执行公共约束.md`，本文件与公共约束共同构成本轮完整工单。你负责执行，不担任独立验收者。

## 基线

- 工作目录：`D:\soft\F1-AI-final-r2b`
- 分支：`fix/final-a14-events`
- 预期 HEAD：`a34ad8f5d3e3242463dc64c67c647e9b4ec3622f`
- 最新修复差异：`42fc539..a34ad8f`；整批差异：`4d93828..a34ad8f`。
- 这四个提交尚未合入 integration：585f810、2d9adee、42fc539、a34ad8f。不要重做已正确实现。

## 必读

根 `D:\soft\F1-AI` 下：

- `FINAL-BATCH-R2B-A14-事件分钟语义与真Upsert返修-Cursor工单-20260904.md`
- `FINAL-BATCH-R2B-R1-A14-Lua静默失败与动作清理边界-Cursor工单-20260904.md`
- `FINAL-BATCH-R2B-R2-A14同名大小写与历史重复关联收敛-Cursor工单-20260904.md`

本工作区下：

- `CMO-netcore-src/AiAssistant.F1Core/LuaEventTemplate.cs`
- `CMO-netcore-src/AiAssistant.F1Core/CoreF1AutomationFacade.cs`
- `tests/F1.AiAssistant.Tests/FinalBatchR2B_EventTimingTests.cs`
- `tests/F1.AiAssistant.Tests/FinalBatchR2B_EventUpsertTests.cs`
- `tests/F1.AiAssistant.Tests/FinalBatchR2BR1_EventExecutionTests.cs`
- `tests/F1.AiAssistant.Tests/FinalBatchR2BR2_EventConvergeTests.cs`

只读定位实际 LuaEvent 实现，核对 list/remove/大小写和重复关联语义；不要修改 Command_Core。

## 目标与执行

1. 建立“原工单要求 → 最新生产实现 → 测试 → 本次日志 → 未证范围”对照表。特别区分旧 r1 日志与 a34ad8f 的 R2 证据，不能拿旧日志替代当前运行。
2. 在真实非交互 Scenario_LuaSandbox 路径验证：Mine→mine、2→1；预置同名旧 sentinel 普通动作后 130→1；三重 action/trigger 关联收敛并重复执行仍幂等；保留其他事件/外部组件；所有必要操作 nil 均非假成功；相对分钟基于想定时间。
3. 先审现有测试是否覆盖；只为可证缺口补行为测试，不能只断言生成 Lua 字符串含某片段。现有测试充分则直接运行并提交证据，无需新增代码。
4. 旧码锁红只认旧实现实际执行失败的记录。没有原始证据则明确标缺口；可在本工作区临时隔离测试夹具使用 git show 读取的旧模板实际运行反例，标明夹具与生产差异。不要切退分支、覆盖生产源码、使用复制旧 if 的测试冒充锁红。
5. 完成公共约束中的具名/相关/全量 L1/AllInOne，附 git diff --check、逐文件变更与禁区核对。原有功能若失败，保留反例，报告生产缺陷，等追加工单；本轮不改生产代码。

## 允许写入

仅上述 R2B 相关测试（必要时新增 `FinalBatchR2BContinuationTests.cs`）和本工作区独立 `runs/continue-20260909-r2b-*` 产物。不改 .csproj、公开 schema、Mock、任务循环、A9 或共享文档。必要测试修订做单独 WIP commit，具名 add，不 amend。

## 必交付

- `D:\soft\F1-AI-final-r2b\runs\continue-20260909-r2b-report.md`
- `D:\soft\F1-AI-final-r2b\runs\continue-20260909-r2b-knowledge.md`
- UTF-8 原始运行日志，报告逐个引用。

报告须有完整起止 SHA、实际执行模型名（无法读取准确档位就写未知）、测试数量/退出码、旧码锁红是否真的执行、当前 Scenario 计数、未证点、最小返修建议，以及后续 A14 真机点验草案。真机草案覆盖时间、更新/缩减、消息/条令/激活既有任务三类动作的证据需求；不能把只验发消息写成全部 A14 通过。

不要执行真机草案。结束时明确提醒：“已记录知识，知识增量见上述绝对路径；尚未独立验收或合入。”
