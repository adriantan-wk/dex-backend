import { buildEpochState, isEpochClosed, rollEpoch } from './epoch';

const DAY = 86_400;

describe('referral rebate epoch math', () => {
  it('builds a 14-day epoch starting at the given timestamp', () => {
    const e = buildEpochState(0, 1_000_000, 14);
    expect(e.epochId).toBe('0:1000000');
    expect(e.lengthDays).toBe(14);
    expect(e.endsAtSec).toBe(1_000_000 + 14 * DAY);
  });

  it('considers the epoch closed once `now` reaches `endsAtSec`', () => {
    const e = buildEpochState(0, 0, 7);
    expect(isEpochClosed(e, e.endsAtSec - 1)).toBe(false);
    expect(isEpochClosed(e, e.endsAtSec)).toBe(true);
    expect(isEpochClosed(e, e.endsAtSec + 1_000_000)).toBe(true);
  });

  it('rollEpoch is a no-op while the current epoch is still open', () => {
    const e = buildEpochState(0, 0, 7);
    const next = rollEpoch(e, 0, 7, e.endsAtSec - 1);
    expect(next.epochId).toBe(e.epochId);
  });

  it('rollEpoch advances by one full period when called inside the next window', () => {
    const e = buildEpochState(0, 0, 7);
    const inSecondPeriod = e.endsAtSec + 1;
    const next = rollEpoch(e, 0, 7, inSecondPeriod);
    expect(next.startedAtSec).toBe(e.endsAtSec);
    expect(next.endsAtSec).toBe(e.endsAtSec + 7 * DAY);
  });

  it('rollEpoch jumps multiple periods when many epochs have elapsed', () => {
    const e = buildEpochState(0, 0, 7);
    const farFuture = e.endsAtSec + 7 * DAY * 5 + 10;
    const next = rollEpoch(e, 0, 7, farFuture);
    expect(next.startedAtSec).toBe(e.endsAtSec + 7 * DAY * 5);
    expect(isEpochClosed(next, farFuture)).toBe(false);
  });

  it('restarts the clock now when the tier (and epoch length) just changed', () => {
    const e = buildEpochState(1, 0, 14);
    const tierBumpAt = e.endsAtSec + 1_000;
    const next = rollEpoch(e, 2, 7, tierBumpAt);
    expect(next.lengthDays).toBe(7);
    expect(next.startedAtSec).toBe(tierBumpAt);
    expect(next.epochId).toBe(`2:${tierBumpAt}`);
  });
});
