import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, who: 'admin' | 'author' | 'reader') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@reqforge.test`);
  await page.getByLabel('Password').fill(`reqforge-${who}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/spaces$/);
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

/**
 * Slice 11 acceptance: a definition an instance administrator owns, values a space editor
 * sets one at a time and in bulk, a live aggregate, and a typed query that finds them.
 * spec: 01 (ExternalPropertyDefinition); 04 §2.1–2.2; 07 §2.1; RD-036, RD-039
 */
test('define external properties, edit them in the matrix and set them in bulk', async ({ page }) => {
  const stamp = Date.now() % 1000000;
  const approval = `Approval${stamp}`;
  const risk = `Risk${stamp}`;
  const keys = [`EXT-${stamp}-A`, `EXT-${stamp}-B`];

  // --- an instance administrator defines the properties ---------------------------------
  await signIn(page, 'admin');
  await page.goto('/admin/properties');

  const form = page.getByTestId('new-definition');
  await form.getByLabel('Property name').fill(approval);
  await form.getByLabel('Data type').selectOption('ENUM');
  await form.getByLabel('Allowed values').fill('Pending\nSigned off');
  await form.getByRole('button', { name: 'Define' }).click();
  await expect(page.getByText(`Defined "${approval}".`)).toBeVisible();

  await form.getByLabel('Property name').fill(risk);
  await form.getByLabel('Data type').selectOption('NUMBER');
  await form.getByRole('button', { name: 'Define' }).click();
  await expect(page.getByText(`Defined "${risk}".`)).toBeVisible();
  await expect(page.getByTestId('definition-list')).toContainText(`ext@${risk}`);

  await signOut(page);

  // --- an author writes two requirements ------------------------------------------------
  await signIn(page, 'author');
  await page.goto('/s/SJ/documents');
  await page.getByPlaceholder('New document title').fill(`External source ${stamp}`);
  await page.getByRole('button', { name: 'Create' }).click();

  // A table whose rows are requirements — one scope per row, so both markers define
  // rather than the second becoming a link to the first (rule S1).
  await page.locator('.rf-prose').click();
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.keyboard.type('Title');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Notes');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Key');

  for (const [index, key] of keys.entries()) {
    await page.locator('.rf-prose').click();
    await page.keyboard.press('Tab');
    await page.keyboard.type(`${key} needs a decision.`);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.getByLabel('Requirement key').fill(key!);
    await page.getByRole('button', { name: '+ Requirement' }).click();
    await expect(page.getByLabel('Requirement key')).toHaveValue('');
    expect(index).toBeLessThan(2);
  }

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('2 new');

  // An author is not an instance administrator, so the definitions are not theirs to edit.
  await page.goto('/admin/properties');
  await expect(page.getByText('Instance administrators only')).toBeVisible();

  // --- edit a value in the matrix -------------------------------------------------------
  await page.goto('/s/SJ/traceability');
  await page.getByLabel('Matrix query').fill(`key ~ 'EXT-${stamp}-%'`);

  await page.getByLabel('Column kind').selectOption('external');
  await page.getByLabel('Property name').fill(approval);
  await page.getByRole('button', { name: 'Add column' }).click();

  await page.getByLabel('Column kind').selectOption('external');
  await page.getByLabel('Property name').fill(risk);
  await page.getByLabel('Aggregate').selectOption('sum');
  await page.getByRole('button', { name: 'Add column' }).click();

  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('matrix-count')).toHaveText('2 requirements');

  // Read-only until the toggle is on — spec 04 §2.2.
  await expect(page.getByLabel(`${approval} of ${keys[0]}`)).toHaveCount(0);
  await page.getByLabel('Edit values').check();

  await page.getByLabel(`${approval} of ${keys[0]}`).selectOption('Signed off');
  await expect(page.getByLabel(`${approval} of ${keys[0]}`)).toHaveValue('Signed off');

  const firstRisk = page.getByLabel(`${risk} of ${keys[0]}`);
  await firstRisk.fill('4');
  await firstRisk.blur();
  const secondRisk = page.getByLabel(`${risk} of ${keys[1]}`);
  await secondRisk.fill('6');
  await secondRisk.blur();

  // The aggregate is recomputed from the cells on screen (spec 04 §2.1).
  await expect(page.getByTestId('matrix-totals')).toContainText('sum 10');

  // A value the type cannot hold is refused, and the cell rolls back.
  await firstRisk.fill('high');
  await firstRisk.blur();
  await expect(page.getByTestId('matrix-table').getByRole('alert')).toContainText('is not a number');
  await expect(firstRisk).toHaveValue('4');

  // --- set a value in bulk --------------------------------------------------------------
  const bulk = page.getByTestId('bulk-set');
  await expect(bulk).toBeVisible();
  await bulk.getByLabel('Bulk property').selectOption({ label: approval });
  await bulk.getByLabel('Bulk value').selectOption('Pending');
  await bulk.getByRole('button', { name: /Set for all/ }).click();
  await expect(page.getByTestId('bulk-confirm')).toContainText('all 2 matching requirements?');
  await bulk.getByRole('button', { name: 'Yes, set them' }).click();
  await expect(bulk).toContainText('2 of 2 matching requirements');

  // --- the value is findable by a typed query, and visible on the requirement -----------
  await page.goto(`/s/SJ/search?q=${encodeURIComponent(`ext@${risk} > 5`)}`);
  await expect(page.getByTestId('search-results')).toContainText(keys[1]!);
  await expect(page.getByTestId('search-results')).not.toContainText(keys[0]!);

  await page.goto(`/s/SJ/r/${encodeURIComponent(keys[0]!)}`);
  await expect(page.getByTestId('external-values')).toContainText(`${approval}*`);
  await expect(page.getByLabel(`${approval} value`)).toHaveValue('Pending');

  // --- a reader sees the values but cannot change them (spec 07 §2.1) -------------------
  await signOut(page);
  await signIn(page, 'reader');
  await page.goto(`/s/SJ/r/${encodeURIComponent(keys[0]!)}`);
  await expect(page.getByTestId('external-values')).toContainText('Pending');
  await expect(page.getByLabel(`${approval} value`)).toHaveCount(0);

  await page.goto('/s/SJ/traceability');
  await expect(page.getByLabel('Edit values')).toHaveCount(0);
});

/** A definition is deletable while unused, and a name is unique case-insensitively (E3). */
test('a definition deletes while unused, and its name is unique whatever its case', async ({ page }) => {
  const stamp = Date.now() % 1000000;
  const name = `Unused${stamp}`;

  await signIn(page, 'admin');
  await page.goto('/admin/properties');
  const form = page.getByTestId('new-definition');
  const nameBox = form.getByLabel('Property name');

  await nameBox.fill(name);
  await form.getByLabel('Data type').selectOption('STRING');
  await form.getByRole('button', { name: 'Define' }).click();
  await expect(form).toContainText(`Defined "${name}".`);

  // A name that differs only in case is the same property (invariant E3). React resets
  // an uncontrolled form once its action settles, so wait for that before typing again.
  await expect(nameBox).toHaveValue('');
  await nameBox.fill(name.toLowerCase());
  await form.getByRole('button', { name: 'Define' }).click();
  await expect(form.getByRole('alert')).toContainText('already exists');

  // Nothing is filed against it, so it deletes cleanly.
  const row = page.getByTestId('definition-list').locator('li').filter({ hasText: `ext@${name}` });
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('definition-list')).not.toContainText(`ext@${name}`);
});
