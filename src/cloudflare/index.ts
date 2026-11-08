import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { createLinkedIn } from "../core/linkedin";
import { tick } from "../core/scheduler";
import type { PostRow } from "../core/types";
import { cloudflareMedia } from "./media";

type Secrets = { LINKEDIN_ACCESS_TOKEN?: string; LINKEDIN_TOKEN_EXPIRES?: string; LINKEDIN_PERSON_URN?: string; ADMIN_TOKEN?: string };
// DRY_RUN is typed as its default ("0") by `wrangler types`; it may be "1".
type AppEnv = Omit<Env, "DRY_RUN"> & Secrets & { DRY_RUN: string };

/** One minute check with this Worker's bindings and secrets. */
function run(env: AppEnv, now: number) {
  const media = cloudflareMedia(env);
  const linkedin = createLinkedIn({ token: env.LINKEDIN_ACCESS_TOKEN ?? "", personUrn: env.LINKEDIN_PERSON_URN });
  const publish =
    env.DRY_RUN === "1"
      ? async (post: PostRow) => {
          console.log(`[dry-run] would post ${post.slug} (${post.body.length} chars, media: ${post.media ?? "none"})`);
          return `urn:li:share:dry-run-${post.slug}`;
        }
      : (post: PostRow) => linkedin.publish(post, media);
  return tick({ db: env.DB, publish }, now);
}

const app = new Hono<{ Bindings: AppEnv }>();

app.get("/", (c) => c.json({ ok: true, service: "linkedin-scheduler" }));

// Everything else needs: Authorization: Bearer <ADMIN_TOKEN>
const admin = bearerAuth({
  verifyToken: (token, c) => {
    const expected = (c.env as AppEnv).ADMIN_TOKEN;
    return !!expected && token === expected;
  },
});

/** The queue and the history: what is coming, what went out, what failed and why. */
app.get("/status", admin, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT slug, status, local_time, attempts, last_error, post_url, media FROM posts
     ORDER BY scheduled_at DESC LIMIT 100`,
  ).all();
  const expires = c.env.LINKEDIN_TOKEN_EXPIRES;
  const daysLeft = expires ? Math.floor((Date.parse(expires) - Date.now()) / 86_400_000) : null;
  return c.json({
    token: expires ? { expires, daysLeft, warning: daysLeft !== null && daysLeft <= 7 } : "LINKEDIN_TOKEN_EXPIRES is not set",
    dryRun: c.env.DRY_RUN === "1",
    posts: results,
  });
});

/** The same check the cron runs every minute, on demand. */
app.post("/check", admin, async (c) => c.json(await run(c.env, Date.now())));

export default {
  fetch: app.fetch,
  // Awaited, not waitUntil: a video upload can take minutes, and a cron run may last up to 15.
  async scheduled(event, env) {
    const result = await run(env, event.scheduledTime);
    if (result.action !== "idle") console.log(JSON.stringify(result));
  },
} satisfies ExportedHandler<AppEnv>;
