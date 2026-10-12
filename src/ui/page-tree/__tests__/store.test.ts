// The shared page-tree store: freshness (stale responses never win), optimistic moves with
// rollback, one create per press, auto-expansion and remembered expansion.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageSummary } from "@/domain/documents";
import { expansionKey, type StorageLike } from "../expansion-storage";
import { CREATE_LOCK_MS, PageTreeStore } from "../store";
import { fakeApi, page, problem, sampleTree, settle, type FakeApi } from "./fake-api";

let api: FakeApi;
beforeEach(() => {
  api = fakeApi();
});
afterEach(() => {
  vi.useRealTimers();
});

const make = (over: { canEdit?: boolean; currentId?: string | null; pages?: PageSummary[] | null } = {}) =>
  new PageTreeStore({
    spaceKey: "TEAM",
    canEdit: over.canEdit ?? true,
    initial: over.pages === null ? null : { status: "ready", pages: over.pages ?? sampleTree() },
    currentId: over.currentId ?? null,
    fetchImpl: api.fetchImpl,
  });

const childIds = (store: PageTreeStore, id: string | null) =>
  id === null ? store.getRootIds() : (store.getNode(id)?.childIds ?? []);

describe("freshness", () => {
  it("starts from the server's pages without fetching", () => {
    const store = make();
    expect(store.getStatus()).toBe("ready");
    expect(store.getRootIds()).toEqual(["s", "team"]);
    store.retain();
    expect(api.calls).toHaveLength(0);
  });

  it("fetches when it starts with nothing and someone is looking", async () => {
    const store = make({ pages: null });
    expect(store.getStatus()).toBe("loading");
    store.retain();
    expect(api.calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET /api/v1/spaces/TEAM/pages"]);
    api.calls[0]?.respond(200, [page("a", "A")]);
    await settle();
    expect(store.getStatus()).toBe("ready");
    expect(store.getRootIds()).toEqual(["a"]);
  });

  it("ignores a response older than one already applied (stale-response guard)", async () => {
    const store = make();
    store.retain();
    store.invalidate(); // request 1
    store.invalidate(); // request 2
    const [first, second] = api.calls;
    second?.respond(200, [page("new", "Newer tree")]);
    await settle();
    expect(store.getRootIds()).toEqual(["new"]);
    first?.respond(200, [page("old", "Older tree")]);
    await settle();
    expect(store.getRootIds()).toEqual(["new"]);
  });

  it("applies responses that arrive in order", async () => {
    const store = make();
    store.retain();
    store.invalidate();
    store.invalidate();
    api.calls[0]?.respond(200, [page("one", "One")]);
    await settle();
    expect(store.getRootIds()).toEqual(["one"]);
    api.calls[1]?.respond(200, [page("two", "Two")]);
    await settle();
    expect(store.getRootIds()).toEqual(["two"]);
  });

  it("keeps what it shows when a refetch fails, and shows the error state only with nothing to show", async () => {
    const store = make();
    store.retain();
    store.invalidate();
    api.calls[0]?.fail();
    await settle();
    expect(store.getStatus()).toBe("ready");
    expect(store.getRootIds()).toEqual(["s", "team"]);

    const empty = new PageTreeStore({ spaceKey: "TEAM", canEdit: false, initial: { status: "error" }, fetchImpl: api.fetchImpl });
    expect(empty.getStatus()).toBe("error");
    void empty.refresh();
    expect(empty.getStatus()).toBe("loading");
    api.pending()[0]?.respond(200, []);
    await settle();
    expect(empty.getStatus()).toBe("ready");
  });

  it("goes back to the error state when a retry with nothing on screen fails too", async () => {
    const store = new PageTreeStore({ spaceKey: "TEAM", canEdit: false, initial: { status: "error" }, fetchImpl: api.fetchImpl });
    const retry = store.refresh();
    expect(store.getStatus()).toBe("loading");
    api.pending()[0]?.fail();
    await retry;
    expect(store.getStatus()).toBe("error");

    const unloaded = make({ pages: null });
    unloaded.retain();
    api.pending()[0]?.respond(500, problem(500, "INTERNAL"));
    await settle();
    expect(unloaded.getStatus()).toBe("error");
  });

  it("does not fetch on navigation while no tree is on screen, but does once one is", async () => {
    const store = make();
    store.navigated("h");
    expect(api.calls).toHaveLength(0);
    store.retain();
    expect(api.calls).toHaveLength(1);
  });

  it("emits nothing when a refetch changes nothing", async () => {
    const store = make();
    store.retain();
    const listener = vi.fn();
    store.subscribe(listener);
    store.invalidate();
    api.calls[0]?.respond(200, sampleTree());
    await settle();
    expect(listener).not.toHaveBeenCalled();
  });
});

/** The tree once the server has committed "Page Heading to the top of Team". */
const movedTree = (): PageSummary[] => [
  page("s", "Specifications", null, 0),
  page("team", "Team", null, 1),
  page("h", "Page Heading", "team", 0),
  page("t1", "Test session 1", "s", 0),
  page("t1a", "Test session 1a", "s", 1),
  page("n", "Notes", "t1a", 0),
  page("m", "Members", "team", 1),
];
const pendingGet = () => api.pending().find((c) => c.method === "GET");
const gets = () => api.calls.filter((c) => c.method === "GET").length;

/** Moves h to the top of Team and has the server confirm it; the post-move GET is left in flight. */
async function confirmedMove(store: PageTreeStore): Promise<void> {
  const done = store.move("h", { parentId: "team", index: 0 });
  await settle();
  api.pending().find((c) => c.method === "POST")?.respond(200, page("h", "Page Heading", "team", 0));
  expect(await done).toEqual({ ok: true });
}

describe("server renders (adopt): when they were rendered is unknown", () => {
  it("are shown while the store holds nothing it fetched or confirmed itself", () => {
    const store = make();
    store.adopt([page("rendered", "Rendered")]);
    expect(store.getRootIds()).toEqual(["rendered"]);
  });

  it("a cached render from before a confirmed move does not undo it (Back to the overview)", async () => {
    const store = make();
    store.retain();
    await confirmedMove(store);
    pendingGet()?.respond(200, movedTree());
    await settle();
    store.adopt(sampleTree()); // Next replays the overview's pre-move payload
    expect(childIds(store, "team")).toEqual(["h", "m"]);
    expect(childIds(store, "s")).toEqual(["t1", "t1a"]);
  });

  it("a server action's render that read the tree before the move committed does not undo it; the post-move GET still applies", async () => {
    const store = make();
    store.retain();
    await confirmedMove(store);
    const postMove = pendingGet();
    expect(postMove).toBeDefined();
    store.adopt(sampleTree()); // the star's re-render, read before the move committed, arrives now
    expect(childIds(store, "team")).toEqual(["h", "m"]);
    const fresh = movedTree().map((p) => (p.id === "m" ? { ...p, title: "Members (renamed elsewhere)" } : p));
    postMove?.respond(200, fresh);
    await settle();
    expect(childIds(store, "team")).toEqual(["h", "m"]);
    expect(store.getNode("m")?.title).toBe("Members (renamed elsewhere)");
  });

  it("a render that differs from the store's own tree is not taken on its word: a GET issued after it decides", async () => {
    const store = make();
    store.retain();
    await confirmedMove(store);
    pendingGet()?.respond(200, movedTree());
    await settle();
    const before = gets();
    store.adopt([...movedTree(), page("x", "Created elsewhere", null, 2)]);
    expect(store.getNode("x")).toBeUndefined();
    await settle();
    expect(gets()).toBe(before + 1);
    pendingGet()?.respond(200, [...movedTree(), page("x", "Created elsewhere", null, 2)]);
    await settle();
    expect(store.getRootIds()).toEqual(["s", "team", "x"]);
  });

  it("a render shown before the store has its own tree is checked too, so an older GET in flight cannot have the last word", async () => {
    const store = make();
    store.retain();
    store.invalidate(); // in flight before the render arrives
    const older = pendingGet();
    store.adopt([page("rendered", "Rendered")]);
    expect(store.getRootIds()).toEqual(["rendered"]);
    await settle();
    older?.respond(200, [page("older", "Older")]);
    await settle();
    pendingGet()?.respond(200, [page("newest", "Newest")]);
    await settle();
    expect(store.getRootIds()).toEqual(["newest"]);
  });

  it("asks once when a navigation refetches in the same turn, and not at all for the tree already shown", async () => {
    const store = make();
    store.retain();
    store.adopt(sampleTree()); // the overview's first load: the layout's very tree
    await settle();
    expect(api.calls).toHaveLength(0);

    await confirmedMove(store);
    pendingGet()?.respond(200, movedTree());
    await settle();
    const before = gets();
    store.adopt(sampleTree()); // Back to the overview: its effect runs before the provider's
    store.navigated(null);
    await settle();
    expect(gets()).toBe(before + 1);
  });
});

describe("the tree's own mutations outrank answers to requests issued before them", () => {
  it("a refetch issued while a move was in flight, answered after it was confirmed, does not undo it", async () => {
    const store = make();
    store.retain();
    const done = store.move("h", { parentId: "team", index: 0 });
    await settle();
    store.invalidate(); // a navigation or the tab shown again, mid-move
    const midMove = pendingGet();
    api.pending().find((c) => c.method === "POST")?.respond(200, page("h", "Page Heading", "team", 0));
    expect(await done).toEqual({ ok: true });
    midMove?.respond(200, sampleTree()); // read before the move committed
    await settle();
    expect(childIds(store, "team")).toEqual(["h", "m"]);
    expect(childIds(store, "s")).toEqual(["t1", "t1a"]);
  });

  it("a refetch issued while a create was in flight, answered after it, does not remove the new page", async () => {
    const store = make();
    store.retain();
    const done = store.createChild("h");
    await settle();
    store.invalidate();
    const midCreate = pendingGet();
    api.pending().find((c) => c.method === "POST")?.respond(201, page("new", "Untitled", "h", 0));
    expect(await done).toMatchObject({ ok: true });
    midCreate?.respond(200, sampleTree()); // read before the page existed
    await settle();
    expect(childIds(store, "h")).toEqual(["new"]);
  });
});

describe("the current page (10 §3.2)", () => {
  it("opens its ancestors, once, and again for each page navigated to", () => {
    const store = make({ currentId: "n" });
    expect(store.isExpanded("s") && store.isExpanded("t1a")).toBe(true);
    store.collapse("t1a");
    store.adopt([...sampleTree(), page("x", "X", "team", 1)]);
    expect(store.isExpanded("t1a")).toBe(false); // not re-opened by new data
    store.navigated("m");
    expect(store.isExpanded("team")).toBe(true);
  });

  it("opens the path when the current page arrives later", async () => {
    const store = make({ pages: null, currentId: "n" });
    store.retain();
    api.calls[0]?.respond(200, sampleTree());
    await settle();
    expect(store.isExpanded("t1a")).toBe(true);
  });
});

describe("moves (POST …/pages/{id}/move)", () => {
  it("shows the move at once, sends { parentId, index }, then refetches", async () => {
    const store = make();
    store.retain();
    const done = store.move("h", { parentId: "team", index: 0 });
    expect(childIds(store, "team")).toEqual(["h", "m"]);
    expect(childIds(store, "s")).toEqual(["t1", "t1a"]);
    await settle();
    expect(api.calls[0]).toMatchObject({ method: "POST", url: "/api/v1/spaces/TEAM/pages/h/move", body: { parentId: "team", index: 0 } });
    api.calls[0]?.respond(200, { ...page("h", "Page Heading", "team", 0) });
    expect(await done).toEqual({ ok: true });
    expect(childIds(store, "team")).toEqual(["h", "m"]);
    expect(api.calls[1]).toMatchObject({ method: "GET", url: "/api/v1/spaces/TEAM/pages" });
  });

  it("rolls back a refused move, reports the code, and refetches (rollback)", async () => {
    const store = make();
    store.retain();
    const done = store.move("t1", { parentId: "h", index: 0 });
    expect(childIds(store, "h")).toEqual(["t1"]);
    await settle();
    api.calls[0]?.respond(409, problem(409, "CYCLE"));
    expect(await done).toEqual({ ok: false, code: "CYCLE", cancelled: false });
    expect(childIds(store, "h")).toEqual([]);
    expect(childIds(store, "s")).toEqual(["h", "t1", "t1a"]);
    expect(api.calls[1]).toMatchObject({ method: "GET" });
  });

  it("rolls back on a network failure too", async () => {
    const store = make();
    const done = store.move("t1", { parentId: null, index: 0 });
    await settle();
    api.calls[0]?.fail();
    expect(await done).toMatchObject({ ok: false, code: "NETWORK" });
    expect(store.getRootIds()).toEqual(["s", "team"]);
  });

  it("does not let a refetch landing mid-flight undo the shown move", async () => {
    const store = make();
    store.retain();
    const done = store.move("h", { parentId: "team", index: 0 });
    await settle();
    store.invalidate();
    const refetch = api.pending().find((c) => c.method === "GET");
    refetch?.respond(200, sampleTree()); // the server has not applied the move yet
    await settle();
    expect(childIds(store, "team")).toEqual(["h", "m"]);
    api.pending().find((c) => c.method === "POST")?.respond(200, page("h", "Page Heading", "team", 0));
    await done;
    expect(childIds(store, "team")).toEqual(["h", "m"]);
  });

  it("sends moves one at a time; a refusal cancels the moves queued after it", async () => {
    const store = make();
    const first = store.move("t1", { parentId: null, index: 0 });
    const second = store.move("h", { parentId: null, index: 0 });
    expect(store.getRootIds()).toEqual(["h", "t1", "s", "team"]);
    await settle();
    expect(api.pending()).toHaveLength(1);
    api.pending()[0]?.respond(403, problem(403, "FORBIDDEN"));
    expect(await first).toMatchObject({ ok: false, code: "FORBIDDEN", cancelled: false });
    expect(await second).toMatchObject({ ok: false, cancelled: true });
    expect(store.getRootIds()).toEqual(["s", "team"]);
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("refuses to send anything for a viewer who cannot edit", async () => {
    const store = make({ canEdit: false });
    expect(await store.move("h", { parentId: null, index: 0 })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(api.calls).toHaveLength(0);
    expect(childIds(store, "s")).toEqual(["h", "t1", "t1a"]);
  });
});

describe("create a child (POST …/pages { parentId })", () => {
  it("sends one request per press, adds the page under its open parent and returns the editor URL", async () => {
    const store = make();
    const first = store.createChild("h");
    const second = store.createChild("h");
    expect(await second).toEqual({ ok: false, code: "BUSY", busy: true });
    expect(store.getCreatingParent()).toBe("h");
    await settle();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: "POST", url: "/api/v1/spaces/TEAM/pages", body: { parentId: "h" } });
    api.calls[0]?.respond(201, { ...page("new", "Untitled", "h", 0), spaceKey: "TEAM" });
    expect(await first).toEqual({ ok: true, page: page("new", "Untitled", "h", 0), href: "/spaces/TEAM/pages/new/edit" });
    expect(childIds(store, "h")).toEqual(["new"]);
    expect(store.isExpanded("h")).toBe(true);
    // Still locked until the browser navigates: a third click makes no second page.
    expect(await store.createChild("h")).toMatchObject({ busy: true });
    store.navigated("new");
    expect(store.isCreating()).toBe(false);
  });

  it("releases the lock after a while if no navigation happens", async () => {
    vi.useFakeTimers();
    const store = make();
    const done = store.createChild(null);
    await vi.advanceTimersByTimeAsync(0);
    api.calls[0]?.respond(201, page("new", "Untitled", null, 2));
    await done;
    expect(store.isCreating()).toBe(true);
    await vi.advanceTimersByTimeAsync(CREATE_LOCK_MS);
    expect(store.isCreating()).toBe(false);
  });

  it("unlocks and reports the code when the server refuses", async () => {
    const store = make();
    const done = store.createChild("h");
    await settle();
    api.calls[0]?.respond(422, problem(422, "VALIDATION"));
    expect(await done).toEqual({ ok: false, code: "VALIDATION", busy: false });
    expect(store.isCreating()).toBe(false);
  });

  it("creates nothing for a viewer who cannot edit", async () => {
    const store = make({ canEdit: false });
    expect(await store.createChild(null)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(api.calls).toHaveLength(0);
  });
});

describe("remembered expansion (localStorage)", () => {
  function memory(): StorageLike & { readonly data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  }

  it("merges what was remembered and remembers changes, per space", () => {
    const storage = memory();
    storage.data.set(expansionKey("TEAM"), JSON.stringify(["team"]));
    const store = make({ currentId: "h" });
    store.attachStorage(() => storage);
    expect(store.isExpanded("team") && store.isExpanded("s")).toBe(true);
    store.toggle("team");
    expect(JSON.parse(storage.data.get(expansionKey("TEAM")) ?? "[]")).toEqual(["s"]);
  });

  it("works the same when storage throws", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    const store = make();
    expect(() => store.attachStorage(() => broken)).not.toThrow();
    expect(() => store.toggle("s")).not.toThrow();
    expect(store.isExpanded("s")).toBe(true);
  });

  it("does not write before it has read (so the first render cannot wipe what was stored)", () => {
    const storage = memory();
    storage.data.set(expansionKey("TEAM"), JSON.stringify(["team"]));
    const store = make();
    store.toggle("s"); // before attachStorage
    expect(storage.data.get(expansionKey("TEAM"))).toBe(JSON.stringify(["team"]));
  });
});
