# Phase 1 — SEO/GEO + editorial-quality upgrade: implementation report

**Date:** 2026-08-31 · **Repo:** `crypto-killer-app` (Vercel admin + generation + preview)
**Build:** ✅ compiled, 101/101 static pages generated · **Tests:** ✅ 611/611 pass

---

## 0. Scope note — where the work landed

The brief says "inside Replit". The Replit codebase is not in the connected folder; what is
here is the Next.js app that owns the database, the review generation pipeline, the schema
builder, the publish gate and the sync payload Replit consumes. Every Phase 1 concern that
is *data, classification, validation or structured data* is implemented here and is live
against Supabase `rqyfuioazbdixflqngcs`. The public-facing render on `cryptokiller.org` is a
separate consumer, so its spec is written up in
`docs/REPLIT_PHASE1_INVESTIGATION_HANDOFF.md`, matching the repo's existing handoff pattern.
The Vercel preview route `/review/[slug]` has been rebuilt to the new template and is the
reference implementation.

---

## 1. Architecture as found

| # | Question | Answer |
|---|---|---|
| 1 | Framework / stack | Next.js 14.2 App Router, React 18, Tailwind, plain PostgREST (no Supabase SDK) |
| 2 | Structured data source | Supabase `rqyfuioazbdixflqngcs` — `scam_brands` (12.7k rows), `reviews` (34), `creatives`, `brand_landing_pages` |
| 3 | Where metrics live | `scam_brands.total_creatives / total_geos / total_celebrities / geo_list / celebrity_list / first_seen_at / last_seen_at / lifespan_days / scam_score`, **plus a second frozen copy of the score on `reviews.scam_score`** |
| 4 | Where pages are generated | Public: Replit. Preview: `app/review/[slug]/page.js` (ISR, 60s). Payload: `lib/sync-shape.js::shapeReviewForSync` |
| 5 | Manual vs generated numbers | **Manual.** Numbers were written as literals into `full_article`, `summary`, `meta_description`, `alternative_headline`. A `{{stat:…}}` token system exists but almost nothing uses it |
| 6 | Schema / JSON-LD | `lib/review-schema.js`, 8-node `@graph`. Solid, but Organization was defined inline and `Article.headline` could be empty |
| 7 | Page components | One 1,075-line page file. `RiskBadge` printed `CONFIRMED SCAM` from `score >= 70`; the sidebar printed `Extreme Risk — Do Not Deposit` from the same threshold |
| 8 | Sitemap | Replit-side, `/api/sitemap.xml`, 130 URLs — healthy |
| 9 | robots.txt | Replit-side — permissive, correct, AI crawlers explicitly welcomed |
| 10 | Author/entity data | 5 personas in prompts + 5 live `/author/*` pages, but **all 34 rows store the generic "Crypto Killer Research Team"**; no shared entity definition |

### The defect this phase exists to fix

Three surfaces, three different numbers for the same brand (checked 2026-08-31):

| Surface | Senvix threat score |
|---|---|
| Live page meta description | **50**/100 |
| `reviews.scam_score` | **56**/100 |
| `scam_brands.scam_score` | **47**/100 |

Two existing modules actively disagreed with each other: `lib/sync-shape.js` preferred the
frozen review score, while `lib/review-integrity.js` treated that same disagreement as a
hard fail. Neither ran on the other's path.

---

## 2. What changed

### New modules

| File | Purpose |
|---|---|
| `lib/investigation-model.js` | **The canonical record.** One object per investigation, built from `reviews` + `scam_brands` + `brand_landing_pages`. Derives `days_active`, dedupes figures, records `score_drift`, names the source column for every field |
| `lib/threat-classification.js` | **The one score→language map.** Bands, the CONFIRMED evidentiary gate, editorial overrides |
| `lib/investigation-validator.js` | **The consistency validator.** 22 check codes at critical/warning |
| `lib/evidence-labels.js` | OBSERVED / REGULATORY / REPORTED / INFERRED + derived findings |
| `lib/editorial-language.js` | Fraud-assertion vs safety-directive patterns, hedge detection, source-requiring allegations, pronoun-opener detection |
| `lib/entity-registry.js` | Canonical Organization, 5 analyst Person records, WebSite node |
| `lib/internal-links.js` | Contextual links against a verified-route allowlist; unbuilt destinations become opportunities |
| `components/investigation/CurrentAssessment.js` | The under-H1 block |
| `components/investigation/EvidenceSnapshot.js` | Semantic table, `data-canonical-field` per row |
| `components/investigation/EvidenceLabel.js` | Chip, legend, list |
| `components/investigation/InvestigationSummary.js` | The one reusable card |
| `scripts/audit-investigations.mjs` | Read-only dataset audit → `reports/phase1-investigation-audit.md` |
| `migrations/026_investigation_canonical.sql` | 12 new nullable columns (**applied**) |
| `docs/REPLIT_PHASE1_INVESTIGATION_HANDOFF.md` | Public-render spec |

