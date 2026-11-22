# 开工提示词-Q070-事件time触发器与spawn_units真机失效-Cursor-20261022

## 背景（监理真机复验编译波 4 时发现，全部实锤）

2026-10-22 上午监理在槽 1（9478，编译波 4 新码）做 Q-067 真机复验「母机到位→投放子机」，发现事件链路两处真机失效。所有结论都有对照实验，不是猜测。

## 故障一：time 触发器不触发（P0）

**现象**：event.upsert 建的 time 触发器事件，推演中一律不触发；regular_time 正常。

**实验记录**（想定：槽1 复验-Q064-摘挂载-20261022.scen，分辨率 0.1s）：

| 实验 | 触发器 | 动作 | 结果 |
|---|---|---|---|
| 投放1 | time +1min（已过点，应即触发） | spawn_units | 未触发（无单位） |
| 投放2 | time +9min（在窗口内） | spawn_units | 未触发 |
| 终局探针 | time +12min（在窗口内） | end_scenario | 跑满 1800/1800，**未触发** |
| 周期探针（对照） | regular_time 60s | end_scenario | **381 脉冲（38.1s）触发终局，链路通** |
| 时间探针 | time +1min（已过点） | end_scenario | 跑满 600/600，**未触发** |

结论：触发器注册+事件关联+动作 Lua 执行这条链路整体是好的（周期探针全通），**唯独 Time 型触发器不触发**——包括「触发时刻已过、按 GetIsFulfilled 逻辑应立即触发」的情形也不触发。

**排查起点**：
- 桥生成：`LuaEventTemplate.BuildScript`（LuaEventTemplate.cs:367-443），Time 写绝对时刻字符串（`scenarioStartTime.AddMinutes` → 'yyyy-MM-dd HH:mm:ss'）
- 引擎入口：`LuaEvent.cs` ScenEdit_SetTrigger(:1043) → ParseDictToXML(:3586，case "Time" 有 TryParse→ToBinary 转换，约在 3781 行附近） → EventTrigger.FromXML 分发（EventTrigger.cs:43，"EventTrigger_Time" 分支在）
- 求值：Scenario.SetTime（Scenario.cs:4106-4119，Time 触发器不在 SecondIsChanging 门禁内，每脉冲都评估）→ EventTrigger_Time.GetIsFulfilled（EventTrigger_Time.cs:20-33）
- 疑点候选：①ParseDictToXML 的 Time 转换是否真进了 XML（字典键大小写/元素名）；②vmVSmyQSV9W 后处理是否改了触发器；③SetEventTrigger 关联后 SimEvent.Triggers 里的对象与 EventTriggers.Values 里的对象是否同一引用（FireEvents 用 Contains 对象比对，若 XML 往返重建了对象，引用不等=永远不触发——**重点怀疑这条**，周期探针能通说明它的关联没走 XML 往返或路径不同）
- **验证方法**：给 ScenEdit_SetTrigger(SetEventTrigger 加诊断留档，或写单测直接走 Lua ScenEdit_SetTrigger(type='Time') → 推时间 → 断言 FireEvents 被调

## 故障二：spawn_units 动作静默失败（P0，Q-067 真机复验未过）

**现象**：用已证可触发的 regular_time 触发器挂 spawn_units（红方/Aircraft/dbid=5176 MQ-9B/count=3/lat=24.8/lon=119.4/spread_km=10/altitude_ft=20000），触发点过后**无单位创建、无报错、无弹窗、Expenditures/UnitCreated 无任何痕迹**——静默吞掉。

**排查起点**：
- 桥生成：LuaEventTemplate.BuildSpawnUnitsScriptText（:489-525），for 循环拼 ScenEdit_AddUnit({type='Aircraft',side,dbid,unitname=_base..i,latitude,longitude,altitude})
- 疑点候选：①EventAction_LuaScript.Execute 的 Lua 沙箱是否吞异常（对照：end_scenario 同为 luascript 动作能执行——动作机制本身通）；②ScenEdit_AddUnit 对 Aircraft 是否要求 loadoutid/跑道/高度单位（feet vs meters）不对就静默拒；③type='Aircraft' 引擎实际认的字符串（LuaUnitAddTemplate 的映射表对照）
- **验证方法**：单测/真机把 spawn Lua 直接跑在非事件上下文（模板动作通道 Q-028 已验证可跑 Lua），看 ScenEdit_AddUnit 返回值/异常

## 故障三（附带立案）：WRA weapon_id=all 在全新想定枚举为空

 doctrine.set_wra scope=side + weapon_id="all" + target_type=air（域展开）→ `doctrine_set_wra_no_effect:none_changed`。旧单类型路径（Air_Contact_Unknown_Type + all）同样 none_changed。根因：LuaSetWraTemplate 的 all 路径用 `ScenEdit_GetDoctrineWRA` 枚举**已存在的 WRA 行**（LuaSetWraTemplate.cs:241-253、289-304），全新想定一行都没有 → 枚举为空。这意味着面板 AI 用 "all" 清零必然失败（昨晚它若用 all 就是假清零）。
- **修法方向**：all 的枚举源改为「阵营单位的实际武器清单」（ mounts/magazines 遍历）或引擎 DB 全武器 ∩ 可交战该域，而不是 WRA 表现有行。改前先在真机上验证 ScenEdit_GetDoctrineWRA 的行为口径（无行时返回 nil 还是默认行）。
- 绕行（已验证好使）：按 dbid 单武器 + 域短名（3541 SM-6 / 15 ESSM 实测 24 类型行全写+读回对账过）。

## 附带登记（写进 skill 注意事项，不用改代码）

- **trigger_minutes 语义 = 想定 StartTime + N 分钟（绝对时刻）**，不是「从现在起 N 分钟」；想定时钟已走过的话要按 StartTime 换算
- **想定 Duration 到点自动终局后 HasEnded 锁存**，之后 simulation.run 一律 1 脉冲即终局，scenario.set_time 延长无效，必须 scenario.load 重载才解锁
- scenario.save 另存后 StartTime 疑似被改写为保存时时钟（导致「StartTime+N」基准漂移），未完全证实，修故障一时顺带核实

## 红线

- 只改 C# 桥/引擎侧诊断与修复 + 单测；proxy 侧仅 event.upsert 描述文案可同步（time 触发器语义说明）
- 不编译不部署（监理统一编译波 5）
- 完工报告放 LabConsole\outputs\完工报告-Q070-事件time触发与spawn_units-Cursor-20261022.md

## 验收口径

1. 单测：time 触发器创建→推进→触发 全链绿；spawn_units Lua 在沙箱跑出 AddUnit 调用
2. 监理真机复验：time 触发 +end_scenario 探针提前终局；time/regular 触发 +spawn_units 投放 3 架 MQ-9B 出现在 unit.status 与 UnitCreated.csv
