import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, who: 'admin' | 'author' | 'reader') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@reqforge.test`);
  await page.getByLabel('Password').fill(`reqforge-${who}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/spaces$/);
}

/**
 * Slice 16, end to end: an author restricts a document to themselves; a reader cannot find
 * it anywhere and gets a 404 on both the document and its requirement; an administrator,
 * who cannot read it either, unlocks it from Restricted documents; the audit log records it.
 * spec: 07-permissions-and-limits.md §2.2, §6. RD-057, RD-058, RD-062, RD-064.
 */
test('restrict, hide, unlock, audit', async ({ browser }) => {
  const stamp = `${Date.now() % 100000}`;
  const key = `RX${stamp}-001`;
  const title = `Restricted ${stamp}`;

  // --- the author writes a requirement, then restricts the document to themselves.
  const author = await browser.newPage();
  await signIn(author, 'author');
  await author.goto('/s/SJ/documents');
  await author.getByPlaceholder('New document title').fill(title);
  await author.getByRole('button', { name: 'Create' }).click();
  await expect(author.getByRole('heading', { name: title })).toBeVisible();
  await author.locator('.rf-prose').click();
  await author.keyboard.press('End');
  await author.keyboard.type(`The system shall keep ${key} confidential. `);
  await author.getByLabel('Requirement key').fill(key);
  await author.getByRole('button', { name: '+ Requirement' }).click();
  await author.getByRole('button', { name: 'Save' }).click();
  await expect(author.getByTestId('editor-status')).toContainText('1 new');
  const documentUrl = author.url();

  await author.getByRole('link', { name: 'Restrictions' }).click();
  await author.getByTestId('mode-explicit').check();
  await author.getByLabel('Add a person or group').selectOption({ label: 'Arno Author <author@reqforge.test>' });
  await author.getByRole('button', { name: 'Add', exact: true }).click();
  await author.getByRole('button', { name: 'Save restrictions' }).click();
  await expect(author.getByTestId('restriction-form')).toContainText('Saved.');

  // Refusing a self-lockout is part of the same screen (RD-057).
  await author.getByRole('button', { name: 'Remove' }).click();
  await author.getByRole('button', { name: 'Save restrictions' }).click();
  await expect(author.getByTestId('restriction-form').getByRole('alert')).toBeVisible();

  await author.goto(documentUrl);
  await expect(author.getByTestId('document-restricted')).toBeVisible();

  // --- the reader cannot find it anywhere, and a direct URL is a 404 (RD-064).
  const reader = await browser.newPage();
  await signIn(reader, 'reader');
  expect((await reader.goto(documentUrl))?.status()).toBe(404);
  expect((await reader.goto(`/s/SJ/r/${key}`))?.status()).toBe(404);
  await reader.goto(`/s/SJ/search?q=${encodeURIComponent(`key = '${key}'`)}`);
  await expect(reader.getByTestId('result-count')).toContainText('0 requirements');
  await reader.goto('/s/SJ/documents');
  await expect(reader.getByText(title)).toHaveCount(0);

  // --- the administrator cannot read it either, but can unlock it by title.
  const admin = await browser.newPage();
  await signIn(admin, 'admin');
  expect((await admin.goto(documentUrl))?.status()).toBe(404);
  await admin.goto('/s/SJ/admin/restrictions');
  const row = admin.getByTestId('restricted-documents').getByRole('row', { name: new RegExp(title) });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Remove restriction' }).click();
  await expect(admin.getByTestId('restricted-documents').getByText(title)).toHaveCount(0);

  // --- now the reader sees it, and the audit log says who opened it up.
  expect((await reader.goto(`/s/SJ/r/${key}`))?.status()).toBe(200);
  await admin.goto('/s/SJ/admin/audit?operation=unlock');
  await expect(admin.getByTestId('audit-table')).toContainText('Ada Admin');
  await expect(admin.getByTestId('audit-table')).toContainText('unlock');
});

test('the admin screens are not offered to a non-administrator', async ({ page }) => {
  await signIn(page, 'author');
  await page.goto('/s/SJ');
  await expect(page.getByRole('link', { name: 'Permissions' })).toHaveCount(0);
  await page.goto('/s/SJ/admin/permissions');
  await expect(page.getByRole('heading', { name: /needs the ADMIN permission/ })).toBeVisible();
  await page.goto('/admin/groups');
  await expect(page.getByRole('heading', { name: 'Instance administrators only' })).toBeVisible();
});
