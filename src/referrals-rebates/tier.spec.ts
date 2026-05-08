import BigNumber from 'bignumber.js';
import { applyTierPct, getTier } from './tier';

describe('referral rebate tier resolver', () => {
  it('returns the base tier (10% / 5% / 14d) for users with no referrals', () => {
    const t = getTier(0);
    expect(t.tierIndex).toBe(0);
    expect(t.l1Pct.toString()).toBe('10');
    expect(t.l2Pct.toString()).toBe('5');
    expect(t.epochDays).toBe(14);
  });

  it.each([
    [9, 0],
    [10, 1],
    [24, 1],
    [25, 2],
    [49, 2],
    [50, 3],
    [99, 3],
    [100, 4],
    [10_000, 4],
  ])('directReferrals=%i resolves to tierIndex=%i', (count, expectedIdx) => {
    expect(getTier(count).tierIndex).toBe(expectedIdx);
  });

  it('drops the epoch period from 14d to 7d at the 25-referee tier', () => {
    expect(getTier(24).epochDays).toBe(14);
    expect(getTier(25).epochDays).toBe(7);
    expect(getTier(100).epochDays).toBe(7);
  });

  it('applyTierPct treats pct as a percentage value (10 == 10%)', () => {
    const fee = new BigNumber('1000000');
    const share = applyTierPct(fee, new BigNumber('12.5'));
    expect(share.toString()).toBe('125000');
  });

  it('coerces invalid input to 0 to prevent NaN propagation', () => {
    const fee = applyTierPct(
      'not a number' as unknown as string,
      new BigNumber('10'),
    );
    expect(fee.toString()).toBe('0');
  });
});
