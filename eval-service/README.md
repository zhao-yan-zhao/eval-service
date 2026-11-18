# F1 推演评估中台服务 (`eval-service`)

遵循 [总体设计方案](../docs/推演评估中台总体设计方案.md) 构建的独立、前后端一体化仿真推演评估中台服务，严格保持对既有主仓库代码（`CMO-netcore-src/`、`demo-ui/`、`LabConsole/` 等）**零入侵、零修改**。

---

## 核心架构：三库分层 + 可视化流水线画布 + 双引擎模式 + 冷热存储

1. **一库 · 原子算子库 (`src/operators/`) 与流水线画布编排 (`src/ui/components/pipeline-canvas/`)**
   - 注册 **38 个内置标准物理算子** + **安全自定义衍生/数据源直连算子引擎 & 就地覆写存储**（零 `eval`/`Function` 公式 DSL 与 CSV 表列 / BS JSONL 路径直连聚合 `source-extractor.ts`，持久化于 `data/custom-operators.json` 与 `data/operator-overrides.json`），覆盖五大领域：
     - 时间域 (`time.*`, 9 个)
     - 效能域 (`eff.*`, 12 个，联动 `LabConsole/tools/metrics/metrics.py`、`csv_normalize.py` 与目标识别率等)
     - 态势域 (`sit.*`, 8 个，基于 `@turf/*` WGS84 椭球几何与球面单调链凸包算法)
     - 合规/条令域 (`comp.*`, 5 个，含航路走廊空间遵从、WRA 准则、雷达静默纪律等)
     - 成本/效费域 (`cost.*`, 4 个)
   - **可视化算法流水线画布编排器 (`PipelineCanvasStudio`)**：
     - 支持 6 类核心 DAG 节点：`data_input`（多源 CSV/BS 状态流输入与动态筛选）、`inline_calc`（行内公式衍生计算）、`group_agg`（跨行多主键流式分组聚合）、`spatial`（Turf.js 4D 走廊空间几何求解）、`python_script`（Python 科学计算模型与脚本）及 `result_output`（直通二库指标输出）。
     - **AST 行内公式衍生内核 (`src/engine/libformula/`)**：纯 TypeScript 递归下降解析器，支持四则运算、结合律括号、20+ 逻辑/数学/文本/日期内置函数、除零保护与空值安全隐式转换。
     - **流式多主键跨行分组聚合引擎 (`src/engine/aggregation.ts`)**：支持复合多分组主键 (`groupKeys`) 与 11 种统计方法（`AVERAGE` / `SUM` / `MAX` / `MIN` / `COUNT_ALL` / `COUNT_DISTINCT` / `COUNT_NON_EMPTY` / `STDEV` / `STDEVP` / `FIRST` / `LAST`）。
     - **单一真相源（Single Source of Truth）双向自动同步架构**：
       - 画布保存（`POST /api/operator-pipelines`）时，后端自动通过 `deriveContractFromNodes(nodes)` 解析底层数据依赖，提取 44 类 CSV 底表、核心字段列、空间参数与输出度量，直接写回内置覆写库或自定义算子库，数据契约零冗余。
       - 算子列表详情/配置弹窗原生集成 `[⚡ 从画布节点自动同步]` 按钮，打通【画布编排】与【算子配置】双向通道。
       - **血缘分析（`lineage-analyzer.ts`）与纯净输出原则**：节点间严格仅透传自身计算与衍生字段，杜绝上游 raw 底表列向下穿透污染下游配置。
   - Python 科学计算算法适配 (`python/mcda_algorithms.py` via `numpy` + `scipy`)：支持 AHP 层次分析法特征根定权及 Saaty `CR < 0.10` 一致性检验、Shannon 信息熵权法与多方案 TOPSIS 排序。
   - **实证门控 (Fail-Closed)**：针对 `GJ-11` 与 `BS` 帧数据差异（参见 [`sim-output-fields/schemas/f1-output-catalog.json`](../sim-output-fields/schemas/f1-output-catalog.json) 中的 `D1`–`D9`），缺数时返回 `status: "unavailable"` 与明确 `missingDataReason`，绝不伪造默认值；同时排除中文 `UnitType = "武器"` 及过期弹药以防止导弹误计作平台战损，并对双 ROW `WeaponEndgame.csv` 按 `WeaponID` 去重与剔除 `"No point defence systems employed"`。
