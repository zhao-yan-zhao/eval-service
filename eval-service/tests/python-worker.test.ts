import assert from 'node:assert/strict';
import test, { after, describe } from 'node:test';
import {
  PythonWorkerPool,
  createPythonWorkerPool,
  disposeDefaultPythonWorkerPool,
} from '../src/engine/python-worker.ts';

describe('V4 PythonWorkerPool & AST Security Sandbox', () => {
  const poolsToDispose: PythonWorkerPool[] = [];

  function trackPool(pool: PythonWorkerPool): PythonWorkerPool {
    poolsToDispose.push(pool);
    return pool;
  }

  after(async () => {
    for (const pool of poolsToDispose) {
      await pool.dispose();
    }
    await disposeDefaultPythonWorkerPool();
  });

  test('1) ping() succeeds against real Python 3.10 + pandas and reports versions', async () => {
    const pool = trackPool(createPythonWorkerPool({ timeoutMs: 30_000 }));
    const ping = await pool.ping();

    assert.equal(ping.pong, true);
    assert.match(ping.pythonVersion, /^3\.10\./);
    assert.match(ping.pandasVersion, /^\d+\.\d+\.\d+/);
    assert.ok(typeof ping.pid === 'number' && ping.pid > 0);
    assert.ok(ping.latencyMs >= 0);

    await pool.dispose();
  });

  test('2) real DataFrame execution using T(), C(), params, prev_output_df, and in_polygon()', async () => {
    const pool = trackPool(createPythonWorkerPool({ timeoutMs: 30_000 }));

    // Step A: Patrol / Strike spatial + tabular calculation with T(), C(), params, in_polygon(), print(), and typed columns
    const res1 = await pool.execute({
      inputDfDict: {
        MissionChanged: {
          columns: [
            { name: 'MissionID', type: 'string' },
            { name: 'MissionName', type: 'string' },
            { name: 'MissionClass', type: 'string' },
            { name: 'Side', type: 'string' },
          ],
          rows: [
            { MissionID: 'M1', MissionName: '东海巡逻走廊', MissionClass: 'Patrol', Side: 'Blue' },
            { MissionID: 'M2', MissionName: '无关支援', MissionClass: 'Support', Side: 'Blue' },
          ],
        },
        UnitPositions: [
          { UnitID: 'U1', UnitLongitude: 121.5, UnitLatitude: 30.5, Time: '2026-06-01T04:00:00Z' },
          { UnitID: 'U2', UnitLongitude: 125.0, UnitLatitude: 35.0, Time: '2026-06-01T04:00:05Z' },
        ],
      },
      prevOutputDf: null,
      params: {
        minOnStationSec: 1800,
        corridor: [
          [121.0, 30.0],
          [122.0, 30.0],
          [122.0, 31.0],
          [121.0, 31.0],
        ],
      },
      code: `
import pandas as pd
import numpy as np
from itertools import combinations

print("step1_log: starting spatial patrol check")
missions = T("MissionChanged")
patrol_missions = missions[C(missions, "MissionClass") == "Patrol"].copy()
positions = T("UnitPositions")
poly = params["corridor"]

in_flags = [in_polygon(lon, lat, poly) for lon, lat in zip(positions["UnitLongitude"], positions["UnitLatitude"])]
positions["InCorridor"] = in_flags
positions["Score"] = np.where(positions["InCorridor"], np.float64(1.0), np.nan)
positions["Count"] = np.int64(len(list(combinations(["A", "B"], 2))))
positions["ParsedTime"] = pd.to_datetime(positions["Time"], errors="coerce")
positions["MissingCol"] = C(positions, "NonExistentColumn", "fallback")
positions["MinThreshold"] = float(params["minOnStationSec"])
positions["MissionCount"] = int(len(patrol_missions))
positions["HadPrev"] = prev_output_df is not None

output_df = positions[["UnitID", "InCorridor", "Score", "Count", "ParsedTime", "MissingCol", "MinThreshold", "MissionCount", "HadPrev"]].copy()
`,
    });

    assert.equal(res1.success, true, res1.error);
    assert.ok(res1.logs?.includes('step1_log: starting spatial patrol check'));
    assert.ok(res1.dataset);
    assert.equal(res1.dataset.totalRows, 2);
    assert.equal(res1.dataset.rows.length, 2);

    const colTypes = Object.fromEntries(res1.dataset.columns.map((c) => [c.name, c.type]));
    assert.equal(colTypes.UnitID, 'string');
    assert.equal(colTypes.InCorridor, 'boolean');
    assert.equal(colTypes.Score, 'number');
    assert.equal(colTypes.Count, 'number');
    assert.equal(colTypes.ParsedTime, 'datetime');
    assert.equal(colTypes.HadPrev, 'boolean');

    assert.equal(res1.dataset.rows[0].UnitID, 'U1');
    assert.equal(res1.dataset.rows[0].InCorridor, true);
    assert.equal(res1.dataset.rows[0].Score, 1);
    assert.equal(res1.dataset.rows[0].Count, 1);
    assert.equal(res1.dataset.rows[0].MissingCol, 'fallback');
    assert.equal(res1.dataset.rows[0].MinThreshold, 1800);
    assert.equal(res1.dataset.rows[0].MissionCount, 1);
    assert.equal(res1.dataset.rows[0].HadPrev, false);

    assert.equal(res1.dataset.rows[1].UnitID, 'U2');
    assert.equal(res1.dataset.rows[1].InCorridor, false);
    assert.equal(res1.dataset.rows[1].Score, null); // NaN cleanly serialized as null

    // Step B: Chained prev_output_df execution + NaT handling
    const res2 = await pool.execute({
      prevOutputDf: res1.dataset,
      params: { bonus: 10 },
      code: `
prev = prev_output_df.copy()
in_count = int(prev["InCorridor"].sum())
output_df = pd.DataFrame({
    "InCount": [np.int64(in_count)],
    "BonusScore": [np.float64(in_count * params["bonus"])],
    "EmptyTime": [pd.NaT],
})
`,
    });

    assert.equal(res2.success, true, res2.error);
    assert.ok(res2.dataset);
    assert.equal(res2.dataset.rows.length, 1);
    assert.equal(res2.dataset.rows[0].InCount, 1);
    assert.equal(res2.dataset.rows[0].BonusScore, 10);
    assert.equal(res2.dataset.rows[0].EmptyTime, null);

    await pool.dispose();
  });

  test('3) persistent worker reuse across multiple calls with strict state isolation', async () => {
    const pool = trackPool(createPythonWorkerPool({ timeoutMs: 30_000 }));

    // Warm up once
    const ping1 = await pool.ping();
    const initialPid = ping1.pid;
    assert.ok(initialPid);

    const firstRes = await pool.execute({
      code: `
leaked_secret = "should_not_persist"
print("first_call_only")
output_df = pd.DataFrame({"val": [1]})
`,
    });
    assert.equal(firstRes.success, true, firstRes.error);

    const t0 = performance.now();
    const secondRes = await pool.execute({
      code: `
try:
    _ = leaked_secret
    leaked = True
except NameError:
    leaked = False
print("second_call")
output_df = pd.DataFrame({"leaked": [leaked], "val": [2]})
`,
    });
    const secondElapsed = performance.now() - t0;

    const ping2 = await pool.ping();
    assert.equal(ping2.pid, initialPid, 'worker process should be reused without respawn');
    assert.equal(secondRes.success, true, secondRes.error);
    assert.equal(secondRes.dataset?.rows[0].leaked, false, 'globals must be isolated between calls');
    assert.equal(secondRes.dataset?.rows[0].val, 2);
    assert.equal(secondRes.logs?.includes('first_call_only'), false, 'logs must not bleed across calls');
    assert.ok(secondElapsed < 500, `warm call should be fast, got ${secondElapsed.toFixed(1)}ms`);

    await pool.dispose();
  });

  test('4) AST sandbox blocks dangerous calls, imports, and dunder/__builtins__ traversals', async () => {
    const pool = trackPool(createPythonWorkerPool({ timeoutMs: 30_000 }));

    const maliciousPayloads: Array<{ label: string; code: string }> = [
      {
        label: 'open file',
        code: `
data = open('/etc/passwd').read()
output_df = pd.DataFrame({'data': [data]})
`,
      },
      {
        label: 'import os',
        code: `
import os
output_df = pd.DataFrame({'cwd': [os.getcwd()]})
`,
      },
      {
        label: 'eval call',
        code: `
x = eval('1+1')
output_df = pd.DataFrame({'x': [x]})
`,
      },
      {
        label: 'alias eval bypass attempt',
        code: `
fn = eval
output_df = pd.DataFrame({'x': [fn('1+1')]})
`,
      },
      {
        label: '__builtins__ direct access',
        code: `
b = __builtins__
output_df = pd.DataFrame({'x': [str(b)]})
`,
      },
      {
        label: '__subclasses__ traversal',
        code: `
subs = ().__class__.__bases__[0].__subclasses__()
output_df = pd.DataFrame({'cnt': [len(subs)]})
`,
      },
      {
        label: 'getattr bypass attempt',
        code: `
fn = getattr(pd, 'read_csv')
output_df = pd.DataFrame({'x': [1]})
`,
      },
    ];

    for (const item of maliciousPayloads) {
      const res = await pool.execute({ code: item.code });
      assert.equal(res.success, false, `expected security block for ${item.label}`);
      assert.equal(res.securityBlocked, true, `expected securityBlocked=true for ${item.label}`);
      assert.ok(res.error && res.error.length > 0, `expected error message for ${item.label}`);
    }

    // Worker remains healthy after rejected scripts
    const cleanRes = await pool.execute({
      code: `output_df = pd.DataFrame({"ok": [True]})`,
    });
    assert.equal(cleanRes.success, true, cleanRes.error);
    assert.equal(cleanRes.dataset?.rows[0].ok, true);

    await pool.dispose();
  });

  test('5) missing output_df or syntax error returns clean failure without securityBlocked', async () => {
    const pool = trackPool(createPythonWorkerPool({ timeoutMs: 30_000 }));

    const missingOut = await pool.execute({
      code: `x = 1 + 2`,
    });
    assert.equal(missingOut.success, false);
    assert.equal(missingOut.securityBlocked, false);
    assert.match(missingOut.error ?? '', /output_df/);

    const syntaxErr = await pool.execute({
      code: `def broken(:\n  pass`,
    });
    assert.equal(syntaxErr.success, false);
    assert.equal(syntaxErr.securityBlocked, false);
    assert.match(syntaxErr.error ?? '', /SyntaxError/);

    await pool.dispose();
  });

  test('6) timeout recovery kills hung worker, rejects cleanly, and auto-restarts for subsequent valid call', async () => {
    const pool = trackPool(createPythonWorkerPool({ timeoutMs: 300, maxRestarts: 3 }));
    const pingBefore = await pool.ping(20_000);
    const pid1 = pingBefore.pid;

    const infiniteLoopPromise = pool.execute({
      timeoutMs: 250,
      code: `
while True:
    pass
`,
    });

    const queuedAfterHungPromise = pool.execute({
      timeoutMs: 15_000,
      code: `
import math
output_df = pd.DataFrame({"recovered": [True], "val": [round(math.pi, 2)]})
`,
    });

    await assert.rejects(
      infiniteLoopPromise,
      (err: unknown) => err instanceof Error && /timed out/i.test(err.message),
    );

    const recoveredRes = await queuedAfterHungPromise;
    assert.equal(recoveredRes.success, true, recoveredRes.error);
    assert.equal(recoveredRes.dataset?.rows[0].recovered, true);
    assert.equal(recoveredRes.dataset?.rows[0].val, 3.14);

    // Subsequent sequential call also runs smoothly on the auto-restarted worker
    const sequentialRes = await pool.execute({
      timeoutMs: 15_000,
      code: `output_df = pd.DataFrame({"seq": [2]})`,
    });
    assert.equal(sequentialRes.success, true, sequentialRes.error);
    assert.equal(sequentialRes.dataset?.rows[0].seq, 2);

    const pingAfter = await pool.ping(20_000);
    assert.notEqual(pingAfter.pid, pid1, 'hung worker must have been killed and respawned with a new PID');
    assert.ok(pool.getStats().restartCount >= 1);

    await pool.dispose();
  });
});
