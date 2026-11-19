import {
  Activity,
  BookOpen,
  Cpu,
  Database,
  Gauge,
  GitBranch,
  Layers,
  SlidersHorizontal,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  evalApi,
  type F1OutputCatalog,
  type IndicatorDefinition,
  type IndicatorSystem,
  type MetricAtomMeta,
  type StoredRunSummary,
} from './api.ts';
import { CockpitView } from './components/CockpitView.tsx';
import { DataExplorerView } from './components/DataExplorerView.tsx';
import { IndicatorStudioView } from './components/IndicatorStudioView.tsx';
import { OperatorLibraryView } from './components/OperatorLibraryView.tsx';
import { RealtimeMonitorView } from './components/RealtimeMonitorView.tsx';
import { SimulationCatalogPanel } from './components/SimulationCatalogPanel.tsx';
import { SystemDesignerView } from './components/SystemDesignerView.tsx';
import { TestDataConfigModal } from './components/TestDataConfigModal.tsx';

type TabKey =
  | 'cockpit'
  | 'operators'
  | 'indicators'
  | 'systems'
  | 'catalog'
  | 'data'
  | 'realtime';

const TABS: Array<{ key: TabKey; label: string; short: string; icon: typeof Gauge }> = [
  { key: 'cockpit', label: '评估总览', short: '总览', icon: Gauge },
  { key: 'operators', label: '算子库', short: '算子', icon: Cpu },
  { key: 'indicators', label: '指标配置', short: '指标', icon: Layers },
  { key: 'systems', label: '评估体系', short: '体系', icon: GitBranch },
  { key: 'catalog', label: '输出字段规范', short: '规范', icon: BookOpen },
  { key: 'data', label: '推演数据', short: '数据', icon: Database },
  { key: 'realtime', label: '实时研判', short: '实时', icon: Activity },
];

