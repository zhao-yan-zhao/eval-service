# F1-AI 项目临时文件清理报告（2026-09-03）

## 结论

D 盘空闲空间从约 **0.72 GB** 提升到约 **13.28 GB**，本轮实际释放约 **12.56 GB**。

只清理了 F1-AI 项目范围内已确认可删除的旧隔离运行包和可重新生成的编译/POC缓存；未删除源码、Git 分支/提交、当前候选运行包、owner 想定、正式 DB/GIS、NuGet 离线包、验收报告和 `runs/` 证据。

## 已删除

1. `D:\soft\F1-AI-runtime-a0e5675-a1r3`，约 11.2 GB。
   - 它是已经被 `26effb3-a1r4` 替代的旧候选隔离运行包，当前无进程使用。
   - 两份 owner 想定在当前 a1r4 中存在同尺寸、同 SHA-256 副本。
   - 旧包独有文件名的 13 份 HACM 想定在正式资源目录 `D:\soft\F1\F1-测试\Scenarios` 中均存在同 SHA-256 副本。
   - 旧包剩余内容为重复 DB/GIS、旧二进制、旧会话数据库和日志。
   - 删除为不可恢复操作；所需正式资源和当前副本仍保留。
2. 九个已关门/冻结旧 worktree 中的 `bin/`、`obj/`、`TestResults/`、`.vs/`，共 89 个目录，约 1.08 GB。
   - 涉及 `F1-AI-fix`、`fix2`、`fix3`、`fix4`、`fix5`、`fix6`、`stage2`、`v21`、`v22`。
   - 均为可从源码重新生成的缓存；worktree、分支、提交、源码和 `runs/` 仍保留。
3. 主工作区 `poc/**/out`、`poc/**/obj` 等 18 个被 Git 忽略的早期 POC 构建目录，约 248 MB。

## 清理中发现并修复的链接依赖

当前 `D:\soft\F1-AI-runtime-26effb3-a1r4` 的 `DB`、`GIS` 原为 junction，目标错误地指向旧 a1r3。删除旧包后监理复查发现断链，随即改接到 owner 已确认的正式资源根：

- `a1r4\DB` → `D:\soft\F1\F1-测试\DB`
- `a1r4\GIS` → `D:\soft\F1\F1-测试\GIS`

这样不再复制约 9 GB 资源。复查确认：

- `WritableRoot.txt` 仍为 `D:\soft\F1\F1-测试`；
- `DB3K_505.db3` 可访问，SHA-256 以 `81337C9A...` 开头；
- `DB3K_515.db3` 可访问，SHA-256 为 `D398E5B1C9A7C81A427267DFEAD52D9EA587954C914FD1FF096D91FDC73EDB39`；
- 当前 F1 仍是 PID 21784，运行路径仍为 `D:\soft\F1-AI-runtime-26effb3-a1r4\F1.exe`；
- owner 工作想定 `A1R3-515-OWNER-WORK.scen` 仍在当前 a1r4。

## 有意保留

- 当前运行包 `D:\soft\F1-AI-runtime-26effb3-a1r4`；
- 主工作区和 integration 当前候选的 `bin/obj`，避免正在进行的验收因 `--no-restore` 缺产物而中断；
- `.nuget-packages` 约 0.61 GB，本机 restore 有已知路径问题，属于必要离线依赖；
- 所有 worktree/分支/提交和源码；
- `runs/` 验收证据合计约 351 MB；它们是做验分离和关门追溯依据，未确认无用，不删除；
- `backup/`、正式想定、正式 DB/GIS；
- 与 F1-AI 项目无关的任何目录。

## 最终状态

- D 盘空闲：约 13.28 GB。
- 旧 a1r3：不存在。
- 当前 a1r4：存在，关键想定与数据库可访问。
- Git worktree：11 个仍在，未删除任何分支或提交。
- 本轮未产生新的源码 diff；原有 `runs/` 脏项保持原样。
