# Plan 3d-4 — Content Brief (Tier 3 handoff to the writing flow)

**Branch:** `design/topical-map-v4.6-plan3d4-content-brief` (off `main`)
**Skill ref:** topical-map-creation v4.6 Tier 3 handoff; `content-brief-generator`
skill Mode 1 "From Map" (minimum fields: Raw Topic, Section, Search Intent,
Priority, Node Type, URL Slug, Schema Type — all now on the topic row after
Plans 3d-2/3d-3).

## Problem

The topical-map port now enriches each topic with production metadata
(`content_format`, `schema_type`, `node_function`, `url_path`, plus existing
`paa_questions`, `aio_risk`, `format_code`, `search_intent`, `secondary_keywords`,
`internal_links_to`, `priority_score`). But the writing flow strands it:

- `lib/content-prompts.js` (writer) reads only `content_type`, `page_role`,
  `macro_vector`; it dumps the whole topic as raw JSON with **no directive** on
  how to use the metadata.
- The outline prompt (`app/api/admin/content/outline/route.js`) reads
  `topic.title`/`target_keyword` only.

So the map's format/schema/PAA/AIO signals never become production instructions.
That is the Tier-3 handoff gap.

## Goal

A deterministic **content brief** — a pure projection of the topic row into the
Mode-1 brief structure — that turns map metadata into explicit outline directives.
Honesty-safe: it is a projection of stored values; **only fields with real values
are included** (no fabricated/empty directives), matching the skill's honesty rule.

## Design

New pure module `lib/topical-map/content-brief.js`:

- `buildContentBrief(topic, { parentTopic } = {})` → structured brief object:
  identity (title/keyword/url_path), map placement (topic_type/section/page_role/
  node_type/node_function/parent), keyword targeting (search_intent/secondary/
  volume/difficulty), production (content_format/format_code/schema_type),
  heading seeds (from `paa_questions`), aio-risk note, internal-link targets,
  priority. Absent/empty inputs are omitted, not invented.
- `formatBriefForPrompt(topic, { parentTopic } = {})` → compact directive text
  block (only the present sections), e.g. "TARGET FORMAT: Comparison Table",
  "SCHEMA: ItemList", "MUST COVER (People-Also-Ask): …", "AIO RISK: high — lead
  each H2 with a 40-60 word extractable answer".

Wire `formatBriefForPrompt` into the **outline** prompt (structural planning is
the brief's natural home; lower risk than editing the money-path writer, and the
writer inherits structure via the outline). Additive block only — no existing
outline guidance removed.

## Explicitly deferred

- Full 12-section YAML brief with SERP-intel / consensus-map / Sullivan-gate — that
  is the standalone `content-brief-generator` LLM skill; out of scope for the
  deterministic port bridge.
- Entity Map (Wikidata Q-IDs / sameAs) and Publication Plan cadence — separate
  Tier-3 pieces; logged as follow-ups.

## Tests

`test/topical-map/content-brief.test.js` — brief projection (full topic, sparse
topic → omitted sections, parent handling), PAA→heading seeds, aio-risk phrasing,
format/schema passthrough, null-safety (empty topic never throws).

## Verification

`npm test` green; the outline route still imports/builds cleanly; reviewer checks
projection correctness, honesty (no invented fields), and that the injected block
is additive and non-conflicting.
