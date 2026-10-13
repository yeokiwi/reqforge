import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  LIMITS,
  attachmentUrl,
  classifyAttachment,
  codePointLength,
  contentDisposition,
  sanitizeFilename,
  sniffImageType,
  sniffsAsSvg,
} from "@/domain/documents";

// RD-058: images are PNG, JPEG, GIF and WebP only; SVG is refused; other files download as
// application/octet-stream; at most 10 MiB; URLs are /api/v1/attachments/{id}/{filename}.

const enc = (s: string) => new TextEncoder().encode(s);
const bytes = (...parts: Array<number[] | string | Uint8Array>) => {
  const chunks = parts.map((part) => (typeof part === "string" ? enc(part) : Uint8Array.from(part)));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
};
const utf16 = (s: string, bigEndian: boolean) => {
  const out: number[] = bigEndian ? [0xfe, 0xff] : [0xff, 0xfe];
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    out.push(...(bigEndian ? [code >> 8, code & 0xff] : [code & 0xff, code >> 8]));
  }
  return Uint8Array.from(out);
};

const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13], "IHDR");
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], [0, 16], "JFIF");
const GIF87 = bytes("GIF87a", [1, 0, 1, 0]);
const GIF89 = bytes("GIF89a", [1, 0, 1, 0]);
const WEBP = bytes("RIFF", [36, 0, 0, 0], "WEBPVP8 ");
const SVG = enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const classify = (b: Uint8Array, filename = "upload.bin", declaredContentType: string | null = null) =>
  classifyAttachment({ filename, declaredContentType, bytes: b });

describe("classifyAttachment — images by magic bytes only", () => {
  it.each([
    ["PNG", PNG, "image/png"],
    ["JPEG", JPEG, "image/jpeg"],
    ["GIF87a", GIF87, "image/gif"],
    ["GIF89a", GIF89, "image/gif"],
    ["WebP", WEBP, "image/webp"],
  ])("recognises %s", (_label, b, contentType) => {
    expect(classify(b)).toEqual({ kind: "image", contentType });
  });

  it("ignores the declared type and the extension when the bytes prove an image", () => {
    expect(classify(PNG, "notes.txt", "text/plain")).toEqual({ kind: "image", contentType: "image/png" });
    expect(classify(JPEG, "photo.png", "image/png")).toEqual({ kind: "image", contentType: "image/jpeg" });
  });

  it("never trusts a declared image type without the bytes", () => {
    expect(classify(enc("<html><script>x</script>"), "cat.png", "image/png")).toEqual({
      kind: "file",
      contentType: "application/octet-stream",
    });
  });

  it("does not accept a truncated or near-miss signature", () => {
    expect(classify(bytes([0x89, 0x50, 0x4e, 0x47])).kind).toBe("file");
    expect(classify(bytes("GIF88a")).kind).toBe("file");
    expect(classify(bytes("RIFF", [0, 0, 0, 0], "WAVE")).kind).toBe("file");
    expect(classify(bytes("RIFF", [0, 0]))).toEqual({ kind: "file", contentType: "application/octet-stream" });
    expect(classify(bytes([0xff, 0xd8]))).toEqual({ kind: "file", contentType: "application/octet-stream" });
  });

  it("treats everything else as a plain download", () => {
    expect(classify(enc("%PDF-1.7"), "spec.pdf", "application/pdf")).toEqual({ kind: "file", contentType: "application/octet-stream" });
  });
});