2. **二库 · 标准指标库 (`src/indicators/`)**
   - [`catalog.json`](src/indicators/catalog.json) 预置 21 项标准评估指标，支持 0–100 分值归一化映射曲线（线性正/逆向、区间/Sigmoid 等）与在线 Q-109 告警门限绑定。
   - 支持可视化新增与删除自定义指标，持久化存储于 `data/custom-indicators.json`。
3. **三库 · 评估体系库 (`src/systems/`)**
   - 内置 4 套经过校验的预置评估体系（[`src/systems/presets/`](src/systems/presets/)）：
     - `sys_bvr_air_combat_v1`：超视距空战 (BVR) 杀伤链与费效评估体系
     - `sys_littoral_swarm_v1`：无人艇/机近岸集群饱和突击评估体系
     - `sys_air_defense_v1`：区域防空反导体系拦截评估体系
     - `sys_asw_barrier_v1`：海上反潜巡逻与航道封锁评估体系
   - 内置层级权重校验器（要求同级 `∑ = 1.0000 ± 1e-4`、无环引用、合法底层引用）、自动权重归一化、自底向上树形聚合（缺失维度自动按 `availableWeightRatio` 重归一），并输出兼容 `eval-summary.json v2` 的结果契约。
4. **双引擎与多视角数据底座 (`src/realtime/`, `src/reports/`, `src/nl/`, `src/adapters/`)**
  - **全局仿真输出规范目录**：展示 F1 仿真引擎 `7` 大输出通道、`EventExporter` `44` 类标准事件 / `333` 个业务字段（含 `cs_type` / DB 列类型 / `call_sites` / 门控与分边键）、`BS MQTT` `7` 族 `74` 条规范路径、`8` 条跨表 Join 配方与 `D1–D9` 实证偏差（不绑定具体推演 Run），并支持跨表字段与依赖算子反查。
  - **离线全量评估引擎**：基于 Node 24 原生 `node:sqlite` (`WAL` + `foreign_keys`) 管理 `simulation_runs`、`simulation_events`、`unit_states`、`eval_results`、`realtime_cards` 五张冷热分离数据表；空库首次启动自动播种 `gj11_pl15_bvr_real`（真实双 BOM `EventExport_CSV`）与 `bs_sample_swarm_demo`（BS 状态帧 JSONL），并支持针对单局 Run 的离线来源表/BS JSONL 路径命中剖析与前 50 行预览。
  - **Q-109 在线伴随监视引擎**：复用 `demo-ui/proxy/bs-diff.mjs` 实现增量帧差分摄取、阈值研判卡片、300s (5 分钟) 防刷屏冷却、minor → major 升级与 HITL 三态处置（`observe` / `pause_inspect` / `ignore_expected`）。
  - **报告、战术反哺与 NL-to-Metrics**：生成事实/推断/证据三栏隔离 Markdown 报告、符合 `https://f1-ai.schema/tactical-feedback/v1.json` 契约的战术补丁 JSON，以及自然语言意图到评估体系 DSL 草案生成器。

---

## 快速启动与常用命令

> 运行前请确保 Node.js >= 24（内置 `node:sqlite`）及 Python 3.10+（含 `numpy`、`scipy`、`pandas`）。

```bash
cd eval-service

# 1. 安装前端与服务依赖（首次）
npm install

# 2. 构建战术指挥台前端静态包（输出至 dist-ui/）
npm run build:ui

# 3. 启动评估中台服务（默认监听 http://127.0.0.1:7280，同时托管 REST/SSE API 与 Web UI）
npm start
```

