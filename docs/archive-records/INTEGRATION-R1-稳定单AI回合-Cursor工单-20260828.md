# INTEGRATION-R1：稳定单 AI 回合（方案 A）Cursor 工单

> 日期：2026-08-28  
> 决策：owner 已拍板方案 A——新建独立 integration worktree，保留各批 merge ancestry。  
> 本单目标：只把 demo 能力线与批1～5、批6A/B/C 已关门成果合成一个可编译、全测通过的候选版本。  
> 本单不授权：三个真机遗留修复、批6D、A1–A16、打 tag、推送、修改 night-soak、修改 V2.2。

## 一、结论先行

必须在 `D:\soft\F1-AI-integration` 新建独立 worktree 和 `integration/stable-single-ai` 新分支，从 demo 收官 SHA 起步，按固定顺序合入：

1. 批4最终 HEAD（同时带入批1祖先）
2. 批2最终 HEAD
3. 批3最终 HEAD
4. 批5最终 HEAD
5. 批6最终 HEAD（已含6A、6C、6B及其R1/R2）

每阶段必须单独完成 merge commit、合同复核、全量 L1、AllInOne Debug x64 Rebuild；不得把五次合并攒到最后只测一次。任何一阶段红，停在该阶段修正并单独 WIP commit，不得带红进入下一阶段。

## 二、冻结输入（开工必须逐项核对）

| 输入 | 分支/来源 | 冻结 SHA |
|---|---|---|
| demo 能力线基底 | `demo/lua-structure-tools` | `7815427e1bb5d5d735e11b52dcec83a6046c2120` |
| 批4最终（含批1祖先） | `fix/p1-recovery` | `2d02d2437397d4df453414af839f2702c3612003` |
| 批2最终 | `fix/p1-csv-drain` | `a1e9f1c3fa1f79c9d7f9cccbfb3f78962eab7357` |
| 批3最终 | `fix/p1-write-identity` | `73320e19a1ae927d1b79076f80141145c654bb0d` |
| 批5最终 | `fix/audit-chain` | `cf54acd07b3b530f1c116db030b83a563f3756fd` |
| 批6最终 | `fix/p2-contract-a` | `ee3a4df7ea16e69bccba02ca726b07bd0de47477` |

开工门：

- 在 `D:\soft\F1-AI` 只做只读核对和 `git worktree add`；不得改它当前 checkout 的任何文件，不得清理其既有脏文件。
- 核对以上六个 SHA 均可解析，且对应分支 HEAD 未漂移；有任何不符立即停工报告。
- 核对 `D:\soft\F1-AI-integration` 不存在，`integration/stable-single-ai` 分支不存在；若任一已存在，禁止覆盖、删除或复用，停工报告。
- 创建命令须等价于：`git worktree add -b integration/stable-single-ai D:\soft\F1-AI-integration 7815427e1bb5d5d735e11b52dcec83a6046c2120`。
- 创建后所有施工、测试、日志都只在 `D:\soft\F1-AI-integration`。
- 若新 worktree 缺本机编译依赖，可参照既有 worktree 做未跟踪的本地环境补齐；不得为适配本机而修改或提交 csproj/生产代码。无法确认时停工报告。

## 三、通用施工纪律（五阶段全部适用）

1. 每次使用 `git merge --no-ff --no-commit <冻结SHA>`，先解决冲突和复核自动合并，再具名 add 冲突文件，最后生成独立 merge commit。禁止 `git add -A`、`git add .`。
2. 禁止整文件使用 ours/theirs 覆盖。每个冲突块必须同时保留两边已关门合同；引用代码前先 `rg`/`git grep`，引不到写“未找到”。
3. 自动合并不等于合同正确。对共同修改文件必须逐字复核关键调用顺序和 fail-closed 分支。
4. 每阶段 merge commit 后先 `git diff --check <阶段前SHA>..HEAD`，再检查 commit 文件清单和禁区，再跑相关具名测试，最后亲跑全量 L1 和 AllInOne。
5. 若自动合并或冲突修复造成测试删除、跳过、改弱断言、放宽错误码、默认成功、吞异常，立即停工；不得“为绿而绿”。
6. 若阶段测试发现需要 merge 合同之外的生产修复：不要塞进 merge commit。先完成/退出当前 merge到可审状态，再做单独 `integration-r*-fix WIP` commit，报告原因、锁红和范围。
7. 永不提交：`Command_Core/BinaryGridProvider.cs`、`Terrain.cs`、`backup/`、`runs/`。若这些文件出现在待提交清单，立即停工排查。
8. 不改 `D:\soft\F1-AI` 主 demo worktree，不碰 `D:\soft\F1-AI-v22`，不合 night-soak，不 push，不打 tag。

