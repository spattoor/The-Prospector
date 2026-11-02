const $ = id => document.getElementById(id);
let current = null, user = null;
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
  for (const item of items) {
    const article = document.createElement('article'); article.className = 'card';
    const source = document.createElement('small'); source.textContent = item.source;
    const heading = document.createElement('h2'), link = document.createElement('a');
    link.textContent = item.title; link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; heading.append(link);
    const desc = document.createElement('p'); desc.textContent = item.description;
    const button = document.createElement('button'); button.textContent = favorites ? 'Remove favorite' : 'Save favorite';
    button.addEventListener('click', async () => {
      try {
        if (!user) throw new Error('Sign in to save persistent favorites.');
        if (favorites) { await api('/api/favorites/' + encodeURIComponent(item.id), { method: 'DELETE' }); await showFavorites(); }
        else await post('/api/favorites', { query: current.query, id: item.id });
        message(favorites ? 'Removed from your favorites.' : 'Saved to your MongoDB collection.');
      } catch (e) { message(e.message); }
    });
    article.append(source, heading, desc, button); $('results').append(article);
  }
}
$('search-form').addEventListener('submit', async e => {
  e.preventDefault(); message('Searching live sources…'); $('ai-panel').hidden = true;
  try {
    current = await api('/api/search?q=' + encodeURIComponent($('query').value.trim())); cards(current.items);
    $('sources').textContent = current.sources.map(s => `${s.source}: ${s.status} (${s.count})`).join(' · ');
    message(`${current.items.length} deduplicated results. Retrieved ${current.retrievedAt}.`);
  } catch (e) { message(e.message); }
});
$('show-results').onclick = () => current ? cards(current.items) : message('Run a search first.');
async function showFavorites() { try { const d = await api('/api/favorites'); cards(d.items, true); message(`${d.items.length} saved results.`); } catch (e) { message(e.message); } }
$('show-favorites').onclick = showFavorites;
$('show-history').onclick = async () => {
  try { const d = await api('/api/history'); $('results').replaceChildren(); for (const x of d.items) { const p = document.createElement('p'); p.textContent = `${x.query} · ${new Date(x.createdAt).toLocaleString()}`; $('results').append(p); } message('Your recent searches from MongoDB.'); } catch (e) { message(e.message); }
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
  $('account-status').textContent = user ? `Signed in as ${user.username}. Favorites and history persist in MongoDB.` : d.persistentAccountsAvailable ? 'Create a demo account to save favorites. Do not reuse a real password.' : 'Guest-only mode: MongoDB is not configured. Authentication, favorites and history are unavailable.';
  $('account-form').hidden = !d.persistentAccountsAvailable;
}
$('account-form').addEventListener('submit', async e => {
  e.preventDefault();
  try { await post('/api/auth/' + e.submitter.value, { username: $('username').value, password: $('password').value }); $('password').value = ''; await account(); message('Account session established.'); } catch (e) { message(e.message); }
});
$('logout').onclick = async () => { try { await post('/api/auth/logout', {}); await account(); message('Signed out.'); } catch (e) { message(e.message); } };
Promise.all([account(), api('/api/health').then(d => { $('sources').textContent = `Available sources: ${d.searchSources.join(', ')} · AI ${d.aiConfigured ? 'configured (verify with AI picks)' : 'not configured'}`; })]).catch(e => message(e.message));
