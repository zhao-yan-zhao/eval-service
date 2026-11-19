# FINAL-RUNTIME-R2：旧终态运行记录兼容返修——Cursor 完整工单

> 本工单可原样执行。结论先行：修代码，不删用户数据库。只允许安全跳过“明确属于 schema=1、任务已经结束、无待恢复标记、任务编号一致”的旧运行记录；任何可疑记录仍必须 fail-closed。

## 一、开工基线与用户可见目标

- 工作区：`D:\soft\F1-AI-integration`
- 分支必须为：`integration/stable-single-ai`
- 开工 HEAD 必须为：`a0e56757d2ff7da8cda2addbce02c4cb3f4e8643`
- 允许的既有脏项：仅 `runs/` 证据；若源码或测试文件另有脏项，立即停工报告。
- 诊断报告：`D:\soft\F1-AI\FINAL-RUNTIME-R1-任务控制未接入只读诊断报告-20260902.md`
- 当前 F1 已退出。不得自行启动 F1。

用户可见目标：修复 AI 面板显示“任务控制尚未接入运行时 / 所有任务按钮已禁用”。修后，8 月 18 日留下的四条已结束任务旧记录不能再拖死整个 AI 后台；但真正未收尾、格式未知或数据矛盾的记录仍要阻止 AI 启动，不能为了亮按钮而降级安全保护。

## 二、已经核实的根因（不得重新猜测）

磁盘逐字现状：

1. `TaskRuntimeState.CurrentSchema = 2`。
2. `TaskRuntimeState.FromJson` 对任意非 2 版本抛 `runtime_schema_unsupported:{n}`；这条通用 fail-closed 不得放宽。
3. `TaskOrchestrator.SweepResidualRecoveryBlocksUnlocked` 当前先调用 `TaskRuntimeState.FromJson(kv.Value)`，之后才判断 `RecoveryBlock` 是否为空、任务是否终态。
4. 实际 WritableRoot 数据库 `D:\soft\F1\F1-测试\data\assistant.db` 有四条 schema=1 的 `task_runtime:*`；对应 `ai_tasks` 全为终态（state 7/8），`recovery_block` 均为 JSON `null`。
5. 启动因此抛 `runtime_schema_unsupported:1`，`CreateProductionRuntime` 返回 `enabled=false / recover_on_startup_failed`，面板绑定 `NullTaskControlBridge`。
6. 同库另有一条当前 schema=2、终态且 `recovery_block=sim_stop_unconfirmed` 的残留；修复后原有扫描仍应继续清理它，不能因为跳过旧记录而提前结束循环。

根因是“恢复扫描的判断顺序错误”，不是 DeepSeek、DB3K_505/515 或 owner 操作问题。

## 三、冻结修复合同

### 3.1 允许跳过的记录必须同时满足全部条件

仅在残留恢复扫描中，对单条 `task_runtime:*` 原始 JSON 做最小分类。必须同时满足：

1. setting key 严格为 `task_runtime:{taskId}`，且 `{taskId}` 非空；
2. JSON 是合法对象；
3. `schema` 字段存在、为整数且逐字值为 `1`；
4. `task_id` 字段存在、为非空字符串，并与 setting key 中的 taskId 使用 `Ordinal` 严格一致；
5. `recovery_block` 字段明确存在且 JSON 类型为 `null`；缺字段、空字符串或任何非 null 值都不算安全；
6. `_store.GetTask(taskId)` 确实存在；
7. 对应任务状态由 `TaskStateTransitions.IsTerminal(...)` 判定为终态。

全部成立时：

- 只跳过这条旧记录，不调用 `TaskRuntimeState.FromJson`；
- 不删除、不重写、不升级该 JSON，原值必须 byte-for-byte/字符串逐字不变；
- 不改变任务、锁、审计链、恢复哨兵或场景；
- 可在 `RecoverOnStartupResult.Outcomes` 留一条只读可诊断结果，建议 Action=`skip_legacy_terminal_runtime_v1`，但不得增加 `ActionCount`（因为没有实际恢复动作）。若采用不同名字，报告中说明。

### 3.2 以下情况必须继续 fail-closed

- schema=1 对应非终态任务；
- schema=1 的 `recovery_block` 缺失或非 null；
- key 与 JSON 内 task_id 不一致；
- 对应任务不存在；
- malformed JSON、根不是对象、字段类型错误；
- schema=0、schema>2 或其他未知版本，即使任务已经结束且 recovery_block 为 null；
- 当前 schema=2 的解析错误。

上述情况必须让启动恢复失败，不得单条吞异常后继续启用 runtime。错误码须保持可诊断，至少包含原来的 `runtime_schema_unsupported` 或明确的新 fail-closed 码。

### 3.3 当前 schema=2 行为不得改变

- 当前 schema=2 + 终态 + 残留 RecoveryBlock：仍按既有合同清除；
- 当前 schema=2 + 无 RecoveryBlock：不写库；
- 非终态任务的既有 `RecoverOneUnlocked` 语义不变；
- `TaskRuntimeState.FromJson` 的通用严格版本检查原样保留；
- `AiAssistantCompositionRoot` 的“恢复异常则禁用 runtime”原样保留。

## 四、获准文件范围

只准具名修改/新增：

