// Use cases for spaces as the signed-in user may see them. Every function takes the actor:
// a space the actor cannot VIEW does not exist as far as they are concerned (rule X2).
import { NotFoundError } from "@/domain/errors";
import { evaluateSpaceAccess, type SpaceAccess } from "@/domain/permissions/space-access";
import { canonicalSpaceKey } from "@/domain/spaces/space-key";
import type { Actor } from "@/server/authz/actor";
import {
  findVisibleSpaceByKey,
  listVisibleSpaces,
  setSpaceFavourite,
  touchSpaceViewed,
  type SpaceSummary,
} from "@/server/repositories/spaces";
import { setSidebarCollapsed } from "@/server/repositories/users";

export interface SpaceView {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly classification: string | null;
  readonly favourite: boolean;
  readonly lastViewedAt: Date | null;
  readonly access: SpaceAccess;
}

function toView(space: SpaceSummary): SpaceView {
  return {
    id: space.id,
    key: space.key,
    name: space.name,
    classification: space.classification,
    favourite: space.favourite,
    lastViewedAt: space.lastViewedAt,
    access: evaluateSpaceAccess(space.grants),
  };
}

/** Starred spaces first, then by name. */
export async function listMySpaces(actor: Actor): Promise<SpaceView[]> {
  const spaces = (await listVisibleSpaces(actor.id)).map(toView);
  return spaces.sort((a, b) => Number(b.favourite) - Number(a.favourite) || a.name.localeCompare(b.name));
}

/** One space by (case-insensitive) key. NotFoundError for unknown, malformed or invisible keys. */
export async function getSpace(actor: Actor, rawKey: string): Promise<SpaceView> {
  const key = canonicalSpaceKey(rawKey);
  if (!key) throw new NotFoundError("Space");
  const space = await findVisibleSpaceByKey(actor.id, key);
  if (!space) throw new NotFoundError("Space");
  return toView(space);
}

/** Opens a space: returns it and records the visit for the `Spaces ▾` menu. */
export async function openSpace(actor: Actor, rawKey: string, now: () => Date = () => new Date()): Promise<SpaceView> {
  const space = await getSpace(actor, rawKey);
  const at = now();
  await touchSpaceViewed(actor.id, space.id, at);
  return { ...space, lastViewedAt: at };
}

export async function setFavourite(actor: Actor, rawKey: string, favourite: boolean): Promise<void> {
  const space = await getSpace(actor, rawKey);
  await setSpaceFavourite(actor.id, space.id, favourite);
}

export async function setSidebarCollapsedFor(actor: Actor, collapsed: boolean): Promise<void> {
  await setSidebarCollapsed(actor.id, collapsed);
}

/** Where `/` sends someone: last visited space, else a starred one, else the first by name. */
export async function chooseLandingSpace(actor: Actor): Promise<SpaceView | null> {
  const spaces = (await listVisibleSpaces(actor.id)).map(toView);
  const byRecency = spaces
    .filter((s) => s.lastViewedAt)
    .sort((a, b) => (b.lastViewedAt?.getTime() ?? 0) - (a.lastViewedAt?.getTime() ?? 0));
  if (byRecency[0]) return byRecency[0];
  const starred = spaces.filter((s) => s.favourite).sort((a, b) => a.name.localeCompare(b.name));
  return starred[0] ?? [...spaces].sort((a, b) => a.name.localeCompare(b.name))[0] ?? null;
}
