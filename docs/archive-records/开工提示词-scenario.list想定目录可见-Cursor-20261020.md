# 开工提示词：scenario.list——让 AI 看见想定目录（治"猜路径装载失败"）

> 派单：Kimi（监理）2026-10-20 ｜ 施工：Cursor ｜ 级别：P1（面板③段正在爆）
> **纯 proxy（JS）改动，不碰 C#、不碰桥、不编译、不连真桥、不动槽目录实物；改完不要重启 proxy（监理统一重启）。**

---

## 一、故障现象（owner 实测截图，2026-10-20 15:29）

面板③段建场，AI 要"从带阵营的干净底版开工"，装载锚点底版连错两次：

- 猜路径① → 被判"不在授权范围"（猜到了生产树路径，被槽防呆拦）；
- 猜路径② → 报"文件不存在"；
- 然后停摆弹确认卡，处置建议竟是**让用户手动把锚点文件搬到 AI 目录并改名**——违反"不得让用户协助操作"铁律。

**实测事实**：文件都在槽里——`slot-01\data\Scenarios\测试.scen`（通用锚点）、`slot-01\data\Scenarios\AI\空白想定.scen`（sync-base 底版）均存在。

**病根**：AI 的想定工具只有 scenario.load / scenario.save / scenario.get_summary / scenario.set_time（tools.mjs:82/343/354/362），**没有列目录能力**，授权目录里有什么它完全看不见，只能猜。

## 二、任务（两件，都在 proxy）

### 2.1 新增只读工具 `scenario.list`

- **功能**：列出授权想定目录树下全部 `.scen` 文件，返回：`相对路径、大小、mtime`，按 mtime 倒序，默认上限 200 条（防刷屏，可用参数调）。
- **授权根判定**（复用既有机制，别新造）：
  - 会话已绑定槽 → 槽 `data_dir`（pools.json，slots.mjs 已有读取逻辑）下的 `Scenarios\` 递归（含 `Scenarios\AI\` 等子目录）；
  - 未绑定/单槽生产 → 生产树 Scenarios 根（沿用 scenario.save 回填/Q-016 scenario-path.mjs 已识别的根，保持一致口径）；
  - 未知槽号/缺 data_dir → 回落生产行为，并在结果里带一行 `degraded` 说明（参照槽 DB 防呆的降级口径）。
- **安全**：只列文件名与元数据，**不读文件内容**；结果路径必须落在授权根内（防 `..` 越界、防 junction 逃逸——注意槽 `WW` 是 junction，Scenarios 树若遇 junction/符号链接不要跟随）；纯 proxy `fs` 读，**不经桥**。
- **注册**：tools.mjs，TIER 与 scenario.get_summary 同级（只读），可用段与 scenario.load 一致；描述里写死一句"**装载/保存想定前必须先调本工具确认真实路径，禁止凭记忆猜路径**"。

### 2.2 scenario.load 失败时附候选清单

- scenario.load 返回 `file_missing`（文件不存在）或路径越权类错误时，在错误返回里附 `candidates`：授权根内 `.scen` 相对路径前 20 个（mtime 倒序），文案含"先用 scenario.list 看可用底版，禁止猜路径"。
- 越权错误保持原有拦截语义不变，只是多带候选；不得因附带清单泄露授权根之外的路径。

## 三、验收标准

1. 新增 `demo-ui/proxy/scenario-list.test.mjs` 全绿，覆盖：①槽内递归列出含子目录、②`..`/symlink 越界被拒、③未绑槽回落生产根、④load file_missing 带 candidates 且无越权路径、⑤上限截断生效。
2. `npm run test:all` 全量不退步（基线 298/299，红 1 = Q-050 已知 flaky，不得新增红）；新测试文件在清单**仅末尾追加**。
3. `git status` 无越界文件（只许：tools.mjs、scenario-path.mjs 或新 scenario-list 模块、新测试、test:all 清单）。
4. 完工报告：契约示例（list 返回 JSON 样例 + load 失败带 candidates 样例）、测试清单、存疑项。

## 四、边界（已登记，照做不用问）

- 本单只做 proxy 数据面；③段 prompt/skill 的"先 list 再装载"规矩由 Kimi 自己补（Q-055② 落地），不在本单。
- 不做"自动选底版"——选哪个底版是 AI 按 skill 规程判断的事，工具只负责让它看见。
- 底版/锚点文件本身的命名规范化（地域/地狱景观易混名）另案处理，不在本单。
