// @vitest-environment jsdom
// 📎 / `···` → Attachments (RD-058, RD-071): the list and its states, download links and image
// thumbnails, Upload (checks before sending, every mapped refusal, one upload at a time) and Hide
// (confirmed, then the list is fetched again), Escape.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import type { AttachmentRef, PageDetail } from "@/domain/documents/api-types";
import { LIMITS } from "@/domain/documents/limits";
import { formatDateTime } from "@/ui/time";
import { pageDetail } from "../../_lib/__tests__/fixtures";
import { AttachmentsDialog } from "../attachments-dialog";
import { deferred, fakeApi, json, noContent, problem, type Responder, type SentRequest } from "./fake-api";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const LIST = "/api/v1/spaces/TEAM/pages/p1/attachments";

const attachment = (over: Partial<AttachmentRef> = {}): AttachmentRef => ({
  id: "a1",
  filename: "spec.pdf",
  contentType: "application/octet-stream",
  size: 2048,
  url: "/api/v1/attachments/a1/spec.pdf",
  image: false,
  uploadedBy: { id: "u-bob", name: "Bob Editor" },
  createdAt: "2026-10-11T09:00:00.000Z",
  ...over,
});
const DIAGRAM = attachment({ id: "a2", filename: "diagram.png", contentType: "image/png", size: 3 * 1024 * 1024, url: "/api/v1/attachments/a2/diagram.png", image: true });

let stored: AttachmentRef[];

/** The list the server has, plus scripted answers for the writes. */
function server(writes: Responder = () => noContent()): Responder {
  return (request: SentRequest) => (request.method === "GET" && request.url === LIST ? json(stored) : writes(request));
}

beforeEach(() => {
  vi.clearAllMocks();
  stored = [attachment(), DIAGRAM];
});
afterEach(cleanup);

async function open(respond: Responder = server(), page: Partial<PageDetail> = {}) {
  const api = fakeApi(respond);
  const onClose = vi.fn();
  render(<AttachmentsDialog space={{ key: "TEAM", name: "Team" }} page={pageDetail(page)} onClose={onClose} fetchImpl={api.fetchImpl} />);
  const dialog = screen.getByRole("dialog", { name: t("pageAttachments.title") });
  await waitFor(() => expect(screen.queryByText(t("pageAttachments.loading"))).toBeNull());
  return { api, onClose, dialog };
}

const rows = () => screen.queryAllByTestId("attachment-row");
const fileInput = () => screen.getByTestId("attachment-file") as HTMLInputElement;
const choose = (file: File) => fireEvent.change(fileInput(), { target: { files: [file] } });
const statusText = () => screen.getByTestId("attachments-status").textContent;
const sized = (name: string, size: number) => {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size });
  return file;
};

describe("the list", () => {
  it("says it is loading, then lists name, size, uploader and date", async () => {
    const held = deferred();
    const api = fakeApi(() => held.promise);
    render(<AttachmentsDialog space={{ key: "TEAM", name: "Team" }} page={pageDetail()} onClose={vi.fn()} fetchImpl={api.fetchImpl} />);
    expect(screen.getByText(t("pageAttachments.loading"))).toBeTruthy();
    await act(async () => held.release(json(stored)));

    expect(api.sent[0]).toMatchObject({ method: "GET", url: LIST });
    const table = screen.getByRole("table", { name: t("pageAttachments.table", { title: "Specifications" }) });
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([
      t("pageAttachments.col.name"),
      t("pageAttachments.col.size"),
      t("pageAttachments.col.uploadedBy"),
      t("pageAttachments.col.uploaded"),
      t("pageAttachments.col.actions"),
    ]);
    const [first] = rows();
    const cells = within(first as HTMLElement).getAllByRole("cell").map((c) => c.textContent);
    expect(cells.slice(0, 4)).toEqual(["spec.pdf", t("pageAttachments.size.kib", { n: "2" }), "Bob Editor", formatDateTime("2026-10-11T09:00:00.000Z")]);
  });

  it("each name downloads the file from its attachment URL, under its own name", async () => {
    await open();
    const link = screen.getByRole("link", { name: "spec.pdf" });
    expect(link).toHaveAttribute("href", "/api/v1/attachments/a1/spec.pdf");
    expect(link).toHaveAttribute("download", "spec.pdf");
  });

  it("shows a thumbnail from the attachment URL only for an image", async () => {
    await open();
    const thumbnails = screen.getAllByTestId("attachment-thumbnail");
    expect(thumbnails).toHaveLength(1);
    expect(thumbnails[0]).toHaveAttribute("src", "/api/v1/attachments/a2/diagram.png");
    expect(thumbnails[0]).toHaveAttribute("alt", "");
    expect(within(rows()[0] as HTMLElement).queryByTestId("attachment-thumbnail")).toBeNull();
  });

  it("says when there are none", async () => {
    stored = [];
    await open();
    expect(screen.getByText(t("pageAttachments.empty"))).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says when it could not load, and Try again fetches again", async () => {
    const { api } = await open(() => problem(500, "INTERNAL"));
    expect(screen.getByRole("alert")).toHaveTextContent(t("pageAttachments.loadFailed"));
    api.answer(server());
    fireEvent.click(screen.getByRole("button", { name: t("pageAttachments.retry") }));
    await waitFor(() => expect(rows()).toHaveLength(2));
  });

  it("a viewer who cannot edit sees no Upload, no Hide and no Actions column; Close has the focus", async () => {
    const { dialog } = await open(server(), { permissions: { canEdit: false, canAdmin: false } });
    expect(screen.queryByRole("button", { name: t("pageAttachments.upload") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("pageAttachments.hide.label", { name: "spec.pdf" }) })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: t("pageAttachments.col.actions") })).toBeNull();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: t("pageView.dialog.close") }));
  });
});

