import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, who: 'admin' | 'author') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@reqforge.test`);
  await page.getByLabel('Password').fill(`reqforge-${who}`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/spaces$/);
}

/**
 * Slice 17, end to end: an administrator subscribes a webhook; an author creates an API
 * token, and a "CI job" uses it to list requirements and upload a document, reading the
 * upload's verdict in the response; the webhook's failed delivery shows on the admin
 * screen; revoking the token shuts the API out.
 * spec: 08-api-surface.md §1, §2, §3, §7. RD-065, RD-066, RD-067.
 */
test('token, headless upload, webhook delivery, revoke', async ({ browser, playwright, baseURL }) => {
  const stamp = `${Date.now() % 100000}`;
  const keyOf = (n: number) => `API${stamp}-00${n}`;

  // --- the administrator subscribes a receiver that cannot be reached (`.invalid`, RFC 6761).
  const admin = await browser.newPage();
  await signIn(admin, 'admin');
  await admin.goto('/s/SJ/admin/webhooks');
  const hookUrl = `https://ci-${stamp}.reqforge.invalid/hook`;
  await admin.getByLabel('Webhook URL').fill(hookUrl);
  await admin.getByRole('checkbox', { name: 'document.indexed' }).check();
  await admin.getByRole('button', { name: 'Subscribe' }).click();
  await expect(admin.getByTestId('webhook-secret')).toContainText('whsec_');

  // --- the author creates a token confined to SJ and copies it (it is shown once).
  const author = await browser.newPage();
  await signIn(author, 'author');
  await author.goto('/settings/tokens');
  await author.getByLabel('Token name').fill(`CI ${stamp}`);
  await author.getByRole('checkbox', { name: 'edit' }).check();
  await author.getByLabel('Spaces').fill('SJ');
  await author.getByRole('button', { name: 'Create token' }).click();
  const token = (await author.getByTestId('new-token').textContent())?.trim() ?? '';
  expect(token).toMatch(/^rf_/);

  // --- a machine, with nothing but the token.
  const ci = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });

  // A space outside the token's list does not exist, as far as the token knows.
  expect((await ci.get('/api/v1/spaces/ISO/requirements')).status()).toBe(404);

  const created = await ci.post('/api/v1/spaces/SJ/documents', { data: { title: `Uploaded by CI ${stamp}` } });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  const put = await ci.put(`/api/v1/spaces/SJ/documents/${id}`, {
    data: {
      content: {
        type: 'doc',
        content: [
          ...[1, 2, 3].map((n) => ({
            type: 'paragraph',
            content: [{ type: 'text', text: `The build shall pass check ${n}. ` }, { type: 'requirement', attrs: { key: keyOf(n), uid: `uid-${stamp}-${n}` } }],
          })),
          { type: 'paragraph', content: [{ type: 'text', text: 'Not a key. ' }, { type: 'requirement', attrs: { key: 'x', uid: `bad-${stamp}` } }] },
        ],
      },
      message: 'from CI',
    },
  });
  expect(put.status()).toBe(200);
  const verdict = (await put.json()) as { valid: boolean; requirements: { created: number }; diagnostics: Array<{ code: string }> };
  expect(verdict.requirements.created).toBe(3);
  expect(verdict.valid).toBe(false);
  expect(verdict.diagnostics.map((entry) => entry.code)).toContain('KEY_INVALID');

  const one = await ci.get(`/api/v1/spaces/SJ/requirements/${keyOf(1)}`);
  expect(one.status()).toBe(200);

  // Paging by cursor over what the upload made (spec 08 §1, RD-068).
  const q = `key ~ 'API${stamp}-%'`;
  const list = await ci.get('/api/v1/spaces/SJ/requirements', { params: { q, limit: '2' } });
  expect(list.status()).toBe(200);
  const page1 = (await list.json()) as { items: Array<{ key: string }>; hasMore: boolean; nextCursor: string | null };
  expect(page1.items.map((item) => item.key)).toEqual([keyOf(1), keyOf(2)]);
  expect(page1.hasMore).toBe(true);
  const next = await ci.get('/api/v1/spaces/SJ/requirements', { params: { q, limit: '2', cursor: page1.nextCursor ?? '' } });
  const page2 = (await next.json()) as { items: Array<{ key: string }>; hasMore: boolean };
  expect(page2.items.map((item) => item.key)).toEqual([keyOf(3)]);
  expect(page2.hasMore).toBe(false);

  // --- the upload fired `document.indexed`; the receiver is unreachable, so the delivery
  // fails and waits for its retry (RD-067), naming why.
  const hook = admin.getByTestId('webhook').filter({ hasText: hookUrl });
  const panel = admin.locator('section').filter({ has: hook });
  await expect(async () => {
    await admin.reload();
    await expect(panel.getByTestId('webhook-deliveries')).toContainText('could not be resolved');
  }).toPass({ timeout: 30_000 });
  await expect(panel.getByTestId('webhook-deliveries')).toContainText('document.indexed');

  // --- clean up the subscription; revoke the token, and the API shuts at once.
  await hook.getByRole('button', { name: 'Remove' }).click();
  await expect(admin.getByTestId('webhook').filter({ hasText: hookUrl })).toHaveCount(0);

  await author.reload();
  await author.getByTestId('token-list').getByRole('row', { name: new RegExp(`CI ${stamp}`) }).getByRole('button', { name: 'Revoke' }).click();
  await expect(author.getByTestId('token-list').getByRole('row', { name: new RegExp(`CI ${stamp}`) })).toContainText('revoked');
  const refused = await ci.get('/api/v1/spaces/SJ/requirements');
  expect(refused.status()).toBe(401);
  expect(refused.headers()['content-type']).toContain('application/problem+json');

  await ci.dispose();
});
