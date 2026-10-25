#!/usr/bin/env python3
"""linkedin-scheduler: publishes at most ONE LinkedIn post per run, on your personal profile.

Posts are Markdown files in posts/texts/ with a small header (see docs/writing-posts.md):

    ---
    date: 2026-10-27          # the day it goes out (local time)
    time: 09:00               # optional slot, 09:00 by default
    status: ready             # draft | ready | posted (only "ready" is published)
    media: images/card.png    # optional: one image (png/jpg/gif) or one mp4 video, relative to posts/
    visibility: PUBLIC        # PUBLIC or CONNECTIONS
    first_comment: The link: https://...   # optional: posted as your first comment
    ---
    The text of the post. **The hook** in bold.

Each run picks the earliest post dated today, `ready`, whose time has come, publishes it through the
official "Share on LinkedIn" API (w_member_social) and moves it to posts/posted/ with its id and link.

Never the same post twice: published files leave texts/; every published text is kept as a hash in
posts/ledger.json; a file is marked `publishing` before the request; a lock stops concurrent runs.

    python3 scripts/publish.py --check                    # proves the token works, publishes nothing
    python3 scripts/publish.py --dry-run [--date DAY]     # what would go out, sends nothing
    python3 scripts/publish.py                            # publishes (this is what cron runs)

Credentials come from .env (never committed): LINKEDIN_ACCESS_TOKEN, LINKEDIN_TOKEN_EXPIRES (YYYY-MM-DD)
and optionally LINKEDIN_PERSON_URN.
"""
import datetime as dt
import fcntl
import hashlib
import json
import subprocess
import unicodedata
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LI = ROOT / "posts"
LOG = ROOT / "logs" / "publish.log"
LEDGER = LI / "ledger.json"  # {sha256 of the text: {"file", "post_id", "posted_at"}}, keep it in git
API = "https://api.linkedin.com/v2"
IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".gif"}
VIDEO_TYPES = {".mp4"}


def now():
    """The clock (tests replace it)."""
    return dt.datetime.now()


def today():
    return now().date()


def log(message):
    line = f"{now().isoformat(timespec='seconds')}  {message}"
    print(line)
    LOG.parent.mkdir(exist_ok=True)
    with LOG.open("a") as f:
        f.write(line + "\n")


def load_env():
    env = {}
    path = ROOT / ".env"
    if path.exists():
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def read_post(path):
    """Returns (header dict, body, header lines) or None when the file has no header."""
    text = path.read_text()
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---\n", 4)
    if end < 0:
        return None
    lines = text[4:end].splitlines()
    header = {}
    for line in lines:
        if ":" in line:
            key, value = line.split(":", 1)
            header[key.strip()] = value.split("#", 1)[0].strip()
    return header, text[end + 5:].strip(), lines


def set_header(path, **fields):
    """Rewrites the header of a post file with these fields (replacing them if present)."""
    text = path.read_text()
    end = text.find("\n---\n", 4)
    lines = [l for l in text[4:end].splitlines() if l.split(":", 1)[0].strip() not in fields]
    lines += [f"{key}: {value}" for key, value in fields.items()]
    path.write_text("---\n" + "\n".join(lines) + text[end:])


def bold(text):
    """Unicode sans-serif bold: LinkedIn has no markup, this is how bold text is written on it.
    Accented letters are rebuilt from a bold base letter plus the combining accent."""
    out = []
    for ch in unicodedata.normalize("NFD", text):
        if "A" <= ch <= "Z":
            out.append(chr(0x1D5D4 + ord(ch) - ord("A")))
        elif "a" <= ch <= "z":
            out.append(chr(0x1D5EE + ord(ch) - ord("a")))
        elif "0" <= ch <= "9":
            out.append(chr(0x1D7EC + ord(ch) - ord("0")))
        else:
            out.append(ch)
    return "".join(out)


def linkedin_text(body):
    """The text as sent: **words** become Unicode bold (keep it for the hook)."""
    return re.sub(r"\*\*(.+?)\*\*", lambda m: bold(m.group(1)), body)


def text_hash(body):
    return hashlib.sha256(" ".join(body.split()).encode()).hexdigest()


def load_ledger():
    return json.loads(LEDGER.read_text()) if LEDGER.exists() else {}


