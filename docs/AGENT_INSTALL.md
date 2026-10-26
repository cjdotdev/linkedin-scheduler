# Agent prompt: set up linkedin-scheduler on your machine

Paste everything below the line into any coding agent opened at the root of
a linkedin-scheduler clone. The agent works on your machine; you keep the LinkedIn steps and the token
in your own hands.

---

You are setting up **linkedin-scheduler** for the user: an open-source tool that publishes LinkedIn posts
written as Markdown files, on the user's personal profile, through LinkedIn's official API, run by cron.
It also renders 1080×1350 image cards for the posts. Your job: check the repo, configure it, guide the
user through the LinkedIn app and token, prepare a first post and schedule publishing. Talk to the user in
their language. Explain each step before running it, and stop to ask whenever a choice belongs to them.

## Rules

- **The token is the user's.** Never ask them to paste the LinkedIn token into the chat, never print
  `.env`, never commit it. They put it in `.env` themselves.
- **Never publish a real post** unless the user explicitly says so for that post. Use `--dry-run`.
- Keep the safety guards in `scripts/publish.py` as they are (today only, `ready` only, the ledger, the
  `publishing` marker, the lock).

## 1. Learn and check the repo

Read `README.md`, then `docs/writing-posts.md`, `docs/cards.md` and `docs/scheduling.md`. Done when you
can say what a post file looks like, what makes a post go out and what stops it from going out twice.

```bash
python3 --version                       # 3.11 or newer
python3 -m unittest discover tests      # all green, or stop and report
npm install                             # only needed for image cards (uses the installed Chrome)
```

## 2. Personalise the cards

Ask the user for their name and role, and whether they want their own colours. Edit `config.toml`
(`[card] signature = "Name - role"`, colours, optional `mark`). If Google Chrome is not installed, find
Chromium's path and set `[browser] chrome`. Render the example to check:

```bash
python3 scripts/render_card.py posts/texts/_example.md
```

Show the user `posts/images/_example.png`, then delete it and remove the `media:` line the command added
to `_example.md`.

## 3. LinkedIn app and token (the user does the clicks)

Walk the user through `docs/linkedin-setup.md`, one step at a time, waiting for them at each step:

1. Create the app at https://www.linkedin.com/developers/apps (name, square logo, a LinkedIn Page).
2. Products tab: add **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**.
3. Token generator: scopes `openid`, `profile`, `w_member_social`.
4. They run `cp .env.example .env` and fill in `LINKEDIN_ACCESS_TOKEN` and `LINKEDIN_TOKEN_EXPIRES`
   (about 60 days from today, `YYYY-MM-DD`) themselves.

Then check, which publishes nothing:

```bash
python3 scripts/publish.py --check
```

Expected: `Token OK: <their name>`. Ask the user to copy the printed `LINKEDIN_PERSON_URN=` line into
`.env`. On `401`/`403`, see `docs/troubleshooting.md`.

## 4. A first post

With the user, write their first post in `posts/texts/YYYY-MM-DD-1-<topic>.md` (copy `_example.md`),
`status: draft`. Render its card if they want one, show it, and preview it:

```bash
python3 scripts/publish.py --dry-run --date YYYY-MM-DD
```

Only when they are happy, set `status: ready`.

## 5. Schedule

Ask which days and times they want posts to go out (default: Monday, Wednesday and Friday at 9:00,
13:00 and 18:00, each slot tried 5 times two minutes apart, see docs/scheduling.md). Show the cron line with the absolute path of this clone, and install it only after
they agree:

```bash
( crontab -l 2>/dev/null; echo "0,2,4,6,8 9,13,18 * * 1,3,5 $(pwd)/scripts/run.sh" ) | crontab -
crontab -l
```

Tell them: their machine must be on at those times (or run the clone on an always-on box), every run is
logged in `logs/publish.log`, and the token must be renewed about every 60 days (the log warns a week
before).

## 6. Report

Summarise in a few lines: what is configured, where their posts go, when the next post goes out, and how
to renew the token.
