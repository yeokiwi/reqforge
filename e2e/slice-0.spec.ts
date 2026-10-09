// Slice 0 acceptance (PLAN.md): a signed-in user reaches an empty space; the shell matches
// spec 10 §2–3 element for element ("not built" absent, "later" slots held).
import { t } from "../src/copy";
import { DEMO, expect, formAlert, signIn, test } from "./fixtures";

const SHOTS = "test-results/gui-review/slice-0";

test.describe("signing in", () => {
  test("a fresh sign-in lands in an empty space", async ({ page }) => {
    await signIn(page, "alice");
    await expect(page).toHaveURL(/\/spaces\/PLAT$/); // no history yet → first space by name
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Platform");
    await expect(page.getByText(t("space.empty"))).toBeVisible();
  });

  test("an unauthenticated deep link goes to sign-in and comes back after it", async ({ page }) => {
    await page.goto("/spaces/TEAM");
    await expect(page).toHaveURL(/\/login\?next=%2Fspaces%2FTEAM$/);
    await page.getByLabel(t("auth.email")).fill(DEMO.users.bob.email);
    await page.getByLabel(t("auth.password")).fill("e2e-password-123");
    await page.getByRole("button", { name: t("auth.submit") }).click();
    await expect(page).toHaveURL(/\/spaces\/TEAM$/);
  });

  test("a bad password shows the generic message and stays on the page", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(t("auth.email")).fill(DEMO.users.alice.email);
    await page.getByLabel(t("auth.password")).fill("wrong");
    await page.getByRole("button", { name: t("auth.submit") }).click();
    await expect(formAlert(page)).toHaveText(t("auth.error"));
    await expect(page).toHaveURL(/\/login/);
  });

  test("an unknown email gets the very same message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(t("auth.email")).fill("nobody@reqforge.test");
    await page.getByLabel(t("auth.password")).fill("wrong");
    await page.getByRole("button", { name: t("auth.submit") }).click();
    await expect(formAlert(page)).toHaveText(t("auth.error"));
  });

  test("a failed attempt keeps the email and clears the password", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(t("auth.email")).fill(DEMO.users.alice.email);
    await page.getByLabel(t("auth.password")).fill("wrong");
    await page.getByRole("button", { name: t("auth.submit") }).click();
    await expect(formAlert(page)).toBeVisible();
    await expect(page.getByLabel(t("auth.email"))).toHaveValue(DEMO.users.alice.email);
    await expect(page.getByLabel(t("auth.password"))).toHaveValue("");
  });

  test("repeated failures are throttled", async ({ page }) => {
    await page.goto("/login");
    const password = page.getByLabel(t("auth.password"));
    for (let i = 0; i < 9; i++) {
      await page.getByLabel(t("auth.email")).fill("throttle-me@reqforge.test");
      await password.fill(`wrong-${i}`);
      const answered = page.waitForResponse((r) => r.request().method() === "POST");
      await page.getByRole("button", { name: t("auth.submit") }).click();
      await answered;
      // React clears the password once the action settles — the signal that this attempt is done.
      await expect(password).toHaveValue("");
    }
    await expect(formAlert(page)).toHaveText(t("auth.throttled"));
  });

  test("does not follow an off-site redirect target", async ({ page }) => {
    await signIn(page, "alice", "https://evil.example/phish");
    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\//);
    await expect(page).not.toHaveURL(/evil\.example/);
  });

  test("signing out ends the session for good", async ({ page }) => {
    await signIn(page, "alice");
    await page.getByRole("button", { name: t("shell.avatar") }).click();
    await page.getByRole("menuitem", { name: t("shell.avatar.signOut") }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/spaces");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a session the server no longer knows is treated as signed out", async ({ page, context }) => {
    await signIn(page, "alice");
    await context.addCookies([
      { name: "rf_session", value: "forged-or-expired-token", url: page.url() },
    ]);
    await page.goto("/spaces");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("the top bar (spec 10 §2)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "alice");
  });

  test("has every v1 element, in order", async ({ page }) => {
    const bar = page.getByRole("banner");
    await expect(bar.getByRole("link", { name: t("app.name") })).toBeVisible();
    await expect(bar.getByRole("button", { name: t("shell.spaces") })).toBeVisible();
    await expect(bar.getByRole("button", { name: t("shell.more") })).toBeVisible();
    await expect(bar.getByRole("searchbox", { name: t("shell.search.label") })).toBeVisible();
    await expect(bar.getByRole("link", { name: t("shell.help") })).toBeVisible();
    await expect(bar.getByRole("link", { name: t("shell.admin") })).toBeVisible();
    await expect(bar.getByRole("button", { name: t("shell.avatar") })).toBeVisible();

    const order = await bar.locator("a, button, input").evaluateAll((els) =>
      els.map((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim()),
    );
    const at = (label: string) => order.findIndex((l) => l.startsWith(label));
    expect(at(t("app.name"))).toBeLessThan(at(t("shell.spaces")));
    expect(at(t("shell.spaces"))).toBeLessThan(at(t("shell.create")));
    expect(at(t("shell.create"))).toBeLessThan(at(t("shell.more")));
    expect(at(t("shell.more"))).toBeLessThan(at(t("shell.help")));
  });

  test("holds the slots of 'later' elements, inert", async ({ page }) => {
    const bar = page.getByRole("banner");
    await expect(bar.getByText(t("shell.people"), { exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(bar.getByRole("button", { name: t("shell.notifications") })).toBeDisabled();
  });

  test("omits 'not built' elements — there is no app switcher", async ({ page }) => {
    const bar = page.getByRole("banner");
    await expect(bar.getByRole("button", { name: /app switcher|apps|switch/i })).toHaveCount(0);
    await expect(bar.getByText(/confluence|requirement yogi|atlassian|jira/i)).toHaveCount(0);
  });

  test("the Spaces menu lists recent spaces, then 'View all spaces'", async ({ page }) => {
    await page.goto("/spaces/TEAM");
    await page.getByRole("button", { name: t("shell.spaces"), exact: true }).click();
    const menu = page.getByRole("menu", { name: t("shell.spaces") });
    const items = await menu.getByRole("menuitem").allTextContents();
    expect(items).toEqual(["Team", t("shell.spaces.viewAll")]);
    await menu.getByRole("menuitem", { name: t("shell.spaces.viewAll") }).click();
    await expect(page).toHaveURL(/\/spaces$/);
  });

  test("menus are keyboard-operable: arrows move, Escape closes and returns focus", async ({ page }) => {
    const trigger = page.getByRole("button", { name: t("shell.spaces"), exact: true });
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    const menu = page.getByRole("menu", { name: t("shell.spaces") });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("clicking elsewhere closes an open menu", async ({ page }) => {
    await page.getByRole("button", { name: t("shell.spaces"), exact: true }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.getByRole("heading", { level: 1 }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("Create offers only spaces the user can edit, outside a space", async ({ page }) => {
    await page.goto("/spaces");
    await page.getByRole("button", { name: t("shell.create") }).click();
    await expect(page.getByRole("menu", { name: t("shell.create") }).getByRole("menuitem")).toHaveText(["Platform", "Team"]);
  });

  test("global search submits to the results screen", async ({ page }) => {
    await page.getByRole("searchbox").fill("FN-01");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=FN-01$/);
    await expect(page.getByText(t("globalSearch.none", { q: "FN-01" }))).toBeVisible();
  });

  test("the administration gear is for instance administrators only", async ({ page }) => {
    await page.getByRole("link", { name: t("shell.admin") }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.getByRole("button", { name: t("shell.avatar") }).click();
    await page.getByRole("menuitem", { name: t("shell.avatar.signOut") }).click();

    await signIn(page, "bob");
    await expect(page.getByRole("banner").getByRole("link", { name: t("shell.admin") })).toHaveCount(0);
    await page.goto("/admin");
    await expect(page.getByText(t("error.notFound"))).toBeVisible();
  });
});

test.describe("the space sidebar (spec 10 §3)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "alice", "/spaces/TEAM");
  });

  test("expanded: space header, Pages selected, Requirements, page tree, tools, collapse", async ({ page }) => {
    const side = page.getByRole("complementary", { name: t("sidebar.nav") });
    await expect(side).toHaveAttribute("data-state", "expanded");
    await expect(side.getByRole("link", { name: "Team" })).toBeVisible();
    await expect(side.getByRole("link", { name: t("sidebar.pages") })).toHaveAttribute("aria-current", "page");
    await expect(side.getByRole("link", { name: t("sidebar.requirements") })).not.toHaveAttribute("aria-current", "page");
    await expect(side.getByRole("heading", { name: t("sidebar.pageTree") })).toBeVisible();
    await expect(side.getByText(t("sidebar.pageTree.empty"))).toBeVisible();
    await expect(side.getByRole("button", { name: t("sidebar.spaceTools") })).toBeVisible();
    await expect(side.getByRole("button", { name: t("sidebar.collapse") })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/sidebar-expanded.png` });
  });

  test("omits 'not built' items: there is no Blog", async ({ page }) => {
    await expect(page.getByRole("complementary").getByText(/blog/i)).toHaveCount(0);
  });

  test("Requirements opens its screen with that item selected", async ({ page }) => {
    await page.getByRole("complementary").getByRole("link", { name: t("sidebar.requirements") }).click();
    await expect(page).toHaveURL(/\/requirements\/TEAM$/);
    const side = page.getByRole("complementary", { name: t("sidebar.nav") });
    await expect(side.getByRole("link", { name: t("sidebar.requirements") })).toHaveAttribute("aria-current", "page");
  });

  test("collapses to the icon rail, and the choice is remembered per user", async ({ page, browser }) => {
    await page.getByRole("button", { name: t("sidebar.collapse") }).click();
    const rail = page.getByRole("complementary", { name: t("sidebar.nav") });
    await expect(rail).toHaveAttribute("data-state", "collapsed");

    // The rail: space logo, Pages, Requirements, export/open, page tree, tools, expand — no labels shown.
    for (const name of [
      t("sidebar.pages"),
      t("sidebar.requirements"),
      t("sidebar.rail.exportOpen"),
      t("sidebar.rail.pageTree"),
      t("sidebar.spaceTools"),
      t("sidebar.expand"),
    ]) {
      await expect(rail.getByRole(name === t("sidebar.pages") || name === t("sidebar.requirements") ? "link" : "button", { name })).toBeVisible();
    }
    await expect(rail.getByText(t("sidebar.pageTree"))).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/sidebar-rail.png` });

    await page.reload();
    await expect(rail).toHaveAttribute("data-state", "collapsed");

    // A brand-new browser session for the same user sees it collapsed too — stored server-side.
    const other = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const fresh = await other.newPage();
    await signIn(fresh, "alice", "/spaces/TEAM");
    await expect(fresh.getByRole("complementary", { name: t("sidebar.nav") })).toHaveAttribute("data-state", "collapsed");
    await other.close();

    await page.getByRole("button", { name: t("sidebar.expand") }).click();
    await expect(rail).toHaveAttribute("data-state", "expanded");
  });

  test("either of the rail's unlabelled icons opens the sidebar", async ({ page }) => {
    await page.getByRole("button", { name: t("sidebar.collapse") }).click();
    await page.getByRole("button", { name: t("sidebar.rail.pageTree") }).click();
    await expect(page.getByRole("complementary", { name: t("sidebar.nav") })).toHaveAttribute("data-state", "expanded");
  });

  test("the star toggles and persists across reloads", async ({ page }) => {
    const star = () => page.getByRole("button", { name: /starred spaces/ });
    await expect(star()).toHaveAttribute("aria-pressed", "false");
    await star().click();
    await expect(star()).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(star()).toHaveAttribute("aria-pressed", "true");
    await expect(star()).toHaveAccessibleName(t("sidebar.unfavourite", { space: "Team" }));
  });

  test("Space tools lists the admin screens and their routes exist", async ({ page }) => {
    await page.getByRole("button", { name: t("sidebar.spaceTools") }).click();
    const menu = page.getByRole("menu", { name: t("sidebar.spaceTools") });
    await expect(menu.getByRole("menuitem")).toHaveText([
      t("sidebar.tools.permissions"),
      t("sidebar.tools.requirementTypes"),
      t("sidebar.tools.keySuggestions"),
      t("sidebar.tools.history"),
    ]);
    await menu.getByRole("menuitem", { name: t("sidebar.tools.keySuggestions") }).click();
    await expect(page).toHaveURL(/\/spaces\/TEAM\/settings\/requirements\/key-suggestions$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("sidebar.tools.keySuggestions"));
  });
});

test.describe("who can see what (spec 07 §2, rule X2)", () => {
  test("carol cannot see PLAT: it is not listed, and its URL is a 404 — not a 403", async ({ page }) => {
    await signIn(page, "carol");
    await page.goto("/spaces");
    await expect(page.getByRole("link", { name: /Platform/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Team/ })).toBeVisible();

    const hidden = await page.goto("/spaces/PLAT");
    expect(hidden?.status()).toBe(404);
    await expect(page.getByText(t("error.notFound"))).toBeVisible();

    const missing = await page.goto("/spaces/NOSUCH");
    expect(missing?.status()).toBe(404); // indistinguishable from a space that exists but is hidden
  });

  test("bob reaches PLAT through his group, read-only", async ({ page }) => {
    await signIn(page, "bob", "/spaces/PLAT");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Platform");
    await expect(page.getByRole("button", { name: t("sidebar.spaceTools") })).toHaveCount(0); // not an admin
  });

  test("only space admins see Space tools, and the settings routes 404 for everyone else", async ({ page }) => {
    await signIn(page, "bob", "/spaces/TEAM");
    await expect(page.getByRole("button", { name: t("sidebar.spaceTools") })).toHaveCount(0);
    const response = await page.goto("/spaces/TEAM/settings/permissions");
    expect(response?.status()).toBe(404);
  });

  test("inside a space they can edit, Create holds its slot but is inert until pages exist", async ({ page }) => {
    await signIn(page, "bob", "/spaces/TEAM");
    await expect(page.getByRole("banner").getByRole("button", { name: t("shell.create") })).toBeDisabled();
  });

  test("a viewer with no edit rights is offered the space picker instead — with no spaces to pick", async ({ page }) => {
    await signIn(page, "carol", "/spaces/TEAM");
    await page.getByRole("button", { name: t("shell.create") }).click();
    await expect(page.getByRole("menuitem", { name: t("shell.create.noSpace") })).toHaveAttribute("aria-disabled", "true");
  });
});

test.describe("operations", () => {
  test("the health probe answers 200 with the database up", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: true });
  });

  test("the sign-in page needs no session", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("auth.title", { app: t("app.name") }));
    await page.screenshot({ path: `${SHOTS}/login.png` });
  });
});
