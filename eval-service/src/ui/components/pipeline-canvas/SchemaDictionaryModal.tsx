import React, { useState, useMemo } from 'react';
import {
  BookOpen,
  Check,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  Info,
  RefreshCw,
  Search,
  Tag,
  Upload,
  X,
} from 'lucide-react';
import {
  ALL_SPEC_EVENTS,
  type CatalogTableSpec,
  type CatalogFieldItem,
} from './schema-catalog.ts';
import { evalApi } from '../../api.ts';

interface SchemaDictionaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  catalogList: CatalogTableSpec[];
  onUpdateCatalog: (newCatalog: CatalogTableSpec[]) => void;
}

export function SchemaDictionaryModal({
  isOpen,
  onClose,
  catalogList,
  onUpdateCatalog,
}: SchemaDictionaryModalProps) {
  if (!isOpen) return null;

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedTableId, setSelectedTableId] = useState<string>(
    catalogList[0]?.id || 'UnitPositions.csv'
  );
  const [importStatus, setImportStatus] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  // 提取分类列表
  const categories = useMemo(() => {
    const set = new Set<string>();
    catalogList.forEach((t) => {
      if (t.category) set.add(t.category);
    });
    return Array.from(set);
  }, [catalogList]);

  // 过滤后的数据表列表
  const filteredTables = useMemo(() => {
    return catalogList.filter((table) => {
      const matchCat =
        selectedCategory === 'ALL' || table.category === selectedCategory;
      if (!matchCat) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const matchName =
        table.name.toLowerCase().includes(q) ||
        table.id.toLowerCase().includes(q);
      const matchField = table.fields.some(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          (f.note && f.note.toLowerCase().includes(q))
      );
      return matchName || matchField;
    });
  }, [catalogList, selectedCategory, searchQuery]);

  const activeTable = useMemo(() => {
    return (
      catalogList.find((t) => t.id === selectedTableId) ||
      filteredTables[0] ||
      catalogList[0]
    );
  }, [catalogList, selectedTableId, filteredTables]);

  // 导出 JSON
  const handleExportJson = () => {
    const payload = {
      version: '1.0.0',
      title: 'F1 官方仿真规范事件表与物理字段元数据字典全集',
      exportedAt: new Date().toISOString(),
      totalTables: catalogList.length,
      tables: catalogList,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `f1-simulation-schema-catalog-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 导入外部 JSON
  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result as string;
        const parsed = JSON.parse(text);

        let importedTables: CatalogTableSpec[] = [];
        if (Array.isArray(parsed)) {
          importedTables = parsed;
        } else if (parsed && Array.isArray(parsed.tables)) {
          importedTables = parsed.tables;
        } else {
          throw new Error('未识别的 JSON 规范字典格式：需包含 tables 数组或表定义列表');
        }

        if (importedTables.length === 0) {
          throw new Error('导入的规范字典为空！');
        }

        setIsSaving(true);
        // 保存至后端持久化
        await evalApi.saveSchemaCatalog({
          version: '1.0.0',
          title: parsed.title || '自定义导入仿真规范字典',
          updatedAt: new Date().toISOString(),
          tables: importedTables,
        });

        onUpdateCatalog(importedTables);
        setImportStatus(`✅ 成功导入并持久化 ${importedTables.length} 个规范事件表！`);
        setTimeout(() => setImportStatus(''), 4000);
      } catch (err) {
        setImportStatus(`❌ 导入失败: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsSaving(false);
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  // 恢复内置官方默认规范
  const handleResetDefaults = async () => {
    if (!confirm('确定要恢复为内置官方 46 类规范事件表定义吗？')) return;
    setIsSaving(true);
    try {
      await evalApi.saveSchemaCatalog({
        version: '1.0.0',
        title: 'F1 官方仿真规范事件表与物理字段元数据字典全集',
        updatedAt: new Date().toISOString(),
        tables: ALL_SPEC_EVENTS,
      });
      onUpdateCatalog(ALL_SPEC_EVENTS);
      setImportStatus('✅ 已成功恢复官方默认 46 类规范字典！');
      setTimeout(() => setImportStatus(''), 3000);
    } catch (err) {
      setImportStatus(`❌ 恢复失败: ${String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-sans animate-in fade-in duration-200">
      <div className="flex h-[88vh] w-[92vw] max-w-7xl flex-col rounded-2xl border border-slate-700 bg-[#0b1120] text-slate-100 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex h-16 items-center justify-between border-b border-slate-800 bg-[#0f172a] px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-wide">
                  F1 仿真输出规范事件表与字段元数据字典
                </h2>
                <span className="rounded-full bg-cyan-950/80 border border-cyan-800 px-2 py-0.5 text-[11px] font-mono text-cyan-300">
                  共 {catalogList.length} 类规范表
                </span>
                <span className="rounded-full bg-emerald-950/80 border border-emerald-800 px-2 py-0.5 text-[11px] text-emerald-300">
                  前置 Scenario / MC_Run / Time 已全量补齐
                </span>
              </div>
              <p className="text-xs text-slate-400">
                作为中台评估元数据基底，定义了事件表物理字段、量纲单位与战术含义，支持外部导入编辑与全量持久化
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 导出 JSON */}
            <button
              type="button"
              onClick={handleExportJson}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition"
              title="导出完整元数据字典 JSON 文件"
            >
              <Download className="h-3.5 w-3.5 text-cyan-400" />
              <span>导出 JSON</span>
            </button>

            {/* 导入 JSON */}
            <label className="flex items-center gap-1.5 cursor-pointer rounded-lg border border-cyan-600/50 bg-cyan-600/20 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-600/30 transition">
              <Upload className="h-3.5 w-3.5" />
              <span>{isSaving ? '导入保存中...' : '导入外部 JSON 规范'}</span>
              <input
                type="file"
                accept=".json"
                onChange={handleImportJson}
                className="hidden"
                disabled={isSaving}
              />
            </label>

            {/* 恢复官方默认 */}
            <button
              type="button"
              onClick={handleResetDefaults}
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition"
              title="恢复官方默认 46 类规范定义"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>重置默认</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="ml-2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* 状态提醒通知 */}
        {importStatus && (
          <div className="bg-sky-950/80 border-b border-sky-800/60 px-6 py-2 text-xs font-medium text-sky-200 flex items-center gap-2">
            <Info className="h-4 w-4 text-sky-400 shrink-0" />
            <span>{importStatus}</span>
          </div>
        )}

        {/* Body 布局：左侧表目录导航，右侧选中表的字段与量纲详情 */}
        <div className="flex flex-1 overflow-hidden">
          {/* 左侧表列表 */}
          <div className="flex w-80 flex-col border-r border-slate-800 bg-[#090e1a]">
            {/* 检索与分类 */}
            <div className="border-b border-slate-800 p-3 space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="搜索表名、字段名或中文含义..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900/90 pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              {/* 分类过滤芯片 */}
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('ALL')}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                    selectedCategory === 'ALL'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  全部分类 ({catalogList.length})
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                      selectedCategory === cat
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                        : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* 表项列表 */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredTables.map((table) => {
                const isSelected = table.id === activeTable?.id;
                return (
                  <button
                    key={table.id}
                    type="button"
                    onClick={() => setSelectedTableId(table.id)}
                    className={`w-full text-left rounded-xl p-2.5 transition flex flex-col gap-1 border ${
                      isSelected
                        ? 'bg-cyan-950/40 border-cyan-500/50 text-cyan-100 shadow-md'
                        : 'border-transparent hover:bg-slate-800/50 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold truncate max-w-[170px]">
                        {table.name}
                      </span>
                      <span className="text-[10px] rounded bg-slate-800 px-1.5 py-0.5 text-slate-400 font-mono">
                        {table.fields.length} 列
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="truncate">{table.category}</span>
                      <span className="text-[10px] text-slate-500 font-mono">{table.id}</span>
                    </div>
                  </button>
                );
              })}
              {filteredTables.length === 0 && (
                <div className="p-6 text-center text-xs text-slate-500">
                  未匹配到相关规范事件表
                </div>
              )}
            </div>
          </div>

          {/* 右侧选定表的详细字段清单 */}
          <div className="flex flex-1 flex-col overflow-hidden bg-[#070b14]">
            {activeTable ? (
              <div className="flex flex-1 flex-col overflow-hidden">
                {/* 表标题与概览 */}
                <div className="border-b border-slate-800 bg-[#0f172a]/70 p-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="h-5 w-5 text-cyan-400" />
                      <h3 className="text-sm font-bold text-white font-mono">
                        {activeTable.name}
                      </h3>
                      <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-300 font-mono">
                        {activeTable.id}
                      </span>
                      <span className="rounded-md bg-cyan-950 border border-cyan-800 px-2 py-0.5 text-xs text-cyan-300">
                        {activeTable.category}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      包含 {activeTable.fields.length} 个规范定义字段，支持前置想定轮次标记、时序时标、空间坐标与状态标识。
                    </p>
                  </div>

                  <div className="text-right">
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium bg-emerald-950/60 border border-emerald-800/60 rounded-lg px-2.5 py-1">
                      <Check className="h-3.5 w-3.5" />
                      标准规范已加载
                    </span>
                  </div>
                </div>

                {/* 字段表格列表 */}
                <div className="flex-1 overflow-y-auto p-4">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-900/60 text-slate-400 font-semibold">
                        <th className="py-2.5 px-3 w-12 text-center">#</th>
                        <th className="py-2.5 px-3 w-56">字段名 (Column Name)</th>
                        <th className="py-2.5 px-3 w-32">数据类型 (Type)</th>
                        <th className="py-2.5 px-3 w-28">物理量纲 (Unit)</th>
                        <th className="py-2.5 px-3">业务战术含义与说明 (Note / Description)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {activeTable.fields.map((field, idx) => {
                        const isPrefix = ['Scenario', 'MC_Run', 'TimelineID', 'Time'].includes(
                          field.name
                        );
                        return (
                          <tr
                            key={field.name}
                            className={`hover:bg-slate-800/40 transition ${
                              isPrefix ? 'bg-sky-950/15' : ''
                            }`}
                          >
                            <td className="py-2 px-3 text-center font-mono text-slate-500">
                              {idx + 1}
                            </td>
                            <td className="py-2 px-3 font-mono font-semibold text-slate-200">
                              <span className="text-sky-300">{field.name}</span>
                              {isPrefix && (
                                <span className="ml-1.5 rounded bg-sky-900/60 border border-sky-700/60 px-1 py-0.2 text-[10px] text-sky-200">
                                  前置标准列
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-400">
                              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300">
                                {field.cs_type}
                              </span>
                            </td>
                            <td className="py-2 px-3 font-mono">
                              {field.unit ? (
                                <span className="rounded bg-amber-950/60 border border-amber-800/70 px-1.5 py-0.5 text-[11px] text-amber-300 font-semibold">
                                  {field.unit}
                                </span>
                              ) : (
                                <span className="text-slate-600">-</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-slate-300">
                              {field.note || (
                                <span className="text-slate-500 italic">暂无补充说明</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-slate-500 text-sm">
                请在左侧选择一个规范事件表
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex h-12 items-center justify-between border-t border-slate-800 bg-[#0d1424] px-6 text-xs text-slate-400">
          <div>
            <span>元数据字典支持导入自定义 JSON 文件覆盖或扩充字段定义，持久化于服务端与本地。</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-4 py-1.5 font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition"
          >
            关闭字典
          </button>
        </div>
      </div>
    </div>
  );
}
