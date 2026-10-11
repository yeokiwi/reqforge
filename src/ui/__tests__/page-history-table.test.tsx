// @vitest-environment jsdom
// Page History in the browser (10 section 23, RD-060): the table, the selection and the enabled
// state of "Compare selected versions" (exactly two, older first), Restore and Delete with their
// confirmations, every refusal's message, the double-submit guard and the pinned tooltip.
import { Profiler, type ProfilerOnRenderCallback } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import type { PageDetail, VersionSummary } from "@/domain/documents";
import { HistoryTable } from "@/app/spaces/[spaceKey]/(frame)/pages/[pageId]/history/_components/history-table";
import { buildHistoryRows } from "@/app/spaces/[spaceKey]/(frame)/pages/[pageId]/history/_lib/history-model";
import { CompareButton } from "@/ui/page-history/compare-button";
import { HistoryProvider } from "@/ui/page-history/history-context";
import { HistoryNoticeLine } from "@/ui/page-history/history-notice";
import { VersionCheckbox } from "@/ui/page-history/version-checkbox";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

type Call = { method: string; url: string };
let calls: Call[];
let respond: (call: Call) => Response | Promise<Response>;

const fetchImpl = (url: string, init?: RequestInit) => {
  const call = { method: init?.method ?? "GET", url };
  calls.push(call);
  return Promise.resolve(respond(call));
};

const noContent = () => new Response(null, { status: 204 });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const problem = (status: number, code: string) =>
  new Response(JSON.stringify({ type: "about:blank", title: code, status, detail: "", code }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });

const alice = { id: "u1", name: "Alice Admin" };
const v = (number: number, over: Partial<VersionSummary> = {}): VersionSummary => ({
  number,
  title: "Specifications",
  message: number === 1 ? null : `edit ${number}`,
  author: alice,
  createdAt: `2023-07-25T1${number}:00:00.000Z`,
  current: false,
  pinned: false,
  ...over,
});

const ADMIN: PageDetail["permissions"] = { canEdit: true, canAdmin: true };
const VERSIONS = [v(4, { current: true }), v(3), v(2, { message: 'Baseline "Baseline 3" for Reqforge', pinned: true }), v(1)];

function Screen({ versions = VERSIONS, permissions = ADMIN }: { versions?: VersionSummary[]; permissions?: PageDetail["permissions"] }) {
  const rows = buildHistoryRows("TEAM", "p-spec", versions, permissions);
  return (
    <HistoryProvider
      spaceKey="TEAM"
      pageId="p-spec"
      versions={rows.map((r) => r.number)}
      initialSelected={rows.filter((r) => r.current).map((r) => r.number)}
      fetchImpl={fetchImpl}
    >
      <CompareButton />
      <HistoryNoticeLine />
      <HistoryTable title="Specifications" rows={rows} />
    </HistoryProvider>
  );
}

beforeEach(() => {
  calls = [];
  respond = () => noContent();
  vi.clearAllMocks();
});
afterEach(cleanup);

const compareButton = () => screen.getByRole("button", { name: t("history.compare") });
const box = (n: number) => screen.getByRole("checkbox", { name: t("history.select", { n }) });
const descriptionOf = (el: HTMLElement) => document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent ?? "";
const alertText = () => screen.getAllByRole("alert").map((a) => a.textContent ?? "").join("");
const statusText = () => within(screen.getByTestId("history-notice")).getByRole("status").textContent ?? "";

