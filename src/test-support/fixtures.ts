// Fixtures for integration tests: a freshly truncated, freshly seeded demo instance.
import { DEMO, seedDemo } from "../../prisma/seed-data";
import { toActor, type Actor } from "@/server/authz/actor";
import { prisma } from "@/server/repositories/client";
import { findUserByEmail } from "@/server/repositories/users";
import { truncateAll } from "./database";

export const TEST_PASSWORD = "test-password-123";

export { DEMO, prisma };

/** Empties the database and re-seeds the demo instance (two spaces, three users). */
export async function resetDemoInstance(): Promise<void> {
  await truncateAll(prisma);
  await seedDemo(prisma, { password: TEST_PASSWORD });
}

export type Handle = keyof typeof DEMO.users;

export async function actorFor(handle: Handle): Promise<Actor> {
  const user = await findUserByEmail(DEMO.users[handle].email);
  if (!user) throw new Error(`demo user ${handle} is missing — did resetDemoInstance run?`);
  return toActor(user);
}
