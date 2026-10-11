// Page History, `/spaces/{SPACE}/pages/{pageId}/history` (10 sections 11 and 23). Thin: load
// (getPageView + listVersions), build the view model, render. A space or page the viewer cannot
// see is the 404 page (RD-051).
// spec: docs/specs/10-ui-reference.md sections 11 and 23; docs/specs/09-decision-log.md sections RD-051, RD-060
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { t } from "@/copy";
import { NotFoundError } from "@/domain/errors";
import { requireUser } from "@/server/authz/current-user";
import { CompareButton } from "@/ui/page-history/compare-button";
import { HistoryProvider } from "@/ui/page-history/history-context";
import { HistoryNoticeLine } from "@/ui/page-history/history-notice";
import { HistoryBreadcrumb } from "./_components/history-breadcrumb";
import { HistoryTable } from "./_components/history-table";
import { buildHistoryModel } from "./_lib/history-model";
import { loadHistory } from "./_lib/load-history";

type Props = { params: Promise<{ spaceKey: string; pageId: string }> };

/** One load per request, shared by generateMetadata and the page. */
const load = cache(async (spaceKey: string, pageId: string) => {
  const actor = await requireUser();
  return loadHistory(actor, spaceKey, pageId);
});

async function resolve({ params }: Props) {
  const { spaceKey, pageId } = await params;
  return load(spaceKey, pageId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const screen = await resolve(props);
  return { title: t("history.windowTitle", { title: screen.page.title }) };
}

export default async function PageHistoryRoute(props: Props) {
  const model = buildHistoryModel(await resolve(props));

  return (
    <article className="mx-auto max-w-5xl" data-testid="page-history">
      <HistoryBreadcrumb crumbs={model.crumbs} />
      <h1 className="mt-4 text-2xl font-semibold text-slate-900">{t("history.title")}</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-700">{t("history.intro")}</p>
      <HistoryProvider
        key={model.pageId}
        spaceKey={model.spaceKey}
        pageId={model.pageId}
        versions={model.versions}
        initialSelected={model.initialSelected}
      >
        <CompareButton />
        <HistoryNoticeLine />
        <HistoryTable title={model.title} rows={model.rows} />
      </HistoryProvider>
    </article>
  );
}