describe("the table", () => {
  it("shows the video's columns and rows: CURRENT (v. N) first without actions, then v. N", () => {
    render(<Screen />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Select", "Version", "Published", "Changed By", "Comment", "Actions"]);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByRole("rowheader").textContent)).toEqual(["CURRENT (v. 4)", "v. 3", "v. 2", "v. 1"]);
    expect(within(rows[0] as HTMLElement).queryAllByRole("button")).toEqual([]);
    expect(within(rows[0] as HTMLElement).getByRole("link", { name: "CURRENT (v. 4)" })).toHaveAttribute("href", "/spaces/TEAM/pages/p-spec");
    expect(within(rows[1] as HTMLElement).getByRole("link", { name: "v. 3" })).toHaveAttribute("href", "/spaces/TEAM/pages/p-spec?version=3");
    expect(rows[2]).toHaveTextContent('Baseline "Baseline 3" for Reqforge');
    expect(rows[1]).toHaveTextContent("Jul 25, 2023 13:00");
    expect(rows[1]).toHaveTextContent("Alice Admin");
  });

  it("gives an admin Restore and Delete on every past version", () => {
    render(<Screen />);
    for (const n of [3, 2, 1]) {
      expect(screen.getByRole("button", { name: t("history.restore.label", { n }) })).toHaveTextContent("Restore");
      expect(screen.getByRole("button", { name: t("history.delete.label", { n }) })).toHaveTextContent("Delete");
    }
  });

  it("gives an editor Restore and no Delete, and a viewer neither", () => {
    render(<Screen permissions={{ canEdit: true, canAdmin: false }} />);
    expect(screen.getAllByRole("button", { name: /^Restore v\./ })).toHaveLength(3);
    expect(screen.queryAllByRole("button", { name: /^Delete v\./ })).toEqual([]);
    cleanup();
    render(<Screen permissions={{ canEdit: false, canAdmin: false }} />);
    expect(screen.queryAllByRole("button", { name: /^(Restore|Delete) v\./ })).toEqual([]);
  });

  it("disables a pinned version's Delete, with the tooltip saying it is pinned", () => {
    render(<Screen />);
    const pinnedDelete = screen.getByRole("button", { name: t("history.delete.label", { n: 2 }) });
    expect(pinnedDelete).toHaveAttribute("aria-disabled", "true");
    expect(pinnedDelete).toHaveAttribute("title", "Pinned by a baseline");
    expect(descriptionOf(pinnedDelete)).toBe("Pinned by a baseline");
    fireEvent.click(pinnedDelete);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: t("history.delete.label", { n: 3 }) })).not.toHaveAttribute("aria-disabled");
  });

  it("names the baseline in the tooltip once the API does", () => {
    render(<Screen versions={[v(2, { current: true }), v(1, { pinned: true, pinnedBy: [3] })]} />);
    expect(screen.getByRole("button", { name: t("history.delete.label", { n: 1 }) })).toHaveAttribute("title", "Pinned by baseline 3");
  });
});

