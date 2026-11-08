# AGENTS.md

Notes for anyone (human or agent) changing linkedin-scheduler's code. To install it, see
`docs/AGENT_INSTALL.md` instead.

## Layout

| Path | What |
|---|---|
| `src/core/` | Platform-free: `scheduler.ts` (the minute check), `linkedin.ts` (API calls, error kinds), `text.ts` (Unicode bold, length), `types.ts` (what a runtime must provide: SQL with D1's shape, a media source) |
| `src/cloudflare/` | The Worker: `index.ts` (Hono routes, cron, secrets), `media.ts` (URL → KV → optional R2) |
| `migrations/` | D1 schema. Never edit an applied migration: add `000N_*.sql` |
| `scripts/sync.mjs`, `scripts/lib/posts.mjs` | Repo → KV/R2 and D1. `lib/posts.mjs` is pure and tested |
| `scripts/deploy.sh` | `pnpm run deploy`: migrations, deploy, sync. Workers Builds runs it on every push of a copy |
| `scripts/setup.mjs` | `pnpm run setup`: install by hand |
| `wrangler.jsonc`, `.dev.vars.example`, `package.json` → `cloudflare` | Read by the Deploy to Cloudflare button. Keep placeholder ids here: the button replaces them in each copy |
| `test/` | Vitest; the scheduler's SQL runs on in-memory SQLite (`test/sqlite.ts`) |

## Rules that must hold

- **Never post twice:** the claim is one `UPDATE … WHERE status IN ('scheduled','retrying')`; an error
  after the post request was sent is `UnknownOutcomeError` and is never retried; the sync never touches
  `posted`, `publishing` or `unknown` rows; the same `text_hash` is never posted twice. Each has a test.
- **Users' data stays on their accounts.** No telemetry, no call to any server but LinkedIn's (and media
  URLs the user wrote).
- Binding names (`DB`, `MEDIA`, `MEDIA_R2`) are the contract with the scripts; resource names are the
  user's choice.

## Commands

```bash
pnpm test && pnpm typecheck
pnpm types                      # after changing wrangler.jsonc
cp .dev.vars.example .dev.vars  # add DRY_RUN=1
pnpm db:migrate:local && pnpm sync:local && pnpm dev
curl "localhost:8787/__scheduled?cron=*+*+*+*+*"
```

Commits: conventional (`feat:`, `fix:`, `docs:`…).
