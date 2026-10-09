import { describe, expect, it } from "vitest";
import { formatDateValue } from "../format";
import {
  characterCount,
  classifyHref,
  isCalendarDate,
  isCodeLanguage,
  isStatusText,
  normaliseColour,
  parseAttachmentSrc,
} from "../rules";

describe("classifyHref", () => {
  it.each([
    ["https://example.com", "external"],
    ["http://example.com:8080/a", "external"],
    ["/spaces/TEAM/pages/1?version=2#h", "internal"],
    ["mailto:a@example.com", "mailto"],
    ["MAILTO:a@example.com", "mailto"],
    ["tel:+15551234", "tel"],
  ])("%s is %s", (href, kind) => {
    expect(classifyHref(href)).toBe(kind);
  });

  it.each([
    ["javascript:alert(1)"],
    ["  https://example.com"],
    ["https://example.com\u0000"],
    ["https://example.com\u0085"],
    ["//example.com"],
    ["/\\example.com"],
    ["data:,x"],
    ["blob:https://example.com/uuid"],
    ["about:blank"],
  ])("%j is refused", (href) => {
    expect(classifyHref(href)).toBeNull();
  });

  // DEL, every C1 control and NBSP, each in a path where the URL parser would not reject it
  // by itself (it percent-encodes them), and in an internal path, which is never URL-parsed.
  it.each([0x7f, 0x80, 0x85, 0x8d, 0x9f, 0xa0])("refuses U+%s anywhere in the target", (code) => {
    const c = String.fromCharCode(code);
    expect(classifyHref(`https://example.com/a${c}b`)).toBeNull();
    expect(classifyHref(`/spaces/TEAM${c}`)).toBeNull();
    expect(classifyHref(`mailto:a${c}@example.com`)).toBeNull();
  });

  it("still accepts the printable characters either side of that range", () => {
    expect(classifyHref("https://example.com/a~b")).toBe("external");
    expect(classifyHref("/spaces/TEAM/¡")).toBe("internal");
  });
});

describe("normaliseColour", () => {
  it.each([
    ["#ABCDEF", "#abcdef"],
    ["#abc", "#aabbcc"],
    ["rgb(161, 25, 17)", "#a11911"],
    ["rgba(0,0,0,1)", "#000000"],
    [" rgb(255,255,255) ", "#ffffff"],
  ])("%s → %s", (input, expected) => {
    expect(normaliseColour(input)).toBe(expected);
  });

  it.each([["red"], ["rgba(0,0,0,0.5)"], ["rgb(256,0,0)"], ["var(--x)"], ["#abcd"], [""], [null], [12]])("%j → null", (input) => {
    expect(normaliseColour(input)).toBeNull();
  });
});

describe("isCalendarDate", () => {
  it("knows leap years", () => {
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2023-02-29")).toBe(false);
    expect(isCalendarDate("2100-02-29")).toBe(false);
    expect(isCalendarDate("2400-02-29")).toBe(true);
  });

  it("checks every month's length", () => {
    const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    lengths.forEach((days, i) => {
      const month = String(i + 1).padStart(2, "0");
      expect(isCalendarDate(`2026-${month}-${days}`)).toBe(true);
      expect(isCalendarDate(`2026-${month}-${days + 1}`)).toBe(false);
    });
  });
});

describe("formatDateValue", () => {
  it("formats in UTC with a fixed locale", () => {
    expect(formatDateValue("2026-10-09")).toBe("Oct 9, 2026");
    expect(formatDateValue("2024-02-29")).toBe("Feb 29, 2024");
    expect(formatDateValue("0099-01-01")).toBe("Jan 1, 99");
  });

  it("returns null for anything that is not a real date", () => {
    expect(formatDateValue("2026-02-30")).toBeNull();
    expect(formatDateValue(null)).toBeNull();
  });
});

describe("status text", () => {
  it("counts code points", () => {
    expect(characterCount("🙂🙂")).toBe(2);
    expect(isStatusText("🙂".repeat(60))).toBe(true);
    expect(isStatusText("🙂".repeat(61))).toBe(false);
  });
});

describe("parseAttachmentSrc", () => {
  it("splits a valid attachment URL", () => {
    expect(parseAttachmentSrc("/api/v1/attachments/clx1/report%20v2.png")).toEqual({ attachmentId: "clx1", filename: "report%20v2.png" });
  });

  it.each([["/api/v1/attachments/clx1"], ["/api/v1/attachments//x.png"], ["/api/v2/attachments/clx1/x.png"], ["https://host/api/v1/attachments/clx1/x.png"]])(
    "refuses %s",
    (src) => {
      expect(parseAttachmentSrc(src)).toBeNull();
    },
  );

  // The WHATWG URL parser reads `%2e` (either case) as `.`, so these are dot segments.
  it.each([["."], [".."], ["%2e"], ["%2E"], ["%2e%2e"], ["%2E%2E"], [".%2e"], ["%2E."], [".%2E"]])("refuses the dot segment %s as a filename", (name) => {
    const src = `/api/v1/attachments/clx1/${name}`;
    expect(parseAttachmentSrc(src)).toBeNull();
    // Sanity check of the premise: the browser would not keep this segment.
    expect(new URL(src, "https://reqforge.example").pathname).not.toBe(src);
  });

  it.each([["..png"], ["%2e%2e.png"], [".hidden"], ["a%2Eb.png"]])("accepts %s, which is not a dot segment", (name) => {
    const src = `/api/v1/attachments/clx1/${name}`;
    expect(parseAttachmentSrc(src)).toEqual({ attachmentId: "clx1", filename: name });
    expect(new URL(src, "https://reqforge.example").pathname).toBe(src);
  });
});

describe("isCodeLanguage", () => {
  it("accepts null and class-name-like tokens", () => {
    expect(isCodeLanguage(null)).toBe(true);
    expect(isCodeLanguage("c++")).toBe(true);
    expect(isCodeLanguage("x".repeat(65))).toBe(false);
    expect(isCodeLanguage("")).toBe(false);
  });
});