describe("classifyAttachment — refusals", () => {
  it("refuses an empty upload", () => {
    expect(classify(new Uint8Array(0))).toEqual({ kind: "rejected", reason: "EMPTY" });
  });

  it("accepts exactly 10 MiB and refuses one byte more", () => {
    const max = new Uint8Array(LIMITS.attachmentMaxBytes);
    max.set(PNG);
    expect(classify(max)).toEqual({ kind: "image", contentType: "image/png" });
    expect(classify(new Uint8Array(LIMITS.attachmentMaxBytes + 1))).toEqual({ kind: "rejected", reason: "TOO_LARGE" });
  });

  it.each([
    ["declared image/svg+xml", PNG, "logo.png", "image/svg+xml"],
    ["declared with parameters and odd case", PNG, "logo.png", " Image/SVG+XML; charset=utf-8"],
    ["named .svg", PNG, "logo.svg", null],
    ["named .SVG with trailing dots and spaces", PNG, "logo.SVG. .", null],
    ["named .svgz", PNG, "logo.svgz", null],
    ["named .svg behind a path and a control character", PNG, "C:\\x\\logo.svg\u0000", null],
    ["sniffed", SVG, "logo.bin", "application/octet-stream"],
  ])("refuses SVG %s", (_label, b, filename, declared) => {
    expect(classify(b, filename, declared)).toEqual({ kind: "rejected", reason: "SVG" });
  });
});

describe("sniffsAsSvg", () => {
  it.each([
    ["a bare root", "<svg/>"],
    ["leading whitespace", " \r\n\t<svg width='1'>"],
    ["an XML declaration", '<?xml version="1.0" encoding="UTF-8"?>\n<svg>'],
    ["a comment", "<!-- made by hand --><svg>"],
    ["a doctype", '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg>'],
    ["a doctype with an internal subset", '<?xml version="1.0"?><!DOCTYPE root [<!ENTITY x "a>b">]><svg>'],
    ["a namespace prefix", '<svg:svg xmlns:svg="http://www.w3.org/2000/svg">'],
    ["upper case", "<SVG>"],
    ["a root cut off at the end of the window", `<!--${"x".repeat(1013)}--><svg`],
  ])("detects %s", (_label, text) => {
    expect(sniffsAsSvg(enc(text))).toBe(true);
  });

  it("detects a UTF-8 BOM and UTF-16 in both byte orders", () => {
    expect(sniffsAsSvg(bytes([0xef, 0xbb, 0xbf], "<svg>"))).toBe(true);
    expect(sniffsAsSvg(utf16("<?xml version='1.0'?><svg>", false))).toBe(true);
    expect(sniffsAsSvg(utf16("<svg>", true))).toBe(true);
  });

  it.each([
    ["HTML", "<!doctype html><html><svg></svg></html>"],
    ["a different root", "<?xml version='1.0'?><svgx/>"],
    ["text mentioning svg", "this is not <svg>"],
    ["an unterminated comment", "<!-- <svg>"],
    ["a root beyond the first KiB", `<!--${"x".repeat(1100)}--><svg>`],
  ])("does not flag %s", (_label, text) => {
    expect(sniffsAsSvg(enc(text))).toBe(false);
  });
});

describe("sniffImageType", () => {
  it("returns null for nothing", () => {
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });
});

describe("sanitizeFilename", () => {
  it.each([
    ["a plain name", "report.pdf", "report.pdf"],
    ["a POSIX path", "../../etc/passwd", "passwd"],
    ["a Windows path", "C:\\Users\\me\\Desktop\\plan.docx", "plan.docx"],
    ["a trailing slash", "dir/", "file"],
    ["leading dots", "...hidden", "hidden"],
    ["dot segments", "..", "file"],
    ["control characters", "re\u0000po\nrt\u007f.pdf", "report.pdf"],
    ["surrounding whitespace", "  notes.txt \t", "notes.txt"],
    ["an empty name", "", "file"],
    ["a bidi override disguising an extension", "invoice\u202Efdp.exe", "invoicefdp.exe"],
    ["a decomposed accent", "Re\u0301sume\u0301.pdf", "Résumé.pdf"],
    ["a CJK name", "日本語の文字.png", "日本語の文字.png"],
  ])("handles %s", (_label, raw, expected) => {
    expect(sanitizeFilename(raw)).toBe(expected);
  });

  it("keeps the extension when shortening to 255 code points", () => {
    const long = `${"n".repeat(300)}.pdf`;
    const out = sanitizeFilename(long);
    expect(codePointLength(out)).toBe(255);
    expect(out).toBe(`${"n".repeat(251)}.pdf`);
  });

  it("counts astral characters once when shortening", () => {
    const out = sanitizeFilename(`${"😀".repeat(300)}.png`);
    expect(codePointLength(out)).toBe(255);
    expect(out.endsWith(".png")).toBe(true);
  });

  it("does not treat a very long tail as an extension", () => {
    const out = sanitizeFilename(`a.${"x".repeat(300)}`);
    expect(codePointLength(out)).toBe(255);
    expect(out.startsWith("a.")).toBe(true);
  });

  it("leaves 255 alone and shortens 256", () => {
    expect(sanitizeFilename(`${"a".repeat(251)}.txt`)).toHaveLength(255);
    expect(sanitizeFilename(`${"a".repeat(252)}.txt`)).toBe(`${"a".repeat(251)}.txt`);
  });
});

