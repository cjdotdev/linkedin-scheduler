#!/usr/bin/env bash
# `pnpm run deploy`: what Workers Builds runs after every push to your copy of this repository (the
# "Deploy to Cloudflare" button pre-fills it). It also works from your machine after `wrangler login`.
#
# 1. D1 migrations (by binding name: the button lets you rename the database; twice is a no-op)
# 2. the Worker
# 3. the posts and their media (scripts/sync.mjs)
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm exec wrangler d1 migrations apply DB --remote
pnpm exec wrangler deploy
node scripts/sync.mjs --remote
