# FINAL-A1-A3-R1：面板响应与中文流式 Owner 手测报告

> 日期：2026-09-03（Asia/Shanghai）  
> 工单：`D:\soft\F1-AI\FINAL-A1-A3-R1-面板响应与中文流式Owner手测-Cursor提示词-20260903.md`  
> 性质：Owner 手测 + Cursor 只读旁观取证。未控制鼠标/键盘/窗口；未改配置、数据库、源码、想定或验收矩阵；未输出 API Key；本轮完成后停手，不启动 A2/A4/A12/A16。

---

## 1. 结论（大白话）

| 项 | 结果 |
|---|---|
| **A1 面板响应** | **失败** |
| **A3 中文流式** | **通过** |

- Owner 回报：文字是**逐步出现**的；中文**无乱码**；但回复生成期间**无法拖动地图、也无法拖动窗口**。
- 因此：流式显示和中文显示达标；“AI 回复时主界面仍能点、能拖”不达标。
- 本对话未附带截图文件；以 Owner 文字观察为准。若监理需要补图，可由 Owner 另补一张完整 AI 面板图。

---

## 2. 现场与模型（不含密钥）

| 项 | 值 |
|---|---|
| F1 进程 | PID `3996`，路径 `D:\soft\F1-AI-runtime-26effb3-a1r4\F1.exe`，启动约 `2026-09-03 18:42:43` |
| WritableRoot | `D:\soft\F1\F1-测试` |
| 当前模型源（profile） | `preset-deepseek`（DeepSeek 官方） |
| 当前模型名 | `deepseek-v4-flash` |
| BaseUrl（公开配置） | `https://api.deepseek.com/v1` |
| 聊天会话 | `e21a0bdd729e40ba85699a3de6fdcfb7`（面板打开约 `19:09:41` 本地 / `11:09:41Z`） |

密钥未读取、未输出。

---

## 3. Owner 观察原文要点

1. 文字：**逐步出现**（不是最后一次性弹出）。
2. 中文：**无乱码**。
3. 回复期间：地图拖动、窗口拖动均**不行**（A1 失败点）。
4. 未报告面板花屏或崩溃。

操作口径符合工单：普通聊天发送，不创建任务、不点“执行任务”。

---

## 4. 只读日志核对

### 4.1 流式证据（支持 A3）

路径：`D:\soft\F1\F1-测试\data\chat-stream-diag.log`  
（文件更新时间约 `2026-09-03 19:11:09`）

同一测试窗口内，同一提示词长度 `len=109` 共出现 **3 次** `send start`（均完成，非取消）：

| 本地约时（UTC+8） | UTC 日志 | 结果 |
|---|---|---|
| 19:09:46 | `11:09:46Z` send → `11:09:54Z` FinishCompleted **len=415** | 流式完成 |
| 19:10:21 | `11:10:21Z` send → `11:10:29Z` FinishCompleted **len=715** | 流式完成 |
| 19:11:03 | `11:11:03Z` send → `11:11:09Z` FinishCompleted **len=877** | 流式完成 |

要点：

- 每次均为 `profile=preset-deepseek model=deepseek-v4-flash`。
- 过程中大量 `ev kind=TextDelta`（窗口内合计约 1188 条），并有 `Usage` / `Completed`；`stream loop ended cancelled=False`。
- `fault=-`，未见流式故障码。
- 与 Owner“逐步出现”一致；日志层面也是增量 delta，不是单包整篇吐出。

说明：日志显示同文提示被发送了三次。报告按 Owner 最终观察记账；不因多次发送改判 A3。

### 4.2 面板绑定

路径：`D:\soft\F1\F1-测试\Logs\ai-assistant-init.log`

- `2026-09-03T11:09:40Z` 起：面板 click → shown → `BindProductionRuntime committed enabled=True`。
- 与本轮打开 AI 助手时间吻合；未见本轮新的绑定失败。

### 4.3 异常 / 乱码 / 卡死

- **乱码**：Owner 目视无乱码；流式日志无编码 fault。库内消息用控制台读时有编码显示问题，属取证终端代码页，不代表面板乱码。
- **花屏/崩溃**：Owner 未报告；今日 ExceptionLog 未见与本轮聊天流式直接相关的 UI 崩溃栈。
- **卡死（A1）**：Owner 明确回复期间地图与窗口不可拖动 → **判 A1 失败**。只读日志无法直接证明 UI 线程阻塞，但用户可见行为已足够按工单失败标准落锤。

### 4.4 相关只读路径汇总

| 用途 | 路径 |
|---|---|
| 流式诊断 | `D:\soft\F1\F1-测试\data\chat-stream-diag.log` |
| 面板初始化 | `D:\soft\F1\F1-测试\Logs\ai-assistant-init.log` |
| Provider 诊断（历史为主） | `D:\soft\F1\F1-测试\Logs\ai-provider-diag.log` |
| 当日异常日志 | `D:\soft\F1\F1-测试\Logs\ExceptionLog_2026_09_03.txt` |
| 运行库（只读查阅） | `D:\soft\F1\F1-测试\data\assistant.db` |
| 本轮探针脚本（临时） | `D:\soft\F1-AI\runs\_a1a3_r1_readonly_probe.py` |
| Owner 截图 | **本对话未提供文件路径** |

---

## 5. 分项判定说明

### A1 面板响应 — 失败

工单要求：AI 回复期间，F1 主地图仍能点击、拖动，不能整窗卡死。  
Owner：回复期间无法拖动地图、无法拖动窗口。  
→ **失败**。

### A3 中文流式 — 通过

工单要求：逐步出现；中文不乱码；面板不花屏。  
Owner：逐步出现、无乱码；未报花屏。日志有连续 TextDelta 并正常 Completed。  
→ **通过**。

---

## 6. 纪律与停手

- 未操控 F1 UI；未改 WritableRoot / 模型配置 / 库 / 想定 / 源码 / 验收矩阵。
- 未输出任何 API Key / secret_ref 明文。
- **本轮结束，停手。不自动开始 A2 / A4 / A12 / A16。**
- A1 失败后的返修或重测，等监理另开单。
