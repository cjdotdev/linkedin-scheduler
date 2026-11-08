# Agent prompt: install linkedin-scheduler on your own Cloudflare account

Paste everything below the line into any coding agent (Claude Code, Cursor, Codex…) opened at the root
of a clone of **your own private copy** of linkedin-scheduler. The agent works with your Cloudflare and
GitHub logins; you keep the LinkedIn steps and the token in your own hands.

---

You are installing **linkedin-scheduler** for the user: an open-source Cloudflare Worker that publishes
LinkedIn posts written as Markdown files, on the user's personal profile, through LinkedIn's official API.
Everything runs on the user's own Cloudflare account (Worker, D1, KV) and their own private GitHub
repository. Talk to the user in their language. Explain each step before running it, and stop to ask
whenever a choice belongs to them.

## Rules

- **The token is the user's.** Never ask them to paste the LinkedIn token or `ADMIN_TOKEN` into the chat,
  never print or write them to a file, never commit them. They type them into `wrangler secret put` or
  the Cloudflare dashboard themselves.
- **Never publish a real post** unless the user says so for that post. For tests, keep `DRY_RUN` at `1`
  or use `visibility: CONNECTIONS` with their explicit agreement.
- **Never deploy over an existing Worker** without asking: run `pnpm exec wrangler deployments list
  --name <name>` first and read the whole output. If the name is taken, choose another `name` in
  `wrangler.jsonc` with the user.
- Keep the safety rules in `src/core/scheduler.ts` as they are (atomic claim, `unknown` never retried,
  same text never twice, 10-minute window).

## 1. Learn and check the repo

Read `README.md`, `docs/install.md`, `docs/writing-posts.md` and `docs/scheduling.md`. Done when you can
say what a post file looks like, what makes a post go out, and what stops it from going out twice.

```bash
node --version          # 22 or newer
pnpm install
pnpm test && pnpm typecheck
git remote -v           # must be the user's own repository, and private
```

If the repository is public or is `cjdotdev/linkedin-scheduler` itself, stop: the user first creates a
private copy ("Use this template" → Private, or `gh repo create <name> --template
cjdotdev/linkedin-scheduler --private --clone` if `gh` is installed and signed in).

## 2. LinkedIn app and token (the user does the clicks)

Walk the user through `docs/linkedin-setup.md` steps 1 and 2, one step at a time, waiting for them:
create the app (it needs a LinkedIn Page), add **Share on LinkedIn** and **Sign In with LinkedIn using
OpenID Connect**, generate a token with `openid`, `profile`, `w_member_social`. They keep the token for
step 3; ask them to note the expiry date (today + 60 days).

## 3. Install on Cloudflare

```bash
pnpm run setup
```

It signs in to Cloudflare (a browser window opens), creates the D1 database and the KV namespace, writes
their ids into `wrangler.jsonc`, asks the timezone, deploys, then asks for the secrets: the user types
`LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_TOKEN_EXPIRES` and `ADMIN_TOKEN` themselves. Suggest
`openssl rand -hex 24` for `ADMIN_TOKEN` and tell them to keep it.

Then set `DRY_RUN` to `1` for the first test:
`pnpm exec wrangler deploy --var DRY_RUN:1` (the next normal deploy puts it back to `0`).

## 4. Deploy on every push

Commit `wrangler.jsonc` and `scheduler.json` (ids are not secrets) and push. Then the user connects the
repository once: Cloudflare dashboard → Workers & Pages → the Worker → Settings → Build → Connect →
their repository, branch `main`, deploy command `pnpm run deploy`. Open that page for them if you can,
and wait until they confirm.

## 5. A first post

Copy `posts/texts/_example.md` to `posts/texts/<today>-test.md`, set a time 3 minutes ahead (get the real
time with `curl -sI https://www.cloudflare.com | grep -i '^date'`, never the machine's clock), `status:
ready`, `visibility: CONNECTIONS`. Commit and push, wait for the build, then:

```bash
curl -H "Authorization: Bearer <ADMIN_TOKEN, typed by the user>" https://<worker>.workers.dev/status
```

With `DRY_RUN=1` it shows `posted` with a `dry-run` link. Ask the user whether to post for real; if yes,
redeploy with `DRY_RUN` at `0` (a normal push does it) and schedule a new test post with a new text.

## Done when

- `pnpm test` passes, the Worker answers `{"ok":true}` on `/`, and `/status` lists the test post.
- Pushes deploy through Workers Builds (the user saw a build succeed).
- The user knows: how to write a post (`docs/writing-posts.md`), that the token expires on the date they
  noted and how to renew it (`docs/linkedin-setup.md#renew-the-token`), and where to look when something
  fails (`docs/troubleshooting.md`).
