# 开工提示词：Q-065 guard 相位与槽实例脱节死锁（proxy）— Cursor — 2026-10-21

## 0. 一句话

**槽位重启后 proxy 的 guard 还按旧相位拦起跑**——槽里明明干干净净（空闲、零作业），proxy 却认为"上一局终局未确认"，且确认路径（simulation.status 查看即确认）在"作业已消失"时永远完不成 → 永久死锁，只能重启 proxy 解锁。今晚真机复现三轮。纯 proxy，零编译，**可与 Q-062 C 段同批施工**。

## 1. 真机证据链（2026-10-21 晚）

1. 槽 1 桥崩溃（Q-063）→ 60 脉冲试跑 Failed 无留档 → guard slot-01 phase=`unconfirmed`；
2. 监理 21:07 用 slot_supervisor 重拉槽 1（全新进程 pid 20020，桥就绪）；
3. 面板 AI 起跑连试多次全被拦："查询显示空闲、零脉冲；simulation.recover 回复找不到可恢复的任务"——guard 相位机记录的是**已消失的旧实例**的局，新实例无从确认；
4. 监理 21:2x 重启 proxy → phase 回 `idle` → 死锁立解（证明病根在 proxy 内存相位，不在槽）。

## 2. 修法（proxy 侧，三件套）

1. **自愈**：phase=`unconfirmed` 且 `simulation.status` 返回空闲/无作业（桥侧无此 runId）时，自动把该槽相位复位 `idle` 并在审计落一行"终局无从确认：旧局随槽实例消失，自动复位"；不再要求"查看详情才算确认"——详情已经不存在了。
2. **代际感知**：槽实例重启后 proxy 应知——槽桥 `/health`（或任一桥响应）里带进程启动时刻/实例 id（若桥没有，退而求其次：slot_supervisor restart 后调 proxy 管理接口 `POST /api/pooling/slot-reset {slot}` 清该槽相位+租约）。先查桥有没有现成实例标识，有就直接用，没有再落 supervisor 通知通道。**择一实现，报告里写明选了哪条、为什么**。
3. **recover 语义修正**：`simulation.recover` 在"找不到可恢复任务"时，若该槽 phase=`unconfirmed`，连带复位相位（与 1 同路径），文案说明"旧局已随实例消失，相位已复位"。

## 3. 测试（proxy/unittest）

- phase=unconfirmed + status 空闲 → 复位 idle + 审计行；
- phase=unconfirmed + status 显示真在跑 → 保持拦截（复位不误伤真运行态）；
- recover 找不到任务 + unconfirmed → 复位；
- 槽代际变化（模拟桥返回新实例标识或调 slot-reset 接口）→ 相位+租约清空；
- Q-002/Q-040/Q-054 相关既有测试全绿回归。

`test:all` 末尾追加新测试文件。

## 4. 红线

不动 guard 的 running 红线语义、不动租约排队语义、不动 Q-059 懒拉起；复位必须落审计行（防"悄悄放行"）；不碰 C#/.env。

## 5. 交付物

代码+测试+完工报告 `LabConsole\outputs\完工报告-Q065-guard相位脱节死锁-Cursor-20261021.md`，留工作区不提交。
