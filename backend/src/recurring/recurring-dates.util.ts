// Date helpers for recurring schedules, shared with the upcoming
// materialization scheduler (VEG-467) and reminder cron (VEG-468).

/** The UTC calendar day of an instant, comparable with < / ===. */
export function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// JS parses an offsetless ISO datetime — 'T' or space separated, both of
// which pass @IsDateString — in the SERVER's local timezone, while date-only
// strings parse as UTC. Pin the frame to UTC so validation and the persisted
// instant don't depend on where the server runs.
const OFFSETLESS_DATETIME =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** Parse an ISO 8601 string with offsetless datetimes pinned to UTC. */
export function parseUtcDate(value: string): Date {
  if (OFFSETLESS_DATETIME.test(value)) {
    return new Date(`${value.replace(' ', 'T')}Z`);
  }
  return new Date(value);
}
