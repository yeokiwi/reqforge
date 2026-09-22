import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, who: 'admin' | 'author' | 'reader') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@reqforge.test`);
  await page.getByLabel('Password').fill(`reqforge-${who}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/spaces$/);
}

/**
 * Slice 15 acceptance, end to end: the batch decomposition transforms live, the rename
 * propagates into the document, the old key still resolves, and the job ends with an
 * explicit acknowledgement.
 * spec: 03-authoring-and-indexing.md §5.
 */
test('rename two requirements from the search screen and acknowledge the job', async ({ page }) => {
  await signIn(page, 'admin');

  const stamp = `${Date.now() % 100000}`;
  const before = [`RNE${stamp}-001`, `RNE${stamp}-002`];
  const after = before.map((key) => key.replace(`RNE${stamp}`, `SYE${stamp}`));

  // One document per requirement: rule S1 demotes a second marker in the same scope to a
  // link rather than a definition, and two documents also prove the rename reaches every
  // document it touches rather than only the one it started from.
  for (const key of before) {
    await page.goto('/s/SJ/documents');
    await page.getByPlaceholder('New document title').fill(`Renaming ${key}`);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { name: `Renaming ${key}` })).toBeVisible();

    await page.locator('.rf-prose').click();
    await page.keyboard.press('End');
    await page.keyboard.type(`The system shall handle case ${key}. `);
    await page.getByLabel('Requirement key').fill(key);
    await page.getByRole('button', { name: '+ Requirement' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('editor-status')).toContainText('1 new');
  }

  // Select both on the search screen — RY's selection model (research §2.8).
  await page.goto(`/s/SJ/search?q=${encodeURIComponent(`key ~ 'RNE${stamp}-%'`)}`);
  await expect(page.getByTestId('result-count')).toContainText('2 requirements');
  for (const key of before) {
    await page.getByLabel(`Select ${key}`).check();
  }

  await page.getByTestId('rename-selected').click();
  await expect(page.getByRole('heading', { name: 'Rename requirements' })).toBeVisible();

  // Editing the first line transforms the rest live (spec 03 §5).
  await page.getByTestId('rename-first-line').fill(after[0]!);
  await expect(page.getByTestId('rename-preview')).toContainText(after[0]!);
  await expect(page.getByTestId('rename-preview')).toContainText(after[1]!);

  await page.getByTestId('rename-run').click();

  // JOBS_INLINE=1 means the job is finished by the time the action returns, so the
  // acknowledgement — not a progress bar — is what there is to see.
  await expect(page.getByTestId('rename-job-acknowledge')).toBeVisible();
  await expect(page.getByTestId('rename-job')).toContainText('2 renamed');
  await page.getByTestId('rename-job-acknowledge').click();
  await expect(page.getByTestId('rename-job')).toHaveCount(0);

  // The requirement answers under its new key, and says where it came from.
  await page.goto(`/s/SJ/r/${after[0]}`);
  await expect(page.getByTestId('renamed-from')).toContainText(before[0]!);

  // The old key still resolves, which is the alias chain of RD-051.
  await page.goto(`/s/SJ/r/${before[0]}`);
  await expect(page).toHaveURL(new RegExp(`/r/${after[0]}`));

  // The document itself was rewritten, so the next reindex agrees with the rows (RD-050).
  await page.goto(`/s/SJ/search?q=${encodeURIComponent(`key ~ 'SYE${stamp}-%'`)}`);
  await expect(page.getByTestId('result-count')).toContainText('2 requirements');
  await page.goto(`/s/SJ/search?q=${encodeURIComponent(`key ~ 'RNE${stamp}-%'`)}`);
  await expect(page.getByTestId('result-count')).toContainText('0 requirements');
});

test('a member without ADMIN is not offered renaming', async ({ page }) => {
  await signIn(page, 'author');

  // Self-contained rather than leaning on seed data: the author writes the requirement it
  // then fails to be offered a rename for.
  const key = `RNP${Date.now() % 100000}-001`;
  await page.goto('/s/SJ/documents');
  await page.getByPlaceholder('New document title').fill(`No rename ${key}`);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: `No rename ${key}` })).toBeVisible();
  await page.locator('.rf-prose').click();
  await page.keyboard.press('End');
  await page.keyboard.type(`The system shall do the thing ${key}. `);
  await page.getByLabel('Requirement key').fill(key);
  await page.getByRole('button', { name: '+ Requirement' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('1 new');

  await page.goto(`/s/SJ/search?q=${encodeURIComponent(`key = '${key}'`)}`);
  await expect(page.getByTestId('result-count')).toContainText('1 requirement');
  await page.getByTestId('select-row').first().check();
  await expect(page.getByText('1 selected')).toBeVisible();

  // spec 07 §2.1 / RD-053 — renaming needs ADMIN, so the control is not there at all.
  await expect(page.getByTestId('rename-selected')).toHaveCount(0);

  // And the screen itself refuses, rather than relying on the missing button.
  await page.goto(`/s/SJ/rename?keys=${key}`);
  await expect(page.getByRole('heading', { name: /renaming requirements needs the ADMIN permission/i })).toBeVisible();
});
