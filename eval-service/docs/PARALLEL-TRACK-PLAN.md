# F1 推演评估中台 (`eval-service`) 并行专项执行计划（Codex 对话 #2 专属 · 文件零冲突）

> **并行协同原则**：本计划面向第二个 Codex 对话，所有施工文件与主线 [NEXT-STAGE-EXECUTION-PLAN.md](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/docs/NEXT-STAGE-EXECUTION-PLAN.md)（Stage 16 ~ Stage 18）**严格文件隔离、零交叉修改**，可与主线并行开发。
>
> **严禁触碰的主线文件**（留给 Codex #1）：
> `src/server.ts`、`src/adapters/sqlite-store.ts`、`src/operators/effectiveness/metrics-py-adapter.ts`、`src/realtime/monitor.ts`、`src/ui/App.tsx`、`src/ui/api.ts`、`src/ui/components/SystemDesignerView.tsx`、`src/ui/components/CockpitView.tsx`、`src/ui/components/RealtimeMonitorView.tsx`。

---

## 任务 A：战术反哺建议与交战参数补丁全量扩充（覆盖全部 38 算子）

### 现状缺口
- 在 [feedback-generator.ts](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/reports/feedback-generator.ts#L25-L90) 中，`buildDirectivesForAtom` 的 `switch` 仅覆盖 **8 个**内置算子（`sit.standoff_advantage`、`time.detect_to_fire_latency`、`time.first_weapon_fire`、`eff.hit_rate`、`eff.target_penetration_rate`、`comp.corridor_compliance`、`cost.munitions_cost_total`、`cost.economic_exchange_ratio`）。
- 其余 **30 个算子**（含 Stage 15 新增指标对应的 `comp.friendly_fire_safety`、`cost.fuel_remaining_ratio`、`eff.sensor_detection_rate`、`eff.target_identification_rate`、`time.kill_chain_total_latency`、`eff.salvo_efficiency`、`eff.air_ops_sortie_completion` 等）均落入 `default:` 分支，导致 `recommendedDoctrinePatches` 为空 `{}` 且建议文本退化为模板占位句。

### 施工目标（仅改 `src/reports/feedback-generator.ts`、`src/reports/report-generator.ts`）
1. 将 `buildDirectivesForAtom` 扩充为数据驱动映射表，确保 **38 个内置算子 100% 均有专属、具备军事运筹语义的调整指令与结构化 `patches` 参数补丁**（涵盖 WRA 规则、EMCON 静默窗口、齐射策略、燃油返航阈值、探测/识别协同、出动波次与走廊约束）。
2. 在 [report-generator.ts](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/reports/report-generator.ts) 中优化「观察事实 / 模型推断 / 证据依据」可读性与新指标的单位/物理含义渲染。

---

## 任务 B：NL-to-Metrics 意图解析器适配全量 38 指标

### 现状缺口
- 在 [intent-mapper.ts](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/nl/intent-mapper.ts#L13-L89) 中，`DOMAIN_RULES` 目前仅包含早期 21 项指标 ID，尚未映射 Stage 15 新增的 **17 项内置指标**（如 `ind_friendly_fire_safety`、`ind_engagement_range_discipline`、`ind_fuel_remaining_ratio`、`ind_sensor_detection_rate`、`ind_target_identification_rate`、`ind_kill_chain_total_latency`、`ind_salvo_efficiency`、`ind_air_ops_sortie_completion` 等）。

### 施工目标（仅改 `src/nl/intent-mapper.ts`）
1. 在 `DOMAIN_RULES` 中补齐新场景关键词与指标加权规则（例如：`友军误伤/安全红线`、`余油/续航/返航`、`射程包线/有效射程`、`出动回收/架次闭环`、`目标识别/探测覆盖`、`杀伤链全时延/波次间隔`、`高空占优/巡航机动`）。
2. 确保针对任意自然语言输入生成的体系草案均能优先纳入匹配的 38 项内置指标并通过 `validateIndicatorSystem`。

---

## 任务 C：前端构建产物分包瘦身（零代码入侵提速）

### 现状缺口
- 当前 [vite.config.ts](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/vite.config.ts) 未配置分包策略，每次 `npm run build:ui` 生成单一高达 **2.78 MB**（gzip ~851 KB）的 JS Bundle，持续触发 Vite `> 500 kB` 体积警告并拖慢浏览器首次加载与增量打包速度。

### 施工目标（仅改 `eval-service/vite.config.ts`）
1. 配置 `build.rollupOptions.output.manualChunks`：将 `echarts`、`codemirror`（含 `@codemirror/*`）、`lucide-react`、`react`/`react-dom` 拆分为独立缓存 chunk，消除单块 2.78MB 臃肿产物。
2. 不修改 `src/ui/App.tsx`，确保零路由冲突。

---

## 任务 D：推演数据浏览器（Tab 6）与字段规范目录（Tab 5）体验增强

### 施工范围（与 Stage 16–18 完全隔离）
- 文件：[DataExplorerView.tsx](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/ui/components/DataExplorerView.tsx)、[SourceProfilePanel.tsx](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/ui/components/SourceProfilePanel.tsx)、[SimulationCatalogPanel.tsx](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/ui/components/SimulationCatalogPanel.tsx)
- 具体优化点：
  1. **Tab 6 航迹回放交互升级**（`DataExplorerView.tsx`）：支持按阵营（全量 / 红方 / 蓝方）与按平台名称过滤航迹系列、高亮单机航迹并展示对应单元关键事件时间点。
  2. **Tab 6 事件检索表导出**（`DataExplorerView.tsx`）：在现有 `simulation_events` 表格工具栏增加导出当前筛选结果（带 UTF-8 BOM 的 CSV）按钮。
  3. **Tab 5 字段检索关联展示增强**（`SimulationCatalogPanel.tsx`）：将超 4 个算子折叠的 `+N` 徽章升级为可点击展开/收起交互，并保留现有 `stage5-ui-e2e.test.ts` 所需的 `D1:`、Tab ID 与检索断言。

---

## 独立验收与协同提醒

1. **独立测试文件**：将本专项的自动化验证全部写入新建的 **`eval-service/tests/stage19-parallel-enhancements.test.ts`**（覆盖 38 算子反哺映射无遗漏、NL 草案命中新增指标等），不要改动既有 `stage1~stage18` 测试文件。
2. **注意并发跑构建**：若两个 Codex 对话同时在同一目录运行，请让 Codex #2 在完成后先跑 `npm --prefix eval-service run typecheck` 和专属单测 `npx --prefix eval-service tsx --test eval-service/tests/stage19-parallel-enhancements.test.ts`；待两个对话都收尾后再统一执行一次 `npm --prefix eval-service run build:ui` 与全量 `npm --prefix eval-service test`。
3. **绝对红线**：严禁改动 `CMO-netcore-src/`、`LabConsole/`、`demo-ui/`、`integration/`，严禁删改既有测试断言。
