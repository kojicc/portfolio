// Real live-presence counter for the portfolio.
// Backed by Upstash Redis (free tier) over its REST API. The browser sends a
// heartbeat every ~15s; we store one hash entry per visitor with a timestamp,
// prune anything older than ~35s, and return the true active count + an
// anonymized list (city from Vercel's geo headers, current section).
//
// Setup: create a free Upstash Redis DB, then add these to Vercel env vars:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// Until those exist, this honestly reports just the current visitor (count 1).

const KEY = 'presence';
const TTL_MS = 35000;   // a visitor is "active" if seen in the last 35s
const HASH_EXPIRE = 180; // whole key self-cleans after 3 min idle

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const id = ((body && body.id) || '').toString().replace(/[^a-zA-Z0-9]/g, '').slice(0, 40) || ('a' + Math.random().toString(36).slice(2, 10));
  const view = ((body && body.view) || '').toString().slice(0, 20);
  const city = (req.headers['x-vercel-ip-city'] ? decodeURIComponent(req.headers['x-vercel-ip-city']) : '') || '';

  const URL = process.env.UPSTASH_REDIS_REST_URL;
  const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  // Not configured yet — be honest: just the person making this request.
  if (!URL || !TOKEN) { res.status(200).json({ count: 1, viewers: [], configured: false }); return; }

  async function redis(cmd) {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    const d = await r.json();
    if (d && d.error) throw new Error(d.error);
    return d ? d.result : null;
  }

  try {
    const now = Date.now();
    const cutoff = now - TTL_MS;

    // read current, then upsert self
    const flat = (await redis(['HGETALL', KEY])) || [];
    const map = {};
    for (let i = 0; i < flat.length; i += 2) {
      try { map[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) {}
    }
    map[id] = { city, view, ts: now };
    await redis(['HSET', KEY, id, JSON.stringify(map[id])]);
    await redis(['EXPIRE', KEY, HASH_EXPIRE]);

    // partition active vs stale
    const stale = [];
    const active = [];
    Object.keys(map).forEach((k) => {
      if (map[k] && map[k].ts > cutoff) active.push({ id: k, city: map[k].city, view: map[k].view });
      else stale.push(k);
    });
    if (stale.length) { try { await redis(['HDEL', KEY].concat(stale)); } catch (e) {} }

    const viewers = active
      .filter((e) => e.id !== id)   // "others" only; count still includes everyone
      .slice(0, 12)
      .map((e) => ({ loc: e.city || 'Somewhere', view: e.view || '', initials: (e.id || '').slice(0, 2).toUpperCase() }));

    res.status(200).json({ count: active.length, viewers, configured: true });
  } catch (e) {
    res.status(200).json({ count: 1, viewers: [], configured: false });
  }
};