class ApiError(SystemExit):
    """A LinkedIn HTTP error; `code` tells a definite refusal (4xx) from an unknown outcome (5xx)."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def request(method, url, token, body=None, data=None, headers=None):
    h = {"Authorization": f"Bearer {token}", "X-Restli-Protocol-Version": "2.0.0", **(headers or {})}
    if body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=300) as res:
            raw = res.read()
            return res.status, dict(res.headers), (json.loads(raw) if raw[:1] in (b"{", b"[") else None)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:500]
        if e.code == 401:
            raise ApiError(401, f"LinkedIn answered 401: the access token is invalid or expired. Renew it (see docs/linkedin-setup.md). {detail}")
        raise ApiError(e.code, f"LinkedIn answered {e.code} on {method} {url}: {detail}")


def upload_media(path, token, author):
    kind = "video" if path.suffix.lower() in VIDEO_TYPES else "image"
    _, _, reg = request("POST", f"{API}/assets?action=registerUpload", token, body={
        "registerUploadRequest": {
            "recipes": [f"urn:li:digitalmediaRecipe:feedshare-{kind}"],
            "owner": author,
            "serviceRelationships": [{"relationshipType": "OWNER", "identifier": "urn:li:userGeneratedContent"}],
        }
    })
    upload_url = reg["value"]["uploadMechanism"]["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]["uploadUrl"]
    asset = reg["value"]["asset"]
    request("PUT", upload_url, token, data=path.read_bytes(), headers={"Content-Type": "application/octet-stream"})
    # A video is processed before it can be posted: wait until the asset is AVAILABLE.
    asset_id = asset.rsplit(":", 1)[-1]
    for _ in range(60):
        _, _, info = request("GET", f"{API}/assets/{asset_id}", token)
        status = (info or {}).get("recipes", [{}])[0].get("status")
        if status == "AVAILABLE":
            break
        if status in {"PROCESSING_FAILED", "CLIENT_ERROR"}:
            raise SystemExit(f"LinkedIn could not process {path.name}: {status}")
        time.sleep(5)
    return kind, asset


def check():
    """--check: proves the token in .env works (reads your name and person id), publishes nothing."""
    env = load_env()
    token = env.get("LINKEDIN_ACCESS_TOKEN")
    if not token:
        raise SystemExit("LINKEDIN_ACCESS_TOKEN is missing in .env (see docs/linkedin-setup.md)")
    _, _, me = request("GET", f"{API}/userinfo", token)
    print(f"Token OK: {me.get('name')} ({me.get('email', 'no email scope')})")
    print(f"LINKEDIN_PERSON_URN=urn:li:person:{me['sub']}")
    expires = env.get("LINKEDIN_TOKEN_EXPIRES")
    print(f"Expires: {expires}" if expires else "LINKEDIN_TOKEN_EXPIRES is not set: add it to get a warning before it expires")


def main():
    if "--check" in sys.argv:
        return check()
    dry_run = "--dry-run" in sys.argv
    day = today().isoformat()
    if "--date" in sys.argv:
        # Only to preview another day: a real run always publishes today's posts and nothing else.
        if not dry_run:
            raise SystemExit("--date only works with --dry-run")
        day = dt.date.fromisoformat(sys.argv[sys.argv.index("--date") + 1]).isoformat()
    LOG.parent.mkdir(exist_ok=True)
    lock = open(ROOT / "logs" / ".publish.lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log("another run is publishing right now: this one stops")
        return
    hhmm = now().strftime("%H:%M")
    ledger = load_ledger()
    later = []
    candidates = []
    for path in sorted((LI / "texts").glob("*.md")):
        if path.name.startswith("_"):
            continue
        post = read_post(path)
        if not post:
            continue
        if post[0].get("status") == "publishing":
            log(f"warning: {path.name} is still 'publishing' from a run that did not finish: check LinkedIn, "
                "then set it back to ready or move it to posted/ by hand. It is not retried.")
            continue
        # Missed = dated before the real today (a --date preview of a later day does not count).
        if post[0].get("status") == "ready" and post[0].get("date", "") < today().isoformat():
            log(f"missed: {path.name} is dated {post[0].get('date')} and was never sent; give it a new date")
            continue
        if post[0].get("date") == day and post[0].get("status") == "ready":
            slot = post[0].get("time", "09:00")
            if not re.fullmatch(r"\d\d:\d\d", slot):
                raise SystemExit(f"{path.name}: time must look like 09:00, not {slot!r}")
            if slot > hhmm and not dry_run:
                later.append(f"{path.name} at {slot}")
                continue
            if text_hash(post[1]) in ledger:
                done = ledger[text_hash(post[1])]
                log(f"refused {path.name}: the same text was already published ({done['file']}, {done['post_id']})")
                continue
            candidates.append((path, post))
    # The earliest slot first (then the file name): a post missed at 9:00 goes out at the next run.
    candidates.sort(key=lambda c: (c[1][0].get("time", "09:00"), c[0].name))
    if not candidates:
        log(f"nothing ready for {day}" + (f" yet (later today: {', '.join(later)})" if later else ""))
        if dry_run:
            for path in sorted((LI / "texts").glob(f"{day}*.md")):
                post = read_post(path)
                if post:
                    print(f"  {path.name}: status {post[0].get('status', '?')} (only 'ready' is published)")
        return
    path, (header, body, _) = candidates[0]
    media = LI / header["media"] if header.get("media") else None
    if media and (not media.exists() or media.suffix.lower() not in IMAGE_TYPES | VIDEO_TYPES):
        raise SystemExit(f"{path.name}: media {header['media']} is missing or not an image/mp4")
    if not body:
        raise SystemExit(f"{path.name}: the post has no text")
    if len(linkedin_text(body)) > 3000:
        raise SystemExit(f"{path.name}: {len(body)} characters, LinkedIn allows 3000")
    video_info = ""
    if media and media.suffix.lower() in VIDEO_TYPES:
        size = media.stat().st_size
        if not 75_000 <= size <= 200_000_000:
            raise SystemExit(f"{path.name}: video is {size} bytes, LinkedIn wants 75 KB to 200 MB")
        try:
            seconds = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                            str(media)], capture_output=True, text=True, check=True).stdout)
        except (OSError, subprocess.CalledProcessError, ValueError):
            seconds = None  # no ffprobe: LinkedIn will judge
        if seconds is not None and not 3 <= seconds <= 600:
            raise SystemExit(f"{path.name}: video lasts {seconds:.1f} s, LinkedIn wants 3 s to 10 min")
        video_info = f" ({size / 1e6:.1f} MB" + (f", {seconds:.1f} s)" if seconds else ")")
    visibility = header.get("visibility", "PUBLIC")
    if dry_run:
        log(f"[dry-run] would publish {path.name} on {day} at {header.get('time', '09:00')} or the first run after; "
            f"{len(candidates) - 1} more ready that day")
        print(f"  text: {len(body)} / 3000 characters")
        print(f"  media: {header.get('media') or 'none'}{video_info}")
        print(f"  visibility: {visibility}")
        print(f"  first comment: {header.get('first_comment') or 'none'}")
        print("\n----- post -----\n" + linkedin_text(body) + "\n----------------")
        return

    env = load_env()
    token = env.get("LINKEDIN_ACCESS_TOKEN")
    if not token:
        raise SystemExit("LINKEDIN_ACCESS_TOKEN is missing in .env (see docs/linkedin-setup.md)")
    expires = env.get("LINKEDIN_TOKEN_EXPIRES")
    if expires and (dt.date.fromisoformat(expires) - today()).days <= 7:
        log(f"warning: the LinkedIn token expires on {expires}, renew it (see docs/linkedin-setup.md)")
    author = env.get("LINKEDIN_PERSON_URN")
    if not author:
        _, _, me = request("GET", f"{API}/userinfo", token)
        author = f"urn:li:person:{me['sub']}"

    # From here on the post may go out: never pick this file again on its own.
    set_header(path, status="publishing")
    content = {"shareCommentary": {"text": linkedin_text(body)}, "shareMediaCategory": "NONE"}
    try:
        if media:
            kind, asset = upload_media(media, token, author)
            content["shareMediaCategory"] = kind.upper()
            content["media"] = [{"status": "READY", "media": asset}]
    except (SystemExit, OSError) as e:
        # The post itself was never sent: safe to try again at the next run.
        set_header(path, status="ready")
        raise SystemExit(f"{path.name}: media upload failed, back to ready for the next run: {e}")
    try:
        _, headers, _ = request("POST", f"{API}/ugcPosts", token, body={
            "author": author,
            "lifecycleState": "PUBLISHED",
            "specificContent": {"com.linkedin.ugc.ShareContent": content},
            "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": visibility},
        })
    except ApiError as e:
        if 400 <= e.code < 500:
            set_header(path, status="ready")
            raise SystemExit(f"{path.name}: LinkedIn refused the post, back to ready for the next run: {e}")
        raise SystemExit(f"{path.name}: unknown outcome, left as 'publishing' (check LinkedIn): {e}")
    except OSError as e:
        raise SystemExit(f"{path.name}: connection lost while posting, left as 'publishing' (check LinkedIn): {e}")
    post_id = headers.get("X-RestLi-Id") or headers.get("x-restli-id") or "unknown"
    posted_at = now().isoformat(timespec="seconds")
    url = f"https://www.linkedin.com/feed/update/{post_id}/"
    record_posted(path, body, post_id, posted_at, url, ledger, len(candidates) - 1)
    comment = header.get("first_comment")
    add_first_comment(comment, post_id, token, author)


def record_posted(path, body, post_id, posted_at, url, ledger, more):
    ledger[text_hash(body)] = {"file": path.name, "post_id": post_id, "posted_at": posted_at}
    LEDGER.write_text(json.dumps(ledger, indent=2))
    set_header(path, status="posted", posted_at=posted_at, post_id=post_id, url=url)
    (LI / "posted").mkdir(exist_ok=True)
    path.rename(LI / "posted" / path.name)
    log(f"published {path.name} -> {url} (moved to posted/); {more} more ready today")


def add_first_comment(comment, post_id, token, author):
    # The post is already recorded as posted: a failed comment only warns, it never re-posts.
    if comment and post_id != "unknown":
        try:
            request("POST", f"{API}/socialActions/{urllib.parse.quote(post_id, safe='')}/comments", token,
                    body={"actor": author, "message": {"text": comment}})
            log(f"first comment added under {post_id}")
        except SystemExit as e:
            log(f"warning: the post is out but the first comment failed, add it by hand: {e}")


if __name__ == "__main__":
    main()
