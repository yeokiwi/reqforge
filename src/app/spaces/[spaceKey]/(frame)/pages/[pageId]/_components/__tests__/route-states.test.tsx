// @vitest-environment jsdom
// The page view's states other than "here is the page" (10 §12 quality bar): loading holds the
// header, title and byline in their final places with a status for screen readers and no
// spinner; an error says so inside the frame and offers another try. And the footer (10 §4.3)
// holds the labels and comments rows without showing or announcing anything.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import PageViewError from "../../error";
import PageLoading from "../../loading";
import { PageFooter } from "../page-footer";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("loading.tsx", () => {
  it("announces loading and draws placeholders only, hidden from assistive technology", () => {
    render(<PageLoading />);
    const root = screen.getByTestId("page-loading");
    expect(root).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent(t("pageView.loading"));
    expect(root.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(root.querySelector("svg")).toBeNull();
  });
});

describe("error.tsx", () => {
  it("says the page could not be loaded, without the error's own text, and retries on request", () => {
    const reset = vi.fn();
    render(<PageViewError error={Object.assign(new Error("SELECT * FROM secrets"), { digest: "d1" })} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent(t("pageView.error"));
    expect(screen.getByTestId("page-error").textContent).not.toContain("secrets");
    fireEvent.click(screen.getByRole("button", { name: t("pageView.error.retry") }));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe("PageFooter (10 §4.3)", () => {
  it("reserves the labels and comments rows, empty and hidden, so their arrival moves nothing", () => {
    render(<PageFooter />);
    const footer = screen.getByTestId("page-footer");
    expect(footer).toHaveAttribute("aria-hidden", "true");
    expect(footer.querySelector('[data-slot="labels"]')).not.toBeNull();
    expect(footer.querySelector('[data-slot="comments"]')).not.toBeNull();
    expect(footer.textContent).toBe("");
  });
});
