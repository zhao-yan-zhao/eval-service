import {
  Activity,
  BookOpen,
  Cpu,
  Database,
  Gauge,
  GitBranch,
  Layers,
  Settings,
  SlidersHorizontal,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  evalApi,
  type EffectDefinition,
  type EvaluationSystemDag,
  type F1OutputCatalog,
  type MetricGraphDefinition,
  type StoredRunSummary,
  type V4OperatorItem,
} from './api.ts';
import { CockpitView } from './components/CockpitView.tsx';
import { DataExplorerView } from './components/DataExplorerView.tsx';
import { OperatorLibraryView } from './components/OperatorLibraryView.tsx';
import { RealtimeMonitorView } from './components/RealtimeMonitorView.tsx';
import { SimulationCatalogPanel } from './components/SimulationCatalogPanel.tsx';
import { MetricDagStudioPanel, SystemDagStudioPanel } from './components/v4/index.ts';
import { GlobalSettingsModal, type SettingsTabKey } from './components/GlobalSettingsModal.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

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
  { key: 'indicators', label: '指标库', short: '指标', icon: Layers },
  { key: 'systems', label: '评估体系', short: '体系', icon: GitBranch },
  { key: 'catalog', label: '字段规范', short: '规范', icon: BookOpen },
  { key: 'data', label: '推演数据', short: '数据', icon: Database },
  { key: 'realtime', label: '实时研判', short: '实时', icon: Activity },
];

