// Presence (RD-062): an open editor sends a heartbeat every LIMITS.presenceHeartbeatMs, and
// a user counts as present for LIMITS.presenceWindowMs after their last one. Times are
// epoch milliseconds. Leaving the caller out of the list ("never shown to themselves") is
// the query's job, not this module's.

import { LIMITS } from "./limits";

/**
 * The oldest heartbeat that still counts as present at `nowMs`. Inclusive: query with
 * `lastSeenAt >= cutoff`.
 */
// spec: docs/specs/09-decision-log.md section RD-062 (present for 45 s after the last heartbeat)
export function presenceCutoff(nowMs: number): number {
  return nowMs - LIMITS.presenceWindowMs;
}

/**
 * Whether a heartbeat at `lastSeenAtMs` still counts at `nowMs`: within the window,
 * boundary included. A heartbeat from the future (clock skew between servers) counts.
 */
// spec: docs/specs/09-decision-log.md section RD-062
export function isPresent(lastSeenAtMs: number, nowMs: number): boolean {
  return lastSeenAtMs >= presenceCutoff(nowMs);
}
