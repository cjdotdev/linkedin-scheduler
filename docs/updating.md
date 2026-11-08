# Updating

Your copy of the repository is yours: new versions of linkedin-scheduler never reach it on their own.
Updating means merging the new version into your copy and pushing; Workers Builds then redeploys.

Read the [release notes](https://github.com/cjdotdev/linkedin-scheduler/releases) first: they say when a
version changes `wrangler.jsonc` or the database.

## Update

From a clone of your copy:

```bash
git remote add upstream https://github.com/cjdotdev/linkedin-scheduler.git   # once
git fetch upstream
git merge --allow-unrelated-histories -X theirs upstream/main
git checkout ORIG_HEAD -- wrangler.jsonc scheduler.json                      # keep your configuration
git commit -m "Update linkedin-scheduler, keep my configuration"
pnpm install
git push
```

- `--allow-unrelated-histories` is needed because the Deploy button creates your copy as a fresh
  repository. It is harmless on later updates.
- `-X theirs` takes the new version of the files that both sides changed; the `git checkout ORIG_HEAD`
  line then puts back **your** `wrangler.jsonc` (Worker name, database and KV ids, `DRY_RUN`) and
  `scheduler.json` (timezone). Your posts and media are never touched: the project only ships
  `posts/texts/_example.md`.
- If a release adds something to `wrangler.jsonc` (a new binding, say), its notes say what: copy that part
  into yours by hand before pushing.
- Database changes are migrations in `migrations/`: the push applies them before deploying.

## Check

After the push, the build log (dashboard → your Worker → **Deployments**) shows the migrations, the deploy
and the sync. `GET /status` must still list your posts.

## Roll back

`git revert` the merge commit and push: the previous code is deployed again. Migrations are not undone;
releases only add columns or tables, so older code keeps working with a newer database.
