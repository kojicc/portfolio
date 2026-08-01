// Live GitHub commit feed for the portfolio.
// Pulls kojicc's recent public push activity, flattens it into a newest-first
// list of commits, and caches the result in Upstash (~5 min) so we stay well
// inside GitHub's unauthenticated rate limit. Works with no env vars at all;
// optionally set GITHUB_TOKEN for a higher rate limit and GITHUB_USER to change
// the account. Returns: { commits: [{repo, message, sha, url, date}], cached }.

const USER = process.env.GITHUB_USER || 'kojicc';
const CACHE_KEY = 'gh:commits:' + USER;
const CACHE_TTL = 300; // seconds
const MAX_COMMITS = 14;

module.exports = async function handler(req, res) {
  const URL = process.env.UPSTASH_REDIS_REST_URL;
  const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  async function redis(cmd) {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    const d = await r.json();
    return d && d.result;
  }

  // 1) serve from cache if we have it
  if (URL && TOKEN) {
    try {
      const hit = await redis(['GET', CACHE_KEY]);
      if (hit) {
        res.setHeader('cache-control', 'public, max-age=60');
        res.status(200).json({ commits: JSON.parse(hit), cached: true });
        return;
      }
    } catch (e) { /* fall through to live fetch */ }
  }

  // 2) fetch fresh activity from GitHub
  try {
    const headers = { 'User-Agent': 'jeiko-portfolio', Accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;

    const gh = await fetch('https://api.github.com/users/' + USER + '/events/public?per_page=60', { headers });
    if (!gh.ok) { res.status(200).json({ commits: [], cached: false, error: 'github ' + gh.status }); return; }
    const events = await gh.json();

    const seen = new Set();
    const commits = [];
    for (const ev of (Array.isArray(events) ? events : [])) {
      if (ev.type !== 'PushEvent' || !ev.payload || !Array.isArray(ev.payload.commits)) continue;
      const repoFull = (ev.repo && ev.repo.name) || '';
      const repoShort = repoFull.split('/').pop();
      // GitHub lists a push's commits oldest-first; reverse for newest-first.
      const pushCommits = ev.payload.commits.slice().reverse();
      for (const c of pushCommits) {
        if (!c || !c.sha || seen.has(c.sha)) continue;
        const msg = (c.message || '').split('\n')[0].trim();
        if (!msg || /^merge\b/i.test(msg)) continue; // skip empty + merge noise
        seen.add(c.sha);
        commits.push({
          repo: repoShort,
          message: msg.length > 84 ? msg.slice(0, 83) + '…' : msg,
          sha: c.sha.slice(0, 7),
          url: 'https://github.com/' + repoFull + '/commit/' + c.sha,
          date: ev.created_at,
        });
        if (commits.length >= MAX_COMMITS) break;
      }
      if (commits.length >= MAX_COMMITS) break;
    }

    if (URL && TOKEN && commits.length) {
      try { await redis(['SET', CACHE_KEY, JSON.stringify(commits), 'EX', CACHE_TTL]); } catch (e) {}
    }

    res.setHeader('cache-control', 'public, max-age=60');
    res.status(200).json({ commits, cached: false });
  } catch (e) {
    res.status(200).json({ commits: [], cached: false, error: 'fetch failed' });
  }
};
