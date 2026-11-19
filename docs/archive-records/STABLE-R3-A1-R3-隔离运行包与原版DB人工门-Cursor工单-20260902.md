# STABLE-R3-A1-R3 隔离运行包与原版 DB 人工门——Cursor 工单

## 一、结论与任务目标

R2/ADD 的停工结论正确，但已查明真正阻塞不是普通 UI 自动化失败：候选输出目录 `D:\soft\F1-AI-integration\F1` 没有程序实际读取的 `DB` 运行时目录，F1 弹窗逐字报错“想定数据库哈希值匹配失败，哈希值为 5A5A97C...”，初始化已中止。只重复点击、只加载想定或只修改旧专机的 DefaultDB 都不能解决。

本轮先在**全新隔离目录**建立可追溯运行包：以已能运行的专机目录提供非代码资源，以 integration 最终候选提供程序文件，排除 HACM 修改库；证明运行时实际绑定原版 DB3K_515 后，才继续同一架飞机的 P1→P2→P3 航线探针。

本单不改生产代码、测试代码或旧专机，不把运行包提交进 Git。

## 二、冻结输入

- 源码 worktree：`D:\soft\F1-AI-integration`
- 分支：`integration/stable-single-ai`
- 冻结 HEAD：`a0e56757d2ff7da8cda2addbce02c4cb3f4e8643`
- 候选清单：`D:\soft\F1-AI\STABLE-R3-a0e5675-最终候选运行清单-20260901.md`
- 候选输出：`D:\soft\F1-AI-integration\F1`
- 已能运行的资源源目录：`D:\soft\F1\F1-测试`
- 原版数据库源文件：`D:\soft\F1\F1-测试\DB\DB3K_515.db3`
- 原版 DB SHA-256：`D398E5B1C9A7C81A427267DFEAD52D9EA587954C914FD1FF096D91FDC73EDB39`
- 原版 DB SHA-1 / 想定绑定值：`5A5A97C7746D3CA72F59F4478AAFAA49860E3F5B`
- 候选 F1.exe SHA-256：`117BDC5E8564D7EE6C3CA9E234C8C8F18AE187476D4982938D149762DBA9D2F3`
- 候选 F1.dll SHA-256：`6F37EB0C9E006B3CE98C2B1152F6B479A1E4E1FCE6D19A2ECE17B69C8FE1AC12`
- 候选 binlog SHA-256：`A4C8A907DE079409F53919643FE4A27F8EC57F069C0F7A36330DE69FB7EDD782`

## 三、新运行目录开工门

固定新目录：

`D:\soft\F1-AI-runtime-a0e5675-a1r3`

开工先检查该目录**必须不存在**。若已经存在，立即停工并报告，禁止覆盖、删除、清空或复用。不得用 `robocopy /MIR`、`git clean`、递归删除或任何会反向影响源目录的方式。

同时确认：

1. integration 分支与 HEAD 未漂移；源码/测试无脏项，既有 `runs/` 除外。
2. 旧专机 `D:\soft\F1\F1-测试` 不在运行、HACM 已停止。
3. 资源源目录和 DB3K_515 文件真实存在；先重算 DB 两种哈希。
4. `D:\soft\F1-AI-integration\F1\DB` 当前不存在或不含 515，留证说明这是 R2 初始化失败的直接环境原因。

任何一项不符都报 `blocked`，不得自行换路径、改旧专机或回退旧二进制。

## 四、隔离运行包制作规则

1. 只向全新的 `D:\soft\F1-AI-runtime-a0e5675-a1r3` 写入。
2. 从 `D:\soft\F1\F1-测试` 复制运行所需资源和目录到新目录；复制时必须明确排除：
   - `HACM_Modified.db3` 及任何名称含 HACM 的修改库；
   - `Logs`、临时文件、崩溃转储、旧探针输出；
   - `backup`、`runs`；
   - 无法确认来源的密钥明文文件。
3. 资源复制完成后，再从 `D:\soft\F1-AI-integration\F1` 覆盖候选构建产物到新目录。只允许覆盖**新隔离目录**，绝不覆盖 `D:\soft\F1\F1-测试` 或 `D:\soft\F1-AI\F1`。
4. 覆盖后重算新目录 `F1.exe`、`F1.dll` 哈希，必须与冻结候选完全一致。
5. 新目录的 `DB` 中必须存在且至少包含原版 `DB3K_515.db3`；该文件 SHA-256/SHA-1 必须与冻结值一致。若新目录仍包含 HACM 修改库，停工，不得启动。
6. 新目录 `Config\Command.ini` 的 `DefaultDB` 只在新目录内设置为原版 515 SHA-1。修改前后都留证；不得修改资源源目录的配置。
7. 新目录必须生成一份 `RUNTIME-MANIFEST-a0e5675.txt`，记录资源源路径、候选源路径、排除项、HEAD、exe/dll/db 哈希、制作时间。严禁记录 API key 原文。

