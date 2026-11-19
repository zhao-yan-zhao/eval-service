# STABLE-R3-A1-R3-ADD：WritableRoot 纠偏与 owner 想定接管

> 本提示词优先级高于原 R3 工单中关于资源复制、DB 隔离、自动新建/加载想定和自动打开 Lua 控制台的步骤。直接按本文续做，不得重复已证明无效的 UI 自动化。

## 一、先说结论

owner 已手工准备好 515 测试想定，并指出此前真正配置错误：`WritableRoot.txt` 必须指向包含完整地图、数据库和运行资源的根目录，而不是把候选程序输出目录误当资源根。

当前磁盘已核对：

- 候选程序：`D:\soft\F1-AI-runtime-a0e5675-a1r3\F1.exe`
- 候选程序旁的 `WritableRoot.txt` 当前内容：`D:\soft\F1\F1-测试`
- 完整资源根：`D:\soft\F1\F1-测试`
- owner 准备的想定：`D:\soft\F1-AI-runtime-a0e5675-a1r3\Scenarios\A1R3-515-OWNER.scen`
- 候选 HEAD：`a0e56757d2ff7da8cda2addbce02c4cb3f4e8643`
- 候选 F1.exe SHA-256：`117BDC5E8564D7EE6C3CA9E234C8C8F18AE187476D4982938D149762DBA9D2F3`
- 候选 F1.dll SHA-256：`6F37EB0C9E006B3CE98C2B1152F6B479A1E4E1FCE6D19A2ECE17B69C8FE1AC12`

正确关系是：**候选目录提供程序代码；WritableRoot 指向 owner 的完整资源根。** 两者路径不同是正常且必要的。

## 二、立即停止的动作

从收到本提示词起：

1. 不再修改、恢复或重写任何 `WritableRoot.txt`。
2. 不再复制、移动、隔离、改名或删除任何 DB 文件。
3. 不再修改 `DefaultDB`，不再搬运 `Command.ini`。
4. 不再自动新建想定，不再让脚本反复点击文件窗口。
5. 不再把“打不开 Lua 控制台”当作数据库门失败。
6. 不覆盖 owner 准备的想定，不覆盖旧专机，不运行 HACM 修改库样本。
7. 不运行任何递归删除、`robocopy /MIR`、`git clean`、reset、stash。

如当前仍有你启动的 F1 进程，只在确认进程路径属于 `D:\soft\F1-AI-runtime-a0e5675-a1r3\F1.exe` 后正常关闭；不得结束 owner 的其他 F1/HACM 进程。随后从候选路径重新启动一次，以确保新进程读取 owner 已纠正的 WritableRoot。

## 三、开工门

启动前只读留证：

1. `WritableRoot.txt` 逐字内容必须为 `D:\soft\F1\F1-测试`。
2. owner 想定文件存在，记录大小、时间和 SHA-256。
3. integration 仍为 `integration/stable-single-ai@a0e5675`；源码/测试无新增脏项，既有 `runs/` 除外。
4. 候选 exe/dll 哈希仍与上文一致。

任一项不符，只报告具体不符项；不得自行纠正 owner 路径或换想定。

## 四、启动和数据库确认——不再依赖 Lua 控制台

1. 只启动 `D:\soft\F1-AI-runtime-a0e5675-a1r3\F1.exe`。
2. 记录真实进程路径。
3. 确认地图正常出现、没有“地形地貌数据文件未找到”或数据库哈希错误。
4. 从文件菜单明确加载 owner 想定：
   `D:\soft\F1-AI-runtime-a0e5675-a1r3\Scenarios\A1R3-515-OWNER.scen`
5. 保存加载成功后的主界面截图和数据库版本/想定属性中能看到 515 的截图。owner 已准备想定，不得再创建替代品。
6. 通过 AI 助手生产工具执行一次只读 `db3k.search`：
   - 查询 aircraft，`id=8`，应返回 F/A-18C；
   - 查询 loadout，`aircraft_id=8`，确认列表包含 `id=2544`。

这里采用“owner 在 515 上准备的想定 + F1 显示的数据库版本 + 当前想定生产 `db3k.search` 成功”三重证据。无需为了数据库门继续自动打开 Lua 控制台。

如仍弹数据库错：逐字保存本轮新错误全文和截图，立即停工；不得用旧截图、旧 LuaHistory 或静态 XML解释本轮。

## 五、直接做飞机航线 P1→P3

数据库确认后，不再做环境探索，直接使用 AI 助手生产工具测试。测试前先把 owner 想定复制成同目录工作副本，例如：

`A1R3-515-OWNER-WORK.scen`

只修改工作副本，绝不覆盖 owner 原始想定。

固定参数：

- side=`Blue`
- aircraft dbid=`8`
- loadout_id=`2544`
- unit_name=`A1R3-Probe-Hornet-515`
- 初始位置：lat=`25.0`、lon=`130.0`
- 航点1：lat=`25.5`、lon=`130.5`
- 航点2：lat=`26.0`、lon=`131.0`

### P1：创建时附带航线

通过真实 AI 助手任务调用生产 `unit.add`，创建上述飞机并同时提交两个航点。保存完整自然语言请求、模型回复、工具请求和工具回执。

创建后必须查看 F1 真实状态：选中飞机，打开路线规划/航线显示，记录实际航点列表和地图航线截图。不得拿工具回执里的 `course_waypoints=2` 当真实成功。

### P2：对同一架飞机补设航线

若 P1 真实状态没有两航点，对同一个 GUID 调用生产 `unit.update_position`，再次提交相同位置和两个航点。不得新建第二架飞机。

再次从 F1 路线规划/航线显示读取实际航点。若必须使用 Lua 才能看清，可请 owner 人工打开控制台；自动化最多尝试一次，失败就改用 F1 的真实路线规划界面，不得再花时间循环点窗口。

### P3：短时运行观察

在确认实际航线状态后，短时运行仿真，记录飞机运行前后位置和航向变化，确认它是否沿航线移动。保存截图和坐标证据，不凭一句“看起来动了”下结论。

## 六、机械结论

- P1 无实际航线、P2 后出现实际航线：建议开发“飞机创建成功后自动补设一次航线”。
- P1 已有实际航线：不开发二次补设；此前打转样本另查原因。
- P1、P2 都没有实际航线：现有 A1 方案无效，停工回报，不得硬改生产代码。
- 不能确认数据库、GUID 或真实航点：写 `blocked`，不得猜。

## 七、范围、测试和报告

- 不改源码/测试/项目文件，不 commit/push/tag。
- 不提交 `runs/`、`backup/`、`BinaryGridProvider.cs`、`Terrain.cs`。
- 若完整完成 P1→P3，再运行全量 L1 与 AllInOne 指定 csproj Rebuild；预期 927/927、0 错/1138 警告。
- 所有新证据继续写入：
  `D:\soft\F1-AI-integration\runs\stable-r3-a1-r3-20260902\`
- 最终报告仍落：
  `D:\soft\F1-AI\STABLE-R3-A1-R3-隔离运行包与飞机航线真机探针报告-20260902.md`

报告第一段必须用大白话区分：数据库/地图环境是否正常、飞机创建带航线是否生效、补设航线是否生效、飞机是否真实移动。Cursor 自报不算关门，等待监理复验。
