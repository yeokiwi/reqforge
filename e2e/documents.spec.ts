import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('author@reqforge.test');
  await page.getByLabel('Password').fill('reqforge-author');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/spaces$/);
}

/** Slice 1 acceptance: write, reload unchanged, every save versions, history renders. */
test('create a document, write, save, reload and see the version history', async ({ page }) => {
  await signIn(page);
  const title = `Interfaces ${Date.now()}`;

  await page.goto('/s/SJ/documents');
  await page.getByPlaceholder('New document title').fill(title);
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const url = page.url();

  const body = page.locator('.rf-prose');
  await body.click();
  await page.keyboard.type('The system shall log every access.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toHaveText('Saved as version 2');

  await page.goto(url);
  await expect(page.locator('.rf-prose')).toContainText('The system shall log every access.');

  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByRole('link', { name: /Version 2/ })).toBeVisible();
  await expect(page.getByTestId('version-body')).toContainText('The system shall log every access.');

  await page.getByRole('link', { name: /Version 1/ }).click();
  await expect(page.getByTestId('version-body')).not.toContainText('The system shall log every access.');
});

test('a read-only member sees no editing controls', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('reader@reqforge.test');
  await page.getByLabel('Password').fill('reqforge-reader');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/spaces$/);

  await page.goto('/s/SJ/documents');
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
  await expect(page.getByPlaceholder('New document title')).toHaveCount(0);
});