### Modified

| File | Change |
|---|---|
| `lib/threat-score.js` | `TIERS`/`classifyThreat` deleted; re-exports `lib/threat-classification.js`. Every existing import site unchanged |
| `lib/review-schema.js` | Organization node + `orgSameAs` delegate to the entity registry; `Article.headline` can no longer be empty |
| `app/api/admin/reviews/[id]/publish/route.js` | Runs the investigation validator; criticals join `gate.errors` (422 + existing operator override); stamps `canonical_snapshot` and `validation_report` |
| `app/review/[slug]/page.js` | Rebuilt on the canonical record — see §5 |

### New tests (92 assertions across 5 files)

`threat-classification`, `investigation-model`, `investigation-validator`,
`evidence-labels`, `investigation-entities`, `investigation-page`.

---

## 3. Data / schema changes

Migration `026_investigation_canonical.sql`, applied. All columns nullable, **no defaults** —
an empty column means "not established" and renders as an omitted row, never as `0`.

- `scam_brands`: `primary_domain`, `alternate_domains`, `scam_types`, `detected_platforms`,
  `regulators_checked`, `regulator_warnings`, `victim_reports`, `classification_override`
- `reviews`: `evidence_items`, `canonical_snapshot`, `validation_report`,
  `classification_override`

**No existing column was dropped, renamed, or backfilled. No row was modified.**

Two fields in the brief have no honest source and were left empty rather than guessed:

- **`primary_domain`** — `brand_landing_pages` holds *cloaked ad landers*
  (`breaking24.novinky-cz.com`, `swisschronicle.click`), not platform domains. Promoting one
  would publish a false claim. The model surfaces them as `domain_candidates` for an analyst.
- **`detected_platforms`** — the `creatives` table has no platform column. Nothing upstream
  populates it.

---

## 4. Classification — the behaviour change

| Score | Classification | Definitive fraud language? |
|---|---|---|
| 0-19 | `LIMITED_EVIDENCE` | no |
| 20-39 | `UNDER_INVESTIGATION` | no |
| 40-59 | `ELEVATED_RISK` | no |
| 60-79 | `HIGH_RISK` | no |
| 80-100 | `CONFIRMED` | **only with corroboration** |

The published methodology defines 80+ as "confirmed scam with regulator-issued warnings,
multiple jurisdictional enforcement actions, or documented consumer harm". `CONFIRMED` now
requires one of those on file. Without it the score is preserved and the register drops to
`HIGH_RISK`, with `evidence_shortfall` naming what is missing.

`frameAsScam` was previously true from 60 up. It is now true only for evidence-backed
`CONFIRMED`. **Blast radius: one investigation** (`quantum-ai`, 95/100) — it has no regulator
warning on file, so it is presented as High Risk until one is recorded.

Overrides may only tighten. An override that would loosen language is refused at runtime with
a stated reason. `reason` and `analyst` are both mandatory.

Tier keys (`confirmed|high|elevated|watchlist|low`) are unchanged, so the Replit contract and
all existing consumers keep working.

---

## 5. Page template

`H1` → Current Assessment → **Evidence Snapshot** → **Why We Assigned This Score** →
**Investigation Findings (evidence-labelled)** → existing sections → Sources → FAQ →
**Related reading**.

- H1 is now `{Brand} Review: Is {Brand} a Scam?` (was bare `{Brand}`)
- Every displayed metric reads the canonical record. A test fails the build if
  `brand.total_*`, `brand.scam_score` or `review.scam_score` reappears in the JSX
- `days_active` is derived once (the template used `Math.ceil`, the sync payload
  `Math.floor`, for the same fact)
- `RiskBadge` and the sidebar read `threat_classification`, not a score threshold
- Evidence Snapshot rows carry `data-canonical-field` + `data-source`
- Derived findings name their subject and never open with a bare pronoun

Verified in the prerendered HTML for `/review/senvix`:

```
H1:  Senvix Review: Is Senvix a Scam?
     Crypto Killer classifies Senvix as Elevated Risk at 56/100 on its threat index.
     Crypto Killer surveillance recorded 1,278 advertising creatives, 136 impersonated
     public figures and 18 targeted countries for Senvix between 2025-09-09 and 2026-08-13.
     Last checked: 2026-08-13 · 338 days between first detection and most recent check.
snapshot: threat_score 56/100 ← reviews.scam_score
          days_active 338     ← derived: last_checked − first_detected
          public_figures 136 observed, 107 individually named ← celebrity_list (deduped)
```

---

## 6. Validation problems found in the existing dataset

Full report: `reports/phase1-investigation-audit.md` (470 lines, per-slug detail with
current values and a recommended action for each finding). Read-only — **nothing was
modified**.

**34 of 34 investigations would fail the publish gate today.**

| Severity | Code | Count | What it is |
|---|---|---:|---|
| critical | `METRIC_LITERAL_DRIFT` | 79 | A number typed in prose disagrees with canon (Senvix: "17 countries" vs 18, "37 public figures" vs 136, "1107 creatives" vs 1278; 18 of these were hidden behind inline `<strong>` markup until the review pass) |
| critical | `SCORE_DRIFT` | 32 | Investigation score ≠ live brand score |
| critical | `DEFINITIVE_CLAIM_UNSUPPORTED` | 30 | 20 are outright fraud assertions ("confirmed scam", "is a scam", "is a fraudulent scheme") on investigations classified as low as **6/100**; 10 are safety directives below Elevated Risk |
| critical | `METRIC_SELF_CONTRADICTION` | 2 | Two different values for the same metric on one page |
| critical | `STRONG_CLAIM_UNSOURCED` | 2 | An external allegation with zero sources (`trade-vector-ai`, `whatsapp-bot` — both carry 0 sources) |
| warning | `PRIMARY_DOMAIN_MISSING` | 34 | Expected; needs analyst input |
| warning | `METRIC_HARDCODED` | 22 | Correct today, will drift |
| warning | `AMBIGUOUS_PARAGRAPH_OPENER` | 8 | Extractable passages starting "It…" / "This platform…" |
| warning | `DUPLICATE_TEXT_BLOCK` | 5 | Passage repeated inside one article |
| warning | `CONFIRMED_EVIDENCE_SHORTFALL` | 1 | `quantum-ai` |

The single worst finding: `affitto-casa-immobiliare` scores **6/100** (`LIMITED_EVIDENCE`)
and its article contains the phrase "confirmed scam". A page that says in one paragraph that
the evidence is insufficient and in another that the entity is a confirmed scam is the exact
defamation-and-quality risk this phase was commissioned to close.

