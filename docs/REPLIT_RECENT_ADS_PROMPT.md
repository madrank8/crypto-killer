# Replit Agent prompt — "Ads Scraped This Week" evidence grid

> Paste this entire document into Replit Agent chat. Self-contained; embeds payload shape + sample data + render spec.

---

# TASK: Render the "Ads scraped this week" grid on review pages

## Context

The Vercel admin/sync side just shipped a new field in the `/api/sync/review` payload: `review.recent_ads_sample` — an array of up to 20 ad creatives scraped from SpyOwl in the last 7 days for the brand being reviewed. Right now Replit ignores this field.

Your job: surface it as a compact grid near the **Ad Velocity** widget on each review page. The grid is **evidence material** — proof that we caught real ads recently. It's a major E-E-A-T signal (first-hand investigation) that AI Overviews and Google reviewers reward.

## Important design constraint from product

> "Small images, don't need them to be big" — but SpyOwl actually exposes NO image URLs in their API. We probed every endpoint; they're metadata-only. Path A (real ad thumbnails from SpyOwl) is not feasible.
>
> Instead, **render metadata-rich cards without images**. The content (named celebrity + specific ad copy in the original language + scam landing domain + Facebook post link) is stronger evidence than a blurry thumbnail.

If you want to enhance with images later, the recommended path is lazy-fetching `<meta property="og:image">` from each `post_url` server-side with caching — but that's V2 polish, not V1.

## Acceptance checklist

When you're done:

1. Review pages with `recent_ads_sample.length > 0` show a section titled **"Ads scraped this week"** (or your locale's translation; English-only for V1 if needed) positioned **adjacent to or directly under the Ad Velocity widget**.
2. The section is **hidden entirely** when the array is empty (no "No ads found" placeholder — silently absent).
3. Each card displays:
   - Country flag (from `geo` ISO code) + the country code
   - Celebrity name when present (e.g., `🎭 Ana Botín, Felipe VI`)
   - "Video" or "Image" badge from `is_video` boolean
   - Language code badge (`es`, `it`, etc.)
   - "X days ago" date from `first_seen_at`
   - Ad copy excerpt from `main_text` (truncated to ~120 chars in the card; full text in tooltip/expanded view)
   - Landing domain from `link_domain` (e.g., `senviks.world`) — **display only**, never as an href
   - CTA from **`cta_url` / `cta_label` / `cta_rel`** (preferred). Fallback: `post_url` only if it is a Facebook permalink. **Never** use SpyOwl `link_url`, brand `landing_urls`, or archive live fallbacks as the CTA href (see `docs/REPLIT_ADS_CTA_SAFETY_HANDOFF.md`).
4. Cards in a **responsive grid** — 3-4 per row desktop, 2 per row tablet, 1 per row mobile. Each card around 220-260px wide.
5. **Cookie-consent boilerplate filtered out** of `link_text` (see Filtering rules below). `main_text` is generally clean and doesn't need filtering.
6. Page renders cleanly with **no errors** when `recent_ads_sample` is missing or empty (older payloads from Vercel pre-this-feature won't include it).
7. **Zero** CTA hrefs containing `/click`, `token_fb`, `fbclid`, or `pixel_fb`.

## Phase 1 — DISCOVERY (do this first, report back)

Before writing code:

1. Find the review render route. You already know it from the multilingual work — it lives at the path that renders `/review/[slug]` (and `/[locale]/review/[slug]`).
2. Find the Ad Velocity widget — search the codebase for "velocity" or "Ad Velocity" or "7-day" or `weekly creative velocity`. We want to render the new grid next to it.
3. Find the data layer for review rendering — where the page reads its props from the local DB (Replit's `reviews` table or wherever the sync payload was stored).
4. Confirm `recent_ads_sample` is being **received and stored** when the sync payload arrives. If your ingestion handler doesn't yet save this field, you'll need to:
   - Add a column or related table to persist it (recommend: `review_recent_ads jsonb` on the reviews table, OR a separate `review_recent_ads` table with `review_id`, `creative_id`, and the fields below)
   - Update the sync handler to write it
   - Update the read path to expose it on the page

Report back with: ingestion file paths, render file paths, current Ad Velocity widget location, your proposed storage approach. Then proceed to Phase 2.

## Phase 2 — PAYLOAD SHAPE (the data you'll receive)

Here's the exact shape of `review.recent_ads_sample` in the incoming `/api/sync/review` payload. **Real example from Senvix** (id `715e395c-69ad-44ea-8189-255fe3051124`):

```json
{
  "review": {
    "slug": "senvix",
    "threat_score": 50,
    // ... existing fields ...
    "recent_ads_sample": [
      {
        "creative_id": "6a06e3780d3636d0340fea46",
        "offer_name": "Senvix",
        "celebrity_name": "Ana Botín, Felipe VI",
        "geo": "ES",
        "land_language": "es",
        "is_video": false,
        "first_seen_at": "2026-05-15T09:12:24.047Z",
        "spyowl_created_at": "2026-05-15T09:12:24.047Z",
        "main_text": "📢 Ha llegado el boom tecnológico europeo para los inversores particulares. ¡Por fin todos los españoles pueden respirar aliviados! No importa la edad que tengas ni a qué te dediques. ¿Eres conductor?…",
        "link_text": null,
        "link_domain": "senviks.world",
        "post_url": "https://www.facebook.com/100063654715787/posts/24850267551337102/",
        "fp_link": "https://www.facebook.com/profile.php?id=100063654715787",
        "cta_url": "https://www.facebook.com/100063654715787/posts/24850267551337102/",
        "cta_label": "View Facebook post",
        "cta_rel": "nofollow noopener"
      },
      {
        "creative_id": "6a06dfd00d3636d0340fe97a",
        "offer_name": "Senvix",
        "celebrity_name": "Pier Berlusconi",
        "geo": "IT",
        "land_language": "it",
        "is_video": true,
        "first_seen_at": "2026-05-15T08:56:48.46Z",
        "spyowl_created_at": "2026-05-15T08:56:48.46Z",
        "main_text": "La gente si arricchisce e le banche impazziscono. Non si tratta semplicemente di…",
        "link_text": "Cookies from other companies: We use these cookies to show you ads off of Meta Products and to provide features like maps and videos on Meta Products. These cookies are optional.",
        "link_domain": "turinxyvalope.com",
        "post_url": "https://www.facebook.com/61553072153197/posts/27405896579035120/?rdid=q6LSdVi9MEfd5iGe",
        "fp_link": "https://www.facebook.com/profile.php?id=61553072153197"
      },
      {
        "creative_id": "6a06df930d3636d0340fe965",
        "offer_name": "Senvix",
        "celebrity_name": "Giorgia Meloni, Bill Gates",
        "geo": "IT",
        "land_language": "it",
        "is_video": true,
        "first_seen_at": "2026-05-15T08:55:47.025Z",
        "spyowl_created_at": "2026-05-15T08:55:47.025Z",
        "main_text": "𝐒𝐓𝐎𝐏 𝐀𝐋𝐋'𝐈𝐍𝐅𝐋𝐀𝐙𝐈𝐎𝐍𝐄: 𝐓𝐑𝐀𝐒𝐅𝐄𝐑𝐈𝐒𝐂𝐈 𝐈 𝐓𝐔𝐎𝐈 𝐑𝐈𝐒𝐏𝐀𝐑𝐌𝐈 𝐃𝐎𝐕𝐄 𝐋𝐀𝐕𝐎𝐑𝐀𝐍𝐎 𝐃𝐀𝐕𝐕𝐄𝐑𝐎 📈 𝐏𝐞𝐫𝐜𝐡𝐞́…",
        "link_text": "𝐂𝐚𝐧𝐚𝐥𝐞 𝐆𝐨𝐯𝐞𝐫𝐧𝐚𝐭𝐢𝐯𝐨 𝐔𝐟𝐟𝐢𝐜𝐢𝐚𝐥𝐞!",
        "link_domain": "venture.riforma-digitale.com",
        "post_url": "https://www.facebook.com/61551412217564/posts/35739947265652236/?rdid=wtThGhN3b52mVoRp",
        "fp_link": "https://www.facebook.com/profile.php?id=61551412217564"
      },
      {
        "creative_id": "6a05b8470d3636d0340fdeaf",
        "offer_name": "Senvix",
        "celebrity_name": "Paul Hüttel",
        "geo": "DK",
        "land_language": "da",
        "is_video": false,
        "first_seen_at": "2026-05-14T11:55:51.845Z",
        "spyowl_created_at": "2026-05-14T11:55:51.845Z",
        "main_text": "Pauls sidste overraskelse: Hvorfor Danmarks folkekære legende efterlod arvingern…",
        "link_text": null,
        "link_domain": "syntravaxion.com",
        "post_url": null,
        "fp_link": "https://www.facebook.com/profile.php?id=61550746284408"
      }
    ]
  },
  "brand": { /* unchanged */ }
}
```

Notes:
- `recent_ads_sample` may be `[]` (no ads in last 7d) or absent on legacy payloads — handle both.
- Up to 20 entries, ordered newest-first by `first_seen_at`.
- `celebrity_name`, `link_text`, `link_domain`, `post_url`, `cta_url` may each independently be `null` — render conditionally.
- **`link_url` is never present** in the sync payload. Do not reconstruct landing CTAs from scrapers or DB joins.
- Prefer `cta_url` for the button. If `cta_url` is null and `post_url` is missing, omit the CTA (show `link_domain` as plain text only). When `post_url` is missing, Vercel may still set `cta_url` to a Meta Ad Library search for the brand.
- `main_text` is already truncated to 280 chars upstream; the card should truncate further to ~120 for compact display but make the full thing accessible (tooltip, line-clamp + expand, or a `title=""` attribute).

**Safety handoff:** `docs/REPLIT_ADS_CTA_SAFETY_HANDOFF.md` (Peak Luxentria audit — mandatory).

## Phase 3 — FILTERING RULES

`link_text` sometimes contains Facebook's cookie consent boilerplate that bled into the scrape. **Hide `link_text` when** any of these patterns match (case-insensitive, on the trimmed string):

```
^Cookies from other companies
^We use cookies
^This (site|page) uses cookies
^Privacy and cookies
^Cookie (notice|policy|preferences)
```

If `link_text` matches one of these, just don't render it (still render `main_text` and the rest).

`main_text` is generally clean (it's the actual ad copy), no filtering needed.

## Phase 4 — RENDER SPEC

Card mockup (~240px wide):

```
┌────────────────────────────────────┐
│ 🇪🇸 ES   image · es   3d ago       │
│ ───────────────────────────────────│
│ 🎭 Ana Botín, Felipe VI            │
│                                    │
│ "📢 Ha llegado el boom            │
│  tecnológico europeo para los      │
│  inversores particulares. ¡Por fin│
│  todos los españoles pueden res… " │
│                                    │
│ 🔗 senviks.world                   │
│ View Facebook post ↗  (cta_url)    │
└────────────────────────────────────┘
```

CTA href = `ad.cta_url` only. Label = `ad.cta_label`. Rel = `ad.cta_rel`. Never “View archived ad” → live lander.

Section heading (above the grid):

```
Ads scraped this week
20 ad creatives detected across 5 countries · last 7 days
```

(Compute country count from `[...new Set(ads.map(a => a.geo))].length` and total from `ads.length`.)

CSS: dark theme, slate-900/40 card bg with slate-800 border, hover: brighten border slightly. No images = cards should feel substantive, not sparse — generous padding, the ad copy is the visual anchor.

## Phase 5 — ACCESSIBILITY + SEO

- Section uses semantic `<section aria-labelledby="recent-ads-heading">`
- Heading is `<h2 id="recent-ads-heading">`
- Each card is `<article>` not `<div>`
- "View Facebook post" links: `rel="nofollow noopener"` (we don't endorse the scam page; nofollow tells Google we don't pass authority to it)
- `target="_blank"` for the FB links
- The `<time>` tag for "3 days ago" with proper `datetime` attribute
- Country flag uses Unicode regional indicator pairs (already in the EN review codebase if you grep `geoFlag` or similar — reuse if found)

## Phase 6 — JSON-LD enhancement (optional, V2 polish)

Don't ship in V1. Note for the backlog: each ad card could emit a `WebPage` or `Advertisement` schema entity that the master Review's `subjectOf` references — would make the evidence machine-readable for AI Overviews. Add to the `@graph` with `@type: Advertisement` and `about: {@id: master-review#review}`.

## Phase 7 — VERIFY (smoke test)

After implementation:

1. Load `https://cryptokiller.org/review/senvix` — should now show the new section with the 4 example ads above (or however many were synced).
2. `curl -s https://cryptokiller.org/review/senvix | grep -E '(Ana Botín|Pier Berlusconi|Giorgia Meloni)'` → should match.
3. Page Lighthouse SEO score should not drop (≤2pt is acceptable; the new links add ~20 outbound nofollow links).
4. Mobile view — cards stack 1-per-row, no horizontal scroll.
5. Load any review with no recent ads in last 7d — section should NOT render (no empty placeholder).
6. Run `https://cryptokiller.org/review/senvix` through Google's Rich Results Test — schema should still validate, no new errors.

## Out of scope (don't do these now)

- Real ad images / video thumbnails — SpyOwl doesn't expose them; Vercel side will add og:image lazy-fetch as a future enhancement
- Click tracking on the "View Facebook post" links — not building analytics into this widget
- Filtering/sorting controls (filter by country, sort by date, etc.) — future polish
- Translating ad copy — `main_text` stays in its original scam language (that's the point — proves we caught the actual content)

## Reference — full sync payload field paths

After your work:
- `review.recent_ads_sample` — the new array (this work)
- `review.translations` — existing, multilingual review work (already shipped)
- `review.threat_score`, `review.title`, etc. — existing scalar fields
- `brand.normalized_name`, `brand.scam_score`, etc. — existing brand data

Submit the `/review/senvix` URL to Google Search Console after deploy to trigger re-crawl.

## Ready?

Start with Phase 1 (Discovery). Report findings, then proceed.
