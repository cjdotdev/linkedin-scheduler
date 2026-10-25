# Writing posts

One post = one Markdown file in `posts/texts/`, named `YYYY-MM-DD-<n>-<topic>.md` (`n` orders the posts
of one day). Files starting with `_` are templates and are never published.

```markdown
---
date: 2026-10-27
time: 09:00
status: draft
media: images/2026-10-27-1-my-topic.png
visibility: PUBLIC
first_comment: The docs: https://example.com
card_kicker: TypeScript
card_title: One rule, *written once*
card_body: Validate at runtime, type at compile time, document.
---
**TypeScript protects you… until the data comes from outside.**

The text of the post…

#typescript #backend
```

## Header fields

| Field | Required | Meaning |
|---|---|---|
| `date` | yes | The day it goes out (local time of the machine running cron). |
| `time` | no | Its slot, `09:00` by default. It goes out at that time or at the first run after it. |
| `status` | yes | `draft` (ignored), `ready` (will be published), then `posted` (set by the script). |
| `media` | no | One image (`png`, `jpg`, `gif`) or one `mp4` video, relative to `posts/`. |
| `visibility` | no | `PUBLIC` (default) or `CONNECTIONS`. |
| `first_comment` | no | Posted as your first comment, right after the post. |
| `card_*` | no | The image card, see [cards.md](cards.md). |

An inline comment after a value (`  # like this`) is allowed in the header.

## The text

- **Bold:** LinkedIn has no markup. Write `**words**` and the script sends them in Unicode bold
  (accented letters included). Keep it for the hook: screen readers read these characters poorly.
- **Links:** LinkedIn shows posts with external links to fewer people. Put links in `first_comment`
  and say so in the text ("The link is in the comments").
- **Length:** at most 3,000 characters; the script refuses longer posts.
- **Video:** `mp4`, 75 KB to 200 MB, 3 seconds to 10 minutes (checked with `ffprobe` when installed).

## Check before it goes out

```bash
python3 scripts/publish.py --dry-run --date 2026-10-27
```

It prints the post exactly as it will be sent (bold included), its media, visibility and first comment,
and sends nothing. When you are happy, set `status: ready`.

## After it is published

The file moves to `posts/posted/` with `status: posted`, `posted_at`, `post_id` and `url`. To change a
published post, edit or delete it on LinkedIn: the scripts never touch published posts.
