import type * as echarts from 'echarts';
import {
  BookOpen,
  ChevronRight,
  Database,
  FileCode2,
  GitMerge,
  Layers,
  Radio,
  Search,
  Table2,
  Network,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  CatalogEventField,
  CatalogEventSpec,
  F1OutputCatalog,
  MetricAtomMeta,
} from '../api.ts';
import { EChartPanel } from './EChartPanel.tsx';
import { DataRelationGraphView } from './DataRelationGraphView.tsx';

interface SimulationCatalogPanelProps {
  catalog: F1OutputCatalog | null;
  operators: MetricAtomMeta[];
}

type CatalogEventFilter = 'all' | 'active' | 'db_table' | 'tacview' | 'unused_enum' | 'placeholder';

const BS_FAMILY_ORDER = [
  'root',
  'side_wrapper',
  'side_fields',
  'unit_wrapper',
  'unit_fields',
  'non_active',
  'scenario_events',
] as const;

const BS_FAMILY_TITLES: Record<string, string> = {
  root: '根节点 Scenario 与全局环境',
  side_wrapper: '阵营包装器 Sides[].Side',
  side_fields: '阵营级属性、目标 Contacts 与任务区',
  unit_wrapper: '活跃单元包装器 ActiveUnits[].<UnitType>',
  unit_fields: '活跃单元运动、毁伤、弹药与传感器',
  non_active: '非活跃单元 NonActiveUnits（落点/非制导）',
  scenario_events: '引擎触发器与推演事件（EventTriggers / SimEvents）',
};

const QUICK_SEARCH_EXAMPLES = ['WeaponID', 'Sensors', 'Longitude', 'DBID', 'DamageState', 'Missions'];

function operatorsForCsvTable(tableName: string, operators: MetricAtomMeta[]): MetricAtomMeta[] {
  const low = tableName.toLowerCase();
  return operators.filter((op) =>
    (op.f1FieldContract.csvTables ?? []).some((t) => t.toLowerCase() === low),
  );
}

function operatorsForBsPath(rawPath: string, operators: MetricAtomMeta[]): MetricAtomMeta[] {
  const low = rawPath.toLowerCase();
  return operators.filter((op) => {
    const fps = op.f1FieldContract.bsFramePaths ?? [];
    return fps.some((fp) => {
      const fLow = fp.toLowerCase();
      if (low.includes('sensors') && fLow.includes('sensors')) return true;
      if (low.includes('contacts') && fLow.includes('contacts')) return true;
      if (low.includes('missions') && fLow.includes('missions')) return true;
      if (low.includes('referencepoints') && fLow.includes('threatzones')) return true;
      if ((low.includes('mounts') || low.includes('magazines')) && fLow.includes('mounts/weapons')) return true;
      if (
        (low.includes('lonlr') || low.includes('latlr') || low.includes('longitude') || low.includes('latitude')) &&
        fLow.includes('lonlr/latlr')
      ) {
        return true;
      }
      if (low.includes('damagestate') && (fLow.includes('isdestroyed') || fLow.includes('damagepercent'))) {
        return true;
      }
      if ((low.includes('simevents') || low.includes('eventtriggers')) && fLow.includes('engine_event')) {
        return true;
      }
      return false;
    });
  });
}

function statusBadgeMeta(status: CatalogEventSpec['status']): { label: string; cls: string } {
  if (status === 'active') {
    return {
      label: '活跃实现 (active)',
      cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35',
    };
  }
  if (status === 'unused_enum') {
    return {
      label: '死枚举 D5 (unused_enum)',
      cls: 'bg-amber-500/15 text-amber-300 border-amber-500/35',
    };
  }
  return {
    label: '引擎占位 (placeholder)',
    cls: 'bg-slate-800 text-slate-400 border-slate-700',
  };
}

