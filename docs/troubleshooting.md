# Troubleshooting

Start with `GET /status` (`Authorization: Bearer <ADMIN_TOKEN>`): each post's `status` and `last_error`.
For more, the Worker's logs: Cloudflare dashboard → your Worker → **Logs**, or `pnpm exec wrangler tail`.
The sync's output is in the build logs: dashboard → your Worker → **Deployments** (Workers Builds).

| What you see | Cause | Fix |
|---|---|---|
| `LINKEDIN_ACCESS_TOKEN is not set` | The secret is missing | [linkedin-setup.md](linkedin-setup.md#3-give-it-to-the-worker) |
| `LinkedIn 401 … invalid or expired` | The token expired (60 days) or was revoked | [Renew it](linkedin-setup.md#renew-the-token) |
| `LinkedIn 403` | The app lacks **Share on LinkedIn**, or the token was made without `w_member_social` | Add the product, generate a new token with the three scopes |
| `LinkedIn 429` | Too many requests today (150 per member) | Nothing: the retries continue; tomorrow resets it |
| `media … was not found (did the sync run?)` | The image is not in KV yet | Check the build logs; push again |
| The post stays `scheduled` after its time | The cron is not running | Dashboard → your Worker → **Settings** → **Triggers**: `* * * * *` must be there |
| `missed` | Pushed after its 10-minute window | Give it a new time and push |
| `failed: the same text was already posted as …` | Duplicate guard | Change the text, or delete the copy |
| `unknown` | LinkedIn did not answer clearly after the post was sent | Check your profile. If the post is not there, rename the file (a new name is a new post), set a new time, push |
| The push did not change anything | Workers Builds is not connected, or the sync stopped on an error | Build logs; [install.md](install.md#deploy-on-every-push) |
| `Nothing was synced, fix these first` | A post file is invalid (date, time, status, media) | The message lists each file and what is wrong |
| `… is over 25 MB` | A video too big for KV | Make it smaller, or [enable R2](install.md#videos-over-25-mb) |
| `does not have linkedin-scheduler v2's tables` (build log) | The Worker is bound to a database made by something else: Cloudflare reused an existing database with the same name | Nothing was changed. Reinstall with a new database name, or point `database_id` in `wrangler.jsonc` at a new database |
| Posts show `posted` with a `dry-run` link, nothing on LinkedIn | `DRY_RUN` is `"1"` | Set `"DRY_RUN": "0"` in `wrangler.jsonc` and push (the dashboard value is overwritten by each push) |
| The first build failed right after the button | Usually a name already used on the account | Read the end of the build log; fix, then **Retry build** in the dashboard |
| Times are off by one or more hours | `scheduler.json` timezone | Set your IANA timezone (`Europe/Paris`, `America/New_York`…) and push |
| You scheduled "in 5 minutes" and it was already late | Your computer's clock is wrong; the Worker uses Cloudflare's | `curl -sI https://www.cloudflare.com \| grep -i '^date'` gives the real time (GMT) |
