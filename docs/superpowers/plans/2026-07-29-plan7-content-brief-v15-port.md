# Plan 7 — Content Brief skill v1.5 port (outline gate + SERP + ple_unit)

**Status:** backlog (not started)  
**Branch:** TBD (`design/plan7-content-brief-v15` off `main`)  
**Spec:** `~/.claude/skills/content-brief-generator/` — SKILL.md **v1.5**
(Step 1.5 SERP intel, Visual Semantics `ple_unit`) + existing Plan 6
`references/brief-template.md` field names.  
**Downstream:** `seo-blog-generator` **v5.2.1** (unchanged target version).  
**Predecessor:** [Plan 6](./2026-07-19-plan6-full-content-brief.md) (v1.4 port —
shipped). Operator doc: [`docs/content-brief.md`](../../content-brief.md).

## Why this plan exists

Plan 6 intentionally reused **map-captured** SERP only and left the content
editor **outline / fill** path independent of `content_briefs`. Since then:

1. The skill moved to **v1.5** (live SERP chain + per-section `ple_unit`).
2. **Imported** topical maps often have empty `paa_questions` /
   `serp_features` / `serp_authority`, so Plan 6's "measured SERP" assumption
   fails (example: pillar `crypto-scams-2` — paa=0, no SERP features).
3. Authors can hit **Generate Outline** on a content draft with **no**
   Sullivan-ok brief, producing a lightweight outline that skips the improved
   brief stack.

This plan closes that gap. It does **not** rewrite Plan 6's honesty contract.

## Decisions (confirmed 2026-07-29)

1. **Document first, then implement** — this plan is the system of record for
   the backlog; increments ship after.
2. **Supersede Plan 6 decision #2 for empty-SERP topics:** when map SERP fields
   are empty, allow **on-demand topic SERP capture** (reuse existing
   DFS/Ahrefs helpers from `lib/topical-map/`). Still never invent SERP data;
   failures stay literal `[NO DATA …]`. Cache / skip-if-fresh (&lt;14 days)
   mirrors the skill's Step 1.5 freshness rule.
3. **Outline + fill must respect Sullivan.** SEO (non-Discover) outline
   requires a linked topic with `content_briefs.sullivan_ok = true`. Discover
   mode keeps its existing carve-out (or an explicit override flag — decide at
   7a implementation).
4. **Do not port the agent `serp-analyzer` / `content-consensus-mapper` skills
   as runtime processes.** Reuse map SERP clients + optional LLM consensus
   enrich fed by measured competitor URLs (skill-equivalent outcome, not skill
   subprocess).
5. **Never invent Sullivan forcing inputs** (unchanged from Plan 6 / skill
   HONESTY RULE 6).
6. **Naming:** keep `content_briefs.content_type` as Sullivan SC-098. Map / page
   format stays on `topics.content_type` (pillar_page, guide, …) and
   `topics.content_format`. UI and prompts must label them distinctly — same
   class of fix as seo-blog-generator's `content_format` vs Sullivan
   `content_type` disambiguation (v5.2.1).

## Field-source map (v1.5 delta)

| Source | Sections (delta vs Plan 6) |
|---|---|
| Human — Sullivan Gate | Unchanged (3.5) |
| Map-captured SERP **or** on-demand capture (7d) | H2 seeds + PAA (6) · claim seeds (7) · competitor URLs/features (11) |
| LLM enrich | Unchanged creative fields + **`ple_unit` per heading** (6) · optional consensus gaps (11) |
| Outline / fill prompts | Consume **approved brief** (YAML or condensed), not only lightweight `formatBriefForPrompt` |

## HONESTY RULES (non-negotiable)

Same as Plan 6 / skill:
`[NO DATA — requires Tool-Assisted mode]`, `[UNVERIFIED — editor must locate]`,
`[UNRESOLVED — verify at wikidata.org]`, `[DERIVED — not SERP-validated]`,
`[PENDING — LLM enrichment not run]`, `[NOT CLASSIFIED — …]`.

Never invent PMIDs/DOIs/URLs, competitor metrics, Q-IDs, PAA questions, or
**forcing inputs**.

## Non-goals

- Rewriting `seo-blog-generator` or the Replit SSR site.
- Auto-inferring Sullivan `content_type` from `topics.content_type=pillar_page`.
- Replacing outline with a second LLM "fake brief".
- Full agent skill runtime (`serp-analyzer` CLI/MCP orchestration) inside
  Vercel API routes.

## Increments

### 7a — Outline / fill gate + brief prompt injection (P0)

**Problem.** `POST /api/admin/content/outline` (and fill) never check
`content_briefs`. Content editor "Generate Outline" is the default production
path.

**Work.**
- Gate: for non-Discover content with `topic_id`, require
  `content_briefs.sullivan_ok` (422 with clear message + link to topical-map
  brief panel).
- Inject: new `lib/content-brief/prompt.js` (or similar) that formats the
  persisted brief for outline/fill system+user prompts (headings,
  `starting_statement`, claim categories, internal links, Sullivan type).
- Keep lightweight `lib/topical-map/content-brief.js` as map-directive summary
  only (document icon); do not delete it.
