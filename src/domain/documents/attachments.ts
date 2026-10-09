// Files and images (RD-058). Images are PNG, JPEG, GIF and WebP only and are recognised by
// their bytes, never by what the browser declared or what the file is called. SVG is
// refused outright (it can carry script). Everything else is a plain file, served as an
// application/octet-stream download.

import { LIMITS } from "./limits";
import { codePointLength, toWellFormed, truncateCodePoints } from "./text";

export type ImageContentType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
export type AttachmentRejection = "EMPTY" | "TOO_LARGE" | "SVG";

export type AttachmentClass =
  | { kind: "image"; contentType: ImageContentType }
  | { kind: "file"; contentType: "application/octet-stream" }
  | { kind: "rejected"; reason: AttachmentRejection };

export interface AttachmentUpload {
  filename: string;
  /** What the client said. Used only to refuse SVG; never to accept an image. */
  declaredContentType?: string | null;
  bytes: Uint8Array;
}

/** How many leading bytes the SVG sniffer reads (RD-058 brief: the first KiB). */
export const SVG_SNIFF_BYTES = 1024;

/**
 * Decides what an upload is. Checks run in the order EMPTY, TOO_LARGE, SVG (declared type,
 * filename, then the bytes), then the image signatures. The declared type can only make a
 * file *rejected*, never make it an image.
 */
// spec: docs/specs/09-decision-log.md section RD-058 (images PNG/JPEG/GIF/WebP; SVG refused; other files download only)
export function classifyAttachment(upload: AttachmentUpload): AttachmentClass {
  const { bytes } = upload;
  if (bytes.byteLength === 0) return { kind: "rejected", reason: "EMPTY" };
  if (bytes.byteLength > LIMITS.attachmentMaxBytes) return { kind: "rejected", reason: "TOO_LARGE" };
  if (declaresSvg(upload.declaredContentType) || namedSvg(upload.filename) || sniffsAsSvg(bytes)) {
    return { kind: "rejected", reason: "SVG" };
  }
  const image = sniffImageType(bytes);
  return image ? { kind: "image", contentType: image } : { kind: "file", contentType: "application/octet-stream" };
}

const startsWith = (bytes: Uint8Array, sig: readonly number[], offset = 0) =>
  bytes.byteLength >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87A = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

/** The image type proven by the file's signature, or null. */
// spec: docs/specs/09-decision-log.md section RD-058 (PNG, JPEG, GIF and WebP only)
export function sniffImageType(bytes: Uint8Array): ImageContentType | null {
  if (startsWith(bytes, PNG)) return "image/png";
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  if (startsWith(bytes, GIF87A) || startsWith(bytes, GIF89A)) return "image/gif";
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return "image/webp";
  return null;
}

function declaresSvg(declared: string | null | undefined): boolean {
  if (!declared) return false;
  const essence = (declared.split(";")[0] ?? "").trim().toLowerCase();
  return essence.includes("svg");
}

function namedSvg(filename: string): boolean {
  const looks = (name: string) => /\.svgz?$/i.test(name.replace(/[\s.]+$/u, ""));
  return looks(filename) || looks(sanitizeFilename(filename));
}

function decodeHead(bytes: Uint8Array): string {
  const head = bytes.subarray(0, SVG_SNIFF_BYTES);
  const utf16 = (bigEndian: boolean) => {
    let s = "";
    for (let i = 2; i + 1 < head.length; i += 2) {
      const hi = head[bigEndian ? i : i + 1] as number;
      const lo = head[bigEndian ? i + 1 : i] as number;
      s += String.fromCharCode((hi << 8) | lo);
    }
    return s;
  };
  if (head[0] === 0xff && head[1] === 0xfe) return utf16(false);
  if (head[0] === 0xfe && head[1] === 0xff) return utf16(true);
  // TextDecoder drops a UTF-8 BOM and turns invalid bytes into U+FFFD; it never throws.
  return new TextDecoder("utf-8").decode(head);
}

/**
 * True when the first KiB is an SVG document: after an optional byte-order mark,
 * whitespace, XML declaration, processing instructions, comments and a doctype, the root
 * element is `svg` (any case, any namespace prefix), or the doctype names `svg`. A root
 * cut off at the end of the window still counts. Text the window cannot settle is not SVG
 * — it is then a plain file, which is never served inline.
 */
