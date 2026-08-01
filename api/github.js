// Live GitHub commit feed for the portfolio.
// GitHub's public /events feed returns a stripped push payload for this account
// (no commit messages), so instead we list the user's most-recently-pushed
// public repos and pull the latest commits from each, then merge newest-first.
// Result is cached in Upstash (~15 min) to stay well inside GitHub's
// unauthenticated rate limit (~6 API calls per cache miss). Works with no env
// vars; optionally set GITHUB_TOKEN (higher limit) and GITHUB_USER.
// Returns: { commits: [{repo, message, sha, url, date}], cached }.

const USER = process.env.GITHUB_USER || 'kojicc';
const CACHE_KEY = 'gh:commits:v2:' + USER;
const CACHE_TTL = 900;      // seconds
const REPOS_TO_SCAN = 5;    // how many recently-pushed repos to look at
const COMMITS_PER_REPO = 5;
const MAX_COMMITS = 14;

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

  const gh = {
    'User-Agent': 'jeiko-portfolio',
    Accept: 'application/vnd.github+json',
  };
  if (process.env.GITHUB_TOKEN) gh.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  const ghGet = async (path) => {
    const r = await fetch('https://api.github.com' + path, { headers: gh });
    if (!r.ok) throw new Error('github ' + r.status + ' ' + path);
    return r.json();
  };

  // 1) cache
  if (R_URL && R_TOK) {
    try {
      const hit = await redis(['GET', CACHE_KEY]);
      if (hit) {
        res.setHeader('cache-control', 'public, max-age=120');
        res.status(200).json({ commits: JSON.parse(hit), cached: true });
        return;
      }
    } catch (e) { /* fall through */ }
  }

  // 2) fresh
  try {
    const repos = await ghGet('/users/' + USER + '/repos?sort=pushed&direction=desc&per_page=' + REPOS_TO_SCAN + '&type=owner');
    const top = (Array.isArray(repos) ? repos : []).filter((r) => r && !r.fork).slice(0, REPOS_TO_SCAN);

    const perRepo = await Promise.all(top.map(async (r) => {
      try {
        const list = await ghGet('/repos/' + r.full_name + '/commits?per_page=' + COMMITS_PER_REPO);
        return (Array.isArray(list) ? list : []).map((it) => ({
          repo: r.name,
          full: r.full_name,
          sha: it.sha,
          message: ((it.commit && it.commit.message) || '').split('\n')[0].trim(),
          date: (it.commit && it.commit.author && it.commit.author.date) || (it.commit && it.commit.committer && it.commit.committer.date) || '',
          url: it.html_url,
        }));
      } catch (e) { return []; }
    }));

    const seen = new Set();
    const commits = [];
    perRepo.flat()
      .filter((c) => c.sha && c.message && !/^merge\b/i.test(c.message))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .forEach((c) => {
        if (seen.has(c.sha)) return;
        seen.add(c.sha);
        commits.push({
          repo: c.repo,
          message: c.message.length > 84 ? c.message.slice(0, 83) + '…' : c.message,
          sha: c.sha.slice(0, 7),
          url: c.url,
          date: c.date,
        });
      });

    const out = commits.slice(0, MAX_COMMITS);
    if (R_URL && R_TOK && out.length) {
      try { await redis(['SET', CACHE_KEY, JSON.stringify(out), 'EX', CACHE_TTL]); } catch (e) {}
    }

    res.setHeader('cache-control', 'public, max-age=120');
    res.status(200).json({ commits: out, cached: false });
  } catch (e) {
    res.status(200).json({ commits: [], cached: false, error: String(e && e.message || e) });
  }
};
