import { ALL_V4_OPERATOR_SCRIPTS, V4OperatorRunner } from '../src/operators/v4/index.ts';
import { createPythonWorkerPool } from '../src/engine/python-worker.ts';

async function main() {
  const csvDir = 'J:\\55所\\想定导出\\EventExport_CSV';
  console.log(`[Diagnose] Testing 40 V4 operators on real dataset: ${csvDir}`);

  const pool = createPythonWorkerPool({ timeoutMs: 120_000 });
  const runner = new V4OperatorRunner(ALL_V4_OPERATOR_SCRIPTS);

  try {
    const ping = await pool.ping();
    console.log(`[Diagnose] Python worker alive: Python ${ping.pythonVersion}, pandas ${ping.pandasVersion}, PID ${ping.pid}`);

    const results: Array<{
      id: string;
      name: string;
      status: string;
      rows: number;
      cols: number;
      columns: string[];
      missingReason?: string;
      durationMs: number;
    }> = [];

    console.log(`[Diagnose] Executing full V4 Operator DAG...`);
    const startTime = Date.now();
    const dagResult = await runner.runDag(
      ALL_V4_OPERATOR_SCRIPTS.map((s) => s.id),
      {
        runId: 'diagnose-55th-002',
        csvDir,
        pythonPool: pool,
        timeoutMs: 120_000,
      },
    );
    const totalTime = Date.now() - startTime;
    console.log(`[Diagnose] DAG finished in ${totalTime}ms. Topological order count: ${dagResult.topologicalOrder.length}\n`);

    for (const opId of dagResult.topologicalOrder) {
      const res = dagResult.results[opId];
      const spec = ALL_V4_OPERATOR_SCRIPTS.find((s) => s.id === opId);
      const rows = res?.dataset?.rows?.length ?? 0;
      const cols = res?.dataset?.columns?.length ?? 0;
      const columnNames = res?.dataset?.columns?.map((c) => c.name) ?? [];
      results.push({
        id: opId,
        name: spec?.name ?? opId,
        status: res?.status ?? 'unknown',
        rows,
        cols,
        columns: columnNames,
        missingReason: res?.missingDataReason,
        durationMs: res?.latencyMs ?? 0,
      });

      const icon = res?.status === 'valid' ? '✔' : res?.status === 'unavailable' ? '⚠' : '✖';
      console.log(
        `${icon} [${opId}] ${spec?.name} -> status: ${res?.status}, rows: ${rows}, cols: ${cols}, ms: ${res?.latencyMs ?? 0}${
          res?.missingDataReason ? ' | missing: ' + res.missingDataReason : ''
        }`,
      );
      if (columnNames.length > 0) {
        console.log(`   Columns: ${columnNames.join(', ')}`);
      }
      if (res?.dataset?.rows && res.dataset.rows.length > 0) {
        console.log(`   Sample [0]: ${JSON.stringify(res.dataset.rows[0])}`);
        if (res.dataset.rows.length > 1) {
          console.log(`   Sample [1]: ${JSON.stringify(res.dataset.rows[1])}`);
        }
      }
    }

    const validCount = results.filter((r) => r.status === 'valid').length;
    const unavailCount = results.filter((r) => r.status === 'unavailable').length;
    const degradedCount = results.filter((r) => r.status === 'degraded').length;
    console.log(`\n======================================================`);
    console.log(`[Diagnose Summary] Total: ${results.length}, Valid: ${validCount}, Unavailable (Fail-Closed): ${unavailCount}, Degraded: ${degradedCount}`);
    console.log(`======================================================\n`);
  } catch (err) {
    console.error(`[Diagnose FATAL]`, err);
  } finally {
    await pool.dispose();
  }
}

main().catch(console.error);
