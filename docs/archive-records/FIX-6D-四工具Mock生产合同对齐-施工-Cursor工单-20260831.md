# FIX-6D 四工具 Mock/生产合同对齐——Cursor 施工工单（2026-08-31）

> 可原样搬运给 Cursor。结论先行：本单不是新增四个工具；四工具生产功能已经存在。本单只把测试/演示使用的 InMemory 假 F1 改得与真实 F1 的“参数校验、写前预检、成功回执”一致，避免测试假绿。必须在一个 Cursor 中按 6D-1→6D-2→6D-3→6D-4 串行施工，因为四轮都会修改同一个 facade 文件；每轮独立 WIP commit，禁止四端并改。

## 一、冻结现场与开工门

- worktree：`D:\soft\F1-AI-integration`
- 分支：`integration/stable-single-ai`
- 冻结开工 HEAD：`c8427d8544c6e3f23ab34bcbd9f4f7dd351721c1`
- 设计预审报告：`D:\soft\F1-AI\FIX-6D-四工具Mock生产合同对齐-设计预审报告-20260831.md`
- 主工作区 `D:\soft\F1-AI` 只放工单/报告，源码施工不得在主工作区进行。

开工先执行并报告：

```powershell
git -C D:\soft\F1-AI-integration branch --show-current
git -C D:\soft\F1-AI-integration rev-parse HEAD
git -C D:\soft\F1-AI-integration status --short
```

必须同时满足：分支、HEAD 与上文一致；源码/测试干净，仅既有 `runs/` 脏项可存在。否则停工，原样报告，不准 reset、clean、stash、覆盖或删除既有内容。

## 二、已冻结裁决（不再自行选方案）

1. 采用预审的 **O1**：只在 InMemory 镜像生产校验、回执、Precheck；不触碰生产模板。
2. Schema 维持现状：`unit.add` 的 `dbid/unit_type`、`event` 的 trigger/actions、`doctrine` settings 仍由 Core/Mock 二次守门；`mission` schema 中虽有 support/ferry，Core/Mock 仍按生产只接受 patrol/strike。本单不得顺手改 schema、提示词或知识包。
3. InMemory 使用独立 sides 集合，`StringComparer.OrdinalIgnoreCase`，默认种入 `Blue`；不得从 `_units` 反推 sides，因为生产允许“阵营存在但当前无单位”。可在同一 facade 内加最小 test seam，但禁止修改 `InternalsVisibleTo.cs`。
4. Facility 保持 B1：`unit_type=Facility` 必须 `unit_add_facility_not_supported`，零 MutationCount、零 CallLog、零内存写；严禁实现 `ScenEdit_AddFacility` 或恢复 Facility 支持。
5. Course 本单只对齐输入校验并允许保存请求快照；不得把 Mock 接受 course 宣称为真机航线生效或真实读回。该成功规则标记 `待A1`。
6. Event 同名 upsert：Mock 仅保存“最新请求快照”用于证明模拟器内部覆盖；生产是否会累加旧 trigger/action 是待确认的生产嫌疑，本单不修、不替生产背书。
7. 不扩 `MutationNoHitErrorCodes`，不改恢复、Intent、backup、sentinel、审计链或任务循环。

## 三、唯一获准文件范围

四轮共同可改：

- `CMO-netcore-src/AiAssistant/F1Integration/InMemoryF1AutomationFacade.cs`

各轮各自只可新增对应测试文件：

- 6D-1：`tests/F1.AiAssistant.Tests/Fix6D_UnitAdd_MockProdAlignmentTests.cs`
- 6D-2：`tests/F1.AiAssistant.Tests/Fix6D_Mission_MockProdAlignmentTests.cs`
- 6D-3：`tests/F1.AiAssistant.Tests/Fix6D_Doctrine_MockProdAlignmentTests.cs`
- 6D-4：`tests/F1.AiAssistant.Tests/Fix6D_Event_MockProdAlignmentTests.cs`

禁止改动：

- `CoreF1AutomationFacade.cs`、`Lua*Template.cs`、`ToolRegistry.cs`、`ToolInvocationService.cs`
- `InternalsVisibleTo.cs`、`MutationNoHitErrorCodes.cs`
- 批4/批5恢复与审计区域、模型传输层、UI
- `Command_Core/BinaryGridProvider.cs`、`Terrain.cs`、`backup/`、`runs/`

发现必须改范围外文件才能实现时，立即停工，写“待确认：文件 + 必要性 + 不改的后果”，不得先改后报。

## 四、共同实现合同

### 4.1 同一条校验路径

每个工具在 InMemory 内只允许有一套实际校验逻辑，由对应执行方法和 `PrecheckWriteTool` 共同复用；禁止预检和执行复制成两套会漂移的规则。

- `PrecheckWriteTool` 校验成功返回 `null`。
- 校验失败返回与生产一致的稳定错误码字符串。
- Precheck 永远不得改变 `MutationCount`、`CallLog` 或任何 units/missions/doctrine/events 内存状态。
- 执行方法必须先完成全部写前校验，再改变状态；失败时同样零 MutationCount、零 CallLog、零状态变更。
- `CallLog` 与 `MutationCount` 只在合法执行路径增加一次。不得为了测试绿而提前记账再回滚。

