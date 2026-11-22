# STABLE-R3-A1-R4-ADD2：唯一标题副本最终重试 P1

## 一、上一轮为什么仍失败

上一轮 ADD 并没有证明获准副本真正加载成功。监理只读核对 `D:\soft\F1\F1-测试\Config\Command.ini` 后确认：

- `RecentlyOpened` 第一项仍是禁止的旧路径：
  `D:\soft\F1-AI-runtime-26effb3-a1r4\Scenarios\A1R3-515-OWNER-WORK.scen`
- 获准副本 `D:\soft\F1\F1-测试\Scenarios\A1R4-505-OWNER-WORK.scen` 没有进入最近打开清单；
- 两份文件内部 `ScenTitle` 原本都叫 `A1R3-515-OWNER`，所以主窗口标题无法区分，造成“看似切换、实际仍在旧路径”。

因此本次现象仍符合旧路径被 `CanonicalScenePath` 以 `path_not_allowed` 拒绝；暂时没有证据支持存在第二个任务创建缺陷。不得归因 505、模型或飞机航线。

## 二、监理已准备唯一标题副本

新文件：

`D:\soft\F1\F1-测试\Scenarios\A1R4-505-OWNER-WORK-UNIQUE.scen`

- 位于生产 AI 允许的 WritableRoot 内；
- 文件大小 5567 字节；
- SHA-256：`817E6DC6F5EEC37EACEFBA43A98386339A0544AF9393AD9DD7FE93A2500F2918`；
- 只把测试副本内部标题从 `A1R3-515-OWNER` 改为 `A1R4-505-OWNER-WORK-UNIQUE`，其余想定内容不变；
- 未覆盖原文件。

## 三、Cursor 禁止事项

- 禁止控制鼠标、键盘、窗口或点击任何 F1 控件。
- 禁止保存想定、切数据库、改配置/源码/数据库。
- 禁止在 owner 看到唯一标题前让其点击“执行任务”。
- Cursor 只读收证。

## 四、Owner 唯一操作流程

1. 在 F1 中选择“加载想定”，**不要点最近打开中的任何 `A1R3-515-OWNER`**。
2. 明确浏览并加载这个完整路径：

   `D:\soft\F1\F1-测试\Scenarios\A1R4-505-OWNER-WORK-UNIQUE.scen`

3. 若询问是否保存当前想定，选“不保存”。
4. 加载后先看主窗口标题：必须逐字看到 **`A1R4-505-OWNER-WORK-UNIQUE`**。若仍显示 `A1R3-515-OWNER`，立即停手，不打开 AI、不点执行。
5. 标题正确后，数据库继续保持 505；打开 AI 助手，在任务目标框粘贴：

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

6. 点一次“执行任务”，等待，成功或失败都截图后停手。不要点暂停/继续/中断，不保存想定，不运行仿真，不做 P2。

## 五、Cursor 回报硬门

必须先给两项证据，否则本轮无效：

1. 主窗口标题逐字为 `A1R4-505-OWNER-WORK-UNIQUE`；
2. `RecentlyOpened` 第一项变为 `D:\soft\F1\F1-测试\Scenarios\A1R4-505-OWNER-WORK-UNIQUE.scen`。

随后报告：今日是否新增 `ai_tasks`、task_id/state/error_code、`unit.add` 原始请求/回执、unit_id、地图飞机与航线截图。

若标题和 RecentlyOpened 两门均通过后仍立即红字且无新任务，禁止第四次重试；停工并明确报告“已排除路径误加载，需补生产错误码诊断”。

追加报告：

`D:\soft\F1-AI\STABLE-R3-A1-R4-505飞机航线Owner手测-P1报告-20260903.md`
