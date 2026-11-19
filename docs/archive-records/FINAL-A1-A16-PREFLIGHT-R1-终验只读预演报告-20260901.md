# FINAL-A1-A16-PREFLIGHT-R1：终验只读预演报告

> 生成：2026-09-01（Asia/Shanghai）  
> 性质：只读预演。**未**启动正式 A1–A16，**未**改 `验收矩阵.md` / 源码 / 测试，**未**把任何项写成 `MACHINE_PASS`，**未** commit / tag / push。  
> 工作区核验：`D:\soft\F1-AI-integration` / `integration/stable-single-ai` / `a0e56757d2ff7da8cda2addbce02c4cb3f4e8643`

---

## 0. 结论先行

### 0.1 能否进入正式终验？

**暂不能按“全量 A1–A16 正式销项”开跑。** 可先做 L0 准备 + 部分无密钥依赖的专机点验预热，但 **L1 真模型烟测与 L2 黄金链路** 仍被最少阻断卡住。

### 0.2 最少阻断条件（进 L1 前必须清）

| # | 阻断 | 责任 | 清法 |
|---|---|---|---|
| B1 | DeepSeek / 量界 **真实 key 是否可用**仍未专机连通 | owner | 备好 key；正式终验日在设置面板测连通（本预演**禁止**试真实 key） |
| B2 | **专机时间窗**未约定 | owner | 定半天–1 天窗口；窗口内优先 F1-AI |
| B3 | **HACM 外线隔离**未落窗口纪律 | owner+监理 | 窗口内停 HACM；考试/联调加载确认用 `DB3K_515.db3` 原版，勿被 `DB3K_515_IndiaMissiles_*` / `HACM_Modified.db3` 顶包 |
| B4 | 飞机 `unit.add`+`course` 真机探针 **未出正式结论**（`STABLE-R3-A1-R2` 仅有取证草稿目录，无结案报告） | 探针执行方 | 探针结案 **或** owner 拍板：L2 建场步骤改用舰船/先加后 `unit.update_position`，飞机 course 单独立项不挡 L1 |
| B5 | **A14 能力口径**与历史任务书冲突（见 §5）：生产 **无自由 Lua 工具**，仅有 `event.upsert` 白名单动作 + 静态知识包 | owner | 见 §3 拍板选项；未拍板前 L2-6 不得按“自由生成任意 Lua”执行 |
| B6 | 启动路径版本门：必须只从候选 `D:\soft\F1-AI-integration\F1\F1.exe` 启动并核 `F1.dll`+binlog | 执行人 | 见 §4；不符立即停 |

进 **L4 lucas 毕业考** 另有更严 gate（矩阵非豁免项须 `MACHINE_PASS`、S6 旁路、L10 枚举拍板等）——本预演**不启动毕业考**，仅登记入口哈希。

### 0.3 矩阵机械现状（未改表）

- `MACHINE_PASS`：**0 / 16**
- `AUTO_VERIFIED`：9（A1/A3/A6/A7/A8/A9/A11/A13/A16）
- `IN_PROGRESS`：7（A2/A4/A5/A10/A12/A14/A15）

---

## 1. 当前候选与版本门

| 项 | 值 | 本轮核验 |
|---|---|---|
| 工作区 | `D:\soft\F1-AI-integration` | 是 |
| 分支 | `integration/stable-single-ai` | 是 |
| HEAD | `a0e56757d2ff7da8cda2addbce02c4cb3f4e8643` | 是 |
| `F1.exe` SHA-256 | `117BDC5E8564D7EE6C3CA9E234C8C8F18AE187476D4982938D149762DBA9D2F3` | 重算一致 |
| `F1.dll` SHA-256 | `6F37EB0C9E006B3CE98C2B1152F6B479A1E4E1FCE6D19A2ECE17B69C8FE1AC12` | 重算一致 |
| binlog | `runs\stable-r3-a0e5675-allinone-rebuild.binlog` → `A4C8A907DE079409F53919643FE4A27F8EC57F069C0F7A36330DE69FB7EDD782` | 重算一致 |
| `WritableRoot.txt` | `D:\soft\F1\F1-测试` | 文件存在 |
| 清单真源 | `D:\soft\F1-AI\STABLE-R3-a0e5675-最终候选运行清单-20260901.md` | 已读 |

