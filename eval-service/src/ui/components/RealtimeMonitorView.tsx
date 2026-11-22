import {
  Activity,
  BellOff,
  CheckCircle2,
  Download,
  Eye,
  Flame,
  Pause,
  Play,
  Radio,
  ShieldAlert,
  StepForward,
  Upload,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  evalApi,
  type DataSourceStatus,
  type IndicatorSystem,
  type RealtimeJudgementCard,
  type RealtimeSnapshot,
} from '../api.ts';

interface RealtimeMonitorViewProps {
  systems: IndicatorSystem[];
}

export function RealtimeMonitorView({ systems }: RealtimeMonitorViewProps) {
  const [runId, setRunId] = useState('rt_live_q109');
  const [systemId, setSystemId] = useState(
    systems.find((s) => s.systemId === 'sys_littoral_swarm_v1')?.systemId ??
      systems[0]?.systemId ??
      'sys_littoral_swarm_v1',
  );
  const [speed, setSpeed] = useState(2);
  const [snapshot, setSnapshot] = useState<RealtimeSnapshot | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [simMinOffset, setSimMinOffset] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // 外部流与自定义 JSONL 上传状态
  const [jsonlSources, setJsonlSources] = useState<DataSourceStatus[]>([]);
  const [sourceChoice, setSourceChoice] = useState<string>('builtin_bs');
  const [uploadedLines, setUploadedLines] = useState<string[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const jsonlInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    evalApi
      .listDataSources()
      .then((res) => {
        setJsonlSources(res.dataSources.filter((d) => d.sourceKind === 'jsonl_file'));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/realtime/stream');
    eventSourceRef.current = es;
    es.addEventListener('connected', () => setSseConnected(true));
    es.addEventListener('frame', (ev) => {
      try {
        const parsed = JSON.parse((ev as MessageEvent).data) as {
          runId: string;
          data?: { snapshot?: RealtimeSnapshot };
        };
        if (parsed?.data?.snapshot && Array.isArray(parsed.data.snapshot.cards)) {
          setSnapshot(parsed.data.snapshot);
        }
      } catch {}
    });
    es.addEventListener('status', (ev) => {
      try {
        const parsed = JSON.parse((ev as MessageEvent).data) as { data?: RealtimeSnapshot };
        if (parsed?.data && Array.isArray(parsed.data.cards)) {
          setSnapshot(parsed.data);
        } else {
          setSnapshot(null);
        }
      } catch {
        setSnapshot(null);
      }
    });
    es.addEventListener('card', () => {
      void evalApi
        .getRealtimeSession(runId)
        .then((r) => {
          if (r?.snapshot && Array.isArray(r.snapshot.cards)) {
            setSnapshot(r.snapshot);
          }
        })
        .catch(() => {});
    });
    es.addEventListener('card_updated', (ev) => {
      try {
        const parsed = JSON.parse((ev as MessageEvent).data) as { data?: RealtimeJudgementCard };
        if (parsed?.data?.cardId) {
          setSnapshot((prev) =>
            prev && Array.isArray(prev.cards)
              ? {
                  ...prev,
                  cards: prev.cards.map((c) => (c.cardId === parsed.data!.cardId ? parsed.data! : c)),
                }
              : prev,
          );
        }
      } catch {}
    });
    es.onerror = () => setSseConnected(false);

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [runId]);

  const initSession = async () => {
    setMsg(null);
    try {
      let res: { snapshot: RealtimeSnapshot };
      if (sourceChoice === 'uploaded' && uploadedLines.length > 0) {
        res = await evalApi.createRealtimeSession({
          runId,
          source: 'jsonl_text',
          jsonlLines: uploadedLines,
          systemId,
          speedMultiplier: speed,
        });
      } else if (sourceChoice.startsWith('ds:')) {
        const sourceId = sourceChoice.slice(3);
        res = await evalApi.createRealtimeSession({
          runId,
          source: 'data_source',
          sourceId,
          systemId,
          speedMultiplier: speed,
        });
      } else {
        res = await evalApi.createRealtimeSession({
          runId,
          source: 'builtin_bs',
          systemId,
          speedMultiplier: speed,
        });
      }
      setSnapshot(res.snapshot);
      setSimMinOffset(1);
      setMsg('已加载实时状态帧流，可点击「播放」或「步进 1 帧」查看实时告警。');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUploadJsonlFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length === 0) {
        throw new Error('上传的 JSONL 文件为空');
      }
      setUploadedLines(lines);
      setUploadedFileName(file.name);
      setSourceChoice('uploaded');
      setMsg(`已加载本地状态帧文件「${file.name}」（共 ${lines.length} 帧），点击「创建/重置实时流」启动回放。`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExportAudit = (format: 'md' | 'json') => {
    if (!snapshot) return;
    const download = (name: string, content: string, mime: string) => {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    };

    if (format === 'json') {
      const payload = {
        exportedAt: new Date().toISOString(),
        runId: snapshot.runId,
        systemId: snapshot.systemId,
        status: snapshot.status,
        frameProgress: `${snapshot.cursor}/${snapshot.totalFrames}`,
        cards: snapshot.cards,
      };
      download(`realtime-audit-${snapshot.runId}.json`, JSON.stringify(payload, null, 2), 'application/json');
      return;
    }

    const lines = [
      `# 实时伴随研判与人工裁决 (HITL) 审计报告`,
      '',
      `- 会话 ID：\`${snapshot.runId}\``,
      `- 监测体系：\`${snapshot.systemId}\``,
      `- 帧进度：${snapshot.cursor} / ${snapshot.totalFrames}（推演时钟 ${snapshot.scenarioClock}）`,
      `- 导出时间：${new Date().toLocaleString()}`,
      '',
      `## 告警与人工处置明细（共 ${snapshot.cards.length} 条）`,
      '',
      '| 告警 ID | 推演时钟 | 严重度 | 指标/事件 | 判定说明 | 人工裁决状态 | 处置备注 |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    ];
    for (const c of snapshot.cards) {
      lines.push(
        `| ${c.cardId} | ${c.scenarioClock} | ${c.severity} | ${c.title} | ${c.summary.replace(/\|/g, '/')} | ${c.hitlAction ?? 'pending'} | ${(c.hitlNote ?? '-').replace(/\|/g, '/')} |`,
      );
    }
    download(`realtime-audit-${snapshot.runId}.md`, lines.join('\n'), 'text/markdown;charset=utf-8');
  };

  const control = async (action: 'play' | 'pause' | 'step' | 'stop') => {
    setMsg(null);
    try {
      const res = await evalApi.controlRealtimeSession(runId, {
        action,
        speedMultiplier: speed,
      });
      if (res.snapshot) setSnapshot(res.snapshot);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const stepClockIso = (clockText: string, deltaSeconds: number): string => {
    const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(clockText.trim());
    const baseSec = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 4 * 3600;
    const next = Math.max(0, baseSec + deltaSeconds);
    const hh = String(Math.floor(next / 3600) % 24).padStart(2, '0');
    const mm = String(Math.floor((next % 3600) / 60)).padStart(2, '0');
    const ss = String(next % 60).padStart(2, '0');
    return `2026-06-01T${hh}:${mm}:${ss}Z`;
  };

  const buildBsFrameLine = (
    isoTime: string,
    units: Array<{
      unitId: string;
      unitName: string;
      side: string;
      unitClass: string;
      damageState: string;
      lastPos: { lon: number; lat: number } | null;
    }>,
  ): string =>
    JSON.stringify({
      scenarioTime: isoTime,
      frame: {
        Scenario: {
          Time: isoTime,
          IsFinished: false,
          Sides: [
            { Name: '红方', Contacts: [] },
            { Name: '蓝方', Contacts: [] },
          ],
          ActiveUnits: units.map((u) => ({
            ObjectID: u.unitId,
            Name: u.unitName,
            Side: u.side,
            UnitClass: u.unitClass,
            Longitude: u.lastPos?.lon ?? 121.6,
            Latitude: u.lastPos?.lat ?? 24.4,
            DamageState: u.damageState,
          })),
          NonActiveUnits: [],
        },
      },
    });

  const injectLossAlertFrame = async () => {
    setMsg(null);
    try {
      let current = snapshot;
      if (!current) {
        const created = await evalApi.createRealtimeSession({
          runId,
          source: 'builtin_bs',
          systemId,
          speedMultiplier: speed,
        });
        current = created.snapshot;
      }

      // 若仍在初始第 0 帧，先自动步进 2 帧以建立完整红蓝在网舰机基线
      if (current.cursor === 0 || current.units.length === 0) {
        for (let i = 0; i < 2; i += 1) {
          const stepRes = await evalApi.controlRealtimeSession(runId, { action: 'step' });
          if (stepRes.snapshot) current = stepRes.snapshot;
        }
      }

      const nextIdx = simMinOffset;
      setSimMinOffset((m) => m + 1);

      let workingUnits = current.units.slice();
      let victim = workingUnits.find((u) => u.damageState !== 'destroyed');

      // 若全部内置单位已损毁，先推入一艘健康护航艇再触发战损跳变
      if (!victim) {
        const escort: RealtimeSnapshot['units'][number] = {
          unitId: `u-swarm-escort-${nextIdx}`,
          unitName: `前哨无人艇 #${nextIdx}`,
          side: '红方',
          unitClass: 'USV',
          damageState: 'ok',
          ammoRemaining: 4,
          lastPos: { lon: 121.55 + nextIdx * 0.02, lat: 24.35 },
        };
        workingUnits = [...workingUnits, escort];
        const prepIso = stepClockIso(current.scenarioClock, 5);
        const prepRes = await evalApi.controlRealtimeSession(runId, {
          action: 'push_frame',
          frameLine: buildBsFrameLine(prepIso, workingUnits),
        });
        if (prepRes.snapshot) current = prepRes.snapshot;
        victim = escort;
      }

      // 间隔 +35 秒跳变单元战损状态，验证 Q-109 告警触发与 300s 冷却防骚扰抑止
      const victimId = victim.unitId;
      const isoTime = stepClockIso(current.scenarioClock, 35);
      const nextUnits = workingUnits.map((u) =>
        u.unitId === victimId ? { ...u, damageState: 'destroyed' } : u,
      );
      const res = await evalApi.controlRealtimeSession(runId, {
        action: 'push_frame',
        frameLine: buildBsFrameLine(isoTime, nextUnits),
      });
      if (res.snapshot) setSnapshot(res.snapshot);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCardHitl = async (
    cardId: string,
    action: 'observe' | 'pause_inspect' | 'ignore_expected',
  ) => {
    try {
      const res = await evalApi.actOnRealtimeCard(runId, cardId, action);
      setSnapshot(res.snapshot);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-3.5">
      {/* 在线会话与回放推流控制条 */}
      <section className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <label htmlFor="rt-runid" className="mb-1 block text-xs text-[#8b949e]">
              在线会话 ID
            </label>
            <input
              id="rt-runid"
              value={runId}
              onChange={(e) => setRunId(e.target.value)}
              className="w-full rounded-md border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 font-mono text-xs text-slate-100"
            />
          </div>

          <div className="min-w-0 flex-1 basis-52">
            <label htmlFor="rt-sys" className="mb-1 block text-xs text-[#8b949e]">
              监测告警体系
            </label>
            <select
              id="rt-sys"
              value={systemId}
              onChange={(e) => setSystemId(e.target.value)}
              className="w-full rounded-md border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-xs text-slate-100"
            >
              {systems.map((s) => (
                <option key={s.systemId} value={s.systemId}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-0 flex-1 basis-52">
            <label htmlFor="rt-source" className="mb-1 block text-xs text-[#8b949e]">
              实时帧数据源 (JSONL)
            </label>
            <div className="flex items-center gap-1.5">
              <select
                id="rt-source"
                value={sourceChoice}
                onChange={(e) => setSourceChoice(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-[#30363d] bg-[#0f141a] px-2 py-1.5 text-xs text-slate-100"
              >
                <option value="builtin_bs">内置示例帧 (bs-frames-sample.jsonl)</option>
                {jsonlSources.map((ds) => (
                  <option key={ds.id} value={`ds:${ds.id}`}>
                    [已注册] {ds.label}
                  </option>
                ))}
                {uploadedLines.length > 0 && (
                  <option value="uploaded">
                    [本地上传] {uploadedFileName} ({uploadedLines.length} 帧)
                  </option>
                )}
              </select>
              <button
                type="button"
                onClick={() => jsonlInputRef.current?.click()}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#30363d] bg-[#0f141a] px-2 py-1.5 text-xs text-slate-200 hover:border-slate-500"
                title="上传本地 JSONL 状态帧文件用于实时回放"
              >
                <Upload className="h-3.5 w-3.5" />
                上传
              </button>
              <input
                ref={jsonlInputRef}
                type="file"
                accept=".jsonl,.json,.txt"
                onChange={handleUploadJsonlFile}
                className="hidden"
              />
            </div>
          </div>

          <div className="w-24">
            <label htmlFor="rt-speed" className="mb-1 block text-xs text-[#8b949e]">
              推流倍率
            </label>
            <select
              id="rt-speed"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="w-full rounded-md border border-[#30363d] bg-[#0f141a] px-2 py-1.5 text-xs text-slate-100"
            >
              <option value={1}>1× 常规</option>
              <option value={2}>2× 快速</option>
              <option value={5}>5× 加速</option>
              <option value={10}>10× 极速</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={initSession}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
            >
              <Radio className="h-3.5 w-3.5" />
              创建/重置实时流
            </button>
            <button
              type="button"
              disabled={!snapshot || snapshot.status === 'playing'}
              onClick={() => control('play')}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
            >
              <Play className="h-3.5 w-3.5" />
              播放
            </button>
            <button
              type="button"
              disabled={!snapshot || snapshot.status !== 'playing'}
              onClick={() => control('pause')}
              className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-40"
            >
              <Pause className="h-3.5 w-3.5" />
              暂停
            </button>
            <button
              type="button"
              disabled={!snapshot || snapshot.status === 'playing'}
              onClick={() => control('step')}
              className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-40"
            >
              <StepForward className="h-3.5 w-3.5" />
              步进 1 帧
            </button>
            <button
              type="button"
              disabled={!snapshot}
              onClick={injectLossAlertFrame}
              className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"
            >
              <Flame className="h-3.5 w-3.5" />
              注入战损异常帧
            </button>
            {snapshot && (
              <>
                <button
                  type="button"
                  onClick={() => handleExportAudit('md')}
                  className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-xs text-slate-200 hover:border-slate-500"
                  title="导出实时告警与人工处置审计日志 (Markdown)"
                >
                  <Download className="h-3.5 w-3.5" />
                  审计 (.md)
                </button>
                <button
                  type="button"
                  onClick={() => handleExportAudit('json')}
                  className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0f141a] px-2 py-1.5 text-xs text-slate-300 hover:border-slate-500"
                  title="导出实时告警与人工处置审计日志 (JSON)"
                >
                  .json
                </button>
              </>
            )}
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-[#262d38] pt-2 text-xs text-[#8b949e]">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                sseConnected ? 'live-dot bg-emerald-400' : 'bg-amber-400'
              }`}
            />
            <span>实时推送通道：{sseConnected ? '已连接 (/api/realtime/stream)' : '待连接'}</span>
          </div>
          {msg && <span className="text-blue-300">{msg}</span>}
        </div>
      </section>

      {/* 在线实时遥测 KPI Strip */}
      {snapshot && Array.isArray(snapshot.cards) && Array.isArray(snapshot.units) && (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3">
              <span className="text-xs text-[#8b949e]">流状态 / 帧序号</span>
              <p className="tabular-nums mt-1 text-base font-semibold text-slate-100">
                {snapshot.status} · {snapshot.cursor}/{snapshot.totalFrames}
              </p>
            </div>
            <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3">
              <span className="text-xs text-[#8b949e]">当前推演时钟</span>
              <p className="tabular-nums mt-1 font-mono text-base font-semibold text-blue-300">
                {snapshot.scenarioClock}
              </p>
            </div>
            <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3">
              <span className="text-xs text-[#8b949e]">在网单元 / 损毁</span>
              <p className="tabular-nums mt-1 text-base font-semibold text-emerald-300">
                {snapshot.unitCount} / <span className="text-rose-400">{snapshot.destroyedUnits}</span>
              </p>
            </div>
            <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3">
              <span className="text-xs text-[#8b949e]">当前告警</span>
              <p className="tabular-nums mt-1 text-base font-semibold text-amber-300">
                {snapshot.cards?.length ?? 0} 条
              </p>
            </div>
            <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3">
              <span className="text-xs text-[#8b949e]">5 分钟冷却已抑制</span>
              <p
                data-testid="rt-suppressed-count"
                className="tabular-nums mt-1 flex items-center gap-1.5 text-base font-semibold text-slate-200"
              >
                <BellOff className="h-4 w-4 text-blue-400" />
                {snapshot.suppressedCount} 次
              </p>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
            {/* 左侧：在线单元状态 & 增量事件 */}
            <section className="min-w-0 space-y-3.5 lg:col-span-5 panel-isolate">
              <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5">
                <h3 className="mb-2 text-sm font-semibold text-slate-100">实时单元健康态</h3>
                <div className="space-y-1.5 text-xs">
                  {snapshot.units.map((u) => (
                    <div
                      key={u.unitId}
                      className="flex items-center justify-between rounded-md border border-[#262d38] bg-[#0f141a] px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-slate-100">{u.unitName}</span>
                        <span className="ml-2 text-[11px] text-[#8b949e]">
                          {u.side} · {u.unitClass}
                        </span>
                      </div>
                      <span
                        className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${
                          u.damageState === 'destroyed'
                            ? 'bg-rose-500/15 text-rose-300'
                            : 'bg-emerald-500/15 text-emerald-300'
                        }`}
                      >
                        {u.damageState} · 余弹 {u.ammoRemaining}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5">
                <h3 className="mb-2 text-sm font-semibold text-slate-100">最新增量事件</h3>
                {(!snapshot.recentEvents || snapshot.recentEvents.length === 0) ? (
                  <div className="rounded-md border border-dashed border-[#30363d] bg-[#0f141a] p-4 text-center text-xs text-[#8b949e]">
                    当前帧尚无新增事件。点击「播放」或「步进」推进推演流。
                  </div>
                ) : (
                  <div className="max-h-64 space-y-1.5 overflow-y-auto text-xs">
                    {(snapshot.recentEvents || [])
                      .slice()
                      .reverse()
                      .map((e, i) => (
                        <div
                          key={e.eventId}
                          className={`rounded border border-[#262d38] bg-[#0f141a] px-2.5 py-1.5 ${
                            i === 0 ? 'event-fresh' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="tabular-nums font-mono text-[11px] text-blue-300">
                              {e.clockText} · {e.kind === "unit_destroyed" ? "单元损毁" : e.kind}
                            </span>
                            <span className="text-[10px] text-[#8b949e]">{e.ref}</span>
                          </div>
                          <p className="mt-0.5 text-slate-200">
                            {e.side ? `[${e.side}] ` : ''}
                            {e.subject ?? ''}
                            {e.object ? ` -> ${e.object}` : ''}
                          </p>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </section>

            {/* 右侧：在线告警与人工处置 */}
            <section className="min-w-0 rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5 lg:col-span-7 panel-isolate">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-100">
                <ShieldAlert className="h-4 w-4 text-amber-400" />
                在线告警与人工处置
              </h3>

              {(!snapshot.cards || snapshot.cards.length === 0) ? (
                <div className="rounded-md border border-dashed border-[#30363d] bg-[#0f141a] p-6 text-center text-xs text-[#8b949e]">
                  暂无告警。点击「播放」推进数据流，或点击「注入战损异常帧」触发一次告警测试。
                </div>
              ) : (
                <div className="space-y-2.5">
                  {(snapshot.cards || []).map((card) => {
                    const resolved = card.hitlAction !== 'pending';
                    return (
                      <article
                        key={card.cardId}
                        className={`rounded-md border p-3.5 transition ${
                          card.severity === 'major'
                            ? 'border-rose-500/40 bg-[#0f141a]'
                            : 'border-amber-500/35 bg-[#0f141a]'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                                  card.severity === 'major'
                                    ? 'bg-rose-500/20 text-rose-300'
                                    : 'bg-amber-500/20 text-amber-300'
                                }`}
                              >
                                {card.severity}
                              </span>
                              <span className="tabular-nums font-mono text-xs text-blue-300">
                                {card.scenarioClock}
                              </span>
                              <span className="font-mono text-[11px] text-[#8b949e]">
                                {card.triggerAtomId}
                              </span>
                            </div>
                            <h4 className="mt-1.5 text-sm font-semibold text-slate-100">{card.title}</h4>
                          </div>

                          <span
                            className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                              resolved
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : 'bg-[#1c2128] text-amber-300'
                            }`}
                          >
                            {resolved ? `已人工处置：${card.hitlAction}` : '待人工裁决'}
                          </span>
                        </div>

                        <div className="mt-2 space-y-1 text-xs leading-relaxed text-slate-200">
                          <p>
                            <strong className="text-[#8b949e]">态势概要：</strong>
                            {card.situationSummary}
                          </p>
                          <p>
                            <strong className="text-[#8b949e]">风险判读：</strong>
                            {card.riskAssessment}
                          </p>
                          <p>
                            <strong className="text-blue-300">应对建议：</strong>
                            {card.suggestion}
                          </p>
                        </div>

                        <div className="mt-2.5 flex flex-wrap gap-2 border-t border-[#262d38] pt-2.5">
                          <button
                            type="button"
                            onClick={() => handleCardHitl(card.cardId, 'observe')}
                            className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#161b22] px-2.5 py-1 text-xs text-blue-300 hover:border-blue-500"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            继续观察
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCardHitl(card.cardId, 'pause_inspect')}
                            className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#161b22] px-2.5 py-1 text-xs text-amber-300 hover:border-amber-500"
                          >
                            <Pause className="h-3.5 w-3.5" />
                            暂停推演检查
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCardHitl(card.cardId, 'ignore_expected')}
                            className="inline-flex items-center gap-1 rounded border border-[#30363d] bg-[#161b22] px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            忽略并标记预期损耗
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </>
      )}
      {!snapshot && (
        <section className="rounded-lg border border-dashed border-[#30363d] bg-[#161b22] p-10 text-center text-xs text-[#8b949e]">
          <Activity className="mx-auto h-8 w-8 text-blue-400/60 mb-3" />
          <p className="text-sm font-medium text-slate-300">尚未初始化推演数据流</p>
          <p className="mt-1 text-[#8b949e]">
            请在上方选择推演场次与评估体系，点击「创建/重置实时流」开启实时研判与伴随评估。
          </p>
        </section>
      )}
    </div>
  );
}
