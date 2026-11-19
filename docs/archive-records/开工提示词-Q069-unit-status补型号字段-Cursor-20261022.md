# 开工提示词-Q069 unit.status补型号字段-Cursor-20261022

> 派单：Kimi（监理）｜ 执行：Cursor ｜ 日期：2026-10-22
> 优先级：**P1**（判读链"按名字认单位"，型号维度断裂；10-21 实录：AI 不敢补建小机因"25 架现有同型反查不出"）
> 范围：**桥 C#**；进**编译波 4**（与 Q-062AB/Q-063/Q-064/Q-067 同批），本单不编译不部署
> 红线：只加字段不改语义；不碰 .env；不连真桥

## 背景与需求

`unit.status`（CoreF1AutomationFacade.cs:340-420）现役 8 字段：unit_id/name/side/lat/lon/damage_percent/status/cargo。**缺型号**：无 DBID、无类型名。owner 质问"看不到单元型号怎么评估行为是否合适"。

## 要做什么

`UnitStatus` 返回的每个单位条目**追加**（不动既有字段，纯加）：

| 新字段 | 来源 | 说明 |
|---|---|---|
| `dbid` | `ActiveUnit.DBID`（ActiveUnit.cs:147，public int） | 装备库编号——拿到它 db3k.detail 就能查一切 |
| `unit_type` | `ActiveUnit.UnitType` 枚举 ToString()（Aircraft/Ship/...） | 大类 |
| `class_name` | ActiveUnit 的型号名字段（请自行核实属性名——候选：`u.ClassName` / DataRow 关联名；**以源码实锤为准，查不到就只上 dbid+unit_type 并在报告存疑**） | 型号名（如"阿利·伯克级 Flight IIA"） |

contact 查询（同文件 Contacts 段，约 :300-340）如也有型号维度缺失且引擎 Contact 对象有对应字段，顺带补 `dbid`（接触识别出的型号）；没有就在报告里写明"Contact 侧无此字段"。

`InMemoryF1AutomationFacade` 的 UnitStatus 假实现同步补字段（测试依赖它）。

## 测试与验收

- C#：新测试或扩充既有 UnitStatus 测试——断言返回含 dbid（>0）/unit_type；假实现与真实现字段集一致。
- 回归：仿真/查询族既有套件全绿。
- 完工报告落 LabConsole/outputs/完工报告-Q069-unit.status型号字段-Cursor-20261022.md：字段终稿、class_name 实锤或存疑、改动清单。
- 监理后续：验收入库 → 编译波 4 → 真机复验=装载地狱景观候选，unit.status 读出伯克 dbid=3151、与 db3k.detail 联动查航速四档（与 Q-062B 联测）。

## 背景文件

- CMO-netcore-src/AiAssistant.F1Core/CoreF1AutomationFacade.cs:340-420（UnitStatus 现役实现）
- CMO-netcore-src/Command_Core/ActiveUnit.cs:147（DBID）、:804+（UnitType_String）
- 问题台账.md Q-069 行
