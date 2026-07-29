# Design: robust topical-map import + Write readiness

**Date:** 2026-07-29
**Status:** approved (brainstorming complete; ready for writing-plans)
**Repo:** `madrank8/crypto-killer` (Vercel admin)
**Related:** existing import under `lib/topical-map/import/`; content briefs /
Sullivan under `lib/content-brief/`; live map after cleanup:
`ebe43bb9-2d22-4699-8c9d-bf7158ec66be`

---

## 1. Problem

Spreadsheet import exists (`POST /api/admin/topical-map/import`) but operators
cannot trust "Import → click Write" as a complete path:

1. **Incomplete trees ship as success.** A mid-flight failure can leave orphan
   maps; stats can claim more topics than were inserted; clusters from the sheet
   can be dropped without a hard stop.
2. **Write readiness is thin.** Operators want B+C: target keyword, search
   intent, wave/priority **and** fuller topic fields (internal links, format,
   schema tips, notes) populated from the sheet — not titles/slugs only.
3. **Sullivan forcing inputs must not be hand-filled every time**, and must
   **never be invented**. They should be **gathered** from our published stack
   first, then **Firecrawl** when the stack is not enough. Topics that still
   lack real evidence stay blocked with an explicit missing list.

The pain this design removes: wasting time filling gaps after a "successful"
import that is structurally or evidence-incomplete.

---

## 2. Decisions (brainstorming)

| Question | Decision |
|---|---|
| What gap matters most? | Tree/structure correctness so Write can start without hand-fixing the map |
| Write readiness bar | **B + C** (keyword/intent/wave **and** fuller sheet-mapped topic fields) |
| Missing required **sheet** cells | **Hard-fail the whole import** |
| Sullivan / forcing inputs | **Gather, never invent** |
| Evidence order | **1) Our stack** (cryptokiller.org + Supabase content/reviews/topics) → **2) Firecrawl** when still short |
| Architecture | **Approach 1:** import hard-gate + atomic persist, then **post-import readiness enrich** |
| Firebase | Out of scope (misheard; means Firecrawl) |

### Rejected alternatives

- **Thin import + gather only on Write** — slower first Write; no map-wide
  readiness view; orphans still possible if import stays soft.
- **Single “Import & Arm” that fails unless every topic is Write-ready** —
  too brittle until Firecrawl + portfolio coverage is dense; blocks using a
  correct tree while evidence catches up.
- **LLM-invented forcing inputs to pass Sullivan** — violates honesty rule 6
  in `lib/content-brief/sullivan.js` and would poison briefs/downstream Write.

---

## 3. Goals / non-goals

### Goals

1. Import either **fully succeeds** (verified topic tree + accurate stats) or
   **fully fails** (no orphan map left behind).
2. Required page-map sheet columns for supporting pages are present and
   non-empty before persist; otherwise HTTP 422 with a row-level report.
3. Persisted topics carry B+C fields from the sheet (and safe classifiers
   already in `field-map.js` / publishing-metadata).
4. After import, a **Readiness** job gathers Sullivan evidence (site →
   Firecrawl), writes only verified `content_type` + `forcing_inputs` onto
   `content_briefs` (or equivalent), and marks each topic Write/brief status.
5. **Write** remains available for draft creation from `topic_id`; brief /
   Sullivan-gated flows stay blocked until `sullivan_ok` (or explicit
   operator override outside this design).

### Non-goals

- Replacing topical-map **generation** (v4.6 pipeline).
- Auto-publishing articles.
- Inventing volumes/KD/Wikidata Q-IDs/anecdotes.
- Requiring Firecrawl for import success (enrich is post-import; missing
  Firecrawl key → stack-only gather + honest gaps).
- Full Firebase / proprietary warehouse integration.

---

## 4. Architecture

