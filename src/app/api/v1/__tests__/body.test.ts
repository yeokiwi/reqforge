// Request bodies (spec 08 §3.2, RD-058, RD-063): media type, a cap enforced on the bytes actually
// read (never on a declared length alone), and malformed input as VALIDATION.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TooLargeError, UnsupportedMediaError, ValidationError } from "@/domain/errors";
import { JSON_BODY_CAP, UPLOAD_BODY_CAP, mediaType, parseWith, readJsonBody, readOptionalJsonBody, readUploadedFile } from "../_lib/body";

const URL_ = "http://reqforge.test/api/v1/x";
const MIB = 1024 * 1024;

function post(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  const init: RequestInit & { duplex?: "half" } = { method: "POST", headers, body };
  if (body instanceof ReadableStream) init.duplex = "half";
  return new Request(URL_, init);
}

/** A chunked body of `total` bytes, counting how many bytes the reader actually pulled. */
function countingStream(total: number, chunk = 64 * 1024): { stream: ReadableStream<Uint8Array>; pulled: () => number } {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= total) {
        controller.close();
        return;
      }
      const n = Math.min(chunk, total - sent);
      sent += n;
      controller.enqueue(new Uint8Array(n).fill(0x20));
    },
  });
  return { stream, pulled: () => sent };
}

async function rejectionOf(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error("expected a rejection");
    },
    (e: unknown) => e,
  );
}

describe("mediaType", () => {
  it("lower-cases and drops parameters", () => {
    expect(mediaType("Application/JSON; charset=UTF-8")).toBe("application/json");
    expect(mediaType(null)).toBeNull();
    expect(mediaType(" ; x")).toBeNull();
  });
});

describe("readJsonBody", () => {
  it("parses a JSON object, with or without a charset", async () => {
    expect(await readJsonBody(post('{"a":1}', { "content-type": "application/json" }))).toEqual({ a: 1 });
    expect(await readJsonBody(post('{"a":"é"}', { "content-type": "application/json; charset=utf-8" }))).toEqual({ a: "é" });
  });

  it.each([["text/plain"], ["application/x-www-form-urlencoded"], ["multipart/form-data; boundary=x"], ["application/jsonx"]])(
    "refuses Content-Type %s with UNSUPPORTED_MEDIA",
    async (type) => {
      expect(await rejectionOf(readJsonBody(post('{"a":1}', { "content-type": type })))).toBeInstanceOf(UnsupportedMediaError);
    },
  );

  it("refuses a body with no Content-Type with UNSUPPORTED_MEDIA", async () => {
    const req = new Request(URL_, { method: "POST", body: new Uint8Array([0x7b, 0x7d]) });
    expect(req.headers.get("content-type")).toBeNull();
    expect(await rejectionOf(readJsonBody(req))).toBeInstanceOf(UnsupportedMediaError);
  });

  it("refuses a declared Content-Length over the cap before reading, with the 5 MiB limit", async () => {
    const { stream, pulled } = countingStream(10 * MIB);
    const error = await rejectionOf(
      readJsonBody(post(stream, { "content-type": "application/json", "content-length": String(JSON_BODY_CAP + 1) })),
    );
    expect(error).toBeInstanceOf(TooLargeError);
    expect((error as TooLargeError).limit).toBe(5 * MIB);
    expect(pulled()).toBeLessThan(MIB);
  });

  it("refuses a chunked body with no Content-Length as soon as it passes the cap, without reading the rest", async () => {
    const { stream, pulled } = countingStream(50 * MIB);
    const error = await rejectionOf(readJsonBody(post(stream, { "content-type": "application/json" })));
    expect(error).toBeInstanceOf(TooLargeError);
    expect((error as TooLargeError).limit).toBe(5 * MIB);
    // At most the cap plus what was already queued: never the whole 50 MiB.
    expect(pulled()).toBeLessThan(JSON_BODY_CAP + 2 * MIB);
  });

  it("does not trust an understated Content-Length", async () => {
    const { stream } = countingStream(JSON_BODY_CAP + 1);
    const error = await rejectionOf(readJsonBody(post(stream, { "content-type": "application/json", "content-length": "10" })));
    expect(error).toBeInstanceOf(TooLargeError);
  });

  it("accepts a body of exactly the cap", async () => {
    const text = JSON.stringify("x".repeat(JSON_BODY_CAP - 2));
    expect(new TextEncoder().encode(text).byteLength).toBe(JSON_BODY_CAP);
    const value = await readJsonBody(post(text, { "content-type": "application/json" }));
    expect(typeof value).toBe("string");
  });

  it.each<[string, BodyInit]>([
    ["malformed JSON", '{"a":'],
    ["an empty body", ""],
    ["whitespace", "  \n"],
    ["invalid UTF-8", new Uint8Array([0x22, 0xff, 0xfe, 0x22])],
  ])("refuses %s with VALIDATION", async (_label, body) => {
    const error = await rejectionOf(readJsonBody(post(body, { "content-type": "application/json" })));
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).errors).toHaveLength(1);
  });
});

