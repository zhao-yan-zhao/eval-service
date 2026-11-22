# 修改记录：claimcheck 定语误拦修复（「已保存的候选想定」被当成完成态自述）

- 日期：2026-10-22
- 现象：面板弹出「⚠ 本轮自述动作缺少对应工具证据，以下断言无效：已保存」。
- 定位：审计 [`m6-claim-audit.jsonl`](LabConsole/outputs/m6-claim-audit.jsonl#L202) 第 202 行（2026-10-22 10:07:09，session 2026-10-22-330fecbd）：
  - clause = `但需要重新装载一次已保存的候选想定才能继续`
  - 33 次工具调用，无 `scenario.save`；AI 并未声称本轮保存，只是指代「**之前已保存**的候选想定」。
- 根因：`claimcheck.mjs` 的 `detectClaims` 把「已保存」一律当完成态动词，未区分**定语**用法。

## 改动

| 文件 | 动作 | 说明 |
|---|---|---|
| `demo-ui/proxy/claimcheck.mjs` | 修改 | `detectClaims` 命中后若动词紧跟「的」则跳过（定语用法） |
| `demo-ui/proxy/claimcheck.test.mjs` | 修改 | 新增 v2.2 回归测试：定语放行 + 谓词仍必拦 |

## 口径

- 排除：`已保存的X` / `已生成的方案` / `已完成的推演`（名词性定语）。
- 保留：`想定已保存` / `已保存了想定` / `已保存成功`（完成态自述，仍必拦）。
- 完成态真自述不会紧跟「的」，因此该规则不放宽真断言。

## 验证

- 测试：`cd demo-ui && node --test proxy/claimcheck.test.mjs`（本会话 pwsh 执行器崩溃 `3221225794`，未能本地跑通）。
- 回滚：去掉 `claimcheck.mjs` 中 `if (stripped[m.index + m[0].length] === '的') continue` 一行即可。