export function SimulationCatalogPanel({ catalog, operators }: SimulationCatalogPanelProps) {
  const [subView, setSubView] = useState<'catalog' | 'relations'>('catalog');
  const [globalQuery, setGlobalQuery] = useState('');
  const [eventFilter, setEventFilter] = useState<CatalogEventFilter>('all');
  const [showAllDensityBars, setShowAllDensityBars] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CatalogEventSpec | null>(null);
  const [expandedHitKeys, setExpandedHitKeys] = useState<Set<string>>(new Set());

  const stats = useMemo(() => {
    const events = catalog?.event_exporter?.events ?? [];
    const prefix = catalog?.event_exporter?.shared_make_paras_dict_prefix ?? [];
    const bsMap = catalog?.bs_mqtt?.scenario_paths ?? {};
    const bsTopics = catalog?.bs_mqtt?.topics ?? [];
    const channels = catalog?.channels ?? [];
    const joinGraph = catalog?.join_graph ?? [];
    const discrepancies = catalog?.doc_discrepancies ?? [];

    const allFields = events.flatMap((e) => e.fields ?? []);
    const csTypes = new Map<string, number>();
    const units = new Map<string, number>();
    for (const f of allFields) {
      const t = f.cs_type || 'unknown';
      csTypes.set(t, (csTypes.get(t) ?? 0) + 1);
      if (f.unit) {
        units.set(f.unit, (units.get(f.unit) ?? 0) + 1);
      }
    }

    const bsFamilies = BS_FAMILY_ORDER.map((key) => {
      const val = bsMap[key];
      const paths = Array.isArray(val) ? val.map(String) : typeof val === 'string' && val ? [val] : [];
      return {
        key,
        title: BS_FAMILY_TITLES[key] ?? key,
        paths,
      };
    });

    const totalBsPaths = bsFamilies.reduce((sum, fam) => sum + fam.paths.length, 0);

    return {
      events,
      prefix,
      channels,
      bsTopics,
      bsFamilies,
      totalBsPaths,
      joinGraph,
      discrepancies,
      activeCount: events.filter((e) => e.status === 'active').length,
      unusedCount: events.filter((e) => e.status === 'unused_enum').length,
      placeholderCount: events.filter((e) => e.status === 'placeholder').length,
      dbTableCount: events.filter((e) => e.db_table).length,
      tacviewCount: events.filter((e) => e.tacview).length,
      scan31Count: events.filter((e) => e.in_scan_31).length,
      repoSampleCount: events.filter((e) => e.in_repo_samples).length,
      totalBusinessFields: allFields.length,
      csTypeList: [...csTypes.entries()].sort((a, b) => b[1] - a[1]),
      unitList: [...units.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [catalog]);

  // 跨表跨通道字段实时反查结果（仅在用户输入查询词时激活）
  const crossLookup = useMemo(() => {
    const q = globalQuery.trim().toLowerCase();
    if (!q) return null;

    const csvFieldHits: Array<{
      table: CatalogEventSpec;
      field: CatalogEventField;
      isPrefix?: boolean;
      ops: MetricAtomMeta[];
    }> = [];

    for (const pf of stats.prefix) {
      if (pf.name.toLowerCase().includes(q) || (pf.condition ?? '').toLowerCase().includes(q)) {
        csvFieldHits.push({
          table: { id: -1, name: 'MakeParasDict 公共前缀', status: 'active' },
          field: pf,
          isPrefix: true,
          ops: [],
        });
      }
    }

    for (const ev of stats.events) {
      const ops = operatorsForCsvTable(ev.name, operators);
      for (const f of ev.fields ?? []) {
        if (
          f.name.toLowerCase().includes(q) ||
          ev.name.toLowerCase().includes(q) ||
          (f.unit ?? '').toLowerCase().includes(q) ||
          (f.note ?? '').toLowerCase().includes(q) ||
          ops.some((o) => o.id.toLowerCase().includes(q) || o.name.toLowerCase().includes(q))
        ) {
          csvFieldHits.push({ table: ev, field: f, ops });
        }
      }
    }

    const bsPathHits: Array<{
      familyKey: string;
      familyTitle: string;
      pathExpr: string;
      ops: MetricAtomMeta[];
    }> = [];
    for (const fam of stats.bsFamilies) {
      for (const p of fam.paths) {
        const ops = operatorsForBsPath(p, operators);
        if (
          p.toLowerCase().includes(q) ||
          fam.key.toLowerCase().includes(q) ||
          ops.some((o) => o.id.toLowerCase().includes(q) || o.name.toLowerCase().includes(q))
        ) {
          bsPathHits.push({
            familyKey: fam.key,
            familyTitle: fam.title,
            pathExpr: p,
            ops,
          });
        }
      }
    }

    return { csvFieldHits, bsPathHits };
  }, [globalQuery, stats, operators]);

  // ECharts 1: EventExporter 各表字段密度排行
  const densityChartOption = useMemo<echarts.EChartsOption>(() => {
    const withFields = stats.events
      .filter((e) => (e.fields?.length ?? 0) > 0)
      .sort((a, b) => (a.fields?.length ?? 0) - (b.fields?.length ?? 0));
    const sliced = showAllDensityBars ? withFields : withFields.slice(-18);

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: unknown) => {
          const item = Array.isArray(params) ? params[0] : params;
          const idx = (item as { dataIndex?: number }).dataIndex ?? 0;
          const ev = sliced[idx];
          if (!ev) return '';
          return [
            `<strong>#${ev.id} ${ev.name}</strong>`,
            `业务字段: ${ev.fields?.length ?? 0} 个${ev.has_make_paras_prefix ? ' (+4 公共前缀条件列)' : ''}`,
            `DB 表: ${ev.db_table ? `是 (${ev.db_cols_count ?? '?'} 列)` : '否'} · Tacview: ${ev.tacview ? '是' : '否'}`,
            ev.gating ? `门控: ${ev.gating}` : '',
            ev.call_sites?.length ? `源码调用: ${ev.call_sites.join(', ')}` : '',
          ]
            .filter(Boolean)
            .join('<br/>');
        },
      },
      grid: { left: 10, right: 44, top: 12, bottom: 26, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: '#94a3b8', fontSize: 11 },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      yAxis: {
        type: 'category',
        data: sliced.map((e) => e.name),
        axisLabel: { color: '#e2e8f0', fontSize: 11, width: 175, overflow: 'truncate' },
      },
      series: [
        {
          name: '业务字段数',
          type: 'bar',
          data: sliced.map((e) => ({
            value: e.fields?.length ?? 0,
            itemStyle: {
              color: e.tacview ? '#38bdf8' : e.db_table ? '#10b981' : '#818cf8',
              borderRadius: [0, 4, 4, 0],
            },
          })),
          label: { show: true, position: 'right', color: '#cbd5e1', fontSize: 11 },
        },
      ],
    };
  }, [stats.events, showAllDensityBars]);

  // ECharts 2: 44 类导出事件能力归因分布
  const capabilityChartOption = useMemo<echarts.EChartsOption>(() => {
    const categories = [
      { label: '活跃调用点 (active)', val: stats.activeCount, color: '#10b981' },
      { label: 'DB 建表支持 (db_table)', val: stats.dbTableCount, color: '#38bdf8' },
      { label: '31 表核心集 (in_scan_31)', val: stats.scan31Count, color: '#6366f1' },
      { label: '仓内实证曾见 (in_repo_samples)', val: stats.repoSampleCount, color: '#22d3ee' },
      { label: 'Tacview 输出 (tacview)', val: stats.tacviewCount, color: '#a855f7' },
      { label: '死枚举 D5 (unused_enum)', val: stats.unusedCount, color: '#f59e0b' },
      { label: '引擎占位 (placeholder)', val: stats.placeholderCount, color: '#64748b' },
    ].reverse();

    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 10, right: 44, top: 12, bottom: 26, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: '#94a3b8', fontSize: 11 },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      yAxis: {
        type: 'category',
        data: categories.map((c) => c.label),
        axisLabel: { color: '#cbd5e1', fontSize: 11, width: 170, overflow: 'truncate' },
      },
      series: [
        {
          type: 'bar',
          data: categories.map((c) => ({
            value: c.val,
            itemStyle: { color: c.color, borderRadius: [0, 4, 4, 0] },
          })),
          label: {
            show: true,
            position: 'right',
            color: '#e2e8f0',
            fontSize: 11,
            formatter: '{c} / 44',
          },
        },
      ],
    };
  }, [stats]);

  // ECharts 3: BS MQTT 7 族路径规模分布
  const bsFamilyChartOption = useMemo<echarts.EChartsOption>(() => {
    const ordered = [...stats.bsFamilies].sort((a, b) => a.paths.length - b.paths.length);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: unknown) => {
          const item = Array.isArray(params) ? params[0] : params;
          const idx = (item as { dataIndex?: number }).dataIndex ?? 0;
          const fam = ordered[idx];
          if (!fam) return '';
          return `<strong>${fam.key}</strong> (${fam.title})<br/>规范路径/属性条目：${fam.paths.length} 条`;
        },
      },
      grid: { left: 10, right: 48, top: 12, bottom: 24, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: '#94a3b8', fontSize: 11 },
        splitLine: { lineStyle: { color: '#1e293b' } },
      },
      yAxis: {
        type: 'category',
        data: ordered.map((f) => `${f.key} (${f.title.slice(0, 12)})`),
        axisLabel: { color: '#e2e8f0', fontSize: 11, width: 185, overflow: 'truncate' },
      },
      series: [
        {
          type: 'bar',
          data: ordered.map((f) => ({
            value: f.paths.length,
            itemStyle: {
              color: f.key === 'unit_fields' ? '#22d3ee' : f.key === 'side_fields' ? '#38bdf8' : '#818cf8',
              borderRadius: [0, 4, 4, 0],
            },
          })),
          label: { show: true, position: 'right', color: '#cbd5e1', fontSize: 11, formatter: '{c} 项' },
        },
      ],
    };
  }, [stats.bsFamilies]);

  const filteredEvents = useMemo(() => {
    const q = globalQuery.trim().toLowerCase();
    return stats.events.filter((ev) => {
      if (eventFilter === 'active' && ev.status !== 'active') return false;
      if (eventFilter === 'db_table' && !ev.db_table) return false;
      if (eventFilter === 'tacview' && !ev.tacview) return false;
      if (eventFilter === 'unused_enum' && ev.status !== 'unused_enum') return false;
      if (eventFilter === 'placeholder' && ev.status !== 'placeholder') return false;
      if (!q) return true;
      const ops = operatorsForCsvTable(ev.name, operators);
      return (
        ev.name.toLowerCase().includes(q) ||
        String(ev.id) === q ||
        (ev.gating ?? '').toLowerCase().includes(q) ||
        (ev.fields ?? []).some(
          (f) => f.name.toLowerCase().includes(q) || (f.note ?? '').toLowerCase().includes(q),
        ) ||
        ops.some((o) => o.id.toLowerCase().includes(q) || o.name.toLowerCase().includes(q))
      );
    });
  }, [stats.events, eventFilter, globalQuery, operators]);

  if (!catalog) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">
        正在加载全局 F1 仿真输出规范目录 (`f1-output-catalog.json`)...
      </div>
    );
  }

  const aux = catalog.bridge_and_auxiliary;

  return (
    <div className="space-y-4">
      {/* 0. 独立入口标题说明栏（全局规范 · 不绑定具体 Run） */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/75 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-cyan-400 shrink-0" />
            F1 仿真全量输出数据规范目录（全局 · 不绑定具体 Run）
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            基于引擎源码盘点与 <code className="text-slate-300">f1-output-catalog.json</code>：统一展示 7 大输出通道、EventExporter 44 标准事件 / 333 业务字段、BS MQTT 7 族 74 路径与 8 组跨表关联配方
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 子视图切换分段器 */}
          <div className="inline-flex rounded-lg border border-slate-800 bg-slate-950 p-0.5">
            <button
              type="button"
              onClick={() => setSubView('catalog')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition font-medium ${
                subView === 'catalog'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              <span>44表数据字典与通道</span>
            </button>
            <button
              type="button"
              onClick={() => setSubView('relations')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition font-medium ${
                subView === 'relations'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <GitMerge className="w-3.5 h-3.5 text-cyan-300" />
              <span>数据表关系图谱 (ER Graph)</span>
            </button>
          </div>

          <span className="shrink-0 px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-200 border border-cyan-500/30 text-[11px] font-medium hidden sm:inline-block">
            全局引擎接口契约
          </span>
        </div>
      </div>

      {subView === 'relations' ? (
        <DataRelationGraphView catalog={catalog} operators={operators} />
      ) : (
        <>
          {/* 1. 全局引擎数据底座 KPI strip (不绑定任何具体 Run) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <Layers className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>引擎全量输出通道</span>
          </div>
          <div className="text-2xl font-bold text-slate-100">
            {stats.channels.length}
            <span className="text-sm font-normal text-slate-400"> 大通道</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            CSV/DB · BS MQTT · TCP · Bridge · Lua · Tacview · DIS
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <Table2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>EventExporter 标准事件表</span>
          </div>
          <div className="text-2xl font-bold text-slate-100">
            {stats.events.length}
            <span className="text-sm font-normal text-slate-400"> 类定义</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            活跃 {stats.activeCount} · 死枚举 D5 {stats.unusedCount} · 占位 {stats.placeholderCount} · DB表 {stats.dbTableCount}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <FileCode2 className="w-4 h-4 text-sky-400 shrink-0" />
            <span>EventExporter 标准字段字典</span>
          </div>
          <div className="text-2xl font-bold text-slate-100">
            {stats.totalBusinessFields}
            <span className="text-sm font-normal text-slate-400"> + {stats.prefix.length} 前缀</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {stats.csTypeList.map(([k, v]) => `${k} ${v}`).join(' · ')}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <Radio className="w-4 h-4 text-violet-400 shrink-0" />
            <span>BS MQTT 路径与跨表关联</span>
          </div>
          <div className="text-2xl font-bold text-slate-100">
            {stats.bsFamilies.length} 族 · {stats.totalBsPaths} 路径
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {stats.bsTopics.length} MQTT Topics · {stats.joinGraph.length} 条 Join 链路 · {stats.discrepancies.length} 实证偏差
          </div>
        </div>
      </div>

      {/* 2. 全局跨表跨通道字段检索引擎 */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 space-y-3 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Search className="w-4 h-4 text-cyan-400" />
              全局跨表查字段与反查驱动算子
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              与具体推演场次无关——输入任意底层字段名、表名、BS 路径或算子 ID，直接定位仿真引擎导出契约与评估算子依赖。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-slate-500">示例：</span>
            {QUICK_SEARCH_EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setGlobalQuery(ex)}
                className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 hover:border-cyan-500/40 text-cyan-300 font-mono"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={globalQuery}
              onChange={(e) => setGlobalQuery(e.target.value)}
              placeholder="输入字段名 / 表名 / BS 路径 / 单位 / 算子名（如 WeaponID, Sensors, kts）..."
              aria-label="全局检索仿真输出字段与路径"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100"
            />
          </label>
          {globalQuery && (
            <button
              type="button"
              onClick={() => setGlobalQuery('')}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 hover:bg-slate-800 text-xs text-slate-300"
            >
              <X className="w-3.5 h-3.5" /> 清除筛选
            </button>
          )}
        </div>

        {crossLookup && (
          <div className="rounded-lg border border-cyan-500/35 bg-slate-950/85 p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-cyan-200">
                字段反查命中：CSV 表字段 {crossLookup.csvFieldHits.length} 处 · BS 路径 {crossLookup.bsPathHits.length} 处
              </span>
            </div>

            {crossLookup.csvFieldHits.length > 0 && (
              <div
                tabIndex={0}
                role="region"
                aria-label="跨表字段检索命中结果"
                className="responsive-table-wrap responsive-table-scroll-y rounded border border-slate-800"
              >
                <table className="w-full text-[11px] text-left">
                  <thead className="text-slate-400 border-b border-slate-800">
                    <tr>
                      <th scope="col" className="px-2.5 py-1.5">所属表 / 前缀</th>
                      <th scope="col" className="px-2.5 py-1.5">字段名</th>
                      <th scope="col" className="px-2.5 py-1.5">C# / DB 类型</th>
                      <th scope="col" className="px-2.5 py-1.5 hide-narrow-col">单位 / 说明</th>
                      <th scope="col" className="px-2.5 py-1.5">关联算子</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {crossLookup.csvFieldHits.slice(0, 60).map((hit, idx) => (
                      <tr key={`${hit.table.name}-${hit.field.name}-${idx}`} className="hover:bg-slate-900/60">
                        <th scope="row" className="px-2.5 py-1.5 font-mono text-slate-200 font-normal align-top">
                          {hit.table.name}
                        </th>
                        <td className="px-2.5 py-1.5 font-mono text-cyan-300 align-top">{hit.field.name}</td>
                        <td className="px-2.5 py-1.5 font-mono text-slate-300 align-top">
                          {hit.field.cs_type ?? '—'}
                          {hit.field.db_type ? ` / ${hit.field.db_type}` : ''}
                          {hit.field.max_len ? `(${hit.field.max_len})` : ''}
                        </td>
                        <td className="px-2.5 py-1.5 text-slate-400 hide-narrow-col align-top">
                          {hit.field.unit ? `[${hit.field.unit}] ` : ''}
                          {hit.field.note ?? hit.field.condition ?? (hit.field.enum_values ? hit.field.enum_values.join(' | ') : '—')}
                        </td>
                        <td className="px-2.5 py-1.5 align-top">
                          {(() => {
                            const hitKey = `${hit.table.name}-${hit.field.name}-${idx}`;
                            const isExpanded = expandedHitKeys.has(hitKey);
                            const displayedOps = isExpanded ? hit.ops : hit.ops.slice(0, 4);
                            return (
                              <div className="flex flex-wrap gap-1 items-center">
                                {displayedOps.map((o) => (
                                  <span
                                    key={o.id}
                                    className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 font-mono text-[10px]"
                                  >
                                    {o.id}
                                  </span>
                                ))}
                                {hit.ops.length > 4 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setExpandedHitKeys((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(hitKey)) next.delete(hitKey);
                                        else next.add(hitKey);
                                        return next;
                                      });
                                    }}
                                    className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-[10px] cursor-pointer transition-colors"
                                    title={isExpanded ? '收起多余算子' : `点击展开其余 ${hit.ops.length - 4} 个算子: ${hit.ops.slice(4).map((o) => o.id).join(', ')}`}
                                  >
                                    {isExpanded ? '收起' : `+${hit.ops.length - 4}`}
                                  </button>
                                )}
                                {hit.ops.length === 0 && '—'}
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {crossLookup.bsPathHits.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {crossLookup.bsPathHits.map((bh, idx) => (
                  <div
                    key={`${bh.familyKey}-${idx}`}
                    className="rounded border border-slate-800 bg-slate-900/70 p-2 text-[11px] space-y-1 min-w-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-violet-300 break-all">{bh.pathExpr}</span>
                      <span className="shrink-0 px-1.5 py-0.5 rounded bg-slate-950 text-slate-400 font-mono">
                        {bh.familyKey}
                      </span>
                    </div>
                    {bh.ops.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {bh.ops.map((o) => (
                          <span
                            key={o.id}
                            className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 font-mono text-[10px]"
                          >
                            {o.id}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {crossLookup.csvFieldHits.length === 0 && crossLookup.bsPathHits.length === 0 && (
              <div className="text-xs text-slate-500">未在 44 张 CSV 表或 74 条 BS 路径中匹配到该字段或关键词。</div>
            )}
          </div>
        )}
      </section>

      {/* 3. 三组全局可视化图表（不依赖具体场次） */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-xs font-semibold text-slate-200">
              EventExporter 各事件表业务字段数量排行（共 {stats.totalBusinessFields} 字段）
            </h3>
            <button
              type="button"
              onClick={() => setShowAllDensityBars((v) => !v)}
              className="px-2 py-0.5 rounded border border-slate-700 bg-slate-950 text-[11px] text-cyan-300 hover:bg-slate-800"
            >
              {showAllDensityBars ? '仅看 Top 18' : '展开全部有字段表'}
            </button>
          </div>
          <EChartPanel
            option={densityChartOption}
            height={showAllDensityBars ? 640 : 340}
          />
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 space-y-3 min-w-0">
          <h3 className="text-xs font-semibold text-slate-200">
            44 类标准导出事件能力分布与 333 字段类型/单位统计
          </h3>
          <EChartPanel option={capabilityChartOption} height={240} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-slate-800/80 text-[11px]">
            <div>
              <div className="text-slate-400 mb-1">C# 字段类型分布（333 业务字段）</div>
              <div className="flex flex-wrap gap-1">
                {stats.csTypeList.map(([t, c]) => (
                  <span
                    key={t}
                    className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 font-mono text-cyan-300"
                  >
                    {t}: {c}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-slate-400 mb-1">物理量纲单位标注分布</div>
              <div className="flex flex-wrap gap-1">
                {stats.unitList.map(([u, c]) => {
                  const displayUnit = u === "percent_F6" ? "% (float64)" : u;
                  return (
                    <span
                      key={u}
                      className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 font-mono text-emerald-300"
                      title={u === "percent_F6" ? "percent_F6: 百分比 (float64 精度)" : undefined}
                    >
                      {displayUnit}: {c}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* 4. BS MQTT 7 族 74 路径规模分布图 + 原生手风琴 */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 space-y-4 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Radio className="w-4 h-4 text-violet-400" />
              BS MQTT 态势帧全量路径规范（{stats.bsFamilies.length} 族 {stats.totalBsPaths} 条路径 · {stats.bsTopics.length} 主题）
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              包含真机 Q-077 采集实证的单键实体包装、字符串化数值、SideID 外键映射及传感器/挂载嵌套路径。
            </p>
          </div>
        </div>

        <EChartPanel option={bsFamilyChartOption} height={240} />

        <section className="source-accordion space-y-2" aria-labelledby="catalog-bs-families-heading">
          <h4 id="catalog-bs-families-heading" className="text-xs font-semibold text-slate-300">
            BS Scenario JSON 全量 7 族路径字典
          </h4>
          {stats.bsFamilies.map((fam) => (
            <details
              key={fam.key}
              open={fam.key === 'root' || fam.key === 'side_fields' || fam.key === 'unit_fields'}
              className="rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2"
            >
              <summary className="text-xs font-medium text-slate-200 py-0.5">
                <ChevronRight className="accordion-chevron w-4 h-4 text-slate-400" />
                <span className="font-mono text-cyan-300">{fam.key}</span>
                <span>{fam.title}</span>
                <span className="ml-auto px-2 py-0.5 rounded text-[11px] bg-slate-900 border border-slate-800 text-slate-300">
                  {fam.paths.length} 条路径
                </span>
              </summary>
              <div className="pt-2 pb-1 border-t border-slate-800/70 mt-2 flex flex-wrap gap-1.5">
                {fam.paths.map((p) => {
                  const ops = operatorsForBsPath(p, operators);
                  return (
                    <span
                      key={p}
                      title={
                        ops.length > 0
                          ? `驱动算子: ${ops.map((o) => o.id).join(', ')}`
                          : '基础态势结构字段'
                      }
                      className={`px-2 py-0.5 rounded border font-mono text-[11px] break-all ${
                        ops.length > 0
                          ? 'bg-cyan-500/10 border-cyan-500/35 text-cyan-200'
                          : 'bg-slate-900 border-slate-800 text-slate-300'
                      }`}
                    >
                      {p}
                      {ops.length > 0 ? ` → ${ops.map((o) => o.id).join(', ')}` : ''}
                    </span>
                  );
                })}
              </div>
            </details>
          ))}
        </section>

        <div>
          <div className="text-[11px] text-slate-400 mb-1.5">
            全部 {stats.bsTopics.length} 个 BS MQTT / WebSocket 订阅主题：
          </div>
          <div className="flex flex-wrap gap-1.5">
            {stats.bsTopics.map((topic) => (
              <span
                key={topic}
                className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300"
              >
                {topic}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* 5. 44 类 EventExporter 标准事件表与字段明细浏览器 */}
      <section
        className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 space-y-3 min-w-0"
        aria-labelledby="catalog-events-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 id="catalog-events-heading" className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-400" />
              EventExporter 44 类标准导出事件表结构字典
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              源自 <span className="font-mono text-slate-300">EventExporter_CSV.cs</span> 与{' '}
              <span className="font-mono text-slate-300">EventExporter_Sqlite.cs</span>；点击任意行的「字段」可查看全列类型、长度与门控规则。
            </p>
          </div>
        </div>

        {/* 公共 MakeParasDict 4 前缀字段说明 */}
        <div className="rounded-lg border border-slate-800/80 bg-slate-950/75 p-2.5 text-[11px]">
          <div className="text-slate-300 font-medium mb-1">
            shared_make_paras_dict_prefix（多数事件表共享的前缀列）：
          </div>
          <div className="flex flex-wrap gap-1.5">
            {stats.prefix.map((pf) => (
              <span
                key={pf.name}
                title={pf.condition}
                className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-slate-300"
              >
                <span className="text-cyan-300">{pf.name}</span> ({pf.cs_type}
                {pf.db_type === undefined ? '' : `, db:${String(pf.db_type)}`}
                ) — {pf.condition}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['all', `全部 (${stats.events.length})`],
              ['active', `活跃实现 (${stats.activeCount})`],
              ['db_table', `DB 建表 (${stats.dbTableCount})`],
              ['tacview', `Tacview (${stats.tacviewCount})`],
              ['unused_enum', `死枚举 D5 (${stats.unusedCount})`],
              ['placeholder', `引擎占位 (${stats.placeholderCount})`],
            ] as Array<[CatalogEventFilter, string]>
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setEventFilter(k)}
              className={`px-2.5 py-1 rounded-md text-xs border transition ${
                eventFilter === k
                  ? 'bg-cyan-500/20 text-cyan-200 border-cyan-500/50'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-labelledby="catalog-events-caption"
          className="responsive-table-wrap responsive-table-scroll-y rounded-lg border border-slate-800/80 bg-slate-950/50"
        >
          <table className="w-full text-xs text-left">
            <caption id="catalog-events-caption" className="sr-only">
              F1 EventExporter 44 类标准事件表全局规范定义
            </caption>
            <thead className="text-slate-400 border-b border-slate-800">
              <tr>
                <th scope="col" className="px-2.5 py-2 font-medium">ID / 表名</th>
                <th scope="col" className="px-2.5 py-2 font-medium">实现状态</th>
                <th scope="col" className="px-2.5 py-2 font-medium">字段数 / DB 列数</th>
                <th scope="col" className="px-2.5 py-2 font-medium hide-narrow-col">门控与分边键</th>
                <th scope="col" className="px-2.5 py-2 font-medium hide-narrow-col">关联算子</th>
                <th scope="col" className="px-2.5 py-2 font-medium text-right">结构</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {filteredEvents.map((ev) => {
                const sm = statusBadgeMeta(ev.status);
                const ops = operatorsForCsvTable(ev.name, operators);
                const isSelected = selectedEvent?.id === ev.id;
                return (
                  <tr key={ev.id} className={`hover:bg-slate-800/35 ${isSelected ? 'bg-cyan-500/10' : ''}`}>
                    <th scope="row" className="px-2.5 py-2 font-normal align-top">
                      <div className="font-mono text-slate-100 font-medium">
                        #{ev.id} {ev.name}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-0.5 text-[10px] text-slate-500">
                        {ev.db_table && <span className="px-1 rounded bg-slate-800">DB表</span>}
                        {ev.tacview && <span className="px-1 rounded bg-slate-800">Tacview</span>}
                        {ev.in_scan_31 && <span className="px-1 rounded bg-slate-800">31核心集</span>}
                        {ev.in_repo_samples && <span className="px-1 rounded bg-slate-800">仓内曾见</span>}
                      </div>
                    </th>
                    <td className="px-2.5 py-2 align-top whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded border text-[11px] ${sm.cls}`}>
                        {sm.label}
                      </span>
                    </td>
                    <td className="px-2.5 py-2 align-top font-mono text-slate-300">
                      <div>{ev.fields?.length ?? 0} 业务字段</div>
                      <div className="text-[11px] text-slate-500">
                        {ev.db_table ? `DB ${ev.db_cols_count ?? '—'} 列` : '无独立 DB 表'}
                      </div>
                    </td>
                    <td className="px-2.5 py-2 align-top hide-narrow-col text-[11px] text-slate-400">
                      <div className="font-mono break-all text-slate-300">{ev.gating ?? '—'}</div>
                      {ev.side_split_key && (
                        <div className="text-slate-500">分边键：{ev.side_split_key}</div>
                      )}
                    </td>
                    <td className="px-2.5 py-2 align-top hide-narrow-col">
                      {ops.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {ops.map((o) => (
                            <span
                              key={o.id}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                                o.readiness === 'batch_a_ready'
                                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                                  : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                              }`}
                            >
                              {o.id}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2 align-top text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelectedEvent(isSelected ? null : ev)}
                        className="px-2 py-1 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-[11px] text-cyan-200"
                      >
                        {isSelected ? '收起' : '字段'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 选中事件表的全字段详单 */}
        {selectedEvent && (
          <div className="rounded-lg border border-cyan-500/40 bg-slate-950/95 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-cyan-200 font-mono">
                表结构详单：#{selectedEvent.id} {selectedEvent.name}（{selectedEvent.fields?.length ?? 0} 业务字段）
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                aria-label="收起表结构详单"
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {selectedEvent.call_sites && selectedEvent.call_sites.length > 0 && (
              <div className="text-[11px] text-slate-400 font-mono">
                C# 调用点：{selectedEvent.call_sites.join(' | ')}
              </div>
            )}
            {selectedEvent.note && (
              <div className="text-[11px] text-amber-300">备注：{selectedEvent.note}</div>
            )}
            {selectedEvent.fields && selectedEvent.fields.length > 0 ? (
              <div
                tabIndex={0}
                role="region"
                aria-label={`${selectedEvent.name} 字段详单`}
                className="responsive-table-wrap rounded border border-slate-800"
              >
                <table className="w-full text-[11px] text-left font-mono">
                  <thead className="text-slate-400 border-b border-slate-800 bg-slate-900/70">
                    <tr>
                      <th scope="col" className="px-2.5 py-1.5">字段名</th>
                      <th scope="col" className="px-2.5 py-1.5">C# 类型</th>
                      <th scope="col" className="px-2.5 py-1.5">DB 类型 / 长度</th>
                      <th scope="col" className="px-2.5 py-1.5">单位</th>
                      <th scope="col" className="px-2.5 py-1.5">枚举 / 备注</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {selectedEvent.fields.map((f) => (
                      <tr key={f.name} className="hover:bg-slate-900/50">
                        <th scope="row" className="px-2.5 py-1 text-cyan-300 font-normal">
                          {f.name}
                        </th>
                        <td className="px-2.5 py-1 text-slate-200">{f.cs_type ?? '—'}</td>
                        <td className="px-2.5 py-1 text-slate-400">
                          {f.db_type ?? 'null (未入DB)'}
                          {f.max_len ? ` (${f.max_len})` : ''}
                        </td>
                        <td className="px-2.5 py-1 text-emerald-300">{f.unit ?? '—'}</td>
                        <td className="px-2.5 py-1 text-slate-400 font-sans">
                          {f.enum_values ? `枚举: ${f.enum_values.join(' | ')}` : f.note ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-xs text-slate-500">该枚举当前无导出字段（{selectedEvent.status}）。</div>
            )}
          </div>
        )}
      </section>

      {/* 6. 折叠扩展区：7 大输出通道、8 条跨表 Join 图谱、D1-D9 实证偏差 */}
      <section className="source-accordion space-y-2" aria-labelledby="catalog-ext-heading">
        <h3 id="catalog-ext-heading" className="text-xs font-semibold text-slate-300">
          引擎全通道全景、跨表 Join 图谱与 D1–D9 实证偏差规范
        </h3>

        {/* 7 大通道 + Bridge/TCP/DIS */}
        <details className="rounded-xl border border-slate-800 bg-slate-900/75 px-4 py-3">
          <summary className="text-xs font-semibold text-slate-100">
            <ChevronRight className="accordion-chevron w-4 h-4 text-slate-400" />
            <BookOpen className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>7 大仿真输出通道（EventExporter / BS MQTT / TCP / AI Bridge / Lua / Tacview / DIS）</span>
            <span className="ml-auto px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[11px] text-slate-300">
              {stats.channels.length} 通道
            </span>
          </summary>
          <div className="pt-3 mt-2 border-t border-slate-800/80 space-y-3 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {stats.channels.map((ch) => (
                <div key={ch.id} className="rounded-lg border border-slate-800 bg-slate-950/75 p-3 space-y-1 min-w-0">
                  <div className="font-semibold text-cyan-200 font-mono">
                    {ch.id} · {ch.name}
                  </div>
                  {ch.observed_rate_q077 && (
                    <div className="text-[11px] text-violet-300">{ch.observed_rate_q077}</div>
                  )}
                  {ch.gating_note && (
                    <div className="text-[11px] text-amber-300">{ch.gating_note}</div>
                  )}
                  {(ch.entry_points ?? ch.consumer_entry_points) && (
                    <div className="text-[11px] text-slate-400 font-mono break-all">
                      入口：{(ch.entry_points ?? ch.consumer_entry_points ?? []).join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {aux && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-[11px]">
                <div className="rounded-lg border border-slate-800 bg-slate-950/75 p-3 space-y-1.5">
                  <div className="font-semibold text-slate-200">
                    AI HTTP Bridge 工具契约 ({aux.http_bridge_default_url ?? '127.0.0.1:9477'})
                  </div>
                  {Object.entries(aux.bridge_tools ?? {}).map(([toolName, fields]) => (
                    <div key={toolName} className="space-y-0.5">
                      <div className="font-mono text-emerald-300">{toolName}</div>
                      <div className="font-mono text-slate-400 break-all">{fields.join(', ')}</div>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/75 p-3 space-y-1.5">
                  <div className="font-semibold text-slate-200">TCP DataOutputServer 与 IEEE DIS PDU</div>
                  {aux.tcp_data_output_server && (
                    <div className="font-mono text-slate-400 break-all">
                      TCP：{aux.tcp_data_output_server.wire_format}
                    </div>
                  )}
                  <div className="text-emerald-300 font-mono break-all">
                    已发 DIS PDU ({aux.dis_pdus_sent?.length ?? 0})：{(aux.dis_pdus_sent ?? []).join(', ')}
                  </div>
                  <div className="text-amber-300 font-mono break-all">
                    未实现 DIS PDU ({aux.dis_pdus_absent?.length ?? 0})：{(aux.dis_pdus_absent ?? []).join(', ')}
                  </div>
                </div>
              </div>
            )}
          </div>
        </details>

        {/* 8 条跨表 Join 图谱 */}
        <details open className="rounded-xl border border-slate-800 bg-slate-900/75 px-4 py-3">
          <summary className="text-xs font-semibold text-slate-100">
            <ChevronRight className="accordion-chevron w-4 h-4 text-slate-400" />
            <GitMerge className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>跨表与跨通道 Join 图谱（算子主键对齐规则）</span>
            <span className="ml-auto px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[11px] text-slate-300">
              {stats.joinGraph.length} 条配方
            </span>
          </summary>
          <div className="pt-3 mt-2 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-2 gap-2">
            {stats.joinGraph.map((j) => (
              <div key={j.recipe} className="rounded-lg border border-slate-800 bg-slate-950/75 p-2.5 text-[11px] space-y-1">
                <div className="font-mono font-semibold text-emerald-300">{j.recipe}</div>
                {j.left && j.right && (
                  <div className="font-mono text-slate-200 break-all">
                    {j.left} ⟷ {j.right}
                    {j.then ? ` → ${j.then}` : ''}
                  </div>
                )}
                {j.path && <div className="font-mono text-slate-200 break-all">{j.path}</div>}
                {j.inputs && (
                  <div className="font-mono text-slate-200 break-all">输入：{j.inputs.join(' + ')}</div>
                )}
                {j.scope && <div className="text-slate-400">{j.scope}</div>}
              </div>
            ))}
          </div>
        </details>

        {/* D1-D9 实证偏差 */}
        <details className="rounded-xl border border-slate-800 bg-slate-900/75 px-4 py-3">
          <summary className="text-xs font-semibold text-slate-100">
            <ChevronRight className="accordion-chevron w-4 h-4 text-slate-400" />
            <span>文档与源码实证偏差清单（D1–D9）</span>
            <span className="ml-auto px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[11px] text-amber-300">
              {stats.discrepancies.length} 条
            </span>
          </summary>
          <div className="pt-3 mt-2 border-t border-slate-800/80 space-y-1.5">
            {stats.discrepancies.map((d) => (
              <div
                key={d}
                className="rounded border border-amber-500/25 bg-slate-950/80 px-3 py-2 text-xs text-slate-300"
              >
                {d}
              </div>
            ))}
          </div>
        </details>
      </section>
        </>
      )}
    </div>
  );
}
