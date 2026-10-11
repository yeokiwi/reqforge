// Dates and relative times for the page screens. Locale data, not copy-deck strings (RD-066:
// dates display as en-US in UTC until users have a locale). UTC and a fixed locale make the
// server render and the client hydrate agree.
// spec: docs/specs/10-ui-reference.md sections 4.1 ("relative time, absolute on hover"), 23 (Page history)

const dateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const relative = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

/** `Jul 25, 2023, 13:08` style, in UTC — the Published column and the hover text. */
export function formatDateTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  // en-US puts a comma between the date and the time (`Jul 25, 2023, 13:08`); the video has none.
  return dateTime.format(date).replace(/, (\d{2}:\d{2})$/, " $1");
}

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** `6 minutes ago`, `yesterday`, `3 months ago`. A time in the future is clamped to `now`. */
export function formatRelative(value: string | Date, now: Date = new Date()): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return relative.format(-Math.floor(seconds / size), unit);
  }
  return relative.format(0, "second");
}
