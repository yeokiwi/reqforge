// `prisma validate` insists that env("DATABASE_URL") resolves even though validation never
// connects. Supply a placeholder so `pnpm verify` works on a clean clone and in CI.
import { spawnSync } from "node:child_process";

const env = { ...process.env };
env.DATABASE_URL ??= "postgresql://placeholder:placeholder@localhost:5432/placeholder";

const result = spawnSync("pnpm", ["exec", "prisma", "validate"], { stdio: "inherit", env });
process.exit(result.status ?? 1);
