# FINAL-RUNTIME-R3：新候选灌装与任务桥复验——Cursor 完整工单

> 目标：把监理已验收的 `26effb3` 灌装到一个全新的隔离运行目录，确认 AI 任务后台恢复为可用。不得覆盖旧运行包，不得删或手改生产数据库。

## 一、开工门

- 代码工作区：`D:\soft\F1-AI-integration`
- 分支：`integration/stable-single-ai`
- HEAD 必须为：`26effb30d3cc9989c3ad24a5f76675dc24b10575`
- 新运行目录：`D:\soft\F1-AI-runtime-26effb3-a1r4`
- **开工时该目录必须不存在**。若已经存在，立即停工，不得清空、覆盖或复用。
- F1 进程数必须为 0；若在运行，停工报告，不自行强杀。
- 源码/测试区必须干净，仅允许既有 `runs/` 脏项。

监理已在该 HEAD 亲验：范围与 diff 通过、恢复相关 25/25、全量 L1 935/935、AllInOne Debug x64 Rebuild 0 错/1138 既有警告。本单不改源码、不 commit。

## 二、冻结二进制

候选来源：`D:\soft\F1-AI-integration\F1`

必须逐项核对：

| 文件 | SHA-256 |
|---|---|
| `F1.exe` | `117BDC5E8564D7EE6C3CA9E234C8C8F18AE187476D4982938D149762DBA9D2F3` |
| `F1.dll` | `E6D4D73F8EEC43C9CF658580498B71572D234FBA36DCCD07AE8A4357499DE640` |
| `F1.pdb` | `475DE30446FF96E74A93CC0A894839464D97C531056A1950470279406C2E57FC` |
| `F1.deps.json` | `4CA4CF0678F626C0026065602DE8A0D4156707C5A901CCFD6C7E102186D31C64` |
| `F1.runtimeconfig.json` | `3620D53DC87B4AA2CBD50B5CA80BAA3E3A017D9D38CB72F690E44295AFC33F77` |

任一不一致立即停工；不得重编后擅自接受新哈希。

旧可运行资源包仅作为非代码资源来源：

`D:\soft\F1-AI-runtime-a0e5675-a1r3`

其中旧 `F1.dll` 哈希为 `6F37EB0C...`，严禁把它当新候选。

## 三、全新隔离灌装

1. 创建全新的 `D:\soft\F1-AI-runtime-26effb3-a1r4`。
2. 从旧 a1r3 运行包复制运行所需非代码资源和依赖到新目录；不得移动或删除源目录内容。
3. 不复制以下生成/证据内容：
   - `logs/`、`backup/`、`backups/`、`runs/`、`Temp/`、旧 `AALog.txt`
   - 旧 `data/assistant.db*`
   - 任何 `*HACM*`、`HACM_Modified.db3`、旧 manifest
4. 从已冻结候选来源覆盖新目录的构建产物，至少包括 `F1.exe`、`F1.dll`、`F1.pdb`、`F1.deps.json`、`F1.runtimeconfig.json`、`F1.runtimeconfig.dev.json`。复制后重新计算哈希，必须与第二节一致。
5. `WritableRoot.txt` 必须逐字为：

   `D:\soft\F1\F1-测试`

   不得改成新运行目录，也不得改 owner 的资源根。
6. 把 owner 已准备的工作副本复制到新运行目录的 `Scenarios` 下：

   源：`D:\soft\F1-AI-runtime-a0e5675-a1r3\Scenarios\A1R3-515-OWNER-WORK.scen`

   目标：`D:\soft\F1-AI-runtime-26effb3-a1r4\Scenarios\A1R3-515-OWNER-WORK.scen`

   源文件 SHA-256 必须为：`B417B1ED560D251AB87AEE85F010517AEA5351CB4C04E68BC96CE948D754051F`。
7. 全目录扫描不得出现 HACM 修改库；不得改 `D:\soft\F1\F1-测试\DB`、`DefaultDB` 或 `Command.ini`。

将灌装清单写入新目录：

`RUNTIME-MANIFEST-26effb3.txt`

必须记录 HEAD、来源、目标、WritableRoot、五个候选文件哈希、owner 工作想定哈希，以及“未复制生产 assistant.db”。

## 四、生产数据库启动前保护

实际 AI 数据库为：

`D:\soft\F1\F1-测试\data\assistant.db`

