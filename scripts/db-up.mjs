// Makes sure a Postgres is reachable at DATABASE_URL, starting the compose service if needed.
// Used by `pnpm demo`; safe to run repeatedly.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import net from "node:net";

if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  console.log("Created .env from .env.example");
}

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const line = readFileSync(".env", "utf8")
    .split("\n")
    .find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL is not set in the environment or .env");
  return line.slice("DATABASE_URL=".length).replace(/^["']|["']$/g, "");
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 1000 });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => (socket.destroy(), resolve(false)));
  });
}

const url = new URL(readDatabaseUrl());
const host = url.hostname || "localhost";
const port = Number(url.port || 5432);

if (await canConnect(host, port)) {
  console.log(`Postgres is already reachable at ${host}:${port}`);
  process.exit(0);
}

const dockerOk = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
if (!dockerOk) {
  console.error(
    `No Postgres at ${host}:${port} and Docker is not available.\n` +
      "Start a PostgreSQL 16 server that matches DATABASE_URL in .env, or install Docker.",
  );
  process.exit(1);
}

const up = spawnSync("docker", ["compose", "up", "-d", "--wait", "db"], {
  stdio: "inherit",
  env: { ...process.env, REQFORGE_DB_PORT: String(port) },
});
process.exit(up.status ?? 1);