- Content editor UX: show brief status / "Pass Sullivan on the map first"
  when blocked.

**Touch.** `app/api/admin/content/outline/route.js`, fill route,
`app/admin/content/[id]/page.js`, new prompt helper, tests.

**Acceptance.** Outline without Sullivan-ok brief → 422. With brief → prompt
contains brief-derived directives. Discover carve-out documented and tested.

### 7b — Disambiguate `content_type` labels (P0, parallel)

**Problem.** `topics.content_type = pillar_page` is not a Sullivan value;
authors (and prompts) conflate the two.

**Work.**
- Admin UI: Sullivan panel already uses SC-098 enums — add explicit copy that
  map `content_type` ≠ Sullivan `content_type`.
- Content create / generate / outline prompts: pass map field as page format /
  Koray content type; never treat `pillar_page` as Sullivan input.
- Optional later migration rename is **out of scope** unless product decides;
  labels + prompt hygiene first.

**Acceptance.** No code path auto-fills Sullivan from `pillar_page`. Operator
doc updated.

### 7c — On-demand topic SERP capture (P1)

**Problem.** Imported topics lack SERP; assembler seeds empty +
`[DERIVED — not SERP-validated]`.

**Work.**
- `POST /api/admin/topical-map/topics/[id]/serp-capture` (name flexible):
  run keyword SERP via existing helpers (`fetchSerpsBatch` / Ahrefs), write
  `paa_questions`, `serp_features`, `serp_authority`, competitor URL fields
  on `topics`.
- Freshness: skip spend if captured &lt;14 days unless `force=true`.
- UI: button on Content Brief panel ("Capture SERP for this keyword").

**Acceptance.** After success, topic has measured PAA or explicit empty with
tool failure logged. No invented questions.

### 7d — Re-assemble brief after SERP + consensus enrich (P1)

**Work.**
- Re-running assemble (save brief) after 7c refreshes Section 6 H2 seeds and
  `heading_seed_provenance`; preserve Sullivan inputs and LLM-filled fields
  that are not seed-dependent (merge strategy documented in code).
- Enrich: pass measured competitor URLs + SERP features into Section 11 /
  claim seeds; still refuse to invent DR/word counts (`[NO DATA]`).

**Acceptance.** Brief after SERP shows `serp_paa (measured)` when PAA exists.
Section 11 improves only when URLs measured.

### 7e — `ple_unit` (Pixel / Letter / Byte) (P1)

**Skill:** Visual Semantics addendum — every heading carries
`ple_unit: { pixel, letter, byte }`.

**Work.**
- `assemble.js`: scaffold `ple_unit` with `[PENDING — LLM enrichment not run]`
  (or structured empty + pending) on each `heading_structure` row.
- `enrich.js`: include in schema + prompt; honesty guard (no fake CDN URLs in
  pixel).
- `yaml.js` + tests: field present in export order per template.

**Acceptance.** 0 → N headings with `ple_unit` in YAML; enrich fills pending;
tests cover assemble + enrich merge.

### 7f — Fill prefers brief headings; status UX; version bump (P2)

**Work.**
- Fill: if Sullivan-ok brief exists, prefer brief H2 order / instructions;
  outline remains human-editable override.
- UX: content editor + brief panel show brief lifecycle + deep links
  topic ↔ content.
- Bump port comments / YAML header from "v1.4 port" → **v1.5**; update
  `docs/content-brief.md` workflow (outline gate + SERP button).

**Acceptance.** Port metadata matches skill v1.5; fill uses brief when present.

## Ship order

```
7b (labels) ──┐
7a (gate + inject) ─┴─→ 7f (fill / UX / docs)
7c (SERP) ─→ 7d (re-assemble + consensus) 
7e (ple_unit) — parallel once heading schema in 7a/7d is stable
```

## Verification per increment

`npm test` green · relevant route smoke · honesty review (no fabricated SERP /
forcing inputs) · spec drift check against skill v1.5 + `brief-template.md`
field names · manual path on topic `crypto-scams-2` /
content `7cbae911-02a0-4cdd-a7c4-f1631640e12e` after gate lands.

## Immediate validation fixture

| Artifact | ID / slug |
|---|---|
| Topic | `fc154baf-ecaf-41f7-ba74-a5b2091d490c` (`crypto-scams-2`) |
| Content draft | `7cbae911-02a0-4cdd-a7c4-f1631640e12e` (`crypto-scams`) |
| Symptom today | Outline-only draft; no `content_briefs` row; SERP empty on topic |

## Related files (current system)

| Piece | Path |
|---|---|
| Sullivan | `lib/content-brief/sullivan.js` |
| Assemble | `lib/content-brief/assemble.js` |
| Enrich | `lib/content-brief/enrich.js` |
| YAML | `lib/content-brief/yaml.js` |
| Lightweight map brief | `lib/topical-map/content-brief.js` |
| Outline API | `app/api/admin/content/outline/route.js` |
| Brief APIs | `app/api/admin/topical-map/topics/[id]/content-brief*` |
| Brief UI | `app/admin/topical-map/page.js` (clipboard panel) |
| Schema | `migrations/020_content_briefs.sql` |
