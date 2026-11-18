# T06 开放项：无工具调用时的受控 JSON 指令协议

状态：**联调待确认**（不阻塞 T06-CORE）

## 背景
TECH_SPEC §4：若供应商无工具调用，**不可默默降级**，须在联调结论中确认是否允许「受控 JSON 指令协议」。

## 当前实现
- `OpenAiCompatibleProviderOptions.SupportsToolCalling = false` 且请求带 Tools → 立即 `Fault`，码 `tool_calling_unsupported`。
- HTTP 正文表明 tools/unsupported → 同样 Fault。
- **不会**自动改写为纯文本聊天或私下解析自由 JSON。

## 待 owner / 联调确认
1. 量界智算（及其他源）是否支持 OpenAI `tools` / `tool_calls`？
2. 若不支持，是否允许第二通道：模型输出约定 JSON schema 指令，由 C# 校验后映射到工具白名单？
3. 若允许，协议草案、诊断码与审计字段由后续任务单独立项（不在 T06-CORE）。

## 记录位置
- 执行记录：`runs/T06-CORE-execution-record.md` §6
- 审查包：`review-packs/T06-CORE-review-pack.md` §6
