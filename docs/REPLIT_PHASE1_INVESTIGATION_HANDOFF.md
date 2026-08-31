# Replit handoff — Phase 1 investigation data model

**Date:** 2026-08-31
**Vercel side:** implemented and building green.
**Replit side:** required, and not automatic. `cryptokiller.org/review/*` is rendered by
Replit; the Vercel app is the admin + preview host. Nothing below reaches the public site
until the Replit renderer consumes it.

---

## 1. Why this exists

The live page, the `reviews` row and the `scam_brands` row currently state three different
threat scores for the same brand. Checked 2026-08-31:

| Surface | Senvix threat score |
|---|---|
| `cryptokiller.org/review/senvix` meta description | **50**/100 |
| `reviews.scam_score` | **56**/100 |
| `scam_brands.scam_score` | **47**/100 |

The same page's meta description says "17 countries with 37 celebrities" while the brand row
holds 18 countries and 136 impersonated figures. This is not a one-off: 32 of 34
investigations carry score drift, and 61 metric literals in prose disagree with the canonical
value.

Phase 1 makes one record canonical and holds every surface to it.

---

## 2. New / changed fields in the sync contract

Migration `026_investigation_canonical.sql` (already applied to `rqyfuioazbdixflqngcs`).
All are nullable with no default. **An empty column means "not established" and must render
as an omitted row, never as `0`** — printing "0 regulatory warnings" makes a factual claim
Crypto Killer has not made.

### `scam_brands`

| Column | Type | Meaning |
|---|---|---|
| `primary_domain` | `text` | The platform's own domain. **Analyst-set.** Do not infer it from `brand_landing_pages` — those hostnames (`breaking24.novinky-cz.com`, `swisschronicle.click`) are cloaked fake-news ad landers, not the platform. |
| `alternate_domains` | `text[]` | Other confirmed domains for the same operation. |
| `scam_types` | `text[]` | e.g. `{celebrity_deepfake, fake_trading_platform}`. |
| `detected_platforms` | `text[]` | Ad platforms. **No upstream source populates this** — the `creatives` table has no platform column. Left empty deliberately. |
| `regulators_checked` | `jsonb` | `[{ regulator, jurisdiction, register_url, checked_at, result }]` |
| `regulator_warnings` | `jsonb` | `[{ regulator, jurisdiction, url, published_at, title }]` |
| `victim_reports` | `jsonb` | `{ count, source, first_report_at, last_report_at }` |
| `classification_override` | `jsonb` | `{ classification, reason, analyst, set_at }` |

### `reviews`

| Column | Type | Meaning |
|---|---|---|
| `evidence_items` | `jsonb` | `[{ claim, evidence_class, source_url, observed_from, observed_to, metric_key }]` |
| `canonical_snapshot` | `jsonb` | The canonical record as asserted at publish time. |
| `validation_report` | `jsonb` | Last validator run: `{ run_at, can_publish, critical[], warnings[] }` |
| `classification_override` | `jsonb` | Per-investigation override (same shape as the brand column). |

---

## 3. Classification — the behaviour change that matters

`lib/threat-classification.js` is now the only score→language map. Bands:

| Score | `classification` | Label |
|---|---|---|
| 0-19 | `LIMITED_EVIDENCE` | Limited Evidence |
| 20-39 | `UNDER_INVESTIGATION` | Under Investigation |
| 40-59 | `ELEVATED_RISK` | Elevated Risk |
| 60-79 | `HIGH_RISK` | High Risk |
| 80-100 | `CONFIRMED` | Confirmed / Extreme Risk |

**`CONFIRMED` is not reachable from the score alone.** The published methodology defines the
80+ band as "confirmed scam with regulator-issued warnings, multiple jurisdictional
enforcement actions, or documented consumer harm". At least one of those must be on the
brand row (`regulator_warnings`, two distinct `jurisdiction` values, or `victim_reports`).
Without one, the investigation keeps its real score and is presented as `HIGH_RISK`, with
`evidence_shortfall` listing what is missing.

`frame_as_scam` therefore means *definitive fraud language is licensed*, and it is now true
only for evidence-backed `CONFIRMED`. Previously it was true from 60 up.

The existing `threat_tier` keys (`confirmed|high|elevated|watchlist|low`) are **unchanged**,
so nothing already consuming them breaks. New fields in the sync payload:
`threat_classification`, `classification_downgraded`, `evidence_shortfall`, `language_rule`.

