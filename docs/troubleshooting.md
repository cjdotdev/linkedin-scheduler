# Troubleshooting

Everything a run does is in `logs/publish.log`.

| Message | Cause | Fix |
|---|---|---|
| `LINKEDIN_ACCESS_TOKEN is missing in .env` | No `.env`, or the key is empty | [linkedin-setup.md](linkedin-setup.md) |
| `LinkedIn answered 401 … invalid or expired` | The token expired (about 60 days) or was revoked | Generate a new token, update `.env` |
| `LinkedIn answered 403` | The app lacks **Share on LinkedIn**, or the token was made without `w_member_social` | Add the product, generate the token again with the three scopes |
| `nothing ready for <day>` | No post dated that day with `status: ready` | Check the date and status; `--dry-run --date` lists that day's posts |
| `… yet (later today: x.md at 13:00)` | Its time has not come | Normal: a later run publishes it |
| `missed: … was never sent` | A `ready` post from a past day | Give it a new date |
| `refused …: the same text was already published` | Duplicate guard | Change the text, or delete the copy |
| `… still 'publishing' …` | A run stopped while posting | Check LinkedIn, then set `ready` or move it to `posts/posted/` |
| `media upload failed, back to ready` | Network or LinkedIn problem before the post existed | Nothing to do: the next run retries |
| `too much content: the card overflows` | The card's text or code does not fit | Shorten it |
| `chromium.launch` … `not found` | Playwright does not find Chrome | Install Google Chrome, or set `[browser] chrome` in `config.toml` |
| Nothing happens at the scheduled time | cron not installed, machine off, or wrong path | `crontab -l`; the path must be absolute; `systemctl status cron` (or `crond`) |

The card renderer and the publisher are independent: cards are made in advance on your machine, and
publishing needs only Python (no Node, no browser) when cron runs.
