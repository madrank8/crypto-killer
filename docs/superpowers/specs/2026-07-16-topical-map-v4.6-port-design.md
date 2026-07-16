# Design: port topical-map-creation v4.6 into the admin dashboard

**Date:** 2026-07-16
**Status:** approved (brainstorming complete; ready for writing-plans)
**Sub-project:** A of 2 (A = topical map creation, B = writing flow)
**Repo:** `madrank8/crypto-killer` (Vercel admin at crypto-killer.vercel.app)

---

## 1. Problem

The dashboard already generates topical maps ("Topical Map v2"), but it is a **loose
approximation** of the `topical-map-creation` skill rather than an implementation of it:

- `lib/topical-map/prompts.js` is **188 lines / 3 prompts** (foundation, skeleton,
  pillarStructure) standing in for a 31-step, 9-phase methodology.
- The stage order **contradicts the skill**: the skill runs Phase 5 Cannibalization + Focus
  Review (marked MANDATORY) **before** Phase 6 Build the Map. The dashboard runs `qa`
  (cannibalization/dedup) at stage 7 of 9, i.e. **after** `structure` and `linking`. Today
  we build the map and then check it for cannibalization; the skill says dedup first.
- Several skill outputs have no representation at all: RPP filtering, Node Function
  taxonomy, Quality/Trending node classification, content briefs (Tier 3).
- The map view renders a pillar/cluster/leaf **tree**. The skill's Tier 1 output is a
  sectioned topic **table** (intent, priority, node type, fan-out tags, AIO Risk Score).
  A faithful pipeline would have nowhere to render its output.

The decision (see §2) is that the **skill as written is the source of truth**. The
dashboard should produce what the skill produces.

### Version correctness (important)

The skill is **v4.6** (frontmatter: per-author Author Authority Signature) with a
**31-step** procedure. Two secondary sources are stale and must not be used as the spec:

- The Obsidian wiki page `claude/skills/topical-map-creation.md` (dated 2026-06-07) says
  "23-step" and predates v4.4/v4.5/v4.6.
- The plugin skill listing says "v4.3".
- Even the skill's own `references/changelog.md` stops at v4.5.

**Only `~/.claude/skills/topical-map-creation/SKILL.md` and its `references/` are
authoritative.** A follow-up task should re-ingest the wiki page.

---

## 2. Decisions taken during brainstorming

| Question | Decision |
|---|---|
| Source of truth | The skills **as written** (not a from-scratch redesign) |
| Sequence | **Topical map first**; writing flow (sub-project B) second |
| Port scope | **Tool-Assisted mode only**; **Tiers 1-3** |
| Architecture | **Extend the existing pipeline + vendor the methodology** into the repo |
| Dashboard scope | **Only what the port needs** (no broader IA/UX rework) |

### Rejected alternatives (recorded so they are not relitigated)

- **Orchestrate the real skill from the dashboard.** Zero drift, but fights the platform:
  a 31-step gated conversation against Vercel's 300s function ceiling, conversational
  (not structural) checkpoints that break the editable pool-review UI, MCP tool access
  from serverless, nondeterminism, cost.
- **Ingest the skill's output artifact** (the `data/icp.json` pattern). Smallest build and
  zero drift, but map creation stays a manual Claude session; it does not put the flow in
  the dashboard.
- **Manual mode / Audit mode / Tier 4 XLSX.** Manual mode is pointless when DataForSEO and
  Ahrefs keys are already wired. The dashboard IS the PM view, so the Tier 4 6-sheet XLSX
  duplicates it. Audit mode is a distinct second entry path; defer.

---

## 3. Scope

### In

1. Vendor the v4.6 methodology into the repo, version-pinned.
2. Realign `STAGES` to the skill's 9 phases, including the Phase 5-before-Phase 6 fix.
3. Add the missing steps: mode/inputs declaration + site-type playbook, research-foundation
   ontology, RPP filtering, cannibalization + focus review as a real gate, node taxonomy
   (Quality/Trending/Standard + Node Function), AIO Risk Score, Tier 2 publishing metadata,
   Tier 3 content briefs.
4. Make the skill's HONESTY RULES structural (provenance per metric, not prompt-only).
5. Migration for the new topic fields.
6. UI: Tier 1 table view, Phase 5 checkpoint review, brief (Tier 3) view.
7. A minimal test harness (see §9).

### Out

