export function bucketStartFromUnixSeconds(
  tsSec: number,
  intervalSec: number,
): number {
  const t = Math.max(0, Math.floor(tsSec));
  const i = Math.max(1, Math.floor(intervalSec));
  return Math.floor(t / i) * i;
}

export function isoUtcNoMillisFromUnixSeconds(tsSec: number): string {
  return new Date(Math.max(0, Math.floor(tsSec)) * 1000)
    .toISOString()
    .replace('.000Z', 'Z');
}

