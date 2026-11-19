const MEDIUM_SHORT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

// ISO 8601 only. `Date.parse` alone is lenient in V8 ("sometime in 2026" parses as
// 1 January), and a guessed date is worse than the value as it came.
const ISO_8601 = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** The default fact date: medium date, short time, in the user's locale; anything not ISO 8601 as it came. */
export function defaultFormatDate(iso: string): string {
  const t = ISO_8601.test(iso) ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? iso : MEDIUM_SHORT.format(new Date(t));
}
