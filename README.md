# Jeiko Sy — Portfolio

Static site. Deploy to Vercel (free).

## Option A — GitHub + Vercel (auto-redeploy on every push) ✅ recommended
1. Create a new repo on GitHub (e.g. `portfolio`).
2. Put ALL files in this folder at the repo ROOT (index.html must be at the top level).
   - Fastest: on the repo page, "Add file → Upload files", drag everything in this folder, commit.
   - Or with git:
     ```
     git init
     git add .
     git commit -m "portfolio"
     git branch -M main
     git remote add origin https://github.com/kojicc/portfolio.git
     git push -u origin main
     ```
3. Go to vercel.com → "Add New… → Project" → Import your `portfolio` repo.
4. Framework preset: **Other**. Root directory: **/** . Build command: **(leave empty)**. Output directory: **(leave empty)**.
5. Deploy. You get a live URL like `portfolio-kojicc.vercel.app`.
6. From now on, every `git push` redeploys automatically.

## Option B — Vercel CLI (no GitHub)
```
npm i -g vercel
cd this-folder
vercel        # first run: log in + accept defaults
vercel --prod # publish to production
```

## Custom domain (optional)
Vercel project → Settings → Domains → add `yourname.com` and follow the DNS steps.

## Updating later
Re-export the site, replace these files, and push (Option A) or run `vercel --prod` (Option B).
