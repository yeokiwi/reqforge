// @vitest-environment jsdom
// The shared modal dialog: WAI-ARIA dialog contract (name, focus in, trap, Escape, restore).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog, Dialog } from "../dialog";

afterEach(cleanup);

function Host({ onDismiss = vi.fn() }: { readonly onDismiss?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        opener
      </button>
      {open ? (
        <Dialog
          title="Title"
          description="Body text"
          onDismiss={() => {
            onDismiss();
            setOpen(false);
          }}
        >
          <input aria-label="first" />
          <button type="button">last</button>
        </Dialog>
      ) : null}
    </>
  );
}

describe("Dialog", () => {
  it("is a modal dialog named by its title and described by its body", () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "opener" }));
    const dialog = screen.getByRole("dialog", { name: "Title" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy as string)?.textContent).toBe("Body text");
  });

  it("moves focus in, keeps Tab inside, and gives focus back on Escape", () => {
    const onDismiss = vi.fn();
    render(<Host onDismiss={onDismiss} />);
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByLabelText("first"));
    const last = screen.getByRole("button", { name: "last" });
    last.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByLabelText("first"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("dismisses on a press on the backdrop but not inside the panel", () => {
    const onDismiss = vi.fn();
    render(<Host onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "opener" }));
    fireEvent.pointerDown(screen.getByRole("dialog"));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("ConfirmDialog", () => {
  it("focuses the safe answer and reports each choice", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog title="Sure?" description="It cannot be undone." confirmLabel="Do it" cancelLabel="Back" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Do it" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
