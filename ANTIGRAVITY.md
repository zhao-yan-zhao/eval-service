# F1-AI 项目反重力 (Antigravity) 智能体开发规范与工程准则 (ANTIGRAVITY.md)

> **版本**：v1.0.0  
> **适用对象**：Google Antigravity (反重力) AI 智能体及相关协作 Agent  
> **项目根目录**：`d:\project\F1-AI-demo-lua-structure-tools`  
> **核心原则**：先立三库，后接链路；数据驱动，证据溯源；单一真相，纯净契约；绝不造假，Fail-Closed。

---

## 0. 规范定位与执行原则

本文档为当前 F1-AI 项目及其核心子模块（推演评估中台 `eval-service/`）专门面向 **Google Antigravity (反重力)** 智能体的统一工程规范。反重力智能体在介入本项目进行架构探索、逻辑编写、测试验证或问题诊断时，必须严格执行本文档规定的各项纪律。

---

## 1. 代码探索与 CodeGraph 优先准则

针对已构建 CodeGraph 索引的代码库（存在 `.codegraph/` 目录）：

1. **优先调用 `codegraph_explore`**：
   - 当遇到代码探索、架构追溯、跨文件符号跳转、调用链路（Call Graph）分析或修改前的波及范围（Blast Radius）分析时，**必须优先使用 MCP 工具 `codegraph_explore`**，严禁未做代码定位直接全文暴力 grep 或遍历读取文件。
   - `codegraph_explore` 一次性返回带行号的精准源码与跨层调用链，返回的内容视为已阅读，杜绝无意义重复全量读取。
2. **代码检索与上下文保护**：
   - 对于非索引文件或特定正则搜索，配合使用标准查找工具；
   - 保持上下文纯净，批量执行独立检索操作。

---

## 2. 架构红线与施工边界 (Boundaries & Isolation)

1. **主仓库零入侵（Zero-Intrusion Rule）**：
   - 当前核心施工范围严格受限于独立的推演评估中台目录：[`eval-service/`](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/)。
   - **严禁修改主仓库既有保护工程**：
     - `CMO-netcore-src/`（C# 仿真桥与核心引擎代码）：受保护核心，严禁随意改动。
     - `LabConsole/`（实验控制台 Python 与 metrics 脚本）：只读引用，通过隔离临时目录适配。
     - `demo-ui/`（既有旧版态势前端）：只读复用其 `proxy/bs-diff.mjs`。
     - `integration/` 与主干历史脚本：保持完全解耦。
2. **环境与端口标准**：
   - 评估中台后端服务默认监听在 `http://127.0.0.1:7280`。
   - 健康检查端点：`GET /api/health`。

---

## 3. 实证门控铁律 (Fail-Closed，绝不造假)

1. **可溯源事实证据链**：
   - 军事仿真评估与战术反哺的核心价值在于真实、可复现、可溯源的推演事件证据链（以 44 类 CSV 与 BS 态势帧为准）。
2. **缺数必须返回 unavailable**：
   - 当推演日志缺失（例如缺少对应 CSV 底表、关键列数据为空、或 BS 帧中未命中目标航迹时），必须严格返回：
     ```json
     {
       "status": "unavailable",
       "missingDataReason": "明确的具体缺失原因（如：缺少 WeaponEndgame.csv 终态记录）"
     }
     ```
   - **严禁使用 `|| 0.85` 等默认降级值**，严禁随手编造任何未经实证推算的虚假指标糊弄通过。

---

## 4. 安全计算红线 (Zero `eval` & AST 沙箱)

1. **严禁原生动态执行**：
   - 严禁在任何逻辑中使用 JavaScript 原生 `eval()` 或 `new Function()` 执行用户输入或动态公式表达式。
2. **纯 AST 行内公式引擎**：
   - 所有行内公式衍生计算必须严格走 [`src/operators/formula-engine.ts`](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/operators/formula-engine.ts) 纯 AST 词法与递归下降语法树引擎。