禁止发明磁盘未存在的业务规则或错误码。例如生产未在这些模板中验证 DBID 真存在、patrol 参考点真存在，Mock 也不得擅自增加。

### 4.2 测试要求

- 必须走 facade 的行为调用/Precheck，不准只断言源码文本、常量或私有 helper 存在。
- 每轮至少一条旧 `c8427d8` 必红硬反例：先只加测试，在旧实现上运行并把完整红证据落 `runs/`；然后才改 facade。
- 每个拒绝测试同时断言：准确错误码、MutationCount 不变、CallLog 无该工具、相关内存状态不变。
- 每个工具还要覆盖合法成功回执字段，以及执行 Precheck 与直接执行的失败码一致。
- 不得删除、跳过、放宽或改名既有测试来换绿。

## 五、6D-1：unit.add

生产参照只读文件：

- `CMO-netcore-src/AiAssistant.F1Core/LuaUnitAddTemplate.cs`
- `CMO-netcore-src/AiAssistant.F1Core/LuaCourseTemplate.cs`
- `CMO-netcore-src/AiAssistant.F1Core/CoreF1AutomationFacade.cs`

必须逐字镜像其写前规则：

- side 必填、trim 后非空、须命中独立 sides 集合（不区分大小写）；错误 `unit_add_missing_side` / `side_not_found`。
- dbname 必填非空；`unit_add_missing_dbname`。
- lat/lon 非有限或越界，使用生产现有 `coord_*` 码。
- dbid 必填且为合法正整数；`unit_add_missing_dbid` / `unit_add_invalid_dbid`。
- unit_type 必填；只接受 Aircraft/Ship；Facility 专码；其它 `unit_add_invalid_unit_type`。
- Aircraft 必须合法 `loadout_id`；Ship 不强制；错误与生产完全同码。
- side/dbname/name 的 unsafe 字符规则与生产一致；name 缺省回退 dbname。
- course 的空数组、数量上限 64、点形状/坐标/unsafe 规则与生产一致；不新增真机生效保证。

成功回执形状必须与生产一致：

```text
created: { unit_id, name, side, dbname, unit_type, dbid, lat, lon }
```

`loadout_id/course` 不得塞进公开成功回执。Mock 可保存必要请求状态供测试，但不得称为 F1 真实读回。

锁红主测试必须命名：

`InMemory_UnitAdd_Aircraft_without_loadout_rejects_before_mutation`

旧版应假成功；修后必须报 `unit_add_missing_loadout_id`，零写。另锁合法 Ship 回执含 `unit_type`、`dbid`；锁 Facility B1 不回归。

完成后具名 add 两文件并提交：

```text
fix-6d-1 WIP: align in-memory unit add contract
```

## 六、6D-2：mission.create_or_update

生产参照：`LuaMissionTemplate.cs` + `CoreF1AutomationFacade.cs`。

镜像合同：

- side、mission_name、mission_type 必填，side 须存在。
- 只接受规范化 `patrol` / `strike`；support/ferry 仍按生产返回 `mission_invalid_type`。
- patrol 必须有 `area_ref_points` 或由 `area_label` 形成的单点区域；缺少报 `mission_patrol_missing_area`。
- 数组元素须为非空字符串；unit_ids 中每个 unit_id 必须在 `_units` 中，生产同码 `unit_not_found`。
- unsafe 字符规则、错误码必须逐字来自生产；不得增加“参考点必须在想定中存在”等生产未做规则。
- 维护按 `side + mission_name` 的内存 upsert 状态；同键二次调用保持同一稳定模拟 mission_id 并保存最新请求，但不声称已真实清除旧单位分配。

成功回执：

```text
{ mission_name, mission_type, side, mission_id, status="upserted",
  units_assigned=<请求unit_ids数量>, area_points=<请求区域点数量> }
```

后两项只是请求计数回显，不得包装成真实 F1 读回。

锁红主测试：

`InMemory_Mission_patrol_missing_area_rejects_before_mutation`

修后报 `mission_patrol_missing_area` 且零写；合法 strike 回执字段完整；support/ferry 拒绝；同名 upsert 的稳定 ID/最新快照有行为证据。

提交：

```text
fix-6d-2 WIP: align in-memory mission contract
```

## 七、6D-3：doctrine.set

生产参照：`LuaDoctrineTemplate.cs` + `CoreF1AutomationFacade.cs`。

镜像合同：

- scope 可按生产规则从 scope/side/legacy target 推断，只接受 side/unit。
- side 必须存在；unit scope 必须有 unit_id 或 unit_name；若给 unit_id，必须命中 `_units`。
- 至少有 emcon_radar 或 weapons_control；legacy key/value 只按生产既有两类映射。
- enum 与错误码逐字对齐生产：`doctrine_missing_scope`、`doctrine_invalid_scope`、`doctrine_missing_side`、`side_not_found`、`doctrine_unit_target_missing`、`unit_not_found`、`doctrine_no_settings`、`doctrine_invalid_emcon_radar`、`doctrine_invalid_weapons_control`。
- 可保存内存快照供覆盖断言，但对外不得宣称已从 F1 读回条令。

