import { PermanentError, RetryableError, UnknownOutcomeError } from "./linkedin";
import type { PostRow, Sql } from "./types";

const MINUTE = 60_000;
/** A post is tried at its time, then every minute up to 10 minutes later (9:00 … 9:10). */
export const RETRY_WINDOW = 10 * MINUTE;
/** The 9:10 tick may fire a few seconds late: it still counts. */
const GRACE = MINUTE - 1;
/** A manual /check right after a cron run does not burn a retry. */
const MIN_GAP = 50_000;

type Due = PostRow & { scheduled_at: number; attempts: number; text_hash: string };

export type TickResult =
  | { action: "idle"; expired: number }
  | { action: "posted"; slug: string; url: string; expired: number }
  | { action: "retrying" | "failed" | "unknown"; slug: string; error: string; expired: number };

export interface TickDeps {
  db: Sql;
  /** Publishes a post and returns its URN, throwing RetryableError / PermanentError / UnknownOutcomeError. */
  publish: (post: PostRow) => Promise<string>;
  log?: (message: string) => void;
}

/** One check: what runs every minute. Publishes at most one post. */
export async function tick({ db, publish, log = console.log }: TickDeps, now: number): Promise<TickResult> {
  const deadline = now - RETRY_WINDOW - GRACE;

  // Past their window: a post never tried is "missed", one that kept failing is "failed".
  const expired = await db.batch([
    db
      .prepare(
        `UPDATE posts SET status = 'missed', last_error = 'its time passed before any try', updated_at = ?1
         WHERE status = 'scheduled' AND scheduled_at < ?2`,
      )
      .bind(now, deadline),
    db
      .prepare(`UPDATE posts SET status = 'failed', updated_at = ?1 WHERE status = 'retrying' AND scheduled_at < ?2`)
      .bind(now, deadline),
  ]);
  const expiredCount = expired.reduce((n, r) => n + (r.meta.changes ?? 0), 0);

  const post = await db
    .prepare(
      `SELECT slug, body, visibility, media, first_comment, scheduled_at, attempts, text_hash FROM posts
       WHERE status IN ('scheduled', 'retrying') AND scheduled_at <= ?1 AND scheduled_at >= ?2
         AND (last_attempt_at IS NULL OR last_attempt_at <= ?3)
       ORDER BY scheduled_at, slug LIMIT 1`,
    )
    .bind(now, deadline, now - MIN_GAP)
    .first<Due>();
  if (!post) return { action: "idle", expired: expiredCount };

  // Claim it atomically: if another run (a slow video from the previous minute) got it first, stop.
  const claim = await db
    .prepare(
      `UPDATE posts SET status = 'publishing', attempts = attempts + 1, last_attempt_at = ?1, updated_at = ?1
       WHERE slug = ?2 AND status IN ('scheduled', 'retrying')`,
    )
    .bind(now, post.slug)
    .run();
  if (claim.meta.changes !== 1) return { action: "idle", expired: expiredCount };

  const twin = await db
    .prepare(`SELECT slug FROM posts WHERE text_hash = ?1 AND status = 'posted' AND slug <> ?2`)
    .bind(post.text_hash, post.slug)
    .first<{ slug: string }>();
  if (twin) return fail(db, post.slug, "failed", `the same text was already posted as ${twin.slug}`, now, expiredCount);

  try {
    const urn = await publish(post);
    const url = `https://www.linkedin.com/feed/update/${urn}/`;
    await db
      .prepare(
        `UPDATE posts SET status = 'posted', post_urn = ?1, post_url = ?2, posted_at = ?3, last_error = NULL, updated_at = ?3
         WHERE slug = ?4`,
      )
      .bind(urn, url, now, post.slug)
      .run();
    log(`posted ${post.slug} -> ${url} (try ${post.attempts + 1})`);
    return { action: "posted", slug: post.slug, url, expired: expiredCount };
  } catch (e) {
    const message = (e as Error).message;
    if (e instanceof UnknownOutcomeError) {
      return fail(db, post.slug, "unknown", `unclear if it went out, check LinkedIn: ${message}`, now, expiredCount);
    }
    if (e instanceof PermanentError) return fail(db, post.slug, "failed", message, now, expiredCount);
    const lastChance = now >= post.scheduled_at + RETRY_WINDOW;
    const reason = e instanceof RetryableError ? message : `unexpected: ${message}`;
    return fail(db, post.slug, lastChance ? "failed" : "retrying", reason, now, expiredCount);
  }
}

async function fail(
  db: Sql,
  slug: string,
  status: "retrying" | "failed" | "unknown",
  error: string,
  now: number,
  expired: number,
): Promise<TickResult> {
  await db
    .prepare(`UPDATE posts SET status = ?1, last_error = ?2, updated_at = ?3 WHERE slug = ?4`)
    .bind(status, error.slice(0, 1000), now, slug)
    .run();
  console.error(`${slug}: ${status}: ${error}`);
  return { action: status, slug, error, expired };
}
