# F1 推演评估中台 V4 Plan A 真机实证评估报告（55所台海场景 · 三阵营全量）

> **生成时间**：2026-11-23T06:40:04.776Z  
> **数据源路径**：`J:\55所\想定导出\EventExport_CSV`  
> **推演架构版本**：F1 Eval-Service V4 Plan A（纯客观事实算子 + 共享阵营切片 + 二库分层聚合 + 三库效果合成）  
> **评估体系**：`sys_v4_metrics_guide_full`（推演评估指标指南全体系评估 DAG (8大类效果叠加与双轨门控)） ⟵ `mg_v4_metrics_guide_full`（8大类全域客观指标图 (metrics_calculation_guide 完整规范)）  
> **实证准则**：**Fail-Closed 零臆造原则**（缺失底表或空切片严格返回 `unavailable` 并标明理由，严禁伪造默认数值）

---

## 1. 评估总览与三阵营效能对比（红方 / 绿方 / 蓝方）

| 对比维度 | 红方 (Red) | 绿方 (Green) | 蓝方 (Blue) | 优势方 | 说明 |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **体系综合效能最终得分** | **76.37** | **80.24** | **83.22** | **蓝方** | 门控裁决后的终态效果分 |
| **未受门控封顶原始分** | **76.37** | **80.24** | **83.22** | **蓝方** | 门控一票否决前无量纲效果总分 |
| **红线安全门控裁决** | **`PASS`** | **`PASS`** | **`PASS`** | - | Hard 一票否决与 Soft 预警双轨审计 |
| **有效权重覆盖率** | `100.0%` | `100.0%` | `70.0%` | - | `skip_renormalize` 动态有效权重比 |
| **火力打击与拦截对抗综合效果** | **78.22** | **61.23** | `unavailable` | **红方** | 权重 0.30 (`ef_firepower_composite`) |
| **侦察预警与指控协同效果** | **59.63** | **96.64** | **53.02** | **绿方** | 权重 0.25 (`ef_recon_c2_composite`) |
| **机动生存与电磁攻防效果** | **100.00** | **94.62** | **100.00** | **红方 / 蓝方** | 权重 0.25 (`ef_survivability_composite`) |
| **体系协同与作战效费效果** | **65.00** | **70.27** | **100.00** | **蓝方** | 权重 0.20 (`ef_cost_synergy_composite`) |

---

## 2. 红线门控安全审计明细

双轨门控机制严格按照军事交战规则执行：**Hard GATE** 违规触发一票否决并将体系总分封顶至 39 分；**Soft GATE** 违规记录 `WARNING` 预警并保留诊断溯源。

### 2.1 红方门控审计
| 门控名称 | 门控模式 | 裁决状态 | 实测物理值 | 审计结论 |
| :--- | :---: | :---: | :---: | :--- |
| 战损崩溃硬红线门控 | `HARD` | **✅ PASS** | `0` | 安全受控 |
| 防空漏洞预警软门控 | `SOFT` | **✅ PASS** | `1` | 安全受控 |

### 2.2 绿方门控审计
| 门控名称 | 门控模式 | 裁决状态 | 实测物理值 | 审计结论 |
| :--- | :---: | :---: | :---: | :--- |
| 战损崩溃硬红线门控 | `HARD` | **✅ PASS** | `0.0702` | 安全受控 |
| 防空漏洞预警软门控 | `SOFT` | **✅ PASS** | `0.8889` | 安全受控 |

### 2.3 蓝方门控审计
| 门控名称 | 门控模式 | 裁决状态 | 实测物理值 | 审计结论 |
| :--- | :---: | :---: | :---: | :--- |
| 战损崩溃硬红线门控 | `HARD` | **✅ PASS** | `0` | 安全受控 |
| 防空漏洞预警软门控 | `SOFT` | **⚠️ UNAVAILABLE** | `指标 [air_defense.composite_interception_probability] 数据集为空 (0 行)，无法提取字段 [综合拦截率]` | 数据缺失 (Fail-Closed) |

