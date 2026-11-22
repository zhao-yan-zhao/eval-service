# FINAL-RUNTIME-R1：任务控制未接入——只读诊断报告

**诊断时刻：** 2026-09-02 14:15–14:24 (+08)  
**证据目录：** `D:\soft\F1-AI-integration\runs\final-runtime-r1-20260902\`  
**本单性质：** 只诊断，不修复；未改 WritableRoot / DefaultDB / Command.ini / 模型密钥 / 想定 / DB 主内容；未重启 F1；未 commit/push。

---

## 一、大白话结论（先看这段）

后台不是“模型没连上”，而是 **生产 AI runtime 在启动恢复阶段自己关掉了**。

具体链路：

1. `CreateProductionRuntime` 跑到 `TaskOrchestrator.RecoverOnStartup()`；
2. 扫残留 `task_runtime:*` 时，`TaskRuntimeState.FromJson` 撞上库里仍存着的 **schema=1** 旧运行时状态；
3. 抛出 `runtime_schema_unsupported:1` → 记入 `ai-provider-diag.log`；
4. runtime 以 `IsEnabled=false`、`DisableReason=recover_on_startup_failed` 返回；
5. 面板 `BindProductionRuntime` **成功提交**但 `enabled=False`，任务桥被绑成 `NullTaskControlBridge`；
6. 于是界面逐字变成「任务控制尚未接入运行时 / 所有任务按钮已禁用」。

这与 DeepSeek 配置是否有效 **无关**（设置页仍可打开、profile 仍在）；任务按钮在调用模型前就被禁，证据与现场一致。

**和“运行中恢复 assistant.db”的关系：**  
有事实证据表明下午曾对 WritableRoot 下的 `assistant.db` 做 mock 切 profile + `shutil.copy2` 整库恢复（见 `runs\stable-r3-a1-r3-20260902\setup-mock-profile.py`，且当时 F1 仍在跑）。  
但 **当前 fail-closed 的充分条件是磁盘上仍有 4 条 schema=1 的 `task_runtime`**（2026-08-18 遗留）；备份 `assistant.db.bak` 里同样是 schema1×4 / schema2×60。  
因此：**不能指望“只重启碰运气”恢复任务控制**；需要另开 **数据清理和/或代码容错** 返修单。  
诊断开始时 wal/shm **不存在**；之后出现的 0 字节 wal / shm **更像本单只读 SQLite 探测的副作用**，不能当作“运行中换库遗留旧 WAL”的独立铁证。重启前是否处理 wal/shm：**须监理裁决，本单不删、不碰运气清锁**。

---

## 二、机械分类

| 类 | 是否成立 | 说明 |
|----|----------|------|
| **B** | **成立（主因）** | runtime 对象创建成功，但 `IsEnabled=false`，原因 `recover_on_startup_failed`（根因消息 `runtime_schema_unsupported:1`） |
| A | 不成立 | 未见 `AiAssistant init failed:`；有 `AiAssistant disabled:` 与 `BindProductionRuntime committed enabled=False`（说明 `_aiRuntime` 非 null） |
| C | 不成立 | 未见 `[panel] BindProductionRuntime failed — rolling back`；本次是 **committed enabled=False** 后主动绑 Null bridge |
| D | 不成立 | 绑定时序正常；Null bridge 是 B 的预期下游，不是窗体绑错 |
| E | 局部 | 13:46 会话曾出现一次 `enabled=True` 的短暂成功，与同库长期存在 schema=1 的静态事实如何兼容，**证据不足**；不影响当前失败主因判定 |

---

## 三、运行与路径证据

### 3.1 进程（诊断时刻）

```
captured_at=2026-09-02T14:15:28.0943147+08:00
NO_F1_EXE_RUNNING
```

（证据：`00-process.txt`）  
工单要求不自行重启；**当前现场 F1 已不在跑**，无法采到实时 PID/启动时刻。历史会话见 ExceptionLog。

### 3.2 候选二进制哈希（与冻结值一致）

| 文件 | SHA-256 | 冻结值 |
|------|---------|--------|
| `D:\soft\F1-AI-runtime-a0e5675-a1r3\F1.exe` | `117BDC5E8564D7EE6C3CA9E234C8C8F18AE187476D4982938D149762DBA9D2F3` | 一致 |
| `D:\soft\F1-AI-runtime-a0e5675-a1r3\F1.dll` | `6F37EB0C9E006B3CE98C2B1152F6B479A1E4E1FCE6D19A2ECE17B69C8FE1AC12` | 一致 |

（证据：`01-hashes.txt`）

### 3.3 WritableRoot（实际 AI 根）

候选目录 `WritableRoot.txt` UTF-8 原文：

```
D:\soft\F1\F1-测试
```

冒烟探针最后一次写入（13:55:10）：

```
armed=False
writable_effective=D:\soft\F1\F1-测试
```

→ **AI 实际使用的库是** `D:\soft\F1\F1-测试\data\assistant.db`，不是“假设在候选目录”。  
候选目录下另有一份不同哈希的 `data\assistant.db`（见下），属旁路副本。

---

## 四、日志逐字检索

日志已复制到证据目录：`wr-*`（WritableRoot）、`cand-*`（候选目录）。

### 4.1 工单必搜关键词

| 关键词 | 结果 |
|--------|------|
| `AiAssistant disabled:` | **命中**（多次）`AiAssistant disabled: recover_on_startup_failed` |
| `AiAssistant init failed:` | **未找到** |
| `BindProductionRuntime` | **命中** |
| `bind-production` | **未找到** |
| `audit_integrity_failed` | **未找到** |
| `anchor_` | **未找到** |
| `runtime` | **命中**（含 `runtime_schema_unsupported`、BindProductionRuntime 等） |
| `task control` / `任务控制` | **未找到**（UI 文案不进这些日志） |

### 4.2 关键原样摘录

**ExceptionLog（WritableRoot）——启动禁用：**

```
AiAssistant disabled: recover_on_startup_failed
```

（同日多次：11:00 / 11:19 / 11:33 / 13:23 / 13:55 会话；证据 `10-exception-ai-timeline.txt`）

**ai-provider-diag.log（WritableRoot）——根因消息：**

```
recover_on_startup_failed: runtime_schema_unsupported:1
```

（文件内连续多行同文；证据 `wr-ai-provider-diag.log`）

**ai-assistant-init.log（WritableRoot）——今日面板绑定：**

```
2026-09-02T05:51:01.1630386Z [panel] BindProductionRuntime committed enabled=True
2026-09-02T05:51:01.1656291Z [panel] BindProductionRuntime enabled=True
...
2026-09-02T05:56:37.2647054Z [panel] BindProductionRuntime committed enabled=False
2026-09-02T05:56:37.2660925Z [settings] EnsureBound entered store_null=True
2026-09-02T05:56:37.3381559Z [chat] EnsureBound entered store_null=True
2026-09-02T05:56:37.4330369Z [panel] BindProductionRuntime enabled=False
```

（UTC；对应本地约 13:51 曾启用、13:56 已禁用。`enabled=False` 时 settings/chat 为 `store_null=True`，与 `BindProductionRuntime` 在 `!IsEnabled` 时只绑 Null 任务桥、不绑 Store 的源码行为一致。）

**源码对应（只读引用，未改）：**

- `AiAssistantCompositionRoot.CreateProductionRuntime`：`RecoverOnStartup` 异常 → `enabled:false` + `recover_on_startup_failed`
- `TaskRuntimeState.FromJson`：`Schema != CurrentSchema(2)` → `runtime_schema_unsupported:{n}`
- `TaskOrchestrator.SweepResidualRecoveryBlocksUnlocked`：对 **全部** `task_runtime:*` 调用 `FromJson`（先于 `recovery_block` 空值跳过）
- `AiAssistantPanelForm.BindProductionRuntime`：`!IsEnabled` → `NullTaskControlBridge.Instance`，仍 `committed enabled=False`

---

## 五、assistant.db 文件组（只读）

### 5.1 实际使用文件（WritableRoot）

| 路径 | 诊断初检（约 14:16） | 之后复检（约 14:21） | SHA-256（主库） |
|------|---------------------|---------------------|-----------------|
| `D:\soft\F1\F1-测试\data\assistant.db` | 存在，5484544，LWT=14:04:05 | 同左 | `36A096EE226E04EA49AEC44971F7232AB820999CAA77AD952769635AE66CBC90` |
| `...\assistant.db-wal` | **ABSENT** | 存在，Length=**0**，LWT≈14:18 | （空文件） |
| `...\assistant.db-shm` | **ABSENT** | 存在，32768，LWT≈14:19–14:21 | （诊断探测后出现） |
| `...\assistant.db.audit-evidence-20260901-061745` | 存在，5464064 | — | `184F6ECE…` |

**说明：** 初检无 wal/shm；本单只读 `mode=ro` + `PRAGMA query_only=ON` 探测之后出现 0 字节 wal 与 shm。报告将其标为 **诊断副作用嫌疑**，**不得**据此单独裁决“运行中换主库遗留旧 WAL”。未经监理 **禁止删除**。

### 5.2 旁路 / 备份对照

| 文件 | SHA-256 | schema 直方图 |
|------|---------|----------------|
| WritableRoot 主库 | `36A096EE…` | schema1=**4**，schema2=60 |
| `runs\stable-r3-a1-r3-20260902\assistant.db.bak`（LWT=13:23:27） | `52309575…` | schema1=**4**，schema2=60 |
| 候选目录 `...\a0e5675-a1r3\data\assistant.db` | `A7607197…` | （未作为运行 WritableRoot） |

### 5.3 只读 SQLite（`PRAGMA query_only=ON`）

- `PRAGMA quick_check` = `ok`
- `schema_version` 表：迁移到 version **3**（`003_audit_chain_v2`，applied 2026-09-01）
- `ai_tasks`：64 行，状态仅 7/8/9（终端态），**无非终端任务**
- `ai_audit_chain_anchors`：64
- **`task_runtime` schema=1 共 4 条**（均无 `recovery_block`，updated 2026-08-18）：
  - `task_runtime:033a5d4e0c624dcda955421f51a4a895`
  - `task_runtime:8a2d5c15bc894958aaa07269f608bdcf`
  - `task_runtime:4c1e0c1a34634f7dbf166c3fe53ce714`
  - `task_runtime:3da0527d53744a54aba2b9e49a4abead`
- 另有 1 条 schema=2 且 `recovery_block=sim_stop_unconfirmed`：`task_runtime:5d65191c63054df7b371c9581443c5a0`（Sweep 本应清理此类；但若先撞 schema=1 会整段失败）

schema=1 原文摘录（截断仅示结构）：

```
{"schema":1,"task_id":"033a5d4e0c624dcda955421f51a4a895",...,"recovery_block":null}
```

### 5.4 模型配置（无密钥）

- `active_provider_profile_id` = `"preset-deepseek"`，updated `2026-09-02T05:39:20Z`（本地约 13:39）
- profile `preset-deepseek`：`DeepSeek 官方`，`https://api.deepseek.com/v1`，`deepseek-v4-flash`
- 另存 profile `a1r3-mock-probe`（`http://127.0.0.1:18765/v1`）——与 mock 探针一致；**当前未激活**
- **未打印、未复制任何 API Key**