- Manual mode, Audit mode, Tier 4 PM Content Plan / XLSX, Phase 9.
- Phase 8 Maintenance (deferred to a later cycle).
- The writing flow (sub-project B) beyond the brief handoff contract in §8.
- Any dashboard IA/UX work not required by the above.

---

## 4. Architecture: extend + vendor

Keep the existing execution model. It is already the correct substrate for a
checkpoint-gated procedure:

- `topical_map_runs` rows carry `status` (`running` / `awaiting_approval` / `completed` /
  `failed` / `cancelled`) and the current stage.
- `STAGES` is a registry where any stage may declare `checkpointAfter`.
- `POST /api/admin/topical-map/runs/[id]/advance` executes **one stage per HTTP call**
  (`maxDuration = 300`) and is **resumable**: a failed run stays on its stage and
  re-advancing retries it.

This is what makes a long, human-gated pipeline survive serverless function limits. The
port is an **evolution of the `STAGES` registry**, not a rewrite. One stage per `/advance`
call is preserved; no stage may assume it can run the whole procedure.

### Vendoring

Copy the skill into `lib/topical-map/methodology/`:

- `SKILL.md`
- `references/`: `step-overview.md`, `procedure-detailed.md`, `procedure-addendum.md`,
  `site-type-playbooks.md`, `aio-risk-score.md`, `dataforseo.md`, `supplementary.md`,
  `author-cluster-assignment.md`

Excluded (not needed for Tool-Assisted / Tiers 1-3): `pm-content-plan-spec.md`,
`case-studies.md`, `gpt-agents.md`, `v41-additions.md`, `changelog.md`, `scripts/recalc.py`.

Why vendor at all: the canonical skill lives at `~/.claude/skills/` on a workstation and is
**not deployable to Vercel**. Vendoring is what makes the methodology available at runtime.

Drift control (the explicit cost of Approach A):

- `lib/topical-map/methodology/VERSION` contains `4.6`.
- A sync script (`scripts/sync-methodology.mjs`) re-copies from `~/.claude/skills/` and
  updates VERSION + a content hash manifest.
- A check script compares the vendored hash manifest against the source when it is present,
  and is a no-op when it is not (CI has no `~/.claude`). Drift becomes a visible diff rather
  than silent divergence.
- The run row records the methodology version used, so a map is always attributable to a
  specific methodology version.

---

## 5. Stage registry realignment

Target `STAGES` (skill phase -> stage), preserving one-stage-per-`/advance`:

| # | Stage key | Skill phase | Change | Checkpoint |
|---|---|---|---|---|
| 0 | `inputs` | 1 Inputs + Mode Declaration | **new**: record mode (`tool_assisted`), central entity, source context, site-type playbook | - |
| 1 | `foundation` | 2 Research Foundation | extend: ontology, 10 word-relation types, entities, knowledge domains, query semantics, 5 Core Components | - |
| 2 | `expansion` | 3 Generate & Expand | exists | - |
| 3 | `competitor_gap` | 3 Generate & Expand | exists (move under Phase 3) | - |
| 4 | `metrics` | 4 Filter/Cluster/Prioritize | exists | - |
| 5 | `rpp_filter` | 4 Filter/Cluster/Prioritize | **new**: RPP filtering | - |
| 6 | `serp_clustering` | 4 Filter/Cluster/Prioritize | extend: SERP-Overlap Decision Tree, Winning Page Type | `pool_review` (exists) |
| 7 | `cannibalization` | 5 Cannibalization + Focus Review (MANDATORY) | **new; runs BEFORE build** | `cannibalization_review` (**new**) |
| 8 | `structure` | 6 Build the Map | extend: node taxonomy (Quality/Trending/Standard + Node Function), AIO Risk Score | - |
| 9 | `linking` | 6 Build the Map | exists (link graph, publication waves) | - |
| 10 | `publishing_metadata` | 6 Build the Map (Tier 2) | **new**: title tags, URL slugs, meta descriptions | - |
| 11 | `briefs` | 7 Content Briefs (Tier 3) | **new**: the handoff to sub-project B | - |
| 12 | `save` | - | exists | - |

The existing `qa` stage is **replaced**: its cannibalization/dedup responsibilities move
earlier into `cannibalization` (stage 7), and any remaining structural checks fold into
`save` preconditions. This is the ordering fix from §1.

Publication-wave sequencing in `linking` must honour v4.5 **velocity governance** (match
publishing rate to baseline + editorial capacity, jitter cadence, ramp gradually, never
spike). A velocity spike vs baseline is a documented scaled-content-abuse signal; this is
the planning-side control for it.

