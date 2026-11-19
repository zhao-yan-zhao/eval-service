# FINAL-A1-R2：a1r5 界面响应 Owner 复验报告

日期：2026-09-04  
角色：Cursor 只读取证（未控制 Owner 窗口、未代点、未自动输入）

## 1. 版本门

| 项 | 结果 |
|---|---|
| 运行包 | `D:\soft\F1-AI-runtime-4d93828-a1r5` 存在 |
| Manifest | `RUNTIME-MANIFEST-4d93828.txt` 已逐字读取 |
| 源 HEAD | `4d93828a87c17ef01205ab69ae00be075ed9aa90` |
| 源 commit | `final-a1-r1 WIP: coalesce streaming UI refreshes` |
| `F1.dll` SHA-256（实测） | `5927B3D5FCB958D958C110F55BEBFC6355D7CBF2D400037BA21E6D5213569465` |
| Manifest 期望 SHA-256 | 同上，一致 |
| `WritableRoot.txt` | `D:\soft\F1\F1-测试` |
| 复验时 F1 进程 | PID `28608` → `D:\soft\F1-AI-runtime-4d93828-a1r5\F1.exe` |

版本门通过。未使用 a1r4 或其他旧候选代测。

## 2. Owner 三项口述（逐字）

Owner 原话：`顺畅，无乱码，完整结束`

对照提示词三项拆解：

| 项 | Owner 口述 |
|---|---|
| 流式期间窗口/地图 | 顺畅 |
| 中文是否逐步出现且无乱码 | 无乱码（结合“完整结束”，按通过口径记录；Owner 未另述“逐步”二字，但未报告整段一次性出现或乱码） |
| 最终回复是否完整结束 | 完整结束 |

## 3. 截图

- 证据目录已准备：`D:\soft\F1-AI\runs\final-a1-r2-20260904\`
- **未收到 Owner 提供的 AI 面板截图**；Desktop / Pictures / Screenshots 近 2 小时内亦未找到可归属本轮的面板图。
- 因此本报告无截图路径、无截图 SHA-256。

## 4. 会话日志摘要（只读）

- 日志路径：`D:\soft\F1\F1-测试\data\chat-stream-diag.log`
- 文件 mtime：2026-09-04 09:08:51（本地）
- 最近一次 `send start`（UTC）：`2026-09-04T01:08:42.5616928Z`
  - `profile=preset-deepseek model=deepseek-v4-flash len=109`
- 该次发送事件计数：
  - `TextDelta`：**512**
  - `Completed`：**1**
  - Fault / FinishFault：**0**
- 终态：`FinishCompleted len=887`（UTC `2026-09-04T01:08:51.5166287Z`）
- `stream loop ended cancelled=False`

结论：本次会话存在连续 TextDelta，并以一次 Completed 正常收束；真 SSE 流式未降级为“收完整篇再显示”的静默缓存形态（日志仍逐事件记录 TextDelta）。

未输出 API Key；未修改数据库；未恢复/覆盖 `assistant.db`。

## 5. 判定

| 项 | 判定 | 依据 |
|---|---|---|
| **A1** | **通过** | Owner 口述“顺畅”；不符合“连续数秒无法拖动/必须等回复结束才恢复”的失败口径 |
| **A3** | **通过** | Owner 口述“无乱码”“完整结束”；日志 `FinishCompleted len=887` 且 `cancelled=False` |

未自动进入 A2 / A4 / A12 / A16。未 push / tag / commit。

## 6. 待确认 / 缺口

- Owner 未交付本轮 AI 面板截图；若监理要求图证补齐，需 Owner 补传一张完整面板图后再补记路径与 SHA-256。
