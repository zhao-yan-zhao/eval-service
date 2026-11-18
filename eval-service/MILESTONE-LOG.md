# F1 推演评估中台 (`eval-service`) 最小阶段演进与验收日志

> 严格遵循 [`docs/推演评估中台总体设计方案.md`](../docs/推演评估中台总体设计方案.md)“先立三库，后接链路；数据驱动，证据溯源；绝不修改既有主干源码”原则，以及 [`sim-output-fields/`](../sim-output-fields/README.md) 实证字段契约。  
> 每完成一个最小可运行、可验证阶段即在此追加一条记录（含实现范围、引用开源组件、实测验证命令与通过数据、已知边界），供次日逐项验收。

---

## Stage 0：独立工程骨架、依赖与测试基础设施（已完成 ✅）

- **开始时间**：2026-11-12 01:18 ｜ **验收时间**：2026-11-12 01:20
- **执行目标**：在顶层独立目录 `eval-service/` 建立 TypeScript + Vite React 19 + Node 24 (`node:sqlite`) + Python (`metrics.py` / `scipy` / `numpy`) 混编工程骨架，确保与既有 `demo-ui/`、`LabConsole/`、`CMO-netcore-src/` 物理隔离。
- **核心选型与开源依赖**：
  - 地理与几何算法：`@turf/distance`、`@turf/boolean-point-in-polygon`、`@turf/helpers`（WGS84 测地距与多边形走廊判定）
  - 可视化图表：`echarts`（Apache 2.0，用于多维体系雷达图、评分映射预览曲线、时空散点航迹、对比柱图、时序轴）
  - 前端与图标：`react` 19、`tailwindcss` v4、`lucide-react`、`markdown-it`
  - 存储与运筹算法：Node 24 原生 `node:sqlite` (`DatabaseSync`) + Python 3.10 (`pandas 2.0.3` / `numpy` / `scipy` 实现 AHP、熵权法、TOPSIS 及对接 `LabConsole/tools/metrics/metrics.py`)
  - 浏览器视觉与交互自检：`playwright-core` 驱动本机 Microsoft Edge
- **产出文件**：`eval-service/package.json`、`eval-service/tsconfig.json`、`eval-service/vite.config.ts`、`eval-service/.gitignore`、`eval-service/MILESTONE-LOG.md`。
- **实测结果**：`npm install` 安装 112 个依赖包成功；`node:sqlite` 与 `pandas 2.0.3`/`scipy`/`numpy` 均已在本地环境确认可用。

---

## Stage 1：三库领域契约、真机字段适配底座与评分纯函数（已完成 ✅）

- **完成时间**：2026-11-12 01:22
- **实现范围**：
  - [`src/core/types.ts`](src/core/types.ts)：定义算子 (`MetricAtomMeta/Context/Result`)、指标 (`IndicatorDefinition/ScoringRule`)、体系 (`IndicatorSystem`)、`SituationModel`、`TelemetryCoverage`、`EvalSummaryV2`、`TacticalFeedbackPayload` 全套强类型契约。
  - [`src/core/time-utils.ts`](src/core/time-utils.ts)：统一兼容 ISO-8601、18 位 `.NET Ticks` 串、C# `TimeSpan 'c'`（含跨天 `[d.]hh:mm:ss`）以及美式 `MM/dd/yyyy HH:mm:ss.fff`。
  - [`src/core/scoring-functions.ts`](src/core/scoring-functions.ts)：实现 `linear` / `smaller_is_better` / `larger_is_better` / `step` / `boolean` 归一化纯函数及曲线采样预览，对 `null`/非有限数严格 fail-closed 返回 `null`。
  - [`src/adapters/frame-adapter.ts`](src/adapters/frame-adapter.ts)：直接复用 `demo-ui/proxy/bs-diff.mjs`（保留容器缺失防误报、单调事件 ID 与敏感键脱敏），并补足真机 Q-077 `unwrapEntity` 单键剥壳、字符串数值转换 (`CH/CS/CA/LonLR/LatLR`)、`SideID -> SideName` 映射、`Sensors[].Sensor.Active` 与任务参考点多边形解析。
  - [`src/adapters/csv-adapter.ts`](src/adapters/csv-adapter.ts)：针对 `sim-output-fields` 核查结果，自动剥除引擎原始 CSV 的**双 UTF-8 BOM**、兼容 `UnitDamaged.csv`/`Damage.csv` 别名、剥离 `WeaponName` 的 `#\d+` 实例序号后缀、强制按单 `TimelineID` 隔离并附带精确物理行号 (`CSV:<file>#L<line>`)。
  - [`src/core/situation-model.ts`](src/core/situation-model.ts)：统一支持 BS JSONL、EventExporter CSV 与 Hybrid 融合构建。
- **实测验证**：
  - `npx tsc --noEmit`：通过（退出码 `0`）。
  - `npx tsx --test tests/stage1-core.test.ts`：**5/5 通过**，覆盖 `demo-ui/proxy/testdata/bs-frames-sample.jsonl`、模拟真机 Q-077 包装帧，以及仓内真实双 BOM BVR 试验目录 `LabConsole/outputs/m6-verify-runs/.../GJ11-PL15试射-90nm正对-80nm-1`。
- **已知边界**：实测 `LabConsole/tools/csv_normalize/csv_normalize.py` 依赖 `event_semantics/registry.json` 白名单（未包含 `Expenditures.csv`、`WeaponEndgame.csv` 等全量事件），后续 Stage 2 Python 适配器需只将白名单内表分阶段投喂 `metrics.py`，其余原生表由 `csv-adapter.ts` 全量接管。


---

## Stage 2：一库全量 21 算子、科学适配链路与 Python MCDA 引擎（已完成 ✅）

