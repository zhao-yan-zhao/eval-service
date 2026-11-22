import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { IndicatorDefinition, IndicatorSystem, SystemDimensionNode } from '../src/core/types.ts';
import {
  flattenSystemTree,
  isDimensionNode,
  isIndicatorLeaf,
  normalizeBranchWeights,
  validateSystemWeights,
} from '../src/ui/components/systems/tree-walker.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(__dirname, '../src/systems/catalog.json');
const INDICATOR_CATALOG_PATH = path.resolve(__dirname, '../src/indicators/catalog.json');

test('tree-walker: load pre-built systems from catalog.json', () => {
  assert.ok(fs.existsSync(CATALOG_PATH), 'catalog.json 必须存在');
  const systems = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')) as IndicatorSystem[];
  assert.ok(Array.isArray(systems));
  assert.equal(systems.length, 2);

  const found = systems.find((s) => s.systemId === 'sys_corridor_compliance_v1');
  assert.ok(found, '应该包含预置体系: sys_corridor_compliance_v1');
  assert.ok(found.root.children.length > 0, '应该有根节点子集');
});

test('tree-walker: flattening and depth calculation', () => {
  const systems = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')) as IndicatorSystem[];
  const corridorSys = systems.find((s) => s.systemId === 'sys_corridor_compliance_v1')!;

  const flatNodes = flattenSystemTree(corridorSys);
  assert.ok(flatNodes.length > 0);

  // 根节点校验
  const root = flatNodes[0];
  assert.equal(root.id, 'sys_corridor_compliance_v1');
  assert.equal(root.kind, 'root');
  assert.equal(root.depth, 0);
  assert.equal(root.localWeight, 1.0);
  assert.equal(root.globalWeight, 1.0);
  assert.equal(root.childrenCount, 1);
  assert.equal(root.weightSumValid, true);
  assert.deepEqual(root.path, ['sys_corridor_compliance_v1']);

  // 第一层为维度节点
  const dimNodes = flatNodes.filter((n) => n.kind === 'dimension');
  assert.equal(dimNodes.length, 1);
  for (const dim of dimNodes) {
    assert.equal(dim.depth, 1);
    assert.ok(dim.childrenCount > 0);
    assert.equal(dim.weightSumValid, true);
    assert.equal(dim.path.length, 2);
    assert.equal(dim.path[0], 'sys_corridor_compliance_v1');
  }

  // 第二层为指标叶子节点
  const leafNodes = flatNodes.filter((n) => n.kind === 'leaf');
  assert.equal(leafNodes.length, 1);
  for (const leaf of leafNodes) {
    assert.equal(leaf.depth, 2);
    assert.equal(leaf.childrenCount, 0);
    assert.equal(leaf.weightSumValid, true);
    assert.equal(leaf.path.length, 3);
    assert.ok(leaf.indicatorRef);
    assert.equal(isIndicatorLeaf(leaf.originalNode as any), true);
  }
});

test('tree-walker: cascading global weights sum to 1.0', () => {
  const systems = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')) as IndicatorSystem[];

  for (const sys of systems) {
    const flatNodes = flattenSystemTree(sys);
    const leaves = flatNodes.filter((n) => n.kind === 'leaf');

    // 验证每个叶子的全局权重 = 父级全局权重 * 本地权重
    for (const leaf of leaves) {
      const parentDimId = leaf.path[leaf.path.length - 2];
      const parentNode = flatNodes.find((n) => n.id === parentDimId)!;
      const expectedGlobal =
        Math.round(parentNode.globalWeight * leaf.localWeight * 1e6) / 1e6;
      assert.equal(
        leaf.globalWeight,
        expectedGlobal,
        `叶子节点 ${leaf.name} 的全局权重级联计算正确`,
      );
    }

    // 所有叶子节点全局权重之和应严格等于 1.0
    const totalGlobal = leaves.reduce((acc, l) => acc + l.globalWeight, 0);
    assert.ok(
      Math.abs(totalGlobal - 1.0) <= 1e-4,
      `体系 ${sys.systemId} 所有叶子全局权重总和应该为 1.0，实际为 ${totalGlobal}`,
    );
  }
});

