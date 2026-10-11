// @vitest-environment jsdom
// The `E` key (10 §4.1): a plain E opens the editor; never while typing, never with a modifier,
// never from a dialog or an open menu.
import { afterEach, describe, expect, it } from "vitest";
import { isEditShortcut, isShortcutBlockedTarget, type ShortcutEvent } from "../edit-shortcut";

afterEach(() => {
  document.body.innerHTML = "";
});

function press(target: EventTarget | null, over: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return { key: "e", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, target, ...over };
}

function el(html: string, selector: string): Element {
  document.body.innerHTML = html;
  const found = document.querySelector(selector);
  if (!found) throw new Error(`no ${selector}`);
  return found;
}

describe("isEditShortcut", () => {
  it("a plain e or E on the page opens the editor", () => {
    expect(isEditShortcut(press(document.body))).toBe(true);
    expect(isEditShortcut(press(document.body, { key: "E" }))).toBe(true); // Caps Lock
    expect(isEditShortcut(press(el("<button>Share</button>", "button")))).toBe(true);
    expect(isEditShortcut(press(el('<a href="/x">x</a>', "a")))).toBe(true);
    expect(isEditShortcut(press(null))).toBe(true);
  });

  it("other keys do nothing", () => {
    for (const key of ["w", "Enter", "é", "Ε" /* Greek capital epsilon */, "KeyE"]) {
      expect(isEditShortcut(press(document.body, { key }))).toBe(false);
    }
  });

  it("never with a modifier key, including Shift", () => {
    for (const mod of ["ctrlKey", "metaKey", "altKey", "shiftKey"] as const) {
      expect(isEditShortcut(press(document.body, { [mod]: true }))).toBe(false);
    }
  });

  it("never auto-repeated, mid-composition or already handled", () => {
    expect(isEditShortcut(press(document.body, { repeat: true }))).toBe(false);
    expect(isEditShortcut(press(document.body, { isComposing: true }))).toBe(false);
    expect(isEditShortcut(press(document.body, { defaultPrevented: true }))).toBe(false);
  });

  it.each([
    ['<input type="text">', "input"],
    ['<input type="checkbox">', "input"],
    ["<textarea></textarea>", "textarea"],
    ["<select><option>a</option></select>", "select"],
    ['<div contenteditable="true"><p>x</p></div>', "p"],
    ['<div contenteditable=""><span>x</span></div>', "span"],
    ['<div contenteditable="true"><span contenteditable="false"><b>chip</b></span></div>', "b"],
    ['<div role="textbox" tabindex="0"></div>', "div"],
    ['<div role="dialog"><button>OK</button></div>', "button"],
    ['<div role="alertdialog"><button>OK</button></div>', "button"],
    ['<div role="menu"><a role="menuitem" href="/h">Page History</a></div>', "a"],
    ['<ul role="tree"><li role="treeitem"><a href="/p">Specifications</a></li></ul>', "a"],
    ['<ul role="listbox"><li role="option" tabindex="0">One</li></ul>', "li"],
    ['<table role="grid"><tbody><tr><td tabindex="0">x</td></tr></tbody></table>', "td"],
  ])("never while focus is in %s", (html, selector) => {
    const target = el(html, selector);
    expect(isShortcutBlockedTarget(target)).toBe(true);
    expect(isEditShortcut(press(target))).toBe(false);
  });

  it('contenteditable="false" on its own is not an editing context', () => {
    expect(isEditShortcut(press(el('<div contenteditable="false"><span>x</span></div>', "span")))).toBe(true);
  });
});
