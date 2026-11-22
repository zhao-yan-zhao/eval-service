# 开工提示词 · Lua 三态通道 + 沙箱修复（Claude 施工，Cursor 编译窗口合并）

> 给 Claude 的开工单。owner 2026-10-13 裁定：现行 Lua 限制"因噎废食"，改成**三态制**；沙箱封锁段（现版本被注释、没生效）**必须修复**。
> 优先级：高，次于并行池化。
> 日期：2026-10-13

## 冲突声明（先看这个）

Cursor 手上正在跑"T1 修复+桥扩能批"编译窗口（改动涉及 `ToolRegistry.cs`、`proxy\tools.mjs` 等）。本任务会碰**同一批文件**（ToolRegistry.cs 要注册新工具、tools.mjs 要加面板侧条目）。因此：

- **第 0 步（设计文档）现在就可以开工**，纯文档零冲突；
- **第 1 步起（动代码）必须等 Cursor 那批落地提交后再动手**——开工前先 `git -C D:\soft\F1-AI\CMO-netcore-src log --oneline -3` 和 `git -C D:\soft\F1-AI\demo-ui log --oneline -3` 确认 T1 批已提交，没提交就停下报 owner，不抢跑。

## 任务一句话

把 Lua 通道从"只有白名单模板"改成**三态制**，并把引擎沙箱的真实封锁建起来。

## 三态定义（owner 已拍板，照此设计）

1. **收紧态（默认）**：和今天一样——只有白名单模板动作和已登记模板可用，任何任意 Lua 被拒。演示、批跑、默认状态都是它。
2. **模板快速通道（中间态，长期常备）**：自定义脚本走"AI 写 → lua_blacklist 安检 → owner 扫一眼确认 → 本地登记工具一分钟备案（`LabConsole\tools\template-register\`，已完工）→ 立即可用"。这条路的工具链已就绪，本任务只需把它写进 skill 和文档，不改代码。
3. **开放态**：桥开新工具（暂名 `lua.exec`），接受任意 Lua 脚本，配强制三件套：
   - **执行前自动快照**：当前想定自动另存带时间戳副本（快照目录建议 `F1-测试\Scenarios\AI\测试场\_快照\`），快照路径随结果返回；
   - **执行后自动对账**：对比执行前后的单位数/任务数/事件数/条令状态，生成"脚本改了啥"清单随结果返回（diff 抓结构变化，抓不了数值合理性——文档里如实写明这个边界）；
   - **脚本原文留档**：每段执行过的脚本存 `LabConsole\runs\lua-exec-留档\`（时间戳命名），可倒查。
   - **开关**：环境变量 `F1_AI_LUA_OPEN=1` 开、缺省/缺席=收紧；**桥（或 F1）重启后自动回落收紧态**——开关只活在当次进程里，这是最自然的"回落"实现。开工提示词里加一行即开（owner 指定方式）。
   - 开放态下 lua_blacklist 安检**降级为警告不拦截**（警告随结果返回），拦不拦的边界在设计文档里论证后报 owner。

## 沙箱修复（先于 lua.exec 的硬前置）

源码实锤：`CMO-netcore-src\Command_Core\Lua\LuaSandBox.cs:248-259` 的封锁段被整段注释，`LuaSandBox.cs:714` 执行的是空串——**当前想定里的 Lua 理论上碰得到文件系统和系统命令**。

修复要求：
- 恢复封锁段，但**逐条论证去留**（设计文档里给清单：每条禁令禁的是什么、为什么禁/为什么留）；
- 大方向（owner 意图）：**脚本不许碰文件系统、不许执行系统命令**（禁 `io`、`os.execute/os.exit/os.remove/os.rename/os.tmpname`、`require`、`package.*`、`load/loadfile/loadstring`、`dofile`、`rawget/rawset`、`module`、`string.dump`、`newproxy`）；脚本要留数据走想定内键值/事件导出，不需要文件读写；
- 注意 `GameGeneral.PE_Lua_AllowIO` 开关的存在——恢复后的逻辑要尊重这个开关还是写死，设计文档里给建议；
- 保留推演世界内的全部能力（ScenEdit_* 全家桶、math/string/table 等）；
- **回归风险必查**：七月以来的存量想定（尤其"打击LUCAS"参考想定，`D:\soft\F1\F1-测试\Scenarios\lucas\`）内嵌脚本若用了 io/os，恢复封锁后会失效——设计文档里列出存量脚本依赖普查方法和结果。

## 执行步骤

0. **设计文档**（可先开工）：`LabConsole\outputs\设计-Lua三态通道与沙箱修复-20261013.md`——三态状态机、开关实现位置（桥/引擎各一层？）、lua.exec 的请求/响应契约、快照与 diff 的具体实现、沙箱封锁逐条清单、存量脚本依赖普查、proxy 面板侧暴露策略（建议面板默认不暴露 lua.exec，开放态走 CLI；论证后报 owner）、风险清单。报 owner 审定。
1. 设计审定后施工：C# 侧（沙箱恢复 + lua.exec + 白名单/schema）+ proxy 侧；写 xunit 与 node 单测（沙箱负例：脚本内 `io`/`os.execute` 应为 nil；三态开关行为；快照生成；diff 正确性；留档）。
2. 完工报告 + 待真机项清单，交 Cursor 编译窗口（可争取与 T1 批同窗，若 T1 已提交则下一窗）。

## 红线

- 不编译（编译归 Cursor）；不启动 F1、不连 9477；
- 不碰 `D:\soft\F1\F1\` 运行本体；
- git 留痕不提交；
- 模板登记审批链（Q-028）语义不许绕：开放态是 owner 显式开关，不是默认通道；
- 桥令牌只从 `LabConsole\workorders\.bridge-token` 读，任何输出不打印。

## 依据文档（开工前必读）

- `D:\soft\F1-AI\方案-Lua通道开放-20261013.md`（owner 拍板的三方案原文，本单=方案一+二+三合体）；
- `D:\soft\F1-AI\LabConsole\outputs\事件动作能力摸底-20261013.md`（桥/引擎事件与 Lua 现状全图）；
- `D:\soft\F1-AI\LabConsole\outputs\桥接口扩能完工报告-WRA事件单位-20261013.md`（同域上一批改动的边界与惯例）。
