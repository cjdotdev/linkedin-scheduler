# Writing posts

One post = one Markdown file in `posts/texts/`. Name it after its day, e.g. `2026-12-01-launch.md`: the
file name (without `.md`) is the post's id. Files starting with `_` are templates and are never synced.

```markdown
---
date: 2026-12-01
time: 09:00
status: ready
visibility: PUBLIC
media: images/launch.png
first_comment: The docs: https://example.com
---
**The hook, in bold.**

The text of the post.

#typescript #backend
```

## Header fields

| Field | Required | Meaning |
|---|---|---|
| `date` | yes | The day it goes out, `YYYY-MM-DD`, in the timezone of `scheduler.json`. |
| `time` | no | `HH:MM`, `defaultTime` of `scheduler.json` otherwise (`09:00`). |
| `status` | yes | `draft` (kept out of the queue) or `ready` (scheduled). |
| `media` | no | One image (`png`, `jpg`, `gif`) or one `mp4` video, relative to `posts/` (e.g. `images/x.png`), or an `https://` URL. |
| `visibility` | no | `PUBLIC` (default) or `CONNECTIONS`. |
| `first_comment` | no | Posted as your first comment, right after the post. |

A comment after a value (`  # like this`, with spaces around `#`) is allowed in the header. Hashtags and
URLs with `#` are kept.

## The text

- **Bold:** LinkedIn has no markup. Write `**words**` and they are sent in Unicode bold (accented letters
  included). Keep it for the hook: screen readers read these characters poorly.
- **Links:** LinkedIn shows posts with external links to fewer people. Put links in `first_comment`.
- **Length:** at most 3,000 characters.
- **Video:** `mp4`, up to 25 MB in KV, up to 200 MB with the optional R2 bucket.

## Timezone

`scheduler.json`:

```json
{ "timezone": "Europe/Paris", "defaultTime": "09:00" }
```

Times in posts are in that timezone; the database stores them in UTC, so daylight saving changes are
handled.

## Before you push

The push checks every post before writing anything: one wrong file (bad date, missing image) stops the
whole sync with the list of errors, and nothing changes. To see exactly what a push would do:

```bash
pnpm exec wrangler login        # once
node scripts/sync.mjs --remote --dry-run
```

## Changing or deleting a post

- **Not yet published:** edit the file and push. Any change (text, time, status) re-arms the post, with
  its tries reset. Delete the file and push: the post is cancelled.
- **Already published:** the scheduler never touches it again. Edit or delete it on LinkedIn.
