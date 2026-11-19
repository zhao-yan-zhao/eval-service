# 开工提示词 · HACM 外部脚本改写（Cursor）· Q-039

> 背景：昨天（10-14）8 个 HACM 想定的**内嵌**事件脚本已从 io 落盘改写为想定键值通道（owner 裁决 7 首选 `ScenEdit_SetKeyValue`），静态自验全绿，今早真机复跑 MC-1 判据 5/6 通过（报告：`LabConsole\outputs\HACM改写真机复跑-MC1-20261015.md`）。但想定的 tick 动作仍保留一条 `ScenEdit_RunScript` 外部链，指向**磁盘上的外部 Lua**——这些外部文件里还有未加防护的 `io.open` 和 `dofile` 兜底，沙箱下会死在被 pcall 吞掉的报错里，导致蒙卡遥测（`HACM_MC_Tick`）根本不启动。本单把这两组外部脚本同样改写为键值通道，补上最后一环。
> 日期：2026-10-15

## 任务

改写两组共 4 个外部 Lua 文件（两组内容应保持同步一致）：

- 组一：`D:\soft\HACM_MC\HACM_MC_EventTick.lua`（约 2 KB）+ `D:\soft\HACM_MC\HACM_MC_Telemetry.lua`（约 68 KB）
- 组二（0803cursor 想定 RunScript 指向的 ZXY 镜像）：`D:\ZXY\20260730-ceshi\HACM_MC_EventTick.lua` + `D:\ZXY\20260730-ceshi\HACM_MC_Telemetry.lua`

### 已知病灶（EventTick.lua，已通读，供参考；Telemetry.lua 需你自行通读盘点）

- L16：`io.open` 读 `D:/shuchu/active_out_dir.txt` 决定输出目录（注意根是 `D:/shuchu/`，不是 HACM_MC）；
- L29–46：`append_line` / `write_w` 两个 io.open 工具函数；
- L52–56：每 tick 写 `mc_tick_log.csv`（追加）+ `mc_pulse.txt`（覆盖）；
- L58–69：若 `HACM_MC_Tick` 函数不存在则 `RunScript`/`dofile` 加载 Telemetry.lua（`dofile` 沙箱下为 nil，兜底必死）；
- L71–73：调用 `HACM_MC_Tick()`（蒙卡遥测本体在 Telemetry.lua 里）。

### 要求

1. **先备份**：4 个原件复制到 `LabConsole\outputs\HACM外部脚本改写-backup-20261015\`，逐个 SHA256 留底，出 manifest；
2. **通读 Telemetry.lua 全文**，逐点盘点全部 io 调用（不许漏），列清单后再动手；
3. **改写为键值通道**（与 8 想定内嵌版同一模式）：
   - io 落盘 → `ScenEdit_SetKeyValue` / `ScenEdit_GetKeyValue`；键名 `hacm_mc.` 前缀、`.` 分隔、**禁冒号**（K60 XName 校验）；
   - **职责切分（重要）**：想定内嵌 tick 动作昨天已经在写 `hacm_mc.tick.NNNNNN` / `hacm_mc.tick.count` / `hacm_mc.pulse` 三个键——外部 EventTick 重写后**不得重复写同名键**。外部脚本只保留两个职能：① 加载并调用 `HACM_MC_Tick` 遥测；② active_out_dir 剖面路由与 Telemetry 的全部落盘改走键值；
   - 遥测数据键前缀建议 `hacm_mc.tele.*`（每张弹道/每局一子键），具体字段方案在通读 Telemetry.lua 后列进说明文档；
   - `dofile` 兜底行删除（沙箱下为 nil，必死）；`os.date` 沙箱下为 UTC，行为变化在说明里注明；
   - 两组文件同步改，内容保持一致；
4. **静态自验**：4 个文件逐个过 `LabConsole\tools\template-register\lua_blacklist.py` CLI，须 exit 0、零命中（io 族清零）；
5. **改写说明**：`LabConsole\outputs\HACM外部脚本改写-说明-20261015.md`——每文件：io 调用点盘点清单、改了哪几行、键值 schema 对照表（原文件→新通道）、Telemetry 字段方案、真机复跑判据草案（复用 MC-1 流程：装载→1200 脉冲→另存→探针读键，新增判据：`hacm_mc.tele.*` 键有数据且随 tick 增长）、存疑节。

## 边界

- 不启动 F1、不连 9477/9478/9479、不跑推演（真机复跑由 Kimi 排窗口）；
- **只动这 4 个文件**，不碰 8 个想定（昨天已改写验收过）、不碰安检器、不碰桥；
- 不打印令牌；备份先行，失败可回滚；
- 拿不准的写进说明文档"存疑"节，不擅自发明第三通道。

## 完工后

报：4 文件改写完成数、io 调用点盘点清单（Telemetry 全量）、安检零命中证据、说明文档路径、备份目录路径。真机复跑验证由 Kimi 排进下一个 F1 窗口。