---

## 6. Honesty rules are structural, not prompt-only

The skill's HONESTY RULES section explicitly "overrides all other instructions": never
fabricate search volume / KD / CPC, Wikidata Q-IDs, sameAs URLs, overlap percentages, or
RPP decimals without a tool call; mark unverified fields `[UNRESOLVED]` or `[ESTIMATED]`.

A prompt instruction is not sufficient. This system already shipped a bug where a failed
auditor produced a verdict-shaped empty object that the publish gate read as a pass, so
"the model was told not to" is a demonstrated non-control.

Requirement: every metric-bearing field carries **provenance** alongside its value, one of
`measured` (a tool call returned it), `estimated`, or `unresolved`. Rendering and any
downstream consumer must be able to distinguish them. A field with no provenance is
treated as `unresolved`, never as a fact.

---

## 7. Data model

Migration `018_topical_map_v46.sql` (017 is taken by `017_brand_recency_evidence.sql`)
adding to `topics`:

- `node_type` - `quality` | `trending` | `standard`
- `node_function` - `authority` | `reinforcement` | `retrieval` | `entity` | `commercial`
- `rpp_score` numeric + `rpp_provenance`
- `aio_risk` - `low` | `medium` | `high` | `critical`
- `fan_out_tags` jsonb
- `metric_provenance` jsonb (per-field provenance map, per §6)
- `winning_page_type` text

To `topical_map_runs`:

- `methodology_version` text (e.g. `4.6`)
- `site_type` text (playbook selected in `inputs`)
- `mode` text (`tool_assisted`)

Existing rows: new columns are nullable; a null `metric_provenance` reads as `unresolved`.
No backfill of fabricated values.

---

## 8. Interface to sub-project B (the writing flow)

`briefs` (stage 11) emits the Tier 3 Production Handoff. This is the **contract** between
sub-project A and B, and locking it is why A goes first.

A brief references a topic and carries what `seo-blog-generator` Phase 0 needs: central
entity, page role (Root/Core/Outer), macro/micro contextual vectors, topical border
(in-scope / out-of-scope / intent-bleed), question network, attribute classification,
main-vs-supplementary split, plus node type/function and AIO risk from the map.

The exact field list is fixed when B is specced. A must not assume B's internals; B must
not reach back into map internals other than through the brief.

---

## 9. Testing

**This repo has no test suite.** `package.json` exposes only `dev`, `build`, `start`,
`lint`. There is no runner, no test files, no CI test step.

Implementation therefore opens with a minimal harness before any pipeline work. The
highest-value targets are the pure functions, which are very testable and carry the
methodology's logic:

- `lib/topical-map/clustering.js` (SERP overlap, `scoreAioRisk`)
- RPP filtering (new)
- The cannibalization decision logic (new)
- Provenance handling (§6): assert an ungrounded metric can never render as `measured`
- Stage-order invariant: assert `cannibalization` precedes `structure` (guards the §1 bug
  from regressing)

Verification beyond unit tests: a run against a real seed keyword, compared against what
the skill produces for the same input. That comparison is the acceptance bar for
"faithful port".

---

## 10. Risks

1. **Drift.** A second implementation of a 31-step methodology will diverge from the skill
   over time. Mitigated by vendoring + VERSION + hash check, not eliminated. Every skill
   upgrade requires a deliberate re-sync + diff review.
2. **Scale of the port.** This is the largest item; the stage table in §5 grows the
   pipeline from 9 to 13 stages, several non-trivial. Expect decomposition during
   writing-plans.
3. **Vercel limits.** New stages must each fit in 300s. `serp_clustering` and `metrics`
   are already the heaviest; RPP filtering adds more tool calls. If any stage cannot fit,
   it must be split, not given a longer timeout.
4. **Untested legacy.** The existing stages have no tests; refactoring their order (the
   `qa` -> `cannibalization` move) without tests is the riskiest edit in the plan. The
   harness in §9 must land first.

---

## 11. Follow-ups (not this spec)

- Sub-project B: port `seo-blog-generator` (5 phases, 9-step gate chain, semantic-content-engine COMPOSE).
- Re-ingest the stale wiki page `claude/skills/topical-map-creation.md` (says 23-step; skill is v4.6 / 31-step).
- Phase 8 Maintenance; Audit mode; Tier 4.
