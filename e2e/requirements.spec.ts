import { expect, test, type Page } from '@playwright/test';

async function signInAsAuthor(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('author@reqforge.test');
  await page.getByLabel('Password').fill('reqforge-author');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/spaces$/);
}

async function newDocument(page: Page, title: string) {
  await page.goto('/s/SJ/documents');
  await page.getByPlaceholder('New document title').fill(title);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

/** Slice 2 acceptance: markers become requirement rows; removing one marks it DELETED. */
test('mark a requirement, save it, open its page, then remove it', async ({ page }) => {
  await signInAsAuthor(page);
  const key = `E2E-${Date.now() % 100000}`;
  await newDocument(page, `Requirements ${key}`);

  await page.locator('.rf-prose').click();
  await page.keyboard.type('The system shall notify the operator. ');
  await page.getByLabel('Requirement key').fill(key);
  await page.getByRole('button', { name: '+ Requirement' }).click();

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('1 new');

  await page.goto(`/s/SJ/r/${key}`);
  await expect(page.getByRole('heading', { name: 'The system shall notify the operator.' })).toBeVisible();
  await expect(page.getByText('ACTIVE')).toBeVisible();
  await expect(page.getByTestId('requirement-body')).toContainText('The system shall notify the operator.');

  // Remove the marker: the row survives as DELETED (contract I3).
  await page.goBack();
  await page.locator('.rf-prose').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('The marker is gone now.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('1 removed');

  await page.goto(`/s/SJ/r/${key}`);
  await expect(page.getByText('DELETED')).toBeVisible();
});

test('a duplicate marker in one scope is reported as an error', async ({ page }) => {
  await signInAsAuthor(page);
  const stamp = Date.now() % 100000;
  await newDocument(page, `Duplicates ${stamp}`);

  await page.locator('.rf-prose').click();
  await page.keyboard.type('Two markers in one paragraph. ');
  await page.getByLabel('Requirement key').fill(`DUP-${stamp}`);
  await page.getByRole('button', { name: '+ Requirement' }).click();
  await page.getByLabel('Requirement key').fill(`DUP2-${stamp}`);
  await page.getByRole('button', { name: '+ Requirement' }).click();

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('diagnostics')).toContainText('DUPLICATE_MARKER_IN_SCOPE');
});
