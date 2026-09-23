import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, who: 'admin' | 'author') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@reqforge.test`);
  await page.getByLabel('Password').fill(`reqforge-${who}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/spaces$/);
}

async function setDocumentLimit(admin: Page, hard: string, warning: string) {
  await admin.goto('/admin/limits?space=SJ');
  await admin.getByLabel('Requirements per document override').fill(hard);
  await admin.getByLabel('Requirements per document (warning) override').fill(warning);
  await admin.getByRole('button', { name: 'Save overrides for SJ' }).click();
  await expect(admin.getByTestId('limit-form')).toContainText(hard === '' ? 'SJ now uses the installation limits.' : 'Saved 2 overrides for SJ.');
}

/**
 * Slice 18, end to end: an instance administrator lowers a space's per-document limit on
 * /admin/limits; an author's save over it is refused with the limit named, and what they
 * wrote is still in the editor. spec: 07-permissions-and-limits.md §4. RD-071, RD-072.
 */
test('a lowered per-document limit refuses the save and keeps the text', async ({ browser }) => {
  const stamp = `${Date.now() % 100000}`;
  const admin = await browser.newPage();
  await signIn(admin, 'admin');
  await setDocumentLimit(admin, '2', '1');

  try {
    const author = await browser.newPage();
    await signIn(author, 'author');
    await author.goto('/s/SJ/documents');
    await author.getByPlaceholder('New document title').fill(`Limited ${stamp}`);
    await author.getByRole('button', { name: 'Create' }).click();
    await expect(author.getByRole('heading', { name: `Limited ${stamp}` })).toBeVisible();

    await author.locator('.rf-prose').click();
    for (const n of [1, 2, 3]) {
      await author.keyboard.type(`The system shall do thing ${n}. `);
      await author.getByLabel('Requirement key').fill(`LIM${stamp}-00${n}`);
      await author.getByRole('button', { name: '+ Requirement' }).click();
      await expect(author.getByLabel('Requirement key')).toHaveValue('');
      // Each marker in place before the next is typed, or a fast run loses one.
      await expect(author.locator('.rf-prose .rf-req')).toHaveCount(n);
      await author.locator('.rf-prose').click();
      await author.keyboard.press('Control+End');
      await author.keyboard.press('Enter');
    }
    await author.getByRole('button', { name: 'Save' }).click();

    await expect(author.getByTestId('editor-status')).toContainText(
      '"Requirements per document" limit exceeded: this document has 3 requirements; the limit is 2.',
    );
    // Refused, not lost: the unsaved text is still there to split or trim.
    await expect(author.locator('.rf-prose')).toContainText('The system shall do thing 3.');
    await expect(author.locator('.rf-prose')).toContainText(`LIM${stamp}-003`);
  } finally {
    await setDocumentLimit(admin, '', '');
  }
});
