import type { UserRecord } from "@/server/repositories/users";

/** The signed-in user, as use cases and pages see them. Never carries the password hash. */
export interface Actor {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly isInstanceAdmin: boolean;
  readonly sidebarCollapsed: boolean;
}

export function toActor(user: UserRecord): Actor {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isInstanceAdmin: user.isInstanceAdmin,
    sidebarCollapsed: user.sidebarCollapsed,
  };
}
