# last30days → Review Generation Integration Plan

**Date:** 2026-07-07
**Status:** Phase 1 in progress (schema + ingestion + gated read-path)
**Owner:** Niro

---

## 1. What last30days is, and why it fits

`last30days` is a Claude **agent skill** that produces a *recency evidence pool*:
real posts from the last 30 days across Reddit, X, YouTube, TikTok, Hacker News,
and Polymarket, each normalized to `{ source, url, snippet, engagement, date }`
with a source token. It is the upstream skill in the documented pipeline:

```
last30days → storm-research → content-brief-generator → seo-blog-generator → quality gates
```

**The gap it closes for CryptoKiller.** Our review generator's Phase 2 source
research (Gemini Flash + search grounding → regulator/news ledger) is
authoritative but **deliberately drops the exact places victims report scams**.
`source-verify.js` lists `reddit.com`, `twitter.com`/`x.com`, `quora.com`,
`medium.com` as `UNVERIFIABLE_DOMAINS` and strips them before the writer sees
them. So the freshest, most human "experience" signal — someone posting *"I
deposited to [brand] last week and can't withdraw"* — never reaches the review.

For a scam brand that launched weeks ago, recent community reports are often the
**only** primary evidence that exists, and they are the strongest E-E-A-T
*Experience* signal we can carry. last30days supplies exactly that layer.

---

## 2. The one hard constraint

A skill runs **inside the Claude agent**, not inside the deployed Next.js
serverless route on Vercel. The `/api/admin/reviews/generate` route cannot
"call the last30days skill." So the integration is a **two-side design**:

- **Agent side (Cowork/Claude):** run `last30days` → `storm-research` on a brand,
  producing a *grounded* community-evidence dossier. Write the normalized,
  verified rows into Supabase.
- **App side (Vercel route):** read those pre-verified rows and merge them into
  the `sourceLedger` as a new `community_report` source class.

Supabase is the hand-off bus. The route stays light; no scraping or skill
execution moves into serverless.

**Chosen options (2026-07-07):** Agent pre-pass → Supabase · route grounding
*through* storm-research · deliverable = plan + build Phase 1.

---

## 3. Architecture