### 5.5 时间线对照（与“运行中恢复”相关）

| 本地时间 | 事件 |
|----------|------|
| 13:23 | ExceptionLog：新会话 + `AiAssistant disabled: recover_on_startup_failed`；同刻写出 `assistant.db.bak` |
| ~13:37 | `ai-task-db`：F1 **pid=9440 仍在跑**，点开 AI 面板（此时任务区应已是未接入态） |
| ~13:37–13:39 | `setup-mock-profile.py`：对 WritableRoot `assistant.db` **写 mock profile**；随后 `restore` 路径会 `shutil.copy2(BAK→DB)` 并写回 active profile（active 更新戳 13:39） |
| 13:46 | ExceptionLog：**无** `AiAssistant disabled` 行；init：`BindProductionRuntime committed enabled=True`（13:51 点面板）——**一次短暂成功，机制待确认** |
| 13:55 | 再次 `AiAssistant disabled: recover_on_startup_failed`；diag：`runtime_schema_unsupported:1`；init：`enabled=False` |
| 14:04 | `assistant.db` 主文件 LWT |
| 14:15 | 诊断：F1 **未在运行** |

---

## 六、是否“只重启即可”

| 问题 | 裁决 |
|------|------|
| 仅安全重启能否恢复任务控制？ | **否（就当前磁盘证据）**。schema=1 的 4 条 `task_runtime` 仍在；重启会再次走 `RecoverOnStartup` → 同样 fail-closed。 |
| 重启前要不要删 wal/shm？ | **本单不删。** 初检无 wal/shm；现有 0 字节 wal/shm 高度疑似诊断副作用。须监理单独裁决。 |
| 是否必须另开返修单？ | **是。** 至少一类：数据侧清除/归档 schema=1 残留（或受控迁移）；和/或代码侧 Sweep/`FromJson` 对旧 schema 的 fail-closed 策略（避免一条旧诊断状态拖死整库启用）。 |
| DeepSeek / mock profile？ | **不是本故障主因。** 当前已回到 `preset-deepseek`；任务桥在模型调用前已因 B 类禁用。 |