3. **Python 脚本 AST 安全沙箱**：
   - V4 Python 算子脚本必须严格通过 [`src/engine/python-worker.ts`](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/engine/python-worker.ts) 与 [`src/engine/python_worker.py`](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/engine/python_worker.py) 的 AST 语法树安全沙箱执行。
   - 严禁绕过沙箱校验，严禁放行危险模块导入（如 `os`, `sys`, `subprocess`）及 `__builtins__` 越权访问。

---

## 5. 算子与流水线编排核心铁律 (Pipeline & Operator Invariants)

1. **单一真相源法则（Single Source of Truth，杜绝两套逻辑）**：
   - **画布即契约**：算子流水线画布（DAG）与算子元数据契约（`f1FieldContract`）必须强绑定，严禁出现“画布一套逻辑、配置弹窗另一套数据”的割裂。
   - 在保存或变更算子流水线时（`POST /api/operator-pipelines`），后端必须自动调用 `deriveContractFromNodes(nodes)` 解析底层数据依赖，自动提取涉及的 CSV 底表（`csvTables`）、核心字段列（`csvColumns`）、BS 帧路径（`bsFramePaths`）及空间参数，并自动写回 `operatorOverrideStore`（内置算子）或 `customOperatorStore`（自定义算子）。
   - 算子列表详情/配置弹窗原生提供 `[⚡ 从画布节点自动同步]` 双向通道，保持零冗余配置。
2. **纯净输出原则（Pure Output，杜绝下游列污染）**：
   - 算子节点输出**严禁使用 `...inputDataset` 将上游全部原始底表字段（动辄 20+ 列）直接向下展开透传**。
   - **空间几何节点（`spatial`）**：严格仅输出 9 个业务判定列：
     `MissionID`, `MissionName`, `UnitID`, `UnitName`, `ActiveDuration_s`, `InCorridorDuration_s`, `UnitComplianceRate`, `MinMargin_km`, `ComplianceStatus`。
   - **数据汇总节点（`group_agg`）**：严格仅输出配置指定的分组主键（`groupKeys`）与聚合度量列（`aggregations`）。
   - 确保下游算子配置抽屉中可选择的源数据列纯净精准（上游输出即下游可选）。
3. **蓝图样本强隔离（杜绝跨域样本串台）**：
   - 节点初始化和 Dry-Run 试算必须绑定其所属领域的算法蓝图（Blueprint）。
   - 空间合规算子必须注入走廊在勤样本，**严禁使用通用的超视距空战武器交战样本（`DEFAULT_SAMPLE_DATASET`）作为其他所有算子的默认兜底**。
4. **动态阵营与多语言自适应**：
   - 严禁在算子内部硬编码 `targetSide: 'Blue'` 或 `'Red'`。
   - 必须通过 [`src/operators/helpers.ts`](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/operators/helpers.ts) 中的 `resolveSides` / `matchSide` 动态解析中英文阵营标记（`'红方' / 'Red'`、`'蓝方' / 'Blue'`），确保同时自适应真机推演数据与历史测试日志。
5. **SVG 连线防退化守卫**：
   - 画布连线使用贝塞尔曲线与 SVG 线性渐变。当两节点处于同一水平线（`startY === endY`）时，SVG 包围盒高度为 0，会导致 `objectBoundingBox` 渐变实线完全隐形。
   - 必须在 [`CanvasConnectionLines.tsx`](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/ui/components/pipeline-canvas/CanvasConnectionLines.tsx) 中保持亚像素微偏移（`safeEndY = startY + 0.05`）与纯色基座线，确保水平直线与曲线具有一致的扎实青色实线底座与流动光效。

---

## 6. 仿真数据特异性防坑字典 (Simulation Quirks)

1. **双 UTF-8 BOM 剥除**：
   - F1 引擎导出的 CSV 普遍存在双重 UTF-8 BOM 头，必须通过 `csv-adapter.ts` 统一清洗，严禁直接按字节切分。
2. **武器误算为战损防范**：
   - 引擎在 `UnitDamaged.csv`、`UnitPositions.csv` 中会将飞行中的导弹标记为中文 `UnitType = "武器"`。
   - 统计作战单元战损与平台价值时，**必须显式调用 `isWeaponType` 过滤 `UnitType == "武器"`**，严禁将导弹自毁或消耗误计为己方飞机战损！
