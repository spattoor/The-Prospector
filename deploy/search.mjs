export function safeUrl(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; }
  catch { return null; }
}
async function json(url, fetchImpl) {
  const r = await fetchImpl(url, { headers: { 'user-agent': 'Prospector-Portfolio/1.0', accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  if (text.length > 2000000) throw new Error('Source response too large');
  return JSON.parse(text);
}
export async function searchSources(query, fetchImpl = fetch) {
  const sources = [
    ['GitHub', async () => {
      const d = await json(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=10&sort=updated`, fetchImpl);
      if (!Array.isArray(d.items)) throw new Error('Unexpected schema');
      return d.items.map(x => ({ id: `github-${x.id}`, title: String(x.full_name || '').slice(0, 180),
        description: String(x.description || '').slice(0, 600), url: safeUrl(x.html_url), source: 'GitHub' }));
    }],
    ['Hacker News', async () => {
      const d = await json(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=10`, fetchImpl);
      if (!Array.isArray(d.hits)) throw new Error('Unexpected schema');
      return d.hits.map(x => ({ id: `hn-${x.objectID}`, title: String(x.title || '').slice(0, 180),
        description: `Hacker News discussion · ${Number(x.points) || 0} points`,
        url: safeUrl(x.url) || `https://news.ycombinator.com/item?id=${encodeURIComponent(x.objectID)}`, source: 'Hacker News' }));
    }],
  ];
  const completed = await Promise.all(sources.map(async ([name, run]) => {
    try { return { source: name, status: 'live', items: (await run()).filter(x => x.title && x.url) }; }
    catch { return { source: name, status: 'unavailable', items: [] }; }
  }));
  const seen = new Set();
  const items = completed.flatMap(s => s.items).filter(x => !seen.has(x.url) && seen.add(x.url));
  return { query, items, sources: completed.map(({ source, status, items }) => ({ source, status, count: items.length })), retrievedAt: new Date().toISOString() };
}
