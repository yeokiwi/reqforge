// Two people editing one page (RD-055, RD-062, RD-076): presence avatars, and a publish over a
// newer version offers Overwrite or Reload latest — never a silent loss, never a merge.
import type { Page } from "@playwright/test";
import { t } from "../src/copy";
import { DEMO, expect, signIn, test } from "./fixtures";
import { TEAM, clickAtEdge, createPageViaApi, editUrl, getPageViaApi, listVersionsViaApi, pageApi, pageViewPattern, paragraphs, publishSeries, signedInContext } from "./pages";

function editor(page: Page) {
  return {
    content: page.getByRole("textbox", { name: t("editor.content.label") }),
    saveState: page.getByTestId("editor-footer").getByRole("status"),
    changeNote: page.getByRole("textbox", { name: t("editor.changeNote.placeholder") }),
    update: page.getByRole("button", { name: t("editor.update"), exact: true }),
    close: page.getByRole("button", { name: t("editor.close"), exact: true }),
    banner: page.getByRole("alert").filter({ hasText: t("editor.conflict.help") }),
    presence: page.getByRole("list", { name: t("editor.presence") }),
  };
}

async function typeAtStart(page: Page, words: string): Promise<void> {
  await clickAtEdge(editor(page).content.locator(":scope > p").first(), "start");
  await page.keyboard.type(words);
}

const avatar = (name: string) => ({ name: t("editor.presence.user", { name }) });

test.describe("conflicts: two editors, one page", () => {
  test("each editor shows the other's avatar; a stale Update offers Overwrite, then Reload latest", async ({ page: bob, browser }) => {
    await signIn(bob, "bob");
    const created = await createPageViaApi(bob.request, TEAM, { title: "Shared page" });
    await publishSeries(bob.request, TEAM, created, [{ content: paragraphs("Starting text."), message: "start" }]); // v. 2
    const { context, page: alice } = await signedInContext(browser, "alice");

    await bob.goto(editUrl(TEAM, created.id));
    await expect(editor(bob).content).toContainText("Starting text.");
    await alice.goto(editUrl(TEAM, created.id));
    await expect(editor(alice).content).toContainText("Starting text.");

    // Presence (RD-062): the second to open sees the first at once; the first sees the second at
    // its next heartbeat (every 15 s). Nobody is shown to themselves.
    await expect(editor(alice).presence.getByRole("img", avatar(DEMO.users.bob.name))).toBeVisible();
    await expect(editor(bob).presence.getByRole("img", avatar(DEMO.users.alice.name))).toBeVisible({ timeout: 20_000 });
    await expect(editor(alice).presence.getByRole("img", avatar(DEMO.users.alice.name))).toHaveCount(0);
    await expect(editor(bob).presence.getByRole("img", avatar(DEMO.users.bob.name))).toHaveCount(0);

    // Round 1: alice publishes first.
    await typeAtStart(alice, "Alice was here. ");
    await editor(alice).changeNote.fill("alice's change");
    await editor(alice).update.click();
    await expect(alice).toHaveURL(pageViewPattern(TEAM, created.id)); // v. 3

    await typeAtStart(bob, "Bob's change. ");
    await editor(bob).changeNote.fill("bob's change");
    await editor(bob).update.click();
    const banner = editor(bob).banner;
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(t("editor.conflict.message", { n: 3 }));
    await expect(bob).toHaveURL(editUrl(TEAM, created.id)); // nothing was published
    await expect(banner.getByRole("button", { name: t("editor.conflict.reload") })).toBeEnabled();

    await banner.getByRole("button", { name: t("editor.conflict.overwrite") }).click();
    await expect(bob).toHaveURL(pageViewPattern(TEAM, created.id));
    const view = bob.getByTestId("page-view");
    await expect(view).toContainText("Bob's change. Starting text.");
    await expect(view).not.toContainText("Alice was here.");
    // Overwrite publishes a NEW version on top; alice's stays in the history (RD-055).
    let versions = await listVersionsViaApi(bob.request, TEAM, created.id);
    expect(versions.slice(0, 2).map((v) => [v.number, v.author.name, v.message])).toEqual([
      [4, DEMO.users.bob.name, "bob's change"],
      [3, DEMO.users.alice.name, "alice's change"],
    ]);

    // Round 2: both open v. 4; alice publishes v. 5; bob chooses Reload latest.
    await bob.goto(editUrl(TEAM, created.id));
    await alice.goto(editUrl(TEAM, created.id));
    await expect(editor(alice).content).toContainText("Bob's change.");
    await typeAtStart(alice, "Alice again. ");
    await editor(alice).update.click();
    await expect(alice).toHaveURL(pageViewPattern(TEAM, created.id)); // v. 5

    await typeAtStart(bob, "Bob again. ");
    await editor(bob).update.click();
    await expect(banner).toContainText(t("editor.conflict.message", { n: 5 }));
    await banner.getByRole("button", { name: t("editor.conflict.reload") }).click(); // no confirmation (RD-076)

    await expect(banner).toHaveCount(0);
    await expect(editor(bob).content).toContainText("Alice again. Bob's change.");
    await expect(editor(bob).content).not.toContainText("Bob again.");
    await expect(editor(bob).saveState).toHaveText(t("editor.state.ready"));
    await expect(bob).toHaveURL(editUrl(TEAM, created.id));
    // His draft is gone (RD-076: fetch, then delete the draft, then load).
    const draft = await bob.request.get(`${pageApi(TEAM, created.id)}/draft`);
    expect(await draft.json()).toEqual({ draft: null });
    versions = await listVersionsViaApi(bob.request, TEAM, created.id);
    expect(versions[0]?.number).toBe(5);

    await editor(bob).close.click();
    await expect(bob).toHaveURL(pageViewPattern(TEAM, created.id));
    await expect(bob.getByText(t("pageView.draft.notice"))).toHaveCount(0);
    expect((await getPageViaApi(bob.request, TEAM, created.id)).page.hasDraft).toBe(false);
    await context.close();
  });

  test("an autosave that finds a newer version raises the banner before Update is pressed", async ({ page: bob, browser }) => {
    await signIn(bob, "bob");
    const created = await createPageViaApi(bob.request, TEAM, { title: "Stale draft" });
    await bob.goto(editUrl(TEAM, created.id));
    await expect(editor(bob).saveState).toHaveText(t("editor.state.ready"));

    const { context, page: alice } = await signedInContext(browser, "alice");
    await publishSeries(alice.request, TEAM, created, [{ content: paragraphs("Alice published this."), message: "alice" }]); // v. 2

    await typeAtStart(bob, "Bob types on.");
    // The draft save answers `stale: true` (RD-076): the banner appears without pressing Update.
    await expect(editor(bob).banner).toContainText(t("editor.conflict.message", { n: 2 }));
    await expect(editor(bob).saveState).toHaveText(t("editor.state.saved")); // the draft itself was kept

    // Reopening the stale draft says so at once.
    await bob.reload();
    await expect(editor(bob).content).toContainText("Bob types on.");
    await expect(editor(bob).banner).toContainText(t("editor.conflict.message", { n: 2 }));
    await context.close();
  });
});
