// @vitest-environment jsdom
// The page editor's pass-2 surfaces wired end to end in jsdom, with a real TipTap editor and a
// mocked fetch (10 §5.3–5.5, RD-057, RD-058): the `+ ▾` menu and its dialogs, `{` suggestions,
// the macro browser, uploads from `🖼`, the menu and a paste (and every refusal the server can
// send), find and replace from `🔍` and Ctrl+F, the shortcuts from `?` and Ctrl+/. What jsdom
// cannot do — real typing, layout, focus rings, real clipboard and drag events — is left to the
// end-to-end suite.
import type { Editor } from "@tiptap/core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateDocumentJson } from "@/editor/schema";
import { PageEditor, type PageEditorProps } from "../page-editor";
import { todayValue } from "../insert-commands";
import { doc, p, posOf, stubLayout, text } from "./editor-harness";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const PAGE_URL = "/api/v1/spaces/TEAM/pages/p1";
const ATTACHMENTS_URL = `${PAGE_URL}/attachments`;

const PROPS: PageEditorProps = {
  space: { key: "TEAM", name: "Team" },
  page: { id: "p1", title: "Specifications", ancestors: [], restricted: false },
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

let calls: Call[];
let handlers: Array<{ method: string; match: (url: string) => boolean; handler: Handler }>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function problem(status: number, code: string, extras: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ type: "about:blank", title: code, status, detail: "", code, ...extras }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

function route(method: string, url: string | ((u: string) => boolean), handler: Handler): void {
  const match = typeof url === "string" ? (u: string) => u === url : url;
  handlers.unshift({ method, match, handler });
}

function attachment(over: Record<string, unknown> = {}) {
  return {
    id: "att9",
    filename: "diagram.png",
    contentType: "image/png",
    size: 3,
    url: "/api/v1/attachments/att9/diagram.png",
    image: true,
    uploadedBy: { id: "u1", name: "Alice Admin" },
    createdAt: "t",
    ...over,
  };
}

beforeEach(() => {
  stubLayout();
  window.localStorage.clear();
  calls = [];
  handlers = [];
  route("POST", `${PAGE_URL}/presence`, () => json(200, { others: [] }));
  route("PUT", `${PAGE_URL}/draft`, () => json(200, { savedAt: "t", stale: false, currentVersion: 3 }));
  route("GET", (u) => u.startsWith("/api/v1/spaces/TEAM/people?q="), () =>
    json(200, { people: [{ id: "u7", name: "Bob Builder" }, { id: "u8", name: "Bea Arthur" }] }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : init?.body;
      const call = { method, url: input, body };
      calls.push(call);
      const found = handlers.find((h) => h.method === method && h.match(input));
      if (!found) throw new TypeError(`unexpected ${method} ${input}`);
      return found.handler(call);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount(props: Partial<PageEditorProps> = {}): Promise<Editor> {
  render(<PageEditor {...PROPS} {...props} />);
  let editor: Editor | undefined;
  await waitFor(() => {
    const dom = document.querySelector(".ProseMirror") as (HTMLElement & { editor?: Editor }) | null;
    editor = dom?.editor;
    expect(editor).toBeDefined();
    expect(screen.getByRole("button", { name: "Insert more content" }).getAttribute("aria-disabled")).toBeNull();
  });
  if (!editor) throw new Error("no editor");
  return editor;
}

function openInsertItem(name: string): void {
  fireEvent.click(screen.getByRole("button", { name: "Insert more content" }));
  fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name }));
}

function caretAtEnd(editor: Editor): void {
  act(() => {
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  });
}

const contentJson = (editor: Editor) => JSON.stringify(editor.getJSON());

function chooseFiles(...files: File[]): void {
  fireEvent.change(screen.getByTestId("file-input"), { target: { files } });
}

describe("the `+ ▾` menu's dialogs", () => {
  it("Markup: Markdown is converted and inserted; a remote image never is (RD-058)", async () => {
    const editor = await mount();
    caretAtEnd(editor);
    openInsertItem("Markup");
    const dialog = screen.getByRole("dialog", { name: "Insert markup" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "## Scope\n\n- one ![x](https://evil.example/p.png)\n- two" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Insert" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(contentJson(editor)).toContain('"heading"');
    expect(contentJson(editor)).toContain('"bulletList"');
    expect(contentJson(editor)).not.toContain('"image"');
    expect(validateDocumentJson(editor.getJSON()).ok).toBe(true);
  });

  it("Date: inserts today by default", async () => {
    const editor = await mount();
    caretAtEnd(editor);
    openInsertItem("Date");
    const dialog = screen.getByRole("dialog", { name: "Insert a date" });
    expect((within(dialog).getByLabelText("Date") as HTMLInputElement).value).toBe(todayValue());
    fireEvent.click(within(dialog).getByRole("button", { name: "Insert" }));
    expect(contentJson(editor)).toContain(`"value":"${todayValue()}"`);
  });

  it("Status: inserts a lozenge and opens its editor at once; Done applies text and colour", async () => {
    const editor = await mount();
    caretAtEnd(editor);
    openInsertItem("Status");
    const dialog = await screen.findByRole("dialog", { name: "Edit status" });
    expect(contentJson(editor)).toContain('"text":"Status"');
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Text" }), { target: { value: "Approved" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Green" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(contentJson(editor)).toContain('{"type":"status","attrs":{"text":"Approved","colour":"green"}}');
  });

  it("a click on a status opens its editor; Cancel changes nothing", async () => {
    const editor = await mount({
      initial: { ...PROPS.initial, content: doc(p(text("a"), { type: "status", attrs: { text: "Draft", colour: "grey" } })) },
    });
    const before = editor.getJSON();
    fireEvent.click(editor.view.dom.querySelector('[data-type="status"]') as HTMLElement);
    const dialog = await screen.findByRole("dialog", { name: "Edit status" });
    expect((within(dialog).getByRole("textbox", { name: "Text" }) as HTMLInputElement).value).toBe("Draft");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(editor.getJSON()).toEqual(before);
  });

  it("Enter on a selected date opens its editor; Done changes the date", async () => {
    const editor = await mount({ initial: { ...PROPS.initial, content: doc(p(text("due "), { type: "date", attrs: { value: "2026-01-01" } })) } });
    act(() => {
      editor.commands.setNodeSelection(5);
    });
    fireEvent.keyDown(editor.view.dom, { key: "Enter" });
    const dialog = await screen.findByRole("dialog", { name: "Edit date" });
    fireEvent.change(within(dialog).getByLabelText("Date"), { target: { value: "2026-12-24" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(contentJson(editor)).toContain('"value":"2026-12-24"');
  });

  it("Symbol: inserts the symbol at the caret", async () => {
    const editor = await mount();
    caretAtEnd(editor);
    openInsertItem("Symbol");
    fireEvent.click(within(screen.getByRole("dialog", { name: "Insert a symbol" })).getByRole("button", { name: "§" }));
    expect(editor.state.doc.textContent).toBe("Hello world§");
  });

  it("User mention: searches the space's people and inserts the chosen one with the keyboard", async () => {
    const editor = await mount();
    caretAtEnd(editor);
    openInsertItem("User mention");
    const dialog = screen.getByRole("dialog", { name: "Mention someone" });
    const box = within(dialog).getByRole("combobox", { name: "Name" });
    fireEvent.change(box, { target: { value: "b" } });
    await waitFor(() => expect(within(dialog).getAllByRole("option")).toHaveLength(2));
    expect(calls.some((c) => c.url === "/api/v1/spaces/TEAM/people?q=b")).toBe(true);
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(contentJson(editor)).toContain('{"type":"mention","attrs":{"userId":"u8","label":"Bea Arthur"}}');
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Other macros opens the macro browser; choosing Info inserts an info panel", async () => {
    const editor = await mount();
    caretAtEnd(editor);
    openInsertItem("Other macros");
    const dialog = screen.getByRole("dialog", { name: "Macro browser" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Info" }));
    expect(contentJson(editor)).toContain('"infoPanel"');
  });

  it("Link opens pass 1's link dialog", async () => {
    await mount();
    openInsertItem("Link");
    expect(screen.getByRole("dialog", { name: "Insert link" })).toBeTruthy();
  });
});

describe("`{` Macro suggestions in the page editor", () => {
  it("shows the titled list under the caret; Enter inserts; the list goes", async () => {
    const editor = await mount();
    caretAtEnd(editor);
    await act(async () => {
      editor.commands.insertContent(" {");
      await new Promise((r) => setTimeout(r, 0));
    });
    const list = screen.getByRole("listbox", { name: "Macro suggestions" });
    expect(within(list).getAllByRole("option")).toHaveLength(6);
    await act(async () => {
      fireEvent.keyDown(editor.view.dom, { key: "Enter" });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByRole("listbox", { name: "Macro suggestions" })).toBeNull();
    expect(contentJson(editor)).toContain('"infoPanel"');
    expect(editor.state.doc.textContent).not.toContain("{");
  });
});

describe("files and images (RD-058)", () => {
  const png = () => new File([new Uint8Array([137, 80, 78])], "diagram.png", { type: "image/png" });

  it("🖼 opens the file picker; an image upload becomes an image node with the server's id and URL, and is autosaved", async () => {
    route("POST", ATTACHMENTS_URL, () => json(201, attachment()));
    const editor = await mount();
    caretAtEnd(editor);
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Files and images" }));
    expect(click).toHaveBeenCalledTimes(1);
    chooseFiles(png());
    await waitFor(() => expect(contentJson(editor)).toContain('"attachmentId":"att9"'));
    const post = calls.find((c) => c.method === "POST" && c.url === ATTACHMENTS_URL);
    expect(post?.body).toBeInstanceOf(FormData);
    expect(((post?.body as FormData).get("file") as File).name).toBe("diagram.png");
    expect(contentJson(editor)).toContain('"src":"/api/v1/attachments/att9/diagram.png"');
    expect(validateDocumentJson(editor.getJSON(), { allowedAttachmentIds: new Set(["att9"]) }).ok).toBe(true);
    expect(screen.queryByText(/Uploading/)).toBeNull();
  });

  it("shows the upload while it runs, and the place it will land", async () => {
    let finish: (r: Response) => void = () => undefined;
    route("POST", ATTACHMENTS_URL, () => new Promise<Response>((resolve) => (finish = resolve)));
    const editor = await mount();
    caretAtEnd(editor);
    chooseFiles(png());
    const region = screen.getByRole("region", { name: "File uploads" });
    await waitFor(() => expect(within(region).getByText('Uploading "diagram.png"…')).toBeTruthy());
    expect(editor.view.dom.querySelector(".rf-upload-placeholder")).not.toBeNull();
    await act(async () => {
      finish(json(201, attachment()));
    });
    await waitFor(() => expect(within(region).queryByText(/Uploading/)).toBeNull());
    expect(editor.view.dom.querySelector(".rf-upload-placeholder")).toBeNull();
  });

  it("a file that is not an image becomes a link named after it", async () => {
    route("POST", ATTACHMENTS_URL, () => json(201, attachment({ id: "att3", filename: "spec v2.pdf", contentType: "application/octet-stream", image: false, url: "/api/v1/attachments/att3/spec%20v2.pdf" })));
    const editor = await mount();
    caretAtEnd(editor);
    chooseFiles(new File([new Uint8Array([1])], "spec v2.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(contentJson(editor)).toContain('"href":"/api/v1/attachments/att3/spec%20v2.pdf"'));
    expect(editor.state.doc.textContent).toBe("Hello worldspec v2.pdf");
  });

  it("the + menu's Files and images is the same picker", async () => {
    await mount();
    const click = vi.spyOn(screen.getByTestId("file-input") as HTMLInputElement, "click");
    openInsertItem("Files and images");
    expect(click).toHaveBeenCalledTimes(1);
  });

  it.each([
    [problem(413, "TOO_LARGE", { limit: 10485760 }), '"diagram.png" is too large to attach. A file can be at most 10 MiB.'],
    [problem(415, "UNSUPPORTED_MEDIA"), '"diagram.png" can\'t be attached: this type of file is not allowed.'],
    [problem(401, "UNAUTHENTICATED"), 'You\'ve been signed out. Sign in again in another tab, then attach "diagram.png" again.'],
    [problem(403, "FORBIDDEN"), "You can no longer add files to this page."],
    [problem(500, "INTERNAL"), 'Couldn\'t attach "diagram.png". Try again.'],
  ])("a refused upload says why, in the copy deck's words, and inserts nothing (%#)", async (response, message) => {
    route("POST", ATTACHMENTS_URL, () => response.clone());
    const editor = await mount();
    const before = editor.getJSON();
    chooseFiles(png());
    const region = screen.getByRole("region", { name: "File uploads" });
    await waitFor(() => expect(within(region).getByText(message)).toBeTruthy());
    expect(editor.getJSON()).toEqual(before);
    expect(editor.view.dom.querySelector(".rf-upload-placeholder")).toBeNull();
    fireEvent.click(within(region).getByRole("button", { name: "Dismiss" }));
    expect(within(region).queryByText(message)).toBeNull();
  });

  it("an empty file or one over 10 MiB is refused without being sent", async () => {
    await mount();
    chooseFiles(new File([], "empty.txt"), new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.bin"));
    expect(screen.getByText('"empty.txt" is empty, so it was not attached.')).toBeTruthy();
    expect(screen.getByText('"huge.bin" is too large to attach. A file can be at most 10 MiB.')).toBeTruthy();
    expect(calls.some((c) => c.url === ATTACHMENTS_URL)).toBe(false);
  });

  it("a pasted image file is uploaded through the same path", async () => {
    route("POST", ATTACHMENTS_URL, () => json(201, attachment()));
    const editor = await mount();
    caretAtEnd(editor);
    const file = new File([new Uint8Array([1, 2])], "", { type: "image/png" });
    const clipboardData = { getData: () => "", files: Object.assign([file], { item: () => file }) };
    act(() => {
      editor.view.someProp("handlePaste", (f) => f(editor.view, { clipboardData } as unknown as ClipboardEvent, editor.state.doc.slice(0, 0)));
    });
    await waitFor(() => expect(contentJson(editor)).toContain('"attachmentId":"att9"'));
    const post = calls.find((c) => c.url === ATTACHMENTS_URL);
    expect(((post?.body as FormData).get("file") as File).name).toBe("image.png");
  });

  it("an image this page opened with may be pasted again; another page's is dropped", async () => {
    const editor = await mount({
      initial: { ...PROPS.initial, content: doc(p(text("x"), { type: "image", attrs: { attachmentId: "mine", src: "/api/v1/attachments/mine/a.png" } })) },
    });
    caretAtEnd(editor);
    act(() => {
      editor.view.pasteHTML('<p><img src="/api/v1/attachments/mine/a.png"><img src="/api/v1/attachments/other/b.png"></p>', {
        clipboardData: null,
      } as unknown as ClipboardEvent);
    });
    const ids: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "image") ids.push(node.attrs.attachmentId as string);
    });
    expect(ids).toEqual(["mine", "mine"]);
  });
});

describe("find and replace, shortcuts (RD-057)", () => {
  it("🔍 opens the find bar with the focus in it; the button shows it is open; Escape closes it and returns to the editor", async () => {
    const editor = await mount();
    const button = screen.getByRole("button", { name: "Find and replace" });
    fireEvent.click(button);
    const query = await screen.findByRole("searchbox", { name: "Find" });
    expect(document.activeElement).toBe(query);
    expect(button).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(query, { target: { value: "world" } });
    expect(screen.getByTestId("find-count").textContent).toBe("1 of 1");
    fireEvent.keyDown(query, { key: "Escape" });
    expect(screen.queryByRole("search")).toBeNull();
    await waitFor(() => expect(editor.view.hasFocus() || document.activeElement === editor.view.dom).toBe(true));
    expect(editor.view.dom.querySelectorAll(".rf-find-match")).toHaveLength(0);
  });

  it("Ctrl+F in the editor opens it, starting from the selected text", async () => {
    const editor = await mount();
    act(() => {
      editor.commands.setTextSelection({ from: posOf(editor, "Hello world") + 6, to: posOf(editor, "Hello world") + 11 });
    });
    fireEvent.keyDown(editor.view.dom, { key: "f", ctrlKey: true });
    const query = (await screen.findByRole("searchbox", { name: "Find" })) as HTMLInputElement;
    expect(query.value).toBe("world");
  });

  it("? and Ctrl+/ open the keyboard shortcuts", async () => {
    const editor = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(editor.view.dom, { key: "/", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
  });

  it("Ctrl+K opens the link dialog", async () => {
    const editor = await mount();
    fireEvent.keyDown(editor.view.dom, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Insert link" })).toBeTruthy();
  });
});
