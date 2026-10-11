// @vitest-environment jsdom
// The top bar's `Create` (10 §2, RD-052, RD-056): inside a space the viewer can edit it makes an
// `Untitled` page at once (POST with no body) and opens the editor on it; elsewhere it is the
// `Choose a space` picker, and picking a space does the same there. One page per press, however
// fast the presses; a refusal is an alert with a copy-deck string chosen by the problem's code.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import { ApiError } from "@/ui/api-client";
import { CreatePageButton, type CreatePageButtonProps, createFailureMessage, editHrefOf } from "@/ui/create-page-button";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

type Call = { method: string; url: string; body: BodyInit | null | undefined; headers: Record<string, string> };
let calls: Call[];
let respond: (call: Call) => Response | Promise<Response>;

const fetchImpl = (url: string, init?: RequestInit) => {
  const call: Call = {
    method: init?.method ?? "GET",
    url,
    body: init?.body,
    headers: { ...(init?.headers as Record<string, string> | undefined) },
  };
  calls.push(call);
  return Promise.resolve(respond(call));
};

const created = (spaceKey: string, id: string) =>
  new Response(JSON.stringify({ id, spaceKey, title: "Untitled" }), { status: 201, headers: { "Content-Type": "application/json" } });
const problem = (status: number, code: string) =>
  new Response(JSON.stringify({ type: "about:blank", title: code, status, detail: "", code }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });

beforeEach(() => {
  calls = [];
  respond = () => created("TEAM", "p-new");
  vi.clearAllMocks();
});
afterEach(cleanup);

function renderButton(over: Partial<CreatePageButtonProps> = {}) {
  return render(
    <CreatePageButton
      spaceKey="TEAM"
      creatableSpaces={[
        { key: "PLAT", name: "Platform" },
        { key: "TEAM", name: "Team" },
      ]}
      fetchImpl={fetchImpl}
      {...over}
    />,
  );
}

const createButton = () => screen.getByRole("button", { name: t("shell.create") });

