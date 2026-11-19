# FINAL-BATCH-R2A：A5/A13 多轮收尾纪律返修 Cursor 工单

## 0. 任务结论

这是一张**代码返修单**。修复生产系统提示词自相矛盾的问题：现在它要求每次仿真拿到结果后立即结束，导致用户明明要求“未达到目标就调整并再跑一轮”，模型也不能继续。本单只修多轮收尾纪律，不做真机、不碰事件工具、不碰配置。

开工基线固定为：

- 源仓：`D:\soft\F1-AI-integration`
- 源提交：`4d93828a87c17ef01205ab69ae00be075ed9aa90`
- 新 worktree：`D:\soft\F1-AI-final-r2a`
- 新分支：`fix/final-a5-rounds`

## 1. 开工硬门

1. 先核对源仓 HEAD 必须等于上述冻结 SHA。
2. `D:\soft\F1-AI-final-r2a` 与分支 `fix/final-a5-rounds` 必须都不存在；任一已存在，立即停工报告，不得覆盖、删除或复用。
3. 从冻结 SHA 新建独立 worktree/分支。不得改 `D:\soft\F1-AI` 主工作区，不得在 integration worktree 直接施工。
4. 记录开工 HEAD、分支、`git status --short`。允许既有 `runs/` 脏项，但不得纳入提交。

## 2. 已确认的磁盘事实

必须先自行 `rg` 再引用，以下只是定位线索：

- `CMO-netcore-src/AiAssistant/Application/TaskOrchestrator/ProductionTaskSystemPrompt.cs`
- 当前文字同时存在：
  - 仿真后系统自动注入 `[系统观察 result.read]`；
  - `result.read` 最多补一次；
  - 随后/立即输出最终总结。
- `tests/F1.AiAssistant.Tests/T07_9_DualRoundMockE2ETests.cs` 已证明编排器技术上支持至少两次 `simulation.run` 与两次对应的系统 `result.read`。
- A13 的业务口径已经冻结：当用户目标尚未满足但已达到 `max_rounds`，任务进入 `Failed(round_limit)` 并给出中文总结，算“自动限轮成功”，不是产品失败；不得为了好看改成 Completed。

## 3. 冻结合同

### 3.1 每一轮仿真后的纪律

系统注入该轮 `result.read` 后，模型必须先对照**用户明文给出的成功标准**：

- 已满足：直接中文总结并结束；
- 未满足且尚有轮次：允许做完成判定所必需的少量查询、调整、保存，然后再发起下一轮仿真；
- 无法安全判断或无法安全调整：如实总结限制并结束，不得盲目反复试错；
- 已达轮次上限：停止，不再发工具调用，中文说明“达到轮次上限，目标未完全满足”。

### 3.2 result.read 纪律

- “每轮系统自动注入一次结果”保持不变；
- 对同一个 run，最多额外补一次不同聚合维度的 `result.read`；
- 禁止用换参数反复读同一个 run；
- 下一轮产生的新 run 可有自己的一次系统自动结果，这不算重复读取上一轮。

### 3.3 允许的检查与调整

仅当用户任务明文包含可验证成功标准及“未满足则调整/再跑”时，结果注入后才允许：

- 调用与该成功标准直接相关的只读工具（例如 `unit.status`）；
- 做必要且获授权的写入调整；
- `scenario.save` 后再运行一轮。

禁止把这条口子扩大成无关侦察；`scenario.get_summary` 全任务最多一次的现有纪律保持。

## 4. 获准改动范围

默认只准：

1. `CMO-netcore-src/AiAssistant/Application/TaskOrchestrator/ProductionTaskSystemPrompt.cs`
2. 新建 `tests/F1.AiAssistant.Tests/FinalBatchR2A_MultiRoundPromptTests.cs`
3. 若已有专门验证该提示词的测试文件，可在报告中说明后具名修改该测试文件。

不得修改 `TaskOrchestrator.cs` 来绕过提示词。本单若发现仅改提示词无法满足冻结合同，停工上报“待确认：需要扩大到编排器”，列出精确原因与最小文件清单，不得自行扩围。

## 5. 锁红与测试要求

先加测试、在旧码 `4d93828` 上留确定性锁红证据，再修生产文字。至少覆盖：

1. 旧提示词含无条件“收到自动结果后必须立即最终总结”的冲突，测试锁红；修后不得再有无条件终止含义。
2. 新提示词逐字包含：先比对用户成功标准、满足即结束、未满足且有轮次可检查/调整/保存/下一轮、达上限停止报告。
3. 明确“每个 run 最多额外一次 result.read”，而非整个任务只能再读一次。
4. 明确多轮许可只在用户明文要求成功标准与再调整时成立，普通单轮任务仍应收尾。
5. 现有 `T07_9_DualRoundMockE2ETests` 继续通过；不得修改它来迁就新文字。
6. A13 相关测试继续钉住 `Failed(round_limit)` + 有中文可见总结，不改成 Completed。

测试不能只 `Assert.Contains` 几个孤立词就宣称合同成立；应同时排除旧的无条件立即收尾句，证明新旧语义不冲突。

## 6. 提交与门禁

1. 只用具名 `git add <file>`；禁用 `git add -A`、`git add .`。
2. 单独 WIP commit，建议信息：`final-r2a WIP: allow bounded multi-round evaluation`。
3. 亲跑：
   - 新增具名测试；
   - `T07_9_DualRoundMockE2ETests`；
   - A13/limit 相关测试；
   - 全量 L1：`dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore`；
   - AllInOne：`dotnet build CMO-netcore-src\F1-AllInOne.csproj -c Debug -p:Platform=x64 -t:Rebuild --no-restore`；
   - `git diff --check 4d93828..HEAD`。
4. 永不提交：`runs/`、`backup/`、`Command_Core/BinaryGridProvider.cs`、`Terrain.cs`。
5. 不 push、不 tag、不改验收矩阵、不灌运行包、不启动 F1。

## 7. 完事报告必须包含

- 开工/收工 SHA、commit、文件清单；
- 旧码锁红的测试名、失败点、日志路径；
- 新提示词的新旧逐字段/逐句对照；
- 具名、相关组、全量 L1、AllInOne、diff check 的退出码与数量；
- 最终 `git status --short`；
- 明确说明 A13 仍是 `Failed(round_limit)`，以及没有放宽无关侦察。

