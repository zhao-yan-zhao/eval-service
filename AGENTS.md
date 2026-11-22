# F1-AI 项目 AI 智能体开发规范与提示词 (AGENTS.md)

> 本文件为整个工作区各 AI 编程助手（Cursor / Claude Code / Antigravity / Windsurf / Codex）的统一入口规范。

## 一、 子项目分工与施工边界

1. **推演评估中台服务 (`eval-service/`)**：
   - 当前正在高频迭代的核心独立服务（Node 24 + TypeScript + React 19 + Python MCDA）。
   - **详尽开发铁律与防坑指南请务必读取**：[`eval-service/AGENTS.md`](eval-service/AGENTS.md) 与 [`eval-service/.cursorrules`](eval-service/.cursorrules)。
   - 核心原则：零入侵主仓库、单一真相源（画布自动同步契约）、纯净契约输出、Fail-Closed 实证门控、全量 50 项测试通过（`npm --prefix eval-service test`）。

2. **既有主干工程（只读受保护）**：
   - `CMO-netcore-src/`（C# 仿真桥与核心引擎代码）：严禁随意改动，须通过独立测试与严格审查。
   - `LabConsole/`（实验控制台 Python 与 metrics 脚本）：只读引用，通过隔离临时目录适配。
   - `demo-ui/`（既有旧版态势前端）：只读复用其 `proxy/bs-diff.mjs`。

---

## 二、 核心纪律总结

1. **实证优先，绝不伪造**：仿真评估与战术反哺严格以真实事件链（44 类 CSV 与 BS 帧）为依据，缺数时返回 `unavailable`，严禁编造默认数值。
2. **严防穿透与列污染**：算子节点流转遵循纯净输出，禁止上游 raw 底表列污染下游。
3. **测试驱动，全绿交付**：每次改动必须执行自动化测试，绝不修改断言硬凑通过。