/**
 * What Python's `json.dumps` writes by default (and so `requests.put(url, json=...)`): ASCII only
 * (`ensure_ascii=True`, every other UTF-16 unit as `\uXXXX`) with `", "` and `": "` separators.
 */
function pythonDumps(value: unknown): string {
  const str = (s: string) => JSON.stringify(s).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  if (value === null || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return str(value);
  if (Array.isArray(value)) return `[${value.map(pythonDumps).join(", ")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).map(([k, v]) => `${str(k)}: ${pythonDumps(v)}`).join(", ")}}`;
  }
  throw new Error(`not JSON: ${typeof value}`);
}

const utf8 = (s: string) => new TextEncoder().encode(s).byteLength;

describe("readJsonBody: the cap bounds the request, not the content (RD-063, RD-068)", () => {
  const OLD_CAP = 5 * MIB + 64 * 1024;
  const body = (text: string) => ({ title: "Spec", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }, baseVersion: 1 });

  it("accepts an ASCII-escaped body over 5 MiB whose content is 3 MB (Python's requests.put(json=...))", async () => {
    const value = body("中".repeat(1_000_000));
    const wire = pythonDumps(value);
    expect(utf8(JSON.stringify(value.content))).toBeLessThan(3_100_000);
    expect(utf8(wire)).toBeGreaterThan(OLD_CAP);
    expect(await readJsonBody(post(wire, { "content-type": "application/json" }))).toEqual(value);
  });

  it("accepts escaping at its worst — two-byte characters, three times their UTF-8 size — for content right up to 5 MiB", async () => {
    // Content of just under 5 MiB as compact UTF-8, which is what validateDocumentJson measures.
    const value = body("é".repeat(Math.floor((5 * MIB - 200) / 2)));
    expect(utf8(JSON.stringify(value.content))).toBeLessThanOrEqual(5 * MIB);
    const wire = pythonDumps(value);
    expect(utf8(wire)).toBeGreaterThan(15_700_000);
    expect(await readJsonBody(post(wire, { "content-type": "application/json" }))).toEqual(value);
  });

  it("is three times the content limit plus a 64 KiB envelope", () => {
    expect(JSON_BODY_CAP).toBe(3 * 5 * MIB + 64 * 1024);
  });
});

describe("readOptionalJsonBody", () => {
  it("reads no body and no Content-Type as {}", async () => {
    expect(await readOptionalJsonBody(new Request(URL_, { method: "POST" }))).toEqual({});
  });

  it("refuses a body without a Content-Type, and reads a JSON one", async () => {
    const req = new Request(URL_, { method: "POST", body: new Uint8Array([0x7b, 0x7d]) });
    expect(await rejectionOf(readOptionalJsonBody(req))).toBeInstanceOf(UnsupportedMediaError);
    expect(await readOptionalJsonBody(post('{"title":"x"}', { "content-type": "application/json" }))).toEqual({ title: "x" });
  });
});

