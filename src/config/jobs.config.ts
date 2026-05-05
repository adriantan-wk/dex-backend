import { CronExpression } from '@nestjs/schedule';

/**
 * Cron job schedules and intervals.
 */
export const jobsConfig = {
  cron: {
    feesSnapshotPoll: CronExpression.EVERY_5_MINUTES,
    pointsSync: CronExpression.EVERY_HOUR,
    referralRebatesSync: CronExpression.EVERY_HOUR,
  },

  /**
   * Interval used to bucket fee snapshots. The cron *polls* frequently, but only
   * writes a snapshot when the bucket changes.
   *
   * Supports: "1h", "6h", "1d", "2w", "30m", "900s" (Min. 5m, Max. 8w)
   * Is Minimum 5 minutes because it's the minimum interval for the cron job.
   */
  feesSnapshotInterval: '5m',

  /**
   * If null: seasons are 1 UTC calendar month by default (needs to be set as 'null as null | string').
   * If set: seasons roll over every fixed interval.
   *
   * Supports: "1d", "1w", "2w", "30d" (Min. 1d, Max. 52w)
   */
  pointsSeasonInterval: null as null | string,
} as const;