- **完成时间**：2026-11-12 01:38
- **实现范围**：
  - **21 个独立核心算子**（按 5 大能力域分包实现并在 [`src/operators/registry.ts`](src/operators/registry.ts) 注册）：
    - 时效域 [`src/operators/time/index.ts`](src/operators/time/index.ts)（6 个）：`time.first_detection`、`time.first_weapon_fire`、`time.detect_to_fire_latency`、`time.first_target_hit`、`time.combat_duration`、`time.blind_zone_duration`。
    - 效能域 [`src/operators/effectiveness/index.ts`](src/operators/effectiveness/index.ts)（6 个）：`eff.mission_success_rate`（Wilson 95% CI，严格拒绝无判据造假）、`eff.hit_rate`（按 `WeaponID` 归并终态，避免 `POINTDEF:FAILURE` 重复行误计数）、`eff.kill_efficiency`、`eff.attrition_balance`、`eff.engagement_cycles_count`（60s 波次切片）、`eff.target_penetration_rate`（Batch B，过滤 `"No point defence systems employed"` 虚构分母）。
    - 态势域 [`src/operators/situation/index.ts`](src/operators/situation/index.ts)（4 个）：基于 `@turf/distance` 与 `@turf/boolean-point-in-polygon` 实现 `sit.standoff_advantage`、`sit.formation_dispersion`、`sit.geometry_arrival_delta`、`sit.area_coverage_ratio`。
    - 合规域 [`src/operators/compliance/index.ts`](src/operators/compliance/index.ts)（3 个）：`comp.corridor_compliance`、`comp.wra_compliance`、`comp.emcon_silence_discipline`。
    - 成本域 [`src/operators/cost/index.ts`](src/operators/cost/index.ts)（2 个）：`cost.munitions_cost_total`、`cost.economic_exchange_ratio`（严格识别中文原生 `UnitType="武器"` 防止导弹与平台价值混算，无单价时 fail-closed）。
  - **既有科学链路复用与真机 CSV RFC4180 修复**：
    - [`src/operators/effectiveness/metrics-py-adapter.ts`](src/operators/effectiveness/metrics-py-adapter.ts)：在临时隔离目录中暂存白名单 CSV 并做新版列名向 `registry.json column_aliases` 的无损投影，实测成功驱动 `LabConsole/tools/csv_normalize/csv_normalize.py` -> `metrics.py`。
    - 实测真机 `WeaponEndgame.csv` 发现第 9-10 行引号内含换行及 `UnitDestroyed` 输出中文 `"武器"` 后，已在 [`src/adapters/csv-adapter.ts`](src/adapters/csv-adapter.ts) 升级为全状态 RFC4180 多行切分器 (`splitCsvRecords`)，并在 [`src/operators/helpers.ts`](src/operators/helpers.ts) 抽离共享 `isWeaponType` / `isNonWeaponDamageEvent`。
  - **多准则决策分析 (MCDA) 算法引擎**：
    - [`python/mcda_algorithms.py`](python/mcda_algorithms.py) + [`src/operators/mcda-adapter.ts`](src/operators/mcda-adapter.ts)：使用 `numpy 1.25.2` + `scipy 1.15.3` 实现 AHP 特征根权重及 Saaty `CR < 0.10` 一致性检验、Shannon 信息熵权法 (`entropy_weights`) 及 TOPSIS 逼近理想解排序 (`topsis_rank`)。
- **实测验证**：
  - `npx tsc --noEmit`：通过（退出码 `0`）。
  - `npx tsx --test tests/stage1-core.test.ts tests/stage2-operators.test.ts`：**10/10 通过**（Stage 1 5 个 + Stage 2 5 个，覆盖真实 `GJ11-PL15` 全流程、`metrics.py` 子进程联动、BS 样本、`@turf` 空间几何及 AHP/熵权/TOPSIS 验证）。
- **经验记录**：真机新版 `EventExporter` 的 `WeaponFired.csv` 多出 `FiringUnitID` 等 29 列，且 `UnitType` 为中文 `"武器"`；在独立服务中以临时投影+通用类型识别解决，主仓库零改动。


---

## Stage 3：二库指标库、三库四套预置体系、树校验与合成评估引擎（已完成 ✅）

- **完成时间**：2026-11-12 01:40
- **实现范围**：
  - [`src/indicators/catalog.json`](src/indicators/catalog.json) 与 [`src/indicators/store.ts`](src/indicators/store.ts)：内置覆盖全 21 算子的标准指标库，支持自定义指标 CRUD、持久化至 `data/custom-indicators.json`，并严格校验 `atomRef` 存在性与评分参数范围。
  - [`src/systems/presets/`](src/systems/presets/)（4 套预置体系 JSON）：
    - [`bvr-air-combat.json`](src/systems/presets/bvr-air-combat.json)：超视距空战 (BVR) 杀伤链与费效评估体系
    - [`littoral-swarm.json`](src/systems/presets/littoral-swarm.json)：无人艇/机近岸集群饱和突击评估体系
    - [`air-defense.json`](src/systems/presets/air-defense.json)：区域防空反导体系拦截评估体系
    - [`asw-barrier.json`](src/systems/presets/asw-barrier.json)：海上反潜巡逻与航道封锁评估体系
  - [`src/systems/validator.ts`](src/systems/validator.ts) 与 [`src/systems/store.ts`](src/systems/store.ts)：实现同级权重 `∑ = 1.0 ± 1e-4`、无环引用、底层算子与指标完整性校验、自动归一化助手 (`normalizeSystemWeights`) 与自定义体系存储。
  - [`src/systems/evaluator.ts`](src/systems/evaluator.ts)：实现自底向上树形加权聚合、缺数维度有效权重重归一与可信度标注（`availableWeightRatio`）、并同步输出完全兼容 `demo-ui` 的 `eval-summary.json v2` 契约 (`kpis / bars / radar / evidenceTimeline / conclusion`)。
- **实测验证**：
  - `npx tsc --noEmit`：通过（退出码 `0`）。
  - `npx tsx --test tests/stage1-core.test.ts tests/stage2-operators.test.ts tests/stage3-systems.test.ts`：**13/13 通过**（Stage 1~3 全回归通过），实测 `sys_bvr_air_combat_v1` 评估真实 `GJ11-PL15` 顺利生成总分、四维雷达与证据时间轴，`sys_littoral_swarm_v1` 评估 BS 帧样本时 Batch B 缺省算子保持 `unavailable` 且权重合法重归一。



