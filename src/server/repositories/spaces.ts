import type { Prisma } from "@prisma/client";
import type { SpacePermission } from "@/domain/permissions/space-access";
import { prisma } from "./client";

/** A space as one particular user may see it. */
export interface SpaceSummary {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly classification: string | null;
  /** One entry per membership row that applies to the user (direct or via a group). */
  readonly grants: readonly (readonly SpacePermission[])[];
  readonly favourite: boolean;
  readonly lastViewedAt: Date | null;
}

// Visibility predicate (spec 07 §2, rule X2 applied to spaces): a space exists for a user
// only if some membership that applies to them — directly or through a group — carries VIEW.
// There is deliberately no function here that lists spaces without a viewer.
function applicableTo(userId: string): Prisma.MembershipWhereInput {
  return { OR: [{ userId }, { group: { members: { some: { userId } } } }] };
}

function visibleTo(userId: string): Prisma.SpaceWhereInput {
  return { memberships: { some: { AND: [applicableTo(userId), { permissions: { has: "VIEW" } }] } } };
}

const summarySelect = (userId: string) =>
  ({
    id: true,
    key: true,
    name: true,
    classification: true,
    memberships: { where: applicableTo(userId), select: { permissions: true } },
    userStates: { where: { userId }, select: { favourite: true, lastViewedAt: true } },
  }) satisfies Prisma.SpaceSelect;

type Row = Prisma.SpaceGetPayload<{ select: ReturnType<typeof summarySelect> }>;

function toSummary(row: Row): SpaceSummary {
  const state = row.userStates[0];
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    classification: row.classification,
    grants: row.memberships.map((m) => m.permissions),
    favourite: state?.favourite ?? false,
    lastViewedAt: state?.lastViewedAt ?? null,
  };
}

export async function listVisibleSpaces(userId: string): Promise<SpaceSummary[]> {
  const rows = await prisma.space.findMany({
    where: visibleTo(userId),
    select: summarySelect(userId),
    orderBy: { name: "asc" },
  });
  return rows.map(toSummary);
}

/** `key` must already be canonical (see canonicalSpaceKey). */
export async function findVisibleSpaceByKey(userId: string, key: string): Promise<SpaceSummary | null> {
  const row = await prisma.space.findFirst({
    where: { AND: [{ key }, visibleTo(userId)] },
    select: summarySelect(userId),
  });
  return row ? toSummary(row) : null;
}

export async function touchSpaceViewed(userId: string, spaceId: string, at: Date): Promise<void> {
  await prisma.userSpaceState.upsert({
    where: { userId_spaceId: { userId, spaceId } },
    create: { userId, spaceId, lastViewedAt: at },
    update: { lastViewedAt: at },
  });
}

export async function setSpaceFavourite(userId: string, spaceId: string, favourite: boolean): Promise<void> {
  await prisma.userSpaceState.upsert({
    where: { userId_spaceId: { userId, spaceId } },
    create: { userId, spaceId, favourite },
    update: { favourite },
  });
}
