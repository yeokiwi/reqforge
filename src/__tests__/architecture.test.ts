// CLAUDE.md "Code conventions", enforced as a test so a lint-config slip cannot hide a breach.
//   app → server → domain → db        (imports point inward only)
//   Prisma is imported only from src/server/repositories/**
//   src/domain/** is pure: no React, no Next, no Prisma, no server, no app
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__") continue;
      yield* sourceFiles(full);
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".generated.ts")) {
      yield full;
    }
  }
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map(
    (m) => (m[1] ?? m[2]) as string,
  );
}

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

const files = [...sourceFiles(SRC)].filter((f) => !rel(f).startsWith("test-support/"));
const under = (prefix: string) => files.filter((f) => rel(f).startsWith(prefix));

describe("layer boundaries", () => {
  it("found source files to check", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("only src/server/repositories imports the Prisma client", () => {
    const offenders = files
      .filter((f) => !rel(f).startsWith("server/repositories/"))
      .filter((f) => importsOf(f).some((i) => i === "@prisma/client" || i.startsWith("@prisma/client/")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("src/domain is pure: no React, Next, Prisma, server or app imports", () => {
    const forbidden = /^(react|react-dom|next)(\/|$)|^@prisma\/|^@\/(server|app|ui)(\/|$)/;
    const offenders = under("domain/").flatMap((f) =>
      importsOf(f)
        .filter((i) => forbidden.test(i))
        .map((i) => `${rel(f)} imports ${i}`),
    );
    expect(offenders).toEqual([]);
  });

  it("src/server never imports upward (app, ui)", () => {
    const offenders = under("server/").flatMap((f) =>
      importsOf(f)
        .filter((i) => /^@\/(app|ui)(\/|$)/.test(i))
        .map((i) => `${rel(f)} imports ${i}`),
    );
    expect(offenders).toEqual([]);
  });

  it("route handlers and components never reach a repository directly", () => {
    const offenders = [...under("app/"), ...under("ui/")].flatMap((f) =>
      importsOf(f)
        .filter((i) => /^@\/server\/repositories(\/|$)/.test(i))
        .map((i) => `${rel(f)} imports ${i}`),
    );
    expect(offenders).toEqual([]);
  });

  it("no default exports outside Next.js entry points", () => {
    const entry = /(^|\/)(page|layout|template|loading|error|global-error|not-found|default|route)\.tsx?$|^middleware\.ts$/;
    const offenders = files
      .filter((f) => !entry.test(rel(f)))
      .filter((f) => /^\s*export\s+default\b/m.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("no 'any' in source (use unknown and narrow)", () => {
    const offenders = files
      .filter((f) => /(:\s*any\b|<any>|\bas any\b|any\[\])/.test(readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
