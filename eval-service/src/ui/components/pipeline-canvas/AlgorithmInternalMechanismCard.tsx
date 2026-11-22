import React, { useState } from 'react';
import {
  Activity,
  Binary,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Code2,
  Compass,
  Cpu,
  Layers,
  Sparkles,
} from 'lucide-react';
import type { CanvasNode, PipelineNodeType } from './canvas-types.ts';

interface AlgorithmInternalMechanismCardProps {
  node: CanvasNode;
}

export function AlgorithmInternalMechanismCard({ node }: AlgorithmInternalMechanismCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const renderMechanismContent = () => {
    switch (node.type) {
      case 'spatial': {
        const rule = node.config?.spatialRule || 'corridor_check';
        const sourceMode = node.config?.geomSourceMode || 'dynamic_table';
        const marginKm = node.config?.minSafeMarginKm ?? 15;

        return (
          <div className="space-y-3 text-xs leading-relaxed text-slate-300">
            <div className="rounded-lg bg-violet-950/30 border border-violet-800/40 p-3 space-y-2">
              <div className="font-semibold text-violet-300 flex items-center gap-1.5">
                <Compass className="h-4 w-4 text-violet-400" />
                <span>4D 时空空间几何求解器与在勤遵从判定数学模型</span>
              </div>
              <p className="text-[11px] text-slate-300">
                本算子利用高精计算几何与球面三角学算法，实时将作战单元在勤航迹点与空间任务走廊进行时空对齐与边界判定。
              </p>
            </div>

            {/* 数学与几何原理 */}
            <div className="space-y-2">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                <span>1. 动态点面包含判定原理 (Jordan Curve Theorem & Ray Casting)</span>
              </div>
              <p className="text-[11px] text-slate-400 pl-3">
                对作战单元航迹点 P(lon, lat)，向经度正向发射一条水平半无限射线，计算该射线与走廊多边形顶点环各边 (V_i, V_i+1) 的几何交点总数 N：
              </p>
              <div className="rounded-md bg-slate-950/80 border border-slate-800 px-3 py-2 font-mono text-[11px] text-violet-200 text-center">
                InCorridor(P) = ( CountIntersects(Ray(P), PolygonEdges) mod 2 ) === 1
              </div>
              <p className="text-[11px] text-slate-400 pl-3">
                若交点数为奇数，则严格判定在多边形内部；若为偶数，则判定越界违规。
              </p>
            </div>

            <div className="space-y-2">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                <span>2. 球面大圆测距与边界安全裕度模型 (Haversine Distance)</span>
              </div>
              <p className="text-[11px] text-slate-400 pl-3">
                计算战机点到走廊各折线段的最短球面法向垂距 d_min。采用 WGS-84 地球椭球球面大圆公式 (R ≈ 6371.0 km)：
              </p>
              <div className="rounded-md bg-slate-950/80 border border-slate-800 px-3 py-2 font-mono text-[11px] text-violet-200 text-center">
                d = 2R · arcsin( √( sin²(Δlat/2) + cos(lat₁)·cos(lat₂)·sin²(Δlon/2) ) )
              </div>
              <div className="rounded-md bg-slate-950/80 border border-slate-800 px-3 py-1.5 font-mono text-[11px] text-violet-200 text-center">
                Margin_km = InCorridor ? +(d_boundary - M_safe) : -(d_boundary + M_safe)
              </div>
              <p className="text-[11px] text-slate-400 pl-3">
                当前设定安全边界裕度阈值 M_safe = {marginKm} km。当 Margin_km &gt; 0 时处于安全走廊核心区，小于 0 时预警越界。
              </p>
            </div>

            <div className="space-y-2">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                <span>3. 时空在勤生命周期对齐机制 (Temporal Lifecycle Slicing)</span>
              </div>
              <p className="text-[11px] text-slate-400 pl-3">
                依据 <code className="text-cyan-300">MissionUnitRelationChanged</code> 表中单元分配与脱离时标 [T_assign, T_unassign]，自动截取有效在勤窗口，剔除起飞爬升与返航阶段：
              </p>
              <div className="rounded-md bg-slate-950/80 border border-slate-800 px-3 py-1.5 font-mono text-[11px] text-violet-200 text-center">
                UnitComplianceRate = ( ∑ InCorridor(t) · Δt ) / T_StationTotal
              </div>
            </div>

            {/* 运行机制时序拆解 */}
            <div className="rounded-lg bg-slate-900/60 border border-slate-800/80 p-2.5 space-y-1.5">
              <span className="font-semibold text-slate-300 text-[11px]">算子执行机制与流水线步骤：</span>
              <div className="grid grid-cols-4 gap-1.5 text-center text-[10px]">
                <div className="rounded bg-slate-800/80 p-1.5 border border-slate-700/60">
                  <span className="font-bold text-violet-300 block">① 参考点构网</span>
                  <span className="text-slate-400">{sourceMode === 'dynamic_table' ? '事件表动态排序' : '预设多边形'}</span>
                </div>
                <div className="rounded bg-slate-800/80 p-1.5 border border-slate-700/60">
                  <span className="font-bold text-violet-300 block">② 航迹时空过滤</span>
                  <span className="text-slate-400">生命周期时窗对齐</span>
                </div>
                <div className="rounded bg-slate-800/80 p-1.5 border border-slate-700/60">
                  <span className="font-bold text-violet-300 block">③ Turf.js 判定</span>
                  <span className="text-slate-400">射线交点+大圆测距</span>
                </div>
                <div className="rounded bg-slate-800/80 p-1.5 border border-slate-700/60">
                  <span className="font-bold text-violet-300 block">④ 衍生列分发</span>
                  <span className="text-slate-400">透传+注入遵从率</span>
                </div>
              </div>
            </div>
          </div>
        );
      }

      case 'inline_calc': {
        const cols = node.config?.derivedColumns || [];
        return (
          <div className="space-y-3 text-xs leading-relaxed text-slate-300">
            <div className="rounded-lg bg-cyan-950/30 border border-cyan-800/40 p-3 space-y-1.5">
              <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
                <Binary className="h-4 w-4 text-cyan-400" />
                <span>LibFormula 抽象语法树 (AST) 与逐行向量化求值机制</span>
              </div>
              <p className="text-[11px] text-slate-300">
                本算子基于 LibFormula 语法引擎，将配置的公式解析为抽象语法树 (AST)，解析变量字段符号绑定，并通过 Kahn 拓扑排序解决列间依赖关系，实现逐行向量化高速求值。
              </p>
            </div>

            <div className="space-y-2">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                <span>1. 公式求值模型与变量符号绑定</span>
              </div>
              <div className="rounded-md bg-slate-950/80 border border-slate-800 px-3 py-2 font-mono text-[11px] text-cyan-200 text-center">
                AST = Tokenize(expr) ➔ Parse(Tokens) ➔ BindSymbols(Row, Schema)
              </div>
              <p className="text-[11px] text-slate-400 pl-3">
                对于数据表中的每一行 $R_i$，将字段引用 $[ColName]$ 映射为行单元格实际浮点/字符串值，递归遍历 AST 节点执行函数与运算。
              </p>
            </div>

            <div className="space-y-2">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                <span>2. 当前已配置的衍生计算列 AST 状态 ({cols.length} 项)</span>
              </div>
              <div className="space-y-1.5">
                {cols.map((c, i) => (
                  <div key={c.name || i} className="rounded-md bg-slate-900/80 border border-slate-800 p-2 text-[11px]">
                    <div className="flex items-center justify-between font-mono">
                      <span className="text-cyan-300 font-bold">{c.name}</span>
                      <span className="text-slate-400">{c.dataType || 'number'}</span>
                    </div>
                    <div className="font-mono text-slate-300 mt-1 break-all bg-slate-950/60 p-1.5 rounded border border-slate-800/80">
                      {c.expression || '<未编写表达式>'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      }

      case 'group_agg': {
        const groupBys = node.config?.groupBy || [];
        const aggs = node.config?.aggregations || [];
        return (
          <div className="space-y-3 text-xs leading-relaxed text-slate-300">
            <div className="rounded-lg bg-amber-950/30 border border-amber-800/40 p-3 space-y-1.5">
              <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-amber-400" />
                <span>复合键哈希分桶与单趟流式聚合累加器模型</span>
              </div>
              <p className="text-[11px] text-slate-300">
                本算子采用 Hash Partitioning 聚合算法。先将输入数据按照复合主键进行哈希分区，然后在单个遍历趟次 (Single-Pass) 中维护各分桶统计累加器。
              </p>
            </div>

            <div className="space-y-2">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                <span>1. 在线流式均值与方差递推算法 (Welford's Algorithm)</span>
              </div>
              <div className="rounded-md bg-slate-950/80 border border-slate-800 px-3 py-2 font-mono text-[11px] text-amber-200 text-center">
                μ_n = μ_(n-1) + (x_n - μ_(n-1)) / n
              </div>
              <p className="text-[11px] text-slate-400 pl-3">
                避免大样本数值溢出或双精度下溢，保证在多推演轮次、高频海量航迹汇总时的数值稳定性与常数级 $O(1)$ 内存占用。
              </p>
            </div>

            <div className="space-y-2">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                <span>2. 当前分组聚合配置</span>
              </div>
              <div className="rounded-md bg-slate-900/80 border border-slate-800 p-2 text-[11px] space-y-1">
                <div>
                  <span className="text-slate-400">分组主键 (GroupBy Keys): </span>
                  <span className="font-mono text-amber-300">{groupBys.join(', ') || '全局不分组 (全量汇总)'}</span>
                </div>
                <div>
                  <span className="text-slate-400">聚合指标算子 (Aggregations): </span>
                  <span className="font-mono text-amber-200">
                    {aggs.map((a) => `${a.outputField || a.sourceField} = ${a.method}(${a.sourceField})`).join('; ') || '无'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      }

      case 'data_input': {
        const table = node.config?.csvTable || 'UnitPositions.csv';
        const filterField = node.config?.filterField;
        const filterVal = node.config?.filterEquals;
        const selectedCols = node.config?.selectedColumns || [];

        return (
          <div className="space-y-3 text-xs leading-relaxed text-slate-300">
            <div className="rounded-lg bg-blue-950/30 border border-blue-800/40 p-3 space-y-1.5">
              <div className="font-semibold text-blue-300 flex items-center gap-1.5">
                <BookOpen className="h-4 w-4 text-blue-400" />
                <span>规范事件表流式抽取、谓词过滤与列式投影掩码模型</span>
              </div>
              <p className="text-[11px] text-slate-300">
                依据《F1 仿真输出规范》定义，标准事件表包含前置系统想定标识与轮次字段 (Scenario, MC_Run, TimelineID, Time)。算子执行关系代数选择 $\sigma$ 与投影 $\Pi$ 运算。
              </p>
            </div>

            <div className="space-y-2">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                <span>1. 关系代数计算模型</span>
              </div>
              <div className="rounded-md bg-slate-950/80 border border-slate-800 px-3 py-2 font-mono text-[11px] text-blue-200 text-center">
                OutputDataset = Project( Filter( Table, {filterField ? `${filterField} == '${filterVal}'` : 'True'} ), [{selectedCols.slice(0, 4).join(', ')}...] )
              </div>
              <p className="text-[11px] text-slate-400 pl-3">
                采用列式内存掩码技术，零拷贝剔除未选中的冗余字段，保障高频航迹流接入时的最小传输与缓存开销。
              </p>
            </div>
          </div>
        );
      }

      case 'result_output': {
        const targetField = node.config?.targetField || 'value';
        return (
          <div className="space-y-3 text-xs leading-relaxed text-slate-300">
            <div className="rounded-lg bg-emerald-950/30 border border-emerald-800/40 p-3 space-y-1.5">
              <div className="font-semibold text-emerald-300 flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-emerald-400" />
                <span>效用函数极性归一化与三库指标直通模型</span>
              </div>
              <p className="text-[11px] text-slate-300">
                本算子作为流水线终点，负责将数据表聚合值转化为标准化综合指标效用值 $U \in [0, 100]$，支持 AHP 层次分析法和熵权法权重乘积。
              </p>
            </div>

            <div className="space-y-2">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span>1. 效用函数极性映射模型 (Utility Polarity Normalization)</span>
              </div>
              <div className="rounded-md bg-slate-950/80 border border-slate-800 px-3 py-2 font-mono text-[11px] text-emerald-200 text-center">
                正向效益型: U(x) = (x - x_min) / (x_max - x_min) × 100
              </div>
              <p className="text-[11px] text-slate-400 pl-3">
                目标输出字段: <code className="text-emerald-300 font-mono font-semibold">{targetField}</code>
              </p>
            </div>
          </div>
        );
      }

      case 'python_script': {
        return (
          <div className="space-y-3 text-xs leading-relaxed text-slate-300">
            <div className="rounded-lg bg-fuchsia-950/30 border border-fuchsia-800/40 p-3 space-y-1.5">
              <div className="font-semibold text-fuchsia-300 flex items-center gap-1.5">
                <Code2 className="h-4 w-4 text-fuchsia-400" />
                <span>Python 3.12 虚拟环境沙箱与 IPC 内存通信模型</span>
              </div>
              <p className="text-[11px] text-slate-300">
                本算子支持将上游表格数据序列化为结构化字典或 Pandas DataFrame，在隔离的 Python 3.12 科学计算子进程中执行复杂矩阵运算并回传。
              </p>
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-[#0a0f1d] overflow-hidden shadow-lg transition">
      {/* 折叠切换标题 */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between p-3 bg-slate-900/60 hover:bg-slate-800/50 transition text-left"
      >
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-cyan-400" />
          <span className="font-bold text-xs text-slate-200 tracking-wide">
            算法内部运算模型与执行机制透视
          </span>
          <span className="rounded bg-cyan-950 border border-cyan-800/80 px-1.5 py-0.2 text-[10px] text-cyan-300 font-mono">
            内部透明 · 拒绝黑盒
          </span>
        </div>
        <div className="text-slate-400">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>

      {/* 展开的算法原理与数学公式 */}
      {isExpanded && <div className="p-3.5 border-t border-slate-800/80">{renderMechanismContent()}</div>}
    </div>
  );
}