describe("attachmentUrl", () => {
  it("builds the bytes URL with an encoded filename", () => {
    expect(attachmentUrl("att_1", "plan v2.pdf")).toBe("/api/v1/attachments/att_1/plan%20v2.pdf");
    expect(attachmentUrl("att_1", "日本.png")).toBe("/api/v1/attachments/att_1/%E6%97%A5%E6%9C%AC.png");
    expect(decodeURIComponent((attachmentUrl("att_1", "a?b#c%d.png").split("/").pop() as string))).toBe("a?b#c%d.png");
  });

  it("cannot be steered by a slash or a dot segment", () => {
    expect(attachmentUrl("att_1", "../../secret")).toBe("/api/v1/attachments/att_1/secret");
    expect(attachmentUrl("att_1", "..")).toBe("/api/v1/attachments/att_1/file");
    expect(attachmentUrl("a/b", "x.png")).toBe("/api/v1/attachments/a%2Fb/x.png");
  });
});

describe("contentDisposition", () => {
  it("serves images inline and files as attachments", () => {
    expect(contentDisposition("image", "chart.png")).toBe(`inline; filename="chart.png"; filename*=UTF-8''chart.png`);
    expect(contentDisposition("file", "spec.pdf")).toBe(`attachment; filename="spec.pdf"; filename*=UTF-8''spec.pdf`);
  });

  it("gives non-ASCII names an ASCII fallback and an RFC 8187 filename*", () => {
    expect(contentDisposition("file", "Résumé.pdf")).toBe(`attachment; filename="Resume.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9.pdf`);
    expect(contentDisposition("file", "日本.pdf")).toBe(`attachment; filename="__.pdf"; filename*=UTF-8''%E6%97%A5%E6%9C%AC.pdf`);
  });

  it("cannot be used for header injection or to break out of the quoted string", () => {
    const value = contentDisposition("file", 'evil"\r\nSet-Cookie: x=1; a%41(1)*\'.txt');
    expect(value).not.toMatch(/[\r\n]/);
    expect(value).toBe(
      `attachment; filename="evil_Set-Cookie: x=1; a_41(1)*'.txt"; filename*=UTF-8''evil%22Set-Cookie%3A%20x%3D1%3B%20a%2541%281%29%2A%27.txt`,
    );
  });

  it("treats a backslash as a path separator, so it never reaches the header", () => {
    expect(contentDisposition("file", 'x"\\evil.txt')).toBe(`attachment; filename="evil.txt"; filename*=UTF-8''evil.txt`);
  });

  it("does not let compatibility characters turn the ASCII fallback into a path", () => {
    // NFKD maps fullwidth and compatibility forms back to "/" and "." after
    // sanitizeFilename has already removed separators and leading dots.
    expect(contentDisposition("file", "．．／etc／passwd")).toBe(
      `attachment; filename="_etc_passwd"; filename*=UTF-8''%EF%BC%8E%EF%BC%8E%EF%BC%8Fetc%EF%BC%8Fpasswd`,
    );
    expect(contentDisposition("file", "․․bashrc")).toBe(`attachment; filename="bashrc"; filename*=UTF-8''%E2%80%A4%E2%80%A4bashrc`);
    expect(fallbackOf(contentDisposition("file", "℅ notes.txt"))).toBe("c_o notes.txt"); // ℅ is "c/o"
    expect(fallbackOf(contentDisposition("file", "¨．profile"))).toBe("profile"); // "¨" is a space and a mark
    expect(fallbackOf(contentDisposition("file", "‥"))).toBe("file");
  });
});

