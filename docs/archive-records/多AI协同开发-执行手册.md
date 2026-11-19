# 多 AI 协同开发流水线 · 执行手册

> 这份文件是完整交接包。拿到它的对话（AI）无需再问背景，直接按"执行清单"施工。
> 用户目标：**Kimi 统筹 + DeepSeek 写码 + Codex 审核，全自动互相调用，全面并行；人只在想干预时干预；每晚 20:11 打包一个版本供人工验收，验收与开发并行不互相阻塞。**

---

## 1. 环境现状（已于 2026-09-12 实测验证，勿重复安装）

| 组件 | 状态 | 说明 |
|---|---|---|
| DeepSeek API | ✅ 已验证 | Key 有效，余额 ¥2556.90。模型：`deepseek-v4-pro`（写码主力，推理型）、`deepseek-flash`（便宜，跑轻活） |
| aider 0.86.2 | ✅ 已验证 | 装在 Kimi Work 托管 Python 里，用 `python -m aider` 调用；已实测成功创建文件，单次约 $0.001 |
| Codex CLI 0.154.0 | ✅ 已验证 | **已用 ChatGPT 订阅登录**，无需任何配置；已实测无头审核成功 |
| Node.js | ✅ | `C:\Program Files\nodejs`（Git Bash 里不在 PATH，用全路径） |
| API Key 存放 | ✅ | `C:\Users\admin\Documents\kimi\workspace\ai-dev-pipeline\secrets.env`（已被同目录 `.gitignore` 排除，**禁止提交进任何 git 仓库，禁止把 Key 打印到对话/日志/交付物里**） |

## 2. 已踩过的坑（执行时直接照抄，别重新踩）

**Codex 无头审核的调用姿势（三个坑都已排掉）：**
```bash
"/c/Users/admin/AppData/Roaming/kimi-desktop/daimon-share/daimon/npm-global/codex" \
  exec --skip-git-repo-check --sandbox read-only "审查提示词" < /dev/null
```
- 必须用全路径（Git Bash PATH 里没有 codex）
- 必须加 `--skip-git-repo-check`，否则非信任目录报错
- 必须从 `< /dev/null` 喂 stdin，否则挂起等待输入
- 提示词整体用双引号包裹传给 bash，**不要走 `cmd.exe //c`**（引号会被拆碎）
- 审查产物用 `--sandbox read-only`；要让它跑测试再用 `--sandbox workspace-write`

**aider + DeepSeek 写码的调用姿势：**
```bash
set -a; source "/c/Users/admin/Documents/kimi/workspace/ai-dev-pipeline/secrets.env"; set +a
cd <任务worktree目录>
printf '/exit\n' | python -m aider \
  --model deepseek/deepseek-v4-pro \
  --message "<任务描述，要求明确具体>" \
  --yes-always
```
- 用 `printf '/exit\n' |` 喂 stdin，跑完自动退出不挂起
- 仓库内运行时让 aider 自动 git 提交（默认行为）；非 git 目录加 `--no-git`
- DeepSeek 是推理型模型，prompt 要一次说清需求、约束、完成标准

**中文编码坑：** Git Bash 里 `curl` 直接发含中文的 JSON 会报 unicode 错误。中文内容走 aider/Python 发，或先写临时文件再 `curl -d @file`。

## 3. 流水线设计（已定稿，直接实施）

### 3.1 角色与原则
- **统筹**：Kimi Work（你自己）。拆任务、判依赖、驱动循环、读 FEEDBACK.md、分歧升级给人
- **写码**：DeepSeek API（经 aider） **审核**：Codex CLI。两者上下文完全隔离，禁止自审
- **最高原则：一切无依赖的环节并行，串行只存在于真实依赖点**

### 3.2 并行规则
- 最多 **3 个任务并行**，每个任务一个 `git worktree`（独立目录+分支），互不污染
- 多分支 diff **同时**送审；被打回的各自独立迭代，互不等待
- 只有你判断两任务改同一批文件时才降级串行
- 每晚打包跑在 dev 快照上，与开发循环零阻塞

