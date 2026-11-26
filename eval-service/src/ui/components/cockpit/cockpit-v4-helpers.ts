import type {
  EvaluationDagOutput,
  EvaluationSystemDag,
  EvidenceRef,
  MetricDomainTag,
  V4MetricSnapshotItem,
  V4MetricTableSlice,
} from '../../../core/types.ts';
import type { StoredV4EvalRecord } from '../../api.ts';

export const DYNAMIC_SIDE_COLORS = [
  '#38bdf8',
  '#34d399',
  '#fbbf24',
  '#c084fc',
  '#fb7185',
  '#22d3ee',
] as const;

export interface PrimaryDimensionRow {
  nodeId: string;
  label: string;
  weight: number;
  effectiveWeight: number;
  domainTag?: MetricDomainTag;
  overallScore: number | null;
  bySideScores: Record<string, number | null>;
  statusBySide: Record<string, string>;
}

export interface LeafDiagnosticPoint {
  nodeId: string;
  label: string;
  parentLabel: string;
  metricId?: string;
  cascadingWeight: number;
  score: number | null;
  rawValue?: number | boolean | null;
  status: string;
  missingDataReason?: string;
  bySideScores: Record<string, number | null>;
}

export interface HierarchyDetailRow {
  rowKey: string;
  nodeId: string;
  label: string;
  depth: number;
  kind: 'terminal' | 'dimension' | 'leaf' | 'metric_proxy' | 'gate';
  weight: number | null;
  strategy?: string;
  metricId?: string;
  targetField?: string;
  overallScore: number | null;
  overallRaw?: number | boolean | null;
  overallRowCount?: number;
  status: string;
  gateStatus?: string;
  gateMode?: string;
  missingDataReason?: string;
  bySideScores: Record<string, number | null>;
  bySideRawValues?: Record<string, number | boolean | null>;
  bySideRowCounts?: Record<string, number>;
  hasChildren: boolean;
  parentRowKey?: string;
}

export interface V4EvidenceRow {
  id: string;
  side: string;
  nodeId: string;
  nodeLabel: string;
  source: string;
  ref: string | number;
  scenarioClock?: string;
  description: string;
  snippet?: Record<string, unknown>;
}

function getSystemNodeMap(systemDag?: EvaluationSystemDag | null) {
  return new Map((systemDag?.nodes ?? []).map((n) => [n.id, n]));
}

function resolveNodeLabel(
  nodeId: string,
  systemDag?: EvaluationSystemDag | null,
  evalOutput?: EvaluationDagOutput | null,
): string {
  const fromEval = evalOutput?.nodeResults?.[nodeId]?.label;
  if (fromEval) return fromEval;
  const fromDag = systemDag?.nodes?.find((n) => n.id === nodeId);
  return fromDag?.label || fromDag?.inlineEffect?.name || nodeId;
}

function isGateNode(
  nodeId: string,
  systemDag?: EvaluationSystemDag | null,
  evalOutput?: EvaluationDagOutput | null,
): boolean {
  const dagNode = systemDag?.nodes?.find((n) => n.id === nodeId);
  if (dagNode?.kind === 'gate' || dagNode?.inlineEffect?.role === 'gate') return true;
  if (evalOutput?.nodeResults?.[nodeId]?.role === 'gate') return true;
  return false;
}

function isMetricProxyDagNode(
  nodeId: string,
  systemDag?: EvaluationSystemDag | null,
  evalOutput?: EvaluationDagOutput | null,
): boolean {
  const dagNode = systemDag?.nodes?.find((n) => n.id === nodeId);
  if (dagNode?.kind === 'metric_proxy' || dagNode?.kind === 'metric') return true;
  if (evalOutput?.nodeResults?.[nodeId]?.role === 'metric_proxy') return true;
  return false;
}

/**
 * 从终态节点入边抽取一级能力维度（自动排除门控节点）。
 */