开发联调与检验命令：

```bash
# 仅启动前端 Vite 开发服务器（端口 5280，代理后端 API）
npm run dev:ui

# 监听模式运行后端 API（端口 7280）
npm run dev:server

# TypeScript 严格类型检查
npm run typecheck

# 全套自动化测试（Stage 1~4 核心与后端 + Stage 5~6 UI 测试 + Stage 7~9 数据规范与算子工坊 + Stage 10~13 流水线 AST/聚合/单一真相源自动同步，全量 50 项测试通过）
npm test
```

环境变量：
- `HOST` / `PORT`：覆盖默认监听地址与端口（默认 `127.0.0.1:7280`）。
- `PLAYWRIGHT_EXECUTABLE_PATH` / `E2E_SCREENSHOT_DIR`：指定浏览器测试路径或保存 E2E 全页面截图。

---

## REST 与 SSE API 概览 (`src/server.ts`)

| 类别 | 接口路径 | 说明 |
| --- | --- | --- |
| 基础与契约 | `GET /api/health`、`GET /api/fields-catalog`、`GET /api/schema/catalog`、`POST /api/schema/catalog` | 服务健康状态、F1 实证字段契约及全局事件字段规范字典 |
| 流水线编排 | `GET /api/operator-pipelines/:opId`、`POST /api/operator-pipelines` | 算子专属算法流水线拓扑持久化、蓝图与契约推导检索、画布保存自动回写单一真相源 |
| 一库算子 | `GET /api/operators`、`POST /api/operators`、`PUT /api/operators/:id`、`DELETE /api/operators/:id`、`DELETE /api/operators/:id/override`、`GET /api/operators/categories`、`POST /api/operators/preview`、`POST /api/operators/validate-formula`、`POST /api/operators/preview-formula`、`POST /api/operators/evaluate-all`、`POST /api/operators/compare-runs`、`POST /api/operators/:id/evaluate`、`POST /api/operators/:id/sweep` | 算子元数据检索、内置覆写/恢复默认、自定义衍生算子 CRUD、公式语法与 AST 变量校验、DAG 节点 Dry-Run 试算预览、双 Run 对比与敏感性扫描 |
| 二库指标 | `GET /api/indicators`、`POST /api/indicators/preview-curve`、`POST /api/indicators`、`DELETE /api/indicators/:id` | 指标库管理与评分曲线采样预览 |
| 三库体系 | `GET /api/systems`、`POST /api/systems/validate`、`POST /api/systems`、`DELETE /api/systems/:id`、`POST /api/systems/draft-nl` | 体系 CRUD、权重校验与 NL-to-Metrics 草案生成 |
| 多准则决策 | `POST /api/mcda/ahp`、`POST /api/mcda/entropy`、`POST /api/mcda/topsis` | 调用 Python NumPy/SciPy 执行 AHP / 熵权 / TOPSIS |
| 数据与评估 | `GET /api/runs`、`POST /api/runs/import`、`GET /api/runs/:id`、`GET /api/runs/:id/events`、`GET /api/runs/:id/tracks`、`GET /api/runs/:id/source-profile`、`POST /api/evaluate`、`GET /api/evaluations`、`GET /api/evaluations/:id` | 场次入库、事件/航迹检索、离线 CSV/BS JSONL 源文件剖析（支持 `previewTable`/`previewLimit`）与三库综合评估执行 |
| 实时 Q-109 | `GET /api/realtime/stream`、`POST /api/realtime/sessions`、`GET /api/realtime/sessions/:id`、`POST /api/realtime/sessions/:id/control`、`POST /api/realtime/sessions/:id/cards/:cardId/action` | SSE 增量帧推送、倍速/步进控制、异常注帧与 HITL 人工裁决 |

---

## 阶段验收日志

完整里程碑与实测记录见 [`MILESTONE-LOG.md`](MILESTONE-LOG.md)。
