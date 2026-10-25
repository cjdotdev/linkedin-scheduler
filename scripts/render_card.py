#!/usr/bin/env python3
"""Makes the image of a post from template/card.html (1080x1350), with the colours of config.toml.

The card's text lives in the post's header, next to the other fields:

    ---
    date: 2026-10-27
    status: draft
    card_logo: images/logos/tool.svg      # logo of the technology, above the title (optional)
    card_code: images/code/example.ts     # a short code sample, highlighted (optional, ~10 lines)
    card_kicker: TypeScript               # small label in the accent colour (optional)
    card_title: One rule, *written once*  # *words* in the accent colour
    card_body: One or two short sentences.        # optional
    card_sign: Name - role                # optional, config.toml's signature by default
    ---

    python3 scripts/render_card.py posts/texts/2026-10-27-1-topic.md   # one post
    python3 scripts/render_card.py --all                                # every post with a card_title

It writes posts/images/<post name>.png and, when the post has no media yet, sets
`media: images/<post name>.png`. A card whose content does not fit is refused: shorten it.
"""
import html
import re
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POSTS = ROOT / "posts"
TEMPLATE = ROOT / "template" / "card.html"
THEME_KEYS = ("accent", "paper", "ink", "muted", "rule")
DEFAULTS = {"signature": "", "accent": "#059669", "paper": "#FAFAF9", "ink": "#111111", "muted": "#3F3F46",
            "rule": "#E4E4E7", "mark": ""}


def config():
    path = ROOT / "config.toml"
    data = tomllib.loads(path.read_text()) if path.exists() else {}
    card = {**DEFAULTS, **data.get("card", {})}
    return card, data.get("browser", {}).get("chrome", "")


def header(path):
    """The header fields as written (values keep '#'; only an inline '  # comment' is dropped)."""
    text = path.read_text()
    end = text.find("\n---\n", 4)
    if not text.startswith("---\n") or end < 0:
        return {}, text, -1
    fields = {}
    for line in text[4:end].splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            fields[key.strip()] = re.sub(r"\s+#\s.*$", "", value).strip()
    return fields, text, end


def sign_html(sign):
    """"Name - role" (or "Name · role"): the name in bold, the role in the regular weight."""
    for sep in (" - ", " · "):
        name, found, role = sign.partition(sep)
        if found:
            return f"{name} <span>{sep.strip()} {role}</span>"
    return sign


def image_html(path, base, css_class):
    """An image file shown on the card (path relative to `base`), or nothing."""
    if not path:
        return ""
    file = (base / path).resolve()
    if not file.exists():
        raise SystemExit(f"{path} not found")
    return f'<img class="{css_class}" src="{file.as_uri()}" alt="">'


def code_html(path):
    """card_code: a source file relative to posts/, highlighted by Shiki."""
    if not path:
        return ""
    src = (POSTS / path).resolve()
    if not src.exists():
        raise SystemExit(f"card_code {path} not found")
    result = subprocess.run(["node", str(ROOT / "scripts" / "highlight.mjs"), str(src)], cwd=ROOT,
                            capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f"card_code {path}: {result.stderr.strip()}")
    return (f'<div class="code"><div class="bar"><i></i><i></i><i></i><span>{html.escape(src.name)}</span></div>'
            f"{result.stdout}</div>")


def render(post, card, chrome):
    fields, text, end = header(post)
    title = fields.get("card_title", "")
    if not title:
        print(f"skip {post.name}: no card_title")
        return
    esc = html.escape
    theme = " ".join(f"--{key}: {card[key]};" for key in THEME_KEYS)
    filled_html = (TEMPLATE.read_text()
                   .replace("{{THEME}}", theme)
                   .replace("{{CARD_CLASS}}", " has-code" if fields.get("card_code") else "")
                   .replace("{{MARK}}", image_html(card["mark"], ROOT, "mark"))
                   .replace("{{CODE}}", code_html(fields.get("card_code", "")))
                   .replace("{{LOGO}}", image_html(fields.get("card_logo", ""), POSTS, "logo"))
                   .replace("{{KICKER}}", esc(fields.get("card_kicker", "")))
                   .replace("{{TITLE}}", re.sub(r"\*(.+?)\*", r"<em>\1</em>", esc(title)))
                   .replace("{{BODY}}", esc(fields.get("card_body", "")))
                   .replace("{{SIGN}}", sign_html(esc(fields.get("card_sign", card["signature"])))))
    filled = TEMPLATE.parent / f".{post.stem}.html"  # next to the template, so fonts/ resolves
    filled.write_text(filled_html)
    out = POSTS / "images" / f"{post.stem}.png"
    out.parent.mkdir(exist_ok=True)
    try:
        result = subprocess.run(["node", str(ROOT / "scripts" / "render_card.mjs"), str(filled), str(out), chrome],
                                cwd=ROOT, capture_output=True, text=True)
    finally:
        filled.unlink(missing_ok=True)
    if result.returncode != 0:
        out.unlink(missing_ok=True)
        raise SystemExit(f"{post.name}: {result.stderr.strip() or result.stdout.strip()}")
    if "media" not in fields:
        post.write_text(text[:end] + f"\nmedia: images/{out.name}" + text[end:])
    print(f"{post.name} -> images/{out.name}")


def main():
    args = sys.argv[1:]
    if args == ["--all"]:
        posts = [p for p in sorted((POSTS / "texts").glob("*.md")) if not p.name.startswith("_")]
    elif args:
        posts = [Path(a).resolve() for a in args]
    else:
        raise SystemExit(__doc__)
    card, chrome = config()
    for post in posts:
        render(post, card, chrome)


if __name__ == "__main__":
    main()
