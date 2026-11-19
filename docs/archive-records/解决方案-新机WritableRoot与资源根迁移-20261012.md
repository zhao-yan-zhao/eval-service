# 新机 F1 启动失败：WritableRoot 语义、死因排查与解决方案

日期：2026-10-12 ｜ 依据：本机（D:\soft\F1-AI）源码 + 实证配置 ｜ 面向：新机（D:\F1-AI）现场执行人

## 一、WritableRoot.txt 到底管什么（源码实锤）

**它是"资源根"配置，不只是"可写数据目录"。** 启动时 `MyApplication.cs:200` 读取 exe 同目录的 `WritableRoot.txt`，把内容设为全局 `TopLevelWritablePath`；之后程序里**所有**资源路径都挂在它下面（`GameGeneral.cs`）：

| 子路径 | 用途 |
|---|---|
| `<根>\DB` | 装备数据库（DB3K 等） |
| `<根>\GIS` | 地形/地貌（LandCover、Elevations 等） |
| `<根>\WW` | 地图图层资源（本机 58 GB） |
| `<根>\Symbols`、`<根>\Sound` | 图标、音效 |
| `<根>\Config` | Command.ini、EventExport*.ini 等配置 |
| `<根>\Scenarios` | 想定 |
| `<根>\Lua`、`<根>\templates\registry` | Lua 脚本、已审批模板登记（桥用） |
| `<根>\Logs`、`<根>\Temp\Process_<PID>` | 日志、临时 |
| `<根>\EventExport` | 推演事件 CSV 导出 |
| `<根>\knowledge`、assistant.db 等 | AI 助手数据 |

两条直接推论：

1. **桥的 `path_not_allowed` 是设计如此**：scenario.load 等工具只接受资源根之下的路径（知识库原文："路径必须在 WritableRoot 任务工作副本内"）。根指向哪，想定就得放哪下面——这不是故障，不用"修"。
2. **改 WritableRoot.txt 方向没错，但目标必须是一棵完整资源树**。本机就是证据：`D:\soft\F1-AI\F1\WritableRoot.txt` = `D:\soft\F1\F1-测试`，而 F1-测试 是**完整安装**（exe+DLL+GIS 全 tif 集+WW 58GB+templates 登记+license 文件全在里面），所以一直稳定。

## 二、新机这次为什么起不来

先说两个排除项：

- **Logs 为空 ≠ 线索**——`<根>\Logs` 是想定跑起来之后的消息日志（本机内容全是"切换到分方/新目标/武器攻击"），启动期错误根本不写这里。启动错误两个去处：弹窗（MessageBox）或静默 `Environment.Exit`（源码里就有现成的，如 GIS 根为 null 时 Exit(3)）。**要看崩溃原因：Windows 事件查看器 → Windows 日志 → 应用程序 → 找 F1.exe 的 Error/.NET Runtime 条目；或在命令行里直接跑 F1.exe 看控制台输出。**
- **AI 桥初始化失败不会杀 F1**——源码写明 AI 侧 fail-closed（"AI fail-closed on init failure; caller keeps F1 running"）。进程整个消失是主程序启动路径的问题。

嫌疑排序（结合"根=ZXY 树能起、根=F1-测试 起不来"这一对照事实）：

1. **旧机器的 .license 文件跟着迁移过去了（最大嫌疑）**。F1 授权是 IntelliLock **硬件锁**（CPU/硬盘/主板/网卡绑定，源码 LicenseStatus.cs 可见 HardwareLock 系列）。本机 F1-测试 里就有两个 `F45B-...license` 文件——如果它们被一起拷进新机的 `D:\F1-AI\F1-测试`，切根后 F1 读到的就是**旧机器的授权**，硬件指纹不匹配 → 启动期授权校验失败退出。ZXY 树能起，是因为那里用的是新机自己的授权。
2. **GIS\LandCover 数据缺失或形式不符**。10-11 在 ZXY 树手工补的是 `LandCover_300_webp.mbtitles`，但那是补在 ZXY 树下的；F1-测试 这份拷贝里 LandCover 可能没补（本机用的是另一套 .tif 全集）。地貌数据问题 10-11 的表现是弹窗提示，但叠加上面第 1 条时启动序列可能直接中断。
3. WW 被删——**嫌疑低**：ZXY 树同样没 WW 也能起，WW 缺只是图层显示不全。

## 三、解决方案（分两步：先恢复，再根治）

### 第一步：立即恢复（今天就干，10 分钟）

1. 把 `D:\F1-AI\F1\WritableRoot.txt` 用备份 `WritableRoot.txt.bak-20261012` **还原为 `D:\ZXY\soft\F1\F1`**；
2. **删掉 `D:\F1-AI\F1-测试` 根下所有 `*.license` 文件**（旧机授权，留着是定时炸弹）；
3. 用 `start-F1-with-bridge.bat` 重启，验证 9477 返回 401（=就绪）。

### 第二步：采纳降级方案（认可 Claude 提的，补充细节）

**想定直接在 ZXY 树下做，成品复制回 D:\F1-AI 归档。** 具体操作口径：

- 建场/试车的想定路径一律用 `D:\ZXY\soft\F1\F1\Scenarios\...`（资源根之下，path_not_allowed 天然满足）；
- 事件数据落盘在 `D:\ZXY\soft\F1\F1\EventExport\...`，判读脚本读这里；
- 成品（.scen + 设计文档）定期复制到 `D:\F1-AI` 归档——**想定文件绑定的是库指纹，库文件（DB3K_505.db3）两边都有且一致，搬过去照样能开**；
- 脚本迁移注意：从本机复制的 probes/判读脚本里写死了路径常量（桥令牌文件、EXPORT_ROOT、EXPORT_INI、想定目录），**复制到新机后必须全局把 `D:\soft\F1\F1-测试` 换成 `D:\ZXY\soft\F1\F1`、`D:\soft\F1-AI` 换成新机对应根**，否则又是 path_not_allowed。

### 不推荐的替代项（说明理由）

把 `D:\F1-AI\F1-测试` 补全成完整资源根再切过去——理论上成立（本机就是这么跑的），但要补齐 WW(58GB)+GIS 全集+模板登记+新机授权，和你们"删 WW 省空间"的初衷直接矛盾，且多一棵树多一份不一致风险。**资源根只留一棵（ZXY 完整树），D:\F1-AI 定位=归档与开发副本。**

## 四、给后续迁移的规矩（沉淀）

1. 资源根指向的树必须完整：exe+DLL、GIS（含 LandCover）、WW、DB、Config、Symbols、Sound、Lua、templates\registry、knowledge 一个不能少；瘦身副本只能当数据备份，不能当资源根。
2. **.license 文件永不跨机拷贝**——授权按机器硬件指纹发放，新机用新机自己的授权文件。
3. 想定、库文件可以随便跨机复制（绑定关系在文件内部：想定内层记库 SHA1）。
4. WritableRoot.txt 改动属于"动资源根"级操作：改前必须确认目标树完整，改后第一次启动要在场观察 3 分钟（本类故障都在 1 分钟左右发作）。
