#!/usr/bin/env node
// Brings Cloudflare in line with the repo: media -> KV (or R2 over 25 MB), posts/texts/*.md -> D1.
//
//   node scripts/sync.mjs --remote     # your real D1 and KV (what `pnpm run deploy` runs after each push)
//   node scripts/sync.mjs --local      # the local copies used by `pnpm dev`
//   add --dry-run to print the SQL and the uploads without doing them
//
// D1 is the history: each run compares the files with what D1 has (a hash per post, per media file).
// Unchanged posts are left alone, so a failed or posted post is never re-armed by an unrelated push.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative, sep } from "node:path";
import { loadPosts, MEDIA_TYPES, postsSql, sha256, sql } from "./lib/posts.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const CONFIG = JSON.parse(readFileSync(join(ROOT, "scheduler.json"), "utf8"));
const args = process.argv.slice(2);
const TARGET = args.includes("--remote") ? "--remote" : "--local";
const DRY = args.includes("--dry-run");
const KV_LIMIT = 25 * 1024 * 1024;

// The optional R2 bucket, read from wrangler.jsonc (comments stripped).
const wranglerConfig = JSON.parse(
  readFileSync(join(ROOT, "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"),
);
const R2_BUCKET = wranglerConfig.r2_buckets?.find((b) => b.binding === "MEDIA_R2")?.bucket_name;

function wrangler(params, { capture = false } = {}) {
  if (DRY && !capture) return console.log(`[dry-run] wrangler ${params.join(" ")}`);
  return execFileSync("pnpm", ["exec", "wrangler", ...params], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : ["ignore", "ignore", "inherit"],
  });
}

// Binding names, not resource names: the Deploy button lets you rename the database and the namespace.
function query(command) {
  const out = wrangler(["d1", "execute", "DB", TARGET, "--json", "--command", command], { capture: true });
  return JSON.parse(out.slice(out.indexOf("[")))[0].results;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : name === ".gitkeep" ? [] : [path];
  });
}

const now = Date.now();
const { rows, errors } = loadPosts(ROOT, CONFIG);
if (errors.length) {
  console.error(`Nothing was synced, fix these first:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log(`${rows.length} post(s) in posts/texts/, ${TARGET.slice(2)} D1, timezone ${CONFIG.timezone || "UTC"}`);

// 1. Media first: a post must never be scheduled before its image exists.
const files = walk(join(ROOT, "posts")).filter((p) => !p.includes(`${sep}texts${sep}`) && MEDIA_TYPES[extname(p).toLowerCase()]);
const known = new Map(query("SELECT key, store, sha256 FROM assets").map((r) => [r.key, r]));
const statements = [];
let uploaded = 0;
for (const path of files) {
  const key = relative(join(ROOT, "posts"), path).split(sep).join("/");
  const data = readFileSync(path);
  const hash = sha256(data);
  if (known.get(key)?.sha256 === hash) continue;
  const type = MEDIA_TYPES[extname(path).toLowerCase()];
  let store = "kv";
  if (data.length > KV_LIMIT) {
    if (!R2_BUCKET) {
      console.error(`posts/${key} is over 25 MB: enable the optional R2 bucket in wrangler.jsonc (MEDIA_R2), or make it smaller.`);
      process.exit(1);
    }
    store = "r2";
    wrangler(["r2", "object", "put", `${R2_BUCKET}/${key}`, "--file", path, "--content-type", type, TARGET]);
  } else {
    wrangler(["kv", "key", "put", key, "--binding", "MEDIA", "--path", path, TARGET]);
  }
  statements.push(
    `INSERT INTO assets (key, store, sha256, size, content_type, updated_at) VALUES (${sql(key)}, ${sql(store)}, ${sql(hash)}, ${data.length}, ${sql(type)}, ${now})
     ON CONFLICT(key) DO UPDATE SET store = excluded.store, sha256 = excluded.sha256, size = excluded.size, content_type = excluded.content_type, updated_at = excluded.updated_at;`,
  );
  uploaded++;
}
const keys = new Set(files.map((p) => relative(join(ROOT, "posts"), p).split(sep).join("/")));
let removed = 0;
for (const [key, { store }] of known) {
  if (keys.has(key)) continue;
  if (store === "r2" && R2_BUCKET) wrangler(["r2", "object", "delete", `${R2_BUCKET}/${key}`, TARGET]);
  else wrangler(["kv", "key", "delete", key, "--binding", "MEDIA", TARGET]);
  statements.push(`DELETE FROM assets WHERE key = ${sql(key)};`);
  removed++;
}

// 2. Posts.
statements.push(...postsSql(rows, now));
const file = join(mkdtempSync(join(tmpdir(), "li-sync-")), "sync.sql");
writeFileSync(file, statements.join("\n"));
if (DRY) {
  console.log(`\n----- SQL -----\n${statements.join("\n")}\n---------------`);
} else {
  wrangler(["d1", "execute", "DB", TARGET, "--file", file, "--yes", "--json"], { capture: true });
}
console.log(`Media: ${uploaded} uploaded, ${removed} removed, ${files.length - uploaded} unchanged.`);

if (!DRY) {
  console.table(query("SELECT slug, status, local_time, attempts, last_error FROM posts ORDER BY scheduled_at DESC LIMIT 20"));
}
