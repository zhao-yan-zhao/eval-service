# F1 推演评估中台 (`eval-service`) 下一步执行计划（Stage 16 ~ Stage 18）

> **当前基线（已完成 Stage 0 ~ Stage 15）**：
> - **一库（算子库）**：38 个内置算子全量契约审计 + AST 公式引擎 + 流式分组聚合 + 空间几何/Python 节点 + 画布工坊单一真相源双向同步。
> - **二库（指标库）**：38 项内置指标 100% 覆盖 38 算子 + 真实数据回测与极值反推标定 + `step`/`boolean`/`target_range`/`linear` 全规则编辑与校验 + 批量导入/导出。
> - **验证基线**：`npm --prefix eval-service run build:ui` 通过，`npm --prefix eval-service test` 全量 **57/57 通过**；服务运行于 `http://127.0.0.1:7280`。
>
> **下一阶段主线**：打通 **三库（评估体系库）高级运筹定权与多方案对比闭环**，解决 **真机跨天长推演 `metrics.py` 降级瓶颈**，并完善 **实时伴随监控外部流接入与审计留存**。

---

## Stage 16：三库高级定权（Entropy/CRITIC/组合）、子层定权与多方案 TOPSIS/VIKOR 对比中心

### 背景与痛点
1. Stage 14 已在后端 [mcda_algorithms.py](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/python/mcda_algorithms.py) 与 [server.ts](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/server.ts#L1031-L1090) 实现了 `/api/mcda/entropy`、`/api/mcda/critic`、`/api/mcda/combined`、`/api/mcda/vikor` 全部接口，但三库设计器（`SystemDesignerView.tsx`）目前仅接入了手工 `AHP`，评估总览（`CockpitView.tsx`）仅接入了基础 `TOPSIS`。
2. 跨工作台联动仍不完整：[App.tsx](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/ui/App.tsx#L262) 中 `onNavigateToTab(tab, targetId)` 丢弃了 `targetId`，无法从三库树一键跳转并自动定位二库指标或一库算子。

### 施工清单

#### 16.1 后端支撑与 API 补充
- **`POST /api/systems/objective-weights`**（[server.ts](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/server.ts)）：
  - 入参：`{ systemId?: string; system?: IndicatorSystem; dimensionIds?: string[]; runIds?: string[]; method: 'entropy' | 'critic' | 'combined'; subjectiveWeights?: number[]; alpha?: number }`。
  - 逻辑：复用 `evaluateIndicatorSystem` 对所选（或全部）推演 Run 批量求出各目标节点得分构建矩阵（缺省严格校验不少于 2 个有效对比方案、或明确提示需先选择 >= 2 局 Run），调用 `computeEntropyWeights` / `computeCriticWeights` / `computeCombinedWeights` 返回推荐权重、原始矩阵与诊断说明。
- **评估结果对比与历史清理接口**（[sqlite-store.ts](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/adapters/sqlite-store.ts)、[server.ts](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/server.ts)）：
  - 新增 `DELETE /api/evaluations/:evalId`，支持在前端清理废弃或重复试验评估记录。

#### 16.2 三库体系设计器升级 (`SystemDesignerView.tsx` & `App.tsx`)
- **跨库精准跳转联动**：
  - [App.tsx](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/ui/App.tsx#L235-L265) 维护 `focusedOperatorId` / `focusedIndicatorId`（或递增 nonce 信号）传给 `OperatorLibraryView` 与 `IndicatorStudioView`，确保点击三库树属性面板跳转后自动选中对应算子/指标。
- **客观权重与主客观组合赋权弹窗**：
  - 在 [SystemDesignerView.tsx](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/ui/components/SystemDesignerView.tsx) 与 [api.ts](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/ui/api.ts) 中接入 `entropy`、`critic`、`combined`（可调主观权重占比 $\alpha \in [0, 1]$）：支持选定 >= 2 局 Run 基于实测得分差异自动算权，并一键应用到体系根节点或当前选中的多子指标维度。
- **任意子维度局部 AHP 定权**：
  - 将现有的 root 一级维度 AHP 定权弹窗扩展为支持对**当前选中的任意子维度**（子指标数 >= 2）执行局部 AHP 矩阵定权。
- **体系运维增强**：
  - 进入 Tab 4 时自动同步当前 `(selectedSystemId, selectedRunId)` 在库中最近一次评估得分（不再显示滞后的未关联态）；
  - 补充 **导入体系 JSON**、**克隆为新体系** 以及从二库按领域快速勾选指标挂载至当前维度的快捷器。

#### 16.3 多方案批量评估与 TOPSIS + VIKOR 双算法对比工作台 (`CockpitView.tsx`)
- 在 [CockpitView.tsx](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/ui/components/CockpitView.tsx) 升级「多方案排序对比」面板：
  - 支持用户勾选 **2 局及以上推演 Run**（若某局尚未对当前体系评估，支持一键批量串行/并发补跑），同步调用 `/api/mcda/topsis` 与 `/api/mcda/vikor`；
  - 同屏展示 **TOPSIS 贴近度 ($C_i$)**、**VIKOR 群效益 ($S_i$) / 个体遗憾 ($R_i$) / 折中值 ($Q_i$) 与稳定性双准则判定**；
  - 叠加多方案一级维度 ECharts 雷达图对比，并支持导出 Markdown 对比简报及删除无效历史评估胶囊。

### 验收标准
1. 新增测试 `eval-service/tests/stage16-systems-mcda.test.ts`：覆盖 `objective-weights`（entropy/critic/combined）、`DELETE /api/evaluations/:evalId`、`vikor` 接口校验与错误场景（<2 个有效方案 fail-closed）。
2. E2E 或手动浏览器验证：Tab 4 客观/组合定权与子维度 AHP 生效；Tab 1 TOPSIS + VIKOR 双算法同屏渲染、多方案雷达对比与历史删除无报错。

---

## Stage 17：跨天长推演 `metrics.py` 零降级兼容与大数据集体验加固

### 背景与痛点
1. 在实测 55 所台海场景（`55th_taihai_csv`）及超 24 小时仿真时，`UnitCreated.csv` 等表出现 C# 跨天 `TimeSpan`（如 `1.00:03:04.1000000`），导致只读主仓工具 `LabConsole/tools/csv_normalize/csv_normalize.py` 解析报错并触发 `Python metrics.py 降级跳过`。
2. 根据 `AGENTS.md` 规定严禁修改 `LabConsole/`，因此必须在独立服务暂存层中完成无损时间桥接。

### 施工清单

#### 17.1 `metrics-py-adapter.ts` 暂存层跨天时间规范化
- 文件：[metrics-py-adapter.ts](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/operators/effectiveness/metrics-py-adapter.ts)
- 改造内容：
  - 在 `stageWhitelistCsvs`（向 `os.tmpdir()` 暂存白名单 CSV 阶段）写入每一行前，检查 `Time` / `CurrentTime` / `StartTime` / `EndTime` 等时间列（或含 `^\d+\.\d{2}:\d{2}:\d{2}` 格式的值）；
  - 复用 [time-utils.ts](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/core/time-utils.ts) 中的 `parseF1Time` 将跨天 `TimeSpan` 无损转为基准锚点 ISO-8601 字符串（如 `2026-01-01T00:00:00Z + offsetSec`），确保 `csv_normalize.py` 与 `metrics.py` 全量正常出数而无需改动 `LabConsole/` 一行代码。
  - 若源目录存在大文件（如 > 50MB `UnitPositions.csv`），评估阶段在 SSE 日志中明确输出每个 CSV 的暂存耗时与进度百分比，消除“初始化长等待感”。

#### 17.2 `55th_taihai_csv` 与多日推演回归测试
- 在 `eval-service/tests/stage17-long-scenario.test.ts` 中构造含 `1.00:03:04.1000000` 与 `2.14:59:59.5000000` 跨天记录的临时 CSV 目录，验证：
  - `runPythonMetricsAdapter` 返回 `available: true` 且 `warnings` 中无时间解析失败；
  - 时效/效能/合规算子在跨天数据上算出的间隔秒数（`86584.1s` 等）完全精确，与 `csv-adapter.ts` 一致。

### 验收标准
1. `stage17-long-scenario.test.ts` 全部通过；
2. 对含跨天时间的实测场景点击「运行评估」，`pythonMetrics.available === true`，不再出现 `metrics.py 执行降级回退` 错误条。

---

## Stage 18：实时伴随监控外部流挂载、自定义 JSONL 回放与审计导出

### 背景与痛点
1. 当前 [RealtimeMonitorView.tsx](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/ui/components/RealtimeMonitorView.tsx) 与 [monitor.ts](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/realtime/monitor.ts) 仅默认挂载仓内 `bs-frames-sample.jsonl`，用户无法直接在界面选择已注册的 `jsonl_file` 数据源或上传临时 JSONL 开展多场景实时伴随回放与阈值验证。
2. 人工裁决（HITL：`observe` / `pause_inspect` / `ignore_expected`）后的处置记录仅停留在卡片展示，缺少审计导出功能。

### 施工清单

#### 18.1 实时流多数据源选择与上传直连
- 文件：[monitor.ts](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/realtime/monitor.ts)、[server.ts](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/server.ts)、[RealtimeMonitorView.tsx](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/ui/components/RealtimeMonitorView.tsx)
- 内容：
  - `POST /api/realtime/sessions` 支持传 `sourceId`（从 `DataSourceStore` 解析已验证的 `jsonl_file` 路径，防止路径穿越）或内联 `jsonlLines` 数组；
  - 在 Tab 7 控制栏增加「实时帧数据源选择（支持已配置的 JSONL 数据源与本地上传流）」及倍速调节显示，保留现有「创建/重置实时流」「注入战损异常帧」交互。

#### 18.2 告警联动二库最新配置与审计导出
- 确认 `RealtimeMonitor` 每次新建会话或触发阈值检查时读取最新的 `indicatorStore`（确保用户在 Tab 3 修改了 `alarmThreshold` 和自定义 `messageTemplate` 后立即在实时流生效）；
- 前端支持一键导出当前实时会话的 **告警与人工裁决审计报告（`.md` / `.json`）**。

### 验收标准
1. 新增 `eval-service/tests/stage18-realtime-source.test.ts`：验证通过自定义 JSONL 行与 `sourceId` 创建会话、二库更新告警模板后实时生效、以及路径越界防御（拒绝任意未注册路径）。
2. 全量 Playwright E2E（`stage5-ui-e2e.test.ts`）所有现有断言保持 100% 通过。

---

## 五、 给 Codex 的通用施工红线（务必遵守）

1. **零入侵主仓库**：所有修改仅限 `eval-service/` 内，严禁修改 `CMO-netcore-src/`、`LabConsole/`、`demo-ui/`、`integration/`。
2. **Fail-Closed 绝不造假**：缺数或少于最小对比样本数时必须明确报错或返回 `unavailable`，禁止编造默认得分或填充假样本。
3. **不破坏既有自动化测试契约**：
   - 不删减/放宽 `eval-service/tests/stage1~stage15` 现有任何断言；
   - 保留 `stage5-ui-e2e.test.ts` 依赖的所有 DOM ID / 文案（如 `#tab-*`、`#panel-*`、`已人工处置：observe`、`D1:`、`体系推演评估完成！` 等）；
   - 保留 [CanvasConnectionLines.tsx](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/src/ui/components/pipeline-canvas/CanvasConnectionLines.tsx) 水平连线亚像素防退化偏移 `safeEndY = startY + 0.05`。
4. **交付闭环**：
   - 每个 Stage 完成后执行：
     - `npm --prefix eval-service run typecheck`
     - `npm --prefix eval-service run build:ui`
     - `npm --prefix eval-service test`（必须全部 100% 通过，0 fail）
   - 将里程碑验收结果追加记录至 [MILESTONE-LOG.md](file:///d:/project/F1-AI-demo-lua-structure-tools/eval-service/MILESTONE-LOG.md)。
