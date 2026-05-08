/**
 * Subgraph fetcher for the referral rebate cron.
 *
 * Unlike `fees.subgraph.ts`, this returns the **payer address**, the **input
 * token** (address/symbol/decimals) and the swap's **input amount** in human
 * units (BigDecimal) so the cron can compute per-token fees.
 */

export type RebateSwap = {
  source: 'v2' | 'v3';
  id: string;
  timestamp: number;
  /** Lower-cased EOA that initiated the swap (the "payer"). */
  payerAddress: string;
  /** Lower-cased ERC20 address of the input token for this swap. */
  inputTokenAddress: string;
  inputTokenSymbol: string;
  inputTokenDecimals: number;
  /** Input token amount in human-readable units (i.e. already divided by 10^decimals). */
  inputAmountHuman: string;
  /** USD value of the swap (BigDecimal string from the subgraph). */
  amountUsd: string;
  /** V3 only: pool fee tier in hundredths of a bp (e.g. `3000` for 0.30%). */
  feeTier?: string;
};

type GraphQLErrorLike = { message?: string };

type V2Token = { id: string; symbol: string; decimals: string };
type V2Swap = {
  id: string;
  timestamp: string;
  amountUSD: string;
  amount0In: string;
  amount1In: string;
  pair: { token0: V2Token; token1: V2Token };
  transaction: { id: string };
  from?: string;
  sender?: string;
};

type V3Token = { id: string; symbol: string; decimals: string };
type V3Swap = {
  id: string;
  timestamp: string;
  amountUSD: string;
  amount0: string;
  amount1: string;
  origin?: string;
  sender?: string;
  pool: { feeTier: string };
  token0: V3Token;
  token1: V3Token;
  transaction: { id: string };
};

function toLower(v: string | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

function isHexAddress(v: string | undefined): v is string {
  return typeof v === 'string' && /^0x[a-fA-F0-9]{40}$/.test(v);
}

function decimalsToInt(v: string | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

const QUERY_V2 = `
  query Swaps($first: Int!, $ts: BigInt!, $id: ID!) {
    swaps(
      first: $first
      orderBy: timestamp
      orderDirection: asc
      where: { or: [{ timestamp_gt: $ts }, { timestamp: $ts, id_gt: $id }] }
    ) {
      id
      timestamp
      amountUSD
      amount0In
      amount1In
      from
      sender
      pair {
        token0 { id symbol decimals }
        token1 { id symbol decimals }
      }
      transaction { id }
    }
  }
`;

const QUERY_V3 = `
  query Swaps($first: Int!, $ts: BigInt!, $id: ID!) {
    swaps(
      first: $first
      orderBy: timestamp
      orderDirection: asc
      where: { or: [{ timestamp_gt: $ts }, { timestamp: $ts, id_gt: $id }] }
    ) {
      id
      timestamp
      amountUSD
      amount0
      amount1
      origin
      sender
      pool { feeTier }
      token0 { id symbol decimals }
      token1 { id symbol decimals }
      transaction { id }
    }
  }
`;

async function postSubgraph<T>(
  url: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T[]> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) throw new Error(`Subgraph HTTP ${res.status}`);

  const json = (await res.json()) as {
    data?: { swaps?: T[] };
    errors?: GraphQLErrorLike[];
  };

  if (json?.errors?.length) {
    const msg = json.errors
      .map((e) => e?.message)
      .filter(Boolean)
      .join('; ');
    throw new Error(msg || 'Subgraph GraphQL error');
  }

  return json.data?.swaps ?? [];
}

export async function fetchRebateSwaps(params: {
  url: string;
  source: 'v2' | 'v3';
  first: number;
  lastTimestampSec: number;
  lastSwapId: string;
}): Promise<RebateSwap[]> {
  const { url, source, first, lastTimestampSec, lastSwapId } = params;
  const variables = {
    first,
    ts: String(Math.max(0, Math.floor(lastTimestampSec))),
    id: lastSwapId || '',
  };

  if (source === 'v2') {
    const rows = await postSubgraph<V2Swap>(url, QUERY_V2, variables);
    return rows.map((r) => mapV2(r)).filter((r): r is RebateSwap => r !== null);
  }

  const rows = await postSubgraph<V3Swap>(url, QUERY_V3, variables);
  return rows.map((r) => mapV3(r)).filter((r): r is RebateSwap => r !== null);
}

function mapV2(r: V2Swap): RebateSwap | null {
  if (!r || typeof r.id !== 'string') return null;
  const ts = Number(r.timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return null;

  // Prefer the `from` field (EOA that initiated the txn). Fall back to sender.
  const payer = isHexAddress(r.from)
    ? toLower(r.from)
    : isHexAddress(r.sender)
      ? toLower(r.sender)
      : '';
  if (!payer) return null;

  const a0 = Number(r.amount0In ?? 0);
  const a1 = Number(r.amount1In ?? 0);
  const useToken0 = a0 > 0 && a0 >= a1;
  const tok = useToken0 ? r.pair?.token0 : r.pair?.token1;
  if (!tok || !isHexAddress(tok.id)) return null;

  // Use the original BigDecimal string (don't go through Number) to preserve
  // precision for low-decimals tokens.
  const inputAmountHuman = useToken0
    ? String(r.amount0In ?? '0')
    : String(r.amount1In ?? '0');

  if (Number(inputAmountHuman) <= 0) return null;

  return {
    source: 'v2',
    id: r.id,
    timestamp: Math.floor(ts),
    payerAddress: payer,
    inputTokenAddress: toLower(tok.id),
    inputTokenSymbol: tok.symbol ?? '',
    inputTokenDecimals: decimalsToInt(tok.decimals),
    inputAmountHuman,
    amountUsd: String(r.amountUSD ?? '0'),
  };
}

function mapV3(r: V3Swap): RebateSwap | null {
  if (!r || typeof r.id !== 'string') return null;
  const ts = Number(r.timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return null;

  const payer = isHexAddress(r.origin)
    ? toLower(r.origin)
    : isHexAddress(r.sender)
      ? toLower(r.sender)
      : '';
  if (!payer) return null;

  // V3 deltas are signed. Positive = swapped INTO the pool (input token).
  const a0 = Number(r.amount0 ?? 0);
  const useToken0 = a0 > 0;
  const tok = useToken0 ? r.token0 : r.token1;
  if (!tok || !isHexAddress(tok.id)) return null;

  // Trim leading sign before comparing/storing as the input amount.
  const rawAmount = useToken0
    ? String(r.amount0 ?? '0')
    : String(r.amount1 ?? '0');
  const inputAmountHuman = rawAmount.startsWith('-')
    ? rawAmount.slice(1)
    : rawAmount;

  if (Number(inputAmountHuman) <= 0) return null;

  return {
    source: 'v3',
    id: r.id,
    timestamp: Math.floor(ts),
    payerAddress: payer,
    inputTokenAddress: toLower(tok.id),
    inputTokenSymbol: tok.symbol ?? '',
    inputTokenDecimals: decimalsToInt(tok.decimals),
    inputAmountHuman,
    amountUsd: String(r.amountUSD ?? '0'),
    feeTier: String(r.pool?.feeTier ?? ''),
  };
}
