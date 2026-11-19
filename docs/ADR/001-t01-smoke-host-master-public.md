# F1 Smoke 宿主约定（T01 起）

- **状态**：已确认（2026-08-11）
- **选择**：方案 A — 使用 `Master_Public` 运行时作为 L3 Smoke / T01 PoC 默认宿主
- **放弃**：不把 `Master_Public` 内现成 `.license` 拷到 `F1-AI\F1`（非本机授权）

## 默认宿主

| 项 | 路径 |
|---|---|
| 工作目录 | `D:\soft\Master_Public\F1` |
| 可执行文件 | `D:\soft\Master_Public\F1\F1-Console.exe` |
| WritableRoot | `D:\soft\F1\F1-测试`（内含 `GIS\LandCover`） |

## 不用作默认宿主

| 项 | 路径 | 原因 |
|---|---|---|
| 本仓库输出 | `D:\soft\F1-AI\F1\F1-Console.exe` | 缺本机有效注册时会弹窗；本阶段不依赖拷贝他机 license |

## 只读转换命令模板

```text
工作目录: D:\soft\Master_Public\F1
D:\soft\Master_Public\F1\F1-Console.exe -R "<工作副本.scen>" -C "<run临时目录\out.xml>"
```

约束：禁止 `-AUTORUN`；禁止改原始 `.scen`；超时强杀；不修改 Console 源码。

## 验证记录（2026-08-11）

- 产物：`runs/T01.1/master-host-verify.json`
- 结果：转换成功；`scene_title=TEST`；`side_count=2`；`unit_count=2`；源 hash 不变；未观察到注册弹窗日志；约 46s 正常退出（本次未超时）
