type SubgraphSwap = {
  id: string;
  timestamp: string; // BigInt serialized as string
  amountUSD: string; // BigDecimal serialized as string
  origin?: string; // Bytes
  from?: string; // Bytes (v2 schema)
  sender?: string; // Bytes
  txHash?: string; // Bytes (bsc schema)
  logIndex?: string; // BigInt (bsc schema)
};

type GraphQLErrorLike = { message?: string };

export async function fetchSubgraphSwaps(params: {
  url: string;
  source: 'v2' | 'v3';
  first: number;
  lastTimestampSec: number;
  lastSwapId: string;
}): Promise<SubgraphSwap[]> {
  const { url, source, first, lastTimestampSec, lastSwapId } = params;

  const addressSelection =
    source === 'v2'
      ? `
        from
        sender
      `
      : `
        origin
        sender
      `;

  // Cursor pattern: orderBy timestamp asc, id asc.
  const query = `
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
        ${addressSelection}
      }
    }
  `;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: {
        first,
        ts: String(Math.max(0, Math.floor(lastTimestampSec))),
        id: lastSwapId || '',
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Subgraph HTTP ${res.status}`);
  }

  const json = (await res.json()) as unknown as {
    data?: { swaps?: SubgraphSwap[] };
    errors?: GraphQLErrorLike[];
  };

  if (json?.errors?.length) {
    const msg = json.errors
      .map((e) => e?.message)
      .filter(Boolean)
      .join('; ');
    throw new Error(msg || 'Subgraph GraphQL error');
  }

  return (json.data?.swaps ?? []).filter((s): s is SubgraphSwap =>
    Boolean(s && typeof s.id === 'string' && typeof s.timestamp === 'string'),
  );
}
