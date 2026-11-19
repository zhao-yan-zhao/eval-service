# 开工提示词 · proxy 报警通道（Q-003 契约落地）· Cursor · 20261019

> 工单性质：proxy 新增报警接收端点 + 存储 + 面板透出。**不碰 C#、不碰看门狗**（看门狗推送端已具备）。
> 纪律照旧：最小改动、单测交付、完工报告落 `LabConsole\outputs\`。

## 背景与契约（已定案，照此施工）

看门狗 `LabConsole\tools\popup_watchdog\popup_watchdog.py` 的 `push_alarm` 已实现向外推送，
payload 格式（**契约，双方都不许改字段名**）：

```json
{
  "type": "popup_alarm",
  "title": "弹窗标题",
  "reason": "未命中白名单 等",
  "alarm_file": "D:\\...\\alarm-xxx.txt",
  "screenshot": "D:\\...\\xxx.png",
  "first_seen": "2026-10-19 12:00:00"
}
```

- 传输：HTTP POST `http://127.0.0.1:7177/api/alarms/popup`，Content-Type: application/json; charset=utf-8，5s 超时；
- 看门狗侧失败只记日志不影响自身（已实现）——proxy 宕机不挡看门狗报警落盘；
- 配置开关：看门狗 config.json 的 `alarm_push.proxy_url`（Kimi 在联调窗口填上，非本单范围）。

## proxy 侧要做的

### 1. 接收端点 `POST /api/alarms/popup`

- 校验：type 必须为 `popup_alarm`，title/reason 必填非空 → 400；合法 → 200 `{ok:true, id}`；
- **鉴权口径**：监听在 127.0.0.1 本机回环，沿用 proxy 既有本机信任模型，不加 token（与 /api/chat 一致）；
- 落盘：写 `PANEL_DATA_ROOT/alarms/popup-YYYYMMDD.jsonl`（append，与既有留档目录纪律一致）；
- 内存：维护"未确认报警"列表（带 id 自增、received_at、ack=false），供前端轮询；重启即清空（落盘 jsonl 是持久层）。

### 2. 透出两条路

- `GET /api/alarms?ack=false` → 未确认报警列表（脱敏原样返回，路径字段照传）；
- `POST /api/alarms/ack`（body: `{id}` 或 `{all:true}`）→ 标记已确认；
- `/health` 加 `alarms: { pending: N }` 一个字段，不动既有结构。

### 3. 前端最小透出（demo-ui/src）

- 顶部导航区（AppNav）加一个铃铛/红点：有未确认报警时显示数量，点击展开列表（标题/原因/时间/报警文件路径），
  每条可"确认"、可"全部确认"；轮询间隔 10s（沿用前端既有轮询封装，别新造轮子）；
- 报警出现时不弹模态、不抢焦点——它只是告示牌。

### 4. 面板 AI 感知（简单可靠版）

- ③段 chatLoop 的 system 尾部（toolNoticeForStage 同链路）在有未确认报警时追加一行：
  `【系统告示】当前有 N 条未处置的弹窗报警（F1 界面可能被弹窗卡住），请告知用户查看面板报警区。`
- 报警清零后不再追加。实现走"每次组 system 时读内存计数"，不要往历史里塞。

## 测试

- 端点单测：合法 payload 落盘+入列 / 缺字段 400 / ack 单条与全部 / health 带 pending；
- system 注入单测：有报警时 system 含告示行、清零后不含；
- 全量 test:all 必须绿；新测试文件只准加进清单末尾。

## 红线

- 不改看门狗任何代码与 payload 格式；
- 报警文件/截图路径只展示、不替用户打开；
- 不引入前端新依赖。

## 验收锚点（Kimi 复核用）

1. 看门狗 config 填上 proxy_url 后真机联调：人为造一个白名单外弹窗 → 面板铃铛出数、③段下一轮 AI 主动告知、ack 后清零；
2. proxy 重启后 jsonl 仍在、内存列表清空（健康口径如实）；
3. test:all 全绿计数写入完工报告。
