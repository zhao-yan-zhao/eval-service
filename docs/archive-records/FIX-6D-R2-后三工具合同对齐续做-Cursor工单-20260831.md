# FIX-6D-R2 后三工具 Mock/生产合同对齐续做——Cursor 工单（2026-08-31）

> 可原样搬运给原 6D Cursor。6D-1 `unit.add` 已关门；插入的批5启动验链竞态也已由独立提交修复并经监理四门关门。现在只做 6D-2 mission、6D-3 doctrine、6D-4 event，仍在一个 Cursor 中串行，每项独立 WIP commit；禁止并行改同一个 facade。

## 一、开工门

- worktree：`D:\soft\F1-AI-integration`
- 分支：`integration/stable-single-ai`
- 必须开工 HEAD：`e1303b2147567b348845943b950a4ea58d9611c5`
- 必须保留历史：
  - `05b283b` 6D-1 unit.add Mock 合同对齐
  - `a0ceaad` 双回合 unit.add 测试夹具同步
  - `e1303b2` 启动验链一致性读快照
- 源码/测试必须干净，仅既有 `runs/` 脏项可存在。

开工不符立即停工；禁止 reset、clean、stash、amend、rebase。

## 二、冻结边界

本单不是新增真实 F1 功能，只把 InMemory 测试替身对齐已经存在的生产合同。

三轮共同可改：

- `CMO-netcore-src/AiAssistant/F1Integration/InMemoryF1AutomationFacade.cs`

各轮只可新增对应测试：

- 6D-2：`tests/F1.AiAssistant.Tests/Fix6D_Mission_MockProdAlignmentTests.cs`
- 6D-3：`tests/F1.AiAssistant.Tests/Fix6D_Doctrine_MockProdAlignmentTests.cs`
- 6D-4：`tests/F1.AiAssistant.Tests/Fix6D_Event_MockProdAlignmentTests.cs`

禁止修改：生产 `CoreF1AutomationFacade.cs`、全部 `Lua*Template.cs`、`ToolRegistry.cs`、`ToolInvocationService.cs`、`InternalsVisibleTo.cs`、`MutationNoHitErrorCodes.cs`；刚关门的 `AiAssistantStore.AuditChain.cs`/Fix5测试；6D-1测试；恢复/审计/模型/UI；`runs/`、`backup/`、`BinaryGridProvider.cs`、`Terrain.cs`。

Schema 过宽维持既定 A2/B2/C2：本单不收紧公开 schema，Mock 在 schema 之后继续按 Core 的真实规则拒绝。发现必须越界时停工列“文件+必要性+不改后果”，不得先改。

## 三、三轮共同合同

1. 每个工具在 InMemory 内只有一套实际校验逻辑，执行方法和 `PrecheckWriteTool` 共用；禁止两套复制规则。
2. Precheck 成功返回 null；失败返回生产现有稳定错误码。
3. Precheck 不得改变 MutationCount、CallLog 或任何内存状态。
4. 执行必须先完成全部校验，再记 CallLog、MutationCount 和状态；失败零写。
5. 只镜像生产已经存在的规则；无磁盘证据的业务规则标“待确认”，不得发明。
6. 成功回执字段与生产同形，但请求计数回显不得包装成真实 F1 读回。
7. 每轮先只加锁红测试，在上一 HEAD 上得到确定性红，再改 facade；每轮独立 commit、具名 add、全量 L1、AllInOne。

独立 sides 集合与 6D-1 已建立，继续按 `OrdinalIgnoreCase` 使用；默认 Blue。不得改回从 units 反推 side。

## 四、6D-2 mission.create_or_update

只读生产依据：

- `CMO-netcore-src/AiAssistant.F1Core/LuaMissionTemplate.cs`
- `CMO-netcore-src/AiAssistant.F1Core/CoreF1AutomationFacade.cs`

必须镜像：

- side、mission_name、mission_type 必填；side 须存在。
- mission_type 规范化后只接受 `patrol` / `strike`；schema 虽仍列 support/ferry，Mock 必须与 Core 一样报 `mission_invalid_type`。
- patrol 必须有 `area_ref_points`，或由 `area_label` 形成单点区域；否则 `mission_patrol_missing_area`。
- area_ref_points/unit_ids 的数组元素必须是非空字符串；unit_ids 每个 ID 必须在 `_units` 中，否则 `unit_not_found`。
- mission_name/区域点 unsafe 字符规则与生产逐字一致；生产不验证参考点真实存在，Mock 不得增加 `reference_point_not_found`。
- 维护按 `side + mission_name` 的内存 upsert；同键二次调用保持同一稳定模拟 mission_id 并保存最新请求。不得声称清除了真实 F1 旧单位分配。

成功回执：

```text
{ mission_name, mission_type, side, mission_id, status="upserted",
  units_assigned=<请求unit_ids数量>, area_points=<请求区域点数量> }
```

