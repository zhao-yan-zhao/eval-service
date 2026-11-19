# FINAL-A1-R1：流式回复期间界面不卡死返修

## 一、结论与根因

Owner 真机已确认：A3 中文流式通过，但 A1 失败——普通聊天回复期间，F1 地图与窗口均无法拖动。

只读证据已经形成明确原因链：

- `chat-stream-diag.log` 在约 8 秒内收到上千个 `TextDelta`；
- `ChatController.AppendDelta` 每收到一个小片段都会调用 `RaiseChanged()`；
- 生产 `MarshalToUi` 使用 `Control.BeginInvoke`，因此每个片段都排入一次 UI 消息；
- `AiAssistantChatPanel.RefreshFromState` 每次都会重新获取全部状态、格式化整份聊天记录、整体赋值 `_txtTranscript.Text` 并滚动到底部；
- 当前会话已有约 96 条消息，因而每秒上百次整框重画，UI 消息队列被刷新任务占满，用户拖地图/窗口的消息无法及时处理。

这不是 SSE 传输需要重新缓冲，也不是模型配置问题。修复目标仅为：**完整接收每个 delta，但把 UI 重画合并为短间隔批次。**

## 二、开工门

工作区：`D:\soft\F1-AI-integration`

分支必须为：`integration/stable-single-ai`

开工 HEAD 必须为：`26effb30d3cc9989c3ad24a5f76675dc24b10575`

开工先报告当前分支、完整 HEAD 和 `git status --short`。允许既有 `runs/` 脏项，不得提交。若 HEAD 漂移或存在未说明的源码/测试改动，立即停工。

## 三、获准范围

默认只允许修改：

1. `CMO-netcore-src/AiAssistant/Infrastructure/Chat/ChatController.cs`
2. 新增具名测试 `tests/F1.AiAssistant.Tests/FinalA1R1_UiResponsivenessTests.cs`

若只有修改 `AiAssistantChatPanel.cs` 才能完成，请先停工说明必要性，不得自行扩围。

禁止修改模型 provider/SSE parser、TaskOrchestrator、任务控制、审计链、恢复域、工具层、想定、生产数据库、验收矩阵。

## 四、冻结功能合同

### 必须保持

- SSE 网络层仍逐事件读取，不得恢复“收完整篇再显示”的缓存。
- `_streamingBuffer` 按原顺序保留全部文字，不丢字、重字、乱序。
- 首批文字到达后短时间内可见，不能等回复结束才显示。
- Completed、Fault、Cancel 立即进入正确终态并完成最后一次 UI 刷新。
- “停止回复”仍可及时取消。
- 现有持久化、脱敏、会话与上下文合同不变。

### 修复要求

- `AppendDelta` 更新状态后，不得每个 delta 都投递 UI 刷新。
- 对流式刷新做单飞合并：任一时刻最多一个待执行/延迟中的流式刷新。
- 建议刷新间隔 50–100ms；代码中用明确常量，首屏可见测试上限不得超过 250ms。
- 终态刷新不能被节流吞掉；终态后的迟到刷新不得把界面改回 Busy/Streaming。
- 不得在持有 `_gate` 时调用 UI 回调。
- 禁止无观察的异常、无限 Timer、生命周期泄漏或递归刷屏。

可以采用受控延迟单飞调度或等价脏标记合并方案；不得通过减少模型输出、关闭流式或隐藏文字规避。

## 五、锁红测试

先加测试，旧码必须行为层确定性红：

1. **A1-R1A 高频 delta 不淹没 UI 队列**：fake provider 快速发出至少 1000 个单字符 delta，记录 `MarshalToUi` 投递次数；旧码应逐 delta 超限，修后投递数必须为明确小上界且不随 1000 线性增长。
2. **A1-R1B 首批内容及时可见**：首个 delta 后保持流未结束，证明 250ms 内至少发生一次状态通知，不能等 Completed。
3. **A1-R1C 全文完整有序**：1000 个片段最终拼接逐字一致，持久化 assistant 消息也一致。
4. **A1-R1D 终态不被迟到刷新覆盖**：Completed、Cancel、Fault 至少各一条；最终 `IsBusy=false`、状态正确、无幽灵 streaming 项、无终态回退。

锁红必须证明 UI 通知数量/刷新策略失败，不得仅以编译失败冒充。

## 六、提交纪律

- 单独 WIP commit，禁止 amend/rebase/reset 覆盖 `26effb3`。
- 仅具名 add 获准文件，禁止 `git add -A` / `git add .`。
- 永不提交 `runs/`、`backup/`、`BinaryGridProvider.cs`、`Terrain.cs`。
- 禁止 push/tag。

建议 commit：`final-a1-r1 WIP: coalesce streaming UI refreshes`

## 七、验收门

必须执行并保存日志：

1. 新增 A1-R1 具名测试；
2. T08.3 Chat 相关组；
3. FIX6B/T06 流式相关回归，证明真 SSE 未降级；
4. 全量 L1：`dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore`
5. AllInOne：`dotnet build CMO-netcore-src\F1-AllInOne.csproj -c Debug -p:Platform=x64 -t:Rebuild --no-restore`
6. `git diff --check 26effb3..HEAD`
7. commit 范围、禁区扫描、最终 status。

AllInOne 必须用 `.csproj`，不得以 `.sln` 增量构建代替。

## 八、完事报告

报告必须包含：开工/收工 SHA；行为锁红；刷新合并策略及频率上界；首批可见延迟；全文顺序与 Completed/Cancel/Fault/停止回复证据；各测试数量、退出码、日志；文件范围、具名 add、禁区；未找到/待确认项。

本轮只完成代码与自动测试。禁止控制 owner 窗口做真机复验；监理四门通过并灌装新候选后，再由 Owner 用同一 400 字提示复验一次。
