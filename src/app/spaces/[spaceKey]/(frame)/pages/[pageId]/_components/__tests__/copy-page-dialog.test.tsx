// @vitest-environment jsdom
// `···` → Copy (RD-056, RD-067, RD-074): the suggested title, the checks before sending, every
// mapped refusal, one copy per press, and Escape.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import type { PageDetail, PageSummary } from "@/domain/documents/api-types";
import { PAGES, pageDetail } from "../../_lib/__tests__/fixtures";
import { CopyPageDialog } from "../copy-page-dialog";
import { bodyOf, deferred, fakeApi, json, problem, type Responder } from "./fake-api";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const COPY_URL = "/api/v1/spaces/TEAM/pages/p1/copy";

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function open(respond: Responder = () => json({ id: "p9" }, 201), page: Partial<PageDetail> = {}, pages: readonly PageSummary[] = PAGES) {
  const api = fakeApi(respond);
  const onClose = vi.fn();
  render(<CopyPageDialog space={{ key: "TEAM", name: "Team" }} page={pageDetail(page)} pages={pages} onClose={onClose} fetchImpl={api.fetchImpl} />);
  const dialog = screen.getByRole("dialog", { name: t("pageCopy.title", { title: "Specifications" }) });
  const field = screen.getByLabelText(t("pageCopy.field")) as HTMLInputElement;
  const submit = screen.getByRole("button", { name: t("pageCopy.submit") });
  return { api, onClose, dialog, field, submit };
}

describe("the dialog (RD-056)", () => {
  it("says a copy is this page only, from its current version, placed last among its siblings", () => {
    const { dialog } = open();
    const describedBy = dialog.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toBe(t("pageCopy.body"));
    expect(t("pageCopy.body")).toContain("not its child pages");
  });

  it("suggests `Copy of <title>`, focused and selected so typing replaces it", () => {
    const { field } = open();
    expect(field).toHaveValue("Copy of Specifications");
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe("Copy of Specifications".length);
  });

  it("numbers the suggestion past titles the space already has", () => {
    const taken = [...PAGES, { ...PAGES[0], id: "c1", title: "copy of specifications" } as PageSummary];
    const { field } = open(undefined, {}, taken);
    expect(field).toHaveValue("Copy of Specifications 2");
  });
});

describe("Copy", () => {
  it("POSTs the title and opens the copy", async () => {
    const { api, submit, field } = open();
    fireEvent.change(field, { target: { value: "  Specs, copied  " } });
    fireEvent.click(submit);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/spaces/TEAM/pages/p9"));
    expect(api.sent).toHaveLength(1);
    expect(api.sent[0]).toMatchObject({ method: "POST", url: COPY_URL });
    expect(bodyOf(api.sent[0])).toEqual({ title: "Specs, copied" });
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("Enter in the field submits", async () => {
    const { api, field } = open();
    fireEvent.submit(field.form as HTMLFormElement);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/spaces/TEAM/pages/p9"));
    expect(bodyOf(api.sent[0])).toEqual({ title: "Copy of Specifications" });
  });

  it("a 201 without an id closes and refreshes instead of failing (the copy exists)", async () => {
    const { onClose, submit } = open(() => json({}, 201));
    fireEvent.click(submit);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(router.refresh).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("a second press while the first is in flight sends nothing, and the dialog stays busy", async () => {
    const held = deferred();
    const { api, submit, onClose } = open(() => held.promise);
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.submit(submit.closest("form") as HTMLFormElement);
    expect(api.sent).toHaveLength(1);
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByRole("status").some((s) => s.textContent === t("pageCopy.busy"))).toBe(true);
    // Escape and Cancel do not abandon a copy that is being made.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: t("pageView.dialog.cancel") }));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => held.release(json({ id: "p9" }, 201)));
    expect(router.push).toHaveBeenCalledTimes(1);
  });
});

describe("checked before sending (RD-067)", () => {
  it.each([
    ["empty", "   ", t("pageCopy.field.empty")],
    // A text input drops line breaks itself; a pasted tab is a control character that stays.
    ["a control character inside", "Copy\tof", t("pageCopy.field.invalid", { max: 255 })],
    ["too long", "x".repeat(256), t("pageCopy.field.invalid", { max: 255 })],
  ])("%s: message under the field, nothing sent", (_label, value, message) => {
    const { api, field, submit } = open();
    fireEvent.change(field, { target: { value } });
    fireEvent.click(submit);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field.getAttribute("aria-describedby")).toBe(alert.id);
    expect(api.sent).toHaveLength(0);
  });

  it("editing the field clears its message", () => {
    const { field, submit } = open();
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(submit);
    expect(screen.queryByRole("alert")).not.toBeNull();
    fireEvent.change(field, { target: { value: "New" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(field).not.toHaveAttribute("aria-invalid");
  });
});

describe("refusals", () => {
  it("TITLE_TAKEN goes under the field, and the field is focused for a new title", async () => {
    const { field, submit } = open(() => problem(409, "TITLE_TAKEN"));
    fireEvent.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent(t("pageCopy.field.taken"));
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(field);
    expect(submit).not.toHaveAttribute("aria-disabled");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("VALIDATION at title goes under the field", async () => {
    const { field, submit } = open(() => problem(422, "VALIDATION", { errors: [{ path: "title", message: "x" }] }));
    fireEvent.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent(t("pageCopy.field.invalid", { max: 255 }));
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  it("TOO_LARGE names the copy budget from the error's limit (50 MiB), not the content limit", async () => {
    const { submit, field } = open(() => problem(413, "TOO_LARGE", { limit: 52_428_800 }));
    fireEvent.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent(t("pageCopy.tooLarge", { mib: "50" }));
    expect(field).not.toHaveAttribute("aria-invalid");
  });

  it.each([
    ["FORBIDDEN", 403, t("pageCopy.forbidden")],
    ["NOT_FOUND", 404, t("pageView.dialog.gone")],
    ["UNAUTHENTICATED", 401, t("pageView.dialog.signedOut")],
    ["INTERNAL", 500, t("pageCopy.failed")],
  ] as const)("%s", async (code, status, message) => {
    const { submit } = open(() => problem(status, code));
    fireEvent.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("the network failing is a general failure, and Copy can be pressed again", async () => {
    const { api, submit } = open(() => Promise.reject(new TypeError("Failed to fetch")));
    fireEvent.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent(t("pageCopy.failed"));
    api.answer(() => json({ id: "p9" }, 201));
    fireEvent.click(submit);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/spaces/TEAM/pages/p9"));
  });
});

describe("closing", () => {
  it("Escape and Cancel close without sending anything", () => {
    const first = open();
    fireEvent.keyDown(first.dialog, { key: "Escape" });
    expect(first.onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const second = open();
    fireEvent.click(screen.getByRole("button", { name: t("pageView.dialog.cancel") }));
    expect(second.onClose).toHaveBeenCalledTimes(1);
    expect(second.api.sent).toHaveLength(0);
  });
});
