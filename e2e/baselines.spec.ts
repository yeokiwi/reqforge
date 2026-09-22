import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, who: 'admin' | 'author' | 'reader') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@reqforge.test`);
  await page.getByLabel('Password').fill(`reqforge-${who}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/spaces$/);
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

/**
 * Slice 13 acceptance, end to end: a draft whose preview follows the documents, a freeze
 * that does not, and the revision trail a correction leaves.
 * spec: 05-baselines-and-diff.md §2–4; RD-044, RD-045
 */
test('assemble a draft, freeze it, and watch the snapshot stop moving', async ({ page }) => {
  const stamp = Date.now() % 100000;
  const first = `BLA-${stamp}`;
  const second = `BLB-${stamp}`;

  await signIn(page, 'admin');

  // --- two requirements to baseline ------------------------------------------------------
  await page.goto('/s/SJ/documents');
  await page.getByPlaceholder('New document title').fill(`Baseline source ${stamp}`);
  await page.getByRole('button', { name: 'Create' }).click();

  await page.locator('.rf-prose').click();
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.keyboard.type('Title');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Notes');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Key');

  for (const [index, key] of [first, second].entries()) {
    await page.locator('.rf-prose').click();
    await page.keyboard.press('Tab');
    await page.keyboard.type(`Requirement ${index + 1}, as first written.`);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.getByLabel('Requirement key').fill(key);
    await page.getByRole('button', { name: '+ Requirement' }).click();
    await expect(page.getByLabel('Requirement key')).toHaveValue('');
  }

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('2 new');

  // --- a draft, previewed live ------------------------------------------------------------
  await page.goto('/s/SJ/baselines');
  const create = page.getByTestId('create-baseline');
  await create.getByLabel('Baseline name').fill(`Release ${stamp}`);
  await create.getByLabel('Baseline query').fill(`key ~ 'BL%-${stamp}'`);
  await create.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('baseline-preview')).toContainText('2 requirements');

  await create.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByText(`Created baseline`)).toBeVisible();

  // A draft owns no rows (invariant B1).
  const listRow = page.getByTestId('baseline-list').locator('li').filter({ hasText: `Release ${stamp}` });
  await expect(listRow).toContainText('DRAFT');
  await expect(listRow).toContainText('no rows yet');

  // --- freeze -----------------------------------------------------------------------------
  // JOBS_INLINE runs the job inside the action, so the outcome is what to assert on: the
  // progress indicator has already been replaced by the frozen row by the time it returns.
  await listRow.getByRole('button', { name: 'Freeze' }).click();

  const frozenRow = page.getByTestId('baseline-list').locator('li').filter({ hasText: `Release ${stamp}` });
  await expect(frozenRow).toContainText('FROZEN', { timeout: 30_000 });
  await expect(frozenRow).toContainText('2 members');

  // --- the snapshot does not move when the live requirement does ---------------------------
  await page.goto('/s/SJ/documents');
  await page.getByRole('link', { name: `Baseline source ${stamp}` }).click();
  // Appended rather than selected-and-replaced: Control+A in ProseMirror selects the
  // whole document, which would delete the marker rather than edit the title.
  await page.locator('.rf-prose tr').filter({ hasText: first }).locator('td').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Rewritten after the freeze.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('Saved as version');

  await page.goto('/s/SJ/baselines');
  await page.getByTestId('baseline-list').getByRole('link', { name: /^#\d+$/ }).first().click();

  await expect(page.getByTestId('member-count')).toHaveText('2');
  // The frozen row still carries the original words.
  await expect(page.getByTestId('baseline-members')).toContainText('as first written');
  await expect(page.getByTestId('baseline-members')).not.toContainText('Rewritten after the freeze');

  // The live row has moved on.
  await page.goto(`/s/SJ/r/${encodeURIComponent(first)}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Rewritten after the freeze');
  // And it says which snapshots hold it (spec 05 §4).
  await expect(page.getByTestId('in-baselines')).toContainText(`Release ${stamp}`);

  // --- the report document renders the members (RD-045) -------------------------------------
  await page.goto('/s/SJ/baselines');
  await page.getByTestId('baseline-list').getByRole('link', { name: /^#\d+$/ }).first().click();
  await page.getByRole('link', { name: 'Open the report document' }).click();
  const report = page.getByTestId('report').first();
  await expect(report).toContainText(first);
  await expect(report).toContainText(second);
});

/** spec 05 §3.4 — a correction is audited, and a reader can see it but not make one. */
test('refreeze records a reason, and a reader cannot freeze anything', async ({ page }) => {
  const stamp = Date.now() % 100000;
  const key = `RFR-${stamp}`;

  await signIn(page, 'admin');
  await page.goto('/s/SJ/documents');
  await page.getByPlaceholder('New document title').fill(`Revisable source ${stamp}`);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.locator('.rf-prose').click();
  await page.keyboard.type('A requirement worth revising. ');
  await page.getByLabel('Requirement key').fill(key);
  await page.getByRole('button', { name: '+ Requirement' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('1 new');

  await page.goto('/s/SJ/baselines');
  const create = page.getByTestId('create-baseline');
  await create.getByLabel('Baseline name').fill(`Revisable ${stamp}`);
  await create.getByLabel('Baseline query').fill(`key = '${key}'`);
  await create.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByText('Created baseline')).toBeVisible();

  const listRow = page.getByTestId('baseline-list').locator('li').filter({ hasText: `Revisable ${stamp}` });
  await listRow.getByRole('button', { name: 'Freeze' }).click();
  await expect(listRow).toContainText('FROZEN', { timeout: 30_000 });

  // Refreeze with a reason.
  const number = await page
    .getByTestId('baseline-list')
    .locator('li')
    .filter({ hasText: `Revisable ${stamp}` })
    .getByRole('link', { name: /^#\d+$/ })
    .innerText();
  await page.goto(`/s/SJ/baselines/${number.replace('#', '')}`);

  const refreeze = page.getByTestId('refreeze');
  await refreeze.getByLabel('Reason for the revision').fill('The scope review pulled it back in.');
  await refreeze.getByRole('button', { name: 'Refreeze' }).click();

  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByTestId('revisions')).toContainText('The scope review pulled it back in.');
  await expect(page.getByTestId('revised')).toContainText('revised');

  // --- a reader may look and not touch (spec 07 §2.1) ---------------------------------------
  await signOut(page);
  await signIn(page, 'reader');
  await page.goto('/s/SJ/baselines');
  await expect(page.getByTestId('baseline-list')).toContainText(`Revisable ${stamp}`);
  await expect(page.getByTestId('create-baseline')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Freeze' })).toHaveCount(0);

  await page.goto(`/s/SJ/baselines/${number.replace('#', '')}`);
  await expect(page.getByTestId('baseline-members')).toContainText(key);
  await expect(page.getByTestId('refreeze')).toHaveCount(0);
});
