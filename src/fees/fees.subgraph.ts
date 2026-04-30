type SubgraphSwapV2 = {
  id: string;
  timestamp: string; // BigInt serialized as string
  amountUSD: string; // BigDecimal serialized as string
};

type SubgraphSwapV3 = {
  id: string;
  timestamp: string; // BigInt serialized as string
  amountUSD: string; // BigDecimal serialized as string
  pool?: { feeTier?: string }; // BigInt serialized as string
};

type GraphQLErrorLike = { message?: string };

export async function fetchSubgraphSwapsForFees(params: {
  url: string;
  source: 'v2' | 'v3';
  first: number;
  lastTimestampSec: number;
  lastSwapId: string;
}): Promise<(SubgraphSwapV2 | SubgraphSwapV3)[]> {
  const { url, source, first, lastTimestampSec, lastSwapId } = params;

  const extraSelection =
    source === 'v3'
      ? `
        pool { feeTier }
      `
      : '';

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
        ${extraSelection}
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
    data?: { swaps?: unknown[] };
    errors?: GraphQLErrorLike[];
  };

  if (json?.errors?.length) {
    const msg = json.errors
      .map((e) => e?.message)
      .filter(Boolean)
      .join('; ');
    throw new Error(msg || 'Subgraph GraphQL error');
  }

  return (json.data?.swaps ?? []).filter(
    (s): s is SubgraphSwapV2 | SubgraphSwapV3 =>
      Boolean(
        s &&
        typeof (s as { id?: unknown }).id === 'string' &&
        typeof (s as { timestamp?: unknown }).timestamp === 'string',
      ),
  );
}
