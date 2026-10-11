// @vitest-environment jsdom
// The page editor (10 §5.1, RD-055) rendered in jsdom with a real TipTap editor and a mocked
// fetch: the footer's initial state, toolbar row 2 appearing only inside a table, the bodies
// Update and autosave send, the conflict banner's two ways out, Close keeping the draft, Revert
// asking first, presence avatars. Typing is done through the editor's own commands (jsdom has
// no text input); layout-dependent behaviour (column dragging, scroll, real focus rings) is for
// the end-to-end suite.
import type { Editor } from "@tiptap/core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageEditor, type PageEditorProps } from "../page-editor";
import { doc, p, posOf, stubLayout, table, text } from "./editor-harness";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const PAGE_URL = "/api/v1/spaces/TEAM/pages/p1";
const DRAFT_URL = `${PAGE_URL}/draft`;
const PRESENCE_URL = `${PAGE_URL}/presence`;

const PROPS: PageEditorProps = {
  space: { key: "TEAM", name: "Team" },
  page: { id: "p1", title: "Specifications", ancestors: [{ id: "p0", title: "Product" }], restricted: false },
  initial: { title: "Specifications", content: doc(p(text("Hello world"))), baseVersion: 3, fromDraft: false },
  me: { id: "u1", name: "Alice Admin" },
  viewHref: "/spaces/TEAM/pages/p1",
  historyHref: "/spaces/TEAM/pages/p1/history",
};

