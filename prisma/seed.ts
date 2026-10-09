import { PrismaClient } from "@prisma/client";
import { DEMO, seedDemo } from "./seed-data";

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production" && process.env.REQFORGE_ALLOW_SEED !== "1") {
    throw new Error("Refusing to seed demo accounts with NODE_ENV=production (set REQFORGE_ALLOW_SEED=1 to override).");
  }

  const password = process.env.SEED_PASSWORD ?? "reqforge-dev";
  const prisma = new PrismaClient();
  try {
    await seedDemo(prisma, { password });
    console.log("Seeded demo data:");
    for (const u of Object.values(DEMO.users)) console.log(`  ${u.email}${u.isInstanceAdmin ? "  (instance admin)" : ""}`);
    console.log(`  password for all three: ${password}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
