# When posts go out

## Every minute

A Cron Trigger (`* * * * *`) wakes the Worker. It takes the **earliest** post that is `scheduled` (or
`retrying`) and whose time has come, and publishes it. At most one post per minute: two posts in the same
slot go out a minute apart.

## Retries

A post due at 9:00 is tried at 9:00. If the try fails before the post exists (network, image upload,
LinkedIn refusing with a `4xx`), it is tried again every minute, **up to 9:10**. Still failing at 9:10, it
becomes `failed`, and `last_error` says why.

A post pushed late but inside its window (at 9:04 for 9:00) goes out at the next minute. A post pushed
after its window is `missed`: give it a new time.

## Never twice

- **The claim:** before sending, the Worker switches the post to `publishing` with a single `UPDATE` that
  only succeeds if nobody else did. Two overlapping runs cannot both send it.
- **Unclear answers are not retried:** if LinkedIn answers `5xx` or the connection drops after the post
  request was sent, the post may be out. It is marked `unknown` and never retried: check your profile.
- **Same text, once:** a text identical to an already posted one (spaces aside) is refused.
- **Posted is final:** a push never changes a post that is `posted`, `publishing` or `unknown`.

## Statuses

| Status | Meaning |
|---|---|
| `draft` | In D1, not scheduled (`status: draft` in the file) |
| `scheduled` | Waiting for its time |
| `publishing` | A run is sending it right now |
| `retrying` | A try failed; the next one is in a minute (`last_error`) |
| `posted` | Out; `post_url` is the link |
| `failed` | Still failing after 10 minutes, or cannot work (too long, same text already posted) |
| `missed` | Its time passed before any try: give it a new date |
| `unknown` | LinkedIn did not answer clearly after the post was sent: check your profile |
| `cancelled` | Its file was deleted before it went out |

## The history

D1 is the history: every post, its status, its tries, its last error and its link. See it with
`GET /status`, or:

```bash
pnpm exec wrangler d1 execute DB --remote --command \
  "SELECT slug, status, local_time, attempts, last_error, post_url FROM posts ORDER BY scheduled_at DESC"
```

Each push compares every file with its row (a hash of everything the file says): new files are inserted,
edited ones re-armed, unchanged ones left alone. Media work the same way: only files whose content
changed are uploaded.

## Testing without posting

`DRY_RUN` lives in `wrangler.jsonc`, under `vars` (the Deploy button writes your answer there). Set it to
`"1"` and push: the Worker logs what it would post and marks it `posted` with a fake link, without calling
LinkedIn. Set it back to `"0"` and push to post for real. Changing it in the dashboard does not last: the
next push deploys the value from `wrangler.jsonc` again.
