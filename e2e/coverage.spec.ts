import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, who: 'author' | 'reader' | 'admin') {
  await page.goto('/login');
  // /login redirects a signed-in visitor, so switching users means signing out first.
  if (!page.url().endsWith('/login')) {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.goto('/login');
  }
  await page.getByLabel('Email').fill(`${who}@reqforge.test`);
  await page.getByLabel('Password').fill(`reqforge-${who}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/spaces$/);
}

/** Slice 9: the grid reads row-as-child → column-as-parent, and every figure is a query. */
test('build a population, read the grid, then click a coverage figure through to search', async ({ page }) => {
  await signIn(page, 'author');
  const stamp = Date.now() % 100000;
  const parentKey = `CVGB-${stamp}`;
  const childKey = `CVGF-${stamp}`;
  const query = `key ~ 'CVG%-${stamp}'`;

  await page.goto('/s/SJ/documents');
  await page.getByPlaceholder('New document title').fill(`Coverage source ${stamp}`);
  await page.getByRole('button', { name: 'Create' }).click();

  await page.locator('.rf-prose').click();
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.keyboard.type('Title');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Refines');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Key');
  await page.keyboard.press('Tab');

  // Row 1: the parent.
  await page.keyboard.type('The business shall be traceable.');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.getByLabel('Requirement key').fill(parentKey);
  await page.getByRole('button', { name: '+ Requirement' }).click();
  await expect(page.getByLabel('Requirement key')).toHaveValue('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('1 new');

  // Row 2: the child, linking to the parent from the Refines column. Click the cell itself:
  // the editor is taller than the table, so a click on its centre can land below the
  // table and leave a gap cursor that swallows the typing.
  await page.locator('.rf-prose tr').nth(2).locator('td').first().click();
  await page.keyboard.type('The system shall be traceable.');
  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: '+ Link' }).click();
  await page.getByLabel('Find a requirement to link').fill(parentKey);
  await page.getByTestId('link-candidates').getByText(parentKey).click();
  await page.keyboard.press('Tab');
  await page.getByLabel('Requirement key').fill(childKey);
  await page.getByRole('button', { name: '+ Requirement' }).click();
  await expect(page.getByLabel('Requirement key')).toHaveValue('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('1 new');

  // The grid.
  await page.goto('/s/SJ/dependencies');
  await page.getByLabel('Grid query').fill(query);
  await page.getByRole('button', { name: 'Run' }).click();

  const grid = page.getByTestId('dependency-grid');
  await expect(grid).toContainText(parentKey);
  await expect(grid).toContainText(childKey);
  await expect(page.getByTestId('grid-legend')).toContainText('Refines');
  // The child's row, the parent's column: RE. Not the other way round (invariant P1).
  const childRow = grid.locator('tr', { has: page.getByRole('rowheader', { name: childKey }) });
  await expect(childRow).toContainText('RE');

  // Coverage over the same population.
  await page.goto('/s/SJ/coverage');
  await page.getByLabel('Coverage query').fill(query);
  await page.getByRole('button', { name: 'Run' }).click();

  await expect(page.getByTestId('coverage-population')).toContainText('2 requirements');
  const outbound = page.getByTestId('coverage-table').locator('tr', { hasText: 'Depends on — Refines' });
  await expect(outbound).toContainText('50%');

  // Every figure is a query: the uncovered one lists the parent, which refines nothing.
  // Target the Uncovered column by position rather than "the last link in the row".
  await outbound.locator('td').nth(3).getByRole('link').click();
  await expect(page).toHaveURL(/\/search\?q=/);
  await expect(page.getByTestId('search-results')).toContainText(parentKey);
  await expect(page.getByTestId('search-results')).not.toContainText(childKey);
});

test('a target flags a row below it, and only an admin can set one', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/s/SJ/coverage');

  await page.getByLabel('Target relationship').fill('Refines');
  await page.getByLabel('Target percentage').fill('90');
  await page.getByRole('button', { name: 'Set target' }).click();
  await expect(page.getByText('Refines now targets 90%.')).toBeVisible();

  await page.getByLabel('Coverage query').fill("key ~ 'CVG%'");
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('coverage-table').locator('tr', { hasText: 'Depends on — Refines' })).toContainText(
    'below target',
  );

  // An author has EXPORT but not ADMIN, so the form is not offered.
  await signIn(page, 'author');
  await page.goto('/s/SJ/coverage');
  await expect(page.getByText('Setting a target needs the ADMIN permission.')).toBeVisible();
  await expect(page.getByLabel('Target relationship')).toHaveCount(0);
});

test('a reader without EXPORT is refused both screens (spec 04 §4.3)', async ({ page }) => {
  await signIn(page, 'reader');

  await page.goto('/s/SJ/dependencies');
  await expect(page.getByRole('heading', { name: /needs the EXPORT permission/ })).toBeVisible();

  await page.goto('/s/SJ/coverage');
  await expect(page.getByRole('heading', { name: /needs the EXPORT permission/ })).toBeVisible();
});
