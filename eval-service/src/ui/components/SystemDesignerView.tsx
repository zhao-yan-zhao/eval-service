import {
  AlertTriangle,
  Award,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileCode,
  FolderTree,
  GitBranch,
  Layers,
  Network,
  Pencil,
  Play,
  RotateCw,
  Save,
  Scale,
  Sliders,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  evalApi,
  type IndicatorDefinition,
  type IndicatorSystem,
  type MetricAtomMeta,
  type StoredRunSummary,
  type SystemEvaluationOutput,
} from '../api.ts';
import type {
  EvaluatedDimensionNode,
  EvaluatedLeafNode,
  SystemDimensionNode,
  SystemIndicatorLeaf,
} from '../../core/types.ts';
import {
  SystemHierarchyTree,
  SystemTopologyChart,
  SystemNodeDetailPanel,
  flattenSystemTree,
  type FlatTreeNode,
} from './systems/index.ts';

export interface SystemDesignerViewProps {
  systems: IndicatorSystem[];
  indicators: IndicatorDefinition[];
  selectedSystemId: string;
  onSelectSystem: (id: string) => void;
  onRefresh: () => Promise<void>;
  operators?: MetricAtomMeta[];
  runs?: StoredRunSummary[];
  selectedRunId?: string;
  onNavigateToTab?: (tab: 'operators' | 'indicators', targetId?: string) => void;
}

function isDim(n: SystemDimensionNode | SystemIndicatorLeaf): n is SystemDimensionNode {
  return typeof n === 'object' && n !== null && 'children' in n && Array.isArray((n as SystemDimensionNode).children);
}

function findDimensionNode(
  root: { id?: string; name: string; children: Array<SystemDimensionNode | SystemIndicatorLeaf> },
  targetId: string,
): { id: string; name: string; children: Array<SystemDimensionNode | SystemIndicatorLeaf> } | null {
  if (targetId === 'root' || (root.id && targetId === root.id)) {
    return { id: root.id ?? 'root', name: root.name, children: root.children };
  }
  const search = (
    children: Array<SystemDimensionNode | SystemIndicatorLeaf>,
  ): { id: string; name: string; children: Array<SystemDimensionNode | SystemIndicatorLeaf> } | null => {
    for (const ch of children) {
      if (isDim(ch)) {
        if (ch.id === targetId) return ch;
        const sub = search(ch.children);
        if (sub) return sub;
      }
    }
    return null;
  };
  return search(root.children);
}

const NL_PRESET_PROMPTS = [
  '面向超视距空战 (BVR)，强化先敌发现、导弹命中率、防区外发射裕度与耗弹经济约束',
  '海上反潜巡逻封锁任务：重点考评无线电静默纪律、丢批失锁盲区时长与封锁区覆盖率',
  '近岸无人集群饱和突击：重视多平台同步到达收敛、编队离散度与走廊空间合规率',
];

const SAATY_CHOICES = [
  { val: 9, label: '9 (极端重要)' },
  { val: 7, label: '7 (强烈重要)' },
  { val: 5, label: '5 (明显重要)' },
  { val: 3, label: '3 (略微重要)' },
  { val: 1, label: '1 (同等重要)' },
  { val: 1 / 3, label: '1/3 (略次要)' },
  { val: 1 / 5, label: '1/5 (明显次要)' },
  { val: 1 / 7, label: '1/7 (强烈次要)' },
  { val: 1 / 9, label: '1/9 (极端次要)' },
];

function extractScoresFromEvaluation(output: SystemEvaluationOutput): Record<string, number> {
  const scores: Record<string, number> = {};
  if (typeof output.overallScore === 'number') {
    scores[output.systemId] = output.overallScore;
    scores['root'] = output.overallScore;
  }
  for (const d of output.dimensions || []) {
    if (typeof d.score === 'number') {
      scores[d.id] = d.score;
      scores[d.name] = d.score;
    }
  }

  function walk(children: Array<EvaluatedDimensionNode | EvaluatedLeafNode>) {
    for (const c of children) {
      if (c.kind === 'dimension') {
        if (typeof c.score === 'number') {
          scores[c.id] = c.score;
          scores[c.name] = c.score;
        }
        if (c.children) walk(c.children);
      } else if (c.kind === 'indicator') {
        if (typeof c.score === 'number') {
          scores[c.indicatorRef] = c.score;
          if (c.atomRef) scores[c.atomRef] = c.score;
        }
      }
    }
  }

  if (output.rootTree?.children) {
    walk(output.rootTree.children);
  }

  if (output.atomResults) {
    for (const [atomKey, res] of Object.entries(output.atomResults)) {
      if (typeof res?.value === 'number') {
        scores[atomKey] = res.value;
      }
    }
  }

  return scores;
}

