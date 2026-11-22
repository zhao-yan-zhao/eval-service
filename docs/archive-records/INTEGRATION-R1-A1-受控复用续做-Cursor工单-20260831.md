# INTEGRATION-R1-A1：受控复用续做 Cursor 工单

> 日期：2026-08-31  
> owner 决策：A1——授权复用现有 integration worktree，但必须先撤销未提交的阶段3合并，补齐阶段2验收后再继续。  
> 本单是《INTEGRATION-R1-稳定单AI回合-Cursor工单-20260828.md》的现场恢复续单；以下内容完整自足，可原样执行。

## 一、功能目标与边界

保留已经形成的阶段1、阶段2独立 merge commit，不删除 worktree、不新建替代分支、不 reset/rebase/amend 历史。仅撤销当前尚未提交的阶段3 merge 现场，回到阶段2 HEAD 做真实双门验收；阶段2绿后重新合批3，再依次合批5、批6。

本单不授权：飞机 course、Facility、unit.status 分页三个真机遗留；批6D；A1–A16；tag/push；合 night-soak；V2.2。

## 二、开工现场必须逐字一致

工作目录：`D:\soft\F1-AI-integration`

必须同时满足：

- 分支：`integration/stable-single-ai`
- HEAD：`3880bd52f6baac22fbf867d854654d80d69e19c8`
- MERGE_HEAD：`73320e19a1ae927d1b79076f80141145c654bb0d`
- `git status --short` 中源码/测试项仅：
  - `UU CMO-netcore-src/AiAssistant/Tools/ToolInvocationService.cs`
  - `A  tests/F1.AiAssistant.Tests/P1_D04_WriteIdentityBindingTests.cs`
- 其他允许项仅为既有 `runs/` 修改或未跟踪日志。
- 阶段1 merge `3e38f3e60878792856f4a21a0eb032512dd171ca`、阶段2 merge `3880bd52f6baac22fbf867d854654d80d69e19c8` 均在当前历史中。
- 主 demo worktree 仍应是 `demo/lua-structure-tools @ 7815427e1bb5d5d735e11b52dcec83a6046c2120`；只读核对失败时停工，不得为绕过 safe.directory/权限问题修改全局 Git 配置。

任一项不一致：立即停工报告，不得自行“整理现场”。

## 三、A1 授权动作：只撤销未提交阶段3 merge

owner 已明确授权在上述完全一致的现场执行：

```powershell
git merge --abort
```

这是本单唯一获准的撤销动作。禁止 `git reset --hard`、`git clean`、删除 worktree、删除分支、checkout覆盖文件。

执行后必须核对：

- HEAD 仍是 `3880bd52f6baac22fbf867d854654d80d69e19c8`。
- `MERGE_HEAD` 不再存在。
- `ToolInvocationService.cs` 不再是 UU，批3新增测试不在暂存区。
- 阶段1/2两个 merge commit 和既有 runs 日志仍在。
- 只允许 runs/ 保持修改或未跟踪；出现任何源码/测试脏文件立即停工。

## 四、先补阶段2真实验收门

旧 `runs/integration-r1-stage2-l1.log` 与 `stage2-allinone.log` 不能作为阶段2结果：它们是在阶段3 merge 已开始后运行，3个错误均来自阶段3冲突标记。不得覆盖旧日志，保留为流程证据。

在干净的 `3880bd5` 上执行：

```powershell
git diff --check 3e38f3e60878792856f4a21a0eb032512dd171ca..3880bd52f6baac22fbf867d854654d80d69e19c8
dotnet test tests\F1.AiAssistant.Tests\F1.AiAssistant.Tests.csproj --no-restore
dotnet build CMO-netcore-src\F1-AllInOne.csproj -c Debug -p:Platform=x64 -t:Rebuild --no-restore
```

新日志必须另存：

- `runs/integration-r1-stage2-recheck-l1-20260831.log`
- `runs/integration-r1-stage2-recheck-allinone-20260831.log`

阶段2放行条件：

- 全量 L1 0失败，报告真实总数；总数低于阶段1的770必须停工解释。
- AllInOne 0错误，报告真实警告数。
- stage2 merge commit 禁区零命中，未提交 runs/、backup/、`Command_Core/BinaryGridProvider.cs`、`Terrain.cs`。
- 工作区除 runs/ 外干净。

任何一门失败：停在 `3880bd5` 报告，不得再次启动阶段3。若确定为阶段2真实合并回归，不得 amend merge commit；先锁红、再做独立 `integration-r2-fix WIP` commit，并等监理新令。

## 五、阶段3重新合批3

只有第四节全部通过才执行：

```powershell
git merge --no-ff --no-commit 73320e19a1ae927d1b79076f80141145c654bb0d
```

预期：`ToolInvocationService.cs` 出现冲突，新增 `P1_D04_WriteIdentityBindingTests.cs`。若出现其他冲突，先报告完整清单；不得擅自扩大处理。

解决 `ToolInvocationService.cs` 时必须先 `rg`/查看 index 三方版本，再逐块合并；禁止整文件 ours/theirs。必须同时保留：