1. `CMO-netcore-src/AiAssistant/Application/TaskOrchestrator/TaskOrchestrator.cs`
2. `tests/F1.AiAssistant.Tests/FinalRuntimeR2_LegacyTerminalRuntimeTests.cs`（新文件）

如果确实无法在这两个文件内完成，停工说明原因，禁止自行扩围。

严禁修改：

- `TaskRuntimeState.cs`（尤其不得放宽 `FromJson`）
- `AiAssistantCompositionRoot.cs`
- `AiAssistantStore*.cs`、`AuditHashChain.cs`、`MigrationCatalog.cs`
- UI、模型配置、DB3K、想定、WritableRoot、`Command.ini`
- `D:\soft\F1\F1-测试\data\assistant.db` 及其 `-wal`/`-shm`/备份
- `BinaryGridProvider.cs`、`Terrain.cs`、`backup/`、`runs/`

不得运行任何会打开或写入生产 `assistant.db` 的脚本；不得删 0 字节 wal 或 shm；不得启动 F1 做真机试验。本轮只修代码和隔离测试。

## 五、锁红与测试要求

先只新增测试，不改生产代码；在开工 HEAD 上取得确定性锁红日志。测试数据全部在测试临时目录生成，禁止复制或打开生产库。

至少覆盖：

1. **R2-A 主反例**：终态任务 + schema=1 + key/task_id 一致 + `recovery_block:null`。旧代码必须因 `runtime_schema_unsupported:1` 红；修后 `RecoverOnStartup()` 正常返回，旧 JSON 逐字不变。
2. **R2-B 不得截断扫描**：先放一条可跳过的 schema=1 旧终态记录，再放一条 schema=2 终态残留 block。修后前者原样保留、后者 block 被既有逻辑清除。
3. **R2-C 真风险不放过**：schema=1 非终态任务，必须 fail-closed。
4. **R2-D 真风险不放过**：schema=1 终态但 `recovery_block` 非 null，必须 fail-closed且原值不变。
5. **R2-E 未知未来版本**：schema=3 终态且无 block，也必须 fail-closed。
6. **R2-F 身份错误**：setting key 与 JSON task_id 不一致，必须 fail-closed。
7. **R2-G 数据损坏**：malformed JSON 或必需字段缺失，必须 fail-closed。
8. 原有 `T07_7_RecoverOnStartupTests.B1_terminal_leftover_block_converges_on_next_Recover_no_new_crash_audit` 保持通过。

不得把“直接删测试记录”写成修后行为；不得只测辅助函数而绕开 `RecoverOnStartup()` 真实入口。

## 六、实现约束

- 建议在 `TaskOrchestrator` 内用 `JsonDocument` 做只读、窄口径分类；不要反序列化成 schema=2 对象，不要补默认值伪装迁移。
- 仅对上面 3.1 的 schema=1 历史终态空 block 走跳过分支；其余继续进入既有严格解析并自然 fail-closed，或显式抛出等价的严格错误。
- 不允许 `catch { continue; }`、按异常消息模糊匹配后吞掉、遇到任意旧版本都跳过、遇到任意终态都跳过。
- 遍历顺序不得成为正确性前提。
- 不新增数据库迁移，不改 schema_version，不清理历史数据。

## 七、提交纪律

- 单独 WIP commit，建议消息：`final-runtime-r2 WIP: ignore inert legacy terminal runtime records`
- 只用两个获准路径做具名 `git add`。
- 禁止 `git add -A`、`git add .`、amend、reset、rebase、push、tag、stash、clean。
- `runs/` 日志不提交。

## 八、验收门（Cursor 自跑不算监理关门）

1. 范围：`git diff --check a0e5675..HEAD`，并报告 `git diff --name-status a0e5675..HEAD`。
2. 具名测试：新 `FinalRuntimeR2` 全组 + 原 T07.7 恢复组。
3. 全量 L1：

   `dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore`

4. AllInOne（必须 csproj，不准拿 sln 冒充）：

   `dotnet build CMO-netcore-src\F1-AllInOne.csproj -c Debug -p:Platform=x64 -t:Rebuild --no-restore`

全量 L1 必须 0 红，AllInOne 必须 0 错。任何红项先停工分类，不得靠反复重跑碰绿。

## 九、完事报告必须包含

- 开工/收工 SHA、独立 commit；
- 两个改动文件的 stat；
- 锁红测试名、旧码实际错误和日志；
- 逐项说明 3.1 七个条件如何落实；
- R2-A 至 R2-G、T07.7、全量 L1、AllInOne、diff check 的退出码和日志路径；
- 明确证明：旧 schema=1 JSON 未被改写；schema=2 残留 block 仍能清理；未知/危险记录仍 fail-closed；
- 最终 `git status --short`；
- 声明未触碰生产 assistant.db/wal/shm、未启动 F1、未 push/tag。

报告落盘：

`D:\soft\F1-AI\FINAL-RUNTIME-R2-旧终态运行记录兼容返修报告-20260902.md`

证据目录：

`D:\soft\F1-AI-integration\runs\final-runtime-r2-20260902\`

完成后停下，等待监理亲跑四门。未经监理关门，不得灌装候选运行包，也不得进入 A1 飞机航线或 A1–A16 真机终验。
