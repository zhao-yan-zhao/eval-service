/**
 * F1 / CMO 仿真时间格式统一解析与格式化
 * 实证覆盖：
 * 1) ISO-8601 字符串 ("2026-06-01T04:00:00Z")
 * 2) .NET Ticks 18位串 ("639100000000000000" -> UTC epoch ms)
 * 3) C# TimeSpan 'c' 格式 ("[d.]hh:mm:ss[.fffffff]", 如 "00:02:04.8000000" 或 "1.02:00:00")
 * 4) 美式 DateTime ("MM/dd/yyyy HH:mm:ss[.fff]", SimInfo / UseZeroHour=false)
 */

const DOTNET_EPOCH_TICKS = 621355968000000000n;
const TIMESPAN_RE = /^(?:(\d+)\.)?(\d{1,3}):([0-5]\d):([0-5]\d)(?:\.(\d+))?$/;
const US_DATETIME_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):([0-5]\d):([0-5]\d)(?:\.(\d+))?$/;
const TICKS_RE = /^\d{15,20}$/;

export interface ParsedTimeResult {
  kind: 'epoch_ms' | 'relative_seconds';
  epochMs?: number;
  relativeSeconds?: number;
  clockText: string;
}

export function formatSecondsToClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '00:00:00';
  const rounded = Math.floor(totalSeconds);
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function epochMsToClockText(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '00:00:00';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function parseF1Time(raw: unknown): ParsedTimeResult | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/^\uFEFF+/g, '').trim();
  if (!s) return null;

  // 1) .NET Ticks 字符串（15~20位纯数字，基准 0001-01-01T00:00:00Z）
  if (TICKS_RE.test(s)) {
    try {
      const ticks = BigInt(s);
      if (ticks > DOTNET_EPOCH_TICKS) {
        const msBig = (ticks - DOTNET_EPOCH_TICKS) / 10000n;
        const ms = Number(msBig);
        if (Number.isFinite(ms)) {
          return {
            kind: 'epoch_ms',
            epochMs: ms,
            clockText: epochMsToClockText(ms),
          };
        }
      }
    } catch {
      // fall through
    }
  }

  // 2) 纯秒数（>=0 且非 15+ 位整数）
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const val = Number(s);
    if (Number.isFinite(val) && val >= 0) {
      return {
        kind: 'relative_seconds',
        relativeSeconds: val,
        clockText: formatSecondsToClock(val),
      };
    }
  }

  // 3) C# TimeSpan 'c': [d.]hh:mm:ss[.fffffff]
  const tsMatch = TIMESPAN_RE.exec(s);
  if (tsMatch) {
    const days = tsMatch[1] ? Number(tsMatch[1]) : 0;
    const hours = Number(tsMatch[2]);
    const mins = Number(tsMatch[3]);
    const secs = Number(tsMatch[4]);
    const frac = tsMatch[5] ? Number(`0.${tsMatch[5]}`) : 0;
    const total = days * 86400 + hours * 3600 + mins * 60 + secs + frac;
    return {
      kind: 'relative_seconds',
      relativeSeconds: total,
      clockText: formatSecondsToClock(total),
    };
  }

  // 4) 美式日期时间 MM/dd/yyyy HH:mm:ss[.fff]
  const usMatch = US_DATETIME_RE.exec(s);
  if (usMatch) {
    const month = Number(usMatch[1]);
    const day = Number(usMatch[2]);
    const year = Number(usMatch[3]);
    const hour = Number(usMatch[4]);
    const min = Number(usMatch[5]);
    const sec = Number(usMatch[6]);
    const msPart = usMatch[7] ? Math.round(Number(`0.${usMatch[7]}`) * 1000) : 0;
    const ms = Date.UTC(year, month - 1, day, hour, min, sec, msPart);
    if (Number.isFinite(ms)) {
      return {
        kind: 'epoch_ms',
        epochMs: ms,
        clockText: epochMsToClockText(ms),
      };
    }
  }

  // 5) 标准 ISO-8601 / YYYY-MM-DD HH:mm:ss
  const isoCandidate = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(s)
    ? `${s.replace(' ', 'T')}Z`
    : s;
  const parsedMs = Date.parse(isoCandidate);
  if (Number.isFinite(parsedMs)) {
    return {
      kind: 'epoch_ms',
      epochMs: parsedMs,
      clockText: epochMsToClockText(parsedMs),
    };
  }

  return null;
}
