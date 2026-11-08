// Reading and checking post files: no I/O beyond reading, so it can be tested on its own.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

export const MEDIA_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".mp4": "video/mp4" };

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** The UTC offset of a timezone at a given instant, in ms. */
function offsetMs(ts, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
      .formatToParts(new Date(ts))
      .map((p) => [p.type, p.value]),
  );
  return Date.UTC(+parts.year, parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - ts;
}

/** "2026-11-10" + "09:00" in a timezone -> unix ms UTC (right across DST changes). */
export function zonedToUtc(date, time, timeZone) {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  return wall - offsetMs(wall - offsetMs(wall, timeZone), timeZone);
}

/** Splits a post file into its header (key: value lines) and its body. */
export function parsePost(text) {
  text = text.replaceAll("\r\n", "\n");
  if (!text.startsWith("---\n")) throw new Error("no --- header");
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) throw new Error("the header has no closing ---");
  const header = {};
  for (const line of text.slice(4, end).split("\n")) {
    if (line.trimStart().startsWith("#")) continue;
    const i = line.indexOf(":");
    // "  # comment" ends a value; "#tag" or "https://x/#anchor" does not.
    if (i > 0) header[line.slice(0, i).trim()] = line.slice(i + 1).replace(/\s+#\s.*$/, "").trim();
  }
  return { header, body: text.slice(end + 5).trim() };
}

/** Turns one post file into its D1 row, or throws a readable error. `exists(path)` checks media files. */
export function toRow(slug, text, config, exists) {
  const { header: h, body } = parsePost(text);
  const time = h.time || config.defaultTime || "09:00";
  const status = h.status || "draft";
  const visibility = h.visibility || "PUBLIC";
  if (!/^\d{4}-\d\d-\d\d$/.test(h.date ?? "")) throw new Error(`date must look like 2026-11-10, not ${JSON.stringify(h.date)}`);
  if (!/^\d\d:\d\d$/.test(time)) throw new Error(`time must look like 09:00, not ${JSON.stringify(time)}`);
  if (!["draft", "ready"].includes(status)) throw new Error(`status must be draft or ready, not ${status}`);
  if (!["PUBLIC", "CONNECTIONS"].includes(visibility)) throw new Error("visibility must be PUBLIC or CONNECTIONS");
  if (!body) throw new Error("the post has no text");
  if (h.media && !/^https:\/\//i.test(h.media)) {
    if (!MEDIA_TYPES[extname(h.media).toLowerCase()]) throw new Error(`media must be png/jpg/gif/mp4 or an https:// URL: ${h.media}`);
    if (!exists(h.media)) throw new Error(`media not found: posts/${h.media}`);
  }
  const timeZone = config.timezone || "UTC";
  const row = {
    slug,
    body,
    scheduled_at: zonedToUtc(h.date, time, timeZone),
    local_time: `${h.date} ${time} ${timeZone}`,
    visibility,
    media: h.media || null,
    first_comment: h.first_comment || null,
    status: status === "ready" ? "scheduled" : "draft",
  };
  row.content_hash = sha256(JSON.stringify(row));
  row.text_hash = sha256(body.split(/\s+/).filter(Boolean).join(" "));
  return row;
}

/** Every post in posts/texts/ (files starting with "_" are skipped). Collects all errors before failing. */
export function loadPosts(root, config) {
  const dir = join(root, "posts/texts");
  const errors = [];
  const rows = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".md") || name.startsWith("_")) continue;
    try {
      rows.push(toRow(name.slice(0, -3), readFileSync(join(dir, name), "utf8"), config, (m) => existsSync(join(root, "posts", m))));
    } catch (e) {
      errors.push(`posts/texts/${name}: ${e.message}`);
    }
  }
  return { rows, errors };
}

/** SQLite string literal (doubling quotes is the whole escaping in SQLite). */
export const sql = (v) =>
  v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replaceAll("\0", "").replaceAll("'", "''")}'`;

const COLS = ["slug", "body", "scheduled_at", "local_time", "visibility", "media", "first_comment", "status", "content_hash", "text_hash"];

/**
 * The SQL that brings D1 in line with the files: new posts are inserted, changed ones re-armed, unchanged
 * ones left alone; posted / publishing / unknown rows are never touched; deleted files cancel their post.
 */
export function postsSql(rows, now) {
  const out = rows.map(
    (p) =>
      `INSERT INTO posts (${COLS.join(", ")}, attempts, updated_at) VALUES (${COLS.map((c) => sql(p[c])).join(", ")}, 0, ${now})
       ON CONFLICT(slug) DO UPDATE SET ${COLS.slice(1).map((c) => `${c} = excluded.${c}`).join(", ")},
         attempts = 0, last_attempt_at = NULL, last_error = NULL, updated_at = excluded.updated_at
       WHERE posts.content_hash <> excluded.content_hash AND posts.status NOT IN ('posted', 'publishing', 'unknown');`,
  );
  out.push(
    `UPDATE posts SET status = 'cancelled', updated_at = ${now}
     WHERE status IN ('draft', 'scheduled', 'retrying') AND slug NOT IN (${rows.map((p) => sql(p.slug)).join(", ")});`,
  );
  return out;
}
