"use client";

// Presence (RD-062): while the editor is mounted it sends a heartbeat at once and then every
// 15 s, and shows the OTHER users the server reports. The server already leaves the caller out;
// the editor filters again so a user is never shown to themselves even if it did not. A failed
// heartbeat keeps the last list until it is older than the 45 s presence window, so one dropped
// request does not make avatars flicker. Unmounting stops the timer and aborts a request in flight.
// spec: docs/specs/09-decision-log.md section RD-062; docs/specs/10-ui-reference.md section 5.1 (presence avatars)
import { useEffect, useRef, useState } from "react";
import type { UserRef } from "@/domain/documents/api-types";
import { LIMITS } from "@/domain/documents/limits";

/** The users to show: everyone but `meId`, each once, in the server's order. */
// spec: docs/specs/09-decision-log.md section RD-062 (a user is never shown to themselves)
export function othersOf(users: readonly UserRef[], meId: string): UserRef[] {
  const seen = new Set<string>([meId]);
  const out: UserRef[] = [];
  for (const user of users) {
    if (seen.has(user.id)) continue;
    seen.add(user.id);
    out.push(user);
  }
  return out;
}

function sameUsers(a: readonly UserRef[], b: readonly UserRef[]): boolean {
  return a.length === b.length && a.every((user, i) => user.id === b[i]?.id && user.name === b[i]?.name);
}

export interface PresenceOptions {
  readonly intervalMs?: number;
  /** For tests. */
  readonly now?: () => number;
}

/** The other users who have this page open, refreshed by a heartbeat (RD-062). */
// spec: docs/specs/09-decision-log.md section RD-062 (heartbeat every 15 s; present for 45 s)
export function usePresence(
  heartbeat: (signal: AbortSignal) => Promise<readonly UserRef[]>,
  meId: string,
  { intervalMs = LIMITS.presenceHeartbeatMs, now = Date.now }: PresenceOptions = {},
): readonly UserRef[] {
  const [others, setOthers] = useState<readonly UserRef[]>([]);
  const heartbeatRef = useRef(heartbeat);
  const nowRef = useRef(now);

  useEffect(() => {
    heartbeatRef.current = heartbeat;
    nowRef.current = now;
  });

  useEffect(() => {
    let stopped = false;
    let controller: AbortController | null = null;
    let lastSuccess = nowRef.current();
    const update = (next: readonly UserRef[]) => setOthers((current) => (sameUsers(current, next) ? current : next));

    const beat = async () => {
      controller?.abort();
      const mine = new AbortController();
      controller = mine;
      try {
        const users = await heartbeatRef.current(mine.signal);
        if (stopped || mine.signal.aborted) return;
        lastSuccess = nowRef.current();
        update(othersOf(users, meId));
      } catch {
        if (stopped || mine.signal.aborted) return;
        if (nowRef.current() - lastSuccess > LIMITS.presenceWindowMs) update([]);
      }
    };

    void beat();
    const timer = setInterval(() => void beat(), intervalMs);
    return () => {
      stopped = true;
      clearInterval(timer);
      controller?.abort();
    };
  }, [meId, intervalMs]);

  return others;
}
