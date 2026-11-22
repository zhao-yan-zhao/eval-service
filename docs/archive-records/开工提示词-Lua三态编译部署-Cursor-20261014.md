# 开工提示词 · Lua 三态通道批：编译 + 部署 + 真机复验 + 提交（Cursor）

> owner 2026-10-14 已放行。Claude 的 Lua 三态通道+沙箱修复批（含 Q-036 修法 B）已由 Kimi 验收通过（proxy 单测复跑 116/116 绿、关键代码点全部抽查在案）。本单：编译 → 单测 → 部署 → 真机复验 → 提交。
> 日期：2026-10-14
> 施工明细与真机复验清单以 `LabConsole\outputs\完工报告-Lua三态通道与沙箱修复-20261014.md` 为准（下称"完工报告"），先通读再动手。

## 任务一：编译 + 跑单测

1. 编译 F1-Core 与 AllInOne 两个解决方案，0 错误为达标（警告数照报）。
2. 跑 xunit 全量。本批新增/改动测试：
   - `tests\F1.AiAssistant.Tests\LuaSandboxBlockadeTests.cs`（新）
   - `tests\F1.AiAssistant.Tests\LuaScriptSecurityScannerTests.cs`（新）
   - `tests\F1.AiAssistant.Tests\LuaExecToolTests.cs`（新）
   - `tests\F1.AiAssistant.Tests\UnitRemoveUpdateTemplateTests.cs`（改，Q-036 修法 B 配套）
   - 测试工程新增 NLua/KeraLua 引用 + lua54.dll 复制，HintPath 指向 `..\..\F1\`（即 `D:\soft\F1-AI\F1\`），三个 DLL 实物已核实在位。若编译报缺引用，先核对这个路径，不要改 HintPath。
3. 任何用例红了：停手，把失败用例名+断言原文+相关源码行报回来，不要自行改测试或改实现。
4. proxy 单测（`demo-ui\proxy`，`node --test`，8 个 .test.mjs 分进程跑）Kimi 已复跑 116/116 绿，你可选择性复跑确认环境一致，不算本单判据。

## 任务二：部署到 `D:\soft\F1-AI\F1`

照旧流程，一步不许省：

1. 部署前若 F1 在跑且有未落盘想定：先 scenario.save 保存内存态草稿，再停 F1。
2. 备份 live 目录 → 覆盖部署 → 对 staging 与 live 的 DLL/exe 逐件 SHA256 核验（一致才算落位）→ `start-F1-with-bridge.bat` 启动 → 不带令牌请求桥应得 401（判活）。
3. 本批部署物比上批多：除了桥和引擎 DLL，**确认 lua54.dll / NLua.dll / KeraLua.dll 三件套仍在 F1 目录**（测试工程引用它们，运行本体也依赖）。
4. 回滚包独立目录留存，命名带日期。

## 任务三：真机复验（完工报告第四节 ①–⑧）

逐条做、逐条留证据（jsonl/截图/文件路径），做不了的标注阻塞原因：

| # | 项 | 要点 |
|---|---|---|
| ① | lua.exec 开放态全流程 | 关（缺省启动）= 三层拒绝（策略 free_lua_forbidden + 注册表无 + facade 未实现）；开（设 `F1_AI_LUA_OPEN=1` 环境变量启动桥）= 三件套齐全：执行前快照落到想定同目录 `_快照\`、脚本留档到 `runs\lua-exec-留档\`（.lua + meta.json）、执行后 diff 报告（单位/任务/事件/条令）。`/health` 应见 `lua_channel: open` 或 `restricted` |
| ② | 沙箱负例真机复核 | 开放态下用 lua.exec 直跑：脚本内 `io/os.execute/os.getenv/require/package.loadlib/luanet/import/debug.getregistry` 应均为 nil；`os.time/ScenEdit_*` 可用 |
| ③ | NLua 异常冒烟 | 推演跑一段，全程无 NLua 异常风暴（debug 表成员 nil 化不炸引擎） |
| ④ | 运行本体 `\Lua\` 目录引擎自带脚本普查 | 扫一遍 F1 自带 Lua 脚本，若命中 io/os 依赖，登记清单报回来（只查不改） |
| ⑤ | HACM 8 想定复跑 | **阻塞：等 owner 处置**（裁决 7=改写为键值/事件导出，派单未发），本单跳过并注明 |
| ⑥ | 复杂脚本 diff 一致性 | lua.exec 跑一个建单位+建事件+改条令的脚本，diff 报告与手工对账逐项一致 |
| ⑦ | idempotency_key 重放 | 同一 key 重放：快照/留档不重复生成、不覆盖 |
| ⑧ | lucas 想定试车对比 | os.date UTC 覆盖后与覆盖前基线无行为漂移（用既有 lucas 基线数据对比） |

复验全部通过后，lua.exec 才算可用；任一不过，按不可用对待并在报告里写清。

## 任务四：提交（**2026-10-14 中午已修订：仓库现状变了，以本节为准**）

**仓库现状**（Kimi 已核实）：本机已无独立 demo-ui 仓——demo-ui 已以子树方式并入 `D:\soft\F1-AI` 单仓（fd693627，原 e037d4a 等历史保留）。且今天上午 10:04–10:14 已有一批整理提交（署名 F1-AI）：Claude 的 C# Lua 批已入 `a792709d`、proxy 功能批（排队护栏+lua.exec 登记）已入 `7a6187c4`。**所以本批大部分已无需提交。**

当前工作区未提交的、属于本窗口的只剩 4 个文件，全部提交到当前分支（demo/lua-structure-tools）：

1. `CMO-netcore-src/AiAssistant.F1Core/CoreF1AutomationFacade.cs` —— 你上午的编译机械修复①（TryGetValue 改 ref 参）
2. `CMO-netcore-src/AiAssistant/Tools/JsonSchemaAndSecurity.cs` —— 你上午的编译机械修复②（out 参 definite-assignment 补 null）
3. `tests/F1.AiAssistant.Tests/LuaExecToolTests.cs` —— Claude 红测①修复（Kimi 裁决：键对账语义，changed 不进 removed）
4. `tests/F1.AiAssistant.Tests/UnitRemoveUpdateTemplateTests.cs` —— Claude 红测②修复（Kimi 裁决：高度用例换航空器夹具）

commit message 建议：`Lua 三态批收尾：编译机械修复 2 处 + 红测裁决修复 2 项（Q-034/Q-036）`。

**严禁带入**：`问题台账.md`（Kimi 自己提交）、`check_cursor_keys.py`、`tmp-*`、`cursor-extract/`、`*.bak-M7W1-*`、各交付包目录、LabConsole/、_ppt_build/、runs/。提交前 `git status` 逐行核对暂存区，只许有上述 4 个文件。提交后报哈希登记台账。

## 红线

- 不打印令牌；任何输出/日志/报告里出现令牌即事故。
- 部署前必须处理内存态想定（scenario.save），不许直接杀进程丢状态。
- 单测红了不改测试不改实现，报回来。
- 模板审批链语义不动：开放态只是 owner 显式开关（当次进程有效、重启回落收紧态），收紧态下模板通道仍是脚本动作唯一合法通道——部署和复验不许改动这套语义。
- 完工报告写到 `LabConsole\outputs\Lua三态编译部署复验-Cursor报告-20261014.md`。