统一测试命令：

```powershell
dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore
dotnet build CMO-netcore-src\F1-AllInOne.csproj -c Debug -p:Platform=x64 -t:Rebuild --no-restore
```

本机若首次缺 assets，仅允许先 restore 一次再回到上述 `--no-restore` 验收口径。每阶段日志写 `runs/integration-r1-stageN-*`，永不提交。

## 四、阶段 1：合批4（同时带入批1）

合入：`2d02d2437397d4df453414af839f2702c3612003`。

已知高风险文件：

- `TaskOrchestrator.cs`
- `UserFacingErrorCatalog.cs`
- `AiAssistantTaskPanel.cs`

必须同时保留的功能合同：

- demo：工具无进展连续拍早退、最后真实工具错误码保底、失败终态中文汇报、聊天显示可读化。
- 批1：两阶段暂停；暂停意图后禁止新工具；只有工具静止并确认后才进入 Paused；停止未确认必须恢复阻断。
- 批4：任务创建时冻结四项有效 limits；runtime 丢失按既定 fail-closed；失败/恢复后的免重启安全解锁出口。

禁止用 demo 的旧状态机覆盖批1/4，也禁止用批1/4覆盖 demo 的无进展早退和终态体验修复。

阶段 commit 建议：`integration-r1 WIP: merge batch4 and batch1 into demo`。

## 五、阶段 2：合批2

合入：`a1e9f1c3fa1f79c9d7f9cccbfb3f78962eab7357`。

必须保留：

- CSV 停止不是清队假完成；必须走 drain/fence/teardown/finalizer 合同。
- exporter lease 必须持久化；启动恢复身份不匹配时保留 lease、拒绝新任务、不得清未知目录。
- 不得破坏阶段1已经合入的暂停、恢复、解锁和 demo 工具能力。

若 `AiAssistantCompositionRoot.cs` 自动合并，仍须逐字记录 CSV lease recovery 与 mutation recovery 的调用顺序；批5审计验链将在阶段4加入，阶段4必须重新复核三者组合顺序。

阶段 commit 建议：`integration-r2 WIP: merge csv stop and drain contracts`。

## 六、阶段 3：合批3

合入：`73320e19a1ae927d1b79076f80141145c654bb0d`。

高风险文件：`ToolInvocationService.cs`。

必须同时保留：

- demo 的 no-op/未命中写工具预检：失败不得留下恢复哨兵或假现场破坏。
- 批3写身份四重 fail-closed：任务存在且非终态、任务场景路径匹配、任务与场景锁指纹存在且匹配、锁归当前任务。
- 身份核验仍须发生在写 Intent、备份和恢复哨兵之前。

阶段 commit 建议：`integration-r3 WIP: merge write identity verification`。

## 七、阶段 4：合批5

合入：`cf54acd07b3b530f1c116db030b83a563f3756fd`。

必须保留：

- 每任务独立审计链；追加记录与更新尾锚同事务。
- V1原样保留，V2按已冻结 canonical 续链并含chain version与step id。
- 启动验链必须先于任何 recovery/takeover；验链失败只禁AI写，不退出宿主。
- RecoverOnStartup 抛异常时返回 disabled runtime，宿主存活，禁止吞异常后继续启用。
- 断链旧库只封存证据并拒写，不自动修复。
- 迁移1、2不得改写。