`units_assigned/area_points` 是请求计数，不是真实读回。

锁红主测试名：

`InMemory_Mission_patrol_missing_area_rejects_before_mutation`

还必须锁：合法 strike 回执全字段；support/ferry 拒绝；不存在 unit_id；Precheck与执行同码零写；同名 upsert 的稳定 ID/最新快照。必要的最小 internal 只读测试 seam 只能加在 facade，禁止改可见性文件。

独立 commit：

```text
fix-6d-2 WIP: align in-memory mission contract
```

6D-2 四门全绿才准进入6D-3。

## 五、6D-3 doctrine.set

只读生产依据：`LuaDoctrineTemplate.cs` + `CoreF1AutomationFacade.cs`。

必须镜像：

- scope 按生产从 scope/side/legacy target 推断，只接受 side/unit。
- side 必须存在；unit scope 必须有 unit_id 或 unit_name；给 unit_id 时须命中 `_units`。
- 至少有 emcon_radar 或 weapons_control；legacy key/value 仅按生产现有两类映射。
- 稳定码逐字对齐：`doctrine_missing_scope`、`doctrine_invalid_scope`、`doctrine_missing_side`、`side_not_found`、`doctrine_unit_target_missing`、`unit_not_found`、`doctrine_no_settings`、`doctrine_invalid_emcon_radar`、`doctrine_invalid_weapons_control`。
- 可维护最新内存快照供测试，但对外不得宣称已从 F1 读回条令。

成功回执：

```text
{ status="ok", scope, side,
  emcon_radar=<请求值或空串>, weapons_control=<请求值或空串> }
```

锁红主测试：

`InMemory_Doctrine_no_settings_rejects_before_mutation`

输入 `{"scope":"side","side":"Blue"}`；必须 `doctrine_no_settings` 且零写。另锁合法回执、unit_not_found、Precheck同码零写、内存最新快照。

独立 commit：

```text
fix-6d-3 WIP: align in-memory doctrine contract
```

6D-3 四门全绿才准进入6D-4。

## 六、6D-4 event.upsert

只读生产依据：`LuaEventTemplate.cs` + `CoreF1AutomationFacade.cs`。

必须镜像：

- event_name、enabled、trigger_type、trigger_minutes、非空 actions 按生产必填/类型规则校验。
- trigger_type 只接受 `time`；分钟规则与生产一致。
- action 必须为对象；type 只允许 `send_message`、`set_doctrine`、`activate_mission`；各类型必填字段和 set_doctrine 子校验逐字镜像生产。
- 只使用磁盘已有 `event_*`、`event_action_*`、`event_doctrine_*` 错误码。
- 按 event_name 保存最新请求快照。这只表示 Mock 的 upsert 意图；真实生产同名事件是否累加旧 trigger/action 仍是待确认嫌疑，本单不得修、不得声称解决。

成功回执：

```text
{ event_name, enabled, trigger_type, trigger_minutes,
  actions_count=<请求actions数量>, status="upserted" }
```

锁红主测试：

`InMemory_Event_non_whitelisted_action_rejects_before_mutation`

`actions:[{"type":"run_shell"}]` 必须 `event_action_not_whitelisted` 且零写。另锁合法回执、Precheck同码零写、同名二次调用的最新 Mock 快照；禁止把它写成生产不累加保证。

独立 commit：

```text
fix-6d-4 WIP: align in-memory event contract
```

## 七、每轮四门

每个 commit 后分别执行：

1. `git show --name-status --stat HEAD`、相对上一 HEAD 的禁区扫描、`git diff --check HEAD^..HEAD`。
2. 逐字 grep 对应生产模板的输入、错误码、成功回执，报告中列实际落点。
3. 本轮 Fix6D 具名 + 所有此前 Fix6D 回归，然后全量：

```powershell
dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore --filter "FullyQualifiedName~Fix6D"
dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore
```

4. AllInOne 必须 csproj：

```powershell
dotnet build CMO-netcore-src\F1-AllInOne.csproj -c Debug -p:Platform=x64 -t:Rebuild --no-restore
```

任一全量红、构建红、锁红不成立或范围外需求，立即停在当轮，不得继续下一轮。审计并发红若再出现也不得按flake放过：精确复跑取证并停工报告。

## 八、提交纪律与完事报告

- 每轮只 `git add` facade + 本轮具名新测试；禁 `git add -A/.`。
- 禁 amend/rebase/reset/push/tag；不提交 runs/backup/禁区。
- 不碰主demo、night-soak、V2.2，不启动 A1–A16。
- 最终报告列开工/每轮/收工 SHA；每轮锁红；逐工具合同；每轮具名、全量L1、AllInOne、diff/status；明确 schema 未改、Facility仍拒绝、course仍待A1、event生产累加嫌疑未修。

Cursor 自报不算关门；最终由监理亲跑四门。
