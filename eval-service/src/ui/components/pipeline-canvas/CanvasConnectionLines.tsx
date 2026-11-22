import React from 'react';
import { X } from 'lucide-react';
import type { CanvasEdge, CanvasNode } from './canvas-types.ts';

interface CanvasConnectionLinesProps {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedEdgeId?: string | null;
  onSelectEdge?: (edgeId: string | null) => void;
  onDeleteEdge?: (edgeId: string) => void;
  // 正在拖拽连线状态
  connectingFromNodeId?: string | null;
  connectingMousePos?: { x: number; y: number } | null;
}

const NODE_WIDTH = 280;
// 卡片标准渲染高度（头部 38px + 内容区 86px = 124px，端口垂直居中于 62px 处）
const NODE_HEIGHT = 124;

export function CanvasConnectionLines({
  nodes,
  edges,
  selectedEdgeId,
  onSelectEdge,
  onDeleteEdge,
  connectingFromNodeId,
  connectingMousePos,
}: CanvasConnectionLinesProps) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // 计算贝塞尔曲线控制点
  const getBezierPath = (startX: number, startY: number, endX: number, endY: number) => {
    const deltaX = Math.max(Math.abs(endX - startX) * 0.5, 50);
    // 关键：当水平纯直线时（startY === endY），SVG 路径 boundingBox 高度为 0。
    // 按 SVG 规范，gradientUnits="objectBoundingBox" 且 height === 0 会使渐变完全失效隐形，导致只露出上层虚线。
    // 引入微小亚像素偏移（0.05px），人眼视觉完全平行，但保证 SVG boundingBox height > 0，实线渐变正常渲染。
    const safeEndY = Math.abs(endY - startY) < 0.1 ? startY + 0.05 : endY;
    return `M ${startX} ${startY} C ${startX + deltaX} ${startY}, ${endX - deltaX} ${safeEndY}, ${endX} ${safeEndY}`;
  };

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
      <defs>
        {/* 动态流动虚线光效动画 */}
        <style>{`
          @keyframes dash-flow {
            from {
              stroke-dashoffset: 16;
            }
            to {
              stroke-dashoffset: 0;
            }
          }
        `}</style>

        {/* 发光连线渐变滤镜 */}
        <filter id="glow-filter" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <linearGradient id="edge-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.8" />
        </linearGradient>

        <linearGradient id="edge-selected-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>

        <marker
          id="arrow-marker"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
        </marker>
      </defs>

      {/* 已存在的连线 */}
      {edges.map((edge) => {
        const sourceNode = nodeMap.get(edge.sourceNodeId);
        const targetNode = nodeMap.get(edge.targetNodeId);
        if (!sourceNode || !targetNode) return null;

        const startX = sourceNode.x + (sourceNode.width || NODE_WIDTH);
        const startY = sourceNode.y + (sourceNode.height || NODE_HEIGHT) / 2;
        const endX = targetNode.x;
        const endY = targetNode.y + (targetNode.height || NODE_HEIGHT) / 2;

        const pathData = getBezierPath(startX, startY, endX, endY);
        const isSelected = selectedEdgeId === edge.id;
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;

        return (
          <g key={edge.id} className="pointer-events-auto group">
            {/* 隐藏的透明加粗线，方便鼠标拾取点击 */}
            <path
              d={pathData}
              fill="none"
              stroke="transparent"
              strokeWidth="18"
              className="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onSelectEdge?.(edge.id);
              }}
            />

            {/* 视觉主连线基座 (确保水平直线或极端角度下均有坚固可见的纯色实线基底) */}
            <path
              d={pathData}
              fill="none"
              stroke={isSelected ? '#10b981' : '#0284c7'}
              strokeWidth={isSelected ? '3.5' : '2'}
              strokeOpacity={isSelected ? '0.9' : '0.75'}
            />

            {/* 视觉主连线 (渐变发光) */}
            <path
              d={pathData}
              fill="none"
              stroke={isSelected ? 'url(#edge-selected-gradient)' : 'url(#edge-gradient)'}
              strokeWidth={isSelected ? '3.5' : '2'}
              strokeDasharray={isSelected ? '6,3' : undefined}
              filter={isSelected ? 'url(#glow-filter)' : undefined}
              markerEnd="url(#arrow-marker)"
            />

            {/* 动态流动虚线光效 */}
            <path
              d={pathData}
              fill="none"
              stroke="#67e8f9"
              strokeWidth="2"
              strokeDasharray="4,12"
              className="opacity-60 transition-opacity group-hover:opacity-100"
              style={{
                animation: 'dash-flow 1.5s linear infinite',
              }}
            />

            {/* 连线中点删除按钮 */}
            {onDeleteEdge && (
              <g
                transform={`translate(${midX}, ${midY})`}
                className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteEdge(edge.id);
                }}
              >
                <circle r="10" fill="#1e293b" stroke="#ef4444" strokeWidth="1.5" />
                <line x1="-4" y1="-4" x2="4" y2="4" stroke="#ef4444" strokeWidth="1.5" />
                <line x1="4" y1="-4" x2="-4" y2="4" stroke="#ef4444" strokeWidth="1.5" />
              </g>
            )}
          </g>
        );
      })}

      {/* 实时拖拽创建连线时的临时引导虚线 */}
      {connectingFromNodeId && connectingMousePos && (() => {
        const sourceNode = nodeMap.get(connectingFromNodeId);
        if (!sourceNode) return null;
        const startX = sourceNode.x + (sourceNode.width || NODE_WIDTH);
        const startY = sourceNode.y + (sourceNode.height || NODE_HEIGHT) / 2;
        const pathData = getBezierPath(startX, startY, connectingMousePos.x, connectingMousePos.y);

        return (
          <path
            d={pathData}
            fill="none"
            stroke="#38bdf8"
            strokeWidth="2.5"
            strokeDasharray="5,5"
            className="animate-pulse"
          />
        );
      })()}
    </svg>
  );
}