---

## 3. 三库多层效果节点评分明细（三阵营对照）

本体系严格遵循局部入边权重和 $\sum w_i = 1.0000$ 运筹学约束，节点缺数时由 `skip_renormalize` 动态重归一有效入边权重。

| 层级 | 效果节点名称 | 节点ID | 角色 | 红方得分 | 绿方得分 | 蓝方得分 | 映射/聚合策略 |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| 1 | 对地/海突击达成效果 | `ef_strike` | `effect` | **100.00** | `unavailable` | `unavailable` | `metricBinding` |
| 1 | 空中巡逻掩护效果 | `ef_patrol` | `effect` | **100.00** | **100.00** | **100.00** | `metricBinding` |
| 1 | 空中支援保障效果 | `ef_support` | `effect` | **100.00** | **5.12** | **100.00** | `metricBinding` |
| 1 | 装备雷达探测效能 | `ef_detection` | `effect` | **45.90** | **93.27** | **46.22** | `metricBinding` |
| 1 | 杀伤链闭环协同敏捷度 | `ef_killchain` | `effect` | **0.00** | **96.39** | `unavailable` | `metricBinding` |
| 1 | 主战武器打击命中效果 | `ef_weapon` | `effect` | **37.77** | **36.05** | `unavailable` | `metricBinding` |
| 1 | 作战效费交换效果 | `ef_cost_exchange` | `effect` | **100.00** | **100.00** | **100.00** | `metricBinding` |
| 1 | 兵力生存损耗抑制效果 | `ef_cost_survival` | `effect` | **100.00** | **82.07** | **100.00** | `metricBinding` |
| 1 | 战损崩溃硬红线门控 | `gt_attrition_hard` | `gate` | **100.00** | **93.27** | **100.00** | `metricBinding` |
| 1 | 侦察平台有效探测距离效果 | `ef_recon` | `effect` | **73.36** | **100.00** | **59.82** | `metricBinding` |
| 1 | 指挥控制态势完整效果 | `ef_c2` | `effect` | `unavailable` | `unavailable` | `unavailable` | `metricBinding` |
| 1 | 电子压制累计受扰秒数效果 | `ef_ew` | `effect` | **100.00** | **100.00** | **100.00** | `metricBinding` |
| 1 | 防空反导拦截保护效果 | `ef_ad` | `effect` | **100.00** | **90.60** | `unavailable` | `metricBinding` |
| 1 | 防空漏洞预警软门控 | `gt_interception_soft` | `gate` | **100.00** | **97.78** | `unavailable` | `metricBinding` |
| 2 | 体系协同与作战效费效果 | `ef_cost_synergy_composite` | `effect` | **65.00** | **70.27** | **100.00** | `weighted_sum` |
| 2 | 侦察预警与指控协同效果 | `ef_recon_c2_composite` | `effect` | **59.63** | **96.64** | **53.02** | `weighted_sum` |
| 2 | 机动生存与电磁攻防效果 | `ef_survivability_composite` | `effect` | **100.00** | **94.62** | **100.00** | `weighted_sum` |
| 2 | 火力打击与拦截对抗综合效果 | `ef_firepower_composite` | `effect` | **78.22** | **61.23** | `unavailable` | `weighted_sum` |
| 3 | 联合作战体系综合效能 | `ef_mg_terminal_overall` | `effect` | **76.37** | **80.24** | **83.22** | `weighted_sum` |

---

## 4. 二库客观指标 DAG 计算结果（严格由算子 `spec.chapter` 溯源）

二库指标严格强隔离，不包含任何打分函数或权重，纯粹反映推演仿真产生的物理度量与多维聚合值。

