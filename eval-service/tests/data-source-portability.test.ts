import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_SIMULATIONS_DIR,
  DataSourceStore,
  REPO_ROOT,
  probeSimulationPath,
  resolvePhysicalPath,
  toPortablePath,
} from '../src/adapters/data-source-store.ts';
import { ImportJobManager } from '../src/adapters/import-job-manager.ts';
import { EvalSqliteStore } from '../src/adapters/sqlite-store.ts';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('DataSource Portability: relative path resolution, cross-machine repo healing & relocate', () => {
  const tmpDir = createTempDir('f1-ds-port-');
  const jsonFile = path.join(tmpDir, 'sources.json');
  const simDirA = path.join(tmpDir, 'sim_a');
  const simDirB = path.join(tmpDir, 'sim_b');
  fs.mkdirSync(simDirA, { recursive: true });
  fs.mkdirSync(simDirB, { recursive: true });
  fs.writeFileSync(path.join(simDirA, 'SimInfo.csv'), 'ScnName,TimelineID\nTestScnA,tl_1\n', 'utf-8');
  fs.writeFileSync(path.join(simDirB, 'SimInfo.csv'), 'ScnName,TimelineID\nTestScnB,tl_2\n', 'utf-8');

  // 1. 跨机器路径自愈：将其他电脑的绝对路径映射到当前 repoRoot 下的 demo-ui
  const fakeOldPcPath = 'Z:\\SomeOtherPC\\Workspace\\demo-ui\\proxy\\testdata\\bs-frames-sample.jsonl';
  const expectedRealPath = path.join(REPO_ROOT, 'demo-ui', 'proxy', 'testdata', 'bs-frames-sample.jsonl');
  if (fs.existsSync(expectedRealPath)) {
    const resolved = resolvePhysicalPath(fakeOldPcPath);
    assert.equal(path.resolve(resolved), path.resolve(expectedRealPath));
    assert.equal(toPortablePath(resolved), 'demo-ui/proxy/testdata/bs-frames-sample.jsonl');
  }

  // 2. DataSourceStore 路径重定向与探测
  const store = new DataSourceStore(jsonFile);
  store.upsert({
    id: 'custom_test_ds',
    name: '自定义测试数据源',
    kind: 'csv_dir',
    path: simDirA,
    enabled: true,
  });

  const beforeProbe = probeSimulationPath(simDirA, 'custom_test_ds');
  assert.equal(beforeProbe.accessible, true);
  assert.equal(beforeProbe.scenarioName, 'TestScnA');

  const relocated = store.relocateSourcePath('custom_test_ds', simDirB);
  assert.equal(relocated.scenarioName, 'TestScnB');
  assert.equal(path.resolve(store.getResolvedPath('custom_test_ds')!), path.resolve(simDirB));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('SQLite import_jobs: restart interruption marking, archive resume & chunked sqlite import', async () => {
  const tmpDir = createTempDir('f1-job-mgr-');
  const dbPath = path.join(tmpDir, 'test.db');
  const dsJsonPath = path.join(tmpDir, 'ds.json');
  const srcCsvDir = path.join(tmpDir, 'src_csv');
  const testSourceId = `test_arch_${Date.now().toString(36)}`;
  const dedicatedTarget = path.join(DEFAULT_SIMULATIONS_DIR, testSourceId);

  fs.mkdirSync(srcCsvDir, { recursive: true });
  fs.writeFileSync(path.join(srcCsvDir, 'SimInfo.csv'), 'ScnName,TimelineID\nResumeScn,tl_99\n', 'utf-8');
  fs.writeFileSync(
    path.join(srcCsvDir, 'SideCreated.csv'),
    'Time,SideID,SideName\n00:00:00,1,蓝方\n00:00:00,2,红方\n',
    'utf-8',
  );

  let sqliteStore: EvalSqliteStore | null = null;
  let sqliteStoreInitial: EvalSqliteStore | null = null;
  try {
    // 1. 验证重启自动把 running 任务转为 interrupted
    sqliteStoreInitial = new EvalSqliteStore(dbPath, { autoSeed: false });
    sqliteStoreInitial.upsertImportJob({
      jobId: 'job_crash_1',
      sourceId: testSourceId,
      sourceName: 'Crash Test',
      jobType: 'archive',
      status: 'running',
      totalFiles: 2,
      processedFiles: 1,
      totalBytes: 200,
      processedBytes: 100,
      completedFiles: ['SimInfo.csv'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    sqliteStoreInitial.close?.();

    // 重新打开数据库模拟服务重启
    sqliteStore = new EvalSqliteStore(dbPath, { autoSeed: false });
    const recoveredJob = sqliteStore.getImportJob('job_crash_1');
    assert.ok(recoveredJob);
    assert.equal(recoveredJob.status, 'interrupted');
    assert.deepEqual(recoveredJob.completedFiles, ['SimInfo.csv']);

    // 2. 验证从断点恢复归档任务（跳过已完成文件并最终将路径指向专用仓）
    const dsStore = new DataSourceStore(dsJsonPath);
    dsStore.upsert({
      id: testSourceId,
      name: 'Resume Archive Test',
      kind: 'csv_dir',
      path: srcCsvDir,
      enabled: true,
    });

    const events: string[] = [];
    const manager = new ImportJobManager({
      getSqliteStore: () => sqliteStore!,
      dataSourceStore: dsStore,
      broadcast: (evt) => events.push(evt),
    });

    const resumed = await manager.resumeJob('job_crash_1');
    assert.equal(resumed.jobId, 'job_crash_1');

    // 等待后台异步完成
    for (let i = 0; i < 40; i += 1) {
      const cur = manager.getJob('job_crash_1');
      if (cur && (cur.status === 'completed' || cur.status === 'failed')) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const finished = manager.getJob('job_crash_1');
    assert.equal(finished?.status, 'completed');
    assert.equal(finished?.percent, 100);
    assert.ok(fs.existsSync(path.join(dedicatedTarget, 'SideCreated.csv')));

    // 验证数据源路径已自动转为专用仓相对路径
    const updatedDs = dsStore.get(testSourceId);
    assert.equal(updatedDs?.path, `data/simulations/${testSourceId}`);

    // 3. 验证 SQLite 分批入库任务
    const sqlJob = await manager.startSqliteImportJob(testSourceId);
    for (let i = 0; i < 40; i += 1) {
      const cur = manager.getJob(sqlJob.jobId);
      if (cur && (cur.status === 'completed' || cur.status === 'failed')) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const sqlFinished = manager.getJob(sqlJob.jobId);
    assert.equal(sqlFinished?.status, 'completed');
    const savedRun = sqliteStore.getRunSituation(testSourceId);
    assert.ok(savedRun);
    assert.equal(savedRun.scenarioName, 'Resume Archive Test');

    // 4. 验证 deleteRun 级联删除该场次数据
    const deleted = sqliteStore.deleteRun(testSourceId);
    assert.equal(deleted, true);
    assert.equal(sqliteStore.getRunSituation(testSourceId), null);
    assert.equal(sqliteStore.listRuns().length, 0);
  } finally {
    try {
      sqliteStoreInitial?.close?.();
      sqliteStore?.close?.();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Windows 句柄延迟释放容错
    }
    if (fs.existsSync(dedicatedTarget)) {
      fs.rmSync(dedicatedTarget, { recursive: true, force: true });
    }
  }
});
