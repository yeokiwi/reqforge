import { describe, expect, it } from "vitest";
import { formatDateTime, formatRelative } from "../time";

describe("formatDateTime", () => {
  it("is the video's `Jul 25, 2023 13:08`, in UTC, 24-hour", () => {
    expect(formatDateTime("2023-07-25T13:08:00Z")).toBe("Jul 25, 2023 13:08");
    expect(formatDateTime("2023-07-25T01:05:00+10:00")).toBe("Jul 24, 2023 15:05");
  });
  it("shows midnight as 00:00, not 24:00", () => {
    expect(formatDateTime("2026-01-01T00:00:00Z")).toBe("Jan 1, 2026 00:00");
  });
  it("is empty for an invalid date", () => {
    expect(formatDateTime("not a date")).toBe("");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  it("reads like the video's `6 minutes ago`", () => {
    expect(formatRelative(ago(6 * 60_000), now)).toBe("6 minutes ago");
    expect(formatRelative(ago(60_000), now)).toBe("1 minute ago");
    expect(formatRelative(ago(2 * 3600_000), now)).toBe("2 hours ago");
    expect(formatRelative(ago(24 * 3600_000), now)).toBe("yesterday");
    expect(formatRelative(ago(3 * 24 * 3600_000), now)).toBe("3 days ago");
    expect(formatRelative(ago(95 * 24 * 3600_000), now)).toBe("3 months ago");
    expect(formatRelative(ago(800 * 24 * 3600_000), now)).toBe("2 years ago");
  });
  it("says `now` under a second and clamps the future to it", () => {
    expect(formatRelative(ago(0), now)).toBe("now");
    expect(formatRelative(ago(-5 * 60_000), now)).toBe("now");
  });
  it("is empty for an invalid date", () => {
    expect(formatRelative("nope", now)).toBe("");
  });
});
