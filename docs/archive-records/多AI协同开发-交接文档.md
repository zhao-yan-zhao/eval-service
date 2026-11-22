# 多 AI 协同开发流水线 · 交接文档（最终版）

> **给接手对话的话**：这是一份自包含施工包，无需任何背景上下文。目标——Kimi 统筹 + DeepSeek 写码 + Codex 审核，全自动并行循环；每晚 20:11 打包供人工验收；监控面板实时展示三方协同状态。按第 3 章顺序施工，能并行的并行。遇阻先查第 6 章排障表，解决不了请用户带着证据回主对话找 Kimi 迭代（第 7 章）。

---

## 1. 环境现状（2026-09-12 全部实测通过，勿重复安装）

| 组件 | 状态 | 关键信息 |
|---|---|---|
| DeepSeek API | ✅ 已验证 | Key 有效，余额充足（¥2500+）。写码模型 `deepseek-v4-pro`（推理型），轻活可用 `deepseek-flash` |
| aider 0.86.2 | ✅ 已验证写文件 | 装在 Kimi Work 托管 Python，调用方式 `python -m aider` |
| Codex CLI 0.154.0 | ✅ 已验证无头审核 | **已登录用户的 ChatGPT 订阅，零配置** |
| Node.js | ✅ | `C:\Program Files\nodejs`（Git Bash PATH 里没有，用全路径） |
| 监控 Widget | ✅ 已建好并验证 | **widgetId：`widget_174adf57-bb9b-4254-ae96-9fc5f69af776`**（多AI协同监控台），当前显示示例数据，属正常 |
| 密钥 | ✅ | `C:\Users\admin\Documents\kimi\workspace\ai-dev-pipeline\secrets.env`（已 gitignore。**禁止提交进任何仓库、禁止打印到对话/日志/交付物**，用 `source` 读环境变量） |

## 2. 命令速查（坑已排完，直接照抄）

**aider + DeepSeek 写码：**
```bash
set -a; source "/c/Users/admin/Documents/kimi/workspace/ai-dev-pipeline/secrets.env"; set +a
cd <任务worktree目录>
printf '/exit\n' | python -m aider \
  --model deepseek/deepseek-v4-pro \
  --message "<任务描述：需求、约束、完成标准一次说清>" \
  --yes-always
```
要点：`printf '/exit\n' |` 防挂起；git 仓库内 aider 自动提交；非 git 目录加 `--no-git`。

**Codex 无头审核：**
```bash
set -a; source "/c/Users/admin/Documents/kimi/workspace/ai-dev-pipeline/secrets.env"; set +a
export HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897   # K31：必须挂梯子，否则 websocket 被拒
"/c/Users/admin/AppData/Roaming/kimi-desktop/daimon-share/daimon/npm-global/codex" \
  exec --skip-git-repo-check --sandbox workspace-write "<审查提示词>" < /dev/null
```
要点：必须全路径调用；必须 `--skip-git-repo-check`；必须 `< /dev/null`；**必须先 export 127.0.0.1:7897 代理**（K31：owner 的梯子，自动化 shell 不继承交互终端的代理；连接被拒时 CLI 重连 5 次耗尽后整调用退避重试，勿判死）；提示词在 bash 里整体双引号包裹，**不要走 `cmd.exe //c`**（引号会被拆碎）；**默认用 `--sandbox workspace-write`**（K31：read-only 下审查员跑 python 验证会 tempdir 崩溃中断审核；workspace-write 下须叮嘱"只审不改"，git 可检测篡改）。

**中文编码坑**：Git Bash 里 curl 直接发中文 JSON 会报 unicode 错误。中文走 aider/Python，或写临时文件 `curl -d @file`。

## 3. 施工清单（按序，能并行则并行）

**前置——先向用户确认 4 件事**（若已给出则跳过）：① 项目路径（或从零新建：项目+技术栈）② 测试命令 ③ 打包命令 ④ 第一批任务

1. `source` 读密钥，按第 2 章复核 aider / codex 可用
2. 项目仓库初始化：`dev` 分支、`TASKS.md`、`LOG.md`、`FEEDBACK.md`、`releases/`；无测试则首派"补基础测试"任务
3. 把第一批需求拆成任务写入 `TASKS.md`，标注依赖关系（无依赖的标记可并行，最多 3 个并行）
4. **手动跑通一轮最小循环**：1 个任务走完 写码→测试→Codex 审→合并 dev，确认项目内链路通
5. 创建定时任务 A「开发循环」：local_conversation 类，cron `17 9,11,13,15,17,19 * * *`，时区 Asia/Shanghai，工作目录=项目仓库。任务指令=按第 4 章规则并行推进 TASKS.md
6. 创建定时任务 B「每日打包」：cron `11 20 * * *`，时区 Asia/Shanghai。任务指令=dev 快照打 tag（`v0.x.0-nightly.YYYYMMDD`）→构建+测试→产物进 `releases/`→生成 CHANGELOG→推送完成通知
7. **接入监控面板**（见第 5 章）：改造任务 A 输出状态 artifact + 创建 Binding
8. 向用户汇报：两个定时任务的触发时间、首轮循环结果、三种人工干预方式（直接说 / 项目根建 `PAUSE` 文件 / 写 `FEEDBACK.md`）

