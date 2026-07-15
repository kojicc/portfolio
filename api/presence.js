// Real live-presence + daily visitor counter, backed by Upstash Redis (REST).
// The browser heartbeats every ~5s. We return:
//   - count: people online right now (active in the last TTL window)
//   - viewers: anonymized list (city from Vercel geo headers + current section)
//   - today: unique visitors today (Asia/Manila calendar day), keyed by a
//     persistent per-browser id so reloads don't inflate it.
// Env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN. Without them it honestly
// reports just the current visitor.

const KEY = 'presence';
const TTL_MS = 20000;       // "online now" window (~4 missed 5s heartbeats)
const HASH_EXPIRE = 180;    // whole presence hash self-cleans after 3 min idle
const DAY_EXPIRE = 172800;  // keep each day's visitor set for 2 days

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const clean = (v, n) => ((v || '').toString().replace(/[^a-zA-Z0-9]/g, '').slice(0, n));
  const id = clean(body && body.id, 40) || ('a' + Math.random().toString(36).slice(2, 10));
  const pid = clean(body && body.pid, 60) || id;
  const view = ((body && body.view) || '').toString().slice(0, 20);
  const city = (req.headers['x-vercel-ip-city'] ? decodeURIComponent(req.headers['x-vercel-ip-city']) : '') || '';

  const URL = process.env.UPSTASH_REDIS_REST_URL;
  const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!URL || !TOKEN) { res.status(200).json({ count: 1, viewers: [], today: 1, configured: false }); return; }

  // Asia/Manila calendar day, e.g. "2026-07-15"
  let day;
  try { day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch (e) { day = new Date().toISOString().slice(0, 10); }
  const dayKey = 'visitors:' + day;

  async function pipe(cmds) {
    const r = await fetch(URL + '/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify(cmds),
    });
    const d = await r.json();
    if (!Array.isArray(d)) throw new Error((d && d.error) || 'redis error');
    return d.map((x) => (x && x.result));
  }

  try {
    const now = Date.now();
    const cutoff = now - TTL_MS;
    const selfVal = JSON.stringify({ city, view, ts: now });

    // one round trip: upsert self, add to today's set, read hash + today count
    const results = await pipe([
      ['HSET', KEY, id, selfVal],
      ['EXPIRE', KEY, HASH_EXPIRE],
      ['SADD', dayKey, pid],
      ['EXPIRE', dayKey, DAY_EXPIRE],
      ['HGETALL', KEY],
      ['SCARD', dayKey],
    ]);
    const flat = results[4];
    const todayCount = results[5];

    const map = {};
    const arr = Array.isArray(flat) ? flat : [];
    for (let i = 0; i < arr.length; i += 2) { try { map[arr[i]] = JSON.parse(arr[i + 1]); } catch (e) {} }
    map[id] = { city, view, ts: now };

    const stale = [];
    const active = [];
    Object.keys(map).forEach((k) => {
      if (map[k] && map[k].ts > cutoff) active.push({ id: k, city: map[k].city, view: map[k].view });
      else stale.push(k);
    });
    if (stale.length) { try { await pipe([['HDEL', KEY].concat(stale)]); } catch (e) {} }

    const viewers = active
      .filter((e) => e.id !== id)
      .slice(0, 12)
      .map((e) => ({ loc: e.city || 'Somewhere', view: e.view || '', initials: (e.id || '').slice(0, 2).toUpperCase() }));

    res.status(200).json({ count: active.length, viewers, today: Number(todayCount) || active.length, configured: true });
  } catch (e) {
    res.status(200).json({ count: 1, viewers: [], today: 1, configured: false });
  }
};
