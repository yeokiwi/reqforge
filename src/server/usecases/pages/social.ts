// Per-user page state: Watching and Save for later (RD-061), presence (RD-062), and the
// people who can be @mentioned (08 §3 GET /people). Personal state, not page history: these
// are not audited.
import { presenceCutoff, type UserRef } from "@/domain/documents";
import { NotFoundError, ValidationError } from "@/domain/errors";
import type { Actor } from "@/server/authz/actor";
import { authorizeSpace } from "@/server/authz/space-permission";
import { PEOPLE_QUERY_MAX, listSpacePeople } from "@/server/repositories/people";
import {
  listPresence,
  prunePresence,
  setFavourite as setFavouriteRow,
  setWatching as setWatchingRow,
  touchPresence,
} from "@/server/repositories/social";
import { rootDb } from "@/server/repositories/transaction";
import { resolvePage } from "./shared";

/** Turns `Watching` on or off for the caller. Idempotent. Needs space VIEW. */
// spec: docs/specs/09-decision-log.md section RD-061 (Watching: per-user toggle); 08 §3 (PUT / DELETE /pages/{id}/watch)
export async function setWatching(actor: Actor, spaceKey: string, pageId: string, watching: boolean): Promise<void> {
  const { page } = await resolvePage(actor, spaceKey, pageId, "VIEW");
  await setWatchingRow(rootDb, page.id, actor.id, watching);
}

/** Turns `Save for later` on or off for the caller. Idempotent. Needs space VIEW. */
// spec: docs/specs/09-decision-log.md section RD-061 (Save for later: per-user toggle); 08 §3 (PUT / DELETE /pages/{id}/favourite)
export async function setFavourite(actor: Actor, spaceKey: string, pageId: string, favourite: boolean): Promise<void> {
  const { page } = await resolvePage(actor, spaceKey, pageId, "VIEW");
  await setFavouriteRow(rootDb, page.id, actor.id, favourite);
}

export interface PresenceResult {
  /** Who else has the page open — never the caller (RD-062). */
  readonly others: UserRef[];
}

/**
 * A presence heartbeat: records the caller as present and returns the OTHER users whose last
 * heartbeat is within the window (RD-062), pruning this page's expired rows on the way.
 */
// spec: docs/specs/09-decision-log.md section RD-062 (heartbeat; present for 45 s; never shown to themselves); 08 §3 (POST /pages/{id}/presence)
export async function heartbeatPresence(
  actor: Actor,
  spaceKey: string,
  pageId: string,
  now: () => Date = () => new Date(),
): Promise<PresenceResult> {
  const { page } = await resolvePage(actor, spaceKey, pageId, "VIEW");
  const at = now();
  const since = new Date(presenceCutoff(at.getTime()));
  await touchPresence(rootDb, page.id, actor.id, at);
  await prunePresence(rootDb, since, page.id);
  const others = await listPresence(rootDb, actor.id, page.id, since);
  return { others: others.map((u) => ({ id: u.id, name: u.name })) };
}

/**
 * Up to 10 users who can view the space and whose NAME starts with `query`, for @mentions —
 * never an email address, and never matched on one. Needs space VIEW.
 */
// spec: docs/specs/08-api-surface.md section 3 (GET /people); docs/specs/10-ui-reference.md section 5.5
export async function listPeople(actor: Actor, spaceKey: string, query: string): Promise<UserRef[]> {
  const space = await authorizeSpace(actor, spaceKey, "VIEW");
  if (query.includes("\u0000") || /\p{Cs}/u.test(query)) {
    throw new ValidationError([{ path: "q", message: "must be text" }]);
  }
  const q = [...query.normalize("NFC").trim()].slice(0, PEOPLE_QUERY_MAX).join("");
  const people = await listSpacePeople(rootDb, actor.id, space.id, q);
  if (!people) throw new NotFoundError("Space");
  return people.map((u) => ({ id: u.id, name: u.name }));
}
