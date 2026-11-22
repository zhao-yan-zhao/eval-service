# FIX-6B-R1：挂起流取消 + 流读取异常安全边界——Cursor 完整返修工单

> 日期：2026-08-28  
> 执行端：Cursor  
> 性质：批6B第1轮返修，单独 WIP commit，禁止 amend `bb5ea1a`  
> 结论先行：FIX-6B主体真流式与known-secret主路径已落地，L1/AllInOne均绿；但监理逐字复核发现两个合同洞。当前取消 token 不能主动打断挂起的 `ReadLineAsync()`，C6靠假服务器两秒后自己放行才结束；同时成功流枚举位于 provider 原有 catch 之外，读取阶段的非 IOException 异常可能直接抛给调用方并绕过脱敏 Fault。必须补真实锁红反例后最小修复，批6B才可关门。

## 0. 唯一现场

- worktree：`D:\soft\F1-AI-fix6`
- 分支：`fix/p2-contract-a`
- 预期开工 HEAD：`bb5ea1a8a93bf5813516e2d27633034048260ffa`
- 该 HEAD 的 FIX-6B主体 commit：`bb5ea1a fix-6b WIP: stream SSE incrementally and redact transport faults`
- 开工若分支/HEAD不符，或存在非 `runs/` 的未提交改动：停工上报，不得清理、reset、amend、rebase。

开工原样记录：

```powershell
git -C D:\soft\F1-AI-fix6 rev-parse --abbrev-ref HEAD
git -C D:\soft\F1-AI-fix6 rev-parse HEAD
git -C D:\soft\F1-AI-fix6 status --short
git -C D:\soft\F1-AI-fix6 log -4 --oneline
```

## 1. 范围与红线

只准按需修改：

- `CMO-netcore-src/AiAssistant/Infrastructure/Models/SseChatCompletionsParser.cs`
- `CMO-netcore-src/AiAssistant/Infrastructure/Models/OpenAiCompatibleModelProvider.cs`
- `tests/F1.AiAssistant.Tests/T06_FIX6B_ModelStreamingTests.cs`

若上述三文件不足，先停工给出逐字证据，未经批准不得扩域。

红线：

- 不改 `SecretRedactor.cs`、`AiError.cs`、重试次数/退避、正常模型 payload、tool组装、UI、Mock、编排器、批4/批5文件。
- 不碰 demo 主工作区、night-soak、V2.2。
- 永不提交 `Command_Core/BinaryGridProvider.cs`、`Terrain.cs`、`backup/`、`runs/`。
- 禁止 `git add -A` / `git add .`；只可具名 add。
- 禁止降级：不能靠服务器/测试端超时放行、轮询 Sleep、吞异常、让调用方接裸异常、无界后台任务或取消后遗留挂起读取来“转绿”。

## 2. 监理已逐字确认的两个真缺口

### 缺口 A：取消没有打进挂起读取

磁盘当前逐字存在：

```csharp
line = await reader.ReadLineAsync().ConfigureAwait(false);
```

项目目标框架是 `net5.0-windows`，此调用没有接收 `cancellationToken`。token只在该 await 返回后才被检查；如果上游保持连接但永不再发完整行，取消不会主动唤醒读取。

现有 C6 不是有效锁门。它在假服务器端逐字存在：

```csharp
releaseGate.Wait(TimeSpan.FromSeconds(2));
```

消费者收到首 delta 后 `cts.Cancel()`，但服务端两秒后自行继续写 `[DONE]`，挂起读取才返回、随后代码才看见 token。因此“最终得到 cancelled”并不能证明取消打断了读取。

### 缺口 B：成功流枚举逃出 provider 异常边界

provider 当前发送/开流阶段的 `catch (Exception ex)` 在前；真正读取发生在后面的：

```csharp
await foreach (var ev in RemapParserEventsAsync(...))
```

`RemapParserEventsAsync` 自身没有 catch。parser只收敛 token取消和 `IOException`；读取阶段若抛 `HttpRequestException`、`ObjectDisposedException`、`InvalidOperationException` 或其他异常，会从公开 `IAsyncEnumerable` 直接炸出，而不是返回一个脱敏 `ModelStreamEvent.Fault`。这比旧实现退化：旧 provider 在同一 try/catch 内完成 parser 枚举。

## 3. 冻结修复合同

### A. 真取消

1. 首 delta 后，上游保持连接且永不再发任何字节/换行时，调用方取消 token 必须在**有界短时间**内结束挂起读取。
2. 对外只产生一个 `cancelled` Fault；不得 Completed、不得重试、不得再读、不得抛 `OperationCanceledException` 给调用方。
3. reader、body stream、response都必须释放；若用 token registration 触发 Dispose，因 Dispose 导致的 IOException/ObjectDisposedException在 token 已取消时必须稳定分类为 `cancelled`，不能误报 `stream_interrupted`。
4. 不得留下孤儿 `ReadLineAsync`/后台读任务。若采用 `Task.WhenAny`，取消分支必须主动终止底层读取并观察/收敛遗留任务异常；仅仅不 await 它不合格。
5. 保留正常 EOF、malformed、`[DONE]`、tool分片语义。

### B. provider 流读取异常边界

