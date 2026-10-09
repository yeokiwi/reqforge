// Display formats shared by the editor's DOM (renderHTML) and the page renderer, so a value
// looks the same while editing and while reading.
import { isCalendarDate } from "./rules";

// A fixed locale and UTC: the output depends neither on the server's locale nor on the
// reader's time zone, so server-rendered and client-rendered pages agree.
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});

/**
 * Formats a `date` node's `YYYY-MM-DD` value as e.g. `Oct 9, 2026`. Returns null when the
 * value is not a real calendar date.
 */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (date node)
export function formatDateValue(value: unknown): string | null {
  if (!isCalendarDate(value)) return null;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  date.setUTCHours(0, 0, 0, 0);
  return DATE_FORMAT.format(date);
}