export function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('cockpit');
  const [visitedTabs, setVisitedTabs] = useState<Set<TabKey>>(() => new Set(['cockpit']));
  const [operators, setOperators] = useState<V4OperatorItem[]>([]);
  const [effects, setEffects] = useState<EffectDefinition[]>([]);
  const [metricGraphs, setMetricGraphs] = useState<MetricGraphDefinition[]>([]);
  const [systems, setSystems] = useState<EvaluationSystemDag[]>([]);
  const [runs, setRuns] = useState<StoredRunSummary[]>([]);
  const [catalog, setCatalog] = useState<F1OutputCatalog | null>(null);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [activeSourceId, setActiveSourceId] = useState('');
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTabKey>('datasources');
  const [focusedOperatorTarget, setFocusedOperatorTarget] = useState<{ id: string; nonce: number } | null>(null);
  const [loadingInit, setLoadingInit] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [opRes, effRes, mgRes, sysRes, runRes, catRes, dsRes] = await Promise.all([
        evalApi.listV4Operators({ layer: 'all' }),
        evalApi.listV4Effects(),
        evalApi.listV4MetricGraphs(),
        evalApi.listV4SystemDags(),
        evalApi.listRuns(),
        evalApi.getFieldsCatalog(),
        evalApi.listDataSources().catch(() => null),
      ]);
      setOperators(opRes.operators ?? []);
      setEffects(effRes.effects ?? []);
      setMetricGraphs(mgRes.graphs ?? []);
      setSystems(sysRes.systems ?? []);
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
    setVisitedTabs((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
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
                <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono mt-0.5">
                  <span>{operators.length} 算子</span>
                  <span className="text-[#30363d]">·</span>
                  <span>{metricGraphs.length} 指标图</span>
                  <span className="text-[#30363d]">·</span>
                  <span>{effects.length} 效果</span>
                  <span className="text-[#30363d]">·</span>
                  <span>{systems.length} 体系</span>
                  <span className="text-[#30363d]">·</span>
                  <span>{runs.length} 局样本</span>
                </div>
              </div>
            </div>

            <div className="tabular-nums flex items-center gap-2 text-xs text-[#8b949e]">
              <button
                type="button"
                id="btn-global-test-data-config"
                onClick={() => {
                  setSettingsInitialTab('datasources');
                  setSettingsModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#0f141a] px-2.5 py-1 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
                title="选择当前用于评估计算的推演样本数据"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-[#8b949e]">推演样本:</span>
                <span className="max-w-[140px] sm:max-w-[220px] lg:max-w-[300px] truncate font-medium text-slate-200" title={runs.find((r) => r.runId === selectedRunId)?.scenarioName ?? selectedRunId ?? "未配置"}>
                  {(runs.find((r) => r.runId === selectedRunId)?.scenarioName ?? (selectedRunId || '未配置')).replace(/\s*\(EventExport_CSV\)/i, '')}
                </span>
              </button>

              <button
                type="button"
                id="btn-global-system-settings"
                onClick={() => {
                  setSettingsInitialTab('datasources');
                  setSettingsModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#161b22] px-2.5 py-1 text-xs text-slate-200 transition hover:border-slate-500 hover:bg-[#1f242c] hover:text-white font-medium"
                title="系统配置与数据源管理"
              >
                <Settings className="h-3.5 w-3.5 text-slate-400" />
                <span>系统配置</span>
              </button>

              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-slate-400 font-mono">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                服务正常
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
              <ErrorBoundary fallbackTitle="评估总览驾驶舱渲染异常">
                <CockpitView
                  runs={runs}
                  selectedRunId={selectedRunId}
                  activeSourceId={activeSourceId}
                  onSelectRun={setSelectedRunId}
                  onOpenV4SystemCanvas={() => setActiveTab('systems')}
                  onNavigateToTab={(tab, targetId) => {
                    setActiveTab(tab);
                    if (tab === 'operators' && targetId) {
                      setFocusedOperatorTarget({ id: targetId, nonce: Date.now() });
                    }
                  }}
                />
              </ErrorBoundary>
            </section>

            {visitedTabs.has('operators') && (
              <section
                id="panel-operators"
                role="tabpanel"
                aria-labelledby="tab-operators"
                hidden={activeTab !== 'operators'}
              >
                <ErrorBoundary fallbackTitle="算子工坊渲染异常">
                  <OperatorLibraryView
                    loading={loadingInit}
                    operators={operators}
                    runs={runs}
                    selectedRunId={selectedRunId}
                    activeSourceId={activeSourceId}
                    onSelectRun={setSelectedRunId}
                    catalog={catalog}
                    focusedOperatorTarget={focusedOperatorTarget}
                    onRefresh={loadAll}
                    onOpenSettings={(tab) => {
                      setSettingsInitialTab((tab as SettingsTabKey) || 'components');
                      setSettingsModalOpen(true);
                    }}
                  />
                </ErrorBoundary>
              </section>
            )}

            {visitedTabs.has('indicators') && (
              <section
                id="panel-indicators"
                role="tabpanel"
                aria-labelledby="tab-indicators"
                hidden={activeTab !== 'indicators'}
              >
                <ErrorBoundary fallbackTitle="指标中心渲染异常">
                  <MetricDagStudioPanel
                    selectedRunId={selectedRunId}
                    activeSourceId={activeSourceId}
                    initialOperators={operators}
                    initialMetricGraphs={metricGraphs}
                    onDrillDownToOperator={(operatorId) => {
                      setActiveTab('operators');
                      setFocusedOperatorTarget({ id: operatorId, nonce: Date.now() });
                    }}
                  />
                </ErrorBoundary>
              </section>
            )}

            {visitedTabs.has('systems') && (
              <section
                id="panel-systems"
                role="tabpanel"
                aria-labelledby="tab-systems"
                hidden={activeTab !== 'systems'}
              >
                <ErrorBoundary fallbackTitle="评估体系设计器渲染异常">
                  <SystemDagStudioPanel
                    selectedRunId={selectedRunId}
                    activeSourceId={activeSourceId}
                    onDrillDownToMetric={() => {
                      setActiveTab('indicators');
                    }}
                  />
                </ErrorBoundary>
              </section>
            )}

            {visitedTabs.has('catalog') && (
              <section
                id="panel-catalog"
                role="tabpanel"
                aria-labelledby="tab-catalog"
                hidden={activeTab !== 'catalog'}
              >
                <ErrorBoundary fallbackTitle="输出字段规范字典渲染异常">
                  <SimulationCatalogPanel catalog={catalog} operators={operators} />
                </ErrorBoundary>
              </section>
            )}

            {visitedTabs.has('data') && (
              <section
                id="panel-data"
                role="tabpanel"
                aria-labelledby="tab-data"
                hidden={activeTab !== 'data'}
              >
                <ErrorBoundary fallbackTitle="推演数据浏览器渲染异常">
                  <DataExplorerView
                    runs={runs}
                    catalog={catalog}
                    selectedRunId={selectedRunId}
                    onSelectRun={setSelectedRunId}
                    onRefresh={loadAll}
                    onOpenSettings={(tab) => {
                      setSettingsInitialTab((tab as SettingsTabKey) || 'database');
                      setSettingsModalOpen(true);
                    }}
                  />
                </ErrorBoundary>
              </section>
            )}

            {visitedTabs.has('realtime') && (
              <section
                id="panel-realtime"
                role="tabpanel"
                aria-labelledby="tab-realtime"
                hidden={activeTab !== 'realtime'}
              >
                <ErrorBoundary fallbackTitle="实时研判监控台渲染异常">
                  <RealtimeMonitorView systems={systems} />
                </ErrorBoundary>
              </section>
            )}
          </>
        )}
      </main>

      <GlobalSettingsModal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        initialTab={settingsInitialTab}
        runs={runs}
        selectedRunId={selectedRunId}
        activeSourceId={activeSourceId}
        onActivated={async (runId, nextSourceId) => {
          setActiveSourceId(nextSourceId);
          setSelectedRunId(runId);
          await loadAll();
        }}
        onNavigateToExplorer={() => setActiveTab('data')}
        onRefreshAll={loadAll}
      />
    </div>
  );
}
export default App;
