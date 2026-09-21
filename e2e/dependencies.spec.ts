import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('author@reqforge.test');
  await page.getByLabel('Password').fill('reqforge-author');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/spaces$/);
}

/**
 * Slice 7 acceptance: a link inside a requirement's scope is a dependency whose
 * relationship is the column header, and a link to a missing key is retained and listed.
 */
test('link one requirement to another and see it from both ends', async ({ page }) => {
  await signIn(page);
  const stamp = Date.now() % 100000;
  const parentKey = `DBR-${stamp}`;
  const childKey = `DFN-${stamp}`;

  await page.goto('/s/SJ/documents');
  await page.getByPlaceholder('New document title').fill(`Dependencies ${stamp}`);
  await page.getByRole('button', { name: 'Create' }).click();

  // A table with a Refines column: Title | Refines | Key.
  await page.locator('.rf-prose').click();
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.keyboard.type('Title');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Refines');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Key');
  await page.keyboard.press('Tab');

  // Row 1 defines the parent.
  await page.keyboard.type('The business shall record every access.');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.getByLabel('Requirement key').fill(parentKey);
  await page.getByRole('button', { name: '+ Requirement' }).click();

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('1 new');

  // Row 2 (the empty one insertTable already made) defines the child and links to the
  // parent from the Refines column. Tab moves out of row 1's Key cell into it.
  await page.locator('.rf-prose').click();
  await page.keyboard.press('Tab');
  await page.keyboard.type('The system shall log every access.');
  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: '+ Link' }).click();
  await page.getByLabel('Find a requirement to link').fill(parentKey);
  await page.getByTestId('link-candidates').getByText(parentKey).click();
  await page.keyboard.press('Tab');
  await page.getByLabel('Requirement key').fill(childKey);
  await page.getByRole('button', { name: '+ Requirement' }).click();

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('1 new');

  // The child declares the edge…
  await page.goto(`/s/SJ/r/${childKey}`);
  const outbound = page.getByTestId('dependencies');
  await expect(outbound).toContainText('Depends on — Refines');
  await expect(outbound).toContainText(parentKey);

  // …and the parent sees it from the other side (invariant P1).
  await page.goto(`/s/SJ/r/${parentKey}`);
  const inbound = page.getByTestId('dependencies');
  await expect(inbound).toContainText('Depended on by — Refines');
  await expect(inbound).toContainText(childKey);

  // And RQL agrees, in both directions.
  await page.goto('/s/SJ/search');
  await page.getByLabel('Query', { exact: true }).fill(`to@Refines = '${parentKey}'`);
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByTestId('search-results')).toContainText(childKey);
});

test('a link to a key that does not exist is kept and listed on Broken links', async ({ page }) => {
  await signIn(page);
  const stamp = Date.now() % 100000;
  const childKey = `DMISS-${stamp}`;
  const missing = `NOPE-${stamp}`;

  await page.goto('/s/SJ/documents');
  await page.getByPlaceholder('New document title').fill(`Broken ${stamp}`);
  await page.getByRole('button', { name: 'Create' }).click();

  await page.locator('.rf-prose').click();
  await page.keyboard.type('The system shall refer to something missing. ');
  await page.getByLabel('Requirement key').fill(childKey);
  await page.getByRole('button', { name: '+ Requirement' }).click();

  // The picker offers a link to a key that does not exist yet: writing the child before
  // the parent is the common case, and the edge is kept until the key appears (RD-029).
  await page.getByRole('button', { name: '+ Link' }).click();
  await page.getByLabel('Find a requirement to link').fill(missing);
  await page.getByRole('button', { name: `Link to ${missing} — not defined yet` }).click();

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('diagnostics')).toContainText('UNRESOLVED_LINK');

  await page.goto('/s/SJ/links');
  await expect(page.getByTestId('unresolved-dependencies')).toContainText(missing);
  await expect(page.getByTestId('unresolved-dependencies')).toContainText(childKey);
});