| 章节 | 指标名称 | 指标ID | 计算模式 | 运筹层级 | 红方实测值 | 绿方实测值 | 蓝方实测值 | 状态 | 量纲单位 |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 第 7 章 | 综合拦截概率 | `air_defense.composite_interception_probability` | `from_operator` | `MOFE` | `1.0000` | `0.8889` | `-` | ✅ valid | `ratio` |
| 第 7 章 | 防空阵地最大探测距离 | `air_defense.detection_zone` | `from_operator` | `MOP` | `239.5600` | `328.5900` | `270.5900` | ✅ valid | `nm` |
| 第 7 章 | 防空单元拦截发射距离 | `air_defense.unit_intercept_zone` | `from_operator` | `MOP` | `121.5400` | `4.3200` | `-` | ✅ valid | `nm` |
| 第 7 章 | 防空武器型号最大拦截距离 | `air_defense.max_intercept_range` | `from_metric_agg` | `MOE` | `121.5400` | `4.3200` | `-` | ✅ valid | `nm` |
| 第 5 章 | 态势完整度 | `c2.situational_completeness` | `from_operator` | `MOE` | `-` | `-` | `-` | ⚠️ unavailable | `ratio` |
| 第 3 章 | 平台战损率 | `cost.side_attrition_rate` | `from_operator` | `MOE` | `0.0000` | `0.0702` | `0.0000` | ✅ valid | `ratio` |
| 第 3 章 | 分方平台损失数 | `cost.platform_losses` | `from_operator` | `MOP` | `0.0000` | `4.0000` | `0.0000` | ✅ valid | `count` |
| 第 3 章 | 平台生存率 | `cost.side_attrition_metrics` | `from_operator` | `MOE` | `1.0000` | `0.9298` | `1.0000` | ✅ valid | `ratio` |
| 第 3 章 | 分方有效生存战损交换比 | `cost.effective_exchange_ratio` | `from_metric_formula` | `MOFE` | `10.0000` | `13.2450` | `10.0000` | ✅ valid | `ratio` |
| 第 2 章 | 单元首次发现距离 | `detection.unit_detection` | `from_operator` | `MOP` | `116.8538` | `254.1947` | `135.8535` | ✅ valid | `nm` |
| 第 2 章 | 雷达装备型号首次发现距离 | `detection.model_detection` | `from_metric_agg` | `MOE` | `130.9876` | `235.1834` | `131.6803` | ✅ valid | `nm` |
| 第 6 章 | 短波通信网台干扰时间占比 | `ew.hf_comm_jamming_detail` | `from_operator` | `MOP` | `-` | `-` | `-` | ⚠️ unavailable | `ratio` |
| 第 6 章 | 持续有效干扰时间 | `ew.jamming_duration` | `from_operator` | `MOP` | `171451.70` | `249744.00` | `2238830.00` | ✅ valid | `s` |
| 第 6 章 | 分方累计有效干扰总时长 | `ew.jamming_total_seconds` | `from_metric_agg` | `MOE` | `171451.70` | `249744.00` | `2238830.00` | ✅ valid | `s` |
| 第 3 章 | 效能价格比与生存协同指数 | `custom.cost_effectiveness_ratio` | `from_metric_formula` | `MOFE` | `10.5000` | `12.9775` | `10.5000` | ✅ valid | `index` |
| 第 4 章 | 目标发现率 | `isr.detection_rate` | `from_operator` | `MOE` | `-` | `-` | `-` | ⚠️ unavailable | `ratio` |
| 第 4 章 | 目标识别平均用时 | `isr.identification_latency` | `from_operator` | `MOP` | `530.4444` | `3313.14` | `530.9362` | ✅ valid | `s` |
| 第 4 章 | 雷达覆盖峰值面积 | `isr.radar_coverage_area` | `from_operator` | `MOE` | `-` | `-` | `-` | ⚠️ unavailable | `km2` |
| 第 4 章 | 主战侦察平台侦察范围 | `isr.reconnaissance_range` | `from_operator` | `MOP` | `191.3850` | `386.5700` | `161.6011` | ✅ valid | `nm` |
| 第 2 章 | 单元杀伤链闭环总时长 | `fire_control.unit_kill_chain_closure` | `from_operator` | `MOP` | `885.5000` | `68.1550` | `-` | ✅ valid | `s` |
| 第 2 章 | 杀伤链闭环平均耗时 | `fire_control.kill_chain_closure_time` | `from_metric_agg` | `MOE` | `1533.67` | `50.5917` | `-` | ✅ valid | `s` |
| 第 1 章 | 单巡逻任务完成度 | `patrol.single_mission_metrics` | `from_operator` | `MOP` | `1.0000` | `1.0000` | `1.0000` | ✅ valid | `ratio` |
| 第 1 章 | 巡逻掩护平均完成率 | `patrol.composite_mission_metrics` | `from_metric_agg` | `MOE` | `1.0000` | `1.0000` | `1.0000` | ✅ valid | `ratio` |
| 第 1 章 | 单突击任务完成度 | `strike.single_mission_metrics` | `from_operator` | `MOP` | `1.0000` | `-` | `-` | ✅ valid | `ratio` |
| 第 1 章 | 突击任务平均完成率 | `strike.composite_mission_metrics` | `from_metric_agg` | `MOE` | `1.0000` | `-` | `-` | ✅ valid | `ratio` |
| 第 1 章 | 攻防任务综合完成指数 | `custom.air_combat_task_index` | `from_metric_formula` | `MOFE` | `1.0000` | `-` | `-` | ✅ valid | `ratio` |
| 第 1 章 | 单支援任务完成度 | `support.single_mission_metrics` | `from_operator` | `MOP` | `1.0000` | `0.3333` | `1.0000` | ✅ valid | `ratio` |
| 第 1 章 | 支援保障平均完成率 | `support.composite_mission_metrics` | `from_metric_agg` | `MOE` | `1.0000` | `0.3333` | `1.0000` | ✅ valid | `ratio` |
| 第 2 章 | 单发弹药打击命中状态 | `weapon.munition_engagement_status` | `from_operator` | `MOP` | `0.2333` | `0.3810` | `-` | ✅ valid | `ratio` |
| 第 2 章 | 主战武器平均命中率 | `weapon.munition_hit_rate` | `from_metric_agg` | `MOE` | `0.3833` | `0.3704` | `-` | ✅ valid | `ratio` |
| 第 2 章 | 突防武器对地舰穿透率 | `weapon.penetration_metrics` | `from_operator` | `MOP` | `0.4125` | `-` | `-` | ✅ valid | `ratio` |

