# FIX-6B（D-10 / D-11）真 SSE 流式与模型传输脱敏——Cursor 完整工单

> 日期：2026-08-27  
> 执行端：Cursor  
> 监理：F1-AI 联调返修总调度  
> 性质：批6B生产传输层返修；必须单独 WIP commit；完成后回监理四门复验  
> 结论先行：现实现虽然使用 `ResponseHeadersRead`，但解析器与 provider 各自整流缓存，调用方在 `[DONE]`/EOF 前看不到首个文本增量；SSE 内嵌错误又没有携带当前已知密钥做脱敏。必须做真增量输出，并封死错误/诊断面明文密钥泄漏，禁止以“最终能返回全部内容”冒充流式。

## 0. 开工现场与不可越线项

### 0.1 唯一施工现场

- worktree：`D:\soft\F1-AI-fix6`
- 分支：`fix/p2-contract-a`
- 预期开工 HEAD：`a5eb24675ec0a011c58dcc715cac1f13674751de`
- 该 HEAD 已包含批6A和已关门的批6C；不得回退、rebase、amend 或覆盖历史。
- 若 HEAD 不是 `a5eb246` 开头，或源码存在非 `runs/` 的未提交改动：**立即停工上报，不得自行清理。**

### 0.2 开工先执行并原样记录

```powershell
git -C D:\soft\F1-AI-fix6 rev-parse --abbrev-ref HEAD
git -C D:\soft\F1-AI-fix6 rev-parse HEAD
git -C D:\soft\F1-AI-fix6 status --short
git -C D:\soft\F1-AI-fix6 log -5 --oneline
```

### 0.3 允许范围

原则：只改完成 D-10/D-11 所必需的模型传输层与 L1 测试。预授权文件：

- `CMO-netcore-src/AiAssistant/Infrastructure/Models/OpenAiCompatibleModelProvider.cs`
- `CMO-netcore-src/AiAssistant/Infrastructure/Models/SseChatCompletionsParser.cs`
- `CMO-netcore-src/AiAssistant/Infrastructure/Models/SecretRedactor.cs`（仅确有脱敏合同需要时）
- `CMO-netcore-src/AiAssistant/Infrastructure/Models/AiError.cs`（仅确有统一 fault 重建需要时）
- `tests/F1.AiAssistant.Tests/T06ModelProviderTests.cs`
- 必要时可在同一测试项目新增一个具名 `FIX6B` 测试文件或测试 helper；不得顺手整理既有测试。

若必须改上述清单外的生产文件，先停工，以“文件 + 逐字证据 + 为什么清单内无法完成”上报，未经批准不得动。

### 0.4 绝对红线

- 不碰 demo 主工作区 `D:\soft\F1-AI` 的源码；只在 fix6 worktree 施工。
- 不碰批4/批5恢复与审计域：`AiAssistantStore*.cs`、`AuditHashChain.cs`、`MigrationCatalog.cs`、`AiAssistantCompositionRoot.cs`、`MutationRecoveryService.cs`、`TaskOrchestrator.cs`。
- 永不提交：`Command_Core/BinaryGridProvider.cs`、`Terrain.cs`、`backup/`、`runs/`。
- 不改聊天 UI 文案/映射，不改工具 schema、Mock、业务编排、重试次数和退避参数。
- 禁止 `git add -A`、`git add .`；必须具名 add。
- 禁止降级方案：一次性收完再吐、轮询假流式、定时切字符串、无界 Channel、吞掉 Fault/取消、取消 `[DONE]` 完成门，均不接受。

## 1. 磁盘已确认的缺口（先 grep 再施工）

当前代码逐字存在以下落点：

1. `OpenAiCompatibleModelProvider.StreamAsync` 声明 `List<ModelStreamEvent> buffered = null;`，成功响应中把 parser 的每个事件 `buffered.Add(ev)`，离开网络读取与 `finally` 释放流后才 `foreach` 向调用方输出。
2. `SseChatCompletionsParser.ParseAsync` 先 `await ParseToListAsync(...)`，得到完整列表后才 `yield return`。
3. parser 处理 SSE `error.message` 时调用 `SecretRedactor.Redact(errMsg)`，没有传当前 `_options.ApiKey`；对非 Bearer、非 `sk-` 的任意格式已知密钥，形状规则不足以保证不泄漏。
4. provider 的非 2xx body、普通异常与 `DiagnosticLog` 已有携带 `_options.ApiKey` 的脱敏路径；本轮必须保留并用反例证明所有错误出口一致。

