# Topical Map v4.6 Port — Plan 3d-2: Node Function taxonomy

**Status:** implemented (controller-built + reviewed). Part of Plan 3d (new-stage/taxonomy additions).

**Goal:** Populate the `node_function` column (migration 018, previously unwired) so each saved topic is tagged with its role in the authority graph, per the skill's Node Function taxonomy (v4.4, references/site-type-playbooks.md §1C). This lets the map's function MIX be sanity-checked against the site-type playbook (not 90% commercial, not zero retrieval).

## Taxonomy (§1C) — five orthogonal-to-Node-Type functions
- **authority** — top-of-graph hubs (pillars, category hubs)
- **reinforcement** — corroborate/deepen (FAQ, glossary, methodology, stats)
- **retrieval** — built to be cited/extracted by AI (answer capsules, definitions, frameworks)
- **entity** — reinforce a named entity (about, product, author, brand pages)
- **commercial** — convert (money pages, best-of, comparison, lead-gen)

## Implementation
- `lib/topical-map/node-function.js`: pure `classifyNodeFunction({content_type, content_role, search_intent, node_type, topic_type})` — a first-pass heuristic from signals a topic already carries. Precedence: entity > commercial > authority > retrieval > reinforcement. `brand_review` -> entity; money/commercial/transactional -> commercial; pillar -> authority; quality (fan-out) -> retrieval; else -> reinforcement.
- `stageSave`: computes `node_function` and adds it to each topic row.
- Tests: `test/topical-map/node-function.test.js` (7 tests — all five functions + precedence + defaults). Suite 55/55.

## Notes
- Heuristic, not a precise science — the skill records it as a Notes tag for balance sanity-checking, so a signal-derived first pass is appropriate. Can later be refined (e.g. LLM assist or format_code granularity to better separate reinforcement vs retrieval).
- Deferred: the site-type-playbook MIX sanity-check itself (compare the produced function distribution against the declared playbook's expected mix) — future work once site_type is captured on the run.
