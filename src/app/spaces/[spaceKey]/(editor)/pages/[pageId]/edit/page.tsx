// The editor, `/spaces/{SPACE}/pages/{pageId}/edit` (10 sections 5.1 and 11). A full-window
// surface: no top bar and no sidebar — the editor's own toolbar is the top row, and its middle
// area scrolls between toolbar and footer. Needs space EDIT: a viewer without it is sent to the
// page view (which is itself a 404 for a page they cannot see); a missing or invisible page or
// space is the 404 page (RD-051).
// spec: docs/specs/10-ui-reference.md section 5.1; docs/specs/09-decision-log.md sections RD-051, RD-055
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { t } from "@/copy";
import { ForbiddenError, NotFoundError } from "@/domain/errors";
import { PageEditor } from "@/editor/ui/page-editor";
import { requireUser } from "@/server/authz/current-user";
import { getEditorState } from "@/server/usecases/pages";
import { pageHref } from "@/ui/page-view/urls";
import { editorProps } from "./_lib/editor-props";

type Props = { params: Promise<{ spaceKey: string; pageId: string }> };

/** One load per request, shared by generateMetadata and the page. */
const load = cache(async (spaceKey: string, pageId: string) => {
  const actor = await requireUser();
  return { actor, state: await getEditorState(actor, spaceKey, pageId) };
});

async function resolve({ params }: Props) {
  const { spaceKey, pageId } = await params;
  return load(spaceKey, pageId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) redirect(pageHref(spaceKey, pageId));
    throw error;
  });
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { state } = await resolve(props);
  return { title: t("pageView.editTitle", { title: state.page.title }) };
}

export default async function EditPageRoute(props: Props) {
  const { actor, state } = await resolve(props);
  return (
    <main id="main" className="h-dvh overflow-hidden">
      <PageEditor {...editorProps(state, actor)} />
    </main>
  );
}