**隔离铁律（照抄）：**

1. 只启动 `D:\soft\F1-AI-integration\F1\F1.exe`。  
2. **禁止**用 `D:\soft\F1-AI\F1` 旧专机二进制继续取证。  
3. 启动前重算 `F1.dll` 与 binlog；任一不符 → **立即停工**。  
4. 启动后记录进程真实 Path，必须落在 `D:\soft\F1-AI-integration\F1`。  
5. `F1.exe` 薄启动器哈希可能跨候选不变；**版本门以 `F1.dll`+binlog 为准**。

**生产 Core 已实现工具（16，磁盘证据）：**  
`scenario.get_summary` / `contact.query` / `unit.status` / `referencepoint.list` / `area.query` / **`unit.add`** / `unit.update_position` / `doctrine.set` / `mission.create_or_update` / `event.upsert` / `scenario.save` / `simulation.run` / `simulation.stop` / `simulation.status` / `result.read` / `db3k.search`  
出处：`CoreF1AutomationFacade.cs` `Implemented` HashSet。  
稳定版 `unit.add`：**仅 Aircraft / Ship**；Facility 明确拒绝（`unit_add_facility_not_supported`）。

---

## 2. 环境与数据门（只读）

### 2.1 模型三源配置入口（严禁读/打/写真实密钥）

| 源 | 配置入口 | 默认/占位（非密钥） | 本轮状态 |
|---|---|---|---|
| 本地 Ollama | 设置面板 · `preset-ollama` | BaseUrl **空默认**；占位 `http://<远程IP>:11434/v1`；历史实测文档写过 LAN `http://192.168.1.59:11434/v1`（**待确认是否仍为生产地址**） | 入口具备；生产地址待确认 |
| DeepSeek | `preset-deepseek` | `https://api.deepseek.com/v1`，模型名默认 `deepseek-v4-flash`；密钥 DPAPI/`secret_ref` | 入口具备；**连通未实测** |
| 量界智算 | `preset-liangjie` | BaseUrl/Model 默认空，靠用户填写；密钥同左 | 入口具备；**地址与连通待确认** |

代码入口：`ProviderPresetCatalog.cs`、`ProviderProfileService`、设置面板 UI seams。  
外网首切文案（A16）：固定提醒 + 确认对话框文案已在 catalog 中。

### 2.2 想定 / DB / DBID

