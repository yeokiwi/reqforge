// Use case: everything the application shell (spec 10 §2–3) needs to render.
import type { Actor } from "@/server/authz/actor";
import { getSpace, listMySpaces, type SpaceView } from "./spaces";

export const RECENT_SPACES_SHOWN = 5;

export interface SpaceLink {
  readonly key: string;
  readonly name: string;
}

export interface ShellContext {
  readonly user: { readonly name: string; readonly email: string; readonly isInstanceAdmin: boolean };
  /** `Spaces ▾` — most recently viewed first (10 §2). */
  readonly recentSpaces: readonly SpaceLink[];
  /** Spaces the `Create` button can offer outside a space (10 §2). */
  readonly creatableSpaces: readonly SpaceLink[];
  /** The space whose sidebar is shown, or null on spaceless screens. */
  readonly space: SpaceView | null;
  readonly sidebarCollapsed: boolean;
}

const link = (s: SpaceView): SpaceLink => ({ key: s.key, name: s.name });

export async function getShellContext(actor: Actor, spaceKey?: string): Promise<ShellContext> {
  const [spaces, space] = await Promise.all([
    listMySpaces(actor),
    spaceKey === undefined ? Promise.resolve(null) : getSpace(actor, spaceKey),
  ]);

  // The layout renders alongside the page that records this visit, so the database may not
  // have it yet. The space being viewed is the most recent one by definition: put it first
  // instead of depending on which write lands first.
  const recentSpaces = spaces
    .filter((s) => s.lastViewedAt && s.key !== space?.key)
    .sort((a, b) => (b.lastViewedAt?.getTime() ?? 0) - (a.lastViewedAt?.getTime() ?? 0))
    .map(link);
  if (space) recentSpaces.unshift(link(space));
  recentSpaces.length = Math.min(recentSpaces.length, RECENT_SPACES_SHOWN);

  return {
    user: { name: actor.name, email: actor.email, isInstanceAdmin: actor.isInstanceAdmin },
    recentSpaces,
    creatableSpaces: spaces.filter((s) => s.access.canEdit).map(link),
    space,
    sidebarCollapsed: actor.sidebarCollapsed,
  };
}