describe("Compare selected versions", () => {
  it("starts with the current version ticked and is unavailable, saying why", () => {
    render(<Screen />);
    expect((box(4) as HTMLInputElement).checked).toBe(true);
    expect((box(3) as HTMLInputElement).checked).toBe(false);
    expect(compareButton()).toHaveAttribute("aria-disabled", "true");
    expect(descriptionOf(compareButton())).toBe("Select exactly two versions to compare. 1 selected.");
    fireEvent.click(compareButton());
    expect(router.push).not.toHaveBeenCalled();
  });

  it("opens the comparison with the older version as a when exactly two are ticked", () => {
    render(<Screen />);
    fireEvent.click(box(2));
    expect(compareButton()).not.toHaveAttribute("aria-disabled");
    expect(descriptionOf(compareButton())).toBe("Compares v. 2 with v. 4.");
    fireEvent.click(compareButton());
    expect(router.push).toHaveBeenCalledWith("/spaces/TEAM/pages/p-spec/history/compare?a=2&b=4");
  });

  it("orders a and b by version number, not by the order they were ticked", () => {
    render(<Screen />);
    fireEvent.click(box(4));
    fireEvent.click(box(3));
    fireEvent.click(box(1));
    fireEvent.click(compareButton());
    expect(router.push).toHaveBeenCalledWith("/spaces/TEAM/pages/p-spec/history/compare?a=1&b=3");
  });

  it("is unavailable again with three ticked, and with none", () => {
    render(<Screen />);
    fireEvent.click(box(3));
    fireEvent.click(box(1));
    expect(compareButton()).toHaveAttribute("aria-disabled", "true");
    expect(descriptionOf(compareButton())).toBe("Select exactly two versions to compare. 3 selected.");
    fireEvent.click(compareButton());
    for (const n of [4, 3, 1]) fireEvent.click(box(n));
    expect(descriptionOf(compareButton())).toBe("Select exactly two versions to compare. 0 selected.");
    fireEvent.click(compareButton());
    expect(router.push).not.toHaveBeenCalled();
  });

  it("forgets a ticked version that the refreshed list no longer has", () => {
    const { rerender } = render(<Screen />);
    fireEvent.click(box(3));
    fireEvent.click(box(1));
    expect(descriptionOf(compareButton())).toContain("3 selected");
    rerender(<Screen versions={[v(4, { current: true }), v(2, { pinned: true }), v(1)]} />);
    expect(descriptionOf(compareButton())).toBe("Compares v. 1 with v. 4.");
  });

  it("re-renders only the ticked box, not every row, in a long history", () => {
    const numbers = Array.from({ length: 300 }, (_, i) => 300 - i);
    const renders = new Map<string, number>();
    const onRender: ProfilerOnRenderCallback = (id) => renders.set(id, (renders.get(id) ?? 0) + 1);
    render(
      <HistoryProvider spaceKey="TEAM" pageId="p" versions={numbers} initialSelected={[300]} fetchImpl={fetchImpl}>
        <Profiler id="compare" onRender={onRender}>
          <CompareButton />
        </Profiler>
        {numbers.map((n) => (
          <Profiler key={n} id={`row-${n}`} onRender={onRender}>
            <VersionCheckbox version={n} />
          </Profiler>
        ))}
      </HistoryProvider>,
    );
    renders.clear();
    fireEvent.click(box(150));
    expect([...renders.keys()].sort()).toEqual(["compare", "row-150"]);
  });
});