/** The ASCII `filename` parameter of a Content-Disposition value. */
function fallbackOf(header: string): string {
  const m = /; filename="([^"]*)";/.exec(header);
  if (!m) throw new Error(`no filename parameter in ${header}`);
  return m[1] as string;
}

// ---- properties ---------------------------------------------------------------------------

const prolog = fc.array(
  fc.constantFrom(" ", "\n", "\t", '<?xml version="1.0"?>', "<!-- c -->", "<?pi x?>", '<!DOCTYPE x SYSTEM "a>b">'),
  { maxLength: 6 },
);
const svgDocument = fc
  .tuple(fc.boolean(), prolog, fc.constantFrom("svg", "SVG", "svg:svg", "s:svg"), fc.constantFrom(">", " ", "/", "\n"), fc.string())
  .map(([bom, pro, root, after, rest]) => bytes(bom ? [0xef, 0xbb, 0xbf] : [], pro.join(""), `<${root}${after}${rest}`));

const anyUpload = fc.record({
  filename: fc.oneof(fc.string(), fc.constantFrom("a.svg", "a.png", "a.SVG ", "x")),
  declaredContentType: fc.option(fc.constantFrom("image/png", "image/svg+xml", "text/plain", "application/octet-stream")),
  bytes: fc.oneof(
    fc.uint8Array({ maxLength: 64 }),
    svgDocument,
    fc.constantFrom(PNG, JPEG, GIF87, GIF89, WEBP, SVG),
    fc.tuple(fc.constantFrom(PNG, JPEG, GIF89, WEBP), fc.uint8Array({ maxLength: 16 })).map(([a, b]) => bytes(a, b)),
  ),
});

