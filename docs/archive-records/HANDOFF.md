# F1-AI 当前交接快照

> 本文件是唯一“当前运行态”入口；`进度看板.md`、`进度追踪表.md` 和历史 `runs/*` 仅作历史证据，发生冲突时先以本文件和 Git 事实为准。每个可恢复节点更新，禁止写成长流水账。
> 验收真源：仓库根目录 `验收矩阵.md`（A1–A16，2026-08-19 建仓；只有 MACHINE_PASS 计入闭合，测试数不替代验收状态）。

## 当前复核（2026-09-11 晚，优先于下方所有快照）

- **R2B/A14 R3 二轮独立复审未过**：候选 HEAD `406278f` 仍不可合入。复审确认 ASCII `Mine/Other` 共享动作与 `Twin` 重名的原始复现已在 facade 写 Lua 前挡住，六项历史锁红的实际运行语义也有效；但发现两项 P1：① 真实 `ToolInvocationService` 链未在 intent/备份/sentinel 前执行 event guard，拒绝会降级为 `core_invoke_failed` 并进入 recovery；② C# 的直接 `OrdinalIgnoreCase` 未复刻 F1 `LuaEvent` 当前文化 `ToLower()` 后再比较的语义，zh-CN 下 `i` / `İ` 可规划一个事件、实际写另一个后仍报 upserted。另有 `2d9adee` / `42fc539` git-show archive 注释转码损坏，需无损补证。完整裁决：`reviews/independent-r2b-r3-20260911.md`。
- **Owner 已授权一次窄返修（2026-09-11）**：只覆盖上项 P1、ObjectID 大小写代理、两份 git-show 留档无损补证及 solution 门禁的如实复测；执行工单为 `FINAL-BATCH-R2B-R3.1-A14-Owner授权P1收口-Cursor工单-20260911.md`。这不是 R4，不自动开启第三轮审查，也不改变“候选不可合入”的当前裁决。此前执行端 10/38/49/977 与 AllInOne csproj 0 错误仅是执行证据，不能抵消本裁决；完整 `F1-AllInOne.sln` 仍因外部项目资产/BasicDevTool copy 失败，不能写成 solution 已绿。
- R3 知识与本轮复审增量已汇入根 `runs/knowledge.md`。未合入、未灌装、未升 MACHINE_PASS；集成 HEAD 仍 be51696。
- **新支线登记（2026-09-11 晚）**：Owner 立项"体系推演实验控制台"（奇正大赛复赛战法开发演示，5 天窗口）。开工底稿 `体系推演实验控制台-五天开工底稿-20260911.md`、设计复审提示词 `体系推演实验控制台-设计复审提示词-20260911.md` 已落盘，均待 Owner 派发/拍板；与 R2B/R2C 线隔离（新 worktree、稳定基线）。

## 当前复核（2026-09-11，优先于下方快照）

- Cursor B 的 R2B 补证已收到；HEAD a34ad8f 不变，生产/测试源码无本轮改动，NuGet 离线路径已修复。Codex 亲跑具名 28/28、相关 39/39、正常本机权限全量 967/967、AllInOne 0 错误/1138 警告。沙箱首轮 38 项环境失败日志保留，正常权限未复现。
- 状态：R2B 自动回归复核通过，但独立定点审查已判定“返修后再审”：共享保留 action 可跨事件被原地改写、同名事件可造成 first/last API 拆写；另三组历史真实锁红仍缺。R3 窄返修工单已备，未合入、未灌装、未升 A14 MACHINE_PASS。
- 记录：`CONTINUE-R2B-20260911-监理复核记录.md`、`reviews/independent-r2b-20260911.md`；R3 执行入口：`FINAL-BATCH-R2B-R3-A14共享动作与同名事件守卫-Cursor工单-20260911.md`。Cursor B 旧知识已核证汇入根 `runs/knowledge.md`；R3 知识待执行端回传后再汇总。
- 集成 HEAD 仍 be51696；本轮未收到/核验 R2C 最新完事报告，不将 R2B 通过等同 R2C 通过。

## 接管快照（2026-09-09）

- 当前阶段：稳定单 AI 版联调收尾。集成 `D:\soft\F1-AI-integration` @ `be51696` 已合入 R2A；R2B `a34ad8f` 与 R2C `e15c8a3` 尚未合入。主目录 demo 代码不施工。
- Owner 要求提供可同时执行的 Cursor 工单并记录知识。两份工单：`CONTINUE-R2B-20260909-Cursor提示词.md`（A14 补证/测试补强）、`CONTINUE-R2C-20260909-Cursor提示词.md`（A9 R1 补证/测试补强）；公共约束 `CONTINUE-20260909-并行执行公共约束.md`。状态为提示词已备、待 Owner 粘贴启动，未自动派发。
- R2C 历史执行日志：14 具名/93 相关/980 全量通过，AllInOne 0 错误；尚未在本次会话亲跑。测试替身与真实宿主行为需分层核证，不能直接宣告 A9 关门。
- A1/A3 已有 9 月 4 日 Owner 通过报告（口述+日志，无截图）；旧验收矩阵未同步。下方旧版“专机未开始”和 V2.x/S6/摘要未实现的说法均不可直接当作今天结论。
- 中央 HANDOFF/知识由 Codex 单写，Cursor 各写本工作区知识增量；下次接管先读 `CONTINUE-20260909-接管与任务记录.md` 和本块，再核对 Git。
- 后续：补证 → 按需窄返修 → 独立审查与监理复核 → 串行集成回归 → 新候选真机验收。当前不启动 F1、不合入/灌装、不改生产数据。

