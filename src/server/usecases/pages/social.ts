// Per-user page state: Watching and Save for later (RD-061), presence (RD-062), and the
// people who can be @mentioned (08 §3 GET /people).
//
// Audit (07 §6): turning Watching or Save for later on or off writes an audit row — Watching
// decides who a notification reaches, so "who stopped watching, and when" is a fair question.
// A toggle that changes nothing writes none. The presence heartbeat writes NONE: it fires every
// 15 s per open editor into a log that is append-only and never pruned. That is a deviation from
// 07 §6 the phase report raises for a decision-log entry.
import { presenceCutoff, type UserRef } from "@/domain/documents";
import { NotFoundError, ValidationError } from "@/domain/errors";
import type { Actor } from "@/server/authz/actor";
import { authorizeSpace } from "@/server/authz/space-permission";
import { PEOPLE_QUERY_MAX, listSpacePeople } from "@/server/repositories/people";
import {
  isFavourite,
  isWatching,
  listPresence,
  prunePresence,
  setFavourite as setFavouriteRow,
  setWatching as setWatchingRow,
  touchPresence,
} from "@/server/repositories/social";
import { rootDb, transaction } from "@/server/repositories/transaction";
import { auditPage, resolvePage } from "./shared";

/**
 * Turns `Watching` on or off for the caller. Idempotent; a change is audited (`page.watch` /
 * `page.unwatch`) in the transaction that makes it, a no-op is not. Needs space VIEW.
 */
// spec: docs/specs/09-decision-log.md section RD-061 (Watching: per-user toggle); 08 §3 (PUT / DELETE /pages/{id}/watch); 07 §6 (audit)
export async function setWatching(actor: Actor, spaceKey: string, pageId: string, watching: boolean): Promise<void> {
  const { space, page } = await resolvePage(actor, spaceKey, pageId, "VIEW");
  await transaction(async (tx) => {
    if ((await isWatching(tx, page.id, actor.id)) === watching) return;
    await setWatchingRow(tx, page.id, actor.id, watching);
    await auditPage(tx, actor, space.id, page.id, watching ? "page.watch" : "page.unwatch", {});
  });
}

/**
 * Turns `Save for later` on or off for the caller. Idempotent; a change is audited
 * (`page.favourite` / `page.unfavourite`), a no-op is not. Needs space VIEW.
 */
// spec: docs/specs/09-decision-log.md section RD-061 (Save for later: per-user toggle); 08 §3 (PUT / DELETE /pages/{id}/favourite); 07 §6 (audit)
export async function setFavourite(actor: Actor, spaceKey: string, pageId: string, favourite: boolean): Promise<void> {
  const { space, page } = await resolvePage(actor, spaceKey, pageId, "VIEW");
  await transaction(async (tx) => {
    if ((await isFavourite(tx, page.id, actor.id)) === favourite) return;
    await setFavouriteRow(tx, page.id, actor.id, favourite);
    await auditPage(tx, actor, space.id, page.id, favourite ? "page.favourite" : "page.unfavourite", {});
  });
}

export interface PresenceResult {
  /** Who else has the page open — never the caller (RD-062). */
  readonly others: UserRef[];
}

/**
 * A presence heartbeat: records the caller as present and returns the OTHER users whose last
 * heartbeat is within the window (RD-062), pruning this page's expired rows on the way. Not
 * audited (see the top of this file).
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
  // Bounded before NFC, whose cost grows quadratically with a run of combining marks (RD-085).
  const q = [...query.slice(0, PEOPLE_QUERY_MAX * 8).normalize("NFC").trim()].slice(0, PEOPLE_QUERY_MAX).join("");
  const people = await listSpacePeople(rootDb, actor.id, space.id, q);
  if (!people) throw new NotFoundError("Space");
  return people.map((u) => ({ id: u.id, name: u.name }));
}
