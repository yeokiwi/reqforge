// @vitest-environment jsdom
// A 2,000-page tree must not re-render the whole list when someone types elsewhere, hovers, or
// drags (task brief, slice 1 phase 3). Row renders are counted through `rowClassName`, which a
// row calls exactly once per render.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/copy";
import type { PageSummary } from "@/domain/documents";
import { PAGE_DRAG_TYPE, PageTree } from "@/ui/page-tree/page-tree";
import { PageTreeProvider } from "@/ui/page-tree/provider";
import type * as RowStyle from "@/ui/page-tree/row-style";
import { fakeApi, page } from "@/ui/page-tree/__tests__/fake-api";

const renders = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/ui/page-tree/row-style", async (importOriginal) => {
  const original = await importOriginal<typeof RowStyle>();
  return {
    ...original,
    rowClassName: (...args: Parameters<typeof original.rowClassName>) => {
      renders.count += 1;
      return original.rowClassName(...args);
    },
  };
});

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/spaces/TEAM" }));

afterEach(cleanup);

const ROOTS = 20;
const CHILDREN = 99; // 20 + 20 × 99 = 2,000 pages

function bigTree(): PageSummary[] {
  const pages: PageSummary[] = [];
  for (let r = 0; r < ROOTS; r++) {
    pages.push(page(`r${r}`, `Root ${r}`, null, r));
    for (let c = 0; c < CHILDREN; c++) pages.push(page(`r${r}c${c}`, `Page ${r}.${c}`, `r${r}`, c));
  }
  return pages;
}

function Harness({ pages }: { readonly pages: PageSummary[] }) {
  const [text, setText] = useState("");
  const allOpen = JSON.stringify(Array.from({ length: ROOTS }, (_, r) => `r${r}`));
  return (
    <PageTreeProvider
      spaceKey="TEAM"
      canEdit
      initial={{ status: "ready", pages }}
      fetchImpl={fakeApi().fetchImpl}
      storage={() => ({ getItem: () => allOpen, setItem: () => undefined })}
    >
      <input aria-label="elsewhere" value={text} onChange={(e) => setText(e.target.value)} />
      <PageTree variant="sidebar" label={t("tree.label")} />
    </PageTreeProvider>
  );
}

/** One dragover `y` pixels into a 40-pixel row, dispatched directly (no harness overhead); returns its milliseconds. */
function dragOverAt(target: HTMLElement, y: number): number {
  target.getBoundingClientRect = () => ({ top: 0, bottom: 40, height: 40, left: 0, right: 200, width: 200, x: 0, y: 0, toJSON: () => ({}) });
  const event = new Event("dragover", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clientY", { value: y });
  Object.defineProperty(event, "dataTransfer", { value: { effectAllowed: "move", dropEffect: "none", types: [PAGE_DRAG_TYPE], setData: () => undefined } });
  const started = performance.now();
  act(() => {
    target.dispatchEvent(event);
  });
  return performance.now() - started;
}

const rowOf = (id: string) => (document.querySelector(`[data-tree-id="${id}"]`) as HTMLElement).firstElementChild as HTMLElement;

describe("PageTree with 2,000 pages", () => {
  it("renders every row once on load, then only the rows that change", () => {
    const started = performance.now();
    render(<Harness pages={bigTree()} />);
    const mountMs = performance.now() - started;
    expect(screen.getAllByRole("treeitem")).toHaveLength(2000);
    // First render (roots, closed) + the remembered pages opening after hydration.
    expect(renders.count).toBeLessThan(2000 + ROOTS * 2 + 10);

    // Typing elsewhere: no row renders.
    renders.count = 0;
    const input = screen.getByRole("textbox", { name: "elsewhere" });
    for (const value of ["a", "ab", "abc"]) fireEvent.change(input, { target: { value } });
    expect(renders.count).toBe(0);

    // Hovering is CSS only: no row renders.
    fireEvent.mouseOver(rowOf("r3c4"));
    fireEvent.mouseEnter(rowOf("r3c4"));
    expect(renders.count).toBe(0);

    // A drag across rows: only the rows whose drop indicator changes.
    fireEvent.dragStart(rowOf("r0c0"), { dataTransfer: { effectAllowed: "move", setData: () => undefined } });
    renders.count = 0;
    const steps = [
      dragOverAt(rowOf("r5c10"), 20), // indicator appears: 1 row
      dragOverAt(rowOf("r5c10"), 21), // same zone: nothing
      dragOverAt(rowOf("r5c11"), 2), // moves to another row: 2 rows
      dragOverAt(rowOf("r5c11"), 38), // same row, another zone: 1 row
    ];
    expect(renders.count).toBe(4);
    const dragMs = steps.map((ms) => ms.toFixed(1)).join(", ");

    // Keyboard focus moving down one row: the two rows whose tab stop changes.
    const first = screen.getAllByRole("treeitem")[0] as HTMLElement;
    act(() => first.focus());
    renders.count = 0;
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(renders.count).toBe(2);

    // Closing one parent: that row only (its children unmount).
    renders.count = 0;
    fireEvent.click(rowOf("r7").querySelector("[data-toggle]") as Element);
    expect(renders.count).toBe(1);

    console.info(`[page-tree perf] jsdom, React dev build: mount of 2,000 rows ${mountMs.toFixed(0)} ms; dragover steps ${dragMs} ms`);
    // What is asserted is render counts, not time: mounting 2,000 rows in jsdom takes seconds when
    // the other test files run alongside, so the default 5 s would fail it for load alone.
  }, 30_000);
});