---

## Stage 4：冷热存储 SQLite、报告与反馈生成、NL-to-Metrics、实时 Q-109 引擎与 REST/SSE 服务（已完成 ✅）

- **完成时间**：2026-11-12 08:15
- **实现范围**：
  - [`src/adapters/sqlite-store.ts`](src/adapters/sqlite-store.ts)：基于 Node 24 原生 `node:sqlite` (`DatabaseSync`, `WAL` 模式 + `foreign_keys`) 实现冷热分层持久化，管理 `simulation_runs`、`simulation_events`、`unit_states`、`eval_results`、`realtime_cards` 五张核心表。
  - [`src/reports/report-generator.ts`](src/reports/report-generator.ts) 与 [`src/reports/feedback-generator.ts`](src/reports/feedback-generator.ts)：严格执行“观察事实 / 模型推断 / 证据依据”三栏隔离输出 Markdown 评估报告，并生成符合 `https://f1-ai.schema/tactical-feedback/v1.json` 契约的战术反馈与 `recommendedDoctrinePatches`（附置信度与可追溯证据引用）。
  - [`src/nl/intent-mapper.ts`](src/nl/intent-mapper.ts)：实现确定性 NL-to-Metrics 意图解析器，将自然语言作战评估需求直接映射为通过校验器检查的 `IndicatorSystem` DSL 草案。
  - [`src/realtime/monitor.ts`](src/realtime/monitor.ts)：复用 `initFrameIngestion` / `ingestFrameLine` 实现增量帧摄取与 Q-109 实时监测引擎，内置阈值触发、300s (5 分钟) 防刷屏冷却、minor → major 升级唤醒、倍速回放控制以及 HITL 三态人工响应（`observe` / `pause_inspect` / `ignore_expected`）。
  - [`src/server.ts`](src/server.ts)：独立 HTTP + SSE 服务（默认 `127.0.0.1:7280`），空库首次启动自动播种 `gj11_pl15_bvr_real` 与 `bs_sample_swarm_demo` 双模态样本，提供完整一/二/三库管理、评估计算、TOPSIS 对比、NL 解析、AHP 定权、Q-109 SSE 实时流及静态 `dist-ui/` SPA 托管。
- **实测验证**：
  - `npx tsx --test tests/stage4-engine-api.test.ts` 与全量 Stages 1~4 回归：**14/14 通过**（覆盖真实与仿真回放样本自动入库、TOPSIS 对比、Markdown 报告/战术反馈 JSON、NL-to-Metrics 草案及 Q-109 防刷屏+升级+HITL 闭环）。


---

## Stage 5：战术指挥台 Web UI 构建（已完成 ✅）

- **完成时间**：2026-11-12 08:25
- **实现范围**：
  - [`index.html`](index.html)、[`src/ui/styles.css`](src/ui/styles.css)、[`src/ui/main.tsx`](src/ui/main.tsx)、[`src/ui/App.tsx`](src/ui/App.tsx) 与 [`src/ui/api.ts`](src/ui/api.ts)：构建深色战术态势主题（`color-scheme: dark`、`accent-color: #22d3ee`、`scrollbar-gutter: stable`、响应式横向滚动表格 `tabindex="0"`、标准 `<dialog>` 原生模态与 `aria-selected`/`hidden` 无障碍标签页架构）。
  - [`src/ui/components/EChartPanel.tsx`](src/ui/components/EChartPanel.tsx)：封装 ECharts 6 响应式图表面板，支持雷达图、柱状图、时序评分曲线、目标航迹散点与因果时间轴渲染。
  - 六大核心交互工作台视图（[`src/ui/components/`](src/ui/components/)）：
    1. [`CockpitView.tsx`](src/ui/components/CockpitView.tsx)：评估总控台（KPI 卡片、四维雷达与红蓝条形图、证据溯源 `<dialog>`、多方案 TOPSIS 排序对比、Markdown 报告与战术反馈补丁面板）。
    2. [`OperatorLibraryView.tsx`](src/ui/components/OperatorLibraryView.tsx)：算子工作台（一库 21 算子可排序检索表、批次/可用性过滤与单算子在线试算沙箱）。
    3. [`IndicatorStudioView.tsx`](src/ui/components/IndicatorStudioView.tsx)：指标工坊（二库指标清单、分段评分曲线实时 ECharts 预览与自定义指标新增表单）。
    4. [`SystemDesignerView.tsx`](src/ui/components/SystemDesignerView.tsx)：体系编排器（三库树形体系编辑、同级权重一键归一化、Python SciPy AHP 成对矩阵一致性 `<dialog>` 与 NL-to-Metrics 意图草案生成器）。
    5. [`DataExplorerView.tsx`](src/ui/components/DataExplorerView.tsx)：数据资产浏览（冷热 SQLite 场次/事件检索、`unit_states` 航迹图及 `D1-D9` 主仓库真值差距清单）。
    6. [`RealtimeMonitorView.tsx`](src/ui/components/RealtimeMonitorView.tsx)：实时伴随监视 Q-109（SSE 实时流连接、倍速控制、异常帧注入演示、300s 防刷屏计数与 HITL 三态处置卡片）。
- **实测验证**：
  - `npx tsc --noEmit`：通过（退出码 `0`）。
  - `npm run build:ui`（`vite build`）：通过，产出 `dist-ui/index.html`、`dist-ui/assets/index-DXIxeCR_.css` (`47.92 kB`) 与 `dist-ui/assets/index-CjsbG2Bl.js` (`1,579.54 kB`)。


---

## Stage 6：全栈交互闭环、无头浏览器端到端验收与工程文档交付（已完成 ✅）

