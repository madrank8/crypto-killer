# Plan 6 — Full 12-section Content Brief (content-brief-generator v1.4 port)

**Status:** shipped (v1.4 port). Follow-on: [Plan 7](./2026-07-29-plan7-content-brief-v15-port.md)
(skill v1.5 — outline gate, on-demand SERP, `ple_unit`). Plan 6 decision #2
(map-SERP-only, no new API spend) is **superseded for empty-SERP topics** by Plan 7.

**Branch:** `design/plan6-full-content-brief` (off `main`)
**Spec:** `~/.claude/skills/content-brief-generator/` — `references/brief-template.md`
(canonical 12-section YAML), SKILL.md HONESTY RULES + Step 1.6 Sullivan Gate.

**Naming note.** `lib/topical-map/content-brief.js` (Plan 3d-4) is the *lightweight*
outline-directive projection. This plan adds `lib/content-brief/` — the *full*
12-section production brief that feeds seo-blog-generator. Different artifacts;
the lightweight one keeps its job.

## Decisions (confirmed with user)
1. Persist to a new `content_briefs` table (spec has `brief_id` + a
   draft→approved→in-production→published lifecycle, and human-supplied Sullivan
   inputs that must survive reloads).
2. SERP intelligence reuses **map-captured** data (`serp_meta`, `paa_questions`,
   `serp_features`, `serp_authority`, competitor-gap) — already measured, no new
   API spend. Genuine gaps render as literal `[NO DATA …]`, never invented.
3. Build the full thing, increment by increment.

## Field-source map

| Source | Sections |
|---|---|
| Deterministic (map data already shipped) | 1 Identity · 2 Placement (incl. Plan 5 publication plan) · 9 Internal linking · 12 Publication/compliance · url_slug/keywords/schema_type/content_format (3) · entity Q-ID/sameAs (5) · passage_independence (8) |
| **Human — Sullivan Gate** | 3.5 content_type + forcing_inputs |
| LLM | title_tag, meta_description (3) · heading skeleton (6) · EAV/n-grams/predicates (5) · claim categories (7) · visual requirements (10) |
| Map-captured SERP | H2 seeds + PAA (6) · claim seeds (7) · competitor benchmarks (11) |

## HONESTY RULES (non-negotiable, mirrored from the skill)
Literal placeholders, never plausible guesses:
`[NO DATA — requires Tool-Assisted mode]`, `[UNVERIFIED — editor must locate]`,
`[UNRESOLVED — verify at wikidata.org]`, `[DERIVED — not SERP-validated]`.
Never invent PMIDs/DOIs/URLs, competitor metrics, Q-IDs, or **forcing inputs**.

## Increments

### 6a — Schema + Sullivan Gate validator + deterministic assembler
- `migrations/020_content_briefs.sql`: `content_briefs` (id, topic_id, map_id,
  brief_id, status, content_type, forcing_inputs jsonb, brief jsonb, sullivan_ok,
  created_at/updated_at).
- `lib/content-brief/sullivan.js` — `CONTENT_TYPES`, per-type forcing-input specs
  with the skill's exact thresholds (n_size ≥100, direct_anecdotes ≥3,
  evidence_from_portfolio ≥2, sub_entities ≥3, internal_link_targets ≥3),
  `validateSullivanGate()` → `{ ok, missing[], errors[] }`. Pure. **Never infers a
  forcing input.**
- `lib/content-brief/assemble.js` — `assembleBrief()` building all 12 sections:
  deterministic fields filled from the topic/map/publication plan; every other
  field carries its literal honesty placeholder.

### 6b — Sullivan Gate UI (the no-dead-end form)
The skill's HARD STOP becomes a *recoverable* gate: pick a content_type, see
exactly which forcing inputs are missing, fill them, save (persisted). Generation
stays blocked until the gate passes — but the user is never stuck without a path
forward, and the UI never pre-fills a forcing input on the user's behalf.

### 6c — LLM enrichment
Generate the creative sections via existing `lib/ai-models.js`, with honesty
placeholders preserved in the output contract (the model may not replace a
`[NO DATA]`/`[UNVERIFIED]` marker with a guess). Re-runnable per section.

### 6d — SERP wiring
Map-captured SERP artifacts → Section 6 H2 seeds (+`[DERIVED — not SERP-validated]`
where absent), Section 7 claim seeds, Section 11 competitor benchmarks.

### 6e — YAML export + dashboard
Exact field names/order from `brief-template.md` (seo-blog-generator parses them),
download/copy, status transitions, brief panel in the dashboard.

## Verification per increment
`npm test` green · `next build` compiles · sonnet review for honesty violations
(any fabricated value where the source is absent), dead branches, and spec drift
against `brief-template.md` field names.
