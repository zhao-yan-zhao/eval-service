import fs from 'node:fs';
import path from 'node:path';

// 1. Patch CanvasPreviewTable.tsx
const previewTableFile = path.resolve('eval-service/src/ui/components/pipeline-canvas/CanvasPreviewTable.tsx');
let previewContent = fs.readFileSync(previewTableFile, 'utf-8');
previewContent = previewContent.replace(
  'const columns = dataset?.schema || [];',
  'const columns = dataset?.columns?.length ? dataset.columns : (dataset?.schema || []);'
);
fs.writeFileSync(previewTableFile, previewContent, 'utf-8');
console.log('Patched CanvasPreviewTable.tsx');

// 2. Patch CanvasNodeCard.tsx
const nodeCardFile = path.resolve('eval-service/src/ui/components/pipeline-canvas/CanvasNodeCard.tsx');
let cardContent = fs.readFileSync(nodeCardFile, 'utf-8');

const oldCardStatus = `            <span>
              {runtime?.rowCount !== undefined
                ? \`\${runtime.rowCount} 行\`
                : '待执行'}
            </span>
            {runtime?.columnCount !== undefined && (
              <span className="text-slate-500">· {runtime.columnCount} 列</span>
            )}`;

const newCardStatus = `            <span className="truncate">
              {runtime?.status === 'error'
                ? (runtime?.errorMessage ? \`异常: \${runtime.errorMessage}\` : '计算异常')
                : runtime?.rowCount !== undefined
                ? \`\${runtime.rowCount} 行\`
                : '待执行'}
            </span>
            {runtime?.status !== 'error' && runtime?.columnCount !== undefined && (
              <span className="text-slate-500 shrink-0">· {runtime.columnCount} 列</span>
            )}`;

if (cardContent.includes(oldCardStatus)) {
  cardContent = cardContent.replace(oldCardStatus, newCardStatus);
  fs.writeFileSync(nodeCardFile, cardContent, 'utf-8');
  console.log('Patched CanvasNodeCard.tsx');
} else {
  console.warn('Could not find oldCardStatus in CanvasNodeCard.tsx');
}
