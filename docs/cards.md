# Post cards

`scripts/render_card.py` turns a post's `card_*` fields into a 1080×1350 PNG (LinkedIn's 4:5 portrait,
the format that takes the most room in the feed), from `template/card.html`.

```bash
python3 scripts/render_card.py posts/texts/2026-10-27-1-my-topic.md   # one post
python3 scripts/render_card.py --all                                   # every post with a card_title
```

The image is written to `posts/images/<post name>.png` and set as the post's `media` if it has none.
Rendering needs `npm install` once (Playwright drives your installed Chrome; Shiki highlights code).

## Fields

| Field | Meaning |
|---|---|
| `card_title` | Required. `*words*` between single asterisks take the accent colour. |
| `card_kicker` | Small label above the title, in the accent colour. |
| `card_body` | One or two short sentences. |
| `card_logo` | A logo next to the title (e.g. the technology the post is about), relative to `posts/`. |
| `card_code` | A short source file (~10 lines) shown in a dark code window, relative to `posts/`. |
| `card_sign` | Overrides the signature from `config.toml` for this card. |

A card whose content does not fit its area is refused with an error, rather than published with clipped
text: shorten the title, the body or the code. With a code sample, the layout tightens (smaller title,
logo next to the label).

Logos: use the official file of the project and check that an SVG contains no `<script>`. Logos are
trademarks of their owners: use them to illustrate the technology you write about.

## config.toml

```toml
[card]
signature = "Your Name - Backend Developer"   # "Name - role": the name is bold
accent = "#2563EB"                            # label, accent words, edge, dots
paper = "#FAFAF9"
ink = "#111111"
muted = "#3F3F46"
rule = "#E4E4E7"
mark = ""                                     # optional square SVG/PNG of yours, top-right corner

[browser]
chrome = ""                                   # optional path to Chrome/Chromium
```

## Your own template

`template/card.html` is plain HTML and CSS. Keep the `{{SLOTS}}` and the `.content` element (its
overflow check is what refuses text that does not fit); everything else is yours: layout, background,
fonts (put them in `template/fonts/` with their licence). Look at the rendered PNG after each change.