test('tree-walker: weight sum validation for pre-built and corrupted trees', () => {
  const systems = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')) as IndicatorSystem[];

  // 1. 所有预置体系校验全部通过
  for (const sys of systems) {
    const report = validateSystemWeights(sys);
    assert.equal(
      report.valid,
      true,
      `预置体系 ${sys.systemId} 应通过校验，但收到: ${JSON.stringify(report.invalidBranches)}`,
    );
  }

  // 2. 篡改分支权重后能够准确检出异常分支
  const corridorSys = structuredClone(systems.find((s) => s.systemId === 'sys_corridor_compliance_v1')!);
  const compDim = corridorSys.root.children[0] as SystemDimensionNode;
  assert.equal(isDimensionNode(compDim), true);
  // 修改第一个指标权重从 1.0 变为 0.20，导致 compDim 子总和变为 0.20 != 1.0
  compDim.children[0].weight = 0.20;

  const reportAfterTamper = validateSystemWeights(corridorSys);
  assert.equal(reportAfterTamper.valid, false);
  assert.equal(reportAfterTamper.invalidBranches.length, 1);
  assert.deepEqual(reportAfterTamper.invalidBranches[0].path, [
    corridorSys.name,
    compDim.id,
  ]);
  assert.equal(reportAfterTamper.invalidBranches[0].sum, 0.2);

  // 直接对 SystemDimensionNode 节点调用
  const dimReport = validateSystemWeights(compDim);
  assert.equal(dimReport.valid, false);
  assert.equal(dimReport.invalidBranches.length, 1);
  assert.equal(dimReport.invalidBranches[0].sum, 0.2);

  // 空子节点分支校验
  const emptyDim: SystemDimensionNode = {
    id: 'dim_empty',
    name: '空维度',
    weight: 0.5,
    children: [],
  };
  const emptyReport = validateSystemWeights(emptyDim);
  assert.equal(emptyReport.valid, false);
  assert.equal(emptyReport.invalidBranches[0].sum, 0);
});

test('tree-walker: normalizeBranchWeights calculates strictly normalized 1.0 weights', () => {
  // 1. 常规权重按比例重归一化
  const branch1 = [
    { indicatorRef: 'ind_a', weight: 2 },
    { indicatorRef: 'ind_b', weight: 3 },
    { indicatorRef: 'ind_c', weight: 5 },
  ];
  const normalized1 = normalizeBranchWeights(branch1 as any);
  assert.equal(normalized1.length, 3);
  assert.equal(normalized1[0].weight, 0.2);
  assert.equal(normalized1[1].weight, 0.3);
  assert.equal(normalized1[2].weight, 0.5);
  const sum1 = normalized1.reduce((acc, c) => acc + c.weight, 0);
  assert.equal(sum1, 1.0);

  // 2. 奇数等分时处理四舍五入尾差
  const branch2 = [
    { indicatorRef: 'ind_1', weight: 1 },
    { indicatorRef: 'ind_2', weight: 1 },
    { indicatorRef: 'ind_3', weight: 1 },
  ];
  const normalized2 = normalizeBranchWeights(branch2 as any);
  assert.equal(normalized2[0].weight, 0.3333);
  assert.equal(normalized2[1].weight, 0.3333);
  assert.equal(normalized2[2].weight, 0.3334);
  const sum2 = normalized2.reduce((acc, c) => acc + c.weight, 0);
  assert.equal(sum2, 1.0);

  // 3. 全 0 权重平均分配
  const branch3 = [
    { indicatorRef: 'ind_x', weight: 0 },
    { indicatorRef: 'ind_y', weight: 0 },
  ];
  const normalized3 = normalizeBranchWeights(branch3 as any);
  assert.equal(normalized3[0].weight, 0.5);
  assert.equal(normalized3[1].weight, 0.5);
  const sum3 = normalized3.reduce((acc, c) => acc + c.weight, 0);
  assert.equal(sum3, 1.0);

  // 4. 单子节点直接为 1.0
  const branch4 = [{ indicatorRef: 'ind_single', weight: 0.42 }];
  const normalized4 = normalizeBranchWeights(branch4 as any);
  assert.equal(normalized4[0].weight, 1.0);

  // 5. 空数组返回空
  const emptyNorm = normalizeBranchWeights([]);
  assert.deepEqual(emptyNorm, []);
});

test('tree-walker: indicatorMap and evalScores enrichment', () => {
  const systems = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')) as IndicatorSystem[];
  const corridorSys = systems.find((s) => s.systemId === 'sys_corridor_compliance_v1')!;

  const indicators = JSON.parse(
    fs.readFileSync(INDICATOR_CATALOG_PATH, 'utf-8'),
  ) as IndicatorDefinition[];
  const indMap = new Map<string, IndicatorDefinition>();
  for (const ind of indicators) {
    indMap.set(ind.indicatorId, ind);
  }

  const mockScores: Record<string, number> = {
    sys_corridor_compliance_v1: 90.0,
    dim_compliance: 90.0,
    leaf_corridor: 90.0,
  };

  const flatNodes = flattenSystemTree(corridorSys, indMap, mockScores);

  const root = flatNodes[0];
  assert.equal(root.score, 90.0);

  const compDim = flatNodes.find((n) => n.id === 'dim_compliance')!;
  assert.equal(compDim.score, 90.0);

  const corridorLeaf = flatNodes.find((n) => n.id === 'leaf_corridor')!;
  assert.equal(corridorLeaf.score, 90.0);
  assert.equal(corridorLeaf.indicatorRef, 'ind_roe_corridor_compliance');
  assert.equal(corridorLeaf.atomRef, 'roe.corridor_spatial_compliance');
  assert.equal(corridorLeaf.name, '任务航路走廊空间遵从率');
});