- **完成时间**：2026-11-12 08:42
- **实现范围**：
  - [`tests/stage5-ui-e2e.test.ts`](tests/stage5-ui-e2e.test.ts)：基于 `playwright-core` 驱动本机无头 Microsoft Edge 启动隔离端口与临时 `SQLite` 数据库实例，完整走通六大工作台核心人机交互路径：
    1. **评估驾驶舱**：验证 ECharts 雷达图与柱状图 canvas 渲染、Python NumPy/SciPy 多方案 TOPSIS 排序、证据时间轴子页签与原生 `<dialog>` 溯源弹窗开关。
    2. **算子工作台**：验证表格按钮排序与单算子在线沙箱试算反馈。
    3. **指标工坊**：验证评分曲线实时渲染、`HTMLInputElement` 现代 ES2024 `/v` 正则合法性及自定义指标创建落库回显。
    4. **体系编排器**：验证 NL-to-Metrics 意图草案生成与 AHP 成对比较矩阵 `<dialog>` 调用 Python SciPy 完成 `λmax / CI / CR` 计算及关窗。
    5. **数据与 `eval.db`**：验证 `unit_states` 航迹图、`simulation_events` 事件明细表及 `D1–D9` 主仓库真值差距清单展示。
    6. **实时 Q-109 研判**：修复在线注帧负载结构以严格对齐 `bs-frames-sample.jsonl` 与 `bs-diff.mjs`（嵌套 `frame.Scenario` + `DamageState: "destroyed"` 状态跳变），验证 Q-109 卡片弹出、300s 防骚扰冷却抑制计数增长及 `observe` HITL 人工裁决状态同步；同步完成 `1440×900` 桌面与 `430×900` 窄屏零水平溢出及截图逐帧核查（已清理临时截图目录并保留 `dist-ui/` 与 [`README.md`](README.md)）。
  - [`README.md`](README.md)：编写独立评估中台架构总览、三库+双引擎说明、REST/SSE 路由清单及启动/测试命令指南。
- **UI 走查顺带打磨**：
  - 修复柱状图在 `unavailable (fail-closed)` 维度下误显 `0 分` 的视觉歧义，明确标注 `不可用 (fail-closed)`；
  - 消除 JSX 展示标题中残留的反引号字面符与 Markdown 报告表格中的 `<br/>` 原文，移除驾驶舱主标题 `truncate` 截断并确保移动端下底部面板正常渲染。


---

## Stage 7：基础底座升级 —— 离线来源表与 BS JSONL 路径可视化统计（已完成 ✅）

- **完成时间**：2026-11-12 11:26
- **实现范围**：
  - [`src/core/types.ts`](src/core/types.ts) 与 [`src/adapters/source-profiler.ts`](src/adapters/source-profiler.ts)：实现零复制只读剖析器 `buildRunSourceProfile`（结合 `isSafePreviewQuery` 与符号链接目录越界防护），直连所选 Run 磁盘路径并对账 [`sim-output-fields/schemas/f1-output-catalog.json`](../sim-output-fields/schemas/f1-output-catalog.json)：
    - **EventExporter CSV 全量对照（44 类标准事件）**：统计磁盘 `.csv` 文件数、总行数、体积、双 UTF-8 BOM 检测（GJ11 实测 `11/11` 双 BOM、`124` 行 `UnitPositions`、`5` 行 `WeaponFired`）、区分「已产出·有行 / 已生成·空表 / 未产出 / 死枚举 D5 (`5` 项) / 引擎占位 (`2` 项)」、比对实有列与规范字段差异，支持 `previewTable` 按行切片预览并自动映射驱动算子。
    - **BS JSONL 帧路径命中统计（7 族 `scenario_paths` + 11 Topics）**：逐帧统计 `bs-frames-sample.jsonl`（实测 `6` 帧：`Time/GlobalWeather/Sides/ActiveUnits/Kinematics/DamageState/Weapons` 为 `6/6`，`Contacts[]` 为 `3/6`，`Events[]` 为 `2/6`，而 `Sensors[].Active`、`Missions[]`、`NonActiveUnits` 等为 `0/6`，直观解释 Batch B 算子 fail-closed 原因），统计 D2 字符串标量与单键包装分布；对纯文本上传 `<uploaded.jsonl>` 不落盘复制并诚实降级提示。
  - [`src/server.ts`](src/server.ts) 与 [`src/ui/api.ts`](src/ui/api.ts)：新增 `GET /api/runs/:id/source-profile`（支持 `previewTable`、`previewLimit` 与非法路径 `400`/未知 Run `404` 校验），并收口 `jsonl_text` 导入路径始终标记 `<uploaded.jsonl>`。
  - [`src/ui/components/DataExplorerView.tsx`](src/ui/components/DataExplorerView.tsx)、[`src/ui/components/SourceProfilePanel.tsx`](src/ui/components/SourceProfilePanel.tsx) 与 [`src/ui/styles.css`](src/ui/styles.css)：保留六大主标签架构，在「数据与 eval.db」下增设「来源表与 BS JSONL 统计」和「航迹、事件与 eval.db」二级无障碍子标签（支持 `role="tablist"` 键盘方向键切换与底部 3px 边框选中线）及 Run 快速切换栏；渲染 44 标准事件分布环图、CSV 行数柱图、BS 跨帧命中率横向柱图、可检索 44 表矩阵 + 内联字段/前 50 行原始预览，以及原生 `<details>` 7 族路径手风琴。
- **实测验证**：
  - `npm run typecheck` (`tsc --noEmit`) 与 `npm run build:ui` (`vite build`)：通过（退出码 `0`）。
  - [`tests/stage7-source-profile.test.ts`](tests/stage7-source-profile.test.ts) 与更新后的 [`tests/stage5-ui-e2e.test.ts`](tests/stage5-ui-e2e.test.ts)：验证 `gj11_pl15_bvr_real` 44 表对账与 `WeaponFired` 预览、`bs_sample_swarm_demo` 7 族路径统计与 `Sensors` `0/6` 空缺、`<uploaded.jsonl>` 诚实降级、路径穿越 `400` 拦截，以及 Playwright 无头 Edge 在 `1440×900` 和 `430×900` 下的双子标签 ECharts 渲染、零水平溢出与零控制台/HTTP 异常，全量 **16/16 测试通过**。

