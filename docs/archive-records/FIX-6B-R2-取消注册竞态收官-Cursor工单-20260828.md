# FIX-6B-R2：取消注册竞态收官——Cursor完整微修工单

> 日期：2026-08-28  
> 性质：批6B第2轮收官微修，单独WIP commit，禁止amend前两轮  
> 结论先行：R1已修好provider流中异常收敛，监理亲跑L1 751/751、AllInOne 0错；但R1-A测试没有真正进入挂起读取，且 `ReadLineCancellableAsync` 仍是“先启动读取、后注册取消”。若底层 `ReadAsync` 在返回Task前同步阻塞，取消回调永远装不上。R2只修这一处竞态和对应假硬门，不扩业务范围。

## 0. 开工现场

- worktree：`D:\soft\F1-AI-fix6`
- 分支：`fix/p2-contract-a`
- 预期开工HEAD：`f748c90083b4dc1d633e0345bab51d5ca99c6a7a`
- 历史必须保留：`bb5ea1a`（6B主体）→`f748c90`（R1）→本轮新commit。
- 分支/HEAD不符或出现非`runs/`未提交改动，停工上报；禁止reset/rebase/amend。

```powershell
git -C D:\soft\F1-AI-fix6 rev-parse --abbrev-ref HEAD
git -C D:\soft\F1-AI-fix6 rev-parse HEAD
git -C D:\soft\F1-AI-fix6 status --short
git -C D:\soft\F1-AI-fix6 log -4 --oneline
```

## 1. 唯一允许范围

只准修改：

- `CMO-netcore-src/AiAssistant/Infrastructure/Models/SseChatCompletionsParser.cs`
- `tests/F1.AiAssistant.Tests/T06_FIX6B_ModelStreamingTests.cs`

`OpenAiCompatibleModelProvider.cs`本轮不得再动；R1-B单事件泵已通过逐字复核。其他生产文件一律红线。

继续执行既有禁区：不碰UI/Mock/编排器/批4/批5/demo/night-soak/V2.2；永不提交`BinaryGridProvider.cs`、`Terrain.cs`、`backup/`、`runs/`；禁止`git add -A`和`git add .`。

## 2. 监理逐字证据与裁决

### 2.1 实现竞态仍在

当前 helper 的先后顺序逐字是：

```csharp
var readTask = reader.ReadLineAsync();
...
using (var reg = cancellationToken.Register(...))
```

即：先调用可能同步阻塞的读取，之后才安装取消回调。若第一行调用在返回Task前卡住，代码永远走不到`Register`。

### 2.2 R1-A是假硬门

R1-A第一块数据逐字以 `"\n\n"` 结束。parser交付首delta后，`StreamReader`内部仍缓存一条空行；测试在delta回调里立刻`cts.Cancel()`。下一次循环先从内存拿到空行，随后普通的`cancellationToken.IsCancellationRequested`检查就返回cancelled，根本没有开始第二次底层阻塞读取。

因此：

- 报告承认“旧版R1-A可能较快结束”属实。
- “16/16绿”不能证明挂起读取被取消。
- 本轮必须让测试明确观测到“第二次底层读取已经开始”，然后再取消；不得再用数据尾空行或预先取消绕过。

## 3. 冻结修复合同

### A. 先注册，后读

1. 在调用 `reader.ReadLineAsync()` **之前** 安装 cancellation registration。
2. token若在进入helper前已取消，必须立即稳定抛/转换为cancelled，不能启动新读取。
3. token在底层读取已挂起后取消，registration必须Dispose reader/stream，主动打断读取。
4. 被Dispose唤醒的读取任务必须被await观察并收敛；不得留下未观察异常/孤儿任务。
5. IOException/ObjectDisposedException在token已取消时→`cancelled`；未取消时维持既有stream fault/unknown边界。
6. registration与reader/stream双重Dispose必须幂等，不得影响正常DONE、EOF、malformed、tool分片。

### B. 真正的在途取消反例

把R1-A改成下列严格时序：

