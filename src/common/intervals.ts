type Unit =
  | 's'
  | 'sec'
  | 'secs'
  | 'second'
  | 'seconds'
  | 'm'
  | 'min'
  | 'mins'
  | 'minute'
  | 'minutes'
  | 'h'
  | 'hr'
  | 'hrs'
  | 'hour'
  | 'hours'
  | 'd'
  | 'day'
  | 'days'
  | 'w'
  | 'wk'
  | 'wks'
  | 'week'
  | 'weeks';

const INTERVAL_RE =
  /^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks)$/i;

function unitToSeconds(unitRaw: string): number {
  const unit = unitRaw.toLowerCase() as Unit;
  if (unit.startsWith('s')) return 1;
  if (unit.startsWith('m')) return 60;
  if (unit.startsWith('h')) return 3600;
  if (unit.startsWith('d')) return 86400;
  return 604800; // w*
}

function parseRawToSeconds(inputRaw: string | undefined): number | null {
  const input = String(inputRaw ?? '').trim();
  if (!input) return null;
  const m = input.match(INTERVAL_RE);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n * unitToSeconds(m[2]));
}

export function parseIntervalToSecondsOrDefault(
  inputRaw: string | undefined,
  opts: { minSec: number; maxSec: number; defaultSec: number },
): number {
  const raw = parseRawToSeconds(inputRaw);
  if (raw === null) return opts.defaultSec;
  return Math.min(Math.max(raw, opts.minSec), opts.maxSec);
}

export function parseIntervalToSecondsOrNull(
  inputRaw: string | undefined,
  opts: { minSec: number; maxSec: number },
): number | null {
  const raw = parseRawToSeconds(inputRaw);
  if (raw === null) return null;
  return Math.min(Math.max(raw, opts.minSec), opts.maxSec);
}