---

## Stage 8：全局仿真输出规范目录升级（已完成 ✅）

- **完成时间**：2026-11-12 18:25
- **设计定位修正**：根据交互对齐结果，明确将「数据与 eval.db」主标签拆分并突出**不绑定具体推演 Run 的 F1 仿真引擎全量输出数据规范定义**，与单局推演产物剖析、SQLite 明细排查彻底解耦：
  1. **Sub-tab 1（默认）：`仿真输出规范目录` (`#data-subtab-catalog`)**：由新组件 [`src/ui/components/SimulationCatalogPanel.tsx`](src/ui/components/SimulationCatalogPanel.tsx) 承载，顶栏隐藏 Run 选择器，直接展示来自 [`sim-output-fields/schemas/f1-output-catalog.json`](../sim-output-fields/schemas/f1-output-catalog.json) 与 21 个算子契约的全局标准：
     - 全局 KPI 条：`7` 大引擎输出通道、`44` 类 EventExporter 标准事件（`37` 活跃 / `5` 死枚举 D5 / `2` 占位 / `36` DB 表 / `11` Tacview）、`333` 个业务字段（`string 251 / float 37 / double 27 / int 14 / DateTime 4`）+ `4` 个 `shared_make_paras_dict_prefix`、BS `7` 族 `74` 条规范路径 + `11` MQTT Topics + `8` 条跨表 Join 链路 + `9` 项 D1–D9 实证偏差。
     - 全局跨表跨通道字段检索引擎（`WeaponID`、`Sensors`、`Longitude`、`DBID` 等）支持双向定位 CSV 表字段、BS 路径与依赖算子 ID。
     - 3 组全局 ECharts 图表：EventExporter 业务字段密度排行（支持 Top 18 / 全部字段表切换）、44 事件导出能力分布与 333 字段类型/单位统计、BS MQTT 7 族 74 路径规模分布图。
     - 可筛选 44 表 EventExporter 结构字典（行内展开 `字段` 查看全字段列表、`cs_type`/`db_type`/`max_len`、单位、源码 `call_sites`、门控条件 `gating`、`side_split_key` 与关联算子）、BS 7 族路径手风琴，以及可折叠 `7 大输出通道（含 HTTP Bridge / TCP / DIS PDUs）`、`8 组 Join 配方` 与 `D1–D9` 实证偏差清单。
  2. **Sub-tab 2：`单局源文件剖析` (`#data-subtab-sources`)**：保留并聚焦 Stage 7 离线 CSV / BS JSONL 盘点面板（[`SourceProfilePanel.tsx`](src/ui/components/SourceProfilePanel.tsx)），按需切换具体 Run。
  3. **Sub-tab 3：`航迹、事件与 eval.db` (`#data-subtab-sqlite`)**：保留入库统计、`unit_states` 航迹图、`simulation_events` 与上传导入能力。
- **契约与测试同步**：
  - [`src/core/types.ts`](src/core/types.ts)、[`src/adapters/source-profiler.ts`](src/adapters/source-profiler.ts) 与 [`src/ui/api.ts`](src/ui/api.ts) 统一共享强类型 `CatalogEventSpec`、`CatalogChannelSpec`、`CatalogJoinRecipe`、`F1OutputCatalog`。
  - **独立一级入口升级（`#tab-catalog` · 2026-11-12 18:35）**：按最终 `/grill-me` 对齐，将「仿真输出规范」升级为顶部主导航第 5 个独立一级入口（共 7 个一级 Tab），由 [`src/ui/App.tsx`](src/ui/App.tsx) 在初始化阶段统一拉取一次 `/api/fields-catalog` 传入 [`SimulationCatalogPanel.tsx`](src/ui/components/SimulationCatalogPanel.tsx)（补充独立全局标题栏，不绑定具体 Run）；原 `#tab-data` 更名为「单局数据与 eval.db」，内部专注保留「单局源文件剖析（默认）」与「航迹、事件与 eval.db」2 个子标签。
  - [`tests/stage5-ui-e2e.test.ts`](tests/stage5-ui-e2e.test.ts) 补齐 7 个顶部一级 Tab 校验、`#tab-catalog` 独立渲染与无 Run 下拉框验证、3 张 ECharts Canvas 渲染验证、`"WeaponID"` 全局字段检索与算子反查断言，以及桌面 (`1440×900`) / 移动端 (`430×900`) 截图走查；`npm run typecheck`、`npm run build:ui` 与全量 `npm test` 均通过（16/16 pass）。

---

## Stage 9：算子库扩容（21 → 36）与全功能工作台升级（已完成 ✅）

- **底层数据适配器扩容**：
  - [`src/adapters/csv-adapter.ts`](src/adapters/csv-adapter.ts) 新增 `WeaponLost`、`WeaponImpact`、`FuelConsumed`、`AirOps` 及传感器/通信类型枚举 (`SensorClassUsed`, `CommClassUsed`) 解析；[`src/adapters/frame-adapter.ts`](src/adapters/frame-adapter.ts) 新增 BS JSONL `Fuel.FuelRec.{CQ,MQ}` 通道提取。
  - [`src/core/types.ts`](src/core/types.ts) 扩展 `SituationModel` 与 `MetricAtomMeta`（`isCustom`、`customDef`），新增 `CustomOperatorDefinition`、`OperatorSweepPoint`、`OperatorComparisonRow` 契约。