3. **`WeaponEndgame.csv` 双行去重**：
   - 一枚导弹在终态事件中常输出双 ROW（命中判定行与点防系统事件行），必须按 `WeaponID` 归并去重，并剔除 `"No point defence systems employed"` 虚构分母。
4. **44 表与 333 规范字段索引**：
   - 引用任何底表与字段时，必须严格查对 [`sim-output-fields/schemas/f1-output-catalog.json`](file:///d:/project/F1-AI-demo-lua-structure-tools/sim-output-fields/schemas/f1-output-catalog.json)，严禁臆造不存在的表名或列名。

---

## 7. 三库分层、SQLite 数据库持久化与运筹学约束 (Three-Library & Persistence Invariants)

1. **三库全量入库持久化（Database-First Persistence）**：
   - 一库（算子定义、算子覆盖配置与算子流水线）、二库（指标定义与 V4 指标 DAG 图 `MetricGraphStore`）、三库（评估体系树与 V4 效果 DAG `EffectStore` / `SystemDagStore`）的**全部数据必须持久化存储到 SQLite 数据库**（[`src/adapters/sqlite-store.ts`](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/adapters/sqlite-store.ts)，默认库文件 `data/eval.db`）。
   - 严禁将用户新增、编辑的算子/指标/体系或运行期状态仅保存在纯内存或零散 JSON 文件中；内置静态配置（如 `src/indicators/catalog.json`、`src/effects/presets.json` 及内置 V1-V4 算子定义）仅作为初始化种子数据同步入库。
2. **一库 ➔ 二库 ➔ 三库 DAG 绑定**：
   - 传统指标定义中的 `atomRef` 与 V4 指标 DAG 节点必须绑定到一库内置算子（含 V1/V2/V3/V4 体系）或自定义算子；
   - 指标的 `targetField` 必须精确匹配算子/流水线末端节点的产出字段；V4 体系通过 `/api/v4/*` 与全阵营同屏对比（`compare-sides`）贯通。
3. **三库体系树权重完整性**：
   - 评估体系树与效果 DAG 同级入边权重之和必须严格满足 $\sum = 1.0000 \pm 1e-4$；
   - 某维度缺数导致 `unavailable` 时，通过 `availableWeightRatio` 自动重新归一化（或按门控规则处理），严禁强改原始体系定义。
4. **MCDA 运筹学严谨性**：
   - 调用 Python AHP 算法时，成对比较判断矩阵必须满足 Saaty 一致性比率 $CR < 0.10$。

---

## 8. 验证与交付守则 (Verification & Quality Protocol)

1. **全套自动化测试必须全绿**：
   - 任何核心逻辑、适配器、算子、数据库持久化或 API 修改后，必须在终端执行：
     ```bash
     npm --prefix eval-service test
     ```
   - 必须确认**全量自动化测试 100% 通过（0 fail）**。
2. **严禁篡改测试断言硬凑通过**：
   - 测试报错代表真实业务或契约冲突，必须定位并修复实现逻辑，严禁以放宽条件、删除断言的方式伪造通过。
3. **生产构建验证**：
   - 涉及前端 UI、组件或类型变更后，必须执行前端生产打包测试：
     ```bash
     npm --prefix eval-service run build:ui
     ```
   - 确保 Vite 打包产物正常输出至 `dist-ui/`，无任何 TypeScript 类型阻断。

---

## 9. 反重力 (Antigravity) 智能体专属执行准则

1. **批处理优先（Work Efficiently）**：
   - 独立的文件读取、代码探查或状态检查必须在单个 turn 中并行批量发起，避免单步反复试探。
2. **Windows 路径与命令兼容**：
   - Shell 命令运行在 Windows PowerShell 环境下，文件路径使用反斜杠或标准 Windows 路径格式，文件超链接在 Markdown 中统一遵循 `file:///` 规范。
3. **透明可追溯输出**：
   - 在向用户提交修改报告时，清晰列出修改的文件、修改原因以及全套测试执行结果证据（包含测试用例通过数与耗时）。
