import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, who: 'author' | 'reader' = 'author') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@reqforge.test`);
  await page.getByLabel('Password').fill(`reqforge-${who}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/spaces$/);
}

/** Slice 8 acceptance: configurable columns, saving, embedding in two documents, export. */
test('build a matrix, save it, embed it in two documents and export it', async ({ page }) => {
  await signIn(page);
  const stamp = Date.now() % 100000;
  const key = `MTX-${stamp}`;
  const matrixName = `Review ${stamp}`;

  // A requirement to find, with a property to show in a column.
  await page.goto('/s/SJ/documents');
  await page.getByPlaceholder('New document title').fill(`Matrix source ${stamp}`);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.locator('.rf-prose').click();
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.keyboard.type('Title');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Category');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Key');
  await page.keyboard.press('Tab');
  await page.keyboard.type('The matrix shall list this requirement.');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Safety');
  await page.keyboard.press('Tab');
  await page.getByLabel('Requirement key').fill(key);
  await page.getByRole('button', { name: '+ Requirement' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('1 new');

  // Build the matrix.
  await page.goto('/s/SJ/traceability');
  await page.getByLabel('Matrix query').fill(`key = '${key}'`);
  await page.getByLabel('Column kind').selectOption('property');
  await page.getByLabel('Property name').fill('Category');
  await page.getByRole('button', { name: 'Add column' }).click();
  await expect(page.getByTestId('matrix-columns')).toContainText('Category');
  await page.getByRole('button', { name: 'Run' }).click();

  await expect(page.getByTestId('matrix-count')).toHaveText('1 requirement');
  await expect(page.getByTestId('matrix-table')).toContainText(key);
  await expect(page.getByTestId('matrix-table')).toContainText('Safety');

  // Save it.
  await page.getByLabel('Matrix name').fill(matrixName);
  await page.getByRole('button', { name: 'Save matrix' }).click();
  await expect(page.getByText(`Saved "${matrixName}".`)).toBeVisible();

  // Embed the same saved matrix in two documents; both render live rows.
  for (const suffix of ['A', 'B']) {
    await page.goto('/s/SJ/documents');
    await page.getByPlaceholder('New document title').fill(`Embed ${suffix} ${stamp}`);
    await page.getByRole('button', { name: 'Create' }).click();
    await page.locator('.rf-prose').click();
    await page.getByRole('button', { name: '+ Matrix' }).click();
    await page.getByTestId('embeddable-matrices').getByText(matrixName).click();

    const embed = page.getByTestId('embedded-matrix');
    await expect(embed).toContainText(matrixName);
    await expect(embed).toContainText(key);

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('editor-status')).toContainText('Saved as version');
  }

  // Export runs as a job and produces a downloadable file.
  await page.goto('/s/SJ/traceability');
  await page.getByLabel('Matrix query').fill(`key = '${key}'`);
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('matrix-count')).toHaveText('1 requirement');
  await page.getByRole('button', { name: 'Export to xlsx' }).click();

  const job = page.getByTestId('export-job');
  await expect(job).toContainText('done');
  const link = page.getByRole('link', { name: 'Download' });
  await expect(link).toBeVisible();

  // The real user path: click the link and catch the file the browser downloads.
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  expect(await download.path()).toBeTruthy();
});

test('a reader without EXPORT sees no export button and cannot fetch a file', async ({ page }) => {
  await signIn(page, 'reader');
  await page.goto('/s/SJ/traceability');

  await expect(page.getByRole('heading', { name: 'Traceability matrix' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export to xlsx' })).toHaveCount(0);
  await expect(page.getByLabel('Matrix name')).toHaveCount(0);

  // Navigating carries the session cookie, so this really is the reader asking.
  const refused = await page.goto('/s/SJ/jobs/does-not-exist/download');
  expect([403, 404]).toContain(refused!.status());
});
