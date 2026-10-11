// The space overview, `/spaces/{SPACE}[?highlight={pageId}]` (10 §11): the space's page tree.
// Thin: authorise and record the visit (openSpace, which is what puts the space in `Spaces ▾`),
// load the tree (shared with AppFrame's load in the same request), render. An unknown or
// invisible space is the 404 page (RD-051).
// spec: docs/specs/10-ui-reference.md sections 11 and 12; docs/specs/09-decision-log.md sections RD-051, RD-056, RD-059
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NotFoundError } from "@/domain/errors";
import { requireUser } from "@/server/authz/current-user";
import { openSpace } from "@/server/usecases/spaces";
import { SpaceOverview } from "./_components/space-overview";
import { loadFrameTree } from "./_lib/load-tree";
import { highlightFromParam } from "./_lib/overview";

type Props = {
  params: Promise<{ spaceKey: string }>;
  searchParams: Promise<{ highlight?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // Metadata runs without recording a visit; an unknown space simply gets the default title.
  const { spaceKey } = await params;
  return { title: spaceKey.toUpperCase() };
}

export default async function SpaceOverviewPage({ params, searchParams }: Props) {
  const user = await requireUser();
  const { spaceKey } = await params;
  const space = await openSpace(user, spaceKey).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const tree = await loadFrameTree(user, spaceKey);
  const highlightId = highlightFromParam((await searchParams).highlight, tree);

  return <SpaceOverview space={{ key: space.key, name: space.name }} initial={tree} highlightId={highlightId} />;
}
