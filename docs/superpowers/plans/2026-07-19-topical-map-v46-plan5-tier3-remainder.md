# Plan 5 — Tier 3 remainder (Publication Plan + Entity Map)

**Branch:** `design/topical-map-v4.6-plan5-tier3` (off `main`)
**Closes:** the last two portable pieces of the v4.6 port.

## What's actually left

Skill Tier 3 = Step 21 Entity Map, Step 22 Publication Plan, Step 23 Schema notes.
- Step 23 (schema.org type) — **already shipped** in Plan 3d-3 (`schema_type`).
- Step 21 Entity Map — half shipped (`schema_type`); the Q-ID / sameAs half remains.
- Step 22 Publication Plan — not started.

**Out of scope (not a port gap):** the full 12-section YAML content brief with the
SERP-intel / consensus-map / Sullivan-gate chain. That is the standalone
`content-brief-generator` LLM skill, not something the deterministic map stage owns.

## 5a — Publication Plan (Step 22)

Inputs already persisted and already loaded client-side (`topics?select=*`):
`publication_wave` (assigned in `stageLinking`: quality-nodes first, priority desc,
parent-wave ≤ child-wave, trust content early), `priority_score`, `sort_order`,
`node_type`, `content_status`.

New pure module `lib/topical-map/publication-plan.js`:
- `CADENCES` per Step 22 defaults: `new` (2–3/wk, Quality Nodes first),
  `growing` (3–5/wk), `established` (1–2/wk + 1 refresh/wk),
  `mature` (1/wk + 2 refreshes/wk).
- `buildPublicationPlan(topics, { cadence, startDate, includePublished })` →
  ordered weekly schedule: sort by wave asc → priority desc → sort_order, chunk by
  the cadence's weekly rate, assign `week` index + `target_date`.
- Deterministic and honest: derives only from persisted fields; `startDate` is a
  required/explicit input (no hidden clock) so the function is pure and testable;
  already-published topics are excluded by default rather than re-scheduled.

Surface: a Publication Plan panel in the dashboard computed **client-side** from
the already-loaded `topics` array — no new API route, no migration, no refetch.

## 5b — Entity Map (Step 21, remaining half)

Reuse the existing curated `lib/wikidata-registry.js` (82 entries, 71 with Q-IDs,
74 with Wikipedia) — it is already honesty-shaped: `buildSchemaEntity` returns
`sameAs` only for known entities, `buildUnresolvedEntity` returns name-only.
**This satisfies Step 21's rule verbatim: never guess a Q-ID or sameAs.**

Extend `buildContentBrief` with an `entity` section:
- Resolve the topic's primary entity via `resolveSlug` on the slugified
  `target_keyword` / `title` (the registry carries aliases).
- Hit → `{ name, wikidata_qid, same_as[] }`. Miss → `{ name, status: 'unresolved' }`.
- Flows automatically into the outline prompt directives (Plan 3d-4) and the
  dashboard BriefPanel (Plan 4c) — no new surface needed.

## Tests

`test/topical-map/publication-plan.test.js` — ordering (wave→priority→sort_order),
weekly chunking per cadence, date assignment, published-exclusion, empty/malformed
input safety, unknown cadence fallback.
`test/topical-map/content-brief.test.js` (extend) — entity resolved vs unresolved,
never fabricates a Q-ID/sameAs on a miss.

## Verification
`npm test` green; `next build` compiles; reviewer checks honesty (no invented
Q-IDs/dates), ordering correctness, and no dead branches.