若复制全量资源会导致来源不明或磁盘空间不足，停工上报；禁止改用目录联接指向含 HACM 的旧 DB 目录，也禁止只复制二进制到旧专机。

## 五、运行时数据库硬门（人工优先，自动化辅助）

只准启动：

`D:\soft\F1-AI-runtime-a0e5675-a1r3\F1.exe`

启动后先记录真实进程路径。若出现任何 Error 小窗，先逐字抄录完整错误，不得让脚本自动点“确定”后继续猜状态。

加载隔离目录内的 515 探针想定副本。探针想定可从：

`D:\soft\F1\F1-测试\Scenarios\_tmp_a1r2_515_PROBE_ONLY.scen`

复制到新隔离目录的 `Scenarios`，不得在源文件上运行或保存。

本轮允许人工操作菜单、文件选择框和 Lua 控制台；UI 自动化只作辅助。执行 `p0-db-gate-515.lua` 或等价只读命令，必须取得本轮新鲜的原始输出，证明：

- 当前实际进程路径是新隔离目录；
- 当前已加载想定的 `DBUsed` 对应 `DB3K_515.db3`；
- `db515_filename_match=true`，或取得能与 SHA-1 `5A5A...` 等价绑定的真实运行时证据。

只有磁盘 XML、静态哈希或历史 LuaHistory 不算通过。若运行时绑定门仍不过，立即停工，不执行 P1/P2/P3。

## 六、运行时门通过后继续飞机航线 P1→P3

沿用 R2 已在原版 515 静态复查的同一参数：

- side=`Blue`
- Aircraft dbid=`8`（F/A-18C）
- loadout_id=`2544`
- unit_name=`A1R3-Probe-Hornet-515`
- 初始坐标 `(25.0,130.0)`
- 两航点 `(25.5,130.5)`、`(26.0,131.0)`

顺序不可变：

1. **P1**：通过 AI 助手生产 `unit.add` 创建飞机并内嵌 course；保存完整工具请求/回执。
2. **P1 真实读回**：读取实际 `ScenEdit_GetUnit(...).course` / `Navigator.PlottedCourse`，不得拿请求中的 `course_waypoints` 计数冒充成功。
3. **P2**：对同一 GUID 调用生产 `unit.update_position` 再设置同一航线；不得重建另一架飞机。
4. **P2 真实读回**：再次读取真实 PlottedCourse。
5. **P3**：短时运行仿真并观察飞机是否沿航线发生符合预期的移动；记录触发前后位置、航线点和截图。不得仅凭地图动画主观判断。

机械裁决：

- P1 无真实航线、P2 后有真实航线：支持开“创建后自动补设航线”的生产返修单。
- P1 已有真实航线：不开发二次补设，继续定位此前真机样本为何打转。
- P1/P2 均无真实航线：不得实施 A1 方案，回到 F1 Lua/数据库兼容性调查。
- 任一步版本、DB、GUID、读回不确定：`blocked`，不得猜。

## 七、四门与清理

若 P1→P3 完整执行，在同一冻结 HEAD 保存以下结果：

```powershell
git diff --check
dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore
dotnet build CMO-netcore-src\F1-AllInOne.csproj -c Debug -p:Platform=x64 -t:Rebuild --no-restore
git status --short
```

预期全量 L1 927/927；AllInOne 0 错误/1138 警告。任何变化停工。

收工必须关闭新隔离目录 F1，不保存覆盖源想定；源码/测试不改、不 commit/push/tag。**保留**新隔离运行目录和清单供监理复核，未经监理签收不得删除；它是新建可回收产物，不得纳入 Git。

## 八、报告

证据目录：

`D:\soft\F1-AI-integration\runs\stable-r3-a1-r3-20260902\`

报告：

`D:\soft\F1-AI\STABLE-R3-A1-R3-隔离运行包与飞机航线真机探针报告-20260902.md`

报告必须先用大白话写明：

1. 隔离运行包是否成功，旧专机是否保持未改。
2. 新运行目录中是否只使用原版 515，是否排除了 HACM。
3. F1 运行时实际加载哪个数据库。
4. P1、P2、P3 分别完成/失败/未执行，真实功能结论是什么。
5. 是否建议开发“创建后自动补设航线”，以及该建议对应哪条机械裁决。
6. 四门结果、源码状态、未做项。

Cursor 自报不算关门；报告回来后由监理复核运行包、逐字证据并亲跑四门。
