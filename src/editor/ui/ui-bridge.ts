// How the editor's ProseMirror plugins reach the React UI around them. Extensions are built once,
// when the editor is created, but the UI's handlers change on every render; the bridge is the one
// stable object the extensions hold, and the page editor swaps the handlers in it. A plugin asks
// the bridge to open the find bar, the keyboard shortcuts, the link dialog, the macro browser or
// a node's editor, or to upload files; without a handler (a headless editor in a test) the call
// does nothing and reports that it did nothing, so the key falls through to the next binding.
//
// The bridge also remembers which attachments belong to this page (RD-058): the images the
// editor opened with and everything uploaded since. A pasted image of any other attachment is
// dropped, because the server refuses an image that is not an attachment of this page and
// would then refuse every autosave after the paste.
// spec: docs/specs/09-decision-log.md sections RD-057 (`🔍`, `?`, `+ ▾`) and RD-058 (images only from this page's attachments)
import type { MacroSuggestionController } from "./suggestion";

/** A status lozenge or a date the user asked to edit, by its position in the document. */
export interface NodeEditTarget {
  readonly kind: "status" | "date";
  readonly pos: number;
}

export interface EditorUiHandlers {
  openLink(): void;
  openFind(): void;
  openShortcuts(): void;
  openMacroBrowser(): void;
  editNode(target: NodeEditTarget): void;
  /** Upload and insert files; `pos` is where (null: at the selection). */
  uploadFiles(files: readonly File[], pos: number | null): void;
  /** A macro was inserted (for the `{` list's recency order). */
  macroInserted(id: string): void;
}

export class EditorUiBridge {
  private handlers: Partial<EditorUiHandlers> = {};
  private readonly knownAttachments = new Set<string>();

  constructor(
    /** The `{` Macro suggestions list's state, shared by the plugin and the React list. */
    readonly suggestions: MacroSuggestionController | null = null,
  ) {}

  setHandlers(handlers: Partial<EditorUiHandlers>): void {
    this.handlers = handlers;
  }

  /** Calls a handler; false when there is none (the caller lets the key fall through). */
  call<K extends keyof EditorUiHandlers>(name: K, ...args: Parameters<EditorUiHandlers[K]>): boolean {
    const handler = this.handlers[name] as ((...a: Parameters<EditorUiHandlers[K]>) => void) | undefined;
    if (!handler) return false;
    handler(...args);
    return true;
  }

  /** An attachment of this page: in the document the editor opened, or uploaded since. */
  rememberAttachment(id: string): void {
    this.knownAttachments.add(id);
  }

  isKnownAttachment(id: string): boolean {
    return this.knownAttachments.has(id);
  }
}
