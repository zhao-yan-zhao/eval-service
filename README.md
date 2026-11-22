# F1-AI 体系推演智能实验平台

本工程是围绕 F1 / CMO 仿真推演引擎构建的体系推演、智能辅助决策与效能评估实验平台。

---

## 📖 核心介绍文档

- **新协作者必读**：[系统总体介绍-给新协作者-20261022.md](./系统总体介绍-给新协作者-20261022.md)
- **平台架构与能力介绍**：[系统介绍-F1-AI体系推演智能实验平台-20261009.md](./系统介绍-F1-AI体系推演智能实验平台-20261009.md)
- **历史工单与过程归档**：[docs/archive-records/](./docs/archive-records/)（收录前期提示词、返修工单、看板与验收记录）

---

## 🗂️ 核心工程目录

| 目录 / 模块 | 说明 | 技术栈 |
| :--- | :--- | :--- |
| **`eval-service/`** | **F1 仿真推演评估中台服务**<br/>三库分层（一库算子/二库指标/三库体系）、算子流水线画布工坊、MCDA 综合决策、Q-109 实时伴随监视与战术反哺 | Node.js (TypeScript) + React + Tailwind + Python (MCDA) + SQLite |
| **`CMO-netcore-src/`** | Command / CMO 仿真引擎底层与业务核心源码 | C# / .NET Core |
| **`demo-ui/`** | 推演控制台与态势可视化前端交互界面 | Vue / TypeScript / Vite |
| **`LabConsole/`** | 实验控制台、推演自动化执行驱动与指标统计脚本库 | Python / Shell |
| **`docs/`** | 系统架构方案、设计图谱与历史归档目录 | Markdown |

---

## 🚀 推演评估中台 (`eval-service`) 快速启动

```bash
cd eval-service

# 1. 安装依赖
npm install

# 2. 构建前端
npm run build:ui

# 3. 启动评估中台服务（默认端口 7280，前端页面与 REST API 一体化托管）
npm start
```
