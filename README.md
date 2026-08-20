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

## API Routes (`app/api/admin/`)

| Route | Method | Description |
|---|---|---|
| `reviews/generate` | POST | Phase A: source research → content writing → schema build → Supabase INSERT (SSE stream) |
| `reviews/[id]/polish` | POST | Phase B: visual generation, quality audit, hero image |
| `reviews/[id]/publish` | POST | Publish gate (placeholder check, URL validation, plural agreement) → Supabase PATCH → Replit sync webhook |
| `reviews/[id]/sync` | POST | Manual re-sync of an existing review to Replit |
| `reviews/list` | GET | Admin review list (excludes orphaned rows) |
| `cron/scrape` | GET | SpyOwl → Supabase brand/creative sync |
| `cron/polish-watchdog` | GET | Auto-retries stalled polish jobs |

## Local Development

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase, Anthropic, Vercel keys
npm run dev
```

Required environment variables:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=
REPLIT_SITE_URL=https://cryptokiller.org
SYNC_SECRET=
NEXT_PUBLIC_SITE_URL=https://crypto-killer.vercel.app
```

Optional (schema `sameAs` links, SpyOwl image pull):

```
CRYPTOKILLER_LINKEDIN_URL=
CRYPTOKILLER_TWITTER_URL=
CRYPTOKILLER_GITHUB_URL=
SPYOWL_COOKIE=
```

Living growth agent (defaults: runner on, autopublish off):

```
AGENT_RUNNER=          # set to 0 to pause Work Plan execution AND map autodraft
AGENT_AUTODRAFT=       # set to 0 to pause topical-map autodraft only (default on)
AGENT_AUTOPUBLISH=0    # must be 1 to allow gated publish
AGENT_AUTOPUBLISH_ALLOWLIST=   # comma-separated content/review slugs
ADMIN_SECRET=
CRON_SECRET=
```

Apply Supabase migrations before using chat/work-plan/autodraft:
`migrations/024_agent_chat_and_work_plan.sql` and `migrations/026_topics_scheduled_for.sql`
on project Crypto Killer (`rqyfuioazbdixflqngcs`).

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
