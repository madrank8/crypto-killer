# Crypto Killer — Admin & Content Pipeline

Scam intelligence platform powered by SpyOwl ad surveillance. The Vercel admin dashboard generates, reviews, and publishes scam investigation articles that sync to the live site at [cryptokiller.org](https://cryptokiller.org) (Replit).

## Architecture

```
SpyOwl API                Vercel (this repo)              Replit (cryptokiller.org)
─────────────             ──────────────────              ─────────────────────────
Ad creatives    ──────►   Supabase (PostgreSQL)  ──────►  PostgreSQL (live DB)
scam_brands               Admin dashboard                  Public review pages
76k+ creatives            Multi-agent pipeline             JSON-LD schema
9k+ brands                Review editor                    SEO / AI Overviews
```

- Sync mapping (Supabase → Replit field-level): [`SYNC-ARCHITECTURE.md`](./SYNC-ARCHITECTURE.md)
- Generation pipeline + AI model gotchas + schema enrichment + publish gate: [`docs/PIPELINE.md`](./docs/PIPELINE.md)
- Companion repo for the public site rendering: [`madrank8/cryptokiller`](https://github.com/madrank8/cryptokiller) (with [`ARCHITECTURE.md`](https://github.com/madrank8/cryptokiller/blob/main/ARCHITECTURE.md) overview)

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Database**: Supabase (PostgreSQL) — admin data store
- **AI Pipeline**: Claude Opus (content), Gemini Flash (source research), GPT Mini (audit)
- **Images**: SpyOwl API → Supabase Storage
- **Deployment**: Vercel (production at `crypto-killer.vercel.app`)

## Key Modules (`lib/`)

| File | Purpose |
|---|---|
| `sync-shape.js` | Transforms Supabase review rows into the shape Replit's `/api/sync/review` expects. Single source of truth for field renames, enrichment normalization, coherence guards, and score-verdict consistency. |
| `review-schema.js` | Builds 2026-compliant JSON-LD `@graph` schema (Organization, Person, WebPage, Article, Review, FAQPage, HowTo, BreadcrumbList). Handles tier-aware `reviewRating` polarity and `itemReviewed` type resolution. |
| `review-prompts.js` | Writer prompts for all 3 pipeline phases: Source Researcher (Phase 2), Content Writer (Phase 3, Claude Opus), Quality Auditor (Phase 5). Includes full seo-blog-generator v4.1 + Koray Algorithmic Authorship methodology. |
| `review-consistency.js` | Deterministic pre-INSERT validator. Rewrites drifted numeric claims (celebrity count, creative count, geo count) in LLM output to match canonical brand values. |
| `threat-score.js` | Classifies a `scam_score` (0–100) into tiers (`confirmed`, `high`, `elevated`, `watchlist`, `low`) and derives prose framing, verdict opener, badge label, and `frameAsScam` flag. |
| `writer-personas.js` | 5 author personas (`webb`, `nair`, `ortiz`, `pepi`, `majithia`) with expertise profiles used to populate `Person` JSON-LD author nodes. |

## Authentication

All admin API endpoints require a `Bearer` token in the `Authorization` header. The token is the `ADMIN_SECRET` environment variable configured in Vercel.

### Auth flow

1. **Obtain a token** — `POST /api/admin/auth` with `{ "password": "<ADMIN_SECRET>" }`. Returns `{ "token": "<token>" }` on success.
2. **Authenticate requests** — include the header on every subsequent call:
   ```
   Authorization: Bearer <token>
   ```
3. **Failure** — missing or invalid token returns `401 { "error": "Unauthorized" }`.

The auth logic lives in `lib/admin-auth.js` (`verifyAdmin` / `unauthorizedResponse`). Cron routes and internal machine-to-machine endpoints (e.g. `scraper/continue`) accept `CRON_SECRET` as an alternative Bearer token.

### Example (curl)

```bash
# Authenticate
TOKEN=$(curl -s -X POST https://crypto-killer.vercel.app/api/admin/auth \
  -H "Content-Type: application/json" \
  -d '{"password": "'"$ADMIN_SECRET"'"}' | jq -r '.token')

# Use the token
curl -s https://crypto-killer.vercel.app/api/admin/reviews/list \
  -H "Authorization: Bearer $TOKEN"
```

## API Routes (`app/api/admin/`)

### Auth

| Route | Method | Description |
|---|---|---|
| `auth` | POST | Validate admin password, return bearer token |

### Reviews (scam brand investigations)

| Route | Method | Description |
|---|---|---|
| `reviews/list` | GET | Paginated list of all reviews (excludes orphaned rows) |
| `reviews/create` | POST | Create a blank draft review for a brand. Body: `{ brand_id }` |
| `reviews/generate` | POST | Phase A pipeline: source research → content writing → schema build → Supabase INSERT (SSE stream) |
| `reviews/validate-publish` | POST | Pre-publish validator (8 deterministic checks, no LLM). Body: `{ reviewId }` |
| `reviews/[id]` | GET | Fetch a single review with its brand data |
| `reviews/[id]` | PATCH | Update review fields (auto-recalculates `word_count`) |
| `reviews/[id]/polish` | POST | Phase B pipeline: visual generation → quality audit → hero image (SSE stream) |
| `reviews/[id]/publish` | POST | Publish gate (placeholder, URL, plural checks) → Supabase PATCH → Replit sync |
| `reviews/[id]/sync` | POST | Manual re-sync of a published review to the live site (Replit) |
| `reviews/[id]/images` | POST | Regenerate evidence grid images from SpyOwl → Supabase Storage |
| `reviews/[id]/auto-fix` | POST | Auto-fix publish-gate issues (placeholder scrub, citation replacement). Body: `{ issues, citation_fix_mode }` |
| `reviews/by-slug/[slug]/regenerate-visuals` | POST | Regenerate inline visual placeholders for a review by slug |

### Content (topical blog articles)

| Route | Method | Description |
|---|---|---|
| `content/create` | POST | Create a blank content draft (topic-driven or free-form). Body: `{ topic_id }` or `{ title, content_type }` |
| `content/outline` | POST | Generate an article outline (sections + FAQ) for a draft (SSE stream). Body: `{ content_id }` |
| `content/fill` | POST | Generate the full article body from an approved outline (SSE stream). Body: `{ content_id }` |
| `content/generate` | POST | Full pipeline: outline + article + images in one pass (SSE stream) |
| `content/[id]` | GET | Fetch a content row with linked topic data |
| `content/[id]` | PATCH | Update content draft fields |
| `content/[id]/publish` | POST | Publish/unpublish with quality gate. Body: `{ action: "publish" \| "unpublish" }` |
| `content/[id]/sync` | POST | Manual re-sync of published content to the live blog (Replit) |
| `content/[id]/images` | POST | Regenerate images (stock + AI visuals). Body: `{ mode: "all" \| "stock" \| "visuals" \| "refresh" \| "single" }` |

### Brands & Dashboard

| Route | Method | Description |
|---|---|---|
| `brands` | GET | Paginated brand list with review status. Query: `sort`, `trend`, `review_status`, `limit`, `page` |
| `stats` | GET | Dashboard KPIs: counts, velocity breakdown, score distribution, pipeline stats |
| `funnel-stats` | GET | Aggregated scrape statistics for the Funnels dashboard |
| `settings` | GET | SpyOwl cookie health status |
| `settings` | POST | Update a setting (currently: `spyowl_cookie`). Body: `{ key, value }` |

### Images & AEO

| Route | Method | Description |
|---|---|---|
| `images/generate` | POST | Generate images for a review, content piece, slug, or custom query |
| `aeo-fix` | POST | Targeted AEO (Answer Engine Optimization) patches via AI. Body: `{ fullArticle, title, keyword, fixes, contentType }` |

### Scraper (SpyOwl ad surveillance)

| Route | Method | Description |
|---|---|---|
| `scraper` | GET | Scraper dashboard: ingestion stats, activity breakdown, top surging brands |
| `scraper/trigger` | POST | Manual scrape trigger (chunked + resumable). Body: `{ geo_filter?, resume? }` |
| `scraper/continue` | POST | Internal continuation endpoint for chunked scrapes. Auth: `CRON_SECRET` |
| `scraper/history` | GET | Recent scrape runs with summary stats |
| `scraper/history` | DELETE | Cancel active scrape job. Body: `{ job_id? }` |
| `scraper/countries` | GET | Country-level breakdown of scam activity across all brands |
| `scraper/webhook` | POST | External scraper status update callback. Auth: `ADMIN_SECRET` or `SCRAPER_SECRET` |

### Topical Map

| Route | Method | Description |
|---|---|---|
| `topical-map/generate` | POST | AI-generated topical map with keyword research (SSE stream) |
| `topical-map/maps` | GET | List all topical maps |
| `topical-map/topics` | GET | Query topics by `map_id` (required), optional `parent_id`, `content_type`, `content_status` |
| `topical-map/topics` | POST | Create a free-form topic. Body: `{ title, content_type, topic_type?, target_keyword?, map_id? }` |
| `topical-map/topics/[id]` | PATCH | Update topic fields |
| `topical-map/topics/[id]` | DELETE | Delete topic. Query: `cascade=true` to include descendants |

### Cron Jobs (`app/api/cron/`)

| Route | Method | Description |
|---|---|---|
| `cron/scrape` | GET | Scheduled SpyOwl → Supabase brand/creative sync |
| `cron/polish-watchdog` | GET | Auto-retries stalled polish jobs |
| `cron/archive-landing-pages` | GET | Captures Wayback Machine snapshots of brand landing pages |
| `cron/sync-platform-aggregates` | GET | Syncs platform-level aggregate stats |

## Local Development

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase, Anthropic, Vercel keys
npm run dev
```

Required environment variables:

```
ADMIN_SECRET=              # Bearer token for admin API authentication
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=
REPLIT_SITE_URL=https://cryptokiller.org
SYNC_SECRET=
NEXT_PUBLIC_SITE_URL=https://crypto-killer.vercel.app
CRON_SECRET=               # Auth for cron jobs and scraper continuation
```

Optional (schema `sameAs` links, SpyOwl image pull):

```
CRYPTOKILLER_LINKEDIN_URL=
CRYPTOKILLER_TWITTER_URL=
CRYPTOKILLER_GITHUB_URL=
SPYOWL_COOKIE=
```

## Deployment

Production deploys automatically on merge to `main` via Vercel GitHub integration.

Manual deploy:
```bash
vercel --prod
```

Preview deploy (current branch):
```bash
vercel
```

**Production URL**: https://crypto-killer.vercel.app  
**Vercel project**: `niros-projects-97ed96ee/crypto-killer`

---

## Deployment History

| Date | Commit | Deployment ID | Trigger | Status |
|---|---|---|---|---|
| 2026-04-23 19:10 | `8926748` | `dpl_aqb755536` | chore: .gitignore | ✅ Ready |
| 2026-04-23 19:00 | `3c682a9` | `dpl_8dUKwG4Cmya` | PR #16 merge | ✅ Ready |
| 2026-04-23 ~14:00 | `12be47f` | — | PR #15 merge | ✅ Ready |

### Smoke Test — 2026-04-23 19:11 UTC

Deployment `dpl_aqb755536` · commit `8926748` · 117 lambdas

| Route | Method | Response | Result |
|---|---|---|---|
| `/` | GET | HTTP redirect (Next.js routing) | ✅ |
| `/api/admin/reviews/list` | GET | `{"error":"Unauthorized"}` | ✅ |
| `/api/admin/brands` | GET | `{"error":"Unauthorized"}` | ✅ |
| `/api/admin/reviews/1` | GET | `{"error":"Unauthorized"}` | ✅ |
| `/api/cron/scrape` | GET | `{"error":"Unauthorized"}` | ✅ |
| `/api/cron/polish-watchdog` | GET | `{"error":"Unauthorized"}` | ✅ |
| Build output | — | 117 lambdas, no import errors | ✅ |
| Function logs | — | No runtime errors | ✅ |

All auth gates responding correctly. POST-only routes (`/publish`, `/sync`, `/generate`) blocked at Vercel's deployment protection layer as expected — not reachable without `ADMIN_SECRET`.

---

## Changelog

### 2026-04-23 — PR #16: Schema Enrichment Passthrough + PR2/PR3 Follow-up Patches
**Deployment**: `dpl_8dUKwG4Cmyavgwwav4N8Js8oD71L` · Status: ✅ Ready

Root cause: The Affitto Casa review shipped with `threat_score: 0/100` in the title tag, a 5-star `reviewRating` on a confirmed-scam review, zero ClaimReview/HowTo/ItemList/Dataset/Quotation nodes, and prose/schema celebrity-count drift (body said "26 celebrities", stats block said "28").

**`lib/sync-shape.js`**
- `VALID_PERSONAS` expanded to 5 (`webb`, `nair`, `ortiz`, `pepi`, `majithia`) with Replit canonical source comment
- `normalizeItemList`: accepts bare array **or** `{ items: [] }` object shape (v1.2 writer compat)
- `normalizeHowTo`: accepts both `raw.step` (schema.org canonical) and `raw.steps` (legacy)
- `normalizeQuotes`: aliases `spokenBy`→`speakerName`, `citation`/`sourceUrl`→`citationUrl`, `date`→`publishedDate`

**`app/api/admin/reviews/generate/route.js`**
- 4 rendering sites (`hero stat card`, `sidebar Threat Intelligence table`, `Investigation Summary`, `Stage 1 funnel stat`) now use `cleanCelebrityList.length` (deduped) instead of raw `brandData.total_celebrities` — closes the Floventra-style prose/schema count drift
- `schema_types` in SSE `done` event now includes `ItemList`, `Dataset`, `Quotation`, `Speakable`
- `pipeline_version` bumped to `multi-agent-v1.2-enrichment`

**`lib/review-consistency.js`**
- Numeric consistency validator now handles `how_to.step` (canonical) alongside `how_to.steps` — previously silently skipped numeric claims in HowTo steps

### 2026-04-23 — PR #15: Review Pipeline Hardening
Dedupe + prompts + schema + publish gate + coherence guard. Added `review-consistency.js`, `validateReviewReadyToPublish` gate in publish route, `detectInternalContradictions` in sync-shape, deduped celebrity list logic, tier-aware `reviewRating` polarity fix, `itemReviewed` type resolution from `brand.entity_type`.