export function SystemDesignerView({
  systems,
  indicators,
  selectedSystemId,
  onSelectSystem,
  onRefresh,
  operators = [],
  runs = [],
  selectedRunId = '',
  onNavigateToTab,
}: SystemDesignerViewProps) {
  const sourceSystem = useMemo(
    () => systems.find((s) => s.systemId === selectedSystemId) ?? systems[0],
    [systems, selectedSystemId],
  );

  const [draft, setDraft] = useState<IndicatorSystem | null>(
    sourceSystem ? structuredClone(sourceSystem) : null,
  );
  const [validation, setValidation] = useState<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // 视图模式：'tree' (层级结构树) | 'topology' (全景拓扑图)
  const [viewMode, setViewMode] = useState<'tree' | 'topology'>('tree');
  const [selectedNode, setSelectedNode] = useState<FlatTreeNode | null>(null);

  // 评估推演试算状态
  const [activeRunId, setActiveRunId] = useState(selectedRunId || (runs[0]?.runId ?? ''));
  const [evaluating, setEvaluating] = useState(false);
  const [evalScores, setEvalScores] = useState<Record<string, number>>({});
  const [lastEvalOutput, setLastEvalOutput] = useState<SystemEvaluationOutput | null>(null);

  // NL-to-Metrics 意图工坊状态
  const [nlPrompt, setNlPrompt] = useState(NL_PRESET_PROMPTS[0]);
  const [nlLoading, setNlLoading] = useState(false);
  const [nlPreview, setNlPreview] = useState<{
    system: IndicatorSystem;
    rationale: string;
    matchedDomains: string[];
  } | null>(null);

  // AHP 原生 <dialog> 状态（支持根节点与任意多子节点维度）
  const ahpDialogRef = useRef<HTMLDialogElement | null>(null);
  const [ahpTargetId, setAhpTargetId] = useState<string>('root');
  const [ahpMatrix, setAhpMatrix] = useState<number[][]>([]);
  const [ahpLoading, setAhpLoading] = useState(false);
  const [ahpRes, setAhpRes] = useState<{
    weights: number[];
    lambdaMax: number;
    ci: number;
    ri: number;
    cr: number;
    consistent: boolean;
  } | null>(null);

  // 客观 / 主客观组合赋权 <dialog> 状态
  const objDialogRef = useRef<HTMLDialogElement | null>(null);
  const [objTargetId, setObjTargetId] = useState<string>('root');
  const [objMethod, setObjMethod] = useState<'entropy' | 'critic' | 'combined'>('entropy');
  const [objBaseMethod, setObjBaseMethod] = useState<'entropy' | 'critic'>('entropy');
  const [objAlpha, setObjAlpha] = useState<number>(0.5);
  const [objRunIds, setObjRunIds] = useState<string[]>([]);
  const [objLoading, setObjLoading] = useState(false);
  const [objRes, setObjRes] = useState<{
    method: 'entropy' | 'critic' | 'combined';
    targetIds: string[];
    targetNames: string[];
    runs: string[];
    matrix: number[][];
    weights: number[];
    objectiveWeights: number[];
    diagnostics: Record<string, unknown>;
  } | null>(null);

  // JSON 导入文件输入框 ref
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const indicatorMap = useMemo(
    () => new Map(indicators.map((i) => [i.indicatorId, i])),
    [indicators],
  );

  useEffect(() => {
    if (selectedRunId) {
      setActiveRunId(selectedRunId);
    } else if (runs.length > 0 && !activeRunId) {
      setActiveRunId(runs[0].runId);
    }
  }, [selectedRunId, runs, activeRunId]);

  useEffect(() => {
    if (sourceSystem) {
      const cloned = structuredClone(sourceSystem);
      setDraft(cloned);
      setValidation(null);
      setStatusMsg(null);
      setLastEvalOutput(null);
      setEvalScores({});
      const flat = flattenSystemTree(cloned, indicatorMap);
      setSelectedNode(flat[0] ?? null);
    }
  }, [sourceSystem, indicatorMap]);

  // 自动同步库中已有 (sourceSystem.systemId, activeRunId) 最新评估结果与节点得分
  useEffect(() => {
    if (!sourceSystem?.systemId || !activeRunId) return;
    let cancelled = false;
    evalApi
      .listEvaluations(activeRunId)
      .then(async (res) => {
        if (cancelled) return;
        const matched = res.evaluations.find((ev) => ev.systemId === sourceSystem.systemId);
        if (!matched) return;
        const detail = await evalApi.getEvaluation(matched.evalId);
        if (cancelled || !detail?.output) return;
        setLastEvalOutput(detail.output);
        setEvalScores(extractScoresFromEvaluation(detail.output));
      })
      .catch(() => {
        // 忽略静默同步失败
      });
    return () => {
      cancelled = true;
    };
  }, [sourceSystem?.systemId, activeRunId]);

  // 当 draft 改变时，保持选中节点同步
  useEffect(() => {
    if (!draft) return;
    const flat = flattenSystemTree(draft, indicatorMap, evalScores);
    if (selectedNode) {
      const matched = flat.find((n) => n.id === selectedNode.id);
      if (matched) {
        setSelectedNode(matched);
        return;
      }
    }
    if (flat.length > 0 && !selectedNode) {
      setSelectedNode(flat[0]);
    }
  }, [draft, indicatorMap, evalScores, selectedNode]);

  const rootWeightSum = useMemo(() => {
    if (!draft) return 0;
    return draft.root.children.reduce((acc, c) => acc + (Number(c.weight) || 0), 0);
  }, [draft]);

  const handleUpdateRootWeight = (idx: number, val: number) => {
    if (!draft) return;
    const next = structuredClone(draft);
    next.root.children[idx].weight = Math.max(0.01, val);
    setDraft(next);
  };

  const handleUpdateLeafWeight = (dimIdx: number, leafIdx: number, val: number) => {
    if (!draft) return;
    const next = structuredClone(draft);
    const parent = next.root.children[dimIdx];
    if (isDim(parent) && parent.children[leafIdx]) {
      parent.children[leafIdx].weight = Math.max(0.01, val);
    }
    setDraft(next);
  };

  const handleNodeWeightUpdate = (nodeId: string, newWeight: number) => {
    if (!draft) return;
    const next = structuredClone(draft);
    const safeWeight = Math.max(0.01, Number(newWeight) || 0.01);

    // 1. 检查是否为顶层维度
    const dimIdx = next.root.children.findIndex((c) => isDim(c) && c.id === nodeId);
    if (dimIdx >= 0) {
      next.root.children[dimIdx].weight = safeWeight;
      setDraft(next);
      return;
    }

    // 2. 检查是否为叶子指标
    for (const d of next.root.children) {
      if (isDim(d)) {
        const leaf = d.children.find((l) => !isDim(l) && l.indicatorRef === nodeId);
        if (leaf) {
          leaf.weight = safeWeight;
          setDraft(next);
          return;
        }
      }
    }
  };

  const handleValidateAndNormalize = async (autoNormalize: boolean) => {
    if (!draft) return;
    setStatusMsg(null);
    try {
      const res = await evalApi.validateSystem(draft, autoNormalize);
      setDraft(res.system);
      setValidation(res.validation);
      if (autoNormalize) {
        setStatusMsg({ kind: 'ok', text: '已完成逐层权重自动归一化 (∑ = 1.0000)' });
      }
    } catch (e) {
      setStatusMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleSaveCustomSystem = async () => {
    if (!draft) return;
    setStatusMsg(null);
    try {
      const toSave = structuredClone(draft);
      if (toSave.builtin) {
        toSave.systemId = `${toSave.systemId}_custom_${Date.now().toString(36).slice(-4)}`;
        toSave.name = `${toSave.name} (定制版)`;
        toSave.builtin = false;
      }
      const norm = await evalApi.validateSystem(toSave, true);
      if (!norm.validation.valid) {
        setValidation(norm.validation);
        setStatusMsg({ kind: 'err', text: norm.validation.errors.join('；') });
        return;
      }
      const saved = await evalApi.upsertSystem(norm.system);
      await onRefresh();
      onSelectSystem(saved.system.systemId);
      setStatusMsg({ kind: 'ok', text: `已保存定制评估体系「${saved.system.name}」` });
    } catch (e) {
      setStatusMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleDeleteSystem = async (sysId: string) => {
    setStatusMsg(null);
    try {
      await evalApi.deleteSystem(sysId);
      await onRefresh();
      setStatusMsg({ kind: 'ok', text: `已删除定制体系 ${sysId}` });
    } catch (e) {
      setStatusMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleRunEvaluation = async () => {
    if (!draft) return;
    const runIdToUse = activeRunId || runs[0]?.runId || 'gj11_pl15_bvr_real';
    setEvaluating(true);
    setStatusMsg(null);
    try {
      const res = await evalApi.runEvaluate({
        runId: runIdToUse,
        systemId: draft.systemId,
      });
      setLastEvalOutput(res.output);
      const extracted = extractScoresFromEvaluation(res.output);
      setEvalScores(extracted);
      setStatusMsg({
        kind: 'ok',
        text: `体系推演评估完成！Run: ${runIdToUse}，综合评分: ${
          typeof res.output.overallScore === 'number'
            ? res.output.overallScore.toFixed(1)
            : 'N/A'
        } 分`,
      });
    } catch (e) {
      setStatusMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setEvaluating(false);
    }
  };

  const handleExportJson = () => {
    if (!draft) return;
    const jsonStr = JSON.stringify(draft, null, 2);
    try {
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${draft.systemId || 'system'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
    navigator.clipboard?.writeText?.(jsonStr);
    setStatusMsg({ kind: 'ok', text: `已导出体系「${draft.name}」JSON 配置（已下载并复制到剪贴板）` });
  };

  const handleNlGenerate = async () => {
    if (!nlPrompt.trim()) return;
    setNlLoading(true);
    setStatusMsg(null);
    try {
      const res = await evalApi.draftSystemNl(nlPrompt);
      setNlPreview({
        system: res.system,
        rationale: res.rationale,
        matchedDomains: res.matchedDomains,
      });
    } catch (e) {
      setStatusMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setNlLoading(false);
    }
  };

  const handleAdoptNlDraft = async () => {
    if (!nlPreview) return;
    try {
      const saved = await evalApi.upsertSystem(nlPreview.system);
      await onRefresh();
      onSelectSystem(saved.system.systemId);
      setNlPreview(null);
      setStatusMsg({ kind: 'ok', text: `已保存新建评估体系「${saved.system.name}」` });
    } catch (e) {
      setStatusMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const resolveDefaultTargetDimId = (): string => {
    if (!draft) return 'root';
    if (selectedNode?.kind === 'dimension') {
      const found = findDimensionNode(draft.root, selectedNode.id);
      if (found && found.children.length >= 2) {
        return found.id;
      }
    }
    return 'root';
  };

  // 所有可用于赋权的维度列表（根节点 + 所有子项 >= 2 的子维度）
  const multiChildDimensions = useMemo(() => {
    if (!draft) return [];
    const list: Array<{ id: string; name: string; count: number }> = [
      { id: 'root', name: `${draft.root.name}（一级维度）`, count: draft.root.children.length },
    ];
    const walk = (children: Array<SystemDimensionNode | SystemIndicatorLeaf>) => {
      for (const ch of children) {
        if (isDim(ch)) {
          if (ch.children.length >= 2) {
            list.push({ id: ch.id, name: ch.name, count: ch.children.length });
          }
          walk(ch.children);
        }
      }
    };
    walk(draft.root.children);
    return list;
  }, [draft]);

  const ahpTargetChildren = useMemo(
    () => (draft ? (findDimensionNode(draft.root, ahpTargetId)?.children ?? draft.root.children) : []),
    [draft, ahpTargetId],
  );

  const objTargetChildren = useMemo(
    () => (draft ? (findDimensionNode(draft.root, objTargetId)?.children ?? draft.root.children) : []),
    [draft, objTargetId],
  );

  const initAhpMatrixForTarget = (targetId: string) => {
    if (!draft) return;
    const targetNode = findDimensionNode(draft.root, targetId);
    const children = targetNode?.children ?? draft.root.children;
    const n = children.length;
    const mat = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (__, j) => {
        if (i === j) return 1;
        const wi = children[i].weight || 1 / Math.max(n, 1);
        const wj = children[j].weight || 1 / Math.max(n, 1);
        return Math.max(1 / 9, Math.min(9, Math.round((wi / wj) * 100) / 100));
      }),
    );
    setAhpTargetId(targetId);
    setAhpMatrix(mat);
    setAhpRes(null);
    setAhpLoading(false);
  };

  const openAhpDialog = () => {
    if (!draft) return;
    const targetId = resolveDefaultTargetDimId();
    initAhpMatrixForTarget(targetId);
    ahpDialogRef.current?.showModal();
  };

  const updateAhpPair = (i: number, j: number, val: number) => {
    setAhpMatrix((prev) => {
      const next = prev.map((row) => [...row]);
      next[i][j] = val;
      next[j][i] = Math.round((1 / val) * 10000) / 10000;
      return next;
    });
  };

  const runAhpSolve = async () => {
    if (!draft) return;
    setAhpLoading(true);
    try {
      const targetNode = findDimensionNode(draft.root, ahpTargetId);
      const children = targetNode?.children ?? draft.root.children;
      const names = children.map((c) =>
        isDim(c) ? c.name : c.customLabel || indicatorMap.get(c.indicatorRef)?.name || c.indicatorRef,
      );
      const res = await evalApi.computeAhp(ahpMatrix, names);
      setAhpRes(res);
    } catch (e) {
      setStatusMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setAhpLoading(false);
    }
  };

  const applyAhpWeightsToDraft = () => {
    if (!draft || !ahpRes) return;
    const next = structuredClone(draft);
    const targetNode = findDimensionNode(next.root, ahpTargetId);
    if (!targetNode) return;
    targetNode.children.forEach((ch, idx) => {
      if (ahpRes.weights[idx] !== undefined) {
        ch.weight = ahpRes.weights[idx];
      }
    });
    setDraft(next);
    ahpDialogRef.current?.close();
    setStatusMsg({
      kind: 'ok',
      text: `已将 AHP 特征根权重应用至「${targetNode.name}」（CR = ${ahpRes.cr.toFixed(4)}）`,
    });
  };

  // ─── 客观 / 主客观组合赋权 ───
  const openObjDialog = () => {
    if (!draft) return;
    const targetId = resolveDefaultTargetDimId();
    setObjTargetId(targetId);
    setObjRunIds(runs.map((r) => r.runId));
    setObjRes(null);
    setObjLoading(false);
    objDialogRef.current?.showModal();
  };

  const runObjSolve = async () => {
    if (!draft) return;
    if (objRunIds.length < 2) {
      setStatusMsg({ kind: 'err', text: '客观/组合赋权至少需要勾选 2 局推演 Run 进行横向对比' });
      return;
    }
    setObjLoading(true);
    try {
      const targetNode = findDimensionNode(draft.root, objTargetId);
      const children = targetNode?.children ?? draft.root.children;
      const dimensionIds = children.map((c) => (isDim(c) ? c.id : c.indicatorRef));
      const subjectiveWeights = children.map((c) => c.weight);
      const res = await evalApi.computeObjectiveWeights({
        system: draft,
        dimensionIds,
        runIds: objRunIds,
        method: objMethod,
        objectiveMethod: objBaseMethod,
        subjectiveWeights,
        alpha: objAlpha,
      });
      setObjRes(res);
    } catch (e) {
      setStatusMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setObjLoading(false);
    }
  };

  const applyObjWeightsToDraft = () => {
    if (!draft || !objRes) return;
    const next = structuredClone(draft);
    const targetNode = findDimensionNode(next.root, objTargetId);
    if (!targetNode) return;
    targetNode.children.forEach((ch, idx) => {
      if (objRes.weights[idx] !== undefined) {
        ch.weight = objRes.weights[idx];
      }
    });
    setDraft(next);
    objDialogRef.current?.close();
    const label =
      objRes.method === 'entropy' ? '熵权法' : objRes.method === 'critic' ? 'CRITIC' : '主客观组合';
    setStatusMsg({
      kind: 'ok',
      text: `已将 ${label} 权重应用至「${targetNode.name}」`,
    });
  };

  const handleCloneSystem = async () => {
    if (!draft) return;
    try {
      const cloned: IndicatorSystem = {
        ...structuredClone(draft),
        systemId: `sys-clone-${Date.now()}`,
        name: `${draft.name} (副本)`,
        builtin: false,
      };
      const saved = await evalApi.upsertSystem(cloned);
      await onRefresh();
      onSelectSystem(saved.system.systemId);
      setStatusMsg({ kind: 'ok', text: `已克隆并保存新体系「${saved.system.name}」` });
    } catch (e) {
      setStatusMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleImportJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as IndicatorSystem;
      if (!parsed || typeof parsed !== 'object' || !parsed.root || !Array.isArray(parsed.root.children)) {
        throw new Error('无效的评估体系 JSON 格式（缺少 root.children）');
      }
      if (!parsed.systemId) parsed.systemId = `sys-import-${Date.now()}`;
      if (!parsed.name) parsed.name = file.name.replace(/\.json$/i, '');
      parsed.builtin = false;
      const saved = await evalApi.upsertSystem(parsed);
      await onRefresh();
      onSelectSystem(saved.system.systemId);
      setStatusMsg({ kind: 'ok', text: `已导入并保存评估体系「${saved.system.name}」` });
    } catch (err) {
      setStatusMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
      {/* 左栏：体系目录 + 模板匹配 */}
      <aside className="min-w-0 space-y-3.5 lg:col-span-3 panel-isolate">
        <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5">
          <h2 className="mb-2.5 flex items-center gap-1.5 text-sm font-semibold text-slate-100">
            <GitBranch className="h-4 w-4 text-blue-400" />
            评估体系列表 ({systems.length})
          </h2>
          <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-0.5">
            {systems.map((s) => {
              const active = s.systemId === draft?.systemId;
              return (
                <div
                  key={s.systemId}
                  onClick={() => onSelectSystem(s.systemId)}
                  className={`cursor-pointer rounded-md border p-2.5 transition ${
                    active
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-[#262d38] bg-[#0f141a] hover:border-[#374151]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="truncate text-xs font-medium text-slate-100 block">
                        {s.name}
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            s.builtin ? 'bg-[#1c2128] text-[#8b949e]' : 'bg-blue-500/15 text-blue-300'
                          }`}
                        >
                          {s.builtin ? '预置' : '自定义'}
                        </span>
                        {s.targetTags?.slice(0, 2).map((t) => (
                          <span
                            key={t}
                            className="rounded bg-[#1c2128] px-1.5 py-0.5 text-[10px] text-[#8b949e]"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                    {!s.builtin && (
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          void handleDeleteSystem(s.systemId);
                        }}
                        className="rounded p-1 text-[#8b949e] hover:bg-rose-500/15 hover:text-rose-300"
                        aria-label={`删除体系 ${s.name}`}
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

        {/* 任务描述快速匹配模板 */}
        <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5">
          <h3 className="text-sm font-semibold text-slate-100">
            按任务描述匹配体系模板
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-[#8b949e]">
            输入作战任务目标与关注重点，系统将智能匹配领域权重与指标，快速生成体系模板。
          </p>

          <textarea
            rows={3}
            required
            value={nlPrompt}
            onChange={(e) => setNlPrompt(e.target.value)}
            placeholder="例如：评估海上无人艇集群在复杂防空网下的协同突防与经济效费…"
            className="mt-2.5 w-full rounded-md border border-[#30363d] bg-[#0f141a] p-2.5 text-xs text-[#e6edf3] focus:border-blue-500 focus:outline-none"
          />

          <div className="mt-2 flex flex-wrap gap-1.5">
            {NL_PRESET_PROMPTS.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setNlPrompt(p)}
                className="rounded border border-[#30363d] bg-[#0f141a] px-2 py-0.5 text-[11px] text-slate-300 hover:border-blue-500"
              >
                {i === 0 ? '空战模板' : i === 1 ? '反潜模板' : '集群模板'}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={nlLoading}
            onClick={handleNlGenerate}
            className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {nlLoading ? '匹配生成中…' : '生成体系草案'}
          </button>

          {nlPreview && (
            <div className="mt-2.5 space-y-2 rounded-md border border-emerald-500/30 bg-[#0f141a] p-2.5 text-xs">
              <div className="font-semibold text-emerald-300">
                草案已生成：{nlPreview.system.name}
              </div>
              <p className="text-[11px] leading-relaxed text-slate-300">{nlPreview.rationale}</p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setDraft(nlPreview.system)}
                  className="flex-1 rounded border border-[#30363d] bg-[#161b22] py-1.5 text-[11px] text-slate-200 hover:border-slate-500"
                >
                  预览到右侧树
                </button>
                <button
                  type="button"
                  onClick={handleAdoptNlDraft}
                  className="flex-1 rounded bg-emerald-600 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-500"
                >
                  确认并保存体系
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* 右栏：体系层级树/拓扑图 + 节点属性面板 + AHP 与评估工具栏 */}
      <section className="min-w-0 space-y-3.5 lg:col-span-9 panel-isolate">
        {draft && (
          <div className="rounded-lg border border-[#2a313c] bg-[#161b22] p-3.5">
            {/* 体系标题与主工具栏 */}
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#262d38] pb-3">
              <div className="group relative min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    className="w-full rounded border border-transparent bg-transparent py-0.5 text-sm font-semibold text-slate-100 hover:border-slate-700 hover:bg-[#0f141a]/60 focus:border-blue-500 focus:bg-[#0f141a] focus:px-2 focus:outline-none sm:text-base transition"
                    title="点击可编辑此体系名称"
                  />
                  <Pencil className="h-3.5 w-3.5 text-slate-500 group-hover:text-slate-400 shrink-0 pointer-events-none" />
                </div>
                <p className="mt-1 text-xs text-[#8b949e]">{draft.description}</p>
              </div>

              {/* 核心操作按钮：按功能分区布局 */}
              <div className="flex flex-wrap items-center gap-2.5">
                {/* 分区 1：视图模式分段切换器 */}
                <div className="inline-flex rounded-md border border-[#30363d] bg-[#0d1117] p-0.5 shadow-inner">
                  <button
                    type="button"
                    onClick={() => setViewMode('tree')}
                    className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition ${
                      viewMode === 'tree'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-[#8b949e] hover:text-[#e6edf3]'
                    }`}
                    aria-label="层级结构树"
                  >
                    <FolderTree className="h-3.5 w-3.5" />
                    层级结构树
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('topology')}
                    className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition ${
                      viewMode === 'topology'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-[#8b949e] hover:text-[#e6edf3]'
                    }`}
                    aria-label="全景拓扑图"
                  >
                    <Network className="h-3.5 w-3.5" />
                    全景拓扑图
                  </button>
                </div>

                <div className="h-4 w-px bg-[#30363d] hidden sm:block" />

                {/* 分区 2：评估试算触发区 */}
                <div className="inline-flex items-center gap-1.5">
                  {runs.length > 0 && (
                    <select
                      value={activeRunId}
                      onChange={(e) => setActiveRunId(e.target.value)}
                      className="rounded border border-[#30363d] bg-[#0f141a] px-2 py-1 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
                      title="选择评估对比的推演 Run"
                    >
                      {runs.map((r) => (
                        <option key={r.runId} value={r.runId}>
                          {r.scenarioName || r.runId}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    type="button"
                    disabled={evaluating}
                    onClick={handleRunEvaluation}
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50"
                    title="调用 /api/evaluate 接口对当前评估体系运行综合试算"
                  >
                    <Play className={`h-3.5 w-3.5 ${evaluating ? 'animate-spin' : ''}`} />
                    {evaluating ? '评估中…' : '运行体系评估'}
                  </button>
                </div>

                <div className="h-4 w-px bg-[#30363d] hidden sm:block" />

                {/* 分区 3：定权与辅助工具区 */}
                <div className="inline-flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={openAhpDialog}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#0f141a] px-2.5 py-1 text-xs font-medium text-amber-300 hover:border-amber-500/60"
                  >
                    <Scale className="h-3.5 w-3.5" />
                    AHP 矩阵定权助手
                  </button>

                  <button
                    type="button"
                    onClick={openObjDialog}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#0f141a] px-2.5 py-1 text-xs font-medium text-cyan-300 hover:border-cyan-500/60"
                    title="基于多局实测数据使用熵权法 / CRITIC / 组合赋权"
                  >
                    <Sliders className="h-3.5 w-3.5" />
                    客观/组合定权
                  </button>

                  <button
                    type="button"
                    onClick={() => handleValidateAndNormalize(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#0f141a] px-2.5 py-1 text-xs text-slate-200 hover:border-slate-500"
                    title="权重自动归一化 (各层求和为 1.0)"
                  >
                    <Calculator className="h-3.5 w-3.5" />
                    自动归一化
                  </button>

                  <button
                    type="button"
                    onClick={handleExportJson}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#0f141a] px-2 py-1 text-xs text-slate-300 hover:border-slate-500"
                    title="导出体系 JSON 配置文件"
                  >
                    <Download className="h-3.5 w-3.5" />
                    导出
                  </button>

                  <button
                    type="button"
                    onClick={() => importFileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#0f141a] px-2 py-1 text-xs text-slate-300 hover:border-slate-500"
                    title="导入体系 JSON 配置文件"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    导入
                  </button>
                  <input
                    ref={importFileInputRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={handleImportJsonFile}
                    className="hidden"
                  />

                  <button
                    type="button"
                    onClick={handleCloneSystem}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#0f141a] px-2 py-1 text-xs text-slate-300 hover:border-slate-500"
                    title="将当前评估体系克隆为新体系"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    克隆
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveCustomSystem}
                    className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white shadow-sm hover:bg-blue-500"
                  >
                    <Save className="h-3.5 w-3.5" />
                    保存体系
                  </button>
                </div>
              </div>
            </div>

            {/* 权重和与评估状态指示条 */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#262d38] bg-[#0f141a] px-3 py-2 text-xs">
              <div className="flex items-center gap-3">
                <span className="text-gray-400">一级维度权重合计（需等于 1.0000）:</span>
                <span
                  className={`tabular-nums font-mono font-semibold ${
                    Math.abs(rootWeightSum - 1) <= 1e-4 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {rootWeightSum.toFixed(4)} ({(rootWeightSum * 100).toFixed(1)}%)
                </span>
              </div>

              {lastEvalOutput && typeof lastEvalOutput.overallScore === 'number' && (
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 text-amber-400" />
                  <span className="text-gray-300">最新综合得分:</span>
                  <span className="font-mono text-sm font-bold text-emerald-400">
                    {lastEvalOutput.overallScore.toFixed(1)} 分
                  </span>
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                    置信度: {lastEvalOutput.overallConfidence}
                  </span>
                </div>
              )}
            </div>

            {validation && !validation.valid && (
              <div className="mt-2 rounded-md border border-rose-500/40 bg-rose-500/10 p-2.5 text-xs text-rose-200">
                校验未通过：{validation.errors.join('；')}
              </div>
            )}

            {statusMsg && (
              <div
                className={`mt-2 rounded-md p-2.5 text-xs ${
                  statusMsg.kind === 'ok'
                    ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                    : 'border border-rose-500/40 bg-rose-500/10 text-rose-200'
                }`}
              >
                {statusMsg.text}
              </div>
            )}

            {/* 核心双栏交互区域：左侧 树/拓扑图 + 右侧 节点属性详情面板 */}
            <div className="mt-3.5 grid grid-cols-1 gap-3.5 xl:grid-cols-12 min-h-[580px]">
              {/* 左栏：层级树 / 拓扑图 */}
              <div className="xl:col-span-7 min-w-0 flex flex-col h-[640px]">
                {viewMode === 'tree' ? (
                  <SystemHierarchyTree
                    system={draft}
                    indicatorMap={indicatorMap}
                    evalScores={evalScores}
                    selectedNodeId={selectedNode?.id}
                    onSelectNode={setSelectedNode}
                    className="flex-1"
                  />
                ) : (
                  <SystemTopologyChart
                    system={draft}
                    indicatorMap={indicatorMap}
                    evalScores={evalScores}
                    selectedNodeId={selectedNode?.id}
                    onSelectNode={setSelectedNode}
                    height="100%"
                    className="flex-1"
                  />
                )}
              </div>

              {/* 右栏：节点详情面板 */}
              <div className="xl:col-span-5 min-w-0 flex flex-col h-[640px]">
                <SystemNodeDetailPanel
                  node={selectedNode}
                  system={draft}
                  indicatorMap={indicatorMap}
                  operators={operators}
                  evalScores={evalScores}
                  onClose={() => setSelectedNode(null)}
                  onSelectNode={setSelectedNode}
                  onUpdateWeight={handleNodeWeightUpdate}
                  onNavigateToTab={onNavigateToTab}
                  className="h-full"
                />
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 原生 HTML <dialog>：AHP 成对比较矩阵定权助手（支持任意多子节点维度） */}
      <dialog ref={ahpDialogRef} className="w-full max-w-3xl p-4">
        <div className="flex items-start justify-between gap-3 border-b border-[#2a313c] pb-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100 sm:text-base">
              <Scale className="h-4 w-4 text-amber-400" />
              AHP 成对比较定权
            </h3>
            <p className="mt-0.5 text-xs text-[#8b949e]">
              调整上三角 i 行相对于 j 列的重要度（1~9 标度），自动镜像下三角并检验一致性比率 CR &lt; 0.10。
            </p>
          </div>
          <button
            type="button"
            onClick={() => ahpDialogRef.current?.close()}
            className="rounded p-1 text-[#8b949e] hover:bg-[#1c2128] hover:text-white"
            aria-label="关闭弹窗"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {draft && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[#8b949e]">作用层级节点：</span>
            <select
              value={ahpTargetId}
              onChange={(e) => initAhpMatrixForTarget(e.target.value)}
              className="rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1 text-slate-200 focus:border-amber-500 focus:outline-none"
            >
              {multiChildDimensions.map((dim) => (
                <option key={dim.id} value={dim.id}>
                  {dim.name} ({dim.count} 项)
                </option>
              ))}
            </select>
          </div>
        )}

        {draft && ahpMatrix.length > 0 && (
          <div className="mt-3.5 space-y-3.5">
            <div className="responsive-table-wrap rounded-md border border-[#2a313c]" tabIndex={0}>
              <table className="w-full text-center text-xs">
                <thead className="bg-[#0f141a] text-slate-300">
                  <tr>
                    <th scope="col" className="px-2 py-2 text-left">
                      维度/指标对比
                    </th>
                    {ahpTargetChildren.map((c) => {
                      const fullName = isDim(c)
                        ? c.name
                        : c.customLabel || indicatorMap.get(c.indicatorRef)?.name || c.indicatorRef;
                      return (
                        <th
                          key={isDim(c) ? c.id : c.indicatorRef}
                          scope="col"
                          className="px-2 py-2"
                          title={fullName}
                        >
                          <span className="inline-block max-w-[80px] truncate align-middle">
                            {fullName}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#262d38]">
                  {ahpTargetChildren.map((rowNode, i) => {
                    const rowName = isDim(rowNode)
                      ? rowNode.name
                      : rowNode.customLabel ||
                        indicatorMap.get(rowNode.indicatorRef)?.name ||
                        rowNode.indicatorRef;
                    return (
                      <tr key={isDim(rowNode) ? rowNode.id : `${rowNode.indicatorRef}-${i}`}>
                        <th
                          scope="row"
                          className="whitespace-nowrap px-2 py-2 text-left text-blue-300"
                          title={rowName}
                        >
                          <span className="inline-block max-w-[120px] truncate align-middle">
                            {rowName}
                          </span>
                        </th>
                        {ahpTargetChildren.map((_, j) => (
                          <td key={j} className="px-1.5 py-1.5">
                            {i === j ? (
                              <span className="tabular-nums font-mono text-slate-500">1</span>
                            ) : i < j ? (
                              <select
                                value={ahpMatrix[i]?.[j] ?? 1}
                                onChange={(e) => updateAhpPair(i, j, Number(e.target.value))}
                                className="tabular-nums rounded border border-[#30363d] bg-[#0f141a] px-1.5 py-1 text-[11px] text-slate-100"
                              >
                                {SAATY_CHOICES.map((ch) => (
                                  <option key={ch.label} value={ch.val}>
                                    {ch.label}
                                  </option>
                                ))}
                                {!SAATY_CHOICES.some(
                                  (c) => Math.abs(c.val - (ahpMatrix[i]?.[j] ?? 1)) < 0.05,
                                ) && (
                                  <option value={ahpMatrix[i]?.[j] ?? 1}>
                                    当前 ({(ahpMatrix[i]?.[j] ?? 1).toFixed(2)})
                                  </option>
                                )}
                              </select>
                            ) : (
                              <span className="tabular-nums font-mono text-[#8b949e]">
                                {(ahpMatrix[i]?.[j] ?? 1).toFixed(3)}
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                disabled={ahpLoading}
                onClick={runAhpSolve}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
              >
                <Calculator className="h-3.5 w-3.5" />
                {ahpLoading ? '求解中…' : '计算 AHP 特征根权重与 CR 检验'}
              </button>

              {ahpRes && (
                <button
                  type="button"
                  onClick={applyAhpWeightsToDraft}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  应用结果权重至评估体系
                </button>
              )}
            </div>

            {ahpRes && (
              <div className="rounded-md border border-[#2a313c] bg-[#0f141a] p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="tabular-nums space-x-3 font-mono text-slate-300">
                    <span>λmax = {ahpRes.lambdaMax.toFixed(4)}</span>
                    <span>CI = {ahpRes.ci.toFixed(4)}</span>
                    <span>CR = {ahpRes.cr.toFixed(4)}</span>
                  </div>
                  <span
                    className={`rounded px-2 py-0.5 font-medium ${
                      ahpRes.consistent
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-rose-500/15 text-rose-300'
                    }`}
                  >
                    {ahpRes.consistent
                      ? 'CR < 0.10 通过一致性检验'
                      : 'CR >= 0.10 存在逻辑矛盾，建议调整上三角标度'}
                  </span>
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {ahpTargetChildren.map((ch, idx) => (
                    <div
                      key={idx}
                      className="rounded border border-[#262d38] bg-[#161b22] px-2.5 py-1.5"
                    >
                      <div className="truncate text-[11px] text-[#8b949e]">
                        {isDim(ch)
                          ? ch.name
                          : ch.customLabel || indicatorMap.get(ch.indicatorRef)?.name || ch.indicatorRef}
                      </div>
                      <div className="tabular-nums mt-0.5 font-mono text-sm font-semibold text-blue-300">
                        {((ahpRes.weights[idx] ?? 0) * 100).toFixed(2)}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </dialog>

      {/* 原生 HTML <dialog>：客观 / 主客观组合赋权 (Entropy / CRITIC / Combined) */}
      <dialog ref={objDialogRef} className="w-full max-w-4xl p-4">
        <div className="flex items-start justify-between gap-3 border-b border-[#2a313c] pb-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100 sm:text-base">
              <Sliders className="h-4 w-4 text-cyan-400" />
              客观与主客观组合赋权 (Entropy / CRITIC / Combined)
            </h3>
            <p className="mt-0.5 text-xs text-[#8b949e]">
              基于多局推演 Run 在各个子维度上的实测差异度，通过信息熵或 CRITIC 冲突系数自动计算客观权重，支持叠加主观偏好。
            </p>
          </div>
          <button
            type="button"
            onClick={() => objDialogRef.current?.close()}
            className="rounded p-1 text-[#8b949e] hover:bg-[#1c2128] hover:text-white"
            aria-label="关闭弹窗"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {draft && (
          <div className="mt-3.5 space-y-3.5 text-xs">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[#8b949e]">作用层级节点</label>
                <select
                  value={objTargetId}
                  onChange={(e) => {
                    setObjTargetId(e.target.value);
                    setObjRes(null);
                  }}
                  className="w-full rounded border border-[#30363d] bg-[#0f141a] px-2.5 py-1.5 text-slate-200 focus:border-cyan-500 focus:outline-none"
                >
                  {multiChildDimensions.map((dim) => (
                    <option key={dim.id} value={dim.id}>
                      {dim.name} ({dim.count} 项)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[#8b949e]">赋权算法模型</label>
                <div className="flex gap-1.5">
                  {(
                    [
                      { id: 'entropy', label: '熵权法 (Entropy)' },
                      { id: 'critic', label: 'CRITIC 客观法' },
                      { id: 'combined', label: '主客观组合 (Combined)' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setObjMethod(m.id);
                        setObjRes(null);
                      }}
                      className={`flex-1 rounded border px-2 py-1.5 font-medium transition ${
                        objMethod === m.id
                          ? 'border-cyan-500 bg-cyan-500/20 text-cyan-200'
                          : 'border-[#30363d] bg-[#0f141a] text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {objMethod === 'combined' && (
              <div className="rounded-md border border-cyan-500/25 bg-[#0f141a] p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[#8b949e]">客观基座算法：</span>
                    <select
                      value={objBaseMethod}
                      onChange={(e) => setObjBaseMethod(e.target.value as 'entropy' | 'critic')}
                      className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-slate-200"
                    >
                      <option value="entropy">熵权法 (Entropy)</option>
                      <option value="critic">CRITIC 法</option>
                    </select>
                  </div>
                  <div className="flex flex-1 items-center gap-2 min-w-[220px]">
                    <span className="text-[#8b949e] shrink-0">
                      主观权重占比 α = <strong className="text-cyan-300">{objAlpha.toFixed(2)}</strong>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={objAlpha}
                      onChange={(e) => setObjAlpha(Number(e.target.value))}
                      className="flex-1 accent-cyan-400"
                    />
                    <span className="text-[11px] text-[#8b949e] shrink-0">
                      客观 {(1 - objAlpha).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[#8b949e]">
                  参与横向对比的推演 Run（至少选择 2 局，已选 {objRunIds.length}/{runs.length}）：
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setObjRunIds(objRunIds.length === runs.length ? [] : runs.map((r) => r.runId))
                  }
                  className="text-cyan-400 hover:underline"
                >
                  {objRunIds.length === runs.length ? '清空选择' : '全选所有 Run'}
                </button>
              </div>
              <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded border border-[#2a313c] bg-[#0f141a] p-2">
                {runs.map((r) => {
                  const checked = objRunIds.includes(r.runId);
                  return (
                    <label
                      key={r.runId}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 transition ${
                        checked
                          ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-200'
                          : 'border-[#30363d] bg-[#161b22] text-slate-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setObjRunIds((prev) => [...prev, r.runId]);
                          } else {
                            setObjRunIds((prev) => prev.filter((id) => id !== r.runId));
                          }
                        }}
                        className="accent-cyan-500"
                      />
                      <span className="truncate max-w-[200px]">{r.scenarioName || r.runId}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                disabled={objLoading || objRunIds.length < 2}
                onClick={runObjSolve}
                className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3.5 py-1.5 font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
              >
                <Calculator className="h-3.5 w-3.5" />
                {objLoading ? '多局求值与算权中…' : '计算推荐客观/组合权重'}
              </button>

              {objRes && (
                <button
                  type="button"
                  onClick={applyObjWeightsToDraft}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 font-medium text-white hover:bg-emerald-500"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  应用推荐权重至当前节点
                </button>
              )}
            </div>

            {objRes && (
              <div className="space-y-3 rounded-md border border-[#2a313c] bg-[#0f141a] p-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {objTargetChildren.map((ch, idx) => (
                    <div
                      key={idx}
                      className="rounded border border-[#262d38] bg-[#161b22] px-2.5 py-1.5"
                    >
                      <div className="truncate text-[11px] text-[#8b949e]">
                        {objRes.targetNames[idx] ?? (isDim(ch) ? ch.name : ch.indicatorRef)}
                      </div>
                      <div className="tabular-nums mt-0.5 font-mono text-sm font-semibold text-cyan-300">
                        {((objRes.weights[idx] ?? 0) * 100).toFixed(2)}%
                      </div>
                      <div className="text-[10px] text-slate-500">
                        原权重 {(ch.weight * 100).toFixed(1)}%
                      </div>
                    </div>
                  ))}
                </div>

                <div className="responsive-table-wrap rounded border border-[#262d38]">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-[#161b22] text-slate-300">
                      <tr>
                        <th className="px-2.5 py-1.5">推演方案 (Run)</th>
                        {objRes.targetNames.map((name, i) => (
                          <th key={i} className="px-2.5 py-1.5 text-right">
                            {name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#262d38]">
                      {objRes.runs.map((rId, rIdx) => (
                        <tr key={rId}>
                          <td className="px-2.5 py-1.5 font-mono text-slate-200">{rId}</td>
                          {objRes.matrix[rIdx]?.map((val, cIdx) => (
                            <td key={cIdx} className="px-2.5 py-1.5 text-right tabular-nums font-mono text-cyan-200">
                              {val.toFixed(1)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </dialog>
    </div>
  );
}

// 别名导出以满足 SystemsOrchestratorView 规范
export const SystemsOrchestratorView = SystemDesignerView;
export type { SystemDesignerViewProps as SystemsOrchestratorViewProps };
