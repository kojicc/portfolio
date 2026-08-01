// Live GitHub contribution graph for the portfolio.
// Returns the last ~year of daily contribution activity (the "squares"): each
// day has a date, a commit/contribution count, and an intensity level 0-4.
// Data comes from the public contributions API (mirrors GitHub's own graph),
// cached in Upstash (~30 min) so the page loads instantly and we stay light.
// Works with no env vars; optionally set GITHUB_USER.
// Returns: { days: [{date, count, level}], total, cached }.

const USER = process.env.GITHUB_USER || 'kojicc';
const CACHE_KEY = 'gh:contrib:' + USER;
const CACHE_TTL = 1800; // seconds

module.exports = async function handler(req, res) {
  const R_URL = process.env.UPSTASH_REDIS_REST_URL;
  const R_TOK = process.env.UPSTASH_REDIS_REST_TOKEN;

  async function redis(cmd) {
    const r = await fetch(R_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + R_TOK, 'content-type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    const d = await r.json();
    return d && d.result;
  }

  // 1) cache
  if (R_URL && R_TOK) {
    try {
      const hit = await redis(['GET', CACHE_KEY]);
      if (hit) {
        res.setHeader('cache-control', 'public, max-age=300');
        res.status(200).json(Object.assign(JSON.parse(hit), { cached: true }));
        return;
      }
    } catch (e) { /* fall through */ }
  }

  // 2) fresh
  try {
    const r = await fetch('https://github-contributions-api.jogruber.de/v4/' + encodeURIComponent(USER) + '?y=last', {
      headers: { 'User-Agent': 'jeiko-portfolio', Accept: 'application/json' },
    });
    if (!r.ok) { res.status(200).json({ days: [], total: 0, cached: false, error: 'source ' + r.status }); return; }
    const j = await r.json();
    const days = (Array.isArray(j.contributions) ? j.contributions : []).map((d) => ({
      date: d.date, count: d.count || 0, level: typeof d.level === 'number' ? d.level : 0,
    }));
    const total = (j.total && (j.total.lastYear != null ? j.total.lastYear : Object.values(j.total).reduce((a, b) => a + b, 0)))
      || days.reduce((a, d) => a + d.count, 0);

    const payload = { days, total };
    if (R_URL && R_TOK && days.length) {
      try { await redis(['SET', CACHE_KEY, JSON.stringify(payload), 'EX', CACHE_TTL]); } catch (e) {}
    }
    res.setHeader('cache-control', 'public, max-age=300');
    res.status(200).json(Object.assign(payload, { cached: false }));
  } catch (e) {
    res.status(200).json({ days: [], total: 0, cached: false, error: String(e && e.message || e) });
  }
};
