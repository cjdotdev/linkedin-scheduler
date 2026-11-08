import { describe, expect, it } from "vitest";
import { parsePost, postsSql, toRow, zonedToUtc } from "../scripts/lib/posts.mjs";
import { memoryDb } from "./sqlite";

const config = { timezone: "Europe/Paris", defaultTime: "09:00" };
const file = (header, body = "Hello **world**") => `---\n${header}\n---\n${body}\n`;
const exists = () => true;

describe("zonedToUtc", () => {
  it("converts a local time to UTC", () => {
    expect(new Date(zonedToUtc("2026-11-10", "09:00", "Europe/Paris")).toISOString()).toBe("2026-11-10T08:00:00.000Z");
    expect(new Date(zonedToUtc("2026-07-10", "09:00", "Europe/Paris")).toISOString()).toBe("2026-07-10T07:00:00.000Z");
    expect(new Date(zonedToUtc("2026-11-10", "09:00", "UTC")).toISOString()).toBe("2026-11-10T09:00:00.000Z");
  });
});

describe("parsePost", () => {
  it("strips comments but keeps hashtags and anchors", () => {
    const { header } = parsePost(file("date: 2026-11-10   # the day\nfirst_comment: see #1 at https://x.dev/#a"));
    expect(header).toEqual({ date: "2026-11-10", first_comment: "see #1 at https://x.dev/#a" });
  });
});

describe("toRow", () => {
  it("schedules a ready post at its local time", () => {
    const row = toRow("a", file("date: 2026-11-10\ntime: 10:30\nstatus: ready"), config, exists);
    expect(row).toMatchObject({ status: "scheduled", local_time: "2026-11-10 10:30 Europe/Paris", visibility: "PUBLIC" });
    expect(new Date(row.scheduled_at).toISOString()).toBe("2026-11-10T09:30:00.000Z");
  });

  it("keeps drafts out of the queue and uses the default time", () => {
    const row = toRow("a", file("date: 2026-11-10"), config, exists);
    expect(row.status).toBe("draft");
    expect(row.local_time).toBe("2026-11-10 09:00 Europe/Paris");
  });

  it("accepts a media URL without checking the repo", () => {
    const row = toRow("a", file("date: 2026-11-10\nmedia: https://example.com/a.png"), config, () => false);
    expect(row.media).toBe("https://example.com/a.png");
  });

  it.each([
    ["date: 10/11/2026", /date must look like/],
    ["date: 2026-11-10\ntime: 9h", /time must look like/],
    ["date: 2026-11-10\nstatus: posted", /status must be draft or ready/],
    ["date: 2026-11-10\nvisibility: FRIENDS", /visibility/],
    ["date: 2026-11-10\nmedia: images/a.webp", /png\/jpg\/gif\/mp4/],
  ])("refuses %s", (header, error) => {
    expect(() => toRow("a", file(header), config, exists)).toThrow(error);
  });

  it("refuses missing media and empty posts", () => {
    expect(() => toRow("a", file("date: 2026-11-10\nmedia: images/a.png"), config, () => false)).toThrow(/media not found/);
    expect(() => toRow("a", file("date: 2026-11-10", ""), config, exists)).toThrow(/no text/);
  });

  it("changes content_hash on any edit, text_hash only on the text", () => {
    const a = toRow("a", file("date: 2026-11-10\nstatus: ready"), config, exists);
    const b = toRow("a", file("date: 2026-11-11\nstatus: ready"), config, exists);
    const c = toRow("a", file("date: 2026-11-10\nstatus: ready", "Hello   **world**\n"), config, exists);
    expect(a.content_hash).not.toBe(b.content_hash);
    expect(a.text_hash).toBe(b.text_hash);
    expect(a.text_hash).toBe(c.text_hash);
  });
});

describe("postsSql", () => {
  const run = (db, rows, now) => postsSql(rows, now).forEach((s) => db.raw.exec(s));
  const status = (db, slug) => db.raw.prepare("SELECT status FROM posts WHERE slug = ?").get(slug)?.status;

  it("inserts, re-arms edited posts, leaves posted ones and cancels deleted files", () => {
    const db = memoryDb();
    const ready = (slug, date = "2026-11-10") => toRow(slug, file(`date: ${date}\nstatus: ready`, `Post ${slug}`), config, exists);
    run(db, [ready("a"), ready("b"), ready("c")], 1);
    expect(status(db, "a")).toBe("scheduled");

    db.raw.exec("UPDATE posts SET status = 'posted' WHERE slug = 'a'");
    db.raw.exec("UPDATE posts SET status = 'failed', attempts = 11 WHERE slug = 'b'");
    run(db, [ready("a", "2026-12-01"), ready("b"), ready("c")], 2);
    expect(status(db, "a")).toBe("posted"); // never touched once out
    expect(status(db, "b")).toBe("failed"); // unchanged file: not re-armed

    run(db, [ready("a"), ready("b", "2026-11-12")], 3);
    expect(status(db, "b")).toBe("scheduled"); // edited: re-armed
    expect(status(db, "c")).toBe("cancelled"); // file deleted

    run(db, [], 4);
    expect(status(db, "a")).toBe("posted");
  });

  it("keeps quotes in texts intact", () => {
    const db = memoryDb();
    run(db, [toRow("q", file("date: 2026-11-10\nstatus: ready", "It's Joel's 'post'"), config, exists)], 1);
    expect(db.raw.prepare("SELECT body FROM posts").get().body).toBe("It's Joel's 'post'");
  });
});
