# FINAL-RUNTIME-R3：新候选灌装与任务桥复验报告

**报告时间：** 2026-09-03（灌装与首次会话 2026-09-02；owner 手测收口 2026-09-03）  
**证据目录：** `D:\soft\F1-AI-integration\runs\final-runtime-r3-20260902\`  
**运行目录：** `D:\soft\F1-AI-runtime-26effb3-a1r4`  
**HEAD：** `26effb30d3cc9989c3ad24a5f76675dc24b10575`（`integration/stable-single-ai`）  
**纠偏依据：** `FINAL-RUNTIME-R3-ADD`（停 UI 自动化改 owner 手测）、`FINAL-RUNTIME-R3-ADD2`（任务桥与数据库版本解耦）

---

## 大白话结论（先看这段）

1. **新候选确实在跑：** 当前 F1 为 a1r4 包内 `F1.exe`（PID 21784），磁盘 `F1.dll` 哈希 `E6D4D73F…E640`，与冻结候选一致。  
2. **AI 任务按钮已恢复：** owner 截图显示「场景：可编辑」「就绪」「执行任务」可用，**没有**「任务控制尚未接入运行时 / 所有任务按钮已禁用」；本次日志 `BindProductionRuntime committed enabled=True`。  
3. **本次没有** `recover_on_startup_failed` / 新的 `runtime_schema_unsupported:1`（diag 长度仍为 968，未追加）。  
4. **当前菜单库是 DB3000 v505：** 按 ADD2，**不阻塞**任务桥裁决；**不等于** 515 飞机环境门已过。  
5. **四条 schema=1 旧终态记录仍原样保留**；schema=2 `5d65191c…` 的 `recovery_block` 已在首次 RecoverOnStartup 清空（预期最小写入）。  
6. **GUI 操作由 owner 手工完成**；Cursor 只做灌装、只读日志与证据整理。本轮**未**执行任务、未改场景、未做飞机航线。  
7. **F1 在写本报告时仍在运行**（未强杀）；收口后由 owner/监理自行正常关闭即可。

任务桥通过 = **当前启动阻塞解除**。不代表飞机航线、A1–A16 或稳定版发布完成。

---

## 一、任务桥复验（本单主门）——通过

| # | 标准 | 结果 |
|---|------|------|
| 1 | 面板不再显示「任务控制尚未接入运行时」 | 通过（owner 截图） |
| 2 | 不再显示「所有任务按钮已禁用」类未接入提示 | 通过 |
| 3 | 本次 `ai-assistant-init.log` 有 `BindProductionRuntime committed enabled=True` | 通过：`2026-09-03T08:24:55.4166654Z` |
| 4 | 本次 ExceptionLog 无 `AiAssistant disabled: recover_on_startup_failed` | 通过（会话 `2026/9/3 15:30:07` 起无该行） |
| 5 | 本次 diag 无新的 `runtime_schema_unsupported:1` | 通过（`ai-provider-diag.log` 长度仍 968） |

界面要点（owner-04）：任务「当前无任务」；场景「可编辑」；「执行任务」可用；暂停/继续/中断/确认恢复在无任务时灰色属正常；状态「就绪。」；模型 `preset-deepseek` / DeepSeek 官方。

证据：`screenshots/owner-04-ai-panel.png`、`10-init-tail-owner-open.txt`、`14-task-bridge-verdict.txt`、`wr-ai-assistant-init.log`、`ExceptionLog_2026_09_03.txt`。

---

## 二、515 飞机环境门——本单未做 / 不得写成任务桥失败

- owner 曾加载标题为 `A1R3-515-OWNER` 的想定，但菜单 **当前数据库：DB3000 v505**。  
- ADD2 明确：任务桥与 505/515 **解耦**；515 仅留给后续飞机真机探针。  
- **未**要求 owner 切库/升级/迁移；也**未**完成「必须 DB3K_515」的飞机环境门。

证据：`screenshots/owner-02-scen-loaded-no-dbrcorner.png`、`owner-03-currentdb-v505-STOP.png`、`13-owner-db505-stop.txt`。

---

## 三、灌装与进程（已完成，未重复）

- 新目录：`D:\soft\F1-AI-runtime-26effb3-a1r4`（开工时不存在）。  
- 资源来自 a1r3 复制；因 D 盘空间不足，`DB`/`GIS`/`EventExport` 为指向 a1r3 的 NTFS 目录联接（manifest 已记）；候选二进制物理覆盖且哈希一致。  
- `WritableRoot.txt` = `D:\soft\F1\F1-测试`。  
- 未复制生产 `assistant.db*`；无 HACM 修改库灌入。  
- Manifest：`RUNTIME-MANIFEST-26effb3.txt`。

候选哈希（运行中复核）：

| 文件 | SHA-256 |
|------|---------|
| F1.exe | `117BDC5E…D2F3` |
| F1.dll | `E6D4D73F…E640` |
| F1.pdb | `475DE304…57FC` |
| F1.deps.json | `4CA4CF06…1C64` |
| F1.runtimeconfig.json | `3620D53D…3F77` |

---

## 四、生产库保护与预期写入

启动前只读备份：`prestart-db-backup\`（主库 + wal 0 字节 + shm 均已备份）。

只读核验（相对 prestart）：

- 四条 schema=1 `task_runtime` JSON 与时间戳 **逐字一致**（SAME）。  
- 对应四个 `ai_tasks` 仍为原终态。  
- schema=2 `task_runtime:5d65191c63054df7b371c9581443c5a0`：`recovery_block` 已在 **2026-09-02T07:40:17Z**（首次 a1r4 会话 RecoverOnStartup）清空——合同内预期最小写入；未人工清库。  
- `active_provider_profile_id` 仍为 `"preset-deepseek"`（未打印 API Key）。

未运行 `setup-mock-profile.py`，未对生产库做 copy2/VACUUM/删 wal。

---

## 五、角色与红线遵守

| 项 | 状态 |
|----|------|
| 不改源码 / 不 commit / 不 push | 遵守 |
| 不覆盖旧 a1r3 包 | 遵守 |
| GUI：owner 手测；Cursor 停 UI 自动化（ADD） | 遵守 |
| 不切库凑 515（ADD2） | 遵守 |
| 不执行任务 / 飞机 / 航线 / A1–A16 | 遵守 |

早期曾尝试 UI 自动化加载想定，后按 ADD 停止；真机门以 owner 截图 + 日志为准。

---

## 六、等待监理

本报告表示：**任务桥复验通过（允许在 505 场景下）**；**515 飞机环境门未做**。  
请监理核证后决定是否关闭 F1、以及何时单开 515 飞机探针。Cursor 在此停下，不自动进入飞机测试。