- **内置算子库扩容（21 → 36）与安全自定义衍生算子引擎**：
  - 5 大领域新增 15 个内置算子：时间域 (`time.bvr_flight_avg`、`time.kill_chain_total_latency`、`time.strike_wave_interval`)、效能域 (`eff.weapon_loss_ratio`、`eff.damage_severity_index`、`eff.salvo_efficiency`、`eff.air_ops_sortie_completion`)、态势域 (`sit.kinematic_speed_avg`、`sit.altitude_envelope_advantage`、`sit.centroid_separation_nm`、`sit.hull_containment_area`)、合规域 (`comp.friendly_fire_safety`、`comp.engagement_range_discipline`)、成本域 (`cost.fuel_remaining_ratio`、`cost.unit_munitions_intensity`)。
  - 新增 [`src/operators/formula-engine.ts`](src/operators/formula-engine.ts)（零 `eval`/`Function` 递归下降四则与函数公式解析器，支持 `min/max/abs/sqrt/avg/clamp/round` 与依赖环路/缺失值拦截）与 [`src/operators/custom-store.ts`](src/operators/custom-store.ts)（持久化于 `data/custom-operators.json`）。
  - [`src/operators/registry.ts`](src/operators/registry.ts)、[`src/indicators/store.ts`](src/indicators/store.ts)、[`src/systems/evaluator.ts`](src/systems/evaluator.ts) 与 [`src/server.ts`](src/server.ts) 全面打通自定义算子求值、二/三库动态联动、引用删除保护（`409` / `400`），并新增 `POST /api/operators/preview-formula`、`POST /api/operators/compare-runs` 与 `POST /api/operators/:id/sweep`。
- **一库全功能三子页工作台升级**：
  - 重构 [`src/ui/components/OperatorLibraryView.tsx`](src/ui/components/OperatorLibraryView.tsx)，新增 [`OperatorBenchmarkPanel.tsx`](src/ui/components/OperatorBenchmarkPanel.tsx) 与 [`OperatorStudioSubpanel.tsx`](src/ui/components/OperatorStudioSubpanel.tsx)：
    1. `目录与单算子沙箱` (`#op-subtab-catalog`)：5 域筛选/排序/搜索、F1 数据契约、**二库/三库下游血缘徽章**、扩展参数沙箱 (`minRangeNm`, `expectedSpacingNm`)、`details` JSON 展开、以及 **ECharts 参数敏感性扫描曲线**。
    2. `全库批量基准与对比` (`#op-subtab-benchmark`)：双 Run 全库对照矩阵、5 域 ECharts 图表，以及 **JSON / BOM-CSV 导出**。
    3. `自定义算子工坊` (`#op-subtab-studio`)：快捷模板、变量绑定、公式实时预览试算、保存/加载/删除并实时同步至全库 UI。
- **沙箱就地修改、数据源契约编辑与直连聚合引擎补强（2026-11-12）**：
  - 新增 [`src/operators/override-store.ts`](src/operators/override-store.ts)（持久化于 `data/operator-overrides.json`）与 [`src/operators/source-extractor.ts`](src/operators/source-extractor.ts)（数据源直连聚合引擎，支持 EventExporter CSV 表/列与 BS JSONL 嵌套/单键包装路径的 `count_rows` / `count_non_empty` / `count_distinct` / `sum` / `avg` / `min` / `max` / `first_num` / `last_num` 与 `${targetSide}` 过滤，严格 fail-closed）。
  - 联动 [`src/operators/registry.ts`](src/operators/registry.ts)、[`src/operators/custom-store.ts`](src/operators/custom-store.ts)、[`src/systems/evaluator.ts`](src/systems/evaluator.ts) 与 [`src/server.ts`](src/server.ts)，开放 `PUT /api/operators/:id` 与 `DELETE /api/operators/:id/override`，并支持实时反哺 `source-profile` 与规范目录关联反查。
  - 升级 [`OperatorInlineEditor.tsx`](src/ui/components/OperatorInlineEditor.tsx)、[`OperatorContractAndBindingFields.tsx`](src/ui/components/OperatorContractAndBindingFields.tsx) 与 [`OperatorStudioSubpanel.tsx`](src/ui/components/OperatorStudioSubpanel.tsx)：
    1. 内置算子可就地覆写名称/单位/方向/口径、`defaultParams` 以及 **`f1FieldContract` (`csvTables` / `csvColumns` / `bsFramePaths` / `discrepancyNotes`)**，并支持「恢复默认」与「克隆为自定义算子」。
    2. 自定义算子全面支持 **Formula DSL** 与 **数据源直连提取 (`source_binding`)** 双模式（带 `f1-output-catalog` 自动补全提示），直连提取出的自定义算子还可直接作为底层变量参与公式二次组合及二/三库评估。
- **测试覆盖**：新增 [`tests/stage9-operator-studio.test.ts`](tests/stage9-operator-studio.test.ts)，并在 [`tests/stage5-ui-e2e.test.ts`](tests/stage5-ui-e2e.test.ts) 补齐沙箱就地修改（含契约字段）、恢复/克隆与 CSV 直连提取端到端流，`npm run typecheck`、`npm run build:ui` 与全量 `npm test` 全部通过（19/19 pass）。

---

## Stage 10：AST 公式计算引擎与行级衍生计算内核（已完成 ✅）

- **完成时间**：2026-11-14 04:15
- **实现范围**：
  - [`src/engine/libformula/tokenizer.ts`](src/engine/libformula/tokenizer.ts)：基于词法状态机实现完整的四则运算 `+ - * / ^`、分号/逗号参数分隔符、关系运算符 `>= <= != == > <`、多类型字面量（数值、带引号字符串、布尔值、空值）与合法变量标识符提取。
  - [`src/engine/libformula/parser.ts`](src/engine/libformula/parser.ts)：纯 TypeScript 递归下降语法树（AST）构建器，严格管理运算符优先级、括号结合律与多参数函数调用节点树。
  - [`src/engine/libformula/functions/`](src/engine/libformula/functions/)：构建内置高可靠函数库：
    - **逻辑分支**：`IF`、`AND`、`OR`、`NOT`、`SWITCH`、`COALESCE`、`IFNULL`；
    - **数学运算**：`ROUND`、`TRUNC`、`ABS`、`SQRT`、`MOD`、`POWER`、`CLAMP`、`CEIL`、`FLOOR`、`MAX`、`MIN`、`AVG`；
    - **文本处理**：`CONCATENATE`、`LEFT`、`RIGHT`、`MID`、`LEN`、`LOWER`、`UPPER`、`TRIM`；
    - **日期时间**：`DATEDIFF`、`DATEADD`、`YEAR`、`MONTH`、`DAY`。
  - [`src/engine/libformula/evaluator.ts`](src/engine/libformula/evaluator.ts)：基于 AST 的安全求值器，内建除零防御（返回 `null`）、空值安全传播、Kahn 算法拓扑依赖排序与自循环/相互依赖环路检测。
  - [`src/engine/libformula/index.ts`](src/engine/libformula/index.ts)：提供 `evaluateFormulaDataset`（多列行内衍生计算流水线）、`validateFormula` 语法静态检查及 `extractVariableReferences` 变量依赖逆向提取。
