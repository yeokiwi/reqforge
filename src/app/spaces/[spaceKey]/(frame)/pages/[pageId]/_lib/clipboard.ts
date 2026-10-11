// `⇪ Share` is copy-link only (RD-059, RD-061). The asynchronous Clipboard API exists only in
// secure contexts (https, localhost) and may be refused by a permission policy; a deployment
// served over plain http on a LAN still gets a working Share through the older select-and-copy
// path. When both fail the caller says so and the address bar remains.
// spec: docs/specs/09-decision-log.md sections RD-059 and RD-061 (`Share` is copy link only)

export interface ClipboardEnv {
  /** navigator.clipboard, which is undefined outside a secure context. */
  readonly clipboard: { writeText(text: string): Promise<void> } | undefined;
  readonly document: Document;
}

interface Focusable {
  focus(): void;
}

function isFocusable(value: unknown): value is Focusable {
  return typeof value === "object" && value !== null && typeof (value as { focus?: unknown }).focus === "function";
}

/**
 * The fallback: put the text in an off-screen read-only textarea, select it and run the
 * `copy` command. Focus goes back where it was, so the Share button keeps it.
 */
export function copyWithSelection(text: string, doc: Document): boolean {
  if (typeof doc.execCommand !== "function" || !doc.body) return false;
  const previous = doc.activeElement;
  const area = doc.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.tabIndex = -1;
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "-9999px";
  area.style.opacity = "0";
  doc.body.appendChild(area);
  let copied = false;
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    copied = doc.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    area.remove();
    if (isFocusable(previous)) previous.focus();
  }
  return copied;
}

/** Copies `text`: the Clipboard API when it is there and allowed, else the selection fallback. */
// spec: docs/specs/09-decision-log.md section RD-061 (`Share` is copy-link only)
export async function copyText(text: string, env: ClipboardEnv): Promise<boolean> {
  if (env.clipboard && typeof env.clipboard.writeText === "function") {
    try {
      await env.clipboard.writeText(text);
      return true;
    } catch {
      // Refused (no permission, document not focused): try the older path.
    }
  }
  return copyWithSelection(text, env.document);
}

/** The absolute URL Share copies: the page's own path on this origin, never a version or query. */
export function absoluteUrl(path: string, origin: string): string {
  return new URL(path, origin).toString();
}