describe("Restore", () => {
  it("asks first, and does nothing when cancelled", () => {
    render(<Screen />);
    fireEvent.click(screen.getByRole("button", { name: t("history.restore.label", { n: 3 }) }));
    const dialog = screen.getByRole("dialog", { name: "Restore v. 3?" });
    expect(descriptionOf(dialog)).toBe(t("history.restore.body", { n: 3 }));
    expect(descriptionOf(dialog)).toContain('"Restored from v. 3"');
    fireEvent.click(within(dialog).getByRole("button", { name: t("history.cancel") }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("restores on confirmation, then opens the page view and refreshes", async () => {
    respond = () => json({ page: {}, version: { number: 5 }, diagnostics: [] });
    render(<Screen />);
    fireEvent.click(screen.getByRole("button", { name: t("history.restore.label", { n: 3 }) }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("history.restore") }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/spaces/TEAM/pages/p-spec"));
    expect(router.refresh).toHaveBeenCalled();
    expect(calls).toEqual([{ method: "POST", url: "/api/v1/spaces/TEAM/pages/p-spec/versions/3/restore" }]);
  });

  it.each([
    ["FORBIDDEN", 403, "You can't restore versions of this page.", true],
    ["NOT_FOUND", 404, "v. 3 no longer exists. The page history has been refreshed.", true],
    ["TITLE_TAKEN", 409, "v. 3 can't be restored: another page in this space now has its title.", false],
    ["UNAUTHENTICATED", 401, "You've been signed out. Sign in again in another tab, then try again.", false],
    ["INTERNAL", 500, "Couldn't restore v. 3. Try again.", false],
  ] as const)("says why when the server answers %s", async (code, status, message, refreshes) => {
    respond = () => problem(status, code);
    render(<Screen />);
    fireEvent.click(screen.getByRole("button", { name: t("history.restore.label", { n: 3 }) }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("history.restore") }));
    await waitFor(() => expect(alertText()).toContain(message));
    expect(router.push).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalledTimes(refreshes ? 1 : 0);
    // The slot is free again: Restore can be tried once more.
    expect(screen.getByRole("button", { name: t("history.restore.label", { n: 3 }) })).not.toHaveAttribute("aria-disabled");
  });

  it("says so when the network fails", async () => {
    respond = () => Promise.reject(new TypeError("Failed to fetch"));
    render(<Screen />);
    fireEvent.click(screen.getByRole("button", { name: t("history.restore.label", { n: 1 }) }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("history.restore") }));
    await waitFor(() => expect(alertText()).toContain("Couldn't restore v. 1. Try again."));
    fireEvent.click(screen.getByRole("button", { name: t("history.dismiss") }));
    expect(alertText()).toBe("");
  });

  it("sends one request however fast the confirmation is pressed, and blocks other actions meanwhile", async () => {
    let finish: (r: Response) => void = () => undefined;
    respond = () => new Promise<Response>((resolve) => (finish = resolve));
    render(<Screen />);
    fireEvent.click(screen.getByRole("button", { name: t("history.restore.label", { n: 3 }) }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: t("history.restore") });
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(calls).toHaveLength(1);
    expect(statusText()).toBe("Restoring v. 3…");

    const otherRestore = screen.getByRole("button", { name: t("history.restore.label", { n: 1 }) });
    const otherDelete = screen.getByRole("button", { name: t("history.delete.label", { n: 1 }) });
    expect(otherRestore).toHaveAttribute("aria-disabled", "true");
    expect(otherDelete).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(otherRestore);
    fireEvent.click(otherDelete);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls).toHaveLength(1);

    await act(async () => finish(json({ page: {}, version: { number: 5 }, diagnostics: [] })));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
  });
});

describe("Delete", () => {
  it("asks first, saying it is permanent", () => {
    render(<Screen />);
    fireEvent.click(screen.getByRole("button", { name: t("history.delete.label", { n: 3 }) }));
    const dialog = screen.getByRole("dialog", { name: "Delete v. 3?" });
    expect(descriptionOf(dialog)).toBe("v. 3 will be removed from the page history for everyone. This can't be undone.");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("deletes on confirmation, drops the version from the selection, says so and refreshes", async () => {
    render(<Screen />);
    fireEvent.click(box(3));
    expect(compareButton()).not.toHaveAttribute("aria-disabled");
    fireEvent.click(screen.getByRole("button", { name: t("history.delete.label", { n: 3 }) }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("history.delete") }));
    await waitFor(() => expect(statusText()).toBe("v. 3 was deleted."));
    expect(calls).toEqual([{ method: "DELETE", url: "/api/v1/spaces/TEAM/pages/p-spec/versions/3" }]);
    expect((box(3) as HTMLInputElement).checked).toBe(false);
    expect(compareButton()).toHaveAttribute("aria-disabled", "true");
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByTestId("history-notice"));
  });

  it.each([
    ["PINNED_VERSION", 409, "v. 3 is pinned by a baseline, so it can't be deleted.", true, false],
    ["CURRENT_VERSION", 409, "v. 3 is the current version, so it can't be deleted.", true, false],
    ["FORBIDDEN", 403, "You can't delete versions of this page.", true, false],
    ["NOT_FOUND", 404, "v. 3 no longer exists. The page history has been refreshed.", true, true],
    ["ORIGIN_MISMATCH", 403, "Couldn't delete v. 3. Try again.", false, false],
    ["INTERNAL", 500, "Couldn't delete v. 3. Try again.", false, false],
  ] as const)("says why when the server answers %s", async (code, status, message, refreshes, drops) => {
    respond = () => problem(status, code);
    render(<Screen />);
    fireEvent.click(box(3));
    fireEvent.click(screen.getByRole("button", { name: t("history.delete.label", { n: 3 }) }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("history.delete") }));
    await waitFor(() => expect(alertText()).toContain(message));
    expect(router.refresh).toHaveBeenCalledTimes(refreshes ? 1 : 0);
    expect((box(3) as HTMLInputElement).checked).toBe(!drops);
    expect(statusText()).toBe("");
  });
});
