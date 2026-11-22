# FIX-6D：四工具 Mock / 生产合同对齐——只读设计预审 Cursor 工单

> 日期：2026-08-31  
> 目的：在演示能力已合回稳定候选后，重新逐字比较四个写工具的真实生产合同与 InMemory/Mock 行为，产出可施工合同。  
> 本单**只读、不改代码、不提交**；报告回来后由监理冻结合同并另发施工单。

## 一、开工门

- 工作区：`D:\soft\F1-AI-integration`
- 分支：`integration/stable-single-ai`
- 冻结HEAD：`c8427d8544c6e3f23ab34bcbd9f4f7dd351721c1`
- 必须先原样报告：`git branch --show-current`、`git rev-parse HEAD`、`git status --short`。
- HEAD/分支不符，或源码/测试存在未提交修改，立即停工；只允许既有`runs/`取证脏项。
- 禁止改主demo、night-soak、F1-AI-v22；禁止reset/rebase/clean/checkout覆盖；本单不push/tag。

## 二、为什么现在做

批6A曾冻结D-12差异清单，但当时生产侧四个工具的真实实现还只在demo分支；现在它们已经合入integration，旧的“生产未实现”判断失效。必须以当前最终磁盘为准重新审：

1. `unit.add`
2. `mission.create_or_update`
3. `doctrine.set`
4. `event.upsert`

当前已知接缝（仅作定位，不得直接当结论）：生产实现位于`AiAssistant.F1Core/CoreF1AutomationFacade.cs`与四个`Lua*Template.cs`；模拟实现位于`AiAssistant/F1Integration/InMemoryF1AutomationFacade.cs`。当前模拟侧后三项主要只加CallLog/MutationCount并返回简化`status`，疑似未复制生产校验、失败码和完整回执；必须逐字核实。

## 三、逐工具审查矩阵（四项都必须填满）

对每个工具分别给出“生产现状 / InMemory现状 / 差异 / 推荐对齐 / 待确认”，至少覆盖：

1. **输入与默认值**：schema字段、required、enum、大小写、默认值、长度/数量上限。
2. **生产预检**：side/unit/reference point是否存在，DBID/loadout/type，scope，trigger/action白名单等；先grep实际抛错点再引用。
3. **执行副作用**：创建或更新什么对象；失败发生在变更前还是变更后；是否可能部分成功。
4. **成功回执**：逐字段列出生产返回值，并判断是真读回、请求回显还是计算值。
5. **失败合同**：逐个错误码、触发条件、是否属于“明确无变更”；找不到稳定码就写“未找到”，不得自造。
6. **模拟差异**：InMemory当前是否错误地一律成功、漏校验、回执缺字段、MutationCount/CallLog时机错误、状态未真正保存，或与生产幂等语义不一致。
7. **对齐方式**：优先复用生产侧纯解析/校验合同；若跨程序集复用会扩大可见性，列明范围和利弊，不得先改`InternalsVisibleTo`。
8. **硬反例**：至少一条旧模拟必红、修后应绿的行为反例；禁止只断言常量或源码文本。

## 四、四工具特别红线

### 4.1 unit.add

- 必须保留已关门B1：`Facility`明确返回`unit_add_facility_not_supported`且零写；不得恢复Facility支持或调用`ScenEdit_AddFacility`。
- Aircraft course的真实生效/读回仍依赖A1真机探针。本预审只把该差异标`待A1`，不得替A1制定成功规则，不得写生产代码。
- 核对生产对Aircraft的`loadout_id`、DBID、side、读回guid/经纬度合同；核对模拟是否保存`unit_type/dbid/loadout/course`及成功回执字段。

### 4.2 mission.create_or_update

- 逐字核对任务类型、阵营、区域点、单位分配、同名upsert语义和Lua失败码。
- 特别区分“请求数量回显”与“F1真实分配结果”；无真实读回就明确记录，不得把请求数升级成保证。

### 4.3 doctrine.set

- 逐字核对scope、side/unit目标、`emcon_radar`、`weapons_control`、空settings与非法值。
- 核对模拟是否真的保存可供后续读取/断言的条令状态；若生产没有读回，模拟不得虚构更强保证。

### 4.4 event.upsert

- 逐字核对event name、enabled、trigger类型/分钟、action白名单、同名更新与失败码。
- 核对生产返回的event name是否来自Lua结果或请求；模拟必须保存足够状态证明upsert，而不是永远返回`ok`。

## 五、跨合同检查

- `ToolRegistry`公开schema、`ToolInvocationService.Dispatch`和两个facade的方法必须一一对应。
- 写身份D-04、no-op预检、Intent→backup→sentinel顺序，以及批5审计链均为红线；6D只能对齐facade/Mock合同，不得顺手重构调用总线。
- 不碰模型传输、simulation/result/db3k、CSV drain、恢复域、UI、A1、B2、分页C2。
- 永不建议提交`runs/`、`backup/`、`BinaryGridProvider.cs`、`Terrain.cs`。

## 六、报告必须给出的施工建议

1. 推荐拆成几个独立WIP commit（可按工具拆，或说明为何可以合并）；列出每个commit的**具名允许文件**。
2. 每个commit的锁红测试名、旧代码预期失败点、修后成功条件。
3. 是否需要改生产代码：默认应为“只改InMemory/测试”；若发现生产bug，必须单列并停在预审，不得夹带修复。
4. 建议的具名测试过滤器、全量L1与AllInOne csproj验收命令。
5. 风险与待owner拍板项必须给选项+优缺点；没有磁盘证据的业务规则写“待确认”。

## 七、报告落盘

报告写到：

`D:\soft\F1-AI\FIX-6D-四工具Mock生产合同对齐-设计预审报告-20260831.md`

报告末尾必须声明：本轮只读、无源码/测试修改、无commit、未启动A1–A16/tag/push/V2.2。
