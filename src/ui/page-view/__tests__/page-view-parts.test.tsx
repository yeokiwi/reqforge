// @vitest-environment jsdom
// The page view's shared parts: the breadcrumb (10 §4.1, RD-078), the byline sentence with its
// <time> (10 §4.1: relative time, absolute on hover), and the URLs of 10 §11.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "@/copy";
import { Breadcrumb, pageCrumbs } from "../breadcrumb";
import { PageByline, bylineParts } from "../byline";
import { hierarchyHref, pageEditHref, pageHistoryHref, pageHref, pageVersionHref, spaceHref } from "../urls";

afterEach(cleanup);

describe("Breadcrumb", () => {
  it("is Pages / <ancestors> / <title>: links, then the page itself as current and not a link (RD-078)", () => {
    render(<Breadcrumb crumbs={pageCrumbs("TEAM", [{ id: "a", title: "Product" }], "Specifications")} />);
    const nav = screen.getByRole("navigation", { name: t("pageView.breadcrumb") });
    const items = within(nav).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Pages", "/Product", "/Specifications"]);
    expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/spaces/TEAM", "/spaces/TEAM/pages/a"]);
    const last = within(nav).getByText("Specifications");
    expect(last.tagName).not.toBe("A");
    expect(last).toHaveAttribute("aria-current", "page");
  });

  it("hides the separators from assistive technology", () => {
    const { container } = render(<Breadcrumb crumbs={pageCrumbs("TEAM", [], "Root page")} />);
    const separators = Array.from(container.querySelectorAll("li > span")).filter((s) => s.textContent === "/");
    expect(separators).toHaveLength(1);
    expect(separators[0]).toHaveAttribute("aria-hidden", "true");
  });
});

describe("PageByline", () => {
  it("renders the deck's sentence with the relative time in a <time> carrying the instant and the absolute time", () => {
    render(
      <PageByline
        byline={{ author: "Alice Admin", modifiedAt: "2026-10-11T09:54:00.000Z", relative: "6 minutes ago", absolute: "Oct 11, 2026 09:54" }}
      />,
    );
    const line = screen.getByTestId("page-byline");
    expect(line.textContent).toBe(t("page.byline", { author: "Alice Admin", relative: "6 minutes ago" }));
    const time = line.querySelector("time");
    expect(time).toHaveAttribute("datetime", "2026-10-11T09:54:00.000Z");
    expect(time).toHaveAttribute("title", "Oct 11, 2026 09:54");
    expect(time?.textContent).toBe("6 minutes ago");
  });

  it("splits the sentence around {relative} even when the name looks like a placeholder", () => {
    expect(bylineParts("Ann {relative}")).toEqual({ before: "Created by Ann {relative}, last modified ", after: "" });
  });
});

describe("page URLs (10 §11)", () => {
  it("are the documented paths, with every segment percent-encoded", () => {
    expect(spaceHref("TEAM")).toBe("/spaces/TEAM");
    expect(pageHref("TEAM", "p1")).toBe("/spaces/TEAM/pages/p1");
    expect(pageVersionHref("TEAM", "p1", 3)).toBe("/spaces/TEAM/pages/p1?version=3");
    expect(pageEditHref("TEAM", "p1")).toBe("/spaces/TEAM/pages/p1/edit");
    expect(pageHistoryHref("TEAM", "p1")).toBe("/spaces/TEAM/pages/p1/history");
    expect(hierarchyHref("TEAM", "p1")).toBe("/spaces/TEAM?highlight=p1");
    expect(pageHref("日本", "a/b?c")).toBe("/spaces/%E6%97%A5%E6%9C%AC/pages/a%2Fb%3Fc");
  });
});
