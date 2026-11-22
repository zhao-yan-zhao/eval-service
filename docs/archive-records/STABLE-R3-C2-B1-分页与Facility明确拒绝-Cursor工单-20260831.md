# STABLE-R3：C2 分页 + B1 Facility明确拒绝 Cursor工单

> 日期：2026-08-31  
> owner已拍板：A1+B1+C2。本单只施工C2、B1；两项必须独立commit。A1另走真机探针，禁止偷做。  
> 工作区：`D:\soft\F1-AI-integration`  
> 分支：`integration/stable-single-ai`  
> 冻结开工HEAD：`858e80668dacdc3f92b1d045f2c82f1542680e44`

## 一、开工门与红线

- HEAD、分支必须逐字一致；源码/测试必须干净，只允许既有runs/取证脏项。漂移即停工。
- 不改主demo、night-soak、V2.2，不push/tag，不做A1、B2、批6D、A1–A16。
- 具名add；禁`git add -A`/`git add .`。
- 永不提交`runs/`、`backup/`、`Command_Core/BinaryGridProvider.cs`、`Terrain.cs`。
- C2先做并独立commit、四门全绿后才做B1；任一红不得进入下一项。

## 二、C2：unit.status可靠下一页

### 冻结功能合同

1. 批量查询先按现有side过滤，再按`unit_id`使用Ordinal升序稳定排序。
2. 保留`max_items`现有范围1～200和旧调用兼容；新增可选字符串`cursor`。
3. 首页无cursor；下一页只返回`unit_id > cursor`的数据。
4. 每页返回`count`、`units`、`has_more`、`next_cursor`；有下一页时`next_cursor`为本页最后一个unit_id，无下一页时为空/null，禁止回传最后ID诱导继续调用。
5. cursor必须在当前side过滤后的集合中存在；不存在统一结构化错误码`pagination_cursor_invalid`。不另造“stale”业务规则。
6. 精确`unit_id`查询保持现有side语义，但忽略cursor和页大小的截断效果：只返回0或1条，`has_more=false`、`next_cursor=null`。
7. 不返回total_count，不把整个单位表物化到响应；允许内部排序快照。

### 允许范围

- `CMO-netcore-src/AiAssistant/Tools/ToolRegistry.cs`
- `CMO-netcore-src/AiAssistant.F1Core/CoreF1AutomationFacade.cs`
- `CMO-netcore-src/AiAssistant/F1Integration/InMemoryF1AutomationFacade.cs`
- 为把`pagination_cursor_invalid`从只读facade异常映射为同名工具错误，允许对`ToolInvocationService.cs`做窄catch；不得改D-04写身份、mutation预检、Intent/backup/sentinel顺序。
- 新增独立C2测试文件；必要时只改直接相关既有测试。

### 锁红与验收

至少覆盖：51条/50页；第二页无重复；输入乱序但输出unit_id升序；side过滤闭包；坏cursor专码；精确unit_id忽略cursor；InMemory/Core语义一致；旧无cursor调用兼容。

先在`858e806`用新测试锁红，再修。完成后具名add并提交：

`stable-r3-c2 WIP: add stable cursor pagination to unit status`

提交后必须：范围/diff逐字、`git diff --check`、C2具名、全量L1（不得低于886）、AllInOne Debug x64 Rebuild 0错。日志写`runs/stable-r3-c2-*`，不提交。

## 三、B1：稳定版暂不支持Facility，但明确拒绝

### 冻结用户行为

- 模型公开的`unit.add`类型只承诺Aircraft、Ship，不再把Facility展示成可用能力。
- 旧客户端/手工调用若仍传`unit_type=Facility`，必须得到结构化错误码`unit_add_facility_not_supported`和中文“稳定版暂不支持创建Facility”；不得退化成`schema_violation`、`unit_add_lua_no_guid`或成功。
- 拒绝必须发生在任何写Intent、备份、恢复哨兵和F1 Lua调用之前；MutationCount/场景/锁均不得发生写副作用。
- 不调用、不实现`ScenEdit_AddFacility`；B2仍待未来真机探针。
- Aircraft、Ship行为逐字不变。

### 允许实现边界

1. `ToolRegistry.cs`：公开schema enum移除Facility，描述明确稳定版仅Aircraft/Ship。
2. `ToolInvocationService.cs`：由于schema校验在facade之前，允许在“安全策略+工具存在检查之后、JSON Schema校验之前”加一个只针对`unit.add`且`unit_type`精确等于Facility的窄拒绝，走`RejectAndAudit`返回专码。非法JSON和其他非法类型仍走原安全/schema路径。
3. `LuaUnitAddTemplate.cs`与InMemory facade可做防御性同码拒绝，确保直接调用不绕过；不得新增Facility创建通道。
4. `UserFacingErrorCatalog`/生产提示词/`knowledge/lua-api-basics.md`可做必要同步，只写“稳定版暂不支持”，不得承诺B2时间。
5. 新增独立B1测试文件；不得和C2测试混用一个测试类掩盖范围。

### 锁红与验收

至少覆盖：公开schema不含Facility；完整ToolInvocationService调用返回专码而非schema_violation；拒绝前后无Intent/backup/sentinel/场景变化；直接Core/InMemory调用防御性拒绝；Aircraft/Ship回归；非法类型仍schema_violation。

在C2 commit之上先锁红再修，独立提交：

`stable-r3-b1 WIP: reject facility creation explicitly in stable release`

提交后必须再跑：范围/diff逐字、`git diff --check`、B1具名、C2具名回归、全量L1、AllInOne 0错。日志写`runs/stable-r3-b1-*`，不提交。

## 四、完事报告

1. 开工HEAD/status；C2、B1各自锁红证据。
2. 两个独立commit SHA、逐commit文件清单与必要性。
3. C2逐项对照：排序、cursor、has_more、专码、精确查询、Core/InMemory一致。
4. B1逐项对照：公开能力收窄、旧调用专码、零写副作用、Aircraft/Ship不变。
5. 每commit具名/L1/AllInOne命令、退出码、真实数量、日志。
6. 最终diff check、禁区、status原文；声明未add -A/reset/rebase/amend。
7. 单列未做：A1仍待真机探针；B2、批6D、A1–A16、tag/push、night-soak、V2.2未启动。

Cursor自报不算关门，回来由监理亲跑四门。
