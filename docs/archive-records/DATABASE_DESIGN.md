# AI 助手本地 SQLite 数据库设计

## 迁移与兼容策略
- 数据库位置：`F1/AiAssistant/data/assistant.db`；场景备份为文件，置于 `F1/AiAssistant/backups/`，不使用 SQLite Blob。
- AI 助手使用独立 SQLite 连接与 `PRAGMA foreign_keys=ON`，不得复用场景的 `Scenario.DBConnection`（源码依据见 `SOURCE_ANALYSIS.md` E06）。
- 启动流程：创建目录 → 打开数据库 → 事务内创建/读取 `schema_version` → 按版本顺序执行未应用 migration → 写入 migration 名称、校验值与时间 → 提交。
- migration 仅追加且编号固定，如 `001_initial`、`002_add_provider_profile`；已发布 migration 不得改写。checksum 不一致时阻断 AI 模块启动并提示恢复，不尝试自动修复。
- 单条 migration 失败必须回滚事务、保留数据库原状，复制 `assistant.db.failed-时间戳` 供诊断；AI 功能禁用，F1 原有功能不受影响。

## 表、字段与索引
| 表 | 字段 | 主键、约束与索引 |
|---|---|---|
| `schema_version` | `version INTEGER`、`name TEXT`、`checksum TEXT`、`applied_at_utc TEXT` | `PRIMARY KEY(version)`、`UNIQUE(name)`；仅追加。 |
| `ai_settings` | `setting_key TEXT`、`value_json TEXT`、`updated_at_utc TEXT` | `PRIMARY KEY(setting_key)`；密钥只存 DPAPI 密文或密钥引用。 |
| `ai_sessions` | `session_id TEXT`、`title TEXT`、`summary TEXT NULL`、`created_at_utc TEXT`、`updated_at_utc TEXT`、`deleted_at_utc TEXT NULL` | GUID 字符串主键；`IX_sessions_active_updated(deleted_at_utc, updated_at_utc DESC)`；软删。 |
| `ai_messages` | `message_id TEXT`、`session_id TEXT`、`sequence_no INTEGER`、`role INTEGER`、`content TEXT`、`is_summary INTEGER`、`created_at_utc TEXT`、`deleted_at_utc TEXT NULL` | `PK(message_id)`；`FK(session_id)`；`UNIQUE(session_id, sequence_no)`；索引 `(session_id, sequence_no)`。 |
| `ai_tasks` | `task_id TEXT`、`session_id TEXT`、`scene_path TEXT`、`scene_fingerprint TEXT`、`state INTEGER`、`round_no INTEGER`、`started_at_utc TEXT`、`updated_at_utc TEXT`、`ended_at_utc TEXT NULL`、`baseline_backup_id TEXT NULL`、`result_summary TEXT NULL`、`error_code TEXT NULL`、`row_version INTEGER` | `PK(task_id)`；`FK(session_id)`；索引 `(session_id, started_at_utc DESC)`；`row_version` 乐观锁；`baseline_backup_id` 不强制数据库 FK，由应用层校验引用有效性。 |
| `ai_task_steps` | `step_id TEXT`、`task_id TEXT`、`sequence_no INTEGER`、`kind INTEGER`、`status INTEGER`、`diagnostic_id TEXT NULL`、`tool_name TEXT NULL`、`request_summary TEXT`、`response_summary TEXT`、`retry_no INTEGER`、`started_at_utc TEXT`、`ended_at_utc TEXT NULL`、`prev_hash TEXT NULL`、`entry_hash TEXT` | `PK(step_id)`；`FK(task_id)`；`UNIQUE(task_id, sequence_no)`；索引 `(task_id, sequence_no)`；hash 链防篡改审计。 |
| `ai_backups` | `backup_id TEXT`、`task_id TEXT`、`step_id TEXT NULL`、`source_path TEXT`、`backup_path TEXT`、`file_hash TEXT`、`file_size_bytes INTEGER`、`kind INTEGER`、`created_at_utc TEXT`、`deleted_at_utc TEXT NULL` | `PK(backup_id)`；`UNIQUE(backup_path)`；索引 `(task_id, created_at_utc)`、`(deleted_at_utc, created_at_utc)`；`step_id NULL` 表示任务基线。 |
| `ai_provider_profiles` | `profile_id TEXT`、`name TEXT`、`provider_type INTEGER`、`base_url TEXT`、`model TEXT`、`secret_ref TEXT NULL`、`external_notice_ack_at_utc TEXT NULL`、`deleted_at_utc TEXT NULL` | `PK(profile_id)`、`UNIQUE(name)`；禁止记录 API key 明文。 |

## 一致性规则
- `state` 枚举：`Queued=0, Planning=1, Locked=2, ExecutingTool=3, WaitingSimulation=4, Paused=5, Completing=6, Completed=7, Failed=8, Cancelled=9, TimedOut=10`。
- 任务状态更新使用 `WHERE task_id=? AND row_version=?` 并递增版本；冲突后重新读取，禁止盲覆盖。
- `baseline_backup_id` 不强制数据库外键，由应用层在设置、读取、回滚和清理时校验其引用的备份存在且属于当前任务。
- 可变场景操作：先完成文件备份并落盘，校验 hash 后再进入 DB 事务记录 `ai_backups` 和对应的 `ai_task_steps`；若 DB 写入失败，已落盘文件作为 orphan backup 保留，应用启动时通过 orphan backup 扫描补偿元数据或按策略隔离处理。
- `entry_hash = SHA-256(规范化步骤字段 + prev_hash)`；每个任务从 sequence 1 重建校验链。
- 清理仅删除不被运行任务引用、且超过“50个 / 30天 / 5GB”任一阈值的最旧备份；先软删元数据再删除文件，删除失败可重试。会话与审计日志不自动清理。