// spec: docs/specs/09-decision-log.md section RD-058 (SVG is refused)
export function sniffsAsSvg(bytes: Uint8Array): boolean {
  const s = decodeHead(bytes);
  let pos = 0;
  const isSpace = (c: string | undefined) => c !== undefined && /[\s\uFEFF]/u.test(c);
  for (;;) {
    while (isSpace(s[pos])) pos++;
    if (s.startsWith("<?", pos)) {
      const end = s.indexOf("?>", pos + 2);
      if (end < 0) return false;
      pos = end + 2;
    } else if (s.startsWith("<!--", pos)) {
      const end = s.indexOf("-->", pos + 4);
      if (end < 0) return false;
      pos = end + 3;
    } else if (s.slice(pos, pos + 9).toLowerCase() === "<!doctype") {
      const name = /^\s+([^\s[>]+)/u.exec(s.slice(pos + 9));
      if (name && /(^|:)svg$/i.test(name[1] as string)) return true;
      const end = endOfDoctype(s, pos + 9);
      if (end < 0) return false;
      pos = end + 1;
    } else {
      break;
    }
  }
  return /^<([A-Za-z_][\w.-]*:)?svg(?=[\s/>]|$)/iu.test(s.slice(pos));
}

/** Index of the `>` closing a doctype, skipping quoted strings and an internal subset. */
function endOfDoctype(s: string, from: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "[") depth++;
    else if (c === "]") depth = Math.max(0, depth - 1);
    else if (c === ">" && depth === 0) return i;
  }
  return -1;
}

// C0/C1 controls, line/paragraph separators, lone surrogates, and the bidirectional
// formatting characters that can disguise an extension ("invoice\u202Efdp.exe").
const FILENAME_STRIP = /[\p{Cc}\p{Zl}\p{Zp}\p{Cs}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;

/** The longest extension (dot included) kept intact when a long filename is shortened. */
export const MAX_PRESERVED_EXTENSION = 16;
const MAX_FILENAME = 255;

/**
 * A filename safe to store and show: the last path component (either slash kind), with
 * control and bidi-formatting characters removed, NFC, trimmed, leading dots removed, at
 * most 255 code points (the Attachment_filename_length CHECK) keeping an extension of up
 * to 16 code points, and never empty — "file" if nothing is left. Idempotent.
 */
// spec: docs/specs/09-decision-log.md section RD-058 (attachments)
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? "";
  const name = base
    .replace(FILENAME_STRIP, "")
    .normalize("NFC")
    .replace(/^[\s.]+/u, "")
    .trimEnd();
  if (name === "") return "file";
  if (codePointLength(name) <= MAX_FILENAME) return name;

  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  const extLength = codePointLength(ext);
  if (extLength >= 2 && extLength <= MAX_PRESERVED_EXTENSION) {
    return truncateCodePoints(name.slice(0, dot), MAX_FILENAME - extLength).trimEnd() + ext;
  }
  return truncateCodePoints(name, MAX_FILENAME).trimEnd();
}

/**
 * Where an attachment's bytes are served: `/api/v1/attachments/{id}/{filename}`, both
 * segments percent-encoded. The filename is sanitised first (a no-op for stored names), so
 * it can never be a dot segment or smuggle a slash.
 */
// spec: docs/specs/09-decision-log.md section RD-058; docs/specs/08-api-surface.md section 3 (attachment bytes)
export function attachmentUrl(id: string, filename: string): string {
  return `/api/v1/attachments/${encodeURIComponent(toWellFormed(id))}/${encodeURIComponent(sanitizeFilename(filename))}`;
}

/**
 * A Content-Disposition value: `inline` for images, `attachment` for files, with an ASCII
 * `filename` fallback and an RFC 8187 `filename*` carrying the real UTF-8 name (RFC 6266
 * §4.3). The value is pure printable ASCII — no CR, LF or other control character can reach
 * the header — and the fallback contains no `"`, `\`, `/` or `%` and never starts with a dot
 * or whitespace.
 */
// spec: docs/specs/09-decision-log.md section RD-058 (images inline; files Content-Disposition: attachment)
export function contentDisposition(kind: "image" | "file", filename: string): string {
  const name = sanitizeFilename(filename);
  const disposition = kind === "image" ? "inline" : "attachment";
  return `${disposition}; filename="${asciiFallback(name)}"; filename*=UTF-8''${rfc8187(name)}`;
}

/**
 * The `filename` fallback. NFKD runs after sanitizeFilename and can turn compatibility
 * characters back into "/" ("／", "℅" = "c/o"), "." ("．", "‥") or a leading space ("¨"), so
 * slashes are replaced and leading dots and whitespace removed again here: the fallback is
 * never a path or a dot-file, whatever a client does with it.
 */
function asciiFallback(name: string): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7e]|["\\%/]/gu, "_")
    .replace(/^[\s.]+/u, "")
    .trimEnd();
  return ascii === "" ? "file" : ascii;
}

function rfc8187(name: string): string {
  // encodeURIComponent leaves ! ' ( ) * ~ unescaped; RFC 8187 attr-char excludes ' ( ) *.
  return encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
