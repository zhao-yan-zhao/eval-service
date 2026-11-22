import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Eye,
  Folder,
  HardDrive,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  evalApi,
  type DataSourceProbeResult,
  type DataSourceStatus,
  type StoredRunSummary,
} from '../api.ts';

interface TestDataConfigModalProps {
  open: boolean;
  onClose: () => void;
  runs: StoredRunSummary[];
  selectedRunId: string;
  activeSourceId: string;
  onActivated: (runId: string, activeSourceId: string) => Promise<void>;
  onNavigateToExplorer?: () => void;
}

export function TestDataConfigModal({
  open,
  onClose,
  runs,
  selectedRunId,
  activeSourceId,
  onActivated,
  onNavigateToExplorer,
}: TestDataConfigModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [dataSources, setDataSources] = useState<DataSourceStatus[]>([]);
  const [serverActiveSourceId, setServerActiveSourceId] = useState(activeSourceId);
  const [loading, setLoading] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // 新增探测表单
  const [newPath, setNewPath] = useState('');
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<'csv_dir' | 'jsonl_file'>('csv_dir');
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<DataSourceProbeResult | null>(null);

  const loadSources = async () => {
    setLoading(true);
    try {
      const res = await evalApi.listDataSources();
      setDataSources(res.dataSources);
      setServerActiveSourceId(res.activeSourceId);
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open) {
      if (!dlg.open) dlg.showModal();
      setMsg(null);
      void loadSources();
    } else if (dlg.open) {
      dlg.close();
    }
  }, [open]);

  const handleActivate = async (sourceId: string) => {
    setActivatingId(sourceId);
    setMsg(null);
    try {
      const res = await evalApi.setActiveDataSource(sourceId);
      setDataSources(res.dataSources);
      setServerActiveSourceId(res.activeSourceId);
      await onActivated(res.runId, res.activeSourceId);
      setMsg({ kind: 'ok', text: `已将默认测试数据切换为 [${sourceId}] (Run: ${res.runId})` });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setActivatingId(null);
    }
  };

  const handleProbe = async () => {
    const target = newPath.trim();
    if (!target) return;
    setProbing(true);
    setProbe(null);
    try {
      const res = await evalApi.probeDataSource(target);
      setProbe(res.probe);
      if (res.probe.accessible) {
        if (res.probe.kind) setNewKind(res.probe.kind);
        if (!newName.trim() && res.probe.scenarioName) {
          setNewName(res.probe.scenarioName);
        }
      }
    } catch (e) {
      setProbe({
        accessible: false,
        path: target,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setProbing(false);
    }
  };

  const handleAddAndActivate = async (e: FormEvent) => {
    e.preventDefault();
    const cleanPath = newPath.trim();
    if (!cleanPath) return;
    const id = `ds_${Date.now().toString(36)}`;
    const name = newName.trim() || probe?.scenarioName || cleanPath;
    setActivatingId(id);
    setMsg(null);
    try {
      const saved = await evalApi.upsertDataSource({
        id,
        name,
        kind: newKind,
        path: cleanPath,
        enabled: true,
      });
      const actualId = saved?.dataSource?.id ?? id;
      const res = await evalApi.setActiveDataSource(actualId);
      setDataSources(res.dataSources);
      setServerActiveSourceId(res.activeSourceId);
      await onActivated(res.runId, res.activeSourceId);
      setNewPath('');
      setNewName('');
      setProbe(null);
      setMsg({ kind: 'ok', text: `已注册并设为当前测试数据「${name}」` });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setActivatingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await evalApi.deleteDataSource(id);
      await loadSources();
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const currentRun = runs.find((r) => r.runId === selectedRunId);
  const effectiveActiveSourceId = serverActiveSourceId || activeSourceId;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="w-full max-w-3xl rounded-xl border border-[#30363d] bg-[#161b22] p-5 text-[#e6edf3] shadow-2xl backdrop:bg-black/70"
    >
      {/* 顶部标题 */}
      <div className="flex items-start justify-between gap-3 border-b border-[#2a313c] pb-3.5">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-slate-100">
            <HardDrive className="h-4.5 w-4.5 text-purple-400" />
            测试数据源配置中心
          </h3>
          <p className="mt-1 text-xs text-[#8b949e]">
            配置并切换全局默认测试数据集。算子试跑、流水线 Dry-Run、指标调试与体系评估将默认采用此处选定的数据。
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-[#8b949e] hover:bg-[#1c2128] hover:text-white"
          aria-label="关闭测试数据配置弹窗"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 space-y-4">
        {/* 当前生效的测试数据摘要 */}
        <div className="rounded-lg border border-blue-500/30 bg-blue-950/20 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="rounded bg-blue-500/20 px-2 py-0.5 font-medium text-blue-300">
                当前测试数据集
              </span>
              <span className="font-semibold text-slate-100">
                {currentRun ? currentRun.scenarioName : selectedRunId || '未选择'}
              </span>
              {currentRun && (
                <span className="font-mono text-[11px] text-[#8b949e]">({currentRun.runId})</span>
              )}
            </div>
            {currentRun && (
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-300 tabular-nums">
                <span>单元: {currentRun.unitCount}</span>
                <span>事件: {currentRun.eventCount}</span>
                <span>阵营: {currentRun.sides.join(' / ')}</span>
                <span>
                  时段: {currentRun.startClock} ~ {currentRun.endClock}
                </span>
              </div>
            )}
          </div>
        </div>

        {msg && (
          <div
            className={`rounded-md border p-2.5 text-xs ${
              msg.kind === 'ok'
                ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
                : 'border-rose-500/40 bg-rose-950/30 text-rose-200'
            }`}
          >
            {msg.text}
          </div>
        )}

        {/* 已配置数据源列表 */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300">
              <Database className="h-3.5 w-3.5 text-blue-400" />
              可选测试数据源 ({dataSources.length})
            </h4>
            <button
              type="button"
              onClick={loadSources}
              disabled={loading}
              className="inline-flex items-center gap-1 text-[11px] text-[#8b949e] hover:text-slate-200"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
              刷新检测
            </button>
          </div>

          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {loading && dataSources.length === 0 ? (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-[#2a313c] bg-[#0f141a] py-6 text-xs text-[#8b949e]">
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-400" />
                正在探测本地与外部仿真数据源…
              </div>
            ) : null}
            {dataSources.map((ds) => {
              const isActive =
                ds.source.id === effectiveActiveSourceId ||
                (ds.importedRunId !== undefined && ds.importedRunId === selectedRunId);
              const isBusy = activatingId === ds.source.id;
              return (
                <div
                  key={ds.source.id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border p-3 text-xs transition ${
                    isActive
                      ? 'border-emerald-500/50 bg-emerald-950/15'
                      : ds.accessible
                        ? 'border-[#2a313c] bg-[#0f141a] hover:border-slate-500'
                        : 'border-rose-950/60 bg-rose-950/10 opacity-75'
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          ds.accessible ? 'bg-emerald-400' : 'bg-rose-500'
                        }`}
                        title={ds.accessible ? '路径可访问' : '路径不可访问'}
                      />
                      <span className="font-medium text-slate-100">{ds.source.name}</span>
                      <span className="rounded border border-[#30363d] bg-[#161b22] px-1.5 py-0.5 text-[10px] text-blue-300">
                        {ds.source.kind === "csv_dir" ? "CSV 目录" : ds.source.kind === "jsonl_file" ? "JSONL 状态帧" : ds.source.kind}
                      </span>
                      {ds.scenarioName && ds.scenarioName !== ds.source.name && (
                        <span className="rounded border border-emerald-800/40 bg-emerald-950/50 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                          {ds.scenarioName}
                        </span>
                      )}
                      {isActive && (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" />
                          当前测试数据
                        </span>
                      )}
                    </div>
                    <div className="truncate font-mono text-[11px] text-[#8b949e]" title={ds.source.path}>
                      {ds.source.path}
                    </div>
                    {ds.fileCount !== undefined && (
                      <div className="text-[10px] text-slate-400">
                        {ds.fileCount} 个文件 · 共 {((ds.totalSizeBytes ?? 0) / (1024 * 1024)).toFixed(2)} MB
                      </div>
                    )}
                    {!ds.accessible && ds.error && (
                      <div className="text-[10px] text-rose-400">{ds.error}</div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      disabled={!ds.accessible || isBusy}
                      onClick={() => handleActivate(ds.source.id)}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
                        isActive
                          ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/40'
                          : 'border-[#30363d] bg-[#1c2128] text-white hover:border-blue-500 hover:text-blue-200'
                      }`}
                    >
                      {isBusy ? (
                        <>
                          <RefreshCw className="h-3 w-3 animate-spin text-blue-400" />
                          载入中…
                        </>
                      ) : isActive ? (
                        <>
                          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                          已启用
                        </>
                      ) : (
                        <>
                          <Play className="h-3 w-3 text-emerald-400" />
                          设为测试数据
                        </>
                      )}
                    </button>

                    {!ds.source.isBuiltin && (
                      <button
                        type="button"
                        onClick={() => handleDelete(ds.source.id)}
                        className="rounded border border-[#30363d] bg-[#0f141a] p-1.5 text-rose-400 hover:border-rose-500"
                        title="移除自定义数据源"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 快速注册新测试目录 */}
        <form
          onSubmit={handleAddAndActivate}
          className="rounded-lg border border-[#2a313c] bg-[#0f141a] p-3.5 space-y-2.5"
        >
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
            <Plus className="h-3.5 w-3.5 text-blue-400" />
            添加本地新测试数据目录 / JSONL 文件
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Folder className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[#8b949e]" />
              <input
                required
                value={newPath}
                onChange={(e) => {
                  setNewPath(e.target.value);
                  if (probe) setProbe(null);
                }}
                placeholder="输入 EventExport_CSV 目录或 .jsonl 绝对路径…"
                className="w-full rounded-md border border-[#30363d] bg-[#161b22] py-1.5 pl-8 pr-3 font-mono text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <button
              type="button"
              disabled={probing || !newPath.trim()}
              onClick={handleProbe}
              className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#1c2128] px-3 py-1.5 text-xs text-slate-200 hover:border-blue-500 disabled:opacity-40"
            >
              <Eye className="h-3.5 w-3.5 text-blue-400" />
              {probing ? '探测中…' : '探测'}
            </button>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="别名（可选）"
              className="w-44 rounded-md border border-[#30363d] bg-[#161b22] px-2.5 py-1.5 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={Boolean(activatingId) || !newPath.trim()}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:border-emerald-400 disabled:opacity-40"
            >
              保存并设为测试数据
            </button>
          </div>

          {probe && (
            <div
              className={`flex items-center gap-2 rounded border p-2 text-xs ${
                probe.accessible
                  ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-200'
                  : 'border-rose-500/40 bg-rose-950/20 text-rose-200'
              }`}
            >
              {probe.accessible ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <span>
                    探测成功 · {probe.kind} · {probe.scenarioName ?? '未知想定'} · {probe.fileCount ?? 0} 个文件 (
                    {((probe.totalSizeBytes ?? 0) / (1024 * 1024)).toFixed(2)} MB)
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                  <span>{probe.error || '路径不可访问'}</span>
                </>
              )}
            </div>
          )}
        </form>

        {/* 底部栏 */}
        <div className="flex items-center justify-between border-t border-[#2a313c] pt-3 text-xs">
          {onNavigateToExplorer ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onNavigateToExplorer();
              }}
              className="text-purple-400 hover:text-purple-300"
            >
              前往「推演数据」查看源文件剖析与航迹明细 &rarr;
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#30363d] bg-[#0f141a] px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
          >
            关闭
          </button>
        </div>
      </div>
    </dialog>
  );
}