### 3.3 开发-审核循环（每个任务的生命周期）
1. 从 `TASKS.md` 取任务 → 建 `task/<编号>-<名>` worktree
2. aider(DeepSeek) 实现并自动提交 → 跑项目测试命令，失败则报错喂回修
3. `git diff dev...HEAD` 送 Codex 无头审查（read-only）
4. 裁决：通过→合并进 `dev`；打回→意见喂回 DeepSeek 重写（**单任务最多 3 轮**）；3 轮不收敛或涉删除/架构变更→暂停该任务记入 `LOG.md` 等人裁决，**不阻塞其他并行任务**
5. 每轮结果追加 `LOG.md`（时间、任务、结论、token 成本）

### 3.4 分支模型
```
main     只接受每晚打包验证后的合并，永远可测
dev      审核通过的代码持续汇入，开发永不停
task/*   每任务独立 worktree 分支，搞坏即弃
每晚打包 = dev 打快照 tag（v0.x.0-nightly.YYYYMMDD）→ 构建 → 产物进 releases/<版本>/
```

### 3.5 每日打包（定时任务 2，cron `11 20 * * *`，时区 Asia/Shanghai）
dev 快照打 tag → 跑完整构建+测试 → 产物输出 `releases/` → 生成 CHANGELOG（当日合并任务、审核记录、已知问题）→ 推送桌面通知

### 3.6 人工干预三通道
- 直接对话说 → 立即生效
- 项目根建 `PAUSE` 文件 → 下轮起暂停开发循环（打包除外）
- 写 `FEEDBACK.md` → 验收意见/bug/优先级调整，下轮**优先**转成任务

### 3.7 安全护栏
- DeepSeek 只写 task 分支；合并必须过 Codex 审核 + 测试
- 删除/架构/CI 级变更一律升级人工
- 单任务 3 轮熔断；DeepSeek 每日 token 预算上限（建议 ¥10/天，超限停循环并通知）
- 全程 git 可追溯 + LOG.md 审计

## 4. 执行清单（按序施工，能并行的并行）

**前置：向用户确认 4 件事（若本轮消息已给出则跳过）**
1. 项目路径（现有仓库）或从零新建（项目+技术栈） 2. 测试命令 3. 打包命令 4. 第一批任务

**施工步骤**
1. 读 `secrets.env` 获取 DEEPSEEK_API_KEY，复核 aider / codex 可用（命令见第 2 节）
2. 在项目仓库初始化：`dev` 分支、`TASKS.md`、`LOG.md`、`FEEDBACK.md`、`releases/`、`.gitignore` 增补；无测试则先派"补基础测试"任务
3. 把用户的第一批需求拆成任务写入 `TASKS.md`（标注依赖关系，可并行的标出来）
4. **手动跑通一轮最小循环**（1 个任务：写码→测试→Codex 审→合并 dev），确认项目内链路通
5. 创建定时任务 1「开发循环」：local_conversation 类定时任务，cron `17 9,11,13,15,17,19 * * *`（Asia/Shanghai），工作目录=项目仓库，指令=按 3.3 节并行推进 TASKS.md 中的任务
6. 创建定时任务 2「每日打包」：cron `11 20 * * *`（Asia/Shanghai），指令=按 3.5 节打包并发完成通知
7. 向用户汇报：两个任务的触发时间、第一轮循环结果、如何干预

## 5. 相关文件
- 完整设计方案：`C:\Users\admin\Documents\kimi\workspace\多AI协同开发方案.md`
- 密钥与模型配置：`C:\Users\admin\Documents\kimi\workspace\ai-dev-pipeline\secrets.env`
- 冒烟测试残留证据：`C:\Users\admin\Documents\kimi\workspace\ai-dev-pipeline\smoke\`（可删）

## 6. 备忘
- DeepSeek Key 曾在聊天中明文出现，已提醒用户轮换；轮换后只需更新 `secrets.env` 一行
- Codex 审核每次约消耗几千 token 的订阅额度，属正常
