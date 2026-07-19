# Plan 4 — Dashboard UI for v4.6 metadata

**Branch:** `design/topical-map-v4.6-plan4-dashboard-ui` (off `main`)
**Context:** Plans 3d-2/3d-3/3d-4 populate `node_function`, `content_format`,
`schema_type`, `url_path`, `metric_provenance`, `rpp_score`, plus existing
`aio_risk`, `priority_score`, `paa_questions`, `search_intent` — all fetched by the
dashboard (`topics?select=*`) but **invisible** in the UI. Plan 4 surfaces them.

Single file: `app/admin/topical-map/page.js` (~1458 lines, one monolith of sibling
function components; 100% Tailwind; badge lookups are plain JS color objects;
badges return `null` when empty — honesty-friendly). `TopicRow` (206-393) renders
3 variants (pillar 231-302 / cluster 305-357 / leaf 360-392), each with a badge
cluster next to `RoleBadge` (call sites ~255, 317, 368).

## Increments (each: build → sonnet review → PR → merge)

### 4a — Metadata badges
New badges in the topic tree for `node_function`, `content_format`, `schema_type`,
matching the `RoleBadge` shape (`inline-flex … rounded-full text-[10px] … border`,
color-lookup object, `null` when empty). Add at all three `TopicRow` variants.
Pure client UI; data already present; no API change. Low risk.

### 4b — Provenance & metric visibility
- Render `metric_provenance` (measured/estimated/unresolved) as a compact marker
  next to the metric it qualifies (honesty: unresolved/absent shown as "?"/"est.",
  never dressed as fact). Reuse the provenance vocabulary from
  `lib/topical-map/provenance.js`.
- Surface per-topic `aio_risk` (reuse `aioColor()` at page.js:451) and
  `priority_score` (currently only in the editor form) as small indicators.

### 4c — Content-brief preview
- Thin API route `GET /api/admin/topical-map/topics/[id]/brief` that loads the
  topic (+ parent) and returns `buildContentBrief(topic, {parentTopic})` — reusing
  the SAME server module the outline writer uses (single source of truth, no client
  port / no drift).
- A per-topic expand panel in `TopicRow` (new affordance — none exists today) that
  fetches + renders the brief, styled like the amber checkpoint cards
  (`mt-4 p-3 rounded-lg border border-amber-600/30 bg-amber-900/10`). Lets the user
  see exactly what a topic hands the writer before generating (no dead-end).

### 4d — Editor widening (optional, if time)
Extend `TopicEditor` (151-202) to view/override `content_format`, `node_function`,
`schema_type`, `search_intent`. `PATCH /topics/[id]` already accepts arbitrary
fields — supports the override philosophy (never stuck with a wrong classification).

## Verification per increment

`npm test` green; `next build` compiles; where visually observable, verify via the
browser preview (read_page / screenshot) rather than asserting blind. Reviewer
checks honesty (empty → null, no fabricated provenance), that badges match the
existing pattern, and that 4c's API route is auth-guarded like its siblings.

## Out of scope
Map-graph visualization, bulk editing, the full 12-section YAML brief (LLM skill).