1. demo 的 no-op/未命中写工具预检：失败不得留下写 Intent、备份或恢复哨兵。
2. 批3四重写身份 fail-closed：任务存在且非终态、任务场景路径匹配、任务/锁身份材料存在且匹配、锁归当前任务。
3. 身份核验与 no-op 预检均位于真正写 Intent、备份、恢复哨兵之前；准确先后若磁盘合同无法唯一确定，标“待确认”并停工，不得猜业务规则。

具名 add：

```powershell
git add CMO-netcore-src/AiAssistant/Tools/ToolInvocationService.cs
git add tests/F1.AiAssistant.Tests/P1_D04_WriteIdentityBindingTests.cs
```

禁止 `git add -A`、`git add .`。解决后先确认无冲突标记、`git diff --check`为0，再跑批3具名测试、全量 L1、AllInOne。只有全部通过才完成 merge commit：

`integration-r3 WIP: merge write identity verification`

日志另存 `runs/integration-r1-stage3-*`，不提交。

## 六、阶段4合批5

阶段3完成且全绿后合入：`cf54acd07b3b530f1c116db030b83a563f3756fd`。

命令口径：`git merge --no-ff --no-commit <SHA>`；冲突逐块处理，禁止整文件选边。

必须同时保留：

- 每任务独立审计链；记录追加与尾锚更新同事务。
- V1原样保留，V2按冻结 canonical 续链并含 chain version、step id。
- 启动验链先于任何 recovery/takeover；失败只禁AI写，不退出宿主。
- RecoverOnStartup 异常返回 disabled runtime，宿主存活，不得吞异常继续启用。
- 断链旧库只封存证据拒写，不自动修复；迁移1、2不改写。
- demo失败终态补齐、阶段1恢复/解锁、阶段2 CSV lease recovery 全部保留。

重点逐字复核 `AiAssistantCompositionRoot.cs` 启动顺序和 `AiAssistantStore.cs` 组合语义。无法从磁盘唯一确认时停工报告“待确认”。

相关具名测试、全量 L1、AllInOne全绿后才提交：

`integration-r4 WIP: merge transactional audit chain`

日志另存 `runs/integration-r1-stage4-*`，不提交。

## 七、阶段5合批6最终 HEAD

阶段4完成且全绿后合入：`ee3a4df7ea16e69bccba02ca726b07bd0de47477`。

必须同时保留：

- integer严格校验：整数形态通过、真实小数拒绝，number合同不改。
- 模型文字delta真流式，不恢复provider/parser双缓存；tool分片不早产。
- API key不进入Fault、诊断、日志、SSE inline error；正常业务payload不改写。
- 卡死流取消能主动打断底层读，只产一个cancelled Fault；流异常不裸抛；提前停止释放资源。
- 6C六项Mock/InMemory对齐。
- `MockSimulationGateway.cs` 同时保留阶段2 drain/finalizer和6C run/stop诊断。
- `InMemoryF1AutomationFacade.cs` 保留demo四个真实工具能力，不偷做批6D。

相关具名测试、全量 L1、AllInOne全绿后才提交：

`integration-r5 WIP: merge contract governance and model streaming`

日志另存 `runs/integration-r1-stage5-*`，不提交。

## 八、最终硬门与红线

每阶段都必须：范围、diff逐字合同、全量L1、AllInOne；最终总跑不能替代阶段门。

最终要求：

- demo、批4、批2、批3、批5、批6六个冻结SHA均为HEAD祖先。
- 五个独立merge commit可追溯；不amend、不rebase。
- 最终全量L1 0失败，测试总数报告真实值且不得低于770。
- AllInOne Debug x64 Rebuild 0错误，警告数报告真实值。
- `git diff --check 7815427..HEAD`为0。
- 最终源码/测试工作区干净；只允许runs/与明确的本机未跟踪环境项。
- 永不提交 `runs/`、`backup/`、`Command_Core/BinaryGridProvider.cs`、`Terrain.cs`。
- 不修改主demo worktree、night-soak、V2.2；不push、不打tag。

## 九、完事报告（缺一项不验收）

1. A1开工门原文、`git merge --abort`前后 HEAD/MERGE_HEAD/status 对照。
2. 阶段2补验：命令、退出码、L1通过数、AllInOne错误/警告数、日志路径。
3. 阶段3/4/5：阶段前HEAD、合入SHA、merge commit SHA、冲突文件、逐块合并说明、commit文件清单。
4. 每阶段具名测试、全量L1、AllInOne结果和日志。
5. 所有关键合同的磁盘`rg`定位；引不到写“未找到”。
6. 最终 ancestry、禁区扫描、`git diff --check`、`git status --short`原文。
7. 声明未使用`git add -A`/`git add .`，未reset/rebase/amend，未提交runs/backup/禁区。
8. 单列未做：三个真机遗留、批6D、A1–A16、tag/push、night-soak、V2.2。

Cursor自报通过不算关门；完事报告回来后由监理亲跑四门。