---

## 七、下一步建议（仅建议，本单不实施）

1. **监理裁决**：是否、如何处理当前 `assistant.db-wal`（0B）/`-shm`；是否允许在 F1 完全退出后做只读复核。  
2. **新开数据返修单**：在完整备份前提下，处理 4 条 schema=1 `task_runtime`（及评估 schema2 `recovery_block=sim_stop_unconfirmed` 残留）。  
3. **可选代码返修单**：Sweep 遇到 `runtime_schema_unsupported` 时是否应隔离单条而非整 runtime 禁用（产品策略，非本单范围）。  
4. runtime 恢复并经监理确认后：再加载 `A1R3-515-OWNER-WORK.scen`；**禁止在 DB3K_505 上继续 P1–P3**。  
5. 禁止再对运行中 F1 执行 `setup-mock-profile.py` 式整库 `copy2`。

---

## 八、证据文件清单

目录：`D:\soft\F1-AI-integration\runs\final-runtime-r1-20260902\`

- `00-process.txt` … `22-*.txt` / `07`–`18` JSON：进程、哈希、WritableRoot、库存、关键词命中、只读库检、bak 对照、schema1 全文等  
- `wr-ai-assistant-init.log` / `wr-ai-provider-diag.log` / `wr-ExceptionLog_2026_09_02.txt`  
- `cand-*`：候选目录旁路日志副本  

---

**报告完。未实施任何修复。**
