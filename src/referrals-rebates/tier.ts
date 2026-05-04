import BigNumber from 'bignumber.js';

/**
 * Tier rebate percentages and epoch length.
 *
 * Percentages are stored as BigNumber to honour the workspace bignumber rule.
 * Apply them as fractions (`pct.div(100)`) when multiplying token amounts.
 */
export type Tier = {
  /** Index in the {@link TIER_TABLE} array. */
  tierIndex: number;
  /** Lower bound (inclusive) of `directReferralsCount` for this tier. */
  minDirectReferrals: number;
  /** Percentage of fee paid by a direct referee that goes to this referrer. */
  l1Pct: BigNumber;
  /** Percentage of fee paid by an indirect (level-2) referee. */
  l2Pct: BigNumber;
  /** Length of an epoch in days (claims unlock when an epoch closes). */
  epochDays: number;
};

/**
 * Tier table from the product spec.
 *
 * Note: the L2 jump at the 50-referee tier is documented as `8% -> 9%` in the
 * source chart, but the previous tier ends at `7%`. The plan resolves this by
 * treating the after-arrow value (9%) as source-of-truth. Flagged for product
 * confirmation.
 */
export const TIER_TABLE: ReadonlyArray<Tier> = [
  {
    tierIndex: 0,
    minDirectReferrals: 0,
    l1Pct: new BigNumber('10'),
    l2Pct: new BigNumber('5'),
    epochDays: 14,
  },
  {
    tierIndex: 1,
    minDirectReferrals: 10,
    l1Pct: new BigNumber('12.5'),
    l2Pct: new BigNumber('6'),
    epochDays: 14,
  },
  {
    tierIndex: 2,
    minDirectReferrals: 25,
    l1Pct: new BigNumber('15'),
    l2Pct: new BigNumber('7'),
    epochDays: 7,
  },
  {
    tierIndex: 3,
    minDirectReferrals: 50,
    l1Pct: new BigNumber('20'),
    l2Pct: new BigNumber('9'),
    epochDays: 7,
  },
  {
    tierIndex: 4,
    minDirectReferrals: 100,
    l1Pct: new BigNumber('30'),
    l2Pct: new BigNumber('10'),
    epochDays: 7,
  },
];

/** Resolve the tier for a given direct-referral count. */
export function getTier(directCountInput: number | string): Tier {
  const n = Math.max(0, Math.floor(Number(directCountInput) || 0));
  let resolved: Tier = TIER_TABLE[0];
  for (const t of TIER_TABLE) {
    if (n >= t.minDirectReferrals) resolved = t;
  }
  return resolved;
}

/**
 * Apply a tier percentage (e.g. `10` for 10%) to a token amount, returning the
 * recipient's share in the same unit (raw or human, whichever was passed in).
 */
export function applyTierPct(
  amount: BigNumber.Value,
  pct: BigNumber,
): BigNumber {
  let a: BigNumber;
  try {
    a = new BigNumber(amount);
  } catch {
    return new BigNumber(0);
  }
  if (!a.isFinite() || a.isNaN()) return new BigNumber(0);
  return a.times(pct).div(100);
}
