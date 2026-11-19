# Console 现成开关留档：`-S` / `-AUTORUN` / `-AIMODE`

- 日期：2026-08-11（随 T01.2 完成）
- 用途：给 **T01.3（自动步进）** 选型用
- 依据：`D:\soft\F1-AI\F1_Console\MyConsoleApplication.cs`（源码分析）
- 本轮：**未**实跑会启动推演的组合（避免误开 sim）；`-R/-C` 转换路径已在 T01.1/T01.2 实跑验证

宿主约定：`D:\soft\Master_Public\F1\F1-Console.exe`（与 T01.1 ADR 一致）。

---

## 总览

| 开关 | 参数形态 | 主要副作用 | 会不会自己开跑推演 |
|---|---|---|---|
| `-S <lua路径>` | 下一参数=Lua 文件路径 | 记下 `luaScriptFile`；并从路径推导 `SchemaFangAnName`、把同名规则换成 `Weapon.json` → `WeaponFile` | **单独不够**。必须再配 `-M >0`（方案模式）才会 `RunScn(..., lua)` 并在其中 `Run()` |
| `-AUTORUN <n>` | `n>0` → true | `GameGeneral.b_IsAutoRun = true` | **会**（在 `RunScn` 且非方案模式时调用 `GameContext.Run()`） |
| `-AIMODE <n>` | `n>0` → true | `GameGeneral.b_IsAIMode = true`；可配 `-LUASERVERPORT` | **不会单独开推演**；会（在非 `-R/-C` 短路路径）启动 LuaServer |

另：`-R` + `-C` 会先走 `ConvertScnToXml` 然后 **直接 return**，**不会**走到下面的 LuaServer / `RunScn` / AutoRun。这是 T01.1/T01.2 读读回的安全路径。

---

## `-S`（Lua 脚本路径）

源码要点（解析阶段）：
- `luaScriptFile = args[i]`
- 用路径分段：`SchemaFangAnName` ≈ 倒数第二级目录名（否则 `"Error"`）
- `WeaponFile = luaScriptFile.Replace("LuaScript.lua", "Weapon.json")`（字符串替换，依赖约定文件名）

进入主流程后：
1. 若已有 `-R` 且 `-C`：转换后返回 → **忽略** `-S` 的运行含义。
2. 若仅有想定文件名（`-R`）且 **没有** lua：`RunScn(scn)`。
3. 若有 lua **且** `b_IsSchemeRun`（`-M >0`）：`RunScn(scn, lua)` → 内里 `RunScripFile(lua)`，再 `GameContext.Run()`，并开方案 CSV 导出路径。
4. 若有 lua 但 **没有** `-M`：两个分支都不进，**几乎等于没加载就 return true**（陷阱）。

**T01.3 含义**：不要假设「`-R xxx.scen -S script.lua`」就会跑脚本；方案推演要 `-M 1`（及试验设计相关的 `-SCHEMENAME` 等）。自由自动步进更可能看 `-AUTORUN`。

---

## `-AUTORUN`

- `>0` → `b_IsAutoRun = true`
- 仅在 `RunScn` 内、且 **不是** `b_IsSchemeRun` 时：
  - 设时间压缩为 `Coarse_FiveSecSlice`
  - 调用 `theScen.GameContext.Run()`
- 之后仍进入 `while (!theScen.HasEnded) { Sleep(500); 打印 Time; }`，进程可能长时间不退。

**T01.3 含义**：这是最接近「加载后自动开跑」的现成开关；验收要配超时强杀 / 结束条件探测，并避免与 `-R/-C` 混用（混用会根本不进 `RunScn`）。

### 实测补记（2026-08-11，T01.3）
- `-R <工作副本> -AUTORUN 1`：能启动、能强杀干净；stdout 每 ~500ms 打印 `theScen.Time`。
- **时间不推进**：`Game.Run()` 只设 `Running`；Console 等待循环**不**调用 `Advance1Pulse`。
- T01.3 实际采用 PoC 调 `ClientCore.Advance1Pulse`（见 `runs/T01.3-execution-record.md`）。

---

## `-AIMODE`（及 `-LUASERVERPORT`）

- `>0` → `b_IsAIMode = true`
- 在非转换短路路径上：
  - 若 AI 模式且端口非空：`LuaServerManager.StartServer(port)`
  - 否则：`StartServer()`（默认）
- **不**根据 `b_IsAIMode` 自动调用 `GameContext.Run()`；是否推演仍取决于 `-AUTORUN` / `-M` 方案路径。

**T01.3 含义**：更像「接外部 Lua/AI 服务」开关，不是「自动步进」本身。可与 `-AUTORUN` 组合，但组合行为要以实测为准（本轮未测）。

---

## 推荐给 T01.3 的试探顺序（待你批准后再跑）

1. **最小自动跑**：`-R <工作副本.scen> -AUTORUN 1`（先短时超时观察是否进入 Run、日志 Time 是否前进）。
2. **方案 Lua 路径**（若要用固定脚本）：`-R ... -S <LuaScript.lua> -M 1`（另需方案名等参数时再补）。
3. **AI 服务路径**：仅当需要外部 LuaServer 时再加 `-AIMODE 1 -LUASERVERPORT <port>`。
4. 继续禁止：自由模型生成 Lua；生产 Console 源码改动需另批。

## 本轮故意没做的探针
- 未执行带 `-AUTORUN` / `-M` 的实机命令（会开推演）。
- 未验证 Weapon.json / 方案 CSV 导出目录是否在本机可写。
