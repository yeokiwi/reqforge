// The value rules the schema layer adds beyond structure. Pure predicates, no DOM: the
// validator, the TipTap parse rules (pasted HTML) and the renderer all call these, so a
// value the editor accepts, the server stores and the page renders is judged once.
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (RD-058, RD-063)

/** At most 5 MiB serialised (RD-063). */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
/** Nesting depth of ProseMirror nodes; `doc` is depth 1 (RD-063). */
export const MAX_NODE_DEPTH = 64;
/**
 * Backstop on raw JSON nesting (objects and arrays). A node at depth 64 sits at JSON depth
 * 127; its marks, a mark's attrs and a cell's `colwidth` array reach 130.
 */
export const MAX_JSON_DEPTH = MAX_NODE_DEPTH * 2 + 4;

export const TEXT_ALIGNMENTS = ["left", "center", "right", "justify"] as const;
export type TextAlignment = (typeof TEXT_ALIGNMENTS)[number];

export const INDENT_MAX = 6;
export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

export const PANEL_VARIANTS = ["info", "note", "success", "warning", "error"] as const;
export type PanelVariant = (typeof PANEL_VARIANTS)[number];

export const STATUS_COLOURS = ["grey", "red", "yellow", "green", "blue", "purple"] as const;
export type StatusColour = (typeof STATUS_COLOURS)[number];
export const STATUS_TEXT_MAX = 60;

export const TABLE_WIDTH_MODES = ["responsive", "fixed"] as const;
export type TableWidthMode = (typeof TABLE_WIDTH_MODES)[number];

/** HTML's own ceilings for spans; anything larger is clamped by browsers anyway. */
export const MAX_COLSPAN = 1000;
export const MAX_ROWSPAN = 65534;
export const MAX_COLUMN_WIDTH = 10000;
export const MAX_IMAGE_WIDTH = 10000;
export const MAX_CODE_LANGUAGE_LENGTH = 64;
export const MAX_MENTION_LABEL_LENGTH = 255;

export const ATTACHMENT_PATH_PREFIX = "/api/v1/attachments/";

export function isOneOf<T extends string | number>(values: readonly T[], value: unknown): value is T {
  return (values as readonly unknown[]).includes(value);
}

export function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

// ---------------------------------------------------------------------------------- links

/**
 * A character class built from code-point ranges. Written this way so that no invisible or
 * line-terminating character ever appears literally in the source.
 */
function charClass(ranges: ReadonlyArray<readonly [number, number]>): RegExp {
  const body = ranges
    .map(([from, to]) => (from === to ? String.fromCodePoint(from) : `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`))
    .join("");
  return new RegExp(`[${body}]`, "u");
}

/** C0 and C1 controls, DEL, and every whitespace character. */
const CONTROL_OR_SPACE = charClass([[0x00, 0x20], [0x7f, 0xa0], [0x1680, 0x1680], [0x2000, 0x200a], [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000]]);
/** Invisible and bidirectional formatting characters used to disguise a URL. */
const INVISIBLE = charClass([[0xad, 0xad], [0x61c, 0x61c], [0x115f, 0x1160], [0x180e, 0x180e], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x206f], [0xfeff, 0xfeff]]);
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

export type HrefKind = "internal" | "external" | "mailto" | "tel";

/**
 * Classifies a link target, or returns null when it is refused. Allowed: `http`, `https`,
 * `mailto`, `tel`, or a same-site path starting with a single `/`. Refused, among others:
 * `javascript:`, `data:`, `vbscript:`, protocol-relative `//host`, any backslash (browsers
 * read `/\host` as `//host`), and any control, whitespace or invisible character (the URL
 * parser strips tabs and newlines, so `java\tscript:` would otherwise become `javascript:`).
 */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (RD-063)
export function classifyHref(href: unknown): HrefKind | null {
  if (typeof href !== "string" || href.length === 0) return null;
  if (CONTROL_OR_SPACE.test(href) || INVISIBLE.test(href) || href.includes("\\")) return null;

  if (href.startsWith("/")) {
    return href.startsWith("//") ? null : "internal";
  }

  const scheme = SCHEME.exec(href)?.[1]?.toLowerCase();
  if (scheme === "http" || scheme === "https") {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.length > 0 ? "external" : null;
  }
  if (scheme === "mailto" || scheme === "tel") {
    return href.length > scheme.length + 1 ? scheme : null;
  }
  return null;
}

// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (RD-063)
export function isAllowedHref(href: unknown): href is string {
  return classifyHref(href) !== null;
}

// -------------------------------------------------------------------------------- colours

const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/;

/** `#rrggbb`, either case. */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4
export function isHexColour(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOUR.test(value);
}

/** `#rrggbb` or null — the shape of `textStyle.color` and a cell's `background`. */
export function isOptionalHexColour(value: unknown): value is string | null {
  return value === null || isHexColour(value);
}

/**
 * Normalises a CSS colour as pasted HTML or a browser's computed style presents it
 * (`#abc`, `#AABBCC`, `rgb(1, 2, 3)`, `rgba(1, 2, 3, 1)`) to lower-case `#rrggbb`. Anything
 * else — named colours, transparency, `var(…)` — yields null, so a paste never produces a
 * value the server would refuse.
 */
export function normaliseColour(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (!rgb) return null;
  if (rgb[4] !== undefined && Number(rgb[4]) !== 1) return null;
  const parts = [rgb[1], rgb[2], rgb[3]].map(Number);
  if (parts.some((n) => n > 255)) return null;
  return `#${parts.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

// ---------------------------------------------------------------------------------- dates

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * `YYYY-MM-DD` naming a real Gregorian date: `2026-02-29` and `2026-13-01` are refused, and
 * so is year `0000`, which the Gregorian calendar does not have.
 */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const max = month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  return day <= max;
}

// --------------------------------------------------------------------------------- status

/** Counts characters as code points, so an emoji is one character, not two. */
export function characterCount(text: string): number {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}

// Status text is one line: no control characters.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Non-empty (after trimming), at most 60 characters, single line. */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4
export function isStatusText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    characterCount(value) <= STATUS_TEXT_MAX &&
    !CONTROL.test(value)
  );
}

// ---------------------------------------------------------------------------- attachments

/** Attachment and user ids are database ids (cuid): one URL-safe path segment. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isEntityId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

// One path segment: no slash, backslash, query, fragment, whitespace or control character.
const FILENAME_SEGMENT = /^[^/\\?#\s\u0000-\u001f\u007f]+$/;

/**
 * One path segment that the browser keeps as written. Percent-encoding must be well formed,
 * and the segment must not be a dot segment once decoded: the WHATWG URL parser reads `%2e`
 * as `.`, so `%2e%2e` and `.%2E` would climb out of `/api/v1/attachments/{id}/` just as `..`
 * does.
 */
function isFilenameSegment(segment: string): boolean {
  if (!FILENAME_SEGMENT.test(segment)) return false;
  let decoded = segment;
  if (segment.includes("%")) {
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return false;
    }
  }
  return decoded !== "." && decoded !== "..";
}

/**
 * Splits `/api/v1/attachments/{id}/{filename}` into its parts, or null when `src` is not
 * exactly that shape. External image URLs are refused in v1 (RD-058).
 */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (RD-058)
export function parseAttachmentSrc(src: unknown): { attachmentId: string; filename: string } | null {
  if (typeof src !== "string" || !src.startsWith(ATTACHMENT_PATH_PREFIX)) return null;
  const rest = src.slice(ATTACHMENT_PATH_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  const attachmentId = rest.slice(0, slash);
  const filename = rest.slice(slash + 1);
  if (!isEntityId(attachmentId) || !isFilenameSegment(filename)) return null;
  return { attachmentId, filename };
}

/** An image `src` that is exactly an attachment URL for `attachmentId`. */
// spec: docs/specs/03-authoring-and-indexing.md section 1.4 (RD-058)
export function isAttachmentSrcFor(src: unknown, attachmentId: unknown): src is string {
  const parsed = parseAttachmentSrc(src);
  return parsed !== null && parsed.attachmentId === attachmentId;
}

// ------------------------------------------------------------------------------ code blocks

const LANGUAGE = /^[^\s\u0000-\u001f\u007f]+$/;

/** A code block's language: null, or one class-name-like token of at most 64 characters. */
export function isCodeLanguage(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= MAX_CODE_LANGUAGE_LENGTH && LANGUAGE.test(value));
}