describe("Upload (RD-058, RD-071)", () => {
  it("the button opens the file chooser and has the focus; the help names the 10 MiB limit", async () => {
    await open();
    const upload = screen.getByRole("button", { name: t("pageAttachments.upload") });
    expect(document.activeElement).toBe(upload);
    const click = vi.spyOn(fileInput(), "click");
    fireEvent.click(upload);
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByText(t("pageAttachments.upload.help", { mib: "10" }))).toBeTruthy();
  });

  it("sends the file as multipart `file`, says so while it runs, then lists it and refreshes", async () => {
    const held = deferred();
    const { api } = await open(server((request) => (request.method === "POST" ? held.promise : noContent())));
    choose(new File(["hello"], "notes.txt", { type: "text/plain" }));
    expect(statusText()).toBe(t("pageAttachments.uploading", { name: "notes.txt" }));
    expect(screen.getByRole("button", { name: t("pageAttachments.upload") })).toHaveAttribute("aria-busy", "true");

    const post = api.sent.find((r) => r.method === "POST");
    expect(post?.url).toBe(LIST);
    expect(post?.body).toBeInstanceOf(FormData);
    expect(((post?.body as FormData).get("file") as File).name).toBe("notes.txt");

    stored = [attachment({ id: "a3", filename: "notes.txt", url: "/api/v1/attachments/a3/notes.txt" }), ...stored];
    await act(async () => held.release(json(stored[0], 201)));
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(statusText()).toBe(t("pageAttachments.uploaded", { name: "notes.txt" }));
    expect(api.sent.filter((r) => r.method === "GET")).toHaveLength(2);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("a second file chosen while one uploads is not sent", async () => {
    const held = deferred();
    const { api } = await open(server(() => held.promise));
    choose(new File(["a"], "one.txt"));
    choose(new File(["b"], "two.txt"));
    fireEvent.click(screen.getByRole("button", { name: t("pageAttachments.upload") }));
    expect(api.writes()).toHaveLength(1);
    await act(async () => held.release(json(attachment(), 201)));
    await waitFor(() => expect(statusText()).toBe(t("pageAttachments.uploaded", { name: "one.txt" })));
    expect(api.writes()).toHaveLength(1);
  });

  it.each([
    ["an empty file", sized("empty.txt", 0), t("pageAttachments.upload.empty", { name: "empty.txt" })],
    ["a file over 10 MiB", sized("big.bin", LIMITS.attachmentMaxBytes + 1), t("pageAttachments.upload.tooLarge", { name: "big.bin", mib: "10" })],
  ])("refuses %s before sending", async (_label, file, message) => {
    const { api } = await open();
    choose(file);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(api.writes()).toHaveLength(0);
  });

  it.each([
    ["TOO_LARGE", problem(413, "TOO_LARGE", { limit: LIMITS.attachmentMaxBytes }), t("pageAttachments.upload.tooLarge", { name: "f.bin", mib: "10" })],
    ["UNSUPPORTED_MEDIA (SVG)", problem(415, "UNSUPPORTED_MEDIA"), t("pageAttachments.upload.unsupported", { name: "f.bin" })],
    ["FORBIDDEN", problem(403, "FORBIDDEN"), t("pageAttachments.upload.forbidden")],
    ["NOT_FOUND", problem(404, "NOT_FOUND"), t("pageView.dialog.gone")],
    ["INTERNAL", problem(500, "INTERNAL"), t("pageAttachments.upload.failed", { name: "f.bin" })],
  ])("the server refusing with %s is said, and the list is unchanged", async (_label, response, message) => {
    await open(server(() => response));
    choose(new File(["x"], "f.bin"));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(rows()).toHaveLength(2);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: t("pageAttachments.upload") })).not.toHaveAttribute("aria-disabled");
  });
});

