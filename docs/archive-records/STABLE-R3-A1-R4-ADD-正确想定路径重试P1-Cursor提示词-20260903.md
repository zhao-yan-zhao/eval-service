# STABLE-R3-A1-R4-ADD：加载获准路径副本后由 Owner 重试 P1

## 一、结论

上一轮两次“执行任务”失败，不是 505、模型或飞机航线失败。根因已经由监理逐字定位：

- 当前加载的想定来自 `D:\soft\F1-AI-runtime-26effb3-a1r4\Scenarios\...`；
- 生产 AI 的 `WritableRoot` 是 `D:\soft\F1\F1-测试`；
- `ToolInvocationService.UpdateSceneContext` 调用 `CanonicalScenePath.Resolve`；后者明确拒绝不在 WritableRoot 下的路径并返回 `path_not_allowed`；
- `StoreProductionTaskBootstrap.CreateLockedTask` 在插入 `ai_tasks` 之前调用该路径检查，异常又被 `ProductionTaskCoordinator` 统一压成 `task_bootstrap_failed`；这与“聊天消息已写入、今日 ai_tasks 仍为 0”完全吻合。

监理同时只读排除：

- 推演网关：runtime enabled 的生产构造已强制挂载真实 Core gateway；
- 模型配置：`preset-deepseek` 激活、外发提醒已确认、base URL/model 齐全，当前用户 DPAPI 解密成功且密钥非空；
- 数据库版本：本轮获准 505，不构成失败。

## 二、已准备好正确副本

监理已把原想定逐字复制到获准路径，未覆盖任何文件：

`D:\soft\F1\F1-测试\Scenarios\A1R4-505-OWNER-WORK.scen`

- 文件大小：5555 字节
- SHA-256：`B417B1ED560D251AB87AEE85F010517AEA5351CB4C04E68BC96CE948D754051F`
- 与原 `A1R3-515-OWNER-WORK.scen` 完全同哈希，只改变磁盘所在路径和副本文件名，不改变想定内容。

## 三、Cursor 边界

- Cursor 禁止控制鼠标、键盘、窗口或 F1。
- 禁止改数据库、源码、配置、WritableRoot、DB 版本。
- 禁止替 owner 加载想定、点击按钮、保存想定或运行仿真。
- 只在 owner 操作后只读核对日志、`assistant.db` 新任务行和工具记录。

## 四、给 Owner 的单步操作

1. 回到 F1 主界面，加载以下文件：

   `D:\soft\F1\F1-测试\Scenarios\A1R4-505-OWNER-WORK.scen`

   在想定列表中找文件名 **A1R4-505-OWNER-WORK**。若系统询问是否保存当前想定，选“不保存”。

2. 加载完成后确认数据库仍为 **DB3000 v505**。不切换、不升级数据库。

3. 打开 AI 助手，在任务目标框粘贴下面整段：

```text
这是单步验收任务。不要查询数据库，不要保存想定，不要运行仿真，不要调用除 unit.add 外的任何工具，也不要重试。

只调用一次 unit.add，参数必须严格使用：
side=Blue
dbname=F/A-18C Hornet
name=_A1_PROBE_HORNET_505
dbid=8
unit_type=Aircraft
loadout_id=2544
lat=25.0
lon=130.0
course=[{"lat":25.5,"lon":130.5},{"lat":26.0,"lon":131.0}]

工具成功后立即结束任务，在最终回复中原样给出 unit.add 的结果和 unit_id；工具失败则原样给出错误码后立即结束，不要换参数、不要重试、不要调用其他工具。
```

4. 点一次“执行任务”，然后等待。不要点暂停、继续、中断。

5. 若任务启动，截完整 AI 面板；任务结束后再选中地图上的 `_A1_PROBE_HORNET_505` 截图。若 2 分钟仍未启动或再次立即红字，只截完整 AI 面板并停手。

本轮仍不保存想定、不运行仿真、不做 P2。

## 五、Cursor 回报要求

只读回报：

- owner 实际加载的完整想定路径；
- 当前 DB 版本；
- 点击后 `ai_tasks` 是否出现 2026-09-03 新行及 task_id/state/error_code；
- 是否只调用一次 `unit.add`；
- 原始回执和 unit_id；
- 地图是否出现飞机和可见航线；
- 若仍失败，必须给真实新证据，不得再次归因 505。

追加报告到：

`D:\soft\F1-AI\STABLE-R3-A1-R4-505飞机航线Owner手测-P1报告-20260903.md`

完成后停工，等监理决定 P2。
