# FINAL-RUNTIME-R1：任务控制未接入运行时——只读诊断 Cursor 工单

## 一、现场结论

owner 已在真实界面确认：AI 助手窗口可以打开，DeepSeek 官方配置存在且密钥已保存，但任务区逐字显示：

- `任务：任务控制尚未接入运行时`
- `场景：状态未知`
- `任务控制尚未接入，所有任务按钮已禁用`

因此 owner 点击“执行任务”失败不是操作错误，也不是模型参数错误；生产 AI runtime 或任务控制 bridge 没有成功启用。当前飞机 P1→P3 全部暂停。

另：重启后当前界面显示 DB3K_505，说明尚未重新加载 owner 的 515 工作副本。禁止在 505 想定上手工切数据库或继续测试；runtime 修好后应重新加载 515 工作副本。

## 二、冻结现场

- 候选程序：`D:\soft\F1-AI-runtime-a0e5675-a1r3\F1.exe`
- 候选 HEAD：`a0e56757d2ff7da8cda2addbce02c4cb3f4e8643`
- 候选 F1.exe SHA-256：`117BDC5E8564D7EE6C3CA9E234C8C8F18AE187476D4982938D149762DBA9D2F3`
- 候选 F1.dll SHA-256：`6F37EB0C9E006B3CE98C2B1152F6B479A1E4E1FCE6D19A2ECE17B69C8FE1AC12`
- `WritableRoot.txt` owner 冻结值：`D:\soft\F1\F1-测试`
- 待恢复测试想定：`D:\soft\F1-AI-runtime-a0e5675-a1r3\Scenarios\A1R3-515-OWNER-WORK.scen`
- 正常模型配置：界面选中 `DeepSeek 官方`，地址 `https://api.deepseek.com/v1`，模型 `deepseek-v4-flash`，API Key 已掩码保存。不得打印、复制或改写密钥。

重要历史：上一轮为 mock 探针临时切换 profile，随后在 F1 仍运行时从备份恢复过 `assistant.db`。必须检查这一操作是否导致数据库主文件与 `-wal/-shm`、启动审计链或运行时内存状态不一致；但不得先入为主，必须用磁盘证据裁决。

## 三、只读红线

- 本单只诊断，不修复。
- 不修改/替换/删除/重命名 `assistant.db`、`assistant.db-wal`、`assistant.db-shm` 或任何备份。
- 不运行 checkpoint、VACUUM、REINDEX、迁移、恢复、清锁、确认恢复。
- 不修改 WritableRoot、DefaultDB、Command.ini、模型配置、想定或 DB 文件。
- 不结束 owner 的 F1；如必须取得启动日志，只报告需要重启，不自行重启。
- 不改源码/测试，不 commit/push/tag，不使用 `git add -A`。
- 不再尝试执行任务、P1/P2/P3、mock server 或 Lua 控制台。

## 四、必须取得的证据

### 1. 运行与路径

记录当前 F1 PID、真实进程路径、启动时间、exe/dll 哈希、`WritableRoot.txt` 内容。

### 2. runtime 与面板初始化日志

从当前 WritableRoot 及候选目录查找并复制到证据目录：

- `logs\ai-assistant-init.log`
- `logs\ai-provider-diag.log`
- 当天最新 F1/Exception/debug 日志

逐字检索并原样引用：

- `AiAssistant disabled:`
- `AiAssistant init failed:`
- `BindProductionRuntime`
- `bind-production`
- `audit_integrity_failed`
- `anchor_`
- `runtime`
- `task control`

引用不到写“未找到”，不得凭记忆补全。

### 3. assistant.db 文件组只读核对

定位 AI 实际使用的 `data\assistant.db`，记录主文件、`-wal`、`-shm`、相关 `.bak` 的完整路径、大小、修改时间和哈希。先证明 runtime 实际使用哪一个目录，不得假设是在候选目录。

允许使用只读 SQLite 连接执行不会写盘的查询，例如 `PRAGMA query_only=ON` 后的 `PRAGMA quick_check`、读取 schema/version、只读统计任务/审计链/anchor 行数。禁止任何会创建、迁移、checkpoint 或修复文件的操作。若无法保证只读，就只记录文件元数据并停在该项。

特别对照：F1 PID 启动时间、mock profile 写入时间、assistant.db 恢复时间、wal/shm 最后修改时间，判断是否存在“运行中替换主库但遗留旧 WAL/SHM”的事实证据。

### 4. 机械分类

报告必须落入下列一类或多类，并给逐字证据：

- A：`CreateProductionRuntime` 抛异常，`_aiRuntime=null`。
- B：runtime 创建成功但 `IsEnabled=false`，例如启动审计链失败。
- C：runtime 正常，但 `BindProductionRuntime` 中途失败并回滚为 Null bridge。
- D：runtime/bridge 正常，面板绑定时序或窗口实例错误。
- E：证据不足，标“待确认”，列缺的唯一证据。

不得把 DeepSeek 连接是否成功与任务控制 bridge 是否接入混为一谈；截图已证明任务按钮在模型调用前就被禁用。

## 五、报告与下一步

证据目录：

`D:\soft\F1-AI-integration\runs\final-runtime-r1-20260902\`

报告落盘：

`D:\soft\F1-AI\FINAL-RUNTIME-R1-任务控制未接入只读诊断报告-20260902.md`

报告第一段必须用大白话说明：后台为什么没启动、是否与运行中恢复 assistant.db 有关、是否需要仅重启即可恢复、还是必须另开代码/数据返修单。

报告不得直接实施修复。若结论是“只需安全重启”，也必须先说明重启前是否需要处理 WAL/SHM；未经监理裁决不得删除文件或重启碰运气。