describe("Hide (RD-058: deleting an attachment hides it)", () => {
  const hideButton = (name: string) => screen.getByRole("button", { name: t("pageAttachments.hide.label", { name }) });

  it("asks first; Cancel sends nothing and gives the focus back to Hide", async () => {
    const { api } = await open();
    const hide = hideButton("spec.pdf");
    hide.focus();
    fireEvent.click(hide);
    const confirm = screen.getByRole("dialog", { name: t("pageAttachments.hide.title", { name: "spec.pdf" }) });
    expect(document.getElementById(confirm.getAttribute("aria-describedby") ?? "")?.textContent).toBe(t("pageAttachments.hide.body"));
    fireEvent.click(within(confirm).getByRole("button", { name: t("pageView.dialog.cancel") }));
    expect(screen.queryByRole("dialog", { name: t("pageAttachments.hide.title", { name: "spec.pdf" }) })).toBeNull();
    expect(document.activeElement).toBe(hide);
    expect(api.writes()).toHaveLength(0);
  });

  it("Escape in the question closes only the question", async () => {
    const { onClose } = await open();
    fireEvent.click(hideButton("spec.pdf"));
    fireEvent.keyDown(screen.getByRole("dialog", { name: t("pageAttachments.hide.title", { name: "spec.pdf" }) }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: t("pageAttachments.hide.title", { name: "spec.pdf" }) })).toBeNull();
    expect(screen.getByRole("dialog", { name: t("pageAttachments.title") })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("DELETEs it, fetches the list again, says so, and puts the focus on Upload", async () => {
    const { api } = await open(
      server((request) => {
        stored = stored.filter((a) => a.id !== "a1");
        return request.method === "DELETE" ? noContent() : problem(500, "INTERNAL");
      }),
    );
    fireEvent.click(hideButton("spec.pdf"));
    const confirm = screen.getByRole("dialog", { name: t("pageAttachments.hide.title", { name: "spec.pdf" }) });
    fireEvent.click(within(confirm).getByRole("button", { name: t("pageAttachments.hide") }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(api.writes()).toEqual([{ method: "DELETE", url: `${LIST}/a1`, body: undefined }]);
    expect(statusText()).toBe(t("pageAttachments.hidden", { name: "spec.pdf" }));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: t("pageAttachments.upload") }));
  });

  it("FORBIDDEN is said and nothing is fetched again", async () => {
    const { api } = await open(server(() => problem(403, "FORBIDDEN")));
    fireEvent.click(hideButton("spec.pdf"));
    fireEvent.click(within(screen.getByRole("dialog", { name: t("pageAttachments.hide.title", { name: "spec.pdf" }) })).getByRole("button", { name: t("pageAttachments.hide") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("pageAttachments.hide.forbidden"));
    expect(api.sent.filter((r) => r.method === "GET")).toHaveLength(1);
    expect(rows()).toHaveLength(2);
  });

  it("NOT_FOUND (already gone) is said and the list is fetched again", async () => {
    await open(
      server(() => {
        stored = stored.filter((a) => a.id !== "a1");
        return problem(404, "NOT_FOUND");
      }),
    );
    fireEvent.click(hideButton("spec.pdf"));
    fireEvent.click(within(screen.getByRole("dialog", { name: t("pageAttachments.hide.title", { name: "spec.pdf" }) })).getByRole("button", { name: t("pageAttachments.hide") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("pageAttachments.hide.gone", { name: "spec.pdf" }));
    await waitFor(() => expect(rows()).toHaveLength(1));
  });
});

describe("closing", () => {
  it("Escape and Close close it", async () => {
    const { onClose, dialog } = await open();
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(within(dialog).getByRole("button", { name: t("pageView.dialog.close") }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
