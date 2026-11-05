import { test, expect, type Page } from '@playwright/test';

async function mockAPI(page: Page, initialRole: string | null = null) {
  let user = initialRole ? { id: 'account', username: 'oche', display_name: 'Oche', role: initialRole } : null;
  let used = false;
  let translations = 0;
  let adminCalls = 0;
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    let status = 200;
    if (path === '/api/auth/me') data = { user };
    else if (path === '/api/translation/access') data = { authenticated: !!user, trial_remaining: !used };
    else if (path === '/api/translate') {
      translations++;
      if (used && !user) { status = 401; data = { code: 'SIGN_IN_REQUIRED', error: 'Sign in to continue.' }; }
      else { used = true; data = { translation: 'Olé', model: 'dictionary' }; }
    } else if (path === '/api/auth/login' || path === '/api/auth/signup') {
      user = { id: 'account', username: 'oche', display_name: 'Oche', role: 'member' }; data = { user };
    } else if (path === '/api/auth/logout') { user = null; data = { ok: true }; }
    else if (path === '/api/connections') data = { incoming: [], outgoing: [], connected: [] };
    else if (path.startsWith('/api/admin/')) {
      adminCalls++;
      if (user?.role !== 'admin') { status = 403; data = { error: 'Administrator access required' }; }
      else if (path.endsWith('/overview')) data = { users: 1, posts: 2, drafts: 1, database: 'turso' };
      else if (path.endsWith('/users')) data = { users: [user], total: 1, page: 1, limit: 25 };
      else data = { items: [{ id: 'book', title: 'Idoma stories', author: 'Oche', license: 'CC-BY-4.0', file_url: '/api/library/book/file' }], total: 1, page: 1, limit: 24 };
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
  return { translations: () => translations, adminCalls: () => adminCalls };
}

test('guests see only Translate, get one result, then sign in and continue', async ({ page }) => {
  const api = await mockAPI(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Keep the language close.' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.locator('a[href="/admin"]')).toHaveCount(0);
  await page.getByPlaceholder('Type English text to translate...').fill('house');
  await page.getByRole('button', { name: 'Translate to Idoma', exact: true }).click();
  await expect(page.getByText('Olé', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign In to Idlang', exact: true })).toBeVisible();
  await page.getByTitle('Close modal').click();
  await page.getByRole('button', { name: 'Translate to Idoma', exact: true }).click();
  expect(api.translations()).toBe(1);
  await page.getByPlaceholder('e.g. oche_odeh or oche@idlang.org').fill('oche');
  await page.getByPlaceholder('Enter your account password').fill('valid-password');
  await page.getByRole('button', { name: 'Sign In to Idlang', exact: true }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.getByRole('button', { name: 'Translate to Idoma', exact: true }).click();
  await expect.poll(api.translations).toBe(2);
  await page.getByRole('button', { name: 'Log Out', exact: true }).click();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Your free translation is complete.', { exact: false })).toBeVisible();
});

test('create-account button opens registration directly on mobile', async ({ page }) => {
  await mockAPI(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create Ancestral Profile', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('admin URL is separate and refuses an ordinary member', async ({ page }) => {
  const api = await mockAPI(page, 'member');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Administrator access required' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Registered accounts' })).toHaveCount(0);
  expect(api.adminCalls()).toBe(0);
});

test('administrator sees accounts and moderation at direct URL', async ({ page }) => {
  const api = await mockAPI(page, 'admin');
  await page.goto('/admin/');
  await expect(page.getByRole('heading', { name: 'Registered accounts' })).toBeVisible();
  await expect(page.getByText('Database: Turso libSQL')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible();
  expect(api.adminCalls()).toBeGreaterThanOrEqual(3);
});

test('anonymous admin visit prompts for administrator sign-in', async ({ page }) => {
  await mockAPI(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Administrator sign-in' })).toBeVisible();
});
