const $ = id => document.getElementById(id);
let current = null, user = null;
function loadLocal(key) { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v.slice(0,50) : []; } catch { return []; } }
let guestFavorites = loadLocal('prospector-favorites-v1'), guestHistory = loadLocal('prospector-history-v1');
function saveLocal(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
function publicUrl(value) { try { return ['https:','http:'].includes(new URL(value).protocol); } catch { return false; } }

async function api(url, options = {}) {
  const r = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d;
}
const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body) });
function message(s) { $('message').textContent = s; }
function cards(items, favorites = false) {
  $('results').replaceChildren();
  for (const item of items.filter(i => i && typeof i.title === 'string' && publicUrl(i.url))) {
    const article = document.createElement('article'); article.className = 'card';
    const source = document.createElement('small'); source.textContent = item.source;
    const heading = document.createElement('h2'), link = document.createElement('a');
    link.textContent = item.title; link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; heading.append(link);
    const desc = document.createElement('p'); desc.textContent = item.description;
    const button = document.createElement('button'); button.textContent = favorites ? 'Remove favorite' : 'Save favorite';
    button.addEventListener('click', async () => {
      try {
        if (!user) {
          if (favorites) guestFavorites = guestFavorites.filter(f => f.id !== item.id);
          else if (!guestFavorites.some(f => f.id === item.id)) guestFavorites = [item, ...guestFavorites].slice(0,50);
          const persisted = saveLocal('prospector-favorites-v1', guestFavorites);
          if (favorites) await showFavorites();
          message((favorites ? 'Favorite removed.' : 'Favorite saved.') + (persisted ? ' Stored in this browser only.' : ' Browser storage is unavailable; kept in this session only.'));
          return;
        }
        if (favorites) { await api('/api/favorites/' + encodeURIComponent(item.id), { method: 'DELETE' }); await showFavorites(); }
        else await post('/api/favorites', { query: current.query, id: item.id });
        message(favorites ? 'Removed from your favorites.' : 'Saved to your account collection.');
      } catch (e) { message(e.message); }
    });
    article.append(source, heading, desc, button); $('results').append(article);
  }
}
$('search-form').addEventListener('submit', async e => {
  e.preventDefault(); message('Searching live sources…'); $('ai-panel').hidden = true;
  try {
    current = await api('/api/search?q=' + encodeURIComponent($('query').value.trim())); cards(current.items);
    if (!user) { guestHistory = [{query: current.query, createdAt: new Date().toISOString()}, ...guestHistory].slice(0,50); saveLocal('prospector-history-v1', guestHistory); }
    $('sources').textContent = current.sources.map(s => `${s.source}: ${s.status} (${s.count})`).join(' · ');
    message(`${current.items.length} deduplicated results. Retrieved ${current.retrievedAt}.`);
  } catch (e) { message(e.message); }
});
$('show-results').onclick = () => current ? cards(current.items) : message('Run a search first.');
async function showFavorites() { try { if (!user) { cards(guestFavorites, true); message(`${guestFavorites.length} favorites in this browser. No account needed.`); return; } const d = await api('/api/favorites'); cards(d.items, true); message(`${d.items.length} saved results.`); } catch (e) { message(e.message); } }
$('show-favorites').onclick = showFavorites;
$('show-history').onclick = async () => {
  try { const d = user ? await api('/api/history') : {items: guestHistory}; $('results').replaceChildren(); for (const x of d.items) { const p = document.createElement('p'); p.textContent = `${x.query} · ${new Date(x.createdAt).toLocaleString()}`; $('results').append(p); } message(user ? 'Your recent account searches.' : 'Recent searches stored in this browser only.'); } catch (e) { message(e.message); }
};
$('recommend').onclick = async () => {
  if (!current) return message('Run a search first.');
  const button = $('recommend'); button.disabled = true; message('Asking AI to select relevant source evidence…');
  try {
    const d = await post('/api/analyze', { query: current.query });
    $('ai-panel').replaceChildren(); $('ai-panel').hidden = false;
    const meta = document.createElement('p'); meta.textContent = `AI response · ${d.provider} · ${d.modelVersion}${d.cached ? ' · Cached' : ''}`; $('ai-panel').append(meta);
    if (!d.supported) { const p = document.createElement('p'); p.textContent = 'The model could not select supported evidence from these results.'; $('ai-panel').append(p); }
    for (const fact of d.evidence) { const p = document.createElement('p'); p.textContent = fact.text; $('ai-panel').append(p); }
    message('AI selected only validated result IDs; displayed facts come from the original source data.');
  } catch (e) { message('No AI answer generated: ' + e.message); } finally { button.disabled = false; }
};
async function account() {
  const d = await api('/api/me'); user = d.user;
  $('account-status').textContent = user ? `Signed in as ${user.username}. Favorites and history are saved to your account.` : d.persistentAccountsAvailable ? 'Create a demo account to save favorites. Do not reuse a real password.' : 'Guest mode: favorites and history stay in this browser. No account is needed. Browser storage may be cleared by your browser.';
  $('account-form').hidden = !d.persistentAccountsAvailable;
}
$('account-form').addEventListener('submit', async e => {
  e.preventDefault();
  try { await post('/api/auth/' + e.submitter.value, { username: $('username').value, password: $('password').value }); $('password').value = ''; await account(); message('Account session established.'); } catch (e) { message(e.message); }
});
$('logout').onclick = async () => { try { await post('/api/auth/logout', {}); await account(); message('Signed out.'); } catch (e) { message(e.message); } };
Promise.all([account(), api('/api/health').then(d => { $('sources').textContent = `Live sources: ${d.searchSources.join(', ')}`; $('recommend').hidden = !d.aiConfigured; })]).catch(e => message(e.message));