Validator tuning done during the run, so the output is signal rather than noise: HTML tags
now strip to a sentinel (stat cards were producing phantom "71 Countries" claims from
adjacent table cells); platform-scale prose is excluded (`methodology` boilerplate, "a
reference database of N public figures"); and `full_article` is no longer compared against
the short fields it is composed from. That cut false positives from 508 findings to 197.

---

## 7. Needs manual factual review

1. **The 32 score-drift pairs.** Two defensible resolutions (adopt the live score and
   regenerate, or freeze the brand score) and the wrong one is silently picking either.
   Deliberately not automated.
2. **20 fraud assertions on low-scoring investigations.** Each needs a human to soften the
   wording or produce the evidence. `affitto-casa-immobiliare` (6/100) first.
3. **`primary_domain` for all 34 brands.** Candidates are in the audit report; every one is a
   cloaked lander and none should be accepted without checking.
4. **`quantum-ai` (95/100).** Either record the regulator warning / victim reports that
   justify "confirmed", or accept the High Risk presentation.
5. **`author_name` on all 34 rows is "Crypto Killer Research Team"** while five real analyst
   pages exist and rank. Assigning a persona per investigation would let the Person entity and
   the `/author/*` pages actually connect.
6. **`last_seen_at` is 2026-08-13 for every brand** — 18 days stale at time of writing. Under
   the 45-day threshold, so it did not warn, but "last checked" is the page's core freshness
   claim and it is drifting.
7. **`trade-vector-ai` and `whatsapp-bot` carry zero sources** while making external
   allegations.

---

## 8. Build / test results

```
npm test    619 tests, 619 pass, 0 fail  (23 suites)
next build  ✓ Compiled successfully
            ✓ Generating static pages (101/101)   — all 33 published reviews prerendered
```

One regression was introduced and fixed during the work: the canonical record was built
after its first consumer, producing a temporal-dead-zone `ReferenceError` on every review
page. Caught by the build's static generation, fixed, re-verified.

Two pre-existing, unrelated notes:

- `/api/search` logs a `DYNAMIC_SERVER_USAGE` notice during prerender. Pre-existing, benign.
- Your local `node_modules` (from April) was missing `yaml` and `xlsx`; a partial
  `npm install --no-save` from this session restored both before dying on a cleanup step the
  mount forbids, so the suite now passes locally too. A full `npm install` is still worth
  running to bring everything current — `package.json`/`package-lock.json` were not touched.

---

## 9. Recommended Phase 2

**First, because Phase 1 exposed it**

1. **Resolve the 32 score-drift pairs and regenerate.** Nothing else in the backlog matters
   while a third of the archive states a threat level the data contradicts.
2. **Ship the Replit renderer changes.** Until then the public site still prints
   `CONFIRMED SCAM` from a raw threshold. This is the highest-risk item in the whole report.
3. **Rewrite the 20 unsupported fraud assertions.**
4. **Make the writer emit `{{stat:…}}` tokens by construction** so `METRIC_LITERAL_DRIFT`
   stops recurring. Do not bulk-tokenise existing prose — `lib/review-stat-tokenizer.js`
   documents why that corrupts correct sentences.

**Then, the growth work the link layer is waiting on**

5. **`/scam-type/<slug>` hubs** — 34 investigations, no destination.
6. **`/country/<iso2>` hubs** — 115 links waiting.
7. **`/impersonated/<slug>` hubs** — 146 links waiting, and the highest-intent queries
   victims actually type.

**Then, quality infrastructure**

8. **Regulator-check automation** into `regulators_checked` / `regulator_warnings`. This is
   the only thing that unlocks `CONFIRMED`, and it is the strongest differentiator the site
   has — nobody else on these SERPs holds first-party ad surveillance *plus* regulator
   corroboration.
9. **Victim-report intake** wired to `/report`, feeding `victim_reports`.
10. **Per-investigation analyst assignment**, connecting the five author pages to real work.
11. **Nightly validator sweep** over published rows, not just at publish time, so drift is
    caught when the scraper moves a number rather than at the next edit.
12. **Timeline as structured data** — `update_history` already exists and is rendered; giving
    it a canonical shape makes the Timeline section extractable.


---

## 10. Adversarial review pass (Fable, same day)

A second, hostile read of the Phase 1 code, verifying every suspicion empirically before
touching anything. Five defects were confirmed and fixed, each with a regression test:

1. **Figure-count overcount (high).** A complete `celebrity_list` containing cross-script
   duplicates still reported the raw scraper tally — the exact Floventra bug class Phase 1
   exists to kill. The deduped count is now canonical whenever the stored list is complete;
   the raw tally is used only when the list is truncated, and then always marked incomplete.
2. **Metric scanner false negative (high).** `across <strong>9</strong> countries` — the
   corpus's own emphasis pattern — sailed past the drift detector, because every HTML tag
   became a scan-blocking sentinel. Inline formatting tags are now removed instead; block
   tags keep the sentinel so stat-card cells still cannot fuse into phantom claims.
   Re-auditing surfaced **18 additional real drifts** (61 → 79) this had been hiding.
3. **Evidence never reached classification at 6 production call sites (high, latent).**
   `generate`, `polish`, `quality-fix`, `review-prompts`, `sync-shape` and `review-schema`
   all called `classifyThreat(score)` bare — so the moment a regulator warning was recorded,
   every pipeline stage would *still* refuse CONFIRMED language. The gate was one-way in
   practice. All six sites now pass `brandEvidence(brand)` plus the editorial override.
4. **Schema author node ignored the analyst registry (medium).** Item 10 was half-done: the
   Person node hardcoded the team even when a byline named a real analyst. It now follows
   the visible byline — a recognised analyst gets their registry Person anchored on the live
   `/author/<id>` page (Article.author follows); the team byline keeps today's node
   byte-for-byte, so no current page changes.
5. **Hygiene (low).** `encodeURIComponent` on the brand-id PostgREST filters added to the
   publish route; review-level override now outranks the brand-level one (more specific
   wins; both can still only tighten); the unused `assessmentSentence` export removed so the
   Current Assessment sentence has exactly one implementation.

Verified after the fixes: 619/619 tests, clean `next build` with all 101 pages prerendered,
and the quantum-ai page rendering the evidence-shortfall disclosure correctly. The audit
report in this folder is regenerated from the fixed validator.
