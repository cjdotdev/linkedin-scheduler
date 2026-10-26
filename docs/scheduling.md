# Scheduling

Publishing is one command, run by cron: `scripts/run.sh` calls `scripts/publish.py` and appends
everything to `logs/publish.log`.

```
# crontab -e — Monday, Wednesday and Friday, 5 tries from 9:00, 13:00 and 18:00
0,2,4,6,8 9,13,18 * * 1,3,5 /path/to/linkedin-scheduler/scripts/run.sh
```

Use any days and hours you like; three slots a day let up to three posts go out and catch a missed one.

## Five tries per slot

Each slot is tried 5 times, two minutes apart (9:00, 9:02, 9:04, 9:06, 9:08), then nothing until the
next slot. A try that failed for a certain reason (network down, LinkedIn refused) is retried two
minutes later instead of hours later; a machine that wakes up at 9:03 still posts at 9:04.

Every try starts with `publish.py --due`, a quiet check that sends and logs nothing: a try with nothing
due (already published, or its time has not come) leaves no trace in `logs/publish.log`. Since a run
publishes at most one post and a published post leaves `posts/texts/`, the other tries cannot post it
again. Want one try per slot? Use `0 9,13,18 * * 1,3,5`.

## What a run does

1. Takes the posts dated **today**, `status: ready`, whose `time` (default `09:00`) has come.
2. Publishes the **earliest** one, and only one: posts of a busy day stay spaced by your runs.
3. Moves it to `posts/posted/`, records its text in `posts/ledger.json`, adds the first comment.

So:

| Situation | What happens |
|---|---|
| LinkedIn refuses at 9:00 (network, 4xx) | Retried at 9:02, up to 9:08, then at 13:00. |
| Machine off from 9:00 to 9:10 | The 9:00 post goes out at 13:00 (or 18:00). |
| Two posts at 09:00 and 13:00, machine on from 12:30 | 09:00's at 13:00, 13:00's at 18:00. |
| A post from a past day still `ready` | Never sent late; the log says `missed`: give it a new date. |
| Same text in two files | The second is refused. |
| Two runs at once | The second stops (lock). |

cron does not run jobs missed while the machine was off. If you need every slot, run it on a machine
that stays on (a small VPS or a home server with the same folder and `.env`).

## Failures

- **Certain failure** (network down before sending, media upload failed, LinkedIn refused with a 4xx):
  the post goes back to `ready` and the next try retries it (two minutes later, or at the next slot).
- **Unknown outcome** (LinkedIn answered 5xx, or the connection dropped while the post was being created):
  the post stays `publishing` and is never retried, so it cannot appear twice. Check your profile, then
  set it back to `ready` (it did not go out) or move it to `posts/posted/` (it did).
- **Failed first comment:** the post stays published; the log says to add the comment by hand.

## Testing the schedule

Preview a day without sending anything:

```bash
python3 scripts/publish.py --dry-run --date 2026-10-27
```

To test the whole chain for real, create a throwaway post dated today with `visibility: CONNECTIONS`,
add a one-off cron line a few minutes ahead (`40 15 25 10 * /path/to/scripts/run.sh`), check your
profile, then delete the post on LinkedIn and remove the line.
