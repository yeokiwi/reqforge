import { expect, test } from '@playwright/test';

/** Slice 4 acceptance: table columns become properties and show on the requirement. */
test('a table column becomes an inline property', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('author@reqforge.test');
  await page.getByLabel('Password').fill('reqforge-author');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/spaces$/);

  const stamp = Date.now() % 100000;
  const key = `PROP-${stamp}`;
  await page.goto('/s/SJ/documents');
  await page.getByPlaceholder('New document title').fill(`Properties ${stamp}`);
  await page.getByRole('button', { name: 'Create' }).click();

  await page.locator('.rf-prose').click();
  await page.getByRole('button', { name: 'Table', exact: true }).click();

  // Header row: Title | Category | Key
  await page.keyboard.type('Title');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Category');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Key');
  await page.keyboard.press('Tab');

  // First data row.
  await page.keyboard.type('The system shall raise an alarm.');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Safety');
  await page.keyboard.press('Tab');
  await page.getByLabel('Requirement key').fill(key);
  await page.getByRole('button', { name: '+ Requirement' }).click();

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('1 new');

  await page.goto(`/s/SJ/r/${key}`);
  await expect(page.getByRole('heading', { name: 'The system shall raise an alarm.' })).toBeVisible();
  await expect(page.getByRole('term').filter({ hasText: 'Category' })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: 'Safety' })).toBeVisible();
});
