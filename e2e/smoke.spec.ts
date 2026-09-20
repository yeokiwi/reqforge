import { expect, test } from '@playwright/test';

/** Slice 0 acceptance: a fresh clone reaches a logged-in empty space. */
test('sign in, list spaces, open a space', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('author@reqforge.test');
  await page.getByLabel('Password').fill('reqforge-author');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/spaces$/);
  await expect(page.getByRole('heading', { name: 'Spaces' })).toBeVisible();

  await page.getByText('Sample Journey').click();
  await expect(page.getByRole('heading', { name: 'Sample Journey' })).toBeVisible();
  await expect(page.getByText('documents', { exact: true })).toBeVisible();
});

test('wrong credentials are refused without leaking which half was wrong', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('author@reqforge.test');
  await page.getByLabel('Password').fill('wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('login-error')).toHaveText('Those credentials do not match an account.');
});