export function extractPrimaryDimensions(
  systemDag: EvaluationSystemDag | null | undefined,
  overall: EvaluationDagOutput | null | undefined,
  bySide: Record<string, EvaluationDagOutput> | null | undefined,
  sides: string[],
): PrimaryDimensionRow[] {
  if (!systemDag && !overall) return [];

  const terminalId = systemDag?.terminalEffectNodeId || overall?.terminalEffectNodeId || '';
  const nodeMap = getSystemNodeMap(systemDag);
  const incomingToTerminal = (systemDag?.edges ?? []).filter(
    (e) => e.targetNodeId === terminalId && !isGateNode(e.sourceNodeId, systemDag, overall),
  );

  let dimEntries: Array<{ nodeId: string; weight: number }> = incomingToTerminal.map((e) => ({
    nodeId: e.sourceNodeId,
    weight: typeof e.weight === 'number' ? e.weight : 0,
  }));

  // 兜底：若无显式入边记录（例如仅拿到 evalOutput），则取 depth === 1 的非门控节点
  if (dimEntries.length === 0 && overall?.nodeResults) {
    const depth1 = Object.values(overall.nodeResults).filter(
      (nr) => nr.depth === 1 && nr.role !== 'gate',
    );
    const fallbackWeight = depth1.length > 0 ? 1 / depth1.length : 1;
    dimEntries = depth1.map((nr) => ({
      nodeId: nr.nodeId,
      weight: fallbackWeight,
    }));
  }

  const terminalEffWeights = overall?.nodeResults?.[terminalId]?.effectiveWeights ?? {};
  const edgeBySource = new Map(incomingToTerminal.map((e) => [e.sourceNodeId, e.id]));

  return dimEntries.map(({ nodeId, weight }) => {
    const dagNode = nodeMap.get(nodeId);
    const edgeId = edgeBySource.get(nodeId);
    const effWeight =
      edgeId && typeof terminalEffWeights[edgeId] === 'number'
        ? terminalEffWeights[edgeId]
        : weight;

    const overallRes = overall?.nodeResults?.[nodeId];
    const bySideScores: Record<string, number | null> = {};
    const statusBySide: Record<string, string> = {};

    for (const side of sides) {
      const sRes = bySide?.[side]?.nodeResults?.[nodeId];
      bySideScores[side] =
        sRes && sRes.score !== null && sRes.score !== undefined ? sRes.score : null;
      statusBySide[side] = sRes?.status ?? 'unavailable';
    }

    return {
      nodeId,
      label: resolveNodeLabel(nodeId, systemDag, overall),
      weight,
      effectiveWeight: effWeight,
      domainTag: dagNode?.inlineEffect?.domainTag,
      overallScore:
        overallRes && overallRes.score !== null && overallRes.score !== undefined
          ? overallRes.score
          : null,
      bySideScores,
      statusBySide,
    };
  });
}

/**
 * 递归计算各叶级/底层指标代理节点对终态总分的级联有效权重，用于四象限短板诊断与热力矩阵。
 */