### Editorial override
An override may only move the register to a **more cautious** band. One that would loosen
language is refused at runtime and returned with `refused: true` and a reason. `reason` and
`analyst` are both mandatory; an unattributed override is ignored.

---

## 4. What the Replit renderer needs to change

### 4.1 The score badge — highest priority
The Vercel preview previously printed `CONFIRMED SCAM` for any score ≥ 70 and
`Extreme Risk — Do Not Deposit` from a raw threshold. If the Replit renderer does the same,
**it is publishing an unsupported fraud allegation on a YMYL page**. Render
`threat_classification_label` / `threat_badge` from the payload. Never re-derive a label from
the number.

### 4.2 H1
Currently `<h1>Senvix</h1>`. Change to:

```
{Brand} Review: Is {Brand} a Scam?
```

The brand is named twice on purpose so the heading survives extraction.

### 4.3 Current Assessment block, directly under the H1
Self-contained, all values interpolated — no model-authored sentences:

```
Crypto Killer classifies {Brand} as {classification_label} at {score}/100 on its threat index.
Crypto Killer surveillance recorded {creatives} advertising creatives, {figures} impersonated
public figures and {countries} targeted countries for {Brand} between {first_detected} and
{last_checked}.
Last checked: {last_checked} · {days_active} days between first detection and most recent check.
```

When `classification_downgraded` is true, add the shortfall sentence — the reader is entitled
to know an 80+ score has not met the evidentiary test.

### 4.4 Evidence Snapshot — a real `<table>`
One row per field with data; **omit rows with none**. Carry `data-canonical-field` and
`data-source` on each `<tr>` so any number on the page is traceable. Field order:
threat score, classification, first detected, last checked, days active, creatives observed,
countries targeted, public figures impersonated, regulatory warnings, victim reports,
primary domain, analyst.

Where the stored name list is capped, render **both** numbers
(`136 observed, 107 individually named`) rather than a headline figure the page cannot back.

### 4.5 Evidence labels
Four classes, rendered as literal text (not colour alone), with `data-evidence-class` on the
element: `OBSERVED`, `REGULATORY`, `REPORTED`, `INFERRED`. An unknown or missing class must
fall back **down** to `INFERRED`, never up to `OBSERVED`.

### 4.6 Section order
H1 → Current Assessment → Evidence Snapshot → Why We Assigned This Score → Investigation
Findings (evidence-labelled) → Advertising Evidence → Regulatory Checks → Domains and
Infrastructure → Victim Reports (only with data) → Timeline → Final Assessment → Sources →
FAQ. Sections with no data are omitted entirely.

### 4.7 `days_active`
Derive it as `floor(last_checked − first_detected)` in days. Do **not** read
`scam_brands.lifespan_days` — it is a stale upstream cache, and the Vercel preview used
`Math.ceil` against the sync payload's `Math.floor` for the same fact.

### 4.8 Metric literals
Every repeated metric must interpolate the canonical field or a `{{stat:…}}` token. The
validator now blocks a publish when two places on a page disagree about the same metric.

---

## 5. Crawlability — audited 2026-08-31, no action needed

Checked and passing, recorded here so nobody re-litigates it:

- `robots.txt` — one wildcard group, `Allow: /`, `Content-Signal: search=yes, ai-input=yes, ai-train=yes`. GPTBot, ClaudeBot, PerplexityBot and Googlebot are **not** blocked. `Disallow` covers only `/api/`, `/admin/`, `/dashboard/`, `/_next/`, `/auth/`.
- `sitemap.xml` — 130 URLs, reachable, listed in robots.
- `/review/senvix` — HTTP 200, `follow: true`, self-referencing canonical, **2,457 words of plain text with JavaScript disabled** (server-rendered, not JS-only), onpage score 98/100.

Two minor items:
- `title_too_long` (69 chars on `/review/senvix`).
- One node with >60 children (the celebrity list) — cosmetic.

---

## 6. Nothing in Phase 1 changes a URL

No route was added, removed or redirected. `/scam-type/*`, `/country/*` and
`/impersonated/*` were **deliberately not created** — the link layer records them as Phase 2
opportunities (146 public-figure links and 115 country links are waiting for them) rather
than shipping links to 404s or thin placeholder pages.