重点逐字复核 `AiAssistantCompositionRoot.cs` 的启动顺序：审计验链在最前；其后 CSV lease recovery、mutation recovery/takeover 均不得绕过验链失败的 disabled runtime。准确顺序若磁盘代码不能唯一确认，标“待确认”并停工，不得自行重排业务规则。

`AiAssistantStore.cs` 若自动合并，必须同时保留 demo 失败终态补齐和批5审计链/尾锚逻辑。

阶段 commit 建议：`integration-r4 WIP: merge transactional audit chain`。

## 八、阶段 5：合批6最终 HEAD

合入：`ee3a4df7ea16e69bccba02ca726b07bd0de47477`。

必须保留：

- D-09：integer 严格校验，允许整数形态数值，拒绝真实小数；number 合同不改。
- D-10：模型文字delta逐条即时输出，不得恢复 provider/parser 双缓存；tool分片不得提前产出。
- D-11：已知API key不得进入Fault、诊断、日志或SSE inline error；正常业务payload不改写。
- 取消卡死模型流时必须主动打断底层读，正确产出一个 cancelled Fault；流中异常不得裸抛；提前停止枚举必须释放响应流。
- 6C六项Mock对齐全部保留。
- `MockSimulationGateway.cs` 同时保留批2 drain/finalizer语义与6C run/stop诊断字段，不得整文件选边。
- `InMemoryF1AutomationFacade.cs` 必须保留 demo 中四个真实工具能力面；本阶段不得借机做批6D。

阶段 commit 建议：`integration-r5 WIP: merge contract governance and model streaming`。

## 九、最终回合验收

阶段5通过后再做一次总复核，但不能替代前五阶段门禁：

1. `git log --graph --oneline --decorate` 能看出 demo 基底和五个独立 merge commit，各冻结输入均为祖先。
2. `git diff --check 7815427e1bb5d5d735e11b52dcec83a6046c2120..HEAD` 为0。
3. 列出从 demo 到最终 HEAD 的全部改动文件，确认禁区、`backup/`、`runs/`未入历史。
4. 确认没有删除/跳过测试；最终全量 L1 0失败。测试总数必须报告真实值；若低于任一输入已知上限755，必须停工解释，不得直接报绿。
5. AllInOne Debug x64 Rebuild 0错误；警告数报告真实值并与各输入基线解释差异。
6. 最终 `git status --short` 只能有 runs/ 和明确的本机环境项；任何源码/测试脏文件均不允许交工。

## 十、明确不做（发现也只登记）

- 飞机创建时带 course 真机不生效。
- Facility 创建失败。
- `unit.status` 无分页。
- 批6D四个stub工具对齐。
- A1–A16真机终验。
- tag、push Gitee、合回night-soak。
- V2.2、双AI、透明面板、断点循环、蒙特卡洛。

若合并时发现上述问题，只写“未找到/待确认/发现位置”，不得扩工。

## 十一、完事报告格式（缺一项不验收）

1. worktree路径、分支名、创建基底SHA。
2. 五阶段逐项表：合入冻结SHA、阶段前HEAD、merge commit SHA、冲突文件、人工选择说明。
3. 每阶段 commit 文件清单与 `git diff --check` 结果。
4. 每阶段相关具名测试、全量L1、AllInOne：命令、退出码、通过/失败/警告数、日志路径。
5. 对本工单所有“必须同时保留”合同逐项给出磁盘 `rg` 定位；引用必须逐字存在，找不到写“未找到”。
6. 最终 ancestry 证明、最终全量文件清单、禁区扫描。
7. 最终 `git status --short` 原文；声明未使用 `git add -A`/`git add .`，未提交 runs/backup/禁区。
8. 单列“待确认/未做”：三个真机遗留、批6D、A1–A16、tag/push均仍未启动。

交工后等待监理按范围、diff合同、全量L1、AllInOne四门亲验。Cursor自报通过不等于关门。
