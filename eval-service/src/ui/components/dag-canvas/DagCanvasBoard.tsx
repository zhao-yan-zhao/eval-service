import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Scale,
  ShieldAlert,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { DagGraphKind } from '../../../core/types.ts';
import { DagEdgeLayer } from './DagEdgeLayer.tsx';
import { DagNodeItem } from './DagNodeItem.tsx';
import { DagOutlineSidebar } from './DagOutlineSidebar.tsx';
import {
  canConnectNodes,
  computeDagTopologicalInfo,
  computeIncomingWeightSummary,
  computeVisibleDagSubgraph,
  DAG_GRAPH_ISOLATION_META,
  DEFAULT_DAG_NODE_HEIGHT,
  DEFAULT_DAG_NODE_WIDTH,
  type ConnectValidationResult,
  type DagCanvasEdge,
  type DagCanvasNode,
  type DagViewportState,
} from './types.ts';

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.0;

export interface DagCanvasBoardProps {
  graphKind: DagGraphKind;
  title?: string;
  nodes: DagCanvasNode[];
  edges: DagCanvasEdge[];
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  showOutline?: boolean;
  outlineSide?: 'left' | 'right';
  readOnly?: boolean;
  autoFitOnMount?: boolean;
  emptyStateText?: string;
  toolbarExtra?: React.ReactNode;
  className?: string;
  onSelectNode?: (nodeId: string | null) => void;
  onSelectEdge?: (edgeId: string | null) => void;
  onNodesChange?: (nodes: DagCanvasNode[]) => void;
  onEdgesChange?: (edges: DagCanvasEdge[]) => void;
  onConnect?: (sourceNodeId: string, targetNodeId: string, newEdge: DagCanvasEdge) => void;
  onDeleteNode?: (nodeId: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
  onUpdateEdgeWeight?: (edgeId: string, weight: number) => void;
  onToggleCollapse?: (nodeId: string, collapsed: boolean) => void;
  onDrillDown?: (nodeId: string) => void;
  canConnectValidator?: (
    source: DagCanvasNode,
    target: DagCanvasNode,
    graphKind: DagGraphKind,
    edges: DagCanvasEdge[],
  ) => ConnectValidationResult;
}

export function DagCanvasBoard({
  graphKind,
  title,
  nodes: nodesProp,
  edges: edgesProp,
  selectedNodeId: controlledSelectedNodeId,
  selectedEdgeId: controlledSelectedEdgeId,
  showOutline = true,
  outlineSide = 'right',
  readOnly = false,
  autoFitOnMount = true,
  emptyStateText = '当前画布暂无节点',
  toolbarExtra,
  className = '',
  onSelectNode,
  onSelectEdge,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onDeleteNode,
  onDeleteEdge,
  onUpdateEdgeWeight,
  onToggleCollapse,
  onDrillDown,
  canConnectValidator,
}: DagCanvasBoardProps) {
  const isoMeta = DAG_GRAPH_ISOLATION_META[graphKind];

  // 受控 / 非受控双模式兼容
  const [internalNodes, setInternalNodes] = useState<DagCanvasNode[]>(nodesProp);
  const [internalEdges, setInternalEdges] = useState<DagCanvasEdge[]>(edgesProp);
  const [internalSelectedNodeId, setInternalSelectedNodeId] = useState<string | null>(null);
  const [internalSelectedEdgeId, setInternalSelectedEdgeId] = useState<string | null>(null);

  useEffect(() => {
    setInternalNodes(nodesProp);
  }, [nodesProp]);

  useEffect(() => {
    setInternalEdges(edgesProp);
  }, [edgesProp]);

  const nodes = onNodesChange ? nodesProp : internalNodes;
  const edges = onEdgesChange ? edgesProp : internalEdges;
  const selectedNodeId =
    controlledSelectedNodeId !== undefined ? controlledSelectedNodeId : internalSelectedNodeId;
  const selectedEdgeId =
    controlledSelectedEdgeId !== undefined ? controlledSelectedEdgeId : internalSelectedEdgeId;

  const commitNodes = useCallback(
    (next: DagCanvasNode[]) => {
      if (onNodesChange) {
        onNodesChange(next);
      } else {
        setInternalNodes(next);
      }
    },
    [onNodesChange],
  );

  const commitEdges = useCallback(
    (next: DagCanvasEdge[]) => {
      if (onEdgesChange) {
        onEdgesChange(next);
      } else {
        setInternalEdges(next);
      }
    },
    [onEdgesChange],
  );

  const commitSelectNode = useCallback(
    (nodeId: string | null) => {
      if (controlledSelectedNodeId === undefined) {
        setInternalSelectedNodeId(nodeId);
      }
      onSelectNode?.(nodeId);
    },
    [controlledSelectedNodeId, onSelectNode],
  );

  const commitSelectEdge = useCallback(
    (edgeId: string | null) => {
      if (controlledSelectedEdgeId === undefined) {
        setInternalSelectedEdgeId(edgeId);
      }
      onSelectEdge?.(edgeId);
    },
    [controlledSelectedEdgeId, onSelectEdge],
  );

  const [outlineOpen, setOutlineOpen] = useState<boolean>(showOutline);
  const [viewport, setViewport] = useState<DagViewportState>({ panX: 48, panY: 48, zoom: 1.0 });
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'info' | 'warn'; text: string } | null>(null);

