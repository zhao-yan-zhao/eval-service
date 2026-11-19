# 开工提示词-Q067 事件动作 spawn_units-Cursor-20261021

> 派单：Kimi（监理）｜ 执行：Cursor ｜ 日期：2026-10-21 深夜
> 优先级：**P1**（地狱景观"母机接敌投放子机"卡在这；owner 三选一拍板走 C 治本）
> 范围：**桥 C#（LuaEventTemplate 族）+ proxy 工具 schema**；进**编译波 4**，本单不编译不部署
> 红线：**不开任意 lua_script 事件动作**（owner 明示不松这道门）；不碰 .env；不连真桥

---

## 一、背景与需求

面板 AI 建地狱景观想定时报"推演中途增建单位的通道当前不可用"——owner 质问"动作里添加单元是很基本的操作，为啥不可用"。

监理已查实（行号都是真的，先核再动手）：

- 引擎原生支持：`EventAction_LuaScript`（Command_Core/EventAction_LuaScript.cs，事件触发跑任意 Lua）与 `EventAction_TeleportInArea`（Command_Core/EventAction_TeleportInArea.cs）。CMANO 标准打法=事件触发器 + Lua 动作里 `ScenEdit_AddUnit`。
- 桥事件动作白名单只有 5 种（`LuaEventTemplate.cs:18`：send_message/set_doctrine/activate_mission/end_scenario/template），没有增建单位。
- 触发器侧无需动：time/unit_destroyed/regular_time 已在白名单（AllowedTriggerTypes，同文件）。

**owner 拍板**：不做临时模板登记（路径 A 弃）、不松安检器（路径 B 弃），直接在桥加正式的 `spawn_units` 事件动作类型（路径 C，治本）。

## 二、要做什么

### 1. 桥侧：白名单加第六种事件动作 `spawn_units`

`LuaEventTemplate.cs` 的 AllowedActionTypes 追加 `"spawn_units"`，生成 Lua = 桥自己拼的 `ScenEdit_AddUnit` 调用（**桥生成的 Lua 不受 template-register 安检器约束**，所以可以用循环/偏置，不必逐条字面量）。

参数面（EventActionSpec 扩展或独立 spec，你定结构但要过现有校验风格）：

| 参数 | 约束 | 说明 |
|---|---|---|
| side | 非空字符串，沿用现有 side 校验 | 加到哪方 |
| unit_type | 枚举：Aircraft/Ship/Submarine/Facility/GroundUnit | 与模板安检器 R19 白名单同口径 |
| dbid | 正整数 | 装备库编号；**若能在建事件时查库核实存在性就做，做不到就 fail-loud 注释留"未核实"** |
| count | 1~100（上限常量可配） | 一次动作投放数量，防爆场景 |
| base_name | 可选，≤128 | 命名前缀（引擎自动编号） |
| lat / lon | 数值范围校验 | 投放中心点 |
| spread_km | 可选，0~50 | 多架时围绕中心散开（桥生成带偏置的循环） |
| altitude_ft | 可选 | Aircraft 用 |
| loadout_id | 可选，正整数 | Aircraft 用（不填=引擎默认挂载） |

校验纪律：全部 fail-closed；报错文案带字段名；沿用本文件既有异常风格。

### 2. proxy 侧：event 工具 schema 同步

proxy `tools.mjs` 里 event 相关工具的 action type 枚举加 `spawn_units` 及上述参数（注意和既有五种动作的参数校验风格一致；改动若与 Q-066 同文件，先 git 看工作树别盖别人）。

工具描述写人话+给模型一句用法提示，例：「spawn_units=推演中途增建单位（如母机接敌投放子机群）；需配触发器（time/unit_destroyed/regular_time）」。

### 3. 测试

- C#：新测试类 Q067_SpawnUnitsActionTests——参数校验全边界（type 非法/dbid 0/负数/count 超限/坐标越界/spread 超限）、生成 Lua 结构断言（含 count>1 的偏置展开）、与既有五种的共存回归。
- proxy：tools.test.mjs 追加 schema 校验用例（若动 tools.mjs 则必须）。
- test:all 行尾追加（若新增 proxy 测试文件）。

## 三、明确不做

- 不开 `lua_script` 任意脚本动作（安全门不动）。
- 不做 TeleportInArea（传送既有单位）——另一个动作类型，需要时另立单。
- 不做"投放后自动编任务"——投放后单位无任务属预期，AI 可再配 activate_mission 链。
- 不碰 Q-062/Q-064 已改段落以外的 facade 区域；CoreF1AutomationFacade.cs 如必须动，**只加不改**，编译波 4 同批。

## 四、验收口径

- C# 新套件全绿 + 既有事件测试回归绿（dotnet test filter 报告里写清）。
- proxy 相关测试绿。
- 完工报告落 LabConsole/outputs/完工报告-Q067-spawn_units-Cursor-20261021.md：改动清单、参数表终稿、生成 Lua 样例（count=3 带偏置）、DBID 存在性核实做没做、存疑清单。
- 监理后续：验收入库 → 编译波 4 统一编译部署 → 真机复验=地狱景观想定加"母机到位→投放 25 架小机"事件，起跑短局读落盘数据确认单位真出现。

## 五、背景文件（D:\soft\F1-AI）

- CMO-netcore-src/AiAssistant.F1Core/LuaEventTemplate.cs（白名单与动作构建主战场）
- Command_Core/EventAction_LuaScript.cs / EventAction_TeleportInArea.cs（引擎原生能力佐证）
- 问题台账.md Q-067 行（三路径决策记录）
- LabConsole/tools/template-register/lua_blacklist.py:325-530（安检器对 AddUnit 的字段规则——参数约束口径与其对齐，方便日后互认）