开工后先用 `rg -n` 复核这些文本。引不到就写“未找到”并停工，不得照聊天内容猜改。

## 2. 冻结合同 A：D-10 真 SSE 增量输出

### A1. 首增量必须在流完成前可见

- 服务器发出并 flush 第一条合法 `data:` 文本 delta 后，只要该行已完整到达，调用方的 `await foreach` 必须能取得该 `TextDelta`。
- 此时即使服务器尚未发 `[DONE]`、仍保持连接、后续数据被测试闸门扣住，首 delta 也必须已经返回。
- parser 和 provider 两层都必须满足；只修 parser、provider 仍整流缓存，不算完成。

### A2. 只保留“协议必需的有界状态”

- 文本 delta：解析一条输出一条，不积攒全文，不积攒完整事件列表。
- tool call：允许按 tool index 暂存名称/id/arguments 分片，因为完整参数 JSON 未闭合前不能伪造可执行调用；只在现有协议确认点完成组装和校验后输出。
- usage、finish reason、`[DONE]` 语义保持现合同。
- 禁止新增无界队列。若实现需要 Channel，必须是严格有界并把取消/提前停止向生产者传播；优先用单事件 `MoveNextAsync`/局部状态的直接异步迭代结构。

### A3. 兼容入口不得反向拖回假流式

- `SseChatCompletionsParser.ParseAsync` 必须成为真正的逐行解析主实现。
- 若保留 `ParseToListAsync` 供既有测试/兼容调用，必须由它枚举新的 `ParseAsync` 后收集；不得再由 `ParseAsync` 调 `ParseToListAsync`。
- 生产 provider 不得调用 `ParseToListAsync`，也不得出现等价的整流 `List<ModelStreamEvent>` 缓存。

### A4. 终止与错误语义原样守住

- `[DONE]` 仍是正常完成的必要门：合法 `[DONE]` 后按现有次序输出已组装 tool call、usage、Completed。
- 已输出文本后遇到干净 EOF 但没有 `[DONE]`：保留先前 `TextDelta`，随后只输出一个 `stream_interrupted` Fault；不得输出 Completed。
- malformed SSE JSON：只输出一个 `format_invalid` Fault，之后不得再输出文本/tool/usage/Completed。
- 取消：保持现有稳定错误码 `cancelled`，只出现一次，不得再有 Completed；不得把调用方取消误判成 timeout。
- 网络/IO 中断：保持现有稳定分类；不得把原始异常对象或 inner exception带出。
- 一旦本次响应已经向调用方输出任何事件，不得重试该请求，防止重复 delta/tool；现有 429/5xx 在尚未输出事件前的退避重试合同保持不变。

### A5. 资源生命周期

- response、body stream、reader 在正常完成、Fault、取消、异常、调用方提前 `break`/DisposeAsync 五条路径都必须可释放。
- 不得为了让 `yield` 编译通过，把 response/stream 提前 Dispose 后再返回事件。
- 不得起一个失去监管的后台读流任务；消费者提前停止后，生产读取必须随之结束。

## 3. 冻结合同 B：D-11 模型传输错误面脱敏

### B1. 保护对象

当前 profile 中的明文 `_options.ApiKey` 是“已知秘密”。不论它长什么样（包括不以 `sk-` 开头、不在 Bearer/JSON 标准形状中），以下所有错误/诊断出口都不得包含其逐字明文：

- `ModelStreamEvent.Fault.Fault.UserMessage`
- `ModelStreamEvent.Fault.Fault.DiagnosticDetail`
- provider `DiagnosticLog` 的每一行
- 非 2xx vendor JSON/plain-text body 派生的 fault 与日志
- SSE 200 响应内嵌 `error.message` 派生的 fault 与日志
- HTTP/IO/未知异常经净化后的 `Message` 与 `ToString()`

不得仅靠 `sk-`/Bearer 正则；所有能接触当前 profile 的 fault 构造/日志边界必须带入 known secret，或在 provider 向外 yield Fault 前做等价的统一重建脱敏。

### B2. 不越过的边界

