import { PrismaClient } from "@prisma/client";
import { expect, test as base, type Page } from "@playwright/test";
import { DEMO, seedDemo } from "../prisma/seed-data";
import { truncateAll } from "../src/test-support/database";

export const PASSWORD = "e2e-password-123";
export { DEMO, expect };

export const test = base.extend<{ reset: void }>({
  // Every test starts from a freshly seeded demo instance.
  reset: [
    async ({}, use) => {
      const prisma = new PrismaClient();
      try {
        await truncateAll(prisma);
        await seedDemo(prisma, { password: PASSWORD });
      } finally {
        await prisma.$disconnect();
      }
      await use();
    },
    { auto: true },
  ],
});

export async function signIn(page: Page, handle: keyof typeof DEMO.users, next?: string): Promise<void> {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByLabel("Email").fill(DEMO.users[handle].email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The form posts a server action and then redirects. Callers navigate straight afterwards,
  // which would abort the sign-in if we returned before the redirect landed.
  await page.waitForURL((url) => url.pathname !== "/login");
}

/** The sign-in form's message. (Next's route announcer is also role=alert, so scope to the form.) */
export const formAlert = (page: Page) => page.locator("form").getByRole("alert");
