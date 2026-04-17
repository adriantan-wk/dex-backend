export function asAddress(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  // Don’t over-validate; accept checksummed or lowercase hex strings.
  return s;
}

export function asBigintString(v: unknown): string | null {
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v).toString();
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) return s;
  }
  return null;
}

export function asSignedBigintString(v: unknown): string | null {
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v).toString();
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    if (/^[+-]?\d+$/.test(s)) return s;
  }
  return null;
}

export function parseSignedBigint(v: string | null): bigint | null {
  if (!v) return null;
  try {
    return BigInt(v);
  } catch {
    return null;
  }
}
