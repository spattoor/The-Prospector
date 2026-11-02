import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { selectEvidence, AIError } from './ai.mjs';
import { retrieveCampus } from './campus.mjs';
import { searchSources } from './search.mjs';
import { connectStore, passwordHash, passwordMatches } from './store.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
function token(req) { return (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('prospector_session='))?.split('=')[1] || ''; }

export function createApp({ store = null, fetchImpl = fetch } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    const allowed = process.env.CAMPUS_ORIGIN || 'https://spattoor.github.io';
    if (req.path === '/api/campus-chat' && req.headers.origin === allowed) {
      res.set({ 'Access-Control-Allow-Origin': allowed, Vary: 'Origin',
        'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  app.use('/api', rateLimit({ windowMs: 60000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use('/api/auth', rateLimit({ windowMs: 900000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false }));
  const searches = new Map();
  const asyncUser = async (req, res, next) => {
    const sid = token(req);
    req.user = store && /^[a-f0-9]{64}$/.test(sid) ? await store.session(sid) : null;
    next();
  };
  const auth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Sign in to use persistent favorites and history.' });
  const sameOrigin = (req, res, next) => {
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.get('host')) return res.status(403).json({ error: 'Origin not allowed.' }); }
      catch { return res.sendStatus(403); }
    }
    next();
  };
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', storage: store ? 'mongodb' : 'guest-only',
    aiConfigured: Boolean(process.env.GEMINI_API_KEY), searchSources: ['GitHub', 'Hacker News'] }));
  app.get('/api/me', asyncUser, (req, res) => res.json({ user: req.user, persistentAccountsAvailable: Boolean(store) }));
  app.post('/api/auth/:action', sameOrigin, async (req, res) => {
    if (!store) return res.status(503).json({ error: 'Persistent accounts require a fresh MongoDB connection. Guest search is available.' });
    const { action } = req.params;
    if (action === 'logout') {
      await store.endSession(token(req));
      return res.clearCookie('prospector_session', { path: '/' }).json({ ok: true });
    }
    if (!['login', 'register'].includes(action)) return res.sendStatus(404);
    const { username, password } = req.body || {};
    if (!text(username, 40) || !/^[a-zA-Z0-9_-]{3,40}$/.test(username) || !text(password, 128) || password.length < 12)
      return res.status(400).json({ error: 'Use a 3–40 character username and a password of 12–128 characters.' });
    const normalized = username.toLowerCase();
    let user;
    if (action === 'register') {
      try { user = await store.register(normalized, await passwordHash(password)); }
      catch (e) { if (e.code === 11000) return res.status(409).json({ error: 'Choose another username.' }); throw e; }
    } else {
      const found = await store.lookup(normalized);
      if (!found || !await passwordMatches(password, found.hash)) return res.status(401).json({ error: 'Invalid username or password.' });
      user = { id: found.id, username: found.username };
    }
    const sid = randomBytes(32).toString('hex');
    await store.createSession(user, sid);
    res.cookie('prospector_session', sid, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 86400000, path: '/' });
    res.json({ user });
  });
  app.get('/api/search', asyncUser, async (req, res) => {
    if (!text(req.query.q, 120)) return res.status(400).json({ error: 'Enter a search of 1–120 characters.' });
    const q = req.query.q.trim();
    const cached = searches.get(q);
    const result = cached && Date.now() - cached.time < 300000 ? cached.result : await searchSources(q, fetchImpl);
    searches.set(q, { result, time: Date.now() });
    if (searches.size > 100) searches.delete(searches.keys().next().value);
    if (store && req.user) await store.remember(req.user.id, q);
    res.json(result);
  });
  app.post('/api/analyze', async (req, res) => {
    const q = req.body?.query;
    if (!text(q, 120)) return res.status(400).json({ error: 'A search query is required.' });
    const saved = searches.get(q.trim());
    if (!saved || Date.now() - saved.time > 300000 || !saved.result.items.length)
      return res.status(400).json({ error: 'Run a fresh search with results first.' });
    const facts = saved.result.items.slice(0, 15).map(x => ({ id: x.id, text: `${x.title}: ${x.description}`, source: x.source, url: x.url }));
    try { res.json(await selectEvidence(`Select results relevant to: ${q}`, facts, fetchImpl)); }
    catch (e) { if (e instanceof AIError) return res.status(503).json({ status: 'unavailable', error: e.message }); throw e; }
  });
  app.get('/api/favorites', asyncUser, auth, async (req, res) => res.json({ items: await store.favorites(req.user.id) }));
  app.post('/api/favorites', sameOrigin, asyncUser, auth, async (req, res) => {
    const { query, id } = req.body || {};
    if (!text(query, 120) || !text(id, 100)) return res.sendStatus(400);
    const found = searches.get(query)?.result.items.find(x => x.id === id);
    if (!found) return res.status(400).json({ error: 'Save a result from a fresh search.' });
    await store.save(req.user.id, found);
    res.json({ ok: true });
  });
  app.delete('/api/favorites/:id', sameOrigin, asyncUser, auth, async (req, res) => {
    if (req.params.id.length > 100) return res.sendStatus(400);
    await store.remove(req.user.id, req.params.id); res.json({ ok: true });
  });
  app.get('/api/history', asyncUser, auth, async (req, res) => res.json({ items: await store.history(req.user.id) }));
  app.post('/api/campus-chat', async (req, res) => {
    const question = req.body?.question;
    if (!text(question, 300)) return res.status(400).json({ error: 'Use a question of 1–300 characters.' });
    const evidence = retrieveCampus(question);
    if (!evidence.length) return res.json({ status: 'retrieval', supported: false, evidence: [], message: 'I do not know from the curated TTU sources. No AI call was made.' });
    try {
      const facts = evidence.map(({ id, text, source }) => ({ id, text, source }));
      res.json({ ...await selectEvidence(question, facts, fetchImpl), reviewedOn: '2026-11-01' });
    } catch (e) { if (e instanceof AIError) return res.status(503).json({ status: 'unavailable', error: e.message, evidence: [], reviewedOn: '2026-11-01' }); throw e; }
  });
  // Serve only reviewed public assets, never the repository root, env files, or backup HTML.
  app.use(express.static(path.join(DIR, 'public'), { dotfiles: 'deny', index: 'index.html' }));
  app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((err, _req, res, _next) => res.status(err.status >= 400 && err.status < 500 ? err.status : 500).json({ error: 'Request could not be completed.' }));
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const store = process.env.MONGODB_URI ? await connectStore(process.env.MONGODB_URI) : null;
    const server = createApp({ store }).listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Prospector demo server ready'));
    process.on('SIGTERM', () => server.close(async () => { await store?.close(); process.exit(0); }));
  } catch { console.error('Startup failed. Check the private database configuration. No credentials are logged.'); process.exit(1); }
}