成功回执：

```text
{ status="ok", scope, side, emcon_radar=<请求或空串>, weapons_control=<请求或空串> }
```

锁红主测试：

`InMemory_Doctrine_no_settings_rejects_before_mutation`

输入 `{"scope":"side","side":"Blue"}`；修后 `doctrine_no_settings`、零写。另锁合法回执完整和 unit_not_found。

提交：

```text
fix-6d-3 WIP: align in-memory doctrine contract
```

## 八、6D-4：event.upsert

生产参照：`LuaEventTemplate.cs` + `CoreF1AutomationFacade.cs`。

镜像合同：

- event_name、enabled、trigger_type、trigger_minutes、非空 actions 全部按生产必填与类型规则校验。
- trigger_type 只接受 `time`；minutes 规则与生产一致。
- action 必须是对象，type 只接受 `send_message`、`set_doctrine`、`activate_mission`；各 action 必填字段和 `set_doctrine` 子校验必须逐字镜像模板。
- 保留生产现有 `event_*` / `event_action_*` / `event_doctrine_*` 错误码，不发明新码。
- Mock 按 event_name 保存最新请求快照；这只是模拟器 upsert 意图，不代表真实 F1 已解决 trigger/action 可能累加问题。

成功回执：

```text
{ event_name, enabled, trigger_type, trigger_minutes,
  actions_count=<请求actions数量>, status="upserted" }
```

锁红主测试：

`InMemory_Event_non_whitelisted_action_rejects_before_mutation`

`actions:[{"type":"run_shell"}]` 修后报 `event_action_not_whitelisted`、零写。另锁合法回执字段与同名二次 upsert 的最新内存快照；不得把此测试写成生产“不会累加”的保证。

提交：

```text
fix-6d-4 WIP: align in-memory event contract
```

## 九、每轮必过四门

每个 WIP commit 后都要单独执行并保存日志，不得四轮做完才一次性补测：

1. 范围门：`git show --name-status --stat HEAD`、对上一 HEAD 的禁区扫描、`git diff --check HEAD^..HEAD`。
2. diff 合同门：逐字对照对应 `Lua*Template` 与 Core 回执；报告必须列出 grep 到的生产码/字段，不得凭记忆。
3. 全量 L1：

```powershell
dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore
```

4. AllInOne Debug x64（必须 csproj，不认 sln）：

```powershell
dotnet build CMO-netcore-src\F1-AllInOne.csproj -c Debug -p:Platform=x64 -t:Rebuild --no-restore
```

每轮同时跑本轮具名测试；最终再跑：

```powershell
dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore --filter "FullyQualifiedName~Fix6D|FullyQualifiedName~StableR3_B1|FullyQualifiedName~Demo1_UnitAdd|FullyQualifiedName~Demo1C_Commit"
```

若 `--no-restore` 因本机 NuGet path1 怪癖失败，可先对同一 csproj restore 一次再重跑；必须把首次失败与恢复步骤如实写入报告。构建瞬态 copy 错误不能用增量绿冒充，须按上述 `-t:Rebuild` 重新成功。

## 十、提交纪律与停工条件

- 每轮只用 `git add <具名 facade> <本轮具名测试>`；严禁 `git add -A` / `git add .`。
- 禁止 amend、rebase、reset 覆盖历史；必须形成四个独立 WIP commit。
- 永不提交 `runs/`、`backup/`、`BinaryGridProvider.cs`、`Terrain.cs`。
- 任一锁红在旧码不红、范围外文件确有必要、生产代码疑似 bug、业务规则没有磁盘证据、L1/AllInOne 变红时，停在当前轮报告，不得用降级/放宽测试换绿，不得继续下一轮。
- 不 push、不 tag、不合 night-soak、不碰 `D:\soft\F1-AI-v22`，不启动 A1–A16。

## 十一、完事报告格式

1. 开工 HEAD、四个 commit SHA、最终 HEAD、历史链。
2. 每 commit 的具名文件与 stat；最终 status（把既有 runs 与新增源码/测试分开）。
3. 四轮锁红：测试名、在对应旧 HEAD 的失败点、日志路径；未找到必须写“未找到”，不得补叙。
4. 四工具逐项对照：输入校验、Precheck、失败零写、成功回执、内存状态语义。
5. 每轮具名测试、全量 L1、AllInOne csproj Rebuild、diff check 的退出码/数量/日志。
6. 明确声明：Facility 仍拒绝；course 成功语义待 A1；schema 未改；event 生产累加嫌疑未修；MutationNoHit 未扩。
7. 明确声明具名 add、未提交禁区、未 amend/rebase/reset/push/tag。

Cursor 自报完成不代表关门；报告回来后由监理亲跑范围、逐字 diff、全量 L1、AllInOne 四门。
