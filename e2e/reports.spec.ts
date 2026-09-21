import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
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

/** Slice 10: a report renders live rows inside the document (spec 04 §5). */
test('insert a report, see live rows, then count only', async ({ page }) => {
  await signIn(page);
  const stamp = Date.now() % 100000;
  const key = `RPT-${stamp}`;
  await newDocument(page, `Report host ${stamp}`);

  // A requirement for the report to find.
  await page.locator('.rf-prose').click();
  await page.keyboard.type('The system shall be reported on. ');
  await page.getByLabel('Requirement key').fill(key);
  await page.getByRole('button', { name: '+ Requirement' }).click();
  await expect(page.getByLabel('Requirement key')).toHaveValue('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('1 new');

  // The report itself.
  await page.locator('.rf-prose').click();
  await page.keyboard.press('End');
  await page.getByRole('button', { name: '+ Report' }).click();

  const report = page.getByTestId('report').first();
  await report.getByLabel('Report query').fill(`key = '${key}'`);
  await expect(report.getByRole('table')).toContainText(key);
  await expect(report.getByRole('table')).toContainText('The system shall be reported on.');

  // Columns are configurable with the RY syntax.
  await report.getByLabel('Report columns').fill('key, status');
  await expect(report.getByRole('columnheader', { name: 'Status' })).toBeVisible();
  await expect(report.getByRole('table')).toContainText('ACTIVE');

  // Count only collapses it to a number.
  await report.getByLabel('Count only').check();
  await expect(report.getByTestId('report-count')).toHaveText('1');

  // The configuration survives a save and a reload.
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('Saved as version');
  await page.reload();
  await expect(page.getByTestId('report').first().getByTestId('report-count')).toHaveText('1');
});

test('a report inside a requirement row renders the previous definition, not itself', async ({ page }) => {
  await signIn(page);
  const stamp = Date.now() % 100000;
  const first = `RPA-${stamp}`;
  const second = `RPB-${stamp}`;
  await newDocument(page, `Last requirement ${stamp}`);

  // A table whose rows are requirements: the report goes in a cell of the second row, so
  // it genuinely sits inside that requirement's scope (spec 03 §2).
  await page.locator('.rf-prose').click();
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.keyboard.type('Title');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Notes');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Key');
  await page.keyboard.press('Tab');

  await page.keyboard.type('The first requirement.');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.getByLabel('Requirement key').fill(first);
  await page.getByRole('button', { name: '+ Requirement' }).click();
  await expect(page.getByLabel('Requirement key')).toHaveValue('');

  await page.locator('.rf-prose').click();
  await page.keyboard.press('Tab');
  await page.keyboard.type('The second requirement.');
  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: '+ Report' }).click();
  await expect(page.getByTestId('report')).toHaveCount(1);

  await page.locator('.rf-prose').click();
  await page.keyboard.press('Control+End');
  await page.getByLabel('Requirement key').fill(second);
  await page.getByRole('button', { name: '+ Requirement' }).click();
  await expect(page.getByLabel('Requirement key')).toHaveValue('');

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('editor-status')).toContainText('2 new');

  const report = page.getByTestId('report').first();
  await report.getByLabel('Use the last requirement definition').check();

  // RD-035: it renders the definition before the one whose row it sits in.
  await expect(report).toContainText(first);
  await expect(report.getByRole('table')).not.toContainText(second);
});

test('more than five reports warns about slow documents', async ({ page }) => {
  await signIn(page);
  await newDocument(page, `Too many reports ${Date.now() % 100000}`);

  for (let index = 1; index <= 5; index += 1) {
    await page.locator('.rf-prose').click();
    await page.keyboard.press('Control+End');
    await page.getByRole('button', { name: '+ Report' }).click();
    // The node view mounts a tick after the node lands, so let the count settle before
    // asserting it — otherwise the assertion can pass on a transient value.
    await page.waitForTimeout(250);
    await expect(page.getByTestId('report')).toHaveCount(index);
  }
  await expect(page.getByTestId('report-warning')).toHaveCount(0);

  await page.locator('.rf-prose').click();
  await page.keyboard.press('Control+End');
  await page.getByRole('button', { name: '+ Report' }).click();
  await expect(page.getByTestId('report')).toHaveCount(6);
  await expect(page.getByTestId('report-warning')).toContainText('6 reports');
});
