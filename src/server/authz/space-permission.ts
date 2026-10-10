// Space-level authorisation for use cases (spec 07 §2.1 and §2.4, RD-051).
import { ForbiddenError } from "@/domain/errors";
import { getSpace, type SpaceView } from "@/server/usecases/spaces";
import type { Actor } from "./actor";

/** What an action needs in a space. EXPORT is not needed by any page action (07 §2.4). */
export type SpaceNeed = "VIEW" | "EDIT" | "ADMIN";

/** Whether the access evaluated for a space grants `need` (every need implies VIEW, RD-051). */
export function grants(space: SpaceView, need: SpaceNeed): boolean {
  switch (need) {
    case "VIEW":
      return space.access.canView;
    case "EDIT":
      return space.access.canEdit;
    case "ADMIN":
      return space.access.canAdmin;
  }
}

/**
 * The space, when the actor may do `need` in it. A space the actor cannot VIEW is
 * NotFoundError — the same answer as a space that was never created (RD-051, 404 not 403); a
 * visible space without the permission is ForbiddenError.
 */
// spec: docs/specs/07-permissions-and-limits.md sections 2.1 and 2.4; docs/specs/09-decision-log.md section RD-051
export async function authorizeSpace(actor: Actor, spaceKey: string, need: SpaceNeed): Promise<SpaceView> {
  const space = await getSpace(actor, spaceKey);
  if (!grants(space, need)) throw new ForbiddenError(`${need} in this space`);
  return space;
}