describe("readUploadedFile", () => {
  function upload(form: FormData): Request {
    return new Request(URL_, { method: "POST", body: form });
  }

  it("returns the one file in the field `file`, with its name and declared type", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], "a b.png", { type: "image/png" }));
    const file = await readUploadedFile(upload(form));
    expect(file.filename).toBe("a b.png");
    expect(file.declaredContentType).toBe("image/png");
    expect([...file.bytes]).toEqual([1, 2, 3]);
  });

  it("passes the part's declared type through untouched (it is only ever used to refuse SVG, RD-071)", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1])], "x.png", { type: "image/svg+xml" }));
    expect((await readUploadedFile(upload(form))).declaredContentType).toBe("image/svg+xml");
    // A part with no Content-Type of its own parses as text/plain (the multipart default), never as an image type.
    const raw = '--xyz\r\nContent-Disposition: form-data; name="file"; filename="x.bin"\r\n\r\nAB\r\n--xyz--\r\n';
    const file = await readUploadedFile(post(raw, { "content-type": "multipart/form-data; boundary=xyz" }));
    expect(file.declaredContentType).toBe("text/plain");
    expect(new TextDecoder().decode(file.bytes)).toBe("AB");
  });

  it("refuses a body that is not multipart/form-data with UNSUPPORTED_MEDIA", async () => {
    expect(await rejectionOf(readUploadedFile(post('{"a":1}', { "content-type": "application/json" })))).toBeInstanceOf(
      UnsupportedMediaError,
    );
  });

  it("refuses an upload over the cap as it streams, with the 10 MiB limit", async () => {
    const { stream, pulled } = countingStream(40 * MIB);
    const error = await rejectionOf(readUploadedFile(post(stream, { "content-type": "multipart/form-data; boundary=xyz" })));
    expect(error).toBeInstanceOf(TooLargeError);
    expect((error as TooLargeError).limit).toBe(10 * MIB);
    expect(pulled()).toBeLessThan(UPLOAD_BODY_CAP + 2 * MIB);
  });

  it.each<[string, (form: FormData) => void]>([
    ["no file field", (f) => f.append("other", new File([new Uint8Array([1])], "x"))],
    ["a text field named file", (f) => f.append("file", "not a file")],
    [
      "two files",
      (f) => {
        f.append("file", new File([new Uint8Array([1])], "a"));
        f.append("file", new File([new Uint8Array([2])], "b"));
      },
    ],
  ])("refuses %s with VALIDATION at file", async (_label, fill) => {
    const form = new FormData();
    fill(form);
    const error = await rejectionOf(readUploadedFile(upload(form)));
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).errors.map((e) => e.path)).toEqual(["file"]);
  });

  it("refuses a multipart body that does not parse with VALIDATION at file", async () => {
    const error = await rejectionOf(readUploadedFile(post("garbage", { "content-type": "multipart/form-data; boundary=xyz" })));
    expect(error).toBeInstanceOf(ValidationError);
  });
});

describe("parseWith", () => {
  const schema = z.object({ title: z.string(), nested: z.object({ n: z.number().int() }) });

  it("returns the parsed value", () => {
    expect(parseWith(schema, { title: "x", nested: { n: 1 }, extra: true })).toEqual({ title: "x", nested: { n: 1 } });
  });

  it("turns every issue into a dotted path", () => {
    try {
      parseWith(schema, { title: 1, nested: { n: 1.5 } });
      throw new Error("expected a ValidationError");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).errors.map((x) => x.path).sort()).toEqual(["nested.n", "title"]);
    }
  });

  it("reports a non-object body at the root path", () => {
    try {
      parseWith(schema, [1, 2]);
      throw new Error("expected a ValidationError");
    } catch (e) {
      expect((e as ValidationError).errors.map((x) => x.path)).toEqual([""]);
    }
  });
});
