# Replit handoff — review stat tokens now appear in many more places

**TL;DR:** No new token keys, no schema change. But the admin side (Vercel/Supabase)
was just changed so that **per-brand `{{stat:…}}` tokens now appear in far more of a
review than before** — in stat cards, the sidebar, the comparison table, the
methodology line, `funnel_stages[].statValue`, and the threat-score category
"evidence" strings — wherever a hard-coded number used to be. **Please verify your
token resolver covers every one of those surfaces, or a raw `{{stat:…}}` will now
show on the live page where a number used to.**

---

## What changed on the admin side (and why)

Reviews used to bake brand stats as literals (`"4,846 ad creatives"`, `"49
countries"`, `"178 celebrities"`). Those froze at generation time and drifted as our
ad-scraper ingests more data — a published page ended up contradicting our own
current numbers. We migrated **every** per-brand stat display to the token system so
they resolve to the live value on each render.

There are **no new keys** — these are the same `{{stat:…}}` tokens the writer was
already told to emit. They just now appear in the deterministic HTML/structured parts
too, not only in prose paragraphs.

## Division of labor (unchanged, restating for clarity)

- **`{{platform_stat:…}}`** (site-wide aggregates) → resolved on the **Vercel side at
  sync time**. Replit will not see these as raw tokens. No action.
- **`{{stat:…}}`** (per-brand) → **left raw in the synced payload; Replit resolves
  them at render** against the `review_stats` row. **This is your responsibility, and
  it's the thing to double-check.**

## The per-brand keys your resolver must handle

Resolve from `review_stats` (per review):

| token | value source |
|---|---|
| `{{stat:ad_creatives}}` | `ad_creatives` |
| `{{stat:countries_targeted}}` | `countries_targeted` |
| `{{stat:celebrities_abused}}` | `celebrities_abused` — **the DEDUPED count**, not a raw brand total |
| `{{stat:weekly_velocity}}` | `weekly_velocity` |
| `{{stat:days_active}}` | `days_active` |
| `{{stat:first_detected}}` | `first_detected` (date) |
| `{{stat:last_active}}` | `last_active` (date) |

Modifiers that may appear and must be supported:
- `{{stat:ad_creatives|raw}}` → number with no thousands separator (`4846`)
- `{{stat:ad_creatives|short}}` → compact (`4.8k`)
- `{{stat:first_detected|iso}}` / `{{stat:last_active|iso}}` → ISO date (`2025-01-08`)
- default (no modifier) → locale-formatted (`4,846`) / long date (`January 8, 2025`)

## The one action: verify coverage on a freshly-synced review

Sync a review generated after this change and open its live page. Search the rendered
HTML for the literal text `{{stat:`. **There should be zero matches.** Pay particular
attention to surfaces that previously held a baked number and are NOT plain prose:

- the big hero stat cards (Ad Creatives / Countries Targeted / Celebrities Abused)
- the right-hand sidebar stat rows
- the "similar scams" comparison table (the reviewed brand's own row only — peer rows
  are other brands and legitimately stay literal)
- the methodology line ("Based on analysis of … ad creatives across … countries")
- the threat-score category breakdown "evidence" lines
- `funnel_stages[].statValue` / `statLabel`
- `item_list`, `dataset.description`, `red_flags`, `faq`, `summary`, `verdict`,
  `meta_description`

If any of these render a raw `{{stat:…}}`, your resolver isn't running over that
field/component — extend it to cover that surface. (The writer prompts have long
required tokens in `funnel_stages` and prose, so those likely already resolve; the
newly-at-risk surfaces are the stat cards, sidebar, comparison table, and category
evidence, which used to be literals.)

## Things that did NOT change (so you don't need to act)

- **The threat score is still a literal** (`95/100`), not a token — there is no
  `{{stat:score}}`. The admin side keeps it fresh via re-sync/backfill; render it
  as-is.
- No review field was renamed or removed. `full_article` shape is the same HTML.
- `celebrity_names` in `review_stats` is still the deduped roster.

## If you find a gap

The safe fallback if your resolver can't cover a surface for some reason: it's better
to render the resolved live value than a raw token, and better to render a raw token
than a stale wrong number — but the goal is zero raw tokens on the page.
