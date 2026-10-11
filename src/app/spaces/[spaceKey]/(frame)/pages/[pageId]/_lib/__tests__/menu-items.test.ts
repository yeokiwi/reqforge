// The `···` menu (10 §4.1, RD-059): the video's order, what is built and what is inert, and
// Copy / Move / Delete only for viewers with space EDIT (07 §2.4).
import { describe, expect, it } from "vitest";
import { pageMenuItems } from "../menu-items";

const page = (canEdit: boolean, canAdmin = false) => ({ id: "p1", permissions: { canEdit, canAdmin } });

describe("pageMenuItems", () => {
  it("lists every item in the video's order for an editor", () => {
    expect(pageMenuItems("TEAM", page(true)).map((i) => i.id)).toEqual([
      "attachments",
      "history",
      "restrictions",
      "peopleWhoCanView",
      "info",
      "hierarchy",
      "exportWord",
      "reqforge",
      "copy",
      "move",
      "delete",
    ]);
  });

  it("drops Copy, Move and Delete for a viewer without EDIT, keeping the order of the rest", () => {
    expect(pageMenuItems("TEAM", page(false, true)).map((i) => i.id)).toEqual([
      "attachments",
      "history",
      "restrictions",
      "peopleWhoCanView",
      "info",
      "hierarchy",
      "exportWord",
      "reqforge",
    ]);
  });

  it("builds Page History and View in Hierarchy as links with the URLs of 10 §11", () => {
    const items = pageMenuItems("TEAM", page(true));
    expect(items.find((i) => i.id === "history")).toMatchObject({ type: "link", href: "/spaces/TEAM/pages/p1/history" });
    expect(items.find((i) => i.id === "hierarchy")).toMatchObject({ type: "link", href: "/spaces/TEAM?highlight=p1" });
  });

  it("opens dialogs for Attachments, Page information, Copy, Move and Delete", () => {
    const dialogs = pageMenuItems("TEAM", page(true)).flatMap((i) => (i.type === "dialog" ? [[i.id, i.dialog]] : []));
    expect(dialogs).toEqual([
      ["attachments", "attachments"],
      ["info", "info"],
      ["copy", "copy"],
      ["move", "move"],
      ["delete", "delete"],
    ]);
  });

  it("draws Restrictions, People who can view, Export to Word and Reqforge inert", () => {
    const inert = pageMenuItems("TEAM", page(true)).filter((i) => i.type === "inert").map((i) => i.id);
    expect(inert).toEqual(["restrictions", "peopleWhoCanView", "exportWord", "reqforge"]);
  });

  it("percent-encodes the ids it puts in URLs", () => {
    const items = pageMenuItems("TEAM", { id: "a/b?c", permissions: { canEdit: false, canAdmin: false } });
    expect(items.find((i) => i.id === "hierarchy")).toMatchObject({ href: "/spaces/TEAM?highlight=a%2Fb%3Fc" });
  });
});