---

## 5. 一库 40 项实证算子真机体检矩阵（有效 35 / 不可用 5）

一库算子通过常驻 Python Worker 进程池执行，支持双 UTF-8 BOM 自动剔除与列裁剪加速。本次真机体检执行耗时 **79.5 秒**。

| 序号 | 算子名称 | 算子ID | 层级定位 | 章节 | 状态 | 产出行数 | 产出列数 | 耗时(ms) | 核心产出列明细 |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| 1 | 综合拦截概率 | `air_defense.composite_interception_probability` | `fact` | 第 7 章 | ✅ valid | 2 | 4 | 250.7 | `分方, 尝试拦截目标数, 成功拦截数, 综合拦截率` |
| 2 | 防空探测区域 | `air_defense.detection_zone` | `fact` | 第 7 章 | ✅ valid | 8 | 3 | 379.5 | `型号, 分方, 最大探测距离_海里` |
| 3 | 拦截区域（型号级） | `air_defense.model_intercept_zone` | `legacy_aggregate` | 第 7 章 | ✅ valid | 2 | 3 | 84.2 | `发射平台型号, 分方, 发射距离_海里` |
| 4 | 拦截区域（单元级） | `air_defense.unit_intercept_zone` | `fact` | 第 7 章 | ✅ valid | 2 | 5 | 60.1 | `发射平台ID, 发射平台名, 分方, 发射平台型号, 发射距离_海里` |
| 5 | 态势完整度 | `c2.situational_completeness` | `fact` | 第 5 章 | ⚠️ unavailable | 0 | 0 | 0.1 | `-` |
| 6 | 飞机损失（按型号）指标 | `cost.aircraft_losses_by_model` | `fact` | 第 3 章 | ✅ valid | 1 | 3 | 165.8 | `分方, 飞机型号, 损失数量` |
| 7 | 任务消耗战损指标 | `cost.mission_attrition_metrics` | `fact` | 第 3 章 | ✅ valid | 18 | 5 | 241.0 | `任务, 分方, 人员损失, 成本_亿元, 平台损失` |
| 8 | 平台毁伤概率指标 | `cost.platform_damage_probability` | `fact` | 第 3 章 | ✅ valid | 6 | 4 | 137.1 | `分方, 毁伤等级, 单元数, 占比` |
| 9 | 分方消耗战损指标 | `cost.side_attrition_metrics` | `fact` | 第 3 章 | ✅ valid | 4 | 14 | 7400.6 | `分方, 人员损失, 成本_亿元, 平台损失, 非主战平台损失, 弹药消耗, 弹药发射, 航空燃油消耗...` |
| 10 | 分方交换比指标 | `cost.side_exchange_ratio` | `legacy_aggregate` | 第 3 章 | ✅ valid | 6 | 14 | 169.9 | `分方比, 人员损失比, 成本比, 平台损失比, 非主战平台损失比, 弹药消耗比, 弹药发射比, 航空...` |
| 11 | 型号探测 | `detection.model_detection` | `legacy_aggregate` | 第 2 章 | ✅ valid | 107 | 3 | 96.2 | `探测平台型号, 探测目标型号, 平均首次发现距离` |
| 12 | 单元探测 | `detection.unit_detection` | `fact` | 第 2 章 | ✅ valid | 1675 | 6 | 307.6 | `探测平台, 探测目标, 首次发现距离, 探测传感器, 探测平台型号, 分方` |
| 13 | 短波通信网台干扰明细 | `ew.hf_comm_jamming_detail` | `fact` | 第 6 章 | ⚠️ unavailable | 0 | 0 | 0.1 | `-` |
| 14 | 短波通信分方汇总 | `ew.hf_comm_jamming_side_summary` | `legacy_aggregate` | 第 6 章 | ⚠️ unavailable | 0 | 0 | 0.1 | `-` |
| 15 | 持续干扰时间 | `ew.jamming_duration` | `fact` | 第 6 章 | ✅ valid | 187 | 4 | 6842.9 | `单元ID, 单元名, 分方, 累计受扰秒数` |
| 16 | 型号识别 | `fire_control.model_identification` | `legacy_aggregate` | 第 2 章 | ✅ valid | 57 | 3 | 31.3 | `识别平台型号, 识别目标型号, 平均首次识别距离` |
| 17 | 单元识别 | `fire_control.unit_identification` | `fact` | 第 2 章 | ✅ valid | 435 | 6 | 352.5 | `识别平台, 识别目标, 首次识别距离, 识别传感器, 识别平台型号, 分方` |
| 18 | 单元杀伤链闭环 | `fire_control.unit_kill_chain_closure` | `fact` | 第 2 章 | ✅ valid | 1330 | 14 | 684.9 | `目标ID, 目标名, 目标型号, 分方, 发现时间, 识别时间, 齐射时间, 毁伤时间, 杀伤闭环总...` |
| 19 | 型号杀伤链闭环时间 | `fire_control.model_kill_chain_closure_time` | `legacy_aggregate` | 第 2 章 | ✅ valid | 6 | 5 | 314.8 | `型号, 数量, 平均时间, 最长时间, 最短时间` |
| 20 | 发现率 | `isr.detection_rate` | `fact` | 第 4 章 | ⚠️ unavailable | 0 | 0 | 0.1 | `-` |
| 21 | 预警时间 | `isr.early_warning_time` | `fact` | 第 4 章 | ⚠️ unavailable | 0 | 0 | 0.1 | `-` |
| 22 | 识别用时 | `isr.identification_latency` | `fact` | 第 4 章 | ✅ valid | 135 | 3 | 479.3 | `单元, 识别时间_秒, 分方` |
| 23 | 侦察效率（探测区域面积） | `isr.radar_coverage_area` | `fact` | 第 4 章 | ✅ valid | 0 | 4 | 16341.5 | `分方, 时间, 面积_平方米, 面积_平方公里` |
| 24 | 侦察范围 | `isr.reconnaissance_range` | `fact` | 第 4 章 | ✅ valid | 24 | 3 | 134.4 | `型号, 探测范围_海里, 分方` |
| 25 | 单巡逻任务指标 | `patrol.single_mission_metrics` | `fact` | 第 1 章 | ✅ valid | 9 | 11 | 20589.4 | `任务ID, 任务名, 分方, 子类型, 投入单元, 损失单元, 保持阵位秒数, 保持阵位时间不小于,...` |
| 26 | 多巡逻任务综合指标 | `patrol.composite_mission_metrics` | `legacy_aggregate` | 第 1 章 | ✅ valid | 3 | 5 | 121.9 | `分方, 平均完成比, 平均巡逻时长, 平均战损单元数量, 平均指派单元数量` |
| 27 | 巡逻单元完成情况 | `patrol.unit_completion_status` | `fact` | 第 1 章 | ✅ valid | 89 | 9 | 6828.0 | `单元ID, 单元名, 所属任务ID, 任务名, 进入阵位时间, 离开阵位时间, 保持阵位秒数, 损失...` |
| 28 | 毁伤仿真 | `strike.damage_simulation` | `fact` | 第 1 章 | ✅ valid | 1 | 8 | 31.6 | `目标ID, 目标名, 所属任务ID, 所属任务名, 目标损伤程度, 损伤比不小于, 完成打击目标, ...` |
| 29 | 单攻击任务指标 | `strike.single_mission_metrics` | `fact` | 第 1 章 | ✅ valid | 1 | 10 | 9665.0 | `任务ID, 任务名, 分方, 投入单元, 目标数, 摧毁目标数, 命中目标数, 持续时间, 完成打击...` |
| 30 | 多攻击任务综合指标 | `strike.composite_mission_metrics` | `legacy_aggregate` | 第 1 章 | ✅ valid | 1 | 4 | 76.8 | `分方, 平均完成比, 任务平均时长, 平均派遣单元数量` |
| 31 | 单支援任务指标 | `support.single_mission_metrics` | `fact` | 第 1 章 | ✅ valid | 7 | 11 | 3575.2 | `任务ID, 任务名, 分方, 子类型, 投入单元, 损失单元, 保持阵位秒数, 保持阵位时间不小于,...` |
| 32 | 多支援任务综合指标 | `support.composite_mission_metrics` | `legacy_aggregate` | 第 1 章 | ✅ valid | 3 | 5 | 132.3 | `分方, 平均完成比, 平均支援时长, 平均战损单元数量, 平均指派单元数量` |
| 33 | 支援单元完成情况 | `support.unit_completion_status` | `fact` | 第 1 章 | ✅ valid | 14 | 9 | 3614.1 | `单元ID, 单元名, 所属任务ID, 任务名, 进入阵位时间, 离开阵位时间, 保持阵位秒数, 损失...` |
| 34 | 打击范围 | `weapon.engagement_range` | `fact` | 第 2 章 | ✅ valid | 6 | 4 | 13.5 | `统计口径, 分方, 型号, 打击范围` |
| 35 | 弹药效能指标（按型号） | `weapon.munition_effectiveness_by_model` | `legacy_aggregate` | 第 2 章 | ✅ valid | 6 | 9 | 222.1 | `发射分方, 武器型号, 平均飞行时间, 平均发射距离, 命中率, 被拦截率, 自毁率, 故障率, 未...` |
| 36 | 弹药效能（按型号+目标） | `weapon.munition_effectiveness_by_target` | `legacy_aggregate` | 第 2 章 | ✅ valid | 26 | 10 | 35.1 | `发射分方, 武器型号, 目标单元ID, 平均飞行时间, 平均发射距离, 命中率, 被拦截率, 自毁率...` |
| 37 | 弹药打击情况 | `weapon.munition_engagement_status` | `fact` | 第 2 章 | ✅ valid | 51 | 13 | 54.5 | `武器ID, 武器名, 武器型号, 发射单元, 目标单元, 飞行时间, 发射距离, 命中, 被拦截, ...` |
| 38 | 对地/舰穿透指标 | `weapon.penetration_metrics` | `fact` | 第 2 章 | ✅ valid | 2 | 7 | 43.8 | `发射分方, 武器型号, 发射数, 穿透数, 命中数, 穿透率, 穿透后命中率` |
| 39 | 平台发射指标 | `weapon.platform_launch_metrics` | `legacy_aggregate` | 第 2 章 | ✅ valid | 6 | 5 | 21.3 | `分方, 平台型号, 武器型号, 自身单元生存概率, 发射总数量` |
| 40 | 平台发射情况 | `weapon.platform_launch_status` | `fact` | 第 2 章 | ✅ valid | 16 | 5 | 17.2 | `分方, 发射单元, 武器型号, 发射数量, 自身毁伤` |

