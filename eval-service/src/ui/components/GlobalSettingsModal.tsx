import {
  AlertTriangle,
  Archive,
  Bell,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Cpu,
  Database,
  Download,
  Eye,
  ExternalLink,
  FileText,
  FileUp,
  Folder,
  HardDrive,
  Layers,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  evalApi,
  type ComponentManifest,
  type DataSourceProbeResult,
  type DataSourceStatus,
  type StoredRunSummary,
} from '../api.ts';

export type SettingsTabKey = 'datasources' | 'database' | 'components' | 'engine' | 'alerts' | 'backup';

export interface GlobalSettingsModalProps {
  open: boolean;
  onClose: () => void;
  initialTab?: SettingsTabKey;
  runs: StoredRunSummary[];
  selectedRunId: string;
  activeSourceId: string;
  onActivated: (runId: string, activeSourceId: string) => Promise<void>;
  onNavigateToExplorer?: () => void;
  onRefreshAll?: () => Promise<void>;
}

export function GlobalSettingsModal({
  open,
  onClose,
  initialTab = 'datasources',
  runs,
  selectedRunId,
  activeSourceId,
  onActivated,
  onNavigateToExplorer,
  onRefreshAll,
}: GlobalSettingsModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTabKey>(initialTab);

  // 全局通知提示
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // -------------------------------------------------------------
  // Tab 1: 数据源与测试样本状态
  // -------------------------------------------------------------
  const [dataSources, setDataSources] = useState<DataSourceStatus[]>([]);
  const [serverActiveSourceId, setServerActiveSourceId] = useState(activeSourceId);
  const [dsLoading, setDsLoading] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  // 新增探测表单
  const [newPath, setNewPath] = useState('');
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<'csv_dir' | 'jsonl_file'>('csv_dir');
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<DataSourceProbeResult | null>(null);

  const loadSources = async () => {
    setDsLoading(true);
    try {
      const res = await evalApi.listDataSources();
      setDataSources(res.dataSources);
      setServerActiveSourceId(res.activeSourceId);
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setDsLoading(false);
    }
  };

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

  const handleDeleteDataSource = async (id: string) => {
    try {
      await evalApi.deleteDataSource(id);
      await loadSources();
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    }
  };

  // -------------------------------------------------------------
  // Tab 2: 物理双库隔离与多库管理 (Database Isolation)
  // -------------------------------------------------------------
  const [dbViewMode, setDbViewMode] = useState<'both' | 'operator' | 'scenario'>('both');
  const [activeOperatorDbName, setActiveOperatorDbName] = useState('operators.db');
  const [activeScenarioDbName, setActiveScenarioDbName] = useState('scenario-full-sample.db');
  const [operatorDbs, setOperatorDbs] = useState<Array<{ filename: string; filePath: string; fileSize: number; isActive: boolean }>>([]);
  const [scenarioDbs, setScenarioDbs] = useState<Array<{ filename: string; filePath: string; fileSize: number; isActive: boolean }>>([]);
  const [operatorDbStats, setOperatorDbStats] = useState<{ dbPath: string; dbBytes: number; counts: Record<string, number> } | null>(null);
  const [scenarioDbStats, setScenarioDbStats] = useState<{ dbPath: string; dbBytes: number; counts: Record<string, number> } | null>(null);
  const [switchingDb, setSwitchingDb] = useState(false);
  const [isUploadingDb, setIsUploadingDb] = useState(false);
  const [importingSamples, setImportingSamples] = useState(false);

  // 子弹窗：新建 / 克隆
  const [dbModal, setDbModal] = useState<{ action: 'create' | 'clone'; type: 'operator' | 'scenario' } | null>(null);
  const [modalInputName, setModalInputName] = useState('');
  const [templateChoice, setTemplateChoice] = useState<'empty' | 'standard'>('empty');

  const loadDatabases = async () => {
    try {
      const [cur, list] = await Promise.all([
        evalApi.getCurrentDb(),
        evalApi.listDatabases(),
      ]);

      if (cur.operatorDb) {
        setActiveOperatorDbName(cur.operatorDb.current);
        setOperatorDbStats(cur.operatorDb.stats);
      }
      if (cur.scenarioDb) {
        setActiveScenarioDbName(cur.scenarioDb.current);
        setScenarioDbStats(cur.scenarioDb.stats);
      } else {
        setActiveScenarioDbName(cur.current);
        setScenarioDbStats(cur.stats);
      }

      setOperatorDbs(list.operatorDatabases || []);
      setScenarioDbs(list.scenarioDatabases || list.databases || []);
    } catch (err) {
      setMsg({ kind: 'err', text: '加载数据库信息失败: ' + String(err) });
    }
  };

  const handleSwitchDatabase = async (filename: string, type: 'operator' | 'scenario') => {
    if ((type === 'operator' && filename === activeOperatorDbName) || (type === 'scenario' && filename === activeScenarioDbName)) return;
    setSwitchingDb(true);
    setMsg(null);
    try {
      const res = await evalApi.switchDatabase({ type, dbName: filename });
      if (res.ok) {
        if (type === 'operator') {
          setActiveOperatorDbName(res.activeDb);
          setMsg({ kind: 'ok', text: `已成功切换三库标准知识库为「${res.activeDb}」！` });
        } else {
          setActiveScenarioDbName(res.activeDb);
          setMsg({ kind: 'ok', text: `已成功切换想定推演数据库为「${res.activeDb}」！` });
        }
        await loadDatabases();
        if (onRefreshAll) await onRefreshAll();
      }
    } catch (err) {
      setMsg({ kind: 'err', text: `切换${type === 'operator' ? '算子库' : '想定库'}失败: ` + String(err) });
    } finally {
      setSwitchingDb(false);
    }
  };

  const handleCreateDatabase = async (type: 'operator' | 'scenario') => {
    const cleanName = modalInputName.trim().replace(/[\\/:*?"<>|]/g, '');
    if (!cleanName) return;
    setSwitchingDb(true);
    try {
      const res = await evalApi.createDatabase({
        type,
        dbName: cleanName.endsWith('.db') ? cleanName : `${cleanName}.db`,
        template: type === 'operator' ? templateChoice : undefined,
      });
      if (res.ok) {
        setMsg({ kind: 'ok', text: `成功创建并激活${type === 'operator' ? '三库标准库' : '想定库'}「${res.created}」！` });
        setDbModal(null);
        setModalInputName('');
        await loadDatabases();
        if (onRefreshAll) await onRefreshAll();
      }
    } catch (err) {
      setMsg({ kind: 'err', text: '创建数据库失败: ' + String(err) });
    } finally {
      setSwitchingDb(false);
    }
  };

  const handleCloneDatabase = async (type: 'operator' | 'scenario') => {
    const cleanName = modalInputName.trim().replace(/[\\/:*?"<>|]/g, '');
    if (!cleanName) return;
    setSwitchingDb(true);
    try {
      const res = await evalApi.cloneDatabase({
        type,
        targetName: cleanName.endsWith('.db') ? cleanName : `${cleanName}.db`,
        sourceDb: type === 'operator' ? activeOperatorDbName : activeScenarioDbName,
      });
      if (res.ok) {
        setMsg({ kind: 'ok', text: `成功克隆并激活${type === 'operator' ? '三库标准库' : '想定库'}「${res.cloned}」！` });
        setDbModal(null);
        setModalInputName('');
        await loadDatabases();
        if (onRefreshAll) await onRefreshAll();
      }
    } catch (err) {
      setMsg({ kind: 'err', text: '克隆数据库失败: ' + String(err) });
    } finally {
      setSwitchingDb(false);
    }
  };

  const handleUploadDbFile = async (e: ChangeEvent<HTMLInputElement>, type: 'operator' | 'scenario') => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingDb(true);
    setMsg(null);
    try {
      const arrayBuf = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(arrayBuf);
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      const res = await evalApi.uploadDatabase({
        filename: file.name,
        type,
        contentBase64: base64,
        switchNow: true,
      });
      if (res.ok) {
        setMsg({ kind: 'ok', text: `成功导入并激活${type === 'operator' ? '三库标准库' : '想定推演库'}「${res.uploaded}」！` });
        await loadDatabases();
        if (onRefreshAll) await onRefreshAll();
      }
    } catch (err) {
      setMsg({ kind: 'err', text: '导入数据库文件失败: ' + String(err) });
    } finally {
      setIsUploadingDb(false);
      e.target.value = '';
    }
  };

  const handleLoadBuiltinSamples = async () => {
    setImportingSamples(true);
    setMsg(null);
    try {
      const res = await evalApi.loadBuiltinSamples(true);
      setMsg({ kind: 'ok', text: `内置推演样本已重新灌装到当前想定库 (导入 ${res.runsCount} 场推演)` });
      await loadDatabases();
      if (onRefreshAll) await onRefreshAll();
    } catch (err) {
      setMsg({ kind: 'err', text: '灌装内置样本失败: ' + String(err) });
    } finally {
      setImportingSamples(false);
    }
  };

  // -------------------------------------------------------------
  // Tab 3: 计算沙箱与算法配置 (Engines & Sandbox)
  // -------------------------------------------------------------
  const [healthInfo, setHealthInfo] = useState<any>(null);
  const [pythonTesting, setPythonTesting] = useState(false);
  const [pythonResult, setPythonResult] = useState<any>(null);
  const [sandboxTimeout, setSandboxTimeout] = useState(10);
  const [mcdaObjectiveMethod, setMcdaObjectiveMethod] = useState<'critic' | 'entropy'>('critic');
  const [mcdaAlpha, setMcdaAlpha] = useState(0.5);
  const [vikorV, setVikorV] = useState(0.5);

  const testPythonSandbox = async () => {
    setPythonTesting(true);
    setPythonResult(null);
    try {
      const res = await evalApi.runPythonSandbox({
        script: `
import numpy as np
import scipy
print(f"NumPy v{np.__version__}, SciPy v{scipy.__version__} Ready")
matrix = np.array([[1.0, 0.5], [2.0, 1.0]])
eigenvalues = np.linalg.eigvals(matrix)
result = {"status": "ok", "max_eigen": float(np.max(eigenvalues))}
`,
        timeout: sandboxTimeout,
      });
      setPythonResult(res);
    } catch (err) {
      setPythonResult({ ok: false, error: String(err) });
    } finally {
      setPythonTesting(false);
    }
  };

  // -------------------------------------------------------------
  // Tab 4: 实时研判告警与防骚扰抗噪策略 (Alerts & Noise Suppression)
  // -------------------------------------------------------------
  const [suppressWindowSec, setSuppressWindowSec] = useState(30);
  const [filterMinorAlerts, setFilterMinorAlerts] = useState(false);
  const [defaultHitlAction, setDefaultHitlAction] = useState<'pending' | 'observe' | 'pause_inspect'>('pending');

  // -------------------------------------------------------------
  // Tab 5: 资产备份与出厂重置 (Backup, Migration & Reset)
  // -------------------------------------------------------------
  const [exportingAssets, setExportingAssets] = useState(false);
  const [resettingOverrides, setResettingOverrides] = useState(false);

  const handleExportAllAssets = async () => {
    setExportingAssets(true);
    try {
      const [opRes, indRes, sysRes] = await Promise.all([
        evalApi.listOperators(),
        evalApi.listIndicators(),
        evalApi.listSystems(),
      ]);
      const bundle = {
        exportedAt: new Date().toISOString(),
        version: '1.0.0',
        metadata: {
          operatorCount: opRes.operators.length,
          indicatorCount: indRes.indicators.length,
          systemCount: sysRes.systems.length,
        },
        operators: opRes.operators,
        indicators: indRes.indicators,
        systems: sysRes.systems,
      };
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `f1-eval-assets-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg({ kind: 'ok', text: '全部资产包导出成功！已保存到本地 JSON' });
    } catch (err) {
      setMsg({ kind: 'err', text: '导出资产包失败: ' + String(err) });
    } finally {
      setExportingAssets(false);
    }
  };

  const handleResetOverrides = async () => {
    if (!confirm('确定要重置所有内置算子的自定义覆盖参数吗？此操作将恢复出厂默认值。')) return;
    setResettingOverrides(true);
    try {
      const opRes = await evalApi.listOperators();
      let count = 0;
      for (const op of opRes.operators) {
        if (op.isBuiltin && op.isOverridden) {
          await evalApi.resetOperatorOverride(op.id);
          count++;
        }
      }
      setMsg({ kind: 'ok', text: `已成功将 ${count} 个内置算子重置为出厂默认参数` });
      if (onRefreshAll) await onRefreshAll();
    } catch (err) {
      setMsg({ kind: 'err', text: '重置算子参数失败: ' + String(err) });
    } finally {
      setResettingOverrides(false);
    }
  };

  // -------------------------------------------------------------
  // Tab 3: 算子组件库与 JSON Schema 扩展插件
  // -------------------------------------------------------------
  const [components, setComponents] = useState<ComponentManifest[]>([]);
  const [compLoading, setCompLoading] = useState(false);
  const [compFilterCategory, setCompFilterCategory] = useState<string>('all');
  const [compSearchQuery, setCompSearchQuery] = useState('');
  const [viewingSchemaComp, setViewingSchemaComp] = useState<ComponentManifest | null>(null);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importJsonText, setImportJsonText] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const loadComponents = async () => {
    setCompLoading(true);
    try {
      const res = await evalApi.listComponents();
      setComponents(res.components || []);
    } catch (err) {
      setMsg({ kind: 'err', text: '加载组件列表失败: ' + String(err) });
    } finally {
      setCompLoading(false);
    }
  };

  const handleDeleteComponent = async (id: string) => {
    if (!window.confirm(`确定要删除扩展组件「${id}」吗？`)) return;
    try {
      const res = await evalApi.deleteComponent(id);
      if (res.ok) {
        setMsg({ kind: 'ok', text: `已成功删除自定义算子组件「${id}」` });
        await loadComponents();
        if (onRefreshAll) await onRefreshAll();
      }
    } catch (err) {
      setMsg({ kind: 'err', text: '删除组件失败: ' + String(err) });
    }
  };

  const handleValidateImport = async () => {
    setImportErrors([]);
    try {
      const parsed = JSON.parse(importJsonText);
      const res = await evalApi.validateComponent(parsed);
      if (!res.valid) {
        setImportErrors(res.errors || ['Schema 结构校验未通过']);
        return false;
      }
      setMsg({ kind: 'ok', text: '组件 JSON Schema 结构校验通过！' });
      return true;
    } catch (err: any) {
      setImportErrors([`JSON 语法解析错误: ${err.message}`]);
      return false;
    }
  };

  const handleImportComponent = async () => {
    setImporting(true);
    setImportErrors([]);
    try {
      const parsed = JSON.parse(importJsonText);
      const res = await evalApi.importComponent(parsed);
      if (res.ok) {
        setMsg({ kind: 'ok', text: `成功导入并注册算子组件「${res.component.name}」(${res.component.id})！` });
        setShowImportPanel(false);
        setImportJsonText('');
        await loadComponents();
        if (onRefreshAll) await onRefreshAll();
      }
    } catch (err: any) {
      setImportErrors([err.message || '导入组件失败']);
    } finally {
      setImporting(false);
    }
  };

  const handleExportComponentJson = (comp: ComponentManifest) => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(comp, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `${comp.id}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleFillTemplate = () => {
    setImportJsonText(
      JSON.stringify(
        {
          id: 'algo_threat_envelope_filter',
          name: '防空威胁包络过滤器',
          version: '1.0.0',
          category: 'spatial',
          categoryLabel: '空间几何',
          engine: 'Python 3.12 / 态势威胁斜距',
          engineType: 'python',
          iconName: 'Compass',
          description: '根据目标与防空实体的三维空间斜距，过滤出侵入威胁包络圈的事件，并计算侵入深度',
          runtime: {
            scriptCode:
              'def evaluate(context):\n    dataset = context.get("dataset", {})\n    rows = dataset.get("rows", [])\n    # 示例过滤逻辑\n    return {\n        "__is_dataframe__": True,\n        "columns": dataset.get("columns", []),\n        "rows": rows\n    }\n',
            timeoutMs: 5000,
          },
          io: {
            inputs: [{ name: 'input_dataset', type: 'dataset', required: true, description: '上游输入事件表' }],
            outputs: [{ name: 'threat_events', type: 'dataset', description: '侵入威胁包络的目标事件' }],
          },
          configSchema: {
            type: 'object',
            required: ['maxThreatDistanceKm'],
            properties: {
              maxThreatDistanceKm: {
                type: 'number',
                title: '最大威胁斜距阈值 (km)',
                default: 45.0,
                minimum: 1.0,
                maximum: 300.0,
                description: '用于判定目标是否进入威胁空域的距离阈值',
              },
              targetSide: {
                type: 'string',
                title: '目标阵营',
                enum: ['Red', 'Blue', 'All'],
                enumNames: ['红方', '蓝方', '所有阵营'],
                default: 'Red',
              },
              autoCleanWeapons: {
                type: 'boolean',
                title: '剔除飞行中的武器',
                default: true,
                description: '严格过滤 UnitType == "武器"，防范导弹误计',
              },
            },
          },
        },
        null,
        2,
      ),
    );
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setImportJsonText(text);
      setShowImportPanel(true);
    };
    reader.readAsText(file);
  };

  // 打开弹窗时初始化数据
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open) {
      if (!dlg.open) dlg.showModal();
      setMsg(null);
      setActiveTab(initialTab);
      void loadSources();
      void loadDatabases();
      void loadComponents();
      evalApi.getHealth().then(setHealthInfo).catch(() => null);
    } else if (dlg.open) {
      dlg.close();
    }
  }, [open, initialTab]);

  const currentRun = runs.find((r) => r.runId === selectedRunId);
  const effectiveActiveSourceId = serverActiveSourceId || activeSourceId;

  const TABS = [
    { id: 'datasources' as const, label: '数据源与测试样本', icon: HardDrive },
    { id: 'database' as const, label: '数据库隔离与存储', icon: Database },
    { id: 'components' as const, label: '算子组件与扩展', icon: Layers },
    { id: 'engine' as const, label: '计算沙箱与算法配置', icon: Cpu },
    { id: 'alerts' as const, label: '研判告警与防骚扰', icon: Bell },
    { id: 'backup' as const, label: '资产备份与出厂重置', icon: Archive },
  ];

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose();
        }
      }}
      className="fixed inset-0 m-auto w-[94vw] max-w-6xl h-[88vh] max-h-[860px] rounded-2xl border border-[#30363d] bg-[#161b22] p-0 text-[#e6edf3] shadow-2xl backdrop:bg-black/75 overflow-hidden flex flex-col"
    >
      {/* 弹窗顶部 Header */}
      <div className="flex items-center justify-between border-b border-[#2a313c] px-6 py-4 bg-[#111622] shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400">
            <Settings className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              系统设置与环境管理控制台
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 font-mono">
                System Console
              </span>
            </h3>
            <p className="text-xs text-[#8b949e] mt-0.5">
              统一管理推演测试数据、物理双库隔离、Python 算法沙箱、实时研判防骚扰策略与资产出厂重置
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-[#8b949e] hover:bg-[#1c2128] hover:text-white transition"
          aria-label="关闭系统设置弹窗"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* 消息提示横条 */}
      {msg && (
        <div
          className={`px-6 py-2.5 text-xs flex items-center justify-between border-b shrink-0 ${
            msg.kind === 'ok'
              ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
              : 'border-rose-500/40 bg-rose-950/40 text-rose-200'
          }`}
        >
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="text-xs opacity-75 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 主工作区：左侧导航 + 右侧内容 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 左侧垂直选项卡导航 */}
        <div className="w-56 border-r border-[#2a313c] bg-[#0d121c] p-3 space-y-1.5 shrink-0 flex flex-col justify-between">
          <div className="space-y-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setMsg(null);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-medium transition text-left ${
                    isActive
                      ? 'bg-blue-600/15 border border-blue-500/40 text-blue-300 font-semibold shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-[#161c28] border border-transparent'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-400' : 'text-slate-400'}`} />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="p-3 rounded-xl border border-slate-800 bg-slate-900/60 text-[10px] text-slate-400 space-y-1">
            <div className="font-semibold text-slate-300">系统内核信息</div>
            <div>Node: {healthInfo?.nodeVersion ?? 'v24.16.0'}</div>
            <div>内置物理算子: 36 项</div>
            <div>双库物理隔离: <span className="text-emerald-400">已就绪</span></div>
          </div>
        </div>

        {/* 右侧设置详情面板 */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 bg-[#161b22] space-y-5">
          {/* ============================================================== */}
          {/* TAB 1: 数据源与测试样本                                          */}
          {/* ============================================================== */}
          {activeTab === 'datasources' && (
            <div className="space-y-5">
              <div>
                <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-purple-400" />
                  推演测试数据源与基准样本
                </h4>
                <p className="text-xs text-[#8b949e] mt-0.5">
                  设定当前用于算子调试、指标回测与体系评估的全局生效数据集。
                </p>
              </div>

              {/* 当前生效样本卡片 */}
              <div className="rounded-xl border border-blue-500/30 bg-blue-950/20 p-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="rounded-md bg-blue-500/20 px-2 py-0.5 font-medium text-blue-300 border border-blue-500/30">
                      当前基准数据
                    </span>
                    <span className="font-semibold text-slate-100 text-sm">
                      {currentRun ? currentRun.scenarioName : selectedRunId || '未配置'}
                    </span>
                    {currentRun && (
                      <span className="font-mono text-[11px] text-[#8b949e]">({currentRun.runId})</span>
                    )}
                  </div>
                  {currentRun && (
                    <div className="flex flex-wrap items-center gap-3.5 text-xs text-slate-300 tabular-nums">
                      <span>单元: <strong className="text-slate-100">{currentRun.unitCount}</strong></span>
                      <span>事件: <strong className="text-slate-100">{currentRun.eventCount}</strong></span>
                      <span>阵营: <strong className="text-slate-100">{currentRun.sides.join(' / ')}</strong></span>
                      <span>时段: {currentRun.startClock} ~ {currentRun.endClock}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 数据源列表 */}
              <div>
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <Database className="h-3.5 w-3.5 text-blue-400" />
                    已挂载数据源 ({dataSources.length})
                  </span>
                  <button
                    type="button"
                    onClick={loadSources}
                    disabled={dsLoading}
                    className="inline-flex items-center gap-1 text-[11px] text-[#8b949e] hover:text-slate-200 transition"
                  >
                    <RefreshCw className={`h-3 w-3 ${dsLoading ? 'animate-spin' : ''}`} />
                    重新检测
                  </button>
                </div>

                <div className="space-y-2.5">
                  {dataSources.map((ds) => {
                    const isActive =
                      ds.source.id === effectiveActiveSourceId ||
                      (ds.importedRunId !== undefined && ds.importedRunId === selectedRunId);
                    const isBusy = activatingId === ds.source.id;
                    return (
                      <div
                        key={ds.source.id}
                        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-3.5 text-xs transition ${
                          isActive
                            ? 'border-emerald-500/50 bg-emerald-950/20 shadow-sm'
                            : ds.accessible
                            ? 'border-[#2a313c] bg-[#0f141a] hover:border-slate-600'
                            : 'border-rose-950/60 bg-rose-950/10 opacity-75'
                        }`}
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                                ds.accessible ? 'bg-emerald-400' : 'bg-rose-500'
                              }`}
                            />
                            <span className="font-semibold text-slate-100 text-sm">{ds.source.name}</span>
                            <span className="rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5 text-[10px] text-blue-300 font-mono">
                              {ds.source.kind === 'csv_dir' ? 'CSV 目录' : 'JSONL 状态帧'}
                            </span>
                            {isActive && (
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-300 border border-emerald-500/30">
                                <CheckCircle2 className="h-3 w-3" />
                                正在使用
                              </span>
                            )}
                          </div>
                          <div className="truncate font-mono text-[11px] text-[#8b949e]" title={ds.source.path}>
                            {ds.source.path}
                          </div>
                          {ds.fileCount !== undefined && (
                            <div className="text-[11px] text-slate-400">
                              {ds.fileCount} 个文件 · 共 {((ds.totalSizeBytes ?? 0) / (1024 * 1024)).toFixed(2)} MB
                            </div>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            disabled={!ds.accessible || isBusy}
                            onClick={() => handleActivate(ds.source.id)}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
                              isActive
                                ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                                : 'border-[#30363d] bg-[#1c2128] text-white hover:border-blue-500 hover:text-blue-200'
                            }`}
                          >
                            {isBusy ? (
                              <>
                                <RefreshCw className="h-3 w-3 animate-spin text-blue-400" />
                                切换中…
                              </>
                            ) : isActive ? (
                              <>
                                <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                                已生效
                              </>
                            ) : (
                              <>
                                <Play className="h-3 w-3 text-emerald-400" />
                                设为当前测试数据
                              </>
                            )}
                          </button>

                          {!ds.source.isBuiltin && (
                            <button
                              type="button"
                              onClick={() => handleDeleteDataSource(ds.source.id)}
                              className="rounded-lg border border-[#30363d] bg-[#0f141a] p-1.5 text-rose-400 hover:border-rose-500"
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

              {/* 探测添加新目录 */}
              <form
                onSubmit={handleAddAndActivate}
                className="rounded-xl border border-[#2a313c] bg-[#0f141a] p-4 space-y-3"
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <Plus className="h-4 w-4 text-blue-400" />
                  挂载本地新仿真目录 / JSONL 文件
                </div>
                <div className="flex flex-wrap gap-2.5">
                  <div className="relative min-w-[280px] flex-1">
                    <Folder className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-[#8b949e]" />
                    <input
                      required
                      value={newPath}
                      onChange={(e) => {
                        setNewPath(e.target.value);
                        if (probe) setProbe(null);
                      }}
                      placeholder="输入 EventExport_CSV 目录或 .jsonl 绝对路径…"
                      className="w-full rounded-lg border border-[#30363d] bg-[#161b22] py-2 pl-9 pr-3 font-mono text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={probing || !newPath.trim()}
                    onClick={handleProbe}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#30363d] bg-[#1c2128] px-3.5 py-2 text-xs text-slate-200 hover:border-blue-500 disabled:opacity-40 transition"
                  >
                    <Eye className="h-3.5 w-3.5 text-blue-400" />
                    {probing ? '探测中…' : '探测'}
                  </button>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="别名（可选）"
                    className="w-48 rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={Boolean(activatingId) || !newPath.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-4 py-2 text-xs font-medium text-emerald-300 hover:border-emerald-400 disabled:opacity-40 transition"
                  >
                    保存并立即生效
                  </button>
                </div>

                {probe && (
                  <div
                    className={`flex items-center gap-2 rounded-lg border p-2.5 text-xs ${
                      probe.accessible
                        ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-200'
                        : 'border-rose-500/40 bg-rose-950/20 text-rose-200'
                    }`}
                  >
                    {probe.accessible ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                        <span>
                          探测通过 · {probe.kind} · {probe.scenarioName ?? '未知想定'} · {probe.fileCount ?? 0} 个文件 (
                          {((probe.totalSizeBytes ?? 0) / (1024 * 1024)).toFixed(2)} MB)
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                        <span>{probe.error || '路径不可访问'}</span>
                      </>
                    )}
                  </div>
                )}
              </form>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 2: 物理双库隔离与多库管理 (通栏无折行大卡片设计)                */}
          {/* ============================================================== */}
          {activeTab === 'database' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <Database className="w-4 h-4 text-cyan-400" />
                    物理双库隔离与底层资产管理
                  </h4>
                  <p className="text-xs text-[#8b949e] mt-0.5">
                    算子知识库 (operators.db) 与想定推演库 (scenario.db) 分别连接独立的 SQLite 数据库文件，支持热切换、克隆、导入与导出。
                  </p>
                </div>

                <div className="inline-flex rounded-lg border border-slate-800 bg-[#0d121c] p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setDbViewMode('both')}
                    className={`px-3 py-1 rounded-md transition font-medium ${
                      dbViewMode === 'both' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    双库通览
                  </button>
                  <button
                    type="button"
                    onClick={() => setDbViewMode('operator')}
                    className={`px-3 py-1 rounded-md transition font-medium ${
                      dbViewMode === 'operator' ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    仅三库标准资产
                  </button>
                  <button
                    type="button"
                    onClick={() => setDbViewMode('scenario')}
                    className={`px-3 py-1 rounded-md transition font-medium ${
                      dbViewMode === 'scenario' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    仅想定推演资产
                  </button>
                </div>
              </div>

              {/* 卡片 1: 三库标准资产 (算子 / 指标 / 体系) - 通栏宽敞设计 */}
              {(dbViewMode === 'both' || dbViewMode === 'operator') && (
                <div className="rounded-xl border border-cyan-500/30 bg-[#161b22] p-5 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2a313c] pb-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-500/15 text-cyan-300">
                      <Cpu className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-100">三库标准资产（算子 / 指标 / 体系）</h3>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/15 px-2.5 py-0.5 text-xs font-medium text-cyan-300 border border-cyan-500/30">
                          <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                          已挂载: {activeOperatorDbName || 'operators.db'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-[#8b949e]">
                        物理路径: <span className="font-mono text-slate-300">{operatorDbStats?.dbPath ?? 'operators.db'}</span>
                        {operatorDbStats?.dbBytes ? ` (${operatorDbStats.dbBytes >= 1024 * 1024 ? `${(operatorDbStats.dbBytes / (1024 * 1024)).toFixed(2)} MB` : `${(operatorDbStats.dbBytes / 1024).toFixed(1)} KB`})` : ''}
                      </p>
                    </div>
                  </div>

                  <span className="rounded-md bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-300 border border-cyan-500/25 font-mono">
                    三库物理统一封装
                  </span>
                </div>

                {/* 切换与操作栏 (水平通畅，杜绝折行) */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0f141a] p-3 rounded-xl border border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-300 whitespace-nowrap">切换标准库:</span>
                    <select
                      value={activeOperatorDbName}
                      onChange={(e) => handleSwitchDatabase(e.target.value, 'operator')}
                      disabled={switchingDb}
                      className="h-8 rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-1 text-xs text-cyan-300 font-mono outline-none focus:border-cyan-500 disabled:opacity-50 min-w-[200px]"
                    >
                      {operatorDbs.map((db) => (
                        <option key={db.filename} value={db.filename}>
                          {db.filename} {db.isActive ? '(当前库)' : `(${(db.fileSize / 1024).toFixed(0)} KB)`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setModalInputName(''); setTemplateChoice('empty'); setDbModal({ action: 'create', type: 'operator' }); }}
                      disabled={switchingDb}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 transition whitespace-nowrap"
                      title="新建三库标准知识库"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      新建
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setModalInputName(`${activeOperatorDbName.replace(/\.db$/, '')}-v2`);
                        setDbModal({ action: 'clone', type: 'operator' });
                      }}
                      disabled={switchingDb}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#30363d] bg-[#21262d] px-3 text-xs text-slate-200 hover:bg-[#30363d] transition whitespace-nowrap"
                      title="克隆当前三库标准库"
                    >
                      <Copy className="h-3.5 w-3.5 text-amber-400" />
                      克隆
                    </button>

                    <a
                      href={evalApi.getDatabaseExportUrl('operator')}
                      download
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#30363d] bg-[#21262d] px-3 text-xs text-slate-200 hover:bg-[#30363d] transition whitespace-nowrap"
                      title="导出当前三库标准库 (.db)"
                    >
                      <Download className="h-3.5 w-3.5 text-blue-400" />
                      导出
                    </a>

                    <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[#30363d] bg-[#21262d] px-3 text-xs text-slate-200 hover:bg-[#30363d] transition whitespace-nowrap">
                      <Upload className="h-3.5 w-3.5 text-emerald-400" />
                      导入
                      <input
                        type="file"
                        accept=".db,.sqlite,.sqlite3"
                        className="sr-only"
                        disabled={isUploadingDb || switchingDb}
                        onChange={(e) => handleUploadDbFile(e, 'operator')}
                      />
                    </label>
                  </div>
                </div>

                {/* 算子库统计指标 (宽敞 5 栏，无重叠) */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="rounded-xl border border-[#2a313c] bg-[#0d1117] p-3 text-center">
                    <span className="text-xs text-[#8b949e] block">核心物理算子</span>
                    <p className="tabular-nums text-lg font-bold text-cyan-300 mt-1">
                      {operatorDbStats?.counts?.builtinOperators ?? 36} 项
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#2a313c] bg-[#0d1117] p-3 text-center">
                    <span className="text-xs text-[#8b949e] block">自定义算子</span>
                    <p className="tabular-nums text-lg font-bold text-blue-300 mt-1">
                      {operatorDbStats?.counts?.customOperators ?? 0} 个
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#2a313c] bg-[#0d1117] p-3 text-center">
                    <span className="text-xs text-[#8b949e] block">专属画布流水线</span>
                    <p className="tabular-nums text-lg font-bold text-indigo-300 mt-1">
                      {operatorDbStats?.counts?.operatorPipelines ?? 39} 条
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#2a313c] bg-[#0d1117] p-3 text-center">
                    <span className="text-xs text-[#8b949e] block">评估指标定义</span>
                    <p className="tabular-nums text-lg font-bold text-emerald-300 mt-1">
                      {operatorDbStats?.counts?.indicators ?? 36} 个
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#2a313c] bg-[#0d1117] p-3 text-center">
                    <span className="text-xs text-[#8b949e] block">评估体系树</span>
                    <p className="tabular-nums text-lg font-bold text-purple-300 mt-1">
                      {operatorDbStats?.counts?.systems ?? 4} 套
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-xs text-[#8b949e] leading-relaxed">
                  <strong className="text-cyan-300">三库一体化存储：</strong> 严格收敛一库物理算子、专属画布 DAG 拓扑图、二库指标定义与三库评估体系树权重。三库在当前库内物理统一闭环，零夹带推演运行数据，跨不同想定通用共享。
                </div>
              </div>
              )}

              {/* 卡片 2: 想定推演数据资产 - 通栏宽敞设计 */}
              {(dbViewMode === 'both' || dbViewMode === 'scenario') && (
                <div className="rounded-xl border border-emerald-500/30 bg-[#161b22] p-5 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2a313c] pb-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-500/15 text-emerald-300">
                      <Database className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-100">想定推演数据资产</h3>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-300 border border-emerald-500/30">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          已挂载: {activeScenarioDbName || 'scenario-full-sample.db'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-[#8b949e]">
                        物理路径: <span className="font-mono text-slate-300">{scenarioDbStats?.dbPath ?? 'eval.db'}</span>
                        {scenarioDbStats?.dbBytes ? ` (${scenarioDbStats.dbBytes >= 1024 * 1024 ? `${(scenarioDbStats.dbBytes / (1024 * 1024)).toFixed(2)} MB` : `${(scenarioDbStats.dbBytes / 1024).toFixed(1)} KB`})` : ''}
                      </p>
                    </div>
                  </div>

                  <span className="rounded-md bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300 border border-emerald-500/25 font-mono">
                    推演航迹与事件
                  </span>
                </div>

                {/* 切换与操作栏 (水平通畅，杜绝单字折行) */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0f141a] p-3 rounded-xl border border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-300 whitespace-nowrap">切换想定库:</span>
                    <select
                      value={activeScenarioDbName}
                      onChange={(e) => handleSwitchDatabase(e.target.value, 'scenario')}
                      disabled={switchingDb}
                      className="h-8 rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-1 text-xs text-emerald-300 font-mono outline-none focus:border-emerald-500 disabled:opacity-50 min-w-[200px]"
                    >
                      {scenarioDbs.map((db) => (
                        <option key={db.filename} value={db.filename}>
                          {db.filename} {db.isActive ? '(当前库)' : `(${(db.fileSize / 1024).toFixed(0)} KB)`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleLoadBuiltinSamples}
                      disabled={importingSamples || switchingDb}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25 transition whitespace-nowrap"
                      title="手动导入预置的 GJ-11 与 BS 集群样例推演数据"
                    >
                      <FileUp className="h-3.5 w-3.5 text-emerald-400" />
                      {importingSamples ? '加载中...' : '加载内置样例'}
                    </button>

                    <button
                      type="button"
                      onClick={() => { setModalInputName(''); setDbModal({ action: 'create', type: 'scenario' }); }}
                      disabled={switchingDb}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 transition whitespace-nowrap"
                      title="新建空白想定推演数据库"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      新建
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setModalInputName(`${activeScenarioDbName.replace(/\.db$/, '')}-copy`);
                        setDbModal({ action: 'clone', type: 'scenario' });
                      }}
                      disabled={switchingDb}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#30363d] bg-[#21262d] px-3 text-xs text-slate-200 hover:bg-[#30363d] transition whitespace-nowrap"
                      title="克隆当前想定数据库"
                    >
                      <Copy className="h-3.5 w-3.5 text-amber-400" />
                      克隆
                    </button>

                    <a
                      href={evalApi.getDatabaseExportUrl('scenario')}
                      download
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#30363d] bg-[#21262d] px-3 text-xs text-slate-200 hover:bg-[#30363d] transition whitespace-nowrap"
                      title="导出当前想定库 (.db)"
                    >
                      <Download className="h-3.5 w-3.5 text-blue-400" />
                      导出
                    </a>

                    <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[#30363d] bg-[#21262d] px-3 text-xs text-slate-200 hover:bg-[#30363d] transition whitespace-nowrap">
                      <Upload className="h-3.5 w-3.5 text-emerald-400" />
                      导入
                      <input
                        type="file"
                        accept=".db,.sqlite,.sqlite3"
                        className="sr-only"
                        disabled={isUploadingDb || switchingDb}
                        onChange={(e) => handleUploadDbFile(e, 'scenario')}
                      />
                    </label>
                  </div>
                </div>

                {/* 想定数据统计指标 (宽敞 5 栏，无折行) */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="rounded-xl border border-[#2a313c] bg-[#0d1117] p-3 text-center">
                    <span className="text-xs text-[#8b949e] block">推演局数 (Runs)</span>
                    <p className="tabular-nums text-lg font-bold text-blue-300 mt-1">
                      {scenarioDbStats?.counts?.runs ?? runs.length} 场
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#2a313c] bg-[#0d1117] p-3 text-center">
                    <span className="text-xs text-[#8b949e] block">事件记录 (Events)</span>
                    <p className="tabular-nums text-lg font-bold text-slate-100 mt-1">
                      {scenarioDbStats?.counts?.events ?? 0} 条
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#2a313c] bg-[#0d1117] p-3 text-center">
                    <span className="text-xs text-[#8b949e] block">轨迹状态点</span>
                    <p className="tabular-nums text-lg font-bold text-emerald-300 mt-1">
                      {scenarioDbStats?.counts?.unitStates ?? 0} 点
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#2a313c] bg-[#0d1117] p-3 text-center">
                    <span className="text-xs text-[#8b949e] block">评估结果快照</span>
                    <p className="tabular-nums text-lg font-bold text-amber-300 mt-1">
                      {scenarioDbStats?.counts?.evaluations ?? 0} 份
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#2a313c] bg-[#0d1117] p-3 text-center">
                    <span className="text-xs text-[#8b949e] block">实时研判卡片</span>
                    <p className="tabular-nums text-lg font-bold text-purple-300 mt-1">
                      {scenarioDbStats?.counts?.realtimeCards ?? 0} 张
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-[#8b949e] leading-relaxed">
                  <strong className="text-emerald-300">独立推演资产：</strong> 仅承载推演局次、航迹经纬度与 44 类实测事件链及评估得分，重置或清空当前想定库不会对算子库造成任何副作用。
                </div>
              </div>
              )}

              {/* 底部存储解耦架构说明 */}
              <div className="rounded-xl border border-blue-500/25 bg-[#0d1117] p-3.5 text-xs text-[#8b949e] leading-relaxed">
                <strong className="text-blue-300">存储隔离架构：</strong>
                知识资产库（<span className="font-mono text-cyan-300">{activeOperatorDbName}</span>）与推演运行数据（<span className="font-mono text-emerald-300">{activeScenarioDbName}</span>）分别挂载独立的 SQLite 数据库文件。推演场次切换、数据重置或导入仅在想定数据层生效，36 项核心物理算子、画布 DAG 流水线与指标体系树保持独立存储与物理隔离。
              </div>

              {/* 嵌套新建/克隆对话框 */}
              {dbModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
                  <div className="w-full max-w-lg rounded-2xl border border-[#30363d] bg-[#161b22] p-5 shadow-2xl space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-[#2a313c]">
                      <h4 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                        {dbModal.type === 'operator' ? (
                          <Cpu className="h-4 w-4 text-cyan-400" />
                        ) : (
                          <Database className="h-4 w-4 text-emerald-400" />
                        )}
                        {dbModal.action === 'create'
                          ? dbModal.type === 'operator'
                            ? '新建三库标准知识库 (算子 / 指标 / 体系)'
                            : '新建空白想定推演数据库'
                          : dbModal.type === 'operator'
                          ? '克隆当前三库标准知识库'
                          : '克隆当前想定推演库'}
                      </h4>
                      <button
                        type="button"
                        onClick={() => setDbModal(null)}
                        className="text-slate-400 hover:text-slate-200"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="space-y-3 text-xs">
                      <div>
                        <label className="block text-slate-300 font-medium mb-1">数据库文件名 (.db):</label>
                        <input
                          autoFocus
                          value={modalInputName}
                          onChange={(e) => setModalInputName(e.target.value)}
                          placeholder={dbModal.type === 'operator' ? 'operators-custom.db' : 'scenario-mission-2026.db'}
                          className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                        />
                      </div>

                      {dbModal.action === 'create' && dbModal.type === 'operator' && (
                        <div>
                          <label className="block text-slate-300 font-medium mb-1.5">初始化模版选择:</label>
                          <div className="grid grid-cols-2 gap-2">
                            <div
                              onClick={() => setTemplateChoice('empty')}
                              className={`cursor-pointer rounded-lg border p-2.5 transition ${
                                templateChoice === 'empty'
                                  ? 'border-cyan-500 bg-cyan-500/10 text-cyan-200'
                                  : 'border-[#30363d] bg-[#0d1117] text-slate-400'
                              }`}
                            >
                              <div className="font-medium text-slate-200">全新空白库</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">从零自定义新领域算子</div>
                            </div>
                            <div
                              onClick={() => setTemplateChoice('standard')}
                              className={`cursor-pointer rounded-lg border p-2.5 transition ${
                                templateChoice === 'standard'
                                  ? 'border-cyan-500 bg-cyan-500/10 text-cyan-200'
                                  : 'border-[#30363d] bg-[#0d1117] text-slate-400'
                              }`}
                            >
                              <div className="font-medium text-slate-200">预置军标模版</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">包含36物理算子+4体系</div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#2a313c]">
                      <button
                        type="button"
                        onClick={() => setDbModal(null)}
                        className="rounded-lg border border-[#30363d] bg-[#21262d] px-3.5 py-1.5 text-xs text-slate-300 hover:bg-[#30363d]"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        disabled={!modalInputName.trim() || switchingDb}
                        onClick={() => {
                          if (dbModal.action === 'create') {
                            void handleCreateDatabase(dbModal.type);
                          } else {
                            void handleCloneDatabase(dbModal.type);
                          }
                        }}
                        className={`rounded-lg px-4 py-1.5 text-xs font-medium text-white transition disabled:opacity-50 ${
                          dbModal.type === 'operator'
                            ? 'bg-cyan-600 hover:bg-cyan-500'
                            : 'bg-emerald-600 hover:bg-emerald-500'
                        }`}
                      >
                        {switchingDb ? '处理中…' : dbModal.action === 'create' ? '立即创建并切换' : '立即克隆并切换'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 3: 算子组件库与 JSON Schema 扩展插件                          */}
          {/* ============================================================== */}
          {activeTab === 'components' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-sky-400" />
                    算子组件库与算法插件注册中心
                    <span className="text-xs px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 font-mono">
                      已注册 {components.length} 项组件
                    </span>
                  </h4>
                  <p className="text-xs text-[#8b949e] mt-0.5">
                    一库原子算子流水线的计算积木块。支持通过标准 JSON Schema 规范导入第三方自定义算法组件（Python/公式/HTTP 微服务）。
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!showImportPanel && !importJsonText.trim()) {
                        handleFillTemplate();
                      }
                      setShowImportPanel(!showImportPanel);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-600/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-600/30 transition shadow-sm"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>{showImportPanel ? '收起导入面板' : '➕ 导入 / 注册新组件'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={loadComponents}
                    disabled={compLoading}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white transition"
                    title="重新获取最新组件清单"
                  >
                    <RefreshCw className={`h-3 w-3 ${compLoading ? 'animate-spin' : ''}`} />
                    <span>刷新</span>
                  </button>
                </div>
              </div>

              {/* 导入 / 注册新组件面板 */}
              {showImportPanel && (
                <div className="rounded-xl border border-emerald-500/40 bg-[#0d1424] p-4 space-y-3.5 shadow-lg">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                    <div className="flex items-center gap-2">
                      <FileUp className="h-4 w-4 text-emerald-400" />
                      <span className="text-xs font-bold text-slate-100">
                        基于 JSON Schema 注册扩展组件
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        (Zero-UI Coding 契约驱动)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="cursor-pointer inline-flex items-center gap-1 rounded bg-slate-800 border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:text-white">
                        <Upload className="h-3 w-3" />
                        <span>上传 .json 文件</span>
                        <input
                          type="file"
                          accept=".json,application/json"
                          onChange={handleFileUpload}
                          className="hidden"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={handleFillTemplate}
                        className="rounded bg-sky-950/60 border border-sky-800 px-2 py-1 text-[11px] text-sky-300 hover:bg-sky-900/60"
                      >
                        填入示例模板
                      </button>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400">
                    在下方粘贴符合组件规范的 Manifest JSON（需包含 <code>id</code>、<code>name</code>、<code>category</code> 及 <code>configSchema</code>）。注册后将自动在画布工具箱和算子流水线中生效。
                  </p>

                  <textarea
                    rows={10}
                    value={importJsonText}
                    onChange={(e) => setImportJsonText(e.target.value)}
                    placeholder="在此粘贴组件 JSON 规范定义..."
                    className="w-full rounded-lg border border-slate-700 bg-[#070b14] p-3 text-xs font-mono text-cyan-200 focus:outline-none focus:border-emerald-500"
                  />

                  {importErrors.length > 0 && (
                    <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-2.5 text-xs text-rose-300 space-y-1">
                      <div className="font-semibold flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span>校验未通过：</span>
                      </div>
                      <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                        {importErrors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={handleValidateImport}
                      className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:text-white"
                    >
                      校验 Schema 语法
                    </button>
                    <button
                      type="button"
                      disabled={importing || !importJsonText.trim()}
                      onClick={handleImportComponent}
                      className="rounded-lg border border-emerald-500/50 bg-emerald-600/30 px-4 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-600/50 transition disabled:opacity-50"
                    >
                      {importing ? '正在注册…' : '🚀 确认导入并激活组件'}
                    </button>
                  </div>
                </div>
              )}

              {/* 搜索与分类筛选条 */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {[
                    { id: 'all', label: '全部组件' },
                    { id: 'data_input', label: '数据输入' },
                    { id: 'inline_calc', label: '行内计算' },
                    { id: 'group_agg', label: '跨行聚合' },
                    { id: 'spatial', label: '空间几何' },
                    { id: 'python_script', label: 'Python 脚本' },
                    { id: 'custom', label: '自定义扩展' },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCompFilterCategory(cat.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                        compFilterCategory === cat.id
                          ? 'bg-sky-600 text-white shadow-sm'
                          : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 border border-slate-700/60'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                <div className="relative w-56">
                  <input
                    type="text"
                    value={compSearchQuery}
                    onChange={(e) => setCompSearchQuery(e.target.value)}
                    placeholder="搜索组件名称或标识..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
                  />
                  {compSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setCompSearchQuery('')}
                      className="absolute right-2 top-2 text-slate-400 hover:text-white"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* 组件卡片网格列表 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {components
                  .filter((comp) => {
                    if (compFilterCategory !== 'all') {
                      if (compFilterCategory === 'custom' && !comp.isCustom) return false;
                      if (compFilterCategory !== 'custom' && comp.category !== compFilterCategory) return false;
                    }
                    if (compSearchQuery.trim()) {
                      const q = compSearchQuery.toLowerCase();
                      return (
                        comp.name.toLowerCase().includes(q) ||
                        comp.id.toLowerCase().includes(q) ||
                        comp.description.toLowerCase().includes(q)
                      );
                    }
                    return true;
                  })
                  .map((comp) => {
                    const propKeys = Object.keys(comp.configSchema?.properties || {});
                    return (
                      <div
                        key={comp.id}
                        className={`rounded-xl border p-4 transition space-y-3 shadow-sm ${
                          comp.isCustom
                            ? 'border-purple-500/40 bg-purple-950/15'
                            : 'border-slate-800 bg-[#0d121c] hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`p-2 rounded-xl border text-sky-400 ${
                                comp.isCustom
                                  ? 'bg-purple-500/15 border-purple-500/30 text-purple-300'
                                  : 'bg-sky-500/15 border-sky-500/30'
                              }`}
                            >
                              <Layers className="h-4 w-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <h5 className="font-bold text-xs text-slate-100">{comp.name}</h5>
                                {comp.isCustom ? (
                                  <span className="rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 px-1.5 py-0.2 text-[9px] font-semibold">
                                    扩展插件
                                  </span>
                                ) : (
                                  <span className="rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.2 text-[9px] font-semibold">
                                    核心内置
                                  </span>
                                )}
                              </div>
                              <div className="font-mono text-[10px] text-slate-500">{comp.id}</div>
                            </div>
                          </div>

                          <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 font-mono">
                            v{comp.version || '1.0.0'}
                          </span>
                        </div>

                        <p className="text-xs text-slate-300 leading-relaxed line-clamp-2">
                          {comp.description}
                        </p>

                        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800/80 text-[11px] text-slate-400">
                          <span className="rounded bg-slate-900 border border-slate-800 px-2 py-0.5 text-slate-300">
                            引擎: {comp.engine}
                          </span>
                          <span className="rounded bg-slate-900 border border-slate-800 px-2 py-0.5 text-slate-300">
                            Schema 属性: {propKeys.length} 个
                          </span>
                        </div>

                        {/* 卡片操作按钮 */}
                        <div className="flex items-center justify-between pt-1">
                          <button
                            type="button"
                            onClick={() =>
                              setViewingSchemaComp(viewingSchemaComp?.id === comp.id ? null : comp)
                            }
                            className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300"
                          >
                            <Eye className="h-3 w-3" />
                            <span>{viewingSchemaComp?.id === comp.id ? '收起 Schema 契约' : '查看 Schema 契约'}</span>
                          </button>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleExportComponentJson(comp)}
                              className="inline-flex items-center gap-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 px-2 py-1 transition"
                              title="导出此组件的 Schema JSON 定义文件"
                            >
                              <Download className="h-3 w-3" />
                              <span>导出</span>
                            </button>
                            {comp.isCustom && (
                              <button
                                type="button"
                                onClick={() => handleDeleteComponent(comp.id)}
                                className="inline-flex items-center gap-1 rounded bg-rose-950/50 hover:bg-rose-900/50 text-[11px] text-rose-300 px-2 py-1 border border-rose-800/40 transition"
                                title="删除此自定义扩展组件"
                              >
                                <Trash2 className="h-3 w-3" />
                                <span>删除</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* 展开查看 Schema 契约定义 */}
                        {viewingSchemaComp?.id === comp.id && (
                          <div className="mt-2 rounded-lg bg-[#070b14] border border-slate-800 p-3 space-y-2 text-[11px]">
                            <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-1 font-mono">
                              <span>Schema JSON 详情:</span>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(JSON.stringify(comp, null, 2));
                                  setMsg({ kind: 'ok', text: `已复制「${comp.id}」的 JSON 规范到剪贴板！` });
                                }}
                                className="text-sky-400 hover:text-sky-300 text-[10px]"
                              >
                                复制 JSON
                              </button>
                            </div>
                            <pre className="max-h-48 overflow-y-auto text-[10px] font-mono text-cyan-300 whitespace-pre">
                              {JSON.stringify(comp.configSchema, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 4: 计算沙箱与算法引擎                                        */}
          {/* ============================================================== */}
          {activeTab === 'engine' && (
            <div className="space-y-5">
              <div>
                <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-emerald-400" />
                  计算沙箱与 MCDA 算法引擎
                </h4>
                <p className="text-xs text-[#8b949e] mt-0.5">
                  配置 Python NumPy/SciPy 算法沙箱隔离执行参数及 MCDA 多准则综合赋权默认偏好。
                </p>
              </div>

              {/* Python 沙箱连通性测试 */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4.5 h-4.5 text-emerald-400" />
                    <span className="text-xs font-semibold text-slate-200">
                      Python 3 算法沙箱连通性
                    </span>
                  </div>
                  <button
                    onClick={testPythonSandbox}
                    disabled={pythonTesting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-emerald-600/25 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/35 transition"
                  >
                    <Play className={`w-3.5 h-3.5 ${pythonTesting ? 'animate-spin' : ''}`} />
                    {pythonTesting ? '测试中…' : '即时自检沙箱'}
                  </button>
                </div>

                <div className="flex items-center gap-3 text-xs text-slate-300">
                  <label className="flex items-center gap-2">
                    <span>沙箱超时阈值 (秒):</span>
                    <input
                      type="number"
                      min={3}
                      max={60}
                      value={sandboxTimeout}
                      onChange={(e) => setSandboxTimeout(Number(e.target.value))}
                      className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-center text-slate-100"
                    />
                  </label>
                  <span className="text-[11px] text-slate-500">
                    用于保护自定义算子与大矩阵计算免于死循环
                  </span>
                </div>

                {pythonResult && (
                  <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-emerald-300/90 whitespace-pre">
                    {JSON.stringify(pythonResult, null, 2)}
                  </pre>
                )}
              </div>

              {/* MCDA 多准则决策偏好 */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3.5">
                <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-blue-400" />
                  <span>MCDA 客观赋权与折中排序默认偏好</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="space-y-1.5">
                    <label className="text-slate-400 text-[11px]">默认客观赋权算法:</label>
                    <select
                      value={mcdaObjectiveMethod}
                      onChange={(e) => setMcdaObjectiveMethod(e.target.value as any)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"
                    >
                      <option value="critic">CRITIC 客观赋权法 (兼顾对比强度与冲突性)</option>
                      <option value="entropy">熵权法 (Shannon Entropy 信息离散度)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-slate-400 text-[11px]">
                      主客观组合赋权平衡因子 $\alpha$ ({mcdaAlpha}):
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.1}
                      value={mcdaAlpha}
                      onChange={(e) => setMcdaAlpha(Number(e.target.value))}
                      className="w-full accent-blue-500"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500">
                      <span>0.0 (纯客观)</span>
                      <span>0.5 (对半平衡)</span>
                      <span>1.0 (纯主观AHP)</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5 pt-1 text-xs">
                  <label className="text-slate-400 text-[11px]">
                    VIKOR 折中排序群体效用最大化权重 $v$ ({vikorV}):
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={vikorV}
                    onChange={(e) => setVikorV(Number(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>v &gt; 0.5 (倾向群体多数利益最大化)</span>
                    <span>v = 0.5 (折中协商)</span>
                    <span>v &lt; 0.5 (倾向个别反对意见否决)</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 4: 实时研判告警与防骚扰抗噪策略                              */}
          {/* ============================================================== */}
          {activeTab === 'alerts' && (
            <div className="space-y-5">
              <div>
                <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Bell className="w-4 h-4 text-amber-400" />
                  实时伴随研判告警与防骚扰抗噪策略
                </h4>
                <p className="text-xs text-[#8b949e] mt-0.5">
                  遵循 Q-109 实时研判抗噪规范，规避高频仿真帧引起的告警风暴。
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4 text-xs">
                {/* 1. 防骚扰抑制窗口 */}
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-200 flex items-center justify-between">
                    <span>同一战术单元同类告警抑制窗口 (静音冷却):</span>
                    <span className="font-mono text-amber-300">{suppressWindowSec} 秒</span>
                  </label>
                  <input
                    type="range"
                    min={5}
                    max={120}
                    step={5}
                    value={suppressWindowSec}
                    onChange={(e) => setSuppressWindowSec(Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                  <p className="text-[11px] text-slate-400">
                    在设定的推演时钟窗口内，同一单元的相同指标超限仅触发一次卡片提醒，后续重复帧自动合并记数。
                  </p>
                </div>

                {/* 2. 严重度等级过滤 */}
                <div className="pt-2 border-t border-slate-800/80">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filterMinorAlerts}
                      onChange={(e) => setFilterMinorAlerts(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 accent-blue-500"
                    />
                    <span className="text-slate-200 font-medium">
                      屏蔽次要预警 (Minor Alerts)，仅对重大战术威胁 (Major Alerts) 弹出通知
                    </span>
                  </label>
                  <p className="text-[11px] text-slate-400 ml-5 mt-0.5">
                    开启后，低风险偏航或微小传感器抖动将静默记录，主画面不被打扰。
                  </p>
                </div>

                {/* 3. 人机协同默认处理状态 */}
                <div className="pt-2 border-t border-slate-800/80 space-y-1">
                  <label className="font-semibold text-slate-200">
                    人机协同 (HITL) 新告警默认初始状态:
                  </label>
                  <select
                    value={defaultHitlAction}
                    onChange={(e) => setDefaultHitlAction(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"
                  >
                    <option value="pending">待处置 (Pending - 需推演指挥员手动确认)</option>
                    <option value="observe">持续观察 (Observe - 系统自动纳入观察队列)</option>
                    <option value="pause_inspect">自动暂停复盘 (Pause - 遇到重大告警即刻暂停推演)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 5: 资产备份与出厂重置                                        */}
          {/* ============================================================== */}
          {activeTab === 'backup' && (
            <div className="space-y-5">
              <div>
                <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Archive className="w-4 h-4 text-emerald-400" />
                  三库资产备份、导出与出厂重置
                </h4>
                <p className="text-xs text-[#8b949e] mt-0.5">
                  统一导出「一库算子/流水线」、「二库指标库」与「三库评估体系树」，支持跨机迁移与出厂重置。
                </p>
              </div>

              {/* 导出全量资产 */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-slate-200">
                      导出全套评估资产 (JSON)
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      包含当前全部自定义算子蓝图、指标评分曲线与多套体系权重树。
                    </div>
                  </div>
                  <button
                    onClick={handleExportAllAssets}
                    disabled={exportingAssets}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-emerald-600/30 border border-emerald-500/50 text-emerald-300 hover:bg-emerald-600/40 transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {exportingAssets ? '打包中…' : '导出全部资产包'}
                  </button>
                </div>
              </div>

              {/* 出厂重置与覆盖清理 */}
              <div className="rounded-xl border border-rose-500/30 bg-rose-950/10 p-4 space-y-3">
                <div>
                  <div className="text-xs font-semibold text-rose-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                    出厂设置恢复与参数覆盖清除
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    清除用户对 36 个内置算子所做的所有参数微调与蓝图覆盖，100% 恢复至系统出厂基线。
                  </div>
                </div>

                <div className="pt-1">
                  <button
                    onClick={handleResetOverrides}
                    disabled={resettingOverrides}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-rose-600/25 border border-rose-500/40 text-rose-200 hover:bg-rose-600/35 transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {resettingOverrides ? '重置中…' : '恢复内置算子出厂默认参数'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 弹窗底部操作条 (永远置底，无裁剪) */}
      <div className="flex items-center justify-between border-t border-[#2a313c] px-6 py-3.5 bg-[#111622] text-xs shrink-0">
        {onNavigateToExplorer && activeTab === 'datasources' ? (
          <button
            type="button"
            onClick={() => {
              onClose();
              onNavigateToExplorer();
            }}
            className="text-purple-400 hover:text-purple-300 transition flex items-center gap-1"
          >
            <span>前往「推演数据」深入查看 44 表物理源文件与航迹明细</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        ) : (
          <span className="text-[11px] text-slate-500 font-mono">
            配置修改即时存盘至 SQLite 与服务端配置文件
          </span>
        )}

        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[#30363d] bg-[#1c2128] px-4 py-2 text-xs text-slate-200 hover:border-slate-500 transition font-medium"
        >
          完成并关闭
        </button>
      </div>
    </dialog>
  );
}