```
┌─ AGENT SIDE (Cowork, run per brand, ad-hoc or scheduled) ─────────────┐
│                                                                        │
│  last30days(brand name + aliases + scam domains)                       │
│      → raw recency pool: Reddit/X/YT/TikTok/HN posts, last 30d          │
│                                                                        │
│  storm-research  (Mode: RESEARCH, YMYL flag on)                        │
│      → grounds every claim, drops [UNVERIFIED], maps contradictions,   │
│        forces regulator/harmed-user/skeptic personas                   │
│      → community-evidence dossier (source-tokened)                     │
│                                                                        │
│  normalize → POST /api/admin/brands/:id/recency                        │
│      → upsert into brand_recency_evidence (JSONB pool + summary)       │
└────────────────────────────────────────────────────────────────────────┘
                                   │  (Supabase)
                                   ▼
┌─ APP SIDE (/api/admin/reviews/generate, Vercel) ──────────────────────┐
│  Phase 2   Gemini/Claude source research        → sourceLedger         │
│  Phase 2.5 verifySourceLedger + regulator lookups → sourceLedger       │
│  Phase 2.6 ★ NEW: fetchRecencyEvidence(brandId)                        │
│            → map to ledger entries {type:'community_report',            │
│              class:'community', verified:true (pre-grounded),           │
│              generic:false, engagement, date}                          │
│            → merge into sourceLedger (gated by RECENCY_EVIDENCE_ENABLED)│
│  Phase 3   Claude Opus writer (5-stage sub-pipeline)                   │
│            → new ledger block teaches the community_report class rules  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Data contract

### 4.1 New table `brand_recency_evidence`

One row per brand (upsert). The grounded pool lives in JSONB so the shape can
evolve without migrations.

| column           | type          | notes                                            |
|------------------|---------------|--------------------------------------------------|
| `brand_id`       | uuid PK/FK    | → `scam_brands.id`, `on delete cascade`          |
| `pool`           | jsonb         | array of evidence items (schema below)           |
| `summary`        | jsonb         | `{ item_count, platforms[], newest_date, oldest_date, engagement_total, contradiction_notes }` |
| `dossier_md`     | text          | full storm-research dossier for audit            |
| `window_start`   | date          | start of the 30-day window this pool covers      |
| `window_end`     | date          | end of window (usually run date)                 |
| `grounded_by`    | text          | e.g. `last30days+storm-research`                 |
| `run_note`       | text          | free note (who/why)                              |
| `created_at`     | timestamptz   | default now()                                    |
| `updated_at`     | timestamptz   | default now()                                    |

### 4.2 Evidence item (each element of `pool`)

```jsonc
{
  "source": "reddit",              // reddit|x|youtube|tiktok|hackernews|polymarket|other
  "url": "https://reddit.com/r/Scams/...",
  "title": "Lost $4k to <brand> — withdrawal locked",
  "snippet": "grounded, quotable excerpt (storm-research verified)",
  "engagement": { "score": 312, "comments": 88 },  // platform-native, optional
  "date": "2026-06-24",
  "stance": "victim_report",       // victim_report|warning|promo|neutral|contradiction
  "verdict": "Supported",          // storm-research verdict (Supported/Partially/…)
  "confidence": "high"             // storm-research confidence
}
```

### 4.3 Mapped ledger entry (what the route injects)

Ledger stays a flat array; recency entries are marked so downstream logic can
treat them differently from regulator/news sources:

```jsonc
{
  "title": "Reddit r/Scams — victim report (2026-06-24)",
  "url": "https://reddit.com/r/Scams/...",
  "type": "community_report",
  "class": "community",            // NEW — regulator|news|community|generic
  "verified": true,                // pre-grounded by storm-research, not HTTP-checked
  "generic": false,
  "extract": "grounded snippet",
  "recency": { "date": "2026-06-24", "engagement": 312, "source": "reddit" }
}
```

---

## 5. Writer rules for the `community_report` class (YMYL-safe)

The new ledger block appended in `review-prompts.js` / `review-pipeline.js`
teaches the writer:

- **Cite as *experience*, never as *proof of guilt*.** Community reports
  corroborate the funnel and support `experience_signals` and `red_flags`
  framing ("victims reported in the last 30 days that…"), but a regulator finding
  is still required to state regulatory status. This preserves the
  investigative-not-accusatory posture and the defamation hedging already in the
  prompt.
- **Attribute + date every use.** "A Reddit user reported on 2026-06-24…" —
  never an anonymous absolute.
- **Schema mapping.** Community URLs may appear in `quotes[]` (with citation =
  the post URL) and `citations[]` typed `CreativeWork` /
  `SocialMediaPosting` — **never** `GovernmentService`/`Report`, and **never** as
  a `ClaimReview` appearance or regulator `sameAs`. (Directly addresses the
  fake-ClaimReview P0.)
- **No invented engagement numbers.** Only the `recency.engagement` value carries
  through; otherwise qualitative ("multiple recent reports").

---

## 6. Code touchpoints

| File | Change |
|------|--------|
| `migrations/017_brand_recency_evidence.sql` | **NEW** table + RLS + service-role policy + `updated_at` trigger |
| `lib/recency-evidence.js` | **NEW** `fetchRecencyEvidence(brandId)`, `mapRecencyToLedger(pool)`, `summarizePool(pool)` |
| `app/api/admin/brands/[id]/recency/route.js` | **NEW** `GET` (read) + `POST` (upsert from agent pre-pass), admin-auth guarded |
| `app/api/admin/reviews/generate/route.js` | **Phase 2.6** merge, gated by `RECENCY_EVIDENCE_ENABLED` |
| `lib/review-prompts.js` + `lib/review-pipeline.js` | append `community_report` rules to the ledger block (gated) |
| `.env` (Vercel) | `RECENCY_EVIDENCE_ENABLED=1` to activate |

**Feature flag.** Everything on the app side is behind `RECENCY_EVIDENCE_ENABLED`
(default off). Ship the schema + ingestion first; flip the flag only after the
prompt rules are reviewed. Fully reversible.

---

## 7. Phased rollout

- **Phase 1 (this build):** migration, `lib/recency-evidence.js`, ingestion
  endpoint, gated Phase 2.6 merge, gated prompt block. No behaviour change in
  prod until the flag flips.
- **Phase 2:** update writer prompts to actively use the class; run one brand
  end-to-end in preview; eyeball defamation/compliance.
- **Phase 3:** Cowork pre-pass runbook + optional scheduled task to refresh
  recency for the top-N active brands weekly (30-day window decays fast).
- **Phase 4:** surface a "recency freshness" badge in the admin review view and
  a `last_active` vs newest-community-report delta as a QA signal.

---

## 8. Open decisions / risks

- **last30days availability:** the skill is not yet present in this environment's
  skills directory — confirm it's installed in Cowork before the first pre-pass.
- **Freshness decay:** a pool older than ~30 days should be treated as stale; the
  read helper flags `stale=true` when `window_end` is >30 days old and the merge
  down-weights it.
- **Volume:** community reports must not crowd out regulator sources — cap merged
  community entries (default 6) and always keep regulator/news entries first.
- **Compliance:** community reports are opinion/experience; the existing
  hedging + the class rules above keep us defamation-safe. Do not let them
  upgrade a brand from "hedged" to "scam" framing on their own.
