import { defaultMetricGraphStore } from '../src/indicators/metric-graph-store.ts';
import { defaultSystemDagStore } from '../src/systems/system-dag-store.ts';

const mg = defaultMetricGraphStore.get('mg_v4_metrics_guide_full');
console.log('mg_v4_metrics_guide_full found:', !!mg);
if (mg) {
  const v = defaultMetricGraphStore.validate(mg);
  console.log('mg valid:', v.valid, 'errors:', v.errors);
  console.log('mg node count:', mg.nodes.length, 'edge count:', mg.edges.length);
}

const sys = defaultSystemDagStore.get('sys_v4_metrics_guide_full');
console.log('sys_v4_metrics_guide_full found:', !!sys);
if (sys) {
  const v = defaultSystemDagStore.validate(sys);
  console.log('sys valid:', v.valid, 'errors:', v.errors);
  console.log('sys node count:', sys.nodes.length, 'edge count:', sys.edges.length);
}
