// CLAUDE.md rule 1: the spec is the contract. create-page-button.test.tsx and top-bar.test.tsx
// pin what `Create` does inside a space the viewer can edit: an enabled button that makes an
// `Untitled` page at once and opens the editor (RD-056, slice 1). This file checks that the two
// other places which describe that button say the same — 10 section 2's `Create` row, and the
// Playwright suite. If it fails, the code, the spec row or the e2e expectation is wrong: fix the
// one that is, and say which.
//
// RD-052 drew the button disabled in an editable space "until pages exist (slice 1)"; that was
// slice 0's interim rule, and slice 1 replaces it.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repo = path.resolve(__dirname, "../../..");

/** The body of the `## <n>.` section of a markdown file, up to the next `## ` heading. */
function section(markdown: string, number: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## ${number}. `));
  if (start < 0) return "";
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

/** The table row of 10 section 2 whose element cell is `Create`, or null. */
function createRow(): string | null {
  const spec = readFileSync(path.join(repo, "docs/specs/10-ui-reference.md"), "utf8");
  const rows = section(spec, "2").split("\n").filter((line) => line.startsWith("|"));
  return rows.find((row) => row.split("|")[1]?.replace(/[*`]/g, "").trim() === "Create") ?? null;
}

/**
 * Playwright expectations that the top bar's `Create` (deck id `shell.create` exactly, not one of
 * its menu rows) is disabled. The in-flight lock also sets `aria-busy`, so a test of that lock can
 * assert `aria-busy` without tripping this.
 */
function e2eExpectsCreateDisabled(): string[] {
  const dir = path.join(repo, "e2e");
  const disabled =
    /getByRole\(\s*["']button["']\s*,\s*\{\s*name:\s*t\(\s*["']shell\.create["']\s*\)\s*\}\s*\)\s*\)\s*\.(?:toBeDisabled|not\.toBeEnabled)\(/;
  return readdirSync(dir)
    .filter((file) => file.endsWith(".spec.ts"))
    .flatMap((file) =>
      readFileSync(path.join(dir, file), "utf8")
        .split("\n")
        .flatMap((line, i) => (disabled.test(line) ? [`e2e/${file}:${i + 1}`] : [])),
    );
}

describe("`Create` inside a space the viewer can edit: code, spec and e2e agree (RD-056)", () => {
  it("10 section 2's row describes the button that is built — a new page in the current space, not a disabled slot", () => {
    const row = createRow();
    expect(row, "10 section 2 has no `Create` row: this check would be vacuous").not.toBeNull();
    expect(row).toMatch(/new page in the current space/);
    expect(row).not.toMatch(/disabled\s+inside\s+a\s+space/i);
  });

  it("no Playwright test expects the top bar's `Create` to be disabled", () => {
    expect(e2eExpectsCreateDisabled()).toEqual([]);
  });
});
