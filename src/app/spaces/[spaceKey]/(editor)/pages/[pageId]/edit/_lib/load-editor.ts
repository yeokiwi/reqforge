// What the editor route loads, and where it sends a viewer who cannot edit. getEditorState
// needs space EDIT (07 §2.4). Its refusals, in the order resolvePage gives them (RD-072):
//   - the space is not visible, or the page is not a visible live page of it → NotFoundError
//     → the 404 page: a viewer without access never learns the page exists (RD-051);
//   - the space is visible but the viewer lacks EDIT → ForbiddenError → the page view, which
//     shows the page, or is itself the 404 page when the id names no page. Being sent there
//     reveals nothing: the answer is the same for every page id.
// spec: docs/specs/10-ui-reference.md sections 5.1 and 11; docs/specs/09-decision-log.md sections RD-051, RD-055, RD-072
import { t } from "@/copy";
import { ForbiddenError, NotFoundError } from "@/domain/errors";
import type { PageEditorProps } from "@/editor/ui/page-editor";
import type { Actor } from "@/server/authz/actor";
import { getEditorState } from "@/server/usecases/pages";
import { pageHref } from "@/ui/page-view/urls";
import { editorProps } from "./editor-props";

export type EditorScreen =
  /** The viewer may edit: open the editor (on their own draft if they have one, RD-055). */
  | { readonly kind: "editor"; readonly props: PageEditorProps; readonly windowTitle: string }
  /** The viewer may see the space but not edit it: go to the page view instead. */
  | { readonly kind: "view"; readonly href: string }
  /** No such page for this viewer: the 404 page. */
  | { readonly kind: "missing" };

/** The editor for `pageId` in `spaceKey` as `actor` may open it. Other errors propagate. */
// spec: docs/specs/07-permissions-and-limits.md section 2.4 (edit needs space EDIT); docs/specs/09-decision-log.md sections RD-051, RD-055
export async function loadEditorScreen(actor: Actor, spaceKey: string, pageId: string): Promise<EditorScreen> {
  try {
    const state = await getEditorState(actor, spaceKey, pageId);
    return {
      kind: "editor",
      props: editorProps(state, actor),
      windowTitle: t("pageView.editTitle", { title: state.page.title }),
    };
  } catch (error) {
    if (error instanceof NotFoundError) return { kind: "missing" };
    if (error instanceof ForbiddenError) return { kind: "view", href: pageHref(spaceKey, pageId) };
    throw error;
  }
}
