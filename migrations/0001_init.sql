-- One row per Markdown file in posts/texts/. The sync writes it; the Worker publishes it and records the outcome.
CREATE TABLE posts (
  slug          TEXT PRIMARY KEY,           -- file name without .md
  body          TEXT NOT NULL,              -- the Markdown text (**bold** is converted when posting)
  scheduled_at  INTEGER NOT NULL,           -- unix ms, UTC
  local_time    TEXT NOT NULL,              -- "2026-11-10 09:00 Europe/Paris", for reading
  visibility    TEXT NOT NULL DEFAULT 'PUBLIC',
  media         TEXT,                       -- a media key (images/x.png) or an https:// URL
  first_comment TEXT,
  -- draft | scheduled | publishing | retrying | posted | failed | missed | unknown | cancelled
  status        TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  last_error    TEXT,
  content_hash  TEXT NOT NULL,              -- of everything the file says: a change re-arms the post
  text_hash     TEXT NOT NULL,              -- of the text alone: the same text is never posted twice
  post_urn      TEXT,
  post_url      TEXT,
  posted_at     INTEGER,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX posts_due ON posts (status, scheduled_at);
CREATE INDEX posts_text ON posts (text_hash);

-- Media already uploaded, so the sync only sends files that changed.
CREATE TABLE assets (
  key          TEXT PRIMARY KEY,            -- images/card.png
  store        TEXT NOT NULL,               -- kv | r2
  sha256       TEXT NOT NULL,
  size         INTEGER NOT NULL,
  content_type TEXT,
  updated_at   INTEGER NOT NULL
);
