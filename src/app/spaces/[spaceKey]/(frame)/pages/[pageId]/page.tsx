// The page view, `/spaces/{SPACE}/pages/{pageId}[?version=N]` (10 sections 4 and 11). Thin:
// parse, load (two use cases, one call), build the view model, render. An unknown or invisible
// space, page or version — and a malformed `?version` — is the 404 page: a viewer without
// access never learns the page exists (RD-051).
// spec: docs/specs/10-ui-reference.md sections 4 and 11; docs/specs/09-decision-log.md sections RD-051, RD-055, RD-059, RD-060, RD-078
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { NotFoundError } from "@/domain/errors";
import { DocumentView } from "@/editor/render/document-view";
import { requireUser } from "@/server/authz/current-user";
import { PageByline } from "@/ui/page-view/byline";
import { DraftNotice } from "./_components/draft-notice";
import { PageFooter } from "./_components/page-footer";
import { PageHeader } from "./_components/page-header";
import { VersionBanner } from "./_components/version-banner";
import { loadPageScreen } from "./_lib/load-page";
import { parseVersionParam } from "./_lib/version-param";
import { buildPageViewModel } from "./_lib/view-model";

type Props = {
  params: Promise<{ spaceKey: string; pageId: string }>;
  searchParams: Promise<{ version?: string | string[] }>;
};

/** One load per request, shared by generateMetadata and the page. */
const load = cache(async (spaceKey: string, pageId: string, version: number | undefined) => {
  const actor = await requireUser();
  return loadPageScreen(actor, spaceKey, pageId, version);
});

async function resolve({ params, searchParams }: Props) {
  const { spaceKey, pageId } = await params;
  const version = parseVersionParam((await searchParams).version);
  if (version.kind === "invalid") notFound();
  return load(spaceKey, pageId, version.kind === "version" ? version.number : undefined).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const screen = await resolve(props);
  return { title: screen.version.title };
}

export default async function PageViewRoute(props: Props) {
  const screen = await resolve(props);
  const view = buildPageViewModel(screen, new Date());

  return (
    <article className="mx-auto max-w-5xl" data-testid="page-view">
      <PageHeader
        space={view.space}
        page={view.page}
        pages={view.pages}
        crumbs={view.crumbs}
        viewHref={view.hrefs.view}
        editHref={view.canEditHere ? view.hrefs.edit : null}
      />
      {view.pastVersion !== null ? <VersionBanner version={view.pastVersion} currentHref={view.hrefs.view} /> : null}
      {view.showDraftNotice ? <DraftNotice spaceKey={view.space.key} pageId={view.page.id} editHref={view.hrefs.edit} /> : null}
      <h1 className="mt-4 break-words text-3xl font-semibold text-slate-900">{view.title}</h1>
      <PageByline byline={view.byline} />
      <DocumentView content={view.content} className="mt-6" />
      <PageFooter />
    </article>
  );
}