在 F1 完全退出时：

1. 记录主库、`-wal`、`-shm` 是否存在、长度、时间和哈希。
2. 在证据目录做逐文件只读备份；存在什么就复制什么，不存在就写 ABSENT：

   `D:\soft\F1-AI-integration\runs\final-runtime-r3-20260902\prestart-db-backup\`

3. 禁止删除、改名、checkpoint、VACUUM、覆盖或回滚生产库及 wal/shm。
4. 禁止再运行 `setup-mock-profile.py` 或对运行中的数据库做 `copy2`。

说明：本次首次启动会执行生产 `RecoverOnStartup`。按已验收合同，四条 schema=1 旧终态空恢复记录应原样跳过；一条 schema=2 终态残留 block 可能由既有逻辑正常清除。这是预计的最小启动写入，不得扩大为人工清库。

## 五、运行时复验

只从以下路径启动：

`D:\soft\F1-AI-runtime-26effb3-a1r4\F1.exe`

### 5.1 进程与版本门

- 记录实际 PID、进程路径、启动时间；路径必须是 a1r4。
- 运行中再次核对磁盘 `F1.dll` 哈希为 `E6D4D73...E640`。
- 不得同时运行其他 F1/HACM 实例。

### 5.2 加载 owner 515 工作想定

- 只加载新目录中的 `A1R3-515-OWNER-WORK.scen`。
- 不新建想定，不手工切数据库，不保存覆盖 owner 原件。
- 截图证明地图正常、无数据库哈希 Error、右下角或想定属性明确为 `DB3K_515`。

### 5.3 AI 任务桥硬门

打开 AI 助手，必须同时满足：

1. 不再显示“任务控制尚未接入运行时”；
2. 不再显示“所有任务按钮已禁用”；
3. `ai-assistant-init.log` 有本次会话的 `BindProductionRuntime committed enabled=True`；
4. 本次 ExceptionLog/diag 无 `AiAssistant disabled: recover_on_startup_failed`；
5. 本次 diag 无 `runtime_schema_unsupported:1`；
6. 面板显示场景已识别，任务控制处于可创建/可执行的正常待命状态。

本单只验证任务桥恢复，不执行飞机创建、航线、事件或其他写场景任务，不调用自由 Lua。

若上述任一失败：截图、留日志、正常关闭 F1，报告 blocked；禁止再改数据库或配置碰运气。

## 六、关闭后的数据核验

任务桥硬门取证完成后，正常关闭 F1。确认进程完全退出，再做只读核验：

1. 四条 schema=1 setting 的原始 JSON 与启动前逐字一致；不得被删、改写成 schema=2 或更新时间漂移。
2. 对应四个 `ai_tasks` 仍为原终态。
3. schema=2 的终态 `task_runtime:5d65191c63054df7b371c9581443c5a0`：若 `recovery_block` 已被既有扫描清空，记录为预期；若未清空，报告待确认，但不能反向修改。
4. 记录启动前后数据库文件组元数据与 quick_check；不删除启动后 wal/shm。
5. 当前模型 profile 应仍为 `preset-deepseek`；不得打印 API Key。

## 七、红线

- 不改源码/测试/项目文件，不 commit/push/tag。
- 不覆盖、删除或清理旧 a1r3 运行包。
- 不覆盖 owner 原始想定；只使用 WORK 副本。
- 不删 production assistant.db/wal/shm，不手改 setting，不迁移四条 schema1。
- 不改 WritableRoot、DB3K、DefaultDB、Command.ini、模型配置。
- 不做 A1 飞机航线，不做 A14，不启动 A1–A16 正式计分。

## 八、完事报告

报告落盘：

`D:\soft\F1-AI\FINAL-RUNTIME-R3-新候选灌装与任务桥复验报告-20260902.md`

证据目录：

`D:\soft\F1-AI-integration\runs\final-runtime-r3-20260902\`

报告用大白话先说明：

- 新候选是否确实运行；
- 515 想定是否正常加载；
- AI 任务按钮是否恢复；
- 四条旧记录是否原样保留；
- 是否还出现 recover_on_startup_failed；
- 做了哪些预期数据库写入；
- F1 最终是否已关闭。

完成后停下，等待监理核证。任务桥通过也只代表“当前启动阻塞解除”，不代表飞机航线、A1–A16 或稳定版发布已经完成。
