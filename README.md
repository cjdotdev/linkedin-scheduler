<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/lockup-on-dark.svg">
    <img src="brand/lockup.svg" height="64" alt="linkedin-scheduler">
  </picture>
</p>

# linkedin-scheduler

Write your LinkedIn posts in advance as Markdown files, push, and they go out on your personal profile at
their time, through LinkedIn's official API. It runs on **your own Cloudflare account**, on the free plan:
no server, no subscription, and nobody else ever holds your posts or your token.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cjdotdev/linkedin-scheduler)

> **Tick "Create private Git repository"** on the button's page: your copy of this repository will hold
> your posts, drafts included.

## How it works

```
git push ──► Workers Builds ──► D1 migrations ─► deploy the Worker ─► sync posts to D1, media to KV
cron * * * * * ──► Worker: earliest due post ─► LinkedIn (image or video, post, first comment) ─► D1 status
```

- **A post is a Markdown file** in `posts/texts/` with a small header: date, time, `status: ready`,
  optional image or video, optional first comment.
- **Every push** deploys the Worker and syncs your posts to a D1 database and your media to KV, on your
  account. Only what changed is sent.
- **Every minute**, the Worker publishes the earliest post whose time has come. A failed try is retried
  every minute for 10 minutes (9:00 … 9:10), then marked `failed` with the reason.
- **Never twice.** A post is claimed atomically before it is sent; an unclear answer from LinkedIn is
  marked `unknown` and never retried; the same text is never posted twice; a posted post is never
  touched again by a sync.
- **Your data stays yours.** The repository, the database, the media, the token and the LinkedIn app are
  all on your accounts.

## What you need

- A **Cloudflare** account (free plan) and a **GitHub** account.
- A **LinkedIn app** with *Share on LinkedIn*, and an access token: [docs/linkedin-setup.md](docs/linkedin-setup.md).
  It takes about 5 minutes; the token lasts 60 days.

## Install

Three ways, same result ([docs/install.md](docs/install.md)):

1. **The button above.** Cloudflare copies this repository into your GitHub, creates the database and the
   media store, asks for your LinkedIn token, and deploys. Every later push redeploys.
2. **A coding agent.** Paste [docs/AGENT_INSTALL.md](docs/AGENT_INSTALL.md) into Claude Code, Cursor or
   any agent opened in a clone of your copy.
3. **By hand.** `pnpm install && pnpm run setup`.

Then set your timezone in `scheduler.json`, write a post ([docs/writing-posts.md](docs/writing-posts.md)),
push, and check `GET /status`.

## A post

```markdown
---
date: 2026-12-01
time: 09:00
status: ready
visibility: PUBLIC
media: images/launch.png
first_comment: The link: https://example.com
---
**The hook, in bold.**

The rest of the post.
```

## Media

| Media | Where it goes | Card needed |
|---|---|---|
| Images and videos up to 25 MB, in `posts/images/` or `posts/videos/` | Workers KV | no |
| A file already online | `media: https://...` | no |
| Videos over 25 MB (LinkedIn accepts up to 200 MB) | R2, optional ([install.md](docs/install.md#videos-over-25-mb)) | yes |

## Routes

- `GET /`: health.
- `GET /status`: the queue, the history and the token's expiry (`Authorization: Bearer <ADMIN_TOKEN>`).
- `POST /check`: run the minute check now (same header).

## Limits

- **The LinkedIn token lasts 60 days** and cannot be refreshed automatically outside LinkedIn's partner
  programs. `/status` warns 7 days before `LINKEDIN_TOKEN_EXPIRES`.
- **Personal profile only.** Company pages need a LinkedIn partner permission.
- **To the minute**, and at most one post per minute.

## Docs

| File | What |
|---|---|
| [docs/install.md](docs/install.md) | The three ways to install, deploying on every push, R2 for big videos |
| [docs/linkedin-setup.md](docs/linkedin-setup.md) | LinkedIn app, token, renewing it |
| [docs/writing-posts.md](docs/writing-posts.md) | The post format |
| [docs/scheduling.md](docs/scheduling.md) | When posts go out, retries, statuses, the history |
| [docs/troubleshooting.md](docs/troubleshooting.md) | What went wrong and how to fix it |
| [docs/AGENT_INSTALL.md](docs/AGENT_INSTALL.md) | The prompt for a coding agent |

## Development

```bash
pnpm install
cp .dev.vars.example .dev.vars          # add DRY_RUN=1: never posts for real
pnpm db:migrate:local && pnpm sync:local
pnpm dev                                # then: curl "localhost:8787/__scheduled?cron=*+*+*+*+*"
pnpm test && pnpm typecheck
```

`src/core/` holds everything that does not depend on Cloudflare (posts, scheduling rules, LinkedIn);
`src/cloudflare/` is the Worker (Hono routes, cron, D1, KV/R2). `scripts/` has the sync, the deploy
script and the setup.

## v1

The first version (Python, run by cron on your own machine, with image cards) is on the
[`v1` branch](https://github.com/cjdotdev/linkedin-scheduler/tree/v1) and the `v1.0.0` tag.

## License

MIT, see [LICENSE](LICENSE).
