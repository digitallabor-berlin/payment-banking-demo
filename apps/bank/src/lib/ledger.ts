import { formatDayLabel } from "./format.js";

export interface DayGroup<T> {
  /** Stable React key: the UTC calendar day, e.g. "2025-08-01". */
  key: string;
  /** Human label for the day rail, e.g. "Fr, 01.08.2025". */
  label: string;
  entries: T[];
}

function utcDayKey(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/**
 * Groups booked entries into consecutive runs that share a calendar day.
 *
 * Deliberately *not* a sort: the caller has already ordered the rows (newest
 * first), and re-ordering here would silently discard that. Runs are formed in
 * arrival order, so a non-contiguous repeat of a day would produce a second
 * group — which is the honest rendering of unsorted input rather than a lie
 * that hides it.
 */
export function groupByBookingDay<T extends { bookedAt: number }>(
  rows: readonly T[],
): Array<DayGroup<T>> {
  const groups: Array<DayGroup<T>> = [];

  for (const row of rows) {
    const key = utcDayKey(row.bookedAt);
    const current = groups.at(-1);
    if (current && current.key === key) {
      current.entries.push(row);
    } else {
      groups.push({ key, label: formatDayLabel(row.bookedAt), entries: [row] });
    }
  }

  return groups;
}