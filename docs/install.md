# Install

Everything runs on **your** Cloudflare account and **your** GitHub account. Before you start, get your
LinkedIn token ([linkedin-setup.md](linkedin-setup.md)): every way of installing asks for it.

## 1. The Deploy to Cloudflare button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cjdotdev/linkedin-scheduler)

1. **Git account:** connect GitHub (or GitLab) the first time. GitHub asks you to authorize Cloudflare's
   app; you can limit it to the repositories you choose.
2. **Tick "Create private Git repository".** Your copy will hold your posts, drafts included. It is
   unchecked by default.
3. Name the project, the D1 database and the KV namespace. **Use names that no Worker, database or
   namespace on your account already has**: Cloudflare reuses an existing database with the same name
   instead of creating a new one.
4. Fill in the secrets: `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_TOKEN_EXPIRES` (`YYYY-MM-DD`),
   `ADMIN_TOKEN` (a long random string, keep a copy), `DRY_RUN` (`1` for a first test, `0` to post).
   `DRY_RUN` is written into your copy's `wrangler.jsonc`: to change it later, edit it there and push.
5. **Deploy.** Cloudflare creates the database and the namespace, writes their ids into your copy's
   `wrangler.jsonc`, and runs `pnpm run deploy`.

From then on, **every push to your copy's main branch deploys and syncs your posts** (Workers Builds).
Your Worker's URL is printed near the end of the build log (`https://<name>.<subdomain>.workers.dev`);
the build log is in the dashboard → your Worker → **Deployments**.

Next: set your timezone in `scheduler.json` (`"timezone": "Europe/Paris"`, an IANA name; `UTC` by
default), write a post, push.

## 2. A coding agent

Clone your copy (or this repository), open Claude Code, Cursor or any coding agent at its root, and paste
[AGENT_INSTALL.md](AGENT_INSTALL.md). The agent creates the resources with your Cloudflare login,
deploys, and walks you through the LinkedIn steps. It never asks you to paste the token in the chat.

## 3. By hand

```bash
# Your own private copy first: "Use this template" on GitHub -> Private, then clone it.
pnpm install
pnpm run setup
```

`setup` signs you in to Cloudflare, creates the D1 database and the KV namespace, writes their ids into
`wrangler.jsonc`, asks your timezone, deploys, then asks for the three secrets (Wrangler reads each
value from your keyboard; nothing is written to disk). Commit `wrangler.jsonc` and `scheduler.json`:
the ids are not secret.

### Deploy on every push

After an install by hand or by an agent, connect the repository once so pushes deploy:
Cloudflare dashboard → **Workers & Pages** → your Worker → **Settings** → **Build** → **Connect** →
your repository, branch `main`, deploy command `pnpm run deploy`.

Prefer GitHub Actions? Create a Cloudflare API token (Workers Scripts Edit, D1 Edit, Workers KV Storage
Edit), add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to the repository's secrets, and add this
workflow as `.github/workflows/deploy.yml`. Use one or the other, not both.

```yaml
name: Deploy
on:
  push:
    branches: [main]
concurrency: deploy
jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm run deploy
```

## Changing a secret

Cloudflare dashboard → your Worker → **Settings** → **Variables and Secrets**, or
`pnpm exec wrangler secret put LINKEDIN_ACCESS_TOKEN`. Renewing the LinkedIn token every 60 days is
exactly that ([linkedin-setup.md](linkedin-setup.md#renew-the-token)).

## Videos over 25 MB

Media up to 25 MB go to Workers KV, which is part of the free plan. For bigger videos (LinkedIn accepts up
to 200 MB), use R2. Cloudflare asks for a payment method before you can use R2, even inside its free tier.

1. Create a bucket: `pnpm exec wrangler r2 bucket create linkedin-scheduler-media`.
2. In `wrangler.jsonc`, uncomment the `r2_buckets` line (binding `MEDIA_R2`, your bucket's name).
3. Push. Files over 25 MB now go to R2; smaller ones stay in KV.

Without R2, a file over 25 MB stops the sync with a clear message, and nothing else is changed.

## Check that it works

```bash
curl https://<your-worker>.workers.dev/                                    # {"ok":true,...}
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<your-worker>.workers.dev/status
```

For a first real test: a post a few minutes ahead, `visibility: CONNECTIONS`, `DRY_RUN` set to `0`.