- 不修改正常 `TextDelta`、tool name、tool arguments 等模型业务 payload；本批“脱敏”针对错误、异常和诊断面。擅自改正常模型内容会破坏工具参数，禁止。
- 不把 API key 写盘、写测试快照、写 commit message、写完事报告原文；测试只用明确的假密钥常量。
- 不把原始 exception 作为 InnerException 留在净化异常里。
- UI 仍使用既有固定人话映射；本轮不得通过 UI 改造掩盖 provider 泄漏。

### B3. 形状规则的最小原则

- 保留既有 Bearer、`sk-`、敏感 JSON 字段脱敏。
- 是否扩充 query/form/header 的通用正则：**待确认，不作为本轮擅自扩大范围的理由。** 本轮硬门是“当前已知 `_options.ApiKey` 在全部错误/诊断出口零明文”。若测试实证发现仅修改已知秘密传递仍不能满足上述出口，停工上报证据，不自行创造新业务规则。

## 4. 强制 L1 反例（必须先证明旧代码会红）

测试名可按项目风格调整，但每条语义不可缩水。优先放 `T06ModelProviderTests.cs`；若文件过大可新增单个 `T06_FIX6B_ModelStreamingTests.cs`。

### C. 真流式反例

1. **Parser 首 delta 闸门**：自定义 gated/chunked Stream 先放出一条完整 SSE 文本 data 行，第二道闸门扣住 `[DONE]`。开始枚举 `ParseAsync`，在不打开第二闸门的情况下，以有界超时断言首个 `TextDelta` 已返回。旧 `ParseAsync -> ParseToListAsync` 必须在此测试失败/超时。
2. **Provider 首 delta 闸门（硬门）**：本地假 HTTP 服务先写并 Flush 首 delta，随后等测试闸门才写 `[DONE]`。开始枚举 `provider.StreamAsync`；闸门仍关闭时必须先拿到首 delta。旧 provider 的 `buffered` 必须在此测试失败/超时。
3. **Provider 多 delta 顺序**：逐个闸门放出 A、B、`[DONE]`，调用方分别在下一闸门开启前看到 A、B，最终一次 Completed；次序不可漂移。
4. **EOF after delta**：首 delta 已对调用方可见，再关闭连接且无 `[DONE]`；最终恰好一个 `stream_interrupted`，零 Completed。
5. **malformed after delta**：合法首 delta 后发 malformed JSON；保留首 delta，随后恰好一个 `format_invalid`，零后续事件。
6. **取消 after delta**：取得首 delta 后取消 token；最终稳定为一个 `cancelled`，零 Completed、零重试、服务器请求计数为 1。
7. **提前停止释放**：取得首 delta 后消费者主动 DisposeAsync/`break`，用可观测 stream/server probe 断言读取/连接在有界时间内结束；不得依赖测试进程退出清资源。
8. **tool 分片不早产**：tool arguments 分两段，第一段到达时不得输出不完整 ToolCall；第二段 + `[DONE]` 后只输出一个参数可解析的完整 ToolCall，原 wire-name remap 保持。

所有并发/闸门测试必须有短而明确的有界超时，失败时给出可读断言；禁止 `Thread.Sleep` 猜时序，禁止测试无限挂死。

### D. 脱敏反例

使用不会被现有形状正则误打中的假密钥，例如 `local.secret/6B:Alpha+42`，逐条断言该完整字符串不出现于：

1. 200 SSE 内嵌 `error.message` 的 Fault.UserMessage / DiagnosticDetail / 所有 DiagnosticLog；这是当前明确缺口，旧代码必须红。
2. 非 2xx JSON body 与 plain-text body 的 Fault.UserMessage / DiagnosticDetail / 所有日志。
3. HttpRequestException/普通异常消息经 provider 输出的 Fault 和日志；净化异常 `Message`、`ToString()` 也不得含秘密且无原始 InnerException。
4. 取消、EOF、malformed 等流式 fault 的所有用户/诊断字段同样走统一安全边界。
5. 既有 Bearer、`sk-`、敏感 JSON 字段测试继续全绿。

反例检查须同时扫描字段值和收集到的全部日志，不能只断言某一条固定文案。

## 5. 兼容回归门

以下既有合同必须保持：