1. 成功收到HTTP头并输出过首 delta后，后续读取发生任意 transport/unknown异常，不得裸抛给 `await foreach` 调用方。
2. 必须输出：先前已交付的 delta保持；随后恰好一个稳定 Fault；零Completed；请求计数仍为1，不得重试已发事件的请求。
3. 分类：
   - 调用方 token 已取消 → `cancelled`。
   - `IOException`/流中断类 → `stream_interrupted`。
   - `HttpRequestException` 按现有 `ClassifyHttpRequestException` 合同分类，但不得重试已发事件。
   - 其他异常 → `unknown`。
4. 所有异常消息、Fault.UserMessage、Fault.DiagnosticDetail、DiagnosticLog必须走当前 `_options.ApiKey` known-secret 脱敏；原异常不得作为 InnerException泄漏。
5. C# async iterator不能在带catch的try内直接 `yield return`，允许用“每次 `MoveNextAsync` 在 try/catch 内取一个事件、退出 catch 区后再 yield”的单事件泵结构；禁止恢复整流 List 缓存。
6. 正常 `TextDelta`、tool name/arguments不做脱敏、不改写。

### C. 资源释放

- 正常DONE、Fault、取消、异常、消费者提前 `break`/DisposeAsync五路都必须释放 response/body/reader。
- 现有 C7只测了 parser 的底层 stream；R1须至少再有一条 **provider级** 提前停止/异常释放探针。

## 4. 三条必须先锁红的新反例

测试名可微调，但语义不得缩水。

### R1-A：取消主动打断永不放行的读取

- 假server发并flush首delta，随后等待一个**测试永不Set的门**；禁止服务器端 `Wait(timeout)` 后自行继续、禁止写DONE、禁止主动关连接。
- 消费者取得首delta后取消token。
- 用测试外层 `Task.WhenAny`/有界超时（建议500–1000ms，按本机稳定性设置但不得2秒假放行）断言枚举已结束。
- 断言：TextDelta×1、Fault(cancelled)×1、Completed×0、request count=1，并以probe证明连接/stream被释放。
- 当前 `bb5ea1a` 应超时锁红；若不红，先解释并加强反例，不得直接改生产。

### R1-B：流中异常不裸抛且known secret不泄漏

- 使用可注入的 `HttpClient/HttpMessageHandler/HttpContent` 返回200+自定义Stream。
- 自定义Stream先提供一条完整delta，下一次读取抛出带假密钥 `local.secret/6B:Alpha+42` 的 `HttpRequestException` 或普通异常；至少覆盖一个旧代码会从 `RemapParserEventsAsync` 裸抛的非IOException类型。
- 调用 `provider.StreamAsync` 收集事件，测试不得用 `Assert.Throws`放行。
- 断言：首delta保留；随后恰好一个预期Fault；零Completed；无裸异常；Fault两个字段、全部DiagnosticLog、净化异常ToString均无假密钥；请求计数=1。
- 当前 `bb5ea1a` 必须锁红。

### R1-C：provider级提前停止释放

- 注入可观测 response/body stream；取得首delta后调用方主动 `break` 或 DisposeAsync，不给DONE。
- 有界断言response/body读取被停止且stream已Dispose；不得只复用parser C7。
- 当前实现若已绿可以保留为防回归；必须实际跑，不得口头说明。

同时修正原 C6：删除“服务端两秒后自行放行即可通过”的伪门，或改成真正永不放行并由取消释放。

## 5. 回归要求

- 原 FIX6B 13条全部保持绿；新增R1测试后数量相应增加。
- C1/C2首delta真流式、C3顺序、C4 EOF、C5 malformed、C8 tool分片、D1 inline error known-secret不得退化。
- 既有 T06 全量保持绿。
- 全量 L1基线：748/748；新增测试后总数增加，失败0。
- AllInOne：0错；警告基线1136，变化须逐项解释。

## 6. 施工与验收命令

```powershell
cd D:\soft\F1-AI-fix6

dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore `
  --filter "FullyQualifiedName~FIX6B"

dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore `
  --filter "FullyQualifiedName~T06"

dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore `
  *> runs\fix6b-r1-l1-full.txt

dotnet build CMO-netcore-src\F1-AllInOne.csproj -c Debug -p:Platform=x64 -t:Rebuild --no-restore `
  *> runs\fix6b-r1-allinone-rebuild.txt

git diff --check bb5ea1a8a93bf5813516e2d27633034048260ffa..HEAD
git status --short
```

锁红输出、具名输出、双门输出均写 `runs/`，永不提交。

## 7. 提交纪律

- 三条硬反例先证明 `bb5ea1a` 会红，再改生产。
- 全绿后具名 add实际修改的三文件；未改文件不得add。
- 单独 commit建议：`fix-6b-r1 WIP: cancel blocked reads and contain stream faults`
- 禁止 amend `bb5ea1a`，禁止rebase覆盖历史。

## 8. 完事报告

必须包含：

1. 开工/收工完整SHA、R1独立commit。
2. commit内文件清单与stat。
3. R1-A/B旧代码锁红的逐字结果与日志路径；R1-C结果。
4. 取消如何主动终止底层读取且不留孤儿任务；Dispose引发异常如何稳定归类。
5. provider如何在不恢复整流缓存的前提下，把每次MoveNext异常收敛成脱敏Fault。
6. FIX6B具名、T06、全量L1、AllInOne、diff check的退出码/计数/日志绝对路径。
7. 最终status、禁区扫描、未用git add -A声明；未找到/待确认。

Cursor声明不等于验收。报告回来后监理仍亲跑范围、逐字diff、全量L1、AllInOne四门。
