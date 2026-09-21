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
 * Slice 12 acceptance: a type with rules, a requirement that breaks them, the pills and
 * the quick fixes that repair them, and the revalidation job a type edit runs.
 * spec: 06-requirement-types.md §§1–5; RD-040, RD-041, RD-042
 */
test('rules turn red, quick fixes repair them, and a type edit revalidates', async ({ page }) => {
  const stamp = Date.now() % 100000;
  const pattern = `TY${stamp}-###`;
  const key = `TY${stamp}-001`;

  // --- an administrator defines a type with rules ---------------------------------------
  await signIn(page, 'admin');
  await page.goto('/s/SJ/admin/types');

  const form = page.getByTestId('new-type');
  await form.getByLabel('Key pattern').fill(pattern);
  await form.getByLabel('Type name').fill(`Typed ${stamp}`);

  // A required property, and a PROPERTY_IN rule — the RD-015 divergence.
  await form.getByLabel('Rule kind').selectOption('REQUIRED_PROPERTY');
  await form.getByLabel('Rule property').fill('Priority');
  await form.getByRole('button', { name: 'Add rule' }).click();

  await form.getByLabel('Rule kind').selectOption('PROPERTY_IN');
  await form.getByLabel('Rule property').fill('Status');
  await form.getByLabel('Rule values').fill('Draft, Reviewed, Approved');
  await form.getByRole('button', { name: 'Add rule' }).click();

  await expect(form.getByTestId('rule-list')).toContainText('must have the property Priority');
  await expect(form.getByTestId('rule-list')).toContainText('Draft, Reviewed, Approved');

  // A template column, for the scaffold later on.
  await form.getByLabel('Template column').fill('Priority');
  await form.getByRole('button', { name: 'Add column' }).click();

  await form.getByRole('button', { name: 'Create type' }).click();
  await expect(page.getByText(`Created Typed ${stamp}.`)).toBeVisible();

  // --- a requirement that breaks both rules ---------------------------------------------
  await page.goto('/s/SJ/documents');
  await page.getByPlaceholder('New document title').fill(`Typed source ${stamp}`);
  await page.getByRole('button', { name: 'Create' }).click();

  await page.locator('.rf-prose').click();
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.keyboard.type('Title');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Status');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Key');
  await page.keyboard.press('Tab');

  await page.keyboard.type('The system shall be typed.');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Sort of done');
  await page.keyboard.press('Tab');
  await page.getByLabel('Requirement key').fill(key);
  await page.getByRole('button', { name: '+ Requirement' }).click();

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('1 new');

  // Two red pills: the missing Priority, and the Status that is not in the list.
  const diagnostics = page.getByTestId('diagnostics');
  await expect(diagnostics).toContainText('MISSING_REQUIRED_PROPERTY');
  await expect(diagnostics).toContainText('PROPERTY_NOT_IN_VALUES');
  await expect(diagnostics.getByTestId('pill-error')).toHaveCount(2);

  // --- the quick fixes (spec 06 §4) -----------------------------------------------------
  await diagnostics.getByTestId('fix-addColumn').click();
  await expect(page.locator('.rf-prose')).toContainText('Priority');

  // The dropdown offers only the allowed values.
  const dropdown = diagnostics.getByLabel('Choose a Status');
  await expect(dropdown.locator('option')).toContainText(['Draft', 'Reviewed', 'Approved']);
  await dropdown.selectOption('Reviewed');
  await expect(page.locator('.rf-prose')).toContainText('Reviewed');

  // Fill the new column, save, and both rules pass. The added column is last, so the
  // requirement's Priority cell is the last cell of its row.
  await page.locator('.rf-prose tr').filter({ hasText: key }).locator('td').last().click();
  await page.keyboard.type('High');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('Saved as version');
  await expect(page.getByTestId('diagnostics')).toHaveCount(0);

  // --- ruleStatus finds them (spec 02 §4) -----------------------------------------------
  await page.goto(`/s/SJ/search?q=${encodeURIComponent("ruleStatus = 'true'")}`);
  await expect(page.getByTestId('search-results')).toContainText(key);

  // --- a type edit revalidates through a job (spec 06 §2.2 trigger 2, RD-016) -----------
  await page.goto('/s/SJ/admin/types');
  // The pattern shows as text on the row's header line; the form inside it is the one
  // carrying the rules (TypeActions renders its own small forms beside it).
  const savedRow = page.getByTestId('type-list').locator('li').filter({ hasText: pattern }).first();
  const saved = savedRow.locator('form[data-testid^="type-"]');
  await saved.getByLabel('Rule kind').selectOption('REQUIRED_PROPERTY');
  await saved.getByLabel('Rule property').fill('Rationale');
  await saved.getByRole('button', { name: 'Add rule' }).click();
  await saved.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Revalidating its requirements…')).toBeVisible();

  // Without re-saving a single document, the requirement now fails.
  await page.goto(`/s/SJ/search?q=${encodeURIComponent("ruleStatus = 'false'")}`);
  await expect(page.getByTestId('search-results')).toContainText(key);

  // --- the template scaffolds an empty table (spec 03 §6, 06 §3) ------------------------
  await page.goto('/s/SJ/documents');
  await page.getByPlaceholder('New document title').fill(`Scaffolded ${stamp}`);
  await page.getByLabel('Start from a type').selectOption({ label: `Typed ${stamp} template` });
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.rf-prose')).toContainText('Priority');

  // --- a reader may read the types but not change them (spec 06 §5) ---------------------
  await signOut(page);
  await signIn(page, 'reader');
  await page.goto('/s/SJ/admin/types');
  await expect(page.getByTestId('type-list')).toContainText(pattern);
  await expect(page.getByTestId('new-type')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run validation' })).toHaveCount(0);
});

/** The limits of spec 06 §2.3, and a pattern that does not compile (spec 06 §1). */
test('a type refuses a rule it cannot evaluate', async ({ page }) => {
  const stamp = Date.now() % 100000;
  await signIn(page, 'admin');
  await page.goto('/s/SJ/admin/types');

  const form = page.getByTestId('new-type');
  await form.getByLabel('Key pattern').fill(`BAD${stamp}-###`);
  await form.getByLabel('Rule kind').selectOption('PROPERTY_MATCHES');
  await form.getByLabel('Rule property').fill('Status');
  await form.getByLabel('Rule pattern').fill('([unclosed');
  await form.getByRole('button', { name: 'Add rule' }).click();
  await form.getByRole('button', { name: 'Create type' }).click();

  await expect(form.getByRole('alert')).toContainText('not a valid regular expression');
});
