# FINAL-BATCH-R2B：A14 事件分钟语义与真 Upsert 返修报告

## 结论

**R2B-1 相对分钟 + R2B-2 同名真 Upsert 均已完成**（非“相对分钟已完成 / 真 upsert 待确认”停工态）。

| 项 | SHA |
|---|---|
| 冻结开工基线 | `4d93828a87c17ef01205ab69ae00be075ed9aa90` |
| R2B-1 WIP | `585f8109776627c9a81f620ce6310972eb0ecaa5` |
| R2B-2 WIP / 收工 HEAD | `2d9adee63ef1bf3e652e965332c35ac3ebcdb4be` |
| 分支 | `fix/final-a14-events` @ `D:\soft\F1-AI-final-r2b` |

## 1. 开工记录

- 源仓 `D:\soft\F1-AI-integration` HEAD == 冻结 SHA `4d93828`（通过）。
- 新路径 `D:\soft\F1-AI-final-r2b`、分支 `fix/final-a14-events` 均不存在后新建（通过）。
- 开工 `git status`：干净 worktree（仅后续 runs 门禁日志为未跟踪）。

## 2. R2B-1：相对分钟 → 绝对 ToBinary

### 旧码锁红

`LuaEventTemplate.BuildScript` 原样写入 `Time='<TriggerMinutes>'`（如 `Time='2'`），而 F1 Time trigger 需要绝对时间编码。

### 逐字证据（解析端）

1. **ADD 路径** `LuaEvent.cs` `ParseDictToXML`（Time 字段）：先 `long.TryParse`；失败再 `DateTime.TryParse` 后写成 `ToBinary().ToString()`；成功则把二进制 long 字符串写入 XML。
2. **FromXML** `EventTrigger_Time.cs`：`Time = DateTime.FromBinary(Conversions.ToLong(xmlNode.InnerText))`。
3. 因此模板侧正确值为：`scen.Time.AddMinutes(N).ToBinary()` 的 invariant 十进制字符串。
4. Facade：`EventUpsert` 传 `LuaEventTemplate.BuildScript(req, scen.Time)`，禁止模板取 `DateTime.Now/UtcNow`。

### R2B-1 文件

- `CMO-netcore-src/AiAssistant.F1Core/LuaEventTemplate.cs`
- `CMO-netcore-src/AiAssistant.F1Core/CoreF1AutomationFacade.cs`
- `tests/F1.AiAssistant.Tests/Demo1C_CommitB_Tests.cs`
- `tests/F1.AiAssistant.Tests/FinalBatchR2B_EventTimingTests.cs`（新建）

### R2B-1 门禁

| 门 | 结果 | 日志 |
|---|---|---|
| 具名 Timing | 8 Passed | `runs/final-r2b-1-20260904/timing-named.log` |
| Demo1C + Fix6D Event | 11 Passed | `runs/final-r2b-1-20260904/related.log` |
| 全量 L1 | 947 Passed | `runs/final-r2b-1-20260904/l1-full.log` |
| AllInOne Rebuild | 成功 0 error | `runs/final-r2b-1-20260904/allinone.log` |

## 3. R2B-2：同名真 Upsert

### 旧码锁红

同名第二次仍 `SetTrigger/SetAction/SetEventTrigger/SetEventAction` 一律 `mode='add'` → 确定失败（Existing …）或关联累加。

### 磁盘 API（只读引用，未改 Command_Core）

| API | 证实语义 |
|---|---|
| `ScenEdit_SetTrigger` | add / list / remove / update；同名 add 抛 `Existing event trigger`；**update + ToBinary long 会把 Time 写成 `DateTime.MinValue`**（`long.TryParse` 成功后仍赋未解析的 `result7`） |
| `ScenEdit_SetAction` | add / list / remove / update；LuaScript 的 `ScriptText` update 可用 |
| `ScenEdit_SetEventTrigger` | add / remove / replace；add 不做去重，直接 `Triggers.Add` |
| `ScenEdit_SetEventAction` | add / remove / replace；add 同样可累加 |

因 Time 的 update+ToBinary 路径不可用，**owned trigger 采用 recreate**：unlink → remove → add(ToBinary) → link。Action 用 update（miss 再 add），关联一律 remove 再 add。多余 owned `{event}_action_{i}` 在 `i=N+1..128` 扫描 unlink+remove。只碰本工具稳定描述名，不碰其他事件组件。

Lua 任一步非 pcall 失败则整段脚本失败，Facade 不回报 `upserted`（无事务；半状态靠再次 upsert 可恢复）。

### 同名第二次行为（脚本合同）

1. 事件：已存在则 `SetEvent mode=update`（`isActive` = 第二次请求）。
2. Trigger：先 remove 关联与组件，再 add 新绝对时间；最后只 link 一次 owned `_td`。
3. Actions：对 1..N 优先 `SetAction mode=update ScriptText`，失败才 add；关联 remove→add。
4. N 变少：循环清理 `_{N+1}.._128` owned action 关联与组件。
5. 不 `SetEvent mode=remove`，无无描述 remove，不扫描外事件组件。

### R2B-2 文件

- `CMO-netcore-src/AiAssistant.F1Core/LuaEventTemplate.cs`
- `tests/F1.AiAssistant.Tests/Demo1C_CommitB_Tests.cs`
- `tests/F1.AiAssistant.Tests/FinalBatchR2B_EventUpsertTests.cs`（新建）

（Facade 本轮无需再改。）

### R2B-2 门禁

| 门 | 结果 | 日志 |
|---|---|---|
| 具名 Upsert + Timing + Demo1C + Fix6D | 26 Passed | `runs/final-r2b-2-20260904/named-related.log` |
| 全量 L1 | **954 Passed / 0 Failed** | `runs/final-r2b-2-20260904/l1-full.log` |
| AllInOne Rebuild | **0 错误** | `runs/final-r2b-2-20260904/allinone.log` |
| `git diff --check 4d93828..HEAD` | 干净 | — |

## 4. 收工 status

```
## fix/final-a14-events
 M runs/stage5-evidence/openai-strict-request-raw.json   # 未提交
?? runs/_ensure_intellilock.ps1 / final-r2b-*-20260904/ # 门禁日志，未提交
```

未 push / 未 tag / 未改验收矩阵 / 未启动 F1 / 未改 Command_Core。
