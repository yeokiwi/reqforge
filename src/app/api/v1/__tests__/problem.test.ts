// Problem details (spec 08 §3.2, RD-064): every code maps to its status, extras are carried,
// and nothing about an unexpected error reaches the body.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorCode } from "@/domain/documents/api-types";
import {
  AppError,
  CurrentVersionError,
  CycleError,
  ForbiddenError,
  NotFoundError,
  PinnedVersionError,
  TitleTakenError,
  TooLargeError,
  UnauthenticatedError,
  UnsupportedMediaError,
  ValidationError,
  VersionConflictError,
} from "@/domain/errors";
import { problemFor, problemFromError, problemJson, problemResponse } from "../_lib/problem";
import { OriginMismatchError } from "../_lib/handler";

afterEach(() => {
  vi.restoreAllMocks();
});

// The table of 08 §3.2, restated so a change to either side fails here.
const TABLE: ReadonlyArray<readonly [ApiErrorCode, number]> = [
  ["UNAUTHENTICATED", 401],
  ["ORIGIN_MISMATCH", 403],
  ["FORBIDDEN", 403],
  ["NOT_FOUND", 404],
  ["VALIDATION", 422],
  ["TITLE_TAKEN", 409],
  ["VERSION_CONFLICT", 409],
  ["CYCLE", 409],
  ["CURRENT_VERSION", 409],
  ["PINNED_VERSION", 409],
  ["TOO_LARGE", 413],
  ["UNSUPPORTED_MEDIA", 415],
  ["RENDER_UNSUPPORTED", 500],
  ["INTERNAL", 500],
];

describe("problemFor", () => {
  it.each(TABLE)("%s is %i with type about:blank, a title and a detail", (code, status) => {
    const p = problemFor(code);
    expect(p).toMatchObject({ type: "about:blank", status, code });
    expect(p.title.length).toBeGreaterThan(0);
    expect(p.detail.length).toBeGreaterThan(0);
  });
});

describe("problemFromError", () => {
  it.each<[string, AppError, ApiErrorCode, number]>([
    ["UnauthenticatedError", new UnauthenticatedError(), "UNAUTHENTICATED", 401],
    ["OriginMismatchError", new OriginMismatchError(), "ORIGIN_MISMATCH", 403],
    ["ForbiddenError", new ForbiddenError("EDIT"), "FORBIDDEN", 403],
    ["NotFoundError", new NotFoundError("Page"), "NOT_FOUND", 404],
    ["TitleTakenError", new TitleTakenError(), "TITLE_TAKEN", 409],
    ["CycleError", new CycleError(), "CYCLE", 409],
    ["CurrentVersionError", new CurrentVersionError(), "CURRENT_VERSION", 409],
    ["PinnedVersionError", new PinnedVersionError(), "PINNED_VERSION", 409],
    ["UnsupportedMediaError", new UnsupportedMediaError(), "UNSUPPORTED_MEDIA", 415],
    ["RENDER_UNSUPPORTED", new AppError("RENDER_UNSUPPORTED", "svg"), "RENDER_UNSUPPORTED", 500],
  ])("maps %s to its code and status, with no extras", (_name, error, code, status) => {
    const p = problemFromError(error);
    expect(p).toMatchObject({ code, status, type: "about:blank" });
    expect(p).not.toHaveProperty("errors");
    expect(p).not.toHaveProperty("currentVersion");
    expect(p).not.toHaveProperty("limit");
  });

  it("carries errors for VALIDATION, as plain { path, message } objects", () => {
    const p = problemFromError(new ValidationError([{ path: "title", message: "must not be empty" }, { path: "content.content.0", message: "bad" }]));
    expect(p).toMatchObject({ code: "VALIDATION", status: 422 });
    expect(p.errors).toEqual([
      { path: "title", message: "must not be empty" },
      { path: "content.content.0", message: "bad" },
    ]);
  });

  it("carries currentVersion for VERSION_CONFLICT", () => {
    const p = problemFromError(new VersionConflictError(7));
    expect(p).toMatchObject({ code: "VERSION_CONFLICT", status: 409, currentVersion: 7 });
  });

  it("carries limit for TOO_LARGE", () => {
    const p = problemFromError(new TooLargeError(5_242_880));
    expect(p).toMatchObject({ code: "TOO_LARGE", status: 413, limit: 5_242_880 });
  });

  it("names the limit in TOO_LARGE's detail without claiming the request is what is too large (a copy's images can be)", () => {
    const p = problemFromError(new TooLargeError(52_428_800));
    expect(p.detail).toContain("52428800 bytes");
    expect(p.detail).not.toMatch(/request/i);
  });

  it("never derives the detail from an error's message", () => {
    const p = problemFromError(new NotFoundError("the secret project page"));
    expect(JSON.stringify(p)).not.toContain("secret");
  });

  it.each<[string, unknown]>([
    ["a plain Error", new Error('relation "Document" does not exist: SELECT * FROM "Document"')],
    ["an AppError with a code outside the API table", new AppError("COPY_DECK", 'copy "x" needs a "y" parameter')],
    ["an AppError claiming INTERNAL", new AppError("INTERNAL", "internal detail")],
    ["a thrown string", "SELECT password FROM users"],
    ["a Prisma-shaped object", { name: "PrismaClientKnownRequestError", code: "P2010", meta: { message: "ERROR: secret" } }],
    ["undefined", undefined],
  ])("turns %s into INTERNAL with the generic detail", (_label, thrown) => {
    const p = problemFromError(thrown);
    expect(p).toEqual(problemFor("INTERNAL"));
  });
});

describe("problemResponse", () => {
  it("is application/problem+json, never cached, with the problem's status", async () => {
    const res = problemResponse(new VersionConflictError(3));
    expect(res.status).toBe(409);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ code: "VERSION_CONFLICT", currentVersion: 3 });
  });

  it("logs a server fault server-side and leaks no message, stack, SQL or Prisma text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secret = new Error('Invalid `prisma.document.update()` invocation: duplicate key value violates "Document_pkey" SELECT 1');
    const res = problemResponse(secret);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual(problemFor("INTERNAL"));
    for (const fragment of ["prisma", "SELECT", "Document_pkey", "invocation", "at ", ".ts"]) expect(text).not.toContain(fragment);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toContain(secret);
  });

  it("does not log client errors", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    problemResponse(new NotFoundError("Page"));
    problemResponse(new ValidationError([{ path: "title", message: "x" }]));
    expect(log).not.toHaveBeenCalled();
  });

  it("problemJson keeps extra headers but forces the type and no-store", () => {
    const res = problemJson(problemFor("NOT_FOUND"), { "Cache-Control": "public, max-age=60", "X-Extra": "1" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-extra")).toBe("1");
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });
});
