# Replit handoff — Recent-ads CTA safety (Peak Luxentria audit)

> Paste into Replit Agent chat after deploying the matching Vercel sync-shape changes.
> Companion to `docs/REPLIT_RECENT_ADS_PROMPT.md`.

---

## Why this exists

Live review pages (e.g. `/review/peak-luxentria`) rendered **"View archived ad"** buttons that pointed at **live SpyOwl / Meta click trackers** (`…/click?…&token_fb…&fbclid…`). That sends readers into the scam funnel from an investigative site.

Vercel now ships an explicit safe CTA contract on each `recent_ads_sample` card. Replit must use it.

## Locked CTA policy

Public “view ad” links may **only** be:

1. Facebook `post_url` (when present and valid), **or**
2. Meta Ad Library search URL built from the brand name, **or**
3. Omitted (card still shows copy + `link_domain`; no outbound CTA).

**Forbidden as CTA `href`s:**

- Raw SpyOwl / creative `link_url`
- Brand `landing_urls`
- Wayback / archive “live fallback” URLs used as an ad CTA
- Any URL matching `/click`, `fbclid`, `token_fb`, `pixel_fb`

## Payload fields (per card)

Vercel `shapeReviewForSync` now emits:

| Field | Meaning |
|---|---|
| `cta_url` | Safe href only (`facebook.com` post **or** Ad Library search). `null` if neither. |
| `cta_label` | `"View Facebook post"` or `"View in Meta Ad Library"` or `null` |
| `cta_rel` | Always `"nofollow noopener"` when `cta_url` is set |
| `post_url` | Still present for evidence; prefer `cta_url` for the button |
| `link_domain` | Hostname only (display) |
| `link_url` | **Never shipped** — do not reconstruct one |

## Required Replit changes

1. **Ingestion** — persist `cta_url`, `cta_label`, `cta_rel` with `recent_ads_sample` (jsonb is fine).
2. **Renderer (`.recent-ads` cards)** — CTA button:
   - `href={ad.cta_url}` only when truthy
   - label = `ad.cta_label` (fallback: `"View Facebook post"`)
   - `rel={ad.cta_rel \|\| 'nofollow noopener'}`, `target="_blank"`
   - If `cta_url` is null → **no CTA link** (optional: show `link_domain` as plain text only)
3. **Delete / stop using** any code path that sets the CTA from:
   - `creative_text.link_url`
   - `landing_urls`
   - archive live URLs
4. **Copy** — replace “View archived ad” with the `cta_label` values above (we are not linking archives for this CTA).
5. Prefer hosted screenshot / Ad Library when `post_url` is missing (already covered by Vercel fallback `cta_url`).

## Also ship with the same deploy (related Peak fixes)

These are Vercel-side but Replit must cooperate:

### Document `<title>` / meta

- Sync payload now includes `seo_title` (and `title` already ≤45 chars) plus `meta_description` ≤155 via word-boundary truncation.
- **`<title>` MUST use `seo_title` or `title`**, never `headline` hard-sliced at 60.
- If you append ` | CryptoKiller`, do not also truncate mid-word; Vercel already budgets for the suffix.

### Duplicate Key Takeaways / FAQ

- Structured `key_takeaways` / `faq` (synced as `key_findings` / `faq_items`) remain the **only** render source for those UI components + speakable.
- Vercel strips matching blocks from `full_article` at sync. After re-sync, expect **one** Key Takeaways and **one** FAQ in the DOM.

### `itemReviewed.url`

- Aggregator URLs (Trustpilot, Sitejabber, etc.) are stripped; prefer safe brand origin or `null`.
- Do not rehydrate Trustpilot onto `itemReviewed.url` in the schema builder.

### `word_count`

- Sync emits word count from the **post-strip** article. Use that for byline / schema; do not re-count independently in a way that drifts.

## Verify on Peak Luxentria

After Vercel deploy + this Replit change + **re-sync** of `peak-luxentria`:

1. `curl -sL https://cryptokiller.org/review/peak-luxentria | grep -E 'token_fb|fbclid|/click\?'` → **no matches** in CTA hrefs.
2. One `.key-takeaways` (or equivalent) and one FAQ block — not two.
3. `<title>` is a clean phrase (not mid-headline cut) + optional ` | CryptoKiller`.
4. Meta description does not end mid-word.
5. JSON-LD `itemReviewed.url` is not Trustpilot.

## Out of scope

- ClaimReview `appearance` Wayback pipeline (separate from recent-ads CTA)
- Image compression / CWV
- Lead-form destination audit
