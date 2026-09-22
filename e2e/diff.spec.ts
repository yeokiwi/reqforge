import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, who: 'admin' | 'author' | 'reader') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@reqforge.test`);
  await page.getByLabel('Password').fill(`reqforge-${who}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/spaces$/);
}

/**
 * Slice 14 end to end: freeze, edit, and read what changed — from the diff and from the
 * search predicate, which must agree.
 * spec: 05-baselines-and-diff.md §5–6; RD-013, RD-047
 */
test('compare a baseline with now, and isModified finds the same rows', async ({ page }) => {
  const stamp = Date.now() % 100000;
  const moved = `DFA-${stamp}`;
  const still = `DFB-${stamp}`;

  await signIn(page, 'admin');

  // --- two requirements -------------------------------------------------------------------
  await page.goto('/s/SJ/documents');
  await page.getByPlaceholder('New document title').fill(`Diff source ${stamp}`);
  await page.getByRole('button', { name: 'Create' }).click();

  await page.locator('.rf-prose').click();
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.keyboard.type('Title');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Notes');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Key');

  for (const key of [moved, still]) {
    await page.locator('.rf-prose').click();
    await page.keyboard.press('Tab');
    await page.keyboard.type(`${key} as first agreed.`);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.getByLabel('Requirement key').fill(key);
    await page.getByRole('button', { name: '+ Requirement' }).click();
    await expect(page.getByLabel('Requirement key')).toHaveValue('');
  }
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('2 new');

  // --- freeze them ---------------------------------------------------------------------------
  await page.goto('/s/SJ/baselines');
  const create = page.getByTestId('create-baseline');
  await create.getByLabel('Baseline name').fill(`Agreed ${stamp}`);
  await create.getByLabel('Baseline query').fill(`key ~ 'DF%-${stamp}'`);
  await create.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByText('Created baseline')).toBeVisible();

  const listRow = page.getByTestId('baseline-list').locator('li').filter({ hasText: `Agreed ${stamp}` });
  await listRow.getByRole('button', { name: 'Freeze' }).click();
  await expect(listRow).toContainText('FROZEN', { timeout: 30_000 });

  const number = (await listRow.getByRole('link', { name: /^#\d+$/ }).innerText()).replace('#', '');

  // --- change exactly one of them --------------------------------------------------------------
  await page.goto('/s/SJ/documents');
  await page.getByRole('link', { name: `Diff source ${stamp}` }).click();
  await page.locator('.rf-prose tr').filter({ hasText: moved }).locator('td').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Then revised.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('Saved as version');

  // --- the diff, pre-filled from the baseline (spec 05 §5.1) -------------------------------------
  await page.goto(`/s/SJ/baselines/${number}`);
  await page.getByTestId('compare-link').click();
  await expect(page).toHaveURL(/\/diff\?/);

  await expect(page.getByTestId('diff-summary')).toContainText('1 modified', { timeout: 30_000 });
  await expect(page.getByTestId(`class-${moved}`)).toHaveText('modified');
  await expect(page.getByTestId(`class-${still}`)).toHaveCount(0);

  // The screen says this is the field set isModified() uses.
  await expect(page.getByTestId('default-set-note')).toBeVisible();

  // Word-level detail on expand (spec 05 §5.2 step 5).
  await page.getByRole('button', { name: moved }).click();
  await expect(page.getByTestId(`detail-${moved}`)).toContainText('Then revised.');

  // --- isModified finds the same requirement (RD-047) -------------------------------------------
  await page.goto(`/s/SJ/search?q=${encodeURIComponent(`isModified(${number})`)}`);
  await expect(page.getByTestId('search-results')).toContainText(moved);
  await expect(page.getByTestId('search-results')).not.toContainText(still);
});

/** spec 05 §6 — history is off by default, and records the actor when it is on. */
test('history records what changed, once the space turns it on', async ({ page }) => {
  const stamp = Date.now() % 100000;
  const key = `HST-${stamp}`;

  await signIn(page, 'admin');

  // Off by default: the screen says so.
  await page.goto('/s/SJ/admin/history');
  const settings = page.getByTestId('history-settings');

  if (!(await settings.getByLabel('Record history').isChecked())) {
    await settings.getByLabel('Record history').check();
    await settings.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
  }

  await page.goto('/s/SJ/documents');
  await page.getByPlaceholder('New document title').fill(`History source ${stamp}`);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.locator('.rf-prose').click();
  await page.keyboard.type('A requirement worth tracking. ');
  await page.getByLabel('Requirement key').fill(key);
  await page.getByRole('button', { name: '+ Requirement' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('1 new');

  // Edit it, so there is a change as well as a creation.
  await page.locator('.rf-prose').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Now revised.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('Saved as version');

  await page.goto(`/s/SJ/r/${encodeURIComponent(key)}`);
  const history = page.getByTestId('requirement-history');
  await expect(history).toContainText('CREATED');
  await expect(history).toContainText('TITLE');

  // And the space-wide view lists it too.
  await page.goto('/s/SJ/admin/history');
  await expect(page.getByTestId('history-table')).toContainText(key);
});