describe("Create inside a space the viewer can edit (RD-056)", () => {
  it("POSTs to the space's pages with no body, then opens the editor on the new page", async () => {
    renderButton();
    fireEvent.click(createButton());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/spaces/TEAM/pages/p-new/edit"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/v1/spaces/TEAM/pages" });
    expect(calls[0]?.body).toBeUndefined();
    expect(calls[0]?.headers["Content-Type"]).toBeUndefined();
  });

  it("navigates with the key and id the server answered, percent-encoded", async () => {
    respond = () => created("TEAM", "a/b");
    renderButton({ spaceKey: "team" });
    fireEvent.click(createButton());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/spaces/TEAM/pages/a%2Fb/edit"));
    expect(calls[0]?.url).toBe("/api/v1/spaces/team/pages");
  });

  it("makes one page on a double click, and stays disabled until the editor replaces the screen", async () => {
    let release: () => void = () => undefined;
    respond = () => new Promise<Response>((resolve) => (release = () => resolve(created("TEAM", "p-new"))));
    renderButton();
    const button = createButton();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-busy", "true");
    await act(async () => release());
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    fireEvent.click(button);
    expect(calls).toHaveLength(1);
    expect(button).toHaveAttribute("aria-disabled", "true");
  });

  it.each([
    ["FORBIDDEN", 403, "create.failed.forbidden"],
    ["NOT_FOUND", 404, "create.failed.notFound"],
    ["INTERNAL", 500, "create.failed"],
    ["UNAUTHENTICATED", 401, "create.failed"],
  ] as const)("a %s refusal shows an alert, navigates nowhere, and can be tried again", async (code, status, message) => {
    respond = () => problem(status, code);
    renderButton();
    fireEvent.click(createButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(t(message));
    expect(router.push).not.toHaveBeenCalled();
    expect(createButton()).not.toHaveAttribute("aria-disabled");

    respond = () => created("TEAM", "p2");
    fireEvent.click(createButton());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/spaces/TEAM/pages/p2/edit"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a network failure is the generic alert", async () => {
    renderButton({ fetchImpl: () => Promise.reject(new TypeError("Failed to fetch")) });
    fireEvent.click(createButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(t("create.failed"));
  });

  it("an answer that is not a page is the generic alert, not a navigation to nowhere", async () => {
    respond = () => new Response(JSON.stringify({ ok: true }), { status: 201, headers: { "Content-Type": "application/json" } });
    renderButton();
    fireEvent.click(createButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(t("create.failed"));
    expect(router.push).not.toHaveBeenCalled();
  });

  it("the alert can be dismissed", async () => {
    respond = () => problem(403, "FORBIDDEN");
    renderButton();
    fireEvent.click(createButton());
    const alert = await screen.findByRole("alert");
    fireEvent.click(within(alert).getByRole("button", { name: t("create.dismiss") }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Create outside a space: the picker (RD-052), which now creates in the picked space", () => {
  it("lists the spaces the viewer can edit, under `Choose a space`", () => {
    renderButton({ spaceKey: null });
    fireEvent.click(createButton());
    const menu = screen.getByRole("menu", { name: t("shell.create") });
    expect(menu).toHaveTextContent(t("shell.create.pickSpace"));
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Platform", "Team"]);
    expect(calls).toEqual([]);
  });

  it("picking a space closes the menu, creates the page there and opens the editor", async () => {
    respond = () => created("PLAT", "p9");
    renderButton({ spaceKey: null });
    fireEvent.click(createButton());
    fireEvent.click(screen.getByRole("menuitem", { name: "Platform" }));
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/spaces/PLAT/pages/p9/edit"));
    expect(calls).toEqual([expect.objectContaining({ method: "POST", url: "/api/v1/spaces/PLAT/pages" })]);
    expect(document.activeElement).toBe(createButton());
  });

  it("a second pick while the first is in flight sends nothing", async () => {
    let release: () => void = () => undefined;
    respond = () => new Promise<Response>((resolve) => (release = () => resolve(created("PLAT", "p9"))));
    renderButton({ spaceKey: null });
    fireEvent.click(createButton());
    fireEvent.click(screen.getByRole("menuitem", { name: "Platform" }));
    fireEvent.click(createButton());
    const team = screen.getByRole("menuitem", { name: "Team" });
    expect(team).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(team);
    expect(calls).toHaveLength(1);
    await act(async () => release());
  });

  it("is keyboard-operable: ArrowDown opens on the first space, Escape returns to the button", () => {
    renderButton({ spaceKey: null });
    const button = createButton();
    fireEvent.keyDown(button, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Platform");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(document.activeElement).toBe(button);
  });

  it("with no space to create in, says so and sends nothing", () => {
    renderButton({ spaceKey: null, creatableSpaces: [] });
    fireEvent.click(createButton());
    const item = screen.getByRole("menuitem", { name: t("shell.create.noSpace") });
    expect(item).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item);
    expect(calls).toEqual([]);
  });

  it("a refusal in the picked space is an alert", async () => {
    respond = () => problem(404, "NOT_FOUND");
    renderButton({ spaceKey: null });
    fireEvent.click(createButton());
    fireEvent.click(screen.getByRole("menuitem", { name: "Team" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("create.failed.notFound"));
  });
});

describe("createFailureMessage and editHrefOf", () => {
  it("maps the problem's code to a deck string", () => {
    expect(createFailureMessage(new ApiError("FORBIDDEN", 403))).toBe("create.failed.forbidden");
    expect(createFailureMessage(new ApiError("NOT_FOUND", 404))).toBe("create.failed.notFound");
    expect(createFailureMessage(new ApiError("VALIDATION", 422))).toBe("create.failed");
    expect(createFailureMessage(new Error("boom"))).toBe("create.failed");
    expect(createFailureMessage("FORBIDDEN")).toBe("create.failed");
  });

  it("is the new page's editor URL, or null for an answer that is not a page", () => {
    expect(editHrefOf({ id: "p1", spaceKey: "TEAM" })).toBe("/spaces/TEAM/pages/p1/edit");
    expect(editHrefOf({ id: "", spaceKey: "TEAM" })).toBeNull();
    expect(editHrefOf({ id: "p1" })).toBeNull();
    expect(editHrefOf({ id: 1, spaceKey: "TEAM" })).toBeNull();
    expect(editHrefOf(null)).toBeNull();
    expect(editHrefOf("p1")).toBeNull();
  });
});
