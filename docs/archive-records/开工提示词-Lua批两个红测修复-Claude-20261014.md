# 开工提示词 · Lua 批两个红测：裁决 + 修复（Claude）

> 背景：Cursor 编译窗口 2026-10-14 上午——编译 0 错误已过，本批 166 个相关单测 164 绿 / 2 红。Cursor 按红线停手未改。两个红测经 Kimi 裁决均为**测试侧问题，实现不动**。本单只改两个测试文件，改完报回，Cursor 复跑全绿后续部署。
> 裁决日期：2026-10-14

## 红测①：`LuaExecToolTests.Diff_unit_added_removed_changed`（LuaExecToolTests.cs:151-169）

**裁决：测试期望错了，按实现语义改测试。**

理由（已核源码与设计文档）：

1. `LuaExecDiff.DiffKeyed`（LuaExecDiff.cs:131-154）是**按键对账**：guid 在前后都在、只是行内容变了 = changed。这正是键对账存在的意义——把"变了"和"删了+建了"区分开。测试却要求旧行同时进 `RemovedUnits`，这会让 removed 失去"已从想定消失"的含义——读报告的人（或 AI）看到 `removed_units: [U-1|Alpha|Ship]` 会误判单位被删了。
2. `ChangeCount=3` 把一个逻辑变更计成两笔，计数虚高；设计文档 §6.3 的示例报文（before=34/after=34、added/removed 为空）也是计数自洽口径。
3. 变更前状态没有真丢：执行前快照落盘在 `_快照\`，要查 before 全貌随时可查，diff 报告只是" aid, not proof "（LuaExecDiff.cs 头注释 R7 口径）。

**修法**（LuaExecToolTests.cs:166-168 三行断言）：

- `d.RemovedUnits` 断言改为 `Assert.Empty(...)`；
- `d.ChangedUnits` 断言保持 `new[] { "U-1|Alpha|Submarine" }` 不变；
- `ChangeCount` 由 3 改为 **2**（1 added + 1 changed）；
- 用例内注释 `// guid 同、type 变 → changed` 后补一句：`changed 不进 removed（键对账语义，裁决 2026-10-14）`。
- 已自查：全文件只有这一处 ChangeCount 断言，无牵连用例。

## 红测②：`UnitRemoveUpdateTemplateTests.Verify_altitude_override_match_passes`（UnitRemoveUpdateTemplateTests.cs:309-316）

**裁决：测试夹具错了，高度用例应跑在航空器上，不该跑在船上。**

理由（已核引擎源码）：`ActiveUnit.DesiredAltitude` setter（ActiveUnit.cs:1206-1224）会把设值钳到 `Kinematics.GetMaximumAltitude()`——船的最大高度是 0，所以 `ship.DesiredAltitude = 5000` 实际落成 0，读回必报 `no_effect:altitude`。在船上设 5000 米高度物理上就不成立；Q-036 的真机案例本来就是航空器（翼龙II）。实现"钳制后读回不一致→保守报 no_effect"是设计行为，不动。

**修法**：

1. `BuildScenario`（UnitRemoveUpdateTemplateTests.cs:22-40）加一架航空器：照 Ship/Submarine 的构造方式加 `Aircraft`（guid 建议 `U-MUT-3`，名称如 `Mutate-AC`），方法签名加一个 `out Aircraft ac`。**先核对 Aircraft 构造函数签名与 SetUnitSide 用法**（应与 Ship/Submarine 同构），并确认 5000m 低于其 `GetMaximumAltitude()`（一般航空器升限远高于此；若该构造出来的空白航空器升限为 0 导致仍被钳，改用在断言前以反射直接写 `_DesiredAltitude` 后备字段的方式摆状态，并在注释里说明原因）。
2. `Verify_altitude_override_match_passes` 改用航空器夹具（`out _` 掉 ship）。
3. 顺带把 `Verify_altitude_override_flag_false_fails`（:319-327）与 `Verify_altitude_mismatch_fails`（:330-337）也换到航空器上——这两个现在碰巧能过（一个靠 flag 拦截、一个靠读回实际值），但在船上测高度语义就是错的，一并纠正，注释同步更新。

## 边界

- 只改上述两个测试文件；**实现代码一行不动**（LuaExecDiff.cs、CoreF1AutomationFacade.cs、LuaUnitMutateTemplate.cs 等均保持现状）。
- 不编译、不跑测试（编译复跑归 Cursor 窗口）；改完把改动点列清报回。
- 其它红线照旧。

## 改完后

报回改动清单即可。Kimi 核验后通知 owner 让 Cursor 复跑：Cursor 窗口续跑本批 166 个单测，全绿后接着做部署、真机复验①–⑧、提交（原开工单任务二三四不变）。