```
[Sheet / upload]
      │
      ▼
┌─────────────────────────────┐
│ Parse + header normalize    │
│ Required-cell hard gate     │  ← fail before any DB write
│ Consolidate Koray tree      │
│ Coverage assert (sheet↔tree)│
└─────────────┬───────────────┘
              ▼
┌─────────────────────────────┐
│ Atomic persist              │
│  map + all topics           │
│  verify counts              │
│  on any failure: delete map │  ← hard orphan cleanup
└─────────────┬───────────────┘
              ▼
┌─────────────────────────────┐
│ Readiness enrich (async)    │
│  per supporting topic:      │
│   stack gather → Firecrawl  │
│  upsert content_briefs gate │
│  never invent missing fields│
└─────────────────────────────┘
```

### Components

| Piece | Role |
|---|---|
| `lib/topical-map/import/validate-sheet.js` (new) | Required headers + per-row required cells; returns structured errors |
| `lib/topical-map/import/coverage.js` (new) | Assert every sheet page row appears in consolidated tree (by URL/title); assert expected pillars/clusters |
| `lib/topical-map/import/persist.js` | Strengthen: transactional-ish all-or-nothing; verify inserted counts vs planned; **must** delete map+topics on failure (not best-effort silence) |
| `POST /api/admin/topical-map/import` | Run validate → consolidate → coverage → persist; return `map_id` + warnings; enqueue/trigger readiness |
| `lib/topical-map/readiness/` (new) | Gather + Sullivan validation; provenance on every filled forcing field |
| `POST /api/admin/topical-map/[mapId]/readiness` (new) | Run or resume enrich; idempotent |
| Admin UI | Import error panel (row/column); readiness progress + per-topic blockers; Write still creates content |

---

## 5. Sheet hard gate (import)

### Required headers (page-map tab)

Keep current `PAGE_MAP_HEADERS` in `field-map.js`. Import fails if aliases cannot
resolve the required set (title, Suggested URL, Section, Cluster, Phase, plus
B+C fields below).

### Required cells per **page** row (supporting content rows)

Hard-fail if any is blank after trim:

- Page Title
- Suggested URL
- Section
- Cluster
- Primary Query Cluster (→ `target_keyword` / secondary keywords)
- Search Intent
- Phase (→ publication wave)
- Internal Links To (at least one target; pillars/clusters may be exempt if
  they are structural-only rows — see rule below)

**Structural rows** (pillar/cluster shells inferred by consolidator, not sheet
page rows) are not validated as pages. Only rows that become supporting topics
(or page-level nodes) must pass the cell gate.

### Soft / optional (warn, do not fail)

- Lead KW Volume, KD (may be null; provenance already supports null)
- Notes / Angle (preferred for C; warn if empty but do not hard-fail unless
  we later tighten)

### Coverage assert (before or immediately after consolidate, before persist)

- Count of sheet page rows that should become supporting topics equals
  supporting count in structure (or explicit allowlist of skipped rows with
  reason).
- Every cluster name referenced by a page row exists in the tree.
- Persist must not succeed if consolidator dropped clusters 8–9 style gaps.

### Persist atomicity

1. Create map.
2. Insert pillars → clusters → supporting (existing order).
3. Re-query `topics?map_id=eq…` counts; compare to planned counts.
4. On any insert/count mismatch/exception: delete all topics for `map_id`, then
   delete map; return 500/422 with error. Cleanup failures must surface as
   **critical** in the response (do not claim success).
5. `stats` must reflect **actual** inserted counts, not pre-insert estimates.

### Replace / re-import (small addition)

Optional body flag `replace_map_id`: if set, delete that map’s topics+map
**after** the new map verifies successfully (or delete-first only when
operator confirms — prefer create-then-swap to avoid empty window). Default
remains “always new map” for safety.

---

## 6. Write readiness B+C (from sheet → topics)

On successful persist, each supporting topic should store at least:

| Sheet / derived | Topic field |
|---|---|
| Primary Query Cluster | `target_keyword` (+ secondary list) |
| Search Intent | `search_intent` |
| Phase | `publication_wave` / priority score inputs |
| Internal Links To | `internal_links_to` (slug-remapped) |
| Notes / Angle | `description` or notes column |
| Classifiers already in import | `content_format`, schema-related fields via `publishing-metadata` |

Import success means the **map row is Write-startable** for content draft
creation (`POST /api/admin/content/create` with `topic_id`). Brief / Sullivan
is a separate readiness bit (section 7).

