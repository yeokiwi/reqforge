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

  it("does not let a response issued before the server render it adopted overwrite it", async () => {
    const store = make();
    store.retain();
    store.invalidate();
    store.adopt([page("rendered", "Rendered")]);
    api.calls[0]?.respond(200, [page("older", "Older")]);
    await settle();
    expect(store.getRootIds()).toEqual(["rendered"]);
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
