#!/usr/bin/env node
// `pnpm run setup`: installs linkedin-scheduler on YOUR Cloudflare account, by hand (the "Deploy to
// Cloudflare" button does the same from the browser). Safe to run again: what exists is reused.
//
// 1. signs you in to Cloudflare (wrangler login) if needed
// 2. creates the D1 database and the KV namespace, and writes their ids into wrangler.jsonc
// 3. asks your timezone (scheduler.json)
// 4. deploys (migrations, Worker, posts), then asks for the three secrets
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const ROOT = new URL("..", import.meta.url).pathname;
const WRANGLER = join(ROOT, "wrangler.jsonc");
const SCHEDULER = join(ROOT, "scheduler.json");
const PLACEHOLDER_D1 = "00000000-0000-4000-8000-000000000000";
const PLACEHOLDER_KV = "00000000000000000000000000000000";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, fallback) => (await rl.question(fallback ? `${q} [${fallback}] ` : `${q} `)).trim() || fallback;
const capture = (args) => execFileSync("pnpm", ["exec", "wrangler", ...args], { cwd: ROOT, encoding: "utf8" });
const interactive = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
};
const step = (n, text) => console.log(`\n\x1b[1m${n}. ${text}\x1b[0m`);

step(1, "Cloudflare account");
try {
  const who = capture(["whoami"]);
  if (/not authenticated/i.test(who)) throw new Error();
  console.log(who.split("\n").find((l) => /logged in/i.test(l))?.trim() ?? "Signed in.");
} catch {
  interactive("pnpm", ["exec", "wrangler", "login"]);
}

step(2, "D1 database and KV namespace");
let config = readFileSync(WRANGLER, "utf8");
if (config.includes(PLACEHOLDER_D1)) {
  const name = await ask("Name of the D1 database (new, not used on your account)?", "my-linkedin-scheduler");
  const existing = JSON.parse(capture(["d1", "list", "--json"])).map((d) => d.name);
  if (existing.includes(name)) throw new Error(`a D1 database named ${name} already exists on this account: run setup again with another name`);
  const out = capture(["d1", "create", name]);
  const id = out.match(/database_id["\s:=]+"([0-9a-f-]{36})"/)?.[1];
  if (!id) throw new Error(`could not read the database id from:\n${out}`);
  config = config.replace(PLACEHOLDER_D1, id).replace(/"database_name": "[^"]*"/, `"database_name": "${name}"`);
  console.log(`Created D1 ${name} (${id})`);
} else console.log("D1 already set in wrangler.jsonc.");
if (config.includes(PLACEHOLDER_KV)) {
  const out = capture(["kv", "namespace", "create", "my-linkedin-scheduler-media"]);
  const id = out.match(/\bid["\s:=]+"([0-9a-f]{32})"/)?.[1];
  if (!id) throw new Error(`could not read the namespace id from:\n${out}`);
  config = config.replace(PLACEHOLDER_KV, id);
  console.log(`Created KV my-linkedin-scheduler-media (${id})`);
} else console.log("KV already set in wrangler.jsonc.");
writeFileSync(WRANGLER, config);

step(3, "Your timezone (post times are written in it)");
const scheduler = JSON.parse(readFileSync(SCHEDULER, "utf8"));
const guess = scheduler.timezone && scheduler.timezone !== "UTC" ? scheduler.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone;
scheduler.timezone = await ask("Timezone (IANA name, e.g. Europe/Paris)?", guess);
try {
  new Intl.DateTimeFormat("en", { timeZone: scheduler.timezone });
} catch {
  throw new Error(`${scheduler.timezone} is not a timezone name`);
}
writeFileSync(SCHEDULER, JSON.stringify(scheduler, null, 2) + "\n");

step(4, "Deploy (migrations, Worker, posts)");
interactive("bash", ["scripts/deploy.sh"]);

console.log("\nNow the secrets. Wrangler asks for each value; nothing is written to disk.");
console.log("  LINKEDIN_ACCESS_TOKEN: from LinkedIn's Token Generator (docs/linkedin-setup.md)");
console.log("  LINKEDIN_TOKEN_EXPIRES: YYYY-MM-DD, about 60 days from today");
console.log("  ADMIN_TOKEN: any long random string, e.g. the output of `openssl rand -hex 24`");
for (const name of ["LINKEDIN_ACCESS_TOKEN", "LINKEDIN_TOKEN_EXPIRES", "ADMIN_TOKEN"]) {
  if ((await ask(`Set ${name} now? (y/n)`, "y")).toLowerCase().startsWith("y")) {
    interactive("pnpm", ["exec", "wrangler", "secret", "put", name]);
  }
}
rl.close();

console.log(`
Done. Next:
  - commit wrangler.jsonc and scheduler.json (the ids are not secret) and push;
  - connect this repository to the Worker so every push deploys: Cloudflare dashboard -> Workers & Pages ->
    your Worker -> Settings -> Build -> Connect (docs/install.md, "Deploy on every push");
  - write a post in posts/texts/ (docs/writing-posts.md), push, and check GET /status.`);