export function extractLeafDiagnosticPoints(
  systemDag: EvaluationSystemDag | null | undefined,
  overall: EvaluationDagOutput | null | undefined,
  bySide: Record<string, EvaluationDagOutput> | null | undefined,
  sides: string[],
  focusSide: string,
): LeafDiagnosticPoint[] {
  const activeEval =
    focusSide && focusSide !== 'ALL' && bySide?.[focusSide] ? bySide[focusSide] : overall;
  if (!activeEval && !overall) return [];

  const refEval = activeEval || overall!;
  const terminalId = systemDag?.terminalEffectNodeId || refEval.terminalEffectNodeId || '';
  const nodeMap = getSystemNodeMap(systemDag);
  const incomingMap = new Map<string, Array<{ edgeId: string; sourceNodeId: string; weight: number }>>();

  for (const edge of systemDag?.edges ?? []) {
    if (!incomingMap.has(edge.targetNodeId)) incomingMap.set(edge.targetNodeId, []);
    incomingMap.get(edge.targetNodeId)!.push({
      edgeId: edge.id,
      sourceNodeId: edge.sourceNodeId,
      weight: typeof edge.weight === 'number' ? edge.weight : 1,
    });
  }

  const leafWeightMap = new Map<string, { weight: number; parentLabel: string }>();

  const walk = (nodeId: string, accWeight: number, parentLabel: string, visited: Set<string>) => {
    if (visited.has(nodeId)) return;
    const nextVisited = new Set(visited);
    nextVisited.add(nodeId);

    const children = (incomingMap.get(nodeId) ?? []).filter(
      (c) => !isGateNode(c.sourceNodeId, systemDag, refEval),
    );
    const isLeafEffect =
      children.length === 0 ||
      children.every((c) => isMetricProxyDagNode(c.sourceNodeId, systemDag, refEval));
    if (isLeafEffect) {
      if (nodeId !== terminalId) {
        const prev = leafWeightMap.get(nodeId);
        leafWeightMap.set(nodeId, {
          weight: (prev?.weight ?? 0) + accWeight,
          parentLabel: prev?.parentLabel || parentLabel,
        });
      }
      return;
    }

    const effWeights = refEval.nodeResults?.[nodeId]?.effectiveWeights ?? {};
    const totalEdgeW = children.reduce((acc, c) => acc + Math.max(0, c.weight), 0);
    const currentLabel = resolveNodeLabel(nodeId, systemDag, refEval);

    for (const child of children) {
      const childW =
        typeof effWeights[child.edgeId] === 'number'
          ? effWeights[child.edgeId]
          : totalEdgeW > 0
            ? child.weight / totalEdgeW
            : 1 / children.length;
      walk(
        child.sourceNodeId,
        accWeight * Math.max(0, childW),
        nodeId === terminalId ? currentLabel : parentLabel || currentLabel,
        nextVisited,
      );
    }
  };

  if (terminalId && (systemDag?.edges?.length ?? 0) > 0) {
    walk(terminalId, 1, '', new Set());
  } else {
    // 兜底：无 DAG 拓扑边时，优先取非终态、非门控、非 metric_proxy 的有效得分节点
    const entries = Object.values(refEval.nodeResults ?? {}).filter(
      (nr) => nr.nodeId !== terminalId && nr.role !== 'gate',
    );
    const effectLeafCandidates = entries.filter(
      (nr) => nr.role !== 'metric_proxy' && nr.score !== null && nr.score !== undefined,
    );
    const chosen = effectLeafCandidates.length > 0 ? effectLeafCandidates : entries;
    const w = chosen.length > 0 ? 1 / chosen.length : 1;
    for (const nr of chosen) {
      leafWeightMap.set(nr.nodeId, { weight: w, parentLabel: '综合维度' });
    }
  }

  const points: LeafDiagnosticPoint[] = [];
  for (const [nodeId, info] of leafWeightMap.entries()) {
    const dagNode = nodeMap.get(nodeId);
    const nr = refEval.nodeResults?.[nodeId];
    const bySideScores: Record<string, number | null> = {};
    for (const side of sides) {
      const sRes = bySide?.[side]?.nodeResults?.[nodeId];
      bySideScores[side] =
        sRes && sRes.score !== null && sRes.score !== undefined ? sRes.score : null;
    }
    points.push({
      nodeId,
      label: resolveNodeLabel(nodeId, systemDag, refEval),
      parentLabel: info.parentLabel || '综合维度',
      metricId: dagNode?.refId || dagNode?.inlineEffect?.metricBinding?.metricId,
      cascadingWeight: info.weight,
      score: nr && nr.score !== null && nr.score !== undefined ? nr.score : null,
      rawValue: nr?.rawValue,
      status: nr?.status ?? 'unavailable',
      missingDataReason: nr?.missingDataReason,
      bySideScores,
    });
  }

  return points.sort((a, b) => b.cascadingWeight - a.cascadingWeight);
}

/**
 * 构建用于「层次得分明细」页签的可折叠树形展示行（含门控与客观指标节点）。
 */
