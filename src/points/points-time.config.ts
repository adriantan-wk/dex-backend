/**
 * Single source of truth for points **season** boundaries and **streak / multiplier** steps.
 *
 * - **Season**: not a fixed number of seconds — one season per **UTC calendar month**.
 *   Rollover uses `activeSeasonMonthKey` as `YYYY-MM`; public `seasonId` stays numeric.
 * - **Streak / multiplier bucket**: fixed length `POINTS_STREAK_STEP_SECONDS` (UTC contiguous buckets).
 */

/** Length of one streak step for swap multiplier state (`dayIndex` buckets). */
export const POINTS_STREAK_STEP_SECONDS = 86_400 as const;

/**
 * Season model: advance when the UTC calendar month changes.
 * See `utcSeasonMonthKeyFromDate` / `utcMonthIndexFromSeasonKey`.
 */
export const POINTS_SEASON_BOUNDARY = 'utc_calendar_month' as const;

export function utcDayIndexFromUnixSeconds(unixSeconds: number): number {
  return Math.floor(unixSeconds / POINTS_STREAK_STEP_SECONDS);
}

/** UTC calendar month key for rollover only (`YYYY-MM`). */
export function utcSeasonMonthKeyFromDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Parse `YYYY-MM` to a comparable month index; `null` if not a calendar month key. */
export function utcMonthIndexFromSeasonKey(monthKey: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) {
    return null;
  }
  return y * 12 + (mo - 1);
}