export function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('cockpit');
  const [operators, setOperators] = useState<MetricAtomMeta[]>([]);
  const [indicators, setIndicators] = useState<IndicatorDefinition[]>([]);
  const [systems, setSystems] = useState<IndicatorSystem[]>([]);
  const [runs, setRuns] = useState<StoredRunSummary[]>([]);
  const [catalog, setCatalog] = useState<F1OutputCatalog | null>(null);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedSystemId, setSelectedSystemId] = useState('');
  const [activeSourceId, setActiveSourceId] = useState('');
  const [testConfigOpen, setTestConfigOpen] = useState(false);
  const [focusedOperatorTarget, setFocusedOperatorTarget] = useState<{ id: string; nonce: number } | null>(null);
  const [focusedIndicatorTarget, setFocusedIndicatorTarget] = useState<{ id: string; nonce: number } | null>(null);
  const [loadingInit, setLoadingInit] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [opRes, indRes, sysRes, runRes, catRes, dsRes] = await Promise.all([
        evalApi.listOperators(),
        evalApi.listIndicators(),
        evalApi.listSystems(),
        evalApi.listRuns(),
        evalApi.getFieldsCatalog(),
        evalApi.listDataSources().catch(() => null),
      ]);
      setOperators(opRes.operators);
      setIndicators(indRes.indicators);
      setSystems(sysRes.systems);
      setRuns(runRes.runs);
      setCatalog(catRes.catalog);
      if (dsRes) {
        setActiveSourceId(dsRes.activeSourceId);
      }
      setSelectedRunId((prev) => {
        if (prev && runRes.runs.some((r) => r.runId === prev)) return prev;
        if (dsRes?.activeRunId && runRes.runs.some((r) => r.runId === dsRes.activeRunId)) {
          return dsRes.activeRunId;
        }
        return runRes.runs[0]?.runId ?? '';
      });
      setSelectedSystemId((prev) =>
        prev && sysRes.systems.some((s) => s.systemId === prev)
          ? prev
          : (sysRes.systems.find((s) => s.systemId === 'sys_bvr_air_combat_v1')?.systemId ??
            sysRes.systems[0]?.systemId ??
            ''),
      );
      setInitError(null);
    } catch (e) {
      setInitError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingInit(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [activeTab]);

  return (
    <div className="min-h-dvh bg-[#0d1117] text-[#e6edf3]">
      {/* 顶部栏与导航 */}
      <header className="sticky top-0 z-30 border-b border-[#2a313c] bg-[#161b22]">
        <div className="mx-auto max-w-[1440px] px-4 pt-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="h-4 w-1 shrink-0 rounded-xs bg-blue-500" aria-hidden="true" />
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold tracking-tight text-slate-100 sm:text-base">
                  F1 仿真推演评估工具
                </h1>
                <p className="truncate text-[11px] text-[#8b949e]">
                  算子 {operators.length} · 指标 {indicators.length} · 体系 {systems.length} · 样本 {runs.length} 局
                </p>
              </div>
            </div>

            <div className="tabular-nums flex items-center gap-2 text-xs text-[#8b949e]">
              <button
                type="button"
                id="btn-global-test-data-config"
                onClick={() => setTestConfigOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#0f141a] px-2.5 py-1 text-xs text-slate-200 transition hover:border-purple-500/70 hover:text-white"
                title="配置当前用于算子测试、指标验证与体系评估的默认数据"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-purple-400" />
                <span className="text-[#8b949e]">测试数据:</span>
                <span className="max-w-[160px] sm:max-w-[260px] lg:max-w-[340px] truncate font-medium text-blue-300" title={runs.find((r) => r.runId === selectedRunId)?.scenarioName ?? selectedRunId ?? "未配置"}>
                  {runs.find((r) => r.runId === selectedRunId)?.scenarioName ??
                    (selectedRunId || '未配置')}
                </span>
              </button>
              <span className="hidden sm:inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                服务就绪 · {runs.length} 局样本
              </span>
            </div>
          </div>

          <nav
            role="tablist"
            aria-label="评估中台主导航"
            className="no-scrollbar mt-2 flex items-center gap-1 overflow-x-auto pb-0.5"
          >
            {TABS.map((t, idx) => {
              const Icon = t.icon;
              const selected = activeTab === t.key;
              const showDivider = idx === 1 || idx === 4 || idx === 6;
              return (
                <div key={t.key} className="flex items-center">
                  {showDivider && (
                    <span
                      className="mx-0.5 sm:mx-1 h-3.5 w-px shrink-0 bg-[#2a313c]"
                      aria-hidden="true"
                    />
                  )}
                  <button
                    id={`tab-${t.key}`}
                    role="tab"
                    type="button"
                    aria-selected={selected}
                    aria-controls={`panel-${t.key}`}
                    onClick={() => setActiveTab(t.key)}
                    className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-xs font-medium transition sm:px-3 sm:text-[13px] ${
                      selected
                        ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                        : 'border-transparent text-[#8b949e] hover:border-[#30363d] hover:text-slate-200'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="hidden sm:inline">{t.label}</span>
                    <span className="sm:hidden">{t.short}</span>
                  </button>
                </div>
              );
            })}
          </nav>
        </div>
      </header>

      {/* 主内容视窗 */}
      <main className="mx-auto max-w-[1440px] px-4 py-4">
        {initError && (
          <div className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
            连接评估后端失败：{initError}（请确认已启动 `npm start` 或检查 `/api/health`）
          </div>
        )}

        {loadingInit ? (
          <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-8 text-center text-sm text-[#8b949e]">
            正在加载评估配置与推演数据…
          </div>
        ) : (
          <>
            <section
              id="panel-cockpit"
              role="tabpanel"
              aria-labelledby="tab-cockpit"
              hidden={activeTab !== 'cockpit'}
            >
              <CockpitView
                runs={runs}
                systems={systems}
                selectedRunId={selectedRunId}
                selectedSystemId={selectedSystemId}
                onSelectRun={setSelectedRunId}
                onSelectSystem={setSelectedSystemId}
              />
            </section>

            <section
              id="panel-operators"
              role="tabpanel"
              aria-labelledby="tab-operators"
              hidden={activeTab !== 'operators'}
            >
              <OperatorLibraryView
                operators={operators}
                indicators={indicators}
                systems={systems}
                runs={runs}
                selectedRunId={selectedRunId}
                catalog={catalog}
                focusedOperatorTarget={focusedOperatorTarget}
                onRefresh={loadAll}
              />
            </section>

            <section
              id="panel-indicators"
              role="tabpanel"
              aria-labelledby="tab-indicators"
              hidden={activeTab !== 'indicators'}
            >
              <IndicatorStudioView
                indicators={indicators}
                operators={operators}
                runs={runs}
                selectedRunId={selectedRunId}
                focusedIndicatorTarget={focusedIndicatorTarget}
                onRefresh={loadAll}
              />
            </section>

            <section
              id="panel-systems"
              role="tabpanel"
              aria-labelledby="tab-systems"
              hidden={activeTab !== 'systems'}
            >
              <SystemDesignerView
                systems={systems}
                indicators={indicators}
                operators={operators}
                runs={runs}
                selectedRunId={selectedRunId}
                selectedSystemId={selectedSystemId}
                onSelectSystem={setSelectedSystemId}
                onRefresh={loadAll}
                onNavigateToTab={(tab, targetId) => {
                  setActiveTab(tab);
                  if (tab === 'operators' && targetId) {
                    setFocusedOperatorTarget({ id: targetId, nonce: Date.now() });
                  } else if (tab === 'indicators' && targetId) {
                    setFocusedIndicatorTarget({ id: targetId, nonce: Date.now() });
                  }
                }}
              />
            </section>

            <section
              id="panel-catalog"
              role="tabpanel"
              aria-labelledby="tab-catalog"
              hidden={activeTab !== 'catalog'}
            >
              <SimulationCatalogPanel catalog={catalog} operators={operators} />
            </section>

            <section
              id="panel-data"
              role="tabpanel"
              aria-labelledby="tab-data"
              hidden={activeTab !== 'data'}
            >
              <DataExplorerView
                runs={runs}
                catalog={catalog}
                selectedRunId={selectedRunId}
                onSelectRun={setSelectedRunId}
                onRefresh={loadAll}
              />
            </section>

            <section
              id="panel-realtime"
              role="tabpanel"
              aria-labelledby="tab-realtime"
              hidden={activeTab !== 'realtime'}
            >
              <RealtimeMonitorView systems={systems} />
            </section>
          </>
        )}
      </main>

      <TestDataConfigModal
        open={testConfigOpen}
        onClose={() => setTestConfigOpen(false)}
        runs={runs}
        selectedRunId={selectedRunId}
        activeSourceId={activeSourceId}
        onActivated={async (runId, nextSourceId) => {
          setActiveSourceId(nextSourceId);
          setSelectedRunId(runId);
          await loadAll();
        }}
        onNavigateToExplorer={() => setActiveTab('data')}
      />
    </div>
  );
}
export default App;