## 4. 循环规则摘要

- **并行**：最多 3 任务并行，每任务一个 `git worktree`；多 diff 同时送审；打回各自独立迭代；只有你判断改同一批文件才串行；打包与开发零阻塞
- **单任务生命周期**：领任务→aider 写码→跑测试（失败喂回修）→`git diff dev...HEAD` 送 Codex→通过合并 dev / 打回重写（**最多 3 轮熔断**）/ 涉删除或架构变更→暂停记 `LOG.md` 等人工，不阻塞其他任务
- **分支**：`main` 只收打包验证后的合并；`dev` 持续滚动；`task/*` 搞坏即弃
- **护栏**：DeepSeek 不碰 main；合并必须过审+过测试；DeepSeek 每日 token 预算 ¥10 上限，超限停循环并通知；全程 git + `LOG.md` 可追溯

## 5. 监控面板接入（widgetId 已定，照做即可）

1. 定时任务 A 每轮结束时，把当前状态整理成 artifact 输出，schema 须与 Widget `slots.main` 兼容：

```json
{
  "updatedAt": "2026-09-12 20:11",
  "kimi":     { "state": "waiting_review", "detail": "等待 Codex 审查结果" },
  "deepseek": { "state": "running", "running": 2, "waitingReview": 1, "detail": "2 个任务并行开发中" },
  "codex":    { "state": "running", "reviewing": 1, "rejectedWaiting": 1, "detail": "1 项审理进行中" },
  "events": [
    { "time": "16:32", "actor": "kimi", "kind": "dispatch_dev",
      "title": "派发开发任务 T-014 用户登录接口",
      "detail": "提示词：在 task/T-014 分支实现 /api/login，含参数校验与单元测试" },
    { "time": "16:41", "actor": "codex", "kind": "review_pass",
      "title": "T-011 审理通过", "detail": "交 Kimi 决策合并" }
  ]
}
```

字段取值约定：
- `kimi.state`：`running | dispatching | deciding | waiting_dev | waiting_review | idle | paused | blocked`
- `deepseek.state` / `codex.state`：`running | idle | error`
- `deepseek.running`=并行开发中数；`deepseek.waitingReview`=已完成待送审数
- `codex.reviewing`=审理中数；`codex.rejectedWaiting`=不通过待二次审理数
- `events`：最近约 20 条，`actor`=`kimi|deepseek|codex`，`kind`=`dispatch_dev|dispatch_review|decision|dev_done|review_pass|review_fail|escalate|notice`

2. 用 Binding 工具创建 `automation_widget` 绑定：automationId=任务 A，widgetId=`widget_174adf57-bb9b-4254-ae96-9fc5f69af776`。之后每轮循环结束面板自动刷新。
3. 验证：跑一次任务 A，用 `Widget.read` 确认 `latestData` 已送达，面板左上角变为"已接入流水线数据"。

## 6. 排障速查

| 症状 | 原因与处理 |
|---|---|
| `codex: command not found` | 没走全路径，见第 2 章 |
| codex 挂起无输出 | 少了 `< /dev/null` |
| codex 报 not inside trusted directory | 少了 `--skip-git-repo-check` |
| codex 提示词被拆成多段报错 | 走了 `cmd.exe //c`，改 bash 直接调全路径 |
| aider 跑完不退出 | 少了 `printf '/exit\n' \|` |
| curl 发中文报 unicode 错误 | 见第 2 章编码坑 |
| DeepSeek 报余额不足/鉴权失败 | 让用户检查 Key 是否已轮换（旧 Key 曾明文出现在聊天中）；新 Key 更新 `secrets.env` 即可 |
| 监控面板一直是示例数据 | 任务 A 未输出兼容 artifact 或 Binding 未建/未验证，按第 5 章核查 |

## 7. 迭代回路

使用过程中任何解决不了的问题，请用户回主对话找 Kimi，并尽量带上：
1. 报错原文或异常现象截图/文本 2. 出问题的是哪一环（写码/审核/定时任务/打包/监控）3. `LOG.md` 里最近几条记录。

## 8. 相关文件

- 本交接文档：`C:\Users\admin\Documents\kimi\workspace\多AI协同开发-交接文档.md`（以此为准）
- 设计方案：`C:\Users\admin\Documents\kimi\workspace\多AI协同开发方案.md`（背景参考）
- 密钥配置：`C:\Users\admin\Documents\kimi\workspace\ai-dev-pipeline\secrets.env`
- 冒烟测试残留：`C:\Users\admin\Documents\kimi\workspace\ai-dev-pipeline\smoke\`（可删）