1. 自定义stream第一次read只返回一条完整`data:`行所需字节，避免留下可让parser绕过底层读取的额外空行；SSE解析所需最小换行以磁盘行为实证为准。
2. 第二次底层`ReadAsync`：
   - 先设置可观测`SecondReadStarted`信号；
   - 然后同步等待或返回永不自行完成的Task；
   - 只有stream被Dispose或测试finally清理时才释放。
3. 测试collector收到首delta后**不得立即cancel**；主测试线程先等待`SecondReadStarted`，确认读取确已在途，再调用`cts.Cancel()`。
4. 取消后500–1000ms内枚举结束：TextDelta×1、Fault(cancelled)×1、Completed×0、request count=1、stream已Dispose。
5. 为防锁红阶段永久挂测试，必须在`try/finally`里设置测试专用cleanup release；先记录`finishedWithinBound=false`再清理并让旧代码退出。禁止cleanup信号参与“是否按时取消”的通过判据。
6. 测试先应用到`f748c90`且必须稳定红；红因应为“第二读已开始但cancel后未在时限内结束”，不是编译错误或随机超时。

建议将测试stream命名为`DisposeUnblocksSecondReadStream`之类，并直接暴露：

- `Task/WaitHandle SecondReadStarted`
- `IsDisposed`
- 测试finally专用`ReleaseForCleanup()`

若采用同步阻塞型ReadAsync，取消必须由独立测试线程触发，以实证“注册发生在同步阻塞调用之前”。

## 4. 不得退化项

- R1-B：首delta后HttpRequestException必须变一个known-secret脱敏Fault，不裸抛、不重试、无Completed。
- R1-C：provider提前break释放response/body。
- C1/C2首delta在DONE前可见。
- C4 EOF、C5 malformed、C6取消、C8 tool fragments、D1 inline error脱敏全部保持。
- provider双缓存不得回归；正常payload不得改写。

## 5. 验收命令

先锁红，再修复，再依次运行：

```powershell
cd D:\soft\F1-AI-fix6

dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore `
  --filter "FullyQualifiedName~FIX6B_R1A_Cancel_actively_interrupts_blocked_read"

dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore `
  --filter "FullyQualifiedName~FIX6B"

dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore `
  --filter "FullyQualifiedName~T06"

dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore `
  *> runs\fix6b-r2-l1-full.txt

dotnet build CMO-netcore-src\F1-AllInOne.csproj -c Debug -p:Platform=x64 -t:Rebuild --no-restore `
  *> runs\fix6b-r2-allinone-rebuild.txt

git diff --check f748c90083b4dc1d633e0345bab51d5ca99c6a7a..HEAD
git status --short
```

- 当前L1基线751；测试数量不新增则仍应751/751，新增则对应增加，失败0。
- AllInOne要求0错，警告基线1136。
- 所有日志写`runs/`，永不提交。

## 6. 提交纪律

- 先提交/暂存测试前不要改生产；保存`f748c90`锁红证据。
- 修复后仅具名add实际修改的parser与测试文件。
- 单独commit建议：`fix-6b-r2 WIP: register cancellation before blocked SSE reads`
- 禁止amend `f748c90`/`bb5ea1a`。

## 7. 完事报告

必须包含：

1. 开工/收工完整SHA与独立commit。
2. 两文件stat；若多文件即说明越界并停工。
3. 旧`f748c90`锁红：证明`SecondReadStarted=true`、cancel后有界时间仍未完成、finally清理后测试进程正常退出；日志绝对路径。
4. 修后同一测试：第二读已开始、取消有界完成、单cancelled Fault、stream已Dispose。
5. helper逐字先后对照：Register必须在ReadLineAsync之前；遗留readTask如何观察。
6. R1-B/R1-C、FIX6B、T06、全量L1、AllInOne、diff check结果与日志。
7. 最终status、禁区扫描、具名add声明、未找到/待确认。

报告回来后仍由监理亲跑四门。R2过门后批6B才关门。
