// Compare two versions, `/spaces/{SPACE}/pages/{pageId}/history/compare?a={n}&b={m}` (10 section
// 11, RD-060). Thin: parse a and b, load (compareVersions), build the view model, render. A
// malformed pair, an unknown version, and a space or page the viewer cannot see are all the 404
// page (RD-051, RD-072) — never a 500.
// spec: docs/specs/10-ui-reference.md section 11; docs/specs/09-decision-log.md sections RD-051, RD-060, RD-066, RD-072
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { t } from "@/copy";
import { NotFoundError } from "@/domain/errors";
import { requireUser } from "@/server/authz/current-user";
import { CompareView } from "../_components/compare-view";
import { buildCompareModel } from "../_lib/compare-model";
import { parseComparePair } from "../_lib/compare-params";
import { loadComparison } from "../_lib/load-history";

type Props = {
  params: Promise<{ spaceKey: string; pageId: string }>;
  searchParams: Promise<{ a?: string | string[]; b?: string | string[] }>;
};

/** One load per request, shared by generateMetadata and the page. */
const load = cache(async (spaceKey: string, pageId: string, a: number, b: number) => {
  const actor = await requireUser();
  return loadComparison(actor, spaceKey, pageId, { a, b });
});

async function resolve({ params, searchParams }: Props) {
  const { spaceKey, pageId } = await params;
  const pair = parseComparePair(await searchParams);
  if (pair === null) notFound();
  return load(spaceKey, pageId, pair.a, pair.b).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const input = await resolve(props);
  return { title: t("compare.windowTitle", { a: input.left.number, b: input.right.number, title: input.page.title }) };
}

export default async function CompareVersionsRoute(props: Props) {
  const model = buildCompareModel(await resolve(props));
  return <CompareView model={model} />;
}
