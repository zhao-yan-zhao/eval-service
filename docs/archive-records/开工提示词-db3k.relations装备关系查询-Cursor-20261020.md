# 开工提示词：db3k.relations 装备关系查询工具（桥+proxy）

2026-10-20 · Kimi 拟 · 执行：Cursor · 工单性质：Q-048 的姊妹单，新模式照抄 Q-048 已验证路径

## 一、要干什么

给桥+proxy 新增一个 **db3k.relations** 工具：给定一个平台条目（飞机/舰船/地面单位/设施），查出它的**关系链**——

1. **该平台可用的挂载方案**（loadout 列表：每个挂载方案的 ID、名称、含哪些武器、各多少发）；
2. **该平台搭载的传感器**（sensor 列表：ID、名称、类型）；
3. 反向：给定一个武器/传感器条目，查**哪些平台能装它**（可选，如实现量大可砍，但正向两条必须做）。

**用户场景**（理解用，不用写进代码）：面板 AI 在①段（任务构想论证）要给用户出"这架飞机挂什么弹"的候选，现在只能 db3k.search 查名字、db3k.detail 读单条目属性，但"这平台能挂什么"这条父子链查不了，挂载候选只能瞎编。

## 二、照抄的既有模式（Q-048，全部已上线验收）

先读完工报告 `D:\soft\F1-AI\LabConsole\outputs\完工报告-Q048-db3k.detail-Cursor-20261019.md`，本单的一切做法与它对齐：

- 桥侧 SQL 模板：`CMO-netcore-src` 里 `Db3kSqlTemplates.cs`——Q-048 新增了 9 条 `D_*` 模板，本单新增 `R_*` 系列模板，**不许动既有 48 条 search 模板和 9 条 D_* 模板**（diff 必须为零）。
- 桥侧安全口径：与 search/detail 同级——只读 SELECT、按表剔 BLOB 字段、参数化查询防注入。
- proxy 侧：`demo-ui/proxy/tools.mjs` 注册工具（①②③段可用 / ④段拒绝），`dbexec.forwardDb3kDetail` 的透传模式照搬一个 `forwardDb3kRelations`。
- 测试：C# 侧仿 `Q048_Db3kDetailTests.cs` 写 `Q049_Db3kRelationsTests.cs`（编号以实际工单为准，别撞名）；proxy 侧仿 `db3k-detail.test.mjs` 写 `db3k-relations.test.mjs`；`test:all` 清单只在末尾追加新文件，不许改既有条目顺序。

## 三、实现要点

1. **先摸清库结构再写模板**：db3k 迷你库里平台表（DataAircraft/DataShip/DataGroundUnit/DataFacility）与 Loadout 表、Loadout→Weapon 关联表、Sensor 关联表的实际表名/外键列名，用只读查询探明后写进报告；不同条目类型的关联表可能不同，逐类型核对。
2. **入参**：`{ dbid, relation: "loadouts" | "sensors" | "platforms" }`（platforms=反向查，可选）。出参加 detail 的口径：显式列名 + 0 条时返回显式 note（不许静默空）。
3. **性能**：单条目查询，不许全表扫；limit 硬上限（建议 100）。
4. **proxy 工具描述**要写清一句话用途和典型用法（"定挂载候选前必调"），供面板 AI 读。

## 四、纪律

- 只读源码与库；不改 CMO-netcore-src 既有文件以外的东西；不碰 demo-ui/ 除 tools.mjs + 新测试文件外的部分；不改 .env；不连真桥、不启动 F1。
- 编译 + C# 单测 + proxy 单测全绿才报完工；完工报告写 `D:\soft\F1-AI\LabConsole\outputs\完工报告-Q049-db3k.relations-Cursor-20261020.md`，含：表结构勘察结果、新增模板清单、测试结果、**部署提醒**（桥 DLL 需编译部署后排 F1 窗口，proxy 重启 7177 生效）。
- 查不到的写"未找到，存疑"，不许编表名。
