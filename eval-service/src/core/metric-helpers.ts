import type { AlarmThreshold, IndicatorReduceMethod } from './types.ts';

export function isAlarmThresholdTriggered(
  rawVal: number | boolean | null | undefined,
  th?: AlarmThreshold,
): boolean {
  if (!th || rawVal === null || rawVal === undefined) return false;
  const val = typeof rawVal === 'boolean' ? (rawVal ? 1 : 0) : Number(rawVal);
  if (!Number.isFinite(val)) return false;
  switch (th.operator) {
    case '>':
      return val > th.value;
    case '<':
      return val < th.value;
    case '==':
      return Math.abs(val - th.value) < 1e-6;
    case '>=':
      return val >= th.value;
    case '<=':
      return val <= th.value;
    default:
      return false;
  }
}

export function reduceNumericArray(
  values: number[],
  method: IndicatorReduceMethod = 'first',
): number | null {
  if (values.length === 0) return null;
  switch (method) {
    case 'first':
      return values[0];
    case 'last':
      return values[values.length - 1];
    case 'sum':
      return Math.round(values.reduce((a, b) => a + b, 0) * 10000) / 10000;
    case 'mean':
      return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10000) / 10000;
    case 'max':
      return Math.max(...values);
    case 'min':
      return Math.min(...values);
    case 'median': {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const med =
        sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      return Math.round(med * 10000) / 10000;
    }
    default:
      return values[0];
  }
}
