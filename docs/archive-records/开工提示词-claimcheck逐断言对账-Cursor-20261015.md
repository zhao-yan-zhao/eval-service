# 开工提示词 · claimcheck 逐断言对账（Q-019 尾巴①）（Cursor · worktree 隔离）

> 背景：claimcheck 已是 v2.1（完成态动词收紧+引号剥离+对账豁免），但审计粒度停在**轮级**——一轮里 AI 说 5 句话，只要大体对得上就放行，单句撒谎抓不出。Q-019 尾巴①：把对账粒度降到**逐断言**。尾巴②（引用误伤调优）**不在本单**——先收集真机误拦样本再调阈值，不许拍脑袋调。
> 日期：2026-10-15

## 仓库与边界（重要：worktree 隔离）

Claude 正在 `D:\soft\F1-AI\demo-ui` 主干施工池化阶段 3（server.mjs/guard.mjs 等），你必须隔离作业：

```bash
git -C D:\soft\F1-AI worktree add D:\soft\F1-AI-wt-q019 -b q019-claim-audit
```

- 你的工作目录 = `D:\soft\F1-AI-wt-q019\demo-ui`，提交到 `q019-claim-audit` 分支，合并归 Kimi；
- **只许碰** `proxy/claimcheck.mjs` + 新增测试文件（如 `proxy/claimcheck-perclaim.test.mjs`）；
- **严禁碰** `server.mjs` / `guard.mjs` / `lease*.mjs` / `conversation-store.mjs` / `bridge.mjs` / `package.json`——若发现必须碰才能接线，**停下来**，把接线建议写进报告"存疑"节，由 Kimi 在 Claude 完工后合并时接；
- 新测试**不要**加进 `package.json` 的 test:all（避免与 Claude 撞车），用 `node --test proxy/claimcheck-perclaim.test.mjs` 单独跑，报告里注明文件名，Kimi 合并时入列。

## 任务：逐断言对账

现状：claim audit 的 `claims[]` 只列抽取到的断言，对账结论是轮级 pass/marked。

要求：

1. **逐断言比对**：每条 claim 单独判定——`supported`（工具流水/对账信标里有对应证据）/ `unsupported`（无证据）/ `na`（非事实性陈述）；判定依据写进审计（claim 级 `evidence` 字段：支撑它的工具调用序号或信标摘要）；
2. **轮级结论聚合规则**：任一 claim `unsupported` → 轮级 marked（沿用现有硬拦/告示链路，不改拦截行为本身）；
3. **审计 schema 扩展是纯增量**：既有字段不动，新增 `claim_verdicts[]`；留档/面板消费方不受影响；
4. **动词词典/判定正则可以调**（在 claimcheck.mjs 内），但 Q-019 尾巴②的阈值调优不在本单——只许修"明显漏抽"的断言形态，并在报告里列出改动点。

## 验收

- `node --test` 既有 claimcheck 三件套（claimcheck/claimcheck-v2/claimcheck-v2.1 相关测试）在 worktree 里全绿 + 新测试文件绿；
- 新测试须含：单轮多断言中夹杂 1 条无证据断言 → 该条 `unsupported`、轮级 marked；全有证据 → 全 `supported`、轮级 pass；引用/复述上一轮工具结果的陈述 → 不误判 unsupported（recap 豁免场景的 claim 级版本）；
- 完工报告落 `LabConsole\outputs\claimcheck逐断言对账-Cursor报告-20261015.md`（注意：写到**主仓**的 LabConsole\outputs，不是 worktree 里）：schema 对照表、聚合规则、接线建议（若 server.mjs 需动）、存疑节。