- **实测验证**：
  - [`tests/stage10-libformula.test.ts`](tests/stage10-libformula.test.ts)：10 个子项测试 **10/10 100% 通过**，覆盖四则/幂运算优先级、20+ 逻辑/数学/文本/日期内置函数、除零与空值安全防御、拓扑依赖自动排序以及数据集行级批量衍生。

---

## Stage 11：流式多主键跨行分组聚合引擎（已完成 ✅）

- **完成时间**：2026-11-14 12:15
- **实现范围**：
  - [`src/engine/aggregation.ts`](src/engine/aggregation.ts)：
    - **全表标量归约**：当 `groupKeys` 为空时，自动将 N 行数据集聚合归约为单行标量度量；
    - **复合多主键分组**：支持任意复合主键列表（如 `[MissionID, MissionName]`），通过流式哈希键完成多维分组与子集切片；
    - **11 种统计度量方法**：全量实现 `AVERAGE`、`SUM`、`MAX`、`MIN`、`COUNT_ALL`、`COUNT_DISTINCT`、`COUNT_NON_EMPTY`、`STDEV`（样本标准差）、`STDEVP`（总体标准差）、`FIRST`、`LAST`；
    - **严苛边界安全防御**：空表/全空列安全降级、非数值列自动转换与配置合法性校验器（`validateAggregationConfig`）。
  - [`src/engine/api.ts`](src/engine/api.ts)：实现 `executeFormulaOrAggPreview` 纯内存 Dry-Run 试算推演 API，支持一库算子流水线中行内公式与跨行聚合的双模态即时试算与差异列 (`diffCols`) 标亮。
- **实测验证**：
  - [`tests/stage11-aggregation.test.ts`](tests/stage11-aggregation.test.ts)：6 个子项测试 **6/6 100% 通过**，覆盖单/复合键分组、11 类聚合算式精度、空表与畸形字段防御、聚合参数校验与即时 Dry-Run 试算。

---

## Stage 12：三库全链路闭环与可视化算法流水线画布编排（已完成 ✅）

- **完成时间**：2026-11-15 02:30
- **实现范围**：
  - [`src/ui/components/pipeline-canvas/PipelineCanvasStudio.tsx`](src/ui/components/pipeline-canvas/PipelineCanvasStudio.tsx)：重构可视化算法流水线画布，支持自适应全貌居中、节点贝塞尔曲线连线、多源表并行输入汇聚与多分支下游消费拓扑。
  - **6 大核心 DAG 节点类型**：
    1. `data_input`：44 类规范 CSV 底表与 BS JSONL 状态流输入，支持动态字段选择与 `${targetSide}` 阵营过滤；
    2. `inline_calc`：基于 Stage 10 AST 引擎的多列行内公式衍生计算；
    3. `group_agg`：基于 Stage 11 引擎的跨行多主键流式分组汇总；
    4. `spatial`：集成 `@turf/*` WGS84 测地几何的 4D 动态航路走廊空间安全裕度与停留时长判定；
    5. `python_script`：挂载 Python 3.10+ / 3.12 科学计算算法模型；
    6. `result_output`：算子终态指标输出，直通挂载至二库指标。
  - [`src/ui/components/pipeline-canvas/lineage-analyzer.ts`](src/ui/components/pipeline-canvas/lineage-analyzer.ts)：全链路 I/O 契约与血缘依赖分析器，支持自动推导输入端口消费状态、纯净输出隔离与直接下游消费追踪。
  - [`src/ui/components/pipeline-canvas/CanvasInspectorDrawer.tsx`](src/ui/components/pipeline-canvas/CanvasInspectorDrawer.tsx) 与 [`CanvasPreviewTable.tsx`](src/ui/components/pipeline-canvas/CanvasPreviewTable.tsx)：右侧属性与算法配置抽屉，配合底部数据切片表格，实现节点点击即看输出预览与新增/衍生列标亮。
  - **三库完整闭环**：打通 一库算子流水线 ➔ 二库指标库 `targetField` 聚合与映射曲线 ➔ 三库评估体系 AHP/MCDA 层次赋权决策出数。
- **实测验证**：
  - [`tests/stage12-three-library-e2e.test.ts`](tests/stage12-three-library-e2e.test.ts)：4 个子项测试 **4/4 100% 通过**，端到端验证一库流水线行内衍生与聚合贯通、二库指标绑定出分、三库体系树加权评估及全量 REST API 接口调用。

---

## Stage 13：算子契约自动推导、单一真相源双向同步与全量 38 算子结构化/实证审计闭环（已完成 ✅）

- **完成时间**：2026-11-16 20:30
- **核心痛点解决**：
  - 根治【画布编排】与【算子配置】“两套逻辑”割裂：彻底解决用户在画布编排节点后、配置弹窗未自动同步（旧表/0 字段）以及数据汇总节点预览跨域串台的痛点。
