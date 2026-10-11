// @vitest-environment jsdom
// `···` → Page information: a read-only list of what PageDetail says, nothing invented.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import type { PageDetail } from "@/domain/documents/api-types";
import { formatDateTime } from "@/ui/time";
import { pageDetail } from "../../_lib/__tests__/fixtures";
import { PageInfoDialog } from "../page-info-dialog";

afterEach(cleanup);

function open(page: Partial<PageDetail> = {}) {
  const onClose = vi.fn();
  render(<PageInfoDialog space={{ key: "TEAM", name: "Team" }} page={pageDetail(page)} onClose={onClose} />);
  return { onClose, dialog: screen.getByRole("dialog", { name: t("pageInfo.title") }) };
}

/** The definition list as [term, definition] pairs. */
function entries(): [string, string][] {
  const list = screen.getByTestId("page-info");
  const terms = Array.from(list.querySelectorAll("dt"));
  return terms.map((dt) => [dt.textContent ?? "", dt.nextElementSibling?.textContent ?? ""]);
}

describe("Page information", () => {
  it("lists the page's own fields, in order, and nothing else", () => {
    open();
    expect(entries()).toEqual([
      [t("pageInfo.pageTitle"), "Specifications"],
      [t("pageInfo.id"), "p1"],
      [t("pageInfo.space"), "Team (TEAM)"],
      [t("pageInfo.createdBy"), "Alice Admin"],
      [t("pageInfo.created"), formatDateTime("2026-10-01T08:00:00.000Z")],
      [t("pageInfo.lastModifiedBy"), "Bob Editor"],
      [t("pageInfo.lastModified"), formatDateTime("2026-10-11T09:54:00.000Z")],
      [t("pageInfo.version"), "v. 7"],
      [t("pageInfo.watching"), t("pageInfo.watching.yes")],
    ]);
  });

  it("dates are UTC, with the exact instant machine-readable", () => {
    open();
    const created = screen.getByTestId("page-info").querySelector("time");
    expect(created).toHaveAttribute("datetime", "2026-10-01T08:00:00.000Z");
    expect(created?.textContent).toBe("Oct 1, 2026 08:00");
  });

  it("the current version links to Page History", () => {
    open();
    expect(screen.getByRole("link", { name: "v. 7" })).toHaveAttribute("href", "/spaces/TEAM/pages/p1/history");
  });

  it("says when the viewer is not watching", () => {
    open({ watching: false });
    expect(entries().find(([term]) => term === t("pageInfo.watching"))?.[1]).toBe(t("pageInfo.watching.no"));
  });

  it("Close has the focus; Close and Escape close it", () => {
    const { onClose, dialog } = open();
    const close = within(dialog).getByRole("button", { name: t("pageView.dialog.close") });
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
