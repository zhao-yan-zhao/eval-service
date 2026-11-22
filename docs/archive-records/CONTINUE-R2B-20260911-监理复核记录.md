# A14 R2B 补证监理复核（2026-09-11）

复核人：Codex（当前会话 GPT-6，精确档位未知）。角色为调度/证据核对与亲跑验证；本报告不替代独立高风险审查，不宣告 MACHINE_PASS。Owner 本轮转交 Cursor B 收工报告。

## 基线与范围

- 实际 HEAD：`a34ad8f5d3e3242463dc64c67c647e9b4ec3622f`；分支 `fix/final-a14-events`。
- 集成 HEAD：`be51696de7cd9c481f84c0dcfa884749ddf69d12`，仍未合 R2B。
- `git diff --check 4d93828..HEAD` 通过。整批 7 文件为 CoreF1AutomationFacade、LuaEventTemplate 及五份测试；本次执行补证未改这些代码。
- status 为既存 runs 证据及本次新增日志，无生产/测试源码修改。报告曾提到 `_A7_orphan_ack_probe.cs`，本次 Test-Path=False，未清理或推断来源。
- 本监理轮新增独立 runner `D:\soft\F1-AI-final-r2b\runs\supervisor-r2b-20260911.ps1`；仅运行现有测试/构建，UTF-8 日志、固定 HEAD、命名 Mutex，未修改业务/测试实现、未提交/合并/灌装。

## Cursor 证据核对

报告与知识增量均已读取，原始日志根为 `D:\soft\F1-AI-final-r2b\runs\continue-20260909-r2b-20260911-130934`。

- 具名/相关原始日志有逐测试执行通过行，全量原始行 967/967、0 失败、0 跳过；AllInOne 0 错误、1138 警告，与报告相符。
- 测试 obj 的 NuGetPackageRoot/Folder 已是 `D:\soft\F1-AI\.nuget-packages`，测试 SDK 条件 Import 路径可用。
- 旧瞬时 exit 0 且无实际测试数量的 20260909-171135 日志作废，不计通过。
- 全量日志日期/HEAD 按本分支记录，不能混用 R2C 的 980 数字。

## 监理亲跑

| 环境/门 | 实际结果 | 原始日志 |
|---|---|---|
| 沙箱具名 | 28 通过、0 失败、0 跳过 | final-r2b/runs/supervisor-r2b-20260911-134359/named.log |
| 沙箱相关 | 39 通过、0 失败、0 跳过 | 同目录 related.log |
| 沙箱全量 | 929 通过、38 失败、0 跳过 | 同目录 l1.log |
| 正常本机权限全量 | 967 通过、0 失败、0 跳过，exit 0 | final-r2b/runs/supervisor-r2b-20260911-134909/l1.log |
| 正常本机权限 AllInOne | 0 错误、1138 警告，exit 0 | 同目录 allinone.log |

上表 `final-r2b` 表示绝对工作区 `D:\soft\F1-AI-final-r2b`。每步完整命令、时间、退出码、HEAD 见各目录 meta.jsonl。

沙箱失败包括 `failed_to_bind_mock_sse` 与用户上下文 DPAPI CryptographicException 等。按工具权限流程申请正常本机权限重新跑全量及构建；具名/相关已通过不重复。相同 HEAD、无业务/测试源码改动的正常权限全量 967/967，沙箱 38 项失败未复现，支持环境差异归因。两份失败/成功日志均保留。全量约 3 分 9 秒；AllInOne 约 17 秒。

## 逐字合同落点

- 时间：LuaEventTemplate.cs:152 的 FormatAbsoluteTriggerTime 用传入场景时间 AddMinutes 后 ToBinary；Facade.cs:698 起调用 ResolvePlan、scen.Time 和 RunLuaScript。
- 名称/孤儿：LuaEventTemplate.cs:200 起从真实 Scenario 解析规范 Description、大小写不敏感的 owned 正整数后缀和实际关联数；不存在固定 sentinel/128 清理帽。R2 行为测试走真实非交互 Scenario_LuaSandbox、断言对象数量与内容。
- 关联：LuaEventTemplate.cs:337/359/374 用有限预算重复解绑，随后再 add 一次；LuaEvent.cs:3261 起的关联 remove 只做 List.Remove，**没有**用其返回布尔值决定 nil。故正常收敛依赖预算，不能把“直到 nil”当完整证明。三重引用与二次幂等已有真实执行测试。
- 必需动作/关联创建/孤儿删除检查 nil；RunLuaScript 的双返回错误路径有专门测试。字符串检查与真实行为测试分别看待，不把每个错误分支都说成已做过失败注入。
- 外部组件：正常无共享对象样本已验证不改其他命名组件；同一个 owned 对象被其他事件引用时，底层删除存在 in-use 保护，但保留动作 update 与全流程副作用边界仍列独立定点审查，未证实为新缺陷。
- **旧实现锁红原始日志仍缺**。现行“不生成旧字符串”的测试和 wrapper seam 不能替代旧模板实际运行失败证据；本轮没有补写或伪造。

## 阶段结论与下一步

执行补证材料已接收并核对，监理本轮范围检查、合同落点复核、全量 L1 与 AllInOne 亲跑已完成；自动回归通过，可送独立定点审查。旧实现锁红证据缺口、组件共享边界和是否满足合入合同，由独立定点审查给出具体结论；见 `CONTINUE-R2B-20260911-独立定点审查提示词.md`。工单已备，未自动派发。

独立审查仍未完成；A14 未升 MACHINE_PASS，未合 integration，未安排 Owner 使用旧 a1r5 代测新代码。若独立审查仅要求旧码补证，发最小夹具任务；不无依据重写事件实现或重复整套回归。

知识已从 Cursor B 增量核证汇入根 `runs/knowledge.md` 的 2026-09-11 节；其中把“短耗时不通过”纠正为“无真实测试数量/结果不通过”，避免误伤正常快速测试。
