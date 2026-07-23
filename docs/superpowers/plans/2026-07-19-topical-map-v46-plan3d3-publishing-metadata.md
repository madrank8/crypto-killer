# Plan 3d-3 — Tier 2 Publishing Metadata (deterministic slice)

**Branch:** `design/topical-map-v4.6-plan3d3-publishing-metadata` (off `main`)
**Skill ref:** topical-map-creation v4.6, Steps 15–19 (Tier 2 Publishing Metadata),
v41-additions.md "Content Format" 10-format taxonomy.

## Goal

Populate the publish-time SEO metadata the skill's Tier 2 defines, for the fields
that are **pure, deterministic functions** of data the pipeline already holds — no
LLM creativity, no fabrication risk, fully unit-testable:

1. **`url_path`** (Step 16) — hierarchical URL, no word repetition
   (`/casino-reviews/stake-us/`, not `/casino-reviews/stake-us-casino-review/`).
   Today only the leaf `slug` is stored; there is no full path.
2. **`content_format`** (Step 19b, v4.1) — one of the 10-format taxonomy, assigned
   via the Format Assignment Rules from `format_code` + `search_intent` + `node_type`.
   Distinct from the terse `format_code` (DEF/HOWTO/…); this is the human-readable
   production template that feeds the writing-flow handoff.
3. **`schema_type`** (Step 15–19 set) — the schema.org type, deterministically
   mapped from `content_type`/`format_code`.

## Explicitly deferred (NOT in this increment)

- **Title Tag** (Step 15) and **Meta Description** (Step 17) — creative copy that the
  methodology wants written with the "4 methodologies" applied with judgment. A
  heuristic would ship mediocre production copy, against the quality bar. These
  belong to the writing-flow sub-project (Tier 3 handoff), where an LLM generates
  them. Logged as follow-up.
- **Image URL Slug / Alt** (Steps 18–19) — same reason; image assets are a writing
  concern, not a map-structure concern.
- Domain-inapplicable formats (Clinical Evidence Review, Symptom Checklist) are
  dropped — they are medical-only and cannot honestly apply to a crypto-scam site.
- **Case Study / Data Report** is also dropped from the producible taxonomy: no
  map-stage signal reliably identifies "original research/data" content (no
  `format_code` maps to it; `content_role: 'trust'` is too broad — it also covers
  about/methodology pages). Assigning it would misclassify; deferred to the
  writing flow where the source material is known. (Review-caught.)

## Design

New pure module `lib/topical-map/publishing-metadata.js`:

- `buildUrlPath(segments)` — segments = ancestor→leaf slug array; returns
  `/a/b-c/` with per-segment word-dedup against accumulated ancestors, empty
  segments dropped, single leading+trailing slash.
- `CONTENT_FORMATS` (frozen list) + `classifyContentFormat({format_code,
  search_intent, node_type, content_type})` — `format_code` is the primary
  (domain-produced) signal; intent/node_type fill defaults when it is absent.
- `SCHEMA_TYPES` + `classifySchemaType({content_type, format_code, content_format})`.

`stageSave` passes the ancestor slug chain into `insertTopic` and writes the three
fields on each row. Purely additive — no existing row field touched.

## Migration

`migrations/019_topical_map_publishing_metadata.sql` — idempotent
`ADD COLUMN IF NOT EXISTS` for `url_path text`, `content_format text`,
`schema_type text`. Apply to prod after review.

## Tests

`test/topical-map/publishing-metadata.test.js` — url path (dedup, empty segments,
single-segment, no repetition example from the skill), content-format assignment
(each format_code, intent/node_type fallbacks, precedence), schema type mapping,
null-safety/defaults.

## Verification

`npm test` green; `stages.js` loads; new row fields confirmed at their insert line.
Reviewer subagent checks spec-compliance + reachability (no dead branches, the bug
class caught in 3d-2).