interface Call {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

type Handler = (call: Call) => Response | Promise<Response>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function problem(status: number, code: string, extras: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ type: "about:blank", title: code, status, detail: "", code, ...extras }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

const USER = { id: "u1", name: "Alice Admin" };
const PAGE_DETAIL = {
  id: "p1",
  title: "Specifications",
  parentId: "p0",
  ordinal: 0,
  currentVersion: 7,
  lastModifiedAt: "t",
  spaceKey: "TEAM",
  ancestors: [{ id: "p0", title: "Product" }],
  createdBy: USER,
  createdAt: "t",
  lastModifiedBy: USER,
  descendantCount: 0,
  watching: true,
  favourite: false,
  hasDraft: false,
  permissions: { canEdit: true, canAdmin: false },
};
const VERSION = { number: 4, title: "Specifications", message: null, author: USER, createdAt: "t", current: true, pinned: false };
const LATEST = {
  page: PAGE_DETAIL,
  version: { ...VERSION, number: 7, title: "Specifications (theirs)", content: doc(p(text("Their version"))) },
};

let calls: Call[];
let handlers: Record<string, Handler>;

function route(method: string, url: string, handler: Handler): void {
  handlers[`${method} ${url}`] = handler;
}

function callsTo(method: string, url: string): Call[] {
  return calls.filter((c) => c.method === method && c.url === url);
}

beforeEach(() => {
  stubLayout();
  calls = [];
  handlers = {};
  route("POST", PRESENCE_URL, () => json(200, { others: [] }));
  route("PUT", DRAFT_URL, () => json(200, { savedAt: "t", stale: false, currentVersion: 3 }));
  route("PUT", PAGE_URL, () => json(200, { page: PAGE_DETAIL, version: VERSION, diagnostics: [] }));
  route("GET", PAGE_URL, () => json(200, LATEST));
  route("DELETE", DRAFT_URL, () => new Response(null, { status: 204 }));
  route("GET", DRAFT_URL, () => json(200, { draft: null }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      const call = { method, url: input, body };
      calls.push(call);
      const handler = handlers[`${method} ${input}`];
      if (!handler) throw new TypeError(`unexpected ${method} ${input}`);
      return handler(call);
    }),
  );
  router.push.mockClear();
  router.refresh.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function mount(props: Partial<PageEditorProps> = {}): Promise<Editor> {
  render(<PageEditor {...PROPS} {...props} />);
  let editor: Editor | undefined;
  await waitFor(() => {
    const dom = document.querySelector(".ProseMirror") as (HTMLElement & { editor?: Editor }) | null;
    editor = dom?.editor;
    expect(editor).toBeDefined();
  });
  if (!editor) throw new Error("no editor");
  return editor;
}

/** The accessible name an aria-labelledby reference list gives. */
function labelledBy(element: Element): string {
  return (element.getAttribute("aria-labelledby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

const saveState = () => screen.getByTestId("save-state").textContent;
const updateButton = () => screen.getByRole("button", { name: "Update" });

/** Ctrl+S: the autosave flush, without waiting for the debounce. */
async function pressSave(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
  });
}

async function edit(editor: Editor, value: string): Promise<void> {
  await act(async () => {
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, value);
  });
}

describe("layout and initial state (10 §5.1)", () => {
  it("opens at Ready to go, with the title, Notify watchers checked and Update enabled", async () => {
    await mount();
    expect(saveState()).toBe("Ready to go");
    expect(screen.getByRole("textbox", { name: "Page title" })).toHaveValue("Specifications");
    expect((screen.getByRole("checkbox", { name: "Notify watchers" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("textbox", { name: "What did you change?" })).toHaveValue("");
    await waitFor(() => expect((updateButton() as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy();
  });

  it("shows the content in .rf-content.rf-editor as an accessible multi-line text box", async () => {
    const editor = await mount();
    expect(editor.getText()).toBe("Hello world");
    const wrapper = document.querySelector(".rf-content.rf-editor");
    expect(wrapper?.contains(editor.view.dom)).toBe(true);
    expect(editor.view.dom).toHaveAttribute("role", "textbox");
    expect(editor.view.dom).toHaveAttribute("aria-label", "Page content");
    expect(editor.view.dom).toHaveAttribute("aria-multiline", "true");
  });

  it("draws the breadcrumb <space> / Pages / <ancestors> / <title> with the label and restriction slots", async () => {
    await mount({ page: { ...PROPS.page, restricted: true } });
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getAllByRole("listitem").map((li) => li.textContent?.replace("/", "").trim())).toEqual([
      "Team",
      "Pages",
      "Product",
      "Specifications",
    ]);
    expect(within(nav).getByRole("link", { name: "Team" })).toHaveAttribute("href", "/spaces/TEAM");
    expect(within(nav).getByRole("link", { name: "Product" })).toHaveAttribute("href", "/spaces/TEAM/pages/p0");
    expect((screen.getByRole("button", { name: "Labels" }) as HTMLButtonElement).disabled).toBe(true);
    const lock = screen.getByRole("button", { name: "Restrictions" }) as HTMLButtonElement;
    expect(lock.disabled).toBe(true);
    expect(lock).toHaveAttribute("data-restricted", "true");
  });

  it("toolbar row 1 is a named toolbar in the drawn order, one tab stop, with arrow-key roving", async () => {
    await mount();
    const toolbar = screen.getByRole("toolbar", { name: "Editor toolbar" });
    const names = within(toolbar)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? labelledBy(b));
    expect(names).toEqual([
      "Text style Paragraph", // Paragraph ▾: named by aria-labelledby, so the visible value is in the name
      "Bold",
      "Italic",
      "Underline",
      "Text colour",
      "More formatting",
      "Bullet list",
      "Numbered list",
      "Task list",
      "Outdent",
      "Indent",
      "Align left",
      "Align right",
      "Align centre",
      "Info panel",
      "Files and images",
      "Link",
      "Insert table",
      "Emoji",
      "Insert more content",
      "Undo",
      "Redo",
      "Find and replace",
      "Keyboard shortcuts",
    ]);
    expect(within(toolbar).getByRole("button", { name: "Text style Paragraph" })).toBeTruthy();
    await waitFor(() => expect(toolbar.querySelectorAll('[tabindex="0"]')).toHaveLength(1));
    const bold = within(toolbar).getByRole("button", { name: "Bold" });
    bold.focus();
    fireEvent.keyDown(bold, { key: "ArrowRight" });
    expect(document.activeElement).toBe(within(toolbar).getByRole("button", { name: "Italic" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(document.activeElement).toBe(within(toolbar).getByRole("button", { name: "Keyboard shortcuts" }));
    expect(toolbar.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it("toggles carry aria-pressed that follows the selection", async () => {
    const editor = await mount();
    const bold = screen.getByRole("button", { name: "Bold" });
    expect(bold).toHaveAttribute("aria-pressed", "false");
    await act(async () => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });
    fireEvent.click(bold);
    await waitFor(() => expect(bold).toHaveAttribute("aria-pressed", "true"));
    expect(JSON.stringify(editor.getJSON())).toContain('"bold"');
  });

  it("the controls pass 2 wired are live: 🖼, + ▾, 🔍 and ?", async () => {
    await mount();
    await waitFor(() => expect(screen.getByRole("button", { name: "Insert more content" }).getAttribute("aria-disabled")).toBeNull());
    for (const name of ["Files and images", "Insert more content", "Find and replace", "Keyboard shortcuts"]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-disabled")).toBeNull();
    }
    expect(screen.queryByTestId("slot-files")).toBeNull();
    expect(screen.queryByTestId("slot-insert-more")).toBeNull();
    expect(screen.queryByTestId("slot-find")).toBeNull();
    expect(screen.queryByTestId("slot-help")).toBeNull();
  });
});

describe("toolbar row 2 (only while the selection is in a table)", () => {
  it("is absent outside a table, appears inside one, and goes when the selection leaves", async () => {
    const editor = await mount({ initial: { ...PROPS.initial, content: doc(p(text("Before")), table()) } });
    expect(screen.queryByRole("toolbar", { name: "Table tools" })).toBeNull();
    await act(async () => {
      editor.commands.setTextSelection(posOf(editor, "A"));
    });
    const row2 = await screen.findByRole("toolbar", { name: "Table tools" });
    expect(within(row2).getByRole("button", { name: "Table width Responsive" })).toBeTruthy();
    for (const name of [
      "Insert row above",
      "Insert row below",
      "Delete row",
      "Insert column before",
      "Insert column after",
      "Delete column",
      "Merge cells",
      "Split cell",
      "Header row",
      "Header column",
      "Numbered column",
      "Cell background",
      "Delete table",
    ]) {
      expect(within(row2).getByRole("button", { name })).toBeTruthy();
    }
    expect(within(row2).getByRole("button", { name: "Header row" })).toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      editor.commands.setTextSelection(posOf(editor, "Before"));
    });
    await waitFor(() => expect(screen.queryByRole("toolbar", { name: "Table tools" })).toBeNull());
  });

  it("the numbered-column toggle sets the attribute and the table view draws the gutter", async () => {
    const editor = await mount({ initial: { ...PROPS.initial, content: doc(table()) } });
    await act(async () => {
      editor.commands.setTextSelection(posOf(editor, "A"));
    });
    const toggle = await screen.findByRole("button", { name: "Numbered column" });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));
    expect(editor.getJSON().content?.[0]?.attrs?.numberedColumn).toBe(true);
    const tableEl = document.querySelector(".rf-editor table");
    expect(tableEl?.className).toContain("rf-table--numbered");
    expect(tableEl?.querySelector("col.rf-table__number-col")).not.toBeNull();
  });

  it("the width-mode menu offers Responsive and Fixed width and sets the mode", async () => {
    const editor = await mount({ initial: { ...PROPS.initial, content: doc(table()) } });
    await act(async () => {
      editor.commands.setTextSelection(posOf(editor, "A"));
    });
    fireEvent.click(await screen.findByRole("button", { name: "Table width Responsive" }));
    const menu = screen.getByRole("menu", { name: "Table width" });
    expect(within(menu).getAllByRole("menuitemradio").map((i) => [i.textContent, i.getAttribute("aria-checked")])).toEqual([
      ["Responsive", "true"],
      ["Fixed width", "false"],
    ]);
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Fixed width" }));
    await waitFor(() => expect(editor.getJSON().content?.[0]?.attrs?.widthMode).toBe("fixed"));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(await screen.findByRole("button", { name: "Table width Fixed width" })).toBeTruthy();
  });
});

describe("autosave (RD-055)", () => {
  it("an edit moves to Saving changes; the draft PUT carries title, content and base version; then Changes saved", async () => {
    const editor = await mount();
    await edit(editor, "!");
    expect(saveState()).toBe("Saving changes");
    fireEvent.change(screen.getByRole("textbox", { name: "Page title" }), { target: { value: "Renamed" } });
    await pressSave();
    await waitFor(() => expect(saveState()).toBe("Changes saved"));
    const put = callsTo("PUT", DRAFT_URL);
    expect(put).toHaveLength(1);
    expect(put[0]?.body).toEqual({ title: "Renamed", content: editor.getJSON(), baseVersion: 3 });
  });

  it("a failed save keeps Saving changes and shows the error line separately", async () => {
    route("PUT", DRAFT_URL, () => problem(422, "VALIDATION", { errors: [{ path: "content", message: "bad" }] }));
    const editor = await mount();
    await edit(editor, "!");
    await pressSave();
    const errors = await screen.findByTestId("editor-errors");
    expect(errors.textContent).toBe("Your changes can't be saved because some of the content isn't valid.");
    expect(saveState()).toBe("Saving changes");
  });

  it("a draft save answering stale raises the conflict banner", async () => {
    route("PUT", DRAFT_URL, () => json(200, { savedAt: "t", stale: true, currentVersion: 6 }));
    const editor = await mount();
    await edit(editor, "!");
    await pressSave();
    const banner = await screen.findByTestId("conflict-banner");
    expect(banner.textContent).toContain("Someone published version 6 of this page while you were editing.");
    expect(within(banner).getByRole("button", { name: "Overwrite" })).toBeTruthy();
    expect(within(banner).getByRole("button", { name: "Reload latest" })).toBeTruthy();
  });

  it("reopening a stale draft raises the banner at once", async () => {
    route("GET", DRAFT_URL, () =>
      json(200, { draft: { title: "x", content: doc(p()), baseVersion: 3, updatedAt: "t", stale: true, currentVersion: 5 } }),
    );
    await mount({ initial: { ...PROPS.initial, fromDraft: true } });
    expect((await screen.findByTestId("conflict-banner")).textContent).toContain("version 5");
  });
});

describe("Update (RD-055)", () => {
  it("posts the PublishRequest from the editor state and returns to the page view", async () => {
    const editor = await mount();
    await edit(editor, " again");
    fireEvent.change(screen.getByRole("textbox", { name: "Page title" }), { target: { value: "  New title " } });
    fireEvent.change(screen.getByRole("textbox", { name: "What did you change?" }), { target: { value: "Fixed typos" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Notify watchers" }));
    fireEvent.click(updateButton());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/spaces/TEAM/pages/p1"));
    expect(router.refresh).toHaveBeenCalled();
    const publish = callsTo("PUT", PAGE_URL);
    expect(publish).toHaveLength(1);
    expect(publish[0]?.body).toEqual({
      title: "New title",
      content: editor.getJSON(),
      baseVersion: 3,
      message: "Fixed typos",
      notifyWatchers: false,
    });
    expect(editor.getText()).toBe("Hello world again");
    // The publish does not depend on the draft: no draft save had to happen first.
    expect(callsTo("PUT", DRAFT_URL)).toHaveLength(0);
  });

  it("is disabled while the publish is in flight, and the editor cannot be changed meanwhile", async () => {
    let finish: (response: Response) => void = () => undefined;
    route("PUT", PAGE_URL, () => new Promise<Response>((resolve) => (finish = resolve)));
    const editor = await mount();
    fireEvent.click(updateButton());
    await waitFor(() => expect((updateButton() as HTMLButtonElement).disabled).toBe(true));
    expect(editor.isEditable).toBe(false);
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(updateButton());
    await act(async () => {
      finish(json(200, { page: PAGE_DETAIL, version: VERSION, diagnostics: [] }));
    });
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(callsTo("PUT", PAGE_URL)).toHaveLength(1);
  });

  it("an empty title is refused before anything is sent, with the message under the title", async () => {
    await mount();
    fireEvent.change(screen.getByRole("textbox", { name: "Page title" }), { target: { value: "   " } });
    fireEvent.click(updateButton());
    expect(await screen.findByText("Give this page a title before you publish it.")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Page title" })).toHaveAttribute("aria-invalid", "true");
    expect(callsTo("PUT", PAGE_URL)).toHaveLength(0);
    fireEvent.change(screen.getByRole("textbox", { name: "Page title" }), { target: { value: "Fixed" } });
    await waitFor(() => expect(screen.queryByText("Give this page a title before you publish it.")).toBeNull());
  });

  it("TITLE_TAKEN shows under the title and Update can be pressed again", async () => {
    route("PUT", PAGE_URL, () => problem(409, "TITLE_TAKEN"));
    await mount();
    fireEvent.click(updateButton());
    expect(await screen.findByText("Another page in this space already has this title.")).toBeTruthy();
    expect((updateButton() as HTMLButtonElement).disabled).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("other failures show in the footer and editing resumes", async () => {
    route("PUT", PAGE_URL, () => problem(500, "INTERNAL"));
    const editor = await mount();
    fireEvent.click(updateButton());
    expect((await screen.findByTestId("editor-errors")).textContent).toBe("Couldn't publish this page. Try again.");
    await waitFor(() => expect(editor.isEditable).toBe(true));
  });
});

describe("conflicts: Overwrite and Reload latest (RD-055)", () => {
  it("VERSION_CONFLICT raises the banner; Overwrite publishes again with overwrite: true", async () => {
    let attempt = 0;
    route("PUT", PAGE_URL, () => {
      attempt += 1;
      return attempt === 1 ? problem(409, "VERSION_CONFLICT", { currentVersion: 7 }) : json(200, { page: PAGE_DETAIL, version: VERSION, diagnostics: [] });
    });
    await mount();
    fireEvent.change(screen.getByRole("textbox", { name: "What did you change?" }), { target: { value: "mine" } });
    fireEvent.click(updateButton());
    const banner = await screen.findByTestId("conflict-banner");
    expect(banner.textContent).toContain("Someone published version 7 of this page while you were editing.");
    expect(router.push).not.toHaveBeenCalled();
    fireEvent.click(within(banner).getByRole("button", { name: "Overwrite" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/spaces/TEAM/pages/p1"));
    const publishes = callsTo("PUT", PAGE_URL);
    expect(publishes.map((c) => (c.body as { overwrite?: boolean }).overwrite)).toEqual([undefined, true]);
    expect(publishes[1]?.body).toMatchObject({ baseVersion: 3, message: "mine", notifyWatchers: true, title: "Specifications" });
  });

  it("Reload latest discards the draft and loads the current version into the editor", async () => {
    route("PUT", PAGE_URL, () => problem(409, "VERSION_CONFLICT", { currentVersion: 7 }));
    const editor = await mount();
    await edit(editor, " mine");
    fireEvent.click(updateButton());
    const banner = await screen.findByTestId("conflict-banner");
    fireEvent.click(within(banner).getByRole("button", { name: "Reload latest" }));
    await waitFor(() => expect(screen.queryByTestId("conflict-banner")).toBeNull());
    expect(callsTo("GET", PAGE_URL)).toHaveLength(1);
    expect(callsTo("DELETE", DRAFT_URL)).toHaveLength(1);
    expect(editor.getText()).toBe("Their version");
    expect(screen.getByRole("textbox", { name: "Page title" })).toHaveValue("Specifications (theirs)");
    expect(saveState()).toBe("Ready to go");
    expect(editor.can().undo()).toBe(false);
    // The next publish starts from the version just loaded.
    route("PUT", PAGE_URL, () => json(200, { page: PAGE_DETAIL, version: VERSION, diagnostics: [] }));
    fireEvent.click(updateButton());
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(callsTo("PUT", PAGE_URL).at(-1)?.body).toMatchObject({ baseVersion: 7, title: "Specifications (theirs)" });
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("a failed reload keeps the editor and the draft as they were and says so", async () => {
    route("PUT", PAGE_URL, () => problem(409, "VERSION_CONFLICT", { currentVersion: 7 }));
    route("GET", PAGE_URL, () => problem(500, "INTERNAL"));
    const editor = await mount();
    fireEvent.click(updateButton());
    fireEvent.click(within(await screen.findByTestId("conflict-banner")).getByRole("button", { name: "Reload latest" }));
    expect((await screen.findByTestId("editor-errors")).textContent).toBe("Couldn't load the latest version. Try again.");
    expect(callsTo("DELETE", DRAFT_URL)).toHaveLength(0);
    expect(editor.getText()).toBe("Hello world");
    expect(screen.getByTestId("conflict-banner")).toBeTruthy();
  });
});

describe("Close and ··· (RD-055)", () => {
  it("Close returns to the page view and never deletes the draft", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/spaces/TEAM/pages/p1"));
    expect(callsTo("DELETE", DRAFT_URL)).toHaveLength(0);
    expect(callsTo("PUT", PAGE_URL)).toHaveLength(0);
  });

  it("Close saves a pending change as the draft first", async () => {
    const editor = await mount();
    await edit(editor, "!");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(callsTo("PUT", DRAFT_URL)).toHaveLength(1);
    expect(callsTo("DELETE", DRAFT_URL)).toHaveLength(0);
  });

  it("when the pending change cannot be saved, Close asks first", async () => {
    route("PUT", DRAFT_URL, () => problem(500, "INTERNAL"));
    const editor = await mount();
    await edit(editor, "!");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const dialog = await screen.findByRole("dialog", { name: "Close without saving?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Close anyway" }));
    expect(router.push).toHaveBeenCalledWith("/spaces/TEAM/pages/p1");
  });

  it("··· holds Revert to last published and Page history", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const menu = screen.getByRole("menu", { name: "More actions" });
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Revert to last published", "Page history"]);
    expect(within(menu).getByRole("menuitem", { name: "Page history" })).toHaveAttribute("href", "/spaces/TEAM/pages/p1/history");
  });

  it("Revert asks for confirmation; Cancel changes nothing", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Revert to last published" }));
    const dialog = screen.getByRole("dialog", { name: "Revert to last published?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.textContent).toContain("This discards your unpublished changes and opens the current version of the page.");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(callsTo("DELETE", DRAFT_URL)).toHaveLength(0);
  });

  it("Revert deletes the draft and reloads the current version", async () => {
    const editor = await mount({ initial: { ...PROPS.initial, fromDraft: true } });
    await edit(editor, " draft");
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Revert to last published" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revert" }));
    await waitFor(() => expect(editor.getText()).toBe("Their version"));
    expect(callsTo("DELETE", DRAFT_URL)).toHaveLength(1);
    expect(saveState()).toBe("Ready to go");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("Escape closes the confirmation", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Revert to last published" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the link dialog", () => {
  it("refuses an address the schema refuses and links the selection with a valid one", async () => {
    const editor = await mount();
    await act(async () => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    const dialog = screen.getByRole("dialog", { name: "Insert link" });
    const address = within(dialog).getByRole("textbox", { name: "Link address" });
    fireEvent.change(address, { target: { value: "javascript:alert(1)" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Insert" }));
    expect(within(dialog).getByRole("alert").textContent).toBe("Enter an address that starts with http://, https://, mailto:, tel: or a /.");
    expect(address).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(address, { target: { value: " https://example.com/spec " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Insert" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(editor.getJSON().content?.[0]?.content?.[0]).toMatchObject({
      text: "Hello",
      marks: [{ type: "link", attrs: { href: "https://example.com/spec" } }],
    });
  });

  it("on an existing link, edits it and can remove it", async () => {
    const linked = doc(p(text("go", [{ type: "link", attrs: { href: "https://a.example" } }])));
    const editor = await mount({ initial: { ...PROPS.initial, content: linked } });
    await act(async () => {
      editor.commands.setTextSelection(2);
    });
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    const dialog = screen.getByRole("dialog", { name: "Edit link" });
    expect(within(dialog).getByRole("textbox", { name: "Link address" })).toHaveValue("https://a.example");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove link" }));
    expect(JSON.stringify(editor.getJSON())).not.toContain('"type":"link"');
  });
});

describe("presence (RD-062)", () => {
  it("heartbeats on mount and shows the other users, never the caller", async () => {
    route("POST", PRESENCE_URL, () =>
      json(200, {
        others: [
          { id: "u2", name: "Bob Builder" },
          { id: "u1", name: "Alice Admin" },
        ],
      }),
    );
    await mount();
    const list = await screen.findByRole("list", { name: "Also editing this page" });
    expect(within(list).getAllByRole("img").map((i) => i.getAttribute("aria-label"))).toEqual(["Bob Builder is editing this page"]);
    expect(within(list).getByRole("img").textContent).toBe("BB");
    expect(callsTo("POST", PRESENCE_URL).length).toBeGreaterThanOrEqual(1);
    expect((screen.getByRole("button", { name: "Invite collaborator" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows at most five avatars and counts the rest", async () => {
    const others = Array.from({ length: 7 }, (_, i) => ({ id: `u${i + 10}`, name: `User ${i}` }));
    route("POST", PRESENCE_URL, () => json(200, { others }));
    await mount();
    const list = await screen.findByRole("list", { name: "Also editing this page" });
    const imgs = within(list).getAllByRole("img");
    expect(imgs).toHaveLength(6);
    expect(imgs[5]?.getAttribute("aria-label")).toBe("2 more people are editing this page");
    expect(imgs[5]?.textContent).toBe("+2");
  });
});
