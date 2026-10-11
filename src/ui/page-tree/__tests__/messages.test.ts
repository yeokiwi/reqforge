// Alerts and announcements come from the copy deck, chosen by the problem's code (08 §3.2).
import { describe, expect, it } from "vitest";
import { t } from "@/copy";
import { createFailureMessage, moveFailureMessage, movedAnnouncement } from "../messages";

describe("moveFailureMessage", () => {
  it("names the reason the server refused, and says the move was undone", () => {
    expect(moveFailureMessage("CYCLE")).toBe(t("tree.move.cycle"));
    expect(moveFailureMessage("VALIDATION")).toBe(t("tree.move.invalid")); // too deep, or the parent went (RD-070)
    expect(moveFailureMessage("FORBIDDEN")).toBe(t("tree.move.forbidden"));
    expect(moveFailureMessage("NOT_FOUND")).toBe(t("tree.move.notFound"));
    expect(moveFailureMessage("UNAUTHENTICATED")).toBe(t("tree.signedOut"));
    expect(moveFailureMessage("NETWORK")).toBe(t("tree.move.failed"));
    expect(moveFailureMessage("INTERNAL")).toBe(t("tree.move.failed"));
  });
});

describe("createFailureMessage", () => {
  it("tells a vanished parent from a vanished space (RD-070, RD-072)", () => {
    expect(createFailureMessage("VALIDATION", "p1")).toBe(t("tree.create.parentGone"));
    expect(createFailureMessage("VALIDATION", null)).toBe(t("tree.create.failed"));
    expect(createFailureMessage("NOT_FOUND", "p1")).toBe(t("create.failed.notFound"));
    expect(createFailureMessage("FORBIDDEN", null)).toBe(t("tree.create.forbidden"));
    expect(createFailureMessage("UNAUTHENTICATED", null)).toBe(t("tree.signedOut"));
    expect(createFailureMessage("NETWORK", "p1")).toBe(t("tree.create.failed"));
  });
});

describe("movedAnnouncement", () => {
  it("says where the page is now", () => {
    expect(movedAnnouncement("Spec", { parentTitle: null, position: 2, count: 3 })).toBe(
      t("tree.moved.root", { title: "Spec", position: 2, count: 3 }),
    );
    expect(movedAnnouncement("Spec", { parentTitle: "Team", position: 1, count: 1 })).toBe(
      t("tree.moved.under", { title: "Spec", parent: "Team", position: 1, count: 1 }),
    );
  });
});