| 资源 | 路径 | 状态 |
|---|---|---|
| WritableRoot | `D:\soft\F1\F1-测试` | 与候选 exe 旁白一致 |
| 考试库 `DB3K_515.db3` | `D:\soft\F1\F1-测试\DB\DB3K_515.db3`（约 60,182,528；历史核查 SHA `D398E5B1…73EDB39`） | 存在 |
| 危险顶包 | 同目录 `DB3K_515_IndiaMissiles_20260722-2131.db3`、`HACM_Modified.db3` 等 | **存在；专机必须确认加载原版 515** |
| `HACM_Modified.db3k` | 按规则应优先引用 | **未找到**（仅有 `.db3`） |
| 日常小测想定 | `D:\soft\F1\F1-测试\Scenarios\` 及 `...\lucas\` 下多份 `打击lucas-*` | 存在；L2 建议用**可丢弃工作副本**，勿覆盖正式路径 |
| lucas 题包 | `D:\soft\F1-AI-integration\acceptance\lucas\` | 存在（4 文件，见下） |

**题包哈希入口（不得启动毕业考）：**

| 文件 | 大小 | SHA-256 |
|---|---:|---|
| `打击lucas-3-7-cusor-红方任务制-巡逻侦察与对地打击.xml1-空想定-测试AI.scen` | 47910 | `efe685f9f245da9b37d2a4214487a17b9631ef38a4daaa553ed531d391c3a151` |
| `打击lucas-想定生成测试题.md` | 12829 | `edda1808c2b93d45411ec7e1ad7dd5f24d9d65dbcaed46b6fadb2b7ee047e901` |
| `评分合同-v1.0-已冻结.md` | 7758 | `2273674fbcb4407cec233c634b5693c6526c59ed0cc44451d03922b9fb913696` |
| `DB3K-515-核查.md` | 3839 | `65af20d75bbcdd202f55921da92b9d9f4a1385ae3ee80f74ac44571632bb91f4` |

题面推荐 DBID（来自题包核查，类别必须成对）：  
- 发射车 **Facility DBID=3665**（Shahed-136）  
- 巡飞弹 **Weapon DBID=4142**（Shahed-136）  
- 侦察机 **Aircraft DBID=1719**（MQ-9A Reaper）  
- **Aircraft DBID=6252**（MFI-17）角色 **待确认**

### 2.3 人工动作依赖（终验必做）

- 专机时间窗、断网 / 停本地模型、重启整 F1、暂停 / 恢复 / 取消、备份加载、整体回滚、外网首切确认、负向“无登录”扫一眼。  
- `D:\soft\F1-AI\runs\联调终验\` **尚不存在**（正式开跑时按 §6 命名新建，不改旧 `runs/`）。

### 2.4 飞机 course 探针状态

- 工单：`STABLE-R3-A1-R2-最终候选飞机航线真机探针-Cursor工单-20260901.md`  
- 取证草稿：`D:\soft\F1-AI-integration\runs\stable-r3-a1-r2-20260901\`（含 `version-gate.txt` gate=PASS，截图/脚本）  
- **正式探针结案报告：未找到** → B4。

---

## 3. Owner 需要准备 / 拍板

### 3.1 必须准备（物料）

1. DeepSeek API key、量界 API key（只在专机设置面板粘贴；**不要**贴进聊天/工单/截图明文）。  
2. 本地 Ollama 当前生产 BaseUrl + 模型名（若与历史 `192.168.1.59` 不同，书面确认）。  
3. 专机半天–1 天窗口；窗口内 HACM 停跑约定。  
4. 确认执行人只启动候选目录 F1，并会按清单截图归档。

### 3.2 必须拍板（给选项）

**拍板 P-A14：A14「生成脚本」按什么验收？**

| 选项 | 内容 | 优劣 |
|---|---|---|
| **甲（推荐）** | 按现状：用任务让 AI 走 `event.upsert`（白名单动作）+ 知识包约束；故意制造一次可恢复工具错误，验 `same_error_limit`（默认 3）停并汇报 | 与磁盘能力一致，当天可验；不宣称自由 Lua |
| **乙** | 坚持 PRD 字面“任意合规 Lua + ≤3 次自动修脚本” | 需新工具/沙箱开发，**挡稳定版终验** |
| **丙** | A14 本阶段豁免并记 V2.2 backlog，矩阵标 BLOCKED+豁免记录 | 毕业考 gate 变严；需书面豁免范围 |

**拍板 P-Course：飞机 course 是否挡 L2？**

| 选项 | 内容 | 优劣 |
|---|---|---|
| **甲** | 先完成 A1-R2 探针结案再开 L2 建场步骤 | 证据最干净；可能多半天 |
| **乙（推荐并行）** | L2 建场用 Ship 或「先 `unit.add` 再 `unit.update_position`」；飞机 course 单独跟踪 | L1/L2 可开；风险是演示能力面未全证 |
| **丙** | 稳定版声明飞机 course 不在验收范围 | 最快；与“16 工具演示线”宣传需对齐 |

**拍板 P-S6：A15 升 MACHINE_PASS 是否接受已知 3 条 P0 旁路未治？**

| 选项 | 内容 | 优劣 |
|---|---|---|
| **甲** | S1–S4 专机点验全过即可升 A15；S6 旁路独立高风险片后治 | 与历史排期一致；毕业考审计需注意非白名单操作 |
| **乙** | 先治 P0 旁路再验 A15 | 更严；工期+风险大 |
| **丙** | A15 只验白名单键鼠路径，旁路写进已知限制 | 折中；须书面写限制清单 |

**拍板 P-L10（仅 L4 前）：** 评分合同 Q5「已判明」= `KnownClass`？监理建议值已在 `DB3K-515-核查.md`。

**拍板 P-A9：** 矩阵已记 owner 甲（整体回滚接受、UI 选点二阶段）——终验按 **整体回滚抽检一次** 即可，无需再开 UI。

---

## 4. A1–A16 逐项傻瓜清单

> 通用前置：版本门通过 → 启动候选 `F1.exe` → WritableRoot=`D:\soft\F1\F1-测试` → 加载**可丢弃**小想定工作副本。  
> 证据根（建议，正式开跑时再建）：`D:\soft\F1-AI\runs\联调终验-202609xx\`（见 §6）。  
> **失败即停**：崩锁 / 审计断链 / 场景身份漂移 / 版本门不符 / 预期与实际不符 → 停、截图、报监理，禁止自行改矩阵状态。

### A1 — 对话面板打开、风格一致、不阻塞；含 AI 推演心跳

| 栏 | 内容 |
|---|---|
| 用户要看到 | 菜单「AI 助手」打开面板；可拖动/前置；主界面仍可操作；推演时有真实心跳（非假进度） |
| 矩阵状态 / 证据 | `AUTO_VERIFIED`；`runs/T08.1-execution-record.md`；`Command/AiAssistantPanelForm.cs` |
| 真机还缺 | 专机目视 + 黄金链路起来后的心跳补测 |
| 步骤 | ①开 F1 ②点「AI 助手」③拖面板点主地图 ④（有任务推演时）观察面板状态/心跳 |
| 预期 | 面板出；主界面不卡死；心跳随仿真变化 |
| 留证 | 截图 `A1-panel.png`、`A1-main-responsive.png`；可选短视频 |
| 即停 | 打不开 / 主界面冻死 |
| Owner 输入 | 无 |

### A2 — 三源可配、连通、切换即时生效

| 栏 | 内容 |
|---|---|
| 用户要看到 | 设置里本地/DeepSeek/量界都能配；测通；切换后下一句对话走新源 |
| 矩阵 | `IN_PROGRESS`；`runs/T08.2-*`；T06-E2E 仅 Ollama LAN |
| 还缺 | DeepSeek/量界真连通；生产 Ollama 地址确认 |
| 步骤 | ①开设置 ②配 Ollama 地址+模型→测试连接 ③配 DeepSeek（贴 key）→测试 ④配量界→测试 ⑤切换源各发一句短消息 |
| 预期 | 各源测试成功；切换后回复来自对应源（看设置当前源+回复特征） |
| 留证 | 三源「连接成功」截图（**遮挡 key**）；`task_id`/日志路径；勿截密钥全文 |
| 即停 | 任一源无法连通且非网络已知故障 |
| Owner 输入 | 两 key + Ollama 地址/模型名 |

### A3 — 流式输出、中文无乱码

| 栏 | 内容 |
|---|---|
| 用户要看到 | 字一个个出来；中文正常；小窗缩放不花屏 |
| 矩阵 | `AUTO_VERIFIED`；`runs/T08.3-*`；T06 流式事件 |
| 还缺 | 专机长文+小窗目视 |
| 步骤 | 用已通源发一段 ≥300 字中文请求；缩放面板 |
| 预期 | 流式；无乱码；重绘正常 |
| 留证 | `A3-stream.png` / 短录屏 |
| 即停 | 乱码或面板崩溃 |
| Owner 输入 | 至少一个可用模型源 |

### A4 — 无人工干预「改→跑→看→汇报」一轮

| 栏 | 内容 |
|---|---|
| 用户要看到 | 下达任务后 AI 自己改想定、跑仿真、读结果、中文汇报 |
| 矩阵 | `IN_PROGRESS`；黄金链路返修已合入证据，专机未跑 |
| 还缺 | 真模型+真仿真挂载专机一轮 |
| 步骤（建议文案） | 「请把当前想定里某某舰船移动到纬度…经度…并保存，然后跑约 5 分钟仿真，读取结果后用中文汇报。」可用工具：`unit.update_position` + `scenario.save` + `simulation.run` + `result.read`。**也可**用 `unit.add`（Ship）——**不要**照抄旧任务书“unit.add 未实现”。飞机+course 视 P-Course 拍板。 |
| 预期 | 自动备份→执行→汇报；有 `task_id`；CSV 在 `EventExport/ai/{taskId}/` |
| 留证 | 对话全文截图；`task_id`；审计/journal 导出；CSV 目录；最终 `.scen` 哈希 |
| 即停 | 中途要人手点仿真才继续 / 崩锁 / 断链 |
| Owner 输入 | 可用模型；可丢弃想定 |

### A5 — 结果不符时自主第二轮（上限内）

| 栏 | 内容 |
|---|---|
| 用户要看到 | 故意不可能指标时，AI 在 MaxRounds 内再调再跑并汇报 |
| 矩阵 | `IN_PROGRESS`（同 A4） |
| 还缺 | 真机双轮 |
| 步骤 | 在 A4 后追加：「若未达到 XXX（设不可能条件），请自动调整再试。」或设置 MaxRounds=2 观察 |
| 预期 | 出现第二轮工具调用；仍有终态汇报 |
| 留证 | 两轮 journal；`task_id` |
| 即停 | 死循环无汇报 / 超轮不停 |
| Owner 输入 | 同 A4 |

### A6 — 暂停可手改 / 恢复重读 / 取消无残留

| 栏 | 内容 |
|---|---|
| 用户要看到 | Running→暂停后可保存编辑；恢复后继续；取消后锁释放、无残留 |
| 矩阵 | `AUTO_VERIFIED`；清单 `runs/F04.3-S1-S4-专机点验清单.md` |
| 还缺 | 专机 S 点验 |
| 步骤 | 照 F04.3 S1–S4 + 任务面板 Pause/Resume/Cancel 各一轮 |
| 预期 | 与清单「预期」列一致；Cancel 后可再开新任务 |
| 留证 | 逐步截图 `A6-S*.png`；Cancel 后状态截图 |
| 即停 | 任一步与预期不符 |
| Owner 输入 | 专机人手 |

### A7 — 计划/决策/执行/结果可查；hash 链完整

| 栏 | 内容 |
|---|---|
| 用户要看到 | 任务步骤可追溯；hash 链校验 OK（历史报告 UI 可为 backlog） |
| 矩阵 | `AUTO_VERIFIED`；`runs/T02-execution-record.md`（HASH_CHAIN_OK） |
| 还缺 | 专机抽查一次链 |
| 步骤 | 完成 A4 后导出/查看该 `task_id` 的 steps/journal；跑链校验（监理提供既有工具或 SQL 只读） |
| 预期 | VerifyChain 类结果为真；步骤含工具名与结果 |
| 留证 | 链校验输出文件；`task_id` |
| 即停 | 断链 |
| Owner 输入 | 无（或协助导出 db） |

### A8 — 任务前自动备份，备份可加载

| 栏 | 内容 |
|---|---|
| 用户要看到 | 任务开始前有备份文件；能 Load 回来 |
| 矩阵 | `AUTO_VERIFIED`；`runs/T03-*`；`runs/F04.2-S2-SMOKE/` |
| 还缺 | 专机抽检加载 |
| 步骤 | A4 前记下备份路径 → 任务后用菜单加载该备份 |
| 预期 | 场景回到任务前状态 |
| 留证 | 备份路径+哈希；加载成功截图 |
| 即停 | 无备份或加载失败 |
| Owner 输入 | 无 |

### A9 — 选任务备份点恢复到任务开始前

| 栏 | 内容 |
|---|---|
| 用户要看到 | **整体回滚**到任务开始前（UI 精细选点已拍板二阶段） |
| 矩阵 | `AUTO_VERIFIED`；owner 甲 |
| 还缺 | L3 专机抽检一次 |
| 步骤 | 任务改过场景后执行整体回滚（Console/现有入口，以面板实际按钮为准） |
| 预期 | 标题/单元回到任务前；`ROLLBACK` 类证据 |
| 留证 | 前后截图；日志 |
| 即停 | 回滚后场景仍是改后态 |
| Owner 输入 | 确认仍走甲口径 |

### A10 — 重启 F1 后历史会话可见可继续；超长摘要

| 栏 | 内容 |
|---|---|
| 用户要看到 | 关整进程再开，会话还在；长会话不丢关键要点 |
| 矩阵 | `IN_PROGRESS`；SQLite 持久化有；**整进程重启未证**；摘要压缩 T07.6 欠账 |
| 还缺 | 重启专机；摘要能力可能仍缺 |
| 步骤 | ①聊几句并跑一短任务 ②完全退出 F1 ③再开同一 WritableRoot ④打开面板看历史 ⑤继续发一句 |
| 预期 | 历史可见可续；若摘要未做 → 记「摘要项待确认/欠账」，**勿假报 MACHINE_PASS** |
| 留证 | 重启前后截图；db 路径 |
| 即停 | 历史全丢 |
| Owner 输入 | 拍板：摘要未做是否挡 A10 MACHINE_PASS（建议：会话续聊过即可升，摘要单列欠账） |

### A11 — 全流程无账号/登录

| 栏 | 内容 |
|---|---|
| 用户要看到 | 任何界面不要求登录账号 |
| 矩阵 | `AUTO_VERIFIED`；架构无账号模块 |
| 还缺 | 终验负向勾选 |
| 步骤 | 打开主界面/AI 面板/设置/任务控制扫一遍 |
| 预期 | 无登录框 |
| 留证 | 勾选表 `A11-negative-checklist.txt` + 设置页截图 |
| 即停 | 出现账号登录要求 |
| Owner 输入 | 无 |

### A12 — 断本地模型报错明确，可切其他源继续

| 栏 | 内容 |
|---|---|
| 用户要看到 | 停 Ollama/断网后中文报错；切 DeepSeek 能续聊 |
| 矩阵 | `IN_PROGRESS`；Fault 中文有；端到端未实跑 |
| 还缺 | 真切源续聊 |
| 步骤 | ①当前用 Ollama ②停服务或拔网 ③发消息看报错 ④切 DeepSeek ⑤再发 |
| 预期 | 报错可读且无密钥泄露；切源后恢复 |
| 留证 | 报错截图；续聊截图 |
| 即停 | 英文堆栈糊脸 / 密钥进 UI |
| Owner 输入 | 双源可用 |

### A13 — 循环上限（默认 5）自动停并汇报

| 栏 | 内容 |
|---|---|
| 用户要看到 | 到上限停止且有最终汇报，不死循环 |
| 矩阵 | `AUTO_VERIFIED`；默认 MaxRounds=5，SameErrorLimit=3（`LoopParameterSettings`） |
| 还缺 | 专机随 A4/A5；建议 MaxRounds=1 强制触发 |
| 步骤 | 设置 MaxRounds=1，给需多轮才能完成的任务 |
| 预期 | 一轮后停并落最终汇报 |
| 留证 | 设置截图；终态 Completed/上限原因；journal |
| 即停 | 超过上限仍调工具 |
| Owner 输入 | 无 |

### A14 — 生成脚本符合 CMO 规范（≤3 次自动修复）

| 栏 | 内容 |
|---|---|
| 用户要看到 | **待 P-A14**：甲=结构化事件脚本可运行；错误在 same_error 上限内停并汇报 |
| 矩阵 | `IN_PROGRESS`；知识包 `runs/T09-KNOW-V1-*`；**无 `script.*` 工具** |
| 还缺 | 真模型联调；口径拍板 |
| 步骤（甲） | 「请创建一个定时事件，触发后发送消息…」观察 `event.upsert`；另制造重复同类工具错误至上限 |
| 预期（甲） | 事件出现且可触发；错误 streak≤3 后停 |
| 留证 | 事件编辑器截图；journal；streak 证据 |
| 即停 | 自由 Lua 被执行（当前设计应拒绝）/ 超限不停 |
| Owner 输入 | **P-A14 拍板** |

### A15 — AI 工作时手改被拦；暂停后可改

| 栏 | 内容 |
|---|---|
| 用户要看到 | Running 时 Ctrl+S/切换想定/M/Del/Ins/标题/航线被拦；Paused 可保存 |
| 矩阵 | `IN_PROGRESS`；S1–S5 代码关闭；S6 三 P0 旁路未治 |
| 还缺 | 专机 S1–S4；S6 治理或豁免 |
| 步骤 | **逐字照抄** `D:\soft\F1-AI\runs\F04.3-S1-S4-专机点验清单.md`（16 步） |
| 预期 | 清单「预期」列 |
| 留证 | `runs/F04.3-专机点验-YYYYMMDD/` 逐步截图 |
| 即停 | 任一步不符 |
| Owner 输入 | **P-S6 拍板** |

### A16 — 首次切外网弹提醒 + 设置固定文案

| 栏 | 内容 |
|---|---|
| 用户要看到 | 第一次切 DeepSeek/量界弹确认；设置页固定警示文案 |
| 矩阵 | `AUTO_VERIFIED`；`runs/T08.2-*` |
| 还缺 | 专机目视 |
| 步骤 | 清过确认标志的环境（或新用户配置）首次切外网；查看设置文案 |
| 预期 | 对话框文案含“对话内容（含场景数据）将发送到第三方服务器”；设置固定句同义 |
| 留证 | 弹窗截图；设置页截图 |
| 即停 | 无弹窗或文案缺失 |
| Owner 输入 | 外网源可用 |

---

## 5. 历史文档漂移清单（只报差异，不改真源）

| # | 旧表述位置 | 当前磁盘事实 | 建议 |
|---|---|---|---|
| D1 | `联调终验任务书` L2-1：「unit.add 属 V2 未实现，本步不用」 | Core `Implemented` **含 unit.add**（Aircraft/Ship） | 终验步骤允许用 unit.add；勿照抄禁用句 |
| D2 | `HANDOFF.md`：V2.1 待合、V2.2 才 unit.add、主工作区 F1-AI、L1 611 | 稳定候选在 **integration** `a0e5675`，L1 监理门 **927/927**，16 工具已进 Core | HANDOFF 作历史；以候选清单+矩阵为准 |
| D3 | 稳定路线方案（08-26）：批1 施工中、演示线待回合、终验未启动 | 回合已进 `integration/stable-single-ai`；收尾处在「真机终验前预演」 | 路线文档步骤 3 仍有效，快照过时 |
| D4 | L2-6「生成一段 Lua / 语法错误脚本自动修」 | **无自由 Lua 工具**；`event.upsert` 白名单；纠错是 **same_error_streak**（默认 3） | 须 P-A14；勿按自由 Lua 考 |
| D5 | L4 启用条件写「V2 建场工具进生产」 | 建场工具已进；但飞机 course / Facility / 部分题面 DBID 角色仍待确认 | gate 文案需按现状重核，不改本预演 |
| D6 | 任务书基线「打 tag `liantiao-baseline`」 | 本候选 **未**在本轮打 tag（禁令） | L0 是否补 tag → owner |
| D7 | 矩阵/任务书测试数口头（604/589/573 等） | 候选清单：**927/927** | 引用以候选清单为准 |
| D8 | A9 待拍板甲乙 | 矩阵已记 **甲** | 任务书 §七过时 |
| D9 | 评分合同 Q5 仍写「开考前确认」 | 核查建议 `KnownClass`，**owner 未回写冻结句** | L4 前拍板 |
| D10 | `HACM_Modified.db3k` 优先 | 盘上 **未找到 .db3k**，有 `HACM_Modified.db3` | 引用时写未找到 .db3k |

---

## 6. 证据目录方案（只设计，不批量建空目录）

建议正式终验根（开跑日新建一层即可）：

```text
D:\soft\F1-AI\runs\联调终验-YYYYMMDD\
  _version-gate.txt          # HEAD + F1.dll/binlog 哈希 + 进程 Path
  L0-准备\
  L1-真模型烟测\A2\ A3\ A12\ A16\
  L2-黄金链路\{taskId}\      # 对话截图、journal、CSV、scen哈希
  L3-专机点验\A1\ A6\ A8\ A9\ A10\ A11\ A15-F04.3\
  L4-lucas\                  # 仅毕业考日；本预演不建不跑
  _owner-decisions.md        # 粘贴拍板结果
