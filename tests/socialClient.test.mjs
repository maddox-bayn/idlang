import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { build } from 'esbuild';

// Bundle the actual browser client with a split-deployment URL, without a DOM.
const { outputFiles } = await build({
  entryPoints: ['src/api/socialClient.ts'], bundle: true, write: false,
  format: 'esm', platform: 'browser',
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('https://api.example.test/') },
});
const client = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const originalFetch = globalThis.fetch;
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
afterEach(() => { globalThis.fetch = originalFetch; storage.clear(); });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('login uses configured backend, cookies, and backend-relative avatar', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.example.test/api/auth/login');
    assert.equal(options.credentials, 'include');
    assert.deepEqual(JSON.parse(options.body), { identifier: 'oche', password: 'password' });
    return json({ user: { id: 'real-user', avatar_url: '/uploads/avatar.png' } });
  };
  const user = await client.loginUser(' oche ', 'password');
  assert.equal(user.avatar_url, 'https://api.example.test/uploads/avatar.png');
});

test('a missing endpoint is not reported as a missing account', async () => {
  globalThis.fetch = async () => new Response('Not Found', { status: 404 });
  await assert.rejects(client.loginUser('oche', 'password'), (error) => error.code !== 'USER_NOT_FOUND');
  globalThis.fetch = async () => json({ code: 'USER_NOT_FOUND', error: 'Account does not exist.' }, 404);
  await assert.rejects(client.loginUser('oche', 'password'), { code: 'USER_NOT_FOUND' });
});

const privateOperations = [
  ['profile update', () => client.updateUserProfile({ display_name: 'New Name' })],
  ['avatar upload', () => client.uploadUserAvatar(new Blob(['avatar']))],
  ['create post', () => client.createPost({ user_id: 'user_oche', content: 'Hello', media_type: 'text' })],
  ['send message', () => client.sendMessage('user_oche', 'user_ada', 'Hello')],
  ['read messages', () => client.fetchMessages('user_oche', 'user_ada')],
  ['connections', () => client.fetchConnectionsList()],
  ['user search', () => client.searchRealUsers('oche')],
  ['profile', () => client.fetchProfile('user_oche', 'user_ada')],
  ['learning progress', () => client.fetchLearningTracks('user_oche')],
];
for (const [name, action] of privateOperations) {
  test(`${name} never invents success or private data after failure`, async () => {
    for (const status of [401, 403, 500]) {
      globalThis.fetch = async () => json({ error: 'Request denied' }, status);
      await assert.rejects(action(), { status });
      assert.equal(storage.size, 0);
    }
    globalThis.fetch = async () => { throw new TypeError('Network unavailable'); };
    await assert.rejects(action(), /Network unavailable/);
    assert.equal(storage.size, 0);
  });
}

test('logout preserves UI identity until server confirms revocation', async () => {
  storage.set('idlang_current_user', 'cached');
  globalThis.fetch = async () => json({ error: 'Unavailable' }, 500);
  await assert.rejects(client.logoutUser());
  assert.equal(storage.get('idlang_current_user'), 'cached');
  globalThis.fetch = async () => json({ ok: true });
  await client.logoutUser();
  assert.equal(storage.size, 0);
});

test('library links target backend and preserve external URLs', () => {
  assert.equal(client.libraryFileURL({ id: 'book', file_url: '/api/library/book/file' }), 'https://api.example.test/api/library/book/file');
  assert.equal(client.libraryFileURL({ id: 'book' }, true), 'https://api.example.test/api/library/book/file?inline=1');
  assert.equal(client.apiAssetURL('https://cdn.example.test/a.png'), 'https://cdn.example.test/a.png');
});


test('successful HTML responses cannot masquerade as saved posts', async () => {
  globalThis.fetch = async () => new Response('<html>Frontend fallback</html>');
  await assert.rejects(client.createPost({ user_id: 'user_oche', content: 'Hello', media_type: 'text' }), /invalid response/);
});

test('inline library links keep the preview query on backend file URLs', () => {
  assert.equal(client.libraryFileURL({ id: 'book', file_url: '/api/library/book/file' }, true), 'https://api.example.test/api/library/book/file?inline=1');
});
