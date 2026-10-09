// The page tree's depth is bounded as a whole (07 §4, RD-070): the guard counts the new
// parent's ancestors AND the height of the subtree being moved under it.
import { beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "@/domain/errors";
import { mapDbError } from "@/server/repositories/db-errors";
import { demoIds, type DemoIds } from "@/test-support/documents-fixtures";
import { prisma, resetDemoInstance } from "@/test-support/fixtures";

let ids: DemoIds;

beforeEach(async () => {
  await resetDemoInstance();
  ids = await demoIds();
});

/** A chain `<prefix>1 ← <prefix>2 ← … ← <prefix>n` (each the child of the one before), in one statement. */
async function insertChain(prefix: string, length: number): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "Document" ("id", "spaceId", "title", "parentId", "createdById", "ordinal")
    SELECT ${prefix} || g, ${ids.spaces.team}, ${prefix.toUpperCase()} || ' ' || g,
           CASE WHEN g = 1 THEN NULL ELSE ${prefix} || (g - 1) END, ${ids.users.alice}, 0
    FROM generate_series(1, ${length}::int) g`;
}

const moveUnder = (id: string, parentId: string) =>
  prisma.$executeRaw`UPDATE "Document" SET "parentId" = ${parentId} WHERE "id" = ${id}`;

describe("document_tree_guard bounds the whole tree's depth", () => {
  it("allows a subtree that lands exactly on the limit", async () => {
    await insertChain("a", 600); // a600 has 599 ancestors
    await insertChain("b", 401); // b1's subtree is 400 levels below it
    await expect(moveUnder("b1", "a600")).resolves.toBeDefined(); // 600 ancestors + 400 below = 1000
  });

  it("refuses a subtree one level past it", async () => {
    await insertChain("a", 600);
    await insertChain("b", 402);
    await expect(moveUnder("b1", "a600")).rejects.toThrow(/implausibly deep/);
  });

  it("refuses stacking two deep chains — the bypass the ancestor-only guard allowed", async () => {
    await insertChain("a", 600);
    await insertChain("b", 600);
    await expect(moveUnder("b1", "a600")).rejects.toThrow(/implausibly deep/);
  });

  it("still allows an ordinary move, and moving a deep chain to the root", async () => {
    await insertChain("a", 600);
    await insertChain("c", 5);
    await expect(moveUnder("c1", "a600")).resolves.toBeDefined();
    await expect(prisma.$executeRaw`UPDATE "Document" SET "parentId" = NULL WHERE "id" = 'c1'`).resolves.toBeDefined();
  });

  it("is reported to callers as a 422-class ValidationError on parentId", async () => {
    await insertChain("a", 600);
    await insertChain("b", 600);
    const error = await moveUnder("b1", "a600").then(
      () => null,
      (e: unknown) => mapDbError(e),
    );
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).errors[0]?.path).toBe("parentId");
  });
});
