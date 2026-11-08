import { describe, expect, it } from "vitest";
import { PermanentError, RetryableError, UnknownOutcomeError } from "../src/core/linkedin";
import { tick } from "../src/core/scheduler";
import type { PostRow } from "../src/core/types";
import { memoryDb } from "./sqlite";

const NINE = Date.UTC(2026, 10, 10, 9, 0);
const MIN = 60_000;

function setup(posts: Array<Partial<{ slug: string; scheduled_at: number; status: string; text_hash: string }>>) {
  const db = memoryDb();
  for (const [i, p] of posts.entries()) {
    db.raw
      .prepare(
        `INSERT INTO posts (slug, body, scheduled_at, local_time, status, content_hash, text_hash, updated_at)
         VALUES (?, 'Hello', ?, '', ?, 'c', ?, 0)`,
      )
      .run(p.slug ?? `p${i}`, p.scheduled_at ?? NINE, p.status ?? "scheduled", p.text_hash ?? `t${i}`);
  }
  const row = (slug: string) => db.raw.prepare("SELECT * FROM posts WHERE slug = ?").get(slug) as Record<string, unknown>;
  return { db, row };
}

const ok = async () => "urn:li:share:1";
const quiet = { log: () => {} };

describe("tick", () => {
  it("does nothing before the post's time", async () => {
    const { db, row } = setup([{ slug: "a" }]);
    expect((await tick({ db, publish: ok, ...quiet }, NINE - MIN)).action).toBe("idle");
    expect(row("a").status).toBe("scheduled");
  });

  it("publishes a due post and records its link", async () => {
    const { db, row } = setup([{ slug: "a" }]);
    const result = await tick({ db, publish: ok, ...quiet }, NINE);
    expect(result).toMatchObject({ action: "posted", slug: "a" });
    expect(row("a")).toMatchObject({ status: "posted", attempts: 1, post_url: "https://www.linkedin.com/feed/update/urn:li:share:1/" });
  });

  it("publishes at most one post per run, the earliest first", async () => {
    const { db, row } = setup([{ slug: "late", scheduled_at: NINE + MIN }, { slug: "early" }]);
    await tick({ db, publish: ok, ...quiet }, NINE + MIN);
    expect(row("early").status).toBe("posted");
    expect(row("late").status).toBe("scheduled");
  });

  it("retries every minute after a retryable failure, then fails at +10 minutes", async () => {
    const { db, row } = setup([{ slug: "a" }]);
    const failing = async () => {
      throw new RetryableError("LinkedIn 429");
    };
    await tick({ db, publish: failing, ...quiet }, NINE);
    expect(row("a")).toMatchObject({ status: "retrying", attempts: 1, last_error: "LinkedIn 429" });
    // A second check within the same minute does not burn a try.
    expect((await tick({ db, publish: failing, ...quiet }, NINE + 10_000)).action).toBe("idle");
    for (let m = 1; m <= 10; m++) await tick({ db, publish: failing, ...quiet }, NINE + m * MIN);
    expect(row("a")).toMatchObject({ status: "failed", attempts: 11 });
  });

  it("goes out on a retry once LinkedIn accepts it", async () => {
    const { db, row } = setup([{ slug: "a" }]);
    await tick({ db, publish: async () => Promise.reject(new RetryableError("network")), ...quiet }, NINE);
    await tick({ db, publish: ok, ...quiet }, NINE + MIN);
    expect(row("a")).toMatchObject({ status: "posted", attempts: 2, last_error: null });
  });

  it("never retries an unknown outcome", async () => {
    const { db, row } = setup([{ slug: "a" }]);
    let calls = 0;
    const unclear = async () => {
      calls++;
      throw new UnknownOutcomeError("LinkedIn 502");
    };
    await tick({ db, publish: unclear, ...quiet }, NINE);
    await tick({ db, publish: unclear, ...quiet }, NINE + MIN);
    expect(calls).toBe(1);
    expect(row("a").status).toBe("unknown");
  });

  it("fails at once on a permanent error", async () => {
    const { db, row } = setup([{ slug: "a" }]);
    await tick({ db, publish: async () => Promise.reject(new PermanentError("3100 characters")), ...quiet }, NINE);
    expect(row("a")).toMatchObject({ status: "failed", last_error: "3100 characters" });
  });

  it("marks a post never tried in its window as missed", async () => {
    const { db, row } = setup([{ slug: "a" }]);
    expect((await tick({ db, publish: ok, ...quiet }, NINE + 12 * MIN)).expired).toBe(1);
    expect(row("a").status).toBe("missed");
  });

  it("still tries a post pushed late but inside its window", async () => {
    const { db, row } = setup([{ slug: "a" }]);
    await tick({ db, publish: ok, ...quiet }, NINE + 7 * MIN);
    expect(row("a").status).toBe("posted");
  });

  it("refuses a text that was already posted", async () => {
    const { db, row } = setup([
      { slug: "old", status: "posted", text_hash: "same" },
      { slug: "new", text_hash: "same" },
    ]);
    let calls = 0;
    await tick({ db, publish: async () => (calls++, "urn"), ...quiet }, NINE);
    expect(calls).toBe(0);
    expect(row("new")).toMatchObject({ status: "failed", last_error: "the same text was already posted as old" });
  });

  it("lets only one of two overlapping runs publish", async () => {
    const { db, row } = setup([{ slug: "a" }]);
    let calls = 0;
    const slow = async (_: PostRow) => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return "urn";
    };
    await Promise.all([tick({ db, publish: slow, ...quiet }, NINE), tick({ db, publish: slow, ...quiet }, NINE)]);
    expect(calls).toBe(1);
    expect(row("a").status).toBe("posted");
  });
});