describe("attachment properties", () => {
  it("anything that sniffs as SVG is rejected, never an image", () => {
    fc.assert(
      fc.property(anyUpload, (upload) => {
        const result = classifyAttachment(upload);
        if (sniffsAsSvg(upload.bytes)) expect(result).toEqual({ kind: "rejected", reason: "SVG" });
      }),
      { numRuns: 1000 },
    );
  });

  it("generated SVG documents are always detected", () => {
    fc.assert(
      fc.property(svgDocument, (b) => {
        expect(sniffsAsSvg(b)).toBe(true);
        expect(classify(b, "x.png", "image/png")).toEqual({ kind: "rejected", reason: "SVG" });
      }),
      { numRuns: 500 },
    );
  });

  it("an image verdict always matches the magic bytes, whatever was declared", () => {
    fc.assert(
      fc.property(anyUpload, (upload) => {
        const result = classifyAttachment(upload);
        if (result.kind === "image") expect(result.contentType).toBe(sniffImageType(upload.bytes));
        if (result.kind === "file") expect(sniffImageType(upload.bytes)).toBeNull();
      }),
      { numRuns: 1000 },
    );
  });

  it("sanitizeFilename is idempotent and always returns a safe, bounded, non-empty name", () => {
    const raw = fc.oneof(fc.string({ unit: "binary", maxLength: 400 }), fc.string({ unit: "grapheme", maxLength: 300 }));
    fc.assert(
      fc.property(raw, (s) => {
        const out = sanitizeFilename(s);
        expect(out.length).toBeGreaterThan(0);
        expect(codePointLength(out)).toBeLessThanOrEqual(255);
        expect(out).not.toMatch(/[/\\\p{Cc}\p{Cs}]/u);
        expect(out).not.toMatch(/^[\s.]/u);
        expect(out).toBe(out.trim());
        expect(sanitizeFilename(out)).toBe(out);
      }),
      { numRuns: 1000 },
    );
  });

  it("contentDisposition's ASCII fallback is never a path: no slash, no backslash, no leading dot or space", () => {
    // Every character whose NFKD form contains "/", "\" or "." (U+2100, U+2105, U+FF0F,
    // U+FE68, U+FF3C, U+2024-2026, U+FE52, U+FF0E, ...), one that decomposes to a leading
    // space, and ordinary filler.
    const tricky = fc.constantFrom(
      "℀", "℁", "℅", "℆", "／", "﹨", "＼", "․", "‥", "…", "︙", "︰", "﹒", "．", "⒈", "㏂", "🄀",
      "¨", "´", ".", " ", "/", "a", "é", "日",
    );
    const name = fc.oneof(fc.string({ unit: tricky, maxLength: 12 }), fc.string({ unit: "binary", maxLength: 40 }));
    fc.assert(
      fc.property(name, fc.constantFrom("image", "file") as fc.Arbitrary<"image" | "file">, (s, kind) => {
        const fallback = fallbackOf(contentDisposition(kind, s));
        expect(fallback).not.toMatch(/[/\\]/);
        expect(fallback).not.toMatch(/^[\s.]/);
        expect(fallback).not.toBe("");
        expect(fallback).toBe(fallback.trim());
      }),
      { numRuns: 1000 },
    );
  });

  it("contentDisposition is printable ASCII, and attachmentUrl never throws and round-trips", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 300 }), fc.constantFrom("image", "file") as fc.Arbitrary<"image" | "file">, (s, kind) => {
        expect(contentDisposition(kind, s)).toMatch(/^(inline|attachment); filename="[\x20-\x7e]*"; filename\*=UTF-8''[\x21-\x7e]+$/);
        const url = attachmentUrl("att", s);
        expect(decodeURIComponent(url.slice("/api/v1/attachments/att/".length))).toBe(sanitizeFilename(s));
      }),
      { numRuns: 500 },
    );
  });
});

describe("filename work is bounded (RD-085)", () => {
  const time = (fn: () => void) => {
    const started = performance.now();
    fn();
    return performance.now() - started;
  };

  it("sanitizes a 2,000,000-unit name made of combining marks in milliseconds (it took ~15 s per 200,000)", () => {
    const name = "a" + "\u0316\u0301".repeat(1_000_000) + ".txt";
    let result = "";
    expect(time(() => (result = sanitizeFilename(name)))).toBeLessThan(500);
    expect(result.endsWith(".txt")).toBe(true);
    expect(codePointLength(result)).toBeLessThanOrEqual(255);
  });

  it("classifies a name of 200,000 dots or spaces in milliseconds (the trailing-run regex took ~19 s per 120,000)", () => {
    for (const filler of [".", " ", ". "]) {
      const filename = "a" + filler.repeat(200_000) + "b";
      expect(time(() => classifyAttachment({ filename, declaredContentType: null, bytes: bytes([1, 2, 3]) }))).toBeLessThan(500);
    }
  });

  it("still sees .svg behind any amount of trailing whitespace and dots, however long", () => {
    for (const trail of [" ", "  ".repeat(100_000), ". . .", "\t\n"]) {
      expect(classifyAttachment({ filename: `logo.svg${trail}`, declaredContentType: null, bytes: bytes([1]) })).toEqual({
        kind: "rejected",
        reason: "SVG",
      });
    }
    expect(classifyAttachment({ filename: "logo.svgz.", declaredContentType: null, bytes: bytes([1]) })).toEqual({
      kind: "rejected",
      reason: "SVG",
    });
    expect(classifyAttachment({ filename: "svg.txt", declaredContentType: null, bytes: bytes([1]) }).kind).toBe("file");
  });

  it("keeps the extension of an overlong name", () => {
    expect(sanitizeFilename("x".repeat(5000) + ".pdf").endsWith(".pdf")).toBe(true);
  });
});