## 历史目标（2026-08，保留上下文，不代表当前状态）

1. **黄金链路返修合同已整体关闭（2026-08-20，Stage 0–5 全闭环，sol 终审 5/5 Pass，L1 604/604）**。返修期禁令解除，项目进入**联调终验阶段**。
2. 联调终验任务书：`runs/联调终验任务书.md`（L0 准备 → L1 真模型烟测 → L2 黄金链路真机联调 → L3 专机点验包 → L4 lucas 毕业考）。
3. **V2.1 查询补齐：executor 亲跑过门，待监理复核 + sol 审**（worktree `D:\soft\F1-AI-v21`，分支 `wip/v2.1-query-tools`，HEAD `41c5202`）。生产 Core Implemented：原 8 + 4 只读 = **12**（`contact.query` / `unit.status` / `referencepoint.list` / `area.query`）。Registry 目录 **16** 件。executor 亲跑：全量 L1 **611/611**、AllInOne Debug x64 **0 错误**。UI 口述一致验收仍待专机。
4. **L4 预审 NO-GO**（`reviews/sol-lucas-l4-gate-20260820.md`）：V2.2–V2.4 建场/写路径仍未实现；S6 三条 P0 旁路待治理。题面分母已拍板甲（15 条）。
5. executor 分工不变：cursor 写码、监理（Kimi）亲验、luna/sol 分级审查。

## Git 基线

- 主工作区：`D:\soft\F1-AI`（`night-soak` 等并行线）；**V2.1 施工 worktree**：`D:\soft\F1-AI-v21` → `wip/v2.1-query-tools` @ `41c5202`。
- WIP：`a30fddb` contact.query · `3141f80` unit.status · `775b682` referencepoint.list+area.query · `41c5202` catalog 12→16。
- Stage 5 关闭于 `dc21a2a`；`main` = `585936f`（冻结）；`origin/main` 仍为 `31905f3`，推 main 待 owner 单独拍板。
- 新对话必须以 `git status --short --branch` 为准；禁止 `git add -A`，提交前逐文件核对。

### 接管前已存在、不得混入新任务的工作区内容

- `runs/F04.2-R-S1/load-armed-probe.last.txt`、`shown-armed-probe.last.txt`（永不提交）
- `runs/F04.3-实现授权方案.md`、`runs/F04.5-实现授权方案.md`、`变更记录.md`（用户文档改动，保留不提交）
- `backup/`（永不提交）
- `runs/T05.6-20260818-*/`、`runs/night-soak-*/`、`runs/_v21-*.txt`（运行证据目录，暂不提交）

## 返修背景（2026-08-19）

- Codex 期间产出：真实 `RunAsync`、Pause/Resume/Cancel、生产装配/UI bridge、T07.8/T08.4/T08.5 测试；当时 538/538、AllInOne 0 错。
- 独立审查确认 11 项上线阻断：严格 tool_calls 序列缺失、工具长持锁、Pause Stop 异常、MaxRounds/timeout 未固化、模型上下文不持久、Resume 非原子、Dispose 竞态、baseline ABA、重启接管缺失、锁快照不一致、Bridge 同步重 I/O。逐条见返修合同。
- S6 自动扫描已发现白名单外场景保存/切换/Lua 新建旁路；S6 治理为**独立高风险片，不混入本返修**；豁免 `HostScenarioReloader` 补偿恢复路径。

## 下一步

1. **V2.1 已合并回 night-soak**（2026-08-23）：四只读工具（contact.query / unit.status / referencepoint.list / area.query）进主线。待：监理亲跑全量 L1 + AllInOne → 重编 F1.exe（三合一：V2.1 + 甲工单收尾纪律 + game-resolution 换算）→ 专机复验（一发 30 分钟仿真验 sim_failed 恢复/时钟换算/收尾纪律 + D 步口述态势重跑）。
2. **P1 加固批**（已立项 `runs/P0-热修加固单-20260823.md`）：tool_call ID 单射消毒 + 熔断指纹稳定分类；换算工单 `runs/P1-game-resolution-换算工单.md`（cursor 在途）。
3. **V2.2 写工具**：V2.1 专机过门后开工，第一轮 unit.add（v22 worktree `wip/v2.2-structure-tools`，乙裁定后基线 614/614 已恢复）。
4. **联调终验 L1–L3 + A1–A16**（等 owner 定专机窗口）：按 `runs/联调终验任务书.md` 执行，注意 sol 预审漏项（A9 抽检、A6 中断残留、A13 强制触发上限、A14 强制制造脚本错误）。点验单模板已加「第 0 步：报工具目录」。
5. **待 owner 拍板**：① lucas L10 阈值=KnownClass；② 6252（MFI-17）题面角色；③ lucas 题面分母口径（实际 15 条 vs 文档 17 条）。
6. **L4 毕业考**：以上闭合后按 sol 修订版 gate 准入。

## 新对话启动顺序

1. 读本文件。
2. `git status --short --branch` 与 `git log --oneline -3`。
3. 读返修合同与当前阶段相关 diff；不通读历史 review-pack。
4. 跨模块合入前跑全量 L1。
5. 结束前更新本文件的基线、进展和下一步。
