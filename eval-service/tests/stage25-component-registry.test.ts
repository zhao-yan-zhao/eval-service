import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ComponentRegistryStore,
  validateComponentManifest,
  type ComponentManifest,
} from '../src/operators/component-store.ts';
import { createEvalApp } from '../src/server.ts';

test('Stage 25.1 - Component Manifest 结构与 JSON Schema 校验', () => {
  // 1. 合法组件
  const validManifest: ComponentManifest = {
    id: 'algo_radar_cross_section',
    name: '雷达散射截面积 (RCS) 拟合器',
    version: '1.0.0',
    category: 'custom',
    engine: 'Python 3.12 / 物理气动拟合',
    engineType: 'python',
    description: '根据俯仰角与方位角动态拟合目标 RCS 反射强度',
    isBuiltin: false,
    configSchema: {
      type: 'object',
      required: ['frequencyGhz'],
      properties: {
        frequencyGhz: {
          type: 'number',
          title: '探测雷达频段 (GHz)',
          default: 10.0,
          minimum: 1.0,
          maximum: 40.0,
        },
      },
    },
  };

  const valRes = validateComponentManifest(validManifest);
  assert.equal(valRes.valid, true, '合法 Manifest 校验应通过');
  assert.equal(valRes.errors.length, 0);

  // 2. 缺少 id
  const noIdRes = validateComponentManifest({ ...validManifest, id: '' });
  assert.equal(noIdRes.valid, false, '空 id 应该拦截');

  // 3. 非法字符 id
  const badIdRes = validateComponentManifest({ ...validManifest, id: 'bad id with spaces!' });
  assert.equal(badIdRes.valid, false, '含有空格或特殊字符的 id 应该拦截');

  // 4. 缺少 configSchema 或类型非法
  const badSchemaRes = validateComponentManifest({ ...validManifest, configSchema: 'not_an_object' });
  assert.equal(badSchemaRes.valid, false, '非对象 configSchema 应该拦截');
});

test('Stage 25.2 - ComponentRegistryStore 核心逻辑与保护机制', () => {
  const store = new ComponentRegistryStore();

  // 1. 默认包含 6 门核心内置组件
  const all = store.list();
  assert.ok(all.length >= 6, `内置组件数量应至少为 6 项，当前为 ${all.length}`);
  const tableInput = store.get('algo_table_input');
  assert.ok(tableInput, '应包含 algo_table_input');
  assert.equal(tableInput?.isBuiltin, true);

  // 2. 禁止覆盖内置核心组件
  assert.throws(
    () => {
      store.import({
        id: 'algo_table_input',
        name: '篡改表输入',
        category: 'data_input',
        engine: 'Hacked',
        engineType: 'builtin',
        description: '非法篡改',
        isBuiltin: false,
        configSchema: { type: 'object', properties: {} },
      });
    },
    /禁止覆盖内置核心组件/,
    '必须拦截对内置组件的覆盖'
  );

  // 3. 禁止删除内置核心组件
  assert.throws(
    () => {
      store.delete('algo_table_input');
    },
    /受系统级保护，禁止删除/,
    '必须拦截对内置组件的删除'
  );

  // 4. 成功导入自定义组件
  const customId = `algo_test_mcda_${Date.now()}`;
  const imported = store.import({
    id: customId,
    name: '自适应 TOPSIS 排序组件',
    category: 'custom',
    engine: 'Python 3.12',
    engineType: 'python',
    description: '多属性决策排序算法',
    isBuiltin: false,
    configSchema: {
      type: 'object',
      properties: {
        weightRatio: { type: 'number', default: 0.5 },
      },
    },
  });

  assert.equal(imported.id, customId);
  assert.equal(imported.isCustom, true);
  assert.ok(store.get(customId), '导入后应可通过 get 查询到');

  // 5. 成功删除自定义组件
  const deleted = store.delete(customId);
  assert.equal(deleted, true, '自定义组件应可成功删除');
  assert.equal(store.get(customId), null, '删除后应无法查询到');
});

test('Stage 25.3 - 算子组件库 REST API 全链路端到端校验', async () => {
  const app = await createEvalApp({ autoSeed: false });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', () => resolve()));
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. GET /api/components
    const listRes = await fetch(`${baseUrl}/api/components`);
    assert.equal(listRes.status, 200);
    const listData = (await listRes.json()) as any;
    assert.equal(listData.ok, true);
    assert.ok(Array.isArray(listData.components));
    assert.ok(listData.components.length >= 6);

    // 2. POST /api/components/validate
    const valRes = await fetch(`${baseUrl}/api/components/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: {
          id: 'algo_val_test',
          name: '校验测试组件',
          description: '用于测试接口校验',
          configSchema: {
            type: 'object',
            properties: { threshold: { type: 'number' } },
          },
        },
      }),
    });
    assert.equal(valRes.status, 200);
    const valData = (await valRes.json()) as any;
    assert.equal(valData.valid, true);

    // 3. POST /api/components/import
    const importId = `algo_rest_custom_${Date.now()}`;
    const importRes = await fetch(`${baseUrl}/api/components/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: {
          id: importId,
          name: 'REST 导入组件测试',
          category: 'spatial',
          engine: 'Turf.js + Python',
          engineType: 'python',
          description: '测试 REST 接口导入',
          configSchema: {
            type: 'object',
            properties: { maxKm: { type: 'number', default: 30 } },
          },
        },
      }),
    });
    assert.equal(importRes.status, 200);
    const importData = (await importRes.json()) as any;
    assert.equal(importData.ok, true);
    assert.equal(importData.component.id, importId);

    // 4. DELETE /api/components/:id
    const delRes = await fetch(`${baseUrl}/api/components/${importId}`, {
      method: 'DELETE',
    });
    assert.equal(delRes.status, 200);
    const delData = (await delRes.json()) as any;
    assert.equal(delData.ok, true);
    assert.equal(delData.deleted, true);
  } finally {
    await app.close();
  }
});
