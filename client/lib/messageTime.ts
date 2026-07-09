/**
 * Parse a message timestamp to epoch milliseconds.
 *
 * Live/optimistic messages carry an ISO-UTC `timestamp` (`new Date().toISOString()`),
 * but history rows carry SQLite `datetime('now')` in `created_at` — "YYYY-MM-DD HH:MM:SS",
 * which is UTC but has no 'T'/'Z' designator. `new Date()` parses that naive form as
 * LOCAL time, so comparing the two directly skews by the client's UTC offset (it
 * duplicated messages on reconnect in UTC+ zones and dropped in-flight messages in
 * UTC− zones). Normalize the naive form to explicit UTC before parsing so both
 * representations of the same instant compare equal in any timezone.
 */
export function messageEpoch(raw: string | undefined | null): number {
  if (!raw) return 0;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replace(" ", "T") + "Z" : raw;
  return new Date(iso).getTime();
}
