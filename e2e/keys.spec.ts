import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, who: 'author' | 'reader') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@reqforge.test`);
  await page.getByLabel('Password').fill(`reqforge-${who}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/spaces$/);
}

/** Slice 3 acceptance: suggestion uses the space's patterns; reset is permission-gated. */
test('the editor suggests the next key from the space patterns', async ({ page }) => {
  await signIn(page, 'author');
  await page.goto('/s/SJ/documents');
  await page.getByPlaceholder('New document title').fill(`Suggestions ${Date.now() % 100000}`);
  await page.getByRole('button', { name: 'Create' }).click();

  await page.getByRole('button', { name: 'Suggest' }).click();
  await expect(page.getByLabel('Requirement key')).toHaveValue(/^(FN|BR)-\d{3}$/);

  await page.locator('.rf-prose').click();
  await page.keyboard.type('Suggested requirement. ');
  await page.getByRole('button', { name: '+ Requirement' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('1 new');
});

test('the Keys screen shows patterns, and reset is refused while deleted keys are protected', async ({ page }) => {
  await signIn(page, 'author');
  await page.goto('/s/SJ/admin/keys');

  await expect(page.getByRole('heading', { name: 'Keys' })).toBeVisible();
  await expect(page.getByTestId('next-key-FN-###')).toHaveText(/^FN-\d{3}$/);
  // Seeded types keep preventReusingDeletedKeys on, so the control is disabled.
  await expect(page.getByRole('button', { name: 'Reset sequence' }).first()).toBeDisabled();
});

test('a read-only member cannot reset a sequence', async ({ page }) => {
  await signIn(page, 'reader');
  await page.goto('/s/SJ/admin/keys');
  await expect(page.getByRole('heading', { name: 'Keys' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset sequence' })).toHaveCount(0);
});
