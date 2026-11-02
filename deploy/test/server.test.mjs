import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { passwordHash, passwordMatches } from '../store.mjs';
import { retrieveCampus } from '../campus.mjs';

const upstream = async url => new Response(JSON.stringify(url.includes('api.github.com') ? {
  items: [{ id: 10, full_name: 'demo/repository', description: 'A fixture, not a live result', html_url: 'https://github.com/demo/repository' }],
} : { hits: [{ objectID: '42', title: 'Fixture story', points: 5, url: 'https://example.com/story' }] }), { status: 200 });
function memoryStore() {
  const users = new Map(), sessions = new Map(), saved = new Map(), history = new Map();
  return {
    async register(username, hash) { if (users.has(username)) throw Object.assign(new Error(), { code: 11000 }); const u = { id: username, username, hash }; users.set(username, u); return { id: username, username }; },
    async lookup(name) { return users.get(name); }, async createSession(u, t) { sessions.set(t, u); },
    async session(t) { return sessions.get(t); }, async endSession(t) { sessions.delete(t); },
    async save(u, item) { saved.set(u + ':' + item.id, { u, item }); },
    async favorites(u) { return [...saved.values()].filter(x => x.u === u).map(x => x.item); },
    async remove(u, id) { saved.delete(u + ':' + id); },
    async remember(u, q) { history.set(u, [...(history.get(u) || []), { query: q, createdAt: new Date() }]); },
    async history(u) { return history.get(u) || []; },
  };
}
async function withServer(store, fn) {
  const server = createApp({ store, fetchImpl: upstream }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test('password hashing verifies the real password and rejects a different one', async () => {
  const hash = await passwordHash('synthetic-test-password');
  assert.equal(await passwordMatches('synthetic-test-password', hash), true);
  assert.equal(await passwordMatches('different-test-password', hash), false);
  assert.notEqual(hash, await passwordHash('synthetic-test-password'));
});
test('guest mode exposes its limitations and does not serve repository secrets', async () => withServer(null, async base => {
  const health = await (await fetch(base + '/api/health')).json(); assert.equal(health.storage, 'guest-only');
  for (const p of ['/.env', '/server/.env', '/package.json', '/simple-app.html.backup']) assert.equal((await fetch(base + p)).status, 404);
  assert.equal((await fetch(base + '/api/favorites')).status, 401);
  const d = await (await fetch(base + '/api/search?q=fixture')).json(); assert.equal(d.items.length, 2);
  assert.equal(d.sources.every(x => x.status === 'live'), true); // mocked upstream availability only
}));
test('account ownership isolates favorites and history; logout invalidates session', async () => withServer(memoryStore(), async base => {
  async function register(username) {
    const r = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'synthetic-test-password' }) });
    assert.equal(r.status, 200); return r.headers.get('set-cookie').split(';')[0];
  }
  const first = await register('demo-first'), second = await register('demo-second');
  await fetch(base + '/api/search?q=fixture', { headers: { cookie: first } });
  const save = await fetch(base + '/api/favorites', { method: 'POST', headers: { cookie: first, 'content-type': 'application/json' }, body: JSON.stringify({ query: 'fixture', id: 'github-10' }) }); assert.equal(save.status, 200);
  assert.equal((await (await fetch(base + '/api/favorites', { headers: { cookie: first } })).json()).items.length, 1);
  assert.equal((await (await fetch(base + '/api/favorites', { headers: { cookie: second } })).json()).items.length, 0);
  assert.equal((await (await fetch(base + '/api/history', { headers: { cookie: second } })).json()).items.length, 0);
  await fetch(base + '/api/auth/logout', { method: 'POST', headers: { cookie: first } });
  assert.equal((await fetch(base + '/api/favorites', { headers: { cookie: first } })).status, 401);
}));
test('cross-origin account changes and malformed input are rejected', async () => withServer(memoryStore(), async base => {
  const r = await fetch(base + '/api/auth/register', { method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: JSON.stringify({ username: 'demo', password: 'synthetic-test-password' }) }); assert.equal(r.status, 403);
  assert.equal((await fetch(base + '/api/search?q=' + 'x'.repeat(121))).status, 400);
}));
test('campus retrieval is limited to curated sources and unsupported questions remain unsupported', async () => {
  assert.equal(retrieveCampus('Where is financial aid?').every(f => f.source.startsWith('https://www.depts.ttu.edu/')), true);
  assert.equal(retrieveCampus('Tell me the secret exam answers').length, 0);
  await withServer(null, async base => {
    const r = await fetch(base + '/api/campus-chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Tell me the secret exam answers' }) });
    const d = await r.json(); assert.equal(d.supported, false); assert.equal(d.status, 'retrieval');
  });
});
