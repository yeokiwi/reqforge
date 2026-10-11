// The editor, `/spaces/{SPACE}/pages/{pageId}/edit` (10 sections 5.1 and 11). A full-window
// surface: no top bar and no sidebar — the editor's own toolbar is the top row, and its middle
// area scrolls between toolbar and footer. Needs space EDIT: a viewer without it is sent to the
// page view (which is itself a 404 for a page they cannot see); a missing or invisible page or
// space is the 404 page (RD-051). The decisions are in _lib/load-editor.ts.
// spec: docs/specs/10-ui-reference.md section 5.1; docs/specs/09-decision-log.md sections RD-051, RD-055
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { PageEditor } from "@/editor/ui/page-editor";
import { requireUser } from "@/server/authz/current-user";
import { loadEditorScreen } from "./_lib/load-editor";

type Props = { params: Promise<{ spaceKey: string; pageId: string }> };

/** One load per request, shared by generateMetadata and the page. */
const load = cache(async (spaceKey: string, pageId: string) => loadEditorScreen(await requireUser(), spaceKey, pageId));

async function resolve({ params }: Props) {
  const { spaceKey, pageId } = await params;
  const screen = await load(spaceKey, pageId);
  if (screen.kind === "missing") notFound();
  if (screen.kind === "view") redirect(screen.href);
  return screen;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const screen = await resolve(props);
  return { title: screen.windowTitle };
}

export default async function EditPageRoute(props: Props) {
  const screen = await resolve(props);
  return (
    <main id="main" className="h-screen overflow-hidden supports-[height:100dvh]:h-dvh">
      <PageEditor {...screen.props} />
    </main>
  );
}