  // 连线拖拽状态
  const [connectingFromNodeId, setConnectingFromNodeId] = useState<string | null>(null);
  const [connectingMousePos, setConnectingMousePos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [hoverTargetNodeId, setHoverTargetNodeId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const nodesRef = useRef<DagCanvasNode[]>(nodes);
  const edgesRef = useRef<DagCanvasEdge[]>(edges);
  const viewportRef = useRef<DagViewportState>(viewport);
  const toastTimerRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const hasAutoFittedRef = useRef<boolean>(false);

  nodesRef.current = nodes;
  edgesRef.current = edges;
  viewportRef.current = viewport;

  const showToast = useCallback((kind: 'info' | 'warn', text: string, durationMs = 2800) => {
    setToast({ kind, text });
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, durationMs);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
    };
  }, []);

  // 计算拓扑深度与子图折叠过滤
  const { depthMap } = useMemo(() => computeDagTopologicalInfo(nodes, edges), [nodes, edges]);

  const enrichedNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        depth: typeof n.depth === 'number' ? n.depth : (depthMap.get(n.id) ?? 0),
      })),
    [nodes, depthMap],
  );

  const {
    visibleNodes,
    visibleEdges,
    hiddenNodeIds,
    collapsedCountByNodeId,
    collapsedAnchorByHiddenId,
  } = useMemo(() => computeVisibleDagSubgraph(enrichedNodes, edges), [enrichedNodes, edges]);

  // 计算可折叠判断集合 & 权重和检验汇总
  const { collapsibleNodeIds, weightSummaryMap, imbalancedSystemTargets } = useMemo(() => {
    const outCounts = new Map<string, number>();
    const groupCounts = new Map<string, number>();
    const parentGroupSet = new Set<string>();

    for (const n of nodes) {
      if (n.groupId) {
        groupCounts.set(n.groupId, (groupCounts.get(n.groupId) ?? 0) + 1);
      }
      if (n.parentGroupNodeId) {
        parentGroupSet.add(n.parentGroupNodeId);
      }
    }
    for (const e of edges) {
      if (e.isVirtualCollapsed) continue;
      outCounts.set(e.sourceNodeId, (outCounts.get(e.sourceNodeId) ?? 0) + 1);
    }

    const collapsible = new Set<string>();
    const wMap = new Map<string, ReturnType<typeof computeIncomingWeightSummary>>();
    let imbalanced = 0;

    for (const n of nodes) {
      if (
        (outCounts.get(n.id) ?? 0) > 0 ||
        parentGroupSet.has(n.id) ||
        (n.groupId && (groupCounts.get(n.groupId) ?? 0) > 1) ||
        n.collapsed
      ) {
        collapsible.add(n.id);
      }
      if (graphKind === 'system') {
        const ws = computeIncomingWeightSummary(n.id, edges);
        wMap.set(n.id, ws);
        if (ws.incomingCount > 0 && !ws.isBalanced) {
          imbalanced++;
        }
      }
    }

    return {
      collapsibleNodeIds: collapsible,
      weightSummaryMap: wMap,
      imbalancedSystemTargets: imbalanced,
    };
  }, [nodes, edges, graphKind]);

  // 强隔离 + 防自环 + BFS 环路检测守卫
  const canConnect = useCallback(
    (source: DagCanvasNode, target: DagCanvasNode, kind: DagGraphKind): ConnectValidationResult => {
      if (canConnectValidator) {
        return canConnectValidator(source, target, kind, edgesRef.current);
      }
      return canConnectNodes(source, target, kind, edgesRef.current);
    },
    [canConnectValidator],
  );

  const connectingPreviewValid = useMemo(() => {
    if (!connectingFromNodeId || !hoverTargetNodeId) return null;
    const src = nodes.find((n) => n.id === connectingFromNodeId);
    const tgt = nodes.find((n) => n.id === hoverTargetNodeId);
    if (!src || !tgt) return null;
    return canConnect(src, tgt, graphKind).allowed;
  }, [connectingFromNodeId, hoverTargetNodeId, nodes, canConnect, graphKind]);

  // 自适应全貌居中
  const handleFitView = useCallback(() => {
    if (!canvasRef.current) return;
    const targetNodes = visibleNodes.length > 0 ? visibleNodes : enrichedNodes;
    if (targetNodes.length === 0) return;

    const rect = canvasRef.current.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 100) return;

    const padding = 64;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const n of targetNodes) {
      const w = n.width ?? DEFAULT_DAG_NODE_WIDTH;
      const h = n.height ?? DEFAULT_DAG_NODE_HEIGHT;
      minX = Math.min(minX, n.position.x);
      maxX = Math.max(maxX, n.position.x + w);
      minY = Math.min(minY, n.position.y);
      maxY = Math.max(maxY, n.position.y + h);
    }

    const graphWidth = Math.max(maxX - minX + padding * 2, 120);
    const graphHeight = Math.max(maxY - minY + padding * 2, 120);
    const scaleX = rect.width / graphWidth;
    const scaleY = rect.height / graphHeight;
    const nextZoom = Math.min(Math.max(Math.min(scaleX, scaleY), MIN_ZOOM), 1.25);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const nextPanX = rect.width / 2 - centerX * nextZoom;
    const nextPanY = rect.height / 2 - centerY * nextZoom;

    setViewport({
      panX: Math.round(nextPanX),
      panY: Math.round(nextPanY),
      zoom: Math.round(nextZoom * 100) / 100,
    });
  }, [visibleNodes, enrichedNodes]);

  useEffect(() => {
    if (!autoFitOnMount || hasAutoFittedRef.current || nodes.length === 0) return;
    const rafId = window.requestAnimationFrame(() => {
      if (canvasRef.current && canvasRef.current.getBoundingClientRect().width >= 100) {
        handleFitView();
        hasAutoFittedRef.current = true;
      }
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [autoFitOnMount, nodes.length, handleFitView]);

  // 居中定位并高亮指定节点（大纲联动）
  const focusAndHighlightNode = useCallback(
    (nodeId: string) => {
      commitSelectNode(nodeId);
      commitSelectEdge(null);

      // 若节点处于折叠子图中，自动逐级展开其折叠锚点
      let currentTarget = nodeId;
      const anchorsToExpand = new Set<string>();
      const guard = new Set<string>();
      while (collapsedAnchorByHiddenId.has(currentTarget) && !guard.has(currentTarget)) {
        guard.add(currentTarget);
        const anchorId = collapsedAnchorByHiddenId.get(currentTarget)!;
        anchorsToExpand.add(anchorId);
        currentTarget = anchorId;
      }

      if (anchorsToExpand.size > 0) {
        const nextNodes = nodesRef.current.map((n) =>
          anchorsToExpand.has(n.id) ? { ...n, collapsed: false } : n,
        );
        commitNodes(nextNodes);
        anchorsToExpand.forEach((aid) => onToggleCollapse?.(aid, false));
        showToast('info', '已自动展开折叠子图并定位节点', 2000);
      }

      const targetNode = nodesRef.current.find((n) => n.id === nodeId);
      if (targetNode && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const w = targetNode.width ?? DEFAULT_DAG_NODE_WIDTH;
        const h = targetNode.height ?? DEFAULT_DAG_NODE_HEIGHT;
        const curZoom = viewportRef.current.zoom;
        const centerX = targetNode.position.x + w / 2;
        const centerY = targetNode.position.y + h / 2;

        setViewport((prev) => ({
          ...prev,
          panX: Math.round(rect.width / 2 - centerX * curZoom),
          panY: Math.round(rect.height / 2 - centerY * curZoom),
        }));
      }

      setHighlightedNodeId(nodeId);
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
      highlightTimerRef.current = window.setTimeout(() => {
        setHighlightedNodeId((prev) => (prev === nodeId ? null : prev));
        highlightTimerRef.current = null;
      }, 1800);
    },
    [
      commitSelectNode,
      commitSelectEdge,
      collapsedAnchorByHiddenId,
      commitNodes,
      onToggleCollapse,
      showToast,
    ],
  );

  // 鼠标滚轮以光标位置为不动锚点平滑缩放 (0.4x ~ 2.0x)
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const zoomFactor = e.deltaY > 0 ? 0.92 : 1.08;

      setViewport((prev) => {
        const nextZoom = Math.min(Math.max(prev.zoom * zoomFactor, MIN_ZOOM), MAX_ZOOM);
        const nextPanX = mouseX - (mouseX - prev.panX) * (nextZoom / prev.zoom);
        const nextPanY = mouseY - (mouseY - prev.panY) * (nextZoom / prev.zoom);
        return {
          panX: Math.round(nextPanX),
          panY: Math.round(nextPanY),
          zoom: Math.round(nextZoom * 1000) / 1000,
        };
      });
    };

    el.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleNativeWheel);
  }, []);

  // 画布空白区拖动画布平移
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // 点击落在节点卡片或交互按钮内部时不触发画布平移
    if (target.closest('[data-node-id]')) return;

    const initPanX = viewportRef.current.panX;
    const initPanY = viewportRef.current.panY;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragged = false;

    const onWindowMove = (moveEv: MouseEvent) => {
      const dx = moveEv.clientX - startX;
      const dy = moveEv.clientY - startY;
      if (!dragged && Math.hypot(dx, dy) > 2) {
        dragged = true;
      }
      if (dragged) {
        setViewport((prev) => ({
          ...prev,
          panX: Math.round(initPanX + dx),
          panY: Math.round(initPanY + dy),
        }));
      }
    };

    const onWindowUp = () => {
      window.removeEventListener('mousemove', onWindowMove);
      window.removeEventListener('mouseup', onWindowUp);
      if (!dragged) {
        commitSelectNode(null);
        commitSelectEdge(null);
      }
    };

    window.addEventListener('mousemove', onWindowMove);
    window.addEventListener('mouseup', onWindowUp);
  };

  // 节点拖拽移动
  const handleNodeDragStart = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const target = nodesRef.current.find((n) => n.id === nodeId);
      if (!target) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const initNodeX = target.position.x;
      const initNodeY = target.position.y;
      let hasMoved = false;

      const onWindowMove = (moveEv: MouseEvent) => {
        const zoom = viewportRef.current.zoom || 1;
        const dx = (moveEv.clientX - startX) / zoom;
        const dy = (moveEv.clientY - startY) / zoom;
        if (!hasMoved && Math.hypot(moveEv.clientX - startX, moveEv.clientY - startY) > 2) {
          hasMoved = true;
        }
        if (hasMoved) {
          const nextX = Math.round(initNodeX + dx);
          const nextY = Math.round(initNodeY + dy);
          const nextNodes = nodesRef.current.map((n) =>
            n.id === nodeId ? { ...n, position: { x: nextX, y: nextY } } : n,
          );
          commitNodes(nextNodes);
        }
      };

      const onWindowUp = () => {
        window.removeEventListener('mousemove', onWindowMove);
        window.removeEventListener('mouseup', onWindowUp);
        if (!hasMoved) {
          commitSelectNode(nodeId);
          commitSelectEdge(null);
        }
      };

      window.addEventListener('mousemove', onWindowMove);
      window.addEventListener('mouseup', onWindowUp);
    },
    [commitNodes, commitSelectNode, commitSelectEdge],
  );

  // 端口拖拽发起连线
  const handleStartConnect = useCallback((sourceNodeId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setConnectingFromNodeId(sourceNodeId);

    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const vp = viewportRef.current;
      setConnectingMousePos({
        x: (e.clientX - rect.left - vp.panX) / vp.zoom,
        y: (e.clientY - rect.top - vp.panY) / vp.zoom,
      });
    }

    const onMove = (moveEv: MouseEvent) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const vp = viewportRef.current;
      setConnectingMousePos({
        x: (moveEv.clientX - rect.left - vp.panX) / vp.zoom,
        y: (moveEv.clientY - rect.top - vp.panY) / vp.zoom,
      });
      const hitNodeEl = (moveEv.target as HTMLElement | null)?.closest('[data-node-id]');
      const hitId = hitNodeEl?.getAttribute('data-node-id') || null;
      setHoverTargetNodeId(hitId && hitId !== sourceNodeId ? hitId : null);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.setTimeout(() => {
        setConnectingFromNodeId(null);
        setConnectingMousePos(null);
        setHoverTargetNodeId(null);
      }, 40);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // 端口松手完成连线（含 canConnect 隔离与环路校验）
  const handleEndConnect = useCallback(
    (targetNodeId: string) => {
      if (!connectingFromNodeId) return;
      const sourceNode = nodesRef.current.find((n) => n.id === connectingFromNodeId);
      const targetNode = nodesRef.current.find((n) => n.id === targetNodeId);

      setConnectingFromNodeId(null);
      setConnectingMousePos(null);
      setHoverTargetNodeId(null);

      if (!sourceNode || !targetNode) return;

      const verdict = canConnect(sourceNode, targetNode, graphKind);
      if (!verdict.allowed) {
        showToast('warn', verdict.reason || '当前节点之间无法建立连线', 3200);
        return;
      }

      const existingIncomingCount = edgesRef.current.filter(
        (e) => !e.isVirtualCollapsed && e.targetNodeId === targetNode.id,
      ).length;
      const newEdge: DagCanvasEdge = {
        id: `edge_${sourceNode.id}_${targetNode.id}_${Date.now().toString(36)}`,
        sourceNodeId: sourceNode.id,
        targetNodeId: targetNode.id,
        graphKind,
        ...(graphKind === 'system'
          ? { weight: existingIncomingCount === 0 ? 1.0 : 0.0 }
          : {}),
      };

      const nextEdges = [...edgesRef.current, newEdge];
      commitEdges(nextEdges);
      onConnect?.(sourceNode.id, targetNode.id, newEdge);
      showToast('info', `已建立连线：${sourceNode.label} → ${targetNode.label}`, 2000);
    },
    [connectingFromNodeId, canConnect, graphKind, showToast, commitEdges, onConnect],
  );

  // 删除节点与连线
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      if (readOnly) return;
      if (onDeleteNode) {
        onDeleteNode(nodeId);
      } else {
        commitNodes(nodesRef.current.filter((n) => n.id !== nodeId));
        commitEdges(
          edgesRef.current.filter((e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId),
        );
      }
      if (selectedNodeId === nodeId) {
        commitSelectNode(null);
      }
    },
    [readOnly, onDeleteNode, commitNodes, commitEdges, selectedNodeId, commitSelectNode],
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      if (readOnly) return;
      if (onDeleteEdge) {
        onDeleteEdge(edgeId);
      } else {
        commitEdges(edgesRef.current.filter((e) => e.id !== edgeId));
      }
      if (selectedEdgeId === edgeId) {
        commitSelectEdge(null);
      }
    },
    [readOnly, onDeleteEdge, commitEdges, selectedEdgeId, commitSelectEdge],
  );

  const handleUpdateEdgeWeight = useCallback(
    (edgeId: string, weight: number) => {
      if (readOnly) return;
      if (onUpdateEdgeWeight) {
        onUpdateEdgeWeight(edgeId, weight);
      } else {
        commitEdges(
          edgesRef.current.map((e) => (e.id === edgeId ? { ...e, weight } : e)),
        );
      }
    },
    [readOnly, onUpdateEdgeWeight, commitEdges],
  );

  const handleToggleCollapse = useCallback(
    (nodeId: string, collapsed: boolean) => {
      if (onToggleCollapse) {
        onToggleCollapse(nodeId, collapsed);
      } else {
        commitNodes(
          nodesRef.current.map((n) => (n.id === nodeId ? { ...n, collapsed } : n)),
        );
      }
    },
    [onToggleCollapse, commitNodes],
  );

  // 键盘快捷键监听 (Delete/Backspace 删除选中元素，Escape 取消)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetEl = e.target as HTMLElement | null;
      const activeEl = document.activeElement as HTMLElement | null;

      const isInputLike = (el: HTMLElement | null) => {
        if (!el) return false;
        const tag = (el.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
        if (el.isContentEditable) return true;
        return Boolean(
          el.closest?.('.cm-editor, .cm-content, [contenteditable="true"], dialog, [role="dialog"]'),
        );
      };

      if (isInputLike(targetEl) || isInputLike(activeEl)) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && !readOnly) {
        if (selectedNodeId) {
          e.preventDefault();
          handleDeleteNode(selectedNodeId);
        } else if (selectedEdgeId) {
          e.preventDefault();
          handleDeleteEdge(selectedEdgeId);
        }
      } else if (e.key === 'Escape') {
        commitSelectNode(null);
        commitSelectEdge(null);
        setConnectingFromNodeId(null);
        setConnectingMousePos(null);
        setHoverTargetNodeId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    readOnly,
    selectedNodeId,
    selectedEdgeId,
    handleDeleteNode,
    handleDeleteEdge,
    commitSelectNode,
    commitSelectEdge,
  ]);

  const zoomStep = (delta: number) => {
    setViewport((prev) => ({
      ...prev,
      zoom: Math.round(Math.min(Math.max(prev.zoom + delta, MIN_ZOOM), MAX_ZOOM) * 100) / 100,
    }));
  };

  const outlinePanel = outlineOpen ? (
    <DagOutlineSidebar
      nodes={enrichedNodes}
      edges={edges}
      graphKind={graphKind}
      selectedNodeId={selectedNodeId}
      hiddenNodeIds={hiddenNodeIds}
      side={outlineSide}
      readOnly={readOnly}
      onSelectNode={focusAndHighlightNode}
      onSelectEdge={(eid) => {
        commitSelectEdge(eid);
        if (eid) commitSelectNode(null);
      }}
      onUpdateEdgeWeight={handleUpdateEdgeWeight}
      onClose={() => setOutlineOpen(false)}
    />
  ) : null;

  return (
    <div
      className={`flex h-full min-h-[540px] w-full flex-col overflow-hidden rounded-xl border border-[#30363d] bg-[#0d1117] text-slate-100 select-none ${className}`}
    >
      {/* 顶部工具栏：强隔离徽章 + 标题 + 缩放控制 + 大纲切换 */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 border-b bg-[#161b22] px-3.5 py-2 z-20 ${isoMeta.toolbarBorderClass}`}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            title={isoMeta.isolationRule}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${isoMeta.badgeClass}`}
          >
            <span>{isoMeta.shortBadge}</span>
          </span>

          <span className="hidden md:inline-block rounded border border-[#30363d] bg-[#0d1117] px-2 py-0.5 font-mono text-[10px] text-slate-400">
            数据流: {isoMeta.payloadLabel}
          </span>

          {title && (
            <span className="truncate text-xs font-semibold text-slate-200 max-w-[240px]" title={title}>
              {title}
            </span>
          )}

          {graphKind === 'system' && edges.length > 0 && (
            <span
              className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-medium ${
                imbalancedSystemTargets === 0
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/50 bg-amber-500/15 text-amber-300'
              }`}
            >
              <Scale className="h-3 w-3" />
              {imbalancedSystemTargets === 0
                ? '局部权重已平衡 (Σw=1.00)'
                : `${imbalancedSystemTargets} 个节点权重失衡`}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {toolbarExtra}

          {/* 缩放控制器 (0.4x ~ 2.0x) */}
          <div className="flex items-center rounded-md border border-[#30363d] bg-[#0d1117] text-xs">
            <button
              type="button"
              onClick={() => zoomStep(-0.15)}
              title="缩小画布"
              className="rounded-l-md px-2 py-1 text-slate-300 transition hover:bg-[#161b22] hover:text-white cursor-pointer"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="w-12 border-x border-[#30363d] py-1 text-center font-mono text-[11px] text-slate-200 tabular-nums">
              {Math.round(viewport.zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => zoomStep(0.15)}
              title="放大画布"
              className="rounded-r-md px-2 py-1 text-slate-300 transition hover:bg-[#161b22] hover:text-white cursor-pointer"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setViewport({ panX: 48, panY: 48, zoom: 1.0 })}
            title="复位 1:1 视口"
            className="rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1 font-mono text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-white cursor-pointer"
          >
            1:1
          </button>

          <button
            type="button"
            onClick={handleFitView}
            title="自适应全貌居中"
            className="inline-flex items-center gap-1 rounded-md border border-[#30363d] bg-[#0d1117] px-2 py-1 text-[11px] text-slate-200 transition hover:border-cyan-500/60 hover:text-cyan-200 cursor-pointer"
          >
            <Maximize2 className="h-3 w-3" />
            <span>全貌</span>
          </button>

          <button
            type="button"
            onClick={() => setOutlineOpen((prev) => !prev)}
            title={outlineOpen ? '隐藏大纲侧边栏' : '显示大纲侧边栏'}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition cursor-pointer ${
              outlineOpen
                ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                : 'border-[#30363d] bg-[#0d1117] text-slate-300 hover:border-slate-500 hover:text-white'
            }`}
          >
            {outlineSide === 'left' ? (
              outlineOpen ? (
                <PanelLeftClose className="h-3.5 w-3.5" />
              ) : (
                <PanelLeftOpen className="h-3.5 w-3.5" />
              )
            ) : outlineOpen ? (
              <PanelRightClose className="h-3.5 w-3.5" />
            ) : (
              <PanelRightOpen className="h-3.5 w-3.5" />
            )}
            <span>{graphKind === 'system' ? '大纲/权重' : '大纲'}</span>
          </button>
        </div>
      </div>

      {/* 主体区域：画布视口 + 可选左/右侧边大纲 */}
      <div className="relative flex flex-1 overflow-hidden">
        {outlineSide === 'left' && outlinePanel}

        {/* 无限网格交互画布 */}
        <div
          ref={canvasRef}
          onMouseDown={handleCanvasMouseDown}
          className="relative flex-1 overflow-hidden bg-[#0d1117] cursor-grab active:cursor-grabbing"
          style={{
            backgroundImage: 'radial-gradient(#21262d 1.1px, transparent 1.1px)',
            backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`,
            backgroundPosition: `${viewport.panX}px ${viewport.panY}px`,
          }}
        >
          {/* 提示 Toast（含环路拦截、强隔离警告、连线成功） */}
          {toast && (
            <div
              className={`absolute top-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-medium shadow-2xl backdrop-blur-md ${
                toast.kind === 'warn'
                  ? 'border-rose-500/60 bg-rose-950/90 text-rose-200'
                  : 'border-emerald-500/50 bg-emerald-950/90 text-emerald-200'
              }`}
            >
              {toast.kind === 'warn' ? (
                <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              )}
              <span>{toast.text}</span>
            </div>
          )}

          {/* 空状态占位 */}
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-500">
              <AlertTriangle className="h-6 w-6 text-slate-600" />
              <span className="text-xs">{emptyStateText}</span>
            </div>
          )}

          {/* 平移缩放变换层 */}
          <div
            style={{
              transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
              transformOrigin: '0 0',
            }}
            className="pointer-events-none absolute inset-0"
          >
            {/* SVG 贝塞尔连线与权重叠加层 */}
            <DagEdgeLayer
              nodes={visibleNodes}
              edges={visibleEdges}
              graphKind={graphKind}
              selectedEdgeId={selectedEdgeId}
              readOnly={readOnly}
              onSelectEdge={(eid) => {
                commitSelectEdge(eid);
                if (eid) commitSelectNode(null);
              }}
              onDeleteEdge={handleDeleteEdge}
              onUpdateEdgeWeight={handleUpdateEdgeWeight}
              connectingFromNodeId={connectingFromNodeId}
              connectingMousePos={connectingMousePos}
              connectingPreviewValid={connectingPreviewValid}
            />

            {/* DOM 节点卡片层 */}
            <div className="pointer-events-auto">
              {visibleNodes.map((node) => {
                const isConnectSource = connectingFromNodeId === node.id;
                let isConnectTargetValid: boolean | null = null;
                if (connectingFromNodeId && !isConnectSource) {
                  const src = nodes.find((n) => n.id === connectingFromNodeId);
                  if (src) {
                    isConnectTargetValid = canConnect(src, node, graphKind).allowed;
                  }
                }

                const hasInputPort =
                  node.meta?.noInputPort !== true &&
                  !(graphKind === 'operator' && node.kind === 'data_input') &&
                  !(
                    graphKind === 'system' &&
                    (node.kind === 'metric_proxy' || node.summary?.role === 'metric_proxy')
                  );
                const hasOutputPort =
                  node.meta?.noOutputPort !== true &&
                  !(graphKind === 'operator' && node.kind === 'result_output');

                return (
                  <DagNodeItem
                    key={node.id}
                    node={node}
                    graphKind={graphKind}
                    isSelected={selectedNodeId === node.id}
                    isHighlighted={highlightedNodeId === node.id}
                    isConnecting={Boolean(connectingFromNodeId)}
                    isConnectSource={isConnectSource}
                    isConnectTargetValid={isConnectTargetValid}
                    readOnly={readOnly}
                    hasInputPort={hasInputPort}
                    hasOutputPort={hasOutputPort}
                    hasCollapsibleChildren={collapsibleNodeIds.has(node.id)}
                    collapsedDescendantCount={collapsedCountByNodeId.get(node.id) ?? 0}
                    incomingWeightSummary={weightSummaryMap.get(node.id)}
                    onSelect={(nid) => {
                      commitSelectNode(nid);
                      commitSelectEdge(null);
                    }}
                    onDelete={readOnly ? undefined : handleDeleteNode}
                    onStartConnect={handleStartConnect}
                    onEndConnect={handleEndConnect}
                    onToggleCollapse={handleToggleCollapse}
                    onDrillDown={onDrillDown}
                    onDragStart={handleNodeDragStart}
                  />
                );
              })}
            </div>
          </div>

          {/* 底部状态角标：显示可见/折叠节点统计 */}
          {hiddenNodeIds.size > 0 && (
            <div className="pointer-events-none absolute bottom-3 left-3 z-20 rounded-md border border-amber-500/40 bg-[#161b22]/90 px-2.5 py-1 font-mono text-[10px] text-amber-200 shadow-lg">
              已折叠隐藏 {hiddenNodeIds.size} 个子节点 · 可在节点卡片或大纲面板展开
            </div>
          )}
        </div>

        {outlineSide === 'right' && outlinePanel}
      </div>
    </div>
  );
}
