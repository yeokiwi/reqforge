// What the tree tells the user, all from the copy deck (10 §13.4). Clients branch on the
// problem's `code`, never on its text (08 §3.2, RD-072).
import { t } from "@/copy";
import type { Position } from "./model";

/** The alert after a refused or failed move; the optimistic move has been rolled back. */
// spec: docs/specs/08-api-surface.md section 3.2 (CYCLE, VALIDATION, FORBIDDEN, NOT_FOUND); RD-056, RD-070
export function moveFailureMessage(code: string): string {
  switch (code) {
    case "CYCLE":
      return t("tree.move.cycle");
    case "VALIDATION":
      // RD-070: a tree too deep, or a parent that is no longer a page of this space.
      return t("tree.move.invalid");
    case "FORBIDDEN":
      return t("tree.move.forbidden");
    case "NOT_FOUND":
      return t("tree.move.notFound");
    case "UNAUTHENTICATED":
      return t("tree.signedOut");
    default:
      return t("tree.move.failed");
  }
}

/**
 * The alert after a failed "+" (create a child page) or Create a page. POST /pages answers
 * VALIDATION at `parentId` when the parent is no longer a live page of the space (RD-070), and
 * NOT_FOUND only when the space itself is not visible (RD-051, RD-072's refusal order).
 */
// spec: docs/specs/08-api-surface.md section 3.2; RD-056 (a child is created from the tree), RD-072
export function createFailureMessage(code: string, parentId: string | null): string {
  switch (code) {
    case "FORBIDDEN":
      return t("tree.create.forbidden");
    case "VALIDATION":
      return parentId === null ? t("tree.create.failed") : t("tree.create.parentGone");
    case "NOT_FOUND":
      return t("create.failed.notFound");
    case "UNAUTHENTICATED":
      return t("tree.signedOut");
    default:
      return t("tree.create.failed");
  }
}

/** The polite announcement after a keyboard move. */
export function movedAnnouncement(title: string, where: Position): string {
  return where.parentTitle === null
    ? t("tree.moved.root", { title, position: where.position, count: where.count })
    : t("tree.moved.under", { title, parent: where.parentTitle, position: where.position, count: where.count });
}
