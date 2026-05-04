/**
 * Epoch math for the referral rebate system.
 *
 * Each user lives on their own per-tier epoch clock. While the epoch is open,
 * accruals are "pending"; once the epoch closes (i.e. now > startedAt + length)
 * the rows become claimable and the next epoch starts.
 */

const SECONDS_PER_DAY = 86_400;

export type EpochState = {
  /** Stable identifier (e.g. `${tierIndex}:${startedAtSec}`). */
  epochId: string;
  startedAtSec: number;
  endsAtSec: number;
  lengthDays: number;
};

export function epochIdFor(tierIndex: number, startedAtSec: number): string {
  return `${tierIndex}:${Math.max(0, Math.floor(startedAtSec))}`;
}

export function buildEpochState(
  tierIndex: number,
  startedAtSec: number,
  lengthDays: number,
): EpochState {
  const safeStart = Math.max(0, Math.floor(startedAtSec));
  const safeLen = Math.max(1, Math.floor(lengthDays));
  return {
    epochId: epochIdFor(tierIndex, safeStart),
    startedAtSec: safeStart,
    endsAtSec: safeStart + safeLen * SECONDS_PER_DAY,
    lengthDays: safeLen,
  };
}

/** Has this epoch's window expired (so accruals inside it can be claimed)? */
export function isEpochClosed(epoch: EpochState, nowSec: number): boolean {
  return Math.floor(nowSec) >= epoch.endsAtSec;
}

/**
 * Roll an epoch forward as many full periods as needed so the result contains
 * `nowSec`. Useful when we lazily roll on-demand instead of via a cron.
 */
export function rollEpoch(
  current: EpochState,
  tierIndex: number,
  newLengthDays: number,
  nowSec: number,
): EpochState {
  if (!isEpochClosed(current, nowSec)) return current;

  // If the tier (and so the epoch length) changed, restart the clock now.
  if (current.lengthDays !== Math.max(1, Math.floor(newLengthDays))) {
    return buildEpochState(tierIndex, Math.floor(nowSec), newLengthDays);
  }

  // Otherwise advance in fixed-length steps, never skipping the user past
  // `now`. We compute how many full periods elapsed and jump that far so we
  // don't rebuild every iteration.
  const stepSec = current.lengthDays * SECONDS_PER_DAY;
  const elapsed = Math.floor(nowSec) - current.endsAtSec;
  const fullPeriods = Math.max(0, Math.floor(elapsed / stepSec)) + 1;
  const newStart = current.endsAtSec + (fullPeriods - 1) * stepSec;
  return buildEpochState(tierIndex, newStart, current.lengthDays);
}