- **实现范围**：
  - **契约自动反推内核**：[`src/operators/pipeline-utils.ts`](src/operators/pipeline-utils.ts) 实现 `deriveContractFromNodes(nodes)`，从任意复杂 DAG 拓扑中自动解析涉及的 CSV 底表、字段列、空间参数（如 `minSafeMarginKm`）及输出度量。
  - **后端单一真相源自动写回**：升级 [`src/server.ts`](src/server.ts) 的 `POST /api/operator-pipelines`，画布保存时自动同步写回 `operatorOverrideStore`（内置算子）与 `customOperatorStore`（自定义算子），实现单一真相源持久化；`GET /api/operator-pipelines/:opId` 同步返回预置蓝图与最新推导契约。
  - **配置弹窗一键自动同步**：升级 [`OperatorInlineEditor.tsx`](src/ui/components/OperatorInlineEditor.tsx) 与 [`OperatorContractAndBindingFields.tsx`](src/ui/components/OperatorContractAndBindingFields.tsx)，新增 `[⚡ 从画布节点自动同步]` 快捷通道，检测到算子已有编排画布时高亮提示一键拉取。
  - **动态阵营多语言自适应**：在 [`src/operators/helpers.ts`](src/operators/helpers.ts) 引入 `matchSide`，兼容中英文阵营标记（`'红方' / 'Red'`、`'蓝方' / 'Blue'`），移除走廊合规算子硬编码 `'Blue'` 限制。
  - **38 个内置算子元数据与实证字段契约全量结构化审计**：覆盖时间域 9 个、效能域 12 个、态势域 8 个、合规域 5 个、成本域 4 个，100% 结构化对账 `f1FieldContract`；并在真实 `GJ11-PL15` CSV 与 BS 帧样本上 100% 运行出数且遵循 fail-closed 门控降级。
- **实测验证**：
  - [`tests/stage13-operator-pipeline-sync.test.ts`](tests/stage13-operator-pipeline-sync.test.ts)：4 个子阶段测试 **4/4 100% 通过**；
  - **全量回归测试套件**：覆盖 Stages 1~13 全链路，总计 **50/50 项测试全量通过（0 失败、0 取消）**；
  - **生产编译与后台常驻验证**：`npm run build:ui` 产物更新完成，后台服务（端口 `7280`）稳定监听与响应。

---

## Stage 14 ~ Stage 15：MCDA 运筹学扩展与二库全覆盖实测标定（已完成 ✅）

- **完成时间**：2026-11-18
- **实现范围**：
  - **Stage 14**：在 [`python/mcda_algorithms.py`](python/mcda_algorithms.py)、[`src/operators/mcda-adapter.ts`](src/operators/mcda-adapter.ts) 与 [`src/server.ts`](src/server.ts) 完成持久化守护进程（Daemon）、Entropy/CRITIC/Combined 权重算法、TOPSIS 绝对基准与 VIKOR 折中排序算法，以及受限白名单 Python 沙箱；[`tests/stage14-mcda-advanced.test.ts`](tests/stage14-mcda-advanced.test.ts) 4/4 通过。
  - **Stage 15**：二库内置指标由 21 项扩容至 38 项（100% 覆盖 38 个内置算子），补全 `step`/`boolean`/`target_range`/`linear` 全规则校验，新增 `POST /api/indicators/backtest` 与 `POST /api/indicators/import` 实测回测与极值自动推荐；[`tests/stage15-indicators.test.ts`](tests/stage15-indicators.test.ts) 2/2 通过。

---

## Stage 16 ~ Stage 18：三库高级定权与对比中心、跨天零降级兼容、实时流外部挂载（已完成 ✅）

- **完成时间**：2026-11-18 23:40
- **Stage 16（三库高级定权、局部 AHP 与 TOPSIS+VIKOR 对比中心）**：
  - 后端 [`src/server.ts`](src/server.ts) 与 [`src/adapters/sqlite-store.ts`](src/adapters/sqlite-store.ts) 新增 `POST /api/systems/objective-weights`（支持 Entropy/CRITIC/Combined 与局部 `dimensionIds` 赋权，少于 2 局方案严格 fail-closed）与 `DELETE /api/evaluations/:evalId`。
  - 前端 [`src/ui/App.tsx`](src/ui/App.tsx) 维护跨工作台跳转焦点，实现三库树一键直达一库算子/二库指标详情。
  - [`src/ui/components/SystemDesignerView.tsx`](src/ui/components/SystemDesignerView.tsx) 升级支持任意多子节点维度的局部 AHP 定权、客观/组合赋权弹窗、入页自动同步最近评估得分、体系克隆与 JSON 导入。
  - [`src/ui/components/CockpitView.tsx`](src/ui/components/CockpitView.tsx) 升级为多方案 MCDA 对比工作台（TOPSIS $C_i$ + VIKOR $S_i/R_i/Q_i$ 与 C1/C2 准则同屏展示、多方案雷达叠加、Markdown 对比简报导出与历史评估记录删除）。
  - [`tests/stage16-systems-mcda.test.ts`](tests/stage16-systems-mcda.test.ts) 验证通过。
- **Stage 17（跨天长推演 `metrics.py` 零降级兼容）**：
  - [`src/operators/effectiveness/metrics-py-adapter.ts`](src/operators/effectiveness/metrics-py-adapter.ts) 在暂存投影层无损识别 C# 跨天 `TimeSpan`（如 `1.00:03:04.1000000`）并换算为纯数值场景秒，零修改 `LabConsole/` 即可消除跨天解析崩溃。
  - [`tests/stage17-long-scenario.test.ts`](tests/stage17-long-scenario.test.ts) 验证通过。
- **Stage 18（实时伴随监控外部流挂载与审计导出）**：
  - [`src/server.ts`](src/server.ts) 扩展 `POST /api/realtime/sessions` 支持已注册 `sourceId`（`jsonl_file`）与内联 `jsonlLines`，并拦截未注册 `jsonlFile` 路径越界；[`src/ui/components/RealtimeMonitorView.tsx`](src/ui/components/RealtimeMonitorView.tsx) 新增数据源选择、本地 JSONL 上传回放与 HITL 审计报告导出（`.md` / `.json`）。
  - [`tests/stage18-realtime-source.test.ts`](tests/stage18-realtime-source.test.ts) 验证通过。
- **全量回归与构建交付**：
  - `npm --prefix eval-service run build:ui` 构建成功；
  - `npm --prefix eval-service test` 全量 **60/60 项测试 100% 通过（0 fail）**。
