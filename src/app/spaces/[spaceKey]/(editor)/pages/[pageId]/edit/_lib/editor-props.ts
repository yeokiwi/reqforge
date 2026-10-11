// What the editor route hands <PageEditor> (10 section 5.1), from the use case's EditorState and
// the signed-in user. Pure, so the mapping is tested without a browser or a database.
// spec: docs/specs/10-ui-reference.md section 5.1; docs/specs/09-decision-log.md sections RD-055, RD-078
import type { PageEditorProps } from "@/editor/ui/page-editor";
import type { EditorState } from "@/server/usecases/pages";
import { pageHistoryHref, pageHref } from "@/ui/page-view/urls";

/**
 * Space and page as stored (the space key is canonical), the starting state as returned (the
 * viewer's draft if they have one, RD-055), and the two ways out: Update/Close go to the page
 * view, `···` → Page history to the history screen. `restricted` is false until restrictions
 * exist (slice 16).
 */
// spec: docs/specs/10-ui-reference.md sections 5.1 and 11
export function editorProps(state: EditorState, me: { readonly id: string; readonly name: string }): PageEditorProps {
  const spaceKey = state.space.key;
  return {
    space: { key: spaceKey, name: state.space.name },
    page: {
      id: state.page.id,
      title: state.page.title,
      ancestors: state.page.ancestors.map((a) => ({ id: a.id, title: a.title })),
      restricted: false,
    },
    initial: {
      title: state.initial.title,
      content: state.initial.content,
      baseVersion: state.initial.baseVersion,
      fromDraft: state.initial.fromDraft,
    },
    me: { id: me.id, name: me.name },
    viewHref: pageHref(spaceKey, state.page.id),
    historyHref: pageHistoryHref(spaceKey, state.page.id),
  };
}
