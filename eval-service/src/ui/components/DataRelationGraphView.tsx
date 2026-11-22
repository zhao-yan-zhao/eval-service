import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Database,
  GitMerge,
  Search,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Code2,
  Table2,
  CheckCircle2,
  Key,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Maximize2,
  Filter,
  Layers,
  Sparkles,
  Link2,
  X
} from 'lucide-react';
import type { F1OutputCatalog, MetricAtomMeta } from '../api.ts';

export interface DataRelationGraphViewProps {
  catalog: F1OutputCatalog | null;
  operators?: MetricAtomMeta[];
}

export type { FieldDef, TableNode, RelationLink } from './relation-graph-catalog.ts';
export {
  ALL_TABLE_NODES,
  ALL_RELATION_LINKS,
  CORE_TABLE_NODES,
  CORE_RELATION_LINKS
} from './relation-graph-catalog.ts';

import {
  ALL_TABLE_NODES,
  ALL_RELATION_LINKS,
  CORE_TABLE_NODES,
  CORE_RELATION_LINKS,
  type FieldDef,
  type TableNode,
  type RelationLink
} from './relation-graph-catalog.ts';

export function DataRelationGraphView({ catalog, operators = [] }: DataRelationGraphViewProps) {
  // 1. 画布视口状态
  const [pan, setPan] = useState({ x: 30, y: 20 });
  const [scale, setScale] = useState(0.5);
  const containerRef = useRef<HTMLDivElement>(null);

  // 2. 节点坐标位置状态（支持自由拖拽自由定位）
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>(() => {
    const map: Record<string, { x: number; y: number }> = {};
    for (const t of ALL_TABLE_NODES) {
      map[t.id] = { x: t.defaultX, y: t.defaultY };
    }
    return map;
  });

  // 3. 折叠/展开卡片字段状态
  const [collapsedTables, setCollapsedTables] = useState<Record<string, boolean>>({});
  const [allCollapsed, setAllCollapsed] = useState(false);

  // 4. 交互选中与悬停状态
  const [selectedTable, setSelectedTable] = useState<string | null>('WeaponFired');
  const [selectedField, setSelectedField] = useState<{ table: string; field: string } | null>({
    table: 'WeaponFired',
    field: 'WeaponID'
  });
  const [selectedLink, setSelectedLink] = useState<RelationLink | null>(ALL_RELATION_LINKS[0]);
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);
  const [hoveredField, setHoveredField] = useState<{ table: string; field: string } | null>(null);

  // 5. 过滤与搜索
  const [searchKey, setSearchKey] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // 6. 右侧抽屉展开收起状态与代码方言
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [codeDialect, setCodeDialect] = useState<'sql' | 'python' | 'spec'>('sql');
  const [copied, setCopied] = useState(false);

  // 7. 拖拽核心状态
  const draggingNodeRef = useRef<{
    nodeId: string;
    startMouseX: number;
    startMouseY: number;
    startNodeX: number;
    startNodeY: number;
  } | null>(null);

  const panningRef = useRef<{
    startMouseX: number;
    startMouseY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  const [isCanvasPanning, setIsCanvasPanning] = useState(false);
  const [isNodeDragging, setIsNodeDragging] = useState(false);

  // 监听鼠标光标为中心的顺滑滚轮缩放
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      setScale((prevScale) => {
        const nextScale = Math.min(Math.max(prevScale * zoomFactor, 0.35), 2.2);
        if (nextScale === prevScale) return prevScale;

        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // 计算当前鼠标对应世界坐标
        const worldX = (mouseX - pan.x) / prevScale;
        const worldY = (mouseY - pan.y) / prevScale;

        // 调整平移使光标下的点保持不动
        setPan({
          x: mouseX - worldX * nextScale,
          y: mouseY - worldY * nextScale
        });

        return nextScale;
      });
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [pan.x, pan.y]);

  // 全局 Pointer Move 与 Pointer Up 监听（实现无卡顿物理级顺滑拖动）
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      // 处理卡片节点拖拽
      if (draggingNodeRef.current) {
        const { nodeId, startMouseX, startMouseY, startNodeX, startNodeY } = draggingNodeRef.current;
        const deltaX = (e.clientX - startMouseX) / scale;
        const deltaY = (e.clientY - startMouseY) / scale;
        setNodePositions((prev) => ({
          ...prev,
          [nodeId]: {
            x: Math.round(startNodeX + deltaX),
            y: Math.round(startNodeY + deltaY)
          }
        }));
        return;
      }

      // 处理画布背景平移
      if (panningRef.current) {
        const { startMouseX, startMouseY, startPanX, startPanY } = panningRef.current;
        setPan({
          x: Math.round(startPanX + (e.clientX - startMouseX)),
          y: Math.round(startPanY + (e.clientY - startMouseY))
        });
      }
    };

    const handlePointerUp = () => {
      if (draggingNodeRef.current) {
        draggingNodeRef.current = null;
        setIsNodeDragging(false);
      }
      if (panningRef.current) {
        panningRef.current = null;
        setIsCanvasPanning(false);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [scale]);

  // 启动节点拖拽
  const startDragNode = (e: React.PointerEvent, nodeId: string) => {
    e.stopPropagation();
    const pos = nodePositions[nodeId] || { x: 0, y: 0 };
    draggingNodeRef.current = {
      nodeId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startNodeX: pos.x,
      startNodeY: pos.y
    };
    setIsNodeDragging(true);
    setSelectedTable(nodeId);
  };

  // 启动画布背景平移
  const startPanCanvas = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.table-card-container')) return;
    panningRef.current = {
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y
    };
    setIsCanvasPanning(true);
  };

  // 计算字段垂直偏移 Anchor Y
  const getFieldAnchorY = useCallback(
    (tableId: string, fieldName: string) => {
      const node = ALL_TABLE_NODES.find((n) => n.id === tableId);
      if (!node) return 20;
      if (collapsedTables[tableId]) {
        return 22; // 折叠时锚定到表头中线
      }
      const fieldIndex = node.fields.findIndex(
        (f) => f.name.toLowerCase() === fieldName.toLowerCase()
      );
      if (fieldIndex === -1) return 22;
      // 表头高度约 40px，每行字段高度 28px，取行中心
      return 40 + fieldIndex * 28 + 14;
    },
    [collapsedTables]
  );

  // 过滤后的数据表
  const visibleTables = useMemo(() => {
    const q = searchKey.trim().toLowerCase();
    return ALL_TABLE_NODES.filter((table) => {
      if (categoryFilter === 'core' && !table.isCore) return false;
      if (categoryFilter !== 'all' && categoryFilter !== 'core' && table.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        table.id.toLowerCase().includes(q) ||
        table.name.toLowerCase().includes(q) ||
        table.fields.some(
          (f) => f.name.toLowerCase().includes(q) || (f.note && f.note.toLowerCase().includes(q))
        )
      );
    });
  }, [searchKey, categoryFilter]);

  // 计算每条关系的连线几何参数 (Bezier Routing & Smart Anchor Ports)
  const computedLinks = useMemo(() => {
    const nodeMap = new Map<string, TableNode>();
    for (const t of ALL_TABLE_NODES) {
      nodeMap.set(t.id, t);
    }

    return ALL_RELATION_LINKS.map((link) => {
      const fromNode = nodeMap.get(link.fromTable);
      const toNode = nodeMap.get(link.toTable);
      if (!fromNode || !toNode) return null;

      const fromPos = nodePositions[link.fromTable] || { x: fromNode.defaultX, y: fromNode.defaultY };
      const toPos = nodePositions[link.toTable] || { x: toNode.defaultX, y: toNode.defaultY };

      const fromOffsetY = getFieldAnchorY(link.fromTable, link.fromField);
      const toOffsetY = getFieldAnchorY(link.toTable, link.toField);

      const fromWidth = fromNode.width;
      const toWidth = toNode.width;

      const fromCenterY = fromPos.y + fromOffsetY;
      const toCenterY = toPos.y + toOffsetY;

      // 智能判断左右锚点连接方向（根据卡片当前相对坐标自动切换，避免反穿）
      let startX = 0;
      let endX = 0;
      let startDir = 1; // 1: 从右向外, -1: 从左向外
      let endDir = -1; // -1: 从左接入, 1: 从右接入

      if (fromPos.x + fromWidth < toPos.x + 30) {
        // 源在左，目标在右
        startX = fromPos.x + fromWidth;
        endX = toPos.x;
        startDir = 1;
        endDir = -1;
      } else if (toPos.x + toWidth < fromPos.x + 30) {
        // 源在右，目标在左
        startX = fromPos.x;
        endX = toPos.x + toWidth;
        startDir = -1;
        endDir = 1;
      } else {
        // 纵向重叠时，同向侧边弯曲
        if (fromPos.x <= toPos.x) {
          startX = fromPos.x;
          endX = toPos.x;
          startDir = -1;
          endDir = -1;
        } else {
          startX = fromPos.x + fromWidth;
          endX = toPos.x + toWidth;
          startDir = 1;
          endDir = 1;
        }
      }

      const dx = Math.max(Math.abs(endX - startX) * 0.45, 60);
      const c1x = startX + startDir * dx;
      const c1y = fromCenterY;
      const c2x = endX + endDir * dx;
      const c2y = toCenterY;

      const pathD = `M ${startX} ${fromCenterY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${endX} ${toCenterY}`;

      const isSelected = selectedLink?.id === link.id;
      const isHovered = hoveredLink === link.id;
      const isConnectedToSelected =
        selectedTable && (link.fromTable === selectedTable || link.toTable === selectedTable);
      const isConnectedToSelectedField =
        selectedField &&
        ((link.fromTable === selectedField.table && link.fromField === selectedField.field) ||
          (link.toTable === selectedField.table && link.toField === selectedField.field));

      return {
        ...link,
        startX,
        startY: fromCenterY,
        endX,
        endY: toCenterY,
        midX: (startX + endX) / 2,
        midY: (fromCenterY + toCenterY) / 2,
        pathD,
        isSelected,
        isHovered,
        isConnectedToSelected,
        isConnectedToSelectedField
      };
    }).filter(Boolean) as Array<
      RelationLink & {
        startX: number;
        startY: number;
        endX: number;
        endY: number;
        midX: number;
        midY: number;
        pathD: string;
        isSelected: boolean;
        isHovered: boolean;
        isConnectedToSelected: boolean;
        isConnectedToSelectedField: boolean;
      }
    >;
  }, [nodePositions, getFieldAnchorY, selectedLink, hoveredLink, selectedTable, selectedField]);

  // 动态生成的示例代码 (多方言)
  const activeCodeSnippet = useMemo(() => {
    const active = selectedLink || ALL_RELATION_LINKS[0];
    if (!active) return '';

    if (codeDialect === 'sql') {
      return `-- 44类仿真规范核心关联：${active.description}
-- 适用引擎：DuckDB / SQLite / ClickHouse / SparkSQL

SELECT 
    f.MC_Run,
    f.Time,
    f.${active.fromField} AS from_pk,
    t.${active.toField} AS to_fk,
    f.*,
    t.* EXCLUDE (TimelineID, MC_Run)
FROM read_csv_auto('${active.fromTable}.csv') AS f
INNER JOIN read_csv_auto('${active.toTable}.csv') AS t
    ON f.TimelineID = t.TimelineID
   AND f.MC_Run = t.MC_Run
   AND lower(f.${active.fromField}) = lower(t.${active.toField})
WHERE f.MC_Run = 1
ORDER BY f.Time ASC;`;
    }

    if (codeDialect === 'python') {
      return `# Python Pandas / Polars 高性能多样本关联处理
import pandas as pd

# 1. 读入底层导出的两类标准事件表
df_from = pd.read_csv("${active.fromTable}.csv", dtype={"TimelineID": str, "${active.fromField}": str})
df_to = pd.read_csv("${active.toTable}.csv", dtype={"TimelineID": str, "${active.toField}": str})

# 2. 大小写对齐清洗 (规避GUID大小写不一致)
df_from["_join_key"] = df_from["${active.fromField}"].str.lower().str.strip()
df_to["_join_key"] = df_to["${active.toField}"].str.lower().str.strip()

# 3. 基于多样本 (TimelineID, MC_Run) 联合主键合并
merged_df = pd.merge(
    df_from,
    df_to,
    left_on=["TimelineID", "MC_Run", "_join_key"],
    right_on=["TimelineID", "MC_Run", "_join_key"],
    suffixes=("_from", "_to"),
    how="inner"
)

print(f"关联对齐样本行数: {len(merged_df)} 行")`;
    }

    // 规范 JSON
    return JSON.stringify(
      {
        linkId: active.id,
        relation: active.relationType,
        source: { table: active.fromTable, field: active.fromField, keyType: 'PK/FK' },
        target: { table: active.toTable, field: active.toField, keyType: 'FK/PK' },
        isolation: ['TimelineID', 'MC_Run'],
        description: active.description,
        joinNote: active.joinNote
      },
      null,
      2
    );
  }, [selectedLink, codeDialect]);

  // 一键复制代码
  const handleCopyCode = () => {
    navigator.clipboard.writeText(activeCodeSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 预置布局 1：全域业务流式泳道 (Pipeline Swimlanes)
  const applyPipelineLayout = () => {
    const map: Record<string, { x: number; y: number }> = {};
    for (const t of ALL_TABLE_NODES) {
      map[t.id] = { x: t.defaultX, y: t.defaultY };
    }
    setNodePositions(map);
    setScale(0.45);
    setPan({ x: 30, y: 20 });
  };

  // 预置布局 2：紧凑六列矩阵网格 (Compact 6-Col Grid)
  const applyCompactLayout = () => {
    const map: Record<string, { x: number; y: number }> = {};
    const colWidth = 310;
    const rowHeight = 480;
    visibleTables.forEach((t, idx) => {
      const col = idx % 6;
      const row = Math.floor(idx / 6);
      map[t.id] = { x: 50 + col * colWidth, y: 70 + row * rowHeight };
    });
    setNodePositions((prev) => ({ ...prev, ...map }));
    setScale(0.42);
    setPan({ x: 20, y: 20 });
  };

  // 预置布局 3：聚焦核心 8 张骨干表 (Core 8 Focus)
  const applyCoreFocusLayout = () => {
    setCategoryFilter('core');
    setNodePositions((prev) => ({
      ...prev,
      UnitCreated: { x: 50, y: 120 },
      UnitPositions: { x: 50, y: 560 },
      SensorCreated: { x: 400, y: 120 },
      ContactPositions: { x: 400, y: 460 },
      WeaponFired: { x: 770, y: 120 },
      UnitDestroyed: { x: 770, y: 560 },
      WeaponEndgame: { x: 1140, y: 120 },
      DataWeapon: { x: 1140, y: 530 }
    }));
    setScale(0.75);
    setPan({ x: 30, y: 20 });
  };

  // 一键折叠/展开全部表字段
  const toggleCollapseAll = () => {
    if (allCollapsed) {
      setCollapsedTables({});
      setAllCollapsed(false);
    } else {
      const map: Record<string, boolean> = {};
      for (const t of ALL_TABLE_NODES) {
        map[t.id] = true;
      }
      setCollapsedTables(map);
      setAllCollapsed(true);
    }
  };

  // 适应画布全部节点 (Fit View)
  const handleFitView = () => {
    if (!containerRef.current || visibleTables.length === 0) {
      setScale(0.45);
      setPan({ x: 30, y: 20 });
      return;
    }
    const containerW = containerRef.current.clientWidth - (isDrawerOpen ? 384 : 0);
    const containerH = containerRef.current.clientHeight;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const t of visibleTables) {
      const pos = nodePositions[t.id] || { x: t.defaultX, y: t.defaultY };
      const w = t.width;
      const h = collapsedTables[t.id] ? 50 : 40 + t.fields.length * 28;
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x + w);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y + h);
    }

    const totalW = maxX - minX + 120;
    const totalH = maxY - minY + 120;
    const scaleX = containerW / totalW;
    const scaleY = containerH / totalH;
    const nextScale = Math.min(Math.max(Math.min(scaleX, scaleY) * 0.92, 0.22), 1.2);

    const centerWorldX = (minX + maxX) / 2;
    const centerWorldY = (minY + maxY) / 2;

    setScale(nextScale);
    setPan({
      x: Math.round(containerW / 2 - centerWorldX * nextScale),
      y: Math.round(containerH / 2 - centerWorldY * nextScale)
    });
  };

  // 聚焦到指定表格卡片
  const focusOnTable = (tableId: string) => {
    setSelectedTable(tableId);
    const pos = nodePositions[tableId];
    if (pos && containerRef.current) {
      const containerW = containerRef.current.clientWidth - (isDrawerOpen ? 384 : 0);
      const containerH = containerRef.current.clientHeight;
      const targetPanX = containerW / 2 - (pos.x + 130) * scale;
      const targetPanY = containerH / 2 - (pos.y + 150) * scale;
      setPan({ x: Math.round(targetPanX), y: Math.round(targetPanY) });
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] min-h-[720px] bg-[#090d14] rounded-xl border border-slate-800 text-slate-100 overflow-hidden select-none">
      {/* 顶部现代化操作工具栏 */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2.5 bg-[#0f1523] border-b border-slate-800 gap-3 z-20 shadow-md">
        {/* 左侧：标题与状态标签 */}
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-400">
            <GitMerge className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-100 tracking-wide flex items-center gap-1.5">
                44类推演事件与装备库关系图谱 (ER Graph)
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono">
                {ALL_RELATION_LINKS.length} 核心链路 · {ALL_TABLE_NODES.length} 全量表
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30 font-mono hidden sm:inline-block">
                按住卡片头自由拖动 · 滚轮就地缩放
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              字段级精准锚点连线 · 实时跟随平移 · 多样本 (TimelineID, MC_Run) 联合主键推导
            </p>
          </div>
        </div>

        {/* 中间分类筛选胶囊 */}
        <div className="hidden lg:flex items-center bg-slate-900/90 border border-slate-800 p-0.5 rounded-lg text-xs overflow-x-auto">
          {[
            { id: 'all', label: `全量表 (${ALL_TABLE_NODES.length})` },
            { id: 'core', label: `核心骨干 (${CORE_TABLE_NODES.length})` },
            { id: 'platform', label: '兵力实体 (7)' },
            { id: 'sensor', label: '感知探测 (9)' },
            { id: 'combat', label: '交战打击 (9)' },
            { id: 'damage', label: '战损评估 (4)' },
            { id: 'mission', label: '指挥保障 (17)' },
            { id: 'system', label: 'DB3K字典 (1)' }
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategoryFilter(cat.id)}
              className={`px-2.5 py-1 rounded-md transition text-[11px] whitespace-nowrap ${
                categoryFilter === cat.id
                  ? 'bg-blue-600 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* 右侧：搜索、布局预置与视口控制 */}
        <div className="flex items-center gap-2">
          {/* 实时搜索 */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="搜索表或字段 (如 WeaponID)..."
              value={searchKey}
              onChange={(e) => setSearchKey(e.target.value)}
              className="w-36 sm:w-44 pl-8 pr-7 py-1 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
            {searchKey && (
              <button
                onClick={() => setSearchKey('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* 快速排版与折叠控制 */}
          <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900 p-0.5">
            <button
              onClick={applyPipelineLayout}
              className="px-2 py-1 text-[11px] text-slate-300 hover:text-white rounded hover:bg-slate-800 transition flex items-center gap-1"
              title="按作战业务流排列：兵力 -> 探测 -> 打击 -> 战损 -> 后勤"
            >
              <Layers className="w-3 h-3 text-cyan-400" />
              <span className="hidden xl:inline">业务泳道</span>
            </button>
            <button
              onClick={applyCompactLayout}
              className="px-2 py-1 text-[11px] text-slate-300 hover:text-white rounded hover:bg-slate-800 transition"
              title="矩阵网格紧凑排列"
            >
              <span className="hidden xl:inline">矩阵网格</span>
            </button>
            <button
              onClick={applyCoreFocusLayout}
              className="px-2 py-1 text-[11px] text-amber-300 hover:text-amber-200 rounded hover:bg-slate-800 transition"
              title="聚焦核心 8 张骨干表"
            >
              <span className="hidden xl:inline">核心聚焦</span>
            </button>
            <span className="h-3 w-px bg-slate-800 mx-1" />
            <button
              onClick={toggleCollapseAll}
              className="px-2 py-1 text-[11px] text-slate-300 hover:text-white rounded hover:bg-slate-800 transition"
              title={allCollapsed ? '展开所有表字段' : '折叠所有表字段，快速浏览宏观拓扑'}
            >
              {allCollapsed ? '展开全部' : '折叠全部'}
            </button>
          </div>

          {/* 缩放与自适应 */}
          <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900 p-0.5">
            <button
              onClick={() => setScale((s) => Math.max(Number((s - 0.05).toFixed(2)), 0.2))}
              className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition"
              title="缩小 (滚轮下滚)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono text-slate-400 px-1 min-w-[34px] text-center">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={() => setScale((s) => Math.min(Number((s + 0.05).toFixed(2)), 2.2))}
              className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition"
              title="放大 (滚轮上滚)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleFitView}
              className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition"
              title="适应全图"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={applyPipelineLayout}
              className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition"
              title="复位默认布局"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 切换右侧代码抽屉 */}
          <button
            onClick={() => setIsDrawerOpen((v) => !v)}
            className={`px-2.5 py-1 text-xs rounded-lg border transition flex items-center gap-1.5 ${
              isDrawerOpen
                ? 'bg-blue-600/20 border-blue-500/50 text-blue-300'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
            title="展开/折叠右侧 SQL与代码生成器"
          >
            <Code2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">SQL/链路分析</span>
            {isDrawerOpen ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* 主画布与右侧抽屉容器 */}
      <div className="flex flex-1 min-h-0 relative overflow-hidden">
        {/* SVG 与 DOM 交互式 ER 图画布 */}
        <div
          ref={containerRef}
          onPointerDown={startPanCanvas}
          className={`flex-1 relative overflow-hidden bg-[#070a0f] ${
            isCanvasPanning ? 'cursor-grabbing' : isNodeDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          style={{
            backgroundImage:
              'radial-gradient(#1e293b 1.2px, transparent 1.2px), radial-gradient(#1e293b 1.2px, #070a0f 1.2px)',
            backgroundSize: '24px 24px',
            backgroundPosition: `${pan.x}px ${pan.y}px`
          }}
        >
          {/* 视口变换层 (Zoom & Pan Transform Layer) */}
          <div
            className="absolute origin-top-left pointer-events-none"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              width: '3200px',
              height: '2400px'
            }}
          >
            {/* SVG 矢量精准贝塞尔连线层 */}
            <svg
              className="absolute top-0 left-0 w-full h-full pointer-events-none"
              style={{ overflow: 'visible' }}
            >
              <defs>
                <marker
                  id="er-arrow"
                  viewBox="0 0 10 10"
                  refX="7"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#38bdf8" />
                </marker>
                <marker
                  id="er-arrow-active"
                  viewBox="0 0 10 10"
                  refX="7"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 9 5 L 0 9 z" fill="#00f2fe" />
                </marker>
                <filter id="line-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* 渲染所有关系曲线与精准字段端口 */}
              {computedLinks.map((link) => {
                const isBright =
                  link.isSelected ||
                  link.isHovered ||
                  link.isConnectedToSelectedField;
                const isSubtle =
                  !isBright &&
                  (link.isConnectedToSelected ||
                    (selectedField &&
                      (link.fromField === selectedField.field || link.toField === selectedField.field)));

                const strokeColor = isBright
                  ? '#00f2fe'
                  : isSubtle
                  ? '#38bdf8'
                  : '#334155';

                const strokeWidth = isBright ? 3 : isSubtle ? 2 : 1.5;

                return (
                  <g
                    key={link.id}
                    className="pointer-events-auto cursor-pointer transition-all duration-150"
                    onMouseEnter={() => setHoveredLink(link.id)}
                    onMouseLeave={() => setHoveredLink(null)}
                    onClick={() => {
                      setSelectedLink(link);
                      setSelectedTable(link.fromTable);
                      setSelectedField({ table: link.fromTable, field: link.fromField });
                    }}
                  >
                    {/* 扩展点击/悬停热区通道 */}
                    <path
                      d={link.pathD}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={20}
                    />

                    {/* 光晕发光层 (选中或高亮时) */}
                    {isBright && (
                      <path
                        d={link.pathD}
                        fill="none"
                        stroke="#00f2fe"
                        strokeWidth={6}
                        strokeOpacity={0.35}
                        filter="url(#line-glow)"
                      />
                    )}

                    {/* 实体贝塞尔连线 */}
                    <path
                      d={link.pathD}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      strokeDasharray={isBright || isSubtle ? 'none' : '4 3'}
                      markerEnd={isBright ? 'url(#er-arrow-active)' : 'url(#er-arrow)'}
                    />

                    {/* 起始端点端口小圆圈 (Anchor Port Dot) */}
                    <circle
                      cx={link.startX}
                      cy={link.startY}
                      r={isBright ? 5 : 3.5}
                      fill={isBright ? '#00f2fe' : '#38bdf8'}
                      stroke="#090d14"
                      strokeWidth={1.5}
                    />

                    {/* 终点端口小圆圈 */}
                    <circle
                      cx={link.endX}
                      cy={link.endY}
                      r={isBright ? 5 : 3.5}
                      fill={isBright ? '#00f2fe' : '#38bdf8'}
                      stroke="#090d14"
                      strokeWidth={1.5}
                    />

                    {/* 连线中点关系标签 (1:1 / 1:N / N:1) */}
                    <g transform={`translate(${link.midX}, ${link.midY})`}>
                      <rect
                        x="-48"
                        y="-12"
                        width="96"
                        height="20"
                        rx="10"
                        fill="#0b111e"
                        stroke={isBright ? '#00f2fe' : isSubtle ? '#38bdf8' : '#334155'}
                        strokeWidth={1}
                        className="transition-colors"
                      />
                      <text
                        x="0"
                        y="2"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize="10"
                        fontFamily="monospace"
                        fontWeight="bold"
                        fill={isBright ? '#00f2fe' : isSubtle ? '#e2e8f0' : '#94a3b8'}
                      >
                        {link.relationType} ({link.fromField})
                      </text>
                    </g>
                  </g>
                );
              })}
            </svg>

            {/* DOM 真实卡片节点层 (Draggable Table Cards) */}
            {visibleTables.map((table) => {
              const pos = nodePositions[table.id] || { x: table.defaultX, y: table.defaultY };
              const isSelected = selectedTable === table.id;
              const isCollapsed = !!collapsedTables[table.id];

              // 检查该表是否与当前选中的连线相关
              const isRelatedToLink =
                selectedLink &&
                (selectedLink.fromTable === table.id || selectedLink.toTable === table.id);

              return (
                <div
                  key={table.id}
                  className={`table-card-container absolute rounded-xl border transition-shadow duration-150 pointer-events-auto bg-[#101625]/95 backdrop-blur-md ${
                    isSelected
                      ? 'ring-2 ring-blue-500 shadow-2xl shadow-blue-500/25 border-blue-400 z-30'
                      : isRelatedToLink
                      ? 'ring-1 ring-cyan-500/80 border-cyan-500/70 shadow-lg shadow-cyan-500/15 z-20'
                      : 'border-slate-800/90 shadow-xl hover:border-slate-700 z-10'
                  }`}
                  style={{
                    left: `${pos.x}px`,
                    top: `${pos.y}px`,
                    width: `${table.width}px`
                  }}
                  onClick={() => setSelectedTable(table.id)}
                >
                  {/* 可拖拽表头 (Header with Drag Handle & Collapse Toggle) */}
                  <div
                    onPointerDown={(e) => startDragNode(e, table.id)}
                    className={`px-3 py-2 rounded-t-xl border-b flex items-center justify-between cursor-move select-none ${table.headerBg} ${table.headerBorder} ${table.headerText}`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Table2 className="w-3.5 h-3.5 shrink-0 opacity-90" />
                      <span className="text-xs font-bold truncate tracking-tight">
                        {table.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 ml-1">
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-black/40 font-mono text-slate-300">
                        {table.categoryLabel}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCollapsedTables((prev) => ({
                            ...prev,
                            [table.id]: !prev[table.id]
                          }));
                        }}
                        className="p-1 hover:bg-white/10 rounded text-slate-300 transition"
                        title={isCollapsed ? '展开字段列表' : '折叠字段列表'}
                      >
                        {isCollapsed ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronUp className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* 字段明细列表 (Field Rows with Precision Ports) */}
                  {!isCollapsed && (
                    <div className="divide-y divide-slate-800/60 text-[11px] font-mono max-h-[300px] overflow-y-auto">
                      {table.fields.map((field) => {
                        const isMatchSearch =
                          searchKey.trim() &&
                          (field.name.toLowerCase().includes(searchKey.trim().toLowerCase()) ||
                            (field.note &&
                              field.note.toLowerCase().includes(searchKey.trim().toLowerCase())));

                        const isFieldSelected =
                          selectedField?.table === table.id && selectedField?.field === field.name;

                        // 该字段是否属于当前选中的关系链路
                        const isFieldInSelectedLink =
                          selectedLink &&
                          ((selectedLink.fromTable === table.id && selectedLink.fromField === field.name) ||
                            (selectedLink.toTable === table.id && selectedLink.toField === field.name));

                        return (
                          <div
                            key={field.name}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTable(table.id);
                              setSelectedField({ table: table.id, field: field.name });
                              // 自动寻找关联的第一个 Link
                              const matchLink = ALL_RELATION_LINKS.find(
                                (l) =>
                                  (l.fromTable === table.id && l.fromField === field.name) ||
                                  (l.toTable === table.id && l.toField === field.name)
                              );
                              if (matchLink) setSelectedLink(matchLink);
                            }}
                            onMouseEnter={() => setHoveredField({ table: table.id, field: field.name })}
                            onMouseLeave={() => setHoveredField(null)}
                            className={`px-3 py-1.5 flex items-center justify-between cursor-pointer transition-colors relative group ${
                              isFieldSelected || isFieldInSelectedLink
                                ? 'bg-blue-600/25 text-white font-semibold'
                                : isMatchSearch
                                ? 'bg-amber-500/20 text-amber-200'
                                : 'hover:bg-slate-800/50 text-slate-300'
                            }`}
                          >
                            {/* 左侧端口圆点 */}
                            <span
                              className={`absolute -left-1 w-2 h-2 rounded-full border border-slate-900 transition-transform ${
                                isFieldInSelectedLink || isFieldSelected
                                  ? 'bg-cyan-400 scale-125'
                                  : 'bg-slate-700 group-hover:bg-slate-400'
                              }`}
                            />

                            {/* 字段名与键图标 */}
                            <div className="flex items-center gap-1.5 truncate pr-2">
                              {field.isKey && (
                                <Key
                                  className="w-3 h-3 text-amber-400 shrink-0"
                                  title="主键 (Primary Key)"
                                />
                              )}
                              {field.isForeignKey && (
                                <Link2
                                  className="w-3 h-3 text-cyan-400 shrink-0"
                                  title="外键 (Foreign Key)"
                                />
                              )}
                              <span
                                className={`truncate ${
                                  field.isKey
                                    ? 'text-amber-300 font-bold'
                                    : field.isForeignKey
                                    ? 'text-cyan-300 font-medium'
                                    : ''
                                }`}
                              >
                                {field.name}
                              </span>
                            </div>

                            {/* 字段类型 */}
                            <span className="text-[10px] text-slate-500 font-mono shrink-0">
                              {field.type}
                            </span>

                            {/* 右侧端口圆点 */}
                            <span
                              className={`absolute -right-1 w-2 h-2 rounded-full border border-slate-900 transition-transform ${
                                isFieldInSelectedLink || isFieldSelected
                                  ? 'bg-cyan-400 scale-125'
                                  : 'bg-slate-700 group-hover:bg-slate-400'
                              }`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 底部紧凑状态条 */}
                  <div className="px-3 py-1 bg-slate-950/80 rounded-b-xl border-t border-slate-800/70 text-[10px] text-slate-400 flex items-center justify-between">
                    <span>{table.fields.length} 字段</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        focusOnTable(table.id);
                      }}
                      className="text-blue-400 hover:text-blue-300 hover:underline"
                    >
                      居中聚焦
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 画布左下角浮动信息角标 */}
          <div className="absolute left-3 bottom-3 z-10 flex items-center gap-2 bg-[#0d131f]/90 border border-slate-800/80 px-2.5 py-1.5 rounded-lg shadow-lg text-[11px] text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>
              已加载 {visibleTables.length} / {ALL_TABLE_NODES.length} 表 · 滚轮就地缩放 · 空白处拖拽平移
            </span>
          </div>
        </div>

        {/* 右侧可折叠抽屉：代码即时生成器与关系分析 */}
        {isDrawerOpen && (
          <div className="w-96 border-l border-slate-800 bg-[#0d121c] flex flex-col z-20 shadow-2xl transition-all duration-200">
            {/* 抽屉头部 */}
            <div className="p-3.5 border-b border-slate-800 flex items-center justify-between bg-[#111722]">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-emerald-400" />
                <h3 className="text-xs font-bold text-slate-200">跨表关联与代码生成器</h3>
              </div>
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition"
                title="收起抽屉"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* 抽屉滚动内容 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* 1. 当前选中关联链路卡片 */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
                    <GitMerge className="w-3.5 h-3.5 text-cyan-400" />
                    <span>选中的关联拓扑</span>
                  </div>
                  {selectedLink && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-mono">
                      {selectedLink.relationType} 契约
                    </span>
                  )}
                </div>

                <div className="text-xs text-slate-200 font-mono bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between">
                  {selectedLink ? (
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="text-rose-300 font-semibold">{selectedLink.fromTable}</span>
                      <span className="text-slate-500">.</span>
                      <span className="text-cyan-300">{selectedLink.fromField}</span>
                      <span className="text-slate-400 px-1">⟷</span>
                      <span className="text-purple-300 font-semibold">{selectedLink.toTable}</span>
                      <span className="text-slate-500">.</span>
                      <span className="text-cyan-300">{selectedLink.toField}</span>
                    </div>
                  ) : (
                    <span className="text-slate-500">点击图上任意连线或字段查看</span>
                  )}
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {selectedLink?.description || '点击拓扑图中的连线、表卡片或具体字段以查看工程解释。'}
                </p>

                {selectedLink?.joinNote && (
                  <div className="text-[11px] text-emerald-400/90 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 rounded-md">
                    <strong>评估映射参考：</strong>
                    {selectedLink.joinNote}
                  </div>
                )}

                {/* 快速定位源表/目标表 */}
                {selectedLink && (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => focusOnTable(selectedLink.fromTable)}
                      className="flex-1 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 transition"
                    >
                      聚焦源表: {selectedLink.fromTable}
                    </button>
                    <button
                      onClick={() => focusOnTable(selectedLink.toTable)}
                      className="flex-1 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 transition"
                    >
                      聚焦目标: {selectedLink.toTable}
                    </button>
                  </div>
                )}
              </div>

              {/* 2. 代码方言切换器与复制 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-0.5 rounded-lg text-xs">
                    {(
                      [
                        { id: 'sql', label: 'DuckDB / SQL' },
                        { id: 'python', label: 'Python (Pandas)' },
                        { id: 'spec', label: '契约 JSON' }
                      ] as const
                    ).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setCodeDialect(t.id)}
                        className={`px-2 py-1 rounded text-[11px] transition ${
                          codeDialect === t.id
                            ? 'bg-blue-600 text-white font-medium shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={handleCopyCode}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-200 transition"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">已复制</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-400" />
                        <span>复制</span>
                      </>
                    )}
                  </button>
                </div>

                {/* 代码展示框 */}
                <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-emerald-300/90 overflow-x-auto whitespace-pre leading-relaxed max-h-[300px]">
                  {activeCodeSnippet}
                </pre>
              </div>

              {/* 3. 蒙特卡洛多样本与工程三铁律 */}
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3.5 text-[11px] space-y-2 text-slate-300">
                <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>多样本大仿真关联三原则：</span>
                </div>
                <ul className="list-disc list-inside space-y-1.5 text-slate-400 leading-relaxed">
                  <li>
                    <strong className="text-slate-200">隔离分区主键：</strong>
                    跨表 Join 必须包含 <code className="text-amber-200">TimelineID</code> 与{' '}
                    <code className="text-amber-200">MC_Run</code>，杜绝跨样本数据污染。
                  </li>
                  <li>
                    <strong className="text-slate-200">GUID 大小写容错：</strong>
                    比较 <code className="text-slate-200">WeaponID</code> 或{' '}
                    <code className="text-slate-200">UnitID</code> 前务必使用{' '}
                    <code className="text-cyan-300">lower()</code> 函数清洗。
                  </li>
                  <li>
                    <strong className="text-slate-200">字典剥离后缀：</strong>
                    关联 DB3K 武器物理字典时，若 ID 携带呼号后缀（如 #107），须进行正则剥离。
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}