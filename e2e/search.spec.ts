import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, who: 'author' | 'reader' = 'author') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@reqforge.test`);
  await page.getByLabel('Password').fill(`reqforge-${who}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/spaces$/);
}

/** Slice 6 acceptance: query, error underlining, selection, saved searches. */
test('search finds a requirement written in the editor', async ({ page }) => {
  await signIn(page);
  const stamp = Date.now() % 100000;
  const key = `SRCH-${stamp}`;

  await page.goto('/s/SJ/documents');
  await page.getByPlaceholder('New document title').fill(`Search source ${stamp}`);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.locator('.rf-prose').click();
  await page.keyboard.type('The system shall be searchable. ');
  await page.getByLabel('Requirement key').fill(key);
  await page.getByRole('button', { name: '+ Requirement' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('1 new');

  await page.goto('/s/SJ/search');
  await page.getByLabel('Query', { exact: true }).fill(`key = '${key}'`);
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(page.getByTestId('search-results')).toContainText(key);
  await expect(page.getByTestId('result-count')).toHaveText('1 requirement');

  // The scope the analyser injected is visible, not hidden behaviour.
  await expect(page.getByText("scope: spaceKey = 'SJ' AND baseline IS NULL AND status = 'ACTIVE'")).toBeVisible();

  await page.getByLabel(`Select ${key}`).check();
  await page.getByRole('button', { name: 'Select all matching this query' }).click();
  await expect(page.getByTestId('selection-note')).toContainText('selected across every page');
});

test('a malformed query underlines the problem instead of failing silently', async ({ page }) => {
  await signIn(page);
  await page.goto('/s/SJ/search');

  await page.getByLabel('Query', { exact: true }).fill("stats = 'ACTIVE'");
  await page.getByRole('button', { name: 'Search' }).click();

  const errors = page.getByTestId('search-errors');
  await expect(errors).toContainText('UNKNOWN_FIELD');
  await expect(errors).toContainText('Did you mean status?');
  await expect(page.getByTestId('query-underline')).toBeVisible();
});

test('a saved search can be stored and reopened', async ({ page }) => {
  await signIn(page);
  const name = `Safety ${Date.now() % 100000}`;
  await page.goto('/s/SJ/search');

  await page.getByLabel('Saved search name').fill(name);
  await page.getByLabel('Saved search query').fill("@Category = 'Safety'");
  await page.getByRole('button', { name: 'Save this query' }).click();

  await expect(page.getByText(`Saved "${name}".`)).toBeVisible();
  await page.getByRole('link', { name }).click();
  await expect(page.getByLabel('Query', { exact: true })).toHaveValue("@Category = 'Safety'");
});

test('a saved search that does not parse is refused', async ({ page }) => {
  await signIn(page);
  await page.goto('/s/SJ/search');

  await page.getByLabel('Saved search name').fill(`Broken ${Date.now() % 100000}`);
  await page.getByLabel('Saved search query').fill('key ===');
  await page.getByRole('button', { name: 'Save this query' }).click();

  await expect(page.getByText('That query does not parse:')).toBeVisible();
});
