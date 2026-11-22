# 开工提示词：proxy 三件套（多模型配置 + MiMo 适配 + claimcheck v2 硬拦）

**派单日期**：2026-10-14
**执行方**：Cursor
**仓库**：D:\soft\F1-AI\demo-ui（proxy 子目录为主战场）
**基线**：master 含 Q-040 修复（d07dd1b5），test:all 153 pass / 0 fail，proxy 7177 在跑

---

## 背景（一页看懂）

T0 试车期间 DeepSeek 两次整轮编造执行结果（声称"另存成功/跑局成功"，实际零工具调用）。claimcheck 命中了但只前置警告文本、原文照发（server.mjs:721），拦不住。owner 裁决：升级为硬拦。同时 owner 拿到小米 MiMo key，要求双基座并存、可随时切换。

## 任务一：多模型配置（双基座并存 + 切换）

现状：server.mjs:53-57 硬编码 `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` / `DEEPSEEK_BASE_URL`，callUpstream（L130-155）直读。

要求：

1. 抽象 provider 表（deepseek / mimo 两条），每项含 keyEnv、baseUrlEnv、modelEnv、defaultBaseUrl、defaultModel：
   - deepseek：默认 `https://api.deepseek.com/chat/completions` / `deepseek-chat`（与现状一致）
   - mimo：默认 `https://api.xiaomimimo.com/v1/chat/completions` / `mimo-v2.6-pro`
2. `ACTIVE_PROVIDER` 环境变量选provider（默认 deepseek，非法值启动即报错退出，不静默回落）。
3. 切换方式基线 = 改 .env 一行 + 重启 proxy。**另评估** `GET /api/model`（查当前 provider/model/hasKey）与热切换 POST 接口的工作量，先把工时报给 owner 再决定做不做；若做，热切换只影响新请求，在途 SSE 会话不断。
4. `/health`（L608 附近）扩展：返回 active provider、model、hasKey。
5. callUpstream 报错文案泛化（现状 L132 写死"请在 proxy/.env 中填写"——改为指出具体缺哪个变量）。

**.env 处理纪律**：proxy/.env 已被 .gitignore 覆盖（勿动 gitignore）。在 .env 追加注释模板行与默认值行（MIMO_BASE_URL / MIMO_MODEL / ACTIVE_PROVIDER=deepseek），**MIMO_API_KEY 留空等 owner 手填，DEEPSEEK_API_KEY 现有行一字不动**。任何日志、审计、报错信息不得打印 key 本体。

## 任务二：MiMo reasoning_content 回传适配

背景：MiMo 思考模式 + 工具调用时，后续请求的 messages 里必须原样携带上一轮 assistant 的 `reasoning_content`，否则上游 400。

两条 assistant 入列路径都要保：

1. server.mjs:367 `conv.push(choice)`（原生 function calling，整对象入列）——核实 reasoning_content 是否随对象自然带回；若上游返回在 message 里则已带，**补单测钉死**。
2. server.mjs:389 `conv.push({ role:'assistant', content: stripToolBlocks(text) })`（文本工单兜底，重建对象会丢）——改为保留 `choice.reasoning_content`（存在才加字段）。

DeepSeek 收到多余字段会忽略，不影响回归（单测断言 DeepSeek 路径 payload 兼容）。

另加配置开关 `MIMO_THINKING=on|off`（默认 on）：off 时在 payload 加关思考字段——**字段名以 MiMo 官方文档为准**（platform.xiaomimimo.com），实现前先核实；核实不到就不要猜，改为支持 `MIMO_EXTRA_PAYLOAD_JSON` 透传任意 JSON 合入 payload，并在完工报告里如实写"关思考字段未核实，留了透传扩展点"。

## 任务三：claimcheck v2 —— marked 硬拦

现状：server.mjs:711-730，marked 时 `marker + 原文` 发给前端（L721），编造内容完整送达。

必做（替换档）：

1. `verdict === 'marked'` 时，前端 SSE 收到的 text **替换**为固定告示，原文一律不发：
   `⚠ 本轮未执行任何工具，以下自述动作均无效：{claims 清单}。请重新下达指令或要求我先执行再汇报。`
2. 原文完整进审计（m6-claim-audit.jsonl 现有字段已够）与会话留档（persist 的 ai_message 事件 text 记原文，加 `blocked: true` 字段）。
3. `claim_check` SSE 事件照常发，加 `blocked: true`。

选配（重试档，先报工时，>2h 就砍）：marked 后把「你声称完成了动作但本轮没有任何工具调用记录，请如实重写，不得声称未执行的动作」作为 system 消息追加进对话，自动重请求一次；重试仍 marked 才落替换告示。注意重试不得突破 MAX_ROUNDS 语义。

回归钉死（claimcheck.test.mjs 扩 + 集成冒烟）：

- 计划轮不误拦：「计划确认后再动手」「需要您处理」类文本 zero tool 必须 pass（现有将来时/祈使过滤的回归用例）；
- marked 替换路径：前端收到告示、收不到原文、审计有原文；
- N>0 pass 语义不变（v2 逐断言对账是后续工单，本次不做）。

## 验收

1. `npm run test:all` 全绿（基线 153 + 新增），`tsc -b` 与 `vite build` 通过；
2. 真机冒烟两轮（owner 在场配合）：
   - DeepSeek 回归：③段问一个需要工具的问题（如查库），确认工具链路无回归；
   - MiMo 冒烟：owner 填 key 后 `ACTIVE_PROVIDER=mimo` 重启，跑一轮带工具调用的对话，确认无 400、reasoning_content 链路正常；
3. 完工报告落 `LabConsole\outputs\proxy三件套-Cursor报告-20261014.md`，含：改动文件清单、单测清单、MiMo 文档核实结果（含 URL）、热切换工时评估（如未做）、遗留项。

## 红线

- guard.mjs / 租约 / dbgate / 工具白名单语义一律不动；
- proxy 只监听 127.0.0.1 不动；
- .env 不进 git、key 不落任何日志/审计/报告；
- 不改 claimcheck 判定词典（动词表/排除词），词典调整属另一工单；
- 提交粒度：三任务可分 commit，报告哈希补记。
