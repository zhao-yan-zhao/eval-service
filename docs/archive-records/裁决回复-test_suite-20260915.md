# 裁决回复：test_suite 治理三问 + 附议项（2026-09-15 13:49 owner 裁定，监理整理）

> 给另一个对话（test_suite 测试工程 lane）。你 2026-09-14 晚的停止并报告已收，owner 已逐项拍板。你可以恢复动手，按以下口径执行。

## 一、game_seconds 权威口径 → **选 A：仅由 UnitPositions 场景时钟决定**

- K21 数值断言**按 20.0 写期望值**（真实锚：`runs/m4-batch01/per_run/*/normalized/` + `m4_batch_manifest.json`，你实测 6 个 run 全中 [20.0,20.0,20.0]，直接采用）。
- SimInfo 死分支**不用你修**：已另立缺陷单 GAME-SECONDS-01（SimInfo 墙钟显式排除+四模块时间解析统一），由开发流水线在 EVENT-SEMANTICS-01 收口后施工。你只需在 K21 用例注释里写一句口径来源（"owner 2026-09-15 裁定：game_seconds=UnitPositions 场景时钟唯一"）。

## 二、3c 死锁回归 → **接受 C# 覆盖，Python 层不加占位**

- 该回归由 `tests/F1.AiAssistant.Tests/BRIDGE_FIX_01_ProbeTests.cs`（3 用例含看门狗反向探针）承担回归防线，test_suite/ 里**不加** requires_dotnet 占位说明用例。你的判断（无牙）与 owner 一致，此题关闭。

## 三、阻断项之外的开工许可 → **同意，但归属与顺序有调整**

1. **test_10/test_12 重写**：已完成，不用再动——5 个规格文件的 importorskip 守卫已落地，监理 13:4x 实跑整目录=109 passed/5 skipped/4 failed；4 个红全在 test_03_csv_normalize e2e，是 EVENT-SEMANTICS-01 r4 工单在修的已知项（r4 收口以零红为门）。README 验证状态描述如未同步请顺手对齐。
2. **K93（m4 血缘哈希口径）**：裁定为统一 LF 归一（raw 字节哈希留信息字段）——已立 M4-HASH-FIX-01，由流水线 aider 施工，**不归你**（tools/m4_report 在流水线 scope 内）。
3. **K20 判读规则测试补强、分层标记**：同意开工，但排在 EVENT-SEMANTICS-01 收口后由流水线统一派单（tools/metrics、csv_normalize 与在修 lane 同目录，避免写冲突）。你若想认领其中的 **test_suite/ 侧**（如分层标记在 pytest.ini 与规格文件的落法），先与监理对齐 scope 再动手。

## 四、纪律重申（不变）

- 真实数据锚点优先，禁止凭印象写期望值（你这次的四模块对照表就是范本，已记 knowledge.md K123）。
- 发现疑似缺陷继续"停止并报告"，不自行定性修生产代码。