export function buildHierarchyDetailRows(
  systemDag: EvaluationSystemDag | null | undefined,
  overall: EvaluationDagOutput | null | undefined,
  bySide: Record<string, EvaluationDagOutput> | null | undefined,
  sides: string[],
  metricSnapshots?: V4MetricSnapshotItem[] | null,
): HierarchyDetailRow[] {
  if (!overall) return [];

  const terminalId = systemDag?.terminalEffectNodeId || overall.terminalEffectNodeId;
  const nodeMap = getSystemNodeMap(systemDag);
  const incomingMap = new Map<string, Array<{ sourceNodeId: string; weight: number }>>();
  const snapshotByKey = new Map<string, V4MetricSnapshotItem>();
  for (const snap of metricSnapshots ?? []) {
    if (snap.proxyNodeId) snapshotByKey.set(snap.proxyNodeId, snap);
    if (snap.metricId) snapshotByKey.set(snap.metricId, snap);
  }

  for (const edge of systemDag?.edges ?? []) {
    if (!incomingMap.has(edge.targetNodeId)) incomingMap.set(edge.targetNodeId, []);
    incomingMap.get(edge.targetNodeId)!.push({
      sourceNodeId: edge.sourceNodeId,
      weight: typeof edge.weight === 'number' ? edge.weight : 0,
    });
  }

  const rows: HierarchyDetailRow[] = [];
  const includedNodeIds = new Set<string>();

  const pushNodeRow = (
    nodeId: string,
    depth: number,
    kind: HierarchyDetailRow['kind'],
    weight: number | null,
    parentRowKey?: string,
    parentNodeId?: string,
    visited = new Set<string>(),
  ) => {
    if (visited.has(nodeId)) return;
    const nextVisited = new Set(visited);
    nextVisited.add(nodeId);
    includedNodeIds.add(nodeId);

    const dagNode = nodeMap.get(nodeId);
    const evalRes = overall.nodeResults?.[nodeId];
    const children = (incomingMap.get(nodeId) ?? []).filter(
      (c) => !isGateNode(c.sourceNodeId, systemDag, overall),
    );
    const rowKey = parentRowKey ? `${parentRowKey}::${nodeId}` : nodeId;
    const isProxy = isMetricProxyDagNode(nodeId, systemDag, overall);
    const effectiveKind: HierarchyDetailRow['kind'] = isProxy ? 'metric_proxy' : kind;
    const metricId =
      dagNode?.refId ||
      (typeof dagNode?.params?.metricId === 'string' ? dagNode.params.metricId : undefined) ||
      dagNode?.inlineEffect?.metricBinding?.metricId;
    const snap =
      snapshotByKey.get(nodeId) ?? (metricId ? snapshotByKey.get(metricId) : undefined);

    const bySideScores: Record<string, number | null> = {};
    const bySideRawValues: Record<string, number | boolean | null> = {};
    const bySideRowCounts: Record<string, number> = {};

    for (const side of sides) {
      const sRes = bySide?.[side]?.nodeResults?.[nodeId];
      bySideScores[side] =
        sRes && sRes.score !== null && sRes.score !== undefined ? sRes.score : null;

      if (isProxy) {
        const sideSnap = snap?.bySide?.[side];
        let rawVal: number | boolean | null =
          sideSnap?.value !== undefined ? sideSnap.value : null;
        if (rawVal === null && sRes?.rawValue !== undefined && sRes.rawValue !== null) {
          rawVal = sRes.rawValue;
        }
        if (rawVal === null && parentNodeId) {
          const parentRaw = bySide?.[side]?.nodeResults?.[parentNodeId]?.rawValue;
          if (parentRaw !== undefined && parentRaw !== null) {
            rawVal = parentRaw;
          }
        }
        bySideRawValues[side] = rawVal;
        bySideRowCounts[side] = sideSnap?.totalRows ?? 0;
      }
    }

    let overallRaw: number | boolean | null | undefined = evalRes?.rawValue;
    if (isProxy) {
      if (snap?.overall?.value !== undefined) {
        overallRaw = snap.overall.value;
      } else if ((overallRaw === null || overallRaw === undefined) && parentNodeId) {
        const parentRaw = overall.nodeResults?.[parentNodeId]?.rawValue;
        if (parentRaw !== undefined && parentRaw !== null) {
          overallRaw = parentRaw;
        }
      }
    }

    rows.push({
      rowKey,
      nodeId,
      label: resolveNodeLabel(nodeId, systemDag, overall),
      depth,
      kind: effectiveKind,
      weight: isProxy ? null : weight,
      strategy: evalRes?.strategyUsed ?? dagNode?.inlineEffect?.aggregation?.strategy,
      metricId,
      targetField: snap?.targetField,
      overallScore:
        evalRes && evalRes.score !== null && evalRes.score !== undefined ? evalRes.score : null,
      overallRaw,
      overallRowCount: isProxy ? (snap?.overall?.totalRows ?? 0) : undefined,
      status: evalRes?.status ?? 'unavailable',
      gateStatus: evalRes?.gateStatus,
      gateMode: evalRes?.gateMode ?? dagNode?.inlineEffect?.gateMode,
      missingDataReason: evalRes?.missingDataReason,
      bySideScores,
      ...(isProxy ? { bySideRawValues, bySideRowCounts } : {}),
      hasChildren: children.length > 0,
      parentRowKey,
    });

    for (const child of children) {
      const childIsProxy = isMetricProxyDagNode(child.sourceNodeId, systemDag, overall);
      const childKind: HierarchyDetailRow['kind'] = childIsProxy
        ? 'metric_proxy'
        : depth === 0
          ? 'dimension'
          : 'leaf';
      pushNodeRow(
        child.sourceNodeId,
        depth + 1,
        childKind,
        childIsProxy ? null : child.weight,
        rowKey,
        nodeId,
        nextVisited,
      );
    }
  };

  if (terminalId) {
    pushNodeRow(terminalId, 0, 'terminal', 1);
  }

  // 补充门控节点（去重）
  for (const [nodeId, evalRes] of Object.entries(overall.nodeResults ?? {})) {
    if (isGateNode(nodeId, systemDag, overall) && !includedNodeIds.has(nodeId)) {
      pushNodeRow(nodeId, 0, 'gate', null);
    } else if (!includedNodeIds.has(nodeId) && evalRes.role !== 'gate') {
      pushNodeRow(nodeId, 1, 'leaf', null);
    }
  }

  return rows;
}

