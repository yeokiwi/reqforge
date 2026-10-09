// The opaque Db handle is only opaque if nothing outside the repository layer can unwrap it.
// internal.ts turns a handle back into a Prisma client; only src/server/repositories/** may
// import it. (src/__tests__/architecture.test.ts already keeps @prisma/client in this layer.)
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../..");
const REPOSITORIES = path.resolve(__dirname, "..");

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules") continue;
      yield* sourceFiles(full);
    } else if (/\.(ts|tsx)$/.test(name)) {
      yield full;
    }
  }
}

describe("repository internals", () => {
  it("only src/server/repositories imports repositories/internal", () => {
    const offenders = [...sourceFiles(SRC)]
      .filter((f) => !f.startsWith(REPOSITORIES + path.sep))
      .filter((f) => /from\s+["'][^"']*repositories\/internal["']/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("scans a non-trivial tree", () => {
    expect([...sourceFiles(SRC)].length).toBeGreaterThan(20);
  });
});