---

## 6. Fail-Closed 缺失证据链与缺表诊断分析

根据推演评估中台实证门控铁律，当推演引擎未导出特定事件表或某阵营在某维度无样本时，评估系统绝不伪造默认数值（杜绝 `|| 0.85`），严格返回 `unavailable` 并将缺失证据链向上透传。

| 算子ID | 算子名称 | 缺失必需表 | 缺失判定证据说明 |
| :--- | :--- | :--- | :--- |
| `c2.situational_completeness` | 态势完整度 | `UnitCreated, ContactCreated` | 缺少必需推演事件底表: ContactCreated |
| `ew.hf_comm_jamming_detail` | 短波通信网台干扰明细 | `CommCreated, CommClassUsed, CommIsJammedChanged` | 缺少必需推演事件底表: CommIsJammedChanged |
| `ew.hf_comm_jamming_side_summary` | 短波通信分方汇总 | `CommCreated, CommClassUsed, CommIsJammedChanged` | 缺少必需推演事件底表: CommIsJammedChanged |
| `isr.detection_rate` | 发现率 | `UnitCreated, ContactCreated` | 缺少必需推演事件底表: ContactCreated |
| `isr.early_warning_time` | 预警时间 | `DetectionIdentificationChanged, ContactCreated, WeaponEndgame` | 缺少必需推演事件底表: ContactCreated |

---

## 7. 结论与交付合规性声明

1. **三库 Plan A 强隔离验证**：一库共执行 **40** 项算子（有效 **35** 项，Fail-Closed 不可用 **5** 项），二库 `mg_v4_metrics_guide_full` 共计算 **31** 项客观指标，三库 `sys_v4_metrics_guide_full` 完成全部 **3** 个活跃阵营（红方 / 绿方 / 蓝方）评估。
2. **前后端统一阵营切片管道**：本脚本与 REST API（`/api/v4/metric-graphs/execute`、`/api/v4/system-dags/evaluate`）共同调用 `v4-routes.ts` 导出的 `sliceOperatorResultsBySide`，彻底消除双份实现漂移。
3. **三阵营评估结果摘要**：
   - 红方综合得分 **76.37**（门控裁决 `PASS`）
   - 绿方综合得分 **80.24**（门控裁决 `PASS`）
   - 蓝方综合得分 **83.22**（门控裁决 `PASS`）