/**
 * 归并去重本次评估中全部阵营/全局节点的物理证据溯源链。
 */
export function collectV4EvidenceItems(
  overall: EvaluationDagOutput | null | undefined,
  bySide: Record<string, EvaluationDagOutput> | null | undefined,
  sides: string[],
): V4EvidenceRow[] {
  const items: V4EvidenceRow[] = [];
  const seen = new Set<string>();

  const scanOutput = (sideLabel: string, output?: EvaluationDagOutput | null) => {
    if (!output?.nodeResults) return;
    for (const nr of Object.values(output.nodeResults)) {
      for (const ev of (nr.evidenceRefs ?? []) as EvidenceRef[]) {
        const dedupeKey = `${sideLabel}::${nr.nodeId}::${ev.source}::${String(ev.ref)}::${ev.description}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        items.push({
          id: dedupeKey,
          side: sideLabel,
          nodeId: nr.nodeId,
          nodeLabel: nr.label || nr.nodeId,
          source: ev.source,
          ref: ev.ref,
          scenarioClock: ev.scenarioClock,
          description: ev.description,
          snippet: ev.snippet,
        });
      }
    }
  };

  if (sides.length > 0 && bySide) {
    for (const side of sides) {
      scanOutput(side, bySide[side]);
    }
  }
  scanOutput('综合', overall);

  return items;
}

/**
 * 生成客观、精炼的 Markdown 评估简报。
 */
export function generateV4ReportMarkdown(
  record: Pick<
    StoredV4EvalRecord,
    'systemName' | 'systemId' | 'systemVersion' | 'runId' | 'createdAt' | 'sides' | 'overall' | 'bySide'
  >,
  systemDag?: EvaluationSystemDag | null,
): string {
  const lines: string[] = [];
  lines.push(`# ${record.systemName || record.systemId} — 评估简报`);
  lines.push('');
  lines.push(`- **推演样本**：\`${record.runId}\``);
  lines.push(`- **评估体系**：\`${record.systemId}\` (v${record.systemVersion || '1.0.0'})`);
  lines.push(`- **生成时间**：${record.createdAt}`);
  lines.push('');

  lines.push('## 一、 综合评估结论');
  lines.push('');
  if (record.sides.length > 0) {
    lines.push('| 参演阵营 | 生效综合分 | 原始战术分 | 门控裁决 | 有效权重覆盖率 |');
    lines.push('| :--- | ---: | ---: | :--- | ---: |');
    for (const side of record.sides) {
      const sEval = record.bySide[side];
      const eff = sEval?.overallScore !== null && sEval?.overallScore !== undefined ? sEval.overallScore.toFixed(1) : '缺数';
      const raw = sEval?.rawOverallScore !== null && sEval?.rawOverallScore !== undefined ? sEval.rawOverallScore.toFixed(1) : '缺数';
      const verdict = sEval?.gateVerdict ?? 'PASS';
      const cov = sEval ? `${(sEval.availableWeightRatio * 100).toFixed(0)}%` : '--';
      lines.push(`| ${side} | **${eff}** | ${raw} | \`${verdict}\` | ${cov} |`);
    }
  } else {
    const eff = record.overall?.overallScore !== null && record.overall?.overallScore !== undefined ? record.overall.overallScore.toFixed(1) : '缺数';
    lines.push(`- **综合得分**：**${eff}** / 100（门控裁决：\`${record.overall?.gateVerdict ?? 'PASS'}\`，有效权重覆盖率：${((record.overall?.availableWeightRatio ?? 0) * 100).toFixed(0)}%）`);
  }
  lines.push('');

  const dims = extractPrimaryDimensions(systemDag, record.overall, record.bySide, record.sides);
  if (dims.length > 0) {
    lines.push('## 二、 一级能力维度表现');
    lines.push('');
    const sideHeaders = record.sides.length > 0 ? record.sides : ['综合得分'];
    lines.push(`| 能力维度 | 权重 | ${sideHeaders.join(' | ')} |`);
    lines.push(`| :--- | ---: | ${sideHeaders.map(() => '---:').join(' | ')} |`);
    for (const d of dims) {
      const cells =
        record.sides.length > 0
          ? record.sides.map((s) =>
              d.bySideScores[s] !== null && d.bySideScores[s] !== undefined
                ? `${d.bySideScores[s]!.toFixed(1)}`
                : '缺数',
            )
          : [d.overallScore !== null ? d.overallScore.toFixed(1) : '缺数'];
      lines.push(`| ${d.label} | ${(d.weight * 100).toFixed(1)}% | ${cells.join(' | ')} |`);
    }
    lines.push('');
  }

  const gates = record.overall?.gateAudit ?? [];
  const unavailNodes = Object.values(record.overall?.nodeResults ?? {}).filter(
    (n) => n.status === 'unavailable',
  );
  lines.push('## 三、 安全门控与数据缺口审计');
  lines.push('');
  if (gates.length === 0) {
    lines.push('- 当前体系未触发或未挂载独立门控项。');
  } else {
    for (const g of gates) {
      lines.push(`- **${g.name}**（${g.gateMode === 'hard' ? '硬门控' : '软门控'}）：状态 \`${g.gateStatus}\`，实测值 \`${g.displayValue}\``);
    }
  }
  if (unavailNodes.length > 0) {
    lines.push('');
    lines.push(`- **缺数项（共 ${unavailNodes.length} 项，按实证门控规则不填补默认值）**：`);
    for (const u of unavailNodes.slice(0, 12)) {
      lines.push(`  - \`${u.nodeId}\`（${u.label}）：${u.missingDataReason || '缺少对应推演事件表或关键字段'}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * 格式化客观指标标量值（Fail-Closed：空值返回 `--`）。
 */
export function formatMetricObjectiveValue(
  val: number | boolean | null | undefined,
  targetField?: string,
): string {
  if (val === null || val === undefined) return '--';
  if (typeof val === 'boolean') return val ? '是' : '否';
  if (!Number.isFinite(val)) return '--';

  const isPercentLike = Boolean(
    targetField && /rate|ratio|prob|pct|percent|compliance|coverage|率|比/i.test(targetField),
  );
  if (isPercentLike && val >= 0 && val <= 1) {
    return `${(val * 100).toFixed(1)}%`;
  }
  if (Number.isInteger(val)) {
    return val.toLocaleString('en-US');
  }
  return Number(val.toFixed(2)).toString();
}

function escapeCsvCell(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const text = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * 将单个指标切片导出为带 UTF-8 BOM 的 RFC 4180 CSV 文本。
 */
export function serializeMetricSliceToCsv(slice: V4MetricTableSlice): string {
  const cols = slice.columns ?? [];
  const header = cols.map((c) => escapeCsvCell(c.displayName || c.name)).join(',');
  const lines = [header];
  for (const row of slice.rows ?? []) {
    lines.push(cols.map((c) => escapeCsvCell(row[c.name])).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}`;
}
