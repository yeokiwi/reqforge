// Repository-internal plumbing. Only files under src/server/repositories/** may import this
// module (a unit test in __tests__/boundary.test.ts enforces it): it turns the opaque `Db`
// handle back into a Prisma client, which is exactly what use cases must never hold.
import type { Prisma } from "@prisma/client";
import type { Db } from "./transaction";

/** The Prisma surface a repository function may use: the root client or a transaction client. */
export type Client = Prisma.TransactionClient;

export function clientOf(db: Db): Client {
  return db as unknown as Client;
}

/** Wraps a Prisma client (root or transaction) as an opaque handle. */
export function handleOf<H extends Db>(client: Client): H {
  return client as unknown as H;
}