```

**命名：** `{Ax}-{步骤简写}-{HHmm}.png`；日志 `{Ax}-{taskId}.log`。  
**每项最低证据：** ①版本门文件 ②至少 1 张结果截图 ③`task_id`（有任务时）④失败则「即停」说明。  
**禁止：** 改写旧 `runs/T08*` 等历史证据；禁止把 AUTO_VERIFIED 报告改称 MACHINE_PASS。

---

## 7. 推荐正式终验分批顺序

```text
Day0  L0：钥匙/窗口/HACM纪律/版本门演练（不跑任务）
        └ 并行：P-A14 / P-Course / P-S6 书面拍板

Day1  L1 烟测：A2 → A16 → A3 → A12
        └ 全绿才进 L2

Day1–2  L2 核心：A8/A7（随任务）→ A4 → A5 → A13
          → A6（Pause/Resume/Cancel）→ A15（可与 L3 合并）
          → A14（按拍板甲）

插缝 L3：A1 目视 → A11 负向 → A9 整体回滚 → A10 重启
          → A15 按 F04.3 清单补齐截图

之后   矩阵逐项升 MACHINE_PASS（仅监理凭本轮新证据改表）
最后   L4 lucas（另开 gate；本预演不授权）
```

飞机 course 探针：建议 **Day0 晚或 Day1 晨** 与 L0 并行结案；未结案则 L2 走拍板乙路径。

---

## 8. 本轮未改动声明

本预演仅：

- 只读打开冻结真源与磁盘证据；  
- 重算候选 `F1.exe` / `F1.dll` / binlog 哈希；  
- 检索 ToolRegistry / Core Implemented / 题包 / DB / 证据路径；  
- **新写本报告文件**。

**未做：** 启动 F1、联网试 key、改矩阵/HANDOFF/源码/测试/想定/DB、git add/commit/tag/push、新建大量空目录、启动 lucas 毕业考、改写旧 `runs/` 结论。

### 最终 `git status --short`（`D:\soft\F1-AI-integration`）

```
 M runs/stage5-evidence/openai-strict-request-raw.json
?? runs/_integration-r1-final-allinone-supervisor-20260831.log
?? runs/_integration-r1-final-l1-supervisor-20260831.log
?? runs/_iso-probe/
?? runs/_merge-stage3-tmp/
?? runs/_merge-stage5-tmp/
?? runs/_run-a1a2-20.ps1
?? runs/_run-l1.bat
?? runs/_tmp-fix5-orch.cs
?? runs/_v22-rebase-l1.txt
?? runs/fix5-r2-*（多份日志）
?? runs/fix6d-*（多份日志）
?? runs/integration-r1-*（多份日志）
?? runs/stable-r3-a0e5675-allinone-rebuild.binlog
?? runs/stable-r3-a1-r2-20260901/
?? runs/stable-r3-b1-* / stable-r3-c2-* / stable-r3-c8427d8-*.binlog
```

说明：脏项均为既有 `runs/` 证据/日志；源码/测试无本预演改动。HEAD 仍为 `a0e56757d2ff7da8cda2addbce02c4cb3f4e8643`。

---

*报告结束。正式终验须另开授权工单；本文件不可代替 `验收矩阵.md` 状态变更。*
