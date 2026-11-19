# A14 R2B 独立定点审查（单轮）

你是独立审查端，审查现有稳定版结构化事件修复，不写业务代码、不代执行端自评、不执行真机操作。按 `D:\soft\F1-AI\多模型协作章程.md` 采用高风险定点审查；角色与实际模型/档位如实记录。

工作区 `D:\soft\F1-AI-final-r2b`，预期 HEAD `a34ad8f5d3e3242463dc64c67c647e9b4ec3622f`；集成基线当前记录为 be51696，开工核 Git 事实。R2B 整批差异 `4d93828..a34ad8f`，最后一轮 `42fc539..a34ad8f`。HEAD/源码若变化先报告差异。既存 runs 脏项保留。

必读：

- `D:\soft\F1-AI\FINAL-BATCH-R2B-A14-事件分钟语义与真Upsert返修-Cursor工单-20260904.md`
- `D:\soft\F1-AI\FINAL-BATCH-R2B-R1-A14-Lua静默失败与动作清理边界-Cursor工单-20260904.md`
- `D:\soft\F1-AI\FINAL-BATCH-R2B-R2-A14同名大小写与历史重复关联收敛-Cursor工单-20260904.md`
- `D:\soft\F1-AI-final-r2b\runs\continue-20260909-r2b-report.md`
- `D:\soft\F1-AI-final-r2b\runs\continue-20260909-r2b-knowledge.md`
- `D:\soft\F1-AI\CONTINUE-R2B-20260911-监理复核记录.md`（若尚未存在，报告未找到，待监理提供，不编造其结论）。

范围只包含两份生产文件 `CMO-netcore-src/AiAssistant.F1Core/CoreF1AutomationFacade.cs`、`LuaEventTemplate.cs` 及本批五份测试；关联 Command_Core/Lua/LuaEvent.cs 和 LuaSandBox 调用语义只读取证，不做全仓重审。

定点回答：

1. ResolvePlan 的 canonical、owned 枚举与关联计数是否同真实 F1 查找/移除语义一致；Mine→mine、sentinel、130→1、重复关联收敛是否证据充分。
2. 时间为 scen.Time.AddMinutes(N)，必需步骤 nil 是否可误报成功；unlink 的 nil 与预算上界语义有无可达反例。不靠泛泛的“可能竞态”判失败，必须给触发条件与代码位置。
3. 其他事件/普通组件保护边界：名称属于工具但对象被别的事件复用时，更新/解绑/删除行为是否符合原工单；区分已证缺陷与待测边界。
4. 真非交互 Scenario 行为测试、Lua 字符串形状断言、未来事件动作实际触发三类证据分别证明什么；不把 upsert 成功解释成未来动作一定执行成功。
5. 原要求的“旧实现真实锁红”目前没有可引用原始日志。明确写出是否阻止本批审查通过及理由；如需补证，只列最小旧版本/反例和通过标准，不要求重做全部测试或修改业务码。
6. 给出可合入/需返修/需补证的明确结论和条件；自动测试通过不是 MACHINE_PASS，不提前批准运行包灌装或发布。

产物：仅写 `D:\soft\F1-AI\reviews\independent-r2b-20260911.md`，含审查者真实身份、完整 SHA、风险级别、逐项原文引用/行号、可复现反例、最小建议、知识增量。公共知识由 Codex 统一汇总，不直接写 runs/knowledge.md、HANDOFF 或矩阵。不修改、提交、合并或清理任何其他文件，不启动 F1。

已有监理测试日志可只读复核，无代码变化且证据充分时不重复整轮编译；需要新增执行时遵守公共约束中的 dotnet Mutex，所有外部访问需符合本轮无真模型/无生产数据的边界。