- 半行/跨 read 分片可重组；大小写 `data:` 与注释/空行处理不退化。
- `[DONE]`、usage、finish reason、legacy function_call、并行 tool_calls 分片组装与参数 JSON 校验不退化。
- strict wire-name validator 与 orchestrator result.read 回归保持。
- 401/403 不重试；429/5xx 退避重试次数不变；tool-calling unsupported 不静默降级。
- connection tester 的 EOF-without-DONE 失败、正常 DONE 成功保持。
- 不修改正常模型 payload，不改变 IModelProvider 对外合同，除非编译上确有必要；若需 public API 变更先停工上报。

## 6. 施工顺序与验收命令

1. 记录开工现场。
2. 先加 C1、C2、D1 三个锁红硬反例；分别运行并保存“旧代码确实失败”的输出。若旧代码不红，说明反例没卡住缺口，先修测试。
3. 最小改生产实现，让三硬反例转绿。
4. 补齐其余 C/D 与兼容回归；不得为了绿而删改既有断言。
5. 运行 `git diff --check`、范围/红线扫描、具名测试、全量 L1、AllInOne。

```powershell
cd D:\soft\F1-AI-fix6

dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore --filter "FullyQualifiedName~T06"

dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore `
  *> runs\fix6b-l1-full.txt

dotnet build CMO-netcore-src\F1-AllInOne.csproj -c Debug -p:Platform=x64 -t:Rebuild --no-restore `
  *> runs\fix6b-allinone-rebuild.txt

git diff --check
git status --short
```

- 本机 restore 若遇 NuGet `path1` 怪癖，可先单独 restore 一次；不得以环境口头说明代替最终 `--no-restore` 两门。
- 全量 L1 基线：`735/735`；本批新增测试后总数应相应增加，要求失败 0。
- AllInOne 基线：0 错 / 1136 警告；要求 0 错。警告若变化必须给前后对照和来源，不能只写“构建成功”。
- 输出写 `runs/`，永不提交。

## 7. 提交纪律

仅在全部门通过后，逐个文件具名 add，例如：

```powershell
git add CMO-netcore-src/AiAssistant/Infrastructure/Models/OpenAiCompatibleModelProvider.cs
git add CMO-netcore-src/AiAssistant/Infrastructure/Models/SseChatCompletionsParser.cs
git add tests/F1.AiAssistant.Tests/T06ModelProviderTests.cs
git commit -m "fix-6b WIP: stream SSE incrementally and redact transport faults"
```

上例只是示意；未修改的文件不得 add，实际新增测试文件必须用其真实具名路径。禁止 add `runs/`、`backup/`、许可 DLL 或任何既有脏文件。

## 8. 停工上报条件

任一命中即停工，不得自行扩域：

- HEAD/分支/非 runs 脏状态不符合第 0 节。
- 必须改允许清单外的生产文件或 public API 才能完成。
- 发现现有重试、tool-call、错误码合同与本工单互相矛盾。
- 真流式会触发调用方新的生产 bug，需要改 ChatController/TaskOrchestrator/UI。
- 只有降级/吞错/取消 `[DONE]`/无界缓存方案才能“转绿”。
- 全量 L1 或 AllInOne 出现无法归因且隔离复跑仍红。

上报格式：`阻塞点 / 磁盘逐字证据 / 已做只读或测试验证 / 选项A与优劣 / 选项B与优劣 / 推荐项`。不确定处写“待确认”，不得猜业务规则。

## 9. 完事报告（七项缺一不可）

1. 开工 HEAD、收工 HEAD、单独 WIP commit 完整 SHA。
2. commit 内改动文件清单与 `git show --stat`；说明为何每个生产文件必需。
3. D-10 对照：旧双缓存落点、新逐事件链路、首 delta 在 DONE 前可见的测试证据、tool 分片/EOF/cancel/提前停止资源释放结果。
4. D-11 对照：所有错误/诊断出口清单、known secret 如何贯穿、正常业务 payload 未被改写的说明。
5. 锁红证据：C1/C2/D1 旧代码失败输出路径；修后具名测试退出码与通过数。
6. 全量 L1、AllInOne 的命令、退出码、通过/失败数、错误/警告数、输出绝对路径；`git diff --check` 结果。
7. 禁区扫描、最终 `git status --short`；明确未用 `git add -A`，未提交 runs/backup/禁区，列出“未找到 / 待确认”。

Cursor 的自报不等于验收。报告回来后，监理将亲跑范围、逐字 diff、全量 L1、AllInOne 四门；全部通过后批6B才可关门。