---

## 7. Post-import readiness enrich (Sullivan)

### Honesty contract

From `lib/content-brief/sullivan.js`: forcing inputs come from user, team,
**dataset**, or **portfolio** — never inference. This design treats:

- Published CryptoKiller reviews/content/topics as **portfolio/dataset**
- Firecrawl extraction of those same URLs (or cited primary sources already
  linked from our pages) as **retrieval of existing evidence**, not invention

If a field cannot be filled with cited snippets + source URLs, leave it blank
and keep `sullivan_ok = false`.

### Pipeline per supporting topic

1. **Propose `content_type`** only from deterministic rules + sheet notes
   (e.g. brand-review leaf → `firsthand_review` / infrastructure glossary →
   `infrastructure`). If ambiguous, leave null and skip Sullivan fill.
2. **Stack gather** (required first):
   - Supabase: matching `content`, `reviews`, related `topics` by slug/keyword
   - Live site: public `/api/reviews`, `/api/blog` (or SSR pages) for the same
   - Extract candidate forcing fields with **source citations** (URL + quote)
3. **Firecrawl** (only if stack incomplete and `FIRECRAWL_API_KEY` present):
   - Scrape stack-identified URLs first (our domain)
   - Optionally scrape outbound primary sources already linked on our pages
   - Do **not** scrape random SERP competitors to fabricate anecdotes/metrics
4. **Validate** with `validateSullivanGate`; upsert `content_briefs` row:
   `content_type`, `forcing_inputs`, `sullivan_ok`, provenance metadata
5. Topics still incomplete: status `needs_evidence` + `missing[]` for UI

### Write button behavior (unchanged core)

- **Write** → create content draft from topic (as today).
- Content-brief generate / Sullivan-dependent outline (plan7) remains gated on
  `sullivan_ok`.
- UI shows readiness badge: `sheet_ok` | `evidence_ok` | blockers.

### Firecrawl ops

- Env: `FIRECRAWL_API_KEY` on Vercel.
- Rate limits / cost: batch with concurrency cap; resume by topic id.
- If key missing: readiness still runs stack-only; report
  `firecrawl: skipped`.

---

## 8. Error / UX contract

| Stage | Operator sees |
|---|---|
| Sheet cell gate | 422 + list `{ row, title, missing_columns[] }` |
| Coverage gate | 422 + dropped clusters / unmatched URLs |
| Persist failure | Error + confirmation orphan deleted (or critical if delete failed) |
| Readiness | Progress N/M; per-topic missing Sullivan fields + sources tried |

---

## 9. Testing

- Unit: validate-sheet (blank Primary Query / Intent / Phase / Links).
- Unit: coverage (fixture that previously dropped clusters must fail).
- Unit: persist rollback (mock mid-insert failure → map gone).
- Unit: readiness merger never invents; stack snippet → field; Firecrawl
  mocked.
- Integration (optional): import sample CSV → 67 nodes → readiness dry-run
  without Firecrawl key.

---

## 10. Implementation sketch (for writing-plans)

1. Sheet validation + coverage modules + tests.
2. Persist atomic verify + hard cleanup + accurate stats.
3. Import route wiring + richer 422 payloads; optional replace flag.
4. Readiness gather (stack) + Firecrawl adapter + API + UI progress.
5. Docs: operator runbook (sheet checklist + env key).

---

## 11. Open points (resolve in plan if needed)

1. Exact exempt list for “Internal Links To” on pure structural rows.
2. Whether Notes/Angle becomes hard-required later.
3. Whether readiness auto-starts on import or only via explicit button
   (recommendation: **auto-start** + manual “Re-run readiness”).

---

## 12. Success criteria

- Re-importing the Growth Partner sheet either yields a complete verified tree
  or a clear 422 with zero orphans.
- Supporting topics have keyword, intent, wave, and remapped internal links
  without manual tree edits.
- Sullivan fields fill only from cited stack/Firecrawl evidence; remainder
  stay blocked with explicit `missing`.
- Operator can click Write on a topic for a draft without fixing the map by
  hand; brief path shows honest readiness.
