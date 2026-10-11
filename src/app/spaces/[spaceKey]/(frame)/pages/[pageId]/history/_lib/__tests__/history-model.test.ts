// Page History's rows (10 section 23, RD-060): CURRENT (v. N) first with no actions, then v. N
// newest first, each linking to its read-only view; Published in UTC; the change note in Comment;
// actions by permission; the current version ticked when the screen opens.
import { describe, expect, it } from "vitest";
import { buildHistoryModel, buildHistoryRows } from "../history-model";
import { bob, page, version } from "./fixtures";

const admin = { canEdit: true, canAdmin: true };

describe("buildHistoryRows", () => {
  const versions = [version(3, { current: true, message: "Restored from v. 1" }), version(2), version(1)];

  it("labels the current version CURRENT (v. N) and the rest v. N, newest first", () => {
    const rows = buildHistoryRows("TEAM", "p-spec", versions, admin);
    expect(rows.map((r) => r.label)).toEqual(["CURRENT (v. 3)", "v. 2", "v. 1"]);
    expect(rows.map((r) => r.current)).toEqual([true, false, false]);
  });

  it("puts the current row first and sorts the rest newest first, whatever order the list came in", () => {
    const shuffled = [version(1), version(4, { current: true }), version(2), version(3)];
    expect(buildHistoryRows("TEAM", "p-spec", shuffled, admin).map((r) => r.number)).toEqual([4, 3, 2, 1]);
  });

  it("links the current row to the page view and the others to ?version=N", () => {
    const rows = buildHistoryRows("TEAM", "p-spec", versions, admin);
    expect(rows.map((r) => r.href)).toEqual([
      "/spaces/TEAM/pages/p-spec",
      "/spaces/TEAM/pages/p-spec?version=2",
      "/spaces/TEAM/pages/p-spec?version=1",
    ]);
  });

  it("percent-encodes the space key and page id in links", () => {
    const [row] = buildHistoryRows("日本", "a/b", [version(2)], admin);
    expect(row?.href).toBe("/spaces/%E6%97%A5%E6%9C%AC/pages/a%2Fb?version=2");
  });

  it("formats Published in UTC like the video, keeps the ISO time, and names the author", () => {
    const [row] = buildHistoryRows("TEAM", "p-spec", [version(5, { createdAt: "2023-07-25T13:08:00.000Z", author: bob })], admin);
    expect(row).toMatchObject({ published: "Jul 25, 2023 13:08", publishedAt: "2023-07-25T13:08:00.000Z", author: "Bob Editor" });
  });

  it("shows the change note in Comment, and nothing for a version without one", () => {
    const rows = buildHistoryRows("TEAM", "p-spec", versions, admin);
    expect(rows.map((r) => r.comment)).toEqual(["Restored from v. 1", "edit 2", ""]);
  });

  it("gives the current row no actions and the others theirs, by permission", () => {
    const pinned = version(1, { pinned: true });
    const list = [version(3, { current: true }), version(2), pinned];
    expect(buildHistoryRows("TEAM", "p", list, admin).map((r) => [r.restore, r.delete])).toEqual([
      [false, { kind: "hidden" }],
      [true, { kind: "enabled" }],
      [true, { kind: "disabled", reason: "Pinned by a baseline" }],
    ]);
    expect(buildHistoryRows("TEAM", "p", list, { canEdit: true, canAdmin: false }).map((r) => [r.restore, r.delete.kind])).toEqual([
      [false, "hidden"],
      [true, "hidden"],
      [true, "hidden"],
    ]);
    expect(buildHistoryRows("TEAM", "p", list, { canEdit: false, canAdmin: false }).map((r) => [r.restore, r.delete.kind])).toEqual([
      [false, "hidden"],
      [false, "hidden"],
      [false, "hidden"],
    ]);
  });
});

describe("buildHistoryModel", () => {
  it("builds the breadcrumb back to the page, lists every version and ticks the current one", () => {
    const model = buildHistoryModel({
      space: { key: "TEAM", name: "Team" },
      page: page(),
      versions: [version(3, { current: true }), version(2), version(1)],
    });
    expect(model.crumbs).toEqual([
      { label: "Pages", href: "/spaces/TEAM" },
      { label: "Product", href: "/spaces/TEAM/pages/p-product" },
      { label: "Specifications", href: "/spaces/TEAM/pages/p-spec" },
    ]);
    expect(model.versions).toEqual([3, 2, 1]);
    expect(model.initialSelected).toEqual([3]);
    expect(model.title).toBe("Specifications");
  });

  it("uses the viewer's permissions from the page", () => {
    const model = buildHistoryModel({
      space: { key: "TEAM", name: "Team" },
      page: page({ permissions: { canEdit: false, canAdmin: false } }),
      versions: [version(2, { current: true }), version(1)],
    });
    expect(model.rows[1]).toMatchObject({ restore: false, delete: { kind: "hidden" } });
  });
});
