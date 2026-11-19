# STABLE-R3-A1-R4-ADD3：完成“进入想定”后再测 P1

## 一、监理裁决

ADD2 不是想定加载失败，而是停在正常加载流程的中间一步。

磁盘源码已逐字核对：

- `Client.AddFileNameToRecentList` 只会在 `ClientCore.HandleScenarioLoaded` 已被调用后执行；因此 `RecentlyOpened` 第一项已经变成 UNIQUE，证明该文件已经被程序成功读取、解析，并进入待确认状态，不只是“在文件框里选中过”。
- 对“最后在想定编辑器中保存”的想定，`ClientCore.HandleScenarioLoaded` 不会马上替换主窗口场景，而是打开 `ChooseSide` 分方窗口。
- 只有在该窗口点击“进入想定”后，`ChooseSide.EnterSimulation` 才执行 `ClientCore.SetCurrentScenario(...)` 并刷新主窗口标题。

所以 ADD2 的“两门必须同时先通过”写错了：在点击“进入想定”前，Recent 第一项正确而主窗口仍显示旧标题，正是程序设计的正常中间状态。不得再报告为加载失败。

## 二、分工

- Owner 只负责下列明确的界面操作。
- Cursor 禁止控制鼠标、键盘、窗口；只读核对日志、数据库和截图。
- 一次只提示 owner 一个步骤，必须等 owner 回报后再给下一步。
- 不得再要求 owner 切 515、迁移数据库或修改配置。505 不是本轮失败原因。

## 三、Owner 人工步骤

### 步骤 1：启动并进入 UNIQUE 想定

1. 启动：`D:\soft\F1-AI-runtime-26effb3-a1r4\F1.exe`。
2. 在“最近打开”中选择：
   `D:\soft\F1\F1-测试\Scenarios\A1R4-505-OWNER-WORK-UNIQUE.scen`
3. 在想定加载窗口点击“编辑想定”。若询问是否保存当前想定，选择“不保存”。
4. 程序随后会出现“选择分方”窗口：选择 `Blue`（只有一个分方时保持默认），点击 **“进入想定”**。
5. 回到地图主窗口，确认标题逐字包含 `A1R4-505-OWNER-WORK-UNIQUE`。

若第 4 步没有出现分方窗口，先检查是否藏在 F1 主窗口后面或任务栏中；仍找不到就截图停手，不打开 AI。

### 步骤 2：标题正确后执行一次 P1

只有主窗口标题已经变为 `A1R4-505-OWNER-WORK-UNIQUE` 才继续：

1. 打开 AI 助手。
2. 在任务目标框粘贴以下完整内容：

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

3. 只点一次“执行任务”。等待完成或失败，截取 AI 面板与地图画面后停手。
4. 不点暂停/继续/中断，不保存想定，不运行仿真，不做 P2。

## 四、Cursor 只读取证

在 owner 完成步骤 1 后先核对：

1. 主窗口标题是否为 `A1R4-505-OWNER-WORK-UNIQUE`；
2. `RecentlyOpened` 第一项是否为 UNIQUE 完整路径；
3. 当前程序是否来自 a1r4 候选目录。

owner 完成步骤 2 后再核对：

1. 今日是否新增 `ai_tasks`；
2. task_id、state、error_code；
3. `unit.add` 原始请求、原始回执和真实 unit_id；
4. 地图上飞机是否创建、航线是否显示。

若标题正确后任务仍立即红字且无新任务，禁止再次重试，转生产错误码可见性诊断。若 `unit.add` 成功，先停在 P1，不擅自进入 P2/P3。

把结果追加到：

`D:\soft\F1-AI\STABLE-R3-A1-R4-505飞机航线Owner手测-P1报告-20260903.md`

## 五、禁止事项

- 禁止 Cursor UI 自动化或远程控制 owner 窗口。
- 禁止切换/升级/迁移数据库。
- 禁止修改源码、配置、生产数据库或想定。
- 禁止保存想定、重复执行任务、运行仿真、做 P2/P3。
- 禁止把“主窗旧标题 + Recent 已更新”的加载中间态再次误报为加载失败。
