# 1

**派单日期**：2026-10-14 晚
**执行方**：Cursor
**仓库**：D:\soft\F1-AI\demo-ui
**基线**：master 含 806f7b73（伪造/半途/超时批），test:all 193 pass，proxy 7177 在跑新代码，现役模型 deepseek-flash

***

## 背景（owner 拍板 2026-10-14 晚）

开发工作流定了角色—模型映射：**开发/执行（③段为主）= deepseek-flash；审理（④段判读/复核/评判卡）= deepseek-v4-pro**。现在 proxy 是全局单模型（ACTIVE\_PROVIDER 一刀切），需要按段路由。provider.mjs 已有多模型表（PROVIDERS/resolveActiveProvider/applyProviderPayloadExtras），本单是在其上加"按段选模型"，**不是推翻重做**。

## 要求

1. **按段模型映射**：callUpstream 已经收 stage 参数（server.mjs），路由发生在 provider 层：

   * 默认映射：①②③段 → `deepseek-flash`；④段 → `deepseek-v4-pro`；

   * 映射可配置：`.env` 加 `STAGE_MODEL_JSON`（如 `{"1":"deepseek-flash","2":"deepseek-flash","3":"deepseek-flash","4":"deepseek-v4-pro"}`），缺省用默认映射；非法 JSON 启动即报错；

   * 模型名不属于现役 provider 的端点时（如配了 mimo 的模型），按 provider 表解析端点+key；解析不出启动报错。
2. **/health 扩展**：返回每段生效的 provider+model（映射全表），不只全局一个。
3. **v4-pro 思考模式核实**（必做，不许猜）：查 DeepSeek 官方文档（api-docs.deepseek.com）确认 `deepseek-v4-pro` 的默认思考模式与 `thinking`/`reasoning_effort` 参数规矩、以及思考模式下多轮工具调用对 `reasoning_content` 的回传要求（注意：DeepSeek 与 MiMo 规矩可能**相反**——MiMo 必须回传，DeepSeek 可能禁止回传）。结论写进完工报告；若 v4-pro 默认思考开启且与工具调用冲突，给 provider 表加 `payloadExtras` 项（④段请求带 `thinking` 关闭参数），并在报告里给证据。
4. **审计**：每轮对话的留档/审计记录实际使用的 model（archiveRound/claim audit 加 model 字段），A/B 与成本归因要用。
5. **成本提示**：v4-pro 独立计价更贵，完工报告里写一句 ④段调用量预估口径（④段轮次 × 平均 token）。

## 验收

* `npm run test:all` 全绿（193 + 新增）：映射解析、非法 JSON 启动报错、④段请求带 v4-pro 模型名（fake 上游断言 payload.model）、审计含 model 字段；

* 真机冒烟（owner 在场，proxy 重启后）：③段问一句 → 留档 model=deepseek-flash；④段问一句 → 留档 model=deepseek-v4-pro 且无 400；

* 完工报告落 `LabConsole\outputs\proxy按段路由-Cursor报告-20261014.md`，含 DeepSeek 文档核实结论（附 URL）。

## 红线

* ACTIVE\_PROVIDER 全局开关保留（按段映射叠加其上，段内模型仍受 ACTIVE\_PROVIDER 的端点/key 约束——除非 STAGE\_MODEL\_JSON 显式跨 provider 指定）；

* guard/租约/dbgate/claimcheck 判定逻辑不动；.env 里的 key 不动；

* 与 Claude 池化阶段 3（proxy 多槽改造）有文件冲突风险（都碰 server.mjs）——**本单优先，池化阶段 3 等你提交后才动工**，提交后报告里写明。

